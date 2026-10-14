import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { e2eRun, ensureSetup, openSettings } from './helpers';

// Phones and tablets: the /uygulama install page, the web app manifest and icons, and the waiter's screen kept awake.
const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? '3100'}`;
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-T220) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function phone(browser: Browser, userAgent: string, width = 390) {
  const context = await browser.newContext({ baseURL: BASE, userAgent, viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
  return { context, page: await context.newPage() };
}

test('the install page: Android app first on Android, Safari steps first on iPhone, "Uygulamada aç" carries this café', async ({ browser, request }, info) => {
  const api = await (await request.get('/api/uygulama')).json();
  expect(api).toMatchObject({ app: 'mola', role: 'kafe' });
  {
    const { context, page } = await phone(browser, ANDROID);
    await page.goto('/uygulama');
    await expect(page.getByRole('heading', { level: 1, name: "Mola'yı telefona ve tablete kurun" })).toBeVisible();
    await expect(page).toHaveTitle('Mola · Telefona ve tablete kur');
    const cards = page.locator('.install-card h2');
    await expect(cards.first()).toHaveText('Android telefon ve tablet');
    if (api.apk) {
      const download = page.getByRole('link', { name: 'Mola uygulamasını indir' });
      await expect(download).toHaveAttribute('href', '/uygulama/Mola.apk');
      const file = await request.get('/uygulama/Mola.apk');
      expect(file.status()).toBe(200); expect(file.headers()['content-type']).toBe('application/vnd.android.package-archive');
    } else await expect(page.getByText('Android uygulaması bu kafe bilgisayarında yok.')).toBeVisible();
    await expect(page.locator('.install-steps').first().locator('li')).toHaveCount(3);
    await expect(page.getByText('Bu kaynaktan izin ver')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Uygulamada aç' })).toHaveAttribute('href', `mola://baglan?u=${encodeURIComponent(BASE)}`);
    for (const width of [360, 390, 768, 820]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await fits(page), `no sideways scroll at ${width}px`).toBe(true);
    }
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: info.outputPath('uygulama-android-360.png'), fullPage: true });
    await context.close();
  }
  {
    const { context, page } = await phone(browser, IPHONE);
    await page.goto('/uygulama');
    await expect(page.locator('.install-card h2').first()).toHaveText('iPhone ve iPad');
    const steps = page.locator('.install-steps.illustrated li');
    await expect(steps).toHaveCount(4);
    await expect(steps.locator('svg.install-picture')).toHaveCount(4);
    await expect(steps.nth(1)).toContainText("Paylaş'a dokunun.");
    await expect(steps.nth(2)).toContainText('Ana Ekrana Ekle');
    for (const width of [360, 390, 768, 820]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await fits(page), `no sideways scroll at ${width}px`).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('uygulama-iphone-390.png'), fullPage: true });
    await context.close();
  }
});

test('inside the Android app the page only says so; away from the café network it says where it works', async ({ browser }) => {
  {
    const { context, page } = await phone(browser, `${ANDROID} MolaApp/0.1.0`);
    await page.goto('/uygulama');
    await expect(page.getByText('Mola uygulamasını kullanıyorsunuz (sürüm 0.1.0).')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mola uygulamasını indir' })).toHaveCount(0);
    await expect(page.locator('.install-card')).toHaveCount(0);
    await context.close();
  }
  {
    // Through a tunnel the server answers 404 (server/mobile-app.ts); the page explains instead of offering a dead link.
    const { context, page } = await phone(browser, ANDROID);
    await page.route('**/api/uygulama', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"NOT_FOUND"}' }));
    await page.goto('/uygulama');
    await expect(page.getByText('Bu sayfa yalnız kafenin Wi-Fi ağında çalışır.', { exact: false })).toBeVisible();
    expect(await fits(page)).toBe(true);
    await context.close();
  }
});

test('web app manifest and icons for "Ana Ekrana Ekle"', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Mola', short_name: 'Mola', display: 'standalone', start_url: '/', scope: '/', theme_color: '#234c3e', background_color: '#f6f7f4' });
  const purposes = (manifest.icons as { src: string; sizes: string; purpose: string }[]).map(i => `${i.sizes} ${i.purpose}`);
  for (const wanted of ['192x192 any', '512x512 any', '192x192 maskable', '512x512 maskable']) expect(purposes).toContain(wanted);
  for (const icon of [...manifest.icons.map((i: { src: string }) => i.src), '/apple-touch-icon.png', '/favicon-32.png']) {
    const response = await request.get(icon);
    expect(response.status(), icon).toBe(200);
    expect(response.headers()['content-type'], icon).toMatch(/^image\/(png|svg\+xml)/);
  }
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Mola');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  // No service worker anywhere: orders and the API are never cached.
  expect(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0)).toBe(0);
});

