/*
 * Kılavuz şablonu: içerik blokları (HTML parçaları), A4 sayfalara bölme (tarayıcıda), içindekiler, sayfa altı ve
 * ekran görüntülerinin üstüne SVG ok ve numaralar. PDF'i kilavuz.ts basar.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultPackages, featureById, type FeatureId } from '../../../../packages/domain/features.ts';
import { EKRAN } from './yollar.ts';
import type { Kayit } from './cekim.ts';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------ görüntüler
/** Kullanılan görüntüler: ad → en geniş gösterim (px); kilavuz.ts bunları JPEG'e çevirir. */
export const kullanilan = new Map<string, number>();
let isaretler: Record<string, Kayit> | undefined;
/** Görüntüsü olmayan şekil PDF'e girmez, yalnız uyarı yazılır (çekim düştüyse ve eski görüntü de yoksa). */
export function varMi(ad: string) {
  isaretler ??= JSON.parse(readFileSync(join(EKRAN, 'isaretler.json'), 'utf8'));
  const ok = !!isaretler![ad] && existsSync(join(EKRAN, `${ad}.png`));
  if (!ok) uyarilar.push(`${ad}: görüntü yok, şekil atlandı`);
  return ok;
}
function kayit(ad: string): Kayit {
  isaretler ??= JSON.parse(readFileSync(join(EKRAN, 'isaretler.json'), 'utf8'));
  const k = isaretler![ad];
  if (!k) throw new Error(`Ekran görüntüsü yok: ${ad} (önce ekranlar.ts ile çekin)`);
  if (!existsSync(join(EKRAN, `${ad}.png`))) throw new Error(`Dosya yok: ekran/${ad}.png`);
  return k;
}

