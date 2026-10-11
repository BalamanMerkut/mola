import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { validateBackupDatabase } from '../server/backup.js';
import { depositFlowsFor } from '../server/reservations.js';
import { windowFigures, expectedCash } from '../packages/domain/cash.js';
import { conflicts, depositFlows, markPhase, eventStarted, eventOverdue, reservationPeriod, eventTableNames, type Reservation } from '../packages/domain/reservations.js';
import { floorTables } from '../packages/domain/takeaway.js';
import { licensed, temp } from './merkez-fixture.js';

async function cafe(t: { after: (fn: () => Promise<void>) => void }, start: string) {
  const directory = temp('reservations'), store = new Store(directory); licensed(store);
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
    return Object.assign(call, { login: (username: string) => call('/login', { username, password: DEMO_PASSWORD }) });
  }
  const owner = client(), cashier = client(), waiter = client();
  assert.equal((await owner.login('isletme')).status, 200); assert.equal((await cashier.login('kasiyer')).status, 200); assert.equal((await waiter.login('garson')).status, 200);
  const ok = (r: { status: number; data: any }) => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const order = async (tableId: string, quantity = 4) => ok(await waiter('/staff/orders', { requestId: randomUUID(), tableId, lines: [{ productId: 'tea', quantity, selections: [] }], expectedTotal: 3500 * quantity }));
  const state = async () => ok(await cashier('/staff/state'));
  const table = async (name: string) => { const s = await state(); return [...s.tables, ...(s.eventTables ?? [])].find((t: any) => t.name === name); };
  const pay = async (name: string, method: 'cash' | 'card' = 'cash') => { const t = await table(name); return ok(await cashier('/staff/payments', { requestId: randomUUID(), accountId: t.account.id, version: t.account.version, method, amount: t.account.balance, tendered: t.account.balance })); };
  return { store, directory, owner, cashier, waiter, ok, order, state, table, pay, set: (iso: string) => { clock = new Date(iso); }, relogin: async () => { for (const [who, name] of [[owner, 'isletme'], [cashier, 'kasiyer'], [waiter, 'garson']] as const) assert.equal((await who.login(name)).status, 200); } };
}
const reserve = (body: Record<string, unknown>) => ({ requestId: randomUUID(), day: '2026-10-04', time: '20:00', name: 'Ahmet', people: 4, ...body });

test('plain rules: floor phases, conflicts ±2 h, table names, nothing automatic for events', () => {
  const rules = { leadMinutes: 60, askMinutes: 30 }, at = '2026-10-04T17:00:00.000Z';
  assert.equal(markPhase({ at }, Date.parse('2026-10-04T15:59:00Z'), rules), 'later');
  assert.equal(markPhase({ at }, Date.parse('2026-10-04T16:00:00Z'), rules), 'reserved', 'an hour before: Rezerve');
  assert.equal(markPhase({ at }, Date.parse('2026-10-04T17:29:00Z'), rules), 'reserved');
  assert.equal(markPhase({ at }, Date.parse('2026-10-04T17:30:00Z'), rules), 'ask', '30 minutes after: Geldi mi?');
  assert.equal(markPhase({ at, waitUntil: '2026-10-04T17:45:00.000Z' }, Date.parse('2026-10-04T17:40:00Z'), rules), 'reserved', '15 dk daha bekle');
  const list = [{ id: 'a', tableId: 't', at, status: 'booked' as const, name: 'Ahmet', time: '20:00' }, { id: 'b', tableId: 't', at, status: 'cancelled' as const, name: 'Can', time: '20:00' }];
  assert.equal(conflicts(list, { tableId: 't', at: '2026-10-04T18:59:00.000Z' }).length, 1);
  assert.equal(conflicts(list, { tableId: 't', at: '2026-10-04T19:00:00.000Z' }).length, 0);
  assert.equal(conflicts(list, { id: 'a', tableId: 't', at }).length, 0, 'itself does not clash');
  assert.deepEqual(eventTableNames(3, 'D'), ['D1', 'D2', 'D3']);
  const e = { startAt: '2026-10-04T16:00:00.000Z', endAt: '2026-10-04T19:00:00.000Z' };
  assert.equal(eventStarted(e, Date.parse('2026-10-04T15:00:00Z')), false); assert.equal(eventStarted({ ...e, startedAt: '2026-10-04T15:00:00Z' }, Date.parse('2026-10-04T15:00:00Z')), true);
  assert.equal(eventOverdue(e, Date.parse('2026-10-04T20:00:00Z')), true);
});

