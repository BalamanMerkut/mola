import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { validateBackupDatabase } from '../server/backup.js';
import { cashDayOf, countTotal, expectedCash, needsNote, windowFigures, type CashMovement, type TipRecord } from '../packages/domain/cash.js';
import type { Expense } from '../packages/domain/types.js';
import { licensed, temp } from './merkez-fixture.js';

const at = (iso: string) => Date.parse(iso);
const movement = (type: CashMovement['type'], amount: number, when: string): CashMovement => ({ id: randomUUID(), kind: 'movement', type, amount, at: when, day: cashDayOf(when), by: 'isletme', byName: 'Sahip', role: 'owner' });
const expense = (e: Partial<Expense> & Pick<Expense, 'amount'>): Expense => ({ id: randomUUID(), description: 'Süt', actorId: 'kasiyer', actorName: 'Kasiyer', createdAt: '2026-10-04T10:00:00.000Z', method: 'cash', ...e });
const tip = (amount: number, method: 'cash' | 'card', when: string): TipRecord => ({ id: randomUUID(), kind: 'tip', paymentId: randomUUID(), amount, method, at: when, day: cashDayOf(when), takers: [] });

test('expected cash: opening + cash sales − cash refunds − cash expenses ± owner movements + cash tips; exchanges and other methods change nothing', () => {
  const from = at('2026-10-04T05:00:00Z'), to = at('2026-10-04T20:00:00Z');
  const { figures, expenses, movements } = windowFigures(50000, {
    payments: [{ method: 'cash', amount: 12000, createdAt: '2026-10-04T08:00:00Z' }, { method: 'cash', amount: 8000, createdAt: '2026-10-04T09:00:00Z' }, { method: 'card', amount: 30000, createdAt: '2026-10-04T09:30:00Z' },
      { method: 'platform', amount: 25000, createdAt: '2026-10-04T10:00:00Z' }, { method: 'cash', amount: 99999, createdAt: '2026-10-04T04:59:59Z' }, { method: 'cash', amount: 77777, createdAt: '2026-10-04T20:00:00Z' }],
    refunds: [{ kind: 'refund', method: 'cash', amount: 3000, createdAt: '2026-10-04T11:00:00Z' }, { kind: 'refund', method: 'card', amount: 5000, createdAt: '2026-10-04T11:00:00Z' }, { kind: 'method', method: 'cash', amount: 0, createdAt: '2026-10-04T11:00:00Z' }],
    expenses: [expense({ amount: 4000 }), expense({ amount: 1500, method: undefined }), expense({ amount: 7000, method: 'card' }), expense({ amount: 900, deletedAt: '2026-10-04T12:00:00Z' }), expense({ amount: 2000, auto: { ruleId: 'r', day: '2026-10-04' } }), expense({ amount: 600, spentAt: '2026-10-03T10:00:00Z' })],
    movements: [movement('exchange', 20000, '2026-10-04T12:00:00Z'), movement('owner_took', 10000, '2026-10-04T13:00:00Z'), movement('bank', 5000, '2026-10-04T14:00:00Z'), movement('owner_in', 2500, '2026-10-04T15:00:00Z')],
    tips: [tip(1000, 'cash', '2026-10-04T16:00:00Z'), tip(700, 'card', '2026-10-04T16:30:00Z')],
  }, from, to);
  assert.deepEqual({ cashSales: figures.cashSales, cardSales: figures.cardSales, platform: figures.platform, cashRefunds: figures.cashRefunds, cardRefunds: figures.cardRefunds }, { cashSales: 20000, cardSales: 30000, platform: 25000, cashRefunds: 3000, cardRefunds: 5000 });
  assert.equal(figures.cashExpenses, 5500, 'cash and old method-less expenses only; card, deleted, automatic and other days left out');
  assert.deepEqual(expenses.map(e => e.amount), [4000, 1500]);
  assert.deepEqual([figures.ownerIn, figures.ownerOut, figures.exchanges, figures.cashTips, figures.cardTips], [2500, 15000, 20000, 1000, 700]);
  assert.equal(movements.length, 4);
  assert.equal(figures.expected, 50000 + 20000 - 3000 - 5500 + 2500 - 15000 + 1000);
  assert.equal(figures.expected, expectedCash(figures));
  assert.equal(figures.card, 30000 + 700 - 5000, 'the POS total: card sales + card tips − card refunds');
  // An exchange of any size leaves the expected amount where it was.
  const withMore = windowFigures(50000, { payments: [], refunds: [], expenses: [], movements: [movement('exchange', 9_000_000, '2026-10-04T12:00:00Z')], tips: [] }, from, to);
  assert.equal(withMore.figures.expected, 50000);
  assert.equal(countTotal({ 20000: 2, 5000: 1, 100: 3, 50: 1, 25: 2 }), 40000 + 5000 + 300 + 50 + 50);
  assert.ok(Number.isNaN(countTotal({ 3000: 1 })), 'no 30 TL note');
  assert.equal(needsNote(5000), false); assert.equal(needsNote(-5001), true); assert.equal(needsNote(100, { differenceNote: 0 }), true);
  assert.equal(cashDayOf('2026-10-04T22:30:00Z'), '2026-10-04', '01:30 the next night still belongs to the evening');
  assert.equal(cashDayOf('2026-10-05T02:00:00Z'), '2026-10-05', '05:00 Turkish time starts a new cash day');
});

