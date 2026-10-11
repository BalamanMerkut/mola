import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { Store, seal, snapshotKey } from '../server/store.js';
import { open } from '../server/sealing.js';
import { drain, SUMMARY_VERSION } from '../server/history.js';
import type { DaySummary } from '../packages/domain/history.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { seed } from '../server/seed.js';
import { initialUsers } from '../server/accounts.js';
import { validateBackupDatabase } from '../server/backup.js';
import { balances, cancelOrder, closeEmptyAccount, editOrder, quote, recordPayment, setStatus, submitOrder } from '../packages/domain/engine.js';
import { campaignViews, saleProducts } from '../packages/domain/campaigns.js';
import { recordExpense } from '../packages/domain/expenses.js';
import { adjustPayment } from '../packages/domain/payment-adjustments.js';
import { paymentDetail, paymentLedgerPage } from '../packages/domain/payment-history.js';
import { campaignReport } from '../packages/domain/campaign-reports.js';
import { employeeFrom, employeeReport, financialFrom, financialReport, mergeDays, productSales, reportRange, salesOverview } from '../packages/domain/reports.js';
import type { Actor, ArchivedAccount, CartLine, State } from '../packages/domain/types.js';

const DAY = 86400000, MIN = 60000;
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function folder(name: string) { mkdirSync('.local/tests', { recursive: true }); return mkdtempSync(resolve(`.local/tests/${name}-`)); }
const people = (tenant: string) => ({ owner: { tenantId: tenant, id: 'isletme', role: 'owner' } as Actor, cashier: { tenantId: tenant, id: 'kasiyer', role: 'cashier' } as Actor, waiter: { tenantId: tenant, id: 'garson', role: 'waiter' } as Actor, kitchen: { tenantId: tenant, id: 'mutfak', role: 'kitchen' } as Actor });

/** A realistic stretch of café days written through the domain rules, either into a Store or into a plain State. */
function scenario(target: { store: Store; tenant: string } | { state: State }, start: number, days: number, perDay = 6) {
  const tenant = 'store' in target ? target.tenant : target.state.tenantId, who = people(tenant);
  let t = start;
  const ctx = () => ({ now: new Date(t), id: randomUUID });
  if ('store' in target) target.store.clock = () => new Date(t);
  const apply = <T>(fn: (s: State) => T): T => 'store' in target ? target.store.mutate(tenant, fn) : fn(target.state);
  const stored = (s: State, paymentId: string) => 'store' in target ? target.store.history.paymentForAdjustment(tenant, s, paymentId) : undefined;
  const price = (s: State, lines: CartLine[]) => quote(saleProducts(s, ctx().now), lines, ctx()).reduce((n, l) => n + l.total, 0);
  const made = { orders: 0, payments: [] as { id: string; at: number; method: 'cash' | 'card'; amount: number }[], expenses: 0 };
  apply(s => { s.changeSeconds = 0; s.commissionBps = 150; s.campaigns = [{ id: 'tea-week', reportId: 'tea-r1', name: 'Çay haftası', productIds: ['tea'], percent: 20, startsAt: new Date(start + 2 * DAY).toISOString(), endsAt: new Date(start + 5 * DAY + 3 * 3600000).toISOString(), enabled: true, combine: false, maxQuantity: 5000 }]; s.campaignHistory = [{ ...s.campaigns[0], recordedAt: new Date(start).toISOString() }]; });
  const products = ['tea', 'herbal', 'lemonade', 'cheesecake'];
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < perDay; i++) {
      t = start + d * DAY + (i * 95 + 20) * MIN;
      const table = `table-${i + 1}`, lines: CartLine[] = [{ productId: products[(d + i) % 4], quantity: 1 + i % 3, selections: [] }, { productId: 'tea', quantity: 2, selections: [] }];
      const actor = i % 3 === 1 ? { ...who.waiter } : i % 3 === 2 ? { tenantId: tenant, id: `phone-${(d * 7 + i) % 9}`, role: 'guest' as const, tableId: table, epoch: 0 } : who.owner;
      const placed = apply(s => { if (actor.role === 'guest') actor.epoch = s.tables.find(x => x.id === table)!.epoch; return submitOrder(s, actor, { requestId: randomUUID(), tableId: table, lines, expectedTotal: price(s, lines) }, ctx()); });
      made.orders++;
      if (i === 4 && d % 3 === 0) { // a mistaken second order, cancelled by the owner
        t += 2 * MIN; const extra = apply(s => submitOrder(s, who.owner, { requestId: randomUUID(), tableId: table, lines: [{ productId: 'herbal', quantity: 1, selections: [] }], expectedTotal: 8500 }, ctx())); made.orders++;
        apply(s => cancelOrder(s, who.owner, { requestId: randomUUID(), orderId: extra.orderId, version: 1 }, ctx()));
      }
      for (const status of ['preparing', 'ready', 'served'] as const) { t += 4 * MIN; apply(s => { const o = s.orders.find(o => o.id === placed.orderId)!; return setStatus(s, who.kitchen, o.id, o.version, status, ctx().now); }); }
      t += 25 * MIN;
      const pay = (method: 'cash' | 'card', part?: number) => apply(s => { const a = s.accounts.find(a => a.id === placed.accountId)!, amount = part ?? balances(s, a.id).balance; const r = recordPayment(s, who.cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method, amount, tendered: amount }, ctx()); made.payments.push({ id: r.paymentId, at: t, method, amount }); return r; });
      if (i % 3 === 0) { pay('card', 2000); t += MIN; pay('cash'); } else pay(i % 2 ? 'card' : 'cash');
    }
    if (d === 1) { // an order cancelled at once: the table is closed without a sale
      t = start + d * DAY + 10 * 3600000;
      const o = apply(s => submitOrder(s, who.owner, { requestId: randomUUID(), tableId: 'table-12', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: price(s, [{ productId: 'tea', quantity: 1, selections: [] }]) }, ctx())); made.orders++;
      apply(s => cancelOrder(s, who.owner, { requestId: randomUUID(), orderId: o.orderId, version: 1 }, ctx()));
      apply(s => closeEmptyAccount(s, who.cashier, o.accountId, ctx().now));
    }
    t = start + d * DAY + 11 * 3600000;
    apply(s => recordExpense(s, who.cashier, { requestId: randomUUID(), amount: 15000 + d * 100, description: `Süt ${d}` }, ctx())); made.expenses++;
  }
  // Corrections on payments that have left the floor by now.
  t = start + (days - 1) * DAY + 13 * 3600000;
  const cash = made.payments.find(p => p.method === 'cash' && p.at < start + 3 * DAY && p.amount > 3000)!, card = made.payments.find(p => p.method === 'card' && p.at > start + 3 * DAY && p.amount > 3000)!;
  apply(s => adjustPayment(s, who.owner, { requestId: randomUUID(), paymentId: cash.id, revision: 0, kind: 'refund', amount: 1000, method: 'cash', commission: 0, reason: 'Soğuk servis' }, ctx(), stored(s, cash.id)));
  apply(s => adjustPayment(s, who.owner, { requestId: randomUUID(), paymentId: card.id, revision: 0, kind: 'method', amount: 0, method: 'cash', commission: 0, reason: 'Yanlış yöntem' }, ctx(), stored(s, card.id)));
  return { made, end: () => t, setTime: (v: number) => { t = v; }, cash, card };
}
/** Everything the business ever recorded, read back from long-term history plus the floor. */
function everything(store: Store, tenant: string): State {
  const s = store.read(tenant), view = store.history.view(tenant, s, -Infinity, Infinity);
  return { ...view, expenses: store.history.expenses(tenant, -Infinity, Infinity), paymentAdjustments: view.paymentAdjustments };
}
const serverFinancial = (store: Store, tenant: string, from: string, to: string) => { const s = store.read(tenant), { start, end } = reportRange(from, to); return financialFrom(store.history.reportDays(tenant, s, start, end), from, to, start, end, store.history.adjustments(tenant, start, end), store.history.expenses(tenant, start, end)); };
const snapshotBytes = (store: Store, tenant: string) => Number((store.db.prepare('SELECT length(payload) AS n FROM snapshots WHERE tenant=?').get(tenant) as { n: number }).n);
async function http(store: Store, now: () => Date) {
  licensed(store); const server = createServer(createApp(store, now)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const jar = new Map<string, Map<string, string>>();
  const call = async (user: string, path: string, body?: unknown) => {
    const cookies = jar.get(user) ?? new Map(); jar.set(user, cookies);
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const value of response.headers.getSetCookie()) { const [k, v] = value.split(';')[0].split('='); cookies.set(k, v); }
    return { status: response.status, data: await response.json() as any };
  };
  const login = async (user: string) => assert.equal((await call(user, '/login', { username: user, password: DEMO_PASSWORD })).status, 200);
  return { call, login, close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }) };
}

