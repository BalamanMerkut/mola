import type { Expense, Product, State } from './types.js';
import { balances, DomainError } from './engine.js';
import type { PaymentAdjustment } from './payment-adjustments.js';
import { businessDay, DAY_MS, dayStart, mergeTotals, netProducts, spanOf, stateRecords, summarize, Totals, vatWeights, type ReportSpan } from './history.js';
import { addVatRows, legacyRateOf, vatBreakdown, vatSettings, type VatRow } from './vat.js';
import { countedExpense, expenseAt, expenseGroupNames, expenseGroupOf, expenseMethodText, type ExpenseGroup } from './expense-rules.js';
import { CHANNEL_NAMES, CHANNELS, type Channel } from './platforms.js';

/** Sales by channel (Salon / QR, Masasız, each delivery platform): orders and order amount, cancelled orders left out.
 * Salon and Masasız always, platforms once they sold something. */
export function channelRows(t: Totals) {
  return CHANNELS.flatMap(id => { const c = t.channels.get(id); return c || id === 'salon' || id === 'masasiz' ? [{ id: id as Channel, name: CHANNEL_NAMES[id], orders: c?.orders ?? 0, amount: c?.amount ?? 0 }] : []; });
}

export type EmployeeSummary = { id: string; name: string; source: 'staff' | 'qr'; role?: import('./types.js').Role;active: boolean; orders: number; items: number; amount: number; cancelled: number };
export type EmployeeReport = { from: string; to: string; rows: EmployeeSummary[]; selfService: { qrOrders: number; staffOrders: number; browserCount: number; accountCount: number; approximate?: true } };

export function reportRange(from: string, to: string) {
  if (from === 'all' && to === 'all') return { start: -Infinity, end: Infinity };
  const valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!valid(from) || !valid(to) || from > to) throw new DomainError('INVALID_RANGE', 'Geçerli bir başlangıç ve bitiş tarihi seçin.');
  // Business days (05:00–05:00 Turkish time, business-day.ts), inclusive end date. Never the server's own timezone.
  const start = dayStart(from), end = dayStart(to) + DAY_MS;
  if (end - start > 366 * 86400000) throw new DomainError('INVALID_RANGE', 'Tek raporda en fazla 366 gün seçebilirsiniz.');
  return { start, end };
}
/**
 * The period of equal length just before [from, to]; none for all-time reports. A period still running at `now` (today,
 * "son 7 gün") is compared with the same stretch before it up to the same clock time, never half a day with a whole one.
 * A calendar year ("Yıl ▾": 1 January to 31 December, or to today in the running year) is compared with the same dates of
 * the year before (`year`): this year so far with last year up to the same day and clock time, a whole year with the whole
 * year before.
 */
export function previousRange(from: string, to: string, now?: number): { from: string; to: string; start: number; end: number; partial?: true; year?: true } | null {
  const { start, end } = reportRange(from, to);
  if (!Number.isFinite(start)) return null;
  const partial = now !== undefined && now > start && now < end;
  if (from !== to && /^\d{4}-01-01$/.test(from) && from.slice(0, 4) === to.slice(0, 4) && (to.endsWith('-12-31') || partial)) {
    const year = Number(from.slice(0, 4)) - 1, last = to.endsWith('-02-29') && !leap(year) ? `${year}-02-28` : `${year}${to.slice(4)}`;
    // Up to the same clock time of the same date last year (29 February: the 28th).
    return { from: `${year}-01-01`, to: last, start: dayStart(`${year}-01-01`), end: partial ? dayStart(last) + (now - dayStart(to)) : dayStart(last) + DAY_MS, ...(partial ? { partial } : {}), year: true as const };
  }
  const length = end - start;
  return { from: businessDay(start - length), to: businessDay(start - DAY_MS), start: start - length, end: partial ? now - length : start, ...(partial ? { partial } : {}) };
}
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Days of one report: per business day totals, in date order. */
export type ReportDays = Map<string, Totals>;
const daysOf = (s: State, start: number, end: number): ReportDays => summarize(stateRecords(s), start, end);

