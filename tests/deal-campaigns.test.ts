import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seed } from '../server/seed.js';
import { campaignViews, repriceSavedLine, saleProducts, type Campaign } from '../packages/domain/campaigns.js';
import { balances, cancelByStaff, cancelOrder, changeByStaff, editOrder, moveTable, quote, recordPayment, submitOrder } from '../packages/domain/engine.js';
import { refundableItems, stateRefundAccount } from '../packages/domain/payment-adjustments.js';
import { mergeAccounts } from '../packages/domain/merge.js';
import { reviewOrder } from '../packages/domain/approvals.js';
import { campaignReport } from '../packages/domain/campaign-reports.js';
import { financialReport } from '../packages/domain/reports.js';
import { billTicket, paymentTicket } from '../packages/domain/printing.js';
import { billVatTotal, receiptVat } from '../packages/domain/vat.js';
import { billEntries, rateLookup } from '../packages/domain/fiscal.js';
import { vatSettings } from '../packages/domain/vat.js';
import { basketDealSavings, computeDeals, dealOfferText, giftHints, unitCharges, unitsCost } from '../packages/domain/deals.js';
import type { CartLine, State } from '../packages/domain/types.js';
import { baselineScenario } from './deal-baseline.js';

const start = '2026-09-20T00:00:00Z', now = new Date('2026-09-23T09:00:00Z'); // Wednesday 12:00 in Türkiye
const base = { startsAt: start, endsAt: null, enabled: true, combine: false };
const twoForOne: Campaign = { ...base, id: 'b21', reportId: 'b21-v1', name: 'Çayda 2 al 1 öde', productIds: ['tea'], kind: 'buyPay', buy: 2, pay: 1 };
const coffees32: Campaign = { ...base, id: 'b32', reportId: 'b32-v1', name: 'Kahvede 3 al 2 öde', productIds: [], categories: ['Kahveler'], kind: 'buyPay', buy: 3, pay: 2 };
const secondHalf: Campaign = { ...base, id: 'sec', reportId: 'sec-v1', name: 'İkinci latte', productIds: ['latte'], kind: 'second', percent: 50 };
const gift: Campaign = { ...base, id: 'gift', reportId: 'gift-v1', name: 'Çaya Americano', productIds: ['tea'], kind: 'gift', buy: 2, giftProductId: 'americano' };
const tea = (quantity: number): CartLine => ({ productId: 'tea', quantity, selections: [] });
const latte = (quantity: number, size = 'regular'): CartLine => ({ productId: 'latte', quantity, selections: [{ groupId: 'size', optionId: size }] });
const americano = (quantity: number, size = 'regular'): CartLine => ({ productId: 'americano', quantity, selections: [{ groupId: 'size', optionId: size }] });
const turkish = (quantity: number): CartLine => ({ productId: 'turkish', quantity, selections: [{ groupId: 'sugar', optionId: 'medium' }] });

function fixture(campaigns: Campaign[], at = now) {
  const s = seed(); s.changeSeconds = 600; s.campaigns = structuredClone(campaigns);
  let n = 0; const ctx = { now: at, id: () => `id-${++n}` }, rid = () => `request-${++n}-abcdefgh`;
  const waiter = { tenantId: s.tenantId, id: 'waiter', role: 'waiter' as const }, owner = { tenantId: s.tenantId, id: 'owner', role: 'owner' as const };
  // expectedTotal is the order before account campaigns: the bill is priced with them once the order is on it.
  const submit = (lines: CartLine[], table = 'table-1') => submitOrder(s, waiter, { requestId: rid(), tableId: table, lines, expectedTotal: quote(saleProducts(s, at), lines, ctx).reduce((t, l) => t + l.total, 0) }, ctx);
  const account = (table = 'table-1') => s.accounts.find(a => a.id === s.tables.find(t => t.id === table)!.accountId)!;
  const totals = () => s.orders.map(o => o.total);
  const free = (s2: State = s) => s2.orders.filter(o => o.status !== 'cancelled').flatMap(o => o.lines.flatMap(l => (l.deals ?? []).map(d => [l.productId, d.units, d.off])));
  return { s, ctx, rid, waiter, owner, submit, account, totals, free };
}

