import type { ArchivedAccount, Order, Payment, State } from './types.js';
import { paymentLedger } from './payment-adjustments.js';
import { reportRange } from './reports.js';
import { DomainError } from './engine.js';
import { DAY_MS, dayStart } from './business-day.js';
import { unitsCost } from './deals.js';

// İade ve düzeltme: one statement of payments, newest first, like a bank statement. In memory (tests, tools) one State
// holds everything; the server walks its per-day payment lists backwards and stops once a page is full
// (server/history.ts paymentLedger), so a page costs the same for "today" and for "all time".
export const LEDGER_PAGE = 50, LEDGER_MAX_LIMIT = 500;
/** Up to this many days the header totals come with the page; longer ranges count them in a second, yielding request. */
export const LEDGER_EXACT_DAYS = 31;
export type LedgerFilter = 'all' | 'cash' | 'card' | 'corrected';
/**
 * `before`: the `next` cursor of the previous page ("Daha fazla göster"); new payments on top never shift it. A cursor
 * with an empty id ("<time>|") marks where a long scan paused at a day boundary: the next page goes on from there.
 */
export type LedgerQuery = { from: string; to: string; q?: string; filter?: LedgerFilter; limit?: number; before?: string };
/** `total`/`amount` cover every matching row of the range; null when the server counts them separately (long ranges). */
export type PaymentLedgerPage = { from: string; to: string; total: number | null; amount: number | null; rows: LedgerRow[]; next: string | null };

const validDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
/** Any range of business days (inclusive), or all time ("all" for both ends). */
export function ledgerRange(from: string, to: string) {
  if (from === 'all' && to === 'all') return reportRange(from, to);
  if (!validDay(from) || !validDay(to) || from > to) throw new DomainError('INVALID_RANGE', 'Geçerli bir başlangıç ve bitiş tarihi seçin.');
  return { start: dayStart(from), end: dayStart(to) + DAY_MS };
}
/** Whether a range is short enough for its totals to be counted with the page. */
export const ledgerShort = (start: number, end: number) => Number.isFinite(start) && Number.isFinite(end) && end - start <= LEDGER_EXACT_DAYS * DAY_MS;
/** A validated query: range, filter, page size, cursor and search. */
export function ledgerQuery(query: LedgerQuery) {
  const { start, end } = ledgerRange(query.from, query.to);
  const filter = query.filter ?? 'all', limit = query.limit ?? LEDGER_PAGE;
  if (!['all', 'cash', 'card', 'corrected'].includes(filter) || !Number.isSafeInteger(limit) || limit < 1 || limit > LEDGER_MAX_LIMIT) throw new DomainError('INVALID_FILTER', 'Geçerli bir kayıt filtresi seçin.');
  const cut = query.before === undefined ? undefined : /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|(.*)$/.exec(query.before);
  if (cut === null) throw new DomainError('INVALID_FILTER', 'Liste değişti. Listeyi yenileyin.');
  return { start, end, filter, limit, cursor: cut ? { createdAt: cut[1], id: cut[2] } : null, match: ledgerMatcher(query.q ?? ''), plain: filter === 'all' && !(query.q ?? '').trim() };
}
export type LedgerSpec = ReturnType<typeof ledgerQuery>;
/** Wall-clock time in Türkiye (fixed UTC+3, like businessDay). */
export const ledgerClock = (at: string) => new Date(Date.parse(at) + 3 * 3600000).toISOString().slice(11, 16);
const words = (v: string) => v.toLocaleLowerCase('tr-TR').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Every typed word must start a word of the table name; numbers compare as numbers, so "1" finds "Masa 01" but not "Masa 12". */
function tableMatches(name: string, terms: string[]) {
  const tokens = words(name);
  return terms.every(t => tokens.some(w => /^\d+$/.test(t) ? /^\d+$/.test(w) && Number(w) === Number(t) : w.startsWith(t)));
}
/**
 * One search box: "14:3" is a time (prefix of HH:MM), "35,50" / "₺35" / "1.250" an amount, "12" a table number or an
 * amount in whole lira, anything else words of the table name ("Masa 12", "bahçe").
 */
