import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { PrintService } from '../server/printing.js';
import { Store } from '../server/store.js';
import { seed } from '../server/seed.js';
import { IntegrationManager } from '../server/integrations/manager.js';
import { TestPlatform } from '../server/integrations/adapters.js';
import { DomainError, recordPayment, setStatus, submitTakeaway } from '../packages/domain/engine.js';
import { orderTargets, singleKitchen, type PrinterConfig } from '../packages/domain/printing.js';
import type { Actor, State } from '../packages/domain/types.js';

/*
 * 5 Oct owner decisions: tek mutfak (one printer holds "Mutfak fişleri"; old bar/kitchen routing is folded once), a paid
 * masasız order is handed over by the counter ("Teslim edildi"), and in Fiş modu the counter marks platform orders "Hazır".
 */
const T = 'mola-demo';
const at = (seconds: number) => new Date(Date.parse('2026-10-05T09:00:00Z') + seconds * 1000);
const ctx = (seconds = 0) => ({ now: at(seconds), id: randomUUID });
const owner: Actor = { tenantId: T, id: 'owner', role: 'owner' };
const manager: Actor = { tenantId: T, id: 'manager', role: 'manager' };
const cashier: Actor = { tenantId: T, id: 'cashier', role: 'cashier' };
const waiter: Actor = { tenantId: T, id: 'waiter', role: 'waiter' };
const kitchen: Actor = { tenantId: T, id: 'kitchen', role: 'kitchen' };
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return 'NO_ERROR'; };
const printer = (over: Partial<PrinterConfig> = {}): PrinterConfig => ({ id: randomUUID(), name: 'Mutfak', enabled: true, connection: { type: 'network', host: '192.168.1.50', port: 9100 }, width: 58, charset: 'ascii', orders: true, categories: [], bill: false, createdAt: at(-60).toISOString(), ...over });
const latte = [{ productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'large' }, { groupId: 'milk', optionId: 'oat' }] }];
const temp = (name: string) => { mkdirSync('.local/tests', { recursive: true }); return mkdtempSync(resolve(`.local/tests/single-kitchen-${name}-`)); };

test('old bar/kitchen routing is folded into one kitchen printer once, with a notice; the ticket carries every line', async () => {
  const store = new Store(temp('legacy'), [T]);
  try {
    const bar = printer({ name: 'Bar', categories: ['Kahveler', 'Çaylar'] }), mutfak = printer({ name: 'Mutfak', categories: ['Tatlılar'] }), kasa = printer({ name: 'Kasa', orders: false, bill: true });
    store.mutate(T, s => { s.printers = [bar, mutfak, kasa]; s.kitchenMode = 'ticket'; });
    const sent: string[] = [];
    const service = new PrintService(store, () => at(10), async (connection, data) => { sent.push(`${JSON.stringify(connection)}|${Buffer.from(data).toString('latin1')}`); });
    let s = store.read(T);
    assert.deepEqual(s.printers!.map(p => [p.name, p.orders, p.categories]), [['Bar', false, []], ['Mutfak', true, []], ['Kasa', false, []]], 'the one named Mutfak keeps the role, every category');
    assert.deepEqual({ kitchen: s.printerNotice!.kitchen, others: s.printerNotice!.others, categories: s.printerNotice!.categories }, { kitchen: 'Mutfak', others: ['Bar'], categories: true });
    // Repeatable: nothing left to fold, the notice is not written again.
    const noticeAt = s.printerNotice!.at;
    service.refresh(T); assert.equal(store.read(T).printerNotice!.at, noticeAt);
    assert.equal(singleKitchen(store.read(T), at(5)), false);
    // A coffee and a dessert on one order: one ticket, both lines; printed = Hazırlanıyor.
    store.mutate(T, s => { s.changeSeconds = 0; submitTakeaway(s, cashier, { requestId: randomUUID(), lines: [...latte, { productId: 'cheesecake', quantity: 1, selections: [] }], expectedTotal: 19500 + 19000 }, ctx(1)); });
    s = store.read(T);
    assert.deepEqual(orderTargets(s, s.orders[0]).map(t => [t.printer.name, t.lines.length]), [['Mutfak', 2]]);
    await service.tick();
    assert.equal(sent.length, 1); assert.match(sent[0], /Caff/); assert.match(sent[0], /San Sebastian/);
    assert.equal(store.read(T).orders[0].status, 'preparing', 'an order becomes Hazırlanıyor when the kitchen ticket prints');
  } finally { store.close(); }
});

