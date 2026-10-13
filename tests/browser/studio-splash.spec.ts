import { test, expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { e2eRun, ensureSetup, MERKEZ, openSettings, openView, openYonetim } from './helpers';

/*
 * Merkut Studios açılışı (src/StudioSplash.tsx, src/splashRules.ts) and the version lines (src/AppVersion.tsx).
 * Owner's decision: only right after Mola.exe opens the café window (its one-time `/#masaustu=<key>` address); never on
 * tablets' or phones' browsers, reloads, page changes or the guest menu. Android, Mola Yönetim and Raporlarım: off for now
 * (src/studio-splash.json). The opening stays away from browser automation (navigator.webdriver) so the other suites sign
 * in at once; here each page pretends to be an ordinary browser first.
 */
const VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const versionText = new RegExp(`^Mola ${VERSION.replace(/\./g, '\\.')} · Merkut Studios`);
const desktopKey = () => readFileSync(join(e2eRun(), 'masaustu.anahtar'), 'utf8').trim();
/** What Mola.exe opens (scripts/desktop/Mola.cs). */
const launch = () => `/#masaustu=${desktopKey()}`;
async function person(browser: Browser, options: BrowserContextOptions = {}) {
  const context = await browser.newContext(options), page = await context.newPage();
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true }));
  return { context, page };
}
const splash = (page: Page) => page.locator('.studio-splash');
const welcome = (page: Page) => page.getByRole('heading', { name: 'Hoş geldiniz.' });
/** Never appears: the page is up, and some time has passed in which it would have shown. */
async function noSplash(page: Page) { await page.waitForTimeout(500); await expect(splash(page)).toHaveCount(0); }
/** Screens for the owner: also saved to KAFE_EKRAN (docs/ekran/kafe) when that is set. */
async function shot(page: Page, file: string, path: string) {
  await page.screenshot({ path });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file) }); }
}

test('Mola.exe launch: black → logo fades in, holds, fades out (≤ 2.5 s) → sign-in; once: not on reload or page change', async ({ browser }, info) => {
  const { context, page } = await person(browser, { viewport: { width: 1280, height: 800 } });
  // The phases as they happen, with their time.
  await page.addInitScript(() => {
    const log: [string, number][] = ((window as unknown as { __phases: [string, number][] }).__phases = []);
    new MutationObserver(() => { const el = document.querySelector('.studio-splash'); const p = el?.getAttribute('data-phase') ?? 'gone'; if (log.at(-1)?.[0] !== p && (el || log.length)) log.push([p, performance.now()]); })
      .observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] });
  });
  await page.goto(launch());
  await expect(splash(page)).toBeVisible();
  await expect(splash(page)).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(splash(page)).toHaveAttribute('data-phase', 'hold');
  // The optimised logo (AVIF or WebP, 600 px), decoded and fully shown.
  const img = splash(page).locator('img');
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(600);
  expect(await img.evaluate((i: HTMLImageElement) => i.currentSrc)).toMatch(/\/assets\/merkut-studios-[\w-]+\.(avif|webp)$/);
  await expect(img).toHaveCSS('opacity', '1');
  // On top of everything, also of the window's own dialogs that open at launch ("Kurtarma kodunuz"): a modal in the top layer.
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => [[0.5, 0.5], [0.1, 0.1], [0.9, 0.9]].every(([x, y]) => !!document.elementFromPoint(innerWidth * x, innerHeight * y)?.closest('.studio-splash')))).toBe(true);
  await shot(page, 'acilis-merkut.png', info.outputPath('acilis-merkut.png'));
  await expect(splash(page)).toHaveCount(0, { timeout: 3000 });
  await expect(welcome(page)).toBeVisible();
  const phases = await page.evaluate(() => (window as unknown as { __phases: [string, number][] }).__phases);
  expect(phases.map(p => p[0])).toEqual(['black', 'in', 'hold', 'out', 'leave', 'gone']);
  const time = (name: string) => phases.find(p => p[0] === name)![1];
  expect(time('gone') - time('black')).toBeLessThanOrEqual(2600);
  expect(time('hold') - time('in')).toBeGreaterThan(450);
  expect(time('leave') - time('out')).toBeGreaterThan(450);
  // The launch address is used once: the window's address no longer carries it.
  expect(new URL(page.url()).hash).toBe('');
  // The sign-in screen's own small footer.
  await expect(page.locator('.login-form').getByTestId('app-version')).toHaveText(`Mola ${VERSION} · Merkut Studios`);
  // A reload, another page in the window, even the launch address again in the same window: not again.
  await page.reload();
  await expect(welcome(page)).toBeVisible();
  await noSplash(page);
  await page.goto('/');
  await noSplash(page);
  await page.goto(launch());
  await noSplash(page);
  await context.close();
});

