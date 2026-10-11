import { cashDayOf, cashDayStart, TIME_PATTERN, type CashShiftSettings, type ShiftPlan, type TipRecord, type TipRule } from './cash.js';
import type { SoundEvent } from './sound-catalog.js';

/*
 * Vardiya takibi and bahşiş: plain rules shared by the screens, the reports and the server (no server-only imports).
 * A shift starts and ends with the one-time code shown at the counter (server/shifts.ts). Shifts left open end at the day's
 * cash closing or at 05:00 ("Kapanışta kendiliğinden bitti"); the owner may correct the times, the earlier ones are kept.
 */
export type ShiftEnd = 'manual' | 'closing' | 'cutoff';
export type ShiftChange = { at: string; by: string; before: { startAt: string; endAt?: string }; note: string };
export type Shift = { id: string; userId: string; name: string; role: string; day: string; startAt: string; endAt?: string; endKind?: ShiftEnd; changes?: ShiftChange[] };
export const autoEnded = (s: Pick<Shift, 'endKind'>) => s.endKind === 'closing' || s.endKind === 'cutoff';
export const SHIFT_CODE_LENGTH = 6;
/** Wrong codes allowed per employee before a 5-minute lock. */
export const SHIFT_CODE_TRIES = 5, SHIFT_LOCK_MS = 5 * 60_000;

/**
 * Vardiya per role (Ayarlar → Vardiya): the owner ticks which roles start a shift with the counter's code. Missing = every
 * one of them (as before the choice existed). Unticked roles work without the gate; their hours in Personel ve bahşiş come
 * from their first and last action of the day ("tahmini"). The owner never starts a shift.
 */
export const SHIFT_ROLES = ['waiter', 'cashier', 'kitchen', 'manager'] as const;
export type ShiftRole = typeof SHIFT_ROLES[number];
export const shiftRoleNames: Record<ShiftRole, string> = { waiter: 'Garson', cashier: 'Kasiyer', kitchen: 'Mutfak', manager: 'Müdür' };
export const shiftRolesOf = (s?: Pick<CashShiftSettings, 'shiftRoles'>): ShiftRole[] => s?.shiftRoles ? SHIFT_ROLES.filter(r => s.shiftRoles!.includes(r)) : [...SHIFT_ROLES];
/** Must this role start a shift before it may change anything? */
export const shiftRequired = (s: Pick<CashShiftSettings, 'shiftTracking' | 'shiftRoles'> | undefined, role: string) => !!s?.shiftTracking && shiftRolesOf(s).includes(role as ShiftRole);

/** An order as the pre-shift notice reads it (PublicOrder fits). */
type BacklogOrder = { status: string; createdAt: string; external?: unknown; accountId?: string; takeaway?: { tableId: string } };
/**
 * "Vardiya başlamadan N sipariş geldi": what reached this role while its shift gate was closed (arrived before the shift
 * started) and still waits for it, with the one sound to play once. Kitchen: new orders (and QR orders to approve, platform
 * orders); waiter: ready orders to serve and QR orders to approve (`mine` keeps those of the waiter's own or unassigned
 * tables when garson ataması is on); cashier: platform orders waiting for Kabul; Müdür: approvals and platform orders.
 * `waiting`: platform orders still waiting for Kabul (StaffSnapshot.externalOrders).
 */
export function preShiftBacklog(role: string, startAt: string, orders: BacklogOrder[], waiting: { stage?: string; receivedAt?: string }[] = [], mine: (o: BacklogOrder) => boolean = () => true): { count: number; event: SoundEvent | null } {
  const start = Date.parse(startAt), before = (at?: string) => !at || Date.parse(at) < start;
  const platform = (o: BacklogOrder) => typeof o.external === 'object' && o.external !== null;
  const found = new Map<SoundEvent, number>(), add = (e: SoundEvent) => found.set(e, (found.get(e) ?? 0) + 1);
  for (const o of orders) {
    if (!before(o.createdAt)) continue;
    if (role === 'kitchen') { if (o.status === 'new') add(platform(o) ? 'externalOrder' : 'kitchen'); else if (o.status === 'awaiting_approval') add('approval'); }
    else if (role === 'waiter') { if (!mine(o)) continue; if (o.status === 'ready' && !platform(o)) add('ready'); else if (o.status === 'awaiting_approval') add('approval'); }
    else if (role === 'manager' && o.status === 'awaiting_approval') add('approval');
  }
  if (role !== 'waiter') for (const w of waiting) if ((!w.stage || w.stage === 'pending') && before(w.receivedAt)) add('externalOrder');
  const priority: SoundEvent[] = role === 'kitchen' ? ['kitchen', 'approval', 'externalOrder'] : role === 'waiter' ? ['ready', 'approval'] : ['approval', 'externalOrder'];
  const count = [...found.values()].reduce((n, v) => n + v, 0);
  return { count, event: priority.find(e => found.has(e)) ?? null };
}