test('existing campaigns: the stored scenario prices, cancels, pays and reports exactly as before', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(baselineScenario())), JSON.parse(readFileSync(new URL('./deal-baseline.json', import.meta.url), 'utf8')));
});

test('old campaigns load unchanged: no kind is a percent campaign, no deals appear on menus', () => {
  const { s } = fixture([]);
  s.campaigns = [{ ...base, id: 'old', name: 'Eski', productIds: ['tea'], percent: 10 } as Campaign];
  const p = saleProducts(s, now).find(p => p.id === 'tea')!;
  assert.deepEqual(p.discounts, [{ id: 'old', name: 'Eski', combine: false, reportId: undefined, minQuantity: undefined, kind: 'percent', percent: 10 }]);
  assert.equal('deals' in p, false);
  assert.ok(saleProducts(s, now).every(p => !('deals' in p)));
});

test('2 al 1 öde: 2, 3, 4 and 5 teas in one order', () => {
  for (const [n, freeUnits] of [[1, 0], [2, 1], [3, 1], [4, 2], [5, 2]]) {
    const { s, submit } = fixture([twoForOne]);
    submit([tea(n)]);
    const l = s.orders[0].lines[0];
    assert.equal(l.deals?.[0].units ?? 0, freeUnits, `${n} çay`);
    assert.equal(l.total, (n - freeUnits) * 3500);
    assert.equal(s.orders[0].total, l.total);
    assert.equal(balances(s, s.orders[0].accountId).total, (n - freeUnits) * 3500);
  }
});

test('3 al 2 öde on a category: mixed prices, the cheapest units are free, options included', () => {
  const { s, submit } = fixture([coffees32]);
  // latte 140, americano large 135, türk kahvesi 95: the türk kahvesi is free.
  submit([latte(1), americano(1, 'large'), turkish(1)]);
  assert.deepEqual(s.orders[0].lines.map(l => l.total), [14000, 13500, 0]);
  // Six units: two groups; the two cheapest (95 and one 110) are free.
  submit([americano(2), latte(1, 'large')]);
  assert.equal(balances(s, s.orders[0].accountId).total, 14000 + 13500 + 0 + 11000 + 16500);
  assert.deepEqual(s.orders.flatMap(o => o.lines.map(l => [l.deals?.[0]?.units ?? 0, l.deals?.[0]?.off ?? 0])), [[0, 0], [0, 0], [1, 9500], [1, 11000], [0, 0]]);
});

test('the bill counts every order: a later tea makes the newest one free, the earlier order keeps its price', () => {
  const { s, submit, totals } = fixture([twoForOne]);
  submit([tea(1)]); assert.deepEqual(totals(), [3500]);
  submit([tea(1)]); assert.deepEqual(totals(), [3500, 0]);
  submit([tea(2)]); assert.deepEqual(totals(), [3500, 0, 3500]);
  // Another table is another bill.
  submit([tea(1)], 'table-2'); assert.equal(s.orders[3].total, 3500);
});

test('İkincisi %50: the cheaper of each pair, at half its list price, never discounted twice', () => {
  const p10: Campaign = { ...base, id: 'p10', name: 'Latte %10', productIds: ['latte'], kind: 'percent', percent: 10 };
  const { s, submit } = fixture([secondHalf, p10]);
  submit([latte(1, 'large'), latte(2)]);
  const [large, regular] = s.orders[0].lines;
  // Large 165 → 148,50 with %10; regular 140 → 126. Pairs: (148,50 + 126) → the 126 one at 70; the third (126) has no pair.
  assert.equal(large.unitPrice, 14850); assert.equal(regular.unitPrice, 12600);
  assert.deepEqual(regular.deals?.map(d => [d.units, d.off]), [[1, 5600]]);
  assert.equal(regular.total, 12600 + 7000);
  assert.equal(large.deals, undefined);
  // A deal that would not be cheaper than the campaign price is not applied.
  const { s: s2, submit: submit2 } = fixture([{ ...secondHalf, percent: 5 }, p10]);
  submit2([latte(2)]);
  assert.equal(s2.orders[0].lines[0].deals, undefined); assert.equal(s2.orders[0].total, 25200);
});