test('settled accounts leave the snapshot without losing data or changing any report', async () => {
  const store = new Store(folder('history-move'), ['mola-demo']), tenant = 'mola-demo', start = Date.parse('2026-09-01T06:00:00Z');
  try {
    const run = scenario({ store, tenant }, start, 10);
    run.setTime(start + 12 * DAY); store.mutate(tenant, () => {});
    const s = store.read(tenant);
    // The floor is empty again: nothing closed stays in the snapshot, nor any audit, replay, expense or correction.
    assert.deepEqual([s.accounts.length, s.orders.length, s.payments.length, s.archives.length, Object.keys(s.requests).length, s.audit.length, s.expenses?.length ?? 0, s.paymentAdjustments?.length ?? 0], [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.ok(snapshotBytes(store, tenant) < 20000, `snapshot ${snapshotBytes(store, tenant)} bytes`);
    const all = everything(store, tenant);
    assert.equal(new Set(all.archives.flatMap(a => a.orders).map(o => o.id)).size, run.made.orders);
    assert.equal(all.archives.flatMap(a => a.payments).length, run.made.payments.length);
    assert.equal(all.expenses!.length, run.made.expenses); assert.equal(all.paymentAdjustments!.length, 2);
    assert.ok(all.archives.some(a => (a as ArchivedAccount).synthetic && a.orders.every(o => o.status === 'cancelled')), 'an empty close keeps its cancelled order');
    assert.ok(store.auditLog(tenant).filter(a => a.action === 'expense.recorded').length === run.made.expenses);
    // Live rules that used to scan history: order numbers and campaign quotas continue exactly.
    assert.equal(s.orderNumberBase, run.made.orders);
    assert.equal(campaignViews(s)[0].usedQuantity, campaignViews(all)[0].usedQuantity); assert.ok(campaignViews(s)[0].usedQuantity > 0);
    const clock = () => new Date(run.end());
    const web = await http(store, clock);
    try {
      await web.login('isletme');
      for (const [from, to] of [['2026-09-01', '2026-09-12'], ['2026-09-04', '2026-09-04'], ['2026-09-03', '2026-09-06'], ['all', 'all'], ['2026-08-20', '2026-08-25']]) {
        const q = `?from=${from}&to=${to}`;
        assert.deepEqual((await web.call('isletme', `/staff/reports/financial${q}`)).data, json(financialReport(all, from, to)), `financial ${from}–${to}`);
        assert.deepEqual((await web.call('isletme', `/staff/reports/employees${q}`)).data, json(employeeReport(all, from, to)), `employees ${from}–${to}`);
        // `expenseParts`: the Giderler card's breakdown (read from the expense records), not a figure of the overview itself.
        const { expenseParts: _parts, ...overview } = (await web.call('isletme', `/staff/reports/overview${q}`)).data;
        assert.deepEqual(overview, json(salesOverview(all, from, to, clock())), `overview ${from}–${to}`);
        assert.deepEqual((await web.call('isletme', `/staff/reports/products${q}`)).data, json(productSales(all, from, to)), `products ${from}–${to}`);
        // The payment statement, any range or all time, lists exactly what the full history holds; long ranges count apart.
        // A search over many days may pause after LEDGER_BUDGET_MS of wall time (likely on a busy test machine) and answer
        // with fewer rows and a day cursor ("…|"); the screen then asks on from there for the rest (PaymentAdjustments.tsx).
        // The helper does the same, so the page compared is the whole page whatever the machine's speed.
        const ledger = async (filter: string, limit: number, before?: string) => {
          const get = async (n: number, cursor?: string) => (await web.call('isletme', `/staff/payment-adjustments${q}&filter=${filter}&limit=${n}${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`)).data;
          const page = await get(limit, before);
          while (page.next?.endsWith('|') && page.rows.length < limit) { const more = await get(limit - page.rows.length, page.next); page.rows.push(...more.rows); page.next = more.next; }
          return page.total === null ? { ...page, ...(await web.call('isletme', `/staff/payment-adjustments/totals${q}&filter=${filter}`)).data } : page;
        };
        for (const filter of ['all', 'cash', 'card', 'corrected'] as const) {
          const first = await ledger(filter, 7);
          assert.deepEqual(first, json(paymentLedgerPage(all, { from, to, filter, limit: 7 })), `ledger ${from}–${to} ${filter}`);
          if (first.next) assert.deepEqual(await ledger(filter, 7, first.next), json(paymentLedgerPage(all, { from, to, filter, limit: 7, before: first.next })), `ledger ${from}–${to} ${filter} page 2`);
        }
      }
      assert.deepEqual((await web.call('isletme', '/staff/reports/campaigns')).data, json(campaignReport(all, clock())));
      // A new order continues the numbering; the popular badges still see last month's sales.
      const state = (await web.call('isletme', '/staff/state')).data;
      assert.ok(state.popularProductIds.includes('tea'));
      const next = await web.call('isletme', '/staff/orders', { requestId: randomUUID(), tableId: 'table-3', lines: [{ productId: 'herbal', quantity: 1, selections: [] }], expectedTotal: 8500 });
      assert.equal(next.status, 200); assert.equal(next.data.number, run.made.orders + 1);
    } finally { await web.close(); }
  } finally { store.close(); }
});

test('a normal action stays small and fast however long the history is', () => {
  const store = new Store(folder('history-flat'), ['mola-demo']), tenant = 'mola-demo', who = people(tenant);
  let t = Date.parse('2026-01-05T07:00:00Z'); store.clock = () => new Date(t);
  try {
    const template = seed(tenant); template.changeSeconds = 0;
    submitOrder(template, who.owner, { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 2, selections: [] }, { productId: 'cheesecake', quantity: 1, selections: [] }], expectedTotal: 26000 }, { now: new Date(t), id: randomUUID });
    const order = { ...template.orders[0], status: 'served' as const };
    const timed = (n: number) => { const begin = performance.now(); for (let i = 0; i < n; i++) store.mutate(tenant, s => { s.businessRevision = (s.businessRevision ?? 0) + 1; s.audit.push({ action: 'test.touch', actor: 'isletme', target: String(i), at: new Date(t).toISOString() }); }); return (performance.now() - begin) / n; };
    const before = { bytes: snapshotBytes(store, tenant), ms: timed(20) };
    // Three thousand settled tables, as a busy café closes in about ten days, written in batches.
    for (let batch = 0; batch < 6; batch++) store.mutate(tenant, s => {
      for (let i = 0; i < 500; i++) {
        const accountId = randomUUID(), at = new Date(t - (batch * 500 + i) * 5 * MIN - DAY).toISOString(), o = { ...structuredClone(order), id: randomUUID(), accountId, createdAt: at };
        const payment = { id: randomUUID(), accountId, amount: o.total, tendered: o.total, change: 0, method: 'card' as const, createdAt: at, commission: 390, campaignAmount: 0 };
        s.accounts.push({ id: accountId, tableId: 'table-1', status: 'closed', version: 3, openedAt: at, closedAt: at }); s.orders.push(o); s.payments.push(payment);
        s.archives.push({ id: randomUUID(), accountId, tableName: 'Masa 01', closedAt: at, total: o.total, cash: 0, card: o.total, orders: [o], payments: [payment] });
      }
    });
    assert.equal(store.history.counts().archives, 3000);
    const after = { bytes: snapshotBytes(store, tenant), ms: timed(20) };
    assert.ok(after.bytes < before.bytes + 2000, `snapshot grew from ${before.bytes} to ${after.bytes} bytes`);
    assert.ok(after.ms < Math.max(3 * before.ms, before.ms + 15), `write took ${after.ms.toFixed(2)} ms, was ${before.ms.toFixed(2)} ms`);
    assert.equal(store.read(tenant).orderNumberBase, 3000);
    const all = serverFinancial(store, tenant, 'all', 'all');
    assert.equal(all.orderCount, 3000); assert.equal(all.card, 3000 * 26000); assert.equal(all.commission, 3000 * 390);
  } finally { store.close(); }
});

