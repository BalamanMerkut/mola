import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { seed } from '../server/seed.js';
import { cancelOrder, editOrder, quote, recordPayment, submitOrder } from '../packages/domain/engine.js';
import { reviewOrder } from '../packages/domain/approvals.js';
import { mergeAccounts } from '../packages/domain/merge.js';
import { moveTable } from '../packages/domain/engine.js';
import { campaignUsage, saleProducts, type Campaign } from '../packages/domain/campaigns.js';
import { cartLineTotal, cleanNote, formatWeight } from '../packages/domain/lines.js';
import { employeeReport, productSales, salesOverview } from '../packages/domain/reports.js';
import { popularProductIds } from '../packages/domain/popular.js';
import { paymentDetail } from '../packages/domain/payment-history.js';
import { readPendingOrder, writePendingOrder, type PendingOrder } from '../src/pendingOrder.js';
import { readPendingEdit, writePendingEdit, type PendingEdit } from '../src/pendingEdit.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { Store } from '../server/store.js';
import type { Actor, CartLine, Product, State } from '../packages/domain/types.js';

const now = new Date('2026-10-03T10:00:00Z');
const ctx = (seconds = 0) => ({ now: new Date(now.getTime() + seconds * 1000), id: randomUUID });
const guest = (id = 'guest1', tableId = 'table-1'): Actor => ({ tenantId: 'mola-demo', id, role: 'guest', tableId, epoch: 0 });
const owner: Actor = { tenantId: 'mola-demo', id: 'owner', role: 'owner' };
const cashier: Actor = { tenantId: 'mola-demo', id: 'cashier', role: 'cashier' };
// 1.200 TL per kg; a gift box adds 50 TL once per line, whatever the weight.
const baklava = (): Product => ({ id: 'baklava', code: '60', name: 'Fıstıklı Baklava', nameEn: 'Pistachio Baklava', category: 'Tatlılar', description: '', price: 120000, soldOut: false, art: 'cake', unit: 'kg', groups: [{ id: 'box', name: 'Paket', required: false, options: [{ id: 'gift', name: 'Hediye kutusu', extra: 5000 }] }] });
const withBaklava = () => { const s = seed(); s.products.push(baklava()); return s; };
const total = (s: State, lines: CartLine[]) => quote(saleProducts(s, now), lines, ctx()).reduce((n, l) => n + l.total, 0);
function order(s: State, lines: CartLine[], actor = guest()) { return submitOrder(s, actor, { requestId: randomUUID(), tableId: actor.tableId ?? 'table-1', lines, expectedTotal: total(s, lines) }, ctx()); }
const percent = (over: Partial<Campaign> = {}): Campaign => ({ id: randomUUID(), name: 'Bayram', productIds: ['baklava'], startsAt: '2026-01-01T00:00:00Z', endsAt: null, enabled: true, combine: false, kind: 'percent', percent: 10, ...over } as Campaign);

