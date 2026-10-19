import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { MERKEZ } from './helpers';

/*
 * molayazilim.com.tr → "Bu sayfada" (scripts/site-build.ts sectionNavHtml, site.css, site.js): every page with several parts
 * lists them (data-bolum) as a slim rail on the left from 1280 px and as a row of chips under the header on narrower screens;
 * the part on screen is marked (aria-current="true"), a click scrolls there, puts #id in the address bar without a new history
 * step and moves the focus to the part's heading. The rail never covers the content, neither one meets Mola Yardım. Also the
 * header's "Fiyatlar" (→ /ozellikler/#paketler), the header at every width and no sideways page scroll at 360 px.
 * The site is built into a scratch folder (never site/dist) and served as Caddy does (scripts/site-dev.ts, same CSP).
 * Port: E2E_PORT + 45. Screenshots also go to $env:SITE_EKRAN when it is set (e.g. docs/ekran/site).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100) + 45, SITE = `http://127.0.0.1:${PORT}`;
let scratch = '';
let server: ChildProcess | undefined;
test.beforeAll(async () => {
  test.setTimeout(180000);
  mkdirSync('.local/e2e', { recursive: true }); scratch = mkdtempSync(resolve('.local/e2e/site-gezinme-'));
  const config = join(scratch, 'config.json');
  writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync('site/config.json', 'utf8')), downloads: { enabled: false, version: '', files: {} } }));
  server = spawn(process.execPath, ['--import', 'tsx', 'scripts/site-dev.ts', '--port', String(PORT), '--merkez', MERKEZ, '--no-watch', '--dist', join(scratch, 'dist'), '--config', config], { stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${SITE}/ozellikler/`)).ok) break; } catch { /* building */ }
    if (i > 400 || server.exitCode !== null) throw new Error('Web sitesi açılmadı.');
    await new Promise(r => setTimeout(r, 250));
  }
});
test.afterAll(() => { if (server && server.exitCode === null) server.kill(); if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); });

/** Page errors and CSP reports in the console: both must stay empty. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(`csp: ${m.text()}`); });
  return problems;
}
async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(name) });
  if (process.env.SITE_EKRAN) { mkdirSync(process.env.SITE_EKRAN, { recursive: true }); await page.screenshot({ path: join(process.env.SITE_EKRAN, name) }); }
}
type Box = { x: number; y: number; width: number; height: number };
const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const box = async (l: Locator) => (await l.boundingBox())!;
/** The heading is on screen, below the header and the chip bar (when there is one). */
async function inSight(page: Page, heading: Locator) {
  const covers = await page.evaluate(() => Math.max(...['.site-header', '.bolumler-cubuk'].map(s => document.querySelector(s)).filter(e => e && e.getClientRects().length).map(e => e!.getBoundingClientRect().bottom)));
  const b = await box(heading), height = page.viewportSize()!.height;
  return b.y >= covers - 1 && b.y + b.height <= height;
}

const OZELLIKLER = ['Rollere göre', 'Hizmetler', 'Raporlar', 'Kasa ve stok', 'Rezervasyon ve vardiya', 'QR kartları', 'Uzaktan', 'Yedek ve güvenlik', 'Paketler ve fiyatlar'];