test('the waiter phone keeps the screen awake and takes the lock again when Mola comes back on screen', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { requests: 0, current: null as any };
    (window as any).__wake = state;
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (kind: string) => {
      if (kind !== 'screen') throw new Error('type');
      state.requests++;
      const sentinel = new EventTarget() as any; sentinel.released = false;
      sentinel.release = async () => { if (!sentinel.released) { sentinel.released = true; sentinel.dispatchEvent(new Event('release')); } };
      state.current = sentinel; return sentinel;
    } } });
  });
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  await page.request.post('/api/login', { data: { username: 'garson', password: 'MolaDemo!2026' } });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as any).__wake.requests)).toBe(1);
  // The browser drops the lock when the page is hidden; coming back takes it again.
  await page.evaluate(() => (window as any).__wake.current.release());
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => page.evaluate(() => (window as any).__wake.requests)).toBe(2);
  expect(await page.evaluate(() => (window as any).__wake.current.released)).toBe(false);
  expect(await fits(page)).toBe(true);
});

test('Ayarlar → Cihazlar shows one QR to /uygulama; the Android app keeps the kitchen screen on by itself', async ({ page, browser }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  // As on the café computer with Wi-Fi: the tablets' address is the LAN one.
  await page.route('**/api/staff/network', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lan: true, addresses: [{ name: 'Wi-Fi', origin: 'http://192.168.1.20:3000' }] }) }));
  await page.goto('/');
  await openSettings(page, 'Cihazlar');
  const card = page.locator('.connect-tablet');
  await expect(card.getByText('Telefon ya da tabletin kamerasıyla okutun.')).toBeVisible();
  await expect(card.locator('.connect-tablet-address code')).toHaveText('192.168.1.20:3000/uygulama');
  await expect(card.getByRole('img', { name: 'Mola uygulaması kurulum sayfasının QR kodu' })).toBeVisible();
  await expect(card.getByTestId('network-profile-warning')).toHaveCount(0);
  // Windows has this connection on the "Genel" profile and Mola's firewall rule is the old one (server/network-profile.ts):
  // the owner is sent to Cihaz bağla → "İzni düzelt".
  await page.route('**/api/staff/network-profile', route => route.fulfill({ json: { checked: true, public: ['Wi-Fi'] } }));
  await page.reload();
  await openSettings(page, 'Cihazlar');
  const warning = page.locator('.connect-tablet').getByTestId('network-profile-warning');
  await expect(warning).toContainText('Telefonlar ve tabletler bu bilgisayara bağlanamıyor: ağ “Genel” olarak ayarlı, Mola\'nın güvenlik duvarı izni eski.');
  await expect(warning).toContainText('sol şeritten Cihaz bağla → İzni düzelt\'e basın');
  await expect(warning).toContainText('Ya da Windows Ayarları → Ağ ve İnternet → Wi-Fi → Ağ profili: Özel.');

  const { context, page: kitchen } = await phone(browser, `${ANDROID} MolaApp/0.1.0`, 820);
  // Plain http in the WebView: no Wake Lock API; the app's FLAG_KEEP_SCREEN_ON does the job.
  await kitchen.addInitScript(() => Object.defineProperty(navigator, 'wakeLock', { value: undefined }));
  await kitchen.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } });
  await kitchen.goto('/');
  await expect(kitchen.locator('.kitchen-awake [role=status]')).toHaveText('Mola uygulaması ekranı açık tutuyor.');
  await expect(kitchen.getByRole('button', { name: 'Ekran açık: Mola uygulaması' })).toHaveAttribute('aria-pressed', 'true');
  await expect(kitchen.locator('.kitchen-awake-note')).toHaveCount(0);
  await context.close();
});

test('Cihaz bağla in the café computer\'s window: "Genel" with the old firewall rule is said, with "İzni düzelt" as the fix (read only)', async ({ page }) => {
  const key = readFileSync(join(e2eRun(), 'masaustu.anahtar'), 'utf8').trim();
  await page.addInitScript(() => { sessionStorage.setItem('mola-welcome', '1'); sessionStorage.setItem('mola-recovery-later', '1'); });
  // As on a café computer whose Ethernet Windows calls "Genel" (this test server listens on 127.0.0.1 only).
  await page.route('**/api/desktop/status', route => route.fulfill({ json: { ok: true, lan: true, addresses: [{ name: 'Ethernet', origin: 'http://192.168.1.20:3000' }], backup: { enabled: false } } }));
  await page.route('**/api/desktop/network-profile', route => route.fulfill({ json: { checked: true, public: ['Ethernet'] } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/#masaustu=${key}`);
  await page.getByRole('navigation', { name: 'Mola bilgisayar araçları' }).getByRole('button', { name: /Cihaz bağla/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Cihaz bağla' });
  const warning = dialog.getByTestId('network-profile-warning');
  await expect(warning).toContainText('Telefonlar ve tabletler bu bilgisayara bağlanamıyor: ağ “Genel” olarak ayarlı, Mola\'nın güvenlik duvarı izni eski.');
  await expect(warning).toContainText('Aşağıdaki İzni düzelt\'e basın; Windows bir kez “Evet” diye sorar. Ağ ayarınız değişmez.');
  await expect(warning).toContainText('Ya da Windows Ayarları → Ağ ve İnternet → Ethernet → Ağ profili: Özel.');
  await expect(dialog.locator('.desktop-address')).toContainText('192.168.1.20:3000/uygulama');
});
