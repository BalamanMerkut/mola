import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { seed } from '../server/seed.js';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { PrintService } from '../server/printing.js';
import { balances, cancelByStaff, cancelLimits, quote, recordPayment, submitOrder } from '../packages/domain/engine.js';
import { saleProducts } from '../packages/domain/campaigns.js';
import { staffOrders } from '../server/staff-orders.js';
import { reviewOrder, setAutomaticApproval } from '../packages/domain/approvals.js';
import { mergeTotals, stateRecords, summarize } from '../packages/domain/history.js';
import { cancelTicket, renderText, type PrinterConfig } from '../packages/domain/printing.js';
import type { Actor, State } from '../packages/domain/types.js';
import { client, licensed, temp } from './merkez-fixture.js';

const at = (seconds: number) => new Date(Date.parse('2026-10-02T09:00:00Z') + seconds * 1000);
const ctx = (seconds = 0) => ({ now: at(seconds), id: randomUUID });
const who = (role: Actor['role'], id: string = role): Actor => ({ tenantId: 'mola-demo', id, role });
const waiter = who('waiter'), kitchen = who('kitchen'), cashier = who('cashier'), owner = who('owner');
const tea = (quantity: number) => ({ productId: 'tea', quantity, selections: [] });
const lemonade = (quantity: number) => ({ productId: 'lemonade', quantity, selections: [] });
function order(s: State, lines = [tea(3), lemonade(1)], table = 'table-1') {
  const total = lines.reduce((n, l) => n + (l.productId === 'tea' ? 3500 : 12000) * l.quantity, 0);
  return submitOrder(s, waiter, { requestId: randomUUID(), tableId: table, lines, expectedTotal: total }, ctx());
}
const cancel = (s: State, actor: Actor, orderId: string, extra: { reason?: string; lines?: { lineId: string; quantity: number }[] } = {}) => {
  const o = s.orders.find(o => o.id === orderId)!;
  return cancelByStaff(s, actor, { requestId: randomUUID(), orderId, version: o.version, reason: extra.reason ?? 'Müşteri vazgeçti', ...(extra.lines ? { lines: extra.lines } : {}) }, ctx(5));
};

test('waiter, kitchen and owner cancel with a reason; the cashier never; part of a line keeps the rest on the bill', () => {
  const s = seed(); const { orderId, accountId } = order(s); const o = s.orders[0], [teaLine, lemonLine] = o.lines;
  assert.throws(() => cancel(s, cashier, orderId), { code: 'FORBIDDEN' });
  assert.throws(() => cancel(s, waiter, orderId, { reason: '  ' }), { code: 'REASON_REQUIRED' });
  assert.throws(() => cancel(s, waiter, orderId, { reason: 'x'.repeat(121) }), { code: 'REASON_REQUIRED' });
  assert.throws(() => cancel(s, waiter, orderId, { lines: [{ lineId: teaLine.id, quantity: 4 }] }), { code: 'INVALID_VALUE' });
  assert.throws(() => cancel(s, waiter, orderId, { lines: [{ lineId: 'missing', quantity: 1 }] }), { code: 'INVALID_SELECTION' });
  // Two of three teas go; the order goes on with one tea and the lemonade.
  assert.deepEqual(cancel(s, waiter, orderId, { reason: 'Yanlış sipariş', lines: [{ lineId: teaLine.id, quantity: 2 }] }), { cancelled: 'items', total: 15500, closed: false });
  assert.equal(o.status, 'new'); assert.equal(o.lines[0].quantity, 1); assert.equal(o.total, 15500);
  assert.equal(balances(s, accountId).total, 15500);
  assert.equal(o.cancellations?.length, 1); assert.equal(o.cancellations![0].reason, 'Yanlış sipariş'); assert.equal(o.cancellations![0].lines[0].quantity, 2); assert.equal(o.cancellations![0].lines[0].total, 7000);
  assert.equal(o.cancellations![0].printTo, undefined, 'not printed yet, so no İPTAL slip is owed');
  assert.ok(s.audit.some(a => a.action === 'order.items_cancelled' && a.actor === 'waiter'));
  // The kitchen takes the lemonade off (Ürün bitti); the owner, as supervisor, cancels what is left.
  cancel(s, kitchen, orderId, { reason: 'Ürün bitti', lines: [{ lineId: lemonLine.id, quantity: 1 }] });
  assert.deepEqual(o.lines.map(l => l.productId), ['tea']);
  assert.deepEqual(cancel(s, owner, orderId, { reason: 'Müşteri vazgeçti' }), { cancelled: 'order', total: 0, closed: false });
  assert.equal(o.status, 'cancelled'); assert.equal(o.cancelReason, 'Müşteri vazgeçti'); assert.equal(o.cancelledBy, 'owner');
  assert.throws(() => cancel(s, waiter, orderId), { code: 'INVALID_TRANSITION' });
  assert.equal(balances(s, accountId).total, 0);
  // Reports: no sale left, every cancelled lira counted once, the order counted once.
  const t = mergeTotals(summarize(stateRecords(s), at(-3600).getTime(), at(3600).getTime()).values());
  assert.equal(t.orderAmount, 0); assert.equal(t.orders, 0); assert.equal(t.cancelled, 1); assert.equal(t.cancelledAmount, 3 * 3500 + 12000);
});

