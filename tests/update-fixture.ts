import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeUpdateBundle, type BundleItem } from '../scripts/update-bundle.mjs';
import type { MerkezStore } from '../server/merkez/store.js';
import { totp } from '../server/totp.js';
import { MERKEZ_PASSWORD } from './merkez-fixture.js';

/*
 * Otomatik güncelleme test helpers: a tiny but valid update bundle (the same writer as `npm run installer`), a fake
 * installation folder for the applier, and an upload into a test Mola Merkez as the vendor's Mola Yönetim does it.
 */
export const DATA_FORMAT = { minReadable: 0, maxReadable: 3, writeVersion: 3 };
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
/** app/ of a version: server.mjs, package.json, dist/index.html and manifest.json listing them (like build-installer's appFolder). */
export function appFiles(version: string, serverText = `// Mola ${version}\n`): Record<string, Buffer> {
  const files: Record<string, Buffer> = { 'server.mjs': Buffer.from(serverText), 'package.json': Buffer.from(JSON.stringify({ name: 'mola-app', version, type: 'module' })), 'dist/index.html': Buffer.from(`<!doctype html><title>Mola ${version}</title>`), 'nobetci.mjs': Buffer.from('// nöbetçi'), 'guncelleyici.mjs': Buffer.from('// güncelleyici') };
  files['manifest.json'] = Buffer.from(JSON.stringify({ version, mode: 'installer', files: Object.entries(files).map(([file, data]) => ({ file, sha256: sha(data) })) }));
  return files;
}
export type BundleOptions = { platform?: string; node?: string; runtime?: boolean; minFrom?: string; notes?: string; data?: typeof DATA_FORMAT; serverText?: string; big?: number; top?: boolean };
/** Writes <out>/Guncelleme/Mola-<version>-<platform>.mola-guncelleme. `big`: an extra random file of that many bytes (resume tests). */
export async function testBundle(out: string, version: string, o: BundleOptions = {}) {
  const platform = o.platform ?? 'windows';
  const items: BundleItem[] = Object.entries(appFiles(version, o.serverText)).map(([f, data]) => ({ path: `app/${f}`, data }));
  if (o.big) items.push({ path: 'app/dist/assets/buyuk.bin', data: randomBytes(o.big) });
  if (o.runtime) items.push({ path: `runtime/${platform === 'windows' ? 'node.exe' : 'node'}`, data: Buffer.from(`node ${version}`), mode: 0o755 });
  const top = o.top === false ? [] : platform === 'windows' ? [{ path: 'ust/Mola-Sunucu.cmd', data: Buffer.from(`@rem Mola ${version}\r\n`), target: 'Mola-Sunucu.cmd' }] : [{ path: 'ust/mola', data: Buffer.from(`#!/bin/sh\n# ${version}\n`), mode: 0o755, target: 'mola' }];
  return writeUpdateBundle({ out, platform, version, node: o.node ?? process.version, items: [...items, ...top], top: top.map(t => ({ file: t.path, target: t.target })), runtime: !!o.runtime,
    minFrom: o.minFrom ?? '0.0.0', notes: o.notes ?? '', data: o.data ?? DATA_FORMAT, record: false });
}
/*
 * Güncelleme yetkisi (server/merkez/step-up.ts) in tests: two-step login is switched on straight in the test Merkez's store
 * (no session ends, no code spent), and each step-up uses the next code the account has not used yet.
 */
export const TEST_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export function withAuthenticator(store: MerkezStore, secret = TEST_TOTP_SECRET) {
  if (!store.read().admin.mfa) store.mutate(d => { d.admin.mfa = { secret, lastStep: -1, recoveryHashes: [] }; });
  return store.read().admin.mfa!.secret;
}
/**
 * A code is good once and only around now (one 30-second step back or ahead): the next unused one from the current step on
 * (so it stays good for a while), waiting for the clock if the account already used the current and the next one.
 */
export async function freshCode(store: MerkezStore, now = () => Date.now()) {
  const secret = store.read().admin.mfa!.secret;
  for (;;) {
    const current = Math.floor(now() / 30000), step = Math.max(current, store.read().admin.mfa!.lastStep + 1);
    if (step <= current + 1) return totp(secret, step * 30000);
    await new Promise(r => setTimeout(r, 1000));
  }
}
/** Opens the Güncelleme yetkisi for a cookie session (`Cookie`) or an access key (`Authorization`). */
export async function stepUp(merkezBase: string, store: MerkezStore, headers: Record<string, string>) {
  withAuthenticator(store);
  const r = await fetch(`${merkezBase}/api/merkez/admin/releases/yetki`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ code: await freshCode(store) }) });
  if (r.status !== 200) throw new Error(`Güncelleme yetkisi açılmadı: ${r.status} ${await r.text()}`);
}
/** One signed-in Mola Yönetim session per test Merkez, with the Güncelleme yetkisi open (10 minutes). */
const sessions = new Map<string, string>();
export async function releaseSession(merkezBase: string, store: MerkezStore) {
  const known = sessions.get(merkezBase);
  if (known) return known;
  const code = store.read().admin.mfa ? await freshCode(store) : undefined;
  const login = await fetch(`${merkezBase}/api/merkez/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: MERKEZ_PASSWORD, ...(code ? { code } : {}) }) });
  if (login.status !== 200) throw new Error(`Merkez girişi olmadı: ${login.status}`);
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  await stepUp(merkezBase, store, { Cookie: cookie });
  sessions.set(merkezBase, cookie);
  return cookie;
}
/** Mola Yönetim: signs in (Güncelleme yetkisi open) and uploads a bundle (raw bytes, like the file picker). */
export async function uploadBundle(merkezBase: string, file: string, store: MerkezStore) {
  const cookie = await releaseSession(merkezBase, store);
  const r = await fetch(`${merkezBase}/api/merkez/admin/releases/upload`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie }, body: readFileSync(file) });
  return { status: r.status, data: await r.json() as any, cookie };
}
/** An admin JSON call with a cookie from uploadBundle. */
export async function adminCall(merkezBase: string, cookie: string, path: string, body?: unknown) {
  const r = await fetch(`${merkezBase}/api/merkez/admin${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json() as any };
}
/** Writes files under a folder (paths with '/'). */
export function writeTree(root: string, files: Record<string, string | Buffer>) {
  for (const [path, data] of Object.entries(files)) { const p = join(root, ...path.split('/')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); }
}
