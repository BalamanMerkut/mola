import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { CashBook } from '../server/cash-closing.js';
import { ShiftBook } from '../server/shifts.js';
import { drain } from '../server/history.js';
import { addDays, businessDay, dayStart, DAY_MS } from '../packages/domain/business-day.js';
import { recordPayment, submitOrder, quote } from '../packages/domain/engine.js';
import { saleProducts } from '../packages/domain/campaigns.js';
import { deleteExpense, editExpense, recordExpense } from '../packages/domain/expenses.js';
import { adjustPayment } from '../packages/domain/payment-adjustments.js';
import { employeeFrom, financialFrom, overviewFrom, periodVatOf, previousRange, productsFrom, reportRange, yearTable } from '../packages/domain/reports.js';
import { spanOf } from '../packages/domain/history.js';
import type { Actor, CartLine, State } from '../packages/domain/types.js';
import type { CashClosing } from '../packages/domain/cash.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * Monthly and yearly roll-ups (server/history.ts ROLLUP_VERSION; docs/HIZ_TESTI_5_YIL.md "Faz 2"): every figure read from them
 * equals the same figure read day by day, to the kuruş, before and after any change to a past day; KDV stays at the rate of the
 * sale. The raw reference is the same store read with its clock set back, so no month is closed and nothing is rolled up.
 */
const MIN = 60_000, HOUR = 3_600_000, tenant = 'mola-demo';
const who = { owner: { tenantId: tenant, id: 'isletme', role: 'owner' } as Actor, cashier: { tenantId: tenant, id: 'kasiyer', role: 'cashier' } as Actor, waiter: { tenantId: tenant, id: 'garson', role: 'waiter' } as Actor };
/** A small seeded random source: the same café every run. */
function rng(seed: number) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }

