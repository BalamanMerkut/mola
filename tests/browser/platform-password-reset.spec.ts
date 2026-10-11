import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { merkezPort, yonetimShot } from './helpers';
import { scenario } from './protected-server';

// Its own Mola Merkez (port 3193 / E2E_MERKEZ_PORT+3): the reset changes the admin password, the shared test Merkez must keep its own.
test('Şifremi unuttum: from the login screen, the Merkez recovery code (Ayarlar → Yedek) and a new password; then the new password signs in', async ({ page }) => {
  test.setTimeout(120_000);
  const port = merkezPort(3), root = scenario('sifre-sifirla'), base = `http://127.0.0.1:${port}`, old = 'Eski-Kirmizi-Kapi-29', fresh = 'Yeni-Mavi-Bahce-47';
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/merkez/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, MERKEZ_PORT: String(port), MERKEZ_DATA_DIR: join(root, 'merkez'), SERVE_BUILD: '1', MOLA_AUTO_BACKUP: '0', MOLA_MODE: 'installed', MERKEZ_INITIAL_PASSWORD: old } });
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  try {
    for (let i = 0; ; i++) { try { if ((await fetch(`${base}/api/merkez/v1/health`)).ok) break; } catch { /* starting */ } if (i > 240) throw new Error('Merkez açılmadı.'); await new Promise(r => setTimeout(r, 125)); }
    // The code the vendor wrote down from Ayarlar → Yedek (read here through the same API the card uses).
    const login = await fetch(`${base}/api/merkez/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: old }) });
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const code = ((await (await fetch(`${base}/api/merkez/admin/recovery/show`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' })).json()) as { code: string }).code;
    expect(code).toMatch(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);

    await page.goto(`${base}/`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('button', { name: 'Şifremi unuttum' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('login.png') });
    await page.getByRole('button', { name: 'Şifremi unuttum' }).click();
    await expect(page.getByRole('heading', { name: 'Şifremi unuttum' })).toBeVisible();
    // Where each code comes from, in plain words; the last resort is named too.
    await expect(page.getByText('Ayarlar → Yedek’te gösterilen 24 harflik kurtarma kodu', { exact: false })).toBeVisible();
    await expect(page.getByText('İki adımlı doğrulamanın yedek kodları', { exact: false })).toBeVisible();
    await expect(page.locator('.auth-dev')).toContainText('Sifre-Sifirla.cmd');
    await expect(page.getByRole('radio', { name: /Merkez kurtarma kodu/ })).toBeChecked();
    await page.setViewportSize({ width: 1280, height: 900 });
    await yonetimShot(page, 'sifremi-unuttum.png', test.info().outputPath('reset-code.png'));
    // A wrong code: said plainly, nothing changes.
    await page.getByLabel('Merkez kurtarma kodu', { exact: true }).fill('2222-3333-4444-5555-6666-7777');
    await page.getByRole('button', { name: 'Devam et' }).click();
    await expect(page.locator('.notice-error')).toContainText('Kod doğrulanamadı');
    await page.getByLabel('Merkez kurtarma kodu', { exact: true }).fill(code.toLowerCase());
    await page.getByRole('button', { name: 'Devam et' }).click();
    await expect(page.getByRole('heading', { name: 'Yeni şifre belirleyin' })).toBeVisible({ timeout: 15000 });
    // The same strength rule as everywhere, while typing.
    await page.getByLabel('Yeni yönetici şifresi').fill('MolaAdmin2026'); await page.getByLabel('Yeni şifre tekrar').fill('MolaAdmin2026');
    await expect(page.locator('.field-hint')).toContainText('mola');
    await expect(page.getByRole('button', { name: 'Şifreyi yenile ve oturumları kapat' })).toBeDisabled();
    await page.getByLabel('Yeni yönetici şifresi').fill(fresh); await page.getByLabel('Yeni şifre tekrar').fill(fresh);
    await expect(page.locator('.field-hint')).toHaveCount(0);
    await yonetimShot(page, 'sifremi-unuttum-yeni.png', test.info().outputPath('reset-password.png'));
    await page.getByRole('button', { name: 'Şifreyi yenile ve oturumları kapat' }).click();
    await expect(page.locator('.notice-success')).toContainText('Şifreniz yenilendi');
    // The session from before is gone; the old password no longer works; the new one does.
    expect((await fetch(`${base}/api/merkez/admin/state`, { headers: { Cookie: cookie } })).status).toBe(401);
    await page.getByLabel('Kullanıcı adı').fill('admin');
    await page.getByLabel('Şifre', { exact: true }).fill(old);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await expect(page.locator('.notice-error')).toContainText('Giriş bilgileri yanlış');
    await page.getByLabel('Şifre', { exact: true }).fill(fresh);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Mola Yönetim bölümleri' })).toBeVisible();
    const state = await (await page.request.get(`${base}/api/merkez/admin/state`)).json();
    expect(state.alerts.some((a: { kind: string; title: string }) => a.kind === 'admin.password_reset' && a.title === 'Yönetici şifresi değiştirildi')).toBe(true);
    expect(state.audit.some((a: { action: string }) => a.action === 'admin.password_reset')).toBe(true);
    // On a phone the reset screen fits too.
    await page.request.post(`${base}/api/merkez/admin/logout`, { data: {} });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Şifremi unuttum' }).click();
    await expect(page.getByRole('heading', { name: 'Şifremi unuttum' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Girişe dön' }).click();
    await expect(page.getByRole('button', { name: 'Giriş yap', exact: true })).toBeVisible();
  } finally { child.kill(); await exited; }
});
