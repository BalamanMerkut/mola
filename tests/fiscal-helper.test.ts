import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { closingTicket } from '../server/cash-closing.js';
import { allocateBill, allocateRefund, splitByRate, type RateLine } from '../packages/domain/vat.js';
import { billEntries, fiscalSettings, fiscalSummary, kasaMoney, refundEntry, withMarks, zCompare, zExplanation, ticksUsed, FISCAL_LIST_MAX, type FiscalEntry } from '../packages/domain/fiscal.js';
import type { Order, Payment } from '../packages/domain/types.js';
import type { CashClosing } from '../packages/domain/cash.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * Yazar kasa yardımcısı: per-rate amounts of payments (full, part, split, by item, with campaign prices), kuruş-exact
 * rounding, refunds, online platform payments (never guessed), the closing's totals, the Z raporu difference and the
 * "not entered" list; then the same through the server: the card's numbers, "Girildi", the closing and the slip.
 */
const line = (id: string, rate: number, unitPrice: number, quantity = 1, orderId = 'o1'): RateLine => ({ orderId, lineId: id, rate, unitPrice, quantity, total: unitPrice * quantity });
const sum = (rows: { amount: number }[]) => rows.reduce((n, r) => n + r.amount, 0);

test('a bill per KDV rate: full, part and split payments add up exactly, item payments take their items, earlier items are not counted twice', () => {
  const coffee = line('l1', 10, 34700), beer = line('l2', 20, 12000);
  // Whole bill: each rate its own part.
  assert.deepEqual(allocateBill([coffee, beer], [{ id: 'p', amount: 46700 }], 10).get('p'), [{ rate: 10, amount: 34700 }, { rate: 20, amount: 12000 }]);
  // One rate only: the whole amount on that department.
  assert.deepEqual(allocateBill([line('t', 10, 34700)], [{ id: 'p', amount: 34700 }], 10).get('p'), [{ rate: 10, amount: 34700 }]);
  // "Bir kısmı" then the rest: proportional to what is still owed, to the kuruş, and together exactly the bill.
  const bill = [line('a', 10, 10000), line('b', 20, 5000)];
  const split = allocateBill(bill, [{ id: 'p1', amount: 10001 }, { id: 'p2', amount: 4999 }], 10);
  assert.deepEqual(split.get('p1'), [{ rate: 10, amount: 6667 }, { rate: 20, amount: 3334 }], 'largest remainder gets the odd kuruş');
  assert.deepEqual(split.get('p2'), [{ rate: 10, amount: 3333 }, { rate: 20, amount: 1666 }]);
  assert.equal(sum(split.get('p1')!), 10001); assert.equal(sum(split.get('p2')!), 4999);
  // Three-way split of an awkward total: every part exact, the rates still add up to the bill.
  const three = allocateBill([line('x', 1, 333), line('y', 10, 333), line('z', 20, 334)], [{ id: 'a', amount: 333 }, { id: 'b', amount: 333 }, { id: 'c', amount: 334 }], 10);
  for (const [id, amount] of [['a', 333], ['b', 333], ['c', 334]] as const) assert.equal(sum(three.get(id)!), amount, id);
  for (const [rate, amount] of [[1, 333], [10, 333], [20, 334]]) assert.equal([...three.values()].flat().filter(r => r.rate === rate).reduce((n, r) => n + r.amount, 0), amount, `%${rate}`);
  // "Ürün seç": the coffee paid by item, then the rest as an amount is only the beer.
  const items = allocateBill([coffee, beer], [{ id: 'i', amount: 34700, selections: [{ orderId: 'o1', lineId: 'l1', quantity: 1 }] }, { id: 'r', amount: 12000 }], 10);
  assert.deepEqual(items.get('i'), [{ rate: 10, amount: 34700 }]); assert.deepEqual(items.get('r'), [{ rate: 20, amount: 12000 }]);
  // Campaign prices: the line's discounted unit price is what counts (2 lattes 25% off at 75,00 + one beer).
  const discounted = [{ ...line('c', 10, 7500, 2), total: 15000 }, line('d', 20, 12000)];
  assert.deepEqual(allocateBill(discounted, [{ id: 'p', amount: 27000 }], 10).get('p'), [{ rate: 10, amount: 15000 }, { rate: 20, amount: 12000 }]);
  assert.deepEqual(allocateBill(discounted, [{ id: 'p', amount: 7500, selections: [{ orderId: 'o1', lineId: 'c', quantity: 1 }] }], 10).get('p'), [{ rate: 10, amount: 7500 }]);
  // Nothing to weigh by (a bill with no lines left): the default rate.
  assert.deepEqual(splitByRate(500, [], 10), [{ rate: 10, amount: 500 }]);
});

