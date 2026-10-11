import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { initialUsers } from '../server/accounts.js';
import { submitOrder, recordPayment } from '../packages/domain/engine.js';
import { employeeReport, financialReport, previousRange, salesOverview } from '../packages/domain/reports.js';
import { comparisonLabel, dayStart } from '../packages/domain/business-day.js';

test('employee report separates QR, cancelled orders and unique archived orders across business day boundaries (05:00)', () => {
  const s = seed(); s.staffUsers = initialUsers(s.tenantId);
  const waiter = { tenantId: s.tenantId, id: 'garson', role: 'waiter' as const };
  const owner = { tenantId: s.tenantId, id: 'isletme', role: 'owner' as const };
  const body = { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 };
  const ctx = { now: new Date('2026-09-17T02:00:00Z'), id: randomUUID };
  submitOrder(s, waiter, body, ctx); submitOrder(s, waiter, body, ctx);
  submitOrder(s, { ...waiter, role: 'guest', id: 'guest', tableId: 'table-1', epoch: 0 }, { ...body, requestId: randomUUID() }, ctx);
  submitOrder(s, waiter, { ...body, requestId: randomUUID() }, ctx); s.orders[2].status = 'cancelled';
  const a = s.accounts[0];
  recordPayment(s, owner, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 14000, tendered: 14000 }, ctx);
  s.staffUsers.find(u => u.id === 'garson')!.active = false;
  const result = employeeReport(s, '2026-09-17', '2026-09-17');
  const row = result.rows.find(r => r.id === 'garson')!;
  assert.equal(row.orders, 1); assert.equal(row.items, 2); assert.equal(row.amount, 7000); assert.equal(row.cancelled, 1); assert.equal(row.active, false);
  assert.equal(result.rows.find(r => r.source === 'qr')!.orders, 1);
  assert.equal(employeeReport(s, '2026-09-16', '2026-09-16').rows.reduce((n, r) => n + r.orders, 0), 0);
  s.orders = []; assert.deepEqual(employeeReport(s, '2026-09-17', '2026-09-17'), result);
  assert.throws(() => employeeReport(s, '2026-02-30', '2026-09-17'));
  assert.throws(() => employeeReport(s, '2026-09-18', '2026-09-17'));
});

test('financial report uses payment dates, frozen commission, unique archives, cancelled exclusions and zero-filled days', () => {
  const s = seed(); s.commissionBps = 300;
  const owner = { tenantId: s.tenantId, id: 'isletme', role: 'owner' as const };
  // 04:59:59 Turkish time still belongs to the evening before; 05:00 starts the next business day.
  const ctx = { now: new Date('2026-09-17T01:59:59Z'), id: randomUUID };
  const body = { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 };
  submitOrder(s, owner, body, ctx);
  submitOrder(s, owner, { ...body, requestId: randomUUID() }, ctx); s.orders[1].status = 'cancelled';
  const a = s.accounts[0];
  recordPayment(s, owner, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 2000, tendered: 5000 }, ctx);
  ctx.now = new Date('2026-09-17T02:00:00Z');
  recordPayment(s, owner, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'card', amount: 5000, tendered: 5000 }, ctx);
  s.commissionBps = 5000;
  const result = financialReport(s, '2026-09-16', '2026-09-18');
  assert.equal(result.collected, 7000); assert.equal(result.cash, 2000); assert.equal(result.card, 5000);
  assert.equal(result.commission, 150); assert.equal(result.afterCommission, 6850);
  assert.equal(result.orderAmount, 7000); assert.equal(result.orderCount, 1); assert.equal(result.cancelledCount, 1);
  assert.equal(result.products[0].quantity, 2); assert.deepEqual(result.days.map(d => d.total), [2000, 5000, 0]);
  const next = financialReport(s, '2026-09-17', '2026-09-17'); assert.equal(next.collected, 5000); assert.equal(next.orderCount, 0);
  s.orders = []; s.payments = []; assert.deepEqual(financialReport(s, '2026-09-16', '2026-09-18'), result);
  s.archives[0].payments[1].commission = null;
  const unknown = financialReport(s, '2026-09-16', '2026-09-18'); assert.equal(unknown.afterCommission, null); assert.equal(unknown.unknownCommissionAmount, 5000);
  assert.throws(() => financialReport(s, '2020-01-01', '2026-01-01'));
  assert.throws(() => financialReport(s, '2026-02-30', '2026-03-01'));
});

