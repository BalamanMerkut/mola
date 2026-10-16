import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureSetup, openView } from './helpers';

/*
 * Mola Yardım in the café app (src/HelpPanel.tsx; the same questions as the website, site/src/assets/yardim.json), a short
 * conversation since 16 Ekim: the greeting, the topics as quick replies, what is asked on the right, the answer on the left.
 * - the owner: Destek → Yardım and the eagle "Yardım" pill beside the bell (src/HelpButton.tsx) with its one-time hint; the
 *   screen's topic first; nothing found → "Bunu bilmiyorum." and "Destek talebi aç" (Destek → Talepler, question written in);
 * - the waiter (phone) and the kitchen (its bar): only the eagle, no hint, their own answers (a refund is the cashier's), no
 *   floating button, nothing that pops up by itself, "İşletme sahibinize sorun." when nothing fits;
 * - the topic row: ‹ › for a mouse when it overflows;
 * - asking sends nothing: no request but the screen's usual polling, and never the typed words.
 * The hint is off on the test devices (playwright.config.ts: mola-yardim-ipucu = off); the hint test starts with an empty one.
 * Screens also go to $env:KAFE_EKRAN (e.g. docs/ekran/kafe): mola-yardim-destek.png, -sahip.png, -ust-cubuk.png, -ipucu.png,
 * -garson.png, -mutfak.png.
 */
