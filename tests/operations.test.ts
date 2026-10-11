import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { submitOrder, editOrder, recordPayment, setStatus, balances, markTableClean, moveTable, closeEmptyAccount, quote, isOrderPaid } from '../packages/domain/engine.js';
import { reviewOrder, setAutomaticApproval } from '../packages/domain/approvals.js';
import { recordExpense } from '../packages/domain/expenses.js';
import { mergeAccounts } from '../packages/domain/merge.js';
import { financialReport } from '../packages/domain/reports.js';
import { popularProductIds } from '../packages/domain/popular.js';
import { extendMonths } from '../server/license.js';

const ctx = () => ({ now: new Date('2026-09-18T09:00:00Z'), id: randomUUID });
const input = (tableId = 'table-1', quantity = 1) => ({ requestId: randomUUID(), tableId, lines: [{ productId: 'tea', quantity, selections: [] }], expectedTotal: 3500 * quantity });
test('waiter review gates kitchen and payment; auto approval only affects new orders; edited approved orders require review again', () => {
  const s = seed(), c = ctx(); s.waiterApproval = true;
  const waiter = { tenantId: s.tenantId, id: 'w', role: 'waiter' as const }, kitchen = { ...waiter, role: 'kitchen' as const }, cashier = { ...waiter, role: 'cashier' as const }, guest = { ...waiter, id: 'g', role: 'guest' as const, tableId: 'table-1', epoch: 0 };
  submitOrder(s, guest, input(), c); const o = s.orders[0], a = s.accounts[0];
  assert.equal(o.status, 'awaiting_approval'); assert.deepEqual(popularProductIds(s, c.now), []);
  assert.throws(() => setStatus(s, kitchen, o.id, o.version, 'preparing', c.now));
  assert.throws(() => recordPayment(s, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, amount: 3500, tendered: 3500, method: 'cash' }, c));
  assert.throws(() => reviewOrder(s, cashier, { requestId: randomUUID(), orderId: o.id, version: o.version, approve: true }, c));
  setAutomaticApproval(s, waiter, { requestId: randomUUID(), version: 0, enabled: true }, c);
  assert.equal(o.status, 'awaiting_approval'); submitOrder(s, guest, input(), c); assert.equal(s.orders[1].status, 'new');
  setAutomaticApproval(s, waiter, { requestId: randomUUID(), version: 1, enabled: false }, c);
  const approve = { requestId: randomUUID(), orderId: o.id, version: o.version, approve: true };
  reviewOrder(s, waiter, approve, c); reviewOrder(s, waiter, approve, c); assert.equal(o.version, 2);
  assert.throws(() => setStatus(s, kitchen, o.id, o.version, 'preparing', c.now));
  editOrder(s, guest, { requestId: randomUUID(), orderId: o.id, version: o.version, expectedTotal: 7000, lines: [{ ...o.lines[0], quantity: 2, existingId: o.lines[0].id }] }, c);
  assert.equal(o.status, 'awaiting_approval');
  assert.throws(() => reviewOrder(s, waiter, { requestId: randomUUID(), orderId: o.id, version: o.version, approve: false, reason: '' }, c));
  reviewOrder(s, waiter, { requestId: randomUUID(), orderId: o.id, version: o.version, approve: false, reason: 'Masa boş.' }, c);
  assert.equal(o.status, 'cancelled'); assert.equal(o.reviewReason, 'Masa boş.');
  submitOrder(s, waiter, input('table-2'), c); assert.equal(s.orders[2].status, 'new');
});

test('item payments cannot charge an item twice; merge preserves payments and makes source QR obsolete', () => {
  const s = seed(), c = ctx(), a = { tenantId: s.tenantId, id: 'cash', role: 'cashier' as const };
  submitOrder(s, a, input('table-1', 2), c); submitOrder(s, a, input('table-2', 1), c);
  const first = s.accounts[0], second = s.accounts[1], line = s.orders[0].lines[0];
  const pay = { requestId: randomUUID(), accountId: first.id, version: first.version, amount: 3500, tendered: 5000, method: 'cash' as const, selections: [{ orderId: s.orders[0].id, lineId: line.id, quantity: 1 }] };
  assert.equal(recordPayment(s, a, pay, c).change, 1500); recordPayment(s, a, pay, c);
  assert.throws(() => recordPayment(s, a, { ...pay, requestId: randomUUID(), version: first.version, amount: 7000, tendered: 7000, selections: [{ ...pay.selections[0], quantity: 2 }] }, c));
  const merge = { requestId: randomUUID(), sourceId: first.id, sourceVersion: first.version, targetId: second.id, targetVersion: second.version };
  assert.throws(() => mergeAccounts(s, { ...a, role: 'waiter' }, merge, c));
  mergeAccounts(s, a, merge, c); mergeAccounts(s, a, merge, c);
  assert.deepEqual(balances(s, second.id), { total: 10500, paid: 3500, balance: 7000 }); assert.equal(s.payments.length, 1); assert.equal(s.tables[0].epoch, 1); assert.equal(s.tables[1].epoch, 1);
  recordPayment(s, a, { ...pay, requestId: randomUUID(), accountId: second.id, version: second.version }, c);
  assert.equal(balances(s, second.id).balance, 3500);
});

