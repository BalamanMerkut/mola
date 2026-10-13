import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { ADMIN_API, ensureSetup, openView, openYonetim, yonetimGo, yonetimState } from './helpers';

/*
 * Destek as a chat window (src/TicketChat.tsx) on both sides: the café owner (Destek → Talepler) and Mola Yönetim (Destek).
 * Screens for the owner go to docs/ekran/kafe and docs/ekran/yonetim (destek-sohbet*.png), only when KAFE_EKRAN or
 * YONETIM_EKRAN is set like the other specs; a normal run writes them to the test output folder only.
 */
const owner = !!(process.env.KAFE_EKRAN || process.env.YONETIM_EKRAN);
const KAFE_EKRAN = owner ? 'docs/ekran/kafe' : 'test-results/ekran/kafe', YONETIM_EKRAN = owner ? 'docs/ekran/yonetim' : 'test-results/ekran/yonetim';
const PASSWORD = 'MolaDemo!2026';
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const rect = async (l: Locator) => (await l.boundingBox())!;
async function shot(page: Page, folder: string, file: string, path: string) {
  await page.screenshot({ path });
  mkdirSync(folder, { recursive: true }); await page.screenshot({ path: `${folder}/${file}` });
}
/** Own bubbles hug the right edge of the conversation, the other side's the left edge. */
/** `otherColour`: the other side's bubble colour (white in the café; Mola Yönetim's matte cream, 14 Ekim). */
async function sides(thread: Locator, otherColour = 'rgb(255, 255, 255)') {
  const scroller = await rect(thread.locator('.tc-scroll'));
  const mine = await rect(thread.locator('.tc-row.mine .tc-bubble').last()), theirs = await rect(thread.locator('.tc-row.theirs .tc-bubble').last());
  expect(scroller.x + scroller.width - (mine.x + mine.width)).toBeLessThan(30);
  expect(theirs.x - scroller.x).toBeLessThan(30);
  const colours = await thread.evaluate(t => [...t.querySelectorAll('.tc-row.mine .tc-bubble, .tc-row.theirs .tc-bubble')].slice(-40).map(b => `${b.closest('.tc-row')!.classList.contains('mine') ? 'mine' : 'theirs'}:${getComputedStyle(b).backgroundColor}`));
  expect(colours.filter(c => c.startsWith('theirs:')).every(c => c.endsWith(otherColour))).toBe(true);
  expect(colours.filter(c => c.startsWith('mine:')).every(c => !c.endsWith(otherColour))).toBe(true);
}
async function ownerContext(browser: import('@playwright/test').Browser, username: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  expect((await context.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await ensureSetup(context.request);
  return context;
}
const cafeTickets = async (page: Page) => (await (await page.request.get('/api/staff/support')).json()).tickets as { id: string; subject: string; status: string; messages: { source: string; text: string; queued?: boolean }[] }[];

test('Destek is a chat on both sides: bubbles, day and system lines, retry after a failed send, close, phone screens', async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  const owner = await ownerContext(browser, 'isletme');
  try {
    await openYonetim(page);
    const cafe = await owner.newPage(); await cafe.goto('/');
    await cafe.getByRole('button', { name: 'Destek', exact: true }).click();
    // No ticket yet: the list and a quiet panel (8 Ekim: an always-open form made "Yeni talep" seem to do nothing).
    // "Yeni talep" opens the form with the subject focused; after sending, the new ticket is open.
    const empty = cafe.locator('.tc-main .tc-placeholder');
    await expect(empty.getByRole('heading', { name: 'Henüz destek talebiniz yok' })).toBeVisible();
    await expect(cafe.getByRole('form', { name: 'Yeni destek talebi' })).toHaveCount(0);
    await cafe.waitForTimeout(5500); // a poll of the list does not open the form either
    await expect(cafe.getByRole('form', { name: 'Yeni destek talebi' })).toHaveCount(0);
    await shot(cafe, KAFE_EKRAN, 'destek-talepler.png', info.outputPath('destek-talepler.png'));
    await cafe.locator('.tc-list').getByRole('button', { name: 'Yeni talep', exact: true }).click();
    await expect(cafe.locator('.tc-main').getByRole('heading', { name: 'Yeni destek talebi' })).toBeVisible();
    await expect(cafe.getByLabel('Konu', { exact: false })).toBeFocused();
    // "Vazgeç": the panel again (its own "Yeni talep aç" opens the form too).
    await cafe.getByRole('form', { name: 'Yeni destek talebi' }).getByRole('button', { name: 'Vazgeç' }).click();
    await expect(empty).toBeVisible();
    await empty.getByRole('button', { name: 'Yeni talep aç', exact: true }).click();
    await expect(cafe.getByLabel('Konu', { exact: false })).toBeFocused();
    await cafe.getByLabel('Konu', { exact: false }).fill('Fiş yazıcısı yazdırmıyor');
    await cafe.getByLabel('Sorunu anlatın', { exact: false }).fill('Mutfak fişi çıkmıyor, kasa fişi çıkıyor. Yazıcı açık görünüyor.');
    await cafe.getByRole('button', { name: 'Destek talebi aç', exact: true }).click();
    const cafeThread = cafe.getByRole('region', { name: 'Talep: Fiş yazıcısı yazdırmıyor' });
    await expect(cafeThread.locator('.tc-day')).toHaveText(['Bugün']);
    await expect(cafeThread.locator('.tc-system').first()).toHaveText(/^Talep açıldı · \d\d:\d\d$/);
    await expect(cafeThread.locator('.tc-row.mine')).toHaveCount(1);
    await expect(cafe.locator('.tc-item').filter({ hasText: 'Fiş yazıcısı yazdırmıyor' }).locator('.tc-chip')).toHaveText('Yanıt bekleniyor');
    await expect(cafe.locator('.tc-item').filter({ hasText: 'Fiş yazıcısı yazdırmıyor' }).locator('time')).toHaveText(/^\d\d:\d\d$/);

    // Enter sends, Shift+Enter is a new line; the box empties and the bubble is on the right.
    const box = cafeThread.getByRole('textbox', { name: 'Mesajınız' });
    await expect(box).toBeFocused();
    expect(await box.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    await box.fill('Yazıcının ışığı yanıyor.'); await box.press('Shift+Enter'); await box.pressSequentially('Kağıt da var.');
    await expect(box).toHaveValue('Yazıcının ışığı yanıyor.\nKağıt da var.');
    await box.press('Enter');
    await expect(box).toHaveValue('');
    await expect(cafeThread.locator('.tc-row.mine')).toHaveCount(2);
    await expect(cafeThread.locator('.tc-row.mine').last()).toContainText('Kağıt da var.');

    // A failed send (no answer from the café server): "Gönderilemedi · Tekrar dene"; the retry saves it once.
    await cafe.route('**/api/staff/support/reply', route => route.abort('failed'));
    await box.fill('Bu mesaj ilk denemede gidemedi.'); await cafeThread.getByRole('button', { name: 'Gönder', exact: true }).click();
    await expect(cafeThread.locator('.tc-failed')).toContainText('Gönderilemedi · Tekrar dene');
    await expect(cafeThread.getByRole('button', { name: 'Gönder', exact: true })).toBeDisabled();
    await cafe.unroute('**/api/staff/support/reply');
    await cafeThread.getByRole('button', { name: 'Tekrar dene', exact: true }).click();
    await expect(cafeThread.locator('.tc-failed')).toHaveCount(0);
    await expect(cafeThread.locator('.tc-row.mine')).toHaveCount(3);
    await expect.poll(async () => (await cafeTickets(cafe)).find(t => t.subject === 'Fiş yazıcısı yazdırmıyor')!.messages.filter(m => m.text === 'Bu mesaj ilk denemede gidemedi.').length).toBe(1);
    const ticketId = (await cafeTickets(cafe)).find(t => t.subject === 'Fiş yazıcısı yazdırmıyor')!.id;

    // Mola Yönetim: the ticket arrives with the business name, "Yanıt bekleniyor" and an unread dot.
    await expect.poll(async () => (await yonetimState(page.request)).tickets.find((t: any) => t.id === ticketId)?.messages.length ?? 0, { timeout: 30000 }).toBe(3);
    const business = (await yonetimState(page.request)).businesses.find((b: any) => b.tenantId === 'mola-demo').name as string;
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.reload(); await yonetimGo(page, 'Destek');
    const row = page.locator('.tc-item').filter({ hasText: 'Fiş yazıcısı yazdırmıyor' });
    // 8 Ekim: the business name sits under the card's button (it opens the business preview; support-navigation.spec.ts).
    await expect(page.locator('.tc-items li').filter({ hasText: 'Fiş yazıcısı yazdırmıyor' }).locator('.tc-item-business-line')).toHaveText(business);
    await expect(row.locator('.tc-chip')).toHaveText('Yanıt bekleniyor');
    await expect(row.locator('.tc-item-preview')).toContainText('Bu mesaj ilk denemede gidemedi.');
    await expect(row.locator('.tc-dot')).toBeVisible();
    await row.click();
    await expect(row.locator('.tc-dot')).toHaveCount(0);
    const thread = page.getByRole('region', { name: 'Talep: Fiş yazıcısı yazdırmıyor' });
    await expect(thread.locator('.tc-system').first()).toContainText(`${business} talebi açtı`);
    await expect(thread.locator('.tc-row.theirs')).toHaveCount(3);
    await expect(thread.locator('.tc-row.theirs.first .tc-sender').first()).toHaveText(business);
    await expect(thread.locator('.tc-head')).toContainText(business);
    await expect(thread.locator('.tc-head-extra').getByRole('button', { name: `${business} işletme sayfası` })).toBeVisible();
    const reply = thread.getByRole('textbox', { name: 'Mesajınız' });
    await reply.fill('Merhaba, yazıcı ayarlarında mutfak yazıcısı seçili mi? Ayarlar → Yazıcılar ekranından bakabilir misiniz?');
    await reply.press('Enter');
    await expect(thread.locator('.tc-row.mine')).toHaveCount(1);
    await expect(row.locator('.tc-chip')).toHaveText('Açık');
    await sides(thread, 'rgb(241, 234, 220)');
    // The vendor's send is answered but the answer is lost: the retry does not save it twice.
    await page.route('**/api/merkez/admin/tickets/reply', async route => { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort('failed'); });
    await reply.fill('Bir de yazıcıyı kapatıp açmayı deneyin.'); await reply.press('Enter');
    await expect(thread.locator('.tc-failed')).toContainText('Gönderilemedi · Tekrar dene');
    await page.unroute('**/api/merkez/admin/tickets/reply');
    await thread.getByRole('button', { name: 'Tekrar dene', exact: true }).click();
    await expect(thread.locator('.tc-failed')).toHaveCount(0);
    await expect(thread.locator('.tc-row.mine')).toHaveCount(2);
    expect((await yonetimState(page.request)).tickets.find((t: any) => t.id === ticketId).messages.filter((m: any) => m.text === 'Bir de yazıcıyı kapatıp açmayı deneyin.')).toHaveLength(1);
    expect(await fits(page)).toBe(true);
    await shot(page, YONETIM_EKRAN, 'destek-sohbet.png', info.outputPath('yonetim-destek-sohbet.png'));

    // The café sees the answers arrive in the open conversation (left, "Mola ekibi").
    await expect(cafeThread.locator('.tc-row.theirs')).toHaveCount(2, { timeout: 30000 });
    await expect(cafeThread.locator('.tc-row.theirs .tc-sender').first()).toHaveText('Mola ekibi');
    await sides(cafeThread);
    // Scrolled up when a new answer comes: the place stays and "Yeni mesaj" appears.
    await cafe.setViewportSize({ width: 1280, height: 640 });
    // One message at a time: the next goes once the previous one is saved (its bubble is no longer "Gönderiliyor").
    for (const n of [1, 2, 3]) { await box.fill(`Deneme ${n}: ${'Mutfak yazıcısı hâlâ yazdırmıyor, kasadaki çalışıyor. '.repeat(4)}`); await box.press('Enter'); await expect(cafeThread.locator('.tc-row.mine')).toHaveCount(3 + n); await expect(cafeThread.locator('.tc-bubble.outgoing')).toHaveCount(0); }
    const scroller = cafeThread.locator('.tc-scroll');
    expect(await scroller.evaluate(e => e.scrollHeight > e.clientHeight + 100)).toBe(true);
    await expect.poll(() => scroller.evaluate(e => Math.round(e.scrollHeight - e.scrollTop - e.clientHeight))).toBeLessThan(5);
    await scroller.evaluate(e => { e.scrollTop = 0; e.dispatchEvent(new Event('scroll')); });
    const before = await scroller.evaluate(e => e.scrollTop);
    expect((await page.request.post(`${ADMIN_API}/tickets/reply`, { data: { requestId: `chat-pill-${Date.now()}`, ticketId, text: 'Yeni bir yanıt geldi.' } })).ok()).toBe(true);
    await expect(cafeThread.getByRole('button', { name: 'Yeni mesaj' })).toBeVisible({ timeout: 30000 });
    expect(await scroller.evaluate(e => e.scrollTop)).toBe(before);
    await cafeThread.getByRole('button', { name: 'Yeni mesaj' }).click();
    await expect(cafeThread.getByRole('button', { name: 'Yeni mesaj' })).toHaveCount(0);
    await expect.poll(() => scroller.evaluate(e => Math.round(e.scrollHeight - e.scrollTop - e.clientHeight))).toBeLessThan(5);
    await cafe.setViewportSize({ width: 1280, height: 860 });
    await cafe.evaluate(() => scrollTo(0, 0));
    await expect(cafeThread.locator('.tc-row.theirs').last()).toBeInViewport();
    await shot(cafe, KAFE_EKRAN, 'destek-sohbet.png', info.outputPath('kafe-destek-sohbet.png'));

    // Phones: the list is the first screen; a ticket opens over it with a back arrow.
    for (const [p, folder, name] of [[page, YONETIM_EKRAN, 'yonetim'], [cafe, KAFE_EKRAN, 'kafe']] as const) {
      await p.setViewportSize({ width: 390, height: 844 });
      if (p === page) { await p.reload(); await yonetimGo(p, 'Destek'); await p.getByRole('group', { name: 'Talep durumu' }).getByRole('button', { name: /Tümü/ }).click(); }
      else { await p.reload(); await openView(p, 'Destek'); }
      const list = p.getByRole('complementary', { name: 'Destek talepleri' });
      await expect(list).toBeVisible(); await expect(p.locator('.tc-main')).toBeHidden();
      expect(await fits(p)).toBe(true);
      await shot(p, folder, 'destek-sohbet-telefon-liste.png', info.outputPath(`${name}-destek-sohbet-telefon-liste.png`));
      await p.locator('.tc-item').filter({ hasText: 'Fiş yazıcısı yazdırmıyor' }).click();
      const screen = p.getByRole('region', { name: 'Talep: Fiş yazıcısı yazdırmıyor' });
      await expect(screen.getByRole('button', { name: 'Taleplere dön' })).toBeVisible();
      expect(await rect(p.locator('.tc-main'))).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
      expect(await fits(p)).toBe(true);
      for (const b of await screen.getByRole('button').all()) if (await b.isVisible()) expect((await rect(b)).height, await b.innerText()).toBeGreaterThanOrEqual(44);
      await shot(p, folder, 'destek-sohbet-telefon.png', info.outputPath(`${name}-destek-sohbet-telefon.png`));
      await screen.getByRole('button', { name: 'Taleplere dön' }).click();
      await expect(list).toBeVisible(); await expect(p.locator('.tc-main')).toBeHidden();
    }
    // The café's new ticket form on a phone: its own screen too.
    await cafe.getByRole('button', { name: 'Yeni talep', exact: true }).click();
    await expect(cafe.getByRole('form', { name: 'Yeni destek talebi' })).toBeVisible();
    expect(await rect(cafe.locator('.tc-main'))).toMatchObject({ x: 0, width: 390 });
    await expect(cafe.getByLabel('Konu', { exact: false })).toBeFocused();
    await cafe.getByRole('form', { name: 'Yeni destek talebi' }).getByRole('button', { name: 'Taleplere dön' }).click();
    await expect(cafe.getByRole('form', { name: 'Yeni destek talebi' })).toHaveCount(0);
    await expect(cafe.locator('.tc-list')).toBeVisible();

    // No sideways scrolling anywhere from 360 px to 1280 px; from 900 px the list and the conversation sit side by side.
    for (const width of [360, 390, 768, 820, 1024, 1280]) {
      for (const p of [page, cafe]) {
        await p.setViewportSize({ width, height: width < 700 ? 800 : 900 });
        expect(await fits(p), `${width} liste`).toBe(true);
        await p.locator('.tc-item').filter({ hasText: 'Fiş yazıcısı yazdırmıyor' }).click();
        const open = p.getByRole('region', { name: 'Talep: Fiş yazıcısı yazdırmıyor' });
        await expect(open).toBeVisible();
        expect(await fits(p), `${width} konuşma`).toBe(true);
        const list = await rect(p.locator('.tc-list')), main = await rect(p.locator('.tc-main'));
        if (width >= 900) expect(main.x, `${width} yan yana`).toBeGreaterThanOrEqual(list.x + list.width - 1);
        else { expect(main.width, `${width} tam ekran`).toBe(width); await open.getByRole('button', { name: 'Taleplere dön' }).click(); }
      }
    }
    for (const p of [page, cafe]) await p.setViewportSize({ width: 1280, height: 860 });

    // Close (Mola Yönetim only): a quiet system line; no message box any more, on either side.
    await page.reload(); await yonetimGo(page, 'Destek'); await page.locator('.tc-item').filter({ hasText: 'Fiş yazıcısı yazdırmıyor' }).click();
    await thread.getByRole('button', { name: 'Talebi kapat', exact: true }).click();
    await thread.getByRole('button', { name: 'Evet, kapat', exact: true }).click();
    await expect(thread.locator('.tc-system').last()).toContainText('Talep kapatıldı');
    await expect(thread.getByRole('textbox', { name: 'Mesajınız' })).toHaveCount(0);
    await expect(thread.locator('.tc-closed-note')).toContainText('Bu talep kapandı.');
    await expect(thread.locator('.tc-head .tc-chip')).toHaveText('Kapandı');
    const closed = (await yonetimState(page.request)).tickets.find((t: any) => t.id === ticketId);
    expect(closed.status).toBe('closed'); expect(closed.messages.at(-1).text).toBe('Sorun çözüldü. Destek talebi kapatıldı.');
    await expect(cafeThread.locator('.tc-system').last()).toContainText('Mola ekibi talebi kapattı', { timeout: 30000 });
    await expect(cafeThread.getByRole('textbox', { name: 'Mesajınız' })).toHaveCount(0);
    await expect(cafeThread.getByRole('button', { name: 'Yeni talep aç', exact: true })).toBeVisible();
    await expect(cafe.locator('.tc-item').filter({ hasText: 'Fiş yazıcısı yazdırmıyor' }).locator('.tc-chip')).toHaveText('Kapandı');

    // Closed while the café's message was still on its way: Mola Merkez opens it again ("Talep yeniden açıldı").
    const second = await cafe.request.post('/api/staff/support', { data: { requestId: `chat-second-${Date.now()}`, subject: 'Rapor ekranı yavaş', text: 'Gün sonu raporu geç açılıyor.' } });
    const secondId = (await second.json()).id as string;
    await expect.poll(async () => !!(await yonetimState(page.request)).tickets.find((t: any) => t.id === secondId), { timeout: 30000 }).toBe(true);
    expect((await page.request.post(`${ADMIN_API}/tickets/reply`, { data: { requestId: `chat-close-${Date.now()}`, ticketId: secondId, text: 'Düzeldi, kapatıyorum.', close: true } })).ok()).toBe(true);
    const late = await cafe.request.post('/api/staff/support/reply', { data: { requestId: `chat-late-${Date.now()}`, ticketId: secondId, text: 'Bir sorum daha var.' } });
    if (late.ok()) {
      await expect.poll(async () => (await yonetimState(page.request)).tickets.find((t: any) => t.id === secondId).status, { timeout: 30000 }).toBe('open');
      await page.reload(); await yonetimGo(page, 'Destek'); await page.locator('.tc-item').filter({ hasText: 'Rapor ekranı yavaş' }).click();
      const reopened = page.getByRole('region', { name: 'Talep: Rapor ekranı yavaş' });
      await expect(reopened.locator('.tc-system')).toHaveText([/talebi açtı/, /^Talep kapatıldı/, /^Talep yeniden açıldı/]);
      await expect(reopened.locator('.tc-row.theirs').last()).toContainText('Bir sorum daha var.');
    } else info.annotations.push({ type: 'not', description: 'Kafe kapanışı yanıttan önce öğrendi; "yeniden açıldı" satırı birim testinde denetlendi.' });

  } finally { await owner.close(); }
});

test('a long conversation shows older messages on demand without moving what you read', async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await ownerContext(browser, 'diger');
  try {
    const cafe = await owner.newPage();
    const created = await cafe.request.post('/api/staff/support', { data: { requestId: `chat-long-${Date.now()}`, subject: 'Uzun konuşma', text: 'Mesaj 0' } });
    const id = (await created.json()).id as string;
    for (let i = 1; i <= 70; i++) expect((await cafe.request.post('/api/staff/support/reply', { data: { requestId: `chat-long-${i}-${Date.now()}`, ticketId: id, text: `Mesaj ${i}` } })).ok()).toBe(true);
    await cafe.goto('/'); await cafe.getByRole('button', { name: 'Destek', exact: true }).click();
    await cafe.locator('.tc-item').filter({ hasText: 'Uzun konuşma' }).click();
    const thread = cafe.getByRole('region', { name: 'Talep: Uzun konuşma' }), scroller = thread.locator('.tc-scroll');
    await expect(thread.locator('.tc-row').last()).toContainText('Mesaj 70');
    await expect(thread.locator('.tc-row').last()).toBeInViewport();
    await expect(thread.getByRole('button', { name: 'Önceki mesajları göster' })).toBeAttached();
    await expect(thread.locator('.tc-row').first()).not.toContainText('Mesaj 0');
    // Scrolled to the top: the older ones load above, the message that was first stays where it was on the screen.
    const before = await scroller.evaluate(e => { e.scrollTop = 0; const row = e.querySelector('.tc-row') as HTMLElement; return { label: row.innerText.split('\n')[0], top: row.getBoundingClientRect().top }; });
    await expect(thread.locator('.tc-row').first()).toContainText('Mesaj 0');
    const after = await scroller.evaluate((e, label) => ([...e.querySelectorAll('.tc-row')] as HTMLElement[]).find(r => r.innerText.split('\n')[0] === label)!.getBoundingClientRect().top, before.label);
    expect(Math.abs(after - before.top)).toBeLessThan(4);
    await expect(thread.getByRole('button', { name: 'Önceki mesajları göster' })).toHaveCount(0);
    expect(await scroller.evaluate(e => e.scrollTop)).toBeGreaterThan(100);
  } finally { await owner.close(); }
});

test('attachments both ways: photo thumbnails and full view, PDF cards, refusals, drop, deleted after 14 days', async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  await openYonetim(page);
  const owner = await ownerContext(browser, 'isletme');
  try {
    const cafe = await owner.newPage(); await cafe.goto('/');
    await cafe.getByRole('button', { name: 'Destek', exact: true }).click();
    await cafe.getByRole('button', { name: 'Yeni talep', exact: true }).click();
    const form = cafe.getByRole('form', { name: 'Yeni destek talebi' });
    // A grey "Destek talebi aç" says why it waits.
    await expect(form.getByRole('button', { name: 'Destek talebi aç', exact: true })).toBeDisabled();
    await expect(form.locator('.tc-new-why')).toHaveText('Konuyu yazın (en az 3 harf).');
    await form.getByLabel('Konu', { exact: false }).fill('Ekran donuyor');
    await expect(form.locator('.tc-new-why')).toHaveText('Sorunu birkaç kelimeyle anlatın.');
    await form.getByLabel('Sorunu anlatın', { exact: false }).fill('Fotoğrafını ekledim.');
    const photo = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#2e86de' } }).jpeg().withExif({ IFD0: { Make: 'GizliKamera' } }).toBuffer();
    // Refused before any upload: another type, more than 10 MB.
    await form.locator('input[type=file]').setInputFiles([{ name: 'notlar.txt', mimeType: 'text/plain', buffer: Buffer.from('merhaba') }, { name: 'dev.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(11 * 1024 * 1024) }]);
    await expect(form.getByRole('status')).toContainText('notlar.txt: yalnız fotoğraf ve PDF eklenebilir.');
    await expect(form.getByRole('status')).toContainText('dev.pdf: 10 MB’tan büyük.');
    // Let through by the browser, refused by Mola (not really a photo; a direction mark in its name): the reason beside the
    // button, no pointless "tekrar dene", the name shown as written.
    await form.locator('input[type=file]').setInputFiles({ name: 'fatura‮fdp.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('bu bir fotoğraf değil') });
    const bad = form.locator('.tc-upload.failed');
    await expect(bad).toHaveCount(1, { timeout: 15000 });
    await expect(bad.locator('.tc-upload-name')).toHaveText('faturafdp.jpg');
    await expect(bad.getByRole('button', { name: /tekrar dene/ })).toHaveCount(0);
    await expect(form.locator('.tc-new-why')).toContainText('faturafdp.jpg gönderilemez:');
    await expect(form.locator('.tc-new-why')).toContainText('Mesajı göndermek için eki kaldırın.');
    await expect(form.getByRole('button', { name: 'Destek talebi aç', exact: true })).toBeDisabled();
    await bad.getByRole('button', { name: /kaldır/ }).click();
    await expect(form.locator('.tc-new-why')).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Destek talebi aç', exact: true })).toBeEnabled();
    await form.locator('input[type=file]').setInputFiles({ name: 'ekran.jpg', mimeType: 'image/jpeg', buffer: photo });
    await expect(form.locator('.tc-upload.done')).toHaveCount(1, { timeout: 15000 });
    await expect(form.locator('.tc-upload')).toContainText('ekran.jpg');
    await form.getByRole('button', { name: 'Destek talebi aç', exact: true }).click();
    const cafeThread = cafe.getByRole('region', { name: 'Talep: Ekran donuyor' });
    const thumb = cafeThread.locator('.tc-row.mine .tc-thumb img');
    await expect(thumb).toHaveCount(1);
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    expect(await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeLessThanOrEqual(480);

    // Mola Yönetim sees the photo (thumbnail, then full size), answers with a PDF dropped on the conversation.
    const ticketId = (await cafeTickets(cafe)).find(t => t.subject === 'Ekran donuyor')!.id;
    await expect.poll(async () => (await yonetimState(page.request)).tickets.find((t: any) => t.id === ticketId)?.messages[0]?.attachments?.length ?? 0, { timeout: 90000 }).toBe(1);
    await page.setViewportSize({ width: 1280, height: 860 }); await page.reload(); await yonetimGo(page, 'Destek');
    await page.locator('.tc-item').filter({ hasText: 'Ekran donuyor' }).click();
    const thread = page.getByRole('region', { name: 'Talep: Ekran donuyor' });
    await thread.locator('.tc-row.theirs .tc-thumb').click();
    const full = page.getByRole('dialog', { name: 'ekran.webp' });
    await expect(full).toBeVisible();
    await expect.poll(() => full.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2000);
    await page.keyboard.press('Escape'); await expect(full).toHaveCount(0);
    await expect(thread).toBeVisible();
    // Mola Yönetim's box: a refused file says why next to "Gönder" (and offers only "kaldır").
    await thread.locator('input[type=file]').setInputFiles({ name: 'bozuk.png', mimeType: 'image/png', buffer: Buffer.from('<html>değil</html>') });
    await expect(thread.locator('.tc-upload.failed')).toHaveCount(1, { timeout: 15000 });
    await expect(thread.locator('.tc-send-why')).toContainText('bozuk.png gönderilemez:');
    await expect(thread.locator('.tc-upload.failed').getByRole('button', { name: /tekrar dene/ })).toHaveCount(0);
    await expect(thread.getByRole('button', { name: 'Gönder', exact: true })).toBeDisabled();
    await thread.locator('.tc-upload.failed').getByRole('button', { name: /kaldır/ }).click();
    await expect(thread.locator('.tc-send-why')).toHaveCount(0);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');
    await thread.evaluate((el, bytes) => {
      const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'Kurulum adımları.pdf', { type: 'application/pdf' }));
      for (const type of ['dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
    }, [...pdf]);
    await expect(thread.locator('.tc-upload.done')).toHaveCount(1, { timeout: 15000 });
    await thread.getByRole('textbox', { name: 'Mesajınız' }).fill('Adımlar ekte.');
    await thread.getByRole('button', { name: 'Gönder', exact: true }).click();
    const card = thread.locator('.tc-row.mine .tc-doc');
    await expect(card).toContainText('Kurulum adımları.pdf');
    await expect(thread.locator('.tc-uploads')).toHaveCount(0);
    mkdirSync(YONETIM_EKRAN, { recursive: true }); await page.screenshot({ path: `${YONETIM_EKRAN}/destek-ekler.png` }); await page.screenshot({ path: info.outputPath('yonetim-destek-ekler.png') });

    // The café gets the PDF as a card it can download.
    const cafeCard = cafeThread.locator('.tc-row.theirs .tc-doc');
    await expect(cafeCard).toContainText('Kurulum adımları.pdf', { timeout: 90000 });
    const download = await cafe.request.get(await cafeCard.getAttribute('href') as string);
    expect(download.status()).toBe(200); expect((await download.body()).subarray(0, 5).toString()).toBe('%PDF-');
    await cafe.evaluate(() => scrollTo(0, 0));
    mkdirSync(KAFE_EKRAN, { recursive: true }); await cafe.screenshot({ path: `${KAFE_EKRAN}/destek-ekler.png` }); await cafe.screenshot({ path: info.outputPath('kafe-destek-ekler.png') });
    // 15 days later (this browser's clock): the files are gone, the messages keep a grey line.
    await cafe.clock.setFixedTime(new Date(Date.now() + 15 * 86_400_000));
    await expect(cafeThread.locator('.tc-file-gone')).toHaveCount(2, { timeout: 15000 });
    await expect(cafeThread.locator('.tc-file-gone').first()).toHaveText('Ek silindi (14 gün)');
  } finally { await owner.close(); }
});