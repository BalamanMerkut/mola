import type { Express, Request } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertInt, DomainError, once, recordPayment, requireRole } from '../packages/domain/engine.js';
import type { Actor, Context, Expense, State } from '../packages/domain/types.js';
import { stateRecords } from '../packages/domain/history.js';
import { refundItemsText, type PaymentAdjustment } from '../packages/domain/payment-adjustments.js';
import { cashierExpenseAlerts, fromDrawer } from '../packages/domain/expense-rules.js';
import { cashierRefundLimits } from '../packages/domain/refund-rules.js';
import { reportRange } from '../packages/domain/reports.js';
import { printMoney, type PrinterConfig, type Ticket } from '../packages/domain/printing.js';
import { blindClosing, closingFor, seesCashResult, cashDayOf, cashDayStart, closerSummaries, correctedDifference, countTotal, DENOMINATIONS, denominationName, differenceLimit, movementNames, movementSign, needsNote, OWNER_MOVEMENTS, TIME_PATTERN, windowFigures,
  type CashClosing, type CashCorrection, type CashMovement, type CashMovementKind, type CashOpening, type CashRecord, type CashShiftSettings, type CashStatus, type CloserSummary, type TipRecord } from '../packages/domain/cash.js';
import { open, seal } from './sealing.js';
import { lastDay, monthSegments, readyFor } from './history.js';
import { dayOfMs, maskDays } from './year-packages.js';
import { assertOpenDay } from '../packages/domain/closed-year.js';
import { snapshotKey, type Store } from './store.js';
import type { Notifications } from './notifications.js';
import { depositFlowsFor } from './reservations.js';
import type { ShiftBook } from './shifts.js';
// Yazar kasa yardımcısı: per-rate amounts of a window, "Girildi" ticks and their routes (server/fiscal.ts).
import { fiscalRoutes, fiscalWindow, refreshFiscal } from './fiscal.js';
import { fiscalSettings, ratesLine, ticksUsed, zCompare, type FiscalZ } from '../packages/domain/fiscal.js';

/*
 * Gün sonu kasa kapanışı (server side). One sealed table, `cash_records`, holds openings, cash movements, closings (final and
 * "vardiya devri"), the owner's correction entries and tips. Each row is sealed with the business's own key under
 * `cash:<tenant>:<id>`; only the kind, the cash day and the time stay readable for range queries. Writes happen inside the
 * snapshot transaction (Store.mutate), so a record and its audit entry are saved together. Closings are never rewritten
 * once closed: the owner adds a correction. The table lives in merchant.sqlite, so every backup carries it.
 */
const money = (kurus: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: kurus % 100 === 0 ? 0 : 2 }).format(kurus / 100);
const signed = (kurus: number) => kurus === 0 ? '0 ₺' : `${kurus > 0 ? '+' : '−'}${money(Math.abs(kurus))}`;
/** "₺410", "−₺557": an amount that may be below zero. */
const signedCash = (kurus: number) => kurus < 0 ? `−${money(-kurus)}` : money(kurus);
/** The owner's "Kasadan nakit" expense or stock purchase that would leave the drawer below zero (the same words as src/ExpenseForm.tsx BelowZeroNote). */
export const belowZeroText = (expected: number, amount: number) => `Kasada şu an ${signedCash(expected)} görünüyor; bu çıkışla ${signedCash(expected - amount)} olur. Para kasadan çıkmadıysa “Kasa dışı nakit”i seçin.`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const dayText = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' });
type Row = { id: string; payload: Uint8Array };
/**
 * Cash days as a closed month's roll-up keeps them (CashBook.cashSpan): tips [total, cash, card, count]; closed final closings
 * [count, short, over, corrected difference] (the period report); closed closings and handovers [count, difference, short
 * amount, over amount, cash sales, card difference] and per person (Kasa kapanışları); opening differences, which are rare.
 */
type CashPart = { tips: number[]; finals: number[]; closed: number[]; people: [string, string, number, number, number, number, number, number, number][]; openings: CashOpening[] };
/** The table's kind column: final closings and handovers apart, so "the last final closing" is one indexed read. */
const column = (r: CashRecord) => r.kind === 'closing' ? (r.mode === 'final' ? 'closing' : 'handover') : r.kind;
const timeOf = (r: CashRecord) => Date.parse(r.kind === 'closing' ? r.to : r.at);
export const tipId = (tenant: string, paymentId: string) => `tip-${createHash('sha256').update(`${tenant}\0${paymentId}`).digest('hex').slice(0, 32)}`;

