import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { businessDay } from '../../packages/domain/business-day';
import { ensureSetup, openView, reportGroups } from './helpers';

// Satış ve Raporlar by year (docs/HIZ_TESTI_5_YIL.md, "Faz 2"): the "Yıl ▾" chip and "Tümü" as a table of years, served from
// the monthly and yearly roll-ups. A new device: the plain summary first, "Bugün" chosen as always.
test.use({ storageState: { cookies: [], origins: [] } });

async function shot(page: Page, file: string, path: string, fullPage = true) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const tl = (kurus: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: kurus % 100 ? 2 : 0 }).format(kurus / 100);

test('Satış ve Raporlar: "Yıl ▾" picks this year or an earlier one, "Tümü" shows a table of years with the total; fits 360–1280', async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } }); await ensureSetup(page.request);
  const today = businessDay(Date.now()), year = today.slice(0, 4), last = String(Number(year) - 1);
  // A sale today, and last December's rent written on its day (an owner may date an expense up to a year back).
  const state = await (await page.request.get('/api/staff/state')).json(), tea = state.products.find((p: { id: string }) => p.id === 'tea');
  expect((await page.request.post('/api/staff/orders', { data: { requestId: crypto.randomUUID(), tableId: state.tables[1].id, lines: [{ productId: tea.id, quantity: 4, selections: [] }], expectedTotal: tea.price * 4 } })).ok()).toBe(true);
  const account = (await (await page.request.get('/api/staff/state')).json()).tables[1].account;
  expect((await page.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: account.id, version: account.version, method: 'card', amount: account.balance, tendered: account.balance } })).ok()).toBe(true);
  const rent = await page.request.post('/api/staff/expenses', { data: { requestId: crypto.randomUUID(), amount: 1_250_000, description: 'Aralık kirası', day: `${last}-12-20`, method: 'transfer' } });
  expect(rent.ok(), await rent.text()).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  await openView(page, 'Satış ve Raporlar');
  const period = page.getByRole('group', { name: 'Dönem' });
  // What the owner sees first does not change: "Bugün".
  await expect(period.getByRole('button', { name: 'Bugün', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('simple-sentence')).toHaveText(/^Bugün 1 sipariş/);
  // "Yıl": this year at once (up to today), the menu with the years that have records, newest first.
  await period.getByRole('button', { name: 'Yıl', exact: true }).click();
  await expect(period.getByRole('button', { name: `Yıl: ${year}` })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.period-label')).toContainText(`${year} yılı · bugüne kadar`);
  const menu = page.getByRole('menu', { name: 'Yıl seçin' });
  await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
  await expect(menu.getByRole('menuitemradio').first()).toContainText(year); await expect(menu.getByRole('menuitemradio').first()).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemradio').nth(1)).toContainText(last);
  await expect(page.getByTestId('simple-sentence')).toHaveText(new RegExp(`^${year} yılında bugüne kadar 1 sipariş`));
  await shot(page, 'rapor-yil-secici.png', info.outputPath('rapor-yil-secici.png'), false);
  // Last year: its rent, no sale.
  await menu.getByRole('menuitemradio', { name: new RegExp(last) }).click();
  await expect(menu).toHaveCount(0);
  await expect(period.getByRole('button', { name: `Yıl: ${last}` })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.period-label')).toContainText(`${last} yılı`);
  await expect(page.getByLabel('Sade özet').locator('.simple-card').filter({ has: page.getByText('Giderler', { exact: true }) })).toContainText(tl(1_250_000));
  // Escape and a tap outside close the menu.
  await period.getByRole('button', { name: `Yıl: ${last}` }).click(); await expect(menu).toBeVisible();
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);

  // "Tümü": the table of years, newest first, and the total; a year opens that year.
  await period.getByRole('button', { name: 'Tümü', exact: true }).click();
  const table = page.getByRole('region', { name: 'Yıllara göre' }).or(page.getByLabel('Yıllara göre'));
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(table.locator('tbody tr').first()).toContainText(year); await expect(table.locator('tbody tr').nth(1)).toContainText(last);
  await expect(table.locator('tbody tr').nth(1)).toContainText(tl(1_250_000));
  await expect(table.locator('tfoot')).toContainText('Toplam'); await expect(table.locator('tfoot')).toContainText(tl(tea.price * 4));
  await expect(table.getByRole('columnheader')).toHaveText(['Yıl', 'Satış', 'İade', 'Gider', 'Elde kalan', 'KDV']);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await shot(page, 'rapor-tumu.png', info.outputPath('rapor-tumu.png'));
  // The detailed Özet has the same table under its figures.
  await page.getByRole('button', { name: 'Detaylı göster' }).click();
  await expect(reportGroups(page)).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(80);
    expect(await fits(page), `Tümü ${width}`).toBe(true);
    const out = await page.locator('.reports-v2').evaluate(root => [...root.querySelectorAll<HTMLElement>('.panel, .kpi, .year-table, .period-bar')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
    expect(out, `Tümü ${width}`).toEqual([]);
    // On a phone İade, Gider and KDV move under the year as one small line.
    await expect(table.locator('thead .year-col-more').first()).toBeVisible({ visible: width > 560 });
    await expect(table.locator('tbody .year-more-line').first()).toBeVisible({ visible: width <= 560 });
  }
  await page.setViewportSize({ width: 360, height: 1400 });
  await page.getByRole('button', { name: 'Sade özete dön' }).click();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await shot(page, 'rapor-tumu-telefon.png', info.outputPath('rapor-tumu-telefon.png'));
  // The year picker on a phone: inside the screen, finger-sized items.
  await period.getByRole('button', { name: 'Yıl', exact: true }).click();
  const box = await menu.boundingBox(); expect(box && box.x >= 0 && box.x + box.width <= 360).toBe(true);
  for (const h of await menu.getByRole('menuitemradio').evaluateAll(list => list.map(b => b.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
  await page.mouse.click(5, 5); await expect(menu).toHaveCount(0);
  // A row of the table opens its year.
  await period.getByRole('button', { name: 'Tümü', exact: true }).click();
  await table.getByRole('button', { name: `${last} yılını aç` }).click();
  await expect(period.getByRole('button', { name: `Yıl: ${last}` })).toHaveAttribute('aria-pressed', 'true');

  // The accountant's "Tümü" file: a sheet of years and one sheet per year.
  const xlsx = await page.request.get('/api/staff/reports/accountant.xlsx?from=all&to=all');
  expect(xlsx.status()).toBe(200);
  const body = (await xlsx.body()).toString('latin1');
  expect(body).toContain('xl/worksheets/sheet1.xml');
});
