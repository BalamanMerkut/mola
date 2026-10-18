import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { validateBackupDatabase } from '../server/backup.js';
import { balances, cancelByStaff, recordPayment, submitOrder } from '../packages/domain/engine.js';
import { stateRecords, summarize, Totals } from '../packages/domain/history.js';
import { profitReport, type ProfitDay } from '../packages/domain/profit.js';
import {
  batchShare, DAY, formatAmount, optionCosts, parseAmount, productStock, recipeUsage, selectionKey, stockDay, stockDayStart, stockLevels,
  type MixEntry, type Recipe, type SalesFeed, type SoldLine, type StockData, type StockEntry, type StockItem,
} from '../packages/domain/stock.js';
import { filterStockHistory, stockHistory } from '../packages/domain/stock-history.js';
import type { Actor, CartLine, Product, State } from '../packages/domain/types.js';
import { client, licensed, temp } from './merkez-fixture.js';

const T0 = Date.parse('2026-10-01T06:00:00Z'); // 09:00 in Türkiye
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3600_000;
const item = (id: string, unit: StockItem['unit'], extra: Partial<StockItem> = {}): StockItem => ({ id, name: id, unit, createdAt: iso(T0), ...extra });
const count = (itemId: string, quantity: number, at: number): StockEntry => ({ id: randomUUID(), kind: 'count', at: iso(at), by: 'owner', itemId, quantity });
const latteOptions: Recipe['options'] = [
  { groupId: 'size', optionId: 'large', scale: 1.5 },
  { groupId: 'milk', optionId: 'oat', replace: [{ from: 'sut', to: 'yulaf' }] },
  { groupId: 'extra', optionId: 'shot', add: [{ itemId: 'kahve', amount: 9 }] },
];
/** A feed from plain lists: whole days aggregated, the same days line by line, and the floor. */
function feedOf(lines: SoldLine[], liveLines: SoldLine[] = []): SalesFeed & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    dayMix(day) {
      const m = new Map<string, MixEntry>();
      for (const l of lines) if (stockDay(l.at) === day) { const k = `${l.productId}\n${l.key}`, e = m.get(k) ?? [l.productId, l.key, 0, 0]; e[2] += l.quantity; e[3] += l.grams; m.set(k, e); }
      return [...m.values()];
    },
    dayLines(day) { asked.push(day); return lines.filter(l => stockDay(l.at) === day); },
    live: liveLines,
  };
}
const sold = (at: number, productId: string, quantity: number, key = '', grams = 0): SoldLine => ({ at, productId, key, quantity, grams });

test('Stok: option rules (bigger size, other milk, extra shot) and plain words for amounts', () => {
  const latte: Recipe = { id: 'v1', productId: 'latte', validFrom: iso(T0), items: [{ itemId: 'kahve', amount: 18 }, { itemId: 'sut', amount: 200 }], options: latteOptions };
  assert.deepEqual([...recipeUsage(latte)], [['kahve', 18], ['sut', 200]]);
  assert.deepEqual([...recipeUsage(latte, 'size:large')], [['kahve', 27], ['sut', 300]], 'Büyük boy: the whole recipe × 1,5');
  assert.deepEqual([...recipeUsage(latte, 'milk:oat')], [['kahve', 18], ['yulaf', 200]], 'Yulaf sütü instead of süt');
  assert.deepEqual([...recipeUsage(latte, selectionKey([{ groupId: 'size', optionId: 'large' }, { groupId: 'milk', optionId: 'oat' }, { groupId: 'extra', optionId: 'shot' }]))], [['kahve', 36], ['yulaf', 300]], 'replace, then scale, then the extra shot (+9 g, not scaled)');
  assert.equal(selectionKey([{ groupId: 'size', optionId: 'large' }, { groupId: 'milk', optionId: 'oat' }]), selectionKey([{ groupId: 'milk', optionId: 'oat' }, { groupId: 'size', optionId: 'large' }]), 'the key does not depend on the order of choices');
  assert.equal(formatAmount(2400, 'g'), '2,4 kg'); assert.equal(formatAmount(850, 'g'), '850 g'); assert.equal(formatAmount(1200, 'ml'), '1,2 L'); assert.equal(formatAmount(48, 'piece'), '48 adet'); assert.equal(formatAmount(-120, 'g'), '−120 g');
  assert.equal(parseAmount('1,5', 'kg'), 1500); assert.equal(parseAmount('250', 'g'), 250); assert.equal(parseAmount('2', 'L'), 2000); assert.ok(Number.isNaN(parseAmount('abc', 'kg')));
});

test('Reçete → "Toplu üretimden hesapla": one portion (or one kg) of a batch, rounded as a recipe is written', () => {
  // 1,25 kg un, 250 g tereyağı, 500 g peynir for 10 börek: 125 g, 25 g, 50 g each.
  assert.equal(batchShare(parseAmount('1,25', 'kg'), 10, 'g'), 125);
  assert.equal(batchShare(parseAmount('250', 'g'), 10, 'g'), 25);
  // 1,5 L süt for 12 portions: 125 ml; 2 L for 3 kg of product: 666,67 → 667 ml per kg.
  assert.equal(batchShare(parseAmount('1,5', 'L'), 12, 'ml'), 125);
  assert.equal(batchShare(parseAmount('2', 'L'), 3, 'ml'), 667);
  // Under 10 g/ml to 0,1; above whole.
  assert.equal(batchShare(25, 8, 'g'), 3.1);
  assert.equal(batchShare(99, 8, 'g'), 12);
  assert.equal(batchShare(9.99, 1, 'g'), 10);
  // Adet to 0,01: 3 yumurta for 10 portions, 2 for 3.
  assert.equal(batchShare(3, 10, 'piece'), 0.3);
  assert.equal(batchShare(2, 3, 'piece'), 0.67);
  assert.equal(batchShare(12, 2.5, 'piece'), 4.8, 'a kg product can yield 2,5 kg');
  // Nothing to write: no total, no portions, not a number, or a share that rounds to nothing.
  for (const [total, portions] of [[0, 10], [100, 0], [100, -2], [NaN, 10], [100, NaN], [100, Infinity], [0.01, 1000]] as const) assert.equal(batchShare(total, portions, 'g'), null, `${total} / ${portions}`);
  assert.equal(batchShare(1, 1000, 'piece'), null);
});