test('an old-style snapshot moves to the history tables once, safely and atomically per business', () => {
  const directory = folder('history-legacy'), master = randomBytes(32), start = Date.parse('2026-08-03T06:00:00Z');
  writeFileSync(join(directory, 'development.key'), master);
  // Version 1 data: whole history inside each business snapshot.
  const legacy = ['one', 'two'].map(tenant => {
    const s = { ...seed(tenant), staffUsers: initialUsers(tenant === 'one' ? 'mola-demo' : tenant) };
    scenario({ state: s }, start, 6, 4);
    s.setupCompleted = true; s.audit.unshift({ action: 'business.configured', actor: 'isletme', target: tenant, at: '2026-08-01T09:00:00.000Z' });
    return s;
  });
  const db = new DatabaseSync(join(directory, 'merchant.sqlite'));
  db.exec('CREATE TABLE snapshots (tenant TEXT PRIMARY KEY, payload BLOB NOT NULL); PRAGMA user_version=1');
  for (const s of legacy) db.prepare('INSERT INTO snapshots VALUES (?,?)').run(s.tenantId, seal(s, master, s.tenantId));
  // A crash while the second business moves: its transaction rolls back, the first stays moved.
  db.exec('CREATE TABLE history_audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, payload BLOB NOT NULL)');
  db.exec("CREATE TRIGGER fail_two BEFORE INSERT ON history_audit WHEN NEW.tenant='two' BEGIN SELECT RAISE(ABORT, 'simulated crash'); END");
  db.close();
  const reports = legacy.map(s => ({ financial: json(financialReport(s, '2026-08-01', '2026-08-31')), employees: json(employeeReport(s, 'all', 'all')), usage: campaignViews(s)[0].usedQuantity, orders: s.orders.length }));
  assert.throws(() => new Store(directory, []), /simulated crash/);
  const siblings = () => readdirSync(dirname(directory)).filter(n => n.startsWith(`${basename(directory)}-tasima-oncesi-`));
  assert.equal(siblings().length, 1);
  const copy = join(dirname(directory), siblings()[0]);
  assert.ok(existsSync(join(copy, 'development.key')));
  const old = new DatabaseSync(join(copy, 'merchant.sqlite'), { readOnly: true });
  try { assert.equal(Number(old.prepare('PRAGMA user_version').get()!.user_version), 1); assert.equal((old.prepare('SELECT count(*) AS n FROM snapshots').get() as { n: number }).n, 2); } finally { old.close(); }
  const half = new DatabaseSync(join(directory, 'merchant.sqlite'));
  try {
    assert.equal((half.prepare("SELECT count(*) AS n FROM history_archives WHERE tenant='two'").get() as { n: number }).n, 0);
    assert.ok((half.prepare("SELECT count(*) AS n FROM history_archives WHERE tenant='one'").get() as { n: number }).n > 0);
    half.exec('DROP TRIGGER fail_two');
  } finally { half.close(); }
  let store = new Store(directory, []);
  try {
    assert.equal(siblings().length, 1, 'the safety copy is taken only once');
    // Straight on to version 3: the version 1 copy already covers this upgrade, so no second copy is taken.
    assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 3);
    for (const [i, tenant] of ['one', 'two'].entries()) {
      const s = store.read(tenant);
      assert.deepEqual([s.archives.length, s.audit.length, Object.keys(s.requests).length, s.expenses?.length ?? 0, s.paymentAdjustments?.length ?? 0, s.orders.length], [0, 0, 0, 0, 0, 0]);
      assert.deepEqual(serverFinancial(store, tenant, '2026-08-01', '2026-08-31'), reports[i].financial);
      const { start: a, end: b } = reportRange('all', 'all');
      assert.deepEqual(json(employeeFrom(mergeDays(store.history.reportDays(tenant, s, a, b)), s.staffUsers, 'all', 'all')), reports[i].employees);
      assert.equal(campaignViews(s)[0].usedQuantity, reports[i].usage); assert.equal(s.orderNumberBase, reports[i].orders);
      assert.equal(store.directoryEntry(tenant).setupCompletedAt, '2026-08-01T09:00:00.000Z');
    }
    assert.equal(store.history.counts().requests, 0, 'replays without a time are dropped');
    const counts = store.history.counts(); store.close();
    store = new Store(directory, []);
    assert.deepEqual(store.history.counts(), counts, 'opening again moves nothing twice');
    assert.equal(siblings().length, 1);
  } finally { store.close(); }
});

