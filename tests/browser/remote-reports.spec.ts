import { test, expect } from '@playwright/test';
import { ensureSetup, openSettings } from './helpers';

/*
 * Raporlarım (src/ReportsPhone.tsx, server/remote-reports.ts): the owner pairs a phone with the QR from Destek → Uzaktan
 * erişim; the phone page on Mola Merkez makes its own keys, shows the live report (decrypted on the phone), the last encrypted
 * snapshot while the café computer is off ("Kafe bilgisayarı kapalı · Son durum …"), its last report with no internet at
 * all, and nothing once the owner removes it.
 */
const PASSWORD = 'MolaDemo!2026';

test('Raporlarım: pair a phone by QR, live report, offline snapshot, removal revokes', async ({ browser }, info) => {
  test.setTimeout(240_000);
  const cafe = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    expect((await cafe.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
    await ensureSetup(cafe.request);
    const state = await (await cafe.request.get('/api/staff/state')).json();
    const owner = await cafe.newPage(); await owner.goto('/');
    // Ayarlar → Güvenlik ve yedek → Telefonum (10 Ekim; once Destek → Uzaktan erişim).
    await openSettings(owner, 'Telefonum');
    const card = owner.locator('.phone-pairing');
    await expect(card.getByText('Henüz eşleşmiş cihaz yok.')).toBeVisible();
    await expect(card).toContainText('Tablet ya da dizüstü bilgisayar da eşleştirebilirsiniz');
    // "Telefonu eşleştir" asks the device's name and the owner's password again; a wrong password shows no QR.
    await card.getByRole('button', { name: 'Telefonu eşleştir' }).click();
    const ask = card.getByRole('form', { name: 'Cihaz eşleştir' });
    await ask.getByLabel('Cihazın adı').fill('Ahmet’in telefonu');
    await ask.getByLabel('Şifreniz').fill('yanlis-sifre');
    await ask.getByRole('button', { name: 'QR kodu göster' }).click();
    await expect(card.getByText(/^Şifre yanlış/)).toBeVisible();
    await expect(owner.getByRole('img', { name: 'Cihaz eşleştirme QR kodu' })).toHaveCount(0);
    await expect(ask.getByLabel('Şifreniz')).toHaveValue('');
    await ask.getByLabel('Şifreniz').fill(PASSWORD);
    await owner.screenshot({ path: info.outputPath('sahip-cihaz-sifre.png'), fullPage: true });
    const [paired] = await Promise.all([owner.waitForResponse(r => r.url().endsWith('/api/staff/remote-reports/pair') && r.request().method() === 'POST'), ask.getByRole('button', { name: 'QR kodu göster' }).click()]);
    expect(paired.status()).toBe(200);
    const { url } = await paired.json() as { url: string };
    expect(new URL(url).pathname).toBe('/raporlarim'); expect(new URL(url).hash).toMatch(/^#e=/);
    await expect(owner.getByRole('img', { name: 'Cihaz eşleştirme QR kodu' })).toBeVisible();
    await expect(card.getByRole('textbox', { name: 'Eşleştirme bağlantısı' })).toHaveValue(url);
    await owner.screenshot({ path: info.outputPath('sahip-telefon-qr.png'), fullPage: true });

    // The phone scans the QR: the secret is in the fragment and leaves the address bar at once.
    const phone = await phoneContext.newPage();
    await phone.goto(url);
    await expect(phone.getByRole('form', { name: 'Bu cihazı eşleştir' })).toBeVisible();
    expect(new URL(phone.url()).hash).toBe('');
    await phone.getByRole('button', { name: 'Eşleştir', exact: true }).click();
    await expect(phone.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByText(state.name).first()).toBeVisible();
    await expect(phone.getByRole('region', { name: 'Bugünün satışı' })).toContainText('Nakit');
    await expect(phone.getByRole('region', { name: 'Son 30 gün' })).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await phone.screenshot({ path: info.outputPath('telefon-raporlarim.png'), fullPage: true });
    // The café computer lists the phone; the QR is gone.
    const list = card.getByRole('list', { name: 'Eşleşmiş cihazlar' });
    await expect(list).toContainText('Ahmet’in telefonu', { timeout: 15_000 });
    await expect(owner.getByRole('img', { name: 'Cihaz eşleştirme QR kodu' })).toHaveCount(0);
    // When it last fetched a report (the live one above).
    await expect(list).toContainText(/Son rapor: \d/, { timeout: 15_000 });

    // The café computer is off (Merkez answers "offline"): the phone opens the encrypted snapshot left at Mola Merkez.
    await phone.route('**/api/merkez/v1/phone/live', route => route.fulfill({ json: { offline: true, seenAt: new Date().toISOString(), waiting: true } }));
    let boxes = 0; phone.on('response', r => { if (r.url().endsWith('/phone/postbox') && r.status() === 200) boxes++; });
    await phone.getByRole('button', { name: 'Yenile' }).click();
    await expect(phone.getByText(/^Kafe bilgisayarı kapalı · Son durum \d\d:\d\d$/)).toBeVisible({ timeout: 15_000 });
    expect(boxes).toBeGreaterThan(0);
    await expect(phone.getByRole('region', { name: 'Bugünün satışı' })).toBeVisible();
    await phone.screenshot({ path: info.outputPath('telefon-kafe-kapali.png'), fullPage: true });
    // Opened again later: the phone remembers its pairing and its last report (IndexedDB), then asks live again.
    await phone.unroute('**/api/merkez/v1/phone/live');
    await phone.goto(new URL('/raporlarim', url).toString());
    await expect(phone.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });

    // The owner removes the phone on the café computer: it gets nothing any more.
    await card.getByRole('button', { name: 'Ahmet’in telefonu cihazını kaldır' }).click();
    await card.getByRole('button', { name: 'Evet, kaldır' }).click();
    await expect(card.getByText('Henüz eşleşmiş cihaz yok.')).toBeVisible();
    await expect(async () => {
      await phone.getByRole('button', { name: 'Yenile' }).click({ timeout: 2000 }).catch(() => {});
      await expect(phone.getByRole('heading', { name: 'Bu cihazın eşleşmesi kaldırıldı' })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
  } finally { await phoneContext.close(); await cafe.close(); }
});