test('10 Ekim: the kitchen cancels the moment the counter closes the bill: staff are told to refund, not the guest\'s "QR kodunu yeniden açın"', () => {
  const s = seed(); const { orderId, accountId } = order(s, [lemonade(1)]); const a = s.accounts[0];
  recordPayment(s, cashier, { requestId: randomUUID(), accountId, version: a.version, method: 'cash', amount: 12000, tendered: 12000 }, ctx(1));
  assert.equal(s.accounts.find(x => x.id === accountId)!.status, 'closed');
  assert.throws(() => cancel(s, kitchen, orderId, { reason: 'Ürün bitti' }), (e: { code: string; message: string }) => e.code === 'ACCOUNT_CLOSED' && /kasada “İade”/.test(e.message) && !/QR/.test(e.message));
  assert.equal(s.orders[0].status, 'new', 'the paid order stays as it was');
});

test('paid items cannot be cancelled silently; what is left closes the bill when it is all paid', () => {
  const s = seed(); const { orderId, accountId } = order(s); const o = s.orders[0], [teaLine, lemonLine] = o.lines, a = s.accounts[0];
  recordPayment(s, cashier, { requestId: randomUUID(), accountId, version: a.version, method: 'cash', amount: 7000, tendered: 7000, selections: [{ orderId, lineId: teaLine.id, quantity: 2 }] }, ctx(1));
  assert.throws(() => cancel(s, waiter, orderId), { code: 'PAID_ITEMS' }, 'the whole order has paid items');
  assert.throws(() => cancel(s, waiter, orderId, { lines: [{ lineId: teaLine.id, quantity: 2 }] }), { code: 'PAID_ITEMS' });
  assert.throws(() => cancel(s, waiter, orderId, { lines: [{ lineId: teaLine.id, quantity: 3 }] }), { code: 'PAID_ITEMS' });
  // The unpaid tea and the lemonade go: the rest is paid, so the bill closes like after a last payment.
  const r = cancel(s, waiter, orderId, { lines: [{ lineId: teaLine.id, quantity: 1 }, { lineId: lemonLine.id, quantity: 1 }] });
  assert.equal(r.closed, true); assert.equal(a.status, 'closed'); assert.equal(s.archives.length, 1); assert.equal(s.archives[0].total, 7000);
  // An amount payment (no items chosen) covers the bill as a sum: cancelling below it is refused too.
  const second = order(s, [tea(2)], 'table-2'), b = s.accounts.find(x => x.id === second.accountId)!;
  recordPayment(s, cashier, { requestId: randomUUID(), accountId: b.id, version: b.version, method: 'card', amount: 5000, tendered: 5000 }, ctx(2));
  assert.throws(() => cancel(s, waiter, second.orderId, { lines: [{ lineId: s.orders.at(-1)!.lines[0].id, quantity: 1 }] }), { code: 'PAID_ITEMS' });
});

