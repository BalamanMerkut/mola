import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { addDays, businessDay, dayStart } from '../packages/domain/business-day.js';
import { open, openText } from './sealing.js';
import { withoutPersonalData } from './package-privacy.js';

/*
 * Yıl paketleri (Faz 4; docs/GELISTIRICI_REHBERI.md "Yıl paketleri", docs/HIZ_TESTI_5_YIL.md "Faz 4 sonrası").
 *
 * Every calendar year (business days 05:00–05:00) is moved, once it is closed (1 February of the next year,
 * server/year-packer.ts), out of merchant.sqlite into its own file next to it: `yil-2025.sqlite`. The rows go over byte for
 * byte (each is sealed with its business's key under an AAD naming business, kind and record, so they stay valid anywhere;
 * rows with customers' personal data are sealed again without it, below),
 * together with the year's day summaries and monthly/yearly roll-ups, so a closed year is read from its package alone.
 * A package is never written again: its SHA-256 and row counts are kept in the live file's `history_meta`
 * (`package:<year>`), backups reference it by that SHA-256 (manifest format 2), it is encrypted once with a key derived from
 * the data's master key and its own SHA-256 (the same bytes every time: stored once on the café computer, sent to Mola
 * Merkez once, copied to the flash drive once), checked every week (SHA-256) and opened row by row once a month.
 *
 * Customers' personal data stays behind (server/package-privacy.ts): a row that holds some (a reservation's name, phone and
 * note, a seated guest's name, line notes, a QR guest's browser id) is opened, stripped and sealed again under the same scope;
 * the package's `package_stripped` table names each such row with the SHA-256 of the live row it came from (the live row may
 * leave only when it is that row) and of the JSON it holds now (the monthly check opens it against that). Every other row
 * goes over byte for byte.
 *
 * Readers (server/history.ts, cash-closing.ts, shifts.ts, stock.ts, reservations.ts) open each package as its own read-only
 * database ("shard") and read live + the packages that overlap what they ask for. Package ranges tile the calendar: the
 * first one holds everything up to its 31 December, every later one one year. While a package's rows are being removed
 * from the live file (in small batches after it was sealed), live rows in its range are not read (`mask`): the package
 * already has them, and a half-deleted year must never be read twice or half.
 */
export const PACKAGE_DATA_VERSION = 4;
const MIN_DAY = '0000-01-01', FAR = 8.64e15;
export type PackageInfo = {
  v: 1; year: string; file: string; sha256: string; size: number;
  /** Business days [from, to] this package holds ('0000-01-01' for the first: everything before). */
  from: string; to: string;
  /** dayStart of the next 1 January: the package holds every timed record before it. */
  t0: number;
  counts: Record<string, number>; tenants: string[]; sealedAt: string;
  /** Its encrypted copy (blobName): the same bytes in every backup, on the flash drive and on Mola Merkez (found there by this). */
  encSha256?: string; encSize?: number;
  /** Rows sealed again without customers' personal data, per table (server/package-privacy.ts); missing on older packages. */
  stripped?: Record<string, number>;
};
/** In progress (history_meta 'package:job'): 'closing' (writes into the year refused, built, copied), 'sealed' (registered, rows leaving live). */
export type PackageJob = { v: 1; year: string; from: string; to: string; t0: number; step: 'closing' | 'sealed'; startedAt: string; removed?: number };
/** Live rows of these business days (times) are not read: the package that has them is being emptied out of the live file. */
export type Mask = { from: string; to: string; startMs: number; endMs: number; startIso: string; endIso: string };
export type PackageCheck = { at: string; ok: boolean; kind: 'sha' | 'open'; error?: string; repaired?: string };

