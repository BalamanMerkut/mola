import type { Express, Request } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { closeWithDeposit, DomainError, requireRole } from '../packages/domain/engine.js';
import type { Actor, CafeTable, Role, State, TableView } from '../packages/domain/types.js';
import { isManagement } from '../packages/domain/roles.js';
import { canReserve, canRunEvents, seesGuestContact, withoutContact, depositFlows, eventReport, reservationPeriod, reservationSettings, turkishDay, addDays, type CafeEvent, type EventReport, type FloorRules, type PublicEvent, type Reservation, type ReservationMark } from '../packages/domain/reservations.js';
import { cancelReservation, closeEvent, createEvent, decideDeposit, noShowReservation, renameEventTable, renameGuest, saveReservation, saveReservationSettings, seatReservation, seatWalkIn, startEvent, updateEvent, waitReservation } from '../packages/domain/reservation-rules.js';
import { businessDay, stateRecords } from '../packages/domain/history.js';
import { reportRange } from '../packages/domain/reports.js';
import { open, seal } from './sealing.js';
import { drainSlowly, readyFor } from './history.js';
import { maskDays } from './year-packages.js';
import { snapshotKey, type Store } from './store.js';
import type { Notifications } from './notifications.js';

/*
 * Ajanda ve rezervasyon (server). Live reservations and events sit in the business snapshot (State.reservations, State.events),
 * so seating a guest, settling a bill's kapora and closing an event happen in one transaction with the floor. Three days after
 * a reservation finished (came and the bill closed, did not come, cancelled; no kapora choice left) or an event closed, it
 * moves to `reservation_records`: one row per record, sealed with the business key under `reservation:<business>:<kind>:<id>`
 * (backups open every row, server/backup.ts). Readable columns: kind, id, the day, and when its kapora was taken and decided
 * (the cash closing reads kapora money by time). Phone numbers stay on this computer: never in the floor snapshot or reports.
 */
const DAY = 86400_000, KEEP_LIVE = 3 * DAY;
type Row = { kind: string; id: string; payload: Uint8Array };