test('Özellikler at 1440 px: the rail on the left, beside (never over) the content; "Paketler ve fiyatlar" scrolls to the prices, marks itself, #paketler, focus on the heading', async ({ page }, info) => {
  const problems = watch(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/ozellikler/`);
  const rail = page.getByRole('navigation', { name: 'Bu sayfada' });
  await expect(rail).toHaveCount(1); // the chip bar is not shown (nor read out) at this width
  await expect(rail).toHaveClass(/bolumler-ray/); await expect(rail).toBeVisible();
  await expect(page.locator('.bolumler-cubuk')).toBeHidden();
  await expect(rail.locator('.bolumler-baslik')).toHaveText('Bu sayfada');
  await expect(rail.getByRole('link')).toHaveText(OZELLIKLER);
  await expect(rail.locator('[aria-current]')).toHaveCount(0); // the hero: no part yet
  // Left of the content all the way down: every block in main starts right of the rail; the header keeps its place.
  const r = await box(rail);
  expect(r.x).toBeGreaterThanOrEqual(16);
  const lefts = await page.evaluate(() => [...document.querySelectorAll('main .wrap > *')].filter(e => e.getClientRects().length).map(e => Math.round(e.getBoundingClientRect().left)));
  expect(lefts.length).toBeGreaterThan(10);
  expect(Math.min(...lefts), 'içerik rayın sağında başlar').toBeGreaterThanOrEqual(r.x + r.width + 16);
  expect(meets(r, await box(page.locator('.yardim-fab')))).toBe(false);
  await shot(page, info, 'gezinme-ray-1440.png');

  const historyLength = await page.evaluate(() => history.length);
  await rail.getByRole('link', { name: 'Paketler ve fiyatlar' }).click();
  const heading = page.locator('#paketler-baslik');
  await expect(rail.getByRole('link', { name: 'Paketler ve fiyatlar' })).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => inSight(page, heading), { timeout: 5000 }).toBe(true);
  await expect(page.locator('#paketler article[data-paket="kafe-standart"] .package-price .now b')).toBeInViewport();
  expect(new URL(page.url()).hash).toBe('#paketler');
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await expect(heading).toBeFocused();
  // Still marked once the smooth scroll has settled; the only one marked; the rail stayed in place (sticky).
  await page.waitForTimeout(1700);
  await expect(rail.locator('[aria-current="true"]')).toHaveText(['Paketler ve fiyatlar']);
  expect(Math.round((await box(rail)).y)).toBe(104);
  expect(meets(await box(rail), await box(page.locator('.yardim-fab')))).toBe(false);
  await shot(page, info, 'gezinme-ray-1440-paketler.png');

  // Scrolling by hand moves the mark along.
  await page.evaluate(() => window.scrollTo(0, document.getElementById('uzaktan')!.getBoundingClientRect().top + scrollY - 120));
  await expect(rail.locator('[aria-current="true"]')).toHaveText(['Uzaktan']);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(rail.locator('[aria-current]')).toHaveCount(0);
  // The old address /ozellikler/#paketler still opens on the prices, with the link marked.
  await page.goto(`${SITE}/ozellikler/#paketler`);
  await expect.poll(() => inSight(page, heading)).toBe(true);
  await expect(rail.locator('[aria-current="true"]')).toHaveText(['Paketler ve fiyatlar']);
  // Keyboard: Enter on a link moves the focus to that part's heading.
  await rail.getByRole('link', { name: 'Raporlar' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#raporlar h3')).toBeFocused();
  await expect.poll(() => inSight(page, page.locator('#raporlar h3')), { timeout: 5000 }).toBe(true);
  expect(problems).toEqual([]);
});

test('Özellikler at 390 px: the chips under the hero stay under the header, swipe sideways without a scrollbar and take you to the prices', async ({ page }, info) => {
  const problems = watch(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${SITE}/ozellikler/`);
  const bar = page.getByRole('navigation', { name: 'Bu sayfada' });
  await expect(bar).toHaveCount(1);
  await expect(bar).toHaveClass(/bolumler-cubuk/); await expect(bar).toBeVisible();
  await expect(page.locator('.bolumler-ray')).toBeHidden();
  await expect(bar.getByRole('link')).toHaveText(OZELLIKLER);
  // Right under the hero, not tall.
  const hero = await box(page.locator('.page-hero')), b = await box(bar);
  expect(Math.abs(b.y - (hero.y + hero.height))).toBeLessThanOrEqual(1);
  expect(b.height).toBeLessThanOrEqual(56);
  const row = bar.locator('ul');
  expect(await row.evaluate(e => getComputedStyle(e).scrollbarWidth)).toBe('none');
  expect(await row.evaluate(e => e.scrollWidth > e.clientWidth && (e as HTMLElement).offsetHeight - e.clientHeight === 0)).toBe(true);
  // For a mouse: › at the right end while more chips are there (site.js MolaKaydir), out of the Tab order.
  await expect(bar.getByRole('button', { name: 'Sonraki bölümler' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Sonraki bölümler' })).toHaveAttribute('tabindex', '-1');
  await expect(bar.getByRole('button', { name: 'Önceki bölümler' })).toBeHidden();
  await shot(page, info, 'gezinme-cubuk-390.png');

  await bar.getByRole('link', { name: 'Paketler ve fiyatlar' }).click();
  const heading = page.locator('#paketler-baslik'), chip = bar.getByRole('link', { name: 'Paketler ve fiyatlar' });
  await expect(chip).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => inSight(page, heading)).toBe(true);
  expect(new URL(page.url()).hash).toBe('#paketler');
  await expect(heading).toBeFocused();
  // The bar stays under the header; the marked chip is in sight within it; Mola Yardım is far from it.
  expect(Math.round((await box(bar)).y)).toBe(72);
  const c = await box(chip), stuck = await box(bar);
  expect(c.x).toBeGreaterThanOrEqual(0); expect(c.x + c.width).toBeLessThanOrEqual(390);
  expect(meets(stuck, await box(page.locator('.yardim-fab')))).toBe(false);
  await expect(bar.locator('[aria-current="true"]')).toHaveText(['Paketler ve fiyatlar']);
  await shot(page, info, 'gezinme-cubuk-390-paketler.png');
  // Scrolling back up marks the part on screen, and its chip comes into sight.
  await page.evaluate(() => window.scrollTo(0, document.getElementById('hizmetler')!.getBoundingClientRect().top + scrollY - 140));
  await expect(bar.locator('[aria-current="true"]')).toHaveText(['Hizmetler']);
  await expect.poll(async () => { const h = await box(bar.getByRole('link', { name: 'Hizmetler' })); return h.x >= 0 && h.x + h.width <= 390; }).toBe(true);
  expect(problems).toEqual([]);
});

// 20 Ekim (sahibin kararı): on a phone the chips stay on top and dots on the left show the cards of the part on screen.
test('Özellikler at 390 px: dots for the cards of the part on screen (three or more), the card being read marked, a dot takes there; none on wide screens', async ({ page }, info) => {
  const problems = watch(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${SITE}/ozellikler/`);
  const rail = page.getByRole('navigation', { name: 'Bu bölümdeki kartlar' });
  await expect(rail).toBeHidden(); // the hero: no part yet
  await page.evaluate(() => window.scrollTo(0, document.getElementById('roller')!.getBoundingClientRect().top + scrollY + 200));
  await expect(rail).toBeVisible();
  await expect(rail.getByRole('button')).toHaveCount(6);
  await expect(rail.getByRole('button').first()).toHaveAccessibleName('Garson');
  // Finger-sized, on the left, never over a card.
  const dot = await box(rail.getByRole('button').first()), card = await box(page.locator('#roller h3').first().locator('xpath=ancestor::article[1]'));
  expect(dot.height).toBeGreaterThanOrEqual(30); expect(dot.x + dot.width).toBeLessThanOrEqual(card.x + 1);
  await rail.getByRole('button', { name: 'Müdür' }).click();
  await expect(rail.getByRole('button', { name: 'Müdür' })).toHaveAttribute('aria-current', 'true');
  await shot(page, info, 'gezinme-noktalar-390.png');
  // Kasa ve stok has two cards: no dots there.
  await page.evaluate(() => window.scrollTo(0, document.getElementById('kasa-ve-stok')!.getBoundingClientRect().top + scrollY - 200));
  await expect(rail).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, document.getElementById('roller')!.getBoundingClientRect().top + scrollY + 200));
  await expect(rail).toBeHidden();
  expect(problems).toEqual([]);
});

test('Mola Yardım\'s bubble and button never meet the rail or the chip bar', async ({ browser }) => {
  for (const [width, height, part] of [[1280, 720, '.bolumler-ray'], [390, 700, '.bolumler-cubuk'], [1000, 700, '.bolumler-cubuk']] as const) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    await page.clock.install();
    await page.goto(`${SITE}/ozellikler/`);
    await page.evaluate(() => window.scrollTo(0, 2400));
    await page.clock.runFor(20_500);
    const bubble = page.locator('.yardim-balon');
    await expect(bubble).toBeVisible();
    const nav = await box(page.locator(part));
    expect(meets(nav, await box(bubble)), `${width} px: baloncuk`).toBe(false);
    expect(meets(nav, await box(page.locator('.yardim-fab'))), `${width} px: düğme`).toBe(false);
    await page.close();
  }
});

