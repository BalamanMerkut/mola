import type { Account, Order, Payment, Role } from './types.js';
import { businessDay } from './business-day.js';

/*
 * Ajanda ve rezervasyon: masa ayırma (a real table reserved for a time) and etkinlikler (match days and the like, with
 * temporary tables). Browser-safe: only types and plain rules shared by the screens, the reports, the cash closing and the
 * server. The changes themselves (DomainError, once) live in reservation-rules.ts; storage in server/reservations.ts.
 *
 * Nothing happens by itself: a reservation shows on its table from `leadMinutes` before its time, asks "Geldi mi?"
 * `askMinutes` after it, and only staff seat it, wait 15 more minutes, or mark it as not come. An event's tables show on
 * Masalar from its start (or "Etkinliği başlat") and the event closes only with "Etkinliği kapat".
 *
 * Kapora (deposit): taken when the reservation is written (cash or card; the drawer counts it at that moment). When the guest
 * is seated it rides on the account and covers the bill (`depositCredit`); when the bill closes, the covered part becomes
 * a Payment marked `deposit` (part of the sale, never counted in the drawer again). What is left over, a no-show's or a
 * cancellation's kapora waits for the owner: "İade et" (money goes back, out of the drawer when cash) or "İşletmede kalsın"
 * (a separate income line, never a sale).
 */

export type DepositMethod = 'cash' | 'card';
export const depositMethodNames: Record<DepositMethod, string> = { cash: 'Nakit', card: 'Kart' };
export type PendingReason = 'no_show' | 'cancelled' | 'leftover';
export const pendingReasonNames: Record<PendingReason, string> = { no_show: 'Gelmeyen kaporası', cancelled: 'İptal edilen rezervasyonun kaporası', leftover: 'Hesaptan artan kapora' };
export type Deposit = {
  amount: number; method: DepositMethod; takenAt: string; takenBy: string; takenByName: string;
  /** Part that paid the seated guest's bill, when that bill closed. */
  applied?: number; appliedAt?: string;
  /** Waits for the owner's choice. */
  pending?: { amount: number; reason: PendingReason; since: string };
  decision?: { kind: 'refund' | 'keep'; amount: number; reason: PendingReason; at: string; by: string; byName: string };
};
export type ReservationStatus = 'booked' | 'seated' | 'no_show' | 'cancelled';
export const statusNames: Record<ReservationStatus, string> = { booked: 'Bekleniyor', seated: 'Geldi', no_show: 'Gelmedi', cancelled: 'İptal' };
export type Reservation = {
  id: string; tableId: string; tableName: string; eventId?: string;
  /** Turkish calendar day and wall-clock time; `at` is the instant. */
  day: string; time: string; at: string;
  name: string; people: number;
  /** Stays only on the café computer (never on the floor snapshot, never in reports). */
  phone?: string; note?: string;
  deposit?: Deposit;
  /** "Bana hatırlat": a note in Bildirimler (üst çubuktaki zil) an hour or a day before. */
  remind?: 'hour' | 'day';
  status: ReservationStatus;
  /** "15 dk daha bekle": the question comes back after this. */
  waitUntil?: string;
  seatedAt?: string; accountId?: string;
  /** The seated guest's bill closed (or was merged away). */
  closedAt?: string;
  noShowAt?: string; cancelledAt?: string; doneBy?: string;
  createdAt: string; updatedAt: string; by: string; byName: string;
};
/** On the account of a seated guest (Account.guest). */
export type SeatedGuest = { name: string; people?: number; reservationId?: string; eventId?: string; walkIn?: boolean };
/** On the account of a seated guest with a kapora (Account.deposit). */
export type AccountDeposit = { reservationId: string; amount: number; method: DepositMethod; takenAt: string; paymentId?: string; settledAt?: string };