test('self-service summary counts orders separately from browsers and accounts, excluding cancelled and duplicate archive copies', () => {
  const s = seed(); const ctx = { now: new Date('2026-09-17T10:00:00Z'), id: randomUUID };
  const order = (id: string, role: 'guest' | 'waiter', tableId = 'table-1') => submitOrder(s, { tenantId: s.tenantId, id, role, tableId, epoch: 0 }, { requestId: randomUUID(), tableId, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, ctx);
  assert.deepEqual(employeeReport(s, '2026-09-17', '2026-09-17').selfService, { qrOrders: 0, staffOrders: 0, browserCount: 0, accountCount: 0 });
  order('phone-a', 'guest'); order('phone-a', 'guest'); order('phone-b', 'guest'); order('phone-a', 'guest', 'table-2'); order('waiter', 'waiter'); order('cancelled-only', 'guest'); s.orders.at(-1)!.status = 'cancelled';
  const expected = { qrOrders: 4, staffOrders: 1, browserCount: 2, accountCount: 2 };
  assert.deepEqual(employeeReport(s, '2026-09-17', '2026-09-17').selfService, expected);
  const a = s.accounts[0]; recordPayment(s, { tenantId: s.tenantId, id: 'owner', role: 'owner' }, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 14000, tendered: 14000 }, ctx);
  assert.deepEqual(employeeReport(s, '2026-09-17', '2026-09-17').selfService, expected);
  assert.equal(JSON.stringify(employeeReport(s, '2026-09-17', '2026-09-17')).includes('phone-a'), false);
});


test('missing legacy commission stays unknown; zero commission is valid and expenses do not fabricate a net total', () => {
  const s = seed();
  s.payments = [
    { id: 'unknown', accountId: 'a', method: 'card', createdAt: '2026-09-21T10:00:00Z', amount: 10000, tendered: 10000, change: 0, commission: null },
    { id: 'legacy', accountId: 'a', method: 'card', createdAt: '2026-09-21T10:00:00Z', amount: 5000, tendered: 5000, change: 0, commission: undefined as unknown as null },
    { id: 'free', accountId: 'a', method: 'card', createdAt: '2026-09-21T10:00:00Z', amount: 3000, tendered: 3000, change: 0, commission: 0 },
    { id: 'known', accountId: 'a', method: 'card', createdAt: '2026-09-21T10:00:00Z', amount: 2000, tendered: 2000, change: 0, commission: 200 }
  ];
  s.commissionBps = 3000;
  const r = financialReport(s, '2026-09-21', '2026-09-21');
  assert.equal(r.afterCommission, null); assert.equal(r.unknownCommissionCount, 2); assert.equal(r.unknownCommissionAmount, 15000);
  assert.equal(r.commission, 200); assert.equal(r.collected - r.commission - r.expenseTotal, 19800);
});


test('all-time reports include archived history beyond one year and reject mixed date modes', async () => {
  const { paymentLedgerPage } = await import('../packages/domain/payment-history.js');
  const s = seed();
  const owner = { tenantId: s.tenantId, id: 'isletme', role: 'owner' as const };
  for (const date of ['2020-01-01T10:00:00Z', '2026-09-28T10:00:00Z']) {
    const ctx = { now: new Date(date), id: randomUUID };
    submitOrder(s, owner, { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, ctx);
    const a = s.accounts.find(a => a.status === 'open')!;
    recordPayment(s, owner, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 3500, tendered: 3500 }, ctx);
  }
  s.orders = []; s.payments = [];
  const report = financialReport(s, 'all', 'all');
  assert.equal(report.collected, 7000); assert.equal(report.orderCount, 2);
  assert.deepEqual(report.days.map(d => d.date), ['2020-01-01', '2026-09-28']);
  assert.equal(employeeReport(s, 'all', 'all').selfService.staffOrders, 2);
  // The payment statement finds archived payments on their day and over all time.
  assert.equal(paymentLedgerPage(s, { from: '2020-01-01', to: '2020-01-01' }).total, 1);
  assert.equal(paymentLedgerPage(s, { from: 'all', to: 'all' }).total, 2);
  assert.throws(() => paymentLedgerPage(s, { from: 'all', to: '2026-09-28' }), /tarih/);
  assert.throws(() => financialReport(s, 'all', '2026-09-28'));
  assert.throws(() => financialReport(s, '2020-01-01', 'all'));
  assert.throws(() => financialReport(s, '2020-01-01', '2026-09-28'));
  assert.deepEqual(financialReport(seed(), 'all', 'all').days, []);
});


