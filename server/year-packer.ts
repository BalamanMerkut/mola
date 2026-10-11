import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import type { State } from '../packages/domain/types.js';
import { addDays, businessDay, dayStart } from '../packages/domain/business-day.js';
import { PACKAGE_PRIVACY_TEXT } from '../packages/domain/package-privacy.js';
import { drainSlowly } from './history.js';
import { sqliteJob } from './backup.js';
import { markDataVersion } from './data-version.js';
import { openText, sealText } from './sealing.js';
import { withoutPersonalData } from './package-privacy.js';
import { blobName, encryptedDigest, PACKAGE_DATA_VERSION, PACKAGE_TABLES, packageFile, rangeMask, rowColumns, rowKey, STRIPPED_TABLE, type Mask, type PackageInfo, type PackageJob } from './year-packages.js';
import { snapshotKey, type Store } from './store.js';

/*
 * The yearly packaging (Faz 4; server/year-packages.ts). From 1 February the previous calendar year is sealed into
 * `yil-<year>.sqlite`, the oldest year first ("year by year": data restored from an old backup gets every past year, one after
 * the other). Every step leaves a mark, so a crash or a pulled plug at any point goes on from there at the next start:
 *
 *   0. Preconditions: nothing of the year still open (a bill on the floor, an unclosed kasa day), the one-time rewrite of data
 *      version 3 done; a verified backup first; before the very first package a readable copy of the data folder (data
 *      version 3) beside it, like every earlier data migration.
 *   1. 'closing' (history_meta 'package:job'): from here every write into the year is refused (packages/domain/closed-year.ts).
 *      Day summaries, payment lists and monthly/yearly roll-ups of the year are built (in slices), the stock of every item on
 *      1 January is written as its opening count, then a worker thread copies the rows unchanged into `yil-<year>.sqlite.tmp`
 *      (ATTACH + INSERT … SELECT in one read snapshot). Customers' personal data leaves the copy (server/package-privacy.ts):
 *      the rows that can hold some are opened in slices on this thread, a changed one is sealed again under the same scope,
 *      read back, and noted in `package_stripped` (its key, the SHA-256 of the live row, the SHA-256 of its new JSON). A
 *      second worker then checks every row against the live one in key order (the same bytes, or a stripped row whose live
 *      row has exactly the noted SHA-256), SQLite's own check, and gives the file's SHA-256. The file is renamed into place.
 *   2. 'sealed': in one transaction the package is registered (SHA-256, row counts) and the data is marked version 4 (older
 *      app versions refuse it instead of misreading it). Readers take the package from now on, live rows of its range are
 *      left out of every read while they go.
 *   3. The year's rows leave the live file in small batches (each its own transaction; only rows that are byte for byte in
 *      the package, or the very row a stripped one came from), then the job ends; the freed pages go back to the disk with a
 *      VACUUM at the next start.
 * The owner gets one notice: "2025 yılı kapandı ve paketlendi." The readable copy of the first package's step 0 goes 90 days
 * later, once a verified backup is newer than that packaging (removeSafetyCopy; the backup screen says when).
 */
