import { licensed, MERKEZ_PASSWORD, temp } from './merkez-fixture.js';
import { randomBytes } from 'node:crypto';
import { MerkezStore } from '../server/merkez/store.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { canonicalOrigin, machineHosts } from '../server/http-security.js';
import { MerkezLink } from '../server/kafe-link.js';
import { publicKeyFrom } from '../server/license.js';

test('HTTPS configuration requires explicit proxy trust, fixed origin and secure session cookies', async t => {
  for (const bad of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?x=1']) assert.throws(() => canonicalOrigin(bad));
  assert.equal(canonicalOrigin('https://example.com/'), 'https://example.com');
  mkdirSync('.local/tests', { recursive: true });
  const dir = mkdtempSync(resolve('.local/tests/https-')), store = new Store(dir); licensed(store);
  const merkez = new MerkezStore(join(dir, 'merkez'), randomBytes(32), { initialPassword: MERKEZ_PASSWORD });
  const servers: ReturnType<typeof createServer>[] = [];
  t.after(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); } store.close(); merkez.close(); });
  async function start(config = {}) {
    const server = createServer(createApp(store, undefined, undefined, undefined, config)); servers.push(server);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  }
  const origin = 'https://pilot.example.com';
  const secure = await start({ publicOrigin: origin, trustLocalProxy: true });
  const login = { username: 'isletme', password: 'MolaDemo!2026' };
  const post = (base: string, path: string, body: object, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post(secure, '/login', login, { Origin: origin })).status, 403);
  assert.equal((await post(secure, '/login', login, { 'X-Forwarded-Proto': 'https' })).status, 403);
  assert.equal((await post(secure, '/login', login, { Origin: 'https://evil.example', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'evil.example' })).status, 403);
  const headers = { Origin: origin, 'X-Forwarded-Proto': 'https' };
  const staff = await post(secure, '/login', login, headers);
  assert.equal(staff.status, 200);
  assert.match(staff.headers.get('set-cookie')!, /; Secure/);
  assert.match(staff.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(staff.headers.get('set-cookie')!, /SameSite=Strict/);
  const logout = await post(secure, '/logout', {}, headers);
  assert.match(logout.headers.get('set-cookie')!, /; Secure/);
  // Mola Yönetim behind the same kind of proxy (Mola Merkez on a VDS): its admin cookie is Secure too.
  const merkezServer = createServer(createMerkezApp(merkez, { httpSecurity: { publicOrigin: origin, trustLocalProxy: true } })); servers.push(merkezServer);
  await new Promise<void>(r => merkezServer.listen(0, '127.0.0.1', r));
  const yonetim = `http://127.0.0.1:${(merkezServer.address() as AddressInfo).port}/api/merkez/admin`;
  assert.equal((await post(yonetim, '/login', { username: 'admin', password: MERKEZ_PASSWORD })).status, 403, 'HTTPS only');
  const admin = await post(yonetim, '/login', { username: 'admin', password: MERKEZ_PASSWORD }, headers);
  assert.equal(admin.status, 200); assert.match(admin.headers.get('set-cookie')!, /; Secure/); assert.match(admin.headers.get('set-cookie')!, /Path=\/api\/merkez\/admin/);
  const adminLogout = await post(yonetim, '/logout', {}, { ...headers, Cookie: admin.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') });
  assert.equal(adminLogout.status, 200); assert.match(adminLogout.headers.get('set-cookie')!, /; Secure/);
  const guest = await post(secure, '/guest/session', { token: store.read('mola-demo').tables[0].token }, headers);
  assert.equal(guest.status, 200); assert.match(guest.headers.get('set-cookie')!, /; Secure/);
  const noTrust = await start({ publicOrigin: origin });
  assert.equal((await post(noTrust, '/login', login, headers)).status, 403);
  const local = await start();
  const localLogin = await post(local, '/login', login, { 'X-Forwarded-Proto': 'https' });
  assert.equal(localLogin.status, 200); assert.doesNotMatch(localLogin.headers.get('set-cookie')!, /; Secure/);
});

/** A request with any Host header (fetch cannot set one). */
function raw(base: string, path: string, host: string, body?: object, headers: Record<string, string> = {}) {
  const url = new URL(base + path), text = body ? JSON.stringify(body) : undefined;
  return new Promise<{ status: number; data: any }>((done, fail) => {
    const req = request({ host: url.hostname, port: url.port, path: url.pathname, method: body ? 'POST' : 'GET', headers: { Host: host, ...(text ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(text)) } : {}), ...headers } }, res => {
      let out = ''; res.setEncoding('utf8'); res.on('data', c => { out += c; }); res.on('end', () => { let data: any = out; try { data = JSON.parse(out); } catch { /* text */ } done({ status: res.statusCode!, data }); });
    });
    req.on('error', fail); req.end(text);
  });
}