test('tablets, phones and plain browsers never show it (no launch address)', async ({ browser }) => {
  for (const viewport of [{ width: 820, height: 1180 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const { context, page } = await person(browser, { viewport });
    await page.goto('/');
    await expect(welcome(page)).toBeVisible();
    await noSplash(page);
    await context.close();
  }
});

test('a click or a key skips the opening; the sign-in is there at once', async ({ browser }) => {
  for (const how of ['click', 'key'] as const) {
    const { context, page } = await person(browser);
    await page.goto(launch());
    await expect(splash(page)).toBeVisible();
    const started = Date.now();
    if (how === 'click') await page.mouse.click(200, 200); else await page.keyboard.press('Space');
    await expect(splash(page)).toHaveCount(0, { timeout: 500 });
    expect(Date.now() - started).toBeLessThan(500);
    await expect(welcome(page)).toBeVisible();
    await context.close();
  }
});

// 13 Ekim: after an update Mola.exe reopened the window with the owner still signed in but locked (Sahip hesabı kilidi). The
// opening and the lock screen each moved themselves back to the top whenever another dialog opened, so they pushed each
// other forever: the page froze on the black logo. Now the opening runs its course above the lock, then the lock is there.
test('a locked owner session at launch: the opening ends on time, then the lock screen works', async ({ browser }) => {
  const { context, page } = await person(browser, { viewport: { width: 1280, height: 800 } });
  expect((await context.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } })).ok()).toBe(true);
  await ensureSetup(context.request);
  expect((await context.request.post('/api/staff/lock', { data: {} })).ok()).toBe(true);
  await page.goto(launch());
  await expect(splash(page)).toBeVisible();
  const lock = page.getByRole('dialog', { name: 'Sahip hesabı kilitlendi' });
  await expect(lock).toBeAttached();
  await expect(splash(page)).toHaveCount(0, { timeout: 3500 });
  await expect(lock).toBeVisible();
  await lock.getByLabel('Şifreniz').fill('MolaDemo!2026');
  await lock.getByRole('button', { name: 'Kilidi aç' }).click();
  await expect(lock).toHaveCount(0);
  await context.close();
});

test('reduced motion: the logo shows still for 600 ms, no fades', async ({ browser }) => {
  const { context, page } = await person(browser, { reducedMotion: 'reduce' });
  await page.goto(launch());
  await expect(splash(page)).toBeVisible();
  await expect(splash(page)).toHaveClass(/reduced/);
  await expect(splash(page)).toHaveAttribute('data-phase', 'hold');
  await expect(splash(page).locator('img')).toHaveCSS('transition-duration', '0s');
  const shown = Date.now();
  await expect(splash(page)).toHaveCount(0, { timeout: 1500 });
  expect(Date.now() - shown).toBeLessThan(1000);
  await context.close();
});

test('never for guests (QR menu), in the Android app, in an İki ekran pane; Mola Yönetim and Raporlarım are off for now', async ({ browser }) => {
  const guest = await person(browser, { viewport: { width: 390, height: 844 } });
  await guest.page.goto(`/m/ornek#masaustu=${desktopKey()}`);
  await noSplash(guest.page);
  await guest.context.close();
  const app = await person(browser, { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 MolaApp/0.1.0' });
  await app.page.goto(launch());
  await expect(welcome(app.page)).toBeVisible();
  await noSplash(app.page);
  await app.context.close();
  // A frame of the page (the café window's panes are frames): only the outer page may show it.
  const framed = await person(browser);
  await framed.page.goto('/uygulama');
  await framed.page.evaluate(src => { const f = document.createElement('iframe'); f.name = 'cerceve'; f.src = src; f.style.cssText = 'width:600px;height:400px'; document.body.appendChild(f); }, launch());
  const frame = framed.page.frameLocator('iframe[name="cerceve"]');
  await expect(frame.getByRole('heading', { name: 'Hoş geldiniz.' })).toBeVisible();
  await framed.page.waitForTimeout(500);
  await expect(frame.locator('.studio-splash')).toHaveCount(0);
  await framed.context.close();
  const merkez = await person(browser);
  await merkez.page.goto(`${MERKEZ}/`);
  await expect(merkez.page.getByLabel('Şifre', { exact: true })).toBeVisible();
  await noSplash(merkez.page);
  await merkez.page.goto(`${MERKEZ}/raporlarim`);
  await noSplash(merkez.page);
  await merkez.context.close();
});

test('versions: Hesabım and Ayarlar end with "Mola <version> · Merkut Studios" (+ update state); Mola Yönetim its own', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  await page.goto('/');
  await openView(page, 'Hesabım');
  const line = page.getByTestId('app-version');
  await expect(line).toHaveText(versionText);
  await expect(line).toContainText('Güncelleme:');
  await openSettings(page, 'İşletme');
  await expect(page.getByTestId('app-version')).toHaveText(versionText);
  await openYonetim(page);
  // Mola Yönetim: one line with the Merkez version too (Ayarlar has no second one).
  await expect(page.locator('.yonetim-footer').getByTestId('app-version')).toHaveText(`Mola Yönetim ${VERSION} · Merkez ${VERSION} · Merkut Studios`);
});
