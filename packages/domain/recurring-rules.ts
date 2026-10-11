import type { ExpenseMethod } from './types.js';
// Plain schedule rules of "Otomatik giderler", shared by the screens and the server; no imports, so the browser bundle stays small.

export type RecurringRepeat =
  /** Every month on `day` (1–31); a shorter month uses its last day (31 → 30 April, 28/29 February). */
  | { every: 'month'; day: number }
  /** Every year on `month`/`day`; 29 February falls on 28 February in other years. */
  | { every: 'year'; month: number; day: number }
  /** Every `days` days, counted from the start day (the start day is the first). */
  | { every: 'days'; days: number }
  /** Every week on `weekday`: 1 Pazartesi … 7 Pazar. */
  | { every: 'week'; weekday: number };
export type RecurringExpense = {
  id: string; name: string; amount: number; method: ExpenseMethod; repeat: RecurringRepeat;
  /** First and (optional) last business day of the rule, YYYY-MM-DD in Turkish dates. */
  start: string; end?: string; active: boolean;
  createdAt: string; updatedAt: string; version: number;
  /** Last business day already looked at; occurrences up to it are done (recorded, or skipped while paused). */
  doneThrough: string;
  /** The most recent expense this rule recorded, and how many in all. */
  last?: { day: string; expenseId: string; at: string }; count?: number;
};
/** Fields the owner sets. */
export type RecurringInput = { name: string; amount: number; method: ExpenseMethod; repeat: RecurringRepeat; start: string; end?: string | null; active: boolean };

export const RECURRING_LIMIT = 50;
/** A computer switched off for a very long time catches up at most this far back (expenses may be dated a year back). */
export const RECURRING_CATCH_UP_DAYS = 365;
export const WEEKDAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
export const MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const DAY = 86400000;
const parts = (day: string) => day.split('-').map(Number) as [number, number, number];
export const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export const monthLength = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** ISO weekday of a date: 1 Pazartesi … 7 Pazar. */
export const weekdayOf = (day: string) => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
/** Turkish business day of an instant (UTC+3 all year, like the reports). */
export const turkishDay = (at: number) => new Date(at + 3 * 3600000).toISOString().slice(0, 10);

/** Whether the schedule falls on this day (start and end are checked by the callers). */
export function falls(repeat: RecurringRepeat, start: string, day: string) {
  const [y, m, d] = parts(day);
  switch (repeat.every) {
    case 'month': return d === Math.min(repeat.day, monthLength(y, m));
    case 'year': return m === repeat.month && d === Math.min(repeat.day, monthLength(y, m));
    case 'week': return weekdayOf(day) === repeat.weekday;
    case 'days': { const n = daysBetween(start, day); return n >= 0 && n % repeat.days === 0; }
  }
}
/** Occurrence days inside [from, to] (inclusive) and inside the rule's own start and end, in date order. */
export function occurrences(rule: Pick<RecurringExpense, 'repeat' | 'start' | 'end'>, from: string, to: string) {
  const first = from > rule.start ? from : rule.start, last = rule.end && rule.end < to ? rule.end : to, out: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) if (falls(rule.repeat, rule.start, day)) out.push(day);
  return out;
}
/** The next day the rule records an expense, from `from` on (inclusive) and after its `doneThrough`; null when paused or ended. */
export function nextOccurrence(rule: Pick<RecurringExpense, 'repeat' | 'start' | 'end' | 'active'> & { doneThrough?: string }, from: string) {
  if (!rule.active) return null;
  const after = rule.doneThrough && rule.doneThrough >= from ? addDays(rule.doneThrough, 1) : from;
  // Every schedule repeats within a year (and every N days is at most 365).
  return occurrences(rule, after, addDays(after, 400))[0] ?? null;
}
/** Days due now: after `doneThrough` up to today, never more than a year back. */
export function dueDays(rule: RecurringExpense, today: string) {
  if (!rule.active) return [];
  const floor = addDays(today, -RECURRING_CATCH_UP_DAYS), from = addDays(rule.doneThrough, 1);
  return occurrences(rule, from > floor ? from : floor, today);
}
/** Plain words for the schedule: "Her ayın 1. günü", "Her yıl 15 Ocak", "14 günde bir", "Her hafta Pazartesi". */
export function repeatText(repeat: RecurringRepeat) {
  switch (repeat.every) {
    case 'month': return repeat.day >= 29 ? `Her ayın ${repeat.day}. günü (kısa aylarda son gün)` : `Her ayın ${repeat.day}. günü`;
    case 'year': return `Her yıl ${repeat.day} ${MONTH_NAMES[repeat.month - 1]}`;
    case 'days': return repeat.days === 1 ? 'Her gün' : `${repeat.days} günde bir`;
    case 'week': return `Her hafta ${WEEKDAY_NAMES[repeat.weekday - 1]}`;
  }
}
/** The expense recorded for one rule on one day; the same id every time, so a day can never be recorded twice. */
export const autoExpenseId = (ruleId: string, day: string) => `auto-${ruleId}-${day}`;
