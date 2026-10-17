import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { validateBackupDatabase } from '../server/backup.js';
import type { IntegrationManager } from '../server/integrations/manager.js';
import { acceptExternalOrder, receiveExternalOrder } from '../packages/domain/external-orders.js';
import { expectedCash } from '../packages/domain/cash.js';
import type { Actor } from '../packages/domain/types.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * Where the three newer parts meet: Kasa kapanışı (tips, kapora, refunds, corrections), Ajanda ve rezervasyon (kapora on a
 * bill, etkinlik tables), Stok and Kârlılık, and Vardiya takibi. Each test runs one café over HTTP the way the screens do.
 */
const TENANT = 'mola-demo';
async function cafe(t: { after: (fn: () => Promise<void>) => void }, start: string) {
  const directory = temp('cross'), store = new Store(directory); licensed(store);
  let clock = new Date(start);
  const app = createApp(store, () => clock), server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { (app.locals.integrations as IntegrationManager).stop(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client(guestSession?: () => string) {
    const jar = new Map<string, string>();
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/json', ...(guestSession ? { 'X-Guest-Session': guestSession() } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of r.headers.getSetCookie()) { const [k, v] = c.split(';')[0].split('='); jar.set(k, v); }
      return { status: r.status, data: await r.json() as any };
    };
    return Object.assign(call, { login: (username: string) => call('/login', { username, password: DEMO_PASSWORD }) });
  }
  const ok = (r: { status: number; data: any }) => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const owner = client(), cashier = client(), waiter = client(), kitchen = client();
  for (const [c, u] of [[owner, 'isletme'], [cashier, 'kasiyer'], [waiter, 'garson'], [kitchen, 'mutfak']] as const) assert.equal((await c.login(u)).status, 200);
  const state = async () => ok(await owner('/staff/state'));
  const table = async (name: string) => { const s = await state(); return [...s.tables, ...(s.eventTables ?? [])].find((x: any) => x.name === name); };
  const order = async (tableId: string, quantity: number, by = waiter) => ok(await by('/staff/orders', { requestId: randomUUID(), tableId, lines: [{ productId: 'tea', quantity, selections: [] }], expectedTotal: 3500 * quantity }));
  return { store, directory, client, ok, owner, cashier, waiter, kitchen, state, table, order, set: (iso: string) => { clock = new Date(iso); } };
}
const reserve = (body: Record<string, unknown>) => ({ requestId: randomUUID(), day: '2026-10-04', time: '13:00', name: 'Misafir', people: 2, ...body });

test('gün sonu kasası, everything at once: tips both ways, kapora taken / applied / given back / kept, a card kapora, a platform order, a refund, a method change, exchange, owner movements, cashier, card and automatic expenses', async t => {
  const c = await cafe(t, '2026-10-04T06:00:00Z');
  const { ok, owner, cashier } = c;
  ok(await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 50000 }));
  c.set('2026-10-04T06:10:00Z');
  const [m1, m2, m3, m4, m5, m6] = await Promise.all(['Masa 01', 'Masa 02', 'Masa 03', 'Masa 04', 'Masa 05', 'Masa 06'].map(c.table));
  // Kapora: 300 TL cash (will pay part of a bill), 200 TL card (bigger than its bill; the rest is kept), 100 TL cash (no-show, given back).
  const r1 = ok(await cashier('/staff/reservations', reserve({ tableId: m3.id, name: 'Ahmet', deposit: { amount: 30000, method: 'cash' } })));
  const r2 = ok(await cashier('/staff/reservations', reserve({ tableId: m4.id, name: 'Burcu', deposit: { amount: 20000, method: 'card' } })));
  const r3 = ok(await cashier('/staff/reservations', reserve({ tableId: m5.id, name: 'Cem', deposit: { amount: 10000, method: 'cash' } })));
  c.set('2026-10-04T10:00:00Z');
  ok(await c.waiter('/staff/reservations/seat', { requestId: randomUUID(), id: r1.id }));
  ok(await c.waiter('/staff/reservations/seat', { requestId: randomUUID(), id: r2.id }));
  ok(await c.waiter('/staff/reservations/no-show', { requestId: randomUUID(), id: r3.id }));
  const bill1 = await c.order(m3.id, 20), bill2 = await c.order(m4.id, 2), cardBill = await c.order(m1.id, 4), cashBill = await c.order(m2.id, 4), changed = await c.order(m6.id, 4);
  const account = async (accountId: string) => [...(await c.state()).tables, ...((await c.state()).eventTables ?? [])].find((x: any) => x.account?.id === accountId).account;
  const pay = async (accountId: string, method: 'cash' | 'card', amount: number, tendered: number, tip?: number, tipMethod?: 'cash' | 'card') => {
    const a = await account(accountId);
    return ok(await cashier('/staff/payments', { requestId: randomUUID(), accountId, version: a.version, method, amount, tendered, ...(tip ? { tip } : {}), ...(tipMethod ? { tipMethod } : {}) }));
  };
  c.set('2026-10-04T12:00:00Z');
  // 700 TL bill, 300 TL kapora: 400 TL cash with a 10 TL cash tip.
  assert.equal((await account(bill1.accountId)).balance, 40000);
  await pay(bill1.accountId, 'cash', 40000, 41000, 1000);
  // 70 TL bill, 200 TL card kapora: "Kaporayla kapat"; 130 TL left over, the owner keeps it.
  const a2 = await account(bill2.accountId);
  ok(await cashier('/staff/reservations/close-with-deposit', { requestId: randomUUID(), accountId: a2.id, version: a2.version }));
  ok(await owner('/staff/reservations/deposit', { requestId: randomUUID(), id: r2.id, kind: 'keep' }));
  ok(await owner('/staff/reservations/deposit', { requestId: randomUUID(), id: r3.id, kind: 'refund' }));
  // A card bill with a 5 TL cash tip; a cash bill (2 TL change); a cash bill later corrected to card.
  await pay(cardBill.accountId, 'card', 14000, 14000, 500, 'cash');
  assert.equal((await pay(cashBill.accountId, 'cash', 14000, 20000)).change, 6000);
  await pay(changed.accountId, 'cash', 14000, 14000);
  // A delivery platform order paid online: "Platform ödemesi", never cash or card.
  const platformTotal = c.store.mutate(TENANT, s => {
    const p = s.products.find(x => x.id === 'tea')!, at = { now: new Date('2026-10-04T12:30:00Z'), id: randomUUID };
    const got = receiveExternalOrder(s, 'yemeksepeti', { externalId: 'ys-77', code: '77', customerName: 'Ayşe', deliveryType: 'kurye', paidOnline: true, total: p.price * 3, receivedAt: at.now.toISOString(), acceptBy: '2026-10-04T12:35:00Z', items: [{ externalId: 'x', name: p.name, quantity: 3, unitPrice: p.price }] }, at);
    acceptExternalOrder(s, { tenantId: TENANT, id: 'isletme', role: 'owner' } as Actor, { id: got.id!, version: 1 }, at);
    return p.price * 3;
  });
  // The owner: a 20 TL cash refund on the cash bill, the corrected bill was really paid by card.
  c.set('2026-10-04T13:00:00Z');
  const paymentOf = (accountId: string) => c.store.read(TENANT).archives.find(a => a.accountId === accountId)!.payments[0];
  ok(await owner('/staff/payment-adjustments', { requestId: randomUUID(), paymentId: paymentOf(cashBill.accountId).id, revision: 0, kind: 'refund', amount: 2000, method: 'cash', commission: 0, reason: 'Soğuk geldi' }));
  ok(await owner('/staff/payment-adjustments', { requestId: randomUUID(), paymentId: paymentOf(changed.accountId).id, revision: 0, kind: 'method', amount: 0, method: 'card', commission: 0, reason: 'Kartla ödemişti' }));
  // Drawer movements and expenses: an exchange changes nothing; the owner takes 50 TL and puts 30 TL in.
  ok(await cashier('/staff/cash/movements', { requestId: randomUUID(), type: 'exchange', amount: 20000 }));
  ok(await owner('/staff/cash/movements', { requestId: randomUUID(), type: 'owner_took', amount: 5000 }));
  ok(await owner('/staff/cash/movements', { requestId: randomUUID(), type: 'owner_in', amount: 3000 }));
  ok(await cashier('/staff/expenses', { requestId: randomUUID(), amount: 4000, description: 'Ekmek' }));
  ok(await owner('/staff/expenses', { requestId: randomUUID(), amount: 6000, description: 'Kartla temizlik malzemesi', method: 'card' }));
  // An "Otomatik gider" due today is the owner's planned bill: never taken from the drawer.
  const rule = ok(await owner('/staff/recurring-expenses', { requestId: randomUUID(), name: 'Su faturası', amount: 2500, method: 'cash', repeat: { every: 'month', day: 4 }, start: '2026-10-04', active: true }));
  assert.equal(rule.rules.length, 1);
  assert.ok((await c.owner('/staff/reports/financial?from=2026-10-04&to=2026-10-04')).data.expenses.some((e: any) => e.description === 'Su faturası' && e.auto), 'the automatic expense is recorded');

  // Blind count at 21:00.
  c.set('2026-10-04T18:00:00Z');
  const counted = ok(await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 127500, pos: 48000 }));
  assert.equal(counted.figures, undefined, 'blind for the cashier');
  const closing = ok(await owner(`/staff/cash/closing/${counted.id}`)).closing, f = closing.figures;
  assert.deepEqual({ cashSales: f.cashSales, cashRefunds: f.cashRefunds, cashExpenses: f.cashExpenses, ownerIn: f.ownerIn, ownerOut: f.ownerOut, exchanges: f.exchanges, cashTips: f.cashTips, deposits: f.deposits, depositRefunds: f.depositRefunds },
    { cashSales: 40000 + 14000, cashRefunds: 2000, cashExpenses: 4000, ownerIn: 3000, ownerOut: 5000, exchanges: 20000, cashTips: 1500, deposits: 40000, depositRefunds: 10000 },
    'the bill\'s kapora part is no cash sale, the corrected bill is card, the card and automatic expenses stay out');
  assert.equal(f.expected, 50000 + 54000 - 2000 - 4000 + 3000 - 5000 + 1500 + 40000 - 10000);
  assert.equal(f.expected, expectedCash(f)); assert.equal(closing.difference, 0);
  assert.deepEqual({ cardSales: f.cardSales, cardDeposits: f.cardDeposits, card: f.card, platform: f.platform }, { cardSales: 28000, cardDeposits: 20000, card: 48000, platform: platformTotal });
  assert.equal(closing.cardDifference, 0, 'the POS total matches: card bills + card kapora');
  ok(await cashier('/staff/cash/finish', { id: closing.id, left: 50000 }));

  // The day's reports see the same money from the sales side: every bill once, the kapora parts inside their bills.
  const financial = ok(await owner('/staff/reports/financial?from=2026-10-04&to=2026-10-04'));
  assert.equal(financial.platform, platformTotal);
  const overview = ok(await owner('/staff/reports/overview?from=2026-10-04&to=2026-10-04'));
  assert.equal(overview.sales, 70000 + 7000 + 14000 * 3 + platformTotal);
  const report = ok(await owner('/staff/reports/reservations?from=2026-10-04&to=2026-10-04'));
  assert.deepEqual(report.period.deposits, { taken: 60000, takenCount: 3, applied: 30000 + 7000, kept: 13000, refunded: 10000, pending: 0, noShowKept: 0 });
});

