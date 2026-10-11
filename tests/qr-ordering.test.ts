import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { BLOCK_DAYS, pruneBlocked, type QrOrdering } from '../server/qr-ordering.js';
import { QR_CLOSED_TEXT, QR_STAFF_WINDOW_MS, qrClosedLine, qrOrderingView, qrPause } from '../packages/domain/qr-ordering.js';
import { businessDay } from '../packages/domain/business-day.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * QR siparişleri açık mı (8 Ekim, server/qr-ordering.ts): a staff screen connected, not paused after gün sonu, not stopped by
 * hand. The guest menu stays; new guest orders are refused with "Şu an sipariş almıyoruz…"; Garson çağır needs a staff screen.
 */
async function cafe(t: { after: (fn: () => Promise<void>) => void }, overrides: Parameters<typeof licensed>[1] = {}) {
  const store = new Store(temp('qr-ordering')); licensed(store, overrides);
  let clock = Date.now();
  const app = createApp(store, () => new Date(clock)), server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client() {
    const jar = new Map<string, string>(); let session = '';
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(session ? { 'X-Guest-Session': session } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of r.headers.getSetCookie()) { const [k, v] = c.split(';')[0].split('='); jar.set(k, v); }
      const data = await r.json().catch(() => ({})) as any;
      if (typeof data?.session === 'string') session = data.session;
      return { status: r.status, data };
    };
    return Object.assign(call, { login: (username: string) => call('/login', { username, password: DEMO_PASSWORD }) });
  }
  const qr = app.locals.qrOrdering as QrOrdering;
  const table = store.read('mola-demo').tables[0];
  const order = (guest: ReturnType<typeof client>, requestId = randomUUID()) => guest('/guest/orders', { requestId, tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
  return { store, app, qr, client, table, order, advance: (ms: number) => { clock += ms; }, now: () => clock };
}

test('the rule itself: a manual stop first, the gün sonu pause only on its own business day, else a connected staff screen', () => {
  const t = Date.parse('2026-10-08T20:00:00Z'), day = businessDay(t);
  assert.deepEqual(qrOrderingView(undefined, true, t), { open: true, call: true });
  assert.deepEqual(qrOrderingView(undefined, false, t), { open: false, reason: 'staff', call: false });
  assert.equal(qrPause({ paused: { at: new Date(t).toISOString(), day } }, t)?.reason, 'closing');
  assert.equal(qrPause({ paused: { at: new Date(t).toISOString(), day } }, t + 10 * 3600_000), undefined, 'the next business day (05:00) opens it by itself');
  const both = qrOrderingView({ stopped: { at: 'x', by: 'u', byName: 'Zeynep' }, paused: { at: 'y', day } }, true, t);
  assert.equal(both.reason, 'stopped'); assert.equal(both.call, true, 'the waiter call works while a screen is connected');
  // The sidebar card's reason line (10 Ekim), in the owner's words.
  assert.equal(qrClosedLine({ reason: 'closing', byName: 'Ayşe' }), 'Gün sonu yapıldı · müşteriler telefondan sipariş veremiyor');
  assert.equal(qrClosedLine({ reason: 'stopped', byName: 'Zeynep' }), 'Elle durduruldu (Zeynep)');
  assert.equal(qrClosedLine({ reason: 'stopped' }), 'Elle durduruldu');
  assert.equal(qrClosedLine({ reason: 'staff' }), 'Personel ekranı bağlı değil');
});

test('a staff screen must be connected: no screen, no order and no waiter call; a poll opens it, 90 s of silence or a sign-out closes it', async t => {
  const c = await cafe(t); c.qr.staffRule = true;
  const guest = c.client();
  assert.equal((await guest('/guest/session', { token: c.table.token })).status, 200);
  let state = (await guest('/guest/state')).data;
  assert.deepEqual(state.ordering, { open: false, reason: 'staff', call: false }, 'the menu itself is shown, ordering is closed');
  assert.ok(state.products.length > 0);
  const refused = await c.order(guest);
  assert.equal(refused.status, 409); assert.equal(refused.data.code, 'ORDERING_CLOSED'); assert.equal(refused.data.message, QR_CLOSED_TEXT.tr);
  assert.equal(c.store.read('mola-demo').orders.length, 0);
  const call = await guest('/guest/call', { requestId: randomUUID(), kind: 'waiter' });
  assert.equal(call.status, 409); assert.equal(call.data.code, 'CALL_UNAVAILABLE');
  // The kitchen tablet signs in and polls: open (any role at the café: kitchen, waiter, cashier, Müdür, owner).
  const kitchen = c.client(); await kitchen.login('mutfak'); await kitchen('/staff/state');
  state = (await guest('/guest/state')).data;
  assert.deepEqual(state.ordering, { open: true, call: true });
  assert.equal((await c.order(guest)).status, 200);
  // A tablet asleep for a moment does not flap it; 90 s without a request does.
  c.advance(QR_STAFF_WINDOW_MS - 5_000); assert.equal((await guest('/guest/state')).data.ordering.open, true);
  c.advance(10_000); assert.deepEqual((await guest('/guest/state')).data.ordering, { open: false, reason: 'staff', call: false });
  await kitchen('/staff/state'); assert.equal((await guest('/guest/state')).data.ordering.open, true);
  // Signing out closes it at once (no other screen).
  await kitchen('/logout', {});
  assert.equal((await guest('/guest/state')).data.ordering.open, false);
  // The owner's staff snapshot says why, with "Aç" only for pauses (a missing screen cannot be tapped open).
  const owner = c.client(); await owner.login('isletme');
  const chip = (await owner('/staff/state')).data.qrOrdering;
  assert.deepEqual(chip, { open: true, call: true, canChange: true }, 'the owner signed in at the café counts too');
});

test('gün sonu pauses QR ordering for that business day: "Aç" opens it again, as does opening the cash day; calls still work', async t => {
  const c = await cafe(t);
  const cashier = c.client(), owner = c.client(), waiter = c.client(), guest = c.client();
  await cashier.login('kasiyer'); await owner.login('isletme'); await waiter.login('garson');
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 50000 })).status, 200);
  const counted = await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 50000 });
  assert.equal(counted.status, 200, JSON.stringify(counted.data));
  assert.equal((await cashier('/staff/cash/finish', { id: counted.data.closing?.id ?? counted.data.id, left: 50000 })).status, 200);
  const chip = (await cashier('/staff/state')).data.qrOrdering;
  assert.equal(chip.open, false); assert.equal(chip.reason, 'closing'); assert.equal(chip.canChange, true); assert.equal(chip.call, true);
  assert.equal((await waiter('/staff/state')).data.qrOrdering.canChange, undefined, 'a waiter sees the chip but cannot open it');
  assert.equal((await waiter('/staff/qr-ordering', { requestId: randomUUID(), open: true })).status, 403);
  await guest('/guest/session', { token: c.table.token });
  assert.deepEqual((await guest('/guest/state')).data.ordering, { open: false, reason: 'closing', call: true });
  assert.equal((await c.order(guest)).data.code, 'ORDERING_CLOSED');
  assert.equal((await guest('/guest/call', { requestId: randomUUID(), kind: 'waiter' })).status, 200, 'Garson çağır works after gün sonu');
  // Staff orders are never affected.
  const staffOrder = await waiter('/staff/orders', { requestId: randomUUID(), tableId: c.table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
  assert.equal(staffOrder.status, 200, JSON.stringify(staffOrder.data));
  // One tap: open again (audited).
  assert.deepEqual((await owner('/staff/qr-ordering', { requestId: randomUUID(), open: true })).data, { open: true, call: true, canChange: true });
  assert.equal((await c.order(guest)).status, 200);
  const audit = c.store.auditLog('mola-demo').map(a => `${a.action}:${a.target}`);
  assert.ok(audit.includes('qr_ordering.paused:closing')); assert.ok(audit.includes('qr_ordering.opened:closing'));
  // An extra closing pauses again; the next business day (05:00) ends that pause by itself.
  const extra = await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 53500 });
  await cashier('/staff/cash/finish', { id: extra.data.closing?.id ?? extra.data.id, left: 0, note: 'Ek kapanış' });
  assert.equal((await guest('/guest/state')).data.ordering.reason, 'closing');
  c.qr.pauseForClosing('mola-demo', new Date(c.now() - 86_400_000));
  assert.equal((await owner('/staff/state')).data.qrOrdering.open, true, 'a pause from an earlier business day no longer holds');
  // Opening the cash day ends a pause too.
  c.qr.pauseForClosing('mola-demo', new Date(c.now()));
  c.qr.openedCashDay('mola-demo');
  assert.equal((await owner('/staff/state')).data.qrOrdering.open, true);
});

