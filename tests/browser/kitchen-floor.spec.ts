import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { ensureSetup } from './helpers';

const PASSWORD = 'MolaDemo!2026';
const id = () => crypto.randomUUID().replace(/-/g, '');

/** A browser AudioContext stand-in that counts every tone started (window.__rings) and starts `state` ('running' unless told). */
function audioMock(start: 'running' | 'suspended' = 'running') {
  return (initial: string) => {
    const w = window as any; w.__rings = 0;
    const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
    const node = () => ({ connect() {}, disconnect() {} });
    class AudioMock {
      state = initial; onstatechange: (() => void) | null = null; currentTime = 0; sampleRate = 8000; destination = {};
      async resume() { if (this.state !== 'closed') { this.state = 'running'; this.onstatechange?.(); } }
      async close() { this.state = 'closed'; }
      createGain() { return { ...node(), gain: param() }; }
      createOscillator() { w.__rings++; return { ...node(), type: 'sine', frequency: param(), onended: null, start() {}, stop() {} }; }
      createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
      createBufferSource() { return { ...node(), buffer: null, onended: null, start() {} }; }
      createBiquadFilter() { return { ...node(), type: 'bandpass', frequency: param(), Q: param() }; }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: AudioMock });
    const wake = { released: false, requests: 0 };
    w.__wake = wake;
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      wake.requests++; wake.released = false;
      const sentinel = new EventTarget() as any; sentinel.released = false;
      sentinel.release = async () => { if (!sentinel.released) { sentinel.released = true; wake.released = true; sentinel.dispatchEvent(new Event('release')); } };
      return sentinel;
    } } });
  };
}
async function kitchenPage(browser: Browser, viewport = { width: 1280, height: 900 }, start: 'running' | 'suspended' = 'running') {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(audioMock(start), start);
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username: 'mutfak', password: PASSWORD } })).ok()).toBe(true);
  await page.goto('/');
  await expect(page.locator('.kitchen-board')).toBeVisible();
  return page;
}
async function staff(browser: Browser, username: string) {
  const context = await browser.newContext();
  expect((await context.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  return context.request;
}
const teaOrder = async (waiter: APIRequestContext, tableId: string, quantity = 1) => {
  const r = await waiter.post('/api/staff/orders', { data: { requestId: id(), tableId, lines: [{ productId: 'tea', quantity, selections: [] }], expectedTotal: 3500 * quantity } });
  expect(r.ok()).toBe(true);
  return r.json() as Promise<{ orderId: string; number: number }>;
};
const rings = (page: Page) => page.evaluate(() => (window as any).__rings as number);
const count = (page: Page, stage: 'Yeni' | 'Hazırlanıyor' | 'Hazır') => page.locator(`.kitchen-column[aria-label="${stage}"] .kitchen-card`).count();

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  expect((await page.request.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: false, changeSeconds: 0, commissionBps: null } })).ok()).toBe(true);
  // Each test starts with an empty kitchen board.
  const { orders } = await (await page.request.get('/api/staff/state')).json();
  for (const o of orders.filter((o: { status: string }) => ['new', 'preparing', 'ready', 'served'].includes(o.status)))
    await page.request.post('/api/staff/orders/cancel', { data: { requestId: id(), orderId: o.id, version: o.version, reason: 'Deneme temizliği' } });
});