test('a refund on an archived account changes the refund day; a method change rewrites the payment day', async () => {
  const directory = folder('history-refund'), store = new Store(directory, ['mola-demo']), tenant = 'mola-demo', who = people(tenant), start = Date.parse('2026-09-01T06:00:00Z');
  try {
    const run = scenario({ store, tenant }, start, 4, 3);
    run.setTime(start + 6 * DAY); store.mutate(tenant, () => {});
    const day = (at: number) => new Date(at + 3 * 3600000).toISOString().slice(0, 10);
    const paymentDay = day(run.card.at), refundDay = day(start + 6 * DAY);
    const card = run.card, cash = run.made.payments.find(p => p.method === 'cash' && day(p.at) === paymentDay && p.id !== card.id && p.amount > 1500)!;
    const before = { paid: serverFinancial(store, tenant, paymentDay, paymentDay), refund: serverFinancial(store, tenant, refundDay, refundDay) };
    const summary = () => store.db.prepare('SELECT payload FROM history_days WHERE tenant=? AND day=?').get(tenant, paymentDay) as { payload: Uint8Array } | undefined;
    assert.ok(summary(), 'the payment day summary is stored');
    const ctx = { now: new Date(start + 6 * DAY), id: randomUUID };
    store.mutate(tenant, s => adjustPayment(s, who.owner, { requestId: randomUUID(), paymentId: cash.id, revision: 0, kind: 'refund', amount: 500, method: 'cash', commission: 0, reason: 'Eksik ürün' }, ctx, store.history.paymentForAdjustment(tenant, s, cash.id)));
    const afterRefund = { paid: serverFinancial(store, tenant, paymentDay, paymentDay), refund: serverFinancial(store, tenant, refundDay, refundDay) };
    assert.equal(afterRefund.refund.refundTotal, before.refund.refundTotal + 500); assert.equal(afterRefund.refund.cashRefunds, before.refund.cashRefunds + 500);
    assert.equal(afterRefund.paid.collected, before.paid.collected); assert.equal(afterRefund.paid.refundTotal, before.paid.refundTotal);
    // The archived card payment was already moved to cash once (revision 1); move it back to card.
    assert.throws(() => store.mutate(tenant, s => adjustPayment(s, who.owner, { requestId: randomUUID(), paymentId: card.id, revision: 0, kind: 'method', amount: 0, method: 'card', commission: 30, reason: 'Kart' }, ctx, store.history.paymentForAdjustment(tenant, s, card.id))), /değişti/);
    store.mutate(tenant, s => adjustPayment(s, who.owner, { requestId: randomUUID(), paymentId: card.id, revision: 1, kind: 'method', amount: 0, method: 'card', commission: 30, reason: 'Kart' }, ctx, store.history.paymentForAdjustment(tenant, s, card.id)));
    const afterMethod = serverFinancial(store, tenant, paymentDay, paymentDay);
    assert.equal(afterMethod.card, afterRefund.paid.card + card.amount); assert.equal(afterMethod.cash, afterRefund.paid.cash - card.amount); assert.equal(afterMethod.commission, afterRefund.paid.commission + 30);
    assert.deepEqual(serverFinancial(store, tenant, refundDay, refundDay), afterRefund.refund);
    assert.deepEqual(serverFinancial(store, tenant, '2026-09-01', '2026-09-08'), json(financialReport(everything(store, tenant), '2026-09-01', '2026-09-08')));
    // Backups carry and verify the history tables.
    await validateBackupDatabase(join(directory, 'merchant.sqlite'), join(directory, 'development.key'));
    const key = snapshotKey(store.db, store.key, tenant)!;
    store.db.prepare("UPDATE history_archives SET payload=? WHERE rowid=(SELECT min(rowid) FROM history_archives)").run(seal({ forged: true }, key, `archive:${tenant}:other`));
    await assert.rejects(validateBackupDatabase(join(directory, 'merchant.sqlite'), join(directory, 'development.key')));
  } finally { store.close(); }
});

