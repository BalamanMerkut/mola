import { assertInt, DomainError, once, requireRole } from './engine.js';
import type { Account, Actor, CafeTable, Context, State } from './types.js';
import { canReserve, canRunEvents, conflicts, reservationSettings, eventTableNames, instantOf, isDay, TIME_PATTERN, turkishDay, WAIT_MINUTES, type CafeEvent, type DepositMethod, type Reservation, type ReservationSettings, type SeatedGuest } from './reservations.js';

/*
 * The changes of Ajanda ve rezervasyon (server side: they use the engine's errors and request replay). Every change happens
 * in the snapshot transaction, so seating a reservation opens its bill in the same step, and a bill closing settles its
 * kapora (engine.ts settleGuest). See packages/domain/reservations.ts for the plain rules.
 */

/** Live reservations kept in the snapshot at most (finished ones move to their own table, server/reservations.ts). */
export const MAX_LIVE = 3000;
/** Temporary tables of all open events together. */
export const MAX_EVENT_TABLES = 200;
const HOUR = 3600_000;

const who = (s: State, actor: Actor) => s.staffUsers?.find(u => u.id === actor.id)?.name ?? 'Personel';
/** A short name as typed: control characters out, spaces folded, at most `max` letters. */
export function cleanText(value: unknown, max: number) {
  if (typeof value !== 'string') return '';
  const text = value.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return [...text].length > max ? null : text;
}
function requiredName(value: unknown, max = 40) {
  const name = cleanText(value, max);
  if (!name) throw new DomainError('INVALID_NAME', `Misafirin adını yazın (en çok ${max} harf).`);
  return name;
}
function phoneOf(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const phone = cleanText(value, 20);
  if (phone === null || (phone && (!/^[+0-9 ()-]+$/.test(phone) || (phone.match(/\d/g)?.length ?? 0) < 7))) throw new DomainError('INVALID_PHONE', 'Telefonu yalnız rakamlarla yazın (ör. 0532 123 45 67) ya da boş bırakın.');
  return phone || undefined;
}
function noteOf(value: unknown) {
  const note = cleanText(value ?? '', 200);
  if (note === null) throw new DomainError('INVALID_NOTE', 'Not en çok 200 karakter olabilir.');
  return note || undefined;
}
const people = (n: number) => { assertInt(n, 1, 500); return n; };
function requireReserve(s: State, actor: Actor) {
  requireRole(s, actor, ['owner', 'manager', 'cashier', 'waiter']);
  if (!canReserve(actor.role as 'owner', s.reservationSettings)) throw new DomainError('FORBIDDEN', 'Rezervasyon yazma yetkiniz yok. İşletme sahibi Ajanda ve rezervasyon → Ayarlar bölümünden açabilir.', 403);
}
const floorStaff = (s: State, actor: Actor) => requireRole(s, actor, ['owner', 'manager', 'cashier', 'waiter']);
function requireEvents(s: State, actor: Actor) {
  requireRole(s, actor, ['owner', 'manager', 'cashier', 'waiter']);
  if (!canRunEvents(actor.role as 'owner')) throw new DomainError('FORBIDDEN', 'Etkinliği işletme sahibi, müdür ya da kasiyer yönetir.', 403);
}
function reservation(s: State, id: string) {
  const r = s.reservations?.find(r => r.id === id);
  if (!r) throw new DomainError('NOT_FOUND', 'Rezervasyon bulunamadı. Başka bir ekranda değişmiş olabilir.', 404);
  return r;
}
function booked(r: Reservation) {
  if (r.status !== 'booked') throw new DomainError('RESERVATION_CHANGED', `Bu rezervasyon artık bekleniyor değil (${r.status === 'seated' ? 'geldi' : r.status === 'no_show' ? 'gelmedi' : 'iptal edildi'}).`, 409);
  return r;
}
function openEvent(s: State, id: string) {
  const e = s.events?.find(e => e.id === id);
  if (!e) throw new DomainError('NOT_FOUND', 'Etkinlik bulunamadı.', 404);
  if (e.closedAt) throw new DomainError('EVENT_CLOSED', 'Bu etkinlik kapandı.', 409);
  return e;
}
/** A real table or an open event's table; never a masasız ticket. */
function tableFor(s: State, id: string) {
  const t = s.tables.find(t => t.id === id && !t.takeaway);
  if (!t) throw new DomainError('TABLE_NOT_FOUND', 'Masa bulunamadı. Başka bir masa seçin.', 404);
  if (t.event) openEvent(s, t.event.id);
  return t;
}
function freeTable(t: CafeTable) {
  if (t.accountId) throw new DomainError('TABLE_BUSY', `${t.name} dolu. Önce o hesabı kapatın ya da başka bir boş masa seçin.`, 409);
  if (t.needsCleaning) throw new DomainError('TABLE_CLEANING', `${t.name} temizlik bekliyor. Önce “Temizlendi” deyin.`, 409);
}
function openAccount(s: State, t: CafeTable, ctx: Context, guest: SeatedGuest, deposit?: Account['deposit']) {
  const a: Account = { id: ctx.id(), tableId: t.id, status: 'open', version: 0, openedAt: ctx.now.toISOString(), guest, ...(deposit ? { deposit } : {}) };
  s.accounts.push(a); t.accountId = a.id;
  return a;
}

