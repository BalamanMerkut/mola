import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { addDays, businessDay, DAY_START_HOUR, dayStart, midnightToDayStart } from '../packages/domain/business-day.js';
import { cashDayOf } from '../packages/domain/cash.js';
import { stockDay } from '../packages/domain/stock.js';
import { expenseAt } from '../packages/domain/expense-rules.js';
import { reportRange } from '../packages/domain/reports.js';
import { licensed, temp } from './merkez-fixture.js';

test('one business day for everything: 05:00–05:00 Türkiye, the cash day, the stock day and the report range agree', () => {
  assert.equal(DAY_START_HOUR, 5);
  for (const at of ['2026-10-04T20:00:00Z', '2026-10-04T21:00:00Z', '2026-10-05T01:59:59.999Z']) {
    assert.equal(businessDay(at), '2026-10-04', `${at}: 23:00, 00:00 and 04:59 belong to the evening of 4 October`);
    assert.equal(cashDayOf(at), businessDay(at)); assert.equal(stockDay(Date.parse(at)), businessDay(at));
  }
  assert.equal(businessDay('2026-10-05T02:00:00Z'), '2026-10-05', '05:00 starts the next day');
  assert.equal(new Date(dayStart('2026-10-04')).toISOString(), '2026-10-04T02:00:00.000Z');
  const { start, end } = reportRange('2026-10-04', '2026-10-04');
  assert.deepEqual([new Date(start).toISOString(), new Date(end).toISOString()], ['2026-10-04T02:00:00.000Z', '2026-10-05T02:00:00.000Z']);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  // An automatic expense written by an older version at 00:00 of its day stays on that day (the rent of 1 Ekim).
  assert.equal(midnightToDayStart('2026-09-30T21:00:00.000Z'), '2026-10-01T02:00:00.000Z');
  assert.equal(midnightToDayStart('2026-09-30T21:00:01.000Z'), '2026-09-30T21:00:01.000Z', 'any other time stays as it is');
  assert.equal(businessDay(expenseAt({ createdAt: '2026-10-01T05:00:00Z', spentAt: '2026-09-30T21:00:00.000Z', auto: { ruleId: 'r', day: '2026-10-01' } })), '2026-10-01');
  assert.equal(businessDay(expenseAt({ createdAt: '2026-09-30T21:00:00.000Z' })), '2026-09-30', 'a manual expense at 00:00 keeps its time: the night before');
});

async function cafe(t: { after: (fn: () => Promise<void>) => void }, start: string) {
  const directory = temp('business-day'), store = new Store(directory); licensed(store);
  let clock = new Date(start);
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client() {
    let cookie = '';
    return async (path: string, body?: unknown) => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
      return { status: r.status, data: await r.json() as any };
    };
  }
  return { store, client, set: (iso: string) => { clock = new Date(iso); } };
}

