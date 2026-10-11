import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { preShiftBacklog, shiftRequired, shiftRolesOf } from '../packages/domain/shifts.js';
import { assignmentText, assignmentView, ringsHere, waitersOf } from '../packages/domain/assignments.js';
import { assignmentRings, orderAlerts } from '../src/ServiceCallBar.js';
import type { PublicOrder, StaffSnapshot } from '../packages/domain/types.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * Vardiya per role (Ayarlar: Garson · Kasiyer · Mutfak · Müdür), the one-time "Vardiya başlamadan N sipariş geldi" count,
 * and garson masa/bölüm ataması (only the responsible waiter's phone rings; unassigned tables ring for all).
 */
const rid = () => randomUUID().replace(/-/g, '');
async function cafe(t: { after: (fn: () => Promise<void>) => void }) {
  const store = new Store(temp('shift-roles')); licensed(store);
  let clock = new Date('2026-10-05T07:00:00Z');
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client(username: string, password = DEMO_PASSWORD) {
    let cookie = '';
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
      return { status: r.status, data: await r.json().catch(() => ({})) as any };
    };
    return Object.assign(call, { login: () => call('/login', { username, password }) });
  }
  const owner = client('isletme'), cashier = client('kasiyer'), waiter = client('garson'), kitchen = client('mutfak');
  for (const c of [owner, cashier, waiter, kitchen]) assert.equal((await c.login()).status, 200);
  for (const [username, role] of [['mudur', 'manager'], ['garson2', 'waiter']] as const) assert.equal((await owner('/staff/users', { username, name: username === 'mudur' ? 'Müdür' : 'Ayşe', role, password: 'DenemeSifre!2026' })).status, 200);
  const manager = client('mudur', 'DenemeSifre!2026'), waiter2 = client('garson2', 'DenemeSifre!2026');
  for (const c of [manager, waiter2]) assert.equal((await c.login()).status, 200);
  return { owner, cashier, waiter, waiter2, kitchen, manager, set: (iso: string) => { clock = new Date(iso); } };
}
const order = (who: (p: string, b?: unknown) => Promise<{ status: number; data: any }>, tableId: string) => who('/staff/orders', { requestId: rid(), tableId, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });

test('vardiya per role: plain rules (missing = every role, the owner never)', () => {
  assert.deepEqual(shiftRolesOf(undefined), ['waiter', 'cashier', 'kitchen', 'manager']);
  assert.deepEqual(shiftRolesOf({ shiftRoles: ['kitchen', 'waiter'] }), ['waiter', 'kitchen'], 'kept in the fixed order');
  assert.equal(shiftRequired({ shiftTracking: false }, 'waiter'), false);
  assert.equal(shiftRequired({ shiftTracking: true }, 'manager'), true);
  assert.equal(shiftRequired({ shiftTracking: true, shiftRoles: ['waiter'] }, 'cashier'), false);
  assert.equal(shiftRequired({ shiftTracking: true }, 'owner'), false);
});

test('vardiya per role: only ticked roles wait for the code; unticked ones work and get "tahmini" hours; owner only', async t => {
  const c = await cafe(t), table = (await c.owner('/staff/state')).data.tables[0];
  assert.equal((await c.owner('/staff/cash/settings', { shiftTracking: true })).status, 200);
  assert.deepEqual((await c.owner('/staff/shifts/roles')).data, { tracking: true, roles: ['waiter', 'cashier', 'kitchen', 'manager'] }, 'all four until the owner unticks');
  for (const who of [c.manager, c.cashier, c.waiter]) assert.equal((await who('/staff/shifts/roles', { roles: [] })).status, 403);
  assert.equal((await order(c.manager, table.id)).data.code, 'SHIFT_REQUIRED', 'the Müdür is gated by default too');
  const saved = await c.owner('/staff/shifts/roles', { roles: ['waiter', 'kitchen'] });
  assert.deepEqual(saved.data, { tracking: true, roles: ['waiter', 'kitchen'] });
  assert.equal((await c.owner('/staff/shifts/roles', { roles: ['owner'] })).status, 400, 'the owner is never a shift role');
  // Ticked: still gated. Unticked: works without the gate.
  assert.equal((await order(c.waiter, table.id)).data.code, 'SHIFT_REQUIRED');
  assert.equal((await order(c.cashier, table.id)).status, 200);
  assert.equal((await order(c.manager, table.id)).status, 200);
  const me = async (who: typeof c.owner) => (await who('/staff/shifts/me')).data;
  assert.deepEqual([(await me(c.waiter)).required, (await me(c.cashier)).required, (await me(c.kitchen)).required, (await me(c.manager)).required], [true, false, true, false]);
  // The cash settings keep the choice when other settings change; turning tracking off frees everyone.
  assert.equal((await c.owner('/staff/cash/settings', { tipRule: 'hours' })).status, 200);
  assert.deepEqual((await c.owner('/staff/shifts/roles')).data.roles, ['waiter', 'kitchen']);
  assert.equal((await c.owner('/staff/cash/settings', { shiftTracking: false })).status, 200);
  assert.equal((await order(c.waiter, table.id)).status, 200);
  assert.equal((await me(c.waiter)).required, false);
  // Hours: the cashier never started a shift, so the report estimates them ("tahmini").
  c.set('2026-10-05T09:00:00Z'); await order(c.cashier, table.id);
  const row = (await c.owner('/staff/reports/staff-shifts?from=2026-10-05&to=2026-10-05')).data.rows.find((r: any) => r.id === 'kasiyer');
  assert.ok(row.minutes >= 120); assert.equal(row.estimatedMinutes, row.minutes);
});