test('refunds per rate: items at their own rates, an amount in proportion to the payment it reverses', () => {
  assert.deepEqual(allocateRefund({ amount: 3500, items: [{ amount: 3500, rate: 10 }] }, [{ rate: 10, amount: 3500 }, { rate: 20, amount: 12000 }], 10), [{ rate: 10, amount: 3500 }]);
  assert.deepEqual(allocateRefund({ amount: 1000 }, [{ rate: 10, amount: 4308 }, { rate: 20, amount: 11692 }], 10), [{ rate: 10, amount: 269 }, { rate: 20, amount: 731 }]);
  // A capped item refund (the payment had less left): the items' shares scaled to what was given back.
  assert.equal(sum(allocateRefund({ amount: 1000, items: [{ amount: 700, rate: 10 }, { amount: 700, rate: 20 }] }, [], 10)), 1000);
});

const order = (lines: Order['lines'], extra: Partial<Order> = {}): Order => ({ id: 'o1', number: 1, accountId: 'a1', guestId: 'g', guestLabel: 'G', source: 'staff', createdAt: '2026-10-04T08:00:00Z', status: 'served', version: 1, menuRevision: 1, lines, total: lines.reduce((n, l) => n + l.total, 0), cancelRequested: false, ...extra });
const ol = (id: string, productId: string, unitPrice: number, quantity = 1) => ({ id, productId, quantity, selections: [], name: productId, code: '1', optionNames: [], unitPrice, total: unitPrice * quantity });
const pay = (id: string, amount: number, method: Payment['method'], createdAt: string, extra: Partial<Payment> = {}): Payment => ({ id, accountId: 'a1', amount, tendered: amount, change: 0, method, createdAt, commission: null, ...extra });
const rateOf = (id: string) => id === 'beer' ? 20 : 10;

