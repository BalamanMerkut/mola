import { test, expect } from '@playwright/test';
import { ensureSetup, openSettings } from './helpers';

/*
 * Güvenlik ve yedek → Yedek → "Yeni bilgisayar için e-posta" (13 Ekim): the owner's own address for the "İşletmem var" code
 * (a business with no application), saved and removed; the owner only.
 */
const PASSWORD = 'MolaDemo!2026';
test('Yeni bilgisayar için e-posta: the owner saves and removes it; other staff cannot read or change it; fits a phone', async ({ page, browser }, info) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  await openSettings(page, 'Yedek');
  const card = page.locator('.owner-email-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Başvuru yapmadıysanız mutlaka yazın');
  await card.getByLabel('E-posta adresi').fill('Sahip@OrnekKafe.com');
  await card.getByRole('button', { name: 'Kaydet' }).click();
  await expect(card.getByText(/Kaydedildi/)).toBeVisible();
  expect((await (await page.request.get('/api/staff/owner-email')).json()).email).toBe('sahip@ornekkafe.com');
  await page.screenshot({ path: info.outputPath('yeni-bilgisayar-eposta.png') });
  await page.reload(); await openSettings(page, 'Yedek');
  await expect(card.getByLabel('E-posta adresi')).toHaveValue('sahip@ornekkafe.com');
  // A wrong address is refused by the server too (not only by the browser).
  const bad = await page.request.post('/api/staff/owner-email', { data: { requestId: 'kotu-eposta-1', email: 'adres-degil' } });
  expect(bad.status()).toBe(400);
  // Emptied: removed; the application's e-mail counts again.
  await card.getByLabel('E-posta adresi').fill('');
  await card.getByRole('button', { name: 'Kaldır' }).click();
  await expect(card.getByText(/Kaldırıldı/)).toBeVisible();
  expect((await (await page.request.get('/api/staff/owner-email')).json()).email).toBeNull();
  // Other staff: refused.
  const cashier = await browser.newContext(); const c = await cashier.newPage();
  await c.request.post('/api/login', { data: { username: 'kasiyer', password: PASSWORD } });
  expect((await c.request.get('/api/staff/owner-email')).status()).toBe(403);
  expect((await c.request.post('/api/staff/owner-email', { data: { requestId: 'kasiyer-eposta-1', email: 'x@y.co' } })).status()).toBe(403);
  await cashier.close();
  // A phone: nothing wider than the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
