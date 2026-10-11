import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { starterState } from '../server/starter-template.js';
import { seed } from '../server/seed.js';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { totp } from '../server/totp.js';
import { recordPayment, setStatus, submitOrder } from '../packages/domain/engine.js';
import { ledgerMatcher, ledgerQuery, ledgerRows, paymentDetail, paymentLedgerPage, type LedgerQuery } from '../packages/domain/payment-history.js';
import { drain, drainSlowly, LEDGER_BUDGET_MS } from '../server/history.js';
import type { Actor, Payment, State } from '../packages/domain/types.js';

const DAY = 86400000;
const pay = (id: string, accountId: string, amount: number, method: Payment['method'], createdAt: string, extra: Partial<Payment> = {}): Payment => ({ id, accountId, amount, tendered: amount, change: 0, method, commission: 0, createdAt, ...extra });
/** One business day (2 October 2026, Türkiye) with neighbours just outside it, three tables and two corrections. */
function ledgerState() {
  const s = starterState('one', 'One');
  s.tables[0].name = 'Masa 01'; s.tables[1].name = 'Masa 12'; s.tables[2].name = 'Bahçe 3';
  s.staffUsers = [{ id: 'owner-1', name: 'Ayşe Kaya' }] as unknown as State['staffUsers'];
  s.accounts = ([['a1', 0], ['a12', 1], ['ab', 2]] as const).map(([id, i]) => ({ id, tableId: s.tables[i].id, status: 'closed' as const, version: 1, openedAt: '2026-10-01T06:00:00Z' }));
  s.payments = [
    pay('p1', 'a1', 3500, 'cash', '2026-10-02T11:30:00.000Z'), // 14:30, ₺35
    pay('p2', 'a12', 3550, 'card', '2026-10-02T11:35:00.000Z'), // 14:35, ₺35,50
    pay('p3', 'a12', 1200, 'cash', '2026-10-02T06:05:00.000Z'), // 09:05, ₺12, later corrected to card
    pay('p4', 'ab', 125000, 'card', '2026-10-02T17:59:00.000Z'), // 20:59, ₺1.250
    pay('edge-late', 'a1', 100, 'cash', '2026-10-03T01:59:59.999Z'), // 04:59:59 on 3 October: still the business day of 2 October
    pay('edge-early', 'a1', 100, 'cash', '2026-10-02T02:00:00.000Z'), // 05:00 on 2 October: its business day starts
    pay('edge-next', 'a1', 100, 'cash', '2026-10-03T02:00:00.000Z'), // 05:00 on 3 October
    pay('edge-prev', 'a1', 100, 'cash', '2026-10-02T01:59:59.000Z'), // 04:59 on 2 October: the business day of 1 October
  ];
  s.paymentAdjustments = [
    { id: 'r1', paymentId: 'p1', kind: 'refund', amount: 1000, method: 'cash', commission: 0, reason: 'Soğuk servis', actor: 'owner-1', createdAt: '2026-10-03T09:00:00.000Z' },
    { id: 'm3', paymentId: 'p3', kind: 'method', amount: 0, method: 'card', commission: 20, reason: 'Kartla ödedi', actor: 'owner-1', createdAt: '2026-10-02T07:00:00.000Z' },
  ];
  return s;
}
const day = (q: Partial<LedgerQuery> = {}) => ({ from: '2026-10-02', to: '2026-10-02', ...q });
const ids = (s: State, q: Partial<LedgerQuery> = {}) => paymentLedgerPage(s, day(q)).rows.map(r => r.id);

