import type { ArchivedAccount, Order, State } from '../packages/domain/types.js';
import type { Reservation } from '../packages/domain/reservations.js';
import { ANONYMOUS_GUEST, anonymousGuest } from '../packages/domain/history.js';

/*
 * Customers' personal data leaves a year when it is packaged (owner's decision, 7 October 2026; server/year-packer.ts,
 * docs/GELISTIRICI_REHBERI.md "Yıl paketleri"). The live file keeps them for the open year; the package of a closed year
 * holds only what the business needs to keep: amounts, kapora, party size, table, dates and times, products, payments, KDV,
 * cash, stock and the staff's names and shifts. Figures never change: nothing here is a figure, and a QR guest keeps the tag
 * the day summaries already count by.
 *
 *   history_archives     the seated guest's name (Account.guest: reservation or event walk-in) → "Müşteri"; a platform
 *                        order's customer name and note (Order.external; History.settle already leaves them out since the
 *                        platforms came); every line note (the guest's free text, platform item notes too, cancelled lines'
 *                        copies included); a QR guest's browser id (its 30-day cookie) → "anon:<tag>".
 *   history_audit        a QR guest's browser id as actor or target (a guest's own order edit) → "anon:<tag>".
 *   reservation_records  a reservation's name → "Müşteri", its phone and its note. Events keep their own name (a business
 *                        label such as "Derbi gecesi") and their tables.
 * Platform orders never carry a phone or an address here (packages/domain/external-orders.ts keeps only a first name and a
 * note); a reservation has no e-mail field. Nothing else in a package holds a customer's data: day summaries keep guest tags
 * (one-way SHA-256), payment lists and roll-ups only money and table names, the rest is staff, cash and stock.
 */
export const ANONYMOUS_NAME = 'Müşteri';
/** A QR guest's browser id (server/app.ts mola_browser: 24 random bytes as hex). */
const BROWSER_ID = /^[a-f0-9]{48}$/;
/** The tables whose rows can hold customers' personal data (PACKAGE_TABLES `private`). */
export const PRIVATE_TABLES = new Set(['history_archives', 'history_audit', 'reservation_records']);

const withoutNote = <T extends { note?: string }>(line: T): T => { if (line.note === undefined) return line; const { note: _, ...rest } = line; return rest as T; };
function order(o: Order): Order {
  let out = o;
  const edit = () => out === o ? (out = { ...o }) : out;
  if (o.external && (o.external.customerName !== undefined || o.external.note !== undefined)) { const { customerName: _n, note: _t, ...external } = o.external; edit().external = external; }
  if (o.lines?.some(l => l.note !== undefined)) edit().lines = o.lines.map(withoutNote);
  if (o.cancellations?.some(c => c.lines.some(l => l.note !== undefined))) edit().cancellations = o.cancellations.map(c => ({ ...c, lines: c.lines.map(withoutNote) }));
  if (o.source === 'qr' && typeof o.guestId === 'string' && !o.guestId.startsWith(ANONYMOUS_GUEST)) edit().guestId = anonymousGuest(o.guestId);
  return out;
}
function archive(v: ArchivedAccount): ArchivedAccount | undefined {
  let changed = false;
  const orders = (v.orders ?? []).map(o => { const next = order(o); if (next !== o) changed = true; return next; });
  let account = v.account;
  if (account?.guest && account.guest.name !== ANONYMOUS_NAME) { account = { ...account, guest: { ...account.guest, name: ANONYMOUS_NAME } }; changed = true; }
  return changed ? { ...v, orders, ...(account ? { account } : {}) } : undefined;
}
function reservation(r: Reservation): Reservation | undefined {
  if (r.name === ANONYMOUS_NAME && r.phone === undefined && r.note === undefined) return undefined;
  const { phone: _p, note: _n, ...rest } = r;
  return { ...rest, name: ANONYMOUS_NAME };
}
function audit(e: State['audit'][number]): State['audit'][number] | undefined {
  const actor = BROWSER_ID.test(e.actor) ? anonymousGuest(e.actor) : e.actor, target = BROWSER_ID.test(e.target) ? anonymousGuest(e.target) : e.target;
  return actor === e.actor && target === e.target ? undefined : { ...e, actor, target };
}
/**
 * The row's value without customers' personal data, or undefined when it holds none (the row then goes into the package
 * byte for byte). `row`: the row's readable columns (reservation_records: its kind).
 */
export function withoutPersonalData(table: string, row: Record<string, unknown>, value: unknown): unknown {
  if (table === 'history_archives') return archive(value as ArchivedAccount);
  if (table === 'history_audit') return audit(value as State['audit'][number]);
  if (table === 'reservation_records' && row.kind === 'reservation') return reservation(value as Reservation);
  return undefined;
}