const PASSWORD = 'MolaDemo!2026';
async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(name) });
  if (process.env.KAFE_EKRAN) { mkdirSync(process.env.KAFE_EKRAN, { recursive: true }); await page.screenshot({ path: join(process.env.KAFE_EKRAN, name) }); }
}
async function signedIn(browser: Browser, username: string, viewport: { width: number; height: number }, freshDevice = false) {
  const context = await browser.newContext({ viewport, ...(freshDevice ? { storageState: { cookies: [], origins: [] } } : {}) });
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
/** Types a question and sends it (Enter), as in a chat. */
async function ask(page: Page, text: string, where = sheet(page)) {
  await where.getByRole('searchbox', { name: 'Sorunuzu yazın' }).fill(text);
  await where.getByRole('searchbox', { name: 'Sorunuzu yazın' }).press('Enter');
}
const lastAnswer = (page: Page, where = sheet(page)) => where.locator('.help-answer').last();
const lastSaid = (where: ReturnType<typeof sheet>) => where.locator('.help-msg.mine .help-said').last();

test('the owner: the eagle "Yardım" pill and Destek → Yardım, a conversation; the screen\'s topic first; nothing found opens a prefilled ticket', async ({ browser }, info) => {
  const page = await signedIn(browser, 'isletme', { width: 1280, height: 860 });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const bar = page.locator('header.topbar'), help = bar.getByRole('button', { name: 'Mola Yardım' });
  await expect(help).toBeVisible();
  // The pill: the eagle and "Yardım", inside the bar, beside the bell; solid green so it stands out.
  await expect(help.locator('img')).toHaveAttribute('alt', '');
  await expect(help.locator('.topbar-help-text')).toHaveText('Yardım'); await expect(help.locator('.topbar-help-text')).toBeVisible();
  await expect(bar.getByRole('button', { name: /^Bildirimler/ })).toBeVisible();
  const hb = (await help.boundingBox())!, tb = (await bar.boundingBox())!;
  expect(hb.y).toBeGreaterThanOrEqual(tb.y); expect(hb.y + hb.height).toBeLessThanOrEqual(tb.y + tb.height);
  // Nothing floats or pops up by itself (the hint is off on this test device).
  await expect(page.locator('.yardim-fab, .yardim-balon, .help-hint')).toHaveCount(0);
  await bar.screenshot({ path: info.outputPath('mola-yardim-ust-cubuk.png') });
  if (process.env.KAFE_EKRAN) await bar.screenshot({ path: join(process.env.KAFE_EKRAN, 'mola-yardim-ust-cubuk.png') });

  // Destek → Yardım (after Mola desteği).
  await openView(page, 'Destek');
  const tabs = page.getByRole('tablist', { name: 'Destek bölümleri' });
  await expect(tabs.getByRole('tab')).toHaveText(['Talepler', 'Duyurular', 'Mola desteği', 'Yardım']);
  await tabs.getByRole('tab', { name: 'Yardım' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Yardım' });
  await expect(panel.getByText('Merhaba! Ne konuda yardım edeyim?')).toBeVisible();
  await ask(page, 'gün sonu', panel as ReturnType<typeof sheet>);
  await expect(lastSaid(panel as ReturnType<typeof sheet>)).toHaveText('gün sonu');
  await expect(lastAnswer(page, panel as ReturnType<typeof sheet>).locator('h3')).toHaveText('Gün sonu nasıl yapılır?');
  await expect(lastAnswer(page, panel as ReturnType<typeof sheet>).locator('ol li')).toHaveCount(4);
  await shot(page, info, 'mola-yardim-destek.png');
  // The website's own questions (prices, trial) are not in the app.
  await ask(page, 'fiyatlar ne kadar', panel as ReturnType<typeof sheet>);
  await expect(panel).not.toContainText('Fiyatlar ne kadar?');

  // Kasa ve giderler → Mola Yardım: the greeting, the topics as quick replies, Kasa ve ödeme first.
  await openView(page, 'Kasa ve giderler');
  await help.click();
  await expect(sheet(page)).toBeVisible();
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await expect(searchBox(page)).toBeFocused();
  await expect(searchBox(page)).toHaveAttribute('placeholder', 'Sorunuzu yazın…');
  await expect(sheet(page).getByRole('button', { name: 'Gönder' })).toBeVisible();
  const log = sheet(page).getByRole('log');
  await expect(log).toHaveAttribute('aria-live', 'polite');
  await expect(log.locator('.help-hello')).toHaveText('Merhaba! Ne konuda yardım edeyim?');
  await expect(sheet(page).locator('.help-list h3').first()).toHaveText('Bu ekran: Kasa ve ödeme');
  await expect(sheet(page).getByRole('button', { name: 'Ödeme nasıl alınır?' })).toBeVisible();
  // The topic chips: one row that swipes, no scrollbar.
  expect(await sheet(page).getByRole('group', { name: 'Konular' }).evaluate(e => getComputedStyle(e).scrollbarWidth)).toBe('none');
  await expect(sheet(page).locator('img').first()).toHaveJSProperty('complete', true);
  await page.waitForTimeout(300);
  await shot(page, info, 'mola-yardim-acilis.png');

  const words = ['iade', 'xqzt blorfmak', '<img src=x onerror=alert(1)>'], net = watchRequests(page, words);
  // Typed and sent: on the right; the answer on the left with the small picture.
  await ask(page, 'iade');
  await expect(lastSaid(sheet(page))).toHaveText('iade');
  const said = (await lastSaid(sheet(page)).boundingBox())!, answer = (await lastAnswer(page).boundingBox())!, s = (await sheet(page).boundingBox())!;
  expect(said.x + said.width).toBeGreaterThan(s.x + s.width - 30); expect(said.x).toBeGreaterThan(answer.x);
  await expect(lastAnswer(page).locator('h3')).toHaveText('Müşteriye iade nasıl yapılır?');
  await expect(lastAnswer(page)).toContainText('Kasa çipinden “İade”ye basın');
  await expect(sheet(page).locator('.help-msg.bot').last().locator('img.help-msg-avatar')).toBeVisible();
  await expect(searchBox(page)).toHaveValue('');
  await page.waitForTimeout(300);
  await shot(page, info, 'mola-yardim-sahip.png');

  // A related question as a chip under the answer.
  const related = lastAnswer(page).locator('.help-related button').first(), relatedText = await related.textContent();
  await related.click();
  await expect(lastSaid(sheet(page))).toHaveText(relatedText!);
  await expect(lastAnswer(page).locator('h3')).toHaveText(relatedText!);
  // Typed markup stays the letters typed.
  await ask(page, '<img src=x onerror=alert(1)>');
  await expect(lastSaid(sheet(page))).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('img[src="x"]')).toHaveCount(0);

  // Nothing fits: "Bunu bilmiyorum." and "Destek talebi aç" (the owner writes to the Mola team).
  await ask(page, 'xqzt blorfmak');
  const none = sheet(page).locator('.help-none').last();
  await expect(none).toContainText('Bunu bilmiyorum.');
  await expect(lastSaid(sheet(page))).toHaveText('xqzt blorfmak');
  // The conversation keeps the last six exchanges.
  for (const q of ['kasa açılışı', 'yazıcı', 'menü', 'masa taşıma', 'şifre', 'gün sonu']) await ask(page, q);
  await expect(sheet(page).locator('.help-exchange')).toHaveCount(6);
  await page.waitForTimeout(1500);
  expect(net.bad).toEqual([]);
  await ask(page, 'xqzt blorfmak');
  await sheet(page).locator('.help-none').last().getByRole('button', { name: 'Destek talebi aç' }).click();
  await expect(sheet(page)).toHaveCount(0);
  const form = page.getByRole('form', { name: 'Yeni destek talebi' });
  await expect(form).toBeVisible();
  await expect(form.locator('input').first()).toHaveValue('xqzt blorfmak');
  await expect(form.locator('textarea')).toHaveValue('xqzt blorfmak');
  await expect(tabs.getByRole('tab', { name: 'Talepler' })).toHaveAttribute('aria-selected', 'true');

  // Esc closes the sheet and gives the focus back to the button.
  await help.click();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(help).toBeFocused();
  expect(errors).toEqual([]);
  await page.context().close();
});

test('the topic row in a narrow sheet: › while more is to the right, it shows the last topic, then ‹ and no ›', async ({ browser }) => {
  const page = await signedIn(browser, 'isletme', { width: 390, height: 844 });
  await page.locator('header.topbar').getByRole('button', { name: 'Mola Yardım' }).click();
  await expect(sheet(page)).toBeVisible();
  const row = sheet(page).getByRole('group', { name: 'Konular' }), back = sheet(page).getByRole('button', { name: 'Önceki konular' }), next = sheet(page).getByRole('button', { name: 'Sonraki konular' });
  const last = row.getByRole('button').last();
  await expect(next).toBeVisible(); await expect(back).toBeHidden();
  await expect(next).toHaveAttribute('tabindex', '-1');
  const inRow = async () => { const r = (await row.boundingBox())!, c = (await last.boundingBox())!; return c.x >= r.x - 1 && c.x + c.width <= r.x + r.width + 1; };
  expect(await inRow()).toBe(false);
  for (let i = 0; i < 8 && await next.isVisible(); i++) { await next.click(); await page.waitForTimeout(450); }
  await expect.poll(inRow).toBe(true);
  await expect(next).toBeHidden(); await expect(back).toBeVisible();
  // The wheel over the row moves it sideways; the keyboard reaches every chip (the first one comes back into sight).
  await row.getByRole('button').first().focus();
  await expect.poll(async () => (await row.evaluate(e => e.scrollLeft))).toBe(0);
  await expect(back).toBeHidden();
  await row.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await row.evaluate(e => e.scrollLeft))).toBeGreaterThan(0);
  await page.context().close();
});

