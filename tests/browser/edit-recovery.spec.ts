import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ensureSetup } from './helpers';
let owner: APIRequestContext;
test.beforeAll(async ({ playwright }) => {
  owner = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? '3100'}` });
  expect((await owner.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } })).ok()).toBe(true);
  await ensureSetup(owner);
});
test.afterAll(async () => { await owner.dispose(); });
async function edit(page: Page, seconds = 60) {
  expect((await owner.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: false, changeSeconds: seconds, commissionBps: 0 } })).ok()).toBe(true);
  const state = await (await owner.get('/api/staff/state')).json();
  const table = state.tables.find((t: any) => !t.account && !t.needsCleaning);
  const session = await (await page.request.post('/api/guest/session', { data: { token: table.token } })).json();
  const result = await page.request.post('/api/guest/orders', { headers: { 'X-Guest-Session': session.session }, data: { requestId: crypto.randomUUID(), guestContext: session.guestContext, tableId: table.id, expectedTotal: 8500, lines: [{ productId: 'herbal', quantity: 1, selections: [] }] } });
  expect(result.ok()).toBe(true); const { orderId } = await result.json();
  await page.goto(`/m/${table.token}`);
  await page.getByRole('button', { name: /Siparişlerim/ }).click();
  await page.getByRole('button', { name: /Siparişi değiştir/ }).click();
  await page.getByLabel('Ihlamur adet').fill('2');
  return { table, orderId, session };
}
const pendingCount = (page: Page) => page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('mola.pending-edit.')).length);

test('accepted edit recovers after reload and closed account without repeating the change', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { table, orderId } = await edit(page);
  let original: any;
  await page.route('**/api/guest/orders/edit', async route => { original = route.request().postDataJSON(); expect((await route.fetch()).ok()).toBe(true); await route.abort('failed'); await page.unroute('**/api/guest/orders/edit'); });
  await page.getByRole('button', { name: 'Değişiklikleri kaydet' }).click();
  await expect(page.getByRole('button', { name: 'Değişikliği yeniden kontrol et' })).toBeVisible();
  const state = await (await owner.get('/api/staff/state')).json(), account = state.tables.find((t: any) => t.id === table.id).account;
  expect((await owner.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: account.id, version: account.version, amount: 17000, tendered: 17000, method: 'cash' } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('dialog')).toContainText('2 × Ihlamur');
  await expect(page.getByRole('dialog')).toContainText('₺170');
  await page.screenshot({ path: info.outputPath('edit-recovery-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const retry = page.waitForRequest(r => r.url().endsWith('/api/guest/orders/edit') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Değişikliği yeniden kontrol et' }).click();
  expect((await retry).postDataJSON()).toEqual(original);
  await expect(page.getByText('Siparişiniz güncellendi.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(await pendingCount(page)).toBe(0);
  const after = await (await owner.get('/api/staff/state')).json();
  expect(after.orders.find((o: any) => o.id === orderId).version).toBe(2);
  expect(after.tables.find((t: any) => t.id === table.id).account).toBeNull();
});

for (const scenario of ['retry', 'expired', 'browser-changed'] as const) test(`unreceived edit after reload: ${scenario}`, async ({ page, context }) => {
  const { orderId, session } = await edit(page, scenario === 'expired' ? 3 : 60);
  let original: any;
  await page.route('**/api/guest/orders/edit', async route => { original = route.request().postDataJSON(); await route.abort('failed'); await page.unroute('**/api/guest/orders/edit'); });
  await page.getByRole('button', { name: 'Değişiklikleri kaydet' }).click();
  await expect(page.getByRole('button', { name: 'Değişikliği yeniden kontrol et' })).toBeVisible();
  if (scenario === 'expired') await expect.poll(async () => {
    const s = await (await page.request.get('/api/guest/state', { headers: { 'X-Guest-Session': session.session } })).json();
    return s.orders.find((o: any) => o.id === orderId).canEdit;
  }).toBe(false);
  if (scenario === 'browser-changed') await context.clearCookies();
  await page.reload();
  const retry = page.waitForRequest(r => r.url().endsWith('/api/guest/orders/edit') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Değişikliği yeniden kontrol et' }).click();
  expect((await retry).postDataJSON()).toEqual(original);
  if (scenario === 'retry') await expect(page.getByText('Siparişiniz güncellendi.')).toBeVisible();
  else if (scenario === 'expired') {
    await expect(page.getByRole('dialog')).toContainText('Sipariş değiştirme süresi doldu.');
    await expect(page.getByRole('button', { name: 'Değişikliği yeniden kontrol et' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Siparişe dön', exact: true }).click();
  } else {
    await expect(page.getByRole('dialog')).toContainText('önceki masa veya tarayıcı oturumuna ait');
    expect(await pendingCount(page)).toBe(1);
    await page.getByRole('button', { name: 'İşletmeyle kontrol ettim, değişikliği kapat' }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(await pendingCount(page)).toBe(0);
  const order = (await (await owner.get('/api/staff/state')).json()).orders.find((o: any) => o.id === orderId);
  expect(order.version).toBe(scenario === 'retry' ? 2 : 1); expect(order.total).toBe(scenario === 'retry' ? 17000 : 8500);
});
