import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { MERKEZ } from './helpers';

/*
 * molayazilim.com.tr → Mola Yardım (site/src/assets/yardim.js, questions from yardim.json): hazır cevaplar, no AI, no request
 * while asking, plain text only, keyboard and phone friendly; the button on every page (the home page too) and its speech
 * bubble once a visit (site.js; page.clock stands in for the 20 s). Also the "Bilgi ve deneme talebi" form without "Masa sayısı".
 * 19 Ekim: typos (or "Bunu mu demek istediniz?") and "Videoda izleyin" (YouTube in a new tab, answered locally in the test).
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

  // A short conversation (16 Ekim): the greeting, the topics as quick replies; what is asked on the right, the answer on the
  // left with the small picture; the conversation is a polite live log; the box to type in at the bottom with "Gönder".
  const log = dialog.getByRole('log');
  await expect(log).toHaveAttribute('aria-live', 'polite');
  await expect(log.locator('.yardim-selam')).toHaveText('Merhaba! Ne konuda yardım edeyim?');
  const sendButton = dialog.getByRole('button', { name: 'Gönder' });
  await expect(sendButton).toBeVisible();
  expect((await sendButton.boundingBox())!.y).toBeGreaterThan((await log.boundingBox())!.y + (await log.boundingBox())!.height - 1);
  const answer = dialog.locator('.yardim-cevap').last(), said = dialog.locator('.yardim-sorulan').last();
  const send = async (text: string) => { await box.fill(text); await box.press('Enter'); };
  await send('gün sonu');
  await expect(said).toHaveText('gün sonu');
  await expect(box).toHaveValue('');
  await expect(answer.getByRole('heading', { level: 3 })).toHaveText('Gün sonu nasıl yapılır?');
  await expect(answer).toContainText('“Kapanışı tamamla”ya basın.');
  await expect(answer.locator('ol li')).toHaveCount(4);
  await expect(answer.locator('.yardim-ilgili').filter({ hasText: 'Başka sorular:' })).toBeVisible();
  const p = (await dialog.boundingBox())!, s = (await said.boundingBox())!, a = (await answer.boundingBox())!;
  expect(s.x + s.width).toBeGreaterThan(p.x + p.width - 40); expect(s.x).toBeGreaterThan(a.x);
  await expect(dialog.locator('.yardim-bot').last().locator('img.yardim-avatar-kucuk')).toBeVisible();
  // Colours (16 Ekim): a solid green head with cream letters, Mola Yardım's bubbles light green, the visitor's solid green.
  const colour = (l: typeof answer, prop: 'backgroundColor' | 'color') => l.evaluate((e, k) => getComputedStyle(e)[k], prop);
  expect(await colour(dialog.locator('.yardim-ust'), 'backgroundColor')).toBe('rgb(35, 76, 62)');
  expect(await colour(dialog.locator('.yardim-ust h2'), 'color')).toBe('rgb(246, 241, 232)');
  expect(await colour(answer, 'backgroundColor')).toBe('rgb(230, 239, 231)');
  expect(await colour(said, 'backgroundColor')).toBe('rgb(35, 76, 62)');
  expect(await colour(said, 'color')).toBe('rgb(246, 241, 232)');
  expect(await colour(sendButton, 'backgroundColor')).toBe('rgb(35, 76, 62)');
  await page.waitForTimeout(200);
  await shot(page, info, 'yardim-masaustu.png');

  await box.fill('odeme');
  await sendButton.click();
  await expect(said).toHaveText('odeme');
  await expect(answer.getByRole('heading', { level: 3 })).toHaveText('Ödeme nasıl alınır?');
  await expect(answer).toContainText('“Ödemeyi kaydet”e basın.');
  await expect(box).toBeFocused();

  // Nothing fits: "Bunu bilmiyorum." and the contact, clearly. The phone stays hidden as everywhere on the site.
  await send('xqzt blorfmak');
  const none = dialog.locator('.yardim-yok').last();
  await expect(none).toContainText('Bunu bilmiyorum.');
  await expect(none.getByRole('link', { name: 'Destek ve İletişim' })).toHaveAttribute('href', '/iletisim/');
  await expect(none.locator('a[href^="mailto:"]')).toHaveAttribute('href', /^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
  await expect(dialog.locator('a[href^="tel:"], a[href*="wa.me"]')).toHaveCount(0);
  await page.waitForTimeout(200);
  await shot(page, info, 'yardim-bulunamadi.png');

  // Typed markup is shown as the letters typed: no element is made from it, nothing runs.
  const payload = '<img src=x onerror=alert(1)>';
  await send(payload);
  await expect(said).toHaveText(payload);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(dialog.locator('img:not(.yardim-avatar)')).toHaveCount(0);
  await page.waitForTimeout(500);

  // Topics are quick replies: a chip asks for its questions; a question asked shows its answer; related ones are chips.
  const chip = dialog.getByRole('group', { name: 'Konular' }).getByRole('button', { name: 'Kasa ve ödeme' });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(said).toHaveText('Kasa ve ödeme');
  await dialog.locator('.yardim-bot').last().getByRole('button', { name: 'Gün sonu nasıl yapılır?', exact: true }).click();
  await expect(said).toHaveText('Gün sonu nasıl yapılır?');
  await expect(answer.getByRole('heading', { level: 3 })).toHaveText('Gün sonu nasıl yapılır?');
  await answer.getByRole('button', { name: 'Kasa açılışı nasıl yapılır?' }).click();
  await expect(answer.getByRole('heading', { level: 3 })).toHaveText('Kasa açılışı nasıl yapılır?');
  // The conversation keeps this visit's last six exchanges, newest at the bottom and in sight.
  for (const q of ['yazıcı', 'qr menü', 'yedek', 'mutfak', 'internet', 'garson']) await send(q);
  await expect(dialog.locator('.yardim-kisi')).toHaveCount(6);
  await expect(said).toHaveText('garson');
  await expect(said).toBeInViewport();
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

test('Mola Yardım (390 px, 19 Ekim): a typo still answers, with "Videoda izleyin" opening YouTube in a new tab; in doubt "Bunu mu demek istediniz?"', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const problems = watch(page);
  // YouTube is answered here (nothing leaves the test computer); the popup still opens at the address the link names.
  await page.context().route(/^https:\/\/www\.youtube\.com\//, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>YouTube</title>' }));
  await page.goto(`${SITE}/indir/`);
  await page.getByRole('button', { name: 'Mola Yardım' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mola Yardım' }), box = dialog.getByRole('searchbox', { name: 'Sorunuzu yazın' });
  const send = async (text: string) => { await box.fill(text); await box.press('Enter'); };
  const requests: string[] = [];
  page.on('request', r => requests.push(r.url()));

  // Typos and missing Turkish letters: still the answer, at once.
  await send('giderr nasl kaydedlr');
  const answer = dialog.locator('.yardim-cevap').last();
  await expect(answer.getByRole('heading', { level: 3 })).toHaveText('Ekmek, süt gibi bir gideri nasıl kaydederim?');
  // The video moment under the text: a clear link, YouTube at 2:54, a new tab, no opener.
  const video = answer.getByRole('link', { name: /Videoda izleyin: Kasiyer eğitimi · 2:54/ });
  await expect(video).toBeVisible();
  await expect(video).toContainText('Gider kaydetme');
  await expect(video).toHaveAttribute('href', 'https://www.youtube.com/watch?v=n_JDwbQ7peA&t=174s');
  await expect(video).toHaveAttribute('target', '_blank');
  await expect(video).toHaveAttribute('rel', 'noopener noreferrer');
  // Separate from the text: the answer's own paragraph has no link.
  await expect(answer.locator('p a')).toHaveCount(0);
  const v = (await video.boundingBox())!;
  expect(v.height).toBeGreaterThanOrEqual(44); expect(v.x + v.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests).toEqual([]);
  await answer.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, info, 'yardim-video-telefon.png');
  const [tab] = await Promise.all([page.waitForEvent('popup'), video.click()]);
  await expect.poll(() => tab.url()).toBe('https://www.youtube.com/watch?v=n_JDwbQ7peA&t=174s');
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  await tab.close();
  // The panel stays open where it was.
  await expect(dialog).toBeVisible();

  // The website's own videos: the short introduction for "Mola nedir?".
  await send('Mola nedir?');
  await expect(dialog.locator('.yardim-cevap').last().getByRole('link', { name: /Videoda izleyin: Mola’yı 2 dakikada tanıyın · 0:00/ })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=wpMZdS5dPgw&t=0s');

  // Not sure what was meant: two or three questions to choose from, never a wrong answer.
  requests.length = 0;
  await send('kurulm');
  const guess = dialog.locator('.yardim-tahmin').last();
  await expect(guess).toContainText('Bunu mu demek istediniz?');
  await expect(dialog.locator('.yardim-bot').last().locator('.yardim-cevap')).toHaveCount(0);
  const choices = guess.getByRole('button');
  expect(await choices.count()).toBeGreaterThanOrEqual(2); expect(await choices.count()).toBeLessThanOrEqual(3);
  await expect(guess.getByRole('button', { name: 'Mola’yı bilgisayara nasıl kurarım?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.waitForTimeout(300);
  await shot(page, info, 'yardim-tahmin-telefon.png');
  await guess.getByRole('button', { name: 'Mola’yı bilgisayara nasıl kurarım?' }).click();
  await expect(dialog.locator('.yardim-cevap').last().getByRole('heading', { level: 3 })).toHaveText('Mola’yı bilgisayara nasıl kurarım?');
  await expect(dialog.locator('.yardim-cevap').last().getByRole('link', { name: /Videoda izleyin: Kurulum · 0:08/ })).toBeVisible();
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
  await dialog.getByRole('searchbox', { name: 'Sorunuzu yazın' }).press('Enter');
  await expect(dialog.locator('.yardim-sorulan').last()).toHaveText('yazici');
  await expect(dialog.locator('.yardim-cevap h3').last()).toHaveText('Fiş yazıcısını nasıl bağlarım?');
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

test('Mola Yardım\'s topics in a narrow panel (360 px): › while more is to the right, it shows the last topic, then ‹ and no ›; wheel and keyboard', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const problems = watch(page);
  await page.goto(`${SITE}/indir/`);
  await page.getByRole('button', { name: 'Mola Yardım' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mola Yardım' });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(200);
  await shot(page, info, 'yardim-telefon-acilis.png');
  const row = dialog.getByRole('group', { name: 'Konular' }), back = dialog.getByRole('button', { name: 'Önceki konular' }), next = dialog.getByRole('button', { name: 'Sonraki konular' });
  const last = row.getByRole('button').last();
  await expect(next).toBeVisible(); await expect(back).toBeHidden();
  await expect(next).toHaveAttribute('tabindex', '-1');
  // The clipped edge fades softly.
  expect(await row.evaluate(e => getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage)).toContain('linear-gradient');
  const inRow = async () => { const r = (await row.boundingBox())!, c = (await last.boundingBox())!; return c.x >= r.x - 1 && c.x + c.width <= r.x + r.width + 1; };
  expect(await inRow()).toBe(false);
  for (let i = 0; i < 8 && await next.isVisible(); i++) { await next.click(); await page.waitForTimeout(450); }
  await expect.poll(inRow).toBe(true);
  await expect(next).toBeHidden(); await expect(back).toBeVisible();
  // The arrows never take the focus; the box keeps it.
  await expect(dialog.getByRole('searchbox', { name: 'Sorunuzu yazın' })).toBeFocused();
  await back.click();
  await expect(next).toBeVisible();
  // The keyboard reaches every chip (a focused chip comes into sight); the wheel moves the row sideways.
  await row.getByRole('button').first().focus();
  await expect.poll(() => row.evaluate(e => e.scrollLeft)).toBe(0);
  await expect(back).toBeHidden();
  await row.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => row.evaluate(e => e.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(problems).toEqual([]);
});
