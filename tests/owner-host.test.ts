import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
// The tests' plain-http *.localhost names (isletme.localhost, menu.localhost), as the browser tests use them; never in a release build.
process.env.MOLA_TEST_TUNNEL = '1';
import { DEMO_PASSWORD } from '../server/app.js';
import { ownerOrigin } from '../server/merkez/owner-host.js';
import { startMerkez } from '../server/merkez/runtime.js';
import { MERKEZ_PASSWORD, merkezPair, temp } from './merkez-fixture.js';

/*
 * İşletmemi yönet'in kendi adresi (MERKEZ_OWNER_ORIGIN, server/merkez/owner-host.ts; on the VDS https://isletme.molayazilim.com.tr):
 * the owner's page and exactly its calls on their own name, not on Merkez's (no customer used the old address: no redirect),
 * the café shows the address Merkez names. Without the setting nothing changes (tests/web-serving.test.ts keeps <Merkez>/yonet).
 */
const KAFEM = 'http://isletme.localhost';
type Answer = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
/** A raw request to 127.0.0.1:port with any Host (Node here does not resolve *.localhost; Merkez only reads the header). */
function raw(port: number, path: string, o: { host?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const data = o.body === undefined ? undefined : Buffer.from(JSON.stringify(o.body));
  return new Promise<Answer>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method: o.method ?? (data ? 'POST' : 'GET'), headers: { Host: o.host ?? `127.0.0.1:${port}`, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': String(data.length) } : {}), ...o.headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', c => { body += c; }); res.on('end', () => done({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', fail); req.end(data);
  });
}
const freePort = async () => { const s = createServer(); await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); const port = (s.address() as AddressInfo).port; await new Promise<void>(r => s.close(() => r())); return port; };

test('the setting: an https root of its own name; never Merkez’s, the web site’s or the menu’s name; http only for the tests’ *.localhost', t => {
  const saved = { tunnel: process.env.MOLA_TEST_TUNNEL, release: process.env.MOLA_RELEASE_BUILD };
  t.after(() => { for (const [k, v] of [['MOLA_TEST_TUNNEL', saved.tunnel], ['MOLA_RELEASE_BUILD', saved.release]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const merkez = 'https://merkez.molayazilim.com.tr', site = 'https://molayazilim.com.tr', menu = 'https://menu.molayazilim.com.tr';
  assert.equal(ownerOrigin(merkez, site, menu, 'https://isletme.molayazilim.com.tr'), 'https://isletme.molayazilim.com.tr');
  assert.equal(ownerOrigin(merkez, site, menu, ' https://isletme.molayazilim.com.tr/ '), 'https://isletme.molayazilim.com.tr');
  assert.equal(ownerOrigin(merkez, site, menu, undefined), undefined); assert.equal(ownerOrigin(merkez, site, menu, ''), undefined);
  for (const wrong of [merkez, site, menu, 'http://isletme.molayazilim.com.tr', 'https://isletme.molayazilim.com.tr/yonet', 'https://u:p@isletme.molayazilim.com.tr', 'https://isletme.molayazilim.com.tr/?a=1', 'yanlış'])
    assert.equal(ownerOrigin(merkez, site, menu, wrong), undefined, wrong);
  assert.equal(ownerOrigin(undefined, undefined, undefined, 'http://isletme.localhost:3490'), 'http://isletme.localhost:3490');
  assert.equal(ownerOrigin(undefined, undefined, 'http://isletme.localhost:3490', 'http://isletme.localhost:3490'), undefined, 'not the menu’s name');
  assert.equal(ownerOrigin(undefined, undefined, undefined, 'http://isletme.example.com'), undefined);
  process.env.MOLA_RELEASE_BUILD = '1'; assert.equal(ownerOrigin(undefined, undefined, undefined, 'http://isletme.localhost:3490'), undefined); delete process.env.MOLA_RELEASE_BUILD;
  delete process.env.MOLA_TEST_TUNNEL; assert.equal(ownerOrigin(undefined, undefined, undefined, 'http://isletme.localhost:3490'), undefined);
});

test('built screens on the owner’s name: the page at "/", its files, its calls; /yonet there → "/"; everything else 404; no owner’s page on Merkez’s name', async t => {
  const root = temp('owner-host');
  const merkez = await startMerkez({ directory: join(root, 'merkez'), port: await freePort(), host: '127.0.0.1', serveBuild: true, initialPassword: MERKEZ_PASSWORD, ownerOrigin: KAFEM });
  const plain = await startMerkez({ directory: join(root, 'merkez-eski'), port: await freePort(), host: '127.0.0.1', serveBuild: true, initialPassword: MERKEZ_PASSWORD, ownerOrigin: null });
  t.after(async () => { await merkez.close(); await plain.close(); });
  const port = (merkez.server.address() as AddressInfo).port, kafem = (path: string, o: Parameters<typeof raw>[2] = {}) => raw(port, path, { host: 'isletme.localhost', ...o });
  // The page: index.html as İşletmemi yönet, "/" its home, the security headers of every page, not indexed.
  const page = await kafem('/');
  assert.equal(page.status, 200); assert.match(page.body, /<title>İşletmemi yönet · Mola<\/title>/); assert.match(page.body, /<meta name="mola-owner-home" content="\/" \/>/);
  assert.doesNotMatch(page.body, /Mola Yönetim|rel="manifest"|merkez-main/);
  assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/); assert.match(String(page.headers['content-security-policy']), /connect-src 'self'/);
  assert.equal(page.headers['x-frame-options'], 'DENY'); assert.equal(page.headers['referrer-policy'], 'no-referrer'); assert.equal(page.headers['x-robots-tag'], 'noindex');
  assert.equal((await kafem('/', { method: 'HEAD' })).status, 200);
  // Its files: the built ones the page loads and the icons it names.
  const files = [...page.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(files.length >= 1, page.body);
  for (const f of [...files, '/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/icon-192.png']) assert.equal((await kafem(f)).status, 200, f);
  // /yonet and every typed variant there: a 308 to "/", the query kept.
  for (const [path, to] of [['/yonet', '/'], ['/raporlarim', '/'], ['/raporlarim/?k=1', '/?k=1'], ['/Y%C3%B6net', '/'], ['/RAPORLARIM', '/']]) {
    const r = await kafem(path); assert.equal(r.status, 308, path); assert.equal(r.headers.location, to, path);
  }
  // Nothing else on this name: Mola Yönetim, its API, the other pages, the cafés' calls, the menu, the short links, /k/.
  for (const path of ['/merkez.html', '/index.html', '/menu.html', '/manifest.webmanifest', '/manifest-yonetim.webmanifest', '/favicon-yonetim.svg', '/assets/../merkez.html', '/api/merkez/admin/state', '/api/merkez/v1/health', '/api/merkez/v1/contact', '/api/site/form', '/s/AAAAAAAAAA/instagram', '/k/AAAAAAAAAA', '/q/AAAAAAAAAA/x', '/destek/x', '/robots.txt', '/x/y'] as const) {
    const r = await kafem(path); assert.equal(r.status, 404, path); assert.doesNotMatch(r.body, /Mola Yönetim/, path);
    assert.equal(r.headers['cache-control'], 'no-store', path); assert.equal(r.headers['x-robots-tag'], 'noindex', path);
  }
  assert.equal((await kafem('/api/merkez/admin/login', { body: { username: 'admin', password: MERKEZ_PASSWORD } })).status, 404);
  for (const path of ['/api/merkez/v1/sync', '/api/merkez/v1/relay/poll', '/api/merkez/v1/activation/code', '/api/merkez/v1/phone/login/start/x', '/yonet']) assert.equal((await kafem(path, { body: {} })).status, 404, `POST ${path}`);
  assert.equal((await kafem('/api/merkez/v1/phone/status')).status, 404, 'GET of a call');
  // Its calls are answered (an unknown e-mail: the plain sign-in refusal, not 404), from this origin only.
  const start = await kafem('/api/merkez/v1/phone/login/start', { body: { email: 'kimse@example.com' }, headers: { Origin: KAFEM } });
  assert.equal(start.status, 403, start.body); assert.equal(JSON.parse(start.body).code, 'LOGIN_FAILED');
  assert.equal(JSON.parse((await kafem('/api/merkez/v1/phone/status', { body: { phoneId: 'p'.repeat(22), token: 't'.repeat(43) }, headers: { Origin: KAFEM } })).body).code !== 'NOT_FOUND', true);
  const foreign = await kafem('/api/merkez/v1/phone/login/start', { body: { email: 'kimse@example.com' }, headers: { Origin: `http://127.0.0.1:${port}` } });
  assert.equal(foreign.status, 403); assert.equal(JSON.parse(foreign.body).code, 'ORIGIN_REJECTED');
  // Another name altogether: refused as before (DNS rebinding).
  assert.equal((await raw(port, '/', { host: 'evil.example' })).status, 403);
  // Merkez's own name: Mola Yönetim stays; the owner's page is not there: /yonet, /raporlarim and their typed variants are the
  // plain 404 page of any unknown address, whose one link goes to İşletmemi yönet on its own name.
  const yonetim = await raw(port, '/'); assert.equal(yonetim.status, 200); assert.match(yonetim.body, /Mola Yönetim/);
  for (const path of ['/yonet', '/raporlarim', '/raporlarim?k=1', '/RAPORLARIM/', '/raporlar%C4%B1m', '/Y%C3%B6net', '/yok-boyle-bir-sayfa']) {
    const r = await raw(port, path); assert.equal(r.status, 404, path); assert.equal(r.headers.location, undefined, path); assert.equal(r.headers['cache-control'], 'no-store', path);
    assert.match(r.body, /Bu sayfa bulunamadı/, path); assert.match(r.body, new RegExp(`<a class="go" href="${KAFEM}/">İşletmemi yönet’e git</a>`), path); assert.doesNotMatch(r.body, /İşletmemi yönet · Mola|mola-owner-home/, path);
  }
  assert.equal((await raw(port, '/yonet', { method: 'HEAD' })).status, 404);
  // Without the setting: exactly as before, İşletmemi yönet at <Merkez>/yonet ("/yonet" its home).
  const plainPort = (plain.server.address() as AddressInfo).port, old = await raw(plainPort, '/yonet');
  assert.equal(old.status, 200); assert.match(old.body, /<meta name="mola-owner-home" content="\/yonet" \/>/);
  assert.equal((await raw(plainPort, '/raporlarim')).status, 301);
  assert.equal((await raw(plainPort, '/', { host: 'isletme.localhost' })).status, 403, 'no such name without the setting');
});

test('the café learns the address with the heartbeat and shows it; /k/ outside the café goes there; the menu’s and the owner’s names stay apart; an older Merkez: as before', async t => {
  const pair = await merkezPair('owner-host-link', { demo: true, merkez: { ownerOrigin: KAFEM, menuOrigin: 'http://menu.localhost' } }); t.after(() => pair.close());
  await pair.importDemo();
  pair.link.reporter = { ...pair.link.reporter, lan: () => ['http://192.168.1.104:3000'] };
  assert.equal((await pair.link.sync()).ok, true); assert.equal((await pair.link.sync()).ok, true);
  assert.deepEqual(pair.link.read()!.ownerHost, { base: KAFEM });
  // Ayarlar → Uzaktan erişim (3 · Cihaz eşleştirme, 5 · Uzaktan yönetim): isletme.localhost, no /yonet.
  const owner = pair.kafe(); assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await owner('/staff/remote-reports')).data.address, KAFEM);
  // Kalıcı bağlantı outside the café's network, with Raporlarım: İşletmemi yönet on its own name.
  const biz = () => pair.merkezStore.read().businesses.find(b => b.tenantId === 'mola-demo')!;
  pair.merkezStore.mutate(d => { const b = d.businesses.find(x => x.tenantId === 'mola-demo')!; b.services = { packageId: null, features: ['remote-reports'] as never, updatedAt: new Date().toISOString() }; d.installs.find(i => i.id === b.installId)!.lan!.client = '203.0.113.7'; });
  const code = biz().lanCode!, k = await fetch(`${pair.merkezBase}/k/${code}`, { redirect: 'manual' });
  assert.equal(k.status, 302); assert.equal(k.headers.get('location'), `${KAFEM}/#k=${code}`);
  // Each name keeps to itself: no menu on the owner's name, no owner's page on the menu's.
  const port = Number(new URL(pair.merkezBase).port);
  assert.equal((await raw(port, '/q/AAAAAAAAAA/x', { host: 'isletme.localhost' })).status, 404);
  assert.equal((await raw(port, '/yonet', { host: 'menu.localhost' })).status, 404);
  assert.equal((await raw(port, '/yonet')).status, 404);
  // A Merkez that names no such address (an older one, or the setting removed): the café goes back to <Merkez>/yonet.
  const older = await merkezPair('owner-host-old', { demo: true }); t.after(() => older.close());
  await older.importDemo();
  (older.link as unknown as { write(fn: (r: any) => void): void }).write(r => { r.ownerHost = { base: KAFEM }; });
  assert.equal((await older.link.sync()).ok, true);
  assert.equal(older.link.read()!.ownerHost, undefined);
  const olderOwner = older.kafe(); assert.equal((await olderOwner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await olderOwner('/staff/remote-reports')).data.address, `${older.merkezBase}/yonet`);
  assert.equal((await fetch(`${older.merkezBase}/yonet`, { redirect: 'manual' })).status, 404, 'no page server here, but no redirect either');
});
