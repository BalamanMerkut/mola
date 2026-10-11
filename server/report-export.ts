import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { addDays, businessDay, dayStart, DAY_MS } from '../packages/domain/business-day.js';
import { correctedDifference, type CashClosing } from '../packages/domain/cash.js';
import { campaignReport, campaignReportSteps, type CampaignReport } from '../packages/domain/campaign-reports.js';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import { countedExpense, expenseAt, expenseMethodText } from '../packages/domain/expense-rules.js';
import type { DayPoint } from '../packages/domain/history.js';
import { profitReport } from '../packages/domain/profit.js';
import { employeeFrom, financialFrom, mergeDays, productsFrom, reportRange, yearTable } from '../packages/domain/reports.js';
import { productVat, VAT_NOTE, vatSettings } from '../packages/domain/vat.js';
import type { Actor, State } from '../packages/domain/types.js';
import type { CashBook } from './cash-closing.js';
import { blindReport, closingText, periodData, dateText, money, periodText, plainSummary, preparedText, rangePeriod, reportSteps, sections, warmReports, WEEKDAYS, weekday, yearOfRange, type PeriodReport, type ReportSources } from './email-reports-content.js';
import { drainSlowly, readyFor } from './history.js';
import { htmlToPdf } from './pdf-print.js';
import { headlineFigures, printDocument, type DocTable } from './report-document.js';
import { xlsx, type XlsxCell, type XlsxSheet } from './report-export-xlsx.js';
import type { ShiftBook } from './shifts.js';
import type { StockBook } from './stock.js';
import type { Store } from './store.js';

/*
 * Satış ve Raporlar, for the owner and the Müdür (behind the report code like every /api/staff/reports route):
 *   GET /api/staff/reports/simple        the "Sade özet": one plain sentence, the kasa line, the KDV dökümü
 *   GET /api/staff/reports/document      "Yazdır / PDF": the open report as a clean A4 page (server/report-document.ts)
 *   GET /api/staff/reports/document.pdf  the same page as a PDF made by the installed Edge/Chrome (server/pdf-print.ts);
 *                                        409 PDF_UNAVAILABLE when there is none (the screen says: Yazdır → "PDF olarak kaydet")
 *   GET /api/staff/reports/accountant.xlsx  "Muhasebeci için indir": one Excel file of the period (server/report-export-xlsx.ts)
 * Periods are business days (05:00–05:00) like the screen; nothing here is about guests.
 */
export const REPORT_VIEWS = ['summary', 'products', 'profit', 'campaigns', 'cash', 'expenses', 'corrections', 'employees', 'staff', 'reservations'] as const;
export type ReportView = typeof REPORT_VIEWS[number];
export const VIEW_NAMES: Record<ReportView, string> = { summary: 'Satış özeti', products: 'Ürün satışları', profit: 'Kârlılık', campaigns: 'Kampanyalar', cash: 'Kasa kapanışları', expenses: 'Giderler', corrections: 'İadeler', employees: 'Çalışanlar', staff: 'Personel ve bahşiş', reservations: 'Rezervasyon' };
export type ExportSources = ReportSources & { stock?: () => StockBook | undefined };

const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
const clock = (at: string) => new Date(Date.parse(at) + 3 * 3600_000).toISOString().slice(11, 16);
const pct = (n: number | null) => n === null ? '—' : `%${Math.round(n * 100)}`;
const count = (n: number) => n.toLocaleString('tr-TR');

/**
 * The window of a report request: the period's figures (closed months and years from roll-ups) and, read only when a table
 * lists them, its records one by one (`fin`, `closings`). "Tümü" never reads them: its tables are years and months.
 */
export function reportWindow(src: ExportSources, tenant: string, from: string, to: string, now: Date) {
  const { start, end } = reportRange(from, to), { report, s, days, records } = periodData(src, tenant, rangePeriod(from, to), now);
  let listed: { fin: ReturnType<typeof financialFrom>; closings: (CashClosing & { corrected: number })[] } | undefined;
  const lists = () => listed ??= (() => { const r = records(); return { fin: financialFrom(days, from, to, start, end, r.adjustments, r.expenseRows), closings: r.closings }; })();
  // `blind`: read by someone other than the owner (the Müdür): no expected cash, no difference (blindReport, K1).
  return { s, start, end, report, days, blind: false as boolean, today: businessDay(now.getTime()), all: from === 'all', get fin() { return lists().fin; }, get closings() { return lists().closings; } };
}
type Window = ReturnType<typeof reportWindow>;

