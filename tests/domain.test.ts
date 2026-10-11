import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { balances, cancelOrder, closeEmptyAccount, quote, recordPayment, setStatus, submitOrder } from '../packages/domain/engine.js';
import type { Actor, State } from '../packages/domain/types.js';

const ctx = () => ({ now: new Date('2026-09-16T10:00:00Z'), id: randomUUID });
const owner: Actor = { tenantId: 'mola-demo', id: 'owner', role: 'owner' };
const guest = (id = 'guest1', epoch = 0): Actor => ({ tenantId: 'mola-demo', id, role: 'guest', tableId: 'table-1', epoch });
const input = () => ({ requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
const order = (s: State, actor = guest()) => submitOrder(s, actor, input(), ctx());
const payment = (s: State, amount: number, method: 'cash' | 'card' = 'cash') => ({ requestId: randomUUID(), accountId: s.accounts[0].id, version: s.accounts[0].version, method, amount, tendered: amount });

test('four guests share one account, with distinct guest labels', () => {
  const s = seed(); for (let i = 0; i < 4; i++) order(s, guest(`guest${i}`));
  assert.equal(s.accounts.length, 1); assert.equal(balances(s, s.accounts[0].id).total, 14000);
  assert.equal(new Set(s.orders.map(o => o.guestLabel)).size, 4);
});
test('retry returns the same order; reusing key for different content is rejected', () => {
  const s = seed(), b = input(); const first = submitOrder(s, guest(), b, ctx());
  assert.deepEqual(submitOrder(s, guest(), b, ctx()), first); assert.equal(s.orders.length, 1);
  assert.throws(() => submitOrder(s, guest(), { ...b, expectedTotal: 1 }, ctx()), /farklı içerik/);
});
test('price is computed server-side and frozen after acceptance', () => {
  const s = seed(); assert.throws(() => submitOrder(s, guest(), { ...input(), expectedTotal: 1 }, ctx()));
  order(s); s.products.find(p => p.id === 'tea')!.price = 9000;
  assert.equal(s.orders[0].lines[0].unitPrice, 3500); assert.equal(s.orders[0].total, 3500);
});
test('sold-out, missing required option, repeated group and negative quantity are rejected', () => {
  const s = seed();
  for (const line of [
    { productId: 'brownie', quantity: 1, selections: [] },
    { productId: 'latte', quantity: 1, selections: [] },
    { productId: 'tea', quantity: -1, selections: [] },
    { productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'regular' }, { groupId: 'size', optionId: 'large' }] },
  ]) assert.throws(() => quote(s.products, [line], ctx()));
});
test('optional milk and size surcharges are independent', () => {
  const s = seed(); const q = quote(s.products, [{ productId: 'latte', quantity: 2, selections: [{ groupId: 'size', optionId: 'large' }, { groupId: 'milk', optionId: 'oat' }] }], ctx());
  assert.equal(q[0].total, 39000);
});
test('guest cannot order for another table or tenant', () => {
  const s = seed(); assert.throws(() => submitOrder(s, guest(), { ...input(), tableId: 'table-2' }, ctx()));
  assert.throws(() => order(s, { ...guest(), tenantId: 'other-demo' }));
});
test('browser block affects only the selected browser identity', () => {
  const s = seed(); s.blocked.push('guest1'); assert.throws(() => order(s)); order(s, guest('guest2')); assert.equal(s.orders.length, 1);
});
test('guest can cancel own new order within the configured window', () => {
  const s = seed(); const o = order(s);
  assert.throws(() => cancelOrder(s, guest('someoneElse'), { requestId: randomUUID(), orderId: o.orderId, version: 1 }, ctx()));
  assert.equal(cancelOrder(s, guest(), { requestId: randomUUID(), orderId: o.orderId, version: 1 }, ctx()).requested, false);
  assert.equal(balances(s, o.accountId).total, 0);
  closeEmptyAccount(s, owner, o.accountId); assert.equal(s.tables[0].accountId, null);
});
test('after timeout or preparation, cancellation becomes an approval request', () => {
  for (const preparing of [true, false]) {
    const s = seed(); const o = order(s);
    if (preparing) setStatus(s, owner, o.orderId, 1, 'preparing', new Date('2026-09-16T10:01:00Z'));
    const context = ctx(); context.now = new Date(context.now.getTime() + 61000);
    assert.equal(cancelOrder(s, guest(), { requestId: randomUUID(), orderId: o.orderId, version: s.orders[0].version }, context).requested, true);
    assert.equal(balances(s, o.accountId).total, 3500);
  }
});
test('state transitions and stale versions are rejected', () => {
  const s = seed(); const o = order(s);
  assert.throws(() => setStatus(s, owner, o.orderId, 1, 'served'));
  setStatus(s, owner, o.orderId, 1, 'preparing', new Date('2026-09-16T10:01:00Z'));
  assert.throws(() => setStatus(s, owner, o.orderId, 1, 'ready'));
});
test('partial cash/card payments, commission snapshot and cash change', () => {
  const s = seed(); order(s); s.commissionBps = 300;
  const p = payment(s, 1000, 'card'); recordPayment(s, owner, p, ctx());
  assert.equal(s.payments[0].commission, 30); s.commissionBps = 900;
  const cash = { ...payment(s, 2500), tendered: 5000 };
  const result = recordPayment(s, owner, cash, ctx());
  assert.equal(result.change, 2500); assert.equal(result.closed, true);
  assert.equal(s.archives[0].card, 1000); assert.equal(s.archives[0].cash, 2500);
  assert.equal(s.archives[0].payments[0].commission, 30);
  assert.deepEqual(recordPayment(s, owner, cash, ctx()), result); assert.equal(s.payments.length, 2);
});
test('old guest epoch is invalidated; new QR session gets a fresh account', () => {
  const s = seed(); order(s); recordPayment(s, owner, payment(s, 3500), ctx());
  assert.throws(() => order(s)); order(s, guest('guest1', 1));
  assert.equal(s.accounts.length, 2); assert.notEqual(s.orders[0].accountId, s.orders[1].accountId);
});
test('payment does not delete unfinished kitchen work', () => {
  const s = seed(); const o = order(s); recordPayment(s, owner, payment(s, 3500), ctx());
  setStatus(s, owner, o.orderId, 1, 'preparing', new Date('2026-09-16T10:01:00Z')); assert.equal(s.orders[0].status, 'preparing');
});
test('overpayment, stale cashier, insufficient tender and waiter payment denied', () => {
  const s = seed(); order(s);
  assert.throws(() => recordPayment(s, owner, payment(s, 3501), ctx()));
  assert.throws(() => recordPayment(s, owner, { ...payment(s, 3500), tendered: 3000 }, ctx()));
  assert.throws(() => recordPayment(s, { ...owner, role: 'waiter' }, payment(s, 3500), ctx()));
  const stale = payment(s, 1000); recordPayment(s, owner, payment(s, 1000), ctx());
  assert.throws(() => recordPayment(s, owner, stale, ctx()));
  assert.throws(() => cancelOrder(s, guest(), { requestId: randomUUID(), orderId: s.orders[0].id, version: 1 }, ctx()));
});

test('kitchen cannot start until the exact snapshotted deadline, including owner', () => {
  const s = seed(); const o = order(s);
  assert.equal(s.orders[0].editableUntil, '2026-09-16T10:01:00.000Z');
  assert.throws(() => setStatus(s, owner, o.orderId, 1, 'preparing', new Date('2026-09-16T10:00:59.999Z')), /değişiklik süresi/);
  s.changeSeconds = 0;
  assert.throws(() => setStatus(s, owner, o.orderId, 1, 'preparing', ctx().now));
  setStatus(s, owner, o.orderId, 1, 'preparing', new Date('2026-09-16T10:01:00Z'));
  assert.equal(s.orders[0].status, 'preparing');
});
test('zero duration allows immediate preparation for new orders', () => {
  const s = seed(); s.changeSeconds = 0; const o = order(s);
  setStatus(s, owner, o.orderId, 1, 'preparing', ctx().now);
  assert.equal(s.orders[0].status, 'preparing');
});
