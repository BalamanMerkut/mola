import fs from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createLiveBackup, restoreBackup } from './backup.js';
import { backupPaths, pathsOverlap } from './backup-paths.js';
import { diskCapacity } from './disk-capacity.js';
import { protectOldBackups, rewrapBackups } from './backup-key.js';
import type { BackupProtection } from './key-vault.js';
import type { SecondBackup } from './second-backup.js';
import { plainError } from './backup-errors.js';
import type { CloudBackup } from './cloud-backup.js';
import { businessDay } from '../packages/domain/business-day.js';
import { keptBackups, mainTier, newestFirst, RETENTION, type Retention, type Tier } from './backup-retention.js';
import type { ChangeMark, ChangeMarker } from './change-marker.js';

export type BackupStatus = {
  running: boolean; lastAttemptAt?: string; lastSuccessAt?: string; lastDirectory?: string; files?: number;
  lastError?: string; nextRunAt?: string; kept?: number;
  /** At most this many automatic backups stay (7 günlük + 4 haftalık + 12 aylık); year packages apart. */
  keep: number;
  /**
   * When the backups were last known to hold every real change: a verified backup, or an automatic run that found nothing
   * new. The owner's "healthy" and Mola Merkez's "son yedek" use it, so a closed week is not reported as a failing backup.
   */
  currentAt?: string;
  /** The last automatic run that was not needed, in the owner's words ("Gece yedeği gerekmedi: 23:41 gün sonu yedeği güncel."). */
  skipped?: { at: string; text: string };
  /** The automatic backups kept now, newest first, and why each stays (Günlük / Haftalık / Aylık). */
  set?: { at: string; tier: Tier }[];
  /** Sealed year packages (server/year-packages.ts): kept for good, stored once; ok false when the last check found a problem. */
  packages?: YearPackageView[];
  /** The readable copy taken before the first year package, and when it goes by itself (server/year-packer.ts removeSafetyCopy). */
  safetyCopy?: { removeAt: string };
};
/** A year package as the backup screen lists it ("Yıl paketi 2025"). */
export type YearPackageView = { year: string; bytes: number; sealedAt: string; ok: boolean };
export type BackupOptions = {
  backups: string; keys: string; checks: string; hour?: number; minute?: number; checkDisk?: typeof diskCapacity;
  /** Which automatic backups stay (server/backup-retention.ts); tests use smaller numbers. */
  retention?: Retention;
  /** Protected installs: the live master key and recovery block. Backups then carry their key sealed inside (no key files). */
  protection?: () => BackupProtection | undefined;
  /** Copy of each verified backup to a flash drive or a synced folder. */
  second?: SecondBackup;
  /** Nothing to keep yet (a clean install before its owner account): the automatic run waits for the next night. */
  idle?: () => boolean;
  /** Sunucu yedeği: the encrypted copy goes to Mola Merkez after each verified backup (server/cloud-backup.ts). */
  cloud?: CloudBackup;
  /** Değişiklik işareti (server/change-marker.ts). Without it every automatic run backs up (the old way). */
  changes?: ChangeMarker;
  /** The sealed year packages (server/year-packages.ts), for the backup screen. */
  packages?: () => YearPackageView[];
  /** The readable copy before the first year package, while it is kept (server/year-packer.ts safetyCopyView). */
  safetyCopy?: () => { removeAt: string } | undefined;
};
/** Why a backup runs: the nightly/catch-up timer, the owner ("Şimdi yedekle" and the like), or the day's cash closing. */
export type BackupReason = 'auto' | 'manual' | 'day-close';
/** verification.json of a backup this scheduler made and proved. */
/** `order`: 1, 2, 3… in the order the backups were made here (equal times, a clock set back within a day). */
type Proof = { verified?: boolean; automatic?: boolean; reason?: BackupReason; changes?: ChangeMark; order?: number };
type Managed = { name: string; dir: string; createdAt: string; order?: number; proof: Proof };
const STATUS_FILE = 'auto-backup-status.json';
const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86400000, MIB = 1024 * 1024;
/** Safety net: an automatic backup runs when the newest one is older than this, changes or not (so at least one a week). */
export const FORCE_AFTER_MS = 6.5 * DAY;
/** Leftovers of an interrupted backup or proof (power cut mid-backup) older than this are removed by the next run. */
const LEFTOVER_MS = HOUR;
const BACKUP_NAME = /^backup-\d{4}-\d{2}-\d{2}T[\w-]+$/;
/** Left free after a backup, so the live database (often on the same disk) can always keep writing. */
export const BACKUP_DISK_RESERVE_BYTES = 512 * MIB;
/**
 * The database grows by years of history and every kept backup is a full copy. A backup is only started when the disks
 * have room for it: while it is made, the backup folder holds the plain database copy and its encrypted copy, and the
 * proof folder one more restored copy. Without this check a full disk would stop the café's own writes.
 */
