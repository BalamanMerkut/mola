import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { totp } from '../../server/totp';
import { ADMIN_API, confirmStepUp, detailTab, enableAdminFactor, merkezPassword, openBusiness, openYonetim, yonetimGo, yonetimSettings, yonetimShot, yonetimState } from './helpers';

/** No sideways page scroll and nothing poking out of the right edge (as tests/browser/platform-layout.spec.ts). */
async function fits(page: Page) {
  return page.evaluate(() => {
    const wide = document.documentElement.scrollWidth > innerWidth + 1;
    const out = [...document.querySelectorAll<HTMLElement>('main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !e.closest('.platform-pills, .detail-tabs, .segmented, .pill-tabs'); })
      .slice(0, 5).map(e => `${e.tagName.toLowerCase()}.${e.className}`);
    return wide || out.length ? `taşıyor: ${out.join(', ') || 'sayfa'}` : 'ok';
  });
}
const sizes = [[360, 800], [390, 844], [768, 1024], [1024, 768], [1280, 860], [1440, 900]] as const;

test('İşletme → Hizmet: the change bar follows the scroll; without two-step login "İki adımlı doğrulamayı aç" goes to Hesap güvenliği and back to the change', async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openYonetim(page);
  let demo: any;
  await expect.poll(async () => { demo = (await yonetimState(page.request)).businesses.find((b: any) => b.source === 'import' && b.machines?.length); return !!demo; }, { timeout: 20_000 }).toBe(true);
  const detail = await openBusiness(page, demo.name);
  await detailTab(detail, 'Hizmet').click();
  const packages = detail.getByRole('radiogroup', { name: 'Hizmet paketi' });
  await packages.getByRole('radio', { checked: false }).first().click();
  const bar = detail.getByRole('region', { name: 'Değişikliği onayla' });
  await expect(bar).toContainText('/ay');
  await expect(bar.getByRole('button', { name: 'Değişikliği uygula' })).toBeVisible();
  // Scrolled back to the top of the long sheet, the bar is still on the screen (sticky), not only at the very bottom.
  await detail.getByRole('region', { name: 'Hizmet durumu' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.yonetim-main')?.scrollTo(0, 0); });
  await expect(bar).toBeInViewport();
  await yonetimShot(page, 'hizmet-uygula-cubugu.png', info.outputPath('hizmet-uygula-cubugu.png'), false);
  for (const [width, height] of sizes) { await page.setViewportSize({ width, height }); expect(await fits(page), `çubuk ${width}`).toBe('ok'); await expect(bar).toBeInViewport(); }
  await page.setViewportSize({ width: 1280, height: 720 });
  // One press (K-V): no "Emin misiniz?" step; the bar already says what changes and the code is the confirmation.
  await bar.getByRole('button', { name: 'Değişikliği uygula' }).click();
  await expect(bar).not.toContainText('Emin misiniz?');
  await expect(bar.getByRole('button', { name: 'Evet, uygula' })).toHaveCount(0);
  // The step-up box: no two-step login yet. Its button used to do nothing here (the refused change was still "busy").
  const blocked = page.getByRole('dialog', { name: 'İki adımlı doğrulama gerekli' });
  await blocked.getByRole('button', { name: 'İki adımlı doğrulamayı aç' }).click();
  const security = page.getByRole('navigation', { name: 'Ayarlar bölümleri' }).getByRole('button', { name: 'Hesap güvenliği', exact: true });
  await expect(security).toHaveAttribute('aria-current', /page|true/);
  await expect(page.getByTestId('mfa-pending')).toContainText('“Değişikliği uygula” iki adımlı doğrulama bekliyor');
  await expect(page.getByLabel('Güvenlik ayarı için yönetici şifresi')).toBeFocused();
  await expect(page.locator('.yonetim-flash .notice-error')).toHaveCount(0);
  // "Kaldığım yere dön": the same business, Hizmet, the unsaved choice still there.
  await page.getByRole('button', { name: 'Kaldığım yere dön' }).click();
  await expect(detailTab(detail, 'Hizmet')).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'Değişikliği uygula' })).toBeVisible();
  await bar.getByRole('button', { name: 'Değişikliği uygula' }).click();
  await page.getByRole('dialog', { name: 'İki adımlı doğrulama gerekli' }).getByRole('button', { name: 'İki adımlı doğrulamayı aç' }).click();
  // The setup itself; switching it on ends the session, and the new login comes back to the waiting change.
  await page.getByLabel('Güvenlik ayarı için yönetici şifresi').fill(merkezPassword());
  const started = page.waitForResponse('**/api/merkez/admin/mfa/setup');
  await page.getByRole('button', { name: 'Authenticator kurulumunu başlat' }).click();
  const setup = await (await started).json();
  await expect(page.getByTestId('mfa-pending')).toBeVisible();
  await page.getByLabel('Kurtarma kodlarını güvenli bir yerde sakladım').check();
  await page.getByLabel('3. Altı haneli doğrulama kodu').fill(totp(setup.secret, Date.now()));
  await page.getByRole('button', { name: 'İki adımlı girişi etkinleştir' }).click();
  await page.getByLabel('Şifre', { exact: true }).fill(merkezPassword());
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await page.getByLabel('Authenticator veya kurtarma kodu', { exact: true }).fill(setup.recoveryCodes[0]);
  await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
  await expect(page.locator('.yonetim-flash .notice-success')).toContainText('“Değişikliği uygula” için kaldığınız yerdesiniz');
  await expect(detailTab(detail, 'Hizmet')).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'Değişikliği uygula' })).toBeVisible();
  // Two-step login off again: the next tests start from the plain state (the first one checks the refusal for prices).
  const off = await page.request.post(`${ADMIN_API}/mfa/disable`, { data: { password: merkezPassword(), code: setup.recoveryCodes[1] } });
  expect(off.ok(), await off.text()).toBe(true);
});