/** A café from `first` for `days` business days: QR and staff orders, cash, card and tipped payments, expenses, gün sonu, shifts. */
function cafe(name: string, first: string, days: number) {
  const store = new Store(temp(name), [tenant]), cash = new CashBook(store), shifts = new ShiftBook(store), random = rng(7);
  let t = dayStart(first);
  store.clock = () => new Date(t);
  const ctx = () => ({ now: new Date(t), id: randomUUID });
  const apply = <T>(fn: (s: State) => T) => store.mutate(tenant, fn);
  const price = (s: State, lines: CartLine[]) => quote(saleProducts(s, new Date(t)), lines, ctx()).reduce((n, l) => n + l.total, 0);
  apply(s => { s.changeSeconds = 0; s.commissionBps = 150; s.products.find(p => p.id === 'lemonade')!.vatRate = 20; s.cashShift = { plans: { garson: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5, 6, 7] } } }; });
  const payments: { id: string; at: number; method: 'cash' | 'card' }[] = [];
  const bill = (table: string, actor: Actor, lines: CartLine[], method: 'cash' | 'card', tip = 0) => {
    const placed = apply(s => submitOrder(s, actor, { requestId: randomUUID(), tableId: table, lines, expectedTotal: price(s, lines) }, ctx()));
    t += 40 * MIN;
    const paid = apply(s => {
      const a = s.accounts.find(x => x.id === placed.accountId)!, amount = s.orders.filter(o => o.accountId === a.id).reduce((n, o) => n + o.total, 0);
      const body = { requestId: randomUUID(), accountId: a.id, version: a.version, method, amount, tendered: amount + (method === 'cash' ? tip : 0) };
      return tip ? cash.payWithTip(s, who.cashier, { ...body, tendered: method === 'card' ? amount + tip : amount + tip, tip }, ctx()) : recordPayment(s, who.cashier, body, ctx());
    });
    payments.push({ id: paid.paymentId, at: t, method });
  };
  const products = ['tea', 'herbal', 'lemonade', 'cheesecake'];
  for (let d = 0; d < days; d++) {
    const day = addDays(first, d), start = dayStart(day);
    // A shift for the waiter (sometimes late), the kitchen's first and last action ("tahmini").
    const shift = shifts.begin(tenant, { id: 'garson', name: 'Garson', role: 'waiter' }, new Date(start + 4 * HOUR + Math.floor(random() * 40) * MIN).toISOString());
    shifts.touch(tenant, 'mutfak', start + 4 * HOUR); shifts.touch(tenant, 'mutfak', start + 13 * HOUR);
    for (let i = 0; i < 3; i++) {
      t = start + (5 + i * 4) * HOUR + Math.floor(random() * 60) * MIN;
      const lines: CartLine[] = [{ productId: products[Math.floor(random() * products.length)], quantity: 1 + Math.floor(random() * 3), selections: [] }, { productId: 'tea', quantity: 1, selections: [] }];
      const actor: Actor = i === 0 ? { tenantId: tenant, id: `phone-${Math.floor(random() * 12)}`, role: 'guest', tableId: `table-${i + 1}`, epoch: 0 } : i === 1 ? who.waiter : who.owner;
      if (actor.role === 'guest') actor.epoch = store.read(tenant).tables.find(x => x.id === `table-${i + 1}`)!.epoch;
      bill(`table-${i + 1}`, actor, lines, random() < 0.5 ? 'cash' : 'card', random() < 0.3 ? 500 : 0);
    }
    shifts.finish(tenant, shift, new Date(start + 12 * HOUR).toISOString(), 'manual');
    if (d % 3 === 0) { t = start + 6 * HOUR; apply(s => recordExpense(s, who.cashier, { requestId: randomUUID(), amount: 2000 + d * 10, description: `Süt ${d}` }, ctx())); }
    // Gün sonu: a blind count, now short, now over, now exact.
    t = start + 18 * HOUR;
    const counted = apply(s => cash.count(s, who.cashier, { requestId: randomUUID(), mode: 'final', counted: [0, 5000, 100_000][d % 3] }, ctx()));
    apply(s => cash.finish(s, who.cashier, { id: counted.id, note: 'sayım' }, ctx()));
  }
  // Every bill settles (a day later the snapshot holds nothing closed).
  t = dayStart(addDays(first, days)) + 2 * DAY_MS; apply(() => {});
  return { store, cash, shifts, payments, at: (v: number) => { t = v; }, now: () => t, ctx, apply };
}

/** Every report figure of [from, to] the screens and exports show, from `store` as it reads now. */
function figures(c: ReturnType<typeof cafe>, from: string, to: string, now: number) {
  const { store } = c, s = store.read(tenant), { start, end } = reportRange(from, to);
  const span = store.history.reportSpan(tenant, s, start, end), before = previousRange(from, to, now);
  const overview = overviewFrom({ from, to, start, end, today: businessDay(now), days: span, previous: before && { from: before.from, to: before.to, partial: before.partial, days: store.history.reportSpan(tenant, s, before.start, before.end) }, openBalance: 0, products: s.products });
  const financial = financialFrom(span, from, to, start, end, store.history.adjustments(tenant, start, end), store.history.expenses(tenant, start, end));
  const employees = employeeFrom(span.total, s.staffUsers, from, to), t = span.total;
  const staff = c.shifts.staffSpan(tenant, s, from, to, now, c.cash);
  return JSON.parse(JSON.stringify({
    overview, financial, products: productsFrom(span, s.products), employees: employees.rows, qr: [employees.selfService.qrOrders, employees.selfService.staffOrders],
    vat: periodVatOf(s, t), campaigns: [...t.campaigns].map(([k, m]) => [k, [...m]]), variants: [...t.variants].map(([k, m]) => [k, [...m]]), returned: [...t.returned],
    points: [...span.days].filter(([, p]) => p.active), cash: c.cash.cashSpan(tenant, from, to), staff: { users: [...staff.users], tips: staff.tips, unassigned: ['equal', 'hours', 'orders'].map(r => staff.unassigned(r as 'equal')) },
  }));
}
/** The same figures read from roll-ups (the café's clock) and day by day (the clock set back before the first day). */
function same(c: ReturnType<typeof cafe>, ranges: [string, string][], label: string, raw: number) {
  const now = c.now();
  for (const [from, to] of ranges) {
    c.at(now); const rolled = figures(c, from, to, now);
    c.at(raw); const daily = figures(c, from, to, now);
    c.at(now);
    assert.deepEqual(rolled, daily, `${label}: ${from}–${to}`);
  }
}
const rolledMonths = (store: Store) => (store.db.prepare("SELECT kind||':'||month AS k FROM history_months WHERE tenant=? ORDER BY k").all(tenant) as { k: string }[]).map(r => r.k);