test('cash expenses require cashier and description, are idempotent and reported separately from sales', () => {
  const s = seed(), c = ctx(), a = { tenantId: s.tenantId, id: 'cash', role: 'cashier' as const };
  const b = { requestId: randomUUID(), amount: 2500, description: 'Süt alımı' };
  for (const actor of [{ ...a, role: 'waiter' as const }, { ...a, tenantId: 'other' }]) assert.throws(() => recordExpense(s, actor, b, c));
  assert.throws(() => recordExpense(s, a, { ...b, description: '' }, c)); assert.throws(() => recordExpense(s, a, { ...b, amount: -1 }, c));
  recordExpense(s, a, b, c); recordExpense(s, a, b, c);
  const r = financialReport(s, '2026-09-18', '2026-09-18'); assert.equal(r.expenseTotal, 2500); assert.equal(r.cashAfterExpenses, -2500); assert.equal(r.collected, 0); assert.equal(r.expenses.length, 1);
  assert.equal(financialReport(s, '2026-09-19', '2026-09-19').expenseTotal, 0);
});
test('monthly/yearly license extension handles month ends and leap years', () => {
  assert.equal(extendMonths(new Date('2028-01-31T10:00:00Z'), 1), '2028-02-29T10:00:00.000Z');
  assert.equal(extendMonths(new Date('2028-02-29T10:00:00Z'), 12), '2029-02-28T10:00:00.000Z');
});


test('cleaning: waiter, cashier (no waiter around), Müdür or owner; blocks ordering and movement, and preserves paid kitchen work', () => {
  const s = seed(), c = ctx(); s.cleaningEnabled = true;
  const owner = { tenantId: s.tenantId, id: 'own', role: 'owner' as const }, waiter = { ...owner, id: 'wait', role: 'waiter' as const };
  submitOrder(s, waiter, input(), c); const a = s.accounts[0];
  recordPayment(s, owner, { requestId: randomUUID(), accountId: a.id, version: a.version, amount: 3500, tendered: 3500, method: 'cash' }, c);
  assert.equal(s.tables[0].needsCleaning, true); assert.equal(s.orders[0].status, 'new');
  assert.throws(() => submitOrder(s, waiter, input(), c), { code: 'TABLE_CLEANING' });
  submitOrder(s, waiter, input('table-2'), c); const second = s.accounts[1];
  assert.throws(() => moveTable(s, waiter, { requestId: randomUUID(), accountId: second.id, version: second.version, targetId: 'table-1', targetEpoch: s.tables[0].epoch }, c), { code: 'TABLE_CHANGED' });
  const clean = { requestId: randomUUID(), tableId: 'table-1', epoch: s.tables[0].epoch };
  for (const actor of [{ ...waiter, role: 'kitchen' as const }, { ...waiter, tenantId: 'foreign' }]) assert.throws(() => markTableClean(s, actor, clean, c), { code: 'FORBIDDEN' });
  // The cashier passes the role check too (owner's decision, 5 October); the stale epoch below stops it like anyone.
  assert.throws(() => markTableClean(s, { ...waiter, role: 'cashier' as const }, { ...clean, epoch: 0 }, c), { code: 'TABLE_CHANGED' });
  assert.throws(() => markTableClean(s, waiter, { ...clean, epoch: 0 }, c), { code: 'TABLE_CHANGED' });
  markTableClean(s, waiter, clean, c); markTableClean(s, waiter, clean, c);
  assert.equal(s.audit.filter(e => e.action === 'table.cleaned').length, 1);
  submitOrder(s, waiter, input(), c); assert.equal(s.accounts.length, 3);
  assert.throws(() => markTableClean(s, waiter, { ...clean, requestId: randomUUID() }, c), { code: 'TABLE_CHANGED' });
});

test('moving and merging marks only vacated table dirty; empty closure respects setting', () => {
  const s = seed(), c = ctx(); s.cleaningEnabled = true;
  const owner = { tenantId: s.tenantId, id: 'own', role: 'owner' as const };
  submitOrder(s, owner, input(), c); const a = s.accounts[0];
  moveTable(s, owner, { requestId: randomUUID(), accountId: a.id, version: a.version, targetId: 'table-2', targetEpoch: 0 }, c);
  assert.equal(s.tables[0].needsCleaning, true); assert.ok(!s.tables[1].needsCleaning);
  submitOrder(s, owner, input('table-3'), c); const b = s.accounts[1];
  mergeAccounts(s, owner, { requestId: randomUUID(), sourceId: a.id, sourceVersion: a.version, targetId: b.id, targetVersion: b.version }, c);
  assert.equal(s.tables[1].needsCleaning, true); assert.ok(!s.tables[2].needsCleaning);
  for (const o of s.orders) o.status = 'cancelled';
  closeEmptyAccount(s, owner, b.id); assert.equal(s.tables[2].needsCleaning, true);
});