export function employeeFrom(total: Totals, staffUsers: State['staffUsers'], from: string, to: string): EmployeeReport {
  const rows = new Map<string, EmployeeSummary>();
  for (const u of staffUsers ?? []) if (u.role !== 'kitchen') rows.set(u.id, { id: u.id, name: u.name, source: 'staff', role: u.role, active: u.active, orders: 0, items: 0, amount: 0, cancelled: 0 });
  rows.set('qr', { id: 'qr', name: 'Müşteri QR siparişi', source: 'qr', active: true, orders: 0, items: 0, amount: 0, cancelled: 0 });
  for (const [id, t] of total.staff) {
    if (!rows.has(id)) {
      const user = staffUsers?.find(u => u.id === id);
      rows.set(id, { id, name: user?.name ?? 'Eski çalışan kaydı', source: 'staff', role: user?.role, active: user?.active ?? false, orders: 0, items: 0, amount: 0, cancelled: 0 });
    }
    const row = rows.get(id)!; row.orders += t.orders; row.items += t.items; row.amount += t.amount; row.cancelled += t.cancelled;
  }
  // Long periods add up monthly roll-ups, which keep counts of distinct guests, not the guests: "yaklaşık" (Totals.distinct).
  const distinct = total.distinct();
  return { from, to, rows: [...rows.values()].sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name, 'tr')), selfService: { qrOrders: total.qrOrders, staffOrders: total.staffOrders, browserCount: distinct.browsers, accountCount: distinct.bills, ...(distinct.approx ? { approximate: true } : {}) } };
}
export function employeeReport(s: State, from: string, to: string): EmployeeReport {
  const { start, end } = reportRange(from, to);
  return employeeFrom(mergeDays(daysOf(s, start, end)), s.staffUsers, from, to);
}

/**
 * A report's days: per-day totals (tests, tools, short ranges) or a span the server added up from day summaries and
 * monthly and yearly roll-ups (server/history.ts reportSpan). Both give the same figures.
 */
export type ReportInput = ReportDays | ReportSpan;
export const spanFrom = (days: ReportInput): ReportSpan => days instanceof Map ? spanOf(days) : days;
const sortedPoints = (span: ReportSpan) => [...span.days].sort((a, b) => a[0].localeCompare(b[0]));
/** One total for a report period, adding days in date order. */
export const mergeDays = (days: ReportInput) => spanFrom(days).total;
/** `refunds` and `expenses` are the records dated inside the range, in recording order. */
export function financialFrom(days: ReportInput, from: string, to: string, start: number, end: number, refunds: PaymentAdjustment[], expenseRows: Expense[]) {
  const span = spanFrom(days), ordered = sortedPoints(span), t = span.total;
  const series = new Map<string, { date: string; cash: number; card: number; platform?: number; total: number }>();
  for (let at = start; Number.isFinite(at) && at < end; at += 86400000) { const date = businessDay(at); series.set(date, { date, cash: 0, card: 0, total: 0 }); }
  for (const [date, d] of ordered) if (d.payments) series.set(date, { date, cash: d.cash, card: d.card, ...(d.platform ? { platform: d.platform } : {}), total: d.cash + d.card + d.platform });
  // Dated by when the money went out; deleted ones leave the list and totals but stay readable as `deletedExpenses`.
  const dated = expenseRows.filter(e => Date.parse(expenseAt(e)) >= start && Date.parse(expenseAt(e)) < end).sort((a, b) => expenseAt(b).localeCompare(expenseAt(a)) || b.createdAt.localeCompare(a.createdAt));
  const expenses = dated.filter(countedExpense), deletedExpenses = dated.filter(e => !countedExpense(e));
  const expenseTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  refunds = refunds.filter(a => a.kind === 'refund' && Date.parse(a.createdAt) >= start && Date.parse(a.createdAt) < end);
  const refundTotal = refunds.reduce((n, a) => n + a.amount, 0), cashRefunds = refunds.filter(a => a.method === 'cash').reduce((n, a) => n + a.amount, 0);
  const { cash, card, platform, commission, unknownCommissionAmount, unknownCommissionCount, campaignCollected, regularCollected, unallocatedCollected, campaignOrderAmount, campaignDiscount, campaignQuantity, orderAmount } = t;
  return { refunds, refundTotal, cashRefunds, campaignCollected, regularCollected, unallocatedCollected, campaignOrderAmount, campaignDiscount, campaignQuantity, expenses, deletedExpenses, expenseTotal, cashAfterExpenses: cash - expenses.filter(e => (e.method ?? 'cash') === 'cash' && e.source !== 'outside').reduce((n, e) => n + e.amount, 0) - cashRefunds, from, to, cash, card, platform, channels: channelRows(t), collected: cash + card + platform, commission, unknownCommissionAmount, unknownCommissionCount,
    afterCommission: unknownCommissionCount ? null : cash + card + platform - commission - refundTotal,
    orderAmount, orderCount: t.orders, cancelledCount: t.cancelled, cancelledAmount: t.cancelledAmount, days: [...series.values()].sort((a, b) => a.date.localeCompare(b.date)),
    products: [...netProducts(t).products].map(([id, p]) => ({ id, name: p.first, quantity: p.quantity, amount: p.amount })).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'tr')) };
}
export function financialReport(s: State, from: string, to: string) {
  const { start, end } = reportRange(from, to);
  return financialFrom(daysOf(s, start, end), from, to, start, end, s.paymentAdjustments ?? [], s.expenses ?? []);
}
export type FinancialReport = ReturnType<typeof financialReport>;

