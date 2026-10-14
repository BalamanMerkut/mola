/*
 * Ekran çekme yardımcıları. Her çekim ekran/<ad>.png olarak yazılır; işaretlenecek öğelerin kutuları (CSS pikseli, görüntünün
 * sol üstüne göre) ekran/isaretler.json'a eklenir. Oklar ve numaralar PDF'te SVG olarak çizilir (görüntüye gömülmez).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import sharp from 'sharp';
/** Ekran görüntüsünü kaynak klasörü için küçültür. */
export const kucult = (png: Buffer) => sharp(png).resize({ width: 1600, withoutEnlargement: true }).png({ compressionLevel: 9, palette: true, quality: 92, effort: 8 }).toBuffer();
import { KAFE, MERKEZ, PASSWORD, ADMIN_PASSWORD } from './sunucular.ts';

import { EKRAN } from './yollar.ts';
export { EKRAN, HERE } from './yollar.ts';
const ISARET_DOSYASI = join(EKRAN, 'isaretler.json');

export type Yon = 'sol' | 'sag' | 'ust' | 'alt' | 'solust' | 'sagust' | 'solalt' | 'sagalt';
export type Kutu = { x: number; y: number; w: number; h: number };
export type Hedef = { n: number; loc: Locator | Kutu; yon?: Yon; nokta?: boolean };
export type Kayit = { w: number; h: number; isaretler: (Kutu & { n: number; yon?: Yon; nokta?: boolean })[]; tarih: string };

let kayitlar: Record<string, Kayit> = existsSync(ISARET_DOSYASI) ? JSON.parse(readFileSync(ISARET_DOSYASI, 'utf8')) : {};
const kaydet = () => writeFileSync(ISARET_DOSYASI, JSON.stringify(Object.fromEntries(Object.entries(kayitlar).sort(([a], [b]) => a.localeCompare(b))), null, 1));

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Test adreslerini kılavuzda görünecek gerçek adreslerle değiştirir (yalnız ekrandaki yazı; hiçbir şey kaydedilmez). */
const ADRES_DUZELT = `(() => {
  const swap = s => s.replace(/https?:\\/\\/127\\.0\\.0\\.1:${MERKEZ.split(':').at(-1)}/g, 'https://molayazilim.com.tr').replace(/127\\.0\\.0\\.1:${MERKEZ.split(':').at(-1)}/g, 'molayazilim.com.tr')
    .replace(/https?:\\/\\/127\\.0\\.0\\.1:${KAFE.split(':').at(-1)}/g, 'http://192.168.1.20:3000').replace(/127\\.0\\.0\\.1:${KAFE.split(':').at(-1)}/g, '192.168.1.20:3000');
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { const t = n.nodeValue; if (t && t.includes('127.0.0.1')) n.nodeValue = swap(t); }
  for (const el of document.querySelectorAll('span, small, div, p')) if (el.childElementCount === 0 && el.textContent && el.textContent.trim() === 'Yerel test ortamı') el.style.visibility = 'hidden';
  for (const el of document.querySelectorAll('input, textarea')) if (el.value && el.value.includes('127.0.0.1')) el.value = swap(el.value);
  for (const f of document.querySelectorAll('iframe')) { try { const d = f.contentDocument; if (!d) continue; const w = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.nodeValue; if (t && t.includes('127.0.0.1')) n.nodeValue = swap(t); } } catch {} }
})()`;

async function kutuOf(h: Locator | Kutu): Promise<Kutu> {
  if (!('boundingBox' in h)) return h;
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const b = await h.boundingBox({ timeout: 4000 });
      if (b) return { x: b.x, y: b.y, w: b.width, h: b.height };
    } catch (e) { last = e; }
    await sleep(400);
  }
  throw new Error(`Öğe bulunamadı: ${h} ${last ? (last as Error).message.split('\n')[0] : ''}`);
}

