import { deflateRawSync } from 'node:zlib';

/*
 * A small Excel (.xlsx) writer without packages: an XLSX file is a zip of a few XML files (Office Open XML, SpreadsheetML).
 * Only what "Muhasebeci için indir" needs: several sheets, a bold header row that stays on top, column widths, text, whole
 * numbers, TL amounts (real numbers with a "₺" format, so the accountant can add them up), dates (real Excel dates shown
 * "05.10.2026") and rates ("%10"). Strings are written inline (no shared string table); every value is XML-escaped.
 * Used by server/report-export.ts; tests read the file back (tests/report-export.test.ts).
 */
export type XlsxCell =
  | string | number | null | undefined
  | { money: number; bold?: boolean }   // kuruş → TL with two decimals
  | { date: string }                    // YYYY-MM-DD
  | { rate: number }                    // whole percent → "%10"
  | { text: string; bold?: boolean };
export type XlsxSheet = { name: string; widths?: number[]; rows: XlsxCell[][]; note?: string };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  // Characters XML 1.0 does not allow (control characters other than tab and line breaks) are dropped.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
export const columnName = (i: number) => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
/** Excel's day number (1900 date system, as every Excel uses): 2026-10-05 → 46300. */
export const excelDay = (day: string) => Math.round((Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) - Date.UTC(1899, 11, 30)) / 86_400_000);
/** Sheet names: at most 31 characters, none of : \ / ? * [ ], never repeated. */
function sheetNames(sheets: XlsxSheet[]) {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    let name = (s.name.replace(/[:\\/?*[\]]/g, ' ').trim() || `Sayfa ${i + 1}`).slice(0, 31);
    for (let k = 2; used.has(name.toLocaleLowerCase('tr')); k++) name = `${name.slice(0, 27)} (${k})`;
    used.add(name.toLocaleLowerCase('tr')); return name;
  });
}
// Styles (cellXfs): 0 plain, 1 header, 2 TL, 3 date, 4 whole number, 5 rate, 6 bold text, 7 bold TL, 8 wrapped note.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;₺&quot;"/><numFmt numFmtId="165" formatCode="dd\\.mm\\.yyyy"/><numFmt numFmtId="166" formatCode="&quot;%&quot;0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3EDE6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF9DB3A6"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function cellXml(ref: string, c: XlsxCell, header: boolean): string {
  if (c === null || c === undefined || c === '') return '';
  const text = (s: string, style: number) => `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(s)}</t></is></c>`;
  if (typeof c === 'string') return text(c, header ? 1 : 0);
  if (typeof c === 'number') return Number.isFinite(c) ? `<c r="${ref}" s="${header ? 1 : 4}"><v>${c}</v></c>` : '';
  if ('money' in c) return `<c r="${ref}" s="${c.bold ? 7 : 2}"><v>${Math.round(c.money) / 100}</v></c>`;
  if ('date' in c) return /^\d{4}-\d{2}-\d{2}$/.test(c.date) ? `<c r="${ref}" s="3"><v>${excelDay(c.date)}</v></c>` : text(c.date, 0);
  if ('rate' in c) return `<c r="${ref}" s="5"><v>${c.rate}</v></c>`;
  return text(c.text, c.bold ? 6 : 0);
}
function sheetXml(s: XlsxSheet) {
  const rows = s.rows.map((row, r) => `<row r="${r + 1}">${row.map((c, i) => cellXml(`${columnName(i)}${r + 1}`, c, r === 0)).join('')}</row>`);
  if (s.note) rows.push(`<row r="${s.rows.length + 2}">${cellXml(`A${s.rows.length + 2}`, { text: s.note }, false)}</row>`);
  const widths = s.widths?.length ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${widths}<sheetData>${rows.join('')}</sheetData></worksheet>`;
}

/** The workbook as .xlsx bytes. `title`: the file's document title (Excel → Bilgi). */
export function xlsx(sheets: XlsxSheet[], o: { title?: string; now?: Date } = {}): Buffer {
  if (!sheets.length) throw new Error('XLSX_EMPTY');
  const names = sheetNames(sheets), when = (o.now ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  const files: [string, string][] = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(o.title ?? 'Mola raporu')}</dc:title><dc:creator>Mola</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created></cp:coreProperties>`],
    ['docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Mola</Application></Properties>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)] as [string, string]),
  ];
  return zip(files.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })), o.now ?? new Date());
}

// ---------- Zip (PKWARE APPNOTE: local headers, deflated data, central directory) ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(data: Uint8Array) { let c = 0xffffffff; for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
/** A zip of `files` (names ASCII or UTF-8), each deflated. */
export function zip(files: { name: string; data: Buffer }[], now = new Date()) {
  const time = (now.getUTCHours() << 11) | (now.getUTCMinutes() << 5) | (now.getUTCSeconds() >> 1);
  const date = ((Math.max(1980, now.getUTCFullYear()) - 1980) << 9) | ((now.getUTCMonth() + 1) << 5) | now.getUTCDate();
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), packed = deflateRawSync(f.data, { level: 9 }), crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed); centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, dir, end]);
}
