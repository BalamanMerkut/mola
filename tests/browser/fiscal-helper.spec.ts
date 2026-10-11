import { test, expect, type Browser, type Page } from '@playwright/test';
import { cashAction, ensureSetup } from './helpers';

/*
 * Yazar kasa yardımcısı (src/FiscalHelper.tsx): after a payment the window says what to enter on the yazar kasa per KDV
 * department; once the window closes the card waits in a small dock that never blocks the next table. Gün sonu compares it
 * all with the Z raporu.
 */
const PASSWORD = 'MolaDemo!2026';
const rid = () => crypto.randomUUID().replace(/-/g, '');
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true }).first()).toBeAttached();
  return page;
}

test('yazar kasa: ₺347 cash → "%10 departman → ₺347,00 · Ödeme: Nakit"; a mixed %10/%20 bill; Gün sonu compares with the Z raporu', async ({ page, browser }, info) => {
  test.setTimeout(240000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  // The helper is off by default since 11 Ekim; the owner turns it on.
  expect((await page.request.post('/api/staff/cash/settings', { data: { fiscalHelper: true } })).ok()).toBe(true);
  // Cakes at %20 (the rest stays at the default %10).
  expect((await page.request.post('/api/staff/vat/apply', { data: { requestId: rid(), category: 'Tatlılar', rate: 20 } })).ok()).toBe(true);
  const cashier = await signedIn(browser, 'kasiyer'), waiter = await signedIn(browser, 'garson');
  try {
    const opening = cashier.getByRole('form', { name: 'Kasa açılışı' });
    await opening.getByLabel('Açılış tutarı').fill('100');
    await opening.getByRole('button', { name: 'Açılışı kaydet' }).click();
    await expect(opening).toHaveCount(0);

    // Masa 01: 10 çay (₺350, all %10). "Bir kısmı" ₺347 in cash: the card is in the window, which stays open.
    expect((await waiter.request.post('/api/staff/orders', { data: { requestId: rid(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 10, selections: [] }], expectedTotal: 35000 } })).ok()).toBe(true);
    await cashier.locator('.table-card', { hasText: 'Masa 01' }).click();
    await cashier.getByRole('button', { name: 'Ödeme al' }).click();
    const pay = cashier.getByRole('dialog', { name: 'Masa 01 · Ödeme al' });
    await pay.getByRole('group', { name: 'Ne kadar ödenecek' }).getByRole('button', { name: 'Bir kısmı' }).click();
    await pay.getByLabel('Tahsil edilecek tutar (TL)').fill('347');
    await pay.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
    const inline = pay.getByRole('region', { name: 'Yazar kasaya girin' });
    await expect(inline).toContainText('%10 departman →');
    await expect(inline.getByRole('button', { name: /%10 departman: ₺347,00/ })).toBeVisible();
    await expect(inline).toContainText('Ödeme: Nakit');
    await expect(inline.getByRole('button', { name: 'Girildi' })).toBeVisible();
    await cashier.screenshot({ path: info.outputPath('yazar-kasa-odeme.png') });
    // The rest (₺3) by card: the window closes, the card moves to the dock and says Kart.
    await pay.getByRole('button', { name: 'Kart', exact: true }).click();
    await pay.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
    await expect(pay).toHaveCount(0);
    const dock = cashier.getByRole('complementary', { name: 'Yazar kasa yardımcısı' });
    const open = dock.locator('.fiscal-card:not(.folded)');
    await expect(open).toContainText('₺3,00'); await expect(open).toContainText('Ödeme: Kart');
    // The earlier card is folded to one line, still with its "Girildi".
    await expect(dock.locator('.fiscal-card.folded')).toContainText('₺347,00');

    // Masa 02: 2 çay (%10, ₺70) + San Sebastian (%20, ₺190), all in cash. Clicking the table folds the dock out of the way.
    expect((await waiter.request.post('/api/staff/orders', { data: { requestId: rid(), tableId: 'table-2', lines: [{ productId: 'tea', quantity: 2, selections: [] }, { productId: 'cheesecake', quantity: 1, selections: [] }], expectedTotal: 26000 } })).ok()).toBe(true);
    await cashier.locator('.table-card', { hasText: 'Masa 02' }).click();
    await expect(dock.locator('.fiscal-card:not(.folded)')).toHaveCount(0);
    await cashier.getByRole('button', { name: 'Ödeme al' }).click();
    const pay2 = cashier.getByRole('dialog', { name: 'Masa 02 · Ödeme al' });
    await pay2.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
    await expect(pay2).toHaveCount(0);
    await expect(open).toContainText('%10 departman →'); await expect(open).toContainText('₺70,00');
    await expect(open).toContainText('%20 departman →'); await expect(open).toContainText('₺190,00');
    await expect(open).toContainText('Ödeme: Nakit'); await expect(open).toContainText('Toplam ₺260,00');
    await cashier.screenshot({ path: info.outputPath('yazar-kasa-dock.png') });
    await open.getByRole('button', { name: 'Girildi' }).click();
    // K-E (9 Ekim): a card marked "Girildi" leaves the dock at once.
    await expect(dock.locator('.fiscal-card', { hasText: '₺260,00' })).toHaveCount(0);
    await expect(dock.locator('.fiscal-card')).toHaveCount(2);
    // Phone, tablet and the counter's computer: the dock stays inside the screen, its cards never wider than it.
    for (const [width, height] of [[390, 844], [768, 1024], [1280, 900]] as const) {
      await cashier.setViewportSize({ width, height });
      expect(await noSideScroll(cashier)).toBe(true);
      const sizes = await dock.evaluate(d => ({ right: d.getBoundingClientRect().right, scroll: d.scrollWidth - d.clientWidth, cards: [...d.querySelectorAll('.fiscal-card')].map(c => c.getBoundingClientRect().right) }));
      expect(sizes.right).toBeLessThanOrEqual(width); expect(sizes.scroll).toBe(0);
      for (const right of sizes.cards) expect(right).toBeLessThanOrEqual(sizes.right + 0.5);
    }

    // Gün sonu: after the blind count, "Yazar kasa karşılaştırması". Opening ₺100 + cash ₺347 + ₺260 = ₺707 in the drawer.
    await cashAction(cashier, 'Gün sonu');
    const dialog = cashier.getByRole('dialog');
    await expect(dialog.getByText('Yazar kasa karşılaştırması')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Tek toplam' }).click();
    await dialog.getByLabel('Kasadaki nakit toplamı').fill('707');
    await dialog.getByRole('button', { name: 'Sayımı kaydet' }).click();
    const fiscal = dialog.getByRole('region', { name: 'Yazar kasa karşılaştırması' });
    await expect(fiscal).toContainText('Bugün yazar kasaya girilmesi gereken');
    await expect(fiscal).toContainText('%10 ₺420,00 · %20 ₺190,00 · Toplam ₺610,00');
    await expect(fiscal).toContainText('(Nakit ₺607,00 / Kart ₺3,00)');
    // Two payments were not ticked; one is ticked here.
    await expect(fiscal).toContainText('“Girildi” işaretlenmemiş (2)');
    await fiscal.locator('.fiscal-open li', { hasText: '₺3,00' }).getByRole('button', { name: 'Girildi' }).click();
    await expect(fiscal).toContainText('“Girildi” işaretlenmemiş (1)');
    // The Z raporu says ₺600: ₺10 short, with the plain explanation.
    await fiscal.getByLabel('Z raporu toplamı').fill('600');
    await expect(fiscal.locator('.fiscal-z strong')).toHaveText('−₺10,00');
    await expect(fiscal).toContainText("Z raporu Mola'dan ₺10,00 az. Fark varsa fiş kesilmemiş hesap olabilir");
    await cashier.screenshot({ path: info.outputPath('yazar-kasa-gun-sonu.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Kapanışı tamamla' }).click();
    await expect(dialog.getByText('Gün sonu kaydedildi; sayım işletme sahibine iletildi.')).toBeVisible();
    await expect(fiscal.locator('.fiscal-z strong')).toHaveText('−₺10,00');

    // Kept with the closing: Satış ve Raporlar → Para → Kasa kapanışları shows it (owner).
    const report = await (await page.request.get(`/api/staff/reports/cash-closings?from=all&to=all`)).json();
    expect(report.closings[0].fiscalZ.difference).toBe(-1000);
    expect(report.closings[0].fiscal.open.length).toBe(1);

    // K-E: more than three cards in the dock fold into one line ("3 ödeme yazar kasaya girilmedi") above the newest card.
    await dialog.getByRole('button', { name: /^(Tamam|Kapat)$/ }).first().click();
    await expect(cashier.getByRole('dialog')).toHaveCount(0);
    for (const table of ['3', '4']) {
      expect((await waiter.request.post('/api/staff/orders', { data: { requestId: rid(), tableId: `table-${table}`, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } })).ok()).toBe(true);
      await cashier.locator('.table-card', { hasText: `Masa 0${table}` }).click();
      await cashier.getByRole('button', { name: 'Ödeme al' }).click();
      const p = cashier.getByRole('dialog', { name: `Masa 0${table} · Ödeme al` });
      if (table === '3') {
        // K-D (9 Ekim): a part payment of ₺20 from ₺50 cash: the big box says "Verilecek para üstü ₺30" after saving.
        await p.getByRole('group', { name: 'Ne kadar ödenecek' }).getByRole('button', { name: 'Bir kısmı' }).click();
        await p.getByLabel('Tahsil edilecek tutar (TL)').fill('20');
        await p.getByLabel('Alınan nakit (TL)').fill('50');
        await p.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
        await expect(p.getByTestId('given-change')).toContainText('Verilecek para üstü');
        await expect(p.getByTestId('given-change').locator('strong')).toHaveText('₺30');
        await p.getByRole('button', { name: 'Tam', exact: true }).click();
        await expect(p.getByTestId('given-change')).toHaveCount(0);
      }
      await p.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
      await expect(p).toHaveCount(0);
    }
    // ₺347, ₺3, Masa 03's ₺20 and ₺15 folded into one line; Masa 04's card open below it.
    const group = dock.locator('.fiscal-group');
    await expect(group).toHaveText('4 ödeme yazar kasaya girilmedi');
    await expect(dock.locator('.fiscal-card')).toHaveCount(1);
    await group.click();
    await expect(dock.locator('.fiscal-card')).toHaveCount(5);
  } finally {
    await page.request.post('/api/staff/vat/apply', { data: { requestId: rid(), category: 'Tatlılar', rate: 10 } });
    await cashier.context().close(); await waiter.context().close();
  }
});
