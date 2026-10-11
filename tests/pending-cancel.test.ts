import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api.js';
import { cancelDefinitelyRejected, clearPendingCancel, pendingCancelKey, readPendingCancel, writePendingCancel, type PendingCancel } from '../src/pendingCancel.js';
const pending: PendingCancel = { format: 1, number: 7, body: { requestId: 'cancel-test-123', guestContext: 'a'.repeat(64), orderId: 'order-7', version: 2 } };
function storage() { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; }
test('pending cancellation keeps the exact order version, separates QR links and survives late responses', () => {
  const s = storage(), key = pendingCancelKey('/m/a');
  assert.equal(writePendingCancel(s, key, pending), true); assert.deepEqual(readPendingCancel(s, key), pending);
  assert.equal(readPendingCancel(s, pendingCancelKey('/m/b')), null);
  clearPendingCancel(s, key, 'older-request'); assert.deepEqual(readPendingCancel(s, key), pending);
  clearPendingCancel(s, key, pending.body.requestId); assert.equal(readPendingCancel(s, key), null);
});
test('invalid cancellation records and unavailable browser storage are safe', () => {
  const s = storage(), key = pendingCancelKey('/m/a');
  for (const value of ['{bad', ' '.repeat(2001), JSON.stringify({ ...pending, format: 2 }), JSON.stringify({ ...pending, number: 0 }), JSON.stringify({ ...pending, body: { ...pending.body, version: -1 } }), JSON.stringify({ ...pending, body: { ...pending.body, requestId: undefined } }), JSON.stringify({ ...pending, body: { ...pending.body, guestContext: 'invalid' } })]) { s.setItem(key, value); assert.equal(readPendingCancel(s, key), null); }
  const denied = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
  assert.equal(readPendingCancel(denied, key), null); assert.equal(writePendingCancel(denied, key, pending), false); assert.doesNotThrow(() => clearPendingCancel(denied, key, pending.body.requestId));
  assert.equal(cancelDefinitelyRejected(new ApiError('paid', 409, 'CASHIER_REVIEW')), true);
  for (const code of ['CANCEL_CONTEXT_CHANGED', 'UNAUTHORIZED', 'BUSINESS_OFFLINE', 'REQUEST_CONFLICT']) assert.equal(cancelDefinitelyRejected(new ApiError('unknown', 409, code)), false);
  assert.equal(cancelDefinitelyRejected(new Error('timeout')), false);
});