/** Telefon ekranı mı (telefon çerçevesiyle gösterilir)? Telefon görüntüleri tam ekrandır: 390 × 844 px. */
const telefonMu = (ad: string) => { const k = kayit(ad); return k.w <= 400 && k.h >= 700; };
const R = 10.5; // numara dairesinin yarıçapı (px)
const KIRMIZI = '#d7261e';
type Nokta = { x: number; y: number };
/** Görüntünün üstüne çizilen SVG: kırmızı çerçeve, ok ve numaralı daire. Koordinatlar gösterilen boyutta (px). */
function katman(k: Kayit, W: number, H: number, sadece?: number[]) {
  const s = W / k.w;
  const parts: string[] = [];
  const rozetler: Nokta[] = [];
  const pad = 3;
  const secili = k.isaretler.filter(m => !sadece || sadece.includes(m.n));
  const kutular = secili.map(m => ({ x: m.x * s - pad, y: m.y * s - pad, w: m.w * s + 2 * pad, h: m.h * s + 2 * pad }));
  const clamp = (q: Nokta) => ({ x: Math.min(W - R - 2, Math.max(R + 2, q.x)), y: Math.min(H - R - 2, Math.max(R + 2, q.y)) });
  const yonler = ['sol', 'sag', 'ust', 'alt'] as const;
  for (const [i, m] of secili.entries()) {
    const b = kutular[i];
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, D = 30;
    const tercih = m.yon ?? (cx > W / 2 ? 'sol' : 'sag');
    const aday = (yon: string): Nokta => {
      const dx = yon.includes('sol') ? -1 : yon.includes('sag') ? 1 : 0, dy = yon.includes('ust') ? -1 : yon.includes('alt') ? 1 : 0;
      const q: Nokta = { x: dx < 0 ? b.x - D : dx > 0 ? b.x + b.w + D : cx, y: dy < 0 ? b.y - D : dy > 0 ? b.y + b.h + D : cy };
      if (dx === 0 && b.w > 120) q.x = b.x + Math.min(40, b.w / 4); // geniş öğede ok kenara yakın iner
      if (dy === 0 && b.h > 120) q.y = b.y + Math.min(30, b.h / 4);
      return q;
    };
    // Sırayla: tercih edilen yön, sonra diğerleri. Daire görüntünün içinde, başka bir işaretin kutusunun ya da dairesinin
    // üstünde olmamalı; hiçbiri uymazsa tercih edilen yön (kenara yaslanmış).
    const icinde = (q: Nokta) => q.x >= R + 2 && q.x <= W - R - 2 && q.y >= R + 2 && q.y <= H - R - 2;
    const cakisir = (q: Nokta) => rozetler.some(r => Math.hypot(r.x - q.x, r.y - q.y) < 2 * R + 4)
      || kutular.some((o, j) => j !== i && q.x + R > o.x && q.x - R < o.x + o.w && q.y + R > o.y && q.y - R < o.y + o.h);
    let p = [tercih, ...yonler.filter(y => y !== tercih)].map(aday).find(q => icinde(q) && !cakisir(q)) ?? clamp(aday(tercih));
    for (let t = 0; t < 6 && rozetler.some(r => Math.hypot(r.x - p.x, r.y - p.y) < 2 * R + 4); t++) p = clamp({ x: p.x + 2 * R + 6, y: p.y });
    rozetler.push(p);
    const inside = p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;
    if (!m.nokta) parts.push(`<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" rx="5" fill="none" stroke="${KIRMIZI}" stroke-width="2"/>`);
    if (!inside) {
      const t = { x: Math.min(b.x + b.w, Math.max(b.x, p.x)), y: Math.min(b.y + b.h, Math.max(b.y, p.y)) };
      const len = Math.hypot(t.x - p.x, t.y - p.y);
      if (len > R + 7) {
        const ux = (t.x - p.x) / len, uy = (t.y - p.y) / len;
        const a = { x: p.x + ux * R, y: p.y + uy * R }, e = { x: t.x - ux * 1.5, y: t.y - uy * 1.5 };
        const h1 = { x: e.x - ux * 8 - uy * 4.5, y: e.y - uy * 8 + ux * 4.5 }, h2 = { x: e.x - ux * 8 + uy * 4.5, y: e.y - uy * 8 - ux * 4.5 };
        parts.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${(e.x - ux * 6).toFixed(1)}" y2="${(e.y - uy * 6).toFixed(1)}" stroke="${KIRMIZI}" stroke-width="2.4" stroke-linecap="round"/>`,
          `<path d="M${e.x.toFixed(1)} ${e.y.toFixed(1)} L${h1.x.toFixed(1)} ${h1.y.toFixed(1)} L${h2.x.toFixed(1)} ${h2.y.toFixed(1)} Z" fill="${KIRMIZI}"/>`);
      }
    }
    parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${R}" fill="${KIRMIZI}" stroke="#fff" stroke-width="2"/>`,
      `<text x="${p.x.toFixed(1)}" y="${(p.y + 4.3).toFixed(1)}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#fff" font-family="Segoe UI, Arial, sans-serif">${m.n}</text>`);
  }
  return `<svg class="katman" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`;
}
/** Bir ekran görüntüsü (gösterim genişliği px), üstünde işaretleri. */
export function goruntu(ad: string, W: number, o: { sadece?: number[]; cerceve?: 'telefon' | 'yok'; maxH?: number } = {}) {
  const k = kayit(ad);
  let w = W, h = Math.round(W * k.h / k.w);
  if (o.maxH && h > o.maxH) { h = o.maxH; w = Math.round(h * k.w / k.h); }
  kullanilan.set(ad, Math.max(kullanilan.get(ad) ?? 0, w));
  return `<div class="goruntu ${o.cerceve === 'telefon' ? 'telefon' : ''}" style="width:${w}px;height:${h}px"><img src="img/${ad}.jpg" width="${w}" height="${h}" alt="">${katman(k, w, h, o.sadece)}</div>`;
}

// ------------------------------------------------------------ bloklar
let bolumNo = 0, kimlik = 0;
export function sifirla() { bolumNo = 0; kimlik = 0; kullanilan.clear(); uyarilar.length = 0; }
const blok = (html: string, cls = '', attrs = '') => `<div class="blok ${cls}" ${attrs}>${html}</div>`;