test('Stok math: count + purchases − waste − consumption; recipe versions, options, kg products, days by summary or line by line', () => {
  const items = [item('kahve', 'g', { min: 200 }), item('sut', 'ml'), item('yulaf', 'ml'), item('seker', 'g')];
  const recipes: Recipe[] = [
    { id: 'l1', productId: 'latte', validFrom: iso(T0 + H), items: [{ itemId: 'kahve', amount: 18 }, { itemId: 'sut', amount: 200 }], options: latteOptions },
    { id: 't1', productId: 'turk', validFrom: iso(T0 + H), items: [{ itemId: 'kahve', amount: 30 }] },
    // From day 3 noon a latte takes 20 g: sales before keep 18 g.
    { id: 'l2', productId: 'latte', validFrom: iso(T0 + 2 * DAY + 3 * H), items: [{ itemId: 'kahve', amount: 20 }, { itemId: 'sut', amount: 200 }], options: latteOptions },
    // Lokum is sold by the kilogram: 600 g şeker per kg.
    { id: 'k1', productId: 'lokum', validFrom: iso(T0 + H), items: [{ itemId: 'seker', amount: 600 }] },
  ];
  const entries: StockEntry[] = [
    count('kahve', 1000, T0), count('sut', 5000, T0), count('yulaf', 1000, T0), count('seker', 3000, T0),
    { id: 'p1', kind: 'purchase', at: iso(T0 + DAY + 2 * H), by: 'owner', itemId: 'sut', quantity: 2000, total: 8000, unitCost: 4 },
    { id: 'w1', kind: 'waste', at: iso(T0 + DAY + 3 * H), by: 'owner', itemId: 'kahve', quantity: 50, reason: 'Döküldü / kırıldı' },
    { id: 'w2', kind: 'waste', at: iso(T0 + DAY + 4 * H), by: 'owner', itemId: 'kahve', quantity: 999, reason: 'yanlış', deletedAt: iso(T0 + DAY + 5 * H) },
  ];
  const lines = [
    sold(T0 + 30 * 60_000, 'latte', 5),                 // before any recipe: nothing used
    sold(T0 + 2 * H, 'latte', 2),                       // 36 g kahve, 400 ml süt
    sold(T0 + 2 * H, 'latte', 1, 'milk:oat|size:large'),// 27 g kahve, 300 ml yulaf
    sold(T0 + 3 * H, 'turk', 3),                        // 90 g
    sold(T0 + 3 * H, 'lokum', 1, '', 500),              // 300 g şeker
    sold(T0 + DAY + 5 * H, 'latte', 4),                 // day 2 (no boundary: by summary) 72 g, 800 ml
    sold(T0 + DAY + 6 * H, 'turk', 1, 'sugar:none'),    // 30 g
    sold(T0 + 2 * DAY + 1 * H, 'latte', 1),             // day 3 before the change: 18 g
    sold(T0 + 2 * DAY + 5 * H, 'latte', 1),             // after: 20 g
  ];
  const feed = feedOf(lines, [sold(T0 + 3 * DAY + H, 'latte', 1, 'extra:shot')]); // on the floor: 20 + 9 g, 200 ml
  const data: StockData = { items, recipes, entries };
  const levels = stockLevels(data, feed, T0 + 3 * DAY + 2 * H);
  assert.equal(levels.get('kahve')!.stock, 1000 - 50 - (36 + 27 + 90 + 72 + 30 + 18 + 20 + 29));
  assert.equal(levels.get('sut')!.stock, 5000 + 2000 - (400 + 800 + 400 + 200));
  assert.equal(levels.get('yulaf')!.stock, 700);
  assert.equal(levels.get('seker')!.stock, 2700, 'kg product: 0,5 kg × 600 g');
  assert.deepEqual(feed.asked.sort(), [stockDay(T0), stockDay(T0 + 2 * DAY)], 'only days with a count or a recipe change are read line by line');

  // A count resets the start: only what was sold after it counts. The difference is what went missing (fark / fire).
  const counted = { ...data, entries: [...entries, count('kahve', 600, T0 + 2 * DAY + 2 * H)] };
  const after = stockLevels(counted, feedOf(lines, feed.live), T0 + 3 * DAY + 2 * H);
  assert.equal(after.get('kahve')!.stock, 600 - 20 - 29); assert.equal(after.get('kahve')!.counted, true);
  // Low and empty, and how many can still be made.
  const products = [{ id: 'latte' }, { id: 'turk' }, { id: 'lokum', unit: 'kg' as const }, { id: 'tea' }];
  const view = productStock(products, counted, after, T0 + 3 * DAY + 2 * H);
  assert.deepEqual(view.get('latte'), { productId: 'latte', status: 'recipe', makeable: 26, limitingId: 'sut', low: false, empty: false }, 'süt (5200 ml ÷ 200) runs out before kahve (551 g ÷ 20)');
  assert.equal(view.get('turk')!.makeable, Math.floor(551 / 30));
  assert.equal(view.get('lokum')!.makeable, 4.5, 'kg products: kilograms (2700 g ÷ 600 g)');
  assert.equal(view.get('tea')!.status, 'none');
  const low = stockLevels({ ...counted, entries: [...counted.entries, { id: 'w3', kind: 'waste', at: iso(T0 + 3 * DAY + H), by: 'o', itemId: 'kahve', quantity: 400, reason: 'Bozuldu' }] }, feedOf(lines, feed.live), T0 + 3 * DAY + 2 * H);
  assert.equal(low.get('kahve')!.low, true); assert.equal(productStock(products, counted, low, T0 + 3 * DAY + 2 * H).get('latte')!.low, true);
  // A ready-bought product is counted by the piece.
  const water: StockData = { items: [item('su', 'piece', { kind: 'product', productId: 'water', min: 10 })], recipes: [{ id: 'r', productId: 'water', validFrom: iso(T0), items: [{ itemId: 'su', amount: 1 }], ready: true }], entries: [{ id: 'b', kind: 'purchase', at: iso(T0 + 1), by: 'o', itemId: 'su', quantity: 48, total: 48 * 800, unitCost: 800 }] };
  const wl = stockLevels(water, feedOf([sold(T0 + H, 'water', 3)]), T0 + 2 * H);
  assert.deepEqual(productStock([{ id: 'water' }], water, wl, T0 + 2 * H).get('water'), { productId: 'water', status: 'ready', stock: 45, makeable: 45, limitingId: 'su', low: false, empty: false });
});

test('Stok summaries keep option choices: summarize → stored day → back, cancelled orders and items left out', () => {
  const at = iso(T0);
  const line = (productId: string, quantity: number, selections: CartLine['selections'], total: number, grams?: number) => ({ id: randomUUID(), productId, quantity, selections, name: productId, code: '1', optionNames: [], unitPrice: total / quantity, total, ...(grams ? { grams } : {}) });
  const s = { archives: [], payments: [], paymentAdjustments: [], expenses: [], accounts: [], tables: [], orders: [
    { id: 'a', accountId: 'x', status: 'served', createdAt: at, lines: [line('latte', 2, [{ groupId: 'size', optionId: 'large' }], 33000), line('latte', 1, [], 14000)], total: 47000, source: 'staff', guestId: 'w' },
    { id: 'b', accountId: 'x', status: 'cancelled', createdAt: at, lines: [line('latte', 5, [{ groupId: 'size', optionId: 'large' }], 82500)], total: 82500, source: 'staff', guestId: 'w' },
    { id: 'c', accountId: 'x', status: 'new', createdAt: at, lines: [line('lokum', 1, [{ groupId: 'box', optionId: 'gift' }], 20000, 500)], total: 20000, source: 'staff', guestId: 'w' },
  ] } as unknown as State;
  const day = summarize(stateRecords(s), T0 - DAY, T0 + DAY).get(stockDay(T0))!;
  assert.deepEqual([...day.variants.get('latte')!], [['size:large', { quantity: 2, grams: 0 }]]);
  assert.deepEqual([...day.variants.get('lokum')!], [['box:gift', { quantity: 1, grams: 500 }]]);
  const stored = Totals.from(JSON.parse(JSON.stringify(day.toJSON())));
  assert.deepEqual([...stored.variants.get('latte')!], [['size:large', { quantity: 2, grams: 0 }]]);
  assert.equal(stored.products.get('latte')!.quantity, 3);
  assert.equal(new Totals().add(stored).add(stored).variants.get('latte')!.get('size:large')!.quantity, 4, 'spans add up');
  assert.equal('variants' in new Totals().toJSON(), false, 'days without options stay as small as before');
});

