import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DomainError } from '../packages/domain/engine.js';
import { open as openSealed } from './sealing.js';
import { plainError } from './backup-errors.js';
import { fileLock, OsLockError, platformOsLock, type OsLock, type OsLockKind } from './os-lock.js';

/*
 * Master key protection. Data folder files:
 *   anahtar.json, anahtar.yedek.json  same content: the master key sealed twice. Either lock opens it:
 *     osLock    this computer's user (Windows DPAPI, macOS Keychain; Linux: plain, "korumasız")
 *     recovery  a 24-character recovery code, through scrypt and AES-256-GCM
 *   development.key  the old raw key (development, tests, installs from before). Migrated away in protected mode.
 * The raw key and the recovery code are never written in protected mode, and never logged.
 */
export const KEY_FILE = 'anahtar.json', KEY_COPY = 'anahtar.yedek.json', RAW_KEY = 'development.key', RAW_WIPE = 'development.key.silinecek';
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 symbols: no 0/O or 1/I to mix up on paper
export type KdfParams = { N: number; r: number; p: number };
export type RecoveryBlock = { id: string; kdf: 'scrypt'; N: number; r: number; p: number; salt: string; iv: string; wrapped: string; tag: string; createdAt: string; shownAt?: string; confirmedAt?: string };
export type KeyFile = { v: 1; kind: 'mola-anahtar'; installId: string; check: string; osLock: { kind: OsLockKind; data: string }; recovery: RecoveryBlock; createdAt: string; updatedAt: string };
/** What a protected backup needs: the live key and the recovery block (copied into the backup, never the code). */
export type BackupProtection = { master: Buffer; recovery: RecoveryBlock; installId: string };

