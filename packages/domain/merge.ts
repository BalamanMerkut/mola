import type { Actor, Context, State } from './types.js';
import { balances, DomainError, once, requireRole } from './engine.js';
import { isTakeaway } from './takeaway.js';
import { applyBillDeals } from './deals.js';
export function mergeAccounts(s: State, actor: Actor, b: { requestId: string; sourceId: string; sourceVersion: number; targetId: string; targetVersion: number }, ctx: Context) {
  // 11 Ekim (hafta sonu bulgusu 9): the waiter joins tables for a large group too, with the same rules and record as the cashier.
  requireRole(s, actor, ['cashier', 'manager', 'owner', 'waiter']);
  return once(s, actor, 'merge-accounts', b.requestId, b, () => {
    const source = s.accounts.find(a => a.id === b.sourceId && a.status === 'open'), target = s.accounts.find(a => a.id === b.targetId && a.status === 'open');
    if (!source || !target || source.id === target.id || source.version !== b.sourceVersion || target.version !== b.targetVersion) throw new DomainError('ACCOUNT_CHANGED', 'Hesaplar değişti. Pencereyi kapatıp yeniden açın.', 409);
    const from = s.tables.find(t => t.accountId === source.id), to = s.tables.find(t => t.accountId === target.id);
    if (!from || !to) throw new DomainError('TABLE_CHANGED', 'Masa bilgisi değişti.', 409);
    // Each masasız ticket is its own order and receipt; it never joins or absorbs a table's bill.
    if (isTakeaway(from) || isTakeaway(to)) throw new DomainError('TAKEAWAY_FIXED', 'Masasız sipariş bir masanın hesabıyla birleştirilemez.', 409);
    // A reservation's kapora rides on its own bill: the other table joins it, never the other way round.
    if (source.deposit && !source.deposit.settledAt) throw new DomainError('DEPOSIT_FIXED', `${from.name} hesabında kapora var. Diğer masayı ${from.name} masasına birleştirin.`, 409);
    // The seated name goes along when the other bill has none; otherwise that reservation's guest has left.
    if (source.guest && !target.guest) { target.guest = source.guest; const r = s.reservations?.find(r => r.id === source.guest!.reservationId); if (r) r.accountId = target.id; }
    else if (source.guest?.reservationId) { const r = s.reservations?.find(r => r.id === source.guest!.reservationId); if (r && !r.closedAt) r.closedAt = ctx.now.toISOString(); }
    for (const o of s.orders.filter(o => o.accountId === source.id)) { o.accountId = target.id; o.version++; o.tableMovedFrom = from.name; }
    for (const p of s.payments.filter(p => p.accountId === source.id)) p.accountId = target.id;
    source.status = 'closed'; source.closedAt = ctx.now.toISOString(); source.version++;
    target.version++; from.accountId = null; from.epoch++; from.needsCleaning = !!s.cleaningEnabled; to.epoch++;
    // One bill now: its account campaigns count both tables' units (deals.ts), never below what both already paid.
    applyBillDeals(s, target.id, true);
    s.audit.push({ action: 'accounts.merged', actor: actor.id, target: `${source.id}->${target.id}`, at: ctx.now.toISOString() });
    return { tableName: to.name, accountId: target.id, ...balances(s, target.id) };
  });
}
