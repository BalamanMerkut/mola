// npm run pdf:belgeler: builds the two briefing PDFs from HTML sources with Playwright's Chromium (page.pdf).
//   docs/pdf/kaynak-hukuk/belge.html  -> docs/pdf/Mola-Hukuki-Bilgi-Dosyasi.pdf  (for the owner's lawyer)
//   docs/pdf/kaynak-teknik/belge.html -> docs/pdf/Mola-Teknik-Anlatim.pdf         (for the owner's teachers)
//   docs/pdf/kaynak-paketler/belge.html -> docs/pdf/Mola-Paketler.pdf       (packages and their services, no prices)
//   docs/pdf/kaynak-fiyat/belge.html -> docs/pdf/Mola-Fiyat-ve-Rakipler.pdf  (internal: competitors and price proposal; from docs/FIYAT_VE_RAKIPLER_2026-10.md)
//   docs/pdf/kaynak-fiyat-listesi/belge.html -> docs/pdf/Mola-Fiyat-Listesi.pdf  (for customers: our packages and prices only)
// Optional: `npm run pdf:belgeler -- hukuk`, `-- teknik` or `-- paketler` builds one.
//
// How it works: the page is opened from disk (relative images resolve), appendices are filled from their single sources
// (docs/hukuk/MOLA_LISANS_SOZLESMESI.md, site/src/pages/{kvkk,gizlilik,cerez}.html + site/config.json), the table of
// contents is built from h1/h2[id], then the PDF is printed. Chromium writes every internal link target into the PDF's
// /Dests dictionary (name -> page object), so the script reads which page each heading landed on, writes the numbers into
// the table of contents and prints again until the numbers stop changing. Running footers and page numbers are CSS
// @page margin boxes (counter(page) / counter(pages)). Checks: no em dash in the text, every image loaded, nothing wider
// than the page, embedded fonts listed (Segoe UI expected: it has the Turkish letters).
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const DOCS = {
  hukuk: { src: 'docs/pdf/kaynak-hukuk/belge.html', out: 'docs/pdf/Mola-Hukuki-Bilgi-Dosyasi.pdf' },
  teknik: { src: 'docs/pdf/kaynak-teknik/belge.html', out: 'docs/pdf/Mola-Teknik-Anlatim.pdf' },
  paketler: { src: 'docs/pdf/kaynak-paketler/belge.html', out: 'docs/pdf/Mola-Paketler.pdf' },
  fiyat: { src: 'docs/pdf/kaynak-fiyat/belge.html', out: 'docs/pdf/Mola-Fiyat-ve-Rakipler.pdf' },
  'fiyat-listesi': { src: 'docs/pdf/kaynak-fiyat-listesi/belge.html', out: 'docs/pdf/Mola-Fiyat-Listesi.pdf' },
};
const wanted = process.argv.slice(2).filter(a => DOCS[a]);
const EM_DASH = '—';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Tiny Markdown (headings, numbered and bulleted lists, bold, paragraphs): enough for the licence draft. */
function markdown(md) {
  const out = []; let list = null; let para = [];
  const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const flush = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const close = () => { if (list) out.push(`</${list}>`); list = null; };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(new RegExp(` ?${EM_DASH} ?`, 'g'), ': ');
    let m;
    if (!line.trim()) { flush(); close(); continue; }
    if ((m = /^(#{1,3}) (.*)$/.exec(line))) { flush(); close(); const level = m[1].length + 2; out.push(`<h${level} class="ek-baslik">${inline(m[2])}</h${level}>`); continue; }
    if ((m = /^\d+\. (.*)$/.exec(line))) { flush(); if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^- (.*)$/.exec(line))) { flush(); if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    close(); para.push(line.trim());
  }
  flush(); close();
  return out.join('\n');
}
/** A legal page of the website as the site build would print it (placeholders from site/config.json). */
function sitePage(name) {
  const html = readFileSync(join(ROOT, 'site/src/pages', `${name}.html`), 'utf8');
  const config = JSON.parse(readFileSync(join(ROOT, 'site/config.json'), 'utf8'));
  const consent = /SITE_CONSENT_VERSION = '([^']+)'/.exec(readFileSync(join(ROOT, 'packages/domain/site-lead.ts'), 'utf8'))[1];
  const [y, mo, d] = config.legalUpdated.split('-').map(Number);
  const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const fill = s => s.replace(/\{\{(\w+)\}\}/g, (_, k) => ({
    company: esc(config.company), address: esc(config.address), emailLink: esc(config.email),
    legalUpdated: `${d} ${months[mo - 1]} ${y}`, consentVersion: consent,
    draftBanner: config.legalDraft ? '<p class="taslak-serit">TASLAK: avukat tarafından kontrol edilecektir. Bu metin henüz son hâlini almadı.</p>' : '',
  })[k] ?? `[${k}]`);
  const title = /<h1>(.*?)<\/h1>/s.exec(html)[1];
  const updated = /<p class="updated">(.*?)<\/p>/s.exec(html)?.[1] ?? '';
  const start = html.indexOf('<div class="wrap legal">');
  const body = html.slice(start + '<div class="wrap legal">'.length, html.lastIndexOf('</div>'));
  return fill(`<h3 class="ek-baslik">${title}</h3><p class="kucuk gri">${updated}</p>${body}`).replace(new RegExp(EM_DASH, 'g'), ':');
}
function appendix(key) {
  if (key === 'lisans') return markdown(readFileSync(join(ROOT, 'docs/hukuk/MOLA_LISANS_SOZLESMESI.md'), 'utf8'));
  if (key.startsWith('site:')) return sitePage(key.slice(5));
  throw new Error(`Bilinmeyen ek: ${key}`);
}

