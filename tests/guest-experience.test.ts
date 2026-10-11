import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { Store } from '../server/store.js';
import { seed } from '../server/seed.js';
import { cancelOrder, declineCancellation, setStatus, submitOrder, submitTakeaway } from '../packages/domain/engine.js';
import { matchesSearch, restoreBasket, searchKey, unitPriceOf } from '../packages/domain/lines.js';
import { readyToPrint } from '../packages/domain/printing.js';
import type { Actor, Product, State } from '../packages/domain/types.js';
import { ApiError } from '../src/api.js';
import { guestMessage, startsInEnglish } from '../src/guestText.js';
import { cancelDefinitelyRejected } from '../src/pendingCancel.js';

// Guest (QR menu) fixes from the 2026-10 QA round: table move/merge, search, basket, change window, guest cancel.
const ctx = (seconds = 0) => ({ now: new Date(Date.parse('2026-10-05T10:00:00Z') + seconds * 1000), id: randomUUID });
const owner: Actor = { tenantId: 'mola-demo', id: 'owner', role: 'owner' };
const kitchen: Actor = { tenantId: 'mola-demo', id: 'kitchen', role: 'kitchen' };
const guest: Actor = { tenantId: 'mola-demo', id: 'guest1', role: 'guest', tableId: 'table-1', epoch: 0 };
const tea = (tableId = 'table-1') => ({ requestId: randomUUID(), tableId, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });

test('the change window is only for QR guest orders: staff, masasız and old staff orders start at once', () => {
  const s = seed();
  const staffOrder = submitOrder(s, owner, tea('table-2'), ctx());
  const staff = s.orders.find(o => o.id === staffOrder.orderId)!;
  assert.equal(staff.editableUntil, undefined, 'staff orders get no change window');
  setStatus(s, kitchen, staff.id, staff.version, 'preparing', ctx().now);
  assert.equal(staff.status, 'preparing');
  const ticket = submitTakeaway(s, { ...owner, role: 'cashier', id: 'cashier' }, { requestId: randomUUID(), lines: tea().lines, expectedTotal: 3500 }, ctx());
  const takeaway = s.orders.find(o => o.id === ticket.orderId)!;
  assert.equal(takeaway.editableUntil, undefined);
  setStatus(s, kitchen, takeaway.id, takeaway.version, 'preparing', ctx().now);
  // Saved before this fix: an open staff order still carrying a deadline is not held either (also not by the printer).
  const old = submitOrder(s, owner, tea('table-3'), ctx()), legacy = s.orders.find(o => o.id === old.orderId)!;
  legacy.editableUntil = ctx(60).now.toISOString();
  assert.equal(readyToPrint(s, legacy, ctx(1).now), true, 'the printer does not hold staff orders');
  setStatus(s, kitchen, legacy.id, legacy.version, 'preparing', ctx(1).now);
  assert.equal(legacy.status, 'preparing');
  // A guest order still waits for its 60 seconds.
  const qr = submitOrder(s, guest, tea(), ctx()), own = s.orders.find(o => o.id === qr.orderId)!;
  assert.equal(own.editableUntil, ctx(60).now.toISOString());
  assert.throws(() => setStatus(s, kitchen, own.id, own.version, 'preparing', ctx(30).now), (e: any) => e.code === 'CHANGE_WINDOW_OPEN');
});

