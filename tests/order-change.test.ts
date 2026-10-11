import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { seed } from '../server/seed.js';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { PrintService } from '../server/printing.js';
import { staffOrders } from '../server/staff-orders.js';
import { balances, changeByStaff, recordPayment, setStatus, submitOrder } from '../packages/domain/engine.js';
import { changeableLines, changeBlock } from '../packages/domain/order-change.js';
import { changeTicket, renderText, type PrinterConfig } from '../packages/domain/printing.js';
import type { Actor, CartLine, State } from '../packages/domain/types.js';
import { client, licensed, temp } from './merkez-fixture.js';

/*
 * Hafta sonu bulgusu 5 (11 Ekim): the waiter changes a line of an order (Kola → Ayran, adet, seçenek, not) while the kitchen
 * has not started it (packages/domain/order-change.ts, engine.ts changeByStaff).
 */
const T = 'mola-demo';
const at = (seconds: number) => new Date(Date.parse('2026-10-11T18:00:00Z') + seconds * 1000);
const ctx = (seconds = 0) => ({ now: at(seconds), id: randomUUID });
const who = (role: Actor['role'], id: string = role): Actor => ({ tenantId: T, id, role });
const waiter = who('waiter'), cashier = who('cashier'), kitchen = who('kitchen'), owner = who('owner');
const tea = (quantity = 1): CartLine => ({ productId: 'tea', quantity, selections: [] });
const lemonade = (quantity = 1): CartLine => ({ productId: 'lemonade', quantity, selections: [] });
function order(s: State) {
  const r = submitOrder(s, waiter, { requestId: randomUUID(), tableId: 'table-1', lines: [tea(2), lemonade(1)], expectedTotal: 2 * 3500 + 12000 }, ctx());
  return s.orders.find(o => o.id === r.orderId)!;
}
const change = (s: State, actor: Actor, orderId: string, lineId: string, line: CartLine, expectedTotal: number) => {
  const o = s.orders.find(x => x.id === orderId)!;
  return changeByStaff(s, actor, { requestId: randomUUID(), orderId, version: o.version, lineId, line, expectedTotal }, ctx(30));
};

test('the waiter changes tea → lemonade before the kitchen starts: new price, the bill follows, the change is kept and audited', () => {
  const s = seed(), o = order(s), [teaLine] = o.lines;
  assert.throws(() => change(s, cashier, o.id, teaLine.id, lemonade(2), 36000), { code: 'FORBIDDEN' });
  assert.throws(() => change(s, kitchen, o.id, teaLine.id, lemonade(2), 36000), { code: 'FORBIDDEN' });
  assert.throws(() => change(s, waiter, o.id, teaLine.id, tea(2), 19000), { code: 'NO_CHANGE' });
  assert.throws(() => change(s, waiter, o.id, teaLine.id, lemonade(2), 19000), { code: 'PRICE_CHANGED' });
  const r = change(s, waiter, o.id, teaLine.id, lemonade(2), 36000);
  assert.equal(r.from, '2 x Çay'.replace('Çay', teaLine.name)); assert.match(r.to, /^2 x /); assert.equal(r.slip, false);
  assert.equal(o.total, 36000); assert.equal(balances(s, o.accountId).total, 36000);
  assert.deepEqual(o.lines.map(l => l.productId), ['lemonade', 'lemonade']);
  assert.equal(o.changes?.length, 1); assert.equal(o.changes![0].by, 'waiter'); assert.equal(o.changes![0].printTo, undefined, 'not printed yet: the ticket prints the new lines');
  assert.ok(s.audit.some(a => a.action === 'order.line_changed' && a.actor === 'waiter'));
  // Quantity and note on a kept product keep its saved price.
  const l = o.lines[1];
  s.products.find(p => p.id === 'lemonade')!.price = 99900;
  change(s, owner, o.id, l.id, { ...lemonade(3), note: 'Buzsuz' }, 2 * 12000 + 3 * 12000);
  assert.equal(o.lines[1].note, 'Buzsuz'); assert.equal(o.lines[1].unitPrice, 12000);
});