/** "Kasada ₺2.310 nakit olmalı." and the like. The amount itself only for the owner: the Müdür may count the drawer blind. */
export function kasaLine(src: ExportSources, tenant: string, w: Window, role: Actor['role'], now: number) {
  const r = w.report, c = r.closings;
  if (w.report.to === w.today && src.cash) {
    const p = src.cash.position(tenant, now), today = src.cash.days<CashClosing>(tenant, ['closing'], w.today, w.today).find(x => x.status === 'closed');
    const last = today && correctedDifference(today, src.cash.corrections(tenant, [today.id]).get(today.id) ?? []);
    if (last !== undefined && role !== 'owner') return { tone: 'ok', text: 'Gün sonu kapanışı yapıldı.' } as const;
    if (last !== undefined) return { tone: last === 0 ? 'ok' : 'warn', text: `Gün sonu kapanışı yapıldı: ${last === 0 ? 'kasa tam çıktı' : `kasa ${money(Math.abs(last))} ${last < 0 ? 'eksik' : 'fazla'} çıktı`}.` } as const;
    if (p.start === null && !p.opening) return { tone: 'quiet', text: 'Kasa bugün henüz açılmadı.' } as const;
    if (role === 'owner') {
      const expected = src.cash.expectedNow(tenant, w.s, now);
      // Below zero is no amount a drawer can hold ("₺0" hid it): say what it means instead.
      if (expected !== null && expected < 0) return { tone: 'warn', text: `Kayıtlara göre kasadan, kasaya girenden ${money(-expected)} fazla nakit çıktı. Giderlerin bir kısmı kasa dışından ödendiyse Giderler'de “Kasa dışı nakit” olarak düzeltin.` } as const;
      if (expected !== null) return { tone: 'ok', text: `Kasada ${money(expected)} nakit olmalı.` } as const;
    }
    return { tone: 'quiet', text: 'Kasa açık; sayım gün sonunda yapılır.' } as const;
  }
  if (!c.count) return { tone: 'quiet', text: r.from === r.to ? 'Bu gün kasa kapanışı yapılmadı.' : 'Bu dönemde gün sonu kapanışı yapılmadı.' } as const;
  if (role !== 'owner') return { tone: 'ok', text: c.count === 1 ? 'Kasa kapanışı yapıldı.' : `${c.count} kasa kapanışı yapıldı.` } as const;
  const total = c.difference;
  if (c.count === 1) return { tone: total === 0 ? 'ok' : 'warn', text: `Kasa kapanışı: ${total === 0 ? 'kasa tam çıktı' : `kasa ${money(Math.abs(total))} ${total < 0 ? 'eksik' : 'fazla'} çıktı`}.` } as const;
  return c.short ? { tone: 'warn', text: `${c.count} kasa kapanışının ${c.short} tanesinde kasa eksik çıktı (toplam fark ${closingText(total).replace('Kasa ', '').replace('tam', '₺0')}).` } as const
    : { tone: 'ok', text: `${c.count} kasa kapanışında eksik çıkmadı.` } as const;
}
/**
 * "Gün sonu sayımı: ₺2.895 · Beklenen: −₺557 · Fark: +₺3.452" on the Sade özet of one day (owner only): the count and the
 * report side by side, so the owner sees in one place how the counted cash relates to the day's figures. Each gün sonu of
 * the day (an "ek kapanış" too), closed ones, corrections in.
 */
export function dayCounts(src: ExportSources, tenant: string, w: Window) {
  const r = w.report;
  if (!src.cash || r.kind === 'all' || r.from !== r.to) return [];
  const closings = src.cash.days<CashClosing>(tenant, ['closing'], r.from, r.to).filter(c => c.status === 'closed'), corrections = src.cash.corrections(tenant, closings.map(c => c.id));
  return closings.map(c => ({ time: clock(c.closedAt ?? c.to), byName: c.byName, counted: c.counted, expected: c.figures.expected, difference: correctedDifference(c, corrections.get(c.id) ?? []), cashSales: c.figures.cashSales, cashExpenses: c.figures.cashExpenses, opening: c.figures.opening, ...(c.figures.outsideExpenses ? { outsideExpenses: c.figures.outsideExpenses } : {}), ...(c.extra ? { extra: true } : {}) }));
}
/**
 * The one sentence on top of the reports, for someone who reads nothing else:
 * "Bugün 142 sipariş, ₺8.540 satış — dünün aynı saatine göre %12 fazla. En çok kazandıran: Latte (₺1.140). Kasada ₺2.310 nakit olmalı."
 * The products are in order of money taken (K-N), so the sentence names the amount, not the count.
 */
export function simpleSentence(r: PeriodReport, today: string, kasa?: string) {
  const days = Math.round((dayStart(r.to) - dayStart(r.from)) / DAY_MS) + 1, year = yearOfRange(r.from, r.to, today);
  const lead = r.kind === 'all' ? 'Bugüne kadar' : year ? (r.to === today ? `${year} yılında bugüne kadar` : `${year} yılında`) : r.from === r.to ? (r.from === today ? 'Bugün' : r.from === addDays(today, -1) ? 'Dün' : `${dateText(r.from, false)} ${WEEKDAYS[weekday(r.from)]} günü`)
    : r.to === today ? `Son ${days} günde` : `${periodText(r)} arasında`;
  let out = r.sales.orders || r.sales.total ? `${lead} ${r.sales.orders.toLocaleString('tr-TR')} sipariş, ${money(r.sales.total)} satış` : `${lead} ${r.to >= today ? 'henüz satış yok' : 'satış olmadı'}`;
  const before = r.previous?.total ?? 0;
  // A business that just started has a near-empty previous period; "%3000 fazla" would only confuse (like the screen).
  if (r.previous && before && r.sales.total && before * 4 >= r.sales.total) { const p = Math.round((r.sales.total - before) / before * 100); out += ` — ${r.previous.label} göre ${p === 0 ? 'aynı' : `%${Math.abs(p)} ${p > 0 ? 'fazla' : 'az'}`}`; }
  const parts = [`${out}.`];
  if (r.top[0]) parts.push(`En çok kazandıran: ${r.top[0].name} (${money(r.top[0].amount)}).`);
  if (kasa) parts.push(kasa);
  return parts.join(' ');
}

