import { campaignQuantities, campaignUsage, categoriesPlace } from './campaigns.js';
import type { CartLine, Order, OrderLine, Product, State } from './types.js';

/*
 * Hesap kampanyaları (16 Ekim, sahibin onayı): "X al Y öde", "İkincisi %N" and "Hediye ürün". Unlike percent and TL
 * campaigns (a lower unit price, campaigns.ts discountedPrice) these look at the whole open bill: the units of every order on
 * the account, so a tea ordered later still makes the second one free. The rules:
 *
 * - A line stamps the account campaigns its product took part in when it was ordered (`dealOffers`, like quantityPricing):
 *   time windows, the schedule and "Aktif" are decided at order time; later the bill only counts what was stamped.
 * - A unit's price is what the line sells it for (unitPrice: options and extras included, after any percent/TL campaign).
 *   A free unit costs 0; "İkincisi %N" prices the unit at N% off its list price (originalUnitPrice, options included), and
 *   only when that is lower than its campaign price. So a unit is never discounted twice and never below 0.
 * - "X al Y öde": of the qualifying units, floor(n / X) × (X − Y) are free, and they are the cheapest ones (store-friendly,
 *   and each group's free units are cheaper than its paid ones). Equal prices: a piece that is free already stays free, then
 *   the newest is the free one, so an earlier order keeps its price. "İkincisi %N" is the same with X = 2, Y = 1.
 * - "Hediye ürün": every X qualifying units earn `giftQuantity` (1) gift units, but only gift units actually on the bill become
 *   free (the cheapest first); nothing is ever added for the kitchen. A gift unit never counts towards its own condition.
 * - One unit takes at most one account campaign. Gifts go first, then the others by id; a unit a gift or a group used is not
 *   counted again by another "X al Y öde" / "İkincisi" (counting for a gift condition does not use a unit up).
 * - Lines with paid pieces (paid by choosing items) or of an order marked paid keep what they have ("frozen"): money taken is
 *   never re-priced; their units still count for gift conditions.
 * - A quota (maxQuantity) counts the units made free or cheaper.
 * - The bill is priced again after every change of its orders (new order, edit, change, cancel, reject, merge); `total` of a
 *   line is always unitPrice × quantity minus its deals, so totals, KDV and reports read lines as before.
 */
export type DealKind = 'buyPay' | 'second' | 'gift';
// `percent`/`amount` never on the others, so code written for percent and TL campaigns reads them as missing, not as a type error.
export type DealRule = { kind: 'buyPay'; buy: number; pay: number; percent?: never; amount?: never } | { kind: 'second'; percent: number; amount?: never } | { kind: 'gift'; buy: number; giftProductId: string; giftQuantity?: number; percent?: never; amount?: never };
type Names = { tr: string; en: string };
/** An account campaign on a menu product. `counts`: the product counts for the condition; `gift`: it is the gift. */
export type DealOffer = { id: string; name: string; reportId?: string; remainingQuantity?: number; counts?: true; gift?: true; categories?: string[]; scopeName?: Names; giftName?: Names } & DealRule;
/** Units of a line that an account campaign made free or cheaper: `off` per unit (kuruş), the same for every unit of the line. */
export type LineDeal = { id: string; name: string; reportId?: string; units: number; off: number } & DealRule;

