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
import { closeEmptyAccount, DomainError, moveTable, recordPayment, setStatus, submitOrder, submitTakeaway } from '../packages/domain/engine.js';
import { mergeAccounts } from '../packages/domain/merge.js';
import { billTicket, kitchenTicket, renderText, type PrinterConfig } from '../packages/domain/printing.js';
import { takeawayLabel, takeawayStage } from '../packages/domain/takeaway.js';
import type { Actor, State } from '../packages/domain/types.js';

const at = (iso: string) => ({ now: new Date(iso), id: randomUUID });
const owner: Actor = { tenantId: 'mola-demo', id: 'owner', role: 'owner' };
const cashier: Actor = { ...owner, id: 'cashier', role: 'cashier' };
const waiter: Actor = { ...owner, id: 'waiter', role: 'waiter' };
const kitchen: Actor = { ...owner, id: 'kitchen', role: 'kitchen' };
const tea = (quantity = 1) => ({ lines: [{ productId: 'tea', quantity, selections: [] }], expectedTotal: 3500 * quantity });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return 'NO_ERROR'; };
function business(): State { const s = seed(); s.changeSeconds = 0; return s; }
const printer: PrinterConfig = { id: 'p', name: 'Mutfak', enabled: true, connection: { type: 'network', host: '192.168.1.50', port: 9100 }, width: 58, charset: 'ascii', orders: true, categories: [], bill: true, createdAt: '2026-10-01T00:00:00Z' };

test('ticket numbers count per business day (Turkish date) and retries never open a second ticket', () => {
  const s = business(), floor = s.tables.length;
  const first = { requestId: randomUUID(), label: '  Ahmet ', ...tea() };
  const a = submitTakeaway(s, cashier, first, at('2026-10-02T08:00:00Z'));
  assert.deepEqual(submitTakeaway(s, cashier, first, at('2026-10-02T08:00:05Z')), a, 'same request id answers the same ticket');
  const b = submitTakeaway(s, waiter, { requestId: randomUUID(), ...tea() }, at('2026-10-02T20:59:00Z'));
  // 21:00 UTC is midnight in Türkiye: a new business day starts again at #1.
  const c = submitTakeaway(s, owner, { requestId: randomUUID(), ...tea() }, at('2026-10-02T21:01:00Z'));
  assert.deepEqual([a.takeawayNumber, b.takeawayNumber, c.takeawayNumber], [1, 2, 1]);
  assert.deepEqual(s.tables.filter(t => t.takeaway).map(t => t.name), ['Masasız #1', 'Masasız #2', 'Masasız #1']);
  assert.equal(s.tables.find(t => t.id === a.tableId)!.takeaway!.label, 'Ahmet');
  assert.equal(s.tables.filter(t => !t.takeaway).length, floor, 'floor plan unchanged');
  assert.ok(s.tables.filter(t => t.takeaway).every(t => t.token === '' && !t.area));
  assert.equal(s.orders.length, 3); assert.ok(s.orders.every(o => o.source === 'staff' && o.status === 'new'));
});

test('labels refuse phone numbers; unknown roles and failed orders leave nothing behind; an old "off" switch is ignored', () => {
  assert.equal(takeawayLabel('0532 123 45 67'), null); assert.equal(takeawayLabel('Ayşe@mail'), null); assert.equal(takeawayLabel('x'.repeat(25)), null);
  assert.equal(takeawayLabel('Masa 12 Ali'), 'Masa 12 Ali'); assert.equal(takeawayLabel('   '), undefined);
  const s = business(), before = structuredClone(s);
  assert.equal(code(() => submitTakeaway(s, cashier, { requestId: randomUUID(), label: '05321234567', ...tea() }, at('2026-10-02T08:00:00Z'))), 'INVALID_LABEL');
  assert.equal(code(() => submitTakeaway(s, kitchen, { requestId: randomUUID(), ...tea() }, at('2026-10-02T08:00:00Z'))), 'FORBIDDEN');
  assert.equal(code(() => submitTakeaway(s, cashier, { requestId: randomUUID(), lines: tea().lines, expectedTotal: 1 }, at('2026-10-02T08:00:00Z'))), 'PRICE_CHANGED');
  assert.deepEqual(s, before, 'a refused basket uses no number and leaves no ticket');
  // Data saved while "Al götür satışı" was a setting may still say off: masasız sales are always available now.
  s.takeawayEnabled = false;
  assert.equal(submitTakeaway(s, cashier, { requestId: randomUUID(), ...tea() }, at('2026-10-02T08:00:00Z')).tableName, 'Masasız #1');
});

