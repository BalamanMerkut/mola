import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bottomNav, ensureSetup } from './helpers';

/*
 * The waiter's phone (≤ 700 px), simplified as approved: Masalar shows one thin line, filter chips and a three-column grid of
 * small tiles (12 tables without scrolling on 390×844); Sipariş al has the table as one chip beside the search, products as
 * rows with a round "+", and a basket bar ("3 ürün · ₺330 · Gönder") above the bottom bar.
 */
const PASSWORD = 'MolaDemo!2026';
const id = () => crypto.randomUUID().replace(/-/g, '');
async function shot(page: Page, file: string, path: string) {
  await page.screenshot({ path });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file) }); }
}
async function phone(browser: Browser, username = 'garson') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  return page;
}
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  expect((await page.request.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: false, changeSeconds: 0, commissionBps: null } })).ok()).toBe(true);
});

test('Masalar on the waiter phone: one line, chips with counts, 12 tiles without scrolling, "Hazır" lights up', async ({ browser, page: owner }, info) => {
  const waiter = await phone(browser);
  const kitchen = (await browser.newContext()).request;
  expect((await kitchen.post('/api/login', { data: { username: 'mutfak', password: PASSWORD } })).ok()).toBe(true);
  try {
    const state = await (await owner.request.get('/api/staff/state')).json();
    const normal = state.tables.length;
    // An open table with a ready order, to see the tile and the chip.
    const sent = await (await waiter.request.post('/api/staff/orders', { data: { requestId: id(), tableId: 'table-5', lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 } })).json();
    for (const status of ['preparing', 'ready'] as const) {
      const o = (await (await kitchen.get('/api/staff/state')).json()).orders.find((x: { id: string }) => x.id === sent.orderId);
      expect((await kitchen.post('/api/staff/status', { data: { requestId: id(), orderId: sent.orderId, version: o.version, status } })).ok()).toBe(true);
    }
    await waiter.goto('/');
    await bottomNav(waiter).getByRole('button', { name: /^Masalar/ }).click();
    // No slogan, no big "Sipariş al" button, no number cards: one line instead.
    await expect(waiter.locator('.page-heading')).toHaveCount(0);
    await expect(waiter.locator('.metric-grid')).toHaveCount(0);
    const line = waiter.getByLabel('Masa özeti');
    await expect(line).toContainText('Masalar');
    await expect(line).toContainText(/\d+ açık/);
    await expect(line).toContainText('₺');
    const filters = waiter.getByRole('group', { name: 'Masa filtresi' });
    for (const name of ['Tümü', 'Açık', 'Boş', 'Hazır']) await expect(filters.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
    await expect(filters.getByRole('button', { name: /^Hazır/ })).toHaveClass(/attention/);
    // Every normal table is a small tile; at least 12 of them sit above the bottom bar without scrolling.
    const tiles = waiter.locator('.floor-tile');
    await expect(tiles).toHaveCount(normal);
    const barTop = (await bottomNav(waiter).boundingBox())!.y;
    const inView = await tiles.evaluateAll((list, top) => list.filter(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= top; }).length, barTop);
    expect(inView).toBeGreaterThanOrEqual(Math.min(12, normal));
    for (const h of await tiles.evaluateAll(list => list.map(el => el.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(48);
    const ready = waiter.locator('.floor-tile', { hasText: /^05/ });
    await expect(ready).toHaveClass(/ready/);
    await expect(ready).toContainText('Hazır');
    await expect(ready).toContainText('₺70');
    await expect(waiter.locator('.floor-tile.empty').first()).toContainText('boş');
    expect(await fits(waiter)).toBe(true);
    await shot(waiter, 'garson-masalar.png', info.outputPath('garson-masalar.png'));
    // "Hazır" shows the ready table only; a tile opens its table window.
    await filters.getByRole('button', { name: /^Hazır/ }).click();
    await expect(tiles).toHaveCount(1);
    await ready.click();
    await expect(waiter.getByRole('dialog', { name: /Masa 05/ })).toBeVisible();
  } finally { await waiter.context().close(); }
});

test('K-S (9 Ekim): the owner\'s and the cashier\'s phone get the same plain Masalar (one line, chips, tiles; no slogan)', async ({ browser, page: owner }) => {
  const tables = (await (await owner.request.get('/api/staff/state')).json()).tables.length;
  for (const username of ['isletme', 'kasiyer']) {
    const p = await phone(browser, username);
    try {
      await p.goto('/');
      await expect(p.getByLabel('Masa özeti')).toBeVisible();
      await expect(p.locator('.page-heading')).toHaveCount(0);
      await expect(p.locator('.metric-grid')).toHaveCount(0);
      await expect(p.getByRole('group', { name: 'Masa filtresi' })).toBeVisible();
      await expect(p.locator('.floor-tile')).toHaveCount(tables);
      await expect(p.locator('.table-card')).toHaveCount(0);
      // İlk adımlar (owner) is one folded line, never the open list.
      const steps = p.getByRole('region', { name: 'İlk adımlar' });
      if (await steps.count()) await expect(steps.locator('li')).toHaveCount(0);
      await p.locator('.floor-tile').first().click();
      await expect(p.getByRole('dialog')).toBeVisible();
      expect(await fits(p), username).toBe(true);
    } finally { await p.context().close(); }
  }
});

test('Sipariş al on the waiter phone: "2 latte + 1 cheesecake" to Masa 05 in a few taps, no scrolling', async ({ browser }, info) => {
  const waiter = await phone(browser);
  try {
    const state = await (await waiter.request.get('/api/staff/state')).json();
    const latte = state.products.find((p: { id: string }) => p.id === 'latte'), cake = state.products.find((p: { id: string }) => p.id === 'cheesecake');
    expect(latte && cake).toBeTruthy();
    await waiter.goto('/');
    let taps = 0;
    const tap = async (l: ReturnType<Page['locator']>) => { await expect(l).toBeInViewport(); await l.click(); taps++; };
    await tap(bottomNav(waiter).getByRole('button', { name: /^Sipariş al/ }));
    // The table: one chip beside the search (no separate product number box, no hint text for waiters).
    const chip = waiter.getByLabel('Sipariş masası');
    await expect(chip).toBeInViewport();
    await chip.selectOption({ label: 'Masa 05' }); taps += 2; // open the list, pick the table
    await expect(waiter.getByLabel('Sepete eklenecek ürün numarası')).toHaveCount(0);
    await expect(waiter.getByText('Ürünün adını veya kodunu yazarak')).toHaveCount(0);
    const search = waiter.getByRole('textbox', { name: 'Ürün ara' });
    expect(Math.abs((await search.boundingBox())!.y - (await chip.boundingBox())!.y)).toBeLessThanOrEqual(6);
    // Latte: "+" opens its options (size, milk) without the big picture area; two at once.
    const row = (p: { name: string }) => waiter.locator('.staff-row', { hasText: p.name });
    await search.fill(''); // nothing typed: the list is the menu
    const latteAdd = row(latte).getByRole('button', { name: new RegExp(`${latte.name} · (bir adet ekle|seçenekleri aç)`) });
    await latteAdd.scrollIntoViewIfNeeded(); // the list may need a flick to reach it; counted as no tap
    await tap(latteAdd);
    if (latte.groups.length) {
      const dialog = waiter.getByRole('dialog');
      await expect(dialog.locator('.product-art')).toHaveCount(0);
      await tap(dialog.getByRole('button', { name: 'Adedi artır' }));
      await tap(dialog.getByRole('button', { name: /Sepete ekle/ }));
    } else await tap(latteAdd);
    // Cheesecake: "+" adds one at once when it has no options.
    const cakeAdd = row(cake).getByRole('button', { name: new RegExp(`${cake.name} · `) });
    await cakeAdd.scrollIntoViewIfNeeded();
    await tap(cakeAdd);
    if (cake.groups.length) await tap(waiter.getByRole('dialog').getByRole('button', { name: /Sepete ekle/ }));
    // The basket bar above the bottom bar: "3 ürün · ₺… · Gönder".
    const bar = waiter.locator('.staff-basket-bar');
    await expect(bar).toContainText('3 ürün');
    const barBox = (await bar.boundingBox())!, navTop = (await bottomNav(waiter).boundingBox())!.y;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(navTop);
    await expect(row(cake).locator('.staff-qty')).toHaveText('1');
    await shot(waiter, 'garson-siparis.png', info.outputPath('garson-siparis.png'));
    await tap(bar.getByRole('button', { name: /^Gönder/ }));
    await expect(waiter.getByText(/Sipariş #\d+ mutfağa gönderildi\./)).toBeVisible();
    expect(taps, 'taps for 2 latte + 1 cheesecake').toBeLessThanOrEqual(8);
    const order = (await (await waiter.request.get('/api/staff/state')).json()).orders.filter((o: { tableName: string }) => o.tableName === 'Masa 05').at(-1);
    expect(order.lines.map((l: { name: string; quantity: number }) => [l.name, l.quantity])).toEqual(expect.arrayContaining([[latte.name, 2], [cake.name, 1]]));
    // K-G (9 Ekim): after sending, the phone is back on Masalar and Sipariş al has no table chosen (no order goes to Masa 05 unnoticed).
    await expect(waiter.getByLabel('Masa özeti')).toBeVisible();
    await bottomNav(waiter).getByRole('button', { name: /^Sipariş al/ }).click();
    await expect(waiter.getByLabel('Sipariş masası')).toHaveValue('');
    await waiter.getByLabel('Sipariş masası').selectOption({ label: 'Masa 05' });
    // The basket can still be looked over and changed: + / −, notes and "Paketlensin" are in it.
    await row(cake).getByRole('button', { name: new RegExp(`${cake.name} · `) }).click();
    if (cake.groups.length) await waiter.getByRole('dialog').getByRole('button', { name: /Sepete ekle/ }).click();
    await bar.getByRole('button', { name: /Sepeti görüntüle/ }).click();
    const basket = waiter.getByRole('dialog', { name: /Masa 05 · Sepet/ });
    await expect(basket.getByRole('button', { name: new RegExp(`${cake.name} adedini artır`) })).toBeVisible();
    await expect(basket.getByRole('checkbox', { name: /Paketlensin/ })).toBeVisible();
    expect(await fits(waiter)).toBe(true);
  } finally { await waiter.context().close(); }
});

test('cashier and owner keep the product number box; tablets keep their Sipariş al', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await context.newPage();
  try {
    await page.request.post('/api/login', { data: { username: 'kasiyer', password: PASSWORD } });
    await page.goto('/');
    await page.locator('.sidebar nav').getByRole('button', { name: 'Sipariş al', exact: true }).click();
    await page.getByLabel('Sipariş masası').selectOption({ label: 'Masa 02' });
    await expect(page.getByLabel('Sepete eklenecek ürün numarası')).toBeVisible();
    await expect(page.locator('.no-table-choice')).toBeVisible();
    // "+" adds without a window here too, and the basket bar shows it.
    const tea = page.locator('.staff-row', { hasText: 'Demleme Çay' });
    await tea.getByRole('button', { name: /bir adet ekle/ }).click();
    await tea.getByRole('button', { name: /bir adet ekle/ }).click();
    await expect(tea.locator('.staff-qty')).toHaveText('2');
    await expect(page.locator('.staff-basket-bar')).toContainText('2 ürün');
  } finally { await context.close(); }
});
