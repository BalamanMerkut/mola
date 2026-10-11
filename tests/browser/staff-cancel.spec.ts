import { test, expect, type Browser, type Page } from '@playwright/test';
import { ensureSetup } from './helpers';

const PASSWORD = 'MolaDemo!2026';
/** A signed-in page of its own (own cookies) for one role. */
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true }).first()).toBeAttached();
  return page;
}
const staffOrder = async (page: Page, tableId: string, lines: { productId: string; quantity: number }[]) => {
  const prices: Record<string, number> = { tea: 3500, lemonade: 12000, herbal: 8500 };
  const r = await page.request.post('/api/staff/orders', { data: { requestId: crypto.randomUUID().replace(/-/g, ''), tableId, lines: lines.map(l => ({ ...l, selections: [] })), expectedTotal: lines.reduce((n, l) => n + prices[l.productId] * l.quantity, 0) } });
  expect(r.ok()).toBe(true);
  return r.json() as Promise<{ orderId: string; number: number; accountId: string }>;
};
const openTable = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Masalar', exact: true }).click();
  await page.locator('.table-card', { hasText: name }).click();
  await expect(page.getByRole('dialog', { name })).toBeVisible();
};

test('waiter cancels part of an order with a reason, the kitchen card updates and the kitchen cancels the rest; the cashier cannot', async ({ page, browser }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  const waiter = await signedIn(browser, 'garson'), kitchen = await signedIn(browser, 'mutfak'), cashier = await signedIn(browser, 'kasiyer');
  try {
    const order = await staffOrder(waiter, 'table-1', [{ productId: 'tea', quantity: 3 }, { productId: 'lemonade', quantity: 1 }]);
    await openTable(waiter, 'Masa 01');
    await waiter.getByRole('button', { name: `Sipariş #${order.number} · iptal et` }).click();
    const dialog = waiter.getByRole('dialog', { name: `Sipariş #${order.number} · İptal` });
    await dialog.getByRole('button', { name: 'Demleme Çay · bir daha iptal' }).click();
    await dialog.getByRole('button', { name: 'Demleme Çay · bir daha iptal' }).click();
    // No reason yet: the button waits and says why.
    await expect(dialog.getByRole('button', { name: 'Seçilenleri iptal et' })).toBeDisabled();
    await expect(dialog.getByText('Bir neden seçin ya da yazın.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Yanlış sipariş', exact: true }).click();
    await dialog.getByRole('button', { name: 'Seçilenleri iptal et' }).click();
    await expect(waiter.getByRole('status').filter({ hasText: `Sipariş #${order.number}: 2 ürün iptal edildi.` })).toBeVisible();
    expect(await waiter.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // The kitchen card shows what is left and, struck through, what was cancelled and why.
    const card = kitchen.locator('.kitchen-card', { hasText: `#${order.number}` });
    await expect(card.locator('.line-cancelled')).toContainText('İptal edildi · Yanlış sipariş');
    await expect(card.locator('.order-line:not(.line-cancelled)').first()).toContainText('1');
    await card.getByRole('button', { name: `Sipariş #${order.number} · iptal et` }).click();
    const kitchenDialog = kitchen.getByRole('dialog', { name: `Sipariş #${order.number} · İptal` });
    await kitchenDialog.getByRole('button', { name: 'Siparişin tamamını seç' }).click();
    await kitchenDialog.getByLabel('Başka bir neden').fill('Müşteri masadan kalktı');
    await kitchenDialog.getByRole('button', { name: 'Siparişi iptal et' }).click();
    await expect(kitchen.locator('.kitchen-card', { hasText: `#${order.number}` })).toHaveCount(0);

    // The cashier sees the bill but has no cancel action; the server refuses it too.
    await openTable(cashier, 'Masa 01');
    await expect(cashier.getByRole('button', { name: /iptal et/ })).toHaveCount(0);
    const refused = await cashier.request.post('/api/staff/orders/cancel', { data: { requestId: crypto.randomUUID().replace(/-/g, ''), orderId: order.orderId, version: 1, reason: 'Yanlış sipariş' } });
    expect(refused.status()).toBe(403);
    const state = await (await page.request.get('/api/staff/state')).json();
    const saved = state.orders.find((o: { id: string }) => o.id === order.orderId);
    expect(saved.status).toBe('cancelled'); expect(saved.cancelReason).toBe('Müşteri masadan kalktı'); expect(saved.cancellations[0].reason).toBe('Yanlış sipariş');
  } finally { for (const p of [waiter, kitchen, cashier]) await p.context().close(); }
});

test('paid items cannot be cancelled: the window explains the refund path and the server refuses', async ({ page, browser }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  const waiter = await signedIn(browser, 'garson'), cashier = await signedIn(browser, 'kasiyer');
  try {
    const order = await staffOrder(waiter, 'table-2', [{ productId: 'tea', quantity: 2 }, { productId: 'herbal', quantity: 1 }]);
    const state = await (await cashier.request.get('/api/staff/state')).json();
    const o = state.orders.find((x: { id: string }) => x.id === order.orderId), table = state.tables.find((t: { id: string }) => t.id === 'table-2');
    const paid = await cashier.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID().replace(/-/g, ''), accountId: table.account.id, version: table.account.version, method: 'cash', amount: 3500, tendered: 3500, selections: [{ orderId: o.id, lineId: o.lines[0].id, quantity: 1 }] } });
    expect(paid.ok()).toBe(true);
    await openTable(waiter, 'Masa 02');
    await waiter.getByRole('button', { name: `Sipariş #${order.number} · iptal et` }).click();
    const dialog = waiter.getByRole('dialog', { name: `Sipariş #${order.number} · İptal` });
    await expect(dialog.getByText('1 adet ödendi · iptal edilemez')).toBeVisible();
    await expect(dialog.getByText(/Kasa ve giderler → İadeler/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Siparişin tamamını seç' })).toHaveCount(0);
    // Only the unpaid tea can be chosen.
    await dialog.getByRole('button', { name: 'Demleme Çay · bir daha iptal' }).click();
    await expect(dialog.getByRole('button', { name: 'Demleme Çay · bir daha iptal' })).toBeDisabled();
    const fresh = (await (await waiter.request.get('/api/staff/state')).json()).orders.find((x: { id: string }) => x.id === order.orderId);
    const refused = await waiter.request.post('/api/staff/orders/cancel', { data: { requestId: crypto.randomUUID().replace(/-/g, ''), orderId: order.orderId, version: fresh.version, reason: 'Yanlış sipariş', lines: [{ lineId: fresh.lines[0].id, quantity: 2 }] } });
    expect(refused.status()).toBe(409); expect((await refused.json()).code).toBe('PAID_ITEMS');
    await dialog.getByRole('button', { name: 'Ürün bitti', exact: true }).click();
    await dialog.getByRole('button', { name: 'Seçilenleri iptal et' }).click();
    await expect(waiter.getByRole('status').filter({ hasText: `Sipariş #${order.number}: 1 ürün iptal edildi.` })).toBeVisible();
  } finally { for (const p of [waiter, cashier]) await p.context().close(); }
});

