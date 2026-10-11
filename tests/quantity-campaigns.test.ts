import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { discountedPrice, saleProducts, type Campaign } from '../packages/domain/campaigns.js';
import { submitOrder, editOrder, quote, recordPayment } from '../packages/domain/engine.js';
import { campaignReport } from '../packages/domain/campaign-reports.js';
import { financialReport } from '../packages/domain/reports.js';

const now = new Date('2026-09-21T12:00:00Z');
const campaign: Campaign = { id: 'two', reportId: 'two-v1', name: 'İki latte', productIds: ['latte', 'tea'], minQuantity: 2, kind: 'fixed', amount: 2000, startsAt: '2026-09-20T12:00:00Z', endsAt: null, enabled: true, combine: false };
const regular = { productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'regular' }] };
const large = { ...regular, selections: [{ groupId: 'size', optionId: 'large' }] };
function fixture() {
  const s = seed(); s.changeSeconds = 600; s.campaigns = [structuredClone(campaign)];
  const actor = { tenantId: s.tenantId, role: 'guest' as const, id: 'guest', tableId: 'table-1', epoch: 0 };
  const ctx = { now, id: randomUUID };
  const submit = (lines: typeof regular[], expectedTotal: number) => submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', lines, expectedTotal }, ctx);
  return { s, actor, ctx, submit };
}

test('quantity thresholds aggregate same product across options and split lines, but not different products or orders', () => {
  const { s, ctx, submit } = fixture();
  const prices = (cart: typeof regular[]) => quote(saleProducts(s, now), cart, ctx).map(l => l.total);
  assert.deepEqual(prices([regular]), [14000]);
  assert.deepEqual(prices([regular, large]), [12000, 14500]);
  assert.deepEqual(prices([regular, regular]), [12000, 12000]);
  assert.deepEqual(prices([{ ...regular, quantity: 3 }]), [36000]);
  assert.deepEqual(prices([regular, { productId: 'tea', quantity: 1, selections: [] }]), [14000, 3500]);
  submit([regular], 14000); submit([regular], 14000);
  assert.deepEqual(s.orders.map(o => o.total), [14000, 14000]);
});

test('only eligible quantity offers join the best-price comparison with ordinary discounts', () => {
  const { s } = fixture();
  s.campaigns!.push({ ...campaign, id: 'always', minQuantity: 1, amount: 1000, combine: true });
  s.campaigns![0].combine = true;
  const p = saleProducts(s, now).find(p => p.id === 'latte')!;
  assert.equal(discountedPrice(p, 14000, 1).price, 13000);
  assert.equal(discountedPrice(p, 14000, 2).price, 11000);
  s.campaigns = [{ ...campaign, kind: 'percent', amount: undefined, percent: 10 }];
  const percentage = saleProducts(s, now).find(p => p.id === 'latte')!;
  assert.equal(discountedPrice(percentage, 14000, 1).price, 14000);
  assert.equal(discountedPrice(percentage, 14000, 2).price, 12600);
});

test('removing a qualifying line recalculates saved terms despite later price/campaign changes; retries remain stable', () => {
  const { s, ctx, actor, submit } = fixture(); submit([regular, large], 26500);
  const order = s.orders[0], line = order.lines[1];
  s.products.find(p => p.id === 'latte')!.price = 30000;
  s.campaigns![0] = { ...campaign, amount: 9000, minQuantity: 3, enabled: false };
  const update = { requestId: randomUUID(), orderId: order.id, version: order.version, lines: [{ ...large, existingId: line.id }], expectedTotal: 16500 };
  assert.throws(() => editOrder(s, actor, { ...update, expectedTotal: 14500 }, ctx), /Fiyat değişti/);
  assert.equal(order.total, 26500);
  const result = editOrder(s, actor, update, ctx);
  assert.equal(order.lines[0].campaigns, undefined);
  assert.equal(order.total, 16500);
  assert.deepEqual(editOrder(s, actor, update, ctx), result);
  editOrder(s, actor, { ...update, requestId: randomUUID(), version: order.version, lines: [{ ...large, existingId: line.id, quantity: 2 }], expectedTotal: 29000 }, ctx);
  assert.equal(order.total, 29000); assert.equal(order.lines[0].campaigns![0].reportId, 'two-v1');
  assert.equal(order.lines[0].quantityPricing!.offers[0].minQuantity, 2);
});

test('initially unqualified line keeps terms for later increase; paid accounts cannot change eligibility', () => {
  const { s, ctx, actor, submit } = fixture(); submit([regular], 14000);
  const order = s.orders[0], previous = order.lines[0];
  assert.ok(previous.quantityPricing); assert.equal(previous.originalUnitPrice, undefined);
  s.campaigns = [];
  const edit = { requestId: randomUUID(), orderId: order.id, version: order.version, lines: [{ ...regular, existingId: previous.id, quantity: 2 }], expectedTotal: 24000 };
  editOrder(s, actor, edit, ctx); assert.equal(order.total, 24000);
  const owner = { tenantId: s.tenantId, id: 'owner', role: 'owner' as const }, account = s.accounts[0];
  recordPayment(s, owner, { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'cash', amount: 12000, tendered: 12000, selections: [{ orderId: order.id, lineId: previous.id, quantity: 1 }] }, ctx);
  assert.throws(() => editOrder(s, actor, { ...edit, requestId: randomUUID(), version: order.version, lines: [{ ...regular, existingId: previous.id }], expectedTotal: 14000 }, ctx), /Kasiyerle görüşün/);
  recordPayment(s, owner, { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'cash', amount: 12000, tendered: 12000 }, ctx);
  s.campaignHistory = [{ ...campaign, recordedAt: campaign.startsAt }];
  const report = campaignReport(s, new Date(+now + 1000)).campaigns[0];
  assert.equal(report.minQuantity, 2); assert.equal(report.appliedAmount, 24000); assert.equal(report.discount, 4000);
  const financial = financialReport(s, '2026-09-21', '2026-09-21');
  assert.equal(financial.campaignCollected, 24000); assert.equal(financial.campaignDiscount, 4000);
});
