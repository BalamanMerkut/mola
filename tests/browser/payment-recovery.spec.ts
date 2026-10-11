import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ensureSetup } from './helpers';
let owner: APIRequestContext;
let ownerCookies: Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'];
let cashierCookies: typeof ownerCookies;
test.beforeAll(async ({ playwright }) => {
  owner = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? '3100'}` });
  expect((await owner.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } })).ok()).toBe(true);
  await ensureSetup(owner); ownerCookies = (await owner.storageState()).cookies;
  expect((await owner.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: false, changeSeconds: 0, commissionBps: 0 } })).ok()).toBe(true);
  const cashier = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? '3100'}` });
  expect((await cashier.post('/api/login', { data: { username: 'kasiyer', password: 'MolaDemo!2026' } })).ok()).toBe(true);
  cashierCookies = (await cashier.storageState()).cookies; await cashier.dispose();
});
test.afterAll(async () => { await owner.dispose(); });
test.beforeEach(async ({ context }) => { await context.addCookies(cashierCookies); });
async function openPayment(page: Page, quantity = 1) {
  const initial = await (await owner.get('/api/staff/state')).json();
  const table = initial.tables.find((t: any) => !t.account && !t.needsCleaning);
  expect((await owner.post('/api/staff/orders', { data: { requestId: crypto.randomUUID(), tableId: table.id, expectedTotal: 8500 * quantity, lines: [{ productId: 'herbal', quantity, selections: [] }] } })).ok()).toBe(true);
  await page.goto('/');
  // A phone has the small tiles (K-S, 9 Ekim: every phone, not only the waiter's); wider screens the cards.
  await page.locator(`.floor-tile[data-table="${table.id}"]`).or(page.locator('.table-card').filter({ has: page.getByRole('heading', { name: table.name, exact: true }) })).click();
  await page.getByRole('button', { name: 'Ödeme al', exact: true }).click();
  return table;
}
const storedCount = (page: Page) => page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('mola.pending-payment.')).length);

test('cashier recovers a closed account after lost full-payment response and reload', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const table = await openPayment(page);
  await page.getByLabel('Alınan nakit (TL)').fill('100');
  let original: any, accepted: any;
  await page.route('**/api/staff/payments', async route => { original = route.request().postDataJSON(); const response = await route.fetch(); expect(response.ok()).toBe(true); accepted = await response.json(); await route.abort('failed'); await page.unroute('**/api/staff/payments'); });
  await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click();
  await expect(page.getByRole('dialog', { name: table.name + ' · Tahsilat kontrolü' })).toBeVisible();
  expect((await (await owner.get('/api/staff/state')).json()).tables.find((t: any) => t.id === table.id).account).toBeNull();
  await page.reload();
  await expect(page.getByRole('dialog')).toContainText('Önceki tahsilatın sonucu');
  await expect(page.locator('.payment-balance')).toContainText('₺85');
  await page.screenshot({ path: info.outputPath('cashier-payment-recovery-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const retry = page.waitForRequest(r => r.url().endsWith('/api/staff/payments') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Tahsilatı yeniden kontrol et' }).click();
  expect((await retry).postDataJSON()).toEqual(original);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Hesap kapandı. Para üstü: ₺15')).toBeVisible();
  expect(await storedCount(page)).toBe(0);
  expect(await (await page.request.post('/api/staff/payments', { data: original })).json()).toEqual(accepted);
});

