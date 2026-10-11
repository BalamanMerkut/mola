import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import { recordExpense } from '../packages/domain/expenses.js';
import { isManagement } from '../packages/domain/roles.js';
import { expenseMethods } from '../packages/domain/expense-rules.js';
import { businessDay, DAY_MS, dayStart } from '../packages/domain/history.js';
import { addDays } from '../packages/domain/business-day.js';
import { drainSlowly } from './history.js';
import { reportRange } from '../packages/domain/reports.js';
import { profitReportSteps } from '../packages/domain/profit.js';
import { historyIndex, KITCHEN_HISTORY, type StockEventKind } from '../packages/domain/stock-history.js';
import { cashDayOf } from '../packages/domain/cash.js';
import { autoGroup, DEFAULT_MARGINS, MARGIN_GROUPS, marginRules, productGroup, thresholdOf, type MarginGroup } from '../packages/domain/margins.js';
import type { Actor, Order, PublicStockQuestion, State } from '../packages/domain/types.js';
import {
  baselineOf, currentRecipes, formatAmount, UNIT_NAMES, lineMultiplier, pricePoints, productStock, recipeCost, recipeUsage, selectionKey, stockLevels, unitCostAt,
  type MixEntry, type OptionRule, type Recipe, type SalesFeed, type SoldLine, type StockData, type StockEntry, type StockItem, type StockLevel, type StockLog,
} from '../packages/domain/stock.js';
import { open, seal } from './sealing.js';
import { snapshotKey, type Store } from './store.js';
import { maskMs } from './year-packages.js';
import { assertOpenDay } from '../packages/domain/closed-year.js';
import type { Notifications } from './notifications.js';

/*
 * Stok on the café server. Only what people enter is stored: items (ingredients and ready-bought products), recipe
 * versions and entries (purchases, counts, waste, returns, prices); a few thousand rows a year, one sealed row each in
 * `stock_records` (business key, scope `stock:<business>:<kind>:<id>`; backups open them too, server/backup.ts).
 * Sales are never copied: consumption is computed from the stored daily summaries (server/history.ts) and the floor, with
 * every past day's figures kept in memory until history says that day changed (History.watch).
 */
type Kind = 'item' | 'recipe' | 'entry' | 'log';
const MAX_ITEMS = 500, MAX_RECIPES = 20_000, MAX_ENTRIES = 100_000;
const ACTIVE = new Set(['new', 'preparing', 'ready', 'served']);
type AnyRecord = StockItem | Recipe | StockEntry | StockLog;
/** The time a record is stored at (`stock_records.at`): every put passes the record's own time. */
const recordAt = (kind: Kind, v: AnyRecord) => Date.parse(kind === 'item' ? (v as StockItem).createdAt : kind === 'recipe' ? (v as Recipe).validFrom : (v as StockEntry | StockLog).at);
const listOf = (kind: Kind): keyof StockData => kind === 'item' ? 'items' : kind === 'recipe' ? 'recipes' : kind === 'log' ? 'logs' : 'entries';
/**
 * A snapshot with one record written: a new snapshot (arrays copied, the old one stays as it was for whoever holds it) with
 * the record replaced or inserted where a fresh read puts it (ORDER BY at, id), so it equals reading everything again.
 */
function withRecord(data: StockData, kind: Kind, value: AnyRecord): StockData {
  const name = listOf(kind), list = ((data[name] ?? []) as AnyRecord[]).filter(x => x.id !== value.id), at = recordAt(kind, value);
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1, m = recordAt(kind, list[mid]); if (m < at || (m === at && list[mid].id < value.id)) lo = mid + 1; else hi = mid; }
  list.splice(lo, 0, value);
  return { ...data, [name]: list };
}