export const isDeal = (c: { kind?: string }) => c.kind === 'buyPay' || c.kind === 'second' || c.kind === 'gift';
export function dealRuleOf(c: { kind?: string; buy?: number; pay?: number; percent?: number; giftProductId?: string; giftQuantity?: number }): DealRule | null {
  if (c.kind === 'buyPay') return { kind: 'buyPay', buy: c.buy!, pay: c.pay! };
  if (c.kind === 'second') return { kind: 'second', percent: c.percent! };
  if (c.kind === 'gift') return { kind: 'gift', buy: c.buy!, giftProductId: c.giftProductId!, ...(c.giftQuantity && c.giftQuantity > 1 ? { giftQuantity: c.giftQuantity } : {}) };
  return null;
}
/** What the account campaigns took off a line. */
export const dealOff = (l: Pick<OrderLine, 'deals'>) => (l.deals ?? []).reduce((n, d) => n + d.units * d.off, 0);
/** A line before account campaigns (after percent and TL campaigns); a line without them is its total, as always. */
export const lineGross = (l: Pick<OrderLine, 'deals' | 'total' | 'unitPrice' | 'quantity'>) => l.deals?.length ? l.unitPrice * l.quantity : l.total;
/** Each unit's price in the order pieces are paid: full-price units first, then the cheaper ones (smallest discount first). */
export function unitCharges(l: Pick<OrderLine, 'deals' | 'unitPrice' | 'quantity'>) {
  const out: number[] = [], deals = [...(l.deals ?? [])].sort((a, b) => a.off - b.off), full = l.quantity - deals.reduce((n, d) => n + d.units, 0);
  for (let i = 0; i < full; i++) out.push(l.unitPrice);
  for (const d of deals) for (let i = 0; i < d.units; i++) out.push(l.unitPrice - d.off);
  return out;
}
/** What `count` pieces of a line cost when `from` of them were paid before (a weighed line: quantity 1, unitPrice = the line). */
export function unitsCost(l: Pick<OrderLine, 'deals' | 'unitPrice' | 'quantity'>, from: number, count: number) {
  if (!l.deals?.length) return l.unitPrice * count;
  return unitCharges(l).slice(from, from + count).reduce((n, v) => n + v, 0);
}
/**
 * A kept line after an edit or a cut: its deals stay (total recomputed) only with the same quantity and price; otherwise the bill's
 * pricing gives it new ones (a changed paid line is refused before this).
 */
export function settleDeals(line: OrderLine, previous?: Pick<OrderLine, 'quantity' | 'unitPrice'>) {
  if (!line.deals) return line;
  // `line` comes from repriceSavedLine: its total is unitPrice × quantity, before account campaigns.
  if (previous && previous.quantity === line.quantity && previous.unitPrice === line.unitPrice) line.total = line.unitPrice * line.quantity - dealOff(line);
  else delete line.deals;
  return line;
}

// ---- Words. Owners and staff read Turkish; guests on the EN menu read English. ----
/** "2 al 1 öde", "İkincisi %50", "Hediye". */
export function dealRuleText(r: DealRule, en = false) {
  if (r.kind === 'buyPay') return en ? `Buy ${r.buy}, pay ${r.pay}` : `${r.buy} al ${r.pay} öde`;
  if (r.kind === 'second') return en ? `2nd ${r.percent}% off` : `İkincisi %${r.percent}`;
  return en ? 'Free gift' : 'Hediye';
}
/** Under an order line: "2 al 1 öde", "İkincisi %50", "Hediye: Americano". The amount is the screen's (money format). */
export const lineDealLabel = (d: LineDeal, lineName: string, en = false) => d.kind === 'gift' ? `${dealRuleText(d, en)}: ${lineName}` : dealRuleText(d, en);
/**
 * What a menu says on a product: "2 al 1 öde", "Çaylarda 2 al 1 öde", "İkincisi %50 indirimli", "2 Demleme Çay alana Americano
 * bedava" and, on the gift itself, "2 Demleme Çay alana bedava". `label`: the category name the menu shows (EN menu).
 */
export function dealOfferText(o: DealOffer, en = false, label: (category: string) => string = c => c) {
  if (o.kind === 'buyPay') return en ? `Buy ${o.buy}, pay ${o.pay}` : `${o.buy} al ${o.pay} öde`;
  if (o.kind === 'second') return en ? `Second one ${o.percent}% off` : `İkincisi %${o.percent} indirimli`;
  const cats = o.categories ?? [], list = cats.length > 3 ? `${cats.length} menu sections` : cats.map(label).join(', ');
  // "2 Demleme Çay", "Çaylarda 2 adet", "Kampanyalı ürünlerden 2 adet".
  const what = o.scopeName ? `${o.buy} ${en ? o.scopeName.en : o.scopeName.tr}` : cats.length ? (en ? `${o.buy} from ${list}` : `${categoriesPlace(cats)} ${o.buy} adet`) : en ? `${o.buy} campaign items` : `Kampanyalı ürünlerden ${o.buy} adet`;
  const many = (o.giftQuantity ?? 1) > 1 ? `${o.giftQuantity} ` : '', gift = o.giftName ? (en ? o.giftName.en : o.giftName.tr) : en ? 'a gift' : 'hediye';
  if (o.counts || !o.gift) return en ? `Buy ${what}, get ${many}${gift} free` : `${what} alana ${many}${gift} bedava`;
  return en ? `${many ? `${many}free` : 'Free'} with ${what}` : `${what} alana ${many ? `${many}adet ` : ''}bedava`;
}

