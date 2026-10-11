import { test, expect } from '@playwright/test';
import { ensureSetup } from './helpers';
test('kitchen approves a late customer cancellation with a compact action and safe retry', async ({ page, browser }) => {
 await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
 await ensureSetup(page.request);
 await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
 const state = await (await page.request.get('/api/staff/state')).json();
 const guest = await browser.newContext();
 try {
  const session = await (await guest.request.post('/api/guest/session', { data: { token: state.tables[0].token } })).json();
  const headers = { 'X-Guest-Session': session.session };
  await page.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } });
  await page.goto('/');
  await expect(page.locator('.kitchen-board')).toBeVisible();
  const placed = await guest.request.post('/api/guest/orders', { headers, data: { requestId: 'kitchen-cancel-order', tableId: state.tables[0].id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } });
  expect(placed.ok()).toBe(true);
  const order = await placed.json();
  const cancelled = await guest.request.post('/api/guest/cancel', { headers, data: { requestId: 'kitchen-cancel-request', orderId: order.orderId, version: 1 } });
  expect(await cancelled.json()).toEqual({ requested: true });
  const customer = await guest.newPage();
  await customer.setViewportSize({ width: 390, height: 844 });
  await customer.goto(`/m/${state.tables[0].token}`);
  await customer.getByRole('button', { name: /Siparişlerim/ }).click();
  await expect(customer.locator('.customer-cancel-status')).toContainText('İptal talebi onay bekliyor');
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByRole('button', { name: 'İptali onayla', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // The decision replaces the preparation button instead of a locked waiting button.
  await expect(page.locator('.kitchen-card .btn').filter({ hasText: /Hazırlamaya başla|İptal talebi bekleniyor/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reddet', exact: true }).click();
  await page.getByLabel('Kısa açıklama', { exact: true }).fill('Hazırlık tamamlandı.');
  await page.getByRole('button', { name: 'Talebi reddet', exact: true }).click();
  await expect(page.locator('.kitchen-cancellation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hazırlamaya başla', exact: true })).toBeEnabled();
  await expect(customer.locator('.customer-cancel-status')).toContainText('İptal talebi onaylanmadı');
  await expect(customer.locator('.customer-cancel-status')).toContainText('Hazırlık tamamlandı.');
  expect(await customer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const declined = await (await guest.request.get('/api/guest/state', { headers })).json();
  const declinedOrder = declined.orders.find((o: any) => o.id === order.orderId);
  expect(declinedOrder.cancelDeclineReason).toBe('Hazırlık tamamlandı.');
  expect(declinedOrder.status).toBe('new');
  // K-I (9 Ekim kullanıcı testi): after a declined request the guest is not offered "Siparişi iptal et" again; the server refuses a new one.
  await expect(customer.getByRole('button', { name: 'Siparişi iptal et' })).toHaveCount(0);
  const repeat = await guest.request.post('/api/guest/cancel', { headers, data: { requestId: 'kitchen-cancel-repeat', orderId: order.orderId, version: declinedOrder.version } });
  expect(repeat.status()).toBe(409);
  expect((await repeat.json()).code).toBe('CANCEL_DECLINED');
  // A second late order: the kitchen approves its cancellation request.
  const placedNext = await guest.request.post('/api/guest/orders', { headers, data: { requestId: 'kitchen-cancel-order-2', tableId: state.tables[0].id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } });
  expect(placedNext.ok()).toBe(true);
  const next = await placedNext.json();
  expect(await (await guest.request.post('/api/guest/cancel', { headers, data: { requestId: 'kitchen-cancel-request-2', orderId: next.orderId, version: 1 } })).json()).toEqual({ requested: true });
  const nextCard = page.locator(`.kitchen-card[data-order="${next.orderId}"]`);
  await expect(nextCard.getByRole('button', { name: 'İptali onayla', exact: true })).toBeVisible();
  await page.route('**/api/staff/cancel', async route => { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort(); });
  await nextCard.getByRole('button', { name: 'İptali onayla', exact: true }).click();
  await expect(nextCard).toHaveCount(0);
  const guestCard = (n: number) => customer.locator('.customer-order').filter({ has: customer.locator('h3', { hasText: new RegExp(`#${n}$`) }) });
  await expect(guestCard(next.number).locator('.customer-cancel-status')).toContainText('Sipariş iptal edildi');
  await customer.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(guestCard(next.number).locator('.customer-cancel-status')).toContainText('Order cancelled');
  await expect(guestCard(declinedOrder.number).locator('.customer-cancel-status')).toContainText('Cancellation not approved');
  await expect(customer.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  const result = await (await guest.request.get('/api/guest/state', { headers })).json();
  expect(result.orders.find((o: any) => o.id === next.orderId).status).toBe('cancelled');
  expect(result.orders.find((o: any) => o.id === order.orderId).status).toBe('new');
 } finally { await guest.close(); }
});
