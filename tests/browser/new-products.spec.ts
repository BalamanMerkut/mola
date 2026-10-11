import { test, expect } from '@playwright/test';
import { ensureSetup } from './helpers';
test('QR New tab appears for a published product and disappears when the server window expires', async ({ page }) => {
 await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
 await ensureSetup(page.request);
 const state = await (await page.request.get('/api/staff/state')).json();
 await page.goto(`/m/${state.tables[0].token}`);
 await expect(page.getByRole('button', { name: 'Tümü', exact: true })).toBeVisible();
 await expect(page.getByRole('button', { name: 'Yeni', exact: true })).toHaveCount(0);
 const original = state.products[0];
 const response = await page.request.post('/api/staff/products', { data: { requestId: 'new-product-create', revision: state.revision, product: { ...original, code: '999', name: 'Yeni tat', published: true } } });
 expect(response.ok()).toBe(true);
 await page.getByRole('button', { name: 'Yeni', exact: true }).click();
 await expect(page.locator('.product-card')).toHaveCount(1);
 await expect(page.locator('.product-card')).toContainText('Yeni tat');
 await page.getByRole('button', { name: 'EN', exact: true }).click();
 await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveClass(/selected/);
 // Ask for the full snapshot (no "unchanged" tag) so there is always a body to rewrite.
 await page.route('**/api/guest/state', async route => { const response = await route.fetch({ headers: { ...route.request().headers(), 'x-mola-tag': '' } }); const body = await response.json(); body.newProductIds = []; await route.fulfill({ response, json: body }); });
 await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveCount(0);
 await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveClass(/selected/);
 await expect(page.locator('.product-card')).toHaveCount(state.products.length + 1);
});
