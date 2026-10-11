import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ensureSetup } from './helpers';
let owner: APIRequestContext;
test.beforeAll(async ({ playwright }) => {
  owner = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? '3100'}` });
  expect((await owner.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } })).ok()).toBe(true);
  await ensureSetup(owner);
});
test.afterAll(async () => { await owner.dispose(); });
async function place(page: Page, seconds: number) {
  expect((await owner.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: false, changeSeconds: seconds, commissionBps: 0 } })).ok()).toBe(true);
  const state = await (await owner.get('/api/staff/state')).json(), table = state.tables.find((t: any) => !t.account && !t.needsCleaning);
  const session = await (await page.request.post('/api/guest/session', { data: { token: table.token } })).json();
  const response = await page.request.post('/api/guest/orders', { headers: { 'X-Guest-Session': session.session }, data: { requestId: crypto.randomUUID(), tableId: table.id, expectedTotal: 8500, lines: [{ productId: 'herbal', quantity: 1, selections: [] }] } });
  expect(response.ok()).toBe(true); const { orderId } = await response.json();
  await page.goto(`/m/${table.token}`); await page.getByRole('button', { name: /Siparişlerim/ }).click();
  return { table, orderId, session };
}
const count = (page: Page) => page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('mola.pending-cancel.')).length);

for (const approval of [false, true]) test(`accepted cancellation survives reload: ${approval ? 'staff approval' : 'immediate and closed account'}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { orderId, table } = await place(page, approval ? 0 : 60);
  let original: any;
  await page.route('**/api/guest/cancel', async route => { original = route.request().postDataJSON(); const accepted = await route.fetch(); expect(accepted.ok()).toBe(true); expect((await accepted.json()).requested).toBe(approval); await route.abort('failed'); await page.unroute('**/api/guest/cancel'); });
  await page.getByRole('button', { name: 'Siparişi iptal et' }).click(); await page.getByRole('button', { name: 'Emin misiniz? Evet, iptal et' }).click();
  await expect(page.getByRole('button', { name: 'İptal talebini yeniden kontrol et' })).toBeVisible();
  let order = (await (await owner.get('/api/staff/state')).json()).orders.find((o: any) => o.id === orderId);
  expect(order.version).toBe(2); expect(order.status).toBe(approval ? 'new' : 'cancelled');
  if (!approval) expect((await owner.post('/api/staff/close-empty', { data: { requestId: crypto.randomUUID(), accountId: order.accountId } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('dialog')).toContainText('sonucu henüz doğrulanmadı');
  if (!approval) { await page.screenshot({ path: info.outputPath('cancel-recovery-mobile.png') }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  const retry = page.waitForRequest(r => r.url().endsWith('/api/guest/cancel') && r.method() === 'POST');
  await page.getByRole('button', { name: 'İptal talebini yeniden kontrol et' }).click();
  expect((await retry).postDataJSON()).toEqual(original);
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(await count(page)).toBe(0);
  await expect(page.getByText(approval ? 'İptal talebi onay bekliyor' : 'Siparişiniz iptal edildi.')).toBeVisible();
  const after = await (await owner.get('/api/staff/state')).json();
  order = after.orders.find((o: any) => o.id === orderId);
  if (approval) {
    expect(order.version).toBe(2); expect(order.status).toBe('new');
    await expect(page.getByRole('button', { name: 'İptal talebi gönderildi', exact: true })).toBeDisabled();
  } else {
    expect(order).toBeUndefined(); // Closed cancelled orders leave the active staff board.
    expect(after.tables.find((t: any) => t.id === table.id).account).toBeNull();
  }
});

for (const changed of [false, true]) test(`unreceived cancellation ${changed ? 'rejects a changed browser' : 'after deadline requests approval'}`, async ({ page, context }) => {
  const { orderId, session } = await place(page, changed ? 60 : 3);
  let original: any;
  await page.route('**/api/guest/cancel', async route => { original = route.request().postDataJSON(); await route.abort('failed'); await page.unroute('**/api/guest/cancel'); });
  await page.getByRole('button', { name: 'Siparişi iptal et' }).click(); await page.getByRole('button', { name: 'Emin misiniz? Evet, iptal et' }).click();
  await expect(page.getByRole('button', { name: 'İptal talebini yeniden kontrol et' })).toBeVisible();
  if (changed) await context.clearCookies();
  else await expect.poll(async () => (await (await page.request.get('/api/guest/state', { headers: { 'X-Guest-Session': session.session } })).json()).orders.find((o: any) => o.id === orderId).canEdit).toBe(false);
  await page.reload();
  const retry = page.waitForRequest(r => r.url().endsWith('/api/guest/cancel') && r.method() === 'POST');
  await page.getByRole('button', { name: 'İptal talebini yeniden kontrol et' }).click();
  expect((await retry).postDataJSON()).toEqual(original);
  if (changed) {
    await expect(page.getByRole('dialog')).toContainText('önceki masa veya tarayıcı oturumuna ait');
    expect(await count(page)).toBe(1);
    await page.getByRole('button', { name: 'İşletmeyle kontrol ettim, talebi kapat' }).click();
  } else await expect(page.getByText('İptal talebi onay bekliyor')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(await count(page)).toBe(0);
  const order = (await (await owner.get('/api/staff/state')).json()).orders.find((o: any) => o.id === orderId);
  expect(order.status).toBe('new'); expect(order.version).toBe(changed ? 1 : 2); expect(!!order.cancelRequested).toBe(!changed);
});
