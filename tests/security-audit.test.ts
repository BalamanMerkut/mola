import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
process.env.MOLA_TUNNEL_RETRY_MS = '150';
process.env.MOLA_TUNNEL_REQUEST_MS = '4000';
process.env.MOLA_TEST_TUNNEL = '1';
import { DEMO_PASSWORD } from '../server/app.js';
import type { GuestTunnel } from '../server/guest-tunnel.js';
import type { GuestTunnelHub } from '../server/merkez/guest-tunnel.js';
import { shrinkLogo } from '../server/business-profile.js';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { registeredPackages } from '../server/backup.js';
import { relayedType, RELAYED_CSP } from '../server/merkez/relay.js';
import { totp } from '../server/totp.js';
import { devAllowList } from '../server/web-serving.js';
import { merkezPair, temp } from './merkez-fixture.js';

/*
 * Güvenlik denetimi (docs/GUVENLIK_DENETIMI.md): attacks tried against scratch servers, kept as regression tests.
 *   - Mola Merkez reads no large body from someone without an install: signed café calls are checked (headers, a known install,
 *     the clock) before their up-to-15 MB bodies are buffered and parsed; public calls stay small.
 *   - The guest's internet menu (/q/<kod>/…) reaches nothing but the guest's routes, whatever the path looks like.
 *   - Mola Yönetim answers only this computer without a proxy (forwarding headers, a foreign Host).
 *   - A logo that is not PNG/JPEG/WebP (an SVG under a PNG label) is refused before the image library parses it.
 */
type Answer = { status: number; text: string; data: any };
/** A raw HTTP call (no fetch: the body may be chunked or lie about its type). */
function call(base: string, path: string, o: { method?: string; headers?: Record<string, string>; body?: Buffer; chunked?: boolean; local?: string } = {}) {
  const url = new URL(base + path);
  return new Promise<Answer>((done, fail) => {
    const headers: Record<string, string> = { ...(o.body && !o.chunked ? { 'Content-Length': String(o.body.length) } : {}), ...(o.chunked ? { 'Transfer-Encoding': 'chunked' } : {}), ...o.headers };
    const req = httpRequest({ host: url.hostname, port: url.port, path: url.pathname + url.search, method: o.method ?? (o.body ? 'POST' : 'GET'), headers, ...(o.local ? { localAddress: o.local } : {}) }, res => {
      const parts: Buffer[] = []; res.on('data', c => parts.push(c)); res.on('end', () => { const text = Buffer.concat(parts).toString('utf8'); let data: any; try { data = JSON.parse(text); } catch { /* not JSON */ } done({ status: res.statusCode ?? 0, text, data }); });
    });
    // The server may answer and close before the whole body is sent: that is the point.
    req.on('error', e => (e as NodeJS.ErrnoException).code === 'EPIPE' || (e as NodeJS.ErrnoException).code === 'ECONNRESET' ? done({ status: -1, text: '', data: undefined }) : fail(e));
    if (o.body && o.chunked) { req.write(o.body.subarray(0, o.body.length >> 1)); req.end(o.body.subarray(o.body.length >> 1)); } else req.end(o.body);
  });
}
const junk = (size: number) => Buffer.alloc(size, '[');