async function cafe(t: { after: (fn: () => Promise<void>) => void }, start: string) {
  const directory = temp('cash'), store = new Store(directory); licensed(store);
  let clock = new Date(start);
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client() {
    let cookie = '';
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
      return { status: r.status, data: await r.json() as any };
    };
    return Object.assign(call, { login: (username: string, password = DEMO_PASSWORD) => call('/login', { username, password }) });
  }
  return { store, directory, client, set: (iso: string) => { clock = new Date(iso); } };
}

test('a full cash day: opening, blind count, difference note, owner notified, immutable closing with corrections, carry-over', async t => {
  const c = await cafe(t, '2026-10-04T06:00:00Z');
  const owner = c.client(), cashier = c.client(), waiter = c.client();
  assert.equal((await owner.login('isletme')).status, 200);
  assert.equal((await cashier.login('kasiyer')).status, 200);
  assert.equal((await waiter.login('garson')).status, 200);
  assert.equal((await waiter('/staff/cash/status')).status, 403, 'only the counter sees the cash day');

  // The very first opening: nothing carried, so the cashier just writes what is there.
  let status = (await cashier('/staff/cash/status')).data;
  assert.equal(status.showOpening, true); assert.equal(status.carried, null); assert.equal(status.settings.expenseAlert, undefined, 'the limit is the owner\'s');
  assert.equal((await cashier('/staff/cash/movements', { requestId: randomUUID(), type: 'exchange', amount: 1000 })).data.code, 'CASH_NOT_OPEN');
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 50000 })).status, 200);
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 50000 })).data.code, 'CASH_ALREADY_OPEN');
  status = (await cashier('/staff/cash/status')).data;
  assert.equal(status.showOpening, false); assert.equal(status.opening.amount, 50000); assert.equal(status.opening.confirmed, true);
  assert.equal(JSON.stringify(status).includes('expected'), false, 'the status never tells the expected amount');

  // The owner sets the cashier's expense alert (and the note limit); only the owner may.
  assert.equal((await cashier('/staff/cash/settings', { expenseAlert: 20000 })).status, 403);
  assert.equal((await owner('/staff/cash/settings', { expenseAlert: 20000, differenceNote: 1000, closingTime: '23:00' })).status, 200);

  // Sales: a cash bill with a tip and a card bill with a tip.
  const tables = (await owner('/staff/state')).data.tables;
  const order = async (tableId: string) => { const r = await waiter('/staff/orders', { requestId: randomUUID(), tableId, lines: [{ productId: 'tea', quantity: 4, selections: [] }], expectedTotal: 14000 }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.accountId as string; };
  const pay = async (accountId: string, method: 'cash' | 'card', tendered: number, tipAmount?: number, tipMethod?: 'cash' | 'card') => {
    const account = (await cashier('/staff/state')).data.tables.find((x: any) => x.account?.id === accountId).account;
    return cashier('/staff/payments', { requestId: randomUUID(), accountId, version: account.version, method, amount: 14000, tendered, ...(tipAmount ? { tip: tipAmount } : {}), ...(tipMethod ? { tipMethod } : {}) });
  };
  const cashBill = await order(tables[0].id), cardBill = await order(tables[1].id), mixedBill = await order(tables[2].id);
  // A card bill with a cash tip: the card charge is the bill only, the tip goes into the drawer.
  assert.equal((await pay(mixedBill, 'card', 14000, 500, 'cash')).status, 200);
  assert.equal((await pay(cashBill, 'cash', 15000, 2000)).data.code, 'INVALID_TENDER', 'the tip must be inside what was handed over');
  const paid = await pay(cashBill, 'cash', 20000, 2000);
  assert.equal(paid.status, 200); assert.equal(paid.data.change, 4000, 'change without the tip'); assert.equal(paid.data.tip, 2000);
  assert.equal((await pay(cardBill, 'card', 14000, 1500)).data.code, 'INVALID_TENDER');
  assert.equal((await pay(cardBill, 'card', 15500, 1500)).status, 200);

  // Real cash out: never from the cashier (403); the cashier records exchanges and expenses only.
  for (const type of ['owner_took', 'bank', 'other_out', 'owner_in']) assert.equal((await cashier('/staff/cash/movements', { requestId: randomUUID(), type, amount: 1000, note: 'x' })).status, 403, type);
  assert.equal((await cashier('/staff/cash/movements', { requestId: randomUUID(), type: 'exchange', amount: 20000, note: '200 TL → 10 × 20 TL' })).status, 200);
  assert.equal((await owner('/staff/cash/movements', { requestId: randomUUID(), type: 'owner_took', amount: 5000 })).status, 200);
  assert.equal((await owner('/staff/cash/movements', { requestId: randomUUID(), type: 'other_out', amount: 500 })).data.code, 'NOTE_REQUIRED');

  // A cashier's cash expense above the limit reaches the owner at once; one under it does not.
  c.set('2026-10-04T11:32:00Z');
  const small = await cashier('/staff/expenses', { requestId: randomUUID(), amount: 15000, description: 'Ekmek' });
  const big = await cashier('/staff/expenses', { requestId: randomUUID(), amount: 30000, description: 'Acil süt alımı' });
  assert.equal(small.status, 200); assert.equal(big.status, 200);
  let inbox = (await owner('/staff/notifications')).data.items.filter((n: any) => n.kind === 'cash');
  assert.equal(inbox.length, 1); assert.equal(inbox[0].title, 'Kasiyer gideri sınırı aştı: ₺300');
  assert.match(inbox[0].text, /Kasiyer · “Acil süt alımı” · 14:32 · Sınır ₺200/);
  // Only the owner corrects or deletes an expense; the earlier amount stays in its record.
  assert.equal((await cashier('/staff/expenses/edit', { requestId: randomUUID(), id: big.data.id, version: 0, amount: 1000, description: 'x' })).status, 403);
  assert.equal((await cashier('/staff/expenses/delete', { requestId: randomUUID(), id: small.data.id, version: 0 })).status, 403);
  const edited = await owner('/staff/expenses/edit', { requestId: randomUUID(), id: big.data.id, version: 0, amount: 28000, description: 'Acil süt alımı', day: '2026-10-04', method: 'cash' });
  assert.equal(edited.status, 200); assert.equal(edited.data.amount, 28000); assert.equal(edited.data.changes[0].before.amount, 30000);

  // An owner's cash refund of part of the cash bill.
  const ledger = (await owner('/staff/payment-adjustments?from=2026-10-04&to=2026-10-04')).data.rows;
  const cashPayment = ledger.find((r: any) => r.method === 'cash');
  assert.equal((await owner('/staff/payment-adjustments', { requestId: randomUUID(), paymentId: cashPayment.paymentId ?? cashPayment.id, revision: 0, kind: 'refund', amount: 2000, method: 'cash', commission: 0, reason: 'Soğuk geldi' })).status, 200);

  // Blind count: the cashier types what is in the drawer and never sees the expected amount or the difference (8 Ekim:
  // only the owner does); the owner reads the whole closing.
  c.set('2026-10-04T19:30:00Z');
  const expected = 50000 + 14000 - 2000 - 15000 - 28000 - 5000 + 2000 + 500;
  const counted = await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', denominations: { 5000: 0, 1000: 1, 500: 1, 100: 0 }, pos: 15000 });
  assert.equal(counted.status, 200, JSON.stringify(counted.data));
  assert.equal(counted.data.blind, true); assert.equal(counted.data.figures, undefined); assert.equal(counted.data.difference, undefined); assert.equal(counted.data.cardDifference, undefined);
  const closing = (await owner(`/staff/cash/closing/${counted.data.id}`)).data.closing;
  assert.equal(closing.figures.expected, expected); assert.equal(closing.counted, 1500); assert.equal(closing.difference, 1500 - expected);
  assert.equal(closing.figures.exchanges, 20000); assert.equal(closing.figures.cashTips, 2500); assert.equal(closing.figures.cardTips, 1500); assert.equal(closing.figures.card, 15500 + 14000);
  assert.equal(closing.cardDifference, 15000 - 29500);
  assert.deepEqual(closing.expenses.map((e: any) => [e.amount, e.description]), [[15000, 'Ekmek'], [28000, 'Acil süt alımı']]);
  assert.equal((await cashier('/staff/cash/status')).data.draft.mine, true);
  assert.equal((await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 1700 })).data.code, 'CLOSING_DRAFT', 'no recount once the expected amount was seen');
  // The cashier does not know the difference, so no note is demanded of them (the owner's own closings still need one).
  assert.equal((await cashier('/staff/cash/finish', { id: closing.id, note: 'x', left: 999999 })).status, 400, 'nothing finished by a wrong amount');
  assert.equal((await cashier('/staff/cash/finish', { id: closing.id, note: 'Para üstünde hata olmuş olabilir', left: 2000 })).status, 400, 'cannot leave more than counted');
  const done = await cashier('/staff/cash/finish', { id: closing.id, note: 'Para üstünde hata olmuş olabilir', left: 1000 });
  assert.equal(done.status, 200); assert.equal(done.data.closing.status, 'closed'); assert.equal(done.data.closing.taken, 500);
  inbox = (await owner('/staff/notifications')).data.items.filter((n: any) => n.kind === 'cash');
  const note = inbox.find((n: any) => n.title.startsWith('Kasa kapatıldı'));
  assert.ok(note, 'the owner hears about the closing'); assert.match(note.title, /fark −₺/); assert.match(note.text, /Para üstünde hata/);

  // Immutable: finishing again changes nothing; the owner adds a correction (the cashier may not).
  const again = await cashier('/staff/cash/finish', { id: closing.id, note: 'başka', left: 0 });
  assert.equal(again.data.closing.left, 1000); assert.equal(again.data.closing.note, 'Para üstünde hata olmuş olabilir');
  assert.equal((await cashier('/staff/cash/corrections', { requestId: randomUUID(), closingId: closing.id, amount: 500, note: 'Bulundu' })).status, 403);
  assert.equal((await owner('/staff/cash/corrections', { requestId: randomUUID(), closingId: closing.id, amount: 500, note: 'Çekmecenin altında 5 TL bulundu' })).status, 200);
  const report = (await owner('/staff/reports/cash-closings?from=2026-10-04&to=2026-10-04')).data;
  assert.equal(report.closings.length, 1); assert.equal(report.closings[0].corrected, closing.difference + 500);
  assert.equal(report.people[0].byName, 'Kasiyer'); assert.equal(report.people[0].shortCount, 1);
  assert.equal((await cashier('/staff/reports/cash-closings?from=2026-10-04&to=2026-10-04')).status, 403);
  // The audit keeps the steps.
  const actions = c.store.auditLog('mola-demo').map(a => a.action);
  for (const a of ['cash.opened', 'cash.exchange', 'cash.owner_took', 'cash.counted', 'cash.closed', 'cash.correction', 'tip.recorded', 'expense.edited']) assert.ok(actions.includes(a), a);

  // Late that night nothing asks for an opening; the next morning the carried amount is what was left.
  status = (await cashier('/staff/cash/status')).data;
  assert.equal(status.closedToday.byName, 'Kasiyer'); assert.equal(status.showOpening, false);
  c.set('2026-10-05T06:00:00Z');
  assert.equal((await cashier.login('kasiyer')).status, 200);
  status = (await cashier('/staff/cash/status')).data;
  assert.equal(status.showOpening, true); assert.equal(status.carried, 1000); assert.equal(status.opening.amount, 1000);
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 900 })).data.code, 'NOTE_REQUIRED', 'a different amount needs the cashier\'s note');
  const opened = await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 900, note: '1 TL eksik' });
  assert.equal(opened.data.difference, -100);
  inbox = (await owner.login('isletme'), (await owner('/staff/notifications')).data.items);
  assert.ok(inbox.some((n: any) => n.title === 'Açılışta kasa farkı: −₺1'));

  // Sealed: notes and descriptions are not readable in the database file.
  const raw = readFileSync(join(c.directory, 'merchant.sqlite'));
  for (const text of ['Para üstünde hata', 'Çekmecenin altında', '200 TL → 10 × 20 TL']) assert.equal(raw.includes(Buffer.from(text)), false, text);
  // Backups open every cash row with the business key; a row moved onto another record is caught.
  await validateBackupDatabase(join(c.directory, 'merchant.sqlite'), join(c.directory, 'development.key'));
  const first = c.store.db.prepare("SELECT id FROM cash_records WHERE kind='opening' ORDER BY at LIMIT 1").get() as { id: string };
  c.store.db.prepare("UPDATE cash_records SET payload=(SELECT payload FROM cash_records WHERE kind='closing' LIMIT 1) WHERE id=?").run(first.id);
  await assert.rejects(validateBackupDatabase(join(c.directory, 'merchant.sqlite'), join(c.directory, 'development.key')));
});