export function newRecoveryCode() {
  // b & 31 of a uniform byte is uniform over the 32 symbols: 24 symbols = 120 bits.
  return [...randomBytes(24)].map(b => ALPHABET[b & 31]).join('').replace(/(.{4})(?!$)/g, '$1-');
}
export function normalizeCode(input: string) {
  const plain = String(input).toUpperCase().replace(/[\s-]/g, '');
  if (plain.length !== 24 || [...plain].some(c => !ALPHABET.includes(c))) throw new DomainError('INVALID_CODE', 'Kurtarma kodu 24 harf ve rakamdan oluşur (ör. ABCD-EFGH-…). Kâğıttaki kodu kontrol edin.', 400);
  return plain;
}
export function keyCheck(master: Buffer) { return createHmac('sha256', master).update('mola:anahtar-kontrol:v1').digest('hex').slice(0, 32); }
const b64 = (b: Buffer) => b.toString('base64');
function kdfParams(p: { N: unknown; r: unknown; p: unknown }): KdfParams {
  const N = Number(p.N), r = Number(p.r), q = Number(p.p);
  // Bounds keep a damaged file from asking for gigabytes; the low end is for tests only.
  if (!Number.isInteger(N) || N < 2 ** 10 || N > 2 ** 20 || (N & (N - 1)) !== 0 || !Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(q) || q < 1 || q > 16) throw new Error('Kurtarma kaydının ayarları geçersiz.');
  return { N, r, p: q };
}
function derive(code: string, salt: Buffer, params: KdfParams) {
  // Runs on the libuv thread pool: the server keeps answering while it works (about half a second).
  return new Promise<Buffer>((resolve, reject) => scryptCallback(normalizeCode(code), salt, 32, { ...params, maxmem: 256 * params.N * params.r + 32 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
/** Measured once on this computer: memory-hard N=2^17 (128 MB), then p so one try takes 0.5–1 s (aim 0.75 s). */
export async function calibrateKdf(): Promise<KdfParams> {
  let N = 2 ** 17; const r = 8, salt = randomBytes(16);
  const started = performance.now(); await derive('2222-2222-2222-2222-2222-2222', salt, { N, r, p: 1 });
  let ms = performance.now() - started;
  // A slow café computer: halve memory (not below 2^15) instead of making every try take seconds.
  while (ms > 1200 && N > 2 ** 15) { N /= 2; ms /= 2; }
  return { N, r, p: Math.max(1, Math.min(8, Math.round(750 / Math.max(ms, 1)))) };
}
const aad = (installId: string, id: string) => Buffer.from(`mola:kurtarma:v1:${installId}:${id}`);
export async function wrapRecovery(master: Buffer, code: string, installId: string, params: KdfParams): Promise<RecoveryBlock> {
  const salt = randomBytes(16), iv = randomBytes(12), id = randomUUID();
  const kek = await derive(code, salt, params);
  try {
    const cipher = createCipheriv('aes-256-gcm', kek, iv); cipher.setAAD(aad(installId, id));
    const wrapped = Buffer.concat([cipher.update(master), cipher.final()]);
    return { id, kdf: 'scrypt', ...params, salt: b64(salt), iv: b64(iv), wrapped: b64(wrapped), tag: b64(cipher.getAuthTag()), createdAt: new Date().toISOString() };
  } finally { kek.fill(0); }
}
/** The master key from the recovery code; a wrong code fails the GCM check (after the full scrypt time). */
export async function openRecovery(block: RecoveryBlock, code: string, installId: string) {
  const plain = normalizeCode(code), kek = await derive(plain, Buffer.from(block.salt, 'base64'), kdfParams(block));
  try {
    const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(block.iv, 'base64')); decipher.setAAD(aad(installId, block.id)); decipher.setAuthTag(Buffer.from(block.tag, 'base64'));
    const master = Buffer.concat([decipher.update(Buffer.from(block.wrapped, 'base64')), decipher.final()]);
    if (master.length !== 32) throw new Error('length');
    return master;
  } catch { throw new DomainError('WRONG_CODE', 'Kurtarma kodu yanlış. Kâğıttaki kodu harf harf kontrol edin.', 403); }
  finally { kek.fill(0); }
}
/** The recovery block as it travels with a backup: without the "shown"/"saved" marks of this computer. */
export const portableRecovery = ({ shownAt: _s, confirmedAt: _c, ...block }: RecoveryBlock): RecoveryBlock => block;

// ---------- Files ----------
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** tmp + fsync + rename: the old file stays whole until the new one is complete. Antivirus/OneDrive may hold it a moment. */
export function writeAtomic(path: string, text: string, step: (name: string) => void = () => {}) {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'wx', 0o600);
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  step('gecici-yazildi');
  for (let attempt = 0; ; attempt++) {
    try { renameSync(tmp, path); return; }
    catch (error) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { rmSync(tmp, { force: true }); throw error; }
      sleep(100 * (attempt + 1));
    }
  }
}
/** Overwrites with random bytes before unlinking. On SSDs this is best effort; disk encryption is the real guard. */
export function wipeFile(path: string, step: (name: string) => void = () => {}) {
  if (!existsSync(path)) return;
  const size = statSync(path).size, fd = openSync(path, 'r+');
  try { writeSync(fd, randomBytes(Math.max(size, 32)), 0, Math.max(size, 32), 0); fsyncSync(fd); } finally { closeSync(fd); }
  step('uzerine-yazildi');
  unlinkSync(path);
}
function validKeyFile(value: unknown): value is KeyFile {
  const f = value as KeyFile, r = f?.recovery;
  return !!f && f.v === 1 && f.kind === 'mola-anahtar' && /^[a-f0-9-]{36}$/.test(f.installId) && /^[a-f0-9]{32}$/.test(f.check) &&
    ['dpapi', 'keychain', 'file'].includes(f.osLock?.kind) && typeof f.osLock.data === 'string' && !!r && typeof r.id === 'string' && r.kdf === 'scrypt' &&
    [r.salt, r.iv, r.wrapped, r.tag].every(v => typeof v === 'string' && /^[A-Za-z0-9+/=]+$/.test(v)) && (() => { try { kdfParams(r); return true; } catch { return false; } })();
}
/** The main file, or its copy when the main one is damaged. undefined: neither exists. */
export function readKeyFile(directory: string): KeyFile | undefined {
  let found = false;
  for (const name of [KEY_FILE, KEY_COPY]) {
    const path = join(directory, name);
    if (!existsSync(path)) continue;
    found = true;
    try { const value = JSON.parse(readFileSync(path, 'utf8')); if (validKeyFile(value)) return value; } catch { /* try the copy */ }
  }
  if (found) throw new Error('Anahtar dosyası (anahtar.json) ve kopyası bozuk. Verileri yedekten ve kurtarma koduyla geri yükleyin.');
  return undefined;
}
export function writeKeyFile(directory: string, file: KeyFile, step: (name: string) => void = () => {}) {
  const text = JSON.stringify(file, null, 2) + '\n';
  writeAtomic(join(directory, KEY_FILE), text, step); step('ana-yazildi');
  writeAtomic(join(directory, KEY_COPY), text); step('kopya-yazildi');
}
function readRawKey(path: string) {
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error('development.key geçersiz (32 bayt olmalı).');
  return key;
}
/** Development and tests: the raw key file next to the data, as before. */
export function legacyKey(directory: string) {
  const path = join(directory, RAW_KEY);
  if (!existsSync(path) && existsSync(join(directory, 'merchant.sqlite'))) throw new Error('Yerel anahtar eksik. Veritabanı için yeni anahtar üretilemez.');
  if (!existsSync(path)) writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' });
  return readFileSync(path);
}
/** Whether this key opens the business data in the folder (no data yet: nothing to contradict it). */
export function keyOpensData(directory: string, key: Buffer) {
  const path = join(directory, 'merchant.sqlite');
  if (!existsSync(path)) return true;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    // The first sealed row of the first table that has one decides: it opens with this key or it does not.
    const attempt = (table: 'tenant_keys' | 'platform' | 'snapshots', scope: (row: { tenant?: string }) => string) => {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) return undefined;
      const row = db.prepare(`SELECT ${table === 'platform' ? 'payload' : 'tenant,payload'} FROM ${table} LIMIT 1`).get() as { tenant?: string; payload: Uint8Array } | undefined;
      if (!row) return undefined;
      try { openSealed(Buffer.from(row.payload), key, scope(row)); return true; } catch { return false; }
    };
    return attempt('tenant_keys', r => `tenant-key:${r.tenant}`) ?? attempt('platform', () => 'platform') ?? attempt('snapshots', r => r.tenant!) ?? true;
  } finally { db.close(); }
}
function removeStaleTemps(directory: string) {
  for (const name of readdirSync(directory)) if (/^anahtar(\.yedek)?\.json\.[a-f0-9]{8}\.tmp$/.test(name)) rmSync(join(directory, name), { force: true });
}

