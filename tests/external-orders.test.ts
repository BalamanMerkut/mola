import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { seed } from '../server/seed.js';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { DomainError, recordPayment, setStatus } from '../packages/domain/engine.js';
import { acceptExternalOrder, cancelExternalOrder, dueCalls, KEEP_FINISHED_MS, publicExternalOrders, queueExternalUpdates, receiveExternalOrder, rejectExternalOrder, reportCall, setMenuMapping, withoutPersonal, type IncomingOrder } from '../packages/domain/external-orders.js';
import { orderChannel } from '../packages/domain/platforms.js';
import { financialReport, salesOverview, employeeReport } from '../packages/domain/reports.js';
import { adjustPayment } from '../packages/domain/payment-adjustments.js';
import { kitchenTicket, paymentTicket, renderText, type PrinterConfig } from '../packages/domain/printing.js';
import { IntegrationManager } from '../server/integrations/manager.js';
import { TestPlatform } from '../server/integrations/adapters.js';
import { redact } from '../server/integrations/secrets.js';
import { AdapterError } from '../server/integrations/types.js';
import type { Actor, State } from '../packages/domain/types.js';

const at = (iso: string) => ({ now: new Date(iso), id: randomUUID });
const owner: Actor = { tenantId: 'mola-demo', id: 'owner', role: 'owner' };
const cashier: Actor = { ...owner, id: 'cashier', role: 'cashier' };
const kitchen: Actor = { ...owner, id: 'kitchen', role: 'kitchen' };
const waiter: Actor = { ...owner, id: 'waiter', role: 'waiter' };
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return 'NO_ERROR'; };
const printer: PrinterConfig = { id: 'p', name: 'Mutfak', enabled: true, connection: { type: 'network', host: '192.168.1.50', port: 9100 }, width: 58, charset: 'ascii', orders: true, categories: [], bill: true, createdAt: '2026-10-01T00:00:00Z' };
function business(): State { const s = seed(); s.changeSeconds = 0; return s; }
const incoming = (s: State, over: Partial<IncomingOrder> = {}): IncomingOrder => {
  const p = s.products.find(p => p.unit !== 'kg' && !p.groups.some(g => g.required))!;
  return { externalId: 'ys-1001', code: '1234', customerName: 'Ayşe K.', note: 'Zili çalmayın', deliveryType: 'kurye', paidOnline: true, total: p.price * 2 + 1500, receivedAt: '2026-10-04T09:00:00Z', acceptBy: '2026-10-04T09:05:00Z',
    items: [{ externalId: 'x-1', name: p.name, quantity: 2, unitPrice: p.price }, { externalId: 'x-sos', name: 'Ekstra sos', quantity: 1, unitPrice: 1500, note: 'Ayrı kapta' }], ...over };
};

test('incoming orders wait for approval, are read once (dedupe by platform + id) and touch nothing else until accepted', () => {
  const s = business(), before = { tables: s.tables.length, orders: s.orders.length, payments: s.payments.length };
  const first = receiveExternalOrder(s, 'yemeksepeti', incoming(s), at('2026-10-04T09:00:01Z'));
  const again = receiveExternalOrder(s, 'yemeksepeti', incoming(s), at('2026-10-04T09:00:20Z'));
  assert.equal(first.created, true); assert.equal(again.created, false); assert.equal(again.id, first.id);
  // Same id on another platform is another order.
  assert.equal(receiveExternalOrder(s, 'getir', incoming(s), at('2026-10-04T09:00:30Z')).created, true);
  assert.equal(s.externalOrders!.length, 2);
  assert.deepEqual({ tables: s.tables.length, orders: s.orders.length, payments: s.payments.length }, before);
  assert.equal(s.externalOrders![0].stage, 'pending');
  assert.equal(code(() => receiveExternalOrder(s, 'test', { ...incoming(s), externalId: 'bad', items: [] }, at('2026-10-04T09:01:00Z'))), 'INVALID_EXTERNAL_ORDER');
  // Waiters do not approve platform orders; the kitchen sees no money.
  assert.equal(code(() => acceptExternalOrder(s, waiter, { id: first.id!, version: 1 }, at('2026-10-04T09:01:00Z'))), 'FORBIDDEN');
  const view = publicExternalOrders(s, 'kitchen');
  assert.ok(view.every(o => o.total === 0 && o.items.every(i => i.unitPrice === 0)));
  assert.equal(view[0].items[1].unmatched, true, 'Ekstra sos is not on the menu'); assert.ok(!view[0].items[0].unmatched);
});

