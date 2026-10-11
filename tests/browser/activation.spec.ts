import { test, expect, type Page } from '@playwright/test';
import { cleanKafe, fillApplication, yonetimState, openYonetim, yonetimGo } from './helpers';

const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('clean install: "Hesap açma başvurusu" first, the vendor approves in Mola Yönetim, then the owner account and the setup', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const kafe = await cleanKafe(Number(process.env.E2E_PORT ?? 3100) + 21);
  try {
    await page.goto(kafe.base);
    await expect(page.getByRole('heading', { name: 'Mola’yı etkinleştir' })).toBeVisible();
    // No self-serve trial any more, and nothing else before activation: no login form.
    await expect(page.getByRole('button', { name: /30 gün ücretsiz dene/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Çalışma alanını aç' })).toHaveCount(0);
    expect((await page.request.post(`${kafe.base}/api/activation/trial`, { data: { businessName: 'X', sector: 'cafe', contactName: 'Y' } })).status()).toBe(410);
    await page.screenshot({ path: info.outputPath('activation-desktop.png') });
    await page.getByRole('button', { name: /Hesap açma başvurusu/ }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    // A wrong tax number is shown at its field before anything is sent.
    await fillApplication(page, 'Çarşı Tatlıcısı', { taxNumber: '1234567891' });
    await page.getByRole('button', { name: 'Başvuruyu gönder' }).click();
    await expect(page.getByText('Vergi kimlik numarası 10 haneli ve geçerli olmalı.')).toBeVisible();
    await page.getByLabel('Vergi kimlik no *').fill('1234567890');
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: info.outputPath('application-phone.png'), fullPage: true });
    await page.getByRole('button', { name: 'Başvuruyu gönder' }).click();
    await expect(page.getByRole('heading', { name: 'Başvurunuz alındı · Onay bekleniyor' })).toBeVisible();
    await expect(page.getByText('Çarşı Tatlıcısı', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Son kontrol');
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: info.outputPath('application-waiting-phone.png'), fullPage: true });
    // The vendor approves in Mola Yönetim; the café moves on by itself within seconds.
    const admin = await browser.newPage();
    await openYonetim(admin);
    await yonetimGo(admin, 'Başvurular');
    const card = admin.locator('.application-card').filter({ hasText: 'Çarşı Tatlıcısı' });
    await expect(card).toContainText('Çarşı Tatlıcısı Gıda Ltd. Şti.'); await expect(card).toContainText('+90 532 123 45 67');
    await card.getByRole('button', { name: '30 günlük denemeyi başlat' }).click();
    await expect(page.getByRole('heading', { name: 'İşletme sahibi hesabı' })).toBeVisible({ timeout: 15000 });
    await page.setViewportSize({ width: 1280, height: 800 });
    // The rules show under the fields as they are typed; the browser's own pattern check works too (valid under the v flag).
    const user = page.getByLabel(/Kullanıcı adı/);
    await user.fill('zey nep');
    await expect(page.getByText('Kullanıcı adında boşluk olamaz.')).toBeVisible();
    await user.fill('1zeynep');
    await expect(page.getByText('Kullanıcı adı küçük bir harfle başlamalı.')).toBeVisible();
    expect(await user.evaluate((e: HTMLInputElement) => e.validity.patternMismatch)).toBe(true);
    await page.getByLabel('Şifre *', { exact: true }).fill('kısa');
    await expect(page.getByText('En az 10 karakter: 6 karakter daha yazın.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hesabı oluştur' })).toBeDisabled();
    await user.fill('zeynep');
    expect(await user.evaluate((e: HTMLInputElement) => e.validity.patternMismatch)).toBe(false);
    await expect(page.getByText('Küçük harfle başlar; küçük harf, rakam ve . _ - olabilir; boşluk yok (3–32 karakter).')).toBeVisible();
    await page.getByLabel('Şifre *', { exact: true }).fill('ZeynepTatli!2026');
    await page.getByLabel('Şifre tekrar *', { exact: true }).fill('ZeynepTatli!2026x');
    await expect(page.getByText('Şifreler eşleşmiyor.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hesabı oluştur' })).toBeDisabled();
    await page.getByLabel('Şifre tekrar *', { exact: true }).fill('ZeynepTatli!2026');
    await page.getByRole('button', { name: 'Hesabı oluştur' }).click();
    // Signed in at once (no second login); the usual first setup follows, with the kind chosen in the application.
    await expect(page.getByRole('button', { name: 'Çalışma alanını aç' })).toHaveCount(0);
    await expect(page.locator('.setup-steps')).toContainText('İşletme türü');
    await expect(page.getByRole('radio', { name: /Tatlıcı/ })).toBeChecked();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Mola’yı etkinleştir' })).toHaveCount(0);
    await expect(page.locator('.setup-steps')).toBeVisible();
    // The vendor sees the approved trial with its contact, the café computer's version and last contact.
    await expect.poll(async () => (await yonetimState(admin.request)).businesses.find((b: any) => b.name === 'Çarşı Tatlıcısı')?.lastSeenAt ?? '', { timeout: 15000 }).not.toBe('');
    const listed = (await yonetimState(admin.request)).businesses.find((b: any) => b.name === 'Çarşı Tatlıcısı');
    expect(listed.source).toBe('application'); expect(listed.application.status).toBe('approved'); expect(listed.contactName).toBe('Zeynep Kaya'); expect(listed.daysRemaining).toBe(30); expect(listed.sector).toBe('dessert');
    expect(JSON.stringify(listed)).not.toContain('"zeynep"');
    await admin.close();
    expect((await page.request.get(`${kafe.base}/platform`)).status()).toBe(404);
    expect((await page.request.get(`${kafe.base}/merkez.html`)).status()).toBe(404);
  } finally { await kafe.stop(); }
});