test('cash closing: kapora counts once (when taken), a kapora that paid a bill is not a cash sale again, a cash refund lowers the drawer', () => {
  const from = Date.parse('2026-10-04T05:00:00Z'), to = Date.parse('2026-10-04T20:00:00Z');
  const r = (id: string, amount: number, method: 'cash' | 'card', takenAt: string, decision?: { kind: 'refund' | 'keep'; at: string }) => ({ id, deposit: { amount, method, takenAt, takenBy: 'x', takenByName: 'X', ...(decision ? { decision: { ...decision, amount, reason: 'no_show' as const, by: 'x', byName: 'X' } } : {}) } });
  const flows = depositFlows([r('a', 50000, 'cash', '2026-10-04T09:00:00Z'), r('b', 20000, 'cash', '2026-10-03T09:00:00Z', { kind: 'refund', at: '2026-10-04T12:00:00Z' }), r('c', 30000, 'card', '2026-10-04T10:00:00Z'), r('d', 10000, 'cash', '2026-10-04T08:00:00Z', { kind: 'keep', at: '2026-10-04T13:00:00Z' })]);
  const { figures } = windowFigures(10000, { payments: [{ method: 'cash', amount: 30000, createdAt: '2026-10-04T15:00:00Z' }, { method: 'cash', amount: 50000, createdAt: '2026-10-04T15:00:00Z', deposit: { reservationId: 'a', takenAt: '2026-10-04T09:00:00Z' } }], refunds: [], expenses: [], movements: [], tips: [], deposits: flows }, from, to);
  assert.equal(figures.cashSales, 30000, 'the bill\'s kapora part is not a cash sale in the drawer');
  assert.equal(figures.deposits, 60000, 'cash kapora taken today: 500 + 100 (kept stays in the drawer)');
  assert.equal(figures.depositRefunds, 20000, 'yesterday\'s kapora given back in cash today');
  assert.equal(figures.cardDeposits, 30000);
  assert.equal(figures.expected, 10000 + 30000 + 60000 - 20000);
  assert.equal(figures.expected, expectedCash(figures));
  assert.equal(figures.card, 30000, 'card kapora is in the POS total');
  // Without any kapora the figures look exactly as before.
  const plain = windowFigures(0, { payments: [], refunds: [], expenses: [], movements: [], tips: [] }, from, to).figures;
  assert.equal('deposits' in plain, false);
  const period = reservationPeriod([{ day: '2026-10-04', status: 'no_show', people: 2, deposit: { amount: 100, method: 'cash', takenAt: '', takenBy: '', takenByName: '', decision: { kind: 'keep', amount: 100, reason: 'no_show', at: '', by: '', byName: '' } } } as Reservation, { day: '2026-10-04', status: 'seated', people: 4 } as Reservation], '2026-10-04', '2026-10-04');
  assert.deepEqual([period.count, period.seated, period.noShow, period.showRate, period.deposits.kept, period.deposits.noShowKept], [2, 1, 1, 0.5, 100, 100]);
});

