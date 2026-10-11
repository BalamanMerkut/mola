import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { submitOrder, recordPayment } from '../packages/domain/engine.js';
import { campaignReport } from '../packages/domain/campaign-reports.js';
import { financialReport } from '../packages/domain/reports.js';
const start = new Date('2026-09-10T12:00:00Z');
const offer = { id: 'offer', reportId: 'revision1', name: 'İki gün', productIds: ['tea'], percent: 20, startsAt: start.toISOString(), endsAt: '2026-09-12T12:00:00Z', enabled: true, combine: false };
function fixture() { const s = seed(); s.campaigns = [offer]; const actor = { tenantId: s.tenantId, role: 'owner' as const, id: 'owner' }; return { s, actor }; }

test('fixed campaign reports keep amount and history, and allocated receipts count once', () => {
  const { s, actor } = fixture();
  const fixed = { ...offer, kind: 'fixed' as const, amount: 1025, percent: undefined };
  s.campaigns = [fixed];
  const ctx = { now: new Date('2026-09-11T12:00:00Z'), id: randomUUID };
  submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 4950, lines: [{ productId: 'tea', quantity: 2, selections: [] }] }, ctx);
  const a = s.accounts[0];
  recordPayment(s, actor, { requestId: randomUUID(), accountId: a.id, version: a.version, amount: 4950, tendered: 4950, method: 'cash' }, ctx);
  s.campaignHistory = [{ ...fixed, recordedAt: fixed.startsAt, supersededAt: fixed.endsAt }];
  s.campaigns = [{ ...offer, reportId: 'revision2', enabled: false }];
  const report = campaignReport(s, new Date('2026-09-13T12:00:00Z')).campaigns[0];
  assert.equal(report.kind, 'fixed'); assert.equal(report.amount, 1025); assert.equal(report.percent, undefined);
  assert.equal(report.appliedQuantity, 2); assert.equal(report.appliedAmount, 4950); assert.equal(report.discount, 2050);
  const finances = financialReport(s, '2026-09-11', '2026-09-11');
  assert.equal(finances.campaignCollected, 4950); assert.equal(finances.campaignDiscount, 2050);
});
test('two-day campaign compares daily averages against seven days; excludes cancellations and freezes revision history', () => {
  const { s, actor } = fixture();
  function order(at: string, quantity: number, expectedTotal: number) { submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', expectedTotal, lines: [{ productId: 'tea', quantity, selections: [] }] }, { now: new Date(at), id: randomUUID }); }
  order('2026-09-04T12:00:00Z', 14, 49000); order('2026-09-11T12:00:00Z', 8, 22400);
  order('2026-09-11T13:00:00Z', 2, 5600); s.orders.at(-1)!.status = 'cancelled';
  s.campaignHistory = [{ ...offer, recordedAt: offer.startsAt, supersededAt: offer.endsAt }];
  s.campaigns = [{ ...offer, reportId: 'revision2', enabled: false }];
  const row = campaignReport(s, new Date('2026-09-13T12:00:00Z')).campaigns[0];
  assert.equal(row.durationDays, 2); assert.equal(row.before, 14); assert.equal(row.quantity, 8);
  assert.equal(row.dailyBefore, 2); assert.equal(row.dailyDuring, 4); assert.equal(row.changePercent, 100);
  assert.equal(row.appliedAmount, 22400); assert.equal(row.discount, 5600);
});
test('stacked campaigns are counted once in financial totals; selected payments retain exact allocation in archive', () => {
  const { s, actor } = fixture(); s.campaigns![0] = { ...offer, combine: true };
  s.campaigns!.push({ ...offer, id: 'second', reportId: 'second1', combine: true });
  const ctx = { now: new Date('2026-09-11T12:00:00Z'), id: randomUUID };
  submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 10740, lines: [{ productId: 'tea', quantity: 1, selections: [] }, { productId: 'herbal', quantity: 1, selections: [] }] }, ctx);
  const a = s.accounts[0], o = s.orders[0];
  recordPayment(s, actor, { requestId: randomUUID(), accountId: a.id, version: a.version, amount: 2240, tendered: 2240, method: 'cash', selections: [{ orderId: o.id, lineId: o.lines[0].id, quantity: 1 }] }, ctx);
  recordPayment(s, actor, { requestId: randomUUID(), accountId: a.id, version: a.version, amount: 8500, tendered: 8500, method: 'card' }, ctx);
  const r = financialReport(s, '2026-09-11', '2026-09-11');
  assert.equal(r.campaignCollected, 2240); assert.equal(r.regularCollected, 8500); assert.equal(r.unallocatedCollected, 0);
  assert.equal(r.campaignQuantity, 1); assert.equal(r.campaignDiscount, 1260);
  s.orders = []; s.payments = []; assert.deepEqual(financialReport(s, '2026-09-11', '2026-09-11'), r);
});
test('mixed unallocated partial payments stay explicit rather than guessing campaign revenue', () => {
  const { s, actor } = fixture(); const ctx = { now: new Date('2026-09-11T12:00:00Z'), id: randomUUID };
  submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 11300, lines: [{ productId: 'tea', quantity: 1, selections: [] }, { productId: 'herbal', quantity: 1, selections: [] }] }, ctx);
  const a = s.accounts[0];
  for (const amount of [3000, 8300]) recordPayment(s, actor, { requestId: randomUUID(), accountId: a.id, version: a.version, amount, tendered: amount, method: 'cash' }, ctx);
  const r = financialReport(s, '2026-09-11', '2026-09-11'); assert.equal(r.unallocatedCollected, 11300); assert.equal(r.campaignCollected, 0);
  const empty = campaignReport(seed(), ctx.now); assert.deepEqual(empty.campaigns, []);
  const row = campaignReport(s, ctx.now).campaigns[0]; assert.equal(row.changePercent, null);
});