test('sales overview matches the financial report and compares with the previous period of equal length', async () => {
  const store = new Store(folder('history-overview'), ['mola-demo', 'other-demo']), tenant = 'mola-demo', start = Date.parse('2026-09-01T06:00:00Z');
  const run = scenario({ store, tenant }, start, 14, 4);
  run.setTime(start + 13 * DAY + 20 * 3600000);
  store.mutate(tenant, s => submitOrder(s, people(tenant).owner, { requestId: randomUUID(), tableId: 'table-11', lines: [{ productId: 'herbal', quantity: 1, selections: [] }], expectedTotal: 8500 }, { now: new Date(run.end()), id: randomUUID }));
  const web = await http(store, () => new Date(run.end()));
  try {
    await web.login('isletme'); await web.login('garson'); await web.login('diger');
    const week = '?from=2026-09-08&to=2026-09-14', previous = '?from=2026-09-01&to=2026-09-07';
    const overview = (await web.call('isletme', `/staff/reports/overview${week}`)).data, now = (await web.call('isletme', `/staff/reports/financial${week}`)).data, then = (await web.call('isletme', `/staff/reports/financial${previous}`)).data;
    const kept = (f: any) => f.collected - f.commission - f.expenseTotal - f.refundTotal;
    assert.deepEqual(Object.keys(overview).sort(), ['averageAccount', 'cancelled', 'card', 'cash', 'channels', 'closedAccounts', 'daily', 'expenseParts', 'expenses', 'hourly', 'kept', 'openAccounts', 'orders', 'platform', 'posCommission', 'previous', 'range', 'refunds', 'sales', 'topProducts', 'unknownCommission']);
    assert.deepEqual(overview.range, { from: '2026-09-08', to: '2026-09-14', days: 7 });
    assert.deepEqual([overview.sales, overview.cash, overview.card, overview.posCommission, overview.expenses, overview.refunds, overview.kept, overview.orders, overview.cancelled, overview.unknownCommission],
      [now.collected, now.cash, now.card, now.commission, now.expenseTotal, now.refundTotal, kept(now), now.orderCount, { count: now.cancelledCount, amount: now.cancelledAmount }, { count: now.unknownCommissionCount, amount: now.unknownCommissionAmount }]);
    assert.deepEqual(overview.previous, { from: '2026-09-01', to: '2026-09-07', sales: then.collected, kept: kept(then) });
    assert.ok(overview.closedAccounts > 0); assert.equal(overview.averageAccount, Math.round(overview.sales / overview.closedAccounts));
    assert.deepEqual(overview.daily, now.days.map((d: any) => ({ day: d.date, sales: d.total })));
    assert.equal(overview.hourly.length, 24); assert.equal(overview.hourly.reduce((n: number, h: any) => n + h.sales, 0), now.collected); assert.equal(overview.hourly.reduce((n: number, h: any) => n + h.orders, 0), now.orderCount);
    assert.ok(overview.topProducts.length > 0 && overview.topProducts.length <= 5 && overview.topProducts.every((p: any, i: number, all: any[]) => Object.keys(p).sort().join() === 'amount,id,name,qty' && (!i || all[i - 1].amount >= p.amount)));
    // The table opened last is unpaid: its balance is shown apart from sales, only for a period holding today (15 September, K-O).
    assert.equal(overview.openAccounts, null);
    assert.equal((await web.call('isletme', '/staff/reports/overview?from=2026-09-15&to=2026-09-15')).data.openAccounts, 8500);
    const products = (await web.call('isletme', `/staff/reports/products${week}`)).data;
    assert.deepEqual(new Map(products.products.map((p: any) => [p.id, [p.qty, p.amount]])), new Map(now.products.map((p: any) => [p.id, [p.quantity, p.amount]])));
    assert.equal(products.total, now.products.reduce((n: number, p: any) => n + p.amount, 0)); assert.ok(products.products.every((p: any) => typeof p.category === 'string' && p.category));
    assert.ok(Math.abs(products.products.reduce((n: number, p: any) => n + p.share, 0) - 1) < 1e-9);
    const all = (await web.call('isletme', '/staff/reports/overview?from=all&to=all')).data;
    assert.equal(all.previous, null); assert.equal(all.sales, (await web.call('isletme', '/staff/reports/financial?from=all&to=all')).data.collected);
    // The open order was taken after midnight, on 15 September.
    assert.deepEqual(all.range, { from: '2026-09-01', to: '2026-09-15', days: 15 }); assert.equal(all.daily.length, 15);
    // Same owner-only rules and limits as the financial report; another business sees only its own empty data.
    assert.equal((await web.call('garson', `/staff/reports/overview${week}`)).status, 403);
    assert.equal((await web.call('garson', `/staff/reports/products${week}`)).status, 403);
    assert.equal((await web.call('isletme', '/staff/reports/overview?from=2026-01-01&to=2027-06-01')).status, 400);
    assert.equal((await web.call('isletme', '/staff/reports/overview?from=all&to=2026-09-01')).status, 400);
    assert.equal((await web.call('diger', `/staff/reports/overview${week}`)).data.sales, 0);
  } finally { await web.close(); store.close(); }
});

