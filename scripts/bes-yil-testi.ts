// "5 yıllık hız ve hata testi", step 1: a café with five years of history, in a THROWAWAY folder (never a café's data).
// Every sale goes through the real domain rules (submitOrder, setStatus, recordPayment, cancelByStaff, moveTable,
// mergeAccounts, submitTakeaway, adjustPayment, recordExpense, reservations, events) on a working copy of the business,
// and the server's own books write the rest (History.persist, CashBook, ShiftBook, StockBook, AgendaBook, Notifications),
// exactly as a server running for five years would. No HTTP: a year of the busy profile takes minutes, not days.
// Alongside it the script keeps its own independent books (beklenen.json): money per business day and stock on hand,
// which scripts/bes-yil-olcum.ts compares with what the server reports.
//
//   npx tsx scripts/bes-yil-testi.ts uret --profil=orta|yogun [--yil=5] [--kok=<klasör>] [--tohum=2026] [--sil]
//   npx tsx scripts/bes-yil-testi.ts canli --profil=orta|yogun [--kok=<klasör>]    (today's floor up to now, before measuring)
//
// The default root is <temp>/mola-bes-yil (outside OneDrive). Seeded: the same command gives the same café every time.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID, scryptSync, randomBytes } from 'node:crypto';
import { Store, snapshotKey } from '../server/store.js';
import { dataLock } from '../server/data-lock.js';
import { CashBook } from '../server/cash-closing.js';
import { ShiftBook } from '../server/shifts.js';
import { StockBook } from '../server/stock.js';
import { ReservationBook } from '../server/reservations.js';
import { AgendaBook } from '../server/agenda.js';
import { Notifications } from '../server/notifications.js';
import { MerkezLink } from '../server/kafe-link.js';
import { newInstallSecret } from '../server/install-auth.js';
import { licenseClaims, newSigningPair, privateKeyFrom, publicKeyFrom, signLicense } from '../server/license.js';
import { DEMO_PASSWORD, type StaffUser } from '../server/accounts.js';
import { AGREEMENT_VERSION } from '../packages/domain/agreement.js';
import { featureIds } from '../packages/domain/feature-gate.js';
import { balances, cancelByStaff, closeEmptyAccount, closeWithDeposit, DomainError, markTableClean, moveTable, quote, recordPayment, setStatus, submitOrder, submitTakeaway } from '../packages/domain/engine.js';
import { mergeAccounts } from '../packages/domain/merge.js';
import { recordExpense } from '../packages/domain/expenses.js';
import { adjustPayment } from '../packages/domain/payment-adjustments.js';
import { saleProducts } from '../packages/domain/campaigns.js';
import { pruneTakeaways } from '../packages/domain/takeaway.js';
import { pruneEventTables } from '../packages/domain/reservations.js';
import { cancelReservation, closeEvent, createEvent, decideDeposit, noShowReservation, saveReservation, seatReservation, startEvent } from '../packages/domain/reservation-rules.js';
import { requestServiceCall, resolveServiceCall } from '../packages/domain/service-calls.js';
import { recipeAt, recipeIndex, recipeUsage, selectionKey, lineMultiplier, type Recipe, type StockEntry, type StockItem } from '../packages/domain/stock.js';
import type { Actor, CartLine, Order, Product, State } from '../packages/domain/types.js';
import { addDays, at, businessDay, campaignsUntil, dayFactor, dayStart, daySeed, days, HOUR, HOURS, matchNight, menu, MIN, priced, priceIndex, PROFILES, recipes, rng, stockItems, COSTS, type MenuEntry, type Profile, type Rng } from './bes-yil-veri.js';

