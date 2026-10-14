import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureSetup, openView } from './helpers';

/*
 * Mutfak modu (src/KitchenMode.tsx): the kitchen account works on a full-screen board. No sidebar and no page title; a
 * slim bar with the business, the clock, the sound, the counts per stage, Stok, Hesabım and Çıkış. Larger type, the whole
 * card coloured when an order is late, each column scrolling on its own. Only the kitchen account has it (no owner "Mutfak ekranı").
 */
const PASSWORD = 'MolaDemo!2026';
const id = () => crypto.randomUUID().replace(/-/g, '');
async function shot(page: Page, file: string, path: string, fullPage = false) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
/** Counts every tone started (window.__rings); the sound starts without a tap. */
function audioMock() {
  const w = window as any; w.__rings = 0;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  class AudioMock {
    state = 'running'; onstatechange: (() => void) | null = null; currentTime = 0; sampleRate = 8000; destination = {};
    async resume() { this.state = 'running'; this.onstatechange?.(); } async close() { this.state = 'closed'; }
    createGain() { return { ...node(), gain: param() }; }
    createOscillator() { w.__rings++; return { ...node(), type: 'sine', frequency: param(), onended: null, start() {}, stop() {} }; }
    createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
    createBufferSource() { return { ...node(), buffer: null, onended: null, start() {} }; }
    createBiquadFilter() { return { ...node(), type: 'bandpass', frequency: param(), Q: param() }; }
  }
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: AudioMock });
}
const rings = (page: Page) => page.evaluate(() => (window as any).__rings as number);
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(audioMock);
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  return page;
}
async function staff(browser: Browser, username: string) {
  const context = await browser.newContext();
  expect((await context.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  return context.request;
}
type Line = { productId: string; quantity: number; selections?: { groupId: string; optionId: string }[]; note?: string };
/** A staff order; the expected total is worked out from the menu (price + option extras). */
const order = async (waiter: APIRequestContext, tableId: string, lines: Line[], _total?: number) => {
  const state = await (await waiter.get('/api/staff/state')).json();
  const total = lines.reduce((n, l) => { const p = state.products.find((x: any) => x.id === l.productId); return n + (p.price + (l.selections ?? []).reduce((m, s) => m + p.groups.find((g: any) => g.id === s.groupId).options.find((o: any) => o.id === s.optionId).extra, 0)) * l.quantity; }, 0);
  const r = await waiter.post('/api/staff/orders', { data: { requestId: id(), tableId, lines: lines.map(l => ({ selections: [], ...l })), expectedTotal: total } });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json() as Promise<{ orderId: string; number: number }>;
};
const step = async (kitchen: APIRequestContext, orderId: string, status: 'preparing' | 'ready') => {
  const s = await (await kitchen.get('/api/staff/state')).json(), o = s.orders.find((x: { id: string }) => x.id === orderId);
  expect((await kitchen.post('/api/staff/status', { data: { requestId: id(), orderId, version: o.version, status } })).ok()).toBe(true);
};
/** Makes some orders look older on this screen only (the board reads `createdAt`), so lateness can be seen without waiting. */
async function age(page: Page, minutes: Record<string, number>) {
  await page.route('**/api/staff/state', async route => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    const body = await response.json();
    for (const o of body.orders ?? []) if (minutes[o.id]) o.createdAt = new Date(Date.now() - minutes[o.id] * 60_000).toISOString();
    const tag = response.headers()['x-mola-tag'];
    await route.fulfill({ status: 200, headers: tag ? { 'X-Mola-Tag': tag } : {}, json: body });
  });
}
const px = (page: Page, selector: string, prop: 'font-size' | 'height') => page.locator(selector).first().evaluate((el, p) => p === 'height' ? el.getBoundingClientRect().height : parseFloat(getComputedStyle(el).fontSize), prop);

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  expect((await page.request.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: false, changeSeconds: 0, commissionBps: null } })).ok()).toBe(true);
  const { orders } = await (await page.request.get('/api/staff/state')).json();
  for (const o of orders.filter((o: { status: string }) => ['new', 'preparing', 'ready', 'served'].includes(o.status)))
    await page.request.post('/api/staff/orders/cancel', { data: { requestId: id(), orderId: o.id, version: o.version, reason: 'Deneme temizliği' } });
});