test('kitchen sound says "Ses açık" when the browser already plays, and keeps ringing (and the screen awake) on Stok and Hesabım', async ({ browser }) => {
  const kitchen = await kitchenPage(browser), waiter = await staff(browser, 'garson');
  try {
    // Bug: it said "Ses için dokunun" although sound was playing.
    await expect(kitchen.locator('.kitchen-sound-compact [role=status]')).toHaveText('Ses açık');
    await expect(kitchen.getByRole('button', { name: 'Sipariş sesini kapat' })).toBeVisible();
    await kitchen.locator('.kitchen-bar').getByRole('button', { name: 'Stok', exact: true }).click();
    const before = await rings(kitchen);
    await teaOrder(waiter, 'table-1');
    await expect.poll(() => rings(kitchen), { timeout: 8000 }).toBeGreaterThan(before);
    expect(await kitchen.evaluate(() => (window as any).__wake.released)).toBe(false);
    // Back on the board: the order heard on Stok does not ring again, and nothing was swallowed.
    const heard = await rings(kitchen);
    await kitchen.locator('.kitchen-bar').getByRole('button', { name: 'Mutfak panosu' }).click();
    await expect(kitchen.locator('.kitchen-card')).toHaveCount(1);
    await kitchen.waitForTimeout(2500);
    expect(await rings(kitchen)).toBe(heard);
    // Hesabım: still ringing; signing out lets the screen sleep.
    await kitchen.getByRole('button', { name: 'Hesabım', exact: true }).click();
    await kitchen.waitForTimeout(5200); // past the 5-second "one chime per kind" window
    await teaOrder(waiter, 'table-2');
    await expect.poll(() => rings(kitchen), { timeout: 8000 }).toBeGreaterThan(heard);
    expect(await kitchen.evaluate(() => (window as any).__wake.released)).toBe(false);
    await kitchen.locator('.account-logout').getByRole('button', { name: 'Çıkış yap' }).click();
    await expect.poll(() => kitchen.evaluate(() => (window as any).__wake.released)).toBe(true);
  } finally { await kitchen.context().close(); }
});

test('a hurried double tap moves one card only; "Geri al" takes it back; a waiter\'s cancellation rings with a red İPTAL strip', async ({ browser }) => {
  const waiter = await staff(browser, 'garson');
  const first = await teaOrder(waiter, 'table-1'), second = await teaOrder(waiter, 'table-2');
  const kitchen = await kitchenPage(browser);
  try {
    await expect(kitchen.locator('.kitchen-column[aria-label="Yeni"] .kitchen-card')).toHaveCount(2);
    const button = kitchen.locator('.kitchen-column[aria-label="Yeni"] .kitchen-card').first().getByRole('button', { name: /Hazırlamaya başla/ });
    const box = (await button.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
    await kitchen.mouse.click(x, y);
    await expect(kitchen.locator('.kitchen-column[aria-label="Hazırlanıyor"] .kitchen-card')).toHaveCount(1);
    // The next card now sits under the finger: the second tap of the double tap lands on its button…
    expect(await kitchen.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('button')?.textContent ?? '', [x, y])).toMatch(/Hazırlamaya başla/);
    await kitchen.mouse.click(x, y);
    // …and is ignored while the board settles.
    await kitchen.waitForTimeout(1500);
    expect([await count(kitchen, 'Yeni'), await count(kitchen, 'Hazırlanıyor')]).toEqual([1, 1]);
    // "Geri al" for 5 seconds, on the card that moved (nothing floats over the board): back to Yeni.
    const undo = kitchen.locator('.kitchen-column[aria-label="Hazırlanıyor"] .kitchen-undo');
    await expect(undo).toContainText(`Masa 01 · #${first.number} hazırlanıyor`);
    await undo.getByRole('button', { name: 'Geri al' }).click();
    await expect(kitchen.locator('.kitchen-column[aria-label="Yeni"] .kitchen-card')).toHaveCount(2);
    await expect(kitchen.locator('.kitchen-undo')).toHaveCount(0);
    // A deliberate next step on the same card right away is not swallowed (only other cards are guarded).
    await kitchen.locator('.kitchen-card', { hasText: `#${first.number}` }).getByRole('button', { name: /Hazırlamaya başla/ }).click();
    await kitchen.locator('.kitchen-column[aria-label="Hazırlanıyor"] .kitchen-card', { hasText: `#${first.number}` }).getByRole('button', { name: /Hazır olarak işaretle/ }).click();
    await expect(kitchen.locator('.kitchen-column[aria-label="Hazır"] .kitchen-card')).toHaveCount(1);
    await expect(kitchen.locator('.kitchen-column[aria-label="Hazır"] .kitchen-undo')).toContainText(`#${first.number} hazır`);
    // A cancellation by the waiter: its own sound and the strip "İPTAL · Masa · kim · neden".
    const before = await rings(kitchen);
    const state = await (await waiter.get('/api/staff/state')).json(), order = state.orders.find((o: { id: string }) => o.id === second.orderId);
    expect((await waiter.post('/api/staff/orders/cancel', { data: { requestId: id(), orderId: second.orderId, version: order.version, reason: 'Ürün bitti' } })).ok()).toBe(true);
    const strip = kitchen.locator('.kitchen-cancel-strip');
    await expect(strip).toContainText('İPTAL');
    await expect(strip).toContainText(`Masa 02 · #${second.number}`);
    await expect(strip).toContainText('Ürün bitti');
    await expect.poll(() => rings(kitchen)).toBeGreaterThan(before);
    expect(first.number).toBeLessThan(second.number);
  } finally { await kitchen.context().close(); }
});

