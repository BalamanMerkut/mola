/**
 * What keeps an update from installing now (server/app.ts activity, server/update-agent.ts, src/UpdateBanner.tsx).
 * 19 Ekim (owner): only real open work counts and the sentence says which: an open table, an order still in the kitchen on an
 * open table, a QR order waiting for the waiter, a delivery platform order waiting for Kabul/Reddet. Before, a paid table's
 * order the kitchen never marked and every platform order of the last 48 hours (test orders too) held the update unseen.
 */
export type Activity = { openAccounts: number; pendingOrders: number; qrApprovals?: number; platformWaiting?: number };

/** "1 açık masa, 1 onay bekleyen QR siparişi ve 1 Kabul bekleyen paket servis siparişi" ("" when nothing waits). */
export function busyText(a: Activity): string {
  const qr = a.qrApprovals ?? 0, platform = a.platformWaiting ?? 0, kitchen = Math.max(0, a.pendingOrders - qr - platform);
  const parts = [a.openAccounts && `${a.openAccounts} açık masa`, kitchen && `${kitchen} bitmemiş sipariş`, qr && `${qr} onay bekleyen QR siparişi`, platform && `${platform} Kabul bekleyen paket servis siparişi`].filter((p): p is string => !!p);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ve ${parts[parts.length - 1]}` : parts[0] ?? '';
}