test('kapora on an etkinlik table: the bill, Stok consumption, Kârlılık and the event report agree, also after the day settles; moves, merges and cleaning of temporary tables', async t => {
  const c = await cafe(t, '2026-10-04T12:00:00Z');
  const { ok, owner, cashier, waiter } = c;
  c.store.mutate(TENANT, s => { s.cleaningEnabled = true; });
  // Stok: 5 g çay per tea at ₺0,40 / g → 200 kuruş per glass.
  const leaf = ok(await owner('/staff/stock/items', { name: 'Çay yaprağı', unit: 'g', initial: 2000, unitCost: 40 })).item.id;
  c.set('2026-10-04T12:01:00Z');
  ok(await owner('/staff/stock/recipes', { productId: 'tea', mode: 'recipe', items: [{ itemId: leaf, amount: 5 }] }));
  const ev = ok(await cashier('/staff/events', { requestId: randomUUID(), name: 'Derbi', day: '2026-10-04', start: '19:00', end: '22:00', count: 4, prefix: 'D', hideNormal: false }));
  assert.equal(ev.tables, 4);
  const [d1, d2, d3, d4] = await Promise.all(['D1', 'D2', 'D3', 'D4'].map(c.table));
  const booked = ok(await waiter('/staff/reservations', reserve({ tableId: d1.id, time: '19:00', name: 'Selin', people: 4, deposit: { amount: 20000, method: 'cash' } })));
  // The match starts: the reservation comes, a walk-in sits at D2 and moves to D3, then joins the reservation's bill.
  c.set('2026-10-04T16:05:00Z');
  ok(await waiter('/staff/reservations/seat', { requestId: randomUUID(), id: booked.id }));
  const walk = ok(await waiter('/staff/reservations/walk-in', { requestId: randomUUID(), tableId: d2.id, name: 'Kemal', people: 2 }));
  await c.order(d1.id, 10); await c.order(d2.id, 2);
  let t2 = await c.table('D2'), t3 = await c.table('D3');
  ok(await waiter('/staff/tables/move', { requestId: randomUUID(), accountId: walk.accountId, version: t2.account.version, targetId: d3.id, targetEpoch: t3.epoch }));
  t2 = await c.table('D2'); t3 = await c.table('D3');
  assert.equal(t2.account, null); assert.equal(t2.needsCleaning, true, 'a temporary table is cleaned like any other');
  assert.equal(t3.account.guest.name, 'Kemal');
  await c.order(d3.id, 1, cashier);
  let t1 = await c.table('D1'); t3 = await c.table('D3');
  // The kapora rides on its own bill: D1 cannot join D3, D3 joins D1.
  assert.equal((await cashier('/staff/accounts/merge', { requestId: randomUUID(), sourceId: t1.account.id, sourceVersion: t1.account.version, targetId: t3.account.id, targetVersion: t3.account.version })).data.code, 'DEPOSIT_FIXED');
  ok(await cashier('/staff/accounts/merge', { requestId: randomUUID(), sourceId: t3.account.id, sourceVersion: t3.account.version, targetId: t1.account.id, targetVersion: t1.account.version }));
  t1 = await c.table('D1');
  assert.deepEqual([t1.account.total, t1.account.depositCredit, t1.account.balance], [13 * 3500, 20000, 13 * 3500 - 20000]);
  // A walk-in on D4 pays by card; D1 pays the rest in cash.
  ok(await waiter('/staff/reservations/walk-in', { requestId: randomUUID(), tableId: d4.id, name: 'Okan' }));
  await c.order(d4.id, 2);
  const t4 = await c.table('D4');
  ok(await cashier('/staff/payments', { requestId: randomUUID(), accountId: t4.account.id, version: t4.account.version, method: 'card', amount: 7000, tendered: 7000 }));
  ok(await cashier('/staff/payments', { requestId: randomUUID(), accountId: t1.account.id, version: t1.account.version, method: 'cash', amount: t1.account.balance, tendered: t1.account.balance }));
  const s = await c.state();
  assert.ok(s.eventTables.filter((x: any) => ['D1', 'D2', 'D3', 'D4'].includes(x.name)).every((x: any) => x.needsCleaning && !x.account), 'every used temporary table waits for cleaning');
  ok(await waiter('/staff/tables/clean', { requestId: randomUUID(), tableId: d2.id, epoch: (await c.table('D2')).epoch }));
  // Closing the event does not wait for the cleaning; the tables leave, never in the QR list.
  ok(await cashier('/staff/events/close', { requestId: randomUUID(), id: s.events[0].id }));
  assert.equal((await c.state()).eventTables.length, 0, 'gone from Masalar at once');
  assert.deepEqual(c.store.read(TENANT).tables.filter(x => x.event).map(x => x.name).sort(), ['D1', 'D3', 'D4'], 'kept only while their closed bills are on the floor');
  assert.equal((await c.state()).tables.length, 12);
  assert.equal((c.store.db.prepare('SELECT COUNT(*) AS n FROM table_qr_lookup WHERE tenant=?').get(TENANT) as { n: number }).n, 12, 'temporary tables never get a QR');

  const sold = 10 + 2 + 1 + 2, revenue = sold * 3500, cost = sold * 5 * 40;
  const check = async (when: string) => {
    const stock = ok(await owner('/staff/stock'));
    assert.equal(stock.items.find((i: any) => i.id === leaf).stock, 2000 - sold * 5, `${when}: Stok counts every glass once (moved, merged and kapora-paid alike)`);
    const profit = ok(await owner('/staff/reports/profit?from=2026-10-04&to=2026-10-04'));
    const tea = profit.rows.find((r: any) => r.id === 'tea');
    assert.deepEqual([tea.quantity, tea.revenue, tea.cost, tea.profit], [sold, revenue, cost, revenue - cost], `${when}: Kârlılık`);
    const overview = ok(await owner('/staff/reports/overview?from=2026-10-04&to=2026-10-04'));
    assert.equal(overview.sales, revenue, `${when}: the kapora part is inside the sale, once`);
    const events = ok(await owner('/staff/reports/reservations?from=2026-10-04&to=2026-10-04')).events;
    assert.deepEqual([events[0].revenue, events[0].orders, events[0].deposits.applied, events[0].reservedRevenue + events[0].walkInRevenue], [revenue, 4, 20000, revenue], `${when}: event report`);
    assert.equal(profit.totals.revenue, overview.sales, `${when}: Kârlılık and Özet agree`);
  };
  await check('same day');
  // Two days later the bills live in long-term history only; nothing changes.
  c.set('2026-10-06T08:00:00Z');
  for (const who of [owner, cashier, waiter]) await who.login(who === owner ? 'isletme' : who === cashier ? 'kasiyer' : 'garson');
  c.store.mutate(TENANT, () => {});
  assert.equal(c.store.read(TENANT).archives.length, 0);
  assert.equal(c.store.read(TENANT).tables.filter(x => x.event).length, 0, 'the temporary tables left with their bills');
  await check('settled');
  assert.deepEqual(c.store.history.archives(TENANT, -Infinity, Infinity).map(a => a.tableName).sort(), ['D1', 'D3', 'D4'], 'the merged bill closed without a sale on D3');
  await validateBackupDatabase(join(c.directory, 'merchant.sqlite'), join(c.directory, 'development.key'));
});