test('guests cannot ask to cancel a ready or served order; stuck requests are cleared', () => {
  const s = seed(); s.changeSeconds = 0;
  const r = submitOrder(s, guest, tea(), ctx()), o = s.orders.find(o => o.id === r.orderId)!;
  setStatus(s, kitchen, o.id, o.version, 'preparing', ctx().now);
  setStatus(s, kitchen, o.id, o.version, 'ready', ctx().now);
  assert.throws(() => cancelOrder(s, guest, { requestId: randomUUID(), orderId: o.id, version: o.version }, ctx()), (e: any) => e.code === 'CANCEL_CLOSED' && e.status === 409 && /personel/i.test(e.message));
  assert.equal(o.cancelRequested, false);
  setStatus(s, owner, o.id, o.version, 'served', ctx().now);
  assert.throws(() => cancelOrder(s, guest, { requestId: randomUUID(), orderId: o.id, version: o.version }, ctx()), (e: any) => e.code === 'CANCEL_CLOSED');
  // A request saved before this fix on a served order is cleared the next time a cancel or status change is handled.
  o.cancelRequested = true; const version = o.version;
  const r2 = submitOrder(s, guest, tea(), ctx()), next = s.orders.find(o => o.id === r2.orderId)!;
  setStatus(s, kitchen, next.id, next.version, 'preparing', ctx().now);
  assert.equal(o.cancelRequested, false); assert.equal(o.version, version + 1);
  // While preparing the guest may still ask; the kitchen decides as before.
  const asked = cancelOrder(s, guest, { requestId: randomUUID(), orderId: next.id, version: next.version }, ctx());
  assert.deepEqual(asked, { requested: true });
  declineCancellation(s, kitchen, { requestId: randomUUID(), orderId: next.id, version: next.version, reason: 'Hazırlandı' }, ctx());
  // K-I (9 Ekim kullanıcı testi): the declined request is the café's answer; the guest cannot send another one.
  const declined = next.version;
  assert.throws(() => cancelOrder(s, guest, { requestId: randomUUID(), orderId: next.id, version: next.version }, ctx()), (e: any) => e.code === 'CANCEL_DECLINED' && e.status === 409 && e.message === 'İptal talebiniz reddedildi. Lütfen personelle görüşün.');
  assert.equal(next.cancelRequested, false); assert.equal(next.cancelDeclineReason, 'Hazırlandı'); assert.equal(next.version, declined);
  assert.equal(guestMessage(new ApiError('İptal talebiniz reddedildi. Lütfen personelle görüşün.', 409, 'CANCEL_DECLINED'), true), 'Your cancellation request was declined. Please ask our staff.');
  assert.equal(cancelDefinitelyRejected(new ApiError('declined', 409, 'CANCEL_DECLINED')), true);
  // Staff can still cancel it themselves.
  cancelOrder(s, owner, { requestId: randomUUID(), orderId: next.id, version: next.version }, ctx());
  assert.equal(next.status, 'cancelled');
});

test('K-H: the menu starts in the phone\'s language (Turkish phone → TR, any other → EN); the guest\'s own choice wins', () => {
  assert.equal(startsInEnglish(null, ['tr-TR', 'en-US']), false);
  assert.equal(startsInEnglish(null, ['tr']), false);
  assert.equal(startsInEnglish(null, ['TR-tr']), false);
  assert.equal(startsInEnglish(null, ['en-US', 'tr-TR']), true, 'the first preferred language decides');
  assert.equal(startsInEnglish(null, ['de-DE']), true);
  assert.equal(startsInEnglish(null, ['ar']), true);
  assert.equal(startsInEnglish(null, []), false, 'unknown language: Turkish');
  assert.equal(startsInEnglish(null, ['']), false);
  // A tap on EN/TR is remembered ("mola-language") and always wins over the phone.
  assert.equal(startsInEnglish('tr', ['en-US']), false);
  assert.equal(startsInEnglish('en', ['tr-TR']), true);
  assert.equal(startsInEnglish('junk', ['en-GB']), true);
});

test('Turkish search folds both sides and matches name, code and description', () => {
  const p = { id: 'x', code: '22', name: 'Ihlamur', nameEn: 'Linden Tea', description: 'Bal ve limonla', descriptionEn: '', category: 'Çaylar', price: 100, soldOut: false, art: 'tea', groups: [] } as Product;
  const choc = { ...p, code: '31', name: 'Fıstıklı Çikolata', nameEn: '', description: 'Şeker yok' } as Product;
  assert.equal(searchKey('İHLAMUR'), 'ihlamur'); assert.equal(searchKey('Çay ŞEKER ğÖÜ'), 'cay seker gou');
  for (const q of ['ihlamur', 'İhlamur', 'IHLAMUR', 'ıhlamur', 'linden', 'limon', '22', '#22']) assert.ok(matchesSearch(p, q), q);
  for (const q of ['fistik', 'FISTIK', 'cikolata', 'ÇİKOLATA', 'seker', '31']) assert.ok(matchesSearch(choc, q), q);
  assert.ok(!matchesSearch(p, 'kahve')); assert.ok(matchesSearch(p, ''));
});

test('a saved basket is checked against the menu: gone items and changed options leave, sold-out and price changes are marked', () => {
  const s = seed(), products = s.products;
  const saved = { v: 1, packed: true, lines: [
    { productId: 'tea', quantity: 2, selections: [], seen: 3000 },
    { productId: 'gone', quantity: 1, selections: [] },
    { productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'nope' }] },
    { productId: 'cheesecake', quantity: 1, selections: [], note: 'Ayrı tabak', seen: 19000 },
    'junk',
  ] };
  const restored = restoreBasket(saved, products);
  assert.equal(restored.dropped, 3); assert.equal(restored.packed, true);
  assert.deepEqual(restored.lines.map(l => l.productId), ['tea', 'cheesecake']);
  assert.equal(restored.lines[1].note, 'Ayrı tabak');
  assert.equal(unitPriceOf(products.find(p => p.id === 'tea')!, restored.lines[0]), 3500);
  assert.equal(restored.lines[0].seen, 3000, 'the old price stays so the basket can say "₺30 → ₺35"');
  assert.deepEqual(restoreBasket('nonsense', products), { lines: [], packed: false, dropped: 0 });
  assert.deepEqual(restoreBasket(null, products), { lines: [], packed: false, dropped: 0 });
});

