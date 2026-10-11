import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cashAction, ensureSetup, openReport, openView } from './helpers';

/*
 * The owner's first real day (8 Ekim), on the screens: sales ₺1.120 (cash ₺410, card ₺710) in 4 orders, POS %2,5, a card
 * refund of 1 × Caffè Latte ₺140, "Stok alışı: Kahve 10 kg" ₺467 by the owner (asked where the money came from), "süt aldık"
 * ₺500 by the cashier (Kasadan), a para bozdurma ₺200, opening ₺0, counted ₺2.895. Screens (KAFE_EKRAN=docs/ekran/kafe):
 * gider-kaynak.png, gun-sonu-kasiyer.png, gun-sonu-sahip.png, rapor-elde-kalan.png.
 */
const PASSWORD = 'MolaDemo!2026';
const rid = () => crypto.randomUUID().replace(/-/g, '');
async function shot(page: Page, file: string, path: string, fullPage = false) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
// A new device: Satış ve Raporlar opens on the plain summary.
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true }).first()).toBeAttached();
  return page;
}

test('the owner\'s day: source of cash expenses, a blind gün sonu for the cashier, the owner\'s full picture and the Elde kalan breakdown', async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  expect((await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: 250 } })).ok()).toBe(true);
  const cashier = await signedIn(browser, 'kasiyer'), waiter = await signedIn(browser, 'garson'), owner = await signedIn(browser, 'isletme');
  try {
    expect((await cashier.request.post('/api/staff/cash/open', { data: { requestId: rid(), amount: 0 } })).ok()).toBe(true);
    // Four bills: card ₺470 (2 × Caffè Latte + San Sebastian) and ₺240 (2 × Limonata); cash ₺190 and ₺220.
    const size = [{ groupId: 'size', optionId: 'regular' }];
    const bills: [string, { productId: string; quantity: number; selections: typeof size | [] }[], number, 'cash' | 'card'][] = [
      ['table-1', [{ productId: 'latte', quantity: 2, selections: size }, { productId: 'cheesecake', quantity: 1, selections: [] }], 47000, 'card'],
      ['table-2', [{ productId: 'lemonade', quantity: 2, selections: [] }], 24000, 'card'],
      ['table-3', [{ productId: 'cheesecake', quantity: 1, selections: [] }], 19000, 'cash'],
      ['table-4', [{ productId: 'americano', quantity: 2, selections: size }], 22000, 'cash'],
    ];
    for (const [tableId, lines, total, method] of bills) {
      const placed = await waiter.request.post('/api/staff/orders', { data: { requestId: rid(), tableId, lines, expectedTotal: total } });
      expect(placed.ok(), await placed.text()).toBe(true);
      const account = (await (await cashier.request.get('/api/staff/state')).json()).tables.find((t: { id: string }) => t.id === tableId).account;
      expect((await cashier.request.post('/api/staff/payments', { data: { requestId: rid(), accountId: account.id, version: account.version, method, amount: total, tendered: total } })).ok()).toBe(true);
    }

    // The owner buys 10 kg coffee for ₺467, "Kasadan nakit": the drawer holds ₺410, so Mola asks where the money came from.
    const item = await (await owner.request.post('/api/staff/stock/items', { data: { name: 'Kahve', unit: 'g', initial: 0 } })).json();
    expect(item.item?.id).toBeTruthy();
    await openView(owner, 'Stok');
    await owner.getByRole('navigation', { name: 'Stok bölümleri' }).getByRole('button', { name: /^Alış ve sayım/ }).click();
    await owner.getByRole('button', { name: /^Alış kaydet/ }).click();
    const buy = owner.getByRole('dialog', { name: 'Alış kaydet' });
    await buy.getByLabel('Malzeme *').selectOption({ label: 'Kahve' });
    await buy.getByLabel('Alınan miktar *', { exact: true }).fill('10');
    await buy.getByLabel('Toplam tutar (TL)').fill('467');
    // 9 Ekim K-K: "Para nereden çıktı?" (no box to forget, nothing chosen beforehand) — Kasadan.
    await buy.getByRole('radio', { name: /^Kasadan/ }).click();
    // A short amber note right under the question before saving; no second set of buttons (the answer was just chosen).
    const asked = buy.getByTestId('below-zero');
    await expect(asked).toHaveText('Kasada şu an ₺410 görünüyor; bu çıkışla −₺57 olur. Para kasadan çıkmadıysa “Kasa dışından”ı seçin.');
    for (const old of ['Kasa dışından (cepten / bankadan)', 'Kasadan, yine de kaydet', 'Başka yöntem seç']) await expect(buy.getByRole('button', { name: old })).toHaveCount(0);
    await shot(owner, 'gider-kaynak.png', info.outputPath('gider-kaynak.png'));
    // That day it was entered as from the drawer: the one "Alışı kaydet" saves it as chosen.
    await buy.getByRole('button', { name: 'Alışı kaydet' }).click();
    await expect(owner.getByText('Kahve: 10 kg alış kaydedildi. Gider olarak da yazıldı (kasadan).')).toBeVisible();
    // The owner's Gider ekle: the same note under "Ödeme yöntemi", one "Gideri kaydet" button (closed here without saving).
    await openView(owner, 'Satış ve Raporlar');
    await openReport(owner, 'Giderler');
    await owner.getByRole('button', { name: /Gider ekle/ }).first().click();
    const add = owner.getByRole('dialog', { name: 'Gider ekle' });
    await add.getByLabel('Gider tutarı', { exact: true }).fill('100');
    await add.getByLabel('Gider açıklaması', { exact: true }).fill('kira');
    await add.getByLabel('Ödeme yöntemi', { exact: true }).selectOption({ label: 'Kasadan nakit' });
    await expect(add.getByTestId('below-zero')).toHaveText('Kasada şu an −₺57 görünüyor; bu çıkışla −₺157 olur. Para kasadan çıkmadıysa “Kasa dışı nakit”i seçin.');
    await expect(add.getByRole('button', { name: 'Kasadan, yine de kaydet' })).toHaveCount(0);
    await owner.keyboard.press('Escape');
    // Gider ekle is in Kasa ve giderler → Giderler (10 Ekim): Satış ve Raporlar stays on its plain summary on this device.

    // The cashier's "süt aldık" ₺500: "Para nereden çıktı?" — Kasadan.
    await cashier.reload();
    await cashAction(cashier, 'Gider kaydet');
    await cashier.getByLabel('Gider tutarı', { exact: true }).fill('500');
    await cashier.getByLabel('Gider açıklaması', { exact: true }).fill('süt aldık');
    await expect(cashier.getByRole('radiogroup', { name: 'Para nereden çıktı' })).toBeVisible();
    await cashier.getByRole('radio', { name: /^Kasadan/ }).click();
    await cashier.getByRole('button', { name: 'Gideri kaydet' }).click();
    await expect(cashier.getByText('Gider kaydedildi.', { exact: true })).toBeVisible();
    // The card refund of 1 × Caffè Latte ₺140 and a para bozdurma of ₺200.
    const ledger = (await (await owner.request.get('/api/staff/payment-adjustments')).json()).rows, card = ledger.find((r: { method: string; amount: number }) => r.method === 'card' && r.amount === 47000);
    expect((await owner.request.post('/api/staff/payment-adjustments', { data: { requestId: rid(), paymentId: card.id, revision: 0, kind: 'refund', amount: 14000, method: 'card', commission: 0, reason: '1 × Caffè Latte' } })).ok()).toBe(true);
    expect((await cashier.request.post('/api/staff/cash/movements', { data: { requestId: rid(), type: 'exchange', amount: 20000, note: '200 TL bozduruldu' } })).ok()).toBe(true);

    // Gün sonu by the cashier: ₺2.895. Only "Gün sonu kaydedildi; sayım işletme sahibine iletildi." — no expected, no difference.
    // A bill still open at gün sonu is named in one line (8 Ekim denetimi: the count went ahead silently over an unpaid table).
    expect((await waiter.request.post('/api/staff/orders', { data: { requestId: rid(), tableId: 'table-5', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } })).ok()).toBe(true);
    await cashier.reload();
    await cashAction(cashier, 'Gün sonu');
    const dialog = cashier.getByRole('dialog');
    await expect(dialog.getByTestId('open-bills')).toHaveText('1 açık hesap var: Masa 05 ₺35. Mümkünse önce ödemesini alın; gün sonundan sonra alınan ödeme için ek kapanış gerekir.');
    // K-C (9 Ekim): the kitchen's unfinished orders too (Masa 05's tea has not been started).
    await expect(dialog.getByTestId('kitchen-open')).toHaveText(/^Mutfakta [1-9]\d* sipariş bitmedi\.$/);
    await expect(dialog).toContainText('Sayımınız işletme sahibine iletilir.');
    await dialog.getByRole('button', { name: 'Tek toplam' }).click();
    await dialog.getByLabel('Kasadaki nakit toplamı').fill('2.895');
    await dialog.getByRole('button', { name: 'Sayımı kaydet' }).click();
    await expect(dialog.getByTestId('blind-result')).toContainText('₺2.895');
    await dialog.getByLabel('Kasada bırakılan').fill('0');
    await dialog.getByRole('button', { name: 'Kapanışı tamamla' }).click();
    await expect(dialog.getByTestId('blind-result')).toContainText('Gün sonu kaydedildi; sayım işletme sahibine iletildi.');
    for (const word of [/−₺557/, /3\.452/, /Beklenen nakit/, /Kasa fazla/, /Kasa eksik/]) await expect(dialog.getByText(word)).toHaveCount(0);
    await shot(cashier, 'gun-sonu-kasiyer.png', info.outputPath('gun-sonu-kasiyer.png'));
    await dialog.getByRole('button', { name: 'Tamam', exact: true }).click();

    // The owner: Satış ve Raporlar, the plain summary of today.
    await owner.reload();
    await openView(owner, 'Satış ve Raporlar');
    const summary = owner.getByLabel('Sade özet');
    await expect(summary.locator('.simple-kept strong')).toHaveText('−₺4,75');
    await expect(summary.locator('.simple-expenses')).toContainText('Stok alışları dahil (₺467)');
    await expect(summary.locator('.simple-kept')).toContainText('Kart komisyonu ₺17,75 (kart satışına oranı %2,5)');
    // The kasa card links the count with the report.
    await expect(summary.getByTestId('simple-count')).toContainText('Gün sonu sayımı: ₺2.895 · Beklenen: −₺557 · Fark: +₺3.452');
    // The formula adds up on paper, ending with the expected figure itself.
    await expect(summary.getByTestId('simple-count-formula')).toContainText('Beklenen = açılış ₺0 + nakit satış ₺410 − kasadan ödenen gider ₺967 = −₺557.');
    // Giderler: a tap (or hover) shows what it is made of.
    await summary.getByRole('button', { name: 'Giderler: dökümü göster' }).click();
    let pop = summary.getByTestId('simple-tip-pop');
    await expect(pop).toContainText('Stok alışları'); await expect(pop).toContainText('₺467'); await expect(pop).toContainText('Diğer giderler'); await expect(pop).toContainText('süt aldık');
    await owner.keyboard.press('Escape'); await expect(pop).toHaveCount(0);
    // Elde kalan: hovered on the café computer, worked out line by line.
    await summary.locator('.simple-kept').hover();
    pop = summary.locator('.simple-kept').getByTestId('simple-tip-pop');
    await expect(pop).toContainText('Satış'); await expect(pop).toContainText('₺1.120'); await expect(pop).toContainText('−₺967'); await expect(pop).toContainText('−₺140'); await expect(pop).toContainText('−₺17,75'); await expect(pop).toContainText('= Elde kalan');
    await shot(owner, 'rapor-elde-kalan.png', info.outputPath('rapor-elde-kalan.png'));
    await owner.mouse.move(5, 5);
    // A phone: a tap on the card opens it.
    await owner.setViewportSize({ width: 390, height: 844 });
    await summary.locator('.simple-kept strong').click();
    await expect(summary.locator('.simple-kept').getByTestId('simple-tip-pop')).toBeVisible();
    expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await owner.setViewportSize({ width: 1280, height: 900 });

    // Kasa kapanışları: the owner's full closing, the minus explained.
    await owner.getByRole('button', { name: 'Detaylı göster' }).click();
    await openReport(owner, 'Kasa kapanışları');
    const closing = owner.locator('.cash-closing-card').first();
    await expect(closing.locator('.cash-badge')).toHaveText('+₺3.452');
    await closing.locator('.cash-closing-head').click();
    await expect(closing.locator('.cash-lines-total')).toContainText('−₺557');
    await expect(closing.getByTestId('negative-expected')).toContainText('kasaya girenden ₺557 fazla nakit çıktı');
    await expect(closing).toContainText('Stok alışı: Kahve 10 kg');
    await closing.locator('.cash-closing-head').evaluate(e => e.scrollIntoView({ block: 'start' }));
    await owner.waitForTimeout(200);
    await shot(owner, 'gun-sonu-sahip.png', info.outputPath('gun-sonu-sahip.png'));
  } finally {
    for (const p of [cashier, waiter, owner]) await p.context().close();
  }
});