test('Kabul opens a platform ticket for the kitchen; paid online it records "Platform ödemesi", never cash or card', () => {
  const s = business();
  const { id } = receiveExternalOrder(s, 'yemeksepeti', incoming(s), at('2026-10-04T09:00:01Z'));
  const { orderId } = acceptExternalOrder(s, cashier, { id: id!, version: 1 }, at('2026-10-04T09:00:30Z'));
  // A second Kabul (another screen, a retry) changes nothing.
  assert.equal(acceptExternalOrder(s, kitchen, { id: id!, version: 1 }, at('2026-10-04T09:00:31Z')).already, true);
  const o = s.orders.find(o => o.id === orderId)!, table = s.tables.find(t => t.accountId === o.accountId)!;
  assert.equal(table.name, 'Yemeksepeti #1234'); assert.ok(table.takeaway); assert.equal(table.takeaway!.label, 'Ayşe');
  assert.equal(o.status, 'new'); assert.equal(o.external!.platform, 'yemeksepeti'); assert.equal(o.external!.code, '1234');
  assert.equal(o.lines[1].unmatched, true); assert.equal(o.lines[1].name, 'Ekstra sos'); assert.ok(!o.lines[0].unmatched);
  const payment = s.payments.find(p => p.accountId === o.accountId)!;
  assert.equal(payment.method, 'platform'); assert.equal(payment.amount, o.total);
  // Kitchen can start right away; the kitchen ticket names the platform loud and clear.
  setStatus(s, kitchen, o.id, o.version, 'preparing', new Date('2026-10-04T09:01:00Z'));
  const ticket = renderText(kitchenTicket(s, o, printer, o.lines), printer).join('\n');
  assert.match(ticket, /YEMEKSEPETI\s+#1234/, 'large print may wrap on 58 mm'); assert.match(ticket, /Kurye ile teslim/); assert.match(ticket, /Zili/);
  assert.match(renderText(paymentTicket(s, payment.id, new Date('2026-10-04T09:02:00Z')), printer).join('\n'), /Platform ödemesi/);
  setStatus(s, kitchen, o.id, o.version, 'ready', new Date('2026-10-04T09:10:00Z'));
  setStatus(s, cashier, o.id, o.version, 'served', new Date('2026-10-04T09:15:00Z'));
  assert.equal(s.accounts.find(a => a.id === o.accountId)!.status, 'closed', 'paid online: handing over closes the ticket');
  // Reports: no cash, no card; the money is "platform" and the sale counts in the Yemeksepeti channel.
  const f = financialReport(s, '2026-10-04', '2026-10-04');
  assert.equal(f.cash, 0); assert.equal(f.card, 0); assert.equal(f.platform, o.total); assert.equal(f.collected, o.total);
  assert.equal(f.cashAfterExpenses, 0); assert.equal(f.unknownCommissionCount, 0);
  const channels = salesOverview(s, '2026-10-04', '2026-10-04', new Date('2026-10-04T10:00:00Z')).channels;
  assert.deepEqual(channels.find(c => c.id === 'yemeksepeti'), { id: 'yemeksepeti', name: 'Yemeksepeti', orders: 1, amount: o.total });
  assert.equal(channels.find(c => c.id === 'salon')!.orders, 0);
  assert.ok(!employeeReport(s, '2026-10-04', '2026-10-04').rows.some(r => r.id.startsWith('platform:')), 'no fake employee row');
  // A platform payment is refunded by the platform, never corrected in the café.
  assert.equal(code(() => adjustPayment(s, owner, { requestId: randomUUID(), paymentId: payment.id, revision: 0, kind: 'refund', amount: 100, method: 'cash', commission: 0, reason: 'deneme' }, at('2026-10-04T11:00:00Z'))), 'PLATFORM_PAYMENT');
});

test('paid at the door: the counter collects as usual; channels split Salon, Masasız and platforms', () => {
  const s = business();
  const { id } = receiveExternalOrder(s, 'getir', incoming(s, { externalId: 'g-1', code: '77', paidOnline: false, deliveryType: 'gel-al' }), at('2026-10-04T09:00:00Z'));
  const { orderId } = acceptExternalOrder(s, owner, { id: id!, version: 1 }, at('2026-10-04T09:00:10Z'));
  const o = s.orders.find(o => o.id === orderId)!, account = s.accounts.find(a => a.id === o.accountId)!;
  assert.ok(!s.payments.some(p => p.accountId === account.id)); assert.ok(!o.paymentBeforePreparation);
  recordPayment(s, cashier, { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'cash', amount: o.total, tendered: o.total }, at('2026-10-04T09:20:00Z'));
  const f = financialReport(s, '2026-10-04', '2026-10-04');
  assert.equal(f.cash, o.total); assert.equal(f.platform, 0);
  assert.equal(f.channels.find(c => c.id === 'getir')!.amount, o.total);
  assert.equal(orderChannel({}, 'Masasız #4'), 'masasiz'); assert.equal(orderChannel({}, 'Paket #3'), 'masasiz'); assert.equal(orderChannel({}, 'Masa 4'), 'salon');
});

test('Reddet keeps the reason; platform cancellations close waiting and accepted orders and drop the placeholder payment', () => {
  const s = business();
  const a = receiveExternalOrder(s, 'trendyol', incoming(s, { externalId: 't-1' }), at('2026-10-04T09:00:00Z'));
  assert.equal(code(() => rejectExternalOrder(s, kitchen, { id: a.id!, version: 1, reason: '' }, at('2026-10-04T09:00:10Z'))), 'REASON_REQUIRED');
  rejectExternalOrder(s, kitchen, { id: a.id!, version: 1, reason: 'Ürün tükendi' }, at('2026-10-04T09:00:10Z'));
  assert.equal(s.externalOrders![0].stage, 'rejected'); assert.equal(s.externalOrders![0].reason, 'Ürün tükendi');
  assert.equal(code(() => acceptExternalOrder(s, owner, { id: a.id!, version: 2 }, at('2026-10-04T09:00:20Z'))), 'INVALID_TRANSITION');
  const b = receiveExternalOrder(s, 'trendyol', incoming(s, { externalId: 't-2' }), at('2026-10-04T09:01:00Z'));
  const { orderId } = acceptExternalOrder(s, owner, { id: b.id!, version: 1 }, at('2026-10-04T09:01:10Z'));
  const accountId = s.orders.find(o => o.id === orderId)!.accountId;
  assert.ok(s.payments.some(p => p.accountId === accountId));
  receiveExternalOrder(s, 'trendyol', { externalId: 't-2', total: 0, items: [], status: 'cancelled', cancelReason: 'Müşteri iptal etti' }, at('2026-10-04T09:02:00Z'));
  assert.equal(s.orders.find(o => o.id === orderId)!.status, 'cancelled');
  assert.ok(!s.payments.some(p => p.accountId === accountId)); assert.equal(s.accounts.find(a => a.id === accountId)!.status, 'closed');
  assert.equal(s.externalOrders!.find(e => e.id === b.id)!.stage, 'cancelled');
  // The café cancels an accepted one: the platform is told through the outbox.
  const c = receiveExternalOrder(s, 'trendyol', incoming(s, { externalId: 't-3' }), at('2026-10-04T09:03:00Z'));
  acceptExternalOrder(s, owner, { id: c.id!, version: 1 }, at('2026-10-04T09:03:10Z'));
  assert.equal(code(() => cancelExternalOrder(s, cashier, { id: c.id!, version: 2, reason: 'Mutfak çok yoğun' }, at('2026-10-04T09:04:00Z'))), 'FORBIDDEN');
  cancelExternalOrder(s, kitchen, { id: c.id!, version: 2, reason: 'Mutfak çok yoğun' }, at('2026-10-04T09:04:00Z'));
  assert.deepEqual(dueCalls(s, new Date('2026-10-04T09:04:00Z')).map(d => d.action), ['cancel']);
});

test('kitchen steps become owed platform calls (ready, delivered) with backoff; finished records leave but stay deduped', () => {
  const s = business();
  const { id } = receiveExternalOrder(s, 'migros', incoming(s, { externalId: 'm-1' }), at('2026-10-04T09:00:00Z'));
  const { orderId } = acceptExternalOrder(s, owner, { id: id!, version: 1 }, at('2026-10-04T09:00:10Z'));
  const o = s.orders.find(o => o.id === orderId)!;
  assert.equal(queueExternalUpdates(s, new Date('2026-10-04T09:00:20Z')), false, 'nothing owed yet');
  setStatus(s, kitchen, o.id, o.version, 'preparing', new Date('2026-10-04T09:01:00Z'));
  setStatus(s, kitchen, o.id, o.version, 'ready', new Date('2026-10-04T09:05:00Z'));
  assert.equal(queueExternalUpdates(s, new Date('2026-10-04T09:05:01Z')), true);
  assert.deepEqual(dueCalls(s, new Date('2026-10-04T09:05:01Z')).map(d => d.action), ['ready']);
  reportCall(s, id!, 'ready', { ok: false, error: 'Platform zamanında yanıt vermedi' }, new Date('2026-10-04T09:05:02Z'));
  const e = s.externalOrders![0];
  assert.equal(e.error, 'Platform zamanında yanıt vermedi'); assert.equal(e.outbox[0].attempts, 1);
  assert.deepEqual(dueCalls(s, new Date('2026-10-04T09:05:03Z')), [], 'waits before trying again');
  assert.equal(dueCalls(s, new Date('2026-10-04T09:05:08Z')).length, 1);
  reportCall(s, id!, 'ready', { ok: true }, new Date('2026-10-04T09:05:08Z'));
  assert.equal(e.error, undefined); assert.deepEqual(e.reported, ['accept', 'ready']);
  setStatus(s, cashier, o.id, o.version, 'served', new Date('2026-10-04T09:10:00Z'));
  queueExternalUpdates(s, new Date('2026-10-04T09:10:01Z'));
  assert.deepEqual(dueCalls(s, new Date('2026-10-04T09:10:01Z')).map(d => d.action), ['delivered']);
  reportCall(s, id!, 'delivered', { ok: true }, new Date('2026-10-04T09:10:02Z'));
  queueExternalUpdates(s, new Date(Date.parse('2026-10-04T09:10:02Z') + KEEP_FINISHED_MS + 1000));
  assert.equal(s.externalOrders!.length, 0); assert.deepEqual(s.externalSeen, ['migros:m-1']);
  assert.equal(receiveExternalOrder(s, 'migros', incoming(s, { externalId: 'm-1' }), at('2026-10-06T12:00:00Z')).created, false, 'a late repeat is never added again');
  // A waiting order past the platform's deadline is marked missed.
  receiveExternalOrder(s, 'migros', incoming(s, { externalId: 'm-2', acceptBy: '2026-10-06T12:05:00Z' }), at('2026-10-06T12:00:00Z'));
  queueExternalUpdates(s, new Date('2026-10-06T12:08:00Z'));
  assert.equal(s.externalOrders![0].stage, 'missed');
});

test('menu mapping sends the kitchen the Mola product; history keeps no customer name or note', () => {
  const s = business(), p = s.products.find(p => p.unit !== 'kg')!;
  setMenuMapping(s, owner, { platform: 'yemeksepeti', key: 'id:x-sos', name: 'Ekstra sos', productId: p.id });
  assert.equal(code(() => setMenuMapping(s, cashier, { platform: 'yemeksepeti', key: 'id:x', name: 'x', productId: p.id })), 'FORBIDDEN');
  const { id } = receiveExternalOrder(s, 'yemeksepeti', incoming(s), at('2026-10-04T09:00:00Z'));
  const { orderId } = acceptExternalOrder(s, owner, { id: id!, version: 1 }, at('2026-10-04T09:00:10Z'));
  const o = s.orders.find(o => o.id === orderId)!;
  assert.equal(o.lines[1].productId, p.id); assert.equal(o.lines[1].name, p.name); assert.ok(!o.lines[1].unmatched);
  assert.deepEqual(o.lines[1].optionNames, ['Ekstra sos'], 'the platform name stays readable under the menu name');
  const stored = withoutPersonal(o);
  assert.equal(stored.external!.customerName, undefined); assert.equal(stored.external!.note, undefined); assert.equal(stored.external!.code, '1234');
});

test('manager: polls the test platform, Kabul/Reddet call the platform with retries, errors stay visible, owed calls retry', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/external-')), store = new Store(directory, ['mola-demo']);
  let time = Date.parse('2026-10-04T09:00:00Z');
  const now = () => new Date(time), platform = new TestPlatform();
  const manager = new IntegrationManager(store, now, { tickMs: 0, retryMs: [1, 1], testPlatform: platform });
  t.after(() => { manager.stop(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.mutate('mola-demo', s => { s.changeSeconds = 0; s.integrationSettings = { test: { enabled: true } }; });
  platform.createOrder('mola-demo', store.read('mola-demo').products, now());
  platform.failNext('mola-demo', 'fetch');
  await manager.tick('mola-demo');
  assert.equal(manager.healthOf('mola-demo', 'test').state, 'error'); assert.match(manager.healthOf('mola-demo', 'test').message!, /yanıt vermiyor/);
  await manager.tick('mola-demo');
  assert.equal(store.read('mola-demo').externalOrders?.length ?? 0, 0, 'after an error the next poll waits (backoff)');
  time += 41_000; await manager.tick('mola-demo');
  assert.equal(manager.healthOf('mola-demo', 'test').state, 'connected');
  let entry = store.read('mola-demo').externalOrders![0];
  assert.equal(entry.stage, 'pending'); assert.ok(entry.items.length >= 2); assert.ok(entry.customerName); assert.ok(entry.note);
  // The platform keeps failing: Kabul is tried three times, then the card shows why and the order still waits.
  platform.failNext('mola-demo', 'accept', 3);
  await assert.rejects(manager.accept('mola-demo', owner, { id: entry.id, version: entry.version }), (e: DomainError) => e.code === 'PLATFORM_FAILED' && e.status === 424);
  entry = store.read('mola-demo').externalOrders![0];
  assert.equal(entry.stage, 'pending'); assert.match(entry.error!, /yanıt vermiyor/);
  assert.equal(platform.calls.filter(c => c.action === 'accept').length, 0);
  // One failure is retried within the same Kabul.
  platform.failNext('mola-demo', 'accept', 1);
  await manager.accept('mola-demo', kitchen, { id: entry.id, version: entry.version });
  assert.equal(platform.calls.filter(c => c.action === 'accept').length, 1);
  const s = store.read('mola-demo'), o = s.orders.find(o => o.external?.externalId === entry.externalId)!;
  assert.equal(s.externalOrders![0].stage, 'accepted'); assert.equal(s.externalOrders![0].error, undefined);
  store.mutate('mola-demo', s => { setStatus(s, kitchen, o.id, o.version, 'preparing', now()); setStatus(s, kitchen, o.id, o.version + 1, 'ready', now()); });
  platform.failNext('mola-demo', 'ready', 1);
  await manager.flush('mola-demo');
  assert.match(store.read('mola-demo').externalOrders![0].error!, /yanıt vermiyor/);
  time += 6_000; await manager.flush('mola-demo');
  assert.deepEqual(platform.calls.map(c => c.action), ['accept', 'ready']);
  assert.equal(store.read('mola-demo').externalOrders![0].error, undefined);
  // Reddet with a reason, dedupe on the next poll.
  const second = platform.createOrder('mola-demo', store.read('mola-demo').products, now());
  platform.push('mola-demo', second);
  time += 21_000; await manager.tick('mola-demo');
  const waiting = store.read('mola-demo').externalOrders!.filter(e => e.stage === 'pending');
  assert.equal(waiting.length, 1, 'the same order twice in one poll is read once');
  await manager.reject('mola-demo', cashier, { id: waiting[0].id, version: waiting[0].version, reason: 'Mutfak çok yoğun' });
  assert.deepEqual(platform.calls.at(-1), { tenantId: 'mola-demo', action: 'reject', externalId: second.externalId, reason: 'Mutfak çok yoğun', at: now().toISOString() });
});

test('a handed-over platform order stays on the floor until its `delivered` is owed, even when its table settles at once', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/external-settle-')), store = new Store(directory, ['mola-demo']);
  let time = Date.parse('2026-10-04T09:00:00Z');
  const now = () => new Date(time), platform = new TestPlatform();
  // The history clock is 7 hours ahead (server off overnight, or a test running late in the day): a closed paid table
  // whose orders are all served would leave the snapshot in the same write that marked it served.
  store.clock = () => new Date(time + 7 * 3600_000);
  const manager = new IntegrationManager(store, now, { tickMs: 0, retryMs: [1], testPlatform: platform });
  t.after(() => { manager.stop(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.mutate('mola-demo', s => { s.changeSeconds = 0; s.integrationSettings = { test: { enabled: true } }; });
  platform.createOrder('mola-demo', store.read('mola-demo').products, now());
  await manager.tick('mola-demo');
  const entry = store.read('mola-demo').externalOrders![0];
  await manager.accept('mola-demo', cashier, { id: entry.id, version: entry.version });
  const orderId = store.read('mola-demo').orders.find(o => o.external?.externalId === entry.externalId)!.id;
  const step = (status: 'preparing' | 'ready' | 'served', actor: Actor) => store.mutate('mola-demo', s => { const o = s.orders.find(v => v.id === orderId)!; setStatus(s, actor, o.id, o.version, status, now()); });
  step('preparing', kitchen); step('ready', kitchen); step('served', waiter);
  assert.ok(store.read('mola-demo').orders.some(o => o.id === orderId), 'kept until the platform steps are owed');
  await manager.flush('mola-demo');
  assert.deepEqual(platform.calls.map(c => c.action), ['accept', 'ready'], 'one call per order per round');
  time += 1000; await manager.flush('mola-demo');
  assert.deepEqual(platform.calls.map(c => c.action), ['accept', 'ready', 'delivered']);
  assert.ok(!store.read('mola-demo').orders.some(o => o.id === orderId), 'then the table settles as usual');
});

test('auto-accept sends new orders straight to the kitchen; real platforms cannot be switched on yet', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/external-auto-')), store = new Store(directory, ['mola-demo']);
  const now = () => new Date('2026-10-04T09:00:00Z'), platform = new TestPlatform();
  const manager = new IntegrationManager(store, now, { tickMs: 0, retryMs: [1], testPlatform: platform });
  t.after(() => { manager.stop(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.mutate('mola-demo', s => { s.integrationSettings = { test: { enabled: true, autoAccept: true } }; });
  platform.createOrder('mola-demo', store.read('mola-demo').products, now(), { paidOnline: false });
  await manager.tick('mola-demo');
  const s = store.read('mola-demo');
  assert.equal(s.externalOrders![0].stage, 'accepted'); assert.ok(s.orders.some(o => o.external?.platform === 'test' && o.status === 'new'));
  for (const id of ['yemeksepeti', 'getir', 'trendyol', 'migros'] as const) {
    assert.equal(manager.adapters[id].available, false);
    await assert.rejects(manager.adapters[id].fetchOrders({ tenantId: 'mola-demo', credentials: {}, now: now(), signal: AbortSignal.timeout(1000) }), (e: AdapterError) => e.code === 'NOT_AVAILABLE' && /bağlantı izni bekleniyor/.test(e.message));
  }
  assert.equal(redact('anahtar s3cr3t-key reddedildi', { apiKey: 's3cr3t-key' }), 'anahtar *** reddedildi');
});

test('HTTP: credentials are sealed, owner-only and never returned; the test order reaches the kitchen screens', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/external-http-')), store = new Store(directory, ['mola-demo']);
  const time = Date.parse('2026-10-04T09:00:00Z');
  licensed(store); const app = createApp(store, () => new Date(time)), server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { (app.locals.integrations as IntegrationManager).stop(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const client = () => { let cookie = ''; return async (path: string, body?: unknown) => { const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0]; return { status: r.status, text: await r.text() }; }; };
  const own = client(), cash = client(), cook = client(), wait = client();
  for (const [call, username] of [[own, 'isletme'], [cash, 'kasiyer'], [cook, 'mutfak'], [wait, 'garson']] as const) assert.equal((await call('/login', { username, password: DEMO_PASSWORD })).status, 200);
  const SECRET = 'gizli-anahtar-0123456789';
  assert.equal((await cash('/staff/integrations/credentials', { platform: 'getir', values: { appSecretKey: SECRET, restaurantSecretKey: 'rest-key-9876' } })).status, 403);
  const saved = await own('/staff/integrations/credentials', { platform: 'getir', values: { appSecretKey: SECRET, restaurantSecretKey: 'rest-key-9876' } });
  assert.equal(saved.status, 200); assert.ok(!saved.text.includes(SECRET));
  const page = await own('/staff/integrations');
  assert.equal(page.status, 200); assert.ok(!page.text.includes(SECRET) && !page.text.includes('rest-key-9876'));
  assert.deepEqual(JSON.parse(page.text).platforms.find((p: { id: string }) => p.id === 'getir').saved, ['appSecretKey', 'restaurantSecretKey']);
  assert.equal((await cash('/staff/integrations')).status, 403);
  // Sealed at rest, never inside the business snapshot, readable only by the server.
  const manager = app.locals.integrations as IntegrationManager;
  assert.equal(manager.vault.read('mola-demo', 'getir')!.appSecretKey, SECRET);
  assert.ok(!JSON.stringify(store.read('mola-demo')).includes(SECRET));
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  assert.ok(!readFileSync(join(directory, 'merchant.sqlite')).includes(Buffer.from(SECRET)));
  // Real platforms wait for partner access.
  const on = await own('/staff/integrations/settings', { platform: 'getir', enabled: true });
  assert.equal(on.status, 409); assert.match(on.text, /bağlantı izni bekleniyor/);
  // Test order: refused while the test platform is off, then arrives as "Onay bekliyor" for owner, cashier and kitchen.
  assert.equal((await own('/staff/integrations/test-order', { requestId: randomUUID() })).status, 409);
  assert.equal((await own('/staff/integrations/settings', { platform: 'test', enabled: true })).status, 200);
  const sent = JSON.parse((await own('/staff/integrations/test-order', { requestId: randomUUID(), paidOnline: true })).text);
  assert.ok(sent.id);
  const kitchenState = JSON.parse((await cook('/staff/state')).text);
  assert.equal(kitchenState.externalOrders.length, 1); assert.equal(kitchenState.externalOrders[0].total, 0);
  assert.equal(JSON.parse((await wait('/staff/state')).text).externalOrders, undefined, 'waiters do not approve platform orders');
  const pending = JSON.parse((await cash('/staff/state')).text).externalOrders[0];
  assert.equal((await cash('/staff/integrations/orders/accept', { requestId: randomUUID(), id: pending.id, version: pending.version })).status, 200);
  const kitchenOrder = JSON.parse((await cook('/staff/state')).text).orders.find((o: { external?: { platform: string } }) => o.external?.platform === 'test');
  assert.ok(kitchenOrder); assert.equal(kitchenOrder.external.total, 0, 'the kitchen never sees money'); assert.equal(kitchenOrder.paid, true);
  assert.equal(manager.test.calls.filter(c => c.action === 'accept').length, 1);
});
