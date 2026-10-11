import { test, expect, type Page } from '@playwright/test';
import { protectedPort, protectedServer, scenario } from './protected-server';

const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('locked data: the café window unlocks with the recovery code, tablets and guests see a plain message', async ({ page, browser }, info) => {
  const root = scenario('key-lock');
  // The café's computer as it was: the code was written down on day one.
  const before = await protectedServer(root, protectedPort(1), 'eski-windows-kullanicisi');
  const code = (await before.desktop<{ code: string }>('/api/desktop/recovery/show', {})).data.code;
  await before.desktop('/api/desktop/recovery/confirm', {});
  await before.stop();
  // Windows password reset: the OS lock no longer opens the key.
  const server = await protectedServer(root, protectedPort(1), 'sifresi-sifirlanan-kullanici');
  try {
    expect((await (await fetch(`${server.base}/api/health`)).json()).locked).toBe(true);
    // A tablet on the café Wi-Fi: no way to unlock, only where to do it.
    const tablet = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const tabletPage = await tablet.newPage();
    await tabletPage.goto(server.base + '/');
    await expect(tabletPage.getByTestId('locked-screen')).toBeVisible();
    await expect(tabletPage.getByText('Kasa bilgisayarında kilit açılmalı', { exact: false })).toBeVisible();
    await expect(tabletPage.getByLabel('Kurtarma kodu')).toHaveCount(0);
    expect(await fits(tabletPage)).toBe(true);
    await tabletPage.screenshot({ path: info.outputPath('tablet-locked.png') });
    await tabletPage.goto(server.base + '/m/abcdefghijklmnop');
    await expect(tabletPage.getByText('Menü şu anda açılamıyor')).toBeVisible();
    await tablet.close();

    // The café computer's own window.
    await page.goto(`${server.base}/#masaustu=${server.token}`);
    await expect(page.getByRole('heading', { name: /Veriler kilitli/ })).toBeVisible();
    const input = page.getByLabel('Kurtarma kodu');
    const unlock = page.getByRole('button', { name: 'Kilidi aç' });
    await expect(unlock).toBeDisabled();
    await input.fill('2222-3333-4444-5555-6666-7777'); await unlock.click();
    await expect(page.getByText('Kurtarma kodu yanlış', { exact: false })).toBeVisible();
    await page.screenshot({ path: info.outputPath('desktop-locked.png') });
    await input.fill(code.toLowerCase()); await unlock.click();
    await expect(page.getByRole('heading', { name: 'Kilit açıldı' })).toBeVisible();
    // Back to the normal screens, with the rail of the desktop window.
    await expect(page.getByRole('navigation', { name: 'Mola bilgisayar araçları' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('locked-screen')).toHaveCount(0);
    expect((await (await fetch(`${server.base}/api/health`)).json()).locked).toBeUndefined();
  } finally { await server.stop(); }
  // Re-locked for the new Windows user: the next start needs no code.
  const after = await protectedServer(root, protectedPort(1), 'sifresi-sifirlanan-kullanici');
  try { expect((await (await fetch(`${after.base}/api/health`)).json()).locked).toBeUndefined(); }
  finally { await after.stop(); }
});
