import { test, expect, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { cashAction, ensureSetup, openReport } from './helpers';

/*
 * Ürün bazlı iade at the counter: the cashier's small item refund (the owner hears of it), a refund above the cashier's limit
 * sent to the owner and done from İade ve düzeltme; "Hesabı iste" with Kart (the waiter reads "Hesap · Kart", the payment
 * window opens on Kart); a sale after gün sonu and the "Ek kapanış".
 */
const PASSWORD = 'MolaDemo!2026';
const rid = () => randomUUID().replace(/-/g, '');
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await page.goto('/');
  // Phones have a bottom bar instead of the sidebar (no "Çıkış yap" there): the workspace's main area is enough.
  await expect(page.locator('main').first()).toBeVisible();
  return page;
}
async function order(page: Page, tableId: string, lines: { productId: string; quantity: number }[], expectedTotal: number) {
  const r = await page.request.post('/api/staff/orders', { data: { requestId: rid(), tableId, lines: lines.map(l => ({ ...l, selections: [] })), expectedTotal } });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()).accountId as string;
}
async function payAll(page: Page, accountId: string, method: 'cash' | 'card' = 'cash') {
  const state = await (await page.request.get('/api/staff/state')).json();
  const account = state.tables.find((t: { account?: { id: string } }) => t.account?.id === accountId).account;
  const r = await page.request.post('/api/staff/payments', { data: { requestId: rid(), accountId, version: account.version, method, amount: account.balance, tendered: account.balance } });
  expect(r.ok(), await r.text()).toBe(true);
}

