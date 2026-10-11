import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { loadSectorMenu } from '../server/sector-templates.js';
import { balances, recordPayment, setStatus, submitOrder } from '../packages/domain/engine.js';
import { createEvent, seatWalkIn, startEvent } from '../packages/domain/reservation-rules.js';
import type { Actor, CartLine, Product, StaffSnapshot, State } from '../packages/domain/types.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * The derby night (QA, 6-mola-derbi): 12 tables + 25 event tables, ~180 orders on open bills, every staff screen polls
 * /api/staff/state about 30 times a minute. This builds the same day from the domain rules and measures what each role
 * downloads, so the snapshot cannot quietly grow back.
 */
const start = Date.parse('2026-10-04T16:00:00Z');
const at = (minutes: number) => new Date(start + minutes * 60_000);
const who = (role: Actor['role']): Actor => ({ tenantId: 'mola-demo', id: role, role });
const owner = who('owner'), waiter = who('waiter'), kitchen = who('kitchen'), cashier = who('cashier');

/** One line of a product with its required choices on their first option. */
function line(p: Product, quantity: number): CartLine {
  return { productId: p.id, quantity, selections: p.groups.filter(g => g.required).map(g => ({ groupId: g.id, optionId: g.options[0].id })) };
}
function price(p: Product, l: CartLine) { return (p.price + l.selections.reduce((n, sel) => n + (p.groups.find(g => g.id === sel.groupId)!.options.find(o => o.id === sel.optionId)!.extra), 0)) * l.quantity; }

/** A busy evening: 37 tables with 4–6 rounds each; the older rounds served, about half of them paid by item. */
export function derbyDay(s: State) {
  s.setupCompleted = true; loadSectorMenu(s, 'cafe');
  const ctx = (m: number) => ({ now: at(m), id: randomUUID });
  const event = createEvent(s, owner, { requestId: randomUUID(), name: 'Derbi', day: '2026-10-04', start: '19:00', count: 25, prefix: 'D', capacity: 4, hideNormal: false }, ctx(0)) as { id: string };
  startEvent(s, owner, { requestId: randomUUID(), id: event.id }, ctx(1));
  const tables = s.tables.filter(t => !t.takeaway);
  for (const t of tables.filter(t => t.event)) seatWalkIn(s, waiter, { requestId: randomUUID(), tableId: t.id, name: `Misafir ${t.name}`, people: 3 }, ctx(2));
  const products = s.products.filter(p => p.unit !== 'kg' && !p.soldOut && p.published !== false && !p.discounts?.length);
  let n = 0;
  for (let round = 0; round < 5; round++) for (const t of tables) {
    if (n >= 182) break;
    const minute = 5 + round * 25 + (n % 20);
    const picks = [products[n % products.length], products[(n * 7 + 3) % products.length], products[(n * 3 + 1) % products.length]].slice(0, 2 + (n % 2));
    const lines = picks.map((p, i) => line(p, 1 + ((n + i) % 3)));
    const total = lines.reduce((sum, l, i) => sum + price(picks[i], l), 0);
    const { orderId } = submitOrder(s, waiter, { requestId: randomUUID(), tableId: t.id, lines, expectedTotal: total }, ctx(minute));
    const o = s.orders.find(o => o.id === orderId)!;
    // Older rounds went all the way; the last ones are still in the kitchen.
    const steps = round < 3 ? 3 : round === 3 ? (n % 3) + 1 : n % 2;
    for (let i = 0; i < steps; i++) setStatus(s, i === 2 ? waiter : kitchen, o.id, o.version, (['preparing', 'ready', 'served'] as const)[i], at(minute + 2 + i));
    // Half of the tables pay each served round by item right away.
    if (round < 3 && n % 2 === 0) {
      const a = s.accounts.find(a => a.id === o.accountId)!;
      const amount = o.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
      recordPayment(s, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: n % 4 ? 'card' : 'cash', amount, tendered: amount, selections: o.lines.map(l => ({ orderId: o.id, lineId: l.id, quantity: l.quantity })) }, ctx(minute + 6));
    }
    n++;
  }
  return n;
}

