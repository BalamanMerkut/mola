import { assertDataVersion } from './data-version.js';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Worker } from 'node:worker_threads';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { unseal, readSnapshot, snapshotKey } from './store.js';
import { open } from './sealing.js';
import { SEALED_HISTORY } from './history.js';
import { dataLock } from './data-lock.js';
import { isDeepStrictEqual } from 'node:util';
import { DomainError } from '../packages/domain/engine.js';
import { businessDirectoryEntry, legacyDirectoryRow } from './business-directory.js';
import { loginUsers } from './accounts.js';
import { backupPaths, restorePaths } from './backup-paths.js';
import { BACKUP_KEY_FILE, masterFromCode, masterFromPassword, openBackupKey, readBackupKeyFile, sealBackupKey } from './backup-key.js';
import { KEY_FILE, RAW_KEY, RAW_WIPE, type BackupProtection, type OwnerBlock, type RecoveryBlock } from './key-vault.js';
import { existsSync } from 'node:fs';
import { BLOB_NAME, decryptPackage, ensureBlob, fileSha256, PACKAGE_FILE, PACKAGE_TABLES, packageFile, type PackageInfo } from './year-packages.js';

/** How a backup is opened: its old-style key file, the running server's master key, or the owner's recovery code. */
/** password: a business owner's own sign-in (İşletmem var, 13 Ekim) instead of the recovery code. */
export type BackupSecret = string | { master: Buffer } | { code: string } | { username: string; password: string };

type Entry = { path: string; blob: string; size: number; hash: string };
/**
 * A sealed year package a backup refers to (format 2, server/year-packages.ts): stored once, encrypted, in `yillar/` beside the
 * backup folders (or in the backup folder itself: a copy downloaded from Mola Merkez), never inside each backup.
 */