test('Merkez: no large body is read from someone without an install (signed café routes, public routes, case tricks)', async t => {
  const pair = await merkezPair('guvenlik-govde'); t.after(() => pair.close());
  const base = pair.merkezBase, json = { 'Content-Type': 'application/json' };
  // Signed café routes (up to 10–15 MB parsers): refused on their headers before the body is parsed (else: 400 INVALID_JSON).
  for (const path of ['/api/merkez/v1/relay/poll', '/api/merkez/v1/attachments', '/api/merkez/v1/cloud-backup/begin', '/api/merkez/v1/menu', '/api/merkez/v1/sync', '/api/merkez/v1/RELAY/POLL', '/api/merkez/v1/relay/poll/']) {
    const r = await call(base, path, { headers: json, body: junk(2 * 1024 * 1024) });
    assert.ok(r.status === 401 || r.status === -1, `${path}: ${r.status} ${r.text.slice(0, 120)}`);
    if (r.status === 401) assert.equal(r.data.code, 'INSTALL_AUTH');
  }
  // Well-formed but unknown install: the same, before the body.
  const forged = { ...json, 'x-mola-install': '00000000-0000-4000-8000-000000000000', 'x-mola-time': String(Date.now()), 'x-mola-nonce': 'a'.repeat(32), 'x-mola-signature': 'A'.repeat(43) };
  assert.equal((await call(base, '/api/merkez/v1/relay/poll', { headers: forged, body: junk(1024 * 1024) })).data?.code, 'INSTALL_AUTH');
  const binary = await call(base, `/api/merkez/v1/cloud-backup/chunk-bin/${'a'.repeat(32)}/${'b'.repeat(64)}/0`, { headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(1024 * 1024) });
  assert.ok(binary.status === 401 || binary.status === -1, String(binary.status));
  // Public routes are small: the transfer calls (under the 12 MB backup parser) and the rest refuse a large or chunked body.
  for (const chunked of [false, true]) {
    const r = await call(base, '/api/merkez/v1/cloud-backup/transfer/open', { headers: json, body: junk(512 * 1024), chunked });
    assert.ok(r.status === 413 || r.status === -1, `transfer chunked=${chunked}: ${r.status} ${r.text.slice(0, 120)}`);
  }
  assert.ok([413, -1].includes((await call(base, '/api/merkez/v1/phone/live', { headers: json, body: junk(512 * 1024), chunked: true })).status));
  // The owner's device sends large sealed requests (photos): limited per address before its body is parsed.
  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) { const r = await call(base, '/api/merkez/v1/phone/admin', { headers: json, body: junk(300 * 1024) }); if (r.status === 429) limited = true; else assert.equal(r.status, 400); }
  assert.ok(limited, 'large bodies to /phone/admin are limited per address');
  // Normal small public calls still work.
  assert.equal((await call(base, '/api/merkez/v1/health')).status, 200);
  assert.equal((await call(base, '/api/merkez/v1/cloud-backup/transfer/open', { headers: json, body: Buffer.from(JSON.stringify({ code: 'AAAA-BBBB-CCCC', requester: '00000000-0000-4000-8000-000000000000' })) })).data?.code, 'WRONG_TRANSFER_CODE');
});

test('Merkez: Mola Yönetim only from this computer without a proxy; foreign Host refused', async t => {
  const pair = await merkezPair('guvenlik-yonetim'); t.after(() => pair.close());
  const base = pair.merkezBase;
  const spoofs: Record<string, string>[] = [{ 'X-Forwarded-For': '127.0.0.1' }, { Forwarded: 'for=127.0.0.1' }, { 'X-Real-IP': '127.0.0.1' }, { Host: `localhost.evil.example:${new URL(base).port}` }];
  for (const h of spoofs) {
    const r = await call(base, '/api/merkez/admin/state', { headers: h });
    assert.equal(r.status, 403, JSON.stringify(h));
    assert.ok(['LOCAL_ONLY', 'HOST_REJECTED'].includes(r.data?.code), JSON.stringify(r.data));
  }
  // Another machine's address (a LAN client) gets the same answer.
  assert.equal((await call(base, '/api/merkez/admin/state', { local: '127.0.0.2' })).status, 403);
});

function fakeBuild(name: string) {
  const dir = temp(name);
  mkdirSync(join(dir, '.vite'), { recursive: true }); mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'menu.html'), '<!doctype html><html><head><script type="module" src="./assets/menu-AbCdEf12.js"></script></head><body><div id="root"></div></body></html>');
  writeFileSync(join(dir, 'assets', 'menu-AbCdEf12.js'), 'console.log("menü");');
  writeFileSync(join(dir, 'assets', 'Workspace-Staff123.js'), 'staff only');
  writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify({ 'menu.html': { file: 'assets/menu-AbCdEf12.js', isEntry: true }, 'index.html': { file: 'assets/Workspace-Staff123.js', isEntry: true } }));
  return dir;
}

