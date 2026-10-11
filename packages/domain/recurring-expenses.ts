import type { Actor, Context, Expense, State } from './types.js';
import { DomainError, once, requireRole } from './engine.js';
import { businessDay, dayStart, DAY_MS } from './history.js';
import { expenseMethods } from './expense-rules.js';
import { inClosedYear } from './closed-year.js';
import { autoExpenseId, dueDays, isDay, monthLength, RECURRING_LIMIT, type RecurringExpense, type RecurringInput, type RecurringRepeat } from './recurring-rules.js';
export * from './recurring-rules.js';

/**
 * "Otomatik giderler" (Ayarlar → Giderler): rent, wages, subscriptions the café pays on a schedule. The café server records
 * the real expense on each due day by itself (server/recurring-expenses.ts), in Turkish dates. A rule never fills days
 * before it was made, a paused rule never fills its paused days later, and every occurrence is made once: the rule keeps
 * the last day it has looked at (`doneThrough`, moved in the same transaction as the expenses), and the expense id is the
 * rule and the day (`auto-<rule>-<day>`), so even a second run over the same day finds it and stops.
 */
function checked(b: RecurringInput) {
  const name = b.name.trim();
  if (!name || name.length > 80) throw new DomainError('INVALID_NAME', 'Gidere bir ad verin (ör. Kira, en fazla 80 karakter).');
  if (!Number.isInteger(b.amount) || b.amount < 1 || b.amount > 100_000_000) throw new DomainError('INVALID_AMOUNT', 'Tutarı yazın (en fazla 1.000.000 TL).');
  if (!expenseMethods.includes(b.method)) throw new DomainError('INVALID_METHOD', 'Ödeme yöntemini seçin.');
  if (!isDay(b.start)) throw new DomainError('INVALID_DATE', 'Geçerli bir başlangıç tarihi seçin.');
  if (b.end && (!isDay(b.end) || b.end < b.start)) throw new DomainError('INVALID_DATE', 'Bitiş tarihi başlangıçtan önce olamaz.');
  const r = b.repeat, int = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
  // A yearly date may be 29 February (a leap year's month length); it falls on the 28th in other years.
  const ok = r.every === 'month' ? int(r.day, 1, 31) : r.every === 'year' ? int(r.month, 1, 12) && int(r.day, 1, monthLength(2028, r.month)) : r.every === 'days' ? int(r.days, 1, 365) : r.every === 'week' ? int(r.weekday, 1, 7) : false;
  if (!ok) throw new DomainError('INVALID_REPEAT', 'Tekrar sıklığını kontrol edin.');
  const repeat: RecurringRepeat = r.every === 'month' ? { every: 'month', day: r.day } : r.every === 'year' ? { every: 'year', month: r.month, day: r.day } : r.every === 'days' ? { every: 'days', days: r.days } : { every: 'week', weekday: r.weekday };
  return { name, amount: b.amount, method: b.method, repeat, start: b.start, end: b.end || undefined, active: b.active };
}

/**
 * Owner adds or changes a rule (`id` + `version` for a change). A new rule starts looking from today: days before it was
 * made are never filled. Switching a paused rule back on also starts from today, so its paused days stay empty.
 */