export type EventTable = { id: string; name: string; capacity?: number };
export type CafeEvent = {
  id: string; name: string; day: string; start: string; end?: string; startAt: string; endAt?: string;
  hideNormal: boolean; capacity?: number;
  /** The temporary tables as created and renamed; kept with the event for reports after the tables are gone. */
  tables: EventTable[];
  startedAt?: string; startedBy?: string;
  closedAt?: string; closedBy?: string; closedByName?: string;
  createdAt: string; by: string; byName: string;
};
/** Ayarlar → Masalar ve QR → Rezervasyon. `roles`: besides the owner, who may write reservations. */
export type ReservationSettings = { leadMinutes?: number; askMinutes?: number; roles?: ('cashier' | 'waiter')[] };
export const DEFAULT_LEAD = 60, DEFAULT_ASK = 30, WAIT_MINUTES = 15;
export const CONFLICT_MS = 2 * 3600_000;
export const LEAD_CHOICES = [30, 60, 90, 120, 180] as const, ASK_CHOICES = [15, 30, 45, 60] as const;
export function reservationSettings(s?: ReservationSettings) {
  return { leadMinutes: s?.leadMinutes ?? DEFAULT_LEAD, askMinutes: s?.askMinutes ?? DEFAULT_ASK, roles: s?.roles ?? ['cashier', 'waiter'] as ('cashier' | 'waiter')[] };
}
/** The owner and the Müdür always; the cashier and waiters when Ayarlar allows them. */
export const canReserve = (role: Role, s?: ReservationSettings) => role === 'owner' || role === 'manager' || ((role === 'cashier' || role === 'waiter') && reservationSettings(s).roles.includes(role));
/** Event create, start, close and table names: owner, Müdür and cashier. */
export const canRunEvents = (role: Role) => role === 'owner' || role === 'manager' || role === 'cashier';
/** Who reads a guest's phone and note back: the counter and above. Waiters see only the name (owner's decision). */
export const seesGuestContact = (role: Role) => role === 'owner' || role === 'manager' || role === 'cashier';
/** A reservation as a waiter may read it: everything but the phone and the note. */
export function withoutContact<T extends { phone?: string; note?: string }>(r: T): Omit<T, 'phone' | 'note'> {
  const { phone: _p, note: _n, ...rest } = r;
  return rest;
}

/** What a floor screen needs (StaffSnapshot.reservations). */
export type FloorRules = { leadMinutes: number; askMinutes: number; canReserve: boolean; canRunEvents: boolean };
/** A booked reservation as Masalar sees it (no phone, no note). */
export type ReservationMark = { id: string; tableId: string; name: string; people: number; time: string; day: string; at: string; waitUntil?: string; deposit?: number; eventId?: string };
export type PublicEvent = Pick<CafeEvent, 'id' | 'name' | 'day' | 'start' | 'end' | 'startAt' | 'endAt' | 'startedAt' | 'hideNormal' | 'capacity'> & { tables: number };

// ---- Time (Turkish wall clock; Turkey has been UTC+3 all year since 2016) ----
export const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isDay = (day: string) => DAY_PATTERN.test(day) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
export const instantOf = (day: string, time: string) => new Date(Date.parse(`${day}T${time}:00+03:00`)).toISOString();
export const turkishDay = (at: number | string | Date = Date.now()) => new Date(new Date(at).getTime() + 3 * 3600_000).toISOString().slice(0, 10);
export const turkishTime = (at: number | string | Date) => new Date(new Date(at).getTime() + 3 * 3600_000).toISOString().slice(11, 16);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** Where a booked reservation stands on the floor at `now`: not yet shown, "Rezerve", or "Geldi mi?". */
export function markPhase(m: Pick<ReservationMark, 'at' | 'waitUntil'>, now: number, rules: Pick<FloorRules, 'leadMinutes' | 'askMinutes'>): 'later' | 'reserved' | 'ask' {
  const at = Date.parse(m.at);
  if (now < at - rules.leadMinutes * 60_000) return 'later';
  const askAt = Math.max(at + rules.askMinutes * 60_000, m.waitUntil ? Date.parse(m.waitUntil) : 0);
  return now < askAt ? 'reserved' : 'ask';
}
/** An event's tables are on Masalar from its start time or from "Etkinliği başlat", until it is closed. */
export const eventStarted = (e: Pick<CafeEvent, 'startedAt' | 'startAt'>, now: number) => !!e.startedAt || now >= Date.parse(e.startAt);
/** After the planned end only a gentle "Etkinlik bitti mi?"; never closed by itself. */
export const eventOverdue = (e: Pick<CafeEvent, 'endAt'>, now: number) => !!e.endAt && now >= Date.parse(e.endAt);

