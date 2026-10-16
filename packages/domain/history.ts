import { createHash } from 'node:crypto';
import type { Expense, Order, Payment, State } from './types.js';
import type { PaymentAdjustment } from './payment-adjustments.js';
import { countedExpense, expenseAt } from './expense-rules.js';
import { openTables, orderChannel } from './platforms.js';
import { selectionKey } from './stock.js';
import { businessDay, dayStart, DAY_MS } from './business-day.js';

// Report building blocks shared by the in-memory reports (tests, tools) and the server's stored daily summaries,
// so both paths compute every figure with the same code.
/** Business days (packages/domain/business-day.ts): 05:00 to 05:00 Turkish time, the same day as the gün sonu kasası. */
export { businessDay, dayStart, DAY_MS };
const hourOf = (at: string) => new Date(Date.parse(at) + 3 * 3600000).getUTCHours();
// Distinct browsers/accounts must stay countable across days without keeping the raw identifiers in summaries.
const tag = (value: string) => createHash('sha256').update(value).digest('base64url').slice(0, 16);
/**
 * A QR guest's browser id as a closed year's package keeps it (server/package-privacy.ts): only its tag, the one the day
 * summaries already count by, so a summary built again from the package counts the same guests.
 */
export const ANONYMOUS_GUEST = 'anon:';
export const anonymousGuest = (id: string) => id.startsWith(ANONYMOUS_GUEST) ? id : `${ANONYMOUS_GUEST}${tag(id)}`;
const guestTag = (id: string) => id.startsWith(ANONYMOUS_GUEST) ? id.slice(ANONYMOUS_GUEST.length) : tag(id);

/** open: table names of accounts not archived yet; with the archives' names they tell masasız tickets apart (sales channels). */
/** `returns`: corrections of the payments in `payments` whatever day they were made (item refunds count on their payment's day); missing = `refunds`. */
export type HistoryRecords = { orders: Iterable<Order>; payments: Iterable<Payment>; refunds: Iterable<PaymentAdjustment>; returns?: Iterable<PaymentAdjustment>; expenses: Iterable<Expense>; closed: Iterable<{ closedAt: string; synthetic?: boolean; accountId?: string; tableName?: string }>; open?: { accountId: string; tableName: string }[] };
/** Stored per business day. Money in kuruş; arrays keep the sealed rows compact. */
export type DaySummary = {
  cash: number; card: number; commission: number; unknownCommissionAmount: number; unknownCommissionCount: number;
  campaignCollected: number; regularCollected: number; unallocatedCollected: number; payments: number;
  orders: number; orderAmount: number; cancelled: number; cancelledAmount: number; campaignOrderAmount: number; campaignDiscount: number; campaignQuantity: number;
  refunds: number; refundTotal: number; cashRefunds: number; expenses: number; expenseTotal: number; closedAccounts: number;
  qrOrders: number; staffOrders: number; hourSales: number[]; hourOrders: number[];
  /** [productId, first name seen, last name seen, quantity, amount, grams] for non-cancelled, approved orders; grams of weighed lines only. */
  products: [string, string, string, number, number, number?][];
  /** [staff id or 'qr', orders, items, amount, cancelled] as in the employee report. */
  staff: [string, number, number, number, number][];
  browsers: string[]; qrAccounts: string[];
  /** [campaign key, productId, quantity, amount, discount]; key is r:<reportId> or i:<id> like the campaign report. */
  campaigns: [string, string, number, number, number][];
  /** Paid online on a delivery platform (Payment.method 'platform'); never in cash or card. */
  platform?: number;
  /** [channel, orders, amount]: Salon / QR, Masasız and each delivery platform (external-orders.ts orderChannel). */
  channels?: [string, number, number][];
  /** [productId, option key, quantity, grams] of lines sold with options (packages/domain/stock.ts selectionKey): stock and Kârlılık. */
  variants?: [string, string, number, number][];
  /** Payments of bills sold on a reserved or event table (Order.reservation), by payment day: the chart's "Rezervasyon" part. */
  reservation?: number;
  /**
   * Item refunds ("Ürün bazlı iade") on the day of the payment they refund: [productId, option key, name, quantity, amount,
   * grams, quantity back in stock, grams back in stock]. Ürünler and Kârlılık take them off the product's sales; Stok does not
   * (the product was made; only "stoğa ekle" puts it back, as its own stock entry).
   */
  returned?: [string, string, string, number, number, number, number, number][];
  /**
   * [productId, KDV rate, amount] of the lines stamped with their rate at the sale (OrderLine.vatRate). A product's lines without
   * a stamp (sold before stamping) are its amount less these, counted at the rate frozen for them (vat.ts legacyRateOf).
   * Monthly and yearly roll-ups keep every amount here, unstamped ones already at that frozen rate.
   */
  rates?: [string, number, number][];
  /** Roll-ups keep no guest tags (`browsers`, `qrAccounts` empty): [distinct browsers, distinct QR bills, months added up]. */
  qr?: [number, number, number];
};
const sums =['cash', 'card', 'commission', 'unknownCommissionAmount', 'unknownCommissionCount', 'campaignCollected', 'regularCollected', 'unallocatedCollected', 'payments', 'orders', 'orderAmount', 'cancelled', 'cancelledAmount', 'campaignOrderAmount', 'campaignDiscount', 'campaignQuantity', 'refunds', 'refundTotal', 'cashRefunds', 'expenses', 'expenseTotal', 'closedAccounts', 'qrOrders', 'staffOrders'] as const;
export const campaignKey = (c: { id: string; reportId?: string }) => c.reportId ? `r:${c.reportId}` : `i:${c.id}`;

