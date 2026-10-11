import { assertDataVersion, markDataVersion } from './data-version.js';
import { PACKAGE_DATA_VERSION, YearPackages } from './year-packages.js';
import { businessDirectoryEntry, legacyDirectoryRow, type BusinessDirectoryEntry } from './business-directory.js';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { State } from '../packages/domain/types.js';
import { storedRequests } from '../packages/domain/engine.js';
import { pruneTakeaways } from '../packages/domain/takeaway.js';
import { pruneEventTables } from '../packages/domain/reservations.js';
import { captureVatLegacy } from '../packages/domain/vat.js';
import { seed } from './seed.js';
import { initialUsers, loginUsers, type StaffUser } from './accounts.js';
import { assertRestoreReady } from './restore-safety.js';
import { seal, unseal } from './sealing.js';
import { History } from './history.js';
export { seal, unseal } from './sealing.js';

/** Data version 3: compressed history rows. Version 4 (PACKAGE_DATA_VERSION) is written by the first year package. */
const PACKED_DATA_VERSION = 3;

type LoginUser = Pick<StaffUser, 'id' | 'username' | 'role' | 'active' | 'version' | 'salt' | 'hash'> & { mfaEnabled?: boolean };

/**
 * Opened business keys per database. Every sealed row (a settled bill, a day summary, a tip, a stock entry) is read with its
 * business key, and opening the key row was the costliest part of reading thousands of rows for a report (the 5-year test,
 * docs/HIZ_TESTI_5_YIL.md). The key row is still read on every call and its bytes compared, so a changed or removed row is
 * never answered from here; only the decryption is saved.
 */
