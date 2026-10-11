import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { discountedPrice, saleProducts, type Campaign } from '../packages/domain/campaigns.js';
import { submitOrder, editOrder } from '../packages/domain/engine.js';
const time = new Date('2026-09-21T12:00:00Z');
const offer = (extra: Partial<Extract<Campaign, { kind?: 'percent' }>> = {}): Campaign => ({ id: 'offer', name: 'Açılış', productIds: ['tea'], percent: 20, startsAt: time.toISOString(), endsAt: '2026-09-22T12:00:00Z', enabled: true, combine: false, ...extra });
const fixed = (extra: Partial<Extract<Campaign, { kind: 'fixed' }>> = {}): Campaign => ({ id: 'fixed', name: '20 TL indirim', productIds: ['tea'], kind: 'fixed', amount: 2000, startsAt: time.toISOString(), endsAt: null, enabled: true, combine: false, ...extra });
test('campaign starts and ends at exact boundaries; product scope and disabled offers respected', () => {
  const s = seed(); s.campaigns = [offer()];
  const price = (at: Date, id = 'tea') => { const p = saleProducts(s, at).find(p => p.id === id)!; return discountedPrice(p, p.price).price; };
  assert.equal(price(new Date(+time - 1)), 3500); assert.equal(price(time), 2800);
  assert.equal(price(new Date('2026-09-22T12:00:00Z')), 3500); assert.equal(price(time, 'herbal'), 8500);
  s.campaigns[0].endsAt = null; assert.equal(price(new Date('2030-01-01')), 2800);
  s.campaigns[0].enabled = false; assert.equal(price(time), 3500);
});
test('stacking is opt-in; choose best single or combined result with deterministic integer rounding', () => {
  const s = seed(); s.campaigns = [offer({ id: 'a', percent: 10, combine: true }), offer({ id: 'b', percent: 20, combine: true }), offer({ id: 'c', percent: 25 })];
  let p = saleProducts(s, time).find(p => p.id === 'tea')!;
  assert.equal(discountedPrice(p, 10000).price, 7200);
  assert.deepEqual(discountedPrice(p, 10000).campaigns.map(c => c.id), ['a', 'b']);
  s.campaigns[2].percent = 30; p = saleProducts(s, time).find(p => p.id === 'tea')!;
  assert.equal(discountedPrice(p, 10000).price, 7000);
  assert.deepEqual(discountedPrice(p, 10000).campaigns.map(c => c.id), ['c']);
  assert.equal(discountedPrice(p, 1).price, 1);
});
test('discount includes options, freezes accepted price and retry, edits retain original price after campaign ends', () => {
  const s = seed(); s.campaigns = [offer({ productIds: ['latte'] })]; s.changeSeconds = 600;
  const actor = { tenantId: s.tenantId, role: 'guest' as const, id: 'guest', tableId: 'table-1', epoch: 0 };
  const input = { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 13200, lines: [{ productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'large' }] }] };
  const ctx = { now: time, id: randomUUID }; const created = submitOrder(s, actor, input, ctx);
  const o = s.orders[0]; assert.equal(o.lines[0].originalUnitPrice, 16500); assert.equal(o.lines[0].unitPrice, 13200);
  s.campaigns[0].enabled = false; s.products.find(p => p.id === 'latte')!.price = 20000;
  assert.deepEqual(submitOrder(s, actor, input, ctx), created);
  editOrder(s, actor, { requestId: randomUUID(), orderId: o.id, version: o.version, expectedTotal: 26400, lines: [{ ...input.lines[0], existingId: o.lines[0].id, quantity: 2 }] }, ctx);
  assert.equal(o.total, 26400); assert.equal(o.lines[0].campaigns![0].name, 'Açılış');
});

test('fixed discount is per unit with options; accepted prices survive editing campaign type', () => {
  const s = seed(); s.campaigns = [fixed({ productIds: ['latte'], amount: 2025 })]; s.changeSeconds = 600;
  const actor = { tenantId: s.tenantId, role: 'guest' as const, id: 'guest', tableId: 'table-1', epoch: 0 };
  const ctx = { now: time, id: randomUUID };
  const input = { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 28950, lines: [{ productId: 'latte', quantity: 2, selections: [{ groupId: 'size', optionId: 'large' }] }] };
  const created = submitOrder(s, actor, input, ctx), order = s.orders[0];
  assert.equal(order.lines[0].originalUnitPrice, 16500);
  assert.equal(order.lines[0].unitPrice, 14475);
  s.campaigns = [offer({ id: 'fixed', productIds: ['latte'], percent: 50 })];
  assert.deepEqual(submitOrder(s, actor, input, ctx), created);
  editOrder(s, actor, { requestId: randomUUID(), orderId: order.id, version: order.version, expectedTotal: 43425, lines: [{ ...input.lines[0], existingId: order.lines[0].id, quantity: 3 }] }, ctx);
  assert.equal(order.total, 43425);
  assert.equal(order.lines[0].campaigns![0].name, '20 TL indirim');
});

test('mixed discounts apply percentages then fixed amounts regardless of IDs; best offer and positive floor preserved', () => {
  const s = seed();
  s.campaigns = [fixed({ id: 'a', combine: true }), offer({ id: 'z', percent: 10, combine: true }), offer({ id: 'single', percent: 25 })];
  const calculate = () => discountedPrice(saleProducts(s, time).find(p => p.id === 'tea')!, 10000);
  assert.equal(calculate().price, 7000);
  assert.deepEqual(calculate().campaigns.map(c => c.id), ['z', 'a']);
  s.campaigns.reverse(); assert.equal(calculate().price, 7000);
  s.campaigns.push(fixed({ id: 'best', amount: 4000 }));
  assert.equal(calculate().price, 6000);
  assert.deepEqual(calculate().campaigns.map(c => c.id), ['best']);
  s.campaigns = [fixed({ amount: 20000 })];
  assert.equal(calculate().price, 1);
  s.campaigns[0].enabled = false; assert.equal(calculate().price, 10000);
});
