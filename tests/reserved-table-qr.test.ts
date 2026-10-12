import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { buildMirror, mirrorHolds, tableHash } from '../server/menu-mirror.js';
import { featureIds } from '../packages/domain/feature-gate.js';
import { mirrorHold, mirrorSnapshot, type MirrorMenu } from '../packages/domain/menu-mirror.js';
import { reservedText } from '../packages/domain/qr-ordering.js';
import { DEFAULT_HOLD, heldBusyText, holdActive, holdUntil, markPhase, qrHeldText, reservationSettings, tableHold, type Reservation } from '../packages/domain/reservations.js';
import { saveReservationSettings } from '../packages/domain/reservation-rules.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * Rezerve masada QR (12 Ekim, sahibin kararı; packages/domain/reservations.ts holdActive/tableHold, server/qr-ordering.ts):
 * from `holdMinutes` (default 30) before a waiting reservation the table's QR takes no new guest orders
 * (TABLE_RESERVED_SOON, "Bu masa 20:00 için ayrılmıştır…"), the menu, Garson çağır and Hesabı iste stay; "Geldi" gives the QR
 * to the party, its paid bill finishes the reservation; "Gelmedi"/"İptal" free it at once; a forgotten one ends at 05:00.
 * The same setting puts "Rezerve" on Masalar (one setting since 12 Ekim; the old 60-minute display setting is not read).
 */
const R = (id: string, tableId: string, at: string, time: string, status: Reservation['status'] = 'booked') => ({ id, tableId, at, time, status });

test('the rule itself: window start and end, 0 = off, the 05:00 business day end, overlapping reservations', () => {
  const at = '2026-10-12T17:00:00.000Z'; // 20:00 Türkiye
  assert.equal(holdActive({ at }, Date.parse('2026-10-12T16:29:59Z'), 30), false, 'before the 30 minutes: a normal table');
  assert.equal(holdActive({ at }, Date.parse('2026-10-12T16:30:00Z'), 30), true, '30 minutes before: held');
  assert.equal(holdActive({ at }, Date.parse('2026-10-12T16:30:00Z'), 0), false, '0 = the QR never closes');
  assert.equal(holdActive({ at }, Date.parse('2026-10-12T16:00:00Z'), 60), true);
  // Never decided: the hold ends with the reservation's business day (05:00 the next morning), never later.
  assert.equal(new Date(holdUntil(at)).toISOString(), '2026-10-13T02:00:00.000Z');
  assert.equal(holdActive({ at }, Date.parse('2026-10-13T01:59:59Z'), 30), true);
  assert.equal(holdActive({ at }, Date.parse('2026-10-13T02:00:00Z'), 30), false, 'the next 05:00 lets the table go');
  // 00:30 belongs to the evening before: held from 00:00 until 05:00 that morning. 05:20 is the next business day's.
  assert.equal(new Date(holdUntil('2026-10-12T21:30:00.000Z')).toISOString(), '2026-10-13T02:00:00.000Z');
  assert.equal(holdActive({ at: '2026-10-12T21:30:00.000Z' }, Date.parse('2026-10-12T21:00:00Z'), 30), true);
  assert.equal(holdActive({ at: '2026-10-13T02:20:00.000Z' }, Date.parse('2026-10-13T01:55:00Z'), 30), true, '04:55 for a 05:20 table: held across the 05:00 turn');
  assert.equal(new Date(holdUntil('2026-10-13T02:20:00.000Z')).toISOString(), '2026-10-14T02:00:00.000Z');
  // Two on the same table (written with "Yine de kaydet"): the earliest first; a seated, cancelled or no-show one holds nothing.
  const list = [R('b', 't', '2026-10-12T18:00:00.000Z', '21:00'), R('a', 't', at, '20:00'), R('c', 't', '2026-10-12T16:40:00.000Z', '19:40', 'cancelled'), R('d', 'u', at, '20:00')];
  assert.equal(tableHold(list, 't', Date.parse('2026-10-12T16:20:00Z'), 30), undefined);
  assert.equal(tableHold(list, 't', Date.parse('2026-10-12T16:45:00Z'), 30)?.id, 'a');
  assert.equal(tableHold(list, 't', Date.parse('2026-10-12T17:40:00Z'), 30)?.id, 'a', 'both windows open: the earlier one');
  list[1].status = 'seated';
  assert.equal(tableHold(list, 't', Date.parse('2026-10-12T17:10:00Z'), 30), undefined, 'the 20:00 party sat down: the QR is theirs');
  assert.equal(tableHold(list, 't', Date.parse('2026-10-12T17:30:00Z'), 30)?.time, '21:00', 'until the 21:00 window starts');
  // Staff words and the guest's.
  assert.equal(qrHeldText('20:00'), 'QR kapalı · 20:00 rezervasyonu');
  assert.equal(heldBusyText('20:00'), '20:00 rezervasyonu · masada hâlâ misafir var');
  assert.deepEqual(reservedText('20:00'), { tr: 'Bu masa 20:00 için ayrılmıştır. Sipariş için lütfen garsonunuza sorun.', en: 'This table is reserved for 20:00. Please ask your waiter to order.' });
});

