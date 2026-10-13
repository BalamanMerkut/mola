import { test, expect } from '@playwright/test';
import { ensureSetup } from './helpers';
import { randomUUID } from 'node:crypto';

test('English guest menu translates dictionary categories, owner-named categories and subcategory chips', async ({ page, browser }, info) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  const state = async () => (await page.request.get('/api/staff/state')).json();
  for (const name of ['Kahvaltı', 'Ev lezzetleri']) { const r = await page.request.post('/api/staff/categories', { data: { requestId: randomUUID(), revision: (await state()).revision, action: 'add', name } }); expect(r.ok(), await r.text()).toBe(true); }
  let s = await state();
  const tea = s.products.find((p: { id: string }) => p.id === 'tea'), herbal = s.products.find((p: { id: string }) => p.id === 'herbal');
  for (const [code, name, category] of [['501', 'Simit tabağı', 'Kahvaltı'], ['502', 'Fırın makarna', 'Ev lezzetleri']]) expect((await page.request.post('/api/staff/products', { data: { requestId: randomUUID(), revision: (await state()).revision, product: { ...tea, id: undefined, code, name, nameEn: '', category, published: true } } })).ok()).toBe(true);
  for (const [product, subtype] of [[tea, 'Demleme'], [herbal, 'Özel karışım']]) expect((await page.request.post('/api/staff/products', { data: { id: product.id, product: { ...product, subtype } } })).ok()).toBe(true);

  // Owner names what the dictionary does not know: one category and one subcategory.
  await page.goto('/');
  await page.getByRole('button', { name: 'Menü yönetimi', exact: true }).click();
  await page.getByRole('button', { name: 'Kategoriler ve sıra', exact: true }).click();
  const row = (name: string) => page.locator('.category-order-row').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
  // 13 Ekim: names and sub-categories sit behind each row's "Düzenle" (one row open at a time).
  const edit = (name: string) => row(name).locator('.category-order-main').getByRole('button', { name: 'Düzenle', exact: true }).click();
  await edit('Kahvaltı');
  await expect(row('Kahvaltı')).toContainText('İngilizce: Breakfast (otomatik)');
  await edit('Ev lezzetleri');
  await expect(row('Ev lezzetleri')).toContainText('İngilizce adı yok; Türkçe adı gösterilir');
  await row('Ev lezzetleri').getByRole('button', { name: 'İngilizce adı', exact: true }).click();
  await expect(page.getByLabel('Kategori İngilizce adı', { exact: true })).toHaveAttribute('placeholder', 'Örn. Breakfast');
  await page.getByLabel('Kategori İngilizce adı', { exact: true }).fill('Homemade dishes');
  await page.getByRole('button', { name: 'İngilizce adı kaydet', exact: true }).click();
  await expect(row('Ev lezzetleri')).toContainText('İngilizce: Homemade dishes');
  await edit('Kahvaltı');
  await row('Kahvaltı').getByRole('button', { name: 'İngilizce adı', exact: true }).click();
  await expect(page.getByLabel('Kategori İngilizce adı', { exact: true })).toHaveAttribute('placeholder', 'Breakfast');
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).click();
  const teaRow = row('Çaylar'); await edit('Çaylar'); await teaRow.locator('summary', { hasText: /^Alt kategoriler/ }).click();
  const blend = teaRow.locator('.subcategory-manage-row').filter({ has: page.locator('span', { hasText: /^Özel karışım$/ }) });
  await expect(teaRow.locator('.subcategory-manage-row').filter({ has: page.locator('span', { hasText: /^Demleme$/ }) })).toContainText('İngilizce: Brewed tea (otomatik)');
  await blend.getByRole('button', { name: 'İngilizce adı', exact: true }).click();
  await page.getByLabel('Alt kategori İngilizce adı', { exact: true }).fill('House blend');
  await page.getByRole('button', { name: 'İngilizce adı kaydet', exact: true }).click();
  await expect(blend).toContainText('İngilizce: House blend');
  await page.screenshot({ path: info.outputPath('category-english.png'), fullPage: true });
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  s = await state();
  expect(s.categoryNamesEn).toEqual([{ category: 'Ev lezzetleri', name: 'Homemade dishes' }, { category: 'Çaylar', subtype: 'Özel karışım', name: 'House blend' }]);

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), guest = await context.newPage();
  await guest.goto(`/m/${s.tables[0].token}`);
  await expect(guest.getByRole('button', { name: 'Kahvaltı', exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'EN', exact: true }).click();
  const tabs = guest.locator('.category-tabs');
  for (const name of ['All', 'Coffee', 'Tea', 'Breakfast', 'Homemade dishes']) await expect(tabs.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(tabs).not.toContainText('Kahvaltı'); await expect(tabs).not.toContainText('Ev lezzetleri');
  await tabs.getByRole('button', { name: 'Tea', exact: true }).click();
  const chips = guest.getByLabel('Subcategories', { exact: true });
  await expect(chips.getByRole('button')).toHaveText(['All types', 'Brewed tea', 'House blend']);
  await chips.getByRole('button', { name: 'House blend', exact: true }).click();
  await expect(guest.locator('.product-card')).toHaveCount(1);
  await expect(guest.locator('.product-card .product-subtype')).toHaveText('House blend');
  await guest.locator('.product-card').click();
  await expect(guest.getByRole('dialog').locator('.eyebrow')).toHaveText(`#${herbal.code} · Tea`);
  await expect(guest.getByRole('dialog').locator('.product-subtype').first()).toHaveText('House blend');
  await guest.getByRole('button', { name: 'Kapat', exact: true }).click();
  await guest.screenshot({ path: info.outputPath('guest-english-menu.png'), fullPage: true });
  expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Back to Turkish: the owner's own names come back untouched.
  await guest.getByRole('button', { name: 'TR', exact: true }).click();
  await expect(guest.getByLabel('Alt kategoriler', { exact: true }).getByRole('button')).toHaveText(['Tüm türler', 'Demleme', 'Özel karışım']);
  await context.close();

  // The owner's preview shows the same English labels.
  await page.getByRole('button', { name: 'Menüyü önizle', exact: true }).click();
  const preview = page.frameLocator('iframe[title="Müşteri menüsü önizlemesi"]');
  await preview.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Homemade dishes', exact: true })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Breakfast', exact: true })).toBeVisible();
});