test('Kârlılık: revenue after discounts, cost from the recipe and prices of the day, margin, low margin, missing cost', () => {
  const products = [
    { id: 'latte', name: 'Latte', category: 'Kahveler' }, { id: 'cake', name: 'Cheesecake', category: 'Tatlılar' },
    { id: 'tea', name: 'Çay', category: 'Çaylar' }, { id: 'lemon', name: 'Limonata', category: 'Soğuk' },
  ] as Product[];
  const data: StockData = {
    items: [item('kahve', 'g'), item('sut', 'ml'), item('limon', 'piece'), item('pasta', 'piece', { kind: 'product', productId: 'cake' })],
    recipes: [
      { id: 'l', productId: 'latte', validFrom: iso(T0 + DAY), items: [{ itemId: 'kahve', amount: 18 }, { itemId: 'sut', amount: 200 }], options: [{ groupId: 'size', optionId: 'large', scale: 1.5 }] },
      { id: 'c', productId: 'cake', validFrom: iso(T0), items: [{ itemId: 'pasta', amount: 1 }], ready: true },
      { id: 'm', productId: 'lemon', validFrom: iso(T0), items: [{ itemId: 'limon', amount: 2 }] },
    ],
    entries: [
      // Kahve ₺900/kg until day 2, then ₺1000/kg; süt ₺40/L; pasta ₺120; limon has no price.
      { id: 'k1', kind: 'purchase', at: iso(T0), by: 'o', itemId: 'kahve', quantity: 1000, total: 90000, unitCost: 90 },
      { id: 'k2', kind: 'purchase', at: iso(T0 + DAY + H), by: 'o', itemId: 'kahve', quantity: 1000, total: 100000, unitCost: 100 },
      { id: 's1', kind: 'price', at: iso(T0), by: 'o', itemId: 'sut', unitCost: 4 },
      { id: 'p1', kind: 'purchase', at: iso(T0), by: 'o', itemId: 'pasta', quantity: 10, total: 120000, unitCost: 12000 },
    ],
  };
  const dayOf = (rows: [string, number, number][], variants: [string, string, number][] = []): ProfitDay => ({
    products: new Map(rows.map(([id, quantity, amount]) => [id, { first: id, quantity, amount, grams: 0 }])),
    variants: new Map(variants.map(([id, key, quantity]) => [id, new Map([[key, { quantity, grams: 0 }]])])),
  });
  // Day 1 (before the latte recipe existed: the first recipe and the first price count), day 2 with a campaign: 3 lattes for ₺336 instead of ₺420.
  const days: [string, ProfitDay][] = [
    [stockDay(T0), dayOf([['latte', 2, 28000], ['cake', 2, 38000], ['tea', 4, 14000], ['lemon', 1, 12000]])],
    [stockDay(T0 + DAY), dayOf([['latte', 3, 33600]], [['latte', 'size:large', 1]])],
  ];
  const r = profitReport({ from: stockDay(T0), to: stockDay(T0 + DAY), days, products, data, now: T0 + 2 * DAY });
  const latte = r.rows.find(x => x.id === 'latte')!;
  // Day 1: 2 × (18 g × 0,90 + 200 ml × 0,04) = 2 × 24,20 TL; day 2 (₺1000/kg): 2 × (18 + 8) + 1 × 1,5 × 26 = 91 TL.
  assert.equal(latte.revenue, 61600, 'revenue as sold (after the campaign discount)');
  assert.equal(latte.cost, 2 * (1620 + 800) + 2 * (1800 + 800) + 3900);
  assert.equal(latte.profit, 61600 - latte.cost!); assert.ok(latte.margin! > 0.7 && !latte.low);
  const cake = r.rows.find(x => x.id === 'cake')!;
  assert.equal(cake.cost, 24000); assert.equal(cake.profit, 14000); assert.equal(cake.low, true, 'margin 37% < 40%');
  assert.deepEqual([r.rows.find(x => x.id === 'tea')!.cost, r.rows.find(x => x.id === 'tea')!.missing], [null, 'recipe']);
  assert.deepEqual([r.rows.find(x => x.id === 'lemon')!.missing, r.rows.find(x => x.id === 'lemon')!.missingItems], ['price', ['limon']]);
  assert.equal(r.totals.revenue, 61600 + 38000 + 14000 + 12000);
  assert.equal(r.totals.costedRevenue, 61600 + 38000); assert.equal(r.totals.cost, latte.cost! + 24000);
  assert.equal(r.totals.uncostedProducts, 2); assert.equal(r.totals.lowProducts, 1);
  assert.deepEqual(r.categories.map(c => c.name), ['Kahveler', 'Tatlılar', 'Çaylar', 'Soğuk']);
  assert.equal(r.categories.find(c => c.name === 'Çaylar')!.margin, null);
});