export type PackerHooks = {
  /** A verified backup right before a year closes (BackupScheduler.runNow); ok false postpones. */
  backup?: () => Promise<{ ok: boolean; error?: string }>;
  /** The cash and staff roll-ups of [from, to] for one business (report-export reportSteps; History builds the sales ones). */
  prepare?: (tenant: string, s: State, from: string, to: string) => Generator<void, void>[];
  /** Stock: every item's stock at `t0` as its opening count (StockBook.openYearSteps: in slices). */
  opening?: (tenant: string, s: State, t0: number, year: string) => Generator<void, unknown> | unknown;
  /** What else keeps the year open for this business (an unclosed kasa day, an open shift): the owner's sentences. */
  blockers?: (tenant: string, s: State, end: string) => string[];
  notify?: (tenant: string, key: string, title: string, text: string) => void;
  /** An update was installed in the last days: no packaging yet (a bad update can still be rolled back by hand). */
  recentUpdate?: () => boolean;
  /** The café is quiet (no open table, no order in the kitchen). */
  idle?: () => boolean;
  /** After a year was sealed: a backup with the new package (and its copies to the flash drive and Mola Merkez). */
  after?: (year: string) => void;
  /** When the last verified backup was made (BackupScheduler lastSuccessAt): the readable copy goes only after a newer one. */
  verifiedBackupAt?: () => string | undefined | null;
};
export type PackerStatus = { state: 'idle' | 'waiting' | 'running' | 'failed'; year?: string; step?: string; reasons?: string[]; error?: string; at?: string; done?: string[] };
/** Kill points for tests: the run throws there, as if the process died (the next run goes on from the marks). */
export type CrashPoint = 'closing' | 'prepared' | 'opened' | 'copied' | 'stripping' | 'stripped' | 'renamed' | 'sealed' | 'deleting' | 'deleted';
const DAY_MS = 86400_000;
/** The readable copy made before the very first package (data version 3, customers' personal data included) is kept this long. */
export const SAFETY_COPY_MS = 90 * DAY_MS;
/** The "-tasima-oncesi-v3-" copies beside a data folder (normally one). */
export function safetyCopies(directory: string) {
  const dir = resolve(directory), prefix = `${basename(dir)}-tasima-oncesi-v3-`;
  try { return readdirSync(dirname(dir)).filter(name => name.startsWith(prefix)).map(name => join(dirname(dir), name)); } catch { return []; }
}
/** When the readable copy goes (the backup screen's line): 90 days after the first package was sealed; none before one or without a copy. */
export function safetyCopyView(store: Pick<Store, 'directory' | 'packages'>): { removeAt: string } | undefined {
  const first = store.packages.list().map(p => Date.parse(p.sealedAt)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  if (first === undefined || !safetyCopies(store.directory).length) return undefined;
  return { removeAt: new Date(first + SAFETY_COPY_MS).toISOString() };
}
/** Packaging waits this long after an installed update. */
export const AFTER_UPDATE_MS = 7 * DAY_MS;
/** A café never quiet (open day and night) is packaged anyway after waiting this long. */
const WAIT_IDLE_MS = 7 * DAY_MS;

export class YearPacker {
  status: PackerStatus = { state: 'idle' };
  private running?: Promise<PackerStatus>;
  private waitingSince?: number;
  /** Rows per transaction while the live rows leave, and the pause between them (tests use smaller ones). */
  batch = 500; pauseMs = 2;
  constructor(private store: Store, private hooks: PackerHooks = {}, private now: () => Date = () => new Date()) {}
  private get packages() { return this.store.packages; }
  private tenants() { return (this.store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).map(r => r.tenant); }
  /** The first business day holding a dated record in the live file at or after `from` (null: none). */
  private firstDay(from: string) {
    const days: string[] = [];
    // Per business (and kind), so each MIN is one step down its day index, never a scan of the table.
    const lookups: [string, string | null, string[]][] = [['history_archives', null, ['']], ['history_ledger', 'kind', ['expense', 'adjustment']], ['cash_records', 'kind', ['opening', 'movement', 'closing', 'handover', 'correction', 'tip']], ['staff_shifts', null, ['']], ['staff_activity', null, ['']], ['reservation_records', 'kind', ['reservation', 'event']]];
    for (const [table, kindColumn, kinds] of lookups) {
      if (!this.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      const query = this.store.db.prepare(`SELECT MIN(day) AS d FROM ${table} WHERE tenant=? AND ${kindColumn ? `${kindColumn}=? AND ` : ''}day >= ?`);
      for (const tenant of this.tenants()) for (const kind of kinds) {
        const v = (query.get(...(kindColumn ? [tenant, kind, from] : [tenant, from])) as { d: string | null }).d;
        if (v) days.push(v);
      }
    }
    return days.sort()[0] ?? null;
  }
  /** The year to seal now: the oldest one with records whose 1 February has come (or the one in progress); null: none. */
  dueYear(): string | null {
    const job = this.packages.job();
    if (job) return job.year;
    const first = this.firstDay(this.packages.nextFrom());
    if (!first) return null;
    const year = first.slice(0, 4), today = businessDay(this.now().getTime());
    return today >= `${Number(year) + 1}-02-01` ? year : null;
  }
  /**
   * The minute-by-hour check (server/app.ts): a due year is sealed when the café is quiet (or has waited a week for it), never
   * in the week after an update. A started one always goes on.
   */
  async tick(): Promise<PackerStatus> {
    if (this.running) return this.running;
    await this.removeSafetyCopy().catch(error => console.warn(`Paketlemeden önceki kopya silinemedi: ${error instanceof Error ? error.message : error}`));
    const year = this.dueYear();
    if (!year) { this.waitingSince = undefined; return this.status; }
    if (!this.packages.job()) {
      if (this.hooks.recentUpdate?.()) { this.wait(year, ['Son güncellemenin ilk haftası bekleniyor.'], false); return this.status; }
      const t = this.now().getTime(); this.waitingSince ??= t;
      if (this.hooks.idle && !this.hooks.idle() && t - this.waitingSince < WAIT_IDLE_MS) { this.wait(year, ['Kafe açık; kapanınca paketlenecek.'], false); return this.status; }
    }
    return this.run();
  }
  /** Seals every due year, oldest first (one: only the oldest; measuring). One run at a time. */
  run(options: { crashAt?: CrashPoint; one?: boolean } = {}): Promise<PackerStatus> {
    return this.running ??= (async () => {
      const done: string[] = [];
      try {
        for (let year = this.dueYear(); year; year = options.one ? null : this.dueYear()) {
          if (!await this.pack(year, options.crashAt)) return this.status;
          done.push(year);
        }
        this.status = { state: 'idle', at: this.now().toISOString(), ...(done.length ? { done } : {}) };
      } catch (error) {
        this.status = { state: 'failed', year: this.packages.job()?.year, error: error instanceof Error ? error.message : String(error), at: this.now().toISOString() };
        if (!options.crashAt) console.warn(`Yıl paketi hazırlanamadı: ${this.status.error}`);
        if (options.crashAt) throw error;
      } finally { this.running = undefined; }
      return this.status;
    })();
  }
  private wait(year: string, reasons: string[], notify = true) {
    this.status = { state: 'waiting', year, reasons, at: this.now().toISOString() };
    if (notify) {
      const key = createHash('sha256').update(reasons.join('\n')).digest('hex').slice(0, 12);
      for (const tenant of this.tenants()) this.hooks.notify?.(tenant, `year-waiting:${year}:${key}`, `${year} yılı henüz paketlenemedi`, `${reasons.join(' ')} ${year} yılının kayıtları paketlenince raporlarda aynen görünür; o yıla geriye dönük kayıt yapılamaz.`);
    }
    return false;
  }
  /** What keeps the year open, in the owner's words (empty: nothing). */
  blockers(year: string) {
    const end = `${year}-12-31`, t0 = dayStart(addDays(end, 1)), old = (iso?: string) => !!iso && Date.parse(iso) < t0, out: string[] = [];
    for (const tenant of this.tenants()) {
      // Paid tables settle into history with any write (History.settle); one empty write lets those of the year go first.
      this.store.mutate(tenant, () => {});
      const s = this.store.read(tenant);
      const tables = new Set([...s.accounts.filter(a => a.status === 'open' && (old(a.openedAt) || s.orders.some(o => o.accountId === a.id && old(o.createdAt)))).map(a => s.tables.find(t => t.id === a.tableId)?.name ?? 'Masasız sipariş'),
        ...s.archives.filter(a => old(a.closedAt) || a.payments.some(p => old(p.createdAt))).map(a => a.tableName)]);
      if (tables.size || s.orders.some(o => old(o.createdAt)) || s.payments.some(p => old(p.createdAt))) out.push(`${year} yılından açık kalan hesap var${tables.size ? ` (${[...tables].slice(0, 3).join(', ')})` : ''}. Hesap kapanınca yıl kendiliğinden paketlenir.`);
      out.push(...this.hooks.blockers?.(tenant, s, end) ?? []);
    }
    return [...new Set(out)];
  }
  private crash(point: CrashPoint, at?: CrashPoint) { if (point === at) throw new Error(`Deneme: ${point} adımında kesildi.`); }
  /** MOLA_YIL_PAKETI_IZ=1: each step's start in the server log (measuring, docs/HIZ_TESTI_5_YIL.md). */
  private trace(text: string) { if (process.env.MOLA_YIL_PAKETI_IZ === '1') console.log(`[yıl paketi ${new Date().toISOString().slice(11, 23)}] ${text}`); }

  /** One year, from wherever its job stands. False: it waits (the reason is in the status). */
  private async pack(year: string, crashAt?: CrashPoint): Promise<boolean> {
    let job = this.packages.job();
    if (!job) {
      const reasons = this.blockers(year);
      if (reasons.length) return this.wait(year, reasons);
      this.status = { state: 'running', year, step: 'yedek', at: this.now().toISOString() };
      // The one-time rewrite of data version 3 (History.compact, in slices) finishes first: packages hold packed rows only.
      if (this.store.history.packing && !this.packages.meta('packed:complete')) await this.store.history.compact();
      if (this.hooks.backup) { const b = await this.hooks.backup(); if (!b.ok) return this.wait(year, [`Önce yedek alınamadı${b.error ? ` (${b.error})` : ''}; yeniden denenecek.`]); }
      if (!this.packages.list().length && !this.store.hasCopy(3)) {
        try { await this.readableCopy(); } catch (error) { return this.wait(year, [`Paketlemeden önceki kopya alınamadı (${(error as Error).message}); yeniden denenecek.`]); }
      }
      const from = this.packages.nextFrom(), to = `${year}-12-31`;
      job = { v: 1, year, from, to, t0: dayStart(addDays(to, 1)), step: 'closing', startedAt: this.now().toISOString() };
      this.packages.setMeta('package:job', JSON.stringify(job)); this.packages.refresh();
    }
    this.crash('closing', crashAt);
    if (job.step === 'closing') {
      this.status = { state: 'running', year, step: 'özetler', at: this.now().toISOString() };
      this.trace(`${year}: özetler`); await this.prepare(job);
      this.crash('prepared', crashAt);
      this.trace(`${year}: stok açılışı`);
      for (const tenant of this.tenants()) { const steps = this.hooks.opening?.(tenant, this.store.read(tenant), job.t0, String(Number(year) + 1)); if (steps && typeof (steps as Generator).next === 'function') await drainSlowly(steps as Generator<void, unknown>, () => false); }
      this.crash('opened', crashAt);
      this.status.step = 'kopya';
      const target = this.packages.path(year), temp = `${target}.tmp`;
      this.packages.closeShard(year);
      for (const f of [target, temp, `${temp}-journal`, `${temp}-wal`, `${temp}-shm`]) rmSync(f, { force: true });
      const live = join(this.store.directory, 'merchant.sqlite');
      this.trace(`${year}: kopya`); await copyYear(live, temp, job);
      this.crash('copied', crashAt);
      this.status.step = 'kişisel bilgiler';
      this.trace(`${year}: kişisel bilgiler`); await this.strip(temp, crashAt);
      this.crash('stripped', crashAt);
      this.status.step = 'doğrulama';
      this.trace(`${year}: doğrulama`); const copied = await verifyYear(live, temp, job);
      renameSync(temp, target);
      this.crash('renamed', crashAt);
      this.trace(`${year}: şifreli özet`); const enc = await encryptedDigest(target, this.store.key, { year, sha256: copied.sha256 });
      this.trace(`${year}: kayıt`);
      const info: PackageInfo = { v: 1, year, file: packageFile(year), sha256: copied.sha256, size: copied.size, from: job.from, to: job.to, t0: job.t0, counts: copied.counts, tenants: this.tenants(), sealedAt: this.now().toISOString(), ...enc, stripped: copied.stripped };
      const sealed: PackageJob = { ...job, step: 'sealed', removed: 0 };
      this.store.db.exec('BEGIN IMMEDIATE');
      try {
        this.packages.setMeta(`package:${year}`, JSON.stringify(info));
        this.packages.setMeta('package:job', JSON.stringify(sealed));
        if (Number(this.store.db.prepare('PRAGMA user_version').get()?.user_version) < PACKAGE_DATA_VERSION) markDataVersion(this.store.db, PACKAGE_DATA_VERSION);
        this.store.db.exec('COMMIT');
      } catch (e) { this.store.db.exec('ROLLBACK'); throw e; }
      this.packages.refresh(); this.store.history.packaged();
      job = sealed;
    }
    this.crash('sealed', crashAt);
    this.status = { state: 'running', year, step: 'temizlik', at: this.now().toISOString() };
    this.trace(`${year}: canlıdan silme`); await this.removeLive(job, crashAt); this.trace(`${year}: bitti (en uzun silme adımı ${Math.round(this.longest)} ms)`);
    this.crash('deleted', crashAt);
    this.store.db.exec('BEGIN IMMEDIATE');
    try { this.packages.setMeta('package:job', null); this.packages.setMeta('package:reclaim', year); this.store.db.exec('COMMIT'); }
    catch (e) { this.store.db.exec('ROLLBACK'); throw e; }
    this.packages.refresh(); this.store.history.packaged();
    for (const tenant of this.packages.get(year)?.tenants ?? this.tenants()) this.hooks.notify?.(tenant, `year-closed:${year}`, `${year} yılı kapandı ve paketlendi.`, `${year} yılının satışları, kasası, giderleri ve diğer kayıtları ayrı, değişmeyen bir yıl paketine taşındı; raporlarda aynen görünür. ${PACKAGE_PRIVACY_TEXT} Bu yıla geriye dönük kayıt yapılamaz; o yıldan bir hesabın iadesi bugünün kaydı olarak girer.`);
    this.hooks.after?.(year);
    return true;
  }
  /**
   * Every week each package's SHA-256 (YearPackages.verifyFiles), every month one package opened row by row (the one opened
   * longest ago). A missing or damaged one is put back from an encrypted copy: this computer's backups (yillar/), the second
   * place (flash drive), else Mola Merkez; the owner hears about it either way. Returns the problems found.
   */
  async checkPackages(source: { folders: () => string[]; cloud?: (sha256: string, size: number, target: string) => Promise<boolean>; force?: boolean }) {
    const t = this.now(), list = this.packages.list(), last = Date.parse(this.packages.meta('package:checked') ?? '');
    if (!list.length || this.packages.job() || (!source.force && Number.isFinite(last) && t.getTime() - last < 7 * DAY_MS)) return [];
    const problems = await this.packages.verifyFiles(t);
    const opened = Date.parse(this.packages.meta('package:opened') ?? '');
    if (source.force || !Number.isFinite(opened) || t.getTime() - opened >= 30 * DAY_MS) {
      const year = [...list].sort((a, b) => (this.packages.meta(`package:opened:${a.year}`) ?? '').localeCompare(this.packages.meta(`package:opened:${b.year}`) ?? '') || a.year.localeCompare(b.year))[0].year;
      if (!problems.some(p => p.year === year)) {
        try { await this.packages.openCheck(year, tenant => snapshotKey(this.store.db, this.store.key, tenant), t); }
        catch (error) { problems.push({ year, error: (error as Error).message }); }
      }
      this.packages.setMeta('package:opened', t.toISOString()); this.packages.setMeta(`package:opened:${year}`, t.toISOString());
    }
    for (const p of problems) {
      let from = await this.packages.repair(p.year, source.folders(), this.store.key).catch(() => undefined);
      const info = this.packages.get(p.year);
      if (!from && source.cloud && info?.encSha256 && info.encSize) {
        // Beside the data folder, never inside it: a backup meanwhile must not take a half-downloaded copy along.
        const folder = `${resolve(this.store.directory)}-yil-${p.year}-indirme`;
        try {
          mkdirSync(folder, { recursive: true });
          if (await source.cloud(info.encSha256, info.encSize, join(folder, blobName(info)))) from = (await this.packages.repair(p.year, [folder], this.store.key)) && 'Mola Merkez';
        } catch { /* reported below */ } finally { rmSync(folder, { recursive: true, force: true }); }
      }
      this.store.history.packaged();
      for (const tenant of this.tenants()) this.hooks.notify?.(tenant, `year-check:${p.year}:${t.toISOString().slice(0, 10)}`, from ? `${p.year} yıl paketi onarıldı` : `${p.year} yıl paketi bozuk ya da eksik`,
        from ? `Haftalık denetimde ${p.year} yıl paketinde sorun bulundu (${p.error}) ve yedekteki kopyasından geri getirildi. Raporlar etkilenmedi.` : `Haftalık denetimde ${p.year} yıl paketinde sorun bulundu: ${p.error} Yedeklerde ve flash bellekte sağlam kopyası bulunamadı. Mola ekibini arayın; Mola Merkez'deki sunucu yedeğinden geri getirilebilir.`);
    }
    this.packages.setMeta('package:checked', t.toISOString());
    return problems;
  }
  /** Day summaries, payment lists and roll-ups of the year, built in slices: the package carries them, so it is read alone. */
  private async prepare(job: PackageJob) {
    for (const tenant of this.tenants()) {
      const s = this.store.read(tenant), b = this.store.history.dataBounds(tenant);
      const first = [b?.first, this.firstDay(job.from)].filter((v): v is string => !!v && v >= job.from).sort()[0];
      if (!first || first > job.to) continue;
      const steps = [this.store.history.prepareDays(tenant, first, job.to), this.store.history.prepare(tenant, s, -Infinity, job.t0), ...(this.hooks.prepare?.(tenant, s, `${first.slice(0, 7)}-01`, job.to) ?? [])];
      for (const step of steps) await drainSlowly(step, () => false);
    }
  }
  /**
   * The copy without customers' personal data (server/package-privacy.ts): every row of the tables that can hold some is
   * opened with its business's key, a page at a time in key order, in slices on this thread (the café's requests run in
   * between; the copy is a file of its own, so nobody waits for its transaction). A row that changes is sealed again under
   * its own scope (the same AAD), read back, written over the copied row and noted in `package_stripped`. A crash leaves only
   * the temporary file, which the next run makes again. Returns how many rows changed per table.
   */
  private async strip(temp: string, crashAt?: CrashPoint) {
    const db = new DatabaseSync(temp), keys = new Map<string, Buffer>(), counts: Record<string, number> = {};
    const keyOf = (tenant: string) => {
      let key = keys.get(tenant);
      if (!key) { const k = snapshotKey(this.store.db, this.store.key, tenant); if (!k) throw new Error('Yıl paketinde işletmesi bulunmayan kayıt var.'); keys.set(tenant, key = k); }
      return key;
    };
    const sha = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
    try {
      db.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; CREATE TABLE ${STRIPPED_TABLE} (tbl TEXT NOT NULL, key TEXT NOT NULL, source TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY (tbl, key))`);
      const note = db.prepare(`INSERT INTO ${STRIPPED_TABLE} (tbl,key,source,content) VALUES (?,?,?,?)`);
      db.exec('BEGIN');
      let until = performance.now() + 12;
      for (const spec of PACKAGE_TABLES) {
        if (!spec.private || !spec.scope || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(spec.table)) continue;
        const cols = spec.key.join(','), marks = spec.key.map(() => '?').join(',');
        const first = db.prepare(`SELECT ${rowColumns(spec)} FROM ${spec.table} ORDER BY ${cols} LIMIT 200`), page = db.prepare(`SELECT ${rowColumns(spec)} FROM ${spec.table} WHERE (${cols}) > (${marks}) ORDER BY ${cols} LIMIT 200`);
        const update = db.prepare(`UPDATE ${spec.table} SET payload=? WHERE (${cols}) = (${marks})`);
        let after: (string | number)[] | null = null, changed = 0;
        for (;;) {
          const rows = (after ? page.all(...after) : first.all()) as (Record<string, string | number> & { payload: Uint8Array })[];
          if (!rows.length) break;
          for (const row of rows) {
            const key = keyOf(String(row.tenant)), scope = spec.scope(row as Record<string, string>), payload = Buffer.from(row.payload);
            const value = withoutPersonalData(spec.table, row, JSON.parse(openText(payload, key, scope).json.toString('utf8')));
            if (value !== undefined) {
              const json = Buffer.from(JSON.stringify(value), 'utf8'), sealed = sealText(json, key, scope, true);
              if (!openText(sealed, key, scope).json.equals(json)) throw new Error('Yıl paketinde kişisel bilgiler silinemedi (yeni mühür açılamadı).');
              const k = spec.key.map(c => row[c]);
              update.run(sealed, ...k); note.run(spec.table, rowKey(spec, row), sha(payload), sha(json));
              if (++changed === 1) this.crash('stripping', crashAt);
            }
            if (performance.now() > until) { await new Promise(r => setImmediate(r)); until = performance.now() + 12; }
          }
          after = spec.key.map(c => rows.at(-1)![c]);
        }
        counts[spec.table] = changed;
      }
      db.prepare('INSERT INTO package_meta (key,value) VALUES (?,?)').run('privacy', '1');
      db.exec('COMMIT');
    } finally { db.close(); }
    return counts;
  }
  /**
   * The readable copy taken before the very first package ("<veri>-tasima-oncesi-v3-…") holds every customer's personal data
   * as it was: it goes 90 days after that packaging, and only once a verified backup newer than the packaging exists (the
   * backup, not the copy, is then the way back). Hourly with tick(). Returns the folders removed.
   */
  async removeSafetyCopy(): Promise<string[]> {
    const view = safetyCopyView(this.store), first = this.packages.list().map(p => Date.parse(p.sealedAt)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    if (!view || first === undefined || this.now().getTime() < Date.parse(view.removeAt)) return [];
    const backup = Date.parse(this.hooks.verifiedBackupAt?.() ?? '');
    if (!Number.isFinite(backup) || backup <= first) return [];
    const gone = safetyCopies(this.store.directory);
    // A copy of the whole data (up to a few GB): removed without holding the café's requests.
    for (const folder of gone) await rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    if (gone.length) console.log(`Paketlemeden önceki okunabilir kopya silindi (90 gün doldu, daha yeni doğrulanmış yedek var): ${gone.map(f => basename(f)).join(', ')}`);
    return gone;
  }
  /**
   * Batch after batch, each its own transaction: the live rows of the year that are byte for byte in the package, and those a
   * stripped row came from (package_stripped: the live row's SHA-256 must be the noted one). A crash goes on from where it
   * stopped (the rows left are the ones still to go).
   */
  private async removeLive(job: PackageJob, crashAt?: CrashPoint) {
    const db = this.store.db, path = this.packages.path(job.year);
    db.prepare('ATTACH DATABASE ? AS pkg').run(path);
    let removed = job.removed ?? 0, batches = 0;
    try {
      const has = (schema: string, table: string) => !!db.prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE type='table' AND name=?`).get(table);
      const privacy = has('pkg', STRIPPED_TABLE);
      for (const spec of PACKAGE_TABLES) {
        if (!has('main', spec.table) || !has('pkg', spec.table)) continue;
        // The package's rows in key order (its primary key index), a page at a time; each live row with the same key and the
        // same bytes goes by its own primary key. No table is ever scanned whole, so no step holds the café for long.
        const keys = spec.key.join(','), marks = spec.key.map(() => '?').join(','), same = spec.table === 'history_payments' ? ['tenant', 'archive_id', 'day'] : ['payload'];
        const page = db.prepare(`SELECT ${keys} FROM pkg.${spec.table} WHERE (${keys}) > (${marks}) ORDER BY ${keys} LIMIT ?`), first = db.prepare(`SELECT ${keys} FROM pkg.${spec.table} ORDER BY ${keys} LIMIT ?`);
        const remove = db.prepare(`DELETE FROM main.${spec.table} AS p WHERE (${keys}) = (${marks}) AND EXISTS (SELECT 1 FROM pkg.${spec.table} q WHERE (${spec.key.map(k => `q.${k}`).join(',')}) = (${marks}) AND ${same.map(c => `q.${c} IS p.${c}`).join(' AND ')})`);
        // A stripped row: its live row goes when it is exactly the row it was made from.
        const stripped = privacy && spec.private ? { source: db.prepare(`SELECT source FROM pkg.${STRIPPED_TABLE} WHERE tbl=? AND key=?`), live: db.prepare(`SELECT payload FROM main.${spec.table} WHERE (${keys}) = (${marks})`), drop: db.prepare(`DELETE FROM main.${spec.table} WHERE (${keys}) = (${marks})`) } : undefined;
        let after: (string | number)[] | null = null;
        for (;;) {
          const rows = (after ? page.all(...after, this.batch) : first.all(this.batch)) as Record<string, string | number>[];
          if (!rows.length) break;
          const t = performance.now();
          db.exec('BEGIN IMMEDIATE');
          try {
            for (const row of rows) {
              const k = spec.key.map(c => row[c]);
              let n = Number(remove.run(...k, ...k).changes);
              if (!n && stripped) {
                const mark = stripped.source.get(spec.table, rowKey(spec, row)) as { source: string } | undefined, live = mark && stripped.live.get(...k) as { payload: Uint8Array } | undefined;
                if (live && createHash('sha256').update(live.payload).digest('hex') === mark.source) n = Number(stripped.drop.run(...k).changes);
              }
              removed += n;
            }
            if (++batches % 20 === 0) this.packages.setMeta('package:job', JSON.stringify({ ...job, removed }));
            db.exec('COMMIT');
          } catch (e) { db.exec('ROLLBACK'); throw e; }
          this.longest = Math.max(this.longest, performance.now() - t);
          after = spec.key.map(c => rows.at(-1)![c]);
          if (batches === 2) this.crash('deleting', crashAt);
          // Between pages the café's requests run.
          await new Promise(r => setTimeout(r, this.pauseMs));
        }
      }
      this.packages.setMeta('package:job', JSON.stringify({ ...job, removed }));
    } finally { db.exec('DETACH DATABASE pkg'); }
    return removed;
  }
  /** The longest single step of the last run on the server's own thread (ms): what a tablet could have waited (measuring). */
  longest = 0;
  /** Before the first package: the data folder as an older app reads it (data version 3), beside it, like earlier migrations. */
  private async readableCopy() {
    const dir = resolve(this.store.directory), stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const copy = join(dirname(dir), `${basename(dir)}-tasima-oncesi-v3-${stamp}`);
    mkdirSync(copy);
    try {
      await sqliteJob({ vacuum: [join(dir, 'merchant.sqlite'), join(copy, 'merchant.sqlite')] });
      const keys = ['development.key', 'anahtar.json', 'anahtar.yedek.json'].filter(name => existsSync(join(dir, name)));
      if (!keys.length) throw new Error('Anahtar dosyası bulunamadı.');
      for (const name of keys) copyFileSync(join(dir, name), join(copy, name));
      writeFileSync(join(copy, 'BENIOKU.txt'), `İlk yıl paketinden (veri sürümü 4) önce alınan kopya. Veri sürümü 3. Gerekirse yalnız eski uygulama sürümüyle ve ayrı bir klasörde açın.${keys.includes('development.key') ? '' : ' Anahtar korumalı: bu kopya yalnız bu bilgisayarın kullanıcısıyla ya da kurtarma koduyla açılır.'}\n`);
    } catch (e) { rmSync(copy, { recursive: true, force: true }); throw e; }
  }
}

/** The package tables as the workers need them: the year's rows (`where` against the live file), both key orders, the key. */
function workerTables(job: Pick<PackageJob, 'from' | 'to' | 't0'>) {
  const range: Mask & { t0: number } = { ...rangeMask(job.from, job.to), t0: job.t0 };
  return PACKAGE_TABLES.map(t => ({ table: t.table, where: t.where(range, 'live.'), order: t.order.split(',').map(c => `p.${c}`).join(','), plainOrder: t.order, key: t.key }));
}
/** A worker thread running `code` (inline, so the bundled server needs no separate worker file); its one message is the answer. */
function inWorker<T>(code: string, workerData: unknown, failure: string) {
  return new Promise<T>((done, fail) => {
    const worker = new Worker(`const { workerData: w, parentPort } = require('node:worker_threads');
      process.removeAllListeners('warning');
      const { DatabaseSync } = require('node:sqlite'); const crypto = require('node:crypto'); const fs = require('node:fs');
      ${code}`, { eval: true, workerData });
    let answer: { value: T } | undefined;
    worker.once('message', value => { answer = { value }; });
    worker.once('error', fail);
    worker.once('exit', code => answer && code === 0 ? done(answer.value) : fail(new Error(failure)));
  });
}
/**
 * In a worker thread: the year's rows of every package table copied unchanged from the live database (one read snapshot) into
 * a new file, with the tables' indexes and the package's own description. Checked afterwards by verifyYear.
 */
export function copyYear(live: string, target: string, job: Pick<PackageJob, 'year' | 'from' | 'to' | 't0'>) {
  return inWorker<true>(`const out = new DatabaseSync(w.target);
      try {
        out.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF');
        out.prepare('ATTACH DATABASE ? AS live').run(w.live);
        const present = w.tables.filter(t => out.prepare("SELECT 1 FROM live.sqlite_master WHERE type='table' AND name=?").get(t.table));
        for (const t of present) out.exec(out.prepare("SELECT sql FROM live.sqlite_master WHERE type='table' AND name=?").get(t.table).sql);
        out.exec('BEGIN');
        for (const t of present) out.prepare('INSERT INTO main.' + t.table + ' SELECT p.* FROM live.' + t.table + ' p WHERE ' + t.where).run();
        out.exec('COMMIT');
        for (const t of present) for (const i of out.prepare("SELECT sql FROM live.sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(t.table)) out.exec(i.sql);
        out.exec('DETACH DATABASE live');
        out.exec('CREATE TABLE package_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
        const meta = out.prepare('INSERT INTO package_meta (key,value) VALUES (?,?)');
        meta.run('year', w.year); meta.run('from', w.from); meta.run('to', w.to); meta.run('t0', String(w.t0)); meta.run('format', 'mola-yil-paketi-1');
        out.exec('PRAGMA user_version=4');
      } finally { out.close(); }
      parentPort.postMessage(true);`, { live, target, tables: workerTables(job), year: job.year, from: job.from, to: job.to, t0: job.t0 }, 'Yıl paketi kopyalanamadı.');
}
/**
 * In a worker thread: SQLite's check of the finished copy, then every package table against the live rows of the year, both
 * in key order, row beside row: the same columns, and the same payload bytes, or (a row stripped of personal data) a live
 * payload whose SHA-256 is the one package_stripped noted for that key; every noted row must be met once. Then the file's
 * SHA-256. Returns it with the size, the row counts and the stripped rows per table.
 */
export function verifyYear(live: string, target: string, job: Pick<PackageJob, 'year' | 'from' | 'to' | 't0'>) {
  return inWorker<{ sha256: string; size: number; counts: Record<string, number>; stripped: Record<string, number> }>(`
      const sha = v => crypto.createHash('sha256').update(v).digest('hex');
      const same = (a, b) => a === b || (a instanceof Uint8Array && b instanceof Uint8Array && Buffer.compare(a, b) === 0);
      const bad = table => new Error('Yıl paketine taşınan kayıtlar doğrulanamadı (' + table + ').');
      const db = new DatabaseSync(w.target), counts = {}, stripped = {};
      try {
        if (String(Object.values(db.prepare('PRAGMA quick_check').get())[0]) !== 'ok') throw new Error('Yıl paketinin veritabanı bütünlüğü doğrulanamadı.');
        const has = (schema, table) => !!db.prepare('SELECT 1 FROM ' + schema + ".sqlite_master WHERE type='table' AND name=?").get(table);
        const notes = new Map();
        if (has('main', w.notes)) for (const r of db.prepare('SELECT tbl,key,source FROM ' + w.notes).iterate()) notes.set(r.tbl + '\\u0000' + r.key, r.source);
        db.prepare('ATTACH DATABASE ? AS live').run(w.live);
        let met = 0;
        for (const t of w.tables) {
          if (has('main', t.table) !== has('live', t.table)) throw bad(t.table);
          if (!has('main', t.table)) continue;
          const a = db.prepare('SELECT p.* FROM live.' + t.table + ' p WHERE ' + t.where + ' ORDER BY ' + t.order).iterate(), b = db.prepare('SELECT * FROM main.' + t.table + ' ORDER BY ' + t.plainOrder).iterate();
          let n = 0, changed = 0;
          for (;;) {
            const x = a.next(), y = b.next();
            if (x.done !== y.done) throw bad(t.table);
            if (x.done) break;
            n++;
            const l = x.value, p = y.value;
            for (const c of Object.keys(l)) if (c !== 'payload' && !same(l[c], p[c])) throw bad(t.table);
            if (same(l.payload, p.payload)) continue;
            const source = notes.get(t.table + '\\u0000' + JSON.stringify(t.key.map(c => l[c])));
            if (!source || source !== sha(l.payload)) throw bad(t.table);
            changed++;
          }
          counts[t.table] = n; met += changed;
          if (changed) stripped[t.table] = changed;
        }
        if (met !== notes.size) throw bad(w.notes);
        db.exec('DETACH DATABASE live');
      } finally { db.close(); }
      const h = crypto.createHash('sha256'), fd = fs.openSync(w.target, 'r'), buf = Buffer.alloc(4 * 1024 * 1024);
      try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
      parentPort.postMessage({ sha256: h.digest('hex'), size: fs.statSync(w.target).size, counts, stripped });`, { live, target, tables: workerTables(job), notes: STRIPPED_TABLE }, 'Yıl paketi doğrulanamadı.');
}