test('K-H: the guest menu starts in the phone\'s language (English phone → EN, Turkish → TR); a tap on EN/TR is remembered', async ({ page, browser }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  const s = await (await page.request.get('/api/staff/state')).json(), viewport = { width: 390, height: 844 };
  const english = await browser.newContext({ viewport, locale: 'en-US' }), tourist = await english.newPage();
  await tourist.goto(`/m/${s.tables[1].token}`);
  await expect(tourist.getByRole('button', { name: /Our menu/ })).toBeVisible();
  await expect(tourist.getByRole('button', { name: 'TR', exact: true })).toBeVisible();
  await expect(tourist.locator('.table-pill')).toHaveText(/^Table \d+$/);
  // The tourist's own choice wins over the phone, also after a reload.
  await tourist.getByRole('button', { name: 'TR', exact: true }).click();
  await tourist.reload();
  await expect(tourist.getByRole('button', { name: /Menümüz/ })).toBeVisible();
  await expect(tourist.getByRole('button', { name: 'EN', exact: true })).toBeVisible();
  await english.close();
  const turkish = await browser.newContext({ viewport, locale: 'tr-TR' }), local = await turkish.newPage();
  await local.goto(`/m/${s.tables[1].token}`);
  await expect(local.getByRole('button', { name: /Menümüz/ })).toBeVisible();
  await expect(local.locator('.table-pill')).toHaveText(/^Masa \d+$/);
  await local.getByRole('button', { name: 'EN', exact: true }).click();
  await local.reload();
  await expect(local.getByRole('button', { name: /Our menu/ })).toBeVisible();
  await turkish.close();
});

