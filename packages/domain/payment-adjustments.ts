import type { State, Actor, Context, Order, OrderLine, Payment } from './types.js';
import { DomainError, once } from './engine.js';
import { applyMethodChanges, businessDay } from './history.js';
import { assertOpenDay, inClosedYear } from './closed-year.js';
import { selectionKey } from './stock.js';
import { cashierRefundLimits, cashierRefundProblem, OWNER_REQUIRED_TEXT, refundPower, refundReasonProblem, refundReasonText, splitRefund, type RefundableItem, type RefundReason } from './refund-rules.js';

/**
 * One refunded item: the part of a bill line given back, at what was actually paid for it (campaign price; a capped refund's
 * share). `key`: the line's option key (packages/domain/stock.ts selectionKey), so Kârlılık can take back the right cost.
 */
export type RefundItem = { orderId: string; lineId: string; productId: string; name: string; quantity: number; amount: number; grams?: number; key?: string };
/**
 * A correction of a payment: a refund ("İade", money given back) or a method change. Item refunds carry `items`; every new
 * refund keeps who gave it back (`role`, `byName`: the cash closing shows a cashier's refunds on their own line), the reason
 * chips (`reasons`) and whether the items went back into Stok unused (`restock`). `fromRequest`: the cashier's request it answered.
 */
export type PaymentAdjustment = { id: string; paymentId: string; kind: 'refund' | 'method'; amount: number; method: 'cash' | 'card'; commission: number; reason: string; actor: string; createdAt: string;
  items?: RefundItem[]; reasons?: RefundReason[]; restock?: boolean; role?: string; byName?: string; fromRequest?: string;
  /**
   * A refund of a bill whose year was already closed (packages/domain/closed-year.ts): everything of it, the refunded items
   * too, counts on the day it was given; the closed year never changes (history.ts summarize).
   */
  closedPeriod?: true };
/** A paid bill as an item refund needs it: its orders, every payment and every correction of those payments. */
export type RefundAccount = { orders: Order[]; payments: Payment[]; adjustments: PaymentAdjustment[] };
/**
 * "Sahibe iade isteği gönder": a refund a cashier may not do alone (above the owner's limits), waiting for the owner, who does
 * it from İade ve düzeltme (then `done` with the refund's id) or declines it. Kept in the snapshot: pending ones always,
 * decided ones for REQUEST_KEEP_DAYS.
 */
export type RefundRequest = { id: string; paymentId: string; tableName: string; paidAt: string; paymentMethod: 'cash' | 'card'; amount: number; method: 'cash' | 'card'; items?: RefundItem[]; reason: string; reasons?: RefundReason[]; note?: string; restock?: boolean;
  by: string; byName: string; at: string; status: 'pending' | 'done' | 'declined'; decidedAt?: string; decidedBy?: string; declineNote?: string; adjustmentId?: string };
export const REQUEST_KEEP_DAYS = 14, MAX_PENDING_REQUESTS = 100;

export function paymentLedger(s: State) {
  return applyMethodChanges([...s.archives.flatMap(a => a.payments), ...s.payments], s.paymentAdjustments ?? []);
}
/** The payment's bill from a plain State (tests, tools; the server reads it from long-term history: History.refundAccount). */
export function stateRefundAccount(s: State, p: Pick<Payment, 'accountId'>): RefundAccount {
  const orders = new Map<string, Order>();
  for (const o of [...s.archives.flatMap(a => a.orders), ...s.orders]) if (o.accountId === p.accountId) orders.set(o.id, o);
  const payments = paymentLedger(s).filter(x => x.accountId === p.accountId), ids = new Set(payments.map(x => x.id));
  return { orders: [...orders.values()], payments, adjustments: (s.paymentAdjustments ?? []).filter(a => ids.has(a.paymentId)) };
}

/**
 * What an item refund offers for one payment. Paid by choosing items: those items. Paid as an amount: the bill's lines not
 * paid by item in another payment (amount payments of one bill share their item refunds). Already refunded pieces are taken off.
 */
