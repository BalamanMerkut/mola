import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { snapshotKey, Store } from '../server/store.js';
import { openText } from '../server/sealing.js';
import { CashBook } from '../server/cash-closing.js';
import { ShiftBook } from '../server/shifts.js';
import { StockBook } from '../server/stock.js';
import { ReservationBook } from '../server/reservations.js';
import { drain } from '../server/history.js';
import { YearPacker } from '../server/year-packer.js';
import { PACKAGE_TABLES } from '../server/year-packages.js';
import { addDays, businessDay, dayStart, DAY_MS } from '../packages/domain/business-day.js';
import { recordPayment, submitOrder, quote } from '../packages/domain/engine.js';
import { saleProducts } from '../packages/domain/campaigns.js';
import { recordExpense } from '../packages/domain/expenses.js';
import { adjustPayment } from '../packages/domain/payment-adjustments.js';
import { noShowReservation, saveReservation, seatReservation } from '../packages/domain/reservation-rules.js';
import { financialFrom, overviewFrom, periodVatOf, productsFrom, reportRange } from '../packages/domain/reports.js';
import { stockLevels } from '../packages/domain/stock.js';
import type { Actor, CartLine, State } from '../packages/domain/types.js';
import { temp } from './merkez-fixture.js';

/*
 * The café of the year package tests (tests/year-packages.test.ts, tests/year-package-backups.test.ts): business days with staff
 * and QR bills, cash and card, tips, expenses, gün sonu, shifts, stock and a reservation; igures reads every figure the
 * screens, exports and stock show, so "the same before and after packaging" is one deepEqual.
 */
export const MIN = 60_000, HOUR = 3_600_000, tenant = 'mola-demo';
export const who = { owner: { tenantId: tenant, id: 'isletme', role: 'owner' } as Actor, cashier: { tenantId: tenant, id: 'kasiyer', role: 'cashier' } as Actor, waiter: { tenantId: tenant, id: 'garson', role: 'waiter' } as Actor };
function rng(seed: number) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }

