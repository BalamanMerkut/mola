import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { ensureSetup, openSettings, openYonetim, yonetimState } from './helpers';

// Name, logo and colours are the owner's own business data: changed in Ayarlar on the café computer (no longer by the vendor).
test('the owner sets name, logo and theme in Ayarlar; they reach the guest; Mola Yönetim learns only the name', async ({ page, browser }, info) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  await page.goto('/');
  await openSettings(page, 'İşletme');
  const card = page.locator('section.business-profile');
  await expect(card.getByRole('heading', { name: /İşletme görünümü/ })).toBeVisible();
  await card.getByLabel('İşletme adı *', { exact: true }).fill('Logo Test Kafe');
  const buffer = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 120, height: 120, channels: 4, background: '#234f41' } }).png().toBuffer(), left: 90, top: 90 }]).png().toBuffer();
  await card.getByLabel('Logo', { exact: true }).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer });
  for (const [label, value] of [['Logo yakınlaştır', '1.5'], ['Logo yatay konum', '25'], ['Logo dikey konum', '-20']]) {
    await card.getByRole('slider', { name: label, exact: true }).fill(value);
  }
  await card.getByRole('button', { name: 'Logo yatay konum sıfırla', exact: true }).click();
  await expect(card.getByRole('slider', { name: 'Logo yatay konum', exact: true })).toHaveValue('0');
  await expect(card.getByRole('slider', { name: 'Logo dikey konum', exact: true })).toHaveValue('-20');
  await expect(card.getByRole('slider', { name: 'Logo yakınlaştır', exact: true })).toHaveValue('1.5');
  await card.getByRole('button', { name: 'Logo dikey konum sıfırla', exact: true }).click();
  await card.getByRole('button', { name: 'Logo yakınlaştır sıfırla', exact: true }).click();
  await card.getByRole('button', { name: 'Logoyu kullan', exact: true }).click();
  await expect(card.getByAltText('Logo önizlemesi')).toBeVisible();
  // The Google review link moved to Sosyal medya (6 Ekim): not asked here any more.
  await expect(card.getByLabel('Google işletme bağlantısı')).toHaveCount(0);
  await card.getByRole('button', { name: 'Kahve · Krem' }).click();
  await expect(card.getByRole('button', { name: /Kahve · Krem/ })).toHaveAttribute('aria-pressed', 'true');
  await card.getByLabel('Karşılama başlığı *', { exact: true }).fill('Taze lezzetler burada');
  await card.getByLabel('Menü simgesi', { exact: true }).selectOption('food');
  await card.getByText('İngilizce metinler', { exact: true }).click();
  await card.getByLabel('İngilizce başlık', { exact: true }).fill('Fresh flavours await');
  await card.getByLabel('İngilizce açıklama', { exact: true }).fill('   ');
  await card.getByRole('button', { name: 'English', exact: true }).click();
  await expect(card.locator('.hero-live-preview h1')).toHaveText('Fresh flavours await');
  await expect(card.locator('.hero-live-preview h1')).toHaveAttribute('lang', 'en');
  await expect(card.locator('.hero-live-preview p')).toHaveAttribute('lang', 'tr');
  await expect(card.getByText('İngilizcesi boş olan alanlarda Türkçe metin gösteriliyor.')).toBeVisible();
  await card.getByRole('button', { name: 'Türkçe', exact: true }).click();
  await expect(card.locator('.hero-live-preview h1')).toHaveText('Taze lezzetler burada');
  await expect(card.getByText('Kaydedilmemiş değişiklikler var.')).toBeVisible();
  // A lost answer: the same request is checked again, never applied twice.
  await page.route('**/api/staff/business-profile', async route => { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort(); });
  await card.getByRole('button', { name: 'Bilgileri kaydet' }).click();
  await expect(card.getByRole('button', { name: 'Kaydı yeniden kontrol et', exact: true })).toBeVisible();
  await page.unroute('**/api/staff/business-profile');
  await card.getByRole('button', { name: 'Kaydı yeniden kontrol et', exact: true }).click();
  await expect(card.getByText('İşletme görünümü kaydedildi. Menü ve panel güncellendi.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Bilgileri kaydet' })).toBeDisabled();
  await card.getByRole('button', { name: 'Logoyu düzenle', exact: true }).click();
  const canvasAlpha = await card.locator('.logo-canvas canvas').evaluate((canvas: HTMLCanvasElement) => {
    const c = canvas.getContext('2d')!; return [c.getImageData(0, 0, 1, 1).data[3], c.getImageData(128, 128, 1, 1).data[3]];
  });
  expect(canvasAlpha).toEqual([0, 255]);
  await card.getByRole('button', { name: 'Vazgeç', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('settings-profile-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 860 });
  let state = await (await page.request.get('/api/staff/state')).json();
  // The Google review row of Sosyal medya.
  expect((await page.request.post('/api/staff/social-links', { data: { requestId: 'profile-review-row', version: state.businessRevision, links: { review: 'https://share.google/gkp5TlYouPKRb6ja9' } } })).ok()).toBe(true);
  state = await (await page.request.get('/api/staff/state')).json();
  expect(state.theme).toBe('coffee'); expect(state.name).toBe('Logo Test Kafe');
  const decoded = await sharp(Buffer.from(state.logo.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(decoded.data[3]).toBe(0);
  expect(decoded.data[(128 * decoded.info.width + 128) * 4 + 3]).toBe(255);
  await page.reload();
  await expect(page.locator('.workspace')).toHaveCSS('background-color', 'rgb(232, 225, 213)');

  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage(); await guest.goto(`/m/${state.tables[0].token}`);
    await expect(guest.getByRole('heading', { name: 'Taze lezzetler burada' })).toBeVisible();
    const art = guest.locator('.product-art').first();
    const circle = await art.locator('.art-circle').boundingBox(), symbol = await art.locator('svg').boundingBox();
    expect(Math.abs(circle!.x + circle!.width / 2 - symbol!.x - symbol!.width / 2)).toBeLessThan(1);
    expect(Math.abs(circle!.y + circle!.height / 2 - symbol!.y - symbol!.height / 2)).toBeLessThan(1);
    await expect(guest.locator('.customer')).toHaveCSS('background-color', 'rgb(232, 225, 213)');
    await guest.screenshot({ path: info.outputPath('coffee-theme.png'), fullPage: true });
    await expect(guest.locator('.customer-header img')).toBeVisible();
    await expect(guest.locator('.customer-header')).toContainText('Logo Test Kafe');
    // The Google review question waits until the guest's bill is paid: nothing while still ordering.
    await expect(guest.locator('.review-prompt')).toHaveCount(0);
    await expect(guest.locator('.review-link')).toHaveCount(0);
    await expect(guest).toHaveTitle('Logo Test Kafe · Menü');
    await guest.setViewportSize({ width: 390, height: 844 });
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guest.getByRole('button', { name: /Demleme Çay/ }).click();
    await guest.getByRole('button', { name: /Sepete ekle/ }).click();
    await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
    await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
    const received = guest.getByRole('dialog', { name: 'Siparişiniz alındı' });
    await expect(received.getByRole('link', { name: /Google/ })).toHaveCount(0);
    await received.getByRole('button', { name: 'Siparişimi takip et', exact: true }).click();
    await expect(guest.getByRole('dialog', { name: 'Siparişiniz alındı' })).toHaveCount(0);
    await expect(guest.locator('.customer-order')).toContainText('Demleme Çay');
    // Paid at the counter: now the guest is asked once, with the owner's link.
    const account = (await (await page.request.get('/api/staff/state')).json()).tables[0].account;
    expect((await page.request.post('/api/staff/payments', { data: { requestId: 'review-after-payment', accountId: account.id, version: account.version, amount: account.balance, tendered: account.balance, method: 'cash' } })).ok()).toBe(true);
    const review = guest.locator('.review-prompt');
    await expect(review.getByRole('link', { name: 'Google’da değerlendirin' })).toHaveAttribute('href', 'https://share.google/gkp5TlYouPKRb6ja9', { timeout: 10000 });
    await expect(review.getByRole('link', { name: 'Google’da değerlendirin' })).toHaveAttribute('target', '_blank');
    await expect(review.getByRole('heading', { name: 'Bizi değerlendirin' })).toBeVisible();
    await expect(review.getByRole('button', { name: 'Şimdi değil' })).toHaveCount(0);
    await expect(guest.getByRole('heading', { name: 'Hesabınız kapandı' })).toBeVisible();
  } finally { await guestContext.close(); }

  // Mola Yönetim learns the new name with the next heartbeat; the logo, colours and menu never leave the café.
  const admin = await browser.newPage();
  await openYonetim(admin);
  await expect.poll(async () => (await yonetimState(admin.request)).businesses.find((b: any) => b.tenantId === 'mola-demo').name, { timeout: 15000 }).toBe('Logo Test Kafe');
  const listed = (await yonetimState(admin.request)).businesses.find((b: any) => b.tenantId === 'mola-demo');
  expect(listed.logo).toBeUndefined(); expect(listed.theme).toBeUndefined(); expect(listed.menuHero).toBeUndefined();
  await admin.close();
});