test('a closing window: per-rate total by cash and card, refunds apart, online platform money never guessed, Z difference explained, "Girildi" list', () => {
  const bill = { orders: [order([ol('l1', 'latte', 3500, 2), ol('l2', 'beer', 19000)]), order([ol('x', 'cake', 5000)], { id: 'o2', status: 'cancelled' })], payments: [pay('p1', 10000, 'cash', '2026-10-04T09:00:00Z'), pay('p2', 16000, 'card', '2026-10-04T09:05:00Z')], tableName: 'Masa 4' };
  const entries = billEntries(bill, rateOf, 10);
  assert.deepEqual(entries.map(e => [e.id, e.rows]), [['p1', [{ rate: 10, amount: 2692 }, { rate: 20, amount: 7308 }]], ['p2', [{ rate: 10, amount: 4308 }, { rate: 20, amount: 11692 }]]], 'the cancelled cake is not on the bill');
  assert.equal(entries[0].tableName, 'Masa 4');
  // Online platform payment: no amounts, only the advice.
  const platform = billEntries({ orders: [order([ol('k', 'burger', 30000)], { id: 'o9', accountId: 'a9' })], payments: [pay('pp', 30000, 'platform', '2026-10-04T10:00:00Z', { accountId: 'a9' })] }, rateOf, 10)[0];
  assert.equal(platform.method, 'platform'); assert.deepEqual(platform.rows, []);
  const refund = refundEntry({ id: 'r1', paymentId: 'p2', amount: 1000, method: 'card', createdAt: '2026-10-04T11:00:00Z' }, entries[1], rateOf, 10);
  assert.deepEqual(refund.rows, [{ rate: 10, amount: 269 }, { rate: 20, amount: 731 }]);
  const itemRefund = refundEntry({ id: 'r2', paymentId: 'p1', amount: 3500, method: 'cash', createdAt: '2026-10-04T11:30:00Z', items: [{ orderId: 'o1', lineId: 'l1', productId: 'latte', name: 'Latte', quantity: 1, amount: 3500 }] }, entries[0], rateOf, 10);
  assert.deepEqual(itemRefund.rows, [{ rate: 10, amount: 3500 }]);

  const all: FiscalEntry[] = [...entries, platform, refund];
  const f = fiscalSummary(all, id => id === 'p1');
  assert.deepEqual(f.rows, [{ rate: 10, amount: 7000 }, { rate: 20, amount: 19000 }]);
  assert.equal(f.total, 26000); assert.equal(f.cash, 10000); assert.equal(f.card, 16000); assert.equal(f.platform, 30000, 'apart, never in the total');
  assert.equal(f.refunds, 1000); assert.deepEqual(f.refundRows, [{ rate: 10, amount: 269 }, { rate: 20, amount: 731 }]);
  assert.equal(f.count, 3, 'two payments and a refund; the platform payment is not entered on the yazar kasa');
  assert.equal(f.entered, 1); assert.deepEqual(f.open.map(o => [o.id, o.kind, o.tableName]), [['p2', 'payment', 'Masa 4'], ['r1', 'refund', 'Masa 4']]);
  assert.equal(ticksUsed(f), true); assert.equal(ticksUsed(fiscalSummary(entries, () => false)), false, 'nobody ticks and nobody is asked: no list');
  assert.equal(ticksUsed(fiscalSummary(entries, () => false, true)), true);
  // Ticks after the count leave the list.
  const later = withMarks(f, id => id === 'r1');
  assert.deepEqual(later.open.map(o => o.id), ['p2']); assert.equal(later.entered, 2);
  // The Z raporu: equal, short, short by exactly the refunds, over; per rate when typed.
  assert.equal(zCompare(f, { total: 26000 }).difference, 0); assert.match(zExplanation(f, zCompare(f, { total: 26000 })), /aynı/);
  const short = zCompare(f, { total: 23400, rates: [{ rate: 20, amount: 19000 }, { rate: 10, amount: 4400 }] });
  assert.equal(short.difference, -2600); assert.deepEqual(short.rateDifferences, [{ rate: 10, amount: -2600 }, { rate: 20, amount: 0 }]);
  assert.match(zExplanation(f, short), /₺26,00 az\. Fark varsa fiş kesilmemiş hesap olabilir/);
  assert.match(zExplanation(f, zCompare(f, { total: 25000 })), /iadeler kadar/);
  assert.match(zExplanation(f, zCompare(f, { total: 26100 })), /fazla/);
  // A long day: the list keeps the first FISCAL_LIST_MAX and counts the rest.
  const many = Array.from({ length: FISCAL_LIST_MAX + 5 }, (_, i) => ({ ...entries[0], id: `m${i}`, at: `2026-10-04T12:${String(i % 60).padStart(2, '0')}:00Z` }));
  const big = fiscalSummary(many, () => false, true);
  assert.equal(big.open.length, FISCAL_LIST_MAX); assert.equal(big.more, 5); assert.equal(big.count, FISCAL_LIST_MAX + 5);
  assert.equal(kasaMoney(34700), '₺347,00'); assert.equal(kasaMoney(1840000), '₺18.400,00');
  assert.deepEqual(fiscalSettings(undefined), { enabled: false, askConfirm: false }, 'off by default since 11 Ekim (the owner turns it on)');
  assert.deepEqual(fiscalSettings({ fiscalHelper: true }), { enabled: true, askConfirm: false }, 'on: "Girildi" not asked unless chosen');
  assert.deepEqual(fiscalSettings({ fiscalHelper: false, fiscalConfirm: true }), { enabled: false, askConfirm: false });
});