export function ledgerMatcher(text: string): (row: { tableName: string; amount: number; createdAt: string }) => boolean {
  const q = text.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
  if (!q) return () => true;
  const time = /^(\d{1,2}):(\d{0,2})$/.exec(q);
  if (time) { const prefix = `${time[1].padStart(2, '0')}:${time[2]}`; return r => ledgerClock(r.createdAt).startsWith(prefix); }
  // Turkish writing: comma for kuruş, dot for thousands; "35.50" is still read as kuruş because thousands need 3 digits.
  const money = /^(₺ ?)?(\d{1,7}|\d{1,3}(?:\.\d{3})+)(?:[,.](\d{1,2}))?( ?(?:tl|₺))?$/.exec(q);
  const terms = words(q);
  if (!money) return r => tableMatches(r.tableName, terms);
  const lira = Number(money[2].replace(/\./g, '')) * 100, exact = money[3] !== undefined;
  const amount = exact ? lira + Number(money[3].padEnd(2, '0')) : lira;
  const bare = !money[1] && !money[4] && !exact && !money[2].includes('.');
  return r => (exact ? r.amount === amount : r.amount >= amount && r.amount < amount + 100) || (bare && tableMatches(r.tableName, terms));
}
export const newer = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) => a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id > b.id);
export const ledgerCursor = (r: { createdAt: string; id: string }) => `${r.createdAt}|${r.id}`;

/** The matching rows of [start, end) in `s`, newest first. */
export function ledgerRows(s: State, start: number, end: number, spec: Pick<LedgerSpec, 'filter' | 'match'>) {
  const { filter, match } = spec;
  const history = new Map<string, NonNullable<State['paymentAdjustments']>>();
  for (const a of s.paymentAdjustments ?? []) { const rows = history.get(a.paymentId) ?? []; rows.push(a); history.set(a.paymentId, rows); }
  const names = new Map(s.archives.map(a => [a.accountId, a.tableName]));
  const tableNames = new Map([...s.tables, ...(s.retiredTables ?? [])].map(t => [t.id, t.name]));
  for (const a of s.accounts) if (!names.has(a.id)) names.set(a.id, tableNames.get(a.tableId) ?? 'Eski masa');
  // Only names leave the server: corrections show who recorded them, never the account record itself.
  const people = new Map((s.staffUsers ?? []).map(u => [u.id, u.name]));
  return paymentLedger(s).filter(p => { const t = Date.parse(p.createdAt); return t >= start && t < end; }).map(p => {
    const changes = [...history.get(p.id) ?? []].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const refunded = changes.filter(a => a.kind === 'refund').reduce((n, a) => n + a.amount, 0);
    return { id: p.id, accountId: p.accountId, tableName: names.get(p.accountId) ?? 'Eski masa', createdAt: p.createdAt, amount: p.amount, method: p.method, commission: p.commission, tendered: p.tendered, change: p.change,
      itemsSelected: !!p.selections?.length, refunded, refundable: p.amount - refunded, revision: changes.length,
      corrections: changes.map(a => ({ id: a.id, kind: a.kind, amount: a.amount, method: a.method, commission: a.commission, reason: a.reason, createdAt: a.createdAt, by: people.get(a.actor) ?? a.byName ?? 'Kayıtlı kullanıcı',
        // Item refunds: which products went back (names and pieces only), whether they went back into stock, and a cashier's own refund.
        ...(a.items?.length ? { items: a.items.map(i => ({ name: i.name, quantity: i.quantity, ...(i.grams ? { grams: i.grams } : {}) })) } : {}), ...(a.restock ? { restock: true } : {}), ...(a.role === 'cashier' ? { cashier: true } : {}) })) };
  }).filter(r => (filter === 'all' || (filter === 'corrected' ? r.revision > 0 : r.method === filter)) && match(r))
    .sort((a, b) => newer(a, b) ? -1 : newer(b, a) ? 1 : 0);
}
export type LedgerRow = ReturnType<typeof ledgerRows>[number];