test('one search box finds a table, an amount or a time', () => {
  const row = (tableName: string, amount: number, createdAt = '2026-10-02T11:30:00Z') => ({ tableName, amount, createdAt });
  const hits = (q: string, r: ReturnType<typeof row>) => ledgerMatcher(q)(r);
  assert.ok(hits('', row('Masa 01', 1)));
  // Table words: numbers compare as numbers, text words match the start of a word, Turkish letters fold correctly.
  assert.ok(hits('12', row('Masa 12', 1))); assert.ok(hits('Masa 12', row('Masa 12', 1))); assert.ok(hits('masa 1', row('Masa 01', 1)));
  assert.ok(!hits('masa 1', row('Masa 12', 1))); assert.ok(!hits('Masa 12', row('Masa 01', 1200))); assert.ok(hits('BAHÇE', row('Bahçe 3', 1))); assert.ok(hits('bah', row('Bahçe 3', 1)));
  // Amounts: whole lira match every kuruş of that lira; kuruş, ₺ and thousands dots are understood.
  assert.ok(hits('35', row('Masa 01', 3500))); assert.ok(hits('35', row('Masa 01', 3599))); assert.ok(!hits('35', row('Masa 01', 3600)));
  assert.ok(hits('35,50', row('Masa 01', 3550))); assert.ok(hits('35.5', row('Masa 01', 3550))); assert.ok(!hits('35,50', row('Masa 01', 3500)));
  assert.ok(hits('₺35', row('Masa 01', 3500))); assert.ok(hits('35 TL', row('Masa 01', 3500))); assert.ok(!hits('₺35', row('Masa 35', 1)));
  assert.ok(hits('1.250', row('Masa 01', 125000))); assert.ok(hits('1250', row('Masa 01', 125000))); assert.ok(hits('1.250,75', row('Masa 01', 125075)));
  // Times in Türkiye: a prefix of HH:MM, one-digit hours padded.
  assert.ok(hits('14:3', row('Masa 01', 1, '2026-10-02T11:35:00Z'))); assert.ok(!hits('14:3', row('Masa 01', 1, '2026-10-02T11:45:00Z')));
  assert.ok(hits('9:0', row('Masa 01', 1, '2026-10-02T06:05:00Z'))); assert.ok(hits('00:00', row('Masa 01', 1, '2026-10-01T21:00:00Z')));
});

test('the statement lists one business day (05:00–05:00) newest first and filters by search, method and corrections', () => {
  const s = ledgerState(), page = paymentLedgerPage(s, day());
  assert.deepEqual(page.rows.map(r => r.id), ['edge-late', 'p4', 'p2', 'p1', 'p3', 'edge-early']);
  assert.equal(page.total, 6); assert.equal(page.amount, 3500 + 3550 + 1200 + 125000 + 200); assert.equal(page.next, null);
  // Business day boundaries (05:00 Türkiye, 02:00 UTC), like the gün sonu kasası.
  assert.deepEqual(ids(s, { from: '2026-10-03', to: '2026-10-03' }), ['edge-next']);
  assert.deepEqual(ids(s, { from: '2026-10-01', to: '2026-10-01' }), ['edge-prev']);
  assert.equal(paymentLedgerPage(s, { from: '2026-10-01', to: '2026-10-03' }).total, 8);
  // Method filters use the corrected method; "Düzeltilenler" are payments with any refund or method change.
  assert.deepEqual(ids(s, { filter: 'cash' }), ['edge-late', 'p1', 'edge-early']);
  assert.deepEqual(ids(s, { filter: 'card' }), ['p4', 'p2', 'p3']);
  assert.deepEqual(ids(s, { filter: 'corrected' }), ['p1', 'p3']);
  assert.deepEqual(ids(s, { q: '12' }), ['p2', 'p3']); assert.deepEqual(ids(s, { q: 'Masa 12', filter: 'cash' }), []);
  assert.deepEqual(ids(s, { q: 'masa 1' }), ['edge-late', 'p1', 'edge-early']);
  assert.deepEqual(ids(s, { q: '35' }), ['p2', 'p1']); assert.deepEqual(ids(s, { q: '35,50' }), ['p2']);
  assert.deepEqual(ids(s, { q: '14:3' }), ['p2', 'p1']); assert.deepEqual(ids(s, { q: 'bahçe' }), ['p4']); assert.deepEqual(ids(s, { q: 'yok' }), []);
  assert.equal(paymentLedgerPage(s, day({ q: '35' })).amount, 7050);
  // Rows carry what the correction form and the details need; only staff names leave the server.
  const p1 = page.rows.find(r => r.id === 'p1')!, p3 = page.rows.find(r => r.id === 'p3')!;
  assert.deepEqual([p1.tableName, p1.refunded, p1.refundable, p1.revision, p1.method], ['Masa 01', 1000, 2500, 1, 'cash']);
  assert.deepEqual(p1.corrections, [{ id: 'r1', kind: 'refund', amount: 1000, method: 'cash', commission: 0, reason: 'Soğuk servis', createdAt: '2026-10-03T09:00:00.000Z', by: 'Ayşe Kaya' }]);
  assert.deepEqual([p3.method, p3.commission, p3.refunded, p3.corrections[0].kind], ['card', 20, 0, 'method']);
  assert.ok(!JSON.stringify(page).includes('owner-1'));
});

