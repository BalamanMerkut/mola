import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DomainError } from '../../packages/domain/engine.js';
import { sqliteJob } from '../backup.js';
import { BACKUP_KEY_FILE, masterFromCode, openBackupKey, readBackupKeyFile, sealBackupKey } from '../backup-key.js';
import { pathsOverlap } from '../backup-paths.js';
import { calibrateKdf, keyCheck, newRecoveryCode, openRecovery, portableRecovery, wrapRecovery, writeAtomic, type BackupProtection, type KdfParams, type RecoveryBlock } from '../key-vault.js';
import { open } from '../sealing.js';
import { MARK_RESTORED } from './store.js';

/*
 * Mola Merkez's own safety net (the vendor's computer can break or be replaced):
 *   merkez-kurtarma.json   in the data folder: Merkez's data key sealed with a recovery code (scrypt + AES-GCM, the same
 *                          scheme as the café's). The code is shown once in Mola Yönetim (this computer only), never stored.
 *   nightly backup         <data>-yedek/merkez-yedek-<time>/: merkez.sqlite (a consistent copy) and the public key file,
 *                          encrypted with a fresh key sealed inside (anahtar-kurtarma.json) by the data key AND by the
 *                          recovery code; proven by opening a restored copy, then the copy goes. Newest KEEP stay.
 *   second place           optional (flash drive, OneDrive folder): every verified backup is copied there too.
 * A new computer: install Mola Yönetim, `npm run merkez:restore -- <yedek> <veri>` (or the same with the installed
 * program) with the recovery code: data, signing key and every licence come back as they were.
 */
export const RECOVERY_FILE = 'merkez-kurtarma.json';
/**
 * Merkez's folders next to its data folder: the installed one (…\veri, /var/lib/mola-merkez/veri) has them as siblings
 * (merkez-yedek, merkez-guncellemeler …), development (.local/merkez) as .local/merkez-yedek, .local/merkez-guncellemeler …
 */
export const besideData = (directory: string, name: string) => basename(directory) === 'veri' ? join(dirname(directory), name) : `${directory}-${name.replace(/^merkez-/, '')}`;
export type RecoveryFile = { v: 1; kind: 'mola-merkez-kurtarma'; merkezId: string; check: string; recovery: RecoveryBlock; createdAt: string; updatedAt: string };
export type RecoveryState = { available: boolean; shown: boolean; confirmed: boolean; createdAt: string | null };
/** merkez-kurtarma.json as it is on disk (undefined: missing or damaged). Its `check` says which data key it belongs to. */
export function readRecoveryFile(directory: string): RecoveryFile | undefined {
  try {
    const value = JSON.parse(readFileSync(join(directory, RECOVERY_FILE), 'utf8')) as RecoveryFile;
    return value.v === 1 && value.kind === 'mola-merkez-kurtarma' && /^[a-f0-9-]{36}$/.test(value.merkezId) && /^[a-f0-9]{32}$/.test(value.check) && !!value.recovery?.wrapped ? value : undefined;
  } catch { return undefined; }
}
/**
 * seed: the recovery block kept in the protected key file (server/merkez/key-guard.ts), used when merkez-kurtarma.json is
 * missing, so a confirmed code is never silently replaced. onChange: every new block (a new code), for that key file.
 */
export type RecoveryHooks = { seed?: { merkezId: string; recovery: RecoveryBlock }; onChange?: (file: RecoveryFile) => void | Promise<void> };

