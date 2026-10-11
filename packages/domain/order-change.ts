/*
 * Garson siparişi değiştirir (11 Ekim, hafta sonu bulgusu 5): one line of an order (Kola → Ayran, adet, seçenek, not), by
 * the waiter, the Müdür or the owner.
 * - Prepared products: while the kitchen has not started the order. Ekran modu: until the kitchen presses "Hazırlamaya
 *   başla". Fiş modu: also once the ticket printed ("Hazırlanıyor" there only means the slip came out); the kitchen then gets
 *   a DEĞİŞİKLİK slip. After that, or when money was taken, the existing ways stay: "İptal et" (with its reason) and a new
 *   order, or the owner's refund.
 * - Hazır ürünler (Product.readyMade: kutu kola, ayran, su, soda; the owner's sahibin kararı 11 Ekim): swapped for another
 *   ready-made product (or another quantity) at any time until that line or the bill is paid, whatever the kitchen does, and
 *   without the kitchen (no slip, no kitchen note). The price difference goes on the bill and the counter reads it.
 * engine.ts changeByStaff applies it; the table window asks this first. Browser-safe: types only.
 */
import type { Order, Product, Role } from './types.js';

export const CHANGE_ROLES: readonly Role[] = ['owner', 'manager', 'waiter'];
export const canChangeLines = (role: Role) => CHANGE_ROLES.includes(role);
type Changeable = Pick<Order, 'status' | 'external' | 'cancelRequested' | 'paidAt'> & { paidQuantities?: Record<string, number> };
/** Is this product a "Hazır ürün" (the kitchen does not prepare it)? */
export const readyMade = (p: Pick<Product, 'readyMade'> | undefined) => !!p?.readyMade;
/** Why a line of this order cannot be changed now, in one plain line (with the way that remains); null when it can. */
export function changeBlock(o: Changeable, ticketMode: boolean): string | null {
  if (o.external) return 'Platform siparişi burada değiştirilemez.';
  if (o.status === 'cancelled') return 'Sipariş iptal edildi.';
  if (o.cancelRequested) return 'Müşterinin iptal isteği bekliyor; önce o yanıtlanmalı.';
  if (o.paidAt || Object.values(o.paidQuantities ?? {}).some(n => n > 0)) return 'Ödemesi alınmış sipariş değiştirilemez. Para geri verilecekse işletme sahibi iade yapar; yeni ürün için yeni sipariş girin.';
  if (o.status === 'new' || o.status === 'awaiting_approval' || (ticketMode && o.status === 'preparing')) return null;
  if (o.status === 'served') return 'Teslim edildi: değiştirmek için ürünü “İptal et” ile nedeniyle çıkarıp yenisini sipariş edin.';
  return 'Mutfak hazırlamaya başladı: değiştirmek için ürünü “İptal et” ile nedeniyle çıkarıp yenisini sipariş edin.';
}
/** A ready-made line: why it cannot be swapped now (paid, the order cancelled…), or null. Only for another ready-made product. */
export function readyBlock(o: Changeable, lineId: string): string | null {
  if (o.external) return 'Platform siparişi burada değiştirilemez.';
  if (o.status === 'cancelled') return 'Sipariş iptal edildi.';
  if (o.status === 'awaiting_approval') return null;
  if (o.paidAt || (o.paidQuantities?.[lineId] ?? 0) > 0) return 'Bu ürünün ödemesi alındı; değiştirilemez. Para geri verilecekse işletme sahibi iade yapar.';
  return null;
}
/** Lines that can still change on this order now, and whether only ready-made swaps are possible (the kitchen started). */
export function changeableLines<L extends { id: string; productId: string }>(o: Changeable & { lines: L[] }, products: Pick<Product, 'id' | 'readyMade'>[], ticketMode: boolean): { lines: L[]; readyOnly: boolean } {
  if (!changeBlock(o, ticketMode)) return { lines: o.lines, readyOnly: false };
  return { lines: o.lines.filter(l => readyMade(products.find(p => p.id === l.productId)) && !readyBlock(o, l.id)), readyOnly: true };
}