test('paging follows a cursor, so new payments on top never repeat or skip rows', () => {
  const s = ledgerState(), all = ids(s), seen: string[] = [];
  let before: string | undefined, pages = 0;
  do { const page = paymentLedgerPage(s, day({ limit: 4, before })); seen.push(...page.rows.map(r => r.id)); before = page.next ?? undefined; pages++; assert.equal(page.total, 6); } while (before);
  assert.deepEqual(seen, all); assert.equal(pages, 2);
  const first = paymentLedgerPage(s, day({ limit: 2 }));
  s.payments.push(pay('newest', 'a1', 500, 'cash', '2026-10-02T20:00:00.000Z'), pay('same-time', 'a1', 500, 'cash', '2026-10-02T11:35:00.000Z'));
  // Equal times are ordered by id (descending): "same-time" comes before "p2"; "newest" is above the cursor.
  assert.deepEqual(paymentLedgerPage(s, day({ limit: 3, before: first.next! })).rows.map(r => r.id), ['same-time', 'p2', 'p1']);
  assert.deepEqual(paymentLedgerPage(s, day({ limit: 500 })).rows.length, 8);
  // Invalid questions are refused instead of guessed.
  for (const q of [{ from: 'all', to: '2026-10-02' }, { from: '2026-10-02', to: 'all' }, { from: '2026-10-03', to: '2026-10-02' }, { from: '2026-02-30', to: '2026-03-01' }, day({ limit: 0 }), day({ limit: 501 }), day({ before: 'garbage' }), day({ filter: 'refunded' as never })]) assert.throws(() => paymentLedgerPage(s, q as LedgerQuery), q.from);
  // Any range is allowed now, and all time; a paused scan's cursor ("<day start>|") continues before that instant.
  assert.equal(paymentLedgerPage(s, { from: '2025-10-03', to: '2026-10-02' }).total, 9); assert.equal(paymentLedgerPage(s, { from: 'all', to: 'all' }).total, 10);
  assert.deepEqual(paymentLedgerPage(s, { from: 'all', to: 'all', before: '2026-10-02T02:00:00.000Z|' }).rows.map(r => r.id), ['edge-prev']);
});

