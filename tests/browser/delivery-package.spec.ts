import { test, expect } from '@playwright/test';
import { ensureSetup, openReport, openSettings, openView } from './helpers';
test('owner sees refund history tools and Authenticator setup on mobile without horizontal overflow', async ({ page }, info) => {
  expect((await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } })).ok()).toBe(true); await ensureSetup(page.request);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await openView(page, 'Satış ve Raporlar');
  await openReport(page, 'İade ve düzeltme');
  await expect(page.getByRole('heading', { name: 'İade ve düzeltme' })).toBeVisible();
  await expect(page.getByLabel('Tahsilat ara', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'İade ve düzeltme hakkında bilgi', exact: true }).click();
  await expect(page.getByRole('tooltip')).toContainText('İade kaydı bankadan para göndermez');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('payment-records-mobile.png'), fullPage: true });
  await openSettings(page, 'Telefonum');
  // The section's own heading (Uzaktan yönetim's notice also names it, in bold).
  await page.locator('summary').getByText('Raporlar için telefon kodu', { exact: true }).click();
  await expect(page.getByLabel('İşletme şifreniz')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('İşletme şifreniz').fill('MolaDemo!2026');
  await page.getByRole('button', { name: 'Telefon kodunu kur', exact: true }).click();
  await expect(page.getByAltText('Doğrulama uygulaması kurulum QR kodu')).toBeVisible();
  await page.screenshot({ path: info.outputPath('authenticator-mobile.png'), fullPage: true });
});