test('Stok over HTTP: items, recipes with options, sales and cancellations, settled days, counts, purchases with expense, waste, returns, roles, one notice per crossing, Kârlılık, backups', async t => {
  const store = new Store(temp('stock')); licensed(store);
  let clock = new Date(T0);
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let owner = client(base);
  const login = async (username = 'isletme') => { const c = client(base); assert.equal((await c('/login', { username, password: DEMO_PASSWORD })).status, 200); return c; };
  owner = await login();
  const tenant = 'mola-demo';
  store.mutate(tenant, s => { s.setupCompleted = true; s.products.push({ id: 'lokum', code: '77', name: 'Lokum', nameEn: 'Turkish delight', category: 'Tatlılar', description: '', price: 40000, unit: 'kg', soldOut: false, art: 'sweet', groups: [] }); });
  const ctx = () => ({ now: clock, id: randomUUID });
  const waiter: Actor = { tenantId: tenant, id: 'waiter', role: 'waiter' }, cashier: Actor = { tenantId: tenant, id: 'cashier', role: 'cashier' };
  const latte = (quantity: number, size = 'regular', milk?: string) => ({ productId: 'latte', quantity, selections: [{ groupId: 'size', optionId: size }, ...(milk ? [{ groupId: 'milk', optionId: milk }] : [])] });
  const turk = (quantity: number) => ({ productId: 'turkish', quantity, selections: [{ groupId: 'sugar', optionId: 'none' }] });
  const order = (lines: CartLine[], table = 'table-1') => store.mutate(tenant, s => {
    const total = lines.reduce((n, l) => { const p = s.products.find(x => x.id === l.productId)!; const extra = l.selections.reduce((m, sel) => m + (p.groups.find(g => g.id === sel.groupId)!.options.find(o => o.id === sel.optionId)!.extra), 0); return n + (l.grams ? Math.round(p.price * l.grams / 1000) + extra : (p.price + extra) * l.quantity); }, 0);
    return submitOrder(s, waiter, { requestId: randomUUID(), tableId: table, lines, expectedTotal: total }, ctx()).orderId as string;
  });
  const stock = async () => { const r = await owner('/staff/stock'); assert.equal(r.status, 200); return r.data; };
  const level = (data: any, name: string) => data.items.find((i: any) => i.name === name);

  // Nothing set up: every menu product is "Takip yok".
  let view = await stock();
  assert.equal(view.items.length, 0); assert.equal(view.products.latte.status, 'none'); assert.equal(view.canEdit, true);

  // Items with what is on the shelf now, a minimum and a price.
  const add = async (body: object) => { const r = await owner('/staff/stock/items', body); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.item.id as string; };
  const kahve = await add({ name: 'Kahve', unit: 'g', initial: 1000, min: 200, unitCost: 90 });
  const sut = await add({ name: 'Süt', unit: 'ml', initial: 5000, min: 4700, unitCost: 4 });
  const yulaf = await add({ name: 'Yulaf sütü', unit: 'ml', initial: 1000, unitCost: 6 });
  const seker = await add({ name: 'Şeker', unit: 'g', initial: 3000 });
  assert.equal((await owner('/staff/stock/items', { name: 'kahve', unit: 'g' })).data.code, 'DUPLICATE_ITEM');
  clock = new Date(T0 + 60_000);
  const recipe = (body: object) => owner('/staff/stock/recipes', body);
  assert.equal((await recipe({ productId: 'latte', mode: 'recipe', items: [{ itemId: kahve, amount: 18 }, { itemId: sut, amount: 200 }], options: [{ groupId: 'size', optionId: 'large', scale: 1.5 }, { groupId: 'milk', optionId: 'oat', replace: [{ from: sut, to: yulaf }] }] })).status, 200);
  assert.equal((await recipe({ productId: 'turkish', mode: 'recipe', items: [{ itemId: kahve, amount: 30 }] })).status, 200);
  assert.equal((await recipe({ productId: 'lokum', mode: 'recipe', items: [{ itemId: seker, amount: 600 }] })).status, 200);
  assert.equal((await recipe({ productId: 'lemonade', mode: 'ready' })).status, 200, 'a ready-bought product');
  assert.equal((await recipe({ productId: 'turkish', mode: 'recipe', items: [{ itemId: kahve, amount: 30 }] })).data.unchanged, true, 'saving the same recipe makes no new version');
  assert.equal((await recipe({ productId: 'latte', mode: 'recipe', items: [] })).data.code, 'EMPTY_RECIPE');
  assert.equal((await owner('/staff/stock/items/delete', { id: kahve })).data.code, 'ITEM_IN_USE');

  // Sales: a cancelled order and a cancelled item consume nothing.
  clock = new Date(T0 + 2 * 60_000);
  order([latte(2), latte(1, 'large', 'oat'), { productId: 'lokum', quantity: 1, selections: [], grams: 500 }]);
  const gone = order([latte(1)]);
  const turks = order([turk(3)]);
  store.mutate(tenant, s => { const o = s.orders.find(x => x.id === gone)!; cancelByStaff(s, waiter, { requestId: randomUUID(), orderId: gone, version: o.version, reason: 'Müşteri vazgeçti' }, ctx()); });
  store.mutate(tenant, s => { const o = s.orders.find(x => x.id === turks)!; cancelByStaff(s, waiter, { requestId: randomUUID(), orderId: turks, version: o.version, reason: 'Ürün bitti', lines: [{ lineId: o.lines[0].id, quantity: 1 }] }, ctx()); });
  const expected = { kahve: 1000 - (36 + 27 + 60), sut: 5000 - 400, yulaf: 1000 - 300, seker: 3000 - 300 };
  view = await stock();
  assert.deepEqual([level(view, 'Kahve').stock, level(view, 'Süt').stock, level(view, 'Yulaf sütü').stock, level(view, 'Şeker').stock], [expected.kahve, expected.sut, expected.yulaf, expected.seker]);
  assert.deepEqual([view.products.latte.status, view.products.latte.makeable, view.names[view.products.latte.limitingId]], ['recipe', 23, 'Süt'], '≈ 23 latte, because of the milk');
  assert.equal(view.products.lokum.makeable, 4.5); assert.equal(view.products.lemonade.status, 'ready'); assert.equal(view.products.lemonade.stock, 0);
  assert.equal(view.products.latte.cost, 18 * 90 + 200 * 4, 'current cost of one plain latte');
  assert.deepEqual(level(view, 'Kahve').hints.map((h: any) => h.productId).sort(), ['latte', 'turkish']);

  // One notification when süt goes under its minimum (4600 < 4700), not again on the next reads.
  const notices = () => (store.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE key LIKE 'stock-low:%'").get() as { n: number }).n;
  assert.equal(level(view, 'Süt').low, true); assert.equal(notices(), 1);
  await stock(); await stock(); assert.equal(notices(), 1, 'once per crossing');
  const inbox = (await owner('/staff/notifications')).data.items.filter((n: any) => n.kind === 'stock');
  assert.equal(inbox.length, 1); assert.match(inbox[0].title, /Süt azaldı/);

  // A purchase brings it back (and is also an expense when asked), then selling five lattes crosses again: a second notice.
  const purchase = { requestId: randomUUID(), itemId: sut, quantity: 1000, total: 4500, supplier: 'Mandıra', expense: true, method: 'cash' };
  const bought = await owner('/staff/stock/purchase', purchase);
  assert.equal(bought.status, 200); assert.equal(bought.data.entry.unitCost, 4.5); assert.ok(bought.data.entry.expenseId);
  assert.equal((await owner('/staff/stock/purchase', purchase)).data.entry.id, bought.data.entry.id, 'a retry records nothing twice');
  view = await stock(); assert.equal(level(view, 'Süt').stock, 5600); assert.equal(level(view, 'Süt').low, false);
  const today = stockDay(clock.getTime()), financial = (await owner(`/staff/reports/financial?from=${today}&to=${today}`)).data;
  assert.equal(financial.expenses.filter((e: any) => e.description.startsWith('Stok alışı: Süt')).length, 1, 'one expense');
  order([latte(5)], 'table-2');
  view = await stock(); assert.equal(level(view, 'Süt').stock, 4600); assert.equal(notices(), 2);

  // Settle everything: pay, then a day and more later the tables leave the floor for history. Stock stays the same.
  store.mutate(tenant, s => { for (const a of s.accounts.filter(x => x.status === 'open')) { const b = balances(s, a.id); recordPayment(s, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: b.balance, tendered: b.balance }, ctx()); } });
  clock = new Date(T0 + DAY + 8 * H); owner = await login();
  store.mutate(tenant, () => {});
  assert.equal(store.read(tenant).orders.length, 0, 'orders settled into history');
  view = await stock();
  assert.deepEqual([level(view, 'Kahve').stock, level(view, 'Süt').stock, level(view, 'Yulaf sütü').stock], [expected.kahve - 90, 4600, 700]);

  // Day 2 is a plain day (read from its stored summary); on day 3 the Türk kahvesi recipe changes to 35 g.
  order([turk(2)]); order([latte(1, 'large')]);
  store.mutate(tenant, s => { for (const a of s.accounts.filter(x => x.status === 'open')) { const b = balances(s, a.id); recordPayment(s, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'card', amount: b.balance, tendered: b.balance }, ctx()); } });
  clock = new Date(T0 + 2 * DAY + 8 * H); owner = await login(); store.mutate(tenant, () => {});
  assert.equal((await recipe({ productId: 'turkish', mode: 'recipe', items: [{ itemId: kahve, amount: 35 }] })).status, 200);
  clock = new Date(T0 + 2 * DAY + 9 * H);
  order([turk(1)]);
  view = await stock();
  let kahveNow = expected.kahve - 90 - 60 - 27 - 35;
  assert.equal(level(view, 'Kahve').stock, kahveNow, 'earlier sales keep 30 g, the new one takes 35 g');
  assert.equal(level(view, 'Süt').stock, 4600 - 300);

  // Count: the real amount wins; the difference is shown.
  const counted = await owner('/staff/stock/count', { requestId: randomUUID(), counts: [{ itemId: kahve, quantity: 500 }] });
  assert.equal(counted.status, 200); assert.equal(counted.data.results[0].expected, kahveNow); assert.equal(counted.data.results[0].difference, 500 - kahveNow);
  clock = new Date(T0 + 2 * DAY + 10 * H); order([turk(1)]);
  kahveNow = 500 - 35;
  // Waste and a returned product.
  assert.equal((await owner('/staff/stock/waste', { requestId: randomUUID(), itemId: kahve, quantity: 15, reason: 'Döküldü / kırıldı' })).status, 200);
  const returned = await owner('/staff/stock/return', { requestId: randomUUID(), productId: 'turkish', quantity: 1 });
  assert.equal(returned.status, 200); assert.deepEqual(returned.data.entry.items, [[kahve, 35]]);
  view = await stock(); assert.equal(level(view, 'Kahve').stock, kahveNow - 15 + 35);
  // A wrong entry can be taken back.
  const waste = await owner('/staff/stock/waste', { requestId: randomUUID(), itemId: kahve, quantity: 100, reason: 'Yanlış' });
  assert.equal((await owner('/staff/stock/entries/delete', { id: waste.data.entry.id })).status, 200);
  view = await stock(); assert.equal(level(view, 'Kahve').stock, kahveNow - 15 + 35);
  assert.ok((await owner('/staff/stock/entries')).data.entries.length >= 5);

  // Ready-bought lemonade: 24 bought, 3 sold → "21 adet kaldı".
  const lemon = view.items.find((i: any) => i.productId === 'lemonade');
  assert.equal((await owner('/staff/stock/purchase', { requestId: randomUUID(), itemId: lemon.id, quantity: 24, total: 24 * 2500 })).status, 200);
  order([{ productId: 'lemonade', quantity: 3, selections: [] }]);
  view = await stock(); assert.equal(view.products.lemonade.stock, 21);

  // Roles: only the owner and the kitchen see Stok. The kitchen reads items, recipes and products without money, counts and
  // records fire, takes back only its own count or fire; no purchases, prices, items or recipes. Cashier and waiter: nothing.
  const kasa = await login('kasiyer'), mutfak = await login('mutfak');
  for (const who of [kasa, await login('garson')]) {
    assert.equal((await who('/staff/stock')).status, 403);
    assert.equal((await who('/staff/stock/entries')).status, 403);
    assert.equal((await who('/staff/stock/waste', { requestId: randomUUID(), itemId: kahve, quantity: 1, reason: 'Döküldü' })).status, 403);
  }
  const kitchenView = (await mutfak('/staff/stock')).data;
  assert.equal(kitchenView.canEdit, false); assert.equal(kitchenView.canCount, true);
  assert.ok(kitchenView.recipes.some((r: any) => r.productId === 'latte'), 'the kitchen reads the recipes');
  assert.equal(kitchenView.items[0].unitCost, undefined); assert.equal(kitchenView.items[0].lastPurchase, undefined); assert.equal(kitchenView.products.latte.cost, undefined); assert.equal(kitchenView.lowMargin, undefined);
  assert.ok(kitchenView.entries.length > 0 && kitchenView.entries.every((e: any) => ['count', 'waste', 'return'].includes(e.kind) && e.total === undefined && e.unitCost === undefined && e.supplier === undefined), 'no purchases, no money');
  assert.ok(!JSON.stringify(kitchenView).includes('Mandıra'), 'suppliers stay with the owner');
  for (const [path, body] of [['/staff/stock/items', { name: 'X', unit: 'g' }], ['/staff/stock/recipes', { productId: 'tea', mode: 'none' }], ['/staff/stock/purchase', { requestId: randomUUID(), itemId: kahve, quantity: 10, total: 100 }], ['/staff/stock/return', { requestId: randomUUID(), productId: 'turkish', quantity: 1 }]] as const)
    assert.equal((await mutfak(path, body)).status, 403, path);
  const fire = await mutfak('/staff/stock/waste', { requestId: randomUUID(), itemId: kahve, quantity: 5, reason: 'Döküldü / kırıldı' });
  assert.equal(fire.status, 200); assert.equal(fire.data.entry.byName, 'Mutfak');
  assert.equal((await mutfak('/staff/stock/count', { requestId: randomUUID(), counts: [{ itemId: sut, quantity: 4000 }] })).status, 200);
  const ownersWaste = (await owner('/staff/stock/entries')).data.entries.find((e: any) => e.kind === 'waste' && e.by !== 'mutfak');
  assert.equal((await mutfak('/staff/stock/entries/delete', { id: ownersWaste.id })).status, 403, 'not someone else\'s record');
  assert.equal((await mutfak('/staff/stock/entries/delete', { id: fire.data.entry.id })).status, 200, 'its own fire');
  assert.equal((await kasa('/staff/reports/profit?from=all&to=all')).status, 403);

  // Kârlılık over everything sold.
  const profit = (await owner('/staff/reports/profit?from=all&to=all')).data;
  const lp = profit.rows.find((r: any) => r.id === 'latte'), lem = profit.rows.find((r: any) => r.id === 'lemonade');
  assert.ok(lp.cost > 0 && lp.revenue > lp.cost && lp.margin > 0.7, JSON.stringify(lp));
  assert.equal(lem.cost, 3 * 2500); assert.equal(profit.rows.find((r: any) => r.id === 'tea'), undefined, 'only sold products');
  assert.ok(profit.totals.revenue >= profit.totals.costedRevenue);

  // Sealed rows: names are not in the file in the clear; backups open every stock row with the business key.
  const raw = store.db.prepare('SELECT payload FROM stock_records').all() as { payload: Uint8Array }[];
  assert.ok(raw.length > 10); assert.ok(raw.every(r => !Buffer.from(r.payload).toString('utf8').includes('Mandıra')));
  const copy = `${temp('stock-backup')}/copy.sqlite`; store.db.prepare('VACUUM INTO ?').run(copy);
  await validateBackupDatabase(copy, store.key);
  store.db.prepare("UPDATE stock_records SET tenant='other-demo' WHERE rowid=(SELECT MIN(rowid) FROM stock_records)").run();
  const broken = `${temp('stock-backup')}/broken.sqlite`; store.db.prepare('VACUUM INTO ?').run(broken);
  await assert.rejects(validateBackupDatabase(broken, store.key), 'a moved row does not open');
});