const openedKeys = new WeakMap<DatabaseSync, { row?: StatementSync; keys: Map<string, { payload: Buffer; master: Buffer; key: Buffer }> }>();
/** The wrapping key still lives on this local server. This is key separation, not E2E. */
export function snapshotKey(db: DatabaseSync, master: Buffer, tenant: string): Buffer | undefined {
  let cache = openedKeys.get(db);
  if (!cache) openedKeys.set(db, cache = { keys: new Map() });
  if (!cache.row) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tenant_keys'").get()) return undefined;
    cache.row = db.prepare('SELECT payload FROM tenant_keys WHERE tenant=?');
  }
  const row = cache.row.get(tenant) as { payload: Uint8Array } | undefined;
  if (!row) { cache.keys.delete(tenant); return undefined; }
  const known = cache.keys.get(tenant);
  if (known && known.master.equals(master) && Buffer.compare(known.payload, row.payload) === 0) return known.key;
  const wrapped = unseal(Buffer.from(row.payload), master, `tenant-key:${tenant}`) as unknown as { key: string };
  if (typeof wrapped.key !== 'string' || !/^[a-f0-9]{64}$/.test(wrapped.key)) throw new Error('İşletme anahtarı geçersiz.');
  const key = Buffer.from(wrapped.key, 'hex');
  cache.keys.set(tenant, { payload: Buffer.from(row.payload), master: Buffer.from(master), key });
  return key;
}
export function readSnapshot(db: DatabaseSync, master: Buffer, tenant: string, payload: Uint8Array) {
  return unseal(Buffer.from(payload), snapshotKey(db, master, tenant) ?? master, tenant);
}
/** Snapshots written before long-term history tables (data version 2) still carry their whole history. */
const legacyHistory = (s: State) => s.archives.length > 0 || s.audit.length > 0 || Object.keys(s.requests).length > 0 || !!s.expenses?.length || !!s.paymentAdjustments?.length;
// Development merchant-local persistence, NOT central production storage or an E2E claim.
export class Store {
  db: DatabaseSync; key: Buffer; history: History; packages: YearPackages;
  /** Business clock; the app sets it, so retention follows the same time as orders (tests, demo generator). */
  clock: () => Date = () => new Date();
  /** options.key: the master key from the key vault (server/key-vault.ts). Without it, the raw development.key as before. */
  constructor(public directory: string, tenants = ['mola-demo', 'other-demo'], options: { key?: Buffer } = {}) {
    assertRestoreReady(directory);
    mkdirSync(directory, { recursive: true });
    if (options.key) this.key = options.key;
    else {
      const keyFile = join(directory, 'development.key');
      if (!existsSync(keyFile) && existsSync(join(directory, 'merchant.sqlite'))) throw new Error('Yerel anahtar eksik. Veritabanı için yeni anahtar üretilemez.');
      if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
      this.key = readFileSync(keyFile);
    }
    this.db = new DatabaseSync(join(directory, 'merchant.sqlite'));
    let version: number;
    try { version = assertDataVersion(this.db); } catch (error) { this.db.close(); throw error; }
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS snapshots (tenant TEXT PRIMARY KEY, payload BLOB NOT NULL)');
    try { this.reclaim(); } catch (e) { this.db.close(); throw e; }
    this.db.exec('CREATE TABLE IF NOT EXISTS business_directory (tenant TEXT PRIMARY KEY, payload BLOB NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS staff_credentials (tenant TEXT PRIMARY KEY, payload BLOB NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS staff_login_lookup (token TEXT PRIMARY KEY, tenant TEXT NOT NULL); CREATE INDEX IF NOT EXISTS staff_login_tenant ON staff_login_lookup(tenant)');
    this.db.exec('CREATE TABLE IF NOT EXISTS table_qr_lookup (token TEXT PRIMARY KEY, tenant TEXT NOT NULL, table_id TEXT NOT NULL); CREATE INDEX IF NOT EXISTS table_qr_tenant ON table_qr_lookup(tenant)');
    try { this.migrateTenantKeys(); } catch (e) { this.db.close(); throw e; }
    // Yıl paketleri (server/year-packages.ts): closed years in their own read-only files next to this one.
    this.packages = new YearPackages(directory, this.db);
    this.history = new History(this.db, this.key, tenant => this.tenantKey(tenant), () => this.clock().getTime(), this.packages);
    for (const tenant of tenants) if (!this.db.prepare('SELECT tenant FROM snapshots WHERE tenant=?').get(tenant)) { this.db.exec('BEGIN IMMEDIATE'); try { this.db.prepare('INSERT INTO snapshots VALUES (?,?)').run(tenant, this.encode(seed(tenant))); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); this.db.close(); throw e; } }
    try { this.migrateHistory(version); } catch (e) { this.db.close(); throw e; }
    // Snapshot an encrypted SQLite backup before migrating an existing workspace.
    const migrationNeeded = (this.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).some(row => !this.read(row.tenant).staffUsers);
    if (migrationNeeded) {
      const backups = join(directory, 'backups'); mkdirSync(backups, { recursive: true });
      this.db.prepare('VACUUM INTO ?').run(join(backups, `before-staff-${Date.now()}.sqlite`));
    }
    // Additive, repeatable migration: existing QR codes, orders and menus are retained.
    for (const row of this.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) {
      if (!this.read(row.tenant).staffUsers) this.mutate(row.tenant, s => { s.staffUsers = initialUsers(row.tenant); s.businessRevision ??= 0; s.setupCompleted ??= false; });
    }
    let target: number;
    try { target = this.upgradeTarget(version); } catch (e) { this.db.close(); throw e; }
    // Data version 4 (yıl paketleri) is written only when the first year is sealed (server/year-packer.ts): until then the
    // data stays version 3 and an older app still opens it (an update can be rolled back by hand).
    if (version >= PACKAGE_DATA_VERSION) target = version;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of this.db.prepare('SELECT tenant FROM snapshots WHERE tenant NOT IN (SELECT tenant FROM business_directory)').all() as { tenant: string }[]) this.syncDirectory(this.read(row.tenant));
      for (const row of this.db.prepare('SELECT tenant FROM snapshots WHERE tenant NOT IN (SELECT tenant FROM staff_credentials)').all() as { tenant: string }[]) this.syncCredentials(this.read(row.tenant));
      // Derived index: reconstruct atomically at startup, including after an older backup restore.
      this.db.exec('DELETE FROM staff_login_lookup');
      for (const row of this.db.prepare('SELECT tenant,payload FROM staff_credentials').all() as { tenant: string; payload: Uint8Array }[]) {
        this.syncLoginLookup(row.tenant, unseal(Buffer.from(row.payload), this.key, `credentials:${row.tenant}`) as unknown as LoginUser[]);
      }
      this.db.exec('DELETE FROM table_qr_lookup');
      for (const row of this.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) { const state = this.read(row.tenant); this.syncTableLookup(state); this.syncCredentials(state); }
      markDataVersion(this.db, target);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); this.db.close(); throw e; }
    // Only now, with version 3 committed, may a compressed row be written: an older app refuses the data instead of
    // misreading it. Rows written before stay plain until History.compact() rewrites them.
    this.history.packing = target >= 3;
  }
  /**
   * Version 3 compresses history rows. Before the first one is rewritten, a readable version 2 copy of the data and key
   * is put next to the folder, like the version 2 move did. If that copy cannot be made (a full disk), the data stays
   * version 2 and new rows are written uncompressed; the next start tries again.
   */
  private upgradeTarget(version: number) {
    if (version !== 2 || this.hasCopy(2)) return PACKED_DATA_VERSION;
    const real = ['history_archives', 'history_ledger', 'history_audit'].some(t => this.db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get());
    if (!real) return PACKED_DATA_VERSION;
    try { this.safetyCopy(2, 'Geçmiş kayıtlarının sıkıştırılmasından (veri sürümü 3) önce alınan kopya. Veri sürümü 2. Gerekirse yalnız eski uygulama sürümüyle ve ayrı bir klasörde açın.'); return PACKED_DATA_VERSION; }
    catch (error) { console.warn(`Taşıma öncesi kopya alınamadı; veriler şimdilik sürüm 2'de kalıyor: ${error instanceof Error ? error.message : error}`); return 2; }
  }
  /** One readable copy per data version: "<folder>-tasima-oncesi-<time>" for version 1, "-v<n>-<time>" after. */
  hasCopy(version: number) {
    const parent = dirname(resolve(this.directory)), prefix = `${basename(resolve(this.directory))}-tasima-oncesi-`;
    return readdirSync(parent).some(entry => entry.startsWith(prefix) && (/^v(\d+)-/.exec(entry.slice(prefix.length))?.[1] ?? '1') === String(version));
  }
  safetyCopy(version: number, note: string) {
    const parent = dirname(resolve(this.directory)), stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const copy = join(parent, `${basename(resolve(this.directory))}-tasima-oncesi-${version === 1 ? '' : `v${version}-`}${stamp}`);
    mkdirSync(copy);
    try {
      this.db.prepare('VACUUM INTO ?').run(join(copy, 'merchant.sqlite'));
      // The key as it is kept: the raw file (development), or the protected key files (never a raw key in protected mode).
      const keys = ['development.key', 'anahtar.json', 'anahtar.yedek.json'].filter(name => existsSync(join(this.directory, name)));
      if (!keys.length) throw new Error('Anahtar dosyası bulunamadı.');
      for (const name of keys) copyFileSync(join(this.directory, name), join(copy, name));
      writeFileSync(join(copy, 'BENIOKU.txt'), `${note}${keys.includes('development.key') ? '' : ' Anahtar korumalı: bu kopya yalnız bu bilgisayarın kullanıcısıyla ya da kurtarma koduyla açılır.'}\n`);
    } catch (e) { rmSync(copy, { recursive: true, force: true }); throw e; }
  }
  /**
   * After the version 3 rewrite the space the old rows took is still part of the file, as room inside half-empty pages
   * (new rows reuse it; backups, made with VACUUM INTO, never carry it). Once, at the next start and before the server
   * answers anyone, VACUUM gives it back to the disk: it rewrites the whole file and holds it meanwhile, so never while
   * serving. Only when the rewrite saved at least 16 MB and a fifth of the file. MOLA_VACUUM=0 skips it.
   */
  private reclaim() {
    if (process.env.MOLA_VACUUM === '0' || !this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history_meta'").get()) return;
    const meta = (key: string) => (this.db.prepare('SELECT value FROM history_meta WHERE key=?').get(key) as { value: string } | undefined)?.value;
    // A year just moved into its package (server/year-packer.ts) left its pages empty inside the live file: given back once.
    if (meta('package:reclaim')) {
      try { this.db.exec('VACUUM'); this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
      catch (error) { console.warn(`Boş alan geri verilemedi (VACUUM): ${error instanceof Error ? error.message : error}`); }
      this.db.prepare("DELETE FROM history_meta WHERE key='package:reclaim'").run();
    }
    if (!meta('packed:complete') || meta('vacuumed')) return;
    const n = (pragma: string) => Number(Object.values(this.db.prepare(`PRAGMA ${pragma}`).get() ?? {})[0]);
    const saved = Number(meta('packed:saved') ?? 0);
    if (saved >= 16 * 1024 * 1024 && saved >= n('page_count') * n('page_size') * 0.2) {
      try { this.db.exec('VACUUM'); this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
      catch (error) { console.warn(`Boş alan geri verilemedi (VACUUM): ${error instanceof Error ? error.message : error}`); }
    }
    this.db.prepare('INSERT OR REPLACE INTO history_meta (key,value) VALUES (?,?)').run('vacuumed', new Date().toISOString());
  }
  /**
   * Version 2 keeps closed accounts, audit, expenses, corrections and request replays in their own sealed tables.
   * Each business moves in one transaction with its snapshot; a crash leaves it either old-style or fully moved.
   */
  private migrateHistory(version: number) {
    const tenants = (this.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).map(r => r.tenant);
    const pending = tenants.filter(t => { const s = this.read(t); return legacyHistory(s) || s.accounts.some(a => a.status === 'closed'); });
    if (!pending.length) return;
    // A readable copy of the data and key before real history moves for the first time, next to (not inside) the folder.
    if (version < 2 && pending.some(t => this.read(t).archives.length) && !this.hasCopy(1)) {
      this.safetyCopy(1, 'Uzun dönem kayıtlarının ayrı tablolara taşınmasından önce alınan kopya. Veri sürümü 1. Gerekirse yalnız eski uygulama sürümüyle ve ayrı bir klasörde açın.');
    }
    // Replays stored before version 2 carry no time and cannot be aged; they are dropped once, as planned.
    for (const tenant of pending) this.mutate(tenant, s => { if (version < 2) s.requests = {}; });
  }
  private tenantKey(tenant: string) {
    const key = snapshotKey(this.db, this.key, tenant);
    if (!key) throw new Error('İşletme anahtarı eksik.');
    return key;
  }
  /** Call within the same transaction as the snapshot write. Moves outgoing history to its tables in that transaction. */
  encode(state: State) {
    let key = snapshotKey(this.db, this.key, state.tenantId);
    if (!key) {
      // Never create a new key for an existing snapshot with a missing key record.
      if (this.db.prepare('SELECT tenant FROM snapshots WHERE tenant=?').get(state.tenantId)) throw new Error('İşletme anahtarı eksik. Önce güvenli geçişi tamamlayın.');
      key = randomBytes(32);
      this.db.prepare('INSERT INTO tenant_keys VALUES (?,?)').run(state.tenantId, seal({ key: key.toString('hex') }, this.key, `tenant-key:${state.tenantId}`));
    }
    this.history.persist(state, key, this.clock().getTime());
    // A settled takeaway ticket has nothing left on the floor once its account moved to history just above.
    pruneTakeaways(state);
    // So do a closed event's temporary tables (packages/domain/reservations.ts).
    pruneEventTables(state);
    this.syncDirectory(state);
    this.syncCredentials(state);
    this.syncTableLookup(state);
    const { closedThrough: _closed, ...kept } = state;
    return seal(kept, key, state.tenantId);
  }
  private qrToken(token: string) {
    return createHmac('sha256', this.key).update('mola:table-qr-lookup:v1\0').update(token).digest('hex');
  }
  private syncTableLookup(state: State) {
    // Takeaway tickets and event tables have no QR link (empty token); only floor tables can be opened from a scan.
    const rows = state.tables.filter(t => !t.takeaway && !t.event).map(t => ({ token: this.qrToken(t.token), table_id: t.id })).sort((a, b) => a.token < b.token ? -1 : a.token > b.token ? 1 : 0);
    const old = this.db.prepare('SELECT token,table_id FROM table_qr_lookup WHERE tenant=? ORDER BY token').all(state.tenantId);
    if (JSON.stringify(old) === JSON.stringify(rows)) return;
    this.db.prepare('DELETE FROM table_qr_lookup WHERE tenant=?').run(state.tenantId);
    const insert = this.db.prepare('INSERT INTO table_qr_lookup(token,tenant,table_id) VALUES (?,?,?)');
    for (const row of rows) insert.run(row.token, state.tenantId, row.table_id);
  }
  /** Routing hint only: the caller must verify the token against the authenticated snapshot. */
  findTable(token: string) {
    const row = this.db.prepare('SELECT tenant,table_id FROM table_qr_lookup WHERE token=?').get(this.qrToken(token)) as { tenant: string; table_id: string } | undefined;
    return row ? { tenantId: row.tenant, tableId: row.table_id } : undefined;
  }
  private syncCredentials(state: State) {
    const users = loginUsers(state.staffUsers ?? []);
    const old = this.db.prepare('SELECT payload FROM staff_credentials WHERE tenant=?').get(state.tenantId) as { payload: Uint8Array } | undefined;
    if (old && JSON.stringify(unseal(Buffer.from(old.payload), this.key, `credentials:${state.tenantId}`)) === JSON.stringify(users)) return;
    this.db.prepare('INSERT INTO staff_credentials VALUES (?,?) ON CONFLICT(tenant) DO UPDATE SET payload=excluded.payload').run(state.tenantId, seal(users, this.key, `credentials:${state.tenantId}`));
    this.syncLoginLookup(state.tenantId, users);
  }
  private usernameToken(username: string) {
    return createHmac('sha256', this.key).update('mola:login-lookup:v1\0').update(username).digest('hex');
  }
  private syncLoginLookup(tenant: string, users: LoginUser[]) {
    this.db.prepare('DELETE FROM staff_login_lookup WHERE tenant=?').run(tenant);
    const insert = this.db.prepare('INSERT INTO staff_login_lookup(token,tenant) VALUES (?,?)');
    for (const user of users) insert.run(this.usernameToken(user.username), tenant);
  }
  /** Directory rows from before `sector` existed: an unchanged write refreshes them (once, when the server starts). */
  refreshDirectory() {
    for (const { tenant } of this.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) if (legacyDirectoryRow(this.directoryEntry(tenant))) this.mutate(tenant, () => {});
  }
  directoryEntry(tenant: string): BusinessDirectoryEntry {
    const row = this.db.prepare('SELECT payload FROM business_directory WHERE tenant=?').get(tenant) as { payload: Uint8Array } | undefined;
    if (!row) throw new Error('İşletme yönetim özeti bulunamadı.');
    return unseal(Buffer.from(row.payload), this.key, `directory:${tenant}`) as unknown as BusinessDirectoryEntry;
  }
  private syncDirectory(state: State) {
    const summary = businessDirectoryEntry(state);
    const old = this.db.prepare('SELECT payload FROM business_directory WHERE tenant=?').get(state.tenantId) as { payload: Uint8Array } | undefined;
    // Orders/payments do not change the directory; avoid another disk write on every sale.
    if (old && JSON.stringify(unseal(Buffer.from(old.payload), this.key, `directory:${state.tenantId}`)) === JSON.stringify(summary)) return;
    this.db.prepare('INSERT INTO business_directory VALUES (?,?) ON CONFLICT(tenant) DO UPDATE SET payload=excluded.payload').run(state.tenantId, seal(summary, this.key, `directory:${state.tenantId}`));
  }
  private migrateTenantKeys() {
    this.db.exec('CREATE TABLE IF NOT EXISTS tenant_keys (tenant TEXT PRIMARY KEY, payload BLOB NOT NULL)');
    const legacy = this.db.prepare('SELECT tenant,payload FROM snapshots WHERE tenant NOT IN (SELECT tenant FROM tenant_keys)').all() as { tenant: string; payload: Uint8Array }[];
    if (!legacy.length) return;
    // Authenticate every old snapshot before modifying any of them. A missing v2 key fails closed here.
    const states = legacy.map(row => ({ tenant: row.tenant, state: unseal(Buffer.from(row.payload), this.key, row.tenant) }));
    const backups = join(this.directory, 'backups'); mkdirSync(backups, { recursive: true });
    this.db.prepare('VACUUM INTO ?').run(join(backups, `before-tenant-keys-${Date.now()}-${randomBytes(4).toString('hex')}.sqlite`));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const { tenant, state } of states) {
        const key = randomBytes(32);
        this.db.prepare('INSERT INTO tenant_keys VALUES (?,?)').run(tenant, seal({ key: key.toString('hex') }, this.key, `tenant-key:${tenant}`));
        this.db.prepare('UPDATE snapshots SET payload=? WHERE tenant=?').run(seal(state, key, tenant), tenant);
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  findUser(username: string) {
    const row = this.db.prepare('SELECT c.tenant,c.payload FROM staff_login_lookup l JOIN staff_credentials c ON c.tenant=l.tenant WHERE l.token=?').get(this.usernameToken(username)) as { tenant: string; payload: Uint8Array } | undefined;
    if (!row) return undefined;
    const users = unseal(Buffer.from(row.payload), this.key, `credentials:${row.tenant}`) as unknown as LoginUser[];
    // Never trust the derived index to identify a user without the authenticated record.
    const user = users.find(u => u.username === username);
    return user ? { user, tenantId: row.tenant } : undefined;
  }
  sessionUser(tenant: string, id: string) {
    const row = this.db.prepare('SELECT payload FROM staff_credentials WHERE tenant=?').get(tenant) as { payload: Uint8Array } | undefined;
    if (!row) return undefined;
    const users = unseal(Buffer.from(row.payload), this.key, `credentials:${tenant}`) as unknown as LoginUser[];
    const user = users.find(u => u.id === id);
    if (!user) return undefined;
    // Session checks need no password material or business snapshot.
    const { username, role, active, version } = user;
    return { id: user.id, username, role, active, version };
  }
  read(tenant: string): State {
    const row = this.db.prepare('SELECT payload FROM snapshots WHERE tenant=?').get(tenant) as { payload: Uint8Array } | undefined;
    if (!row) throw new Error('İşletme bulunamadı.');
    const state = readSnapshot(this.db, this.key, tenant, row.payload);
    // Closed (packaged) years refuse every write into them (packages/domain/closed-year.ts): always from the packages, never stored.
    const closed = this.packages.closedEnd();
    if (closed) state.closedThrough = closed; else delete state.closedThrough;
    // Earlier answers are looked up on demand, so retries keep working without carrying them in the snapshot.
    storedRequests.set(state, scope => this.history.request(tenant, scope));
    return state;
  }
  /** Whether this exact request was already answered (and is still within the replay window). */
  hasRequest(tenant: string, scope: string) { return !!this.history.request(tenant, scope); }
  /** Business audit trail, oldest first. */
  auditLog(tenant: string, limit?: number) { return this.history.audit(tenant, limit); }
  mutate<T>(tenant: string, action: (state: State) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const s = this.read(tenant);
      // The KDV rates of lines sold before each line carried its own are kept once, before any change (vat.ts VatLegacy).
      s.vatLegacy ??= captureVatLegacy(s, this.clock().toISOString());
      const result = action(s);
      this.db.prepare('UPDATE snapshots SET payload=? WHERE tenant=?').run(this.encode(s), tenant);
      this.db.exec('COMMIT');
      // After the commit (never inside it): the menu copy at Mola Merkez follows changes (server/menu-mirror.ts).
      for (const f of this.onMutate) try { f(tenant); } catch { /* their own business */ }
      return result;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  /** Called after every committed change of a business's snapshot. */
  onMutate: ((tenant: string) => void)[] = [];
  close() { this.history.stop(); this.packages?.close(); this.db.close(); }
}