test('portrait tablet: one stage at a time with tabs and counts; landscape keeps three columns', async ({ browser }) => {
  const waiter = await staff(browser, 'garson');
  await teaOrder(waiter, 'table-1');
  const kitchen = await kitchenPage(browser, { width: 768, height: 1024 });
  try {
    const tabs = kitchen.getByRole('tablist', { name: 'Mutfak aşamaları' });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('tab', { name: /Yeni/ })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: /Yeni/ })).toContainText('1');
    await expect(kitchen.locator('.kitchen-column:visible')).toHaveCount(1);
    await expect(kitchen.locator('.kitchen-column[aria-label="Yeni"]')).toBeVisible();
    await tabs.getByRole('tab', { name: /Hazırlanıyor/ }).click();
    await expect(kitchen.locator('.kitchen-column[aria-label="Hazırlanıyor"]')).toBeVisible();
    await expect(kitchen.locator('.kitchen-column:visible')).toHaveCount(1);
    expect(await kitchen.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await kitchen.setViewportSize({ width: 1024, height: 768 });
    await expect(tabs).toBeHidden();
    await expect(kitchen.locator('.kitchen-column:visible')).toHaveCount(3);
  } finally { await kitchen.context().close(); }
});

test('QR approvals on the kitchen screen show no product codes', async ({ browser, page }) => {
  expect((await page.request.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: true, changeSeconds: 0, commissionBps: null } })).ok()).toBe(true);
  const owner = await (await page.request.get('/api/staff/state')).json(), table = owner.tables[3], code = owner.products.find((p: { id: string }) => p.id === 'tea').code;
  const guest = await browser.newContext();
  const kitchen = await kitchenPage(browser);
  try {
    const session = await (await guest.request.post('/api/guest/session', { data: { token: table.token } })).json();
    expect((await guest.request.post('/api/guest/orders', { headers: { 'X-Guest-Session': session.session }, data: { requestId: id(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }, { productId: 'cheesecake', quantity: 1, selections: [] }], expectedTotal: 22500 } })).ok()).toBe(true);
    const queue = kitchen.getByRole('region', { name: 'Onay bekleyen QR siparişleri' });
    await expect(queue).toContainText('Demleme Çay');
    await expect(queue.locator('.order-line small', { hasText: `#${code}` })).toHaveCount(0);
    // A landscape tablet (8 Ekim denetimi): the buttons sat under the lines, cut off by the short strip above the board.
    await kitchen.setViewportSize({ width: 1024, height: 768 });
    const approve = queue.getByRole('button', { name: 'Onayla ve mutfağa gönder' });
    expect(await approve.evaluate(b => { const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && b.contains(hit); })).toBe(true);
  } finally {
    await guest.close(); await kitchen.context().close();
    await page.request.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: false, changeSeconds: 0, commissionBps: null } });
  }
});