test('the one-time hint: once for the owner after signing in on a new device, closes by itself; never for the waiter or the kitchen', async ({ browser }, info) => {
  const page = await signedIn(browser, 'isletme', { width: 1280, height: 860 }, true);
  const hint = page.locator('.help-hint');
  await expect(hint).toBeVisible({ timeout: 8000 });
  await expect(hint).toContainText('Takıldığınız yerde bana sorabilirsiniz.');
  await expect(hint).toHaveAttribute('role', 'status');
  const h = (await hint.boundingBox())!, b = (await page.locator('header.topbar').getByRole('button', { name: 'Mola Yardım' }).boundingBox())!;
  expect(h.y).toBeGreaterThanOrEqual(b.y + b.height); expect(h.x + h.width).toBeLessThanOrEqual(1280);
  await shot(page, info, 'mola-yardim-ipucu.png');
  await expect(hint).toHaveCount(0, { timeout: 8000 });
  // Remembered for this user on this device: not again after a reload.
  await page.reload();
  await page.waitForTimeout(4000);
  await expect(hint).toHaveCount(0);
  // × closes it (another fresh device).
  const again = await signedIn(browser, 'isletme', { width: 1280, height: 860 }, true);
  await again.locator('.help-hint').getByRole('button', { name: 'İpucunu kapat' }).click({ timeout: 8000 });
  await expect(again.locator('.help-hint')).toHaveCount(0);
  await again.context().close();
  for (const [user, viewport] of [['garson', { width: 390, height: 844 }], ['mutfak', { width: 1280, height: 800 }]] as const) {
    const other = await signedIn(browser, user, viewport, true);
    await expect(other.getByRole('button', { name: 'Mola Yardım' })).toBeVisible();
    await other.waitForTimeout(4500);
    await expect(other.locator('.help-hint')).toHaveCount(0);
    await other.context().close();
  }
  await page.context().close();
});

