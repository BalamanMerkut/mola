import { test, expect } from '@playwright/test';
import { ensureSetup, openReport } from './helpers';
test('date refresh keeps scroll and mounted content in summary and employee reports', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request); await page.setViewportSize({ width: 390, height: 650 }); await page.goto('/');
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  // Summary (Satış group) and employees (Personel group) share the period bar at the top. "İade ve düzeltme" has its own
  // day control; its scroll stability while refreshing is covered in refund-ledger.spec.ts.
  const controls = { quick: '7 gün', custom: '.period-custom summary', apply: 'Göster' };
  for (const [tab, endpoint, content] of [
    ['Özet', '**/api/staff/reports/overview?*', '.kpi-row'],
    ['Çalışanlar', '**/api/staff/reports/employees?*', '.employee-chart-grid'],
  ] as const) {
    await openReport(page, tab);
    await expect(page.locator(content)).toBeVisible();
    await page.getByRole('button', { name: controls.quick, exact: true }).click();
    await expect(page.getByText('Güncelleniyor… Önceki sonuçlar gösteriliyor.', { exact: true })).toHaveCount(0);
    const button = page.getByRole('button', { name: '30 gün', exact: true });
    await button.scrollIntoViewIfNeeded();
    // Use a deliberately slow response to detect the temporary document collapse.
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    await page.route(endpoint, async route => { await gate; await route.continue(); });
    const before = await page.evaluate(() => scrollY);
    try {
      await button.click();
      await expect(page.getByText('Güncelleniyor… Önceki sonuçlar gösteriliyor.', { exact: true })).toBeVisible();
      await expect(page.locator(content)).toBeVisible();
      expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(5);
    } finally { release(); }
    await expect(page.getByText('Güncelleniyor… Önceki sonuçlar gösteriliyor.', { exact: true })).toHaveCount(0);
    expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(5);
    await page.unroute(endpoint);
    const all = page.getByRole('button', { name: 'Tümü', exact: true });
    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Güncelleniyor… Önceki sonuçlar gösteriliyor.', { exact: true })).toHaveCount(0);
    await expect(page.locator(content)).toBeVisible();
    await page.locator(controls.custom).click();
    await expect(page.getByLabel('Başlangıç', { exact: true })).toHaveValue(/^\d{2}\.\d{2}\.\d{4}$/);
    await page.getByRole('button', { name: controls.apply, exact: true }).click();
    await expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