test('details show the items paid, or the account items when the payment was an amount', () => {
  const s = seed('one'), owner: Actor = { tenantId: 'one', id: 'isletme', role: 'owner' }, ctx = { now: new Date('2026-10-02T10:00:00Z'), id: randomUUID };
  s.changeSeconds = 0;
  const price = s.products.find(p => p.id === 'tea')!.price;
  const placed = submitOrder(s, owner, { requestId: randomUUID(), tableId: s.tables[0].id, lines: [{ productId: 'tea', quantity: 3, selections: [] }], expectedTotal: 3 * price }, ctx);
  const line = s.orders[0].lines[0], version = () => s.accounts.find(a => a.id === placed.accountId)!.version;
  const picked = recordPayment(s, owner, { requestId: randomUUID(), accountId: placed.accountId, version: version(), method: 'cash', amount: price, tendered: price, selections: [{ orderId: placed.orderId, lineId: line.id, quantity: 1 }] }, ctx);
  const rest = recordPayment(s, owner, { requestId: randomUUID(), accountId: placed.accountId, version: version(), method: 'card', amount: 2 * price, tendered: 2 * price }, ctx);
  assert.deepEqual(paymentDetail(s, picked.paymentId, () => undefined), { id: picked.paymentId, itemsSelected: true, items: [{ productId: line.productId, name: line.name, optionNames: [], quantity: 1, total: price }] });
  assert.deepEqual(paymentDetail(s, rest.paymentId, () => undefined), { id: rest.paymentId, itemsSelected: false, items: [{ productId: line.productId, name: line.name, optionNames: [], quantity: 3, total: 3 * price }] });
  let asked = 0;
  assert.throws(() => paymentDetail(s, 'missing', () => { asked++; return undefined; }), /bulunamadı/); assert.equal(asked, 1);
  paymentDetail(s, rest.paymentId, () => { asked++; return undefined; }); assert.equal(asked, 1, 'a payment on the floor never opens long-term history');
});