test('Paketler: build a package (requirements added, discount, live total), Hizmet fiyatları, the six-item top bar fits', async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openYonetim(page);
  // Without two-step login a price change is refused, like publishing an update, with the way to Hesap güvenliği.
  await yonetimSettings(page, 'Hizmet fiyatları');
  let prices = page.getByRole('region', { name: 'Hizmet fiyatları' });
  await prices.getByLabel('QR menü aylık fiyat').fill('250');
  await prices.getByRole('button', { name: 'Fiyatları kaydet' }).click();
  const blocked = page.getByRole('dialog', { name: 'İki adımlı doğrulama gerekli' });
  await expect(blocked).toContainText('Fiyat, paket ve ödeme değişiklikleri için önce iki adımlı doğrulamayı açın');
  await expect(blocked.getByRole('button', { name: 'İki adımlı doğrulamayı aç' })).toBeVisible();
  await blocked.getByRole('button', { name: 'Kapat', exact: true }).last().click();
  await expect(prices.locator('.notice-error')).toContainText('iki adımlı doğrulamayı açın');
  expect((await yonetimState(page.request)).catalog.features.find((f: any) => f.id === 'qr-menu').monthly).toBe(20000);
  // Two-step login on (every session ends); signed in again with a backup code.
  await enableAdminFactor(page.request);
  await openYonetim(page);
  await yonetimSettings(page, 'Paketler');
  const list = page.getByRole('region', { name: 'Paketler' });
  for (const name of ['Çay bahçesi', 'Kafe Standart', 'Restoran Pro']) await expect(list.getByRole('article', { name })).toBeVisible();
  await expect(list.getByRole('article', { name: 'Kafe Standart' })).toContainText('₺1.625');
  // 6 Ekim: Restoran Pro without Bulutta şifreli yedek (sold apart) and without a separate Müdür rolü (in the core), with
  // Sosyal medya ve QR kartları (paid since 6 Ekim, ₺75): 2.350 TL/ay.
  await expect(list.getByRole('article', { name: 'Restoran Pro' })).toContainText('₺2.350');
  await expect(page.locator('main')).not.toContainText('Müdür rolü');
  await expect(list.getByRole('region', { name: 'Eski planlar' })).toContainText('Tam sistem (eski plan)');
  await list.getByRole('button', { name: 'Yeni paket' }).first().click();
  const builder = page.getByRole('region', { name: 'Yeni paket' });
  await builder.getByLabel('Paket adı').fill('Bahçe Plus');
  // Core is always on; QR sipariş brings QR menü along and says so.
  await expect(builder.getByRole('checkbox', { name: /Adisyon çekirdeği/ })).toBeDisabled();
  await expect(builder.getByRole('checkbox', { name: /Adisyon çekirdeği/ })).toBeChecked();
  await builder.getByText('QR sipariş ve garson çağırma', { exact: true }).click();
  await expect(builder.getByRole('checkbox', { name: /^QR menü/ })).toBeChecked();
  await expect(builder.locator('.feature-note')).toContainText('QR menü de eklendi');
  await builder.getByText('Rezervasyon ve etkinlik', { exact: true }).click();
  await expect(builder.getByRole('checkbox', { name: /Paket servis platformları/ })).toBeDisabled();
  // 750 + 200 + 150 + 150 = 1.250 TL/ay; 10% off → 1.125 TL/ay, 11.250 TL/yıl.
  const total = builder.getByLabel('Paket toplamı');
  await expect(total).toContainText('₺1.250');
  await builder.getByRole('radio', { name: '%' }).click();
  await builder.getByLabel('İndirim yüzdesi').fill('10');
  await expect(total).toContainText('₺1.125'); await expect(total).toContainText('₺11.250');
  await yonetimShot(page, 'paket-olustur.png', info.outputPath('paket-olustur.png'));
  for (const [width, height] of sizes) { await page.setViewportSize({ width, height }); expect(await fits(page), `paket oluştur ${width}`).toBe('ok'); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The Authenticator code is asked for over the screen; the package is made right after it.
  await builder.getByRole('button', { name: 'Paketi oluştur' }).click();
  await confirmStepUp(page, 'Paketi oluştur');
  await expect(list.getByText('“Bahçe Plus” paketi oluşturuldu.')).toBeVisible();
  const card = list.getByRole('article', { name: 'Bahçe Plus' });
  await expect(card).toContainText('₺1.125'); await expect(card).toContainText('%10 indirim');
  await yonetimShot(page, 'paketler.png', info.outputPath('paketler.png'));
  for (const [width, height] of sizes) { await page.setViewportSize({ width, height }); expect(await fits(page), `paketler ${width}`).toBe('ok'); }
  // Hizmet fiyatları: QR menü 250 TL; yearly follows (×10) unless typed; recorded in İşlem kayıtları. Within the
  // 10 minutes of that code no second code is asked.
  await page.setViewportSize({ width: 1280, height: 900 });
  await yonetimSettings(page, 'Hizmet fiyatları');
  prices = page.getByRole('region', { name: 'Hizmet fiyatları' });
  await expect(prices).toContainText('Yakında');
  await prices.getByLabel('QR menü aylık fiyat').fill('250');
  await expect(prices.getByLabel('QR menü yıllık fiyat')).toHaveAttribute('placeholder', '2.500');
  await prices.getByRole('button', { name: 'Fiyatları kaydet' }).click();
  await expect(prices.getByText(/1 hizmetin fiyatı kaydedildi/)).toBeVisible();
  await expect(page.getByRole('form', { name: 'Doğrulayıcı onayı' })).toHaveCount(0);
  for (const [width, height] of sizes) { await page.setViewportSize({ width, height }); expect(await fits(page), `fiyatlar ${width}`).toBe('ok'); }
  const catalog = (await yonetimState(page.request)).catalog;
  expect(catalog.features.find((f: any) => f.id === 'qr-menu').monthly).toBe(25000);
  // The items of the top bar (seven; six on a phone, Duyurular beside the bell): inside the screen, labels not cut.
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    const nav = page.getByRole('navigation', { name: 'Mola Yönetim bölümleri' });
    expect(await nav.evaluate(n => [...n.querySelectorAll('button')].filter(b => b.offsetParent !== null).every(b => { const r = b.getBoundingClientRect(), label = b.querySelector('span') as HTMLElement; return r.left >= 0 && r.right <= innerWidth + 0.5 && r.height >= 44 && label.scrollWidth <= label.clientWidth + 1; })), `menü ${width}`).toBe(true);
  }
});

