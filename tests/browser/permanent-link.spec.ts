import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, devices, type Browser, type BrowserContextOptions } from '@playwright/test';
import { merkezPair } from '../merkez-fixture';
import { codesOf, e2eRun, ensureSetup, openSettings } from './helpers';

// Kalıcı bağlantı (src/PermanentLink.tsx): the business's permanent Merkez link to the café computer, in the desktop window's
// Cihaz bağla and in Ayarlar → Cihazlar → Cihaz bağla, with "Bu cihaza kısayol ekle" off the café computer (Mola Merkez's
// /k/<kod>/kur, server/merkez/lan-link.ts). It is for the café only (0.1.22): Ayarlar → Uzaktan erişim gives the Raporlarım
// address to sign in with instead. The test café has no Merkez link of its own, so the answers are given here; the last
// test asks a Mola Merkez of its own for the real page.
const URL = 'https://merkez.example.com/k/Ab3dEf7hJk';
const LINE = 'Laptop ve telefonlar için: modem adresi değiştirse de çalışır. İşletmenin Wi-Fi\'sinde kasa bilgisayarını açar.';
const PASSWORD = 'MolaDemo!2026';

test('Cihaz bağla (desktop window): the permanent link with Kopyala under the QR, no shortcut on the café computer; "birkaç dakika içinde" while it is on its way', async ({ page }) => {
  const key = readFileSync(join(e2eRun(), 'masaustu.anahtar'), 'utf8').trim();
  await page.addInitScript(() => { sessionStorage.setItem('mola-welcome', '1'); sessionStorage.setItem('mola-recovery-later', '1'); });
  let link: unknown = { url: URL };
  await page.route('**/api/desktop/status', route => route.fulfill({ json: { ok: true, lan: true, addresses: [{ name: 'Ethernet', origin: 'http://192.168.1.20:3000' }], backup: { enabled: false }, link } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/#masaustu=${key}`);
  const open = async () => { await page.getByRole('navigation', { name: 'Mola bilgisayar araçları' }).getByRole('button', { name: /Cihaz bağla/ }).click(); return page.getByRole('dialog', { name: 'Cihaz bağla' }); };
  let dialog = await open();
  const block = dialog.getByTestId('permanent-link');
  await expect(block).toContainText('Kalıcı bağlantı');
  await expect(block.locator('code')).toHaveText(URL);
  await expect(block).toContainText(LINE);
  await block.getByRole('button', { name: 'Kopyala' }).click();
  await expect(block.getByRole('button', { name: 'Kopyalandı' })).toBeVisible();
  await expect(block.getByRole('link', { name: 'Bu cihaza kısayol ekle' })).toHaveCount(0);
  await expect(dialog.locator('.desktop-address')).toContainText('192.168.1.20:3000/uygulama');
  // The palette's own surfaces (dark themes included), never a fixed white.
  expect(await block.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await page.evaluate(() => { const p = document.createElement('div'); p.style.background = 'var(--paper)'; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; }));
  await page.keyboard.press('Escape');
  // Not there yet (the next heartbeat brings it): a quiet line, no Kopyala.
  link = { problem: 'waiting' };
  await page.reload();
  dialog = await open();
  await expect(dialog.getByTestId('permanent-link')).toHaveText('Kalıcı bağlantı birkaç dakika içinde hazır olur.');
  await expect(dialog.getByRole('button', { name: 'Kopyala' })).toHaveCount(0);
});

test('Ayarlar → Cihazlar → Cihaz bağla: the permanent link with Kopyala and the way to Uzaktan erişim; nothing when Mola is closed to the network', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  let body: Record<string, unknown> = { lan: true, addresses: [{ name: 'Wi-Fi', origin: 'http://192.168.1.20:3000' }], link: { url: URL } };
  await page.route('**/api/staff/network', route => route.fulfill({ json: body }));
  await page.goto('/');
  await openSettings(page, 'Cihaz bağla');
  const card = page.locator('.connect-tablet'), block = card.getByTestId('permanent-link');
  await expect(card.getByRole('heading', { name: 'Cihaz bağla', exact: true })).toBeVisible();
  await expect(block.locator('code')).toHaveText(URL);
  await expect(block).toContainText(LINE);
  await block.getByRole('button', { name: 'Kopyala' }).click();
  await expect(block.getByRole('button', { name: 'Kopyalandı' })).toBeVisible();
  await expect(card.locator('.connect-tablet-address code')).toHaveText('192.168.1.20:3000/uygulama');
  await card.getByRole('button', { name: /Ayarlar → Uzaktan erişim/ }).click();
  await expect(page.getByRole('heading', { name: '1 · Telefon kodu' })).toBeVisible();
  body = { lan: false, addresses: [], link: { problem: 'off' } };
  await page.reload();
  await openSettings(page, 'Cihaz bağla');
  await expect(page.locator('.connect-tablet')).toContainText('Mola şu anda yalnız bu bilgisayara açık');
  await expect(page.getByTestId('permanent-link')).toHaveCount(0);
});

// A laptop or a phone on the café's Wi-Fi, which opened Mola through the permanent link: the page is http://<LAN address>,
// not loopback. laptop.localhost stands for it (scripts/test-server.mjs lets the café server answer that name).
const LAPTOP = `http://laptop.localhost:${process.env.E2E_PORT ?? '3100'}`;
async function onWifi(browser: Browser, options: BrowserContextOptions = { viewport: { width: 1280, height: 900 } }) {
  const context = await browser.newContext({ ...options, baseURL: LAPTOP });
  await context.addInitScript(() => { try { localStorage.setItem('mola-campaign-ended', 'off'); sessionStorage.setItem('mola-welcome', '1'); sessionStorage.setItem('mola-recovery-later', '1'); } catch { /* not this page */ } });
  const page = await context.newPage();
  await page.goto('/');
  // Signed in from this page (the browser resolves laptop.localhost; the cookie belongs to that name).
  expect(await page.evaluate(async password => (await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'isletme', password }) })).ok, PASSWORD)).toBe(true);
  await page.reload();
  return page;
}