test('Hediye ürün: free only when the gift is on the bill, never more than earned', () => {
  const { s, submit, free, totals } = fixture([gift]);
  submit([tea(2)]);
  assert.deepEqual(free(), []);
  assert.deepEqual(giftHints(saleProducts(s, now), s.orders.flatMap(o => o.lines)).map(h => [h.product.id, h.missing]), [['americano', 1]]);
  submit([americano(2, 'large'), americano(1)]);
  // One gift earned: the cheapest Americano (regular, 110) is free; the large ones are paid.
  assert.deepEqual(totals(), [7000, 27000]);
  assert.deepEqual(giftHints(saleProducts(s, now), s.orders.flatMap(o => o.lines)), []);
  submit([tea(2)]);
  // Four teas: two gifts, the next cheapest (large, 135) is free too.
  assert.deepEqual(totals(), [7000, 13500, 7000]);
  assert.deepEqual(free(), [['americano', 1, 13500], ['americano', 1, 11000]]);
});

test('a gift product inside its own condition never pays for itself; the gift in the same order works', () => {
  const coffeeGift: Campaign = { ...base, id: 'cg', name: 'Kahveye Americano', productIds: [], categories: ['Kahveler'], kind: 'gift', buy: 2, giftProductId: 'americano' };
  const { s, submit } = fixture([coffeeGift]);
  submit([americano(2)]);
  assert.equal(s.orders[0].total, 22000);
  submit([americano(1)]);
  // Three Americanos: two count, one is the gift.
  assert.equal(balances(s, s.orders[0].accountId).total, 22000);
  const { s: s2, submit: submit2 } = fixture([gift]);
  submit2([tea(2), americano(1)]);
  assert.deepEqual(s2.orders[0].lines.map(l => l.total), [7000, 0]);
});

test('2 al 1 öde and a gift on the same teas: the teas count for both, each unit is discounted once', () => {
  const { s, submit, totals } = fixture([twoForOne, gift]);
  submit([tea(3)]);
  assert.deepEqual(totals(), [7000]);
  submit([americano(1)]);
  assert.deepEqual(totals(), [7000, 0]);
});

test('outside the schedule or the dates nothing is stamped; the bill keeps what was ordered in the window', () => {
  const weekend: Campaign = { ...twoForOne, schedule: { days: [6, 7], from: '14:00', to: '17:00' }, endsAt: '2026-10-18T00:00:00Z' };
  const { s, submit } = fixture([weekend]);
  submit([tea(2)]);
  assert.equal(s.orders[0].total, 7000);
  assert.equal(saleProducts(s, now).find(p => p.id === 'tea')!.deals, undefined);
  const saturday = new Date('2026-09-26T12:00:00Z');
  const inside = fixture([weekend], saturday);
  inside.submit([tea(1)]); inside.submit([tea(1)]);
  assert.deepEqual(inside.totals(), [3500, 0]);
  const later = fixture([{ ...twoForOne, endsAt: '2026-09-22T00:00:00Z' }]);
  later.submit([tea(2)]); assert.equal(later.s.orders[0].total, 7000);
});

test('quota: counts the free units, across bills', () => {
  const { s, submit, totals } = fixture([{ ...twoForOne, maxQuantity: 2 }]);
  submit([tea(6)]);
  assert.equal(s.orders[0].lines[0].deals![0].units, 2); assert.deepEqual(totals(), [14000]);
  assert.equal(campaignViews(s).find(c => c.id === 'b21')!.usedQuantity, 2);
  submit([tea(2)], 'table-2');
  assert.equal(s.orders[1].total, 7000);
  assert.equal(saleProducts(s, now).find(p => p.id === 'tea')!.deals, undefined);
  // A cancelled order gives its units back.
  const { s: s2, submit: submit2, ctx, waiter } = fixture([{ ...twoForOne, maxQuantity: 1 }]);
  submit2([tea(2)]);
  cancelByStaff(s2, waiter, { requestId: 'request-cancel-1', orderId: s2.orders[0].id, version: s2.orders[0].version, reason: 'Müşteri vazgeçti' }, ctx);
  submit2([tea(2)], 'table-2');
  assert.equal(s2.orders[1].total, 3500);
});