test('Internet menu: path tricks never reach a staff route through Mola Merkez; forged tunnel marker refused at the café', async t => {
  const pair = await merkezPair('guvenlik-tunel', { demo: true }); t.after(() => pair.close());
  const { installId } = await pair.importDemo();
  const tunnel = pair.kafeApp.locals.guestTunnel as GuestTunnel, hub = pair.merkezApp.locals.guestTunnel as GuestTunnelHub;
  tunnel.serveFrom(fakeBuild('guvenlik-tunel-build'));
  await pair.link.sync(); await pair.link.sync();
  const until = Date.now() + 8000; while (!(tunnel.connected() && hub.online(installId))) { if (Date.now() > until) throw new Error('tünel açılmadı'); await new Promise(r => setTimeout(r, 25)); }
  const owner = pair.kafe(); assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  const base = (await owner('/staff/network')).data.public.base as string, prefix = new URL(base).pathname, origin = new URL(base).origin;
  // The guest's own route works (control).
  assert.equal((await call(origin, `${prefix}/api/guest/state`)).status === 404, false);
  const tricks = ['/api/staff/state', '/api/staff/state/', '/API/STAFF/STATE', '/api/guest/../staff/state', '/api/guest/%2e%2e/staff/state', '/api/guest/state/..%2fstaff%2fstate', '/api/guest%2fstate', '/api/guest/state%00',
    '//api/staff/state', '/./api/staff/state', '/api/health', '/api/login', '/api/desktop/state', '/api/staff/me', '/assets/..%2f..%2fserver%2fapp.ts', '/assets/Workspace-Staff123.js', '/media/other-demo/00000000-0000-4000-8000-000000000000.webp',
    '/m/AAAAAAAAAAAAAAAAAAAA', '/uygulama', '/api/activation/state', '/api/remote/state'];
  for (const path of tricks) {
    const r = await call(origin, `${prefix}${path}`);
    assert.equal(r.status, 404, `${path}: ${r.status} ${r.text.slice(0, 100)}`);
  }
  for (const [method, path] of [['POST', '/api/login'], ['POST', '/api/staff/orders'], ['DELETE', '/api/guest/state'], ['PUT', '/api/guest/orders'], ['OPTIONS', '/api/guest/state']] as const) {
    const r = await call(origin, `${prefix}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: origin, 'X-HTTP-Method-Override': 'GET' }, body: Buffer.from('{}') });
    assert.equal(r.status, 404, `${method} ${path}: ${r.status}`);
  }
  // A guest POST from another site is refused (the menu's own origin only).
  assert.equal((await call(origin, `${prefix}/api/guest/session`, { headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: Buffer.from('{"token":"x"}') })).status, 403);
  // Straight to the café: a forged tunnel marker (any value) is refused; staff headers do not make a guest call a staff call.
  const forged = await call(pair.kafeBase, '/api/guest/state', { headers: { 'x-mola-tunnel': 'x'.repeat(43), 'x-mola-tunnel-tenant': 'mola-demo', 'x-mola-tunnel-ip': '1.2.3.4' } });
  assert.equal(forged.status, 403);
  const marker = await call(pair.kafeBase, '/api/staff/state', { headers: { 'x-mola-tunnel': 'x'.repeat(43) } });
  assert.equal(marker.status, 403);
});

test('café: routes match exactly (letter case, trailing slash), report code and "Şifrem" wrong tries add up, no UNC printer', async t => {
  const pair = await merkezPair('guvenlik-kafe', { demo: true }); t.after(() => pair.close());
  await pair.importDemo();
  const owner = pair.kafe(); assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await owner('/staff/state')).status, 200);
  // Express would match these to /api/staff/state while the guards in front (sahip kilidi, uzaktan yönetim, paket) did not.
  for (const path of ['/Staff/state', '/STAFF/STATE', '/staff/State', '/staff/state/', '/staff/remote-reports/', '/staff/Remote-Reports']) assert.equal((await owner(path)).status, 404, path);
  for (const path of ['/staff/password/', '/Staff/password', '/staff/remote-support/']) assert.equal((await owner(path, { currentPassword: 'x', password: 'YeniSifre!2026x' })).status, 404, path);
  // A network printer path makes Windows connect to that computer: refused unless it is installed here.
  const printer = await owner('/staff/printers', { printer: { name: 'Mutfak', enabled: true, connection: { type: 'windows', printerName: '\\\\saldirgan.example\\p' }, width: 80, charset: 'ascii', orders: false, bill: true } });
  assert.equal(printer.status, 400); assert.equal(printer.data.code, 'INVALID_PRINTER');
  // Report code: 5 wrong codes, then a wait (a Müdür may not guess the owner's code 8 times a minute for weeks).
  const setup = await owner('/staff/report-security/setup', { password: DEMO_PASSWORD }); assert.equal(setup.status, 200);
  assert.equal((await owner('/staff/report-security/enable', { code: totp(setup.data.secret, Date.now()) })).status, 200);
  const wrongCode = String((Number(totp(setup.data.secret, Date.now())) + 500_000) % 1_000_000).padStart(6, '0');
  for (let i = 0; i < 5; i++) assert.equal((await owner('/staff/report-security/verify', { code: wrongCode })).data.code, 'INVALID_CODE');
  assert.equal((await owner('/staff/report-security/verify', { code: wrongCode })).status, 429);
  // "Şifrem": 5 wrong current passwords, then 15 minutes.
  for (let i = 0; i < 5; i++) assert.equal((await owner('/staff/password', { currentPassword: `yanlis-${i}`, password: 'YeniSifre!2026x' })).data.code, 'INVALID_PASSWORD');
  assert.equal((await owner('/staff/password', { currentPassword: DEMO_PASSWORD, password: 'YeniSifre!2026x' })).status, 429);
});

test('relayed answers (Mola destek) never run on Merkez: known types only, HTML only for the printable report', () => {
  assert.equal(relayedType('application/json; charset=utf-8', '/api/staff/state'), 'application/json; charset=utf-8');
  assert.equal(relayedType('application/pdf', '/api/staff/reports/document.pdf'), 'application/pdf');
  assert.equal(relayedType('text/html; charset=utf-8', '/api/staff/reports/document'), 'text/html; charset=utf-8');
  for (const [type, path] of [['text/html', '/api/staff/state'], ['image/svg+xml', '/api/staff/x'], ['text/javascript', '/api/staff/x'], ['application/xhtml+xml', '/api/staff/x'], ['text/xml', '/api/staff/x']]) assert.equal(relayedType(type, path), 'application/octet-stream', type);
  assert.match(RELAYED_CSP, /sandbox/);
});

test('development server (dev:lan): project files are never answered as modules; page routes still go on', async t => {
  const app = express(); devAllowList(app, 'index.html'); app.use((_req, res) => { res.status(200).send('vite'); });
  const server = app.listen(0, '127.0.0.1'); t.after(() => server.close());
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const path of ['/server/app', '/server/merkez/store', '/package', '/vite.config', '/tsconfig', '/scripts/build-installer', '/.local/merkez/merkez-first-login', '/docs']) assert.equal((await call(base, path, { headers: { Accept: 'text/html' } })).status, 404, path);
  for (const path of ['/', '/m/AbCdEfGhIjKlMnOp', '/uygulama', '/src/main.tsx']) assert.equal((await call(base, path, { headers: { Accept: 'text/html' } })).status, 200, path);
});

test('restore: a crafted backup cannot name a year package outside its folder', () => {
  const dir = temp('guvenlik-paket'), path = join(dir, 'merchant.sqlite'), db = new DatabaseSync(path);
  db.exec('CREATE TABLE history_meta (key TEXT PRIMARY KEY, value TEXT)');
  const row = db.prepare('INSERT INTO history_meta (key, value) VALUES (?, ?)');
  row.run('package:2024', JSON.stringify({ v: 1, year: '2024', file: '..\\..\\Windows\\win.ini' }));
  row.run('package:2023', JSON.stringify({ v: 1, year: '2023', file: '\\\\saldirgan.example\\pay\\yil-2023.sqlite' }));
  row.run('package:2022', JSON.stringify({ v: 1, year: '2022', file: 'yil-2022.sqlite' }));
  db.close();
  assert.deepEqual(registeredPackages(path).map(p => p.year), ['2022']);
});

test('logo: an SVG (or anything but PNG/JPEG/WebP bytes) under an image label is refused before parsing', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>').toString('base64');
  await assert.rejects(shrinkLogo(`data:image/png;base64,${svg}`), (e: Error & { code?: string }) => e.code === 'INVALID_LOGO');
});