/** The recovery code of Merkez's data key: kept until "Kodu kaydettim" in memory only; a code nobody saw is replaced at start. */
export class MerkezRecovery {
  private pending?: string;
  private constructor(private directory: string, private key: Buffer, private kdf: KdfParams | undefined, public file: RecoveryFile, private hooks: RecoveryHooks = {}) {}
  static async open(directory: string, key: Buffer, kdf?: KdfParams, hooks: RecoveryHooks = {}) {
    const found = readRecoveryFile(directory);
    let file = found && found.check === keyCheck(key) ? found : undefined;
    const recovery = new MerkezRecovery(directory, key, kdf, file ?? { v: 1, kind: 'mola-merkez-kurtarma', merkezId: randomUUID(), check: keyCheck(key), recovery: undefined as unknown as RecoveryBlock, createdAt: new Date().toISOString(), updatedAt: '' }, hooks);
    if (!file && hooks.seed) {
      const now = new Date().toISOString();
      file = { v: 1, kind: 'mola-merkez-kurtarma', merkezId: hooks.seed.merkezId, check: keyCheck(key), recovery: hooks.seed.recovery, createdAt: hooks.seed.recovery.createdAt ?? now, updatedAt: now };
      recovery.write(file);
    }
    // First start, or a code that was never shown (the start that made it ended first): a fresh one, shown in Mola Yönetim.
    if (!file || (!file.recovery.shownAt && !file.recovery.confirmedAt)) await recovery.regenerate();
    return recovery;
  }
  private write(next: RecoveryFile) {
    writeAtomic(join(this.directory, RECOVERY_FILE), JSON.stringify(next, null, 2) + '\n'); this.file = next;
    // "Gösterildi" / "kaydedildi" marks too: a key file that seeds a lost merkez-kurtarma.json must not bring back an unsaved code.
    try { void Promise.resolve(this.hooks.onChange?.(next)).catch(() => {}); } catch { /* tried again with the next change */ }
  }
  async regenerate() {
    const code = newRecoveryCode(), recovery = await wrapRecovery(this.key, code, this.file.merkezId, this.kdf ?? await calibrateKdf());
    if (!(await openRecovery(recovery, code, this.file.merkezId)).equals(this.key)) throw new Error('Yeni kurtarma kodu doğrulanamadı.');
    this.write({ ...this.file, recovery, updatedAt: new Date().toISOString() });
    // A protected key file carries the same block: the new code must open it too, the old one no longer.
    await this.hooks.onChange?.(this.file);
    this.pending = code; return code;
  }
  /**
   * The server's own command (kurtarma-kodu.sh, a VDS where Mola Yönetim never shows the code): a new code made and checked
   * like regenerate(), but written only by commit(), after the vendor typed parts of it back. Before that nothing changes.
   * Committed as shown and saved (the command showed it and checked it), so the next start does not replace it.
   */
  async prepare() {
    const code = newRecoveryCode(), recovery = await wrapRecovery(this.key, code, this.file.merkezId, this.kdf ?? await calibrateKdf());
    if (!(await openRecovery(recovery, code, this.file.merkezId)).equals(this.key)) throw new Error('Yeni kurtarma kodu doğrulanamadı.');
    return {
      code,
      commit: async () => {
        const at = new Date().toISOString();
        this.write({ ...this.file, recovery: { ...recovery, shownAt: at, confirmedAt: at }, updatedAt: at });
        await this.hooks.onChange?.(this.file);
        this.pending = undefined;
      },
    };
  }
  view(): RecoveryState { const r = this.file.recovery; return { available: !!this.pending && !r.confirmedAt, shown: !!r.shownAt, confirmed: !!r.confirmedAt, createdAt: r.createdAt ?? null }; }
  reveal() {
    if (!this.pending || this.file.recovery.confirmedAt) throw new DomainError('NO_CODE', 'Gösterilecek yeni kurtarma kodu yok. Gerekirse “Yeni kurtarma kodu oluştur”u kullanın.', 409);
    if (!this.file.recovery.shownAt) this.write({ ...this.file, recovery: { ...this.file.recovery, shownAt: new Date().toISOString() } });
    return this.pending;
  }
  confirm() {
    const now = new Date().toISOString();
    if (!this.file.recovery.confirmedAt) this.write({ ...this.file, recovery: { ...this.file.recovery, shownAt: this.file.recovery.shownAt ?? now, confirmedAt: now } });
    this.pending = undefined;
  }
  protection(): BackupProtection { return { master: this.key, recovery: portableRecovery(this.file.recovery), installId: this.file.merkezId }; }
  /**
   * "Şifremi unuttum": whether `code` is the current recovery code (it opens this Merkez's own key). A malformed code throws
   * INVALID_CODE at once (no scrypt); a wrong one answers false after the full scrypt time; the key comparison is constant-time.
   */
  async matches(code: string) {
    let opened: Buffer;
    try { opened = await openRecovery(this.file.recovery, code, this.file.merkezId); }
    catch (error) { if (error instanceof DomainError && error.code === 'WRONG_CODE') return false; throw error; }
    try { return opened.length === this.key.length && timingSafeEqual(opened, this.key); } finally { opened.fill(0); }
  }
}

