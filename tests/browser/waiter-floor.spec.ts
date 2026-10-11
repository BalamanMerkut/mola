import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bottomNav, ensureSetup, openSettings } from './helpers';

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

/* Hafta sonu bulguları (11 Ekim): 5 garson siparişi değiştirir, 4 uzun süredir sipariş yok hatırlatması, 6a garson ataması ve
 * "Servise hazır", 9 garson masaları birleştirir. Screens for docs/ekran/kafe when KAFE_EKRAN is set. */
async function shot(page: Page, file: string, path: string) {
  await page.screenshot({ path });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file) }); }
}

test('11 Ekim · 5: the waiter changes a line before the kitchen starts; the kitchen card says "Değişti"; a started order says which way remains', async ({ browser }, info) => {
  const waiter = await signedIn(browser, 'garson', { width: 390, height: 844 }), waiterApi = await api(browser, 'garson'), kitchenApi = await api(browser, 'mutfak'), kitchen = await signedIn(browser, 'mutfak');
  try {
    const sent = await order(waiterApi, 'table-9', [{ productId: 'tea', quantity: 2 }]);
    const started = await order(waiterApi, 'table-9', [{ productId: 'lemonade', quantity: 1 }]);
    await step(kitchenApi, started.orderId, 'preparing');
    await waiter.goto('/');
    await waiter.locator('[data-table="table-9"]').click();
    const table = waiter.getByRole('dialog', { name: 'Masa 09' });
    await expect(table.locator('.change-block-note')).toContainText('Mutfak hazırlamaya başladı');
    await expect(table.locator('.change-block-note')).toContainText('İptal et');
    await table.getByRole('button', { name: `Sipariş #${sent.number} · değiştir` }).click();
    const change = waiter.getByRole('dialog', { name: `Sipariş #${sent.number} · Değiştir` });
    await change.getByLabel('Yeni ürün').selectOption('lemonade');
    await change.getByRole('button', { name: 'Bir azalt' }).click();
    await expect(change.locator('.change-summary')).toContainText('Hesap farkı');
    await expect(change.locator('.change-summary')).toContainText('+');
    expect(await waiter.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await shot(waiter, 'garson-siparis-degistir.png', info.outputPath('garson-siparis-degistir.png'));
    await change.getByRole('button', { name: 'Değişikliği kaydet' }).click();
    await expect(waiter.locator('.toast')).toContainText(`Sipariş #${sent.number} değişti: 2 x`);
    await waiter.locator('[data-table="table-9"]').click();
    await expect(table.locator('.order-line-change').first()).toContainText('Değişti: 2 x');
    // The kitchen's card says it plainly; the strip (DEĞİŞTİ) came with the order sound.
    await kitchen.goto('/');
    const card = kitchen.locator('.kitchen-card', { hasText: `#${sent.number}` });
    await expect(card.locator('.order-line-change')).toContainText('Değişti: 2 x');
    await shot(kitchen, 'mutfak-degisiklik.png', info.outputPath('mutfak-degisiklik.png'));
  } finally { await waiter.context().close(); await kitchen.context().close(); }
});

test('11 Ekim · 4: a long-open table reminds the waiter softly once; "Gittim" closes it; the owner sets the minutes', async ({ browser, page }, info) => {
  const waiter = await signedIn(browser, 'garson', { width: 390, height: 844 }), waiterApi = await api(browser, 'garson');
  try {
    await order(waiterApi, 'table-10', [{ productId: 'tea', quantity: 1 }]);
    // The server counts real minutes (tests/hafta-sonu-garson.test.ts); here the screen gets a reminder 47 minutes old.
    let inject = false;
    await waiter.route('**/api/staff/state', async route => {
      // Always the full answer (no X-Mola-Tag): the screen's tag must never keep the made-up reminder after "Gittim".
      const { 'x-mola-tag': _tag, ...headers } = route.request().headers(), r = await route.fetch({ headers });
      if (!inject || r.status() !== 200) return route.fulfill({ response: r });
      const body = await r.json();
      body.tableReminders = [{ tableId: 'table-10', tableName: 'Masa 10', epoch: body.tables.find((t: { id: string }) => t.id === 'table-10').epoch, minutes: 47, since: new Date(Date.now() - 47 * 60_000).toISOString() }];
      await route.fulfill({ response: r, json: body });
    });
    await waiter.goto('/');
    await waiter.getByRole('button', { name: 'Ses kapalı · açmak için dokunun' }).click();
    const before = await waiter.evaluate(() => (window as any).__rings);
    inject = true;
    await expect(waiter.locator('.table-reminder')).toContainText('Masa 10: 47 dakikadır yeni sipariş yok. Bir isteği var mı?', { timeout: 15_000 });
    await expect.poll(() => waiter.evaluate(() => (window as any).__rings)).toBeGreaterThan(before);
    expect(await waiter.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await shot(waiter, 'garson-hatirlatma.png', info.outputPath('garson-hatirlatma.png'));
    inject = false;
    await waiter.getByRole('button', { name: 'Masa 10 · Gittim' }).click();
    await expect(waiter.locator('.table-reminder')).toHaveCount(0);
    // The owner's setting: Sipariş ve mutfak → Sipariş ve onay → Garson hatırlatması.
    await page.goto('/');
    await openSettings(page, 'Sipariş ve onay');
    const card = page.locator('.settings-card', { hasText: 'Garson hatırlatması' });
    await expect(card.getByRole('checkbox', { name: /Uzun süredir sipariş verilmeyen masa/ })).toBeChecked();
    await card.getByLabel('Kaç dakika sonra?').fill('30');
    await card.getByLabel('Kaç dakika sonra?').blur();
    await expect.poll(async () => (await (await page.request.get('/api/staff/state')).json()).tableReminderMinutes).toBe(30);
    await card.scrollIntoViewIfNeeded();
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 });
    await shot(page, 'ayarlar-garson-hatirlatma.png', info.outputPath('ayarlar-garson-hatirlatma.png'));
    expect((await page.request.post('/api/staff/table-reminder', { data: { minutes: 45 } })).ok()).toBe(true);
  } finally { await waiter.context().close(); }
});

