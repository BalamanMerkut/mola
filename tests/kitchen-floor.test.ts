import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { seed } from '../server/seed.js';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { cancelByStaff, setStatus, STATUS_UNDO_GRACE_MS, STATUS_UNDO_MS, submitOrder, undoStatus } from '../packages/domain/engine.js';
import { defaultSounds, resolveSounds, setSoundChoice, soundEvents } from '../packages/domain/sound-settings.js';
import type { Actor, PublicOrder, State } from '../packages/domain/types.js';
import { alertMemory, COALESCE_MS, playEvents, setSoundChoices } from '../src/sounds.js';
import { orderAlerts, servable } from '../src/ServiceCallBar.js';
import { kitchenAlerts, type KitchenNotice } from '../src/KitchenSound.js';
import { staffOrders } from '../server/staff-orders.js';
import { client, licensed, temp } from './merkez-fixture.js';

const at = (seconds: number) => new Date(Date.parse('2026-10-05T18:00:00Z') + seconds * 1000);
const ctx = (seconds = 0) => ({ now: at(seconds), id: randomUUID });
const who = (role: Actor['role']): Actor => ({ tenantId: 'mola-demo', id: role, role });
const kitchen = who('kitchen'), waiter = who('waiter'), owner = who('owner'), cashier = who('cashier');
const tea = (quantity: number) => ({ productId: 'tea', quantity, selections: [] });
function staffOrder(s: State, quantity = 1) { return submitOrder(s, waiter, { requestId: randomUUID(), tableId: 'table-1', lines: [tea(quantity)], expectedTotal: 3500 * quantity }, ctx()).orderId; }
const step = (s: State, id: string, status: 'preparing' | 'ready' | 'served', seconds: number, actor = kitchen) => setStatus(s, actor, id, s.orders.find(o => o.id === id)!.version, status, at(seconds));
const undo = (s: State, id: string, seconds: number, actor = kitchen) => undoStatus(s, actor, { requestId: randomUUID(), orderId: id, version: s.orders.find(o => o.id === id)!.version }, ctx(seconds));

test('Geri al: the kitchen takes its last step back within 5 seconds, audited; never served, never late, never by others', () => {
  const s = seed(); const id = staffOrder(s), o = s.orders[0];
  // Before the fix this transition was simply refused (INVALID_TRANSITION / VALIDATION_ERROR): a double tap stuck.
  step(s, id, 'preparing', 10);
  assert.deepEqual(undo(s, id, 13), { status: 'new', version: o.version });
  assert.equal(o.status, 'new'); assert.equal(o.statusUndo, undefined);
  assert.ok(s.audit.some(a => a.action === 'order.status_undone' && a.actor === 'kitchen' && a.target === `${id}:preparing->new`));
  // Only once per step: the same undo again finds nothing to take back.
  assert.throws(() => undo(s, id, 14), { code: 'UNDO_EXPIRED' });
  step(s, id, 'preparing', 20); step(s, id, 'ready', 21);
  assert.throws(() => undo(s, id, 21, waiter), { code: 'FORBIDDEN' });
  assert.throws(() => undo(s, id, 21, cashier), { code: 'FORBIDDEN' });
  // Too late: 5 s plus a little for the network.
  assert.throws(() => undo(s, id, 21 + (STATUS_UNDO_MS + STATUS_UNDO_GRACE_MS) / 1000 + 1), { code: 'UNDO_EXPIRED' });
  // A stale version (another screen moved it) is refused, not applied twice.
  assert.throws(() => undoStatus(s, kitchen, { requestId: randomUUID(), orderId: id, version: o.version - 1 }, ctx(22)), { code: 'VERSION_CONFLICT' });
  step(s, id, 'served', 30, waiter);
  assert.throws(() => undo(s, id, 31), { code: 'UNDO_EXPIRED' }, 'served is never undone');
  // ready → preparing works as well, and a platform order that already told the platform "hazır" stays ready.
  const second = staffOrder(s), b = s.orders[1];
  step(s, second, 'preparing', 40); step(s, second, 'ready', 41);
  assert.equal(undo(s, second, 43).status, 'preparing');
  step(s, second, 'ready', 50);
  s.externalOrders = [{ id: 'x', platform: 'test', externalId: 'p-1', total: 0, receivedAt: at(0).toISOString(), version: 1, items: [], stage: 'accepted', orderId: second, reported: ['accept'], outbox: [{ action: 'ready', attempts: 0, nextAt: at(50).toISOString() }], updatedAt: at(50).toISOString() }] as never;
  assert.throws(() => undo(s, second, 51), (e: Error & { code?: string }) => e.code === 'UNDO_EXPIRED' && /Platforma/.test(e.message));
  assert.equal(b.status, 'ready');
});

