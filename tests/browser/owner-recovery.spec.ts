import { test, expect } from '@playwright/test';
import { protectedPort, protectedServer, scenario } from './protected-server';

// The vendor can no longer reset an owner's password (it has no account data); the owner does it on the café computer.
test('the owner forgot the password: the recovery code in the café window sets a new one without ending a waiter session', async ({ page, browser }, info) => {
  const root = scenario('owner-recovery');
  const server = await protectedServer(root, protectedPort(6), 'kafe-pc');
  const owner = await browser.newContext(), waiter = await browser.newContext();
  try {
    const code = (await server.desktop<{ code: string }>('/api/desktop/recovery/show', {})).data.code;
    await server.desktop('/api/desktop/recovery/confirm', {});
    expect((await owner.request.post(`${server.base}/api/login`, { data: { username: 'isletme', password: 'MolaDemo!2026' } })).ok()).toBe(true);
    expect((await waiter.request.post(`${server.base}/api/login`, { data: { username: 'garson', password: 'MolaDemo!2026' } })).ok()).toBe(true);
    await page.goto(`${server.base}/#masaustu=${server.token}`);
    // No "Yönetim" in the rail: the vendor's panel is not on the café computer.
    const rail = page.getByRole('navigation', { name: 'Mola bilgisayar araçları' });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('link', { name: 'Yönetim' })).toHaveCount(0);
    await expect(rail.getByText('Yönetim', { exact: true })).toHaveCount(0);
    await rail.getByRole('button', { name: 'Güvenlik' }).click();
    const dialog = page.getByRole('dialog', { name: 'Güvenlik' });
    await expect(dialog.getByRole('heading', { name: /İşletme sahibi şifresini unuttum/ })).toBeVisible();
    // Two steps: the code alone first (the owner may have forgotten the username too), then the account and the new password.
    const box = dialog.locator('.owner-reset-box');
    await expect(box.getByRole('button', { name: 'Kurtarma kodu', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(box.getByRole('button', { name: 'Mola ekibinden kod' })).toBeEnabled();
    const check = box.getByRole('button', { name: 'Kodu kontrol et' });
    await box.getByLabel('Kurtarma kodu', { exact: true }).fill('2222-3333-4444-5555-6666-7777');
    await check.click();
    await expect(box.getByText(/Kurtarma kodu yanlış/)).toBeVisible();
    await box.getByLabel('Kurtarma kodu', { exact: true }).fill(code.toLowerCase());
    await check.click();
    const accounts = box.getByRole('radiogroup', { name: 'İşletme sahibi hesabı' });
    await expect(accounts.getByRole('radio')).toHaveCount(2);
    const save = box.getByRole('button', { name: 'Yeni şifreyi kaydet' });
    await box.getByLabel('Yeni şifre', { exact: true }).fill('NewBusinessSecret!2026');
    await box.getByLabel('Yeni şifre tekrar').fill('NewBusinessSecret!2026');
    await expect(save).toBeDisabled();
    await accounts.getByRole('radio', { name: /isletme/ }).check();
    await page.screenshot({ path: info.outputPath('owner-reset-accounts.png') });
    await save.click();
    await expect(box.getByText('Yeni şifre kaydedildi', { exact: false })).toBeVisible();
    expect((await owner.request.get(`${server.base}/api/staff/state`)).status()).toBe(401);
    expect((await waiter.request.get(`${server.base}/api/staff/state`)).status()).toBe(200);
    expect((await owner.request.post(`${server.base}/api/login`, { data: { username: 'isletme', password: 'NewBusinessSecret!2026' } })).ok()).toBe(true);
    // Not from a tablet or anything without this window's key.
    expect((await waiter.request.post(`${server.base}/api/desktop/owner-password`, { data: { username: 'isletme', code, newPassword: 'Another!Secret2026' } })).status()).toBe(404);
    expect((await waiter.request.post(`${server.base}/api/desktop/owner-password/owners`, { data: { code } })).status()).toBe(404);
    // Not through a proxy or tunnel even with the window key.
    expect((await waiter.request.post(`${server.base}/api/desktop/owner-password/owners`, { data: { code }, headers: { 'X-Mola-Desktop': server.token, 'X-Forwarded-For': '192.168.1.20' } })).status()).toBe(404);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('owner-reset-phone.png'), fullPage: true });
  } finally { await owner.close(); await waiter.close(); await server.stop(); }
});