// ---- Arguments and the throwaway folder ----
const args = process.argv.slice(2), command = args[0];
const option = (name: string, fallback?: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const profile = option('profil', 'orta') as Profile;
if (!['uret', 'canli', 'sikistir'].includes(command ?? '') || !PROFILES[profile]) {
  console.error('Kullanım: npx tsx scripts/bes-yil-testi.ts uret|canli --profil=orta|yogun [--yil=5] [--kok=<klasör>] [--tohum=2026] [--sil]'); process.exit(1);
}
export const TENANT = 'mola-demo';
const root = resolve(option('kok', join(tmpdir(), 'mola-bes-yil'))!), home = join(root, profile), directory = join(home, 'veri');
const MARK = join(home, 'BES_YIL_TESTI.txt'), EXPECTED = join(home, 'beklenen.json'), SUMMARY = join(home, 'uretim.json');
/** Never a café's data: not the installed app, not the seller's work folder, not the development or sample folders. */
function guard(path: string) {
  const p = path.toLowerCase() + sep, local = (process.env.LOCALAPPDATA ?? '').toLowerCase();
  const project = resolve('.local').toLowerCase() + sep;
  const forbidden = [local && join(local, 'mola'), 'c:\\molacalisma', ...['merkez', 'development', 'ornek-'].map(n => project + n)].filter(Boolean) as string[];
  if (forbidden.some(f => p.startsWith(f.toLowerCase()))) { console.error(`Bu klasör gerçek veri olabilir, dokunulmaz: ${path}`); process.exit(1); }
}
guard(root);

// ---- Expected books (independent of the server's) ----
type DayBook = { bills: number; takeaway: number; orders: number; cancelled: number; items: number; cash: number; card: number; payments: number; deposits: number; tips: number; refundCash: number; refundCard: number; refunds: number; methodFixes: number; expenses: number; expenseCash: number; closings: number; closingDiff: number };
type Expected = { profile: Profile; seed: number; firstDay: string; lastDay: string; rosterEnd: string; today: string; days: Record<string, DayBook>; onHand: Record<string, number>; staff: { username: string; role: string; active: boolean }[]; oldPayments: { id: string; day: string }[]; stockAt?: string; liveDay?: string; notes: string[] };
const blank = (): DayBook => ({ bills: 0, takeaway: 0, orders: 0, cancelled: 0, items: 0, cash: 0, card: 0, payments: 0, deposits: 0, tips: 0, refundCash: 0, refundCard: 0, refunds: 0, methodFixes: 0, expenses: 0, expenseCash: 0, closings: 0, closingDiff: 0 });

// ---- Staff: slots by role; a slot's person changes every 6–30 months (the old account stays, deactivated) ----
const FIRST = ['Ahmet', 'Mehmet', 'Ayşe', 'Fatma', 'Emre', 'Elif', 'Burak', 'Zeynep', 'Mustafa', 'Merve', 'Hasan', 'Esra', 'Hüseyin', 'Büşra', 'Ali', 'Kübra', 'Yusuf', 'Seda', 'Furkan', 'Gamze', 'Oğuz', 'Derya', 'Kerem', 'Sibel'];
type Person = { slot: string; role: StaffUser['role']; from: string; to: string; n: number; name: string };
function roster(first: string, last: string, p: typeof PROFILES[Profile], r: Rng): Person[] {
  const slots: [string, StaffUser['role']][] = [['mudur', 'manager'], ...Array.from({ length: p.cashiers }, (_, i) => [i ? `kasiyer${i + 1}` : 'kasiyer', 'cashier'] as [string, StaffUser['role']]),
    ...Array.from({ length: p.waiters }, (_, i) => [i ? `garson${i + 1}` : 'garson', 'waiter'] as [string, StaffUser['role']]), ...Array.from({ length: p.kitchen }, (_, i) => [i ? `mutfak${i + 1}` : 'mutfak', 'kitchen'] as [string, StaffUser['role']])];
  // The busy café also has a few part-timers for weekends (more waiters, same slots idea).
  const extra = p.staff - 1 - slots.length;
  for (let i = 0; i < extra; i++) slots.push([`garson${p.waiters + i + 1}`, 'waiter']);
  const people: Person[] = [];
  for (const [slot, role] of slots) {
    let from = first, n = 0;
    while (from <= last) { const to = addDays(from, r.int(180, 900)); people.push({ slot, role, from, to: to > last ? '9999-12-31' : to, n: n++, name: `${r.pick(FIRST)} ${String.fromCharCode(65 + r.int(0, 25))}.` }); from = addDays(to, 1); }
  }
  return people;
}

class Cafe {
  store: Store; key: Buffer; w!: State;
  cash: CashBook; shifts: ShiftBook; stock: StockBook; reservations: ReservationBook; agenda: AgendaBook; notes: Notifications;
  clock = 0; r!: Rng; heap: { t: number; n: number; run: Generator<number, void, void> }[] = []; seq = 0;
  entries = menu(); byId = new Map<string, MenuEntry>(); items: StockItem[] = []; recipeList: Recipe[] = []; index = new Map<string, Recipe[]>();
  people: Person[] = []; expected!: Expected; errors = new Map<string, number>(); recent: { id: string; at: number; method: 'cash' | 'card'; amount: number }[] = [];
  stats = { visits: 0, takeaways: 0, qr: 0, moves: 0, merges: 0, cancels: 0, partialCancels: 0, refunds: 0, oldRefunds: 0, methodFixes: 0, tips: 0, reservations: 0, seated: 0, noShows: 0, events: 0, eventVisits: 0, splits: 0, itemPays: 0, closings: 0, purchases: 0, counts: 0, wastes: 0, lateTables: 0 };
  priceDay = ''; campaignCount = -1; sample = false;
  constructor(public seed: number, public p: typeof PROFILES[Profile]) {
    this.store = new Store(directory, [TENANT]);
    this.store.clock = () => new Date(this.clock || Date.now());
    this.key = snapshotKey(this.store.db, this.store.key, TENANT)!;
    this.cash = new CashBook(this.store); this.shifts = new ShiftBook(this.store); this.stock = new StockBook(this.store); this.reservations = new ReservationBook(this.store);
    this.agenda = new AgendaBook(this.store, () => new Date(this.clock)); this.notes = new Notifications(this.store, this.agenda, () => new Date(this.clock));
    for (const e of this.entries) this.byId.set(e.product.id, e);
  }
  ctx = () => ({ now: new Date(this.clock), id: randomUUID });
  rid = () => randomUUID().replace(/-/g, '');
  day = (t = this.clock) => businessDay(t);
  book = (t = this.clock) => (this.expected.days[this.day(t)] ??= blank());
  fail(e: unknown, where: string) {
    const code = e instanceof DomainError ? e.code : e instanceof Error ? e.message.slice(0, 80) : String(e);
    const k = `${where}: ${code}`; this.errors.set(k, (this.errors.get(k) ?? 0) + 1);
    if (!(e instanceof DomainError)) throw e;
  }
  // ---- Who is working ----
  users(role: StaffUser['role']) { return (this.w.staffUsers ?? []).filter(u => u.role === role && u.active); }
  actor(u: Pick<StaffUser, 'id' | 'role'>): Actor { this.shifts.touch(TENANT, u.id, this.clock); return { tenantId: TENANT, id: u.id, role: u.role }; }
  any(role: StaffUser['role']) { const list = this.users(role); return this.actor(list.length ? this.r.pick(list) : this.owner()); }
  owner() { return this.w.staffUsers!.find(u => u.role === 'owner')!; }
  ownerActor() { return this.actor(this.owner()); }
  cashier() { return this.any('cashier'); }
  waiter() { return this.any('waiter'); }
  kitchen() { return this.any('kitchen'); }
  /** Hires and leaves: accounts appear on their first day and are switched off (and renamed) after their last. */
  staffFor(day: string) {
    let changed = false;
    for (const p of this.people) {
      const id = `u-${p.slot}-${p.n}`, u = this.w.staffUsers!.find(x => x.id === id);
      if (!u && p.from <= day && day <= p.to) {
        const salt = randomBytes(16).toString('hex');
        // The cheap scrypt cost of the tests would let anyone in; the real one (2^15) is used so logins measure honestly.
        this.w.staffUsers!.push({ id, username: p.slot, name: p.name, role: p.role, active: true, version: 1, salt, hash: scryptSync(DEMO_PASSWORD, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex'), createdAt: new Date(at(day, 8)).toISOString() });
        changed = true;
      } else if (u && u.active && day > p.to) { u.active = false; u.username = `${p.slot}-eski-${p.n + 1}`; u.version++; changed = true; }
    }
    if (changed) this.w.businessRevision = (this.w.businessRevision ?? 0) + 1;
  }
  // ---- Scheduler: each visit is a generator that yields how long to wait ----
  spawn(t: number, run: Generator<number, void, void>) { this.push(t, run); }
  private push(t: number, run: Generator<number, void, void>) {
    const h = this.heap, item = { t, n: this.seq++, run }; h.push(item);
    for (let i = h.length - 1; i > 0;) { const p = (i - 1) >> 1; if (h[p].t < item.t || (h[p].t === item.t && h[p].n < item.n)) break; h[i] = h[p]; h[p] = item; i = p; }
  }
  private pop() {
    const h = this.heap, top = h[0], last = h.pop()!;
    if (h.length) { h[0] = last; for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; const less = (a: number, b: number) => h[a].t < h[b].t || (h[a].t === h[b].t && h[a].n < h[b].n); if (l < h.length && less(l, m)) m = l; if (r < h.length && less(r, m)) m = r; if (m === i) break; [h[i], h[m]] = [h[m], h[i]]; i = m; } }
    return top;
  }
  run(until: number) {
    while (this.heap.length && this.heap[0].t < until) {
      const item = this.pop(); this.clock = Math.max(this.clock, item.t);
      let step: IteratorResult<number, void>;
      try { step = item.run.next(); } catch (e) { this.fail(e, 'akış'); continue; }
      if (!step.done) this.push(this.clock + Math.max(1000, step.value), item.run);
    }
    this.clock = Math.max(this.clock, until);
  }
  /** What a busy server does on every write: settled tables, old reservations and closed events leave the floor. */
  settle(now: number) {
    this.store.history.persist(this.w, this.key, now);
    pruneTakeaways(this.w); pruneEventTables(this.w);
    this.reservations.archive(this.w, now);
  }

  // ---- Stock: the script's own "on hand", the same rules as packages/domain/stock.ts ----
  onHand = new Map<string, number>(); weekly = new Map<string, number>();
  use(o: Pick<Order, 'createdAt' | 'lines'>, sign: 1 | -1, lines = o.lines) {
    const t = Date.parse(o.createdAt);
    for (const l of lines) {
      const r = recipeAt(this.index.get(l.productId), t); if (!r?.items.length) continue;
      const n = lineMultiplier(l.quantity, l.grams ?? 0);
      for (const [itemId, amount] of recipeUsage(r, selectionKey(l.selections))) { this.onHand.set(itemId, (this.onHand.get(itemId) ?? 0) - sign * amount * n); if (sign > 0) this.weekly.set(itemId, (this.weekly.get(itemId) ?? 0) + amount * n); }
    }
  }
  entry(e: Omit<StockEntry, 'at' | 'by' | 'byName'>, by: Actor) { const value: StockEntry = { ...e, at: new Date(this.clock).toISOString(), by: by.id, byName: this.w.staffUsers!.find(u => u.id === by.id)?.name ?? 'Personel' }; this.stock.put(TENANT, 'entry', value, value.at); return value; }
  costOf(item: StockItem, day: string) { const base = item.kind === 'product' ? Math.round(this.byId.get(item.productId!)!.product.price * 0.45) : COSTS[item.name] ?? 10; return base * priceIndex(day, this.expected.today); }

  // ---- One business day ----
  simulateDay(day: string, until: number) {
    this.r = rng(daySeed(this.seed, day));
    const start = dayStart(day), r = this.r, p = this.p;
    this.clock = Math.max(this.clock, start);
    this.settle(start);
    this.shifts.sweep(TENANT, start + 60_000);
    this.sample = Number(day.slice(8, 10)) === 15;
    this.staffFor(day);
    this.menuFor(day);
    const late = r.chance(0.25) || matchNight(day) || [5, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
    // Morning: counts on the 1st, purchases, opening, shifts.
    this.spawn(at(day, 7.4), this.morning(day));
    this.spawn(at(day, 7.75), this.openCash(day));
    for (const g of this.shiftPlan(day, late)) this.spawn(g[0], g[1]);
    // Visits over the day, more at lunch and in the evening.
    const target = Math.round(p.bills * dayFactor(day) * (0.9 + r.next() * 0.2));
    const hours = HOURS.filter(([h]) => late || h <= 24);
    for (let i = 0; i < target; i++) {
      const h = r.weighted(hours), t = at(day, h + r.next());
      this.spawn(t, r.chance(0.09) ? this.takeaway() : this.visit({}));
    }
    // A few very long tables across midnight (and across the gün sonu).
    if (late && r.chance(0.3)) { this.stats.lateTables++; this.spawn(at(day, 23.3), this.visit({ long: true })); }
    this.spawn(at(day, 11), this.bookings(day));
    this.spawn(at(day, 12), this.ownerDesk(day));
    for (let i = r.int(1, 3); i > 0; i--) this.spawn(at(day, r.int(9, 21) + r.next()), this.tillExpense());
    if (matchNight(day) && this.monthEvents(day) < p.events) this.spawn(at(day, 12.5), this.event(day));
    this.spawn(at(day, r.int(9, 22) + r.next()), this.oldRefund());
    if (r.chance(0.3)) this.spawn(at(day, r.int(10, 22)), this.kitchenWaste());
    this.spawn(at(day, late ? 26.4 : 25.5), this.closeDay(day));
    // The server settles on every write; every two hours is close enough and keeps the working copy as small as the live one.
    const self = this;
    this.spawn(at(day, 9), (function* () { for (let h = 9; h <= 27; h += 2) { self.settle(self.clock); yield 2 * HOUR; } })());
    this.run(Math.min(until, start + 24 * HOUR));
  }
  monthEvents(day: string) { return (this.w.events ?? []).filter(e => e.day.slice(0, 7) === day.slice(0, 7)).length + this.storedEvents(day); }
  storedEvents(day: string) { return Number((this.store.db.prepare("SELECT COUNT(*) AS n FROM reservation_records WHERE tenant=? AND kind='event' AND day LIKE ?").get(TENANT, `${day.slice(0, 7)}%`) as { n: number }).n); }
  /** Prices of the day (every 1 January and 1 July they rise) and the campaigns running by then. */
  menuFor(day: string) {
    const index = priceIndex(day, this.expected.today), stamp = String(index);
    if (stamp !== this.priceDay) {
      for (const p of this.w.products) { const e = this.byId.get(p.id); if (e) p.price = priced(e.product.price, day, this.expected.today); }
      this.w.menuRevision++; this.priceDay = stamp;
      this.w.audit.push({ action: 'menu.prices_changed', actor: 'isletme', target: day, at: new Date(this.clock).toISOString() });
    }
    const campaigns = campaignsUntil(this.expected.firstDay, day);
    if (campaigns.length !== this.campaignCount) { this.w.campaigns = campaigns; this.campaignCount = campaigns.length; }
  }
  *morning(day: string): Generator<number, void, void> {
    const owner = this.ownerActor(), kitchen = this.kitchen();
    // Monthly count of two thirds of the items (the rest are never counted: their stock is computed from the very first day).
    if (day.endsWith('-01')) {
      for (const [i, item] of this.items.entries()) {
        if (i % 3 === 0) continue;
        const have = this.onHand.get(item.id) ?? 0, noise = item.unit === 'piece' ? this.r.int(-2, 0) : -this.r.next() * 0.03 * Math.max(0, have);
        const counted = Math.max(0, item.unit === 'piece' ? Math.round(have) + noise : Math.round(have + noise));
        this.entry({ id: `c-${day}-${item.id}`, kind: 'count', itemId: item.id, quantity: counted, expected: have }, kitchen); this.onHand.set(item.id, counted); this.stats.counts++;
      }
    }
    // Yesterday's use updates each item's daily rate.
    for (const item of this.items) { const used = this.weekly.get(item.id) ?? 0, old = this.rate.get(item.id); this.rate.set(item.id, old === undefined ? used : old * 0.7 + used * 0.3); }
    this.weekly.clear();
    yield 90 * MIN;
    // Purchases: what would run out within three days gets a week's worth; at 15:00 an emergency run for what is nearly gone.
    this.purchase(day, owner, 3, 7);
    yield 6 * HOUR;
    this.purchase(day, this.ownerActor(), 0.6, 3);
  }
  rate = new Map<string, number>();
  purchase(day: string, owner: Actor, below: number, days: number) {
    for (const item of this.items) {
      const rate = Math.max(this.rate.get(item.id) ?? 0, item.unit === 'piece' ? 2 : 100), have = this.onHand.get(item.id) ?? 0;
      if (have > rate * below) continue;
      const step = item.unit === 'piece' ? 1 : 100, quantity = Math.ceil((rate * days - have) / step) * step;
      if (quantity <= 0) continue;
      const total = Math.max(100, Math.round(quantity * this.costOf(item, day) * (0.92 + this.r.next() * 0.16)));
      let expenseId: string | undefined;
      if (this.r.chance(0.4)) {
        const method = this.r.pick(['cash', 'card', 'transfer'] as const);
        const e = recordExpense(this.w, owner, { requestId: this.rid(), amount: total, description: `Stok alışı: ${item.name}`, method }, this.ctx());
        expenseId = e.id; this.book().expenses += total; if (method === 'cash') this.book().expenseCash += total;
      }
      this.entry({ id: `p-${this.rid()}`, kind: 'purchase', itemId: item.id, quantity, total, unitCost: total / quantity, supplier: this.r.pick(['Metro', 'Toptancı Hal', 'Kahve Dünyası Toptan', 'Elazığ Süt', 'Fırın Ekmek']), ...(expenseId ? { expenseId } : {}) }, owner);
      this.onHand.set(item.id, have + quantity); this.stats.purchases++;
    }
  }
  *openCash(day: string): Generator<number, void, void> {
    const c = this.cashier(), position = this.cash.position(TENANT, this.clock);
    if (!position.needsOpening) return;
    const carried = position.carried ?? 100000, differs = this.r.chance(0.04), amount = differs ? carried + this.r.pick([-2000, -500, 1000, 5000]) : carried;
    try { this.cash.openDay(this.w, c, { requestId: this.rid(), amount: Math.max(0, amount), ...(differs ? { note: 'Sabah sayımında fark çıktı.' } : {}) }, this.ctx()); } catch (e) { this.fail(e, 'kasa açılışı'); }
    // Change from the bank now and then ("para bozdurma": the same amount in and out).
    if (this.r.chance(0.2)) { yield 3 * HOUR; try { this.cash.movement(this.w, this.cashier(), { requestId: this.rid(), type: 'exchange', amount: 50000, note: 'Bozuk para' }, this.ctx()); } catch (e) { this.fail(e, 'para bozdurma'); } }
  }
  shiftPlan(day: string, late: boolean): [number, Generator<number, void, void>][] {
    const out: [number, Generator<number, void, void>][] = [], self = this;
    const workers = (this.w.staffUsers ?? []).filter(u => u.active && u.role !== 'owner');
    for (const u of workers) {
      if (this.r.chance(u.role === 'manager' ? 0.3 : 0.15)) continue; // day off
      const evening = this.r.chance(0.5) && u.role !== 'manager';
      const start = at(day, (evening ? 16 : 7.75) + this.r.int(-5, 15) / 60);
      out.push([start, (function* () {
        const shift = self.shifts.begin(TENANT, { id: u.id, name: u.name, role: u.role }, new Date(self.clock).toISOString());
        if (evening) return; // ends with the gün sonu (endForClosing) or the 05:00 sweep
        yield at(day, 16 + self.r.int(0, 30) / 60) - self.clock;
        const now = self.shifts.get(TENANT, shift.id); if (now && !now.endAt) self.shifts.finish(TENANT, now, new Date(self.clock).toISOString(), 'manual');
      })()]);
    }
    void late;
    return out;
  }
  // ---- Visits ----
  freeTable() {
    const free = this.w.tables.filter(t => !t.takeaway && !t.event && !t.accountId && !t.needsCleaning && !(this.w.reservations ?? []).some(r => r.status === 'booked' && r.tableId === t.id && Math.abs(Date.parse(r.at) - this.clock) < 90 * MIN));
    return free.length ? this.r.pick(free) : undefined;
  }
  cart(products: Product[], n: number): CartLine[] {
    const lines: CartLine[] = [];
    while (lines.length < n) {
      const e = this.pickProduct(products); if (!e) break;
      const same = lines.find(l => l.productId === e.id && !e.groups.length);
      if (same) { same.quantity = Math.min(20, same.quantity + 1); n--; continue; }
      lines.push({ productId: e.id, quantity: this.r.chance(0.12) ? 2 : 1, selections: e.groups.flatMap(g => g.required ? [{ groupId: g.id, optionId: g.id === 'size' ? this.r.weighted([['small', 2], ['regular', 6], ['large', 2]] as const) : this.r.pick(g.options).id }] : this.r.chance(0.18) ? [{ groupId: g.id, optionId: this.r.pick(g.options).id }] : []) });
    }
    return lines;
  }
  weights: [Product, number][] = [];
  pickProduct(products: Product[]) {
    if (this.weights.length !== products.length || this.weights[0]?.[0] !== products[0]) this.weights = products.map(p => [p, this.byId.get(p.id)?.weight ?? 1]);
    return this.r.weighted(this.weights);
  }
  order(tableId: string, by: Actor, items: number, packed = false) {
    const products = saleProducts(this.w, new Date(this.clock)), lines = this.cart(products.filter(p => p.published !== false && !p.soldOut), items);
    const expectedTotal = quote(products, lines, this.ctx()).reduce((n, l) => n + l.total, 0);
    const result = submitOrder(this.w, by, { requestId: this.rid(), tableId, lines, expectedTotal, ...(packed ? { packed } : {}) }, this.ctx());
    const o = this.w.orders.find(x => x.id === result.orderId)!;
    this.use(o, 1); const b = this.book(); b.orders++; b.items += o.lines.reduce((n, l) => n + l.quantity, 0);
    return o;
  }
  *kitchenFlow(orderId: string, qr: boolean, servedBy?: () => Actor): Generator<number, void, void> {
    yield (qr ? 65_000 : 30_000) + this.r.int(0, 180) * 1000;
    for (const [status, wait] of [['preparing', [3, 12]], ['ready', [1, 4]], ['served', [0, 0]]] as const) {
      const o = this.w.orders.find(x => x.id === orderId);
      if (!o || o.status === 'cancelled' || o.status === 'served') return;
      try { setStatus(this.w, status === 'served' ? (servedBy ?? (() => this.waiter()))() : this.kitchen(), o.id, o.version, status, new Date(this.clock)); } catch (e) { this.fail(e, `mutfak ${status}`); return; }
      if (wait[1]) yield this.r.int(wait[0], wait[1]) * MIN;
    }
  }
  *visit(o: { long?: boolean; tableId?: string; accountId?: string; event?: boolean }): Generator<number, void, void> {
    const r = this.r, table = o.tableId ? this.w.tables.find(t => t.id === o.tableId) : this.freeTable();
    if (!table) { yield* this.takeaway(); return; }
    this.stats.visits++; if (o.event) this.stats.eventVisits++;
    const qr = !o.event && r.chance(0.25), people = r.weighted([[1, 3], [2, 5], [3, 2], [4, 2], [6, 1]] as const);
    const guest: Actor = { tenantId: TENANT, id: randomBytes(24).toString('hex'), role: 'guest', tableId: table.id, epoch: table.epoch };
    const rounds = r.weighted([[1, 6], [2, 3], [3, 1]] as const), orders: Order[] = [];
    let tableId = table.id;
    for (let i = 0; i < rounds; i++) {
      const fromGuest = qr && (i === 0 || r.chance(0.5)), by = fromGuest ? { ...guest, tableId, epoch: this.w.tables.find(t => t.id === tableId)!.epoch } : this.waiter();
      let order: Order;
      try { order = this.order(tableId, by, Math.max(1, Math.round((i ? 1 : 2.2) * Math.sqrt(people) + r.next() - 0.5)), r.chance(0.03)); } catch (e) { this.fail(e, 'sipariş'); break; }
      if (fromGuest) this.stats.qr++;
      orders.push(order); this.spawn(this.clock, this.kitchenFlow(order.id, fromGuest));
      // About 2 % of orders lose an item or are cancelled whole before the kitchen starts ("Ürün bitti", "Müşteri vazgeçti").
      if (r.chance(0.02)) {
        yield r.int(10, 50) * 1000;
        const live = this.w.orders.find(x => x.id === order.id)!, whole = live.lines.length === 1 || r.chance(0.4);
        const cut = whole ? undefined : [{ lineId: live.lines[0].id, quantity: live.lines[0].quantity }];
        try {
          const before = live.lines.map(l => ({ ...l }));
          cancelByStaff(this.w, this.waiter(), { requestId: this.rid(), orderId: live.id, version: live.version, reason: r.pick(['Ürün bitti', 'Müşteri vazgeçti', 'Yanlış sipariş']), ...(cut ? { lines: cut } : {}) }, this.ctx());
          if (whole) { this.use(live, -1, before); this.stats.cancels++; this.book(Date.parse(live.createdAt)).cancelled++; } else { this.use(live, -1, [before[0]]); this.stats.partialCancels++; }
        } catch (e) { this.fail(e, 'iptal'); }
      }
      // A table move now and then (a bigger table, the garden).
      if (i === 0 && !o.event && r.chance(0.015)) {
        yield r.int(5, 20) * MIN;
        const target = this.freeTable(), account = this.w.accounts.find(a => a.id === order.accountId && a.status === 'open');
        if (target && account) { try { moveTable(this.w, this.waiter(), { requestId: this.rid(), accountId: account.id, version: account.version, targetId: target.id, targetEpoch: target.epoch }, this.ctx()); this.spawn(this.clock, this.clean(tableId)); tableId = target.id; this.stats.moves++; } catch (e) { this.fail(e, 'masa taşıma'); } }
      }
      if (i < rounds - 1) yield r.int(12, 35) * MIN;
    }
    if (!orders.length) return;
    let accountId = orders[0].accountId;
    // A group on two tables pays together: the second table's bill joins this one.
    if (!o.event && r.chance(0.006)) {
      const other = this.freeTable();
      if (other) {
        try {
          const o2 = this.order(other.id, this.waiter(), 2); this.spawn(this.clock, this.kitchenFlow(o2.id, false));
          yield r.int(20, 40) * MIN;
          const source = this.w.accounts.find(a => a.id === o2.accountId && a.status === 'open'), target = this.w.accounts.find(a => a.id === accountId && a.status === 'open');
          if (source && target) { mergeAccounts(this.w, this.cashier(), { requestId: this.rid(), sourceId: source.id, sourceVersion: source.version, targetId: target.id, targetVersion: target.version }, this.ctx()); this.stats.merges++; this.spawn(this.clock, this.clean(other.id)); }
        } catch (e) { this.fail(e, 'birleştirme'); }
      }
    }
    yield (o.long ? r.int(180, 240) : r.int(15, 45)) * MIN;
    if (qr && r.chance(0.3)) {
      const t = this.w.tables.find(x => x.id === tableId)!;
      try { const call = requestServiceCall(this.w, { ...guest, tableId, epoch: t.epoch }, { requestId: this.rid(), kind: 'bill', payWith: r.pick(['cash', 'card'] as const) }, this.ctx()); yield r.int(1, 3) * MIN; resolveServiceCall(this.w, this.waiter(), { callId: call.callId }, this.ctx()); } catch (e) { this.fail(e, 'hesap isteği'); }
    }
    yield* this.pay(accountId, tableId);
  }
  *pay(accountId: string, tableId: string): Generator<number, void, void> {
    const r = this.r, account = () => this.w.accounts.find(a => a.id === accountId)!;
    if (account().status !== 'open') return;
    const b = balances(this.w, accountId);
    if (b.total === 0 && b.paid === 0) { try { closeEmptyAccount(this.w, this.cashier(), accountId, new Date(this.clock)); this.book().bills++; } catch (e) { this.fail(e, 'boş hesap'); } yield* this.clean(tableId); return; }
    if (b.balance <= 0) { try { closeWithDeposit(this.w, this.cashier(), { requestId: this.rid(), accountId, version: account().version }, this.ctx()); this.closed(accountId); } catch (e) { this.fail(e, 'kaporayla kapat'); } yield* this.clean(tableId); return; }
    const mode = r.weighted([['card', 48], ['cash', 34], ['split', 10], ['items', 4], ['parts', 4]] as const);
    try {
      if (mode === 'items' && !account().deposit) {
        // "Ürün seç": the first person pays their items, the rest is paid by amount.
        this.stats.itemPays++;
        const lines = this.w.orders.filter(o => o.accountId === accountId && o.status !== 'cancelled').flatMap(o => o.lines.map(l => ({ o, l })));
        const mine = lines.slice(0, Math.max(1, Math.floor(lines.length / 2)));
        const amount = mine.reduce((n, x) => n + x.l.unitPrice * x.l.quantity, 0);
        if (amount > 0 && amount < b.balance) { this.payment(accountId, r.chance(0.6) ? 'card' : 'cash', amount, mine.map(x => ({ orderId: x.o.id, lineId: x.l.id, quantity: x.l.quantity }))); yield r.int(1, 3) * MIN; }
      } else if (mode === 'split' || mode === 'parts') {
        this.stats.splits++;
        const parts = mode === 'split' ? 2 : r.int(2, 4), each = Math.floor(b.balance / parts / 100) * 100;
        for (let i = 1; i < parts && each > 0; i++) { this.payment(accountId, mode === 'split' ? (i === 1 ? 'cash' : 'card') : r.pick(['cash', 'card'] as const), each); yield r.int(1, 2) * MIN; }
      }
      const left = balances(this.w, accountId).balance;
      if (left > 0 && account().status === 'open') this.payment(accountId, mode === 'cash' ? 'cash' : mode === 'card' ? 'card' : r.pick(['cash', 'card'] as const), left, undefined, r.chance(0.08));
    } catch (e) { this.fail(e, 'ödeme'); }
    if (account().status === 'closed') this.closed(accountId);
    else { try { const rest = balances(this.w, accountId).balance; if (rest > 0) this.payment(accountId, 'card', rest); this.closed(accountId); } catch (e) { this.fail(e, 'ödeme (kalan)'); } }
    yield* this.clean(tableId);
  }
  closed(accountId: string) {
    const b = this.book(); b.bills++;
    // A kapora that paid part of this bill became a payment when it closed (engine.ts settleGuest).
    for (const p of this.w.payments) if (p.accountId === accountId && p.deposit) b.deposits += p.amount;
  }
  payment(accountId: string, method: 'cash' | 'card', amount: number, selections?: { orderId: string; lineId: string; quantity: number }[], tip = false) {
    const a = this.w.accounts.find(x => x.id === accountId)!, c = this.cashier();
    const tipAmount = tip ? Math.max(500, Math.round(amount * 0.08 / 500) * 500) : 0;
    const tendered = method === 'cash' ? Math.ceil((amount + tipAmount) / 5000) * 5000 : amount + tipAmount;
    const result = tip
      ? this.cash.payWithTip(this.w, c, { requestId: this.rid(), accountId, version: a.version, method, amount, tendered, tip: tipAmount }, this.ctx())
      : recordPayment(this.w, c, { requestId: this.rid(), accountId, version: a.version, method, amount, tendered, ...(selections ? { selections } : {}) }, this.ctx());
    const b = this.book(); b[method] += amount; b.payments++; if (tip) { b.tips += tipAmount; this.stats.tips++; }
    // Some payments are remembered for later refunds (weeks to months old) and for the history checks (one a month, years back).
    if (this.r.chance(0.2)) { this.recent.push({ id: result.paymentId, at: this.clock, method, amount }); if (this.recent.length > 4000) this.recent.splice(0, 1000); }
    if (this.sample) { this.expected.oldPayments.push({ id: result.paymentId, day: this.day() }); this.sample = false; }
    // About one refund in two hundred payments, the same evening ("soğuk geldi"); a few method corrections.
    if (this.r.chance(0.005)) this.refund(result.paymentId, method, Math.min(amount, Math.round(amount * (0.2 + this.r.next() * 0.8) / 100) * 100 || amount), false);
    else if (this.r.chance(0.002)) this.fixMethod(result.paymentId, method);
  }
  refund(paymentId: string, method: 'cash' | 'card', amount: number, old: boolean) {
    const account = this.store.history.refundAccount(TENANT, this.w, paymentId), payment = account?.payments.find(p => p.id === paymentId);
    if (!account || !payment) { this.fail(new DomainError('NOT_FOUND', 'yok'), old ? 'eski iade' : 'iade'); return; }
    const history = account.adjustments.filter(a => a.paymentId === paymentId), left = payment.amount - history.filter(a => a.kind === 'refund').reduce((n, a) => n + a.amount, 0);
    if (left <= 0) return;
    const value = Math.min(left, amount);
    try {
      adjustPayment(this.w, this.ownerActor(), { requestId: this.rid(), paymentId, revision: history.length, kind: 'refund', amount: value, method, commission: 0, reason: old ? 'Eski hesap: müşteri şikâyeti, iade edildi.' : 'Soğuk servis edildi; iade.' }, this.ctx(), { payment, history, account });
      const b = this.book(); b.refunds++; b[method === 'cash' ? 'refundCash' : 'refundCard'] += value; this.stats[old ? 'oldRefunds' : 'refunds']++;
    } catch (e) { this.fail(e, old ? 'eski iade' : 'iade'); }
  }
  fixMethod(paymentId: string, method: 'cash' | 'card') {
    const account = this.store.history.refundAccount(TENANT, this.w, paymentId), payment = account?.payments.find(p => p.id === paymentId);
    if (!account || !payment) return;
    const history = account.adjustments.filter(a => a.paymentId === paymentId);
    try {
      adjustPayment(this.w, this.ownerActor(), { requestId: this.rid(), paymentId, revision: history.length, kind: 'method', amount: 0, method: method === 'cash' ? 'card' : 'cash', commission: 0, reason: 'Yanlış ödeme yöntemi seçilmişti.' }, this.ctx(), { payment, history, account });
      // The money moves to the other method on the payment's own day.
      const b = this.book(Date.parse(payment.createdAt)); b[method] -= payment.amount; b[method === 'cash' ? 'card' : 'cash'] += payment.amount; this.book().methodFixes++; this.stats.methodFixes++;
    } catch (e) { this.fail(e, 'yöntem düzeltme'); }
  }
  *clean(tableId: string): Generator<number, void, void> {
    yield this.r.int(2, 8) * MIN;
    const t = this.w.tables.find(x => x.id === tableId);
    if (t?.needsCleaning && !t.accountId) { try { markTableClean(this.w, this.waiter(), { requestId: this.rid(), tableId, epoch: t.epoch }, this.ctx()); } catch (e) { this.fail(e, 'temizlik'); } }
  }
  *takeaway(): Generator<number, void, void> {
    const r = this.r, c = this.cashier(); this.stats.takeaways++;
    const products = saleProducts(this.w, new Date(this.clock)), lines = this.cart(products.filter(p => p.published !== false && !p.soldOut), r.int(1, 3));
    const expectedTotal = quote(products, lines, this.ctx()).reduce((n, l) => n + l.total, 0);
    let result: ReturnType<typeof submitTakeaway>;
    try { result = submitTakeaway(this.w, c, { requestId: this.rid(), lines, expectedTotal, ...(r.chance(0.3) ? { label: r.pick(FIRST) } : {}) }, this.ctx()); } catch (e) { this.fail(e, 'masasız'); return; }
    const o = this.w.orders.find(x => x.id === result.orderId)!; this.use(o, 1); const b = this.book(); b.orders++; b.takeaway++; b.items += o.lines.reduce((n, l) => n + l.quantity, 0);
    yield r.int(20, 90) * 1000;
    try { this.payment(result.accountId, r.chance(0.55) ? 'card' : 'cash', o.total); this.closed(result.accountId); } catch (e) { this.fail(e, 'masasız ödeme'); }
    this.spawn(this.clock, this.kitchenFlow(o.id, false, () => this.cashier()));
  }
  // ---- Reservations and events ----
  *bookings(day: string): Generator<number, void, void> {
    const r = this.r, owner = this.ownerActor();
    // New bookings for the coming days (some with a kapora).
    for (let i = this.p.reservations; i > 0; i--) {
      const when = addDays(day, r.int(1, 5)), table = r.pick(this.w.tables.filter(t => !t.takeaway && !t.event)), deposit = r.chance(0.2) ? { amount: r.pick([20000, 30000, 50000]), method: r.pick(['cash', 'card'] as const) } : null;
      try { saveReservation(this.w, this.cashier(), { requestId: this.rid(), tableId: table.id, day: when, time: r.pick(['19:00', '19:30', '20:00', '20:30', '21:00']), name: `${r.pick(FIRST)} Bey/Hanım`, people: r.int(2, 8), phone: `0532 ${r.int(100, 999)} ${r.int(10, 99)} ${r.int(10, 99)}`, ...(deposit ? { deposit } : {}), force: true }, this.ctx()); this.stats.reservations++; } catch (e) { this.fail(e, 'rezervasyon'); }
    }
    // Some of tomorrow's call to cancel.
    for (const res of (this.w.reservations ?? []).filter(x => x.status === 'booked' && x.day === addDays(day, 1))) if (r.chance(0.1)) { try { cancelReservation(this.w, this.cashier(), { requestId: this.rid(), id: res.id }, this.ctx()); } catch (e) { this.fail(e, 'rezervasyon iptali'); } }
    // Kapora choices left from earlier days.
    for (const res of (this.w.reservations ?? []).filter(x => x.deposit?.pending)) { try { decideDeposit(this.w, owner, { requestId: this.rid(), id: res.id, kind: r.chance(0.6) ? 'keep' : 'refund' }, this.ctx()); } catch (e) { this.fail(e, 'kapora kararı'); } }
    // Today's: seat, or "gelmedi" half an hour later.
    for (const res of (this.w.reservations ?? []).filter(x => x.status === 'booked' && x.day === day && !x.eventId)) this.spawn(Date.parse(res.at) + r.int(-10, 25) * MIN, this.arrival(res.id));
    void owner; yield 0;
  }
  *arrival(id: string): Generator<number, void, void> {
    const res = (this.w.reservations ?? []).find(x => x.id === id);
    if (!res || res.status !== 'booked') return;
    if (this.r.chance(0.12)) { yield 30 * MIN; try { noShowReservation(this.w, this.cashier(), { requestId: this.rid(), id }, this.ctx()); this.stats.noShows++; } catch (e) { this.fail(e, 'gelmedi'); } return; }
    const own = this.w.tables.find(t => t.id === res.tableId), table = own && !own.accountId && !own.needsCleaning ? own : this.freeTable();
    if (!table) { try { noShowReservation(this.w, this.cashier(), { requestId: this.rid(), id }, this.ctx()); this.stats.noShows++; } catch (e) { this.fail(e, 'gelmedi'); } return; }
    try { seatReservation(this.w, this.waiter(), { requestId: this.rid(), id, tableId: table.id }, this.ctx()); this.stats.seated++; } catch (e) { this.fail(e, 'oturt'); return; }
    yield* this.visit({ tableId: table.id });
  }
  *event(day: string): Generator<number, void, void> {
    const owner = this.ownerActor();
    let id: string;
    try { id = createEvent(this.w, owner, { requestId: this.rid(), name: this.r.pick(['Maç gecesi', 'Derbi gecesi', 'Canlı müzik']), day, start: '20:00', end: '23:30', count: 8, prefix: 'D', hideNormal: false }, this.ctx()).id; this.stats.events++; } catch (e) { this.fail(e, 'etkinlik'); return; }
    yield at(day, 19.5) - this.clock;
    try { startEvent(this.w, owner, { requestId: this.rid(), id }, this.ctx()); } catch (e) { this.fail(e, 'etkinlik başlat'); }
    for (const t of this.w.tables.filter(x => x.event?.id === id)) this.spawn(at(day, 20 + this.r.next() * 1.5), this.visit({ tableId: t.id, event: true }));
    yield at(day, 24.75) - this.clock;
    for (let i = 0; i < 4; i++) {
      try { closeEvent(this.w, this.cashier(), { requestId: this.rid(), id }, this.ctx()); return; } catch (e) { if (!(e instanceof DomainError && e.code === 'EVENT_OPEN_BILLS')) { this.fail(e, 'etkinlik kapat'); return; } }
      yield 30 * MIN;
    }
    this.fail(new DomainError('EVENT_OPEN_BILLS', 'açık'), 'etkinlik kapat');
  }
  // ---- Money that is not a sale ----
  *tillExpense(): Generator<number, void, void> {
    const amount = Math.round(this.r.int(5000, 150000) * priceIndex(this.day(), this.expected.today) / 100) * 100 || 100;
    try { recordExpense(this.w, this.cashier(), { requestId: this.rid(), amount, description: this.r.pick(['Ekmek', 'Buz', 'Temizlik malzemesi', 'Kargo', 'Tüp', 'Peçete', 'Limon']), method: 'cash' }, this.ctx()); const b = this.book(); b.expenses += amount; b.expenseCash += amount; } catch (e) { this.fail(e, 'gider'); }
    yield 0;
  }
  *ownerDesk(day: string): Generator<number, void, void> {
    const owner = this.ownerActor(), idx = priceIndex(day, this.expected.today), r = this.r;
    const bill = (description: string, amount: number, method: 'transfer' | 'card' | 'cash') => {
      try { recordExpense(this.w, owner, { requestId: this.rid(), amount: Math.round(amount * idx / 100) * 100, description, method }, this.ctx()); const b = this.book(); b.expenses += Math.round(amount * idx / 100) * 100; if (method === 'cash') b.expenseCash += Math.round(amount * idx / 100) * 100; } catch (e) { this.fail(e, 'sahip gideri'); }
    };
    const d = Number(day.slice(8, 10));
    if (d === 1) bill('Kira', this.p.bills > 300 ? 9000000 : 4500000, 'transfer');
    if (d === 5) bill('Personel maaşları', this.p.staff * 2800000, 'transfer');
    if (d === 10) { bill('Elektrik faturası', r.int(600000, 1400000), 'card'); bill('Su faturası', r.int(100000, 300000), 'card'); bill('Doğalgaz faturası', r.int(150000, 900000), 'card'); }
    if (d === 15) bill('İnternet ve POS', 180000, 'card');
    // The owner takes cash out once a week (with "Yine de kaydet" when the drawer would go below zero).
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 1) { yield 8 * HOUR; try { this.cash.movement(this.w, owner, { requestId: this.rid(), type: 'owner_took', amount: Math.round(300000 * idx / 100) * 100, note: 'Haftalık', confirm: true }, this.ctx()); } catch (e) { this.fail(e, 'kasadan alınan'); } }
    // Notes and notices: a few a week.
    if (r.chance(0.4)) this.agenda.save(TENANT, owner.id, { day: addDays(day, r.int(0, 10)), title: r.pick(['Tedarikçi ödemesi', 'Personel toplantısı', 'Menü değişikliği', 'Bakım: kahve makinesi', 'Doğum günü rezervasyonu']), text: 'Not', time: r.chance(0.5) ? '10:00' : null, reminder: r.chance(0.3) ? { offset: 'same', time: '09:00' } : null });
    if (r.chance(0.3)) this.notes.add(TENANT, `bes-yil:${day}`, { kind: r.pick(['stock', 'cash', 'report'] as const), title: 'Günlük bildirim', text: `${day} için örnek bildirim.` });
  }
  *kitchenWaste(): Generator<number, void, void> {
    const item = this.r.pick(this.items.filter(i => i.kind !== 'product')), quantity = item.unit === 'piece' ? 1 : this.r.int(20, 300);
    this.entry({ id: `w-${this.rid()}`, kind: 'waste', itemId: item.id, quantity, reason: this.r.pick(['Bozuldu', 'Döküldü', 'Son kullanma tarihi']) }, this.kitchen());
    this.onHand.set(item.id, (this.onHand.get(item.id) ?? 0) - quantity); this.stats.wastes++;
    yield 0;
  }
  *oldRefund(): Generator<number, void, void> {
    // An owner refund of a bill from weeks or months ago (it lives in the history tables by now): about once a week.
    if (!this.r.chance(0.12) || this.recent.length < 100) return;
    const p = this.recent[this.r.int(0, Math.floor(this.recent.length / 2))];
    this.refund(p.id, p.method, Math.min(p.amount, 5000 + this.r.int(0, 20) * 500), true);
    yield 0;
  }
  // ---- Gün sonu: the blind count, the result, the shifts ----
  *closeDay(day: string): Generator<number, void, void> {
    const c = this.cashier(), owner = this.ownerActor();
    const expected = this.cash.expectedNow(TENANT, this.w, this.clock);
    if (expected === null) return;
    const roll = this.r.next(), diff = roll < 0.85 ? 0 : roll < 0.95 ? this.r.int(-20, 20) * 100 : this.r.int(-200, 200) * 100;
    let id: string;
    try { id = this.cash.count(this.w, c, { requestId: this.rid(), mode: 'final', counted: Math.max(0, expected + diff), pos: null }, this.ctx()).id; } catch (e) { this.fail(e, 'gün sonu sayım'); return; }
    yield this.r.int(1, 4) * MIN;
    try {
      const left = Math.min(Math.max(0, expected + diff), 100000);
      const { closing } = this.cash.finish(this.w, c, { id, left, ...(Math.abs(diff) > 5000 ? { note: 'Sayımda fark çıktı.' } : {}) }, this.ctx(), (t, scope) => this.shifts.endForClosing(TENANT, t, scope));
      const own = this.shifts.ownForClosing(TENANT, c.id, { day: closing.day, before: closing.closedAt ?? closing.to }); if (own) this.shifts.finish(TENANT, own, new Date(this.clock).toISOString(), 'manual');
      const b = this.expected.days[closing.day] ??= blank(); b.closings++; b.closingDiff += closing.difference; this.stats.closings++;
    } catch (e) { this.fail(e, 'gün sonu'); }
    void owner;
  }

  // ---- Setup on the first day ----
  setup(first: string) {
    this.clock = at(first, 6);
    const created = new Date(this.clock).toISOString(), today = this.expected.today;
    this.items = stockItems(this.entries, created);
    this.recipeList = recipes(this.entries, this.items, created, new Date(at(addDays(first, 900), 6)).toISOString());
    this.index = recipeIndex(this.recipeList);
    this.store.mutate(TENANT, s => {
      s.name = `Mola 5 Yıl Testi (${profile})`; s.sector = 'cafe'; s.setupCompleted = true; s.setupCompletedAt = created; s.businessRevision = 1;
      s.products = this.entries.map(e => ({ ...structuredClone(e.product), price: priced(e.product.price, first, today), firstPublishedAt: created }));
      s.categories = [...new Set(s.products.map(p => p.category))]; s.menuRevision = 2;
      const areas = ['İç salon', 'Bahçe', 'Teras'];
      s.tables = Array.from({ length: this.p.tables }, (_, i) => ({ id: `masa-${i + 1}`, name: `Masa ${String(i + 1).padStart(2, '0')}`, area: areas[i < 18 ? 0 : i < 26 ? 1 : 2], token: randomBytes(18).toString('base64url'), epoch: 0, accountId: null }));
      s.cleaningEnabled = true; s.waiterApproval = false; s.autoApproveQr = true; s.changeSeconds = 60; s.commissionBps = 179; s.vat = { rates: [10, 20], default: 10 };
      s.cashShift = { shiftTracking: true, closingTime: '01:00', differenceNote: 5000, expenseAlert: 300000 };
      s.ownerLockMinutes = 0; s.accounts = []; s.orders = []; s.payments = []; s.archives = [];
      s.staffUsers = s.staffUsers!.filter(u => u.role === 'owner'); s.staffUsers[0].createdAt = created;
    });
    this.w = this.store.read(TENANT);
    for (const item of this.items) {
      this.stock.put(TENANT, 'item', { ...item, min: item.unit === 'piece' ? 10 : 1000 }, created);
      const initial = (item.unit === 'piece' ? 150 : 25000) * (this.p.bills / 150);
      this.stock.put(TENANT, 'entry', { id: `start-${item.id}`, kind: 'count', at: created, by: 'isletme', byName: 'İşletme sahibi', itemId: item.id, quantity: initial, expected: 0, start: true }, created);
      this.onHand.set(item.id, initial);
    }
    for (const r of this.recipeList) this.stock.put(TENANT, 'recipe', r, r.validFrom);
  }
}

// ---- Commands ----
function sizes() {
  const f = (n: string) => existsSync(join(directory, n)) ? statSync(join(directory, n)).size : 0;
  return { sqliteMb: +(f('merchant.sqlite') / 1048576).toFixed(1), walMb: +(f('merchant.sqlite-wal') / 1048576).toFixed(1) };
}
function rows(store: Store) {
  const n = (t: string) => { try { return Number((store.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n); } catch { return 0; } };
  return Object.fromEntries(['history_archives', 'history_ledger', 'history_audit', 'history_requests', 'history_days', 'history_payments', 'cash_records', 'staff_shifts', 'stock_records', 'reservation_records', 'agenda_notes', 'notifications'].map(t => [t, n(t)]));
}
async function compactAll(store: Store) {
  const t = performance.now();
  await store.history.compact({ sliceMs: 60_000, pauseMs: 0 });
  return Math.round((performance.now() - t) / 1000);
}
function license(store: Store) {
  const pair = newSigningPair(), keyFile = join(home, 'merkez-acik-anahtar.txt');
  writeFileSync(keyFile, pair.publicKey + '\n');
  const link = new MerkezLink(store, { publicKey: publicKeyFrom(pair.publicKey) }), installId = randomUUID();
  const signed = signLicense(licenseClaims({ tenantId: TENANT, name: store.directoryEntry(TENANT).name, endsAt: new Date(Date.now() + 10 * 365 * 86400_000).toISOString(), suspended: false, kind: 'subscription', planMonths: 12, service: 'full', features: [...featureIds] }, installId, 1, new Date()), privateKeyFrom(pair.privateKey));
  // Like merkez-import --sozlesme-kabul: a test folder's owner is not asked to accept the licence agreement.
  link.adopt({ installId, secret: newInstallSecret(), licenses: [signed], serverTime: new Date().toISOString() }, [], { version: AGREEMENT_VERSION, acceptedAt: new Date().toISOString(), name: 'Deneme verisi' });
}

const seed = Number(option('tohum', '2026')), years = Number(option('yil', '5')), p = PROFILES[profile];
if (command === 'uret') {
  if (existsSync(home)) {
    if (!existsSync(MARK)) { console.error(`Klasör bu testin değil, dokunulmuyor: ${home}`); process.exit(1); }
    if (!args.includes('--sil')) { console.error(`Zaten var: ${home}. Yeniden üretmek için --sil ekleyin.`); process.exit(1); }
    rmSync(home, { recursive: true, force: true });
  }
  mkdirSync(directory, { recursive: true }); writeFileSync(MARK, 'Mola 5 yıllık hız ve hata testi için üretilmiş deneme verisi. Gerçek işletme verisi değildir; silinebilir.\n');
  const started = performance.now(), today = businessDay(Date.now()), first = addDays(today, -Math.round(years * 365.25)), last = addDays(today, -1);
  const release = dataLock(directory, 'bes-yil-testi'), cafe = new Cafe(seed, p);
  try {
    cafe.expected = { profile, seed, firstDay: first, lastDay: last, rosterEnd: last, today, days: {}, onHand: {}, staff: [], oldPayments: [], notes: [] };
    cafe.people = roster(first, last, p, rng(seed));
    cafe.setup(first);
    let y = performance.now(), n = 0;
    const yearly: { year: string; seconds: number; sqliteMb: number }[] = [];
    for (const day of days(first, last)) {
      cafe.store.db.exec('BEGIN IMMEDIATE');
      try { cafe.simulateDay(day, dayStart(today)); cafe.store.db.exec('COMMIT'); } catch (e) { cafe.store.db.exec('ROLLBACK'); console.error(`Gün ${day} başarısız.`); throw e; }
      n++;
      if (day.endsWith('-12-31') || day === last || n % 120 === 0) {
        const s = Math.round((performance.now() - y) / 1000);
        console.log(`  ${day} · ${n} gün · ${cafe.stats.visits + cafe.stats.takeaways} ziyaret · ${Math.round((performance.now() - started) / 1000)} sn · ${sizes().sqliteMb} MB${cafe.errors.size ? ` · ${[...cafe.errors.values()].reduce((a, b) => a + b, 0)} kural reddi` : ''}`);
        if (day.endsWith('-12-31') || day === last) { yearly.push({ year: day.slice(0, 4), seconds: s, sqliteMb: sizes().sqliteMb }); y = performance.now(); }
      }
    }
    // The floor at 05:00 today: what was closed has settled, open shifts end at the sweep like on the server.
    cafe.store.db.exec('BEGIN IMMEDIATE');
    try { cafe.settle(dayStart(today)); cafe.shifts.sweep(TENANT, dayStart(today) + 60_000); cafe.store.db.prepare('UPDATE snapshots SET payload=? WHERE tenant=?').run(cafe.store.encode(cafe.w), TENANT); cafe.store.db.exec('COMMIT'); } catch (e) { cafe.store.db.exec('ROLLBACK'); throw e; }
    cafe.expected.onHand = Object.fromEntries(cafe.onHand); cafe.expected.stockAt = new Date(dayStart(today)).toISOString();
    cafe.expected.staff = (cafe.w.staffUsers ?? []).map(u => ({ username: u.username, role: u.role, active: u.active }));
    license(cafe.store);
    // What a running server keeps up to date (Store/History.compact): the one-time packing pass has seen every row.
    const packing = await compactAll(cafe.store);
    cafe.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const seconds = Math.round((performance.now() - started) / 1000);
    const summary = { profile, label: p.label, seed, years, firstDay: first, lastDay: last, seconds, packingSeconds: packing, yearly, ...sizes(), rows: rows(cafe.store), stats: cafe.stats, refusals: Object.fromEntries(cafe.errors), totals: Object.values(cafe.expected.days).reduce((t, d) => { for (const k of Object.keys(t) as (keyof DayBook)[]) t[k] += d[k]; return t; }, blank()) };
    writeFileSync(EXPECTED, JSON.stringify(cafe.expected));
    writeFileSync(SUMMARY, JSON.stringify(summary, null, 1));
    console.log(JSON.stringify(summary, null, 1));
  } finally { cafe.store.close(); release(); }
} else if (command === 'sikistir') {
  const release = dataLock(directory, 'bes-yil-testi'), store = new Store(directory, [TENANT]);
  try { const s = await compactAll(store); console.log(JSON.stringify({ packingSeconds: s })); if (existsSync(SUMMARY)) writeFileSync(SUMMARY, JSON.stringify({ ...JSON.parse(readFileSync(SUMMARY, 'utf8')), packingSeconds: s }, null, 1)); } finally { store.close(); release(); }
} else {
  // canli: from the last generated day (or the last canli) up to now: full days, then today's floor as it is right now.
  if (!existsSync(MARK) || !existsSync(EXPECTED)) { console.error(`Önce üretin: npx tsx scripts/bes-yil-testi.ts uret --profil=${profile}`); process.exit(1); }
  const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as Expected, now = Date.now(), today = businessDay(now);
  // Once per business day: the day's visits are made from the day's seed, so a second run would repeat them.
  if (expected.liveDay === today) { console.error('Bugünün salonu zaten kuruldu (canli). Yeni gün başlayınca tekrar çalıştırın ya da veriyi yeniden üretin.'); process.exit(1); }
  const release = dataLock(directory, 'bes-yil-testi'), cafe = new Cafe(expected.seed, p);
  try {
    cafe.expected = expected; cafe.w = cafe.store.read(TENANT);
    cafe.people = roster(expected.firstDay, expected.rosterEnd, p, rng(expected.seed));
    cafe.items = stockItems(cafe.entries, new Date(at(expected.firstDay, 6)).toISOString());
    cafe.recipeList = recipes(cafe.entries, cafe.items, new Date(at(expected.firstDay, 6)).toISOString(), new Date(at(addDays(expected.firstDay, 900), 6)).toISOString());
    cafe.index = recipeIndex(cafe.recipeList); cafe.onHand = new Map(Object.entries(expected.onHand));
    cafe.priceDay = String(priceIndex(addDays(today, -1), expected.today)); cafe.campaignCount = cafe.w.campaigns?.length ?? -1;
    cafe.clock = dayStart(addDays(expected.lastDay, 1));
    cafe.store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const day of days(addDays(expected.lastDay, 1), today)) cafe.simulateDay(day, now);
      cafe.store.db.prepare('UPDATE snapshots SET payload=? WHERE tenant=?').run(cafe.store.encode(cafe.w), TENANT);
      cafe.store.db.exec('COMMIT');
    } catch (e) { cafe.store.db.exec('ROLLBACK'); throw e; }
    expected.lastDay = addDays(today, -1); expected.liveDay = today; expected.onHand = Object.fromEntries(cafe.onHand); expected.stockAt = new Date(now).toISOString();
    writeFileSync(EXPECTED, JSON.stringify(expected));
    const s = cafe.w;
    console.log(JSON.stringify({ now: new Date(now).toISOString(), openTables: s.tables.filter(t => t.accountId).length, accounts: s.accounts.length, orders: s.orders.length, payments: s.payments.length, refusals: Object.fromEntries(cafe.errors) }));
  } finally { cafe.store.close(); release(); }
}
void readdirSync;