test('HTTP: /api/staff/status/undo for the kitchen, refused for the cashier', async t => {
  const store = new Store(temp('kitchen-undo')); licensed(store);
  store.mutate('mola-demo', s => { s.setupCompleted = true; });
  const server = createServer(createApp(store)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`, [w, k, c] = [client(base), client(base), client(base)];
  for (const [call, username] of [[w, 'garson'], [k, 'mutfak'], [c, 'kasiyer']] as const) assert.equal((await call('/login', { username, password: DEMO_PASSWORD })).status, 200);
  const sent = (await w('/staff/orders', { requestId: randomUUID(), tableId: 'table-1', lines: [tea(1)], expectedTotal: 3500 })).data;
  const version = () => store.read('mola-demo').orders.find(o => o.id === sent.orderId)!.version;
  const started = await k('/staff/status', { requestId: randomUUID(), orderId: sent.orderId, version: version(), status: 'preparing' });
  assert.equal(started.status, 200);
  assert.equal((await c('/staff/status/undo', { requestId: randomUUID(), orderId: sent.orderId, version: started.data.version })).status, 403);
  const back = await k('/staff/status/undo', { requestId: randomUUID(), orderId: sent.orderId, version: started.data.version });
  assert.equal(back.status, 200); assert.equal(back.data.status, 'new');
  // The snapshot says when the sign-in ends (05:00) and who is signed in; the undo bookkeeping never leaves the server.
  const state = (await k('/staff/state')).data;
  assert.ok(Date.parse(state.sessionEndsAt) > Date.now()); assert.equal(typeof state.userId, 'string');
  assert.equal('statusUndo' in state.orders[0], false);
});

test('suspended by Mola: every staff role gets the owner\'s notice in its snapshot, not only when ordering fails', async t => {
  const store = new Store(temp('staff-suspended')); licensed(store, { suspended: true });
  store.mutate('mola-demo', s => { s.setupCompleted = true; });
  const server = createServer(createApp(store)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  for (const username of ['garson', 'kasiyer', 'mutfak']) {
    const call = client(base);
    assert.equal((await call('/login', { username, password: DEMO_PASSWORD })).status, 200);
    assert.match((await call('/staff/state')).data.serviceNotice, /Mola tarafından durduruldu/, username);
  }
  const owner = client(base); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  const view = (await owner('/staff/state')).data;
  assert.equal(view.serviceNotice, undefined); assert.match(view.licenseNotice, /Mola tarafından durduruldu/);
});

const order = (id: string, status: string, extra = {}) => ({ id, status, number: 7, tableName: 'Masa 03', source: 'staff', version: 1, lines: [{ id: `${id}-l`, name: 'Çay', quantity: 2 }], ...extra }) as unknown as PublicOrder;

test('kitchen hears cancellations by others: whole order, some items, a guest asking; the strip says who and why', () => {
  const seen = new Set<string>(), notices: KitchenNotice[] = [];
  kitchenAlerts([order('a', 'new'), order('b', 'preparing'), order('q', 'awaiting_approval')], [], seen, true);
  // The waiter cancels a whole order; the kitchen hears it once and sees "İPTAL · Ayşe · Müşteri vazgeçti".
  assert.deepEqual(kitchenAlerts([order('a', 'cancelled', { cancelledBy: 'w1', cancelledByName: 'Ayşe', cancelReason: 'Müşteri vazgeçti' }), order('b', 'preparing'), order('q', 'awaiting_approval')], [], seen, false, 'k1', notices), ['kitchenCancel']);
  assert.deepEqual(notices.map(n => [n.heading, n.who, n.reason, n.items]), [['Masa 03 · #7', 'Ayşe', 'Müşteri vazgeçti', '2 Çay']]);
  assert.deepEqual(kitchenAlerts([order('a', 'cancelled', { cancelledBy: 'w1' })], [], seen, false, 'k1'), [], 'once');
  // Some items of a preparing order.
  const part = order('b', 'preparing', { cancellations: [{ id: 'c1', by: 'o1', byName: 'Sahip', reason: 'Ürün bitti', at: '', lines: [{ id: 'x', name: 'Limonata', quantity: 1 }] }] });
  notices.length = 0;
  assert.deepEqual(kitchenAlerts([part], [], seen, false, 'k1', notices), ['kitchenCancel']);
  assert.deepEqual(notices.map(n => [n.who, n.reason, n.items]), [['Sahip', 'Ürün bitti', '1 Limonata']]);
  // The kitchen's own cancellation stays quiet.
  const mine = order('b', 'preparing', { cancellations: [...part.cancellations!, { id: 'c2', by: 'k1', reason: 'Yanlış sipariş', at: '', lines: [] }] });
  assert.deepEqual(kitchenAlerts([mine], [], seen, false, 'k1'), []);
  // A guest asking to cancel rings once; when the kitchen then approves it there is no second sound.
  assert.deepEqual(kitchenAlerts([order('c', 'new')], [], seen, false, 'k1'), ['kitchen']);
  assert.deepEqual(kitchenAlerts([order('c', 'new', { cancelRequested: true, version: 2 })], [], seen, false, 'k1'), ['kitchenCancel']);
  assert.deepEqual(kitchenAlerts([order('c', 'new', { cancelRequested: true, version: 2 })], [], seen, false, 'k1'), []);
  assert.deepEqual(kitchenAlerts([order('c', 'cancelled', { version: 3 })], [], seen, false, 'k1'), []);
  // A QR order rejected before approval never reached the kitchen's board: no cancel sound.
  assert.deepEqual(kitchenAlerts([order('q', 'cancelled')], [], seen, false, 'k1'), []);
});

test('sounds survive a remount; at most one chime per kind every 5 seconds; distinct default sounds', () => {
  // Mutfak → Stok → Mutfak: the memory is the page visit's, not the view's, so nothing that arrived meanwhile is swallowed.
  const first = alertMemory('kitchen:mutfak-test');
  assert.equal(first.first, true);
  kitchenAlerts([order('m1', 'new')], [], first.seen, first.first);
  const again = alertMemory('kitchen:mutfak-test');
  assert.equal(again.first, false); assert.equal(again.seen, first.seen);
  assert.deepEqual(kitchenAlerts([order('m1', 'new'), order('m2', 'new')], [], again.seen, again.first), ['kitchen']);
  // Coalescing: the same kind within 5 s rings once; another kind still rings; after 5 s it rings again.
  setSoundChoices(defaultSounds);
  const started: number[] = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const audio = { state: 'running', currentTime: 0, sampleRate: 8000, destination: {}, createGain: () => ({ connect() {}, disconnect() {}, gain: param() }), createOscillator: () => ({ connect() {}, disconnect() {}, frequency: param(), start: (x: number) => started.push(x), stop() {} }), createBuffer: (_: number, n: number) => ({ getChannelData: () => new Float32Array(n) }), createBufferSource: () => ({ connect() {}, disconnect() {}, start() {} }), createBiquadFilter: () => ({ connect() {}, disconnect() {}, frequency: param(), Q: param() }) } as unknown as AudioContext;
  assert.deepEqual(playEvents(audio, ['ready'], 1000), ['ready']);
  assert.deepEqual(playEvents(audio, ['ready', 'waiterCall'], 1000 + COALESCE_MS - 1), ['waiterCall']);
  assert.deepEqual(playEvents(audio, ['ready'], 1000 + COALESCE_MS), ['ready']);
  // The approval sound differs from the new-order sound; the new "Sipariş iptali" has its own (falling) sound.
  assert.notEqual(defaultSounds.approval.sound, defaultSounds.kitchen.sound);
  assert.ok(soundEvents.includes('kitchenCancel')); assert.equal(defaultSounds.kitchenCancel.sound, 'alcalan');
  assert.ok(new Set(Object.values(defaultSounds).map(c => c.sound)).size === soundEvents.length, 'every event has its own default sound');
  // An owner's stored choice stays as it was; the cancel sound is chosen like any other.
  assert.deepEqual(resolveSounds({ approval: { sound: 'uclu', on: false } }).approval, { sound: 'uclu', on: false });
  const s = seed(); setSoundChoice(s, owner, { event: 'kitchenCancel', sound: 'gong' }, at(0));
  assert.deepEqual(s.sounds, { kitchenCancel: { sound: 'gong', on: true } });
});

test('waiters never hear or serve platform orders; a ready table order rings once and is announced', () => {
  const seen = new Set<string>(), ready: PublicOrder[] = [];
  orderAlerts([], 'waiter', seen, [], true);
  const courier = order('p', 'ready', { external: { platform: 'test', externalId: 'k-1', deliveryType: 'kurye' }, takeaway: { tableId: 't', number: 4 } });
  const pickup = order('g', 'ready', { external: { platform: 'test', externalId: 'g-1', deliveryType: 'gel-al' }, takeaway: { tableId: 't2', number: 5 } });
  assert.deepEqual(orderAlerts([courier, pickup], 'waiter', seen, [], false, ready), []);
  assert.equal(ready.length, 0);
  assert.equal(servable(courier) || servable(pickup), false);
  assert.deepEqual(orderAlerts([courier, pickup, order('t', 'ready')], 'waiter', seen, [], false, ready), ['ready']);
  assert.deepEqual(ready.map(o => o.id), ['t']);
  assert.equal(servable(order('t', 'ready')), true);
});

test('staff snapshot: who cancelled, by name; the kitchen never gets served orders', () => {
  const s = seed(); const id = staffOrder(s, 3), o = s.orders[0];
  cancelByStaff(s, waiter, { requestId: randomUUID(), orderId: id, version: o.version, reason: 'Ürün bitti', lines: [{ lineId: o.lines[0].id, quantity: 1 }] }, ctx(2));
  s.staffUsers = [{ id: 'waiter', name: 'Ayşe' }] as never;
  const view = staffOrders(s, 'kitchen', at(3).getTime()).orders[0];
  assert.equal(view.cancellations![0].byName, 'Ayşe');
  assert.equal(view.cancellations![0].lines[0].total, 0, 'still no prices in the kitchen');
  step(s, id, 'preparing', 5); step(s, id, 'ready', 6); step(s, id, 'served', 7, waiter);
  assert.equal(staffOrders(s, 'kitchen', at(8).getTime()).orders.length, 0);
  assert.equal(staffOrders(s, 'waiter', at(8).getTime()).orders.length, 1, 'served but unpaid: still on the bill');
});
