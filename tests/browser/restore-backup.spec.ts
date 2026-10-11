import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { protectedPort, protectedServer, scenario } from './protected-server';

test('new computer: the first screen offers "Yedekten geri yükle"; a flash-drive backup and the recovery code bring the café back', async ({ page }, info) => {
  // The old computer: demo café, code written down, second copy on a flash drive.
  const oldRoot = scenario('restore-old'), flash = join(oldRoot, 'flash'); mkdirSync(flash);
  const old = await protectedServer(oldRoot, protectedPort(4), 'eski-pc');
  const code = (await old.desktop<{ code: string }>('/api/desktop/recovery/show', {})).data.code;
  await old.desktop('/api/desktop/recovery/confirm', {});
  expect((await old.desktop('/api/desktop/second-backup', { folder: flash, kind: 'usb', label: 'Flash bellek' })).status).toBe(200);
  expect((await old.desktop<{ lastError: string | null }>('/api/desktop/backup', {})).data.lastError).toBeNull();
  await old.stop();

  // A clean install on another computer (another Windows user).
  const root = scenario('restore-new');
  const server = await protectedServer(root, protectedPort(5), 'yeni-pc', true);
  try {
    await page.goto(`${server.base}/#masaustu=${server.token}`);
    const welcome = page.getByRole('dialog', { name: 'Mola’ya hoş geldiniz' });
    await expect(welcome).toBeVisible();
    await page.screenshot({ path: info.outputPath('welcome.png') });
    await welcome.getByRole('button', { name: /Yedekten geri yükle/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Yedekten geri yükle' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Yedek klasörü').fill(flash);
    await dialog.getByRole('button', { name: 'Ara' }).click();
    const found = dialog.getByRole('radiogroup', { name: 'Bulunan yedekler' }).getByRole('radio');
    await expect(found).toHaveCount(1);
    // When, how big, where: the flash drive's copy is "İkinci yer"; the newest checked one is picked already.
    await expect(found.first()).toBeChecked();
    const row = dialog.locator('.restore-list label').first();
    await expect(row.locator('.restore-meta')).toContainText('İkinci yer');
    await expect(row.locator('.restore-meta')).toContainText(/\d+(,\d)? (KB|MB)/);
    await expect(row.locator('.restore-meta')).toContainText('doğrulanmış');
    await expect(row.locator('strong')).toContainText(/\d{2}:\d{2}/);
    const restore = dialog.getByRole('button', { name: 'Geri yükle' });
    await expect(restore).toBeDisabled();
    // This computer's own new code is not the café's code.
    const own = (await server.desktop<{ code: string }>('/api/desktop/recovery/show', {})).data.code;
    await dialog.getByLabel('Kurtarma kodu').fill(own); await restore.click();
    await expect(dialog.getByText(/Kurtarma kodu yanlış/)).toBeVisible();
    await dialog.getByLabel('Kurtarma kodu').fill(code); await restore.click();
    await expect(dialog.getByText('Veriler geri yüklendi ve doğrulandı.', { exact: false })).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: info.outputPath('restored.png') });
    // The page reopens on the restored café: the demo owner can sign in; no first-run screen any more.
    await page.waitForURL(`${server.base}/`, { timeout: 15000 });
    await expect(page.getByRole('navigation', { name: 'Mola bilgisayar araçları' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Mola’ya hoş geldiniz' })).toHaveCount(0);
    const login = await page.request.post(`${server.base}/api/login`, { data: { username: 'isletme', password: 'MolaDemo!2026' } }); // installed mode: /api/health never hands out the demo password
    expect(login.status()).toBe(200);
    expect(readdirSync(root).some(n => n.startsWith('veri-bos-kurulum-'))).toBe(true);
    expect(existsSync(join(root, 'veri', 'development.key'))).toBe(false);
    // Only once, only on an empty install.
    expect((await server.desktop('/api/desktop/restore/backups')).status).toBe(409);
    // The flash drive it came from stays the second place: Yedekle shows it, the next backups go on there.
    expect((await server.desktop<{ folder: string }>('/api/desktop/second-backup')).data.folder).toBe(flash);
    await page.getByRole('navigation', { name: 'Mola bilgisayar araçları' }).getByRole('button', { name: 'Yedekle' }).click();
    await expect(page.getByRole('dialog', { name: 'Yedekle' }).getByText(flash, { exact: true })).toBeVisible();
  } finally { await server.stop(); }
});