test('a campaign-priced line tied to a paid one is capped in the window; a refused line never drops the other chosen lines', () => {
  const s = seed();
  s.campaigns = [{ id: 'two-tea', reportId: 'two-tea-v1', name: 'İki çay', productIds: ['tea'], minQuantity: 2, kind: 'fixed', amount: 2000, startsAt: '2026-09-01T00:00:00Z', endsAt: null, enabled: true, combine: false }];
  const lines = [tea(1), tea(1), lemonade(1)], expectedTotal = quote(saleProducts(s, at(0)), lines, ctx()).reduce((n, l) => n + l.total, 0);
  const { orderId, accountId } = submitOrder(s, waiter, { requestId: randomUUID(), tableId: 'table-1', lines, expectedTotal }, ctx());
  const o = s.orders[0], [paidTea, secondTea, lemon] = o.lines, a = s.accounts.find(x => x.id === accountId)!;
  assert.equal(paidTea.unitPrice, 1500, 'two teas: campaign price');
  recordPayment(s, cashier, { requestId: randomUUID(), accountId, version: a.version, method: 'cash', amount: 1500, tendered: 1500, selections: [{ orderId, lineId: paidTea.id, quantity: 1 }] }, ctx(1));
  // The window knows before anyone taps: the second tea cannot go (the paid tea would cost 3500 alone), the lemonade can.
  const limits = cancelLimits(s, o)!;
  assert.deepEqual(Object.keys(limits), [secondTea.id]);
  assert.equal(limits[secondTea.id].max, 0); assert.match(limits[secondTea.id].reason, /kampanya fiyatı ödenen ürüne bağlı; önce iadeyi işletme sahibi yapmalı/);
  // The staff screens get the same limits with the order (server/staff-orders.ts).
  assert.deepEqual(staffOrders(s, 'waiter', at(2).getTime()).orders.find(x => x.id === orderId)!.cancelLimits, limits);
  assert.equal(staffOrders(s, 'kitchen', at(2).getTime()).orders.find(x => x.id === orderId)!.cancelLimits![secondTea.id].max, 0);
  // Alone, the second tea is refused with the plain reason …
  assert.throws(() => cancel(s, waiter, orderId, { lines: [{ lineId: secondTea.id, quantity: 1 }] }), (e: Error & { code?: string }) => e.code === 'PAID_ITEMS' && /kampanya fiyatı/.test(e.message));
  // … and together with the lemonade, the lemonade still goes and the tea is reported back.
  const r = cancel(s, waiter, orderId, { lines: [{ lineId: secondTea.id, quantity: 1 }, { lineId: lemon.id, quantity: 1 }] }) as { cancelled: string; refused?: { lineId: string; name: string; reason: string }[] };
  assert.equal(r.cancelled, 'items');
  assert.deepEqual(r.refused?.map(x => [x.lineId, x.name]), [[secondTea.id, secondTea.name]]);
  assert.deepEqual(o.lines.map(l => l.id), [paidTea.id, secondTea.id]);
  assert.equal(o.cancellations?.[0].lines.map(l => l.productId).join(), 'lemonade');
  assert.equal(balances(s, accountId).total, 3000);
});

test('QR orders are approved by waiter, kitchen and owner; cashier only sees; staff cancel never bypasses approval', () => {
  const s = seed(); s.waiterApproval = true;
  const guest: Actor = { tenantId: 'mola-demo', id: 'g', role: 'guest', tableId: 'table-1', epoch: 0 };
  const qr = () => submitOrder(s, guest, { requestId: randomUUID(), tableId: 'table-1', lines: [tea(1)], expectedTotal: 3500 }, ctx()).orderId;
  const review = (actor: Actor, id: string, approve = true) => reviewOrder(s, actor, { requestId: randomUUID(), orderId: id, version: s.orders.find(o => o.id === id)!.version, approve, reason: approve ? undefined : 'Masa boş.' }, ctx());
  const first = qr(), second = qr(), third = qr();
  assert.throws(() => review(cashier, first), { code: 'FORBIDDEN' });
  assert.throws(() => cancel(s, waiter, first), { code: 'APPROVAL_PENDING' });
  review(kitchen, first); review(owner, second); review(waiter, third, false);
  assert.deepEqual(s.orders.map(o => o.status), ['new', 'new', 'cancelled']);
  // "Otomatik onay" for the whole business: waiter and owner (and the Müdür), never the kitchen or the cashier.
  assert.throws(() => setAutomaticApproval(s, kitchen, { requestId: randomUUID(), version: 0, enabled: true }, ctx()), { code: 'FORBIDDEN' });
  setAutomaticApproval(s, waiter, { requestId: randomUUID(), version: 0, enabled: true }, ctx());
  assert.throws(() => setAutomaticApproval(s, cashier, { requestId: randomUUID(), version: 1, enabled: false }, ctx()), { code: 'FORBIDDEN' });
});

test('printed orders get an İPTAL slip with the reason: only the cancelled items, or the whole order', async () => {
  const store = new Store(temp('staff-cancel-print'), ['mola-demo']);
  try {
    let clock = 0; const sent: string[] = [];
    const service = new PrintService(store, () => at(clock), async (_c, data) => { sent.push(Buffer.from(data).toString('latin1')); });
    const p: PrinterConfig = { id: randomUUID(), name: 'Mutfak', enabled: true, connection: { type: 'network', host: '192.168.1.50', port: 9100 }, width: 58, charset: 'ascii', orders: true, categories: [], bill: false, createdAt: at(-60).toISOString() };
    let id = '';
    store.mutate('mola-demo', s => { s.printers = [p]; s.changeSeconds = 0; id = order(s).orderId; });
    service.refresh('mola-demo');
    clock = 1; await service.tick(); assert.equal(sent.length, 1, 'the order printed');
    store.mutate('mola-demo', s => { const o = s.orders[0]; cancel(s, waiter, id, { reason: 'Ürün bitti', lines: [{ lineId: o.lines[1].id, quantity: 1 }] }); });
    assert.deepEqual(store.read('mola-demo').orders[0].cancellations![0].printTo, [p.id]);
    clock = 2; await service.tick(); assert.equal(sent.length, 2);
    assert.match(sent[1], /IPTAL/); assert.match(sent[1], /Neden: Urun bitti/); assert.match(sent[1], /Limonata/); assert.doesNotMatch(sent[1], /Demleme/, 'only the cancelled item');
    assert.equal(store.read('mola-demo').orders[0].cancellations![0].printTo, undefined);
    await service.tick(); assert.equal(sent.length, 2, 'once');
    store.mutate('mola-demo', s => cancel(s, kitchen, id, { reason: 'Müşteri vazgeçti' }));
    clock = 3; await service.tick(); assert.equal(sent.length, 3); assert.match(sent[2], /hazirlanmayacak/); assert.match(sent[2], /Neden: Musteri vazgecti/); assert.match(sent[2], /3 x Demleme/);
    const s = store.read('mola-demo');
    assert.match(renderText(cancelTicket(s, s.orders[0], p, s.orders[0].lines), p).join('\n'), /Neden: Müşteri vazgeçti/);
  } finally { store.close(); }
});

