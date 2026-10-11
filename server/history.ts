import type { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes } from 'node:crypto';
import { open, openText, seal, sealText } from './sealing.js';
import { maskDays, maskIso, type Mask, type YearPackages } from './year-packages.js';
import { assertOpenDay, closedYearText, CLOSED_YEAR } from '../packages/domain/closed-year.js';
import { DomainError } from '../packages/domain/engine.js';
import type { Account, Archive, ArchivedAccount, Expense, Order, Payment, State } from '../packages/domain/types.js';
import type { PaymentAdjustment } from '../packages/domain/payment-adjustments.js';
import type { SpanTotals } from '../packages/domain/campaign-reports.js';
import { applyMethodChanges, businessDay, DAY_MS, dayPoint, dayStart, freezeRates, mergeTotals, readPoint, storePoint, summarize, Totals, type DayPoint, type DaySummary, type HistoryRecords, type ReportSpan, type StoredPoint } from '../packages/domain/history.js';
import { legacyRateOf } from '../packages/domain/vat.js';
import { campaignQuantities } from '../packages/domain/campaigns.js';
import { openTables, unqueuedPlatformAccounts, withoutPersonal } from '../packages/domain/external-orders.js';
import { expenseAt } from '../packages/domain/expense-rules.js';
import { ledgerCursor, ledgerQuery, ledgerRows, ledgerShort, newer, type LedgerQuery, type LedgerRow, type LedgerSpec, type PaymentLedgerPage } from '../packages/domain/payment-history.js';

// Long-term history lives outside the per-business snapshot, so a normal action costs the same in year three as on
// day one. Every row is sealed with the business key; the AAD names business, kind and record, so rows cannot be
// swapped between businesses or records. All writes happen inside the caller's snapshot transaction.

/** A closed table stays on the floor this long: guest sessions (6 h) still show it, receipts can be reprinted. */
export const SETTLE_AFTER_MS = 6 * 3600_000;
/** Paid but never marked served: leaves the kitchen screen after a day (the print queue looks back 24 h too). */
export const STALE_AFTER_MS = 24 * 3600_000;
/** Idempotency records. Guest sessions last 6 h and staff sessions 8 h; a week also covers a closed weekend. */
export const REQUEST_RETENTION_MS = 7 * 86400_000;
// SUMMARY_VERSION 2: products carry the grams of weighed lines; older cached days rebuild on first read.
// SUMMARY_VERSION 3: platform payments ("Platform ödemesi") and sales channels (Salon / QR, Masasız, delivery platforms).
// SUMMARY_VERSION 4: `variants`, the option choices of sold lines (Stok consumption and Kârlılık, packages/domain/stock.ts).
// SUMMARY_VERSION 5: days run 05:00–05:00 (the kasa günü, packages/domain/business-day.ts), and the "Rezervasyon" part of a
//   payment is its bill's reserved share. Older cached days (calendar days) rebuild on first read or in StockBook.warm.
// PAYMENT_DAY_VERSION 2: the same business days for the cached payment lists of İade ve düzeltme.
// Day columns written before version 5 (history_ledger day/ref_day, history_payments day) hold the calendar day, which is
// the business day or the one after it; every read by those columns asks for one more day and then filters by the time.
export const SUMMARY_VERSION = 5;
/**
 * Monthly and yearly roll-ups (history_months, history_years): one sealed row per closed month or year and kind, so "Tümü"
 * and a year read a handful of rows instead of every day, tip, shift and closing (docs/HIZ_TESTI_5_YIL.md, "Faz 2").
 *   sales  the period's totals (the day summaries added up; guest tags as counts; KDV rates frozen) and every day's point;
 *   cash   tips and gün sonu closings (server/cash-closing.ts CashBook.cashSpan);
 *   staff  minutes, shifts, lateness and tip shares per employee (server/shifts.ts ShiftBook.staffSpan).
 * Only months (years) that ended are rolled up; the running month is read by day. Anything that changes a past business day
 * (a bill settling late, an old bill's refund, a method correction, a back-dated or edited expense, a closing finished or
 * corrected, a tip, a shift corrected) drops the roll-ups of its month and year; the next report builds them again, in steps.
 * A row carries ROLLUP_VERSION, SUMMARY_VERSION and its kind's own mark; any change of these makes it read as missing.
 */
export const ROLLUP_VERSION = 1;
export type RollupKind = 'sales' | 'cash' | 'staff';
/** A sales roll-up: the totals (Totals.rollup) and every day's point, in date order. */
type SalesRollup = { t: DaySummary; days: StoredPoint[] };
type Bounds = { first: string; last: string } | null;
type Segment = { kind: 'year' | 'month'; period: string } | { kind: 'day'; day: string; from: number; to: number };
const PAYMENT_DAY_VERSION = 2, MIN_DAY = '0000-01-01', MAX_DAY = '9999-12-31', FAR = 8.64e15;
const terminal = new Set(['served', 'cancelled']);
type Payload = { payload: Uint8Array };
/** A settled account as the payment history needs it: its payments on one day, and the table it was on. */
type PaymentDayAccount = Omit<Archive, 'orders'> & { tableId?: string };