export function refundableItems(paymentId: string, account: RefundAccount): (RefundableItem & { key: string })[] {
  const p = account.payments.find(x => x.id === paymentId);
  if (!p) return [];
  const lines = new Map<string, { order: Order; line: OrderLine }>();
  for (const o of account.orders) if (o.accountId === p.accountId && o.status !== 'cancelled' && o.status !== 'awaiting_approval') for (const l of o.lines) lines.set(l.id, { order: o, line: l });
  const refundsOf = (ids: Set<string>) => {
    const m = new Map<string, number>();
    for (const a of account.adjustments) if (a.kind === 'refund' && ids.has(a.paymentId)) for (const i of a.items ?? []) m.set(i.lineId, (m.get(i.lineId) ?? 0) + i.quantity);
    return m;
  };
  const row = (orderId: string, l: OrderLine, paid: number, refunded: number) => ({ orderId, lineId: l.id, productId: l.productId, name: l.name, optionNames: l.optionNames, ...(l.grams ? { grams: l.grams } : {}), ...(l.note ? { note: l.note } : {}),
    // A line with free pieces (deals.ts): the average paid piece, rounded down, so a refund never gives back more than was paid.
    unit: l.grams ? l.total : l.deals?.length ? Math.floor(l.total / l.quantity) : l.unitPrice, paid, refunded, left: Math.max(0, paid - refunded), key: selectionKey(l.selections) });
  if (p.selections?.length) {
    const refunded = refundsOf(new Set([p.id]));
    return p.selections.flatMap(sel => { const f = lines.get(sel.lineId); return f && f.order.id === sel.orderId ? [row(sel.orderId, f.line, sel.quantity, refunded.get(sel.lineId) ?? 0)] : []; });
  }
  const sameBill = account.payments.filter(x => x.accountId === p.accountId);
  const refunded = refundsOf(new Set(sameBill.filter(x => !x.selections?.length).map(x => x.id)));
  const selected = new Map<string, number>();
  for (const x of sameBill) for (const sel of x.selections ?? []) selected.set(sel.lineId, (selected.get(sel.lineId) ?? 0) + sel.quantity);
  return [...lines.values()].flatMap(({ order, line }) => { const paid = line.quantity - (selected.get(line.id) ?? 0); return paid > 0 ? [row(order.id, line, paid, refunded.get(line.id) ?? 0)] : []; });
}