function ensureTable(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS reservation_records (tenant TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, day TEXT NOT NULL, taken_at INTEGER, decided_at INTEGER, payload BLOB NOT NULL, PRIMARY KEY (tenant,kind,id));
    CREATE INDEX IF NOT EXISTS reservation_records_day ON reservation_records(tenant,kind,day);
    CREATE INDEX IF NOT EXISTS reservation_records_taken ON reservation_records(tenant,taken_at);
    CREATE INDEX IF NOT EXISTS reservation_records_decided ON reservation_records(tenant,decided_at);
    CREATE TABLE IF NOT EXISTS event_reports (tenant TEXT NOT NULL, id TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (tenant,id))`);
}
/** The shape of a kept event report (event_reports); a change to eventReport's figures raises it and rows are worked out again. */
const EVENT_REPORT_VERSION = 1;
const tenantKey = (store: Store, tenant: string) => { const key = snapshotKey(store.db, store.key, tenant); if (!key) throw new Error('İşletme anahtarı eksik.'); return key; };
const openRow = <T>(store: Store, tenant: string, row: Row) => open<T>(Buffer.from(row.payload), tenantKey(store, tenant), `reservation:${tenant}:${row.kind}:${row.id}`);

/** When a reservation is over for good: its guest left (bill closed), it did not come or was cancelled, and no kapora waits. */
export function finishedAt(r: Reservation) {
  if (r.deposit?.pending) return null;
  const end = r.status === 'seated' ? r.closedAt : r.status === 'no_show' ? r.noShowAt : r.status === 'cancelled' ? r.cancelledAt : undefined;
  return end ? [end, r.deposit?.decision?.at ?? ''].sort().at(-1)! : null;
}

export class ReservationBook {
  constructor(private store: Store) { ensureTable(store.db); }
  /** Inside the caller's Store.mutate: finished records older than three days leave the snapshot. Returns how many moved. */
  archive(s: State, now: number) {
    const tenant = s.tenantId, key = tenantKey(this.store, tenant);
    const insert = this.store.db.prepare('INSERT OR REPLACE INTO reservation_records (tenant,kind,id,day,taken_at,decided_at,payload) VALUES (?,?,?,?,?,?,?)');
    const old = (at: string | null | undefined) => !!at && Date.parse(at) < now - KEEP_LIVE;
    const going = (s.reservations ?? []).filter(r => old(finishedAt(r)));
    const events = (s.events ?? []).filter(e => old(e.closedAt) && !(s.reservations ?? []).some(r => r.eventId === e.id && !going.includes(r)));
    for (const r of going) insert.run(tenant, 'reservation', r.id, r.day, r.deposit ? Date.parse(r.deposit.takenAt) : null, r.deposit?.decision ? Date.parse(r.deposit.decision.at) : null, seal(r, key, `reservation:${tenant}:reservation:${r.id}`));
    for (const e of events) insert.run(tenant, 'event', e.id, e.day, null, null, seal(e, key, `reservation:${tenant}:event:${e.id}`));
    // Its report row is final now: worked out once here, so "Tümü" never reads years of bills (docs/HIZ_TESTI_5_YIL.md).
    const onFloor = new Set(s.orders.flatMap(o => o.reservation?.eventId ? [o.reservation.eventId] : []));
    for (const e of events) if (!onFloor.has(e.id)) this.finalReport(tenant, s, e);
    if (going.length) s.reservations = s.reservations!.filter(r => !going.includes(r));
    if (events.length) s.events = s.events!.filter(e => !events.includes(e));
    return going.length + events.length;
  }
  needsArchive(s: State, now: number) {
    const old = (at: string | null | undefined) => !!at && Date.parse(at) < now - KEEP_LIVE;
    return (s.reservations ?? []).some(r => old(finishedAt(r))) || (s.events ?? []).some(e => old(e.closedAt));
  }
  stored<T>(tenant: string, kind: 'reservation' | 'event', from: string, to: string) {
    // Closed years' records are in their packages (server/year-packages.ts).
    const rows = this.store.packages.sources('reservation_records', m => maskDays(m, 'day'), from, to, tenant)
      .flatMap(src => src.db.prepare(`SELECT kind,id,day,payload FROM reservation_records WHERE tenant=? AND kind=? AND day>=? AND day<=? AND ${src.where} ORDER BY day`).all(tenant, kind, from, to) as (Row & { day: string })[]);
    return rows.sort((a, b) => a.day.localeCompare(b.day)).map(r => openRow<T>(this.store, tenant, r));
  }
  /**
   * One event's figures: its reservations and the orders of the bills that can hold them. Only those bills are opened (five
   * years of events read every bill of three days around each one: 16 s for "Tümü", docs/HIZ_TESTI_5_YIL.md): no event order
   * is older than the event itself, and every bill with one was opened before the event closed (closing it turns waiting
   * reservations into "gelmedi"; its tables take no new bill), so a bill that started after that has none. A bill opened
   * before still counts with all its later orders. `reservations`: a list that may already hold the event's own.
   */
  eventRow(tenant: string, s: State, e: CafeEvent, reservations: Reservation[] = []): EventReport {
    const lo = Math.max(Date.parse(e.startAt) - DAY, Date.parse(e.createdAt) || -Infinity), hi = Math.min(Date.parse(e.endAt ?? e.startAt) + 2 * DAY, e.closedAt ? Date.parse(e.closedAt) + 3600_000 : Infinity);
    const v = this.store.history.view(tenant, s, lo, hi), list = reservations.some(r => r.eventId === e.id) ? reservations : this.reservations(tenant, s, e.day, addDays(e.day, 1));
    return eventReport(e, list, [...stateRecords(v).orders], v.accounts);
  }
  /** A stored (final) event's report row: worked out once and kept sealed (`event-report:<business>:<id>`). */
  finalReport(tenant: string, s: State, e: CafeEvent, reservations?: Reservation[]): EventReport {
    const scope = `event-report:${tenant}:${e.id}`;
    // The live table first, then the closed years' packages (a report row goes into its event's package).
    for (const src of this.store.packages.sources('event_reports', () => '1', undefined, undefined, tenant).reverse()) {
      const row = src.db.prepare('SELECT payload FROM event_reports WHERE tenant=? AND id=?').get(tenant, e.id) as { payload: Uint8Array } | undefined;
      if (row) { const kept = open<{ v: number; report: EventReport }>(Buffer.from(row.payload), tenantKey(this.store, tenant), scope); if (kept.v === EVENT_REPORT_VERSION) return kept.report; }
    }
    const report = this.eventRow(tenant, s, e, reservations);
    this.store.db.prepare('INSERT OR REPLACE INTO event_reports (tenant,id,payload) VALUES (?,?,?)').run(tenant, e.id, seal({ v: EVENT_REPORT_VERSION, report }, tenantKey(this.store, tenant), scope));
    return report;
  }
  /** Live and stored reservations of the days [from, to]. */
  reservations(tenant: string, s: State, from: string, to: string) { const steps = this.reservationsSteps(tenant, s, from, to); for (;;) { const r = steps.next(); if (r.done) return r.value; } }
  /**
   * reservations() a year of stored records per step: "Tümü" (every reservation of five years, opened one by one) runs in
   * slices between the tablets' requests (reservationReportRoutes, drainSlowly).
   */
  *reservationsSteps(tenant: string, s: State, from: string, to: string): Generator<void, Reservation[]> {
    const live = (s.reservations ?? []).filter(r => r.day >= from && r.day <= to), ids = new Set(live.map(r => r.id)), stored: Reservation[] = [];
    const days = this.store.packages.sources('reservation_records', m => maskDays(m, 'day'), from, to, tenant).flatMap(src => Object.values(src.db.prepare(`SELECT MIN(day) AS lo, MAX(day) AS hi FROM reservation_records WHERE tenant=? AND kind='reservation' AND day>=? AND day<=? AND ${src.where}`).get(tenant, from, to) as { lo: string | null; hi: string | null })).filter((v): v is string => !!v).sort();
    if (days.length) for (let y = Number(days[0].slice(0, 4)); y <= Number(days.at(-1)!.slice(0, 4)); y++) {
      const a = `${y}-01-01` < from ? from : `${y}-01-01`, b = `${y}-12-31` > to ? to : `${y}-12-31`;
      stored.push(...this.stored<Reservation>(tenant, 'reservation', a, b).filter(r => !ids.has(r.id)));
      yield;
    }
    return [...live, ...stored].sort((a, b) => a.at.localeCompare(b.at) || a.name.localeCompare(b.name, 'tr'));
  }
  events(tenant: string, s: State, from: string, to: string) {
    const live = (s.events ?? []).filter(e => e.day >= from && e.day <= to), ids = new Set(live.map(e => e.id));
    return [...live, ...this.stored<CafeEvent>(tenant, 'event', from, to).filter(e => !ids.has(e.id))].sort((a, b) => a.startAt.localeCompare(b.startAt));
  }
}

/** Kapora money that moved in [from, to): taken ('in') and given back ('out'), live and stored. For the gün sonu kasası. */
export function depositFlowsFor(store: Store, tenant: string, s: State, from: number, to: number) {
  ensureTable(store.db);
  const lo = Number.isFinite(from) ? from : -8.64e15, hi = Number.isFinite(to) ? to : 8.64e15;
  const live = new Map((s.reservations ?? []).map(r => [r.id, r]));
  // Kapora money moves by time; a closed year's package can hold a reservation whose kapora was taken before its day.
  const rows = store.packages.sources('reservation_records', m => maskDays(m, 'day'), undefined, undefined, tenant)
    .flatMap(src => src.db.prepare(`SELECT kind,id,payload FROM reservation_records WHERE tenant=? AND kind='reservation' AND ((taken_at>=? AND taken_at<?) OR (decided_at>=? AND decided_at<?)) AND ${src.where}`).all(tenant, lo, hi, lo, hi) as Row[]);
  for (const row of rows) if (!live.has(row.id)) live.set(row.id, openRow<Reservation>(store, tenant, row));
  return depositFlows(live.values(), lo, hi);
}

/** The floor's view of reservations and events (StaffSnapshot): no phone, no note. Kitchen gets none. */
export function floorReservations(s: State, role: Role, now: number, view: (t: CafeTable) => TableView) {
  if (role === 'kitchen') return {};
  const settings = reservationSettings(s.reservationSettings);
  const rules: FloorRules = { leadMinutes: settings.leadMinutes, askMinutes: settings.askMinutes, canReserve: canReserve(role, s.reservationSettings), canRunEvents: canRunEvents(role) };
  const marks: ReservationMark[] = (s.reservations ?? []).filter(r => r.status === 'booked' && Math.abs(Date.parse(r.at) - now) < 36 * 3600_000)
    .map(r => ({ id: r.id, tableId: r.tableId, name: r.name, people: r.people, time: r.time, day: r.day, at: r.at, ...(r.waitUntil ? { waitUntil: r.waitUntil } : {}), ...(r.deposit ? { deposit: r.deposit.amount } : {}), ...(r.eventId ? { eventId: r.eventId } : {}) }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const open = (s.events ?? []).filter(e => !e.closedAt);
  const events: PublicEvent[] = open.map(e => ({ id: e.id, name: e.name, day: e.day, start: e.start, ...(e.end ? { end: e.end } : {}), startAt: e.startAt, ...(e.endAt ? { endAt: e.endAt } : {}), ...(e.startedAt ? { startedAt: e.startedAt } : {}), hideNormal: e.hideNormal, ...(e.capacity ? { capacity: e.capacity } : {}), tables: e.tables.length }));
  const ids = new Set(open.map(e => e.id)), order = new Map(open.flatMap(e => e.tables.map((t, i) => [t.id, i] as const)));
  const eventTables = s.tables.filter(t => t.event && ids.has(t.event.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(view);
  return { reservations: rules, reservationMarks: marks, events, eventTables };
}

const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), id = z.string().min(1).max(100);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time = z.string().regex(/^\d{2}:\d{2}$/);
const reservationInput = z.object({ requestId, id: id.optional(), tableId: id, day, time, name: z.string().max(200), people: z.number().int(), phone: z.string().max(60).nullable().optional(), note: z.string().max(1000).nullable().optional(),
  deposit: z.object({ amount: z.number().int(), method: z.enum(['cash', 'card']) }).nullable().optional(), remind: z.enum(['hour', 'day']).nullable().optional(), force: z.boolean().optional() });
const eventInput = z.object({ requestId, name: z.string().max(200), day, start: time, end: time.nullable().optional(), count: z.number().int(), prefix: z.string().max(60).optional(), names: z.array(z.string().max(60)).max(100).optional(), capacity: z.number().int().nullable().optional(), hideNormal: z.boolean() });

/**
 * Routes (all under /api/staff): reservations (GET list of days, save, cancel, seat, wait, no-show, kapora choice), settings,
 * events (list, create, update, start, close, table name), walk-in and guest names, "Kaporayla kapat". The report route is
 * added separately after the report guard (reservationReportRoutes). Starts the minute sweep (reminders, moving out).
 */
export function reservationRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, notifications: () => Notifications | undefined = () => undefined, everyMs = 60_000, enabled: (tenant: string) => boolean = () => true) {
  const book = new ReservationBook(store), ctx = () => ({ now: now(), id: randomUUID });
  const staff = (req: Request) => { const a = actorFor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner', 'manager', 'cashier', 'waiter']); return { a, s }; };
  const run = <T>(req: Request, change: (s: State, a: Actor) => T) => { const a = actorFor(req); return store.mutate(a.tenantId, s => change(s, a)); };

  app.get('/api/staff/reservations', (req, res) => {
    const { a, s } = staff(req), q = z.object({ from: day, to: day }).parse(req.query);
    if (q.from > q.to || Date.parse(q.to) - Date.parse(q.from) > 400 * DAY) throw new DomainError('RANGE', 'En çok 400 günlük rezervasyon okunabilir.', 400);
    const allowed = canReserve(a.role as Role, s.reservationSettings);
    if (!allowed) throw new DomainError('FORBIDDEN', 'Rezervasyonları görme yetkiniz yok.', 403);
    // Kapora choices: the owner and the Müdür. Waiters read the guest's name only: never the phone or the note (owner's decision).
    const manages = isManagement(a.role), contact = seesGuestContact(a.role as Role), shown = (r: Reservation) => contact ? r : withoutContact(r);
    const pending = manages ? (s.reservations ?? []).filter(r => r.deposit?.pending).map(shown) : [];
    // Tables for the form and the table plan: the floor and the open events' tables; `busy` = a bill is open there now ("Dolu").
    const open = new Map((s.events ?? []).filter(e => !e.closedAt).map(e => [e.id, e]));
    const tables = s.tables.filter(t => !t.takeaway && (!t.event || open.has(t.event.id))).map(t => ({ id: t.id, name: t.name, ...(t.area ? { area: t.area } : {}), ...(t.accountId ? { busy: true } : {}), ...(t.event ? { eventId: t.event.id, eventName: open.get(t.event.id)!.name, eventDay: open.get(t.event.id)!.day } : {}) }));
    res.json({ today: turkishDay(now()), reservations: book.reservations(a.tenantId, s, q.from, q.to).map(shown), events: book.events(a.tenantId, s, q.from, q.to), pending, tables, rules: floorReservations(s, a.role as Role, now().getTime(), t => ({ ...t, account: null })).reservations, owner: manages, contact });
  });
  app.post('/api/staff/reservations', (req, res) => { const b = reservationInput.parse(req.body); res.json(run(req, (s, a) => saveReservation(s, a, b, ctx()))); });
  const simple = z.object({ requestId, id });
  app.post('/api/staff/reservations/cancel', (req, res) => { const b = simple.parse(req.body); res.json(run(req, (s, a) => cancelReservation(s, a, b, ctx()))); });
  app.post('/api/staff/reservations/seat', (req, res) => { const b = simple.extend({ tableId: id.optional() }).parse(req.body); res.json(run(req, (s, a) => seatReservation(s, a, b, ctx()))); });
  app.post('/api/staff/reservations/wait', (req, res) => { const b = simple.parse(req.body); res.json(run(req, (s, a) => waitReservation(s, a, b, ctx()))); });
  app.post('/api/staff/reservations/no-show', (req, res) => { const b = simple.parse(req.body); res.json(run(req, (s, a) => noShowReservation(s, a, b, ctx()))); });
  app.post('/api/staff/reservations/deposit', (req, res) => { const b = simple.extend({ kind: z.enum(['refund', 'keep']) }).parse(req.body); res.json(run(req, (s, a) => decideDeposit(s, a, b, ctx()))); });
  app.get('/api/staff/reservations/settings', (req, res) => { const { a, s } = staff(req); requireRole(s, a, ['owner']); res.json(reservationSettings(s.reservationSettings)); });
  app.post('/api/staff/reservations/settings', (req, res) => {
    const b = z.object({ leadMinutes: z.number().int().optional(), askMinutes: z.number().int().optional(), roles: z.array(z.enum(['cashier', 'waiter'])).max(2).optional() }).parse(req.body);
    res.json(reservationSettings(run(req, (s, a) => saveReservationSettings(s, a, b))));
  });
  app.post('/api/staff/reservations/walk-in', (req, res) => { const b = z.object({ requestId, tableId: id, name: z.string().max(200), people: z.number().int().optional() }).parse(req.body); res.json(run(req, (s, a) => seatWalkIn(s, a, b, ctx()))); });
  app.post('/api/staff/reservations/guest-name', (req, res) => { const b = z.object({ requestId, accountId: id, name: z.string().max(200), people: z.number().int().optional() }).parse(req.body); res.json(run(req, (s, a) => renameGuest(s, a, b, ctx()))); });
  app.post('/api/staff/reservations/close-with-deposit', (req, res) => { const b = z.object({ requestId, accountId: id, version: z.number().int().nonnegative() }).parse(req.body); res.json(run(req, (s, a) => closeWithDeposit(s, a, b, ctx()))); });

  app.get('/api/staff/events', (req, res) => {
    const { a, s } = staff(req), today = turkishDay(now());
    // Open events, and those of the last 60 days and the coming year.
    const list = book.events(a.tenantId, s, addDays(today, -60), addDays(today, 400));
    const live = new Set((s.events ?? []).filter(e => !e.closedAt).map(e => e.id));
    const tables = new Map(s.tables.filter(t => t.event && live.has(t.event.id)).map(t => [t.id, t]));
    const reservations = book.reservations(a.tenantId, s, addDays(today, -60), addDays(today, 400)).filter(r => r.eventId);
    res.json({ today, events: list.map(e => ({ ...e, tableState: e.tables.map(t => { const v = tables.get(t.id), acc = v?.accountId ? s.accounts.find(x => x.id === v.accountId) : undefined; return { id: t.id, name: v?.name ?? t.name, ...(acc ? { guest: acc.guest?.name ?? '', open: true } : {}) }; }) })),
      reservations: reservations.map(({ phone: _p, ...r }) => seesGuestContact(a.role as Role) ? r : withoutContact(r)), canRun: canRunEvents(a.role as Role), canReserve: canReserve(a.role as Role, s.reservationSettings) });
  });
  app.post('/api/staff/events', (req, res) => { const b = eventInput.parse(req.body); res.json(run(req, (s, a) => createEvent(s, a, b, ctx()))); });
  app.post('/api/staff/events/update', (req, res) => { const b = z.object({ requestId, id, name: z.string().max(200), day, start: time, end: time.nullable().optional(), hideNormal: z.boolean() }).parse(req.body); res.json(run(req, (s, a) => updateEvent(s, a, b, ctx()))); });
  app.post('/api/staff/events/start', (req, res) => { const b = simple.parse(req.body); res.json(run(req, (s, a) => startEvent(s, a, b, ctx()))); });
  app.post('/api/staff/events/close', (req, res) => { const b = simple.parse(req.body); res.json(run(req, (s, a) => closeEvent(s, a, b, ctx()))); });
  app.post('/api/staff/events/table-name', (req, res) => { const b = z.object({ requestId, tableId: id, name: z.string().max(200) }).parse(req.body); res.json(run(req, (s, a) => renameEventTable(s, a, b, ctx()))); });

  /** Reminders ("Bana hatırlat"), "Etkinlik bitti mi?" for the owner, and moving finished records out of the snapshot. */
  function sweep(tenant: string) {
    const t = now().getTime(); let s = store.read(tenant);
    if (book.needsArchive(s, t)) { store.mutate(tenant, state => book.archive(state, t)); s = store.read(tenant); }
    // Hizmet paketi: no "Rezervasyon ve etkinlik" in the package, no reminders (the records stay and still move out).
    const inbox = notifications(); if (!inbox || !enabled(tenant)) return;
    for (const r of s.reservations ?? []) if (r.status === 'booked' && r.remind) {
      const due = Date.parse(r.at) - (r.remind === 'day' ? DAY : 3600_000);
      if (due <= t && due > t - 3 * DAY) inbox.add(tenant, `reservation:${r.id}:${r.at}`, { kind: 'reminder', day: r.day, title: `Rezervasyon: ${r.name} · ${r.time}`, text: `${r.tableName} · ${r.people} kişi${r.deposit ? ' · kaporalı' : ''}${r.note ? ` · ${r.note}` : ''}` });
    }
    for (const e of s.events ?? []) if (!e.closedAt && e.endAt && Date.parse(e.endAt) <= t) inbox.add(tenant, `event-end:${e.id}:${e.endAt}`, { kind: 'reminder', day: e.day, title: `Etkinlik bitti mi? ${e.name}`, text: 'Planlanan bitiş saati geçti. Bütün hesaplar kapanınca Ajanda ve rezervasyon → Etkinlikler ya da Masalar\'dan “Etkinliği kapat”a basın. Kendiliğinden kapanmaz.' });
  }
  if (everyMs > 0) {
    const timer = setInterval(() => {
      // The store closed under the timer (shutdown, tests): stop instead of throwing from a timer.
      if (!store.db.isOpen) { clearInterval(timer); return; }
      for (const { tenant } of store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) {
        try { sweep(tenant); } catch (error) { if (!store.db.isOpen) { clearInterval(timer); return; } console.warn(`Rezervasyon taraması yapılamadı: ${error instanceof Error ? error.message : error}`); }
      }
    }, everyMs);
    timer.unref();
  }
  // Bildirimler (üst çubuktaki zil) read the reminders without waiting for the next minute.
  app.use('/api/staff/notifications', (req, _res, next) => { try { const a = actorFor(req); sweep(a.tenantId); } catch { /* the route answers for itself */ } next(); });
  return { book, sweep };
}

/** Satış ve Raporlar → Rezervasyon (owner, Müdür; after the report guard). */
export function reservationReportRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, book: ReservationBook) {
  app.get('/api/staff/reports/reservations', async (req, res) => {
    const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner', 'manager']);
    const q = z.object({ from: z.string(), to: z.string() }).parse(req.query), { start, end } = reportRange(q.from, q.to);
    res.setHeader('Cache-Control', 'no-store');
    // The sales figures from History.reportSpan (closed months and years from roll-ups, built first in steps).
    if (!await readyFor(res, [store.history.prepare(a.tenantId, store.read(a.tenantId), start, end)])) return;
    const s = store.read(a.tenantId);
    const from = q.from === 'all' ? '0000-01-01' : q.from, to = q.to === 'all' ? '9999-12-31' : q.to;
    // Business days (05:00–05:00) like every report: a reservation or an event at 00:30 is stored under the next calendar
    // day, so one more day is read and each is kept by the business day of its time.
    const wider = to === '9999-12-31' ? to : addDays(to, 1), inRange = (at: string) => { const d = businessDay(at); return d >= from && d <= to; };
    // A year of stored reservations per slice ("Tümü": every one of five years), so the tablets never wait for it.
    let left = false; res.on('close', () => { left = true; });
    const all = await drainSlowly(book.reservationsSteps(a.tenantId, s, from, wider), () => left);
    if (!all) return;
    const reservations = all.filter(r => inRange(r.at)), events = book.events(a.tenantId, s, from, wider).filter(e => inRange(e.startAt));
    const totals = store.history.reportSpan(a.tenantId, s, start, end).total, channel = totals.channels.get('rezervasyon');
    // Each event's orders: settled bills from around its day and the floor (ReservationBook.eventRow). An event that left the
    // floor (closed, its reservations finished, three days on) never changes again: its row was kept when it left
    // (event_reports; older events once, here), unless one of its orders is still on an open bill.
    const live = new Set((s.events ?? []).map(e => e.id)), onFloor = new Set(s.orders.flatMap(o => o.reservation?.eventId ? [o.reservation.eventId] : []));
    // Newest first (K-U): this year's events on top, not 2021's.
    const eventRows = events.sort((x, y) => y.startAt.localeCompare(x.startAt)).map(e => live.has(e.id) || onFloor.has(e.id) ? book.eventRow(a.tenantId, s, e, reservations) : book.finalReport(a.tenantId, s, e, reservations));
    res.json({ from: q.from, to: q.to, period: reservationPeriod(reservations, from, to), sales: { orders: channel?.orders ?? 0, amount: channel?.amount ?? 0, collected: totals.reservation }, events: eventRows });
  });
}