test('8 Ekim "Bu kaydı geri al": the effect is shown first (1 kg → 0 g), only the same business day, never the start amount, kept and audited', async t => {
  const store = new Store(temp('stock-undo')); licensed(store);
  let clock = new Date(T0);
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const login = async (username = 'isletme') => { const c = client(base); assert.equal((await c('/login', { username, password: DEMO_PASSWORD })).status, 200); return c; };
  const owner = await login(), tenant = 'mola-demo';
  store.mutate(tenant, s => { s.setupCompleted = true; });
  // Kahve added empty (the owner's case), then 1 kg bought: 1 kg on the shelf.
  const kahve = (await owner('/staff/stock/items', { name: 'Kahve', unit: 'g', initial: 0 })).data.item.id as string;
  clock = new Date(T0 + 60_000);
  const bought = (await owner('/staff/stock/purchase', { requestId: randomUUID(), itemId: kahve, quantity: 1000, total: 90000 })).data.entry;
  const start = (await owner('/staff/stock/entries')).data.entries.find((e: any) => e.start && e.itemId === kahve);
  // What it would do, before anything changes.
  const preview = await owner(`/staff/stock/entries/undo?id=${bought.id}`);
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.data.changes, [{ itemId: kahve, name: 'Kahve', unit: 'g', before: 1000, after: 0 }]);
  assert.equal((await owner('/staff/stock')).data.items[0].stock, 1000, 'the preview changes nothing');
  // "Başlangıç" is never taken back; the kitchen never takes back a purchase.
  assert.equal((await owner(`/staff/stock/entries/undo?id=${start.id}`)).data.code, 'UNDO_START');
  assert.equal((await owner('/staff/stock/entries/delete', { id: start.id })).data.code, 'UNDO_START');
  const kitchen = await login('mutfak');
  assert.equal((await kitchen('/staff/stock/entries/delete', { id: bought.id })).status, 403);
  // Taken back the same day: the stock is as before, the record is kept (who, when) and audited.
  const undone = await owner('/staff/stock/entries/delete', { id: bought.id });
  assert.equal(undone.status, 200); assert.deepEqual(undone.data.changes, preview.data.changes);
  const view = (await owner('/staff/stock')).data;
  assert.equal(view.items[0].stock, 0);
  assert.equal(view.entries.some((e: any) => e.id === bought.id), false);
  assert.equal(view.undone[0].id, bought.id); assert.equal(view.undone[0].deletedBy, 'İşletme sahibi'); assert.ok(view.undone[0].deletedAt);
  const audit = store.auditLog(tenant).filter(a => a.action === 'stock.entry_undone');
  assert.equal(audit.length, 1); assert.match(audit[0].target, /^purchase:.*Kahve 1 kg→0 g$/);
  assert.equal((await owner('/staff/stock/entries/delete', { id: bought.id })).status, 404, 'once');
  // A record of an earlier business day: refused (a count corrects it), preview included. 05:00 Türkiye is the turn.
  const fire = (await owner('/staff/stock/waste', { requestId: randomUUID(), itemId: kahve, quantity: 10, reason: 'Döküldü / kırıldı' })).data.entry;
  clock = new Date(stockDayStart(stockDay(T0)) + DAY - 60_000);
  assert.equal((await owner(`/staff/stock/entries/undo?id=${fire.id}`)).status, 200, 'still the same business day at 04:59');
  clock = new Date(stockDayStart(stockDay(T0)) + DAY + 60_000);
  const nextDay = await login(); // sign-ins end with the business day too
  for (const r of [await nextDay(`/staff/stock/entries/undo?id=${fire.id}`), await nextDay('/staff/stock/entries/delete', { id: fire.id })]) { assert.equal(r.status, 409); assert.equal(r.data.code, 'UNDO_TOO_OLD'); }
});

