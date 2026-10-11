/*
 * "Uzun süredir sipariş verilmeyen masa için garsona hatırlat" (11 Ekim, hafta sonu bulgusu 4). A table whose bill is open
 * and where nothing happened for N minutes (no new order, no call, nobody went there) gets a gentle reminder on the waiters'
 * phones: "Masa 5: 45 dakikadır yeni sipariş yok. Bir isteği var mı?" with "Gittim". With garson ataması on only the
 * table's own waiter sees it (a table nobody has: every waiter). Not while the kitchen still owes the table something, and
 * not while the guest asked for the bill (that call rings by itself). "Gittim" (or answering a call of the table) starts
 * the N minutes again, so it comes back at most every N minutes. Setting: Ayarlar → Sipariş ve mutfak → Sipariş ve onay
 * (State.tableReminderMinutes; missing = 45, 0 = off). Browser-safe: plain rules.
 */
import type { State } from './types.js';
import { ringsHere, type AssignmentView } from './assignments.js';

export const DEFAULT_REMINDER_MINUTES = 45, MIN_REMINDER_MINUTES = 10, MAX_REMINDER_MINUTES = 240;
/** "Gittim": a waiter went to this table session (`epoch`) at `at`. */
export type TableCheck = { tableId: string; epoch: number; at: string };
/** One reminder on a waiter's phone. `since`: the last thing that happened at the table (the reminder's identity). */
export type TableReminder = { tableId: string; tableName: string; epoch: number; minutes: number; since: string };
export const reminderMinutes = (s: Pick<State, 'tableReminderMinutes'>) => s.tableReminderMinutes ?? DEFAULT_REMINDER_MINUTES;
/** What the waiter reads. */
export const reminderText = (r: Pick<TableReminder, 'tableName' | 'minutes'>) => `${r.tableName}: ${r.minutes} dakikadır yeni sipariş yok. Bir isteği var mı?`;

/** The reminders due now, for one waiter when `view` (garson ataması) is given. */
export function dueReminders(s: State, now: number, view?: AssignmentView): TableReminder[] {
  const minutes = reminderMinutes(s);
  if (!minutes) return [];
  // The calls of live table sessions (service-calls.ts activeCalls, without its server-only imports).
  const calls = (s.serviceCalls ?? []).filter(c => s.tables.some(t => t.id === c.tableId && t.epoch === c.epoch)), out: TableReminder[] = [];
  for (const t of s.tables) {
    if (t.takeaway || !t.accountId || !ringsHere(view, t.id)) continue;
    const account = s.accounts.find(a => a.id === t.accountId && a.status === 'open');
    if (!account) continue;
    const here = calls.filter(c => c.tableId === t.id);
    if (here.some(c => c.kind === 'bill')) continue;
    const orders = s.orders.filter(o => o.accountId === account.id && o.status !== 'cancelled');
    if (orders.some(o => ['awaiting_approval', 'new', 'preparing', 'ready'].includes(o.status))) continue;
    const check = s.tableChecks?.find(c => c.tableId === t.id && c.epoch === t.epoch);
    const last = Math.max(Date.parse(account.openedAt), ...orders.map(o => Date.parse(o.updatedAt ?? o.createdAt)), ...orders.flatMap(o => (o.changes ?? []).map(c => Date.parse(c.at))), ...here.map(c => Date.parse(c.createdAt)), check ? Date.parse(check.at) : 0);
    const idle = Math.floor((now - last) / 60_000);
    if (idle >= minutes) out.push({ tableId: t.id, tableName: t.name, epoch: t.epoch, minutes: idle, since: new Date(last).toISOString() });
  }
  return out;
}
/** Notes that someone went to the table now; one entry per table, only for live table sessions. */
export function checkTable(s: State, tableId: string, epoch: number, at: string) {
  s.tableChecks = [...(s.tableChecks ?? []).filter(c => c.tableId !== tableId && s.tables.some(t => t.id === c.tableId && t.epoch === c.epoch)), { tableId, epoch, at }];
}