// ---------- Printable pages ----------
function viewTables(src: ExportSources, tenant: string, view: ReportView, w: Window, now: Date, campaigns?: CampaignReport): DocTable[] {
  const { s } = w;
  // "Tümü": record lists would be five years long; the money tables are per year instead (pick a year for the records).
  if (w.all && (view === 'cash' || view === 'expenses' || view === 'corrections')) return [yearMoneyTable(view, yearFigures(src, tenant, s), w.blind)];
  if (view === 'products') {
    const p = productsFrom(w.days, s.products), settings = vatSettings(s), byId = new Map(s.products.map(x => [x.id, x]));
    return [{ title: 'Ürün satışları', head: ['Ürün', 'Kategori', 'KDV', 'Adet', 'Tutar', 'Pay'], right: [2, 3, 4, 5], rows: p.products.map(x => [x.name, x.category, `%${productVat(byId.get(x.id), settings)}`, x.unit === 'kg' && x.grams ? `${(x.grams / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} kg` : count(x.qty), money(x.amount), pct(x.share)]), foot: ['Toplam', '', '', '', money(p.total), ''], note: 'İptal edilen siparişler hariç; tutarlar indirimler ve ürün iadeleri düşülmüş.' }];
  }
  if (view === 'profit') {
    const stock = src.stock?.();
    if (!stock) return [];
    // Kârlılık costs each day at its own prices, so it reads the period's day summaries.
    const p = profitReport({ from: w.report.from, to: w.report.to, days: src.store.history.reportDays(tenant, s, w.start, w.end), products: s.products, data: stock.data(tenant), now: now.getTime(), margins: s.marginAlerts ?? {} });
    return [{ title: 'Ürün kârlılığı', head: ['Ürün', 'Satış', 'Malzeme maliyeti', 'Brüt kâr', 'Kâr oranı'], right: [1, 2, 3, 4], rows: p.rows.map(x => [`${x.name}${x.low ? ' (düşük kâr)' : ''}`, money(x.revenue), x.cost === null ? 'Maliyet girilmemiş' : money(x.cost), x.profit === null ? '—' : money(x.profit), x.margin === null ? '—' : pct(x.margin)]),
      foot: ['Toplam', money(p.totals.revenue), money(p.totals.cost), money(p.totals.profit), p.totals.margin === null ? '—' : pct(p.totals.margin)], note: 'Brüt kâr = satış − malzeme maliyeti. Giderler, POS komisyonu ve iadeler düşülmez; net kâr değildir.' }];
  }
  if (view === 'campaigns') {
    const c = campaigns ?? campaignReport(s, now, src.store.history.spanTotals(tenant, s));
    return [{ title: 'Kampanyalar', head: ['Kampanya', 'İndirimli satış', 'İndirim', 'Günlük adet (önce → sırasında)', 'Değişim'], right: [1, 2, 3, 4], rows: c.campaigns.map(x => [`${x.name}${x.ongoing ? ' (sürüyor)' : ''}`, money(x.appliedAmount), money(x.discount), `${x.dailyBefore.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} → ${x.dailyDuring.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`, x.changePercent === null ? '—' : `%${Math.round(x.changePercent)}`]), empty: 'Kampanya yok.', note: 'Kampanyalar kendi tarihleriyle karşılaştırılır; dönem seçimi bu tabloyu değiştirmez.' }];
  }
  if (view === 'cash') return [closingTable(w)];
  const fin = view === 'expenses' ? w.fin : null;
  if (fin) return [{ title: 'Gider kayıtları', head: ['Tarih', 'Açıklama', 'Yöntem', 'Kaydeden', 'Tutar'], right: [4], rows: fin.expenses.map(e => [shortDay(businessDay(expenseAt(e))), `${e.description}${e.auto ? ' (otomatik)' : ''}`, expenseMethodText(e) || '—', e.actorName, money(e.amount)]), foot: ['Toplam', '', '', '', money(fin.expenseTotal)], empty: 'Bu dönemde gider kaydı yok.' }];
  if (view === 'corrections') return [refundTable(w)];
  if (view === 'employees') {
    const e = employeeFrom(mergeDays(w.days), s.staffUsers, w.report.from, w.report.to);
    return [{ title: 'Çalışanların siparişleri', head: ['Çalışan', 'Sipariş', 'Ürün', 'Tutar', 'İptal'], right: [1, 2, 3, 4], rows: e.rows.filter(x => x.orders || x.cancelled || x.active).map(x => [x.name, count(x.orders), count(x.items), money(x.amount), count(x.cancelled)]) }];
  }
  if (view === 'staff') {
    const r = w.report, hours = (m: number) => `${Math.floor(m / 60)} sa ${m % 60} dk`;
    return [{ title: 'Çalışma saatleri', head: ['Çalışan', 'Süre'], right: [1], rows: (r.staff ?? []).map(x => [x.name, `${hours(x.minutes)}${x.estimated ? ' (tahmini)' : ''}`]), empty: 'Kayıtlı çalışma saati yok.', note: '“Tahmini”: vardiya kaydı olmayan günlerde ilk ve son işlem arası.' },
      { title: 'Bahşiş', head: ['', 'Tutar'], right: [1], rows: [['Toplam bahşiş (satışa dahil değil)', money(r.tips.total)], ['Nakit', money(r.tips.cash)], ['Kart', money(r.tips.card)]] }];
  }
  return [];
}
function closingTable(w: Window): DocTable {
  if (w.blind) return { title: 'Gün sonu kapanışları', head: ['Gün', 'Saat', 'Kapatan', 'Sayılan'], right: [3], rows: w.closings.filter(c => c.mode === 'final').map(c => [shortDay(c.day), `${clock(c.closedAt ?? c.to)}${c.extra ? ' · ek' : ''}`, c.byName, money(c.counted)]), empty: 'Bu dönemde gün sonu kapanışı yapılmadı.' };
  return { title: 'Gün sonu kapanışları', head: ['Gün', 'Saat', 'Kapatan', 'Beklenen', 'Sayılan', 'Fark'], right: [3, 4, 5], rows: w.closings.filter(c => c.mode === 'final').map(c => [shortDay(c.day), `${clock(c.closedAt ?? c.to)}${c.extra ? ' · ek' : ''}`, c.byName, money(c.figures.expected), money(c.counted), c.corrected === 0 ? 'Tam' : money(c.corrected)]), empty: 'Bu dönemde gün sonu kapanışı yapılmadı.' };
}
function refundTable(w: Window): DocTable {
  const names = new Map((w.s.staffUsers ?? []).map(u => [u.id, u.name]));
  return { title: 'İadeler', head: ['Tarih', 'Saat', 'Ne için', 'Yöntem', 'Kim', 'Tutar'], right: [5], rows: w.fin.refunds.map(a => [shortDay(businessDay(a.createdAt)), clock(a.createdAt), a.items?.length ? a.items.map(i => `${i.quantity} × ${i.name}`).join(', ') : a.reason || '—', a.method === 'cash' ? 'Nakit' : 'Kart', a.byName ?? names.get(a.actor) ?? '—', money(a.amount)]), foot: ['Toplam', '', '', '', '', money(w.fin.refundTotal)], empty: 'Bu dönemde iade yok.' };
}
function vatTable(r: PeriodReport): DocTable {
  return { title: 'KDV dökümü', head: ['Oran', 'Satış (KDV dahil)', 'Matrah', 'KDV'], right: [1, 2, 3], rows: (r.vat?.rows ?? []).map(v => [`%${v.rate}`, money(v.gross), money(v.base), money(v.vat)]), ...(r.vat && r.vat.rows.length > 1 ? { foot: ['Toplam', money(r.vat.total.gross), money(r.vat.total.base), money(r.vat.total.vat)] } : {}), empty: 'Bu dönemde satış yok.', note: `İadeler düşülmüş satış, ürünlerin KDV oranına göre bölündü. ${VAT_NOTE}` };
}
/**
 * The open report as a printable page: "Mola Coffee House · Ekim 2026 · Satış özeti", the plain sentence, its tables.
 * `campaigns`: the campaign report made beforehand in slices (documentCampaigns); without it it is made here in one piece.
 */
