import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { merkezPort, yonetimShot } from './helpers';
import { scenario } from './protected-server';

// Its own Mola Merkez (port 3192 / E2E_MERKEZ_PORT+2) with a freshly generated first password: the shared test Merkez has already changed it.
test('a new Mola Yönetim asks for the first password to be changed before anything else; the success message is green', async ({ page }) => {
  test.setTimeout(90_000);
  const port = merkezPort(2), root = scenario('ilk-sifre'), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/merkez/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, MERKEZ_PORT: String(port), MERKEZ_DATA_DIR: join(root, 'merkez'), SERVE_BUILD: '1', MOLA_AUTO_BACKUP: '0', MOLA_MODE: 'installed' } });
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  try {
    for (let i = 0; ; i++) { try { if ((await fetch(`${base}/api/merkez/v1/health`)).ok) break; } catch { /* starting */ } if (i > 160) throw new Error('Merkez açılmadı.'); await new Promise(r => setTimeout(r, 125)); }
    const first = readFileSync(join(root, 'merkez', 'merkez-first-login.txt'), 'utf8').match(/Şifre: (.+)/)![1].trim();
    await page.goto(`${base}/`);
    // The installed Mola Yönetim (MOLA_MODE=installed) shows no "Yerel test ortamı" hints.
    await expect(page.getByText(/merkez-first-login\.txt dosyasındadır/)).toHaveCount(0);
    await page.getByLabel('Kullanıcı adı').fill('admin');
    await page.getByLabel('Şifre', { exact: true }).fill(first);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await expect(page.getByRole('heading', { name: /İlk şifreyi değiştirin/ })).toBeVisible();
    // The same door as the login: the brand panel and one card.
    await expect(page.locator('.auth-brand')).toContainText('Merkut Studios');
    await page.setViewportSize({ width: 1280, height: 860 });
    await yonetimShot(page, 'ilk-sifre.png', test.info().outputPath('first-password.png'));
    await expect(page.getByRole('navigation', { name: 'Mola Yönetim bölümleri' })).toHaveCount(0);
    expect((await page.request.get(`${base}/api/merkez/admin/state`)).status()).toBe(403);
    await page.getByLabel('Mevcut yönetici şifresi').fill(first);
    // A weak password: said in words while typing, and the button waits (Mola Merkez refuses it too).
    for (const [weak, why] of [['aaaaaaaaaaaa', /tekrar/], ['123456789012', /ardışık/], ['MolaAdmin2026', /mola/]] as const) {
      await page.getByLabel('Yeni yönetici şifresi').fill(weak); await page.getByLabel('Yeni şifre tekrar').fill(weak);
      await expect(page.locator('.field-hint')).toContainText(why);
      await expect(page.getByRole('button', { name: 'Şifreyi değiştir ve oturumları kapat' })).toBeDisabled();
    }
    const refused = await page.request.post(`${base}/api/merkez/admin/password`, { data: { currentPassword: first, newPassword: 'aaaaaaaaaaaa' } });
    expect(refused.status()).toBe(400); expect((await refused.json()).code).toBe('WEAK_PASSWORD');
    await page.getByLabel('Yeni yönetici şifresi').fill('BenimSifrem!2026');
    await page.getByLabel('Yeni şifre tekrar').fill('BenimSifrem!2026');
    await page.getByRole('button', { name: 'Şifreyi değiştir ve oturumları kapat' }).click();
    const done = page.locator('.notice-success').filter({ hasText: 'Şifreniz değiştirildi' });
    await expect(done).toBeVisible(); await expect(page.locator('.notice-error')).toHaveCount(0);
    await page.getByLabel('Şifre', { exact: true }).fill('BenimSifrem!2026');
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Mola Yönetim bölümleri' })).toBeVisible();
    await expect(page.locator('.platform-local-note')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Bildirim merkezi' })).toBeVisible();
  } finally { child.kill(); await exited; }
});
