import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { lira, periodName, periodPrice, vatOf, type PeriodMonths } from '../../packages/domain/service-pricing.js';
import { pdfOf, pdfProblemText } from '../pdf-print.js';
import { xlsx, type XlsxCell } from '../report-export-xlsx.js';
import { open, seal } from '../sealing.js';
import { businessPrice, recurringRevenue, servicesView, vatRateOf } from './catalog.js';
import type { JournalChange } from './journal.js';
import { istanbulDay } from './journal-text.js';
import type { MerkezBusiness, MerkezData, MerkezStore } from './store.js';

/*
 * Satışlarım (Mola Yönetim, only the vendor): the vendor's OWN sales and payments: which business paid how much for which
 * package and period, how, with which invoice number; monthly recurring revenue; the vendor's KDV ("Yazılım hizmeti KDV
 * oranı", default %20) per month and year; Excel and PDF for the accountant. Never the cafés' sales: Merkez has none.
 *   - Kept in their own table (`satislar`, one sealed row per entry, merkez.sqlite: in Merkez's backup) so the registry stays small.
 *   - "Ödeme alındı" when extending a licence (server/merkez/app.ts /admin/licenses `payment`) makes an entry in the same
 *     transaction; entries can also be added by hand. An edit keeps the old values in the entry's `history` and in İşlem
 *     kayıtları; nothing is deleted ("İptal" keeps the row and takes it out of the totals).
 *   - Amounts are kuruş WITHOUT KDV (`net`); the KDV is `net × vatRate %` (rate kept per entry: a later rate change does not
 *     rewrite earlier invoices).
 */