export function viewDocument(src: ExportSources, tenant: string, view: ReportView, w: Window, now: Date, campaigns?: CampaignReport) {
  const r = w.report, name = VIEW_NAMES[view], running = r.to >= w.today;
  const period = r.kind === 'all' ? 'Tüm zamanlar' : rangePeriod(r.from, r.to).title;
  const all = sections(r);
  const parts = view === 'summary' ? all.filter(x => x.title !== 'KDV dökümü') : view === 'staff' || view === 'employees' ? [] : view === 'reservations' ? all.filter(x => x.title === 'Satış') : [];
  // "Tümü": the Özet adds the table of years (served from the yearly roll-ups).
  const tables = view === 'summary' ? [...(w.all ? [yearSalesTable(yearFigures(src, tenant, w.s))] : []), vatTable(r)] : viewTables(src, tenant, view, w, now, campaigns);
  return printDocument({ business: 'Satış ve Raporlar', title: `${r.business} · ${period} · ${name}`, when: periodText(r), lead: plainSummary(r, running), figures: headlineFigures(r), parts, tables,
    note: view === 'reservations' ? 'Rezervasyon ve etkinliklerin ayrıntısı ekranda; bu sayfa dönemin satış özetini verir.' : view === 'profit' && !tables.length ? 'Kârlılık için stok bilgisi okunamadı.' : undefined, prepared: preparedText(r) });
}
export const documentFileName = (view: ReportView, from: string, to: string, ext: 'pdf' | 'html' | 'xlsx') =>
  `Mola-${({ summary: 'Satis-ozeti', products: 'Urun-satislari', profit: 'Karlilik', campaigns: 'Kampanyalar', cash: 'Kasa-kapanislari', expenses: 'Giderler', corrections: 'Iadeler', employees: 'Calisanlar', staff: 'Personel', reservations: 'Rezervasyon' } as const)[view]}-${from === 'all' ? 'tum-zamanlar' : from === to ? from : `${from}_${to}`}.${ext}`;