export class History {
  private spans = new Map<string, number>();
  private sums = new Map<string, Map<string, { count: number; amount: number }>>();
  private generations = new Map<string, number>();
  private popular = new Map<string, { generation: number; from: string; to: string; quantities: Map<string, number> }>();
  /** packages: the closed years' read-only files (server/year-packages.ts); every read below takes them in. */
  constructor(private db: DatabaseSync, private master: Buffer, private tenantKey: (tenant: string) => Buffer, private clock: () => number, private packages?: YearPackages) {
    db.exec(`CREATE TABLE IF NOT EXISTS history_archives (tenant TEXT NOT NULL, id TEXT NOT NULL, day TEXT NOT NULL, first_at INTEGER NOT NULL, closed_at INTEGER NOT NULL, table_ref TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (tenant, id));
      CREATE INDEX IF NOT EXISTS history_archives_day ON history_archives(tenant, day);
      CREATE INDEX IF NOT EXISTS history_archives_closed ON history_archives(tenant, closed_at);
      CREATE INDEX IF NOT EXISTS history_archives_table ON history_archives(tenant, table_ref);
      -- The longest bill (span()): without it the first report after every start read the whole table (2 s for five years of
      -- a 150-bill café, docs/HIZ_TESTI_5_YIL.md); built once, in under a second for that café.
      CREATE INDEX IF NOT EXISTS history_archives_span ON history_archives(tenant, closed_at - first_at);
      CREATE TABLE IF NOT EXISTS history_payments (token TEXT PRIMARY KEY, tenant TEXT NOT NULL, archive_id TEXT NOT NULL, day TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS history_payments_tenant ON history_payments(tenant);
      CREATE TABLE IF NOT EXISTS history_ledger (seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, day TEXT NOT NULL, ref TEXT, ref_day TEXT, payload BLOB NOT NULL, UNIQUE (tenant, kind, id));
      CREATE INDEX IF NOT EXISTS history_ledger_day ON history_ledger(tenant, kind, day);
      CREATE INDEX IF NOT EXISTS history_ledger_ref ON history_ledger(tenant, ref);
      CREATE INDEX IF NOT EXISTS history_ledger_ref_day ON history_ledger(tenant, ref_day);
      CREATE TABLE IF NOT EXISTS history_audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, payload BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS history_audit_tenant ON history_audit(tenant, seq);
      CREATE TABLE IF NOT EXISTS history_requests (token TEXT PRIMARY KEY, tenant TEXT NOT NULL, at INTEGER NOT NULL, payload BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS history_requests_age ON history_requests(tenant, at);
      CREATE TABLE IF NOT EXISTS history_days (tenant TEXT NOT NULL, day TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (tenant, day));
      CREATE TABLE IF NOT EXISTS history_payment_days (tenant TEXT NOT NULL, day TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (tenant, day));
      CREATE TABLE IF NOT EXISTS history_months (tenant TEXT NOT NULL, kind TEXT NOT NULL, month TEXT NOT NULL, version TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (tenant, kind, month));
      CREATE TABLE IF NOT EXISTS history_years (tenant TEXT NOT NULL, kind TEXT NOT NULL, year TEXT NOT NULL, version TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (tenant, kind, year));`);
  }
  /** Keyed lookup tokens, like the login and QR indexes: no plaintext identifiers leave the sealed rows. */
  private token(kind: string, tenant: string, value: string) { return createHmac('sha256', this.master).update(`mola:history-${kind}:v1\0${tenant}\0${value}`).digest('hex'); }
  private read<T>(tenant: string, row: Payload, scope: string) { return open<T>(Buffer.from(row.payload), this.tenantKey(tenant), scope); }
  /** Rows are written compressed once the database is marked data version 3 (Store turns this on after marking it). */
  packing = false;
  private stopped = false;
  private seal(value: unknown, key: Buffer, scope: string) { return seal(value, key, scope, this.packing); }
  /** The database is closing: background work (rewrite, long counts) ends at its next step. */
  stop() { this.stopped = true; }
  /**
   * Where rows of `table` are read: the year packages overlapping the business days [from, to] (oldest first) and the live
   * database last, its rows of a year being emptied out into its package left out (`live` builds that condition).
   */
  private sources(table: string, live: (m: Mask | null) => string, from?: string, to?: string, tenant?: string) {
    const m = this.packages?.mask() ?? null;
    return [...(this.packages?.shards(table, from, to, tenant) ?? []).map(db => ({ db, where: '1' })), { db: this.db, where: live(m) }];
  }
  /** The last business day of the newest closed year (null: none): nothing may be written into it. */
  closedEnd() { return this.packages?.closedEnd() ?? null; }
  /** A year was sealed or left the live file (server/year-packer.ts): bounds and the longest bill are read again. */
  packaged() {
    this.spans.clear(); this.boundsCache.clear(); this.popular.clear();
    for (const tenant of [...this.generations.keys()]) this.generations.set(tenant, (this.generations.get(tenant) ?? 0) + 1);
  }
  /**
   * One-time rewrite into data version 3: every history row written before it is opened and sealed again compressed.
   * Small batches, each in its own transaction with its progress mark, so a crash or shutdown loses at most one batch
   * and the next start goes on from the mark; between batches the server answers requests. Rows already packed (and
   * every row written since) are only opened and left as they are. Returns whether the whole pass finished.
   */
  async compact(options: { sliceMs?: number; pauseMs?: number; onBatch?: () => void } = {}) {
    const { sliceMs = 12, pauseMs = 5 } = options;
    if (!this.packing) return false;
    this.db.exec('CREATE TABLE IF NOT EXISTS history_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const mark = this.db.prepare('INSERT OR REPLACE INTO history_meta (key,value) VALUES (?,?)'), meta = this.db.prepare('SELECT value FROM history_meta WHERE key=?');
    let skipped = 0, saved = Number((meta.get('packed:saved') as { value: string } | undefined)?.value ?? 0); const keys = new Map<string, Buffer>(), key = (tenant: string) => { let k = keys.get(tenant); if (!k) keys.set(tenant, k = this.tenantKey(tenant)); return k; };
    for (const [table, columns, scope] of SEALED_HISTORY) {
      const next = this.db.prepare(`SELECT rowid AS rowid,${columns} FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 200`), update = this.db.prepare(`UPDATE ${table} SET payload=? WHERE rowid=?`);
      let after = Number((meta.get(`packed:${table}`) as { value: string } | undefined)?.value ?? 0);
      for (;;) {
        if (this.stopped) return false;
        const until = performance.now() + sliceMs;
        let more = true;
        this.db.exec('BEGIN IMMEDIATE');
        try {
          while (more && performance.now() < until) {
            const rows = next.all(after) as (Record<string, string> & { rowid: number; payload: Uint8Array })[];
            more = rows.length === 200;
            for (const row of rows) {
              after = row.rowid;
              let opened: ReturnType<typeof openText>;
              // A row that cannot be opened is left exactly as it is (backup checks report it); the pass goes on.
              try { opened = openText(Buffer.from(row.payload), key(row.tenant), scope(row)); } catch { skipped++; continue; }
              if (!opened.packed) { const packed = sealText(opened.json, key(row.tenant), scope(row), true); update.run(packed, row.rowid); saved += row.payload.length - packed.length; }
              if (performance.now() >= until) { more = true; break; }
            }
          }
          // Bytes saved so far: the space a VACUUM at the next start would give back (Store.reclaim). Smaller rows leave
          // room inside their pages rather than whole free pages, so SQLite's free page count does not show it.
          mark.run(`packed:${table}`, String(after)); mark.run('packed:saved', String(saved));
          this.db.exec('COMMIT');
        } catch (e) { this.db.exec('ROLLBACK'); throw e; }
        options.onBatch?.();
        if (!more) break;
        await new Promise(done => setTimeout(done, pauseMs));
      }
    }
    if (skipped) console.warn(`Geçmiş kayıtları sıkıştırılırken ${skipped} kayıt açılamadı; olduğu gibi bırakıldı. Yedek doğrulamasını çalıştırın.`);
    if (!meta.get('packed:complete')) mark.run('packed:complete', new Date(this.clock()).toISOString());
    return true;
  }

  // ---- Writes: move outgoing records from the snapshot into their tables (caller holds the transaction) ----
  persist(s: State, key: Buffer, now: number) {
    const tenant = s.tenantId;
    if (s.audit.length) {
      // The directory shows when setup finished; keep it on the snapshot once its audit entry leaves.
      s.setupCompletedAt ??= s.audit.find(a => a.action === 'business.configured')?.at;
      const insert = this.db.prepare('INSERT INTO history_audit (tenant,id,at,payload) VALUES (?,?,?,?)');
      for (const entry of s.audit) { const id = randomBytes(12).toString('hex'); insert.run(tenant, id, entry.at, this.seal(entry, key, `audit:${tenant}:${id}`)); }
      s.audit = [];
    }
    const requests = Object.entries(s.requests);
    if (requests.length) {
      const insert = this.db.prepare('INSERT INTO history_requests (token,tenant,at,payload) VALUES (?,?,?,?) ON CONFLICT(token) DO UPDATE SET at=excluded.at, payload=excluded.payload');
      for (const [scope, value] of requests) { const token = this.token('request', tenant, scope); insert.run(token, tenant, now, this.seal(value, key, `request:${tenant}:${token}`)); }
      s.requests = {};
    }
    this.db.prepare('DELETE FROM history_requests WHERE tenant=? AND at<?').run(tenant, now - REQUEST_RETENTION_MS);
    const ledger = this.db.prepare('INSERT INTO history_ledger (tenant,kind,id,day,ref,ref_day,payload) VALUES (?,?,?,?,?,?,?)');
    if (s.expenses?.length) {
      // An owner's edit or deletion comes back here as a changed copy: it replaces its row (same seq, so list order stays),
      // and both the old and the new day are counted again.
      const write = this.db.prepare('INSERT INTO history_ledger (tenant,kind,id,day,ref,ref_day,payload) VALUES (?,?,?,?,NULL,NULL,?) ON CONFLICT(tenant,kind,id) DO UPDATE SET day=excluded.day, payload=excluded.payload');
      const before = this.db.prepare("SELECT day FROM history_ledger WHERE tenant=? AND kind='expense' AND id=?"), closed = this.closedEnd();
      for (const e of s.expenses) {
        const day = businessDay(expenseAt(e)), old = (before.get(tenant, e.id) as { day: string } | undefined)?.day;
        // The last guard of a closed year (packages/domain/closed-year.ts checks first, with the owner's sentence): nothing
        // is written into it, and nothing of it is changed (an expense kept in a package is never written again).
        const kept = closed ? this.expense(tenant, e.id) : undefined, keptDay = kept ? businessDay(expenseAt(kept)) : undefined;
        if (closed && (day <= closed || (keptDay && keptDay <= closed))) throw new DomainError(CLOSED_YEAR, closedYearText(day <= closed ? day : keptDay!), 409);
        write.run(tenant, 'expense', e.id, day, this.seal(e, key, `ledger:${tenant}:expense:${e.id}`)); this.invalidate(tenant, day, day);
        // A stored day from before SUMMARY_VERSION 5 may be the calendar day: the business day before it is dropped too.
        if (old && old !== day) this.invalidate(tenant, previousDay(old), old);
      }
      s.expenses = [];
    }
    if (s.paymentAdjustments?.length) {
      const floor = new Map(livePayments(s).map(p => [p.id, p])), closed = this.closedEnd();
      for (const a of s.paymentAdjustments) {
        // A method change rewrites its payment's day; a refund counts on the day it was given.
        const live = floor.get(a.paymentId);
        const paymentDay = live ? businessDay(live.createdAt) : this.storedPayment(tenant, a.paymentId)?.day ?? null, day = businessDay(a.createdAt);
        // A closed year's payment: its method stays; its refund counts wholly today (items too, summarize).
        if (closed && day <= closed) assertOpenDay(closed, day);
        if (closed && paymentDay && paymentDay <= closed) { if (a.kind === 'method') assertOpenDay(closed, paymentDay); a.closedPeriod = true; }
        ledger.run(tenant, 'adjustment', a.id, day, this.token('payment', tenant, a.paymentId), paymentDay, this.seal(a, key, `ledger:${tenant}:adjustment:${a.id}`));
        this.invalidate(tenant, day, day); if (paymentDay) this.invalidate(tenant, live ? paymentDay : previousDay(paymentDay), paymentDay);
      }
      s.paymentAdjustments = [];
    }
    this.settle(s, key, now);
  }
  /** Closed tables leave the snapshot once nobody on the floor needs them; their final copies become one archive row. */
  private settle(s: State, key: Buffer, now: number) {
    if (!s.accounts.some(a => a.status === 'closed') && !s.archives.length) return;
    // Grouped once: a first migration may hold years of accounts.
    const group = <T extends { accountId: string }>(items: T[]) => { const m = new Map<string, T[]>(); for (const v of items) { const list = m.get(v.accountId); if (list) list.push(v); else m.set(v.accountId, [v]); } return m; };
    const ordersOf = group(s.orders), paymentsOf = group(s.payments), archivesOf = group(s.archives);
    const lastActivity = (a: Account) => [a.openedAt, ...(ordersOf.get(a.id) ?? []).flatMap(o => [o.createdAt, o.updatedAt ?? o.createdAt]), ...(paymentsOf.get(a.id) ?? []).map(p => p.createdAt)].reduce((max, t) => t > max ? t : max, a.openedAt);
    const known = new Set(s.accounts.map(a => a.id)), leaving: { account?: Account; accountId: string }[] = [];
    // A platform order's last step must reach the outbox first (the integration loop does it on its next round).
    const platformWaiting = unqueuedPlatformAccounts(s);
    for (const a of s.accounts) if (a.status === 'closed' && !platformWaiting.has(a.id)) {
      // Old empty closures carry no closing time; their last order or payment is the closest record.
      const age = now - Date.parse(a.closedAt ?? lastActivity(a));
      if (age >= SETTLE_AFTER_MS && (age >= STALE_AFTER_MS || (ordersOf.get(a.id) ?? []).every(o => terminal.has(o.status)))) leaving.push({ account: a, accountId: a.id });
    }
    // Legacy archives whose account record is gone have nothing left on the floor.
    for (const id of archivesOf.keys()) if (!known.has(id)) leaving.push({ accountId: id });
    if (!leaving.length) return;
    const insert = this.db.prepare('INSERT INTO history_archives (tenant,id,day,first_at,closed_at,table_ref,payload) VALUES (?,?,?,?,?,?,?)');
    const index = this.db.prepare('INSERT OR REPLACE INTO history_payments (token,tenant,archive_id,day) VALUES (?,?,?,?)');
    const tenant = s.tenantId, gone = new Set(leaving.map(l => l.accountId)), tables = new Map([...s.tables, ...(s.retiredTables ?? [])].map(t => [t.id, t.name])), blocked = new Set(s.blocked);
    for (const { account, accountId } of leaving) {
      const archives = archivesOf.get(accountId) ?? [], liveOrders = ordersOf.get(accountId) ?? [];
      // Live copies are final (kitchen status, print marks); they replace the copies taken at payment time.
      const orders = new Map(archives.flatMap(x => x.orders).map(o => [o.id, o])); for (const o of liveOrders) orders.set(o.id, o);
      const payments = new Map(archives.flatMap(x => x.payments).map(p => [p.id, p])); for (const p of paymentsOf.get(accountId) ?? []) payments.set(p.id, p);
      const base = archives.at(-1), tableId = account?.tableId;
      const tableName = base?.tableName ?? (tableId && tables.get(tableId)) ?? 'Masa';
      const closedAt = base?.closedAt ?? account?.closedAt ?? lastActivity(account!);
      const row: ArchivedAccount = { ...(base ?? { id: `closed:${accountId}`, accountId, tableName, closedAt, total: 0, cash: 0, card: 0, synthetic: true }), orders: [...orders.values()].map(withoutPersonal), payments: [...payments.values()], ...(account ? { account } : {}) };
      const times = [...row.orders.map(o => o.createdAt), ...row.payments.map(p => p.createdAt), ...(account ? [account.openedAt] : []), row.closedAt].map(Date.parse).filter(Number.isFinite);
      const first = Math.min(...times), closed = Date.parse(row.closedAt), day = businessDay(closed);
      // Keyed table reference for per-table lookups; only tables that had orders count as used.
      const tableRef = row.orders.length ? this.token('table', tenant, tableId ?? `legacy:${row.tableName || accountId}`) : '';
      insert.run(tenant, row.id, day, first, closed, tableRef, this.seal(row, key, `archive:${tenant}:${row.id}`));
      for (const p of row.payments) index.run(this.token('payment', tenant, p.id), tenant, row.id, businessDay(p.createdAt));
      this.invalidate(tenant, businessDay(first), day);
      if (this.spans.has(tenant)) this.spans.set(tenant, Math.max(this.spans.get(tenant)!, closed - first));
      for (const o of row.orders) {
        if (o.status !== 'cancelled') for (const [id, quantity] of campaignQuantities(o.lines)) { s.archivedCampaignUsage ??= {}; s.archivedCampaignUsage[id] = (s.archivedCampaignUsage[id] ?? 0) + quantity; }
        if (blocked.has(o.guestId) && !s.blockedInfo?.[o.guestId]) (s.blockedInfo ??= {})[o.guestId] = { orderId: o.id, number: o.number, label: o.guestLabel };
      }
      if (liveOrders.length) s.orderNumberBase = (s.orderNumberBase ?? 0) + liveOrders.length;
    }
    s.accounts = s.accounts.filter(a => !gone.has(a.id)); s.orders = s.orders.filter(o => !gone.has(o.accountId));
    s.payments = s.payments.filter(p => !gone.has(p.accountId)); s.archives = s.archives.filter(x => !gone.has(x.accountId));
  }
  private invalidate(tenant: string, from: string, to: string) {
    // A closed year never changes: its summaries and roll-ups stay (a refund of its bill counts today, closedPeriod).
    const closed = this.closedEnd();
    if (closed && from <= closed) from = nextDay(closed);
    if (from > to) return;
    this.db.prepare('DELETE FROM history_days WHERE tenant=? AND day BETWEEN ? AND ?').run(tenant, from, to);
    this.db.prepare('DELETE FROM history_payment_days WHERE tenant=? AND day BETWEEN ? AND ?').run(tenant, from, to);
    this.dropRollups(tenant, ['sales'], from, to);
    for (const day of this.sums.get(tenant)?.keys() ?? []) if (day >= from && day <= to) this.sums.get(tenant)!.delete(day);
    this.generations.set(tenant, (this.generations.get(tenant) ?? 0) + 1);
    for (const listener of this.watchers) listener(tenant, from, to);
  }
  private watchers = new Set<(tenant: string, from: string, to: string) => void>();
  /** Called whenever stored business days change (a table settles, an expense or correction is filed): caches built on them (server/stock.ts) drop those days. */
  watch(listener: (tenant: string, from: string, to: string) => void) { this.watchers.add(listener); return () => { this.watchers.delete(listener); }; }
  /** One stored business day's totals (settled sales only, nothing from the floor). */
  storedDay(tenant: string, day: string) { return this.stored(tenant, day); }
  /** A "Tanıtım" reset (server/demo-reset.ts) removed this business's stored rows: everything cached about it goes, watchers too. */
  forget(tenant: string) {
    this.spans.delete(tenant); this.sums.delete(tenant); this.popular.delete(tenant); this.boundsCache.delete(tenant);
    this.generations.set(tenant, (this.generations.get(tenant) ?? 0) + 1);
    for (const listener of this.watchers) listener(tenant, '0000-01-01', '9999-12-31');
  }

  // ---- Reads ----
  request(tenant: string, scope: string) {
    const token = this.token('request', tenant, scope);
    const row = this.db.prepare('SELECT at,payload FROM history_requests WHERE token=? AND tenant=?').get(token, tenant) as (Payload & { at: number }) | undefined;
    if (!row || row.at < this.clock() - REQUEST_RETENTION_MS) return undefined;
    return this.read<State['requests'][string]>(tenant, row, `request:${tenant}:${token}`);
  }
  /** Oldest first, like the old in-snapshot list (the newest `limit`, the closed years' packages too). */
  audit(tenant: string, limit = 1000) {
    const rows = this.sources('history_audit', m => maskIso(m, 'at'), undefined, undefined, tenant).flatMap(src => src.db.prepare(`SELECT seq,id,payload FROM history_audit WHERE tenant=? AND ${src.where} ORDER BY seq DESC LIMIT ?`).all(tenant, limit) as (Payload & { id: string; seq: number })[]);
    return rows.sort((a, b) => b.seq - a.seq).slice(0, limit).reverse().map(row => this.read<State['audit'][number]>(tenant, row, `audit:${tenant}:${row.id}`));
  }
  private span(tenant: string) {
    if (!this.spans.has(tenant)) this.spans.set(tenant, Math.max(0, ...this.sources('history_archives', m => maskDays(m, 'day'), undefined, undefined, tenant).map(src => Number((src.db.prepare(`SELECT COALESCE(MAX(closed_at-first_at),0) AS span FROM history_archives WHERE tenant=? AND ${src.where}`).get(tenant) as { span: number }).span))));
    return this.spans.get(tenant)!;
  }
  /** Settled accounts with any order or payment inside [start, end), oldest closure first (closed years' packages first). */
  archives(tenant: string, start: number, end: number): ArchivedAccount[] {
    const lo = Number.isFinite(start) ? start : -FAR, hi = Number.isFinite(end) ? end : FAR, until = Math.min(FAR, hi + this.span(tenant) + 1);
    const out: ArchivedAccount[] = [];
    // Package tiles hold earlier closings than the live file: package after package, then live, is closing order.
    for (const src of this.sources('history_archives', m => maskDays(m, 'day'), lo > -FAR ? businessDay(lo) : MIN_DAY, until < FAR ? businessDay(until) : MAX_DAY, tenant)) {
      const rows = src.db.prepare(`SELECT id,payload FROM history_archives WHERE tenant=? AND closed_at>=? AND closed_at<? AND first_at<? AND ${src.where} ORDER BY closed_at,id`).all(tenant, lo, until, hi) as (Payload & { id: string })[];
      for (const row of rows) out.push(this.read<ArchivedAccount>(tenant, row, `archive:${tenant}:${row.id}`));
    }
    return out;
  }
  private storedPayment(tenant: string, paymentId: string) {
    const stored = this.storedAccount(tenant, paymentId), payment = stored?.account.payments.find(p => p.id === paymentId);
    return payment && { payment, day: stored!.day };
  }
  /** The payment's bill: the live file first, then the closed years (newest first); a bill and its index are always in one file. */
  private storedAccount(tenant: string, paymentId: string) {
    const token = this.token('payment', tenant, paymentId);
    for (const src of this.sources('history_payments', () => '1', undefined, undefined, tenant).reverse()) {
      const index = src.db.prepare('SELECT archive_id,day FROM history_payments WHERE token=? AND tenant=?').get(token, tenant) as { archive_id: string; day: string } | undefined;
      const row = index && src.db.prepare('SELECT payload FROM history_archives WHERE tenant=? AND id=?').get(tenant, index.archive_id) as Payload | undefined;
      if (row) return { account: this.read<ArchivedAccount>(tenant, row, `archive:${tenant}:${index!.archive_id}`), day: index!.day };
    }
    return undefined;
  }
  /** The settled account holding a payment, found through the payment index: one row opened, whatever the history size. */
  paymentAccount(tenant: string, paymentId: string) { return this.storedAccount(tenant, paymentId)?.account; }
  /**
   * Rows by their stored day (one day wider at the end: older rows hold the calendar day, see SUMMARY_VERSION); callers filter
   * by time. In recording order (seq), the closed years' packages included: a row's `ref_day` is never after its own day.
   */
  private ledger<T>(tenant: string, kind: 'expense' | 'adjustment', column: 'day' | 'ref_day' | 'ref', from: string, to = from): T[] {
    const where = column === 'ref' ? 'ref=?' : `${column} BETWEEN ? AND ?`, upper = column === 'ref' ? MAX_DAY : to === MAX_DAY ? to : nextDay(to);
    const sources = this.sources('history_ledger', m => maskDays(m, 'day'), column === 'ref' ? MIN_DAY : from, column === 'day' ? upper : MAX_DAY, tenant);
    const rows = sources.flatMap(src => src.db.prepare(`SELECT seq,id,payload FROM history_ledger WHERE tenant=? AND kind=? AND ${where} AND ${src.where} ORDER BY seq`).all(tenant, kind, ...(column === 'ref' ? [from] : [from, upper])) as (Payload & { id: string; seq: number })[]);
    if (sources.length > 1) rows.sort((a, b) => a.seq - b.seq);
    return rows.map(row => this.read<T>(tenant, row, `ledger:${tenant}:${kind}:${row.id}`));
  }
  private days(start: number, end: number) { return { from: Number.isFinite(start) ? businessDay(start) : MIN_DAY, to: Number.isFinite(end) ? businessDay(end - 1) : MAX_DAY }; }
  /** Expenses and payment corrections recorded inside [start, end), in recording order. */
  expenses(tenant: string, start: number, end: number) { const d = this.days(start, end); return this.ledger<Expense>(tenant, 'expense', 'day', d.from, d.to); }
  /** One stored expense, for an owner's edit or deletion (a closed year's is found too, and refused there). */
  expense(tenant: string, id: string) {
    for (const src of this.sources('history_ledger', () => '1', undefined, undefined, tenant).reverse()) {
      const row = src.db.prepare("SELECT payload FROM history_ledger WHERE tenant=? AND kind='expense' AND id=?").get(tenant, id) as Payload | undefined;
      if (row) return this.read<Expense>(tenant, row, `ledger:${tenant}:expense:${id}`);
    }
    return undefined;
  }
  adjustments(tenant: string, start: number, end: number) { const d = this.days(start, end); return this.ledger<PaymentAdjustment>(tenant, 'adjustment', 'day', d.from, d.to); }
  /** The newest `limit` expenses or corrections by their day, newest first: "Tümü" lists a page, never every row of years. */
  newestLedger<T>(tenant: string, kind: 'expense' | 'adjustment', limit: number): T[] {
    const rows = this.sources('history_ledger', m => maskDays(m, 'day'), undefined, undefined, tenant).flatMap(src => src.db.prepare(`SELECT seq,day,id,payload FROM history_ledger WHERE tenant=? AND kind=? AND ${src.where} ORDER BY day DESC, seq DESC LIMIT ?`).all(tenant, kind, limit) as (Payload & { id: string; seq: number; day: string })[]);
    rows.sort((a, b) => b.day.localeCompare(a.day) || b.seq - a.seq);
    return rows.slice(0, limit).map(row => this.read<T>(tenant, row, `ledger:${tenant}:${kind}:${row.id}`));
  }
  /** A payment for a correction, wherever it is now, with all of its earlier corrections applied. */
  paymentForAdjustment(tenant: string, s: State, paymentId: string) {
    const history = [...this.ledger<PaymentAdjustment>(tenant, 'adjustment', 'ref', this.token('payment', tenant, paymentId)), ...(s.paymentAdjustments ?? []).filter(a => a.paymentId === paymentId)];
    const found = [...s.archives.flatMap(a => a.payments), ...s.payments].filter(p => p.id === paymentId).at(-1) ?? this.storedPayment(tenant, paymentId)?.payment;
    return { payment: found && applyMethodChanges([found], history)[0], history };
  }
  /** The snapshot's own records; refunds and expenses are always in the ledger, never on the floor. */
  private live(tenant: string, s: State): HistoryRecords {
    const orders = new Map(s.archives.flatMap(a => a.orders).map(o => [o.id, o])); for (const o of s.orders) orders.set(o.id, o);
    const payments = livePayments(s);
    const methods = payments.length ? this.ledger<PaymentAdjustment>(tenant, 'adjustment', 'ref_day', earliestDay(payments), MAX_DAY) : [];
    return { orders: orders.values(), payments: applyMethodChanges(payments, [...methods, ...(s.paymentAdjustments ?? [])]), refunds: [], returns: [...methods, ...(s.paymentAdjustments ?? [])], expenses: [], closed: s.archives, open: openTables(s) };
  }
  /**
   * A payment's whole bill for an item refund, wherever it is now: its orders (live copies win), every payment of the bill
   * with method corrections applied, and every correction of those payments. Undefined when the payment is unknown.
   */
  refundAccount(tenant: string, s: State, paymentId: string): { orders: Order[]; payments: Payment[]; adjustments: PaymentAdjustment[]; tableName?: string } | undefined {
    const live = livePayments(s).filter(p => p.id === paymentId).at(-1);
    let orders: Order[], payments: Payment[], tableName: string | undefined;
    if (live) {
      const byId = new Map<string, Order>(); for (const o of [...s.archives.flatMap(a => a.orders), ...s.orders]) if (o.accountId === live.accountId) byId.set(o.id, o);
      const paid = new Map<string, Payment>(); for (const p of livePayments(s)) if (p.accountId === live.accountId) paid.set(p.id, p);
      orders = [...byId.values()]; payments = [...paid.values()];
      const account = s.accounts.find(a => a.id === live.accountId);
      tableName = s.archives.find(a => a.accountId === live.accountId)?.tableName ?? [...s.tables, ...(s.retiredTables ?? [])].find(t => t.id === account?.tableId)?.name;
    } else {
      const stored = this.storedAccount(tenant, paymentId)?.account;
      if (!stored) return undefined;
      orders = stored.orders; payments = stored.payments; tableName = stored.tableName;
    }
    const ids = new Set(payments.map(p => p.id)), seen = new Set<string>(), adjustments: PaymentAdjustment[] = [];
    for (const a of [...payments.flatMap(p => this.ledger<PaymentAdjustment>(tenant, 'adjustment', 'ref', this.token('payment', tenant, p.id))), ...(s.paymentAdjustments ?? []).filter(a => ids.has(a.paymentId))]) if (!seen.has(a.id)) { seen.add(a.id); adjustments.push(a); }
    return { orders, payments: applyMethodChanges(payments, adjustments), adjustments, ...(tableName ? { tableName } : {}) };
  }
  /** Stored rows only, restricted to [start, end) inside one or more days. */
  private fromTable(tenant: string, start: number, end: number) {
    const rows = this.archives(tenant, start, end), d = this.days(start, end);
    const corrections = this.ledger<PaymentAdjustment>(tenant, 'adjustment', 'ref_day', d.from, d.to);
    return summarize({ orders: rows.flatMap(r => r.orders), payments: applyMethodChanges(rows.flatMap(r => r.payments), corrections), refunds: this.ledger<PaymentAdjustment>(tenant, 'adjustment', 'day', d.from, d.to), returns: corrections, expenses: this.ledger<Expense>(tenant, 'expense', 'day', d.from, d.to), closed: rows }, start, end);
  }
  /** One stored business day, rebuilt lazily after any archive or ledger write for that day. */
  private stored(tenant: string, day: string) { return Totals.from(this.storedSummary(tenant, day)); }
  /**
   * A cached row of a stored day (summary, payment list): a closed year's package first (sealed with the year), then the live
   * file (where a closed day is cached again only if its package's copy has an older format).
   */
  private cachedDay(table: 'history_days' | 'history_payment_days', tenant: string, day: string) {
    const out: Payload[] = [];
    for (const db of this.packages?.shards(table, day, day, tenant) ?? []) { const row = db.prepare(`SELECT payload FROM ${table} WHERE tenant=? AND day=?`).get(tenant, day) as Payload | undefined; if (row) out.push(row); }
    const live = this.db.prepare(`SELECT payload FROM ${table} WHERE tenant=? AND day=?`).get(tenant, day) as Payload | undefined;
    if (live) out.push(live);
    return out;
  }
  private storedSummary(tenant: string, day: string): DaySummary {
    const scope = `summary:${tenant}:${day}`;
    for (const cached of this.cachedDay('history_days', tenant, day)) { const v = this.read<{ v: number; s: DaySummary }>(tenant, cached, scope); if (v.v === SUMMARY_VERSION) return v.s; }
    const start = dayStart(day), summary = (this.fromTable(tenant, start, start + DAY_MS).get(day) ?? new Totals()).toJSON();
    this.db.prepare('INSERT OR REPLACE INTO history_days (tenant,day,payload) VALUES (?,?,?)').run(tenant, day, this.seal({ v: SUMMARY_VERSION, s: summary }, this.tenantKey(tenant), scope));
    return summary;
  }
  /** Count and sum of one stored day's payments, kept in memory: an unfiltered all-time statement header reads no row twice. */
  private paymentSums(tenant: string, day: string) {
    let days = this.sums.get(tenant); if (!days) this.sums.set(tenant, days = new Map());
    let v = days.get(day);
    if (!v) { const s = this.storedSummary(tenant, day); days.set(day, v = { count: s.payments, amount: s.cash + s.card + (s.platform ?? 0) }); }
    return v;
  }
  /** First and last stored day per business, kept until history changes (every write that can move them invalidates). */
  private boundsCache = new Map<string, { generation: number; value: Bounds }>();
  private bounds(tenant: string): Bounds {
    const generation = this.generations.get(tenant) ?? 0, kept = this.boundsCache.get(tenant);
    if (kept && kept.generation === generation) return kept.value;
    const value = this.readBounds(tenant);
    this.boundsCache.set(tenant, { generation, value });
    return value;
  }
  private readBounds(tenant: string) {
    // MIN(first_at) alone would read every archive row; the earliest start closes within `span` of the earliest closing,
    // so only that slice of the closing-time index is visited. Closed years' packages count like the live file.
    const archives = this.sources('history_archives', m => maskDays(m, 'day'), undefined, undefined, tenant), ledgers = this.sources('history_ledger', m => maskDays(m, 'day'), undefined, undefined, tenant);
    const min = <T>(v: (T | null)[]) => v.filter((x): x is T => x !== null).sort()[0] ?? null, max = <T>(v: (T | null)[]) => v.filter((x): x is T => x !== null).sort().at(-1) ?? null;
    const each = archives.map(src => src.db.prepare(`SELECT MIN(closed_at) AS lo, MAX(closed_at) AS hi FROM history_archives WHERE tenant=? AND ${src.where}`).get(tenant) as { lo: number | null; hi: number | null });
    const c = { lo: each.map(x => x.lo).filter((x): x is number => x !== null).reduce<number | null>((m, x) => m === null || x < m ? x : m, null), hi: each.map(x => x.hi).filter((x): x is number => x !== null).reduce<number | null>((m, x) => m === null || x > m ? x : m, null) };
    const starts = c.lo === null ? [] : archives.map(src => (src.db.prepare(`SELECT MIN(first_at) AS lo FROM history_archives WHERE tenant=? AND closed_at<=? AND ${src.where}`).get(tenant, c.lo! + this.span(tenant)) as { lo: number | null }).lo).filter((x): x is number => x !== null);
    const a = { hi: c.hi, lo: starts.length ? Math.min(...starts) : null };
    const days = ledgers.map(src => src.db.prepare(`SELECT MIN(day) AS lo, MAX(day) AS hi FROM history_ledger WHERE tenant=? AND ${src.where}`).get(tenant) as { lo: string | null; hi: string | null });
    const l = { lo: min(days.map(x => x.lo)), hi: max(days.map(x => x.hi)) };
    // An older ledger row's day may be the calendar day after its business day (SUMMARY_VERSION 5): start one day earlier.
    const lows = [a.lo === null ? null : businessDay(a.lo), l.lo === null ? null : previousDay(l.lo)].filter((v): v is string => !!v), highs = [a.hi === null ? null : businessDay(a.hi), l.hi].filter((v): v is string => !!v);
    return lows.length ? { first: lows.sort()[0], last: highs.sort().at(-1)! } : null;
  }
  /** Per business day totals for [start, end): stored summaries for whole days, exact sums for partial days, plus the floor. */
  reportDays(tenant: string, s: State, start: number, end: number) { return drain(this.reportDaysSteps(tenant, s, start, end)); }
  /** reportDays one day per step (drainSlowly: Kârlılık of "Tümü" reads every day of five years without holding the tablets). */
  *reportDaysSteps(tenant: string, s: State, start: number, end: number): Generator<void, Map<string, Totals>> {
    const days = new Map<string, Totals>();
    let lo = start, hi = end;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      const b = this.bounds(tenant);
      if (!Number.isFinite(lo)) lo = b ? dayStart(b.first) : 0;
      if (!Number.isFinite(hi)) hi = b ? dayStart(b.last) + DAY_MS : 0;
    }
    for (let at = dayStart(businessDay(lo)); at < hi; at += DAY_MS) {
      const day = businessDay(at), from = Math.max(lo, at), to = Math.min(hi, at + DAY_MS);
      days.set(day, from === at && to === at + DAY_MS ? this.stored(tenant, day) : this.fromTable(tenant, from, to).get(day) ?? new Totals());
      yield;
    }
    for (const [day, t] of summarize(this.live(tenant, s), start, end)) days.set(day, (days.get(day) ?? new Totals()).add(t));
    return days;
  }
  spanTotals(tenant: string, s: State): SpanTotals { return (start, end) => mergeTotals(this.reportDays(tenant, s, start, end).values()); }