test('negative adjustments affect every unit and are frozen; zero or negative final price is rejected', () => {
  const s = seed(), c = ctx(), p = s.products.find(p => p.id === 'tea')!;
  p.groups = [{ id: 'size', name: 'Boy', required: false, options: [{ id: 'small', name: 'Küçük', extra: -1000 }] }];
  const cart = [{ productId: p.id, quantity: 2, selections: [{ groupId: 'size', optionId: 'small' }] }];
  assert.equal(quote(s.products, cart, c)[0].total, 5000);
  submitOrder(s, { tenantId: s.tenantId, id: 'wait', role: 'waiter' }, { requestId: randomUUID(), tableId: 'table-1', lines: cart, expectedTotal: 5000 }, c);
  p.groups[0].options[0].extra = -3500;
  assert.equal(s.orders[0].lines[0].unitPrice, 2500);
  assert.throws(() => quote(s.products, cart, c), { code: 'INVALID_VALUE' });
  p.groups[0].options[0].extra = -4000; assert.throws(() => quote(s.products, cart, c));
});


test('waiter can deliver a ready order but cannot change preparation steps', () => {
  const s = seed(), c = ctx(); s.changeSeconds = 0;
  const waiter = { tenantId: s.tenantId, id: 'w', role: 'waiter' as const }, kitchen = { ...waiter, role: 'kitchen' as const };
  submitOrder(s, waiter, input(), c); const o = s.orders[0];
  assert.throws(() => setStatus(s, waiter, o.id, o.version, 'preparing', c.now), { code: 'FORBIDDEN' });
  assert.throws(() => setStatus(s, waiter, o.id, o.version, 'served', c.now), { code: 'INVALID_TRANSITION' });
  setStatus(s, kitchen, o.id, o.version, 'preparing', c.now); setStatus(s, kitchen, o.id, o.version, 'ready', c.now);
  setStatus(s, waiter, o.id, o.version, 'served', c.now); assert.equal(o.status, 'served');
  assert.throws(() => setStatus(s, waiter, o.id, o.version - 1, 'served', c.now), { code: 'VERSION_CONFLICT' });
});


test('pay first gates preparation, snapshots policy, retains paid table until delivery and cleans once', () => {
  const s = seed(), c = ctx(); s.paymentMode = 'before_preparation'; s.changeSeconds = 0; s.cleaningEnabled = true;
  const cashier = { tenantId: s.tenantId, id: 'cash', role: 'cashier' as const }, kitchen = { ...cashier, role: 'kitchen' as const }, waiter = { ...cashier, role: 'waiter' as const };
  submitOrder(s, cashier, input('table-1', 2), c); const o = s.orders[0], a = s.accounts[0]; s.paymentMode = 'after_service';
  assert.throws(() => setStatus(s, kitchen, o.id, o.version, 'preparing', c.now), { code: 'PAYMENT_REQUIRED' });
  const pay = () => recordPayment(s, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 3500, tendered: 3500, selections: [{ orderId: o.id, lineId: o.lines[0].id, quantity: 1 }] }, c);
  pay(); assert.equal(isOrderPaid(s, o), false); assert.throws(() => setStatus(s, kitchen, o.id, o.version, 'preparing', c.now), { code: 'PAYMENT_REQUIRED' });
  assert.equal(pay().closed, false); assert.equal(a.status, 'open'); assert.ok(!s.tables[0].needsCleaning);
  setStatus(s, kitchen, o.id, o.version, 'preparing', c.now); setStatus(s, kitchen, o.id, o.version, 'ready', c.now); setStatus(s, waiter, o.id, o.version, 'served', c.now);
  assert.equal(a.status, 'closed'); assert.equal(s.tables[0].needsCleaning, true); assert.equal(s.archives.length, 1); assert.equal(s.archives[0].orders[0].status, 'served');
});

test('paid order stays paid when new orders join bill, explicit payment releases only fully paid orders', () => {
  const s = seed(), c = ctx(); s.paymentMode = 'before_preparation'; s.changeSeconds = 0;
  const cashier = { tenantId: s.tenantId, id: 'cash', role: 'cashier' as const }, kitchen = { ...cashier, role: 'kitchen' as const };
  submitOrder(s, cashier, input(), c); const first = s.orders[0], a = s.accounts[0];
  recordPayment(s, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 3500, tendered: 3500 }, c);
  submitOrder(s, cashier, input(), c); assert.equal(isOrderPaid(s, first), true); assert.equal(isOrderPaid(s, s.orders[1]), false);
  setStatus(s, kitchen, first.id, first.version, 'preparing', c.now);
  assert.throws(() => setStatus(s, kitchen, s.orders[1].id, s.orders[1].version, 'preparing', c.now), { code: 'PAYMENT_REQUIRED' });
});