/** Other live reservations on the same table within ±2 hours (the form warns before saving). */
export function conflicts(list: Pick<Reservation, 'id' | 'tableId' | 'at' | 'status' | 'name' | 'time'>[], candidate: { id?: string; tableId: string; at: string }) {
  const at = Date.parse(candidate.at);
  return list.filter(r => r.id !== candidate.id && r.tableId === candidate.tableId && (r.status === 'booked' || r.status === 'seated') && Math.abs(Date.parse(r.at) - at) < CONFLICT_MS);
}

/** Event table names: "D" + 25 → D1…D25; or the owner's own list. */
export function eventTableNames(count: number, prefix: string, custom?: string[]) {
  if (custom?.length) return custom.map(n => n.trim());
  return Array.from({ length: count }, (_, i) => `${prefix.trim()}${i + 1}`);
}

// ---- Money ----
/** The part of an account's kapora that covers its bill right now (0 once it became a payment). */
export function depositCredit(s: { orders: Pick<Order, 'accountId' | 'status' | 'total'>[]; payments: Pick<Payment, 'accountId' | 'amount'>[] }, a: Pick<Account, 'id' | 'deposit'> | undefined) {
  if (!a?.deposit || a.deposit.paymentId || a.deposit.settledAt) return 0;
  const total = s.orders.filter(o => o.accountId === a.id && o.status !== 'cancelled').reduce((n, o) => n + o.total, 0);
  const paid = s.payments.filter(p => p.accountId === a.id).reduce((n, p) => n + p.amount, 0);
  return Math.max(0, Math.min(a.deposit.amount, total - paid));
}

