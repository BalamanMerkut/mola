import type { State } from './types.js';

// Public output deliberately contains IDs only, never sales counts or revenue.
/** `stored`: quantities of the last 30 days that already left the live snapshot (server daily summaries). */
export function popularProductIds(s: State, now: Date, stored?: Map<string, number>): string[] {
  const end = now.getTime(), start = end - 30 * 86400000;
  const available = new Set(s.products.filter(p => p.published !== false && !p.soldOut).map(p => p.id));
  const orders = new Map(s.archives.flatMap(a => a.orders).map(o => [o.id, o]));
  for (const order of s.orders) orders.set(order.id, order);
  const quantities = new Map<string, number>();
  for (const [id, quantity] of stored ?? []) if (available.has(id)) quantities.set(id, quantity);
  for (const order of orders.values()) {
    const at = Date.parse(order.createdAt);
    if (['cancelled', 'awaiting_approval'].includes(order.status) || !(at >= start && at <= end)) continue;
    for (const line of order.lines) if (available.has(line.productId)) {
      quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
    }
  }
  return [...quantities].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([id]) => id);
}