test('11 Ekim · 6a: with garson ataması the waiter\'s "Servise hazır" count and list are his own tables; another waiter\'s wait behind a button', async ({ browser, page }, info) => {
  const users = await (await page.request.get('/api/staff/users')).json() as { id: string; username: string }[];
  let second = users.find(u => u.username === 'garson.iki')?.id;
  if (!second) { const made = await page.request.post('/api/staff/users', { data: { username: 'garson.iki', name: 'Ayşe Garson', role: 'waiter', password: 'GarsonIki!2026' } }); expect(made.ok(), await made.text()).toBe(true); second = (await (await page.request.get('/api/staff/users')).json() as { id: string; username: string }[]).find(u => u.username === 'garson.iki')!.id; }
  const me = users.find(u => u.username === 'garson')!.id;
  const kitchen = await api(browser, 'mutfak'), waiterApi = await api(browser, 'garson');
  // Earlier tests of this file left ready orders: they are delivered first, so only this test's two count.
  for (const o of (await (await waiterApi.get('/api/staff/state')).json()).orders.filter((x: { status: string }) => x.status === 'ready')) await waiterApi.post('/api/staff/status', { data: { requestId: id(), orderId: o.id, version: o.version, status: 'served' } });
  expect((await page.request.post('/api/staff/assignments', { data: { enabled: true } })).ok()).toBe(true);
  expect((await page.request.post('/api/staff/assignments', { data: { waiter: { id: me, areas: [], tables: ['table-1'] } } })).ok()).toBe(true);
  expect((await page.request.post('/api/staff/assignments', { data: { waiter: { id: second, areas: [], tables: ['table-2'] } } })).ok()).toBe(true);
  const waiter = await signedIn(browser, 'garson', { width: 390, height: 844 });
  try {
    const mine = await order(waiterApi, 'table-1', [{ productId: 'tea', quantity: 1 }]), theirs = await order(waiterApi, 'table-2', [{ productId: 'tea', quantity: 1 }]);
    for (const o of [mine, theirs]) { await step(kitchen, o.orderId, 'preparing'); await step(kitchen, o.orderId, 'ready'); }
    await waiter.goto('/');
    const nav = bottomNav(waiter).getByRole('button', { name: /^Servise hazır/ });
    await expect(nav.locator('.bottom-nav-count')).toHaveText('1');
    await nav.click();
    const list = waiter.locator('.ready-orders');
    await expect(list.locator('article', { hasText: 'Masa 01' })).toHaveCount(1);
    await expect(list.locator('article', { hasText: 'Masa 02' })).toHaveCount(0);
    await list.getByRole('button', { name: 'Diğer garsonların masaları (1)' }).click();
    await expect(list.locator('article.ready-other', { hasText: 'Masa 02' })).toHaveCount(1);
    await shot(waiter, 'garson-servise-hazir-atama.png', info.outputPath('garson-servise-hazir-atama.png'));
  } finally {
    await waiter.context().close();
    await page.request.post('/api/staff/assignments', { data: { enabled: false } });
  }
});

