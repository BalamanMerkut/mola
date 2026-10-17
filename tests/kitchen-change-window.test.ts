import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { seed } from '../server/seed.js';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { starterState } from '../server/starter-template.js';
import { staffOrders } from '../server/staff-orders.js';
import { cancelByStaff, cancelOrder, changeByStaff, editOrder, submitOrder } from '../packages/domain/engine.js';
import { reviewOrder } from '../packages/domain/approvals.js';
import { CHANGE_SECONDS_ON, NEW_BUSINESS_CHANGE_SECONDS, notYetInKitchen } from '../packages/domain/change-window.js';
import { readyToPrint } from '../packages/domain/printing.js';
import type { Actor, State } from '../packages/domain/types.js';
import { kitchenAlerts, type KitchenNotice } from '../src/KitchenSound.js';
import { client, licensed, temp } from './merkez-fixture.js';

/*
 * 17 Ekim (owner's decision): a QR guest order whose change window is still running is not on the kitchen's screen at all;
 * it arrives when the window ends (the moment its kitchen ticket prints), as a new order with one sound. Waiters and the
 * owner see it at once. New businesses start with the window off; turning it on starts at 30 s.
 */
const start = Date.parse('2026-10-17T18:00:00Z');
const at = (seconds: number) => new Date(start + seconds * 1000);
const ctx = (seconds = 0) => ({ now: at(seconds), id: randomUUID });
const guest: Actor = { tenantId: 'mola-demo', id: 'g1', role: 'guest', tableId: 'table-1', epoch: 0 };
const waiter: Actor = { tenantId: 'mola-demo', id: 'waiter', role: 'waiter' }, owner: Actor = { tenantId: 'mola-demo', id: 'owner', role: 'owner' };
const tea = (quantity = 1) => ({ productId: 'tea', quantity, selections: [] });
function business(seconds = 30) { const s = seed(); s.changeSeconds = seconds; return s; }
function guestOrder(s: State, seconds = 0, quantity = 1) {
  const { orderId } = submitOrder(s, guest, { requestId: randomUUID(), tableId: 'table-1', lines: [tea(quantity)], expectedTotal: 3500 * quantity }, ctx(seconds));
  return s.orders.find(o => o.id === orderId)!;
}
const kitchenView = (s: State, seconds: number) => staffOrders(s, 'kitchen', at(seconds).getTime()).orders;
const waiterView = (s: State, seconds: number) => staffOrders(s, 'waiter', at(seconds).getTime()).orders;

test('defaults: a new business starts with the change window off; turning it on starts at 30 s', () => {
  assert.equal(NEW_BUSINESS_CHANGE_SECONDS, 0);
  assert.equal(CHANGE_SECONDS_ON, 30);
  assert.equal(starterState('yeni-kafe', 'Yeni Kafe').changeSeconds, 0, 'Merkez onboarding and the starter backup');
});

test('existing businesses keep their change window: no migration when the data opens again', () => {
  const dir = temp('change-window-keep');
  const first = new Store(dir);
  first.mutate('mola-demo', s => { s.changeSeconds = 45; }); first.mutate('other-demo', s => { s.changeSeconds = 60; });
  first.close();
  const again = new Store(dir);
  try { assert.equal(again.read('mola-demo').changeSeconds, 45); assert.equal(again.read('other-demo').changeSeconds, 60); }
  finally { again.close(); }
});

test('kitchen: a QR order is hidden while the guest may change it, then arrives with one sound; waiters see it at once', () => {
  const s = business(30), seen = new Set<string>();
  kitchenAlerts(kitchenView(s, 0), [], seen, true);
  const o = guestOrder(s, 0);
  assert.equal(notYetInKitchen(o, s.changeSeconds, at(29).getTime()), true);
  assert.deepEqual(kitchenView(s, 10), [], 'not on the board, not in the counts');
  assert.deepEqual(kitchenAlerts(kitchenView(s, 10), [], seen), [], 'no "yeni sipariş" sound yet');
  assert.equal(waiterView(s, 10).length, 1, 'the waiter sees it now');
  assert.ok(waiterView(s, 10)[0].editableUntil, 'with its change window');
  // Not on paper either; both turn at the same moment.
  assert.equal(readyToPrint(s, o, at(29)), false);
  assert.equal(kitchenView(s, 29.9).length, 0);
  assert.equal(readyToPrint(s, o, at(30)), true);
  const arrived = kitchenView(s, 30);
  assert.deepEqual(arrived.map(x => [x.id, x.status]), [[o.id, 'new']]);
  assert.deepEqual(kitchenAlerts(arrived, [], seen), ['kitchen'], 'the sound plays when it arrives');
  assert.deepEqual(kitchenAlerts(kitchenView(s, 32), [], seen), [], 'and only once');
});