test('next morning: "Dünün kasası kapanmadı" until it is closed; a handover passes the drawer between cashiers', async t => {
  const c = await cafe(t, '2026-10-04T06:00:00Z');
  const owner = c.client(), cashier = c.client();
  await owner.login('isletme'); await cashier.login('kasiyer');
  assert.equal((await owner('/staff/cash/open', { requestId: randomUUID(), amount: 30000 })).status, 200);
  // Mid-day handover: the next cashier starts from what was counted.
  c.set('2026-10-04T12:00:00Z');
  const handover = (await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'handover', counted: 29000 })).data;
  assert.equal(handover.difference, undefined, 'blind for the cashier'); assert.equal(handover.mode, 'handover');
  assert.equal((await owner(`/staff/cash/closing/${handover.id}`)).data.closing.difference, -1000);
  assert.equal((await cashier('/staff/cash/finish', { id: handover.id, note: 'Bozuk para eksik', left: 0 })).data.closing.left, 29000, 'a handover leaves everything in the drawer');
  assert.equal((await cashier('/staff/cash/status')).data.opening.amount, 29000);
  // Nobody closes the day. The next morning the counter is told, and a new opening waits for the closing.
  c.set('2026-10-05T07:00:00Z');
  await owner.login('isletme'); await cashier.login('kasiyer');
  let status = (await cashier('/staff/cash/status')).data;
  assert.deepEqual(status.unclosedPrevious, { day: '2026-10-04' }); assert.equal(status.showOpening, false);
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 29000 })).data.code, 'CASH_UNCLOSED');
  const late = (await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 29000 })).data;
  assert.equal(late.day, '2026-10-04', 'yesterday\'s kasa, closed this morning');
  const lateFull = (await owner(`/staff/cash/closing/${late.id}`)).data.closing;
  assert.equal(lateFull.figures.opening, 29000); assert.equal(lateFull.difference, 0);
  await cashier('/staff/cash/finish', { id: late.id });
  status = (await cashier('/staff/cash/status')).data;
  assert.equal(status.unclosedPrevious, null); assert.equal(status.showOpening, true); assert.equal(status.carried, 29000);
  const report = (await owner('/staff/reports/cash-closings?from=2026-10-04&to=2026-10-05')).data;
  assert.deepEqual(report.closings.map((x: any) => [x.mode, x.day]), [['final', '2026-10-04'], ['handover', '2026-10-04']]);
});

