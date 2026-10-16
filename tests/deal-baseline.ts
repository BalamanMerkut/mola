import { seed } from '../server/seed.js';
import { repriceSavedLine, saleProducts, type Campaign } from '../packages/domain/campaigns.js';
import { balances, cancelByStaff, changeByStaff, editOrder, quote, recordPayment, submitOrder } from '../packages/domain/engine.js';
import { campaignReport } from '../packages/domain/campaign-reports.js';
import { financialReport } from '../packages/domain/reports.js';
import { billTicket, paymentTicket } from '../packages/domain/printing.js';
import { mergeAccounts } from '../packages/domain/merge.js';
import type { CartLine } from '../packages/domain/types.js';

/**
 * Existing campaigns (percent, TL, quantity condition, category with an exclusion, weekly schedule, quota, combining) through
 * orders, a guest edit, a staff change, a partial cancel, a merge and item and amount payments. tests/deal-baseline.json holds
 * what the code before the account campaigns (deals.ts) produced; tests/deal-campaigns.test.ts asserts it is still the same.
 */
export function baselineScenario() {
  const start = '2026-09-20T00:00:00Z', now = new Date('2026-09-26T12:00:00Z'); // a Saturday, 15:00 in Türkiye
  const s = seed(); s.changeSeconds = 600;
  s.products.find(p => p.id === 'brownie')!.soldOut = false;
  const campaigns: Campaign[] = [
    { id: 'p10', reportId: 'p10-v1', name: 'Kahve %10', productIds: ['latte', 'americano'], kind: 'percent', percent: 10, startsAt: start, endsAt: null, enabled: true, combine: true },
    { id: 'f5', reportId: 'f5-v1', name: 'Çay 5 TL', productIds: ['tea'], kind: 'fixed', amount: 500, startsAt: start, endsAt: null, enabled: true, combine: true },
    { id: 'q2', reportId: 'q2-v1', name: '2 latte', productIds: ['latte'], minQuantity: 2, kind: 'fixed', amount: 2000, startsAt: start, endsAt: null, enabled: true, combine: false },
    { id: 'cat', reportId: 'cat-v1', name: 'Tatlılar %15', productIds: [], categories: ['Tatlılar'], excludedProductIds: ['brownie'], kind: 'percent', percent: 15, startsAt: start, endsAt: null, enabled: true, combine: false, maxQuantity: 3 },
    { id: 'sch', reportId: 'sch-v1', name: 'Hafta sonu limonata', productIds: ['lemonade'], kind: 'percent', percent: 20, schedule: { days: [6, 7], from: '14:00', to: '17:00' }, startsAt: start, endsAt: '2026-10-18T00:00:00Z', enabled: true, combine: false },
  ];
  s.campaigns = structuredClone(campaigns); s.campaignHistory = campaigns.map(c => ({ ...structuredClone(c), recordedAt: start }));
  let n = 0; const ctx = { now, id: () => `id-${++n}` }, rid = () => `request-${++n}-xxxxxxxx`;
  const waiter = { tenantId: s.tenantId, id: 'waiter', role: 'waiter' as const }, owner = { tenantId: s.tenantId, id: 'owner', role: 'owner' as const };
  const guest = { tenantId: s.tenantId, role: 'guest' as const, id: 'guest-1', tableId: 'table-2', epoch: 0 };
  const priced = (lines: CartLine[]) => quote(saleProducts(s, now), lines, ctx).reduce((t, l) => t + l.total, 0);
  const submit = (actor: typeof waiter | typeof guest, tableId: string, lines: CartLine[]) => submitOrder(s, actor, { requestId: rid(), tableId, lines, expectedTotal: priced(lines) }, ctx);
  const latte = (q: number, size = 'regular'): CartLine => ({ productId: 'latte', quantity: q, selections: [{ groupId: 'size', optionId: size }] });
  const ame = (q: number): CartLine => ({ productId: 'americano', quantity: q, selections: [{ groupId: 'size', optionId: 'large' }] });
  const plain = (id: string, q: number): CartLine => ({ productId: id, quantity: q, selections: [] });
  submit(waiter, 'table-1', [latte(2), ame(1), plain('tea', 3), plain('cheesecake', 2), plain('lemonade', 1)]);
  submit(waiter, 'table-1', [latte(1, 'large'), plain('brownie', 1), plain('cheesecake', 1)]);
  submit(guest, 'table-2', [latte(1), plain('tea', 2)]);
  const g = s.orders[2];
  editOrder(s, guest, { requestId: rid(), orderId: g.id, version: g.version, lines: [{ ...latte(2), existingId: g.lines[0].id }, { ...plain('tea', 2), existingId: g.lines[1].id }], expectedTotal: repriceSavedLine(g.lines[0], 2, 2).total + g.lines[1].total }, ctx);
  const o1 = s.orders[0];
  changeByStaff(s, waiter, { requestId: rid(), orderId: o1.id, version: o1.version, lineId: o1.lines[2].id, line: plain('tea', 2), expectedTotal: o1.total - o1.lines[2].total + 2 * o1.lines[2].unitPrice }, ctx);
  const a1 = s.accounts.find(a => a.tableId === 'table-1')!;
  recordPayment(s, owner, { requestId: rid(), accountId: a1.id, version: a1.version, method: 'card', amount: o1.lines[0].unitPrice, tendered: o1.lines[0].unitPrice, selections: [{ orderId: o1.id, lineId: o1.lines[0].id, quantity: 1 }] }, ctx);
  cancelByStaff(s, waiter, { requestId: rid(), orderId: o1.id, version: o1.version, reason: 'Müşteri vazgeçti', lines: [{ lineId: o1.lines[0].id, quantity: 1 }, { lineId: o1.lines[3].id, quantity: 1 }] }, ctx);
  const a2 = s.accounts.find(a => a.tableId === 'table-2')!;
  mergeAccounts(s, waiter, { requestId: rid(), sourceId: a2.id, sourceVersion: a2.version, targetId: a1.id, targetVersion: a1.version }, ctx);
  const bill = billTicket(s, a1.id, now);
  const rest = balances(s, a1.id).balance;
  recordPayment(s, owner, { requestId: rid(), accountId: a1.id, version: a1.version, method: 'cash', amount: rest, tendered: rest }, ctx);
  return {
    orders: s.orders.map(o => ({ status: o.status, total: o.total, lines: o.lines.map(l => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, total: l.total, originalUnitPrice: l.originalUnitPrice ?? null, campaigns: l.campaigns?.map(c => c.id) ?? [] })), cancelled: (o.cancellations ?? []).flatMap(c => c.lines.map(l => [l.productId, l.quantity, l.total])) })),
    payments: s.payments.map(p => [p.amount, p.campaignAmount ?? null]),
    bill, receipts: s.payments.map(p => paymentTicket(s, p.id, now)),
    menu: saleProducts(s, now).map(p => [p.id, (p.discounts ?? []).map(d => [d.id, d.kind ?? 'percent', d.percent ?? d.amount, d.remainingQuantity ?? null])]),
    report: campaignReport(s, new Date(+now + 1000)).campaigns.map(c => [c.id, c.appliedQuantity, c.appliedAmount, c.discount, c.quantity, c.products.map(p => [p.id, p.quantity, p.appliedQuantity, p.appliedAmount, p.discount])]),
    financial: (f => [f.campaignCollected, f.campaignDiscount, f.regularCollected, f.orderAmount ?? null])(financialReport(s, '2026-09-26', '2026-09-26') as unknown as { campaignCollected: number; campaignDiscount: number; regularCollected: number; orderAmount?: number }),
  };
}