test('derby-sized day: each staff screen downloads a small snapshot (size budget per role)', async t => {
  const store = new Store(temp('staff-state-size'));
  licensed(store);
  let orders = 0;
  store.mutate('mola-demo', s => { orders = derbyDay(s); });
  const server = createServer(createApp(store, () => at(150)));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const sizes: Record<string, number> = {}, snapshots: Record<string, StaffSnapshot> = {};
  for (const [username, role] of [['isletme', 'owner'], ['kasiyer', 'cashier'], ['garson', 'waiter'], ['mutfak', 'kitchen']] as const) {
    const cookie = await loginCookie(base, username);
    const r = await fetch(`${base}/staff/state`, { headers: { Cookie: cookie } });
    const text = await r.text();
    sizes[role] = Buffer.byteLength(text); snapshots[role] = JSON.parse(text);
    // Still a 204 when nothing changed: the tag covers the slimmer content.
    assert.equal((await fetch(`${base}/staff/state`, { headers: { Cookie: cookie, 'X-Mola-Tag': r.headers.get('X-Mola-Tag')! } })).status, 204);
  }
  console.log(`derby: ${orders} sipariş · ${Object.entries(sizes).map(([k, v]) => `${k} ${(v / 1024).toFixed(1)} KB`).join(' · ')}`);
  // Measured on this day before the change: owner/cashier/waiter 195.6 KB, kitchen 179.4 KB. After: ~114 KB and ~48 KB.
  assert.ok(sizes.owner < 130 * 1024 && sizes.cashier < 130 * 1024 && sizes.waiter < 130 * 1024, JSON.stringify(sizes));
  assert.ok(sizes.kitchen < 60 * 1024, JSON.stringify(sizes));
  // Nothing the screens need went missing: every open bill and every order still in the kitchen is there, exact.
  const live = store.read('mola-demo'), owner = snapshots.owner, kitchenView = snapshots.kitchen;
  for (const o of live.orders.filter(o => ['new', 'preparing', 'ready'].includes(o.status))) {
    const seen = owner.orders.find(x => x.id === o.id)!;
    assert.deepEqual([seen.version, seen.total, seen.lines.map(l => [l.id, l.quantity, l.unitPrice])], [o.version, o.total, o.lines.map(l => [l.id, l.quantity, l.unitPrice])]);
    assert.ok(kitchenView.orders.some(x => x.id === o.id));
  }
  assert.equal(kitchenView.orders.filter(o => o.status === 'served').length, 0, 'the kitchen board ends at Hazır');
  assert.ok(kitchenView.orders.every(o => o.total === 0 && o.lines.every(l => l.unitPrice === 0)), 'no prices in the kitchen');
  // Served and paid rounds older than 30 minutes are counted on their table instead of listed.
  const tables = [...owner.tables, ...(owner.eventTables ?? [])], done = tables.reduce((n, t) => n + (t.account?.doneOrders ?? 0), 0);
  assert.ok(done > 0);
  assert.equal(owner.orders.length + done, live.orders.filter(o => o.status !== 'cancelled').length);
  for (const t of tables) if (t.account) assert.equal(t.account.balance, balances(live, t.account.id).balance);
  // Fields no staff screen reads are gone; defaults are not repeated.
  for (const o of owner.orders) {
    assert.equal('menuRevision' in o || 'approvalRequired' in o || 'reservation' in o || 'guestId' in o, false);
    assert.ok(o.lines.every(l => !('selections' in l)));
    if (o.status !== 'new' && o.status !== 'awaiting_approval') assert.equal(o.editableUntil, undefined);
  }
});

async function loginCookie(base: string, username: string) {
  const r = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: DEMO_PASSWORD }) });
  return r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}
