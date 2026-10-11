import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_API, MERKEZ, detailTab, e2eRun, openBusiness, openYonetim, yonetimBell, yonetimState } from './helpers';
import { protectedPort, protectedServer, scenario } from './protected-server';
import { AGREEMENT_VERSION } from '../../packages/domain/agreement';

const PASSWORD = 'SahipIlkSifre!2026', NEW_PASSWORD = 'SahipYeniSifre!2026';

test('the owner lost the password and the recovery code: Mola Yönetim gives a one-time code, the café window shows the owner account and sets a new password; the login screen says where', async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const root = scenario('owner-vendor-reset');
  const server = await protectedServer(root, protectedPort(7), 'kafe-pc', true, { MOLA_MERKEZ_URL: MERKEZ, MOLA_MERKEZ_PUBLIC_KEY: join(e2eRun(), 'merkez', 'merkez-public-key.txt'), MOLA_HEARTBEAT_MS: '2000', MOLA_SYNC_SOON_MS: '1000' });
  const admin = await browser.newPage();
  try {
    // A café activated through an application (from this computer itself), with an owner account.
    const local = (path: string, data: unknown) => page.request.post(`${server.base}${path}`, { data });
    const applied = await local('/api/activation/application', { businessName: 'Unutkan Kafe', sector: 'cafe', contactName: 'Deniz Ak', consent: true, agreement: { version: AGREEMENT_VERSION },
      invoice: { legalName: 'Unutkan Kafe Ltd. Şti.', taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1234567890', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 4', phone: '+905321114455', email: 'deniz@example.com' } });
    expect(applied.ok(), await applied.text()).toBe(true);
    await openYonetim(admin);
    const tenantId = (await yonetimState(admin.request)).businesses.find((b: any) => b.name === 'Unutkan Kafe').tenantId;
    expect((await admin.request.post(`${ADMIN_API}/applications/approve`, { data: { requestId: 'onay-unutkan-1', tenantId } })).ok()).toBe(true);
    await expect.poll(async () => (await (await page.request.get(`${server.base}/api/activation`)).json()).state, { timeout: 15000 }).toBe('owner');
    expect((await local('/api/activation/owner', { username: 'deniz', password: PASSWORD })).ok()).toBe(true);
    // The new account is signed in at once (same browser context); this story needs the login screen.
    await local('/api/logout', {});
    await expect.poll(async () => (await yonetimState(admin.request)).businesses.find((b: any) => b.tenantId === tenantId)?.neverConnected, { timeout: 15000 }).toBe(false);
    // The new recovery code is seen and confirmed first (it would open by itself otherwise) — and then "lost".
    await server.desktop('/api/desktop/recovery/show', {}); await server.desktop('/api/desktop/recovery/confirm', {});

    // Mola Yönetim → İşletme → Lisans: a one-time code, shown once.
    await admin.reload();
    const detail = await openBusiness(admin, 'Unutkan Kafe');
    await detailTab(detail, 'Lisans').click();
    await detail.getByRole('button', { name: 'Sahip şifresi sıfırlama kodu ver' }).click();
    const shown = detail.getByTestId('owner-reset-code');
    await expect(shown).toHaveText(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    const code = (await shown.textContent())!.trim();
    await expect(detail.locator('.owner-reset-issued')).toContainText('Tek kullanımlık');
    await admin.screenshot({ path: info.outputPath('vendor-code.png') });

    // The login screen tells the owner where to go.
    await page.goto(`${server.base}/#masaustu=${server.token}`);
    await page.getByText('Şifremi unuttum').click();
    await expect(page.locator('.login-forgot')).toContainText('sol şerit → Güvenlik → İşletme sahibi şifresini unuttum. Kurtarma kodunuz yoksa Mola ekibinden tek kullanımlık kod isteyin.');
    await expect(page.locator('.login-forgot')).toContainText('Personel → Çalışanlar');
    // The café window: Güvenlik → "Mola ekibinden kod".
    await page.getByRole('navigation', { name: 'Mola bilgisayar araçları' }).getByRole('button', { name: 'Güvenlik' }).click();
    const box = page.getByRole('dialog', { name: 'Güvenlik' }).locator('.owner-reset-box');
    await box.getByRole('button', { name: 'Mola ekibinden kod' }).click();
    const input = box.getByLabel('Mola ekibinin kodu'), check = box.getByRole('button', { name: 'Kodu kontrol et' });
    await input.fill('AAAA-BBBB-CCCC'); await check.click();
    await expect(box.getByText(/Kod yanlış/)).toBeVisible();
    await input.fill(code.toLowerCase()); await check.click();
    const accounts = box.getByRole('radiogroup', { name: 'İşletme sahibi hesabı' });
    await expect(accounts.getByRole('radio', { name: /deniz/ })).toBeChecked();
    await expect(box).toContainText('Unutkan Kafe');
    await box.getByLabel('Yeni şifre', { exact: true }).fill(NEW_PASSWORD);
    await box.getByLabel('Yeni şifre tekrar').fill(NEW_PASSWORD);
    await page.screenshot({ path: info.outputPath('vendor-code-accounts.png') });
    await box.getByRole('button', { name: 'Yeni şifreyi kaydet' }).click();
    await expect(box.getByText('Yeni şifre kaydedildi', { exact: false })).toBeVisible();
    expect((await page.request.post(`${server.base}/api/login`, { data: { username: 'deniz', password: NEW_PASSWORD } })).ok()).toBe(true);
    // Used once: the same code again is refused.
    await box.getByRole('button', { name: 'Mola ekibinden kod' }).click();
    await input.fill(code); await check.click();
    await expect(box.getByText(/daha önce kullanıldı/)).toBeVisible();
    // Never from another device or through a proxy, even with the window key.
    expect((await page.request.post(`${server.base}/api/desktop/owner-password/vendor/owners`, { data: { code }, headers: { 'X-Mola-Desktop': server.token, 'X-Forwarded-For': '192.168.1.20' } })).status()).toBe(404);
    expect((await page.request.post(`${server.base}/api/desktop/owner-password/vendor/owners`, { data: { code } })).status()).toBe(404);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Mola Yönetim hears it: Bildirim merkezi and İşlem geçmişi (who issued, that it was used); no username, no password.
    await admin.reload();
    await yonetimBell(admin).click();
    await expect(admin.locator('.alert-list li').filter({ hasText: 'Sahip şifresi Mola koduyla yenilendi' })).toContainText('Unutkan Kafe');
    const state = await yonetimState(admin.request);
    expect(state.audit.some((a: any) => a.action === 'owner_reset.issued' && a.by === 'admin')).toBe(true);
    expect(state.audit.some((a: any) => a.action === 'owner_reset.used' && a.by === 'cafe')).toBe(true);
    expect(JSON.stringify(state)).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(state)).not.toContain('"deniz"');
  } finally { await admin.close(); await server.stop(); }
});