export function saveRecurring(s: State, actor: Actor, b: { requestId: string; id?: string; version?: number } & RecurringInput, ctx: Context) {
  requireRole(s, actor, ['owner']);
  return once(s, actor, 'recurring-expense', b.requestId, b, () => {
    const { end, ...fields } = checked(b), at = ctx.now.toISOString(), yesterday = businessDay(ctx.now.getTime() - DAY_MS);
    const list = (s.recurringExpenses ??= []);
    if (!b.id) {
      if (list.length >= RECURRING_LIMIT) throw new DomainError('RECURRING_LIMIT', `En fazla ${RECURRING_LIMIT} otomatik gider eklenebilir.`, 409);
      const rule: RecurringExpense = { id: ctx.id(), ...fields, ...(end ? { end } : {}), createdAt: at, updatedAt: at, version: 1, doneThrough: yesterday };
      list.push(rule); s.audit.push({ action: 'recurring.created', actor: actor.id, target: rule.id, at });
      return rule;
    }
    const rule = list.find(r => r.id === b.id);
    if (!rule) throw new DomainError('NOT_FOUND', 'Otomatik gider bulunamadı.', 404);
    if (rule.version !== b.version) throw new DomainError('VERSION_CONFLICT', 'Bu otomatik gider başka bir ekranda değişti. Listeyi yenileyin.', 409);
    const resumed = !rule.active && fields.active;
    Object.assign(rule, fields, { updatedAt: at, version: rule.version + 1 });
    if (end) rule.end = end; else delete rule.end;
    if (resumed && rule.doneThrough < yesterday) rule.doneThrough = yesterday;
    s.audit.push({ action: 'recurring.edited', actor: actor.id, target: rule.id, at });
    return rule;
  });
}
/** Removes a rule; expenses it already recorded stay (they can be corrected or deleted like any expense). */
export function deleteRecurring(s: State, actor: Actor, b: { requestId: string; id: string; version: number }, ctx: Context) {
  requireRole(s, actor, ['owner']);
  return once(s, actor, 'recurring-expense-delete', b.requestId, b, () => {
    const rule = s.recurringExpenses?.find(r => r.id === b.id);
    if (!rule) throw new DomainError('NOT_FOUND', 'Otomatik gider bulunamadı.', 404);
    if (rule.version !== b.version) throw new DomainError('VERSION_CONFLICT', 'Bu otomatik gider başka bir ekranda değişti. Listeyi yenileyin.', 409);
    s.recurringExpenses = s.recurringExpenses!.filter(r => r.id !== b.id);
    s.audit.push({ action: 'recurring.deleted', actor: actor.id, target: rule.id, at: ctx.now.toISOString() });
    return { ok: true };
  });
}

/** Whether any rule has a day due now (read-only; the server checks this before opening a write). */
export const anyDue = (s: State, now: Date) => { const today = businessDay(now.getTime()); return (s.recurringExpenses ?? []).some(r => dueDays(r, today).length > 0); };

/**
 * Records every due occurrence as a real expense (dated on its day, 00:00 Turkish time) and moves each rule's
 * `doneThrough` to today. `exists`: whether an expense with this id is already in long-term history, so a day is never
 * recorded twice. Returns what was recorded, for the owner's notifications.
 */
export function runRecurring(s: State, now: Date, exists: (id: string) => boolean = () => false) {
  const today = businessDay(now.getTime()), at = now.toISOString(), made: { rule: RecurringExpense; expense: Expense }[] = [];
  for (const rule of s.recurringExpenses ?? []) {
    const days = dueDays(rule, today);
    if (!days.length) continue;
    for (const day of days) {
      const id = autoExpenseId(rule.id, day);
      if (s.expenses?.some(e => e.id === id) || exists(id)) continue;
      // A day of a closed (packaged) year takes nothing any more: such a missed occurrence (the computer off from before New
      // Year until after 1 February) counts today, like a refund of a closed year's bill (packages/domain/closed-year.ts).
      const late = inClosedYear(s.closedThrough, day);
      const expense: Expense = { id, amount: rule.amount, description: rule.name, actorId: 'auto', actorName: 'Otomatik', createdAt: at, ...(late ? {} : { spentAt: new Date(dayStart(day)).toISOString() }), method: rule.method, auto: { ruleId: rule.id, day } };
      (s.expenses ??= []).push(expense);
      s.audit.push({ action: 'expense.recorded_auto', actor: 'auto', target: id, at });
      rule.last = { day, expenseId: id, at }; rule.count = (rule.count ?? 0) + 1;
      made.push({ rule, expense });
    }
    rule.doneThrough = today;
  }
  return made;
}
