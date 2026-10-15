import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { MERKEZ } from './helpers';

/*
 * molayazilim.com.tr → Mola Yardım (site/src/assets/yardim.js, questions from yardim.json): hazır cevaplar, no AI, no request
 * while asking, plain text only, keyboard and phone friendly. Also the "Bilgi ve deneme talebi" form without "Masa sayısı".
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
  await expect(fab.locator('img')).toHaveAttribute('alt', 'Mola Yardım');
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
  await expect(dialog).toContainText('Bu yardımcı yalnız hazır cevaplar gösterir; yazdıklarınız hiçbir yere gönderilmez.');
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

test('Mola Yardım: not on the home page (a footer link opens it there), open on /iletisim/#yardim and from the Destek card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const problems = watch(page);
  await page.goto(`${SITE}/`);
  await expect(page.locator('.yardim-fab')).toHaveCount(0);
  await page.locator('.site-footer').getByRole('link', { name: 'Mola Yardım' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mola Yardım' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(`${SITE}/`);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

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
