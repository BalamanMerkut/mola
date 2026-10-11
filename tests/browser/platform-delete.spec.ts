import { test, expect } from '@playwright/test';
import { ADMIN_API, applyAt, cleanKafe, cleanPort, detailTab, fillApplication, openBusiness, openYonetim, yonetimGo, yonetimSettings, yonetimState } from './helpers';

const CLOSED = 'Bu işletmenin Mola kaydı kapatıldı. Yeniden başlamak için Mola ekibiyle görüşün.';

test('Kaydı sil: a connected business is suspended first, then deleted with its name typed; the café locks with the reason; its tax number is flagged on a new application', async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const kafe = await cleanKafe(cleanPort(4));
  try {
    // A café that applied, was approved and works (owner account, first setup, heartbeats).
    await page.goto(kafe.base);
    await page.getByRole('button', { name: /Hesap açma başvurusu/ }).click();
    await fillApplication(page, 'Kapanacak Kafe');
    await page.getByRole('button', { name: 'Başvuruyu gönder' }).click();
    await expect(page.getByRole('heading', { name: 'Başvurunuz alındı · Onay bekleniyor' })).toBeVisible();
    const admin = await browser.newPage();
    await openYonetim(admin);
    const tenantId = (await yonetimState(admin.request)).businesses.find((b: any) => b.name === 'Kapanacak Kafe').tenantId;
    expect((await admin.request.post(`${ADMIN_API}/applications/approve`, { data: { requestId: 'onay-kapanacak-1', tenantId } })).ok()).toBe(true);
    await expect(page.getByRole('heading', { name: 'İşletme sahibi hesabı' })).toBeVisible({ timeout: 15000 });
    await page.getByLabel(/Kullanıcı adı/).fill('kapanacak');
    await page.getByLabel('Şifre *', { exact: true }).fill('KapanacakKafe!2026');
    await page.getByLabel('Şifre tekrar *', { exact: true }).fill('KapanacakKafe!2026');
    await page.getByRole('button', { name: 'Hesabı oluştur' }).click();
    // Signed in at once: no second login.
    await expect(page.locator('.setup-steps')).toBeVisible();
    const s = await (await page.request.get(`${kafe.base}/api/staff/state`)).json();
    expect((await page.request.post(`${kafe.base}/api/staff/setup`, { data: { requestId: 'kapanacak-kurulum', version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: s.changeSeconds, commissionBps: s.commissionBps } })).ok()).toBe(true);
    await expect.poll(async () => (await yonetimState(admin.request)).businesses.find((b: any) => b.tenantId === tenantId)?.neverConnected, { timeout: 15000 }).toBe(false);

    // Mola Yönetim: not suspended yet, so no delete; the way there instead.
    await admin.reload();
    const dialog = await openBusiness(admin, 'Kapanacak Kafe');
    await detailTab(dialog, 'Lisans').click();
    // The dangerous actions sit apart at the bottom of Lisans, in "Dikkat".
    const danger = dialog.getByRole('region', { name: 'Dikkat' });
    await expect(danger.getByText('Bu işletme Mola Merkez’e bağlandı. Önce askıya alın, sonra silebilirsiniz.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Kaydı sil', exact: true })).toHaveCount(0);
    await danger.getByRole('button', { name: 'Askıya al', exact: true }).click();
    await dialog.getByLabel(/Askıya alma nedeni/).fill('Ödeme yapılmadı');
    await dialog.locator('.suspend-form').getByRole('button', { name: 'Askıya al' }).click();
    await expect(admin.getByText('Kaydedildi.', { exact: false })).toBeVisible();
    // Suspended: delete asks for the name, explains what happens, and stays disabled until the name matches.
    await danger.getByRole('button', { name: 'Kaydı sil', exact: true }).click();
    const confirm = dialog.getByRole('alertdialog', { name: 'Kaydı silme onayı' });
    await expect(confirm).toContainText('“Kapanacak Kafe” kaydı kalıcı olarak silinsin mi?');
    await expect(confirm).toContainText('İşletmenin bilgisayarındaki Mola kilitli kalır ve bir daha lisans alamaz. Satış verileri işletmenin bilgisayarında kalır; Mola Merkez’de satış verisi zaten yoktur. Bu işlem geri alınamaz.');
    const sure = confirm.getByRole('button', { name: 'Evet, kalıcı olarak sil' }), typed = confirm.getByLabel(/Onaylamak için işletmenin adını yazın/);
    await expect(sure).toBeDisabled();
    await typed.fill('Kapanacak'); await expect(sure).toBeDisabled();
    await confirm.getByRole('button', { name: 'Vazgeç' }).click();
    await expect(confirm).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Kaydı sil', exact: true }).click();
    await typed.fill('  kapanacak   KAFE'); await expect(sure).toBeEnabled();
    await admin.screenshot({ path: info.outputPath('delete-connected-confirm.png') });
    await sure.click();
    await expect(dialog).toHaveCount(0);
    await expect(admin.getByText('“Kapanacak Kafe” kaydı silindi.')).toBeVisible();
    await expect(admin.locator('.platform-business-row').filter({ hasText: 'Kapanacak Kafe' })).toHaveCount(0);
    expect((await yonetimState(admin.request)).businesses.some((b: any) => b.tenantId === tenantId)).toBe(false);
    await yonetimSettings(admin, 'İşlem geçmişi');
    const line = admin.locator('.platform-audit-list article').filter({ hasText: 'İşletme kaydı silindi' });
    await expect(line).toContainText('Kapanacak Kafe'); await expect(line).toContainText('askıdaydı, bağlanmıştı'); await expect(line).toContainText('Yönetici');

    // The café hears it with its next heartbeat: locked, with the reason on the panel and in Destek (no new ticket form).
    await expect.poll(async () => (await (await page.request.get(`${kafe.base}/api/staff/state`)).json()).licenseNotice, { timeout: 20000 }).toBe(CLOSED);
    await page.reload();
    await expect(page.getByText(CLOSED)).toBeVisible();
    await page.getByRole('button', { name: 'Destek ve lisans' }).click();
    await expect(page.locator('.notice-error').filter({ hasText: CLOSED })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Destek talebi aç' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Yeni talep/ })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('cafe-closed.png') });

    // The same tax number applies again: the vendor sees a flag; the plain start is still offered.
    await applyAt(admin.request, 'Yeniden Gelen Kafe', { taxNumber: '1234567890', machine: '9'.repeat(64) });
    await admin.reload();
    await yonetimGo(admin, 'Başvurular');
    const card = admin.locator('.application-card').filter({ hasText: 'Yeniden Gelen Kafe' });
    await expect(card).toContainText('Bu vergi numarası daha önce silinen bir işletmeye aitti');
    await expect(card.getByRole('button', { name: '30 günlük denemeyi başlat' })).toBeVisible();
    await admin.setViewportSize({ width: 390, height: 844 });
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await admin.close();
  } finally { await kafe.stop(); }
});