test('8 Ekim Reçete penceresi: each option costed alone, as Kârlılık costs that variant; price = product + extra', () => {
  const product = { price: 8500, groups: [{ id: 'milk', name: 'Süt', required: true, options: [{ id: 'none', name: 'Sütsüz', extra: 0 }, { id: 'milk', name: 'Sütlü', extra: 3000 }] }] };
  const recipe: Pick<Recipe, 'items' | 'options'> = { items: [{ itemId: 'kahve', amount: 20 }], options: [{ groupId: 'milk', optionId: 'milk', add: [{ itemId: 'sut', amount: 100 }] }] };
  const prices = (id: string) => id === 'kahve' ? 30 : id === 'sut' ? 3 : null; // ₺300/kg, ₺30/L
  const rows = optionCosts(product, recipe, prices);
  assert.deepEqual(rows.map(r => [r.name, r.cost, r.price, Math.round(r.margin! * 100)]), [['Sütsüz', 600, 8500, 93], ['Sütlü', 900, 11500, 92]], 'a required group: no "Seçeneksiz" row');
  assert.deepEqual(rows[1].usage, [['kahve', 20], ['sut', 100]], 'what one Sütlü takes from stock');
  // The same figure as Kârlılık: one Sütlü sold, today's prices.
  const data: StockData = { items: [item('kahve', 'g'), item('sut', 'ml')], recipes: [{ id: 'r', productId: 'p', validFrom: iso(T0), ...recipe }], entries: [{ id: 'k', kind: 'price', at: iso(T0), by: 'owner', itemId: 'kahve', unitCost: 30 }, { id: 's', kind: 'price', at: iso(T0), by: 'owner', itemId: 'sut', unitCost: 3 }] };
  const day: ProfitDay = { products: new Map([['p', { first: 'Kahve', quantity: 1, amount: 11500, grams: 0 }]]), variants: new Map([['p', new Map([['milk:milk', { quantity: 1, grams: 0 }]])]]) };
  const report = profitReport({ from: stockDay(T0), to: stockDay(T0), days: [[stockDay(T0), day]], products: [{ id: 'p', code: '1', name: 'Kahve', nameEn: '', category: 'Kahveler', description: '', price: 8500, soldOut: false, art: 'coffee', groups: product.groups }], data, now: T0 + H, basis: 'today' });
  assert.equal(report.rows[0].cost, rows[1].cost);
  // Optional groups: the plain product is a row too; an item without a price leaves the cost open.
  const open = optionCosts({ price: 5000, groups: [{ ...product.groups[0], required: false }] }, recipe, id => id === 'kahve' ? 30 : null);
  assert.equal(open[0].name, 'Seçeneksiz'); assert.equal(open[0].cost, 600); assert.equal(open[2].cost, null); assert.deepEqual(open[2].missing, ['sut']);
});

