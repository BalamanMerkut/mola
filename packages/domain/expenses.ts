import type { Actor, Context, Expense, ExpenseMethod, State } from './types.js';
import { assertInt, DomainError, once, requireRole } from './engine.js';
import { businessDay, dayStart, DAY_MS } from './history.js';
import { EXPENSE_BACKDATE_DAYS, expenseAt, expenseMethods } from './expense-rules.js';
import { assertOpenDay } from './closed-year.js';
export { countedExpense, EXPENSE_BACKDATE_DAYS, expenseAt, expenseMethodNames, expenseMethods } from './expense-rules.js';

/** `source`: a cash expense paid from the drawer (default) or "Kasa dışından" (the owner's pocket, the bank). Cash only. */
type ExpenseInput = { amount: number; description: string; day?: string; method?: ExpenseMethod; source?: 'drawer' | 'outside' };
/** Only a cash expense has a source; "drawer" is the default and is never written (older records read the same). */
const outside = (method: ExpenseMethod | undefined, source: ExpenseInput['source']) => (method ?? 'cash') === 'cash' && source === 'outside' ? { source: 'outside' as const } : {};
/** A chosen business day becomes that day at the current clock time, so "yesterday's" expense sits inside yesterday. */
function spentAt(day: string | undefined, now: Date) {
  const today = businessDay(now.getTime());
  if (!day || day === today) return now.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(dayStart(day)) || businessDay(dayStart(day)) !== day) throw new DomainError('INVALID_DATE', 'Geçerli bir tarih seçin.');
  if (day > today) throw new DomainError('INVALID_DATE', 'Gider tarihi ileri bir gün olamaz.');
  if (day < businessDay(now.getTime() - EXPENSE_BACKDATE_DAYS * DAY_MS)) throw new DomainError('INVALID_DATE', 'Gider en fazla 1 yıl öncesine tarihlenebilir.');
  return new Date(dayStart(day) + (now.getTime() - dayStart(today))).toISOString();
}
function checked(b: ExpenseInput) {
  assertInt(b.amount, 1, 100_000_000);
  const description = b.description.trim();
  if (!description || description.length > 500) throw new DomainError('INVALID_DESCRIPTION', 'Gider açıklamasını yazın (en fazla 500 karakter).');
  if (b.method !== undefined && !expenseMethods.includes(b.method)) throw new DomainError('INVALID_METHOD', 'Ödeme yöntemini seçin.');
  if (b.source !== undefined && b.source !== 'drawer' && b.source !== 'outside') throw new DomainError('INVALID_METHOD', 'Paranın nereden çıktığını seçin.');
  return description;
}

export function recordExpense(s: State, actor: Actor, b: { requestId: string } & ExpenseInput, ctx: Context) {
  // Cashiers record till payouts (always cash, today); owners also record rent, wages, bills and the like, dated and with a method.
  // The Müdür records like a cashier (cash, today); editing and deleting stay with the owner (change below).
  requireRole(s, actor, ['cashier', 'manager', 'owner']);
  return once(s, actor, 'expense', b.requestId, b, () => {
    // The Müdür dates and picks the method like the owner (Stok alışı kartla ödenmiş olabilir); only editing stays the owner's.
    const description = checked(b), owner = actor.role === 'owner' || actor.role === 'manager';
    const user = s.staffUsers?.find(u => u.id === actor.id);
    const createdAt = ctx.now.toISOString(), at = owner ? spentAt(b.day, ctx.now) : createdAt;
    // A closed (packaged) year takes no back-dated expense (packages/domain/closed-year.ts).
    assertOpenDay(s.closedThrough, businessDay(at));
    const method = owner ? b.method ?? 'cash' : 'cash';
    // The cashier says where the cash came from too: the drawer, or outside it (paid from someone's pocket).
    const expense: Expense = { id: ctx.id(), amount: b.amount, description, actorId: actor.id, actorName: user?.name ?? 'Kasiyer', createdAt, ...(at !== createdAt ? { spentAt: at } : {}), method, ...outside(method, b.source) };
    (s.expenses ??= []).push(expense);
    s.audit.push({ action: 'expense.recorded', actor: actor.id, target: expense.id, at: createdAt });
    return expense;
  });
}

/**
 * Owner's correction or removal of an expense. It may already be in long-term history (`stored`, read by the server in the
 * same transaction); the changed copy goes back to the snapshot and replaces the stored row when it is persisted.
 * `version` is the number of earlier changes the owner saw, so two screens cannot overwrite each other silently.
 */
function change(s: State, actor: Actor, id: string, version: number, stored: Expense | undefined, ctx: Context, apply: (e: Expense, before: Expense) => 'edited' | 'deleted') {
  requireRole(s, actor, ['owner']);
  const live = s.expenses?.find(e => e.id === id), found = live ?? stored;
  if (!found) throw new DomainError('NOT_FOUND', 'Gider kaydı bulunamadı.', 404);
  if (found.deletedAt) throw new DomainError('EXPENSE_DELETED', 'Bu gider silinmiş.', 409);
  if ((found.changes?.length ?? 0) !== version) throw new DomainError('VERSION_CONFLICT', 'Gider başka bir ekranda değişti. Listeyi yenileyin.', 409);
  // An expense of a closed year stays as it is; none is moved into one either.
  assertOpenDay(s.closedThrough, businessDay(expenseAt(found)));
  const next: Expense = structuredClone(found), at = ctx.now.toISOString();
  const kind = apply(next, found);
  assertOpenDay(s.closedThrough, businessDay(expenseAt(next)));
  const by = s.staffUsers?.find(u => u.id === actor.id)?.name ?? 'İşletme sahibi';
  next.changes = [...(found.changes ?? []), { at, by, kind, before: { amount: found.amount, description: found.description, spentAt: expenseAt(found), ...(found.method ? { method: found.method } : {}), ...(found.source ? { source: found.source } : {}) } }];
  if (live) Object.assign(live, next); else (s.expenses ??= []).push(next);
  s.audit.push({ action: `expense.${kind}`, actor: actor.id, target: id, at });
  return next;
}
export function editExpense(s: State, actor: Actor, b: { requestId: string; id: string; version: number } & ExpenseInput, ctx: Context, stored?: Expense) {
  return once(s, actor, 'expense-edit', b.requestId, b, () => {
    const description = checked(b);
    return change(s, actor, b.id, b.version, stored, ctx, (e, before) => {
      // An unchanged date keeps its exact time; a new date is checked like a new record (up to a year back, never ahead).
      if (b.day && b.day !== businessDay(expenseAt(before))) e.spentAt = spentAt(b.day, ctx.now);
      e.amount = b.amount; e.description = description; if (b.method) e.method = b.method;
      // "Kasadan" ↔ "Kasa dışından" can be corrected afterwards (a closing already counted keeps its own figures).
      if (b.method || b.source) { delete e.source; Object.assign(e, outside(e.method, b.source ?? before.source)); }
      return 'edited';
    });
  });
}
export function deleteExpense(s: State, actor: Actor, b: { requestId: string; id: string; version: number }, ctx: Context, stored?: Expense) {
  return once(s, actor, 'expense-delete', b.requestId, b, () => change(s, actor, b.id, b.version, stored, ctx, e => {
    e.deletedAt = ctx.now.toISOString(); e.deletedBy = s.staffUsers?.find(u => u.id === actor.id)?.name ?? 'İşletme sahibi';
    return 'deleted';
  }));
}