async function cafe(t: { after: (fn: () => Promise<void>) => void }, start: string) {
  const store = new Store(temp('fiscal')); licensed(store);
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

test('server: the card after each payment and refund, "Girildi", the gün sonu comparison with the Z raporu, the slip and the switch', async t => {
  const c = await cafe(t, '2026-10-04T06:00:00Z');
  const owner = c.client(), cashier = c.client(), waiter = c.client();
  for (const [who, name] of [[owner, 'isletme'], [cashier, 'kasiyer'], [waiter, 'garson']] as const) assert.equal((await who.login(name)).status, 200);
  assert.equal((await owner('/staff/vat/apply', { requestId: randomUUID(), category: 'Tatlılar', rate: 20 })).status, 200, 'cakes at %20');
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 0 })).status, 200);
  assert.equal((await cashier('/staff/cash/settings')).data.fiscalHelper, false, 'off by default since 11 Ekim');
  assert.equal((await owner('/staff/cash/settings', { fiscalHelper: true })).data.fiscalHelper, true);
  const settings = (await cashier('/staff/cash/settings')).data;
  assert.equal(settings.fiscalHelper, true); assert.equal(settings.fiscalConfirm, false);
  c.set('2026-10-04T08:00:00Z');
  const tables = (await owner('/staff/state')).data.tables;
  const order = async (tableId: string, lines: { productId: string; quantity: number }[], expectedTotal: number) => {
    const r = await waiter('/staff/orders', { requestId: randomUUID(), tableId, lines: lines.map(l => ({ ...l, selections: [] })), expectedTotal });
    assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.accountId as string;
  };
  const payment = async (accountId: string, method: 'cash' | 'card', amount: number) => {
    const account = (await cashier('/staff/state')).data.tables.find((x: any) => x.account?.id === accountId).account;
    const r = await cashier('/staff/payments', { requestId: randomUUID(), accountId, version: account.version, method, amount, tendered: amount });
    assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.paymentId as string;
  };
  // Masa 1: 2 çay (%10, ₺70) + San Sebastian (%20, ₺190), paid ₺100 cash, then the rest by card.
  const mixed = await order(tables[0].id, [{ productId: 'tea', quantity: 2 }, { productId: 'cheesecake', quantity: 1 }], 26000);
  const p1 = await payment(mixed, 'cash', 10000), p2 = await payment(mixed, 'card', 16000);
  let card = (await cashier(`/staff/fiscal/payments/${p1}`)).data;
  assert.equal(card.enabled, true); assert.equal(card.askConfirm, false);
  assert.deepEqual(card.entry.rows, [{ rate: 10, amount: 2692 }, { rate: 20, amount: 7308 }]); assert.equal(card.entry.method, 'cash');
  card = (await cashier(`/staff/fiscal/payments/${p2}`)).data;
  assert.deepEqual(card.entry.rows, [{ rate: 10, amount: 4308 }, { rate: 20, amount: 11692 }], 'the bill is closed and in history: still found');
  assert.equal(card.entry.method, 'card'); assert.equal(card.marked, undefined);
  assert.equal((await waiter(`/staff/fiscal/payments/${p1}`)).status, 403, 'the counter only');
  assert.equal((await cashier('/staff/fiscal/payments/nope')).status, 404);
  // "Girildi": kept once with who ticked it.
  const marked = await cashier('/staff/fiscal/mark', { paymentId: p1 });
  assert.equal(marked.status, 200); assert.equal(marked.data.marked.byName, 'Kasiyer');
  assert.equal((await owner('/staff/fiscal/mark', { paymentId: p1 })).data.marked.byName, 'Kasiyer', 'ticking again keeps the first');
  assert.equal((await cashier(`/staff/fiscal/payments/${p1}`)).data.marked.byName, 'Kasiyer');
  // Masa 2: one çay, cash, a single department.
  c.set('2026-10-04T09:00:00Z');
  const p3 = await payment(await order(tables[1].id, [{ productId: 'tea', quantity: 1 }], 3500), 'cash', 3500);
  assert.deepEqual((await cashier(`/staff/fiscal/payments/${p3}`)).data.entry.rows, [{ rate: 10, amount: 3500 }]);
  // A ₺10 card refund of the card payment: reversed in the same proportion.
  c.set('2026-10-04T10:00:00Z');
  const refund = await owner('/staff/payment-adjustments', { requestId: randomUUID(), paymentId: p2, revision: 0, kind: 'refund', amount: 1000, method: 'card', commission: 0, reason: 'Soğuk geldi' });
  assert.equal(refund.status, 200, JSON.stringify(refund.data));
  const back = (await cashier(`/staff/fiscal/payments/${p2}?refund=${refund.data.id}`)).data.entry;
  assert.equal(back.kind, 'refund'); assert.equal(back.method, 'card'); assert.deepEqual(back.rows, [{ rate: 10, amount: 269 }, { rate: 20, amount: 731 }]);

  // Gün sonu: the comparison comes with the count (after it, like the expected cash).
  c.set('2026-10-04T19:30:00Z');
  const counted = await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 13500 });
  assert.equal(counted.status, 200, JSON.stringify(counted.data));
  const f = counted.data.fiscal;
  assert.deepEqual(f.rows, [{ rate: 10, amount: 10500 }, { rate: 20, amount: 19000 }]);
  assert.equal(f.total, 29500); assert.equal(f.cash, 13500); assert.equal(f.card, 16000); assert.equal(f.refunds, 1000);
  assert.equal(f.count, 4); assert.equal(f.entered, 1); assert.deepEqual(f.open.map((o: any) => o.id), [p2, p3, refund.data.id]);
  assert.equal(f.open[0].tableName, tables[0].name);
  // Ticked between the count and "Kapanışı tamamla": off the list in the kept record. The Z raporu is ₺10 short = the refund.
  assert.equal((await cashier('/staff/fiscal/mark', { paymentId: p3 })).status, 200);
  assert.equal((await cashier('/staff/fiscal/mark', { paymentId: p2, refundId: refund.data.id })).status, 200);
  const done = await cashier('/staff/cash/finish', { id: counted.data.id, left: 0, fiscalZ: { total: 28500, rates: [{ rate: 10, amount: 9500 }, { rate: 20, amount: 19000 }] } });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.closing.figures, undefined, 'the cashier gets the yazar kasa part, never the cash result');
  const closing: CashClosing = (await owner(`/staff/cash/closing/${counted.data.id}`)).data.closing;
  assert.deepEqual(done.data.closing.fiscalZ, closing.fiscalZ);
  assert.deepEqual(closing.fiscal!.open.map(o => o.id), [p2]); assert.equal(closing.fiscal!.entered, 3);
  assert.deepEqual(closing.fiscalZ, { total: 28500, rates: [{ rate: 10, amount: 9500 }, { rate: 20, amount: 19000 }], rateDifferences: [{ rate: 10, amount: -1000 }, { rate: 20, amount: 0 }], difference: -1000 });
  assert.match(zExplanation(closing.fiscal!, closing.fiscalZ!), /iadeler kadar/);
  // Immutable like the rest: finishing again keeps the first Z.
  assert.equal((await cashier('/staff/cash/finish', { id: counted.data.id, left: 0, fiscalZ: { total: 1 } })).data.closing.fiscalZ.total, 28500);
  const report = (await owner('/staff/reports/cash-closings?from=2026-10-04&to=2026-10-04')).data;
  assert.equal(report.closings[0].fiscalZ.difference, -1000); assert.equal(report.closings[0].fiscal.total, 29500);
  // The closing slip carries it.
  const slip = JSON.stringify(closingTicket(closing, [], 'Mola'));
  for (const text of ['YAZAR KASA', '%10 departman', '105,00 TL', 'Girilmesi gereken', '295,00 TL', 'Z raporu (KDV dahil)', 'Z farkı', '-10,00 TL', "'Girildi' işaretsiz: 1 kayıt"]) assert.ok(slip.includes(text), text);

  // The switch: only the owner; off = no card and no comparison in the next closing.
  assert.equal((await cashier('/staff/cash/settings', { fiscalHelper: false })).status, 403);
  assert.equal((await owner('/staff/cash/settings', { fiscalHelper: false })).data.fiscalHelper, false);
  assert.deepEqual((await cashier(`/staff/fiscal/payments/${p1}`)).data, { enabled: false, askConfirm: false });
  assert.equal((await owner('/staff/cash/settings', { fiscalHelper: true, fiscalConfirm: true })).data.fiscalConfirm, true);
  assert.equal((await cashier(`/staff/fiscal/payments/${p1}`)).data.askConfirm, true);
  assert.equal((await cashier('/staff/cash/settings')).data.fiscalConfirm, true, 'the counter knows too');
});

