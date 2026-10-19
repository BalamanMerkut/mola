import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
// Short holds and timeouts: the café's long-poll comes back at once when there is nothing to do.
process.env.MOLA_RELAY_HOLD_MS = '300';
import { DEMO_PASSWORD } from '../server/app.js';
import { signedHeaders } from '../server/install-auth.js';
import { MERKEZ_API } from '../server/sync-protocol.js';
import { supportAllowed, describe as describeChange } from '../server/support-session.js';
import type { RelayClient } from '../server/relay.js';
import type { RelayHub } from '../server/merkez/relay.js';
import { merkezPair } from './merkez-fixture.js';
import { saatEki } from '../packages/domain/saat-eki.js';

const rid = () => randomUUID().replace(/-/g, '');
/** A start time at least an hour clear of 05:00 (tests that move their clock forward would otherwise end the business day). */
const awayFrom5 = (ms: number) => { const h = new Date(ms).getHours(); return h >= 3 && h < 5 ? ms + 3 * 3600_000 : ms; };
const wait = async (check: () => boolean | Promise<boolean>, ms = 8000) => { const end = Date.now() + ms; while (!(await check())) { if (Date.now() > end) throw new Error('Beklenen durum gelmedi.'); await new Promise(r => setTimeout(r, 25)); } };

/** A café with the demo businesses linked to a real Merkez, the owner signed in, the vendor signed in to Mola Yönetim. */
async function setup(name: string, now?: () => Date) {
  const pair = await merkezPair(name, { demo: true, ...(now ? { now } : {}) });
  await pair.importDemo(); await pair.adminLogin();
  const owner = pair.kafe(); assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  const relay = pair.kafeApp.locals.relay as RelayClient, hub = pair.merkezApp.locals.relayHub as RelayHub, tenant = pair.store.findUser('isletme')!.tenantId;
  /** The vendor's browser on Mola Merkez (its own cookie jar: the admin session and, once connected, mola_destek). */
  let cookie = '';
  const vendor = async (path: string, body?: unknown) => {
    const r = await fetch(pair.merkezBase + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let data: any = text; try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, data, type: r.headers.get('content-type') ?? '' };
  };
  const connect = async (tenantId = tenant) => {
    const r = await pair.admin('/support-sessions', { tenantId });
    if (r.status === 200) cookie = `mola_destek=${r.headers.getSetCookie().find(c => c.startsWith('mola_destek='))!.split(';')[0].slice('mola_destek='.length)}`;
    return r;
  };
  return { pair, owner, relay, hub, vendor, connect, tenant, setCookie: (v: string) => { cookie = v; } };
}

test('support allow-list: reports, money, staff, security and guests are never on it', () => {
  for (const [m, p] of [['GET', '/api/staff/state'], ['POST', '/api/staff/products'], ['POST', '/api/staff/categories'], ['POST', '/api/staff/campaigns'], ['POST', '/api/staff/tables/add'], ['POST', '/api/staff/tables/renew-qr'], ['POST', '/api/staff/printers'], ['POST', '/api/staff/settings'], ['GET', '/api/staff/support-session/diagnostics'], ['GET', '/media/mola-demo/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.webp']] as const) assert.equal(supportAllowed(m, p), true, `${m} ${p}`);
  const forbidden = ['/api/staff/reports/overview', '/api/staff/reports/financial', '/api/staff/payment-adjustments', '/api/staff/cash/status', '/api/staff/expenses', '/api/staff/stock', '/api/staff/users', '/api/staff/sessions', '/api/staff/report-security', '/api/staff/backup-status', '/api/staff/integrations', '/api/staff/reservations', '/api/staff/notifications', '/api/staff/support', '/api/staff/remote-support', '/api/staff/remote-reports', '/api/staff/refunds/payments', '/api/staff/accounts/x/items', '/api/staff/agenda', '/api/staff/shifts/code', '/api/desktop/status', '/api/login', '/api/guest/state', '/api/staff/update', '/api/staff/cash/settings', '/api/staff/profit/settings', '/api/staff/assignments', '/api/staff/blocks', '/api/staff/photo-storage', '/api/staff/first-steps'];
  for (const p of forbidden) for (const m of ['GET', 'POST']) assert.equal(supportAllowed(m, p), false, `${m} ${p}`);
  for (const p of ['/api/staff/payments', '/api/staff/orders', '/api/staff/expenses/edit', '/api/staff/users/password', '/api/staff/remote-support', '/api/staff/cash/finish', '/api/staff/approval-mode', '/api/staff/block']) assert.equal(supportAllowed('POST', p), false, p);
});

