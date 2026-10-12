import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { seed } from '../server/seed.js';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { submitOrder } from '../packages/domain/engine.js';
import { requestServiceCall, resolveServiceCall } from '../packages/domain/service-calls.js';
import { checkTable, dueReminders, reminderText } from '../packages/domain/table-reminders.js';
import { orderedAreas, sameArea, sectionHeading } from '../packages/domain/table-sections.js';
import { splitReady } from '../src/ServiceCallBar.js';
import type { Actor, PublicOrder, State } from '../packages/domain/types.js';
import { client, licensed, temp } from './merkez-fixture.js';

/*
 * Hafta sonu bulguları (11 Ekim), garson tarafı: 4 uzun süredir sipariş verilmeyen masa hatırlatması, 6 garson ataması ve
 * masa bölümleri/sırası, 9 garsonun masa birleştirmesi. (5 garsonun sipariş değiştirmesi: tests/order-change.test.ts; 1 yazıcı
 * durumu: tests/kitchen-tickets.test.ts.)
 */
const T = 'mola-demo';
const t0 = Date.parse('2026-10-11T18:00:00Z'), min = (m: number) => new Date(t0 + m * 60_000);
const ctx = (m = 0) => ({ now: min(m), id: randomUUID });
const waiter: Actor = { tenantId: T, id: 'waiter', role: 'waiter' };
const tea = { productId: 'tea', quantity: 1, selections: [] };
function servedTable(s: State, table = 'table-1', m = 0) {
  const r = submitOrder(s, waiter, { requestId: randomUUID(), tableId: table, lines: [tea], expectedTotal: 3500 }, ctx(m));
  s.orders.find(o => o.id === r.orderId)!.status = 'served';
  return r;
}

test('4: a table quiet for 45 minutes reminds the waiter once; "Gittim", a call and an open kitchen order hold it back', () => {
  const s = seed(); servedTable(s);
  assert.deepEqual(dueReminders(s, min(44).getTime()), []);
  const [r] = dueReminders(s, min(46).getTime());
  assert.equal(r.tableId, 'table-1'); assert.equal(r.minutes, 46); assert.equal(r.since, min(0).toISOString());
  assert.equal(reminderText(r), 'Masa 01: 46 dakikadır yeni sipariş yok. Bir isteği var mı?');
  // Off, or another length.
  s.tableReminderMinutes = 0; assert.deepEqual(dueReminders(s, min(300).getTime()), []);
  s.tableReminderMinutes = 20; assert.equal(dueReminders(s, min(21).getTime()).length, 1); delete s.tableReminderMinutes;
  // "Gittim" at minute 46: quiet again until minute 91.
  checkTable(s, 'table-1', 0, min(46).toISOString());
  assert.deepEqual(dueReminders(s, min(90).getTime()), []);
  assert.equal(dueReminders(s, min(92).getTime())[0].since, min(46).toISOString());
  // The guest asked for the bill: that call rings by itself, no reminder.
  const guest: Actor = { tenantId: T, id: 'g1', role: 'guest', tableId: 'table-1', epoch: 0 };
  const bill = requestServiceCall(s, guest, { requestId: randomUUID(), kind: 'bill' }, ctx(100));
  assert.deepEqual(dueReminders(s, min(200).getTime()), []);
  // Answering a call counts as going to the table.
  resolveServiceCall(s, waiter, { callId: bill.callId }, ctx(150));
  assert.deepEqual(dueReminders(s, min(190).getTime()), []);
  assert.equal(dueReminders(s, min(196).getTime()).length, 1);
  // A new order still in the kitchen: not now.
  submitOrder(s, waiter, { requestId: randomUUID(), tableId: 'table-1', lines: [tea], expectedTotal: 3500 }, ctx(197));
  assert.deepEqual(dueReminders(s, min(400).getTime()), []);
  // Garson ataması: another waiter's table is not this waiter's reminder; his own and nobody's are.
  const s2 = seed(); servedTable(s2, 'table-1'); servedTable(s2, 'table-2');
  const view = { mine: ['table-2'], covered: ['table-1', 'table-2'] };
  assert.deepEqual(dueReminders(s2, min(60).getTime(), view).map(r => r.tableId), ['table-2']);
  assert.deepEqual(dueReminders(s2, min(60).getTime(), { mine: [], covered: [] }).map(r => r.tableId), ['table-1', 'table-2']);
});