test('"QR siparişlerini durdur": cashier, Müdür and owner; until "Aç"; a lost answer of an earlier order is never refused', async t => {
  const c = await cafe(t);
  const cashier = c.client(), waiter = c.client(), kitchen = c.client(), guest = c.client();
  await cashier.login('kasiyer'); await waiter.login('garson'); await kitchen.login('mutfak');
  await guest('/guest/session', { token: c.table.token });
  const first = randomUUID(); assert.equal((await c.order(guest, first)).status, 200);
  assert.equal((await waiter('/staff/qr-ordering', { requestId: randomUUID(), open: false })).status, 403, 'a waiter cannot stop it');
  assert.equal((await kitchen('/staff/qr-ordering', { requestId: randomUUID(), open: false })).status, 403);
  const stopped = (await cashier('/staff/qr-ordering', { requestId: randomUUID(), open: false })).data;
  assert.equal(stopped.open, false); assert.equal(stopped.reason, 'stopped'); assert.ok(stopped.byName); assert.ok(stopped.since);
  assert.equal((await kitchen('/staff/state')).data.qrOrdering, undefined, 'the kitchen board has no chip');
  assert.deepEqual((await guest('/guest/state')).data.ordering, { open: false, reason: 'stopped', call: true });
  assert.equal((await c.order(guest)).data.code, 'ORDERING_CLOSED');
  assert.equal((await c.order(guest, first)).status, 200, 'the same request again (its answer was lost) is the order already taken');
  // Stays stopped across business days, until someone opens it.
  c.advance(30 * 3600_000); await cashier.login('kasiyer');
  assert.equal((await cashier('/staff/state')).data.qrOrdering.reason, 'stopped');
  assert.equal((await cashier('/staff/qr-ordering', { requestId: randomUUID(), open: true })).data.open, true);
  const audit = c.store.auditLog('mola-demo').map(a => a.action);
  assert.ok(audit.includes('qr_ordering.stopped') && audit.includes('qr_ordering.opened'));
});

