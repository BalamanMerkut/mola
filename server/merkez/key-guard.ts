import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DomainError } from '../../packages/domain/engine.js';
import { plainError } from '../backup-errors.js';
import { KEY_COPY, KEY_FILE, keyCheck, openRecovery, RAW_KEY, wipeFile, writeKeyFile, type KdfParams, type KeyFile, type RecoveryBlock } from '../key-vault.js';
import { fileLock, OsLockError, platformOsLock, type OsLock, type OsLockKind } from '../os-lock.js';
import { open as openSealed } from '../sealing.js';
import { readRecoveryFile, type RecoveryFile } from './backup.js';

/*
 * Mola Merkez's data key, locked to the computer user (MERKEZ_KEY_PROTECTION=1, set by the installed Mola Yönetim).
 * The café's KeyVault (server/key-vault.ts) is left as it is; this uses its file format and helpers with Merkez's own rules:
 *
 *   anahtar.json, anahtar.yedek.json  the data key sealed twice (the café's format): `osLock` (Windows DPAPI, macOS Keychain,
 *                                     on Linux a passphrase from MERKEZ_KEY_PASSPHRASE[_FILE] or, without one, the file
 *                                     itself, mode 600) and `recovery` = the block of merkez-kurtarma.json, i.e. the SAME
 *                                     24-character Merkez recovery code the vendor saved in Ayarlar → Yedek. installId =
 *                                     merkezId (the recovery block's own id).
 *   development.key                   the plain key (development, tests, installs from before).
 *   development.key.tasindi           the plain key set aside by a verified migration. Kept until the first start that opens
 *                                     anahtar.json through the computer user's lock (then overwritten and deleted); until then
 *                                     a start whose lock fails uses it and locks the key again for this user. Rollback by hand:
 *                                     rename it to development.key and set MERKEZ_KEY_PROTECTION=0 (ayarlar.cmd).
 *
 * Migration (plain → protected) happens at a start only when the Merkez recovery code is CONFIRMED ("Kodu kaydettim"); else
 * Merkez keeps the plain key and Mola Yönetim asks for the code first (`view().waitingForCode`). Every step is verified, and a
 * failure removes the half-made key files: the plain key is never touched before anahtar.json opened both ways, and the
 * Merkez data itself never changes (same key).
 * Locked (the lock does not open the key: another user, a reset Windows password, another computer, a missing passphrase):
 * Merkez answers only its health check and the unlock screen (server/merkez/locked.ts); the recovery code opens the key and
 * it is locked again for this user.
 */
export const SAFETY_COPY = 'development.key.tasindi';
export type MerkezLockKind = OsLockKind | 'parola';
export type MerkezLock = Omit<OsLock, 'kind'> & { kind: MerkezLockKind };
type MerkezKeyFile = Omit<KeyFile, 'osLock'> & { osLock: { kind: MerkezLockKind; data: string } };
export type KeyProtectionView = {
  /** MERKEZ_KEY_PROTECTION=1 (the installed Mola Yönetim). */
  wanted: boolean;
  mode: 'plain' | 'protected';
  kind: MerkezLockKind | null;
  /** Locked to something outside the file (DPAPI, Keychain, a passphrase); false for 'file' and plain. */
  protectsAtRest: boolean;
  /** Protection wanted, still plain, and no confirmed recovery code: "Önce kurtarma kodunuzu kaydedin". */
  waitingForCode: boolean;
  /** The code is confirmed; the key is locked at the next start. */
  migratesAtNextStart: boolean;
  /** The plain copy set aside by the migration still exists (deleted at the first protected start). */
  safetyCopy: boolean;
  warning: string | null;
};
export type GuardOptions = {
  protect: boolean;
  osLock?: MerkezLock;
  /** Offline tools (Sifre-Sifirla) open the data as it is and never migrate. */
  migrate?: boolean;
  /** Tests: called between the steps of a migration, to cut it short like a power cut would. */
  onStep?: (step: string) => void;
};