export class StockBook {
  private memo = new Map<string, StockData>();
  private sales = new Map<string, { mix: Map<string, MixEntry[]>; lines: Map<string, SoldLine[]> }>();
  constructor(private store: Store) {
    store.db.exec('CREATE TABLE IF NOT EXISTS stock_records (tenant TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (tenant,kind,id)); CREATE INDEX IF NOT EXISTS stock_records_at ON stock_records(tenant,kind,at)');
    // A settled table, a late order or a correction changes stored days: their cached sales go.
    store.history.watch((tenant, from, to) => {
      // Every day at once: a "Tanıtım" reset (History.forget) removed the stock records too.
      if (from <= '0000-01-01' && to >= '9999-12-31') { this.memo.delete(tenant); this.sales.delete(tenant); return; }
      const c = this.sales.get(tenant); if (!c) return;
      for (const map of [c.mix, c.lines]) for (const day of [...map.keys()]) if (day >= from && day <= to) map.delete(day);
    });
  }
  private key(tenant: string) {
    const key = snapshotKey(this.store.db, this.store.key, tenant);
    if (!key) throw new Error('İşletme anahtarı eksik.');
    return key;
  }
  /** Everything entered for one business; read once and kept until the next write. */
  data(tenant: string): StockData { const steps = this.dataSteps(tenant); for (;;) { const r = steps.next(); if (r.done) return r.value; } }
  /** Writes so far: a read in slices that saw one meanwhile is not kept. */
  private writes = 0;
  /**
   * data() in slices of 1 000 records (five years of a café are some 30 000 purchases, counts and prices, about 0.7 s to open
   * at once): Kârlılık, the stock screen and the start-up read run it through drainSlowly first, so no tablet waits for it.
   */
  *dataSteps(tenant: string): Generator<void, StockData> {
    const cached = this.memo.get(tenant); if (cached) return cached;
    const start = this.writes;
    // Entries of closed years are in their packages (Kârlılık of those years costs them at their own prices); items and
    // recipes always stay live. Each year's stock starts again from its opening count (openYear).
    const rows = this.store.packages.sources('stock_records', m => `NOT (kind='entry' AND NOT ${maskMs(m, 'at')})`, undefined, undefined, tenant)
      .flatMap(src => src.db.prepare(`SELECT kind,id,at,payload FROM stock_records WHERE tenant=? AND ${src.where} ORDER BY at,id`).all(tenant) as { kind: Kind; id: string; at: number; payload: Uint8Array }[])
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const key = this.key(tenant), data: StockData = { items: [], recipes: [], entries: [], logs: [] };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], value = open<unknown>(Buffer.from(r.payload), key, `stock:${tenant}:${r.kind}:${r.id}`);
      if (r.kind === 'item') data.items.push(value as StockItem); else if (r.kind === 'recipe') data.recipes.push(value as Recipe); else if (r.kind === 'log') data.logs!.push(value as StockLog); else data.entries.push(value as StockEntry);
      if (i % 1000 === 999) yield;
    }
    // A record written while this read was paused: read again at once (it is rare and small then).
    if (this.writes !== start) return this.data(tenant);
    this.memo.set(tenant, data);
    return data;
  }
  put(tenant: string, kind: Kind, value: StockItem | Recipe | StockEntry | StockLog, at: string) {
    // An entry of a closed year is neither added nor taken back (packages/domain/closed-year.ts).
    if (kind === 'entry') assertOpenDay(this.store.packages.closedEnd(), businessDay(at), 'Kapanmış yılın stok kaydı değiştirilemez.');
    this.store.db.prepare('INSERT INTO stock_records (tenant,kind,id,at,payload) VALUES (?,?,?,?,?) ON CONFLICT(tenant,kind,id) DO UPDATE SET at=excluded.at,payload=excluded.payload')
      .run(tenant, kind, value.id, Date.parse(at), seal(value, this.key(tenant), `stock:${tenant}:${kind}:${value.id}`));
    this.writes++;
    // K-T (9 Ekim): the kept snapshot takes the new record in place of reading five years of sealed rows again (~0,8 s for
    // 30 000). Inside a transaction it is dropped as before: a rollback must not leave the record in memory.
    const memo = this.memo.get(tenant), ms = Date.parse(at);
    if (memo && !this.store.db.isTransaction && Number.isFinite(ms) && recordAt(kind, value) === ms) this.memo.set(tenant, withRecord(memo, kind, value)); else this.memo.delete(tenant);
  }
  /**
   * A year about to be sealed (server/year-packer.ts): every item's stock at `t0` (1 January, 05:00) is written there as its
   * opening count ("Başlangıç") and its unit cost as a price, so the live file alone gives today's stock and prices once the
   * year's entries left for its package. Ids from the year and the item: after a crash the same rows are written again.
   */
  *openYearSteps(tenant: string, s: State, t0: number, year: string): Generator<void, number> {
    // Everything the stock math will read, first and in slices: the entries, every whole day's sales from the oldest place an
    // item's stock starts (its last count before t0, or its creation), and the line-by-line days (counts, recipe changes).
    const data = yield* this.dataSteps(tenant), feed = this.feed(tenant, s), end = businessDay(t0);
    const starts = data.items.filter(i => !i.removedAt).map(i => baselineOf(i, data.entries, t0).at), from = starts.length ? businessDay(Math.min(...starts)) : end;
    const boundaries = new Set([...starts.map(at => businessDay(at)), ...data.recipes.map(r => businessDay(Date.parse(r.validFrom)))]);
    for (let day = from; day <= end; day = addDays(day, 1)) { if (boundaries.has(day) || day === end) feed.dayLines(day); else this.mixOf(tenant, day); yield; }
    // Then the stock math a dozen items at a time (each item's stock is its own sum; a call walks every day once).
    const items = data.items.filter(i => !i.removedAt), levels = new Map<string, StockLevel>(), upTo = this.upTo(feed, t0);
    for (let i = 0; i < items.length; i += 12) { for (const [id, level] of stockLevels({ ...data, items: items.slice(i, i + 12) }, upTo, t0)) levels.set(id, level); yield; }
    return this.writeOpening(tenant, data, levels, t0, year);
  }
  /**
   * The sales as of t0 exactly: a whole day's sales stand for "up to now" only for today, so the day starting at t0 counts just
   * its lines up to t0 (the count then starts what comes after it: stockLevels counts sales after a count).
   */
  private upTo(feed: SalesFeed, t0: number): SalesFeed {
    const first = businessDay(t0);
    return { ...feed, dayMix: day => day === first ? feed.dayLines(day).filter(l => l.at <= t0).map(l => [l.productId, l.key, l.quantity, l.grams] as MixEntry) : feed.dayMix(day), live: feed.live.filter(l => l.at <= t0) };
  }
  openYear(tenant: string, s: State, t0: number, year: string) {
    const data = this.data(tenant);
    return this.writeOpening(tenant, data, stockLevels(data, this.upTo(this.feed(tenant, s), t0), t0), t0, year);
  }
  private writeOpening(tenant: string, data: StockData, levels: Map<string, StockLevel>, t0: number, year: string) {
    // One transaction: a commit per row would be a disk flush per row.
    const db = this.store.db, own = !db.isTransaction;
    if (own) db.exec('BEGIN IMMEDIATE');
    try { const n = this.writeOpeningRows(tenant, data, levels, t0, year); if (own) db.exec('COMMIT'); return n; }
    catch (e) { if (own) db.exec('ROLLBACK'); throw e; }
  }
  private writeOpeningRows(tenant: string, data: StockData, levels: Map<string, StockLevel>, t0: number, year: string) {
    const at = new Date(t0).toISOString();
    let n = 0;
    for (const item of data.items) {
      const level = levels.get(item.id);
      if (item.removedAt || Date.parse(item.createdAt) > t0 || !level) continue;
      this.put(tenant, 'entry', { id: `y${year}-c-${item.id}`.slice(0, 100), kind: 'count', at, by: 'mola', byName: 'Yıl açılışı', itemId: item.id, quantity: level.stock, expected: level.stock, start: true }, at);
      const cost = unitCostAt(pricePoints(item.id, data.entries), t0);
      if (cost !== null) this.put(tenant, 'entry', { id: `y${year}-p-${item.id}`.slice(0, 100), kind: 'price', at, by: 'mola', byName: 'Yıl açılışı', itemId: item.id, unitCost: cost, start: true }, at);
      n++;
    }
    return n;
  }
  count(tenant: string, kind: Kind) { return Number((this.store.db.prepare('SELECT COUNT(*) AS n FROM stock_records WHERE tenant=? AND kind=?').get(tenant, kind) as { n: number }).n); }
  private cache(tenant: string) { let c = this.sales.get(tenant); if (!c) this.sales.set(tenant, c = { mix: new Map(), lines: new Map() }); return c; }
  /** One stored business day's settled sales, aggregated by product and option key; kept until history says the day changed. */
  private mixOf(tenant: string, day: string) {
    const cache = this.cache(tenant);
    let mix = cache.mix.get(day);
    if (!mix) {
      const t = this.store.history.storedDay(tenant, day); mix = [];
      for (const [id, p] of t.products) {
        let q = p.quantity, g = p.grams;
        for (const [key, v] of t.variants.get(id) ?? []) { mix.push([id, key, v.quantity, v.grams]); q -= v.quantity; g -= v.grams; }
        if (q > 0 || g > 0) mix.push([id, '', Math.max(0, q), Math.max(0, g)]);
      }
      cache.mix.set(day, mix);
    }
    return mix;
  }
  /** The start-up read below has finished: the minute's low-stock check waits for it (stockRoutes). */
  warmed = false;
  /**
   * After a start, the stored daily summaries of the last 400 days are read (and rebuilt where an update changed their
   * format) in short slices in the background, newest first, so neither the first stock screen nor a "1 yıl" report
   * waits for a year of history. Only businesses that use stock fill this memory; the summaries help every report.
   * A business that uses stock reads every day back to its first: an item never counted since it was added needs them all,
   * and the first low-stock check after a start would otherwise read years of them at once (about a second for five
   * years, minutes right after an update that rebuilds the summaries; docs/HIZ_TESTI_5_YIL.md).
   */
  async warm(options: { now?: number; sliceMs?: number; pauseMs?: number; stopped?: () => boolean } = {}) {
    const { sliceMs = 12, pauseMs = 8, stopped = () => false } = options, today = businessDay(options.now ?? Date.now());
    try {
      for (const { tenant } of this.store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) {
        // The entries first, in slices: the minute's low-stock check then never opens years of them at once.
        if (this.store.db.prepare('SELECT 1 FROM stock_records WHERE tenant=? LIMIT 1').get(tenant)) await drainSlowly(this.dataSteps(tenant), () => stopped() || !this.store.db.isOpen, sliceMs);
        const first = (this.store.db.prepare('SELECT MIN(day) AS day FROM history_archives WHERE tenant=?').get(tenant) as { day: string | null }).day;
        if (!first) continue;
        const keep = !!this.store.db.prepare('SELECT 1 FROM stock_records WHERE tenant=? LIMIT 1').get(tenant);
        let until = performance.now() + sliceMs;
        for (let at = dayStart(today), n = 0; (keep || n < 400) && businessDay(at) >= first; at -= DAY_MS, n++) {
          if (stopped() || !this.store.db.isOpen) return;
          if (keep) this.mixOf(tenant, businessDay(at)); else this.store.history.storedDay(tenant, businessDay(at));
          if (performance.now() > until) { await new Promise(r => setTimeout(r, pauseMs)); until = performance.now() + sliceMs; }
        }
      }
    } finally { this.warmed = true; }
  }
  /** Sales for the stock math: whole stored days aggregated, exact lines only when asked, the floor always exact. */
  feed(tenant: string, s: State): SalesFeed {
    const cache = this.cache(tenant), history = this.store.history;
    return {
      dayMix: day => this.mixOf(tenant, day),
      dayLines(day) {
        let lines = cache.lines.get(day);
        if (!lines) {
          const start = dayStart(day), end = start + DAY_MS;
          lines = history.archives(tenant, start, end).flatMap(a => a.orders).flatMap(o => { const at = Date.parse(o.createdAt); return at >= start && at < end ? soldLines(o) : []; });
          cache.lines.set(day, lines);
        }
        return lines;
      },
      live: liveLines(s),
    };
  }
}
function soldLines(o: Order): SoldLine[] {
  if (!ACTIVE.has(o.status)) return [];
  const at = Date.parse(o.createdAt);
  return o.lines.map(l => ({ at, productId: l.productId, key: selectionKey(l.selections), quantity: l.quantity, grams: l.grams ?? 0 }));
}
/** Orders still on the floor (live copies win over the copies taken at payment). */
export function liveLines(s: State): SoldLine[] {
  const orders = new Map<string, Order>();
  for (const a of s.archives) for (const o of a.orders) orders.set(o.id, o);
  for (const o of s.orders) orders.set(o.id, o);
  return [...orders.values()].flatMap(soldLines);
}

