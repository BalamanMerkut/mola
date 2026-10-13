import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_API, e2eRun, openYonetim, yonetimSettings, yonetimShot } from './helpers';

test('Ayarlar → Yedek: the recovery code is shown once on this computer, saved, backups made and copied to a second place', async ({ page }, info) => {
  test.setTimeout(90_000);
  await openYonetim(page);
  await yonetimSettings(page, 'Yedek');
  const card = page.getByRole('region', { name: 'Yedek' });
  await expect(card).toContainText('Otomatik yedek kapalı', { timeout: 10000 });
  // The recovery code is not saved yet: the summary says so and "Ayrıntılar" (with the code card) is open by itself.
  await expect(card.locator('.bk-attention')).toContainText('Kurtarma kodu henüz kaydedilmedi');
  await expect(card.locator('details.bk-details')).toHaveAttribute('open', '');
  await card.getByRole('button', { name: 'Kurtarma kodunu göster' }).click();
  const code = card.getByTestId('merkez-recovery-code');
  await expect(code).toBeVisible(); expect((await code.innerText()).replace(/\s/g, '')).toMatch(/^[A-Z2-9]{24}$/);
  await card.getByRole('button', { name: 'Kodu kaydettim' }).click();
  await expect(card.locator('.notice-success')).toContainText('Kurtarma kodu kaydedildi');
  await expect(card.getByTestId('merkez-recovery-code')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Yeni kurtarma kodu oluştur' })).toBeVisible();
  // A second place (a folder standing in for a flash drive), then a backup now.
  const usb = join(e2eRun(), 'flash'); mkdirSync(usb, { recursive: true });
  // "Göz at" (Windows' folder window on the Merkez computer) and the quick places: the window itself is the server's, so here
  // its answers are stood in for (the route's own checks are in tests/merkez-folder-picker.test.ts).
  // The first press finds a window already open (409 PICKER_BUSY); the second one waits while the window is open.
  let started: unknown, picks = 0, close!: () => void;
  const closed = new Promise<void>(r => { close = r; });
  await page.route('**/api/merkez/admin/folders', route => route.fulfill({ json: { picker: true, places: [
    { path: "G:\\Drive'ım", label: 'Google Drive (G:)', kind: 'gdrive' }, { path: 'C:\\Users\\Kafe\\OneDrive', label: 'OneDrive', kind: 'onedrive' }, { path: 'E:\\', label: 'Flash bellek (E: KINGSTON)', kind: 'usb' }] } }));
  await page.route('**/api/merkez/admin/folders/pick', async route => {
    if (++picks === 1) return route.fulfill({ status: 409, json: { code: 'PICKER_BUSY', message: 'Klasör seçme penceresi zaten açık. Görev çubuğundaki pencereye bakın.' } });
    started = route.request().postDataJSON(); await closed; await route.fulfill({ json: { path: usb } });
  });
  await yonetimSettings(page, 'Çalışma klasörü'); await yonetimSettings(page, 'Yedek');
  // 13 Ekim: "Yedekler nerede?" first; with the code saved "Ayrıntılar" stays closed, and "İkinci yeri ayarla" opens it.
  const details = card.locator('details.bk-details');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(card.getByRole('list', { name: 'Yedek yerleri' }).getByRole('listitem')).toHaveCount(3);
  await card.getByRole('button', { name: 'İkinci yeri ayarla' }).click();
  await expect(details).toHaveAttribute('open', '');
  const second = card.getByRole('group', { name: 'Önerilen yerler' });
  await expect(second.getByRole('button', { name: /Google Drive \(G:\)/ })).toBeVisible();
  await second.getByRole('button', { name: /Google Drive \(G:\)/ }).click();
  await expect(card.getByLabel(/İkinci yedek yeri/)).toHaveValue("G:\\Drive'ım");
  await expect(second.getByRole('button', { name: /Google Drive \(G:\)/ })).toHaveAttribute('aria-pressed', 'true');
  // The owner's case: the second copy into his Google Drive folder, one tap.
  await yonetimShot(page, 'ikinci-yedek-goz-at.png', info.outputPath('ikinci-yedek-goz-at.png'));
  // K-R: a window already open (perhaps behind Mola) is pointed to, not shown as an error.
  const openNote = 'Klasör seçme penceresi açıldı (görev çubuğuna bakın).';
  await card.getByRole('button', { name: 'Göz at' }).click();
  await expect(card.locator('.folder-field [role="status"]')).toHaveText(openNote);
  await expect(card.locator('.folder-field .field-problem')).toHaveCount(0);
  await expect(card).not.toContainText('zaten açık');
  // While the window is open the button waits ("Pencere açık…") and says where the window is.
  await card.getByRole('button', { name: 'Göz at' }).click();
  await expect(card.getByRole('button', { name: 'Pencere açık…' })).toBeDisabled();
  await expect(card.locator('.folder-field [role="status"]')).toHaveText(openNote);
  close();
  await expect(card.getByLabel(/İkinci yedek yeri/)).toHaveValue(usb);
  await expect(card.getByRole('button', { name: 'Göz at' })).toBeEnabled();
  expect(started).toEqual({ purpose: 'second', start: "G:\\Drive'ım" });
  await expect(card.getByText('Seçildi. Kaydetmek için “Kaydet”e basın.')).toBeVisible();
  await card.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(card.locator('.notice-success')).toContainText('İkinci yedek yeri kaydedildi');
  await card.getByRole('button', { name: 'Şimdi yedekle' }).click();
  await expect(card.locator('.notice-success')).toContainText('Yedek alındı ve doğrulandı', { timeout: 20000 });
  await expect(card).toContainText('Son kopya:');
  await expect(card).not.toContainText('Henüz yok');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('merkez-backup-phone.png'), fullPage: true });
});