test('a year of history: one day reads one cached payment list and stays fast; all time pages and counts in steps', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/ledger-year-')), store = new Store(directory, ['mola-demo']), tenant = 'mola-demo';
  const now = Date.parse('2026-10-03T09:00:00Z'); store.clock = () => new Date(now);
  try {
    // 3650 settled tables over the last year, ten a day, written in batches like a long-running café.
    const per = 10, total = 365 * per, first = now - 365 * DAY;
    for (let batch = 0; batch < 5; batch++) store.mutate(tenant, s => {
      for (let i = batch * 730; i < (batch + 1) * 730; i++) {
        const accountId = `acc-${i}`, at = new Date(first + Math.floor(i / per) * DAY + (i % per) * 3600000).toISOString(), table = s.tables[i % s.tables.length];
        const payment = pay(`pay-${String(i).padStart(5, '0')}`, accountId, 1000 + i, i % 2 ? 'card' : 'cash', at);
        s.accounts.push({ id: accountId, tableId: table.id, status: 'closed', version: 2, openedAt: at, closedAt: at }); s.payments.push(payment);
        s.archives.push({ id: `arc-${i}`, accountId, tableName: table.name, closedAt: at, total: payment.amount, cash: 0, card: 0, orders: [], payments: [payment] });
      }
    });
    assert.equal(store.history.counts().archives, total);
    const history = store.history as unknown as { archives: (...args: unknown[]) => unknown[] }, archives = history.archives.bind(store.history);
    let opened = 0; history.archives = (...args) => { const rows = archives(...args); opened += rows.length; return rows; };
    const query = (from: string, to: string, q: Partial<LedgerQuery> = {}) => store.history.paymentLedger(tenant, store.read(tenant), { from, to, ...q }, Infinity); // no pause: exact pages
    const cold = query('2026-06-15', '2026-06-15');
    assert.equal(cold.total, per); assert.ok(opened <= 3 * per, `cold day opened ${opened} accounts`);
    opened = 0; const began = performance.now();
    for (let i = 0; i < 20; i++) query('2026-06-15', '2026-06-15', { q: '12' });
    const warm = (performance.now() - began) / 20;
    assert.equal(opened, 0); assert.ok(warm < 50, `warm day took ${warm.toFixed(1)} ms`);
    // A full month (31 days, the longest allowed) with a search, paged by cursor.
    const month = query('2026-05-01', '2026-05-31', { filter: 'card' });
    assert.equal(month.total, 31 * per / 2); assert.equal(month.rows.length, 50); assert.ok(month.next);
    const second = query('2026-05-01', '2026-05-31', { filter: 'card', before: month.next! });
    assert.ok(second.rows.every(r => r.createdAt <= month.rows.at(-1)!.createdAt)); assert.equal(new Set([...month.rows, ...second.rows].map(r => r.id)).size, 100);
    // A row's details open only its own settled account, found through the payment index.
    opened = 0; const old = month.rows[0];
    assert.deepEqual(paymentDetail(store.read(tenant), old.id, () => store.history.paymentAccount(tenant, old.id)), { id: old.id, itemsSelected: false, items: [] });
    assert.equal(opened, 0);
    // All time and a year: a page reads only the newest days; totals are counted apart (summaries, or lists with a filter).
    const expected = (filter: LedgerQuery['filter'], q?: string) => { const all = store.history.view(tenant, store.read(tenant), -Infinity, Infinity), rows = ledgerRows(all, -Infinity, Infinity, ledgerQuery({ from: 'all', to: 'all', filter, q })); return { total: rows.length, amount: rows.reduce((n, r) => n + r.amount, 0), ids: rows.map(r => r.id) }; };
    for (const [from, to] of [['all', 'all'], ['2025-10-03', '2026-10-03']]) {
      const page = query(from, to);
      assert.deepEqual([page.total, page.amount, page.rows.length], [null, null, 50]); assert.equal(page.rows[0].id, `pay-0${total - 1}`);
      assert.deepEqual(drain(store.history.ledgerTotals(tenant, store.read(tenant), { from, to })), { total, amount: Array.from({ length: total }, (_, i) => 1000 + i).reduce((n, v) => n + v, 0) });
    }
    for (const [filter, q] of [['card', undefined], ['all', 'Masa 3'], ['cash', '1.5']] as const) {
      const want = expected(filter, q), steps = store.history.ledgerTotals(tenant, store.read(tenant), { from: 'all', to: 'all', filter, q });
      assert.deepEqual(await drainSlowly(steps, () => false, 1), { total: want.total, amount: want.amount }, `${filter} ${q}`);
      // Paging the whole history gives every row once, newest first, also when each page may only look for 0 ms.
      for (const budget of [LEDGER_BUDGET_MS, 0]) {
        const seen: string[] = []; let before: string | undefined, pages = 0;
        do { const page = store.history.paymentLedger(tenant, store.read(tenant), { from: 'all', to: 'all', filter, q, limit: 200, before }, budget); seen.push(...page.rows.map(r => r.id)); before = page.next ?? undefined; pages++; } while (before);
        assert.deepEqual(seen, want.ids, `${filter} ${q} budget ${budget}`); if (!budget) assert.ok(pages > 300, `paused ${pages} times`);
      }
    }
    // A rare search over the whole year pauses instead of reading every day in one go; an asker who left stops the count.
    const rare = (budget?: number) => { const began = performance.now(); const page = store.history.paymentLedger(tenant, store.read(tenant), { from: 'all', to: 'all', q: '99:99' }, budget); return { page, ms: performance.now() - began }; };
    const paused = rare(5);
    assert.ok(paused.page.rows.length === 0 && paused.page.next?.endsWith('|'), JSON.stringify(paused.page.next)); assert.ok(paused.ms < 300, `paused page took ${paused.ms.toFixed(0)} ms`);
    assert.equal(rare(10_000).page.next, null);
    let asked = 0; assert.equal(await drainSlowly(store.history.ledgerTotals(tenant, store.read(tenant), { from: 'all', to: 'all', q: 'Masa' }), () => ++asked > 2, 0), undefined);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a table paid and closed in the last hours tells the owner when, for "Ödemeyi düzelt"', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/ledger-shortcut-')), store = new Store(directory, ['mola-demo']), tenant = 'mola-demo';
  let time = Date.parse('2026-10-02T12:00:00Z'); store.clock = () => new Date(time);
  licensed(store); const server = createServer(createApp(store, () => new Date(time))); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const client = () => { let cookie = ''; return async (path: string, body?: unknown) => { const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0]; return { status: r.status, data: await r.json() as any }; }; };
  const owner = client(), cashier = client();
  for (const [call, username] of [[owner, 'isletme'], [cashier, 'kasiyer']] as const) assert.equal((await call('/login', { username, password: DEMO_PASSWORD })).status, 200);
  const who: Actor = { tenantId: tenant, id: 'isletme', role: 'owner' }, ctx = () => ({ now: new Date(time), id: randomUUID });
  const table = async (call: typeof owner, id: string) => (await call('/staff/state')).data.tables.find((x: any) => x.id === id);
  const paid = store.mutate(tenant, s => {
    s.changeSeconds = 0; const price = s.products.find(p => p.id === 'tea')!.price;
    const o = submitOrder(s, who, { requestId: randomUUID(), tableId: 'table-7', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: price }, ctx());
    for (const status of ['preparing', 'ready', 'served'] as const) setStatus(s, who, o.orderId, s.orders.find(x => x.id === o.orderId)!.version, status, ctx().now);
    return recordPayment(s, who, { requestId: randomUUID(), accountId: o.accountId, version: s.accounts.find(a => a.id === o.accountId)!.version, method: 'card', amount: price, tendered: price }, ctx());
  });
  const closed = await table(owner, 'table-7');
  assert.equal(closed.account, null, 'the bill is closed'); assert.equal(closed.lastPaidAt, new Date(time).toISOString());
  assert.equal(store.read(tenant).payments.find(p => p.id === paid.paymentId)!.createdAt, closed.lastPaidAt);
  assert.equal((await table(owner, 'table-8')).lastPaidAt, undefined); assert.equal((await table(cashier, 'table-7')).lastPaidAt, undefined, 'owner only');
  // The shortcut's search finds exactly that payment on its day.
  const ledger = await owner(`/staff/payment-adjustments?from=2026-10-02&to=2026-10-02&q=${encodeURIComponent(closed.name)}`);
  assert.deepEqual(ledger.data.rows.map((r: any) => r.id), [paid.paymentId]);
  // Once the closed table settles into history (6 h) the link is gone with it.
  time += 6 * 3600_000 + 60_000; store.mutate(tenant, () => {});
  assert.equal((await table(owner, 'table-7')).lastPaidAt, undefined);
});

