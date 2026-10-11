import { xlsx, type XlsxCell } from '../report-export-xlsx.js';
import { changeText, type JournalFilter, type JournalRow, type Seal, type VerifyReport } from './journal.js';
import { sealFingerprint } from './journal.js';
import { ACTOR_NAMES, GROUP_NAMES, RESULT_NAMES, SOURCE_NAMES, istanbulTime, type JournalGroup } from './journal-text.js';
import { showFingerprint } from '../license.js';

/*
 * "Rapor al" (Mola Yönetim → Ayarlar → İşlem kayıtları): the filtered lines as a readable A4 report (printed to PDF by the
 * browser already on this computer, server/pdf-print.ts) and as Excel. The cover page says the period, the filters, how many
 * lines, the chain check ("Kayıtlar bütün" or where it breaks) and the seal's fingerprint, so a reader can compare it with
 * the JSONL copy (Merkez's public key and every hash) that can be checked independently (scripts/islem-dogrula.mjs).
 */
export type ReportInfo = { filter: JournalFilter; filterText: string[]; verify: VerifyReport; seal: Seal | null; generatedAt: string; keyId: string; total: number; businessName?: string };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dayText = (d?: string) => d ? d.split('-').reverse().join('.') : '';
export const periodText = (f: JournalFilter) => f.from && f.to ? `${dayText(f.from)} – ${dayText(f.to)}` : f.from ? `${dayText(f.from)} ve sonrası` : f.to ? `${dayText(f.to)} ve öncesi` : 'Bütün kayıtlar';
export const actorText = (r: JournalRow) => r.actor.name ?? ACTOR_NAMES[r.actor.kind];
export const detailText = (r: JournalRow) => [r.detail, ...(r.changes ?? []).map(changeText), r.address ? `Adres: ${r.address}` : '', r.legacy ? 'Aktarılan eski kayıt (zincir öncesi)' : ''].filter(Boolean).join(' · ');
const rowNo = (r: JournalRow) => r.sub ? `${r.seq}.${r.sub}` : String(r.seq);

