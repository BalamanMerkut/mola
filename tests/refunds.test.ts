import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { starterState } from '../server/starter-template.js';
import { licensed, temp } from './merkez-fixture.js';
import { adjustPayment, declineRefundRequest, refundableItems, requestRefund, stateRefundAccount } from '../packages/domain/payment-adjustments.js';
import { cashierRefundProblem, itemRefundTotal, pastDayNote, refundPower, refundReasonProblem, refundReasonText, splitRefund } from '../packages/domain/refund-rules.js';
import { cashierExpenseAlerts, expenseDayLevel } from '../packages/domain/expense-rules.js';
import { productSales, financialReport } from '../packages/domain/reports.js';
import { stateRecords, summarize } from '../packages/domain/history.js';
import { profitReport } from '../packages/domain/profit.js';
import { requestServiceCall, publicCalls, resolveServiceCall, publicBillMethods } from '../packages/domain/service-calls.js';
import { windowFigures } from '../packages/domain/cash.js';
import { tillNoticeText } from '../packages/domain/till-notices.js';
import type { Actor, Expense, Order, OrderLine, Payment, State } from '../packages/domain/types.js';

/*
 * Ürün bazlı iade, kasiyerin küçük iadesi ve sahibe iade isteği, kasiyerin nakit gider uyarısı (tek seferde / gün içinde
 * toplam), hesap isterken nakit / kart, gün sonundan sonra satış ("Ek kapanış").
 */
const T0 = '2026-10-02T10:00:00.000Z', DAY = '2026-10-02';
const ctx = (iso = '2026-10-02T12:00:00.000Z') => ({ now: new Date(iso), id: randomUUID });
const owner: Actor = { tenantId: 't', id: 'owner', role: 'owner' }, cashier: Actor = { tenantId: 't', id: 'kasa', role: 'cashier' };
const line = (id: string, productId: string, name: string, unitPrice: number, quantity: number, extra: Partial<OrderLine> = {}): OrderLine => ({ id, productId, name, code: '1', optionNames: [], selections: [], unitPrice, quantity, total: unitPrice * quantity, ...extra });
const pay = (id: string, accountId: string, amount: number, method: Payment['method'] = 'cash', extra: Partial<Payment> = {}): Payment => ({ id, accountId, amount, tendered: amount, change: 0, method, commission: 0, createdAt: T0, ...extra });
/**
 * One closed bill of ₺300: 2 latte at the campaign price ₺80 (menu ₺100) and 4 teas at ₺35, paid as two amounts (₺100 and ₺200).
 * A second bill paid by choosing items: 1 of its 3 teas.
 */
function bill() {
  const s = starterState('t', 'T');
  s.staffUsers = [{ id: 'owner', name: 'Sahip', role: 'owner' }, { id: 'kasa', name: 'Ayşe', role: 'cashier' }, { id: 'garson', name: 'Ali', role: 'waiter' }, { id: 'mudur', name: 'Mehmet', role: 'manager' }] as unknown as State['staffUsers'];
  s.accounts = [{ id: 'acc', tableId: s.tables[0].id, status: 'closed', version: 3, openedAt: T0 }, { id: 'acc2', tableId: s.tables[1].id, status: 'open', version: 2, openedAt: T0 }];
  const order = (id: string, accountId: string, lines: OrderLine[]): Order => ({ id, number: 1, accountId, guestId: 'garson', guestLabel: 'Ali', source: 'staff', createdAt: T0, status: 'served', version: 1, menuRevision: 1, lines, total: lines.reduce((n, l) => n + l.total, 0), cancelRequested: false });
  s.orders = [order('o1', 'acc', [line('l-latte', 'latte', 'Latte', 8000, 2, { originalUnitPrice: 10000, campaigns: [{ id: 'c1', name: 'Latte günü' }] }), line('l-tea', 'tea', 'Demleme Çay', 3500, 4)]),
    order('o2', 'acc2', [line('l2-tea', 'tea', 'Demleme Çay', 3500, 3)])];
  s.payments = [pay('p1', 'acc', 10000), pay('p2', 'acc', 20000, 'card'), pay('p3', 'acc2', 3500, 'cash', { selections: [{ orderId: 'o2', lineId: 'l2-tea', quantity: 1 }] })];
  return s;
}
const refund = (s: State, actor: Actor, b: { paymentId: string; amount: number; items?: { orderId: string; lineId: string; quantity: number }[]; method?: 'cash' | 'card'; restock?: boolean; fromRequest?: string }, limits?: { usedToday: number }, at?: string) =>
  adjustPayment(s, actor, { requestId: randomUUID(), revision: (s.paymentAdjustments ?? []).filter(a => a.paymentId === b.paymentId).length, kind: 'refund', method: b.method ?? 'cash', commission: 0, reasons: ['disliked'], ...b }, ctx(at), undefined, limits);
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as { code?: string }).code; } return 'OK'; };

