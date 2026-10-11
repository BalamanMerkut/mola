import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearPendingOrder, pendingOrderKey, readPendingOrder, writePendingOrder, type PendingOrder } from '../src/pendingOrder.js';
const pending: PendingOrder = { version: 1, body: { requestId: 'pending-test-order', tableId: 'table-1', guestContext: 'a'.repeat(64), expectedTotal: 3500, lines: [{ productId: 'tea', quantity: 1, selections: [] }] }, labels: [{ name: 'Çay', options: '', total: 3500 }] };
function storage() { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; }
test('pending order persists exact request and display totals, scopes QR links and clears after confirmation', () => {
  const s = storage(), key = pendingOrderKey('/m/one');
  assert.equal(writePendingOrder(s, key, pending), true);
  assert.deepEqual(readPendingOrder(s, key), pending);
  assert.equal(readPendingOrder(s, pendingOrderKey('/m/two')), null);
  clearPendingOrder(s, key, 'late-older-response'); assert.deepEqual(readPendingOrder(s, key), pending);
  clearPendingOrder(s, key); assert.equal(readPendingOrder(s, key), null);
});
test('invalid stored requests are never recovered; denied browser storage fails gracefully', () => {
  const s = storage(), key = 'test';
  for (const value of ['{broken', JSON.stringify({ ...pending, version: 2 }), JSON.stringify({ ...pending, body: { ...pending.body, guestContext: undefined } }), JSON.stringify({ ...pending, labels: [{ name: 'Çay', options: '', total: 1 }] }), JSON.stringify({ ...pending, body: { ...pending.body, lines: [{ productId: 'tea', quantity: -1, selections: [] }] } })]) {
    s.setItem(key, value); assert.equal(readPendingOrder(s, key), null);
  }
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); }, removeItem() { throw Error('denied'); } };
  assert.equal(readPendingOrder(denied, key), null); assert.equal(writePendingOrder(denied, key, pending), false);
  assert.doesNotThrow(() => clearPendingOrder(denied, key));
});