// ---------- Linux / a VDS: a passphrase instead of an OS key store ----------
const PASS_KDF: KdfParams = { N: 2 ** 15, r: 8, p: 1 };
const passAad = (installId: string) => Buffer.from(`mola:merkez-parola:v1:${installId}`);
const derive = (secret: string, salt: Buffer, p: KdfParams) => new Promise<Buffer>((done, fail) => scryptCallback(secret, salt, 32, { ...p, maxmem: 256 * p.N * p.r + 32 * 1024 * 1024 }, (e, k) => e ? fail(e) : done(k)));
/** The key sealed with a passphrase (scrypt + AES-256-GCM). For a Merkez where the system has no key store (Linux). */
export function passphraseLock(passphrase: string, kdf: KdfParams = PASS_KDF): MerkezLock {
  if (passphrase.length < 12) throw new Error('MERKEZ_KEY_PASSPHRASE en az 12 karakter olmalı.');
  return {
    kind: 'parola', protects: true,
    async seal(key, installId) {
      const salt = randomBytes(16), iv = randomBytes(12), kek = await derive(passphrase, salt, kdf);
      try {
        const c = createCipheriv('aes-256-gcm', kek, iv); c.setAAD(passAad(installId));
        const wrapped = Buffer.concat([c.update(key), c.final()]);
        return Buffer.from(JSON.stringify({ v: 1, ...kdf, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), wrapped: wrapped.toString('base64') })).toString('base64');
      } finally { kek.fill(0); }
    },
    async open(data, installId) {
      let box: { N: number; r: number; p: number; salt: string; iv: string; tag: string; wrapped: string };
      try { box = JSON.parse(Buffer.from(data, 'base64').toString('utf8')); } catch { throw new OsLockError('Anahtar kaydı bozuk.', true); }
      if (![box.N, box.r, box.p].every(Number.isInteger) || box.N < 2 ** 10 || box.N > 2 ** 20 || box.r > 32 || box.p > 16) throw new OsLockError('Anahtar kaydı bozuk.', true);
      const kek = await derive(passphrase, Buffer.from(box.salt, 'base64'), { N: box.N, r: box.r, p: box.p });
      try {
        const d = createDecipheriv('aes-256-gcm', kek, Buffer.from(box.iv, 'base64')); d.setAAD(passAad(installId)); d.setAuthTag(Buffer.from(box.tag, 'base64'));
        const key = Buffer.concat([d.update(Buffer.from(box.wrapped, 'base64')), d.final()]);
        if (key.length !== 32) throw new Error('length');
        return key;
      } catch { throw new OsLockError('Parola bu anahtarı açmadı (MERKEZ_KEY_PASSPHRASE).', true); }
      finally { kek.fill(0); }
    },
  };
}
/**
 * The lock for this computer: Windows DPAPI / macOS Keychain; where the system has none (Linux), a passphrase from
 * MERKEZ_KEY_PASSPHRASE or the file named by MERKEZ_KEY_PASSPHRASE_FILE, else the plain file lock (mode 600).
 */
export function merkezOsLock(env: NodeJS.ProcessEnv = process.env): MerkezLock {
  const platform = platformOsLock();
  if (platform.protects) return platform;
  let pass = env.MERKEZ_KEY_PASSPHRASE ?? '';
  if (!pass && env.MERKEZ_KEY_PASSPHRASE_FILE) {
    try { pass = readFileSync(env.MERKEZ_KEY_PASSPHRASE_FILE, 'utf8').trim(); } catch { throw new Error('MERKEZ_KEY_PASSPHRASE_FILE okunamadı.'); }
  }
  return pass ? passphraseLock(pass) : fileLock;
}