test('item refunds: the paid (campaign) price, capped at what the payment still has, shared over the items kuruş exact', () => {
  const s = bill();
  const offered = refundableItems('p1', stateRefundAccount(s, { accountId: 'acc' }));
  assert.deepEqual(offered.map(i => [i.name, i.unit, i.paid, i.left]), [['Latte', 8000, 2, 2], ['Demleme Çay', 3500, 4, 4]], 'an amount payment offers the whole bill at the prices paid (₺80, not the menu ₺100)');
  // 1 latte + 2 teas = ₺150, but this payment was ₺100: the refund stops at ₺100.
  assert.deepEqual(itemRefundTotal(offered, { 'l-latte': 1, 'l-tea': 2 }, 10000), { value: 15000, amount: 10000, capped: true });
  assert.equal(code(() => refund(s, owner, { paymentId: 'p1', amount: 15000, items: [{ orderId: 'o1', lineId: 'l-latte', quantity: 1 }, { orderId: 'o1', lineId: 'l-tea', quantity: 2 }] })), 'REFUND_CHANGED', 'never more than was paid');
  const r = refund(s, owner, { paymentId: 'p1', amount: 10000, items: [{ orderId: 'o1', lineId: 'l-latte', quantity: 1 }, { orderId: 'o1', lineId: 'l-tea', quantity: 2 }] });
  assert.equal(r.amount, 10000); assert.deepEqual(r.items!.map(i => [i.name, i.quantity, i.amount]), [['Latte', 1, 5334], ['Demleme Çay', 2, 4666]]);
  assert.equal(r.reason, 'Beğenilmedi'); assert.equal(r.role, 'owner'); assert.equal(r.byName, 'Sahip');
  assert.equal(code(() => refund(s, owner, { paymentId: 'p1', amount: 3500, items: [{ orderId: 'o1', lineId: 'l-tea', quantity: 1 }] })), 'INVALID_AMOUNT', 'nothing left on this payment');
  // The other amount payment of the same bill shares the item refunds: 1 latte and 2 teas are still refundable.
  const second = refundableItems('p2', stateRefundAccount(s, { accountId: 'acc' }));
  assert.deepEqual(second.map(i => [i.name, i.left]), [['Latte', 1], ['Demleme Çay', 2]]);
  assert.equal(code(() => refund(s, owner, { paymentId: 'p2', amount: 7000, items: [{ orderId: 'o1', lineId: 'l-tea', quantity: 3 }] })), 'ITEMS_CHANGED', 'never more pieces than are left');
  assert.equal(refund(s, owner, { paymentId: 'p2', amount: 8000, items: [{ orderId: 'o1', lineId: 'l-latte', quantity: 1 }], method: 'card' }).amount, 8000);
  // Paid by choosing items: only those items.
  assert.deepEqual(refundableItems('p3', stateRefundAccount(s, { accountId: 'acc2' })).map(i => [i.name, i.paid]), [['Demleme Çay', 1]]);
  // Amount refunds stay available.
  assert.equal(refund(s, owner, { paymentId: 'p2', amount: 500 }).amount, 500);
  assert.equal(code(() => refund(s, owner, { paymentId: 'p2', amount: 20000 })), 'INVALID_AMOUNT');
  // A platform payment is refunded by the platform.
  s.payments.push(pay('px', 'acc', 1000, 'platform'));
  assert.equal(code(() => refund(s, owner, { paymentId: 'px', amount: 1000 })), 'PLATFORM_PAYMENT');
  assert.deepEqual(splitRefund([100, 100, 100], 100), [34, 33, 33]);
  assert.deepEqual(splitRefund([500, 300], 900), [500, 300]);
  assert.equal(refundReasonText(['wrong', 'other'], 'Soğuk geldi'), 'Yanlış ürün · Soğuk geldi');
  assert.equal(refundReasonProblem(['other'], ''), '“Diğer” için kısa bir açıklama yazın.');
  assert.equal(refundReasonProblem([], ''), 'İadenin nedenini seçin.');
});