test('kitchen: staff orders and a business with the window off reach the kitchen at once', () => {
  const s = business(30);
  submitOrder(s, waiter, { requestId: randomUUID(), tableId: 'table-2', lines: [tea()], expectedTotal: 3500 }, ctx(0));
  assert.equal(kitchenView(s, 0).length, 1, 'a waiter order has no change window');
  const off = business(0);
  guestOrder(off, 0);
  assert.equal(kitchenView(off, 0).length, 1, 'window off: the QR order is there at once');
});

test('kitchen: a guest edit inside the window arrives as the final order, with no "updated" note', () => {
  const s = business(30), seen = new Set<string>();
  kitchenAlerts([], [], seen, true);
  const o = guestOrder(s, 0);
  editOrder(s, guest, { requestId: randomUUID(), orderId: o.id, version: o.version, expectedTotal: 7000, lines: [{ ...tea(2), existingId: o.lines[0].id }] }, ctx(10));
  assert.deepEqual(kitchenView(s, 20), []);
  assert.ok(waiterView(s, 20)[0].updatedAt, 'the waiter still sees that the guest changed it');
  const [card] = kitchenView(s, 30);
  assert.equal(card.lines[0].quantity, 2);
  assert.equal(card.updatedAt, undefined, 'the kitchen never saw the first version');
  assert.deepEqual(kitchenAlerts([card], [], seen), ['kitchen']);
});

test('kitchen: a guest cancel inside the window never reaches the kitchen (no card, no İPTAL strip, no sound)', () => {
  const s = business(30), seen = new Set<string>(), notices: KitchenNotice[] = [];
  kitchenAlerts([], [], seen, true);
  const o = guestOrder(s, 0);
  cancelOrder(s, guest, { requestId: randomUUID(), orderId: o.id, version: o.version }, ctx(5));
  assert.equal(o.status, 'cancelled');
  const later = kitchenView(s, 40);
  assert.equal(later.filter(x => ['new', 'preparing', 'ready'].includes(x.status)).length, 0);
  assert.deepEqual(kitchenAlerts(later, [], seen, false, 'kitchen', notices), []);
  assert.deepEqual(notices, []);
});

test('kitchen: what a waiter changed or took off inside the window is not news; after arrival it is', () => {
  const s = business(30), seen = new Set<string>(), notices: KitchenNotice[] = [];
  kitchenAlerts([], [], seen, true);
  const o = guestOrder(s, 0, 3);
  changeByStaff(s, waiter, { requestId: randomUUID(), orderId: o.id, version: o.version, lineId: o.lines[0].id, line: { productId: 'herbal', quantity: 3, selections: [] }, expectedTotal: 8500 * 3 }, ctx(5));
  cancelByStaff(s, owner, { requestId: randomUUID(), orderId: o.id, version: o.version, reason: 'Müşteri vazgeçti', lines: [{ lineId: o.lines[0].id, quantity: 1 }] }, ctx(8));
  assert.ok(waiterView(s, 10)[0].changes?.length, 'the floor sees the change'); assert.ok(waiterView(s, 10)[0].cancellations?.length);
  const [card] = kitchenView(s, 30);
  assert.equal(card.changes, undefined); assert.deepEqual(card.cancellations ?? [], []);
  assert.deepEqual(card.lines.map(l => [l.name, l.quantity]), [['Ihlamur', 2]], 'the order as it is now');
  assert.deepEqual(kitchenAlerts([card], [], seen, false, 'kitchen', notices), ['kitchen'], 'one new order sound, no İPTAL / DEĞİŞTİ');
  assert.deepEqual(notices, []);
  // Once it is on the board, a cancelled item is news again.
  cancelByStaff(s, owner, { requestId: randomUUID(), orderId: o.id, version: o.version, reason: 'Yanlış sipariş', lines: [{ lineId: o.lines[0].id, quantity: 1 }] }, ctx(40));
  const [now] = kitchenView(s, 41);
  assert.equal(now.cancellations?.length, 1);
  assert.deepEqual(kitchenAlerts([now], [], seen, false, 'kitchen', notices), ['kitchenCancel']);
});