// ---------- Muhasebeci için indir ----------
/** The accountant's Excel file of the period: sales by day, payments, expenses, refunds, kasa closings, KDV, products. */
export function accountantWorkbook(w: Window, src?: ExportSources, tenant?: string): XlsxSheet[] {
  if (w.all && src && tenant) return allTimeWorkbook(w, yearFigures(src, tenant, w.s));
  const { s, report: r } = w, fin = w.fin, settings = vatSettings(s), byId = new Map(s.products.map(x => [x.id, x]));
  const list = r.kind === 'all' ? [...w.days.days.keys()] : (() => { const out: string[] = []; for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.push(d); return out; })();
  const daily = dailySheet(w.days.days, list, r.kind === 'all');
  const payments: XlsxSheet = { name: 'Ödemeler özeti', widths: [34, 16], rows: [['Kalem', 'Tutar'],
    ['Nakit', { money: r.sales.cash }], ['Kart', { money: r.sales.card }], ['Platform (çevrimiçi ödenen)', { money: r.sales.platform }], [{ text: 'Toplam tahsilat', bold: true }, { money: r.sales.total, bold: true }],
    ['İadeler', { money: -r.refunds.total }], ['POS komisyonu (bankanın kart satışlarından aldığı pay)', { money: -r.commission }], ['Giderler', { money: -r.expenses.total }], [{ text: 'Elde kalan', bold: true }, { money: r.kept, bold: true }],
    ['Bahşiş (satışa dahil değil)', { money: r.tips.total }], ['Sipariş sayısı', r.sales.orders], ['Kapanan hesap', r.sales.accounts], ['Hesap başına ortalama', { money: r.sales.average }]],
    note: 'Elde kalan = satış − iadeler − POS komisyonu − giderler. Kira, maaş gibi Mola\'ya girilmeyen giderler düşülmediği için net kâr değildir.' };
  const expenses: XlsxSheet = { name: 'Giderler', widths: [12, 40, 12, 16, 18], rows: [['Tarih', 'Açıklama', 'Yöntem', 'Tutar', 'Kim'], ...fin.expenses.filter(countedExpense).map(e => [{ date: businessDay(expenseAt(e)) }, `${e.description}${e.auto ? ' (otomatik)' : ''}`, expenseMethodText(e), { money: e.amount }, e.actorName] as XlsxCell[]), [{ text: 'Toplam', bold: true }, '', '', { money: fin.expenseTotal, bold: true }, '']] };
  const names = new Map((s.staffUsers ?? []).map(u => [u.id, u.name]));
  const refunds: XlsxSheet = { name: 'İadeler', widths: [12, 8, 40, 10, 16, 18], rows: [['Tarih', 'Saat', 'Açıklama', 'Yöntem', 'Tutar', 'Kim'], ...fin.refunds.map(a => [{ date: businessDay(a.createdAt) }, clock(a.createdAt), a.items?.length ? a.items.map(i => `${i.quantity} × ${i.name}`).join(', ') : a.reason || '', a.method === 'cash' ? 'Nakit' : 'Kart', { money: a.amount }, a.byName ?? names.get(a.actor) ?? ''] as XlsxCell[]), [{ text: 'Toplam', bold: true }, '', '', '', { money: fin.refundTotal, bold: true }, '']] };
  const closings: XlsxSheet = w.blind ? { name: 'Kasa kapanışları', widths: [12, 8, 18, 15, 40], rows: [['Tarih', 'Saat', 'Kapatan', 'Sayılan', 'Not'], ...w.closings.filter(c => c.mode === 'final').map(c => [{ date: c.day }, clock(c.closedAt ?? c.to), c.byName, { money: c.counted }, c.note ?? ''] as XlsxCell[])] } : { name: 'Kasa kapanışları', widths: [12, 8, 18, 15, 15, 13, 40], rows: [['Tarih', 'Saat', 'Kapatan', 'Beklenen', 'Sayılan', 'Fark', 'Not'], ...w.closings.filter(c => c.mode === 'final').map(c => [{ date: c.day }, clock(c.closedAt ?? c.to), c.byName, { money: c.figures.expected }, { money: c.counted }, { money: c.corrected }, c.note ?? ''] as XlsxCell[])],
    note: 'Fark = sayılan − beklenen (sonradan yapılan düzeltmeler dahil). Eksi: kasa eksik.' };
  const vat: XlsxSheet = { name: 'KDV dökümü', widths: [8, 20, 16, 16], rows: [['Oran', 'Satış (KDV dahil)', 'Matrah', 'KDV'], ...(r.vat?.rows ?? []).map(v => [{ rate: v.rate }, { money: v.gross }, { money: v.base }, { money: v.vat }] as XlsxCell[]), [{ text: 'Toplam', bold: true }, { money: r.vat?.total.gross ?? 0, bold: true }, { money: r.vat?.total.base ?? 0, bold: true }, { money: r.vat?.total.vat ?? 0, bold: true }]],
    note: `Satıştan iadeler düşüldü; kalan, ürünlerin KDV oranına göre bölündü. ${VAT_NOTE}` };
  const p = productsFrom(w.days, s.products);
  const products: XlsxSheet = { name: 'Ürün satışları', widths: [32, 20, 8, 10, 10, 16], rows: [['Ürün', 'Kategori', 'KDV', 'Adet', 'Kilogram', 'Tutar'], ...p.products.map(x => [x.name, x.category, { rate: productVat(byId.get(x.id), settings) }, x.qty, x.grams ? Math.round(x.grams) / 1000 : '', { money: x.amount }] as XlsxCell[]), [{ text: 'Toplam', bold: true }, '', '', '', '', { money: p.total, bold: true }]],
    note: 'İptaller hariç; indirimler ve ürün iadeleri düşülmüş sipariş tutarı.' };
  return [daily, payments, expenses, refunds, closings, vat, products];
}
/** "Günlük satışlar": one row per business day of `list` (`skipEmpty`: days without a point are left out, "Tümü"). */
function dailySheet(points: Map<string, DayPoint>, list: string[], skipEmpty: boolean): XlsxSheet {
  const dayRows: XlsxCell[][] = [], sum = { orders: 0, sales: 0, cash: 0, card: 0, platform: 0, refunds: 0, discount: 0 };
  for (const d of list) {
    const t = points.get(d); if (!t && skipEmpty) continue;
    const v = { orders: t?.orders ?? 0, cash: t?.cash ?? 0, card: t?.card ?? 0, platform: t?.platform ?? 0, refunds: t?.refundTotal ?? 0, discount: t?.campaignDiscount ?? 0 };
    const sales = v.cash + v.card + v.platform;
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += k === 'sales' ? sales : v[k];
    dayRows.push([{ date: d }, v.orders, { money: sales }, { money: v.cash }, { money: v.card }, { money: v.platform }, { money: v.refunds }, { money: v.discount }]);
  }
  return { name: 'Günlük satışlar', widths: [12, 10, 15, 15, 15, 15, 13, 13], rows: [['Tarih', 'Sipariş', 'Satış', 'Nakit', 'Kart', 'Platform', 'İade', 'İndirim'], ...dayRows, [{ text: 'Toplam', bold: true }, sum.orders, { money: sum.sales, bold: true }, { money: sum.cash, bold: true }, { money: sum.card, bold: true }, { money: sum.platform, bold: true }, { money: sum.refunds, bold: true }, { money: sum.discount, bold: true }]],
    note: 'Tarih = iş günü (05:00–05:00). Satış = nakit + kart + platform tahsilatı; bahşiş dahil değil. İndirim: kampanya indirimi.' };
}