/** Which page every named destination (heading id) is on: /Dests in the catalog + the page tree in order. */
function destPages(pdf) {
  const s = pdf.toString('latin1');
  const objects = new Map();
  for (const m of s.matchAll(/(?:^|[\r\n])(\d+) 0 obj\b/g)) objects.set(Number(m[1]), m.index);
  const body = n => { const at = objects.get(n); if (at === undefined) return ''; const end = s.indexOf('endobj', at); return s.slice(at, end); };
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
  for (const m of dict.matchAll(/\/([^\s/\[\]()<>]+)\s*\[\s*(\d+) 0 R/g)) dests.set(decodeName(m[1]), index.get(Number(m[2])));
  const fonts = [...new Set([...s.matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([^\s/>\]]+)/g)].map(m => m[1]))];
  return { pages: order.length, dests, fonts };
}
const decodeName = n => n.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

async function build(page, key) {
  const { src, out } = DOCS[key];
  await page.goto(pathToFileURL(join(ROOT, src)).href, { waitUntil: 'load' });
  // Appendices from their single sources.
  const keys = await page.$$eval('[data-ek]', els => els.map(e => e.getAttribute('data-ek')));
  for (const k of keys) await page.$eval(`[data-ek="${k}"]`, (el, html) => { el.innerHTML = html; }, appendix(k));
  // Table of contents from the headings (h1 = chapter, h2 = section; data-toc="no" leaves one out).
  await page.evaluate(() => {
    const nav = document.querySelector('#icindekiler-liste'); if (!nav) return;
    const items = [...document.querySelectorAll('main h1[id], main h2[id]')].filter(h => h.dataset.toc !== 'no');
    nav.innerHTML = items.map(h => {
      const copy = h.cloneNode(true); const no = copy.querySelector('.no'); no?.remove();
      const text = h.dataset.tocText || `${no ? no.textContent.trim() + ' ' : ''}${copy.textContent.replace(/\s+/g, ' ').trim()}`;
      return `<li class="toc-${h.tagName.toLowerCase()}"><a href="#${h.id}"><span class="toc-ad">${text}</span><span class="toc-nokta"></span><span class="toc-sayfa" data-for="${h.id}">00</span></a></li>`;
    }).join('');
  });
  await page.evaluate(() => document.fonts.ready);
  const problems = await page.evaluate(([dash]) => {
    const p = [];
    const text = document.body.innerText;
    let i = text.indexOf(dash);
    while (i >= 0) { p.push(`Uzun tire: "…${text.slice(Math.max(0, i - 40), i + 20).replace(/\s+/g, ' ')}…"`); i = text.indexOf(dash, i + 1); }
    for (const img of document.images) if (!img.complete || !img.naturalWidth) p.push(`Resim yüklenmedi: ${img.getAttribute('src')}`);
    for (const id of new Set([...document.querySelectorAll('[id]')].map(e => e.id))) if (document.querySelectorAll(`[id="${id}"]`).length > 1) p.push(`Aynı kimlik iki kez: ${id}`);
    for (const a of document.querySelectorAll('a[href^="#"]')) if (!document.getElementById(a.getAttribute('href').slice(1))) p.push(`Boş bağlantı: ${a.getAttribute('href')}`);
    return p;
  }, [EM_DASH]);
  // Width check in print layout: the page's content box is A4 minus the side margins (set in CSS as --icerik-genislik).
  await page.emulateMedia({ media: 'print' });
  const wide = await page.evaluate(() => {
    const w = document.querySelector('main')?.getBoundingClientRect().width ?? 0;
    const left = document.querySelector('main')?.getBoundingClientRect().left ?? 0;
    const found = [];
    for (const el of document.querySelectorAll('main table, main pre, main svg, main img, main .kutu, main figure')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right - left > w + 1 || el.scrollWidth > el.clientWidth + 1 && el.tagName !== 'svg')) found.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} (${Math.round(r.width)} > ${Math.round(w)} px) "${(el.textContent || '').trim().slice(0, 50)}"`);
    }
    return found;
  });
  await page.setViewportSize({ width: 794, height: 1123 });
  problems.push(...wide.map(x => `Sayfadan geniş: ${x}`));

  let pdf, info, last = '';
  for (let round = 1; round <= 5; round++) {
    pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
    info = destPages(pdf);
    const numbers = await page.$$eval('.toc-sayfa', els => els.map(e => e.dataset.for));
    const missing = numbers.filter(id => !info.dests.has(id));
    if (missing.length) throw new Error(`${key}: içindekilerdeki başlıklar PDF'te bulunamadı: ${missing.join(', ')}`);
    const now = JSON.stringify(numbers.map(id => info.dests.get(id)));
    if (now === last) break;
    last = now;
    await page.$$eval('.toc-sayfa', (els, map) => { for (const e of els) e.textContent = String(map[e.dataset.for]); }, Object.fromEntries(info.dests));
    if (round === 5) problems.push('İçindekiler sayfa numaraları 5 turda sabitlenmedi');
  }
  writeFileSync(join(ROOT, out), pdf);
  const size = statSync(join(ROOT, out)).size;
  console.log(`${out}: ${info.pages} sayfa, ${(size / 1048576).toFixed(2)} MB; yazı tipleri: ${info.fonts.join(', ')}`);
  if (!info.fonts.some(f => /SegoeUI/i.test(f))) problems.push('Segoe UI gömülmedi: Türkçe harfler için yazı tipini kontrol edin');
  return problems;
}

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  for (const key of wanted.length ? wanted : Object.keys(DOCS)) {
    const problems = await build(page, key);
    for (const p of problems) console.warn(`  ! ${key}: ${p}`);
    if (problems.length) failed = true;
  }
} finally { await browser.close(); }
process.exitCode = failed ? 1 : 0;