// ---- Pricing the bill. ----
/**
 * One line as the pricing reads it; `frozen`: it keeps these deals (money was taken on it); `before`: the deals it has now,
 * so among equal prices the pieces that are already free stay free (a new order does not move a free tea to another order).
 * Entries come oldest first.
 */
export type DealEntry = { key: string; quantity: number; price: number; orig: number; offers: readonly DealOffer[]; frozen?: readonly LineDeal[]; before?: readonly LineDeal[] };
type Unit = { e: number; price: number; orig: number; rank: number; taken: boolean; frozen: boolean; was?: string };
const versionOf = (o: { id: string; reportId?: string }) => o.reportId ?? o.id;
/** The deals of every line that is not frozen (missing = none). `quota`: units the campaign may still give on this bill. */
export function computeDeals(entries: readonly DealEntry[], quota: (campaignId: string) => number): Map<string, LineDeal[]> {
  const units: Unit[] = [];
  entries.forEach((e, i) => {
    // A line's discounted pieces are its last ones (unitCharges): mark which version each of them had.
    const was = (e.before ?? []).flatMap(d => Array<string>(d.units).fill(versionOf(d)));
    for (let k = 0; k < e.quantity; k++) units.push({ e: i, price: e.price, orig: e.orig, rank: units.length, taken: false, frozen: !!e.frozen, was: was[k - (e.quantity - was.length)] });
  });
  const versions = new Map<string, DealOffer>();
  for (const e of entries) for (const o of e.offers) if (!versions.has(versionOf(o))) versions.set(versionOf(o), o);
  const left = new Map<string, number>();
  for (const e of entries) for (const d of e.frozen ?? []) left.set(d.id, (left.get(d.id) ?? quota(d.id)) - d.units);
  const remaining = (id: string) => Math.max(0, left.get(id) ?? quota(id));
  const has = (u: Unit, key: string, role: 'counts' | 'gift') => entries[u.e].offers.some(o => versionOf(o) === key && o[role]);
  const out = new Map<number, Map<string, LineDeal>>();
  const give = (u: Unit, o: DealOffer, off: number) => {
    u.taken = true;
    const m = out.get(u.e) ?? new Map<string, LineDeal>(); out.set(u.e, m);
    const key = versionOf(o), rule = dealRuleOf(o)!, d = m.get(key) ?? { id: o.id, name: o.name, ...(o.reportId ? { reportId: o.reportId } : {}), ...rule, units: 0, off };
    d.units++; m.set(key, d);
  };
  const order = [...versions].sort(([a, x], [b, y]) => Number(x.kind !== 'gift') - Number(y.kind !== 'gift') || a.localeCompare(b));
  for (const [key, o] of order) {
    if (o.kind === 'gift') {
      const counting = units.filter(u => has(u, key, 'counts')).length;
      let given = 0, frozenCounting = 0;
      // Gifts already given on frozen lines count against what is earned (and, when the gift counts too, not towards it).
      for (const e of entries) for (const d of e.frozen ?? []) if (versionOf(d) === key) { given += d.units; if (e.offers.some(x => versionOf(x) === key && x.counts)) frozenCounting += d.units; }
      const candidates = units.filter(u => !u.frozen && !u.taken && has(u, key, 'gift')).sort((a, b) => a.price - b.price || Number(b.was === key) - Number(a.was === key) || b.rank - a.rank);
      let k = Math.min(candidates.length, remaining(o.id));
      for (; k > 0; k--) {
        const overlap = candidates.slice(0, k).filter(u => has(u, key, 'counts')).length + frozenCounting;
        if (Math.floor((counting - overlap) / o.buy) * (o.giftQuantity ?? 1) >= given + k) break;
      }
      for (const u of candidates.slice(0, k)) give(u, o, u.price);
      left.set(o.id, remaining(o.id) - k);
      continue;
    }
    const X = o.kind === 'second' ? 2 : o.buy, Y = o.kind === 'second' ? 1 : o.pay;
    // Most expensive first; equal prices: the pieces free now, then the newest, at the end (they are the free ones).
    const pool = units.filter(u => !u.frozen && !u.taken && has(u, key, 'counts')).sort((a, b) => b.price - a.price || Number(a.was === key) - Number(b.was === key) || a.rank - b.rank);
    const groups = Math.floor(pool.length / X), offOf = (u: Unit) => o.kind === 'second' ? u.price - Math.min(u.price, Math.round(u.orig * (100 - o.percent) / 100)) : u.price;
    const cheap = pool.slice(pool.length - groups * (X - Y)).reverse().filter(u => offOf(u) > 0).slice(0, remaining(o.id));
    if (!cheap.length) continue;
    // The groups these units close use up their paid units too (the most expensive ones), so no other group counts them again.
    const used = Math.ceil(cheap.length / (X - Y)) * Y;
    for (const u of pool.slice(0, used)) u.taken = true;
    for (const u of cheap) give(u, o, offOf(u));
    left.set(o.id, remaining(o.id) - cheap.length);
  }
  const result = new Map<string, LineDeal[]>();
  for (const [i, m] of out) result.set(entries[i].key, [...m.values()]);
  return result;
}

