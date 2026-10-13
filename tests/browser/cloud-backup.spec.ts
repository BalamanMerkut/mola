import { test, expect, request as playwrightRequest } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { protectedPort, protectedServer, scenario } from './protected-server';
import { AGREEMENT_VERSION } from '../../packages/domain/agreement';
import { ADMIN_API, MERKEZ, detailTab, e2eRun, merkezPassword, openBusiness, openYonetim } from './helpers';

/*
 * Sunucu yedeği ("B planı"): a protected café linked to the test Mola Merkez sends its encrypted backup there; the rail shows
 * "Sunucu yedeği: bugün … · başarılı". The computer breaks: the vendor gives a taşıma kodu in Mola Yönetim, a clean install on
 * another computer restores from Mola Merkez with it and the recovery code, and the old computer stops taking orders.
 */
const NAME = 'Bulut Taşıma Kafesi';
test('sunucu yedeği: the rail shows it; a clean install restores from Mola Merkez with a taşıma kodu and the recovery code', async ({ page }, info) => {
  test.setTimeout(240_000);
  const env = { MOLA_MERKEZ_URL: MERKEZ, MOLA_MERKEZ_PUBLIC_KEY: join(e2eRun(), 'merkez', 'merkez-public-key.txt'), MOLA_SYNC_SOON_MS: '1000', MOLA_HEARTBEAT_MS: '2000' };
  const vendor = await playwrightRequest.newContext();
  expect((await vendor.post(`${ADMIN_API}/login`, { data: { username: 'admin', password: merkezPassword() } })).ok()).toBe(true);
  const created = await (await vendor.post(`${ADMIN_API}/businesses`, { data: { requestId: randomUUID().replace(/-/g, ''), name: NAME, kind: 'trial', sector: 'cafe' } })).json();
  // The old computer: activated with the vendor's code, owner account, recovery code saved.
  const old = await protectedServer(scenario('cloud-old'), protectedPort(6), 'eski-pc', true, env);
  const owner = await playwrightRequest.newContext({ baseURL: old.base });
  let server: Awaited<ReturnType<typeof protectedServer>> | undefined;
  try {
    expect((await owner.post('/api/activation/code', { data: { code: created.code, agreement: { version: AGREEMENT_VERSION } } })).ok()).toBe(true);
    expect((await owner.post('/api/activation/owner', { data: { username: 'bulutsahip', password: 'BulutSahip!2026', name: 'Ayşe' } })).ok()).toBe(true);
    const code = (await old.desktop<{ code: string }>('/api/desktop/recovery/show', {})).data.code;
    await old.desktop('/api/desktop/recovery/confirm', {});
    // After its first heartbeat the café knows this Merkez keeps copies; "Şimdi yedekle" sends one.
    await expect.poll(async () => !!(await old.desktop<{ backup: { cloud?: unknown } }>('/api/desktop/status')).data.backup.cloud, { timeout: 30000 }).toBe(true);
    expect((await old.desktop<{ lastError: string | null }>('/api/desktop/backup', {})).data.lastError).toBeNull();
    await expect.poll(async () => (await old.desktop<{ backup: { cloud?: { lastSuccessAt: string | null } } }>('/api/desktop/status')).data.backup.cloud?.lastSuccessAt ?? null, { timeout: 60000 }).not.toBeNull();
    await page.goto(`${old.base}/#masaustu=${old.token}`);
    await page.getByRole('navigation', { name: 'Mola bilgisayar araçları' }).getByRole('button', { name: 'Yedekle' }).click();
    const backup = page.getByRole('dialog', { name: 'Yedekle' });
    await expect(backup.getByText(/Sunucu yedeği: bugün \d{2}:\d{2} · başarılı/)).toBeVisible();
    await page.screenshot({ path: info.outputPath('rail-sunucu-yedegi.png') });
    // Ayarlar → Güvenlik reads the same for the owner.
    expect((await (await owner.get('/api/staff/backup-status')).json()).cloud.lastSuccessAt).toBeTruthy();

    // Mola Yönetim: Özet shows the copy; Lisans gives the one-time taşıma kodu.
    await openYonetim(page);
    const detail = await openBusiness(page, NAME);
    const summary = detail.getByRole('region', { name: 'Sunucu yedeği' });
    await expect(summary.getByText('Kopya sayısı')).toBeVisible();
    await expect(summary.locator('dd').filter({ hasText: /^1$/ })).toBeVisible();
    await detailTab(detail, 'Lisans').click();
    const move = detail.getByRole('region', { name: 'Yeni bilgisayara taşıma' });
    await move.getByRole('button', { name: 'Taşıma kodu ver' }).click();
    const transfer = (await move.getByTestId('transfer-code').textContent())!.trim();
    expect(transfer).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    await page.screenshot({ path: info.outputPath('yonetim-tasima-kodu.png'), fullPage: true });

    // A clean install on another computer.
    server = await protectedServer(scenario('cloud-new'), protectedPort(7), 'yeni-pc', true, env);
    await page.goto(`${server.base}/#masaustu=${server.token}`);
    // No welcome window: the activation screen offers the ways back (0.1.11).
    await page.getByRole('button', { name: /Mola Merkez’den geri yükle/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Yedekten geri yükle' });
    await expect(dialog.getByRole('button', { name: /Mola Merkez’den/, pressed: true })).toBeVisible();
    await dialog.getByLabel('Taşıma kodu').fill('AAAA-BBBB-CCCC-DDDD');
    await dialog.getByRole('button', { name: 'Yedekleri göster' }).click();
    await expect(dialog.getByText(/Taşıma kodu yanlış/)).toBeVisible();
    await dialog.getByLabel('Taşıma kodu').fill(transfer);
    await dialog.getByRole('button', { name: 'Yedekleri göster' }).click();
    await expect(dialog.getByText(NAME)).toBeVisible();
    const copies = dialog.getByRole('radiogroup', { name: 'Mola Merkez’deki yedekler' }).getByRole('radio');
    await expect(copies).toHaveCount(1); await expect(copies.first()).toBeChecked();
    await expect(dialog.locator('.restore-list .restore-meta').first()).toContainText(/\d+(,\d)? (KB|MB)/);
    await page.screenshot({ path: info.outputPath('merkezden-geri-yukle.png') });
    // This computer's own code is not the café's.
    const own = (await server.desktop<{ code: string }>('/api/desktop/recovery/show', {})).data.code;
    await dialog.getByLabel('Kurtarma kodu').fill(own);
    await dialog.getByRole('button', { name: 'İndir ve geri yükle' }).click();
    await expect(dialog.getByRole('alert')).toContainText(/Kurtarma kodu (yanlış|bu yedeğe ait değil)/, { timeout: 60000 });
    await dialog.getByLabel('Kurtarma kodu').fill(code);
    await dialog.getByRole('button', { name: 'İndir ve geri yükle' }).click();
    await expect(dialog.getByText('Veriler geri yüklendi ve doğrulandı.', { exact: false })).toBeVisible({ timeout: 60000 });
    await page.waitForURL(`${server.base}/`, { timeout: 15000 });
    await expect(page.getByRole('navigation', { name: 'Mola bilgisayar araçları' })).toBeVisible();
    const login = await page.request.post(`${server.base}/api/login`, { data: { username: 'bulutsahip', password: 'BulutSahip!2026' } });
    expect(login.status()).toBe(200);
    // The new computer took the licence; the old one hears it with its next heartbeat and closes ordering.
    await expect.poll(async () => (await (await owner.get('/api/staff/state')).json()).licenseNotice ?? '', { timeout: 60000 }).toMatch(/başka bir bilgisayarda/);
  } finally {
    await server?.stop(); await old.stop(); await owner.dispose(); await vendor.dispose();
  }
});