test('item notes are cleaned (trim, NFC, control and invisible characters) and limited to 140 characters', () => {
  const s = seed();
  const [line] = quote(s.products, [{ productId: 'tea', quantity: 1, selections: [], note: '  Az\tşekerli\n' + String.fromCodePoint(0x202E) + 'olsun' + String.fromCodePoint(0x200B) + '  ' }], ctx());
  assert.equal(line.note, 'Az şekerli olsun');
  assert.equal(cleanNote('Sog' + String.fromCodePoint(0x0306) + 'uk'), 'Soğuk'); assert.equal(cleanNote('Sog' + String.fromCodePoint(0x0306) + 'uk').length, 5);
  assert.equal(quote(s.products, [{ productId: 'tea', quantity: 1, selections: [], note: '   ' }], ctx())[0].note, undefined);
  assert.equal('note' in quote(s.products, [{ productId: 'tea', quantity: 1, selections: [] }], ctx())[0], false);
  // An emoji is one character for the limit, like people count it.
  assert.equal(quote(s.products, [{ productId: 'tea', quantity: 1, selections: [], note: '🙂'.repeat(140) }], ctx())[0].note, '🙂'.repeat(140));
  for (const note of ['x'.repeat(141), 42 as unknown as string]) assert.throws(() => quote(s.products, [{ productId: 'tea', quantity: 1, selections: [], note }], ctx()), (e: { code?: string }) => e.code === 'INVALID_NOTE');
});
test('same product and options with different notes stay separate lines; prices are unaffected', () => {
  const s = seed(), size = [{ groupId: 'size', optionId: 'regular' }];
  order(s, [{ productId: 'latte', quantity: 1, selections: size, note: 'Soğansız olsun' }, { productId: 'latte', quantity: 1, selections: size, note: 'Ayrı tabakta' }, { productId: 'latte', quantity: 2, selections: size }]);
  const lines = s.orders[0].lines;
  assert.deepEqual(lines.map(l => [l.quantity, l.note]), [[1, 'Soğansız olsun'], [1, 'Ayrı tabakta'], [2, undefined]]);
  assert.deepEqual(lines.map(l => l.unitPrice), [14000, 14000, 14000]); assert.equal(s.orders[0].total, 56000);
});
test('a retried order keeps its note in the request fingerprint', () => {
  const s = seed(), body = { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 1, selections: [], note: 'Açık' }], expectedTotal: 3500 };
  const first = submitOrder(s, guest(), body, ctx());
  assert.deepEqual(submitOrder(s, guest(), body, ctx()), first); assert.equal(s.orders.length, 1);
  assert.throws(() => submitOrder(s, guest(), { ...body, lines: [{ ...body.lines[0], note: 'Demli' }] }, ctx()), /farklı içerik/);
});
test('guest edits keep, change or remove the note without repricing the saved line', () => {
  const s = seed(); order(s, [{ productId: 'tea', quantity: 1, selections: [], note: 'Açık olsun' }]);
  s.products.find(p => p.id === 'tea')!.price = 9000;
  const o = s.orders[0], line = o.lines[0];
  const edit = (lines: (CartLine & { existingId?: string })[], expectedTotal: number) => editOrder(s, guest(), { requestId: randomUUID(), orderId: o.id, version: o.version, expectedTotal, lines }, ctx(10));
  edit([{ productId: 'tea', quantity: 2, selections: [], existingId: line.id, note: 'Demli olsun' }], 7000);
  assert.equal(o.lines[0].note, 'Demli olsun'); assert.equal(o.lines[0].unitPrice, 3500); assert.equal(o.lines[0].id, line.id);
  edit([{ productId: 'tea', quantity: 2, selections: [], existingId: line.id }, { productId: 'herbal', quantity: 1, selections: [], note: 'Limonsuz' }], 15500);
  assert.equal('note' in o.lines[0], false); assert.equal(o.lines[1].note, 'Limonsuz');
  assert.throws(() => edit([{ productId: 'tea', quantity: 2, selections: [], existingId: line.id, note: 'x'.repeat(141) }], 7000), (e: { code?: string }) => e.code === 'INVALID_NOTE');
});
test('notes survive approval, table move, merge, cancellation and the closed-account archive', () => {
  const s = seed(); s.waiterApproval = true;
  order(s, [{ productId: 'tea', quantity: 1, selections: [], note: 'Açık' }]);
  reviewOrder(s, { tenantId: 'mola-demo', id: 'waiter', role: 'waiter' }, { requestId: randomUUID(), orderId: s.orders[0].id, version: s.orders[0].version, approve: true }, ctx());
  s.waiterApproval = false; const first = s.accounts[0];
  moveTable(s, cashier, { requestId: randomUUID(), accountId: first.id, version: first.version, targetId: 'table-3', targetEpoch: 0 }, ctx());
  order(s, [{ productId: 'herbal', quantity: 1, selections: [], note: 'Limonsuz' }], guest('guest2', 'table-2'));
  const second = s.accounts.find(a => a.tableId === 'table-2')!;
  mergeAccounts(s, cashier, { requestId: randomUUID(), sourceId: second.id, sourceVersion: second.version, targetId: first.id, targetVersion: first.version }, ctx());
  assert.deepEqual(s.orders.map(o => o.lines[0].note), ['Açık', 'Limonsuz']);
  order(s, [{ productId: 'lemonade', quantity: 1, selections: [], note: 'Buzsuz' }], { ...owner, tableId: 'table-3' });
  const cancelled = s.orders[2];
  cancelOrder(s, owner, { requestId: randomUUID(), orderId: cancelled.id, version: cancelled.version }, ctx());
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.lines[0].note, 'Buzsuz');
  recordPayment(s, owner, { requestId: randomUUID(), accountId: first.id, version: first.version, method: 'cash', amount: 12000, tendered: 12000 }, ctx());
  assert.deepEqual(s.archives[0].orders.map(o => o.lines[0].note), ['Açık', 'Limonsuz', 'Buzsuz']);
});