/** The whole statement held in one State (tests, tools); the server's paged walk must give the same pages. */
export function paymentLedgerPage(s: State, query: LedgerQuery): PaymentLedgerPage {
  const spec = ledgerQuery(query), { cursor, limit } = spec, rows = ledgerRows(s, spec.start, spec.end, spec);
  const from = cursor ? rows.findIndex(r => newer(cursor, r)) : 0, rest = from < 0 ? [] : rows.slice(from), page = rest.slice(0, limit);
  return { from: query.from, to: query.to, total: rows.length, amount: rows.reduce((n, r) => n + r.amount, 0), rows: page, next: rest.length > limit ? ledgerCursor(page.at(-1)!) : null };
}

/** `grams`: a weighed line ("500 g Fıstıklı Baklava"); `note`: the line's item note. Both absent when the line has none. */
type Item = { productId: string; name: string; optionNames: string[]; quantity: number; total: number; grams?: number; note?: string };
const extras = (l: Order['lines'][number]) => ({ productId: l.productId, ...(l.grams ? { grams: l.grams } : {}), ...(l.note ? { note: l.note } : {}) });
/**
 * A row's details, loaded when it is opened: the items paid when the cashier picked items, otherwise what the account
 * ordered. `archived` opens the payment's settled account only when the payment is no longer on the floor.
 */
export function paymentDetail(s: State, paymentId: string, archived: () => ArchivedAccount | undefined) {
  const live = [...s.archives.flatMap(a => a.payments), ...s.payments].filter(p => p.id === paymentId).at(-1);
  const account = live ? undefined : archived();
  const p: Payment | undefined = live ?? account?.payments.find(p => p.id === paymentId);
  if (!p) throw new DomainError('NOT_FOUND', 'Tahsilat bulunamadı.', 404);
  // Copies taken at payment time first, the live copies win (final names after table moves, kitchen status).
  const orders = new Map<string, Order>();
  for (const o of live ? [...s.archives.flatMap(a => a.orders), ...s.orders] : account!.orders) if (o.accountId === p.accountId) orders.set(o.id, o);
  if (p.selections?.length) {
    // A line with free pieces (deals.ts) charged its full-price pieces first: what earlier payments of the bill took counts.
    const ledger = new Map((live ? [...s.archives.flatMap(a => a.payments), ...s.payments] : account!.payments).filter(x => x.accountId === p.accountId && x.createdAt < p.createdAt).map(x => [x.id, x]));
    const earlier = [...ledger.values()].flatMap(x => x.selections ?? []);
    const items = p.selections.flatMap(sel => { const l = orders.get(sel.orderId)?.lines.find(l => l.id === sel.lineId); return l ? [{ name: l.name, optionNames: l.optionNames, quantity: sel.quantity, total: unitsCost(l, earlier.filter(x => x.orderId === sel.orderId && x.lineId === sel.lineId).reduce((n, x) => n + x.quantity, 0), sel.quantity), ...extras(l) } as Item] : []; });
    return { id: p.id, itemsSelected: true, items };
  }
  const items = new Map<string, Item>();
  for (const o of orders.values()) if (o.status !== 'cancelled' && o.status !== 'awaiting_approval') for (const l of o.lines) {
    // Weight and note are part of what was sold: two 500 g lines read "2 × 500 g", a noted line stays on its own.
    const key = `${l.name}\0${l.optionNames.join('\0')}\0${l.unitPrice}\0${l.grams ?? ''}\0${l.note ?? ''}`, item = items.get(key);
    if (item) { item.quantity += l.quantity; item.total += l.total; } else items.set(key, { name: l.name, optionNames: l.optionNames, quantity: l.quantity, total: l.total, ...extras(l) });
  }
  return { id: p.id, itemsSelected: false, items: [...items.values()] };
}
export type PaymentDetail = ReturnType<typeof paymentDetail>;
