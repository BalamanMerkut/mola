import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role } from '../packages/domain/types.js';

export type StaffUser = { mfa?: { secret: string; lastStep: number; recoveryHashes: string[] }; id: string; username: string; name: string; role: Role; active: boolean; version: number; salt: string; hash: string; createdAt: string };
export function loginUsers(users: StaffUser[]) {
  return users.map(({ id, username, role, active, version, salt, hash, mfa }) => ({ id, username, role, active, version, salt, hash, ...(mfa ? { mfaEnabled: true } : {}) }));
}
const params = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
/**
 * The demo accounts' password (development, tests, the demo generator). A release bundle defines
 * process.env.MOLA_RELEASE_BUILD as "1" (esbuild define in scripts/build-installer.mjs): the comparison folds at build time,
 * the literal is left out of server.mjs, and any demo account there gets an unguessable password instead.
 */
// MOLA_DEMO_SIFRE: the vendor's own easy password for a sales demo made with scripts/demo-template.ts (development only).
export const DEMO_PASSWORD: string = process.env.MOLA_RELEASE_BUILD === '1' ? randomBytes(18).toString('base64url') : (process.env.MOLA_DEMO_SIFRE?.trim() || 'MolaDemo!2026');
export function initialUsers(tenant: string): StaffUser[] {
  const names: [string, string, Role][] = tenant === 'mola-demo' ? [['isletme', 'İşletme sahibi', 'owner'], ['kasiyer', 'Kasiyer', 'cashier'], ['garson', 'Garson', 'waiter'], ['mutfak', 'Mutfak', 'kitchen']] : [['diger', 'Diğer işletme', 'owner']];
  return names.map(([username, name, role]) => { const salt = randomBytes(16).toString('hex'); return { id: username, username, name, role, active: true, version: 1, salt, hash: scryptSync(DEMO_PASSWORD, salt, 32, params).toString('hex'), createdAt: new Date().toISOString() }; });
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, params, (error, key) => error ? reject(error) : resolve(key)));
}
export async function passwordRecord(password: string) {
  const salt = randomBytes(16).toString('hex'); return { salt, hash: (await derive(password, salt)).toString('hex') };
}
export async function passwordMatches(password: string, user: Pick<StaffUser, 'salt' | 'hash'>) {
  const value = await derive(password, user.salt); const expected = Buffer.from(user.hash, 'hex');
  return value.length === expected.length && timingSafeEqual(value, expected);
}
export function publicUser(user: StaffUser) { const { hash: _, salt: __, mfa: ___, ...visible } = user; return visible; }