const id = z.string().min(1).max(100);
const amount = z.number().finite().min(0).max(1_000_000_000);
const unit = z.enum(['g', 'ml', 'piece']);
const name = z.string().trim().min(1).max(60);
const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const recipeItem = z.object({ itemId: id, amount: amount.refine(n => n > 0, 'Miktar sıfırdan büyük olmalı.') });
const optionRule = z.object({ groupId: id, optionId: id, scale: z.number().finite().min(0.05).max(20).optional(), add: z.array(recipeItem).max(10).optional(), replace: z.array(z.object({ from: id, to: id })).max(10).optional() });
const itemInput = z.object({ id: id.optional(), name, unit, min: amount.nullable().optional(), unitCost: z.number().finite().min(0).max(100_000_000).nullable().optional(), initial: amount.nullable().optional() });
const recipeInput = z.object({ productId: id, mode: z.enum(['recipe', 'ready', 'none']), items: z.array(recipeItem).max(30).default([]), options: z.array(optionRule).max(80).default([]) });
const purchaseInput = z.object({ requestId, itemId: id, quantity: amount.refine(n => n > 0), total: z.number().int().min(0).max(100_000_000), supplier: z.string().trim().max(80).optional(), expense: z.boolean().optional(), method: z.enum(expenseMethods as ['cash', 'card', 'transfer', 'other']).optional(), source: z.enum(['drawer', 'outside']).optional(), paid: z.enum(['drawer', 'outside', 'unpaid']).optional() });
const countInput = z.object({ requestId, counts: z.array(z.object({ itemId: id, quantity: amount })).min(1).max(MAX_ITEMS) });
const wasteInput = z.object({ requestId, itemId: id, quantity: amount.refine(n => n > 0), reason: z.string().trim().min(1).max(120) });
const returnInput = z.object({ requestId, productId: id, quantity: z.number().finite().min(0.05).max(1000) });

const trLower = (v: string) => v.toLocaleLowerCase('tr').trim();
/** The kitchen counts and records fire but never sees money: purchases, prices and suppliers stay with the owner. */
const KITCHEN_KINDS = new Set<StockEntry['kind']>(['count', 'waste', 'return']);
function kitchenEntry(e: StockEntry): StockEntry { const { total: _t, unitCost: _u, supplier: _s, expenseId: _x, ...rest } = e; return rest; }
/** Fire written for a cancelled line the kitchen had prepared ("Evet, hazırlanmıştı"). */
export const CANCEL_WASTE_REASON = 'İptal · hazırlanmıştı';
const sameRecipe = (a: Recipe | undefined, b: Pick<Recipe, 'items' | 'options' | 'ready'>) => !!a && JSON.stringify([a.items, a.options ?? [], !!a.ready]) === JSON.stringify([b.items, b.options ?? [], !!b.ready]);

/**
 * Stok: GET /api/staff/stock (owner; cashier reads Ürünler and Malzemeler without money), GET /api/staff/stock/entries,
 * POST /api/staff/stock/items (+ /delete), /recipes, /purchase, /count, /waste, /return, /entries/delete (owner), and
 * Satış ve Raporlar → Kârlılık: GET /api/staff/reports/profit (owner, behind the report code like every report: register after reportSecurity).
 * Low stock is checked every minute and on every read; each crossing below an item's minimum makes one notification.
 */
