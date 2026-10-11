import { test, expect } from '@playwright/test';
import { ensureSetup } from './helpers';
test('customer scheduled reads pause while hidden, refresh on return and do not overlap slow reads', async ({ page }) => {
 await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
 await ensureSetup(page.request);
 const state = await (await page.request.get('/api/staff/state')).json();
 let requests = 0;
 page.on('request', req => { if (req.url().endsWith('/api/guest/state')) requests++; });
 await page.goto(`/m/${state.tables[0].token}`);
 await expect(page.getByRole('button', { name: 'Tümü', exact: true })).toBeVisible();
 await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
 const hiddenCount = requests;
 await page.waitForTimeout(2500);
 expect(requests).toBe(hiddenCount);
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 await page.route('**/api/guest/state', async route => { await gate; await route.continue(); });
 try {
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => requests).toBe(hiddenCount + 1);
  await page.waitForTimeout(2500);
  expect(requests).toBe(hiddenCount + 1);
 } finally { release(); }
 await expect.poll(() => requests, { timeout: 7000 }).toBeGreaterThan(hiddenCount + 1);
 await page.unroute('**/api/guest/state');
});


test('late pre-order snapshot cannot erase a newly confirmed order', async ({ page }) => {
 await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
 await ensureSetup(page.request);
 const state = await (await page.request.get('/api/staff/state')).json();
 await page.request.post('/api/staff/heartbeat', { data: {} });
 await page.goto(`/m/${state.tables.find((t: any) => !t.account).token}`);
 await expect(page.getByRole('button', { name: 'Tümü', exact: true })).toBeVisible();
 let release!: () => void, captured!: () => void;
 const gate = new Promise<void>(r => { release = r; });
 const ready = new Promise<void>(r => { captured = r; });
 let first = true;
 await page.route('**/api/guest/state', async route => {
  if (!first) { await route.continue(); return; }
  first = false; const response = await route.fetch(); captured(); await gate; await route.fulfill({ response });
 });
 try {
  await ready;
  await page.getByRole('button', { name: /Demleme Çay/ }).click();
  await page.getByRole('button', { name: /Sepete ekle/ }).click();
  await page.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await page.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await page.getByRole('button', { name: 'Siparişimi takip et', exact: true }).click();
  await expect(page.locator('.customer-order')).toHaveCount(1);
  // Stop subsequent polling so it cannot hide an old-response regression.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const oldResponse = page.waitForResponse(r => r.url().endsWith('/api/guest/state'));
  release(); await oldResponse;
  await page.waitForTimeout(250);
  await expect(page.locator('.customer-order')).toHaveCount(1);
  await expect(page.locator('.customer-order')).toContainText('Demleme Çay');
 } finally { release(); await page.unroute('**/api/guest/state'); }
});