  // ---- Monthly and yearly roll-ups (see ROLLUP_VERSION) ----
  private rollupVersion(mark = '') { return `${ROLLUP_VERSION}.${SUMMARY_VERSION}${mark ? `:${mark}` : ''}`; }
  private rollupRow(period: string) { return period.length === 4 ? { table: 'history_years', column: 'year', scope: 'year' } : { table: 'history_months', column: 'month', scope: 'month' }; }
  /** Where a roll-up of `period` may be: its closed year's package (sealed with the year) first, then the live file. */
  private rollupSources(tenant: string, period: string) {
    const r = this.rollupRow(period), day = period.length === 4 ? `${period}-01-01` : `${period}-01`;
    return [...(this.packages?.shards(r.table, day, day, tenant) ?? []), this.db];
  }
  /** Whether a usable roll-up of a closed month ('2025-03') or year ('2025') is stored; nothing is opened. */
  hasRollup(tenant: string, kind: RollupKind, period: string, mark?: string) {
    const r = this.rollupRow(period), version = this.rollupVersion(mark);
    return this.rollupSources(tenant, period).some(db => !!db.prepare(`SELECT 1 FROM ${r.table} WHERE tenant=? AND kind=? AND ${r.column}=? AND version=?`).get(tenant, kind, period, version));
  }
  rollup<T>(tenant: string, kind: RollupKind, period: string, mark?: string): T | undefined {
    const r = this.rollupRow(period), version = this.rollupVersion(mark);
    for (const db of this.rollupSources(tenant, period)) {
      const row = db.prepare(`SELECT payload FROM ${r.table} WHERE tenant=? AND kind=? AND ${r.column}=? AND version=?`).get(tenant, kind, period, version) as Payload | undefined;
      if (!row) continue;
      const v = this.read<{ v: string; value: T }>(tenant, row, `${r.scope}:${tenant}:${kind}:${period}`);
      if (v.v === version) return v.value;
    }
    return undefined;
  }
  putRollup(tenant: string, kind: RollupKind, period: string, value: unknown, mark?: string) {
    const r = this.rollupRow(period), version = this.rollupVersion(mark);
    this.db.prepare(`INSERT OR REPLACE INTO ${r.table} (tenant,kind,${r.column},version,payload) VALUES (?,?,?,?,?)`).run(tenant, kind, period, version, this.seal({ v: version, value }, this.tenantKey(tenant), `${r.scope}:${tenant}:${kind}:${period}`));
  }
  /** Business days [from, to] changed: the roll-ups of their months and years go (rebuilt by the next report that needs them). */
  dropRollups(tenant: string, kinds: RollupKind[], from: string, to: string) {
    const list = kinds.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM history_months WHERE tenant=? AND kind IN (${list}) AND month BETWEEN ? AND ?`).run(tenant, ...kinds, from.slice(0, 7), to.slice(0, 7));
    this.db.prepare(`DELETE FROM history_years WHERE tenant=? AND kind IN (${list}) AND year BETWEEN ? AND ?`).run(tenant, ...kinds, from.slice(0, 4), to.slice(0, 4));
  }
  /** The business month running now: it and every later one are read by day, never rolled up. */
  openMonth() { return businessDay(this.clock()).slice(0, 7); }
  /** The first and last business day holding any stored record (null: none yet). */
  dataBounds(tenant: string) { return this.bounds(tenant); }
  /**
   * How a report period is read: closed years and months that lie wholly inside it as roll-ups, the rest day by day (partial
   * days exactly, as reportDays). A month (year) holding records still on the floor is read by day, like reportDays adds them.
   * An all-time period starts at its first year: nothing lies before the first record, so whole months and years are exact.
   */
  private plan(tenant: string, s: State, start: number, end: number) {
    const live = summarize(this.live(tenant, s), start, end), liveDays = [...live.keys()].sort(), b = this.bounds(tenant);
    let lo = start, hi = end;
    if (!Number.isFinite(lo)) lo = b ? dayStart(b.first) : liveDays.length ? dayStart(liveDays[0]) : 0;
    if (!Number.isFinite(hi)) hi = b ? dayStart(b.last) + DAY_MS : 0;
    const open = this.openMonth(), busy = new Set(liveDays.map(d => d.slice(0, 7))), segments: Segment[] = [];
    const from = Number.isFinite(start) ? lo : dayStart(`${businessDay(lo).slice(0, 4)}-01-01`);
    for (let at = dayStart(businessDay(from)); at < hi;) {
      const day = businessDay(at), year = day.slice(0, 4), month = day.slice(0, 7);
      const nextYear = dayStart(`${Number(year) + 1}-01-01`), nextMonth = dayStart(`${monthAfter(month)}-01`);
      if (at >= from && day.endsWith('-01-01') && nextYear <= hi && year < open.slice(0, 4) && ![...busy].some(m => m.startsWith(year))) { segments.push({ kind: 'year', period: year }); at = nextYear; continue; }
      if (at >= from && day.endsWith('-01') && nextMonth <= hi && month < open && !busy.has(month)) { segments.push({ kind: 'month', period: month }); at = nextMonth; continue; }
      if (at + DAY_MS > lo) segments.push({ kind: 'day', day, from: Math.max(lo, at), to: Math.min(hi, at + DAY_MS) });
      at += DAY_MS;
    }
    return { lo, hi, live, liveDays, b, segments, clip: Number.isFinite(start) ? null : businessDay(lo) };
  }
  /**
   * A closed month's or year's sales roll-up, built step by step when missing (`yield` after every day or month read): a
   * year adds up its months, a month its stored days. Months outside the stored records are empty and read nothing.
   */
  private *buildSales(tenant: string, s: State, period: string, b: Bounds): Generator<void, SalesRollup> {
    const total = new Totals(), days: StoredPoint[] = [], empty = dayPoint(new Totals());
    const inside = (month: string) => !!b && month >= b.first.slice(0, 7) && month <= b.last.slice(0, 7);
    // Every day of the period has its point, a month without records too (as reportDays lists every day of a range).
    const blank = (month: string) => { for (let day = `${month}-01`; day.startsWith(month); day = nextDay(day)) days.push(storePoint(day, empty)); };
    if (period.length === 4) {
      for (let m = 1; m <= 12; m++) {
        const month = `${period}-${String(m).padStart(2, '0')}`;
        if (!inside(month)) { blank(month); continue; }
        const r = this.rollup<SalesRollup>(tenant, 'sales', month) ?? (yield* this.buildSales(tenant, s, month, b));
        total.add(r.t); days.push(...r.days); yield;
      }
    } else if (inside(period)) {
      for (let day = `${period}-01`; day.startsWith(period); day = nextDay(day)) { const t = Totals.from(this.storedSummary(tenant, day)); total.add(t); days.push(storePoint(day, dayPoint(t))); yield; }
    } else blank(period);
    // The KDV of lines sold before each line carried its rate stays at the rate frozen for them (vat.ts legacyRateOf).
    freezeRates(total, legacyRateOf(s));
    const value: SalesRollup = { t: total.rollup(), days };
    this.putRollup(tenant, 'sales', period, value);
    return value;
  }
  private salesRollup(tenant: string, s: State, period: string, b: Bounds) { return this.rollup<SalesRollup>(tenant, 'sales', period) ?? drain(this.buildSales(tenant, s, period, b)); }
  /**
   * A report period's totals and day points: closed years and months from their roll-ups, other days from their stored
   * summaries (partial days exactly), the floor added on its days. The same figures as reportDays (every report function
   * takes either), except the count of distinct QR guests, which adds up months ("yaklaşık": Totals.distinct).
   */
  reportSpan(tenant: string, s: State, start: number, end: number): ReportSpan {
    const p = this.plan(tenant, s, start, end), parts: [string, Totals][] = [], points: [string, DayPoint][] = [], seen = new Set<string>();
    for (const seg of p.segments) {
      if (seg.kind === 'day') {
        const t = seg.from === dayStart(seg.day) && seg.to === seg.from + DAY_MS ? this.stored(tenant, seg.day) : this.fromTable(tenant, seg.from, seg.to).get(seg.day) ?? new Totals();
        const live = p.live.get(seg.day); if (live) t.add(live);
        parts.push([seg.day, t]); points.push([seg.day, dayPoint(t)]); seen.add(seg.day);
        continue;
      }
      const r = this.salesRollup(tenant, s, seg.period, p.b);
      parts.push([seg.period, Totals.from(r.t)]);
      for (const v of r.days) if (!p.clip || v[0] >= p.clip) points.push(readPoint(v));
    }
    // Floor days outside the stored range (an all-time report reaches today's open tables).
    for (const day of p.liveDays) if (!seen.has(day)) { const t = p.live.get(day)!; parts.push([day, t]); points.push([day, dayPoint(t)]); }
    parts.sort((a, b) => a[0].localeCompare(b[0])); points.sort((a, b) => a[0].localeCompare(b[0]));
    return { total: mergeTotals(parts.map(([, t]) => t)), days: new Map(points) };
  }
  /**
   * Reads and stores, in steps, what reportSpan of [start, end) will need (roll-ups and day summaries): run it through
   * drainSlowly() before a long report, so building five years after an update never holds the café's tablets for long.
   */
  *prepare(tenant: string, s: State, start: number, end: number): Generator<void, void> {
    const p = this.plan(tenant, s, start, end);
    for (const seg of p.segments) {
      if (this.stopped) return;
      if (seg.kind === 'day') { if (seg.to - seg.from === DAY_MS) this.storedSummary(tenant, seg.day); yield; }
      else if (!this.hasRollup(tenant, 'sales', seg.period)) yield* this.buildSales(tenant, s, seg.period, p.b);
    }
  }
  /** Builds the days [from, to]'s summaries and payment lists, a day per step: a year sealed into its package takes them along. */
  *prepareDays(tenant: string, from: string, to: string): Generator<void, void> {
    for (let day = from; day <= to; day = nextDay(day)) { if (this.stopped) return; this.storedSummary(tenant, day); this.storedPayments(tenant, day); yield; }
  }
  /** "Tümü" as years, oldest first: each calendar year's span (a closed year is one roll-up), the running year up to today. */
  years(tenant: string, s: State) {
    const b = this.bounds(tenant), liveDays = livePayments(s).map(p => businessDay(p.createdAt)).concat(s.orders.map(o => businessDay(o.createdAt))).sort();
    const today = businessDay(this.clock()), first = [b?.first, liveDays[0]].filter((v): v is string => !!v).sort()[0];
    if (!first) return [] as [string, ReportSpan][];
    const out: [string, ReportSpan][] = [];
    for (let y = Number(first.slice(0, 4)); y <= Number(today.slice(0, 4)); y++) {
      const start = dayStart(`${y}-01-01`), end = Math.min(dayStart(`${y + 1}-01-01`), dayStart(today) + DAY_MS);
      out.push([String(y), this.reportSpan(tenant, s, start, end)]);
    }
    return out;
  }
  /** The years a report can be asked for: every year from the first record to this one, newest first. */
  yearList(tenant: string) {
    const b = this.bounds(tenant), now = businessDay(this.clock()).slice(0, 4), first = b ? b.first.slice(0, 4) : now, out: string[] = [];
    for (let y = Number(now); y >= Number(first); y--) out.push(String(y));
    return out;
  }
  /** Stored order quantities of the last 30 business days for the "popular" menu badges; cached until history changes. */
  recentQuantities(tenant: string, now: number) {
    const to = businessDay(now), from = businessDay(now - 30 * DAY_MS), generation = this.generations.get(tenant) ?? 0, cached = this.popular.get(tenant);
    if (cached && cached.generation === generation && cached.from === from && cached.to === to) return cached.quantities;
    const quantities = new Map<string, number>();
    for (let at = dayStart(from); at <= dayStart(to); at += DAY_MS) for (const [id, p] of this.stored(tenant, businessDay(at)).products) quantities.set(id, (quantities.get(id) ?? 0) + p.quantity);
    // Computing may itself store summaries; the generation read above stays valid because storing does not invalidate.
    this.popular.set(tenant, { generation, from, to, quantities });
    return quantities;
  }
  /** A state that also holds the settled accounts and corrections touching [start, end), for record-level screens. */
  view(tenant: string, s: State, start: number, end: number): State {
    const rows = this.archives(tenant, start, end), d = this.days(start, end), live = livePayments(s);
    // Corrections are found by their payment's day: the stored days asked for, and every day a live payment is on.
    const from = live.length ? [d.from, earliestDay(live)].sort()[0] : d.from, to = live.length ? MAX_DAY : d.to;
    const corrections = this.ledger<PaymentAdjustment>(tenant, 'adjustment', 'ref_day', from, to);
    // The counters stand for archived records; with those records included they would count twice.
    const { archivedCampaignUsage: _usage, orderNumberBase: _base, ...rest } = s;
    return { ...rest, accounts: [...s.accounts, ...rows.flatMap(r => r.account ? [r.account] : [])], archives: [...rows, ...s.archives], paymentAdjustments: [...corrections, ...(s.paymentAdjustments ?? [])] };
  }
  /** One stored business day's payments, grouped by settled account, without orders; rebuilt lazily like the day summaries. */
  private storedPayments(tenant: string, day: string): PaymentDayAccount[] {
    const scope = `payment-day:${tenant}:${day}`;
    for (const cached of this.cachedDay('history_payment_days', tenant, day)) { const v = this.read<{ v: number; accounts: PaymentDayAccount[] }>(tenant, cached, scope); if (v.v === PAYMENT_DAY_VERSION) return v.accounts; }
    const start = dayStart(day), end = start + DAY_MS, inside = (p: Payment) => { const t = Date.parse(p.createdAt); return t >= start && t < end; };
    const accounts = this.archives(tenant, start, end).flatMap(r => {
      const payments = r.payments.filter(inside);
      return payments.length ? [{ id: r.id, accountId: r.accountId, tableName: r.tableName, closedAt: r.closedAt, total: r.total, cash: r.cash, card: r.card, payments, ...(r.account ? { tableId: r.account.tableId } : {}) }] : [];
    });
    this.db.prepare('INSERT OR REPLACE INTO history_payment_days (tenant,day,payload) VALUES (?,?,?)').run(tenant, day, this.seal({ v: PAYMENT_DAY_VERSION, accounts }, this.tenantKey(tenant), scope));
    return accounts;
  }
  /**
   * The payment statement as business days, newest first. Each day joins its stored list (no settled account is opened;
   * orders are opened per row by paymentAccount), the floor's payments of that day (live copies win) and the corrections
   * filed under that day. Days are clamped to the days that hold records, so "1 yıl" on a young café walks no empty year.
   */
  private statement(tenant: string, s: State, start: number, end: number) {
    const live = livePayments(s), b = this.bounds(tenant), liveDays = live.map(p => businessDay(p.createdAt)).sort();
    const first = [...(b ? [b.first] : []), ...liveDays.slice(0, 1)].sort()[0], last = [...(b ? [b.last] : []), ...liveDays.slice(-1)].sort().at(-1);
    const lo = first === undefined ? undefined : Number.isFinite(start) && businessDay(start) > first ? businessDay(start) : first;
    const hi = last === undefined ? undefined : Number.isFinite(end) && businessDay(end - 1) < last ? businessDay(end - 1) : last;
    const { archivedCampaignUsage: _usage, orderNumberBase: _base, ...rest } = s;
    const day = (d: string): State => {
      const from = dayStart(d), to = from + DAY_MS, on = (p: Payment) => { const t = Date.parse(p.createdAt); return t >= from && t < to; };
      const rows = this.storedPayments(tenant, d), corrections = this.ledger<PaymentAdjustment>(tenant, 'adjustment', 'ref_day', d, d);
      return { ...rest, accounts: [...s.accounts, ...rows.flatMap(r => r.tableId === undefined ? [] : [{ id: r.accountId, tableId: r.tableId } as Account])],
        archives: [...rows.map(({ tableId: _, ...r }) => ({ ...r, orders: [] })), ...s.archives.map(a => ({ ...a, orders: [], payments: a.payments.filter(on) }))],
        payments: s.payments.filter(on), paymentAdjustments: [...corrections, ...(s.paymentAdjustments ?? [])] };
    };
    // The floor's days come first in every walk and are read in one go, so a table settling meanwhile is never counted twice.
    return { first: lo, last: hi, liveFrom: liveDays[0] ?? MAX_DAY, day, rows: (d: string, spec: Pick<LedgerSpec, 'filter' | 'match'>) => ledgerRows(day(d), Math.max(start, dayStart(d)), Math.min(end, dayStart(d) + DAY_MS), spec) };
  }
  /**
   * One page of the statement: days are read newest first until the page is full (plus one row, to know whether more
   * follow). A rare search over years pauses after `budget` ms at a day boundary and answers what it found with a cursor
   * there; the screen asks again from that cursor. Totals come with the page for ranges up to 31 days, otherwise from
   * ledgerTotals.
   */
  paymentLedger(tenant: string, s: State, query: LedgerQuery, budget = LEDGER_BUDGET_MS): PaymentLedgerPage {
    const spec = ledgerQuery(query), { cursor, limit } = spec, walk = this.statement(tenant, s, spec.start, spec.end);
    const found: LedgerRow[] = [], began = performance.now();
    let paused: string | null = null;
    if (walk.first !== undefined && walk.last !== undefined) {
      const top = cursor ? businessDay(Date.parse(cursor.createdAt) - (cursor.id ? 0 : 1)) : walk.last;
      for (let d = top < walk.last ? top : walk.last; d >= walk.first; d = previousDay(d)) {
        for (const r of walk.rows(d, spec)) if (!cursor || newer(cursor, r)) found.push(r);
        if (found.length > limit) break;
        if (d > walk.first && d <= walk.liveFrom && performance.now() - began > budget) { paused = d; break; }
      }
    }
    const page = found.slice(0, limit), next = found.length > limit ? ledgerCursor(page.at(-1)!) : paused ? `${new Date(dayStart(paused)).toISOString()}|` : null;
    const totals = ledgerShort(spec.start, spec.end) ? drain(this.ledgerTotals(tenant, s, query)) : { total: null, amount: null };
    return { from: query.from, to: query.to, ...totals, rows: page, next };
  }
  /**
   * Count and amount of every matching payment, one day per step so a long range can be counted in slices (drain() runs
   * it at once, drainSlowly() yields to other requests between slices). Without search or filter a stored day is read
   * from its summary; otherwise its payment list is filtered like a page.
   */
  *ledgerTotals(tenant: string, s: State, query: LedgerQuery): Generator<void, { total: number; amount: number }> {
    const spec = ledgerQuery(query), walk = this.statement(tenant, s, spec.start, spec.end);
    // A short range reads the same per-day lists as its page (just cached); a long one prefers the smaller summaries.
    const summaries = spec.plain && !ledgerShort(spec.start, spec.end);
    let total = 0, amount = 0;
    if (walk.first === undefined || walk.last === undefined) return { total, amount };
    for (let d = walk.last; d >= walk.first; d = previousDay(d)) {
      if (this.stopped) return { total, amount }; // closing: nobody waits for this answer any more
      if (summaries && d < walk.liveFrom) { const v = this.paymentSums(tenant, d); total += v.count; amount += v.amount; }
      else for (const r of walk.rows(d, spec)) { total++; amount += r.amount; }
      if (d <= walk.liveFrom) yield;
    }
    return { total, amount };
  }
  /** Row counts per table, for backup checks and diagnostics. */
  counts() {
    // The closed years' packages count too (their rows left the live file but are still the business's history).
    const n = (table: string) => [this.db, ...(this.packages?.shards(table) ?? [])].reduce((sum, db) => sum + Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n), 0);
    return { archives: n('history_archives'), ledger: n('history_ledger'), audit: n('history_audit'), requests: n('history_requests'), days: n('history_days') };
  }
}
/** Every sealed history table: the columns that name a row and the scope it is sealed under (rewrite and backup checks). */
export const SEALED_HISTORY: [table: string, columns: string, scope: (row: Record<string, string>) => string][] = [
  ['history_archives', 'tenant,id,payload', r => `archive:${r.tenant}:${r.id}`], ['history_ledger', 'tenant,kind,id,payload', r => `ledger:${r.tenant}:${r.kind}:${r.id}`],
  ['history_audit', 'tenant,id,payload', r => `audit:${r.tenant}:${r.id}`], ['history_requests', 'tenant,token,payload', r => `request:${r.tenant}:${r.token}`],
  ['history_days', 'tenant,day,payload', r => `summary:${r.tenant}:${r.day}`], ['history_payment_days', 'tenant,day,payload', r => `payment-day:${r.tenant}:${r.day}`],
  ['history_months', 'tenant,kind,month,payload', r => `month:${r.tenant}:${r.kind}:${r.month}`], ['history_years', 'tenant,kind,year,payload', r => `year:${r.tenant}:${r.kind}:${r.year}`]];
/** A page's search stops looking after this long and answers with a cursor; the screen asks for the rest. */
export const LEDGER_BUDGET_MS = 120;
const previousDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
/** The last day of a month: '2028-02' → '2028-02-29'. */
export const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
/**
 * The days [from, to] as closed whole months (read from roll-ups) and the stretches of days around them (read row by row),
 * in date order. `openMonth`: the running month (History.openMonth); it and later months are never whole.
 */
export function monthSegments(from: string, to: string, openMonth: string) {
  const out: ({ month: string } | { from: string; to: string })[] = [];
  for (let day = from; day <= to;) {
    const month = day.slice(0, 7), last = lastDay(month);
    if (day.endsWith('-01') && last <= to && month < openMonth) { out.push({ month }); day = nextDay(last); continue; }
    const end = last < to ? last : to, previous = out.at(-1);
    if (previous && 'from' in previous) previous.to = end; else out.push({ from: day, to: end });
    day = nextDay(end);
  }
  return out;
}
/** '2025-12' → '2026-01'. */
export const monthAfter =(month: string) => { const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
/** Runs a stepwise computation to the end at once. */
export function drain<T>(steps: Generator<void, T>) { for (;;) { const r = steps.next(); if (r.done) return r.value; } }
/**
 * Runs a stepwise computation in slices of about `slice` ms and lets other requests run in between, so counting years of
 * payments never holds the café's tablets for long. `stopped` (the asker left) ends it early with undefined.
 */
export async function drainSlowly<T>(steps: Generator<void, T>, stopped: () => boolean, slice = 15): Promise<T | undefined> {
  for (let until = performance.now() + slice; ;) {
    const r = steps.next(); if (r.done) return r.value;
    if (performance.now() > until) { await new Promise(done => setImmediate(done)); if (stopped()) { steps.return(undefined as never); return undefined; } until = performance.now() + slice; }
  }
}
/**
 * Runs the steps a long report needs first (History.prepare and the cash and staff roll-ups), in slices between other
 * requests. False when the asker left meanwhile: there is nobody to answer.
 */
export async function readyFor(res: { on(event: 'close', listener: () => void): unknown }, steps: Generator<void, void>[]) {
  let left = false; res.on('close', () => { left = true; });
  for (const step of steps) { await drainSlowly(step, () => left); if (left) return false; }
  return true;
}
const livePayments = (s: State): Payment[] => [...s.archives.flatMap(a => a.payments), ...s.payments];
const earliestDay = (payments: Payment[]) => businessDay(payments.reduce((min, p) => p.createdAt < min ? p.createdAt : min, payments[0].createdAt));