test('roll-ups: every report figure from monthly and yearly roll-ups equals the day-by-day figure, to the kuruş, also after past days change', async () => {
  const c = cafe('rollups', '2025-11-24', 100), { store } = c, raw = dayStart('2025-11-01');
  c.at(dayStart('2026-04-15') + 6 * HOUR);
  const random = rng(11), ranges: [string, string][] = [['all', 'all'], ['2025-01-01', '2025-12-31'], ['2026-01-01', '2026-03-31'], ['2025-12-01', '2025-12-31'], ['2026-02-01', '2026-02-28'], ['2025-11-24', '2026-03-03']];
  for (let i = 0; i < 8; i++) { const a = addDays('2025-11-20', Math.floor(random() * 100)), b = addDays(a, Math.floor(random() * 90)); ranges.push([a, b]); }
  same(c, ranges, 'built', raw);
  // Closed months and the closed year came from roll-ups; the running month never does.
  assert.ok(rolledMonths(store).includes('sales:2025-12') && rolledMonths(store).includes('cash:2026-01') && rolledMonths(store).includes('staff:2026-02'), rolledMonths(store).join(' '));
  assert.ok(store.history.hasRollup(tenant, 'sales', '2025'), 'the closed year 2025 is one roll-up');
  assert.ok(!rolledMonths(store).some(k => k.endsWith('2026-04')), 'the running month is read by day');

  // Past days change: an old bill's refund, a method correction, a back-dated, an edited and a deleted expense, a closing's
  // correction, a shift corrected onto another day. Each drops its month's (and year's) roll-ups; the figures stay equal.
  const owner = who.owner, old = c.payments.find(p => businessDay(p.at) === '2025-12-10')!, other = c.payments.find(p => businessDay(p.at) === '2026-01-20' && p.method === 'cash')!;
  c.apply(s => adjustPayment(s, owner, { requestId: randomUUID(), paymentId: old.id, revision: 0, kind: 'refund', amount: 700, method: 'cash', commission: 0, reason: 'Soğuk servis' }, c.ctx(), store.history.paymentForAdjustment(tenant, s, old.id)));
  assert.ok(!store.history.hasRollup(tenant, 'sales', '2025') && store.history.hasRollup(tenant, 'sales', '2026-01'), 'a refund given today counts today and on its payment day (December): 2025 goes, January stays');
  c.apply(s => adjustPayment(s, owner, { requestId: randomUUID(), paymentId: other.id, revision: 0, kind: 'method', amount: 0, method: 'card', commission: 30, reason: 'Yanlış yöntem' }, c.ctx(), store.history.paymentForAdjustment(tenant, s, other.id)));
  assert.ok(!store.history.hasRollup(tenant, 'sales', '2026-01'), 'a method correction drops its payment\'s month');
  c.apply(s => recordExpense(s, owner, { requestId: randomUUID(), amount: 123_45, description: 'Geriye tarihli kira', day: '2026-02-03', method: 'transfer' }, c.ctx()));
  const expense = store.history.expenses(tenant, dayStart('2025-12-03'), dayStart('2025-12-04'))[0];
  c.apply(s => editExpense(s, owner, { requestId: randomUUID(), id: expense.id, version: 0, amount: expense.amount + 999, description: 'Süt (düzeltildi)', day: '2025-11-26', method: 'cash' }, c.ctx(), store.history.expense(tenant, expense.id)));
  const gone = store.history.expenses(tenant, dayStart('2026-01-05'), dayStart('2026-01-06'))[0];
  c.apply(s => deleteExpense(s, owner, { requestId: randomUUID(), id: gone.id, version: 0 }, c.ctx(), store.history.expense(tenant, gone.id)));
  const closing = c.cash.days<CashClosing>(tenant, ['closing'], '2026-02-14', '2026-02-14')[0];
  c.apply(s => c.cash.correct(s, owner, { requestId: randomUUID(), closingId: closing.id, amount: -2500, note: 'Sonradan bulunan eksik' }, c.ctx()));
  assert.ok(!store.history.hasRollup(tenant, 'cash', '2026-02') && !store.history.hasRollup(tenant, 'staff', '2026-02'));
  const moved = c.shifts.range(tenant, '2026-01-31', '2026-01-31')[0];
  c.shifts.correct(tenant, moved, 'İşletme sahibi', { startAt: new Date(dayStart('2026-02-01') + 5 * HOUR).toISOString(), endAt: new Date(dayStart('2026-02-01') + 9 * HOUR).toISOString(), note: 'Yanlış gün' }, new Date(c.now()).toISOString());
  assert.ok(!store.history.hasRollup(tenant, 'staff', '2026-01'), 'the corrected shift\'s old month goes too');
  same(c, ranges, 'after past changes', raw);

  // A bill opened on 2 March and still open (on the floor) keeps March out of the roll-ups, read by day with the floor;
  // paid on 15 April and settled, it drops March's roll-ups and the figures stay equal.
  const later = dayStart('2026-04-15') + 6 * HOUR, lines: CartLine[] = [{ productId: 'tea', quantity: 2, selections: [] }];
  c.at(dayStart('2026-03-02') + 9 * HOUR);
  const open = c.apply(s => submitOrder(s, owner, { requestId: randomUUID(), tableId: 'table-9', lines, expectedTotal: quote(saleProducts(s, new Date(c.now())), lines, c.ctx()).reduce((n, l) => n + l.total, 0) }, c.ctx()));
  c.at(later);
  same(c, [['all', 'all'], ['2026-03-01', '2026-03-31'], ['2026-01-01', '2026-04-15']], 'floor', raw);
  c.apply(s => { const a = s.accounts.find(x => x.id === open.accountId)!, amount = s.orders.filter(o => o.accountId === a.id).reduce((n, o) => n + o.total, 0); return recordPayment(s, who.cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount, tendered: amount }, c.ctx()); });
  c.at(later + 2 * DAY_MS); c.apply(() => {});
  assert.equal(store.read(tenant).archives.length + store.read(tenant).accounts.length, 0, 'settled');
  same(c, [['all', 'all'], ['2026-03-01', '2026-03-31'], ['2026-01-01', '2026-04-17']], 'settled', raw);
});

