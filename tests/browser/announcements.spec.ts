import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { confirmStepUp, detailTab, enableAdminFactor, ensureSetup, openBusiness, openYonetim, yonetimGo, yonetimShot, yonetimState } from './helpers';

/*
 * Duyurular and the Mola team's "Yeni mesaj", end to end over the real heartbeat (scripts/test-server.mjs: every 2 s):
 *   Mola Yönetim → işletme → Destek → "Yeni mesaj" → the café's Talepler shows it unread ("Mola ekibi başlattı") → the owner
 *   answers → Mola Yönetim reads the answer;
 *   Duyurular: compose with the Authenticator step-up → the owner's Önemli window and Destek's red dots → "Okudum" →
 *   "Okuyan: 1/1"; a cashier never sees it; no sideways scroll from 360 to 1440 px.
 * Screens: docs/ekran/yonetim (yeni-mesaj, duyurular, duyuru-yaz) and docs/ekran/kafe (duyurular, onemli-duyuru) when
 * YONETIM_EKRAN / KAFE_EKRAN are set, otherwise the test output folder only.
 */
const PASSWORD = 'MolaDemo!2026';
const KAFE_EKRAN = process.env.KAFE_EKRAN;
const sizes = [[360, 800], [390, 844], [768, 1024], [1024, 768], [1280, 860], [1440, 900]] as const;
/** No sideways page scroll and nothing poking out of the right edge (as tests/browser/platform-layout.spec.ts). */
async function fits(page: Page) {
  return page.evaluate(() => {
    const wide = document.documentElement.scrollWidth > innerWidth + 1;
    const out = [...document.querySelectorAll<HTMLElement>('main *, dialog *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !e.closest('.platform-pills, .detail-tabs, .segmented, .pill-tabs'); })
      .slice(0, 5).map(e => `${e.tagName.toLowerCase()}.${e.className}`);
    return wide || out.length ? `taşıyor: ${out.join(', ') || 'sayfa'}` : 'ok';
  });
}
async function cafeShot(page: Page, file: string, path: string) {
  await page.screenshot({ path });
  if (KAFE_EKRAN) { mkdirSync(KAFE_EKRAN, { recursive: true }); await page.screenshot({ path: join(KAFE_EKRAN, file) }); }
}
async function staff(browser: Browser, username: string, width = 1280, height = 860) {
  const context = await browser.newContext({ viewport: { width, height } });
  expect((await context.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await ensureSetup(context.request);
  return context;
}
const businessName = async (page: Page) => (await yonetimState(page.request)).businesses.find((b: any) => b.tenantId === 'mola-demo').name as string;

test('"Yeni mesaj": Mola Yönetim starts a conversation, the café sees it unread in Talepler and answers in the same thread', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openYonetim(page);
  const name = await businessName(page);
  const detail = await openBusiness(page, name);
  await detailTab(detail, 'Destek').click();
  await detail.getByRole('button', { name: 'Yeni mesaj', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Yeni mesaj' });
  await expect(dialog).toContainText(name);
  await expect(dialog.getByRole('button', { name: 'Gönder', exact: true })).toBeDisabled();
  await dialog.getByLabel('Konu').fill('Yıllık aboneliğiniz');
  await dialog.getByLabel('Mesaj').fill('Merhaba, aboneliğiniz ay sonunda bitiyor. Yenilemek ister misiniz? Sorunuz olursa buradan yazabilirsiniz.');
  await yonetimShot(page, 'yeni-mesaj.png', info.outputPath('yeni-mesaj.png'), false);
  await dialog.getByRole('button', { name: 'Gönder', exact: true }).click();
  await expect(dialog).toBeHidden();
  // The new conversation opens in place; the system line says who started it.
  const thread = page.getByRole('region', { name: 'Talep: Yıllık aboneliğiniz' });
  await expect(thread.locator('.tc-system').first()).toContainText('Mola ekibi görüşmeyi başlattı');
  await expect(thread.locator('.tc-row.mine')).toHaveCount(1);
  const ticketId = (await yonetimState(page.request)).tickets.find((t: any) => t.subject === 'Yıllık aboneliğiniz').id as string;

  // The café owner: the bell's red dot (a notice "Mola ekibinden mesaj"; Bildirimler is the bell since 10 Ekim), the ticket
  // unread in Talepler, marked as the Mola team's.
  const owner = await staff(browser, 'isletme');
  try {
    await expect.poll(async () => (await (await owner.request.get('/api/staff/support')).json()).tickets.some((t: any) => t.id === ticketId), { timeout: 30_000 }).toBe(true);
    const cafe = await owner.newPage(); await cafe.goto('/');
    const destek = cafe.locator('.sidebar-bottom').getByRole('button', { name: /Destek/ });
    await expect(cafe.locator('header.topbar .topbar-bell [data-testid="bell-count"]')).toBeVisible({ timeout: 20_000 });
    await destek.click();
    const row = cafe.locator('.tc-item').filter({ hasText: 'Yıllık aboneliğiniz' });
    await expect(row.locator('.tc-dot')).toBeVisible();
    await expect(row.locator('.tc-item-mola')).toHaveText('Mola ekibi başlattı');
    await expect(row.locator('.tc-chip')).toHaveText('Açık');
    await row.click();
    await expect(row.locator('.tc-dot')).toHaveCount(0);
    const cafeThread = cafe.getByRole('region', { name: 'Talep: Yıllık aboneliğiniz' });
    await expect(cafeThread.locator('.tc-system').first()).toContainText('Mola ekibi görüşmeyi başlattı');
    await expect(cafeThread.locator('.tc-row.theirs .tc-sender')).toHaveText('Mola ekibi');
    const box = cafeThread.getByRole('textbox', { name: 'Mesajınız' });
    await box.fill('Evet, yıllık devam edelim. Teşekkürler!'); await box.press('Enter');
    await expect(cafeThread.locator('.tc-row.mine')).toHaveCount(1);
    // Mola Yönetim reads the answer in the same conversation.
    await expect.poll(async () => (await yonetimState(page.request)).tickets.find((t: any) => t.id === ticketId).messages.length, { timeout: 30_000 }).toBe(2);
    await expect(thread.locator('.tc-row.theirs')).toContainText('Evet, yıllık devam edelim.', { timeout: 20_000 });
    await expect(page.locator('.tc-item').filter({ hasText: 'Yıllık aboneliğiniz' }).locator('.tc-chip')).toHaveText('Yanıt bekleniyor');
  } finally { await owner.close(); }
});

test('Duyurular: compose with the step-up, the owner’s Önemli window and red dots, "Okudum" → Okuyan 1/1; cashier never sees it; fits 360–1440', async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openYonetim(page);
  const name = await businessName(page);
  // Two-step login on (every session ends): sending an announcement asks for the Authenticator code.
  await enableAdminFactor(page.request);
  await openYonetim(page);
  await yonetimGo(page, 'Duyurular');
  await expect(page.getByRole('heading', { name: 'Duyurular', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Henüz duyuru göndermediniz' })).toBeVisible();
  await page.getByRole('button', { name: 'Yeni duyuru' }).click();
  const composer = page.getByRole('region', { name: 'Yeni duyuru' });
  await composer.getByLabel('Başlık').fill('Pazar gecesi kısa bakım');
  await composer.getByLabel('Metin').fill('Merhaba,\nPazar gecesi 02:00–02:30 arasında Mola Merkez’de kısa bir bakım yapacağız. Siparişler ve kasa her zamanki gibi çalışır; yalnız destek mesajları bakım bitince gider.\nAyrıntılar: https://mola.example/bakim');
  // No e-mail settings in the test Merkez: no "E-postayla da gönder".
  await expect(composer.getByText('E-postayla da gönder')).toHaveCount(0);
  await composer.getByRole('radio', { name: /Seçili işletmeler/ }).click();
  await composer.getByRole('searchbox', { name: 'Duyuru için işletme ara' }).fill(name);
  // Two demo businesses may share a name: the one of this café by its id.
  await composer.getByRole('list', { name: 'İşletmeler' }).locator('li[data-tenant="mola-demo"]').getByText(name, { exact: true }).click();
  await expect(composer.locator('.ann-summary')).toContainText('1 işletme');
  await composer.getByText('Önemli', { exact: true }).click();
  // The preview is the café's own card.
  const preview = page.getByRole('complementary', { name: 'Önizleme' });
  await expect(preview.getByRole('heading', { name: 'Pazar gecesi kısa bakım' })).toBeVisible();
  await expect(preview.locator('.announcement-chip')).toHaveText('Önemli');
  await expect(preview.getByRole('link', { name: 'https://mola.example/bakim' })).toHaveAttribute('href', 'https://mola.example/bakim');
  await yonetimShot(page, 'duyuru-yaz.png', info.outputPath('duyuru-yaz.png'));
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height }); expect(await fits(page), `duyuru yaz ${width}`).toBe('ok');
    if (width === 390) await page.screenshot({ path: info.outputPath('duyuru-yaz-telefon.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await composer.getByRole('button', { name: 'Duyuruyu gönder' }).click();
  await confirmStepUp(page, 'Duyuruyu gönder');
  await expect(page.locator('.yonetim-column .notice-success').or(page.getByText(/Duyuru 1 işletmeye gönderildi/))).toContainText('Duyuru 1 işletmeye gönderildi');
  const row = page.locator('.ann-row').filter({ hasText: 'Pazar gecesi kısa bakım' });
  await expect(row).toContainText('Okuyan: 0/1');
  await expect(row.locator('.ann-chip.important')).toHaveText('Önemli');

  // The cashier: no Destek, no Duyurular, and the server refuses.
  const cashier = await staff(browser, 'kasiyer');
  const owner = await staff(browser, 'isletme');
  try {
    expect((await cashier.request.get('/api/staff/announcements')).status()).toBe(403);
    await expect.poll(async () => (await (await owner.request.get('/api/staff/announcements')).json()).items.length, { timeout: 30_000 }).toBe(1);
    const till = await cashier.newPage(); await till.goto('/');
    await expect(till.locator('.sidebar nav')).toBeVisible();
    await expect(till.locator('.sidebar').getByRole('button', { name: /^(Destek|Duyurular)/ })).toHaveCount(0);
    await expect(till.getByRole('dialog', { name: 'Mola ekibinden önemli duyuru' })).toHaveCount(0);

    // The owner signs in: the Önemli window, centred; nothing behind it waits.
    const cafe = await owner.newPage(); await cafe.goto('/');
    const window = cafe.getByRole('dialog', { name: 'Mola ekibinden önemli duyuru' });
    await expect(window).toBeVisible();
    await expect(window.getByRole('heading', { name: 'Pazar gecesi kısa bakım' })).toBeVisible();
    await expect(window).toContainText('Siparişler ve kasa her zamanki gibi çalışır');
    await cafeShot(cafe, 'onemli-duyuru.png', info.outputPath('onemli-duyuru.png'));
    await window.getByRole('button', { name: 'Daha sonra' }).click();
    await expect(window).toBeHidden();
    // Destek's red dot and the Duyurular tab's.
    const destek = cafe.locator('.sidebar-bottom').getByRole('button', { name: /Destek/ });
    await expect(destek.locator('.red-dot')).toBeVisible();
    await destek.click();
    const tab = cafe.getByRole('tab', { name: /Duyurular/ });
    await expect(tab.locator('.red-dot')).toBeVisible();
    await tab.click();
    const card = cafe.getByRole('article', { name: 'Pazar gecesi kısa bakım' });
    await expect(card.locator('.announcement-chip')).toHaveText('Önemli');
    await expect(card.locator('.announcement-new')).toHaveText('Yeni');
    await expect(card.getByRole('link', { name: 'https://mola.example/bakim' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Bu konuda Mola ekibine yaz' })).toBeVisible();
    // Opened: read; the dots go.
    await expect(tab.locator('.red-dot')).toHaveCount(0, { timeout: 20_000 });
    await cafeShot(cafe, 'duyurular.png', info.outputPath('kafe-duyurular.png'));
    await card.getByRole('button', { name: 'Okudum' }).click();
    await expect(card).toContainText('Okudunuz');
    // Signing in again: no window any more.
    await cafe.reload();
    await expect(cafe.locator('.sidebar nav')).toBeVisible();
    await cafe.waitForTimeout(1500);
    await expect(window).toHaveCount(0);
    // "Bu konuda Mola ekibine yaz": a new ticket with the subject filled in.
    await destek.click(); await cafe.getByRole('tab', { name: /Duyurular/ }).click();
    await card.getByRole('button', { name: 'Bu konuda Mola ekibine yaz' }).click();
    await expect(cafe.getByRole('form', { name: 'Yeni destek talebi' }).getByLabel(/^Konu/)).toHaveValue('Duyuru: Pazar gecesi kısa bakım');
    // The café's Duyurular on a phone: nothing wider than the screen.
    await cafe.getByRole('tab', { name: /Duyurular/ }).click();
    for (const [width, height] of [[360, 800], [390, 844]] as const) { await cafe.setViewportSize({ width, height }); expect(await fits(cafe), `kafe duyurular ${width}`).toBe('ok'); }
    await cafe.screenshot({ path: info.outputPath('kafe-duyurular-telefon.png'), fullPage: true });

    // Mola Yönetim: "Okuyan: 1/1" and "Okudum diyen: 1/1" with the next heartbeats.
    await expect(row).toContainText('Okuyan: 1/1', { timeout: 40_000 });
    await expect(row).toContainText('Okudum diyen: 1/1');
    await row.getByRole('button', { name: /Pazar gecesi kısa bakım/ }).click();
    await expect(row.getByRole('region', { name: 'Henüz okumayanlar' })).toContainText('Herkes okudu.');
    await expect(row.getByRole('region', { name: 'Okuyanlar' })).toContainText(name);
    await page.mouse.move(0, 0); await page.waitForTimeout(300);
    await yonetimShot(page, 'duyurular.png', info.outputPath('duyurular.png'));
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await yonetimGo(page, 'Duyurular');
      expect(await fits(page), `duyurular ${width}`).toBe('ok');
      if (width === 390 || width === 768) await page.screenshot({ path: info.outputPath(`duyurular-${width}.png`), fullPage: true });
      // The menu: every visible item inside the screen, none cut (Duyurular beside the bell on a phone).
      expect(await page.getByRole('navigation', { name: 'Mola Yönetim bölümleri' }).evaluate(n => [...n.querySelectorAll('button')].filter(b => b.offsetParent !== null).every(b => { const r = b.getBoundingClientRect(), label = b.querySelector('span') as HTMLElement; return r.left >= 0 && r.right <= innerWidth + 0.5 && r.height >= 44 && label.scrollWidth <= label.clientWidth + 1; })), `menü ${width}`).toBe(true);
    }
  } finally { await cashier.close(); await owner.close(); }
});