test('one setting for "Rezerve" on Masalar and the QR: default 30, the old display-only lead is not read, 0 = off', () => {
  assert.equal(DEFAULT_HOLD, 30);
  assert.deepEqual([reservationSettings().holdMinutes, reservationSettings().leadMinutes], [30, 30]);
  // Before 12 Ekim "Rezerve" alone had a lead (default 60, chosen up to 3 hours): never carried over (it would close QRs for hours).
  assert.equal(reservationSettings({ leadMinutes: 180 }).holdMinutes, 30);
  assert.equal(reservationSettings({ holdMinutes: 0 }).leadMinutes, 0);
  // The floor marks with the same minutes: 31 minutes before, still a normal table.
  const at = '2026-10-12T17:00:00.000Z', rules = reservationSettings();
  assert.equal(markPhase({ at }, Date.parse('2026-10-12T16:29:00Z'), rules), 'later');
  assert.equal(markPhase({ at }, Date.parse('2026-10-12T16:30:00Z'), rules), 'reserved');
  assert.equal(markPhase({ at }, Date.parse('2026-10-12T17:00:00Z'), { leadMinutes: 0, askMinutes: 30 }), 'reserved', 'off: "Rezerve" from the time itself');
  // Saving drops the old field; an older screen's leadMinutes means the hold now; out of range is refused.
  const s = { tenantId: 'x', reservationSettings: { leadMinutes: 120 } } as never;
  const actor = { tenantId: 'x', id: 'o', role: 'owner' as const };
  assert.deepEqual(saveReservationSettings(s, actor, { holdMinutes: 45 }), { holdMinutes: 45 });
  assert.deepEqual(saveReservationSettings(s, actor, { leadMinutes: 15 }), { holdMinutes: 15 });
  assert.throws(() => saveReservationSettings(s, actor, { holdMinutes: 241 }));
});