test('started, served, paid or asked to cancel: no change; the way that remains is said in one line', () => {
  const s = seed(), o = order(s), line = o.lines[0];
  setStatus(s, owner, o.id, o.version, 'preparing', at(10));
  assert.throws(() => change(s, waiter, o.id, line.id, tea(1), 3500 + 12000), (e: Error & { code?: string }) => e.code === 'CHANGE_CLOSED' && /İptal et/.test(e.message));
  // Fiş modu: "Hazırlanıyor" only means the slip came out, so a change is still possible (with a DEĞİŞİKLİK slip).
  s.kitchenMode = 'ticket'; o.printedTo = ['kitchen'];
  const r = change(s, waiter, o.id, line.id, tea(1), 3500 + 12000);
  assert.equal(r.slip, true); assert.deepEqual(o.changes![0].printTo, ['kitchen']);
  // Paid items: the refund path.
  const s2 = seed(), o2 = order(s2), a = s2.accounts[0];
  recordPayment(s2, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 3500, tendered: 3500, selections: [{ orderId: o2.id, lineId: o2.lines[0].id, quantity: 1 }] }, ctx(5));
  assert.throws(() => change(s2, waiter, o2.id, o2.lines[1].id, tea(1), 2 * 3500 + 3500), (e: Error & { code?: string }) => e.code === 'CHANGE_CLOSED' && /iade/.test(e.message));
  assert.equal(changeBlock({ status: 'ready', cancelRequested: false }, false)?.startsWith('Mutfak hazırlamaya başladı'), true);
  assert.equal(changeBlock({ status: 'served', cancelRequested: false }, true)?.startsWith('Teslim edildi'), true);
  assert.equal(changeBlock({ status: 'new', cancelRequested: true }, false)?.includes('iptal isteği'), true);
  assert.equal(changeBlock({ status: 'awaiting_approval', cancelRequested: false }, false), null);
  // A bill paid as an amount may not drop below the money taken.
  const s3 = seed(), o3 = order(s3), a3 = s3.accounts[0];
  recordPayment(s3, cashier, { requestId: randomUUID(), accountId: a3.id, version: a3.version, method: 'cash', amount: 18000, tendered: 18000 }, ctx(5));
  assert.throws(() => change(s3, waiter, o3.id, o3.lines[1].id, tea(1), 3 * 3500), { code: 'PAID_ITEMS' });
});

