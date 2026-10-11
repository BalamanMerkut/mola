import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { seed } from '../server/seed.js';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { DomainError, editOrder, recordPayment, setStatus, submitOrder, submitTakeaway } from '../packages/domain/engine.js';
import { billTicket, kitchenTicket, renderText, type PrinterConfig } from '../packages/domain/printing.js';
import { notePlaceholder } from '../packages/domain/lines.js';
import { readPendingOrder, type PendingOrder } from '../src/pendingOrder.js';
import { readPendingEdit, type PendingEdit } from '../src/pendingEdit.js';
import type { Actor, Product, State } from '../packages/domain/types.js';

// "Paketlensin": a seated guest (or staff for them) asks for a table order to be packed to go.
const at = (iso: string) => ({ now: new Date(iso), id: randomUUID });
const owner: Actor = { tenantId: 'mola-demo', id: 'owner', role: 'owner' };
const waiter: Actor = { ...owner, id: 'waiter', role: 'waiter' };
const kitchen: Actor = { ...owner, id: 'kitchen', role: 'kitchen' };
const guest: Actor = { ...owner, id: 'guest-browser', role: 'guest', tableId: 'table-1', epoch: 0 };
const tea = (quantity = 1) => ({ lines: [{ productId: 'tea', quantity, selections: [] }], expectedTotal: 3500 * quantity });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return 'NO_ERROR'; };
const printer: PrinterConfig = { id: 'p', name: 'Mutfak', enabled: true, connection: { type: 'network', host: '192.168.1.50', port: 9100 }, width: 58, charset: 'ascii', orders: true, categories: [], bill: true, createdAt: '2026-10-01T00:00:00Z' };
function business(): State { return seed(); }

test('the flag is kept only when ticked, only on table orders, and refused when it is not a yes/no', () => {
  const s = business();
  const packed = submitOrder(s, guest, { requestId: randomUUID(), tableId: 'table-1', ...tea(), packed: true }, at('2026-10-03T09:00:00Z'));
  const plain = submitOrder(s, waiter, { requestId: randomUUID(), tableId: 'table-2', ...tea(), packed: false }, at('2026-10-03T09:00:00Z'));
  const staff = submitOrder(s, waiter, { requestId: randomUUID(), tableId: 'table-3', ...tea(), packed: true }, at('2026-10-03T09:00:00Z'));
  const order = (id: string) => s.orders.find(o => o.id === id)!;
  assert.equal(order(packed.orderId).packed, true); assert.equal(order(staff.orderId).packed, true);
  assert.equal('packed' in order(plain.orderId), false, 'not ticked: no field at all');
  assert.equal(order(packed.orderId).total, 3500, 'packing changes no price');
  const before = structuredClone(s);
  assert.equal(code(() => submitOrder(s, guest, { requestId: randomUUID(), tableId: 'table-1', ...tea(), packed: 'yes' as unknown as boolean }, at('2026-10-03T09:00:00Z'))), 'INVALID_VALUE');
  assert.deepEqual(s, before);
  // A takeaway ticket is always to go: the flag would only repeat it, so it is never stored there.
  const ticket = submitTakeaway(s, waiter, { requestId: randomUUID(), ...tea() }, at('2026-10-03T09:01:00Z'));
  submitOrder(s, waiter, { requestId: randomUUID(), tableId: ticket.tableId, ...tea(), packed: true }, at('2026-10-03T09:02:00Z'));
  assert.ok(s.orders.filter(o => o.accountId === ticket.accountId).every(o => !('packed' in o)));
});

test('the request fingerprint includes the flag: a replay answers, a changed choice under the same id is a conflict', () => {
  const s = business(), requestId = randomUUID();
  const first = submitOrder(s, guest, { requestId, tableId: 'table-1', ...tea(), packed: true }, at('2026-10-03T09:00:00Z'));
  assert.deepEqual(submitOrder(s, guest, { requestId, tableId: 'table-1', ...tea(), packed: true }, at('2026-10-03T09:00:05Z')), first);
  assert.equal(code(() => submitOrder(s, guest, { requestId, tableId: 'table-1', ...tea() }, at('2026-10-03T09:00:06Z'))), 'REQUEST_CONFLICT');
  // Not ticked sends no field, so an order saved before this feature replays with its old fingerprint.
  const other = randomUUID(), plain = submitOrder(s, guest, { requestId: other, tableId: 'table-1', ...tea() }, at('2026-10-03T09:01:00Z'));
  assert.deepEqual(submitOrder(s, guest, { requestId: other, tableId: 'table-1', ...tea() }, at('2026-10-03T09:01:05Z')), plain);
  assert.equal(s.orders.length, 2);
});