export type ReservationInput = { requestId: string; id?: string; tableId: string; day: string; time: string; name: string; people: number; phone?: string | null; note?: string | null; deposit?: { amount: number; method: DepositMethod } | null; remind?: 'hour' | 'day' | null; force?: boolean };
/**
 * "Masa ayır" (new) or a change of a waiting reservation. Another live reservation on the same table within ±2 hours is
 * refused with RESERVATION_CONFLICT unless `force` (the form asks "Yine de kaydet"). A kapora is taken once and never
 * changed afterwards (the drawer already counted it).
 */
export function saveReservation(s: State, actor: Actor, input: ReservationInput, ctx: Context) {
  requireReserve(s, actor);
  return once(s, actor, 'reservation-save', input.requestId, input, () => {
    const now = ctx.now.getTime(), at = ctx.now.toISOString();
    if (!isDay(input.day) || !TIME_PATTERN.test(input.time)) throw new DomainError('INVALID_TIME', 'Geçerli bir gün ve saat seçin.');
    const when = instantOf(input.day, input.time), old = input.id ? booked(reservation(s, input.id)) : undefined;
    if (!old && Date.parse(when) < now - 12 * HOUR) throw new DomainError('PAST_TIME', 'Geçmiş bir saate rezervasyon yazılamaz.');
    if (Date.parse(when) > now + 400 * 24 * HOUR) throw new DomainError('FAR_TIME', 'En çok 400 gün sonrasına rezervasyon yazılabilir.');
    const table = tableFor(s, input.tableId), event = table.event ? s.events!.find(e => e.id === table.event!.id)! : undefined;
    if (event && input.day !== event.day && (!event.endAt || input.day !== turkishDay(event.endAt))) throw new DomainError('EVENT_DAY', `${event.name} masasına yalnız etkinlik günü için rezervasyon yazılabilir.`);
    // A waiter may type a phone and a note but never reads them back (seesGuestContact): their edit form has neither, so an
    // edit without them keeps what is saved; a new value replaces it.
    const blind = actor.role === 'waiter' && !!old;
    const name = requiredName(input.name), count = people(input.people), phone = blind && !input.phone ? old!.phone : phoneOf(input.phone), note = blind && !input.note ? old!.note : noteOf(input.note);
    const clash = conflicts(s.reservations ?? [], { id: old?.id, tableId: table.id, at: when });
    if (clash.length && !input.force) throw new DomainError('RESERVATION_CONFLICT', `${table.name} için 2 saat içinde başka rezervasyon var: ${clash.map(c => `${c.name} ${c.time}`).join(', ')}.`, 409);
    let deposit = old?.deposit;
    if (input.deposit) {
      if (deposit) { if (deposit.amount !== input.deposit.amount || deposit.method !== input.deposit.method) throw new DomainError('DEPOSIT_FIXED', 'Alınan kapora değiştirilemez. Gerekirse rezervasyonu iptal edip kaporayı iade edin.', 409); }
      else {
        assertInt(input.deposit.amount, 1, 100_000_000);
        if (input.deposit.method !== 'cash' && input.deposit.method !== 'card') throw new DomainError('INVALID_METHOD', 'Kaporanın nakit mi kartla mı alındığını seçin.');
        deposit = { amount: input.deposit.amount, method: input.deposit.method, takenAt: at, takenBy: actor.id, takenByName: who(s, actor) };
      }
    }
    if (!old && (s.reservations?.length ?? 0) >= MAX_LIVE) throw new DomainError('TOO_MANY', 'Çok fazla açık rezervasyon var. Eskileri tamamlayın.', 409);
    const r: Reservation = {
      id: old?.id ?? ctx.id(), tableId: table.id, tableName: table.name, ...(event ? { eventId: event.id } : {}),
      day: input.day, time: input.time, at: when, name, people: count, ...(phone ? { phone } : {}), ...(note ? { note } : {}),
      ...(deposit ? { deposit } : {}), ...(input.remind ? { remind: input.remind } : {}),
      status: 'booked', createdAt: old?.createdAt ?? at, updatedAt: at, by: old?.by ?? actor.id, byName: old?.byName ?? who(s, actor),
    };
    s.reservations = [...(s.reservations ?? []).filter(x => x.id !== r.id), r];
    s.audit.push({ action: old ? 'reservation.changed' : 'reservation.created', actor: actor.id, target: r.id, at });
    return { id: r.id, conflicts: clash.length };
  });
}
/** The guest called to cancel. A kapora then waits for the owner's choice (İade et / İşletmede kalsın). */
export function cancelReservation(s: State, actor: Actor, input: { requestId: string; id: string }, ctx: Context) {
  requireReserve(s, actor);
  return once(s, actor, 'reservation-cancel', input.requestId, input, () => {
    const r = booked(reservation(s, input.id)), at = ctx.now.toISOString();
    r.status = 'cancelled'; r.cancelledAt = at; r.doneBy = who(s, actor); r.updatedAt = at; delete r.waitUntil;
    if (r.deposit) r.deposit.pending = { amount: r.deposit.amount, reason: 'cancelled', since: at };
    s.audit.push({ action: 'reservation.cancelled', actor: actor.id, target: r.id, at });
    return { ok: true, deposit: r.deposit?.amount ?? 0 };
  });
}
/** "Geldi": the bill opens on the table (or another free one) with the guest's name and kapora. */
export function seatReservation(s: State, actor: Actor, input: { requestId: string; id: string; tableId?: string }, ctx: Context) {
  floorStaff(s, actor);
  return once(s, actor, 'reservation-seat', input.requestId, input, () => {
    const r = booked(reservation(s, input.id)), t = tableFor(s, input.tableId ?? r.tableId), at = ctx.now.toISOString();
    freeTable(t);
    const eventId = r.eventId ?? t.event?.id;
    const a = openAccount(s, t, ctx, { name: r.name, people: r.people, reservationId: r.id, ...(eventId ? { eventId } : {}) },
      r.deposit ? { reservationId: r.id, amount: r.deposit.amount, method: r.deposit.method, takenAt: r.deposit.takenAt } : undefined);
    r.status = 'seated'; r.seatedAt = at; r.accountId = a.id; r.tableId = t.id; r.tableName = t.name; r.doneBy = who(s, actor); r.updatedAt = at; delete r.waitUntil;
    s.audit.push({ action: 'reservation.seated', actor: actor.id, target: r.id, at });
    return { accountId: a.id, tableId: t.id, tableName: t.name };
  });
}
/** "15 dk daha bekle": the question comes back later; nothing else changes. */
export function waitReservation(s: State, actor: Actor, input: { requestId: string; id: string }, ctx: Context) {
  floorStaff(s, actor);
  return once(s, actor, 'reservation-wait', input.requestId, input, () => {
    // 15 minutes more from when the question came up (or from now, when asked later), so an early tap still means "15 more".
    const r = booked(reservation(s, input.id)), asked = Date.parse(r.at) + reservationSettings(s.reservationSettings).askMinutes * 60_000;
    r.waitUntil = new Date(Math.max(ctx.now.getTime(), asked, r.waitUntil ? Date.parse(r.waitUntil) : 0) + WAIT_MINUTES * 60_000).toISOString(); r.updatedAt = ctx.now.toISOString();
    return { waitUntil: r.waitUntil };
  });
}
/** "Gelmedi": the table is free again; a kapora becomes "gelmeyen kaporası" and waits for the owner's choice. */
export function noShowReservation(s: State, actor: Actor, input: { requestId: string; id: string }, ctx: Context) {
  floorStaff(s, actor);
  return once(s, actor, 'reservation-no-show', input.requestId, input, () => {
    const r = booked(reservation(s, input.id)), at = ctx.now.toISOString();
    markNoShow(r, at, who(s, actor));
    s.audit.push({ action: 'reservation.no_show', actor: actor.id, target: r.id, at });
    return { ok: true, deposit: r.deposit?.amount ?? 0 };
  });
}
function markNoShow(r: Reservation, at: string, by: string) {
  r.status = 'no_show'; r.noShowAt = at; r.doneBy = by; r.updatedAt = at; delete r.waitUntil;
  if (r.deposit) r.deposit.pending = { amount: r.deposit.amount, reason: 'no_show', since: at };
}
/** The owner's (or the Müdür's) choice for a kapora left over: given back (out of the drawer when cash) or kept (a separate income line). */
export function decideDeposit(s: State, actor: Actor, input: { requestId: string; id: string; kind: 'refund' | 'keep' }, ctx: Context) {
  requireRole(s, actor, ['owner', 'manager']);
  return once(s, actor, 'reservation-deposit', input.requestId, input, () => {
    const r = reservation(s, input.id), d = r.deposit, at = ctx.now.toISOString();
    if (!d?.pending) throw new DomainError('NO_PENDING', 'Bu rezervasyonda karar bekleyen kapora yok.', 409);
    if (input.kind !== 'refund' && input.kind !== 'keep') throw new DomainError('INVALID_VALUE', 'İade ya da işletmede kalsın seçin.');
    d.decision = { kind: input.kind, amount: d.pending.amount, reason: d.pending.reason, at, by: actor.id, byName: who(s, actor) };
    delete d.pending; r.updatedAt = at;
    s.audit.push({ action: input.kind === 'refund' ? 'reservation.deposit_refunded' : 'reservation.deposit_kept', actor: actor.id, target: r.id, at });
    return { ok: true };
  });
}
/** Ayarlar → Masalar ve QR → Rezervasyon (owner). */
export function saveReservationSettings(s: State, actor: Actor, input: ReservationSettings) {
  requireRole(s, actor, ['owner']);
  const next = { ...s.reservationSettings };
  if (input.leadMinutes !== undefined) { assertInt(input.leadMinutes, 0, 24 * 60); next.leadMinutes = input.leadMinutes; }
  if (input.askMinutes !== undefined) { assertInt(input.askMinutes, 5, 240); next.askMinutes = input.askMinutes; }
  if (input.roles !== undefined) next.roles = [...new Set(input.roles.filter(r => r === 'cashier' || r === 'waiter'))];
  s.reservationSettings = next;
  return next;
}

