// npm run pdf:test-listesi: the owner's printable real-device test list.
//   docs/GERCEK_CIHAZ_TESTI.md (the only content) + docs/pdf/kaynak-test/test.html and test.css (the A4 layout)
//   -> docs/pdf/Mola-Gercek-Cihaz-Testi.pdf
// The Markdown is turned into HTML here (a small converter for what that file uses: ## sections, ### parts, *Süre* lines,
// pipe tables, > boxes, lists, **bold**, *italic*, `code`, ☐ boxes), put into the template, then printed with Playwright's
// Chromium (page.pdf). Step tables (# · Ne yapın · Ne olmalı · ☐ · Not) get fixed column widths and an empty "Not" column to
// write in. The table of contents gets real page numbers the same way as scripts/pdf-belgeler.mjs: Chromium writes every
// internal link target into the PDF's /Dests, the page of each is read back and printed again until the numbers settle.
// Checks: no em dash, nothing wider than the page, Segoe UI embedded (Turkish letters).
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
// --kaynak=<md> --cikti=<pdf> --kisa: the same layout for a short sheet (no cover, no table of contents; the title and the
// first paragraph on top of page 1, a little tighter): npm run pdf:hafta-sonu (docs/HAFTA_SONU_SENARYOSU.md).
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SHORT = process.argv.includes('--kisa');
const SOURCE = arg('kaynak') ?? 'docs/GERCEK_CIHAZ_TESTI.md', TEMPLATE = 'docs/pdf/kaynak-test/test.html', OUT = arg('cikti') ?? 'docs/pdf/Mola-Gercek-Cihaz-Testi.pdf';
const EM_DASH = '—';
/** Sections that start on a new page (the long tail: reporting, after the VDS, summary). */
const NEW_PAGE = new Set(['30', '31', '32']);

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** **bold**, *italic*, `code` and ☐; code first so nothing inside it is touched. */
function inline(text) {
  const codes = [];
  let t = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/☐/g, '<span class="kutucuk" aria-label="işaret kutusu"></span>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

function table(lines) {
  const head = cells(lines[0]), rows = lines.slice(2).map(cells);
  const step = head[0] === '#' && head.includes('☐') && head.at(-1) === 'Not';
  const summary = head[0] === 'Bölüm' && head.includes('Hata sayısı');
  const form = head.length === 2 && head[0] === 'Alan';
  const cls = step ? 'adim' : summary ? 'ozet' : form ? 'form' : 'duz';
  // Step tables: fixed widths (mm) for # · Ne yapın · Ne olmalı · ☐ · Not on the 182 mm A4 line.
  const cols = step ? '<colgroup><col style="width:12mm"><col style="width:62mm"><col style="width:56mm"><col style="width:9mm"><col></colgroup>'
    : summary ? '<colgroup><col style="width:58mm"><col style="width:20mm"><col style="width:26mm"><col></colgroup>'
    : head.at(-1) === '☐' ? `<colgroup>${head.slice(0, -1).map(() => '<col>').join('')}<col style="width:9mm"></colgroup>` : '';
  const cellClass = (h, i) => [h === '☐' ? 'kutu-sutun' : '', step && i === 0 ? 'no' : '', h === 'Not' ? 'not' : ''].filter(Boolean).join(' ');
  const th = head.map((h, i) => `<th${cellClass(h, i) ? ` class="${cellClass(h, i)}"` : ''}>${inline(h)}</th>`).join('');
  const body = rows.map(r => `<tr>${head.map((h, i) => `<td${cellClass(h, i) ? ` class="${cellClass(h, i)}"` : ''}>${inline(r[i] ?? '')}</td>`).join('')}</tr>`).join('\n');
  return `<table class="${cls}">${cols}<thead><tr>${th}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

/** Markdown blocks to HTML. `top`: ## and ### become the chapter (h1, in the table of contents) and part (h2) headings. */
function blocks(lines, top = true) {
  const out = []; let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if (top && (m = /^## (?:(\d+)\. )?(.+)$/.exec(line))) {
      const no = m[1], id = no ? `b-${no}` : `b-${out.length}`;
      out.push(`<h1 id="${id}"${no && NEW_PAGE.has(no) ? ' class="yeni-sayfa"' : ''}>${no ? `<span class="no">${no}</span>` : ''}${inline(m[2])}</h1>`);
      i++; continue;
    }
    if (top && (m = /^### (.+)$/.exec(line))) { out.push(`<h2>${inline(m[1])}</h2>`); i++; continue; }
    if (/^\*[^*].*\*$/.test(line.trim())) { out.push(`<p class="sure">${inline(line.trim())}</p>`); i++; continue; }
    if (line.startsWith('|')) {
      const t = []; while (i < lines.length && lines[i].startsWith('|')) t.push(lines[i++]);
      out.push(table(t)); continue;
    }
    if (line.startsWith('>')) {
      const q = []; while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^> ?/, ''));
      const label = /^\*\*([^*:]+):?\*\*/.exec(q.find(x => x.trim()) ?? '')?.[1]?.replace(/:$/, '') ?? '';
      const kind = { Dikkat: 'uyari', 'Önemli': 'onemli', Bilgi: 'bilgi', 'İpucu': 'ipucu' }[label] ?? '';
      out.push(`<div class="kutu ${kind}">${blocks(q, false)}</div>`); continue;
    }
    if (/^- /.test(line)) {
      const items = []; while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      out.push(`<ul>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`); continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = []; while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ''));
      out.push(`<ol>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ol>`); continue;
    }
    const para = []; while (i < lines.length && lines[i].trim() && !/^(\||>|- |\d+\. |#)/.test(lines[i])) para.push(lines[i++].trim());
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); else i++;
  }
  return out.join('\n');
}

/** The Markdown file: its # title and first paragraph go on the cover; everything from the first ## is the body. */
function convert(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const title = lines.find(l => l.startsWith('# '))?.slice(2).trim() ?? 'Gerçek Cihaz Testi';
  const start = lines.findIndex(l => l.startsWith('## '));
  const lead = lines.slice(lines.findIndex(l => l.startsWith('# ')) + 1, start).join('\n').split(/\n\s*\n/).map(s => s.trim()).find(s => s && !s.startsWith('>')) ?? '';
  return { title, lead: inline(lead.replace(/\n/g, ' ')), body: blocks(lines.slice(start)) };
}

/** Which page every named destination (heading id) is on: /Dests in the catalog + the page tree in order. */
function destPages(pdf) {
  const s = pdf.toString('latin1');
  const objects = new Map();
  for (const m of s.matchAll(/(?:^|[\r\n])(\d+) 0 obj\b/g)) objects.set(Number(m[1]), m.index);
  const body = n => { const at = objects.get(n); if (at === undefined) return ''; return s.slice(at, s.indexOf('endobj', at)); };
  const catalog = [...objects.keys()].map(body).find(b => /\/Type\s*\/Catalog/.test(b));
  if (!catalog) throw new Error('PDF kataloğu bulunamadı');
  const order = [];
  const walk = n => {
    const b = body(n);
    if (/\/Type\s*\/Pages\b/.test(b)) { const kids = /\/Kids\s*\[([^\]]*)\]/.exec(b)?.[1] ?? ''; for (const k of kids.matchAll(/(\d+) 0 R/g)) walk(Number(k[1])); }
    else order.push(n);
  };
  walk(Number(/\/Pages\s+(\d+) 0 R/.exec(catalog)[1]));
  const index = new Map(order.map((n, i) => [n, i + 1]));
  const dests = new Map();
  const ref = /\/Dests\s+(\d+) 0 R/.exec(catalog);
  const dict = ref ? body(Number(ref[1])) : (/\/Dests\s*<<([\s\S]*?)>>/.exec(catalog)?.[1] ?? '');
  for (const m of dict.matchAll(/\/([^\s/\[\]()<>]+)\s*\[\s*(\d+) 0 R/g)) dests.set(m[1].replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), index.get(Number(m[2])));
  const fonts = [...new Set([...s.matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([^\s/>\]]+)/g)].map(m => m[1]))];
  return { pages: order.length, dests, fonts };
}

const { title, lead, body } = convert(readFileSync(join(ROOT, SOURCE), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const problems = [];
try {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  await page.goto(pathToFileURL(join(ROOT, TEMPLATE)).href, { waitUntil: 'load' });
  await page.evaluate(({ title, lead, body }) => {
    document.querySelector('#kapak-baslik').textContent = title.replace(/^Mola\s+/, '');
    document.querySelector('#kapak-giris').innerHTML = lead;
    document.querySelector('#icerik').innerHTML = body;
    document.querySelector('#icindekiler-liste').innerHTML = [...document.querySelectorAll('#icerik h1[id]')].map(h => {
      const no = h.querySelector('.no')?.textContent ?? '', text = [...h.childNodes].filter(n => !(n.classList?.contains('no'))).map(n => n.textContent).join('').trim();
      return `<li><a href="#${h.id}"><span class="toc-no">${no}</span><span class="toc-ad">${text}</span><span class="toc-nokta"></span><span class="toc-sayfa" data-for="${h.id}">00</span></a></li>`;
    }).join('');
  }, { title, lead, body });
  if (SHORT) await page.evaluate(({ title, lead }) => {
    document.querySelector('.kapak')?.remove(); document.querySelector('.icindekiler')?.remove();
    document.title = title;
    const head = document.createElement('header'); head.className = 'kisa-baslik';
    head.innerHTML = `<div class="kisa-marka">Mola</div><h1 data-toc="no"></h1><p></p>`;
    head.querySelector('h1').textContent = title; head.querySelector('p').innerHTML = lead;
    document.querySelector('#icerik').prepend(head);
    const style = document.createElement('style');
    style.textContent = '.kisa-baslik{margin:0 0 6pt;padding-bottom:5pt;border-bottom:2px solid var(--yesil)}.kisa-marka{font-weight:700;color:var(--yesil);font-size:9pt;letter-spacing:.5pt}.kisa-baslik h1{font-size:18pt;margin:2pt 0 3pt;border:0;padding:0}.kisa-baslik p{margin:0;font-size:9.5pt;color:var(--gri)}main{font-size:8.6pt;line-height:1.32}main h1{font-size:11.5pt;margin:7pt 0 3pt}main table{font-size:8.2pt}main td,main th{padding:2pt 4pt}main li{margin:0 0 1pt}main p{margin:0 0 3pt}main ul,main ol{margin:0 0 3pt}';
    document.head.append(style);
  }, { title, lead });
  await page.evaluate(() => document.fonts.ready);
  const text = await page.evaluate(() => document.body.innerText);
  for (let i = text.indexOf(EM_DASH); i >= 0; i = text.indexOf(EM_DASH, i + 1)) problems.push(`Uzun tire: "…${text.slice(Math.max(0, i - 40), i + 20).replace(/\s+/g, ' ')}…"`);
  await page.emulateMedia({ media: 'print' });
  const wide = await page.evaluate(() => {
    const main = document.querySelector('main').getBoundingClientRect(), found = [];
    for (const el of document.querySelectorAll('main table, main .kutu, main pre')) {
      const r = el.getBoundingClientRect();
      if (r.right - main.left > main.width + 1) found.push(`${el.tagName.toLowerCase()} (${Math.round(r.width)} > ${Math.round(main.width)} px) "${(el.textContent || '').trim().slice(0, 50)}"`);
    }
    return found;
  });
  problems.push(...wide.map(x => `Sayfadan geniş: ${x}`));

  let pdf, info, last = '';
  for (let round = 1; round <= 5; round++) {
    pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
    info = destPages(pdf);
    const ids = await page.$$eval('.toc-sayfa', els => els.map(e => e.dataset.for));
    const missing = ids.filter(id => !info.dests.has(id));
    if (missing.length) throw new Error(`İçindekilerdeki başlıklar PDF'te bulunamadı: ${missing.join(', ')}`);
    const now = JSON.stringify(ids.map(id => info.dests.get(id)));
    if (now === last) break;
    last = now;
    await page.$$eval('.toc-sayfa', (els, map) => { for (const e of els) e.textContent = String(map[e.dataset.for]); }, Object.fromEntries(info.dests));
    if (round === 5) problems.push('İçindekiler sayfa numaraları 5 turda sabitlenmedi');
  }
  writeFileSync(join(ROOT, OUT), pdf);
  console.log(`${OUT}: ${info.pages} sayfa, ${(statSync(join(ROOT, OUT)).size / 1048576).toFixed(2)} MB; yazı tipleri: ${info.fonts.join(', ')}`);
  if (!info.fonts.some(f => /SegoeUI/i.test(f))) problems.push('Segoe UI gömülmedi: Türkçe harfler için yazı tipini kontrol edin');
} finally { await browser.close(); }
for (const p of problems) console.warn(`  ! ${p}`);
process.exitCode = problems.length ? 1 : 0;