test('the guest may switch it inside the edit window; an edit without the field keeps it', () => {
  const s = business();
  const placed = submitOrder(s, guest, { requestId: randomUUID(), tableId: 'table-1', ...tea() }, at('2026-10-03T09:00:00Z'));
  const o = s.orders.find(x => x.id === placed.orderId)!, line = o.lines[0];
  const edit = (packed: boolean | undefined, quantity = 1) => editOrder(s, guest, { requestId: randomUUID(), orderId: o.id, version: o.version, expectedTotal: 3500 * quantity, ...(packed === undefined ? {} : { packed }), lines: [{ productId: 'tea', quantity, selections: [], existingId: line.id }] }, at('2026-10-03T09:00:20Z'));
  edit(true); assert.equal(o.packed, true); assert.ok(o.updatedAt, 'the kitchen sees it as a change');
  edit(undefined, 2); assert.equal(o.packed, true, 'an older pending edit without the field keeps the choice');
  edit(false, 2); assert.equal('packed' in o, false);
  assert.equal(code(() => editOrder(s, guest, { requestId: randomUUID(), orderId: o.id, version: o.version, expectedTotal: 7000, packed: 1 as unknown as boolean, lines: [{ productId: 'tea', quantity: 2, selections: [], existingId: line.id }] }, at('2026-10-03T09:00:30Z'))), 'INVALID_VALUE');
  assert.equal(code(() => edit(true, 2)), 'NO_ERROR');
  assert.equal(code(() => editOrder(s, guest, { requestId: randomUUID(), orderId: o.id, version: o.version, expectedTotal: 7000, packed: false, lines: [{ productId: 'tea', quantity: 2, selections: [], existingId: line.id }] }, at('2026-10-03T09:02:00Z'))), 'EDIT_WINDOW_CLOSED');
  assert.equal(o.packed, true, 'after the window the choice stays');
});

test('kitchen tickets print a bold PAKETLENECEK line; bills and receipts stay as they were', () => {
  const s = business(); s.changeSeconds = 0;
  const placed = submitOrder(s, guest, { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 2, selections: [], note: 'Açık demli' }], expectedTotal: 7000, packed: true }, at('2026-10-03T09:00:00Z'));
  const o = s.orders.find(x => x.id === placed.orderId)!, ticket = kitchenTicket(s, o, printer, o.lines);
  const line = ticket.find(op => 'text' in op && /PAKETLENECEK/.test(op.text));
  assert.ok(line && 'bold' in line && line.bold, 'bold line');
  const text = renderText(ticket, printer).join('\n');
  assert.match(text, /Masa 01/); assert.match(text, /\*\*\* PAKETLENECEK \*\*\*/); assert.ok(text.indexOf('PAKETLENECEK') < text.indexOf('2 x Demleme Çay'), 'above the items');
  const plain = submitOrder(s, guest, { requestId: randomUUID(), tableId: 'table-1', ...tea() }, at('2026-10-03T09:01:00Z'));
  assert.doesNotMatch(renderText(kitchenTicket(s, s.orders.find(x => x.id === plain.orderId)!, printer, s.orders[1].lines), printer).join('\n'), /PAKET/);
  assert.doesNotMatch(renderText(billTicket(s, placed.accountId, new Date('2026-10-03T09:05:00Z')), printer).join('\n'), /PAKET/i);
});

