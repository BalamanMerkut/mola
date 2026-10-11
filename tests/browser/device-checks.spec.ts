import { test, expect } from '@playwright/test';
import { ensureSetup, openSettings } from './helpers';

test('device diagnostics preserve unsaved settings, recover from failure and export no account data', async ({ page }, info) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } }); await ensureSetup(page.request);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await openSettings(page, 'Sipariş ve onay');
  await page.getByLabel('Sipariş değişiklik süresi (saniye)', { exact: true }).fill('23');
  // Another topic: the number is saved on the way (leaving the box) and still there when the owner comes back.
  await openSettings(page, 'Cihazlar');
  const section = page.locator('.device-checks');
  await expect(section).toContainText('Henüz kontrol edilmedi');
  await page.route('**/api/health', route => route.abort());
  await section.getByRole('button', { name: 'Bağlantıyı kontrol et', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('Ulaşılamadı');
  await page.unroute('**/api/health');
  await section.getByRole('button', { name: 'Yeniden kontrol et', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('Bağlı');
  await section.getByRole('button', { name: 'Destek için özeti göster' }).click();
  const report = await section.locator('textarea').inputValue();
  expect(report).toContain('Sunucu erişimi: Başarılı');
  for (const secret of ['MolaDemo', 'isletme', 'mola-demo', 'localhost', '127.0.0.1', '₺']) expect(report).not.toContain(secret);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await section.screenshot({ path: info.outputPath('device-checks-mobile.png') });
  await openSettings(page, 'Sipariş ve onay');
  await expect(page.getByLabel('Sipariş değişiklik süresi (saniye)', { exact: true })).toHaveValue('23');
  expect((await (await page.request.get('/api/staff/state')).json()).changeSeconds).toBe(23);
});