/** Mergeable totals for one day or any span of days. */
export class Totals {
  cash = 0; card = 0; commission = 0; unknownCommissionAmount = 0; unknownCommissionCount = 0; campaignCollected = 0; regularCollected = 0; unallocatedCollected = 0; payments = 0;
  orders = 0; orderAmount = 0; cancelled = 0; cancelledAmount = 0; campaignOrderAmount = 0; campaignDiscount = 0; campaignQuantity = 0;
  refunds = 0; refundTotal = 0; cashRefunds = 0; expenses = 0; expenseTotal = 0; closedAccounts = 0; qrOrders = 0; staffOrders = 0;
  hourSales = Array<number>(24).fill(0); hourOrders = Array<number>(24).fill(0); platform = 0; reservation = 0;
  channels = new Map<string, { orders: number; amount: number }>();
  channel(id: string) { let c = this.channels.get(id); if (!c) this.channels.set(id, c = { orders: 0, amount: 0 }); return c; }
  products = new Map<string, { first: string; last: string; quantity: number; amount: number; grams: number }>();
  staff = new Map<string, { orders: number; items: number; amount: number; cancelled: number }>();
  browsers = new Set<string>(); qrAccounts = new Set<string>();
  campaigns = new Map<string, Map<string, { quantity: number; amount: number; discount: number }>>();
  staffRow(id: string) { let row = this.staff.get(id); if (!row) this.staff.set(id, row = { orders: 0, items: 0, amount: 0, cancelled: 0 }); return row; }
  product(id: string, name: string) { let p = this.products.get(id); if (!p) this.products.set(id, p = { first: name, last: name, quantity: 0, amount: 0, grams: 0 }); return p; }
  applied(key: string, productId: string) { let c = this.campaigns.get(key); if (!c) this.campaigns.set(key, c = new Map()); let v = c.get(productId); if (!v) c.set(productId, v = { quantity: 0, amount: 0, discount: 0 }); return v; }
  /** productId → option key → quantity and grams of the lines sold with those options (Stok, Kârlılık). */
  variants = new Map<string, Map<string, { quantity: number; grams: number }>>();
  variant(productId: string, key: string) { let m = this.variants.get(productId); if (!m) this.variants.set(productId, m = new Map()); let v = m.get(key); if (!v) m.set(key, v = { quantity: 0, grams: 0 }); return v; }
  /** Item refunds by product and option key (DaySummary.returned). */
  returned = new Map<string, { productId: string; key: string; name: string; quantity: number; amount: number; grams: number; restocked: number; restockedGrams: number }>();
  returnRow(productId: string, key: string, name: string) { const k = `${productId}\0${key}`; let r = this.returned.get(k); if (!r) this.returned.set(k, r = { productId, key, name, quantity: 0, amount: 0, grams: 0, restocked: 0, restockedGrams: 0 }); return r; }
  /** productId → KDV rate → amount of stamped lines (DaySummary.rates). */
  rated = new Map<string, Map<number, number>>();
  addRated(productId: string, rate: number, amount: number) { let m = this.rated.get(productId); if (!m) this.rated.set(productId, m = new Map()); m.set(rate, (m.get(rate) ?? 0) + amount); }
  /** Distinct QR browsers and bills that came as counts from roll-ups (DaySummary.qr), and how many months they add up. */
  qrBrowsers = 0; qrBills = 0; qrParts = 0;
  /** Adds a later span: first names keep the earlier span's, last names take the later one's. */
  add(o: Totals | DaySummary) {
    for (const k of sums) this[k] += o[k];
    this.platform += o.platform ?? 0; this.reservation += o.reservation ?? 0;
    const channels = o instanceof Totals ? [...o.channels].map(([id, c]) => [id, c.orders, c.amount] as const) : o.channels ?? [];
    for (const [id, orders, amount] of channels) { const c = this.channel(id); c.orders += orders; c.amount += amount; }
    for (let h = 0; h < 24; h++) { this.hourSales[h] += o.hourSales[h] ?? 0; this.hourOrders[h] += o.hourOrders[h] ?? 0; }
    const products = o instanceof Totals ? [...o.products].map(([id, p]) => [id, p.first, p.last, p.quantity, p.amount, p.grams] as const) : o.products;
    for (const [id, first, last, quantity, amount, grams] of products) { const p = this.product(id, first); p.last = last; p.quantity += quantity; p.amount += amount; p.grams += grams ?? 0; }
    const staff = o instanceof Totals ? [...o.staff].map(([id, r]) => [id, r.orders, r.items, r.amount, r.cancelled] as const) : o.staff;
    for (const [id, orders, items, amount, cancelled] of staff) { const r = this.staffRow(id); r.orders += orders; r.items += items; r.amount += amount; r.cancelled += cancelled; }
    for (const v of o.browsers) this.browsers.add(v);
    for (const v of o.qrAccounts) this.qrAccounts.add(v);
    const campaigns = o instanceof Totals ? [...o.campaigns].flatMap(([key, m]) => [...m].map(([id, v]) => [key, id, v.quantity, v.amount, v.discount] as const)) : o.campaigns;
    for (const [key, id, quantity, amount, discount] of campaigns) { const v = this.applied(key, id); v.quantity += quantity; v.amount += amount; v.discount += discount; }
    const variants = o instanceof Totals ? [...o.variants].flatMap(([id, m]) => [...m].map(([key, v]) => [id, key, v.quantity, v.grams] as const)) : o.variants ?? [];
    for (const [id, key, quantity, grams] of variants) { const v = this.variant(id, key); v.quantity += quantity; v.grams += grams; }
    const returned = o instanceof Totals ? [...o.returned.values()].map(r => [r.productId, r.key, r.name, r.quantity, r.amount, r.grams, r.restocked, r.restockedGrams] as const) : o.returned ?? [];
    for (const [id, key, name, quantity, amount, grams, restocked, restockedGrams] of returned) { const r = this.returnRow(id, key, name); r.quantity += quantity; r.amount += amount; r.grams += grams; r.restocked += restocked; r.restockedGrams += restockedGrams; }
    const rates = o instanceof Totals ? [...o.rated].flatMap(([id, m]) => [...m].map(([rate, amount]) => [id, rate, amount] as const)) : o.rates ?? [];
    for (const [id, rate, amount] of rates) this.addRated(id, rate, amount);
    if (o instanceof Totals) { this.qrBrowsers += o.qrBrowsers; this.qrBills += o.qrBills; this.qrParts += o.qrParts; }
    else if (o.qr) { this.qrBrowsers += o.qr[0]; this.qrBills += o.qr[1]; this.qrParts += o.qr[2]; }
    return this;
  }
  /**
   * Distinct QR browsers and bills. Exact from day summaries (guest tags); a roll-up keeps only its month's counts, so once
   * months are added up a guest of two months counts twice: `approx` ("yaklaşık" on screen).
   */
  distinct() { return { browsers: this.browsers.size + this.qrBrowsers, bills: this.qrAccounts.size + this.qrBills, approx: this.qrParts > 1 || (this.qrParts > 0 && (this.browsers.size > 0 || this.qrAccounts.size > 0)) }; }
  /** The stored copy of a monthly or yearly roll-up: guest tags become counts (DaySummary.qr). */
  rollup(): DaySummary { const d = this.distinct(); return { ...this.toJSON(), browsers: [], qrAccounts: [], qr: [d.browsers, d.bills, d.browsers || d.bills ? Math.max(1, this.qrParts) : 0] }; }
  toJSON(): DaySummary {
    const out = Object.fromEntries(sums.map(k => [k, this[k]])) as Pick<DaySummary, typeof sums[number]>;
    return { ...out, hourSales: [...this.hourSales], hourOrders: [...this.hourOrders],
      products: [...this.products].map(([id, p]) => [id, p.first, p.last, p.quantity, p.amount, p.grams]),
      staff: [...this.staff].map(([id, r]) => [id, r.orders, r.items, r.amount, r.cancelled]),
      browsers: [...this.browsers], qrAccounts: [...this.qrAccounts],
      campaigns: [...this.campaigns].flatMap(([key, m]) => [...m].map(([id, v]) => [key, id, v.quantity, v.amount, v.discount] as [string, string, number, number, number])),
      platform: this.platform, channels: [...this.channels].map(([id, c]) => [id, c.orders, c.amount] as [string, number, number]),
      ...(this.reservation ? { reservation: this.reservation } : {}),
      ...(this.variants.size ? { variants: [...this.variants].flatMap(([id, m]) => [...m].map(([key, v]) => [id, key, v.quantity, v.grams] as [string, string, number, number])) } : {}),
      ...(this.returned.size ? { returned: [...this.returned.values()].map(r => [r.productId, r.key, r.name, r.quantity, r.amount, r.grams, r.restocked, r.restockedGrams] as [string, string, string, number, number, number, number, number]) } : {}),
      ...(this.rated.size ? { rates: [...this.rated].flatMap(([id, m]) => [...m].map(([rate, amount]) => [id, rate, amount] as [string, number, number])) } : {}),
      ...(this.qrParts ? { qr: [this.qrBrowsers, this.qrBills, this.qrParts] as [number, number, number] } : {}) };
  }
  static from(summary: DaySummary) { return new Totals().add(summary); }
}

