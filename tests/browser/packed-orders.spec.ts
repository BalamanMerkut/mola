import { randomUUID } from 'node:crypto';
import { ensureSetup } from './helpers';
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

test('guest ticks "Paket yapılsın" on one item: that line says PAKET for the guest, kitchen and owner; "Hepsini paketle" makes the kitchen card PAKETLENECEK; note examples fit the product', async ({ page, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  // A food product next to the café's tea, so the two note examples can be compared.
  const revision = async () => (await (await page.request.get('/api/staff/state')).json()).revision;
  const category = await page.request.post('/api/staff/categories', { data: { requestId: randomUUID(), revision: await revision(), action: 'add', name: 'Tostlar' } });
  expect(category.ok(), await category.text()).toBe(true);
  const product = await page.request.post('/api/staff/products', { data: { product: { code: '70', name: 'Kaşarlı Tost', nameEn: 'Cheese Toastie', category: 'Tostlar', description: 'Bol kaşarlı.', price: 9000, soldOut: false, art: 'food', photo: null, groups: [] } } });
  expect(product.ok(), await product.text()).toBe(true);
  const state = await (await page.request.get('/api/staff/state')).json();

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await context.newPage(); guest.on('pageerror', e => errors.push(e.message));
  await guest.goto(`/m/${state.tables[0].token}`);
  await guest.getByRole('button', { name: /Demleme Çay/ }).click();
  let dialog = guest.getByRole('dialog');
  await expect(dialog.getByLabel('Not ekle (isteğe bağlı)')).toHaveAttribute('placeholder', 'Örn. açık demli, limonlu');
  await dialog.getByRole('button', { name: /Sepete ekle/ }).click();
  await guest.getByRole('button', { name: /Kaşarlı Tost/ }).click();
  dialog = guest.getByRole('dialog');
  await expect(dialog.getByLabel('Not ekle (isteğe bağlı)')).toHaveAttribute('placeholder', 'Örn. soğansız, az pişmiş');
  await dialog.getByRole('button', { name: /Sepete ekle/ }).click();
  await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  // 13 Ekim: "Paket yapılsın" per item (here only the toast; the tea is drunk here), "Hepsini paketle" for all.
  const all = guest.getByRole('checkbox', { name: 'Hepsini paketle (yanımda götüreceğim)' });
  await expect(all).not.toBeChecked();
  await guest.getByRole('checkbox', { name: 'Paket yapılsın · Kaşarlı Tost' }).check();
  await expect(guest.getByRole('checkbox', { name: 'Paket yapılsın · Demleme Çay' })).not.toBeChecked();
  await expect(all).not.toBeChecked();
  await guest.screenshot({ path: info.outputPath('guest-basket-packed.png'), fullPage: true });
  await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await expect(guest.getByText(/Sipariş #\d+ alındı/)).toBeVisible();
  await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
  await guest.getByRole('button', { name: /Siparişlerim/ }).click();
  // Only the toast's line says PAKET; the order is not "all packed".
  await expect(guest.locator('.customer-order .packed-line')).toHaveCount(1);
  await expect(guest.locator('.customer-order .order-line').filter({ hasText: 'Kaşarlı Tost' }).locator('.packed-line')).toHaveText('PAKET');
  await expect(guest.locator('.customer-order .packed-badge:not(.packed-line)')).toHaveCount(0);
  await guest.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(guest.locator('.customer-order .packed-line')).toHaveText('PACK');

  const kitchen = await staffPage(browser, 'mutfak'); kitchen.page.on('pageerror', e => errors.push(e.message));
  const card = kitchen.page.locator('.kitchen-card').filter({ hasText: 'Kaşarlı Tost' });
  await expect(card.locator('.order-line').filter({ hasText: 'Kaşarlı Tost' }).locator('.packed-line.packed-loud')).toHaveText('PAKET');
  await expect(card.locator('.order-line').filter({ hasText: 'Demleme Çay' }).locator('.packed-line')).toHaveCount(0);
  await expect(card).toContainText('Masa 01');
  await kitchen.page.screenshot({ path: info.outputPath('kitchen-packed.png'), fullPage: true });

  // The owner's table window reads it too; staff ordering for a table gets "Hepsini paketle".
  await page.reload();
  await page.getByRole('button', { name: /Masa 01/ }).click();
  await expect(page.getByRole('dialog').locator('.packed-line')).toHaveText('PAKET');
  const waiter = await staffPage(browser, 'garson'); waiter.page.on('pageerror', e => errors.push(e.message));
  await waiter.page.getByRole('navigation').getByRole('button', { name: 'Sipariş al', exact: true }).click();
  await waiter.page.getByLabel('Sipariş masası').selectOption('table-2');
  // Waiters have no product-number box: the product's round "+" adds one.
  await waiter.page.getByRole('button', { name: 'Demleme Çay · bir adet ekle', exact: true }).click();
  await waiter.page.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await waiter.page.getByRole('checkbox', { name: 'Hepsini paketle (müşteri götürecek)' }).check();
  await expect(waiter.page.getByRole('checkbox', { name: 'Paket yapılsın · Demleme Çay' })).toBeChecked();
  await waiter.page.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await expect(waiter.page.getByText(/Sipariş #\d+ mutfağa gönderildi/)).toBeVisible();
  await expect(kitchen.page.locator('.kitchen-card').filter({ hasText: 'Masa 02' }).locator('.packed-loud')).toHaveText('PAKETLENECEK', { timeout: 15000 });
  expect(errors).toEqual([]);
  await waiter.context.close(); await kitchen.context.close(); await context.close();
});