// ---------- "Tümü": years and months, never five years of records one by one ----------
/** Each calendar year of the business: its sales span (a closed year is one roll-up) and its tips and closings (cash roll-ups). */
export function yearFigures(src: ExportSources, tenant: string, s: State) {
  const years = src.store.history.years(tenant, s), table = yearTable(years.map(([year, span]) => [year, span.total]), s);
  return years.map(([year, span]) => ({ year, span, row: table.years.find(r => r.year === year)!, cash: src.cash?.cashSpan(tenant, `${year}-01-01`, `${year}-12-31`) })).reverse();
}
type YearFigures = ReturnType<typeof yearFigures>;
/** The printable page's "Tümü" tables of money records: per year, newest first, with the total. */
function yearMoneyTable(view: 'cash' | 'expenses' | 'corrections', years: YearFigures, blind = false): DocTable {
  const note = 'Kayıtların tek tek listesi için dönem olarak bir yıl seçin.';
  if (view === 'cash' && blind) return { title: 'Gün sonu kapanışları (yıllara göre)', head: ['Yıl', 'Kapanış'], right: [1], rows: years.map(y => [y.year, count(y.cash?.finals.count ?? 0)]), empty: 'Gün sonu kapanışı yapılmadı.', note };
  if (view === 'cash') {
    const total = years.reduce((t, y) => ({ count: t.count + (y.cash?.finals.count ?? 0), short: t.short + (y.cash?.finals.short ?? 0), over: t.over + (y.cash?.finals.over ?? 0), difference: t.difference + (y.cash?.finals.difference ?? 0) }), { count: 0, short: 0, over: 0, difference: 0 });
    return { title: 'Gün sonu kapanışları (yıllara göre)', head: ['Yıl', 'Kapanış', 'Eksik çıkan', 'Fazla çıkan', 'Toplam fark'], right: [1, 2, 3, 4], rows: years.map(y => [y.year, count(y.cash?.finals.count ?? 0), count(y.cash?.finals.short ?? 0), count(y.cash?.finals.over ?? 0), money(y.cash?.finals.difference ?? 0)]), foot: ['Toplam', count(total.count), count(total.short), count(total.over), money(total.difference)], empty: 'Gün sonu kapanışı yapılmadı.', note };
  }
  const pick = (y: YearFigures[number]) => view === 'expenses' ? { n: y.span.total.expenses, amount: y.span.total.expenseTotal } : { n: y.span.total.refunds, amount: y.span.total.refundTotal };
  const n = years.reduce((v, y) => v + pick(y).n, 0), amount = years.reduce((v, y) => v + pick(y).amount, 0);
  return { title: view === 'expenses' ? 'Giderler (yıllara göre)' : 'İadeler (yıllara göre)', head: ['Yıl', view === 'expenses' ? 'Gider kaydı' : 'İade', 'Tutar'], right: [1, 2], rows: years.map(y => [y.year, count(pick(y).n), money(pick(y).amount)]), foot: ['Toplam', count(n), money(amount)], note };
}
/** "Tümü" on the printable Özet: the year table (Satış, İade, Gider, Elde kalan, KDV) with its total. */
function yearSalesTable(years: YearFigures): DocTable {
  const sum = (k: 'sales' | 'refunds' | 'expenses' | 'kept' | 'vat') => years.reduce((n, y) => n + y.row[k], 0);
  return { title: 'Yıllara göre', head: ['Yıl', 'Satış', 'İade', 'Gider', 'Elde kalan', 'KDV'], right: [1, 2, 3, 4, 5], rows: years.map(y => [y.year, money(y.row.sales), money(y.row.refunds), money(y.row.expenses), money(y.row.kept), money(y.row.vat)]), foot: ['Toplam', money(sum('sales')), money(sum('refunds')), money(sum('expenses')), money(sum('kept')), money(sum('vat'))], note: 'Elde kalan = satış − iadeler − POS komisyonu − giderler. KDV bilgi amaçlıdır.' };
}
const MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
/** The accountant's "Tümü" file: a sheet of years, one sheet per year by month, every day's sales, KDV per year, products. */
function allTimeWorkbook(w: Window, years: YearFigures): XlsxSheet[] {
  const { s, report: r } = w, settings = vatSettings(s), byId = new Map(s.products.map(x => [x.id, x]));
  const money2 = (v: number, bold = false) => ({ money: v, ...(bold ? { bold } : {}) });
  const head = ['Yıl', 'Sipariş', 'Satış', 'Nakit', 'Kart', 'Platform', 'İade', 'POS komisyonu', 'Gider', 'Elde kalan', 'KDV', 'Bahşiş', 'Kasa kapanışı', 'Kasa farkı'];
  const yearRow = (label: string, y: { orders: number; sales: number; cash: number; card: number; platform: number; refunds: number; commission: number; expenses: number; kept: number; vat: number; tips: number; closings: number; difference: number }, bold = false): XlsxCell[] =>
    [bold ? { text: label, bold } : label, y.orders, money2(y.sales, bold), money2(y.cash, bold), money2(y.card, bold), money2(y.platform, bold), money2(y.refunds, bold), money2(y.commission, bold), money2(y.expenses, bold), money2(y.kept, bold), money2(y.vat, bold), money2(y.tips, bold), y.closings, money2(y.difference, bold)];
  // The Müdür's file (w.blind): the "Kasa farkı" column stays empty (0) and the year notes leave the difference out.
  const rows = years.map(y => ({ label: y.year, orders: y.row.orders, sales: y.row.sales, cash: y.row.cash, card: y.row.card, platform: y.row.platform, refunds: y.row.refunds, commission: y.row.commission, expenses: y.row.expenses, kept: y.row.kept, vat: y.row.vat, tips: y.cash?.tips.total ?? 0, closings: y.cash?.finals.count ?? 0, difference: w.blind ? 0 : y.cash?.finals.difference ?? 0 }));
  const total = rows.reduce((t, y) => Object.fromEntries(Object.keys(t).map(k => [k, (t as Record<string, number>)[k] + (y as unknown as Record<string, number>)[k]])) as typeof t, { orders: 0, sales: 0, cash: 0, card: 0, platform: 0, refunds: 0, commission: 0, expenses: 0, kept: 0, vat: 0, tips: 0, closings: 0, difference: 0 });
  const summary: XlsxSheet = { name: 'Yıllar', widths: [10, 10, 16, 16, 16, 14, 14, 14, 14, 16, 14, 13, 13, 13], rows: [head, ...rows.map(y => yearRow(y.label, y)), yearRow('Toplam', total, true)],
    note: 'Yıl = takvim yılı, günler iş günüdür (05:00–05:00). Elde kalan = satış − iadeler − POS komisyonu − giderler; net kâr değildir. Gider, iade ve kasa kapanışlarının tek tek listesi için dönem olarak bir yıl seçip indirin.' };
  // One sheet per year: its months (from the day points), newest year first.
  const yearSheets = years.map(y => {
    const months = new Map<string, { orders: number; cash: number; card: number; platform: number; refunds: number; commission: number; expenses: number; discount: number }>();
    for (const [day, p] of y.span.days) { const k = day.slice(0, 7), m = months.get(k) ?? { orders: 0, cash: 0, card: 0, platform: 0, refunds: 0, commission: 0, expenses: 0, discount: 0 }; m.orders += p.orders; m.cash += p.cash; m.card += p.card; m.platform += p.platform; m.refunds += p.refundTotal; m.commission += p.commission; m.expenses += p.expenseTotal; m.discount += p.campaignDiscount; months.set(k, m); }
    const list = [...months].filter(([, m]) => m.orders || m.cash || m.card || m.platform || m.refunds || m.expenses).sort((a, b) => a[0].localeCompare(b[0]));
    const line = (label: XlsxCell, m: { orders: number; cash: number; card: number; platform: number; refunds: number; commission: number; expenses: number; discount: number }, bold = false): XlsxCell[] => { const sales = m.cash + m.card + m.platform; return [label, m.orders, money2(sales, bold), money2(m.cash, bold), money2(m.card, bold), money2(m.platform, bold), money2(m.refunds, bold), money2(m.commission, bold), money2(m.expenses, bold), money2(sales - m.refunds - m.commission - m.expenses, bold), money2(m.discount, bold)]; };
    const sum = list.reduce((t, [, m]) => ({ orders: t.orders + m.orders, cash: t.cash + m.cash, card: t.card + m.card, platform: t.platform + m.platform, refunds: t.refunds + m.refunds, commission: t.commission + m.commission, expenses: t.expenses + m.expenses, discount: t.discount + m.discount }), { orders: 0, cash: 0, card: 0, platform: 0, refunds: 0, commission: 0, expenses: 0, discount: 0 });
    return { name: y.year, widths: [14, 10, 16, 16, 16, 14, 14, 14, 14, 16, 13], rows: [['Ay', 'Sipariş', 'Satış', 'Nakit', 'Kart', 'Platform', 'İade', 'POS komisyonu', 'Gider', 'Elde kalan', 'İndirim'], ...list.map(([k, m]) => line(`${MONTH_NAMES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`, m)), line({ text: 'Toplam', bold: true }, sum, true)],
      note: `${y.year}: KDV ${money(y.row.vat)}${y.cash ? ` · bahşiş ${money(y.cash.tips.total)} · ${y.cash.finals.count} gün sonu kapanışı${w.blind ? '' : `, toplam fark ${money(y.cash.finals.difference)}`}` : ''}.` } satisfies XlsxSheet;
  });
  const daily = dailySheet(w.days.days, [...w.days.days.keys()], true);
  const vat: XlsxSheet = { name: 'KDV dökümü', widths: [10, 8, 20, 16, 16], rows: [['Yıl', 'Oran', 'Satış (KDV dahil)', 'Matrah', 'KDV'], ...years.flatMap(y => y.row.vatRows.map(v => [y.year, { rate: v.rate }, { money: v.gross }, { money: v.base }, { money: v.vat }] as XlsxCell[])), [{ text: 'Toplam', bold: true }, '', { money: r.vat?.total.gross ?? 0, bold: true }, { money: r.vat?.total.base ?? 0, bold: true }, { money: r.vat?.total.vat ?? 0, bold: true }]],
    note: `Her yılın satışından o yılın iadeleri düşüldü; kalan, ürünlerin satıldığı KDV oranına göre bölündü. ${VAT_NOTE}` };
  const p = productsFrom(w.days, s.products);
  const products: XlsxSheet = { name: 'Ürün satışları', widths: [32, 20, 8, 10, 10, 16], rows: [['Ürün', 'Kategori', 'KDV', 'Adet', 'Kilogram', 'Tutar'], ...p.products.map(x => [x.name, x.category, { rate: productVat(byId.get(x.id), settings) }, x.qty, x.grams ? Math.round(x.grams) / 1000 : '', { money: x.amount }] as XlsxCell[]), [{ text: 'Toplam', bold: true }, '', '', '', '', { money: p.total, bold: true }]],
    note: 'İptaller hariç; indirimler ve ürün iadeleri düşülmüş sipariş tutarı. KDV: ürünün bugünkü oranı.' };
  return [summary, ...yearSheets, daily, vat, products];
}