test('English guest menu translates description, option groups and options through basket, status and order editor; staff text stays Turkish', async ({ page, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  // Owner writes English in the one optional section; empty fields show the dictionary's suggestion as placeholder.
  await page.goto('/');
  await page.getByRole('button', { name: 'Menü yönetimi', exact: true }).click();
  await page.locator('.menu-row').filter({ hasText: 'Caffè Latte' }).getByRole('button', { name: 'Düzenle', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Ürünü düzenle' });
  const english = editor.locator('details').filter({ has: page.locator('summary', { hasText: 'İngilizce (isteğe bağlı)' }) });
  await expect(english).toHaveAttribute('open', ''); // the starter menu already has an English name and description
  await expect(english.getByLabel('İngilizce alan adı · Boy', { exact: true })).toHaveAttribute('placeholder', 'Size');
  await expect(english.getByLabel('İngilizce seçenek · Boy · Büyük boy', { exact: true })).toHaveAttribute('placeholder', 'Large');
  await expect(english.getByLabel('İngilizce alan adı · Süt tercihi', { exact: true })).toHaveAttribute('placeholder', 'Milk');
  await english.getByLabel('İngilizce açıklama', { exact: true }).fill('Silky espresso with steamed milk.');
  await english.getByLabel('İngilizce alan adı · Süt tercihi', { exact: true }).fill('Milk of your choice');
  await english.getByLabel('İngilizce seçenek · Süt tercihi · Yulaf sütü', { exact: true }).fill('Oat milk (barista)');
  await english.screenshot({ path: info.outputPath('product-english-section.png') });
  await editor.getByRole('button', { name: 'Kaydet ve yayınla', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const latte = (await (await page.request.get('/api/staff/state')).json()).products.find((p: { id: string }) => p.id === 'latte');
  expect([latte.descriptionEn, latte.groups[1].nameEn, latte.groups[1].options[0].nameEn, latte.groups[0].nameEn]).toEqual(['Silky espresso with steamed milk.', 'Milk of your choice', 'Oat milk (barista)', undefined]);

  const s = await (await page.request.get('/api/staff/state')).json();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), guest = await context.newPage(); guest.on('pageerror', e => errors.push(e.message));
  await guest.goto(`/m/${s.tables[2].token}`);
  await guest.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(guest.locator('.product-card').filter({ hasText: 'Caffè Latte' })).toContainText('Silky espresso with steamed milk.');
  await guest.getByRole('button', { name: /Caffè Latte/ }).click();
  let dialog = guest.getByRole('dialog');
  await expect(dialog).toContainText('Silky espresso with steamed milk.');
  await expect(dialog.locator('legend')).toHaveText(['Size (required)', 'Milk of your choice']);
  await expect(dialog.locator('fieldset.options').first().locator('label span:not(.option-price)')).toHaveText(['Regular', 'Large']); // "Standart" in a size group is the regular size
  await dialog.getByText('Large', { exact: true }).click();
  await dialog.getByText('Oat milk (barista)', { exact: true }).click();
  await dialog.screenshot({ path: info.outputPath('guest-english-options.png') });
  await dialog.getByRole('button', { name: /^Add/ }).click();
  // Dictionary only: Turkish coffee's "Şeker tercihi: Sade" reads as sugar, not as "plain".
  await guest.getByRole('button', { name: /Turkish Coffee/ }).click();
  dialog = guest.getByRole('dialog');
  await expect(dialog).toContainText('Traditional taste, freshly ground coffee.');
  await expect(dialog.locator('legend')).toHaveText(['Sugar (required)']);
  await expect(dialog.locator('fieldset.options label span:not(.option-price)')).toHaveText(['No sugar', 'Medium sweet', 'Sweet']);
  await dialog.getByRole('button', { name: /^Add/ }).click();
  await guest.getByRole('button', { name: /View basket/ }).click();
  await expect(guest.locator('.cart-line small').first()).toHaveText('Large · Oat milk (barista)');
  await expect(guest.locator('.cart-line small').nth(1)).toHaveText('No sugar');
  await guest.getByRole('button', { name: 'Place order', exact: true }).click();
  await guest.getByRole('button', { name: 'Track my order' }).click();
  const order = guest.locator('.customer-order').first();
  await expect(order.locator('.order-line strong')).toHaveText(['Caffè Latte', 'Turkish Coffee']);
  await expect(order.locator('.order-line small')).toHaveText(['Large · Oat milk (barista)', 'No sugar']);
  await guest.screenshot({ path: info.outputPath('guest-english-status.png'), fullPage: true });
  await order.getByRole('button', { name: /Edit order/ }).click();
  const edit = guest.getByRole('dialog', { name: /Edit order/ });
  await expect(edit.getByLabel('Milk of your choice', { exact: true }).locator('option:checked')).toHaveText(/^Oat milk \(barista\)/);
  await expect(edit.getByLabel('Size', { exact: true }).locator('option:checked')).toHaveText(/^Large/);
  await expect(edit.getByLabel('Sugar', { exact: true }).locator('option:checked')).toHaveText(/^No sugar/);
  await edit.getByRole('button', { name: 'Kapat', exact: true }).click();

  // The kitchen keeps reading Turkish; the guest's own status returns to Turkish with TR.
  const saved = (await (await page.request.get('/api/staff/state')).json()).orders.find((o: { tableName: string }) => o.tableName === s.tables[2].name);
  expect(saved.lines.map((l: { name: string; optionNames: string[] }) => [l.name, l.optionNames])).toEqual([['Caffè Latte', ['Büyük boy', 'Yulaf sütü']], ['Türk Kahvesi', ['Sade']]]);
  await guest.getByRole('button', { name: 'TR', exact: true }).click();
  await expect(order.locator('.order-line small')).toHaveText(['Büyük boy · Yulaf sütü', 'Sade']);
  await expect(order.locator('.order-line strong')).toHaveText(['Caffè Latte', 'Türk Kahvesi']);
  expect(errors).toEqual([]);
  await context.close();
});