test('weighed products: day summaries keep grams (live and stored), follow weight edits, ignore refunds and rebuild old cached days', async () => {
  const store = new Store(folder('history-grams'), ['mola-demo']), tenant = 'mola-demo', who = people(tenant), day = '2026-09-01';
  let t = Date.parse('2026-09-01T07:00:00Z'); store.clock = () => new Date(t);
  const ctx = () => ({ now: new Date(t), id: randomUUID });
  try {
    store.mutate(tenant, s => { s.changeSeconds = 60; s.products.push({ id: 'baklava', code: '60', name: 'Fıstıklı Baklava', nameEn: '', category: 'Tatlılar', description: '', price: 120000, soldOut: false, art: 'cake', unit: 'kg', groups: [] }); });
    const guest = { tenantId: tenant, id: 'phone-1', role: 'guest' as const, tableId: 'table-1', epoch: store.read(tenant).tables.find(x => x.id === 'table-1')!.epoch };
    const placed = store.mutate(tenant, s => submitOrder(s, guest, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 67000, lines: [{ productId: 'baklava', quantity: 1, selections: [], grams: 500, note: 'Ayrı paket' }, { productId: 'tea', quantity: 2, selections: [] }] }, ctx()));
    // The guest changes 500 g to 1,5 kg inside the change window: reports count the final weight.
    t += 5000;
    store.mutate(tenant, s => { const o = s.orders.find(o => o.id === placed.orderId)!; return editOrder(s, guest, { requestId: randomUUID(), orderId: o.id, version: o.version, expectedTotal: 187000, lines: o.lines.map(l => ({ productId: l.productId, quantity: l.quantity, selections: l.selections, existingId: l.id, ...(l.grams ? { grams: 1500 } : {}), ...(l.note ? { note: l.note } : {}) })) }, ctx()); });
    t += 60000;
    store.mutate(tenant, s => submitOrder(s, who.owner, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 30000, lines: [{ productId: 'baklava', quantity: 1, selections: [], grams: 250 }] }, ctx()));
    t += 30 * MIN;
    const paid = store.mutate(tenant, s => recordPayment(s, who.cashier, { requestId: randomUUID(), accountId: placed.accountId, version: s.accounts.find(a => a.id === placed.accountId)!.version, method: 'cash', amount: 217000, tendered: 217000 }, ctx()));
    const { start, end } = reportRange(day, day);
    const products = () => mergeDays(store.history.reportDays(tenant, store.read(tenant), start, end)).products;
    const expected = { first: 'Fıstıklı Baklava', last: 'Fıstıklı Baklava', quantity: 2, amount: 210000, grams: 1750 };
    // Live (on the floor) and the in-memory report path agree.
    assert.deepEqual(products().get('baklava'), expected); assert.equal(products().get('tea')!.grams, 0);
    assert.deepEqual(productSales(everything(store, tenant), day, day).products.find(p => p.id === 'baklava'), { id: 'baklava', name: 'Fıstıklı Baklava', category: 'Tatlılar', qty: 2, amount: 210000, share: 210000 / 217000, unit: 'kg', grams: 1750 });
    // Settled and stored: the same numbers; a refund changes money, never the weight sold.
    t += 25 * 3600000; store.mutate(tenant, () => {});
    assert.equal(store.read(tenant).orders.length, 0);
    assert.deepEqual(products().get('baklava'), expected);
    const before = json(serverFinancial(store, tenant, day, day));
    store.mutate(tenant, s => adjustPayment(s, who.owner, { requestId: randomUUID(), paymentId: paid.paymentId, revision: 0, kind: 'refund', amount: 50000, method: 'cash', commission: 0, reason: 'Eksik tartı' }, ctx(), store.history.paymentForAdjustment(tenant, s, paid.paymentId)));
    assert.deepEqual(products().get('baklava'), expected);
    assert.deepEqual(json(serverFinancial(store, tenant, day, day)), before, 'the refund is counted on its own day');
    // Cached summaries: the current version is trusted as stored; an older version (no grams) is rebuilt.
    const key = snapshotKey(store.db, store.key, tenant)!, scope = `summary:${tenant}:${day}`;
    const row = () => open<{ v: number; s: DaySummary }>(Buffer.from((store.db.prepare('SELECT payload FROM history_days WHERE tenant=? AND day=?').get(tenant, day) as { payload: Uint8Array }).payload), key, scope);
    assert.equal(row().v, SUMMARY_VERSION);
    const cached = row().s, write = (v: number, s: DaySummary) => store.db.prepare('UPDATE history_days SET payload=? WHERE tenant=? AND day=?').run(seal({ v, s }, key, scope), tenant, day);
    write(SUMMARY_VERSION, { ...cached, products: cached.products.map(p => p[0] === 'baklava' ? [p[0], p[1], p[2], p[3], p[4], 12345] as DaySummary['products'][number] : p) });
    assert.equal(products().get('baklava')!.grams, 12345, 'a current cached day is read, not rebuilt');
    write(SUMMARY_VERSION - 1, { ...cached, products: cached.products.map(([id, first, last, quantity, amount]) => [id, first, last, quantity + 99, amount] as DaySummary['products'][number]) });
    assert.deepEqual(products().get('baklava'), expected);
    assert.equal(row().v, SUMMARY_VERSION); assert.deepEqual(row().s, cached);
    // The API adds `grams` to weighed products only; existing fields keep their meaning.
    const web = await http(store, () => new Date(t));
    try {
      await web.login('isletme');
      const report = (await web.call('isletme', `/staff/reports/products?from=${day}&to=${day}`)).data, overview = (await web.call('isletme', `/staff/reports/overview?from=${day}&to=${day}`)).data;
      assert.deepEqual(report, json(productSales(everything(store, tenant), day, day)));
      assert.deepEqual(report.products.map((p: any) => [p.id, p.qty, p.amount, p.unit, p.grams]), [['baklava', 2, 210000, 'kg', 1750], ['tea', 2, 7000, undefined, undefined]]);
      assert.deepEqual(overview.topProducts.map((p: any) => [p.id, p.qty, p.grams]), [['baklava', 2, 1750], ['tea', 2, undefined]]);
      assert.equal('grams' in overview.topProducts[1], false);
      // The settled payment's details carry weight and note.
      const detail = (await web.call('isletme', `/staff/payment-adjustments/${paid.paymentId}`)).data;
      assert.deepEqual(detail.items, [{ productId: 'baklava', name: 'Fıstıklı Baklava', optionNames: [], quantity: 1, total: 180000, grams: 1500, note: 'Ayrı paket' }, { productId: 'tea', name: 'Demleme Çay', optionNames: [], quantity: 2, total: 7000 }, { productId: 'baklava', name: 'Fıstıklı Baklava', optionNames: [], quantity: 1, total: 30000, grams: 250 }]);
    } finally { await web.close(); }
  } finally { store.close(); }
});