/** Yeni bölüm: yeni sayfada başlar, içindekilere girer. */
export function bolum(baslik: string, giris = '', o: { numarasiz?: boolean } = {}) {
  const no = o.numarasiz ? '' : String(++bolumNo);
  return blok(`<div class="bolum-ust"><span class="bolum-no">${no ? `Bölüm ${no}` : ''}</span><h1>${baslik}</h1>${giris ? `<p class="bolum-giris">${giris}</p>` : ''}</div>`,
    'bolum', `data-yeni-sayfa="1" data-toc="1" data-baslik="${esc(baslik)}" data-no="${no}" id="t${++kimlik}"`);
}
/** Alt başlık: içindekilere girer, sonraki blokla aynı sayfada kalır. */
export const h2 = (baslik: string) => blok(`<h2>${baslik}</h2>`, 'baslik', `data-toc="2" data-baslik="${esc(baslik)}" id="t${++kimlik}"`);
/** Küçük başlık (içindekilere girmez). */
export const h3 = (baslik: string) => blok(`<h3>${baslik}</h3>`, 'baslik');
export const p = (...paras: string[]) => paras.map(t => blok(`<p>${t}</p>`)).join('');
export const liste = (items: string[]) => blok(`<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`);
/** Numaralı adımlar. */
export const adimlar = (items: string[]) => blok(`<ol class="adimlar">${items.map((t, i) => `<li><span class="adim-no">${i + 1}</span><div>${t}</div></li>`).join('')}</ol>`);
export const not = (html: string, tur: 'ipucu' | 'dikkat' | 'bilgi' = 'ipucu') => {
  const ad = { ipucu: 'İpucu', dikkat: 'Dikkat', bilgi: 'Bilgi' }[tur];
  return blok(`<div class="not ${tur}"><strong>${ad}</strong><div>${html}</div></div>`);
};
export const tablo = (bas: string[], satirlar: string[][], cls = '') =>
  blok(`<table class="tablo ${cls}"><thead><tr>${bas.map(b => `<th>${b}</th>`).join('')}</tr></thead><tbody>${satirlar.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
export const sss = (soru: string, cevap: string) => blok(`<div class="sss"><p class="soru">${soru}</p><p class="cevap">${cevap}</p></div>`);

/** Açıklama sayısı ile görüntüdeki işaretler uyuşmuyorsa uyarır (eksik işaret = çekimde öğe bulunamadı). */
export const uyarilar: string[] = [];
function denetle(ad: string, aciklamalar?: string[], sadece?: number[]) {
  const k = kayit(ad), var_ = new Set(k.isaretler.map(m => m.n));
  for (let i = 1; i <= (aciklamalar?.length ?? 0); i++) if (!var_.has(i) && !(sadece && !sadece.includes(i))) uyarilar.push(`${ad}: ${i} numaralı açıklamanın işareti yok`);
  for (const n of var_) if (aciklamalar && n > aciklamalar.length) uyarilar.push(`${ad}: ${n} numaralı işaretin açıklaması yok`);
}
const numara = (n: number) => `<span class="isaret-no">${n}</span>`;
const aciklamaListesi = (items: string[]) => `<ol class="isaret-liste">${items.map((t, i) => `<li>${numara(i + 1)}<span>${t}</span></li>`).join('')}</ol>`;

export type SekilSecenek = {
  /** Görüntünün gösterim genişliği (px; sayfa gövdesi 665 px). */
  genislik?: number;
  /** Açıklamalar görüntünün yanında mı (telefon ekranları), altında mı. */
  yan?: boolean;
  baslik?: string;
  aciklamalar?: string[];
  telefon?: boolean;
  maxH?: number;
};
/** Bir ekran görüntüsü, kırmızı ok ve numaralar, yanında ya da altında numaralı kısa açıklamalar. */
export function sekil(ad: string, o: SekilSecenek = {}) {
  if (!varMi(ad)) return '';
  denetle(ad, o.aciklamalar);
  const tel = o.telefon ?? telefonMu(ad);
  const yan = o.yan ?? tel;
  const W = o.genislik ?? (tel ? 230 : 665);
  const img = goruntu(ad, W, { cerceve: tel ? 'telefon' : 'yok', maxH: o.maxH ?? (tel ? 520 : 760) });
  const list = o.aciklamalar?.length ? aciklamaListesi(o.aciklamalar) : '';
  const cap = o.baslik ? `<div class="sekil-baslik">${o.baslik}</div>` : '';
  return blok(`<figure class="sekil ${yan ? 'yan' : 'alt'}">${img}<div class="sekil-metin">${cap}${list}</div></figure>`, 'sekil-blok');
}
/** Çizgi roman şeridi: birkaç telefon karesi yan yana, her birinin altında kısa açıklama. */
export function serit(kareler: { ad: string; baslik: string; metin?: string; aciklamalar?: string[]; sadece?: number[] }[], o: { genislik?: number } = {}) {
  kareler = kareler.filter(k => varMi(k.ad));
  if (!kareler.length) return '';
  for (const k of kareler) denetle(k.ad, k.aciklamalar, k.sadece);
  const W = o.genislik ?? (kareler.length >= 3 ? 178 : 240);
  return blok(`<div class="serit serit-${kareler.length}">${kareler.map(k => `<div class="kare">${goruntu(k.ad, W, { cerceve: telefonMu(k.ad) ? 'telefon' : 'yok', sadece: k.sadece, maxH: 430 })}
    <div class="kare-metin"><div class="kare-baslik">${k.baslik}</div>${k.metin ? `<p>${k.metin}</p>` : ''}${k.aciklamalar ? aciklamaListesi(k.aciklamalar) : ''}</div></div>`).join('')}</div>`, 'serit-blok');
}

// ------------------------------------------------------------ hizmet rozeti
const PAKETLER = defaultPackages.map(p => ({ ad: p.name, has: new Set<FeatureId>(p.features) }));
/** Özelliğin hangi hizmete ait olduğu, hangi başlangıç paketlerinde olduğu ve işletmeye ne kazandırdığı. Fiyat yok. */
export function hizmet(ids: FeatureId | FeatureId[], kazanc: string) {
  const list = Array.isArray(ids) ? ids : [ids];
  const adlar = list.map(i => featureById.get(i)!.name).join(' + ');
  const soon = list.some(i => featureById.get(i)!.soon);
  const paketler = soon ? `<span class="paket yok">Yakında</span>`
    : PAKETLER.map(pk => { const var_ = list.every(i => pk.has.has(i)); return `<span class="paket ${var_ ? 'var' : 'yok'}">${var_ ? '✓' : '–'} ${pk.ad}</span>`; }).join('');
  const hicbiri = !soon && !PAKETLER.some(pk => list.every(i => pk.has.has(i)));
  return blok(`<div class="hizmet"><div class="hizmet-ust"><span class="hizmet-etiket">Hizmet</span><strong>${adlar}</strong></div>
    <div class="paketler">${paketler}${hicbiri ? '<span class="paket ek">Her pakete ek olarak eklenebilir</span>' : ''}</div>
    <p class="kazanc"><b>Size kazandırdığı:</b> ${kazanc}</p></div>`);
}

// ------------------------------------------------------------ sayfa
export type Belge = { dosya: string; baslik: string; altBaslik: string; kisa: string; kapakNotu: string; icerik: string; tocDerinlik: 1 | 2 };
export function belgeHtml(b: Belge, logoMerkut: string) {
  const css = readFileSync(join(import.meta.dirname, 'stil.css'), 'utf8');
  const kapak = `<section class="sayfa kapak"><div class="kapak-ust">
      <div class="mola-logo"><span class="logo-kare"><svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="#f3ebdd" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v2"/><path d="M14 2v2"/><path d="M6 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/></svg></span>
        <div><div class="logo-yazi">mola<span>.</span></div><div class="logo-alt">ADİSYON · QR MENÜ</div></div></div>
      <h1 class="kapak-baslik">${b.baslik}</h1><p class="kapak-alt">${b.altBaslik}</p></div>
    <div class="kapak-orta">${b.kapakNotu}</div>
    <div class="kapak-alt-bant"><img src="${logoMerkut}" alt="Merkut Studios" class="merkut"><div><strong>Merkut Studios</strong><br>Mola · Ekim 2026<br>molayazilim.com.tr</div></div></section>`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(b.baslik)}</title><style>${css}</style></head>
<body data-kisa="${esc(b.kisa)}" data-toc-derinlik="${b.tocDerinlik}">${kapak}<div id="kaynak">${b.icerik}</div><div id="sayfalar"></div><script>${SAYFALAYICI}</script></body></html>`;
}

