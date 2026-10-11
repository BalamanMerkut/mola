import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { scrubRequests } from '../server/merkez/app.js';
import { startMerkez } from '../server/merkez/runtime.js';
import { startLocalServer } from '../server/runtime.js';
import { codeLocationOnly, type FailureReport } from '../server/sync-protocol.js';
import { devAllowList, pageHeaders } from '../server/web-serving.js';
import { MERKEZ_PASSWORD, merkezPair, temp } from './merkez-fixture.js';

/** A raw request: the path is sent exactly as written (fetch would resolve "/src/../x" first). */
function raw(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => { let body = ''; res.setEncoding('utf8'); res.on('data', c => { body += c; }); res.on('end', () => done({ status: res.statusCode!, headers: res.headers, body })); });
    req.on('error', fail); req.end();
  });
}
const listen = async (handler: (req: IncomingMessage, res: ServerResponse) => void) => { const s = createServer(handler); await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); return s; };
const freePort = async () => { const s = await listen(() => {}); const port = (s.address() as AddressInfo).port; await new Promise<void>(r => s.close(() => r())); return port; };
const rid = () => randomUUID().replace(/-/g, '');

test('development serving: ".." and its encodings never reach Vite; Vite’s own refusals do not print folder paths', async t => {
  const app = express(); devAllowList(app, 'index.html');
  // Stands in for Vite: would serve anything, and refuses one path with its full folder in the text.
  app.use((req, res) => { if (req.path === '/src/gizli.ts') { res.statusCode = 403; res.write('C:\\Users\\yesbo\\proje\\src\\gizli.ts is outside of Vite serving allow list'); res.end(); return; } res.end(`served ${req.path}`); });
  const server = await listen(app); t.after(() => new Promise<void>(r => server.close(() => r())));
  const port = (server.address() as AddressInfo).port;
  for (const path of ['/src/../server/app.ts', '/src/%2e%2e/server/app.ts', '/src/%2E%2E/docs/x.md', '/src/..%2fserver/app.ts', '/src/..\\server\\app.ts', '/@fs/C:/proje/node_modules/../server/app.ts', '/node_modules/%2e%2e/.local/merkez/merkez.sqlite', '/server/app.ts', '/docs/GELISTIRICI_REHBERI.md'])
    assert.equal((await raw(port, path)).status, 404, path);
  assert.equal((await raw(port, '/src/main.tsx')).body, 'served /src/main.tsx');
  assert.equal((await raw(port, '/masalar')).body, 'served /masalar', 'page routes');
  const refused = await raw(port, '/src/gizli.ts');
  assert.equal(refused.status, 403); assert.equal(refused.body, 'Erişim engellendi.'); assert.doesNotMatch(refused.body, /Users|yesbo/);
  // The headers every page gets.
  const pages = express(); pageHeaders(pages, { frames: 'none', development: false }); pages.use((_req, res) => res.send('<p>ok</p>'));
  const p = await listen(pages); t.after(() => new Promise<void>(r => p.close(() => r())));
  const h = (await raw((p.address() as AddressInfo).port, '/')).headers;
  assert.match(String(h['content-security-policy']), /frame-ancestors 'none'/); assert.match(String(h['content-security-policy']), /script-src 'self';/);
  assert.equal(h['x-frame-options'], 'DENY'); assert.equal(h['referrer-policy'], 'no-referrer'); assert.equal(h['x-content-type-options'], 'nosniff');
});

test('built screens carry the security headers on both servers; Mola Yönetim answers only this computer, the café API of Merkez also the LAN', async t => {
  const root = temp('serving');
  const cafe = await startLocalServer({ directory: join(root, 'kafe'), port: await freePort(), host: '127.0.0.1', serveBuild: true, cleanInstall: true });
  const merkez = await startMerkez({ directory: join(root, 'merkez'), port: await freePort(), host: '127.0.0.1', serveBuild: true, initialPassword: MERKEZ_PASSWORD });
  t.after(async () => { await cafe.close(); await merkez.close(); });
  const cafePort = (cafe.server.address() as AddressInfo).port, merkezPort = (merkez.server.address() as AddressInfo).port;
  const page = await raw(cafePort, '/');
  assert.equal(page.status, 200); assert.match(page.body, /<div id="root">/);
  assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'self'/, 'the café frames its own menu preview');
  assert.equal(page.headers['x-frame-options'], 'SAMEORIGIN'); assert.equal(page.headers['referrer-policy'], 'no-referrer');
  const yonetim = await raw(merkezPort, '/');
  assert.equal(yonetim.status, 200); assert.match(yonetim.body, /Mola Yönetim/);
  assert.match(String(yonetim.headers['content-security-policy']), /frame-ancestors 'none'/); assert.equal(yonetim.headers['x-frame-options'], 'DENY');
  // Another device of the network (this computer's name in Host, as a LAN address would be): no panel, no admin API.
  const name = hostname().toLowerCase();
  for (const path of ['/', '/api/merkez/admin/state']) { const r = await raw(merkezPort, path, { Host: `${name}:${merkezPort}` }); assert.equal(r.status, 403, path); assert.match(r.body, /yalnız Mola Merkez’in çalıştığı bilgisayardan/); }
  assert.equal((await raw(merkezPort, '/api/merkez/v1/health', { Host: `${name}:${merkezPort}` })).status, 200, 'cafés reach /api/merkez/v1');
  assert.equal((await raw(merkezPort, '/api/merkez/admin/state', { 'X-Forwarded-For': '192.168.1.30' })).status, 403, 'through a proxy without HTTPS');
});