test('cancel, partial cancel, reject and change price the bill again', () => {
  const { s, submit, totals, ctx, waiter, rid } = fixture([twoForOne]);
  submit([tea(1)]); submit([tea(1)]); submit([tea(1)]);
  assert.deepEqual(totals(), [3500, 0, 3500]);
  cancelByStaff(s, waiter, { requestId: rid(), orderId: s.orders[1].id, version: s.orders[1].version, reason: 'Yanlış sipariş' }, ctx);
  // The free tea was cancelled: the newest remaining one becomes free.
  assert.deepEqual(totals(), [3500, 0, 0]); assert.equal(s.orders[2].lines[0].total, 0);
  submit([tea(3)]);
  assert.deepEqual(totals(), [3500, 0, 0, 7000]);
  const o = s.orders[3];
  cancelByStaff(s, waiter, { requestId: rid(), orderId: o.id, version: o.version, reason: 'Müşteri vazgeçti', lines: [{ lineId: o.lines[0].id, quantity: 2 }] }, ctx);
  // Three teas left on the bill: one free (still the same one); the cancelled part keeps its price before the account campaign.
  assert.equal(balances(s, o.accountId).total, 7000); assert.deepEqual(totals(), [3500, 0, 0, 3500]);
  assert.deepEqual(o.cancellations![0].lines.map(l => [l.quantity, l.total, l.deals]), [[2, 7000, undefined]]);
  // A change: the tea becomes an Americano; the other tea is no longer free.
  const first = s.orders[0];
  changeByStaff(s, waiter, { requestId: rid(), orderId: first.id, version: first.version, lineId: first.lines[0].id, line: americano(1), expectedTotal: 11000 }, ctx);
  assert.equal(balances(s, first.accountId).total, 11000 + 3500);
  // A guest's order waiting for approval counts until it is rejected.
  s.waiterApproval = true;
  const guest = { tenantId: s.tenantId, role: 'guest' as const, id: 'guest-1', tableId: 'table-1', epoch: s.tables[0].epoch };
  submitOrder(s, guest, { requestId: rid(), tableId: 'table-1', lines: [tea(1)], expectedTotal: 3500 }, ctx);
  const waiting = s.orders.at(-1)!;
  assert.equal(balances(s, first.accountId).total, 11000 + 3500 + 3500);
  reviewOrder(s, waiter, { requestId: rid(), orderId: waiting.id, version: waiting.version, approve: false, reason: 'Masada yok' }, ctx);
  assert.equal(balances(s, first.accountId).total, 11000 + 3500);
  assert.ok(s.orders.filter(o => o.status !== 'cancelled').every(o => o.total === o.lines.reduce((n, l) => n + l.total, 0)));
});

test('a guest cancelling inside the change window gives the free tea back to the other order', () => {
  const { s, submit, ctx } = fixture([twoForOne]);
  submit([tea(1)]);
  const guest = { tenantId: s.tenantId, role: 'guest' as const, id: 'guest-1', tableId: 'table-1', epoch: s.tables[0].epoch };
  submitOrder(s, guest, { requestId: 'request-guest-1', tableId: 'table-1', lines: [tea(1)], expectedTotal: 3500 }, ctx);
  assert.deepEqual(s.orders.map(o => o.total), [3500, 0]);
  cancelOrder(s, guest, { requestId: 'request-guest-2', orderId: s.orders[1].id, version: s.orders[1].version }, ctx);
  assert.deepEqual(s.orders.map(o => o.total), [3500, 0]);
  assert.equal(balances(s, s.orders[0].accountId).total, 3500);
});

