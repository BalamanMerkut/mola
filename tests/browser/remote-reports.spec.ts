import { test, expect, devices } from '@playwright/test';
import { codesOf, ensureSetup, MERKEZ, merkezMail, openSettings, OWNER_EMAIL, raporlarimLogin, remoteLoginOpen } from './helpers';

/*
 * Raporlarım (0.1.22, src/ReportsPhone.tsx, server/remote-reports.ts): one website sign-in. The café computer's Ayarlar →
 * Uzaktan erişim (src/RemoteAccess.tsx) has five short steps: the phone code and the e-mail set up on screen, then the
 * Raporlarım address. A device that is not signed in opens that address and sees "Giriş yap" (e-mail, password, phone code,
 * its name): the laptop is told to wait for the phone, the phone goes in and shows the live report (decrypted on the phone),
 * then the laptop. The last encrypted snapshot while the café computer is off ("Kafe bilgisayarı kapalı · Son durum …"),
 * still signed in after a reload, "Çıkış" on the laptop, and the owner's "Kaldır" sends the phone back to the sign-in.
 */
const PASSWORD = 'MolaDemo!2026';

test('Uzaktan erişim → five steps; Raporlarım sign-in: phone first, live report, offline snapshot, "Çıkış", removal', async ({ browser }, info) => {
  test.setTimeout(300_000);
  const cafe = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const phoneContext = await browser.newContext({ ...devices['iPhone 13'] });
  const laptopContext = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const mail = await merkezMail();
  let recovery = '';
  try {
    expect((await cafe.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
    await ensureSetup(cafe.request);
    const state = await (await cafe.request.get('/api/staff/state')).json();
    const owner = await cafe.newPage(); await owner.goto('/');
    await openSettings(owner, 'Uzaktan erişim');
    const page = owner.locator('.remote-access'), step = (name: string) => page.locator('section.settings-card', { has: owner.getByRole('heading', { name }) });
    const step1 = step('1 · Telefon kodu'), step2 = step('2 · E-posta'), step3 = step('3 · Cihazlarınızı bağlayın'), devicesCard = step('5 · Eşleşmiş cihazlar');
    await expect(step('4 · Uzaktan yönetim')).toBeVisible();
    // Nothing to pair here any more: no question, no QR of a pairing, no shortcut.
    await expect(owner.getByText('Bu ekranı şu an telefonunuzdan mı açtınız?')).toHaveCount(0);
    await expect(owner.getByRole('img', { name: 'Cihaz eşleştirme QR kodu' })).toHaveCount(0);
    await expect(owner.getByRole('link', { name: 'Bu cihaza kısayol ekle' })).toHaveCount(0);
    await expect(devicesCard).toContainText('Henüz eşleşmiş cihaz yok.');
    // 3: the plain address in big letters, Kopyala, its small QR; until 1 and 2 are done it says so.
    const address = `${MERKEZ}/raporlarim`;
    await expect(step3.locator('.remote-address-text')).toHaveText(address.replace(/^https?:\/\//, ''));
    await expect(step3).toContainText('Telefonunuzda ve laptopunuzda bu adresi açın, e-posta, şifre ve telefon kodunuzla giriş yapın.');
    await expect(step3.getByRole('img', { name: 'Raporlarım adresinin QR kodu' })).toBeVisible();
    await expect(step3).toContainText('Telefon kodu ve e-posta (1 ve 2) tamamlanınca giriş açılır.');
    await step3.getByRole('button', { name: 'Kopyala' }).click();
    await expect(step3.getByRole('button', { name: /Kopyalandı|Kopyala/ })).toBeVisible();
    // 1: the phone code: the password, the authenticator's QR, its code; the recovery codes once.
    await step1.getByLabel('Şifreniz').fill(PASSWORD);
    await step1.getByRole('button', { name: 'Telefon kodunu kur' }).click();
    await expect(step1.getByRole('img', { name: 'Doğrulama uygulaması kurulum QR kodu' })).toBeVisible();
    await step1.getByText('QR okutamıyorum').click();
    const code = codesOf((await step1.locator('details code').innerText()).trim());
    await step1.getByLabel('Uygulamadaki 6 haneli kod').fill(await code());
    await step1.getByRole('button', { name: 'Kodu onayla' }).click();
    recovery = (await step1.getByRole('textbox', { name: 'Kurtarma kodları' }).inputValue()).split('\n')[0];
    await step1.getByRole('button', { name: 'Kodları sakladım' }).click();
    await expect(step1).toContainText('Telefon kodu kurulu.');
    // 2: the e-mail, verified with the code sent to it (Mola Merkez keeps it).
    const email = step2.getByRole('form', { name: 'E-postanızı doğrulayın' });
    await email.getByLabel('E-posta').fill(OWNER_EMAIL);
    await email.getByLabel('Şifreniz').fill(PASSWORD);
    await email.getByRole('button', { name: 'Kod gönder' }).click();
    const verify = step2.getByRole('form', { name: 'E-postayı doğrula' });
    await verify.getByLabel('E-postadaki kod').fill(await mail.lastCode(OWNER_EMAIL));
    await verify.getByRole('button', { name: 'Doğrula' }).click();
    await expect(step2).toContainText('Giriş e-postanız: s');
    await expect(step3).toContainText('Önce telefonunuzla girin; laptop ve tablet ondan sonra.');
    await owner.screenshot({ path: info.outputPath('sahip-uzaktan-erisim.png'), fullPage: true });
    await remoteLoginOpen();

    // The laptop, not signed in: an old pairing link (#e=…) lands on the sign-in, out of the address bar.
    const laptop = await laptopContext.newPage();
    await laptop.goto(`${address}#e=${'A'.repeat(22)}.${'B'.repeat(43)}.${'C'.repeat(43)}.0`);
    const laptopForm = laptop.getByRole('form', { name: 'Giriş yap' });
    await expect(laptopForm).toBeVisible();
    expect(new URL(laptop.url()).hash).toBe('');
    await expect(laptopForm.getByLabel('Bu cihazın adı')).toHaveValue('Laptop');
    // A wrong code: the same words as a wrong password. Then the right one: the phone first.
    await raporlarimLogin(laptop, { code: '000000' });
    await expect(laptopForm.getByRole('alert')).toHaveText('E-posta, şifre ya da kod hatalı.');
    await raporlarimLogin(laptop, { code: await code() });
    await expect(laptopForm.getByRole('alert')).toContainText('Önce telefonunuzdan giriş yapın.');
    await laptop.screenshot({ path: info.outputPath('laptop-once-telefon.png'), fullPage: true });

    // The phone signs in: "Giriş yapıldı ✓ · <işletme>", then the live report.
    const phone = await phoneContext.newPage();
    await phone.goto(address);
    await expect(phone.getByRole('form', { name: 'Giriş yap' }).getByLabel('Bu cihazın adı')).toHaveValue('iPhone');
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await phone.screenshot({ path: info.outputPath('telefon-giris.png'), fullPage: true });
    await raporlarimLogin(phone, { code: await code(), name: 'Ahmet’in telefonu' });
    await expect(phone.getByRole('status').filter({ hasText: 'Giriş yapıldı ✓' })).toHaveText(`Giriş yapıldı ✓ · ${state.name}`);
    await expect(phone.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByRole('region', { name: 'Bugünün satışı' })).toContainText('Bugün ·');
    await expect(phone.getByRole('region', { name: 'Bugünün satışı' })).toContainText('Nakit');
    await expect(phone.getByRole('region', { name: 'Son 30 gün' })).toBeVisible();
    // Uzaktan yönetim is in the demo package: "Kafeyi yönet" says what it opens.
    await expect(phone.getByRole('link', { name: 'Kafeyi yönet · Satış ve Raporlar, menü, ayarlar' })).toHaveAttribute('href', '/yonet');
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await phone.screenshot({ path: info.outputPath('telefon-raporlarim.png'), fullPage: true });
    // The café computer lists it, as a phone, and the owner was told.
    const list = devicesCard.getByRole('list', { name: 'Eşleşmiş cihazlar' });
    await expect(list).toContainText('Ahmet’in telefonu', { timeout: 15_000 });
    await expect(list).toContainText('Telefon ·');
    await expect(list).toContainText(/Son rapor: \d/, { timeout: 15_000 });
    const notes = await (await cafe.request.get('/api/staff/notifications')).json() as { items: { title: string; text: string }[] };
    expect(notes.items.some(n => n.title === 'Yeni cihaz bağlandı' && n.text.startsWith('Yeni cihaz bağlandı: Ahmet’in telefonu.'))).toBe(true);

    // Now the laptop goes in.
    await raporlarimLogin(laptop, { code: await code(), name: 'Ev laptopu' });
    await expect(laptop.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });
    await expect(list).toContainText('Ev laptopu', { timeout: 15_000 });
    await expect(list.getByRole('listitem').filter({ hasText: 'Ev laptopu' })).toContainText('Bilgisayar ·');

    // The café computer is off (Merkez answers "offline"): the phone opens the encrypted snapshot left at Mola Merkez.
    await phone.route('**/api/merkez/v1/phone/live', route => route.fulfill({ json: { offline: true, seenAt: new Date().toISOString(), waiting: true } }));
    let boxes = 0; phone.on('response', r => { if (r.url().endsWith('/phone/postbox') && r.status() === 200) boxes++; });
    await phone.getByRole('button', { name: 'Yenile' }).click();
    await expect(phone.getByText(/^Kafe bilgisayarı kapalı · Son durum \d\d:\d\d$/)).toBeVisible({ timeout: 15_000 });
    expect(boxes).toBeGreaterThan(0);
    // The last state, labelled so (never "Bugün" for a snapshot).
    await expect(phone.getByRole('region', { name: 'Bugünün satışı' })).toContainText('Son durum ·');
    await phone.screenshot({ path: info.outputPath('telefon-kafe-kapali.png'), fullPage: true });
    // Opened again later: still signed in (IndexedDB), live again.
    await phone.unroute('**/api/merkez/v1/phone/live');
    await phone.goto(address);
    await expect(phone.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByText('Giriş yapıldı ✓')).toHaveCount(0);

    // "Çıkış" on the laptop (a shared laptop cleaned): the sign-in again, and the café drops it.
    await laptop.getByRole('button', { name: 'Çıkış', exact: true }).click();
    await laptop.getByRole('group', { name: 'Çıkış' }).getByRole('button', { name: 'Evet, çıkış yap' }).click();
    await expect(laptop.getByRole('form', { name: 'Giriş yap' })).toBeVisible();
    await expect(laptop.getByRole('form', { name: 'Giriş yap' }).getByRole('status')).toHaveText('Çıkış yapıldı. Bu cihaz unutuldu.');
    await expect(list.getByRole('listitem').filter({ hasText: 'Ev laptopu' })).toHaveCount(0, { timeout: 15_000 });

    // The owner removes the phone on the café computer ("Kaldır" asks the password, not the code): back to the sign-in.
    await devicesCard.getByRole('button', { name: 'Ahmet’in telefonu cihazını kaldır' }).click();
    await devicesCard.getByRole('form', { name: 'Ahmet’in telefonu cihazını kaldır' }).getByLabel('Şifreniz').fill(PASSWORD);
    await devicesCard.getByRole('button', { name: 'Evet, kaldır' }).click();
    await expect(devicesCard.getByText('Henüz eşleşmiş cihaz yok.')).toBeVisible();
    await expect(async () => {
      await phone.getByRole('button', { name: 'Yenile' }).click({ timeout: 2000 }).catch(() => {});
      await expect(phone.getByRole('form', { name: 'Giriş yap' })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await expect(phone.getByRole('form', { name: 'Giriş yap' }).getByRole('status')).toHaveText('Bu cihazın bağlantısı kaldırıldı. Yeniden giriş yapabilirsiniz.');
  } finally {
    // The owner's phone code off again (with a recovery code), for the suites after this one.
    if (recovery) await cafe.request.post('/api/staff/report-security/recover', { data: { password: PASSWORD, recoveryCode: recovery } });
    await mail.close(); await laptopContext.close(); await phoneContext.close(); await cafe.close();
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
  await expect(page.getByRole('heading', { name: '1 · Telefon kodu' })).toHaveCount(0);
});
