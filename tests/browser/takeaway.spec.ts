import { ensureSetup, openSettings, openView } from './helpers';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
async function login(page: Page, role: string) {
  await page.goto('/');
  await page.getByLabel('Kullanıcı adı', { exact: true }).fill(role);
  // The test server runs as an installed café: no demo password is filled in for us.
  await page.getByLabel('Şifre', { exact: true }).fill('MolaDemo!2026');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/login')), page.getByRole('button', { name: 'Çalışma alanını aç' }).click()]);
  await ensureSetup(page.request); await page.reload();
  await expect(page.getByRole('button', { name: 'Çıkış yap' })).toBeVisible();
}
async function staffPage(browser: Browser, role: string) { const context = await browser.newContext(); const page = await context.newPage(); await login(page, role); return { context, page }; }
const hint = 'Masaya bağlı olmayan satış: tezgâhtan alıp giden ya da ayakta bekleyen müşteri.';

// Masasız sipariş: no setting, one choice in Sipariş al for owner, cashier and waiter; a strip on Masalar only while open.
test('cashier: Sipariş al → Masasız sipariş → kitchen sees MASASIZ #1 → ready → paid → the strip disappears; floor unchanged', async ({ page, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page, 'isletme');
  expect((await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } })).ok()).toBe(true);
  const cashier = await staffPage(browser, 'kasiyer'); cashier.page.on('pageerror', e => errors.push(e.message));
  const c = cashier.page;
  // Nothing open: no strip and no big button on Masalar.
  await expect(c.locator('.tables-section h2')).toContainText('12 masa');
  await expect(c.locator('.takeaway-strip')).toHaveCount(0);
  await expect(c.getByRole('button', { name: /Al götür/ })).toHaveCount(0);
  await c.getByRole('navigation').getByRole('button', { name: 'Sipariş al', exact: true }).click();
  const choice = c.getByRole('button', { name: /^Masasız sipariş/ });
  await expect(choice).toContainText(hint);
  await c.screenshot({ path: info.outputPath('order-start-cashier.png'), fullPage: true });
  await choice.click();
  const dialog = c.getByRole('dialog', { name: 'Masasız sipariş' });
  await dialog.getByLabel('Müşteri adı', { exact: true }).fill('0532 111 22 33');
  await expect(dialog).toContainText('Telefon numarası yazmayın');
  await dialog.getByLabel('Müşteri adı', { exact: true }).fill('Ahmet');
  await dialog.locator('.staff-card', { hasText: 'Demleme Çay' }).click();
  const product = c.getByRole('dialog', { name: 'Demleme Çay' });
  await expect(product.getByLabel('Not ekle (isteğe bağlı)')).toHaveAttribute('placeholder', 'Örn. açık demli, limonlu');
  await product.getByLabel('Not ekle (isteğe bağlı)').fill('Ayrı poşet');
  await product.getByRole('button', { name: 'Adedi artır' }).click();
  await product.getByRole('button', { name: /Sepete ekle/ }).click();
  await dialog.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  // No table to stay at: the basket never offers "Paket yapılsın" or "Hepsini paketle".
  await expect(c.getByRole('dialog', { name: 'Masasız sipariş · Sepet' })).toBeVisible();
  await expect(c.getByRole('checkbox', { name: /paket/i })).toHaveCount(0);
  await c.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await expect(c.getByRole('status').filter({ hasText: 'Masasız #1 mutfağa gönderildi.' }).first()).toBeVisible();
  await expect(c.getByRole('dialog', { name: 'Masasız sipariş' })).toHaveCount(0);
  // At the counter the payment opens right after sending; "Sonra öde" leaves it for later.
  const later = c.getByRole('dialog', { name: 'Masasız #1 · Ödeme al' });
  await expect(later.locator('.payment-balance')).toContainText('70');
  await later.getByRole('button', { name: 'Sonra öde', exact: true }).click();
  await expect(later).toHaveCount(0);
  await c.getByRole('navigation').getByRole('button', { name: 'Masalar', exact: true }).click();
  const strip = c.locator('.takeaway-strip');
  await expect(strip.getByRole('heading', { name: /Masasız siparişler/ })).toBeVisible();
  await expect(strip.getByRole('group', { name: 'Masasız sipariş filtresi' })).toHaveCount(0);
  const card = strip.locator('.takeaway-card').filter({ hasText: 'Masasız #1' });
  await expect(card).toContainText('Ahmet'); await expect(card).toContainText('Yeni sipariş'); await expect(card).toContainText('Ödeme bekliyor');
  await expect(c.locator('.tables-section h2')).toContainText('12 masa');
  const state = await (await c.request.get('/api/staff/state')).json();
  expect(state.tables).toHaveLength(12); expect(state.takeaways).toHaveLength(1);
  await c.screenshot({ path: info.outputPath('masasiz-strip.png'), fullPage: true });

  const kitchen = await staffPage(browser, 'mutfak'); kitchen.page.on('pageerror', e => errors.push(e.message));
  const bag = kitchen.page.locator('.kitchen-card').filter({ has: kitchen.page.getByRole('heading', { name: 'MASASIZ #1', exact: true }) });
  await expect(bag.locator('.order-meta')).toContainText('Ahmet'); await expect(bag).not.toContainText(/götür/i);
  await expect(bag.locator('.qty-badge')).toHaveText('2'); await expect(bag.locator('.line-note')).toContainText('Ayrı poşet');
  await kitchen.page.screenshot({ path: info.outputPath('kitchen-masasiz.png'), fullPage: true });
  await bag.getByRole('button', { name: /Hazırlamaya başla/ }).click();
  await bag.getByRole('button', { name: /Hazır olarak işaretle/ }).click();
  await expect(kitchen.page.locator('.kitchen-column').nth(2).getByRole('heading', { name: 'MASASIZ #1', exact: true })).toBeVisible();

  await expect(card.locator('.takeaway-stage')).toHaveText(/^Hazır · /);
  await expect(card.getByRole('button', { name: 'Teslim edildi', exact: true })).toBeVisible();
  await card.getByRole('button', { name: /Masasız #1 · Ahmet/ }).click();
  const detail = c.getByRole('dialog', { name: 'Masasız #1 · Ahmet' });
  await expect(detail).toContainText('Masasız · QR yok'); await expect(detail.getByRole('button', { name: /Taşı/ })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Ödeme al', exact: true }).click();
  const pay = c.getByRole('dialog', { name: 'Masasız #1 · Ödeme al' });
  await expect(pay.locator('.payment-balance')).toContainText('70');
  await pay.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
  await expect(c.getByText('Hesap kapandı.')).toBeVisible();
  // Paid and handed over: none open, so the strip is gone.
  await expect(c.locator('.takeaway-strip')).toHaveCount(0);
  await expect(kitchen.page.getByRole('heading', { name: 'MASASIZ #1', exact: true })).toHaveCount(0);
  const after = await (await c.request.get('/api/staff/state')).json();
  expect(after.tables).toHaveLength(12); expect(after.takeaways).toHaveLength(0);
  expect(after.tables.some((t: any) => t.needsCleaning)).toBe(false);
  const ledger = await (await page.request.get('/api/staff/payment-adjustments')).json();
  expect(ledger.rows[0].tableName).toBe('Masasız #1');
  await c.screenshot({ path: info.outputPath('masasiz-closed.png'), fullPage: true });
  expect(errors).toEqual([]);
  await kitchen.context.close(); await cashier.context.close();
});

test('waiter and owner start Masasız sipariş from Sipariş al; Teslim edildi on the strip; filters only for a long strip; no setting', async ({ page, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page, 'isletme');
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  const waiter = await staffPage(browser, 'garson'); const w = waiter.page; w.on('pageerror', e => errors.push(e.message));
  // Waiters open on Masalar (8 Ekim denetimi K6); on Sipariş al "Masasız sipariş" sits above the table list.
  await openView(w, 'Sipariş al');
  await expect(w.locator('.no-table-choice + .staff-table-picker')).toBeVisible();
  await w.getByRole('button', { name: /^Masasız sipariş/ }).click();
  const dialog = w.getByRole('dialog', { name: 'Masasız sipariş' });
  // The card's "+" adds one (waiters work without the product-number box).
  await dialog.getByRole('button', { name: /^Demleme Çay · bir adet ekle/ }).click();
  await dialog.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await w.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  // Same server as the first test: its ticket was #1 today, so this one counts on.
  await expect(w.getByRole('status').filter({ hasText: 'Masasız #2 mutfağa gönderildi.' }).first()).toBeVisible();

  // Owner: Sipariş al from the Masalar head (the counter's compact Masalar), same choice.
  await page.reload();
  const strip = page.locator('.takeaway-strip');
  await expect(strip.locator('.takeaway-card')).toHaveCount(1);
  await page.locator('.floor-head').getByRole('button', { name: 'Sipariş al', exact: true }).click();
  await page.getByRole('button', { name: /^Masasız sipariş/ }).click();
  const owned = page.getByRole('dialog', { name: 'Masasız sipariş' });
  await owned.getByLabel('Müşteri adı', { exact: true }).fill('Selin');
  await owned.getByLabel('Sepete eklenecek ürün numarası').fill('21');
  await owned.getByRole('button', { name: 'Numarayla sepete ekle' }).click();
  await owned.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await page.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Masasız #3 mutfağa gönderildi.' }).first()).toBeVisible();
  await page.getByRole('dialog', { name: /Masasız #3 · Ödeme al/ }).getByRole('button', { name: 'Sonra öde', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Masalar', exact: true }).click();
  await expect(strip.locator('.takeaway-card')).toHaveCount(2);
  await expect(strip.locator('.takeaway-card').filter({ hasText: 'Masasız #3' })).toContainText('Selin');

  // The kitchen finishes #2; "Teslim edildi" on the card hands it over, the unpaid ticket stays in the strip.
  let state = await (await page.request.get('/api/staff/state')).json();
  for (const status of ['preparing', 'ready'] as const) {
    const o = state.orders.find((x: any) => x.takeaway?.number === 2);
    expect((await page.request.post('/api/staff/status', { data: { requestId: randomUUID(), orderId: o.id, version: o.version, status } })).ok()).toBe(true);
    state = await (await page.request.get('/api/staff/state')).json();
  }
  const second = strip.locator('.takeaway-card').filter({ hasText: 'Masasız #2' });
  await second.getByRole('button', { name: 'Teslim edildi', exact: true }).click();
  await expect(second.locator('.takeaway-stage')).toHaveText(/^Teslim edildi · Ödeme bekliyor/); await expect(second).toContainText('Ödeme bekliyor');
  await expect(strip.getByRole('group', { name: 'Masasız sipariş filtresi' })).toHaveCount(0);

  // A busy counter: past six open tickets the stage filters appear.
  const tea = state.products.find((p: any) => p.code === '21');
  const open = async () => expect((await page.request.post('/api/staff/takeaway/orders', { data: { requestId: randomUUID(), lines: [{ productId: tea.id, quantity: 1, selections: [] }], expectedTotal: tea.price } })).ok()).toBe(true);
  for (let i = 0; i < 4; i++) await open();
  await expect(strip.locator('.takeaway-card')).toHaveCount(6);
  await expect(strip.getByRole('group', { name: 'Masasız sipariş filtresi' })).toHaveCount(0);
  await open();
  const filters = strip.getByRole('group', { name: 'Masasız sipariş filtresi' });
  await expect(filters).toBeVisible();
  await filters.getByRole('button', { name: /^Hazır \d/ }).click();
  await expect(strip.locator('.takeaway-card')).toHaveCount(0); await expect(strip).toContainText('Bu durumda masasız sipariş yok.');
  await filters.getByRole('button', { name: /^Teslim edildi/ }).click();
  await expect(strip.locator('.takeaway-card')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('masasiz-strip-filters.png'), fullPage: true });

  // Ayarlar has no switch for it.
  await page.getByRole('navigation').getByRole('button', { name: 'Ayarlar', exact: true }).click();
  await expect(page.getByLabel('İşletme türü', { exact: true })).toBeVisible();
  await openSettings(page, 'Sipariş ve onay');
  await expect(page.getByRole('form', { name: 'Sipariş tercihleri' }).getByRole('checkbox', { name: /götür|Masasız/i })).toHaveCount(0);
  await expect(page.locator('.settings-facts')).toContainText('Masasız sipariş');
  expect(errors).toEqual([]);
  await waiter.context.close();
});

// 5 Oct: a paid masasız order is handed over by the counter, even before the kitchen says Hazır (Ekran modu).
test('paid masasız: the cashier sees "Mutfakta hazırlanıyor" and taps Teslim edildi; the waiter gets no early button', async ({ page, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page, 'isletme');
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  const cashier = await staffPage(browser, 'kasiyer'); const c = cashier.page; c.on('pageerror', e => errors.push(e.message));
  const tea = (await (await c.request.get('/api/staff/state')).json()).products.find((p: any) => p.code === '21');
  const sent = await c.request.post('/api/staff/takeaway/orders', { data: { requestId: randomUUID(), label: 'Deniz', lines: [{ productId: tea.id, quantity: 1, selections: [] }], expectedTotal: tea.price } });
  expect(sent.ok(), await sent.text()).toBe(true);
  const { takeawayNumber, tableId } = await sent.json();
  const account = (await (await c.request.get('/api/staff/state')).json()).takeaways.find((t: any) => t.id === tableId).account;
  const paid = await c.request.post('/api/staff/payments', { data: { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'card', amount: tea.price, tendered: tea.price } });
  expect(paid.ok(), await paid.text()).toBe(true);
  await c.reload();
  const card = c.locator(`.takeaway-card[data-ticket="${takeawayNumber}"]`);
  await expect(card).toContainText('Ödendi'); await expect(card.locator('.takeaway-stage')).toHaveText('Yeni sipariş · Ödendi');
  // One status line on the card (K7): no separate kitchen note beside it.
    await expect(card.locator('.takeaway-note')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Teslim edildi', exact: true })).toBeVisible();
  await c.screenshot({ path: info.outputPath('masasiz-paid-early.png'), fullPage: true });
  // The waiter hands over only what the kitchen finished.
  const waiter = await staffPage(browser, 'garson'); const w = waiter.page; w.on('pageerror', e => errors.push(e.message));
  await w.getByRole('navigation').getByRole('button', { name: 'Masalar', exact: true }).click();
  const seen = w.locator(`.takeaway-card[data-ticket="${takeawayNumber}"]`);
  await expect(seen).toBeVisible();
  await expect(seen.getByRole('button', { name: 'Teslim edildi', exact: true })).toHaveCount(0);
  // The cashier decides: handed over, it leaves the strip.
  await card.getByRole('button', { name: 'Teslim edildi', exact: true }).click();
  await expect(c.getByRole('status').filter({ hasText: 'teslim edildi.' }).first()).toBeVisible();
  await expect(card).toHaveCount(0);
  const order = (await (await c.request.get('/api/staff/state')).json()).orders.find((o: any) => o.takeaway?.tableId === tableId);
  expect(order?.status ?? 'served').toBe('served');
  expect(errors).toEqual([]);
  await waiter.context.close(); await cashier.context.close();
});