test('guest state: a moved or merged table is not "paid"; orders stay visible without the new table; own total', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/guest-exp-')));
  let time = Date.parse('2026-10-05T10:00:00Z');
  licensed(store); const server = createServer(createApp(store, () => new Date(time), () => true));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  function client() {
    const jar = new Map<string, string>(); let session = '';
    return {
      async call(path: string, body?: unknown) {
        const response = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'X-Guest-Session': session }, body: body === undefined ? undefined : JSON.stringify(body) });
        for (const value of response.headers.getSetCookie()) { const [k, v] = value.split(';')[0].split('='); jar.set(k, v); }
        const data = response.status === 204 ? null : await response.json() as any;
        if (data?.session) session = data.session;
        return { status: response.status, data };
      },
    };
  }
  const staff = client();
  assert.equal((await staff.call('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  await staff.call('/staff/heartbeat', {});
  await staff.call('/staff/settings', { changeSeconds: 0, commissionBps: null });
  const tables = () => store.read('mola-demo').tables;
  const tea = store.read('mola-demo').products.find(p => p.published !== false && !p.soldOut && !p.groups.length && p.unit !== 'kg')!;
  async function seated(index: number) {
    const g = client(); const opened = await g.call('/guest/session', { token: tables()[index].token });
    assert.equal(opened.status, 200);
    const order = async () => (await g.call('/guest/orders', { requestId: randomUUID(), guestContext: opened.data.guestContext, tableId: tables()[index].id, lines: [{ productId: tea.id, quantity: 1, selections: [] }], expectedTotal: tea.price })).data;
    return { g, order, state: async () => (await g.call('/guest/state')).data };
  }
  const account = (index: number) => store.read('mola-demo').accounts.find(a => a.id === tables()[index].accountId)!;

  await t.test('move: the old screen says the orders moved and keeps showing them; never the new table name', async () => {
    const a = await seated(0); const sent = await a.order();
    assert.equal(sent.status, 'new');
    const before = await a.state();
    assert.equal(before.closed, false); assert.equal(before.ended, undefined); assert.equal(before.due, tea.price);
    const target = tables()[5];
    const moved = await staff.call('/staff/tables/move', { requestId: randomUUID(), accountId: account(0).id, version: account(0).version, targetId: target.id, targetEpoch: target.epoch });
    assert.equal(moved.status, 200);
    const after = await a.state();
    assert.equal(after.closed, true); assert.equal(after.ended, 'moved');
    assert.equal(after.orders.length, 1, 'orders do not vanish');
    assert.equal(after.orders[0].canEdit, false);
    assert.ok(!JSON.stringify(after).includes(target.name), 'the new table is not revealed');
    assert.equal(after.due, undefined);
  });

  await t.test('merge: guests of the joined table see "moved", guests of the receiving table only a renewed session', async () => {
    const a = await seated(1), b = await seated(2); await a.order(); await b.order();
    const from = account(1), to = account(2);
    const merged = await staff.call('/staff/accounts/merge', { requestId: randomUUID(), sourceId: from.id, sourceVersion: from.version, targetId: to.id, targetVersion: to.version });
    assert.equal(merged.status, 200);
    const left = await a.state(), stayed = await b.state();
    assert.equal(left.ended, 'moved'); assert.equal(left.orders.length, 1);
    assert.ok(!JSON.stringify(left).includes(tables()[2].name));
    assert.equal(stayed.closed, true); assert.equal(stayed.ended, 'other');
  });

  await t.test('paid: only a real payment ends with "paid"', async () => {
    const a = await seated(3); await a.order();
    const acc = account(3);
    const paid = await staff.call('/staff/payments', { requestId: randomUUID(), accountId: acc.id, version: acc.version, method: 'cash', amount: tea.price, tendered: tea.price });
    assert.equal(paid.status, 200);
    const after = await a.state();
    assert.equal(after.closed, true); assert.equal(after.ended, 'paid'); assert.equal(after.orders.length, 1);
  });

  await t.test('the table bill: every item on the open bill (also the other phone and the waiter), minus payments; blocked browsers are told', async () => {
    const a = await seated(4), other = await seated(4);
    await a.order(); await a.order(); await other.order();
    // The waiter adds one from his phone (staff order on the same open bill).
    const waiterOrder = await staff.call('/staff/orders', { requestId: randomUUID(), tableId: tables()[4].id, lines: [{ productId: tea.id, quantity: 1, selections: [] }], expectedTotal: tea.price });
    assert.equal(waiterOrder.status, 200);
    const mine = await a.state();
    assert.equal(mine.due, tea.price * 4, 'the whole table bill is to pay');
    assert.deepEqual(mine.bill, { total: tea.price * 4, paid: 0 });
    assert.equal(mine.orders.length, 4);
    const byStaff = mine.orders.filter((o: any) => o.addedBy === 'staff'), byOther = mine.orders.filter((o: any) => o.addedBy === 'table');
    assert.equal(byStaff.length, 1); assert.equal(byOther.length, 1);
    for (const o of [...byStaff, ...byOther]) { assert.equal(o.canEdit, false); assert.equal(o.guestLabel, ''); assert.equal(o.guestId, undefined); }
    assert.equal(mine.orders.filter((o: any) => !o.addedBy).length, 2, 'own orders stay unlabelled');
    // Staff items are read-only for the guest: the server refuses a cancel.
    const refused = await a.g.call('/guest/cancel', { requestId: randomUUID(), orderId: byStaff[0].id, version: byStaff[0].version });
    assert.equal(refused.status, 403);
    assert.equal(mine.blocked, undefined);
    const s = store.read('mola-demo'), own = s.orders.filter(o => o.accountId === account(4).id)[0];
    const acc = account(4), pay = await staff.call('/staff/payments', { requestId: randomUUID(), accountId: acc.id, version: acc.version, method: 'card', amount: tea.price, tendered: tea.price, selections: [{ orderId: own.id, lineId: own.lines[0].id, quantity: 1 }] });
    assert.equal(pay.status, 200);
    const after = await a.state();
    assert.equal(after.due, tea.price * 3, 'items paid at the counter are taken off');
    assert.equal(after.bill.paid, tea.price);
    assert.equal(after.orders.find((o: any) => o.id === own.id).paid, true);
    assert.equal((await staff.call('/staff/block', { orderId: own.id, blocked: true })).status, 200);
    assert.equal((await a.state()).blocked, true);
  });

  await t.test('the waiter ordered first, the guest scans after: the bill is there; once it is closed a new scan sees nothing old', async () => {
    const tableId = tables()[8].id;
    const placed = await staff.call('/staff/orders', { requestId: randomUUID(), tableId, lines: [{ productId: tea.id, quantity: 2, selections: [] }], expectedTotal: tea.price * 2 });
    assert.equal(placed.status, 200);
    const g = await seated(8), view = await g.state();
    assert.equal(view.orders.length, 1); assert.equal(view.orders[0].addedBy, 'staff'); assert.equal(view.due, tea.price * 2);
    assert.equal(view.tableHasAccount, true, '"Hesabı iste" works for a bill only the waiter wrote');
    // Another table's bill is never shown.
    const elsewhere = await seated(9);
    assert.equal((await elsewhere.state()).orders.length, 0);
    const acc = account(8);
    assert.equal((await staff.call('/staff/payments', { requestId: randomUUID(), accountId: acc.id, version: acc.version, method: 'cash', amount: tea.price * 2, tendered: tea.price * 2 })).status, 200);
    const closed = await g.state();
    assert.equal(closed.closed, true); assert.equal(closed.due, undefined); assert.equal(closed.bill, undefined);
    assert.equal(closed.orders.filter((o: any) => o.addedBy).length, 0, 'the closed bill\'s staff items leave the old screen');
    const next = await seated(8), fresh = await next.state();
    assert.equal(fresh.orders.length, 0); assert.equal(fresh.due, undefined);
  });

  await t.test('guest cancel of a ready order is refused over HTTP and not shown as pending', async () => {
    const a = await seated(6); const sent = await a.order();
    let o = store.read('mola-demo').orders.find(x => x.id === sent.orderId)!;
    for (const status of ['preparing', 'ready']) { await staff.call('/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status }); o = store.read('mola-demo').orders.find(x => x.id === sent.orderId)!; }
    const refused = await a.g.call('/guest/cancel', { requestId: randomUUID(), orderId: o.id, version: o.version });
    assert.equal(refused.status, 409); assert.equal(refused.data.code, 'CANCEL_CLOSED');
    store.mutate('mola-demo', (s: State) => { const x = s.orders.find(x => x.id === sent.orderId)!; x.status = 'served'; x.cancelRequested = true; });
    const view = await a.state();
    assert.equal(view.orders.find((x: any) => x.id === sent.orderId).cancelRequested, false);
  });
});
