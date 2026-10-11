import type { State, Actor, Context } from './types.js';
import { DomainError, once, requireRole } from './engine.js';
export type DemoEvent = { status: DemoOrder['status']; at: string; actor: string; reason?: string };
export type DemoOrder = { history?: DemoEvent[]; id: string; number: number; version: number; status: 'new' | 'preparing' | 'ready' | 'delivered' | 'cancelled'; createdAt: string; updatedAt: string; paidOnline: true; items: { name: string; quantity: number; price: number }[]; total: number };
export function demoAction(s: State, actor: Actor, b: { requestId: string; action: 'create' | 'preparing' | 'ready' | 'delivered' | 'cancelled'; id?: string; version?: number; reason?: string }, ctx: Context) {
  requireRole(s, actor, ['owner']);
  return once(s, actor, 'integration-demo', b.requestId, b, () => {
    s.integrationDemo ??= [];
    if (b.action === 'create') {
      if (s.integrationDemo.length >= 100) throw new DomainError('DEMO_LIMIT', 'Deneme alanı 100 kayıtla sınırlıdır.', 409);
      const order: DemoOrder = { id: ctx.id(), number: s.integrationDemo.length + 1, version: 1, status: 'new', createdAt: ctx.now.toISOString(), updatedAt: ctx.now.toISOString(), paidOnline: true, items: [{ name: 'Örnek latte', quantity: 2, price: 14000 }, { name: 'Örnek tatlı', quantity: 1, price: 18000 }], total: 46000 };
      order.history = [{ status: 'new', at: order.createdAt, actor: actor.id }];
      s.integrationDemo.push(order); return order;
    }
    const order = s.integrationDemo.find(o => o.id === b.id);
    if (!order) throw new DomainError('NOT_FOUND', 'Deneme siparişi bulunamadı.', 404);
    if (order.version !== b.version) throw new DomainError('VERSION_CONFLICT', 'Sipariş değişti. Listeyi yenileyin.', 409);
    const next: Record<DemoOrder['status'], string[]> = { new: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['delivered', 'cancelled'], delivered: [], cancelled: [] };
    if (!next[order.status].includes(b.action)) throw new DomainError('INVALID_TRANSITION', 'Bu aşamaya geçilemez.', 409);
    if (b.action === 'cancelled' && (!b.reason?.trim() || b.reason.trim().length > 300)) throw new DomainError('REASON_REQUIRED', 'İptal gerekçesi gerekli (en fazla 300 karakter).');
    order.history ??= [];
    order.history.push({ status: b.action, at: ctx.now.toISOString(), actor: actor.id, ...(b.action === 'cancelled' ? { reason: b.reason!.trim() } : {}) });
    order.status = b.action; order.version++; order.updatedAt = ctx.now.toISOString(); return order;
  });
}