test('pre-shift notice: counts what waited for this role before the shift started, with one sound of the right kind', () => {
  const start = '2026-10-05T09:00:00.000Z', before = '2026-10-05T08:30:00.000Z', after = '2026-10-05T09:05:00.000Z';
  const o = (status: string, createdAt: string, extra: object = {}) => ({ status, createdAt, ...extra });
  const orders = [o('new', before), o('new', before), o('new', after), o('awaiting_approval', before), o('ready', before, { accountId: 'a1' }), o('ready', before, { accountId: 'a2' }), o('new', before, { external: { platform: 'getir' } })];
  assert.deepEqual(preShiftBacklog('kitchen', start, orders), { count: 4 + 0, event: 'kitchen' }, 'two new, one platform, one to approve; the order after the start rings normally');
  assert.deepEqual(preShiftBacklog('kitchen', start, [o('awaiting_approval', before)]), { count: 1, event: 'approval' });
  assert.deepEqual(preShiftBacklog('waiter', start, orders), { count: 3, event: 'ready' });
  assert.deepEqual(preShiftBacklog('waiter', start, orders, [], x => x.accountId !== 'a2'), { count: 2, event: 'ready' }, 'garson ataması: another waiter\'s table is left out');
  assert.deepEqual(preShiftBacklog('cashier', start, orders, [{ stage: 'pending', receivedAt: before }, { stage: 'accepted', receivedAt: before }, { stage: 'pending', receivedAt: after }]), { count: 1, event: 'externalOrder' });
  assert.deepEqual(preShiftBacklog('manager', start, orders), { count: 1, event: 'approval' });
  assert.deepEqual(preShiftBacklog('waiter', start, [o('new', before)]), { count: 0, event: null }, 'nothing for the waiter: no notice, no sound');
});

test('garson ataması: plain rules (sections, tables, unassigned tables ring for everyone)', () => {
  const tables = [{ id: 't1', area: 'inside' }, { id: 't2', area: 'inside' }, { id: 't3', area: 'outside' }, { id: 't4' }, { id: 'e1', event: { id: 'e' } }];
  const a = { enabled: true, waiters: { ali: { areas: ['inside'] }, ayse: { tables: ['t3', 't2'] } } };
  assert.deepEqual(waitersOf(a, tables[1]), ['ali', 'ayse']);
  assert.deepEqual(waitersOf(a, tables[4]), [], 'event tables are nobody\'s');
  assert.deepEqual(waitersOf({ ...a, enabled: false }, tables[0]), [], 'off: nobody is responsible');
  assert.deepEqual(assignmentView(a, tables, 'ali'), { mine: ['t1', 't2'], covered: ['t1', 't2', 't3'] });
  assert.equal(assignmentView({ waiters: a.waiters }, tables, 'ali'), undefined);
  const ali = assignmentView(a, tables, 'ali');
  assert.deepEqual(['t1', 't3', 't4', undefined].map(id => ringsHere(ali, id)), [true, false, true, true]);
  assert.equal(ringsHere(undefined, 't3'), true, 'off: everything rings');
  assert.equal(assignmentText({ areas: ['inside'], tables: ['t4'] }, id => ({ t4: 'Masa 04' } as Record<string, string>)[id], x => x === 'inside' ? 'İç masalar' : x), 'İç masalar, Masa 04');
});