export function stockRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, notifications?: Notifications, everyMs = 60_000, enabled: (tenant: string) => boolean = () => true) {
  const book = new StockBook(store);
  const role = (req: Request, roles: Actor['role'][]) => { const a = actorFor(req), s = store.read(a.tenantId); requireRole(s, a, roles); return { a, s }; };
  const staffName = (s: State, a: Actor) => s.staffUsers?.find(u => u.id === a.id)?.name ?? 'İşletme sahibi';
  const at = () => now().toISOString();

  function compute(tenant: string, s: State, t = now().getTime()) {
    const data = book.data(tenant), levels = stockLevels(data, book.feed(tenant, s), t);
    return { data, levels };
  }
  /** One notification per crossing below the minimum; the state lives on the item, so a restart does not repeat it. */
  function alerts(tenant: string, data: StockData, levels: Map<string, StockLevel>) {
    for (const item of data.items) {
      if (item.removedAt) continue;
      const level = levels.get(item.id), low = !!level?.low, was = !!item.alert?.low;
      if (low === was) continue;
      const n = (item.alert?.n ?? 0) + (low ? 1 : 0);
      book.put(tenant, 'item', { ...item, alert: { low, n } }, item.createdAt);
      if (low && notifications) notifications.add(tenant, `stock-low:${item.id}:${n}`, { kind: 'stock', title: `${item.name} azaldı`, text: `Kalan ${formatAmount(Math.max(0, level!.stock), item.unit)}; en az ${formatAmount(item.min ?? 0, item.unit)} olmalı. Stok → Alış ve sayım'dan alış kaydedebilirsiniz.` });
    }
  }
  function sweep(tenant: string) {
    // Hizmet paketi: no "Stok" in the package, no low-stock notices (the items keep their state for when it comes back).
    if (!enabled(tenant) || !book.count(tenant, 'item')) return;
    const s = store.read(tenant), { data, levels } = compute(tenant, s);
    alerts(tenant, data, levels);
  }

  /** "Düşük kâr" line of every menu product (Reçeteler marks a recipe's margin with it); null when the warning is off. */
  const thresholds = (s: State, t: number) => {
    const rules = marginRules(s.marginAlerts), ready = new Set([...currentRecipes(book.data(s.tenantId).recipes, t)].filter(([, r]) => r.ready).map(([id]) => id));
    return Object.fromEntries(s.products.map(p => [p.id, thresholdOf(productGroup(p, ready.has(p.id), rules), rules)]));
  };
  app.get('/api/staff/stock', async (req, res) => {
    const { a, s } = role(req, ['owner', 'manager', 'kitchen']), owner = isManagement(a.role), t = now().getTime();
    // Years of entries are opened in slices the first time (StockBook.dataSteps).
    let left = false; res.on('close', () => { left = true; });
    if (!await drainSlowly(book.dataSteps(a.tenantId), () => left)) return;
    const { data, levels } = compute(a.tenantId, s, t);
    if (owner) alerts(a.tenantId, data, levels);
    const fresh = book.data(a.tenantId), current = currentRecipes(fresh.recipes, t), products = productStock(s.products, fresh, levels, t), menu = new Set(s.products.map(p => p.id));
    // Best sellers of the last 30 days, the floor included.
    const recent = new Map(store.history.recentQuantities(a.tenantId, t));
    for (const l of liveLines(s)) recent.set(l.productId, (recent.get(l.productId) ?? 0) + l.quantity);
    const points = new Map<string, ReturnType<typeof pricePoints>>();
    const priceOf = (itemId: string) => { let p = points.get(itemId); if (!p) points.set(itemId, p = pricePoints(itemId, fresh.entries)); return unitCostAt(p, t); };
    // A ready-bought product reads as the menu names it now.
    const nameOf = (i: StockItem) => i.kind === 'product' ? s.products.find(p => p.id === i.productId)?.name ?? i.name : i.name;
    const items = fresh.items.filter(i => !i.removedAt).map(i => {
      const level = levels.get(i.id)!;
      // "≈ 133 latte · 80 Türk kahvesi": the best sellers of the last 30 days that use this item.
      const users = [...current.values()].flatMap(r => { const need = recipeUsage(r).get(i.id); return need && need > 0 && !r.ready && menu.has(r.productId) ? [{ productId: r.productId, need }] : []; });
      const hints = users.sort((x, y) => (recent.get(y.productId) ?? 0) - (recent.get(x.productId) ?? 0)).slice(0, 2).map(u => ({ productId: u.productId, count: Math.max(0, Math.floor(level.stock / u.need + 1e-9)) }));
      const last = [...fresh.entries].reverse().find(e => !e.deletedAt && e.kind === 'purchase' && e.itemId === i.id);
      return { id: i.id, name: nameOf(i), unit: i.unit, min: i.min ?? null, kind: i.kind ?? 'ingredient', productId: i.productId, createdAt: i.createdAt, stock: level.stock, low: level.low, empty: level.empty, counted: level.counted, since: level.since, usedIn: users.map(u => u.productId), hints,
        ...(owner ? { unitCost: priceOf(i.id), lastPurchase: last ? { at: last.at, quantity: last.quantity, total: last.total, supplier: last.supplier } : null } : {}) };
    });
    const productView = Object.fromEntries(s.products.map(p => {
      const v = products.get(p.id)!, r = current.get(p.id);
      const cost = owner && r ? recipeCost(r, '', priceOf) : null;
      return [p.id, { ...v, ...(cost ? { cost: cost.missing.length ? null : Math.round(cost.cost), missing: cost.missing } : {}) }];
    }));
    const names = Object.fromEntries(fresh.items.map(i => [i.id, nameOf(i)]));
    res.setHeader('Cache-Control', 'no-store');
    // The kitchen reads the recipes (never changes them) and its own kind of records: counts, fire, returns; no money.
    const visible = (e: StockEntry) => !e.deletedAt && (owner || KITCHEN_KINDS.has(e.kind));
    // "Geri alınanlar": the last records taken back (who and when), kept in view under Son hareketler.
    const undone = fresh.entries.filter(e => e.deletedAt && (owner || KITCHEN_KINDS.has(e.kind))).sort((x, y) => (y.deletedAt ?? '').localeCompare(x.deletedAt ?? '')).slice(0, 10);
    res.json({ canEdit: owner, canCount: true, now: new Date(t).toISOString(), items, products: productView, names, recipes: [...current.values()],
      entries: fresh.entries.filter(visible).slice(-40).reverse().map(e => owner ? e : kitchenEntry(e)), undone: undone.map(e => owner ? e : kitchenEntry(e)), ...(owner ? { thresholds: thresholds(s, t) } : {}) });
  });
  app.get('/api/staff/stock/entries', (req, res) => {
    const { a } = role(req, ['owner', 'manager', 'kitchen']), owner = isManagement(a.role), q = z.object({ before: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const list = book.data(a.tenantId).entries.filter(e => !e.deletedAt && (owner || KITCHEN_KINDS.has(e.kind)) && (!q.before || e.at < q.before)).reverse();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ entries: list.slice(0, q.limit).map(e => owner ? e : kitchenEntry(e)), more: list.length > q.limit });
  });
  /**
   * Stok → İşlem geçmişi (packages/domain/stock-history.ts): who did what and when, newest first, 25 a page. The owner and the
   * Müdür see everything; the kitchen only its own counts and fire. Filters: Bugün / 7 gün / 30 gün / Tümü (business days),
   * an item, a person, and a search over the words shown.
   */
  const HISTORY_PAGE = 25;
  app.get('/api/staff/stock/history', (req, res) => {
    const { a, s } = role(req, ['owner', 'manager', 'kitchen']), owner = isManagement(a.role), t = now().getTime();
    const q = z.object({ range: z.enum(['today', '7', '30', 'all']).default('7'), itemId: z.string().max(100).optional(), by: z.string().max(100).optional(), q: z.string().max(80).optional(), page: z.coerce.number().int().min(1).max(100_000).default(1) }).parse(req.query);
    // K-T (9 Ekim): the snapshot's history is sorted once (historyIndex, kept until the next stock write); a request cuts its
    // period, filters on plain fields and words only the 25 lines it sends (a search words the lines of its period once).
    const data = book.data(a.tenantId), index = historyIndex(data), ctx = { products: s.products, staff: (s.staffUsers ?? []).map(u => ({ id: u.id, name: u.name, role: u.role })) };
    const scope = owner ? undefined : (r: { by: string; kind: StockEventKind }) => r.by === a.id && KITCHEN_HISTORY.has(r.kind);
    const { people, seen } = index.choices(ctx, scope);
    const names = data.items.filter(i => seen.has(i.id)).map(i => ({ id: i.id, name: i.kind === 'product' ? s.products.find(p => p.id === i.productId)?.name ?? i.name : i.name, removed: !!i.removedAt }));
    const today = businessDay(t), from = q.range === 'all' ? '' : new Date(dayStart(q.range === 'today' ? today : addDays(today, -(Number(q.range) - 1)))).toISOString();
    const found = index.page(ctx, { from, itemId: q.itemId, by: q.by, q: q.q, scope, offset: (q.page - 1) * HISTORY_PAGE, limit: HISTORY_PAGE });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ events: found.events, total: found.total, page: q.page, more: found.total > q.page * HISTORY_PAGE, people, items: names, all: owner });
  });

  app.post('/api/staff/stock/items', (req, res) => {
    const { a, s } = role(req, ['owner', 'manager']), b = itemInput.parse(req.body), data = book.data(a.tenantId), stamp = at();
    const old = b.id ? data.items.find(i => i.id === b.id && !i.removedAt) : undefined;
    if (b.id && !old) throw new DomainError('NOT_FOUND', 'Malzeme bulunamadı. Başka bir ekranda silinmiş olabilir.', 404);
    // A ready-bought product keeps its menu name and "adet"; only its minimum and price change here.
    if (old?.kind === 'product') { b.name = old.name; b.unit = 'piece'; }
    if (old?.kind !== 'product' && data.items.some(i => !i.removedAt && i.id !== old?.id && i.kind !== 'product' && trLower(i.name) === trLower(b.name))) throw new DomainError('DUPLICATE_ITEM', 'Bu adla bir malzeme zaten var.', 409);
    if (!old && data.items.filter(i => !i.removedAt).length >= MAX_ITEMS) throw new DomainError('STOCK_FULL', `En çok ${MAX_ITEMS} malzeme eklenebilir.`, 409);
    if (old && old.unit !== b.unit && (data.entries.some(e => !e.deletedAt && (e.itemId === old.id || e.items?.some(([x]) => x === old.id))) || data.recipes.some(r => JSON.stringify(r).includes(`"${old.id}"`)))) throw new DomainError('UNIT_LOCKED', 'Kaydı ya da reçetesi olan malzemenin birimi değiştirilemez. Yeni bir malzeme ekleyin.', 409);
    const item: StockItem = { ...(old ?? { id: randomUUID(), createdAt: stamp, kind: 'ingredient' as const }), name: b.name, unit: b.unit as StockItem['unit'], ...(old ? { updatedAt: stamp } : {}) };
    if (b.min && b.min > 0) item.min = b.min; else delete item.min;
    book.put(a.tenantId, 'item', item, item.createdAt);
    const by = staffName(s, a);
    // İşlem geçmişi: what changed, in words (8 Ekim).
    const log = (action: StockLog['action'], before?: string, after?: string) => book.put(a.tenantId, 'log', { id: randomUUID(), at: stamp, by: a.id, byName: by, role: a.role, action, itemId: item.id, name: item.name, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) }, stamp);
    const limitText = (n: number | undefined, u: StockItem['unit']) => n ? formatAmount(n, u) : 'Yok';
    if (!old) log('item_add', undefined, `${UNIT_NAMES[item.unit]}${item.min ? ` · uyarı sınırı ${formatAmount(item.min, item.unit)}` : ''}`);
    else {
      if (old.name !== item.name) log('item_edit', old.name, item.name);
      if (old.unit !== item.unit) log('item_edit', UNIT_NAMES[old.unit], UNIT_NAMES[item.unit]);
      if ((old.min ?? 0) !== (item.min ?? 0)) log('min', limitText(old.min, old.unit), limitText(item.min, item.unit));
    }
    if (!old && typeof b.initial === 'number') book.put(a.tenantId, 'entry', { id: randomUUID(), kind: 'count', at: stamp, by: a.id, byName: by, role: a.role, itemId: item.id, quantity: b.initial, expected: 0, start: true }, stamp);
    if (typeof b.unitCost === 'number') {
      const before = unitCostAt(pricePoints(item.id, book.data(a.tenantId).entries), Date.parse(stamp));
      if (before === null || Math.abs(before - b.unitCost) > 1e-9) book.put(a.tenantId, 'entry', { id: randomUUID(), kind: 'price', at: stamp, by: a.id, byName: by, role: a.role, itemId: item.id, unitCost: b.unitCost, ...(old ? {} : { start: true }) }, stamp);
    }
    // The low-stock state starts from what was just entered: no notification for the owner's own first numbers.
    const { levels } = compute(a.tenantId, s);
    const fresh = book.data(a.tenantId).items.find(i => i.id === item.id)!, low = !!levels.get(item.id)?.low;
    if (!!fresh.alert?.low !== low) book.put(a.tenantId, 'item', { ...fresh, alert: { low, n: fresh.alert?.n ?? 0 } }, fresh.createdAt);
    res.json({ item: book.data(a.tenantId).items.find(i => i.id === item.id) });
  });
  app.post('/api/staff/stock/items/delete', (req, res) => {
    const { a, s } = role(req, ['owner', 'manager']), b = z.object({ id }).parse(req.body), data = book.data(a.tenantId), t = now().getTime();
    const item = data.items.find(i => i.id === b.id && !i.removedAt);
    if (!item) throw new DomainError('NOT_FOUND', 'Malzeme bulunamadı.', 404);
    // Recipes of products removed from the menu no longer hold an item.
    const using = [...currentRecipes(data.recipes, t).values()].filter(r => !r.ready && s.products.some(p => p.id === r.productId) && JSON.stringify([r.items, r.options ?? []]).includes(`"${item.id}"`));
    if (using.length) throw new DomainError('ITEM_IN_USE', `Önce bu malzemeyi kullanan reçetelerden çıkarın: ${using.map(r => s.products.find(p => p.id === r.productId)?.name ?? 'Silinmiş ürün').slice(0, 5).join(', ')}.`, 409);
    const stamp = at();
    book.put(a.tenantId, 'item', { ...item, removedAt: stamp }, item.createdAt);
    book.put(a.tenantId, 'log', { id: randomUUID(), at: stamp, by: a.id, byName: staffName(s, a), role: a.role, action: 'item_remove', itemId: item.id, name: item.name }, stamp);
    res.json({ ok: true });
  });

  app.post('/api/staff/stock/recipes', (req, res) => {
    const { a, s } = role(req, ['owner', 'manager']), b = recipeInput.parse(req.body), data = book.data(a.tenantId), t = now().getTime();
    const product = s.products.find(p => p.id === b.productId);
    if (!product) throw new DomainError('NOT_FOUND', 'Ürün bulunamadı. Menü başka bir ekranda değişmiş olabilir.', 404);
    const versions = data.recipes.filter(r => r.productId === product.id).sort((x, y) => x.validFrom.localeCompare(y.validFrom));
    const current = versions.filter(r => Date.parse(r.validFrom) <= t).at(-1);
    const active = new Map(data.items.filter(i => !i.removedAt).map(i => [i.id, i]));
    const ingredient = (itemId: string) => { const i = active.get(itemId); if (!i || i.kind === 'product') throw new DomainError('INVALID_ITEM', 'Reçetedeki bir malzeme bulunamadı. Listeyi yenileyin.', 409); return i; };
    let next: Pick<Recipe, 'items' | 'options' | 'ready'>;
    let readyItem: StockItem | undefined = data.items.find(i => i.kind === 'product' && i.productId === product.id);
    if (b.mode === 'ready') {
      if (product.unit === 'kg') throw new DomainError('READY_KG', 'Kiloyla satılan ürün hazır ürün olarak takip edilemez; reçete yazın.', 409);
      if (!readyItem || readyItem.removedAt) {
        readyItem = readyItem ? { ...readyItem, removedAt: undefined, name: product.name, updatedAt: at() } : { id: randomUUID(), name: product.name, unit: 'piece', kind: 'product', productId: product.id, createdAt: at() };
        delete readyItem.removedAt;
        book.put(a.tenantId, 'item', readyItem, readyItem.createdAt);
      }
      next = { items: [{ itemId: readyItem.id, amount: 1 }], ready: true };
    } else if (b.mode === 'none') next = { items: [] };
    else {
      if (!b.items.length) throw new DomainError('EMPTY_RECIPE', 'En az bir malzeme ekleyin ya da "Takip yok"u seçin.', 400);
      for (const i of b.items) ingredient(i.itemId);
      if (new Set(b.items.map(i => i.itemId)).size !== b.items.length) throw new DomainError('DUPLICATE_ITEM', 'Bir malzeme reçetede bir kez yazılır.', 400);
      const options: OptionRule[] = [];
      for (const o of b.options) {
        const group = product.groups.find(g => g.id === o.groupId);
        if (!group?.options.some(x => x.id === o.optionId)) continue; // an option removed from the menu meanwhile
        for (const x of o.add ?? []) ingredient(x.itemId);
        for (const x of o.replace ?? []) { ingredient(x.from); ingredient(x.to); }
        const rule: OptionRule = { groupId: o.groupId, optionId: o.optionId, ...(o.scale && o.scale !== 1 ? { scale: o.scale } : {}), ...(o.add?.length ? { add: o.add } : {}), ...(o.replace?.length ? { replace: o.replace.filter(x => x.from !== x.to) } : {}) };
        if (rule.scale || rule.add?.length || rule.replace?.length) options.push(rule);
      }
      next = { items: b.items, ...(options.length ? { options } : {}) };
    }
    if (sameRecipe(current, next) || (!current?.items.length && !next.items.length)) return res.json({ recipe: current ?? null, unchanged: true });
    if (data.recipes.length >= MAX_RECIPES) throw new DomainError('STOCK_FULL', 'Reçete geçmişi dolu.', 409);
    // A new version starts now (after the last one, even within the same millisecond): earlier sales keep the old recipe.
    const last = versions.at(-1), from = Math.max(t, last ? Date.parse(last.validFrom) + 1 : 0);
    const recipe: Recipe = { id: randomUUID(), productId: product.id, validFrom: new Date(from).toISOString(), ...next, by: a.id, byName: staffName(s, a), role: a.role };
    book.put(a.tenantId, 'recipe', recipe, recipe.validFrom);
    // Leaving "hazır ürün": its piece stock leaves the lists too.
    if (b.mode !== 'ready' && readyItem && !readyItem.removedAt && current?.ready) book.put(a.tenantId, 'item', { ...readyItem, removedAt: at() }, readyItem.createdAt);
    res.json({ recipe });
  });

  function entry(s: State, a: Actor, value: Omit<StockEntry, 'at' | 'by' | 'byName'>): StockEntry { return { ...value, at: at(), by: a.id, byName: staffName(s, a), role: a.role }; }
  const activeItem = (tenant: string, itemId: string) => { const i = book.data(tenant).items.find(x => x.id === itemId && !x.removedAt); if (!i) throw new DomainError('NOT_FOUND', 'Malzeme bulunamadı. Listeyi yenileyin.', 404); return i; };
  const existing = (tenant: string, entryId: string) => book.data(tenant).entries.find(e => e.id === entryId);
  app.post('/api/staff/stock/purchase', (req, res) => {
    const { a, s } = role(req, ['owner', 'manager']), b = purchaseInput.parse(req.body), entryId = `p-${b.requestId}`;
    const done = existing(a.tenantId, entryId); if (done) return res.json({ entry: done });
    const item = activeItem(a.tenantId, b.itemId);
    if (b.expense && b.total < 1) throw new DomainError('INVALID_TOTAL', 'Gider olarak kaydetmek için tutarı yazın.', 400);
    // No default: a cash default silently lowered the drawer's expected cash. The owner says how it was paid.
    if (b.expense && !b.method) throw new DomainError('INVALID_METHOD', 'Gider olarak kaydetmek için ödeme yöntemini seçin.', 400);
    // 9 Ekim K-K "Para nereden çıktı?": the answer must match the expense sent with it (the drawer check of server/cash-closing.ts
    // reads `expense`/`method`/`source`). Older screens send no `paid` and keep working as before.
    if (b.paid) {
      const drawer = b.expense === true && b.method === 'cash' && b.source !== 'outside';
      const fits = b.paid === 'unpaid' ? !b.expense : b.paid === 'drawer' ? drawer : b.expense === true && !!b.method && !drawer;
      if (!fits) throw new DomainError('INVALID_PAID', 'Paranın nereden çıktığını yeniden seçin.', 400);
    }
    const value = entry(s, a, { id: entryId, kind: 'purchase', itemId: item.id, quantity: b.quantity, total: b.total, ...(b.total > 0 ? { unitCost: b.total / b.quantity } : {}), ...(b.supplier ? { supplier: b.supplier } : {}), ...(b.paid === 'unpaid' ? { unpaid: true } : {}) });
    if (!b.expense) { book.put(a.tenantId, 'entry', value, value.at); return res.json({ entry: value }); }
    // Kasadan / Kasa dışından (an expense): the expense and the purchase are written in one transaction.
    const saved = store.mutate(a.tenantId, state => {
      const expense = recordExpense(state, a, { requestId: b.requestId, amount: b.total, description: `Stok alışı: ${item.name} ${formatAmount(b.quantity, item.unit)}${b.supplier ? ` · ${b.supplier}` : ''}`, method: b.method, source: b.source }, { now: now(), id: randomUUID });
      const withExpense = { ...value, expenseId: expense.id };
      book.put(a.tenantId, 'entry', withExpense, value.at);
      return withExpense;
    });
    book.data(a.tenantId); // reload after the transaction
    res.json({ entry: saved });
  });
  app.post('/api/staff/stock/count', (req, res) => {
    const { a, s } = role(req, ['owner', 'manager', 'kitchen']), b = countInput.parse(req.body), t = now().getTime();
    const { levels } = compute(a.tenantId, s, t), results: { itemId: string; expected: number; quantity: number; difference: number }[] = [];
    for (const c of b.counts) {
      const entryId = `c-${b.requestId}-${c.itemId}`.slice(0, 100), done = existing(a.tenantId, entryId);
      if (done) { results.push({ itemId: c.itemId, expected: done.expected ?? 0, quantity: done.quantity ?? 0, difference: (done.quantity ?? 0) - (done.expected ?? 0) }); continue; }
      const item = activeItem(a.tenantId, c.itemId), expected = levels.get(item.id)?.stock ?? 0;
      const value = entry(s, a, { id: entryId, kind: 'count', itemId: item.id, quantity: c.quantity, expected });
      book.put(a.tenantId, 'entry', value, value.at);
      results.push({ itemId: item.id, expected, quantity: c.quantity, difference: c.quantity - expected });
    }
    res.json({ results });
  });
  app.post('/api/staff/stock/waste', (req, res) => {
    const { a, s } = role(req, ['owner', 'manager', 'kitchen']), b = wasteInput.parse(req.body), entryId = `w-${b.requestId}`;
    const done = existing(a.tenantId, entryId); if (done) return res.json({ entry: done });
    const item = activeItem(a.tenantId, b.itemId), value = entry(s, a, { id: entryId, kind: 'waste', itemId: item.id, quantity: b.quantity, reason: b.reason });
    book.put(a.tenantId, 'entry', value, value.at);
    res.json({ entry: value });
  });
  // A refunded product that came back unused ("Ürün iade edildi, stoğa geri döndü"): its recipe goes back into stock. Refunds alone never touch stock.
  /** One "return" entry (idempotent by its id): the product's current recipe × quantity goes back into stock. */
  function returnToStock(s: State, a: Actor, entryId: string, productId: string, wanted: number) {
    const done = existing(a.tenantId, entryId); if (done) return done;
    const product = s.products.find(p => p.id === productId), recipe = currentRecipes(book.data(a.tenantId).recipes, now().getTime()).get(productId);
    if (!product) throw new DomainError('NOT_FOUND', 'Ürün bulunamadı.', 404);
    if (!recipe) throw new DomainError('NO_RECIPE', 'Bu ürünün stok takibi yok; geri eklenecek malzeme bulunamadı.', 409);
    const quantity = product.unit === 'kg' ? wanted : Math.round(wanted);
    if (quantity <= 0) throw new DomainError('INVALID_VALUE', 'Geçerli bir adet girin.', 400);
    const items = [...recipeUsage(recipe)].filter(([, n]) => n > 0).map(([itemId, n]) => [itemId, n * quantity] as [string, number]);
    const value = entry(s, a, { id: entryId, kind: 'return', productId: product.id, productQuantity: quantity, items });
    book.put(a.tenantId, 'entry', value, value.at);
    return value;
  }
  app.post('/api/staff/stock/return', (req, res) => {
    const { a, s } = role(req, ['owner', 'manager']), b = returnInput.parse(req.body);
    res.json({ entry: returnToStock(s, a, `r-${b.requestId}`, b.productId, b.quantity) });
  });
  /**
   * "Ürünler kullanılmadan geri döndü (stoğa ekle)" on a refund (server/refunds.ts, whoever recorded the refund: the refund
   * itself was checked there). One entry per product, ids from the refund's id, so a repeated refund adds nothing twice.
   * Returns the names put back and the names without stock tracking.
   */
  function restock(tenant: string, a: Actor, refundId: string, lines: { productId: string; quantity: number; grams?: number; name: string }[]) {
    const s = store.read(tenant), added: string[] = [], skipped: string[] = [];
    lines.forEach((l, i) => {
      try { returnToStock(s, a, `r-${refundId}-${i}`, l.productId, l.grams ? l.grams / 1000 : l.quantity); added.push(l.name); }
      catch (error) { if (error instanceof DomainError && ['NO_RECIPE', 'NOT_FOUND', 'INVALID_VALUE'].includes(error.code)) skipped.push(l.name); else throw error; }
    });
    return { added, skipped };
  }
  /*
   * "Bu kaydı geri al" (Stok → Alış ve sayım → Son hareketler, the row's ⋯ menu). 8 Ekim, the owner's real-device test: the
   * old "Geri al" link on every row emptied the coffee with one curious tap. Now:
   *   Who      the owner and the Müdür (any record); the kitchen only its own count or fire.
   *   When     only on the business day the record was written (until 05:00, business-day.ts). An older wrong record is
   *            corrected with a count: the stock goes on from the counted amount, and the history stays as it happened.
   *   Never    "Başlangıç" (the amount typed with a new item): a count corrects it.
   *   Shown    GET …/entries/undo says what changes first ("Kahve stoğu 1.000 g → 0 g olur"); the record is never erased:
   *            it is marked (deletedAt, deletedBy), listed under "Geri alınanlar" and written to the business's audit.
   */
  function undoable(a: Actor, found: StockEntry | undefined, t: number) {
    if (!found || found.deletedAt) throw new DomainError('NOT_FOUND', 'Kayıt bulunamadı. Başka bir ekranda geri alınmış olabilir.', 404);
    if (!isManagement(a.role) && (found.by !== a.id || (found.kind !== 'count' && found.kind !== 'waste'))) throw new DomainError('FORBIDDEN', 'Bu kaydı yalnız işletme sahibi geri alabilir.', 403);
    if (found.start) throw new DomainError('UNDO_START', 'Başlangıç miktarı geri alınmaz. Yanlışsa Sayım yapın: stok sayılan miktardan devam eder.', 409);
    if (businessDay(Date.parse(found.at)) !== businessDay(t)) throw new DomainError('UNDO_TOO_OLD', 'Yalnız bugün yazılan kayıtlar geri alınabilir. Bu kayıt yanlışsa Sayım yapın: stok sayılan miktardan devam eder.', 409);
    return found;
  }
  /** Each item's stock now and as it would be without this record. */
  function undoEffect(tenant: string, s: State, found: StockEntry, t: number) {
    const data = book.data(tenant), feed = book.feed(tenant, s);
    const now = stockLevels(data, feed, t), without = stockLevels({ ...data, entries: data.entries.map(e => e.id === found.id ? { ...e, deletedAt: 'önizleme' } : e) }, feed, t);
    const ids = [...new Set([found.itemId, ...(found.items ?? []).map(([itemId]) => itemId)].filter((x): x is string => !!x))];
    return ids.flatMap(itemId => { const item = data.items.find(i => i.id === itemId && !i.removedAt), before = now.get(itemId), after = without.get(itemId); return item && before && after ? [{ itemId, name: item.kind === 'product' ? s.products.find(p => p.id === item.productId)?.name ?? item.name : item.name, unit: item.unit, before: before.stock, after: after.stock }] : []; });
  }
  app.get('/api/staff/stock/entries/undo', (req, res) => {
    const { a, s } = role(req, ['owner', 'manager', 'kitchen']), q = z.object({ id }).parse(req.query), t = now().getTime();
    const found = undoable(a, existing(a.tenantId, q.id), t);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ kind: found.kind, at: found.at, changes: undoEffect(a.tenantId, s, found, t), expenseKept: !!found.expenseId });
  });
  app.post('/api/staff/stock/entries/delete', (req, res) => {
    const { a, s } = role(req, ['owner', 'manager', 'kitchen']), b = z.object({ id }).parse(req.body), t = now().getTime();
    const found = undoable(a, existing(a.tenantId, b.id), t), changes = undoEffect(a.tenantId, s, found, t), by = staffName(s, a), stamp = at();
    // The mark and the audit line in one transaction (as a purchase with its expense).
    store.mutate(a.tenantId, state => {
      book.put(a.tenantId, 'entry', { ...found, deletedAt: stamp, deletedBy: by, deletedById: a.id, deletedRole: a.role, ...(changes.length ? { deletedChange: changes.map(c => `${c.name} ${formatAmount(c.before, c.unit)} → ${formatAmount(c.after, c.unit)}`).join(', ').slice(0, 300) } : {}) }, found.at);
      state.audit.push({ action: 'stock.entry_undone', actor: a.id, target: `${found.kind}:${found.id}:${changes.map(c => `${c.name} ${formatAmount(c.before, c.unit)}→${formatAmount(c.after, c.unit)}`).join(', ')}`.slice(0, 300), at: stamp });
    });
    book.data(a.tenantId); // reload after the transaction
    res.json({ ok: true, expenseKept: !!found.expenseId, changes });
  });

  // Satış ve Raporlar → Kârlılık (the report code middleware of server/report-security.ts runs first: registered after it).
  app.get('/api/staff/reports/profit', async (req, res) => {
    const { a, s } = role(req, ['owner', 'manager']), q = z.object({ from: z.string(), to: z.string(), basis: z.enum(['sale', 'today']).default('sale') }).parse(req.query), { start, end } = reportRange(q.from, q.to);
    res.setHeader('Cache-Control', 'no-store');
    // Each day is costed at its own recipes and prices, so every day of the period is read: in slices, a long period
    // ("Tümü", five years) never holds the tablets meanwhile.
    let left = false; res.on('close', () => { left = true; });
    const days = await drainSlowly(store.history.reportDaysSteps(a.tenantId, s, start, end), () => left);
    if (!days || !await drainSlowly(book.dataSteps(a.tenantId), () => left)) return;
    // The costing itself in slices too (five years: about half a second of work in one piece otherwise).
    const report = await drainSlowly(profitReportSteps({ from: q.from, to: q.to, days, products: s.products, data: book.data(a.tenantId), now: now().getTime(), margins: s.marginAlerts ?? {}, basis: q.basis }), () => left);
    if (report) res.json(report);
  });
  // Ayarlar → Giderler → "Düşük kâr uyarısı" (owner): on/off, whole percentages per group (1–95), a group per menu category.
  const marginView = (s: State) => {
    const rules = marginRules(s.marginAlerts), pct = (n: number) => Math.round(n * 100);
    const names = [...new Set([...(s.categories ?? []), ...s.products.map(p => p.category || 'Diğer')])];
    return { enabled: rules.enabled, groups: Object.fromEntries(MARGIN_GROUPS.map(g => [g, pct(rules.groups[g])])), defaults: Object.fromEntries(MARGIN_GROUPS.map(g => [g, pct(DEFAULT_MARGINS[g])])),
      categories: names.map(name => ({ name, auto: autoGroup(name), group: rules.categories[name] ?? null })) };
  };
  app.get('/api/staff/profit/settings', (req, res) => { const { s } = role(req, ['owner', 'manager']); res.setHeader('Cache-Control', 'no-store'); res.json(marginView(s)); });
  const groupEnum = z.enum(MARGIN_GROUPS as [MarginGroup, ...MarginGroup[]]), percent = z.number().int().min(1).max(95);
  app.post('/api/staff/profit/settings', (req, res) => {
    const { a } = role(req, ['owner']), b = z.object({ enabled: z.boolean(), groups: z.object({ drinks: percent, food: percent, dessert: percent, ready: percent }), categories: z.record(z.string().max(80), groupEnum.nullable()).optional() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => {
      const categories: Record<string, MarginGroup> = {};
      // Only a real choice is kept: the automatic group (or a category no longer on the menu) is not stored.
      const known = new Set([...(s.categories ?? []), ...s.products.map(p => p.category || 'Diğer')]);
      for (const [name, g] of Object.entries(b.categories ?? marginRules(s.marginAlerts).categories)) if (g && known.has(name) && g !== autoGroup(name)) categories[name] = g;
      const groups = Object.fromEntries(MARGIN_GROUPS.map(g => [g, b.groups[g] / 100])) as Record<MarginGroup, number>;
      s.marginAlerts = { enabled: b.enabled, ...(MARGIN_GROUPS.some(g => groups[g] !== DEFAULT_MARGINS[g]) ? { groups } : {}), ...(Object.keys(categories).length ? { categories } : {}) };
      s.audit.push({ action: 'settings.margin_alerts', actor: a.id, target: b.enabled ? 'on' : 'off', at: at() });
      return marginView(s);
    }));
  });

  /** Which menu products have a recipe in force now (cancellations only ask about these). */
  const tracked = (tenant: string, t: number) => new Set([...currentRecipes(book.data(tenant).recipes, t)].filter(([, r]) => r.items.length).map(([id]) => id));
  /** Questions still waiting today, for the kitchen screen; an older one counts as "Hayır, stok kullanılmadı". */
  function questions(s: State, t: number): PublicStockQuestion[] {
    if (!s.orders.some(o => o.stockQuestions?.some(q => !q.answer))) return [];
    const today = cashDayOf(t), use = tracked(s.tenantId, t), out: PublicStockQuestion[] = [];
    for (const o of s.orders) for (const q of o.stockQuestions ?? []) {
      if (q.answer || cashDayOf(q.at) !== today || !q.lines.some(l => use.has(l.productId))) continue;
      const account = s.accounts.find(x => x.id === o.accountId), table = s.tables.find(x => x.id === account?.tableId);
      out.push({ id: q.id, orderId: o.id, orderNumber: o.number, tableName: table?.name ?? 'Masa', at: q.at, byName: s.staffUsers?.find(u => u.id === q.by)?.name ?? 'Personel', lines: q.lines.filter(l => use.has(l.productId)) });
    }
    return out.sort((x, y) => x.at.localeCompare(y.at));
  }
  /**
   * "Bu üründen stok kullanıldı mı?" answered (kitchen, or the owner): "Evet" writes one fire record per item of the recipe in
   * force at the cancellation (reason "İptal · hazırlanmıştı"); "Hayır" only closes the question. Answered once; a repeat
   * changes nothing. A question from an earlier cash day is closed as "Hayır".
   */
  function answer(a: Actor, b: { orderId: string; questionId: string; used: boolean }) {
    return store.mutate(a.tenantId, s => {
      requireRole(s, a, ['owner', 'manager', 'kitchen']);
      const o = s.orders.find(x => x.id === b.orderId), q = o?.stockQuestions?.find(x => x.id === b.questionId);
      if (!o || !q) throw new DomainError('NOT_FOUND', 'Bu iptal artık listede değil.', 404);
      if (q.answer) return { answer: q.answer, wasted: 0, already: true };
      const t = now().getTime(), stamp = new Date(t).toISOString();
      if (cashDayOf(q.at) !== cashDayOf(t)) throw new DomainError('QUESTION_CLOSED', 'Gün kapandı; bu iptal “stok kullanılmadı” sayıldı. Gerekirse Stok → Fire kaydet.', 409);
      q.answer = b.used ? 'yes' : 'no'; q.answeredAt = stamp; q.answeredBy = a.id;
      let wasted = 0;
      if (b.used) {
        const data = book.data(a.tenantId), when = Date.parse(q.at), recipes = currentRecipes(data.recipes, when), live = new Set(data.items.filter(i => !i.removedAt).map(i => i.id));
        const amounts = new Map<string, number>();
        for (const l of q.lines) { const r = recipes.get(l.productId); if (!r) continue; for (const [itemId, n] of recipeUsage(r, l.key)) if (n > 0 && live.has(itemId)) amounts.set(itemId, (amounts.get(itemId) ?? 0) + n * lineMultiplier(l.quantity, l.grams ?? 0)); }
        const byName = staffName(s, a), products = q.lines.map(l => `${l.quantity} × ${l.name}`).join(', ');
        for (const [itemId, quantity] of amounts) { book.put(a.tenantId, 'entry', { id: `x-${q.id}-${itemId}`.slice(0, 100), kind: 'waste', at: stamp, by: a.id, byName, role: a.role, itemId, quantity, reason: `${CANCEL_WASTE_REASON} (${products})`.slice(0, 120) }, stamp); wasted++; }
      }
      s.audit.push({ action: b.used ? 'stock.cancel_used' : 'stock.cancel_unused', actor: a.id, target: q.id, at: stamp });
      return { answer: q.answer, wasted };
    });
  }
  app.post('/api/staff/stock/answer', (req, res) => { const a = actorFor(req), b = z.object({ orderId: id, questionId: id, used: z.boolean() }).parse(req.body); res.json(answer(a, b)); });

  if (everyMs > 0) {
    // Read the stored days once, some seconds after the start, while nobody waits for them (not inside unit tests, which count rows).
    const warmer = setTimeout(() => { if (process.env.NODE_TEST_CONTEXT) { book.warmed = true; return; } void book.warm({ now: now().getTime(), stopped: () => !store.db.isOpen }).catch(error => { if (store.db.isOpen) console.warn(`Satış özetleri hazırlanamadı: ${error instanceof Error ? error.message : error}`); }); }, 10_000);
    warmer.unref();
    const timer = setInterval(() => {
      // Not before the start-up read finished: it reads the same days in slices, this check would read them all at once.
      if (!book.warmed) return;
      try { for (const { tenant } of store.db.prepare('SELECT DISTINCT tenant FROM stock_records').all() as { tenant: string }[]) { try { sweep(tenant); } catch (error) { if (!store.db.isOpen) throw error; console.warn(`Stok uyarıları hazırlanamadı: ${error instanceof Error ? error.message : error}`); } } }
      catch { clearInterval(timer); }
    }, everyMs);
    timer.unref();
  }
  return { book, sweep, compute, questions, answer, tracked, restock };
}
