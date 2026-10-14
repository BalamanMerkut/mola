import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Browser } from '@playwright/test';
import { e2eRun, ensureSetup, openSettings, phoneCodeOn } from './helpers';

// Kalıcı bağlantı (src/PermanentLink.tsx): the business's permanent Merkez link to the café computer, in the desktop window's
// Tabletler and in Ayarlar → Cihazlar. The test server has no Merkez link, so the answers are given here.
const URL = 'https://merkez.example.com/k/Ab3dEf7hJk';
const LINE = 'Laptop ve telefonlar için: modem adresi değiştirse de çalışır. İşletmenin Wi-Fi\'sinde kasa bilgisayarını açar.';

test('Tabletler: the permanent link with Kopyala under the QR; "birkaç dakika içinde" while it is on its way', async ({ page }) => {
  const key = readFileSync(join(e2eRun(), 'masaustu.anahtar'), 'utf8').trim();
  await page.addInitScript(() => { sessionStorage.setItem('mola-welcome', '1'); sessionStorage.setItem('mola-recovery-later', '1'); });
  let link: unknown = { url: URL };
  await page.route('**/api/desktop/status', route => route.fulfill({ json: { ok: true, lan: true, addresses: [{ name: 'Ethernet', origin: 'http://192.168.1.20:3000' }], backup: { enabled: false }, link } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/#masaustu=${key}`);
  const open = async () => { await page.getByRole('navigation', { name: 'Mola bilgisayar araçları' }).getByRole('button', { name: /Tabletler/ }).click(); return page.getByRole('dialog', { name: 'Tabletler' }); };
  let dialog = await open();
  const block = dialog.getByTestId('permanent-link');
  await expect(block).toContainText('Kalıcı bağlantı');
  await expect(block.locator('code')).toHaveText(URL);
  await expect(block).toContainText(LINE);
  await block.getByRole('button', { name: 'Kopyala' }).click();
  await expect(block.getByRole('button', { name: 'Kopyalandı' })).toBeVisible();
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

test('Ayarlar → Cihazlar: the owner sees the permanent link with Kopyala; nothing when Mola is closed to the network', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  let body: Record<string, unknown> = { lan: true, addresses: [{ name: 'Wi-Fi', origin: 'http://192.168.1.20:3000' }], link: { url: URL } };
  await page.route('**/api/staff/network', route => route.fulfill({ json: body }));
  await page.goto('/');
  await openSettings(page, 'Cihazlar');
  const card = page.locator('.connect-tablet'), block = card.getByTestId('permanent-link');
  await expect(block.locator('code')).toHaveText(URL);
  await expect(block).toContainText(LINE);
  await block.getByRole('button', { name: 'Kopyala' }).click();
  await expect(block.getByRole('button', { name: 'Kopyalandı' })).toBeVisible();
  await expect(card.locator('.connect-tablet-address code')).toHaveText('192.168.1.20:3000/uygulama');
  body = { lan: false, addresses: [], link: { problem: 'off' } };
  await page.reload();
  await openSettings(page, 'Cihazlar');
  await expect(page.locator('.connect-tablet')).toContainText('Mola şu anda yalnız bu bilgisayara açık');
  await expect(page.getByTestId('permanent-link')).toHaveCount(0);
});

// A laptop on the café's Wi-Fi, which opened Mola through the permanent link: the page is http://<LAN address>, not loopback.
// laptop.localhost stands for it (scripts/test-server.mjs lets the café server answer that name).
const LAPTOP = `http://laptop.localhost:${process.env.E2E_PORT ?? '3100'}`;
async function laptopPage(browser: Browser) {
  const context = await browser.newContext({ baseURL: LAPTOP, acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => { try { localStorage.setItem('mola-campaign-ended', 'off'); sessionStorage.setItem('mola-welcome', '1'); sessionStorage.setItem('mola-recovery-later', '1'); } catch { /* not this page */ } });
  const page = await context.newPage();
  await page.goto('/');
  // Signed in from this page (the browser resolves laptop.localhost; the cookie belongs to that name).
  expect(await page.evaluate(async password => (await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'isletme', password }) })).ok, 'MolaDemo!2026')).toBe(true);
  await page.reload();
  return page;
}

test('a laptop on the permanent link: "Masaüstüne kısayol" saves a .url to the permanent link (not the LAN address)', async ({ browser, page: cafe }, info) => {
  await cafe.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(cafe.request);
  const name = (await (await cafe.request.get('/api/staff/state')).json()).name as string;
  const page = await laptopPage(browser);
  // The name the page gives the file (Chrome under test renames a .url download it holds back as possibly unsafe).
  await page.evaluate(() => { const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { (window as unknown as { saved?: string }).saved = this.download; click.call(this); }; });
  try {
    await page.route('**/api/staff/network', route => route.fulfill({ json: { lan: true, addresses: [{ name: 'Wi-Fi', origin: 'http://192.168.1.20:3000' }], link: { url: URL } } }));
    await openSettings(page, 'Cihazlar');
    const block = page.locator('.connect-tablet').getByTestId('permanent-link');
    await expect(block).toContainText('Bu bilgisayarın masaüstüne Mola kısayolu koyar; modem adresi değişse de açılır.');
    await block.screenshot({ path: info.outputPath('laptop-kisayol.png') });
    const [download] = await Promise.all([page.waitForEvent('download'), block.getByRole('button', { name: 'Masaüstüne kısayol' }).click()]);
    expect(await page.evaluate(() => (window as unknown as { saved?: string }).saved)).toBe(`Mola - ${name.replace(/[\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}.url`);
    expect(readFileSync(await download.path(), 'utf8')).toBe(`[InternetShortcut]\r\nURL=${URL}\r\n`);
  } finally { await page.context().close(); }
  // The café computer itself (127.0.0.1) has no shortcut button: Mola is already on its desktop.
  await cafe.route('**/api/staff/network', route => route.fulfill({ json: { lan: true, addresses: [{ name: 'Wi-Fi', origin: 'http://192.168.1.20:3000' }], link: { url: URL } } }));
  await cafe.goto('/');
  await openSettings(cafe, 'Cihazlar');
  await expect(cafe.getByTestId('permanent-link').locator('code')).toHaveText(URL);
  await expect(cafe.getByRole('button', { name: 'Masaüstüne kısayol' })).toHaveCount(0);
});

test('a laptop on the permanent link: "Bu cihazı eşleştir" pairs this very browser for Raporlarım', async ({ browser, page: cafe }, info) => {
  test.setTimeout(120_000);
  // Pairing needs the owner's phone code (set up over the API from this computer; the code belongs to the owner). After the
  // laptop signed in: with the code on, signing in asks it too.
  const page = await laptopPage(browser);
  await cafe.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  const phoneCode = await phoneCodeOn(cafe.request);
  try {
    await openSettings(page, 'Telefonum');
    const card = page.locator('.phone-pairing');
    await card.getByRole('button', { name: 'Telefonu eşleştir' }).click();
    const ask = card.getByRole('form', { name: 'Cihaz eşleştir' });
    await ask.getByLabel('Cihazın adı').fill('Ev laptopu (test)');
    await ask.getByLabel('Şifreniz').fill('MolaDemo!2026');
    await ask.getByLabel('Telefon kodu').fill(await phoneCode.code());
    const [paired] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/staff/remote-reports/pair') && r.request().method() === 'POST'), ask.getByRole('button', { name: 'QR kodu göster' }).click()]);
    const { url } = await paired.json() as { url: string };
    const panel = card.getByRole('group', { name: 'Cihaz eşleştirme QR kodu' });
    await expect(panel.getByRole('heading', { name: 'Telefonla: kodu okutun' })).toBeVisible();
    const here = panel.getByRole('link', { name: 'Bu cihazı eşleştir' });
    await expect(here).toHaveAttribute('href', url);
    await expect(here).toHaveAttribute('target', '_blank');
    // The link stays out of sight; the copy button carries it.
    await expect(panel.getByRole('button', { name: 'Bağlantıyı kopyala' })).toHaveAttribute('title', url);
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    await card.screenshot({ path: info.outputPath('laptop-bu-cihazi-eslestir.png') });
    // Opened here, in a new tab of this same browser: Raporlarım pairs this laptop, and the café page sees it.
    const [tab] = await Promise.all([page.context().waitForEvent('page'), here.click()]);
    await tab.getByRole('button', { name: 'Eşleştir', exact: true }).click();
    await expect(tab.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText('Ev laptopu (test)').first()).toBeVisible({ timeout: 15_000 });
    // Leave the owner's device list as it was (at most 3 devices).
    await card.getByRole('button', { name: 'Ev laptopu (test) cihazını kaldır' }).click();
    await card.getByRole('form', { name: 'Ev laptopu (test) cihazını kaldır' }).getByLabel('Şifreniz').fill('MolaDemo!2026');
    await card.getByRole('button', { name: 'Evet, kaldır' }).click();
    await expect(card.getByRole('button', { name: 'Ev laptopu (test) cihazını kaldır' })).toHaveCount(0);
  } finally { await phoneCode.off(); await page.context().close(); }
});
