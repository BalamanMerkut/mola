import { test, expect } from '@playwright/test';
import { ensureSetup } from './helpers';

const PASSWORD = 'MolaDemo!2026';
const product = (code: string, name: string, groups: unknown[]) => ({ code, name, nameEn: '', category: 'Kahveler', description: '', price: 10000, soldOut: false, art: 'coffee', photo: null, groups });

test('required options start on the free choice, or wait for the guest; optional groups say "Seçim yok" only when needed', async ({ page, browser }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  // No free size: the guest must choose. A milk group with a free "Normal süt" needs no extra "no choice" entry.
  expect((await page.request.post('/api/staff/products', { data: { product: product('91', 'Deneme Mocha', [{ id: 'size', name: 'Boy', required: true, options: [{ id: 's', name: 'Küçük', extra: -500 }, { id: 'l', name: 'Büyük', extra: 500 }] }]) } })).ok()).toBe(true);
  expect((await page.request.post('/api/staff/products', { data: { product: product('92', 'Deneme Flat White', [{ id: 'milk', name: 'Süt tercihi', required: false, options: [{ id: 'n', name: 'Normal süt', extra: 0 }, { id: 'o', name: 'Yulaf sütü', extra: 3000 }] }]) } })).ok()).toBe(true);
  const state = await (await page.request.get('/api/staff/state')).json();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  try {
    await guest.goto(`/m/${state.tables[0].token}`);
    // Caffè Latte: Boy (Standart ₺0 / Büyük boy) is required; its milk group has no free option.
    await guest.getByRole('button', { name: /Caffè Latte/ }).click();
    let dialog = guest.getByRole('dialog');
    await expect(dialog.getByRole('radio', { name: 'Standart' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Seçim yok' })).toBeChecked();
    await expect(dialog.getByRole('button', { name: /Sepete ekle/ })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Kapat' }).click();

    await guest.getByRole('button', { name: /Deneme Mocha/ }).click();
    dialog = guest.getByRole('dialog');
    await expect(dialog.getByRole('radio', { name: /Küçük/ })).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: /Sepete ekle/ })).toBeDisabled();
    await expect(dialog.getByText('Sepete eklemek için seçin: Boy')).toBeVisible();
    await dialog.getByRole('radio', { name: /Büyük/ }).check();
    await expect(dialog.getByRole('button', { name: /Sepete ekle/ })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: /Sepete ekle/ })).toContainText('₺105');
    await dialog.getByRole('button', { name: 'Kapat' }).click();

    await guest.getByRole('button', { name: /Deneme Flat White/ }).click();
    dialog = guest.getByRole('dialog');
    await expect(dialog.getByRole('radio')).toHaveCount(2);
    await expect(dialog.getByText('Seçim yok')).toHaveCount(0);
    await expect(dialog.getByRole('radio', { name: 'Normal süt' })).not.toBeChecked();
    // The EN menu says "None" for an optional group's empty choice.
    await dialog.getByRole('button', { name: 'Kapat' }).click();
    await guest.getByRole('button', { name: 'EN', exact: true }).click();
    await guest.getByRole('button', { name: /Caffè Latte/ }).click();
    await expect(guest.getByRole('dialog').getByRole('radio', { name: 'None' })).toBeChecked();
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
  // The server never takes a missing required choice either.
  const mocha = state.products.find((p: { code: string }) => p.code === '91');
  const refused = await page.request.post('/api/staff/orders', { data: { requestId: crypto.randomUUID().replace(/-/g, ''), tableId: state.tables[1].id, lines: [{ productId: mocha.id, quantity: 1, selections: [] }], expectedTotal: 10000 } });
  expect(refused.status()).toBe(400); expect((await refused.json()).code).toBe('OPTION_REQUIRED');
});

test('staff basket: table name, no guest wording, quantity steppers', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'kasiyer', password: PASSWORD } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sipariş al', exact: true }).first().click();
  await page.getByLabel('Sipariş masası').selectOption({ label: 'Masa 05' });
  await page.getByLabel('Sepete eklenecek ürün numarası').fill('21');
  await page.getByRole('button', { name: 'Numarayla sepete ekle' }).click();
  await page.getByRole('button', { name: /Sepeti görüntüle/ }).click();
  const basket = page.getByRole('dialog', { name: 'Masa 05 · Sepet' });
  await expect(basket).toBeVisible();
  await expect(basket.getByText('Ödemenizi kasada yapabilirsiniz.')).toHaveCount(0);
  await basket.getByRole('button', { name: 'Demleme Çay adedini artır' }).click();
  await expect(basket.locator('.total-line')).toContainText('₺70');
  await basket.getByRole('button', { name: 'Demleme Çay adedini azalt' }).click();
  await expect(basket.locator('.total-line')).toContainText('₺35');
  await expect(basket.getByRole('button', { name: 'Demleme Çay adedini azalt' })).toBeDisabled();
});