// ---------- Backup files ----------
type Entry = { path: string; blob: string; size: number; hash: string };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function encrypt(plain: Buffer, key: Buffer, aad: string) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad));
  return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]);
}
function decrypt(data: Buffer, key: Buffer, aad: string) {
  const d = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); d.setAAD(Buffer.from(aad)); d.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([d.update(data.subarray(12, data.length - 16)), d.final()]);
}
const NAME = /^merkez-yedek-\d{4}-\d{2}-\d{2}T[\w-]+$/;
/** Opens the files of one backup into `target` (new or empty) and checks them; returns the data key it was opened with. */
async function unpack(backup: string, secret: { master: Buffer } | { code: string }, target: string) {
  if (!existsSync(join(backup, 'complete.json')) || existsSync(join(backup, 'YEDEK_SURUYOR.txt'))) throw new DomainError('BACKUP_INCOMPLETE', 'Bu yedek tamamlanmamış. Başka bir yedek seçin.', 409);
  const wrapper = await readBackupKeyFile(backup);
  if (!wrapper) throw new DomainError('BACKUP_INCOMPLETE', 'Yedeğin anahtar kaydı yok.', 409);
  const master = 'master' in secret ? secret.master : await masterFromCode(wrapper, secret.code), key = openBackupKey(wrapper, master);
  const manifest = JSON.parse(decrypt(await fs.readFile(join(backup, 'manifest.bin')), key, 'mola-merkez-yedek-v1').toString('utf8')) as { format: 1; kind: 'merkez'; createdAt: string; files: Entry[] };
  if (manifest.format !== 1 || manifest.kind !== 'merkez' || !manifest.files.some(f => f.path === 'merkez.sqlite')) throw new Error('Yedek biçimi geçersiz.');
  await fs.mkdir(target, { recursive: true });
  for (const f of manifest.files) {
    if (!/^[\w.-]+$/.test(f.path) || !/^\d+\.bin$/.test(f.blob)) throw new Error('Yedek dosya listesi geçersiz.');
    const plain = decrypt(await fs.readFile(join(backup, f.blob)), key, f.path);
    if (plain.length !== f.size || sha(plain) !== f.hash) throw new Error('Yedek bütünlüğü doğrulanamadı.');
    await fs.writeFile(join(target, f.path), plain, { flag: 'wx', mode: 0o600 });
  }
  return { master, recovery: wrapper.recovery, merkezId: wrapper.installId };
}
/** A restored or proof copy really opens: the registry and the signing key unseal with this data key. */
function proveOpens(directory: string, master: Buffer) {
  const db = new DatabaseSync(join(directory, 'merkez.sqlite'), { readOnly: true });
  try {
    if (String(Object.values(db.prepare('PRAGMA quick_check').get() ?? {})[0]) !== 'ok') throw new Error('Veritabanı bütünlüğü bozuk.');
    const main = db.prepare('SELECT payload FROM merkez WHERE id=1').get() as { payload: Uint8Array } | undefined, signing = db.prepare('SELECT payload FROM signing WHERE id=1').get() as { payload: Uint8Array } | undefined;
    if (!main || !signing) throw new Error('Yedekte Merkez kaydı veya imza anahtarı yok.');
    const data = open<{ businesses: unknown[] }>(Buffer.from(main.payload), master, 'merkez'), pair = open<{ publicKey: string }>(Buffer.from(signing.payload), master, 'merkez-signing');
    return { businesses: data.businesses.length, publicKey: pair.publicKey };
  } finally { db.close(); }
}