/** A café open on the given business days: staff and QR bills, cash and card, tips, expenses, gün sonu, shifts, stock. */
/** key: the master key of a protected computer (KeyVault); without it the development key file. */
export function cafe(dir: string, days: string[], key?: Buffer) {
  const store = new Store(dir, [tenant], key ? { key } : {}), cash = new CashBook(store), shifts = new ShiftBook(store), stock = new StockBook(store), reservations = new ReservationBook(store), random = rng(5);
  let t = dayStart(days[0]) - DAY_MS;
  store.clock = () => new Date(t);
  const ctx = () => ({ now: new Date(t), id: randomUUID });
  const apply = <T>(fn: (s: State) => T) => store.mutate(tenant, fn);
  const price = (s: State, lines: CartLine[]) => quote(saleProducts(s, new Date(t)), lines, ctx()).reduce((n, l) => n + l.total, 0);
  apply(s => { s.changeSeconds = 0; s.commissionBps = 150; s.cashShift = { plans: { garson: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5, 6, 7] } } }; });
  // Stok: tea uses 5 g of Çay; bought on the first day.
  const at0 = new Date(t).toISOString();
  stock.put(tenant, 'item', { id: 'cay', name: 'Çay', unit: 'g', createdAt: at0 }, at0);
  stock.put(tenant, 'recipe', { id: 'r1', productId: 'tea', validFrom: at0, items: [{ itemId: 'cay', amount: 5 }] }, at0);
  stock.put(tenant, 'entry', { id: 'buy-1', kind: 'purchase', at: at0, by: 'isletme', itemId: 'cay', quantity: 5000, total: 50000, unitCost: 10 }, at0);
  const payments: { id: string; at: number; method: 'cash' | 'card' }[] = [];
  const bill = (table: string, actor: Actor, lines: CartLine[], method: 'cash' | 'card', tip = 0, paidAt?: number) => {
    const placed = apply(s => submitOrder(s, actor, { requestId: randomUUID(), tableId: table, lines, expectedTotal: price(s, lines) }, ctx()));
    t = paidAt ?? t + 40 * MIN;
    const paid = apply(s => {
      const a = s.accounts.find(x => x.id === placed.accountId)!, amount = s.orders.filter(o => o.accountId === a.id).reduce((n, o) => n + o.total, 0);
      const body = { requestId: randomUUID(), accountId: a.id, version: a.version, method, amount, tendered: amount + (method === 'cash' ? tip : 0) };
      return tip ? cash.payWithTip(s, who.cashier, { ...body, tendered: amount + tip, tip }, ctx()) : recordPayment(s, who.cashier, body, ctx());
    });
    payments.push({ id: paid.paymentId, at: t, method });
  };
  const products = ['tea', 'herbal', 'lemonade', 'cheesecake'];
  const open = (day: string) => {
    const start = dayStart(day);
    const shift = shifts.begin(tenant, { id: 'garson', name: 'Garson', role: 'waiter' }, new Date(start + 4 * HOUR + Math.floor(random() * 40) * MIN).toISOString());
    shifts.touch(tenant, 'mutfak', start + 4 * HOUR); shifts.touch(tenant, 'mutfak', start + 13 * HOUR);
    for (let i = 0; i < 3; i++) {
      t = start + (5 + i * 4) * HOUR + Math.floor(random() * 60) * MIN;
      const lines: CartLine[] = [{ productId: products[Math.floor(random() * products.length)], quantity: 1 + Math.floor(random() * 3), selections: [] }, { productId: 'tea', quantity: 1, selections: [] }];
      const actor: Actor = i === 0 ? { tenantId: tenant, id: `phone-${Math.floor(random() * 12)}`, role: 'guest', tableId: `table-${i + 1}`, epoch: 0 } : i === 1 ? who.waiter : who.owner;
      if (actor.role === 'guest') actor.epoch = store.read(tenant).tables.find(x => x.id === `table-${i + 1}`)!.epoch;
      bill(`table-${i + 1}`, actor, lines, random() < 0.5 ? 'cash' : 'card', random() < 0.3 ? 500 : 0);
    }
    shifts.finish(tenant, shift, new Date(start + 12 * HOUR).toISOString(), 'manual');
    t = start + 6 * HOUR; apply(s => recordExpense(s, who.cashier, { requestId: randomUUID(), amount: 2000 + Number(day.slice(8)) * 10, description: `Süt ${day}` }, ctx()));
    t = start + 18 * HOUR;
    const counted = apply(s => cash.count(s, who.cashier, { requestId: randomUUID(), mode: 'final', counted: [0, 5000, 100_000][Number(day.slice(8)) % 3] }, ctx()));
    apply(s => cash.finish(s, who.cashier, { id: counted.id, note: 'sayım' }, ctx()));
  };
  for (const day of days) open(day);
  return { store, cash, shifts, stock, reservations, payments, ctx, apply, open, bill, at: (v: number) => { t = v; }, now: () => t };
}
export type Cafe = ReturnType<typeof cafe>;
/** The packer as the server wires it (server/app.ts): cash and staff roll-ups, stock opening counts. */
export function packerFor(c: Pick<Cafe, 'store' | 'cash' | 'shifts' | 'stock' | 'now'>, more: ConstructorParameters<typeof YearPacker>[1] = {}) {
  return new YearPacker(c.store, { prepare: (tenant, s, from, to) => [c.cash.prepare(tenant, from, to), c.shifts.prepare(tenant, s, from, to, c.now(), c.cash)], opening: (tenant, s, t0, year) => c.stock.openYearSteps(tenant, s, t0, year), ...more }, () => new Date(c.now()));
}

