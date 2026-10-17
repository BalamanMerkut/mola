/*
 * The guest's change window ("Müşteri siparişini değiştirip iptal edebilsin", Ayarlar → Sipariş ve onay → changeSeconds):
 * for this many seconds after a QR guest sends an order, the guest may still change or cancel it from the phone.
 * - 17 Ekim (owner's decision): while the window runs the order is not final, so it has not reached the kitchen yet. The
 *   kitchen's screen, counts and sounds get it only when the window ends, the same moment its kitchen ticket prints
 *   (printing.ts readyToPrint); waiters, the counter and the owner see it at once. No staff action ends a window early.
 * - New businesses start with it off; turning it on starts at 30 seconds. Existing businesses keep what they have.
 * Browser-safe: no Node imports.
 */
import type { Order } from './types.js';

/** A new business (first setup, starter state) starts with the change window off. */
export const NEW_BUSINESS_CHANGE_SECONDS = 0;
/** Turning the change window on (Ayarlar, first setup) starts with this many seconds. */
export const CHANGE_SECONDS_ON = 30;

/**
 * Until when the guest may still change a QR order; the kitchen starts after it. Only QR guest orders have this window:
 * staff, masasız and platform orders start at once (also older staff orders that were saved with a deadline).
 */
export function changeDeadline(order: Pick<Order, 'editableUntil' | 'createdAt' | 'source'>, seconds: number) {
  if (order.source !== 'qr') return Date.parse(order.createdAt);
  return order.editableUntil ? Date.parse(order.editableUntil) : Date.parse(order.createdAt) + seconds * 1000;
}

/** A QR order the guest may still change: not on the kitchen's screen yet (also not in its approval list). */
export function notYetInKitchen(order: Pick<Order, 'editableUntil' | 'createdAt' | 'source' | 'status'>, seconds: number, now: number) {
  return order.source === 'qr' && (order.status === 'new' || order.status === 'awaiting_approval') && now < changeDeadline(order, seconds);
}
