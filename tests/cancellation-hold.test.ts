import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { submitOrder, setStatus, declineCancellation, DomainError } from '../packages/domain/engine.js';
for (const [stage, next, role] of [['new', 'preparing', 'kitchen'], ['preparing', 'ready', 'kitchen'], ['ready', 'served', 'kitchen'], ['ready', 'served', 'waiter']] as const) {
 test(`pending cancellation blocks ${stage} → ${next} for ${role} until resolved`, () => {
  const s = seed(); s.changeSeconds = 0;
  const ctx = { now: new Date('2026-09-29T08:00:00Z'), id: randomUUID };
  submitOrder(s, { tenantId: s.tenantId, id: 'g1', role: 'guest', tableId: 'table-1', epoch: 0 }, { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, ctx);
  const o = s.orders[0]; o.status = stage; o.cancelRequested = true;
  const actor = { tenantId: s.tenantId, id: role, role };
  const before = structuredClone(o);
  assert.throws(() => setStatus(s, actor, o.id, o.version, next, ctx.now), (e: unknown) => e instanceof DomainError && e.code === 'CANCELLATION_PENDING');
  assert.deepEqual(o, before);
  declineCancellation(s, { ...actor, role: 'kitchen' }, { requestId: randomUUID(), orderId: o.id, version: o.version, reason: 'Hazırlık tamamlandı.' }, ctx);
  setStatus(s, actor, o.id, o.version, next, ctx.now);
  assert.equal(o.status, next);
 });
}