test('6a: with garson ataması the waiter counts and lists his own ready orders; another waiter\'s ones only behind a button', () => {
  const ready = (id: string, accountId: string) => ({ id, accountId, status: 'ready' } as PublicOrder);
  const orders = [ready('a', 'acc-1'), ready('b', 'acc-2'), ready('c', 'acc-3')];
  const rings = (_t?: string, account?: string) => account !== 'acc-2';
  assert.deepEqual(splitReady(orders, 'waiter', rings), { mine: [orders[0], orders[2]], others: [orders[1]] });
  assert.deepEqual(splitReady(orders, 'waiter', undefined).others, [], 'switch off: everything is everyone\'s');
  assert.deepEqual(splitReady(orders, 'cashier', rings).others, [], 'the counter keeps the whole list');
});

test('6b: section order and names (İç, Dış, the owner\'s own, bölümsüz last)', () => {
  const tables = [{ area: 'Bahçe' }, {}, { area: 'inside' }, { area: 'outside' }];
  assert.deepEqual(orderedAreas(tables), ['inside', 'outside', 'Bahçe', '']);
  assert.deepEqual(orderedAreas(tables, ['', 'Bahçe']), ['', 'Bahçe', 'inside', 'outside']);
  assert.deepEqual(orderedAreas([{}, {}]), ['']);
  assert.equal(sectionHeading('Bahçe', true), 'Bahçe masaları'); assert.equal(sectionHeading('', true), 'Bölümsüz masalar'); assert.equal(sectionHeading('', false), '');
  assert.equal(sameArea(['inside', 'Üst kat'], 'üst kat'), 'Üst kat'); assert.equal(sameArea(['inside'], 'iç'), 'inside'); assert.equal(sameArea(['inside'], 'Teras'), undefined);
});

