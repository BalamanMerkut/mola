import { test, expect, type APIRequestContext, type Browser } from '@playwright/test';
import { bottomNav, ensureSetup } from './helpers';

const PASSWORD = 'MolaDemo!2026';
const id = () => crypto.randomUUID().replace(/-/g, '');

/** Sound starts only after a tap on the page (like a phone browser); counts tones (__rings) and vibrations (__vibrations). */
function lockedAudio() {
  const w = window as any; w.__rings = 0; w.__vibrations = []; w.__tapped = false;
  addEventListener('pointerdown', () => { w.__tapped = true; }, true);
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  class AudioMock {
    state = 'suspended'; onstatechange: (() => void) | null = null; currentTime = 0; sampleRate = 8000; destination = {};
    async resume() { if (this.state !== 'closed' && w.__tapped) { this.state = 'running'; this.onstatechange?.(); } }
    async close() { this.state = 'closed'; }
    createGain() { return { ...node(), gain: param() }; }
    createOscillator() { w.__rings++; return { ...node(), type: 'sine', frequency: param(), onended: null, start() {}, stop() {} }; }
    createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
    createBufferSource() { return { ...node(), buffer: null, onended: null, start() {} }; }
    createBiquadFilter() { return { ...node(), type: 'bandpass', frequency: param(), Q: param() }; }
  }
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: AudioMock });
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (pattern: unknown) => { w.__vibrations.push(pattern); return true; } });
}
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(lockedAudio);
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  return page;
}
async function api(browser: Browser, username: string) {
  const context = await browser.newContext();
  expect((await context.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  return context.request;
}
const prices: Record<string, number> = { tea: 3500, lemonade: 12000 };
async function order(waiter: APIRequestContext, tableId: string, lines: { productId: string; quantity: number }[], expectedTotal = lines.reduce((n, l) => n + prices[l.productId] * l.quantity, 0)) {
  const r = await waiter.post('/api/staff/orders', { data: { requestId: id(), tableId, lines: lines.map(l => ({ ...l, selections: [] })), expectedTotal } });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json() as Promise<{ orderId: string; number: number; accountId: string }>;
}
async function step(kitchen: APIRequestContext, orderId: string, status: 'preparing' | 'ready') {
  const o = (await (await kitchen.get('/api/staff/state')).json()).orders.find((x: { id: string }) => x.id === orderId);
  expect((await kitchen.post('/api/staff/status', { data: { requestId: id(), orderId, version: o.version, status } })).ok()).toBe(true);
}
const digits = (text: string) => Number(text.replace(/\D/g, ''));

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  expect((await page.request.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: false, changeSeconds: 0, commissionBps: null } })).ok()).toBe(true);
});