export class CashBook {
  constructor(private store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS cash_records (tenant TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL, at INTEGER NOT NULL, ref TEXT, payload BLOB NOT NULL, PRIMARY KEY (tenant,id));
      CREATE INDEX IF NOT EXISTS cash_records_at ON cash_records(tenant,kind,at);
      CREATE INDEX IF NOT EXISTS cash_records_day ON cash_records(tenant,kind,day);
      CREATE INDEX IF NOT EXISTS cash_records_ref ON cash_records(tenant,ref)`);
  }
  private key(tenant: string) {
    const key = snapshotKey(this.store.db, this.store.key, tenant);
    if (!key) throw new Error('İşletme anahtarı eksik.');
    return key;
  }
  private read<T>(tenant: string, row: Row) { return open<T>(Buffer.from(row.payload), this.key(tenant), `cash:${tenant}:${row.id}`); }
  /** The closed years' packages overlapping the cash days [from, to] (oldest first) and the live table last. */
  private sources(tenant: string, from?: string, to?: string) { return this.store.packages.sources('cash_records', m => maskDays(m, 'day'), from, to, tenant); }
  /** One record by id: the live table first, then the closed years. */
  private one(tenant: string, sql: string, ...params: unknown[]) {
    for (const src of this.sources(tenant).reverse()) { const row = src.db.prepare(sql).get(tenant, ...params as string[]) as Row | undefined; if (row) return row; }
    return undefined;
  }
  /** Adds a record; returns false when one with the same id already exists (a repeated tip). */
  insert(tenant: string, r: CashRecord, ref: string | null = null) {
    // A cash day of a closed year takes nothing any more (a correction, a late count; packages/domain/closed-year.ts).
    assertOpenDay(this.store.packages.closedEnd(), r.day, r.kind === 'correction' ? 'Kapanmış yılın kasa kapanışı düzeltilemez.' : undefined);
    const result = this.store.db.prepare('INSERT OR IGNORE INTO cash_records (tenant,id,kind,day,at,ref,payload) VALUES (?,?,?,?,?,?,?)').run(tenant, r.id, column(r), r.day, timeOf(r), ref, seal(r, this.key(tenant), `cash:${tenant}:${r.id}`));
    if (Number(result.changes) > 0) this.changed(tenant, r.day);
    return Number(result.changes) > 0;
  }
  /** Only a counted closing becomes closed; nothing else is ever rewritten. */
  private finishRow(tenant: string, r: CashClosing) {
    assertOpenDay(this.store.packages.closedEnd(), r.day);
    this.store.db.prepare('UPDATE cash_records SET payload=? WHERE tenant=? AND id=?').run(seal(r, this.key(tenant), `cash:${tenant}:${r.id}`), tenant, r.id);
    this.changed(tenant, r.day);
  }
  /** A record of a cash day was added or finished (a late closing, a correction of an old one): its month's roll-ups go. Tips feed Personel too. */
  private changed(tenant: string, day: string) { this.store.history.dropRollups(tenant, ['cash', 'staff'], day, day); }

  // ---- Monthly roll-ups (server/history.ts ROLLUP_VERSION): tips and closings of closed months, never every row of five years ----
  /** The first and last cash day with any record (null: none). */
  bounds(tenant: string) {
    const each = this.sources(tenant).map(src => src.db.prepare(`SELECT MIN(day) AS lo, MAX(day) AS hi FROM cash_records WHERE tenant=? AND ${src.where}`).get(tenant) as { lo: string | null; hi: string | null });
    const lo = each.map(r => r.lo).filter((v): v is string => !!v).sort()[0], hi = each.map(r => r.hi).filter((v): v is string => !!v).sort().at(-1);
    return lo && hi ? { first: lo, last: hi } : null;
  }
  /** Tips, closings (the owner's corrections in) and opening differences of the cash days [from, to], read row by row. */
  private cashFigures(tenant: string, from: string, to: string): CashPart {
    const tips = this.days<TipRecord>(tenant, ['tip'], from, to), closings = this.days<CashClosing>(tenant, ['closing', 'handover'], from, to);
    const corrections = this.corrections(tenant, closings.map(c => c.id));
    const closed = closings.filter(c => c.status === 'closed').map(c => ({ ...c, corrected: correctedDifference(c, corrections.get(c.id) ?? []) }));
    const finals = closed.filter(c => c.mode === 'final');
    // Newest first like the report, so each person keeps the name of their oldest closing (closerSummaries).
    const people = closerSummaries([...closed].reverse()).map(p => [p.by, p.byName, p.count, p.total, p.short, p.over, p.shortCount, p.overCount, p.largestShort] as CashPart['people'][number]);
    return {
      tips: [tips.reduce((n, x) => n + x.amount, 0), tips.filter(x => x.method === 'cash').reduce((n, x) => n + x.amount, 0), tips.filter(x => x.method === 'card').reduce((n, x) => n + x.amount, 0), tips.length],
      finals: [finals.length, finals.filter(c => c.corrected < 0).length, finals.filter(c => c.corrected > 0).length, finals.reduce((n, c) => n + c.corrected, 0)],
      closed: [closed.length, closed.reduce((n, c) => n + c.corrected, 0), closed.filter(c => c.corrected < 0).reduce((n, c) => n - c.corrected, 0), closed.filter(c => c.corrected > 0).reduce((n, c) => n + c.corrected, 0), closed.reduce((n, c) => n + c.figures.cashSales, 0), closed.reduce((n, c) => n + (c.cardDifference ?? 0), 0)],
      people, openings: this.days<CashOpening>(tenant, ['opening'], from, to).filter(o => o.difference !== 0),
    };
  }
  private cashMonth(tenant: string, month: string) {
    const kept = this.store.history.rollup<CashPart>(tenant, 'cash', month);
    if (kept) return kept;
    const part = this.cashFigures(tenant, `${month}-01`, lastDay(month));
    this.store.history.putRollup(tenant, 'cash', month, part);
    return part;
  }
  /** Builds, one month per step, the roll-ups cashSpan of [from, to] will need (drainSlowly it before a long report). */
  *prepare(tenant: string, from: string, to: string): Generator<void, void> {
    for (const seg of monthSegments(from, to, this.store.history.openMonth())) if ('month' in seg && !this.store.history.hasRollup(tenant, 'cash', seg.month)) { this.cashMonth(tenant, seg.month); yield; }
  }
  /**
   * Tips and gün sonu closings of the cash days [from, to] ('all': every day): closed months from their roll-ups, the days
   * around them row by row. The same figures as reading every row.
   */
  cashSpan(tenant: string, from: string, to: string) {
    const b = this.bounds(tenant), lo = from === 'all' || (b && from < b.first) ? b?.first : from, hi = to === 'all' || (b && to > b.last) ? b?.last : to;
    const parts = !lo || !hi || lo > hi ? [] : monthSegments(lo, hi, this.store.history.openMonth()).map(seg => 'month' in seg ? this.cashMonth(tenant, seg.month) : this.cashFigures(tenant, seg.from, seg.to));
    const sum = (pick: (p: CashPart) => number[], size: number) => parts.reduce((acc, p) => acc.map((v, i) => v + pick(p)[i]), Array<number>(size).fill(0));
    // Each person keeps the name of their oldest closing, as one closerSummaries over every row would.
    const people = new Map<string, CloserSummary>();
    for (const p of parts) for (const [by, byName, count, total, short, over, shortCount, overCount, largestShort] of p.people) {
      const r = people.get(by);
      if (!r) { people.set(by, { by, byName, count, total, short, over, shortCount, overCount, largestShort }); continue; }
      r.count += count; r.total += total; r.short += short; r.over += over; r.shortCount += shortCount; r.overCount += overCount; r.largestShort = Math.max(r.largestShort, largestShort);
    }
    const [tipTotal, tipCash, tipCard, tipCount] = sum(p => p.tips, 4), [count, short, over, difference] = sum(p => p.finals, 4), closed = sum(p => p.closed, 6);
    return {
      tips: { total: tipTotal, cash: tipCash, card: tipCard, count: tipCount }, finals: { count, short, over, difference },
      closed: { count: closed[0], difference: closed[1], short: closed[2], over: closed[3], cashSales: closed[4], cardDifference: closed[5] },
      people: [...people.values()].sort((a, b) => b.short - a.short || a.byName.localeCompare(b.byName, 'tr')), openings: parts.flatMap(p => p.openings),
    };
  }
  /** The newest `limit` closings and handovers of the cash days [from, to] and how many there are: the report's list, a page at a time. */
  newestClosings(tenant: string, from: string, to: string, limit: number) {
    // The live table first (newest), then the closed years newest first, until the page is full.
    const rows: Row[] = []; let total = 0;
    for (const src of this.sources(tenant, from, to).reverse()) {
      if (rows.length < limit) rows.push(...src.db.prepare(`SELECT id,payload FROM cash_records WHERE tenant=? AND kind IN ('closing','handover') AND day>=? AND day<=? AND ${src.where} ORDER BY at DESC, rowid DESC LIMIT ?`).all(tenant, from, to, limit - rows.length) as Row[]);
      total += Number((src.db.prepare(`SELECT COUNT(*) AS n FROM cash_records WHERE tenant=? AND kind IN ('closing','handover') AND day>=? AND day<=? AND ${src.where}`).get(tenant, from, to) as { n: number }).n);
    }
    return { closings: rows.map(r => this.read<CashClosing>(tenant, r)), total };
  }
  get<T extends CashRecord>(tenant: string, id: string) {
    const row = this.one(tenant, 'SELECT id,payload FROM cash_records WHERE tenant=? AND id=?', id);
    return row ? this.read<T>(tenant, row) : undefined;
  }
  /** Rows of every place holding [fromDay, toDay], oldest first by time (a closed year's package comes before the live table). */
  private rows(tenant: string, sql: string, params: unknown[], fromDay?: string, toDay?: string) {
    const all = this.sources(tenant, fromDay, toDay).flatMap(src => src.db.prepare(sql.replace('$WHERE', src.where)).all(tenant, ...params as string[]) as (Row & { at: number })[]);
    return all.sort((a, b) => a.at - b.at);
  }
  /** Records of these kinds inside [from, to) by time, oldest first. */
  list<T extends CashRecord>(tenant: string, kinds: string[], from = -8.64e15, to = 8.64e15) {
    return this.rows(tenant, `SELECT id,at,payload FROM cash_records WHERE tenant=? AND kind IN (${kinds.map(() => '?').join(',')}) AND at>=? AND at<? AND $WHERE ORDER BY at, rowid`, [...kinds, from, to], dayOfMs(from), dayOfMs(to)).map(r => this.read<T>(tenant, r));
  }
  /** Records of these kinds whose cash day is inside [fromDay, toDay]. */
  days<T extends CashRecord>(tenant: string, kinds: string[], fromDay: string, toDay: string) {
    return this.rows(tenant, `SELECT id,at,payload FROM cash_records WHERE tenant=? AND kind IN (${kinds.map(() => '?').join(',')}) AND day>=? AND day<=? AND $WHERE ORDER BY at, rowid`, [...kinds, fromDay, toDay], fromDay, toDay).map(r => this.read<T>(tenant, r));
  }
  latest<T extends CashRecord>(tenant: string, kinds: string[]) {
    // The live table first; a café closed since its last closing finds it in the newest closed year.
    for (const src of this.sources(tenant).reverse()) {
      const row = src.db.prepare(`SELECT id,payload FROM cash_records WHERE tenant=? AND kind IN (${kinds.map(() => '?').join(',')}) AND ${src.where} ORDER BY at DESC, rowid DESC LIMIT 1`).get(tenant, ...kinds) as Row | undefined;
      if (row) return this.read<T>(tenant, row);
    }
    return undefined;
  }
  corrections(tenant: string, closingIds: string[]) {
    const out = new Map<string, CashCorrection[]>();
    if (!closingIds.length) return out;
    for (let i = 0; i < closingIds.length; i += 400) {
      const part = closingIds.slice(i, i + 400);
      for (const r of this.rows(tenant, `SELECT id,at,payload FROM cash_records WHERE tenant=? AND kind='correction' AND ref IN (${part.map(() => '?').join(',')}) AND $WHERE ORDER BY at, rowid`, part)) { const c = this.read<CashCorrection>(tenant, r); out.set(c.closingId, [...(out.get(c.closingId) ?? []), c]); }
    }
    return out;
  }
  tips(tenant: string, from = -8.64e15, to = 8.64e15) { return this.list<TipRecord>(tenant, ['tip'], from, to); }

  /** Where the running window stands: start, opening amount, what waits. Reads only the few latest records. */
  position(tenant: string, now: number) {
    const lastAny = this.latest<CashClosing>(tenant, ['closing', 'handover']), lastFinal = lastAny?.mode === 'final' ? lastAny : this.latest<CashClosing>(tenant, ['closing']);
    const lastOpening = this.latest<CashOpening>(tenant, ['opening']);
    const opening = lastOpening && (!lastFinal || Date.parse(lastOpening.at) >= Date.parse(lastFinal.to)) ? lastOpening : undefined;
    const start = lastAny ? Date.parse(lastAny.to) : opening ? Date.parse(opening.at) : null;
    const carried = lastFinal ? lastFinal.left ?? lastFinal.counted : null;
    const handoverRunning = lastAny?.mode === 'handover' && (!opening || Date.parse(opening.at) < Date.parse(lastAny.to));
    const amount = handoverRunning ? lastAny!.counted : opening ? opening.amount : carried ?? 0;
    const draft = lastAny?.status === 'counted' ? lastAny : undefined;
    const today = cashDayOf(now);
    return { lastAny, lastFinal, opening, start, carried, amount, confirmed: !!opening || handoverRunning, handoverRunning, draft, today,
      needsOpening: !opening && !draft && (!lastAny || lastAny.mode === 'final'),
      unclosedPrevious: !draft && opening && cashDayOf(opening.at) < today ? { day: cashDayOf(opening.at) } : null };
  }
  /** Whether anything was sold since `from`: the floor's payments, else a bill settled into history since then (no amount). */
  private soldSince(tenant: string, s: State, from: number) {
    const after = (iso: string) => Date.parse(iso) >= from;
    if (s.payments.some(p => after(p.createdAt)) || s.archives.some(a => a.payments.some(p => after(p.createdAt)))) return true;
    return this.store.packages.sources('history_archives', m => maskDays(m, 'day'), dayOfMs(from), undefined, tenant).some(src => !!src.db.prepare(`SELECT 1 FROM history_archives WHERE tenant=? AND closed_at>=? AND ${src.where} LIMIT 1`).get(tenant, from));
  }
  status(tenant: string, s: State, actor: Actor, now: number): CashStatus {
    const p = this.position(tenant, now), settings = s.cashShift ?? {};
    const finalDay = p.lastFinal?.day;
    const closedToday = p.lastFinal && p.lastFinal.status === 'closed' && p.lastFinal.day === p.today ? { at: p.lastFinal.closedAt ?? p.lastFinal.to, byName: p.lastFinal.byName } : null;
    // Sales on the floor after today's gün sonu (the night went on): the strip asks for one more closing ("Ek kapanış").
    // Measured from the count (the window's end), not from "Kapanışı tamamla": a bill paid in between belongs to the next window.
    const countedAt = closedToday ? p.lastFinal!.to : '';
    const afterClose = !!closedToday && (s.payments.some(x => x.createdAt > countedAt) || s.archives.some(a => a.payments.some(x => x.createdAt > countedAt)) || s.orders.some(o => o.createdAt > countedAt && o.status !== 'cancelled' && o.status !== 'awaiting_approval'));
    const handover = p.handoverRunning && p.lastAny ? { at: p.lastAny.closedAt ?? p.lastAny.to, byName: p.lastAny.byName, amount: p.lastAny.counted } : null;
    return {
      sold: p.start !== null && this.soldSince(tenant, s, p.opening ? Math.min(p.start, Date.parse(p.opening.at)) : p.start),
      afterClose,
      handover,
      today: p.today,
      settings: { closingTime: settings.closingTime ?? null, differenceNote: differenceLimit(settings), shiftTracking: !!settings.shiftTracking, ...(actor.role === 'owner' ? { expenseAlert: settings.expenseAlert ?? null } : {}) },
      start: p.start === null ? null : new Date(p.start).toISOString(),
      opening: { amount: p.amount, confirmed: p.confirmed, ...(p.opening ? { at: p.opening.at, byName: p.opening.byName, ...(p.opening.note ? { note: p.opening.note } : {}) } : {}) },
      carried: p.carried,
      showOpening: p.needsOpening && (!finalDay || finalDay < p.today),
      unclosedPrevious: p.unclosedPrevious,
      closedToday,
      draft: p.draft ? { id: p.draft.id, byName: p.draft.byName, countedAt: p.draft.to, mode: p.draft.mode, mine: p.draft.by === actor.id } : null,
      movements: p.start === null ? [] : this.list<CashMovement>(tenant, ['movement'], p.start, 8.64e15),
    };
  }
  /** Sales, refunds, expenses, movements and tips of [from, to), read from long-term history and the floor. */
  figures(tenant: string, s: State, from: number, to: number, opening: number) {
    const records = stateRecords(this.store.history.view(tenant, s, from, to));
    const refunds = new Map<string, PaymentAdjustment>(); for (const a of [...this.store.history.adjustments(tenant, from, to), ...(s.paymentAdjustments ?? [])]) refunds.set(a.id, a);
    // Who gave each refund back (a cashier's refunds are their own line) and what for: the items, else the reason.
    const people = new Map((s.staffUsers ?? []).map(u => [u.id, u] as const));
    const refundRows = [...refunds.values()].map(a => ({ ...a, role: a.role ?? people.get(a.actor)?.role, byName: a.byName ?? people.get(a.actor)?.name, text: a.items?.length ? refundItemsText(a.items) : a.reason }));
    const expenses = new Map<string, Expense>(); for (const e of [...this.store.history.expenses(tenant, from, to), ...(s.expenses ?? [])]) expenses.set(e.id, e);
    return windowFigures(opening, { payments: records.payments, refunds: refundRows, expenses: expenses.values(), movements: this.list<CashMovement>(tenant, ['movement'], from, to), tips: this.tips(tenant, from, to), deposits: depositFlowsFor(this.store, tenant, s, from, to) }, from, to);
  }

  // ---- Changes (each inside the caller's Store.mutate transaction) ----
  openDay(s: State, actor: Actor, b: { requestId: string; amount: number; note?: string }, ctx: Context) {
    requireRole(s, actor, ['owner', 'manager', 'cashier']);
    return once(s, actor, 'cash-open', b.requestId, b, () => {
      const tenant = s.tenantId, at = ctx.now.toISOString(), p = this.position(tenant, ctx.now.getTime());
      if (p.draft) throw new DomainError('CLOSING_DRAFT', 'Bekleyen bir kasa sayımı var. Önce o kapanışı tamamlayın.', 409);
      if (!p.needsOpening) throw new DomainError(p.unclosedPrevious ? 'CASH_UNCLOSED' : 'CASH_ALREADY_OPEN', p.unclosedPrevious ? 'Önceki günün kasası kapanmadı. Önce “Gün sonu” ile kapatın.' : 'Kasa zaten açık.', 409);
      assertInt(b.amount, 0, 100_000_000);
      const note = b.note?.trim() || undefined, difference = p.carried === null ? 0 : b.amount - p.carried;
      if (actor.role !== 'owner' && difference !== 0 && !note) throw new DomainError('NOTE_REQUIRED', 'Kasadaki tutar devredenden farklı: farkı açıklayan kısa bir not yazın.');
      const user = s.staffUsers?.find(u => u.id === actor.id);
      const r: CashOpening = { id: ctx.id(), kind: 'opening', at, day: cashDayOf(ctx.now.getTime()), carried: p.carried, amount: b.amount, difference, ...(note ? { note } : {}), by: actor.id, byName: user?.name ?? 'Kasiyer', role: actor.role as 'owner' | 'manager' | 'cashier' };
      this.insert(tenant, r);
      s.audit.push({ action: 'cash.opened', actor: actor.id, target: r.id, at });
      return r;
    });
  }
  /** The drawer's expected cash right now (owner only: a count stays blind for the cashier); null before the kasa is open. */
  expectedNow(tenant: string, s: State, now: number) {
    const p = this.position(tenant, now);
    if (p.start === null && !p.opening) return null;
    // Up to and with this very moment: a record written just now (the expense this answer follows) counts.
    return this.figures(tenant, s, Math.min(now, p.start ?? cashDayStart(p.today)), now + 1, p.amount).figures.expected;
  }
  /**
   * The owner's cash out ("Sahip aldı", bank, other, or a cash expense) that would leave less than nothing in the drawer:
   * usually a typing mistake (an extra zero), so it waits for "Yine de kaydet" (`confirm`).
   */
  guardBelowZero(tenant: string, s: State, amount: number, now: number, confirm?: boolean, kind: 'expense' | 'movement' = 'expense') {
    if (confirm) return;
    const expected = this.expectedNow(tenant, s, now);
    if (expected === null || expected - amount >= 0) return;
    // The real figure, also when it is already below zero (it used to say "₺0", hiding how far off the records were).
    // An expense may have been paid from outside the drawer (8 Ekim): the screen offers "Kasa dışından" beside "Kasadan".
    // 8 Ekim (sahip): no extra buttons — the form shows this under "Ödeme yöntemi" and its own save button sends `confirm`.
    throw new DomainError('CASH_BELOW_ZERO', kind === 'expense'
      ? belowZeroText(expected, amount)
      : `Bu çıkıştan sonra kasada beklenen nakit eksiye düşer (şu an beklenen ${signedCash(expected)}). Tutarı kontrol edin; doğruysa “Yine de kaydet”e basın.`, 409);
  }
  movement(s: State, actor: Actor, body: { requestId: string; type: CashMovementKind; amount: number; note?: string; confirm?: boolean }, ctx: Context) {
    requireRole(s, actor, ['owner', 'manager', 'cashier']);
    const { confirm, ...b } = body;
    // Real cash out (or in) only from the owner's account: a cashier records expenses, never "Sahip aldı".
    if (OWNER_MOVEMENTS.includes(b.type)) requireRole(s, actor, ['owner']);
    // `confirm` is not part of the request's fingerprint: "Yine de kaydet" resends the same request.
    if (actor.role === 'owner' && movementSign(b.type) < 0 && Number.isSafeInteger(b.amount)) this.guardBelowZero(s.tenantId, s, b.amount, ctx.now.getTime(), confirm, 'movement');
    return once(s, actor, 'cash-movement', b.requestId, b, () => {
      const tenant = s.tenantId, at = ctx.now.toISOString(), p = this.position(tenant, ctx.now.getTime());
      if (p.start === null && !p.opening) throw new DomainError('CASH_NOT_OPEN', 'Önce kasa açılışını yapın.', 409);
      assertInt(b.amount, 1, 100_000_000);
      const note = b.note?.trim() || undefined;
      if (b.type === 'other_out' && !note) throw new DomainError('NOTE_REQUIRED', '“Diğer çıkış” için kısa bir açıklama yazın.');
      const user = s.staffUsers?.find(u => u.id === actor.id);
      const r: CashMovement = { id: ctx.id(), kind: 'movement', type: b.type, at, day: cashDayOf(ctx.now.getTime()), amount: b.amount, ...(note ? { note } : {}), by: actor.id, byName: user?.name ?? 'Kasiyer', role: actor.role as 'owner' | 'manager' | 'cashier' };
      this.insert(tenant, r);
      s.audit.push({ action: `cash.${b.type}`, actor: actor.id, target: r.id, at });
      return r;
    });
  }
  /** The blind count: saved at once with the figures of the window, before anyone sees the expected amount. */
  count(s: State, actor: Actor, b: { requestId: string; mode: 'final' | 'handover'; counted?: number; denominations?: Record<string, number>; pos?: number | null }, ctx: Context) {
    requireRole(s, actor, ['owner', 'manager', 'cashier']);
    return once(s, actor, 'cash-count', b.requestId, b, () => {
      const tenant = s.tenantId, now = ctx.now.getTime(), p = this.position(tenant, now);
      if (p.draft) throw new DomainError('CLOSING_DRAFT', 'Bekleyen bir kasa sayımı var. Önce o kapanışı tamamlayın.', 409);
      if (b.mode === 'handover' && p.start === null) throw new DomainError('CASH_NOT_OPEN', 'Vardiya devri için önce kasa açılışı yapılmalı.', 409);
      let counted = b.counted;
      if (b.denominations) {
        const total = countTotal(b.denominations);
        if (!Number.isFinite(total)) throw new DomainError('INVALID_COUNT', 'Sayımı kontrol edin.');
        if (counted !== undefined && counted !== total) throw new DomainError('INVALID_COUNT', 'Sayım toplamı tutmuyor.');
        counted = total;
      }
      if (counted === undefined) throw new DomainError('INVALID_COUNT', 'Kasadaki nakdi sayıp yazın.');
      assertInt(counted, 0, 100_000_000);
      if (b.pos !== undefined && b.pos !== null) assertInt(b.pos, 0, 100_000_000);
      // Never opened at all: the window starts this cash day at 05:00 with the carried amount (0 the very first time).
      const from = Math.min(now, p.start ?? cashDayStart(p.today));
      const { figures, expenses, movements, refunds } = this.figures(tenant, s, from, now, p.amount);
      // A second gün sonu of the same cash day: the night kept selling after the first one ("Ek kapanış").
      const day = p.opening ? cashDayOf(p.opening.at) : cashDayOf(now), extra = b.mode === 'final' && p.lastFinal?.status === 'closed' && p.lastFinal.day === day;
      const user = s.staffUsers?.find(u => u.id === actor.id), to = ctx.now.toISOString();
      const denominations = b.denominations ? Object.fromEntries(Object.entries(b.denominations).filter(([, n]) => n > 0)) : undefined;
      // "Yazar kasa karşılaştırması" of the same window (not blind-sensitive: it is shown only after the count).
      const fiscal = fiscalSettings(s.cashShift).enabled ? fiscalWindow(this.store, this, tenant, s, from, now) : undefined;
      const r: CashClosing = {
        id: ctx.id(), kind: 'closing', mode: b.mode, status: 'counted', day, ...(extra ? { extra: true } : {}),
        from: new Date(from).toISOString(), to, counted, ...(denominations && Object.keys(denominations).length ? { denominations } : {}), pos: b.pos ?? null,
        figures, difference: counted - figures.expected, cardDifference: b.pos === undefined || b.pos === null ? null : b.pos - figures.card,
        ...(p.confirmed ? {} : { unconfirmedOpening: true }), movements, expenses, ...(refunds.length ? { refunds } : {}), ...(fiscal ? { fiscal } : {}),
        by: actor.id, byName: user?.name ?? 'Kasiyer', role: actor.role as 'owner' | 'manager' | 'cashier',
      };
      this.insert(tenant, r);
      s.audit.push({ action: b.mode === 'final' ? 'cash.counted' : 'cash.handover_counted', actor: actor.id, target: r.id, at: to });
      return r;
    });
  }
  /**
   * Note and amount left; then the record never changes again. `endShifts` (tools only; the route no longer passes it since
   * 9 Ekim K-C): would end the other shifts of that cash day still open. The closing person's own shift ends when they close
   * the result (POST /cash/closing-shift): their screen must not jump to "Vardiyayı başlat" in the middle of the result.
   */
  finish(s: State, actor: Actor, b: { id: string; note?: string; left?: number; fiscalZ?: { total: number; rates?: { rate: number; amount: number }[] } }, ctx: Context, endShifts?: (at: string, scope: ClosingShiftScope) => number) {
    requireRole(s, actor, ['owner', 'manager', 'cashier']);
    const tenant = s.tenantId, r = this.get<CashClosing>(tenant, b.id);
    if (!r || r.kind !== 'closing') throw new DomainError('NOT_FOUND', 'Kasa sayımı bulunamadı.', 404);
    if (r.status === 'closed') return { closing: r, fresh: false };
    const note = b.note?.trim() || undefined;
    if (note && note.length > 500) throw new DomainError('INVALID_NOTE', 'Not en fazla 500 karakter olabilir.');
    // Only the owner sees the difference, so only the owner is asked to explain a large one; the counter may leave a note.
    if (seesCashResult(actor.role) && needsNote(r.difference, s.cashShift) && !note) throw new DomainError('NOTE_REQUIRED', `Fark ${money(Math.abs(r.difference))}: kapanış için kısa bir açıklama yazın.`);
    const left = r.mode === 'handover' ? r.counted : b.left ?? r.counted;
    assertInt(left, 0, r.counted);
    const user = s.staffUsers?.find(u => u.id === actor.id), at = ctx.now.toISOString();
    // Yazar kasa: ticks made since the count leave the list; the Z raporu typed now (optional) is compared and kept.
    let fiscal = r.fiscal ? refreshFiscal(this, s.tenantId, r.fiscal, r.from, r.to) : undefined;
    // Without "Girildi" ticks nobody ever sees the list of the window's payments (FiscalClosingSection, the slip): only the
    // count stays. It was up to 300 rows in every closing kept for good (60 kB a day in a busy café, docs/HIZ_TESTI_5_YIL.md).
    if (fiscal && !ticksUsed(fiscal) && fiscal.open.length) fiscal = { ...fiscal, open: [], more: fiscal.open.length + (fiscal.more ?? 0) };
    let fiscalZ: FiscalZ | undefined;
    if (fiscal && b.fiscalZ) {
      assertInt(b.fiscalZ.total, 0, 100_000_000);
      for (const x of b.fiscalZ.rates ?? []) { assertInt(x.rate, 0, 100); assertInt(x.amount, 0, 100_000_000); }
      fiscalZ = zCompare(fiscal, b.fiscalZ);
    }
    const closed: CashClosing = { ...r, status: 'closed', closedAt: at, ...(note ? { note } : {}), left, taken: r.counted - left, ...(actor.id !== r.by ? { closedBy: user?.name ?? 'Kasiyer' } : {}), ...(fiscal ? { fiscal } : {}), ...(fiscalZ ? { fiscalZ } : {}) };
    if (r.mode === 'final' && endShifts) { const n = endShifts(at, { day: r.day, before: at, except: actor.id }); if (n) closed.shiftsEnded = n; }
    this.finishRow(tenant, closed);
    s.audit.push({ action: r.mode === 'final' ? 'cash.closed' : 'cash.handover', actor: actor.id, target: r.id, at });
    return { closing: closed, fresh: true };
  }
  correct(s: State, actor: Actor, b: { requestId: string; closingId: string; amount: number; note: string }, ctx: Context) {
    requireRole(s, actor, ['owner']);
    return once(s, actor, 'cash-correction', b.requestId, b, () => {
      const tenant = s.tenantId, target = this.get<CashClosing>(tenant, b.closingId);
      if (!target || target.kind !== 'closing') throw new DomainError('NOT_FOUND', 'Kasa kapanışı bulunamadı.', 404);
      if (!Number.isSafeInteger(b.amount) || Math.abs(b.amount) > 100_000_000) throw new DomainError('INVALID_VALUE', 'Geçerli bir tutar girin.');
      const note = b.note.trim();
      if (note.length < 3 || note.length > 500) throw new DomainError('NOTE_REQUIRED', 'Düzeltmenin nedenini yazın.');
      const at = ctx.now.toISOString(), user = s.staffUsers?.find(u => u.id === actor.id);
      const r: CashCorrection = { id: ctx.id(), kind: 'correction', closingId: target.id, at, day: target.day, amount: b.amount, note, by: actor.id, byName: user?.name ?? 'İşletme sahibi', role: 'owner' };
      this.insert(tenant, r, target.id);
      s.audit.push({ action: 'cash.correction', actor: actor.id, target: target.id, at });
      return r;
    });
  }
  /**
   * A payment with a tip ("Bahşiş"): the tip is not a sale. The payment is recorded as it always was (amount, and the cash
   * handed over without the tip, so the change is right); the tip is its own record, with the staff who took the
   * account's orders, inside the same transaction. A repeated request records neither twice.
   */
  payWithTip(s: State, actor: Actor, body: Parameters<typeof recordPayment>[2] & { tip?: number; tipMethod?: 'cash' | 'card' }, ctx: Context) {
    const { tip, tipMethod, ...payment } = body;
    if (tip === undefined) return recordPayment(s, actor, payment, ctx);
    assertInt(tip, 1, 100_000_000);
    // The tip is paid like the bill unless said otherwise (a card bill with a cash tip, or the other way round).
    const way = tipMethod ?? payment.method, inside = way === payment.method;
    if (inside && (payment.method === 'card' ? payment.tendered !== payment.amount + tip : payment.tendered < payment.amount + tip)) throw new DomainError('INVALID_TENDER', 'Bahşişle birlikte alınan tutarı kontrol edin.');
    const takers = new Map<string, number>();
    for (const o of s.orders) if (o.accountId === payment.accountId && o.source === 'staff' && !o.external && !['cancelled', 'awaiting_approval'].includes(o.status)) takers.set(o.guestId, (takers.get(o.guestId) ?? 0) + o.total);
    const result = recordPayment(s, actor, { ...payment, tendered: inside ? payment.tendered - tip : payment.tendered, tip, ...(tipMethod ? { tipMethod } : {}) } as typeof payment, ctx);
    const user = s.staffUsers?.find(u => u.id === actor.id), at = ctx.now.toISOString();
    const r: TipRecord = { id: tipId(s.tenantId, result.paymentId), kind: 'tip', paymentId: result.paymentId, at, day: cashDayOf(ctx.now.getTime()), amount: tip, method: way, takers: [...takers], ...(user ? { byName: user.name } : {}) };
    if (this.insert(s.tenantId, r)) s.audit.push({ action: 'tip.recorded', actor: actor.id, target: result.paymentId, at });
    return { ...result, tip };
  }
}

/** "Yazar kasa karşılaştırması" on the closing slip: per rate, the total (cash / card), refunds, the Z raporu and its difference. */
function fiscalSlip(c: CashClosing): Ticket {
  const f = c.fiscal, z = c.fiscalZ;
  if (!f) return [];
  const pair = (a: string, b: string) => ({ pair: [a, b] as [string, string] });
  const open = f.open.length + (f.more ?? 0);
  return [{ rule: true }, { text: 'YAZAR KASA (Mola hesabı)', bold: true },
    ...f.rows.map(r => pair(`  %${r.rate} departman`, printMoney(r.amount))),
    { ...pair('Girilmesi gereken', printMoney(f.total)), bold: true },
    ...(f.cash ? [pair('  nakit', printMoney(f.cash))] : []), ...(f.card ? [pair('  kart', printMoney(f.card))] : []),
    ...(f.refunds ? [pair('İade/ters işlem', printMoney(-f.refunds)), ...(f.refundRows?.length && f.refundRows.length > 1 ? [{ text: `  ${ratesLine(f.refundRows)}` }] : [])] : []),
    ...(f.platform ? [pair('Platform (online)', printMoney(f.platform)), { text: '  mali müşavirinize sorun' }] : []),
    ...(z ? [pair('Z raporu (KDV dahil)', printMoney(z.total)), { ...pair('Z farkı', printMoney(z.difference)), bold: true }, ...(z.rateDifferences ?? []).filter(r => r.amount).map(r => pair(`  %${r.rate} farkı`, printMoney(r.amount)))] : []),
    ...((f.askConfirm || f.entered > 0) && open ? [{ text: `'Girildi' işaretsiz: ${open} kayıt` }] : []),
  ];
}
const SLIP_LINES: [keyof CashClosing['figures'], string, number][] = [['opening', 'Açılış (devreden)', 1], ['cashSales', 'Nakit satış', 1], ['cashRefunds', 'Nakit iade', -1], ['cashExpenses', 'Nakit gider', -1], ['ownerIn', 'Kasaya konan', 1], ['ownerOut', 'Kasadan alınan', -1], ['cashTips', 'Nakit bahşiş', 1], ['tipsPaidOut', 'Kart bahşişi (nakit verildi)', -1], ['deposits', 'Kapora (nakit)', 1], ['depositRefunds', 'Kapora iadesi', -1]];
/** The closing slip for the receipt printer (A4 is printed by the screen). */
export function closingTicket(c: CashClosing, corrections: CashCorrection[], business: string): Ticket {
  const f = c.figures, corrected = correctedDifference(c, corrections);
  return [
    { text: business, align: 'center', bold: true, large: true },
    { text: c.mode === 'final' ? (c.extra ? 'GÜN SONU · EK KAPANIŞ' : 'GÜN SONU KASA KAPANIŞI') : 'VARDİYA DEVRİ', align: 'center', bold: true },
    { text: `${dayText(c.day)} · ${clock(c.to)}`, align: 'center' },
    { text: `Sayan: ${c.byName}${c.closedBy ? ` · Tamamlayan: ${c.closedBy}` : ''}`, align: 'center' },
    { rule: true },
    ...SLIP_LINES.filter(([k, , sign]) => k === 'opening' || (f[k] ?? 0) !== 0 || sign > 0 && k === 'cashSales').flatMap(([k, label, sign]) => [{ pair: [label, printMoney(sign * (f[k] ?? 0))] as [string, string] },
      // The cashier's own refunds, inside "Nakit iade" (owner's decision: always its own line).
      ...(k === 'cashRefunds' && f.cashierRefunds ? [{ pair: ['  kasiyer iadesi', printMoney(-f.cashierRefunds)] as [string, string] }] : [])]),
    { pair: ['BEKLENEN NAKİT', printMoney(f.expected)], bold: true },
    ...(f.expected < 0 ? [{ text: '  Eksi: kasadan yazılan giderler kasaya girenden fazla' }] : []),
    ...(f.outsideExpenses ? [{ pair: ['Kasa dışı nakit gider', printMoney(f.outsideExpenses)] as [string, string] }, { text: '  (beklenen nakde girmez)' }] : []),
    { pair: ['SAYILAN NAKİT', printMoney(c.counted)], bold: true },
    { pair: ['FARK', printMoney(c.difference)], bold: true },
    ...(corrections.length ? [{ pair: ['Düzeltilmiş fark', printMoney(corrected)] as [string, string] }] : []),
    ...(c.note ? [{ text: `Not: ${c.note}` }] : []),
    { rule: true },
    { pair: ['Kart (Mola)', printMoney(f.card)] },
    // What the card total is made of when it is more than sales (the screen's "₺900 satış + ₺15 bahşiş + ₺300 kapora").
    ...(f.cardTips || f.cardRefunds || f.cardDeposits ? ([['  satış', f.cardSales], ['  bahşiş', f.cardTips], ['  kapora', f.cardDeposits ?? 0], ['  iade', -f.cardRefunds]] as [string, number][]).filter(([, v]) => v).map(([label, v]) => ({ pair: [label, printMoney(v)] as [string, string] })) : []),
    ...(c.pos !== null ? [{ pair: ['Banka POS toplamı', printMoney(c.pos)] as [string, string] }, { pair: ['Kart farkı', printMoney(c.cardDifference ?? 0)] as [string, string] }] : []),
    ...(f.platform ? [{ pair: ['Platform ödemesi', printMoney(f.platform)] as [string, string] }] : []),
    ...(f.exchanges ? [{ pair: ['Para bozdurma', printMoney(f.exchanges)] as [string, string] }] : []),
    ...fiscalSlip(c),
    ...(c.mode === 'final' && c.left !== undefined ? [{ rule: true } as const, { pair: ['Kasada bırakılan', printMoney(c.left)] as [string, string], bold: true }, ...(c.taken ? [{ pair: ['Kasadan çıkarılan', printMoney(c.taken)] as [string, string] }] : [])] : []),
    ...(c.denominations ? [{ rule: true } as const, ...Object.entries(c.denominations).sort((a, b) => Number(b[0]) - Number(a[0])).map(([v, n]) => ({ pair: [`${denominationName(Number(v))} × ${n}`, printMoney(Number(v) * n)] as [string, string] }))] : []),
  ];
}

/** The counter's slip (cashier, Müdür): what was counted and left, the yazar kasa part; no expected cash, no difference. */
export function blindTicket(c: CashClosing, business: string): Ticket {
  return [
    { text: business, align: 'center', bold: true, large: true },
    { text: c.mode === 'final' ? (c.extra ? 'GÜN SONU · EK KAPANIŞ' : 'GÜN SONU KASA SAYIMI') : 'VARDİYA DEVRİ', align: 'center', bold: true },
    { text: `${dayText(c.day)} · ${clock(c.to)}`, align: 'center' },
    { text: `Sayan: ${c.byName}${c.closedBy ? ` · Tamamlayan: ${c.closedBy}` : ''}`, align: 'center' },
    { rule: true },
    { pair: ['SAYILAN NAKİT', printMoney(c.counted)], bold: true },
    ...(c.pos !== null ? [{ pair: ['Banka POS toplamı', printMoney(c.pos)] as [string, string] }] : []),
    ...(c.note ? [{ text: `Not: ${c.note}` }] : []),
    ...fiscalSlip(c),
    ...(c.mode === 'final' && c.left !== undefined ? [{ rule: true } as const, { pair: ['Kasada bırakılan', printMoney(c.left)] as [string, string], bold: true }, ...(c.taken ? [{ pair: ['Kasadan çıkarılan', printMoney(c.taken)] as [string, string] }] : [])] : []),
    ...(c.denominations ? [{ rule: true } as const, ...Object.entries(c.denominations).sort((a, b) => Number(b[0]) - Number(a[0])).map(([v, n]) => ({ pair: [`${denominationName(Number(v))} × ${n}`, printMoney(Number(v) * n)] as [string, string] }))] : []),
    { rule: true },
    { text: 'Sayım işletme sahibine iletildi.', align: 'center' },
  ];
}

const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const amount = z.number().int().min(0).max(100_000_000);
const note = z.string().max(500).optional();
/** The cashier's refund limits with their defaults filled in (packages/domain/refund-rules.ts). */
const refundLimitsOf = (s: CashShiftSettings) => { const l = cashierRefundLimits(s); return { cashierRefundMax: l.max, cashierRefundDay: l.day }; };
const settingsInput = z.object({ expenseAlert: z.number().int().min(1).max(100_000_000).nullable().optional(), expenseDayAlert: z.number().int().min(1).max(100_000_000).nullable().optional(), cashierRefundMax: z.number().int().min(0).max(100_000_000).optional(), cashierRefundDay: z.number().int().min(0).max(100_000_000).optional(),closingTime: z.string().regex(TIME_PATTERN).nullable().optional(), differenceNote: z.number().int().min(0).max(100_000_000).optional(), shiftTracking: z.boolean().optional(), /** K-B: with shiftTracking on: 'next' = at the next sign-in, 'now' (default) = at once. */ shiftStart: z.enum(['next', 'now']).optional(), tipCashOut: z.boolean().optional(), tipRule: z.enum(['equal', 'hours', 'orders']).optional(),
  fiscalHelper: z.boolean().optional(), fiscalConfirm: z.boolean().optional() });
/** The yazar kasa switches with their defaults (on / off), for every reader of the settings. */
const fiscalOf = (s: CashShiftSettings) => { const f = fiscalSettings(s); return { fiscalHelper: f.enabled, fiscalConfirm: !!s.fiscalConfirm }; };

/** Which shifts a final closing ends: those of its cash day started before it, except the closing person's (see finish). */
export type ClosingShiftScope = { day: string; before: string; except?: string };
export type CashOptions = { book?: CashBook; notifications?: Pick<Notifications, 'add'>; print?: (printer: PrinterConfig, ticket: Ticket) => Promise<void>; shifts?: Pick<ShiftBook, 'endForClosing' | 'ownForClosing' | 'finish'>;
  /** Gün sonu done (a final closing, closed): a verified backup and its Sunucu yedeği follow (server/backup-scheduler.ts afterDayClose). */
  dayClosed?: () => void;
  /** A final closing (gün sonu, an extra one too) was completed: QR siparişleri pause for that business day (server/qr-ordering.ts). */
  closingDone?: (tenant: string, byName: string) => void;
  /** The cash day was opened: the gün sonu pause of QR siparişleri ends. */
  cashOpened?: (tenant: string) => void };
/**
 * Routes: GET /api/staff/cash/status, POST /api/staff/cash/open, /movements, /count, /finish, /print, GET /api/staff/cash/closing/:id
 * (owner and cashier); POST /api/staff/cash/corrections, GET+POST /api/staff/cash/settings (owner; GET also cashier, a part),
 * GET /api/staff/reports/cash-closings (owner, behind the report lock). Also watches POST /api/staff/expenses: a cashier's
 * cash expense above "Kasiyerin nakit gider uyarı sınırı" notifies the owner at once. Register before managementRoutes.
 */
export function cashRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, options: CashOptions = {}) {
  const book = options.book ?? new CashBook(store), ctx = () => ({ now: now(), id: randomUUID });
  const counter = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner', 'manager', 'cashier']); return a; };
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner']); return a; };
  const notify = (tenant: string, key: string, title: string, text: string) => { try { options.notifications?.add(tenant, key, { kind: 'cash', title, text }); } catch (error) { console.warn(`Kasa bildirimi yazılamadı: ${error instanceof Error ? error.message : error}`); } };

  // A cashier's cash expense above the owner's limit: the owner hears about it at once (who, how much, what for, when).
  app.post('/api/staff/expenses', (req, res, next) => {
    let actor: Actor | undefined;
    try { actor = actorFor(req); } catch { return next(); }
    if (actor.role === 'owner') {
      // The owner's cash expense paid today from the drawer: warned like "Sahip aldı" when it would leave less than nothing.
      const b = (req.body ?? {}) as { amount?: unknown; method?: unknown; source?: unknown; day?: unknown; confirm?: unknown };
      const t = now().getTime(), today = cashDayOf(t);
      // "Kasa dışından" never touches the drawer: nothing to ask.
      if (typeof b.amount === 'number' && Number.isSafeInteger(b.amount) && b.amount > 0 && (b.method === undefined || b.method === 'cash') && b.source !== 'outside' && (b.day === undefined || b.day === today)) {
        try { book.guardBelowZero(actor.tenantId, store.read(actor.tenantId), b.amount, t, b.confirm === true); }
        catch (error) { return next(error); }
      }
      return next();
    }
    if (actor.role !== 'cashier' && actor.role !== 'manager') return next();
    const send = res.json.bind(res), tenant = actor.tenantId;
    res.json = (body: unknown) => {
      try {
        // Two checks (packages/domain/expense-rules.ts cashierExpenseAlerts): one expense above "Tek seferde", and the person's cash
        // expenses of this cash day crossing "Gün içinde toplam" (once, again when the total doubles; a repeated key is skipped).
        const e = body as Expense, s = store.read(tenant), settings = s.cashShift ?? {};
        if (res.statusCode === 200 && e && typeof e.amount === 'number' && typeof e.id === 'string' && (settings.expenseAlert || settings.expenseDayAlert)) {
          const day = cashDayOf(e.createdAt), start = cashDayStart(day), dayExpenses = settings.expenseDayAlert ? [...store.history.expenses(tenant, start, start + 86400_000), ...(s.expenses ?? [])].filter(x => cashDayOf(x.spentAt ?? x.createdAt) === day) : [];
          for (const alert of cashierExpenseAlerts({ expense: e, dayExpenses: [...dayExpenses, e], day, single: settings.expenseAlert, dayLimit: settings.expenseDayAlert })) notify(tenant, alert.key, alert.title, alert.text);
        }
        // Counted blind, so the counter is never told; the owner hears at once that the drawer's records went below zero
        // (usually the money came from outside the drawer, or the opening was written too low).
        if (res.statusCode === 200 && e && typeof e.id === 'string' && fromDrawer(e)) {
          const expected = book.expectedNow(tenant, s, now().getTime());
          if (expected !== null && expected < 0) notify(tenant, `expense-below-zero:${e.id}`, `Kasadaki beklenen nakit eksiye düştü: ${signedCash(expected)}`,
            `${e.actorName} kasadan ${money(e.amount)} gider yazdı (“${e.description}”). Kasaya giren nakit bu kadar değil. Para kasa dışından ödendiyse Kasa ve giderler → Giderler'de “Kasa dışı nakit” olarak düzeltin.`);
        }
      } catch { /* the expense itself is saved; a notice is never worth an error */ }
      return send(body);
    };
    next();
  });

  // Stok → Alış kaydet with "Para nereden çıktı? Kasadan" (the owner's; 9 Ekim K-K): asked like any cash expense of the owner
  // when it would take the drawer below zero (the form shows the note under "Ödeme yöntemi"; its own save sends `confirm`). Registered before stockRoutes.
  app.post('/api/staff/stock/purchase', (req, _res, next) => {
    let actor: Actor | undefined;
    try { actor = actorFor(req); } catch { return next(); }
    const b = (req.body ?? {}) as { expense?: unknown; total?: unknown; method?: unknown; source?: unknown; confirm?: unknown };
    if (actor.role !== 'owner' || b.expense !== true || b.method !== 'cash' || b.source === 'outside' || typeof b.total !== 'number' || !Number.isSafeInteger(b.total) || b.total < 1) return next();
    try { book.guardBelowZero(actor.tenantId, store.read(actor.tenantId), b.total, now().getTime(), b.confirm === true); }
    catch (error) { return next(error); }
    next();
  });
  // The owner's expense and stock purchase forms: the drawer's expected cash now, to warn under "Ödeme yöntemi" before saving
  // (the CASH_BELOW_ZERO answer already tells the owner the same figure). null before the kasa is open.
  app.get('/api/staff/cash/expected', (req, res) => {
    const a = owner(req);
    res.setHeader('Cache-Control', 'no-store'); res.json({ expected: book.expectedNow(a.tenantId, store.read(a.tenantId), now().getTime()) });
  });
  app.get('/api/staff/cash/status', (req, res) => {
    const a = counter(req), s = store.read(a.tenantId);
    res.setHeader('Cache-Control', 'no-store'); res.json(book.status(a.tenantId, s, a, now().getTime()));
  });
  app.post('/api/staff/cash/open', (req, res) => {
    const a = counter(req), b = z.object({ requestId, amount, note }).parse(req.body);
    const r = store.mutate(a.tenantId, s => book.openDay(s, a, b, ctx()));
    options.cashOpened?.(a.tenantId);
    if (r.role !== 'owner' && r.difference !== 0) notify(a.tenantId, `cash-opening:${r.id}`, `Açılışta kasa farkı: ${signed(r.difference)}`, `${r.byName} · Devreden ${money(r.carried ?? 0)}, kasada ${money(r.amount)}${r.note ? ` · Not: ${r.note}` : ''}.`);
    res.json(r);
  });
  app.post('/api/staff/cash/movements', (req, res) => {
    const a = counter(req), b = z.object({ requestId, type: z.enum(['exchange', 'owner_in', 'owner_took', 'bank', 'other_out', 'tip_out']), amount, note: z.string().max(300).optional(), confirm: z.boolean().optional() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => book.movement(s, a, b, ctx())));
  });
  app.post('/api/staff/cash/count', (req, res) => {
    const a = counter(req), b = z.object({ requestId, mode: z.enum(['final', 'handover']), counted: amount.optional(), denominations: z.record(z.string().regex(/^\d{1,6}$/), z.number().int().min(0).max(100_000)).optional(), pos: amount.nullable().optional() }).parse(req.body);
    if (b.denominations && Object.keys(b.denominations).some(k => !(DENOMINATIONS as readonly number[]).includes(Number(k)))) throw new DomainError('INVALID_COUNT', 'Sayımı kontrol edin.');
    // Blind for everyone but the owner: the counter gets back what they typed, never the expected cash or the difference.
    res.json(closingFor(store.mutate(a.tenantId, s => book.count(s, a, b, ctx())), a.role));
  });
  app.post('/api/staff/cash/finish', (req, res) => {
    const a = counter(req), b = z.object({ id: z.string().min(1).max(100), note, left: amount.optional(), fiscalZ: z.object({ total: amount, rates: z.array(z.object({ rate: z.number().int().min(0).max(100), amount })).max(6).optional() }).optional() }).parse(req.body);
    // 9 Ekim kullanıcı testi (K-C, sahibin kararı): the gün sonu ends only the closing person's own shift. The kitchen and the
    // waiters may still be finishing orders; they end theirs with "Vardiyayı bitir" or at 05:00 (ShiftBook.sweep). Before,
    // every open shift of the day ended here and a payment after the closing needed a new code.
    const { closing: c, fresh } = store.mutate(a.tenantId, s => book.finish(s, a, b, ctx()));
    // The closing person's own shift of that day waits for "Tamam" on the result (POST /cash/closing-shift).
    const ownShift = c.mode === 'final' && c.status === 'closed' && !!options.shifts?.ownForClosing(a.tenantId, a.id, { day: c.day, before: c.closedAt ?? c.to });
    if (fresh && c.mode === 'final' && c.status === 'closed') try { options.dayClosed?.(); } catch { /* the closing itself is saved */ }
    if (fresh && c.mode === 'final' && c.status === 'closed') options.closingDone?.(a.tenantId, c.byName);
    if (fresh) {
      const limit = differenceLimit(store.read(a.tenantId).cashShift), big = Math.abs(c.difference) > limit;
      // The owner hears about every closing done by someone else, and about any of their own with a large difference.
      if (a.role !== 'owner' || big) notify(a.tenantId, `cash-closing:${c.id}`, `${c.mode === 'final' ? 'Kasa kapatıldı' : 'Vardiya devri'}: ${c.difference === 0 ? 'fark yok' : `fark ${signed(c.difference)}`}`,
        `${c.byName} · Beklenen ${money(c.figures.expected)} · Sayılan ${money(c.counted)}${c.cardDifference ? ` · Kart farkı ${signed(c.cardDifference)}` : ''}${c.note ? ` · Not: ${c.note}` : ''}. Kasa ve giderler → Kapanışlar.`);
    }
    res.json({ closing: closingFor(c, a.role), corrections: [], ...(ownShift ? { ownShift } : {}) });
  });
  // "Tamam" on the gün sonu result: the closing person's own shift of the closed cash day ends now (kind "closing").
  app.post('/api/staff/cash/closing-shift', (req, res) => {
    const a = counter(req), { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.body);
    const c = book.get<CashClosing>(a.tenantId, id), t = now();
    if (!c || c.kind !== 'closing' || c.mode !== 'final' || c.status !== 'closed' || t.getTime() - Date.parse(c.closedAt ?? c.to) > 12 * 3600_000) throw new DomainError('NOT_FOUND', 'Kasa kapanışı bulunamadı.', 404);
    const shifts = options.shifts;
    if (!shifts) { res.json({ ended: false }); return; }
    res.json(store.mutate(a.tenantId, s => {
      const own = shifts.ownForClosing(a.tenantId, a.id, { day: c.day, before: c.closedAt ?? c.to });
      if (!own) return { ended: false };
      const ended = shifts.finish(a.tenantId, own, t.toISOString(), 'closing');
      s.audit.push({ action: 'shift.ended', actor: a.id, target: ended.id, at: t.toISOString() });
      return { ended: true };
    }));
  });
  // The closing itself (after the count): the owner any; a cashier the waiting count and closings of the last 12 hours.
  app.get('/api/staff/cash/closing/:id', (req, res) => {
    const a = counter(req), c = book.get<CashClosing>(a.tenantId, z.string().min(1).max(100).parse(req.params.id));
    const recent = (iso?: string) => !!iso && now().getTime() - Date.parse(iso) <= 12 * 3600_000;
    if (!c || c.kind !== 'closing' || (a.role !== 'owner' && a.role !== 'manager' && c.status === 'closed' && !recent(c.closedAt))) throw new DomainError('NOT_FOUND', 'Kasa kapanışı bulunamadı.', 404);
    res.setHeader('Cache-Control', 'no-store');
    // Not behind the report code: the Müdür and the cashier get the blind copy (the Müdür reads closings in Kasa kapanışları).
    res.json(seesCashResult(a.role) ? { closing: c, corrections: book.corrections(a.tenantId, [c.id]).get(c.id) ?? [] } : { closing: blindClosing(c), corrections: [] });
  });
  const prints = new Map<string, { count: number; until: number }>();
  app.post('/api/staff/cash/print', async (req, res) => {
    const a = counter(req), { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.body);
    const key = `${a.tenantId}:${a.id}`, t = now().getTime(); let m = prints.get(key);
    if (!m || m.until <= t) { if (prints.size > 5000) prints.clear(); prints.set(key, m = { count: 0, until: t + 60000 }); }
    if (++m.count > 10) throw new DomainError('RATE_LIMIT', 'Çok sık yazdırma isteği. Bir dakika sonra tekrar deneyin.', 429);
    const s = store.read(a.tenantId), c = book.get<CashClosing>(a.tenantId, id);
    if (!c || c.kind !== 'closing' || c.status !== 'closed') throw new DomainError('NOT_FOUND', 'Kasa kapanışı bulunamadı.', 404);
    const printer = s.printers?.find(p => p.enabled && p.bill);
    if (!printer || !options.print) throw new DomainError('NO_PRINTER', 'Fiş için yazıcı seçilmemiş. Ayarlar → Cihazlar → Yazıcılar bölümünden ekleyin ya da A4 yazdırın.', 409);
    await options.print(printer, seesCashResult(a.role) ? closingTicket(c, book.corrections(a.tenantId, [c.id]).get(c.id) ?? [], s.name) : blindTicket(c, s.name));
    res.json({ ok: true });
  });
  app.post('/api/staff/cash/corrections', (req, res) => {
    const a = owner(req), b = z.object({ requestId, closingId: z.string().min(1).max(100), amount: z.number().int().min(-100_000_000).max(100_000_000), note: z.string().max(500) }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => book.correct(s, a, b, ctx())));
  });
  app.get('/api/staff/cash/settings', (req, res) => {
    const a = counter(req), settings: CashShiftSettings = store.read(a.tenantId).cashShift ?? {};
    const { plans: _plans, ...rest } = settings;
    res.json(a.role === 'owner' ? { expenseAlert: null, expenseDayAlert: null, closingTime: null, shiftTracking: false, tipRule: 'equal', ...rest, ...refundLimitsOf(settings), differenceNote: differenceLimit(settings), ...fiscalOf(settings) } : { closingTime: settings.closingTime ?? null, differenceNote: differenceLimit(settings), shiftTracking: !!settings.shiftTracking, tipCashOut: !!settings.tipCashOut, ...fiscalOf(settings) });
  });
  app.post('/api/staff/cash/settings', (req, res) => {
    const a = owner(req), b = settingsInput.parse(req.body);
    res.json(store.mutate(a.tenantId, s => {
      requireRole(s, a, ['owner']);
      const next: CashShiftSettings = { ...(s.cashShift ?? {}) }, { shiftStart, ...values } = b, wasOn = !!next.shiftTracking;
      for (const [k, v] of Object.entries(values) as [keyof typeof values, unknown][]) if (v !== undefined) (next as Record<string, unknown>)[k] = v;
      // K-B (9 Ekim, sahibin kararı): turned on in the middle of the day, "Bir sonraki girişte" leaves the people already signed
      // in working; their next sign-in asks for the code (server/shifts.ts). "Hemen" (or no answer: older screens) locks at once.
      if (b.shiftTracking === true && !wasOn) { if (shiftStart === 'next') next.shiftTrackingFrom = now().toISOString(); else delete next.shiftTrackingFrom; }
      if (b.shiftTracking === false) delete next.shiftTrackingFrom;
      s.cashShift = next;
      s.audit.push({ action: 'cash.settings', actor: a.id, target: Object.keys(b).join(','), at: now().toISOString() });
      const { plans: _plans, ...rest } = next;
      return { expenseAlert: null, expenseDayAlert: null, closingTime: null, shiftTracking: false, tipRule: 'equal', ...rest, ...refundLimitsOf(next), differenceNote: differenceLimit(next), ...fiscalOf(next) };
    }));
  });
  fiscalRoutes(app, store, actorFor, book, now);
  return book;
}
/**
 * Satış ve Raporlar → Kasa kapanışları: per cash day, with the owner's corrections and each closer's pattern over time.
 * Registered after reportSecurity, so the report lock (doğrulama kodu) guards it like every report.
 */