test('11 Ekim · 9: the waiter joins two occupied tables on the phone for a large group', async ({ browser }, info) => {
  const waiter = await signedIn(browser, 'garson', { width: 390, height: 844 }), waiterApi = await api(browser, 'garson');
  try {
    await order(waiterApi, 'table-11', [{ productId: 'tea', quantity: 1 }]); await order(waiterApi, 'table-12', [{ productId: 'tea', quantity: 2 }]);
    await waiter.goto('/');
    await waiter.locator('[data-table="table-11"]').click();
    await waiter.getByRole('dialog', { name: 'Masa 11' }).getByRole('button', { name: 'Taşı / birleştir' }).click();
    const move = waiter.getByRole('dialog', { name: 'Masa 11 · Taşı / birleştir' });
    await move.getByLabel('Hedef masa').selectOption('table-12');
    await expect(move.locator('.transfer-merge-note')).toContainText('Masa 11 boşalır');
    await shot(waiter, 'garson-masa-birlestir.png', info.outputPath('garson-masa-birlestir.png'));
    await move.getByRole('button', { name: 'Hesapları birleştir · Masa 12' }).click();
    await expect(waiter.locator('.toast')).toContainText('Hesaplar Masa 12 üzerinde birleştirildi.');
    const state = await (await waiterApi.get('/api/staff/state')).json();
    expect(state.tables.find((t: { id: string }) => t.id === 'table-11').account).toBeNull();
  } finally { await waiter.context().close(); }
});

test('11 Ekim · 5 (hazır ürün): a can is swapped after the kitchen started, the kitchen is not told, the cashier sees "Değişti … +₺85" before taking the money', async ({ browser, page }, info) => {
  const mark = async (ids: string[], on: boolean) => {
    for (const pid of ids) {
      const state = await (await page.request.get('/api/staff/state')).json(), p = state.products.find((x: { id: string }) => x.id === pid);
      const r = await page.request.post('/api/staff/products', { data: { requestId: id(), revision: state.revision, id: pid, product: { ...p, readyMade: on } } });
      expect(r.ok(), await r.text()).toBe(true);
    }
  };
  await mark(['tea', 'lemonade'], true);
  const waiter = await signedIn(browser, 'garson', { width: 390, height: 844 }), cashier = await signedIn(browser, 'kasiyer'), waiterApi = await api(browser, 'garson'), kitchenApi = await api(browser, 'mutfak');
  try {
    const sent = await order(waiterApi, 'table-5', [{ productId: 'tea', quantity: 1 }]);
    await step(kitchenApi, sent.orderId, 'preparing');
    await waiter.goto('/');
    await waiter.locator('[data-table="table-5"]').click();
    const table = waiter.getByRole('dialog', { name: 'Masa 05' });
    await table.getByRole('button', { name: `Sipariş #${sent.number} · hazır ürünü değiştir` }).click();
    const change = waiter.getByRole('dialog', { name: `Sipariş #${sent.number} · Değiştir` });
    await expect(change).toContainText('Mutfak uyarılmaz');
    const options = await change.getByLabel('Yeni ürün').locator('option').evaluateAll(list => list.map(o => (o as HTMLOptionElement).value));
    expect(options.sort()).toEqual(['lemonade', 'tea']);
    await change.getByLabel('Yeni ürün').selectOption('lemonade');
    await change.getByRole('button', { name: 'Değişikliği kaydet' }).click();
    await expect(waiter.locator('.toast')).toContainText('Hesaba +₺85 yansıdı.');
    expect((await (await kitchenApi.get('/api/staff/state')).json()).orders.find((o: { id: string }) => o.id === sent.orderId).changes).toBeUndefined();
    // The cashier's payment window says what changed, by whom and the difference.
    await cashier.goto('/');
    await cashier.locator('.table-card', { hasText: 'Masa 05' }).first().click();
    await cashier.getByRole('dialog', { name: 'Masa 05' }).getByRole('button', { name: 'Ödeme al' }).click();
    const changes = cashier.locator('.payment-changes');
    await expect(changes).toContainText('Değişti: 1 x Demleme Çay → 1 x');
    await expect(changes).toContainText('+₺85');
    await shot(cashier, 'kasa-hazir-urun-degisti.png', info.outputPath('kasa-hazir-urun-degisti.png'));
  } finally { await waiter.context().close(); await cashier.context().close(); await mark(['tea', 'lemonade'], false); }
});