type Swap = { orderId: string; lines: OrderLine[] | null };
/** The live orders of a bill (cancelled out; waiting for approval in, as in balances), `swap` replacing one order's lines or the order. */
function billOrders(s: State, accountId: string, swap?: Swap) {
  return s.orders.filter(o => o.accountId === accountId && o.status !== 'cancelled' && !(swap && swap.orderId === o.id && swap.lines === null)).map(o => ({ order: o, lines: swap && swap.orderId === o.id ? swap.lines! : o.lines }));
}
const lineKey = (o: Pick<Order, 'id'>, l: Pick<OrderLine, 'id'>) => `${o.id}:${l.id}`;
/** Pieces paid by choosing items, per order line. */
function paidPieces(s: State, accountId: string) {
  const m = new Map<string, number>();
  for (const p of s.payments) if (p.accountId === accountId) for (const x of p.selections ?? []) m.set(`${x.orderId}:${x.lineId}`, (m.get(`${x.orderId}:${x.lineId}`) ?? 0) + x.quantity);
  return m;
}
/** The bill priced with its account campaigns: each line's new deals and net total. Null when no line takes part (nothing to do). */
export function priceBill(s: State, accountId: string, swap?: Swap) {
  const bill = billOrders(s, accountId, swap);
  if (!bill.some(b => b.lines.some(l => l.dealOffers?.length || l.deals?.length))) return null;
  const paid = paidPieces(s, accountId), entries: DealEntry[] = [];
  for (const { order, lines } of bill) for (const l of lines) {
    if (l.grams !== undefined) continue;
    const frozen = !!order.paidAt || (paid.get(lineKey(order, l)) ?? 0) > 0;
    entries.push({ key: lineKey(order, l), quantity: l.quantity, price: l.unitPrice, orig: l.originalUnitPrice ?? l.unitPrice, offers: l.dealOffers ?? [], ...(frozen ? { frozen: l.deals ?? [] } : l.deals ? { before: l.deals } : {}) });
  }
  // A campaign's quota left for this bill: its limit minus what other bills (and this bill's frozen lines, see computeDeals) used.
  const limited = new Map((s.campaigns ?? []).filter(c => c.maxQuantity != null).map(c => [c.id, c.maxQuantity!]));
  const usage = limited.size ? campaignUsage(s) : new Map<string, number>(), here = limited.size ? campaignQuantities(s.orders.filter(o => o.accountId === accountId && o.status !== 'cancelled').flatMap(o => o.lines)) : new Map<string, number>();
  const quota = (id: string) => limited.has(id) ? Math.max(0, limited.get(id)! - ((usage.get(id) ?? 0) - (here.get(id) ?? 0))) : Infinity;
  const deals = computeDeals(entries, quota), frozen = new Set(entries.filter(e => e.frozen).map(e => e.key));
  const lines = new Map<string, { deals?: LineDeal[]; total: number }>();
  let total = 0;
  for (const { order, lines: list } of bill) for (const l of list) {
    const key = lineKey(order, l);
    if (l.grams !== undefined || frozen.has(key)) { total += l.total; continue; }
    const d = deals.get(key), net = l.unitPrice * l.quantity - dealOff({ deals: d });
    lines.set(key, { ...(d?.length ? { deals: d } : {}), total: net }); total += net;
  }
  return { bill, lines, total };
}
/** The bill's total after `swap`, with its account campaigns; null when it has none (the caller's plain sum is right). */
export function billTotalWith(s: State, accountId: string, swap: Swap) {
  return priceBill(s, accountId, swap)?.total ?? null;
}
/**
 * Prices the bill again and writes each changed line's deals and total, and each changed order's total (version up, so screens
 * refresh). `guard`: leave everything as it was when the bill would fall below what was already paid (a merge of two paid bills).
 */