test('the kitchen reads "Değişti" on the card; a printed order gets a DEĞİŞİKLİK slip once; the guest never sees who changed it', async t => {
  const store = new Store(temp('order-change-api'));
  const sent: string[] = [], service = new PrintService(store, () => new Date(), async (_c, data) => { sent.push(Buffer.from(data).toString('latin1')); });
  licensed(store); const http = createServer(createApp(store, () => new Date(), () => true, undefined, undefined, undefined, service));
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  t.after(async () => { http.closeAllConnections(); await new Promise<void>(r => http.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api`;
  const [w, k, c] = [client(base), client(base), client(base)];
  for (const [call, username] of [[w, 'garson'], [k, 'mutfak'], [c, 'kasiyer']] as const) assert.equal((await call('/login', { username, password: DEMO_PASSWORD })).status, 200);
  const printer: PrinterConfig = { id: 'kitchen-printer', name: 'Mutfak', enabled: true, connection: { type: 'network', host: '192.168.1.50', port: 9100 }, width: 58, charset: 'ascii', orders: true, categories: [], bill: false, createdAt: new Date(Date.now() - 60_000).toISOString() };
  store.mutate(T, s => { s.setupCompleted = true; s.printers = [printer]; }); service.refresh(T);
  assert.equal((await w('/staff/orders', { requestId: randomUUID(), tableId: 'table-1', lines: [tea(1)], expectedTotal: 3500 })).status, 200);
  await service.tick(); assert.equal(sent.length, 1, 'the kitchen ticket printed');
  let o = (await w('/staff/state')).data.orders[0];
  const body = { requestId: randomUUID(), orderId: o.id, version: o.version, lineId: o.lines[0].id, line: lemonade(1), expectedTotal: 12000 };
  assert.equal((await c('/staff/orders/change', { ...body, requestId: randomUUID() })).status, 403);
  const r = await w('/staff/orders/change', body);
  assert.equal(r.status, 200); assert.equal(r.data.slip, true);
  assert.deepEqual((await w('/staff/orders/change', body)).data, r.data, 'a retry is applied once');
  await service.tick(); await service.tick();
  assert.equal(sent.length, 2); assert.match(sent[1], /DEGISIKLIK/); assert.match(sent[1], /ESKI: 1 x/); assert.match(sent[1], /YENI: 1 x/);
  assert.equal(store.read(T).orders[0].changes![0].printTo, undefined, 'printed once');
  const kitchenCard = (await k('/staff/state')).data.orders[0];
  assert.equal(kitchenCard.changes.length, 1); assert.equal(kitchenCard.changes[0].byName, store.read(T).staffUsers!.find(u => u.username === 'garson')!.name);
  assert.equal(kitchenCard.changes[0].printTo, undefined);
  // The guest's "Siparişlerim" carries no change record (who, printers).
  const s = store.read(T), table = s.tables[0];
  const guest = client(base); await guest('/guest/session', { token: table.token });
  const g = (await guest('/guest/state')).data;
  assert.ok(!JSON.stringify(g).includes('"changes"'));
  o = staffOrders(s, 'waiter', Date.now()).orders[0];
  assert.equal(o.total, 12000);
  assert.ok(store.auditLog(T).some(a => a.action === 'order.line_changed'));
  const ticket = renderText(changeTicket(s, s.orders[0], printer, s.orders[0].changes![0]), printer).join('\n');
  assert.match(ticket, /Siparişin son hali/);
});

test('Hazır ürün (sahibin kararı): a can/bottle is swapped any time until it is paid, without the kitchen; the counter sees the difference', () => {
  const s = seed();
  for (const id of ['tea', 'lemonade']) s.products.find(p => p.id === id)!.readyMade = true;
  const o = order(s);
  // Served long ago and printed: still swappable, no DEĞİŞİKLİK slip, the bill follows.
  o.status = 'served'; o.printedTo = ['kitchen'];
  const r = change(s, waiter, o.id, o.lines[0].id, lemonade(1), 12000 + 12000);
  assert.equal(r.ready, true); assert.equal(r.slip, false); assert.equal(r.delta, 24000 - 19000);
  assert.equal(o.changes![0].ready, true); assert.equal(o.changes![0].delta, 5000); assert.equal(o.changes![0].printTo, undefined);
  assert.equal(balances(s, o.accountId).total, 24000);
  assert.ok(s.audit.some(a => a.action === 'order.ready_item_changed' && a.target.endsWith(':5000')));
  // The kitchen never hears of it; the counter reads who, what and how much.
  assert.equal(staffOrders(s, 'kitchen', at(40).getTime()).orders.find(x => x.id === o.id)?.changes, undefined);
  assert.equal(staffOrders(s, 'cashier', at(40).getTime()).orders.find(x => x.id === o.id)!.changes![0].delta, 5000);
  // Only for another ready-made product once the kitchen started.
  s.products.find(p => p.id === 'latte')!.readyMade = false;
  assert.throws(() => change(s, waiter, o.id, o.lines[0].id, { productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'large' }, { groupId: 'milk', optionId: 'oat' }] }, 19500 + 12000), (e: Error & { code?: string }) => e.code === 'CHANGE_CLOSED' && /hazır ürün yalnız/.test(e.message));
  // Paid by item: no more swaps for that line.
  const a = s.accounts[0];
  recordPayment(s, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 12000, tendered: 12000, selections: [{ orderId: o.id, lineId: o.lines[0].id, quantity: 1 }] }, ctx(50));
  assert.throws(() => change(s, waiter, o.id, o.lines[0].id, tea(1), 3500 + 12000), (e: Error & { code?: string }) => e.code === 'CHANGE_CLOSED' && /ödemesi alındı/.test(e.message));
  // A prepared product keeps the earlier rule: once the kitchen started, no change.
  const s2 = seed(), o2 = order(s2);
  setStatus(s2, owner, o2.id, o2.version, 'preparing', at(10));
  assert.throws(() => change(s2, waiter, o2.id, o2.lines[1].id, tea(1), 2 * 3500 + 3500), { code: 'CHANGE_CLOSED' });
  assert.deepEqual(changeableLines(o2, s2.products, false), { lines: [], readyOnly: true });
  s2.products.find(p => p.id === 'tea')!.readyMade = true;
  assert.deepEqual(changeableLines(o2, s2.products, false).lines.map(l => l.productId), ['tea']);
});