test('8 Ekim Stok → İşlem geçmişi: who did what and when, before → after, filters and pages; the kitchen sees only its own', async t => {
  const store = new Store(temp('stock-history')); licensed(store);
  let clock = new Date(T0);
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const login = async (username = 'isletme') => { const c = client(base); assert.equal((await c('/login', { username, password: DEMO_PASSWORD })).status, 200); return c; };
  const owner = await login(), kitchen = await login('mutfak'), tenant = 'mola-demo';
  store.mutate(tenant, s => { s.setupCompleted = true; });
  const tick = () => { clock = new Date(clock.getTime() + 60_000); };
  const kahve = (await owner('/staff/stock/items', { name: 'Kahve', unit: 'g', initial: 1000, min: 200, unitCost: 90 })).data.item.id as string; tick();
  await owner('/staff/stock/items', { id: kahve, name: 'Kahve çekirdeği', unit: 'g', min: 500, unitCost: 95 }); tick();
  const sut = (await owner('/staff/stock/items', { name: 'Süt', unit: 'ml' })).data.item.id as string; tick();
  await owner('/staff/stock/recipes', { productId: 'latte', mode: 'recipe', items: [{ itemId: kahve, amount: 18 }] }); tick();
  await owner('/staff/stock/recipes', { productId: 'latte', mode: 'recipe', items: [{ itemId: kahve, amount: 20 }, { itemId: sut, amount: 200 }] }); tick();
  const bought = (await owner('/staff/stock/purchase', { requestId: randomUUID(), itemId: kahve, quantity: 1000, total: 95000, supplier: 'Kavurucu' })).data.entry; tick();
  await kitchen('/staff/stock/count', { requestId: randomUUID(), counts: [{ itemId: kahve, quantity: 1800 }] }); tick();
  await kitchen('/staff/stock/waste', { requestId: randomUUID(), itemId: kahve, quantity: 50, reason: 'Döküldü / kırıldı' }); tick();
  await owner('/staff/stock/entries/delete', { id: bought.id }); tick();
  await owner('/staff/stock/items/delete', { id: sut }).then(r => assert.equal(r.status, 409, 'still in the latte recipe'));
  const extra = (await owner('/staff/stock/items', { name: 'Tarçın', unit: 'g' })).data.item.id as string; tick();
  assert.equal((await owner('/staff/stock/items/delete', { id: extra })).status, 200); tick();

  const all = (await owner('/staff/stock/history?range=all')).data;
  assert.ok(all.events.every((e: any, i: number, list: any[]) => i === 0 || list[i - 1].at >= e.at), 'newest first');
  assert.equal(all.events[0].kind, 'item_remove'); assert.equal(all.total, all.events.length);
  const find = (kind: string, pred: (e: any) => boolean = () => true) => all.events.find((e: any) => e.kind === kind && pred(e));
  assert.deepEqual(pick(find('min')), { byName: 'İşletme sahibi', role: 'owner', subject: 'Kahve çekirdeği', before: '200 g', after: '500 g' });
  assert.deepEqual(pick(find('item_edit')), { byName: 'İşletme sahibi', role: 'owner', subject: 'Kahve çekirdeği', before: 'Kahve', after: 'Kahve çekirdeği' });
  assert.equal(find('price', e => !!e.before).before, '₺900 / kg'); assert.equal(find('price', e => !!e.before).after, '₺950 / kg');
  const recipes = all.events.filter((e: any) => e.kind === 'recipe');
  assert.deepEqual([recipes[0].before, recipes[0].after], ['Kahve çekirdeği 18 g', 'Kahve çekirdeği 20 g, Süt 200 ml']); assert.equal(recipes[1].before, 'Reçete yok');
  const count = find('count');
  assert.equal(count.role, 'kitchen'); assert.equal(count.before, '2 kg'); assert.equal(count.after, '1,8 kg'); assert.equal(count.note, 'Fark −200 g');
  const undo = find('undo');
  // Taken back after the count: the stock goes on from the counted amount, so it does not move.
  assert.equal(undo.amount, 'Alış +1 kg'); assert.equal(undo.role, 'owner'); assert.equal(undo.note, 'Stok: Kahve çekirdeği 1,75 kg → 1,75 kg');
  assert.equal(find('item_remove').subject, 'Tarçın');
  assert.equal(find('purchase').note, '₺950 · Kavurucu'); assert.equal(find('purchase').money, true);

  // Filters: an item, a person, a search, today only; pages of 25.
  let reader = owner;
  const only = async (query: string) => (await reader(`/staff/stock/history?${query}`)).data.events.map((e: any) => e.kind);
  assert.ok((await only(`range=all&itemId=${sut}`)).every((k: string) => ['recipe', 'item_add'].includes(k)));
  const cook = all.people.find((p: any) => p.role === 'kitchen');
  assert.deepEqual(await only(`range=all&by=${encodeURIComponent(cook.id)}`), ['waste', 'count']);
  assert.deepEqual(await only('range=all&q=kavurucu'), ['purchase']);
  assert.ok((await only('range=today')).length > 0);
  clock = new Date(T0 + 3 * DAY);
  reader = await login(); // sign-ins end with the business day
  assert.deepEqual(await only('range=today'), []);
  assert.equal((await only('range=7')).length, all.total);

  // The kitchen: its own count and fire, nothing of the owner's (no money, no recipes).
  const mine = (await (await login('mutfak'))('/staff/stock/history?range=all')).data;
  assert.deepEqual(mine.events.map((e: any) => e.kind), ['waste', 'count']); assert.equal(mine.all, false);
  // Old records (no role, no logs) still read: a recipe without byName gets its writer's name from the staff list.
  const data = stockHistory({ items: [item('a', 'g')], recipes: [{ id: 'r', productId: 'latte', validFrom: iso(T0), items: [{ itemId: 'a', amount: 5 }], by: 'cook' }], entries: [{ id: 'w', kind: 'waste', at: iso(T0), by: 'cook', itemId: 'a', quantity: 5, deletedAt: iso(T0 + H), deletedBy: 'İşletme sahibi' }] }, { products: [{ id: 'latte', name: 'Latte' }], staff: [{ id: 'cook', name: 'Ayşe', role: 'kitchen' }] });
  assert.deepEqual(data.map(e => [e.kind, e.byName, e.role]), [['undo', 'İşletme sahibi', ''], ['waste', 'Ayşe', 'kitchen'], ['recipe', 'Ayşe', 'kitchen'], ['item_add', '—', '']]);
  const many = Array.from({ length: 30 }, (_, i) => ({ ...data[1], id: `w${i}` }));
  assert.equal(filterStockHistory(many, { q: 'ayşe' }).length, 30);
});
const pick = (e: any) => ({ byName: e.byName, role: e.role, subject: e.subject, before: e.before, after: e.after });