test('waiter phone: "Ses kapalı" until a tap, then a ready order shows its count, a short note and a vibration', async ({ browser }) => {
  const waiter = await signedIn(browser, 'garson', { width: 390, height: 844 }), waiterApi = await api(browser, 'garson'), kitchen = await api(browser, 'mutfak');
  try {
    await waiter.goto('/');
    const hint = waiter.getByRole('button', { name: 'Ses kapalı · açmak için dokunun' });
    await expect(hint).toBeVisible();
    expect(await waiter.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await hint.click();
    await expect(hint).toHaveCount(0);
    const sent = await order(waiterApi, 'table-3', [{ productId: 'tea', quantity: 1 }]);
    await step(kitchen, sent.orderId, 'preparing'); await step(kitchen, sent.orderId, 'ready');
    // The count on "Servise hazır" (the phone's bottom bar) shows, with a short note and a vibration.
    const nav = bottomNav(waiter).getByRole('button', { name: /^Servise hazır/ });
    await expect(nav.locator('.bottom-nav-count')).toBeVisible();
    await expect(nav.locator('.bottom-nav-count')).toHaveText(/^\d+$/);
    await expect(waiter.getByRole('status').filter({ hasText: `Masa 03 · #${sent.number} hazır` })).toBeVisible();
    expect(await waiter.evaluate(() => (window as any).__vibrations.length)).toBeGreaterThan(0);
    expect(await waiter.evaluate(() => (window as any).__rings)).toBeGreaterThan(0);
    expect(await waiter.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await waiter.context().close(); }
});

test('cashier and owner see "Ses kapalı" too, and the owner counts event tables in "Açık masa" and the open total', async ({ browser, page }) => {
  const cashier = await signedIn(browser, 'kasiyer'), owner = await signedIn(browser, 'isletme'), waiterApi = await api(browser, 'garson');
  try {
    await cashier.goto('/');
    await expect(cashier.getByRole('button', { name: 'Ses kapalı · açmak için dokunun' })).toBeVisible();
    // An event with three temporary tables, started now.
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
    const ev = await (await page.request.post('/api/staff/events', { data: { requestId: id(), name: 'Derbi', day, start: '00:00', count: 3, prefix: 'E', hideNormal: false } })).json();
    expect((await page.request.post('/api/staff/events/start', { data: { requestId: id(), id: ev.id } })).ok()).toBe(true);
    await owner.goto('/');
    await expect(owner.getByRole('button', { name: 'Ses kapalı · açmak için dokunun' })).toBeVisible();
    // The counter's compact Masalar (1280 px): one line "5/15 açık · Açık hesap ₺X · …" instead of the number cards.
    const line = owner.getByLabel('Günün özeti');
    const openTables = line.locator(':scope > span').nth(0).locator('strong'), openTotal = line.locator(':scope > span', { hasText: 'Açık hesap' }).locator('strong');
    await expect(openTables).toHaveText(/\/15$/);
    const tablesBefore = digits((await openTables.innerText()).split('/')[0]), totalBefore = digits(await openTotal.innerText());
    const state = await (await page.request.get('/api/staff/state')).json(), e1 = state.eventTables.find((t: { name: string }) => t.name === 'E1');
    await order(waiterApi, e1.id, [{ productId: 'tea', quantity: 2 }]);
    await expect.poll(async () => digits((await openTables.innerText()).split('/')[0])).toBe(tablesBefore + 1);
    await expect.poll(async () => digits(await openTotal.innerText())).toBe(totalBefore + 70); // two teas: ₺70
  } finally { await cashier.context().close(); await owner.context().close(); }
});

test('05:00: the sign-out explains itself, the basket survives signing in again; from 04:30 a notice warns', async ({ browser }) => {
  const waiter = await signedIn(browser, 'garson');
  try {
    const ends = Date.parse((await (await waiter.request.get('/api/staff/state')).json()).sessionEndsAt);
    await waiter.clock.install({ time: new Date(ends - 20 * 60_000) });
    await waiter.goto('/');
    await expect(waiter.getByText("Oturumunuz 05:00'te bitecek", { exact: false })).toBeVisible();
    await waiter.locator('.sidebar nav').getByRole('button', { name: 'Sipariş al', exact: true }).click();
    await waiter.getByLabel('Sipariş masası').selectOption({ label: 'Masa 05' });
    await waiter.locator('.staff-card', { hasText: 'Demleme Çay' }).click();
    await waiter.getByRole('dialog').getByRole('button', { name: /Sepete ekle/ }).click();
    await expect(waiter.getByRole('button', { name: /Sepeti görüntüle/ })).toContainText('1');
    // 05:00 passes: the server ends the session.
    await waiter.clock.setSystemTime(new Date(ends + 60_000));
    await waiter.route('**/api/staff/state', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHORIZED', message: 'Lütfen çalışan hesabınızla giriş yapın.' }) }));
    await expect(waiter.getByText('İş günü bitti (05:00). Yeniden giriş yapın.')).toBeVisible({ timeout: 10_000 });
    await waiter.unroute('**/api/staff/state');
    await waiter.getByLabel('Kullanıcı adı').fill('garson');
    await waiter.getByLabel('Şifre', { exact: true }).fill(PASSWORD);
    await waiter.getByRole('button', { name: 'Çalışma alanını aç' }).click();
    // Back on Sipariş al (the waiter opens on Masalar, K6): same table, same basket.
  await waiter.locator('.sidebar nav').getByRole('button', { name: 'Sipariş al', exact: true }).click();
    await expect(waiter.getByLabel('Sipariş masası')).toHaveValue('table-5');
    await expect(waiter.getByRole('button', { name: /Sepeti görüntüle/ })).toContainText('1');
  } finally { await waiter.context().close(); }
});

test('cancel window: a campaign-priced tea tied to a paid tea cannot be chosen, says why, and the lemonade still goes', async ({ browser, page }) => {
  const waiter = await signedIn(browser, 'garson'), waiterApi = await api(browser, 'garson');
  let campaignId = '';
  try {
    const before = await (await page.request.get('/api/staff/state')).json();
    const campaign = { name: 'İki çay', productIds: ['tea'], minQuantity: 2, kind: 'fixed', amount: 2000, startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: null, enabled: true, combine: false };
    expect((await page.request.post('/api/staff/campaigns', { data: { requestId: id(), revision: before.revision, campaign } })).ok()).toBe(true);
    campaignId = (await (await page.request.get('/api/staff/campaigns')).json()).campaigns.find((c: { name: string }) => c.name === 'İki çay').id;
    const sent = await order(waiterApi, 'table-7', [{ productId: 'tea', quantity: 1 }, { productId: 'tea', quantity: 1 }, { productId: 'lemonade', quantity: 1 }], 1500 + 1500 + 12000);
    // The cashier takes the first tea's money by item.
    const owner = await (await page.request.get('/api/staff/state')).json(), o = owner.orders.find((x: { id: string }) => x.id === sent.orderId);
    const account = owner.tables.find((t: { account?: { id: string } }) => t.account?.id === sent.accountId).account;
    expect((await page.request.post('/api/staff/payments', { data: { paymentContext: owner.paymentContext, requestId: id(), accountId: account.id, version: account.version, method: 'cash', amount: 1500, tendered: 1500, selections: [{ orderId: sent.orderId, lineId: o.lines[0].id, quantity: 1 }] } })).ok()).toBe(true);
    await waiter.goto('/');
    await waiter.locator('.sidebar nav').getByRole('button', { name: 'Masalar', exact: true }).click();
    await waiter.locator('.table-card', { hasText: 'Masa 07' }).click();
    await waiter.getByRole('button', { name: `Sipariş #${sent.number} · iptal et` }).click();
    const dialog = waiter.getByRole('dialog', { name: `Sipariş #${sent.number} · İptal` });
    const lines = dialog.locator('.staff-cancel-line');
    await expect(lines.nth(0)).toContainText('Ödendi · iptal edilemez');
    await expect(lines.nth(1)).toContainText('kampanya fiyatı ödenen ürüne bağlı; önce iadeyi işletme sahibi yapmalı');
    await expect(lines.nth(1).locator('input, button')).toHaveCount(0);
    await lines.nth(2).getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Ürün bitti', exact: true }).click();
    await dialog.getByRole('button', { name: 'Seçilenleri iptal et' }).click();
    await expect(waiter.getByRole('status').filter({ hasText: `Sipariş #${sent.number}: 1 ürün iptal edildi.` })).toBeVisible();
  } finally {
    await waiter.context().close();
    if (campaignId) {
      const now = await (await page.request.get('/api/staff/state')).json(), c = (await (await page.request.get('/api/staff/campaigns')).json()).campaigns.find((x: { id: string }) => x.id === campaignId);
      await page.request.post('/api/staff/campaigns', { data: { requestId: id(), revision: now.revision, campaign: { id: campaignId, name: c.name, productIds: c.productIds, minQuantity: 2, kind: 'fixed', amount: 2000, startsAt: c.startsAt, endsAt: null, enabled: false, combine: false } } });
    }
  }
});