// ---------- Routes ----------
const input = z.object({ from: z.string().max(10), to: z.string().max(10), view: z.enum(REPORT_VIEWS).default('summary') });
export function reportExportRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, deps: { cash?: CashBook; shifts?: ShiftBook; stock?: () => StockBook | undefined }) {
  const src: ExportSources = { store, cash: deps.cash, shifts: deps.shifts, stock: deps.stock };
  // Monthly and yearly roll-ups of every closed period, built in the background some seconds after the start (not in unit tests).
  if (!process.env.NODE_TEST_CONTEXT) {
    const warmer = setTimeout(() => void warmReports(src, now, () => !store.db.isOpen).catch(error => { if (store.db.isOpen) console.warn(`Rapor özetleri hazırlanamadı: ${error instanceof Error ? error.message : error}`); }), Number(process.env.MOLA_ROLLUP_WARM_MS ?? 30_000));
    warmer.unref();
  }
  const reader = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner', 'manager']); return a; };
  // Roll-ups the period needs are built first, in steps (a year or "Tümü" right after an update); null: the asker left.
  const open = async (req: Request, res: Response) => {
    const a = reader(req), q = input.parse(req.query);
    reportRange(q.from, q.to);
    res.setHeader('Cache-Control', 'no-store');
    if (!await readyFor(res, reportSteps(src, a.tenantId, q.from, q.to, now().getTime()))) return null;
    const w = reportWindow(src, a.tenantId, q.from, q.to, now());
    // K1: the Müdür reads every report without expected cash or differences (kasa line, closings table, Excel, PDF).
    if (a.role !== 'owner') { w.report = blindReport(w.report); w.blind = true; }
    return { a, q, w };
  };
  app.get('/api/staff/reports/simple', async (req, res) => {
    const opened = await open(req, res); if (!opened) return;
    const { a, w } = opened, kasa = kasaLine(src, a.tenantId, w, a.role, now().getTime());
    const counts = a.role === 'owner' ? dayCounts(src, a.tenantId, w) : [];
    res.json({ sentence: simpleSentence(w.report, w.today, kasa.text), kasa, ...(counts.length ? { counts } : {}), vat: w.report.vat ?? null, vatNote: VAT_NOTE, top: w.report.top.slice(0, 3), range: { from: w.report.from, to: w.report.to } });
  });
  /**
   * "Tümü" as a table of years (Satış, İade, Gider, Elde kalan, KDV) with the grand total, and the years the period picker
   * offers ("Yıl ▾"): closed years are one roll-up each.
   */
  app.get('/api/staff/reports/years', async (req, res) => {
    const a = reader(req), t = now().getTime();
    res.setHeader('Cache-Control', 'no-store');
    if (!await readyFor(res, reportSteps(src, a.tenantId, 'all', 'all', t))) return;
    const s = store.read(a.tenantId), table = yearTable(store.history.years(a.tenantId, s).map(([year, span]) => [year, span.total]), s);
    res.json({ today: businessDay(t), years: store.history.yearList(a.tenantId), table });
  });
  // The Kampanyalar page: its report one campaign window per step first (null: the asker left).
  const campaignsFor = async (res: Response, tenant: string, w: Window, view: ReportView) => {
    if (view !== 'campaigns') return { report: undefined };
    let left = false; res.on('close', () => { left = true; });
    const report = await drainSlowly(campaignReportSteps(w.s, now(), store.history.spanTotals(tenant, w.s)), () => left);
    return report ? { report } : null;
  };
  app.get('/api/staff/reports/document', async (req, res) => {
    const opened = await open(req, res); if (!opened) return;
    const { a, q, w } = opened, campaigns = await campaignsFor(res, a.tenantId, w, q.view); if (!campaigns) return;
    // A printable page under /api (no page CSP there): nothing in it runs (güvenlik denetimi).
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'");
    res.type('html').send(viewDocument(src, a.tenantId, q.view, w, now(), campaigns.report));
  });
  app.get('/api/staff/reports/document.pdf', async (req, res) => {
    const opened = await open(req, res); if (!opened) return;
    const { a, q, w } = opened, campaigns = await campaignsFor(res, a.tenantId, w, q.view); if (!campaigns) return;
    const pdf = await htmlToPdf(viewDocument(src, a.tenantId, q.view, w, now(), campaigns.report));
    if (!pdf) throw new DomainError('PDF_UNAVAILABLE', 'Bu bilgisayarda PDF hazırlanamadı. "Yazdır"a basın ve yazıcı olarak "PDF olarak kaydet"i seçin.', 409);
    res.setHeader('Content-Disposition', `attachment; filename="${documentFileName(q.view, w.report.from, w.report.to, 'pdf')}"`);
    res.type('application/pdf').send(pdf);
  });
  app.get('/api/staff/reports/accountant.xlsx', async (req, res) => {
    const opened = await open(req, res); if (!opened) return;
    const { a, q, w } = opened;
    const file = xlsx(accountantWorkbook(w, src, a.tenantId), { title: `${w.report.business} · ${rangePeriod(q.from, q.to).title} · Muhasebe`, now: now() });
    store.mutate(a.tenantId, s => { s.audit.push({ actor: a.id, action: 'reports.exported', target: `${w.report.from}:${w.report.to}`, at: now().toISOString() }); });
    res.setHeader('Content-Disposition', `attachment; filename="${documentFileName('summary', w.report.from, w.report.to, 'xlsx').replace('Satis-ozeti', 'Muhasebe')}"`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(file);
  });
}
