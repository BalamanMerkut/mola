import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { MERKEZ } from './helpers';

/*
 * molayazilim.com.tr → Mola Yardım (site/src/assets/yardim.js, questions from yardim.json): hazır cevaplar, no AI, no request
 * while asking, plain text only, keyboard and phone friendly; the button on every page (the home page too) and its speech
 * bubble once a visit (site.js; page.clock stands in for the 20 s). Also the "Bilgi ve deneme talebi" form without "Masa sayısı".
 * The site is built into a scratch folder (never site/dist) and served the way Caddy does it (scripts/site-dev.ts, same
 * CSP). Port: E2E_PORT + 43. Screenshots also go to $env:SITE_EKRAN when it is set (e.g. docs/ekran/site).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100) + 43, SITE = `http://127.0.0.1:${PORT}`;
let scratch = '';
let server: ChildProcess | undefined;
test.beforeAll(async () => {
  test.setTimeout(180000);
  mkdirSync('.local/e2e', { recursive: true }); scratch = mkdtempSync(resolve('.local/e2e/site-yardim-'));
  // Downloads off: the scratch build has no installers (and needs none here).
  const config = join(scratch, 'config.json');
  writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync('site/config.json', 'utf8')), downloads: { enabled: false, version: '', files: {} } }));
  server = spawn(process.execPath, ['--import', 'tsx', 'scripts/site-dev.ts', '--port', String(PORT), '--merkez', MERKEZ, '--no-watch', '--dist', join(scratch, 'dist'), '--config', config], { stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${SITE}/iletisim/`)).ok) break; } catch { /* building */ }
    if (i > 400 || server.exitCode !== null) throw new Error('Web sitesi açılmadı.');
    await new Promise(r => setTimeout(r, 250));
  }
});
test.afterAll(() => { if (server && server.exitCode === null) server.kill(); if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); });

