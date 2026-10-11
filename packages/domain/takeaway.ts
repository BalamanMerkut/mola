import type { CafeTable, OrderStatus } from './types.js';

// Masasız satış (counter sale; `takeaway` in code). Not a feature to switch on: it is one more choice in Sipariş al, next to
// the tables, for the customer who takes it away or waits standing. A ticket is a hidden virtual table: the account, order,
// kitchen, payment, receipt and history rules all work unchanged, while the floor plan, QR codes, cleaning and moves never see it.
// Browser-safe: the server rules live in engine.ts (submitTakeaway); screens use the names and stages below.
// Never "Paket": in Turkish "paket sipariş / paket servis" means home delivery (Yemeksepeti and the like), which the delivery
// integrations will bring. Tickets keep the name they were stored with, so history still shows old "Paket #3" / "Al götür #5".

export const LABEL_MAX = 24;
export const isTakeaway = (t: Pick<CafeTable, 'takeaway'> | undefined | null) => !!t?.takeaway;
/** The floor plan: real tables with a QR code. Counts, limits, areas and QR lists use only these (never masasız tickets nor
 * an event's temporary tables, packages/domain/reservations.ts). */
export const floorTables = <T extends Pick<CafeTable, 'takeaway' | 'event'>>(s: { tables: T[] }) => s.tables.filter(t => !t.takeaway && !t.event);
/** "Masasız #12": numbered per business day, so the counter can call it out. Reports show this name like a table name. */
export const takeawayName = (number: number) => `Masasız #${number}`;
/** Kitchen card and ticket heading, loud enough that a bag never goes to a table. */
export const takeawayHeading = (number: number) => `MASASIZ #${number}`;
/** Business day (Turkish date, UTC+3) as in history.ts; repeated here so browsers need no server code. */
export const takeawayDay = (at: Date) => new Date(at.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
/**
 * The customer's short name for calling out the order ("Ahmet"), or undefined for none; null when it is refused.
 * Digits are limited so a phone number is never stored: the ticket number already identifies the order.
 */
export function takeawayLabel(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const label = value.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  if (!label) return undefined;
  return [...label].length > LABEL_MAX || (label.match(/\d/g)?.length ?? 0) > 2 || /[@]/.test(label) ? null : label;
}
/** Drops tickets whose account already moved to long-term history (server/history.ts); the archive keeps their name. */
export function pruneTakeaways(s: { tables: CafeTable[]; accounts: { tableId: string }[] }) {
  if (s.tables.some(t => t.takeaway && !t.accountId && !s.accounts.some(a => a.tableId === t.id))) s.tables = s.tables.filter(t => !t.takeaway || t.accountId || s.accounts.some(a => a.tableId === t.id));
}
export type TakeawayStage = 'new' | 'preparing' | 'ready' | 'served';
/** One word for the whole ticket: anything the kitchen has not started yet wins ("Yeni sipariş", never "Hazırlanıyor" before
 * it is), then in the kitchen, then waiting at the counter, then handed over. */
export function takeawayStage(orders: { status: OrderStatus }[]): TakeawayStage | null {
  const live = orders.filter(o => o.status !== 'cancelled');
  if (!live.length) return null;
  if (live.some(o => ['awaiting_approval', 'new'].includes(o.status))) return 'new';
  if (live.some(o => o.status === 'preparing')) return 'preparing';
  return live.some(o => o.status === 'ready') ? 'ready' : 'served';
}
export const stageNames: Record<TakeawayStage, string> = { new: 'Yeni sipariş', preparing: 'Hazırlanıyor', ready: 'Hazır', served: 'Teslim edildi' };