// ---- Sales overview for the redesigned "Satış ve raporlar" screen ----
/** "Toplam tahsilat" (cash + card + paid online on a platform) and the financial report's "Kalan" for one period. */
const salesOf = (t: Totals) => { const sales = t.cash + t.card + t.platform; return { sales, kept: sales - t.commission - t.expenseTotal - t.refundTotal }; };
const productName = (a: { name: string; amount: number; qty: number }, b: typeof a) => b.amount - a.amount || b.qty - a.qty || a.name.localeCompare(b.name, 'tr');
/** Sales overview contract of the "Satış ve raporlar" screen. Money in kuruş; days are business days. */
/** Weighed products count one per sale (a 500 g line is one item), so the screen labels their numbers as sales, not pieces. */
const unitOf = (products: Product[] | undefined, id: string) => products?.find(p => p.id === id)?.unit === 'kg' ? { unit: 'kg' as const } : {};
/** Total weight of the weighed lines ("12,5 kg" on screen); absent when the product was never sold by weight. */
const gramsOf = (p: { grams: number }): { grams?: number } => p.grams > 0 ? { grams: p.grams } : {};
export function overviewFrom(input: { from: string; to: string; start: number; end: number; today: string; days: ReportInput; previous: { from: string; to: string; days: ReportInput; partial?: boolean; year?: boolean } | null; openBalance: number; products?: Product[] }) {
  const span = spanFrom(input.days), ordered = sortedPoints(span), t = span.total, { sales, kept } = salesOf(t);
  // All-time ranges run from the first to the last day with any record (today when there is none).
  const used = ordered.filter(([, d]) => d.active).map(([day]) => day);
  const first = Number.isFinite(input.start) ? input.from : used[0] ?? input.today, last = Number.isFinite(input.end) ? input.to : used.at(-1) ?? input.today;
  const byDay = new Map(ordered.map(([day, d]) => [day, d.cash + d.card + d.platform]));
  // `reservation`: the part of the day's sales paid on reserved or event tables (the chart's "Rezervasyon" colour), only when there is one.
  const reservedByDay = new Map(ordered.map(([day, d]) => [day, d.reservation]));
  const daily: { day: string; sales: number; reservation?: number }[] = [];
  for (let at = dayStart(first); at <= dayStart(last); at += DAY_MS) { const day = businessDay(at), reservation = reservedByDay.get(day) ?? 0; daily.push({ day, sales: byDay.get(day) ?? 0, ...(reservation ? { reservation } : {}) }); }
  // Very long all-time ranges are shown by month so the chart stays readable.
  const monthly = daily.length > 400 ? [...daily.reduce((m, d) => { const k = d.day.slice(0, 7), v = m.get(k) ?? { sales: 0, reservation: 0 }; v.sales += d.sales; v.reservation += d.reservation ?? 0; return m.set(k, v); }, new Map<string, { sales: number; reservation: number }>())].map(([day, v]) => ({ day, sales: v.sales, ...(v.reservation ? { reservation: v.reservation } : {}) })) : daily;
  const previous = input.previous ? { from: input.previous.from, to: input.previous.to, ...salesOf(mergeDays(input.previous.days)), ...(input.previous.partial ? { partial: true } : {}), ...(input.previous.year ? { year: true } : {}) } : null;
  // The bills open right now belong to no past period: only a period holding today shows them (K-O); null otherwise.
  const holdsToday = (!Number.isFinite(input.start) || input.from <= input.today) && (!Number.isFinite(input.end) || input.to >= input.today);
  return { range: { from: first, to: last, days: daily.length }, sales, ...(t.reservation ? { reservationSales: t.reservation } : {}), cash: t.cash, card: t.card, platform: t.platform, channels: channelRows(t), posCommission: t.commission, expenses: t.expenseTotal, refunds: t.refundTotal, kept,
    unknownCommission: { count: t.unknownCommissionCount, amount: t.unknownCommissionAmount }, previous, daily: monthly, openAccounts: holdsToday ? input.openBalance : null,
    topProducts: [...netProducts(t).products].map(([id, p]) => ({ id, name: p.first, qty: p.quantity, amount: p.amount, ...unitOf(input.products, id), ...gramsOf(p) })).sort(productName).slice(0, 5),
    hourly: t.hourSales.map((sales, hour) => ({ hour, sales, orders: t.hourOrders[hour] })),
    orders: t.orders, closedAccounts: t.closedAccounts, averageAccount: t.closedAccounts ? Math.round(sales / t.closedAccounts) : 0, cancelled: { count: t.cancelled, amount: t.cancelledAmount } };
}
export type SalesOverview = ReturnType<typeof overviewFrom>;
/**
 * "Otomatik giderler" (a month's rent, written on its day) inside [start, end): the Özet says so under "Elde kalan" when
 * they make up most of the period's expenses, so a negative first day reads as what it is. Accounting stays as it is.
 */
