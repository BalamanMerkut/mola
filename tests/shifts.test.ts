import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { ShiftBook } from '../server/shifts.js';
import { distributeTips, lateMinutes, plannedStart, splitAmount, weekdayOf } from '../packages/domain/shifts.js';
import { licensed, temp } from './merkez-fixture.js';

test('late minutes against the planned start; tips split equally, by hours or to the order takers, kuruş exact', () => {
  const weekdays = { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] };
  assert.equal(weekdayOf('2026-10-05'), 1); assert.equal(weekdayOf('2026-10-04'), 7);
  assert.equal(lateMinutes({ day: '2026-10-05', startAt: '2026-10-05T06:12:40Z' }, weekdays), 12, '09:12 on a Monday');
  assert.equal(lateMinutes({ day: '2026-10-05', startAt: '2026-10-05T05:50:00Z' }, weekdays), 0, 'early is on time');
  assert.equal(lateMinutes({ day: '2026-10-04', startAt: '2026-10-04T06:30:00Z' }, weekdays), null, 'no plan on Sunday');
  assert.equal(lateMinutes({ day: '2026-10-05', startAt: '2026-10-05T06:30:00Z' }, undefined), null);
  assert.equal(plannedStart({ start: '02:00', end: '06:00', days: [1] }, '2026-10-05'), Date.parse('2026-10-06T02:00:00+03:00'), 'before 05:00 is the next morning of that cash day');

  assert.deepEqual([...splitAmount(1000, [['a', 1], ['b', 1], ['c', 1]])].sort(), [['a', 334], ['b', 333], ['c', 333]]);
  const workers = new Map([['2026-10-05', new Map([['ali', 360], ['ayse', 120]])], ['2026-10-06', new Map()]]);
  const tips = [{ amount: 1000, at: '2026-10-05T10:00:00Z', takers: [['ayse', 14000]] as [string, number][] }, { amount: 600, at: '2026-10-05T12:00:00Z', takers: [] as [string, number][] }, { amount: 500, at: '2026-10-06T12:00:00Z', takers: [] as [string, number][] }];
  const equal = distributeTips(tips, 'equal', workers), hours = distributeTips(tips, 'hours', workers), orders = distributeTips(tips, 'orders', workers);
  assert.deepEqual(Object.fromEntries(equal.shares), { ali: 800, ayse: 800 }); assert.equal(equal.unassigned, 500, 'a day nobody worked');
  assert.deepEqual(Object.fromEntries(hours.shares), { ali: 1200, ayse: 400 });
  assert.deepEqual(Object.fromEntries(orders.shares), { ayse: 1300, ali: 300 }, 'the taker gets her table\'s tip; a QR-only bill is shared equally');
  for (const d of [equal, hours, orders]) assert.equal([...d.shares.values()].reduce((n, v) => n + v, 0) + d.unassigned, 2100);
});

