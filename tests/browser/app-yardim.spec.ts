import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureSetup, openView } from './helpers';

/*
 * Mola Yardım in the café app (src/HelpPanel.tsx; the same questions as the website, site/src/assets/yardim.json):
 * - the owner: Destek → Yardım and the "?" beside the bell; the screen's topic first; nothing found → "Destek talebi aç"
 *   opens Destek → Talepler with the question written in;
 * - the waiter (phone) and the kitchen (its bar): only the small "?", their own answers (a refund is the cashier's), no
 *   floating button, nothing that pops up by itself, "İşletme sahibinize sorun." when nothing fits;
 * - asking sends nothing: no request but the screen's usual polling, and never the typed words.
 * Screens also go to $env:KAFE_EKRAN (e.g. docs/ekran/kafe): mola-yardim-destek.png, -sahip.png, -garson.png, -mutfak.png.
 */
const PASSWORD = 'MolaDemo!2026';
async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(name) });
  if (process.env.KAFE_EKRAN) { mkdirSync(process.env.KAFE_EKRAN, { recursive: true }); await page.screenshot({ path: join(process.env.KAFE_EKRAN, name) }); }
}
async function signedIn(browser: Browser, username: string, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  if (username === 'isletme') await ensureSetup(page.request);
  await page.goto('/');
  return page;
}
/** Every request from now on; `typed` must never be in one, and nothing but the café's own /api/ (its usual polling) is asked. */
function watchRequests(page: Page, typed: string[]) {
  const seen: string[] = [], bad: string[] = [];
  page.on('request', r => {
    const url = decodeURIComponent(r.url()), body = r.postData() ?? '';
    seen.push(url);
    if (!new URL(r.url()).pathname.startsWith('/api/') || /yardim|help|search|[?&]q=/i.test(url) || typed.some(t => url.includes(t) || body.includes(t))) bad.push(`${r.method()} ${url}`);
  });
  return { seen, bad };
}
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Mola Yardım' });
const searchBox = (page: Page) => sheet(page).getByRole('searchbox', { name: 'Sorunuzu yazın' });