test('roll-ups: KDV stays at the rate each line was sold with; a later rate change never changes a past day, a month or a year', () => {
  const store = new Store(temp('rollup-vat'), [tenant]);
  let t = dayStart('2026-01-10') + 6 * HOUR;
  store.clock = () => new Date(t);
  const ctx = () => ({ now: new Date(t), id: randomUUID }), owner = who.owner;
  const sell = (productId: string, quantity: number, stamp = true) => store.mutate(tenant, s => {
    const lines: CartLine[] = [{ productId, quantity, selections: [] }], total = quote(saleProducts(s, ctx().now), lines, ctx()).reduce((n, l) => n + l.total, 0);
    const table = s.tables.find(x => !x.accountId)!, r = submitOrder(s, owner, { requestId: randomUUID(), tableId: table.id, lines, expectedTotal: total }, ctx());
    // A line from before this version carries no rate (the 5-year data, any café's old bills).
    if (!stamp) for (const o of s.orders) if (o.id === r.orderId) for (const l of o.lines) delete l.vatRate;
    const a = s.accounts.find(x => x.id === r.accountId)!;
    return recordPayment(s, who.cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'card', amount: total, tendered: total }, ctx());
  });
  // January: lemonade at %20 (stamped), cheesecake at %10 without a stamp (an old line: the rate frozen when this version came).
  store.mutate(tenant, s => { s.products.find(p => p.id === 'lemonade')!.vatRate = 20; });
  const first = sell('lemonade', 4); sell('cheesecake', 2, false);
  assert.equal(store.read(tenant).orders.at(-2)?.lines[0].vatRate, 20, 'a new line carries its rate');
  t = dayStart('2026-02-02') + 6 * HOUR; store.mutate(tenant, () => {});
  const vatOf = (from: string, to: string) => { const s = store.read(tenant), { start, end } = reportRange(from, to); return JSON.parse(JSON.stringify(periodVatOf(s, store.history.reportSpan(tenant, s, start, end).total))); };
  const jan = vatOf('2026-01-10', '2026-01-10'), month = vatOf('2026-01-01', '2026-01-31'), year = vatOf('2026-01-01', '2026-02-02');
  assert.deepEqual(jan.rows.map((r: { rate: number }) => r.rate), [10, 20]);
  // The owner changes both rates (and the default) today; February sells at the new ones.
  store.mutate(tenant, s => { s.vat = { rates: [1, 10, 20], default: 1 }; s.products.find(p => p.id === 'lemonade')!.vatRate = 10; s.products.find(p => p.id === 'cheesecake')!.vatRate = 20; });
  sell('lemonade', 1);
  assert.equal(store.read(tenant).orders.at(-1)?.lines[0].vatRate, 10);
  assert.deepEqual(vatOf('2026-01-10', '2026-01-10'), jan, 'the day');
  assert.deepEqual(vatOf('2026-01-01', '2026-01-31'), month, 'January (a roll-up once February runs)');
  assert.ok(store.history.hasRollup(tenant, 'sales', '2026-01'));
  // Rebuilt after a change to January (a refund of a January bill): still the rates of the sale.
  store.mutate(tenant, s => adjustPayment(s, owner, { requestId: randomUUID(), paymentId: first.paymentId, revision: 0, kind: 'refund', amount: 100, method: 'card', commission: 0, reason: 'İade' }, ctx(), store.history.paymentForAdjustment(tenant, s, first.paymentId)));
  assert.ok(!store.history.hasRollup(tenant, 'sales', '2026-01'));
  assert.deepEqual(vatOf('2026-01-01', '2026-01-31').rows.map((r: { rate: number }) => r.rate), [10, 20], 'rebuilt January keeps %10 and %20');
  assert.deepEqual(vatOf('2026-01-10', '2026-01-10').rows.map((r: { rate: number }) => r.rate), [10, 20]);
  void year;
  store.close();
});

