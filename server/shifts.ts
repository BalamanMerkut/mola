import type { Express, Request } from 'express';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import type { Actor, Role, State } from '../packages/domain/types.js';
import { cashDayOf, tipRuleNames, type ShiftPlan, type TipRecord, type TipRule } from '../packages/domain/cash.js';
import { distributeTips, lateMinutes, shiftMinutes, shiftRequired, shiftRolesOf, SHIFT_CODE_LENGTH, SHIFT_CODE_TRIES, SHIFT_LOCK_MS, SHIFT_ROLES, validPlan, type Shift, type ShiftEnd } from '../packages/domain/shifts.js';
import { reportRange } from '../packages/domain/reports.js';
import { addDays, businessDay } from '../packages/domain/business-day.js';
import { lastDay, monthSegments, readyFor } from './history.js';
import { maskDays } from './year-packages.js';
import { assertOpenDay } from '../packages/domain/closed-year.js';
import { saatEki } from '../packages/domain/saat-eki.js';
import { businessDayEnd } from './sessions.js';
import { open, seal } from './sealing.js';
import { snapshotKey, type Store } from './store.js';
import type { CashBook } from './cash-closing.js';

/*
 * Vardiya takibi (server side). Three small tables, each row sealed with the business's own key:
 * - staff_shifts: one row per shift (`shift:<tenant>:<id>`); the cash day, start time and an open flag stay readable;
 * - shift_codes: the counter's current one-time code (`shift-code:<tenant>`), replaced the moment it is used;
 * - staff_activity: per cash day, each employee's first and last action (`activity:<tenant>:<day>`), the "tahmini" hours
 *   when vardiya takibi is off.
 * With vardiya takibi on, an account of a role the owner ticked (Garson · Kasiyer · Mutfak · Müdür; missing = all) may
 * change nothing until its shift has started (the owner is exempt, unticked roles too); reading stays allowed so the
 * screen can show "Vardiyayı başlat".
 */
type Row = { id: string; payload: Uint8Array };
const WRITE_EVERY_MS = 60_000;