test('garson ataması: "Sipariş hazır" rings only on the responsible waiter\'s phone; the others note it quietly', () => {
  const view = { mine: ['t1'], covered: ['t1', 't2'] };
  const data = { assignment: view, tables: [{ id: 't1', account: { id: 'a1' } }, { id: 't2', account: { id: 'a2' } }, { id: 't3', account: { id: 'a3' } }], takeaways: [], eventTables: [] } as unknown as StaffSnapshot;
  const rings = assignmentRings(data)!;
  const ready = (id: string, accountId: string) => ({ id, status: 'ready', accountId, tableName: id, lines: [] }) as unknown as PublicOrder;
  const run = (orders: PublicOrder[]) => { const done: PublicOrder[] = []; const events = orderAlerts(orders, 'waiter', new Set(), [], false, done, rings); return { events, done: done.map(o => o.id) }; };
  assert.deepEqual(run([ready('mine', 'a1')]), { events: ['ready'], done: ['mine'] });
  assert.deepEqual(run([ready('theirs', 'a2')]), { events: [], done: [] }, 'another waiter\'s table: no sound, no note, no vibration');
  assert.deepEqual(run([ready('free', 'a3')]), { events: ['ready'], done: ['free'] }, 'nobody\'s table rings for every waiter');
  assert.equal(assignmentRings({ ...data, assignment: undefined }), undefined, 'off: today\'s behaviour');
  // The Müdür hears what the owner hears: approvals and platform orders, never "hazır".
  assert.deepEqual(orderAlerts([{ id: 'q', status: 'awaiting_approval', accountId: 'a1', tableName: 'x', lines: [] } as unknown as PublicOrder, ready('r', 'a1')], 'manager', new Set()), ['approval']);
});

test('garson ataması: owner-only settings, and each waiter\'s snapshot carries its own tables only while on', async t => {
  const c = await cafe(t), tables = (await c.owner('/staff/state')).data.tables;
  for (const who of [c.manager, c.cashier, c.waiter, c.kitchen]) { assert.equal((await who('/staff/assignments')).status, 403); assert.equal((await who('/staff/assignments', { enabled: true })).status, 403); }
  const view = (await c.owner('/staff/assignments')).data;
  assert.equal(view.enabled, false); assert.deepEqual(view.waiters.map((w: any) => w.id).sort(), ['garson', view.waiters.find((w: any) => w.name === 'Ayşe').id].sort());
  const ayse = view.waiters.find((w: any) => w.name === 'Ayşe').id;
  assert.equal((await c.owner('/staff/assignments', { waiter: { id: ayse, areas: [], tables: [tables[0].id, tables[1].id] } })).status, 200);
  assert.equal((await c.waiter2('/staff/state')).data.assignment, undefined, 'saved but off: nothing changes');
  assert.equal((await c.owner('/staff/assignments', { enabled: true })).status, 200);
  assert.deepEqual((await c.waiter2('/staff/state')).data.assignment, { mine: [tables[0].id, tables[1].id], covered: [tables[0].id, tables[1].id] });
  assert.deepEqual((await c.waiter('/staff/state')).data.assignment, { mine: [], covered: [tables[0].id, tables[1].id] });
  assert.equal((await c.cashier('/staff/state')).data.assignment, undefined, 'the counter is not affected');
  assert.equal((await c.owner('/staff/assignments', { waiter: { id: 'kasiyer', areas: [], tables: [] } })).status, 404, 'only waiters');
  assert.equal((await c.owner('/staff/assignments', { waiter: { id: ayse, areas: ['Çatı'], tables: [] } })).status, 409, 'an unknown section');
  // A closed account does not ring anyone: its tables count as nobody's.
  const disabled = (await c.owner('/staff/users')).data.find((u: any) => u.id === ayse);
  await c.owner('/staff/users/update', { id: ayse, version: disabled.version, role: 'waiter', active: false });
  assert.deepEqual((await c.waiter('/staff/state')).data.assignment, { mine: [], covered: [] });
});
