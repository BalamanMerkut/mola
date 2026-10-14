import { test, expect, devices } from '@playwright/test';
import { codesOf, ensureSetup, openSettings } from './helpers';

/*
 * Raporlarım (src/ReportsPhone.tsx, server/remote-reports.ts) from Ayarlar → Uzaktan erişim on the café computer
 * (src/RemoteAccess.tsx, 0.1.21): the phone first. The phone code is set up on screen with the authenticator's QR, then the
 * pairing QR; the phone page on Mola Merkez makes its own keys, says "Eşleşti ✓ · <işletme>" and goes on to the live report
 * (decrypted on the phone), the last encrypted snapshot while the café computer is off ("Kafe bilgisayarı kapalı · Son
 * durum …"), its last report with no internet at all, and nothing once the owner removes it.
 */
const PASSWORD = 'MolaDemo!2026';

test('Uzaktan erişim: phone code and the pairing QR on the café computer, "Eşleşti ✓", live report, offline snapshot, removal revokes', async ({ browser }, info) => {
  test.setTimeout(240_000);
  const cafe = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const phoneContext = await browser.newContext({ ...devices['iPhone 13'] });
  let recovery = '';
  try {
    expect((await cafe.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
    await ensureSetup(cafe.request);
    const state = await (await cafe.request.get('/api/staff/state')).json();
    const owner = await cafe.newPage(); await owner.goto('/');
    await openSettings(owner, 'Uzaktan erişim');
    const page = owner.locator('.remote-access');
    const step1 = page.locator('section.settings-card', { has: owner.getByRole('heading', { name: '1 · Telefonunuz' }) });
    const step2 = page.locator('section.settings-card', { has: owner.getByRole('heading', { name: '2 · Laptop ve tablet' }) });
    const devicesCard = page.locator('section.settings-card', { has: owner.getByRole('heading', { name: '5 · Eşleşmiş cihazlar' }) });
    await expect(step1).toContainText('Önce telefonunuzu bağlayın.');
    // The café computer is never the phone: no question, the computer's way (QR codes) at once.
    await expect(owner.getByText('Bu ekranı şu an telefonunuzdan mı açtınız?')).toHaveCount(0);
    await expect(step2).toContainText('Telefonunuz bağlanınca buradan eklenir.');
    await expect(devicesCard).toContainText('Henüz eşleşmiş cihaz yok.');
    // a) The phone code: the password, then the authenticator's QR, then its code; the recovery codes once.
    await expect(step1.getByText('Önce telefon kodunu kurun.')).toBeVisible();
    await step1.getByLabel('Şifreniz').fill(PASSWORD);
    await step1.getByRole('button', { name: 'Telefon kodunu kur' }).click();
    await expect(step1.getByRole('img', { name: 'Doğrulama uygulaması kurulum QR kodu' })).toBeVisible();
    await step1.getByText('QR okutamıyorum').click();
    const code = codesOf((await step1.locator('details code').innerText()).trim());
    await step1.getByLabel('Uygulamadaki 6 haneli kod').fill(await code());
    await owner.screenshot({ path: info.outputPath('sahip-telefon-kodu.png'), fullPage: true });
    await step1.getByRole('button', { name: 'Kodu onayla' }).click();
    recovery = (await step1.getByRole('textbox', { name: 'Kurtarma kodları' }).inputValue()).split('\n')[0];
    await step1.getByRole('button', { name: 'Kodları sakladım' }).click();
    await expect(step1).toContainText('Telefon kodu kurulu.');
    // b) The pairing QR: the device's name, the password and the code; a wrong password shows no QR.
    const ask = step1.getByRole('form', { name: 'QR kodu göster' });
    await ask.getByLabel('Cihazın adı').fill('Ahmet’in telefonu');
    await ask.getByLabel('Şifreniz').fill('yanlis-sifre');
    await ask.getByLabel('Telefon kodu').fill('000000');
    await ask.getByRole('button', { name: 'QR kodu göster' }).click();
    await expect(step1.getByText(/^Şifre yanlış/)).toBeVisible();
    await expect(owner.getByRole('img', { name: 'Cihaz eşleştirme QR kodu' })).toHaveCount(0);
    await expect(ask.getByLabel('Şifreniz')).toHaveValue('');
    await ask.getByLabel('Şifreniz').fill(PASSWORD);
    await ask.getByLabel('Telefon kodu').fill(await code());
    const [paired] = await Promise.all([owner.waitForResponse(r => r.url().endsWith('/api/staff/remote-reports/pair') && r.request().method() === 'POST'), ask.getByRole('button', { name: 'QR kodu göster' }).click()]);
    expect(paired.status()).toBe(200);
    const { url } = await paired.json() as { url: string };
    expect(new URL(url).pathname).toBe('/raporlarim'); expect(new URL(url).hash).toMatch(/^#e=/);
    await expect(owner.getByRole('img', { name: 'Cihaz eşleştirme QR kodu' })).toBeVisible();
    // The link sits in the copy button (no long address on screen).
    await expect(step1.getByRole('button', { name: 'Bağlantıyı kopyala' })).toHaveAttribute('title', url);
    await owner.screenshot({ path: info.outputPath('sahip-telefon-qr.png'), fullPage: true });

    // The phone scans the QR: the secret is in the fragment and leaves the address bar at once.
    const phone = await phoneContext.newPage();
    await phone.goto(url);
    await expect(phone.getByRole('form', { name: 'Bu cihazı eşleştir' })).toBeVisible();
    expect(new URL(phone.url()).hash).toBe('');
    await phone.getByRole('button', { name: 'Eşleştir', exact: true }).click();
    // The screen changes at once: "Eşleşti ✓ · <işletme>", then the live report.
    await expect(phone.getByRole('status').filter({ hasText: 'Eşleşti ✓' })).toHaveText(`Eşleşti ✓ · ${state.name}`);
    await expect(phone.getByRole('form', { name: 'Bu cihazı eşleştir' })).toHaveCount(0);
    await expect(phone.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByRole('region', { name: 'Bugünün satışı' })).toContainText('Nakit');
    await expect(phone.getByRole('region', { name: 'Son 30 gün' })).toBeVisible();
    // Uzaktan yönetim is in the demo package: "Kafeyi yönet" says what it opens.
    await expect(phone.getByRole('link', { name: 'Kafeyi yönet · Satış ve Raporlar, menü, ayarlar' })).toHaveAttribute('href', '/yonet');
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await phone.screenshot({ path: info.outputPath('telefon-raporlarim.png'), fullPage: true });
    // The café computer lists the phone, as a phone; step 1 is done, step 2 open; the QR is gone.
    const list = devicesCard.getByRole('list', { name: 'Eşleşmiş cihazlar' });
    await expect(list).toContainText('Ahmet’in telefonu', { timeout: 15_000 });
    await expect(list).toContainText('Telefon ·');
    await expect(step1).toContainText('Telefonunuz bağlı: Ahmet’in telefonu.');
    await expect(step2).toContainText('Bu cihazı eşleştir');
    await expect(owner.getByRole('img', { name: 'Cihaz eşleştirme QR kodu' })).toHaveCount(0);
    await expect(list).toContainText(/Son rapor: \d/, { timeout: 15_000 });
    await owner.screenshot({ path: info.outputPath('sahip-uzaktan-erisim.png'), fullPage: true });

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
    await expect(phone.getByText('Eşleşti ✓')).toHaveCount(0);

    // The owner removes the phone on the café computer: it gets nothing any more.
    // "Kaldır" asks the password again (not the phone code: the lost phone may hold the authenticator app).
    await devicesCard.getByRole('button', { name: 'Ahmet’in telefonu cihazını kaldır' }).click();
    await devicesCard.getByRole('form', { name: 'Ahmet’in telefonu cihazını kaldır' }).getByLabel('Şifreniz').fill(PASSWORD);
    await devicesCard.getByRole('button', { name: 'Evet, kaldır' }).click();
    await expect(devicesCard.getByText('Henüz eşleşmiş cihaz yok.')).toBeVisible();
    await expect(step1).toContainText('Önce telefonunuzu bağlayın.');
    await expect(async () => {
      await phone.getByRole('button', { name: 'Yenile' }).click({ timeout: 2000 }).catch(() => {});
      await expect(phone.getByRole('heading', { name: 'Bu cihazın eşleşmesi kaldırıldı' })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await expect(phone.getByText('Ayarlar → Uzaktan erişim')).toBeVisible();
  } finally {
    // The owner's phone code off again (with a recovery code), for the suites after this one.
    if (recovery) await cafe.request.post('/api/staff/report-security/recover', { data: { password: PASSWORD, recoveryCode: recovery } });
    await phoneContext.close(); await cafe.close();
  }
});

test('Uzaktan erişim without the package: the package card and the way to the Mola team, nothing else', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  // The package as the café server tells it, without Raporlarım (the server refuses its routes anyway).
  await page.route('**/api/staff/state', async route => { const r = await route.fetch(); const s = await r.json(); s.pkg = { ...(s.pkg ?? {}), enabled: (s.pkg?.enabled ?? ['core', 'qr-menu']).filter((f: string) => f !== 'remote-reports' && f !== 'remote-admin') }; await route.fulfill({ response: r, json: s }); });
  await page.goto('/');
  await openSettings(page, 'Uzaktan erişim');
  const lock = page.locator('.feature-lock[data-feature="remote-reports"]');
  await expect(lock).toBeVisible();
  await expect(lock).toContainText('Bu hizmet paketinizde yok');
  await expect(lock.getByRole('button', { name: 'Mola ekibine yaz' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1 · Telefonunuz' })).toHaveCount(0);
});