// ---------- Files ----------
function validFile(value: unknown): value is MerkezKeyFile {
  const f = value as MerkezKeyFile, r = f?.recovery;
  return !!f && f.v === 1 && f.kind === 'mola-anahtar' && /^[a-f0-9-]{36}$/.test(f.installId) && /^[a-f0-9]{32}$/.test(f.check) &&
    ['dpapi', 'keychain', 'file', 'parola'].includes(f.osLock?.kind) && typeof f.osLock.data === 'string' && !!r && r.kdf === 'scrypt' && typeof r.id === 'string' &&
    [r.salt, r.iv, r.wrapped, r.tag].every(v => typeof v === 'string' && /^[A-Za-z0-9+/=]+$/.test(v)) && [r.N, r.r, r.p].every(Number.isInteger);
}
/** The main key file, or its copy when the main one is damaged; undefined when neither exists. */
export function readMerkezKeyFile(directory: string): MerkezKeyFile | undefined {
  let found = false;
  for (const name of [KEY_FILE, KEY_COPY]) {
    const path = join(directory, name);
    if (!existsSync(path)) continue;
    found = true;
    try { const value = JSON.parse(readFileSync(path, 'utf8')); if (validFile(value)) return value; } catch { /* the copy */ }
  }
  if (found) throw new Error('Merkez anahtar dosyası (anahtar.json) ve kopyası bozuk. Merkez yedeğini kurtarma koduyla geri yükleyin.');
  return undefined;
}
const writeFile = (directory: string, file: MerkezKeyFile, step?: (name: string) => void) => writeKeyFile(directory, file as unknown as KeyFile, step);
function readRaw(path: string) {
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error(`${path.endsWith(SAFETY_COPY) ? SAFETY_COPY : RAW_KEY} geçersiz (32 bayt olmalı).`);
  return key;
}
const tryRaw = (path: string) => { try { return existsSync(path) ? readRaw(path) : undefined; } catch { return undefined; } };
/** Whether this key opens Merkez's sealed registry in the folder (no data yet: nothing to contradict it). */
export function keyOpensMerkez(directory: string, key: Buffer) {
  const path = join(directory, 'merkez.sqlite');
  if (!existsSync(path)) return true;
  let db: DatabaseSync;
  try { db = new DatabaseSync(path, { readOnly: true }); db.prepare('SELECT 1').get(); }
  catch { db = new DatabaseSync(path); }
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='merkez'").get()) return true;
    const row = db.prepare('SELECT payload FROM merkez WHERE id=1').get() as { payload: Uint8Array } | undefined;
    if (!row) return true;
    try { openSealed(Buffer.from(row.payload), key, 'merkez'); return true; } catch { return false; }
  } finally { db.close(); }
}
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export class MerkezKeyGuard {
  state: 'open' | 'locked' = 'open';
  key?: Buffer;
  /** Why the lock did not open the key (the locked screen; no secrets). */
  lockReason?: string;
  warning?: string;
  /** This start moved the key into anahtar.json. */
  migrated = false;
  private file?: MerkezKeyFile;
  readonly lock: MerkezLock;
  private constructor(readonly directory: string, private options: GuardOptions) { this.lock = options.osLock ?? merkezOsLock(); }
  static async open(directory: string, options: GuardOptions) {
    const guard = new MerkezKeyGuard(directory, options);
    await guard.load();
    return guard;
  }
  get protectedFile() { return !!this.file; }
  private step(name: string) { this.options.onStep?.(name); }
  private get raw() { return join(this.directory, RAW_KEY); }
  private get safety() { return join(this.directory, SAFETY_COPY); }

  private async load() {
    const dir = this.directory; mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) if (/^anahtar(\.yedek)?\.json\.[a-f0-9]{8}\.tmp$/.test(name)) rmSync(join(dir, name), { force: true });
    const stored = readMerkezKeyFile(dir);
    if (!stored) return this.loadPlain();
    // MERKEZ_KEY_PROTECTION=0 with the plain key back in place: the vendor's rollback by hand. anahtar.json is left alone.
    if (!this.options.protect) {
      const raw = tryRaw(this.raw);
      if (raw && keyOpensMerkez(dir, raw)) { this.key = raw; return; }
    }
    this.file = stored;
    let key: Buffer | undefined;
    try { key = await this.osOpen(stored); }
    catch (error) { this.lockReason = plainError(error, 'Bilgisayar kilidi açılamadı.'); }
    if (key) {
      this.key = key;
      // A start that opened the key through this user's lock: the plain copy kept by the migration is no longer needed.
      // Offline tools (Sifre-Sifirla) change none of these files.
      const tidy = this.options.migrate !== false;
      const kept = tryRaw(this.safety);
      if (tidy && kept && same(kept, key)) wipeFile(this.safety);
      // A migration cut short after anahtar.json was verified but before the plain key was set aside: set it aside now.
      const raw = tryRaw(this.raw);
      if (raw && same(raw, key)) { if (tidy) renameSync(this.raw, this.safety); }
      else if (raw) console.warn('development.key bu Merkez verisinin anahtarı değil; dokunulmadı, anahtar.json kullanılıyor.');
      // Locked for another kind (a Linux file lock, now on Windows; a passphrase added later): locked again for this one.
      if (this.lock.protects && stored.osLock.kind !== this.lock.kind && this.options.migrate !== false) {
        try { await this.reprotect(); } catch { this.warning = 'Anahtar bu bilgisayar için kilitlenemedi. Bir sonraki açılışta yeniden denenecek.'; }
      }
      return;
    }
    // The lock refused, but the plain copy of a recent migration (or a plain key put back) is this very key: use it and lock
    // it again for this user. The copy stays until a start opens the key through the lock.
    for (const path of [this.safety, this.raw]) {
      const candidate = tryRaw(path);
      if (!candidate || keyCheck(candidate) !== stored.check || !keyOpensMerkez(dir, candidate)) continue;
      this.key = candidate; this.lockReason = undefined;
      if (this.options.migrate !== false) {
        try { await this.reprotect(); this.warning = 'Windows kilidi anahtarı açmadı; taşımadan kalan kopyayla açıldı ve anahtar bu kullanıcıya yeniden kilitlendi.'; }
        catch { this.warning = 'Anahtar bu kullanıcı için kilitlenemedi. Bir sonraki açılışta yeniden denenecek.'; }
      }
      return;
    }
    this.state = 'locked';
  }

  private async loadPlain() {
    const dir = this.directory;
    // anahtar.json was removed by hand: the copy set aside by the migration is the only key.
    if (!existsSync(this.raw) && existsSync(this.safety)) renameSync(this.safety, this.raw);
    if (!existsSync(this.raw)) {
      if (existsSync(join(dir, 'merkez.sqlite'))) throw new Error('Merkez veri anahtarı (development.key / anahtar.json) eksik. Veritabanı için yeni anahtar üretilemez; Merkez yedeğini kurtarma koduyla geri yükleyin.');
      // A new Merkez: a plain key first. The recovery code is made at this start; once it is confirmed the next start locks it.
      writeFileSync(this.raw, randomBytes(32), { mode: 0o600, flag: 'wx' });
    }
    const key = readRaw(this.raw);
    if (!keyOpensMerkez(dir, key)) throw new Error('development.key bu Merkez verisini açmıyor. Dosyalara dokunulmadı; doğru anahtarı geri koyun.');
    this.key = key;
    if (!this.options.protect || this.options.migrate === false) return;
    const recovery = readRecoveryFile(dir);
    if (recovery && recovery.check === keyCheck(key) && recovery.recovery.confirmedAt) await this.migrate(key, recovery);
  }

  private async osOpen(file: MerkezKeyFile) {
    const lock: MerkezLock | undefined = file.osLock.kind === this.lock.kind ? this.lock : file.osLock.kind === 'file' ? fileLock : undefined;
    if (!lock) throw new OsLockError(file.osLock.kind === 'parola' ? 'Anahtar bir parolayla kilitli; sunucu parolası (MERKEZ_KEY_PASSPHRASE) verilmedi.' : 'Bu anahtar başka bir işletim sisteminin kilidiyle korunuyor.', true);
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

  /**
   * development.key → anahtar.json, with the confirmed Merkez recovery block. Written, read back and opened through the lock;
   * the key must still open the data. Any failure removes the new files and Merkez goes on with the plain key (warning;
   * tried again at the next start). Only then is the plain key set aside as development.key.tasindi.
   */
  private async migrate(key: Buffer, recovery: RecoveryFile) {
    const now = new Date().toISOString();
    this.step('basla');
    try {
      const file: MerkezKeyFile = { v: 1, kind: 'mola-anahtar', installId: recovery.merkezId, check: keyCheck(key), osLock: { kind: this.lock.kind, data: await this.lock.seal(key, recovery.merkezId) }, recovery: recovery.recovery, createdAt: now, updatedAt: now };
      writeFile(this.directory, file, name => this.step(name));
      const back = readMerkezKeyFile(this.directory);
      if (!back || back.check !== file.check || back.recovery.id !== recovery.recovery.id || back.installId !== recovery.merkezId) throw new Error('Yeni anahtar dosyası geri okunamadı.');
      if (!same(await this.osOpen(back), key) || !keyOpensMerkez(this.directory, key)) throw new Error('Yeni anahtar dosyası doğrulanamadı.');
      this.step('dogrulandi');
      this.file = back;
    } catch (error) {
      for (const name of [KEY_FILE, KEY_COPY]) rmSync(join(this.directory, name), { force: true });
      this.file = undefined;
      this.warning = `Veri anahtarı korumaya alınamadı (${plainError(error, 'kilit yanıt vermedi')}). Merkez eskisi gibi çalışıyor; bir sonraki açılışta yeniden denenecek.`;
      return;
    }
    renameSync(this.raw, this.safety); this.step('kenara-alindi');
    this.migrated = true;
  }

  private async reprotect() {
    const file = this.file!, key = this.key!, now = new Date().toISOString();
    const next: MerkezKeyFile = { ...file, osLock: { kind: this.lock.kind, data: await this.lock.seal(key, file.installId) }, updatedAt: now };
    if (!same(await this.lock.open(next.osLock.data, next.installId), key)) throw new OsLockError('Yeni kilit doğrulanamadı.', false);
    writeFile(this.directory, next); this.file = next;
  }

  /** Locked → open with the Merkez recovery code; then locked again for this computer's user. */
  async unlock(code: string) {
    if (this.state !== 'locked' || !this.file) throw new DomainError('NOT_LOCKED', 'Veriler zaten açık.', 409);
    const file = this.file;
    let key: Buffer;
    try { key = await openRecovery(file.recovery, code, file.installId); }
    catch (error) {
      // A newer code (made after the key file was last written) sits in merkez-kurtarma.json: it opens the same key.
      const newer = readRecoveryFile(this.directory);
      if (!(error instanceof DomainError && error.code === 'WRONG_CODE') || !newer || newer.check !== file.check || newer.recovery.id === file.recovery.id) throw error;
      key = await openRecovery(newer.recovery, code, newer.merkezId);
    }
    if (keyCheck(key) !== file.check) throw new DomainError('WRONG_CODE', 'Kurtarma kodu bu Merkez verisine ait değil.', 403);
    if (!keyOpensMerkez(this.directory, key)) throw new DomainError('KEY_MISMATCH', 'Kurtarma kodu anahtarı açtı ama Merkez verisi bu anahtarla açılmıyor. Merkez yedeğini geri yükleyin.', 409);
    this.key = key; this.state = 'open'; this.lockReason = undefined;
    try { await this.reprotect(); this.warning = undefined; }
    catch { this.warning = 'Windows kilidi yenilenemedi. Bir sonraki açılışta yine kurtarma kodu gerekebilir.'; }
  }
  /** The lock again (it may not have answered in time at start). */
  async retry() {
    if (this.state !== 'locked' || !this.file) return this.state === 'open';
    try { this.key = await this.osOpen(this.file); this.state = 'open'; this.lockReason = undefined; return true; }
    catch (error) { this.lockReason = plainError(error, this.lockReason ?? 'Bilgisayar kilidi açılamadı.'); return false; }
  }
  /** What MerkezRecovery needs when merkez-kurtarma.json is missing: the block kept in the key file. */
  seed() { return this.file ? { merkezId: this.file.installId, recovery: this.file.recovery } : undefined; }
  /**
   * A new Merkez recovery code (Ayarlar → Yedek → "Yeni kurtarma kodu oluştur"): the key file gets the same block, so the
   * new code unlocks it and the old one no longer does. Verified through the lock before it is written.
   */
  async syncRecovery(recovery: RecoveryFile) {
    if (this.state !== 'open' || !this.file || !this.key || recovery.check !== this.file.check) return;
    if (this.file.installId === recovery.merkezId && JSON.stringify(this.file.recovery) === JSON.stringify(recovery.recovery)) return;
    const moved = this.file.installId !== recovery.merkezId;
    const data = moved ? await this.lock.seal(this.key, recovery.merkezId) : this.file.osLock.data;
    const next: MerkezKeyFile = { ...this.file, installId: recovery.merkezId, osLock: moved ? { kind: this.lock.kind, data } : this.file.osLock, recovery: recovery.recovery, updatedAt: new Date().toISOString() };
    if (moved && !same(await this.lock.open(data, recovery.merkezId), this.key)) throw new OsLockError('Yeni kilit doğrulanamadı.', false);
    writeFile(this.directory, next); this.file = next;
  }
  /** For Mola Yönetim (Ayarlar → Yedek and the "Önce kurtarma kodunuzu kaydedin" card). `confirmed`: the code as of now. */
  view(confirmed: boolean): KeyProtectionView {
    const plain = !this.file, wanted = this.options.protect;
    return {
      wanted, mode: plain ? 'plain' : 'protected', kind: this.file?.osLock.kind ?? null, protectsAtRest: !!this.file && this.file.osLock.kind !== 'file',
      waitingForCode: wanted && plain && !confirmed, migratesAtNextStart: wanted && plain && confirmed,
      safetyCopy: existsSync(this.safety), warning: this.warning ?? null,
    };
  }
}