export type MerkezBackupStatus = { running: boolean; auto: boolean; folder: string; keep: number; lastAttemptAt?: string; lastSuccessAt?: string; lastError?: string; nextRunAt?: string; kept?: number; files?: number; second: { folder: string | null; lastCopyAt?: string; lastError?: string } };
/** `onAutomatic`: the nightly (timer) backup finished, for İşlem kayıtları ("Şimdi yedekle" is written by its own route). */
export type MerkezBackupOptions = { folder: string; checks: string; keep?: number; hour?: number; minute?: number; auto?: boolean; settings: string; protection: () => BackupProtection; onFailure?: (message: string) => void; onAutomatic?: (status: MerkezBackupStatus) => void; now?: () => Date };
const STATUS = 'merkez-yedek-durum.json', SECOND = 'Mola-Merkez-Yedek', SECOND_KEEP = 7, DAY = 86400000;

/** Nightly verified backup of Merkez (default 03:45; at start when the last good one is older than a day). */
export class MerkezBackups {
  private state: Omit<MerkezBackupStatus, 'second'> & { second?: MerkezBackupStatus['second'] };
  private timer?: NodeJS.Timeout; private secondFolder: string | null = null;
  private now: () => Date;
  constructor(private dataDir: string, private o: MerkezBackupOptions) {
    this.now = o.now ?? (() => new Date());
    this.state = { running: false, auto: o.auto ?? true, folder: resolve(o.folder), keep: Math.max(2, Math.min(60, o.keep ?? 14)) };
    if (pathsOverlap(resolve(dataDir), resolve(o.folder)) || pathsOverlap(resolve(dataDir), resolve(o.checks))) throw new Error('Merkez yedek klasörü veri klasöründen ayrı olmalı.');
  }
  async start() {
    try { const saved = JSON.parse(await fs.readFile(join(this.state.folder, STATUS), 'utf8')); this.state = { ...saved, running: false, auto: this.state.auto, folder: this.state.folder, keep: this.state.keep }; } catch { /* first run */ }
    try { this.secondFolder = (JSON.parse(await fs.readFile(this.o.settings, 'utf8')) as { second: string | null }).second; } catch { this.secondFolder = null; }
    if (!this.state.auto) return;
    const last = this.state.lastSuccessAt ? Date.parse(this.state.lastSuccessAt) : 0;
    this.schedule(this.now().getTime() - last > DAY ? new Date(this.now().getTime() + 2 * 60_000) : this.nextRun());
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  nextRun(from = this.now()) { const next = new Date(from); next.setHours(this.o.hour ?? 3, this.o.minute ?? 45, 0, 0); if (next <= from) next.setDate(next.getDate() + 1); return next; }
  private schedule(at: Date) {
    this.stop(); this.state.nextRunAt = at.toISOString();
    this.timer = setTimeout(() => void this.runNow().then(s => { try { this.o.onAutomatic?.(s); } catch { /* the status says it */ } }).finally(() => this.schedule(this.nextRun())), Math.max(1000, at.getTime() - this.now().getTime()));
    this.timer.unref();
  }
  status(): MerkezBackupStatus { return { ...this.state, second: { ...(this.state.second ?? {}), folder: this.secondFolder } }; }
  /** "İkinci yedek yeri": a folder (flash drive, OneDrive); null turns it off. The folder must exist (a drive plugged in). */
  async setSecond(folder: string | null) {
    if (folder !== null) {
      const path = resolve(folder);
      if (pathsOverlap(path, resolve(this.dataDir)) || pathsOverlap(path, this.state.folder)) throw new DomainError('SECOND_PLACE', 'İkinci yedek yeri veri ve yedek klasörlerinden ayrı olmalı.', 400);
      if (!(await fs.stat(path).then(s => s.isDirectory(), () => false))) throw new DomainError('SECOND_PLACE', 'Bu klasör bulunamadı. Flash belleği takıp yeniden deneyin.', 400);
      folder = path;
    }
    this.secondFolder = folder;
    writeAtomic(this.o.settings, JSON.stringify({ second: folder }) + '\n');
    return this.status();
  }
  async runNow(): Promise<MerkezBackupStatus> {
    if (this.state.running) return this.status();
    this.state.running = true; this.state.lastAttemptAt = this.now().toISOString();
    let stage = 'yedek oluşturma';
    try {
      const protection = this.o.protection(), id = `merkez-yedek-${this.now().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
      const target = join(this.state.folder, id), progress = join(target, 'YEDEK_SURUYOR.txt');
      await fs.mkdir(target, { recursive: true }); await fs.writeFile(progress, 'Yedek henüz tamamlanmadı.');
      const key = randomBytes(32), snapshot = join(target, '.merkez.sqlite');
      try {
        await sqliteJob({ vacuum: [join(this.dataDir, 'merkez.sqlite'), snapshot] });
        const files: [string, Buffer][] = [['merkez.sqlite', await fs.readFile(snapshot)]];
        const publicKey = join(this.dataDir, 'merkez-public-key.txt'); if (existsSync(publicKey)) files.push(['merkez-public-key.txt', await fs.readFile(publicKey)]);
        await fs.rm(snapshot, { force: true });
        const entries: Entry[] = [];
        for (const [path, plain] of files) { const blob = `${entries.length}.bin`; await fs.writeFile(join(target, blob), encrypt(plain, key, path), { flag: 'wx', mode: 0o600 }); entries.push({ path, blob, size: plain.length, hash: sha(plain) }); }
        await fs.writeFile(join(target, 'manifest.bin'), encrypt(Buffer.from(JSON.stringify({ format: 1, kind: 'merkez', createdAt: this.now().toISOString(), files: entries })), key, 'mola-merkez-yedek-v1'), { flag: 'wx', mode: 0o600 });
        await fs.writeFile(join(target, BACKUP_KEY_FILE), JSON.stringify(sealBackupKey(id, key, protection), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        await fs.writeFile(join(target, 'complete.json'), JSON.stringify({ format: 1, kind: 'merkez', createdAt: this.now().toISOString(), files: entries.length }));
        await fs.rm(progress, { force: true });
      } catch (error) { await fs.rm(target, { recursive: true, force: true }).catch(() => {}); throw error; }
      // Proof: opened in a separate folder with the data key, the registry and the signing key unseal; then the copy goes.
      stage = 'geri yükleme provası';
      const check = join(this.o.checks, `prova-${randomUUID().slice(0, 8)}`);
      try { const opened = await unpack(target, { master: protection.master }, check); proveOpens(check, opened.master); }
      finally { await fs.rm(check, { recursive: true, force: true }).catch(() => {}); }
      await fs.writeFile(join(target, 'verification.json'), JSON.stringify({ verified: true, checkedAt: this.now().toISOString(), automatic: true }) + '\n');
      stage = 'eski yedekleri temizleme';
      const names = (await fs.readdir(this.state.folder, { withFileTypes: true })).filter(e => e.isDirectory() && NAME.test(e.name)).map(e => e.name).sort().reverse();
      for (const name of names.slice(this.state.keep)) if (name !== id) await fs.rm(join(this.state.folder, name), { recursive: true, force: true });
      Object.assign(this.state, { lastSuccessAt: this.now().toISOString(), lastError: undefined, kept: Math.min(names.length, this.state.keep), files: 2 });
      // The second place never fails the backup itself: a missing drive is noted and tried again next time.
      if (this.secondFolder) await this.copySecond(target, id);
    } catch (error) {
      this.state.lastError = `${stage} başarısız: ${error instanceof Error ? error.message.slice(0, 160) : 'bilinmeyen hata'}`;
      try { this.o.onFailure?.(this.state.lastError); } catch { /* the status still says it */ }
    } finally {
      this.state.running = false;
      await fs.mkdir(this.state.folder, { recursive: true }).catch(() => {});
      await fs.writeFile(join(this.state.folder, STATUS), JSON.stringify({ ...this.state, running: false }, null, 2)).catch(() => {});
    }
    return this.status();
  }
  /** After a new recovery code: the backups here and in the second place open with it too. */
  async rewrap(protection: BackupProtection) {
    let changed = 0;
    for (const root of [this.state.folder, ...(this.secondFolder ? [join(this.secondFolder, SECOND)] : [])]) {
      const names = await fs.readdir(root, { withFileTypes: true }).then(list => list.filter(e => e.isDirectory() && NAME.test(e.name)).map(e => e.name), () => [] as string[]);
      for (const name of names) {
        try {
          const file = await readBackupKeyFile(join(root, name));
          if (!file || file.installId !== protection.installId) continue;
          openBackupKey(file, protection.master);
          writeAtomic(join(root, name, BACKUP_KEY_FILE), JSON.stringify({ ...file, recovery: portableRecovery(protection.recovery) }, null, 2) + '\n'); changed++;
        } catch { /* damaged or foreign: left as it is */ }
      }
    }
    return changed;
  }
  private async copySecond(source: string, id: string) {
    const root = join(this.secondFolder!, SECOND), target = join(root, id), temp = `${target}.kopyalaniyor`;
    try {
      if (!(await fs.stat(this.secondFolder!).then(s => s.isDirectory(), () => false))) throw new Error('İkinci yedek yeri takılı değil.');
      await fs.mkdir(temp, { recursive: true });
      for (const name of await fs.readdir(source)) { const from = await fs.readFile(join(source, name)); await fs.writeFile(join(temp, name), from); if (sha(await fs.readFile(join(temp, name))) !== sha(from)) throw new Error('Kopya doğrulanamadı.'); }
      await fs.rename(temp, target);
      const names = (await fs.readdir(root, { withFileTypes: true })).filter(e => e.isDirectory() && NAME.test(e.name)).map(e => e.name).sort().reverse();
      for (const name of names.slice(SECOND_KEEP)) await fs.rm(join(root, name), { recursive: true, force: true });
      this.state.second = { folder: this.secondFolder, lastCopyAt: this.now().toISOString() };
    } catch (error) {
      await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
      this.state.second = { folder: this.secondFolder, ...(this.state.second?.lastCopyAt ? { lastCopyAt: this.state.second.lastCopyAt } : {}), lastError: error instanceof Error ? error.message.slice(0, 160) : 'kopyalanamadı' };
    }
  }
}

/**
 * New computer: one Merkez backup + its recovery code → a working Merkez data folder (`target` must not exist or be empty).
 * Writes the data key as development.key (Merkez runs without OS key protection), the recovery file (code already known),
 * and a marker: at the next start every licence is signed again with a much higher serial, so cafés that already hold a
 * licence newer than this backup accept the restored Merkez's next one.
 */
export async function restoreMerkezBackup(backup: string, code: string, target: string) {
  target = resolve(target);
  if (existsSync(target) && (await fs.readdir(target)).length) throw new DomainError('NOT_EMPTY', 'Hedef klasör boş değil. Yeni bir klasör seçin.', 409);
  const opened = await unpack(resolve(backup), { code }, target);
  try {
    const proof = proveOpens(target, opened.master);
    await fs.writeFile(join(target, 'development.key'), opened.master, { flag: 'wx', mode: 0o600 });
    const now = new Date().toISOString();
    writeAtomic(join(target, RECOVERY_FILE), JSON.stringify({ v: 1, kind: 'mola-merkez-kurtarma', merkezId: opened.merkezId, check: keyCheck(opened.master), recovery: { ...opened.recovery, shownAt: now, confirmedAt: now }, createdAt: now, updatedAt: now } satisfies RecoveryFile, null, 2) + '\n');
    writeAtomic(join(target, MARK_RESTORED), JSON.stringify({ restoredAt: now, from: resolve(backup) }) + '\n');
    return proof;
  } catch (error) { await fs.rm(target, { recursive: true, force: true }).catch(() => {}); throw error; }
}