test('a laptop on the permanent link: "Bu cihaza kısayol ekle" opens Mola Merkez\'s page for it (no file is downloaded)', async ({ browser, page: cafe }, info) => {
  await cafe.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(cafe.request);
  const page = await onWifi(browser);
  let downloads = 0; page.on('download', () => downloads++);
  try {
    await page.route('**/api/staff/network', route => route.fulfill({ json: { lan: true, addresses: [{ name: 'Wi-Fi', origin: 'http://192.168.1.20:3000' }], link: { url: URL } } }));
    await openSettings(page, 'Cihaz bağla');
    const block = page.locator('.connect-tablet').getByTestId('permanent-link');
    const add = block.getByRole('link', { name: 'Bu cihaza kısayol ekle' });
    await expect(add).toHaveAttribute('href', `${URL}/kur`); await expect(add).toHaveAttribute('target', '_blank');
    await block.screenshot({ path: info.outputPath('laptop-kisayol.png') });
    // Uzaktan erişim has no shortcut any more (0.1.22): away from the café the owner signs in to Raporlarım.
    await openSettings(page, 'Uzaktan erişim');
    await expect(page.getByRole('heading', { name: '3 · Cihazlarınızı bağlayın' })).toBeVisible();
    await expect(page.locator('.remote-access').getByRole('link', { name: 'Bu cihaza kısayol ekle' })).toHaveCount(0);
    expect(downloads).toBe(0);
  } finally { await page.context().close(); }
  // The café computer itself (127.0.0.1) has no shortcut button: Mola is already on its desktop.
  await cafe.route('**/api/staff/network', route => route.fulfill({ json: { lan: true, addresses: [{ name: 'Wi-Fi', origin: 'http://192.168.1.20:3000' }], link: { url: URL } } }));
  await cafe.goto('/');
  await openSettings(cafe, 'Cihaz bağla');
  await expect(cafe.getByTestId('permanent-link').locator('code')).toHaveText(URL);
  await expect(cafe.getByRole('link', { name: 'Bu cihaza kısayol ekle' })).toHaveCount(0);
  await openSettings(cafe, 'Uzaktan erişim');
  await expect(cafe.locator('.remote-access')).toContainText('Telefonunuzda ve laptopunuzda bu adresi açın');
});