test('paying by items: full-price pieces first, a paid line keeps its free piece, cancels cannot move it', () => {
  const { s, submit, owner, ctx, rid, account, waiter, totals } = fixture([twoForOne]);
  submit([tea(3)]);
  const o = s.orders[0], l = o.lines[0];
  assert.deepEqual(unitCharges(l), [3500, 3500, 0]);
  const a = account();
  assert.throws(() => recordPayment(s, owner, { requestId: rid(), accountId: a.id, version: a.version, method: 'cash', amount: 7000, tendered: 7000, selections: [{ orderId: o.id, lineId: l.id, quantity: 1 }] }, ctx), /tutarı değişti/);
  recordPayment(s, owner, { requestId: rid(), accountId: a.id, version: a.version, method: 'cash', amount: 3500, tendered: 3500, selections: [{ orderId: o.id, lineId: l.id, quantity: 1 }] }, ctx);
  assert.equal(unitsCost(l, 1, 2), 3500);
  // A later tea does not re-price the paid line; it waits for a pair of its own.
  submit([tea(1)]);
  assert.deepEqual(totals(), [7000, 3500]);
  submit([tea(1)]);
  assert.deepEqual(totals(), [7000, 3500, 0]);
  // Cutting an unpaid piece of the paid line would move its free piece: refused.
  assert.throws(() => cancelByStaff(s, waiter, { requestId: rid(), orderId: o.id, version: o.version, reason: 'Müşteri vazgeçti', lines: [{ lineId: l.id, quantity: 1 }] }, ctx), /kampanya fiyatı/);
  const rest = balances(s, a.id).balance;
  assert.equal(rest, 7000 + 3500 + 0 - 3500);
  recordPayment(s, owner, { requestId: rid(), accountId: a.id, version: a.version, method: 'cash', amount: 7000, tendered: 7000, selections: [{ orderId: o.id, lineId: l.id, quantity: 2 }, { orderId: s.orders[1].id, lineId: s.orders[1].lines[0].id, quantity: 1 }, { orderId: s.orders[2].id, lineId: s.orders[2].lines[0].id, quantity: 1 }] }, ctx);
  assert.equal(s.accounts[0].status, 'closed');
  // Campaign money: the paid line's last two pieces (35 + 0) and the free tea (0); the plain tea is regular money.
  assert.deepEqual(s.payments.map(p => p.campaignAmount), [3500, 3500]);
});

test('merging two tables makes one bill: a tea on each, one becomes free; never below what was paid', () => {
  const { s, submit, waiter, ctx, rid, account, owner } = fixture([twoForOne]);
  submit([tea(1)]); submit([tea(1)], 'table-2');
  const a = account(), b = account('table-2');
  mergeAccounts(s, waiter, { requestId: rid(), sourceId: b.id, sourceVersion: b.version, targetId: a.id, targetVersion: a.version }, ctx);
  assert.equal(balances(s, a.id).total, 3500);
  // Both paid as amounts before the merge: pricing again would drop the bill below the money taken, so it stays.
  const x = fixture([twoForOne]), herbal = { productId: 'herbal', quantity: 1, selections: [] };
  x.submit([tea(1), herbal]); x.submit([tea(1), herbal], 'table-2');
  const xa = x.account(), xb = x.account('table-2');
  recordPayment(x.s, owner, { requestId: x.rid(), accountId: xa.id, version: xa.version, method: 'cash', amount: 11500, tendered: 11500 }, x.ctx);
  recordPayment(x.s, owner, { requestId: x.rid(), accountId: xb.id, version: xb.version, method: 'cash', amount: 11500, tendered: 11500 }, x.ctx);
  mergeAccounts(x.s, waiter, { requestId: x.rid(), sourceId: xb.id, sourceVersion: xb.version, targetId: xa.id, targetVersion: xa.version }, x.ctx);
  assert.deepEqual(balances(x.s, xa.id), { total: 24000, paid: 23000, balance: 1000 });
  // Paid as amounts but still covered: the merged bill gets its free tea.
  const y = fixture([twoForOne]);
  y.submit([tea(1), herbal]); y.submit([tea(1), herbal], 'table-2');
  const ya = y.account(), yb = y.account('table-2');
  recordPayment(y.s, owner, { requestId: y.rid(), accountId: ya.id, version: ya.version, method: 'cash', amount: 5000, tendered: 5000 }, y.ctx);
  mergeAccounts(y.s, waiter, { requestId: y.rid(), sourceId: yb.id, sourceVersion: yb.version, targetId: ya.id, targetVersion: ya.version }, y.ctx);
  assert.deepEqual(balances(y.s, ya.id), { total: 20500, paid: 5000, balance: 15500 });
});

