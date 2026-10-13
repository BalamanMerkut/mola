import { test, expect, type Page } from '@playwright/test';
import { MERKEZ, detailTab, merkezPassword, yonetimGo, yonetimNav, yonetimSettings, yonetimShot as shot } from './helpers';

const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/**
 * This test computer's own disk is not part of the story: on a nearly full C: the test Merkez's real "cafés' server backups"
 * disk check put "Mola Merkez diskinde … yer azaldı" first in Bugün and moved every business below it. The real answer is
 * kept (businesses, copies, the guard) with the disk said to have room, so the order checked here is the businesses' own.
 */
async function roomyDisk(page: Page) {
  await page.route('**/api/merkez/admin/cloud-backups', async route => {
    const response = await route.fetch();
    if (response.status() !== 200) { await route.fulfill({ response }); return; }
    const body = await response.json(), minFree = body.disk?.minFree ?? 1024 ** 3;
    body.disk = { ...body.disk, free: minFree * 20, total: minFree * 40, low: false };
    await route.fulfill({ response, json: body });
  });
}

test('Mola Yönetim: sidebar, Bugün list, status chips, filters, sorting, paging and the business page stay clear on desktop and phone', async ({ page }, info) => {
  // Larger-directory fixture; actions are not sent for these synthetic businesses.
  const days = (i: number) => i === 0 ? 3 : i === 6 ? 20 : i === 4 ? 0 : 200;
  await page.route('**/api/merkez/admin/state', async route => {
    const response = await route.fetch();
    if (response.status() !== 200) { await route.fulfill({ response }); return; }
    const body = await response.json(), base = body.businesses.find((b: any) => !b.application) ?? body.businesses[0], now = Date.now();
    const cities = ['İstanbul', 'Elazığ', 'Ankara', 'İzmir'];
    body.businesses = Array.from({ length: 24 }, (_, i) => ({ ...base, application: undefined, duplicates: [], machines: [], neverConnected: false, tenantId: `fixture-${i}`, name: i === 0 ? 'Işık Kafe' : `İşletme ${i}`, sector: i % 3 === 0 ? 'cafe' : i % 3 === 1 ? 'restaurant' : 'dessert',
      invoice: { legalName: `İşletme ${i} Ltd. Şti.`, taxOffice: 'Merkez', taxType: 'company', taxNumber: '1234567890', city: cities[i % 4], district: 'Merkez', address: 'Cumhuriyet Cd. No: 1', phone: '+905321112233', email: `isletme${i}@example.com` },
      setupCompleted: i > 3, kind: i === 3 ? 'trial' : 'subscription', planMonths: i === 3 ? undefined : 12, endsAt: i === 3 || i === 10 ? null : new Date(now + (i === 4 ? -2 : days(i)) * 86400000).toISOString(),
      suspended: i === 1, frozen: i === 2, active: ![1, 2, 3, 4, 10].includes(i), daysRemaining: days(i), openTickets: i === 5 ? 1 : 0, activation: i === 10 ? 'pending' : 'active', appVersion: '0.1.0',
      // The café computers' heartbeat: one has been silent for four days, one reports a failing backup.
      lastSeenAt: new Date(now - (i === 8 ? 4 * 86400000 : 60000)).toISOString(), backup: { enabled: true, lastSuccessAt: new Date(now - 3600000).toISOString(), failing: i === 9 },
      freezes: i === 7 ? [{ id: 'freeze-7', status: 'pending', reason: 'Tadilat yapılacak.', startDate: '2026-11-01', days: 10, requestedAt: new Date().toISOString() }] : [] }));
    body.tickets = []; body.alerts = []; body.unread = 0;
    await route.fulfill({ response, json: body });
  });
  // Merkez's own backup, e-mail queue and disk are left out: this story is about the businesses.
  await page.route('**/api/merkez/admin/backup', route => route.fulfill({ json: { backup: null, recovery: null, local: true } }));
  await roomyDisk(page);
  await page.route('**/api/merkez/admin/email', route => route.request().method() === 'GET' ? route.fulfill({ json: { settings: null, queue: [] } }) : route.continue());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${MERKEZ}/`);
  // The door: the brand panel and one card; on a phone they stack.
  await expect(page.getByRole('heading', { name: 'Hoş geldiniz' })).toBeVisible();
  expect(await fits(page)).toBe(true);
  await shot(page, 'telefon-giris.png', info.outputPath('yonetim-login-mobile.png'));
  await page.setViewportSize({ width: 1280, height: 860 });
  await expect(page.locator('.auth-brand')).toContainText('Kafeleriniz, lisanslar ve destek tek yerde.');
  await expect(page.locator('.auth-brand')).toContainText('Merkut Studios');
  await shot(page, 'giris.png', info.outputPath('yonetim-login.png'));
  await page.getByLabel('Şifre', { exact: true }).fill('yanlis-sifre');
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await expect(page.locator('.auth-card .notice-error')).toBeVisible();
  // A definite "wrong" is said as it is: the "sonucu belirsizse" hint is only for a lost answer.
  await expect(page.locator('.auth-card .notice-error')).toHaveText('Giriş bilgileri yanlış.');
  await page.getByLabel('Şifre', { exact: true }).fill(merkezPassword());
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();

  // The sidebar replaces the tabs and the KPI cards; Bugün is the landing page.
  // 13 Ekim: Paketler joined the menu; Destek sits at the bottom right above Ayarlar.
  await expect(yonetimNav(page).getByRole('button')).toHaveText([/^Bugün/, /^İşletmeler/, /^Başvurular/, /^Duyurular/, /^Satışlarım/, /^Paketler/, /^Destek/, /^Ayarlar/]);
  await expect(yonetimNav(page).getByRole('button', { name: 'Bugün', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.platform-kpis')).toHaveCount(0);
  await expect(page.locator('.platform-local-note')).toContainText('Yerel test ortamı');
  await expect(page.getByRole('heading', { name: 'Bugün yapılacaklar' })).toBeVisible();
  const todo = page.getByRole('list', { name: 'Bugün yapılacaklar' }).getByRole('listitem');
  // Most urgent first: the licence ending in 3 days and the expired one, then the freeze, the silent computer, the backup, the 20-day licence.
  await expect(todo.nth(0)).toContainText('Işık Kafe lisansı 3 gün sonra bitiyor');
  await expect(todo.nth(1)).toContainText('İşletme 4 lisansının süresi');
  await expect(todo.filter({ hasText: 'İşletme 7 hizmeti dondurmak istiyor.' }).getByRole('button')).toHaveText('İsteği incele');
  await expect(todo.filter({ hasText: 'İşletme 8 4 gündür' })).toBeVisible();
  await expect(todo.filter({ hasText: 'İşletme 9 işletmesinin otomatik yedeği başarısız.' })).toBeVisible();
  await expect(todo.filter({ hasText: 'İşletme 6 lisansı 20 gün sonra bitiyor' })).toBeVisible();
  await expect(todo.nth(0).getByRole('link', { name: /^Ara/ })).toHaveAttribute('href', 'tel:+905321112233');
  for (const [title, n] of [['Çalışıyor', '19'], ['Denemede', '0'], ['Bitiyor', '2']] as const) await expect(page.locator('.platform-summary button').filter({ hasText: title }).locator('strong')).toHaveText(n);
  await shot(page, 'bugun.png', info.outputPath('yonetim-bugun.png'));
  // A row's button opens the business page on the right tab.
  await todo.nth(0).getByRole('button', { name: 'İşletmeyi aç' }).click();
  const detail = page.getByRole('region', { name: 'Işık Kafe', exact: true });
  await expect(detailTab(detail, 'Lisans')).toHaveAttribute('aria-pressed', 'true');
  await detail.getByRole('button', { name: 'İşletmeler listesine dön' }).click();

  const rows = page.locator('.platform-business-row'), names = rows.locator('.platform-business-name');
  // Big tiles, 23 a page; "İşletme ekle" is always the first tile.
  await expect(rows).toHaveCount(23);
  const tiles = page.getByRole('list', { name: 'İşletmeler' }).getByRole('listitem');
  await expect(tiles.first().getByRole('button')).toHaveAccessibleName('İşletme ekle');
  await expect(page.getByRole('button', { name: 'İşletme ekle', exact: true })).toHaveClass(/add-tile/);
  // One chip per tile; the name large, city · kind under it and a quiet grey line (plan, version, last contact).
  const chip = (n: number) => rows.nth(n).locator('.status-chip');
  await expect(rows.locator('.status-chip')).toHaveCount(23);
  for (const [n, text] of [[0, '3 gün kaldı'], [1, 'Askıda'], [2, 'Donduruldu'], [3, 'Kurulum bekliyor'], [4, 'Süresi doldu'], [5, 'Çalışıyor'], [6, '20 gün kaldı'], [8, 'Bağlantı yok'], [10, 'Kod bekleniyor']] as const) await expect(chip(n)).toHaveText(text);
  await expect(chip(0)).toHaveClass(/warn/); await expect(chip(5)).toHaveClass(/ok/); await expect(chip(8)).toHaveClass(/bad/); await expect(chip(1)).toHaveClass(/idle/);
  await expect(rows.first().locator('.platform-business-name')).toHaveText('Işık Kafe');
  await expect(rows.first().locator('.tile-place')).toHaveText('İstanbul · Kafe');
  await expect(rows.first().locator('.tile-meta')).toContainText('Yıllık · Sürüm 0.1.0');
  await expect(rows.first().locator('.tile-meta')).toContainText('Son bağlantı az önce');
  await expect(rows.nth(8).locator('.tile-meta')).toContainText('Son bağlantı 4 gün önce');
  await expect(rows.nth(10).locator('.tile-meta')).toContainText('Henüz bağlanmadı');
  await expect(rows.nth(5).locator('.tile-meta')).toContainText('1 açık talep');
  // Desktop: several tiles a row, the column centred with room on both sides.
  const [a, b] = [await rows.nth(0).boundingBox(), await rows.nth(1).boundingBox()];
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  await shot(page, 'isletmeler.png', info.outputPath('yonetim-desktop.png'));
  await page.getByRole('button', { name: 'Sonraki sayfa', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByText('Sayfa 2 / 2')).toBeVisible();
  const order = page.getByRole('combobox', { name: 'İşletme sıralaması', exact: true });
  await order.selectOption('expiry');
  await expect(page.getByText('Sayfa 1 / 2')).toBeVisible();
  await expect(names.first()).toHaveText(/^Işık Kafe/);
  await expect(names.nth(1)).toHaveText(/^İşletme 6/);
  await order.selectOption('name');
  await expect(names.nth(2)).toHaveText(/^İşletme 2/);
  await order.selectOption('created');

  await page.getByLabel('İşletme ara', { exact: true }).fill('IŞIK');
  await expect(rows).toHaveCount(1); await expect(rows).toContainText('Işık Kafe');
  await rows.click();
  // The business is a page with a back link, an identity card (name, state, line, short facts) and five tabs with icons
  // centred under it, cards per tab (13 Ekim).
  await expect(detail.locator('.detail-header')).toContainText('Işık Kafe');
  await expect(detail.locator('.detail-header .status-chip')).toHaveText('3 gün kaldı');
  await expect(detail.locator('.detail-line')).toContainText('Kafe · İstanbul · Yıllık abonelik');
  await expect(detail.locator('.did-facts dt')).toHaveText(['Son bağlantı', 'Paket', 'Lisans']);
  await expect(detail.locator('.did-facts')).toContainText('3 gün kaldı');
  const tabs = detail.getByRole('navigation', { name: 'İşletme yönetimi' }).getByRole('button');
  await expect(tabs).toHaveText(['Özet', 'Lisans', 'Hizmet', 'Bilgiler', 'Destek']);
  await expect(tabs.locator('svg')).toHaveCount(5);
  await expect(detailTab(detail, 'Özet')).toHaveAttribute('aria-pressed', 'true');
  const centre = async (selector: string) => { const box = (await detail.locator(selector).boundingBox())!; return box.x + box.width / 2; };
  expect(Math.abs(await centre('.detail-tabs') - await centre('.detail-header'))).toBeLessThan(4);
  // Özet: three square cards with short lines and one action each.
  await expect(detail.locator('.dsum-card')).toHaveCount(3);
  for (const card of ['Lisans ve paket', 'Bağlantı ve cihaz', 'Yedekler']) await expect(detail.getByRole('region', { name: card, exact: true }).locator('.dsum-action button')).toHaveCount(1);
  for (const fact of ['Durum', 'Lisans bitişi', 'Son bağlantı', 'Sürüm', 'Son yedek', 'İkinci yedek', 'Bilgisayarlar']) await expect(detail.locator('.detail-facts dt').filter({ hasText: new RegExp(`^${fact}$`) })).toHaveCount(1);
  await expect(detail.locator('.detail-next')).toContainText('Lisans 3 gün içinde bitiyor.');
  await expect(detail.getByRole('region', { name: 'Satıcı notu' })).toBeVisible();
  await expect(detail.locator('.detail-sheet .detail-card')).toHaveCount(0);
  await shot(page, 'isletme-ozet.png', info.outputPath('yonetim-detail-desktop.png'));
  for (const [tab, marker] of [['Lisans', 'Lisans süresi'], ['Hizmet', 'Hizmet paketi'], ['Bilgiler', 'Fatura bilgileri'], ['Destek', 'Açık destek talebi yok']] as const) {
    await detailTab(detail, tab).click();
    await expect(detailTab(detail, tab)).toHaveAttribute('aria-pressed', 'true');
    await expect(detail).toContainText(marker);
  }
  // Hizmet: the packages as large cards (the three starting ones, the business's old plan, Özel); a coming service cannot be picked.
  await detailTab(detail, 'Hizmet').click();
  const packages = detail.getByRole('radiogroup', { name: 'Hizmet paketi' });
  await expect(packages.getByRole('radio')).toHaveCount(5);
  await expect(packages.getByRole('radio', { name: /eski plan/ })).toHaveAttribute('aria-checked', 'true');
  // Choosing another package shows what changes; nothing is sent before "Değişikliği uygula".
  await packages.getByRole('radio', { name: /^Özel/ }).click();
  await expect(detail.getByRole('checkbox', { name: /Paket servis platformları/ })).toBeDisabled();
  await expect(detail.getByRole('region', { name: 'Değişikliği onayla' })).toBeVisible();
  await packages.getByRole('radio', { name: /eski plan/ }).click();
  await expect(detail.getByRole('region', { name: 'Değişikliği onayla' })).toHaveCount(0);
  // Paid terms are in Lisans (asked once more before they apply); the dangerous actions are apart in "Dikkat".
  await detailTab(detail, 'Lisans').click();
  await expect(detail).not.toContainText('Hizmet paketi');
  await expect(detail.getByRole('button', { name: '1 yıl uzat', exact: true })).toBeVisible();
  const danger = detail.getByRole('region', { name: 'Dikkat' });
  await expect(danger.getByRole('button', { name: 'Askıya al', exact: true })).toBeVisible();
  await expect(danger).toContainText('Önce askıya alın, sonra silebilirsiniz.');
  await shot(page, 'isletme-lisans.png', info.outputPath('yonetim-license-desktop.png'));
  // Business data stays on the café computer: no appearance, menu or owner account tools here.
  await expect(detail.getByRole('button', { name: 'Görünüm', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Hesap erişimi', exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: 'İşletmeler listesine dön' }).click();
  await expect(page.getByLabel('İşletme ara', { exact: true })).toHaveValue('IŞIK');
  await page.getByRole('button', { name: 'Filtreleri temizle' }).click();
  const pills = page.getByRole('group', { name: 'İşletme durumu' });
  await expect(pills.getByRole('button')).toHaveText(['Tümü', 'Çalışıyor', 'Deneme', 'Bitiyor', 'Bağlantı yok', 'Askıda']);
  for (const [filter, expected] of [['Bitiyor', ['Işık Kafe', 'İşletme 6']], ['Askıda', ['İşletme 1', 'İşletme 2']], ['Deneme', ['İşletme 3']], ['Bağlantı yok', ['İşletme 8']]] as const) {
    await pills.getByRole('button', { name: filter, exact: true }).click();
    await expect(pills.getByRole('button', { name: filter, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(names).toHaveText(expected.map(n => new RegExp(`^${n}( ·|$)`)));
  }
  await pills.getByRole('button', { name: 'Çalışıyor', exact: true }).click(); await expect(rows).toHaveCount(19);
  // The rarer states stay reachable from "Diğer durumlar".
  const more = page.getByRole('combobox', { name: 'Diğer durumlar' });
  for (const [filter, expected] of [['pending', ['İşletme 10']], ['expired', ['İşletme 4']], ['support', ['İşletme 5', 'İşletme 7']], ['setup', ['Işık Kafe', 'İşletme 1', 'İşletme 2', 'İşletme 3']], ['backup', ['İşletme 9']]] as const) {
    await more.selectOption(filter);
    await expect(names).toHaveText(expected.map(n => new RegExp(`^${n}( ·|$)`)));
  }
  // A summary number on Bugün is a shortcut to the same list.
  await yonetimGo(page, 'Bugün');
  await page.locator('.platform-summary button').filter({ hasText: 'Bitiyor' }).click();
  await expect(pills.getByRole('button', { name: 'Bitiyor', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(2);
  await page.getByLabel('İşletme ara', { exact: true }).fill('bulunmayan');
  await expect(page.getByText('Bu aramaya uygun işletme bulunamadı.')).toBeVisible();

  // Ayarlar: one section at a time.
  await yonetimSettings(page, 'Hesap güvenliği');
  // Paketler and Hizmet fiyatları left Ayarlar for their own place in the menu (13 Ekim); Destek sits right above Ayarlar.
  await expect(page.getByRole('navigation', { name: 'Ayarlar bölümleri' }).getByRole('button')).toHaveText(['Hesap güvenliği', 'Yedek', 'Güncellemeler', 'E-posta bildirimleri', 'İletişim bilgileri', 'İşlem kayıtları', 'Çalışma klasörü', 'Geliştirici erişimi']);
  expect(await page.getByRole('navigation', { name: 'Mola Yönetim bölümleri' }).getByRole('button').evaluateAll(items => items.map(b => b.getAttribute('aria-label')))).toEqual(['Bugün', 'İşletmeler', 'Başvurular', 'Duyurular', 'Satışlarım', 'Paketler', 'Destek', 'Ayarlar']);
  // Destek and Ayarlar are kept at the bottom of the sidebar, Destek right above Ayarlar.
  const navBox = async (name: string) => (await page.getByRole('navigation', { name: 'Mola Yönetim bölümleri' }).getByRole('button', { name, exact: true }).boundingBox())!;
  const [packagesBox, supportBox, settingsBox] = [await navBox('Paketler'), await navBox('Destek'), await navBox('Ayarlar')];
  expect(supportBox.y - (packagesBox.y + packagesBox.height)).toBeGreaterThan(40);
  expect(Math.abs(settingsBox.y - (supportBox.y + supportBox.height))).toBeLessThan(12);
  await expect(page.getByRole('heading', { name: 'Yönetici şifresi' })).toBeVisible();
  await shot(page, 'ayarlar.png', info.outputPath('yonetim-settings.png'));

  // Phone: the sidebar is a compact top bar that scrolls inside itself; no sideways page scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await yonetimGo(page, 'Bugün');
  expect(await fits(page)).toBe(true);
  await shot(page, 'telefon-bugun.png', info.outputPath('yonetim-mobile-today.png'));
  await yonetimGo(page, 'İşletmeler');
  await page.getByRole('button', { name: 'Filtreleri temizle' }).click();
  await expect(rows).toHaveCount(23);
  // The top bar's items all fit (six on a phone: Duyurular is beside the bell), the last one ("Ayarlar") too, and none is cut.
  expect(await yonetimNav(page).evaluate(n => [...n.querySelectorAll('button')].filter(b => b.offsetParent !== null).every(b => { const r = b.getBoundingClientRect(), label = b.querySelector('span') as HTMLElement; return r.left >= 0 && r.right <= innerWidth && r.height >= 44 && label.scrollWidth <= label.clientWidth + 1; }))).toBe(true);
  expect(await fits(page)).toBe(true);
  await shot(page, 'telefon-isletmeler.png', info.outputPath('yonetim-mobile.png'));
  await rows.nth(7).click();
  const seventh = page.getByRole('region', { name: 'İşletme 7', exact: true });
  await expect(seventh.locator('.detail-next')).toContainText('Dondurma isteği onay bekliyor.');
  await expect(detailTab(seventh, 'Lisans').locator('.tab-badge')).toHaveText('!');
  expect(await fits(page)).toBe(true);
  await shot(page, 'telefon-isletme.png', info.outputPath('yonetim-detail-mobile.png'));
});

test('Bugün: a new 30-day trial is "Denemede", not "Bitiyor" (7-day threshold for trials); a computer swap the vendor settled leaves the list', async ({ page }) => {
  const now = Date.now(), hours = (h: number) => new Date(now - h * 3600_000).toISOString();
  await page.route('**/api/merkez/admin/state', async route => {
    const response = await route.fetch();
    if (response.status() !== 200) { await route.fulfill({ response }); return; }
    const body = await response.json(), base = body.businesses.find((b: any) => !b.application) ?? body.businesses[0];
    const one = (i: number, over: object) => ({ ...base, application: undefined, duplicates: [], machines: [], neverConnected: false, tenantId: `qa-${i}`, invoice: undefined, setupCompleted: true, suspended: false, frozen: false, active: true, openTickets: 0, activation: 'active', appVersion: '0.1.0', freezes: [],
      lastSeenAt: hours(0.01), backup: { enabled: true, lastSuccessAt: hours(1), failing: false }, ...over });
    body.businesses = [
      one(0, { name: 'Yeni Deneme Kafe', kind: 'trial', planMonths: undefined, endsAt: new Date(now + 30 * 86400000).toISOString(), daysRemaining: 30 }),
      one(1, { name: 'Son Hafta Kafe', kind: 'trial', planMonths: undefined, endsAt: new Date(now + 5 * 86400000).toISOString(), daysRemaining: 5 }),
      one(2, { name: 'Çözülen Bilgisayar', kind: 'subscription', planMonths: 12, endsAt: new Date(now + 200 * 86400000).toISOString(), daysRemaining: 200,
        machines: [{ hash: 'a'.repeat(64), firstSeenAt: hours(80), lastSeenAt: hours(1), active: true, restoredAt: hours(2) }, { hash: 'b'.repeat(64), firstSeenAt: hours(10), lastSeenAt: hours(3), active: false, replacedAt: hours(2) }] }),
      one(3, { name: 'Yeni Bilgisayar Kafe', kind: 'subscription', planMonths: 12, endsAt: new Date(now + 200 * 86400000).toISOString(), daysRemaining: 200,
        machines: [{ hash: 'c'.repeat(64), firstSeenAt: hours(80), lastSeenAt: hours(5), active: false, replacedAt: hours(5) }, { hash: 'd'.repeat(64), firstSeenAt: hours(5), lastSeenAt: hours(1), active: true }] }),
    ];
    body.tickets = []; body.alerts = []; body.unread = 0;
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/merkez/admin/backup', route => route.fulfill({ json: { backup: null, recovery: null, local: true } }));
  await page.route('**/api/merkez/admin/email', route => route.request().method() === 'GET' ? route.fulfill({ json: { settings: null, queue: [] } }) : route.continue());
  await roomyDisk(page);
  await page.goto(`${MERKEZ}/`);
  await page.getByLabel('Şifre', { exact: true }).fill(merkezPassword());
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  const todo = page.getByRole('list', { name: 'Bugün yapılacaklar' }).getByRole('listitem');
  await expect(todo.filter({ hasText: 'Son Hafta Kafe denemesi 5 gün sonra bitiyor' })).toBeVisible();
  await expect(todo.filter({ hasText: 'Yeni Deneme Kafe' })).toHaveCount(0);
  for (const [title, n] of [['Çalışıyor', '2'], ['Denemede', '2'], ['Bitiyor', '1']] as const) await expect(page.locator('.platform-summary button').filter({ hasText: title }).locator('strong')).toHaveText(n);
  await expect(todo.filter({ hasText: 'Yeni Bilgisayar Kafe lisansı yeni bir bilgisayarda' })).toBeVisible();
  await expect(todo.filter({ hasText: 'Çözülen Bilgisayar' })).toHaveCount(0);
  await page.locator('.platform-summary button').filter({ hasText: 'Bitiyor' }).click();
  await expect(page.locator('.platform-business-name')).toHaveText(['Son Hafta Kafe']);
  await page.getByRole('button', { name: 'Filtreleri temizle' }).click();
  await expect(page.locator('.platform-business-row').filter({ hasText: 'Yeni Deneme Kafe' }).locator('.status-chip')).toHaveText('Deneme · 30 gün');
});
