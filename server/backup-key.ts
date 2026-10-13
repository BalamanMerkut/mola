import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { DomainError } from '../packages/domain/engine.js';
import { keyCheck, openOwner, openRecovery, ownerBlocks, portableRecovery, wipeFile, writeAtomic, type BackupProtection, type OwnerBlock, type RecoveryBlock } from './key-vault.js';

/**
 * anahtar-kurtarma.json inside every protected backup: the backup's own key, sealed with a key derived from the master key,
 * plus a copy of the recovery block (the master key sealed with the recovery code). So the backup folder and the recovery
 * code are enough on a new computer; on this computer the running server opens it with the master key it already holds.
 * No raw backup key file is written in protected mode: one on the same disk would make a stolen disk readable.
 */
export const BACKUP_KEY_FILE = 'anahtar-kurtarma.json';
/** owners (13 Ekim): the master key sealed with each owner's password too (İşletmem var); missing on older backups. */
export type BackupKeyFile = { v: 1; kind: 'mola-yedek-anahtari'; backup: string; installId: string; check: string; recovery: RecoveryBlock; owners?: OwnerBlock[]; key: { iv: string; data: string; tag: string } };
const wrappingKey = (master: Buffer) => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'mola:yedek-anahtari:v1', 32));
const aad = (backup: string) => Buffer.from(`mola:yedek:${backup}`);

