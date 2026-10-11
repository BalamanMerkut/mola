import { test, expect, type APIRequestContext } from '@playwright/test';
import { ensureSetup } from './helpers';
let ownerCookies: Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'];
test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? '3100'}` });
  expect((await request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } })).ok()).toBe(true);
  await ensureSetup(request); ownerCookies = (await request.storageState()).cookies; await request.dispose();
});
test.beforeEach(async ({ context }) => { await context.addCookies(ownerCookies); });

test('accepted order survives reload, menu removal and account closure without a second order', async ({ page, browser }, info) => {
  const initial = await (await page.request.get('/api/staff/state')).json();
  const table = initial.tables.find((t: any) => !t.account && !t.needsCleaning), product = initial.products.find((p: any) => p.id === 'herbal');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await context.newPage(); await guest.goto(`/m/${table.token}`);
    await guest.getByRole('button', { name: /Ihlamur/ }).click(); await guest.getByRole('button', { name: /Sepete ekle/ }).click();
    await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
    let originalBody: any;
    await guest.route('**/api/guest/orders', async route => { originalBody = route.request().postDataJSON(); const accepted = await route.fetch(); expect(accepted.ok()).toBe(true); await route.abort('failed'); await guest.unroute('**/api/guest/orders'); });
    await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Gönderimi yeniden kontrol et' })).toBeVisible();
    const state = await (await page.request.get('/api/staff/state')).json();
    const account = state.tables.find((t: any) => t.id === table.id).account;
    expect((await page.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: account.id, version: account.version, method: 'cash', amount: 8500, tendered: 8500 } })).ok()).toBe(true);
    expect((await page.request.post('/api/staff/products', { data: { requestId: crypto.randomUUID(), revision: state.revision, id: product.id, action: 'unpublish', product: { ...product, published: false } } })).ok()).toBe(true);
    await guest.reload();
    const cart = guest.getByRole('dialog', { name: 'Sepetiniz' });
    await expect(cart).toContainText('Önceki gönderimin sonucu');
    await expect(cart).toContainText('Ihlamur'); await expect(cart.locator('.total-line')).toContainText('₺85');
    await expect(cart.getByRole('button', { name: 'Ürünü kaldır' })).toBeDisabled();
    await guest.screenshot({ path: info.outputPath('recovered-order-mobile.png') });
    const request = guest.waitForRequest(r => r.url().endsWith('/api/guest/orders') && r.method() === 'POST');
    await guest.getByRole('button', { name: 'Gönderimi yeniden kontrol et' }).click();
    expect((await request).postDataJSON()).toEqual(originalBody);
    await expect(guest.getByText(/Sipariş #\d+ alındı/)).toBeVisible();
    await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
    expect(await guest.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('mola.pending-order.')).length)).toBe(0);
    const after = await (await page.request.get('/api/staff/state')).json();
    expect(after.orders.filter((o: any) => !initial.orders.some((old: any) => old.id === o.id))).toHaveLength(1);
    expect(after.tables.find((t: any) => t.id === table.id).account).toBeNull();
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    const current = await (await page.request.get('/api/staff/state')).json();
    await page.request.post('/api/staff/products', { data: { requestId: crypto.randomUUID(), revision: current.revision, id: product.id, action: 'publish', product: { ...product, published: true } } });
    await context.close();
  }
});

for (const clearIdentity of [false, true]) test(`unreceived submission after reload ${clearIdentity ? 'cannot move to another browser identity' : 'reuses its request and creates exactly one order'}`, async ({ page, browser }) => {
  const initial = await (await page.request.get('/api/staff/state')).json();
  const table = initial.tables.find((t: any) => !t.account && !t.needsCleaning);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage(); await guest.goto(`/m/${table.token}`);
    await guest.getByRole('button', { name: /Ihlamur/ }).click(); await guest.getByRole('button', { name: /Sepete ekle/ }).click();
    await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
    let originalBody: any;
    await guest.route('**/api/guest/orders', async route => { originalBody = route.request().postDataJSON(); await route.abort('failed'); await guest.unroute('**/api/guest/orders'); });
    await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Gönderimi yeniden kontrol et' })).toBeVisible();
    if (clearIdentity) await context.clearCookies();
    await guest.reload();
    const retry = guest.waitForRequest(r => r.url().endsWith('/api/guest/orders') && r.method() === 'POST');
    await guest.getByRole('button', { name: 'Gönderimi yeniden kontrol et' }).click();
    expect((await retry).postDataJSON()).toEqual(originalBody);
    if (clearIdentity) {
      await expect(guest.getByRole('dialog')).toContainText('önceki masa veya tarayıcı oturumuna ait');
      await expect(guest.getByRole('button', { name: 'Gönderimi yeniden kontrol et' })).toBeDisabled();
      await guest.getByRole('button', { name: 'İşletmeyle kontrol ettim, gönderimi kapat' }).click();
      await expect(guest.getByRole('dialog')).toHaveCount(0);
    } else await expect(guest.getByText(/Sipariş #\d+ alındı/)).toBeVisible();
    const after = await (await page.request.get('/api/staff/state')).json();
    expect(after.orders.length - initial.orders.length).toBe(clearIdentity ? 0 : 1);
  } finally { await context.close(); }
});