test('HTTP: one printer holds "Mutfak fişleri"; choosing it elsewhere moves it; the notice closes for good', async t => {
  const store = new Store(temp('api'));
  let time = Date.parse('2026-10-05T09:00:00Z');
  const service = new PrintService(store, () => new Date(time), async () => {});
  licensed(store); const server = createServer(createApp(store, () => new Date(time), () => true, undefined, undefined, undefined, service));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, jar = new Map<string, string>();
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const value of response.headers.getSetCookie()) { const [k, v] = value.split(';')[0].split('='); jar.set(k, v); }
    return { status: response.status, data: await response.json() as any };
  };
  assert.equal((await call('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  const input = (name: string, over: Record<string, unknown> = {}) => ({ name, enabled: true, connection: { type: 'network', host: '192.168.1.60', port: 9100 }, width: 80, charset: 'pc857', orders: true, categories: [], bill: false, ...over });
  const first = await call('/staff/printers', { printer: input('Mutfak', { categories: ['Tatlılar'] }) });
  assert.equal(first.status, 200); assert.deepEqual(first.data.printer.categories, [], 'routing by category is not stored any more');
  assert.equal(first.data.moved, undefined);
  const second = await call('/staff/printers', { printer: input('Kasa', { bill: true }) });
  assert.equal(second.status, 200); assert.deepEqual(second.data.moved, [{ name: 'Mutfak', idle: true }], 'the role moved; Mutfak has nothing left to print');
  let list = (await call('/staff/printers')).data;
  assert.deepEqual(list.printers.map((p: PrinterConfig) => [p.name, p.orders]), [['Mutfak', false], ['Kasa', true]]);
  assert.ok(store.auditLog(T).some(a => a.action === 'printer.kitchen_moved'));
  // Back to Mutfak (with the bill role kept on Kasa).
  const back = await call('/staff/printers', { id: list.printers[0].id, printer: input('Mutfak') });
  assert.deepEqual(back.data.moved, [{ name: 'Kasa', idle: false }]);
  list = (await call('/staff/printers')).data;
  assert.deepEqual(list.printers.map((p: PrinterConfig) => [p.name, p.orders, p.bill]), [['Mutfak', true, false], ['Kasa', false, true]]);
  assert.equal(list.notice, undefined);
  // An old install's split shows up as a one-time notice; "Tamam" removes it.
  store.mutate(T, s => { s.printers = [...s.printers!, printer({ name: 'Bar', categories: ['Kahveler'] })]; });
  list = (await call('/staff/printers')).data;
  assert.equal(list.notice.kitchen, 'Mutfak'); assert.deepEqual(list.notice.others, ['Bar']);
  assert.equal(list.printers.filter((p: PrinterConfig) => p.orders).length, 1);
  assert.equal((await call('/staff/printers/notice-seen', {})).status, 200);
  assert.equal((await call('/staff/printers')).data.notice, undefined);
  time += 1000;
});

/** A masasız order paid at the counter, in either kitchen mode. */
function paidTakeaway(s: State, seconds: number) {
  const r = submitTakeaway(s, cashier, { requestId: randomUUID(), lines: latte, expectedTotal: 19500 }, ctx(seconds));
  const a = s.accounts.find(v => v.id === r.accountId)!;
  recordPayment(s, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'card', amount: 19500, tendered: 19500 }, ctx(seconds + 1));
  return s.orders.find(o => o.id === r.orderId)!;
}

test('masasız, paid: the cashier (also Müdür, owner) taps "Teslim edildi" before "Hazır"; unpaid keeps the old flow', () => {
  const s = seed(); s.changeSeconds = 0;
  // Ekran: the kitchen has not started yet (new) or is cooking (preparing).
  const waiting = paidTakeaway(s, 0);
  assert.equal(waiting.status, 'new');
  assert.equal(code(() => setStatus(s, waiter, waiting.id, waiting.version, 'served', at(5))), 'INVALID_TRANSITION', 'the counter decides, not the waiter');
  assert.equal(code(() => setStatus(s, kitchen, waiting.id, waiting.version, 'served', at(5))), 'INVALID_TRANSITION');
  setStatus(s, cashier, waiting.id, waiting.version, 'served', at(5));
  assert.equal(waiting.status, 'served');
  const table = s.tables.find(t => t.id === s.accounts.find(a => a.id === waiting.accountId)!.tableId)!;
  assert.equal(table.accountId, null, 'paid and handed over: it leaves the strip');
  const cooking = paidTakeaway(s, 10); setStatus(s, kitchen, cooking.id, cooking.version, 'preparing', at(12));
  setStatus(s, manager, cooking.id, cooking.version, 'served', at(13)); assert.equal(cooking.status, 'served');
  const ready = paidTakeaway(s, 20); setStatus(s, kitchen, ready.id, ready.version, 'preparing', at(21)); setStatus(s, kitchen, ready.id, ready.version, 'ready', at(22));
  setStatus(s, owner, ready.id, ready.version, 'served', at(23)); assert.equal(ready.status, 'served');
  // Unpaid: "Teslim edildi" only once the kitchen says Hazır (unchanged).
  const r = submitTakeaway(s, cashier, { requestId: randomUUID(), lines: latte, expectedTotal: 19500 }, ctx(30));
  const unpaid = s.orders.find(o => o.id === r.orderId)!;
  assert.equal(code(() => setStatus(s, cashier, unpaid.id, unpaid.version, 'served', at(31))), 'INVALID_TRANSITION');
  // Fiş: a paid order not printed yet can be handed over too (the strip says "Mutfağa henüz basılmadı").
  s.kitchenMode = 'ticket';
  const unprinted = paidTakeaway(s, 40);
  setStatus(s, cashier, unprinted.id, unprinted.version, 'served', at(42)); assert.equal(unprinted.status, 'served');
});

