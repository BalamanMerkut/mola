import { DomainError, once, requireRole } from './engine.js';
import type { Actor, Context, State } from './types.js';

export type ServiceCallKind = 'waiter' | 'bill';
/** `method`: how the guest said they will pay when asking for the bill ("Hesap · Kart": the waiter brings the POS); missing = not said. */
export type ServiceCall = { id: string; tableId: string; epoch: number; kind: ServiceCallKind; guestId: string; createdAt: string; method?: 'cash' | 'card' };
export type PublicServiceCall = Omit<ServiceCall, 'guestId' | 'epoch'> & { tableName: string };
/** K1 (10 Ekim): the guest's "Kart"/"Nakit" outlives the answered call and lasts as long as that table session. */
export type BillMethod = { tableId: string; epoch: number; method: 'cash' | 'card' };
export function publicBillMethods(s: State) {
  return (s.billMethods ?? []).filter(b => s.tables.some(t => t.id === b.tableId && t.epoch === b.epoch && t.accountId)).map(({ tableId, method }) => ({ tableId, method }));
}

// A call belongs to one table session; closing or moving the account (epoch++) retires it.
export function activeCalls(s: State) {
  return (s.serviceCalls ?? []).filter(c => s.tables.some(t => t.id === c.tableId && t.epoch === c.epoch));
}
export function publicCalls(s: State): PublicServiceCall[] {
  return activeCalls(s).map(({ guestId: _, epoch: __, ...c }) => ({ ...c, tableName: s.tables.find(t => t.id === c.tableId)!.name }));
}
export function requestServiceCall(s: State, actor: Actor, input: { requestId: string; kind: ServiceCallKind; payWith?: 'cash' | 'card' }, ctx: Context) {
  requireRole(s, actor, ['guest']);
  return once(s, actor, 'service-call', input.requestId, input, () => {
    const table = s.tables.find(t => t.id === actor.tableId);
    if (!table) throw new DomainError('TABLE_REMOVED', 'Bu masa kullanımdan kaldırıldı. Güncel masa QR kodunu okutun.', 410);
    if (actor.epoch !== table.epoch) throw new DomainError('ACCOUNT_CLOSED', 'Hesabınız kapandı. Yeniden QR kodunu okutun.', 409);
    if (s.blocked.includes(actor.id)) throw new DomainError('BROWSER_BLOCKED', 'Bu tarayıcıdan istek gönderilmesi işletme tarafından durduruldu.', 403);
    if (input.kind === 'bill' && !table.accountId) throw new DomainError('NO_ACCOUNT', 'Bu masada henüz açık hesap yok.', 409);
    s.serviceCalls = activeCalls(s);
    // One open call per table and kind: friends at the same table do not ring twice.
    const payWith = input.kind === 'bill' && (input.payWith === 'cash' || input.payWith === 'card') ? input.payWith : undefined;
    if (payWith) s.billMethods = [...(s.billMethods ?? []).filter(b => b.tableId !== table.id && s.tables.some(t => t.id === b.tableId && t.epoch === b.epoch)), { tableId: table.id, epoch: table.epoch, method: payWith }];
    const existing = s.serviceCalls.find(c => c.tableId === table.id && c.kind === input.kind);
    // A friend at the table who says how they pay updates the waiting bill request (the latest word wins).
    if (existing) { if (payWith) existing.method = payWith; return { callId: existing.id, alreadyOpen: true }; }
    const call: ServiceCall = { id: ctx.id(), tableId: table.id, epoch: table.epoch, kind: input.kind, guestId: actor.id, createdAt: ctx.now.toISOString(), ...(payWith ? { method: payWith } : {}) };
    s.serviceCalls.push(call);
    return { callId: call.id, alreadyOpen: false };
  });
}
export function resolveServiceCall(s: State, actor: Actor, input: { callId: string }, ctx: Context) {
  requireRole(s, actor, ['owner', 'manager', 'cashier', 'waiter']);
  const call = activeCalls(s).find(c => c.id === input.callId);
  // Another device may have answered first; that is not an error for the second person.
  if (!call) return { ok: true, alreadyResolved: true };
  s.serviceCalls = activeCalls(s).filter(c => c.id !== call.id);
  s.audit.push({ action: `service-call.${call.kind}.answered`, actor: actor.id, target: call.tableId, at: ctx.now.toISOString() });
  return { ok: true, alreadyResolved: false };
}