test('weighed lines: per-kg price for the grams, rounded to kuruş, option extras once per line', () => {
  const s = withBaklava(), p = s.products.at(-1)!;
  const [half, oneAndHalf, gift] = quote(s.products, [{ productId: 'baklava', quantity: 1, selections: [], grams: 500 }, { productId: 'baklava', quantity: 1, selections: [], grams: 1500 }, { productId: 'baklava', quantity: 1, selections: [{ groupId: 'box', optionId: 'gift' }], grams: 2000 }], ctx());
  assert.deepEqual([half.total, oneAndHalf.total, gift.total], [60000, 180000, 245000]);
  assert.deepEqual(gift.weightPricing, { perKg: 120000, extra: 5000 }); assert.equal(gift.unitPrice, gift.total); assert.equal(gift.quantity, 1);
  p.price = 99999; // 999,99 TL/kg: 250 g is 24.999,75 kuruş → 25.000
  assert.equal(quote(s.products, [{ productId: 'baklava', quantity: 1, selections: [], grams: 250 }], ctx())[0].total, 25000);
  assert.equal(quote(s.products, [{ productId: 'baklava', quantity: 1, selections: [], grams: 50 }], ctx())[0].total, 5000);
  // The menus and the basket compute the very same numbers.
  for (const grams of [50, 250, 350, 1050, 20000]) {
    const line = { productId: 'baklava', quantity: 1, selections: [{ groupId: 'box', optionId: 'gift' }], grams };
    assert.equal(cartLineTotal(p, line, 1), quote(s.products, [line], ctx())[0].total, `${grams} g`);
  }
  assert.deepEqual([50, 500, 1000, 1500, 1250, 20000].map(g => formatWeight(g)), ['50 g', '500 g', '1 kg', '1,5 kg', '1,25 kg', '20 kg']);
});
test('weights must be 50 g – 20 kg in 50 g steps, one line per weight; piece products take no grams', () => {
  const s = withBaklava();
  for (const line of [{ grams: 40 }, { grams: 125 }, { grams: 20050 }, { grams: 500, quantity: 2 }, {}, { grams: 500.5 }].map(v => ({ productId: 'baklava', quantity: 1, selections: [], ...v })))
    assert.throws(() => quote(s.products, [line], ctx()), (e: { code?: string }) => e.code === 'INVALID_WEIGHT', JSON.stringify(line));
  assert.throws(() => quote(s.products, [{ productId: 'tea', quantity: 1, selections: [], grams: 500 }], ctx()), (e: { code?: string }) => e.code === 'INVALID_WEIGHT');
  // Older products have no unit and keep selling by the piece.
  assert.equal(quote(s.products, [{ productId: 'tea', quantity: 3, selections: [] }], ctx())[0].total, 10500);
});
test('campaigns: % and TL discounts apply to the weighed line amount; quantity offers never apply; a weighed sale uses one unit of a quota', () => {
  const s = withBaklava(); s.campaigns = [percent()];
  const [line] = quote(saleProducts(s, now), [{ productId: 'baklava', quantity: 1, selections: [], grams: 750 }], ctx());
  assert.deepEqual([line.originalUnitPrice, line.unitPrice, line.total, line.campaigns?.[0].name], [90000, 81000, 81000, 'Bayram']);
  s.campaigns = [percent({ kind: 'fixed', amount: 2000, percent: undefined } as Partial<Campaign>)];
  assert.equal(quote(saleProducts(s, now), [{ productId: 'baklava', quantity: 1, selections: [], grams: 2000 }], ctx())[0].total, 238000, 'TL discount once per line, not per kg');
  s.campaigns = [percent({ minQuantity: 2, percent: 50 })];
  const lines = quote(saleProducts(s, now), [{ productId: 'baklava', quantity: 1, selections: [], grams: 500 }, { productId: 'baklava', quantity: 1, selections: [], grams: 500 }], ctx());
  assert.deepEqual(lines.map(l => l.total), [60000, 60000]); assert.equal(lines[0].campaigns, undefined);
  const limited = percent({ maxQuantity: 2 }); s.campaigns = [limited];
  order(s, [{ productId: 'baklava', quantity: 1, selections: [], grams: 1500 }, { productId: 'baklava', quantity: 1, selections: [], grams: 250 }]);
  assert.equal(campaignUsage(s).get(limited.id), 2);
  assert.deepEqual(saleProducts(s, now).find(p => p.id === 'baklava')!.discounts, [], 'quota used up by two weighed sales');
});
test('guest edit of a weight reprices from the saved per-kg price and discount; sold-out weights may only shrink', () => {
  const s = withBaklava(); s.campaigns = [percent()];
  order(s, [{ productId: 'baklava', quantity: 1, selections: [{ groupId: 'box', optionId: 'gift' }], grams: 500, note: 'Ayrı paket' }]);
  const o = s.orders[0], id = o.lines[0].id;
  assert.equal(o.total, 58500); // (600 TL + 50 TL) − %10
  s.campaigns = []; s.products.at(-1)!.price = 150000;
  const edit = (grams: number, expectedTotal: number) => editOrder(s, guest(), { requestId: randomUUID(), orderId: o.id, version: o.version, expectedTotal, lines: [{ productId: 'baklava', quantity: 1, selections: [{ groupId: 'box', optionId: 'gift' }], grams, existingId: id, note: 'Ayrı paket' }] }, ctx(5));
  edit(1000, 112500);
  assert.deepEqual([o.lines[0].grams, o.lines[0].total, o.lines[0].originalUnitPrice, o.lines[0].note, o.lines[0].id], [1000, 112500, 125000, 'Ayrı paket', id]);
  s.products.at(-1)!.soldOut = true;
  assert.throws(() => edit(1500, 166500), (e: { code?: string }) => e.code === 'ITEM_UNAVAILABLE');
  edit(250, 31500);
  assert.throws(() => edit(260, 31500), (e: { code?: string }) => e.code === 'INVALID_WEIGHT');
});
test('payment by item selection takes a weighed line whole and cannot split it', () => {
  const s = withBaklava();
  order(s, [{ productId: 'baklava', quantity: 1, selections: [], grams: 500 }, { productId: 'tea', quantity: 2, selections: [] }]);
  const a = s.accounts[0], o = s.orders[0], [kg, tea] = o.lines;
  const pay = (selections: { orderId: string; lineId: string; quantity: number }[], amount: number) => recordPayment(s, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount, tendered: amount, selections }, ctx(90));
  assert.throws(() => pay([{ orderId: o.id, lineId: kg.id, quantity: 2 }], 120000), (e: { code?: string }) => e.code === 'INVALID_SELECTION');
  assert.throws(() => pay([{ orderId: o.id, lineId: kg.id, quantity: 1 }], 30000), (e: { code?: string }) => e.code === 'INVALID_AMOUNT');
  assert.equal(pay([{ orderId: o.id, lineId: kg.id, quantity: 1 }], 60000).remaining, 7000);
  assert.throws(() => pay([{ orderId: o.id, lineId: kg.id, quantity: 1 }], 60000), (e: { code?: string }) => e.code === 'ITEM_ALREADY_PAID');
  assert.equal(pay([{ orderId: o.id, lineId: tea.id, quantity: 2 }], 7000).closed, true);
});
test('reports, quotas and popular badges count a weighed sale as one item; product rows are marked kg', () => {
  const s = withBaklava(); s.changeSeconds = 0;
  order(s, [{ productId: 'baklava', quantity: 1, selections: [], grams: 1500 }, { productId: 'baklava', quantity: 1, selections: [], grams: 500 }, { productId: 'tea', quantity: 3, selections: [] }], { tenantId: 'mola-demo', id: 'waiter', role: 'waiter', tableId: 'table-1' });
  const rows = productSales(s, 'all', 'all').products;
  assert.deepEqual(rows.find(r => r.id === 'baklava'), { id: 'baklava', name: 'Fıstıklı Baklava', category: 'Tatlılar', qty: 2, amount: 240000, share: 240000 / 250500, unit: 'kg', grams: 2000 });
  assert.equal('unit' in rows.find(r => r.id === 'tea')!, false); assert.equal('grams' in rows.find(r => r.id === 'tea')!, false);
  const top = salesOverview(s, 'all', 'all', now).topProducts;
  assert.deepEqual([top.find(r => r.id === 'baklava')?.unit, top.find(r => r.id === 'baklava')?.grams], ['kg', 2000]); assert.equal('grams' in top.find(r => r.id === 'tea')!, false);
  assert.equal(employeeReport(s, 'all', 'all').rows.find(r => r.id === 'waiter')?.items, 5, '2 weighed sales + 3 teas');
  assert.deepEqual(popularProductIds(s, now).slice(0, 2), ['tea', 'baklava']);
  // Cancelled weighed orders add no weight.
  order(s, [{ productId: 'baklava', quantity: 1, selections: [], grams: 750 }], { tenantId: 'mola-demo', id: 'waiter', role: 'waiter', tableId: 'table-2' });
  cancelOrder(s, owner, { requestId: randomUUID(), orderId: s.orders.at(-1)!.id, version: s.orders.at(-1)!.version }, ctx());
  assert.equal(productSales(s, 'all', 'all').products.find(r => r.id === 'baklava')?.grams, 2000);
});
test('payment details (İade ve düzeltme) show the weight and note of each line', () => {
  const s = withBaklava();
  order(s, [{ productId: 'baklava', quantity: 1, selections: [], grams: 500, note: 'Ayrı paket' }, { productId: 'baklava', quantity: 1, selections: [], grams: 500 }, { productId: 'baklava', quantity: 1, selections: [], grams: 500 }, { productId: 'tea', quantity: 2, selections: [], note: 'Açık' }]);
  const a = s.accounts[0], o = s.orders[0];
  const pay = (amount: number, selections?: { orderId: string; lineId: string; quantity: number }[]) => recordPayment(s, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount, tendered: amount, ...(selections ? { selections } : {}) }, ctx(90)).paymentId;
  const picked = pay(60000, [{ orderId: o.id, lineId: o.lines[0].id, quantity: 1 }]);
  assert.deepEqual(paymentDetail(s, picked, () => undefined).items, [{ productId: 'baklava', name: 'Fıstıklı Baklava', optionNames: [], quantity: 1, total: 60000, grams: 500, note: 'Ayrı paket' }]);
  // An amount-only payment lists the account: equal weights merge ("2 × 500 g"), a noted line stays apart.
  const rest = pay(127000);
  assert.deepEqual(paymentDetail(s, rest, () => undefined).items, [
    { productId: 'baklava', name: 'Fıstıklı Baklava', optionNames: [], quantity: 1, total: 60000, grams: 500, note: 'Ayrı paket' },
    { productId: 'baklava', name: 'Fıstıklı Baklava', optionNames: [], quantity: 2, total: 120000, grams: 500 },
    { productId: 'tea', name: 'Demleme Çay', optionNames: [], quantity: 2, total: 7000, note: 'Açık' }]);
});
test('pending order and edit records carry the cleaned note and weight, and refuse anything else', () => {
  const data = new Map<string, string>(), storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
  const base: PendingOrder = { version: 1, body: { requestId: 'request-12345', tableId: 'table-1', guestContext: 'a'.repeat(64), expectedTotal: 63500, lines: [{ productId: 'baklava', quantity: 1, selections: [], grams: 500, note: 'Ayrı paket' }, { productId: 'tea', quantity: 1, selections: [] }] }, labels: [{ name: 'Fıstıklı Baklava', options: '', total: 60000 }, { name: 'Demleme Çay', options: '', total: 3500 }] };
  writePendingOrder(storage, 'k', base); assert.deepEqual(readPendingOrder(storage, 'k'), base);
  for (const line of [{ grams: 125 }, { grams: 500, quantity: 2 }, { note: ' Ayrı paket ' }, { note: 'x'.repeat(141) }, { note: 7 }]) {
    writePendingOrder(storage, 'k', { ...base, body: { ...base.body, lines: [{ ...base.body.lines[0], ...line } as CartLine, base.body.lines[1]] } });
    assert.equal(readPendingOrder(storage, 'k'), null, JSON.stringify(line));
  }
  const edit: PendingEdit = { format: 1, number: 7, body: { requestId: 'edit-12345678', guestContext: 'b'.repeat(64), orderId: 'o1', version: 1, expectedTotal: 60000, lines: [{ productId: 'baklava', existingId: 'l1', quantity: 1, selections: [], grams: 500, note: 'Ayrı paket' }] }, labels: [{ name: 'Fıstıklı Baklava', quantity: 1, grams: 500, total: 60000 }] };
  writePendingEdit(storage, 'e', edit); assert.deepEqual(readPendingEdit(storage, 'e'), edit);
  writePendingEdit(storage, 'e', { ...edit, labels: [{ ...edit.labels[0], grams: 1000 }] }); assert.equal(readPendingEdit(storage, 'e'), null);
});

