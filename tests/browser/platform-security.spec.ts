import { test, expect } from '@playwright/test';
import { ADMIN_API, MERKEZ, merkezPassword, yonetimSettings } from './helpers';

test('Mola Yönetim admin changes password, revokes another session, and recovers a lost password response', async ({ page, browser }) => {
  const initial = merkezPassword();
  await page.goto(`${MERKEZ}/`); await page.getByLabel('Şifre', { exact: true }).fill(initial);
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  const other = await browser.newContext();
  try {
    await other.request.post(`${ADMIN_API}/login`, { data: { username: 'admin', password: initial } });
    await yonetimSettings(page, 'Hesap güvenliği');
    // Only the vendor's own account here: the cafés' recovery codes and backups are on their own computers.
    await expect(page.locator('.recovery-card')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const save = page.getByRole('button', { name: 'Şifreyi değiştir ve oturumları kapat' });
    await expect(save).toBeDisabled();
    const next = 'AdminBrowserTest!2026';
    await page.getByLabel('Mevcut yönetici şifresi').fill(initial);
    await page.getByLabel('Yeni yönetici şifresi').fill(next);
    await page.getByLabel('Yeni şifre tekrar').fill('mismatch');
    await expect(save).toBeDisabled();
    await page.getByLabel('Yeni şifre tekrar').fill(next); await save.click();
    await expect(page.getByRole('button', { name: 'Giriş yap', exact: true })).toBeVisible();
    expect((await other.request.get(`${ADMIN_API}/state`)).status()).toBe(401);
    await page.getByLabel('Şifre', { exact: true }).fill(next);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await yonetimSettings(page, 'Hesap güvenliği');
    await page.getByLabel('Mevcut yönetici şifresi').fill(next);
    await page.getByLabel('Yeni yönetici şifresi').fill(next + 'Second');
    await page.getByLabel('Yeni şifre tekrar').fill(next + 'Second');
    await page.route('**/api/merkez/admin/password', async route => { await route.fetch(); await route.abort('failed'); await page.unroute('**/api/merkez/admin/password'); });
    await save.click();
    await expect(page.getByRole('button', { name: 'Giriş yap', exact: true })).toBeVisible();
    await page.getByLabel('Şifre', { exact: true }).fill(next + 'Second');
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await yonetimSettings(page, 'İşlem geçmişi');
    // Three: the test server's own first change (forced), then the two here.
    await expect(page.getByText('Yönetici şifresi değiştirildi', { exact: true })).toHaveCount(3);
  } finally { await other.close(); }
});