test('İşletme → Hizmet: Özel with a discount (confirmed), Lisans → "Ödeme alındı" makes the Satışlarım entry, exports download', async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Prices, packages and payments need two-step login (on already when the first test ran; a run of this test alone turns it on).
  await openYonetim(page);
  if (await enableAdminFactor(page.request)) await openYonetim(page);
  let demo: any;
  await expect.poll(async () => { demo = (await yonetimState(page.request)).businesses.find((b: any) => b.source === 'import' && b.machines?.length); return !!demo; }, { timeout: 20_000 }).toBe(true);
  const detail = await openBusiness(page, demo.name);
  await detailTab(detail, 'Hizmet').click();
  await expect(detail.getByRole('region', { name: 'Hizmet durumu' })).toContainText('Şu an açık');
  await detail.getByRole('radiogroup', { name: 'Hizmet paketi' }).getByRole('radio', { name: /^Özel/ }).click();
  // Start from the Çay bahçesi-like core + QR menü: untick what is not needed, tick Stok.
  const picker = detail.getByRole('group', { name: 'Bu işletmenin hizmetleri' });
  await expect(picker).not.toContainText('Müdür rolü');
  for (const name of ['QR menü', 'Gelişmiş raporlar', 'Rezervasyon ve etkinlik', 'Vardiya, bahşiş ve personel raporu', 'Uzaktan raporlar', 'İki ekran', 'Bulutta şifreli yedek']) {
    const box = picker.getByRole('checkbox', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) });
    if (await box.isChecked()) await picker.getByText(name, { exact: true }).click();
  }
  await expect(picker.getByRole('checkbox', { name: /^QR sipariş/ })).not.toBeChecked();
  const discount = detail.getByRole('region', { name: 'Bu işletme için fiyat' });
  await discount.getByRole('radio', { name: '₺ / ay' }).click();
  await discount.getByLabel('Aylık indirim tutarı').fill('100');
  const confirm = detail.getByRole('region', { name: 'Değişikliği onayla' });
  await expect(confirm).toContainText('Özel'); await expect(confirm).toContainText('Çıkan');
  await yonetimShot(page, 'isletme-hizmet.png', info.outputPath('isletme-hizmet.png'));
  for (const [width, height] of sizes) { await page.setViewportSize({ width, height }); expect(await fits(page), `hizmet ${width}`).toBe('ok'); if (width === 390) await page.screenshot({ path: info.outputPath('hizmet-390.png'), fullPage: true }); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await confirm.getByRole('button', { name: 'Değişikliği uygula' }).click();
  // A new session: the code once, then the change goes through by itself.
  await confirmStepUp(page, 'Değişikliği uygula');
  await expect(page.locator('.notice-success')).toContainText('Hizmetler kaydedildi');
  let b = (await yonetimState(page.request)).businesses.find((x: any) => x.tenantId === demo.tenantId);
  expect(b.services.packageName).toBe('Özel'); expect(b.services.features).not.toContain('qr-order'); expect(b.services.discount).toEqual({ kind: 'amount', value: 10000 });
  // Lisans: "Ödeme alındı" prefilled with this business's price × 1 month; Kart, invoice number; extension saves both.
  await detailTab(detail, 'Lisans').click();
  const payment = detail.getByRole('group', { name: 'Ödeme alındı' });
  await expect(payment.getByRole('checkbox')).toBeChecked();
  await detail.getByRole('button', { name: '1 ay uzat' }).click();
  await expect(payment.getByLabel('Tutar (KDV hariç)')).toHaveValue(new Intl.NumberFormat('tr-TR').format(b.services.price.monthly / 100));
  await payment.getByRole('radio', { name: 'Kart' }).click();
  await payment.getByLabel(/Fatura no/).fill('MOL2026000777');
  await detail.getByRole('button', { name: 'Emin misiniz? 1 ay eklenir' }).click();
  await expect(page.locator('.notice-success')).toContainText('Ödeme Satışlarım’a kaydedildi');
  for (const [width, height] of sizes) { await page.setViewportSize({ width, height }); expect(await fits(page), `lisans ${width}`).toBe('ok'); }
  // Satışlarım: the entry, the cards, KDV; a manual "Ödeme ekle" waiting for payment, then "Ödendi".
  await page.setViewportSize({ width: 1440, height: 1000 });
  await yonetimGo(page, 'Satışlarım');
  const sales = page.getByRole('region', { name: 'Satışlarım' });
  const rows = sales.getByRole('table', { name: 'Satışlar' }).getByRole('row');
  await expect(rows.filter({ hasText: 'MOL2026000777' })).toContainText('Kart');
  await sales.getByRole('button', { name: 'Ödeme ekle' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ödeme ekle' });
  await dialog.getByRole('radio', { name: '1 yıl' }).click();
  await dialog.getByRole('radio', { name: 'Ödenmedi' }).click();
  await dialog.getByLabel(/Fatura no/).fill('MOL2026000778');
  await dialog.getByRole('button', { name: 'Kaydet' }).click();
  await expect(sales.getByText('Ödeme kaydedildi.')).toBeVisible();
  await expect(sales.locator('.kpi-card').nth(2)).toContainText('1 kayıt ödenmedi');
  await expect(sales.getByRole('region', { name: 'KDV dökümü' })).toContainText('%20');
  await yonetimShot(page, 'satislarim.png', info.outputPath('satislarim.png'));
  for (const [width, height] of sizes) { await page.setViewportSize({ width, height }); expect(await fits(page), `satışlarım ${width}`).toBe('ok'); if (width === 390) await page.screenshot({ path: info.outputPath('satislarim-390.png'), fullPage: true }); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const waiting = rows.filter({ hasText: 'MOL2026000778' });
  await waiting.getByRole('button', { name: /ödendi yap/ }).click();
  await expect(waiting.locator('.status-chip')).toHaveText('Ödendi');
  // Excel and PDF for the accountant.
  const xl = page.waitForEvent('download');
  await sales.getByRole('button', { name: 'Excel' }).click();
  const xlFile = await xl;
  expect(xlFile.suggestedFilename()).toMatch(/^mola-satislarim-\d{4}\.xlsx$/);
  expect(readFileSync(await xlFile.path()).subarray(0, 2).toString('latin1')).toBe('PK');
  const pdf = page.waitForEvent('download', { timeout: 90_000 });
  await sales.getByRole('button', { name: 'PDF' }).click();
  const pdfFile = await pdf;
  expect(readFileSync(await pdfFile.path()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // İşlem kayıtları has them.
  await yonetimSettings(page, 'İşlem kayıtları');
  await expect(page.locator('main')).toContainText('Satış / ödeme kaydı eklendi');
});