test('KDV, receipts and reports read the free pieces', () => {
  const { s, submit, owner, ctx, rid, account } = fixture([twoForOne, gift]);
  s.products.find(p => p.id === 'americano')!.vatRate = 20; s.products.find(p => p.id === 'tea')!.vatRate = 10;
  s.vat = { rates: [10, 20], default: 10 } as State['vat'];
  submit([tea(3), americano(1)]);
  const a = account(), lines = s.orders.flatMap(o => o.lines);
  assert.deepEqual(lines.map(l => [l.vatRate, l.total]), [[10, 7000], [20, 0]]);
  // KDV only on what is charged: the free Americano carries none.
  assert.equal(billVatTotal(s, lines), receiptVat([{ amount: 7000, rate: 10 }]).reduce((n, p) => n + p.vat, 0));
  const bill = billTicket(s, a.id, now).map(op => 'pair' in op ? (op.pair as string[]).join(' = ') : 'text' in op ? op.text : '');
  assert.ok(bill.includes('  2 al 1 öde: -35,00 TL'), bill.join('\n'));
  assert.ok(bill.includes('  Hediye: Americano: -110,00 TL'), bill.join('\n'));
  assert.ok(bill.includes('Kampanya indirimi = -145,00 TL'), bill.join('\n'));
  recordPayment(s, owner, { requestId: rid(), accountId: a.id, version: a.version, method: 'card', amount: 7000, tendered: 7000 }, ctx);
  const receipt = paymentTicket(s, s.payments[0].id, now).map(op => 'text' in op ? op.text : '');
  assert.ok(receipt.includes('  2 al 1 öde: -35,00 TL'), receipt.join('\n'));
  // The yazar kasa sees 70 TL at %10 only.
  const entries = billEntries({ orders: s.orders, payments: s.payments }, rateLookup(s.products, vatSettings(s)), 10);
  assert.deepEqual(entries[0].rows.map(r => [r.rate, r.amount]), [[10, 7000]]);
  const report = campaignReport(s, new Date(+now + 1000)).campaigns;
  const b21 = report.find(c => c.id === 'b21-v1')!, g = report.find(c => c.id === 'gift-v1')!;
  assert.deepEqual([b21.kind, b21.appliedQuantity, b21.appliedAmount, b21.discount], ['buyPay', 1, 0, 3500]);
  assert.deepEqual([g.kind, g.appliedQuantity, g.appliedAmount, g.discount], ['gift', 1, 0, 11000]);
  assert.deepEqual(g.products.map(p => p.id), ['tea', 'americano']);
  const f = financialReport(s, '2026-09-23', '2026-09-23');
  assert.equal(f.campaignDiscount, 14500); assert.equal(f.campaignCollected, 7000);
});

test('the pure rules: rounding to kuruş, never below zero, ties keep the older piece', () => {
  const offer = { id: 's', name: 'İkinci', kind: 'second' as const, percent: 33, counts: true as const };
  const deals = computeDeals([{ key: 'a', quantity: 2, price: 3333, orig: 3333, offers: [offer] }], () => Infinity);
  assert.deepEqual(deals.get('a')!.map(d => [d.units, d.off]), [[1, 1100]]);
  const free = computeDeals([{ key: 'old', quantity: 1, price: 100, orig: 100, offers: [{ id: 'b', name: 'b', kind: 'buyPay', buy: 2, pay: 1, counts: true }] }, { key: 'new', quantity: 1, price: 100, orig: 100, offers: [{ id: 'b', name: 'b', kind: 'buyPay', buy: 2, pay: 1, counts: true }] }], () => Infinity);
  assert.equal(free.get('old'), undefined); assert.deepEqual(free.get('new')!.map(d => d.off), [100]);
});