export function automaticExpenses(rows: Iterable<Expense>, start: number, end: number) {
  const seen = new Set<string>(); let total = 0;
  for (const e of rows) { if (seen.has(e.id)) continue; seen.add(e.id); const t = Date.parse(expenseAt(e)); if (e.auto && countedExpense(e) && t >= start && t < end) total += e.amount; }
  return total;
}
/**
 * What "Giderler" is made of on the Sade özet (hover or tap on the card): per group (Stok alışları, Otomatik giderler, Diğer
 * giderler) and, for a short list, each record. Dated by when the money went out; deleted ones count nowhere. `outside`:
 * cash paid outside the drawer (still a gider, never out of the kasa).
 */
export const EXPENSE_LINES = 8;
export function expenseBreakdown(rows: Iterable<Expense>, start: number, end: number) {
  const seen = new Set<string>(), list: Expense[] = [];
  for (const e of rows) { if (seen.has(e.id)) continue; seen.add(e.id); const t = Date.parse(expenseAt(e)); if (countedExpense(e) && t >= start && t < end) list.push(e); }
  const groups = new Map<ExpenseGroup, { amount: number; count: number }>();
  for (const e of list) { const g = groups.get(expenseGroupOf(e)) ?? { amount: 0, count: 0 }; g.amount += e.amount; g.count++; groups.set(expenseGroupOf(e), g); }
  const order: ExpenseGroup[] = ['stock', 'other', 'auto'];
  return {
    groups: order.filter(k => groups.has(k)).map(k => ({ key: k, label: expenseGroupNames[k], ...groups.get(k)! })),
    lines: list.length <= EXPENSE_LINES ? list.sort((a, b) => expenseAt(a).localeCompare(expenseAt(b))).map(e => ({ description: e.description, amount: e.amount, method: expenseMethodText(e), group: expenseGroupOf(e) })) : [],
    count: list.length,
    outside: list.filter(e => (e.method ?? 'cash') === 'cash' && e.source === 'outside').reduce((n, e) => n + e.amount, 0),
  };
}
export type ExpenseBreakdown = ReturnType<typeof expenseBreakdown>;
/** Every ordered product of the period; category from the current menu ("Diğer" for removed products). */
export function productsFrom(days: ReportInput, products: Product[]) {
  // Item refunds are taken off the product they refund (returned: pieces given back in the period's sales).
  const net = netProducts(mergeDays(days)), total = [...net.products.values()].reduce((n, p) => n + p.amount, 0);
  return { total, products: [...net.products].map(([id, p]) => ({ id, name: p.first, category: products.find(v => v.id === id)?.category || 'Diğer', qty: p.quantity, amount: p.amount, share: total ? p.amount / total : 0, ...unitOf(products, id), ...gramsOf(p), ...(net.returned.get(id) ? { returned: net.returned.get(id)! } : {}) })).sort(productName) };
}
export type ProductSales = ReturnType<typeof productsFrom>;
/**
 * The period's "KDV dökümü" (vat.ts): the collected money less refunds, split by the rates the products were sold with
 * (each line's own; older lines at the rates frozen for them, never today's).
 */
