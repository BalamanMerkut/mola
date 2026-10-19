import { test, expect, devices, type Page } from '@playwright/test';
import { codesOf, ensureSetup, MERKEZ, merkezMail, openSettings, OWNER_EMAIL, raporlarimCode, raporlarimPassword, remoteLoginOpen } from './helpers';

/*
 * İşletmemi yönet (0.1.23, /yonet on Mola Merkez; src/ReportsPhone.tsx, server/remote-reports.ts): one website sign-in. The café
 * computer's Ayarlar → Uzaktan erişim (src/RemoteAccess.tsx) has exactly five plain cards: the phone code and the e-mail set up
 * on screen, then the address. A device that is not signed in opens that address (typed with Turkish letters too) and sees
 * "Giriş yap": the e-mail and the password ("Devam", checked by the café computer at once), then the phone code. Any device
 * may be first (no phone-first rule); it names itself ("Windows laptop · 15 Ekim"). Then the live report; the café computer
 * off (the köprü stopped, POST /api/test/relay) shows the last encrypted report with "Kasa bilgisayarı kapalı ya da internete bağlı değil · Son durum …",
 * also after a reload; back on, live again. "Çıkış" (0.1.24) locks the laptop and keeps it: with the café off the e-mail and
 * the password open the last report (checked on the laptop, no code); with it on, the café checks them and asks the code.
 * "Bu cihazı tamamen kaldır" forgets it and the café drops it; the owner's "Kaldır" sends the phone back to the sign-in.
 */