// ---- Events ----
export type EventInput = { requestId: string; name: string; day: string; start: string; end?: string | null; count: number; prefix?: string; names?: string[]; capacity?: number | null; hideNormal: boolean };
function checkNames(s: State, names: string[], except: string[] = []) {
  const taken = new Set(s.tables.filter(t => !t.takeaway && !except.includes(t.id) && (!t.event || !s.events?.find(e => e.id === t.event!.id)?.closedAt)).map(t => t.name.toLocaleLowerCase('tr')));
  const seen = new Set<string>();
  for (const n of names) {
    if (!n || [...n].length > 20) throw new DomainError('INVALID_NAME', 'Masa adları 1–20 harf olmalı.');
    const k = n.toLocaleLowerCase('tr');
    if (taken.has(k) || seen.has(k)) throw new DomainError('DUPLICATE_NAME', `“${n}” adında başka bir masa var. Farklı bir ad seçin.`, 409);
    seen.add(k);
  }
}
function eventTimes(day: string, start: string, end?: string | null) {
  if (!isDay(day) || !TIME_PATTERN.test(start) || (end && !TIME_PATTERN.test(end))) throw new DomainError('INVALID_TIME', 'Geçerli bir gün ve saat seçin.');
  const startAt = instantOf(day, start);
  // An end before the start is the next morning (a night event).
  const endAt = end ? new Date(Date.parse(instantOf(day, end)) + (end <= start ? 24 * HOUR : 0)).toISOString() : undefined;
  return { startAt, endAt };
}
/** "Etkinlik oluştur": the event and its temporary tables (no QR; on Masalar from the start). */
export function createEvent(s: State, actor: Actor, input: EventInput, ctx: Context) {
  requireEvents(s, actor);
  return once(s, actor, 'event-create', input.requestId, input, () => {
    const name = requiredName(input.name, 60), at = ctx.now.toISOString();
    const { startAt, endAt } = eventTimes(input.day, input.start, input.end);
    assertInt(input.count, 1, 100);
    if (input.capacity !== undefined && input.capacity !== null) assertInt(input.capacity, 1, 100);
    const custom = input.names?.map(n => cleanText(n, 20) ?? '').filter(Boolean);
    if (custom?.length && custom.length !== input.count) throw new DomainError('INVALID_NAMES', `${input.count} masa için ${input.count} ad yazın (şimdi ${custom.length}).`);
    const prefix = cleanText(input.prefix ?? 'D', 12);
    if (!custom?.length && prefix === null) throw new DomainError('INVALID_NAME', 'Masa ön adı en çok 12 harf olabilir.');
    const names = eventTableNames(input.count, prefix || 'D', custom);
    checkNames(s, names);
    const open = s.tables.filter(t => t.event && !s.events?.find(e => e.id === t.event!.id)?.closedAt).length;
    if (open + names.length > MAX_EVENT_TABLES) throw new DomainError('TABLE_LIMIT', `Açık etkinliklerde en çok ${MAX_EVENT_TABLES} geçici masa olabilir.`, 409);
    const id = ctx.id(), capacity = input.capacity ?? undefined;
    const tables: CafeTable[] = names.map(n => ({ id: ctx.id(), name: n, token: '', epoch: 0, accountId: null, event: { id, ...(capacity ? { capacity } : {}) } }));
    const event: CafeEvent = { id, name, day: input.day, start: input.start, ...(input.end ? { end: input.end } : {}), startAt, ...(endAt ? { endAt } : {}), hideNormal: !!input.hideNormal, ...(capacity ? { capacity } : {}),
      tables: tables.map(t => ({ id: t.id, name: t.name, ...(capacity ? { capacity } : {}) })), createdAt: at, by: actor.id, byName: who(s, actor) };
    s.tables.push(...tables); s.events = [...(s.events ?? []), event];
    s.audit.push({ action: 'event.created', actor: actor.id, target: id, at });
    return { id, tables: names.length };
  });
}
/** Name, times and "normal masaları gizle" of an open event. */
export function updateEvent(s: State, actor: Actor, input: { requestId: string; id: string; name: string; day: string; start: string; end?: string | null; hideNormal: boolean }, ctx: Context) {
  requireEvents(s, actor);
  return once(s, actor, 'event-update', input.requestId, input, () => {
    const e = openEvent(s, input.id), { startAt, endAt } = eventTimes(input.day, input.start, input.end);
    e.name = requiredName(input.name, 60); e.day = input.day; e.start = input.start; e.startAt = startAt; e.hideNormal = !!input.hideNormal;
    if (input.end && endAt) { e.end = input.end; e.endAt = endAt; } else { delete e.end; delete e.endAt; }
    for (const r of s.reservations ?? []) if (r.eventId === e.id && r.status === 'booked' && r.day !== e.day) { r.day = e.day; r.at = instantOf(r.day, r.time); }
    s.audit.push({ action: 'event.changed', actor: actor.id, target: e.id, at: ctx.now.toISOString() });
    return { ok: true };
  });
}
/** "Etkinliği başlat": the tables show on Masalar now, before the planned start. */
export function startEvent(s: State, actor: Actor, input: { requestId: string; id: string }, ctx: Context) {
  requireEvents(s, actor);
  return once(s, actor, 'event-start', input.requestId, input, () => {
    const e = openEvent(s, input.id);
    if (!e.startedAt) { e.startedAt = ctx.now.toISOString(); e.startedBy = actor.id; }
    return { startedAt: e.startedAt };
  });
}
/**
 * "Etkinliği kapat" (owner, cashier), never by itself. Refused while a temporary table still has an open bill (the message
 * lists them). Reservations still waiting are marked as not come. The tables leave once their closed bills settled.
 */