test('Ayarlar → E-posta bildirimleri: Gmail defaults, the app password is kept but never shown again', async ({ page }) => {
  await openYonetim(page);
  await yonetimSettings(page, 'E-posta bildirimleri');
  const mail = page.getByRole('region', { name: 'E-posta bildirimleri' });
  await expect(mail.getByLabel('E-posta sunucusu (SMTP)')).toHaveValue('smtp.gmail.com');
  await expect(mail.getByLabel('Port')).toHaveValue('465');
  await expect(mail.getByRole('button', { name: 'Deneme e-postası gönder' })).toBeDisabled();
  // Why it cannot be pressed is written next to it, not only in a tooltip.
  await expect(mail.locator('.button-why')).toHaveText('Önce ayarları kaydedin; deneme e-postası kayıtlı ayarlarla gönderilir.');
  await expect(mail.getByRole('button', { name: 'Deneme e-postası gönder' })).toHaveAccessibleDescription(/Önce ayarları kaydedin/);
  // No user address and no sender: never "From: Mola Yönetim <>"; the screen and Mola Merkez both ask for a sender.
  await mail.getByLabel('Bildirimlerin gideceği adres').fill('satici@example.com');
  await expect(mail.locator('.field-hint')).toContainText('“Gönderen adresi”ne yazın');
  const noSender = await page.request.post(`${ADMIN_API}/email`, { data: { enabled: true, host: 'smtp.gmail.com', port: 465, security: 'tls', user: '', to: 'satici@example.com' } });
  expect(noSender.status()).toBe(400); expect((await noSender.json()).code).toBe('EMAIL_FROM');
  await mail.getByLabel('Kullanıcı (e-posta adresiniz)').fill('satici@example.com');
  await expect(mail.locator('.field-hint')).toHaveCount(0);
  await mail.getByLabel('Uygulama şifresi').fill('abcd efgh ijkl mnop');
  await mail.getByLabel('Bildirimlerin gideceği adres').fill('satici@example.com');
  await mail.getByRole('button', { name: 'E-posta ayarlarını kaydet' }).click();
  await expect(mail.locator('.notice-success')).toContainText('E-posta ayarları kaydedildi');
  await page.reload(); await yonetimSettings(page, 'E-posta bildirimleri');
  await expect(mail.getByLabel('Uygulama şifresi')).toHaveValue('');
  await expect(mail.getByLabel('Uygulama şifresi')).toHaveAttribute('placeholder', /Kayıtlı/);
  await expect(mail.getByRole('button', { name: 'Deneme e-postası gönder' })).toBeEnabled();
  await expect(mail.locator('.button-why')).toHaveCount(0);
  expect(JSON.stringify(await (await page.request.get(`${ADMIN_API}/email`)).json())).not.toContain('abcd efgh');
  // STARTTLS sets its port; a plain connection is only for a relay on this computer.
  await mail.getByLabel('Bağlantı').selectOption('starttls'); await expect(mail.getByLabel('Port')).toHaveValue('587');
  await expect(mail.getByRole('button', { name: 'Deneme e-postası gönder' })).toBeDisabled();
  await expect(mail.locator('.button-why')).toHaveText('Değişiklikleri kaydedince deneyebilirsiniz.');
  await mail.getByLabel('Bağlantı').selectOption('none'); await mail.getByRole('button', { name: 'E-posta ayarlarını kaydet' }).click();
  await expect(mail.locator('.notice-error')).toContainText('yalnız bu bilgisayardaki');
});
