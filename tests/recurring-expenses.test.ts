import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { RecurringExpenses } from '../server/recurring-expenses.js';
import { autoExpenseId, dueDays, falls, nextOccurrence, occurrences, repeatText, runRecurring, saveRecurring, type RecurringExpense } from '../packages/domain/recurring-expenses.js';
import { seed } from '../server/seed.js';
import type { Actor } from '../packages/domain/types.js';
import { bucketize, bucketKind, bucketTitle, weekStart } from '../src/reportBuckets.js';
import { licensed, temp } from './merkez-fixture.js';

const rule = (r: Partial<RecurringExpense> & Pick<RecurringExpense, 'repeat'>): RecurringExpense => ({ id: 'r1', name: 'Kira', amount: 1500000, method: 'transfer', start: '2026-01-01', active: true, createdAt: '', updatedAt: '', version: 1, doneThrough: '2025-12-31', ...r });

test('schedules: month end falls on the last day, 29 February on the 28th, every N days from the start, weekly by weekday', () => {
  const monthly31 = rule({ repeat: { every: 'month', day: 31 } });
  assert.deepEqual(occurrences(monthly31, '2026-01-01', '2026-06-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
  assert.deepEqual(occurrences(rule({ repeat: { every: 'month', day: 30 } }), '2028-02-01', '2028-03-31'), ['2028-02-29', '2028-03-30'], 'a leap February ends on the 29th');
  assert.deepEqual(occurrences(rule({ repeat: { every: 'month', day: 1 } }), '2026-10-02', '2026-12-31'), ['2026-11-01', '2026-12-01']);
  const leapDay = rule({ repeat: { every: 'year', month: 2, day: 29 }, start: '2026-01-01' });
  assert.deepEqual(occurrences(leapDay, '2026-01-01', '2028-12-31'), ['2026-02-28', '2027-02-28', '2028-02-29']);
  assert.deepEqual(occurrences(rule({ repeat: { every: 'year', month: 10, day: 15 } }), '2026-01-01', '2027-12-31'), ['2026-10-15', '2027-10-15']);
  const fortnight = rule({ repeat: { every: 'days', days: 14 }, start: '2026-10-04' });
  assert.deepEqual(occurrences(fortnight, '2026-09-01', '2026-11-30'), ['2026-10-04', '2026-10-18', '2026-11-01', '2026-11-15', '2026-11-29'], 'counted from the start day, never before it');
  assert.equal(falls({ every: 'days', days: 3 }, '2026-10-04', '2026-10-03'), false);
  const mondays = rule({ repeat: { every: 'week', weekday: 1 }, start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(occurrences(mondays, '2026-09-01', '2026-12-31'), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'], 'the end day closes it');
  assert.equal(nextOccurrence(mondays, '2026-10-27'), null, 'ended');
  assert.equal(nextOccurrence({ ...mondays, active: false }, '2026-10-01'), null, 'paused');
  assert.equal(nextOccurrence({ ...monthly31, doneThrough: '2026-04-30' }, '2026-04-01'), '2026-05-31', 'what is done is not next');
  assert.equal(repeatText({ every: 'month', day: 31 }), 'Her ayın 31. günü (kısa aylarda son gün)');
  assert.equal(repeatText({ every: 'week', weekday: 7 }), 'Her hafta Pazar');
  assert.equal(repeatText({ every: 'year', month: 1, day: 15 }), 'Her yıl 15 Ocak');
});

test('automatic expenses: from today on, Turkish day, catch up missed days once, never twice, paused days stay empty', () => {
  const s = seed('mola-demo'), actor: Actor = { tenantId: 'mola-demo', id: 'owner-1', role: 'owner' };
  let n = 0; const ctx = (now: string) => ({ now: new Date(now), id: () => `rule-${++n}` });
  // Made on 4 October (Turkish time) with a start in the past: September is never filled in.
  const kira = saveRecurring(s, actor, { requestId: 'kira-rule-1', name: ' Kira ', amount: 1500000, method: 'transfer', repeat: { every: 'month', day: 5 }, start: '2026-09-01', active: true }, ctx('2026-10-04T08:00:00Z'));
  assert.equal(kira.name, 'Kira'); assert.equal(kira.doneThrough, '2026-10-03');
  const cash = saveRecurring(s, actor, { requestId: 'cash-rule-1', name: 'Temizlik', amount: 50000, method: 'cash', repeat: { every: 'days', days: 7 }, start: '2026-10-04', active: true }, ctx('2026-10-04T08:00:00Z'));
  assert.throws(() => saveRecurring(s, actor, { requestId: 'bad-rule-01', name: 'x', amount: 0, method: 'cash', repeat: { every: 'month', day: 5 }, start: '2026-10-04', active: true }, ctx('2026-10-04T08:00:00Z')), /Tutarı/);
  assert.throws(() => saveRecurring(s, actor, { requestId: 'bad-rule-02', name: 'x', amount: 1, method: 'cash', repeat: { every: 'year', month: 2, day: 30 }, start: '2026-10-04', active: true }, ctx('2026-10-04T08:00:00Z')), /sıklığını/);
  assert.throws(() => saveRecurring(s, actor, { requestId: 'bad-rule-03', name: 'x', amount: 1, method: 'cash', repeat: { every: 'month', day: 5 }, start: '2026-10-04', end: '2026-10-01', active: true }, ctx('2026-10-04T08:00:00Z')), /Bitiş/);
  assert.throws(() => saveRecurring(s, { ...actor, role: 'cashier' }, { requestId: 'bad-rule-04', name: 'x', amount: 1, method: 'cash', repeat: { every: 'month', day: 5 }, start: '2026-10-04', active: true }, ctx('2026-10-04T08:00:00Z')), /yetkiniz/);

  // 4 October: only the weekly cash one is due (its start day).
  let made = runRecurring(s, new Date('2026-10-04T08:00:00Z'));
  assert.deepEqual(made.map(m => [m.expense.description, m.expense.auto!.day]), [['Temizlik', '2026-10-04']]);
  assert.equal(made[0].expense.id, autoExpenseId(cash.id, '2026-10-04'));
  assert.equal(made[0].expense.spentAt, '2026-10-04T02:00:00.000Z', '05:00 in Turkey: the start of its business day');
  assert.equal(runRecurring(s, new Date('2026-10-04T20:59:00Z')).length, 0, 'the same day again: nothing');
  // 00:30 on 5 October in Turkey still belongs to the business day of 4 October (it turns at 05:00).
  assert.equal(runRecurring(s, new Date('2026-10-04T21:30:00Z')).length, 0, 'after midnight, before 05:00: not yet');
  // 05:30 on 5 October in Turkey: the rent is due.
  made = runRecurring(s, new Date('2026-10-05T02:30:00Z'));
  assert.deepEqual(made.map(m => [m.expense.description, m.expense.auto!.day]), [['Kira', '2026-10-05']]);
  // The computer was off until 20 December: every missed day is caught up, once, in date order.
  made = runRecurring(s, new Date('2026-12-20T09:00:00Z'));
  assert.deepEqual(made.filter(m => m.rule.id === kira.id).map(m => m.expense.auto!.day), ['2026-11-05', '2026-12-05']);
  assert.deepEqual(made.filter(m => m.rule.id === cash.id).map(m => m.expense.auto!.day), ['2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06', '2026-12-13', '2026-12-20']);
  assert.equal(runRecurring(s, new Date('2026-12-20T10:00:00Z')).length, 0);
  const ids = s.expenses!.map(e => e.id); assert.equal(new Set(ids).size, ids.length, 'no day twice');
  // Even with the rule's own mark lost, a day already stored elsewhere (long-term history) is not recorded again.
  const k = s.recurringExpenses!.find(r => r.id === kira.id)!; k.doneThrough = '2026-10-01';
  assert.equal(runRecurring(s, new Date('2026-12-20T10:00:00Z'), id => ids.includes(id)).length, 0);
  assert.equal(k.doneThrough, '2026-12-20'); assert.equal(k.count, 3); assert.equal(k.last!.day, '2026-12-05');

  // Paused over January, switched on again on 10 February: January's 5th is not filled in; February's 5th was paused too.
  saveRecurring(s, actor, { requestId: 'kira-pause-1', id: kira.id, version: 1, name: 'Kira', amount: 1500000, method: 'transfer', repeat: { every: 'month', day: 5 }, start: '2026-09-01', active: false }, ctx('2026-12-31T08:00:00Z'));
  assert.equal(runRecurring(s, new Date('2027-01-20T08:00:00Z')).filter(m => m.rule.id === kira.id).length, 0);
  assert.throws(() => saveRecurring(s, actor, { requestId: 'kira-pause-2', id: kira.id, version: 1, name: 'Kira', amount: 1500000, method: 'transfer', repeat: { every: 'month', day: 5 }, start: '2026-09-01', active: true }, ctx('2027-02-10T08:00:00Z')), /başka bir ekranda/);
  saveRecurring(s, actor, { requestId: 'kira-pause-3', id: kira.id, version: 2, name: 'Kira', amount: 1600000, method: 'transfer', repeat: { every: 'month', day: 5 }, start: '2026-09-01', active: true }, ctx('2027-02-10T08:00:00Z'));
  assert.equal(dueDays(s.recurringExpenses!.find(r => r.id === kira.id)!, '2027-02-10').length, 0);
  made = runRecurring(s, new Date('2027-03-05T08:00:00Z')).filter(m => m.rule.id === kira.id);
  assert.deepEqual(made.map(m => [m.expense.auto!.day, m.expense.amount]), [['2027-03-05', 1600000]], 'the new amount from now on');
});

test('server: the rule records its day, the reports show it as "Otomatik", cash ones lower the cash; one notification; owner only', async t => {
  const directory = temp('recurring'), store = new Store(directory); licensed(store);
  let clock = new Date('2026-10-04T08:00:00Z');
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client() { let cookie = ''; return async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
    return { status: r.status, data: await r.json() as any };
  }; }
  const owner = client(), cashier = client();
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await owner('/staff/users', { username: 'kasa2', name: 'Kasa', role: 'cashier', password: 'KasaDeneme!2026' })).status, 200);
  assert.equal((await cashier('/login', { username: 'kasa2', password: 'KasaDeneme!2026' })).status, 200);
  assert.equal((await cashier('/staff/recurring-expenses')).status, 403);

  const saved = await owner('/staff/recurring-expenses', { requestId: 'rule-create-001', name: 'Çay ocağı', amount: 20000, method: 'cash', repeat: { every: 'month', day: 4 }, start: '2026-10-04', end: null, active: true });
  assert.equal(saved.status, 200); assert.equal(saved.data.rules.length, 1);
  // Due today: recorded at once.
  assert.equal(saved.data.rule.last.day, '2026-10-04'); assert.equal(saved.data.next[saved.data.rule.id], '2026-11-04');
  let report = (await owner('/staff/reports/financial?from=2026-10-04&to=2026-10-04')).data;
  assert.equal(report.expenses.length, 1); assert.deepEqual(report.expenses[0].auto, { ruleId: saved.data.rule.id, day: '2026-10-04' });
  assert.equal(report.expenses[0].actorName, 'Otomatik'); assert.equal(report.cashAfterExpenses, -20000, 'a cash expense lowers the cash in hand');
  // A second rule (card) does not lower the cash.
  await owner('/staff/recurring-expenses', { requestId: 'rule-create-002', name: 'Yazılım aboneliği', amount: 30000, method: 'card', repeat: { every: 'days', days: 1 }, start: '2026-10-04', active: true });
  report = (await owner('/staff/reports/financial?from=2026-10-04&to=2026-10-04')).data;
  assert.equal(report.expenseTotal, 50000); assert.equal(report.cashAfterExpenses, -20000);
  const inbox = (await owner('/staff/notifications')).data.items.filter((n: any) => n.kind === 'expense');
  assert.deepEqual(inbox.map((n: any) => n.title).sort(), ['Otomatik gider kaydedildi: Yazılım aboneliği', 'Otomatik gider kaydedildi: Çay ocağı']);

  // Server off for four days: the reports' own read records the missed days first (catch-up), the sweep finds nothing more.
  clock = new Date('2026-10-08T06:00:00Z');
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  const overview = (await owner('/staff/reports/overview?from=2026-10-04&to=2026-10-08')).data;
  assert.equal(overview.expenses, 20000 + 5 * 30000);
  const book = new RecurringExpenses(store, () => clock);
  assert.equal(book.run('mola-demo'), 0); book.runAll();
  report = (await owner('/staff/reports/financial?from=2026-10-01&to=2026-10-31')).data;
  assert.equal(report.expenses.filter((e: any) => e.auto).length, 6);
  // Many at once for one rule: one summary notification.
  const notices = (await owner('/staff/notifications')).data.items.filter((n: any) => n.kind === 'expense');
  assert.ok(notices.some((n: any) => n.title === '4 otomatik gider kaydedildi: Yazılım aboneliği'));
  // Sealed with the snapshot: the rule's name is not in the database file in the clear.
  const raw = store.db.prepare('SELECT payload FROM snapshots').all() as { payload: Uint8Array }[];
  assert.ok(raw.every(r => !Buffer.from(r.payload).toString('utf8').includes('Çay ocağı')));

  // The owner corrects one recorded expense like any other (it keeps its "Otomatik" mark) and deletes the rule; recorded ones stay.
  const one = report.expenses.find((e: any) => e.auto?.day === '2026-10-04' && e.method === 'cash');
  assert.equal((await owner('/staff/expenses/edit', { requestId: 'auto-edit-0001', id: one.id, version: 0, amount: 25000, description: 'Çay ocağı (Ekim)', day: '2026-10-04', method: 'cash' })).status, 200);
  const rules = (await owner('/staff/recurring-expenses')).data.rules;
  const tea = rules.find((r: any) => r.name === 'Çay ocağı');
  assert.equal((await owner('/staff/recurring-expenses/delete', { requestId: 'rule-delete-001', id: tea.id, version: tea.version })).status, 200);
  report = (await owner('/staff/reports/financial?from=2026-10-04&to=2026-10-04')).data;
  const edited = report.expenses.find((e: any) => e.id === one.id);
  assert.equal(edited.amount, 25000); assert.equal(edited.auto.ruleId, tea.id); assert.equal(edited.changes.length, 1);
  assert.equal((await owner('/staff/recurring-expenses')).data.rules.length, 1);
});

test('report bars: days up to a month, weeks up to ~4 months, months for a year, years for very long "Tümü"', () => {
  const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => ({ day: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10), sales: 1000 + (i % 7) * 100 }));
  assert.equal(bucketKind(31), 'day'); assert.equal(bucketKind(32), 'week'); assert.equal(bucketKind(120), 'week'); assert.equal(bucketKind(121), 'month');
  const month = bucketize(days('2026-09-05', 30)); assert.equal(month.length, 30); assert.ok(month.every(b => b.kind === 'day'));
  // A year of synthetic sales: 13 monthly bars (the first and last partial), nothing lost.
  const year = days('2025-10-05', 365), bars = bucketize(year);
  assert.equal(bars.length, 13); assert.ok(bars.every(b => b.kind === 'month'));
  assert.equal(bars.reduce((n, b) => n + b.sales, 0), year.reduce((n, d) => n + d.sales, 0));
  assert.equal(bars.reduce((n, b) => n + b.days, 0), 365);
  assert.deepEqual([bars[0].from, bars[0].to, bars.at(-1)!.from, bars.at(-1)!.to], ['2025-10-05', '2025-10-31', '2026-10-01', '2026-10-04']);
  assert.match(bucketTitle(bars[0]), /^Ekim 2025 \(5–31 Eki\)$/); assert.equal(bucketTitle(bars[1]), 'Kasım 2025');
  // 90 days: Monday–Sunday weeks.
  const weeks = bucketize(days('2026-07-06', 90));
  assert.ok(weeks.every(b => b.kind === 'week' && weekStart(b.from) === b.key)); assert.equal(weeks[0].key, '2026-07-06'); assert.equal(weeks[0].days, 7);
  assert.equal(weeks.reduce((n, b) => n + b.days, 0), 90);
  assert.equal(weekStart('2026-10-04'), '2026-09-28', '4 October 2026 is a Sunday');
  // "Tümü" over 400 days arrives as months; over four years it becomes years.
  const months = Array.from({ length: 30 }, (_, i) => ({ day: `${2024 + Math.floor((i + 4) / 12)}-${String((i + 4) % 12 + 1).padStart(2, '0')}`, sales: 5000 }));
  const m = bucketize(months); assert.equal(m.length, 30); assert.equal(m[0].from, '2024-05-01'); assert.equal(m[0].to, '2024-05-31');
  const long = bucketize(Array.from({ length: 60 }, (_, i) => ({ day: `${2021 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`, sales: 100 })));
  assert.deepEqual(long.map(b => [b.key, b.kind, b.sales]), [['2021', 'year', 1200], ['2022', 'year', 1200], ['2023', 'year', 1200], ['2024', 'year', 1200], ['2025', 'year', 1200]]);
});
