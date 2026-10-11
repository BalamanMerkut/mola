import { addDays, businessDay, comparisonLabel, dayStart, DAY_MS } from '../packages/domain/business-day.js';
import { correctedDifference, type CashClosing, type CashCorrection } from '../packages/domain/cash.js';
import { openBalance, overviewFrom, periodVatOf, previousRange } from '../packages/domain/reports.js';
import { addVatRows, VAT_NOTE, type VatRow } from '../packages/domain/vat.js';
import type { Expense, State } from '../packages/domain/types.js';
import { depositCredit } from '../packages/domain/reservations.js';
import type { PaymentAdjustment } from '../packages/domain/payment-adjustments.js';
import type { CashBook } from './cash-closing.js';
import type { ShiftBook } from './shifts.js';
import type { Store } from './store.js';

/*
 * Dönem raporları ("Gün sonu", haftalık, aylık, yıllık), made on the café computer from the same business days (05:00–05:00,
 * packages/domain/business-day.ts) and the same report functions as Satış ve Raporlar. Used by the e-mail reports
 * (server/email-reports.ts) and their copy in Bildirimler (üst çubuktaki zil); any other channel may reuse `buildPeriodReport` +
 * `reportSummary` / `reportText` / `reportHtml` as they are.
 * Never in a report: guests (names, phones, reservations), notes, table links, anything personal. Staff appear by name with
 * their hours only (week, month, year).
 */
