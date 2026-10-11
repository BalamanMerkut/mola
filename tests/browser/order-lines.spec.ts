import { ensureSetup, openReport, openView } from './helpers';
import { test, expect, type Browser, type Page } from '@playwright/test';
async function login(page: Page, role = 'isletme') {
  await page.goto('/');
  await page.getByLabel('Kullanıcı adı', { exact: true }).fill(role);
  // The test server runs as an installed café: no demo password is filled in for us.
  await page.getByLabel('Şifre', { exact: true }).fill('MolaDemo!2026');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/login')), page.getByRole('button', { name: 'Çalışma alanını aç' }).click()]);
  await ensureSetup(page.request); await page.reload();
  await expect(page.getByRole('button', { name: 'Çıkış yap' })).toBeVisible();
}
async function staffPage(browser: Browser, role: string) { const context = await browser.newContext(); const page = await context.newPage(); await login(page, role); return { context, page }; }

test('guest adds a product with a note; the note reaches the kitchen card and the guest status', async ({ page, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  const state = await (await page.request.get('/api/staff/state')).json();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await context.newPage(); guest.on('pageerror', e => errors.push(e.message));
  await guest.goto(`/m/${state.tables[0].token}`);
  await guest.getByRole('button', { name: /Demleme Çay/ }).click();
  const dialog = guest.getByRole('dialog');
  await dialog.getByLabel('Not ekle (isteğe bağlı)').fill('  Az şekerli,   ince belli bardakta ');
  await expect(dialog).toContainText('/140');
  await dialog.getByRole('button', { name: /Sepete ekle/ }).click();
  await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await expect(guest.locator('.cart-line .line-note')).toHaveText('Not: Az şekerli, ince belli bardakta');
  await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await expect(guest.getByText(/Sipariş #\d+ alındı/)).toBeVisible();
  await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
  await guest.getByRole('button', { name: /Siparişlerim/ }).click();
  await expect(guest.locator('.customer-order .line-note')).toContainText('Az şekerli, ince belli bardakta');
  await guest.screenshot({ path: info.outputPath('guest-note.png'), fullPage: true });

  const kitchen = await staffPage(browser, 'mutfak');
  const card = kitchen.page.locator('.kitchen-card').filter({ hasText: 'Demleme Çay' });
  const note = card.locator('.line-note');
  await expect(note).toContainText('Az şekerli, ince belli bardakta');
  await expect(note).toHaveCSS('font-style', 'italic');
  await expect(note.locator('svg')).toBeVisible();
  await kitchen.page.screenshot({ path: info.outputPath('kitchen-note.png'), fullPage: true });
  // Owner's table window reads the same line.
  await page.getByRole('button', { name: /Masa 01/ }).click();
  await expect(page.getByRole('dialog').locator('.line-note')).toContainText('Az şekerli, ince belli bardakta');
  expect(errors).toEqual([]);
  await kitchen.context.close(); await context.close();
});

test('owner adds a kg product; waiter sells 500 g; kitchen reads "500 g"; cashier takes the whole line', async ({ page, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  await page.getByRole('button', { name: 'Menü yönetimi', exact: true }).click();
  await page.getByRole('button', { name: 'Ürün ekle', exact: true }).click();
  await page.getByLabel('Ürün adı', { exact: true }).fill('Fıstıklı Baklava');
  await page.getByLabel('Kategori', { exact: true }).selectOption('Tatlılar');
  await page.getByLabel('Satış birimi', { exact: true }).selectOption('kg');
  await page.getByLabel('Fiyat (TL / kg)', { exact: true }).fill('1200');
  await page.getByRole('button', { name: 'Kaydet ve yayınla' }).click();
  await expect(page.locator('.menu-row').filter({ hasText: 'Fıstıklı Baklava' })).toContainText('/ kg');

  const waiter = await staffPage(browser, 'garson'); waiter.page.on('pageerror', e => errors.push(e.message));
  // The waiter opens on Masalar (8 Ekim denetimi K6).
  await openView(waiter.page, 'Sipariş al');
  await waiter.page.getByLabel('Sipariş masası').selectOption('table-2');
  await waiter.page.getByRole('textbox', { name: 'Ürün ara' }).fill('Baklava');
  const product = waiter.page.locator('.staff-card').filter({ hasText: 'Fıstıklı Baklava' });
  await expect(product).toContainText('/ kg');
  await product.click();
  const dialog = waiter.page.getByRole('dialog');
  await expect(dialog).toContainText('Kiloyla satılır');
  await dialog.getByRole('button', { name: '1 kg', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Sepete ekle/ })).toContainText('1.200');
  await dialog.getByLabel('Ağırlık (gram)').fill('130');
  await expect(dialog.getByRole('button', { name: /Sepete ekle/ })).toBeDisabled();
  await expect(dialog).toContainText('50 g adımlarla');
  await dialog.getByRole('button', { name: '500 g', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Sepete ekle/ })).toContainText('500 g');
  await expect(dialog.getByRole('button', { name: /Sepete ekle/ })).toContainText('600');
  await dialog.getByLabel('Not ekle (isteğe bağlı)').fill('Ayrı paket');
  await dialog.screenshot({ path: info.outputPath('weight-dialog.png') });
  await dialog.getByRole('button', { name: /Sepete ekle/ }).click();
  await waiter.page.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await expect(waiter.page.locator('.cart-line .qty-badge')).toHaveText('500 g');
  await expect(waiter.page.getByRole('dialog').locator('.total-line')).toContainText('600');
  await waiter.page.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await expect(waiter.page.getByText(/Sipariş #\d+ mutfağa gönderildi/)).toBeVisible();

  const kitchen = await staffPage(browser, 'mutfak');
  const card = kitchen.page.locator('.kitchen-card').filter({ hasText: 'Fıstıklı Baklava' });
  await expect(card.locator('.qty-badge')).toHaveText('500 g');
  await kitchen.page.screenshot({ path: info.outputPath('kitchen-weight.png'), fullPage: true });

  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Masalar', exact: true }).click();
  await page.getByRole('button', { name: /Masa 02/ }).click();
  await expect(page.getByRole('dialog').locator('.qty-badge')).toHaveText('500 g');
  await page.getByRole('button', { name: 'Ödeme al', exact: true }).click();
  await expect(page.locator('.payment-balance')).toContainText('600');
  await page.getByRole('button', { name: 'Ürün seç', exact: true }).click();
  const whole = page.getByLabel('Fıstıklı Baklava ödenecek miktar');
  await expect(page.locator('.payment-item')).toContainText('bölünemez');
  await whole.check();
  await expect(page.getByText('Seçtiğiniz ürünlerin toplamı tahsil edilir: ₺600')).toBeVisible();
  await page.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
  await expect(page.getByText(/Hesap kapandı|Ödeme tamamlandı/)).toBeVisible();

  // Reports read the weight, not "1 satış"; the payment statement shows "500 g Fıstıklı Baklava" and the note.
  await page.reload();
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await expect(page.locator('.rank-row').filter({ hasText: 'Fıstıklı Baklava' }).locator('small')).toHaveText('500 g');
  await openReport(page, 'Ürünler');
  const productRow = page.locator('.product-table tbody tr').filter({ hasText: 'Fıstıklı Baklava' });
  await expect(productRow.locator('td').first()).toHaveText('500 g');
  await expect(page.locator('.product-table thead')).toContainText('Miktar');
  await page.screenshot({ path: info.outputPath('report-weight.png'), fullPage: true });
  await openReport(page, 'İade ve düzeltme');
  const ledgerRow = page.locator('.ledger-row').filter({ hasText: 'Masa 02' }).first();
  await ledgerRow.locator('.ledger-main').click();
  await expect(ledgerRow.locator('.ledger-items li').first()).toContainText('500 g Fıstıklı Baklava');
  await expect(ledgerRow.locator('.ledger-items .line-note')).toHaveText('Not: Ayrı paket');
  await expect(ledgerRow.locator('.ledger-items .line-note')).toHaveCSS('font-style', 'italic');
  await ledgerRow.screenshot({ path: info.outputPath('ledger-weight.png') });
  expect(errors).toEqual([]);
  await kitchen.context.close(); await waiter.context.close();
});