test('the kitchen approves QR orders in its own section; the cashier sees only the state', async ({ page, browser }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null, waiterApproval: true } });
  const state = await (await page.request.get('/api/staff/state')).json();
  const kitchen = await signedIn(browser, 'mutfak', { width: 768, height: 1024 }), cashier = await signedIn(browser, 'kasiyer');
  const guest = await browser.newContext();
  try {
    const table = state.tables[2];
    const session = await (await guest.request.post('/api/guest/session', { data: { token: table.token } })).json();
    const placed = await guest.request.post('/api/guest/orders', { headers: { 'X-Guest-Session': session.session }, data: { requestId: 'kitchen-approval-order', tableId: table.id, lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 } });
    expect(placed.ok()).toBe(true);
    const { number } = await placed.json();
    const queue = kitchen.getByRole('region', { name: 'Onay bekleyen QR siparişleri' });
    await expect(queue).toContainText(`${table.name} · #${number}`);
    await expect(queue).not.toContainText('₺');
    expect(await kitchen.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await openTable(cashier, table.name);
    await expect(cashier.getByText('Garson onayı bekleniyor')).toBeVisible();
    await expect(cashier.getByRole('button', { name: 'Onayla ve mutfağa gönder' })).toHaveCount(0);
    await queue.getByRole('button', { name: 'Onayla ve mutfağa gönder' }).click();
    await expect(kitchen.getByRole('region', { name: 'Onay bekleyen QR siparişleri' })).toHaveCount(0);
    await expect(kitchen.locator('.kitchen-column').first().locator('.kitchen-card', { hasText: `#${number}` })).toBeVisible();
  } finally { await guest.close(); for (const p of [kitchen, cashier]) await p.context().close(); }
});

test('a table waiting for cleaning: the cashier sees it and may clean it too (owner\'s decision); the waiter cleans it', async ({ page, browser }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null, cleaningEnabled: true } });
  const waiter = await signedIn(browser, 'garson'), cashier = await signedIn(browser, 'kasiyer');
  try {
    await staffOrder(waiter, 'table-4', [{ productId: 'tea', quantity: 1 }]);
    const table = (await (await cashier.request.get('/api/staff/state')).json()).tables.find((t: { id: string }) => t.id === 'table-4');
    expect((await cashier.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID().replace(/-/g, ''), accountId: table.account.id, version: table.account.version, method: 'cash', amount: 3500, tendered: 3500 } })).ok()).toBe(true);
    await openTable(cashier, 'Masa 04');
    await expect(cashier.getByText('Masa temizlik bekliyor')).toBeVisible();
    await expect(cashier.getByText('Masa temizlendikten sonra “Temizlendi” ile yeniden siparişe açılır.')).toBeVisible();
    // Since 5 October the cashier may mark it too when no waiter is around (tests/browser/manager-role.spec.ts does it).
    await expect(cashier.getByRole('button', { name: 'Temizlendi · Masayı hazırla' })).toBeVisible();
    await openTable(waiter, 'Masa 04');
    await waiter.getByRole('button', { name: 'Temizlendi · Masayı hazırla' }).click();
    await expect(waiter.getByRole('status').filter({ hasText: 'Masa siparişe hazır.' })).toBeVisible();
  } finally { for (const p of [waiter, cashier]) await p.context().close(); }
});
