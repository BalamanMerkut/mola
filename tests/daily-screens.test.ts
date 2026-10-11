import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../server/store.js';
import { deleteExpense, editExpense, recordExpense } from '../packages/domain/expenses.js';
import { financialFrom, financialReport, previousRange, reportRange } from '../packages/domain/reports.js';
import { qrAddressChanged } from '../packages/domain/qr-address.js';
import type { Actor, Expense, State } from '../packages/domain/types.js';

const tenant = 'mola-demo', owner: Actor = { tenantId: tenant, id: 'isletme', role: 'owner' }, cashier: Actor = { tenantId: tenant, id: 'kasa', role: 'cashier' };
const at = (iso: string) => ({ now: new Date(iso), id: randomUUID });
const plain = () => ({ tenantId: tenant, requests: {}, audit: [], expenses: [], accounts: [], orders: [], payments: [], archives: [], tables: [], products: [], staffUsers: [{ id: 'isletme', name: 'Ayşe' }] } as unknown as State);

test('owner dates an expense back up to a year with a payment method; never ahead, never older; cashiers stay cash and today', () => {
  const s = plain(), now = '2026-10-04T11:30:00Z';
  const rent = recordExpense(s, owner, { requestId: randomUUID(), amount: 900000, description: 'Eylül kirası', day: '2026-09-30', method: 'transfer' }, at(now));
  // The chosen Turkish day at the current clock time (14:30 in Istanbul).
  assert.equal(rent.spentAt, '2026-09-30T11:30:00.000Z'); assert.equal(rent.method, 'transfer');
  const today = recordExpense(s, owner, { requestId: randomUUID(), amount: 1000, description: 'Süt' }, at(now));
  assert.equal(today.spentAt, undefined); assert.equal(today.method, 'cash');
  for (const day of ['2026-10-05', '2025-10-03', '2026-02-30']) assert.throws(() => recordExpense(s, owner, { requestId: randomUUID(), amount: 1000, description: 'x', day }, at(now)), /INVALID_DATE|tarih|Gider/);
  const till = recordExpense(s, cashier, { requestId: randomUUID(), amount: 500, description: 'Buz', day: '2026-09-01', method: 'card' }, at(now));
  assert.equal(till.spentAt, undefined); assert.equal(till.method, 'cash');
  // Reports count the expense on its own day.
  assert.equal(financialReport(s, '2026-09-30', '2026-09-30').expenseTotal, 900000);
  assert.equal(financialReport(s, '2026-10-04', '2026-10-04').expenseTotal, 1500);
  // Only cash expenses leave the till.
  assert.equal(financialReport(s, '2026-09-01', '2026-10-04').cashAfterExpenses, -1500);
});

test('owner edits and deletes expenses with their history; deleted ones leave every total but stay readable', () => {
  const s = plain(), now = '2026-10-04T11:30:00Z';
  const e = recordExpense(s, owner, { requestId: randomUUID(), amount: 20000, description: 'Kahve', method: 'card' }, at(now));
  assert.throws(() => editExpense(s, cashier, { requestId: randomUUID(), id: e.id, version: 0, amount: 1, description: 'x' }, at(now)), /yetki/);
  const edited = editExpense(s, owner, { requestId: randomUUID(), id: e.id, version: 0, amount: 25000, description: 'Kahve çekirdeği', day: '2026-10-01', method: 'cash' }, at('2026-10-04T12:00:00Z'));
  assert.deepEqual([edited.amount, edited.description, edited.method, edited.spentAt?.slice(0, 10)], [25000, 'Kahve çekirdeği', 'cash', '2026-10-01']);
  assert.deepEqual(edited.changes?.[0].before, { amount: 20000, description: 'Kahve', spentAt: e.createdAt, method: 'card' });
  assert.equal(edited.changes?.[0].by, 'Ayşe');
  // A stale screen cannot overwrite the newer version.
  assert.throws(() => deleteExpense(s, owner, { requestId: randomUUID(), id: e.id, version: 0 }, at(now)), /değişti/);
  deleteExpense(s, owner, { requestId: randomUUID(), id: e.id, version: 1 }, at('2026-10-04T12:05:00Z'));
  const r = financialReport(s, '2026-10-01', '2026-10-04');
  assert.equal(r.expenseTotal, 0); assert.equal(r.expenses.length, 0);
  assert.equal(r.deletedExpenses.length, 1); assert.deepEqual(r.deletedExpenses[0].changes?.map(c => c.kind), ['edited', 'deleted']);
  assert.throws(() => editExpense(s, owner, { requestId: randomUUID(), id: e.id, version: 2, amount: 1, description: 'x' }, at(now)), /silinmiş/);
  assert.deepEqual(s.audit.map(a => a.action), ['expense.recorded', 'expense.edited', 'expense.deleted']);
});