/** Page errors, CSP reports in the console and any alert/confirm: all must stay empty. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(`csp: ${m.text()}`); });
  page.on('dialog', d => { problems.push(`dialog: ${d.message()}`); void d.dismiss(); });
  return problems;
}
async function shot(page: Page, info: TestInfo, name: string, fullPage = false) {
  await page.screenshot({ path: info.outputPath(name), fullPage });
  if (process.env.SITE_EKRAN) { mkdirSync(process.env.SITE_EKRAN, { recursive: true }); await page.screenshot({ path: join(process.env.SITE_EKRAN, name), fullPage }); }
}
const inside = (page: Page) => page.evaluate(() => !!document.getElementById('mola-yardim')?.contains(document.activeElement));

test('Mola Yardım: answers "gün sonu" and ASCII "odeme", falls back to Destek, shows typed markup as text, asks nothing over the network; Esc closes', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const problems = watch(page);
  await page.goto(`${SITE}/ozellikler/`);
  const fab = page.getByRole('button', { name: 'Mola Yardım' });
  await expect(fab).toBeVisible();
  await expect(fab).toHaveAttribute('aria-expanded', 'false');
  // 68 px picture with "Yardım" beside it on a wide screen.
  await expect(fab.locator('img')).toHaveAttribute('alt', '');
  await expect(fab.locator('.yardim-fab-yazi')).toBeVisible();
  expect(Math.round((await fab.locator('img').boundingBox())!.height)).toBe(68);
  await fab.click();
  const dialog = page.getByRole('dialog', { name: 'Mola Yardım' });
  await expect(dialog).toBeVisible();
  // The page behind is inert while the panel is open: the button is out of reach (and of the accessibility tree).
  await expect(page.locator('.yardim-fab')).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => (document.querySelector('main') as HTMLElement).inert)).toBe(true);
  const box = dialog.getByRole('searchbox', { name: 'Sorunuzu yazın' });
  await expect(box).toBeFocused();
  await expect(box).toHaveAttribute('placeholder', 'Sorunuzu yazın…');
  await expect(dialog.getByRole('heading', { name: 'Sık sorulanlar' })).toBeVisible();
  // A short head: the picture, "Mola Yardım" and ×; no line under the title, none at the bottom.
  await expect(dialog).not.toContainText('hazır cevaplar');
  await expect(dialog).not.toContainText('hiçbir yere gönderilmez');
  await expect(dialog).not.toHaveAttribute('aria-describedby', /./);
  await expect(dialog.locator('.yardim-ust p, .yardim-not')).toHaveCount(0);
  // The topics swipe sideways without a scrollbar under them.
  const chipRow = dialog.getByRole('group', { name: 'Konular' });
  expect(await chipRow.evaluate(e => getComputedStyle(e).scrollbarWidth)).toBe('none');
  expect(await chipRow.evaluate(e => { e.scrollLeft = 120; const moved = e.scrollLeft > 0; e.scrollLeft = 0; return moved; })).toBe(true);
  // Before buying: the website's own questions are there (Fiyatlar, Deneme), never a role-only answer.
  await expect(dialog.getByRole('button', { name: 'Fiyatlar ne kadar?' })).toBeVisible();
  // Everything the panel needs is here now (its picture too): from this point on, no request at all.
  await expect.poll(() => page.evaluate(() => (document.querySelector('.yardim-avatar') as HTMLImageElement | null)?.complete)).toBe(true);
  const requests: string[] = [];
  page.on('request', r => requests.push(r.url()));

  const answer = dialog.locator('.yardim-cevap');
  await box.fill('gün sonu');
  await expect(answer.getByRole('heading', { level: 3 })).toHaveText('Gün sonu nasıl yapılır?');
  await expect(answer).toContainText('“Kapanışı tamamla”ya basın.');
  await expect(answer.locator('ol li')).toHaveCount(4);
  await expect(dialog.getByRole('heading', { name: 'Başka sorular' })).toBeVisible();
  await shot(page, info, 'yardim-masaustu.png');

  await box.fill('odeme');
  await expect(answer.getByRole('heading', { level: 3 })).toHaveText('Ödeme nasıl alınır?');
  await expect(answer).toContainText('“Ödemeyi kaydet”e basın.');

  // Nothing fits: the contact, clearly. The phone stays hidden as everywhere on the site.
  await box.fill('xqzt blorfmak');
  await expect(answer).toBeHidden();
  await expect(dialog.getByText('Bunu bulamadım. Bize ulaşın:')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Destek ve İletişim' })).toHaveAttribute('href', '/iletisim/');
  await expect(dialog.locator('a[href^="mailto:"]')).toHaveAttribute('href', /^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
  await expect(dialog.locator('a[href^="tel:"], a[href*="wa.me"]')).toHaveCount(0);
  await shot(page, info, 'yardim-bulunamadi.png');

  // Typed markup is shown as the letters typed: no element is made from it, nothing runs.
  const payload = '<img src=x onerror=alert(1)>';
  await box.fill(payload);
  await expect(dialog.locator('.yardim-aranan')).toHaveText(`Aradığınız: “${payload}”`);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(dialog.locator('img:not(.yardim-avatar)')).toHaveCount(0);
  await page.waitForTimeout(500);

  // Topics: a chip lists its questions; a question opens its answer and takes the focus (keyboard and screen readers).
  await box.fill('');
  const chip = dialog.getByRole('group', { name: 'Konular' }).getByRole('button', { name: 'Kasa ve ödeme' });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Gün sonu nasıl yapılır?', exact: true }).click();
  await expect(answer).toBeFocused();
  await expect(answer.getByRole('heading', { level: 3 })).toHaveText('Gün sonu nasıl yapılır?');
  await answer.getByRole('button', { name: 'Kasa açılışı nasıl yapılır?' }).click();
  await expect(answer.getByRole('heading', { level: 3 })).toHaveText('Kasa açılışı nasıl yapılır?');
  expect(requests).toEqual([]);

  // Tab and Shift+Tab stay inside the panel.
  await box.focus();
  for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); expect(await inside(page)).toBe(true); }
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Shift+Tab'); expect(await inside(page)).toBe(true); }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(fab).toBeFocused();
  await expect(fab).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(await page.context().cookies()).toEqual([]);
  expect(requests).toEqual([]);
  expect(problems).toEqual([]);
});

test('Mola Yardım on a phone (360 px): the round button, the panel inside the screen, no sideways scroll; closes back to the button', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const problems = watch(page);
  await page.goto(`${SITE}/indir/`);
  const fab = page.getByRole('button', { name: 'Mola Yardım' });
  const b = (await fab.boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(360); expect(b.y + b.height).toBeLessThanOrEqual(780);
  await fab.click();
  const dialog = page.getByRole('dialog', { name: 'Mola Yardım' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Sorunuzu yazın' }).fill('yazici');
  await expect(dialog.locator('.yardim-cevap h3')).toHaveText('Fiş yazıcısını nasıl bağlarım?');
  const p = (await dialog.boundingBox())!;
  expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x + p.width).toBeLessThanOrEqual(360); expect(p.y + p.height).toBeLessThanOrEqual(780);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.waitForTimeout(300);
  await shot(page, info, 'yardim-telefon.png');
  await dialog.getByRole('button', { name: 'Yardımı kapat' }).click();
  await expect(dialog).toBeHidden();
  await expect(fab).toBeFocused();
  expect(problems).toEqual([]);
});

test('Mola Yardım: on the home page too (button and footer link), open on /iletisim/#yardim and from the Destek card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const problems = watch(page);
  await page.goto(`${SITE}/`);
  await expect(page.locator('.yardim-fab')).toBeVisible();
  await page.locator('.site-footer').getByRole('link', { name: 'Mola Yardım' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mola Yardım' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(`${SITE}/`);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.locator('.yardim-fab').click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto(`${SITE}/iletisim/#yardim`);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  const card = page.locator('#yardim');
  await expect(card.getByRole('heading', { name: 'Mola’yı kullanırken takıldınız mı?' })).toBeVisible();
  const open = card.getByRole('button', { name: 'Mola Yardım’ı açın' });
  await open.click();
  await expect(dialog).toBeVisible();
  // Clicking outside the panel closes it too.
  await page.mouse.click(40, 450);
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  expect(problems).toEqual([]);
});

const bubble = (page: Page) => page.locator('.yardim-balon');

test('The speech bubble: once after 20 s on the home page, closes by itself after 6 s, not again in this browser session; no request', async ({ page }, info) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 900 });
  const problems = watch(page);
  await page.goto(`${SITE}/`);
  const fab = page.getByRole('button', { name: 'Mola Yardım' });
  await expect(fab).toBeVisible();
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('seen')));
  const requests: string[] = [];
  page.on('request', r => requests.push(r.url()));
  await page.clock.runFor(19_000);
  await expect(bubble(page)).toHaveCount(0);
  await page.clock.runFor(1_500);
  await expect(bubble(page)).toBeVisible();
  await expect(bubble(page)).toContainText('Yardıma mı ihtiyacınız var?');
  await expect(bubble(page)).toContainText('Sormak istediğiniz bir şey varsa buradan sorabilirsiniz.');
  // Small, above the button, inside the screen.
  const b = (await bubble(page).boundingBox())!, f = (await fab.boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(f.y);
  expect(b.x + b.width).toBeLessThanOrEqual(1280); expect(b.width).toBeLessThanOrEqual(300);
  await page.waitForTimeout(300);
  await shot(page, info, 'yardim-balon-masaustu.png');
  expect(await page.evaluate(() => sessionStorage.getItem('mola-yardim-balon'))).toBe('1');
  await page.clock.runFor(6_500);
  await expect(bubble(page)).toHaveCount(0);
  expect(requests).toEqual([]);
  // Same browser session: not again.
  await page.reload();
  await expect(fab).toBeVisible();
  await page.clock.runFor(30_000);
  await expect(bubble(page)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('The speech bubble on a phone (360 px): small, above the round button, × closes it; the bubble opens the panel', async ({ page }, info) => {
  await page.clock.install();
  await page.setViewportSize({ width: 360, height: 780 });
  const problems = watch(page);
  await page.goto(`${SITE}/`);
  const fab = page.getByRole('button', { name: 'Mola Yardım' });
  await expect(fab).toBeVisible();
  await expect(fab.locator('.yardim-fab-yazi')).toBeHidden();
  expect(Math.round((await fab.boundingBox())!.height)).toBe(64);
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('seen')));
  await page.clock.runFor(20_500);
  await expect(bubble(page)).toBeVisible();
  const b = (await bubble(page).boundingBox())!, f = (await fab.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(16); expect(b.x + b.width).toBeLessThanOrEqual(360 - 16 + 1);
  expect(b.width).toBeLessThanOrEqual(260); expect(b.height).toBeLessThanOrEqual(110);
  expect(b.y + b.height).toBeLessThanOrEqual(f.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.waitForTimeout(300);
  await shot(page, info, 'yardim-balon-telefon.png');
  await bubble(page).getByRole('button', { name: 'Baloncuğu kapat' }).click();
  await expect(bubble(page)).toHaveCount(0);
  // Another visit in a new session: the bubble's words open Mola Yardım.
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${SITE}/ozellikler/`);
  await page.clock.runFor(20_500);
  await bubble(page).getByRole('button', { name: /Yardıma mı ihtiyacınız var/ }).click();
  await expect(page.getByRole('dialog', { name: 'Mola Yardım' })).toBeVisible();
  await expect(bubble(page)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('No speech bubble once the panel was opened, nor while someone fills the İletişim form', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${SITE}/indir/`);
  await page.getByRole('button', { name: 'Mola Yardım' }).click();
  await expect(page.getByRole('dialog', { name: 'Mola Yardım' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.clock.runFor(30_000);
  await expect(bubble(page)).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);

  await page.goto(`${SITE}/iletisim/`);
  await page.locator('#talep-formu [data-field="business"] input').focus();
  await page.keyboard.type('Örnek');
  await page.clock.runFor(30_000);
  await expect(bubble(page)).toHaveCount(0);
});

test('Bilgi ve deneme talebi: no "Masa sayısı" and no intro sentence; Şehir sits beside E-posta (desktop), one column on a phone', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${SITE}/iletisim/`);
  const panel = page.locator('#form');
  await expect(panel.getByRole('heading', { name: 'Bilgi ve deneme talebi' })).toBeVisible();
  await expect(panel).not.toContainText('Kısa bir form');
  await expect(panel.getByLabel(/Masa sayısı/)).toHaveCount(0);
  await expect(page.locator('#talep-formu [name="tables"]')).toHaveCount(0);
  const row = async (field: string) => (await page.locator(`[data-field="${field}"]`).boundingBox())!;
  const [business, person, phone, email, city] = await Promise.all(['business', 'person', 'phone', 'email', 'city'].map(row));
  expect(business.width).toBeGreaterThan(person.width * 1.8); // İşletme adı: the whole row
  expect(Math.abs(person.y - phone.y)).toBeLessThan(2);
  expect(Math.abs(email.y - city.y)).toBeLessThan(2);
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('seen')));
  await panel.screenshot({ path: info.outputPath('iletisim-form.png') });
  if (process.env.SITE_EKRAN) await panel.screenshot({ path: join(process.env.SITE_EKRAN, 'iletisim-form.png') });
  await page.setViewportSize({ width: 360, height: 780 });
  const [e2, c2] = await Promise.all(['email', 'city'].map(row));
  expect(c2.y).toBeGreaterThan(e2.y + e2.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: info.outputPath('iletisim-form-telefon.png') });
  if (process.env.SITE_EKRAN) await panel.screenshot({ path: join(process.env.SITE_EKRAN, 'iletisim-form-telefon.png') });
});