test('lifecycle: kitchen, more items, pay at the counter, handed over, closed for good; no cleaning, no QR guest', () => {
  const s = business(); s.cleaningEnabled = true;
  const t = submitTakeaway(s, cashier, { requestId: randomUUID(), label: 'Zeynep', ...tea(2) }, at('2026-10-02T09:00:00Z'));
  const table = s.tables.find(x => x.id === t.tableId)!;
  submitOrder(s, cashier, { requestId: randomUUID(), tableId: t.tableId, lines: [{ productId: 'cheesecake', quantity: 1, selections: [], note: 'Çatal koymayın' }], expectedTotal: 19000 }, at('2026-10-02T09:01:00Z'));
  assert.equal(code(() => submitOrder(s, { ...owner, id: 'g', role: 'guest', tableId: t.tableId, epoch: 0 }, { requestId: randomUUID(), tableId: t.tableId, ...tea() }, at('2026-10-02T09:01:00Z'))), 'FORBIDDEN');
  for (const o of s.orders) { setStatus(s, kitchen, o.id, o.version, 'preparing', new Date('2026-10-02T09:02:00Z')); setStatus(s, kitchen, o.id, o.version, 'ready', new Date('2026-10-02T09:05:00Z')); }
  assert.equal(takeawayStage(s.orders), 'ready');
  const account = s.accounts.find(a => a.id === t.accountId)!;
  const paid = recordPayment(s, cashier, { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'cash', amount: 26000, tendered: 30000 }, at('2026-10-02T09:06:00Z'));
  assert.equal(paid.closed, true); assert.equal(paid.change, 4000);
  // Paying for a ready bag at the counter hands it over: the ticket is finished and leaves the strip.
  assert.ok(s.orders.every(o => o.status === 'served')); assert.equal(takeawayStage(s.orders), 'served');
  assert.equal(table.accountId, null); assert.equal(table.needsCleaning, false, 'takeaway tickets never wait for cleaning');
  assert.equal(s.archives[0].tableName, 'Masasız #1'); assert.equal(s.archives[0].total, 26000);
  assert.equal(code(() => submitOrder(s, cashier, { requestId: randomUUID(), tableId: t.tableId, ...tea() }, at('2026-10-02T09:07:00Z'))), 'TAKEAWAY_CLOSED');
  const text = renderText(billTicket(s, account.id, new Date('2026-10-02T09:06:00Z')), printer).join('\n');
  assert.match(text, /Masasız #1/);
});

test('paid in advance: the ticket stays until handed over; the cashier may hand over takeaway bags only', () => {
  const s = business();
  const t = submitTakeaway(s, cashier, { requestId: randomUUID(), ...tea() }, at('2026-10-02T09:00:00Z'));
  const table = submitOrder(s, cashier, { requestId: randomUUID(), tableId: 'table-1', ...tea() }, at('2026-10-02T09:00:00Z'));
  const account = s.accounts.find(a => a.id === t.accountId)!;
  recordPayment(s, cashier, { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'card', amount: 3500, tendered: 3500 }, at('2026-10-02T09:01:00Z'));
  const bag = s.orders.find(o => o.id === t.orderId)!;
  assert.equal(account.status, 'closed'); assert.equal(bag.status, 'new', 'paying early does not skip the kitchen');
  setStatus(s, kitchen, bag.id, bag.version, 'preparing', new Date('2026-10-02T09:02:00Z')); setStatus(s, kitchen, bag.id, bag.version, 'ready', new Date('2026-10-02T09:04:00Z'));
  setStatus(s, cashier, bag.id, bag.version, 'served', new Date('2026-10-02T09:05:00Z'));
  assert.equal(bag.status, 'served');
  const dine = s.orders.find(o => o.id === table.orderId)!;
  setStatus(s, kitchen, dine.id, dine.version, 'preparing', new Date('2026-10-02T09:02:00Z')); setStatus(s, kitchen, dine.id, dine.version, 'ready', new Date('2026-10-02T09:04:00Z'));
  assert.equal(code(() => setStatus(s, cashier, dine.id, dine.version, 'served', new Date('2026-10-02T09:05:00Z'))), 'FORBIDDEN', 'tables are still served by waiters');
});

test('takeaway tickets never move or merge with tables; an emptied ticket closes without cleaning', () => {
  const s = business(); s.cleaningEnabled = true;
  const t = submitTakeaway(s, owner, { requestId: randomUUID(), ...tea() }, at('2026-10-02T09:00:00Z'));
  const dine = submitOrder(s, owner, { requestId: randomUUID(), tableId: 'table-1', ...tea() }, at('2026-10-02T09:00:00Z'));
  const bag = s.accounts.find(a => a.id === t.accountId)!, floor = s.accounts.find(a => a.id === dine.accountId)!;
  const free = s.tables.find(x => x.id === 'table-2')!, ticket = s.tables.find(x => x.id === t.tableId)!;
  const before = structuredClone(s);
  assert.equal(code(() => moveTable(s, waiter, { requestId: randomUUID(), accountId: bag.id, version: bag.version, targetId: free.id, targetEpoch: free.epoch }, at('2026-10-02T09:01:00Z'))), 'TAKEAWAY_FIXED');
  assert.equal(code(() => moveTable(s, waiter, { requestId: randomUUID(), accountId: floor.id, version: floor.version, targetId: ticket.id, targetEpoch: ticket.epoch }, at('2026-10-02T09:01:00Z'))), 'TAKEAWAY_FIXED');
  assert.equal(code(() => mergeAccounts(s, cashier, { requestId: randomUUID(), sourceId: bag.id, sourceVersion: bag.version, targetId: floor.id, targetVersion: floor.version }, at('2026-10-02T09:01:00Z'))), 'TAKEAWAY_FIXED');
  assert.equal(code(() => mergeAccounts(s, cashier, { requestId: randomUUID(), sourceId: floor.id, sourceVersion: floor.version, targetId: bag.id, targetVersion: bag.version }, at('2026-10-02T09:01:00Z'))), 'TAKEAWAY_FIXED');
  assert.deepEqual(s, before);
  const o = s.orders.find(x => x.id === t.orderId)!; o.status = 'cancelled';
  closeEmptyAccount(s, cashier, bag.id, new Date('2026-10-02T09:02:00Z'));
  assert.equal(ticket.accountId, null); assert.equal(ticket.needsCleaning, false);
});

test('kitchen ticket calls out MASASIZ #n and the name, never a table', () => {
  const s = business();
  submitTakeaway(s, waiter, { requestId: randomUUID(), label: 'Mehmet', lines: [{ productId: 'tea', quantity: 2, selections: [], note: 'Az şekerli' }], expectedTotal: 7000 }, at('2026-10-02T09:00:00Z'));
  const text = renderText(kitchenTicket(s, s.orders[0], printer, s.orders[0].lines), printer).join('\n');
  assert.match(text, /MASASIZ #1/); assert.match(text, /Mehmet/); assert.match(text, /Tezgâhta teslim/); assert.doesNotMatch(text, /götür/i); assert.match(text, /Not: Az şekerli/);
  assert.doesNotMatch(text, /Masa \d/);
});

test('HTTP: floor stays the same, the strip shows open tickets only, history and reports name them "Masasız #n"', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/takeaway-')), store = new Store(directory, ['mola-demo']);
  let time = Date.parse('2026-10-02T09:00:00Z'); store.clock = () => new Date(time);
  licensed(store); const server = createServer(createApp(store, () => new Date(time))); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const client = () => { let cookie = ''; return async (path: string, body?: unknown) => { const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0]; return { status: r.status, data: await r.json() as any }; }; };
  const own = client(), cash = client(), cook = client();
  for (const [call, username] of [[own, 'isletme'], [cash, 'kasiyer'], [cook, 'mutfak']] as const) assert.equal((await call('/login', { username, password: DEMO_PASSWORD })).status, 200);
  const order = { requestId: randomUUID(), label: 'Ahmet', ...tea(2) };
  // No setting: an old stored "off" is ignored, and an old client still sending the switch changes nothing.
  store.mutate('mola-demo', s => { s.takeawayEnabled = false; s.changeSeconds = 0; });
  assert.equal((await own('/staff/settings', { takeawayEnabled: false, changeSeconds: 0, commissionBps: null })).status, 200);
  const created = await cash('/staff/takeaway/orders', order);
  assert.equal(created.status, 200); assert.equal(created.data.takeawayNumber, 1); assert.equal(created.data.tableName, 'Masasız #1');
  assert.deepEqual((await cash('/staff/takeaway/orders', order)).data, created.data, 'replayed over HTTP');
  let state = (await cash('/staff/state')).data;
  assert.equal(state.tables.length, 12); assert.equal(state.takeaways.length, 1); assert.equal('takeawayEnabled' in state, false);
  assert.equal(state.takeaways[0].account.balance, 7000); assert.equal(state.takeaways[0].takeaway.label, 'Ahmet');
  const kitchenState = (await cook('/staff/state')).data, card = kitchenState.orders.find((o: any) => o.id === created.data.orderId);
  assert.deepEqual(card.takeaway, { tableId: created.data.tableId, number: 1, label: 'Ahmet' }); assert.equal(card.tableName, 'Masasız #1'); assert.equal(card.total, 0);
  assert.equal(store.findTable(''), undefined, 'no QR link for a ticket');
  // Floor tools ignore tickets: table counts, the platform QR list and setup numbering stay on real tables.
  assert.equal((await own('/staff/tables/area', { requestId: randomUUID(), tableId: created.data.tableId, version: state.businessRevision, area: 'Bahçe' })).status, 404);
  for (const status of ['preparing', 'ready'] as const) { const o = (await cook('/staff/state')).data.orders.find((x: any) => x.id === created.data.orderId); assert.equal((await cook('/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status })).status, 200); }
  state = (await cash('/staff/state')).data;
  const paid = await cash('/staff/payments', { requestId: randomUUID(), accountId: state.takeaways[0].account.id, version: state.takeaways[0].account.version, method: 'card', amount: 7000, tendered: 7000, paymentContext: state.paymentContext });
  assert.equal(paid.data.closed, true);
  state = (await cash('/staff/state')).data;
  assert.equal(state.takeaways.length, 0, 'paid and handed over: off the strip at once, not after 6 hours');
  assert.equal(state.orders.some((o: any) => o.id === created.data.orderId), false);
  const ledger = (await own('/staff/payment-adjustments?from=2026-10-02&to=2026-10-02')).data;
  assert.deepEqual(ledger.rows.map((r: any) => r.tableName), ['Masasız #1']);
  // Six and a half hours later any write moves the closed ticket to long-term history; the next ticket prunes it.
  time += 6.5 * 3600_000;
  const second = await cash('/staff/takeaway/orders', { requestId: randomUUID(), ...tea() });
  assert.equal(second.data.takeawayNumber, 2, 'same business day keeps counting');
  const snapshot = store.read('mola-demo');
  assert.deepEqual(snapshot.tables.filter(x => x.takeaway).map(x => x.name), ['Masasız #2'], 'settled tickets leave the snapshot');
  assert.equal(snapshot.accounts.some(a => a.tableId === created.data.tableId), false);
  const archived = store.history.archives('mola-demo', -Infinity, Infinity);
  assert.equal(archived.length, 1); assert.equal(archived[0].tableName, 'Masasız #1'); assert.ok(!JSON.stringify(archived).includes('Ahmet'), 'the call-out name is not kept in history');
  assert.deepEqual((await own('/staff/payment-adjustments?from=2026-10-02&to=2026-10-02')).data.rows.map((r: any) => r.tableName), ['Masasız #1']);
  const financial = (await own('/staff/reports/financial?from=2026-10-02&to=2026-10-02')).data;
  assert.equal(financial.collected, 7000); assert.equal(financial.orderCount, 2);
});
