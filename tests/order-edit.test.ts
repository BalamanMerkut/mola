import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { submitOrder, editOrder, recordPayment } from '../packages/domain/engine.js';
import { employeeReport } from '../packages/domain/reports.js';

function fixture() {
  const s = seed(); s.changeSeconds = 60;
  const actor = { tenantId: s.tenantId, id: 'g1', role: 'guest' as const, tableId: 'table-1', epoch: 0 };
  const ctx = { now: new Date('2026-09-17T10:00:00Z'), id: randomUUID };
  submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, ctx);
  const order = s.orders[0];
  const input = () => ({ requestId: randomUUID(), orderId: order.id, version: order.version, expectedTotal: 7000, lines: [{ existingId: order.lines[0].id, productId: 'tea', quantity: 2, selections: [] }] });
  return { s, actor, ctx, order, input };
}
test('editing preserves original price, deadline, attribution and count; retries apply once', () => {
  const { s, actor, ctx, order, input } = fixture(); const deadline = order.editableUntil; const accountVersion = s.accounts[0].version;
  s.products.find(p => p.id === 'tea')!.price = 9900; const b = input();
  const result = editOrder(s, actor, b, ctx); ctx.now = new Date('2026-09-17T10:02:00Z');
  assert.deepEqual(editOrder(s, actor, b, ctx), result);
  assert.equal(order.total, 7000); assert.equal(order.lines[0].unitPrice, 3500); assert.equal(order.editableUntil, deadline);
  assert.equal(order.version, 2); assert.equal(s.accounts[0].version, accountVersion + 1); assert.equal(s.audit.filter(a => a.action === 'order.edited').length, 1);
  assert.equal(employeeReport(s, '2026-09-17', '2026-09-17').rows.find(r => r.source === 'qr')!.orders, 1);
  assert.throws(() => editOrder(s, actor, { ...b, expectedTotal: 99 }, ctx), /farklı içerik/);
});
test('edits reject other guests, tenants, tables, epochs and blocked browsers', () => {
  for (const changes of [{ id: 'other' }, { tenantId: 'other' }, { tableId: 'table-2' }, { epoch: 1 }]) {
    const { s, actor, ctx, input } = fixture(); assert.throws(() => editOrder(s, { ...actor, ...changes }, input(), ctx)); assert.equal(s.orders[0].total, 3500);
  }
  const { s, actor, ctx, input } = fixture(); s.blocked.push(actor.id); assert.throws(() => editOrder(s, actor, input(), ctx));
});
test('exact deadline, preparing, stale version, closed account and partial payment reject edits', () => {
  for (const reason of ['deadline', 'preparing', 'version', 'closed', 'payment']) {
    const { s, actor, ctx, order, input } = fixture(); const b = input();
    if (reason === 'deadline') ctx.now = new Date(order.editableUntil!);
    if (reason === 'preparing') order.status = 'preparing';
    if (reason === 'version') order.version++;
    if (reason === 'closed') s.accounts[0].status = 'closed';
    if (reason === 'payment') recordPayment(s, { tenantId: s.tenantId, id: 'owner', role: 'owner' }, { requestId: randomUUID(), accountId: s.accounts[0].id, version: s.accounts[0].version, method: 'cash', amount: 1000, tendered: 1000 }, ctx);
    assert.throws(() => editOrder(s, actor, b, ctx)); assert.equal(order.total, 3500);
  }
});
test('new choices use current price; invalid totals, duplicate lines and sold out additions fail', () => {
  const { s, actor, ctx, order, input } = fixture();
  assert.throws(() => editOrder(s, actor, { ...input(), lines: [] }, ctx));
  const b = input(); assert.throws(() => editOrder(s, actor, { ...b, lines: [b.lines[0], b.lines[0]] }, ctx));
  s.products.find(p => p.id === 'tea')!.soldOut = true; assert.throws(() => editOrder(s, actor, input(), ctx));
  const latte = { productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'large' }] };
  assert.throws(() => editOrder(s, actor, { ...input(), lines: [latte], expectedTotal: 1 }, ctx)); assert.equal(order.total, 3500);
  editOrder(s, actor, { ...input(), lines: [latte], expectedTotal: 16500 }, ctx); assert.equal(order.lines[0].productId, 'latte'); assert.equal(order.total, 16500);
  const line = order.lines[0];
  editOrder(s, actor, { requestId: randomUUID(), orderId: order.id, version: order.version, lines: [{ ...latte, existingId: line.id, selections: [{ groupId: 'size', optionId: 'regular' }] }], expectedTotal: 14000 }, ctx);
  assert.equal(order.total, 14000); assert.equal(s.orders.length, 1);
});