test('owner allows support → vendor connects through Mola Merkez, edits a price, cannot open reports; owner switches off → cut at once', async t => {
  const { pair, owner, relay, hub, vendor, connect, tenant } = await setup('relay-support'); t.after(() => pair.close());
  // Off: the café does not even poll; Merkez says "izin yok".
  assert.equal(relay.needed(), false);
  assert.equal((await connect()).data.code, 'SUPPORT_OFF');
  // Turning it on asks the owner's password again, in the same request: none or a wrong one leaves it off.
  const bare = await owner('/staff/remote-support', { on: true });
  assert.equal(bare.status, 400); assert.equal(bare.data.code, 'PASSWORD_REQUIRED');
  const wrong = await owner('/staff/remote-support', { on: true, password: 'yanlis-sifre' });
  assert.equal(wrong.status, 403); assert.equal(wrong.data.code, 'INVALID_PASSWORD');
  assert.equal((await owner('/staff/remote-support')).data.on, false);
  assert.equal(relay.needed(), false);
  assert.equal((await owner('/staff/remote-support', { on: true, password: DEMO_PASSWORD })).status, 200);
  await wait(() => relay.connected());
  const status = await pair.admin(`/support-sessions?tenantId=${tenant}`);
  assert.equal(status.data.access.on, true); assert.equal(status.data.online, true);
  // Only the owner switches it: other staff and Mola destek itself get 403.
  const cashier = pair.kafe(); await cashier('/login', { username: 'kasiyer', password: DEMO_PASSWORD });
  assert.equal((await cashier('/staff/remote-support', { on: false })).status, 403);
  const started = await connect();
  assert.equal(started.status, 200, JSON.stringify(started.data)); assert.match(started.data.url, /^\/destek\//);
  // The café screen through Merkez: role support, the menu, no orders, bills, guests or sales.
  const state = await vendor('/api/staff/state');
  assert.equal(state.status, 200, JSON.stringify(state.data)); assert.equal(state.data.role, 'support'); assert.equal(state.data.displayName, 'Mola destek');
  assert.deepEqual(state.data.orders, []); assert.deepEqual(state.data.takeaways, []); assert.equal(state.data.commissionBps, null);
  assert.ok(state.data.tables.every((x: any) => x.account === null && x.accountId === null));
  for (const key of ['serviceCalls', 'paymentContext', 'reservations', 'externalOrders', 'licenseNotice', 'stockProducts']) assert.equal(key in state.data, false, key);
  assert.equal((await vendor('/api/health')).data.support, true);
  assert.equal('desktop' in (await vendor('/api/health')).data, false, 'the desktop rail never shows to Mola destek');
  // Server-side 403 matrix through the relay.
  const today = new Date().toISOString().slice(0, 10);
  for (const path of [`/api/staff/reports/overview?from=${today}&to=${today}`, `/api/staff/reports/financial?from=${today}&to=${today}`, '/api/staff/payment-adjustments', '/api/staff/cash/status', '/api/staff/stock', '/api/staff/users', '/api/staff/sessions', '/api/staff/report-security', '/api/staff/backup-status', '/api/staff/integrations', '/api/staff/reservations', '/api/staff/notifications', '/api/staff/support', '/api/staff/remote-support', '/api/staff/refunds/payments', '/api/staff/agenda?from=2026-01-01&to=2026-01-02']) {
    const r = await vendor(path); assert.equal(r.status, 403, path); assert.equal(r.data.code, 'SUPPORT_FORBIDDEN', path);
  }
  for (const [path, body] of [['/api/staff/expenses', { requestId: rid(), amount: 100, description: 'x' }], ['/api/staff/remote-support', { on: true, password: DEMO_PASSWORD }], ['/api/staff/remote-reports/pair', { name: 'Destek', password: DEMO_PASSWORD }], ['/api/staff/users/password', {}], ['/api/staff/payments', {}]] as const) assert.equal((await vendor(path, body)).status, 403, path);
  // Not relayed at all: Mola Merkez's own routes and the café's desktop and login routes.
  assert.equal((await vendor('/api/desktop/status')).status, 404); assert.equal((await vendor('/api/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 404);
  // Campaigns: editable, but no sold counts.
  const campaigns = await vendor('/api/staff/campaigns');
  assert.equal(campaigns.status, 200); assert.ok(campaigns.data.campaigns.every((c: any) => c.usedQuantity === 0 && c.remainingQuantity === null));
  // A price change is made, logged for the owner and audited.
  const p = state.data.products[0], before = p.price, { id, ...rest } = p;
  const saved = await vendor('/api/staff/products', { requestId: rid(), revision: state.data.revision, id, product: { ...rest, price: before + 500 } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(pair.store.read(tenant).products.find(x => x.id === id)!.price, before + 500);
  const view = (await owner('/staff/remote-support')).data;
  assert.equal(view.active !== null, true);
  assert.ok(view.log.some((l: any) => l.text.includes(p.name) && l.text.includes('fiyat')), JSON.stringify(view.log));
  // Every staff screen shows "Mola ekibi bağlı" while the session is open.
  assert.ok((await cashier('/staff/state')).data.supportConnected?.since);
  // The owner was told it started.
  const inbox = (await owner('/staff/notifications')).data.items;
  assert.ok(inbox.some((n: any) => n.title === 'Mola ekibi bağlandı'));
  // 19 Ekim: the time with its own ending (14:30'da, 13:00'te), not a fixed "'de".
  const told = inbox.find((n: any) => n.title === 'Mola ekibi bağlandı'), startedAt = /oturumu (\d\d:\d\d)'/.exec(told.text)?.[1] ?? '';
  assert.ok(told.text.startsWith(`Uzaktan destek oturumu ${saatEki(startedAt, 'de')} başladı.`), told.text);
  // Switching off (no password needed) cuts the session at once, at the café and at Merkez.
  assert.equal((await owner('/staff/remote-support', { on: false })).status, 200);
  const after = await vendor('/api/staff/state');
  assert.equal(after.status, 401); assert.equal(after.data.code, 'SUPPORT_ENDED');
  await wait(() => hub.active(tenant) === null);
  assert.equal((await cashier('/staff/state')).data.supportConnected, undefined);
  const history = (await pair.admin(`/support-sessions?tenantId=${tenant}`)).data;
  assert.equal(history.access.on, false); assert.equal(history.history[0].endedBy !== null, true);
  const ended = (await owner('/staff/notifications')).data.items.find((n: any) => n.title === 'Mola destek oturumu bitti');
  assert.ok(ended);
  const endedAt = /^Oturum (\d\d:\d\d)'/.exec(ended.text)?.[1] ?? '';
  assert.ok(ended.text.startsWith(`Oturum ${saatEki(endedAt, 'de')} bitti`), ended.text);
  // Off again: a new connection is refused, and the café stops polling.
  assert.equal((await connect()).data.code, 'SUPPORT_OFF');
  await wait(() => !relay.needed());
});

test('a support session ends after 30 idle minutes, on Mola Yönetim’s "Bağlantıyı kes" and on the owner’s', async t => {
  // +31 minutes must not cross 05:00, where the business day (and the owner's sign-in) ends.
  let time = awayFrom5(Date.now());
  const { pair, owner, relay, hub, vendor, connect, tenant } = await setup('relay-idle', () => new Date(time)); t.after(() => pair.close());
  await owner('/staff/remote-support', { on: true, password: DEMO_PASSWORD }); await wait(() => relay.connected());
  assert.equal((await connect()).status, 200);
  assert.equal((await vendor('/api/staff/state')).status, 200);
  time += 31 * 60_000;
  const idle = await vendor('/api/staff/state');
  assert.ok([401, 403].includes(idle.status), String(idle.status));
  await wait(() => hub.active(tenant) === null);
  // Connect again and end it from Mola Yönetim.
  assert.equal((await connect()).status, 200);
  assert.equal((await pair.admin('/support-sessions/end', { tenantId: tenant })).status, 200);
  assert.equal((await vendor('/api/staff/state')).status, 401);
  await wait(async () => (await owner('/staff/remote-support')).data.active === null);
  // The owner's "Bağlantıyı kes" with the permission left on.
  assert.equal((await connect()).status, 200);
  assert.equal((await owner('/staff/remote-support/end', {})).data.active, null);
  assert.equal((await vendor('/api/staff/state')).status, 401);
  assert.equal((await owner('/staff/remote-support')).data.on, true);
});

test('relay: only the install’s own signature polls and replies; replays, unknown replies and floods are refused', async t => {
  const { pair, owner, relay, hub } = await setup('relay-auth'); t.after(() => pair.close());
  await owner('/staff/remote-support', { on: true, password: DEMO_PASSWORD }); await wait(() => relay.connected());
  const record = pair.link.read()!, path = `${MERKEZ_API}/relay/poll`, body = JSON.stringify({ v: 1, tenants: [] });
  const send = (headers: Record<string, string>, p = path, text = body) => fetch(pair.merkezBase + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: text });
  assert.equal((await send({})).status, 401);
  assert.equal((await send(signedHeaders(record.installId, 'b'.repeat(43), 'POST', path, body, Date.now()))).status, 401, 'another secret');
  const good = signedHeaders(record.installId, record.secret, 'POST', path, body, Date.now());
  assert.equal((await send(good)).status, 200);
  const replay = await send(good); assert.equal(replay.status, 401); assert.equal((await replay.json()).code, 'REPLAY');
  // A reply for a request this café was never given changes nothing.
  const replyPath = `${MERKEZ_API}/relay/reply`, reply = JSON.stringify({ id: randomUUID(), status: 200, json: { ok: true } });
  const answered = await send(signedHeaders(record.installId, record.secret, 'POST', replyPath, reply, Date.now()), replyPath, reply);
  assert.equal(answered.status, 200); assert.equal((await answered.json()).ok, false);
  // Unknown fields are refused (the café cannot slip anything else in).
  const extra = JSON.stringify({ v: 1, tenants: [], revenue: 1 });
  assert.equal((await send(signedHeaders(record.installId, record.secret, 'POST', path, extra, Date.now()), path, extra)).status, 400);
  // At most 120 polls a minute per install.
  const results = await Promise.all(Array.from({ length: 125 }, () => send(signedHeaders(record.installId, record.secret, 'POST', path, body, Date.now())).then(r => r.status)));
  assert.ok(results.some(s => s === 429), 'flood limited');
  // A request for a café that is not connected fails fast.
  await assert.rejects(hub.send(randomUUID(), { kind: 'support.end', tenantId: 'x', session: randomUUID(), reason: 'vendor' }), /bağlı değil/);
});

test('support change log lines say what changed in plain words', () => {
  const s = { products: [{ id: 'p1', name: 'Latte', price: 9000, category: 'Kahveler' }], productDrafts: [], tables: [{ id: 't1', name: 'Masa 03' }], printers: [{ id: 'r1', name: 'Bar' }], campaigns: [], name: 'Kafe', changeSeconds: 0 } as any;
  assert.equal(describeChange('/api/staff/products', { id: 'p1', product: { name: 'Latte', price: 9500, category: 'Kahveler' } }, s, s, {}), 'Ürün değişti: Latte · fiyat ₺90 → ₺95.');
  assert.equal(describeChange('/api/staff/tables/renew-qr', {}, s, s, { tableName: 'Masa 03' }), 'QR kodu yenilendi: Masa 03. Eski QR artık açılmaz; yenisini yazdırın.');
  assert.equal(describeChange('/api/staff/printers/delete', { id: 'r1' }, s, s, {}), 'Yazıcı silindi: Bar.');
  assert.equal(describeChange('/api/staff/photo-source', {}, s, s, {}), undefined);
});