test('reports: refunded items leave the product\'s sales (Ürünler, Kârlılık) on the payment\'s day; amount refunds only the money', () => {
  const s = bill();
  refund(s, owner, { paymentId: 'p1', amount: 10000, items: [{ orderId: 'o1', lineId: 'l-latte', quantity: 1 }, { orderId: 'o1', lineId: 'l-tea', quantity: 2 }] }, undefined, '2026-10-03T12:00:00.000Z');
  refund(s, owner, { paymentId: 'p2', amount: 500 }, undefined, '2026-10-03T12:00:00.000Z');
  const products = productSales(s, DAY, DAY), latte = products.products.find(p => p.id === 'latte')!, tea = products.products.find(p => p.id === 'tea')!;
  assert.deepEqual([latte.qty, latte.amount, latte.returned], [1, 16000 - 5334, 1]);
  assert.deepEqual([tea.qty, tea.amount, tea.returned], [5, 7 * 3500 - 4666, 2], 'two bills of tea (7), two refunded');
  // The money counts on the refund's day (3 October), the products on the sale's day (2 October).
  assert.equal(financialReport(s, DAY, DAY).refundTotal, 0);
  assert.equal(financialReport(s, '2026-10-03', '2026-10-03').refundTotal, 10500);
  assert.equal(productSales(s, '2026-10-03', '2026-10-03').products.length, 0, 'no negative rows on the refund day');
  // Kârlılık: revenue and pieces drop; with no recipes the cost stays unknown.
  const days = summarize(stateRecords(s), Date.parse('2026-10-02T02:00:00Z'), Date.parse('2026-10-03T02:00:00Z'));
  const profit = profitReport({ from: DAY, to: DAY, days, products: s.products, data: { items: [], recipes: [], entries: [] }, now: Date.parse('2026-10-03T12:00:00Z') });
  const row = profit.rows.find(r => r.id === 'latte')!;
  assert.deepEqual([row.quantity, row.revenue], [1, 16000 - 5334]);
  // Stock never changes from a refund alone: the day's sold products (what Stok consumes) are untouched.
  assert.equal([...days.values()][0].products.get('latte')!.quantity, 2);
});

