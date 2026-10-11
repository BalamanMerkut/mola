import { test, expect, type Page } from '@playwright/test';
import { ensureSetup, openView } from './helpers';

const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('"Tatlılarda %10" in one tap: a dessert added afterwards is discounted for the guest', async ({ page, browser }, info) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } }); await ensureSetup(page.request);
  const initial = await (await page.request.get('/api/staff/state')).json();
  const table = initial.tables.find((t: any) => !t.account && !t.needsCleaning);
  await page.goto('/'); await openView(page, 'Kampanyalar');
  await page.getByRole('button', { name: 'Kampanya ekle', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const scope = dialog.getByRole('group', { name: 'Kampanya neye uygulansın?' });
  await expect(scope.getByRole('button', { name: 'Seçtiğim ürünler' })).toHaveAttribute('aria-pressed', 'true');
  await scope.getByRole('button', { name: 'Bütün bir bölüm' }).click();
  // One tap on the category; the default %10 and the name follow by themselves.
  await dialog.getByRole('button', { name: /^Tatlılar/ }).click();
  await expect(dialog.getByLabel('Kampanya adı')).toHaveValue('Tatlılarda %10 indirim');
  await expect(dialog.locator('.campaign-schedule-summary')).toHaveText('Tatlılarda %10 indirim · şu an 2 ürün');
  // "Hariç tut" is there for the few exceptions; nothing excluded here.
  await dialog.locator('.campaign-exclude summary').click();
  await expect(dialog.getByRole('group', { name: 'Hariç tutulacak ürünler' }).getByRole('button')).toHaveCount(2);
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 860 });
    expect(await fits(page), `editor fits at ${width}`).toBe(true);
    const chips = await dialog.locator('.campaign-categories button, .campaign-exclude [role=group] button').evaluateAll(list => list.every(b => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().height >= 44));
    expect(chips, `chips fit and are tappable at ${width}`).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('category-campaign-editor-mobile.png') });
  await dialog.getByRole('button', { name: 'Kampanyayı kaydet', exact: true }).click();
  const card = page.locator('.campaign-card').filter({ hasText: 'Tatlılarda %10 indirim' });
  await expect(card.locator('.campaign-state')).toHaveText('Aktif'); await expect(card).toContainText('Bölüm: Tatlılar · 2 ürün ·'); await expect(card).toContainText('Süresiz');
  const saved = (await (await page.request.get('/api/staff/campaigns')).json()).campaigns.find((c: any) => c.name === 'Tatlılarda %10 indirim');
  expect(saved.categories).toEqual(['Tatlılar']); expect(saved.productIds).toEqual([]);

  // A new dessert, added after the campaign was saved.
  const state = await (await page.request.get('/api/staff/state')).json();
  const product = { code: '491', name: 'Fırın Sütlaç', nameEn: '', category: 'Tatlılar', description: 'Taş fırında.', price: 15000, soldOut: false, art: 'cake', photo: null, groups: [] };
  expect((await page.request.post('/api/staff/products', { data: { requestId: crypto.randomUUID(), revision: state.revision, product } })).ok()).toBe(true);
  await expect(card).toContainText('3 ürün', { timeout: 10_000 });

  const customer = await browser.newContext({ viewport: { width: 360, height: 780 } });
  try {
    const guest = await customer.newPage(); await guest.goto(`/m/${table.token}`);
    const dessert = guest.getByRole('button', { name: /Fırın Sütlaç/ });
    await expect(dessert).toContainText('Tatlılarda %10 indirim');
    await expect(dessert).toContainText('₺135');
    await expect(guest.getByRole('list', { name: 'Kampanyalar' })).toContainText('Tatlılarda %10 indirim');
    // Only desserts carry it.
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).not.toContainText('indirim');
    expect(await fits(guest)).toBe(true);
    await guest.screenshot({ path: info.outputPath('category-campaign-guest-360.png'), fullPage: true });
    await dessert.click();
    await guest.getByRole('button', { name: 'Adedi artır' }).click();
    await expect(guest.getByRole('button', { name: /Sepete ekle/ })).toContainText('₺270');
    await guest.getByRole('button', { name: /Sepete ekle/ }).click();
    await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
    await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
    await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
    const order = (await (await page.request.get('/api/staff/state')).json()).orders.find((o: any) => o.tableName === table.name && !initial.orders.some((old: any) => old.id === o.id));
    expect(order.total).toBe(27000); expect(order.lines[0].originalUnitPrice).toBe(15000);
    expect(order.lines[0].campaigns[0].name).toBe('Tatlılarda %10 indirim');
    // The report keeps a line per product, the later dessert included.
    const report = await (await page.request.get('/api/staff/reports/campaigns')).json();
    const row = report.campaigns.find((c: any) => c.name === 'Tatlılarda %10 indirim');
    expect(row.products.find((p: any) => p.name === 'Fırın Sütlaç').appliedAmount).toBe(27000);
    expect(row.scopeText).toBe('Tatlılarda geçerli (bölümün tamamı)');
  } finally { await customer.close(); }
});