type RefundInput = { amount: number; method: 'cash' | 'card'; reason?: string; reasons?: RefundReason[]; note?: string; items?: { orderId: string; lineId: string; quantity: number }[] };
/** The checked refund: amount (items: computed from what was paid, capped at what the payment still has), items and reason. */
function prepareRefund(p: Payment, history: PaymentAdjustment[], account: RefundAccount | undefined, b: RefundInput) {
  // Paid online on a delivery platform: no money passed here, so refunds and corrections belong to the platform.
  if (p.method === 'platform') throw new DomainError('PLATFORM_PAYMENT', 'Platform ödemesi burada düzeltilemez; iade ve iptal platform üzerinden yapılır.', 409);
  if (!['cash', 'card'].includes(b.method)) throw new DomainError('INVALID_ADJUSTMENT', 'İadenin yapıldığı yöntemi seçin.');
  if (!Number.isSafeInteger(b.amount) || b.amount < 0) throw new DomainError('INVALID_AMOUNT', 'Tutar geçersiz.');
  let reason: string;
  if (b.reasons) {
    const problem = refundReasonProblem(b.reasons, b.note ?? '');
    if (problem) throw new DomainError('INVALID_ADJUSTMENT', problem);
    reason = refundReasonText(b.reasons, b.note ?? '');
  } else {
    reason = (b.reason ?? '').trim();
    if (!reason || reason.length > 500) throw new DomainError('INVALID_ADJUSTMENT', 'Gerekçe ve işlem türü gerekli.');
  }
  const remaining = p.amount - history.filter(a => a.kind === 'refund').reduce((n, a) => n + a.amount, 0);
  let items: RefundItem[] | undefined;
  if (b.items) {
    if (!b.items.length || b.items.length > 100) throw new DomainError('INVALID_ITEMS', 'İade edilecek ürünleri seçin.');
    const offered = new Map(refundableItems(p.id, account ?? { orders: [], payments: [p], adjustments: history }).map(i => [i.lineId, i]));
    const seen = new Set<string>(), chosen: { item: ReturnType<typeof refundableItems>[number]; quantity: number }[] = [];
    for (const c of b.items) {
      const item = offered.get(c.lineId);
      if (!item || item.orderId !== c.orderId || seen.has(c.lineId)) throw new DomainError('ITEMS_CHANGED', 'İade edilecek ürünler değişti. Pencereyi kapatıp yeniden açın.', 409);
      if (!Number.isSafeInteger(c.quantity) || c.quantity < 1 || c.quantity > item.left || (item.grams && c.quantity !== 1)) throw new DomainError('ITEMS_CHANGED', item.left ? `${item.name}: en çok ${item.left} adet iade edilebilir.` : `${item.name} zaten iade edildi.`, 409);
      seen.add(c.lineId); chosen.push({ item, quantity: c.quantity });
    }
    const values = chosen.map(c => c.item.unit * c.quantity), amount = Math.min(values.reduce((n, v) => n + v, 0), remaining);
    if (amount <= 0) throw new DomainError('INVALID_AMOUNT', 'Bu tahsilatta iade edilecek tutar kalmadı.', 409);
    if (b.amount !== amount) throw new DomainError('REFUND_CHANGED', 'İade tutarı değişti. Pencereyi kapatıp yeniden açın.', 409);
    const shares = splitRefund(values, amount);
    items = chosen.map(({ item, quantity }, i) => ({ orderId: item.orderId, lineId: item.lineId, productId: item.productId, name: item.name, quantity, amount: shares[i], ...(item.grams ? { grams: item.grams } : {}), ...(item.key ? { key: item.key } : {}) }));
  } else if (b.amount <= 0 || b.amount > remaining) throw new DomainError('INVALID_AMOUNT', 'İade kalan tahsilatı aşamaz.');
  return { amount: b.amount, items, reason, ...(b.reasons ? { reasons: [...new Set(b.reasons)] } : {}) };
}
const nameOf = (s: State, actor: Actor) => s.staffUsers?.find(u => u.id === actor.id)?.name ?? (actor.role === 'owner' ? 'İşletme sahibi' : 'Kasiyer');

/**
 * `stored`: the server's copy of a payment that already left the live snapshot, with every earlier correction, and its bill
 * (`account`) for item refunds. `usedToday`: the cashier's refunds of this cash day so far (limited roles only, the server counts them).
 */
