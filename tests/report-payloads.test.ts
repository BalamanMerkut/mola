import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { CashBook } from '../server/cash-closing.js';
import { LIST_DAYS, ShiftBook, STAFF_SHIFT_LIST } from '../server/shifts.js';
import type { CashClosing } from '../packages/domain/cash.js';
import { licensed, temp } from './merkez-fixture.js';

// Five years of a busy café (docs/HIZ_TESTI_5_YIL.md): "Tümü" in Kasa kapanışları sent 111 MB (every closing's unused payment
// list) and Personel ve bahşiş every shift of every person. Both answers now carry only what the screens show.

async function owner(t: { after: (fn: () => Promise<void>) => void }) {
  const store = new Store(temp('report-payloads')); licensed(store);
  const server = createServer(createApp(store, () => new Date('2026-10-04T12:00:00Z')));
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
  return { store, call };
}

test('Kasa kapanışları: an older closing\'s unused payment list is not sent; one with "Girildi" ticks keeps it', async t => {
  const { store, call } = await owner(t), book = new CashBook(store);
  const closing = (id: string, entered: number): CashClosing => ({ id, kind: 'closing', mode: 'final', status: 'closed', day: '2026-10-03', from: '2026-10-03T05:00:00.000Z', to: '2026-10-03T22:00:00.000Z', counted: 0, pos: null,
    figures: { opening: 0, cashSales: 0, cashRefunds: 0, cashExpenses: 0, ownerIn: 0, ownerOut: 0, cashTips: 0, exchanges: 0, expected: 0, cardSales: 0, cardTips: 0, cardRefunds: 0, card: 0, platform: 0, payments: 2 },
    difference: 0, cardDifference: null, movements: [], expenses: [], by: 'kasiyer', byName: 'Kasiyer', role: 'cashier',
    fiscal: { rows: [], total: 7000, cash: 7000, card: 0, count: 2, entered, open: [{ id: `${id}-a`, kind: 'payment', paymentId: `${id}-a`, at: '2026-10-03T10:00:00.000Z', amount: 3500, method: 'cash' }, { id: `${id}-b`, kind: 'payment', paymentId: `${id}-b`, at: '2026-10-03T11:00:00.000Z', amount: 3500, method: 'cash' }] } } as unknown as CashClosing);
  book.insert('mola-demo', closing('eski', 0)); book.insert('mola-demo', closing('isaretli', 1));
  const rows = (await call('/staff/reports/cash-closings?from=2026-10-03&to=2026-10-03')).data.closings as CashClosing[];
  const old = rows.find(c => c.id === 'eski')!, ticked = rows.find(c => c.id === 'isaretli')!;
  assert.deepEqual([old.fiscal!.open.length, old.fiscal!.more, old.fiscal!.count, old.fiscal!.total], [0, 2, 2, 7000]);
  assert.equal(ticked.fiscal!.open.length, 2, '"Girildi" was used: the list is shown, so it is sent');
});

test('Personel ve bahşiş: a person\'s newest shifts are listed, all of them counted', async t => {
  const { store, call } = await owner(t), book = new ShiftBook(store);
  for (let i = STAFF_SHIFT_LIST + 9; i >= 0; i--) {
    const day = new Date(Date.parse('2026-10-03T06:00:00Z') - i * 86400_000).toISOString();
    const s = book.begin('mola-demo', { id: 'garson', name: 'Garson', role: 'waiter' }, day);
    book.finish('mola-demo', s, new Date(Date.parse(day) + 8 * 3600_000).toISOString(), 'manual');
  }
  // A period of closed months ("Tümü") lists the last LIST_DAYS days' shifts; hours and shifts count every one (monthly roll-ups).
  const report = (await call('/staff/reports/staff-shifts?from=all&to=all')).data, row = report.rows.find((r: any) => r.id === 'garson');
  assert.equal(row.shifts.length, LIST_DAYS); assert.equal(report.listFrom, '2026-08-03'); assert.equal(row.shiftCount, STAFF_SHIFT_LIST + 10);
  assert.equal(row.minutes, (STAFF_SHIFT_LIST + 10) * 480, 'the hours count every shift');
  assert.equal(row.shifts[0].day, '2026-10-03', 'the newest first');
  // A period inside the running month lists every shift of it, newest first, up to STAFF_SHIFT_LIST.
  const month = (await call('/staff/reports/staff-shifts?from=2026-10-01&to=2026-10-04')).data;
  assert.equal(month.listFrom, undefined); assert.equal(month.rows.find((r: any) => r.id === 'garson').shifts.length, 3);
});