test('large all-time legacy attribution stays account-scoped and preserves unknown campaign amounts', () => {
  const s = seed();
  submitOrder(s, { tenantId: s.tenantId, id: 'owner', role: 'owner' }, { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, { now: new Date('2020-01-01T10:00:00Z'), id: randomUUID });
  const template = s.orders[0]; s.orders = []; s.payments = [];
  for (let i = 0; i < 10000; i++) {
    const accountId = `account-${i}`, id = `order-${i}`;
    const line = { ...template.lines[0], id: 'same-line-id', campaigns: i % 2 ? [{ id: 'campaign', name: 'Kampanya' }] : undefined };
    s.orders.push({ ...template, id, accountId, lines: [line] });
    s.payments.push({ id: `payment-${i}`, accountId, amount: 3500, tendered: 3500, change: 0, commission: null, method: 'cash', createdAt: template.createdAt, ...(i % 2 ? { selections: [{ orderId: id, lineId: line.id, quantity: 1 }] } : {}) });
  }
  // A stale selection that points at another account must stay unallocated.
  s.payments.push({ ...s.payments[1], id: 'cross-account', accountId: 'missing-account' });
  s.payments.push({ ...s.payments[1], id: 'unknown-line', selections: [{ orderId: 'order-1', lineId: 'missing', quantity: 1 }] });
  const result = financialReport(s, 'all', 'all');
  assert.equal(result.regularCollected, 17500000);
  assert.equal(result.campaignCollected, 17500000);
  assert.equal(result.unallocatedCollected, 7000);
  assert.equal(result.collected, 35007000);
  assert.equal(result.days.length, 1);
  assert.equal(result.orderCount, 10000);
});

test('K-P: a calendar year is compared with the same dates of the year before, in plain words', () => {
  const now = Date.parse('2026-10-09T11:00:00Z'); // 14:00 in Istanbul
  const soFar = previousRange('2026-01-01', '2026-10-09', now)!;
  assert.deepEqual([soFar.from, soFar.to, soFar.start, soFar.end, soFar.partial, soFar.year], ['2025-01-01', '2025-10-09', dayStart('2025-01-01'), Date.parse('2025-10-09T11:00:00Z'), true, true], 'last year up to the same day and clock time');
  const whole = previousRange('2025-01-01', '2025-12-31', now)!;
  assert.deepEqual([whole.from, whole.to, whole.start, whole.end, whole.partial, whole.year], ['2024-01-01', '2024-12-31', dayStart('2024-01-01'), dayStart('2025-01-01'), undefined, true]);
  const leapDay = previousRange('2028-01-01', '2028-02-29', Date.parse('2028-02-29T11:00:00Z'))!;
  assert.deepEqual([leapDay.to, leapDay.end], ['2027-02-28', Date.parse('2027-02-28T11:00:00Z')], '29 February: the 28th the year before');
  // Other periods stay as they were: the stretch of equal length just before.
  const week = previousRange('2026-10-03', '2026-10-09', now)!;
  assert.deepEqual([week.from, week.to, week.year], ['2026-09-26', '2026-10-02', undefined]);
  assert.equal(previousRange('2026-03-01', '2026-10-09', now)!.year, undefined, 'not from 1 January');
  assert.equal(comparisonLabel(282, { partial: true, year: true }), 'geçen yılın aynı dönemine');
  assert.equal(comparisonLabel(365, { year: true }), 'önceki yıla');
  assert.deepEqual([comparisonLabel(1, { partial: true }), comparisonLabel(1, { endsToday: true }), comparisonLabel(1, {}), comparisonLabel(7, { partial: true }), comparisonLabel(30, {})], ['dünün aynı saatine', 'düne', 'önceki güne', 'önceki 7 günün aynı saatine', 'önceki 30 güne']);
});

test('K-O: the bills open right now show only for a period holding today', () => {
  const s = seed(); s.staffUsers = initialUsers(s.tenantId);
  const waiter = { tenantId: s.tenantId, id: 'garson', role: 'waiter' as const }, now = new Date('2026-10-09T11:00:00Z');
  submitOrder(s, waiter, { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 }, { now, id: randomUUID });
  assert.equal(salesOverview(s, '2026-10-09', '2026-10-09', now).openAccounts, 7000);
  assert.equal(salesOverview(s, '2026-10-03', '2026-10-09', now).openAccounts, 7000);
  assert.equal(salesOverview(s, '2026-01-01', '2026-10-09', now).openAccounts, 7000);
  assert.equal(salesOverview(s, '2023-01-01', '2023-12-31', now).openAccounts, null);
  assert.equal(salesOverview(s, '2026-10-01', '2026-10-08', now).openAccounts, null);
  assert.equal(salesOverview(s, '2026-01-01', '2026-10-09', now).previous?.year, true);
});