export function sealBackupKey(backup: string, key: Buffer, protection: BackupProtection): BackupKeyFile {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', wrappingKey(protection.master), iv); cipher.setAAD(aad(backup));
  const data = Buffer.concat([cipher.update(key), cipher.final()]);
  return { v: 1, kind: 'mola-yedek-anahtari', backup, installId: protection.installId, check: keyCheck(protection.master), recovery: portableRecovery(protection.recovery), ...(protection.owners?.length ? { owners: protection.owners } : {}), key: { iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') } };
}
export function openBackupKey(file: BackupKeyFile, master: Buffer) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', wrappingKey(master), Buffer.from(file.key.iv, 'base64')); decipher.setAAD(aad(file.backup)); decipher.setAuthTag(Buffer.from(file.key.tag, 'base64'));
    const key = Buffer.concat([decipher.update(Buffer.from(file.key.data, 'base64')), decipher.final()]);
    if (key.length !== 32) throw new Error('length');
    return key;
  } catch { throw new DomainError('BACKUP_KEY', 'Bu yedek başka bir kuruluma ait; bu anahtarla açılmıyor.', 409); }
}
/** undefined: an old-format backup (its key is a separate file in backup-keys). */
export async function readBackupKeyFile(backup: string): Promise<BackupKeyFile | undefined> {
  let text: string;
  try { text = await fs.readFile(join(backup, BACKUP_KEY_FILE), 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
  const file = JSON.parse(text) as BackupKeyFile;
  if (file?.v !== 1 || file.kind !== 'mola-yedek-anahtari' || typeof file.backup !== 'string' || !/^[a-f0-9-]{36}$/.test(file.installId) || !file.recovery || !file.key) throw new Error('Yedeğin kurtarma kaydı bozuk.');
  const owners = ownerBlocks(file.owners); delete file.owners; if (owners.length) file.owners = owners;
  return file;
}
/** The master key of the café that made the backup, from the owner's recovery code. */
export async function masterFromCode(file: BackupKeyFile, code: string) {
  const master = await openRecovery(file.recovery, code, file.installId);
  if (keyCheck(master) !== file.check) throw new DomainError('WRONG_CODE', 'Kurtarma kodu bu yedeğe ait değil.', 403);
  return master;
}
/**
 * "İşletmem var": the master key from a business owner's own sign-in. Only the block of that username is tried (one scrypt);
 * a backup from before 13 Ekim, or one made before the owner first signed in on the new version, has none.
 */
export async function masterFromPassword(file: BackupKeyFile, username: string, password: string) {
  const name = username.trim().toLowerCase(), block = file.owners?.find(b => b.username === name);
  if (!block) throw new DomainError('NO_OWNER_LOCK', 'Bu yedek şifreyle açılmıyor (şifre kilidinden önce alınmış). Kurtarma koduyla geri yükleyin ya da daha yeni bir yedek seçin.', 409);
  const master = await openOwner(block, password, file.installId);
  if (keyCheck(master) !== file.check) throw new DomainError('WRONG_PASSWORD', 'Kullanıcı adı ya da şifre yanlış.', 403);
  return master;
}
/**
 * Backups made before key protection keep their key as a raw file in backup-keys, on the same disk, and they carry the raw
 * master key inside: a stolen disk would open them and, through them, today's data. Once protection is on, each such
 * backup gets its key sealed inside it (like new ones) and only then is the raw key file wiped. Checked first: the key
 * must open the backup's manifest. Old backups stay restorable, with the master key or the recovery code.
 */
export async function protectOldBackups(backupsRoot: string, keyRoot: string, protection: BackupProtection) {
  let done = 0;
  let names: string[];
  try { names = (await fs.readdir(backupsRoot, { withFileTypes: true })).filter(e => e.isDirectory() && /^backup-[\w-]+$/.test(e.name)).map(e => e.name); } catch { return 0; }
  for (const name of names) {
    const dir = join(backupsRoot, name), keyPath = join(keyRoot, `${name}.key`);
    try {
      if (await fs.stat(join(dir, BACKUP_KEY_FILE)).then(() => true, () => false)) { await wipeIfSealed(dir, keyPath, protection.master); continue; }
      const key = await fs.readFile(keyPath).catch(() => undefined);
      if (!key || key.length !== 32 || !manifestOpens(await fs.readFile(join(dir, 'manifest.bin')), key)) continue;
      writeAtomic(join(dir, BACKUP_KEY_FILE), JSON.stringify(sealBackupKey(name, key, protection), null, 2) + '\n');
      await wipeIfSealed(dir, keyPath, protection.master);
      done++;
    } catch { /* left as it was; tried again at the next start */ }
    await new Promise(r => setImmediate(r));
  }
  return done;
}
/** The raw key file goes only when the sealed copy inside the backup opens to the very same key. */
async function wipeIfSealed(dir: string, keyPath: string, master: Buffer) {
  const raw = await fs.readFile(keyPath).catch(() => undefined);
  const sealed = await readBackupKeyFile(dir);
  if (raw && sealed && openBackupKey(sealed, master).equals(raw)) wipeFile(keyPath);
}
function manifestOpens(data: Buffer, key: Buffer) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); decipher.setAAD(Buffer.from('mola-backup-v1')); decipher.setAuthTag(data.subarray(data.length - 16));
    decipher.update(data.subarray(12, data.length - 16)); decipher.final();
    return true;
  } catch { return false; }
}
/**
 * After "Yeni kurtarma kodu oluştur": every backup this computer can reach gets the new recovery block, so the new code opens
 * old backups too. Copies elsewhere (a flash drive in a drawer) still open with the old code only.
 */
export async function rewrapBackups(roots: string[], protection: BackupProtection) {
  let changed = 0;
  for (const root of roots) {
    let names: string[];
    try { names = (await fs.readdir(root, { withFileTypes: true })).filter(e => e.isDirectory() && /^backup-/.test(e.name) && !e.name.endsWith('.kopyalaniyor')).map(e => e.name); } catch { continue; }
    for (const name of names) {
      try {
        const file = await readBackupKeyFile(join(root, name));
        if (!file || file.installId !== protection.installId) continue;
        openBackupKey(file, protection.master);
        writeAtomic(join(root, name, BACKUP_KEY_FILE), JSON.stringify({ ...file, recovery: portableRecovery(protection.recovery), ...(protection.owners?.length ? { owners: protection.owners } : {}) }));
        changed++;
      } catch { /* a damaged or foreign backup is left as it is */ }
      await new Promise(r => setImmediate(r));
    }
  }
  return changed;
}