export type CekSecenek = {
  /** Görüntünün alanı: bir öğe (ya da öğeler; birleşimi), bir kutu, 'ekran' (görünen alan, varsayılan) ya da 'tam' (bütün sayfa). */
  kirp?: Locator | Locator[] | Kutu | 'ekran' | 'tam' | 'icerik';
  /** Kırpılan öğenin çevresine eklenen boşluk (px). */
  pay?: number;
  isaretler?: Hedef[];
  /** Çekmeden önce bu öğeyi görünür alana kaydır. */
  kaydir?: Locator;
  bekle?: number;
};

/** Ekranın görüntüsünü alır ve işaretleri kaydeder. Başarısız olursa önceki görüntü yerinde kalır (çağıran yakalar). */
export async function cek(page: Page, ad: string, o: CekSecenek = {}) {
  if (o.kaydir) { await o.kaydir.scrollIntoViewIfNeeded(); }
  await page.mouse.move(-10, -10).catch(() => {});
  await sleep(o.bekle ?? 350);
  await page.evaluate(ADRES_DUZELT).catch(() => {});
  const vp = page.viewportSize()!;
  let clip: Kutu, full = false, ofs = { x: 0, y: 0 };
  // Varsayılan: kenar çubuğu varsa onsuz (içerik), yoksa görünen alan. Kenar çubuğu gerekiyorsa kirp: 'ekran'.
  if (!o.kirp && await page.locator('.sidebar, .yonetim-sidebar').first().isVisible().catch(() => false)) o = { ...o, kirp: 'icerik' };
  if (o.kirp === 'tam') {
    full = true;
    const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, sx: scrollX, sy: scrollY }));
    clip = { x: 0, y: 0, w: size.w, h: size.h }; ofs = { x: size.sx, y: size.sy };
  } else if (!o.kirp || o.kirp === 'ekran') clip = { x: 0, y: 0, w: vp.width, h: vp.height };
  else if (o.kirp === 'icerik') {
    // Kenar çubuğu olmadan: yalnız sayfanın içeriği (PDF'te daha büyük ve okunaklı görünür).
    const side = await page.locator('.sidebar, .yonetim-sidebar').first().boundingBox().catch(() => null);
    const x = side && side.x < 10 ? Math.round(side.x + side.width) : 0;
    clip = { x, y: 0, w: vp.width - x, h: vp.height };
  }
  else {
    const list = Array.isArray(o.kirp) ? o.kirp : [o.kirp];
    const boxes = await Promise.all(list.map(kutuOf));
    const pay = o.pay ?? 0;
    const x1 = Math.max(0, Math.min(...boxes.map(b => b.x)) - pay), y1 = Math.max(0, Math.min(...boxes.map(b => b.y)) - pay);
    const x2 = Math.min(vp.width, Math.max(...boxes.map(b => b.x + b.w)) + pay), y2 = Math.min(vp.height, Math.max(...boxes.map(b => b.y + b.h)) + pay);
    clip = { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
  }
  const isaretler: Kayit['isaretler'] = [];
  for (const h of o.isaretler ?? []) {
    const b = await kutuOf(h.loc);
    const x = b.x + ofs.x - clip.x, y = b.y + ofs.y - clip.y;
    const cx = x + b.w / 2, cy = y + b.h / 2;
    if (cx < 0 || cy < 0 || cx > clip.w || cy > clip.h) { console.log(`  ! ${ad}: ${h.n} numaralı işaret görüntünün dışında, atlandı`); continue; }
    isaretler.push({ n: h.n, x: Math.round(x), y: Math.round(y), w: Math.round(b.w), h: Math.round(b.h), ...(h.yon ? { yon: h.yon } : {}), ...(h.nokta ? { nokta: true } : {}) });
  }
  const png = await page.screenshot(full ? { fullPage: true } : { clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h } });
  // Kaynak görüntü en çok 1600 px genişlikte, 256 renkli PNG (PDF'te en geniş gösterim 665 px × 2,2): klasör küçük kalır.
  writeFileSync(join(EKRAN, `${ad}.png`), await kucult(png));
  kayitlar[ad] = { w: clip.w, h: clip.h, isaretler, tarih: new Date().toISOString() };
  kaydet();
  console.log(`  ✓ ${ad} (${clip.w}×${clip.h}, ${isaretler.length} işaret)`);
}