test('cashier small refunds: per refund and per cash day; above them only a request to the owner; Müdür and owner unlimited', () => {
  const s = bill();
  assert.equal(refundPower('owner'), 'full'); assert.equal(refundPower('manager'), 'full'); assert.equal(refundPower('cashier'), 'limited'); assert.equal(refundPower('waiter'), 'none'); assert.equal(refundPower('kitchen'), 'none');
  // Defaults: ₺150 per refund, ₺500 a day.
  assert.equal(refund(s, cashier, { paymentId: 'p2', amount: 3500, items: [{ orderId: 'o1', lineId: 'l-tea', quantity: 1 }] }, { usedToday: 0 }).role, 'cashier');
  assert.equal(code(() => refund(s, cashier, { paymentId: 'p2', amount: 16000, items: [{ orderId: 'o1', lineId: 'l-latte', quantity: 2 }] }, { usedToday: 0 })), 'OWNER_REQUIRED', 'above ₺150');
  assert.equal(code(() => refund(s, cashier, { paymentId: 'p2', amount: 3500, items: [{ orderId: 'o1', lineId: 'l-tea', quantity: 1 }] }, { usedToday: 48000 })), 'OWNER_REQUIRED', 'the day\'s ₺500 would be passed');
  assert.match(cashierRefundProblem(3500, 48000, { max: 15000, day: 50000 }), /bugünkü iade sınırı ₺500/);
  s.cashShift = { cashierRefundMax: 0 };
  assert.equal(code(() => refund(s, cashier, { paymentId: 'p2', amount: 100 }, { usedToday: 0 })), 'OWNER_REQUIRED', '0 = the cashier refunds nothing alone');
  assert.equal(code(() => adjustPayment(s, cashier, { requestId: randomUUID(), paymentId: 'p1', revision: 0, kind: 'method', amount: 0, method: 'card', commission: 0, reason: 'x' }, ctx())), 'FORBIDDEN', 'method corrections: owner and Müdür');
  assert.equal(code(() => refund(s, { tenantId: 't', id: 'garson', role: 'waiter' }, { paymentId: 'p2', amount: 100 })), 'FORBIDDEN');
  assert.equal(refund(s, { tenantId: 't', id: 'mudur', role: 'manager' }, { paymentId: 'p2', amount: 16000, items: [{ orderId: 'o1', lineId: 'l-latte', quantity: 2 }] }).amount, 16000, 'Müdür: full refunds');

  // The request: checked like a refund, kept for the owner, who does it (once) or declines it.
  const t = bill(), base = { requestId: randomUUID(), paymentId: 'p2', amount: 16000, method: 'card' as const, reasons: ['wrong' as const], items: [{ orderId: 'o1', lineId: 'l-latte', quantity: 2 }], restock: true };
  const stored = () => ({ payment: t.payments.find(p => p.id === 'p2'), history: (t.paymentAdjustments ?? []).filter(a => a.paymentId === 'p2'), account: stateRefundAccount(t, { accountId: 'acc' }), tableName: 'Masa 01' });
  const req = requestRefund(t, cashier, base, ctx(), stored());
  assert.deepEqual([req.status, req.amount, req.byName, req.items![0].quantity, req.restock], ['pending', 16000, 'Ayşe', 2, true]);
  assert.equal(code(() => requestRefund(t, owner, { ...base, requestId: randomUUID() }, ctx(), stored())), 'FORBIDDEN', 'the owner simply does it');
  assert.equal(code(() => requestRefund(t, cashier, { ...base, requestId: randomUUID(), amount: 100 }, ctx(), stored())), 'REFUND_CHANGED');
  assert.equal(code(() => refund(t, cashier, { paymentId: 'p2', amount: 16000, items: base.items, fromRequest: req.id }, { usedToday: 0 })), 'FORBIDDEN', 'a cashier cannot answer their own request');
  const done = refund(t, owner, { paymentId: 'p2', amount: 16000, items: base.items, method: 'card', restock: true, fromRequest: req.id });
  assert.equal(done.fromRequest, req.id); assert.equal(done.restock, true);
  assert.deepEqual([t.refundRequests![0].status, t.refundRequests![0].adjustmentId, t.refundRequests![0].decidedBy], ['done', done.id, 'Sahip']);
  assert.equal(code(() => refund(t, owner, { paymentId: 'p2', amount: 3500, items: [{ orderId: 'o1', lineId: 'l-tea', quantity: 1 }], fromRequest: req.id })), 'REQUEST_DONE');
  // ₺20.000 − ₺16.000 already refunded: 2 teas (₺70) make a ₺40 refund.
  const other = requestRefund(t, cashier, { ...base, requestId: randomUUID(), amount: 4000, items: [{ orderId: 'o1', lineId: 'l-tea', quantity: 2 }] }, ctx(), stored());
  assert.equal(code(() => declineRefundRequest(t, cashier, { id: other.id }, ctx())), 'FORBIDDEN');
  assert.deepEqual([declineRefundRequest(t, owner, { id: other.id, note: 'Ürün tüketilmiş' }, ctx()).status, other.declineNote], ['declined', 'Ürün tüketilmiş']);
});

test('cash closing: a cashier\'s refunds are their own line inside "Nakit iade", and every refund is listed with who and what', () => {
  const from = Date.parse('2026-10-02T02:00:00Z'), to = Date.parse('2026-10-02T20:00:00Z');
  const { figures, refunds } = windowFigures(0, { payments: [{ method: 'cash', amount: 30000, createdAt: T0 }], expenses: [], movements: [], tips: [],
    refunds: [{ id: 'a', kind: 'refund', method: 'cash', amount: 3500, createdAt: '2026-10-02T11:00:00Z', role: 'cashier', byName: 'Ayşe', text: '1 × Demleme Çay' }, { id: 'b', kind: 'refund', method: 'cash', amount: 2000, createdAt: '2026-10-02T12:00:00Z', role: 'owner', byName: 'Sahip', text: 'Soğuk' }, { id: 'c', kind: 'refund', method: 'card', amount: 1000, createdAt: '2026-10-02T13:00:00Z', role: 'cashier', byName: 'Ayşe' }] }, from, to);
  assert.deepEqual([figures.cashRefunds, figures.cashierRefunds, figures.cardRefunds, figures.expected], [5500, 3500, 1000, 30000 - 5500]);
  assert.deepEqual(refunds.map(r => [r.byName, r.cashier, r.method, r.text]), [['Ayşe', true, 'cash', '1 × Demleme Çay'], ['Sahip', false, 'cash', 'Soğuk'], ['Ayşe', true, 'card', '']]);
  assert.equal(windowFigures(0, { payments: [], refunds: [], expenses: [], movements: [], tips: [] }, from, to).figures.cashierRefunds, undefined, 'older closings stay as they were');
});