type PackageEntry = { year: string; path: string; blob: string; size: number; hash: string; encSize: number; encHash: string };
type Manifest = { format: 1 | 2; createdAt: string; files: Entry[]; packages?: PackageEntry[] };
/** complete.json: plain, so the second place and Mola Merkez know which shared package files a backup needs. */
export type Completion = { format: 1 | 2; createdAt: string; files: number; packages?: { year: string; blob: string; size: number; sha256: string }[] };
/** Where a backup's year packages are: beside the backup folders (`yillar/`), or inside the folder itself. */
export const packageFolders = (backup: string) => [backup, join(dirname(backup), 'yillar')];
export const YEAR_FOLDER = 'yillar';
const exists = async (p: string) => fs.stat(p).then(() => true, (e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return false; throw e; });
function contained(root: string, name: string) {
  if (!name || name.includes('\\') || name.includes(':') || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Geçersiz yedek dosya yolu.');
  const path = resolve(root, name), rel = relative(resolve(root), path);
  if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('Yedek hedefi geçersiz.');
  return path;
}
async function hash(path: string) { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); }
async function encrypt(source: string, target: string, key: Buffer, aad: string) {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(aad));
  await fs.writeFile(target, nonce, { flag: 'wx', mode: 0o600 });
  await pipeline(createReadStream(source), cipher, createWriteStream(target, { flags: 'a' }));
  await fs.appendFile(target, cipher.getAuthTag());
}
async function decrypt(source: string, target: string, key: Buffer, aad: string) {
  const size = (await fs.stat(source)).size; if (size < 28) throw new Error('Eksik yedek dosyası.');
  const file = await fs.open(source, 'r'), nonce = Buffer.alloc(12), tag = Buffer.alloc(16);
  try { await file.read(nonce, 0, 12, 0); await file.read(tag, 0, 16, size - 16); } finally { await file.close(); }
  const cipher = createDecipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(tag);
  if (size === 28) { await fs.writeFile(target, cipher.final(), { flag: 'wx', mode: 0o600 }); return; }
  await pipeline(createReadStream(source, { start: 12, end: size - 17 }), cipher, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
}
async function list(root: string, prefix = ''): Promise<string[]> {
  const output: string[] = [];
  for (const e of await fs.readdir(join(root, prefix), { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw new Error('Yedekte sembolik bağlantı desteklenmiyor.');
    const name = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) output.push(...await list(root, name)); else if (e.isFile()) output.push(name);
  }
  return output;
}
/** Operator-only, offline backup: caller must stop the application first. */
export async function createBackup(source: string, outputRoot: string, keyRoot: string) {
  const release = dataLock(source, 'backup');
  try { const made = await createBackupOffline(source, outputRoot, keyRoot); return { ...made, keyPath: made.keyPath! }; } finally { release(); }
}
let liveRunning = false;
/**
 * Backup while the server keeps running. VACUUM INTO reads a consistent snapshot of the WAL database through its own
 * connection, so open orders are captured as they were at that moment. One live backup at a time.
 */
export async function createLiveBackup(source: string, outputRoot: string, keyRoot: string, protection?: BackupProtection, now: () => Date = () => new Date()) {
  if (liveRunning) throw new Error('Bir yedekleme zaten sürüyor.');
  liveRunning = true;
  try { return await createBackupOffline(source, outputRoot, keyRoot, protection, now); } finally { liveRunning = false; }
}
/**
 * protection (the master key is locked by the OS and a recovery code): the backup key is sealed inside the backup
 * (anahtar-kurtarma.json) and no raw key file is written. Without it: the old way, a raw key file in keyRoot.
 */
/** `now`: the backup's time (its folder name and createdAt); the scheduler passes its own clock, so days and weeks agree. */
async function createBackupOffline(source: string, outputRoot: string, keyRoot: string, protection?: BackupProtection, now: () => Date = () => new Date()) {
  ({ source, outputRoot, keyRoot } = await backupPaths(source, outputRoot, keyRoot));
  if (!protection && !await exists(join(source, RAW_KEY)) && await exists(join(source, KEY_FILE))) throw new Error('Bu veri klasörünün anahtarı korumalı. Yedeği çalışan Mola alır: kasa bilgisayarındaki Mola penceresi → Yedekle → Şimdi yedekle.');
  if (!await exists(join(source, 'merchant.sqlite')) || (!protection && !await exists(join(source, RAW_KEY)))) throw new Error('Veritabanı veya veri anahtarı eksik.');
  const master = protection?.master ?? await fs.readFile(join(source, RAW_KEY));
  const id = `backup-${now().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  await fs.mkdir(outputRoot, { recursive: true }); await fs.mkdir(keyRoot, { recursive: true });
  const target = join(outputRoot, id); await fs.mkdir(target);
  const key = randomBytes(32), keyPath = protection ? undefined : join(keyRoot, `${id}.key`);
  const progress = join(target, 'BACKUP_IN_PROGRESS.txt');
  await fs.writeFile(progress, 'Yedek henüz tamamlanmadı.', { flag: 'wx' });
  try {
  if (keyPath) await fs.writeFile(keyPath, key, { flag: 'wx', mode: 0o600 });
  else await fs.writeFile(join(target, BACKUP_KEY_FILE), JSON.stringify(sealBackupKey(id, key, protection!), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const manifest: Manifest = { format: 1, createdAt: now().toISOString(), files: [] };
  const snapshot = join(target, '.snapshot.sqlite');
  await sqliteJob({ vacuum: [join(source, 'merchant.sqlite'), snapshot] });
  await validateBackupDatabase(snapshot, master);
  // Sealed year packages (server/year-packages.ts) as the copied database registers them: encrypted once into yillar/ beside
  // the backup folders and only referred to here, by their SHA-256.
  const packages: PackageEntry[] = [];
  for (const p of registeredPackages(snapshot)) {
    const blob = await ensureBlob(join(outputRoot, YEAR_FOLDER), join(source, p.file), master, p);
    packages.push({ year: p.year, path: p.file, blob: blob.blob, size: p.size, hash: p.sha256, encSize: blob.encSize, encHash: blob.encSha256 });
  }
  if (packages.length) { manifest.format = 2; manifest.packages = packages; }
  // A protected backup never carries a raw key, even one left over by an interrupted migration. Year packages go by reference.
  const skip = (n: string) => n === '.mola-operation.lock' || /^merchant\.sqlite(?:-wal|-shm)?$/.test(n) || n.startsWith('backups/') || n === RAW_WIPE || /\.tmp$/.test(n) || (!!protection && n === RAW_KEY) || PACKAGE_FILE.test(n);
  for (const name of (await list(source)).filter(n => !skip(n))) {
    const path = contained(source, name), blob = `${manifest.files.length}.bin`;
    await encrypt(path, join(target, blob), key, name);
    manifest.files.push({ path: name, blob, size: (await fs.stat(path)).size, hash: await hash(path) });
  }
  const blob = `${manifest.files.length}.bin`;
  await encrypt(snapshot, join(target, blob), key, 'merchant.sqlite');
  manifest.files.push({ path: 'merchant.sqlite', blob, size: (await fs.stat(snapshot)).size, hash: await hash(snapshot) });
  await fs.unlink(snapshot);
  const plain = join(target, '.manifest.json'); await fs.writeFile(plain, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  await encrypt(plain, join(target, 'manifest.bin'), key, 'mola-backup-v1'); await fs.unlink(plain);
  const completion: Completion = { format: manifest.format, createdAt: manifest.createdAt, files: manifest.files.length, ...(packages.length ? { packages: packages.map(p => ({ year: p.year, blob: p.blob, size: p.encSize, sha256: p.encHash })) } : {}) };
  await fs.writeFile(join(target, 'complete.partial'), JSON.stringify(completion), { flag: 'wx' });
  await fs.unlink(progress);
  await fs.rename(join(target, 'complete.partial'), join(target, 'complete.json'));
  return { directory: target, keyPath, files: manifest.files.length, protected: !!protection, packages: packages.length };
  } catch (error) {
    await Promise.allSettled([
      fs.writeFile(join(target, 'BACKUP_FAILED.txt'), 'Yedek doğrulanamadı veya tamamlanamadı. Kullanmayın.'),
      fs.rm(join(target, '.snapshot.sqlite'), { force: true }),
      fs.rm(join(target, '.manifest.json'), { force: true }),
    ]);
    throw error;
  }
}
/**
 * Restore into a newly allocated directory only. Existing/live data is never overwritten.
 * secret: the old raw key file, or for a protected backup the master key (this computer) or the recovery code (a new one).
 * The result carries the master key and recovery block of a protected backup, so the caller can lock it for this computer.
 */
/**
 * `packages`: 'full' (a real restore) decrypts every year package next to the restored database and checks it like the
 * database; 'check' (the nightly proof) only checks that each one is there with its encrypted size: they never change, the
 * weekly check reads their SHA-256 and a monthly one opens every row.
 */
export async function restoreBackup(backup: string, secret: BackupSecret, outputRoot: string, options: { packages?: 'full' | 'check' } = {}): Promise<{ directory: string; files: number; packages: number; master?: Buffer; recovery?: RecoveryBlock; installId?: string; owners?: OwnerBlock[] }> {
  if (!await exists(join(backup, 'complete.json')) || await exists(join(backup, 'BACKUP_IN_PROGRESS.txt')) || await exists(join(backup, 'BACKUP_FAILED.txt'))) throw new Error('Yedek tamamlanmamış.');
  const completion = JSON.parse(await fs.readFile(join(backup, 'complete.json'), 'utf8')) as Completion;
  if ((completion.format !== 1 && completion.format !== 2) || !Number.isSafeInteger(completion.files) || completion.files < 2 || !Number.isFinite(Date.parse(completion.createdAt))) throw new Error('Yedek tamamlanma kaydı geçersiz.');
  let key: Buffer, master: Buffer | undefined, wrapper: Awaited<ReturnType<typeof readBackupKeyFile>>;
  if (typeof secret === 'string') key = await fs.readFile(secret);
  else {
    wrapper = await readBackupKeyFile(backup);
    if (!wrapper) throw new DomainError('OLD_BACKUP', 'Bu yedek eski biçimde: kurtarma koduyla değil, ayrı anahtar dosyasıyla açılır.', 409);
    master = 'master' in secret ? secret.master : 'password' in secret ? await masterFromPassword(wrapper, secret.username, secret.password) : await masterFromCode(wrapper, secret.code);
    key = openBackupKey(wrapper, master);
  }
  if (key.length !== 32) throw new Error('Yedek anahtarı geçersiz.');
  ({ backup, outputRoot } = await restorePaths(backup, typeof secret === 'string' ? secret : undefined, outputRoot));
  await fs.mkdir(outputRoot, { recursive: true });
  const target = await fs.mkdtemp(join(resolve(outputRoot), 'restore-'));
  const progressPath = join(target, 'RESTORE_IN_PROGRESS.txt');
  await fs.writeFile(progressPath, 'Geri yükleme doğrulaması henüz tamamlanmadı.', { flag: 'wx' });
  const manifestPath = join(target, '.manifest.json');
  try {
    await decrypt(join(backup, 'manifest.bin'), manifestPath, key, 'mola-backup-v1');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Manifest;
    if ((manifest.format !== 1 && manifest.format !== 2) || !Array.isArray(manifest.files) || manifest.files.length > 100000) throw new Error('Yedek biçimi geçersiz.');
    if (completion.files !== manifest.files.length || completion.createdAt !== manifest.createdAt || completion.format !== manifest.format) throw new Error('Yedek tamamlanma kaydı uyuşmuyor.');
    const packages = manifest.format === 2 ? manifest.packages ?? [] : [];
    if (!Array.isArray(packages) || packages.length > 200 || packages.some(p => !/^\d{4}$/.test(p.year) || p.path !== packageFile(p.year) || !BLOB_NAME.test(p.blob) || !/^[a-f0-9]{64}$/.test(p.hash) || !/^[a-f0-9]{64}$/.test(p.encHash) || !Number.isSafeInteger(p.size) || !Number.isSafeInteger(p.encSize))) throw new Error('Yedeğin yıl paketi listesi geçersiz.');
    const seen = new Set<string>();
    for (const entry of manifest.files) {
      if (typeof entry.path !== 'string' || !/^\d+\.bin$/.test(entry.blob) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.hash) || seen.has(entry.path.toLowerCase())) throw new Error('Yedek dosya listesi geçersiz.');
      seen.add(entry.path.toLowerCase()); const file = contained(target, entry.path);
      await fs.mkdir(dirname(file), { recursive: true }); await decrypt(join(backup, entry.blob), file, key, entry.path);
      if ((await fs.stat(file)).size !== entry.size || await hash(file) !== entry.hash) throw new Error('Yedek bütünlüğü doğrulanamadı.');
    }
    // Old backups carry the raw key; protected ones the protected key file, opened with the master key from above.
    if (!seen.has('merchant.sqlite') || (!seen.has(RAW_KEY) && !(master && seen.has(KEY_FILE)))) throw new Error('Yedekte veritabanı veya veri anahtarı eksik.');
    await fs.unlink(manifestPath);
    const dataKey = seen.has(RAW_KEY) ? await fs.readFile(join(target, RAW_KEY)) : master!;
    await validateBackupDatabase(join(target, 'merchant.sqlite'), dataKey);
    // Year packages: exactly those the restored database registers, each found (yillar/ beside the backup, or inside it), and
    // for a real restore decrypted, checked against its SHA-256 and opened row by row like the database.
    const registered = registeredPackages(join(target, 'merchant.sqlite'));
    if (registered.length !== packages.length || registered.some(r => !packages.some(p => p.year === r.year && p.hash === r.sha256 && p.size === r.size))) throw new Error('Yedekteki yıl paketleri veritabanıyla uyuşmuyor.');
    for (const p of packages) {
      const found = packageFolders(backup).map(dir => join(dir, p.blob)).find(path => existsSync(path));
      if (!found) throw new Error(`${p.year} yıl paketi bulunamadı. Yedek klasörünün yanındaki "yillar" klasörü de gerekir.`);
      if ((await fs.stat(found)).size !== p.encSize) throw new Error(`${p.year} yıl paketi eksik ya da bozuk.`);
      if (options.packages === 'check') continue;
      const file = join(target, p.path);
      try { await decryptPackage(found, file, dataKey, { year: p.year, sha256: p.hash }); }
      catch { throw new Error(`${p.year} yıl paketi açılamadı (bozuk ya da başka kuruluma ait).`); }
      if (await fileSha256(file) !== p.hash) throw new Error(`${p.year} yıl paketi bütünlüğü doğrulanamadı.`);
    }
    if (options.packages !== 'check' && packages.length) await validatePackages(target, dataKey);
    await fs.unlink(progressPath);
    return { directory: target, files: manifest.files.length, packages: packages.length, ...(master && wrapper ? { master, recovery: wrapper.recovery, installId: wrapper.installId, ...(wrapper.owners?.length ? { owners: wrapper.owners } : {}) } : {}) };
  } catch (e) { await fs.writeFile(join(target, 'RESTORE_FAILED.txt'), 'Geri yükleme doğrulanamadı. Bu dizini uygulama verisi olarak kullanmayın.'); throw e; }
}

/**
 * Whole-database SQLite work (VACUUM INTO, quick_check) in a worker thread: on years of history it takes seconds, and the
 * automatic backup may run while the café is open (2 minutes after a morning start). The code is inline so that the
 * bundled server needs no separate worker file.
 */
export function sqliteJob(job: { vacuum: [string, string] } | { check: string }) {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(`const { workerData: job, parentPort } = require('node:worker_threads');
      process.removeAllListeners('warning');
      const { DatabaseSync } = require('node:sqlite');
      if (job.vacuum) { const db = new DatabaseSync(job.vacuum[0]); try { db.prepare('VACUUM INTO ?').run(job.vacuum[1]); } finally { db.close(); } parentPort.postMessage('ok'); }
      else { const db = new DatabaseSync(job.check, { readOnly: true }); try { parentPort.postMessage(String(Object.values(db.prepare('PRAGMA quick_check').get() ?? {})[0])); } finally { db.close(); } }`, { eval: true, workerData: job });
    let answer: string | undefined;
    worker.once('message', (value: string) => { answer = value; });
    worker.once('error', reject);
    worker.once('exit', code => answer !== undefined && code === 0 ? resolve(answer) : reject(new Error('Veritabanı işlemi tamamlanamadı.')));
  });
}
/**
 * Rows sealed with a business's own key beside its history: Ajanda notes (server/agenda.ts), Bildirimler (üst çubuktaki zil)
 * (server/notifications.ts) and delivery platform credentials (server/integrations/secrets.ts). Opened like history rows;
 * older backups simply lack the tables.
 */
const SEALED_OWNER: typeof SEALED_HISTORY = [
  ['agenda_notes', 'tenant,id,payload', r => `agenda:${r.tenant}:${r.id}`], ['notifications', 'tenant,id,payload', r => `notification:${r.tenant}:${r.id}`],
  ['integration_secrets', 'tenant,platform,payload', r => `integration-secret:${r.tenant}:${r.platform}`],
  // Stok: items, recipe versions and entries (server/stock.ts).
  ['stock_records', 'tenant,kind,id,payload', r => `stock:${r.tenant}:${r.kind}:${r.id}`],
  // Gün sonu kasası (server/cash-closing.ts) and vardiya takibi (server/shifts.ts).
  ['cash_records', 'tenant,id,payload', r => `cash:${r.tenant}:${r.id}`], ['staff_shifts', 'tenant,id,payload', r => `shift:${r.tenant}:${r.id}`],
  ['shift_codes', 'tenant,payload', r => `shift-code:${r.tenant}`], ['staff_activity', 'tenant,day,payload', r => `activity:${r.tenant}:${r.day}`],
  // Ajanda ve rezervasyon: finished reservations and closed events (server/reservations.ts).
  ['reservation_records', 'tenant,kind,id,payload', r => `reservation:${r.tenant}:${r.kind}:${r.id}`],
  // A finished event's report row, kept once worked out (server/reservations.ts finalReport).
  ['event_reports', 'tenant,id,payload', r => `event-report:${r.tenant}:${r.id}`]];
/** The year packages a database registers (history_meta 'package:<year>'), oldest first; none in older data. */
export function registeredPackages(databasePath: string): PackageInfo[] {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history_meta'").get()) return [];
    return (db.prepare("SELECT key,value FROM history_meta WHERE key LIKE 'package:%'").all() as { key: string; value: string }[])
      .filter(r => /^package:\d{4}$/.test(r.key)).map(r => JSON.parse(r.value) as PackageInfo)
      // A crafted backup cannot point a package at another folder or a network path: the name is always the year's own.
      .filter(p => typeof p?.year === 'string' && /^\d{4}$/.test(p.year) && p.file === packageFile(p.year)).sort((a, b) => a.year.localeCompare(b.year));
  } finally { db.close(); }
}
/**
 * The year packages next to a (restored) database: each the size and SHA-256 its registry says, SQLite's own check, and every
 * sealed row opened with its business's key (businesses of this database only).
 */
export async function validatePackages(directory: string, dataKey: Buffer) {
  const live = new DatabaseSync(join(directory, 'merchant.sqlite'), { readOnly: true });
  try {
    const tenants = (live.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).map(r => r.tenant);
    const keys = new Map(tenants.map(t => [t, snapshotKey(live, dataKey, t) ?? dataKey]));
    for (const p of registeredPackages(join(directory, 'merchant.sqlite'))) {
      const path = join(directory, p.file);
      if (!existsSync(path) || (await fs.stat(path)).size !== p.size || await fileSha256(path) !== p.sha256) throw new Error(`${p.year} yıl paketi eksik ya da bozuk.`);
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        if (String(Object.values(db.prepare('PRAGMA quick_check').get() ?? {})[0]) !== 'ok') throw new Error(`${p.year} yıl paketinin veritabanı bütünlüğü bozuk.`);
        let pauseAt = performance.now() + 25;
        for (const spec of PACKAGE_TABLES) {
          if (!spec.scope || !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(spec.table)) continue;
          for (const row of db.prepare(`SELECT ${spec.columns} FROM ${spec.table}`).iterate() as Iterable<Record<string, string> & { payload: Uint8Array }>) {
            const key = keys.get(row.tenant); if (!key) throw new Error('Yıl paketinde işletmesi bulunmayan kayıt var.');
            open(Buffer.from(row.payload), key, spec.scope(row));
            if (performance.now() > pauseAt) { await new Promise(r => setImmediate(r)); pauseAt = performance.now() + 25; }
          }
        }
      } finally { db.close(); }
    }
  } finally { live.close(); }
}
/** Shared read-only validation for both backup creation and restoration. */
export async function validateBackupDatabase(databasePath: string, keySource: string | Buffer) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assertDataVersion(db);
      if (await sqliteJob({ check: databasePath }) !== 'ok') throw new Error('Veritabanı bütünlüğü bozuk.');
      const dataKey = typeof keySource === 'string' ? await fs.readFile(keySource) : keySource;
      if (dataKey.length !== 32) throw new Error('Yedekte veri anahtarı geçersiz.');
      const states = new Map((db.prepare('SELECT tenant,payload FROM snapshots').all() as { tenant: string; payload: Uint8Array }[]).map(row => [row.tenant, readSnapshot(db, dataKey, row.tenant, row.payload)]));
      for (const [tenant, state] of states) if (state.tenantId !== tenant) throw new Error('Yedekte işletme kimliği uyuşmuyor.');
      for (const table of ['staff_credentials', 'business_directory'] as const) {
        // Older backups may predate the whole table; a present table must be complete and current.
        if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
        const rows = db.prepare(`SELECT tenant,payload FROM ${table}`).all() as { tenant: string; payload: Uint8Array }[];
        if (rows.length !== states.size) throw new Error('Yedekte işletme özetleri eksik veya fazla.');
        for (const row of rows) {
          const state = states.get(row.tenant);
          if (!state || state.tenantId !== row.tenant) throw new Error('Yedekte işletme kimliği uyuşmuyor.');
          const actual = unseal(Buffer.from(row.payload), dataKey, `${table === 'staff_credentials' ? 'credentials' : 'directory'}:${row.tenant}`);
          // A directory row from before `sector` existed is still current in every other field; data and older backups stay usable.
          const expected: object = table === 'staff_credentials' ? loginUsers(state.staffUsers ?? []) : (({ sector, ...rest }) => legacyDirectoryRow(actual) ? rest : { sector, ...rest })(businessDirectoryEntry(state));
          if (!isDeepStrictEqual(actual, JSON.parse(JSON.stringify(expected)))) throw new Error('Yedekte hesap veya yönetim özeti asıl kayıtla uyuşmuyor.');
        }
      }
      // Long-term history (data version 2): every row must belong to a business in this backup and open with its key.
      const keys = new Map([...states.keys()].map(tenant => [tenant, snapshotKey(db, dataKey, tenant) ?? dataKey]));
      // Every sealed row is opened (and unpacked, data version 3); short pauses let a running server answer requests in between.
      let pauseAt = performance.now() + 25;
      for (const [table, columns, scope] of [...SEALED_HISTORY, ...SEALED_OWNER]) {
        if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
        for (const row of db.prepare(`SELECT ${columns} FROM ${table}`).iterate() as Iterable<Record<string, string> & { payload: Uint8Array }>) {
          const key = keys.get(row.tenant); if (!key) throw new Error('Yedekte işletmesi bulunmayan geçmiş kaydı var.');
          open(Buffer.from(row.payload), key, scope(row));
          if (performance.now() > pauseAt) { await new Promise(r => setImmediate(r)); pauseAt = performance.now() + 25; }
        }
      }
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history_payments'").get() && (db.prepare('SELECT tenant FROM history_payments GROUP BY tenant').all() as { tenant: string }[]).some(r => !keys.has(r.tenant))) throw new Error('Yedekte işletmesi bulunmayan geçmiş kaydı var.');
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform'").get()) {
        for (const row of db.prepare('SELECT payload FROM platform').all() as { payload: Uint8Array }[]) unseal(Buffer.from(row.payload), dataKey, 'platform');
      }
      // The Mola Merkez link (install credentials, licences, queued tickets) travels with the data and opens with its key.
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='merkez_link'").get()) {
        for (const row of db.prepare('SELECT payload FROM merkez_link').all() as { payload: Uint8Array }[]) open(Buffer.from(row.payload), dataKey, 'merkez-link');
      }
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='merkez_activation'").get()) {
        for (const row of db.prepare('SELECT payload FROM merkez_activation').all() as { payload: Uint8Array }[]) open(Buffer.from(row.payload), dataKey, 'merkez-activation');
      }
    } finally { db.close(); }
}
