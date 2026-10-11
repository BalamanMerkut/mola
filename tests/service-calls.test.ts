import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { recordPayment, submitOrder } from '../packages/domain/engine.js';
import { activeCalls, publicCalls, requestServiceCall, resolveServiceCall } from '../packages/domain/service-calls.js';
import type { Actor } from '../packages/domain/types.js';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../server/store.js';
import { MerkezLink } from '../server/kafe-link.js';
import { licensed } from './merkez-fixture.js';

const ctx = () => ({ now: new Date('2026-10-02T10:00:00Z'), id: randomUUID });
const guest = (id = 'g1', epoch = 0): Actor => ({ tenantId: 'mola-demo', id, role: 'guest', tableId: 'table-1', epoch });
const waiter: Actor = { tenantId: 'mola-demo', id: 'waiter', role: 'waiter' };
const call = (s = seed(), actor = guest(), kind: 'waiter' | 'bill' = 'waiter') => requestServiceCall(s, actor, { requestId: randomUUID(), kind }, ctx());

test('a table has at most one open call per kind, even with several phones', () => {
  const s = seed();
  const first = call(s, guest('g1')), second = call(s, guest('g2'));
  assert.equal(second.alreadyOpen, true); assert.equal(second.callId, first.callId);
  assert.equal(activeCalls(s).length, 1);
  assert.deepEqual(Object.keys(publicCalls(s)[0]).sort(), ['createdAt', 'id', 'kind', 'tableId', 'tableName'], 'staff never see browser ids');
});
test('bill request needs an open account; staff answer it once', () => {
  const s = seed();
  assert.throws(() => call(s, guest(), 'bill'), /açık hesap yok/);
  submitOrder(s, guest(), { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, ctx());
  const { callId } = call(s, guest(), 'bill');
  assert.deepEqual(resolveServiceCall(s, waiter, { callId }, ctx()), { ok: true, alreadyResolved: false });
  assert.deepEqual(resolveServiceCall(s, waiter, { callId }, ctx()), { ok: true, alreadyResolved: true });
  assert.throws(() => resolveServiceCall(s, { tenantId: 'mola-demo', id: 'k', role: 'kitchen' }, { callId }, ctx()), /yetkiniz yok/);
});
test('menu-only plan blocks guest ordering and calls but keeps the menu open', () => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/menu-only-')), ['mola-demo']);
  try {
    // The plan comes from the signed licence (Mola Merkez); a full-system licence first, then a menu-only one.
    licensed(store);
    const now = () => new Date('2026-10-02T10:00:00Z');
    assert.doesNotThrow(() => new MerkezLink(store, { now }).assertGuestService('mola-demo'));
    store.db.exec('DELETE FROM merkez_link'); licensed(store, { service: 'menu' });
    const link = new MerkezLink(store, { now });
    assert.equal(link.menuOnly('mola-demo'), true);
    assert.throws(() => link.assertGuestService('mola-demo'), /personele/);
    assert.doesNotThrow(() => link.assertMenu('mola-demo'));
  } finally { store.close(); }
});
test('closing the account retires calls; old sessions and blocked browsers cannot call', () => {
  const s = seed();
  submitOrder(s, guest(), { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, ctx());
  call(s, guest(), 'bill');
  recordPayment(s, { tenantId: 'mola-demo', id: 'c', role: 'cashier' }, { requestId: randomUUID(), accountId: s.accounts[0].id, version: s.accounts[0].version, method: 'cash', amount: 3500, tendered: 3500 }, ctx());
  assert.equal(activeCalls(s).length, 0, 'paid and closed table has no pending bill call');
  assert.throws(() => call(s, guest('g1', 0)), /kapandı/);
  s.blocked.push('g9'); assert.throws(() => call(s, guest('g9', 1)), /durduruldu/);
});
