import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { submitOrder, recordPayment, moveTable, editOrder, cancelOrder, setStatus } from '../packages/domain/engine.js';
import { financialReport } from '../packages/domain/reports.js';

function setup() {
  const s = seed(); const ctx = { now: new Date('2026-09-17T10:00:00Z'), id: randomUUID };
  const owner = { tenantId: s.tenantId, id: 'owner', role: 'owner' as const };
  const guest = { ...owner, id: 'guest', role: 'guest' as const, tableId: 'table-1', epoch: 0 };
  const b = { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 };
  submitOrder(s, guest, b, ctx);
  const a = s.accounts[0];
  const input = () => ({ requestId: randomUUID(), accountId: a.id, version: a.version, targetId: 'table-2', targetEpoch: s.tables[1].epoch });
  return { s, ctx, owner, guest, b, a, input };
}
test('moving a partly paid table preserves financials and time; retries do not repeat movement', () => {
  const { s, ctx, owner, a, input } = setup();
  recordPayment(s, owner, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 2000, tendered: 3000 }, ctx);
  const report = financialReport(s, '2026-09-17', '2026-09-17'); const order = structuredClone(s.orders[0]);
  const body = input(), result = moveTable(s, owner, body, ctx); assert.deepEqual(moveTable(s, owner, body, ctx), result);
  assert.equal(a.tableId, 'table-2'); assert.equal(s.tables[0].accountId, null); assert.equal(s.tables[1].accountId, a.id);
  assert.equal(s.tables[0].epoch, 1); assert.equal(s.tables[1].epoch, 1); assert.equal(s.orders[0].editableUntil, order.editableUntil);
  assert.equal(s.orders[0].version, order.version + 1); assert.equal(s.orders[0].tableMovedFrom, s.tables[0].name);
  assert.deepEqual(financialReport(s, '2026-09-17', '2026-09-17'), report); assert.equal(s.audit.filter(x => x.action === 'table.moved').length, 1);
  recordPayment(s, owner, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 5000, tendered: 5000 }, ctx);
  assert.equal(s.archives[0].tableName, s.tables[1].name); assert.equal(s.archives[0].total, 7000);
});
test('old QR sessions and stale kitchen actions fail after move; new table session can order', () => {
  const { s, ctx, owner, guest, b, input } = setup(); const oldVersion = s.orders[0].version;
  moveTable(s, owner, input(), ctx);
  assert.throws(() => submitOrder(s, guest, { ...b, requestId: randomUUID() }, ctx));
  assert.throws(() => submitOrder(s, { ...guest, tableId: 'table-2' }, { ...b, requestId: randomUUID(), tableId: 'table-2' }, ctx));
  assert.throws(() => cancelOrder(s, guest, { requestId: randomUUID(), orderId: s.orders[0].id, version: s.orders[0].version }, ctx));
  assert.throws(() => editOrder(s, guest, { requestId: randomUUID(), orderId: s.orders[0].id, version: s.orders[0].version, lines: b.lines, expectedTotal: b.expectedTotal }, ctx));
  assert.throws(() => setStatus(s, owner, s.orders[0].id, oldVersion, 'preparing', new Date(ctx.now.getTime() + 600000)));
  submitOrder(s, { ...guest, tableId: 'table-2', epoch: 1 }, { ...b, requestId: randomUUID(), tableId: 'table-2' }, ctx);
  assert.equal(s.accounts.length, 1); assert.equal(s.orders.length, 2);
});

test('waiter can move a table but cannot record payment', () => {
  const { s, ctx, owner, a, input } = setup(); const waiter = { ...owner, id: 'waiter', role: 'waiter' as const };
  moveTable(s, waiter, input(), ctx); assert.equal(a.tableId, 'table-2');
  assert.equal(s.audit.at(-1)!.actor, 'waiter');
  assert.throws(() => recordPayment(s, waiter, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 7000, tendered: 7000 }, ctx));
});
test('move rejects unauthorized, occupied, changed, same, missing and stale targets without mutation', () => {
  for (const mode of ['kitchen', 'tenant', 'occupied', 'epoch', 'same', 'missing', 'version']) {
    const { s, ctx, owner, b, input } = setup(); const body = input(); let actor = { ...owner } as any;
    if (mode === 'kitchen') actor.role = 'kitchen'; if (mode === 'tenant') actor.tenantId = 'other';
    if (mode === 'occupied') submitOrder(s, owner, { ...b, requestId: randomUUID(), tableId: 'table-2' }, ctx);
    if (mode === 'epoch') body.targetEpoch++; if (mode === 'version') body.version++;
    if (mode === 'same') body.targetId = 'table-1'; if (mode === 'missing') body.targetId = 'unknown';
    const before = structuredClone(s); assert.throws(() => moveTable(s, actor, body, ctx)); assert.deepEqual(s, before);
  }
});