test('pending orders and edits keep the choice exactly, and refuse anything else', () => {
  const storage = (value: unknown) => ({ getItem: () => JSON.stringify(value), setItem() {}, removeItem() {} });
  const order: PendingOrder = { version: 1, body: { requestId: 'pending-packed-1', tableId: 'table-1', guestContext: 'a'.repeat(64), expectedTotal: 3500, lines: [{ productId: 'tea', quantity: 1, selections: [] }], packed: true }, labels: [{ name: 'Çay', options: '', total: 3500 }] };
  assert.deepEqual(readPendingOrder(storage(order), 'k'), order);
  for (const packed of [false, 'true', 1]) assert.equal(readPendingOrder(storage({ ...order, body: { ...order.body, packed } }), 'k'), null, String(packed));
  const edit: PendingEdit = { format: 1, number: 4, body: { requestId: 'pending-edit-1', guestContext: 'b'.repeat(64), orderId: 'o1', version: 1, expectedTotal: 3500, packed: false, lines: [{ productId: 'tea', quantity: 1, selections: [], existingId: 'l1' }] }, labels: [{ name: 'Çay', quantity: 1, total: 3500 }] };
  assert.deepEqual(readPendingEdit(storage(edit), 'k'), edit);
  const { packed: _, ...older } = edit.body; assert.deepEqual(readPendingEdit(storage({ ...edit, body: older }), 'k')?.body, older);
  assert.equal(readPendingEdit(storage({ ...edit, body: { ...edit.body, packed: 'no' } }), 'k'), null);
});

test('note examples fit the product: tea, coffee, cold drinks, desserts, food and weighed sweets', () => {
  const p = (art: Product['art'], category: string, extra: Partial<Product> = {}) => ({ art, category, ...extra });
  assert.equal(notePlaceholder(p('tea', 'Çaylar')), 'Örn. açık demli, limonlu');
  assert.equal(notePlaceholder(p('coffee', 'Kahveler')), 'Örn. az sütlü, ekstra sıcak');
  assert.equal(notePlaceholder(p('coffee', 'Soğuk Kahveler')), 'Örn. buzsuz, az şekerli', 'iced coffee is a cold drink');
  assert.equal(notePlaceholder(p('cold', 'İçecekler')), 'Örn. buzsuz, az şekerli');
  assert.equal(notePlaceholder(p('cake', 'Tatlılar')), 'Örn. ayrı tabakta, dondurmasız');
  assert.equal(notePlaceholder(p('soup', 'Çorbalar')), 'Örn. limonlu, acısız');
  assert.equal(notePlaceholder(p('cake', 'Dondurmalar')), 'Örn. külahta, ekstra sos', 'ice cream is never told "no ice cream"');
  assert.equal(notePlaceholder(p('burger', 'Burgerler')), 'Örn. soğansız, az pişmiş');
  assert.equal(notePlaceholder(p('coffee', 'Tatlilar')), 'Örn. ayrı tabakta, dondurmasız', 'the owner\'s category words win, typed without Turkish letters too');
  assert.equal(notePlaceholder(p('sweet', 'Baklava', { unit: 'kg' })), 'Örn. hediye paketi olsun');
  assert.equal(notePlaceholder(p('x' as Product['art'], 'Diğer')), 'Örn. özel isteğiniz');
  assert.equal(notePlaceholder(p('tea', 'Çaylar'), true), 'e.g. Light brew, with lemon');
  assert.equal(notePlaceholder(p('food', 'Ana Yemekler'), true), 'e.g. No onions, rare');
  assert.notEqual(notePlaceholder(seed().products.find(x => x.id === 'tea')!), notePlaceholder(seed().products.find(x => x.id === 'latte')!));
});

