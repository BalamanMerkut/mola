import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OsLockError, type OsLock, type OsLockKind } from '../server/os-lock.js';

/**
 * Stands in for Windows DPAPI in tests: each "computer user" has its own secret (derived from its name), so a key file
 * moved to another name cannot be opened, like DPAPI after a password reset or on another PC. `fail` simulates trouble.
 */
export type FakeLock = OsLock & { fail?: 'denied' | 'transient'; opens: number };
export function fakeOsLock(user = 'kafe-pc', kind: OsLockKind = 'dpapi'): FakeLock {
  const secret = createHash('sha256').update(`fake-os-lock:${user}`).digest();
  const lock: FakeLock = {
    kind, protects: kind !== 'file', opens: 0,
    async seal(key, installId) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv); cipher.setAAD(Buffer.from(installId));
      const data = Buffer.concat([cipher.update(key), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
    },
    async open(data, installId) {
      lock.opens++;
      if (lock.fail) throw new OsLockError(lock.fail === 'denied' ? 'Windows kilidi bu anahtarı açmadı.' : 'Windows anahtar kilidi yanıt vermedi.', lock.fail === 'denied');
      try {
        const raw = Buffer.from(data, 'base64'), decipher = createDecipheriv('aes-256-gcm', secret, raw.subarray(0, 12)); decipher.setAAD(Buffer.from(installId)); decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
      } catch { throw new OsLockError('Windows kilidi bu anahtarı açmadı.', true); }
    },
  };
  return lock;
}
/** Cheap scrypt for tests only; production measures the computer (0.5–1 s per try). */
export const FAST_KDF = { N: 1024, r: 8, p: 1 };

/** Every byte under root, searched for the raw key (binary, hex, base64) and the codes (with or without dashes); also the log text. */
export function assertNoSecrets(root: string, key: Buffer, codes: string[], log = '') {
  const needles = [key, Buffer.from(key.toString('hex')), Buffer.from(key.toString('base64')), ...codes.flatMap(c => [Buffer.from(c), Buffer.from(c.replace(/-/g, ''))])];
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  for (const file of walk(root)) {
    const data = readFileSync(file);
    for (const needle of needles) assert.equal(data.indexOf(needle), -1, `secret found in ${file}`);
  }
  for (const needle of needles) assert.equal(log.includes(needle.toString()), false, 'secret found in the log');
}