test('masa ayırma: conflicts warn, the name shows, Geldi opens the bill, the kapora is deducted once and tagged in the reports', async t => {
  const c = await cafe(t, '2026-10-04T14:00:00Z');
  c.ok(await c.cashier('/staff/cash/open', { requestId: randomUUID(), amount: 10000 }));
  const masa3 = await c.table('Masa 03');
  // Waiters may write reservations by default; the owner can take that away.
  const first = c.ok(await c.waiter('/staff/reservations', reserve({ tableId: masa3.id, phone: '0532 111 22 33', note: 'Pencere kenarı', deposit: { amount: 50000, method: 'cash' } })));
  const clash = await c.cashier('/staff/reservations', reserve({ tableId: masa3.id, time: '21:30', name: 'Can' }));
  assert.equal(clash.status, 409); assert.equal(clash.data.code, 'RESERVATION_CONFLICT'); assert.match(clash.data.message, /Ahmet 20:00/);
  c.ok(await c.cashier('/staff/reservations', reserve({ tableId: masa3.id, time: '21:30', name: 'Can', force: true })));
  c.ok(await c.cashier('/staff/reservations', reserve({ tableId: masa3.id, time: '23:45', name: 'Deniz' })));
  assert.equal((await c.cashier('/staff/reservations', reserve({ tableId: masa3.id, name: '' }))).data.code, 'INVALID_NAME');
  assert.equal((await c.cashier('/staff/reservations', reserve({ tableId: masa3.id, time: '12:00', phone: 'beni ara' }))).data.code, 'INVALID_PHONE');
  c.ok(await c.owner('/staff/reservations/settings', { roles: ['cashier'] }));
  assert.equal((await c.waiter('/staff/reservations', reserve({ tableId: masa3.id, time: '12:00' }))).status, 403);
  c.ok(await c.owner('/staff/reservations/settings', { roles: ['cashier', 'waiter'], askMinutes: 30, leadMinutes: 60 }));

  // The floor snapshot: the mark without phone or note; nothing changes by itself when the time passes.
  let s = await c.state();
  const mark = s.reservationMarks.find((m: any) => m.id === first.id);
  assert.deepEqual([mark.name, mark.people, mark.time, mark.deposit, 'phone' in mark, 'note' in mark], ['Ahmet', 4, '20:00', 50000, false, false]);
  assert.equal(s.reservations.askMinutes, 30);
  c.set('2026-10-04T18:00:00Z');
  s = await c.state();
  assert.ok(s.reservationMarks.some((m: any) => m.id === first.id), 'still waiting an hour after its time: nothing automatic');
  assert.equal(s.tables.find((t: any) => t.id === masa3.id).account, null);
  c.ok(await c.waiter('/staff/reservations/wait', { requestId: randomUUID(), id: first.id }));
  assert.equal((await c.state()).reservationMarks.find((m: any) => m.id === first.id).waitUntil, '2026-10-04T18:15:00.000Z');

  // Geldi: the bill opens with the name and kapora; orders are tagged; the kapora covers part of the bill.
  c.ok(await c.waiter('/staff/reservations/seat', { requestId: randomUUID(), id: first.id }));
  assert.equal((await c.waiter('/staff/reservations/seat', { requestId: randomUUID(), id: first.id })).data.code, 'RESERVATION_CHANGED');
  await c.order(masa3.id, 20); // 700 TL
  let t3 = await c.table('Masa 03');
  assert.deepEqual([t3.account.guest.name, t3.account.total, t3.account.paid, t3.account.depositCredit, t3.account.balance], ['Ahmet', 70000, 0, 50000, 20000]);
  const items = c.ok(await c.cashier(`/staff/accounts/${t3.account.id}/items`));
  assert.equal(items.unallocated, true, 'kapora: pay the rest by amount');
  await c.pay('Masa 03');
  t3 = await c.table('Masa 03');
  assert.equal(t3.account, null, 'the bill closed');
  // Reports: the whole 700 TL is a sale (200 cash + 500 kapora), all of it in the Rezervasyon part; never twice.
  const overview = c.ok(await c.owner('/staff/reports/overview?from=2026-10-04&to=2026-10-04'));
  assert.equal(overview.sales, 70000); assert.equal(overview.cash, 70000); assert.equal(overview.reservationSales, 70000);
  assert.equal(overview.channels.find((x: any) => x.id === 'rezervasyon').amount, 70000);
  const report = c.ok(await c.owner('/staff/reports/reservations?from=2026-10-04&to=2026-10-04'));
  assert.deepEqual([report.period.count, report.period.seated, report.period.booked, report.period.deposits.taken, report.period.deposits.applied, report.period.deposits.pending], [3, 1, 2, 50000, 50000, 0]);
  assert.equal(report.sales.amount, 70000);
  // The cash closing counts the kapora once: 500 when taken + 200 paid today; the bill's kapora part is not a sale again.
  const live = c.store.read('mola-demo');
  const flows = depositFlowsFor(c.store, 'mola-demo', live, Date.parse('2026-10-04T00:00:00Z'), Date.parse('2026-10-05T00:00:00Z'));
  assert.deepEqual(flows.map(f => [f.kind, f.amount, f.method]), [['in', 50000, 'cash']]);
  // Gün sonu: opening 100 + cash kapora 500 (its own line) + 200 cash paid on the bill; the bill's kapora part is not a cash sale again.
  c.set('2026-10-04T18:10:00Z');
  const counted = c.ok(await c.cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 80000 }));
  const closing = c.ok(await c.owner(`/staff/cash/closing/${counted.id}`)).closing;
  assert.deepEqual([closing.figures.cashSales, closing.figures.deposits, closing.figures.expected, closing.difference], [20000, 50000, 80000, 0]);
});