/** Kasa kapanışları lists this many closings at first, and this many more with every "Daha eski kapanışlar" (src/CashReports.tsx). */
export const CLOSING_PAGE = 62;
export function cashReportRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, book: CashBook) {
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner', 'manager']); return a; };
  app.get('/api/staff/reports/cash-closings', async (req, res) => {
    const a = owner(req), q = z.object({ from: z.string(), to: z.string(), limit: z.coerce.number().int().min(1).max(5000).default(CLOSING_PAGE) }).parse(req.query);
    reportRange(q.from, q.to);
    const fromDay = q.from === 'all' ? '0000-01-01' : q.from, toDay = q.to === 'all' ? '9999-12-31' : q.to, tenant = a.tenantId;
    // Totals and people from the closed months' roll-ups (built in steps first, so "Tümü" never holds the tablets), the list a
    // page at a time, newest first: five years are 1 800 closings (docs/HIZ_TESTI_5_YIL.md).
    const b = q.from === 'all' || q.to === 'all' ? book.bounds(tenant) : null;
    if (!await readyFor(res, [book.prepare(tenant, q.from === 'all' ? b?.first ?? toDay : fromDay, q.to === 'all' ? b?.last ?? fromDay : toDay)])) return;
    const span = book.cashSpan(tenant, q.from === 'all' ? 'all' : fromDay, q.to === 'all' ? 'all' : toDay), page = book.newestClosings(tenant, fromDay, toDay, q.limit);
    const corrections = book.corrections(tenant, page.closings.map(c => c.id));
    // A closing made before its unused payment list was dropped (CashBook.finish) still carries it: it is never shown, so it
    // is not sent either (five years of a busy café: 111 MB instead of 4 MB; docs/HIZ_TESTI_5_YIL.md).
    const shown = (c: CashClosing): CashClosing => c.fiscal && !ticksUsed(c.fiscal) && c.fiscal.open.length ? { ...c, fiscal: { ...c.fiscal, open: [], more: c.fiscal.open.length + (c.fiscal.more ?? 0) } } : c;
    const rows = page.closings.map(c => { const list = corrections.get(c.id) ?? []; return { ...shown(c), corrections: list, corrected: correctedDifference(c, list) }; });
    res.setHeader('Cache-Control', 'no-store');
    const s = store.read(tenant);
    // K1 (8 Ekim, sahibin kararı): the Müdür gets the closings blind — day, who, counted; never expected cash, a difference,
    // the people's differences or the opening differences (the same copy the cashier gets at the count).
    if (!seesCashResult(a.role)) { res.json({ from: q.from, to: q.to, business: s.name, printing: !!s.printers?.some(p => p.enabled && p.bill), blind: true, closings: page.closings.map(c => blindClosing(shown(c))), closingCount: page.total, openings: [], people: [], totals: { count: span.closed.count }, movementNames }); return; }
    // `openings`: those with a difference (the only ones the screen lists), newest first.
    res.json({ from: q.from, to: q.to, business: s.name, printing: !!s.printers?.some(p => p.enabled && p.bill), closings: rows, closingCount: page.total, openings: [...span.openings].reverse(), people: span.people, totals: span.closed, movementNames });
  });
  return book;
}