test('kitchen: a QR order waiting for approval reaches the kitchen\'s approval list only when the window ends', () => {
  const s = business(30), seen = new Set<string>(); s.waiterApproval = true;
  kitchenAlerts([], [], seen, true);
  const o = guestOrder(s, 0);
  assert.equal(o.status, 'awaiting_approval');
  assert.deepEqual(kitchenView(s, 10), []);
  assert.equal(waiterView(s, 10)[0].status, 'awaiting_approval', 'the waiter can approve it now');
  // Approved by the waiter inside the window: still the guest's for the rest of it.
  reviewOrder(s, waiter, { requestId: randomUUID(), orderId: o.id, version: o.version, approve: true }, ctx(12));
  assert.deepEqual(kitchenView(s, 20), []);
  const [card] = kitchenView(s, 30);
  assert.equal(card.status, 'new');
  assert.deepEqual(kitchenAlerts([card], [], seen), ['kitchen']);
  // Not approved in time: it arrives in the kitchen's approval list, with the approval sound.
  const late = business(30), heard = new Set<string>(); late.waiterApproval = true;
  kitchenAlerts([], [], heard, true);
  guestOrder(late, 0);
  assert.deepEqual(kitchenAlerts(kitchenView(late, 31), [], heard), ['approval']);
});

test('HTTP: the kitchen\'s snapshot gets the order when the window ends (its tag changes then), the waiter\'s at once', async t => {
  let offset = 0;
  const store = new Store(temp('kitchen-change-window')); licensed(store);
  store.mutate('mola-demo', s => { s.setupCompleted = true; s.changeSeconds = 30; });
  const server = createServer(createApp(store, () => new Date(Date.now() + offset))); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`, [w, k, g] = [client(base), client(base), client(base)];
  for (const [call, username] of [[w, 'garson'], [k, 'mutfak']] as const) assert.equal((await call('/login', { username, password: DEMO_PASSWORD })).status, 200);
  await w('/staff/state'); await k('/staff/state');
  const table = store.read('mola-demo').tables[0];
  assert.equal((await g('/guest/session', { token: table.token })).status, 200);
  const sent = await g('/guest/orders', { requestId: randomUUID(), tableId: table.id, lines: [tea()], expectedTotal: 3500 });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  const before = await k('/staff/state');
  assert.equal(before.data.orders.some((o: { id: string }) => o.id === sent.data.orderId), false, 'kitchen: not yet');
  assert.equal((await w('/staff/state')).data.orders.some((o: { id: string }) => o.id === sent.data.orderId), true, 'waiter: now');
  const tag = before.headers.get('X-Mola-Tag')!;
  assert.equal((await k('/staff/state', undefined, { 'X-Mola-Tag': tag })).status, 204, 'nothing new for the kitchen yet');
  // The kitchen cannot start it either (the server says why).
  const id = sent.data.orderId, version = store.read('mola-demo').orders.find(o => o.id === id)!.version;
  assert.equal((await k('/staff/status', { requestId: randomUUID(), orderId: id, version, status: 'preparing' })).data.code, 'CHANGE_WINDOW_OPEN');
  offset = 31_000;
  const after = await k('/staff/state', undefined, { 'X-Mola-Tag': tag });
  assert.equal(after.status, 200, 'the content changed when the window ended');
  const card = after.data.orders.find((o: { id: string }) => o.id === id);
  assert.equal(card.status, 'new');
  assert.equal((await k('/staff/status', { requestId: randomUUID(), orderId: id, version, status: 'preparing' })).status, 200);
});