export function periodVatOf(s: Pick<State, 'vat' | 'vatLegacy' | 'products'>, total: Totals) {
  return vatBreakdown({ weights: vatWeights(total, legacyRateOf(s)), sales: total.cash + total.card + total.platform, refunds: total.refundTotal, settings: vatSettings(s) });
}
/** One row of the "Tümü" year table (and the Excel file's year sheets): money in kuruş. */
export type YearRow = { year: string; sales: number; cash: number; card: number; platform: number; refunds: number; expenses: number; commission: number; kept: number; orders: number; accounts: number; vat: number; vatRows: VatRow[] };
/**
 * "Tümü" as a table of years, newest first, and the grand total: each year from its own totals (served from yearly roll-ups),
 * the total the sum of the rows, KDV included, so the table adds up.
 */
export function yearTable(years: [string, Totals][], s: Pick<State, 'vat' | 'vatLegacy' | 'products'>) {
  const rows: YearRow[] = years.map(([year, t]) => {
    const { sales, kept } = salesOf(t), vat = sales ? periodVatOf(s, t) : null;
    return { year, sales, cash: t.cash, card: t.card, platform: t.platform, refunds: t.refundTotal, expenses: t.expenseTotal, commission: t.commission, kept, orders: t.orders, accounts: t.closedAccounts, vat: vat?.total.vat ?? 0, vatRows: vat?.rows ?? [] };
  }).sort((a, b) => b.year.localeCompare(a.year));
  const sum = (k: 'sales' | 'cash' | 'card' | 'platform' | 'refunds' | 'expenses' | 'commission' | 'kept' | 'orders' | 'accounts' | 'vat') => rows.reduce((n, r) => n + r[k], 0);
  const vat = addVatRows(rows.map(r => r.vatRows));
  return { years: rows, total: { year: 'Toplam', sales: sum('sales'), cash: sum('cash'), card: sum('card'), platform: sum('platform'), refunds: sum('refunds'), expenses: sum('expenses'), commission: sum('commission'), kept: sum('kept'), orders: sum('orders'), accounts: sum('accounts'), vat: sum('vat'), vatRows: vat.rows } satisfies YearRow };
}
export type YearTable = ReturnType<typeof yearTable>;
/** Plain-state versions (tests, tools); the server reads stored summaries instead. */
export function salesOverview(s: State, from: string, to: string, now = new Date()) {
  const { start, end } = reportRange(from, to), before = previousRange(from, to, now.getTime());
  return overviewFrom({ from, to, start, end, today: businessDay(now.getTime()), days: daysOf(s, start, end), previous: before && { from: before.from, to: before.to, partial: before.partial, year: before.year, days: daysOf(s, before.start, before.end) }, openBalance: openBalance(s), products: s.products });
}
/** Unpaid balance of the accounts open right now; it is not a sale until it is collected. */
export function openBalance(s: State) { return s.accounts.filter(a => a.status === 'open').reduce((n, a) => n + balances(s, a.id).balance, 0); }
export function productSales(s: State, from: string, to: string) { const { start, end } = reportRange(from, to); return productsFrom(daysOf(s, start, end), s.products); }