// ---------- Attempts ----------
/** Recovery code tries: one at a time and at most 5 wrong ones per 10 minutes (scrypt also costs ~0.5 s each). */
export class AttemptLimiter {
  private failures: number[] = []; private busy = false;
  constructor(private max = 5, private windowMs = 600_000, private now = () => Date.now()) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const t = this.now(); this.failures = this.failures.filter(at => at > t - this.windowMs);
    if (this.failures.length >= this.max) throw new DomainError('RATE_LIMIT', `Çok fazla yanlış deneme. ${Math.round(this.windowMs / 60_000)} dakika sonra tekrar deneyin.`, 429);
    if (this.busy) throw new DomainError('RATE_LIMIT', 'Önceki deneme sürüyor. Birkaç saniye bekleyin.', 429);
    this.busy = true;
    try { return await fn(); }
    // A typo in the format is answered at once and costs no scrypt; only real tries count.
    catch (error) { if (error instanceof DomainError && error.code === 'WRONG_CODE') this.failures.push(this.now()); throw error; }
    finally { this.busy = false; }
  }
}

// ---------- Vault ----------
export type VaultOptions = {
  /** Packaged/desktop runs. Off: development and tests keep the raw key file (an existing anahtar.json is still honoured). */
  protect: boolean;
  osLock?: OsLock;
  /** Tests: cheap scrypt. Production measures this computer once. */
  kdf?: KdfParams;
  /** Tests: called between the steps of a migration, to cut it short like a power cut would. */
  onStep?: (step: string) => void;
};
export type RecoveryView = { protection: 'off' | OsLockKind; protectedAtRest: boolean; available: boolean; confirmed: boolean; shown: boolean; createdAt: string | null; warning: string | null };

