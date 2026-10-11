import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import sharp from 'sharp';
// Fast reconnects and short waits: the café comes back within a second, a silent line is noticed in two.
process.env.MOLA_TUNNEL_RETRY_MS = '150';
process.env.MOLA_TUNNEL_REQUEST_MS = '4000';
// The test Merkez is on 127.0.0.1: the table QR codes take its address only under the browser tests' switch (never in a
// release build; server/kafe-link.ts publicMenuBase). The last tests turn it off to see the café's Wi-Fi address kept.
process.env.MOLA_TEST_TUNNEL = '1';
import { DEMO_PASSWORD } from '../server/app.js';
import { guestBuild, tunnelAllowed, type GuestTunnel } from '../server/guest-tunnel.js';
import { signedHeaders } from '../server/install-auth.js';
import { publicMenuBase } from '../server/kafe-link.js';
import { guestPathKind, type GuestTunnelHub } from '../server/merkez/guest-tunnel.js';
import { menuOrigin } from '../server/merkez/menu-host.js';
import { pack, sha256, TUNNEL_PATH, unpack } from '../server/tunnel-protocol.js';
import { WsSocket, wsAccept } from '../server/ws-frames.js';
import { merkezPair, temp } from './merkez-fixture.js';

/*
 * İnternetten menü (server/guest-tunnel.ts, server/merkez/guest-tunnel.ts): a guest on any network opens the table QR at Mola
 * Merkez's /q/<kod>/<masa kodu>; Merkez passes the guest's requests to the café over the café's own signed WebSocket.
 */
const wait = async (check: () => boolean | Promise<boolean>, ms = 8000) => { const end = Date.now() + ms; while (!(await check())) { if (Date.now() > end) throw new Error('Beklenen durum gelmedi.'); await new Promise(r => setTimeout(r, 25)); } };
const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });
/** A small built guest page like Vite makes it: menu.html, its manifest entry and two files (and one it never loads). */
function fakeBuild(name: string) {
  const dir = temp(name);
  mkdirSync(join(dir, '.vite'), { recursive: true }); mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'menu.html'), '<!doctype html><html><head><script type="module" src="./assets/menu-AbCdEf12.js"></script><link rel="stylesheet" href="./assets/style-XyZ09_-a.css"></head><body><div id="root"></div></body></html>');
  writeFileSync(join(dir, 'assets', 'menu-AbCdEf12.js'), 'import "./client-Qq11Ww22.js"; console.log("menü");');
  writeFileSync(join(dir, 'assets', 'client-Qq11Ww22.js'), 'export const x = 1;');
  writeFileSync(join(dir, 'assets', 'style-XyZ09_-a.css'), 'body{margin:0}');
  writeFileSync(join(dir, 'assets', 'Workspace-Staff123.js'), 'staff only');
  writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify({
    'menu.html': { file: 'assets/menu-AbCdEf12.js', isEntry: true, imports: ['_client.js'], css: ['assets/style-XyZ09_-a.css'] },
    '_client.js': { file: 'assets/client-Qq11Ww22.js' },
    'index.html': { file: 'assets/Workspace-Staff123.js', isEntry: true },
  }));
  return dir;
}
/**
 * The guest's phone: a cookie jar for one Merkez prefix, an address of its own (127.0.0.x), Origin on POSTs like a browser.
 * `via`: the server it really reaches (Mola Merkez's 127.0.0.1:port) while the Host header is the base's name (menu.localhost).
 */