/** Method corrections apply to the payment itself whenever they were made; refunds stay separate records. */
export function applyMethodChanges(payments: Iterable<Payment>, adjustments: Iterable<PaymentAdjustment>) {
  const ledger = new Map<string, Payment>();
  for (const p of payments) ledger.set(p.id, { ...p });
  for (const a of adjustments) if (a.kind === 'method') { const p = ledger.get(a.paymentId); if (p) { p.method = a.method; p.commission = a.commission; } }
  return [...ledger.values()];
}
/** Everything a plain State holds. Archived and live copies share IDs; the live copy wins, as in every report. */
export function stateRecords(s: State): HistoryRecords {
  const orders = new Map(s.archives.flatMap(a => a.orders).map(o => [o.id, o]));
  for (const o of s.orders) orders.set(o.id, o);
  return { orders: orders.values(), payments: applyMethodChanges([...s.archives.flatMap(a => a.payments), ...s.payments], s.paymentAdjustments ?? []), refunds: s.paymentAdjustments ?? [], expenses: s.expenses ?? [], closed: s.archives, open: openTables(s) };
}

/** Per business day totals of everything inside [start, end): payments by payment time, orders by order time. */
export function summarize(r: HistoryRecords, start: number, end: number) {
  const days = new Map<string, Totals>();
  const on = (at: string) => { const day = businessDay(at); let t = days.get(day); if (!t) days.set(day, t = new Totals()); return t; };
  const inside = (at: string) => { const t = Date.parse(at); return t >= start && t < end; };
  const orders = [...r.orders], closed = [...r.closed];
  const tableOf = new Map<string, string>();
  for (const c of closed) if (c.accountId && c.tableName) tableOf.set(c.accountId, c.tableName);
  for (const t of r.open ?? []) tableOf.set(t.accountId, t.tableName);
  // Legacy attribution is account-scoped: index each account's lines once.
  const attribution = new Map<string, { hasCampaign: boolean; lines: Map<string, Map<string, Order['lines'][number]>> }>();
  for (const o of orders) {
    if (o.status === 'cancelled' || o.status === 'awaiting_approval') continue;
    const account = attribution.get(o.accountId) ?? { hasCampaign: false, lines: new Map() };
    account.lines.set(o.id, new Map(o.lines.map(line => [line.id, line])));
    account.hasCampaign ||= o.lines.some(line => !!line.campaigns?.length);
    attribution.set(o.accountId, account);
  }
  // The reservation part of each bill: a normal table merged into an event or reserved bill brings its own orders, which are
  // not reservation sales, so a payment counts as "Rezervasyon" only by the share of the bill's reserved orders.
  const reserved = new Map<string, { reserved: number; total: number }>();
  for (const o of orders) if (o.status !== 'cancelled' && o.status !== 'awaiting_approval') {
    const v = reserved.get(o.accountId) ?? { reserved: 0, total: 0 };
    v.total += o.total; if (o.reservation) v.reserved += o.total; reserved.set(o.accountId, v);
  }
  const paidAt = new Map<string, string>();
  for (const p of r.payments) if (inside(p.createdAt)) {
    paidAt.set(p.id, p.createdAt);
    const t = on(p.createdAt), share = reserved.get(p.accountId);
    if (share?.reserved) t.reservation += share.reserved >= share.total ? p.amount : Math.round(p.amount * share.reserved / share.total);
    let attributed = p.campaignAmount;
    if (attributed === undefined) {
      const account = attribution.get(p.accountId);
      if (p.selections) attributed = p.selections.reduce((n, sel) => { const l = account?.lines.get(sel.orderId)?.get(sel.lineId); return l ? n + (l.campaigns?.length ? l.unitPrice * sel.quantity : 0) : NaN; }, 0);
      else if (account && !account.hasCampaign) attributed = 0;
    }
    if (typeof attributed === 'number' && Number.isFinite(attributed) && attributed >= 0 && attributed <= p.amount) { t.campaignCollected += attributed; t.regularCollected += p.amount - attributed; }
    else t.unallocatedCollected += p.amount;
    if (p.method === 'cash') t.cash += p.amount;
    else if (p.method === 'platform') t.platform += p.amount;
    else { t.card += p.amount; if (typeof p.commission !== 'number' || !Number.isInteger(p.commission) || p.commission < 0 || p.commission > p.amount) { t.unknownCommissionAmount += p.amount; t.unknownCommissionCount++; } else t.commission += p.commission; }
    t.payments++; t.hourSales[hourOf(p.createdAt)] += p.amount;
  }
  for (const o of orders) if (o.status !== 'awaiting_approval' && inside(o.createdAt)) {
    // Platform orders have no employee behind them: they count in the totals and in their channel, never on a staff row.
    const t = on(o.createdAt), row = o.external ? { orders: 0, items: 0, amount: 0, cancelled: 0 } : t.staffRow(o.source === 'qr' ? 'qr' : o.guestId);
    // Items staff took off a live order count as cancelled too: once per order in the count, every item in the amount.
    // The order's own total and lines already hold only what is left, so sales never include them.
    const partly = (o.cancellations ?? []).reduce((n, c) => n + c.lines.reduce((m, l) => m + l.total, 0), 0);
    if (o.status === 'cancelled') { t.cancelled++; t.cancelledAmount += o.total + partly; row.cancelled++; continue; }
    if (o.cancellations?.length) { t.cancelled++; t.cancelledAmount += partly; row.cancelled++; }
    if (o.source === 'qr') { t.qrOrders++; t.browsers.add(guestTag(o.guestId)); t.qrAccounts.add(tag(o.accountId)); } else if (!o.external) t.staffOrders++;
    const channel = t.channel(orderChannel(o, tableOf.get(o.accountId))); channel.orders++; channel.amount += o.total;
    row.orders++; row.items += o.lines.reduce((n, l) => n + l.quantity, 0); row.amount += o.total;
    t.orders++; t.orderAmount += o.total; t.hourOrders[hourOf(o.createdAt)]++;
    for (const l of o.lines) {
      const discount = ((l.originalUnitPrice ?? l.unitPrice) - l.unitPrice) * l.quantity;
      if (l.campaigns?.length) { t.campaignOrderAmount += l.total; t.campaignQuantity += l.quantity; t.campaignDiscount += discount; }
      for (const key of new Set(l.campaigns?.map(campaignKey))) { const v = t.applied(key, l.productId); v.quantity += l.quantity; v.amount += l.total; v.discount += discount; }
      // Account campaigns (deals.ts): a campaign line like the others; per campaign the pieces made free or cheaper, what was
      // charged for them and what they took off ("2 al 1 öde": 1 adet, 0 TL, 35 TL).
      if (l.deals?.length) {
        if (!l.campaigns?.length) { t.campaignOrderAmount += l.total; t.campaignQuantity += l.quantity; }
        for (const d of l.deals) { t.campaignDiscount += d.units * d.off; const v = t.applied(campaignKey(d), l.productId); v.quantity += d.units; v.amount += d.units * (l.unitPrice - d.off); v.discount += d.units * d.off; }
      }
      // A weighed line counts as one sale; its weight is summed apart so reports can say "12,5 kg".
      const p = t.product(l.productId, l.name); p.last = l.name; p.quantity += l.quantity; p.amount += l.total; p.grams += l.grams ?? 0;
      if (typeof l.vatRate === 'number') t.addRated(l.productId, l.vatRate, l.total);
      if (l.selections?.length) { const v = t.variant(l.productId, selectionKey(l.selections)); v.quantity += l.quantity; v.grams += l.grams ?? 0; }
    }
  }
  for (const a of r.refunds) if (a.kind === 'refund' && inside(a.createdAt)) { const t = on(a.createdAt); t.refunds++; t.refundTotal += a.amount; if (a.method === 'cash') t.cashRefunds += a.amount; }
  // Refunded items leave the product's sales on the day of the payment they refund (the money itself counts on the refund's day).
  // A refund of a closed year's bill (closedPeriod) never touches that year: its items leave the sales of its own day.
  const counted = new Set<string>();
  for (const a of r.refunds) if (a.kind === 'refund' && a.closedPeriod && a.items?.length && inside(a.createdAt) && !counted.has(a.id)) {
    counted.add(a.id);
    const t = on(a.createdAt);
    for (const i of a.items) { const v = t.returnRow(i.productId, i.key ?? '', i.name); v.quantity += i.quantity; v.amount += i.amount; v.grams += i.grams ?? 0; if (a.restock) { v.restocked += i.quantity; v.restockedGrams += i.grams ?? 0; } }
  }
  for (const a of r.returns ?? r.refunds) {
    const at = a.kind === 'refund' && a.items?.length && !a.closedPeriod && !counted.has(a.id) ? paidAt.get(a.paymentId) : undefined;
    if (!at) continue;
    counted.add(a.id);
    const t = on(at);
    for (const i of a.items!) { const v = t.returnRow(i.productId, i.key ?? '', i.name); v.quantity += i.quantity; v.amount += i.amount; v.grams += i.grams ?? 0; if (a.restock) { v.restocked += i.quantity; v.restockedGrams += i.grams ?? 0; } }
  }
  // Expenses count on the day the money went out (owners may date them back); deleted ones count nowhere.
  for (const e of r.expenses) if (countedExpense(e) && inside(expenseAt(e))) { const t = on(expenseAt(e)); t.expenses++; t.expenseTotal += e.amount; }
  for (const c of closed) if (!c.synthetic && inside(c.closedAt)) on(c.closedAt).closedAccounts++;
  return days;
}
export function mergeTotals(parts: Iterable<Totals | DaySummary>) { const t = new Totals(); for (const p of parts) t.add(p); return t; }