test('Uzaktan erişim on the café Wi-Fi: on a phone the phone code opens the authenticator app (and its key); on a laptop its QR; nothing to pair', async ({ browser, page: cafe }, info) => {
  test.setTimeout(180_000);
  await cafe.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(cafe.request);
  const phone = await onWifi(browser, { ...devices['iPhone 13'] }), laptop = await onWifi(browser);
  let recovery = '';
  try {
    // No question about which device this is (0.1.22): the laptop's phone code shows its QR.
    await openSettings(laptop, 'Uzaktan erişim');
    await expect(laptop.getByText('Bu ekranı şu an telefonunuzdan mı açtınız?')).toHaveCount(0);
    const laptopStep1 = laptop.locator('section.settings-card', { has: laptop.getByRole('heading', { name: '1 · Telefon kodu' }) });
    await laptopStep1.getByLabel('Şifreniz').fill(PASSWORD);
    await laptopStep1.getByRole('button', { name: 'Telefon kodunu kur' }).click();
    await expect(laptopStep1.getByRole('img', { name: 'Doğrulama uygulaması kurulum QR kodu' })).toBeVisible();
    // On the phone: the phone code set up right here, with the authenticator app's own link.
    await openSettings(phone, 'Uzaktan erişim');
    const step1 = phone.locator('section.settings-card', { has: phone.getByRole('heading', { name: '1 · Telefon kodu' }) });
    await step1.getByLabel('Şifreniz').fill(PASSWORD);
    await step1.getByRole('button', { name: 'Telefon kodunu kur' }).click();
    // The authenticator app opens from the otpauth:// link; the setup key with Kopyala when it does not.
    await expect(step1.getByRole('link', { name: 'Doğrulama uygulamasını aç' })).toHaveAttribute('href', /^otpauth:\/\/totp\//);
    const code = codesOf((await step1.locator('.remote-key code').innerText()).trim());
    await step1.locator('.remote-key').getByRole('button', { name: 'Kopyala' }).click();
    await expect(step1.locator('.remote-key').getByRole('button', { name: 'Kopyalandı' })).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await phone.screenshot({ path: info.outputPath('telefon-kod-kurulumu.png'), fullPage: true });
    await step1.getByLabel('Uygulamadaki 6 haneli kod').fill(await code());
    await step1.getByRole('button', { name: 'Kodu onayla' }).click();
    recovery = (await step1.getByRole('textbox', { name: 'Kurtarma kodları' }).inputValue()).split('\n')[0];
    await step1.getByRole('button', { name: 'Kodları sakladım' }).click();
    await expect(step1).toContainText('Telefon kodu kurulu.');
    // Then the address to sign in with (no pairing button anywhere on this page).
    await expect(phone.locator('section.settings-card', { has: phone.getByRole('heading', { name: '3 · Cihazlarınızı bağlayın' }) }).locator('.remote-address-text')).toHaveText(/\/raporlarim$/);
    await expect(phone.getByRole('button', { name: /eşleştir/i })).toHaveCount(0);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await phone.screenshot({ path: info.outputPath('telefon-uzaktan-erisim.png'), fullPage: true });
  } finally {
    if (recovery) await cafe.request.post('/api/staff/report-security/recover', { data: { password: PASSWORD, recoveryCode: recovery } });
    await phone.context().close(); await laptop.context().close();
  }
});

test('"Mola\'yı bu cihaza ekle" (/k/<kod>/kur): Chrome gets the web app (manifest, a worker that keeps nothing) and the button; an iPhone the two Safari steps', async ({ browser }, info) => {
  test.setTimeout(90_000);
  // A Mola Merkez of its own with a café that serves its network, so the business has its permanent code.
  const pair = await merkezPair('kur-sayfasi', { demo: true }); await pair.importDemo();
  pair.link.reporter = { ...pair.link.reporter, lan: () => ['http://192.168.1.104:3000'] };
  await pair.link.sync(); await pair.link.sync();
  const biz = pair.merkezStore.read().businesses.find(b => b.tenantId === 'mola-demo')!, base = `${pair.merkezBase}/k/${biz.lanCode}`;
  const chrome = await browser.newContext(), iphone = await browser.newContext({ ...devices['iPhone 13'] });
  try {
    const page = await chrome.newPage();
    await page.goto(`${base}/kur`);
    await expect(page.getByRole('heading', { name: "Mola'yı bu cihaza ekle" })).toBeVisible();
    await expect(page.getByText(biz.name, { exact: true })).toBeVisible();
    await expect(page).toHaveTitle(`Mola · ${biz.name}`);
    // The address a shortcut keeps is the permanent link itself, not this page.
    await expect(page).toHaveURL(`${base}/`);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', `/k/${biz.lanCode}/manifest.webmanifest`);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toBe(`${base}/`);
    // (The page itself may fetch nothing: its CSP allows the manifest and the worker only.)
    const manifest = await (await page.request.get(`${base}/manifest.webmanifest`)).json();
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true); expect(manifest.short_name).toBe('Mola');
    // No install prompt under test: the button says the browser's own way.
    await page.getByRole('button', { name: "Mola'yı bu cihaza ekle" }).click();
    await expect(page.getByText('Adres çubuğundaki')).toBeVisible();
    await page.screenshot({ path: info.outputPath('kur-chrome.png'), fullPage: true });
    // iPhone: no web app (its storage would not be Safari's, where the pairing is): Paylaş → Ana Ekrana Ekle, the switch off.
    const phone = await iphone.newPage();
    await phone.goto(`${base}/kur`);
    await expect(phone.getByRole('button', { name: "Mola'yı bu cihaza ekle" })).toBeHidden();
    await expect(phone.getByRole('listitem')).toHaveText([/Paylaş/, /Ana Ekrana Ekle.*Web Uygulaması olarak aç.*kapatın/]);
    await expect(phone.getByText('Simge Safari’de açılır')).toBeVisible();
    await expect(phone.locator('link[rel="manifest"]')).toHaveCount(0);
    await expect(phone).toHaveURL(`${base}/`);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await phone.screenshot({ path: info.outputPath('kur-iphone.png'), fullPage: true });
  } finally { await chrome.close(); await iphone.close(); await pair.close(); }
});