test('selected partial payment restores exact products and stays open for the remaining items', async ({ page }) => {
  await openPayment(page, 3);
  await page.getByRole('button', { name: 'Ürün seç', exact: true }).click();
  await page.getByRole('button', { name: 'Ihlamur bir adet ekle' }).click();
  await page.getByLabel('Alınan nakit (TL)').fill('100');
  let original: any;
  await page.route('**/api/staff/payments', async route => { original = route.request().postDataJSON(); expect((await route.fetch()).ok()).toBe(true); await route.abort('failed'); await page.unroute('**/api/staff/payments'); });
  await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tahsilatı yeniden kontrol et' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog')).toContainText('1 adet ürün seçildi');
  const retry = page.waitForRequest(r => r.url().endsWith('/api/staff/payments') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Tahsilatı yeniden kontrol et' }).click();
  expect((await retry).postDataJSON()).toEqual(original);
  await expect(page.getByRole('button', { name: 'Ürün seç', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.payment-item')).toContainText('1 / 3 adet ödendi');
  await expect(page.locator('.payment-balance')).toContainText('₺170');
  expect(await storedCount(page)).toBe(0);
  await page.getByRole('button', { name: 'Ihlamur bir adet ekle' }).click(); await page.getByRole('button', { name: 'Ihlamur bir adet ekle' }).click();
  await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('unreceived payment stays with its employee after account switching and can then be completed once', async ({ page, context }) => {
  const table = await openPayment(page);
  await page.getByRole('button', { name: 'Kart', exact: true }).click();
  let original: any;
  await page.route('**/api/staff/payments', async route => { original = route.request().postDataJSON(); await route.abort('failed'); await page.unroute('**/api/staff/payments'); });
  await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tahsilatı yeniden kontrol et' })).toBeVisible();
  await context.addCookies(ownerCookies); await page.reload();
  // The owner's Masalar (the counter's compact one at 1280 px: its one-line summary, no heading).
  await expect(page.getByLabel('Günün özeti')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await page.request.post('/api/staff/payments', { data: original })).status()).toBe(409);
  expect((await (await owner.get('/api/staff/state')).json()).tables.find((t: any) => t.id === table.id).account.paid).toBe(0);
  await context.addCookies(cashierCookies); await page.reload();
  await expect(page.getByRole('dialog')).toContainText('KART TAHSİLATI');
  const retry = page.waitForRequest(r => r.url().endsWith('/api/staff/payments') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Tahsilatı yeniden kontrol et' }).click();
  expect((await retry).postDataJSON()).toEqual(original);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await storedCount(page)).toBe(0);
  expect((await (await owner.get('/api/staff/state')).json()).tables.find((t: any) => t.id === table.id).account).toBeNull();
});

test('stale unreceived payment is rejected and cannot silently settle a changed bill', async ({ page }) => {
  const table = await openPayment(page, 2);
  await page.route('**/api/staff/payments', async route => { await route.abort('failed'); await page.unroute('**/api/staff/payments'); });
  await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tahsilatı yeniden kontrol et' })).toBeVisible();
  const account = (await (await owner.get('/api/staff/state')).json()).tables.find((t: any) => t.id === table.id).account;
  expect((await owner.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: account.id, version: account.version, amount: 8500, tendered: 8500, method: 'cash' } })).ok()).toBe(true);
  await page.reload(); await page.getByRole('button', { name: 'Tahsilatı yeniden kontrol et' }).click();
  await expect(page.getByRole('dialog')).toContainText('Hesap güncellendi. Güncel tutarı kontrol edin.');
  expect(await storedCount(page)).toBe(0);
  const current = (await (await owner.get('/api/staff/state')).json()).tables.find((t: any) => t.id === table.id).account;
  expect(current.balance).toBe(8500); expect(current.paid).toBe(8500);
  await expect(page.getByRole('button', { name: 'Kapat', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});


test('item list can recover from a failed read without closing payment or recording a payment', async ({ page }) => {
  await openPayment(page, 2);
  let payments = 0;
  page.on('request', request => { if (request.url().endsWith('/api/staff/payments') && request.method() === 'POST') payments++; });
  await page.route('**/api/staff/accounts/*/items', route => route.abort());
  await page.getByRole('button', { name: 'Ürün seç', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Yeniden yükle', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true })).toBeDisabled();
  await page.unroute('**/api/staff/accounts/*/items');
  await page.getByRole('button', { name: 'Yeniden yükle', exact: true }).click();
  await expect(page.getByLabel('Ihlamur ödenecek adet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yeniden yükle', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ihlamur bir adet ekle' }).click();
  await expect(page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true })).toBeEnabled();
  expect(payments).toBe(0);
  await expect(page.getByRole('dialog')).toBeVisible();
});


test('another cashier payment requires reviewing the current balance before submitting', async ({ page }) => {
  const table = await openPayment(page, 2);
  await page.getByRole('button', { name: 'Bir kısmı', exact: true }).click();
  await page.getByLabel('Tahsil edilecek tutar (TL)').fill('170');
  const account = (await (await owner.get('/api/staff/state')).json()).tables.find((t: any) => t.id === table.id).account;
  expect((await owner.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: account.id, version: account.version, amount: 8500, tendered: 8500, method: 'cash' } })).ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Güncel hesabı kullan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true })).toBeDisabled();
  await expect(page.locator('.payment-balance')).toContainText('₺85');
  await page.getByRole('button', { name: 'Güncel hesabı kullan' }).click();
  await expect(page.getByLabel('Tahsil edilecek tutar (TL)')).toHaveValue('85');
  await expect(page.getByLabel('Alınan nakit (TL)')).toHaveValue('85');
  await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await (await owner.get('/api/staff/state')).json()).tables.find((t: any) => t.id === table.id).account).toBeNull();
});