export class KeyVault {
  state: 'open' | 'locked' = 'open';
  key?: Buffer;
  /** Why the OS lock did not open the key (shown on the locked screen, no secrets). */
  lockReason?: string;
  /** Protection could not be set up or renewed; the café keeps working, the panel shows this. */
  warning?: string;
  private file?: KeyFile;
  /** The new recovery code, in memory only, until "Kodu kaydettim". Gone after a restart. */
  private pending?: string;
  readonly osLock: OsLock;
  private constructor(readonly directory: string, private options: VaultOptions) { this.osLock = options.osLock ?? platformOsLock(); }
  static async open(directory: string, options: VaultOptions) {
    const vault = new KeyVault(directory, options);
    await vault.load();
    return vault;
  }
  get protection(): 'off' | OsLockKind { return this.file ? this.file.osLock.kind : 'off'; }
  get installId() { return this.file?.installId; }
  private step(name: string) { this.options.onStep?.(name); }
  private async load() {
    const dir = this.directory; mkdirSync(dir, { recursive: true }); removeStaleTemps(dir);
    const raw = join(dir, RAW_KEY), wiping = join(dir, RAW_WIPE);
    const stored = readKeyFile(dir);
    if (!stored) {
      // Only if anahtar.json was removed by hand: a raw key set aside for wiping may still be whole, and is the only key.
      if (existsSync(wiping) && !existsSync(raw)) renameSync(wiping, raw);
      if (!this.options.protect) { this.key = legacyKey(dir); return; }
      if (existsSync(raw)) return this.migrate(readRawKey(raw));
      if (existsSync(join(dir, 'merchant.sqlite'))) throw new Error('Yerel anahtar eksik. Veritabanı için yeni anahtar üretilemez.');
      return this.create(randomBytes(32));
    }
    // A raw key next to a key file: a migration was cut short before the raw key was set aside, so the raw key is whole.
    // Only a key that really opens this data is used; any other is left alone.
    if (existsSync(raw)) {
      const candidate = readRawKey(raw);
      if (keyOpensData(dir, candidate)) {
        if (!this.options.protect) { this.key = candidate; return; }
        // The key file holds this same key and this computer opens it: keep it (its code may already be on paper), give it
        // a fresh code if nobody saw the one inside, and only then let the raw copy go. Otherwise migrate again from the raw key.
        if (keyCheck(candidate) === stored.check && await this.osOpen(stored).then(k => k.equals(candidate), () => false)) {
          this.file = stored; this.key = candidate;
          if (!stored.recovery.shownAt && !stored.recovery.confirmedAt) await this.regenerate();
          renameSync(raw, wiping); wipeFile(wiping);
          this.protectSafetyCopies();
          return;
        }
        return this.migrate(candidate);
      }
      console.warn('development.key bu veriyi açmıyor; dokunulmadı, anahtar.json kullanılıyor.');
    }
    this.file = stored;
    let key: Buffer | undefined;
    try { key = await this.osOpen(stored); }
    catch (error) { this.lockReason = plainError(error, 'Windows kilidi açılamadı.'); }
    let fromWipe = false;
    if (existsSync(wiping)) {
      // The key file was verified before the raw key was set aside; wipe it only once the key file really opened.
      if (key) wipeFile(wiping);
      else {
        let old: Buffer | undefined; try { old = readRawKey(wiping); } catch { /* already overwritten */ }
        if (old && keyCheck(old) === stored.check) { key = old; fromWipe = true; }
      }
    }
    if (!key) { this.state = 'locked'; return; }
    this.key = key; this.lockReason = undefined;
    // Re-lock for this computer when the file came from elsewhere (a "file" lock from Linux) or from the wipe fallback.
    if (fromWipe || (this.osLock.protects && stored.osLock.kind !== this.osLock.kind)) {
      try { await this.reprotect(); if (fromWipe) wipeFile(wiping); }
      catch { this.warning = 'Anahtar bu bilgisayar için kilitlenemedi. Bir sonraki açılışta yeniden denenecek.'; }
    }
    // Nobody ever saw this recovery code (the start that made it ended first): replace it, so the one shown is the one that works.
    if (!stored.recovery.shownAt && !stored.recovery.confirmedAt) await this.regenerate();
    this.protectSafetyCopies();
  }
  /**
   * "<data>-tasima-oncesi-*" copies (made once before a data version upgrade) hold the raw key next to the data. With
   * protection on they get the protected key files instead, and the raw key is wiped. Such a copy then opens only with the
   * current Mola (this computer's user or the recovery code), not with the old app version it was kept for.
   */
  private protectSafetyCopies() {
    if (!this.options.protect || !this.file || !this.key || !this.osLock.protects) return;
    const parent = dirname(resolve(this.directory)), prefix = `${basename(resolve(this.directory))}-tasima-oncesi-`;
    let names: string[]; try { names = readdirSync(parent).filter(n => n.startsWith(prefix)); } catch { return; }
    for (const name of names) {
      const copy = join(parent, name), raw = join(copy, RAW_KEY);
      try {
        if (!existsSync(raw) || !readFileSync(raw).equals(this.key)) continue;
        writeKeyFile(copy, this.file); wipeFile(raw);
        appendFileSync(join(copy, 'BENIOKU.txt'), 'Anahtar korumaya alındı (anahtar.json): bu kopya yalnız güncel Mola ile, bu bilgisayarın kullanıcısıyla ya da kurtarma koduyla açılır.\n');
      } catch { /* tried again at the next start */ }
    }
  }
  private async osOpen(file: KeyFile) {
    const lock = file.osLock.kind === this.osLock.kind ? this.osLock : file.osLock.kind === 'file' ? fileLock : undefined;
    if (!lock) throw new OsLockError('Bu anahtar başka bir işletim sisteminin kilidiyle korunuyor.', true);
    for (let attempt = 0; ; attempt++) {
      try {
        const key = await lock.open(file.osLock.data, file.installId);
        if (!timingSafeEqual(Buffer.from(keyCheck(key)), Buffer.from(file.check))) throw new OsLockError('Kilitten gelen anahtar bu veriye ait değil.', true);
        return key;
      } catch (error) {
        // "Could not ask" (PowerShell slow to start, antivirus): try again before calling the data locked.
        if (attempt >= 2 || !(error instanceof OsLockError) || error.denied) throw error;
      }
    }
  }
  /** Writes a new key file (both locks), reads it back and opens it both ways before anyone relies on it. */
  private async create(master: Buffer) {
    const code = newRecoveryCode(), installId = randomUUID(), now = new Date().toISOString();
    const file: KeyFile = { v: 1, kind: 'mola-anahtar', installId, check: keyCheck(master), osLock: { kind: this.osLock.kind, data: await this.osLock.seal(master, installId) }, recovery: await wrapRecovery(master, code, installId, this.options.kdf ?? await calibrateKdf()), createdAt: now, updatedAt: now };
    this.step('basla');
    writeKeyFile(this.directory, file, name => this.step(name));
    const back = readKeyFile(this.directory)!;
    if (!(await this.osOpen(back)).equals(master) || !(await openRecovery(back.recovery, code, installId)).equals(master)) throw new OsLockError('Yeni anahtar dosyası doğrulanamadı.', false);
    this.step('dogrulandi');
    this.file = back; this.key = master; this.pending = code;
  }
  /**
   * development.key → anahtar.json. At every step either the raw key is whole, or the key file was verified with both locks:
   *   key file written + verified → raw key renamed to .silinecek → overwritten → deleted.
   * A start that finds the raw key next to a key file migrates again; one that finds .silinecek wipes it once the key file opens.
   */
  private async migrate(raw: Buffer) {
    if (!keyOpensData(this.directory, raw)) throw new Error('development.key bu veritabanını açmıyor. Dosyalara dokunulmadı; doğru anahtarı geri koyun.');
    try { await this.create(raw); }
    catch (error) {
      if (!(error instanceof OsLockError)) throw error;
      // The OS lock did not answer (PowerShell blocked, keychain locked): keep working with the raw key as before,
      // show a warning, and try again at the next start. The raw key was not touched.
      for (const name of [KEY_FILE, KEY_COPY]) rmSync(join(this.directory, name), { force: true });
      this.file = undefined; this.pending = undefined; this.key = raw;
      this.warning = 'Anahtar korumaya alınamadı (işletim sistemi kilidi yanıt vermedi). Bir sonraki açılışta yeniden denenecek.';
      return;
    }
    renameSync(join(this.directory, RAW_KEY), join(this.directory, RAW_WIPE)); this.step('kenara-alindi');
    wipeFile(join(this.directory, RAW_WIPE), name => this.step(name)); this.step('bitti');
    this.protectSafetyCopies();
  }
  /** Locked → open with the recovery code; then locked again for this computer's user. */
  async unlock(code: string) {
    if (this.state !== 'locked' || !this.file) throw new DomainError('NOT_LOCKED', 'Veriler zaten açık.', 409);
    const key = await openRecovery(this.file.recovery, code, this.file.installId);
    if (keyCheck(key) !== this.file.check) throw new DomainError('WRONG_CODE', 'Kurtarma kodu bu verilere ait değil.', 403);
    this.key = key; this.state = 'open'; this.lockReason = undefined;
    // The code just worked, so the owner has it: it counts as saved.
    try { await this.reprotect(true); this.warning = undefined; }
    catch { this.warning = 'Windows kilidi yenilenemedi. Bir sonraki açılışta yine kurtarma kodu gerekebilir.'; }
  }
  /** Proof that the person at this computer holds the recovery code (the owner's forgotten password); changes nothing. */
  async verify(code: string) {
    if (this.state !== 'open' || !this.file || !this.key) throw new DomainError('NO_PROTECTION', 'Bu kurulumda anahtar koruması yok.', 409);
    const key = await openRecovery(this.file.recovery, code, this.file.installId);
    if (!key.equals(this.key)) throw new DomainError('WRONG_CODE', 'Kurtarma kodu bu verilere ait değil.', 403);
  }
  /** The OS lock again (e.g. it did not answer in time at start). */
  async retry() {
    if (this.state !== 'locked' || !this.file) return this.state === 'open';
    try { this.key = await this.osOpen(this.file); this.state = 'open'; this.lockReason = undefined; return true; }
    catch (error) { this.lockReason = plainError(error, this.lockReason ?? 'Windows kilidi açılamadı.'); return false; }
  }
  private async reprotect(confirmed = false) {
    const file = this.file!, key = this.key!, now = new Date().toISOString();
    const next: KeyFile = { ...file, osLock: { kind: this.osLock.kind, data: await this.osLock.seal(key, file.installId) }, recovery: confirmed ? { ...file.recovery, shownAt: file.recovery.shownAt ?? now, confirmedAt: file.recovery.confirmedAt ?? now } : file.recovery, updatedAt: now };
    if (!(await this.osLock.open(next.osLock.data, next.installId)).equals(key)) throw new OsLockError('Yeni kilit doğrulanamadı.', false);
    writeKeyFile(this.directory, next); this.file = next;
  }
  /** A new recovery code; the old one stops opening this key file at once. Returns the code (also kept until confirmed). */
  async regenerate() {
    if (this.state !== 'open' || !this.file || !this.key) throw new DomainError('NO_PROTECTION', 'Bu kurulumda anahtar koruması yok.', 409);
    const code = newRecoveryCode(), file = this.file;
    const recovery = await wrapRecovery(this.key, code, file.installId, this.options.kdf ?? kdfParams(file.recovery));
    writeKeyFile(this.directory, { ...file, recovery, updatedAt: new Date().toISOString() });
    const back = readKeyFile(this.directory)!;
    if (!(await openRecovery(back.recovery, code, back.installId)).equals(this.key)) throw new Error('Yeni kurtarma kodu doğrulanamadı.');
    this.file = back; this.pending = code;
    return code;
  }
  view(): RecoveryView {
    const r = this.file?.recovery;
    return { protection: this.protection, protectedAtRest: !!this.file && this.file.osLock.kind !== 'file', available: !!this.pending && !r?.confirmedAt, confirmed: !!r?.confirmedAt, shown: !!r?.shownAt, createdAt: r?.createdAt ?? null, warning: this.warning ?? null };
  }
  /** The pending code, for the screen that shows it. Marked as shown first, so a restart never silently replaces a code someone saw. */
  reveal() {
    if (!this.file || !this.pending || this.file.recovery.confirmedAt) throw new DomainError('NO_CODE', 'Gösterilecek yeni kurtarma kodu yok.', 409);
    if (!this.file.recovery.shownAt) { const next = { ...this.file, recovery: { ...this.file.recovery, shownAt: new Date().toISOString() } }; writeKeyFile(this.directory, next); this.file = next; }
    return this.pending;
  }
  /**
   * "Kaydettim": the owner types two groups of the code just shown (1-based group numbers), proof that it is on paper. After a
   * restart the code is no longer in memory, so then the whole code is asked instead (verify).
   */
  checkGroups(groups: { group: number; value: string }[]) {
    if (!this.pending) throw new DomainError('NO_CODE', 'Kod artık ekranda değil. Kâğıttaki kodun tamamını yazın.', 409);
    const parts = this.pending.split('-');
    const ok = groups.length >= 2 && new Set(groups.map(g => g.group)).size === groups.length && groups.every(g => parts[g.group - 1] !== undefined && parts[g.group - 1] === g.value.toUpperCase().replace(/[\s-]/g, ''));
    if (!ok) throw new DomainError('WRONG_GROUPS', 'Yazdığınız parçalar koddakiyle aynı değil. Kâğıda bakıp yeniden yazın.', 400);
  }
  confirm() {
    if (!this.file) throw new DomainError('NO_PROTECTION', 'Bu kurulumda anahtar koruması yok.', 409);
    const now = new Date().toISOString();
    if (!this.file.recovery.confirmedAt) { const next = { ...this.file, recovery: { ...this.file.recovery, shownAt: this.file.recovery.shownAt ?? now, confirmedAt: now } }; writeKeyFile(this.directory, next); this.file = next; }
    this.pending = undefined;
  }
  backupProtection(): BackupProtection | undefined {
    return this.state === 'open' && this.file && this.key ? { master: this.key, recovery: portableRecovery(this.file.recovery), installId: this.file.installId } : undefined;
  }
}

/**
 * A restored data folder on this computer: its key file is rewritten for this computer's OS lock, with the recovery block the
 * owner's code just opened (the backup's own copy of anahtar.json may still carry an older code). Verified before return.
 */
export async function adoptKey(directory: string, master: Buffer, recovery: RecoveryBlock, installId: string, osLock: OsLock = platformOsLock()) {
  const now = new Date().toISOString();
  const file: KeyFile = { v: 1, kind: 'mola-anahtar', installId, check: keyCheck(master), osLock: { kind: osLock.kind, data: await osLock.seal(master, installId) }, recovery: { ...portableRecovery(recovery), shownAt: now, confirmedAt: now }, createdAt: now, updatedAt: now };
  if (!(await osLock.open(file.osLock.data, installId)).equals(master)) throw new OsLockError('Anahtar bu bilgisayar için kilitlenemedi.', false);
  if (!keyOpensData(directory, master)) throw new Error('Geri yüklenen veri bu anahtarla açılmıyor.');
  writeKeyFile(directory, file);
  // A backup from before protection carries the raw key: once the key file holds it, the raw copy goes.
  const raw = join(directory, RAW_KEY);
  if (existsSync(raw) && readFileSync(raw).equals(master)) wipeFile(raw);
}