/**
 * What a report needs of one business day besides the period's totals: the charts, the daily table of the accountant's
 * Excel file, which days had any record. Monthly and yearly roll-ups keep one per day, so "Tümü" draws its bars without
 * opening a single day summary.
 */
export type DayPoint = { cash: number; card: number; platform: number; reservation: number; refundTotal: number; expenseTotal: number; commission: number; orders: number; payments: number; campaignDiscount: number; active: boolean };
export const dayPoint = (t: Totals): DayPoint => ({ cash: t.cash, card: t.card, platform: t.platform, reservation: t.reservation, refundTotal: t.refundTotal, expenseTotal: t.expenseTotal, commission: t.commission, orders: t.orders, payments: t.payments, campaignDiscount: t.campaignDiscount, active: !!(t.payments || t.orders || t.cancelled || t.expenses || t.refunds || t.closedAccounts) });
/** A day point as roll-ups store it: [day, cash, card, platform, reservation, refunds, expenses, commission, orders, payments, discount, active]. */
export type StoredPoint = [string, number, number, number, number, number, number, number, number, number, number, 0 | 1];
export const storePoint = (day: string, p: DayPoint): StoredPoint => [day, p.cash, p.card, p.platform, p.reservation, p.refundTotal, p.expenseTotal, p.commission, p.orders, p.payments, p.campaignDiscount, p.active ? 1 : 0];
export const readPoint = (v: StoredPoint): [string, DayPoint] => [v[0], { cash: v[1], card: v[2], platform: v[3], reservation: v[4], refundTotal: v[5], expenseTotal: v[6], commission: v[7], orders: v[8], payments: v[9], campaignDiscount: v[10], active: v[11] === 1 }];
/** One report period: its totals (days, months and years added in date order) and every day's point, in date order. */
export type ReportSpan = { total: Totals; days: Map<string, DayPoint> };
/** A period from per-day totals (tests, tools, short ranges): the same figures a roll-up gives. */
export function spanOf(days: Map<string, Totals>): ReportSpan {
  const ordered = [...days].sort((a, b) => a[0].localeCompare(b[0]));
  return { total: mergeTotals(ordered.map(([, t]) => t)), days: new Map(ordered.map(([day, t]) => [day, dayPoint(t)])) };
}
/**
 * Fixes the KDV rate of every unstamped amount (a product's amount less its stamped lines) at `rateOf`: monthly and yearly
 * roll-ups keep their KDV this way, whatever rate the product gets later.
 */