const PASSWORD = 'MolaDemo!2026';
const today = () => new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long' });
const wide = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('Uzaktan erişim → five plain cards; İşletmemi yönet: any device first, two-step sign-in, live report, café off → last report, "Çıkış", removal', async ({ browser }, info) => {
  test.setTimeout(360_000);
  const cafe = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const phoneContext = await browser.newContext({ ...devices['iPhone 13'] });
  const laptopContext = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const mail = await merkezMail();
  let recovery = '';
  const relay = (on: boolean) => cafe.request.post('/api/test/relay', { data: { on } });
  try {
    expect((await cafe.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
    await ensureSetup(cafe.request);
    const state = await (await cafe.request.get('/api/staff/state')).json();
    // Right after the servers start the café has not heard Merkez's `accepts` yet (its first heartbeat brings them).
    await expect.poll(async () => (await (await cafe.request.get('/api/staff/owner-email')).json() as { available?: boolean }).available, { timeout: 30_000 }).toBe(true);
    const owner = await cafe.newPage(); await owner.goto('/');
    await openSettings(owner, 'Uzaktan erişim');
    const page = owner.locator('.remote-access'), card = (name: string) => page.locator('section.settings-card', { has: owner.getByRole('heading', { name }) });
    // Exactly five numbered cards, in this order, nothing else on the page.
    await expect(page.locator('section.settings-card h3')).toHaveText(['1 · Telefon kodu', '2 · E-posta', '3 · Cihaz eşleştirme', '4 · Eşleşmiş cihazlar', '5 · Uzaktan yönetim']);
    const step1 = card('1 · Telefon kodu'), step2 = card('2 · E-posta'), step3 = card('3 · Cihaz eşleştirme'), devicesCard = card('4 · Eşleşmiş cihazlar');
    await expect(page.locator(':scope > .notice')).toHaveCount(0);
    await expect(page).not.toContainText('Önce telefon');
    // Nothing to pair here: no question, no pairing QR, no shortcut; card 3 waits for 1 and 2.
    await expect(owner.getByRole('img', { name: 'Cihaz eşleştirme QR kodu' })).toHaveCount(0);
    await expect(owner.getByRole('link', { name: 'Bu cihaza kısayol ekle' })).toHaveCount(0);
    await expect(step3).toContainText('Önce 1 ve 2\'yi tamamlayın.');
    await expect(devicesCard).toContainText('Henüz cihaz yok.');
    // 1: the phone code: the password, the authenticator's QR, its code; the recovery codes once; then one line.
    await step1.getByLabel('Şifreniz').fill(PASSWORD);
    await step1.getByRole('button', { name: 'Telefon kodunu kur' }).click();
    await expect(step1.getByRole('img', { name: 'Doğrulama uygulaması kurulum QR kodu' })).toBeVisible();
    await step1.getByText('QR okutamıyorum').click();
    const code = codesOf((await step1.locator('details code').innerText()).trim());
    await step1.getByLabel('Uygulamadaki 6 haneli kod').fill(await code());
    // 19 Ekim: the page's 8 s refresh soon knows the code is set up; the one-time codes still stay until "Kodları sakladım".
    const refreshed = owner.waitForResponse(async r => new URL(r.url()).pathname === '/api/staff/remote-reports' && r.request().method() === 'GET' && (await r.json() as { code?: boolean }).code === true, { timeout: 20_000 });
    await step1.getByRole('button', { name: 'Kodu onayla' }).click();
    const recoveryBox = step1.getByRole('textbox', { name: 'Kurtarma kodları' });
    await expect(recoveryBox).toBeVisible();
    await refreshed; await owner.waitForTimeout(500);
    await expect(recoveryBox).toBeVisible();
    await expect(step1.getByText('Kurulu ✓')).toHaveCount(0);
    recovery = (await recoveryBox.inputValue()).split('\n')[0];
    await step1.getByRole('button', { name: 'Kodları sakladım' }).click();
    await expect(step1.getByRole('status')).toHaveText('Kurulu ✓');
    // 2: the e-mail, verified with the code sent to it (Mola Merkez keeps it).
    const email = step2.getByRole('form', { name: 'E-postanızı doğrulayın' });
    await email.getByLabel('E-posta').fill(OWNER_EMAIL);
    await email.getByLabel('Şifreniz').fill(PASSWORD);
    await email.getByRole('button', { name: 'Kod gönder' }).click();
    const verify = step2.getByRole('form', { name: 'E-postayı doğrula' });
    await verify.getByLabel('E-postadaki kod').fill(await mail.lastCode(OWNER_EMAIL));
    // 19 Ekim: between "Doğrula" and "✓" the empty e-mail form never shows (the reloaded e-mail is slowed down here).
    await owner.route('**/api/staff/owner-email', async route => { await new Promise(r => setTimeout(r, 1500)); await route.continue(); });
    await owner.evaluate(() => { const w = window as unknown as { __emptyEmail: boolean }; w.__emptyEmail = false; new MutationObserver(() => { if (document.querySelector('form[aria-label="E-postanızı doğrulayın"]')) w.__emptyEmail = true; }).observe(document.body, { subtree: true, childList: true }); });
    await verify.getByRole('button', { name: 'Doğrula' }).click();
    await expect(step2.getByRole('status')).toHaveText(/^s\S*@ornekkafe\.com ✓$/);
    expect(await owner.evaluate(() => (window as unknown as { __emptyEmail: boolean }).__emptyEmail)).toBe(false);
    await owner.unroute('**/api/staff/owner-email');
    // 3: the plain address in big letters, Kopyala, its small QR; nothing else.
    const address = `${MERKEZ}/yonet`;
    await expect(step3.locator('.remote-address-text')).toHaveText(address.replace(/^https?:\/\//, ''));
    await expect(step3.getByRole('img', { name: 'İşletmemi yönet adresinin QR kodu' })).toBeVisible();
    await step3.getByRole('button', { name: 'Kopyala' }).click();
    await owner.screenshot({ path: info.outputPath('sahip-uzaktan-erisim.png'), fullPage: true });
    await remoteLoginOpen();

    // The laptop first (0.1.23: no phone-first rule), the old address typed with a Turkish letter: İşletmemi yönet's sign-in.
    const laptop = await laptopContext.newPage();
    await laptop.goto(`${MERKEZ}/raporlarım#e=${'A'.repeat(22)}`);
    await expect(laptop).toHaveURL(`${MERKEZ}/yonet`);
    await expect(laptop).toHaveTitle('İşletmemi yönet · Mola');
    const loginForm = laptop.getByRole('form', { name: 'Giriş yap' });
    await expect(loginForm).toBeVisible();
    await expect(loginForm.getByLabel('Bu cihazın adı')).toHaveCount(0);
    await expect(loginForm.getByLabel('Telefon kodu')).toHaveCount(0);
    await laptop.screenshot({ path: info.outputPath('laptop-1-giris.png'), fullPage: true });
    // A wrong password is said on the first screen.
    await raporlarimPassword(laptop, { password: 'yanlis-sifre' });
    await expect(loginForm.getByRole('alert')).toHaveText('E-posta ya da şifre hatalı.');
    // The right one: the code screen (numeric keyboard, focused); a wrong code stays there with its own words.
    await raporlarimPassword(laptop);
    const codeForm = laptop.getByRole('form', { name: 'Telefon kodu' });
    await expect(codeForm.getByLabel('Telefon kodu')).toBeFocused();
    await expect(codeForm.getByLabel('Telefon kodu')).toHaveAttribute('inputmode', 'numeric');
    await expect(codeForm.getByLabel('Telefon kodu')).toHaveAttribute('autocomplete', 'one-time-code');
    await laptop.screenshot({ path: info.outputPath('laptop-2-kod.png'), fullPage: true });
    await raporlarimCode(laptop, '000000');
    await expect(codeForm.getByRole('alert')).toHaveText('Telefon kodu yanlış. Doğrulama uygulamasındaki güncel kodu yazın.');
    await raporlarimCode(laptop, code);
    await expect(laptop.getByRole('status').filter({ hasText: 'Giriş yapıldı ✓' })).toHaveText(`Giriş yapıldı ✓ · ${state.name}`);
    await expect(laptop.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });
    await expect(laptop.getByRole('region', { name: 'Bugünün satışı' })).toContainText('Bugün ·');
    // Uzaktan yönetim is in the demo package but off: a quiet line says where it is turned on, no button.
    await expect(laptop.getByText('İşletmeyi yönet kapalı · kasada Ayarlar → Uzaktan erişim → Uzaktan yönetim’den açılır.')).toBeVisible();
    await expect(laptop.getByRole('button', { name: /^İşletmeyi yönet/ })).toHaveCount(0);
    expect(await wide(laptop)).toBe(true);
    await laptop.screenshot({ path: info.outputPath('laptop-3-rapor.png'), fullPage: true });
    // The café computer lists it, named by itself, as a computer; the owner was told.
    const list = devicesCard.getByRole('list', { name: 'Eşleşmiş cihazlar' });
    await expect(list).toContainText(`Windows laptop · ${today()}`, { timeout: 15_000 });
    await expect(list).toContainText('Bilgisayar ·');
    const notes = await (await cafe.request.get('/api/staff/notifications')).json() as { items: { title: string; text: string }[] };
    expect(notes.items.some(n => n.title === 'Yeni cihaz bağlandı' && n.text.startsWith(`Yeni cihaz bağlandı: Windows laptop · ${today()}.`))).toBe(true);

    // The phone goes in too.
    const phone = await phoneContext.newPage();
    await phone.goto(address);
    await expect(phone.getByRole('form', { name: 'Giriş yap' })).toBeVisible();
    expect(await wide(phone)).toBe(true);
    await phone.screenshot({ path: info.outputPath('telefon-1-giris.png'), fullPage: true });
    await raporlarimPassword(phone);
    await expect(phone.getByRole('form', { name: 'Telefon kodu' })).toBeVisible();
    await phone.screenshot({ path: info.outputPath('telefon-2-kod.png'), fullPage: true });
    await raporlarimCode(phone, code);
    await expect(phone.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByRole('region', { name: 'Son 30 gün' })).toBeVisible();
    expect(await wide(phone)).toBe(true);
    await phone.screenshot({ path: info.outputPath('telefon-3-rapor.png'), fullPage: true });
    // Dark like the device (prefers-color-scheme).
    await phone.emulateMedia({ colorScheme: 'dark' });
    await phone.screenshot({ path: info.outputPath('telefon-3-rapor-koyu.png'), fullPage: true });
    await phone.emulateMedia({ colorScheme: 'light' });
    await expect(list).toContainText(`iPhone · ${today()}`, { timeout: 15_000 });
    await expect(list).toContainText(/Son rapor: \d/, { timeout: 15_000 });

    // The café computer off (its köprü stops; Merkez calls it off a few seconds later): the last report from the postbox,
    // "Kasa bilgisayarı kapalı ya da internete bağlı değil · Son durum", and "İşletmeyi yönet: kasa açıkken".
    let boxes = 0; phone.on('response', r => { if (r.url().endsWith('/phone/postbox') && r.status() === 200) void r.json().then((b: { box?: unknown }) => { if (b.box) boxes++; }).catch(() => {}); });
    expect((await relay(false)).ok()).toBe(true);
    const offLine = phone.getByText(/^Kasa bilgisayarı kapalı ya da internete bağlı değil · Son durum \d\d:\d\d$/);
    await expect(async () => { await phone.getByRole('button', { name: 'Yenile' }).click(); await expect(offLine).toBeVisible({ timeout: 3000 }); }).toPass({ timeout: 60_000 });
    await expect(phone.getByRole('region', { name: 'Bugünün satışı' })).toContainText('Son durum ·');
    await expect(phone.getByText('İşletmeyi yönet: kasa açıkken')).toBeVisible();
    await expect.poll(() => boxes, { timeout: 10_000 }).toBeGreaterThan(0);
    await phone.screenshot({ path: info.outputPath('telefon-4-kasa-kapali.png'), fullPage: true });
    // Opened again later, still off: signed in, the full last report at once.
    await phone.reload();
    await expect(offLine).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByRole('region', { name: 'Bugünün satışı' })).toContainText('Son durum ·');
    await expect(phone.getByRole('region', { name: 'Son 30 gün' })).toBeVisible();
    await expect(phone.getByText('Giriş yapıldı ✓')).toHaveCount(0);
    // The laptop opened while the café is off: the same.
    await laptop.reload();
    await expect(laptop.getByText(/^Kasa bilgisayarı kapalı ya da internete bağlı değil · Son durum \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });
    await laptop.screenshot({ path: info.outputPath('laptop-4-kasa-kapali.png'), fullPage: true });
    // Back on: live again.
    expect((await relay(true)).ok()).toBe(true);
    await expect(async () => { await phone.getByRole('button', { name: 'Yenile' }).click(); await expect(phone.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 3000 }); }).toPass({ timeout: 60_000 });
    // Any other answer (a slow café computer, an error): never an empty card, the last report with a short reason.
    await phone.route('**/api/merkez/v1/phone/live', route => route.fulfill({ status: 504, json: { code: 'CAFE_TIMEOUT', message: 'Kasa bilgisayarı yanıt vermedi.' } }));
    await phone.getByRole('button', { name: 'Yenile' }).click();
    await expect(phone.getByText(/^Kasa bilgisayarı yanıt vermedi · Son durum \d\d:\d\d$/)).toBeVisible({ timeout: 15_000 });
    await expect(phone.getByRole('region', { name: 'Bugünün satışı' })).toContainText('Son durum ·');
    await phone.unroute('**/api/merkez/v1/phone/live');
    await phone.getByRole('button', { name: 'Yenile' }).click();
    await expect(phone.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });

    // "Çıkış" on the laptop while the café computer is off (0.1.24, the owner's case: he was locked out): the device is
    // kept; the e-mail and the password open the last report, checked on the laptop itself (no code step offline).
    expect((await relay(false)).ok()).toBe(true);
    const laptopOff = laptop.getByText(/^Kasa bilgisayarı kapalı ya da internete bağlı değil · Son durum \d\d:\d\d$/);
    await expect(async () => { await laptop.getByRole('button', { name: 'Yenile' }).click(); await expect(laptopOff).toBeVisible({ timeout: 3000 }); }).toPass({ timeout: 60_000 });
    await laptop.getByRole('button', { name: 'Çıkış', exact: true }).click();
    const leave = laptop.getByRole('group', { name: 'Çıkış' });
    await expect(leave).toContainText('Çıkış yapınca bu cihaz hatırlanır; yeniden girmek için e-posta ve şifreniz yeter.');
    await expect(leave.getByRole('button', { name: 'Bu cihazı tamamen kaldır' })).toBeVisible();
    await laptop.screenshot({ path: info.outputPath('laptop-5-cikis.png'), fullPage: true });
    await leave.getByRole('button', { name: 'Evet, çıkış yap' }).click();
    const again = laptop.getByRole('form', { name: 'Giriş yap' });
    await expect(again).toBeVisible();
    await expect(again.getByRole('status')).toHaveText('Çıkış yapıldı.');
    await expect(again).toContainText('Bu cihaz hatırlanıyor.');
    // Locked across a reload too; a wrong password is said plainly (and counted on the device).
    await laptop.reload();
    await expect(again).toBeVisible({ timeout: 30_000 });
    await raporlarimPassword(laptop, { password: 'yanlis-sifre' });
    await expect(again.getByRole('alert')).toHaveText('E-posta ya da şifre hatalı.', { timeout: 30_000 });
    await laptop.screenshot({ path: info.outputPath('laptop-6-kilitli-giris.png'), fullPage: true });
    await raporlarimPassword(laptop);
    await expect(laptopOff).toBeVisible({ timeout: 30_000 });
    await expect(laptop.getByRole('form', { name: 'Telefon kodu' })).toHaveCount(0);
    await expect(laptop.getByRole('region', { name: 'Bugünün satışı' })).toContainText('Son durum ·');
    await laptop.screenshot({ path: info.outputPath('laptop-7-kasa-kapali-giris.png'), fullPage: true });
    // The café on again: Çıkış, then the café checks the e-mail and the password, and the code is asked (the same entry).
    expect((await relay(true)).ok()).toBe(true);
    await expect(async () => { await laptop.getByRole('button', { name: 'Yenile' }).click(); await expect(laptop.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 3000 }); }).toPass({ timeout: 60_000 });
    await laptop.getByRole('button', { name: 'Çıkış', exact: true }).click();
    await leave.getByRole('button', { name: 'Evet, çıkış yap' }).click();
    await expect(again).toBeVisible();
    await raporlarimPassword(laptop);
    await raporlarimCode(laptop, code);
    await expect(laptop.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });
    await expect(list.getByRole('listitem').filter({ hasText: 'Windows laptop' })).toHaveCount(1, { timeout: 15_000 });

    // "Bu cihazı tamamen kaldır" (a shared laptop cleaned): the sign-in again, and the café drops it.
    await laptop.getByRole('button', { name: 'Çıkış', exact: true }).click();
    await leave.getByRole('button', { name: 'Bu cihazı tamamen kaldır' }).click();
    const removeIt = laptop.getByRole('group', { name: 'Bu cihazı kaldır' });
    await expect(removeIt).toContainText('Bu cihaz tamamen kaldırılsın mı?');
    await removeIt.getByRole('button', { name: 'Evet, kaldır' }).click();
    await expect(again).toBeVisible();
    await expect(again.getByRole('status')).toHaveText('Bu cihaz kaldırıldı. Yeniden giriş yapabilirsiniz.');
    await expect(again).not.toContainText('Bu cihaz hatırlanıyor.');
    await expect(list.getByRole('listitem').filter({ hasText: 'Windows laptop' })).toHaveCount(0, { timeout: 15_000 });

    // The owner removes the phone on the café computer ("Kaldır" asks the password, not the code): back to the sign-in.
    await devicesCard.getByRole('button', { name: /^iPhone · .* cihazını kaldır$/ }).click();
    await devicesCard.getByRole('form', { name: /cihazını kaldır$/ }).getByLabel('Şifreniz').fill(PASSWORD);
    await devicesCard.getByRole('button', { name: 'Evet, kaldır' }).click();
    await expect(devicesCard.getByText('Henüz cihaz yok.')).toBeVisible();
    await expect(async () => {
      await phone.getByRole('button', { name: 'Yenile' }).click({ timeout: 2000 }).catch(() => {});
      await expect(phone.getByRole('form', { name: 'Giriş yap' })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await expect(phone.getByRole('form', { name: 'Giriş yap' }).getByRole('status')).toHaveText('Bu cihazın bağlantısı kaldırıldı. Yeniden giriş yapabilirsiniz.');

    // An address nobody answers: the plain 404 page with the way to İşletmemi yönet (no Mola Yönetim).
    await phone.goto(`${MERKEZ}/raporlar-eski`);
    await expect(phone.getByRole('heading', { name: 'Bu sayfa bulunamadı.' })).toBeVisible();
    await phone.screenshot({ path: info.outputPath('telefon-404.png'), fullPage: true });
    await phone.getByRole('link', { name: 'İşletmemi yönet’e git' }).click();
    await expect(phone).toHaveURL(`${MERKEZ}/yonet`);
  } finally {
    await relay(true).catch(() => {});
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