test('cashier cash expense warnings: one above "Tek seferde", and the day\'s total crossing "Gün içinde toplam" once, again when it doubles', () => {
  const e = (amount: number, at: string, extra: Partial<Expense> = {}): Expense => ({ id: randomUUID(), amount, description: 'Süt', actorId: 'kasa', actorName: 'Ayşe', createdAt: at, method: 'cash', ...extra });
  assert.deepEqual([expenseDayLevel(50000, 50000), expenseDayLevel(50001, 50000), expenseDayLevel(100001, 50000), expenseDayLevel(200001, 50000), expenseDayLevel(9, null)], [0, 1, 2, 3, 0]);
  // The QA case: 3 × ₺190 under a ₺200 single limit; ₺500 a day catches it once.
  const day: Expense[] = [], alerts: string[] = [];
  for (const [amount, at] of [[19000, '2026-10-02T08:00:00Z'], [19000, '2026-10-02T09:00:00Z'], [19000, '2026-10-02T10:00:00Z'], [19000, '2026-10-02T11:00:00Z']] as const) {
    const x = e(amount, at); day.push(x);
    alerts.push(...cashierExpenseAlerts({ expense: x, dayExpenses: day, day: DAY, single: 20000, dayLimit: 50000 }).map(a => a.key));
  }
  assert.deepEqual(alerts, ['expense-day:kasa:2026-10-02:1'], 'the third crosses ₺500; the fourth (₺760) is not a new step');
  const big = e(30000, '2026-10-02T12:00:00Z'); day.push(big);
  const now = cashierExpenseAlerts({ expense: big, dayExpenses: day, day: DAY, single: 20000, dayLimit: 50000 });
  assert.deepEqual(now.map(a => a.key), [`expense-limit:${big.id}`, 'expense-day:kasa:2026-10-02:2'], 'above ₺200 at once, and ₺1.060 is over twice the day limit');
  assert.match(now[0].text, /Ayşe · “Süt” · 15:00 · Sınır ₺200/); assert.match(now[1].title, /Ayşe bugün ₺1.060 nakit gider yazdı/);
  // Other people's, card, deleted and automatic expenses do not count.
  const others = [e(90000, T0, { actorId: 'x' }), e(90000, T0, { method: 'card' }), e(90000, T0, { deletedAt: T0 }), e(90000, T0, { auto: { ruleId: 'r', day: DAY } })], small = e(100, T0);
  assert.deepEqual(cashierExpenseAlerts({ expense: small, dayExpenses: [...others, small], day: DAY, single: 20000, dayLimit: 50000 }), []);
  assert.deepEqual(cashierExpenseAlerts({ expense: e(90000, T0, { method: 'card' }), dayExpenses: [], day: DAY, single: 20000, dayLimit: 50000 }), [], 'a card expense never warns');
});

test('"Hesabı iste" with Nakit / Kart: the waiting bill call says how the guest pays; a friend can change it; it is optional', () => {
  const s = bill(), table = s.tables[1];
  table.accountId = 'acc2';
  const guest: Actor = { tenantId: 't', id: 'g1', role: 'guest', tableId: table.id, epoch: table.epoch };
  requestServiceCall(s, guest, { requestId: randomUUID(), kind: 'bill', payWith: 'card' }, ctx());
  assert.equal(publicCalls(s)[0].method, 'card');
  requestServiceCall(s, { ...guest, id: 'g2' }, { requestId: randomUUID(), kind: 'bill', payWith: 'cash' }, ctx());
  assert.deepEqual(publicCalls(s).map(c => [c.kind, c.method]), [['bill', 'cash']], 'one call per table, the latest answer wins');
  requestServiceCall(s, guest, { requestId: randomUUID(), kind: 'waiter', payWith: 'card' } as never, ctx());
  assert.equal(publicCalls(s).find(c => c.kind === 'waiter')!.method, undefined, 'only a bill request carries the method');
  // K1 (10 Ekim): answering the call keeps the guest's word until the bill closes (epoch++).
  const billCall = publicCalls(s).find(c => c.kind === 'bill')!;
  resolveServiceCall(s, { tenantId: 't', id: 'w', role: 'owner' } as Actor, { callId: billCall.id }, ctx());
  assert.equal(publicCalls(s).some(c => c.kind === 'bill'), false);
  assert.deepEqual(publicBillMethods(s), [{ tableId: table.id, method: 'cash' }]);
  table.epoch++;
  assert.deepEqual(publicBillMethods(s), [], 'a closed bill forgets it');
});

async function cafe(t: { after: (fn: () => Promise<void>) => void }, start: string) {
  const directory = temp('refunds'), store = new Store(directory); licensed(store);
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
  return { store, client, set: (iso: string) => { clock = new Date(iso); } };
}