test('a night that runs past midnight: sales 23:00–02:00, the day closed at 02:00, and every report tab shows it under "Bugün"', async t => {
  const c = await cafe(t, '2026-10-04T15:00:00Z'); // 18:00
  const owner = c.client(), cashier = c.client(), waiter = c.client();
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD }); await cashier('/login', { username: 'kasiyer', password: DEMO_PASSWORD }); await waiter('/login', { username: 'garson', password: DEMO_PASSWORD });
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 10000 })).status, 200);
  const tables = (await owner('/staff/state')).data.tables;
  const sell = async (at: string, table: number, method: 'cash' | 'card') => {
    c.set(at);
    const placed = await waiter('/staff/orders', { requestId: randomUUID(), tableId: tables[table].id, lines: [{ productId: 'tea', quantity: 4, selections: [] }], expectedTotal: 14000 });
    assert.equal(placed.status, 200, JSON.stringify(placed.data));
    const account = (await cashier('/staff/state')).data.tables.find((x: any) => x.account?.id === placed.data.accountId).account;
    const paid = await cashier('/staff/payments', { requestId: randomUUID(), accountId: account.id, version: account.version, method, amount: 14000, tendered: 14000 });
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
  };
  await sell('2026-10-04T20:00:00Z', 0, 'cash'); // 23:00
  await sell('2026-10-04T22:30:00Z', 1, 'card'); // 01:30 the next calendar day
  c.set('2026-10-04T22:40:00Z'); // 01:40
  assert.equal((await cashier('/staff/expenses', { requestId: randomUUID(), amount: 2500, description: 'Gece buz' })).status, 200);
  c.set('2026-10-04T22:50:00Z'); // 01:50
  const rows = (await owner('/staff/payment-adjustments?from=2026-10-04&to=2026-10-04')).data.rows;
  assert.equal(rows.length, 2, 'İade ve düzeltme: both payments are on the evening\'s day');
  const cashRow = rows.find((r: any) => r.method === 'cash');
  assert.equal((await owner('/staff/payment-adjustments', { requestId: randomUUID(), paymentId: cashRow.id, revision: 0, kind: 'refund', amount: 1000, method: 'cash', commission: 0, reason: 'Eksik' })).status, 200);

  // 02:00: the cashier closes the day; at 02:10 "Bugün" is still 4 October everywhere.
  c.set('2026-10-04T23:00:00Z');
  const count = (await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 10000 + 14000 - 2500 - 1000 })).data;
  assert.equal(count.day, '2026-10-04'); assert.equal((await owner(`/staff/cash/closing/${count.id}`)).data.closing.difference, 0, 'the owner reads the result; the cashier counted blind');
  assert.equal((await cashier('/staff/cash/finish', { id: count.id })).status, 200);
  c.set('2026-10-04T23:10:00Z');
  const today = businessDay(Date.parse('2026-10-04T23:10:00Z')), q = `from=${today}&to=${today}`;
  assert.equal(today, '2026-10-04');

  const overview = (await owner(`/staff/reports/overview?${q}`)).data;
  assert.deepEqual([overview.sales, overview.cash, overview.card, overview.expenses, overview.refunds, overview.orders], [28000, 14000, 14000, 2500, 1000, 2]);
  assert.deepEqual(overview.hourly.filter((h: any) => h.orders).map((h: any) => h.hour), [1, 23], 'the hours of the night');
  assert.equal((await owner(`/staff/reports/products?${q}`)).data.total, 28000, 'Ürünler');
  const financial = (await owner(`/staff/reports/financial?${q}`)).data;
  assert.deepEqual([financial.collected, financial.expenseTotal, financial.refundTotal, financial.expenses.length], [28000, 2500, 1000, 1], 'Giderler and the refund');
  assert.equal((await owner(`/staff/payment-adjustments?${q}`)).data.rows.length, 2, 'İade ve düzeltme');
  assert.equal((await owner(`/staff/reports/profit?${q}`)).data.totals.revenue, 28000, 'Kârlılık');
  const employees = (await owner(`/staff/reports/employees?${q}`)).data;
  assert.equal(employees.rows.find((r: any) => r.id === 'garson').orders, 2, 'Çalışanlar');
  const closings = (await owner(`/staff/reports/cash-closings?${q}`)).data;
  assert.equal(closings.closings.length, 1); assert.equal(closings.closings[0].figures.cashSales, 14000, 'Kasa kapanışları');
  const staff = (await owner(`/staff/reports/staff-shifts?${q}`)).data;
  assert.equal(staff.rows.find((r: any) => r.id === 'garson').sales, 28000, 'Personel ve bahşiş');
  const reservations = (await owner(`/staff/reports/reservations?${q}`));
  assert.equal(reservations.status, 200); assert.equal(reservations.data.from, today, 'Rezervasyon reads the same day');
  // The calendar day of 5 October holds nothing from that night.
  const next = (await owner('/staff/reports/overview?from=2026-10-05&to=2026-10-05')).data;
  assert.deepEqual([next.sales, next.expenses, next.refunds, next.orders], [0, 0, 0, 0]);
  assert.equal((await owner('/staff/payment-adjustments?from=2026-10-05&to=2026-10-05')).data.rows.length, 0);
  assert.equal((await owner('/staff/reports/cash-closings?from=2026-10-05&to=2026-10-05')).data.closings.length, 0);

  // Older stored rows keep their calendar day (the expense of 01:40 was filed under 5 October before this version); the
  // report reads one day wider and still finds it on the evening of 4 October.
  c.store.db.prepare("UPDATE history_ledger SET day='2026-10-05' WHERE kind='expense'").run();
  c.store.db.prepare('DELETE FROM history_days').run();
  const old = (await owner(`/staff/reports/financial?${q}`)).data;
  assert.deepEqual([old.expenseTotal, old.refundTotal], [2500, 1000]);
  assert.equal((await owner('/staff/reports/financial?from=2026-10-05&to=2026-10-05')).data.expenseTotal, 0);
});