test('the waiter\'s phone: only the eagle, the waiter\'s own answers, no pop-ups; nothing found: ask the owner', async ({ browser }, info) => {
  const page = await signedIn(browser, 'garson', { width: 390, height: 844 });
  const help = page.locator('header.topbar').getByRole('button', { name: 'Mola Yardım' });
  await expect(help).toBeVisible();
  await expect(help.locator('.topbar-help-text')).toHaveCount(0);
  await expect(page.locator('.support-nav:visible')).toHaveCount(0);
  await page.waitForTimeout(2500);
  await expect(page.locator('.yardim-fab, .yardim-balon, .help-hint, dialog[open]')).toHaveCount(0);
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
  await ask(page, 'iade');
  await expect(lastAnswer(page).locator('h3')).toHaveText('Müşteri para iadesi istiyor.');
  await expect(lastAnswer(page)).toContainText('İadeyi kasiyer ya da işletme sahibi yapar.');
  await expect(sheet(page)).not.toContainText('Kasa çipinden');
  await expect(sheet(page)).not.toContainText('Müşteriye iade nasıl yapılır?');
  await page.waitForTimeout(300);
  await shot(page, info, 'mola-yardim-garson.png');
  await ask(page, 'kafemi yönet');
  await expect(sheet(page)).not.toContainText('Kafemi yönet’i');
  await ask(page, 'xqzt blorfmak');
  const none = sheet(page).locator('.help-none').last();
  await expect(none).toContainText('Bunu bilmiyorum.');
  await expect(none).toContainText('İşletme sahibinize sorun.');
  await expect(sheet(page).getByRole('button', { name: 'Destek talebi aç' })).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(net.bad).toEqual([]);
  await sheet(page).getByRole('button', { name: 'Yardımı kapat' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await page.context().close();
});

test('the kitchen: the eagle on its bar only, kitchen answers first (Mutfak ve fiş), no cashier steps', async ({ browser }, info) => {
  const page = await signedIn(browser, 'mutfak', { width: 1280, height: 800 });
  const bar = page.locator('.kitchen-bar');
  const help = bar.getByRole('button', { name: 'Mola Yardım' });
  await expect(help).toBeVisible();
  await expect(help.locator('.topbar-help-text')).toHaveCount(0);
  await page.waitForTimeout(2500);
  await expect(page.locator('.yardim-fab, .yardim-balon, .help-hint, dialog[open], header.topbar')).toHaveCount(0);
  await bar.screenshot({ path: info.outputPath('mutfak-cubugu.png') });
  await help.click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('.help-list h3').first()).toHaveText('Bu ekran: Mutfak ve fiş');
  await expect(sheet(page).getByRole('button', { name: 'Mutfak ekranı nasıl kullanılır?' })).toBeVisible();
  const net = watchRequests(page, ['fiş modu', 'gün sonu']);
  await ask(page, 'fiş modu');
  await expect(lastAnswer(page).locator('h3')).toHaveText('Fiş modunda nasıl çalışılır?');
  await ask(page, 'gün sonu');
  await expect(sheet(page)).not.toContainText('Gün sonu nasıl yapılır?');
  await sheet(page).getByRole('group', { name: 'Konular' }).getByRole('button', { name: 'Mutfak ve fiş' }).click();
  await expect(lastSaid(sheet(page))).toHaveText('Mutfak ve fiş');
  await sheet(page).locator('.help-exchange').last().getByRole('button', { name: 'Mutfakta iptal ve değişiklik nasıl görünür?' }).click();
  await expect(lastAnswer(page).locator('h3')).toHaveText('Mutfakta iptal ve değişiklik nasıl görünür?');
  await page.waitForTimeout(300);
  await shot(page, info, 'mola-yardim-mutfak.png');
  await page.waitForTimeout(1000);
  expect(net.bad).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await page.context().close();
});