export function applyBillDeals(s: State, accountId: string, guard = false) {
  const r = priceBill(s, accountId);
  if (!r) return false;
  if (guard && r.total < s.payments.filter(p => p.accountId === accountId).reduce((n, p) => n + p.amount, 0)) return false;
  let changed = false;
  for (const { order } of r.bill) {
    let touched = false;
    for (const l of order.lines) {
      const next = r.lines.get(lineKey(order, l));
      if (!next || (next.total === l.total && JSON.stringify(next.deals ?? null) === JSON.stringify(l.deals ?? null))) continue;
      if (next.deals) l.deals = next.deals; else delete l.deals;
      l.total = next.total; touched = true;
    }
    if (!touched) continue;
    order.total = order.lines.reduce((n, l) => n + l.total, 0); order.version++; changed = true;
  }
  return changed;
}

// ---- Screens: the waiter's hint and the basket's estimate (same rules, from the menu as it is now). ----
type Piece = Pick<CartLine, 'productId' | 'quantity' | 'grams'> & { unitPrice?: number; originalUnitPrice?: number; deals?: LineDeal[] };
const entriesOf = (products: readonly Product[], lines: readonly Piece[], prefix: string, price: (l: Piece, p: Product) => number): DealEntry[] => lines.flatMap((l, i) => {
  const p = products.find(x => x.id === l.productId);
  return p && l.grams === undefined ? [{ key: `${prefix}${i}`, quantity: l.quantity, price: price(l, p), orig: l.originalUnitPrice ?? price(l, p), offers: p.deals ?? [] }] : [];
});
/**
 * "Kampanya: Americano bedava · Ekle": gift campaigns whose condition the bill (and the basket) meets with fewer gift units on
 * it than earned. Hints only; the café server decides when the order comes in.
 */
export function giftHints(products: readonly Product[], lines: readonly Piece[]) {
  const out: { campaignId: string; product: Product; missing: number; text: string }[] = [];
  const seen = new Set<string>();
  for (const gift of products) for (const o of gift.deals ?? []) {
    if (o.kind !== 'gift' || !o.gift || seen.has(o.id) || gift.soldOut || gift.published === false) continue;
    seen.add(o.id);
    const offerOf = (id: string) => products.find(p => p.id === id)?.deals?.find(x => x.id === o.id);
    const giftUnits = lines.filter(l => l.productId === gift.id && l.grams === undefined).reduce((n, l) => n + l.quantity, 0);
    const others = lines.filter(l => l.grams === undefined && l.productId !== gift.id && offerOf(l.productId)?.counts).reduce((n, l) => n + l.quantity, 0);
    // With `t` gift units on the bill, how many are free (a gift unit never counts towards its own condition; computeDeals).
    const free = (t: number) => { for (let k = t; k > 0; k--) if (Math.floor((others + (offerOf(gift.id)?.counts ? t - k : 0)) / o.buy) * (o.giftQuantity ?? 1) >= k) return k; return 0; };
    let missing = 0;
    while (missing < 20 && free(giftUnits + missing + 1) > free(giftUnits + missing)) missing++;
    missing = Math.min(missing, Math.max(0, (o.remainingQuantity ?? Infinity) - free(giftUnits)));
    if (missing > 0) out.push({ campaignId: o.id, product: gift, missing, text: `${gift.name} bedava` });
  }
  return out;
}
/**
 * What the account campaigns would take off when the basket joins the bill: the basket's lines priced as the menu prices them
 * (`price`), the bill's lines as they are. Only the change counts (the bill's own deals are already on it).
 */
export function basketDealSavings(products: readonly Product[], bill: readonly Piece[], basket: readonly Piece[], price: (l: Piece, p: Product) => number) {
  const billEntries = entriesOf(products, bill, 'b', l => l.unitPrice ?? 0), basketEntries = entriesOf(products, basket, 'c', price);
  if (![...billEntries, ...basketEntries].some(e => e.offers.length)) return 0;
  const sum = (m: Map<string, LineDeal[]>) => [...m.values()].reduce((n, d) => n + dealOff({ deals: d }), 0);
  const quota = (id: string) => products.flatMap(p => p.deals ?? []).find(o => o.id === id)?.remainingQuantity ?? Infinity;
  return Math.max(0, sum(computeDeals([...billEntries, ...basketEntries], quota)) - sum(computeDeals(billEntries, quota)));
}