test('the statement API is owner only, behind report verification, and validates its questions', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/ledger-api-')), store = new Store(directory, ['mola-demo']), tenant = 'mola-demo';
  let time = Date.parse('2026-10-02T12:00:00Z'); store.clock = () => new Date(time);
  licensed(store); const server = createServer(createApp(store, () => new Date(time))); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const client = () => { let cookie = ''; return async (path: string, body?: unknown) => { const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0]; return { status: r.status, data: await r.json() as any }; }; };
  const owner = client(), second = client(), cashier = client(), waiter = client();
  for (const [call, username] of [[owner, 'isletme'], [second, 'isletme'], [cashier, 'kasiyer'], [waiter, 'garson']] as const) assert.equal((await call('/login', { username, password: DEMO_PASSWORD })).status, 200);
  const who: Actor = { tenantId: tenant, id: 'isletme', role: 'owner' }, ctx = () => ({ now: new Date(time), id: randomUUID });
  const paid = store.mutate(tenant, s => {
    s.changeSeconds = 0; const price = s.products.find(p => p.id === 'tea')!.price;
    const o = submitOrder(s, who, { requestId: randomUUID(), tableId: 'table-12', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: price }, ctx());
    return recordPayment(s, who, { requestId: randomUUID(), accountId: o.accountId, version: s.accounts.find(a => a.id === o.accountId)!.version, method: 'cash', amount: price, tendered: price }, ctx());
  });
  const list = await owner('/staff/payment-adjustments');
  assert.equal(list.status, 200); assert.deepEqual([list.data.from, list.data.to, list.data.total], ['2026-10-02', '2026-10-02', 1]);
  assert.deepEqual(Object.keys(list.data).sort(), ['amount', 'from', 'next', 'rows', 'to', 'total']);
  assert.deepEqual(Object.keys(list.data.rows[0]).sort(), ['accountId', 'amount', 'change', 'commission', 'corrections', 'createdAt', 'id', 'itemsSelected', 'method', 'refundable', 'refunded', 'revision', 'tableName', 'tendered']);
  assert.equal((await owner('/staff/payment-adjustments?q=Masa%2012&filter=cash')).data.total, 1);
  assert.equal((await owner('/staff/payment-adjustments?q=Masa%2011')).data.total, 0);
  assert.equal((await owner('/staff/payment-adjustments?from=2026-10-01&to=2026-10-01')).data.total, 0);
  const detail = await owner(`/staff/payment-adjustments/${paid.paymentId}`);
  assert.equal(detail.status, 200); assert.equal(detail.data.itemsSelected, false); assert.equal(detail.data.items[0].quantity, 1);
  assert.equal((await owner('/staff/payment-adjustments/missing')).status, 404);
  for (const bad of ['?from=all&to=2026-10-02', '?from=2026-10-03&to=2026-10-02', '?filter=refunded', '?limit=0', '?limit=501', '?before=x', `?q=${'a'.repeat(81)}`]) {
    assert.equal((await owner(`/staff/payment-adjustments${bad}`)).status, 400, bad); assert.equal((await owner(`/staff/payment-adjustments/totals${bad}`)).status, 400, bad);
  }
  // Long periods and all time: the page leaves the totals to /totals, which counts the same rows.
  for (const range of ['?from=all&to=all', '?from=2025-10-03&to=2026-10-02']) {
    const long = await owner(`/staff/payment-adjustments${range}`);
    assert.equal(long.status, 200); assert.deepEqual([long.data.total, long.data.amount, long.data.rows.length, long.data.next], [null, null, 1, null]);
    assert.deepEqual((await owner(`/staff/payment-adjustments/totals${range}`)).data, { total: 1, amount: list.data.amount });
    assert.deepEqual((await owner(`/staff/payment-adjustments/totals${range}&q=Masa%2011`)).data, { total: 0, amount: 0 });
  }
  assert.deepEqual((await owner('/staff/payment-adjustments?from=2026-09-02&to=2026-10-02')).data.total, 1, '31 days come with their totals');
  // A correction through the API shows up on the row at once, with who recorded it.
  assert.equal((await owner('/staff/payment-adjustments', { requestId: randomUUID(), paymentId: paid.paymentId, revision: 0, kind: 'refund', amount: 1000, method: 'cash', commission: 0, reason: 'Eksik servis' })).status, 200);
  const corrected = (await owner('/staff/payment-adjustments?filter=corrected')).data.rows[0];
  assert.deepEqual([corrected.refunded, corrected.revision, corrected.corrections[0].reason, corrected.corrections[0].by], [1000, 1, 'Eksik servis', 'İşletme sahibi']);
  // Other roles are refused, like every financial report.
  for (const call of [cashier, waiter]) for (const path of ['/staff/payment-adjustments', '/staff/payment-adjustments/totals?from=all&to=all', `/staff/payment-adjustments/${paid.paymentId}`]) assert.equal((await call(path)).status, 403, path);
  // With Authenticator on, every session needs a fresh code for the list and the details, exactly like the reports.
  const setup = await owner('/staff/report-security/setup', { password: DEMO_PASSWORD }); assert.equal(setup.status, 200);
  assert.equal((await owner('/staff/report-security/enable', { code: totp(setup.data.secret, time) })).status, 200);
  for (const path of ['/staff/payment-adjustments', '/staff/payment-adjustments/totals?from=all&to=all', `/staff/payment-adjustments/${paid.paymentId}`, '/staff/reports/financial?from=2026-10-02&to=2026-10-02']) {
    assert.equal((await second(path)).status, 403, path); assert.equal((await second(path)).data.code, 'MFA_REQUIRED'); assert.equal((await owner(path)).status, 200, path);
  }
  time += 601000;
  assert.equal((await owner('/staff/payment-adjustments')).status, 403); assert.equal((await owner(`/staff/payment-adjustments/${paid.paymentId}`)).status, 403);
});
