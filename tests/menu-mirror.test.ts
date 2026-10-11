import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
process.env.MOLA_TUNNEL_RETRY_MS = '150';
process.env.MOLA_TUNNEL_REQUEST_MS = '4000';
import { DEMO_PASSWORD } from '../server/app.js';
import type { GuestTunnel } from '../server/guest-tunnel.js';
import type { MenuMirror } from '../server/menu-mirror.js';
import type { GuestTunnelHub } from '../server/merkez/guest-tunnel.js';
import type { MenuMirrorStore } from '../server/merkez/menu-mirror.js';
import { QR_OFFLINE_TEXT } from '../packages/domain/qr-ordering.js';
import { merkezPair, temp } from './merkez-fixture.js';

/*
 * Menünün Mola Merkez'deki kopyası (8 Ekim): the café sends its guest-visible menu and photos to Merkez; with the café computer
 * off (tunnel down) guests still browse the menu from Merkez, ordering closed; orders always go to the café, which decides.
 */
const wait = async (check: () => boolean | Promise<boolean>, ms = 8000) => { const end = Date.now() + ms; while (!(await check())) { if (Date.now() > end) throw new Error('Beklenen durum gelmedi.'); await new Promise(r => setTimeout(r, 25)); } };
const filesUnder = (dir: string): string[] => existsSync(dir) ? readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? filesUnder(p) : [p]; }) : [];
function fakeBuild(name: string, marker: string) {
  const dir = temp(name);
  mkdirSync(join(dir, '.vite'), { recursive: true }); mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'menu.html'), `<!doctype html><html><head><script type="module" src="./assets/menu-AbCdEf12.js"></script></head><body data-build="${marker}"><div id="root"></div></body></html>`);
  writeFileSync(join(dir, 'assets', 'menu-AbCdEf12.js'), `console.log("${marker}");`);
  writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify({ 'menu.html': { file: 'assets/menu-AbCdEf12.js', isEntry: true } }));
  return dir;
}
function guestPhone(base: string) {
  const origin = new URL(base).origin, jar = new Map<string, string>(); let session = '';
  const call = async (path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(session ? { 'X-Guest-Session': session } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) { const [k, v] = c.split(';')[0].split('='); jar.set(k, v); }
    const bytes = Buffer.from(await r.arrayBuffer()); let data: any; try { data = JSON.parse(bytes.toString('utf8')); } catch { data = undefined; }
    if (typeof data?.session === 'string') session = data.session;
    return { status: r.status, data, bytes, text: bytes.toString('utf8'), headers: r.headers };
  };
  return Object.assign(call, { reset: () => { session = ''; }, get session() { return session; } });
}
async function setup(name: string) {
  const pair = await merkezPair(name, { demo: true, merkez: { buildDirectory: fakeBuild(`${name}-merkez-build`, 'merkez') } });
  const { installId } = await pair.importDemo();
  const tunnel = pair.kafeApp.locals.guestTunnel as GuestTunnel, hub = pair.merkezApp.locals.guestTunnel as GuestTunnelHub;
  const mirror = pair.kafeApp.locals.menuMirror as MenuMirror, copies = pair.merkezApp.locals.menuMirror as MenuMirrorStore;
  tunnel.serveFrom(fakeBuild(`${name}-kafe-build`, 'kafe'));
  await pair.link.sync(); await pair.link.sync();
  await wait(() => tunnel.connected() && hub.online(installId));
  const owner = pair.kafe(); assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  // This test Merkez is on 127.0.0.1: the table QR codes keep the café's Wi-Fi address ('private', server/kafe-link.ts
  // publicMenuBase), yet the menu copy still goes to it (tunnelAddress) and guests reach it at the Merkez address.
  assert.equal((await owner('/staff/network')).data.publicProblem, 'private');
  const address = pair.link.tunnelAddress('mola-demo'); assert.ok('base' in address, JSON.stringify(address));
  const base = address.base, table = pair.store.read('mola-demo').tables[0];
  return { pair, installId, tunnel, hub, mirror, copies, owner, base, table, code: base.split('/q/')[1] };
}