test('Fiş modu: the cashier marks a platform order "Hazır" (the platform is told) and "Kuryeye teslim edildi"', async t => {
  const directory = temp('platform'), store = new Store(directory, [T]);
  let time = Date.parse('2026-10-05T09:00:00Z');
  const now = () => new Date(time), platform = new TestPlatform();
  const integrations = new IntegrationManager(store, now, { tickMs: 0, retryMs: [1], testPlatform: platform });
  t.after(() => { integrations.stop(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.mutate(T, s => { s.changeSeconds = 0; s.integrationSettings = { test: { enabled: true } }; });
  platform.createOrder(T, store.read(T).products, now());
  await integrations.tick(T);
  const entry = store.read(T).externalOrders![0];
  await integrations.accept(T, cashier, { id: entry.id, version: entry.version });
  const orderOf = () => store.read(T).orders.find(o => o.external?.externalId === entry.externalId)!;
  // Ekran: the kitchen screen says Hazır; the cashier may not.
  store.mutate(T, s => { const o = s.orders.find(v => v.id === orderOf().id)!; setStatus(s, kitchen, o.id, o.version, 'preparing', now()); });
  assert.equal(code(() => store.mutate(T, s => { const o = s.orders.find(v => v.id === orderOf().id)!; setStatus(s, cashier, o.id, o.version, 'ready', now()); })), 'FORBIDDEN');
  // Paid online, but a platform order is not handed over early in Ekran mode: it follows the kitchen.
  assert.equal(code(() => store.mutate(T, s => { const o = s.orders.find(v => v.id === orderOf().id)!; setStatus(s, cashier, o.id, o.version, 'served', now()); })), 'INVALID_TRANSITION');
  // Fiş: printed (Hazırlanıyor) → the cashier says Hazır → the platform gets `ready`.
  store.mutate(T, s => { s.kitchenMode = 'ticket'; });
  assert.equal(code(() => store.mutate(T, s => { const o = s.orders.find(v => v.id === orderOf().id)!; setStatus(s, waiter, o.id, o.version, 'ready', now()); })), 'FORBIDDEN');
  store.mutate(T, s => { const o = s.orders.find(v => v.id === orderOf().id)!; setStatus(s, cashier, o.id, o.version, 'ready', now()); });
  assert.equal(orderOf().status, 'ready');
  await integrations.flush(T);
  assert.deepEqual(platform.calls.map(c => c.action), ['accept', 'ready']);
  // Kuryeye teslim edildi from the counter strip → `delivered`.
  time += 60_000;
  store.mutate(T, s => { const o = s.orders.find(v => v.id === orderOf().id)!; setStatus(s, cashier, o.id, o.version, 'served', now()); });
  await integrations.flush(T);
  assert.deepEqual(platform.calls.map(c => c.action), ['accept', 'ready', 'delivered']);
  // The Müdür may do the same on the next one.
  const next = platform.createOrder(T, store.read(T).products, now()); platform.push(T, next);
  time += 21_000; await integrations.tick(T);
  const second = store.read(T).externalOrders!.find(e => e.externalId === next.externalId)!;
  await integrations.accept(T, owner, { id: second.id, version: second.version });
  store.mutate(T, s => { const o = s.orders.find(v => v.external?.externalId === next.externalId)!; o.status = 'preparing'; o.version++; setStatus(s, manager, o.id, o.version, 'ready', now()); });
  assert.equal(store.read(T).orders.find(o => o.external?.externalId === next.externalId)!.status, 'ready');
});