test('over HTTP: the cashier\'s small item refund (owner told, closing line, stoğa ekle), a refused big one becomes a request the owner does; Gün sonu then an "Ek kapanış"', async t => {
  const c = await cafe(t, '2026-10-02T09:00:00Z');
  const owner = c.client(), cashier = c.client(), waiter = c.client();
  for (const [who, name] of [[owner, 'isletme'], [cashier, 'kasiyer'], [waiter, 'garson']] as const) assert.equal((await who.login(name)).status, 200);
  await owner('/staff/setup', { requestId: 'refund-setup', version: (await owner('/staff/state')).data.businessRevision ?? 0, name: 'Test Kafe', tableCount: 12, changeSeconds: 0, commissionBps: null });
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 10000 })).status, 200);
  // Stock for tea: 100 g of leaves a glass, 1000 g on the shelf.
  const leaves = (await owner('/staff/stock/items', { name: 'Çay yaprağı', unit: 'g', initial: 1000 })).data.item.id;
  assert.equal((await owner('/staff/stock/recipes', { productId: 'tea', mode: 'recipe', items: [{ itemId: leaves, amount: 100 }] })).status, 200);
  c.set('2026-10-02T09:10:00Z');
  const ordered = await waiter('/staff/orders', { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 4, selections: [] }, { productId: 'latte', quantity: 2, selections: [{ groupId: 'size', optionId: 'regular' }] }], expectedTotal: 4 * 3500 + 2 * (await owner('/staff/state')).data.products.find((p: any) => p.id === 'latte').price });
  assert.equal(ordered.status, 200, JSON.stringify(ordered.data));
  const account = (await cashier('/staff/state')).data.tables.find((x: any) => x.id === 'table-1').account;
  assert.equal((await cashier('/staff/payments', { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'cash', amount: account.balance, tendered: account.balance })).status, 200);

  // The counter's list: today's payments; the payment's items at their paid prices.
  const list = await cashier('/staff/refunds/payments');
  assert.equal(list.status, 200); assert.equal(list.data.rows.length, 1);
  const pid = list.data.rows[0].id, detail = (await cashier(`/staff/refunds/payments/${pid}`)).data;
  const tea = detail.items.find((i: any) => i.productId === 'tea'), latte = detail.items.find((i: any) => i.productId === 'latte');
  assert.deepEqual([tea.unit, tea.left], [3500, 4]);
  assert.deepEqual((await cashier('/staff/refunds/limits')).data, { power: 'limited', max: 15000, day: 50000, usedToday: 0 });
  assert.equal((await waiter('/staff/refunds/payments')).status, 403);

  // A small one: 1 tea, back into stock unused.
  const small = await cashier('/staff/refunds', { requestId: randomUUID(), paymentId: pid, revision: 0, amount: 3500, method: 'cash', reasons: ['wrong'], items: [{ orderId: tea.orderId, lineId: tea.lineId, quantity: 1 }], restock: true });
  assert.equal(small.status, 200, JSON.stringify(small.data)); assert.deepEqual(small.data.stock, { added: ['Demleme Çay'], skipped: [] });
  const stock = (await owner('/staff/stock')).data;
  assert.equal(stock.items.find((i: any) => i.id === leaves).stock, 1000 - 400 + 100, '4 sold (−400 g), 1 back unused (+100 g)');
  const inbox = (await owner('/staff/notifications')).data.items;
  assert.ok(inbox.some((n: any) => n.title === 'Kasiyer iadesi: ₺35 · Masa 01' && /Kasiyer · 1 × Demleme Çay · Yanlış ürün · nakit/.test(n.text)), JSON.stringify(inbox.map((n: any) => n.title)));
  // A big one: refused, the window offers the request instead.
  const big = { requestId: randomUUID(), paymentId: pid, revision: 1, amount: latte.unit * 2, method: 'cash', reasons: ['disliked'], items: [{ orderId: latte.orderId, lineId: latte.lineId, quantity: 2 }] };
  const refused = await cashier('/staff/refunds', big);
  assert.equal(refused.status, 403); assert.equal(refused.data.code, 'OWNER_REQUIRED'); assert.match(refused.data.message, /^Bu iade için işletme sahibi gerekir\. Kasiyer tek seferde en çok ₺150/);
  const { revision: _r, ...ask } = big;
  const asked = await cashier('/staff/refunds/requests', { ...ask, requestId: randomUUID() });
  assert.equal(asked.status, 200, JSON.stringify(asked.data)); assert.equal(asked.data.status, 'pending');
  assert.ok((await owner('/staff/notifications')).data.items.some((n: any) => n.title === `İade isteği: Masa 01 · ₺${latte.unit * 2 / 100}`));
  assert.equal((await cashier('/staff/refunds/requests')).data.requests[0].status, 'pending', 'the cashier sees their own request');
  // The owner does it from İade ve düzeltme.
  const ownerDetail = (await owner(`/staff/payment-adjustments/${pid}/refund`)).data;
  assert.equal(ownerDetail.payment.revision, 1);
  const done = await owner('/staff/payment-adjustments', { requestId: randomUUID(), paymentId: pid, revision: 1, kind: 'refund', commission: 0, amount: latte.unit * 2, method: 'cash', reasons: ['disliked'], items: big.items, fromRequest: asked.data.id });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal((await cashier('/staff/refunds/requests')).data.requests[0].status, 'done');
  // 9 Ekim kullanıcı testi: the handled request's notification is read, so Masalar no longer says "İade isteği … İadeyi yap".
  const after = (await owner('/staff/notifications')).data.items.find((n: any) => n.title.startsWith('İade isteği: Masa 01'));
  assert.equal(after.read, true, 'the handled request is no longer unread');
  // K-A (9 Ekim): the cashier's screen hears of it: "Sahip iadeyi yaptı: Masa 01 · ₺… nakit. Parayı müşteriye verin."
  const strips = (await cashier('/staff/state')).data.tillNotices;
  assert.equal(strips?.length, 1, 'one strip for the cashier');
  assert.deepEqual([strips[0].refundId, strips[0].paymentId, strips[0].tableName, strips[0].amount, strips[0].method, strips[0].byRole], [done.data.id, pid, 'Masa 01', latte.unit * 2, 'cash', 'owner']);
  assert.equal(tillNoticeText({ ...strips[0], money: '₺190' }), 'Sahip iadeyi yaptı: Masa 01 · ₺190 nakit. Parayı müşteriye verin.');
  assert.equal((await owner('/staff/state')).data.tillNotices, undefined, 'never on the screen of the one who did it');
  assert.equal((await waiter('/staff/state')).data.tillNotices, undefined, 'nor a waiter\'s');
  // The yazar kasa card of that refund opens on the cashier's screen.
  const card = await cashier(`/staff/fiscal/payments/${pid}?refund=${done.data.id}`);
  assert.equal(card.status, 200);
  // In Bildirimler too, already read for the owner who did it.
  const doneNote = (await owner('/staff/notifications')).data.items.find((n: any) => n.title === `İade yapıldı: ₺${latte.unit * 2 / 100} · Masa 01`);
  assert.ok(doneNote, 'listed in Bildirimler'); assert.equal(doneNote.read, true);
  assert.match(doneNote.text, /Kasadaki ekrana “Sahip iadeyi yaptı: Masa 01/);
  // ✕ closes it for the cashier only.
  assert.equal((await waiter('/staff/refunds/till-notices/seen', { id: strips[0].id })).status, 403);
  assert.equal((await cashier('/staff/refunds/till-notices/seen', { id: strips[0].id })).status, 200);
  assert.equal((await cashier('/staff/state')).data.tillNotices, undefined);
  // The cashier's own refunds never make a strip.
  assert.equal((await cashier('/staff/state')).data.tillNotices, undefined);
  // Products: 3 teas and no latte sold; the money: two refunds today.
  const products = (await owner(`/staff/reports/products?from=2026-10-02&to=2026-10-02`)).data.products;
  assert.deepEqual(products.filter((p: any) => ['tea', 'latte'].includes(p.id)).map((p: any) => [p.id, p.qty, p.returned]).sort(), [['latte', 0, 2], ['tea', 3, 1]]);
  // The cash closing: the cashier's ₺35 on its own line, both refunds listed with who.
  c.set('2026-10-02T19:00:00Z');
  const count = await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 10000 + account.balance - 3500 - latte.unit * 2, pos: null });
  assert.equal(count.status, 200, JSON.stringify(count.data));
  const counted = (await owner(`/staff/cash/closing/${count.data.id}`)).data.closing;
  assert.deepEqual([counted.figures.cashierRefunds, counted.figures.cashRefunds, counted.difference], [3500, 3500 + latte.unit * 2, 0]);
  assert.deepEqual(counted.refunds.map((r: any) => [r.byName, r.cashier, r.text]), [['Kasiyer', true, '1 × Demleme Çay'], ['İşletme sahibi', false, `2 × ${latte.name}`]]);
  assert.equal((await cashier('/staff/cash/finish', { id: count.data.id, left: 10000 })).status, 200);
  // The night goes on after gün sonu: the strip asks for an "Ek kapanış", which counts only what came after.
  c.set('2026-10-02T19:30:00Z');
  let status = (await cashier('/staff/cash/status')).data;
  assert.deepEqual([!!status.closedToday, status.afterClose], [true, false]);
  await waiter('/staff/orders', { requestId: randomUUID(), tableId: 'table-2', lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 });
  const late = (await cashier('/staff/state')).data.tables.find((x: any) => x.id === 'table-2').account;
  assert.equal((await cashier('/staff/payments', { requestId: randomUUID(), accountId: late.id, version: late.version, method: 'cash', amount: 7000, tendered: 7000 })).status, 200);
  status = (await cashier('/staff/cash/status')).data;
  assert.equal(status.afterClose, true);
  c.set('2026-10-02T19:45:00Z');
  const extra = await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 17000, pos: null });
  const extraFull = (await owner(`/staff/cash/closing/${extra.data.id}`)).data.closing;
  assert.deepEqual([extra.data.extra, extra.data.day, extraFull.figures.opening, extraFull.figures.cashSales, extraFull.difference], [true, '2026-10-02', 10000, 7000, 0]);
  assert.equal((await cashier('/staff/cash/finish', { id: extra.data.id, left: 17000 })).status, 200);
  status = (await cashier('/staff/cash/status')).data;
  assert.equal(status.afterClose, false);
  // The cashier's refunds are today's payments only.
  c.set('2026-10-03T09:00:00Z'); assert.equal((await cashier.login('kasiyer')).status, 200);
  assert.equal((await cashier(`/staff/refunds/payments/${pid}`)).data.code, 'OWNER_REQUIRED');
});

