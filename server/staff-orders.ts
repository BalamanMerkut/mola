import { cancelLimits, isOrderPaid } from '../packages/domain/engine.js';
import { changeDeadline, notYetInKitchen } from '../packages/domain/change-window.js';
import type { Order, OrderLine, PublicOrder, Role, State } from '../packages/domain/types.js';

/**
 * The orders part of GET /api/staff/state, which every staff screen polls every 2 seconds. It was most of the snapshot
 * (derby night: 182 orders, ~190 KB per poll per screen), so it carries only what the screens use:
 * - served and fully paid orders older than DONE_KEEP_MS leave the list; the table window says how many (`doneOrders`);
 * - the kitchen gets no served orders at all (its board ends at "Hazır") and never prices;
 * - the kitchen gets a QR guest order only once the guest's change window has ended (17 Ekim, owner's decision; the same
 *   moment its ticket prints): until then it is not final, so it is not on the board, the counts, the approval list or the
 *   sounds. It then arrives as the order is now, as if new: no "Müşteri siparişi güncelledi", and no DEĞİŞTİ / İPTAL notes
 *   for what changed before it arrived (the tag of the poll changes at that moment, so the screen gets it);
 * - fields no staff screen reads are left out (guest id, menu revision, approval flag, reservation tag, raw stock
 *   questions, option ids; the kitchen also no pricing rules), as are default values (no change window, nothing paid,
 *   not paid first).
 * Everything stays exact for what remains: the same order, lines, totals, versions and paid pieces.
 */
export const DONE_KEEP_MS = 30 * 60_000;
const KITCHEN: readonly Order['status'][] = ['awaiting_approval', 'new', 'preparing', 'ready', 'cancelled'];

export function staffOrders(s: State, role: Role, now: number) {
  const hiddenMoney = role === 'kitchen';
  const openAccounts = new Set(s.accounts.filter(a => a.status === 'open').map(a => a.id));
  const tableOf = new Map(s.accounts.map(a => [a.id, a.tableId])), tableById = new Map(s.tables.map(t => [t.id, t]));
  const names = new Map((s.staffUsers ?? []).map(u => [u.id, u.name]));
  // Paid pieces per order and line, read once instead of scanning every payment for every line.
  const paidPieces = new Map<string, Map<string, number>>();
  for (const p of s.payments) for (const sel of p.selections ?? []) {
    const lines = paidPieces.get(sel.orderId) ?? new Map<string, number>();
    lines.set(sel.lineId, (lines.get(sel.lineId) ?? 0) + sel.quantity); paidPieces.set(sel.orderId, lines);
  }
  const doneOrders = new Map<string, number>(), orders: PublicOrder[] = [];
  for (const o of s.orders) {
    if (!openAccounts.has(o.accountId) && !['new', 'preparing', 'ready'].includes(o.status)) continue;
    if (hiddenMoney && (!KITCHEN.includes(o.status) || notYetInKitchen(o, s.changeSeconds, now))) continue;
    const paid = isOrderPaid(s, o);
    if (o.status === 'served' && paid && now - Math.max(Date.parse(o.createdAt), o.paidAt ? Date.parse(o.paidAt) : 0) > DONE_KEEP_MS) {
      doneOrders.set(o.accountId, (doneOrders.get(o.accountId) ?? 0) + 1); continue;
    }
    orders.push(publicOrder(s, o, { hiddenMoney, paid, pieces: paidPieces.get(o.id), names, table: tableById.get(tableOf.get(o.accountId) ?? '') }));
  }
  return { orders, doneOrders };
}

function publicOrder(s: State, o: Order, x: { hiddenMoney: boolean; paid: boolean; pieces?: Map<string, number>; names: Map<string, string>; table?: State['tables'][number] }): PublicOrder {
  const { guestId: _g, menuRevision: _m, approvalRequired: _a, reviewedBy: _r, reservation: _v, stockQuestions: _q, statusUndo: _u, cancelPrinted: _c,
    editableUntil, paymentBeforePreparation, cancelledBy, cancellations: allCancellations, changes: allChanges, updatedAt, lines, total, external, ...rest } = o;
  // The kitchen meets a QR order when its change window ends: what happened to it before that is not news to the kitchen.
  const arrived = x.hiddenMoney ? changeDeadline(o, s.changeSeconds) : -Infinity, after = (c: { at: string }) => Date.parse(c.at) >= arrived;
  const cancellations = allCancellations?.filter(after), changes = allChanges?.filter(after);
  const table = x.table, tableName = table?.name ?? 'Masa';
  // Option ids are never read by staff screens; pricing rules (quantity offers, per-kg price) stay for the money screens.
  const line = (l: OrderLine): OrderLine => {
    // Account campaign offers (deals.ts) are the server's to price with; the screens read the menu's and the line's `deals`.
    const { selections: _s, quantityPricing, weightPricing, dealOffers: _o, deals, ...kept } = l;
    return (x.hiddenMoney ? { ...kept, originalUnitPrice: undefined, unitPrice: 0, total: 0 } : { ...kept, ...(deals ? { deals } : {}), ...(quantityPricing ? { quantityPricing } : {}), ...(weightPricing ? { weightPricing } : {}) }) as OrderLine;
  };
  const pieces = x.pieces && [...x.pieces].filter(([, n]) => n > 0);
  const limits = cancelLimits(s, o);
  return {
    ...rest, cancelRequested: o.cancelRequested, lines: lines.map(line), total: x.hiddenMoney ? 0 : total, tableName, paid: x.paid,
    // Kitchen cards and the counter strip need the ticket number and call-out name, also after the bill is closed.
    ...(table?.takeaway ? { takeaway: { tableId: table.id, number: table.takeaway.number, ...(table.takeaway.label ? { label: table.takeaway.label } : {}) } } : {}),
    // The guest's change window matters only until the kitchen starts.
    ...(editableUntil && ['new', 'awaiting_approval'].includes(o.status) ? { editableUntil } : {}),
    ...(paymentBeforePreparation ? { paymentBeforePreparation } : {}),
    ...(external ? { external: x.hiddenMoney ? { ...external, total: 0 } : external } : {}),
    ...(cancelledBy ? { cancelledBy, cancelledByName: x.names.get(cancelledBy) ?? 'Personel' } : {}),
    ...(updatedAt && !x.hiddenMoney ? { updatedAt } : {}),
    ...(cancellations ? { cancellations: cancellations.map(c => ({ ...c, byName: x.names.get(c.by) ?? 'Personel', lines: c.lines.map(line) })) } : {}),
    // "Değişti: Kola → Ayran" on the kitchen card and the table window (no prices in a change).
    // The kitchen: only what it prepares (a ready-made swap is the counter's business) and no money.
    ...((k => k.length ? { changes: k.map(({ printTo: _p, delta, ...c }) => ({ ...c, ...(x.hiddenMoney || !delta ? {} : { delta }), byName: x.names.get(c.by) ?? 'Personel' })) } : {})((changes ?? []).filter(c => !x.hiddenMoney || !c.ready))),
    // Paid piece counts (not money) let every screen that cancels items tell which ones are paid; only lines with some paid.
    ...(pieces?.length ? { paidQuantities: Object.fromEntries(pieces) } : {}),
    ...(limits ? { cancelLimits: limits } : {}),
  } as PublicOrder;
}
