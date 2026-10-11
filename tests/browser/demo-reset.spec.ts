import { test, expect } from '@playwright/test';
import { ADMIN_API, cleanKafe, cleanPort, detailTab, fillApplication, openBusiness, openSettings, openYonetim, yonetimState } from './helpers';

/*
 * Tanıtım işletmesi end to end on its own clean café (cleanPort(8)): Mola Yönetim marks it, the café shows "Tanıtım";
 * "Tanıtımı sıfırla" in Mola Yönetim (typed SIFIRLA) is carried out by the café at its heartbeat (backup first, template,
 * the same table QR codes) and reported back; the printed QR from before still opens the menu; the owner can reset it too.
 */
test('Tanıtım işletmesi: vendor switch and label, "Tanıtımı sıfırla" from Mola Yönetim reaches the café, the old QR still opens the menu, the owner resets it too', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  const kafe = await cleanKafe(cleanPort(8));
  try {
    // A café that applied, was approved and works.
    await page.goto(kafe.base);
    await page.getByRole('button', { name: /Hesap açma başvurusu/ }).click();
    await fillApplication(page, 'Tanıtım Kafesi', { taxNumber: '1111111114' });
    await page.getByRole('button', { name: 'Başvuruyu gönder' }).click();
    await expect(page.getByRole('heading', { name: 'Başvurunuz alındı · Onay bekleniyor' })).toBeVisible();
    const admin = await browser.newPage();
    await openYonetim(admin);
    const tenantId = (await yonetimState(admin.request)).businesses.find((b: any) => b.name === 'Tanıtım Kafesi').tenantId;
    expect((await admin.request.post(`${ADMIN_API}/applications/approve`, { data: { requestId: 'onay-tanitim-1', tenantId } })).ok()).toBe(true);
    await expect(page.getByRole('heading', { name: 'İşletme sahibi hesabı' })).toBeVisible({ timeout: 15000 });
    await page.getByLabel(/Kullanıcı adı/).fill('tanitim');
    await page.getByLabel('Şifre *', { exact: true }).fill('TanitimKafe!2026');
    await page.getByLabel('Şifre tekrar *', { exact: true }).fill('TanitimKafe!2026');
    await page.getByRole('button', { name: 'Hesabı oluştur' }).click();
    await expect(page.locator('.setup-steps')).toBeVisible();
    const state = async () => (await (await page.request.get(`${kafe.base}/api/staff/state`)).json());
    const s = await state();
    expect((await page.request.post(`${kafe.base}/api/staff/setup`, { data: { requestId: 'tanitim-kurulum', version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: s.changeSeconds, commissionBps: s.commissionBps } })).ok()).toBe(true);
    await expect.poll(async () => (await yonetimState(admin.request)).businesses.find((b: any) => b.tenantId === tenantId)?.neverConnected, { timeout: 15000 }).toBe(false);
    // Not a demo: no card in the owner's Ayarlar.
    await page.goto(kafe.base);
    await openSettings(page, 'Güvenlik ve yedek');
    await expect(page.getByRole('form', { name: 'Tanıtımı sıfırla' })).toHaveCount(0);

    // Mola Yönetim → işletme → Hizmet → "Bu işletme tanıtım işletmesidir".
    await admin.reload();
    let detail = await openBusiness(admin, 'Tanıtım Kafesi');
    await detailTab(detail, 'Hizmet').click();
    const demo = detail.getByRole('region', { name: 'Tanıtım işletmesi' });
    // A controlled box: it turns on once Merkez saved it.
    await demo.getByLabel('Bu işletme tanıtım işletmesidir').click();
    await expect(demo.getByLabel('Bu işletme tanıtım işletmesidir')).toBeChecked();
    await expect(demo.getByRole('form', { name: 'Tanıtımı sıfırla' })).toBeVisible();
    // The café learns it (signed) with its next heartbeat: "Tanıtım" on the staff screen and on the guest menu.
    await expect.poll(async () => (await state()).demo, { timeout: 20000 }).toBe(true);
    const before = await state(), oldToken = before.tables[0].token as string;
    await page.goto(kafe.base);
    await expect(page.locator('.demo-badge').first()).toHaveText('Tanıtım');
    const guest = await browser.newPage();
    await guest.goto(`${kafe.base}/m/${oldToken}`);
    await expect(guest.locator('.customer-header .demo-badge')).toHaveText('Tanıtım');
    await guest.screenshot({ path: info.outputPath('guest-demo.png') });

    // "Tanıtımı sıfırla": nothing until SIFIRLA is typed; then one order the café carries out at its heartbeat.
    const form = demo.getByRole('form', { name: 'Tanıtımı sıfırla' });
    await form.getByRole('radio', { name: 'Restoran' }).check();
    const button = form.getByRole('button', { name: 'Tanıtımı sıfırla' });
    await expect(button).toBeDisabled();
    await form.getByLabel('Onaylamak için SIFIRLA yazın').fill('sifirla');
    await expect(button).toBeDisabled();
    await form.getByLabel('Onaylamak için SIFIRLA yazın').fill('SIFIRLA');
    await admin.screenshot({ path: info.outputPath('vendor-reset.png'), fullPage: true });
    await button.click();
    await expect(demo.getByRole('status')).toContainText('Sıfırlama işletmenin bilgisayarını bekliyor');
    // The café: backup first, the restaurant template, 16 tables; the QR codes it had stay the same. Reported back to Mola Merkez.
    await expect.poll(async () => (await state()).sector, { timeout: 30000 }).toBe('restaurant');
    const after = await state();
    expect(after.tables.length).toBeGreaterThanOrEqual(16);
    const floor = (x: any) => x.tables.filter((t: any) => t.token).map((t: any) => `${t.id}:${t.token}`);
    expect(floor(after)).toEqual(expect.arrayContaining(floor(before)));
    await expect.poll(async () => (await yonetimState(admin.request)).businesses.find((b: any) => b.tenantId === tenantId)?.demoReset?.status, { timeout: 20000 }).toBe('done');
    await admin.reload();
    detail = await openBusiness(admin, 'Tanıtım Kafesi');
    await detailTab(detail, 'Hizmet').click();
    await expect(detail.getByRole('region', { name: 'Tanıtım işletmesi' }).getByRole('status')).toContainText('Son sıfırlama');
    // The printed QR from before the reset still opens the (new) menu: never "Bu tanıtım yenilendi".
    const scan = await browser.newPage();
    await scan.goto(`${kafe.base}/m/${oldToken}`);
    await expect(scan.locator('.customer-header .demo-badge')).toHaveText('Tanıtım');
    await expect(scan.getByText('Bu tanıtım yenilendi')).toHaveCount(0);
    await scan.screenshot({ path: info.outputPath('old-qr.png') });
    await expect(guest.getByText('Bu tanıtım yenilendi')).toHaveCount(0);

    // The owner (Ayarlar → Güvenlik ve diğer): the same reset by hand, typed SIFIRLA; staff accounts stay.
    await page.goto(kafe.base);
    await openSettings(page, 'Güvenlik ve yedek');
    const own = page.getByRole('form', { name: 'Tanıtımı sıfırla' });
    await own.getByRole('group', { name: 'Şablon' }).getByRole('button', { name: 'Kafe' }).click();
    const ownButton = own.getByRole('button', { name: 'Tanıtımı sıfırla' });
    await expect(ownButton).toBeDisabled();
    await own.getByLabel('Onaylamak için SIFIRLA yazın').fill('SIFIRLA');
    await page.screenshot({ path: info.outputPath('owner-reset.png'), fullPage: true });
    await ownButton.click();
    await expect(page.locator('.notice-success')).toContainText('Tanıtım sıfırlandı', { timeout: 60000 });
    await expect(page.locator('.notice-success')).toContainText('QR kodları değişmedi');
    const final = await state();
    expect(final.sector).toBe('cafe');
    expect(floor(final)).toEqual(floor(after));
    await scan.goto(`${kafe.base}/m/${oldToken}`);
    await expect(scan.locator('.customer-header .demo-badge')).toHaveText('Tanıtım');
    // Mola Merkez's history hears of the owner's reset too.
    await expect.poll(async () => (await yonetimState(admin.request)).audit.some((a: any) => a.action === 'demo.reset_by_owner' && a.target === tenantId), { timeout: 20000 }).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guest.close(); await scan.close(); await admin.close();
  } finally { await kafe.stop(); }
});