/** Every figure the screens, exports and stock read for these ranges, as plain JSON. */
export function figures(c: Cafe, ranges: [string, string][]) {
  const { store } = c, s = store.read(tenant), now = c.now(), out: Record<string, unknown> = {};
  for (const [from, to] of ranges) {
    const { start, end } = reportRange(from, to), span = store.history.reportSpan(tenant, s, start, end);
    const overview = overviewFrom({ from, to, start, end, today: businessDay(now), days: span, previous: null, openBalance: 0, products: s.products });
    const fromDay = from === 'all' ? 'all' : from, toDay = to === 'all' ? 'all' : to;
    out[`${from}:${to}`] = {
      overview, financial: financialFrom(span, from, to, start, end, store.history.adjustments(tenant, start, end), store.history.expenses(tenant, start, end)), products: productsFrom(span, s.products), vat: periodVatOf(s, span.total),
      days: [...drain(store.history.reportDaysSteps(tenant, s, start, end))].map(([d, t]) => [d, t.toJSON()]),
      cash: c.cash.cashSpan(tenant, fromDay, toDay), staff: (() => { const v = c.shifts.staffSpan(tenant, s, fromDay, toDay, now, c.cash); return { users: [...v.users], tips: v.tips }; })(),
      closings: c.cash.newestClosings(tenant, from === 'all' ? '0000-01-01' : from, to === 'all' ? '9999-12-31' : to, 500),
      shifts: c.shifts.range(tenant, from === 'all' ? '0000-01-01' : from, to === 'all' ? '9999-12-31' : to).length,
      ledger: store.history.paymentLedger(tenant, s, { from, to, limit: 500 }, Infinity),
      reservations: c.reservations.reservations(tenant, s, from === 'all' ? '0000-01-01' : from, to === 'all' ? '9999-12-31' : to).map(r => [r.id, r.status]),
    };
  }
  out.years = store.history.years(tenant, s).map(([y, span]) => [y, span.total.toJSON()]);
  out.yearList = store.history.yearList(tenant); out.bounds = store.history.dataBounds(tenant);
  out.newest = store.history.newestLedger(tenant, 'expense', 400).length; out.audit = store.history.audit(tenant, 100000).length;
  out.stock = [...stockLevels(c.stock.data(tenant), c.stock.feed(tenant, s), now)].map(([id, l]) => [id, Math.round(l.stock * 1000) / 1000]);
  out.search = store.history.paymentLedger(tenant, s, { from: 'all', to: 'all', q: 'Masa 2', limit: 50 }, Infinity).rows.length;
  return JSON.parse(JSON.stringify(out));
}
export const RANGES: [string, string][] = [['all', 'all'], ['2024-01-01', '2024-12-31'], ['2025-01-01', '2025-12-31'], ['2025-12-31', '2025-12-31'], ['2026-01-01', '2026-01-31'], ['2025-12-01', '2026-01-15'], ['2024-12-20', '2025-01-06']];
/** Live rows inside the packaged range of each package table (0 everywhere once a year left the live file). */
export function leftInLive(store: Store, to: string) {
  const out: Record<string, number> = {}, m = { from: '0000-01-01', to, startMs: -8.64e15, endMs: dayStart(addDays(to, 1)), startIso: '', endIso: new Date(dayStart(addDays(to, 1))).toISOString(), t0: dayStart(addDays(to, 1)) };
  for (const spec of PACKAGE_TABLES) {
    if (spec.cache || !store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(spec.table)) continue;
    out[spec.table] = Number((store.db.prepare(`SELECT COUNT(*) AS n FROM ${spec.table} p WHERE ${spec.where(m, '')}`).get() as { n: number }).n);
  }
  return out;
}
/** Customers' personal data in busyCafe (2025): none of it may be in a package (tests/year-packages.test.ts). */
export const PERSONAL = { phone: '0532 111 22 33', note: 'Pencere kenarı istedi', name: 'Mehmet Demir', phone2: '0533 444 55 66', note2: 'Glutensiz menü', line: 'Az şekerli, Mehmet Bey için', browser: 'ab12'.repeat(12) };
/** Every piece of PERSONAL (and the fixture's QR guests' "phone-N" browser ids) found in any sealed row of any package. */
export function personalIn(store: Store) {
  const found: string[] = [], needles = [PERSONAL.phone, PERSONAL.note, PERSONAL.name, PERSONAL.phone2, PERSONAL.note2, PERSONAL.line, PERSONAL.browser, '"phone-', 'Ayşe'];
  for (const p of store.packages.list()) {
    const db = new DatabaseSync(store.packages.path(p.year), { readOnly: true });
    try {
      for (const spec of PACKAGE_TABLES) {
        if (!spec.scope || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(spec.table)) continue;
        for (const row of db.prepare(`SELECT ${spec.columns} FROM ${spec.table}`).iterate() as Iterable<Record<string, string> & { payload: Uint8Array }>) {
          const text = openText(Buffer.from(row.payload), snapshotKey(store.db, store.key, row.tenant)!, spec.scope(row)).json.toString('utf8');
          for (const needle of needles) if (text.includes(needle)) found.push(`${p.year} ${spec.table}: ${needle}`);
        }
      }
    } finally { db.close(); }
  }
  return found;
}
export const DAYS = [...Array.from({ length: 12 }, (_, i) => addDays('2024-12-22', i)), ...Array.from({ length: 8 }, (_, i) => addDays('2025-12-28', i)), '2026-01-20'];