export async function assertBackupSpace(dataDir: string, options: Pick<BackupOptions, 'backups' | 'checks' | 'checkDisk'>) {
  const size = (await fs.stat(join(dataDir, 'merchant.sqlite'))).size, check = options.checkDisk ?? diskCapacity;
  const volumes = new Map<number | bigint, { path: string; bytes: number }>();
  for (const [path, bytes] of [[resolve(options.backups), 2 * size], [resolve(options.checks), size]] as const) {
    await fs.mkdir(path, { recursive: true });
    const device = (await fs.stat(path)).dev, volume = volumes.get(device);
    if (volume) volume.bytes += bytes; else volumes.set(device, { path, bytes });
  }
  for (const { path, bytes } of volumes.values()) {
    const disk = await check(path), needed = Math.ceil((bytes + BACKUP_DISK_RESERVE_BYTES) / MIB);
    if (disk.availableMiB !== null && disk.availableMiB < needed) throw new Error(`Yedek diskinde yer yok: ${needed} MiB gerekli, ${disk.availableMiB} MiB boş. Eski yedekleri taşıyın veya BACKUP_DIR ile başka disk seçin.`);
  }
}
/** "23:41" or "3 Ekim 23:41", Türkiye time. */
const clock = (at: string) => new Date(at).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const dayAndClock = (at: string) => `${new Date(at).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long' })} ${clock(at)}`;

/**
 * Daily automatic backup while the server runs: create, prove it by restoring into a separate folder, delete that
 * plaintext proof copy, and keep one backup a day, a week and a month (server/backup-retention.ts). Runs at night (default
 * 03:30) and once soon after start if the backups are more than a day behind. The automatic run is skipped when the newest
 * verified backup already holds every real change (server/change-marker.ts), but never for more than a week.
 */