test('nothing secret is kept for replays: codes and install secrets are rebuilt, not stored; status after activation gives no secret; failure records are code locations only', async t => {
  process.env.MOLA_APPLICATION_POLL_MS = '0';
  const pair = await merkezPair('replays'); t.after(() => pair.close());
  await pair.adminLogin();
  const body = { requestId: rid(), name: 'Tekrar Kafe', kind: 'trial' };
  const first = (await pair.admin('/businesses', body)).data;
  const again = (await pair.admin('/businesses', body)).data;
  assert.equal(again.tenantId, first.tenantId); assert.notEqual(again.code, first.code, 'a lost answer gets a fresh code (the old one was never seen)');
  assert.equal(pair.merkezStore.read().codes.filter(c => c.tenantId === first.tenantId).length, 1, 'only the newest code works');
  const stored = JSON.stringify(pair.merkezStore.read().requests);
  for (const code of [first.code, again.code]) assert.equal(stored.includes(code), false);
  // The café activates with it; a lost answer repeated with the same request id gets the same install, its secret not stored.
  const kafe = pair.kafe();
  assert.equal((await kafe('/activation/code', { code: again.code })).data.state, 'owner');
  const secret = pair.link.read()!.secret;
  assert.equal(JSON.stringify(pair.merkezStore.read().requests).includes(secret), false);
  // Older data that kept whole answers is reduced to ids once.
  const old = { requests: { 'business:x': { fingerprint: 'f', result: { tenantId: 't', code: 'ABCD-EFGH-JKLM', codeExpiresAt: 'x' } }, 'import:y': { fingerprint: 'f', result: { installId: 'i', secret: 's' } } } } as never;
  assert.equal(scrubRequests(old), true); assert.equal(JSON.stringify(old).includes('ABCD'), false); assert.equal(JSON.stringify(old).includes('"secret"'), false);
  // Application status: the secret goes out between approval and the café's first heartbeat only.
  const ids = { requestId: rid(), installId: randomUUID() };
  const send = (path: string, b: object) => fetch(`${pair.merkezBase}/api/merkez/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, data: await r.json() as any }));
  await send('/applications', { ...ids, machineId: 'e'.repeat(64), appVersion: '0.1.0', businessName: 'Durum Kafe', sector: 'cafe', contactName: 'Ayşe Yılmaz', consent: true, invoice: { legalName: 'Durum Kafe Ltd.', taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '6120069780', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 1', phone: '+905321234567', email: 'd@example.com' } });
  const tenantId = pair.merkezStore.read().businesses.find(b => b.name === 'Durum Kafe')!.tenantId;
  await pair.admin('/applications/approve', { requestId: rid(), tenantId });
  const approved = await send('/applications/status', ids);
  assert.equal(approved.data.status, 'approved'); assert.ok(approved.data.activation.secret);
  pair.merkezStore.mutate(d => { d.installs.find(i => i.id === ids.installId)!.lastSeenAt = new Date().toISOString(); });
  const later = await send('/applications/status', ids);
  assert.equal(later.status, 409); assert.equal(later.data.code, 'ALREADY_ACTIVE'); assert.equal(JSON.stringify(later.data).includes(approved.data.activation.secret), false);
  // Failure records: only what a code location looks like is kept.
  const base: FailureReport = { event: 'request_failed', requestId: randomUUID(), method: 'POST', route: '/api/staff/orders', status: 500, code: 'SERVER_ERROR', elapsedMs: 3, fingerprint: 'ab12cd34ef56', frames: ['submitOrder (packages/domain/engine.ts:120:9)', 'server/app.ts:318:5'], at: new Date().toISOString() };
  assert.equal(codeLocationOnly(base), true);
  for (const bad of [{ route: '/api/staff/orders?masa=Ahmet' }, { code: 'Ahmet Bey’in siparişi' }, { frames: ['C:\\Users\\yesbo\\gizli.txt:1:1'] }, { frames: ['Sipariş 4500 TL (server/app.ts:1:1)'] }, { method: 'GET /x' }, { role: 'Ahmet Yılmaz' }])
    assert.equal(codeLocationOnly({ ...base, ...bad } as FailureReport), false, JSON.stringify(bad));
});