test('Stok performance: 200 products, 100 items, a year of sales with options, monthly counts and recipe changes in under 200 ms', () => {
  const now = Date.parse('2027-10-01T15:00:00Z'), start = now - 365 * DAY;
  const items: StockItem[] = Array.from({ length: 100 }, (_, i) => ({ id: `i${i}`, name: `Malzeme ${i}`, unit: i % 3 === 0 ? 'piece' : i % 3 === 1 ? 'g' : 'ml', min: 100, createdAt: iso(start) }));
  const recipes: Recipe[] = [], entries: StockEntry[] = [];
  for (let p = 0; p < 200; p++) {
    const parts = Array.from({ length: 3 + (p % 3) }, (_, k) => ({ itemId: `i${(p * 7 + k * 13) % 100}`, amount: 5 + ((p + k) % 40) }));
    const unique = [...new Map(parts.map(x => [x.itemId, x])).values()];
    recipes.push({ id: `r${p}`, productId: `p${p}`, validFrom: iso(start + H), items: unique, options: p % 2 ? [{ groupId: 'size', optionId: 'large', scale: 1.5 }, { groupId: 'extra', optionId: 'shot', add: [{ itemId: 'i1', amount: 9 }] }] : [] });
    if (p % 10 === 0) recipes.push({ id: `r${p}b`, productId: `p${p}`, validFrom: iso(start + (30 + p) * DAY + 5 * H), items: unique.map(x => ({ ...x, amount: x.amount + 2 })), options: [] });
  }
  for (let m = 1; m < 12; m++) for (const it of items) entries.push({ id: `c${m}-${it.id}`, kind: 'count', at: iso(start + m * 30 * DAY + 2 * H), by: 'o', itemId: it.id, quantity: 100_000 });
  for (let d = 0; d < 365; d += 3) for (let i = 0; i < 100; i += 4) entries.push({ id: `b${d}-${i}`, kind: 'purchase', at: iso(start + d * DAY + 3 * H), by: 'o', itemId: `i${i}`, quantity: 5000, total: 100000, unitCost: 20 });
  // About 1 200 sold items a day spread over 200 products, a third of them with options.
  const mixes = new Map<string, MixEntry[]>(), lines = new Map<string, SoldLine[]>();
  for (let d = 0; d <= 365; d++) {
    const day = stockDay(start + d * DAY), mix: MixEntry[] = [], dayLines: SoldLine[] = [];
    for (let p = 0; p < 200; p++) {
      const q = 3 + ((p + d) % 6);
      mix.push([`p${p}`, '', q, 0]); if (p % 2) mix.push([`p${p}`, p % 4 === 1 ? 'size:large' : 'extra:shot|size:large', 2, 0]);
      for (let k = 0; k < 3; k++) dayLines.push(sold(stockDayStart(day) + (8 + k * 4) * H, `p${p}`, 2, k === 2 && p % 2 ? 'size:large' : ''));
    }
    mixes.set(day, mix); lines.set(day, dayLines);
  }
  const feed: SalesFeed = { dayMix: day => mixes.get(day) ?? [], dayLines: day => lines.get(day) ?? [], live: Array.from({ length: 300 }, (_, i) => sold(now - H, `p${i % 200}`, 1, i % 3 ? '' : 'size:large')) };
  const data: StockData = { items, recipes, entries };
  stockLevels(data, feed, now); // warm-up (JIT), like a server that already answered once
  // The best of a few runs: `npm test` runs every test file at once, and one run can lose the processor to another file or
  // to a garbage collection for longer than the work itself. A slower algorithm makes every run slow, so the guard holds.
  const best = (n: number, work: () => void) => { let min = Infinity; for (let i = 0; i < n; i++) { const t = performance.now(); work(); min = Math.min(min, performance.now() - t); } return min; };
  let levels!: ReturnType<typeof stockLevels>, products!: ReturnType<typeof productStock>;
  const ms = best(5, () => { levels = stockLevels(data, feed, now); products = productStock(Array.from({ length: 200 }, (_, p) => ({ id: `p${p}` })), data, levels, now); });
  assert.equal(levels.size, 100); assert.equal(products.size, 200);
  assert.ok([...levels.values()].every(l => Number.isFinite(l.stock)));
  console.log(`Stok: 200 ürün, 100 malzeme, 1 yıl satış → ${ms.toFixed(1)} ms`);
  assert.ok(ms < 200, `stock took ${ms.toFixed(1)} ms`);
  // A year of Kârlılık on the same data.
  const days: [string, ProfitDay][] = [...mixes].map(([day, mix]) => {
    const productsMap = new Map<string, { first: string; quantity: number; amount: number; grams: number }>(), variants = new Map<string, Map<string, { quantity: number; grams: number }>>();
    for (const [id, key, q] of mix) {
      const p = productsMap.get(id) ?? { first: id, quantity: 0, amount: 0, grams: 0 }; p.quantity += q; p.amount += q * 10000; productsMap.set(id, p);
      if (key) { const m = variants.get(id) ?? new Map(); m.set(key, { quantity: q, grams: 0 }); variants.set(id, m); }
    }
    return [day, { products: productsMap, variants }];
  });
  const menu = Array.from({ length: 200 }, (_, p) => ({ id: `p${p}`, name: `Ürün ${p}`, category: `K${p % 8}` }) as Product);
  profitReport({ from: 'all', to: 'all', days, products: menu, data, now }); // warm-up
  let report!: ReturnType<typeof profitReport>;
  const profitMs = best(5, () => { report = profitReport({ from: 'all', to: 'all', days, products: menu, data, now }); });
  console.log(`Kârlılık: 1 yıl, 200 ürün → ${profitMs.toFixed(1)} ms`);
  // A report (read now and then by the owner), not the stock screen: a looser guard, also for a busy test machine.
  assert.equal(report.rows.length, 200); assert.ok(profitMs < 500, `profit took ${profitMs.toFixed(1)} ms`);
});

test('13 Ekim: how many of each option can be made (Türk kahvesi orta şekerli, büyük latte, yulaf sütü)', () => {
  const items = [item('kahve', 'g'), item('sut', 'ml'), item('yulaf', 'ml'), item('seker', 'g')];
  const recipes: Recipe[] = [
    { id: 'l1', productId: 'latte', validFrom: iso(T0), items: [{ itemId: 'kahve', amount: 18 }, { itemId: 'sut', amount: 200 }], options: latteOptions },
    { id: 't1', productId: 'turk', validFrom: iso(T0), items: [{ itemId: 'kahve', amount: 7 }], options: [{ groupId: 'sugar', optionId: 'medium', add: [{ itemId: 'seker', amount: 6 }] }, { groupId: 'sugar', optionId: 'sweet', add: [{ itemId: 'seker', amount: 10 }] }] },
  ];
  const data: StockData = { items, recipes, entries: [count('kahve', 700, T0), count('sut', 2000, T0), count('yulaf', 500, T0), count('seker', 120, T0)] };
  const levels = stockLevels(data, feedOf([]), T0 + H);
  const products = [
    { id: 'latte', groups: [{ id: 'size', name: 'Boy', required: false, options: [{ id: 'large', name: 'Büyük', extra: 0 }] }, { id: 'milk', name: 'Süt', required: false, options: [{ id: 'oat', name: 'Yulaf sütü', extra: 0 }] }, { id: 'extra', name: 'Ekstra', required: false, options: [{ id: 'shot', name: 'Ekstra shot', extra: 0 }] }] },
    { id: 'turk', groups: [{ id: 'sugar', name: 'Şeker', required: true, options: [{ id: 'none', name: 'Sade', extra: 0 }, { id: 'medium', name: 'Orta şekerli', extra: 0 }, { id: 'sweet', name: 'Şekerli', extra: 0 }] }] },
  ] as unknown as Product[];
  const view = productStock(products, data, levels, T0 + H);
  const turk = view.get('turk')!;
  assert.equal(turk.makeable, 100, 'sade: 700 g ÷ 7 g');
  assert.deepEqual(turk.variants?.map(v => [v.option, v.makeable, v.limitingId]), [['Orta şekerli', 20, 'seker'], ['Şekerli', 12, 'seker']], 'şeker (120 g ÷ 6 g, ÷ 10 g) limits the sweet ones');
  const latte = view.get('latte')!;
  assert.equal(latte.makeable, 10, 'süt 2000 ÷ 200');
  assert.deepEqual(latte.variants?.map(v => [v.option, v.makeable]), [['Büyük', 6], ['Yulaf sütü', 2], ['Ekstra shot', 10]], 'büyük: 2000 ÷ 300; yulaf: 500 ÷ 200; shot: kahve 700 ÷ 27 = 25 but süt still 10');
  // Options the menu no longer has are left out; a recipe without option rules has no variants at all.
  assert.equal(productStock([{ id: 'turk' }], data, levels, T0 + H).get('turk')!.variants, undefined);
});