async function server(t: { after: (fn: () => Promise<void>) => void }, name: string) {
  // A start at least an hour clear of 05:00: the tests move the clock forward and would otherwise end the business day.
  const now = Date.now(), hour = new Date(now).getHours();
  const store = new Store(temp(name)); let clock = hour >= 3 && hour < 5 ? now + 3 * 3600_000 : now;
  licensed(store); const http = createServer(createApp(store, () => new Date(clock)));
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  t.after(async () => { http.closeAllConnections(); await new Promise<void>(r => http.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api`;
  const [w, k, c, o] = [client(base), client(base), client(base), client(base)];
  for (const [call, username] of [[w, 'garson'], [k, 'mutfak'], [c, 'kasiyer'], [o, 'isletme']] as const) assert.equal((await call('/login', { username, password: DEMO_PASSWORD })).status, 200);
  store.mutate(T, s => { s.setupCompleted = true; });
  return { store, w, k, c, o, tick: (minutes: number) => { clock += minutes * 60_000; } };
}

test('4 HTTP: the owner sets the minutes; only waiters get the reminder, only the responsible one; "Gittim" clears it', async t => {
  const { store, w, c, k, o, tick } = await server(t, 'reminder-api');
  assert.equal((await o('/staff/table-reminder', { minutes: 5 })).status, 400);
  assert.equal((await w('/staff/table-reminder', { minutes: 30 })).status, 403);
  assert.equal((await o('/staff/table-reminder', { minutes: 30 })).data.minutes, 30);
  assert.equal((await o('/staff/state')).data.tableReminderMinutes, 30);
  assert.equal((await w('/staff/orders', { requestId: randomUUID(), tableId: 'table-1', lines: [tea], expectedTotal: 3500 })).status, 200);
  store.mutate(T, s => { for (const x of s.orders) x.status = 'served'; });
  tick(31);
  const state = (await w('/staff/state')).data;
  assert.equal(state.tableReminders.length, 1); assert.equal(state.tableReminders[0].tableName, 'Masa 01');
  assert.equal((await c('/staff/state')).data.tableReminders, undefined, 'the counter does not get it');
  assert.equal((await k('/staff/tables/checked', { tableId: 'table-1', epoch: 0 })).status, 403);
  assert.equal((await w('/staff/tables/checked', { tableId: 'table-1', epoch: 0 })).status, 200);
  assert.equal((await w('/staff/state')).data.tableReminders, undefined);
  assert.ok(store.auditLog(T).some(a => a.action === 'table.checked' && a.target === 'table-1'));
  // Garson ataması: the table belongs to another (active) waiter, so this waiter is not reminded.
  tick(31);
  store.mutate(T, s => { const me = s.staffUsers!.find(u => u.username === 'garson')!; s.staffUsers!.push({ ...me, id: 'waiter-2', username: 'garson2', name: 'Ayşe' }); s.waiterAssignments = { enabled: true, waiters: { 'waiter-2': { tables: ['table-1'] } } }; });
  assert.equal((await w('/staff/state')).data.tableReminders, undefined);
  store.mutate(T, s => { s.waiterAssignments = { enabled: true, waiters: { [s.staffUsers!.find(u => u.username === 'garson')!.id]: { tables: ['table-1'] } } }; });
  assert.equal((await w('/staff/state')).data.tableReminders.length, 1);
});

test('6b HTTP: the owner reorders tables and sections and renames a section; garson ataması follows the new name', async t => {
  const { store, w, o } = await server(t, 'table-layout-api');
  const rev = () => store.read(T).businessRevision ?? 0;
  for (const id of ['table-1', 'table-2']) assert.equal((await o('/staff/tables/area', { requestId: randomUUID(), tableId: id, version: rev(), area: 'Bahçe' })).status, 200);
  assert.equal((await o('/staff/tables/area', { requestId: randomUUID(), tableId: 'table-3', version: rev(), area: 'bahçe' })).status, 200);
  assert.equal(store.read(T).tables[2].area, 'Bahçe', 'the same section typed again is not a second one');
  const garson = store.read(T).staffUsers!.find(u => u.username === 'garson')!.id;
  assert.equal((await o('/staff/assignments', { enabled: true, waiter: { id: garson, areas: ['Bahçe'], tables: [] } })).status, 200);
  const ids = store.read(T).tables.map(x => x.id), reversed = [...ids].reverse();
  assert.equal((await w('/staff/tables/layout', { requestId: randomUUID(), version: rev(), tables: reversed, areas: [] })).status, 403);
  assert.equal((await o('/staff/tables/layout', { requestId: randomUUID(), version: rev() - 1, tables: reversed, areas: [] })).status, 409);
  assert.equal((await o('/staff/tables/layout', { requestId: randomUUID(), version: rev(), tables: reversed.slice(1), areas: [] })).status, 409);
  assert.equal((await o('/staff/tables/layout', { requestId: randomUUID(), version: rev(), tables: reversed, areas: ['Nope'] })).status, 409);
  assert.equal((await o('/staff/tables/layout', { requestId: randomUUID(), version: rev(), tables: reversed, areas: ['', 'Bahçe'] })).status, 200);
  let state = (await w('/staff/state')).data;
  assert.deepEqual(state.tables.map((x: { id: string }) => x.id), reversed); assert.deepEqual(state.areaOrder, ['', 'Bahçe']);
  // Rename: every table of the section, the waiter's assignment and the order follow.
  assert.equal((await o('/staff/tables/area-rename', { requestId: randomUUID(), version: rev(), from: 'Bahçe', to: '  Teras ' })).data.area, 'Teras');
  const s = store.read(T);
  assert.deepEqual(s.tables.filter(x => x.area).map(x => x.area), ['Teras', 'Teras', 'Teras']);
  assert.deepEqual(s.waiterAssignments?.waiters?.[garson]?.areas, ['Teras']); assert.deepEqual(s.areaOrder, ['', 'Teras']);
  assert.equal((await o('/staff/tables/area-rename', { requestId: randomUUID(), version: rev(), from: 'Teras', to: 'teras' })).data.code, 'NO_CHANGE');
  assert.equal((await o('/staff/tables/area-rename', { requestId: randomUUID(), version: rev(), from: 'Yok', to: 'X' })).status, 404);
  assert.ok(store.auditLog(T).some(a => a.action === 'table.area_renamed' && a.target === 'Bahçe->Teras'));
  assert.ok(store.auditLog(T).some(a => a.action === 'table.layout_changed'));
  state = (await w('/staff/state')).data;
  assert.equal(state.assignment.mine.length, 3, 'the waiter still has the renamed section');
});

test('9 HTTP: the waiter joins two tables for a large group, recorded like the cashier\'s; the kitchen cannot', async t => {
  const { store, w, k } = await server(t, 'waiter-merge-api');
  for (const table of ['table-1', 'table-2']) assert.equal((await w('/staff/orders', { requestId: randomUUID(), tableId: table, lines: [tea], expectedTotal: 3500 })).status, 200);
  const state = (await w('/staff/state')).data, [a, b] = ['table-1', 'table-2'].map(id => state.tables.find((x: { id: string }) => x.id === id).account);
  const body = { requestId: randomUUID(), sourceId: a.id, sourceVersion: a.version, targetId: b.id, targetVersion: b.version };
  assert.equal((await k('/staff/accounts/merge', { ...body, requestId: randomUUID() })).status, 403);
  const merged = await w('/staff/accounts/merge', body);
  assert.equal(merged.status, 200); assert.equal(merged.data.tableName, 'Masa 02'); assert.equal(merged.data.total, 7000);
  const s = store.read(T);
  assert.equal(s.tables[0].accountId, null);
  assert.ok(store.auditLog(T).some(x => x.action === 'accounts.merged' && x.actor === s.staffUsers!.find(u => u.username === 'garson')!.id));
});
