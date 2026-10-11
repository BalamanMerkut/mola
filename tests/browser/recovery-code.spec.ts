import { test, expect, type Page } from '@playwright/test';
import { protectedPort, protectedServer, scenario, typeGroups } from './protected-server';

const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const CODE = /^[2-9A-Z]{4}(-[2-9A-Z]{4}){5}$/;

test('recovery code: shown once in the café window, printable, confirmed by typing two groups; reminder until then; a new code needs an owner password', async ({ page }, info) => {
  const root = scenario('recovery-code');
  const server = await protectedServer(root, protectedPort(2), 'kafe-pc');
  try {
    await page.goto(`${server.base}/#masaustu=${server.token}`);
    const dialog = page.getByRole('dialog', { name: 'Kurtarma kodunuz' });
    await expect(dialog).toBeVisible();
    const box = dialog.getByTestId('recovery-code');
    await expect(box).toBeVisible();
    const code = (await box.locator('span').allTextContents()).join('-');
    expect(code).toMatch(CODE);
    // "Yazdır" prints through a hidden frame holding only the code and the advice.
    await dialog.getByRole('button', { name: 'Yazdır' }).click();
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('iframe')].some(f => f.contentDocument?.querySelector('.code')?.textContent?.includes('-')))).toBe(true);
    await page.screenshot({ path: info.outputPath('recovery-modal.png') });
    // Until confirmed, the rail's "Güvenlik" carries a dot.
    await expect(page.getByLabel('Bakılması gereken güvenlik adımı var')).toHaveCount(1);
    // Not closed by Esc or a stray click while the code is on screen; no × either.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Kapat', exact: true })).toHaveCount(0);
    // "Kaydettim" hides the code and asks for two of its groups from the paper.
    await dialog.getByRole('button', { name: 'Kaydettim', exact: true }).click();
    await expect(dialog.getByTestId('recovery-code')).toHaveCount(0);
    await typeGroups(dialog, code, true);
    await expect(dialog.getByText('Yazdığınız parçalar koddakiyle aynı değil', { exact: false })).toBeVisible();
    await page.screenshot({ path: info.outputPath('recovery-check.png') });
    await typeGroups(dialog, code);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Bakılması gereken güvenlik adımı var')).toHaveCount(0);
    // Never shown again: not after a reload, not in the Güvenlik dialog.
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Mola bilgisayar araçları' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Kurtarma kodunuz' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Güvenlik' }).click();
    const security = page.getByRole('dialog', { name: 'Güvenlik' });
    await expect(security.getByText('Kurtarma kodunuz kaydedildi', { exact: false })).toBeVisible();
    await expect(security.getByTestId('recovery-code')).toHaveCount(0);
    await expect(security.getByText('Bilgisayarın diski şifreli olsun (çalınırsa dosyalar okunamaz)')).toBeVisible();
    await security.getByRole('button', { name: 'Disk şifreleme hakkında bilgi' }).click();
    await expect(page.getByRole('tooltip')).toContainText('BitLocker');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: info.outputPath('security-dialog-phone.png') });
    await page.setViewportSize({ width: 1280, height: 860 });
    await security.getByRole('button', { name: 'Kapat', exact: true }).click();

    // Güvenlik → a new code asks for the owner's password (there is no vendor account on the café computer) and is shown once.
    await page.getByRole('button', { name: 'Güvenlik' }).click();
    const card = security.locator('.recovery-card');
    await expect(card.getByText('Kurtarma kodunuz kaydedildi', { exact: false })).toBeVisible();
    await card.getByRole('button', { name: 'Yeni kurtarma kodu oluştur' }).click();
    await card.getByLabel('İşletme sahibi şifresi').fill('yanlis-sifre-123');
    await card.getByRole('button', { name: 'Yeni kodu oluştur' }).click();
    await expect(card.getByText('İşletme sahibi şifresi yanlış')).toBeVisible();
    await card.getByLabel('İşletme sahibi şifresi').fill('MolaDemo!2026');
    await card.getByRole('button', { name: 'Yeni kodu oluştur' }).click();
    await expect(card.getByTestId('recovery-code')).toBeVisible();
    const fresh = (await card.getByTestId('recovery-code').locator('span').allTextContents()).join('-');
    expect(fresh).toMatch(CODE); expect(fresh).not.toBe(code);
    // Until it is confirmed the rail shows the reminder dot again.
    await expect(page.getByLabel('Bakılması gereken güvenlik adımı var')).toHaveCount(1);
    await card.getByRole('button', { name: 'Kaydettim', exact: true }).click();
    await typeGroups(card, fresh);
    await expect(card.getByText('Kurtarma kodunuz kaydedildi', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Bakılması gereken güvenlik adımı var')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('security-new-code.png'), fullPage: true });
    // The vendor's old panel address is gone from the café computer.
    expect((await page.request.get(`${server.base}/platform`)).status()).toBe(404);
    expect((await server.desktop('/api/desktop/recovery')).data).toMatchObject({ confirmed: true, available: false, protection: 'dpapi' });
  } finally { await server.stop(); }
});