export function adjustPayment(s: State, actor: Actor, b: { requestId: string; paymentId: string; revision: number; kind: 'refund' | 'method'; amount: number; method: PaymentAdjustment['method']; commission: number; reason?: string; reasons?: RefundReason[]; note?: string; items?: { orderId: string; lineId: string; quantity: number }[]; restock?: boolean; fromRequest?: string }, ctx: Context, stored?: { payment?: Payment; history: PaymentAdjustment[]; account?: RefundAccount }, limits?: { usedToday: number }) {
  // Owner and Müdür: full refunds and corrections (no amount limit); cashier: refunds within the owner's limits (refund-rules.ts).
  const power = actor.tenantId === s.tenantId ? refundPower(actor.role) : 'none';
  if (power === 'none' || (power !== 'full' && (b.kind !== 'refund' || b.fromRequest))) throw new DomainError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403);
  return once(s, actor, 'payment-adjustment', b.requestId, b, () => {
    s.paymentAdjustments ??= [];
    const history = stored ? stored.history : s.paymentAdjustments.filter(a => a.paymentId === b.paymentId);
    if (history.length !== b.revision) throw new DomainError('VERSION_CONFLICT', 'Tahsilat değişti. Listeyi yenileyin.', 409);
    const p = stored ? stored.payment : paymentLedger(s).find(p => p.id === b.paymentId);
    if (!p) throw new DomainError('NOT_FOUND', 'Tahsilat bulunamadı.', 404);
    if (p.method === 'platform') throw new DomainError('PLATFORM_PAYMENT', 'Platform ödemesi burada düzeltilemez; iade ve iptal platform üzerinden yapılır.', 409);
    if (!['refund', 'method'].includes(b.kind)) throw new DomainError('INVALID_ADJUSTMENT', 'Gerekçe ve işlem türü gerekli.');
    if (!Number.isSafeInteger(b.commission) || b.commission < 0) throw new DomainError('INVALID_AMOUNT', 'Tutar geçersiz.');
    // A payment of a closed year: its method stays as it was; a refund is allowed and counts today (closedPeriod).
    const closed = inClosedYear(s.closedThrough, businessDay(p.createdAt));
    if (closed && b.kind === 'method') assertOpenDay(s.closedThrough, businessDay(p.createdAt), 'Ödeme yöntemi düzeltilemez; gerekiyorsa iade bugünün kaydı olarak girilir.');
    const refunds = history.filter(a => a.kind === 'refund');
    let refund: ReturnType<typeof prepareRefund> | undefined, reason: string;
    if (b.kind === 'refund') {
      if (b.commission !== 0) throw new DomainError('INVALID_AMOUNT', 'İadede POS komisyonu otomatik geri alınmaz.');
      refund = prepareRefund(p, history, stored?.account ?? (stored ? undefined : stateRefundAccount(s, p)), b);
      reason = refund.reason;
      if (power === 'limited') {
        const problem = cashierRefundProblem(refund.amount, limits?.usedToday ?? 0, cashierRefundLimits(s.cashShift));
        if (problem) throw new DomainError('OWNER_REQUIRED', `${OWNER_REQUIRED_TEXT} ${problem}`, 403);
      }
    } else {
      reason = (b.reason ?? '').trim();
      if (!reason || reason.length > 500 || !['cash', 'card'].includes(b.method)) throw new DomainError('INVALID_ADJUSTMENT', 'Gerekçe ve işlem türü gerekli.');
      if (!Number.isSafeInteger(b.amount) || b.amount < 0) throw new DomainError('INVALID_AMOUNT', 'Tutar geçersiz.');
      if (refunds.length || b.amount !== 0 || b.method === p.method || b.commission > p.amount || (b.method === 'cash' && b.commission !== 0)) throw new DomainError('INVALID_ADJUSTMENT', 'İadeli tahsilatın yöntemi değiştirilemez. Yeni yöntem ve komisyonu kontrol edin.');
    }
    const request = b.fromRequest ? (s.refundRequests ?? []).find(r => r.id === b.fromRequest) : undefined;
    if (b.fromRequest && (!request || request.status !== 'pending' || request.paymentId !== p.id)) throw new DomainError('REQUEST_DONE', 'Bu iade isteği artık beklemiyor. Listeyi yenileyin.', 409);
    const row: PaymentAdjustment = { id: ctx.id(), paymentId: p.id, kind: b.kind, amount: b.amount, method: b.method, commission: b.commission, reason, actor: actor.id, createdAt: ctx.now.toISOString(),
      ...(refund ? { role: actor.role, byName: nameOf(s, actor), ...(refund.items ? { items: refund.items, ...(b.restock ? { restock: true } : {}) } : {}), ...(refund.reasons ? { reasons: refund.reasons } : {}) } : {}),
      ...(request ? { fromRequest: request.id } : {}), ...(closed ? { closedPeriod: true as const } : {}) };
    s.paymentAdjustments.push(row);
    if (request) { request.status = 'done'; request.decidedAt = row.createdAt; request.decidedBy = nameOf(s, actor); request.adjustmentId = row.id; }
    s.audit.push({ actor: actor.id, action: `payment.${b.kind}`, target: row.id, at: row.createdAt });
    return row;
  });
}