test('over HTTP: a cashier\'s cash expenses over the day total warn the owner once, again when the total doubles', async t => {
  const c = await cafe(t, '2026-10-02T09:00:00Z');
  const owner = c.client(), cashier = c.client();
  assert.equal((await owner.login('isletme')).status, 200); assert.equal((await cashier.login('kasiyer')).status, 200);
  assert.equal((await owner('/staff/cash/settings', { expenseAlert: 20000, expenseDayAlert: 50000, cashierRefundMax: 10000, cashierRefundDay: 30000 })).status, 200);
  const settings = (await owner('/staff/cash/settings')).data;
  assert.deepEqual([settings.expenseAlert, settings.expenseDayAlert, settings.cashierRefundMax, settings.cashierRefundDay], [20000, 50000, 10000, 30000]);
  assert.equal((await cashier('/staff/cash/settings', { expenseDayAlert: 1 })).status, 403);
  for (let i = 0; i < 6; i++) assert.equal((await cashier('/staff/expenses', { requestId: randomUUID(), amount: 19000, description: `Süt ${i + 1}` })).status, 200);
  const titles = (await owner('/staff/notifications')).data.items.map((n: any) => n.title);
  assert.deepEqual(titles.filter((x: string) => x.includes('nakit gider yazdı')).sort(), ['Kasiyer bugün ₺1.140 nakit gider yazdı', 'Kasiyer bugün ₺570 nakit gider yazdı']);
  assert.equal(titles.filter((x: string) => x.startsWith('Kasiyer gideri sınırı aştı')).length, 0, '₺190 is under ₺200 each time');
});

test('9 Ekim kullanıcı testi: refunding an earlier day says it lands today; a closed year (after 1 February) is named', () => {
  const now = Date.parse('2026-10-09T10:00:00+03:00');
  assert.equal(pastDayNote('2026-10-09T09:00:00+03:00', now), '', 'today: nothing');
  assert.equal(pastDayNote('2026-10-09T03:00:00+03:00', now), 'Ödeme 08.10.2026 tarihli; iade bugünün raporuna yazılır, o günün rakamları değişmez.', '03:00 is still the day before (05:00)');
  assert.equal(pastDayNote('2022-10-08T21:00:00+03:00', now), 'Ödeme 08.10.2022 tarihli (kapanmış yıl); iade bugünün raporuna yazılır, o günün rakamları değişmez.');
  // Last year's December before 1 February: that year is not closed yet.
  assert.equal(pastDayNote('2025-12-20T12:00:00+03:00', Date.parse('2026-01-15T12:00:00+03:00')), 'Ödeme 20.12.2025 tarihli; iade bugünün raporuna yazılır, o günün rakamları değişmez.');
  assert.match(pastDayNote('2025-12-20T12:00:00+03:00', Date.parse('2026-02-02T12:00:00+03:00')), /\(kapanmış yıl\)/);
});