test('vardiya takibi on: the owner is never asked, QR guests still order, the kitchen and waiters start a shift before they act', async t => {
  const c = await cafe(t, '2026-10-05T07:00:00Z');
  const { ok, owner, cashier, waiter, kitchen } = c;
  ok(await owner('/staff/cash/settings', { shiftTracking: true }));
  const m1 = await c.table('Masa 01'), m2 = await c.table('Masa 02');
  // A guest scans the QR of Masa 02 and orders: guests never have shifts.
  const token = c.store.read(TENANT).tables.find(x => x.id === m2.id)!.token;
  let session = '';
  const guest = c.client(() => session);
  const opened = ok(await guest('/guest/session', { token }));
  session = opened.session;
  const placed = ok(await guest('/guest/orders', { requestId: randomUUID(), tableId: m2.id, lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000, guestContext: opened.guestContext }));
  // The kitchen sees it (once the guest's change window has ended, 17 Ekim) but cannot start it before its shift; the owner
  // can, without a shift.
  c.set('2026-10-05T07:01:30Z');
  const kitchenView = ok(await kitchen('/staff/state'));
  const o = kitchenView.orders.find((x: any) => x.id === placed.orderId);
  assert.ok(o, 'the kitchen screen still reads the orders');
  assert.equal((await kitchen('/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status: 'preparing' })).data.code, 'SHIFT_REQUIRED');
  assert.equal(ok(await kitchen('/staff/shifts/me')).tracking, true);
  ok(await kitchen('/staff/heartbeat', {}));
  ok(await owner('/staff/orders', { requestId: randomUUID(), tableId: m1.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }));
  assert.equal((await waiter('/staff/orders', { requestId: randomUUID(), tableId: m1.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 })).data.code, 'SHIFT_REQUIRED');
  // The kitchen types the counter's code and works on.
  const code = ok(await cashier('/staff/shifts/code')).code;
  ok(await kitchen('/staff/shifts/start', { code }));
  c.set('2026-10-05T07:10:00Z'); // after the guest's change window
  ok(await kitchen('/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status: 'preparing' }));
  assert.equal(ok(await guest('/guest/state')).orders.find((x: any) => x.id === placed.orderId).status, 'preparing', 'the guest sees the kitchen start');
  // A second guest order arrives while the kitchen works; the owner serves without a shift.
  const again = ok(await guest('/guest/orders', { requestId: randomUUID(), tableId: m2.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500, guestContext: opened.guestContext }));
  assert.equal(again.accountId, placed.accountId);
});
