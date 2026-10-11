import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { addDays, businessDay, dayStart } from '../packages/domain/business-day.js';
import { reportRange } from '../packages/domain/reports.js';
import { recordPayment, submitOrder } from '../packages/domain/engine.js';
import { stateRecords, summarize } from '../packages/domain/history.js';
import { seed } from '../server/seed.js';

// Date edges found by the five-year test (docs/HIZ_TESTI_5_YIL.md): leap day, the year change and the 05:00 turn together,
// a café computer set to another time zone, and a table open across midnight and the gün sonu.

test('29 February 2028 and the year change keep the 05:00 business day', () => {
  // 04:59:59 on the leap day is still the evening of 28 February; 05:00 starts 29 February; its evening runs to 1 March 04:59.
  assert.equal(businessDay('2028-02-29T01:59:59.999Z'), '2028-02-28');
  assert.equal(businessDay('2028-02-29T02:00:00.000Z'), '2028-02-29');
  assert.equal(businessDay('2028-03-01T01:59:59.999Z'), '2028-02-29');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29'); assert.equal(addDays('2028-02-29', 1), '2028-03-01'); assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  const leap = reportRange('2028-02-29', '2028-02-29');
  assert.equal(leap.end - leap.start, 86400000, 'a leap day is a whole 24-hour business day');
  // New Year's night: 00:30 and 04:59 on 1 January are still 31 December's business day (and its year).
  assert.equal(businessDay('2027-12-31T21:30:00Z'), '2027-12-31');
  assert.equal(businessDay('2028-01-01T01:59:59Z'), '2027-12-31');
  assert.equal(businessDay('2028-01-01T02:00:00Z'), '2028-01-01');
  // A leap year fits in one report (366 days); a range one day longer is refused with the usual message.
  const year = reportRange('2028-01-01', '2028-12-31');
  assert.equal((year.end - year.start) / 86400000, 366);
  assert.throws(() => reportRange('2027-12-31', '2028-12-31'), /366 gün/);
});

test('business days do not depend on the computer\'s time zone setting', () => {
  // The café PC may be set to any zone (a reinstalled Windows on UTC, a laptop from abroad): the same instants, the same days.
  const instants = ['2028-02-29T01:59:59.999Z', '2028-02-29T02:00:00.000Z', '2027-12-31T21:30:00Z', '2026-03-29T00:30:00Z', '2026-10-25T01:30:00Z'];
  const here = JSON.stringify(instants.map(at => [businessDay(at), dayStart(businessDay(at))]));
  const module = pathToFileURL(resolve('packages/domain/business-day.ts')).href;
  const code = `import { businessDay, dayStart } from ${JSON.stringify(module)}; console.log(JSON.stringify(${JSON.stringify(instants)}.map(at => [businessDay(at), dayStart(businessDay(at))])));`;
  for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/London']) {
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), here, `TZ=${zone}`);
  }
});

test('a table open across midnight and paid after the gün sonu belongs to the evening it was served', () => {
  const s = seed('gece'), ctx = (iso: string) => ({ now: new Date(iso), id: randomUUID });
  const waiter = { tenantId: 'gece', id: 'garson', role: 'waiter' as const }, cashier = { tenantId: 'gece', id: 'kasiyer', role: 'cashier' as const };
  s.staffUsers = [{ id: 'garson', username: 'garson', name: 'Garson', role: 'waiter', active: true, version: 1, salt: '', hash: '', createdAt: '' }, { id: 'kasiyer', username: 'kasiyer', name: 'Kasiyer', role: 'cashier', active: true, version: 1, salt: '', hash: '', createdAt: '' }];
  // 23:30 on 29 February 2028 (Turkish time) the table orders; it pays at 03:10, after the 01:30 gün sonu.
  const order = submitOrder(s, waiter, { requestId: randomUUID(), tableId: s.tables[0].id, lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 }, ctx('2028-02-29T20:30:00Z'));
  const account = s.accounts.find(a => a.id === order.accountId)!;
  recordPayment(s, cashier, { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'cash', amount: 7000, tendered: 10000 }, ctx('2028-03-01T00:10:00Z'));
  const days = summarize(stateRecords(s), dayStart('2028-02-28'), dayStart('2028-03-02'));
  assert.equal(days.get('2028-02-29')?.cash, 7000, 'the night\'s payment is on 29 February');
  assert.equal(days.get('2028-03-01')?.cash ?? 0, 0);
  assert.equal(days.get('2028-02-29')?.orders, 1);
});
