import { test, expect, devices, type Browser, type Page } from '@playwright/test';
import { ensureSetup, openView } from './helpers';

/*
 * Owner's report (iPhone 13, Safari, opened from the QR): the login page zoomed in on the first tap (iOS zooms into any
 * field under 16 px) and after sign-in stayed zoomed and wider than the screen. Every screen must fit the phone at scale 1
 * and every field must be at least 16 px on touch screens. Chrome stands in for Safari (no WebKit on this computer): the
 * iPhone 13 profile's size, scale, touch and mobile viewport, without its WebKit browser type.
 */
const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? '3100'}`;
const { defaultBrowserType: _webkit, ...IPHONE_13 } = devices['iPhone 13'];
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DEVICES: { name: string; options: Parameters<Browser['newContext']>[0] }[] = [
  { name: 'iPhone 13', options: IPHONE_13 },
  { name: 'Android 360', options: { viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: ANDROID_UA } },
  { name: 'iPad 768', options: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_UA } },
  { name: 'iPad 820', options: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_UA } },
  { name: 'iPad 1024', options: { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_UA } },
];

/** Fits at scale 1: no sideways scroll, the layout viewport is the device width, no wider element, every field ≥ 16 px. */
async function fits(page: Page, width: number, where: string) {
  const r = await page.evaluate(() => {
    const wide = [...document.querySelectorAll<HTMLElement>('body *')].filter(el => {
      const box = el.getBoundingClientRect();
      // Not drawn (a closed <details>, display:none, visibility:hidden) cannot stick out.
      if (!box.width || !el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) return false;
      // Inside a sideways scroller (tabs, tables) is fine; only what sticks out of the page counts.
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return false; }
      return box.right > innerWidth + 1 || box.left < -1;
    }).slice(0, 5).map(el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')} ${Math.round(el.getBoundingClientRect().left)}…${Math.round(el.getBoundingClientRect().right)}`);
    const small = [...document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=hidden]), select, textarea')]
      .filter(el => el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }) && parseFloat(getComputedStyle(el).fontSize) < 16)
      .slice(0, 5).map(el => `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}.${String(el.className)} ${getComputedStyle(el).fontSize}`);
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth, scale: visualViewport?.scale ?? 1, wide, small };
  });
  expect(r.innerWidth, `${where}: layout viewport is the device width`).toBe(width);
  expect(r.scale, `${where}: scale 1`).toBe(1);
  expect(r.wide, `${where}: elements wider than the screen`).toEqual([]);
  expect(r.scrollWidth, `${where}: no sideways scroll`).toBeLessThanOrEqual(width);
  expect(r.small, `${where}: fields under 16 px make iOS zoom in`).toEqual([]);
}

for (const device of DEVICES) test(`${device.name}: login, Masalar, Sipariş al, Satış ve Raporlar, Ayarlar, kitchen and guest menu fit at scale 1`, async ({ browser, request }, info) => {
  // Seven screens and the kitchen and guest per device, each page reopened up to three times: past 30 s on a busy computer.
  test.setTimeout(90000);
  const width = device.options!.viewport!.width;
  await request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(request);
  const token = (await (await request.get('/api/staff/state')).json()).tables[0].token;
  const context = await browser.newContext({ ...device.options, baseURL: BASE });
  let page = await context.newPage();
  const shot = (name: string) => page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });

  await page.goto('/');
  await page.getByLabel('Kullanıcı adı').waitFor();
  await fits(page, width, 'login');
  // Typing in the form (the moment iOS zooms) and signing in through the page, as the owner did.
  await page.getByLabel('Kullanıcı adı').tap(); await page.getByLabel('Kullanıcı adı').fill('isletme');
  await page.getByLabel('Şifre', { exact: true }).fill('MolaDemo!2026');
  await page.getByRole('button', { name: 'Çalışma alanını aç' }).tap();
  // Tablets: the sidebar; phones (≤ 700 px): the bottom bar.
  await page.locator('.sidebar nav:visible, nav.bottom-nav:visible').first().getByRole('button', { name: 'Masalar', exact: true }).waitFor();
  await page.waitForTimeout(300);
  await fits(page, width, 'Masalar'); await shot('masalar');
  // The asked-for screens, then the rest of the owner's sidebar.
  // Each in a fresh tab of the same signed-in phone: Chrome's touch emulation (standing in for Safari) sometimes drops
  // (pointer: coarse) on a tab, which a real phone never does. The 16 px rule for wide touch screens (iPad 1024) hangs on
  // exactly that media query, so a tab that lost it is opened again (at most three times) before measuring.
  const touch = (p: Page) => p.evaluate(() => matchMedia('(pointer: coarse), (any-pointer: coarse)').matches);
  async function open(name: string, then?: (p: Page) => Promise<void>) {
    for (let attempt = 1; ; attempt++) {
      await page.close(); page = await context.newPage(); await page.goto('/');
      await openView(page, name);
      await page.getByRole('heading', { level: 1 }).first().waitFor();
      await page.waitForTimeout(400);
      if (then) await then(page);
      if (await touch(page) || attempt === 3) return;
    }
  }
  for (const name of ['Sipariş al', 'Satış ve Raporlar', 'Ayarlar', 'Menü yönetimi', 'Kampanyalar', 'Ajanda ve rezervasyon', 'Çalışanlar']) {
    await open(name);
    await fits(page, width, name); await shot(name.replaceAll(' ', '-'));
    if (name === 'Satış ve Raporlar') {
      await open(name, async p => { await p.locator('summary').filter({ hasText: 'Tarih seç' }).tap(); await p.getByLabel('Başlangıç').waitFor(); });
      await fits(page, width, 'Tarih seç (açık)'); await shot('tarih-sec');
    }
  }

  const kitchen = await context.browser()!.newContext({ ...device.options, baseURL: BASE });
  const cook = await kitchen.newPage();
  await cook.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } });
  await cook.goto('/'); await cook.locator('.kitchen-tools').waitFor(); await cook.waitForTimeout(300);
  await fits(cook, width, 'kitchen');
  await kitchen.close();

  const guest = await context.browser()!.newContext({ ...device.options, baseURL: BASE });
  const menu = await guest.newPage();
  await menu.goto(`/m/${token}`); await menu.getByRole('button', { name: 'Tümü', exact: true }).waitFor(); await menu.waitForTimeout(300);
  await fits(menu, width, 'guest menu');
  await expect(menu.locator('link[rel="manifest"]')).toHaveCount(0);
  await guest.close();
  await context.close();
});
