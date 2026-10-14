import { test, expect } from '@playwright/test';
import { detailTab, ensureSetup, MERKEZ, openBusiness, openYonetim, yonetimBell } from './helpers';

/*
 * Uzaktan destek (server/support-session.ts, server/merkez/relay.ts): the owner switches "Uzaktan destek izni" on in Destek →
 * Mola desteği; the vendor presses "Kafeye bağlan" in Mola Yönetim → işletme → Destek and gets the café's screens as
 * "Mola destek" in a new tab; edits a price; reports are refused (403); the owner sees the change and the banner; switching
 * the permission off ends the session at once.
 */
const PASSWORD = 'MolaDemo!2026';

test('Uzaktan destek: owner allows, vendor connects through Mola Merkez, edits a price, cannot open reports; owner switches off', async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  const cafe = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  try {
    expect((await cafe.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
    await ensureSetup(cafe.request);
    const state = await (await cafe.request.get('/api/staff/state')).json();
    const owner = await cafe.newPage(); await owner.goto('/');
    await owner.getByRole('button', { name: 'Destek', exact: true }).click();
    await owner.getByRole('tab', { name: /Mola desteği/ }).click();
    await expect(owner.getByText('Kapalı · Mola ekibi bağlanamaz')).toBeVisible();
    // Turning it on asks the owner's password again; a wrong one leaves it off.
    await owner.getByRole('checkbox', { name: 'Mola ekibi bağlanabilsin' }).click();
    const ask = owner.getByRole('form', { name: 'Uzaktan destek iznini aç' });
    await ask.getByLabel('Şifreniz').fill('yanlis-sifre');
    await ask.getByRole('button', { name: 'İzni aç' }).click();
    await expect(owner.getByText(/^Şifre yanlış/)).toBeVisible();
    await expect(owner.getByText('Kapalı · Mola ekibi bağlanamaz')).toBeVisible();
    await ask.getByLabel('Şifreniz').fill(PASSWORD);
    await owner.screenshot({ path: info.outputPath('sahip-destek-sifre.png'), fullPage: true });
    await ask.getByRole('button', { name: 'İzni aç' }).click();
    await expect(owner.getByText('Açık · Mola ekibi bağlanabilir')).toBeVisible();
    await expect(ask).toHaveCount(0);
    await owner.screenshot({ path: info.outputPath('sahip-uzaktan-erisim.png'), fullPage: true });

    // Mola Yönetim → the business → Destek → Uzaktan destek.
    await openYonetim(page);
    const detail = await openBusiness(page, state.name);
    await detailTab(detail, 'Destek').click();
    const section = page.getByRole('region', { name: 'Uzaktan destek' });
    await expect(section.getByText(/İzin açık/)).toBeVisible({ timeout: 30_000 });
    const connect = section.getByRole('button', { name: 'Kafeye bağlan' });
    await expect(connect).toBeEnabled({ timeout: 30_000 });
    const [support] = await Promise.all([page.context().waitForEvent('page'), connect.click()]);
    await support.waitForURL(/\/destek\/[0-9a-f-]{36}$/);
    const nav = support.getByRole('navigation', { name: 'Mola destek bölümleri' });
    await expect(nav).toBeVisible({ timeout: 30_000 });
    await expect(support.getByText(`Mola ekibi olarak ${state.name} kafesine bağlısınız.`, { exact: false })).toBeVisible();
    // Only the support places: no Masalar with bills, no reports, cash, staff or Destek.
    for (const name of ['Satış ve Raporlar', 'Kasa', 'Çalışanlar', 'Stok', 'Destek']) await expect(nav.getByRole('button', { name, exact: true })).toHaveCount(0);
    await support.screenshot({ path: info.outputPath('destek-menu.png'), fullPage: true });

    // A price change through the product editor.
    const product = state.products.find((p: { published?: boolean }) => p.published !== false), row = support.locator('.menu-row').filter({ hasText: product.name }).first();
    await row.getByRole('button', { name: 'Düzenle', exact: true }).click();
    const dialog = support.getByRole('dialog');
    const next = String(product.price / 100 + 5);
    await dialog.getByLabel('Fiyat (TL)', { exact: true }).fill(next);
    await dialog.getByRole('button', { name: 'Kaydet ve yayınla', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await (await cafe.request.get('/api/staff/state')).json()).products.find((p: { id: string }) => p.id === product.id).price).toBe(product.price + 500);

    // Reports, cash and staff are refused on the café server itself, through the same session.
    for (const path of ['/api/staff/reports/overview?from=2026-01-01&to=2026-01-01', '/api/staff/cash/status', '/api/staff/users', '/api/staff/report-security']) {
      const r = await support.request.get(`${MERKEZ}${path}`);
      expect(r.status(), path).toBe(403); expect((await r.json()).code, path).toBe('SUPPORT_FORBIDDEN');
    }
    // Diagnostics: versions and printers, no business numbers.
    await nav.getByRole('button', { name: 'Tanılama', exact: true }).click();
    await expect(support.getByText('Mola sürümü')).toBeVisible();

    // The owner: the banner on every screen and the change in plain words.
    await expect(owner.getByText('Mola ekibi bağlı', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(owner.locator('.remote-log-list')).toContainText(`Mola destek: Ürün değişti: ${product.name}`, { timeout: 15_000 });
    await expect(owner.locator('.remote-log-list')).toContainText('fiyat');
    await owner.screenshot({ path: info.outputPath('sahip-destek-bagli.png'), fullPage: true });
    // Mola Yönetim shows the open session.
    await expect(section.getByText(/^Bağlısınız/)).toBeVisible({ timeout: 15_000 });

    // Off (no password): the session ends at once; the vendor's tab says so.
    await owner.getByRole('checkbox', { name: 'Mola ekibi bağlanabilsin' }).click();
    await expect(owner.getByRole('form', { name: 'Uzaktan destek iznini aç' })).toHaveCount(0);
    await expect(owner.getByText('Kapalı · Mola ekibi bağlanamaz')).toBeVisible();
    await expect(support.getByRole('heading', { name: 'Destek oturumu kapandı' })).toBeVisible({ timeout: 20_000 });
    await expect(section.getByText(/İzin kapalı/)).toBeVisible({ timeout: 30_000 });
    await expect(section.getByRole('list', { name: 'Destek oturumları' })).toContainText('izin kapatıldı');
    await expect(owner.locator('.remote-sessions')).toContainText('izin kapatıldı');
    await page.screenshot({ path: info.outputPath('yonetim-uzaktan-destek.png'), fullPage: true });
    // Bildirim merkezi: permission given, session started and ended, permission withdrawn.
    await yonetimBell(page).click();
    for (const title of ['Uzaktan destek izni verildi', 'Destek oturumu başladı', 'Destek oturumu bitti', 'Uzaktan destek izni kapatıldı']) await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  } finally { await cafe.close(); }
});