test('HTTP: kg product, guest note and weight reach the kitchen; campaign quantity rule refuses kg products', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/order-lines-')));
  licensed(store); const server = createServer(createApp(store, () => now, () => true));
  // No change window here: the kitchen reads the guest's order at once (17 Ekim: it waits for the window otherwise).
  store.mutate('mola-demo', s => { s.changeSeconds = 0; });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  function client() {
    const jar = new Map<string, string>(); let session = '';
    return async (path: string, body?: unknown) => {
      const response = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'X-Guest-Session': session }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const value of response.headers.getSetCookie()) { const [k, v] = value.split(';')[0].split('='); jar.set(k, v); }
      const data = await response.json() as any;
      if (data.session) session = data.session;
      return { status: response.status, data };
    };
  }
  const ownerCall = client(), kitchenCall = client(), guestCall = client();
  assert.equal((await ownerCall('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await kitchenCall('/login', { username: 'mutfak', password: DEMO_PASSWORD })).status, 200);
  const { id: _, ...product } = baklava();
  assert.equal((await ownerCall('/staff/products', { product: { ...product, photo: null } })).status, 200);
  const saved = store.read('mola-demo').products.find(p => p.code === '60')!;
  assert.equal(saved.unit, 'kg');
  const table = store.read('mola-demo').tables[0];
  const session = await guestCall('/guest/session', { token: table.token }); assert.equal(session.status, 200);
  const placed = await guestCall('/guest/orders', { requestId: randomUUID(), tableId: table.id, expectedTotal: 63500, lines: [{ productId: saved.id, quantity: 1, selections: [], grams: 500, note: '  Ayrı\npaket ' }, { productId: 'tea', quantity: 1, selections: [], note: 'Açık olsun' }] });
  assert.equal(placed.status, 200, JSON.stringify(placed.data));
  const bad = await guestCall('/guest/orders', { requestId: randomUUID(), tableId: table.id, expectedTotal: 60000, lines: [{ productId: saved.id, quantity: 1, selections: [], grams: 510 }] });
  assert.deepEqual([bad.status, bad.data.code], [400, 'INVALID_WEIGHT']);
  const kitchen = (await kitchenCall('/staff/state')).data, lines = kitchen.orders[0].lines;
  assert.deepEqual(lines.map((l: any) => [l.grams, l.note, l.total, l.weightPricing]), [[500, 'Ayrı paket', 0, undefined], [undefined, 'Açık olsun', 0, undefined]]);
  const own = (await guestCall('/guest/state')).data.orders[0].lines;
  assert.deepEqual(own.map((l: any) => l.note), ['Ayrı paket', 'Açık olsun']);
  const items = (await ownerCall(`/staff/accounts/${store.read('mola-demo').accounts[0].id}/items`)).data.items;
  assert.deepEqual(items.map((i: any) => [i.grams, i.quantity, i.unitPrice]), [[500, 1, 60000], [undefined, 1, 3500]]);
  const s = store.read('mola-demo');
  const campaign = await ownerCall('/staff/campaigns', { requestId: randomUUID(), revision: s.menuRevision, campaign: { name: '4 al 3 öde', productIds: [saved.id, 'tea'], minQuantity: 4, kind: 'percent', percent: 25, startsAt: '2026-01-01T00:00:00.000Z', endsAt: null, enabled: true, combine: false } });
  assert.deepEqual([campaign.status, campaign.data.code], [400, 'QUANTITY_RULE_WEIGHT']); assert.match(campaign.data.message, /Fıstıklı Baklava/);
});