test('stored expenses (already in long-term history) are edited in place: totals move between days, old rows keep working', () => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/expense-edit-')), store = new Store(directory, [tenant]);
  try {
    let now = Date.parse('2026-10-04T09:00:00Z'); store.clock = () => new Date(now);
    // An old-style record (no method, no spentAt), as earlier versions wrote it.
    const old = store.mutate(tenant, s => { const e: Expense = { id: randomUUID(), amount: 7000, description: 'Eski gider', actorId: 'kasa', actorName: 'Kasiyer', createdAt: new Date(now).toISOString() }; (s.expenses ??= []).push(e); return e; });
    assert.equal(store.read(tenant).expenses?.length ?? 0, 0, 'moved to history');
    const total = (from: string, to: string) => { const s = store.read(tenant), { start, end } = reportRange(from, to); return financialFrom(store.history.reportDays(tenant, s, start, end), from, to, start, end, store.history.adjustments(tenant, start, end), store.history.expenses(tenant, start, end)).expenseTotal; };
    assert.equal(total('2026-10-04', '2026-10-04'), 7000);
    now += 3600_000;
    store.mutate(tenant, s => editExpense(s, { ...owner, id: s.staffUsers!.find(u => u.role === 'owner')!.id }, { requestId: randomUUID(), id: old.id, version: 0, amount: 8000, description: 'Eski gider', day: '2026-10-02' }, { now: new Date(now), id: randomUUID }, store.history.expense(tenant, old.id)));
    assert.deepEqual([total('2026-10-04', '2026-10-04'), total('2026-10-02', '2026-10-02')], [0, 8000]);
    const stored = store.history.expense(tenant, old.id)!;
    assert.equal(stored.changes?.length, 1); assert.equal(stored.method, undefined, 'an old record keeps having no method');
    store.mutate(tenant, s => deleteExpense(s, { ...owner, id: s.staffUsers!.find(u => u.role === 'owner')!.id }, { requestId: randomUUID(), id: old.id, version: 1 }, { now: new Date(now), id: randomUUID }, store.history.expense(tenant, old.id)));
    assert.equal(total('2026-10-02', '2026-10-02'), 0);
    assert.equal(store.history.expenses(tenant, -Infinity, Infinity).length, 1, 'one row, never duplicated');
    assert.ok(store.history.expense(tenant, old.id)!.deletedAt);
  } finally { store.close(); try { rmSync(directory, { recursive: true, force: true }); } catch { /* left in .local/tests */ } }
});

test('"düne göre" while today runs compares with yesterday up to the same clock time', () => {
  const now = Date.parse('2026-10-04T11:00:00Z'); // 14:00 in Istanbul
  const today = previousRange('2026-10-04', '2026-10-04', now)!;
  assert.deepEqual([today.from, today.to, new Date(today.start).toISOString(), new Date(today.end).toISOString(), today.partial], ['2026-10-03', '2026-10-03', '2026-10-03T02:00:00.000Z', '2026-10-03T11:00:00.000Z', true], 'yesterday from 05:00 (its business day start) to 14:00');
  const week = previousRange('2026-09-28', '2026-10-04', now)!;
  assert.equal(new Date(week.end).toISOString(), '2026-09-27T11:00:00.000Z');
  // A finished period still compares whole days.
  const past = previousRange('2026-09-01', '2026-09-07', now)!;
  assert.equal(past.partial, undefined); assert.equal(past.end, reportRange('2026-09-01', '2026-09-07').start);
});

test('a printed QR set is flagged when the computer no longer has its local address', () => {
  assert.equal(qrAddressChanged('http://192.168.1.20:3000', ['http://192.168.1.20:3000', 'http://10.0.0.4:3000']), false);
  assert.equal(qrAddressChanged('http://192.168.1.20:3000', ['http://192.168.1.35:3000']), true);
  // Unknown cases stay quiet: nothing printed yet, no LAN address known, or a fixed public address.
  assert.equal(qrAddressChanged(undefined, ['http://192.168.1.35:3000']), false);
  assert.equal(qrAddressChanged('http://192.168.1.20:3000', []), false);
  assert.equal(qrAddressChanged('https://kafe.example.com', ['http://192.168.1.35:3000']), false);
});
