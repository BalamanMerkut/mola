import type { Order, State } from './types.js';

// Browser-safe part of the delivery platform rules: names, colours, headings and sales channels. The order rules that
// need the server (acceptance, payments, outbox) are in external-orders.ts, which re-exports everything here.

export const PLATFORM_IDS = ['yemeksepeti', 'getir', 'trendyol', 'migros', 'test'] as const;
export type PlatformId = typeof PLATFORM_IDS[number];
/** Names in plain text and one distinct colour each (white text on it passes contrast). No logos or trademark images. */
export const PLATFORMS: Record<PlatformId, { name: string; ticket: string; color: string }> = {
  yemeksepeti: { name: 'Yemeksepeti', ticket: 'YEMEKSEPETI', color: '#b3124a' },
  getir: { name: 'Getir Yemek', ticket: 'GETIR', color: '#5a37b8' },
  trendyol: { name: 'Trendyol Yemek', ticket: 'TRENDYOL', color: '#a8490b' },
  migros: { name: 'Migros Yemek', ticket: 'MIGROS', color: '#0b6b74' },
  test: { name: 'Deneme platformu', ticket: 'DENEME', color: '#4f5b66' },
};
export const isPlatform = (value: unknown): value is PlatformId => typeof value === 'string' && (PLATFORM_IDS as readonly string[]).includes(value);

export type DeliveryType = 'kurye' | 'gel-al';
/** What every screen, ticket and report knows about an order that came from a platform (`Order.external`). */
export type ExternalSource = { platform: PlatformId; externalId: string; code?: string; customerName?: string; note?: string; deliveryType?: DeliveryType; paidOnline?: boolean; total: number; receivedAt: string };
export const REJECT_REASONS = ['Ürün tükendi', 'Mutfak çok yoğun', 'İşletme kapanıyor', 'Teslimat bölgesi dışında', 'Diğer'] as const;

/** "YEMEKSEPETI #1234": kitchen card and kitchen ticket heading. */
export const externalHeading = (x: Pick<ExternalSource, 'platform' | 'code' | 'externalId'>) => `${PLATFORMS[x.platform].ticket} #${x.code ?? x.externalId.slice(-6)}`;
/** "Yemeksepeti #1234": the ticket's name in lists, payment, receipts and history. */
export const externalName = (x: Pick<ExternalSource, 'platform' | 'code' | 'externalId'>) => `${PLATFORMS[x.platform].name} #${x.code ?? x.externalId.slice(-6)}`;
export const deliveryText = (x: Pick<ExternalSource, 'deliveryType'>) => x.deliveryType === 'gel-al' ? 'Gel-al' : 'Kurye ile teslim';
/** History keeps no customer name or note (like the masasız call-out name): only the live order shows them. */
export function withoutPersonal<T extends Pick<Order, 'external'>>(o: T): T {
  if (!o.external || (!o.external.customerName && !o.external.note)) return o;
  const { customerName: _, note: __, ...external } = o.external;
  return { ...o, external };
}

// ---- Sales channels (reports) ----
/** 'rezervasyon': sold on a reserved table or an event table (Order.reservation, packages/domain/reservations.ts). */
export type Channel = 'salon' | 'masasiz' | 'rezervasyon' | PlatformId;
export const CHANNELS: Channel[] = ['salon', 'masasiz', 'rezervasyon', ...PLATFORM_IDS];
export const CHANNEL_NAMES: Record<Channel, string> = { salon: 'Salon / QR', masasiz: 'Masasız', rezervasyon: 'Rezervasyon ve etkinlik', ...Object.fromEntries(PLATFORM_IDS.map(p => [p, PLATFORMS[p].name])) as Record<PlatformId, string> };
/** Older tickets kept the name they were stored with ("Paket #3", "Al götür #5"). */
const COUNTER_NAME = /^(Masasız|Paket|Al götür) #\d+$/;
export function orderChannel(o: Pick<Order, 'external' | 'reservation'>, tableName?: string): Channel {
  if (o.external && isPlatform(o.external.platform)) return o.external.platform;
  if (o.reservation) return 'rezervasyon';
  return tableName && COUNTER_NAME.test(tableName) ? 'masasiz' : 'salon';
}
/** Each account's table name, so reports can tell masasız tickets that are not archived yet. */
export const openTables = (s: Pick<State, 'accounts' | 'tables'>) => { const names = new Map(s.tables.map(t => [t.id, t.name])); return s.accounts.flatMap(a => names.has(a.tableId) ? [{ accountId: a.id, tableName: names.get(a.tableId)! }] : []); };