test('HTTP: cancel route roles and reason, kitchen sees and approves QR orders, owner cannot skip the reason', async t => {
  const store = new Store(temp('staff-cancel-api'));
  licensed(store); const server = createServer(createApp(store));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const [w, k, c, o] = [client(base), client(base), client(base), client(base)];
  for (const [call, username] of [[w, 'garson'], [k, 'mutfak'], [c, 'kasiyer'], [o, 'isletme']] as const) assert.equal((await call('/login', { username, password: DEMO_PASSWORD })).status, 200);
  store.mutate('mola-demo', s => { s.setupCompleted = true; s.waiterApproval = true; });
  const sent = await w('/staff/orders', { requestId: randomUUID(), tableId: 'table-1', lines: [tea(2)], expectedTotal: 7000 });
  assert.equal(sent.status, 200);
  const version = () => store.read('mola-demo').orders.find(x => x.id === sent.data.orderId)!.version;
  const body = (extra = {}) => ({ requestId: randomUUID(), orderId: sent.data.orderId, version: version(), reason: 'Yanlış sipariş', ...extra });
  assert.equal((await c('/staff/orders/cancel', body())).status, 403, 'cashier');
  assert.equal((await w('/staff/orders/cancel', body({ reason: '' }))).data.code, 'REASON_REQUIRED');
  assert.equal((await o('/staff/cancel', { requestId: randomUUID(), orderId: sent.data.orderId, version: version() })).data.code, 'REASON_REQUIRED', 'no reasonless owner cancel');
  const line = store.read('mola-demo').orders[0].lines[0].id;
  const part = await k('/staff/orders/cancel', body({ lines: [{ lineId: line, quantity: 1 }] }));
  assert.equal(part.status, 200); assert.equal(part.data.cancelled, 'items');
  // The kitchen card shows the cancelled item without its price.
  const kitchenView = (await k('/staff/state')).data;
  const card = kitchenView.orders.find((x: { id: string }) => x.id === sent.data.orderId);
  assert.equal(card.cancellations[0].lines[0].total, 0); assert.equal(card.cancellations[0].reason, 'Yanlış sipariş');
  // A QR order waiting for approval reaches the kitchen screen; the kitchen approves it.
  const guest = client(base), table = store.read('mola-demo').tables[1];
  assert.equal((await guest('/guest/session', { token: table.token })).status, 200);
  const qr = await guest('/guest/orders', { requestId: randomUUID(), tableId: table.id, lines: [tea(1)], expectedTotal: 3500 });
  assert.equal(qr.status, 200);
  const waiting = (await k('/staff/state')).data.orders.find((x: { id: string }) => x.id === qr.data.orderId);
  assert.equal(waiting.status, 'awaiting_approval');
  assert.equal((await c('/staff/orders/review', { requestId: randomUUID(), orderId: qr.data.orderId, version: waiting.version, approve: true })).status, 403, 'cashier sees only');
  assert.equal((await k('/staff/orders/review', { requestId: randomUUID(), orderId: qr.data.orderId, version: waiting.version, approve: true })).status, 200);
  assert.equal(store.read('mola-demo').orders.find(x => x.id === qr.data.orderId)!.status, 'new');
  // The guest sees the staff's reason, never who did it.
  await w('/staff/orders/cancel', { requestId: randomUUID(), orderId: qr.data.orderId, version: store.read('mola-demo').orders.find(x => x.id === qr.data.orderId)!.version, reason: 'Ürün bitti' });
  const mine = (await guest('/guest/state')).data.orders[0];
  assert.equal(mine.status, 'cancelled'); assert.equal(mine.cancelReason, 'Ürün bitti'); assert.equal('cancelledBy' in mine, false);
});