export function freezeRates(t: Totals, rateOf: (productId: string) => number) {
  for (const [id, p] of t.products) {
    let rest = p.amount;
    for (const v of t.rated.get(id)?.values() ?? []) rest -= v;
    if (rest > 0) t.addRated(id, rateOf(id), rest);
  }
  return t;
}
/**
 * The KDV weights of a period: each product's sales less item refunds (netProducts), at the rates its lines were sold with
 * (stamped, or `rateOf` for the rest). A product sold at two rates splits in proportion to what it sold at each.
 */
export function vatWeights(t: Totals, rateOf: (productId: string) => number) {
  const out = new Map<number, number>(), add = (rate: number, v: number) => out.set(rate, (out.get(rate) ?? 0) + v);
  for (const [id, p] of netProducts(t).products) {
    if (!(p.amount > 0)) continue;
    const gross = t.products.get(id)?.amount ?? 0, parts = new Map(t.rated.get(id) ?? []);
    let rest = gross;
    for (const v of parts.values()) rest -= v;
    if (rest > 0) parts.set(rateOf(id), (parts.get(rateOf(id)) ?? 0) + rest);
    // Rates in order, so the same amounts always add up the same way (roll-ups and days give equal weights).
    const used = [...parts].filter(([, v]) => v > 0).sort((a, b) => a[0] - b[0]);
    if (used.length <= 1) add(used[0]?.[0] ?? rateOf(id), p.amount);
    else for (const [rate, v] of used) add(rate, p.amount * v / gross);
  }
  return out;
}
/** Product sales with item refunds taken off (Ürünler, Özet's best sellers); never below zero. `returned`: pieces refunded per product. */
export function netProducts(t: Totals) {
  if (!t.returned.size) return { products: t.products, returned: new Map<string, number>() };
  const products = new Map([...t.products].map(([id, p]) => [id, { ...p }])), returned = new Map<string, number>();
  for (const r of t.returned.values()) {
    returned.set(r.productId, (returned.get(r.productId) ?? 0) + r.quantity);
    const p = products.get(r.productId); if (!p) continue;
    p.quantity = Math.max(0, p.quantity - r.quantity); p.amount = Math.max(0, p.amount - r.amount); p.grams = Math.max(0, p.grams - r.grams);
  }
  return { products, returned };
}