/** Hazır bir görüntüyü (ör. yazdırma görünümündeki bir öğe) kılavuza alır: ekran/<ad>.png ve işaretsiz kaydı. */
export async function hazirGoruntu(ad: string, png: Buffer) {
  const meta = await sharp(png).metadata(), olcek = 2;
  writeFileSync(join(EKRAN, `${ad}.png`), await kucult(png));
  kayitlar[ad] = { w: Math.round(meta.width! / olcek), h: Math.round(meta.height! / olcek), isaretler: [], tarih: new Date().toISOString() };
  kaydet();
  console.log(`  ✓ ${ad} (${kayitlar[ad].w}×${kayitlar[ad].h})`);
}
export type Cihaz = 'telefon' | 'masaustu' | 'tablet' | 'dik';
/** `userAgent`: a phone's own (Kafemi yönet names the device from what its browser says it is: "iPhone · 15 Ekim"). */
export async function yeniSayfa(browser: Browser, cihaz: Cihaz, o: { yukseklik?: number; detay?: boolean; userAgent?: string } = {}) {
  const size = { telefon: { width: 390, height: 844 }, masaustu: { width: 1280, height: 800 }, tablet: { width: 1180, height: 820 }, dik: { width: 820, height: 1180 } }[cihaz];
  if (o.yukseklik) size.height = o.yukseklik;
  const phone = cihaz === 'telefon';
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', colorScheme: 'light', reducedMotion: 'reduce', ...(o.userAgent ? { userAgent: o.userAgent } : {}),
    storageState: o.detay ? { cookies: [], origins: [{ origin: KAFE, localStorage: [{ name: 'mola-report-view', value: 'detail' }] }] } : undefined });
  return ctx.newPage();
}

/** Çalışan girişi (API ile; çerez aynı tarayıcı bağlamında kalır), sonra ana sayfa. */
export async function giris(page: Page, kullanici: string, yol = '/') {
  const r = await page.request.post(`${KAFE}/api/login`, { data: { username: kullanici, password: PASSWORD } });
  if (!r.ok()) throw new Error(`Giriş olmadı (${kullanici}): ${r.status()} ${await r.text()}`);
  await page.goto(`${KAFE}${yol}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(600);
}
/** Ekrandaki "Ses kapalı · açmak için dokunun" çipini bir dokunuşla kapatır (gerçek bir dokunuş sesi açar). */
export async function sesiAc(page: Page) {
  const chip = page.getByRole('button', { name: /Ses kapalı/ });
  if (await chip.isVisible().catch(() => false)) await chip.click().catch(() => {});
}

export async function yonetimGiris(page: Page, kod?: () => Promise<string>) {
  await page.goto(`${MERKEZ}/`);
  await page.getByLabel('Şifre', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  if (kod) {
    const box = page.getByLabel('Authenticator veya kurtarma kodu', { exact: true });
    await box.waitFor({ timeout: 8000 });
    await box.fill(await kod());
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
  }
  await page.getByRole('button', { name: 'Çıkış yap', exact: true }).waitFor();
}

/** Bir çekim grubunu çalıştırır; bir çekim düşerse hatayı yazar ve devam eder (önceki görüntü yerinde kalır). */
export const hatalar: string[] = [];
export async function dene(ad: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { const m = `${ad}: ${(e as Error).message.split('\n')[0]}`; hatalar.push(m); console.log(`  ✗ ${m}`); if (process.env.KILAVUZ_DEBUG) console.log((e as Error).message); }
}
export type Ctx = BrowserContext;