test('Header: "Fiyatlar" goes to the prices (wide and in the phone menu); the header fits on one line at every width', async ({ page }) => {
  const problems = watch(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/`);
  const nav = page.getByRole('navigation', { name: 'Ana menü' });
  await expect(nav.getByRole('link')).toHaveText(['Ana sayfa', 'Özellikler', 'Fiyatlar', 'Uygulamayı indir', 'Destek ve İletişim']);
  await nav.getByRole('link', { name: 'Fiyatlar' }).click();
  await expect(page).toHaveURL(`${SITE}/ozellikler/#paketler`);
  await expect.poll(() => inSight(page, page.locator('#paketler-baslik'))).toBe(true);
  await expect(page.locator('.bolumler-ray [aria-current="true"]')).toHaveText(['Paketler ve fiyatlar']);
  // On a phone: from the menu, the prices land below the header and the chip bar.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${SITE}/indir/`);
  await page.getByRole('button', { name: 'Menüyü aç' }).click();
  await nav.getByRole('link', { name: 'Fiyatlar' }).click();
  await expect(page).toHaveURL(`${SITE}/ozellikler/#paketler`);
  await expect.poll(() => inSight(page, page.locator('#paketler-baslik'))).toBe(true);
  // One row (72 px) from 360 to 1920 px: the links side by side from 1081 px, the menu button below that.
  for (const width of [360, 640, 768, 900, 1000, 1080, 1081, 1100, 1180, 1240, 1280, 1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${SITE}/ozellikler/`);
    expect(Math.round((await box(page.locator('.site-header'))).height), `${width} px`).toBeLessThanOrEqual(73);
    const state = await page.evaluate(() => {
      const links = [...document.querySelectorAll('.main-nav a')].filter(a => getComputedStyle(a).display !== 'none');
      const row = document.querySelector('.header-row')!;
      return { menu: getComputedStyle(document.querySelector('.menu-toggle')!).display !== 'none', tops: new Set(links.map(a => Math.round(a.getBoundingClientRect().top))).size, wraps: links.some(a => a.getBoundingClientRect().height > 48), fits: row.scrollWidth <= row.clientWidth };
    });
    expect(state.fits, `${width} px`).toBe(true);
    if (width >= 1081) expect(state, `${width} px`).toEqual({ menu: false, tops: 1, wraps: false, fits: true });
    else {
      expect(state.menu, `${width} px`).toBe(true);
      await page.getByRole('button', { name: 'Menüyü aç' }).click();
      await expect(nav.getByRole('link', { name: 'Fiyatlar' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
  }
  expect(problems).toEqual([]);
});

test('Every page with several parts lists them; the rest have none; no sideways scroll at 360 px; no CSP report', async ({ page }) => {
  const problems = watch(page);
  const lists: Record<string, string[]> = {
    '/': ['Kısaca Mola', 'Nasıl çalışır?', 'Sözlerimiz', 'Ölçümler'],
    '/ozellikler/': OZELLIKLER,
    '/indir/': ['İndirme dosyaları', 'Telefon ve tablet', 'Windows uyarısı', 'Kurulum adımları'],
    '/iletisim/': ['Talep formu', 'Doğrudan ulaşın', 'Mola Yardım', 'Sık sorulanlar'],
    '/kvkk/': ['Veri sorumlusu', 'İşlenen veriler', 'İşleme amaçları', 'Hukuki sebep', 'Aktarım', 'Saklama süresi', 'Haklarınız'],
    '/gizlilik/': [], '/cerez/': [],
  };
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [path, names] of Object.entries(lists)) {
      await page.goto(`${SITE}${path}`);
      const nav = page.getByRole('navigation', { name: 'Bu sayfada' });
      if (!names.length) { await expect(page.locator('.bolumler')).toHaveCount(0); await expect(page.locator('html')).not.toHaveClass(/bolumlu/); }
      else {
        await expect(nav.getByRole('link'), `${path} ${width} px`).toHaveText(names);
        // Each link has its part on the page.
        const missing = await nav.evaluate(n => [...n.querySelectorAll('a')].map(a => a.getAttribute('href')!).filter(h => !document.getElementById(h.slice(1))));
        expect(missing, path).toEqual([]);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} ${width} px: yana kaymaz`).toBe(true);
    }
  }
  // Destek ve İletişim on a phone: "Doğrudan ulaşın" (below the form there) is one tap away.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${SITE}/iletisim/`);
  await page.getByRole('navigation', { name: 'Bu sayfada' }).getByRole('link', { name: 'Doğrudan ulaşın' }).click();
  await expect.poll(() => inSight(page, page.locator('#dogrudan'))).toBe(true);
  await expect(page.locator('#dogrudan')).toBeFocused();
  expect(problems).toEqual([]);
});
