import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api.js';
import { clearPendingEdit, editDefinitelyRejected, pendingEditKey, readPendingEdit, writePendingEdit, type PendingEdit } from '../src/pendingEdit.js';
const pending: PendingEdit = { format: 1, number: 42, body: { requestId: 'edit-request-123', guestContext: 'a'.repeat(64), orderId: 'order-1', version: 1, expectedTotal: 7000, lines: [{ productId: 'tea', existingId: 'line-1', quantity: 2, selections: [] }] }, labels: [{ name: 'Çay', quantity: 2, total: 7000 }] };
function storage() { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; }
test('edit recovery keeps original line IDs, version and displayed totals and scopes QR links', () => {
  const s = storage(), key = pendingEditKey('/m/a');
  assert.equal(writePendingEdit(s, key, pending), true); assert.deepEqual(readPendingEdit(s, key), pending);
  assert.equal(readPendingEdit(s, pendingEditKey('/m/b')), null);
  clearPendingEdit(s, key, 'late-other-edit'); assert.deepEqual(readPendingEdit(s, key), pending);
  clearPendingEdit(s, key, pending.body.requestId); assert.equal(readPendingEdit(s, key), null);
});
test('corrupt edit records are ignored and storage denial does not throw', () => {
  const s = storage(), key = pendingEditKey('/m/a');
  for (const value of ['{bad', ' '.repeat(60001), JSON.stringify({ ...pending, format: 2 }), JSON.stringify({ ...pending, body: { ...pending.body, requestId: undefined } }), JSON.stringify({ ...pending, body: { ...pending.body, guestContext: undefined } }), JSON.stringify({ ...pending, labels: [{ name: 'Çay', quantity: 1, total: 7000 }] }), JSON.stringify({ ...pending, labels: [{ name: 'Çay', quantity: 2, total: 7001 }] }), JSON.stringify({ ...pending, body: { ...pending.body, lines: [{ productId: 'tea', existingId: {}, quantity: 2, selections: [] }] } })]) {
    s.setItem(key, value); assert.equal(readPendingEdit(s, key), null);
  }
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); }, removeItem() { throw Error('denied'); } };
  assert.equal(readPendingEdit(denied, key), null); assert.equal(writePendingEdit(denied, key, pending), false);
  assert.doesNotThrow(() => clearPendingEdit(denied, key, pending.body.requestId));
});
test('only definitive edit rejection clears pending state; timeouts, login and context changes retain it', () => {
  for (const code of ['VERSION_CONFLICT', 'EDIT_WINDOW_CLOSED', 'ACCOUNT_CLOSED', 'PRICE_CHANGED']) assert.equal(editDefinitelyRejected(new ApiError('test', 409, code)), true);
  for (const code of ['UNAUTHORIZED', 'RATE_LIMIT', 'EDIT_CONTEXT_CHANGED', 'BUSINESS_OFFLINE', 'REQUEST_CONFLICT']) assert.equal(editDefinitelyRejected(new ApiError('test', 409, code)), false);
  assert.equal(editDefinitelyRejected(new Error('timeout')), false);
});