export const packageFile = (year: string) => `yil-${year}.sqlite`;
/** The business day of a time for choosing packages ('0000-01-01' / '9999-12-31' beyond any real day). */
export const dayOfMs = (ms: number) => !Number.isFinite(ms) || ms <= -8.6e15 ? MIN_DAY : ms >= 8.6e15 ? '9999-12-31' : businessDay(ms);
export const PACKAGE_FILE = /^yil-\d{4}\.sqlite(?:-wal|-shm|-journal|\.tmp(?:-wal|-shm|-journal)?|\.onarim)?$/;
/** A live condition that leaves out the masked days ('1' when nothing is masked). Values are checked strings and numbers. */
export const maskDays = (m: Mask | null, column: string) => m ? `(${column} < '${m.from}' OR ${column} > '${m.to}')` : '1';
export const maskMs = (m: Mask | null, column: string) => m ? `(${column} < ${m.startMs} OR ${column} >= ${m.endMs})` : '1';
export const maskIso = (m: Mask | null, column: string) => m ? `(${column} < '${m.startIso}' OR ${column} >= '${m.endIso}')` : '1';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The mask of a package range [from, to]. */
export function rangeMask(from: string, to: string): Mask {
  if (!DAY.test(from) || !DAY.test(to)) throw new Error('Geçersiz yıl paketi aralığı.');
  const startMs = from === MIN_DAY ? -FAR : dayStart(from), endMs = dayStart(addDays(to, 1));
  return { from, to, startMs, endMs, startIso: from === MIN_DAY ? '' : new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

export class YearPackages {
  private registry: PackageInfo[] = [];
  private current?: PackageJob;
  private forgotten = new Map<string, string>();
  private opened = new Map<string, { db: DatabaseSync; tables: Set<string> }>();
  constructor(readonly directory: string, private db: DatabaseSync) {
    db.exec('CREATE TABLE IF NOT EXISTS history_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.refresh();
  }
  /** Reads the registry again (after the packer or a restore changed it). */
  refresh() {
    const rows = this.db.prepare("SELECT key,value FROM history_meta WHERE key LIKE 'package:%'").all() as { key: string; value: string }[];
    this.registry = []; this.current = undefined; this.forgotten.clear();
    for (const { key, value } of rows) {
      if (/^package:\d{4}$/.test(key)) { const p = JSON.parse(value) as PackageInfo; if (p.v === 1) this.registry.push(p); }
      else if (key === 'package:job') this.current = JSON.parse(value) as PackageJob;
      else if (key.startsWith('package:forget:')) this.forgotten.set(key.slice('package:forget:'.length), value);
    }
    this.registry.sort((a, b) => a.year.localeCompare(b.year));
    // A shard of a package that is gone from the registry (a restore) is closed.
    for (const year of [...this.opened.keys()]) if (!this.registry.some(p => p.year === year)) this.closeShard(year);
  }
  meta(key: string) { return (this.db.prepare('SELECT value FROM history_meta WHERE key=?').get(key) as { value: string } | undefined)?.value; }
  setMeta(key: string, value: string | null) {
    if (value === null) this.db.prepare('DELETE FROM history_meta WHERE key=?').run(key);
    else this.db.prepare('INSERT OR REPLACE INTO history_meta (key,value) VALUES (?,?)').run(key, value);
  }
  /** Sealed packages, oldest first. */
  list() { return [...this.registry]; }
  get(year: string) { return this.registry.find(p => p.year === year); }
  job() { return this.current; }
  /** The last business day of the newest closed year (a year being packaged counts from its first step); null: none. */
  closedEnd(): string | null {
    const ends = [...this.registry.map(p => p.to), ...(this.current ? [this.current.to] : [])].sort();
    return ends.at(-1) ?? null;
  }
  /** The day after the newest package: where the next one starts. */
  nextFrom() { const last = this.registry.at(-1); return last ? addDays(last.to, 1) : MIN_DAY; }
  mask(): Mask | null { return this.current?.step === 'sealed' ? rangeMask(this.current.from, this.current.to) : null; }
  path(year: string) { return join(this.directory, packageFile(year)); }
  /** A "Tanıtım" reset (server/demo-reset.ts): this business's rows in the packages sealed so far are not read any more. */
  forget(tenant: string) {
    const last = this.registry.at(-1)?.year;
    if (!last) return;
    this.setMeta(`package:forget:${tenant}`, last);
    this.forgotten.set(tenant, last);
  }
  private shard(p: PackageInfo) {
    let s = this.opened.get(p.year);
    if (!s) {
      // A missing package is never read around (its year's figures would silently be wrong): the reader stops with this.
      let db: DatabaseSync;
      try { db = new DatabaseSync(this.path(p.year), { readOnly: true }); }
      catch { throw new Error(`${p.year} yıl paketi açılamadı (dosya yok ya da kullanımda). Mola ekibini arayın; yedekten geri getirilebilir.`); }
      const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name));
      this.opened.set(p.year, s = { db, tables });
    }
    return s;
  }
  /**
   * The read-only databases of the sealed packages overlapping the business days [from, to] that hold `table`, oldest first.
   * `tenant`: a business reset as a demo after a package was sealed reads nothing from it.
   */
  shards(table: string, from = MIN_DAY, to = '9999-12-31', tenant?: string): DatabaseSync[] {
    const hidden = tenant ? this.forgotten.get(tenant) : undefined;
    const out: DatabaseSync[] = [];
    for (const p of this.registry) {
      if (p.to < from || p.from > to || (hidden && p.year <= hidden)) continue;
      const s = this.shard(p);
      if (s.tables.has(table)) out.push(s.db);
    }
    return out;
  }
  /**
   * Where rows of `table` are read: the packages overlapping [from, to] (oldest first), then the live database with its rows of a
   * year being emptied out left out (`live` builds that condition from the mask).
   */
  sources(table: string, live: (m: Mask | null) => string, from?: string, to?: string, tenant?: string) {
    const m = this.mask();
    return [...this.shards(table, from, to, tenant).map(db => ({ db, where: '1', live: false })), { db: this.db, where: live(m), live: true }];
  }
  /** A package holding the business day `day` (its tiles never overlap). */
  holding(day: string) { return this.registry.find(p => p.from <= day && day <= p.to); }
  closeShard(year: string) { const s = this.opened.get(year); if (s) { try { s.db.close(); } catch { /* closed */ } this.opened.delete(year); } }
  close() { for (const year of [...this.opened.keys()]) this.closeShard(year); }

  // ---- Checks: every week the files' SHA-256, every month one package opened row by row ----
  check(year: string): PackageCheck | undefined { const v = this.meta(`package:check:${year}`); return v ? JSON.parse(v) as PackageCheck : undefined; }
  private record(year: string, c: PackageCheck) { this.setMeta(`package:check:${year}`, JSON.stringify(c)); }
  /** Each package file is there with its size and SHA-256. Returns the problems (and records every result). */
  async verifyFiles(now: Date) {
    const problems: { year: string; error: string }[] = [];
    for (const p of this.list()) {
      let error: string | undefined;
      try {
        if (!existsSync(this.path(p.year))) error = 'Yıl paketi dosyası bulunamadı.';
        else if (statSync(this.path(p.year)).size !== p.size) error = 'Yıl paketi dosyasının boyutu değişmiş.';
        else if (await fileSha256(this.path(p.year)) !== p.sha256) error = 'Yıl paketi dosyası bozulmuş (SHA-256 tutmuyor).';
      } catch (e) { error = `Yıl paketi okunamadı: ${(e as Error).message}`; }
      this.record(p.year, { at: now.toISOString(), ok: !error, kind: 'sha', ...(error ? { error } : {}) });
      if (error) problems.push({ year: p.year, error });
    }
    return problems;
  }
  /**
   * One package opened like a backup is checked: SQLite's own check, then every sealed row opened with its business's key, in
   * slices (the café goes on meanwhile). Throws on the first problem.
   */
  async openCheck(year: string, keyOf: (tenant: string) => Buffer | undefined, now: Date) {
    const p = this.get(year);
    if (!p) throw new Error('Yıl paketi bulunamadı.');
    try {
      const { db, tables } = this.shard(p);
      const quick = String(Object.values(db.prepare('PRAGMA quick_check').get() ?? {})[0]);
      if (quick !== 'ok') throw new Error('Yıl paketinin veritabanı bütünlüğü bozuk.');
      let pause = performance.now() + 20;
      // A package made without customers' personal data (package_stripped): its rows are checked for that too, and each
      // row sealed again holds exactly the JSON recorded when it was made.
      const privacy = tables.has(STRIPPED_TABLE), made = new Map<string, string>();
      if (privacy) for (const r of db.prepare(`SELECT tbl,key,content FROM ${STRIPPED_TABLE}`).iterate() as Iterable<{ tbl: string; key: string; content: string }>) made.set(`${r.tbl}\0${r.key}`, r.content);
      for (const spec of PACKAGE_TABLES) {
        if (!spec.scope || !tables.has(spec.table)) continue;
        const personal = privacy && !!spec.private;
        for (const row of db.prepare(`SELECT ${personal ? rowColumns(spec) : spec.columns} FROM ${spec.table}`).iterate() as Iterable<Record<string, string> & { payload: Uint8Array }>) {
          const key = keyOf(row.tenant);
          if (!key) throw new Error('Yıl paketinde işletmesi bulunmayan kayıt var.');
          if (!personal) open(Buffer.from(row.payload), key, spec.scope(row));
          else {
            const json = openText(Buffer.from(row.payload), key, spec.scope(row)).json, content = made.get(`${spec.table}\0${rowKey(spec, row)}`);
            if (content !== undefined && createHash('sha256').update(json).digest('hex') !== content) throw new Error('Yıl paketinde bir kayıt, paketlenirken yazılandan farklı.');
            if (withoutPersonalData(spec.table, row, JSON.parse(json.toString('utf8'))) !== undefined) throw new Error('Yıl paketinde silinmesi gereken kişisel bilgi kaldı.');
          }
          if (performance.now() > pause) { await new Promise(r => setImmediate(r)); pause = performance.now() + 20; }
        }
      }
      this.record(year, { at: now.toISOString(), ok: true, kind: 'open' });
    } catch (e) {
      this.record(year, { at: now.toISOString(), ok: false, kind: 'open', error: (e as Error).message });
      throw e;
    }
  }
  /**
   * A missing or damaged package comes back from an encrypted copy (a `yillar/` folder: this computer's backups, the flash
   * drive, a downloaded Merkez copy): decrypted beside it, checked against the registry's SHA-256, then put in place.
   * Returns the folder it came from, or undefined when no copy was found.
   */
  async repair(year: string, folders: string[], master: Buffer) {
    const p = this.get(year);
    if (!p) throw new Error('Yıl paketi bulunamadı.');
    for (const folder of folders) {
      const blob = join(folder, blobName(p));
      if (!existsSync(blob)) continue;
      const temp = `${this.path(year)}.onarim`;
      try {
        await decryptPackage(blob, temp, master, p);
        if (await fileSha256(temp) !== p.sha256) throw new Error('SHA-256');
        this.closeShard(year);
        renameSync(temp, this.path(year));
        this.record(year, { at: new Date().toISOString(), ok: true, kind: 'sha', repaired: folder });
        return folder;
      } catch { rmSync(temp, { force: true }); }
    }
    return undefined;
  }
}

/**
 * The tables a package holds and how each is chosen, copied, checked and taken out of the live file. `where(alias)` is written
 * against the row alias `p` and the schema prefix of the tables it looks into (`live.` while copying, `pkg.` while deleting).
 * `key`: the columns that name a row (a deleted live row must be the very row of the package, payload included).
 */
export type PackageTable = { table: string; where: (r: Mask & { t0: number }, src: string) => string; order: string; key: string[]; columns: string; scope?: (row: Record<string, string>) => string; cache?: true;
  /** Rows may hold customers' personal data: opened and stripped on the way into the package (server/package-privacy.ts). */
  private?: true };
const days = (column: string) => (r: Mask) => `${column} BETWEEN '${r.from}' AND '${r.to}'`;
/** In a package: each row sealed again without personal data (key, SHA-256 of the live row it replaces, SHA-256 of its JSON). */
export const STRIPPED_TABLE = 'package_stripped';
/** A row's key as package_stripped names it: its key columns' values as a JSON array. */
export const rowKey = (spec: Pick<PackageTable, 'key'>, row: Record<string, unknown>) => JSON.stringify(spec.key.map(c => row[c]));
/** The key columns and the columns a row is opened with, once each. */
export const rowColumns = (spec: Pick<PackageTable, 'key' | 'columns'>) => [...new Set([...spec.key, ...spec.columns.split(',')])].join(',');
export const PACKAGE_TABLES: PackageTable[] = [
  { table: 'history_archives', where: r => days('p.day')(r), order: 'tenant,id', key: ['tenant', 'id'], columns: 'tenant,id,payload', scope: r => `archive:${r.tenant}:${r.id}`, private: true },
  // The payment index goes with its bill (a bill opened on 31 December and paid after New Year stays live with its index).
  { table: 'history_payments', where: (r, src) => `EXISTS (SELECT 1 FROM ${src}history_archives a WHERE a.tenant=p.tenant AND a.id=p.archive_id AND a.day BETWEEN '${r.from}' AND '${r.to}')`, order: 'token', key: ['token'], columns: 'tenant,token' },
  { table: 'history_ledger', where: r => days('p.day')(r), order: 'seq', key: ['seq'], columns: 'tenant,kind,id,payload', scope: r => `ledger:${r.tenant}:${r.kind}:${r.id}` },
  { table: 'history_audit', where: r => `p.at >= '${r.startIso}' AND p.at < '${r.endIso}'`, order: 'seq', key: ['seq'], columns: 'tenant,id,payload', scope: r => `audit:${r.tenant}:${r.id}`, private: true },
  { table: 'history_days', where: r => days('p.day')(r), order: 'tenant,day', key: ['tenant', 'day'], columns: 'tenant,day,payload', scope: r => `summary:${r.tenant}:${r.day}`, cache: true },
  { table: 'history_payment_days', where: r => days('p.day')(r), order: 'tenant,day', key: ['tenant', 'day'], columns: 'tenant,day,payload', scope: r => `payment-day:${r.tenant}:${r.day}`, cache: true },
  { table: 'history_months', where: r => `p.month BETWEEN '${r.from.slice(0, 7)}' AND '${r.to.slice(0, 7)}'`, order: 'tenant,kind,month', key: ['tenant', 'kind', 'month'], columns: 'tenant,kind,month,payload', scope: r => `month:${r.tenant}:${r.kind}:${r.month}`, cache: true },
  { table: 'history_years', where: r => `p.year BETWEEN '${r.from.slice(0, 4)}' AND '${r.to.slice(0, 4)}'`, order: 'tenant,kind,year', key: ['tenant', 'kind', 'year'], columns: 'tenant,kind,year,payload', scope: r => `year:${r.tenant}:${r.kind}:${r.year}`, cache: true },
  { table: 'cash_records', where: r => days('p.day')(r), order: 'tenant,id', key: ['tenant', 'id'], columns: 'tenant,id,payload', scope: r => `cash:${r.tenant}:${r.id}` },
  { table: 'staff_shifts', where: r => `${days('p.day')(r)} AND p.open=0`, order: 'tenant,id', key: ['tenant', 'id'], columns: 'tenant,id,payload', scope: r => `shift:${r.tenant}:${r.id}` },
  { table: 'staff_activity', where: r => days('p.day')(r), order: 'tenant,day', key: ['tenant', 'day'], columns: 'tenant,day,payload', scope: r => `activity:${r.tenant}:${r.day}` },
  // An event's report row goes with its record.
  { table: 'event_reports', where: (r, src) => `EXISTS (SELECT 1 FROM ${src}reservation_records x WHERE x.tenant=p.tenant AND x.kind='event' AND x.id=p.id AND x.day BETWEEN '${r.from}' AND '${r.to}')`, order: 'tenant,id', key: ['tenant', 'id'], columns: 'tenant,id,payload', scope: r => `event-report:${r.tenant}:${r.id}` },
  { table: 'reservation_records', where: r => days('p.day')(r), order: 'tenant,kind,id', key: ['tenant', 'kind', 'id'], columns: 'tenant,kind,id,payload', scope: r => `reservation:${r.tenant}:${r.kind}:${r.id}`, private: true },
  // Stok: only entries (purchases, counts, fire, returns, prices) before 1 January; items and recipes stay live.
  { table: 'stock_records', where: r => `p.kind='entry' AND p.at >= ${Math.max(-FAR, r.startMs)} AND p.at < ${r.t0}`, order: 'tenant,kind,id', key: ['tenant', 'kind', 'id'], columns: 'tenant,kind,id,payload', scope: r => `stock:${r.tenant}:${r.kind}:${r.id}` },
];

// ---------- Encryption: the same bytes every time (stored once, sent once) ----------
/** "yil-2025-<first 16 of its SHA-256>.bin": the encrypted package in a backup's `yillar/` folder (and on Mola Merkez). */
export const blobName = (p: Pick<PackageInfo, 'year' | 'sha256'>) => `yil-${p.year}-${p.sha256.slice(0, 16)}.bin`;
export const BLOB_NAME = /^yil-\d{4}-[a-f0-9]{16}\.bin$/;
/** What a backup knows of an encrypted package: the plain file and the encrypted one. */
export type PackageBlob = { v: 1; year: string; sha256: string; size: number; blob: string; encSha256: string; encSize: number };
const packageKey = (master: Buffer, p: Pick<PackageInfo, 'year' | 'sha256'>) => Buffer.from(hkdfSync('sha256', master, Buffer.from(p.sha256, 'hex'), `mola:yil-paketi:v1:${p.year}`, 32));
const packageNonce = (key: Buffer) => createHmac('sha256', key).update('mola:yil-paketi:nonce').digest().subarray(0, 12);
const packageAad = (p: Pick<PackageInfo, 'year' | 'sha256'>) => Buffer.from(`mola-yil-paketi-v1:${p.year}:${p.sha256}`);
/**
 * AES-256-GCM with a key from the master key and the package's own SHA-256, and a nonce from that key: one package always
 * encrypts to the same bytes (a key is used for one plaintext only). Layout as every backup blob: nonce, ciphertext, tag.
 */
export async function encryptPackage(source: string, target: string, master: Buffer, p: Pick<PackageInfo, 'year' | 'sha256'>) {
  const key = packageKey(master, p), nonce = packageNonce(key), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(packageAad(p));
  await fs.writeFile(target, nonce, { mode: 0o600 });
  await pipeline(createReadStream(source), cipher, createWriteStream(target, { flags: 'a' }));
  await fs.appendFile(target, cipher.getAuthTag());
}
/** The SHA-256 and size the encrypted copy will have (nothing written): kept in the registry, so a copy is found anywhere. */
export async function encryptedDigest(source: string, master: Buffer, p: Pick<PackageInfo, 'year' | 'sha256'>) {
  const key = packageKey(master, p), nonce = packageNonce(key), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(packageAad(p));
  const h = createHash('sha256').update(nonce); let size = nonce.length;
  for await (const chunk of createReadStream(source)) { const c = cipher.update(chunk as Buffer); h.update(c); size += c.length; }
  const last = cipher.final(), tag = cipher.getAuthTag(); h.update(last); h.update(tag); size += last.length + tag.length;
  return { encSha256: h.digest('hex'), encSize: size };
}
export async function decryptPackage(source: string, target: string, master: Buffer, p: Pick<PackageInfo, 'year' | 'sha256'>) {
  const size = (await fs.stat(source)).size; if (size < 28) throw new Error('Eksik yıl paketi.');
  const file = await fs.open(source, 'r'), nonce = Buffer.alloc(12), tag = Buffer.alloc(16);
  try { await file.read(nonce, 0, 12, 0); await file.read(tag, 0, 16, size - 16); } finally { await file.close(); }
  const key = packageKey(master, p), decipher = createDecipheriv('aes-256-gcm', key, nonce); decipher.setAAD(packageAad(p)); decipher.setAuthTag(tag);
  await fs.rm(target, { force: true });
  await pipeline(createReadStream(source, { start: 12, end: size - 17 }), decipher, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
}
export async function fileSha256(path: string) { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); }
/**
 * The encrypted copy of a package in `folder` (a backup root's `yillar/`): made once, from the live package (checked against its
 * SHA-256 first), and described by `<blob>.json`. Later backups find it there and only refer to it.
 */
export async function ensureBlob(folder: string, source: string, master: Buffer, p: PackageInfo): Promise<PackageBlob> {
  const blob = blobName(p), path = join(folder, blob), side = `${path}.json`;
  if (existsSync(path) && existsSync(side)) {
    try { const kept = JSON.parse(readFileSync(side, 'utf8')) as PackageBlob; if (kept.v === 1 && kept.sha256 === p.sha256 && statSync(path).size === kept.encSize) return kept; } catch { /* made again below */ }
  }
  await fs.mkdir(folder, { recursive: true });
  if (await fileSha256(source) !== p.sha256) throw new Error(`${p.year} yıl paketi bozuk; yedeğe alınamadı.`);
  const temp = `${path}.yaziliyor`;
  await fs.rm(temp, { force: true });
  try { await encryptPackage(source, temp, master, p); } catch (e) { await fs.rm(temp, { force: true }); throw e; }
  const made: PackageBlob = { v: 1, year: p.year, sha256: p.sha256, size: p.size, blob, encSha256: await fileSha256(temp), encSize: (await fs.stat(temp)).size };
  await fs.rename(temp, path);
  await fs.writeFile(side, JSON.stringify(made, null, 2) + '\n');
  return made;
}
/** A blob's description beside it (`<blob>.json`), if there. */
export function readBlob(folder: string, blob: string): PackageBlob | undefined {
  try { const v = JSON.parse(readFileSync(join(folder, `${blob}.json`), 'utf8')) as PackageBlob; return v.v === 1 && v.blob === blob ? v : undefined; } catch { return undefined; }
}