test('roll-ups: "Tümü" as years (HTTP), the year list, distinct QR guests "yaklaşık", and a cold build in steps', async t => {
  const c = cafe('rollup-years', '2024-12-20', 50), { store } = c;
  c.at(dayStart('2026-03-10') + 6 * HOUR);
  licensed(store);
  const server = createServer(createApp(store, () => new Date(c.now())));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let cookie = '';
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
    return { status: r.status, data: await r.json() as any };
  };
  assert.equal((await call('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  // Cold: nothing rolled up yet. The steps build every closed month and year a little at a time.
  assert.equal(rolledMonths(store).length, 0);
  const s = store.read(tenant), steps = store.history.prepare(tenant, s, -Infinity, Infinity);
  let n = 0; for (let r = steps.next(); !r.done; r = steps.next()) n++;
  assert.ok(n >= 50, `${n} steps: one per day read`);
  assert.ok(store.history.hasRollup(tenant, 'sales', '2024') && store.history.hasRollup(tenant, 'sales', '2025-01'), 'the closed year 2024 and January 2025');
  // A year keeps a point for each of its days, the months before the first record too (charts and the daily Excel sheet).
  assert.equal(store.history.rollup<{ days: unknown[] }>(tenant, 'sales', '2024')!.days.length, 366);
  const years = (await call('/staff/reports/years')).data;
  assert.deepEqual(years.years, ['2026', '2025', '2024']);
  assert.deepEqual(years.table.years.map((y: { year: string }) => y.year), ['2026', '2025', '2024'], 'newest first');
  for (const k of ['sales', 'refunds', 'expenses', 'kept', 'vat', 'orders'] as const) assert.equal(years.table.total[k], years.table.years.reduce((v: number, y: Record<string, number>) => v + y[k], 0), `total ${k}`);
  const all = (await call('/staff/reports/overview?from=all&to=all')).data;
  assert.equal(years.table.total.sales, all.sales); assert.equal(years.table.total.kept, all.kept);
  // The same per year as the year itself.
  for (const y of years.table.years) {
    const to = y.year === '2026' ? businessDay(c.now()) : `${y.year}-12-31`, one = (await call(`/staff/reports/overview?from=${y.year}-01-01&to=${to}`)).data;
    assert.deepEqual([one.sales, one.refunds, one.expenses, one.kept], [y.sales, y.refunds, y.expenses, y.kept], y.year);
  }
  // "Tümü" KDV is the sum of its years.
  const simple = (await call('/staff/reports/simple?from=all&to=all')).data;
  assert.equal(simple.vat.total.vat, years.table.total.vat);
  // Distinct QR guests add up months: "yaklaşık".
  const employees = (await call('/staff/reports/employees?from=all&to=all')).data, january = (await call('/staff/reports/employees?from=2025-01-01&to=2025-01-31')).data;
  assert.equal(employees.selfService.approximate, true); assert.equal(january.selfService.approximate, undefined, 'one month alone is exact');
  // The accountant's "Tümü": a sheet of years, one per year, every day, KDV, products; never the records one by one.
  const xlsx = await fetch(`${base}/staff/reports/accountant.xlsx?from=all&to=all`, { headers: { Cookie: cookie } });
  assert.equal(xlsx.status, 200);
  const text = Buffer.from(await xlsx.arrayBuffer());
  assert.ok(text.length > 1000);
  // Kasa kapanışları: the newest page, every closing counted.
  const closings = (await call('/staff/reports/cash-closings?from=all&to=all')).data;
  assert.equal(closings.closings.length, 50); assert.equal(closings.closingCount, 50); assert.equal(closings.totals.count, 50);
  const page = (await call('/staff/reports/cash-closings?from=all&to=all&limit=10')).data;
  assert.equal(page.closings.length, 10); assert.equal(page.closingCount, 50); assert.deepEqual(page.totals, closings.totals); assert.deepEqual(page.people, closings.people);
  assert.equal(page.closings[0].day, '2025-02-07', 'newest first');
  // A changed roll-up format reads as missing and is built again.
  store.db.prepare("UPDATE history_months SET version='0.0' WHERE tenant=? AND kind='sales' AND month='2025-01'").run(tenant);
  assert.ok(!store.history.hasRollup(tenant, 'sales', '2025-01'));
  drain(store.history.prepare(tenant, store.read(tenant), dayStart('2025-01-01'), dayStart('2025-02-01')));
  assert.ok(store.history.hasRollup(tenant, 'sales', '2025-01'));
});

test('roll-ups: the domain year table adds up and a span from days equals one from roll-ups for the plain state', () => {
  const s = { vat: undefined, products: [] } as unknown as Pick<State, 'vat' | 'vatLegacy' | 'products'>;
  const table = yearTable([], s);
  assert.deepEqual(table.years, []); assert.equal(table.total.sales, 0);
  assert.equal(spanOf(new Map()).days.size, 0);
});