/** "Sahibe iade isteği gönder": the cashier's refund above the limits, checked like a refund and kept for the owner. */
export function requestRefund(s: State, actor: Actor, b: { requestId: string; paymentId: string; amount: number; method: 'cash' | 'card'; reasons: RefundReason[]; note?: string; items?: { orderId: string; lineId: string; quantity: number }[]; restock?: boolean }, ctx: Context, stored: { payment?: Payment; history: PaymentAdjustment[]; account?: RefundAccount; tableName: string }) {
  if (actor.tenantId !== s.tenantId || refundPower(actor.role) !== 'limited') throw new DomainError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403);
  return once(s, actor, 'refund-request', b.requestId, b, () => {
    const p = stored.payment;
    if (!p) throw new DomainError('NOT_FOUND', 'Tahsilat bulunamadı.', 404);
    const refund = prepareRefund(p, stored.history, stored.account, b);
    s.refundRequests = pruneRequests(s.refundRequests ?? [], ctx.now.getTime());
    if (s.refundRequests.filter(r => r.status === 'pending').length >= MAX_PENDING_REQUESTS) throw new DomainError('TOO_MANY_REQUESTS', 'Bekleyen çok fazla iade isteği var. İşletme sahibinin onları görmesini bekleyin.', 409);
    const r: RefundRequest = { id: ctx.id(), paymentId: p.id, tableName: stored.tableName, paidAt: p.createdAt, paymentMethod: p.method === 'card' ? 'card' : 'cash', amount: refund.amount, method: b.method, ...(refund.items ? { items: refund.items } : {}),
      reason: refund.reason, ...(refund.reasons ? { reasons: refund.reasons } : {}), ...(b.note?.trim() ? { note: b.note.trim() } : {}), ...(b.restock && refund.items ? { restock: true } : {}),
      by: actor.id, byName: nameOf(s, actor), at: ctx.now.toISOString(), status: 'pending' };
    s.refundRequests.push(r);
    s.audit.push({ actor: actor.id, action: 'payment.refund_requested', target: r.id, at: r.at });
    return r;
  });
}
/** The owner says no to a cashier's request (with an optional note the cashier sees). */
export function declineRefundRequest(s: State, actor: Actor, b: { id: string; note?: string }, ctx: Context) {
  if (actor.tenantId !== s.tenantId || refundPower(actor.role) !== 'full') throw new DomainError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403);
  const r = (s.refundRequests ?? []).find(x => x.id === b.id);
  if (!r) throw new DomainError('NOT_FOUND', 'İade isteği bulunamadı.', 404);
  if (r.status !== 'pending') return r;
  const note = b.note?.trim();
  if (note && note.length > 300) throw new DomainError('INVALID_NOTE', 'Not en fazla 300 karakter olabilir.');
  r.status = 'declined'; r.decidedAt = ctx.now.toISOString(); r.decidedBy = nameOf(s, actor); if (note) r.declineNote = note;
  s.audit.push({ actor: actor.id, action: 'payment.refund_declined', target: r.id, at: r.decidedAt });
  return r;
}
/** Pending requests stay; decided ones leave after REQUEST_KEEP_DAYS. */
export function pruneRequests(list: RefundRequest[], now: number) {
  return list.filter(r => r.status === 'pending' || now - Date.parse(r.decidedAt ?? r.at) < REQUEST_KEEP_DAYS * 86400_000);
}
const weight = (grams: number) => grams >= 1000 ? `${String(Math.round(grams / 10) / 100).replace('.', ',')} kg` : `${grams} g`;
/** "2 × Latte, Baklava (500 g)" for notices, lists and the cash closing. */
export const refundItemsText = (items: readonly Pick<RefundItem, 'name' | 'quantity' | 'grams'>[]) => items.map(i => i.grams ? `${i.name} (${weight(i.grams)})` : `${i.quantity} × ${i.name}`).join(', ');
