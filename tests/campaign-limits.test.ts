import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { campaignUsage, campaignViews, saleProducts, type Campaign } from '../packages/domain/campaigns.js';
import { submitOrder, editOrder, cancelOrder, recordPayment } from '../packages/domain/engine.js';
import { campaignReport } from '../packages/domain/campaign-reports.js';
const now = new Date('2026-09-21T12:00:00Z');
function fixture(limit = 50) {
  const s = seed(); s.changeSeconds = 600;
  const c: Campaign = { id: 'limited', reportId: 'v1', name: 'İlk 50 ürün', productIds: ['tea', 'herbal'], kind: 'fixed', amount: 1000, maxQuantity: limit, startsAt: now.toISOString(), endsAt: null, enabled: true, combine: false };
  s.campaigns = [c];
  const actor = { tenantId: s.tenantId, role: 'guest' as const, id: 'guest', tableId: 'table-1', epoch: 0 }, ctx = { now, id: randomUUID };
  const input = (quantity: number, productId = 'tea', expectedTotal = (productId === 'tea' ? 2500 : 7500) * quantity) => ({ requestId: randomUUID(), tableId: 'table-1', expectedTotal, lines: [{ productId, quantity, selections: [] }] });
  return { s, c, ctx, actor, input };
}

test('campaign counts units across selected products, stops exactly at fifty, and stale price cannot order discounted fifty-first', () => {
  const { s, actor, ctx, input } = fixture();
  submitOrder(s, actor, input(20), ctx); submitOrder(s, actor, input(20, 'herbal'), ctx);
  const last = input(10); const result = submitOrder(s, actor, last, ctx);
  assert.equal(campaignUsage(s).get('limited'), 50);
  assert.equal(campaignViews(s)[0].remainingQuantity, 0);
  assert.equal(campaignReport(s, new Date(+now + 1000)).campaigns[0].quotaUnavailable, true);
  assert.equal(campaignReport(s, new Date(+now + 1000)).campaigns[0].ongoing, false);
  assert.equal(saleProducts(s, now).find(p => p.id === 'tea')!.discounts!.length, 0);
  assert.deepEqual(submitOrder(s, actor, last, ctx), result);
  assert.equal(campaignUsage(s).get('limited'), 50);
  assert.throws(() => submitOrder(s, actor, input(1), ctx), /Fiyat değişti/);
  submitOrder(s, actor, input(1, 'tea', 3500), ctx);
  assert.equal(campaignUsage(s).get('limited'), 50);
});

test('over-remaining request is rejected atomically across lines/products; unchosen offers do not consume quota', () => {
  const { s, actor, ctx, input, c } = fixture(2);
  const body = { ...input(1), lines: [...input(1).lines, ...input(2, 'herbal').lines], expectedTotal: 17500 };
  assert.throws(() => submitOrder(s, actor, body, ctx), /2 adet yer kaldı/);
  assert.equal(s.orders.length, 0); assert.equal(s.accounts.length, 0); assert.equal(campaignViews(s)[0].usedQuantity, 0);
  s.campaigns!.push({ ...c, id: 'better', amount: 2000, maxQuantity: null });
  submitOrder(s, actor, input(3, 'tea', 4500), ctx);
  assert.equal(campaignViews(s)[0].usedQuantity, 0);
});

test('pending approvals reserve quota; cancellation and reductions restore it; edit increases cannot bypass exhaustion', () => {
  const { s, actor, ctx, input } = fixture(2); s.waiterApproval = true;
  submitOrder(s, actor, input(2), ctx);
  const order = s.orders[0], line = order.lines[0];
  assert.equal(order.status, 'awaiting_approval'); assert.equal(campaignViews(s)[0].remainingQuantity, 0);
  const update = (quantity: number) => ({ requestId: randomUUID(), orderId: order.id, version: order.version, expectedTotal: quantity * 2500, lines: [{ ...input(quantity).lines[0], existingId: line.id }] });
  assert.throws(() => editOrder(s, actor, update(3), ctx), /2 adet yer kaldı/);
  assert.equal(order.total, 5000);
  editOrder(s, actor, update(1), ctx); assert.equal(campaignViews(s)[0].remainingQuantity, 1);
  const other = { ...actor, id: 'another' }; submitOrder(s, other, input(1), ctx);
  assert.throws(() => editOrder(s, actor, update(2), ctx), /1 adet yer kaldı/);
  cancelOrder(s, actor, { requestId: randomUUID(), orderId: order.id, version: order.version }, ctx);
  assert.equal(campaignViews(s)[0].remainingQuantity, 1);
  assert.equal(saleProducts(s, now).find(p => p.id === 'tea')!.discounts![0].remainingQuantity, 1);
});

test('paid archives count once, survive serialization and edits do not reset campaign identity usage', () => {
  const { s, c, actor, ctx, input } = fixture(2); submitOrder(s, actor, input(2), ctx);
  const a = s.accounts[0]; recordPayment(s, { ...actor, role: 'owner' }, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 5000, tendered: 5000 }, ctx);
  assert.equal(s.archives.length, 1); assert.equal(campaignUsage(s).get(c.id), 2);
  s.orders = []; s.campaigns![0] = { ...c, reportId: 'v2', name: 'Yeni ad', amount: 1500 };
  assert.equal(campaignViews(JSON.parse(JSON.stringify(s)))[0].remainingQuantity, 0);
});

test('stacked campaigns each count once and quantity rules cannot consume more than the remaining limit', () => {
  const { s, c, actor, ctx, input } = fixture(3);
  s.campaigns = [{ ...c, combine: true, minQuantity: 2 }, { ...c, id: 'second', combine: true, minQuantity: 2 }];
  submitOrder(s, actor, input(2, 'tea', 3000), ctx);
  assert.equal(campaignUsage(s).get(c.id), 2); assert.equal(campaignUsage(s).get('second'), 2);
  assert.equal(campaignViews(s)[0].remainingQuantity, 1);
  assert.equal(saleProducts(s, now).find(p => p.id === 'tea')!.discounts!.length, 0);
  const o = s.orders[0];
  assert.throws(() => editOrder(s, actor, { requestId: randomUUID(), orderId: o.id, version: o.version, expectedTotal: 6000, lines: [{ ...input(4).lines[0], existingId: o.lines[0].id }] }, ctx), /3 adet yer kaldı/);
});