test('kapora left over, a no-show and a cancellation wait for the owner: give back or keep, recorded; the table frees', async t => {
  const c = await cafe(t, '2026-10-04T10:00:00Z');
  const [m1, m2, m4] = await Promise.all(['Masa 01', 'Masa 02', 'Masa 04'].map(c.table));
  const big = c.ok(await c.cashier('/staff/reservations', reserve({ tableId: m1.id, time: '13:00', deposit: { amount: 100000, method: 'card' } })));
  const gone = c.ok(await c.cashier('/staff/reservations', reserve({ tableId: m2.id, time: '13:00', name: 'Burak', deposit: { amount: 30000, method: 'cash' } })));
  const called = c.ok(await c.cashier('/staff/reservations', reserve({ tableId: m4.id, time: '13:00', name: 'Ece', deposit: { amount: 20000, method: 'cash' } })));
  // Bill smaller than the kapora: "Kaporayla kapat"; 1000 − 140 = 860 TL left over.
  c.ok(await c.cashier('/staff/reservations/seat', { requestId: randomUUID(), id: big.id }));
  await c.order(m1.id, 4);
  let t1 = await c.table('Masa 01');
  assert.equal(t1.account.balance, 0); assert.equal(t1.account.depositCredit, 14000);
  assert.equal((await c.cashier('/staff/payments', { requestId: randomUUID(), accountId: t1.account.id, version: t1.account.version, method: 'cash', amount: 100, tendered: 100 })).data.code, 'OVERPAYMENT');
  c.ok(await c.cashier('/staff/reservations/close-with-deposit', { requestId: randomUUID(), accountId: t1.account.id, version: t1.account.version }));
  assert.equal((await c.table('Masa 01')).account, null);
  // Not come: the waiter frees the table; the kapora waits; only the owner decides.
  c.ok(await c.waiter('/staff/reservations/no-show', { requestId: randomUUID(), id: gone.id }));
  c.ok(await c.cashier('/staff/reservations/cancel', { requestId: randomUUID(), id: called.id }));
  assert.equal((await c.cashier('/staff/reservations/deposit', { requestId: randomUUID(), id: gone.id, kind: 'keep' })).status, 403);
  const list = c.ok(await c.owner('/staff/reservations?from=2026-10-04&to=2026-10-04'));
  assert.deepEqual(list.pending.map((r: any) => [r.name, r.deposit.pending.reason, r.deposit.pending.amount]).sort(), [['Ahmet', 'leftover', 86000], ['Burak', 'no_show', 30000], ['Ece', 'cancelled', 20000]]);
  c.ok(await c.owner('/staff/reservations/deposit', { requestId: randomUUID(), id: gone.id, kind: 'keep' }));
  c.ok(await c.owner('/staff/reservations/deposit', { requestId: randomUUID(), id: called.id, kind: 'refund' }));
  c.ok(await c.owner('/staff/reservations/deposit', { requestId: randomUUID(), id: big.id, kind: 'refund' }));
  assert.equal((await c.owner('/staff/reservations/deposit', { requestId: randomUUID(), id: big.id, kind: 'keep' })).data.code, 'NO_PENDING');
  const report = c.ok(await c.owner('/staff/reports/reservations?from=2026-10-04&to=2026-10-04'));
  assert.deepEqual(report.period.deposits, { taken: 150000, takenCount: 3, applied: 14000, kept: 30000, refunded: 106000, pending: 0, noShowKept: 30000 });
  assert.equal(report.period.noShow, 1); assert.equal(report.period.cancelled, 1);
  // Sales: only the 140 TL the kapora paid; the kept no-show kapora is not a sale.
  assert.equal(c.ok(await c.owner('/staff/reports/overview?from=2026-10-04&to=2026-10-04')).sales, 14000);
  const flows = depositFlowsFor(c.store, 'mola-demo', c.store.read('mola-demo'), -Infinity, Infinity);
  assert.deepEqual(flows.filter(f => f.kind === 'out').map(f => [f.amount, f.method]).sort(), [[20000, 'cash'], [86000, 'card']]);

  // Four days later the finished ones leave the snapshot but stay readable; backups open their sealed rows.
  c.set('2026-10-09T10:00:00Z'); await c.relogin();
  c.ok(await c.owner('/staff/notifications/count'));
  assert.equal(c.store.read('mola-demo').reservations?.length ?? 0, 0);
  assert.equal(c.ok(await c.owner('/staff/reservations?from=2026-10-04&to=2026-10-04')).reservations.length, 3);
  assert.equal(depositFlowsFor(c.store, 'mola-demo', c.store.read('mola-demo'), -Infinity, Infinity).length, 5, '3 taken + 2 given back');
  await validateBackupDatabase(join(c.directory, 'merchant.sqlite'), join(c.directory, 'development.key'));
});