test('HTTP: guests and staff send it, every order list and long-term history keep it', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/packed-')), store = new Store(directory, ['mola-demo']);
  let time = Date.parse('2026-10-03T09:00:00Z'); store.clock = () => new Date(time);
  licensed(store); const server = createServer(createApp(store, () => new Date(time))); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const client = () => { const jar = new Map<string, string>(); let session = ''; return async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'X-Guest-Session': session }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const value of r.headers.getSetCookie()) { const [k, v] = value.split(';')[0].split('='); jar.set(k, v); }
    const data = await r.json() as any; if (data.session) session = data.session; return { status: r.status, data };
  }; };
  const own = client(), cook = client(), visitor = client();
  for (const [call, username] of [[own, 'isletme'], [cook, 'mutfak']] as const) assert.equal((await call('/login', { username, password: DEMO_PASSWORD })).status, 200);
  assert.equal((await own('/staff/settings', { changeSeconds: 30, commissionBps: null })).status, 200);
  const table = store.read('mola-demo').tables[0];
  assert.equal((await visitor('/guest/session', { token: table.token })).status, 200);
  assert.equal((await visitor('/guest/orders', { requestId: randomUUID(), tableId: table.id, ...tea(), packed: 'evet' })).status, 400, 'not a yes/no');
  const placed = await visitor('/guest/orders', { requestId: randomUUID(), tableId: table.id, ...tea(2), packed: true });
  assert.equal(placed.status, 200, JSON.stringify(placed.data));
  const mine = (await visitor('/guest/state')).data.orders[0];
  assert.equal(mine.packed, true, 'the guest sees "Paketlenecek" on the own order');
  // Switched off and on again inside the edit window.
  for (const packed of [false, true]) {
    const o = (await visitor('/guest/state')).data.orders[0];
    const edited = await visitor('/guest/orders/edit', { requestId: randomUUID(), orderId: o.id, version: o.version, expectedTotal: 7000, packed, lines: [{ productId: 'tea', quantity: 2, selections: [], existingId: o.lines[0].id }] });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    assert.equal((await cook('/staff/state')).data.orders[0].packed ?? false, packed);
  }
  // Staff for another table; the masasız route never takes the flag.
  assert.equal((await own('/staff/orders', { requestId: randomUUID(), tableId: 'table-2', ...tea(), packed: true })).status, 200);
  const bag = await own('/staff/takeaway/orders', { requestId: randomUUID(), ...tea(), packed: true });
  assert.equal(bag.status, 200); assert.equal(bag.data.tableName, 'Masasız #1');
  const cards = (await cook('/staff/state')).data.orders;
  assert.deepEqual(cards.map((o: any) => [o.tableName, !!o.packed]), [['Masa 01', true], ['Masa 02', true], ['Masasız #1', false]]);
  // Through the kitchen, paid, and six hours later into long-term history: the archived order still says so.
  time += 40_000;
  for (const status of ['preparing', 'ready', 'served'] as const) { const o = (await cook('/staff/state')).data.orders.find((x: any) => x.id === placed.data.orderId); assert.equal((await cook('/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status })).status, 200); }
  let state = (await own('/staff/state')).data;
  const account = state.tables[0].account;
  assert.equal((await own('/staff/payments', { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'cash', amount: 7000, tendered: 7000, paymentContext: state.paymentContext })).data.closed, true);
  time += 6.5 * 3600_000;
  assert.equal((await own('/staff/orders', { requestId: randomUUID(), tableId: 'table-3', ...tea() })).status, 200);
  const archived = store.history.archives('mola-demo', -Infinity, Infinity);
  const kept = archived.flatMap(a => a.orders).find(o => o.id === placed.data.orderId);
  assert.equal(kept?.packed, true);
  state = (await own('/staff/state')).data;
  assert.equal(state.orders.some((o: any) => o.id === placed.data.orderId), false, 'left the snapshot');
});

test('tickets opened before the rename keep their stored "Paket #n" name; new ones read "Masasız #n"', () => {
  const s = business(); s.changeSeconds = 0;
  const old = submitTakeaway(s, waiter, { requestId: randomUUID(), ...tea() }, at('2026-10-03T09:00:00Z'));
  s.tables.find(x => x.id === old.tableId)!.name = 'Paket #1';
  const next = submitTakeaway(s, waiter, { requestId: randomUUID(), ...tea() }, at('2026-10-03T09:01:00Z'));
  assert.equal(next.tableName, 'Masasız #2');
  const o = s.orders.find(x => x.id === old.orderId)!;
  setStatus(s, kitchen, o.id, o.version, 'preparing', new Date('2026-10-03T09:02:00Z')); setStatus(s, kitchen, o.id, o.version, 'ready', new Date('2026-10-03T09:03:00Z'));
  const account = s.accounts.find(a => a.id === old.accountId)!;
  recordPayment(s, owner, { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'cash', amount: 3500, tendered: 3500 }, at('2026-10-03T09:04:00Z'));
  assert.equal(s.archives[0].tableName, 'Paket #1', 'history shows the name it had');
  assert.match(renderText(kitchenTicket(s, s.orders.find(x => x.id === next.orderId)!, printer, s.orders[1].lines), printer).join('\n'), /MASASIZ #2/);
});