test('13 Ekim: a gün sonu done by mistake is taken back the same night before any payment; it leaves the reports, the kasa is open again', async t => {
  const c = await cafe(t, '2026-10-13T06:00:00Z');
  const owner = c.client(), cashier = c.client(), cashier2 = c.client(), waiter = c.client();
  assert.equal((await owner.login('isletme')).status, 200); assert.equal((await cashier.login('kasiyer')).status, 200); assert.equal((await waiter.login('garson')).status, 200);
  // A second cashier for "not the one who did it".
  assert.equal((await owner('/staff/users', { username: 'kasiyer2', name: 'Ali Kasa', role: 'cashier', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await cashier2.login('kasiyer2')).status, 200);
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 50000 })).status, 200);
  const tables = (await owner('/staff/state')).data.tables;
  const sell = async (i: number) => { const r = await waiter('/staff/orders', { requestId: randomUUID(), tableId: tables[i].id, lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 }); const account = (await cashier('/staff/state')).data.tables.find((x: any) => x.account?.id === r.data.accountId).account; return cashier('/staff/payments', { requestId: randomUUID(), accountId: r.data.accountId, version: account.version, method: 'cash', amount: 7000, tendered: 7000 }); };
  assert.equal((await sell(0)).status, 200);
  // The mistaken gün sonu at 18:00.
  c.set('2026-10-13T15:00:00Z');
  const counted = await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 57000 });
  assert.equal(counted.status, 200, JSON.stringify(counted.data));
  assert.equal((await cashier('/staff/cash/finish', { id: counted.data.id, left: 57000 })).status, 200);
  let status = (await cashier('/staff/cash/status')).data;
  assert.equal(status.closedToday.id, counted.data.id); assert.equal(status.closedToday.revoke, null, 'the person who did it may take it back');
  assert.match((await cashier2('/staff/cash/status')).data.closedToday.revoke, /siz yapmadınız/, 'another cashier may not');
  assert.equal((await cashier2('/staff/cash/revoke', { requestId: randomUUID(), id: counted.data.id, reason: 'deneme' })).data.code, 'CANNOT_REVOKE');
  assert.equal((await cashier('/staff/cash/revoke', { requestId: randomUUID(), id: counted.data.id, reason: '' })).data.code, 'NOTE_REQUIRED');
  // Taken back with a reason: the kasa is open again, the closing is gone from the list and the day report, the owner is told.
  c.set('2026-10-13T15:05:00Z');
  assert.equal((await cashier('/staff/cash/revoke', { requestId: randomUUID(), id: counted.data.id, reason: 'Yanlışlıkla bastım' })).status, 200);
  status = (await cashier('/staff/cash/status')).data;
  assert.equal(status.closedToday, null); assert.equal(status.showOpening, false); assert.equal(status.opening.amount, 50000, 'the morning opening holds again');
  const list = (await owner('/staff/reports/cash-closings?from=2026-10-13&to=2026-10-13')).data;
  assert.equal((list.closings ?? []).length, 0, 'the revoked closing is not in Kasa kapanışları');
  const notes = (await owner('/staff/notifications')).data;
  assert.ok(JSON.stringify(notes).includes('Gün sonu geri alındı'), 'the owner hears about it');
  // Sales go on; the real gün sonu at night counts the whole day from the morning: the one closing of the day.
  assert.equal((await sell(1)).status, 200);
  c.set('2026-10-13T20:00:00Z');
  const real = await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 64000 });
  assert.equal(real.status, 200); assert.equal(real.data.extra, undefined, 'not an "Ek kapanış": the first was taken back');
  assert.equal((await cashier('/staff/cash/finish', { id: real.data.id, left: 64000 })).status, 200);
  const closing = (await owner(`/staff/cash/closing/${real.data.id}`)).data.closing;
  assert.equal(closing.difference, 0, 'opening ₺500 + two cash bills ₺140 = ₺640, counted ₺640');
  // After a payment that came after the gün sonu, or the next cash day, it can no longer be taken back.
  c.set('2026-10-13T20:10:00Z');
  assert.equal((await sell(2)).status, 200);
  assert.match((await cashier('/staff/cash/status')).data.closedToday.revoke, /ödeme alındı/);
  c.set('2026-10-14T03:00:00Z'); await owner.login('isletme');
  assert.equal((await owner('/staff/cash/revoke', { requestId: randomUUID(), id: real.data.id, reason: 'deneme' })).data.code, 'CANNOT_REVOKE');
});