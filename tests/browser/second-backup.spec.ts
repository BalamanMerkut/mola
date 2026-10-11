import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { protectedPort, protectedServer, scenario } from './protected-server';

test('second backup place: chosen in the rail, filled by "Şimdi yedekle", warns when the drive is gone, shown in Güvenlik', async ({ page }, info) => {
  const root = scenario('second-backup');
  const server = await protectedServer(root, protectedPort(3), 'kafe-pc');
  try {
    await server.desktop('/api/desktop/recovery/show', {}); await server.desktop('/api/desktop/recovery/confirm', {});
    const flash = join(root, 'flash'); mkdirSync(flash);
    await page.goto(`${server.base}/#masaustu=${server.token}`);
    await page.getByRole('navigation', { name: 'Mola bilgisayar araçları' }).getByRole('button', { name: 'Yedekle' }).click();
    const dialog = page.getByRole('dialog', { name: 'Yedekle' });
    await expect(dialog.getByText('Seçilmedi')).toBeVisible();
    // The open dialog stays current: a backup made elsewhere (the nightly run, the installer) shows up without reopening it.
    await expect(dialog.getByText('Henüz yedek alınmadı.')).toBeVisible();
    expect((await server.desktop<{ lastError: string | null }>('/api/desktop/backup', {})).data.lastError).toBeNull();
    await expect(dialog.getByText('Son yedek:', { exact: false })).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByText('Sonraki otomatik yedek:', { exact: false })).toContainText(/03:30/);
    await dialog.getByRole('button', { name: 'Yer seç' }).click();
    await dialog.getByRole('radio', { name: 'Başka klasör' }).check();
    await dialog.getByLabel('Klasör yolu').fill(join(root, 'olmayan-yer'));
    await dialog.getByRole('button', { name: 'Bu yeri kullan' }).click();
    await expect(dialog.getByText('Bu klasör bulunamadı.')).toBeVisible();
    await dialog.getByLabel('Klasör yolu').fill(flash);
    await dialog.getByRole('button', { name: 'Bu yeri kullan' }).click();
    await expect(dialog.getByText(flash, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Şimdi yedekle' }).click();
    await expect(dialog.getByText('Yedek alındı ve doğrulandı.')).toBeVisible({ timeout: 30000 });
    await expect(dialog.locator('.second-card .backup-ok')).toBeVisible();
    const copies = join(flash, 'Mola-Yedek');
    expect(existsSync(join(copies, 'BENIOKU.txt'))).toBe(true);
    const install = readdirSync(copies).find(n => /^[a-f0-9-]{36}$/.test(n))!;
    expect(readdirSync(join(copies, install)).filter(n => n.startsWith('backup-'))).toHaveLength(1);
    await page.screenshot({ path: info.outputPath('second-place.png') });

    // The flash drive is pulled out: the backup is still made, the second copy is a clear warning, and the rail shows a dot.
    renameSync(flash, join(root, 'cekmecede'));
    await dialog.getByRole('button', { name: 'Şimdi yedekle' }).click();
    await expect(dialog.getByText('Yedek alındı ve doğrulandı.')).toBeVisible({ timeout: 30000 });
    await expect(dialog.getByText('İkinci yedek klasörü bulunamadı, ikinci yedek alınamadı.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Kapat', exact: true }).click();
    await expect(page.getByLabel('İkinci yedek alınamadı')).toBeVisible();

    // The same card in the window's Güvenlik dialog (the café computer is the only place that shows it).
    await page.getByRole('navigation', { name: 'Mola bilgisayar araçları' }).getByRole('button', { name: 'Güvenlik' }).click();
    const security = page.getByRole('dialog', { name: 'Güvenlik' });
    await expect(security.getByText('İkinci yedek klasörü bulunamadı, ikinci yedek alınamadı.')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('security-second-phone.png'), fullPage: true });
    await security.getByRole('button', { name: 'Kapat', exact: true }).click();
    // Back in: the next backup copies again and the warning is gone.
    renameSync(join(root, 'cekmecede'), flash);
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.getByRole('navigation', { name: 'Mola bilgisayar araçları' }).getByRole('button', { name: 'Yedekle' }).click();
    await dialog.getByRole('button', { name: 'Şimdi yedekle' }).click();
    await expect(dialog.getByText('Yedek alındı ve doğrulandı.')).toBeVisible({ timeout: 30000 });
    await expect(dialog.locator('.second-card .backup-ok')).toBeVisible({ timeout: 30000 });
    await expect(dialog.getByText('ikinci yedek alınamadı', { exact: false })).toHaveCount(0);
  } finally { await server.stop(); }
});