test('"Sadece QR menü": no ordering part at all (browsing only, as before); a blocked phone is let go after 90 days', async t => {
  const c = await cafe(t, { service: 'menu' });
  const guest = c.client(), owner = c.client(); await owner.login('isletme');
  await guest('/guest/session', { token: c.table.token });
  const state = (await guest('/guest/state')).data;
  assert.equal(state.menuOnly, true); assert.equal(state.ordering, undefined);
  assert.equal((await owner('/staff/state')).data.qrOrdering, undefined);
  // 90-day blocks (retention): an undated block gets today's date once, then ends 90 days later.
  c.store.mutate('mola-demo', s => { s.blocked.push('a'.repeat(48)); (s.blockedInfo ??= {})['a'.repeat(48)] = { orderId: 'o1', number: 1, label: 'Misafir' }; });
  pruneBlocked(c.store, 'mola-demo', c.store.read('mola-demo'), new Date(c.now()));
  assert.ok(c.store.read('mola-demo').blockedInfo!['a'.repeat(48)].at);
  pruneBlocked(c.store, 'mola-demo', c.store.read('mola-demo'), new Date(c.now() + (BLOCK_DAYS - 1) * 86_400_000));
  assert.ok(c.store.read('mola-demo').blocked.includes('a'.repeat(48)));
  pruneBlocked(c.store, 'mola-demo', c.store.read('mola-demo'), new Date(c.now() + (BLOCK_DAYS + 1) * 86_400_000));
  assert.equal(c.store.read('mola-demo').blocked.length, 0); assert.equal(c.store.read('mola-demo').blockedInfo!['a'.repeat(48)], undefined);
  assert.ok(c.store.auditLog('mola-demo').some(a => a.action === 'browser.unblocked_expired'));
});
