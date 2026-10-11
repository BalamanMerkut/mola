import { test, expect } from '@playwright/test';
import { ensureSetup } from './helpers';

// The browser-test server runs like an installed café (SERVE_BUILD=1, scripts/test-server.mjs): developer wording and the
// demo password must never show, whatever the address (127.0.0.1 here; 192.168.x.x in a café).
const DEV_TEXTS = [/YEREL TEST/i, /Bu ortam deneme içindir/, /Yerel geliştirme alanı/, /Yerel deneme verileri/, /Müşteri menüsünü denemek için/, /Demo şifresi/, /Deneme hesabı hazır/, /npm run/];

test('an installed café shows no test or developer wording and no demo password', async ({ page }) => {
  const health = await (await page.request.get('/api/health')).json();
  expect(health.mode).toBe('installed'); expect(health.demoAvailable).toBe(false); expect(health.demo).toBeUndefined();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Çalışma alanını aç' })).toBeVisible();
  await expect(page.getByLabel('Kullanıcı adı', { exact: true })).toHaveValue('');
  const login = await page.locator('body').innerText();
  for (const text of DEV_TEXTS) expect(login).not.toMatch(text);
  await page.getByLabel('Kullanıcı adı', { exact: true }).fill('isletme');
  await page.getByLabel('Şifre', { exact: true }).fill('MolaDemo!2026');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/login')), page.getByRole('button', { name: 'Çalışma alanını aç' }).click()]);
  await ensureSetup(page.request); await page.reload();
  await expect(page.getByRole('button', { name: 'Çıkış yap' }).first()).toBeVisible();
  await page.getByRole('button', { name: /Masa 01/ }).click();
  await page.getByRole('button', { name: 'QR menüyü aç' }).click();
  await expect(page.getByRole('link', { name: 'Müşteri menüsünü aç' })).toBeVisible();
  const owner = await page.locator('body').innerText();
  for (const text of DEV_TEXTS) expect(owner).not.toMatch(text);
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  // Staff without the support button see the plain version label.
  await page.request.post('/api/login', { data: { username: 'garson', password: 'MolaDemo!2026' } });
  await page.reload();
  await expect(page.getByText('SÜRÜM 0.1.0')).toBeVisible();
  const waiter = await page.locator('body').innerText();
  for (const text of DEV_TEXTS) expect(waiter).not.toMatch(text);
});