test('the café sends its menu and photos once per hash; Merkez keeps them sealed, deletes old photos, and the copy follows every change', async t => {
  const { pair, mirror, copies } = await setup('mirror-push'); t.after(() => pair.close());
  // A product photo the way the café saves them (800 px and a small one, WebP, under media/<işletme>/).
  const id = randomUUID(), media = join(pair.store.directory, 'media', 'mola-demo'); mkdirSync(media, { recursive: true });
  const large = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c08040' } }).webp().toBuffer(), small = await sharp(large).resize(32, 32).webp().toBuffer();
  writeFileSync(join(media, `${id}.webp`), large); writeFileSync(join(media, `${id}-small.webp`), small);
  pair.store.mutate('mola-demo', s => { s.products.find(p => p.id === 'tea')!.photo = `/media/mola-demo/${id}.webp`; });
  await mirror.flush();
  const copy = copies.get('mola-demo');
  assert.ok(copy, 'the copy arrived');
  assert.equal(copy!.products.find(p => p.id === 'tea')!.name, 'Demleme Çay');
  assert.ok(copy!.tables.length > 0 && copy!.tables.every(x => /^[a-f0-9]{40}$/.test(x.h)), 'tables by the hash of their QR token only');
  assert.ok(!JSON.stringify(copy).includes(pair.store.read('mola-demo').tables[0].token), 'never a table token');
  assert.deepEqual(Object.keys(copy!.photos).sort(), [`${id}-small.webp`, `${id}.webp`]);
  assert.deepEqual(copies.photo('mola-demo', `${id}.webp`)!.body, large);
  assert.equal(mirror.results.get('mola-demo')!.photos, 2);
  // Sealed at rest: no product name in merkez.sqlite or the photo folder; no sales data anywhere at Merkez.
  for (const f of [join(pair.dir, 'merkez', 'merkez.sqlite'), ...filesUnder(`${join(pair.dir, 'merkez')}-menu`)]) assert.ok(!readFileSync(f).includes('Demleme Çay'), f);
  // Nothing changed: nothing sent again. A price change: the copy follows, the photo is not sent again.
  await mirror.flush(); mirror.mark('mola-demo'); await mirror.flush();
  pair.store.mutate('mola-demo', s => { s.products.find(p => p.id === 'tea')!.price = 4000; });
  await mirror.flush();
  assert.equal(copies.get('mola-demo')!.products.find(p => p.id === 'tea')!.price, 4000);
  assert.equal(mirror.results.get('mola-demo')!.photos, 0, 'photos go once per hash');
  // The photo removed from the menu: Merkez deletes it.
  pair.store.mutate('mola-demo', s => { s.products.find(p => p.id === 'tea')!.photo = null; });
  await mirror.flush();
  assert.equal(copies.usage('mola-demo')!.photos, 0); assert.equal(copies.photo('mola-demo', `${id}.webp`), undefined);
  // A photo the copy does not name, or bytes that are not its hash, are refused.
  const sign = await pair.link.relayPostBytes(`/menu/photo/mola-demo/${'a'.repeat(64)}`, large).catch((e: Error & { code?: string }) => e.code);
  assert.equal(sign, 'PHOTO_NOT_IN_MENU');
  // The other business of this computer has its own copy; Mola Yönetim sees counts only.
  await pair.adminLogin();
  const view = (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo').menu;
  assert.equal(view.mirror.products, copy!.products.length); assert.equal(typeof view.mirror.updatedAt, 'string');
  assert.deepEqual(view.ordering, { open: true, call: true });
});

test('café computer off: the guest still opens the menu from Merkez, ordering closed ("Şu an sipariş alınamıyor"); back on, a real session takes over', async t => {
  const { pair, tunnel, hub, mirror, installId, base, table } = await setup('mirror-offline'); t.after(() => pair.close());
  // A campaign running now and one for tomorrow: the copy applies them when the guest looks, not when it was sent.
  pair.store.mutate('mola-demo', s => {
    s.campaigns = [{ id: 'now', name: 'Çay saati', kind: 'percent', percent: 20, productIds: ['tea'], startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: null, enabled: true, combine: false },
      { id: 'later', name: 'Yarın', kind: 'percent', percent: 50, productIds: ['herbal'], startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: null, enabled: true, combine: false }];
  });
  await mirror.flush();
  tunnel.pause(true); await wait(() => !hub.online(installId));
  const guest = guestPhone(base);
  const page = await guest(`/${table.token}`);
  assert.equal(page.status, 200); assert.match(page.text, /data-build="merkez"/, "Merkez's own built page");
  assert.equal((await guest('/assets/menu-AbCdEf12.js')).status, 200);
  assert.equal((await guest('/AAAAAAAAAAAAAAAAAAAAAAAA')).status, 404, 'an unknown table is not shown');
  const session = await guest('/api/guest/session', { token: table.token });
  assert.equal(session.status, 200); assert.equal(session.data.mirror, true); assert.match(session.data.session, /^mirror[a-f0-9]{40}/);
  const state = await guest('/api/guest/state');
  assert.equal(state.status, 200);
  assert.equal(state.data.mirror, true); assert.deepEqual(state.data.ordering, { open: false, reason: 'offline', call: false });
  assert.equal(state.data.table.name, table.name); assert.equal(state.data.orders.length, 0);
  const tea = state.data.products.find((p: any) => p.id === 'tea'), herbal = state.data.products.find((p: any) => p.id === 'herbal');
  assert.equal(tea.discounts.length, 1); assert.equal(herbal.discounts.length, 0, 'tomorrow’s campaign is not on yet');
  assert.equal((await guest('/api/guest/state', undefined, { 'X-Mola-Tag': state.headers.get('x-mola-tag')! })).status, 204);
  const order = await guest('/api/guest/orders', { requestId: randomUUID(), tableId: 'mirror', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 2800 });
  assert.equal(order.status, 503); assert.equal(order.data.code, 'CAFE_OFFLINE'); assert.equal(order.data.message, QR_OFFLINE_TEXT.tr);
  assert.equal((await guest('/api/guest/call', { requestId: randomUUID(), kind: 'waiter' })).status, 503);
  // A session that is not Merkez's (or a forged one) gets no copy.
  assert.equal((await guestPhone(base)('/api/guest/state', undefined, { 'X-Guest-Session': `mirror${'0'.repeat(40)}${'A'.repeat(22)}` })).status, 503);
  // The café comes back: Merkez's session gives way, the page starts a real one and orders go to the café.
  tunnel.pause(false); await wait(() => hub.online(installId));
  const renew = await guest('/api/guest/state');
  assert.equal(renew.status, 409); assert.equal(renew.data.code, 'SESSION_RENEW');
  guest.reset();
  const real = await guest('/api/guest/session', { token: table.token });
  assert.equal(real.status, 200); assert.equal(real.data.mirror, undefined);
  const live = await guest('/api/guest/state');
  assert.equal(live.data.mirror, undefined); assert.deepEqual(live.data.ordering, { open: true, call: true });
  // Sold out a moment ago: the café's own menu decides, plainly.
  pair.store.mutate('mola-demo', s => { s.products.find(p => p.id === 'tea')!.soldOut = true; });
  const raced = await guest('/api/guest/orders', { requestId: randomUUID(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 2800 });
  assert.equal(raced.status, 409); assert.equal(raced.data.code, 'ITEM_UNAVAILABLE'); assert.match(raced.data.message, /^Bu ürün az önce tükendi: Demleme Çay\./);
});

test('suspended, or no copy (an older café): as before; the business deleted: its copy and photos go with it', async t => {
  const { pair, tunnel, hub, mirror, copies, installId, base, table } = await setup('mirror-closed'); t.after(() => pair.close());
  await mirror.flush(); assert.ok(copies.get('mola-demo'));
  tunnel.pause(true); await wait(() => !hub.online(installId));
  // A business whose café never sent a copy (an older café): the "Menü şu anda açılamıyor" page, as before.
  copies.forget('mola-demo');
  assert.equal((await guestPhone(base)(`/${table.token}`)).status, 503);
  await mirror.reconnected(); tunnel.pause(false); await wait(() => hub.online(installId)); await mirror.flush(); assert.ok(copies.get('mola-demo'));
  await pair.adminLogin();
  const b = (await pair.admin('/state')).data.businesses.find((x: any) => x.tenantId === 'mola-demo');
  assert.equal((await pair.admin('/licenses', { requestId: randomUUID().replace(/-/g, ''), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: false, months: 0, suspended: true, reason: 'Deneme' })).status, 200);
  const page = await guestPhone(base)(`/${table.token}`);
  assert.equal(page.status, 200); assert.match(page.text, /data-status="unavailable"/, 'suspended: closed at Merkez, copy or not');
  assert.equal((await pair.admin('/businesses/delete', { requestId: randomUUID().replace(/-/g, ''), tenantId: 'mola-demo', confirmName: b.name })).status, 200);
  assert.equal(copies.get('mola-demo'), undefined); assert.equal(copies.usage('mola-demo'), undefined);
  assert.equal(filesUnder(`${join(pair.dir, 'merkez')}-menu`).length, 0);
});
