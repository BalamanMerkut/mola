import { ensureSetup, openView } from './helpers';
import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
async function login(page: Page, role = 'isletme') {
  await page.goto('/');
  await page.getByLabel('Kullanıcı adı', { exact: true }).fill(role);
  // The test server runs as an installed café: no demo password is filled in for us.
  await page.getByLabel('Şifre', { exact: true }).fill('MolaDemo!2026');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/login')), page.getByRole('button', { name: 'Çalışma alanını aç' }).click()]);
  await ensureSetup(page.request); await page.reload();
  await expect(page.getByRole('button', { name: 'Çıkış yap' })).toBeVisible();
}
async function assertFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
test('customer order → kitchen preparation → cash change → new table account', async ({ page, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  await page.screenshot({ path: info.outputPath('desktop.png'), fullPage: true });
  await page.getByRole('button', { name: /Masa 01/ }).click();
  await page.getByRole('button', { name: 'QR menüyü aç' }).click();
  const url = await page.getByRole('link', { name: 'Müşteri menüsünü aç' }).getAttribute('href');
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await context.newPage(); guest.on('pageerror', e => errors.push(e.message));
  await guest.goto(url!);
  await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeEnabled();
  await assertFits(guest);
  await guest.screenshot({ path: info.outputPath('mobile-menu.png'), fullPage: true });
  await guest.getByRole('button', { name: /Demleme Çay/ }).click();
  await guest.getByRole('button', { name: /Sepete ekle/ }).click();
  await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await expect(guest.getByText(/Sipariş #\d+ alındı/)).toBeVisible();
  await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
  await guest.getByRole('button', { name: 'Popüler ürünler', exact: true }).click();
  await expect(guest.locator('.product-card')).toHaveCount(1);
  await expect(guest.locator('.product-card')).toContainText('Demleme Çay');
  await assertFits(guest);
  await guest.getByLabel('Ürün ara', { exact: true }).fill('bulunmayan');
  await expect(guest.getByText('Ürün bulunamadı', { exact: true })).toBeVisible();
  await guest.getByLabel('Ürün ara', { exact: true }).fill('');
  await guest.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(guest.getByRole('button', { name: 'Popular products', exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'TR', exact: true }).click();
  const ownerCookies = await page.context().cookies();
  await page.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } }); await page.reload();
  await expect(page.locator('.kitchen-bar')).toBeVisible(); // the kitchen account: Mutfak modu, the board at once
  await page.getByRole('button', { name: 'Hazırlamaya başla' }).click();
  await expect(page.getByRole('button', { name: 'Hazır olarak işaretle' })).toBeVisible();
  await guest.getByRole('button', { name: /Siparişlerim/ }).click();
  await expect(guest.getByText('Hazırlanıyor', { exact: true })).toBeVisible();
  await expect(guest.locator('.customer-order')).toHaveCSS('background-color', 'rgb(246, 237, 212)');
  await page.getByRole('button', { name: 'Hazır olarak işaretle', exact: true }).click();
  await expect(guest.getByText('Hazır', { exact: true })).toBeVisible();
  await expect(guest.locator('.customer-order')).toHaveCSS('background-color', 'rgb(229, 240, 230)');
  await guest.screenshot({ path: info.outputPath('order-ready-mobile.png'), fullPage: true });

  await page.context().addCookies(ownerCookies); await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Masalar', exact: true }).click();
  await page.getByRole('button', { name: /Masa 01/ }).click();
  await page.getByRole('button', { name: 'Ödeme al', exact: true }).click();
  await page.getByLabel('Alınan nakit (TL)').fill('50');
  await expect(page.locator('.payment-change')).toContainText('15');
  await page.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
  await expect(page.getByText(/Hesap kapandı. Para üstü/)).toBeVisible();
  await expect(guest.getByRole('heading', { name: 'Hesabınız kapandı' })).toBeVisible();
  await guest.getByRole('button', { name: 'Yeni hesapla sipariş ver' }).click();
  await guest.getByRole('button', { name: /Siparişlerim/ }).click();
  await expect(guest.getByText('İlk siparişiniz sizi bekliyor')).toBeVisible();
  expect(errors).toEqual([]); await context.close();
});
test('320px customer menu and 768px waiter screen fit without page overflow', async ({ page, browser }, info) => {
  await login(page);
  const response = await page.request.get('/api/staff/state'); const state = await response.json();
  const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
  const guest = await context.newPage(); await guest.goto(`/m/${state.tables[1].token}`);
  await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeEnabled();
  await assertFits(guest);
  await expect(guest.getByRole('button', { name: /Çikolatalı Brownie/ })).toBeDisabled();
  await guest.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(guest.getByRole('button', { name: /Turkish Tea/ })).toBeVisible();
  await guest.screenshot({ path: info.outputPath('small-phone.png'), fullPage: true });
  const staffContext = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const waiter = await staffContext.newPage(); await login(waiter, 'garson');
  // The waiter opens on Masalar (8 Ekim denetimi K6).
  await openView(waiter, 'Sipariş al');
  await waiter.getByLabel('Sipariş masası').selectOption('table-2');
  await waiter.getByRole('textbox', { name: 'Ürün ara' }).fill('21');
  await waiter.locator('.staff-card', { hasText: 'Demleme Çay' }).click();
  await waiter.getByRole('button', { name: /Sepete ekle/ }).click();
  await waiter.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await waiter.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  // Staff get a short line instead of the customer's success window: no extra tap per order.
  await expect(waiter.getByText(/Sipariş #\d+ mutfağa gönderildi/)).toBeVisible();
  await expect(waiter.getByRole('dialog', { name: 'Siparişiniz alındı' })).toHaveCount(0);
  await assertFits(waiter);
  await expect(waiter.getByRole('button', { name: 'Menü yönetimi', exact: true })).toHaveCount(0);
  await waiter.screenshot({ path: info.outputPath('tablet-waiter.png'), fullPage: true });
  await staffContext.close(); await context.close();
});
test('owner creates product by code and toggles sold-out state', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Menü yönetimi', exact: true }).click();
  await page.getByRole('button', { name: 'Ürün ekle', exact: true }).click();
  await page.getByLabel('Ürün kodu', { exact: true }).fill('99');
  await page.getByLabel('Ürün adı', { exact: true }).fill('Test Espresso');
  await page.getByLabel('Fiyat (TL)', { exact: true }).fill('90');
  await expect(page.getByLabel('Kategori', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Kaydet ve yayınla' })).toBeDisabled();
  await page.getByLabel('Kategori', { exact: true }).selectOption('Kahveler');
  await page.getByRole('button', { name: 'Kaydet ve yayınla' }).click();
  const row = page.locator('.menu-row').filter({ hasText: 'Test Espresso' });
  await expect(row).toBeVisible(); await row.getByLabel('Tükendi').check();
  await expect(row.getByLabel('Tükendi')).toBeChecked();
  await page.reload(); await page.getByRole('button', { name: 'Menü yönetimi', exact: true }).click();
  await expect(page.locator('.menu-row').filter({ hasText: 'Test Espresso' }).getByLabel('Tükendi')).toBeChecked();
  await page.getByRole('group', { name: 'Ürün durumu' }).getByRole('button', { name: /Tükendi/ }).click();
  await page.getByLabel('Kategoriye göre filtrele').selectOption('Kahveler');
  await page.getByLabel('Menüde ürün ara').fill('99');
  await expect(page.locator('.menu-row')).toHaveCount(1);
  await expect(page.locator('.menu-row')).toContainText('Test Espresso');
  await page.getByLabel('Menüde ürün ara').fill('bulunmayan-ürün');
  await expect(page.getByText('Bu seçimde ürün bulunamadı', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filtreleri temizle' }).click();
  await expect(page.getByLabel('Menüde ürün ara')).toHaveValue('');
  await expect(page.getByLabel('Kategoriye göre filtrele')).toHaveValue('');
  await expect(page.getByRole('group', { name: 'Menü işlemleri' }).getByRole('button').first()).toHaveText('Ürün ekle');

});

test('lost response after acceptance can be retried without a duplicate order', async ({ page, browser }) => {
  await login(page);
  const initial = await (await page.request.get('/api/staff/state')).json();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(`/m/${initial.tables[2].token}`);
  await guest.getByRole('button', { name: /Demleme Çay/ }).click();
  await guest.getByRole('button', { name: /Sepete ekle/ }).click();
  await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  let intercepted = false;
  await guest.route('**/api/guest/orders', async route => {
    if (intercepted) return route.continue();
    intercepted = true;
    const response = await route.fetch(); expect(response.status()).toBe(200);
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SIMULATED_RESPONSE_LOSS', message: 'Simulated lost response after commit' }) });
  });
  await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await guest.getByRole('button', { name: 'Gönderimi yeniden kontrol et' }).click();
  await expect(guest.getByText(/Sipariş #\d+ alındı/)).toBeVisible();
  await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
  const after = await (await page.request.get('/api/staff/state')).json();
  expect(after.orders.length - initial.orders.length).toBe(1);
  await context.setOffline(true);
  await expect(guest.getByText('Şu an sipariş alınamıyor, lütfen garsonunuza sorun.').first()).toBeVisible({ timeout: 16000 });
  // 8 Ekim: the menu stays usable (products open, the basket waits); only sending is off, with the same line next to it.
  await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeEnabled();
  await guest.getByRole('button', { name: /Demleme Çay/ }).click();
  await guest.getByRole('button', { name: /Sepete ekle/ }).click();
  await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await expect(guest.getByRole('button', { name: 'Siparişi gönder', exact: true })).toBeDisabled();
  await expect(guest.locator('.send-blocked-reason')).toHaveText('Şu an sipariş alınamıyor, lütfen garsonunuza sorun.');
  await context.close();
});

test('a QR guest order reaches the kitchen only when its change window ends (API refuses an early start); staff orders at once', async ({ page, browser }) => {
  await login(page);
  // 17 Ekim (owner's decision): while the guest may still change it, the order is not on the kitchen's screen at all.
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 8, commissionBps: null } });
  const state = await (await page.request.get('/api/staff/state')).json(), table5 = state.tables.find((t: any) => t.id === 'table-5');
  // The change window belongs to the QR guest: a phone orders at Masa 05.
  const phone = await browser.newContext(), guestApi = phone.request;
  const session = await (await guestApi.post('/api/guest/session', { data: { token: table5.token } })).json();
  const result = await guestApi.post('/api/guest/orders', { headers: { 'X-Guest-Session': session.session }, data: { requestId: 'wait-test-order', tableId: 'table-5', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } });
  expect(result.ok()).toBe(true); const order = await result.json();
  const denied = await page.request.post('/api/staff/status', { data: { requestId: 'wait-test-status', orderId: order.orderId, version: 1, status: 'preparing' } });
  expect(denied.status()).toBe(409); expect((await denied.json()).code).toBe('CHANGE_WINDOW_OPEN');
  // A waiter's order has no change window: no editableUntil, the kitchen may start it straight away.
  const staffOrder = await (await page.request.post('/api/staff/orders', { data: { requestId: 'wait-test-staff', tableId: 'table-6', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } })).json();
  const staffView = (await (await page.request.get('/api/staff/state')).json()).orders.find((o: any) => o.id === staffOrder.orderId);
  expect(staffView.editableUntil).toBeUndefined();
  // The owner (and the waiters) see the QR order at once, with its window.
  expect((await (await page.request.get('/api/staff/state')).json()).orders.find((o: any) => o.id === order.orderId).editableUntil).toBeTruthy();
  await phone.close();
  const ownerCookies = await page.context().cookies();
  await page.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } }); await page.reload();
  await expect(page.locator('.kitchen-bar')).toBeVisible(); // the kitchen account: Mutfak modu, the board at once
  const staffCard = page.locator('.kitchen-card').filter({ hasText: 'Masa 06' });
  await expect(staffCard.getByRole('button', { name: 'Hazırlamaya başla' })).toBeEnabled();
  await expect(staffCard.getByRole('button', { name: /Müşteri değiştirebilir/ })).toHaveCount(0);
  const card = page.locator('.kitchen-card').filter({ hasText: 'Masa 05' });
  await expect(card).toHaveCount(0); // not on the board while the guest may change it, nor in the "Yeni" count
  const newCount = page.locator('.kitchen-bar-counts .count-new strong'), waiting = Number(await newCount.textContent());
  // When the window ends it arrives as a normal new order: no countdown, "Hazırlamaya başla" at once.
  await expect(card.getByRole('button', { name: 'Hazırlamaya başla' })).toBeEnabled({ timeout: 12000 });
  await expect(page.getByRole('button', { name: /Müşteri değiştirebilir/ })).toHaveCount(0);
  await expect(newCount).toHaveText(String(waiting + 1));
  await card.getByRole('button', { name: 'Hazırlamaya başla' }).click();
  await expect(card.getByRole('button', { name: 'Hazır olarak işaretle' })).toBeVisible();
  await page.context().addCookies(ownerCookies);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
});

test('category-specific fields, photo crop and customer subcategory filtering', async ({ page, browser }, info) => {
  await login(page);
  await page.getByRole('button', { name: 'Menü yönetimi', exact: true }).click();
  await page.getByRole('button', { name: 'Ürün ekle', exact: true }).click();
  await page.getByLabel('Kategori', { exact: true }).selectOption('Kahveler');
  if (!await page.getByRole('button', { name: 'Boy ekle', exact: true }).isVisible()) await page.locator('summary').filter({ hasText: 'Müşteri seçenekleri' }).click();
  await page.getByRole('button', { name: 'Boy ekle', exact: true }).click();
  if (!await page.getByRole('button', { name: 'Boy ekle', exact: true }).isVisible()) await page.locator('summary').filter({ hasText: 'Müşteri seçenekleri' }).click();
  await page.getByRole('button', { name: 'Boy ekle', exact: true }).click();
  await expect(page.locator('.group-editor')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('Boy zaten eklendi');
  await page.getByLabel('Alan adı', { exact: true }).fill('Bardak boyutu');
  if (!await page.getByRole('button', { name: 'Boy ekle', exact: true }).isVisible()) await page.locator('summary').filter({ hasText: 'Müşteri seçenekleri' }).click();
  await page.getByRole('button', { name: 'Boy ekle', exact: true }).click();
  await expect(page.locator('.group-editor')).toHaveCount(1);
  await expect(page.getByLabel('Alan adı', { exact: true })).toHaveValue('Bardak boyutu');
  await page.getByRole('button', { name: 'Süt tercihi ekle', exact: true }).click();
  await page.getByRole('button', { name: 'Süt tercihi ekle', exact: true }).click();
  await expect(page.locator('.group-editor')).toHaveCount(2);
  await page.getByRole('button', { name: 'Özel alan ekle', exact: true }).click();
  await page.getByRole('button', { name: 'Özel alan ekle', exact: true }).click();
  await expect(page.locator('.group-editor')).toHaveCount(4);
  await page.getByLabel('Kategori', { exact: true }).selectOption('Tatlılar');
  await expect(page.getByRole('button', { name: 'Boy ekle', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Alan adı', { exact: true })).toHaveCount(0);
  await page.getByLabel('Ürün kodu', { exact: true }).fill('101');
  await page.getByLabel('Ürün adı', { exact: true }).fill('Fırın Sütlaç');
  await page.getByLabel(/Tatlı türü/).selectOption('Sütlü');
  await page.getByLabel('Fiyat (TL)', { exact: true }).fill('110');
  await page.locator('summary').filter({ hasText: 'Diğer bilgiler' }).click();
  await page.getByLabel('İçindekiler', { exact: true }).fill('Süt, pirinç, şeker');
  const photo = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#dbad74' } }).png().toBuffer();
  await page.getByLabel('Ürün fotoğrafı seç').setInputFiles({ name: 'tatli.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByLabel('Fotoğraf kırpma önizlemesi')).toBeVisible();
  await page.getByRole('slider', { name: 'Yakınlaştır', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await page.getByRole('slider', { name: 'Yatay konum', exact: true }).fill('70');
  await page.getByRole('slider', { name: 'Dikey konum', exact: true }).fill('25');
  await page.getByRole('button', { name: 'Yatay konum sıfırla', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Yatay konum', exact: true })).toHaveValue('50');
  await expect(page.getByRole('slider', { name: 'Dikey konum', exact: true })).toHaveValue('25');
  await expect(page.getByRole('slider', { name: 'Yakınlaştır', exact: true })).toHaveValue('1.05');
  await page.getByRole('button', { name: 'Dikey konum sıfırla', exact: true }).click();
  await page.getByRole('button', { name: 'Yakınlaştır sıfırla', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Yakınlaştır', exact: true })).toHaveValue('1');
  await page.getByRole('slider', { name: 'Yakınlaştır', exact: true }).fill('1.05');
  await page.screenshot({ path: info.outputPath('photo-crop.png'), fullPage: true });
  await page.route('**/api/staff/photos', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'PHOTO_QUOTA', message: 'Fotoğraf depolama alanı doldu. Mevcut fotoğraflarınız korunuyor. Destek bölümünden yardım isteyin.' }) }));
  await page.getByRole('button', { name: 'Fotoğrafı kullan', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Fotoğraf depolama alanı doldu.');
  await expect(page.getByLabel('Fotoğraf kırpma önizlemesi')).toBeVisible();
  await expect(page.getByLabel('Ürün adı', { exact: true })).toHaveValue('Fırın Sütlaç');
  await page.unroute('**/api/staff/photos');
  await page.getByRole('button', { name: 'Fotoğrafı kullan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fotoğrafı kaldır' })).toBeVisible();
  await page.getByRole('button', { name: 'Fotoğrafı düzenle', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Yakınlaştır', exact: true })).toHaveValue('1.05');
  await page.getByRole('button', { name: 'Kırpmadan vazgeç', exact: true }).click();
  await page.getByRole('button', { name: 'Servis tercihi ekle', exact: true }).click();
  await page.getByRole('button', { name: 'Servis tercihi ekle', exact: true }).click();
  await expect(page.locator('.group-editor')).toHaveCount(1);
  await page.getByLabel('Ek ücret (TL)', { exact: true }).nth(1).fill('25');
  await page.screenshot({ path: info.outputPath('product-editor.png'), fullPage: true });
  await page.getByRole('button', { name: 'Kaydet ve yayınla' }).click();
  const row = page.locator('.menu-row').filter({ hasText: 'Fırın Sütlaç' }); await expect(row).toBeVisible();
  await expect(row.getByRole('img')).toBeVisible();
  const state = await (await page.request.get('/api/staff/state')).json();
  const product = state.products.find((p: any) => p.code === '101');
  expect(product.groups.length).toBe(1); expect(product.groups[0].name).toBe('Servis tercihi');
  expect(product.groups[0].options[1].extra).toBe(2500);
  const image = await page.request.get(product.photo); expect(image.headers()['content-type']).toContain('image/webp');
  await page.locator('.menu-row').filter({ hasText: 'Caffè Latte' }).getByRole('button', { name: 'Düzenle', exact: true }).click();
  await expect(page.getByLabel('Kategori', { exact: true })).toHaveValue('Kahveler');
  await page.getByLabel('Alan adı', { exact: true }).first().fill('Bardak');
  if (!await page.getByRole('button', { name: 'Boy ekle', exact: true }).isVisible()) await page.locator('summary').filter({ hasText: 'Müşteri seçenekleri' }).click();
  await page.getByRole('button', { name: 'Boy ekle', exact: true }).click();
  await expect(page.locator('.group-editor')).toHaveCount(2);
  await page.locator('.group-editor').first().getByRole('button', { name: 'Alanı kaldır' }).click();
  if (!await page.getByRole('button', { name: 'Boy ekle', exact: true }).isVisible()) await page.locator('summary').filter({ hasText: 'Müşteri seçenekleri' }).click();
  await page.getByRole('button', { name: 'Boy ekle', exact: true }).click();
  await expect(page.locator('.group-editor')).toHaveCount(2);
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await context.newPage(); await guest.goto(`/m/${state.tables[5].token}`);
  await guest.getByRole('button', { name: 'Tatlılar', exact: true }).click();
  await guest.getByRole('button', { name: 'Sütlü', exact: true }).click();
  await expect(guest.locator('.product-card')).toHaveCount(1);
  await guest.getByRole('button', { name: /Fırın Sütlaç/ }).click();
  const photoBox = (await guest.getByRole('dialog').locator('.product-photo').boundingBox())!;
  expect(Math.abs(photoBox.width - photoBox.height)).toBeLessThan(2);
  await expect(guest.getByRole('dialog').locator('.product-photo img')).toHaveCSS('object-fit', 'contain');
  await guest.screenshot({ path: info.outputPath('square-photo-preview.png'), fullPage: true });
  await expect(guest.getByText('Süt, pirinç, şeker', { exact: false })).toBeVisible();
  await expect(guest.getByRole('radio', { name: /Dondurmalı/ })).toBeVisible();
  await assertFits(guest); await context.close();
});

test('QR selects advertised LAN address instead of localhost', async ({ page }) => {
  await login(page);
  await page.route('**/api/staff/network', route => route.fulfill({ json: { lan: true, addresses: [{ name: 'Test ağı', origin: 'http://192.0.2.10:3000' }] } }));
  await page.getByRole('button', { name: /Masa 09/ }).click();
  await page.getByRole('button', { name: 'QR menüyü aç' }).click();
  await expect(page.getByRole('link', { name: 'Müşteri menüsünü aç' })).toHaveAttribute('href', /^http:\/\/192\.0\.2\.10:3000\/m\//);
});

test('kitchen sound defaults on, rings once per new order and remembers explicit mute', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).soundNotes = 0;
    (window as any).AudioContext = class {
      state = 'suspended'; currentTime = 0; destination = {};
      async resume() { this.state = 'running'; } async close() { this.state = 'closed'; }
      createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() { (window as any).soundNotes++; }, stop() {}, onended: null }; }
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    };
  });
  await login(page);
  const senderCookie = (await page.context().cookies()).map(c => c.name + '=' + c.value).join('; ');
  await page.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } }); await page.reload();
  await expect(page.locator('.kitchen-bar')).toBeVisible(); // the kitchen account: Mutfak modu, the board at once
  expect(await page.evaluate(() => (window as any).soundNotes)).toBe(0);
  await expect(page.getByRole('button', { name: 'Sipariş sesini kapat' })).toBeVisible();
  await page.request.post('/api/staff/orders', { headers: { Cookie: senderCookie }, data: { requestId: 'sound-new-order', tableId: 'table-12', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } });
  await expect.poll(() => page.evaluate(() => (window as any).soundNotes)).toBe(3);
  await page.waitForTimeout(2300);
  expect(await page.evaluate(() => (window as any).soundNotes)).toBe(3);
  await page.getByRole('button', { name: 'Sipariş sesini kapat', exact: true }).click();
  await page.request.post('/api/staff/orders', { headers: { Cookie: senderCookie }, data: { requestId: 'sound-muted-order', tableId: 'table-12', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } });
  await expect(page.locator('.kitchen-card').filter({ hasText: 'Masa 12' })).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).soundNotes)).toBe(3);
  await page.locator('.kitchen-bar').getByRole('button', { name: 'Hesabım', exact: true }).click();
  await page.locator('.kitchen-bar').getByRole('button', { name: 'Mutfak panosu' }).click();
  await expect(page.getByRole('button', { name: 'Sipariş sesini aç', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sipariş sesini aç', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).soundNotes)).toBe(6);
});

test('product dialog survives selection drag; required hints and unsaved preview work', async ({ page }, info) => {
  await login(page);
  await page.getByRole('button', { name: 'Menü yönetimi', exact: true }).click();
  await page.getByRole('button', { name: 'Ürün ekle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Yeni ürün', exact: true });
  const save = dialog.getByRole('button', { name: 'Kaydet ve yayınla' });
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Kaydetme koşulları').hover();
  await expect(dialog.getByRole('tooltip')).toContainText('Ürün adını yazın.');
  await expect(dialog.getByRole('tooltip')).toContainText('Fiyat:');
  await dialog.getByLabel('Ürün adı', { exact: true }).fill('Önizleme Kahvesi');
  await dialog.getByLabel('Fiyat (TL)', { exact: true }).fill('125');
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Kaydetme koşulları').hover();
  await expect(dialog.getByRole('tooltip')).toContainText('Kategori seçin.');
  await dialog.getByLabel('Kategori', { exact: true }).selectOption('Kahveler');
  await expect(save).toBeEnabled();
  const input = dialog.getByLabel('Ürün adı', { exact: true });
  await input.scrollIntoViewIfNeeded(); const box = (await input.boundingBox())!;
  await page.mouse.move(box.x + 130, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(5, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
  await expect(dialog).toBeVisible(); await expect(input).toHaveValue('Önizleme Kahvesi');
  // Drag beginning on the backdrop must not count as a plain click either.
  await page.mouse.move(5, 100); await page.mouse.down(); await page.mouse.move(5, 180, { steps: 8 }); await page.mouse.up();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Önizleme', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Müşteri önizlemesi', exact: true });
  await expect(preview).toBeVisible(); await expect(preview).toContainText('125');
  await expect(preview.getByRole('button', { name: /Sepete ekle/ })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('product-preview.png') });
  await preview.getByRole('button', { name: 'Kapat', exact: true }).click();
  await expect(dialog).toBeVisible(); await expect(input).toHaveValue('Önizleme Kahvesi');
  const state = await (await page.request.get('/api/staff/state')).json();
  expect(state.products.some((p: any) => p.name === 'Önizleme Kahvesi')).toBe(false);
  await page.mouse.click(5, 100); await expect(dialog).not.toBeVisible();
});

test('business unavailable is explained and a rejected order can be retried', async ({ page, browser }) => {
  await login(page);
  const before = await (await page.request.get('/api/staff/state')).json();
  const context = await browser.newContext(); const guest = await context.newPage();
  await guest.goto(`/m/${before.tables[6].token}`);
  await guest.getByRole('button', { name: /Demleme Çay/ }).click();
  await guest.getByRole('button', { name: /Sepete ekle/ }).click();
  await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  let rejected = false;
  await guest.route('**/api/guest/orders', async route => {
    if (rejected) return route.continue(); rejected = true;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'BUSINESS_OFFLINE', message: 'İşletme şu anda sipariş alamıyor. Biraz sonra tekrar deneyin.' }) });
  });
  await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await expect(guest.getByRole('alert')).toContainText('İşletme şu anda sipariş alamıyor');
  await expect(guest.getByRole('alert')).not.toContainText('Bağlantı kesildi');
  await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await expect(guest.getByRole('dialog', { name: 'Siparişiniz alındı', exact: true })).toBeVisible();
  const after = await (await page.request.get('/api/staff/state')).json();
  expect(after.orders.length - before.orders.length).toBe(1);
  await context.close();
});