async function cafe(t: { after: (fn: () => Promise<void>) => void }, start: string, overrides: Parameters<typeof licensed>[1] = {}) {
  const store = new Store(temp('reserved-qr')); licensed(store, overrides);
  let clock = new Date(start);
  const app = createApp(store, () => clock), server = createServer(app);
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
  const owner = client(), cashier = client(), waiter = client();
  for (const [who, name] of [[owner, 'isletme'], [cashier, 'kasiyer'], [waiter, 'garson']] as const) assert.equal((await who.login(name)).status, 200);
  const ok = (r: { status: number; data: any }) => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const table = (name: string) => store.read('mola-demo').tables.find(x => x.name === name)!;
  /** A phone scanning the table's QR now (a new visit). */
  const scan = async (name: string) => { const g = client(); ok(await g('/guest/session', { token: table(name).token })); return g; };
  const guestOrder = (g: ReturnType<typeof client>, name: string) => g('/guest/orders', { requestId: randomUUID(), tableId: table(name).id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
  const staffOrder = (name: string) => waiter('/staff/orders', { requestId: randomUUID(), tableId: table(name).id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
  const reserve = async (name: string, time: string, guest = 'Ahmet', extra: Record<string, unknown> = {}) => ok(await owner('/staff/reservations', { requestId: randomUUID(), tableId: table(name).id, day: '2026-10-12', time, name: guest, people: 4, ...extra }));
  const pay = async (name: string) => { const s = ok(await cashier('/staff/state')), a = s.tables.find((x: any) => x.name === name).account; ok(await cashier('/staff/payments', { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: a.balance, tendered: a.balance })); };
  const relogin = async () => { for (const [who, name] of [[owner, 'isletme'], [cashier, 'kasiyer'], [waiter, 'garson']] as const) assert.equal((await who.login(name)).status, 200); };
  return { store, app, client, owner, cashier, waiter, ok, table, scan, guestOrder, staffOrder, reserve, pay, relogin, set: (iso: string) => { clock = new Date(iso); } };
}
const RESERVED = reservedText('20:00').tr;

test('a reserved table\'s QR: open before the window, closed 30 minutes before, "Geldi" gives it to the party, its paid bill ends it', async t => {
  const c = await cafe(t, '2026-10-12T16:00:00Z'); // 19:00
  const r = await c.reserve('Masa 05', '20:00');
  // 19:00: the table is a normal table; its QR takes orders. Masalar shows no "Rezerve" yet (the same 30 minutes).
  let g = await c.scan('Masa 05');
  assert.deepEqual((await g('/guest/state')).data.ordering, { open: true, call: true });
  const floor = c.ok(await c.waiter('/staff/state'));
  assert.equal(floor.reservations.leadMinutes, 30); assert.equal(floor.reservations.qrHold, true);
  assert.equal(markPhase(floor.reservationMarks.find((m: any) => m.id === r.id), Date.parse('2026-10-12T16:00:00Z'), floor.reservations), 'later');
  // 19:30: held. The menu stays, a new order is refused with the calm sentence, Garson çağır works, the waiter orders as ever.
  c.set('2026-10-12T16:30:00Z');
  g = await c.scan('Masa 05');
  const state = (await g('/guest/state')).data;
  assert.deepEqual(state.ordering, { open: false, reason: 'reserved', call: true, reservedFor: '20:00' });
  assert.ok(state.products.length > 0, 'the menu is still there');
  const refused = await c.guestOrder(g, 'Masa 05');
  assert.equal(refused.status, 409); assert.equal(refused.data.code, 'TABLE_RESERVED_SOON'); assert.equal(refused.data.message, RESERVED);
  assert.equal((await g('/guest/call', { requestId: randomUUID(), kind: 'waiter' })).status, 200, 'Garson çağır');
  assert.equal((await (await c.scan('Masa 06'))('/guest/state')).data.ordering.open, true, 'only the reserved table');
  assert.equal(c.store.read('mola-demo').orders.length, 0);
  // "Geldi": the party's bill opens; the table QR works for them.
  c.ok(await c.waiter('/staff/reservations/seat', { requestId: randomUUID(), id: r.id }));
  g = await c.scan('Masa 05');
  assert.deepEqual((await g('/guest/state')).data.ordering, { open: true, call: true });
  assert.equal((await c.guestOrder(g, 'Masa 05')).status, 200);
  assert.equal((await g('/guest/call', { requestId: randomUUID(), kind: 'bill', payWith: 'cash' })).status, 200, 'Hesabı iste');
  // Paid: the reservation is over, the table and its QR are normal again.
  c.set('2026-10-12T18:30:00Z');
  await c.pay('Masa 05');
  assert.ok(c.store.read('mola-demo').reservations!.find(x => x.id === r.id)!.closedAt, 'the paid bill finished the reservation');
  g = await c.scan('Masa 05');
  assert.deepEqual((await g('/guest/state')).data.ordering, { open: true, call: true });
  assert.equal((await c.guestOrder(g, 'Masa 05')).status, 200);
});

test('a walk-in party still at the table when the window starts keeps its orders and "Hesabı iste"; new QR orders wait; staff are told', async t => {
  const c = await cafe(t, '2026-10-12T16:00:00Z');
  const r = await c.reserve('Masa 05', '20:00');
  const g = await c.scan('Masa 05');
  assert.equal((await c.guestOrder(g, 'Masa 05')).status, 200, '19:00: a walk-in orders from the QR');
  c.set('2026-10-12T16:31:00Z');
  const state = (await g('/guest/state')).data;
  assert.deepEqual(state.ordering, { open: false, reason: 'reserved', call: true, reservedFor: '20:00' });
  assert.equal(state.orders.length, 1, 'their own order is still listed'); assert.equal(state.closed, false); assert.equal(state.tableHasAccount, true, '"Hesabı iste" stays');
  assert.equal((await c.guestOrder(g, 'Masa 05')).data.code, 'TABLE_RESERVED_SOON');
  assert.equal((await g('/guest/call', { requestId: randomUUID(), kind: 'bill' })).status, 200);
  // The waiter can always order from his own phone; the floor has the reservation on a table with an open bill.
  assert.equal((await c.staffOrder('Masa 05')).status, 200);
  const floor = c.ok(await c.waiter('/staff/state'));
  const t5 = floor.tables.find((x: any) => x.name === 'Masa 05');
  assert.ok(t5.account, 'the walk-in bill is open');
  assert.equal(floor.reservationMarks.find((m: any) => m.tableId === t5.id)?.id, r.id, 'the screen shows "20:00 rezervasyonu · masada hâlâ misafir var"');
  // Seating is refused while the table is taken; once the walk-in pays, the table is still held for the reservation.
  assert.equal((await c.waiter('/staff/reservations/seat', { requestId: randomUUID(), id: r.id })).data.code, 'TABLE_BUSY');
  await c.pay('Masa 05');
  const next = await c.scan('Masa 05');
  assert.equal((await next('/guest/state')).data.ordering.reason, 'reserved');
  assert.equal((await c.guestOrder(next, 'Masa 05')).data.code, 'TABLE_RESERVED_SOON');
});

test('"Gelmedi" and "İptal" free the table at once; overlapping reservations; 0 = off; the next 05:00', async t => {
  const c = await cafe(t, '2026-10-12T16:40:00Z'); // 19:40
  const late = await c.reserve('Masa 07', '20:00', 'Burak'), off = await c.reserve('Masa 08', '20:00', 'Can');
  for (const name of ['Masa 07', 'Masa 08']) assert.equal((await c.guestOrder(await c.scan(name), name)).data.code, 'TABLE_RESERVED_SOON');
  c.ok(await c.waiter('/staff/reservations/no-show', { requestId: randomUUID(), id: late.id }));
  c.ok(await c.owner('/staff/reservations/cancel', { requestId: randomUUID(), id: off.id }));
  for (const name of ['Masa 07', 'Masa 08']) assert.equal((await c.guestOrder(await c.scan(name), name)).status, 200, `${name} is a normal table again`);
  // Two on one table (20:00 and 21:00, "Yine de kaydet"): the 20:00 party sits; at 20:30 the 21:00 window starts while they eat.
  const first = await c.reserve('Masa 09', '20:00', 'Deniz'), second = await c.reserve('Masa 09', '21:00', 'Ece', { force: true });
  c.ok(await c.waiter('/staff/reservations/seat', { requestId: randomUUID(), id: first.id }));
  const party = await c.scan('Masa 09');
  assert.equal((await c.guestOrder(party, 'Masa 09')).status, 200);
  c.set('2026-10-12T17:30:00Z');
  assert.deepEqual((await party('/guest/state')).data.ordering, { open: false, reason: 'reserved', call: true, reservedFor: '21:00' });
  assert.equal((await c.guestOrder(party, 'Masa 09')).data.code, 'TABLE_RESERVED_SOON');
  assert.ok((await party('/guest/state')).data.orders.length >= 1);
  const floor = c.ok(await c.cashier('/staff/state'));
  assert.equal(floor.reservationMarks.find((m: any) => m.tableId === c.table('Masa 09').id)?.id, second.id);
  // 0 = off: the QR stays open, the floor marks from the time itself (no "QR kapalı").
  c.ok(await c.owner('/staff/reservations/settings', { holdMinutes: 0 }));
  assert.equal((await c.guestOrder(party, 'Masa 09')).status, 200);
  assert.equal(c.ok(await c.cashier('/staff/state')).reservations.qrHold, undefined);
  assert.equal(c.ok(await c.owner('/staff/reservations/settings')).holdMinutes, 0);
  c.ok(await c.owner('/staff/reservations/settings', { holdMinutes: 30 }));
  assert.equal((await c.guestOrder(party, 'Masa 09')).data.code, 'TABLE_RESERVED_SOON');
  // Never decided: 23:00 tonight holds Masa 10 until 05:00, then the table is free again (the night turns like the cash day).
  await c.reserve('Masa 10', '23:00', 'Gece');
  c.set('2026-10-13T01:59:00Z'); await c.relogin();
  assert.equal((await (await c.scan('Masa 10'))('/guest/state')).data.ordering.reservedFor, '23:00');
  c.set('2026-10-13T02:00:00Z'); await c.relogin();
  assert.deepEqual((await (await c.scan('Masa 10'))('/guest/state')).data.ordering, { open: true, call: true });
});

test('without "Rezervasyon ve etkinlik" in the package nothing is held (the floor shows no reservations either)', async t => {
  const c = await cafe(t, '2026-10-12T16:00:00Z');
  await c.reserve('Masa 05', '20:00');
  c.store.mutate('mola-demo', s => { s.reservationSettings = { holdMinutes: 30 }; });
  const plain = await cafe(t, '2026-10-12T16:40:00Z', { features: featureIds.filter(f => f !== 'reservations') });
  plain.store.mutate('mola-demo', s => { s.reservations = c.store.read('mola-demo').reservations!.map(r => ({ ...r, tableId: plain.table(r.tableName).id })); });
  const g = await plain.scan('Masa 05');
  assert.deepEqual((await g('/guest/state')).data.ordering, { open: true, call: true });
  assert.equal((await plain.guestOrder(g, 'Masa 05')).status, 200);
});

test('Mola Merkez\'s menu copy carries the windows (no names), so the copy says "Bu masa 20:00 için ayrılmıştır" with the café away', async t => {
  const c = await cafe(t, '2026-10-12T16:00:00Z');
  await c.reserve('Masa 05', '20:00', 'Ahmet', { phone: '0532 111 22 33', note: 'Pencere' });
  const seated = await c.reserve('Masa 06', '20:00', 'Can');
  c.ok(await c.waiter('/staff/reservations/seat', { requestId: randomUUID(), id: seated.id }));
  const s = c.store.read('mola-demo'), now = Date.parse('2026-10-12T16:00:00Z'), h5 = tableHash(c.table('Masa 05').token);
  const holds = mirrorHolds(s, now);
  assert.deepEqual(holds, [{ h: h5, from: '2026-10-12T16:30:00.000Z', until: '2026-10-13T02:00:00.000Z', time: '20:00' }], 'only the waiting one; a seated party is not held');
  const { menu } = buildMirror(s, c.store.directory, { menuOnly: false, demo: false, social: true, popular: [], holds: true, now });
  const text = JSON.stringify(menu);
  for (const secret of ['Ahmet', '0532', 'Pencere', c.table('Masa 05').token]) assert.ok(!text.includes(secret), `no ${secret} in the copy`);
  const copy = { ...menu, photos: {} } as MirrorMenu;
  assert.equal(mirrorHold(copy, h5, new Date('2026-10-12T16:29:00Z')), undefined);
  assert.deepEqual(mirrorSnapshot(copy, 'Masa 05', new Date('2026-10-12T16:00:00Z'), h5).ordering, { open: false, reason: 'offline', call: false });
  assert.deepEqual(mirrorSnapshot(copy, 'Masa 05', new Date('2026-10-12T16:45:00Z'), h5).ordering, { open: false, reason: 'reserved', call: false, reservedFor: '20:00' });
  assert.deepEqual(mirrorSnapshot(copy, 'Masa 05', new Date('2026-10-13T02:00:00Z'), h5).ordering!.reason, 'offline', 'the window ends at 05:00 on the copy too');
  assert.equal(mirrorSnapshot(copy, 'Masa 06', new Date('2026-10-12T16:45:00Z'), tableHash(c.table('Masa 06').token)).ordering!.reason, 'offline');
  // 0 = off: no windows; no reservation service: no field at all (an older Merkez ignores the field either way).
  c.store.mutate('mola-demo', x => { x.reservationSettings = { holdMinutes: 0 }; });
  assert.deepEqual(mirrorHolds(c.store.read('mola-demo'), now), []);
  assert.equal('reserved' in buildMirror(s, c.store.directory, { menuOnly: false, demo: false, social: true, popular: [] }).menu, false);
});