async function shiftCafe(t: { after: (fn: () => Promise<void>) => void }, start: string) {
  const directory = temp('shift-closing'), store = new Store(directory); licensed(store);
  let clock = new Date(start);
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client(username: string) {
    let cookie = '';
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
      return { status: r.status, data: await r.json() as any };
    };
    return Object.assign(call, { login: () => call('/login', { username, password: DEMO_PASSWORD }) });
  }
  const owner = client('isletme'), cashier = client('kasiyer'), waiter = client('garson');
  for (const c of [owner, cashier, waiter]) assert.equal((await c.login()).status, 200);
  assert.equal((await owner('/staff/cash/settings', { shiftTracking: true })).status, 200);
  const begin = async (c: typeof waiter) => { const code = (await owner('/staff/shifts/code')).data.code; const r = await c('/staff/shifts/start', { code }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  return { owner, cashier, waiter, begin, set: (iso: string) => { clock = new Date(iso); } };
}

test('gün sonu at night (02:00): only the closing cashier\'s own shift ends, after "Tamam"; the others run on until 05:00 (K-C)', async t => {
  const c = await shiftCafe(t, '2026-10-05T14:00:00Z'); // 17:00
  await c.begin(c.cashier);
  assert.equal((await c.cashier('/staff/cash/open', { requestId: randomUUID(), amount: 0 })).status, 200);
  c.set('2026-10-05T15:00:00Z'); await c.begin(c.waiter); // 18:00
  c.set('2026-10-05T23:00:00Z'); // 02:00 on 6 October, still the cash day of 5 October
  const count = (await c.cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 0 })).data;
  assert.equal(count.day, '2026-10-05');
  const finished = (await c.cashier('/staff/cash/finish', { id: count.id })).data;
  assert.equal(finished.closing.shiftsEnded, undefined, 'the waiter\'s shift is not ended by the gün sonu'); assert.equal(finished.ownShift, true);
  assert.ok((await c.waiter('/staff/shifts/me')).data.open, 'the waiter still serves the last tables');
  assert.equal((await c.waiter('/staff/orders', { requestId: randomUUID(), tableId: (await c.owner('/staff/state')).data.tables[0].id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 })).status, 200, 'no new code needed after the closing');
  // While the result is on screen the cashier may still work (print, read); then "Tamam".
  assert.ok((await c.cashier('/staff/shifts/me')).data.open);
  c.set('2026-10-05T23:02:00Z');
  assert.deepEqual((await c.cashier('/staff/cash/closing-shift', { id: count.id })).data, { ended: true });
  const own = (await c.owner('/staff/reports/staff-shifts?from=2026-10-05&to=2026-10-05')).data.rows.find((r: any) => r.id === 'kasiyer').shifts[0];
  assert.deepEqual([own.endKind, own.endAt], ['closing', '2026-10-05T23:02:00.000Z']);
  assert.deepEqual((await c.cashier('/staff/cash/closing-shift', { id: count.id })).data, { ended: false }, 'nothing left to end');
  // The waiter's shift ends at 05:00 if nobody ends it.
  c.set('2026-10-06T02:30:00Z');
  for (const x of [c.owner, c.waiter]) assert.equal((await x.login()).status, 200, 'the sign-ins ended at 05:00 too');
  assert.equal((await c.waiter('/staff/shifts/me')).data.open, null);
  const waiterShift = (await c.owner('/staff/reports/staff-shifts?from=2026-10-05&to=2026-10-05')).data.rows.find((r: any) => r.id === 'garson').shifts[0];
  assert.deepEqual([waiterShift.endKind, waiterShift.endAt], ['cutoff', '2026-10-06T02:00:00.000Z']);
});

test('closing yesterday\'s kasa in the morning leaves the shifts started today running', async t => {
  const c = await shiftCafe(t, '2026-10-05T14:00:00Z');
  await c.begin(c.cashier);
  assert.equal((await c.cashier('/staff/cash/open', { requestId: randomUUID(), amount: 0 })).status, 200);
  // Nobody closed the day. The next morning (09:00) both start new shifts, then the cashier closes yesterday's kasa.
  c.set('2026-10-06T06:00:00Z');
  for (const x of [c.owner, c.cashier, c.waiter]) await x.login();
  await c.begin(c.waiter); await c.begin(c.cashier);
  assert.deepEqual((await c.cashier('/staff/cash/status')).data.unclosedPrevious, { day: '2026-10-05' });
  c.set('2026-10-06T06:30:00Z');
  const count = (await c.cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 0 })).data;
  assert.equal(count.day, '2026-10-05', 'yesterday\'s kasa');
  const finished = (await c.cashier('/staff/cash/finish', { id: count.id })).data;
  assert.equal(finished.closing.shiftsEnded, undefined, 'no shift of today ends'); assert.equal(finished.ownShift, undefined);
  assert.ok((await c.waiter('/staff/shifts/me')).data.open, 'the waiter keeps working');
  assert.ok((await c.cashier('/staff/shifts/me')).data.open);
  assert.deepEqual((await c.cashier('/staff/cash/closing-shift', { id: count.id })).data, { ended: false });
  assert.ok((await c.cashier('/staff/shifts/me')).data.open, '"Tamam" on yesterday\'s result does not end today\'s shift');
  assert.equal((await c.waiter('/staff/orders', { requestId: randomUUID(), tableId: (await c.owner('/staff/state')).data.tables[0].id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 })).status, 200);
});