export function reportHtml(rows: JournalRow[], info: ReportInfo) {
  const v = info.verify, seal = info.seal;
  const cover = [
    ['Dönem', periodText(info.filter)], ['Süzgeçler', info.filterText.length ? info.filterText.join(' · ') : 'Yok (bütün işlemler)'], ['Rapordaki kayıt', `${rows.length}`],
    ['Zincir denetimi', v.ok ? `Kayıtlar bütün (${v.count} kayıt, #${v.firstSeq ?? '—'} – #${v.lastSeq ?? '—'})` : v.text],
    ['Mühür', seal ? `#${seal.seq} · ${istanbulTime(seal.at)} · parmak izi ${sealFingerprint(seal)}` : 'Henüz yok'],
    ['Mola Merkez anahtarı', showFingerprint(info.keyId)], ['Rapor zamanı', `${istanbulTime(info.generatedAt)} (Türkiye saati)`],
  ];
  const body = rows.map(r => `<tr${r.result !== 'basarili' ? ' class="bad"' : ''}><td class="no">${esc(rowNo(r))}</td><td class="time">${esc(istanbulTime(r.at))}</td><td>${esc(actorText(r))}<small>${esc(SOURCE_NAMES[r.source])}</small></td><td><strong>${esc(r.text)}</strong>${r.result !== 'basarili' ? `<small class="result">${esc(RESULT_NAMES[r.result])}</small>` : ''}<small class="code">${esc(r.action)}</small></td><td>${esc(r.business?.name ?? r.target?.name ?? '—')}</td><td>${esc(detailText(r))}</td></tr>`).join('');
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>İşlem kayıtları raporu</title><style>
@page { size: A4 landscape; margin: 14mm 12mm 16mm; @bottom-right { content: "Sayfa " counter(page) " / " counter(pages); font: 9px system-ui, sans-serif; color: #555; } @bottom-left { content: "Mola Yönetim · İşlem kayıtları"; font: 9px system-ui, sans-serif; color: #555; } }
* { box-sizing: border-box; } body { font: 10.5px/1.4 "Segoe UI", system-ui, sans-serif; color: #1b2a22; margin: 0; }
.cover { page-break-after: always; padding-top: 30mm; } .cover h1 { font-size: 26px; margin: 0 0 4px; color: #134e3a; } .cover p.lead { font-size: 13px; color: #44544b; margin: 0 0 18mm; }
.cover table { border-collapse: collapse; width: 100%; font-size: 13px; } .cover th { text-align: left; width: 55mm; color: #44544b; font-weight: 600; padding: 7px 10px 7px 0; vertical-align: top; } .cover td { padding: 7px 0; border-bottom: 1px solid #dfe7e2; }
.status { display: inline-block; padding: 2px 10px; border-radius: 12px; font-weight: 700; } .status.ok { background: #e3f3ea; color: #135c38; } .status.bad { background: #fde6e4; color: #8f1d14; }
.note { margin-top: 12mm; font-size: 11px; color: #44544b; max-width: 200mm; }
table.rows { border-collapse: collapse; width: 100%; } table.rows thead { display: table-header-group; } table.rows th { background: #e3ede6; text-align: left; padding: 5px 6px; font-size: 10px; border-bottom: 1px solid #9db3a6; }
table.rows td { padding: 4px 6px; border-bottom: 1px solid #e6ece8; vertical-align: top; } table.rows tr { page-break-inside: avoid; } td small { display: block; color: #66756c; font-size: 9px; } td small.code { font-family: Consolas, monospace; }
td.no { width: 12mm; color: #66756c; } td.time { width: 30mm; white-space: nowrap; } tr.bad td { background: #fff6f5; } small.result { color: #8f1d14 !important; font-weight: 700; }
</style></head><body>
<section class="cover"><h1>İşlem kayıtları raporu</h1><p class="lead">Mola Yönetim · Mola Merkez’in değiştirilemez işlem kayıtlarından alınmıştır.</p>
<table>${cover.map(([k, val], i) => `<tr><th>${esc(k)}</th><td>${i === 3 ? `<span class="status ${v.ok ? 'ok' : 'bad'}">${esc(val)}</span>` : esc(val)}</td></tr>`).join('')}</table>
<p class="note">Her kayıt bir önceki kaydın SHA-256 özetini taşır; kayıtlar yalnız eklenir, değiştirilemez ve silinemez. Zincirin başı belirli aralıklarla Mola Merkez’in Ed25519 anahtarıyla mühürlenir. Bu raporun dayandığı kayıtlar, özetleri ve mühürleriyle birlikte JSONL olarak da alınabilir ve Mola olmadan denetlenebilir (yöntem: docs/ISLEM_KAYITLARI.md). Saatler Türkiye saatidir (Europe/Istanbul).</p></section>
<table class="rows"><thead><tr><th>No</th><th>Zaman</th><th>Kim · nereden</th><th>Ne yapıldı</th><th>İşletme / hedef</th><th>Ayrıntı</th></tr></thead><tbody>${body || '<tr><td colspan="6">Bu süzgeçlere uygun kayıt yok.</td></tr>'}</tbody></table>
</body></html>`;
}

export function reportXlsx(rows: JournalRow[], info: ReportInfo, now: Date) {
  const v = info.verify, seal = info.seal;
  const list: XlsxCell[][] = [['No', 'Zaman (Türkiye)', 'Kim', 'Nereden', 'İşlem türü', 'İşlem kodu', 'Ne yapıldı', 'İşletme', 'Hedef', 'Ayrıntı', 'Sonuç', 'Kayıt özeti (SHA-256)'],
    ...rows.map(r => [rowNo(r), istanbulTime(r.at), actorText(r), SOURCE_NAMES[r.source], GROUP_NAMES[r.group as JournalGroup] ?? r.group, r.action, r.text, r.business?.name ?? '', r.target?.name ?? '', detailText(r), RESULT_NAMES[r.result], r.hash ?? ''] as XlsxCell[])];
  const about: XlsxCell[][] = [['Bilgi', 'Değer'], ['Dönem', periodText(info.filter)], ['Süzgeçler', info.filterText.join(' · ') || 'Yok'], ['Rapordaki kayıt', rows.length],
    ['Zincir denetimi', v.ok ? `Kayıtlar bütün (${v.count} kayıt)` : v.text], ['Mühür', seal ? `#${seal.seq} · ${istanbulTime(seal.at)} · ${sealFingerprint(seal)}` : 'Yok'], ['Mola Merkez anahtarı', showFingerprint(info.keyId)], ['Rapor zamanı', istanbulTime(info.generatedAt)]];
  return xlsx([{ name: 'İşlem kayıtları', widths: [8, 20, 26, 16, 24, 26, 44, 24, 24, 60, 12, 66], rows: list }, { name: 'Rapor bilgisi', widths: [24, 80], rows: about, note: 'Denetlenebilir kopya: Mola Yönetim → İşlem kayıtları → Rapor al → JSONL. Yöntem: docs/ISLEM_KAYITLARI.md.' }], { title: 'Mola · İşlem kayıtları', now });
}
