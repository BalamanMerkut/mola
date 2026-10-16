import type { Actor, Context, State } from './types.js';
import { DomainError, once, requireRole } from './engine.js';
import { applyBillDeals } from './deals.js';

// QR orders are approved by the floor and the kitchen (waiter, kitchen; the owner and Müdür as supervisors). The cashier only sees the state.
export const APPROVERS = ['waiter', 'kitchen', 'owner', 'manager'] as const;
/** "Otomatik onay" for the whole business: the owner (also in Ayarlar), the Müdür and waiters; never the kitchen (owner's decision). */
export const AUTO_APPROVAL_ROLES = ['owner', 'manager', 'waiter'] as const;
export function reviewOrder(s: State, actor: Actor, b: { requestId: string; orderId: string; version: number; approve: boolean; reason?: string }, ctx: Context) {
  requireRole(s, actor, [...APPROVERS]);
  return once(s, actor, 'review-order', b.requestId, b, () => {
    const o = s.orders.find(o => o.id === b.orderId);
    if (!o || o.status !== 'awaiting_approval' || o.version !== b.version) throw new DomainError('ORDER_CHANGED', 'Sipariş değişti. Güncel listeyi kontrol edin.', 409);
    if (!b.approve && !b.reason?.trim()) throw new DomainError('REASON_REQUIRED', 'Müşteriye gösterilecek ret açıklamasını yazın.');
    const a = s.accounts.find(a => a.id === o.accountId && a.status === 'open');
    if (!a) throw new DomainError('ACCOUNT_CLOSED', 'Hesap kapandı.', 409);
    o.status = b.approve ? 'new' : 'cancelled'; o.version++; a.version++;
    // A rejected order leaves the bill: its account campaigns (a free tea, a gift) are priced again (deals.ts).
    if (!b.approve) applyBillDeals(s, a.id, true);
    o.reviewedBy = actor.id; o.reviewReason = b.approve ? undefined : b.reason!.trim();
    s.audit.push({ action: b.approve ? 'order.approved' : 'order.rejected', actor: actor.id, target: o.id, at: ctx.now.toISOString() });
    return { ok: true };
  });
}

export function setAutomaticApproval(s: State, actor: Actor, b: { requestId: string; version: number; enabled: boolean }, ctx: Context) {
  requireRole(s, actor, [...AUTO_APPROVAL_ROLES]);
  return once(s, actor, 'auto-approval', b.requestId, b, () => {
    if (!s.waiterApproval) throw new DomainError('APPROVAL_DISABLED', 'İşletmede garson onayı kullanılmıyor.', 409);
    if ((s.approvalVersion ?? 0) !== b.version) throw new DomainError('VERSION_CONFLICT', 'Onay tercihi değişti. Güncel durumu kontrol edin.', 409);
    s.autoApproveQr = b.enabled; s.approvalVersion = (s.approvalVersion ?? 0) + 1;
    s.audit.push({ action: b.enabled ? 'approval.auto_on' : 'approval.auto_off', actor: actor.id, target: s.tenantId, at: ctx.now.toISOString() });
    return { ok: true };
  });
}