test('landscape: full screen with the slim bar, larger type, whole late cards coloured, columns scrolling on their own', async ({ browser }, info) => {
  const waiter = await staff(browser, 'garson'), cook = await staff(browser, 'mutfak');
  const late = await order(waiter, 'table-2', [{ productId: 'latte', quantity: 2, selections: [{ groupId: 'size', optionId: 'large' }, { groupId: 'milk', optionId: 'oat' }] }, { productId: 'tea', quantity: 1, note: 'Açık olsun' }]);
  const veryLate = await order(waiter, 'table-4', [{ productId: 'tea', quantity: 1 }], 3500);
  const fresh = await order(waiter, 'table-6', [{ productId: 'tea', quantity: 3 }], 10500);
  const cooking = await order(waiter, 'table-7', [{ productId: 'tea', quantity: 1 }], 3500); await step(cook, cooking.orderId, 'preparing');
  const done = await order(waiter, 'table-8', [{ productId: 'tea', quantity: 2 }], 7000); await step(cook, done.orderId, 'preparing'); await step(cook, done.orderId, 'ready');
  const kitchen = await signedIn(browser, 'mutfak');
  try {
    await age(kitchen, { [late.orderId]: 12, [veryLate.orderId]: 24, [cooking.orderId]: 6, [done.orderId]: 30 });
    await kitchen.goto('/');
    const bar = kitchen.locator('.kitchen-bar');
    await expect(bar).toBeVisible();
    // No sidebar, no page heading or slogan: the board has the screen.
    await expect(kitchen.locator('.sidebar')).toHaveCount(0);
    await expect(kitchen.locator('.page-heading')).toHaveCount(0);
    await expect(kitchen.getByRole('navigation', { name: 'Alt menü' })).toHaveCount(0);
    // The bar: business, clock, sound, counts per stage, Stok, Hesabım, Çıkış.
    await expect(bar.locator('.kitchen-bar-place strong')).toHaveText((await (await kitchen.request.get('/api/staff/state')).json()).name);
    await expect(bar.locator('.kitchen-bar-clock')).toHaveText(/^\d{2}:\d{2}$/);
    await expect(bar.getByRole('button', { name: 'Sipariş sesini kapat' })).toBeVisible();
    const counts = bar.getByRole('list', { name: 'Aşamalardaki siparişler' });
    await expect(counts.locator('.count-new')).toContainText('3');
    await expect(counts.locator('.count-preparing')).toContainText('1');
    await expect(counts.locator('.count-ready')).toContainText('1');
    for (const name of ['Stok', 'Hesabım', 'Çıkış yap']) await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(80);
    // Three columns side by side.
    await expect(kitchen.locator('.kitchen-column:visible')).toHaveCount(3);
    await expect(kitchen.getByRole('tablist', { name: 'Mutfak aşamaları' })).toBeHidden();
    // ~1.5× type: table ≥ 28 px, product ≥ 22 px, options/notes ≥ 18 px, waiting time ≥ 18 px; buttons ≥ 56 px.
    expect(await px(kitchen, '.kitchen-card .order-head h3', 'font-size')).toBeGreaterThanOrEqual(28);
    expect(await px(kitchen, '.kitchen-card .order-line strong', 'font-size')).toBeGreaterThanOrEqual(22);
    expect(await px(kitchen, '.kitchen-card .order-line small:not(.line-note)', 'font-size')).toBeGreaterThanOrEqual(18);
    expect(await px(kitchen, '.kitchen-card .order-line small.line-note', 'font-size')).toBeGreaterThanOrEqual(18);
    expect(await px(kitchen, '.kitchen-card .waiting-time', 'font-size')).toBeGreaterThanOrEqual(18);
    for (const h of await kitchen.locator('.kitchen-card .kitchen-step').evaluateAll(list => list.map(b => b.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(56);
    // Options are dark enough to read from a distance (not the pale grey of the small board).
    const optionColour = await kitchen.locator('.kitchen-card .order-line small:not(.line-note)').first().evaluate(el => getComputedStyle(el).color.match(/\d+/g)!.slice(0, 3).map(Number));
    expect(Math.max(...optionColour)).toBeLessThan(90);
    // Late: the whole card is coloured (amber from 10 minutes, red from 20) and says it; a fresh one is plain; ready is plain.
    const card = (o: { number: number }) => kitchen.locator('.kitchen-card', { hasText: `#${o.number}` });
    await expect(card(late)).toHaveClass(/\blate\b/);
    await expect(card(late).locator('.late-label')).toHaveText('Gecikti');
    await expect(card(veryLate)).toHaveClass(/very-late/);
    await expect(card(veryLate).locator('.late-label')).toHaveText('Çok gecikti');
    await expect(card(fresh)).not.toHaveClass(/late/);
    await expect(card(cooking)).not.toHaveClass(/late/);
    await expect(card(done)).not.toHaveClass(/late/);
    const background = (o: { number: number }) => card(o).evaluate(el => getComputedStyle(el).backgroundColor);
    expect(await background(late)).toBe('rgb(255, 244, 220)');
    expect(await background(veryLate)).toBe('rgb(253, 229, 223)');
    // A fresh card is the palette's paper (14 Ekim: no white), light and unlike the late ones.
    const paper = await background(fresh);
    expect(Math.min(...paper.match(/\d+/g)!.slice(0, 3).map(Number))).toBeGreaterThan(220);
    expect([await background(late), await background(veryLate)]).not.toContain(paper);
    expect(await kitchen.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await shot(kitchen, 'mutfak-modu.png', info.outputPath('mutfak-modu.png'));

    // Many orders: the page itself never scrolls; the Yeni column scrolls inside, its heading stays on top.
    for (let i = 0; i < 6; i++) await order(waiter, `table-${1 + (i % 5)}`, [{ productId: 'tea', quantity: 1 }], 3500);
    await expect(kitchen.locator('.kitchen-column[aria-label="Yeni"] .kitchen-card')).toHaveCount(9);
    const column = kitchen.locator('.kitchen-column[aria-label="Yeni"]');
    expect(await column.evaluate(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto')).toBe(true);
    expect(await kitchen.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await column.evaluate(el => el.scrollTo({ top: el.scrollHeight }));
    const columnBox = (await column.boundingBox())!, heading = (await column.locator('.column-heading').boundingBox())!;
    expect(Math.abs(heading.y - columnBox.y)).toBeLessThanOrEqual(2);
    // The other columns did not move.
    expect(await kitchen.locator('.kitchen-column[aria-label="Hazırlanıyor"]').evaluate(el => el.scrollTop)).toBe(0);
  } finally { await kitchen.context().close(); }
});

test('it stays full screen on Stok, Hesabım and after a reload, and the sound keeps ringing everywhere', async ({ browser }) => {
  const waiter = await staff(browser, 'garson');
  const kitchen = await signedIn(browser, 'mutfak');
  try {
    await kitchen.goto('/');
    const bar = kitchen.locator('.kitchen-bar');
    await expect(kitchen.getByRole('button', { name: 'Sipariş sesini kapat' })).toBeVisible();
    // Stok inside the mode: the bar stays, "Mutfak panosu" brings the board back.
    await bar.getByRole('button', { name: 'Stok', exact: true }).click();
    await expect(kitchen.locator('.stock-workspace')).toBeVisible();
    await expect(kitchen.locator('.sidebar')).toHaveCount(0);
    const before = await rings(kitchen);
    await order(waiter, 'table-1', [{ productId: 'tea', quantity: 1 }], 3500);
    await expect.poll(() => rings(kitchen), { timeout: 8000 }).toBeGreaterThan(before);
    await bar.getByRole('button', { name: 'Mutfak panosu' }).click();
    await expect(kitchen.locator('.kitchen-card')).toHaveCount(1);
    await expect(bar.locator('.count-new')).toContainText('1');
    // Hesabım inside the mode too.
    await bar.getByRole('button', { name: 'Hesabım', exact: true }).click();
    await expect(kitchen.getByRole('heading', { name: /Şifre/ }).first()).toBeVisible();
    await expect(kitchen.locator('.sidebar')).toHaveCount(0);
    await kitchen.waitForTimeout(5200); // past the 5-second "one chime per kind" window
    const heard = await rings(kitchen);
    await order(waiter, 'table-2', [{ productId: 'tea', quantity: 1 }], 3500);
    await expect.poll(() => rings(kitchen), { timeout: 8000 }).toBeGreaterThan(heard);
    // A reload opens the board again, still full screen.
    await kitchen.reload();
    await expect(kitchen.locator('.kitchen-bar')).toBeVisible();
    await expect(kitchen.locator('.kitchen-column[aria-label="Yeni"] .kitchen-card')).toHaveCount(2);
    await expect(kitchen.locator('.sidebar')).toHaveCount(0);
    // Çıkış from the bar signs out.
    await bar.getByRole('button', { name: 'Çıkış yap', exact: true }).click();
    await expect(kitchen.getByRole('button', { name: 'Çalışma alanını aç' })).toBeVisible();
  } finally { await kitchen.context().close(); }
});

test('portrait tablet and phone: stage tabs with counts, one column filling the screen, nothing wider than the screen', async ({ browser }, info) => {
  const waiter = await staff(browser, 'garson'), cook = await staff(browser, 'mutfak');
  const first = await order(waiter, 'table-1', [{ productId: 'tea', quantity: 2 }], 7000);
  await order(waiter, 'table-3', [{ productId: 'tea', quantity: 1 }], 3500);
  const cooking = await order(waiter, 'table-5', [{ productId: 'tea', quantity: 1 }], 3500); await step(cook, cooking.orderId, 'preparing');
  const kitchen = await signedIn(browser, 'mutfak', { width: 768, height: 1024 });
  try {
    await age(kitchen, { [first.orderId]: 14 });
    await kitchen.goto('/');
    const tabs = kitchen.getByRole('tablist', { name: 'Mutfak aşamaları' });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('tab', { name: /Yeni/ })).toContainText('2');
    await expect(tabs.getByRole('tab', { name: /Hazırlanıyor/ })).toContainText('1');
    for (const h of await tabs.getByRole('tab').evaluateAll(list => list.map(b => b.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(56);
    await expect(kitchen.locator('.kitchen-column:visible')).toHaveCount(1);
    // The counts live on the tabs here, not twice in the bar.
    await expect(kitchen.getByRole('list', { name: 'Aşamalardaki siparişler' })).toBeHidden();
    await expect(kitchen.locator('.kitchen-card', { hasText: `#${first.number}` })).toHaveClass(/\blate\b/);
    expect(await kitchen.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await shot(kitchen, 'mutfak-modu-dik.png', info.outputPath('mutfak-modu-dik.png'));
    await tabs.getByRole('tab', { name: /Hazırlanıyor/ }).click();
    await expect(kitchen.locator('.kitchen-column[aria-label="Hazırlanıyor"]')).toBeVisible();
    // The column reaches down to the bottom of the screen.
    const column = (await kitchen.locator('.kitchen-column:visible').boundingBox())!;
    expect(column.y + column.height).toBeGreaterThan(1024 - 40);
    // Phones: the bar wraps but stays inside the screen.
    for (const [width, height] of [[360, 800], [390, 844]]) {
      await kitchen.setViewportSize({ width, height });
      expect(await kitchen.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}`).toBe(true);
      for (const name of ['Stok', 'Hesabım', 'Çıkış yap']) await expect(kitchen.locator('.kitchen-bar').getByRole('button', { name, exact: true })).toBeInViewport();
    }
    await kitchen.setViewportSize({ width: 1024, height: 768 });
    await expect(tabs).toBeHidden();
    await expect(kitchen.locator('.kitchen-column:visible')).toHaveCount(3);
  } finally { await kitchen.context().close(); }
});

test('the owner has no "Mutfak ekranı": the kitchen board is the kitchen account’s alone (sidebar and "Daha fazla")', async ({ browser }) => {
  const owner = await signedIn(browser, 'isletme');
  try {
    await ensureSetup(owner.request);
    await owner.goto('/');
    await expect(owner.locator('.sidebar nav').getByRole('button', { name: 'Masalar', exact: true })).toBeVisible();
    await expect(owner.locator('.sidebar nav').getByRole('button', { name: /Mutfak/ })).toHaveCount(0);
    await expect(owner.locator('.kitchen-bar')).toHaveCount(0);
    // On a phone, "Daha fazla" has no kitchen place either.
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.getByRole('navigation', { name: 'Alt menü' }).getByRole('button', { name: /^Daha fazla/ }).click();
    const more = owner.getByRole('dialog', { name: 'Daha fazla' });
    await expect(more.getByRole('button', { name: 'Hesabım' })).toBeVisible();
    await expect(more.getByRole('button', { name: /Mutfak/ })).toHaveCount(0);
  } finally { await owner.context().close(); }
});