test('the owner: Destek → Yardım and the "?" beside the bell, the screen\'s topic first; nothing found opens a prefilled ticket', async ({ browser }, info) => {
  const page = await signedIn(browser, 'isletme', { width: 1280, height: 860 });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const help = page.locator('header.topbar').getByRole('button', { name: 'Mola Yardım' });
  await expect(help).toBeVisible();
  await expect(page.locator('header.topbar').getByRole('button', { name: /^Bildirimler/ })).toBeVisible();
  // Nothing floats or pops up by itself.
  await expect(page.locator('.yardim-fab, .yardim-balon')).toHaveCount(0);

  // Destek → Yardım (after Mola desteği).
  await openView(page, 'Destek');
  const tabs = page.getByRole('tablist', { name: 'Destek bölümleri' });
  await expect(tabs.getByRole('tab')).toHaveText(['Talepler', 'Duyurular', 'Mola desteği', 'Yardım']);
  await tabs.getByRole('tab', { name: 'Yardım' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Yardım' });
  await panel.getByRole('searchbox', { name: 'Sorunuzu yazın' }).fill('gün sonu');
  await expect(panel.locator('.help-answer h3')).toHaveText('Gün sonu nasıl yapılır?');
  await expect(panel.locator('.help-answer ol li')).toHaveCount(4);
  await shot(page, info, 'mola-yardim-destek.png');
  // The website's own questions (prices, trial) are not in the app.
  await panel.getByRole('searchbox', { name: 'Sorunuzu yazın' }).fill('fiyatlar ne kadar');
  await expect(panel).not.toContainText('Fiyatlar ne kadar?');

  // Kasa ve giderler → "?": Kasa ve ödeme first.
  await openView(page, 'Kasa ve giderler');
  await help.click();
  await expect(sheet(page)).toBeVisible();
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await expect(searchBox(page)).toBeFocused();
  await expect(sheet(page).locator('.help-list h3').first()).toHaveText('Bu ekran: Kasa ve ödeme');
  await expect(sheet(page).getByRole('button', { name: 'Ödeme nasıl alınır?' })).toBeVisible();
  // The topic chips: one row that swipes, no scrollbar.
  expect(await sheet(page).getByRole('group', { name: 'Konular' }).evaluate(e => getComputedStyle(e).scrollbarWidth)).toBe('none');
  await expect(sheet(page).locator('img')).toHaveJSProperty('complete', true);

  const words = ['iade', 'xqzt blorfmak'], net = watchRequests(page, words);
  await searchBox(page).fill('iade');
  await expect(sheet(page).locator('.help-answer h3')).toHaveText('Müşteriye iade nasıl yapılır?');
  await expect(sheet(page).locator('.help-answer')).toContainText('Kasa çipinden “İade”ye basın');
  await page.waitForTimeout(300);
  await shot(page, info, 'mola-yardim-sahip.png');

  // Nothing fits: "Bulamadım." and "Destek talebi aç" (the owner writes to the Mola team).
  await searchBox(page).fill('xqzt blorfmak');
  const none = sheet(page).locator('.help-none');
  await expect(none).toContainText('Bulamadım.');
  await expect(none).toContainText('Aradığınız: “xqzt blorfmak”');
  await page.waitForTimeout(1500);
  expect(net.bad).toEqual([]);
  await none.getByRole('button', { name: 'Destek talebi aç' }).click();
  await expect(sheet(page)).toHaveCount(0);
  const form = page.getByRole('form', { name: 'Yeni destek talebi' });
  await expect(form).toBeVisible();
  await expect(form.locator('input').first()).toHaveValue('xqzt blorfmak');
  await expect(form.locator('textarea')).toHaveValue('xqzt blorfmak');
  await expect(tabs.getByRole('tab', { name: 'Talepler' })).toHaveAttribute('aria-selected', 'true');

  // Esc closes the sheet and gives the focus back to the "?".
  await help.click();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(help).toBeFocused();
  expect(errors).toEqual([]);
  await page.context().close();
});

test('the waiter\'s phone: only the small "?", the waiter\'s own answers, no pop-ups; nothing found: ask the owner', async ({ browser }, info) => {
  const page = await signedIn(browser, 'garson', { width: 390, height: 844 });
  const help = page.locator('header.topbar').getByRole('button', { name: 'Mola Yardım' });
  await expect(help).toBeVisible();
  await expect(page.locator('.support-nav:visible')).toHaveCount(0);
  await page.waitForTimeout(2500);
  await expect(page.locator('.yardim-fab, .yardim-balon, dialog[open]')).toHaveCount(0);
  const box = (await help.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(40);
  await page.locator('header.topbar').screenshot({ path: info.outputPath('garson-ust-cubuk.png') });

  await help.click();
  await expect(sheet(page)).toBeVisible();
  // On a touch-less phone emulation the box may take the focus; the sheet fills the phone without sideways scroll.
  const s = (await sheet(page).boundingBox())!;
  expect(s.x).toBeGreaterThanOrEqual(0); expect(s.x + s.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(sheet(page).locator('.help-list h3').first()).toHaveText('Bu ekran: Masa ve sipariş');

  const net = watchRequests(page, ['iade', 'xqzt']);
  await searchBox(page).fill('iade');
  await expect(sheet(page).locator('.help-answer h3')).toHaveText('Müşteri para iadesi istiyor.');
  await expect(sheet(page).locator('.help-answer')).toContainText('İadeyi kasiyer ya da işletme sahibi yapar.');
  await expect(sheet(page)).not.toContainText('Kasa çipinden');
  await expect(sheet(page)).not.toContainText('Müşteriye iade nasıl yapılır?');
  await page.waitForTimeout(300);
  await shot(page, info, 'mola-yardim-garson.png');
  await searchBox(page).fill('kafemi yönet');
  await expect(sheet(page)).not.toContainText('Kafemi yönet’i');
  await searchBox(page).fill('xqzt blorfmak');
  await expect(sheet(page).locator('.help-none')).toContainText('Bulamadım.');
  await expect(sheet(page).locator('.help-none')).toContainText('İşletme sahibinize sorun.');
  await expect(sheet(page).getByRole('button', { name: 'Destek talebi aç' })).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(net.bad).toEqual([]);
  await sheet(page).getByRole('button', { name: 'Yardımı kapat' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await page.context().close();
});

test('the kitchen: the "?" on its bar only, kitchen answers first (Mutfak ve fiş), no cashier steps', async ({ browser }, info) => {
  const page = await signedIn(browser, 'mutfak', { width: 1280, height: 800 });
  const bar = page.locator('.kitchen-bar');
  const help = bar.getByRole('button', { name: 'Mola Yardım' });
  await expect(help).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.locator('.yardim-fab, .yardim-balon, dialog[open], header.topbar')).toHaveCount(0);
  await bar.screenshot({ path: info.outputPath('mutfak-cubugu.png') });
  await help.click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('.help-list h3').first()).toHaveText('Bu ekran: Mutfak ve fiş');
  await expect(sheet(page).getByRole('button', { name: 'Mutfak ekranı nasıl kullanılır?' })).toBeVisible();
  const net = watchRequests(page, ['fiş modu', 'gün sonu']);
  await searchBox(page).fill('fiş modu');
  await expect(sheet(page).locator('.help-answer h3')).toHaveText('Fiş modunda nasıl çalışılır?');
  await searchBox(page).fill('gün sonu');
  await expect(sheet(page)).not.toContainText('Gün sonu nasıl yapılır?');
  await searchBox(page).fill('');
  await sheet(page).getByRole('group', { name: 'Konular' }).getByRole('button', { name: 'Mutfak ve fiş' }).click();
  await sheet(page).getByRole('button', { name: 'Mutfakta iptal ve değişiklik nasıl görünür?' }).click();
  await expect(sheet(page).locator('.help-answer h3')).toHaveText('Mutfakta iptal ve değişiklik nasıl görünür?');
  await page.waitForTimeout(300);
  await shot(page, info, 'mola-yardim-mutfak.png');
  await page.waitForTimeout(1000);
  expect(net.bad).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await page.context().close();
});
