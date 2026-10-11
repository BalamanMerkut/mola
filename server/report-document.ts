import { businessDay } from '../packages/domain/business-day.js';
import { buildPeriodReport, esc, money, periodOf, periodText, plainSummary, preparedText, sections, type PeriodKind, type PeriodReport, type ReportSources, type Section } from './email-reports-content.js';
import { safeFilename } from './smtp.js';

/*
 * The printable report (one A4 page or a few): a clean HTML document of a period report, made on the café computer.
 *   - E-posta raporları attach it (server/email-reports.ts): turned into a PDF by the installed Edge/Chrome when there is one
 *     (server/pdf-print.ts), else attached as this HTML itself (opens in any browser, prints from there).
 *   - Satış ve Raporlar → "Yazdır / PDF" prints the open report with the same layout (`printDocument`, built per report by
 *     server/report-export.ts): the period's plain summary first, then that report's tables. Page numbers at the foot.
 * No scripts, no outside files (fonts, images): it prints the same everywhere and offline. Never guests or anything personal.
 */
const CSS = `@page{size:A4;margin:14mm 14mm 16mm;@bottom-right{content:"Sayfa " counter(page) " / " counter(pages);font:8pt "Segoe UI",Arial,sans-serif;color:#6b756f}}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#1d2622;font-size:10.5pt;line-height:1.4;background:#fff}
.page{max-width:182mm;margin:0 auto;padding:6mm 0}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;border-bottom:2px solid #234c3e;padding-bottom:6px}
header .business{font-size:10pt;color:#5d6862}
h1{font-size:16pt;margin:2px 0 0;color:#1d2622}
header .when{text-align:right;font-size:9.5pt;color:#5d6862;white-space:nowrap}
.lead{margin:10px 0 0;padding:9px 12px;background:#eef4f0;border-radius:6px;font-size:11.5pt}
.figures{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0 2px}
.figure{border:1px solid #d6dfd9;border-radius:6px;padding:6px 8px}
.figure span{display:block;font-size:8.5pt;color:#5d6862}
.figure strong{font-size:13pt;color:#234c3e}
.parts{columns:2;column-gap:10mm}
section{break-inside:avoid;margin-top:10px}
section.wide{break-inside:auto;margin-top:14px}
h2{font-size:11pt;margin:0 0 3px;color:#234c3e;border-bottom:1px solid #cfd9d2;padding-bottom:2px}
table{width:100%;border-collapse:collapse}
td{padding:2.5px 0;border-bottom:1px solid #edf0ed;vertical-align:top}
td.v{text-align:right;font-weight:600;white-space:nowrap;padding-left:8px}
.grid th,.grid td{padding:3px 6px 3px 0;border-bottom:1px solid #edf0ed;text-align:left;vertical-align:top;font-size:9.5pt}
.grid th{font-size:8.5pt;color:#5d6862;font-weight:600;border-bottom:1px solid #cfd9d2}
.grid .r{text-align:right;white-space:nowrap;padding-right:0;padding-left:8px}
.grid tfoot td{font-weight:700;border-top:1.5px solid #234c3e;border-bottom:0}
.grid tr{break-inside:avoid}
thead{display:table-header-group}
.note{font-size:8.5pt;color:#5d6862;margin:3px 0 0}
.empty{font-size:9.5pt;color:#5d6862;margin:4px 0 0}
footer{margin-top:12px;padding-top:6px;border-top:1px solid #d6dfd9;font-size:8.5pt;color:#6b756f}
@media screen{body{background:#f3f4f1}.page{background:#fff;margin:16px auto;padding:14mm;box-shadow:0 1px 4px rgba(0,0,0,.12)}}
@media screen and (max-width:640px){.page{margin:0;padding:16px;box-shadow:none}.figures{grid-template-columns:repeat(2,1fr)}.parts{columns:1}header{flex-wrap:wrap}header .when{text-align:left}.grid{display:block;overflow-x:auto}}`;