/** Tarayıcıda çalışır: blokları A4 sayfalara dağıtır, içindekiler ve sayfa numaralarını yazar. */
const SAYFALAYICI = String.raw`
(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  const kaynak = document.getElementById('kaynak'), hedef = document.getElementById('sayfalar');
  const kisa = document.body.dataset.kisa, derinlik = Number(document.body.dataset.tocDerinlik);
  const yeniSayfa = (cls = '') => { const s = document.createElement('section'); s.className = 'sayfa icerik ' + cls;
    s.innerHTML = '<div class="ust-serit"><span class="ust-sol"></span><span class="ust-sag">' + kisa + '</span></div><div class="govde"></div><div class="alt-serit"><span>Mola · Merkut Studios</span><span class="sayfa-no"></span></div>';
    hedef.appendChild(s); return s.querySelector('.govde'); };
  // İçindekiler: önce kaç sayfa tutacağı bilinmeli; satırları koyup sayfalara dağıt.
  const girdiler = [...kaynak.querySelectorAll('[data-toc]')].filter(e => Number(e.dataset.toc) <= derinlik);
  let govde = yeniSayfa('toc');
  govde.insertAdjacentHTML('beforeend', '<h1 class="toc-baslik">İçindekiler</h1>');
  for (const e of girdiler) {
    const d = document.createElement('a'); d.className = 'toc-satir toc-' + e.dataset.toc; d.href = '#' + e.id;
    d.innerHTML = (e.dataset.no ? '<span class="toc-no">' + e.dataset.no + '</span>' : '<span class="toc-no"></span>') + '<span class="toc-ad">' + e.dataset.baslik + '</span><span class="toc-nokta"></span><span class="toc-sayfa" data-for="' + e.id + '">0</span>';
    govde.appendChild(d);
    if (govde.scrollHeight > govde.clientHeight + 1) { d.remove(); govde = yeniSayfa('toc'); govde.appendChild(d); }
  }
  // İçerik.
  const bloklar = [...kaynak.children];
  govde = null;
  const tasar = () => govde.scrollHeight > govde.clientHeight + 1;
  for (let i = 0; i < bloklar.length; i++) {
    const b = bloklar[i];
    if (!govde || b.dataset.yeniSayfa) govde = yeniSayfa();
    govde.appendChild(b);
    const sekilMi = b.classList.contains('sekil-blok') || b.classList.contains('serit-blok'), tabloMu = !!b.querySelector(':scope > table');
    if (tasar() && (sekilMi || tabloMu)) {
      // Şekil (ya da tablo) biraz küçülerek sığıyorsa küçült (sayfanın altı boş kalmasın).
      const kalan = govde.getBoundingClientRect().bottom - b.getBoundingClientRect().top - 2, olcek = kalan / b.getBoundingClientRect().height;
      if (olcek >= (sekilMi ? 0.74 : 0.84) && olcek < 1) { b.style.zoom = String(Math.floor(olcek * 100) / 100); if (!tasar()) continue; b.style.zoom = ''; }
    }
    if (tasar()) {
      // Başlık sayfanın sonunda yalnız kalmasın: önceki başlıklar da yeni sayfaya geçer.
      const tasinan = [b];
      let prev = b.previousElementSibling;
      while (prev && prev.classList.contains('baslik')) { tasinan.unshift(prev); prev = prev.previousElementSibling; }
      if (tasinan.length === govde.children.length) { /* sayfada tek başına ve sığmıyor: küçült */ b.classList.add('sigdir'); continue; }
      govde = yeniSayfa();
      for (const t of tasinan) govde.appendChild(t);
      if (tasar()) b.classList.add('sigdir');
    }
  }
  // Numaralar, üst şerit (bölüm adı), içindekiler.
  const sayfalar = [...hedef.querySelectorAll('.sayfa')];
  const toplam = sayfalar.length + 1;
  let bolumAdi = '';
  sayfalar.forEach((s, i) => {
    const no = i + 2; s.dataset.no = no;
    const b = s.querySelector('.bolum[data-baslik]'); if (b) bolumAdi = (b.dataset.no ? b.dataset.no + '. ' : '') + b.dataset.baslik;
    s.querySelector('.ust-sol').textContent = s.classList.contains('toc') ? 'İçindekiler' : bolumAdi;
    s.querySelector('.sayfa-no').textContent = 'Sayfa ' + no + ' / ' + toplam;
  });
  for (const span of document.querySelectorAll('.toc-sayfa')) {
    const t = document.getElementById(span.dataset.for); span.textContent = t ? t.closest('.sayfa').dataset.no : '?';
  }
  window.__sayfa = toplam; window.__tasan = [...document.querySelectorAll('.sigdir')].length;
  window.__hazir = true;
})();`;