test('etkinlik: 25 temporary tables without QR, reservations and walk-ins, closing refused with open bills, report, renaming', async t => {
  const c = await cafe(t, '2026-10-04T12:00:00Z');
  assert.equal((await c.waiter('/staff/events', { requestId: randomUUID(), name: 'Derbi', day: '2026-10-04', start: '19:00', count: 3, hideNormal: false })).status, 403, 'owner and cashier run events');
  const ev = c.ok(await c.cashier('/staff/events', { requestId: randomUUID(), name: 'Elazığspor derbisi', day: '2026-10-04', start: '19:00', end: '22:00', count: 25, prefix: 'D', capacity: 4, hideNormal: true }));
  assert.equal(ev.tables, 25);
  let s = await c.state();
  assert.equal(s.tables.length, 12, 'the floor plan, QR list and table limits never see event tables');
  assert.equal(floorTables(c.store.read('mola-demo')).length, 12);
  assert.equal(s.eventTables.length, 25); assert.equal(s.eventTables[0].name, 'D1'); assert.equal(s.eventTables[0].token, '');
  assert.deepEqual([s.events[0].name, s.events[0].hideNormal, s.events[0].tables], ['Elazığspor derbisi', true, 25]);
  assert.equal(c.ok(await c.owner('/staff/tables/add', { requestId: randomUUID() })).name, 'Masa 13', 'table numbering goes on');
  assert.equal((await c.cashier('/staff/events', { requestId: randomUUID(), name: 'İkinci', day: '2026-10-04', start: '19:00', count: 1, names: ['D3'], hideNormal: false })).data.code, 'DUPLICATE_NAME');
  // Names can change later.
  const d1 = s.eventTables[0];
  c.ok(await c.cashier('/staff/events/table-name', { requestId: randomUUID(), tableId: d1.id, name: 'Sahne önü' }));
  assert.equal((await c.cashier('/staff/events/table-name', { requestId: randomUUID(), tableId: d1.id, name: 'D2' })).data.code, 'DUPLICATE_NAME');
  const d5 = await c.table('D5'), d7 = await c.table('D7'), d9 = await c.table('D9');
  const r5 = c.ok(await c.waiter('/staff/reservations', reserve({ tableId: d5.id, time: '19:00', name: 'Selin', people: 5, deposit: { amount: 40000, method: 'cash' } })));
  const r9 = c.ok(await c.waiter('/staff/reservations', reserve({ tableId: d9.id, time: '19:00', name: 'Okan', people: 2, deposit: { amount: 10000, method: 'cash' } })));
  assert.equal((await c.waiter('/staff/reservations', reserve({ tableId: d5.id, day: '2026-10-05', time: '19:00' }))).data.code, 'EVENT_DAY');
  // The match starts; walk-in at D7, the reservation at D5 comes, D9 does not.
  c.set('2026-10-04T16:05:00Z');
  c.ok(await c.waiter('/staff/reservations/walk-in', { requestId: randomUUID(), tableId: d7.id, name: 'Mehmet (rezervasyonsuz)', people: 3 }));
  c.ok(await c.waiter('/staff/reservations/seat', { requestId: randomUUID(), id: r5.id }));
  await c.order(d7.id, 2); await c.order(d5.id, 20);
  c.ok(await c.waiter('/staff/reservations/no-show', { requestId: randomUUID(), id: r9.id }));
  // A no-show seat goes to someone else: a walk-in, then renamed.
  c.ok(await c.waiter('/staff/reservations/walk-in', { requestId: randomUUID(), tableId: d9.id, name: 'Ali', people: 2 }));
  const t9 = await c.table('D9');
  c.ok(await c.waiter('/staff/reservations/guest-name', { requestId: randomUUID(), accountId: t9.account.id, name: 'Ali Bey' }));
  assert.equal((await c.table('D9')).account.guest.name, 'Ali Bey');
  await c.order(d9.id, 1);
  // Past the planned end: never closes by itself, only a reminder.
  c.set('2026-10-04T19:30:00Z');
  s = await c.state();
  assert.equal(s.events.length, 1); assert.equal(s.eventTables.length, 25);
  const inbox = c.ok(await c.owner('/staff/notifications'));
  assert.ok(inbox.items.some((n: any) => n.title === 'Etkinlik bitti mi? Elazığspor derbisi'));
  const refused = await c.cashier('/staff/events/close', { requestId: randomUUID(), id: s.events[0].id });
  assert.equal(refused.status, 409); assert.equal(refused.data.code, 'EVENT_OPEN_BILLS'); assert.match(refused.data.message, /D5, D7, D9/);
  await c.pay('D5'); await c.pay('D7'); await c.pay('D9', 'card');
  c.ok(await c.cashier('/staff/events/close', { requestId: randomUUID(), id: s.events[0].id }));
  s = await c.state();
  assert.equal(s.events.length, 0); assert.equal(s.eventTables.length, 0);
  // Temporary tables leave once their closed bills settled into history; the history keeps their names.
  c.set('2026-10-05T20:00:00Z'); await c.relogin(); c.ok(await c.owner('/staff/reservations/settings', { leadMinutes: 60 }));
  assert.equal(c.store.read('mola-demo').tables.filter(x => x.event).length, 0);
  const report = c.ok(await c.owner('/staff/reports/reservations?from=2026-10-04&to=2026-10-04'));
  const row = report.events[0];
  assert.deepEqual([row.name, row.tables, row.tablesUsed, row.people, row.revenue, row.walkInRevenue, row.reservedRevenue, row.reservations, row.seated, row.noShow], ['Elazığspor derbisi', 25, 3, 10, 80500, 10500, 70000, 2, 1, 1]);
  assert.deepEqual([row.deposits.taken, row.deposits.applied, row.deposits.noShow, row.deposits.pending], [50000, 40000, 10000, 10000]);
  const overview = c.ok(await c.owner('/staff/reports/overview?from=2026-10-04&to=2026-10-04'));
  assert.equal(overview.sales, 80500, 'kapora applied to D5 is part of its sale, counted once');
  assert.equal(overview.channels.find((x: any) => x.id === 'rezervasyon').amount, 80500);
  assert.deepEqual(c.store.history.archives('mola-demo', -Infinity, Infinity).map(a => a.tableName).filter(n => /^D\d/.test(n)).sort(), ['D5', 'D7', 'D9'], 'archived bills keep the temporary table names');
});

