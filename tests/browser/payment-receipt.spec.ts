import { test, expect } from '@playwright/test';
import { ensureSetup } from './helpers';

test('cashier sees receipt controls; an unreachable printer never undoes the saved payment', async ({ page }, info) => {
  test.setTimeout(60000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  // A private address that nothing answers: printing must fail, the payment must not.
  const printer = await page.request.post('/api/staff/printers', { data: { printer: { name: 'Kasa', enabled: true, connection: { type: 'network', host: '192.168.255.254', port: 9100 }, width: 80, charset: 'pc857', orders: false, categories: [], bill: true } } });
  expect(printer.ok()).toBe(true);
  let state = await (await page.request.get('/api/staff/state')).json();
  const tea = state.products.find((p: { groups: unknown[]; soldOut: boolean }) => !p.groups.length && !p.soldOut);
  expect((await page.request.post('/api/staff/orders', { data: { requestId: 'receipt-order-0001', tableId: state.tables[0].id, lines: [{ productId: tea.id, quantity: 1, selections: [] }], expectedTotal: tea.price } })).ok()).toBe(true);
  state = await (await page.request.get('/api/staff/state')).json();
  expect(state.printing).toEqual({ orders: false, bill: true });

  await page.goto('/');
  await page.locator('.table-card').first().click();
  await page.getByRole('button', { name: 'Ödeme al' }).click();
  await expect(page.getByRole('button', { name: 'Hesap fişi' })).toBeVisible();
  const printAfter = page.getByRole('checkbox', { name: 'Ödemeden sonra fiş yazdır' });
  await expect(printAfter).toBeChecked();
  await page.screenshot({ path: info.outputPath('payment-modal.png') });
  // The bill slip fails: the cashier reads what to check, never a tracking UUID; the change and the save button stay in sight.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('button', { name: 'Hesap fişi' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Yazıcıya ulaşılamadı. Kağıdı ve kabloyu kontrol edin.')).toBeVisible({ timeout: 15000 });
  await expect(dialog).not.toContainText('Takip kodu');
  await expect(dialog.getByRole('button', { name: 'Ödemeyi kaydet' })).toBeInViewport({ ratio: 1 });
  await expect(dialog.locator('.payment-change')).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
  await expect(page.locator('.toast')).toContainText('Hesap kapandı');
  await expect(page.locator('.toast')).not.toContainText('Para üstü', { timeout: 100 });
  await expect(page.getByText('Ödeme kaydedildi. Yazıcıya ulaşılamadı. Kağıdı ve kabloyu kontrol edin.')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Takip kodu/)).toHaveCount(0);
  const after = await (await page.request.get('/api/staff/state')).json();
  expect(after.tables[0].account).toBeNull();

  // The choice is remembered on this device.
  expect(await page.evaluate(() => localStorage.getItem('mola-print-after-payment'))).toBeNull();
  await page.evaluate(() => localStorage.setItem('mola-print-after-payment', '0'));
});