/** Money moving in or out of the drawer (or the card terminal) because of a kapora: taken (in) or given back (out). */
export type DepositFlow = { at: string; amount: number; method: DepositMethod; kind: 'in' | 'out'; reservationId: string };
export function depositFlows(list: Iterable<Pick<Reservation, 'id' | 'deposit'>>, from = -8.64e15, to = 8.64e15): DepositFlow[] {
  const out: DepositFlow[] = [];
  const inside = (at: string) => { const t = Date.parse(at); return t >= from && t < to; };
  for (const r of list) {
    const d = r.deposit; if (!d) continue;
    if (inside(d.takenAt)) out.push({ at: d.takenAt, amount: d.amount, method: d.method, kind: 'in', reservationId: r.id });
    if (d.decision?.kind === 'refund' && inside(d.decision.at)) out.push({ at: d.decision.at, amount: d.decision.amount, method: d.method, kind: 'out', reservationId: r.id });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
/** Cash and card totals of deposit flows (gün sonu kasası: "Kapora (nakit)", "Kapora iadesi"). */
export function depositTotals(flows: Iterable<DepositFlow>) {
  const t = { cashIn: 0, cashOut: 0, cardIn: 0, cardOut: 0 };
  for (const f of flows) { if (f.method === 'cash') { if (f.kind === 'in') t.cashIn += f.amount; else t.cashOut += f.amount; } else if (f.kind === 'in') t.cardIn += f.amount; else t.cardOut += f.amount; }
  return t;
}

// ---- Reports ----
/** One period of reservations (by their day): counts, came / did not come, people and kapora money. */
export type ReservationPeriod = {
  count: number; booked: number; seated: number; noShow: number; cancelled: number; people: number; seatedPeople: number;
  /** Seated ÷ (seated + no-show); null with nothing decided yet. */
  showRate: number | null;
  deposits: { taken: number; takenCount: number; applied: number; kept: number; refunded: number; pending: number; noShowKept: number };
};
/** A reservation's business day (05:00–05:00, like every report): a table booked for 00:30 belongs to the evening before. */
export const reservationDay = (r: Pick<Reservation, 'at' | 'day'>) => r.at && Number.isFinite(Date.parse(r.at)) ? businessDay(r.at) : r.day;
export function reservationPeriod(list: Reservation[], from: string, to: string): ReservationPeriod {
  const rows = list.filter(r => reservationDay(r) >= from && reservationDay(r) <= to);
  const by = (s: ReservationStatus) => rows.filter(r => r.status === s);
  const seated = by('seated').length, noShow = by('no_show').length;
  const deposits = { taken: 0, takenCount: 0, applied: 0, kept: 0, refunded: 0, pending: 0, noShowKept: 0 };
  for (const r of rows) {
    const d = r.deposit; if (!d) continue;
    deposits.taken += d.amount; deposits.takenCount++; deposits.applied += d.applied ?? 0; deposits.pending += d.pending?.amount ?? 0;
    if (d.decision?.kind === 'keep') { deposits.kept += d.decision.amount; if (d.decision.reason === 'no_show') deposits.noShowKept += d.decision.amount; }
    if (d.decision?.kind === 'refund') deposits.refunded += d.decision.amount;
  }
  return { count: rows.length, booked: by('booked').length, seated, noShow, cancelled: by('cancelled').length, people: rows.reduce((n, r) => n + r.people, 0), seatedPeople: by('seated').reduce((n, r) => n + r.people, 0), showRate: seated + noShow ? seated / (seated + noShow) : null, deposits };
}
/** One event in the report: tables used, guests, revenue (orders on its tables), kapora and walk-in revenue. */
export type EventReport = {
  id: string; name: string; day: string; start: string; end?: string; closed: boolean; tables: number; tablesUsed: number; people: number;
  revenue: number; orders: number; walkInRevenue: number; reservedRevenue: number;
  reservations: number; seated: number; noShow: number;
  deposits: { taken: number; applied: number; noShow: number; noShowKept: number; noShowRefunded: number; pending: number };
};
/** `orders`: orders tagged with this event (any table, also after a move). `accounts`: their accounts (live or archived). */
export function eventReport(e: CafeEvent, reservations: Reservation[], orders: Pick<Order, 'accountId' | 'status' | 'total' | 'reservation'>[], accounts: Pick<Account, 'id' | 'tableId' | 'guest'>[]): EventReport {
  const mine = reservations.filter(r => r.eventId === e.id), live = orders.filter(o => o.reservation?.eventId === e.id && o.status !== 'cancelled' && o.status !== 'awaiting_approval');
  // Only the event's own temporary tables count as used: a bill moved to (or merged with) a normal table keeps its event
  // orders and revenue, but that normal table is not one of the event's tables ("Masa 29/25" otherwise).
  const accountIds = new Set(live.map(o => o.accountId)), own = new Set(e.tables.map(t => t.id)), billed = accounts.filter(a => accountIds.has(a.id)), used = billed.filter(a => own.has(a.tableId));
  const revenue = live.reduce((n, o) => n + o.total, 0), reservedRevenue = live.filter(o => o.reservation?.id).reduce((n, o) => n + o.total, 0);
  const deposits = { taken: 0, applied: 0, noShow: 0, noShowKept: 0, noShowRefunded: 0, pending: 0 };
  for (const r of mine) {
    const d = r.deposit; if (!d) continue;
    deposits.taken += d.amount; deposits.applied += d.applied ?? 0; deposits.pending += d.pending?.amount ?? 0;
    if (r.status === 'no_show') { deposits.noShow += d.amount; if (d.decision?.kind === 'keep') deposits.noShowKept += d.decision.amount; if (d.decision?.kind === 'refund') deposits.noShowRefunded += d.decision.amount; }
  }
  return { id: e.id, name: e.name, day: e.day, start: e.start, ...(e.end ? { end: e.end } : {}), closed: !!e.closedAt, tables: e.tables.length, tablesUsed: new Set(used.map(a => a.tableId)).size,
    people: billed.reduce((n, a) => n + (a.guest?.people ?? 0), 0), revenue, orders: live.length, walkInRevenue: revenue - reservedRevenue, reservedRevenue,
    reservations: mine.length, seated: mine.filter(r => r.status === 'seated').length, noShow: mine.filter(r => r.status === 'no_show').length, deposits };
}
/**
 * A closed event's temporary tables leave once no account on the floor refers to them any more (the closed bills settle into
 * history with the table's name, server/history.ts). Called with every snapshot write, like pruneTakeaways.
 */
export function pruneEventTables(s: { tables: { id: string; event?: { id: string } }[]; accounts: { tableId: string }[]; events?: Pick<CafeEvent, 'id' | 'closedAt'>[] }) {
  const open = new Set((s.events ?? []).filter(e => !e.closedAt).map(e => e.id));
  const gone = (t: { id: string; event?: { id: string } }) => !!t.event && !open.has(t.event.id) && !s.accounts.some(a => a.tableId === t.id);
  if (s.tables.some(gone)) s.tables = s.tables.filter(t => !gone(t));
}
/** "Ahmet · 4 kişi · 20:00" */
export const markText = (m: Pick<ReservationMark, 'name' | 'people' | 'time'>) => `${m.name} · ${m.people} kişi · ${m.time}`;