export function closeEvent(s: State, actor: Actor, input: { requestId: string; id: string }, ctx: Context) {
  requireEvents(s, actor);
  return once(s, actor, 'event-close', input.requestId, input, () => {
    const e = openEvent(s, input.id), at = ctx.now.toISOString();
    const busy = s.tables.filter(t => t.event?.id === e.id && t.accountId);
    if (busy.length) throw new DomainError('EVENT_OPEN_BILLS', `Önce bu masaların hesaplarını kapatın: ${busy.map(t => t.name).join(', ')}.`, 409);
    const waiting = (s.reservations ?? []).filter(r => r.eventId === e.id && r.status === 'booked');
    for (const r of waiting) markNoShow(r, at, who(s, actor));
    e.closedAt = at; e.closedBy = actor.id; e.closedByName = who(s, actor);
    s.audit.push({ action: 'event.closed', actor: actor.id, target: e.id, at });
    return { closed: true, noShow: waiting.length };
  });
}
/** Renames one temporary table ("D7" → "Sahne önü"); its reservations and the event keep the new name. */
export function renameEventTable(s: State, actor: Actor, input: { requestId: string; tableId: string; name: string }, ctx: Context) {
  requireEvents(s, actor);
  return once(s, actor, 'event-table-name', input.requestId, input, () => {
    const t = s.tables.find(t => t.id === input.tableId && t.event);
    if (!t) throw new DomainError('NOT_FOUND', 'Etkinlik masası bulunamadı.', 404);
    const e = openEvent(s, t.event!.id), name = cleanText(input.name, 20);
    if (!name) throw new DomainError('INVALID_NAME', 'Masa adları 1–20 harf olmalı.');
    checkNames(s, [name], [t.id]);
    t.name = name;
    const entry = e.tables.find(x => x.id === t.id); if (entry) entry.name = name;
    for (const r of s.reservations ?? []) if (r.tableId === t.id && r.status === 'booked') r.tableName = name;
    s.audit.push({ action: 'event.table_renamed', actor: actor.id, target: t.id, at: ctx.now.toISOString() });
    return { ok: true };
  });
}
/** A guest without reservation sits at an empty event table: "Mehmet (rezervasyonsuz)". */
export function seatWalkIn(s: State, actor: Actor, input: { requestId: string; tableId: string; name: string; people?: number }, ctx: Context) {
  floorStaff(s, actor);
  return once(s, actor, 'walk-in', input.requestId, input, () => {
    const t = tableFor(s, input.tableId);
    if (!t.event) throw new DomainError('NOT_EVENT_TABLE', 'Rezervasyonsuz misafir adı etkinlik masalarına yazılır.', 409);
    freeTable(t);
    const a = openAccount(s, t, ctx, { name: requiredName(input.name), walkIn: true, eventId: t.event.id, ...(input.people ? { people: people(input.people) } : {}) });
    return { accountId: a.id };
  });
}
/** Changes the name on an open bill (a seat given to someone else, a typo), or writes one on an event table's bill. */
export function renameGuest(s: State, actor: Actor, input: { requestId: string; accountId: string; name: string; people?: number }, ctx: Context) {
  floorStaff(s, actor);
  return once(s, actor, 'guest-name', input.requestId, input, () => {
    const a = s.accounts.find(a => a.id === input.accountId && a.status === 'open');
    if (!a) throw new DomainError('ACCOUNT_CLOSED', 'Bu hesap kapanmış.', 409);
    const t = s.tables.find(t => t.id === a.tableId), name = requiredName(input.name);
    a.guest = { ...(a.guest ?? { walkIn: true, ...(t?.event ? { eventId: t.event.id } : {}) }), name, ...(input.people ? { people: people(input.people) } : {}) };
    a.version++;
    s.audit.push({ action: 'guest.renamed', actor: actor.id, target: a.id, at: ctx.now.toISOString() });
    return { ok: true };
  });
}