export class BackupScheduler {
  private state: BackupStatus;
  private timer?: NodeJS.Timeout;
  /** The run in progress: "Şimdi yedekle" during the automatic run waits for it instead of answering with the old result. */
  private current?: Promise<BackupStatus>;
  private readonly retention: Retention;
  constructor(private dataDir: string, private options: BackupOptions, private now: () => Date = () => new Date()) {
    this.retention = options.retention ?? RETENTION;
    this.state = { running: false, keep: this.keep };
  }
  private get keep() { return this.retention.daily + this.retention.weekly + this.retention.monthly; }
  private get statusPath() { return join(resolve(this.options.backups), STATUS_FILE); }
  async load() {
    try { this.state = { ...JSON.parse(await fs.readFile(this.statusPath, 'utf8')), running: false, keep: this.keep }; } catch { /* first run */ }
    return this.status();
  }
  status(): BackupStatus {
    const packages = this.options.packages?.();
    let safetyCopy: BackupStatus['safetyCopy'];
    try { safetyCopy = this.options.safetyCopy?.(); } catch { /* the status answers without it */ }
    return { ...this.state, ...(packages?.length ? { packages } : {}), ...(safetyCopy ? { safetyCopy } : {}) };
  }
  get folder() { return resolve(this.options.backups); }
  /** A real change (server/app.ts for every write request, platform orders, a demo reset); see server/change-marker.ts. */
  changed() { this.options.changes?.changed(); }
  nextRun(from = this.now()) {
    const next = new Date(from); next.setHours(this.options.hour ?? 3, this.options.minute ?? 30, 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }
  /** Old raw-key backups being sealed in the background after start (tests wait for it). */
  securing: Promise<number> = Promise.resolve(0);
  async start() {
    await this.load();
    // The previous run did not stop cleanly: a write may have missed its mark, so it counts as a change.
    this.options.changes?.open();
    const protection = this.options.protection?.();
    if (protection) this.securing = protectOldBackups(resolve(this.options.backups), resolve(this.options.keys), protection).catch(() => 0);
    // The backup screen's list (Günlük / Haftalık / Aylık) also for backups made by an older version.
    void this.managed(resolve(this.options.backups)).then(list => { const keep = keptBackups(list, this.now(), [], this.retention); this.state.set = list.filter(b => keep.has(b.name)).map(b => ({ at: b.createdAt, tier: mainTier(keep.get(b.name)!) })); }, () => {});
    const last = Date.parse(this.state.currentAt ?? this.state.lastSuccessAt ?? '') || 0;
    // A computer that was off at night still gets its daily backup (or its check) shortly after it is switched on.
    const overdue = this.now().getTime() - last > DAY;
    if (overdue) this.schedule(new Date(this.now().getTime() + 2 * MINUTE), true); else this.schedule(this.nextRun());
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; clearTimeout(this.dayTimer); this.dayTimer = undefined; this.options.cloud?.stop(); this.options.changes?.close(); }
  private schedule(at: Date, catchUp = false) {
    if (this.timer) clearTimeout(this.timer);
    this.state.nextRunAt = at.toISOString();
    // setTimeout cannot wait longer than ~24.8 days; nightly runs never get close.
    this.timer = setTimeout(() => void (this.options.idle?.() ? Promise.resolve() : this.runNow('auto', catchUp)).finally(() => this.schedule(this.nextRun())), Math.max(1000, at.getTime() - this.now().getTime()));
    this.timer.unref();
  }
  /** `catchUp`: the run soon after start (only its wording differs). */
  runNow(reason: BackupReason = 'manual', catchUp = false): Promise<BackupStatus> {
    return this.current ??= this.run(reason, catchUp).finally(() => { this.current = undefined; });
  }
  private dayTimer?: NodeJS.Timeout;
  /**
   * Gün sonu (the final cash closing): a verified backup a minute later, so the day's sales are also off the computer tonight.
   * Several closings within that minute (more businesses) make one backup.
   */
  afterDayClose(delayMs = 60_000) {
    if (this.dayTimer || this.options.idle?.()) return;
    this.dayTimer = setTimeout(() => { this.dayTimer = undefined; void this.runNow('day-close'); }, delayMs);
    this.dayTimer.unref();
  }
  /** The upload started by the last backup (tests wait for it); the backup's own result never waits for Mola Merkez. */
  uploading: Promise<unknown> = Promise.resolve();
  get cloud() { return this.options.cloud; }
  /**
   * The automatic run is not needed when a verified backup made here holds the marker's current state (no real change since
   * it started) and is younger than a week. Answers the status line, or undefined to back up.
   */
  private async notNeeded(backups: string, catchUp: boolean): Promise<string | undefined> {
    const marker = this.options.changes;
    if (!marker || marker.dirty) return undefined;
    const mark = marker.current(), t = this.now().getTime();
    // A copy dated in the future (the clock was set back since) does not count: its age cannot be trusted.
    const holding = (await this.managed(backups)).filter(b => b.proof.changes?.instance === mark.instance && b.proof.changes.seq === mark.seq && Date.parse(b.createdAt) <= t + HOUR)[0];
    if (!holding || t - Date.parse(holding.createdAt) > FORCE_AFTER_MS) return undefined;
    const head = catchUp ? 'Açılış yedeği gerekmedi' : 'Gece yedeği gerekmedi';
    if (businessDay(holding.createdAt) !== businessDay(t)) return `${head}: ${dayAndClock(holding.createdAt)} yedeğinden beri değişiklik yok.`;
    const kind = holding.proof.reason === 'day-close' ? 'gün sonu ' : holding.proof.reason === 'auto' ? 'gece ' : '';
    return `${head}: ${clock(holding.createdAt)} ${kind}yedeği güncel.`;
  }
  private async run(reason: BackupReason = 'manual', catchUp = false): Promise<BackupStatus> {
    this.state.running = true; this.state.lastAttemptAt = this.now().toISOString();
    let stage = 'yedek oluşturma';
    try {
      const paths = await backupPaths(this.dataDir, this.options.backups, this.options.keys);
      const skip = reason === 'auto' ? await this.notNeeded(paths.outputRoot, catchUp).catch(() => undefined) : undefined;
      if (skip) {
        const at = this.now().toISOString();
        // An earlier failed try no longer matters: a verified backup holds everything.
        Object.assign(this.state, { skipped: { at, text: skip }, currentAt: at, lastError: undefined });
        // Weeks and months finish while nothing changes: the kept set still moves on. No backup, so nothing new for the
        // flash drive or Mola Merkez either.
        this.state.kept = await this.prune(paths.outputRoot, paths.keyRoot).catch(() => this.state.kept);
      } else await this.backUp(paths, reason, s => { stage = s; });
    } catch (error) {
      // No private details: the stage and a short reason are enough to act on.
      this.state.lastError = `${stage} başarısız: ${plainError(error, 'beklenmeyen bir sorun oldu.')}`;
    } finally {
      this.state.running = false;
      await fs.mkdir(resolve(this.options.backups), { recursive: true }).catch(() => {});
      await fs.writeFile(this.statusPath, JSON.stringify({ ...this.state, running: false }, null, 2)).catch(() => {});
    }
    return this.status();
  }
  private async backUp(paths: Awaited<ReturnType<typeof backupPaths>>, reason: BackupReason, setStage: (stage: string) => void) {
    if (pathsOverlap(paths.source, resolve(this.options.checks))) throw new Error('Prova klasörü veri klasöründen ayrı olmalı.');
    await this.cleanLeftovers(paths.outputRoot, paths.keyRoot);
    await assertBackupSpace(paths.source, this.options);
    const protection = this.options.protection?.();
    // What this backup holds: taken right before the database is read, so a write after it counts as a new change.
    const changes = this.options.changes?.arm();
    const backup = await createLiveBackup(paths.source, paths.outputRoot, paths.keyRoot, protection, this.now);
    setStage('geri yükleme provası');
    let restored: Awaited<ReturnType<typeof restoreBackup>>;
    // Year packages never change: the proof checks they are there (the weekly check reads them, server/year-packer.ts).
    try { restored = await restoreBackup(backup.directory, protection ? { master: protection.master } : backup.keyPath!, this.options.checks, { packages: 'check' }); }
    catch (error) {
      // Not proven: marked, so the next run clears it away (it is never offered for a restore either).
      await fs.writeFile(join(backup.directory, 'BACKUP_FAILED.txt'), 'Yedek doğrulanamadı. Kullanmayın.').catch(() => {});
      throw error;
    }
    // The proof copy holds open data and keys: it has done its job once verified.
    await fs.rm(restored.directory, { recursive: true, force: true });
    setStage('doğrulama kaydı');
    const order = Math.max(0, ...(await this.managed(paths.outputRoot)).map(b => b.order ?? 0)) + 1;
    await fs.writeFile(join(backup.directory, 'verification.json'), JSON.stringify({ verified: true, checkedAt: this.now().toISOString(), backupDirectory: backup.directory, files: restored.files, automatic: true, reason, order, ...(changes ? { changes } : {}) }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    setStage('eski yedekleri temizleme');
    this.state.kept = await this.prune(paths.outputRoot, paths.keyRoot, backup.directory);
    const at = this.now().toISOString();
    Object.assign(this.state, { lastSuccessAt: at, currentAt: at, lastDirectory: backup.directory, files: restored.files, lastError: undefined, skipped: undefined });
    // The second copy never fails the backup itself: a missing flash drive is a warning, tried again next time.
    if (this.options.second && backup.protected) await this.options.second.copy(backup.directory);
    // Sunucu yedeği: in the background (a slow line must not hold "Şimdi yedekle"); its own status says how it went.
    if (this.options.cloud && backup.protected) this.uploading = this.options.cloud.upload(backup.directory, reason !== 'auto');
    // A catch-up run still waiting (2 minutes after start) is not needed any more: the next one is tonight's.
    if (this.timer && Date.parse(this.state.nextRunAt ?? '') < this.nextRun().getTime()) this.schedule(this.nextRun());
  }
  /** After a new recovery code: backups here and in the second place get the new recovery block. */
  async rewrap(protection: BackupProtection) {
    if (this.state.running) throw new Error('Yedek alınıyor. Bitince yeniden deneyin.');
    const changed = await rewrapBackups([this.folder, ...(this.options.second?.root ? [this.options.second.root] : [])], protection);
    // The newest copy on Mola Merkez gets the new recovery block too (only that one small file travels); older ones there
    // open with the old code.
    const last = this.state.lastDirectory;
    if (this.options.cloud && last) this.uploading = this.options.cloud.upload(last, true);
    return changed;
  }
  get second() { return this.options.second; }
  /**
   * Backups this scheduler made and proved (any version: older ones have no reason or marker), newest first. Manual
   * backups made with the backup command, unfinished and unproven folders are not in the list, so they are never pruned.
   */
  private async managed(backups: string): Promise<Managed[]> {
    let entries: import('node:fs').Dirent[] = [];
    try { entries = await fs.readdir(backups, { withFileTypes: true }); } catch { return []; }
    const out: Managed[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || !BACKUP_NAME.test(e.name)) continue;
      const dir = join(backups, e.name);
      const proof = await fs.readFile(join(dir, 'verification.json'), 'utf8').then(text => JSON.parse(text) as Proof, () => null);
      if (proof?.automatic !== true) continue;
      const completion = await fs.readFile(join(dir, 'complete.json'), 'utf8').then(text => JSON.parse(text) as { createdAt?: unknown }, () => null);
      const createdAt = typeof completion?.createdAt === 'string' && Number.isFinite(Date.parse(completion.createdAt)) ? completion.createdAt : undefined;
      if (createdAt) out.push({ name: e.name, dir, createdAt, order: Number.isSafeInteger(proof.order) ? proof.order : undefined, proof });
    }
    return out.sort(newestFirst);
  }
  /** One per business day, then 7 günlük + 4 haftalık + 3 aylık (server/backup-retention.ts); the one just made always stays. */
  private async prune(backups: string, keys: string, current?: string) {
    const list = await this.managed(backups);
    const keep = keptBackups(list, this.now(), current ? [basename(current)] : [], this.retention);
    for (const b of list) {
      if (keep.has(b.name)) continue;
      await fs.rm(b.dir, { recursive: true, force: true });
      await fs.rm(join(keys, `${b.name}.key`), { force: true });
    }
    this.state.set = list.filter(b => keep.has(b.name)).map(b => ({ at: b.createdAt, tier: mainTier(keep.get(b.name)!) }));
    return keep.size;
  }
  /**
   * What an interrupted run left behind (power cut, crash): a backup folder still marked in progress or failed (it may hold
   * the plain database copy) and proof folders (open data). Never a finished backup, and never anything younger than an hour.
   */
  private async cleanLeftovers(backups: string, keys: string) {
    const old = async (dir: string) => { try { return Date.now() - (await fs.stat(dir)).mtimeMs > LEFTOVER_MS; } catch { return false; } };
    const has = (dir: string, name: string) => fs.stat(join(dir, name)).then(() => true, () => false);
    for (const e of await fs.readdir(backups, { withFileTypes: true }).catch(() => [])) {
      const dir = join(backups, e.name);
      if (!e.isDirectory() || !BACKUP_NAME.test(e.name) || await has(dir, 'verification.json')) continue;
      if (!(await has(dir, 'BACKUP_IN_PROGRESS.txt') || await has(dir, 'BACKUP_FAILED.txt')) || !await old(dir)) continue;
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(join(keys, `${e.name}.key`), { force: true }).catch(() => {});
    }
    const checks = resolve(this.options.checks);
    for (const e of await fs.readdir(checks, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory() && /^restore-/.test(e.name) && await old(join(checks, e.name))) await fs.rm(join(checks, e.name), { recursive: true, force: true }).catch(() => {});
    }
  }
}