test('kasiyer küçük ürün iadesi yapar; büyük iade sahibe istek olur, sahip İade ve düzeltme\'den yapar', async ({ page, browser }, info) => {
  test.setTimeout(180000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  // The yazar kasa helper is off by default since 11 Ekim; this test checks its refund card, so the owner turns it on.
  expect((await page.request.post('/api/staff/cash/settings', { data: { fiscalHelper: true } })).ok()).toBe(true);
  const cashier = await signedIn(browser, 'kasiyer'), waiter = await signedIn(browser, 'garson');
  try {
    // Masa 03: 2 çay (₺70) and a cheesecake (₺190), paid in cash.
    await payAll(cashier, await order(waiter, 'table-3', [{ productId: 'tea', quantity: 2 }, { productId: 'cheesecake', quantity: 1 }], 7000 + 19000));
    await cashier.reload();
    await cashAction(cashier, 'İade');
    const win = cashier.getByRole('dialog', { name: 'İade' });
    await expect(win.getByText('Tek seferde en çok')).toContainText('₺150');
    await win.getByRole('list', { name: 'Bugünkü ödemeler' }).getByRole('button', { name: /Masa 03/ }).click();
    const form = cashier.getByRole('dialog', { name: 'İade · Masa 03' });
    await expect(form.getByText('Kalan iade hakkı: ₺260')).toBeVisible();
    // One tea: − / +, the amount from what was paid.
    await form.getByRole('button', { name: 'Demleme Çay bir adet ekle' }).click();
    await expect(form.locator('.refund-total strong')).toHaveText('₺35');
    await expect(form.getByRole('button', { name: 'İadeyi kaydet' })).toBeDisabled();
    await expect(form.getByText('İadenin nedenini seçin.')).toBeVisible();
    await form.getByRole('group', { name: 'İade nedeni' }).getByRole('button', { name: 'Yanlış ürün' }).click();
    await expect(form.getByRole('group', { name: 'İade yöntemi' }).getByRole('button', { name: 'Nakit' })).toHaveAttribute('aria-pressed', 'true');
    await expect(form.getByRole('checkbox', { name: /Ürünler kullanılmadan geri döndü \(stoğa ekle\)/ })).not.toBeChecked();
    await cashier.screenshot({ path: info.outputPath('kasiyer-iade.png') });
    await form.getByRole('button', { name: 'İadeyi kaydet' }).click();
    await expect(form.getByRole('group', { name: 'İade onayı' })).toContainText('₺35 nakit iade');
    await form.getByRole('button', { name: 'Evet, iadeyi kaydet' }).click();
    await expect(cashier.getByRole('status').filter({ hasText: '₺35 nakit iade kaydedildi · Masa 03.' })).toBeVisible();

    // The cheesecake (₺190) is above ₺150: the window says so and offers the request instead.
    await cashAction(cashier, 'İade');
    await cashier.getByRole('dialog', { name: 'İade' }).getByRole('list', { name: 'Bugünkü ödemeler' }).getByRole('button', { name: /Masa 03/ }).click();
    const big = cashier.getByRole('dialog', { name: 'İade · Masa 03' });
    await expect(big.getByText('Kalan iade hakkı: ₺225')).toBeVisible();
    await expect(big.getByText('1 adet iade edildi')).toBeVisible();
    await big.getByRole('button', { name: 'San Sebastian bir adet ekle' }).click();
    await big.getByRole('group', { name: 'İade nedeni' }).getByRole('button', { name: 'Beğenilmedi' }).click();
    await expect(big.getByRole('alert').filter({ hasText: 'Bu iade için işletme sahibi gerekir.' })).toContainText('Kasiyer tek seferde en çok ₺150 iade edebilir.');
    await expect(big.getByRole('button', { name: 'İadeyi kaydet' })).toHaveCount(0);
    await cashier.screenshot({ path: info.outputPath('kasiyer-iade-sinir.png') });
    await big.getByRole('button', { name: 'Sahibe iade isteği gönder' }).click();
    const sent = cashier.getByRole('dialog', { name: 'İade' });
    await expect(sent.getByRole('status').filter({ hasText: 'İade isteği işletme sahibine gönderildi' })).toBeVisible();
    await expect(sent.getByRole('region', { name: 'İade isteklerim' })).toContainText('Sahibin onayını bekliyor');

    // The owner: both in Bildirimler, then "Bekleyen iade istekleri" → İadeyi yap.
    await page.setViewportSize({ width: 1280, height: 860 });
    const inbox = await (await page.request.get('/api/staff/notifications')).json();
    expect(inbox.items.map((n: { title: string }) => n.title)).toEqual(expect.arrayContaining(['Kasiyer iadesi: ₺35 · Masa 03', 'İade isteği: Masa 03 · ₺190']));
    await page.goto('/');
    // The banner on Masalar says what happened and goes straight there (8 Ekim denetimi K4).
    const banner = page.locator('.notification-banner');
    await expect(banner).toContainText('İade isteği: Masa 03 · ₺190');
    await banner.getByRole('button', { name: 'İadeyi yap' }).click();
    const requests = page.getByRole('region', { name: 'Bekleyen iade istekleri' });
    await expect(requests).toContainText('Masa 03 · ₺190 nakit iade');
    await expect(requests).toContainText('1 × San Sebastian · Beğenilmedi');
    await requests.getByRole('button', { name: 'İadeyi yap' }).click();
    await expect(requests.getByRole('group', { name: 'San Sebastian iade adedi' })).toContainText('1');
    await expect(requests.locator('.refund-total strong')).toHaveText('₺190');
    await page.screenshot({ path: info.outputPath('sahip-iade-istegi.png'), fullPage: true });
    await requests.getByRole('button', { name: 'İadeyi kaydet' }).click();
    await requests.getByRole('button', { name: 'Evet, iadeyi kaydet' }).click();
    await expect(page.getByRole('status').filter({ hasText: '₺190 nakit iade kaydedildi · Masa 03.' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Bekleyen iade istekleri' })).toHaveCount(0);
    // K-A (9 Ekim): the cashier's screen hears of it at once (nothing to reopen): the green strip and the yazar kasa refund card.
    await expect(cashier.getByTestId('till-notice')).toContainText('Sahip iadeyi yaptı: Masa 03 · ₺190 nakit. Parayı müşteriye verin.', { timeout: 15000 });
    const dock = cashier.getByRole('complementary', { name: 'Yazar kasa yardımcısı' });
    await expect(dock).toContainText('Yazar kasada iade / ters işlem');
    await expect(dock).toContainText('₺190,00');
    // The statement row: both refunds with their items, the cashier's marked.
    const row = page.locator('.ledger-row').filter({ hasText: 'Masa 03' });
    await row.locator('.ledger-main').click();
    await expect(row.locator('.ledger-corrections li')).toHaveCount(2);
    await expect(row.locator('.ledger-corrections')).toContainText('1 × Demleme Çay');
    await expect(row.locator('.ledger-corrections')).toContainText('(kasiyer)');
    await expect(row.locator('.ledger-corrections')).toContainText('1 × San Sebastian');
    // Ürünler: the refunded pieces left the product's sales.
    const day = (await (await page.request.get('/api/staff/refunds/payments')).json()).day;
    const products = await (await page.request.get(`/api/staff/reports/products?from=${day}&to=${day}`)).json();
    const cheesecake = products.products.find((p: { id: string }) => p.id === 'cheesecake');
    expect([cheesecake.qty, cheesecake.amount, cheesecake.returned]).toEqual([0, 0, 1]);
    // The cashier sees the request answered (the window is opened again).
    await cashier.reload();
    // The strip stays until the cashier closes it (✕); then it is gone for good on this account.
    await cashier.getByRole('button', { name: 'İade uyarısını kapat' }).click();
    await expect(cashier.getByTestId('till-notice')).toHaveCount(0);
    await cashier.reload();
    await expect(cashier.getByLabel('Günün özeti')).toBeVisible();
    await expect(cashier.getByTestId('till-notice')).toHaveCount(0);
    await cashAction(cashier, 'İade');
    await expect(cashier.getByRole('region', { name: 'İade isteklerim' })).toContainText('Sahip iadeyi yaptı');
    expect(await cashier.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    for (const p of [cashier, waiter]) await p.context().close();
  }
});

test('the counter refund window on a phone: rows, steppers and buttons fit', async ({ browser }, info) => {
  const cashier = await signedIn(browser, 'kasiyer', { width: 390, height: 844 });
  try {
    await cashAction(cashier, 'İade');
    const win = cashier.getByRole('dialog', { name: 'İade' });
    await win.getByRole('list', { name: 'Bugünkü ödemeler' }).getByRole('button').first().click();
    await expect(cashier.getByRole('group', { name: 'İade şekli' })).toBeVisible();
    await cashier.getByRole('button', { name: 'Tutar olarak iade' }).click();
    await expect(cashier.getByLabel('İade tutarı (TL) *')).toBeVisible();
    expect(await cashier.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await cashier.screenshot({ path: info.outputPath('kasiyer-iade-telefon.png') });
  } finally { await cashier.context().close(); }
});

test('"Hesabı iste" → Kart: the waiter reads "Hesap · Kart", the cashier\'s payment window opens on Kart', async ({ page, browser }, info) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  const waiter = await signedIn(browser, 'garson', { width: 390, height: 844 }), cashier = await signedIn(browser, 'kasiyer');
  const guestContext = await browser.newContext({ viewport: { width: 375, height: 812 } }), guest = await guestContext.newPage();
  try {
    await order(waiter, 'table-6', [{ productId: 'tea', quantity: 1 }], 3500);
    const table = (await (await page.request.get('/api/staff/state')).json()).tables.find((t: { id: string }) => t.id === 'table-6');
    await guest.goto(`/m/${table.token}`);
    await guest.getByRole('button', { name: 'Hesabı iste' }).click();
    const choice = guest.getByRole('group', { name: 'Nasıl ödeyeceksiniz?' });
    await expect(choice.getByRole('button', { name: 'Nakit' })).toBeVisible();
    await expect(choice.getByRole('button', { name: 'Fark etmez, hesabı iste' })).toBeVisible();
    await guest.screenshot({ path: info.outputPath('musteri-hesap-kart.png') });
    await choice.getByRole('button', { name: 'Kart' }).click();
    await expect(guest.getByRole('button', { name: 'Hesap istendi' })).toBeDisabled();
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await waiter.reload();
    const chip = waiter.locator('.service-call-chip').filter({ hasText: 'Masa 06' });
    await expect(chip).toContainText('Hesap · Kart');
    // K1 (10 Ekim): the waiter closes the call (✓); the guest's "Kart" stays on the table and the payment window.
    await waiter.getByRole('button', { name: 'Masa 06 çağrısını kapat' }).click();
    await expect(chip).toHaveCount(0);
    await cashier.reload();
    await cashier.locator('.table-card', { hasText: 'Masa 06' }).click();
    await expect(cashier.locator('.bill-method-note')).toHaveText('Müşteri hesabı isterken “Kart” dedi.');
    await cashier.getByRole('button', { name: 'Ödeme al' }).click();
    const pay = cashier.getByRole('dialog', { name: 'Masa 06 · Ödeme al' });
    await expect(pay.getByRole('button', { name: 'Kart', exact: true })).toHaveClass(/selected/);
    await expect(pay.getByText('Müşteri hesabı isterken “Kart” dedi.')).toBeVisible();
    await pay.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
    await expect(pay).toHaveCount(0);
  } finally {
    await guestContext.close();
    for (const p of [waiter, cashier]) await p.context().close();
  }
});

test('gün sonundan sonra satış: the strip asks for an "Ek kapanış", which counts only what came after and is named so', async ({ page, browser }, info) => {
  test.setTimeout(150000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  // A large "not isteyen fark" so the blind counts here need no note.
  expect((await page.request.post('/api/staff/cash/settings', { data: { differenceNote: 10_000_000 } })).ok()).toBe(true);
  const cashier = await signedIn(browser, 'kasiyer'), waiter = await signedIn(browser, 'garson');
  const strip = cashier.locator('.cash-day');
  try {
    await payAll(cashier, await order(waiter, 'table-7', [{ productId: 'tea', quantity: 2 }], 7000));
    await cashier.reload();
    await cashAction(cashier, 'Gün sonu');
    let dialog = cashier.getByRole('dialog');
    await expect(cashier.getByRole('heading', { name: 'Gün sonu · kasa sayımı' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Tek toplam' }).click();
    await dialog.getByLabel('Kasadaki nakit toplamı').fill('500');
    await dialog.getByRole('button', { name: 'Sayımı kaydet' }).click();
    await dialog.getByLabel('Kasada bırakılan').fill('500');
    await dialog.getByRole('button', { name: 'Kapanışı tamamla' }).click();
    await dialog.getByRole('button', { name: 'Tamam', exact: true }).click();
    await expect(strip).toContainText('Kasa kapandı');
    // The night goes on.
    await payAll(cashier, await order(waiter, 'table-8', [{ productId: 'tea', quantity: 1 }], 3500));
    await cashier.reload();
    await expect(strip).toContainText('Gün sonundan sonra satış var · ek kapanış yapın');
    await cashAction(cashier, 'Gün sonu');
    dialog = cashier.getByRole('dialog');
    await expect(cashier.getByRole('heading', { name: 'Ek kapanış · kasa sayımı' })).toBeVisible();
    await expect(dialog.getByText(/Bu ek kapanış yalnız o kapanıştan sonraki satışları sayar ve kasada bırakılan ₺500 başlar/)).toBeVisible();
    await cashier.screenshot({ path: info.outputPath('ek-kapanis.png') });
    await dialog.getByRole('button', { name: 'Tek toplam' }).click();
    await dialog.getByLabel('Kasadaki nakit toplamı').fill('535');
    await dialog.getByRole('button', { name: 'Sayımı kaydet' }).click();
    await expect(cashier.getByRole('heading', { name: 'Ek kapanış · sonuç' })).toBeVisible();
    // The cashier counts blind (8 Ekim): what was counted, never the expected cash or the difference.
    await expect(dialog.getByTestId('blind-result')).toContainText('₺535');
    await expect(dialog.locator('.cash-lines')).toHaveCount(0);
    await dialog.getByLabel('Kasada bırakılan').fill('535');
    await dialog.getByRole('button', { name: 'Kapanışı tamamla' }).click();
    await expect(cashier.getByRole('heading', { name: 'Ek kapanış kaydedildi' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Tamam', exact: true }).click();
    await expect(strip).toContainText('Yarın sabah açılış');
    await expect(strip).not.toContainText('ek kapanış yapın');
    // Both closings of the day in the report; the second is marked.
    await page.goto('/');
    await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
    await openReport(page, 'Kasa kapanışları');
    await expect(page.getByText(/Gün sonu · ek kapanış · \d\d:\d\d/).first()).toBeVisible();
  } finally {
    await page.request.post('/api/staff/cash/settings', { data: { differenceNote: 5000 } });
    for (const p of [cashier, waiter]) await p.context().close();
  }
});
