/**
 * Ajanda: the owner's notes per calendar day (Turkish time), with an optional time and an optional reminder.
 * A "Satış notu" is the same kind of note written from Satış ve Raporlar (kind 'sales'); both screens read the same notes.
 */
export type ReminderOffset = 'same' | 'day' | 'week';
export type AgendaReminder = { offset: ReminderOffset; time: string };
export type AgendaNote = {
  id: string; day: string; time?: string; title: string; text: string;
  /** 'sales': written from the daily sales chart ("Satış notu"); 'agenda': written in Ajanda. */
  kind: 'agenda' | 'sales';
  reminder?: AgendaReminder;
  createdAt: string; updatedAt: string; by: string;
};
export const REMINDER_OFFSETS: Record<ReminderOffset, string> = { same: 'O gün', day: '1 gün önce', week: '1 hafta önce' };
const OFFSET_DAYS: Record<ReminderOffset, number> = { same: 0, day: 1, week: 7 };
export const AGENDA_ZONE = 'Europe/Istanbul';
export const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isDay = (day: string) => DAY_PATTERN.test(day) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;

/** The calendar day in Turkey for an instant ("2026-10-04"). */
export function istanbulDay(at: Date | number = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: AGENDA_ZONE }).format(new Date(at));
}
export function shiftDay(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
/** Minutes the zone is ahead of UTC at an instant (Turkey: +180 since 2016; computed, not assumed). */
function zoneOffset(ms: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: AGENDA_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((local - Math.floor(ms / 1000) * 1000) / 60000);
}
/** The instant of a wall-clock day and time in Turkey. */
export function istanbulInstant(day: string, time: string) {
  const [h, m] = time.split(':').map(Number), wall = Date.parse(`${day}T00:00:00Z`) + (h * 60 + m) * 60000;
  let guess = wall - zoneOffset(wall) * 60000;
  guess = wall - zoneOffset(guess) * 60000;
  return guess;
}
/** When the reminder of a note is due (ms), or undefined without one. */
export function reminderDue(note: Pick<AgendaNote, 'day' | 'reminder'>) {
  if (!note.reminder) return undefined;
  return istanbulInstant(shiftDay(note.day, -OFFSET_DAYS[note.reminder.offset]), note.reminder.time);
}
export function reminderText(r: AgendaReminder) { return `${REMINDER_OFFSETS[r.offset]} · ${r.time}`; }
/** "4 Ekim 2026 Pazar" */
export function longDay(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', timeZone: 'UTC' });
}
/** Notes of one day in reading order: timed notes by time first, then the rest by when they were written. */
export function sortNotes(notes: AgendaNote[]) {
  return [...notes].sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.createdAt.localeCompare(b.createdAt));
}
/**
 * The 42 days (6 weeks, Monday first) shown for a month: "2026-10" → 28 Eylül … 8 Kasım.
 */
export function monthGrid(month: string) {
  const first = `${month}-01`, weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7, start = shiftDay(first, -weekday);
  return Array.from({ length: 42 }, (_, i) => shiftDay(start, i));
}
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + by, 15));
  return d.toISOString().slice(0, 7);
}
export const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
