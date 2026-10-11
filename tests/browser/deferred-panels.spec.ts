import { test, expect } from '@playwright/test';
import { ensureSetup } from './helpers';

test('report code loads on demand and slow or failed chunks leave navigation usable', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  const chunks: string[] = [];
  page.on('request', request => { if (/\/assets\/(SalesReports|SettingsPanel|Integrations)-.*\.js/.test(request.url())) chunks.push(request.url()); });
  await page.addInitScript(() => localStorage.setItem('mola-integrations', '1')); await page.goto('/');
  await expect(page.getByRole('button', { name: 'Satış ve Raporlar', exact: true })).toBeVisible();
  expect(chunks).toHaveLength(0);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/SalesReports-*.js', async route => { await gate; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
    await expect(page.getByText('Ekran hazırlanıyor…', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Masalar', exact: true }).click();
    // The counter's Masalar (≥ 900 px) has no page heading: its floor head with the day's summary.
    await expect(page.locator('.floor-head').getByLabel('Günün özeti')).toBeVisible();
  } finally { release(); }
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await expect(page.locator('.kpi-row')).toBeVisible();
  expect(chunks.filter(url => url.includes('SalesReports-'))).toHaveLength(1);
  await page.route('**/assets/Integrations-*.js', route => route.abort());
  await page.getByRole('button', { name: 'Entegrasyonlar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ekran açılamadı' })).toBeVisible();
  await page.getByRole('button', { name: 'Masalar', exact: true }).click();
  await expect(page.locator('.floor-head').getByLabel('Günün özeti')).toBeVisible();
});


test('QR menu never requests staff, platform or reporting screen chunks', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  const state = await (await page.request.get('/api/staff/state')).json();
  const adminChunks: string[] = [];
  page.on('request', request => {
    if (/\/assets\/(Workspace|Platform|SalesReports|SettingsPanel|Integrations|Support)-.*\.(js|css)/.test(request.url())) adminChunks.push(request.url());
  });
  await page.goto(`/m/${state.tables[0].token}`);
  await expect(page.locator('.product-card').first()).toBeVisible();
  await page.locator('.product-card').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(adminChunks).toEqual([]);
});