test('K-B (9 Ekim): turned on "Bir sonraki girişte" the people signed in keep working until they sign in again; "Hemen" stops them at once', async t => {
  const directory = temp('shift-next'), store = new Store(directory); licensed(store);
  let clock = new Date('2026-10-05T09:00:00Z');
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client() { let cookie = ''; return async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
    return { status: r.status, data: await r.json() as any };
  }; }
  const owner = client(), waiter = client(), kitchen = client(), later = client();
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  assert.deepEqual((await owner('/staff/shifts/working')).data, { count: 0 }, 'nobody but the owner');
  await waiter('/login', { username: 'garson', password: DEMO_PASSWORD }); await kitchen('/login', { username: 'mutfak', password: DEMO_PASSWORD });
  assert.deepEqual((await owner('/staff/shifts/working')).data, { count: 2 }, 'Şu an 2 kişi çalışıyor');
  assert.equal((await waiter('/staff/shifts/working')).status, 403);
  const table = (await owner('/staff/state')).data.tables[0];
  const order = (c: typeof waiter) => c('/staff/orders', { requestId: randomUUID(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
  clock = new Date('2026-10-05T09:05:00Z');
  assert.equal((await owner('/staff/cash/settings', { shiftTracking: true, shiftStart: 'next' })).status, 200);
  // The waiter signed in before: works on, his screen is not stopped.
  assert.equal((await order(waiter)).status, 200);
  const me = (await waiter('/staff/shifts/me')).data;
  assert.deepEqual([me.tracking, me.required, me.later], [true, false, true]);
  // A sign-in after it (another tablet, or the same waiter signing in again) asks for the code.
  clock = new Date('2026-10-05T09:06:00Z');
  await later('/login', { username: 'garson', password: DEMO_PASSWORD });
  assert.equal((await order(later)).data.code, 'SHIFT_REQUIRED');
  assert.equal((await later('/staff/shifts/me')).data.required, true);
  // Off and on again "Hemen": everyone signed in is stopped.
  assert.equal((await owner('/staff/cash/settings', { shiftTracking: false })).status, 200);
  assert.equal((await owner('/staff/cash/settings', { shiftTracking: true, shiftStart: 'now' })).status, 200);
  assert.equal((await order(waiter)).data.code, 'SHIFT_REQUIRED');
  assert.equal((await kitchen('/staff/shifts/me')).data.required, true);
});

test('vardiya takibi: blocked until the one-time code is typed, the code changes after each use, 5 wrong codes lock for 5 minutes, shifts end at the closing or 05:00', async t => {
  const directory = temp('shifts'), store = new Store(directory); licensed(store);
  let clock = new Date('2026-10-05T06:00:00Z');
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client() { let cookie = ''; return async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
    return { status: r.status, data: await r.json() as any };
  }; }
  const owner = client(), cashier = client(), waiter = client(), kitchen = client(), waiter2 = client();
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  assert.equal((await owner('/staff/users', { username: 'garson2', name: 'Ayşe', role: 'waiter', password: 'GarsonDeneme!26' })).status, 200);
  for (const [c, u] of [[cashier, 'kasiyer'], [waiter, 'garson'], [kitchen, 'mutfak']] as const) assert.equal((await c('/login', { username: u, password: DEMO_PASSWORD })).status, 200);
  await waiter2('/login', { username: 'garson2', password: 'GarsonDeneme!26' });
  const table = (await owner('/staff/state')).data.tables[0];
  const order = (c: typeof waiter) => c('/staff/orders', { requestId: randomUUID(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });

  // Off: nothing changes.
  assert.equal((await order(waiter)).status, 200);
  assert.equal((await waiter('/staff/shifts/me')).data.tracking, false);
  // Planned shift (09:00–17:00 weekdays) for the late-minute report; owner only.
  assert.equal((await waiter('/staff/shifts/plan', { userId: 'garson', plan: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] } })).status, 403);
  assert.equal((await owner('/staff/shifts/plan', { userId: 'garson', plan: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] } })).status, 200);
  assert.equal((await owner('/staff/shifts/plan', { userId: 'garson', plan: { start: '9', end: '17:00', days: [] } })).data.code, 'INVALID_PLAN');
  assert.equal((await cashier('/staff/cash/settings', { shiftTracking: true })).status, 403);
  assert.equal((await owner('/staff/cash/settings', { shiftTracking: true })).status, 200);

  // On: the waiter can read but not act until the shift starts.
  const blocked = await order(waiter);
  assert.equal(blocked.status, 403); assert.equal(blocked.data.code, 'SHIFT_REQUIRED');
  assert.equal((await waiter('/staff/state')).status, 200, 'reading stays allowed: the screen shows "Vardiyayı başlat"');
  assert.equal((await owner('/staff/tables/add', { requestId: randomUUID() })).status, 200, 'the owner is exempt');
  // The code lives at the counter only.
  assert.equal((await waiter('/staff/shifts/code')).status, 403); assert.equal((await kitchen('/staff/shifts/code')).status, 403);
  const first = (await cashier('/staff/shifts/code')).data.code;
  assert.match(first, /^\d{6}$/); assert.equal((await owner('/staff/shifts/code')).data.code, first);
  const wrong = first === '000000' ? '111111' : '000000';

  // Four wrong codes are told how many tries are left; the fifth locks for five minutes, even for the right code.
  clock = new Date('2026-10-05T06:12:00Z');
  for (let i = 4; i >= 1; i--) { const r = await waiter('/staff/shifts/start', { code: wrong }); assert.equal(r.status, 400); assert.match(r.data.message, new RegExp(`\\(${i} deneme kaldı\\)`)); }
  const locked = await waiter('/staff/shifts/start', { code: wrong });
  assert.equal(locked.status, 429); assert.equal(locked.data.code, 'SHIFT_LOCKED');
  assert.equal((await waiter('/staff/shifts/start', { code: first })).data.code, 'SHIFT_LOCKED');
  assert.ok((await waiter('/staff/shifts/me')).data.lockedUntil);
  // Someone else is not locked out by the waiter's guesses: the code works once, then a new one appears.
  const started2 = await waiter2('/staff/shifts/start', { code: first });
  assert.equal(started2.status, 200); assert.equal(started2.data.name, 'Ayşe');
  const second = (await cashier('/staff/shifts/code')).data.code;
  assert.notEqual(second, first, 'used once, then replaced');
  assert.equal((await kitchen('/staff/shifts/start', { code: first })).data.code, 'INVALID_SHIFT_CODE', 'a photo of the old code is useless');
  assert.equal((await order(waiter2)).status, 200);

  // After five minutes the waiter starts (12 minutes late against 09:00).
  clock = new Date('2026-10-05T06:17:30Z');
  const started = await waiter('/staff/shifts/start', { code: second });
  assert.equal(started.status, 200);
  assert.equal((await order(waiter)).status, 200);
  assert.equal((await waiter('/staff/shifts/me')).data.open.id, started.data.id);
  const third = (await cashier('/staff/shifts/code')).data;
  assert.deepEqual(third.open.map((x: any) => x.name).sort(), ['Ayşe', 'Garson']);
  // The cashier also needs a shift; the code is on the cashier's own counter screen.
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 0 })).data.code, 'SHIFT_REQUIRED');
  assert.equal((await cashier('/staff/shifts/start', { code: third.code })).status, 200);
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 0 })).status, 200);

  // Ending a shift takes a fresh code too.
  clock = new Date('2026-10-05T10:00:00Z');
  const fourth = (await owner('/staff/shifts/code')).data.code;
  const ended = await waiter2('/staff/shifts/end', { code: fourth });
  assert.equal(ended.status, 200); assert.equal(ended.data.endKind, 'manual');
  assert.equal((await order(waiter2)).data.code, 'SHIFT_REQUIRED');

  // The day's final closing ends only the closing person's shift (K-C, 9 Ekim); the waiter ends his own.
  clock = new Date('2026-10-05T19:00:00Z');
  const count = (await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 0 })).data;
  const finished = (await cashier('/staff/cash/finish', { id: count.id, note: 'Satış nakit değildi' })).data, done = finished.closing;
  assert.equal(done.shiftsEnded, undefined, 'the waiter\'s shift runs on; the closing cashier\'s own waits for the result to be closed');
  assert.equal(finished.ownShift, true);
  assert.ok((await waiter('/staff/shifts/me')).data.open);
  const waiterEnd = await waiter('/staff/shifts/end', { code: (await owner('/staff/shifts/code')).data.code });
  assert.equal(waiterEnd.status, 200); assert.equal(waiterEnd.data.endKind, 'manual');
  // The closing cashier still sees the result and prints the slip: no "Vardiyayı başlat" in the middle of it.
  assert.ok((await cashier('/staff/shifts/me')).data.open, 'still on shift while the result is on screen');
  assert.equal((await cashier('/staff/cash/print', { id: done.id })).data.code, 'NO_PRINTER', 'the slip is not refused with SHIFT_REQUIRED');
  // "Tamam" ends it, as a closing.
  assert.deepEqual((await cashier('/staff/cash/closing-shift', { id: done.id })).data, { ended: true });
  assert.equal((await cashier('/staff/shifts/me')).data.open, null);
  assert.equal((await cashier('/staff/cash/print', { id: done.id })).data.code, 'NO_PRINTER', 'and even after the shift ended');
  const report = (await owner('/staff/reports/staff-shifts?from=2026-10-05&to=2026-10-05')).data;
  const garson = report.rows.find((r: any) => r.id === 'garson');
  assert.equal(garson.shifts.length, 1); assert.equal(garson.shifts[0].late, 17, '09:17 against 09:00'); assert.equal(garson.shifts[0].endKind, 'manual');
  assert.equal(garson.lateCount, 1); assert.equal(garson.minutes, Math.round((Date.parse('2026-10-05T19:00:00Z') - Date.parse('2026-10-05T06:17:30Z')) / 60000));
  assert.ok(garson.orders >= 1);
  // The owner corrects a time; the earlier one stays with the shift.
  assert.equal((await owner('/staff/shifts/correct', { id: garson.shifts[0].id, startAt: '2026-10-05T06:00:00.000Z', endAt: '2026-10-05T14:00:00.000Z', note: 'Kapıda bekledi, kod ekranı kapalıydı' })).status, 200);
  const corrected = (await owner('/staff/reports/staff-shifts?from=2026-10-05&to=2026-10-05')).data.rows.find((r: any) => r.id === 'garson').shifts[0];
  assert.equal(corrected.late, 0); assert.equal(corrected.changes[0].before.startAt, '2026-10-05T06:17:30.000Z'); assert.equal(corrected.minutes, 480);

  // A shift nobody ended (no closing) ends at 05:00.
  clock = new Date('2026-10-05T20:00:00Z');
  const next = (await owner('/staff/shifts/code')).data.code;
  assert.equal((await kitchen('/staff/shifts/start', { code: next })).status, 200);
  const book = new ShiftBook(store);
  clock = new Date('2026-10-06T03:00:00Z');
  assert.equal(book.sweep('mola-demo', clock.getTime()), 1);
  const swept = book.range('mola-demo', '2026-10-05', '2026-10-05').find(s => s.userId === 'mutfak')!;
  assert.equal(swept.endKind, 'cutoff'); assert.equal(swept.endAt, '2026-10-06T02:00:00.000Z');

  // Off again: nothing is blocked.
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  assert.equal((await owner('/staff/cash/settings', { shiftTracking: false })).status, 200);
  await waiter('/login', { username: 'garson', password: DEMO_PASSWORD });
  assert.equal((await order(waiter)).status, 200);
  const estimated = (await owner('/staff/reports/staff-shifts?from=2026-10-06&to=2026-10-06')).data.rows.find((r: any) => r.id === 'garson');
  assert.equal(estimated.shifts.length, 0); assert.equal(estimated.estimatedMinutes, estimated.minutes, 'no shift that day: hours are "tahmini"');
});