test('all-time overview spans the days that have records and groups very long ranges by month', () => {
  const empty = salesOverview(seed(), 'all', 'all', new Date('2026-10-03T12:00:00Z'));
  assert.deepEqual(empty.range, { from: '2026-10-03', to: '2026-10-03', days: 1 }); assert.deepEqual(empty.daily, [{ day: '2026-10-03', sales: 0 }]);
  const s = seed(), owner = people(s.tenantId).owner;
  for (const at of ['2025-01-10T10:00:00Z', '2026-09-28T10:00:00Z']) {
    const ctx = { now: new Date(at), id: randomUUID };
    const o = submitOrder(s, owner, { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, ctx);
    recordPayment(s, owner, { requestId: randomUUID(), accountId: o.accountId, version: s.accounts.find(a => a.id === o.accountId)!.version, method: 'cash', amount: 3500, tendered: 3500 }, ctx);
  }
  const all = salesOverview(s, 'all', 'all');
  assert.equal(all.range.from, '2025-01-10'); assert.equal(all.range.to, '2026-09-28'); assert.equal(all.range.days, 627);
  assert.equal(all.daily.length, 21); assert.deepEqual(all.daily[0], { day: '2025-01', sales: 3500 }); assert.deepEqual(all.daily.at(-1), { day: '2026-09', sales: 3500 });
  assert.equal(all.daily.reduce((n, d) => n + d.sales, 0), all.sales);
});

test('payment history reads per-day payment lists, opens only the accounts it shows and follows new settlements', async () => {
  const directory = folder('history-payment-days'), store = new Store(directory, ['mola-demo']), tenant = 'mola-demo', who = people(tenant), start = Date.parse('2026-09-01T06:00:00Z');
  const day = (at: number) => new Date(at + 3 * 3600000).toISOString().slice(0, 10);
  try {
    // A table opened the day before everything else and paid after everything else: the all-time range starts with it.
    let t = start - DAY; store.clock = () => new Date(t);
    const ctx = () => ({ now: new Date(t), id: randomUUID });
    const pay = (accountId: string, amount: number) => store.mutate(tenant, s => recordPayment(s, who.cashier, { requestId: randomUUID(), accountId, version: s.accounts.find(a => a.id === accountId)!.version, method: 'cash', amount, tendered: amount }, ctx()));
    const early = store.mutate(tenant, s => submitOrder(s, who.owner, { requestId: randomUUID(), tableId: 'table-10', lines: [{ productId: 'herbal', quantity: 1, selections: [] }], expectedTotal: 8500 }, ctx()));
    const run = scenario({ store, tenant }, start, 5, 4);
    const paidAt = run.end() + 3600000; t = paidAt; store.clock = () => new Date(t); pay(early.accountId, 8500);
    t = paidAt + 25 * 3600000; store.mutate(tenant, () => {});
    const s = store.read(tenant);
    assert.equal(s.accounts.length, 0);
    assert.equal([...store.history.reportDays(tenant, s, -Infinity, Infinity).keys()][0], day(start - DAY));
    const whole = [day(start - DAY), day(paidAt + DAY)], ranges = [whole, [day(start - DAY), day(start + 2 * DAY)], [day(start + DAY), day(start + DAY)], ['all', 'all'], ['2026-01-01', '2026-12-31']];
    const same = () => {
      const now = store.read(tenant), all = everything(store, tenant);
      for (const [from, to] of ranges) for (const filter of ['all', 'cash', 'corrected'] as const) {
        let before: string | undefined;
        do {
          const q = { from, to, filter, limit: 9, before }, page = store.history.paymentLedger(tenant, now, q, Infinity);
          const counted = page.total === null ? { ...page, ...drain(store.history.ledgerTotals(tenant, now, q)) } : page;
          assert.deepEqual(json(counted), json(paymentLedgerPage(all, q)), `${from}–${to} ${filter} ${before}`); before = page.next ?? undefined;
        } while (before);
      }
    };
    same();
    // Warm: no settled account is opened to list payments; a row's details open exactly its own account.
    const history = store.history as unknown as { archives: (...args: unknown[]) => unknown[] }, archives = history.archives.bind(store.history);
    let opened = 0; history.archives = (...args) => { const rows = archives(...args); opened += rows.length; return rows; };
    const result = store.history.paymentLedger(tenant, s, { from: whole[0], to: whole[1], limit: 500 }, Infinity);
    assert.equal(opened, 0); assert.ok(result.total! > 20 && result.total === result.rows.length && result.next === null);
    const all = everything(store, tenant); opened = 0;
    for (const row of result.rows.slice(0, 5)) {
      const detail = paymentDetail(s, row.id, () => store.history.paymentAccount(tenant, row.id));
      assert.ok(detail.items.length > 0); assert.deepEqual(detail, paymentDetail(all, row.id, () => undefined));
    }
    assert.equal(opened, 0);
    assert.throws(() => paymentDetail(s, 'missing', () => store.history.paymentAccount(tenant, 'missing')), /bulunamadı/);
    // A table settling on a day whose list is already stored appears at once.
    t = paidAt + 30 * MIN;
    const late = store.mutate(tenant, s => submitOrder(s, who.owner, { requestId: randomUUID(), tableId: 'table-11', lines: [{ productId: 'herbal', quantity: 2, selections: [] }], expectedTotal: 17000 }, ctx()));
    t = paidAt + 40 * MIN; store.clock = () => new Date(paidAt + 25 * 3600000); pay(late.accountId, 17000);
    assert.equal(store.read(tenant).accounts.length, 0, 'settled at once: closed long enough ago');
    opened = 0; same(); assert.ok(opened > 0, 'the changed day was rebuilt');
    // Backups verify the per-day lists like every other sealed history row.
    await validateBackupDatabase(join(directory, 'merchant.sqlite'), join(directory, 'development.key'));
    store.db.prepare('UPDATE history_payment_days SET payload=? WHERE rowid=(SELECT min(rowid) FROM history_payment_days)').run(seal({ v: 1, accounts: [] }, snapshotKey(store.db, store.key, tenant)!, `payment-day:${tenant}:other`));
    await assert.rejects(validateBackupDatabase(join(directory, 'merchant.sqlite'), join(directory, 'development.key')));
  } finally { store.close(); }
});