export type SaleMethod = 'cash' | 'transfer' | 'card';
export type SaleStatus = 'paid' | 'unpaid' | 'cancelled';
export type SaleEntry = {
  id: string; tenantId: string; business: string; packageName: string;
  /** 1 ay / 6 ay / 1 yıl; null: anything else (kurulum, eğitim…). */
  months: PeriodMonths | null;
  /** Sale / invoice day (Türkiye), YYYY-MM-DD. */
  day: string; net: number; vatRate: number; method: SaleMethod; invoiceNo?: string; note?: string; status: SaleStatus;
  /** When it was marked paid (Türkiye day); "Bu ay tahsilat" counts by it. */
  paidDay?: string;
  source: 'extend' | 'manual'; createdAt: string; updatedAt?: string;
  /** Earlier values of an edited entry, newest last. */
  history?: { at: string; changes: JournalChange[] }[];
};
export const METHOD_NAMES: Record<SaleMethod, string> = { cash: 'Nakit', transfer: 'Havale / EFT', card: 'Kart' };
export const STATUS_NAMES: Record<SaleStatus, string> = { paid: 'Ödendi', unpaid: 'Ödenmedi', cancelled: 'İptal' };
const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const monthName = (ym: string) => `${MONTHS_TR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const dayText = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
export const grossOf = (e: Pick<SaleEntry, 'net' | 'vatRate'>) => e.net + vatOf(e.net, e.vatRate);

/** The ledger's table; each row sealed with a key of its own purpose (bound to the entry id, so rows cannot be swapped). */
export class SalesBook {
  private key: Buffer;
  constructor(private store: MerkezStore) {
    store.db.exec('CREATE TABLE IF NOT EXISTS satislar (id TEXT PRIMARY KEY, day TEXT NOT NULL, tenant TEXT NOT NULL, payload BLOB NOT NULL)');
    this.key = store.subkey('satislar');
  }
  all(): SaleEntry[] {
    const rows = this.store.db.prepare('SELECT id, payload FROM satislar ORDER BY day DESC').all() as { id: string; payload: Uint8Array }[];
    return rows.map(r => open<SaleEntry>(Buffer.from(r.payload), this.key, `merkez-satis:${r.id}`)).sort((a, b) => b.day.localeCompare(a.day) || b.createdAt.localeCompare(a.createdAt));
  }
  get(id: string): SaleEntry | undefined {
    const r = this.store.db.prepare('SELECT payload FROM satislar WHERE id=?').get(id) as { payload: Uint8Array } | undefined;
    return r ? open<SaleEntry>(Buffer.from(r.payload), this.key, `merkez-satis:${id}`) : undefined;
  }
  /** Inside the caller's MerkezStore.mutate when there is one: the entry and the history line are written together. */
  put(e: SaleEntry) { this.store.db.prepare('INSERT INTO satislar (id, day, tenant, payload) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day, tenant=excluded.tenant, payload=excluded.payload').run(e.id, e.day, e.tenantId, seal(e, this.key, `merkez-satis:${e.id}`)); }
}

/** "Ödeme alındı" in a licence extension, as the screen sends it. */
export const paymentSchema = z.object({
  net: z.number().int().min(0).max(1_000_000_000), vatRate: z.number().int().min(0).max(100).optional(), method: z.enum(['cash', 'transfer', 'card']),
  invoiceNo: z.string().trim().max(60).optional(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), status: z.enum(['paid', 'unpaid']).default('paid'), note: z.string().trim().max(300).optional(),
}).strict();
export type PaymentInput = z.infer<typeof paymentSchema>;
const SALE_LINE = (e: SaleEntry) => `${lira(grossOf(e))} (KDV hariç ${lira(e.net)}) · ${e.months ? periodName(e.months) : 'diğer'} · ${e.packageName} · ${METHOD_NAMES[e.method]}${e.invoiceNo ? ` · Fatura ${e.invoiceNo}` : ''} · ${STATUS_NAMES[e.status]}`;
const validDay = (day: string, now: Date) => {
  const t = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(t) || istanbulDay(new Date(t).toISOString()) !== day) throw new DomainError('DAY_INVALID', 'Tarih geçersiz.', 400);
  if (day < '2020-01-01' || t > now.getTime() + 62 * 86400000) throw new DomainError('DAY_INVALID', 'Tarih çok eski ya da çok ileride.', 400);
};
/** The entry an extension with "Ödeme alındı" makes (called inside the licence change's own transaction). */
export function saleFromExtension(book: SalesBook, d: MerkezData, biz: MerkezBusiness, months: PeriodMonths, p: PaymentInput, now: Date): SaleEntry {
  const today = istanbulDay(now.toISOString()), day = p.day ?? today; validDay(day, now);
  const e: SaleEntry = { id: randomUUID(), tenantId: biz.tenantId, business: biz.name, packageName: servicesView(d, biz).packageName, months, day, net: p.net, vatRate: p.vatRate ?? vatRateOf(d), method: p.method,
    ...(p.invoiceNo ? { invoiceNo: p.invoiceNo } : {}), ...(p.note ? { note: p.note } : {}), status: p.status, ...(p.status === 'paid' ? { paidDay: day } : {}), source: 'extend', createdAt: now.toISOString() };
  book.put(e);
  d.audit.push({ action: 'sale.created', target: biz.tenantId, at: now.toISOString(), by: 'admin', detail: `Lisans uzatmasında ödeme kaydı: ${SALE_LINE(e)}`, changes: [{ field: 'satış', from: '—', to: SALE_LINE(e) }] });
  return e;
}
/** The price the screen suggests for `months` of this business's services (its package, discounts, today's prices). */
export const suggestedAmount = (d: MerkezData, biz: MerkezBusiness, months: number) => periodPrice(businessPrice(d, biz), months);

// ---------- Totals ----------
export type SalesFilter = { year?: string; month?: string; tenant?: string };
export function filterSales(all: SaleEntry[], f: SalesFilter) {
  return all.filter(e => (!f.year || e.day.startsWith(f.year)) && (!f.month || e.day.slice(5, 7) === f.month.padStart(2, '0')) && (!f.tenant || e.tenantId === f.tenant));
}
/** Totals of the entries that count (not "İptal"): KDV hariç, KDV, toplam; paid and waiting; per KDV rate and per month. */
export function salesTotals(rows: SaleEntry[]) {
  const live = rows.filter(e => e.status !== 'cancelled');
  const sum = (list: SaleEntry[]) => list.reduce((t, e) => ({ net: t.net + e.net, vat: t.vat + vatOf(e.net, e.vatRate), gross: t.gross + grossOf(e) }), { net: 0, vat: 0, gross: 0 });
  const rates = [...new Set(live.map(e => e.vatRate))].sort((a, b) => b - a).map(rate => ({ rate, ...sum(live.filter(e => e.vatRate === rate)) }));
  const months = [...new Set(live.map(e => e.day.slice(0, 7)))].sort().map(month => { const m = live.filter(e => e.day.startsWith(month)); return { month, name: monthName(month), count: m.length, ...sum(m), paid: sum(m.filter(e => e.status === 'paid')).gross, unpaid: sum(m.filter(e => e.status === 'unpaid')).gross }; });
  return { count: live.length, ...sum(live), paid: sum(live.filter(e => e.status === 'paid')).gross, unpaid: sum(live.filter(e => e.status === 'unpaid')).gross, rates, months };
}
/** The three cards: this month's collections (by payment day), monthly recurring revenue, payments still waiting. */
export function salesKpis(all: SaleEntry[], d: MerkezData, now: Date) {
  const month = istanbulDay(now.toISOString()).slice(0, 7);
  const collected = all.filter(e => e.status === 'paid' && (e.paidDay ?? e.day).startsWith(month));
  const waiting = all.filter(e => e.status === 'unpaid');
  return { month, monthName: monthName(month), collected: collected.reduce((t, e) => t + grossOf(e), 0), collectedCount: collected.length,
    mrr: recurringRevenue(d, now), pending: { count: waiting.length, gross: waiting.reduce((t, e) => t + grossOf(e), 0) } };
}
const periodTitle = (f: SalesFilter) => f.month && f.year ? monthName(`${f.year}-${f.month.padStart(2, '0')}`) : f.year ? `${f.year} yılı` : 'Bütün kayıtlar';

// ---------- Excel and PDF for the accountant ----------
export function salesXlsx(rows: SaleEntry[], f: SalesFilter, businessName: string | undefined, now: Date) {
  const t = salesTotals(rows);
  const head = ['Tarih', 'İşletme', 'Paket', 'Dönem', 'Tutar (KDV hariç)', 'KDV oranı', 'KDV', 'Toplam', 'Ödeme yöntemi', 'Fatura no', 'Durum', 'Ödeme tarihi', 'Not'];
  const list: XlsxCell[][] = [head, ...rows.map(e => [{ date: e.day }, e.business, e.packageName, e.months ? periodName(e.months) : 'Diğer', { money: e.net }, { rate: e.vatRate }, { money: vatOf(e.net, e.vatRate) }, { money: grossOf(e) }, METHOD_NAMES[e.method], e.invoiceNo ?? '', STATUS_NAMES[e.status], e.paidDay ? { date: e.paidDay } : '', e.note ?? ''] as XlsxCell[]),
    [{ text: 'Toplam (iptaller hariç)', bold: true }, '', '', '', { money: t.net, bold: true }, '', { money: t.vat, bold: true }, { money: t.gross, bold: true }]];
  const months: XlsxCell[][] = [['Ay', 'Kayıt', 'KDV hariç', 'KDV', 'Toplam', 'Tahsil edilen', 'Bekleyen'], ...t.months.map(m => [m.name, m.count, { money: m.net }, { money: m.vat }, { money: m.gross }, { money: m.paid }, { money: m.unpaid }] as XlsxCell[]),
    [{ text: 'Toplam', bold: true }, t.count, { money: t.net, bold: true }, { money: t.vat, bold: true }, { money: t.gross, bold: true }, { money: t.paid, bold: true }, { money: t.unpaid, bold: true }]];
  const rates: XlsxCell[][] = [['KDV oranı', 'KDV hariç', 'KDV', 'Toplam'], ...t.rates.map(r => [{ rate: r.rate }, { money: r.net }, { money: r.vat }, { money: r.gross }] as XlsxCell[])];
  const note = `Mola Yönetim · Satışlarım · ${periodTitle(f)}${businessName ? ` · ${businessName}` : ''}. Satıcının kendi satışları; işletmelerin satış verisi burada yoktur. Tutarlar TL; iptal edilen kayıtlar toplamlara girmez.`;
  return xlsx([{ name: 'Satışlar', widths: [12, 28, 22, 9, 16, 9, 13, 14, 14, 16, 11, 13, 30], rows: list, note }, { name: 'Aylık toplam', widths: [16, 8, 16, 14, 16, 16, 14], rows: months }, { name: 'KDV dökümü', widths: [12, 16, 14, 16], rows: rates }], { title: `Satışlarım · ${periodTitle(f)}`, now });
}
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const CSS = `@page{size:A4 landscape;margin:12mm 12mm 14mm;@bottom-right{content:"Sayfa " counter(page) " / " counter(pages);font:8pt "Segoe UI",Arial,sans-serif;color:#6b756f}}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#1d2622;font-size:9.5pt;line-height:1.4;background:#fff}
.page{max-width:273mm;margin:0 auto;padding:4mm 0}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;border-bottom:2px solid #234c3e;padding-bottom:6px}
header small{font-size:9.5pt;color:#5d6862}h1{font-size:16pt;margin:2px 0 0}header .when{text-align:right;font-size:9pt;color:#5d6862}
.figures{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0 4px}.figure{border:1px solid #d6dfd9;border-radius:6px;padding:6px 8px}
.figure span{display:block;font-size:8pt;color:#5d6862}.figure strong{font-size:12.5pt;color:#234c3e}
h2{font-size:10.5pt;margin:12px 0 3px;color:#234c3e;border-bottom:1px solid #cfd9d2;padding-bottom:2px}
table{width:100%;border-collapse:collapse}th,td{padding:3px 6px 3px 0;border-bottom:1px solid #edf0ed;text-align:left;vertical-align:top}
th{font-size:8pt;color:#5d6862;font-weight:600;border-bottom:1px solid #cfd9d2}.r{text-align:right;white-space:nowrap;padding-left:6px;padding-right:0}
tfoot td{font-weight:700;border-top:1.5px solid #234c3e;border-bottom:0}tr{break-inside:avoid}thead{display:table-header-group}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:10mm}.muted{color:#6b756f}.cancel td{color:#9aa39d;text-decoration:line-through}
footer{margin-top:12px;padding-top:6px;border-top:1px solid #d6dfd9;font-size:8pt;color:#6b756f}
@media screen{body{background:#f3f4f1}.page{background:#fff;margin:16px auto;padding:12mm;box-shadow:0 1px 4px rgba(0,0,0,.12)}}
@media screen and (max-width:700px){.page{margin:0;padding:14px;box-shadow:none}.figures,.cols{grid-template-columns:1fr 1fr}table{display:block;overflow-x:auto}}`;
/** The printable A4 page (landscape) for the accountant: figures, every entry, months, KDV per rate. */
export function salesDocument(rows: SaleEntry[], f: SalesFilter, businessName: string | undefined, now: Date) {
  const t = salesTotals(rows), title = `Satışlarım · ${periodTitle(f)}`;
  const td = (v: string, right = false) => `<td${right ? ' class="r"' : ''}>${esc(v)}</td>`;
  const entries = rows.length ? `<table><thead><tr><th>Tarih</th><th>İşletme</th><th>Paket</th><th>Dönem</th><th class="r">KDV hariç</th><th class="r">KDV</th><th class="r">Toplam</th><th>Yöntem</th><th>Fatura no</th><th>Durum</th></tr></thead><tbody>${rows.map(e => `<tr${e.status === 'cancelled' ? ' class="cancel"' : ''}>${td(dayText(e.day))}${td(e.business)}${td(e.packageName)}${td(e.months ? periodName(e.months) : 'Diğer')}${td(lira(e.net), true)}${td(`%${e.vatRate} · ${lira(vatOf(e.net, e.vatRate))}`, true)}${td(lira(grossOf(e)), true)}${td(METHOD_NAMES[e.method])}${td(e.invoiceNo ?? '—')}${td(STATUS_NAMES[e.status])}</tr>`).join('')}</tbody><tfoot><tr><td colspan="4">Toplam (iptaller hariç)</td>${td(lira(t.net), true)}${td(lira(t.vat), true)}${td(lira(t.gross), true)}<td colspan="3"></td></tr></tfoot></table>` : '<p class="muted">Bu dönemde kayıt yok.</p>';
  const months = `<table><thead><tr><th>Ay</th><th class="r">KDV hariç</th><th class="r">KDV</th><th class="r">Toplam</th><th class="r">Bekleyen</th></tr></thead><tbody>${t.months.map(m => `<tr>${td(m.name)}${td(lira(m.net), true)}${td(lira(m.vat), true)}${td(lira(m.gross), true)}${td(lira(m.unpaid), true)}</tr>`).join('')}</tbody></table>`;
  const rates = `<table><thead><tr><th>KDV oranı</th><th class="r">KDV hariç</th><th class="r">KDV</th><th class="r">Toplam</th></tr></thead><tbody>${t.rates.map(r => `<tr>${td(`%${r.rate}`)}${td(lira(r.net), true)}${td(lira(r.vat), true)}${td(lira(r.gross), true)}</tr>`).join('')}</tbody></table>`;
  const figures = [['KDV hariç', lira(t.net)], ['KDV', lira(t.vat)], ['Toplam', lira(t.gross)], ['Bekleyen ödeme', lira(t.unpaid)]].map(([k, v]) => `<div class="figure"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="page">
<header><div><small>Mola Yönetim${businessName ? ` · ${esc(businessName)}` : ''}</small><h1>${esc(title)}</h1></div><div class="when">${t.count} kayıt<br>Hazırlandı: ${esc(dayText(istanbulDay(now.toISOString())))}</div></header>
<div class="figures">${figures}</div>
<h2>Satışlar ve tahsilatlar</h2>${entries}
${t.count ? `<div class="cols"><section><h2>Aylık toplam</h2>${months}</section><section><h2>KDV dökümü</h2>${rates}</section></div>` : ''}
<footer>Satıcının kendi satışları (Mola Yönetim → Satışlarım). Tutarlar KDV hariç girilir; KDV her kaydın kendi oranıyla hesaplanır. İptal edilen kayıtlar toplamlara girmez. İşletmelerin satış verisi burada yoktur.</footer>
</div></body></html>`;
}

export type SalesDeps = {
  store: MerkezStore; now: () => Date; book: SalesBook;
  admin: (req: Request) => unknown;
  /** A new entry or an edit: the admin plus the Authenticator step-up (server/merkez/step-up.ts, 'sales'). */
  change: (req: Request) => unknown;
  once: <T>(d: MerkezData, scope: string, b: object, fn: () => T) => T;
};
const filterSchema = z.object({ year: z.string().regex(/^\d{4}$/).optional(), month: z.string().regex(/^(0?[1-9]|1[0-2])$/).optional(), tenant: z.string().min(1).max(100).optional() }).strip();
function send(res: Response, data: Buffer, type: string, name: string) {
  res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': String(data.length) });
  res.end(data);
}

export function salesRoutes(app: Express, o: SalesDeps) {
  const at = () => o.now().toISOString();
  const query = (req: Request) => { const f = filterSchema.parse(req.query); return { ...f, ...(f.month ? { month: f.month.padStart(2, '0') } : {}) } as SalesFilter; };
  const nameOf = (d: MerkezData, all: SaleEntry[], tenant?: string) => tenant ? d.businesses.find(b => b.tenantId === tenant)?.name ?? all.find(e => e.tenantId === tenant)?.business : undefined;
  app.get('/api/merkez/admin/sales', (req, res) => {
    o.admin(req); const f = query(req), d = o.store.read(), all = o.book.all(), rows = filterSales(all, f), now = o.now();
    const years = [...new Set([istanbulDay(now.toISOString()).slice(0, 4), ...all.map(e => e.day.slice(0, 4))])].sort().reverse();
    // Each business's suggested prices for "Ödeme ekle" (its package, discounts, today's prices).
    const businesses = d.businesses.filter(b => !b.application || b.application.status === 'approved' || b.installId).map(b => { const v = servicesView(d, b); return { tenantId: b.tenantId, name: b.name, packageName: v.packageName, monthly: v.price.monthly, yearly: v.price.yearly, planMonths: b.planMonths, kind: b.kind }; })
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    const gone = [...new Map(all.filter(e => !d.businesses.some(b => b.tenantId === e.tenantId)).map(e => [e.tenantId, { tenantId: e.tenantId, name: e.business, packageName: e.packageName, monthly: 0, yearly: 0, removed: true }])).values()];
    res.json({ entries: rows, totals: salesTotals(rows), kpis: salesKpis(all, d, now), vatRate: vatRateOf(d), years, businesses: [...businesses, ...gone], today: istanbulDay(now.toISOString()) });
  });
  /** A new entry (no id) or an edit; the old values go into the entry's history and İşlem kayıtları. */
  app.post('/api/merkez/admin/sales', (req, res) => {
    o.change(req);
    const b = z.object({ requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), id: z.string().uuid().optional(), tenantId: z.string().min(1).max(100), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), months: z.union([z.literal(1), z.literal(6), z.literal(12), z.null()]),
      packageName: z.string().trim().max(80).optional(), net: z.number().int().min(0).max(1_000_000_000), vatRate: z.number().int().min(0).max(100), method: z.enum(['cash', 'transfer', 'card']), invoiceNo: z.string().trim().max(60).optional(), note: z.string().trim().max(300).optional(),
      status: z.enum(['paid', 'unpaid', 'cancelled']), expectedUpdatedAt: z.string().max(40).optional() }).strict().parse(req.body);
    res.json(o.store.mutate(d => o.once(d, 'sale', b, () => {
      const now = o.now(), time = now.toISOString(); validDay(b.day, now);
      const biz = d.businesses.find(x => x.tenantId === b.tenantId), old = b.id ? o.book.get(b.id) : undefined;
      if (b.id && !old) throw new DomainError('NOT_FOUND', 'Kayıt bulunamadı. Listeyi yenileyin.', 404);
      if (!biz && !old) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
      if (old && b.expectedUpdatedAt !== undefined && (old.updatedAt ?? old.createdAt) !== b.expectedUpdatedAt) throw new DomainError('VERSION_CONFLICT', 'Kayıt bu arada değişti. Listeyi yenileyin.', 409);
      const packageName = b.packageName || (biz ? servicesView(d, biz).packageName : old!.packageName);
      const entry: SaleEntry = { ...(old ?? { id: randomUUID(), source: 'manual' as const, createdAt: time }), tenantId: b.tenantId, business: old && old.tenantId === b.tenantId ? (biz?.name ?? old.business) : biz!.name, packageName, months: b.months, day: b.day, net: b.net, vatRate: b.vatRate, method: b.method, status: b.status };
      if (b.invoiceNo) entry.invoiceNo = b.invoiceNo; else delete entry.invoiceNo;
      if (b.note) entry.note = b.note; else delete entry.note;
      // Paid: a new entry on its own day; an entry marked paid later on the day it was marked; an already paid one keeps its day.
      if (b.status === 'paid') entry.paidDay = old?.status === 'paid' && old.paidDay ? old.paidDay : old ? istanbulDay(time) : b.day; else delete entry.paidDay;
      if (!old) {
        o.book.put(entry);
        d.audit.push({ action: 'sale.created', target: b.tenantId, at: time, by: 'admin', detail: `Elle eklendi: ${SALE_LINE(entry)}`, changes: [{ field: 'satış', from: '—', to: SALE_LINE(entry) }] });
        return { ok: true, id: entry.id };
      }
      const fields: [string, string, string][] = [['tarih', dayText(old.day), dayText(entry.day)], ['işletme', old.business, entry.business], ['paket', old.packageName, entry.packageName], ['dönem', old.months ? periodName(old.months) : 'diğer', entry.months ? periodName(entry.months) : 'diğer'],
        ['tutar (KDV hariç)', lira(old.net), lira(entry.net)], ['KDV oranı', `%${old.vatRate}`, `%${entry.vatRate}`], ['yöntem', METHOD_NAMES[old.method], METHOD_NAMES[entry.method]], ['fatura no', old.invoiceNo ?? '—', entry.invoiceNo ?? '—'], ['not', old.note ?? '—', entry.note ?? '—'], ['durum', STATUS_NAMES[old.status], STATUS_NAMES[entry.status]]];
      const changes = fields.filter(([, x, y]) => x !== y).map(([field, from, to]) => ({ field, from, to }));
      if (!changes.length) return { ok: true, id: entry.id };
      entry.updatedAt = time; entry.history = [...(old.history ?? []), { at: time, changes }].slice(-50);
      o.book.put(entry);
      const action = changes.length === 1 && changes[0].field === 'durum' ? (entry.status === 'paid' ? 'sale.paid' : entry.status === 'cancelled' ? 'sale.cancelled' : 'sale.unpaid') : 'sale.updated';
      d.audit.push({ action, target: entry.tenantId, at: time, by: 'admin', detail: SALE_LINE(entry), changes });
      return { ok: true, id: entry.id };
    })));
  });
  const fileName = (f: SalesFilter, ext: string) => `mola-satislarim-${f.year ?? 'tumu'}${f.month ? `-${f.month}` : ''}.${ext}`;
  const exported = (format: string, f: SalesFilter, count: number) => o.store.mutate(d => { d.audit.push({ action: 'sales.exported', target: 'merkez', at: at(), by: 'admin', detail: `${format} · ${periodTitle(f)}${f.tenant ? ` · ${nameOf(d, [], f.tenant) ?? 'işletme'}` : ''} · ${count} kayıt` }); });
  app.get('/api/merkez/admin/sales/report.xlsx', (req, res) => {
    o.admin(req); const f = query(req), d = o.store.read(), all = o.book.all(), rows = filterSales(all, f);
    const data = salesXlsx(rows, f, nameOf(d, all, f.tenant), o.now());
    exported('Excel', f, rows.length);
    send(res, data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName(f, 'xlsx'));
  });
  /** The printable page itself (opens in a new tab: the browser's own "Yazdır → PDF olarak kaydet" when no PDF can be made here). */
  app.get('/api/merkez/admin/sales/report.html', (req, res) => {
    o.admin(req); const f = query(req), d = o.store.read(), all = o.book.all(), rows = filterSales(all, f);
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'");
    res.type('text/html; charset=utf-8').send(salesDocument(rows, f, nameOf(d, all, f.tenant), o.now()));
  });
  app.get('/api/merkez/admin/sales/report.pdf', async (req, res) => {
    o.admin(req); const f = query(req), d = o.store.read(), all = o.book.all(), rows = filterSales(all, f);
    const made = await pdfOf(salesDocument(rows, f, nameOf(d, all, f.tenant), o.now())), pdf = made.pdf;
    if (!pdf) throw new DomainError('PDF_UNAVAILABLE', pdfProblemText(made, '“Yazdır” ile tarayıcıdan PDF olarak kaydedebilir ya da Excel alabilirsiniz.'), 409);
    exported('PDF', f, rows.length);
    send(res, pdf, 'application/pdf', fileName(f, 'pdf'));
  });
}
