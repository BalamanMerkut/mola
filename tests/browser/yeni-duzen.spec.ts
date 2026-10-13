import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bell, bottomNav, ensureSetup, openCash, openMenu, openSettings, openStaff, openView, reportGroups, settingsTopics } from './helpers';

/*
 * 10 Ekim düzeni (docs/BILGI_MIMARISI_ONERISI.md): every topic has one home with its daily work, record book and settings
 * in tabs (level 1 icon tabs, level 2 the quieter sub-tabs; never more), the owner-only settings tab last. Per role: the
 * owner's grouped sidebar (GÜNLÜK / İŞLETME), the bell, Kasa ve giderler, Personel, Menü yönetimi with Kampanyalar and KDV,
 * Ayarlar' five topics, the "Taşındı → Git" signposts and the remembered places of the earlier layout; the owner's phone bar;
 * the Müdür (Kasa without Kasa ayarları, Personel with Vardiya ve bahşiş only, no Ayarlar); the cashier's Kasa (Bugün only).
 * KAFE_EKRAN=docs/ekran/kafe saves the documentation screens yeni-duzen-*.png.
 */
const PASSWORD = 'MolaDemo!2026', MANAGER_PASSWORD = 'MudurDeneme!2026';
async function shot(page: Page, file: string, path: string, fullPage = false) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
async function signedIn(browser: Browser, username: string, password = PASSWORD, viewport = { width: 1366, height: 900 }, storage?: Record<string, string>) {
  const context = await browser.newContext({ viewport, locale: 'tr-TR', ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password } })).ok()).toBe(true);
  await ensureSetup(page.request);
  if (storage) await context.addInitScript(values => { for (const [k, v] of Object.entries(values)) if (!sessionStorage.getItem(`seeded:${k}`)) { localStorage.setItem(k, v); sessionStorage.setItem(`seeded:${k}`, '1'); } }, storage);
  await page.goto('/');
  return page;
}
test.describe.configure({ timeout: 120_000 });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test('owner: grouped menu, the bell, Kasa ve giderler (two tab levels), Personel, Menü, five Ayarlar topics, signposts', async ({ browser }, info) => {
  // The earlier layout remembered on this device: Ayarlar → Giderler ve kâr, Satış ve Raporlar → Para → Giderler.
  const page = await signedIn(browser, 'isletme', PASSWORD, { width: 1366, height: 900 }, { 'mola-settings-topic': 'expenses', 'mola-report-place': JSON.stringify({ tab: 'expenses', last: { money: 'corrections', people: 'staff' } }), 'mola-report-view': 'detail' });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const nav = page.locator('.sidebar nav');
  await expect(nav.locator('.nav-group-label')).toHaveText(['GÜNLÜK', 'İŞLETME']);
  await expect(nav.getByRole('button')).toHaveText(['Masalar', 'Sipariş al', 'Kasa ve giderler', 'Ajanda ve rezervasyon', 'Menü yönetimi', 'Stok', 'Personel', 'Satış ve Raporlar', 'Ayarlar', 'Hesabım'].map(n => new RegExp(`^${n}`)));
  for (const gone of ['Kampanyalar', 'Çalışanlar']) await expect(nav.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
  await expect(bell(page)).toBeVisible();
  // QR siparişleri (10 Ekim): a card at the top of the sidebar under the business card, no chip on the top bar.
  await expect(page.locator('.sidebar').getByTestId('qr-ordering-card')).toContainText('QR siparişleri açık');
  await expect(page.locator('header.topbar').getByText(/QR siparişleri/)).toHaveCount(0);
  // The cash strip on Masalar now has the owner's "Gider kaydet" too.
  await expect(page.locator('.cash-strip, .cash-day').first()).toBeVisible();

  // Kasa ve giderler: Bugün · Giderler · Kapanışlar · İadeler · Kasa ayarları; Giderler → Kayıtlar · Otomatik giderler.
  await openCash(page);
  const tabs = page.getByRole('navigation', { name: 'Kasa ve giderler bölümleri', exact: true });
  await expect(tabs.getByRole('button')).toHaveText(['Bugün', 'Giderler', 'Kapanışlar', 'İadeler', 'Kasa ayarları']);
  await openCash(page, 'Bugün');
  await expect(page.locator('.cash-today .cash-strip').getByRole('button', { name: 'Gider kaydet', exact: true })).toBeVisible();
  await openCash(page, 'Giderler', 'Kayıtlar');
  await expect(page.getByRole('heading', { name: /Gider kayıtları/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yazdır ve paylaş' })).toBeVisible();
  await shot(page, 'yeni-duzen-sahip-masaustu.png', info.outputPath('sahip-masaustu.png'));
  await page.getByRole('button', { name: 'Otomatik giderleri yönet' }).click();
  await expect(page.getByRole('navigation', { name: 'Giderler bölümleri', exact: true }).getByRole('button', { name: /^Otomatik giderler/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Otomatik giderler' })).toBeVisible();
  await openCash(page, 'Kapanışlar');
  await expect(page.getByRole('group', { name: 'Dönem' })).toBeVisible();
  await openCash(page, 'İadeler');
  await expect(page.getByRole('heading', { name: 'İade ve düzeltme' })).toBeVisible();
  await openCash(page, 'Kasa ayarları', 'Kasiyer yetkileri');
  await expect(page.getByLabel('Tek seferde (TL)', { exact: true })).toBeVisible();
  await openCash(page, 'Kasa ayarları', 'Kart ve yazar kasa');
  await expect(page.getByLabel('POS komisyon oranı (%)', { exact: true })).toBeVisible();
  await openCash(page, 'Kasa ayarları', 'Gün sonu');
  await expect(page.getByLabel('Kapanış saati', { exact: true })).toBeVisible();
  await shot(page, 'yeni-duzen-kasa-ayarlari.png', info.outputPath('kasa-ayarlari.png'));

  // Personel: Çalışanlar · Vardiya ve bahşiş (Vardiyalar · Bahşiş) · Personel ayarları (Vardiya · Bahşiş · Garson ataması).
  await openStaff(page, 'Çalışanlar');
  await expect(page.getByRole('heading', { name: 'Çalışan hesapları' })).toBeVisible();
  await openStaff(page, 'Vardiya ve bahşiş', 'Bahşiş');
  await expect(page.getByRole('region', { name: 'Bahşiş payları' })).toBeVisible();
  await openStaff(page, 'Personel ayarları', 'Garson ataması');
  await expect(page.getByRole('navigation', { name: 'Personel ayarları bölümleri', exact: true }).getByRole('button')).toHaveText(['Vardiya', 'Bahşiş', 'Garson ataması']);
  await shot(page, 'yeni-duzen-personel.png', info.outputPath('personel.png'));

  // Menü yönetimi: Ürünler · Kampanyalar · KDV oranları.
  await openMenu(page, 'KDV oranları');
  await expect(page.getByRole('heading', { name: 'KDV oranları' })).toBeVisible();
  await openMenu(page, 'Kampanyalar');
  await expect(page.getByRole('button', { name: 'Kampanya ekle' })).toBeVisible();

  // Ayarlar: five topics; the remembered "Giderler ve kâr" landed on İşletme without an error; no "Taşınan ayarlar" (13 Ekim).
  await openView(page, 'Ayarlar');
  await expect(settingsTopics(page).getByRole('button')).toHaveText(['İşletme', 'Masalar ve QR', 'Sipariş ve mutfak', 'Cihazlar', 'Güvenlik ve yedek'].map(n => new RegExp(`^${n}`)));
  await expect(settingsTopics(page).getByRole('button', { name: /^İşletme/ })).toHaveAttribute('aria-current', 'page');
  await openSettings(page, 'Telefonum');
  await expect(page.locator('summary').getByText('Raporlar için telefon kodu', { exact: true })).toBeVisible();
  await shot(page, 'yeni-duzen-ayarlar.png', info.outputPath('ayarlar.png'));
  await expect(page.getByText('Taşınan ayarlar')).toHaveCount(0);

  // Satış ve Raporlar: the remembered "Giderler" report (the old Para group) opens Özet; no signpost.
  await openView(page, 'Satış ve Raporlar');
  await expect(page.getByRole('region', { name: 'Para taşındı' })).toHaveCount(0);
  await expect(reportGroups(page).getByRole('button', { name: 'Para', exact: true })).toHaveCount(0);

  // Destek: only talking to Mola; Bildirimler is the bell.
  await openView(page, 'Destek');
  await expect(page.getByRole('tablist', { name: 'Destek bölümleri' }).getByRole('tab')).toHaveText(['Talepler', 'Duyurular', 'Uzaktan erişim']);
  await expect(page.getByRole('button', { name: /^Bildirimler: üst çubuktaki zil/ })).toHaveCount(0);
  await bell(page).click();
  await expect(page.getByRole('region', { name: 'Bildirimler' })).toBeVisible();
  await expect(bell(page)).toHaveAttribute('aria-current', 'page');
  expect(errors).toEqual([]);
  await page.context().close();
});

test('owner phone: Masalar · Sipariş al · Kasa · Raporlar, the bell on the slim bar, no sideways scroll', async ({ browser }, info) => {
  const page = await signedIn(browser, 'isletme', PASSWORD, { width: 390, height: 844 });
  await expect(bottomNav(page).getByRole('button')).toHaveText(['Masalar', 'Sipariş al', 'Kasa ve giderler', 'Satış ve Raporlar', /^Daha fazla/].map(n => typeof n === 'string' ? new RegExp(`^${n}`) : n));
  await expect(bell(page)).toBeVisible();
  // No sidebar on the phone: QR siparişleri is one slim line under the top bar, with "Durdur" for the owner.
  await expect(page.getByTestId('qr-ordering-bar')).toContainText('QR siparişleri açık');
  await expect(page.getByTestId('qr-ordering-bar').getByRole('button', { name: 'QR siparişlerini durdur' })).toBeVisible();
  await expect(page.getByTestId('qr-ordering-card')).toHaveCount(0);
  await openCash(page, 'Giderler');
  await expect(page.getByRole('heading', { name: /Gider kayıtları/ })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, 'yeni-duzen-sahip-telefon.png', info.outputPath('sahip-telefon.png'));
  await bottomNav(page).getByRole('button', { name: /^Daha fazla/ }).click();
  const more = page.getByRole('dialog', { name: 'Daha fazla' });
  for (const name of ['Ajanda ve rezervasyon', 'Menü yönetimi', 'Stok', 'Personel', 'Ayarlar', 'Destek', 'Hesabım']) await expect(more.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
  await page.context().close();
});

test('Müdür and cashier: Kasa without settings and blind closings, Personel only Vardiya ve bahşiş, the cashier\'s Kasa is Bugün', async ({ browser, page }, info) => {
  expect((await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
  await ensureSetup(page.request);
  const made = await page.request.post('/api/staff/users', { data: { name: 'Deniz Müdür', username: 'deniz.mudur', password: MANAGER_PASSWORD, role: 'manager' } });
  expect(made.ok(), await made.text()).toBe(true);

  const manager = await signedIn(browser, 'deniz.mudur', MANAGER_PASSWORD);
  const nav = manager.locator('.sidebar nav');
  await expect(nav.getByRole('button')).toHaveText(['Masalar', 'Sipariş al', 'Kasa ve giderler', 'Ajanda ve rezervasyon', 'Menü yönetimi', 'Stok', 'Personel', 'Satış ve Raporlar', 'Duyurular', 'Hesabım'].map(n => new RegExp(`^${n}`)));
  // 10 Ekim: the Müdür has the bell too, for campaign notifications only (cash, licence and backup ones stay owner-only).
  await expect(manager.locator('header.topbar').getByRole('button', { name: /^Bildirimler/ })).toHaveCount(1);
  // The Müdür may stop QR siparişleri too: the card has "Durdur".
  await expect(manager.getByTestId('qr-ordering-card').getByRole('button', { name: 'QR siparişlerini durdur' })).toBeVisible();
  await openCash(manager);
  await expect(manager.getByRole('navigation', { name: 'Kasa ve giderler bölümleri', exact: true }).getByRole('button')).toHaveText(['Bugün', 'Giderler', 'Kapanışlar', 'İadeler']);
  await openCash(manager, 'Kapanışlar');
  await expect(manager.getByTestId('blind-closings')).toBeVisible();
  await openCash(manager, 'Giderler');
  await expect(manager.getByRole('heading', { name: /Gider kayıtları/ })).toBeVisible();
  await expect(manager.getByRole('navigation', { name: 'Giderler bölümleri', exact: true })).toHaveCount(0);
  await shot(manager, 'yeni-duzen-mudur.png', info.outputPath('mudur.png'));
  await openView(manager, 'Personel');
  await expect(manager.getByRole('navigation', { name: 'Personel bölümleri', exact: true })).toHaveCount(0);
  await expect(manager.getByRole('navigation', { name: 'Vardiya ve bahşiş bölümleri', exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Çalışan ekle' })).toHaveCount(0);
  await openMenu(manager);
  await expect(manager.getByRole('navigation', { name: 'Menü yönetimi bölümleri', exact: true }).getByRole('button')).toHaveText(['Ürünler', 'Kampanyalar']);
  await manager.context().close();

  const cashier = await signedIn(browser, 'kasiyer', PASSWORD, { width: 1024, height: 768 });
  await expect(cashier.locator('.sidebar nav').getByRole('button', { name: 'Kasa', exact: true })).toBeVisible();
  await openView(cashier, 'Kasa');
  await expect(cashier.getByRole('navigation', { name: 'Kasa ve giderler bölümleri', exact: true })).toHaveCount(0);
  await expect(cashier.locator('.cash-today .cash-day')).toBeVisible();
  await expect(cashier.getByRole('button', { name: 'Gider kaydet', exact: true })).toBeVisible();
  await expect(cashier.locator('.cash-strip-state, .cash-opening').first()).toBeVisible();
  await shot(cashier, 'yeni-duzen-kasiyer.png', info.outputPath('kasiyer.png'));
  await cashier.context().close();
});