test('PUBLIC_ORIGIN on: a café reaches Merkez over the HTTPS proxy without a browser Origin; plain HTTP still refused', async t => {
  process.env.MOLA_APPLICATION_POLL_MS = '0';
  const dir = temp('https-merkez'), origin = 'https://merkez.example.com';
  const merkez = new MerkezStore(join(dir, 'merkez'), randomBytes(32), { initialPassword: MERKEZ_PASSWORD });
  const server = createServer(createMerkezApp(merkez, { httpSecurity: { publicOrigin: origin, trustLocalProxy: true } }));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const store = new Store(join(dir, 'kafe'), []);
  // What the local TLS proxy adds to every request it forwards; no Origin, as from any server process.
  const proxied: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), 'X-Forwarded-Proto': 'https' } });
  const link = new MerkezLink(store, { url: base, publicKey: publicKeyFrom(merkez.publicKey), machineId: 'a'.repeat(64), fetch: proxied });
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); merkez.close(); });
  const form = { businessName: 'Proxy Kafe', sector: 'cafe' as const, contactName: 'Ayşe Yılmaz', consent: true as const, invoice: { legalName: 'Proxy Kafe Ltd.', taxOffice: 'Kadıköy', taxType: 'company' as const, taxNumber: '1234567890', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 1', phone: '+905321234567', email: 'ayse@example.com' } };
  assert.equal(await link.apply(form), 'applied');
  // Plain HTTP (no proxy in front) is refused even for the café routes.
  const direct = await fetch(`${base}/api/merkez/v1/applications/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: link.ticket()!.activationId, installId: link.ticket()!.installId }) });
  assert.equal(direct.status, 403); assert.equal((await direct.json()).code, 'HTTPS_REQUIRED');
  // A browser on another site is still refused.
  const foreign = await proxied(`${base}/api/merkez/v1/applications/status`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(foreign.status, 403);
  // The vendor approves through the proxy (browser: Origin required), the café takes its licence and the signed heartbeat passes.
  const adminHeaders = { 'Content-Type': 'application/json', Origin: origin, 'X-Forwarded-Proto': 'https' };
  const login = await fetch(`${base}/api/merkez/admin/login`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ username: 'admin', password: MERKEZ_PASSWORD }) });
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const tenantId = merkez.read().businesses[0].tenantId;
  assert.equal((await fetch(`${base}/api/merkez/admin/applications/approve`, { method: 'POST', headers: { ...adminHeaders, Cookie: cookie }, body: JSON.stringify({ requestId: 'onay-12345678', tenantId }) })).status, 200);
  assert.equal((await fetch(`${base}/api/merkez/admin/applications/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https', Cookie: cookie }, body: JSON.stringify({ requestId: 'onay-87654321', tenantId }) })).status, 403, 'the admin API still wants the browser Origin');
  await link.checkApplication(); assert.equal(link.state(), 'owner');
  const sync = await link.sync(); assert.equal(sync.ok, true, sync.error);
});

test('Host allow-list on both servers: rebound names are refused, this computer’s names and PUBLIC_ORIGIN pass; local-only checks need a loopback name', async t => {
  process.env.MOLA_ALLOWED_HOSTS = 'kasa.lan'; machineHosts(Date.now(), true);
  t.after(() => { delete process.env.MOLA_ALLOWED_HOSTS; machineHosts(Date.now(), true); });
  const dir = temp('hosts'), store = new Store(join(dir, 'kafe'), []);
  const merkez = new MerkezStore(join(dir, 'merkez'), randomBytes(32), { initialPassword: MERKEZ_PASSWORD });
  const servers = [createServer(createApp(store)), createServer(createMerkezApp(merkez)), createServer(createMerkezApp(merkez, { httpSecurity: { publicOrigin: 'https://merkez.example.com', trustLocalProxy: true } }))];
  const [kafe, mz, vds] = await Promise.all(servers.map(async s => { await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(s.address() as AddressInfo).port}`; }));
  t.after(async () => { for (const s of servers) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); } store.close(); merkez.close(); });
  for (const [base, path] of [[kafe, '/api/health'], [kafe, '/'], [mz, '/api/merkez/v1/health']] as const) {
    const evil = await raw(base, path, 'evil.example'); assert.equal(evil.status, 403, path);
    assert.equal((await raw(base, path, 'evil.example:3000')).status, 403);
    if (path.startsWith('/api')) { assert.equal(evil.data.code, 'HOST_REJECTED'); assert.equal((await raw(base, path, `127.0.0.1:${new URL(base).port}`)).status, 200); assert.equal((await raw(base, path, 'localhost')).status, 200); assert.equal((await raw(base, path, '[::1]:80')).status, 200); }
  }
  // This computer's LAN address and name (tablets on the café Wi-Fi), an extra name from MOLA_ALLOWED_HOSTS.
  const lan = Object.values(networkInterfaces()).flat().find(i => i && !i.internal && i.family === 'IPv4')?.address;
  if (lan) assert.equal((await raw(kafe, '/api/health', `${lan}:3000`)).status, 200);
  assert.equal((await raw(kafe, '/api/health', hostname().toLowerCase())).status, 200);
  assert.equal((await raw(kafe, '/api/health', 'KASA.lan')).status, 200);
  // PUBLIC_ORIGIN's host only where it is configured.
  assert.equal((await raw(vds, '/api/merkez/v1/health', 'merkez.example.com', undefined, { 'X-Forwarded-Proto': 'https' })).status, 200);
  assert.equal((await raw(mz, '/api/merkez/v1/health', 'merkez.example.com')).status, 403);
  // Through an allowed but non-loopback name, this-computer-only actions are refused (activation, desktop window).
  const applied = await raw(kafe, '/api/activation/code', 'kasa.lan', { code: 'ABCD-EFGH' });
  assert.equal(applied.status, 403); assert.equal(applied.data.code, 'LOCAL_ONLY');
  assert.equal((await raw(kafe, '/api/activation', 'kasa.lan')).data.local, false);
  assert.equal((await raw(kafe, '/api/activation', `localhost:${new URL(kafe).port}`)).data.local, true);
});
