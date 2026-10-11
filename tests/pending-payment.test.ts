import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearPendingPayment, readPendingPayment, writePendingPayment, type PendingPayment } from '../src/pendingPayment.js';
const context = 'a'.repeat(64);
const pending: PendingPayment = { version: 1, table: { name: 'Masa 1', account: { id: 'account-1', version: 2, balance: 10500, paid: 0 } }, body: { requestId: 'payment-test-123', paymentContext: context, accountId: 'account-1', version: 2, method: 'cash', amount: 3500, tendered: 5000, selections: [{ orderId: 'order-1', lineId: 'line-1', quantity: 1 }] } };
function storage() { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; }
test('payment recovery preserves exact selections and money, isolates employees and ignores late clearing', () => {
  const s = storage(); assert.equal(writePendingPayment(s, pending), true);
  assert.deepEqual(readPendingPayment(s, context), pending);
  assert.equal(readPendingPayment(s, 'b'.repeat(64)), null);
  clearPendingPayment(s, context, 'older-request'); assert.deepEqual(readPendingPayment(s, context), pending);
  clearPendingPayment(s, context, pending.body.requestId); assert.equal(readPendingPayment(s, context), null);
});
test('damaged, oversized and cross-context payment records cannot be replayed; storage denial is safe', () => {
  const s = storage();
  for (const value of ['{broken', ' '.repeat(50001), JSON.stringify({ ...pending, version: 3 }), JSON.stringify({ ...pending, body: { ...pending.body, paymentContext: 'b'.repeat(64) } }), JSON.stringify({ ...pending, body: { ...pending.body, accountId: 'another-account' } }), JSON.stringify({ ...pending, body: { ...pending.body, amount: -1 } }), JSON.stringify({ ...pending, body: { ...pending.body, selections: [{ orderId: 'o', lineId: 'l', quantity: 0 }] } })]) {
    s.setItem('mola.pending-payment.v1:' + context, value); assert.equal(readPendingPayment(s, context), null);
  }
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); }, removeItem() { throw Error('denied'); } };
  assert.equal(readPendingPayment(denied, context), null); assert.equal(writePendingPayment(denied, pending), false);
  assert.doesNotThrow(() => clearPendingPayment(denied, context, pending.body.requestId));
});