test('Mola Merkez unreachable during activation: a clear message and "Yeniden dene", nothing half-made', async ({ page }) => {
  const kafe = await cleanKafe(Number(process.env.E2E_PORT ?? 3100) + 22, { merkezUrl: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 3100) + 99}` });
  try {
    await page.goto(kafe.base);
    await page.getByRole('button', { name: /Etkinleştirme kodum var/ }).click();
    await page.getByLabel(/Etkinleştirme kodu/).fill('ABCD-EFGH-JKLM');
    await page.getByRole('checkbox', { name: /Mola Lisans Sözleşmesi’ni okudum ve kabul ediyorum/ }).check();
    await page.getByRole('button', { name: 'Etkinleştir', exact: true }).click();
    // Merkez does not answer at its address (this computer has internet): said so, not "check your internet".
    await expect(page.getByText(/Mola Merkez’e ulaşılamadı: Merkez şu anda yanıt vermiyor/)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
    // Every try is the same activation, so the field stays editable.
    await expect(page.getByLabel(/Etkinleştirme kodu/)).toBeEnabled();
    await page.getByRole('button', { name: 'Yeniden dene' }).click();
    await expect(page.getByText(/Mola Merkez’e ulaşılamadı/)).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Geri' }).click();
    // The application form: the same message, the same "Yeniden dene".
    await page.getByRole('button', { name: /Hesap açma başvurusu/ }).click();
    await fillApplication(page, 'Bağlantısız Kafe');
    await page.getByRole('button', { name: 'Başvuruyu gönder' }).click();
    await expect(page.getByText(/Mola Merkez’e ulaşılamadı/)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Yeniden göndermek yeni bir başvuru açmaz', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Geri' }).click();
    await expect(page.getByRole('heading', { name: 'Mola’yı etkinleştir' })).toBeVisible();
    expect((await (await page.request.get(`${kafe.base}/api/activation`)).json()).state).toBe('activate');
  } finally { await kafe.stop(); }
});