test('menu words, the waiter hint and the basket estimate', () => {
  const { s, submit } = fixture([twoForOne, gift, secondHalf]);
  const menu = saleProducts(s, now);
  const teaDeals = menu.find(p => p.id === 'tea')!.deals!;
  assert.deepEqual(teaDeals.map(o => dealOfferText(o)), ['2 al 1 öde', '2 Demleme Çay alana Americano bedava']);
  assert.deepEqual(menu.find(p => p.id === 'americano')!.deals!.map(o => dealOfferText(o)), ['2 Demleme Çay alana bedava']);
  assert.deepEqual(menu.find(p => p.id === 'americano')!.deals!.map(o => dealOfferText(o, true)), ['Free with 2 Turkish Tea']);
  assert.equal(dealOfferText(menu.find(p => p.id === 'latte')!.deals![0]), 'İkincisi %50 indirimli');
  submit([tea(2)]);
  const bill = s.orders.flatMap(o => o.lines);
  assert.equal(giftHints(menu, bill)[0].text, 'Americano bedava');
  const price = (_l: unknown, p: { price: number }) => p.price;
  assert.equal(basketDealSavings(menu, bill, [americano(1)], price), 11000);
  assert.equal(basketDealSavings(menu, bill, [tea(1)], price), 0);
  assert.equal(basketDealSavings(menu, [], [tea(2)], price), 3500);
});

test('edits and changes are checked against the screens\' total before account campaigns', () => {
  const { s, submit, ctx, rid, waiter } = fixture([twoForOne]);
  submit([tea(3), latte(1)]);
  const o = s.orders[0];
  assert.equal(o.total, 7000 + 14000);
  // The waiter's change window prices kept lines with repriceSavedLine (src/StaffChange.tsx): 3 × 35 + the new Americano.
  const screen = repriceSavedLine(o.lines[0], 3, 3).total + 11000;
  assert.equal(screen, 10500 + 11000);
  const r = changeByStaff(s, waiter, { requestId: rid(), orderId: o.id, version: o.version, lineId: o.lines[1].id, line: americano(1), expectedTotal: screen }, ctx);
  assert.deepEqual([r.total, r.delta, o.total], [18000, -3000, 18000]);
  assert.equal(o.lines[0].deals![0].units, 1);
  // The guest's edit window the same way (src/OrderEditor.tsx).
  const g = fixture([twoForOne]), guest = { tenantId: g.s.tenantId, role: 'guest' as const, id: 'guest-1', tableId: 'table-1', epoch: 0 };
  submitOrder(g.s, guest, { requestId: g.rid(), tableId: 'table-1', lines: [tea(3)], expectedTotal: 10500 }, g.ctx);
  const go = g.s.orders[0];
  assert.equal(go.total, 7000);
  assert.throws(() => editOrder(g.s, guest, { requestId: g.rid(), orderId: go.id, version: go.version, lines: [{ ...tea(4), existingId: go.lines[0].id }], expectedTotal: 7000 }, g.ctx), /Fiyat değişti/);
  editOrder(g.s, guest, { requestId: g.rid(), orderId: go.id, version: go.version, lines: [{ ...tea(4), existingId: go.lines[0].id }], expectedTotal: repriceSavedLine(go.lines[0], 4, 4).total }, g.ctx);
  assert.deepEqual([go.total, go.lines[0].deals![0].units], [7000, 2]);
});

test('moving the bill keeps its free pieces; an item refund never gives back more than was paid', () => {
  const { s, submit, ctx, rid, waiter, owner, account } = fixture([twoForOne, gift]);
  submit([tea(3), americano(1)]);
  const a = account();
  moveTable(s, waiter, { requestId: rid(), accountId: a.id, version: a.version, targetId: 'table-5', targetEpoch: s.tables[4].epoch }, ctx);
  assert.equal(balances(s, a.id).total, 7000);
  assert.deepEqual(s.orders[0].lines.map(l => l.total), [7000, 0]);
  recordPayment(s, owner, { requestId: rid(), accountId: a.id, version: a.version, method: 'cash', amount: 7000, tendered: 7000 }, ctx);
  const items = refundableItems(s.payments[0].id, stateRefundAccount(s, s.payments[0]));
  assert.deepEqual(items.map(i => [i.name, i.unit, i.left]), [['Demleme Çay', 2333, 3], ['Americano', 0, 1]]);
  assert.ok(items.reduce((n, i) => n + i.unit * i.left, 0) <= 7000);
});
