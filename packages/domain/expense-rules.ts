import type { Expense, ExpenseMethod } from './types.js';
import { midnightToDayStart } from './business-day.js';
// Plain rules shared by the screens, the reports and the server; only the import-free business day, so the browser bundle stays small.
export const expenseMethods: ExpenseMethod[] = ['cash', 'card', 'transfer', 'other'];
export const expenseMethodNames: Record<ExpenseMethod, string> = { cash: 'Nakit', card: 'Kart', transfer: 'Havale / EFT', other: 'Diğer' };
/**
 * Where the money of an expense came from, as the screens ask it: "Kasadan nakit" (the drawer: the gün sonu's expected cash
 * drops), "Kasa dışı nakit" (the owner's pocket, the bank: a gider, never out of the drawer), card, transfer, other.
 * Stored as `method` plus `source: 'outside'` (packages/domain/types.ts Expense), so every older record stays as it was.
 */
export type ExpensePay = 'drawer' | 'outside' | 'card' | 'transfer' | 'other';
export const expensePays: ExpensePay[] = ['drawer', 'outside', 'card', 'transfer', 'other'];
export const expensePayNames: Record<ExpensePay, string> = { drawer: 'Kasadan nakit', outside: 'Kasa dışı nakit (cepten / bankadan)', card: 'Kart', transfer: 'Havale / EFT', other: 'Diğer' };
export const payOf = (e: Pick<Expense, 'method' | 'source'>): ExpensePay => (e.method ?? 'cash') === 'cash' ? (e.source === 'outside' ? 'outside' : 'drawer') : e.method as ExpensePay;
export const payFields = (p: ExpensePay): { method: ExpenseMethod; source?: 'drawer' | 'outside' } => p === 'drawer' ? { method: 'cash', source: 'drawer' } : p === 'outside' ? { method: 'cash', source: 'outside' } : { method: p };
/** The "Yöntem" of a list or the Excel file: "Nakit · kasadan", "Nakit · kasa dışı", "Kart"… ('' for very old records without one). */
export const expenseMethodText = (e: Pick<Expense, 'method' | 'source'>) => !e.method ? '' : e.method === 'cash' ? (e.source === 'outside' ? 'Nakit · kasa dışı' : 'Nakit · kasadan') : expenseMethodNames[e.method];
/** Paid out of the drawer: cash (or no method on old records), not "Kasa dışından", not an automatic one. */
export const fromDrawer = (e: Pick<Expense, 'method' | 'source' | 'auto'>) => (e.method ?? 'cash') === 'cash' && e.source !== 'outside' && !e.auto;
/** "Stok alışı: Kahve 10 kg" (written by Stok → Alış kaydet when the money came "Kasadan" or "Kasa dışından"). */
export const isStockExpense = (e: Pick<Expense, 'description'>) => e.description.startsWith('Stok alışı:');
/** The Giderler card's groups on Satış ve Raporlar. */
export type ExpenseGroup = 'stock' | 'auto' | 'other';
export const expenseGroupNames: Record<ExpenseGroup, string> = { stock: 'Stok alışları', auto: 'Otomatik giderler (kira gibi)', other: 'Diğer giderler' };
export const expenseGroupOf = (e: Pick<Expense, 'description' | 'auto'>): ExpenseGroup => isStockExpense(e) ? 'stock' : e.auto ? 'auto' : 'other';
/** An owner may date an expense back this many days (rent paid last month), never into the future. */
export const EXPENSE_BACKDATE_DAYS = 365;
/**
 * When the money went out: reports count the expense on this day. Older records only have the recording time. Automatic
 * expenses written before the business day started at 05:00 sit at 00:00 of their day; they count from the day's start.
 */
export const expenseAt = (e: Pick<Expense, 'spentAt' | 'createdAt'> & { auto?: unknown }) => { const at = e.spentAt ?? e.createdAt; return e.auto ? midnightToDayStart(at) : at; };
/** Deleted expenses stay as a record (with their changes) but count nowhere. */
export const countedExpense = (e: Pick<Expense, 'deletedAt'>) => !e.deletedAt;

/**
 * "Gün içinde toplam": how many times a cashier's cash expenses of one cash day went over the limit. 0 = not over it;
 * 1 = over it; 2 = over twice the limit; 3 = over four times… Each new step is one notice to the owner, never two for one.
 */
export function expenseDayLevel(total: number, limit: number | null | undefined) {
  if (!limit || limit <= 0 || total <= limit) return 0;
  let level = 1;
  while (level < 30 && total > limit * 2 ** level) level++;
  return level;
}
/** A cash expense paid from the drawer by this person: cash (or no method on old records), counted, not an automatic one. */
export const drawerExpenseBy = (e: Expense, actorId: string) => e.actorId === actorId && countedExpense(e) && fromDrawer(e);
const lira = (kurus: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: kurus % 100 === 0 ? 0 : 2 }).format(kurus / 100);
const clockOf = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
export type ExpenseAlert = { key: string; title: string; text: string };
/**
 * The owner's notices for a cashier's new cash expense: (a) one expense above "Tek seferde", (b) the person's cash expenses of
 * the same cash day crossing "Gün içinde toplam" (once, and again when the total doubles). `dayExpenses`: every expense of
 * that cash day, the new one included. The keys make each notice unique (Notifications.add skips a repeated key).
 */
export function cashierExpenseAlerts(input: { expense: Expense; dayExpenses: Iterable<Expense>; day: string; single?: number | null; dayLimit?: number | null }): ExpenseAlert[] {
  const e = input.expense, out: ExpenseAlert[] = [];
  if (!fromDrawer(e)) return out;
  const tail = 'Kasa ve giderler → Giderler\'de görünür; tutarı yalnız siz düzeltebilirsiniz.';
  if (input.single && e.amount > input.single)
    out.push({ key: `expense-limit:${e.id}`, title: `Kasiyer gideri sınırı aştı: ${lira(e.amount)}`, text: `${e.actorName} · “${e.description}” · ${clockOf(e.createdAt)} · Sınır ${lira(input.single)} (tek seferde). ${tail}` });
  if (input.dayLimit && input.dayLimit > 0) {
    const mine = [...input.dayExpenses].filter(x => drawerExpenseBy(x, e.actorId));
    const seen = new Set<string>(), unique = mine.filter(x => !seen.has(x.id) && seen.add(x.id));
    const total = unique.reduce((n, x) => n + x.amount, 0), before = total - (seen.has(e.id) ? e.amount : 0);
    const level = expenseDayLevel(total, input.dayLimit);
    if (level > expenseDayLevel(before, input.dayLimit))
      out.push({ key: `expense-day:${e.actorId}:${input.day}:${level}`, title: `${e.actorName} bugün ${lira(total)} nakit gider yazdı`, text: `${unique.length} gider · Gün içinde toplam sınırı ${lira(input.dayLimit)}${level > 1 ? ` (sınırın ${2 ** (level - 1)} katından fazla)` : ''} · Son: “${e.description}” ${lira(e.amount)}, ${clockOf(e.createdAt)}. ${tail}` });
  }
  return out;
}
