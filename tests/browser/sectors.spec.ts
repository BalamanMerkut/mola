import { test, expect } from '@playwright/test';

test('restaurant setup: sector card loads the restaurant menu with its photos, no counter-sales switch; the guest menu shows food icons on the tabs', async ({ page, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Mutlu misafir\.\s*Kolay işletme\./ })).toBeVisible();
  await expect(page).toHaveTitle('Mola · İşletme yönetimi');
  await page.request.post('/api/login', { data: { username: 'diger', password: 'MolaDemo!2026' } });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'İşletmenizi hazırlayalım' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'İşletme türü', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Kafe/ })).toBeChecked();
  await page.getByText('Restoran', { exact: true }).click();
  await expect(page.getByRole('radio', { name: /Restoran/ })).toBeChecked();
  await expect(page.locator('.setup-panel')).toContainText('Restoran başlangıç menüsü yüklenecek');
  await expect(page.locator('.sector-choices')).not.toContainText(/götür/i);
  await page.screenshot({ path: info.outputPath('setup-sector.png'), fullPage: true });
  await page.getByRole('button', { name: 'Devam', exact: true }).click();
  await page.getByLabel('İşletme adı', { exact: true }).fill('Harput Sofrası');
  await page.getByRole('button', { name: 'Devam', exact: true }).click();
  // Masasız (counter) sales are always on: the wizard asks nothing about them.
  await expect(page.getByRole('heading', { name: 'Sipariş ve ödeme tercihleri' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /götür|Masasız/i })).toHaveCount(0);
  await expect(page.locator('.setup-panel')).not.toContainText(/götür|Masasız/i);
  await page.getByRole('button', { name: 'Devam', exact: true }).click();
  const summary = page.locator('.setup-summary');
  await expect(summary).toContainText('Restoran'); await expect(summary).not.toContainText(/götür|Masasız/i);
  await page.getByRole('button', { name: 'Kurulumu kaydet', exact: true }).click();
  await expect(page.getByText('İşletme ayarları kaydedildi.')).toBeVisible();
  // No open masasız ticket, so no strip and no big button on Masalar; the floor plan keeps its 12 tables.
  await expect(page.locator('.takeaway-strip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Al götür/ })).toHaveCount(0);
  await expect(page.locator('.tables-section h2')).toContainText('12 masa');
  const state = await (await page.request.get('/api/staff/state')).json();
  expect(state.sector).toBe('restaurant'); expect(state.takeawayEnabled).toBeUndefined();
  expect(state.categories).toEqual(['Çorbalar', 'Ana Yemekler', 'Burgerler', 'Salatalar', 'Tatlılar', 'İçecekler']);
  await page.getByRole('button', { name: 'Menü yönetimi', exact: true }).click();
  // The starter menu comes with its photos (server/template-photos.ts), loaded like uploaded ones.
  const soup = page.locator('.menu-row').filter({ hasText: 'Mercimek Çorbası' }).locator('.product-photo img');
  await expect(soup).toBeVisible();
  await expect.poll(() => soup.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
  // Ayarlar: the type is a label only.
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  await expect(page.getByLabel('İşletme türü', { exact: true })).toHaveValue('restaurant');
  await page.getByRole('button', { name: 'İşletme türü hakkında bilgi' }).click();
  await expect(page.getByRole('tooltip')).toContainText('menünüzü yeniden yüklemez');
  await page.getByRole('button', { name: 'İşletme türü hakkında bilgi' }).press('Escape');

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await context.newPage(); guest.on('pageerror', e => errors.push(e.message));
  await guest.goto(`/m/${state.tables[0].token}`);
  await expect(guest.getByRole('heading', { name: 'Sofranız hazır.' })).toBeVisible();
  const tabs = guest.locator('.category-tabs');
  await expect(tabs.getByRole('button', { name: 'Çorbalar' }).locator('svg.lucide-soup')).toBeVisible();
  await expect(tabs.getByRole('button', { name: 'Burgerler' }).locator('svg.lucide-hamburger')).toBeVisible();
  await expect(tabs.getByRole('button', { name: 'Salatalar' }).locator('svg.lucide-salad')).toBeVisible();
  const burger = guest.locator('.product-card').filter({ hasText: 'Klasik Burger' }).locator('.product-photo img');
  await burger.scrollIntoViewIfNeeded();
  await expect.poll(() => burger.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
  await expect(guest.locator('.customer-footer')).toContainText('Afiyet olsun, yine bekleriz.');
  await guest.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(tabs.getByRole('button', { name: 'Soups' })).toBeVisible();
  await expect(guest.locator('.customer-footer')).toContainText('Enjoy your meal.');
  await guest.screenshot({ path: info.outputPath('restaurant-menu.png'), fullPage: true });
  expect(errors).toEqual([]);
  await context.close();
});
