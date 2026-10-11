import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cashAction, ensureSetup, openCash, openReport } from './helpers';

const PASSWORD = 'MolaDemo!2026';
const WIDTHS = [[360, 780], [390, 844], [768, 1024], [820, 1180], [1024, 768], [1280, 860]] as const;
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** Every visible field at least 16 px (iPhone Safari zooms into smaller ones). */
const smallFields = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]),select,textarea')].filter(e => e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.getAttribute('aria-label') ?? e.id));
/** Screens for the owner's guide: also saved to KAFE_EKRAN (docs/ekran/kafe) when that is set. */
async function shot(page: Page, file: string, path: string, fullPage = false) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true }).first()).toBeAttached();
  return page;
}

test('a full cash day: opening float, a sale with a tip, a cashier expense over the limit reaches the owner, blind count, difference note, report and correction', async ({ page, browser }, info) => {
  test.setTimeout(240000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  expect((await page.request.post('/api/staff/cash/settings', { data: { expenseAlert: 20000, differenceNote: 1000 } })).ok()).toBe(true);
  const cashier = await signedIn(browser, 'kasiyer'), waiter = await signedIn(browser, 'garson');
  try {
    // Morning: the opening card above the tables (it never blocks the floor). The very first time nothing is carried.
    const opening = cashier.getByRole('form', { name: 'Kasa açılışı' });
    await expect(opening).toBeVisible();
    await expect(opening).toContainText('İlk açılış');
    // The opening card says it all: no second "Kasa açılmadı" card beside it.
    await expect(cashier.locator('.cash-day')).not.toContainText('Kasa açılmadı');
    await shot(cashier, 'kasa-acilis.png', info.outputPath('kasa-acilis.png'));
    await opening.getByLabel('Açılış tutarı').fill('500');
    await opening.getByRole('button', { name: 'Açılışı kaydet' }).click();
    await expect(cashier.getByRole('status').filter({ hasText: 'Kasa açıldı: ₺500.' })).toBeVisible();
    // The counter's compact Masalar (1280 px): the strip is one chip, "Kasa açık · 08:12'den beri · ₺500".
    const strip = cashier.locator('.cash-chip');
    await expect(strip).toContainText('Kasa açık'); await expect(strip).toContainText('₺500');
    await expect(opening).toHaveCount(0);

    // A sale: 4 teas on Masa 01, paid in cash with a ₺20 tip. The cash handed over follows the tip.
    const order = await waiter.request.post('/api/staff/orders', { data: { requestId: crypto.randomUUID().replace(/-/g, ''), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 4, selections: [] }], expectedTotal: 14000 } });
    expect(order.ok()).toBe(true);
    await cashier.locator('.table-card', { hasText: 'Masa 01' }).click();
    await cashier.getByRole('button', { name: 'Ödeme al' }).click();
    const pay = cashier.getByRole('dialog', { name: 'Masa 01 · Ödeme al' });
    await pay.getByRole('button', { name: '+ Bahşiş ekle' }).click();
    await pay.getByLabel('Bahşiş tutarı').fill('20');
    await expect(pay.getByLabel('Alınan nakit (TL)')).toHaveValue('160');
    await expect(pay.getByText('Bahşiş satışa yazılmaz')).toBeVisible();
    await pay.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
    await expect(cashier.getByRole('status').filter({ hasText: 'Bahşiş: ₺20' })).toBeVisible();

    // The cashier's cash expense above the owner's ₺200 limit.
    await cashAction(cashier, 'Gider kaydet');
    await cashier.getByLabel('Gider tutarı', { exact: true }).fill('250');
    await cashier.getByLabel('Gider açıklaması', { exact: true }).fill('Acil süt alımı');
    // "Para nereden çıktı?": nothing is chosen beforehand; the button waits for it.
    await expect(cashier.getByRole('button', { name: 'Gideri kaydet' })).toBeDisabled();
    await cashier.getByRole('radio', { name: /^Kasadan/ }).click();
    await cashier.getByRole('button', { name: 'Gideri kaydet' }).click();
    await expect(cashier.getByText('Gider kaydedildi.', { exact: true })).toBeVisible();

    // Para bozdurma: the cashier's only cash movement; the owner's cash-out choices are not even offered.
    await cashAction(cashier, 'Para bozdurma');
    const exchange = cashier.getByRole('dialog', { name: 'Para bozdurma' });
    await expect(exchange.getByRole('button', { name: 'Sahip aldı' })).toHaveCount(0);
    await exchange.getByLabel('Hareket tutarı').fill('200');
    await exchange.getByLabel('Hareket açıklaması').fill('200 TL → 10 × 20 TL');
    await exchange.getByRole('button', { name: 'Kaydet', exact: true }).click();
    await expect(cashier.getByRole('status').filter({ hasText: 'Para bozdurma kaydedildi.' })).toBeVisible();
    expect((await cashier.request.post('/api/staff/cash/movements', { data: { requestId: crypto.randomUUID().replace(/-/g, ''), type: 'owner_took', amount: 1000 } })).status()).toBe(403);

    // The owner was told at once, with who, how much and what for.
    const ownerPage = await signedIn(browser, 'isletme');
    await expect(ownerPage.getByTestId('notification-banner-text')).toContainText('Kasiyer gideri sınırı aştı: ₺250');
    await ownerPage.getByRole('button', { name: 'Bildirimleri aç' }).click();
    const inbox = ownerPage.getByRole('region', { name: 'Bildirimler' });
    await expect(inbox).toContainText('Kasiyer gideri sınırı aştı: ₺250');
    await expect(inbox).toContainText('“Acil süt alımı”');

    // Blind count: the expected amount is nowhere on screen before the count is saved.
    await cashier.getByRole('button', { name: 'Masalar', exact: true }).click();
    const dialog = cashier.getByRole('dialog');
    const count = async () => {
      await cashAction(cashier, 'Gün sonu');
      await expect(dialog).toContainText('Sayımınız işletme sahibine iletilir.');
      await expect(dialog.getByText(/Beklenen/)).toHaveCount(0);
      for (const [label, n] of [['200 TL adedi', '1'], ['100 TL adedi', '1'], ['50 TL adedi', '1'], ['20 TL adedi', '2']] as const) await dialog.getByLabel(label, { exact: true }).fill(n);
      await expect(dialog.locator('.cash-counted')).toContainText('₺390');
    };
    // Phones and tablets (the full Masalar with the cash strip, under 900 px): the count fits, no small fields. The counter's
    // compact Masalar (≥ 900 px) holds the cash day in another place, so the count is opened again there.
    await cashier.setViewportSize({ width: WIDTHS[2][0], height: WIDTHS[2][1] });
    await count();
    for (const [width, height] of WIDTHS.slice(0, 3)) { await cashier.setViewportSize({ width, height }); await expect(dialog.locator('.cash-counted')).toContainText('₺390'); expect(await noSideScroll(cashier)).toBe(true); expect(await smallFields(cashier)).toEqual([]); }
    await cashier.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await cashier.setViewportSize({ width: 1280, height: 900 });
    await count();
    await shot(cashier, 'kasa-kapanis-sayim.png', info.outputPath('kasa-kapanis-sayim.png'));
    await dialog.getByRole('button', { name: 'Sayımı kaydet' }).click();
    // Expected: 500 opening + 140 cash sale − 250 expense + 20 tip = 410; counted 390 → −20. The cashier never sees it (owner's
    // decision, 8 Ekim): only what was counted, no "Beklenen", no "Kasa eksik", no note demanded.
    await expect(cashier.getByRole('heading', { name: 'Gün sonu · sonuç' })).toBeVisible();
    await expect(dialog.getByTestId('blind-result')).toContainText('₺390');
    for (const word of [/Beklenen nakit/, /Kasa eksik/, /Kasa fazla/, /₺410/, /Fark yok/]) await expect(dialog.getByText(word)).toHaveCount(0);
    await expect(dialog.locator('.cash-lines-total, .cash-difference.short, .cash-difference.over')).toHaveCount(0);
    await expect(dialog.getByLabel('Kapanış notu')).not.toHaveAttribute('required', '');
    await dialog.getByLabel('Kapanış notu').fill('Para üstünde 20 TL fazla verilmiş olabilir');
    await dialog.getByLabel('Kasada bırakılan').fill('300');
    await expect(dialog).toContainText('Kasadan çıkarılan: ₺90');
    // The strip reads the kasa again every 30 s (now with the waiting count): what was typed stays (it once jumped back to 390).
    await cashier.waitForResponse(r => r.url().includes('/api/staff/cash/status'), { timeout: 45000 });
    await cashier.waitForTimeout(500);
    await expect(dialog.getByLabel('Kasada bırakılan')).toHaveValue('300');
    await dialog.getByLabel('Kasada bırakılan').fill('500');
    await expect(dialog.getByText('Kasada bırakılan, sayılan tutardan (₺390) fazla olamaz.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Kapanışı tamamla' })).toBeDisabled();
    await dialog.getByLabel('Kasada bırakılan').fill('300');
    await shot(cashier, 'kasa-kapanis-sonuc.png', info.outputPath('kasa-kapanis-sonuc.png'));
    await dialog.getByRole('button', { name: 'Kapanışı tamamla' }).click();
    await expect(dialog.getByTestId('blind-result')).toContainText('Gün sonu kaydedildi; sayım işletme sahibine iletildi.');
    await expect(dialog.getByTestId('blind-result')).toContainText('Yarının açılışı: ₺300');
    for (const word of [/Beklenen nakit/, /Kasa eksik/, /₺410/]) await expect(dialog.getByText(word)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'A4 yazdır' })).toBeVisible();    await dialog.getByRole('button', { name: 'Tamam', exact: true }).click();
    await expect(strip).toContainText('Kasa kapandı');
    // Closed: "Gün sonu" is no longer the green main button.
    await strip.click();
    await expect(cashier.getByRole('group', { name: 'Kasa işlemleri' }).getByRole('button', { name: 'Gün sonu' })).not.toHaveClass(/primary/);
    await cashier.keyboard.press('Escape');

    // The owner hears the difference; the report shows the closing, each closer's pattern, and takes a correction.
    const notes = (await (await ownerPage.request.get('/api/staff/notifications')).json()).items.map((n: { title: string }) => n.title);
    expect(notes).toContain('Kasa kapatıldı: fark −₺20');
    // Kasa ve giderler → Kapanışlar (10 Ekim; once Satış ve Raporlar → Para → Kasa kapanışları).
    await openReport(ownerPage, 'Kasa kapanışları');
    await ownerPage.getByRole('button', { name: '7 gün', exact: true }).click();
    const card = ownerPage.locator('.cash-closing-card').first();
    await expect(card).toContainText('Kasiyer'); await expect(card.locator('.cash-badge')).toHaveText('−₺20');
    await expect(ownerPage.locator('.cash-people')).toContainText('1 kez eksik');
    await card.locator('.cash-closing-head').click();
    await expect(card).toContainText('Acil süt alımı'); await expect(card).toContainText('200 TL → 10 × 20 TL');
    await card.getByRole('button', { name: 'Düzeltme ekle' }).click();
    const fix = ownerPage.getByRole('dialog', { name: 'Kapanışa düzeltme ekle' });
    await fix.getByLabel('Düzeltme tutarı').fill('+10');
    await fix.getByLabel('Düzeltme nedeni').fill('Çekmecenin altında 10 TL bulundu');
    await fix.getByRole('button', { name: 'Düzeltmeyi kaydet' }).click();
    await expect(card.locator('.cash-badge')).toHaveText('−₺10');
    await expect(card).toContainText('Çekmecenin altında 10 TL bulundu');
    await shot(ownerPage, 'kasa-kapanislari.png', info.outputPath('kasa-kapanislari.png'), true);
    // No side scrolling anywhere on the way, phones to the café computer.
    for (const [width, height] of WIDTHS) {
      await ownerPage.setViewportSize({ width, height }); expect(await noSideScroll(ownerPage), `report ${width}`).toBe(true);
      await cashier.setViewportSize({ width, height }); expect(await noSideScroll(cashier), `Masalar ${width}`).toBe(true);
    }
    await cashier.setViewportSize({ width: 390, height: 844 });
    await shot(cashier, 'kasa-masalar-telefon.png', info.outputPath('kasa-masalar-telefon.png'));
    // The home's tabs never wider than the page: Kasa ve giderler's five tabs and Giderler's sub-tabs (Kayıtlar · Otomatik
    // giderler) each fit one row on tablets (beside the side menu) and the café computer (or two equal rows, never sideways).
    await openCash(ownerPage, 'Giderler', 'Kayıtlar');
    for (const [width, height] of [[768, 1024], [820, 1180], [1024, 768], [1280, 860]] as const) {
      await ownerPage.setViewportSize({ width, height });
      for (const row of [ownerPage.getByRole('navigation', { name: 'Kasa ve giderler bölümleri', exact: true }), ownerPage.getByRole('navigation', { name: 'Giderler bölümleri', exact: true })]) {
        await expect(row).toHaveClass(/layout-(one|two)/);
        const box = (await row.boundingBox())!; expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await expect(ownerPage.getByRole('navigation', { name: 'Kasa ve giderler bölümleri', exact: true }).getByRole('button', { name: /^Giderler/ })).toHaveAttribute('aria-current', 'page');
      expect(await noSideScroll(ownerPage)).toBe(true);
    }
  } finally {
    await page.request.post('/api/staff/cash/settings', { data: { expenseAlert: null, differenceNote: 5000 } });
    for (const p of [cashier, waiter]) await p.context().close();
  }
});