/** 1 = Monday … 7 = Sunday, for a Turkish date. */
export const weekdayOf = (day: string) => { const d = new Date(`${day}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
export const weekdayNames = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
export function validPlan(p: ShiftPlan) {
  return TIME_PATTERN.test(p.start) && TIME_PATTERN.test(p.end) && p.start !== p.end && p.days.length > 0 && p.days.length <= 7 && new Set(p.days).size === p.days.length && p.days.every(d => Number.isInteger(d) && d >= 1 && d <= 7);
}
/** The planned start (ms) on a cash day, or null when the plan has no shift that weekday. Before 05:00 means the next morning. */
export function plannedStart(plan: ShiftPlan | undefined, day: string) {
  if (!plan || !plan.days.includes(weekdayOf(day))) return null;
  const at = Date.parse(`${day}T${plan.start}:00+03:00`);
  return at < cashDayStart(day) ? at + 86400_000 : at;
}
/** "N dk geç": minutes after the planned start (0 when on time or early; null without a plan for that day). */
export function lateMinutes(shift: Pick<Shift, 'startAt' | 'day'>, plan: ShiftPlan | undefined) {
  const planned = plannedStart(plan, shift.day);
  if (planned === null) return null;
  return Math.max(0, Math.floor((Date.parse(shift.startAt) - planned) / 60_000));
}
export const shiftMinutes = (s: Pick<Shift, 'startAt' | 'endAt'>, now: number) => Math.max(0, Math.round(((s.endAt ? Date.parse(s.endAt) : now) - Date.parse(s.startAt)) / 60_000));
export const hoursText = (minutes: number) => `${Math.floor(minutes / 60).toLocaleString('tr-TR')} sa ${String(minutes % 60).padStart(2, '0')} dk`;

/** Splits kuruş by weights; remainders go to the largest fractions so the parts add up exactly. */
export function splitAmount(amount: number, weights: [string, number][]) {
  const out = new Map<string, number>(), usable = weights.filter(([, w]) => w > 0), total = usable.reduce((n, [, w]) => n + w, 0);
  if (!usable.length || total <= 0) return out;
  const parts = usable.map(([id, w]) => { const exact = amount * w / total; return { id, base: Math.floor(exact), rest: exact - Math.floor(exact) }; });
  let left = amount - parts.reduce((n, p) => n + p.base, 0);
  for (const p of [...parts].sort((a, b) => b.rest - a.rest || a.id.localeCompare(b.id))) { if (left <= 0) break; p.base++; left--; }
  for (const p of parts) if (p.base) out.set(p.id, (out.get(p.id) ?? 0) + p.base);
  return out;
}
/**
 * Bahşiş dağıtımı. `workers`: per cash day, who worked and for how many minutes (shifts, or estimated from activity).
 * - equal: each tip is split equally among that day's workers;
 * - hours: by the minutes each worked that day (equal when nobody has minutes);
 * - orders: to the staff who took the paid account's orders, by their order amounts; a QR-only account falls back to equal.
 * A tip of a day with nobody working stays "dağıtılmadı".
 */
export function distributeTips(tips: Pick<TipRecord, 'amount' | 'at' | 'takers'>[], rule: TipRule, workers: Map<string, Map<string, number>>) {
  const shares = new Map<string, number>(); let unassigned = 0;
  const add = (m: Map<string, number>) => { for (const [id, v] of m) shares.set(id, (shares.get(id) ?? 0) + v); };
  for (const t of tips) {
    const day = workers.get(cashDayOf(t.at)) ?? new Map<string, number>();
    const equal: [string, number][] = [...day.keys()].map(id => [id, 1]);
    let weights: [string, number][] = equal;
    if (rule === 'hours' && [...day.values()].some(v => v > 0)) weights = [...day.entries()];
    if (rule === 'orders' && t.takers.some(([, v]) => v > 0)) weights = t.takers;
    const split = splitAmount(t.amount, weights);
    if (!split.size) unassigned += t.amount; else add(split);
  }
  return { shares, unassigned };
}