export type PeriodKind = 'day' | 'week' | 'month' | 'year';
export const PERIOD_KINDS: PeriodKind[] = ['day', 'week', 'month', 'year'];
export type Period = { kind: PeriodKind; key: string; from: string; to: string; title: string };
export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const dateText = (day: string, year = true) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}${year ? ` ${day.slice(0, 4)}` : ''}`;
export const kindNames: Record<PeriodKind, string> = { day: 'Gün sonu raporu', week: 'Haftalık rapor', month: 'Aylık rapor', year: 'Yıllık rapor' };
const previousNames: Record<PeriodKind, string> = { day: 'önceki güne', week: 'önceki haftaya', month: 'önceki aya', year: 'önceki yıla' };
/**
 * Any period of the report screen (Satış ve Raporlar: "Bugün", "7 gün", a chosen range, "Tümü"), for its "Yazdır / PDF",
 * "Muhasebeci için indir" and the plain summary sentence. `title` is the period alone ("Ekim 2026", "5 Ekim 2026 Pazartesi").
 * Compared like the screen: with the same stretch just before, up to the same clock time while it is still running.
 */
export type ReportKind = PeriodKind | 'range' | 'all';
export type RangePeriod = { kind: 'range' | 'all'; key: string; from: string; to: string; title: string };
export function rangePeriod(from: string, to: string): RangePeriod {
  if (from === 'all' || to === 'all') return { kind: 'all', key: 'tum', from: 'all', to: 'all', title: 'Tüm zamanlar' };
  const month = from.endsWith('-01') && to === new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const title = from === to ? `${dateText(from)} ${WEEKDAYS[weekday(from)]}` : month ? `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}` : from.endsWith('-01-01') && to === `${from.slice(0, 4)}-12-31` ? from.slice(0, 4)
    : from.slice(0, 7) === to.slice(0, 7) ? `${Number(from.slice(8, 10))} – ${dateText(to)}` : `${dateText(from, from.slice(0, 4) !== to.slice(0, 4))} – ${dateText(to)}`;
  return { kind: 'range', key: `aralik:${from}:${to}`, from, to, title };
}
/** The calendar year a range is ("Yıl ▾": 1 January to 31 December, or to today in the running year), else null. */
export const yearOfRange = (from: string, to: string, today: string) => from.endsWith('-01-01') && from.slice(0, 4) === to.slice(0, 4) && (to.endsWith('-12-31') || to === today) && from !== to ? from.slice(0, 4) : null;

/** The period of `kind` holding business day `day`: the day itself, Monday–Sunday, the calendar month, the calendar year. */
export function periodOf(kind: PeriodKind, day: string): Period {
  let from = day, to = day;
  if (kind === 'week') { from = addDays(day, -((weekday(day) + 6) % 7)); to = addDays(from, 6); }
  else if (kind === 'month') { from = `${day.slice(0, 7)}-01`; to = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).toISOString().slice(0, 10); }
  else if (kind === 'year') { from = `${day.slice(0, 4)}-01-01`; to = `${day.slice(0, 4)}-12-31`; }
  const key = kind === 'day' ? `gun:${from}` : kind === 'week' ? `hafta:${from}` : kind === 'month' ? `ay:${from.slice(0, 7)}` : `yil:${from.slice(0, 4)}`;
  const title = kind === 'day' ? `${kindNames.day} · ${dateText(from)} ${WEEKDAYS[weekday(from)]}`
    : kind === 'week' ? `${kindNames.week} · ${from.slice(0, 4) === to.slice(0, 4) ? dateText(from, false) : dateText(from)} – ${dateText(to)}`
    : kind === 'month' ? `${kindNames.month} · ${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}` : `${kindNames.year} · ${from.slice(0, 4)}`;
  return { kind, key, from, to, title };
}
/** When the period ends: the start (05:00) of the business day after its last day. */
export const periodEnd = (p: Pick<Period, 'to'>) => dayStart(addDays(p.to, 1));
/** The period just before (the day before, the week, month or year before). */
export const previousPeriod = (p: Period) => periodOf(p.kind, addDays(p.from, -1));
/** Periods of `kind` that ended at or before `now`, newest first, back to `back` ms. */
export function endedPeriods(kind: PeriodKind, now: number, back: number): Period[] {
  const out: Period[] = [];
  let p = previousPeriod(periodOf(kind, businessDay(now)));
  while (periodEnd(p) > now - back && out.length < 400) { out.push(p); p = previousPeriod(p); }
  return out;
}

export type PeriodReport = {
  v: 1; kind: ReportKind; key: string; title: string; from: string; to: string; business: string; preparedAt: string;
  /** Prepared before the period's 05:00 end, right after the last day's gün sonu kapanışı. */
  early?: boolean;
  sales: { total: number; cash: number; card: number; platform: number; orders: number; accounts: number; average: number };
  /** `partial`: the period is still running and was compared with the same stretch before it up to this clock time. */
  previous: { label: string; total: number; partial?: true } | null;
  tips: { total: number; cash: number; card: number };
  refunds: { count: number; total: number };
  cancelled: { count: number; amount: number };
  expenses: { count: number; total: number };
  commission: number; kept: number;
  top: { name: string; qty: number; amount: number; kg?: number }[];
  closings: { count: number; short: number; over: number; difference: number; list: { day: string; time: string; by: string; counted: number; expected: number; difference: number; extra?: true }[]; blind?: true };
  /** Staff hours (week, month, year): shifts, else first to last action ("tahmini"). */
  staff?: { name: string; minutes: number; estimated: boolean }[];
  /** Unpaid open bills when the report was made (a day report of today only: they are today's, never a past day's). */
  openBills?: number;
  /**
   * The bills still open when the business day ended (05:00): the report of the day that just ended, made after 05:00 (the
   * e-mail and its Bildirimler copy), says "Gün kapanırken açık kalan hesaplar" instead of leaving the line out (10 Ekim).
   */
  openAtClose?: number;
  /** "KDV dökümü" (packages/domain/vat.ts): the period's sales less refunds, split by the products' KDV rates. Information only. */
  vat?: { rows: VatRow[]; total: VatRow };
};
export type ReportSources = { store: Store; cash?: CashBook; shifts?: ShiftBook };

const byId = <T extends { id: string }>(...lists: T[][]) => { const m = new Map<string, T>(); for (const list of lists) for (const x of list) m.set(x.id, x); return [...m.values()]; };
/** Turkish clock time "23:41" of a moment. */
const clock = (at: string | number) => new Date((typeof at === 'number' ? at : Date.parse(at)) + 3 * 3600_000).toISOString().slice(11, 16);

export function buildPeriodReport(src: ReportSources, tenant: string, period: Period | RangePeriod, now: Date): PeriodReport {
  return periodData(src, tenant, period, now).report;
}
/**
 * The report and what it was made from, so Satış ve Raporlar' printable pages and the accountant's Excel file
 * (server/report-export.ts) do not read the same years of records a second time. `closings`: every gün sonu record of the
 * requested days ("Tümü": all of them), the report lists those of its own days.
 */
export function periodData(src: ReportSources, tenant: string, period: Period | RangePeriod, now: Date) {
  const { store } = src, s = store.read(tenant), all = period.kind === 'all', t = now.getTime();
  const start = all ? -Infinity : dayStart(period.from), end = all ? Infinity : periodEnd(period);
  let before: { from: string; to: string; start: number; end: number; label: string; partial?: true } | null = null;
  if (period.kind === 'range') { const b = previousRange(period.from, period.to, t); if (b) before = { from: b.from, to: b.to, start: b.start, end: b.end, label: comparisonLabel(Math.round((end - start) / DAY_MS), { partial: !!b.partial, endsToday: period.to === businessDay(t), year: !!b.year }), ...(b.partial ? { partial: true as const } : {}) }; }
  else if (!all) { const prev = previousPeriod(period as Period); before = { from: prev.from, to: prev.to, start: dayStart(prev.from), end: periodEnd(prev), label: previousNames[period.kind as PeriodKind] }; }
  // Closed months and years from their roll-ups (server/history.ts reportSpan): a year or "Tümü" reads a handful of rows.
  const days = store.history.reportSpan(tenant, s, start, end), totals = days.total;
  const ov = overviewFrom({ from: period.from, to: period.to, start, end, today: businessDay(t), days, previous: before && { from: before.from, to: before.to, days: store.history.reportSpan(tenant, s, before.start, before.end) }, openBalance: openBalance(s), products: s.products });
  // "Tümü": from the first to the last day with a record.
  if (all) period = { ...period, from: ov.range.from, to: ov.range.to };
  const p = period;
  // Tips and gün sonu closings of the period's cash days, closed months from their roll-ups (CashBook.cashSpan).
  const cash = src.cash?.cashSpan(tenant, p.from, p.to);
  // The closings one by one only where the report lists them (a day, a week, a short range).
  const listed = !!src.cash && (p.kind === 'day' || p.kind === 'week' || (p.kind === 'range' && (cash?.finals.count ?? 0) <= 31));
  const closingList = listed ? finalClosings(src.cash!, tenant, p.from, p.to) : [];
  const report: PeriodReport = {
    v: 1, kind: p.kind, key: p.key, title: p.title, from: p.from, to: p.to, business: s.name, preparedAt: now.toISOString(), ...(t < end && p.kind !== 'range' && p.kind !== 'all' ? { early: true } : {}),
    sales: { total: ov.sales, cash: ov.cash, card: ov.card, platform: ov.platform, orders: ov.orders, accounts: ov.closedAccounts, average: ov.averageAccount },
    previous: ov.previous && before ? { label: before.label, total: ov.previous.sales, ...(before.partial ? { partial: true as const } : {}) } : null,
    tips: { total: cash?.tips.total ?? 0, cash: cash?.tips.cash ?? 0, card: cash?.tips.card ?? 0 },
    // Counts of the period's refunds and (counted) expenses, as the day summaries keep them.
    refunds: { count: totals.refunds, total: ov.refunds }, cancelled: { count: ov.cancelled.count, amount: ov.cancelled.amount },
    expenses: { count: totals.expenses, total: ov.expenses }, commission: ov.posCommission, kept: ov.kept,
    top: ov.topProducts.map(x => ({ name: x.name, qty: x.qty, amount: x.amount, ...('grams' in x && x.grams ? { kg: Math.round(x.grams / 10) / 100 } : {}) })),
    closings: { count: cash?.finals.count ?? 0, short: cash?.finals.short ?? 0, over: cash?.finals.over ?? 0, difference: cash?.finals.difference ?? 0, list: listed ? closingList.map(c => c.line) : [] },
    // Today's open bills, only in a day report of today (made right after the gün sonu, before 05:00): never a past day's (K-O).
    ...(p.kind === 'day' && ov.openAccounts !== null ? { openBills: ov.openAccounts } : {}),
    // The day that just ended (made after 05:00): what was still open at its close.
    ...(p.kind === 'day' && ov.openAccounts === null && end <= t && p.to === addDays(businessDay(t), -1) ? { openAtClose: openAtClose(s, end) } : {}),
  };
  // "Tümü": the sum of its years (the year table adds up); any other period at once.
  if (ov.sales) report.vat = all ? addVatRows(store.history.years(tenant, s).map(([, y]) => y.total.cash + y.total.card + y.total.platform ? periodVatOf(s, y.total).rows : [])) : periodVatOf(s, totals);
  if (p.kind !== 'day' && src.shifts) report.staff = staffHours(src, tenant, p, t);
  /** The period's records one by one, read only when a table lists them (the printable page, the Excel file); never for "Tümü". */
  const records = () => {
    const adjustments = byId<PaymentAdjustment>(store.history.adjustments(tenant, start, end), s.paymentAdjustments ?? []);
    const expenseRows = byId<Expense>(store.history.expenses(tenant, start, end), s.expenses ?? []);
    return { adjustments, expenseRows, closings: src.cash ? finalClosings(src.cash, tenant, p.from, p.to).map(c => c.closing) : [] };
  };
  return { report, s, start, end, days, records };
}
/**
 * Unpaid bills at the moment `end` (the business day's 05:00): accounts opened before it and not closed by then, each with
 * its orders and payments up to that moment (and a seated reservation's kapora). Read from the floor's records: a bill
 * closed after 05:00 stays there for hours (server/history.ts SETTLE_AFTER_MS), long enough for the report made at 05:00.
 */
export function openAtClose(s: Pick<State, 'accounts' | 'orders' | 'payments'>, end: number) {
  let sum = 0;
  for (const a of s.accounts) {
    if (Date.parse(a.openedAt) >= end || (a.status === 'closed' && !(a.closedAt && Date.parse(a.closedAt) >= end))) continue;
    const orders = s.orders.filter(o => o.accountId === a.id && o.status !== 'cancelled' && Date.parse(o.createdAt) < end);
    const payments = s.payments.filter(p => p.accountId === a.id && Date.parse(p.createdAt) < end);
    const balance = orders.reduce((n, o) => n + o.total, 0) - payments.reduce((n, p) => n + p.amount, 0) - depositCredit({ orders, payments }, a);
    if (balance > 0) sum += balance;
  }
  return sum;
}
/** The closed gün sonu closings of the cash days [from, to] with the owner's corrections in (`corrected`) and their report line. */
function finalClosings(cash: CashBook, tenant: string, from: string, to: string) {
  const closings = cash.days<CashClosing>(tenant, ['closing'], from, to).filter(c => c.status === 'closed'), corrections: Map<string, CashCorrection[]> = cash.corrections(tenant, closings.map(c => c.id));
  return closings.map(c => {
    const corrected = correctedDifference(c, corrections.get(c.id) ?? []);
    return { closing: { ...c, corrected }, line: { day: c.day, time: clock(c.closedAt ?? c.to), by: c.byName, counted: c.counted, expected: c.figures.expected, difference: corrected, ...(c.extra ? { extra: true as const } : {}) } };
  });
}
/** Minutes per employee over the period: their shifts, else (no shift that day) first to last action, "tahmini". Owners left out. */
function staffHours(src: ReportSources, tenant: string, period: Pick<Period, 'from' | 'to'>, now: number) {
  const s = src.store.read(tenant), names = new Map((s.staffUsers ?? []).map(u => [u.id, u.name]));
  const span = src.shifts!.staffSpan(tenant, s, period.from, period.to, now, src.cash);
  return [...span.users].filter(([, v]) => v.minutes > 0).map(([id, v]) => ({ name: names.get(id) ?? v.firstName ?? 'Eski çalışan kaydı', minutes: v.minutes, estimated: v.estimated })).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'tr'));
}
/**
 * Builds in steps what a report of `period` reads from roll-ups (sales, cash, staff), so a year or "Tümü" right after an
 * update never holds the tablets for long. The report itself (periodData) then reads only stored rows.
 */
export function reportSteps(src: ReportSources, tenant: string, from: string, to: string, now: number) {
  const s = src.store.read(tenant), all = from === 'all', start = all ? -Infinity : dayStart(from), end = all ? Infinity : dayStart(addDays(to, 1));
  const first = (b: { first: string } | null | undefined) => all ? b?.first ?? businessDay(now) : from, last = (b: { last: string } | null | undefined) => all ? b?.last ?? businessDay(now) : to;
  // Only "Tümü" needs to know where the records begin and end.
  const cashBounds = all ? src.cash?.bounds(tenant) : null, staffBounds = all ? src.shifts?.bounds(tenant) : null;
  return [src.store.history.prepare(tenant, s, start, end), ...(src.cash ? [src.cash.prepare(tenant, first(cashBounds), last(cashBounds))] : []), ...(src.shifts ? [src.shifts.prepare(tenant, s, first(staffBounds), last(staffBounds), now, src.cash)] : [])];
}

/**
 * After a start, the roll-ups of every closed month and year (sales, cash, staff) are built in the background, in slices of
 * `sliceMs` with pauses, so even the first "Tümü" after an update finds them ready and the tablets never wait meanwhile.
 * Missing ones only: a warm start reads a few rows per business.
 */
export async function warmReports(src: ReportSources, now: () => Date, stopped: () => boolean, options: { sliceMs?: number; pauseMs?: number } = {}) {
  const { sliceMs = 12, pauseMs = 8 } = options;
  for (const { tenant } of src.store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) {
    try {
      for (const step of reportSteps(src, tenant, 'all', 'all', now().getTime())) {
        let until = performance.now() + sliceMs;
        for (;;) {
          if (stopped()) { step.return(undefined); return; }
          if (step.next().done) break;
          if (performance.now() > until) { await new Promise(done => setTimeout(done, pauseMs)); until = performance.now() + sliceMs; }
        }
      }
    } catch (error) { if (stopped()) return; console.warn(`Rapor özetleri hazırlanamadı: ${error instanceof Error ? error.message : error}`); }
  }
}

// ---------- Rendering ----------
export const money = (k: number) => `${k < 0 ? '−' : ''}₺${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: k % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(Math.abs(k) / 100)}`;
const hours = (m: number) => m >= 60 ? `${Math.floor(m / 60)} sa${m % 60 ? ` ${m % 60} dk` : ''}` : `${m} dk`;
/** "%12 artış", "%5 düşüş", "değişmedi", or none when there is nothing to compare with. */
export function changeText(r: PeriodReport) {
  if (!r.previous) return '';
  if (!r.previous.total) return r.sales.total ? `${r.previous.label} göre: önceki dönemde satış yoktu` : '';
  const pct = Math.round((r.sales.total - r.previous.total) / r.previous.total * 100);
  return `${r.previous.label} göre ${pct === 0 ? 'değişmedi' : `%${Math.abs(pct)} ${pct > 0 ? 'artış' : 'düşüş'}`} (${money(r.previous.total)})`;
}
/**
 * K1 (8 Ekim, sahibin kararı): the Müdür sees no expected cash and no difference anywhere, the same blind view as the
 * cashier at the count. Every report a non-owner reads goes through this: how many closings, who, when, what was counted.
 */
export function blindReport(r: PeriodReport): PeriodReport {
  return { ...r, closings: { count: r.closings.count, short: 0, over: 0, difference: 0, list: r.closings.list.map(c => ({ ...c, expected: 0, difference: 0 })), blind: true } };
}
export const closingText = (d: number) => d === 0 ? 'Kasa tam' : d < 0 ? `Kasa eksik ${money(-d)}` : `Kasa fazla ${money(d)}`;
export const qtyText = (p: PeriodReport['top'][number]) => p.kg ? `${String(p.kg).replace('.', ',')} kg` : `${p.qty} adet`;
/** One paragraph for Bildirimler (üst çubuktaki zil) (and any short channel). */
export function reportSummary(r: PeriodReport) {
  const parts = [`Satış ${money(r.sales.total)} (nakit ${money(r.sales.cash)} · kart ${money(r.sales.card)}${r.sales.platform ? ` · platform ${money(r.sales.platform)}` : ''})`, `${r.sales.orders} sipariş`];
  if (r.tips.total) parts.push(`bahşiş ${money(r.tips.total)}`);
  if (r.refunds.total) parts.push(`iade ${money(r.refunds.total)}`);
  if (r.cancelled.count) parts.push(`${r.cancelled.count} iptal`);
  if (r.expenses.total) parts.push(`gider ${money(r.expenses.total)}`);
  parts.push(`elde kalan ${money(r.kept)}`);
  const change = changeText(r); if (change) parts.push(change);
  if (r.top[0]) parts.push(`en çok kazandıran: ${r.top[0].name} (${money(r.top[0].amount)})`);
  if (r.kind === 'day' && r.closings.count && !r.closings.blind) parts.push(closingText(r.closings.difference));
  if (r.openAtClose) parts.push(`gün kapanırken açık kalan hesaplar ${money(r.openAtClose)}`);
  return parts.join(' · ') + '.';
}
/**
 * The first lines of every report, in plain words for an owner who reads nothing else:
 * "5 Ekim Pazartesi günü 142 sipariş, ₺8.540 satış yapıldı; önceki güne göre %12 fazla. Kasa tam çıktı. En çok kazandıran: Latte (₺1.140).
 *  Giderler, iadeler ve komisyon düşülünce elde kalan ₺7.900."
 * `running`: the period is not over yet (the test mail): "Bugün şu ana kadar …".
 */
export function plainSummary(r: PeriodReport, running = false) {
  const lead = running ? (r.kind === 'day' || (r.kind === 'range' && r.from === r.to) ? 'Bugün şu ana kadar' : 'Bu dönemde şu ana kadar')
    : r.kind === 'all' ? 'Bugüne kadar' : r.kind === 'range' ? (r.from === r.to ? `${dateText(r.from, false)} ${WEEKDAYS[weekday(r.from)]} günü` : r.from.endsWith('-01-01') && r.to === `${r.from.slice(0, 4)}-12-31` ? `${r.from.slice(0, 4)} yılında` : `${period(r)} arasında`)
    : r.kind === 'day' ?`${dateText(r.from, false)} ${WEEKDAYS[weekday(r.from)]} günü`
    : r.kind === 'week' ? `Bu hafta (${period(r)})` : r.kind === 'month' ? `${MONTHS[Number(r.from.slice(5, 7)) - 1]} ayında` : `${r.from.slice(0, 4)} yılında`;
  const sold = r.sales.orders || r.sales.total ? `${lead} ${r.sales.orders} sipariş, ${money(r.sales.total)} satış ${running ? 'var' : 'yapıldı'}` : `${lead} satış ${running ? 'yok' : 'olmadı'}`;
  let compare = '';
  if (r.previous && r.previous.total && r.sales.total) {
    const pct = Math.round((r.sales.total - r.previous.total) / r.previous.total * 100), than = r.previous.label;
    compare = r.previous.partial ? `; ${than} göre %${Math.abs(pct)} ${pct >= 0 ? 'fazla' : 'az'}` : running ? `;${than.replace('önceki güne', 'dünün tamamına')} göre şimdilik %${Math.abs(pct)} ${pct >= 0 ? 'fazla' : 'az'}` : pct === 0 ? `; ${than} göre aynı` : `; ${than} göre %${Math.abs(pct)} ${pct > 0 ? 'fazla' : 'az'}`;
  }
  const out = [`${sold}${compare}.`];
  const d = r.closings.difference;
  if (r.closings.blind) { if (r.kind === 'day' && !running) out.push(r.closings.count ? 'Gün sonu kapanışı yapıldı.' : 'Gün sonu kapanışı yapılmadı.'); else if (r.kind !== 'day' && r.closings.count) out.push(`${r.closings.count} kasa kapanışı yapıldı.`); }
  else if (r.kind === 'day' && !running) out.push(!r.closings.count ? 'Gün sonu kapanışı yapılmadı.' : d === 0 ? 'Kasa tam çıktı.' : `Kasa ${money(Math.abs(d))} ${d < 0 ? 'eksik' : 'fazla'} çıktı.`);
  else if (r.kind !== 'day' && r.closings.count) out.push(r.closings.short ? `${r.closings.count} kasa kapanışının ${r.closings.short} tanesinde kasa eksik çıktı.` : `${r.closings.count} kasa kapanışında eksik çıkmadı.`);
  // The list is in order of money taken (K-N): "En çok kazandıran" with its amount, so the words, the order and the number agree.
  if (r.top[0]) out.push(`En çok kazandıran: ${r.top[0].name} (${money(r.top[0].amount)}).`);
  if (r.sales.total) out.push(`Giderler, iadeler ve komisyon düşülünce elde kalan ${money(r.kept)}.`);
  return out.join(' ');
}
export const periodText = (r: Pick<PeriodReport, 'from' | 'to'>) => r.from === r.to ? dateText(r.from) : `${dateText(r.from)} – ${dateText(r.to)}`;
export const preparedText = (r: PeriodReport) => `Hazırlanma: ${dateText(new Date(Date.parse(r.preparedAt) + 3 * 3600_000).toISOString().slice(0, 10))} ${clock(r.preparedAt)}${r.early ? ' (gün sonu kapanışından sonra; 05:00’e kadarki satışlar bu rapora girmez)' : ''}`;
export type Row = [string, string];
export type Section = { title: string; rows: Row[]; note?: string };
/** The report's parts in order (Satış, Para, En çok kazandıranlar, Kasa kapanışı, Personel saatleri): mail and printable page alike. */
export function sections(r: PeriodReport): Section[] {
  const out: { title: string; rows: Row[]; note?: string }[] = [];
  out.push({ title: 'Satış', rows: [['Toplam tahsilat', money(r.sales.total)], ['Nakit', money(r.sales.cash)], ['Kart', money(r.sales.card)], ...(r.sales.platform ? [['Platform (çevrimiçi ödenen)', money(r.sales.platform)] as Row] : []), ['Sipariş', String(r.sales.orders)], ['Kapanan hesap', String(r.sales.accounts)], ...(r.sales.accounts ? [['Hesap başına ortalama', money(r.sales.average)] as Row] : []), ...(r.openBills ? [['Açık hesaplar (henüz ödenmedi)', money(r.openBills)] as Row] : []), ...(r.openAtClose !== undefined ? [['Gün kapanırken açık kalan hesaplar', r.openAtClose ? money(r.openAtClose) : 'Yok'] as Row] : [])], note: changeText(r) || undefined });
  out.push({ title: 'Para', rows: [['Bahşiş (satışa dahil değil)', `${money(r.tips.total)}${r.tips.total ? ` (nakit ${money(r.tips.cash)} · kart ${money(r.tips.card)})` : ''}`], ['İade', `${money(r.refunds.total)}${r.refunds.count ? ` (${r.refunds.count} iade)` : ''}`], ['İptal edilen', `${r.cancelled.count} · ${money(r.cancelled.amount)}`], ['Gider', `${money(r.expenses.total)}${r.expenses.count ? ` (${r.expenses.count} kayıt)` : ''}`], ...(r.commission ? [['POS komisyonu', money(r.commission)] as Row] : []), ['Elde kalan', money(r.kept)]] });
  if (r.top.length) out.push({ title: 'En çok kazandıranlar', rows: r.top.map((p, i) => [`${i + 1}. ${p.name}`, `${money(p.amount)} · ${qtyText(p)}`]) });
  out.push({ title: 'Kasa kapanışı', rows: r.closings.count ? (r.closings.list.length ? r.closings.list.map(c => [`${r.kind === 'day' ? '' : `${dateText(c.day, false)} · `}${c.time}${c.extra ? ' · ek kapanış' : ''} · ${c.by}`, r.closings.blind ? `sayılan ${money(c.counted)}` : `${closingText(c.difference)} (sayılan ${money(c.counted)} · beklenen ${money(c.expected)})`] as Row) : r.closings.blind ? [['Kapanış', `${r.closings.count}`]] : [['Kapanış', `${r.closings.count}`], ['Eksik çıkan', String(r.closings.short)], ['Fazla çıkan', String(r.closings.over)], ['Toplam fark', closingText(r.closings.difference)]]) : [['Kapanış', 'Bu dönemde gün sonu kapanışı yapılmadı']] });
  if (r.vat?.rows.length) out.push({ title: 'KDV dökümü', rows: [...r.vat.rows.map(v => [`%${v.rate} · satış ${money(v.gross)}`, `matrah ${money(v.base)} · KDV ${money(v.vat)}`] as Row), ...(r.vat.rows.length > 1 ? [['Toplam KDV', money(r.vat.total.vat)] as Row] : [])], note: `Satış (KDV dahil), iadeler düşülmüş. ${VAT_NOTE}` });
  if (r.staff) out.push({ title: 'Personel saatleri', rows: r.staff.length ? r.staff.map(x => [x.name, `${hours(x.minutes)}${x.estimated ? ' (tahmini)' : ''}`] as Row) : [['Personel', 'Kayıtlı çalışma saati yok']], ...(r.staff.some(x => x.estimated) ? { note: '“Tahmini”: vardiya kaydı olmayan günlerde ilk ve son işlem arası.' } : {}) });
  return out;
}
const period = periodText;
/** `lead`: the plain summary first (plainSummary); `attached`: the printable copy is attached to the mail. */
export type MailTextOptions = { intro?: string; lead?: string; attached?: 'pdf' | 'html' };
const attachedText = (a?: 'pdf' | 'html') => a === 'pdf' ? 'Yazdırmak ya da saklamak için ekteki PDF dosyasını açın.' : a === 'html' ? 'Yazdırmak için ekteki rapor dosyasını açın (tarayıcıda açılır, oradan yazdırılır).' : '';
export function reportText(r: PeriodReport, o: MailTextOptions = {}) {
  const lines = [`${r.business}`, r.title, `${period(r)} (iş günü 05:00–05:00)`, '', o.lead ?? plainSummary(r), ''];
  if (o.intro) lines.push(o.intro, '');
  for (const sec of sections(r)) { lines.push(sec.title.toLocaleUpperCase('tr-TR')); for (const [k, v] of sec.rows) lines.push(`  ${k}: ${v}`); if (sec.note) lines.push(`  ${sec.note}`); lines.push(''); }
  if (o.attached) lines.push(attachedText(o.attached), '');
  lines.push(preparedText(r), 'Bu rapor işletmenizin bilgisayarında hazırlandı ve kendi e-posta hesabınızdan gönderildi; Mola’ya uğramaz.', 'Ayrıntılar: Mola → Satış ve Raporlar.');
  return lines.join('\n');
}
export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function reportHtml(r: PeriodReport, o: MailTextOptions = {}) {
  const intro = o.intro ?? '', lead = o.lead ?? plainSummary(r);
  const cell = 'padding:7px 0;border-bottom:1px solid #e8ece8;font-size:14px;';
  const body = sections(r).map(sec => `<h2 style="font-size:15px;margin:22px 0 6px;color:#234c3e;">${esc(sec.title)}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${sec.rows.map(([k, v]) => `<tr><td style="${cell}color:#4a5550;">${esc(k)}</td><td style="${cell}text-align:right;font-weight:600;color:#1d2622;">${esc(v)}</td></tr>`).join('')}</table>${sec.note ? `<p style="font-size:13px;color:#5d6862;margin:6px 0 0;">${esc(sec.note)}</p>` : ''}`).join('');
  const highlight = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;"><tr><td style="background:#eef4f0;border-radius:10px;padding:14px 16px;"><div style="font-size:13px;color:#4a5550;">Toplam tahsilat</div><div style="font-size:26px;font-weight:700;color:#234c3e;">${esc(money(r.sales.total))}</div><div style="font-size:13px;color:#4a5550;">${esc(`${r.sales.orders} sipariş · elde kalan ${money(r.kept)}`)}</div></td></tr></table>`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(r.title)}</title></head><body style="margin:0;background:#f6f7f4;font-family:Segoe UI,Arial,sans-serif;color:#1d2622;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:18px 10px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;"><tr><td style="padding:22px 22px 26px;">
<div style="font-size:13px;color:#5d6862;">${esc(r.business)}</div><h1 style="font-size:20px;margin:4px 0 2px;">${esc(r.title)}</h1><div style="font-size:13px;color:#5d6862;">${esc(period(r))} · iş günü 05:00–05:00</div>
<p class="lead" style="font-size:16px;line-height:1.5;margin:14px 0 0;color:#1d2622;">${esc(lead)}</p>
${intro ? `<p style="font-size:14px;margin:14px 0 0;padding:10px 12px;background:#fff7e6;border-radius:8px;">${esc(intro)}</p>` : ''}${highlight}${body}
${o.attached ? `<p style="font-size:14px;margin:20px 0 0;">${esc(attachedText(o.attached))}</p>` : ''}
<p style="font-size:12px;color:#6b756f;margin:24px 0 0;">${esc(preparedText(r))}<br>Bu rapor işletmenizin bilgisayarında hazırlandı ve kendi e-posta hesabınızdan gönderildi; Mola’ya uğramaz. Ayrıntılar: Mola → Satış ve Raporlar.</p>
</td></tr></table></td></tr></table></body></html>`;
}
export const DAY = DAY_MS;
