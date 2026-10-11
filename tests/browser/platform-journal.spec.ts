import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN_API, merkezPassword, openYonetim, yonetimSettings } from './helpers';

/*
 * Mola Yönetim → Ayarlar → İşlem kayıtları (filters, the chain check, Rapor al: PDF, Excel, JSONL) and → Çalışma klasörü
 * (a scratch folder under the system temp folder: never C:\MolaCalisma, never OneDrive). Plus the version line.
 */
const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const rows = (page: Page) => page.locator('.journal-list article');

test('İşlem kayıtları: whole chain, filters (business, who, result, search, dates), Rapor al as PDF, Excel and JSONL', async ({ page }, info) => {
  test.setTimeout(120_000);
  // Two businesses and one wrong password, made over the API.
  expect((await page.request.post(`${ADMIN_API}/login`, { data: { username: 'admin', password: 'Yanlis-Sifre-123' } })).status()).toBe(401);
  await openYonetim(page);
  const tag = randomUUID().slice(0, 6);
  for (const name of [`Kayıt Kafe ${tag}`, `Çınar Çay Evi ${tag}`]) expect((await page.request.post(`${ADMIN_API}/businesses`, { data: { requestId: randomUUID().replace(/-/g, ''), name, kind: 'trial' } })).ok()).toBe(true);
  await yonetimSettings(page, 'İşlem kayıtları');
  const panel = page.getByRole('region', { name: 'İşlem kayıtları' });
  await expect(panel.getByRole('status', { name: 'Bütünlük denetimi' })).toContainText('Kayıtlar bütün');
  await expect(rows(page).first()).toBeVisible();
  // Search (Turkish letters, any case), then clear.
  await panel.getByLabel('Ara', { exact: true }).fill(`ÇINAR ÇAY EVİ ${tag}`);
  await expect(rows(page)).toHaveCount(1); await expect(rows(page).first()).toContainText('İşletme oluşturuldu');
  await expect(rows(page).first()).toContainText('Yönetici'); await expect(rows(page).first()).toContainText('Bu bilgisayar');
  await panel.getByRole('button', { name: 'Süzgeçleri temizle' }).click();
  // The quick chip "Başarısız olanlar" (the wrong password above), then the other filters behind "Süzgeçler".
  await panel.getByRole('button', { name: 'Başarısız olanlar' }).click();
  await expect(rows(page).filter({ hasText: 'Yönetici girişi başarısız' }).first()).toBeVisible();
  await panel.getByRole('button', { name: 'Süzgeçleri temizle' }).click();
  await panel.getByRole('button', { name: 'Süzgeçler', exact: true }).click();
  // Business.
  await panel.getByLabel('İşletme', { exact: true }).selectOption({ label: `Kayıt Kafe ${tag}` });
  await expect(rows(page)).toHaveCount(1); await expect(rows(page).first()).toContainText(`Kayıt Kafe ${tag}`);
  await panel.getByRole('button', { name: 'Süzgeçleri temizle' }).click();
  // Result: the wrong password is there, as "Başarısız".
  await panel.getByLabel('Sonuç', { exact: true }).selectOption({ label: 'Başarısız' });
  await expect(rows(page).filter({ hasText: 'Yönetici girişi başarısız' }).first()).toContainText('Başarısız');
  // Who + kind: only the system's lines of the "İşlem kayıtları" kind (the chain's own start).
  await panel.getByRole('button', { name: 'Süzgeçleri temizle' }).click();
  await panel.getByLabel('Kim', { exact: true }).selectOption({ label: 'Mola Merkez' });
  await panel.getByLabel('İşlem türü', { exact: true }).selectOption({ label: 'İşlem kayıtları' });
  await expect(rows(page).filter({ hasText: /İşlem kayıtları başlatıldı|Geçmiş kayıtlar aktarıldı/ })).toHaveCount(1);
  await panel.getByRole('button', { name: 'Süzgeçleri temizle' }).click();
  // Dates: today (Türkiye) shows today's lines; a start after the end is refused in words.
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  await panel.getByLabel('Başlangıç tarihi', { exact: true }).fill(today); await panel.getByLabel('Bitiş tarihi', { exact: true }).fill(today);
  await expect(rows(page).filter({ hasText: `Kayıt Kafe ${tag}` })).toHaveCount(1);
  await panel.getByLabel('Başlangıç tarihi', { exact: true }).fill('2099-01-02'); await panel.getByLabel('Bitiş tarihi', { exact: true }).fill('2099-01-01');
  await expect(panel.getByRole('alert')).toContainText('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
  await panel.getByRole('button', { name: 'Süzgeçleri temizle' }).click();
  // Rapor al: three icon buttons, always at hand.
  const report = page.getByRole('region', { name: 'Rapor al' });
  for (const [button, ext] of [['Excel indir', 'xlsx'], ['Denetlenebilir kopya (JSONL)', 'jsonl'], ['PDF indir', 'pdf']] as const) {
    const wait = page.waitForEvent('download');
    await report.getByRole('button', { name: button }).click();
    const download = await wait;
    expect(download.suggestedFilename()).toMatch(new RegExp(`^islem-kayitlari-.*\\.${ext}$`));
    const file = info.outputPath(`rapor.${ext}`); await download.saveAs(file);
    const head = readFileSync(file).subarray(0, 5).toString('latin1');
    if (ext === 'pdf') expect(head).toBe('%PDF-'); else if (ext === 'xlsx') expect(head.slice(0, 2)).toBe('PK'); else expect(readFileSync(file, 'utf8').split('\n')[0]).toContain('mola-islem-kayitlari-1');
  }
  await expect(panel.locator('.notice-success')).toContainText('indirildi');
  // Each report is a line of its own.
  await expect(rows(page).filter({ hasText: 'İşlem kayıtları raporu alındı' }).first()).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: info.outputPath('islem-kayitlari.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: info.outputPath('islem-kayitlari-telefon.png'), fullPage: true });
});

test('Çalışma klasörü: set a folder, it is filled (README, durum özeti, işlem kayıtları); turned off; versions shown', async ({ page }, info) => {
  test.setTimeout(90_000);
  const folder = mkdtempSync(join(tmpdir(), 'mola-calisma-e2e-'));
  try {
    await openYonetim(page);
    await yonetimSettings(page, 'Çalışma klasörü');
    const panel = page.getByRole('region', { name: 'Çalışma klasörü' });
    await expect(panel.getByRole('definition').first()).toHaveText('Kapalı');
    await panel.getByLabel('Klasör yolu', { exact: true }).fill('goreli\\yol');
    await panel.getByRole('button', { name: 'Kaydet' }).click();
    await expect(panel.locator('.notice-error')).toContainText('Tam yol');
    await panel.getByLabel('Klasör yolu', { exact: true }).fill(folder);
    await panel.getByRole('button', { name: 'Kaydet' }).click();
    await expect(panel.locator('.notice-success')).toContainText('kaydedildi ve dolduruldu', { timeout: 30000 });
    await expect(panel.getByRole('definition').first()).toHaveText(folder);
    for (const f of ['README.md', 'durum-ozeti.md', 'islem-kayitlari', 'hata-kayitlari', 'destek-talepleri', 'surumler', 'guncellemeler']) expect(existsSync(join(folder, f)), f).toBe(true);
    expect(readdirSync(join(folder, 'islem-kayitlari')).some(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))).toBe(true);
    expect(readFileSync(join(folder, 'README.md'), 'utf8')).toContain('Mola çalışma klasörü');
    // The setting itself is a line in İşlem kayıtları.
    await page.getByRole('button', { name: 'Şimdi güncelle' }).click();
    await expect(panel.locator('.notice-success')).toContainText('güncellendi');
    await page.screenshot({ path: info.outputPath('calisma-klasoru.png'), fullPage: true });
    // One version line (the page's footer): Mola Yönetim, Merkez and the studio.
    await expect(page.getByLabel('Sürüm', { exact: true })).toHaveText(`Mola Yönetim ${version} · Merkez ${version} · Merkut Studios`);
    await expect(page.getByTestId('app-version')).toHaveCount(1);
    page.once('dialog', d => void d.accept());
    await panel.getByRole('button', { name: 'Kapat' }).click();
    await expect(panel.locator('.notice-success')).toContainText('kapatıldı');
    await expect(panel.getByRole('definition').first()).toHaveText('Kapalı');
    await yonetimSettings(page, 'İşlem kayıtları');
    await expect(rows(page).filter({ hasText: 'Çalışma klasörü ayarlandı' }).first()).toContainText(folder);
    await expect(rows(page).filter({ hasText: 'Çalışma klasörü kapatıldı' })).toHaveCount(1);
    // Güncellemeler: the drop zone and the plain steps.
    await yonetimSettings(page, 'Güncellemeler');
    await expect(page.getByText('Güncelleme dosyasını buraya sürükleyin')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Nasıl yayınlanır' })).toContainText('npm run installer');
    // Two-step login is off on this test Merkez: uploading and publishing wait for it.
    await expect(page.getByRole('region', { name: 'Güncelleme yetkisi' })).toContainText('önce iki adımlı doğrulamayı açın');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await fits(page)).toBe(true);
    void merkezPassword;
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