test('etkinlik raporu: a guest seated from the event at a normal table keeps ordering after it closed; the report still counts every order', async t => {
  // The report opens only the bills around the event (server/reservations.ts): from its creation to an hour after it closed.
  const c = await cafe(t, '2026-10-04T12:00:00Z');
  const ev = c.ok(await c.cashier('/staff/events', { requestId: randomUUID(), name: 'Canlı müzik', day: '2026-10-04', start: '19:00', end: '22:00', count: 2, prefix: 'D', hideNormal: false }));
  const d1 = await c.table('D1'), masa = await c.table('Masa 03');
  const r = c.ok(await c.waiter('/staff/reservations', reserve({ tableId: d1.id, time: '19:00', name: 'Deniz', people: 4 })));
  c.set('2026-10-04T16:05:00Z');
  // The event's guest is seated at a normal table (the event tables were full), orders, the event closes at 22:15.
  c.ok(await c.waiter('/staff/reservations/seat', { requestId: randomUUID(), id: r.id, tableId: masa.id }));
  await c.order(masa.id, 2);
  c.set('2026-10-04T19:15:00Z'); c.ok(await c.cashier('/staff/events/close', { requestId: randomUUID(), id: ev.id }));
  // Three hours later the table orders again and pays; the bill settles into history a day later.
  c.set('2026-10-04T22:20:00Z'); await c.order(masa.id, 3); await c.pay('Masa 03');
  c.set('2026-10-06T00:00:00Z'); await c.relogin(); c.ok(await c.owner('/staff/reservations/settings', { leadMinutes: 60 }));
  assert.equal(c.store.read('mola-demo').accounts.length, 0, 'the bill is in history now');
  const row = c.ok(await c.owner('/staff/reports/reservations?from=2026-10-04&to=2026-10-04')).events[0];
  assert.deepEqual([row.name, row.orders, row.revenue, row.reservedRevenue, row.seated], ['Canlı müzik', 2, 17500, 17500, 1]);
  // Three days after it closed the event leaves the floor and its row is kept as it was (event_reports): no bill is read again.
  c.set('2026-10-09T00:00:00Z'); await c.relogin(); c.ok(await c.owner('/staff/notifications'));
  assert.equal((c.store.read('mola-demo').events ?? []).length, 0);
  assert.equal(Number((c.store.db.prepare('SELECT COUNT(*) AS n FROM event_reports').get() as { n: number }).n), 1, 'kept when it left the floor');
  const first = c.ok(await c.owner('/staff/reports/reservations?from=all&to=all')).events;
  assert.deepEqual(c.ok(await c.owner('/staff/reports/reservations?from=all&to=all')).events, first);
  assert.deepEqual(first[0], row, 'the kept row is the same as the one worked out from the bills');
  await validateBackupDatabase(join(c.directory, 'merchant.sqlite'), join(c.directory, 'development.key'));
});

test('K-U: the Etkinlikler report lists the newest event first', async t => {
  const c = await cafe(t, '2026-10-01T09:00:00Z');
  for (const [name, day] of [['Derbi gecesi', '2026-10-02'], ['Canlı müzik', '2026-10-06'], ['Quiz gecesi', '2026-10-04']] as const) c.ok(await c.cashier('/staff/events', { requestId: randomUUID(), name, day, start: '20:00', end: '23:00', count: 1, prefix: name[0], hideNormal: false }));
  const names = (r: any) => r.events.map((e: any) => e.name);
  assert.deepEqual(names(c.ok(await c.owner('/staff/reports/reservations?from=all&to=all'))), ['Canlı müzik', 'Quiz gecesi', 'Derbi gecesi']);
  assert.deepEqual(names(c.ok(await c.owner('/staff/reports/reservations?from=2026-10-01&to=2026-10-31'))), ['Canlı müzik', 'Quiz gecesi', 'Derbi gecesi']);
});