/** A table of a report: column titles, rows of text, `right` = column numbers aligned right (money, counts), `foot` = a total row. */
export type DocTable = { title: string; head: string[]; rows: string[][]; right?: number[]; foot?: string[]; note?: string; empty?: string };
export type DocSpec = {
  /** `business`: the small line above the heading; `pageTitle`: the browser tab and PDF title (default: the heading). */
  business: string; title: string; pageTitle?: string; when: string; lead: string; note?: string;
  figures?: [string, string][]; parts?: Section[]; tables?: DocTable[]; prepared: string;
};
const figure = ([label, value]: [string, string]) => `<div class="figure"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
const part = (s: Section) => `<section><h2>${esc(s.title)}</h2><table>${s.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')}</table>${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</section>`;
function grid(t: DocTable) {
  const cls = (i: number) => t.right?.includes(i) ? ' class="r"' : '';
  const body = t.rows.length ? `<table class="grid"><thead><tr>${t.head.map((h, i) => `<th${cls(i)}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map((c, i) => `<td${cls(i)}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>${t.foot ? `<tfoot><tr>${t.foot.map((c, i) => `<td${cls(i)}>${esc(c)}</td>`).join('')}</tr></tfoot>` : ''}</table>` : `<p class="empty">${esc(t.empty ?? 'Bu dönemde kayıt yok.')}</p>`;
  return `<section class="wide"><h2>${esc(t.title)}</h2>${body}${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}</section>`;
}
/** Any printable report page: heading, the plain sentence, a few big numbers, two-column parts, then full-width tables. */
export function printDocument(d: DocSpec) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.pageTitle ?? d.title)}</title><style>${CSS}</style></head><body><div class="page">
<header><div><div class="business">${esc(d.business)}</div><h1>${esc(d.title)}</h1></div><div class="when">${esc(d.when)}<br>iş günü 05:00–05:00</div></header>
${d.note ? `<p class="note" style="font-size:10pt;margin-top:8px">${esc(d.note)}</p>` : ''}<p class="lead">${esc(d.lead)}</p>
${d.figures?.length ? `<div class="figures">${d.figures.map(figure).join('')}</div>` : ''}
${d.parts?.length ? `<div class="parts">${d.parts.map(part).join('')}</div>` : ''}${(d.tables ?? []).map(grid).join('')}
<footer>${esc(d.prepared)} · Bu rapor işletmenin bilgisayarında hazırlandı; müşteri bilgisi içermez. Mola</footer>
</div></body></html>`;
}
/** The four big numbers of every period report. */
export const headlineFigures = (r: PeriodReport): [string, string][] => [['Toplam tahsilat', money(r.sales.total)], ['Sipariş', String(r.sales.orders)], ['Gider', money(r.expenses.total)], ['Elde kalan', money(r.kept)]];

/** The A4 page of one period report. `note`: a line above the figures (e.g. "Deneme"). */
export function reportDocument(r: PeriodReport, o: { note?: string; running?: boolean } = {}) {
  return printDocument({ business: r.business, title: r.title, pageTitle: `${r.title} · ${r.business}`, when: periodText(r), lead: plainSummary(r, o.running), note: o.note, figures: headlineFigures(r), parts: sections(r), prepared: preparedText(r) });
}
/** "Mola-Gun-sonu-raporu-2026-10-05.pdf", "Mola-Haftalik-rapor-2026-10-05.html": ASCII, sortable by date. */
export const reportFileName = (r: Pick<PeriodReport, 'kind' | 'from'>, ext: 'pdf' | 'html') => safeFilename(`Mola ${({ day: 'Gun sonu raporu', week: 'Haftalik rapor', month: 'Aylik rapor', year: 'Yillik rapor', range: 'Rapor', all: 'Rapor' } as const)[r.kind]} ${r.from}`) + `.${ext}`;
/** The printable page of any period holding business day `day` (default: today's business day), as the report screen would print it. */
export function periodDocument(src: ReportSources, tenant: string, kind: PeriodKind, now: Date, day = businessDay(now.getTime())) {
  const report = buildPeriodReport(src, tenant, periodOf(kind, day), now);
  // A period still running (and not yet closed with a gün sonu) reads "şu ana kadar".
  return { report, html: reportDocument(report, { running: !!report.early && !report.closings.count }) };
}