/** The café of the tests below: two years and January, a bill across New Year, an old bill's refund and corrections in January. */
export function busyCafe(name: string) {
  const c = cafe(temp(name), DAYS), { store } = c;
  // A bill opened on 31 December at 23:00 and paid after the gün sonu (business day 1 January), across New Year.
  c.at(dayStart('2025-12-31') + 18 * HOUR);
  c.bill('table-5', who.waiter, [{ productId: 'tea', quantity: 4, selections: [] }], 'cash', 0, dayStart('2026-01-01') + 2 * HOUR);
  // In January (2025 still open): a refund and a method correction of December bills, a back-dated expense into December.
  c.at(dayStart('2026-01-20') + 8 * HOUR);
  const dec = c.payments.find(p => businessDay(p.at) === '2025-12-29' && p.method === 'cash')!, card = c.payments.find(p => businessDay(p.at) === '2025-12-30')!;
  c.apply(s => adjustPayment(s, who.owner, { requestId: randomUUID(), paymentId: dec.id, revision: 0, kind: 'refund', amount: 300, method: 'cash', commission: 0, reason: 'Soğuk' }, c.ctx(), store.history.paymentForAdjustment(tenant, s, dec.id)));
  c.apply(s => adjustPayment(s, who.owner, { requestId: randomUUID(), paymentId: card.id, revision: 0, kind: 'method', amount: 0, method: card.method === 'cash' ? 'card' : 'cash', commission: card.method === 'cash' ? 20 : 0, reason: 'Yanlış yöntem' }, c.ctx(), store.history.paymentForAdjustment(tenant, s, card.id)));
  c.apply(s => recordExpense(s, who.owner, { requestId: randomUUID(), amount: 99_00, description: 'Aralık faturası', day: '2025-12-30', method: 'transfer' }, c.ctx()));
  // A reservation on 29 December that did not come, moved out of the snapshot three days later.
  c.at(dayStart('2025-12-29') + 5 * HOUR);
  const r = c.apply(s => saveReservation(s, who.owner, { requestId: randomUUID(), tableId: 'table-6', day: '2025-12-29', time: '20:00', name: 'Ayşe', people: 4, phone: PERSONAL.phone, note: PERSONAL.note }, c.ctx()));
  c.at(dayStart('2025-12-29') + 17 * HOUR);
  c.apply(s => noShowReservation(s, who.owner, { requestId: randomUUID(), id: (r as { id: string }).id }, c.ctx()));
  // Customers' personal data a package leaves behind (server/package-privacy.ts), on 30 December: a reservation that came (its
  // name on the bill, a phone and a note), a guest's line note, a QR guest with a real browser id who edited the order.
  c.at(dayStart('2025-12-30') + 9 * HOUR);
  const seated = c.apply(s => saveReservation(s, who.owner, { requestId: randomUUID(), tableId: 'table-8', day: '2025-12-30', time: '15:00', name: PERSONAL.name, people: 2, phone: PERSONAL.phone2, note: PERSONAL.note2 }, c.ctx())) as { id: string };
  c.at(dayStart('2025-12-30') + 10 * HOUR);
  c.apply(s => seatReservation(s, who.waiter, { requestId: randomUUID(), id: seated.id }, c.ctx()));
  c.bill('table-8', who.waiter, [{ productId: 'tea', quantity: 2, selections: [], note: PERSONAL.line }], 'card');
  const guest: Actor = { tenantId: tenant, id: PERSONAL.browser, role: 'guest', tableId: 'table-9', epoch: c.store.read(tenant).tables.find(x => x.id === 'table-9')!.epoch };
  c.bill('table-9', guest, [{ productId: 'lemonade', quantity: 1, selections: [] }], 'cash');
  c.apply(s => { s.audit.push({ action: 'order.edited', actor: PERSONAL.browser, target: 'siparis-1', at: new Date(c.now()).toISOString() }); });
  // Every bill settles; the reservation leaves the snapshot.
  c.at(dayStart('2026-01-25')); c.apply(() => {}); c.apply(s => c.reservations.archive(s, c.now()));
  return c;
}
/** The same café's books on a store opened again (a restart, a restored copy). */
export function reopen(c: Cafe, store: Store, now = c.now): Cafe {
  store.clock = () => new Date(now());
  return { ...c, store, cash: new CashBook(store), shifts: new ShiftBook(store), stock: new StockBook(store), reservations: new ReservationBook(store), now };
}
