/* Çalışan ve işletme sahibi ekranları (garson, kasiyer, mutfak, müdür, sahip). */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { Grup } from './ekranlar.ts';
import { totp } from '../../../../server/totp.ts';
import { decodeParts, fakeSmtp } from '../../../../tests/fake-smtp.ts';
import { adminApi } from './ekranlar-yonetim.ts';
import { KAFE, MERKEZ } from './sunucular.ts';
import { cek, dene, giris, hazirGoruntu, sesiAc, sleep, yeniSayfa, type Hedef } from './cekim.ts';

/** Kenar çubuğundan (masaüstü) ya da alt menüden (telefon) bir yere gider. */
export async function git(page: Page, ad: string) {
  const side = page.locator('.sidebar nav');
  const re = new RegExp(`^${ad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s|\\d)`);
  if (await side.isVisible().catch(() => false)) { await page.locator('.sidebar').getByRole('button', { name: re }).first().click(); }
  else {
    const bar = page.getByRole('navigation', { name: 'Alt menü' });
    const direct = bar.getByRole('button', { name: re });
    if (await direct.count()) await direct.first().click();
    else { await bar.getByRole('button', { name: /^Daha fazla/ }).click(); await page.getByRole('dialog', { name: 'Daha fazla' }).getByRole('button', { name: re }).first().click(); }
  }
  await sleep(900);
}
/** A home's tab and sub-tab (10 Ekim düzeni): Kasa ve giderler, Personel, Menü yönetimi, Ajanda ve rezervasyon. */
export async function ev(page: Page, ad: string, sekme?: string, alt?: string) {
  const tabs = page.getByRole('navigation', { name: `${ad === 'Ajanda ve rezervasyon' ? 'Ajanda' : ad} bölümleri`, exact: true });
  if (!await tabs.isVisible().catch(() => false)) await git(page, ad);
  if (sekme) await tabs.getByRole('button', { name: new RegExp(`^${sekme}`) }).click();
  if (alt) { await sleep(600); await page.getByRole('navigation', { name: `${sekme} bölümleri`, exact: true }).getByRole('button', { name: new RegExp(`^${alt}`) }).click(); }
  await sleep(800);
  await page.evaluate(() => scrollTo(0, 0));
}
export async function ayar(page: Page, konu: string, bolum?: string) {
  if (!await page.getByRole('navigation', { name: 'Ayarlar konuları' }).isVisible().catch(() => false)) await git(page, 'Ayarlar');
  await page.getByRole('navigation', { name: 'Ayarlar konuları' }).getByRole('button', { name: new RegExp(`^${konu}`) }).click();
  if (bolum) await page.getByRole('navigation', { name: `${konu} bölümleri`, exact: true }).getByRole('button', { name: new RegExp(`^${bolum}`) }).click();
  await sleep(800);
  await page.evaluate(() => scrollTo(0, 0));
}
/** Ayarlar'da sayfa başlığı olmadan: konu çubuğundan ekranın altına kadar, kenar çubuğu olmadan. */
async function ayarAlani(page: Page) {
  const vp = page.viewportSize()!;
  const side = await page.locator('.sidebar').first().boundingBox().catch(() => null);
  const bar = await page.getByRole('navigation', { name: 'Ayarlar konuları' }).boundingBox();
  const x = side ? Math.round(side.x + side.width) : 0, y = Math.max(0, Math.round((bar?.y ?? 0) - 14));
  return { x, y, w: vp.width - x, h: vp.height - y };
}
const baslik = (scope: Page | Locator, ad: string | RegExp) => scope.getByRole('heading', { name: ad }).first();
const dugme = (scope: Page | Locator, ad: string | RegExp, exact = typeof ad === 'string') => scope.getByRole('button', { name: ad, exact }).first();
/** Bir başlığın içinde durduğu kart (en yakın section / article / .card). */
const kart = (scope: Page | Locator, ad: string | RegExp) => baslik(scope, ad).locator('xpath=ancestor::*[self::section or self::article or contains(@class,"card") or contains(@class,"panel")][1]');
async function sahipSayfasi(browser: Parameters<Grup>[0], o: { yukseklik?: number; detay?: boolean } = {}) {
  const page = await yeniSayfa(browser, 'masaustu', o);
  await giris(page, 'isletme');
  await sleep(2500);
  const kabul = page.getByRole('button', { name: 'Okudum, kabul ediyorum' });
  if (await kabul.isVisible().catch(() => false)) { await kabul.click(); await sleep(600); }
  const sonra = page.getByRole('dialog', { name: 'Mola ekibinden önemli duyuru' }).getByRole('button', { name: 'Daha sonra' });
  if (await sonra.isVisible().catch(() => false)) { await sonra.click(); await sleep(400); }
  await sesiAc(page);
  return page;
}
/** Bu çalışmanın masaüstü anahtarı (Mola penceresinin sol şeridi için). */
function masaustuAnahtari() {
  const root = process.env.KILAVUZ_ROOT ?? readdirSync('.local/e2e').filter(n => n.startsWith('kilavuz-')).map(n => resolve('.local/e2e', n)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return readFileSync(join(root, 'masaustu.anahtar'), 'utf8').trim();
}

// ---------------------------------------------------------------- Garson (telefon)
const garson: Grup = async browser => {
  const g = await yeniSayfa(browser, 'telefon');
  await giris(g, 'garson'); await sesiAc(g);
  await git(g, 'Masalar');
  const bar = g.getByRole('navigation', { name: 'Alt menü' });
  const filtre = g.getByRole('group', { name: 'Masa filtresi' });
  const acik = g.locator('.floor-tile:not(.empty)').first();
  // Sayfanın başı: çağrılar tek satırda kayar, QR onayları tek satırda ("Göster"); masalar yine ilk ekranda.
  await g.evaluate(() => scrollTo(0, 0)); await sleep(400);
  await dene('g-masalar', () => cek(g, 'g-masalar', { isaretler: [
    { n: 1, loc: g.getByLabel('Masa özeti'), yon: 'alt' },
    { n: 2, loc: filtre, yon: 'alt' },
    { n: 3, loc: acik, yon: 'sag' },
    { n: 4, loc: bar, yon: 'ust' },
  ] }));
  await acik.click();
  const pen = g.getByRole('dialog').first();
  await pen.waitFor(); await sleep(500);
  await dene('g-masa-penceresi', () => cek(g, 'g-masa-penceresi', { isaretler: [
    { n: 1, loc: dugme(pen, /Sipariş ekle/, false), yon: 'ust' },
    { n: 2, loc: dugme(pen, /Taşı/, false), yon: 'ust' },
  ] }));
  await g.keyboard.press('Escape'); await sleep(400);
  await git(g, 'Sipariş al');
  await g.getByLabel('Sipariş masası').selectOption({ label: 'Masa 08' }).catch(async () => { await g.getByLabel('Sipariş masası').selectOption({ index: 8 }); });
  const satir = (ad: string) => g.locator('.staff-row', { hasText: ad }).first();
  const cay = satir('Demleme Çay').getByRole('button', { name: /bir adet ekle|seçenekleri aç/ });
  await cay.scrollIntoViewIfNeeded(); await cay.click(); await cay.click();
  const tost = satir('Kaşarlı Tost').getByRole('button', { name: /bir adet ekle|seçenekleri aç/ });
  await tost.scrollIntoViewIfNeeded(); await tost.click();
  // Masa seçimi ve arama ekranın üstünde kalsın (çağrı şeritleri ve QR onayları yukarıda).
  await g.getByLabel('Sipariş masası').evaluate(e => { e.scrollIntoView({ block: 'start' }); scrollBy(0, -16); }); await sleep(400);
  await dene('g-siparis', () => cek(g, 'g-siparis', { isaretler: [
    { n: 1, loc: g.getByLabel('Sipariş masası'), yon: 'alt' },
    { n: 2, loc: g.getByRole('textbox', { name: 'Ürün ara' }), yon: 'alt' },
    { n: 3, loc: g.locator('.staff-row').first().getByRole('button').last(), yon: 'sol' },
    { n: 4, loc: g.locator('.staff-basket-bar'), yon: 'ust' },
  ] }));
  await g.locator('.staff-basket-bar').getByRole('button', { name: /Sepeti görüntüle/ }).click();
  const sepet = g.getByRole('dialog', { name: /Sepet/ });
  await sepet.waitFor(); await sleep(400);
  await dene('g-sepet', () => cek(g, 'g-sepet', { isaretler: [
    { n: 1, loc: sepet.getByRole('button', { name: /adedini artır/ }).first(), yon: 'sol' },
    // 13 Ekim: "Paket yapılsın" per item and "Hepsini paketle".
    { n: 2, loc: sepet.getByRole('checkbox', { name: /^Hepsini paketle/ }), yon: 'ust' },
    { n: 3, loc: sepet.getByRole('button', { name: /Gönder|Siparişi gönder/ }).last(), yon: 'ust' },
  ] }));
  await sepet.getByRole('button', { name: /Gönder|Siparişi gönder/ }).last().click();
  await sleep(1200);
  await bar.getByRole('button', { name: /^Daha fazla/ }).click();
  const daha = g.getByRole('dialog', { name: 'Daha fazla' });
  await daha.waitFor(); await sleep(400);
  await dene('g-daha-fazla', () => cek(g, 'g-daha-fazla', { isaretler: [{ n: 1, loc: daha, yon: 'ust' }] }));
  await g.context().close();
};

// ---------------------------------------------------------------- Kasiyer (kasa bilgisayarı)
const kasiyer: Grup = async (browser, { api, id, ok }) => {
  const k = await yeniSayfa(browser, 'masaustu', { yukseklik: 860 });
  await giris(k, 'kasiyer'); await sesiAc(k);
  const acilis = k.getByRole('form', { name: 'Kasa açılışı' });
  if (await acilis.isVisible().catch(() => false)) { await acilis.getByRole('textbox').first().fill('500'); await dugme(acilis, 'Açılışı kaydet').click(); await sleep(1000); }
  // Yazar kasa yardımcısı: bir ödemeden sonra yazar kasaya ne girileceğini söyler. 11 Ekim'den beri ilk hâli kapalı: çekim için açılır.
  await ok(await (await api('isletme')).post('/api/staff/cash/settings', { data: { fiscalHelper: true } }), 'yazar kasa yardımcısı');
  const garsonApi = await api('garson');
  const st = await (await garsonApi.get('/api/staff/state')).json();
  const masa = st.tables.find((t: any) => !t.account && !t.needsCleaning && t.name !== 'Masa 05');
  await ok(await garsonApi.post('/api/staff/orders', { data: { requestId: id(), tableId: masa.id, lines: [{ productId: 'tea', quantity: 2, selections: [] }, { productId: 'cheesecake', quantity: 1, selections: [] }], expectedTotal: 26000 } }), 'garson siparişi');
  await sleep(1500);
  await k.locator('.table-card').filter({ has: k.getByRole('heading', { name: masa.name, exact: true }) }).click();
  await dugme(k, 'Ödeme al').click();
  const odeme = k.getByRole('dialog', { name: new RegExp(`${masa.name} · Ödeme al`) });
  await odeme.waitFor();
  await dugme(odeme, 'Nakit').click().catch(() => {});
  await odeme.getByLabel(/Alınan nakit/).fill('300').catch(() => {});
  await sleep(500);
  await dene('c-odeme-nakit', () => cek(k, 'c-odeme-nakit', { kirp: odeme, pay: 12, isaretler: [
    { n: 1, loc: odeme.getByRole('group', { name: 'Ne kadar ödenecek' }), yon: 'sol' },
    { n: 2, loc: dugme(odeme, 'Nakit'), yon: 'sol' },
    { n: 3, loc: odeme.getByLabel(/Alınan nakit/), yon: 'sol' },
    { n: 4, loc: dugme(odeme, 'Ödemeyi kaydet'), yon: 'ust' },
  ] }));
  await dugme(odeme, 'Ödemeyi kaydet').click();
  await sleep(1500);
  const dock = k.getByRole('complementary', { name: 'Yazar kasa yardımcısı' });
  await dene('c-yazar-kasa', () => cek(k, 'c-yazar-kasa', { kirp: dock, pay: 40, isaretler: [
    { n: 1, loc: dock.locator('.fiscal-card:not(.folded)').first(), yon: 'sol' },
    { n: 2, loc: dugme(dock, 'Girildi'), yon: 'sol' },
  ] }));
  await dugme(dock, 'Girildi').click().catch(() => {});
  // Kasa işlemleri menüsü.
  await k.locator('.cash-chip').click();
  const menu = k.getByRole('group', { name: 'Kasa işlemleri' });
  await menu.waitFor(); await sleep(300);
  await dene('c-kasa-menu', () => cek(k, 'c-kasa-menu', { kirp: [k.locator('.cash-chip'), menu], pay: 24, isaretler: [
    { n: 1, loc: k.locator('.cash-chip'), yon: 'sol' },
    { n: 2, loc: dugme(menu, 'Gider kaydet'), yon: 'sol' },
    { n: 3, loc: dugme(menu, 'İade'), yon: 'sol' },
    { n: 4, loc: dugme(menu, 'Gün sonu'), yon: 'sol' },
  ] }));
  await dugme(menu, 'İade').click();
  const iade = k.getByRole('dialog').first();
  await iade.waitFor(); await sleep(600);
  await dene('c-iade', () => cek(k, 'c-iade', { kirp: iade, pay: 12, isaretler: [] }));
  await k.keyboard.press('Escape'); await sleep(400);
  // Masasız (al götür) sipariş.
  await git(k, 'Sipariş al');
  const secim = k.getByRole('button', { name: /^Masasız sipariş/ });
  await dene('c-siparis-al', () => cek(k, 'c-siparis-al', { kirp: [secim, k.getByLabel('Sipariş masası')], pay: 24, isaretler: [
    { n: 1, loc: secim, yon: 'alt' }, { n: 2, loc: k.getByLabel('Sipariş masası'), yon: 'alt' },
  ] }));
  await secim.click();
  const msz = k.getByRole('dialog', { name: 'Masasız sipariş' });
  await msz.getByLabel('Müşteri adı', { exact: true }).fill('Ahmet');
  await msz.locator('.staff-card, .staff-row', { hasText: 'Americano' }).first().click();
  const urun = k.getByRole('dialog', { name: 'Americano' });
  if (await urun.isVisible({ timeout: 2000 }).catch(() => false)) await urun.getByRole('button', { name: /Sepete ekle/ }).click();
  await sleep(500);
  await dene('c-masasiz', () => cek(k, 'c-masasiz', { kirp: msz, pay: 12, isaretler: [
    { n: 1, loc: msz.getByLabel('Müşteri adı', { exact: true }), yon: 'sag' },
    { n: 2, loc: msz.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }), yon: 'ust' },
  ] }));
  await msz.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await dugme(k, 'Siparişi gönder').click();
  const sonra = k.getByRole('dialog', { name: /Masasız #\d+ · Ödeme al/ });
  await sonra.waitFor({ timeout: 8000 });
  await dugme(sonra, 'Sonra öde').click();
  await git(k, 'Masalar');
  const serit = k.locator('.takeaway-strip');
  await serit.waitFor();
  await serit.scrollIntoViewIfNeeded();
  await dene('c-masasiz-serit', () => cek(k, 'c-masasiz-serit', { kirp: serit, pay: 14, isaretler: [
    { n: 1, loc: serit.locator('.takeaway-card').filter({ hasText: 'Ahmet' }).first(), yon: 'sag' },
  ] }));
  await k.context().close();
  await garsonApi.dispose();
};

// ---------------------------------------------------------------- Mutfak
const mutfak: Grup = async browser => {
  const m = await yeniSayfa(browser, 'tablet');
  await giris(m, 'mutfak'); await sesiAc(m);
  await dene('k-pano', () => cek(m, 'k-pano', { isaretler: [
    { n: 1, loc: m.locator('.kitchen-column').nth(0), yon: 'alt' },
    { n: 2, loc: m.locator('.kitchen-column').nth(1), yon: 'alt' },
    { n: 3, loc: m.locator('.kitchen-column').nth(2), yon: 'alt' },
    { n: 4, loc: dugme(m, /Stok/, false), yon: 'alt' },
  ] }));
  const gec = m.locator('.kitchen-card.late, .kitchen-card.very-late').first();
  if (await gec.count()) await dene('k-gecikti', () => cek(m, 'k-gecikti', { kirp: gec, pay: 16, isaretler: [{ n: 1, loc: gec.getByText(/gecikti/i).first(), yon: 'sol' }] }));
  await m.context().close();
  const d = await yeniSayfa(browser, 'dik');
  await giris(d, 'mutfak'); await sesiAc(d);
  await dene('k-dik', () => cek(d, 'k-dik', { kirp: { x: 0, y: 0, w: 820, h: 900 }, isaretler: [{ n: 1, loc: d.getByRole('tablist').or(d.locator('.kitchen-tabs')).first(), yon: 'alt' }] }));
  await d.context().close();
};

// ---------------------------------------------------------------- Müdür
const mudur: Grup = async (browser, { sahip, ok }) => {
  const users = await (await sahip.get('/api/staff/users')).json();
  if (!(users.users ?? users).some?.((u: any) => u.username === 'mudur'))
    await ok(await sahip.post('/api/staff/users', { data: { username: 'mudur', name: 'Can Öztürk', role: 'manager', password: 'MolaDemo!2026' } }), 'müdür hesabı');
  const s = await sahipSayfasi(browser, { yukseklik: 1000 });
  // 10 Ekim düzeni: "Çalışanlar" is the first tab of Personel.
  await ev(s, 'Personel', 'Çalışanlar');
  await dugme(s, 'Çalışan ekle').click();
  const form = s.getByRole('dialog').or(s.getByRole('form')).first();
  await sleep(500);
  const rol = form.getByRole('combobox').first();
  await rol.selectOption({ label: 'Müdür' }).catch(() => {});
  await form.getByRole('button', { name: 'i', exact: true }).first().click().catch(() => {});
  await sleep(500);
  await dene('mu-calisan-ekle', () => cek(s, 'mu-calisan-ekle', { kirp: form, pay: 12, isaretler: [{ n: 1, loc: rol, yon: 'sag' }] }));
  await s.keyboard.press('Escape');
  await s.context().close();
  const m = await yeniSayfa(browser, 'masaustu');
  await giris(m, 'mudur'); await sesiAc(m);
  await dene('mu-ekran', () => cek(m, 'mu-ekran', { kirp: 'ekran', isaretler: [{ n: 1, loc: m.locator('.sidebar nav'), yon: 'sag' }, { n: 2, loc: m.locator('.sidebar nav').getByRole('button', { name: /^Kasa ve giderler/ }), yon: 'sag' }] }));
  await m.context().close();
};

// ---------------------------------------------------------------- Sahip: giriş, Masalar
const sahipMasalar: Grup = async browser => {
  const s = await yeniSayfa(browser, 'masaustu', { yukseklik: 1250 });
  await giris(s, 'isletme');
  const soz = s.getByRole('dialog', { name: 'Mola Lisans Sözleşmesi' });
  if (await soz.isVisible({ timeout: 6000 }).catch(() => false)) {
    await dene('s-lisans-sozlesmesi', () => cek(s, 's-lisans-sozlesmesi', { kirp: soz, pay: 10, isaretler: [
      { n: 1, loc: dugme(soz, 'Okudum, kabul ediyorum'), yon: 'ust' }, { n: 2, loc: dugme(soz, 'Daha sonra'), yon: 'ust' },
    ] }));
    await dugme(soz, 'Okudum, kabul ediyorum').click(); await sleep(600);
  }
  await sesiAc(s);
  await dene('s-masalar', () => cek(s, 's-masalar', { kirp: 'ekran', isaretler: [
    { n: 1, loc: s.locator('.sidebar nav'), yon: 'sag' },
    { n: 2, loc: s.getByLabel('Günün özeti'), yon: 'alt' },
    { n: 3, loc: s.locator('.cash-chip'), yon: 'alt' },
    { n: 4, loc: dugme(s, 'Masa ekle'), yon: 'alt' },
    { n: 5, loc: s.locator('.table-card').filter({ hasText: /Hazır|Yeni sipariş/ }).first(), yon: 'sag' },
    { n: 6, loc: s.getByRole('region', { name: 'İlk adımlar' }), yon: 'alt' },
  ] }));
  const ilk = s.getByRole('region', { name: 'İlk adımlar' });
  const ac = ilk.locator('.first-steps-toggle');
  if (await ac.count() && await ac.getAttribute('aria-expanded') === 'false') await ac.click();
  await sleep(500);
  await dene('s-ilk-adimlar', () => cek(s, 's-ilk-adimlar', { kirp: ilk, pay: 12 }));
  // Masa penceresi ve QR menü.
  const dolu = s.locator('.table-card').filter({ hasText: /sipariş/ }).first();
  await dolu.click();
  const pen = s.getByRole('dialog').first(); await pen.waitFor(); await sleep(400);
  await dene('s-masa-penceresi', () => cek(s, 's-masa-penceresi', { kirp: pen, pay: 12, isaretler: [
    { n: 1, loc: dugme(pen, /QR menüyü aç/, false), yon: 'sol' },
    { n: 2, loc: dugme(pen, /Sipariş ekle/, false), yon: 'ust' },
    { n: 3, loc: dugme(pen, /Taşı/, false), yon: 'ust' },
    { n: 4, loc: dugme(pen, 'Ödeme al'), yon: 'alt' },
  ] }));
  await dugme(pen, /QR menüyü aç/, false).click();
  const qr = s.getByRole('dialog', { name: /QR menü/ }); await qr.waitFor(); await sleep(600);
  await dene('s-masa-qr', () => cek(s, 's-masa-qr', { kirp: qr, pay: 12, isaretler: [
    { n: 1, loc: qr.locator('.qr-address'), yon: 'alt' },
    { n: 2, loc: qr.getByRole('link', { name: 'Müşteri menüsünü aç' }), yon: 'sol' },
  ] }));
  await s.context().close();
};

// ---------------------------------------------------------------- Sahip: menü, kampanya
const sahipMenu: Grup = async browser => {
  const s = await sahipSayfasi(browser, { yukseklik: 900 });
  await git(s, 'Menü yönetimi');
  await dene('s-menu-yonetimi', () => cek(s, 's-menu-yonetimi', { isaretler: [
    { n: 1, loc: dugme(s, 'Ürün ekle'), yon: 'alt' },
    { n: 2, loc: dugme(s, 'Kategoriler ve sıra'), yon: 'alt' },
    { n: 3, loc: dugme(s, 'Menüyü önizle'), yon: 'alt' },
    { n: 4, loc: s.getByRole('button', { name: /^Taslaklar/ }).first(), yon: 'alt' },
    { n: 5, loc: s.getByText('Tükendi', { exact: true }).first(), yon: 'sol' },
  ] }));
  await s.locator('.product-admin-card, article, li').filter({ has: baslik(s, 'Caffè Latte') }).getByRole('button', { name: 'Düzenle' }).first().click();
  const ed = s.getByRole('dialog').first(); await ed.waitFor(); await sleep(700);
  await dene('s-urun-duzenle', () => cek(s, 's-urun-duzenle', { kirp: ed, pay: 8, isaretler: [
    { n: 1, loc: ed.getByLabel(/Fiyat/).first(), yon: 'sol' },
    { n: 2, loc: ed.getByText(/KDV/).first(), yon: 'sol' },
  ] }));
  await s.keyboard.press('Escape'); await sleep(500);
  const kapat = s.getByRole('dialog').getByRole('button', { name: /Kapat|Vazgeç/ }).first();
  if (await kapat.isVisible().catch(() => false)) await kapat.click();
  await ev(s, 'Menü yönetimi', 'Kampanyalar');
  await dene('s-kampanyalar', () => cek(s, 's-kampanyalar', { isaretler: [
    { n: 1, loc: dugme(s, 'Kampanya ekle'), yon: 'alt' },
    { n: 2, loc: s.getByRole('heading', { name: /Çay Keyfi/ }).first(), yon: 'sag' },
  ] }));
  await dugme(s, 'Kampanya ekle').click();
  const kd = s.getByRole('dialog').first(); await kd.waitFor(); await sleep(600);
  await dene('s-kampanya-ekle', () => cek(s, 's-kampanya-ekle', { kirp: kd, pay: 8 }));
  await s.context().close();
};

// ---------------------------------------------------------------- Sahip: stok
const sahipStok: Grup = async (browser, { sahip, id, ok }) => {
  let st = await (await sahip.get('/api/staff/stock')).json();
  if (!st.items?.length) {
    for (const item of [{ name: 'Kahve çekirdeği', unit: 'g', initial: 4200, min: 1000, unitCost: 90 }, { name: 'Süt', unit: 'ml', initial: 9000, min: 3000, unitCost: 4 }, { name: 'Yulaf sütü', unit: 'ml', initial: 1500, min: 2000, unitCost: 8 },
      { name: 'Şeker', unit: 'g', initial: 5000, min: 1000, unitCost: 4 }, { name: 'Limon', unit: 'piece', initial: 40, min: 10, unitCost: 500 }, { name: 'Rize çayı', unit: 'g', initial: 2500, min: 500, unitCost: 30 }])
      await ok(await sahip.post('/api/staff/stock/items', { data: item }), 'stok malzemesi');
    st = await (await sahip.get('/api/staff/stock')).json();
    const by = (n: string) => st.items.find((i: any) => i.name === n).id;
    for (const body of [{ productId: 'latte', mode: 'recipe', items: [{ itemId: by('Kahve çekirdeği'), amount: 18 }, { itemId: by('Süt'), amount: 200 }] }, { productId: 'turkish', mode: 'recipe', items: [{ itemId: by('Kahve çekirdeği'), amount: 30 }] },
      { productId: 'lemonade', mode: 'recipe', items: [{ itemId: by('Limon'), amount: 2 }, { itemId: by('Şeker'), amount: 30 }] }, { productId: 'tea', mode: 'recipe', items: [{ itemId: by('Rize çayı'), amount: 6 }] }, { productId: 'cheesecake', mode: 'ready' }])
      await ok(await sahip.post('/api/staff/stock/recipes', { data: body }), 'reçete');
    st = await (await sahip.get('/api/staff/stock')).json();
    const cake = st.items.find((i: any) => i.productId === 'cheesecake');
    if (cake) await ok(await sahip.post('/api/staff/stock/purchase', { data: { requestId: id(), itemId: cake.id, quantity: 12, total: 12 * 12000 } }), 'alış');
  }
  const s = await sahipSayfasi(browser, { yukseklik: 900, detay: true });
  await git(s, 'Stok');
  const sekme = (ad: string) => s.getByRole('navigation').getByRole('button', { name: new RegExp(`^${ad}`) }).first();
  await dene('s-stok-malzemeler', () => cek(s, 's-stok-malzemeler', { isaretler: [
    { n: 1, loc: s.locator('main').getByRole('button', { name: /^Malzemeler/ }).first(), yon: 'alt' },
    { n: 2, loc: dugme(s, 'Malzeme ekle'), yon: 'alt' },
    { n: 3, loc: s.locator('main').getByText('Yulaf sütü', { exact: true }).first(), yon: 'sag' },
  ] }));
  await s.locator('main').getByRole('button', { name: /^Reçeteler/ }).first().click(); await sleep(800);
  await dene('s-stok-receteler', () => cek(s, 's-stok-receteler', { isaretler: [{ n: 1, loc: s.locator('.stock-row').filter({ hasText: 'Caffè Latte' }).first(), yon: 'sol' }] }));
  await s.locator('main').getByRole('button', { name: /^Ürünler/ }).first().click(); await sleep(800);
  // "Sınırlayan malzeme: Süt" ve ⓘ (8 Ekim).
  const sinir = s.locator('.stock-row').filter({ hasText: 'Caffè Latte' }).first();
  await dene('s-stok-urunler', async () => {
    // Odakla açılır (fareyle açılan balon, çekimden önce fare kenara gidince kapanır).
    await sinir.getByRole('button', { name: 'Sınırlayan malzeme hakkında bilgi' }).focus(); await sleep(500);
    await cek(s, 's-stok-urunler', { kirp: [sinir, s.getByRole('tooltip').first()], pay: 16, isaretler: [{ n: 1, loc: sinir.locator('.stock-row-limit'), yon: 'sol' }] });
    await s.keyboard.press('Escape'); await sleep(300);
  });
  await s.locator('main').getByRole('button', { name: /^Alış ve sayım/ }).first().click(); await sleep(800);
  // Yanlış kaydı geri almak: satırın ⋯ → "Bu kaydı geri al" → etkisini söyleyen onay penceresi.
  await dene('s-stok-geri-al', async () => {
    const satir = s.locator('.stock-entry').filter({ has: s.getByRole('button', { name: /diğer işlemler$/ }) }).first();
    await satir.getByRole('button', { name: /diğer işlemler$/ }).click(); await sleep(400);
    const menu = satir.getByRole('menu');
    await cek(s, 's-stok-geri-al', { kirp: [satir, menu], pay: 16, isaretler: [{ n: 1, loc: satir.getByRole('button', { name: /diğer işlemler$/ }), yon: 'sol' }, { n: 2, loc: menu.getByRole('menuitem', { name: 'Bu kaydı geri al' }), yon: 'sol' }] });
    await menu.getByRole('menuitem', { name: 'Bu kaydı geri al' }).click();
    const onay = s.getByRole('dialog', { name: 'Bu kaydı geri al' }); await onay.waitFor(); await sleep(800);
    await cek(s, 's-stok-geri-al-onay', { kirp: onay, pay: 10 });
    await s.keyboard.press('Escape'); await sleep(400);
  });
  void sekme;
  await s.context().close();
};

// ---------------------------------------------------------------- Sahip: Satış ve Raporlar
const sahipRapor: Grup = async browser => {
  // Yeni cihaz: önce sade özet.
  const s = await sahipSayfasi(browser, { yukseklik: 980 });
  // Geçen yılın Aralık kirası (sahip gideri en çok bir yıl geriye yazabilir): "Tümü" iki yılı tablo olarak gösterir.
  const gecenYil = String(new Date().getFullYear() - 1);
  await s.request.post(`${KAFE}/api/staff/expenses`, { data: { requestId: crypto.randomUUID(), amount: 1_250_000, description: 'Aralık kirası', day: `${gecenYil}-12-20`, method: 'transfer' } });
  await git(s, 'Satış ve Raporlar');
  await sleep(1500);
  const donem = s.getByRole('group', { name: 'Dönem' });
  await dene('s-rapor-sade', () => cek(s, 's-rapor-sade', { isaretler: [
    { n: 1, loc: donem, yon: 'alt' },
    { n: 2, loc: s.getByTestId('simple-sentence'), yon: 'alt' },
    { n: 3, loc: dugme(s, 'Detaylı göster'), yon: 'alt' },
    // 13 Ekim: Yazdır / PDF, Muhasebeci için indir, Raporları gönder ve telefonda gör tek menüde.
    { n: 4, loc: dugme(s, 'Yazdır ve paylaş', false), yon: 'alt' },
  ] }));
  // The menu open: its lines with what each does.
  await dene('s-rapor-paylas', async () => {
    await dugme(s, 'Yazdır ve paylaş', false).click(); await sleep(500);
    const menu = s.getByRole('menu').first();
    await cek(s, 's-rapor-paylas', { kirp: [dugme(s, 'Yazdır ve paylaş', false), menu], pay: 16, isaretler: [{ n: 1, loc: menu.getByRole('menuitem').first(), yon: 'sol' }] });
    await s.keyboard.press('Escape'); await sleep(300);
  });
  await dugme(donem, 'Yıl').click(); await sleep(800);
  const yil = s.getByRole('menu', { name: 'Yıl seçin' });
  await dene('s-rapor-yil', () => cek(s, 's-rapor-yil', { kirp: [donem, yil], pay: 40, isaretler: [{ n: 1, loc: yil, yon: 'sag' }] }));
  await s.keyboard.press('Escape');
  await dugme(donem, 'Tümü').click(); await sleep(1500);
  const tablo = s.getByRole('region', { name: 'Yıllara göre' }).or(s.getByLabel('Yıllara göre')).first();
  await dene('s-rapor-tumu', () => cek(s, 's-rapor-tumu', { kirp: [donem, tablo], pay: 20, isaretler: [{ n: 1, loc: dugme(donem, 'Tümü'), yon: 'alt' }, { n: 2, loc: tablo, yon: 'sol' }] }));
  await dugme(donem, '30 gün').click(); await sleep(1500);
  await dugme(s, 'Detaylı göster').click(); await sleep(1500);
  await dene('s-rapor-detay', () => cek(s, 's-rapor-detay', { isaretler: [
    { n: 1, loc: s.getByRole('navigation', { name: 'Rapor bölümleri' }), yon: 'alt' },
    { n: 2, loc: s.getByRole('navigation', { name: 'Rapor sekmeleri' }), yon: 'alt' },
    { n: 3, loc: donem, yon: 'alt' },
  ] }));
  const kdv = kart(s, 'KDV dökümü');
  await kdv.scrollIntoViewIfNeeded(); await sleep(500);
  await dene('s-kdv', () => cek(s, 's-kdv', { kirp: kdv, pay: 12 }));
  await s.evaluate(() => scrollTo(0, 0));
  await dugme(s, 'Yazdır ve paylaş', false).click(); await sleep(300);
  await s.getByRole('menuitem', { name: /^Yazdır \/ PDF/ }).click();
  const yaz = s.getByRole('dialog').first(); await yaz.waitFor(); await sleep(1500);
  await dene('s-rapor-yazdir', () => cek(s, 's-rapor-yazdir', { kirp: yaz, pay: 8, isaretler: [{ n: 1, loc: dugme(yaz, 'Yazdır'), yon: 'ust' }, { n: 2, loc: dugme(yaz, 'PDF indir'), yon: 'ust' }] }));
  await s.keyboard.press('Escape'); await sleep(500);
  await dugme(s, 'Yazdır ve paylaş', false).click(); await sleep(300);
  await s.getByRole('menuitem', { name: /^Muhasebeci için indir/ }).click();
  const muh = s.getByRole('dialog').first(); await muh.waitFor(); await sleep(800);
  await dene('s-muhasebeci', () => cek(s, 's-muhasebeci', { kirp: muh, pay: 8 }));
  await s.keyboard.press('Escape'); await sleep(500);
  const grup = (g: string, r?: string) => async () => {
    await s.getByRole('navigation', { name: 'Rapor bölümleri' }).getByRole('button', { name: g, exact: true }).click();
    if (r) await s.getByRole('navigation', { name: 'Rapor sekmeleri' }).getByRole('button', { name: r, exact: true }).click();
    await sleep(1500);
  };
  await grup('Satış', 'Kârlılık')(); await dene('s-rapor-karlilik', () => cek(s, 's-rapor-karlilik'));
  await ev(s, 'Personel', 'Vardiya ve bahşiş', 'Vardiyalar'); await sleep(1200); await dene('s-rapor-personel', () => cek(s, 's-rapor-personel'));
  await s.context().close();
};

// ---------------------------------------------------------------- Sahip: Ajanda ve rezervasyon, Çalışanlar
const sahipAjanda: Grup = async browser => {
  const s = await sahipSayfasi(browser, { yukseklik: 900 });
  await git(s, 'Ajanda ve rezervasyon');
  // "Not ekle" is on Takvim (Ajanda now opens on Rezervasyonlar): the picture shows the calendar with the three tabs.
  await s.locator('main').getByRole('button', { name: 'Takvim', exact: true }).click().catch(() => {}); await sleep(700);
  await dene('s-ajanda', () => cek(s, 's-ajanda', { isaretler: [
    { n: 1, loc: s.locator('main').getByRole('button', { name: 'Takvim', exact: true }), yon: 'alt' },
    { n: 2, loc: s.locator('main').getByRole('button', { name: 'Rezervasyonlar', exact: true }), yon: 'alt' },
    { n: 3, loc: s.locator('main').getByRole('button', { name: 'Etkinlikler', exact: true }), yon: 'alt' },
    { n: 4, loc: dugme(s, 'Not ekle'), yon: 'sol' },
  ] }));
  await s.locator('main').getByRole('button', { name: 'Rezervasyonlar', exact: true }).click(); await sleep(900);
  const yeni = s.getByRole('button', { name: /Rezervasyon ekle|Yeni rezervasyon|Masa ayır/ }).first();
  if (await yeni.isVisible().catch(() => false)) {
    await yeni.click(); const f = s.getByRole('dialog').or(s.getByRole('form')).first(); await f.waitFor(); await sleep(600);
    await dene('s-rezervasyon-form', () => cek(s, 's-rezervasyon-form', { kirp: f, pay: 8 }));
    await s.keyboard.press('Escape'); await sleep(400);
  }
  await s.locator('main').getByRole('button', { name: 'Etkinlikler', exact: true }).click(); await sleep(900);
  await dene('s-etkinlikler', () => cek(s, 's-etkinlikler'));
  await ev(s, 'Personel', 'Çalışanlar');
  await dene('s-calisanlar', () => cek(s, 's-calisanlar', { isaretler: [
    { n: 1, loc: dugme(s, 'Çalışan ekle'), yon: 'alt' },
    { n: 2, loc: dugme(s, 'Şifreyi yenile'), yon: 'sol' },
  ] }));
  const oturum = kart(s, 'Açık oturumlar');
  await oturum.scrollIntoViewIfNeeded().catch(() => {}); await sleep(400);
  await dene('s-oturumlar', () => cek(s, 's-oturumlar', { kirp: oturum, pay: 10 }));
  await s.context().close();
};

// ---------------------------------------------------------------- Sahip: Ayarlar
const sahipAyarlar: Grup = async (browser, { sahip }) => {
  const s = await sahipSayfasi(browser, { yukseklik: 1000 });
  const konular = () => s.getByRole('navigation', { name: 'Ayarlar konuları' });
  await ayar(s, 'İşletme', 'Görünüm');
  await dene('s-ayarlar', async () => cek(s, 's-ayarlar', { kirp: await ayarAlani(s), isaretler: [
    { n: 1, loc: konular(), yon: 'alt' },
    { n: 2, loc: s.getByRole('navigation', { name: 'İşletme bölümleri' }), yon: 'alt' },
  ] }));
  // Paketiniz kendi sekmesinde (8 Ekim).
  await ayar(s, 'İşletme', 'Paket ve lisans');
  // Kart ekrandan uzun: çekim için pencere uzar.
  await s.setViewportSize({ width: 1280, height: 1500 }); await sleep(500);
  const paket = s.locator('.package-card');
  await paket.scrollIntoViewIfNeeded(); await sleep(400);
  await dene('s-paketiniz', () => cek(s, 's-paketiniz', { kirp: paket, pay: 10, isaretler: [
    { n: 1, loc: paket.getByTestId('package-name'), yon: 'sag' },
    { n: 2, loc: paket.getByTestId('package-status'), yon: 'sol' },
  ] }));
  await s.setViewportSize({ width: 1280, height: 1000 }); await sleep(300);
  await ayar(s, 'İşletme', 'Sosyal medya');
  await dene('s-sosyal', async () => cek(s, 's-sosyal', { kirp: await ayarAlani(s), isaretler: [
    { n: 1, loc: s.getByLabel('Instagram', { exact: true }), yon: 'sag' },
    // "(pakette yok)" follows the name when the sample's package lacks Sosyal medya.
    { n: 2, loc: dugme(s, /^Instagram için QR oluştur/, false), yon: 'sol' },
  ] }));
  // E-posta raporları: Satış ve Raporlar → "Raporları gönder" (10 Ekim) opens a window; it is shot and closed again (the
  // Ayarlar crop measured the topic bar, absent there, and the open window then blocked every later shot of this group).
  // 13 Ekim: under "Yazdır ve paylaş".
  await git(s, 'Satış ve Raporlar'); await dugme(s, 'Yazdır ve paylaş', false).click(); await sleep(300);
  await s.getByRole('menuitem', { name: /^Raporları gönder/ }).click(); await sleep(900);
  const eposta = s.getByRole('dialog').last();
  await dene('s-eposta', async () => cek(s, 's-eposta', { kirp: eposta, pay: 8 }));
  await s.keyboard.press('Escape'); await sleep(400);
  if (await eposta.isVisible().catch(() => false)) await eposta.getByRole('button', { name: /^(Kapat|Vazgeç)$/ }).first().click().catch(() => {});
  await ayar(s, 'Masalar ve QR');
  await dene('s-masalar-qr', async () => cek(s, 's-masalar-qr', { kirp: await ayarAlani(s) }));
  // QR kodlarını yazdır kendi sekmesinde (8 Ekim): üstte yeni kodların taşıyacağı adres tek satır çip.
  await ayar(s, 'Masalar ve QR', 'QR kodlarını yazdır');
  const qrKart = s.locator('.qr-codes-card');
  await qrKart.scrollIntoViewIfNeeded(); await sleep(500);
  await dene('s-qr-kodlari', () => cek(s, 's-qr-kodlari', { kirp: qrKart, pay: 10, isaretler: [
    { n: 1, loc: qrKart.locator('.qr-print-address .settings-chip'), yon: 'alt' },
    { n: 2, loc: qrKart.getByText(/A6 masa standı/).first(), yon: 'alt' },
    { n: 3, loc: dugme(qrKart, 'Yazdır'), yon: 'sag' },
  ] }));
  const a6 = qrKart.getByText(/A6 masa standı/).first();
  await a6.click().catch(() => {}); await sleep(1200);
  // A6 masa standı kartları, A4'e 4'lü (kesim çizgili): yazdırma görünümünden, örnek işletmenin kendi adıyla.
  await dene('k-qr-a6-sayfa', async () => {
    await s.evaluate(() => { window.print = () => {}; });
    await qrKart.getByRole('button', { name: "A4'e 4'lü (kesim çizgili)" }).click().catch(() => {});
    await qrKart.getByRole('button', { name: 'Yazdır', exact: true }).click();
    const sayfa = s.locator('[data-testid="qr-print-sheet"][data-sheet="a6"] .qr-stand-page').first();
    await sayfa.waitFor({ state: 'attached', timeout: 30000 });
    await s.emulateMedia({ media: 'print' }); await sleep(1000);
    try { await hazirGoruntu('k-qr-a6-sayfa', await sayfa.screenshot()); } finally { await s.emulateMedia({ media: 'screen' }); }
    await s.evaluate(() => dispatchEvent(new Event('afterprint'))); await sleep(500);
  });
  await ayar(s, 'Cihazlar', 'Yazıcılar');
  await dene('s-yazicilar', async () => cek(s, 's-yazicilar', { kirp: await ayarAlani(s) }));
  await ayar(s, 'Cihazlar', 'Sesler');
  await ayar(s, 'Sipariş ve mutfak', 'Sipariş ve onay');
  await dene('s-siparis-onay', async () => cek(s, 's-siparis-onay', { kirp: await ayarAlani(s) }));
  await ayar(s, 'Sipariş ve mutfak', 'Mutfak');
  const km = s.locator('.kitchen-mode-option').first().locator('xpath=ancestor::*[contains(@class,\"card\")][1]');
  if (await km.count()) { await km.scrollIntoViewIfNeeded(); await sleep(400); await dene('s-mutfak-modu', () => cek(s, 's-mutfak-modu', { kirp: km, pay: 8, isaretler: [{ n: 1, loc: s.locator('.kitchen-mode-option').nth(0), yon: 'ust' }, { n: 2, loc: s.locator('.kitchen-mode-option').nth(1), yon: 'ust' }] })); }
  await ev(s, 'Kasa ve giderler', 'Kasa ayarları', 'Gün sonu');
  await dene('s-kasa-odeme', async () => cek(s, 's-kasa-odeme'));
  // Kasa güvenliği (14 Ekim): the switches as they come (all off), never changed by the pictures.
  await ev(s, 'Kasa ve giderler', 'Kasa ayarları', 'Kasa güvenliği'); await sleep(800);
  await dene('s-kasa-guvenligi', async () => cek(s, 's-kasa-guvenligi', { isaretler: [{ n: 1, loc: s.getByRole('button', { name: 'Önerilenleri aç' }), yon: 'alt' }] }));
  await ev(s, 'Personel', 'Personel ayarları', 'Vardiya');
  await dene('s-vardiya-bahsis', async () => cek(s, 's-vardiya-bahsis'));
  await ev(s, 'Kasa ve giderler', 'Giderler', 'Otomatik giderler');
  await dene('s-giderler-kar', async () => cek(s, 's-giderler-kar'));
  await ev(s, 'Menü yönetimi', 'KDV oranları');
  const kdvO = s.locator('.vat-card').first();
  await kdvO.scrollIntoViewIfNeeded().catch(() => {}); await sleep(400);
  await dene('s-kdv-oranlari', () => cek(s, 's-kdv-oranlari', { kirp: kdvO, pay: 10 }));
  await sahip.post('/api/staff/lock/settings', { data: { minutes: 10 } });
  await ayar(s, 'Güvenlik ve yedek', 'Kilit ve güncelleme');
  await sleep(800);
  await dene('s-guvenlik', async () => cek(s, 's-guvenlik', { kirp: await ayarAlani(s), isaretler: [{ n: 1, loc: s.locator('.owner-lock-settings'), yon: 'sol' }] }));
  await ayar(s, 'Uzaktan erişim');
  const uz = s.locator('.remote-admin-settings');
  if (await uz.count()) { await uz.scrollIntoViewIfNeeded(); await sleep(400); await dene('s-uzaktan-yonetim', () => cek(s, 's-uzaktan-yonetim', { kirp: uz, pay: 10 })); }
  await s.evaluate(() => scrollTo(0, document.body.scrollHeight)); await sleep(400);
  await sahip.post('/api/staff/lock/settings', { data: { minutes: 0 } });
  await ayar(s, 'Cihazlar', 'Cihaz bağla');
  await dene('s-cihazlar', async () => cek(s, 's-cihazlar', { kirp: await ayarAlani(s) }));
  await ayar(s, 'Sipariş ve mutfak', 'Paket platformları');
  await s.context().close();
};

// ---------------------------------------------------------------- Sahip: Destek, uzaktan erişim, Raporlarım
const sahipDestek: Grup = async browser => {
  const s = await sahipSayfasi(browser, { yukseklik: 900 });
  await git(s, 'Destek');
  await dene('s-destek', () => cek(s, 's-destek', { isaretler: [
    { n: 1, loc: s.getByRole('tab', { name: /Talepler/ }), yon: 'alt' },
    { n: 2, loc: s.getByRole('tab', { name: /Duyurular/ }), yon: 'alt' },
    { n: 3, loc: s.getByRole('tab', { name: /Uzaktan erişim/ }), yon: 'alt' },
  ] }));
  // Bildirimler: the bell on the top bar (10 Ekim).
  await s.locator('header.topbar').getByRole('button', { name: /^Bildirimler/ }).click(); await sleep(900);
  await dene('s-bildirimler', () => cek(s, 's-bildirimler'));
  await git(s, 'Destek');
  await s.getByRole('tab', { name: /Uzaktan erişim/ }).click(); await sleep(900);
  await dene('s-uzaktan-erisim', () => cek(s, 's-uzaktan-erisim'));
  // Raporlarım (0.1.22): kasada telefon kodu ve e-posta (Ayarlar → Uzaktan erişim), sonra telefon tek adresten girer. Kod
  // API'den kurulur; e-posta Mola Merkez'in sahte SMTP'ye gönderdiği kodla doğrulanır (çekimden sonra Merkez'in e-postası
  // yeniden kapatılır); çekimden sonra telefon kodu kurtarma koduyla kapatılır (sonraki çekimlerde raporlar kod sormaz).
  const kurulum = await (await s.request.post(`${KAFE}/api/staff/report-security/setup`, { data: { password: 'MolaDemo!2026' } })).json() as { secret: string };
  const acildi = await (await s.request.post(`${KAFE}/api/staff/report-security/enable`, { data: { code: totp(kurulum.secret, Date.now() - 30_000) } })).json() as { recoveryCodes: string[] };
  const EPOSTA = 'serkan@ornekkafe.com', smtp = await fakeSmtp('kullanilmaz'), yonetim = await adminApi();
  const posta = (enabled: boolean) => yonetim.post(`${MERKEZ}/api/merkez/admin/email`, { data: { enabled, host: enabled ? '127.0.0.1' : 'smtp.gmail.com', port: enabled ? smtp.port : 465, security: enabled ? 'none' : 'tls', user: '', to: 'bildirim@ornekkafe.com', from: enabled ? 'mola@ornekkafe.com' : '' } });
  await posta(true);
  const gonderildi = await (await s.request.post(`${KAFE}/api/staff/owner-email/new-code`, { data: { email: EPOSTA, password: 'MolaDemo!2026' } })).json() as { ticket: string };
  const gelen = () => smtp.received.filter(m => m.to.some(t => t.includes(EPOSTA)));
  for (let i = 0; !gelen().length && i < 150; i++) await sleep(100);
  const ekod = /\b(\d{6})\b/.exec(decodeParts(gelen().at(-1)!.data).find(p => !p.name)?.text ?? '')![1];
  await s.request.post(`${KAFE}/api/staff/owner-email/confirm`, { data: { ticket: gonderildi.ticket, code: ekod } });
  await posta(false); await yonetim.dispose(); await smtp.close();
  await ayar(s, 'Uzaktan erişim');
  const card = s.locator('.remote-access');
  await s.locator('.remote-address').waitFor({ timeout: 20_000 });
  await sleep(600);
  await dene('s-cihaz-baglayin', () => cek(s, 's-cihaz-baglayin', { kirp: card, pay: 10, isaretler: [{ n: 1, loc: s.locator('.remote-address'), yon: 'alt' }] }));
  const tel = await yeniSayfa(browser, 'telefon', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await tel.context().route(`${KAFE}/**`, r => r.abort());
  // Mola Merkez lets a new device in once the café's heartbeat brought its key (a few seconds).
  for (let i = 0; i < 20; i++) { if ((await fetch(`${MERKEZ}/api/merkez/v1/phone/login/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EPOSTA }) })).status === 200) break; await sleep(2000); }
  await tel.goto(`${MERKEZ}/raporlarim`);
  const giris = tel.getByRole('form', { name: 'Giriş yap' });
  await giris.getByLabel('E-posta').fill(EPOSTA);
  await giris.getByLabel('Şifre', { exact: true }).fill('MolaDemo!2026');
  await giris.getByLabel('Telefon kodu').fill(totp(kurulum.secret, Date.now()));
  await giris.getByLabel('Bu cihazın adı').fill('Serkan’ın telefonu');
  await dene('t-raporlarim-giris', () => cek(tel, 't-raporlarim-giris', { isaretler: [{ n: 1, loc: giris.getByLabel('E-posta'), yon: 'alt' }] }));
  await dugme(giris, 'Giriş yap').click();
  await tel.getByRole('region', { name: 'Bugünün satışı' }).waitFor({ timeout: 30000 });
  await sleep(800);
  await dene('t-raporlarim', () => cek(tel, 't-raporlarim', { isaretler: [{ n: 1, loc: tel.getByRole('region', { name: 'Bugünün satışı' }), yon: 'alt' }] }));
  await tel.evaluate(() => scrollTo(0, 700)); await sleep(400);
  await dene('t-raporlarim-2', () => cek(tel, 't-raporlarim-2'));
  await s.request.post(`${KAFE}/api/staff/report-security/recover`, { data: { password: 'MolaDemo!2026', recoveryCode: acildi.recoveryCodes[0] } });
  await tel.context().close();
  await s.context().close();
};

// ---------------------------------------------------------------- Sahip: kilit, kasa bilgisayarı penceresi (şerit, yedek, iki ekran)
const sahipMasaustu: Grup = async browser => {
  const s = await sahipSayfasi(browser, { yukseklik: 860 });
  await s.request.post(`${KAFE}/api/staff/lock`, { data: {} });
  const kilit = s.getByRole('dialog', { name: 'Sahip hesabı kilitlendi' });
  await kilit.waitFor({ timeout: 20000 }); await sleep(500);
  await dene('s-kilit', () => cek(s, 's-kilit', { kirp: s.locator('.owner-lock-card'), pay: 30, isaretler: [{ n: 1, loc: kilit.getByLabel(/Şifre/).first(), yon: 'sag' }, { n: 2, loc: dugme(kilit, 'Kilidi aç'), yon: 'sag' }] }));
  await kilit.getByLabel(/Şifre/).first().fill('MolaDemo!2026');
  await dugme(kilit, 'Kilidi aç').click();
  await sleep(800);
  await s.context().close();
  const w = await yeniSayfa(browser, 'masaustu', { yukseklik: 860 });
  await giris(w, 'kasiyer', `/#masaustu=${masaustuAnahtari()}`);
  await sesiAc(w);
  // İlk açılışta kasa bilgisayarı kurtarma kodunu bir kez gösterir.
  const kod = w.getByRole('dialog', { name: 'Kurtarma kodunuz' });
  if (await kod.isVisible({ timeout: 4000 }).catch(() => false)) {
    await dene('d-kurtarma-kodu', () => cek(w, 'd-kurtarma-kodu', { kirp: kod, pay: 10, isaretler: [{ n: 1, loc: kod.locator('code, pre, .recovery-code, [class*=code]').first(), yon: 'sol' }, { n: 2, loc: dugme(kod, 'Yazdır'), yon: 'alt' }, { n: 3, loc: dugme(kod, /Kaydettim/, false), yon: 'alt' }] }));
    await dugme(kod, 'Sonra kaydedeceğim').click(); await sleep(600);
  }
  const rail = w.locator('.desktop-rail, nav[aria-label*="şerit" i], aside').first();
  if (process.env.KILAVUZ_DEBUG) console.log('şerit:', await w.locator('button').evaluateAll(l => l.filter(b => b.getBoundingClientRect().x < 80).map(b => (b as HTMLElement).innerText + '|' + b.getAttribute('aria-label'))));
  await dene('d-serit', () => cek(w, 'd-serit', { kirp: 'ekran', isaretler: [{ n: 1, loc: rail, yon: 'sag' }] }));
  const yedekle = w.getByRole('button', { name: /^Yedekle/ }).first();
  if (await yedekle.isVisible().catch(() => false)) {
    await yedekle.click(); await sleep(1200);
    const yd = w.getByRole('dialog', { name: 'Yedekle' });
    const simdi = dugme(yd, /Şimdi yedekle/, false);
    if (await simdi.isVisible().catch(() => false)) { await simdi.click(); await yd.getByText(/Son yedek/).first().waitFor({ timeout: 60000 }).catch(() => {}); await sleep(1500); }
    const sakl = yd.getByRole('button', { name: /Saklanan yedekler/ }).first();
    if (await sakl.isVisible().catch(() => false)) { await sakl.click(); await sleep(800); }
    await dene('d-yedekle', () => cek(w, 'd-yedekle', { kirp: yd, pay: 10 }));
    await w.keyboard.press('Escape'); await sleep(500);
  }
  const bol = w.getByRole('button', { name: /İkiye böl/ }).first();
  if (await bol.isVisible().catch(() => false)) { await bol.click(); await sleep(3000); await dene('d-iki-ekran', () => cek(w, 'd-iki-ekran')); }
  await w.context().close();
};

// ---------------------------------------------------------------- Paket ve önemli duyuru (Mola Yönetim'den sonra)
const sahipPaket: Grup = async (browser, { durum }) => {
  // Mola Yönetim işletmeyi "Kafe Standart"a geçirdi: yeni lisans kalp atışıyla gelir.
  for (let i = 0; i < 60; i++) { if ((await durum()).pkg?.name === 'Kafe Standart') break; await sleep(1000); }
  const s = await yeniSayfa(browser, 'masaustu', { yukseklik: 900 });
  await giris(s, 'isletme');
  // Lisans sözleşmesi (yalnız bu grup tek başına çalışınca açık kalır; sahip-masalar kabul eder) duyurunun üstünde açılır.
  const kabul = s.getByRole('button', { name: 'Okudum, kabul ediyorum' });
  if (await kabul.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) { await kabul.click(); await sleep(800); }
  const duyuru = s.getByRole('dialog', { name: 'Mola ekibinden önemli duyuru' });
  if (await duyuru.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false)) {
    await sleep(500);
    await dene('s-onemli-duyuru', () => cek(s, 's-onemli-duyuru', { kirp: duyuru, pay: 20, isaretler: [
      { n: 1, loc: dugme(duyuru, 'Okudum'), yon: 'ust' }, { n: 2, loc: dugme(duyuru, 'Daha sonra'), yon: 'ust' },
    ] }));
    await dugme(duyuru, 'Daha sonra').click(); await sleep(500);
  }
  await sesiAc(s);
  await git(s, 'Destek');
  await s.getByRole('tab', { name: /Duyurular/ }).click(); await sleep(900);
  await dene('s-duyurular', () => cek(s, 's-duyurular'));
  await s.getByRole('tab', { name: /Talepler/ }).click(); await sleep(900);
  await dene('s-talepler', () => cek(s, 's-talepler'));
  // "Yeni talep" formu açar (8 Ekim: form kendiliğinden açık değil); "Vazgeç" listeye döner.
  await dene('s-yeni-talep', async () => {
    await s.locator('.tc-list').getByRole('button', { name: 'Yeni talep', exact: true }).click(); await sleep(600);
    const f = s.getByRole('form', { name: 'Yeni destek talebi' });
    await f.getByLabel('Konu', { exact: false }).fill('Mutfak fişi çıkmıyor');
    await f.getByLabel('Sorunu anlatın', { exact: false }).fill('Kasa fişi çıkıyor, mutfak yazıcısından fiş gelmiyor. Yazıcının ışığı yanıyor.');
    await cek(s, 's-yeni-talep', { isaretler: [{ n: 1, loc: s.locator('.tc-list').getByRole('button', { name: 'Yeni talep', exact: true }), yon: 'alt' }, { n: 2, loc: f.getByLabel('Konu', { exact: false }), yon: 'ust' }, { n: 3, loc: dugme(s, 'Destek talebi aç'), yon: 'ust' }] });
    await dugme(f, 'Vazgeç').click(); await sleep(400);
  });
  // Kilitli hizmet: Kafe Standart paketinde olmayanlar soluk ve "Pakette yok".
  await git(s, 'Ajanda ve rezervasyon');
  const rez = s.locator('main').getByRole('button', { name: /^Rezervasyonlar/ }).first();
  if (await rez.isVisible().catch(() => false)) {
    await dene('s-kilitli-menu', () => cek(s, 's-kilitli-menu', { kirp: s.locator('main').getByRole('navigation').first(), pay: 16, isaretler: [{ n: 1, loc: rez, yon: 'alt' }] }));
    await rez.click(); await sleep(1000);
    const lock = s.locator('.feature-lock').first();
    await dene('s-kilitli-hizmet', () => cek(s, 's-kilitli-hizmet', { kirp: [s.locator('main').getByRole('navigation').first(), lock.locator('.feature-lock-card, [class*=card]').first()], pay: 30, isaretler: [
      { n: 1, loc: lock.getByRole('heading', { name: 'Bu hizmet paketinizde yok' }), yon: 'ust' },
      { n: 2, loc: dugme(lock, 'Mola ekibine yaz'), yon: 'ust' },
    ] }));
    await ayar(s, 'İşletme', 'Paket ve lisans');
    await s.setViewportSize({ width: 1280, height: 1500 }); await sleep(500);
    const paket = s.locator('.package-card'); await paket.scrollIntoViewIfNeeded(); await sleep(400);
    await dene('s-paket-kafe-standart', () => cek(s, 's-paket-kafe-standart', { kirp: paket, pay: 10, isaretler: [
      { n: 1, loc: paket.getByRole('list', { name: 'Paketteki hizmetler' }), yon: 'sol' },
      { n: 2, loc: paket.getByRole('list', { name: 'Pakette olmayan hizmetler' }), yon: 'sol' },
    ] }));
  }
  await s.context().close();
};

// ---------------------------------------------------------------- Gün sonu (en son: kasa günü kapanır)
const gunSonu: Grup = async (browser, { api, ok }) => {
  // Z raporu karşılaştırması yalnız yazar kasa yardımcısı açıkken çıkar (ilk hâli kapalı; bu grup tek başına da çalışır).
  await ok(await (await api('isletme')).post('/api/staff/cash/settings', { data: { fiscalHelper: true } }), 'yazar kasa yardımcısı');
  const k = await yeniSayfa(browser, 'masaustu', { yukseklik: 900 });
  await giris(k, 'kasiyer'); await sesiAc(k);
  // The "Girildi işaretlenmemiş" list shows only once the café uses "Girildi" that day: one of today's payments is marked first.
  try {
    const list = await (await k.request.get('/api/staff/refunds/payments')).json() as { rows?: { id: string }[] };
    if (list.rows?.[0]) await k.request.post('/api/staff/fiscal/mark', { data: { paymentId: list.rows[0].id } });
  } catch { /* the figure then falls back to the old picture */ }
  await k.locator('.cash-chip').click();
  await dugme(k.getByRole('group', { name: 'Kasa işlemleri' }), 'Gün sonu').click();
  const d = k.getByRole('dialog').first(); await d.waitFor(); await sleep(600);
  await dene('c-gun-sonu', () => cek(k, 'c-gun-sonu', { kirp: d, pay: 10 }));
  await dugme(d, 'Tek toplam').click().catch(() => {});
  await d.getByLabel('Kasadaki nakit toplamı').fill('850').catch(() => {});
  await dugme(d, 'Sayımı kaydet').click();
  await sleep(1200);
  const z = d.getByRole('region', { name: 'Yazar kasa karşılaştırması' });
  if (await z.isVisible().catch(() => false)) { await z.getByLabel('Z raporu toplamı').fill('560').catch(() => {}); }
  await sleep(500);
  await dene('c-gun-sonu-sonuc', () => cek(k, 'c-gun-sonu-sonuc', { kirp: d, pay: 10, isaretler: [{ n: 1, loc: d.getByText(/Sayılan/).first(), yon: 'alt' }, { n: 2, loc: d.getByLabel(/Z raporu toplamı/).first(), yon: 'ust' }] }));
  // Kapanışı tamamla: QR siparişleri gün sonundan sonra durur; sol menünün üstündeki kart (10 Ekim) "QR siparişleri kapalı ·
  // Gün sonu yapıldı" ve "Siparişleri aç" der, Masalar'ın üstünde ince sarı şerit çıkar.
  await dene('c-qr-durumu', async () => {
    const not = d.getByLabel('Kapanış notu');
    if (await not.isVisible().catch(() => false)) await not.fill('Örnek gün sonu').catch(() => {});
    await dugme(d, 'Kapanışı tamamla').click(); await sleep(1500);
    for (const ad of ['Tamam', 'Kapat']) { const b = k.getByRole('dialog').first().getByRole('button', { name: ad, exact: true }); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; } }
    await k.keyboard.press('Escape').catch(() => {}); await sleep(1200);
    const kart = k.getByTestId('qr-ordering-card'), serit = k.getByTestId('qr-ordering-bar');
    await k.waitForFunction(() => document.querySelector('[data-testid="qr-ordering-card"]')?.getAttribute('data-reason') === 'closing', null, { timeout: 15000 });
    await cek(k, 'c-qr-durumu', { kirp: [k.locator('.sidebar .business-pill'), kart, serit], pay: 10, isaretler: [{ n: 1, loc: kart, yon: 'alt' }, { n: 2, loc: k.getByTestId('qr-ordering-open'), yon: 'alt' }, { n: 3, loc: serit, yon: 'alt' }] });
    await k.getByTestId('qr-ordering-open').click(); await sleep(800);
  });
  await k.context().close();
};

// ---------------------------------------------------------------- 10 Ekim düzeni: evler ve sekmeler (kullanim.ts "yeni-duzen-*" şekilleri)
// 10 Ekim son kullanıcı testi: the manual named these five figures but nothing shot them ("görüntü yok, şekil atlandı").
const yeniDuzen: Grup = async browser => {
  const s = await sahipSayfasi(browser, { yukseklik: 860 });
  await ev(s, 'Kasa ve giderler', 'Giderler', 'Kayıtlar'); await sleep(1200);
  await dene('yeni-duzen-sahip-masaustu', () => cek(s, 'yeni-duzen-sahip-masaustu', { kirp: 'ekran', isaretler: [
    { n: 1, loc: s.locator('.sidebar nav'), yon: 'sag' },
    { n: 2, loc: s.getByRole('navigation', { name: 'Kasa ve giderler bölümleri', exact: true }), yon: 'alt' },
    { n: 3, loc: s.getByRole('navigation', { name: 'Giderler bölümleri', exact: true }), yon: 'alt' },
    { n: 4, loc: s.locator('header.topbar').getByRole('button', { name: /^Bildirimler/ }), yon: 'sol' },
  ] }));
  await ev(s, 'Kasa ve giderler', 'Kasa ayarları', 'Gün sonu'); await sleep(800);
  await dene('yeni-duzen-kasa-ayarlari', () => cek(s, 'yeni-duzen-kasa-ayarlari', { isaretler: [{ n: 1, loc: s.getByRole('navigation', { name: 'Kasa ayarları bölümleri', exact: true }), yon: 'alt' }] }));
  await ev(s, 'Personel', 'Personel ayarları', 'Vardiya'); await sleep(800);
  await dene('yeni-duzen-personel', () => cek(s, 'yeni-duzen-personel', { isaretler: [
    { n: 1, loc: s.getByRole('navigation', { name: 'Personel bölümleri', exact: true }), yon: 'alt' },
    { n: 2, loc: s.getByRole('navigation', { name: 'Personel ayarları bölümleri', exact: true }), yon: 'alt' },
  ] }));
  await ayar(s, 'Güvenlik ve yedek', 'Kilit ve güncelleme');
  await dene('yeni-duzen-ayarlar', () => cek(s, 'yeni-duzen-ayarlar', { isaretler: [
    { n: 1, loc: s.getByRole('navigation', { name: 'Ayarlar konuları' }), yon: 'alt' },
    { n: 2, loc: s.getByRole('navigation', { name: 'Güvenlik ve yedek bölümleri', exact: true }), yon: 'alt' },
  ] }));
  await s.context().close();
  const k = await yeniSayfa(browser, 'masaustu', { yukseklik: 860 });
  await giris(k, 'kasiyer'); await sesiAc(k);
  await git(k, 'Kasa');
  await dene('yeni-duzen-kasiyer', () => cek(k, 'yeni-duzen-kasiyer', { kirp: 'ekran', isaretler: [
    { n: 1, loc: k.locator('.sidebar nav').getByRole('button', { name: 'Kasa', exact: true }), yon: 'sag' },
    { n: 2, loc: k.locator('.cash-today .cash-day, .cash-today').first(), yon: 'ust' },
  ] }));
  await k.context().close();
};

export const gruplarSahip: Record<string, Grup> = {
  garson, kasiyer, mutfak, mudur, 'sahip-masalar': sahipMasalar, 'sahip-menu': sahipMenu, 'sahip-stok': sahipStok, 'sahip-rapor': sahipRapor,
  'sahip-ajanda': sahipAjanda, 'sahip-ayarlar': sahipAyarlar, 'sahip-destek': sahipDestek, 'sahip-masaustu': sahipMasaustu, 'yeni-duzen': yeniDuzen,
};
export const gruplarSon: Record<string, Grup> = { 'sahip-paket': sahipPaket, 'gun-sonu': gunSonu };
void ({} as Hedef);