export class ShiftBook {
  private activityCache = new Map<string, Record<string, [number, number]>>();
  private written = new Map<string, number>();
  constructor(private store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS staff_shifts (tenant TEXT NOT NULL, id TEXT NOT NULL, day TEXT NOT NULL, start INTEGER NOT NULL, open INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (tenant,id));
      CREATE INDEX IF NOT EXISTS staff_shifts_day ON staff_shifts(tenant,day);
      CREATE INDEX IF NOT EXISTS staff_shifts_open ON staff_shifts(tenant,open);
      CREATE TABLE IF NOT EXISTS shift_codes (tenant TEXT PRIMARY KEY, payload BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS staff_activity (tenant TEXT NOT NULL, day TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (tenant,day))`);
    // A "Tanıtım" reset (History.forget: every day at once) removed this business's activity rows: the cached days go too.
    store.history.watch((tenant, from, to) => {
      if (from > '0000-01-01' || to < '9999-12-31') return;
      for (const map of [this.activityCache, this.written] as Map<string, unknown>[]) for (const key of [...map.keys()]) if (key.startsWith(`${tenant}:`)) map.delete(key);
    });
  }
  private key(tenant: string) {
    const key = snapshotKey(this.store.db, this.store.key, tenant);
    if (!key) throw new Error('İşletme anahtarı eksik.');
    return key;
  }
  // ---- The counter's one-time code ----
  code(tenant: string, now: number) {
    const row = this.store.db.prepare('SELECT payload FROM shift_codes WHERE tenant=?').get(tenant) as { payload: Uint8Array } | undefined;
    return row ? open<{ code: string; at: string }>(Buffer.from(row.payload), this.key(tenant), `shift-code:${tenant}`) : this.rotate(tenant, now);
  }
  /** A fresh code, never the one just used: a photo of an old code is useless. */
  rotate(tenant: string, now: number, previous?: string) {
    let code: string;
    do code = String(randomInt(0, 10 ** SHIFT_CODE_LENGTH)).padStart(SHIFT_CODE_LENGTH, '0'); while (code === previous);
    const value = { code, at: new Date(now).toISOString() };
    this.store.db.prepare('INSERT INTO shift_codes (tenant,payload) VALUES (?,?) ON CONFLICT(tenant) DO UPDATE SET payload=excluded.payload').run(tenant, seal(value, this.key(tenant), `shift-code:${tenant}`));
    return value;
  }
  matches(tenant: string, typed: string, now: number) {
    const current = Buffer.from(this.code(tenant, now).code), given = Buffer.from(typed.padEnd(SHIFT_CODE_LENGTH, ' ').slice(0, SHIFT_CODE_LENGTH));
    return given.length === current.length && timingSafeEqual(given, current) && typed.length === SHIFT_CODE_LENGTH;
  }
  // ---- Shifts ----
  private read(tenant: string, row: Row) { return open<Shift>(Buffer.from(row.payload), this.key(tenant), `shift:${tenant}:${row.id}`); }
  /** The closed years' packages overlapping [from, to] holding `table` (oldest first) and the live table last. */
  private sources(table: string, tenant: string, from?: string, to?: string) { return this.store.packages.sources(table, m => maskDays(m, 'day'), from, to, tenant); }
  private put(tenant: string, s: Shift) {
    const before = (this.store.db.prepare('SELECT day FROM staff_shifts WHERE tenant=? AND id=?').get(tenant, s.id) as { day: string } | undefined)?.day;
    // A shift of a closed year stays as it was, and none is moved into one (packages/domain/closed-year.ts).
    const closed = this.store.packages.closedEnd(), kept = closed ? this.get(tenant, s.id) : undefined;
    for (const day of [s.day, before, kept?.day]) if (day) assertOpenDay(closed, day, 'Kapanmış yılın vardiyası düzeltilemez.');
    this.store.db.prepare('INSERT INTO staff_shifts (tenant,id,day,start,open,payload) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET day=excluded.day,start=excluded.start,open=excluded.open,payload=excluded.payload')
      .run(tenant, s.id, s.day, Date.parse(s.startAt), s.endAt ? 0 : 1, seal(s, this.key(tenant), `shift:${tenant}:${s.id}`));
    // A shift ended late or corrected by the owner (its day may move): Personel roll-ups of both days go.
    this.store.history.dropRollups(tenant, ['staff'], s.day, s.day);
    if (before && before !== s.day) this.store.history.dropRollups(tenant, ['staff'], before, before);
  }
  get(tenant: string, id: string) {
    for (const src of this.sources('staff_shifts', tenant).reverse()) { const row = src.db.prepare('SELECT id,payload FROM staff_shifts WHERE tenant=? AND id=?').get(tenant, id) as Row | undefined; if (row) return this.read(tenant, row); }
    return undefined;
  }
  openShifts(tenant: string) {
    return (this.store.db.prepare('SELECT id,payload FROM staff_shifts WHERE tenant=? AND open=1 ORDER BY start').all(tenant) as Row[]).map(r => this.read(tenant, r));
  }
  openFor(tenant: string, userId: string) { return this.openShifts(tenant).find(s => s.userId === userId); }
  begin(tenant: string, user: { id: string; name: string; role: string }, at: string) {
    const shift: Shift = { id: randomUUID(), userId: user.id, name: user.name, role: user.role, day: cashDayOf(at), startAt: at };
    this.put(tenant, shift); return shift;
  }
  finish(tenant: string, shift: Shift, at: string, kind: ShiftEnd) {
    const ended: Shift = { ...shift, endAt: at < shift.startAt ? shift.startAt : at, endKind: kind };
    this.put(tenant, ended); return ended;
  }
  /** Every open shift ends now (tools and tests). */
  endAll(tenant: string, at: string, kind: ShiftEnd) { const list = this.openShifts(tenant); for (const s of list) this.finish(tenant, s, at, kind); return list.length; }
  /**
   * A day's final cash closing ends the shifts of the cash day it closed ("Kapanışta kendiliğinden bitti"): started on that
   * cash day (or earlier) and before the closing. Yesterday's kasa closed this morning leaves today's shifts running; the
   * closing person's own shift (`except`) ends when they close the result (ownForClosing).
   */
  endForClosing(tenant: string, at: string, scope: { day: string; before: string; except?: string }) {
    let n = 0;
    for (const s of this.openShifts(tenant)) if (s.userId !== scope.except && s.day <= scope.day && s.startAt <= scope.before) { this.finish(tenant, s, at, 'closing'); n++; }
    return n;
  }
  /** The closing person's own open shift, when it belongs to the closed cash day. */
  ownForClosing(tenant: string, userId: string, scope: { day: string; before: string }) {
    const s = this.openFor(tenant, userId);
    return s && s.day <= scope.day && s.startAt <= scope.before ? s : undefined;
  }
  /** Shifts still open from before the last 05:00 end there. Returns how many. */
  sweep(tenant: string, now: number) {
    const cutoff = businessDayEnd(now) - 86400_000; let n = 0;
    for (const s of this.openShifts(tenant)) if (Date.parse(s.startAt) < cutoff) { this.finish(tenant, s, new Date(cutoff).toISOString(), 'cutoff'); n++; }
    return n;
  }
  sweepAll(now: number) {
    for (const { tenant } of this.store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) {
      try { this.sweep(tenant, now); } catch (error) { if (!this.store.db.isOpen) throw error; console.warn(`Vardiyalar kapatılamadı: ${error instanceof Error ? error.message : error}`); }
    }
  }
  range(tenant: string, fromDay: string, toDay: string) {
    const rows = this.sources('staff_shifts', tenant, fromDay, toDay).flatMap(src => src.db.prepare(`SELECT id,start,payload FROM staff_shifts WHERE tenant=? AND day>=? AND day<=? AND ${src.where} ORDER BY start`).all(tenant, fromDay, toDay) as (Row & { start: number })[]);
    return rows.sort((a, b) => a.start - b.start).map(r => this.read(tenant, r));
  }
  correct(tenant: string, shift: Shift, by: string, change: { startAt: string; endAt?: string; note: string }, at: string) {
    const next: Shift = { ...shift, startAt: change.startAt, day: cashDayOf(change.startAt), ...(change.endAt ? { endAt: change.endAt, endKind: shift.endKind && shift.endKind !== 'manual' ? shift.endKind : 'manual' } : {}),
      changes: [...(shift.changes ?? []), { at, by, before: { startAt: shift.startAt, ...(shift.endAt ? { endAt: shift.endAt } : {}) }, note: change.note }] };
    this.put(tenant, next); return next;
  }
  // ---- Activity ("tahmini" hours) ----
  private activityRow(tenant: string, day: string) {
    const key = `${tenant}:${day}`; let users = this.activityCache.get(key);
    if (!users) {
      const row = this.store.db.prepare('SELECT payload FROM staff_activity WHERE tenant=? AND day=?').get(tenant, day) as { payload: Uint8Array } | undefined;
      users = row ? open<Record<string, [number, number]>>(Buffer.from(row.payload), this.key(tenant), `activity:${tenant}:${day}`) : {};
      // Only today's (and yesterday's late) rows are written; older cached days are dropped.
      if (this.activityCache.size > 50) this.activityCache.clear();
      this.activityCache.set(key, users);
    }
    return users;
  }
  /** One action by an employee: the first of the day and then at most one write a minute. */
  touch(tenant: string, userId: string, at: number) {
    const day = cashDayOf(at), users = this.activityRow(tenant, day), seen = users[userId], mark = `${tenant}:${day}:${userId}`;
    if (seen && at <= seen[1]) return;
    users[userId] = seen ? [seen[0], at] : [at, at];
    if (seen && at - (this.written.get(mark) ?? 0) < WRITE_EVERY_MS) return;
    if (this.written.size > 5000) this.written.clear();
    this.written.set(mark, at);
    this.store.db.prepare('INSERT INTO staff_activity (tenant,day,payload) VALUES (?,?,?) ON CONFLICT(tenant,day) DO UPDATE SET payload=excluded.payload').run(tenant, day, seal(users, this.key(tenant), `activity:${tenant}:${day}`));
    this.store.history.dropRollups(tenant, ['staff'], day, day);
  }
  activity(tenant: string, fromDay: string, toDay: string) {
    const rows = this.sources('staff_activity', tenant, fromDay, toDay).flatMap(src => src.db.prepare(`SELECT day,payload FROM staff_activity WHERE tenant=? AND day>=? AND day<=? AND ${src.where} ORDER BY day`).all(tenant, fromDay, toDay) as { day: string; payload: Uint8Array }[]);
    const out = new Map<string, Record<string, [number, number]>>();
    for (const r of rows) out.set(r.day, { ...open<Record<string, [number, number]>>(Buffer.from(r.payload), this.key(tenant), `activity:${tenant}:${r.day}`), ...(this.activityCache.get(`${tenant}:${r.day}`) ?? {}) });
    return out;
  }

  // ---- Monthly roll-ups (server/history.ts ROLLUP_VERSION): Personel ve bahşiş of closed months, never every shift of five years ----
  /** The first and last cash day with a shift, an activity row or a tip (null: none). */
  bounds(tenant: string) {
    const days = (['staff_shifts', 'staff_activity', 'cash_records'] as const).flatMap(table => this.sources(table, tenant).flatMap(src => Object.values(src.db.prepare(`SELECT MIN(day) AS lo, MAX(day) AS hi FROM ${table} WHERE tenant=? AND ${table === 'cash_records' ? "kind='tip' AND " : ''}${src.where}`).get(tenant) as { lo: string | null; hi: string | null })))
      .filter((v): v is string => !!v).sort();
    return days.length ? { first: days[0], last: days.at(-1)! } : null;
  }
  /** Who is left out (owners) and the shift plans (lateness) a roll-up was made with: a change of either rebuilds it. */
  private mark(s: State) {
    const owners = (s.staffUsers ?? []).filter(u => u.role === 'owner').map(u => u.id).sort();
    return createHash('sha256').update(JSON.stringify([owners, s.cashShift?.plans ?? {}])).digest('hex').slice(0, 16);
  }
  /**
   * Personel ve bahşiş of the cash days [from, to], read row by row: per employee (owners left out) minutes from shifts, else
   * first to last action ("tahmini"), shifts, lateness against today's plans, and the tips shared out by each of the three rules.
   */
  private staffFigures(tenant: string, s: State, from: string, to: string, now: number, cash?: CashBook): StaffPart {
    const owners = new Set((s.staffUsers ?? []).filter(u => u.role === 'owner').map(u => u.id)), plans = s.cashShift?.plans ?? {};
    const shifts = this.range(tenant, from, to), activity = this.activity(tenant, from, to);
    const worked = new Map<string, Map<string, { minutes: number; estimated: boolean }>>();
    const day = (d: string) => { let m = worked.get(d); if (!m) worked.set(d, m = new Map()); return m; };
    for (const x of shifts) { if (owners.has(x.userId)) continue; const m = day(x.day), v = m.get(x.userId); m.set(x.userId, { minutes: (v && !v.estimated ? v.minutes : 0) + shiftMinutes(x, now), estimated: false }); }
    for (const [d, users] of activity) for (const [id, [first, last]] of Object.entries(users)) { if (owners.has(id) || worked.get(d)?.has(id)) continue; day(d).set(id, { minutes: Math.round((last - first) / 60_000), estimated: true }); }
    const tips = cash ? cash.days<TipRecord>(tenant, ['tip'], from, to) : [], minutes = new Map([...worked].map(([d, m]) => [d, new Map([...m].map(([id, v]) => [id, v.minutes]))]));
    const shared = TIP_RULES.map(rule => distributeTips(tips, rule, minutes));
    const users = new Map<string, StaffPart['users'][number]>();
    const row = (id: string) => { let r = users.get(id); if (!r) users.set(id, r = [id, '', '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); return r; };
    for (const x of shifts) {
      if (owners.has(x.userId)) continue;
      const r = row(x.userId), late = lateMinutes(x, plans[x.userId]) ?? 0;
      r[1] ||= x.name; r[2] = x.name; r[6]++; if (late > 0) { r[7]++; r[8] += late; }
    }
    for (const m of worked.values()) for (const [id, v] of m) { const r = row(id); r[3] += v.minutes; r[5]++; if (v.estimated) { r[4] += v.minutes; r[9] = 1; } }
    shared.forEach(({ shares }, i) => { for (const [id, v] of shares) { const r = row(id); r[10 + i] = (r[10 + i] as number) + v; } });
    return { users: [...users.values()], unassigned: shared.map(x => x.unassigned), tips: [tips.reduce((n, x) => n + x.amount, 0), tips.filter(x => x.method === 'cash').reduce((n, x) => n + x.amount, 0), tips.filter(x => x.method === 'card').reduce((n, x) => n + x.amount, 0)] };
  }
  private staffMonth(tenant: string, s: State, month: string, now: number, cash?: CashBook) {
    const mark = this.mark(s), kept = this.store.history.rollup<StaffPart>(tenant, 'staff', month, mark);
    if (kept) return kept;
    const part = this.staffFigures(tenant, s, `${month}-01`, lastDay(month), now, cash);
    this.store.history.putRollup(tenant, 'staff', month, part, mark);
    return part;
  }
  /** Builds, one month per step, the roll-ups staffSpan of [from, to] will need (drainSlowly it before a long report). */
  *prepare(tenant: string, s: State, from: string, to: string, now: number, cash?: CashBook): Generator<void, void> {
    const mark = this.mark(s);
    for (const seg of monthSegments(from, to, this.store.history.openMonth())) if ('month' in seg && !this.store.history.hasRollup(tenant, 'staff', seg.month, mark)) { this.staffMonth(tenant, s, seg.month, now, cash); yield; }
  }
  /**
   * Personel ve bahşiş of the cash days [from, to] ('all': every day): closed months from their roll-ups, the days around them
   * row by row; the same figures as reading every shift. `rolled`: whether any month came from a roll-up.
   */
  staffSpan(tenant: string, s: State, from: string, to: string, now: number, cash?: CashBook) {
    const b = this.bounds(tenant), lo = from === 'all' || (b && from < b.first) ? b?.first : from, hi = to === 'all' || (b && to > b.last) ? b?.last : to;
    const segments = !lo || !hi || lo > hi ? [] : monthSegments(lo, hi, this.store.history.openMonth());
    const parts = segments.map(seg => 'month' in seg ? this.staffMonth(tenant, s, seg.month, now, cash) : this.staffFigures(tenant, s, seg.from, seg.to, now, cash));
    const users = new Map<string, { firstName?: string; lastName?: string; minutes: number; estimatedMinutes: number; days: number; shiftCount: number; lateCount: number; lateTotal: number; estimated: boolean; tips: number[] }>();
    for (const p of parts) for (const [id, first, last, minutes, estimatedMinutes, days, shiftCount, lateCount, lateTotal, estimated, ...tips] of p.users) {
      let u = users.get(id);
      if (!u) users.set(id, u = { minutes: 0, estimatedMinutes: 0, days: 0, shiftCount: 0, lateCount: 0, lateTotal: 0, estimated: false, tips: [0, 0, 0] });
      // The name of the first and of the latest shift in the period (the report and the e-mail use one each).
      if (first) { u.firstName ??= first; u.lastName = last; }
      u.minutes += minutes; u.estimatedMinutes += estimatedMinutes; u.days += days; u.shiftCount += shiftCount; u.lateCount += lateCount; u.lateTotal += lateTotal; u.estimated ||= !!estimated;
      tips.forEach((v, i) => { u.tips[i] += v; });
    }
    const add = (pick: (p: StaffPart) => number[], size: number) => parts.reduce((acc, p) => acc.map((v, i) => v + pick(p)[i]), Array<number>(size).fill(0));
    const [total, cashTips, card] = add(p => p.tips, 3), unassigned = add(p => p.unassigned, 3);
    return { users, tips: { total, cash: cashTips, card }, unassigned: (rule: TipRule) => unassigned[TIP_RULES.indexOf(rule)], share: (id: string, rule: TipRule) => users.get(id)?.tips[TIP_RULES.indexOf(rule)] ?? 0, rolled: segments.some(seg => 'month' in seg) };
  }
}
/** Tip rules in the order a staff roll-up keeps each employee's shares. */
const TIP_RULES: TipRule[] = ['equal', 'hours', 'orders'];
/**
 * A month of Personel ve bahşiş as its roll-up keeps it (ShiftBook.staffSpan): per employee [id, name on the first and on the
 * latest shift, minutes, "tahmini" minutes, days worked, shifts, late shifts, late minutes, any day "tahmini" (1), tips
 * shared out equally, by hours, by orders]; tips no one could take per rule; tips [total, cash, card].
 */
type StaffPart = { users: [string, string, string, number, number, number, number, number, number, number, number, number, number][]; unassigned: number[]; tips: number[] };

/** Personel ve bahşiş: one row per employee over a period. */
export type StaffShiftRow = {
  id: string; name: string; role: Role | 'eski'; active: boolean;
  /** The period's newest shifts, at most STAFF_SHIFT_LIST (the screen lists them when the row opens); shiftCount: all of them. */
  shifts: (Shift & { minutes: number; late: number | null })[]; shiftCount: number;
  minutes: number; estimatedMinutes: number; days: number; lateCount: number; lateTotal: number;
  orders: number; items: number; sales: number; perHour: number | null; tips: number;
};

const codeInput = z.object({ code: z.string().regex(/^\d{6}$/, 'Altı haneli kodu yazın.') });
/**
 * Requests a signed-out or off-shift employee may still make. A closing's slip ("Fiş yazdır") and the closing person's own
 * shift end after the gün sonu result are part of a closing already done, never new work.
 */
const FREE = new Set(['/shifts/start', '/shifts/end', '/heartbeat', '/password', '/notifications/read', '/cash/print', '/cash/closing-shift']);

/**
 * Routes: GET /api/staff/shifts/me (everyone), GET /api/staff/shifts/code (owner, cashier: the counter's code and who is on
 * shift), POST /api/staff/shifts/start and /end { code } (waiter, cashier, kitchen), POST /api/staff/shifts/plan and
 * /correct (owner), GET /api/staff/reports/staff-shifts (owner, behind the report lock). Must be registered before the other
 * staff routes: its guard stops writes of an employee whose shift has not started while vardiya takibi is on.
 */
/**
 * `sessions` (app.ts): when this request's sign-in started, and who is signed in now. Vardiya takibi turned on "Bir sonraki
 * girişte" (9 Ekim K-B, `cashShift.shiftTrackingFrom`) asks for the code only of sign-ins made after it.
 */
export type ShiftSessions = { startedAt(req: Request): number | undefined; signedIn(tenant: string): { userId: string; role: string }[] };
export function shiftRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, everyMs = 60_000, enabled: (tenant: string) => boolean = () => true, sessions?: ShiftSessions) {
  const book = new ShiftBook(store);
  /** A sign-in from before "Vardiya takibi" was turned on with "Bir sonraki girişte": not asked until the next sign-in. */
  const earlier = (req: Request, s: State) => { const from = Date.parse(s.cashShift?.shiftTrackingFrom ?? ''), started = sessions?.startedAt(req); return Number.isFinite(from) && started !== undefined && started < from; };
  const fails = new Map<string, { count: number; until: number }>();
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner']); return a; };
  const lockedUntil = (key: string) => { const f = fails.get(key), t = now().getTime(); return f && f.count >= SHIFT_CODE_TRIES && f.until > t ? f.until : null; };

  app.use('/api/staff', (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    let actor: Actor;
    try { actor = actorFor(req); } catch { return next(); }
    try {
      // Mola destek (server/support-session.ts) is no employee: no activity day, no shift.
      if (actor.role === 'support') return next();
      if (req.path !== '/heartbeat') book.touch(actor.tenantId, actor.id, now().getTime());
      // Hizmet paketi: without "Vardiya" in the package nobody waits for a shift code (the plans and history stay).
      if (actor.role === 'owner' || FREE.has(req.path) || !enabled(actor.tenantId) || !shiftRequired(store.read(actor.tenantId).cashShift, actor.role)) return next();
      if (book.openFor(actor.tenantId, actor.id) || earlier(req, store.read(actor.tenantId))) return next();
    } catch { return next(); }
    next(new DomainError('SHIFT_REQUIRED', 'Önce vardiyayı başlatın: kasadaki ekranda görünen 6 haneli kodu yazın.', 403));
  });

  app.get('/api/staff/shifts/me', (req, res) => {
    const a = actorFor(req), s = store.read(a.tenantId), t = now().getTime();
    book.sweep(a.tenantId, t);
    const until = lockedUntil(`${a.tenantId}:${a.id}`), open = book.openFor(a.tenantId, a.id);
    res.setHeader('Cache-Control', 'no-store');
    // `required`: this role must start a shift (vardiya takibi on and the role ticked); `tracking` alone is the business switch.
    const on = enabled(a.tenantId);
    // `later`: on, but this sign-in started before it was turned on "Bir sonraki girişte" (K-B): the code comes at the next sign-in.
    const later = on && shiftRequired(s.cashShift, a.role) && !open && earlier(req, s);
    res.json({ tracking: on && !!s.cashShift?.shiftTracking, required: on && shiftRequired(s.cashShift, a.role) && !later, ...(later ? { later: true } : {}), role: a.role, open: open ?? null, lockedUntil: until ? new Date(until).toISOString() : null, plan: s.cashShift?.plans?.[a.id] ?? null });
  });
  // Shown only at the counter (owner, Müdür and cashier screens); waiters and the kitchen never receive it.
  app.get('/api/staff/shifts/code', (req, res) => {
    const a = actorFor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner', 'manager', 'cashier']);
    const t = now().getTime(); book.sweep(a.tenantId, t);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ code: book.code(a.tenantId, t).code, tracking: !!s.cashShift?.shiftTracking, open: book.openShifts(a.tenantId).map(x => ({ id: x.id, name: x.name, role: x.role, startAt: x.startAt })) });
  });
  function withCode(req: Request, action: 'start' | 'end') {
    const a = actorFor(req), s = store.read(a.tenantId); requireRole(s, a, ['manager', 'cashier', 'waiter', 'kitchen']);
    const { code } = codeInput.parse(req.body), key = `${a.tenantId}:${a.id}`, t = now().getTime();
    const until = lockedUntil(key);
    if (until) throw new DomainError('SHIFT_LOCKED', `Çok fazla yanlış kod denendi. ${saatEki(new Date(until).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }), 'den')} sonra tekrar deneyin.`, 429);
    if (!book.matches(a.tenantId, code, t)) {
      let f = fails.get(key); if (!f || (f.count >= SHIFT_CODE_TRIES && f.until <= t)) fails.set(key, f = { count: 0, until: 0 });
      f.count++; if (f.count >= SHIFT_CODE_TRIES) f.until = t + SHIFT_LOCK_MS;
      if (fails.size > 10000) fails.clear();
      const left = SHIFT_CODE_TRIES - f.count;
      throw new DomainError(left > 0 ? 'INVALID_SHIFT_CODE' : 'SHIFT_LOCKED', left > 0 ? `Kod yanlış. Kasadaki ekranda görünen güncel kodu yazın (${left} deneme kaldı).` : 'Çok fazla yanlış kod denendi. 5 dakika sonra tekrar deneyin.', left > 0 ? 400 : 429);
    }
    fails.delete(key);
    const at = new Date(t).toISOString(), user = s.staffUsers!.find(u => u.id === a.id)!;
    return store.mutate(a.tenantId, state => {
      const current = book.code(a.tenantId, t).code;
      book.rotate(a.tenantId, t, current);
      const running = book.openFor(a.tenantId, a.id);
      if (action === 'start') {
        if (running) return running;
        const shift = book.begin(a.tenantId, { id: a.id, name: user.name, role: user.role }, at);
        state.audit.push({ action: 'shift.started', actor: a.id, target: shift.id, at }); return shift;
      }
      if (!running) throw new DomainError('NO_SHIFT', 'Açık vardiyanız yok.', 409);
      const ended = book.finish(a.tenantId, running, at, 'manual');
      state.audit.push({ action: 'shift.ended', actor: a.id, target: ended.id, at }); return ended;
    });
  }
  app.post('/api/staff/shifts/start', (req, res) => { res.json(withCode(req, 'start')); });
  app.post('/api/staff/shifts/end', (req, res) => { res.json(withCode(req, 'end')); });
  app.post('/api/staff/shifts/plan', (req, res) => {
    const a = owner(req), b = z.object({ userId: z.string().min(1).max(100), plan: z.object({ start: z.string(), end: z.string(), days: z.array(z.number().int()).max(7) }).nullable() }).parse(req.body);
    if (b.plan && !validPlan(b.plan)) throw new DomainError('INVALID_PLAN', 'Başlangıç ve bitiş saatini (SS:DD) yazıp en az bir gün seçin.');
    res.json(store.mutate(a.tenantId, s => {
      const user = s.staffUsers?.find(u => u.id === b.userId);
      if (!user || user.role === 'owner') throw new DomainError('NOT_FOUND', 'Çalışan bulunamadı.', 404);
      const plans = { ...(s.cashShift?.plans ?? {}) };
      if (b.plan) plans[b.userId] = { start: b.plan.start, end: b.plan.end, days: [...b.plan.days].sort() }; else delete plans[b.userId];
      s.cashShift = { ...(s.cashShift ?? {}), plans };
      s.audit.push({ action: 'shift.plan', actor: a.id, target: b.userId, at: now().toISOString() });
      return { plans };
    }));
  });
  // K-B: before turning vardiya takibi on, "Şu an N kişi çalışıyor": signed-in people of the ticked roles without a shift.
  app.get('/api/staff/shifts/working', (req, res) => {
    const a = owner(req), c = store.read(a.tenantId).cashShift, roles: string[] = shiftRolesOf(c), seen = new Set<string>();
    for (const x of sessions?.signedIn(a.tenantId) ?? []) if (roles.includes(x.role) && !book.openFor(a.tenantId, x.userId)) seen.add(x.userId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ count: seen.size });
  });
  app.get('/api/staff/shifts/plans', (req, res) => { const a = owner(req); res.json({ plans: store.read(a.tenantId).cashShift?.plans ?? {} }); });
  // Ayarlar → Vardiya: which roles start a shift (src/ShiftRoleSettings.tsx). Owner only, like every setting.
  app.get('/api/staff/shifts/roles', (req, res) => { const a = owner(req), c = store.read(a.tenantId).cashShift; res.json({ tracking: !!c?.shiftTracking, roles: shiftRolesOf(c) }); });
  app.post('/api/staff/shifts/roles', (req, res) => {
    const a = owner(req), b = z.object({ roles: z.array(z.enum(SHIFT_ROLES)).max(SHIFT_ROLES.length) }).strict().parse(req.body);
    res.json(store.mutate(a.tenantId, s => {
      const roles = SHIFT_ROLES.filter(r => b.roles.includes(r));
      s.cashShift = { ...(s.cashShift ?? {}), shiftRoles: roles };
      s.audit.push({ action: 'shift.roles', actor: a.id, target: roles.join(',') || 'none', at: now().toISOString() });
      return { tracking: !!s.cashShift.shiftTracking, roles };
    }));
  });
  app.post('/api/staff/shifts/correct', (req, res) => {
    const a = owner(req), b = z.object({ id: z.string().min(1).max(100), startAt: z.string().datetime(), endAt: z.string().datetime().nullable().optional(), note: z.string().trim().min(3, 'Düzeltmenin nedenini yazın.').max(300) }).parse(req.body);
    const t = now().getTime(), start = Date.parse(b.startAt), end = b.endAt ? Date.parse(b.endAt) : null;
    if (start > t || (end !== null && (end <= start || end > t || end - start > 24 * 3600_000))) throw new DomainError('INVALID_TIME', 'Başlangıç bitişten önce olmalı; vardiya 24 saati ve şu anı geçemez.');
    res.json(store.mutate(a.tenantId, s => {
      const shift = book.get(a.tenantId, b.id);
      if (!shift) throw new DomainError('NOT_FOUND', 'Vardiya bulunamadı.', 404);
      const by = s.staffUsers?.find(u => u.id === a.id)?.name ?? 'İşletme sahibi';
      const next = book.correct(a.tenantId, shift, by, { startAt: new Date(start).toISOString(), ...(end !== null ? { endAt: new Date(end).toISOString() } : {}), note: b.note }, new Date(t).toISOString());
      s.audit.push({ action: 'shift.corrected', actor: a.id, target: shift.id, at: new Date(t).toISOString() });
      return next;
    }));
  });
  if (everyMs > 0) { const timer = setInterval(() => { try { book.sweepAll(now().getTime()); } catch { clearInterval(timer); } }, everyMs); timer.unref(); }
  return book;
}
/** A person's shift list in Personel ve bahşiş: the newest this many (five years of one waiter are 1 400 rows; docs/HIZ_TESTI_5_YIL.md). */
export const STAFF_SHIFT_LIST = 120;
/** Once a period holds closed months (a year, "Tümü"), the shift lists show its last this many days; the totals cover all of it. */
export const LIST_DAYS = 62;
/** Satış ve Raporlar → Personel ve bahşiş (owner, Müdür). Registered after reportSecurity, so the report lock guards it like every report. */
export function staffShiftReportRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, book: ShiftBook, cashBook?: CashBook) {
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner', 'manager']); return a; };
  app.get('/api/staff/reports/staff-shifts', async (req, res) => {
    const a = owner(req), q = z.object({ from: z.string(), to: z.string() }).parse(req.query), { start, end } = reportRange(q.from, q.to);
    const t = now().getTime(), tenant = a.tenantId;
    book.sweep(tenant, t);
    let s = store.read(tenant);
    const b = q.from === 'all' || q.to === 'all' ? book.bounds(tenant) : null, fromDay = q.from === 'all' ? b?.first ?? businessDay(t) : q.from, toDay = q.to === 'all' ? b?.last ?? businessDay(t) : q.to;
    // Closed months come from roll-ups (built first, in steps): "Tümü" never opens every shift and tip of five years.
    if (!await readyFor(res, [store.history.prepare(tenant, s, start, end), book.prepare(tenant, s, fromDay, toDay, t, cashBook)])) return;
    s = store.read(tenant);
    const totals = store.history.reportSpan(tenant, s, start, end).total, span = book.staffSpan(tenant, s, q.from === 'all' ? 'all' : fromDay, q.to === 'all' ? 'all' : toDay, t, cashBook);
    const plans = s.cashShift?.plans ?? {}, rule = s.cashShift?.tipRule ?? 'equal', owners = new Set((s.staffUsers ?? []).filter(u => u.role === 'owner').map(u => u.id));
    // The shift list of each person: the period's shifts, or its last LIST_DAYS days once whole months came from roll-ups.
    const listFrom = span.rolled && addDays(toDay, -(LIST_DAYS - 1)) > fromDay ? addDays(toDay, -(LIST_DAYS - 1)) : fromDay, shifts = book.range(tenant, listFrom, toDay);
    const ids = new Set([...(s.staffUsers ?? []).filter(u => u.role !== 'owner').map(u => u.id), ...[...totals.staff.keys()].filter(id => id !== 'qr' && !owners.has(id)), ...span.users.keys()]);
    const rows: StaffShiftRow[] = [...ids].map(id => {
      const user = s.staffUsers?.find(u => u.id === id), sales = totals.staff.get(id), v = span.users.get(id);
      const own = shifts.filter(x => x.userId === id).map(x => ({ ...x, minutes: shiftMinutes(x, t), late: lateMinutes(x, plans[id]) })).reverse();
      const minutes = v?.minutes ?? 0;
      return { id, name: user?.name ?? v?.lastName ?? 'Eski çalışan kaydı', role: (user?.role ?? 'eski') as Role | 'eski', active: user?.active ?? false, shifts: own.slice(0, STAFF_SHIFT_LIST), shiftCount: v?.shiftCount ?? 0, minutes, estimatedMinutes: v?.estimatedMinutes ?? 0, days: v?.days ?? 0, lateCount: v?.lateCount ?? 0, lateTotal: v?.lateTotal ?? 0,
        orders: sales?.orders ?? 0, items: sales?.items ?? 0, sales: sales?.amount ?? 0, perHour: minutes >= 30 ? Math.round((sales?.amount ?? 0) / (minutes / 60)) : null, tips: span.share(id, rule) };
    }).sort((x, y) => (y.perHour ?? -1) - (x.perHour ?? -1) || y.sales - x.sales || x.name.localeCompare(y.name, 'tr'));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ from: q.from, to: q.to, tracking: !!s.cashShift?.shiftTracking, shiftRoles: shiftRolesOf(s.cashShift), tipRule: rule, tipRuleName: tipRuleNames[rule], tips: { ...span.tips, unassigned: span.unassigned(rule) }, rows, plans, ...(listFrom > fromDay ? { listFrom } : {}) });
  });
}