function phone(base: string, local = '127.0.0.1', via?: string) {
  const jar = new Map<string, string>(); let session = ''; const origin = new URL(base).origin;
  return async (path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const named = new URL(base + path), url = via ? new URL(via + named.pathname) : named, data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers: Record<string, string> = { ...(via ? { Host: named.host } : {}), ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...(session ? { 'X-Guest-Session': session } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': String(data.length), Origin: origin } : {}), ...extra };
    return await new Promise<{ status: number; body: Buffer; text: string; data: any; headers: Record<string, string | string[] | undefined> }>((done, fail) => {
      const req = httpRequest({ host: url.hostname, port: url.port, path: url.pathname, method: data ? 'POST' : 'GET', headers, localAddress: local }, res => {
        const parts: Buffer[] = []; res.on('data', c => parts.push(c)); res.on('end', () => {
          for (const c of (res.headers['set-cookie'] ?? []) as string[]) { const [k, v] = c.split(';')[0].split('='); jar.set(k, v); }
          const b = Buffer.concat(parts), text = b.toString('utf8'); let parsed: any = undefined; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
          if (parsed?.session) session = parsed.session;
          done({ status: res.statusCode ?? 0, body: b, text, data: parsed, headers: res.headers });
        });
      });
      req.on('error', fail); req.end(data);
    });
  };
}
/** A café linked to a real Merkez, the demo businesses imported, the built guest page in place, its tunnel open. */
async function setup(name: string, options: Parameters<typeof merkezPair>[1] = {}) {
  const pair = await merkezPair(name, { demo: true, ...options });
  const { installId } = await pair.importDemo();
  const tunnel = pair.kafeApp.locals.guestTunnel as GuestTunnel, hub = pair.merkezApp.locals.guestTunnel as GuestTunnelHub;
  tunnel.serveFrom(fakeBuild(`${name}-build`));
  // First heartbeat: Merkez says it takes guest tunnels; the second asks for the menu codes.
  await pair.link.sync(); await pair.link.sync();
  await wait(() => tunnel.connected() && hub.online(installId));
  const owner = pair.kafe(); assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  const network = await owner('/staff/network');
  assert.ok(network.data.public, JSON.stringify(network.data));
  const base = network.data.public.base as string, token = pair.store.read('mola-demo').tables[0].token;
  return { pair, installId, tunnel, hub, owner, base, token, code: base.split('/q/')[1] };
}

test('tunnel: the public address, the guest page and its files, a whole visit (order, waiter, bill) through Mola Merkez', async t => {
  const { pair, tunnel, hub, owner, base, token, code, installId } = await setup('tunnel-visit'); t.after(() => pair.close());
  // The café's Merkez address (127.0.0.1, allowed here only by MOLA_TEST_TUNNEL): no MERKEZ_SITE_ORIGIN / PUBLIC_ORIGIN at this Merkez.
  assert.match(base,new RegExp(`^${pair.merkezBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/q/[A-Za-z0-9]{10}$`));
  assert.equal((await owner('/staff/network')).data.public.connected, true);
  // The code is the business's, given once: Merkez keeps it on the business, and a later heartbeat keeps it.
  assert.equal(pair.merkezStore.read().businesses.find(b => b.tenantId === 'mola-demo')!.menu!.code, code);
  await pair.link.sync();
  assert.equal((await owner('/staff/network')).data.public.base, base);
  assert.notEqual(pair.merkezStore.read().businesses.find(b => b.tenantId === 'other-demo')!.menu!.code, code);
  const guest = phone(base);
  // The page: menu.html of the build, with the page's own security headers.
  const page = await guest(`/${token}`);
  assert.equal(page.status, 200); assert.match(page.text, /menu-AbCdEf12\.js/);
  assert.match(String(page.headers['content-security-policy']), /script-src 'self'/); assert.equal(page.headers['cache-control'], 'no-store');
  // Its files: exactly the ones menu.html loads; a staff file of the same build is not one of them.
  const js = await guest('/assets/menu-AbCdEf12.js');
  assert.equal(js.status, 200); assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8'); assert.match(String(js.headers['cache-control']), /immutable/);
  assert.equal((await guest('/assets/client-Qq11Ww22.js')).status, 200); assert.equal((await guest('/assets/style-XyZ09_-a.css')).status, 200);
  assert.equal((await guest('/assets/Workspace-Staff123.js')).status, 404);
  // A whole visit: session (cookie scoped to the prefix), menu, order, waiter, bill.
  const session = await guest('/api/guest/session', { token });
  assert.equal(session.status, 200, session.text);
  const cookie = String((session.headers['set-cookie'] as string[])[0]);
  assert.match(cookie, new RegExp(`^mola_browser=[a-f0-9]{48}; Max-Age=\\d+; Path=/q/${code}/; HttpOnly; SameSite=Strict$`));
  const state = await guest('/api/guest/state');
  assert.equal(state.status, 200); assert.equal(state.data.table.name, pair.store.read('mola-demo').tables[0].name);
  // An unchanged menu answers 204 through the tunnel too.
  assert.equal((await guest('/api/guest/state', undefined, { 'X-Mola-Tag': String(state.headers['x-mola-tag']) })).status, 204);
  const table = pair.store.read('mola-demo').tables[0];
  const order = await guest('/api/guest/orders', { requestId: randomUUID(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [], note: 'Tunel gizli not 4821' }], expectedTotal: 3500 });
  assert.equal(order.status, 200, order.text);
  assert.ok(pair.store.read('mola-demo').orders.some(o => o.lines.some(l => l.note === 'Tunel gizli not 4821')), 'the note reached the café');
  // Mola Merkez passes the guest's traffic on and keeps none of it: not a byte of the order in any of its files.
  for (const file of filesUnder(pair.dir).filter(f => !f.includes(`kafe`))) assert.ok(!readFileSync(file).includes('Tunel gizli not 4821'), file);
  assert.ok(pair.store.read('mola-demo').orders.some(o => o.source === 'qr' && o.accountId === pair.store.read('mola-demo').tables[0].accountId), 'the order is on the café computer');
  assert.equal((await guest('/api/guest/call', { requestId: randomUUID(), kind: 'waiter' })).status, 200);
  assert.equal((await guest('/api/guest/call', { requestId: randomUUID(), kind: 'bill', payWith: 'card' })).status, 200);
  assert.ok((pair.store.read('mola-demo').serviceCalls ?? []).length >= 1);
  // The staff closes the bill on the café: the guest's next look says so.
  const account = (await owner('/staff/state')).data.tables.find((x: any) => x.id === table.id).account;
  assert.equal((await owner('/staff/payments', { requestId: randomUUID(), accountId: account.id, version: account.version, amount: account.balance, tendered: account.balance, method: 'cash' })).status, 200);
  const after = await guest('/api/guest/state');
  assert.equal(after.data.closed, true); assert.equal(after.data.ended, 'paid');
  // Counters only, nothing of the content, at Merkez.
  const view = hub.view(installId); assert.equal(view.online, true); assert.ok(view.requests >= 6);
  assert.ok(tunnel.counts.requests >= 6);
  // Mola Yönetim → işletme → Özet "İnternetten menü": the code and the tunnel now (counters only).
  await pair.adminLogin();
  const menu = (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo').menu;
  assert.equal(menu.code, code); assert.equal(menu.open, true); assert.equal(menu.online, true); assert.ok(menu.requests >= 6);
  // 8 Ekim: also QR siparişleri as the café said it over the tunnel, and the menu copy once it came (counts and times only).
  assert.deepEqual(Object.keys(menu).filter(k => k !== 'mirror').sort(), ['code', 'connectedAt', 'errors', 'online', 'open', 'ordering', 'requests', 'since', 'timeouts']);
  assert.deepEqual(menu.ordering, { open: true, call: true });
});

test('allow-list: every staff, owner, desktop, settings, report and remote path is refused at Mola Merkez and again at the café', async t => {
  const { pair, tunnel, hub, owner, base, token, installId } = await setup('tunnel-allow'); t.after(() => pair.close());
  const guest = phone(base);
  const before = tunnel.counts.requests + tunnel.counts.refused;
  const staffPaths = ['/api/staff/state', '/api/staff/reports/overview', '/api/staff/users', '/api/staff/settings', '/api/login', '/api/logout', '/api/health', '/api/desktop/status', '/api/activation', '/api/contact', '/uygulama', '/api/mobile-app', '/yonet', '/destek/x', '/raporlarim', '/index.html', '/menu.html', '/api/guest/../staff/state', '/api/guest/state/../../staff/users', '/m/' + token, '/assets/../server.mjs', '/media/other-demo/11111111-1111-1111-1111-111111111111.webp', '/api/merkez/admin/state', '/.vite/manifest.json', '/api/test/tunnel', '/api/staff/remote-admin', '/api/staff/support', '/api/staff/backup-status'];
  for (const p of staffPaths) {
    const r = await guest(p); assert.ok([404, 403].includes(r.status), `${p} → ${r.status}`);
    const posted = await guest(p, {}); assert.ok([404, 403, 405].includes(posted.status), `POST ${p} → ${posted.status}`);
  }
  // The wrong method on a guest path is refused too.
  assert.equal((await guest('/api/guest/session')).status, 404);
  assert.equal((await guest('/api/guest/state', {})).status, 404);
  // None of it reached the café.
  assert.equal(tunnel.counts.requests + tunnel.counts.refused, before);
  // The café refuses again what Merkez would never send: requests put straight onto the tunnel (as a broken Merkez could).
  for (const [m, p] of [['GET', '/api/staff/state'], ['POST', '/api/login'], ['GET', '/api/desktop/status'], ['GET', '/api/health'], ['POST', '/api/staff/payments'], ['GET', '/media/other-demo/11111111-1111-1111-1111-111111111111.webp'], ['GET', '/assets/Workspace-Staff123.js'], ['GET', '/index.html'], ['POST', '/api/test/tunnel']] as const) {
    const r = await hub.forward(installId, 'mola-demo', { m, p, h: { cookie: 'mola_staff=x' }, ip: '203.0.113.9' });
    assert.equal(r.status, 404, `${m} ${p}`);
  }
  // A business that is not this café's, or a guest address that is not one: refused.
  assert.equal((await hub.forward(installId, 'baska-isletme', { m: 'GET', p: '/api/guest/state', h: {}, ip: '203.0.113.9' })).status, 404);
  assert.equal((await hub.forward(installId, 'mola-demo', { m: 'GET', p: '/api/guest/state', h: {}, ip: 'x<script>' })).status, 404);
  assert.ok(tunnel.counts.refused >= 10);
  // A staff cookie never authenticates anything through the tunnel (the café sees only the guest cookie).
  assert.equal((await hub.forward(installId, 'mola-demo', { m: 'GET', p: '/api/guest/state', h: { cookie: 'mola_staff=abc; mola_browser=' + 'a'.repeat(48) }, ip: '203.0.113.9' })).status, 401);
  // The two lists, as tables.
  for (const [m, p] of [['GET', '/abcdefgh12345678abcdefgh'], ['GET', '/assets/menu-AbCdEf12.js'], ['GET', '/api/guest/state'], ['POST', '/api/guest/session'], ['POST', '/api/guest/orders/edit'], ['GET', '/media/mola-demo/11111111-1111-1111-1111-111111111111-small.webp']] as const) assert.ok(guestPathKind(m, p), `${m} ${p}`);
  for (const [m, p] of [['GET', '/api/staff/state'], ['POST', '/api/login'], ['GET', '/api/guest/session'], ['PUT', '/api/guest/state'], ['GET', '/media/x/../y.webp'], ['GET', '/a/b']] as const) assert.equal(guestPathKind(m, p), undefined, `${m} ${p}`);
  assert.equal(tunnelAllowed('GET', '/media/mola-demo/11111111-1111-1111-1111-111111111111.webp', 'mola-demo'), true);
  assert.equal(tunnelAllowed('GET', '/media/other-demo/11111111-1111-1111-1111-111111111111.webp', 'mola-demo'), false);
  for (const p of ['/api/staff/state', '/api/login', '/api/health', '/api/desktop/status', '/m/x', '/api/guest/state/x']) assert.equal(tunnelAllowed('GET', p, 'mola-demo'), false, p);
  // A table of the other business on the same computer never opens under this business's code.
  const other = pair.store.read('other-demo').tables[0].token;
  assert.equal((await guest('/api/guest/session', { token: other })).status, 404);
});

test('licence states at Mola Merkez: suspended, ended, frozen, 14 days offline, no QR menü — the café is not asked; "Sadece QR menü" as before', async t => {
  const { pair, tunnel, base, token } = await setup('tunnel-licence'); t.after(() => pair.close());
  const guest = phone(base);
  const asked = () => tunnel.counts.requests + tunnel.counts.refused;
  const closed = async (why: string) => {
    const n = asked();
    const page = await guest(`/${token}`);
    assert.equal(page.status, 200, why); assert.match(page.text, /Bu işletmenin dijital menüsü şu anda kullanılamıyor\./, why); assert.match(page.text, /digital menu is currently unavailable/, why);
    const api = await guest('/api/guest/session', { token });
    assert.equal(api.status, 403, why); assert.equal(api.data.code, 'MENU_UNAVAILABLE', why);
    assert.equal(asked(), n, `${why}: the café was not asked`);
  };
  const open = async (why: string) => { await wait(async () => (await guest(`/${token}`)).text.includes('menu-AbCdEf12'), 5000).catch(() => { throw new Error(why); }); };
  const mutate = (fn: (b: any) => void) => pair.merkezStore.mutate(d => { fn(d.businesses.find(b => b.tenantId === 'mola-demo')!); });
  await open('active');
  // Suspended (Mola Yönetim → Askıya al; the browser test presses the button).
  mutate(b => { b.suspended = true; }); await closed('suspended');
  mutate(b => { b.suspended = false; }); await open('resumed');
  // Ended.
  const ends = pair.merkezStore.read().businesses.find(b => b.tenantId === 'mola-demo')!.endsAt;
  mutate(b => { b.endsAt = new Date(Date.now() - 86400000).toISOString(); }); await closed('ended');
  mutate(b => { b.endsAt = ends; }); await open('extended');
  // Frozen (an approved freeze running now).
  mutate(b => { b.freezes = [{ id: 'f1', reason: 'Tadilat', startDate: new Date().toISOString().slice(0, 10), days: 7, requestedAt: new Date().toISOString(), status: 'approved', startsAt: new Date(Date.now() - 3600_000).toISOString(), until: new Date(Date.now() + 6 * 86400000).toISOString() }]; });
  await closed('frozen');
  mutate(b => { b.freezes = []; }); await open('unfrozen');
  // The café computer not heard from in 14 days (heartbeats; the tunnel itself does not count).
  const install = pair.merkezStore.read().installs[0].id, seen = pair.merkezStore.read().installs[0].lastSeenAt;
  pair.merkezStore.mutate(d => { d.installs.find(i => i.id === install)!.lastSeenAt = new Date(Date.now() - 15 * 86400000).toISOString(); });
  await closed('14 days offline');
  pair.merkezStore.mutate(d => { d.installs.find(i => i.id === install)!.lastSeenAt = seen; }); await open('heard again');
  // No "QR menü" among the services (Hizmet → Özel without it).
  mutate(b => { b.services = { packageId: null, features: ['core', 'qr-order'], updatedAt: new Date().toISOString() }; }); await closed('no qr-menu');
  // "Sadece QR menü": the menu opens, ordering is refused by the café exactly as on its own network.
  mutate(b => { b.services = undefined; b.service = 'menu'; });
  pair.merkezStore.mutate(d => { const b = d.businesses.find(x => x.tenantId === 'mola-demo')!; pair.merkezStore.issue(b, new Date()); });
  await pair.link.sync();
  await open('menu only');
  assert.equal((await guest('/api/guest/session', { token })).status, 200);
  const state = await guest('/api/guest/state');
  assert.equal(state.data.menuOnly, true);
  const table = pair.store.read('mola-demo').tables[0];
  const order = await guest('/api/guest/orders', { requestId: randomUUID(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
  assert.equal(order.status, 409); assert.equal(order.data.code, 'MENU_ONLY');
});

test('café offline: the friendly page (and JSON for the screen), no stack traces; the café comes back by itself', async t => {
  const { pair, tunnel, hub, base, token, installId } = await setup('tunnel-offline'); t.after(() => pair.close());
  const guest = phone(base);
  assert.equal((await guest('/api/guest/session', { token })).status, 200);
  tunnel.pause(true);
  await wait(() => !hub.online(installId));
  const page = await guest(`/${token}`);
  assert.equal(page.status, 503); assert.equal(page.headers['retry-after'], '15');
  assert.match(page.text, /Menü şu anda açılamıyor\. Lütfen garsonunuza sorun\./); assert.match(page.text, /Please ask your waiter/); assert.match(page.text, /http-equiv="refresh" content="15"/);
  assert.doesNotMatch(page.text, /at |Error|\.ts:/);
  const api = await guest('/api/guest/state');
  assert.equal(api.status, 503); assert.deepEqual(api.data, { code: 'CAFE_OFFLINE', message: 'Menü şu anda açılamıyor. Lütfen garsonunuza sorun.' });
  tunnel.pause(false);
  await wait(() => hub.online(installId));
  assert.equal((await guest('/api/guest/state')).status, 200, 'the same guest session goes on');
  // The café's whole server gone (its connection dropped): Merkez notices at once, the café reconnects with backoff.
  (hub as unknown as { connections: Map<string, { ws: WsSocket }> }).connections.get(installId)!.ws.destroy();
  await wait(() => !hub.online(installId), 2000).catch(() => { /* may already be back */ });
  await wait(() => hub.online(installId) && tunnel.connected());
  assert.equal((await guest(`/${token}`)).status, 200);
});

test('tunnel auth: an unknown install, a wrong signature, a replayed nonce or a wrong path are refused; only our Merkez is believed', async t => {
  const { pair, installId, hub } = await setup('tunnel-auth'); t.after(() => pair.close());
  const secret = (pair.link.read()!).secret, url = new URL(pair.merkezBase + TUNNEL_PATH);
  const upgrade = (headers: Record<string, string>, path = TUNNEL_PATH) => new Promise<{ status: number; body: string; ws?: WsSocket; accepted?: string }>((done, fail) => {
    const key = randomBytes(16).toString('base64');
    const req = httpRequest({ host: url.hostname, port: url.port, path, method: 'GET', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key, ...headers } });
    req.on('upgrade', (res, socket, head) => { done({ status: 101, body: '', ws: new WsSocket(socket, 'client', 1 << 20, head), accepted: res.headers['sec-websocket-accept'] === wsAccept(key) ? String(res.headers['x-mola-signature']) : undefined }); });
    req.on('response', res => { let b = ''; res.on('data', c => b += c); res.on('end', () => done({ status: res.statusCode ?? 0, body: b })); });
    req.on('error', fail); req.end();
  });
  const signed = (s = secret, at = Date.now(), path = TUNNEL_PATH) => signedHeaders(installId, s, 'GET', path, '', at);
  assert.equal((await upgrade({})).status, 401);
  assert.equal(JSON.parse((await upgrade(signed(randomBytes(32).toString('base64url')))).body).code, 'INSTALL_AUTH');
  assert.equal((await upgrade(signedHeaders(randomUUID(), secret, 'GET', TUNNEL_PATH, '', Date.now()))).status, 401);
  assert.equal(JSON.parse((await upgrade(signed(secret, Date.now() - 10 * 60_000))).body).code, 'CLOCK_SKEW');
  await assert.rejects(upgrade(signed(), '/api/merkez/v1/baska'));
  const once = signed();
  const first = await upgrade(once);
  assert.equal(first.status, 101); assert.ok(first.accepted, 'Merkez signed its answer');
  // The same nonce again: a replay.
  assert.equal(JSON.parse((await upgrade(once)).body).code, 'REPLAY');
  // A connection that never says hello is dropped; the café's own one is replaced by a newer one and comes back by itself.
  first.ws!.destroy();
  await wait(() => hub.online(installId));
  // Messages from the café that make no sense close only that connection.
  const rogue = await upgrade(signed());
  assert.equal(rogue.status, 101);
  rogue.ws!.send(Buffer.from([0, 0, 0, 200, 1, 2]));
  await wait(() => rogue.ws!.closed);
  await wait(() => hub.online(installId));
});

test('client address is passed on: the café counts its guest limits per guest, not per Mola Merkez', async t => {
  const { pair, base } = await setup('tunnel-ip'); t.after(() => pair.close());
  const a = phone(base, '127.0.0.2'), b = phone(base, '127.0.0.3');
  // Wrong table links: 20 a minute per guest address at the café (server/app.ts qr-miss).
  for (let i = 0; i < 20; i++) assert.equal((await a('/api/guest/session', { token: `yanlis-${i}-kod-123` })).status, 404);
  const limited = await a('/api/guest/session', { token: 'yanlis-son-kod-123' });
  assert.equal(limited.status, 429); assert.equal(limited.data.code, 'RATE_LIMIT');
  // Another guest (another address) is not held by the first one's tries.
  assert.equal((await b('/api/guest/session', { token: 'yanlis-baska-123' })).status, 404);
  assert.equal((await b('/api/guest/session', { token: pair.store.read('mola-demo').tables[1].token })).status, 200);
});

test('photos and files: kept by Mola Merkez (photos for minutes, files by SHA-256), Merkez’s own identical build serves the page', async t => {
  const build = fakeBuild('tunnel-own-build');
  const { pair, tunnel, base, token } = await setup('tunnel-cache', { merkez: { buildDirectory: build } }); t.after(() => pair.close());
  const guest = phone(base);
  // A product photo of the business.
  const id = randomUUID(), dir = join(pair.store.directory, 'media', 'mola-demo'); mkdirSync(dir, { recursive: true });
  const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#2f6b55' } }).webp().toBuffer();
  writeFileSync(join(dir, `${id}.webp`), webp);
  const before = tunnel.counts.requests;
  // The page and its files come from Merkez's own build (same SHA-256 as the café's): the café is not asked.
  assert.equal((await guest(`/${token}`)).status, 200); assert.equal((await guest('/assets/menu-AbCdEf12.js')).status, 200);
  assert.equal(tunnel.counts.requests, before);
  const first = await guest(`/media/mola-demo/${id}.webp`);
  assert.equal(first.status, 200); assert.equal(first.headers['content-type'], 'image/webp'); assert.ok(first.body.equals(webp));
  assert.equal(tunnel.counts.requests, before + 1);
  const second = await guest(`/media/mola-demo/${id}.webp`);
  assert.ok(second.body.equals(webp)); assert.equal(tunnel.counts.requests, before + 1, 'the second look is Merkez’s copy');
  assert.equal((await guest(`/media/mola-demo/${id}.webp`, undefined, { 'If-None-Match': String(first.headers.etag) })).status, 304);
  assert.equal((await guest(`/media/mola-demo/${randomUUID()}.webp`)).status, 404);
  // A file the café has but Merkez's own build lacks comes once through the tunnel, then from memory (checked by SHA-256).
  const client = await guest('/assets/client-Qq11Ww22.js');
  assert.equal(client.status, 200); assert.equal(sha256(client.body), guestBuild(build)!.files.get('client-Qq11Ww22.js')!.sha);
  assert.equal((await guest('/assets/menu-AbCdEf12.js', undefined, { 'If-None-Match': String((await guest('/assets/menu-AbCdEf12.js')).headers.etag) })).status, 304);
});

test('old café and old Merkez: no tunnel, the LAN address with its note; a Merkez that never named a code answers 404', async t => {
  const pair = await merkezPair('tunnel-old', { demo: true }); t.after(() => pair.close());
  await pair.importDemo();
  const tunnel = pair.kafeApp.locals.guestTunnel as GuestTunnel, hub = pair.merkezApp.locals.guestTunnel as GuestTunnelHub;
  const owner = pair.kafe(); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  // Development server / no built guest page: the café never asks for codes; the QR codes keep the LAN address.
  await pair.link.sync(); await pair.link.sync();
  assert.equal(pair.link.payload(pair.link.read()!).tunnel, undefined);
  assert.equal((await owner('/staff/network')).data.publicProblem, 'local');
  assert.equal(pair.merkezStore.read().businesses.find(b => b.tenantId === 'mola-demo')!.menu, undefined, 'an old café is given no code');
  // An old Merkez (no 'guest.tunnel' in its accepts): no tunnel either, the screen says "old".
  tunnel.serveFrom(fakeBuild('tunnel-old-build'));
  (pair.link as unknown as { write(fn: (r: any) => void): void }).write(r => { r.accepts = r.accepts.filter((x: string) => x !== 'guest.tunnel'); });
  assert.equal(pair.link.payload(pair.link.read()!).tunnel, undefined);
  assert.equal((await owner('/staff/network')).data.publicProblem, 'old');
  assert.equal(tunnel.needed(), false);
  // The new Merkez again: the codes come and the address is there.
  await pair.link.sync(); await pair.link.sync();
  const network = await owner('/staff/network');
  assert.ok(network.data.public?.base);
  await wait(() => tunnel.connected());
  // Unknown codes (or one never given): Merkez's own 404 page, the café is not asked.
  const stranger = phone(`${pair.merkezBase}/q/AAAAAAAAAA`);
  const r = await stranger('/abcdefgh12345678');
  assert.equal(r.status, 404); assert.match(r.text, /Bu bağlantı bulunamadı/);
  assert.equal((await phone(`${pair.merkezBase}/q/kisa`)('/x')).status, 404);
  void hub;
});

test('QR address: the public base when ready, LAN otherwise; "QR basıldı" takes either; a slow café never holds another café', async t => {
  const { pair, owner, base, hub, installId } = await setup('tunnel-qr'); t.after(() => pair.close());
  assert.equal((await owner('/staff/qr-printed', { origin: base })).status, 200);
  assert.equal((await owner('/staff/network')).data.printed.origin, base);
  assert.equal((await owner('/staff/qr-printed', { origin: 'http://192.168.1.20:3000' })).status, 200);
  for (const wrong of [`${base}/x`, 'https://merkez.test/q/kisa', 'javascript:alert(1)']) assert.equal((await owner('/staff/qr-printed', { origin: wrong })).status, 400, wrong);
  // Two cafés on one Merkez: a café that never answers (here a raw connection that only says hello) fills only its own queue.
  const secret = randomBytes(32).toString('base64url');
  const slowInstall = randomUUID();
  pair.merkezStore.mutate(d => { d.installs.push({ id: slowInstall, secret, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }); d.businesses.push({ ...d.businesses.find(b => b.tenantId === 'other-demo')!, tenantId: 'yavas-kafe', name: 'Yavaş Kafe', installId: slowInstall, menu: { code: 'YavasKafe1', since: new Date().toISOString() } }); });
  const url = new URL(pair.merkezBase + TUNNEL_PATH), key = randomBytes(16).toString('base64');
  const slow = await new Promise<WsSocket>((done, fail) => { const req = httpRequest({ host: url.hostname, port: url.port, path: TUNNEL_PATH, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key, ...signedHeaders(slowInstall, secret, 'GET', TUNNEL_PATH, '', Date.now()) } }); req.on('upgrade', (_res, socket, head) => done(new WsSocket(socket, 'client', 1 << 20, head))); req.on('response', r => fail(new Error(String(r.statusCode)))); req.end(); });
  t.after(() => slow.destroy());
  let held = 0; slow.on('message', (m: Buffer) => { if (unpack(m).head.t === 'req') held++; });
  slow.send(pack({ t: 'hello', v: 1, app: 'test', page: sha256('x'), assets: {} }));
  await wait(() => hub.online(slowInstall));
  const slowGuest = phone(`${pair.merkezBase}/q/YavasKafe1`);
  const stuck = Array.from({ length: 60 }, () => slowGuest('/api/guest/state'));
  await wait(() => held >= 48);
  const fast = phone(base), t0 = Date.now();
  assert.equal((await fast('/api/guest/session', { token: pair.store.read('mola-demo').tables[2].token })).status, 200);
  assert.ok(Date.now() - t0 < 1500, `the other café answered in ${Date.now() - t0} ms`);
  // The slow café holds exactly its own PARALLEL requests; the rest wait in its own queue.
  assert.equal(held, 48); assert.equal(hub.view(slowInstall).waiting, 12);
  const answers = await Promise.all(stuck);
  assert.ok(answers.every(a => a.status === 503 || a.status === 504), JSON.stringify(answers.map(a => a.status)));
  assert.equal(hub.view(installId).online, true);
});

test('QR address only on a public https Merkez: loopback, private IP, local names and http keep the café Wi-Fi address', async t => {
  const saved = { tunnel: process.env.MOLA_TEST_TUNNEL, release: process.env.MOLA_RELEASE_BUILD };
  t.after(() => { for (const [k, v] of [['MOLA_TEST_TUNNEL', saved.tunnel], ['MOLA_RELEASE_BUILD', saved.release]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  // The rule itself, without the browser tests' switch.
  delete process.env.MOLA_TEST_TUNNEL;
  for (const base of ['https://molayazilim.com.tr', 'https://merkez.molayazilim.com.tr', 'https://merkez.molayazilim.com.tr:8443', 'https://203.0.113.10', 'https://[2001:db8::1]']) assert.equal(publicMenuBase(base), true, base);
  for (const base of ['http://127.0.0.1:4000', 'https://127.0.0.1:4000', 'http://localhost:4000', 'https://localhost', 'https://[::1]:4000', 'http://[::1]:4000',
    'http://192.168.1.20:4000', 'https://192.168.1.20', 'https://10.0.0.5', 'https://172.20.1.1', 'https://169.254.1.1', 'https://100.64.0.1', 'https://[fd00::1]', 'https://[fe80::1]',
    'http://molayazilim.com.tr', 'https://merkez', 'https://kasa.local', 'https://merkez.lan', 'https://merkez.home.arpa', 'https://merkez.test', 'ftp://molayazilim.com.tr', 'yanlış']) assert.equal(publicMenuBase(base), false, base);
  // The browser tests' switch lets their 127.0.0.1 Merkez through, never another private address, never in a release build.
  process.env.MOLA_TEST_TUNNEL = '1';
  assert.equal(publicMenuBase('http://127.0.0.1:3490'), true); assert.equal(publicMenuBase('http://localhost:3490'), true);
  assert.equal(publicMenuBase('http://192.168.1.20:4000'), false);
  process.env.MOLA_RELEASE_BUILD = '1';
  assert.equal(publicMenuBase('http://127.0.0.1:3490'), false);
  delete process.env.MOLA_RELEASE_BUILD;

  // A café whose Mola Merkez advertises guest tunnels but has no public address (Mola Yönetim on a computer, before the VDS).
  const { pair, owner, code } = await setup('tunnel-private'); t.after(() => pair.close());
  delete process.env.MOLA_TEST_TUNNEL;
  const network = async () => (await owner('/staff/network')).data;
  const merkezBase = (base: string | undefined) => (pair.link as unknown as { write(fn: (r: any) => void): void }).write(r => { if (base === undefined) delete r.tunnel.base; else r.tunnel.base = base; });
  let n = await network();
  assert.equal(n.public, undefined); assert.equal(n.publicProblem, 'private', 'the café’s own Merkez address (127.0.0.1) never goes on a QR');
  assert.ok('problem' in pair.link.menuAddress('mola-demo'));
  // The menu copy still goes to that Merkez (server/menu-mirror.ts): only the QR codes wait for a public address.
  assert.ok('base' in pair.link.tunnelAddress('mola-demo'));
  for (const base of ['http://192.168.1.5:4000', 'https://192.168.1.5:4000', 'http://molayazilim.com.tr', 'https://merkez.local']) {
    merkezBase(base); n = await network();
    assert.equal(n.public, undefined, base); assert.equal(n.publicProblem, 'private', base);
  }
  // MERKEZ_SITE_ORIGIN / PUBLIC_ORIGIN at Mola Merkez (the VDS): the public address, ready for the QR codes.
  merkezBase('https://molayazilim.com.tr'); n = await network();
  assert.equal(n.public.base, `https://molayazilim.com.tr/q/${code}`); assert.equal(n.publicProblem, undefined);
  merkezBase(undefined);
  assert.equal((await network()).publicProblem, 'private');
});

test('menu host (MERKEZ_MENU_ORIGIN): the setting itself; the QR codes hold it; /q/ only there, 308 elsewhere; nothing else there', async t => {
  // The setting: an https root of its own name; never Merkez's or the web site's name; http only for the tests' *.localhost.
  const saved = { tunnel: process.env.MOLA_TEST_TUNNEL, release: process.env.MOLA_RELEASE_BUILD };
  t.after(() => { for (const [k, v] of [['MOLA_TEST_TUNNEL', saved.tunnel], ['MOLA_RELEASE_BUILD', saved.release]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const merkez = 'https://merkez.molayazilim.com.tr', site = 'https://molayazilim.com.tr';
  assert.equal(menuOrigin(merkez, site, 'https://menu.molayazilim.com.tr'), 'https://menu.molayazilim.com.tr');
  assert.equal(menuOrigin(merkez, site, ' https://menu.molayazilim.com.tr/ '), 'https://menu.molayazilim.com.tr');
  assert.equal(menuOrigin(merkez, site, undefined), undefined); assert.equal(menuOrigin(merkez, site, ''), undefined);
  for (const wrong of ['https://merkez.molayazilim.com.tr', 'https://molayazilim.com.tr', 'http://menu.molayazilim.com.tr', 'https://menu.molayazilim.com.tr/yol', 'https://u:p@menu.molayazilim.com.tr', 'yanlış']) assert.equal(menuOrigin(merkez, site, wrong), undefined, wrong);
  assert.equal(menuOrigin(undefined, undefined, 'http://menu.localhost:3490'), 'http://menu.localhost:3490');
  assert.equal(menuOrigin(undefined, undefined, 'http://menu.example.com'), undefined);
  process.env.MOLA_RELEASE_BUILD = '1'; assert.equal(menuOrigin(undefined, undefined, 'http://menu.localhost:3490'), undefined); delete process.env.MOLA_RELEASE_BUILD;
  delete process.env.MOLA_TEST_TUNNEL; assert.equal(menuOrigin(undefined, undefined, 'http://menu.localhost:3490'), undefined); process.env.MOLA_TEST_TUNNEL = '1';

  const { pair, base, token, code, owner } = await setup('tunnel-menu-host', { merkez: { menuOrigin: 'http://menu.localhost' } }); t.after(() => pair.close());
  // The QR codes hold the menu name (the heartbeat's tunnel.base and the flag), not Merkez's own address.
  assert.equal(base, `http://menu.localhost/q/${code}`);
  assert.ok(pair.link.read()!.accepts!.includes('guest.menu-origin'));
  const guest = phone(base, '127.0.0.1', pair.merkezBase);
  const page = await guest(`/${token}`);
  assert.equal(page.status, 200); assert.match(page.text, /menu-AbCdEf12\.js/);
  // The guest cookie: host-only (no Domain) and only under this business's prefix.
  const session = await guest('/api/guest/session', { token });
  assert.equal(session.status, 200, session.text);
  const cookie = String((session.headers['set-cookie'] as string[])[0]);
  assert.match(cookie, new RegExp(`; Path=/q/${code}/; HttpOnly; SameSite=Strict$`)); assert.doesNotMatch(cookie, /Domain=/i);
  assert.equal((await guest('/api/guest/state')).status, 200);
  // A POST from any other origin (Mola Yönetim's, the web site's) is refused on the menu name.
  for (const origin of [pair.merkezBase, 'https://molayazilim.com.tr']) assert.equal((await guest('/api/guest/call', { requestId: randomUUID(), kind: 'waiter' }, { Origin: origin })).status, 403, origin);
  // Everything but /q/ on the menu name: 404 (no Mola Yönetim, no API, no short links, no tunnel).
  const menuName = phone('http://menu.localhost', '127.0.0.1', pair.merkezBase);
  for (const p of ['/', '/merkez.html', '/index.html', '/api/merkez/admin/state', '/api/merkez/v1/health', '/api/site/form', '/s/AAAAAAAA/instagram', '/yonet', '/raporlarim', '/destek/x', '/Q/' + code + '/' + token, '/q']) {
    const r = await menuName(p); assert.equal(r.status, 404, p);
  }
  assert.equal((await menuName('/api/merkez/admin/login', { username: 'admin', password: 'x' })).status, 404);
  // /q/ on Merkez's own name: 308 to the menu name (old printed QR codes keep working); a POST there is refused.
  const atMerkez = phone(`${pair.merkezBase}/q/${code}`);
  const moved = await atMerkez(`/${token}`);
  assert.equal(moved.status, 308); assert.equal(moved.headers.location, `http://menu.localhost/q/${code}/${token}`);
  const upper = await phone(`${pair.merkezBase}/Q/${code}`)(`/${token}`); assert.equal(upper.status, 308);
  assert.equal((await atMerkez('/api/guest/session', { token })).status, 404);
  // Mola Yönetim itself stays on Merkez's name.
  assert.equal((await fetch(`${pair.merkezBase}/api/merkez/v1/health`)).status, 200);
  // The café: with the flag, never a QR on Merkez's own address (wait for the next heartbeat); an older Merkez (no flag): as before.
  const write = (fn: (r: any) => void) => (pair.link as unknown as { write(fn: (r: any) => void): void }).write(fn);
  write(r => { r.tunnel.base = pair.merkezBase; });
  assert.equal((await owner('/staff/network')).data.publicProblem, 'waiting');
  write(r => { delete r.tunnel.base; });
  assert.equal((await owner('/staff/network')).data.publicProblem, 'waiting');
  write(r => { r.accepts = r.accepts.filter((x: string) => x !== 'guest.menu-origin'); r.tunnel.base = pair.merkezBase; });
  assert.equal((await owner('/staff/network')).data.public.base, `${pair.merkezBase}/q/${code}`, 'an older Merkez: its address, as before');
  // The next heartbeat brings the menu name back.
  await pair.link.sync();
  assert.equal((await owner('/staff/network')).data.public.base, base);
});

test('WebSocket frames: masked from the café, fragmented messages, ping/pong, too large or unmasked closes', async () => {
  const { PassThrough } = await import('node:stream');
  const { encodeFrame, OPCODE } = await import('../server/ws-frames.js');
  const pipe = () => { const s = new PassThrough() as any; s.setNoDelay = () => {}; s.destroyed = false; s.destroy = () => { s.destroyed = true; s.emit('close'); }; return s; };
  // A message in three parts, masked like a client sends it, arriving byte by byte.
  const server = pipe(), got: Buffer[] = [], ws = new WsSocket(server, 'server', 1024);
  ws.on('message', (m: Buffer) => got.push(m));
  const body = Buffer.from('menü-'.repeat(20)), parts = [body.subarray(0, 30), body.subarray(30, 70), body.subarray(70)];
  const frames = parts.map((p, i) => { const f = encodeFrame(i === 0 ? OPCODE.binary : OPCODE.continuation, p, true); if (i < 2) f[0] &= 0x7f; return f; });
  for (const byte of Buffer.concat(frames)) server.write(Buffer.from([byte]));
  await new Promise(r => setImmediate(r));
  assert.equal(got.length, 1); assert.ok(got[0].equals(body));
  // A ping is answered with a pong (unmasked: we are the server).
  const out: Buffer[] = []; server.on('data', () => {}); const write = server.write.bind(server); server.write = (b: Buffer) => { out.push(b); return true; };
  write(encodeFrame(OPCODE.ping, Buffer.from('x'), true)); await new Promise(r => setImmediate(r));
  assert.equal(out.at(-1)![0], 0x80 | OPCODE.pong); assert.equal(out.at(-1)![1] & 0x80, 0);
  // An unmasked frame from a client breaks the protocol: closed.
  write(encodeFrame(OPCODE.binary, Buffer.from('x'), false)); await new Promise(r => setImmediate(r));
  assert.equal(ws.closed, true);
  // A message over the limit: closed (1009), nothing delivered.
  const big = pipe(), w2 = new WsSocket(big, 'server', 100); let delivered = 0; w2.on('message', () => delivered++);
  big.write(encodeFrame(OPCODE.binary, Buffer.alloc(200), true)); await new Promise(r => setImmediate(r));
  assert.equal(w2.closed, true); assert.equal(delivered, 0);
  // Header and body round trip of the tunnel's own messages.
  const m = unpack(pack({ t: 'data', id: 7, end: true }, Buffer.from('abc')));
  assert.deepEqual(m.head, { t: 'data', id: 7, end: true }); assert.equal(m.body.toString(), 'abc');
  assert.throws(() => unpack(Buffer.from([0, 0, 0, 9, 1])));
});