import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import type { IntegrationManager } from '../server/integrations/manager.js';
import { profitReport } from '../packages/domain/profit.js';
import { autoGroup, marginRules, productGroup, thresholdOf } from '../packages/domain/margins.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * "Bu üründen stok kullanıldı mı?": cancellations after the kitchen started an order. The kitchen answers at once when it
 * cancels (or approves a guest's request), later from its screen when a waiter or the owner cancelled; unanswered by the end
 * of the cash day it counts as "Hayır". "Evet" is fire of the recipe amounts. Plus the refund → "stoğa ekle" return, and
 * Kârlılık's own "Düşük kâr" line and "Bugünkü fiyatlarla" basis.
 */
const TENANT = 'mola-demo';
async function cafe(t: { after: (fn: () => Promise<void>) => void }, start: string) {
  const store = new Store(temp('stock-cancel')); licensed(store);
  let clock = new Date(start);
  const app = createApp(store, () => clock), server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { (app.locals.integrations as IntegrationManager).stop(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client(guestSession?: () => string) {
    const jar = new Map<string, string>();
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/json', ...(guestSession ? { 'X-Guest-Session': guestSession() } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of r.headers.getSetCookie()) { const [k, v] = c.split(';')[0].split('='); jar.set(k, v); }
      return { status: r.status, data: await r.json() as any };
    };
    return Object.assign(call, { login: (username: string) => call('/login', { username, password: DEMO_PASSWORD }) });
  }
  const ok = (r: { status: number; data: any }) => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const owner = client(), waiter = client(), kitchen = client(), cashier = client();
  for (const [c, u] of [[owner, 'isletme'], [waiter, 'garson'], [kitchen, 'mutfak'], [cashier, 'kasiyer']] as const) assert.equal((await c.login(u)).status, 200);
  return { store, client, ok, owner, waiter, kitchen, cashier, set: (iso: string) => { clock = new Date(iso); }, relogin: async () => { for (const [c, u] of [[owner, 'isletme'], [waiter, 'garson'], [kitchen, 'mutfak'], [cashier, 'kasiyer']] as const) assert.equal((await c.login(u)).status, 200); } };
}

test('a cancellation after the kitchen started asks about stock: the kitchen answers at once or later, "Evet" is fire, "Hayır" and untouched orders change nothing, the day end closes the question', async t => {
  const c = await cafe(t, '2026-10-04T08:00:00Z');
  const { ok, owner, waiter, kitchen } = c;
  c.store.mutate(TENANT, s => { s.changeSeconds = 0; });
  const leaf = ok(await owner('/staff/stock/items', { name: 'Çay yaprağı', unit: 'g', initial: 1000, unitCost: 40 })).item.id;
  c.set('2026-10-04T08:01:00Z');
  ok(await owner('/staff/stock/recipes', { productId: 'tea', mode: 'recipe', items: [{ itemId: leaf, amount: 5 }] }));
  const level = async () => ok(await owner('/staff/stock')).items.find((i: any) => i.id === leaf).stock as number;
  const fires = async () => ok(await owner('/staff/stock/entries')).entries.filter((e: any) => e.kind === 'waste') as any[];
  const tables = ok(await owner('/staff/state')).tables as any[];
  const order = async (table: number, quantity: number, productId = 'tea', price = 3500) => ok(await waiter('/staff/orders', { requestId: randomUUID(), tableId: tables[table].id, lines: [{ productId, quantity, selections: [] }], expectedTotal: price * quantity }));
  const kitchenOrder = async (orderId: string) => ok(await kitchen('/staff/state')).orders.find((o: any) => o.id === orderId);
  const start = async (orderId: string) => { const o = await kitchenOrder(orderId); ok(await kitchen('/staff/status', { requestId: randomUUID(), orderId, version: o.version, status: 'preparing' })); return kitchenOrder(orderId); };
  const cancel = async (by: typeof waiter, orderId: string, lines?: { lineId: string; quantity: number }[], stockUsed?: boolean) => { const o = await kitchenOrder(orderId); return ok(await by('/staff/orders/cancel', { requestId: randomUUID(), orderId, version: o.version, reason: 'Müşteri vazgeçti', ...(lines ? { lines } : {}), ...(stockUsed !== undefined ? { stockUsed } : {}) })); };
  const questions = async () => (ok(await kitchen('/staff/state')).stockQuestions ?? []) as any[];
  assert.ok(ok(await kitchen('/staff/state')).stockProducts.includes('tea'), 'the kitchen knows which products have a recipe');
  assert.equal(ok(await waiter('/staff/state')).stockProducts, undefined);

  // Before the kitchen started: nothing to ask.
  const a = await order(0, 2);
  let o = await kitchenOrder(a.orderId);
  assert.equal((await cancel(waiter, a.orderId, [{ lineId: o.lines[0].id, quantity: 1 }])).stockQuestion, undefined);
  // Started, then the waiter cancels the rest: the kitchen screen asks.
  o = await start(a.orderId);
  const asked = await cancel(waiter, a.orderId);
  assert.ok(asked.stockQuestion);
  let list = await questions();
  assert.equal(list.length, 1); assert.deepEqual([list[0].tableName, list[0].byName, list[0].lines[0].quantity, list[0].lines[0].name], [tables[0].name, 'Garson', 1, 'Demleme Çay']);
  assert.equal(ok(await waiter('/staff/state')).stockQuestions, undefined, 'only the kitchen answers');
  assert.equal((await waiter('/staff/stock/answer', { orderId: a.orderId, questionId: asked.stockQuestion, used: true })).status, 403);
  const before = await level();
  assert.equal(ok(await kitchen('/staff/stock/answer', { orderId: a.orderId, questionId: asked.stockQuestion, used: true })).wasted, 1);
  assert.equal(await level(), before - 5, 'Evet: the recipe amount is fire');
  assert.match((await fires())[0].reason, /^İptal · hazırlanmıştı/);
  assert.equal(ok(await kitchen('/staff/stock/answer', { orderId: a.orderId, questionId: asked.stockQuestion, used: true })).already, true);
  assert.equal(await level(), before - 5, 'answered once');
  assert.equal((await questions()).length, 0);

  // The kitchen cancels one of three it had started: "Hayır" in the same window, nothing changes, nothing waits.
  const b = await order(1, 3);
  o = await start(b.orderId);
  const no = await cancel(kitchen, b.orderId, [{ lineId: o.lines[0].id, quantity: 1 }], false);
  assert.equal(no.stock.answer, 'no'); assert.equal(no.stock.wasted, 0);
  assert.equal(await level(), before - 5 - 2 * 5, 'the two left are sold; the cancelled one is not');
  // The kitchen cancels a whole started order: "Evet".
  const d = await order(2, 2);
  await start(d.orderId);
  assert.equal((await cancel(kitchen, d.orderId, undefined, true)).stock.wasted, 1);
  assert.equal(await level(), before - 5 - 10 - 10);
  assert.equal((await questions()).length, 0);

  // A guest's cancel request after the kitchen started: approving it answers too.
  const token = c.store.read(TENANT).tables.find(x => x.id === tables[3].id)!.token;
  let session = '';
  const guest = c.client(() => session);
  const opened = ok(await guest('/guest/session', { token })); session = opened.session;
  const g = ok(await guest('/guest/orders', { requestId: randomUUID(), tableId: tables[3].id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500, guestContext: opened.guestContext }));
  o = await start(g.orderId);
  assert.equal(ok(await guest('/guest/cancel', { requestId: randomUUID(), orderId: g.orderId, version: o.version, guestContext: opened.guestContext })).requested, true);
  o = await kitchenOrder(g.orderId);
  const approved = ok(await kitchen('/staff/cancel', { requestId: randomUUID(), orderId: g.orderId, version: o.version, stockUsed: true }));
  assert.equal(approved.stock.wasted, 1);
  assert.equal(await level(), before - 5 - 10 - 10 - 5);

  // A product without a recipe never asks; the owner's cancellation waits on the kitchen screen until the day ends.
  const cake = await order(4, 1, 'cheesecake', ok(await owner('/staff/state')).products.find((p: any) => p.id === 'cheesecake').price);
  await start(cake.orderId);
  await cancel(owner, cake.orderId);
  assert.equal((await questions()).length, 0, 'no recipe, no question');
  const e = await order(5, 1);
  await start(e.orderId);
  const late = await cancel(owner, e.orderId);
  assert.equal((await questions()).length, 1);
  c.set('2026-10-05T01:30:00Z'); assert.equal((await questions()).length, 1, 'still the same cash day at 04:30');
  c.set('2026-10-05T03:00:00Z'); await c.relogin();
  assert.equal((await questions()).length, 0, 'after 06:00 the question counts as "Hayır"');
  const closed = await kitchen('/staff/stock/answer', { orderId: e.orderId, questionId: late.stockQuestion, used: true });
  assert.equal(closed.status, 409); assert.equal(closed.data.code, 'QUESTION_CLOSED');
  assert.equal(await level(), before - 30, 'the closed question wrote nothing');
});

test('refund with "stoğa ekle" puts the recipe back; Kârlılık: the owner\'s "Düşük kâr" line and costs at today\'s prices', async t => {
  const c = await cafe(t, '2026-10-04T08:00:00Z');
  const { ok, owner, waiter, cashier } = c;
  const leaf = ok(await owner('/staff/stock/items', { name: 'Çay yaprağı', unit: 'g', initial: 1000, unitCost: 100 })).item.id;
  c.set('2026-10-04T08:01:00Z');
  ok(await owner('/staff/stock/recipes', { productId: 'tea', mode: 'recipe', items: [{ itemId: leaf, amount: 20 }] }));
  const table = ok(await owner('/staff/state')).tables[0];
  const placed = ok(await waiter('/staff/orders', { requestId: randomUUID(), tableId: table.id, lines: [{ productId: 'tea', quantity: 4, selections: [] }], expectedTotal: 14000 }));
  const account = ok(await cashier('/staff/state')).tables.find((x: any) => x.account?.id === placed.accountId).account;
  ok(await cashier('/staff/payments', { requestId: randomUUID(), accountId: placed.accountId, version: account.version, method: 'cash', amount: 14000, tendered: 14000 }));
  const stock = async () => ok(await owner('/staff/stock')).items.find((i: any) => i.id === leaf).stock as number;
  assert.equal(await stock(), 1000 - 80);
  // İade ve düzeltme: a refund alone never touches Stok; ticking "Ürünler kullanılmadan geri döndü" adds a return.
  const row = ok(await owner('/staff/payment-adjustments?from=2026-10-04&to=2026-10-04')).rows[0];
  const detail = ok(await owner(`/staff/payment-adjustments/${row.id}`));
  assert.equal(detail.items[0].productId, 'tea', 'the refund window knows which product came back');
  ok(await owner('/staff/payment-adjustments', { requestId: randomUUID(), paymentId: row.id, revision: 0, kind: 'refund', amount: 3500, method: 'cash', commission: 0, reason: 'Soğuk' }));
  assert.equal(await stock(), 920, 'the refund alone changes nothing');
  ok(await owner('/staff/stock/return', { requestId: randomUUID(), productId: detail.items[0].productId, quantity: 1 }));
  assert.equal(await stock(), 940);

  // Kârlılık: tea ("Çaylar" → İçecekler, warned under %70) costs 20 g × ₺1 = ₺20 of ₺35 → %43: "Düşük kâr".
  const profit = async () => { const r = ok(await owner('/staff/reports/profit?from=2026-10-04&to=2026-10-04')); return { report: r, tea: r.rows.find((x: any) => x.id === 'tea') }; };
  let { report, tea } = await profit();
  assert.deepEqual([tea.cost, tea.group, tea.threshold, tea.low, report.marginAlerts, report.basis, report.categories.find((c: any) => c.name === tea.category).threshold], [8000, 'drinks', 0.7, true, true, 'sale', 0.7]);
  const settings = ok(await owner('/staff/profit/settings'));
  assert.deepEqual([settings.enabled, settings.groups, settings.defaults], [true, { drinks: 70, food: 65, dessert: 65, ready: 30 }, { drinks: 70, food: 65, dessert: 65, ready: 30 }]);
  assert.deepEqual(settings.categories.find((c: any) => c.name === tea.category), { name: tea.category, auto: 'drinks', group: null });
  const body = (over: object = {}) => ({ enabled: true, groups: { drinks: 70, food: 65, dessert: 65, ready: 30 }, ...over });
  assert.equal((await cashier('/staff/profit/settings', body())).status, 403);
  assert.equal((await owner('/staff/profit/settings', body({ groups: { drinks: 0, food: 65, dessert: 65, ready: 30 } }))).status, 400);
  // The owner's own line for drinks (%40): tea is fine now.
  ok(await owner('/staff/profit/settings', body({ groups: { drinks: 40, food: 65, dessert: 65, ready: 30 } })));
  ({ tea } = await profit()); assert.deepEqual([tea.threshold, tea.low], [0.4, false]);
  // A category moved to another group ("Hazır ürünler", %30); the automatic group itself is never stored.
  ok(await owner('/staff/profit/settings', body({ categories: { [tea.category]: 'ready', Tatlılar: 'dessert' } })));
  assert.deepEqual(c.store.read(TENANT).marginAlerts, { enabled: true, categories: { [tea.category]: 'ready' } });
  ({ tea } = await profit()); assert.deepEqual([tea.group, tea.threshold, tea.low], ['ready', 0.3, false]);
  assert.equal(ok(await owner('/staff/stock')).thresholds.tea, 0.3, 'Reçeteler marks with the same line');
  // Off: nothing is marked anywhere.
  ok(await owner('/staff/profit/settings', body({ enabled: false })));
  ({ report, tea } = await profit());
  assert.deepEqual([report.marginAlerts, tea.threshold, tea.low, report.totals.lowProducts], [false, null, false, 0]);
  assert.equal(ok(await owner('/staff/stock')).thresholds.tea, null);
  // "Varsayılana dön": on, trade defaults, automatic groups.
  ok(await owner('/staff/profit/settings', body({ categories: { [tea.category]: null } })));
  assert.deepEqual(c.store.read(TENANT).marginAlerts, { enabled: true });
  ({ tea } = await profit()); assert.deepEqual([tea.group, tea.threshold, tea.low], ['drinks', 0.7, true]);
  // The next day the leaf costs ₺0,50 / g: the sale keeps its own price; "Bugünkü fiyatlarla" recosts it.
  c.set('2026-10-05T09:00:00Z'); await c.relogin();
  ok(await owner('/staff/stock/purchase', { requestId: randomUUID(), itemId: leaf, quantity: 1000, total: 50000 }));
  const sale = ok(await owner('/staff/reports/profit?from=2026-10-04&to=2026-10-04')).rows.find((r: any) => r.id === 'tea');
  const today = ok(await owner('/staff/reports/profit?from=2026-10-04&to=2026-10-04&basis=today'));
  assert.equal(sale.cost, 8000); assert.equal(today.basis, 'today'); assert.equal(today.rows.find((r: any) => r.id === 'tea').cost, 4000);
  assert.equal((await owner('/staff/reports/profit?from=2026-10-04&to=2026-10-04&basis=yarın')).status, 400);
});

test('Kârlılık "Bugünkü fiyatlarla" uses the recipe in force now, also for sales of an older recipe', () => {
  const day = '2026-10-01', at = (iso: string) => iso;
  const data = { items: [{ id: 'k', name: 'Kahve', unit: 'g' as const, createdAt: at('2026-09-01T00:00:00Z') }],
    recipes: [{ id: 'r1', productId: 'p', validFrom: at('2026-09-01T00:00:00Z'), items: [{ itemId: 'k', amount: 10 }] }, { id: 'r2', productId: 'p', validFrom: at('2026-10-03T00:00:00Z'), items: [{ itemId: 'k', amount: 20 }] }],
    entries: [{ id: 'e1', kind: 'price' as const, at: at('2026-09-01T00:00:00Z'), by: 'o', itemId: 'k', unitCost: 1 }, { id: 'e2', kind: 'purchase' as const, at: at('2026-10-04T00:00:00Z'), by: 'o', itemId: 'k', quantity: 100, total: 300, unitCost: 3 }] };
  const days: [string, any][] = [[day, { products: new Map([['p', { first: 'Kahve', quantity: 2, amount: 10000, grams: 0 }]]), variants: new Map() }]];
  const products = [{ id: 'p', name: 'Kahve', category: 'Sıcak' }] as any;
  const now = Date.parse('2026-10-05T00:00:00Z');
  assert.equal(profitReport({ from: day, to: day, days, products, data, now }).rows[0].cost, 2 * 10 * 1);
  const today = profitReport({ from: day, to: day, days, products, data, now, basis: 'today', lowMargin: 0.99 });
  assert.equal(today.rows[0].cost, 2 * 20 * 3); assert.equal(today.rows[0].low, true); assert.equal(today.basis, 'today');
});

test('"Düşük kâr" groups: categories by their names, ready-bought products first, the owner\'s moves, the trade defaults and the switch', () => {
  const rules = marginRules({});
  assert.deepEqual(['Kahveler', 'Çaylar', 'Soğuk İçecekler', 'Meşrubat', 'Ana Yemekler', 'Çorbalar', 'Burgerler', 'Tatlılar', 'Baklava', 'Fırından', 'Unlu Mamuller', 'Diğer'].map(autoGroup),
    ['drinks', 'drinks', 'drinks', 'drinks', 'food', 'food', 'food', 'dessert', 'dessert', 'dessert', 'dessert', 'food']);
  assert.deepEqual(rules.groups, { drinks: 0.7, food: 0.65, dessert: 0.65, ready: 0.3 }); assert.equal(rules.enabled, true);
  assert.equal(productGroup({ category: 'Soğuk İçecekler' }, true, rules), 'ready', 'a bottle of water bought ready is a ready product');
  assert.equal(productGroup({ category: 'Kahvaltı' }, false, marginRules({ categories: { Kahvaltı: 'dessert' } })), 'dessert');
  assert.equal(thresholdOf('food', marginRules({ groups: { food: 0.5 } })), 0.5);
  assert.equal(thresholdOf('food', marginRules({ groups: { food: 3 } })), 0.65, 'a broken value falls back to the default');
  assert.equal(thresholdOf('drinks', marginRules({ enabled: false })), null);
  // In the report: water (ready, %40) is fine, the same %40 on a coffee is low.
  const day = '2026-10-01', now = Date.parse('2026-10-02T00:00:00Z');
  const data = { items: [{ id: 'w', name: 'Su', unit: 'piece' as const, kind: 'product' as const, productId: 'water', createdAt: '2026-09-01T00:00:00Z' }, { id: 'k', name: 'Kahve', unit: 'g' as const, createdAt: '2026-09-01T00:00:00Z' }],
    recipes: [{ id: 'r1', productId: 'water', validFrom: '2026-09-01T00:00:00Z', items: [{ itemId: 'w', amount: 1 }], ready: true }, { id: 'r2', productId: 'coffee', validFrom: '2026-09-01T00:00:00Z', items: [{ itemId: 'k', amount: 10 }] }],
    entries: [{ id: 'e1', kind: 'price' as const, at: '2026-09-01T00:00:00Z', by: 'o', itemId: 'w', unitCost: 600 }, { id: 'e2', kind: 'price' as const, at: '2026-09-01T00:00:00Z', by: 'o', itemId: 'k', unitCost: 60 }] };
  const days: [string, any][] = [[day, { products: new Map([['water', { first: 'Su', quantity: 1, amount: 1000, grams: 0 }], ['coffee', { first: 'Kahve', quantity: 1, amount: 1000, grams: 0 }]]), variants: new Map() }]];
  const products = [{ id: 'water', name: 'Su', category: 'Soğuk İçecekler' }, { id: 'coffee', name: 'Kahve', category: 'Kahveler' }] as any;
  const on = profitReport({ from: day, to: day, days, products, data, now, margins: {} });
  const row = (r: typeof on, id: string) => r.rows.find(x => x.id === id)!;
  assert.deepEqual([row(on, 'water').group, row(on, 'water').margin, row(on, 'water').low], ['ready', 0.4, false]);
  assert.deepEqual([row(on, 'coffee').group, row(on, 'coffee').margin, row(on, 'coffee').low], ['drinks', 0.4, true]);
  assert.equal(on.lowMargin, null); assert.equal(on.totals.lowProducts, 1);
  const off = profitReport({ from: day, to: day, days, products, data, now, margins: { enabled: false } });
  assert.deepEqual([off.marginAlerts, off.totals.lowProducts, row(off, 'coffee').threshold], [false, 0, null]);
});