test('a closing without any "Girildi" keeps only the count of its payments, not their list (it is never shown)', async t => {
  const c = await cafe(t, '2026-10-04T06:00:00Z');
  const owner = c.client(), cashier = c.client(), waiter = c.client();
  for (const [who, name] of [[owner, 'isletme'], [cashier, 'kasiyer'], [waiter, 'garson']] as const) assert.equal((await who.login(name)).status, 200);
  assert.equal((await owner('/staff/cash/settings', { fiscalHelper: true })).status, 200);
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 0 })).status, 200);
  c.set('2026-10-04T08:00:00Z');
  const tables = (await owner('/staff/state')).data.tables;
  for (const table of tables.slice(0, 3)) {
    const order = await waiter('/staff/orders', { requestId: randomUUID(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
    const account = (await cashier('/staff/state')).data.tables.find((x: any) => x.account?.id === order.data.accountId).account;
    assert.equal((await cashier('/staff/payments', { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'cash', amount: 3500, tendered: 3500 })).status, 200);
  }
  c.set('2026-10-04T19:30:00Z');
  const counted = await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 10500 });
  assert.equal(counted.data.fiscal.open.length, 3, 'the count step still lists them (they could be ticked now)');
  assert.equal((await cashier('/staff/cash/finish', { id: counted.data.id, left: 0 })).status, 200);
  const closing: CashClosing = (await owner(`/staff/cash/closing/${counted.data.id}`)).data.closing;
  assert.deepEqual([closing.fiscal!.open.length, closing.fiscal!.more, closing.fiscal!.count, closing.fiscal!.entered, closing.fiscal!.total], [0, 3, 3, 0, 10500]);
  assert.equal(ticksUsed(closing.fiscal!), false);
  const slip = JSON.stringify(closingTicket(closing, [], 'Mola'));
  assert.ok(slip.includes('Girilmesi gereken') && !slip.includes('işaretsiz'), 'the slip is as before');
  assert.equal((await owner('/staff/reports/cash-closings?from=2026-10-04&to=2026-10-04')).data.closings[0].fiscal.total, 10500);
});