import { saleProducts, discountedPrice, productQuantity, repriceSavedLine, campaignUsage, campaignQuantities } from './campaigns.js';
import { changeSideText, readCancelReason, readNote, repriceWeightLine, soldByWeight, validGrams, weightBase, weightOffers, withNote } from './lines.js';
import { changeBlock, readyBlock, readyMade } from './order-change.js';
import { isTakeaway, takeawayDay, takeawayLabel, takeawayName } from './takeaway.js';
import { depositCredit } from './reservations.js';
import { commissionOf } from './commission.js';
import { selectionKey } from './stock.js';
import { productVat, vatSettings, type VatSettings } from './vat.js';
import { applyBillDeals, billTotalWith, lineGross, settleDeals, unitsCost } from './deals.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Account, Actor, CafeTable, CartLine, ChangeSide, Context, Order, OrderLine, OrderStatus, Product, State, StockQuestion } from './types.js';

export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function requireRole(s: State, actor: Actor, roles: Actor['role'][]) {
  if (actor.tenantId !== s.tenantId || !roles.includes(actor.role)) throw new DomainError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403);
}
export function assertInt(value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new DomainError('INVALID_VALUE', 'Geçerli bir miktar girin.');
}
/**
 * Until when the guest may still change a QR order; the kitchen starts after it. Only QR guest orders have this window:
 * staff, masasız and platform orders start at once (also older staff orders that were saved with a deadline).
 */
export function changeDeadline(order: Pick<Order, 'editableUntil' | 'createdAt' | 'source'>, seconds: number) {
  if (order.source !== 'qr') return Date.parse(order.createdAt);
  return order.editableUntil ? Date.parse(order.editableUntil) : Date.parse(order.createdAt) + seconds * 1000;
}
/** A guest may ask to cancel only before the order is ready; the kitchen answers requests while it is still on its board. */
const GUEST_CANCELLABLE: readonly OrderStatus[] = ['awaiting_approval', 'new', 'preparing'];
const CANCEL_ANSWERABLE: readonly OrderStatus[] = ['new', 'preparing', 'ready'];
/** Cancel requests left on orders nobody can answer any more (served before this rule existed) are dropped. */
function clearStuckCancelRequests(s: State) {
  for (const o of s.orders) if (o.cancelRequested && !CANCEL_ANSWERABLE.includes(o.status)) { o.cancelRequested = false; o.version++; }
}
function activeAccount(s: State, id: string): Account {
  const a = s.accounts.find(a => a.id === id);
  if (!a || a.status !== 'open') throw new DomainError('ACCOUNT_CLOSED', 'Bu hesap kapanmış. QR kodunu yeniden açın.', 409);
  return a;
}
export function balances(s: State, accountId: string) {
  const total = s.orders.filter(o => o.accountId === accountId && o.status !== 'cancelled').reduce((a, o) => a + o.total, 0);
  const paid = s.payments.filter(p => p.accountId === accountId).reduce((a, p) => a + p.amount, 0);
  // A seated reservation's kapora covers the bill until it closes (packages/domain/reservations.ts); `paid` stays real payments.
  const credit = depositCredit(s, s.accounts.find(a => a.id === accountId));
  return { total, paid, balance: total - paid - credit, ...(credit ? { depositCredit: credit } : {}) };
}
/** The server keeps answered requests outside the snapshot and attaches a lookup to the states it hands out. */
export const storedRequests = new WeakMap<State, (scope: string) => State['requests'][string] | undefined>();
export function once<T>(s: State, actor: Actor, kind: string, key: string, body: unknown, fn: () => T): T {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new DomainError('INVALID_REQUEST_ID', 'İşlem kimliği geçersiz.');
  const scope = `${actor.tenantId}:${actor.id}:${kind}:${key}`;
  const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const previous = s.requests[scope] ?? storedRequests.get(s)?.(scope);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new DomainError('REQUEST_CONFLICT', 'Aynı işlem kimliği farklı içerikle kullanılamaz.', 409);
    return structuredClone(previous.result) as T;
  }
  const result = fn();
  s.requests[scope] = { fingerprint, result: structuredClone(result) };
  return result;
}
/** The cleaned item note; too long or not text is refused rather than silently cut. */
export function lineNote(value: unknown) {
  const note = readNote(value);
  if (note === null) throw new DomainError('INVALID_NOTE', 'Ürün notu en fazla 140 karakter olabilir.');
  return note;
}
/** "Paketlensin": an order-level yes/no. Missing means no on a new order and "keep as it was" on an edit (older pending edits). */
function packedChoice(value: unknown) {
  if (value !== undefined && typeof value !== 'boolean') throw new DomainError('INVALID_VALUE', 'Paketleme tercihi geçersiz.');
  return value as boolean | undefined;
}
/**
 * Per item "Paket yapılsın" (13 Ekim): `all` (the order-level choice of older screens and "Hepsini paketle") packs every line;
 * a takeaway ticket keeps none (always to go). The order flag is "every line packed", so older readers still see it.
 */
function applyPacking(o: Pick<Order, 'packed'>, lines: OrderLine[], takeaway: boolean, all: boolean | undefined) {
  for (const l of lines) { if (takeaway || all === false) delete l.packed; else if (all === true) l.packed = true; }
  if (!takeaway && lines.length > 0 && lines.every(l => l.packed)) o.packed = true; else delete o.packed;
}
/** Weighed products need grams and one line per weight; piece products must not carry grams. */
function checkWeight(p: Product, line: CartLine) {
  if (soldByWeight(p) ? !validGrams(line.grams) || line.quantity !== 1 : line.grams !== undefined) throw new DomainError('INVALID_WEIGHT', soldByWeight(p) ? 'Ağırlığı 50 g ile 20 kg arasında, 50 g adımlarla seçin.' : 'Bu ürün artık adetle satılıyor. Sepetinizi güncelleyin.');
}
/** `vat`: the business's KDV settings; given (every order), each line carries the rate it is sold with (OrderLine.vatRate). */
export function quote(products: Product[], cart: CartLine[], ctx: Context, quantityContext = cart, vat?: VatSettings): OrderLine[] {
  if (!Array.isArray(cart) || cart.length < 1 || cart.length > 30) throw new DomainError('INVALID_CART', 'Sepetinize ürün ekleyin.');
  for (const line of quantityContext) assertInt(line.quantity, 1, 20);
  const lines: OrderLine[] = cart.map(line => {
    assertInt(line.quantity, 1, 20);
    const p = products.find(p => p.id === line.productId);
    // The café's own menu decides (the guest's phone, or Mola Merkez's menu copy, may be a few seconds behind): plainly said.
    if (!p || p.published === false || p.soldOut) throw new DomainError('ITEM_UNAVAILABLE', p ? `Bu ürün az önce tükendi: ${p.name}. Sepetinizden çıkarıp yeniden gönderin.` : 'Bu ürün az önce tükendi. Sepetinizi güncelleyin.', 409);
    if (!Array.isArray(line.selections) || line.selections.length > p.groups.length) throw new DomainError('INVALID_OPTIONS', 'Ürün seçeneklerini kontrol edin.');
    if (new Set(line.selections.map(s => s.groupId)).size !== line.selections.length) throw new DomainError('INVALID_OPTIONS', 'Aynı seçenek grubu tekrarlanamaz.');
    let unitPrice = p.price;
    const optionNames: string[] = [];
    for (const g of p.groups) if (g.required && !line.selections.some(s => s.groupId === g.id)) throw new DomainError('OPTION_REQUIRED', `${g.name} seçin.`);
    for (const sel of line.selections) {
      const group = p.groups.find(g => g.id === sel.groupId);
      const option = group?.options.find(o => o.id === sel.optionId);
      if (!option) throw new DomainError('INVALID_OPTIONS', 'Seçenek artık bulunamıyor.');
      unitPrice += option.extra; optionNames.push(option.name);
    }
    checkWeight(p, line);
    // Only the known fields are kept: the note is stored cleaned, grams only on weighed lines.
    if (line.packed !== undefined && typeof line.packed !== 'boolean') throw new DomainError('INVALID_VALUE', 'Paketleme tercihi geçersiz.');
    const note = lineNote(line.note), base = { productId: line.productId, quantity: line.quantity, selections: structuredClone(line.selections), ...(note ? { note } : {}), ...(line.packed === true ? { packed: true } : {}) };
    if (soldByWeight(p)) {
      const extra = unitPrice - p.price, original = weightBase(p.price, line.grams!, extra);
      assertInt(original, 1, 100_000_000);
      const offers = weightOffers(p.discounts), discount = discountedPrice({ discounts: offers }, original, 1);
      return { ...base, grams: line.grams, weightPricing: { perKg: p.price, extra, ...(offers?.length ? { offers: structuredClone(offers) } : {}) }, ...(discount.campaigns.length ? { originalUnitPrice: original, campaigns: discount.campaigns } : {}), id: ctx.id(), name: p.name, code: p.code, optionNames, unitPrice: discount.price, total: discount.price };
    }
    assertInt(unitPrice, 1, 100_000_000);
    const originalUnitPrice = unitPrice; const discount = discountedPrice(p, unitPrice, productQuantity(quantityContext, p.id)); unitPrice = discount.price;
    const quantityPricing = p.discounts?.some(c => (c.minQuantity ?? 1) > 1) ? { original: originalUnitPrice, offers: structuredClone(p.discounts) } : undefined;
    // Account campaigns (deals.ts) are stamped as they are now; the bill is priced with them once the order is on it.
    return { quantityPricing, ...(p.deals?.length ? { dealOffers: structuredClone(p.deals) } : {}), ...(discount.campaigns.length ? { originalUnitPrice, campaigns: discount.campaigns } : {}), ...base, id: ctx.id(), name: p.name, code: p.code, optionNames, unitPrice, total: unitPrice * line.quantity };
  });
  if (vat) for (const l of lines) l.vatRate = productVat(products.find(p => p.id === l.productId), vat);
  return lines;
}
function checkCampaignLimits(s: State, lines: OrderLine[], exceptOrderId?: string) {
  if (!s.campaigns?.some(c => c.maxQuantity != null)) return;
  const used = campaignUsage(s, exceptOrderId), requested = campaignQuantities(lines);
  for (const c of s.campaigns) if (c.maxQuantity != null) {
    const remaining = Math.max(0, c.maxQuantity - (used.get(c.id) ?? 0));
    if ((requested.get(c.id) ?? 0) > remaining) throw new DomainError('CAMPAIGN_LIMIT', `“${c.name}” kampanyası için ${remaining} adet yer kaldı. Kampanyalı ürünlerin adedini azaltıp tekrar deneyin.`, 409);
  }
}
export function submitOrder(s: State, actor: Actor, input: { requestId: string; tableId: string; lines: CartLine[]; expectedTotal: number; packed?: boolean }, ctx: Context) {
  requireRole(s, actor, ['guest', 'owner', 'manager', 'cashier', 'waiter']);
  return once(s, actor, 'order', input.requestId, input, () => {
    const table = s.tables.find(t => t.id === input.tableId);
    if (!table) throw new DomainError('TABLE_NOT_FOUND', 'Masa bulunamadı.', 404);
    // A masasız (takeaway) ticket has no QR; once paid and closed it is never reopened, the next customer gets a new number.
    if (isTakeaway(table) && actor.role === 'guest') throw new DomainError('FORBIDDEN', 'Başka masaya sipariş veremezsiniz.', 403);
    if (isTakeaway(table) && !table.accountId) throw new DomainError('TAKEAWAY_CLOSED', 'Bu masasız sipariş kapandı. Sipariş al ekranından yeni masasız sipariş açın.', 409);
    if (actor.role === 'guest') {
      if (s.blocked.includes(actor.id)) throw new DomainError('BROWSER_BLOCKED', 'Bu tarayıcıdan sipariş verilmesi işletme tarafından durduruldu.', 403);
      if (actor.tableId !== table.id) throw new DomainError('FORBIDDEN', 'Başka masaya sipariş veremezsiniz.', 403);
      if (actor.epoch !== table.epoch) throw new DomainError('ACCOUNT_CLOSED', 'Bu hesap kapanmış. QR kodunu yeniden açın.', 409);
    }
    if (table.needsCleaning) throw new DomainError('TABLE_CLEANING', 'Masa temizlik bekliyor. Garson masayı hazır hale getirdikten sonra sipariş verebilirsiniz.', 409);
    // A leaked table QR must not be able to bury the kitchen: QR orders not yet started are capped per table.
    if (actor.role === 'guest' && table.accountId && s.orders.filter(o => o.accountId === table.accountId && o.source === 'qr' && ['awaiting_approval', 'new'].includes(o.status)).length >= 20) throw new DomainError('TOO_MANY_PENDING', 'Bu masada hazırlanmayı bekleyen çok sipariş var. Lütfen personelle görüşün.', 429);
    // A takeaway ticket is always to go, so packing is only kept on table orders (per item, or all with the order choice).
    const packedAll = packedChoice(input.packed);
    const lines = quote(saleProducts(s, ctx.now), input.lines, ctx, input.lines, vatSettings(s));
    const packing: Pick<Order, 'packed'> = {}; applyPacking(packing, lines, isTakeaway(table), packedAll || undefined);
    checkCampaignLimits(s, lines);
    const total = lines.reduce((sum, l) => sum + l.total, 0);
    if (total !== input.expectedTotal) throw new DomainError('PRICE_CHANGED', 'Fiyat değişti. Menüyü yenileyip toplamı yeniden kontrol edin.', 409);
    let a = table.accountId ? activeAccount(s, table.accountId) : undefined;
    if (!a) {
      a = { id: ctx.id(), tableId: table.id, status: 'open', version: 0, openedAt: ctx.now.toISOString() };
      s.accounts.push(a); table.accountId = a.id;
    }
    const participants = [...new Set(s.orders.filter(o => o.accountId === a!.id && o.source === 'qr').map(o => o.guestId))];
    let n = participants.indexOf(actor.id);
    if (n < 0) n = participants.length;
    // Sales on a reserved table or an event table are tagged for the reports ("Rezervasyon"), also after a table move.
    const eventId = a.guest?.eventId ?? table.event?.id, tag = a.guest?.reservationId || eventId ? { reservation: { ...(a.guest?.reservationId ? { id: a.guest.reservationId } : {}), ...(eventId ? { eventId } : {}) } } : {};
    const order: Order = { ...tag, ...packing, paymentBeforePreparation: s.paymentMode === 'before_preparation', id: ctx.id(), number: (s.orderNumberBase ?? 0) + s.orders.length + 1, accountId: a.id, guestId: actor.id, guestLabel: actor.role === 'guest' ? `Misafir ${n + 1}` : 'Personel', source: actor.role === 'guest' ? 'qr' : 'staff', createdAt: ctx.now.toISOString(), status: actor.role === 'guest' && s.waiterApproval && !s.autoApproveQr ? 'awaiting_approval' : 'new', approvalRequired: actor.role === 'guest' && !!s.waiterApproval, version: 1, menuRevision: s.menuRevision, lines, total, cancelRequested: false };
    // The change window is the guest's: staff orders go to the kitchen at once.
    if (order.source === 'qr') order.editableUntil = new Date(ctx.now.getTime() + s.changeSeconds * 1000).toISOString();
    s.orders.push(order); a.version++;
    applyBillDeals(s, a.id);
    return { orderId: order.id, number: order.number, accountId: a.id };
  });
}
/**
 * Opens a takeaway ticket with its first order in one step, so an abandoned basket never leaves an empty ticket or uses
 * up a number. Later rounds go through submitOrder with the ticket's tableId like any table.
 */
export function submitTakeaway(s: State, actor: Actor, input: { requestId: string; label?: string; lines: CartLine[]; expectedTotal: number }, ctx: Context) {
  requireRole(s, actor, ['owner', 'manager', 'cashier', 'waiter']);
  return once(s, actor, 'takeaway', input.requestId, input, () => {
    const label = takeawayLabel(input.label);
    if (label === null) throw new DomainError('INVALID_LABEL', 'En fazla 24 karakterlik kısa bir isim yazın. Telefon numarası yazmayın.');
    const before = { tables: [...s.tables], accounts: s.accounts.length, counter: s.takeawayCounter };
    const day = takeawayDay(ctx.now), number = s.takeawayCounter?.day === day ? s.takeawayCounter.last + 1 : 1;
    const table: CafeTable = { takeaway: { number, day, ...(label ? { label } : {}) }, id: ctx.id(), name: takeawayName(number), token: '', epoch: 0, accountId: null };
    const account: Account = { id: ctx.id(), tableId: table.id, status: 'open', version: 0, openedAt: ctx.now.toISOString() };
    s.tables.push(table); s.accounts.push(account); table.accountId = account.id; s.takeawayCounter = { day, last: number };
    try {
      const order = submitOrder(s, actor, { requestId: input.requestId, tableId: table.id, lines: input.lines, expectedTotal: input.expectedTotal }, ctx);
      return { ...order, tableId: table.id, takeawayNumber: number, tableName: table.name };
    } catch (e) { s.tables = before.tables; s.accounts.splice(before.accounts); if (before.counter) s.takeawayCounter = before.counter; else delete s.takeawayCounter; throw e; }
  });
}
export function setStatus(s: State, actor: Actor, id: string, version: number, status: OrderStatus, now = new Date()) {
  const o = s.orders.find(o => o.id === id);
  // At the counter the cashier hands masasız orders over, so the cashier may mark those served too.
  const counter = !!o && isTakeaway(s.tables.find(t => t.id === s.accounts.find(a => a.id === o.accountId)?.tableId));
  // Mutfak fişi modu has no kitchen screen: the counter (cashier, Müdür, owner) says a platform order is "Hazır", which
  // tells the platform (external-orders.ts queueExternalUpdates). Owner's decision 5 Oct; may change later.
  const platformReady = status === 'ready' && !!o?.external && s.kitchenMode === 'ticket';
  requireRole(s, actor, status === 'served' ? ['owner', 'manager', 'kitchen', 'waiter', ...(counter ? ['cashier' as const] : [])] : ['owner', 'kitchen', ...(platformReady ? ['manager' as const, 'cashier' as const] : [])]);
  clearStuckCancelRequests(s);
  if (!o) throw new DomainError('NOT_FOUND', 'Sipariş bulunamadı.', 404);
  if (o.version !== version) throw new DomainError('VERSION_CONFLICT', 'Sipariş başka bir ekranda değişti. Güncel durumu kontrol edin.', 409);
  const next: Partial<Record<OrderStatus, OrderStatus>> = { new: 'preparing', preparing: 'ready', ready: 'served' };
  // Mutfak fişi modu: no kitchen screen says "Hazır"; the waiter hands a printed (preparing) order over directly.
  const handOver = s.kitchenMode === 'ticket' && o.status === 'preparing' && status === 'served';
  // A paid masasız order (not a platform one): the counter hands it over when the customer takes it, in either kitchen mode,
  // even before the kitchen says "Hazır" (the strip notes "Mutfakta hazırlanıyor" and the cashier decides).
  const early = status === 'served' && counter && !o.external && (o.status === 'new' || o.status === 'preparing') && ['owner', 'manager', 'cashier'].includes(actor.role) && isOrderPaid(s, o);
  if (next[o.status] !== status && !handOver && !early) throw new DomainError('INVALID_TRANSITION', 'Bu durum değişikliğine izin verilmiyor.', 409);
  if (o.cancelRequested) throw new DomainError('CANCELLATION_PENDING', 'Önce iptal talebini onaylayın veya reddedin.', 409);
  if (o.paymentBeforePreparation && (status === 'preparing' || status === 'served') && !isOrderPaid(s, o)) throw new DomainError('PAYMENT_REQUIRED', 'Hazırlık ve teslim için önce bu siparişin ödemesi alınmalı.', 409);
  if (status === 'preparing' && now.getTime() < changeDeadline(o, s.changeSeconds)) throw new DomainError('CHANGE_WINDOW_OPEN', 'Müşterinin değişiklik süresi bitmeden hazırlık başlatılamaz.', 409);
  // The kitchen's "Geri al" (undoStatus) may take the last step back for a few seconds; served is never undone.
  const from = o.status; o.status = status; o.version++;
  if (status === 'served') delete o.statusUndo; else o.statusUndo = { from, at: now.toISOString() };
  const account = s.accounts.find(a => a.id === o.accountId && a.status === 'open');
  if (account && s.orders.some(v => v.accountId === account.id && v.paymentBeforePreparation) && balances(s, account.id).balance === 0 && s.orders.filter(v => v.accountId === account.id).every(v => ['served', 'cancelled'].includes(v.status))) { account.version++; closePaidAccount(s, account, { now, id: randomUUID }); }
  return { status, version: o.version };
}
/** "Geri al" on the kitchen board: shown for 5 s; the server allows a little more for the network. */
export const STATUS_UNDO_MS = 5000, STATUS_UNDO_GRACE_MS = 2000;
/**
 * The kitchen takes back its last status change (a mistaken or double tap): preparing → new, ready → preparing, and only
 * within STATUS_UNDO_MS of that change, on the same order version. Never served, never after the platform heard "hazır".
 */
export function undoStatus(s: State, actor: Actor, input: { requestId: string; orderId: string; version: number }, ctx: Context) {
  requireRole(s, actor, ['owner', 'kitchen']);
  return once(s, actor, 'status-undo', input.requestId, input, () => {
    const o = s.orders.find(o => o.id === input.orderId);
    if (!o) throw new DomainError('NOT_FOUND', 'Sipariş bulunamadı.', 404);
    if (o.version !== input.version) throw new DomainError('VERSION_CONFLICT', 'Sipariş başka bir ekranda değişti; geri alınamadı.', 409);
    const back: Partial<Record<OrderStatus, OrderStatus>> = { preparing: 'new', ready: 'preparing' }, to = back[o.status], u = o.statusUndo;
    if (!to || !u || u.from !== to || ctx.now.getTime() - Date.parse(u.at) > STATUS_UNDO_MS + STATUS_UNDO_GRACE_MS) throw new DomainError('UNDO_EXPIRED', 'Geri alma süresi doldu. Sipariş olduğu yerde kaldı.', 409);
    if (o.status === 'ready' && s.externalOrders?.some(e => e.orderId === o.id && (e.reported.includes('ready') || e.outbox.some(x => x.action === 'ready')))) throw new DomainError('UNDO_EXPIRED', 'Platforma “hazır” bildirildi; geri alınamaz.', 409);
    const from = o.status;
    o.status = to; o.version++; delete o.statusUndo;
    s.audit.push({ action: 'order.status_undone', actor: actor.id, target: `${o.id}:${from}->${to}`, at: ctx.now.toISOString() });
    return { status: to, version: o.version };
  });
}
/**
 * An order's lines after an edit (the guest's editOrder, the waiter's changeByStaff): a line that keeps its product and
 * options keeps its saved price (quantity offers counted again, a weighed line repriced from its saved per-kg price; the
 * note is just text); a new product or other options are priced from today's menu.
 */
function relined(s: State, o: Order, input: (CartLine & { existingId?: string })[], ctx: Context): OrderLine[] {
  const seen = new Set<string>();
  for (const line of input) assertInt(line.quantity, 1, 20);
  const selectionKey = (l: CartLine) => JSON.stringify(l.selections.map(x => [x.groupId, x.optionId]).sort());
  // "Paket yapılsın" follows the edited line (editOrder puts an older edit's order-level choice back).
  const packing = (l: CartLine, line: OrderLine) => { if (l.packed !== undefined && typeof l.packed !== 'boolean') throw new DomainError('INVALID_VALUE', 'Paketleme tercihi geçersiz.'); if (l.packed === true) line.packed = true; else delete line.packed; return line; };
  return input.map(l => packing(l, edited(l)));
  function edited(l: CartLine & { existingId?: string }): OrderLine {
    assertInt(l.quantity, 1, 20);
    const previous = l.existingId ? o.lines.find(p => p.id === l.existingId) : undefined;
    if (l.existingId && (!previous || seen.has(l.existingId))) throw new DomainError('INVALID_LINE', 'Sipariş kalemi geçersiz.');
    if (l.existingId) seen.add(l.existingId);
    if (previous && previous.productId === l.productId && selectionKey(previous) === selectionKey(l) && (previous.grams === undefined) === (l.grams === undefined)) {
      const available = s.products.some(p => p.id === l.productId && p.published !== false && !p.soldOut), note = lineNote(l.note);
      if (previous.grams !== undefined) {
        if (!validGrams(l.grams) || l.quantity !== 1) throw new DomainError('INVALID_WEIGHT', 'Ağırlığı 50 g ile 20 kg arasında, 50 g adımlarla seçin.');
        if (l.grams > previous.grams && !available) throw new DomainError('ITEM_UNAVAILABLE', 'Tükenen ürünün miktarı artırılamaz.', 409);
        return withNote(repriceWeightLine(structuredClone(previous), l.grams), note);
      }
      if (l.quantity > previous.quantity && !available) throw new DomainError('ITEM_UNAVAILABLE', 'Tükenen ürünün adedi artırılamaz.', 409);
      return withNote(settleDeals(repriceSavedLine(structuredClone(previous), l.quantity, productQuantity(input, l.productId)), previous), note);
    }
    return quote(saleProducts(s, ctx.now), [{ productId: l.productId, quantity: l.quantity, selections: l.selections, note: l.note, grams: l.grams }], ctx, input, vatSettings(s))[0];
  }
}
export function editOrder(s: State, actor: Actor, input: { requestId: string; orderId: string; version: number; expectedTotal: number; packed?: boolean; lines: (CartLine & { existingId?: string })[] }, ctx: Context) {
  requireRole(s, actor, ['guest']);
  return once(s, actor, 'edit-order', input.requestId, input, () => {
    const o = s.orders.find(o => o.id === input.orderId);
    if (!o) throw new DomainError('NOT_FOUND', 'Sipariş bulunamadı.', 404);
    if (o.guestId !== actor.id || o.source !== 'qr') throw new DomainError('FORBIDDEN', 'Yalnızca kendi siparişinizi değiştirebilirsiniz.', 403);
    const a = activeAccount(s, o.accountId); const table = s.tables.find(t => t.id === a.tableId)!;
    if (actor.tableId !== table.id || actor.epoch !== table.epoch) throw new DomainError('ACCOUNT_CLOSED', 'QR kodunu yeniden açın.', 409);
    if (s.blocked.includes(actor.id)) throw new DomainError('BROWSER_BLOCKED', 'Bu tarayıcının sipariş yetkisi durduruldu.', 403);
    if (o.version !== input.version) throw new DomainError('VERSION_CONFLICT', 'Sipariş başka bir ekranda değişti. Kapatıp güncel siparişi açın.', 409);
    if (!['new', 'awaiting_approval'].includes(o.status) || ctx.now.getTime() >= changeDeadline(o, s.changeSeconds)) throw new DomainError('EDIT_WINDOW_CLOSED', 'Sipariş değiştirme süresi doldu.', 409);
    if (balances(s, a.id).paid > 0) throw new DomainError('CASHIER_REVIEW', 'Bu hesaba ödeme girilmiş. Kasiyerle görüşün.', 409);
    if (!input.lines.length || input.lines.length > 30) throw new DomainError('INVALID_CART', 'En az bir ürün bırakın. Tamamı için siparişi iptal edin.');
    // Inside the edit window the guest may also change "Paketlensin"; the kitchen sees it as an ordinary edit.
    const packed = packedChoice(input.packed);
    const lines = relined(s, o, input.lines, ctx);
    checkCampaignLimits(s, lines, o.id);
    // Screens price an edit before account campaigns (deals.ts): the bill is priced with them afterwards.
    const total = lines.reduce((n, l) => n + l.total, 0);
    if (lines.reduce((n, l) => n + lineGross(l), 0) !== input.expectedTotal) throw new DomainError('PRICE_CHANGED', 'Fiyat değişti. Güncel toplamı kontrol edip tekrar deneyin.', 409);
    if (o.approvalRequired && !s.autoApproveQr) { o.status = 'awaiting_approval'; o.reviewedBy = undefined; }
    // Per item since 13 Ekim: the lines bring their own choice; an older edit (no line choices) keeps the order's as it was.
    const keepOld = packed === undefined && !input.lines.some(l => l.packed !== undefined);
    if (keepOld) { if (o.packed) for (const l of lines) l.packed = true; }
    applyPacking(o, lines, isTakeaway(table), packed === true ? true : undefined);
    o.lines = lines; o.total = total; o.version++; o.updatedAt = ctx.now.toISOString(); a.version++;
    applyBillDeals(s, a.id);
    s.audit.push({ action: 'order.edited', actor: actor.id, target: o.id, at: o.updatedAt });
    return { orderId: o.id, number: o.number, version: o.version, total: o.total };
  });
}
export function cancelOrder(s: State, actor: Actor, input: { requestId: string; orderId: string; version: number }, ctx: Context) {
  requireRole(s, actor, ['guest', 'owner', 'manager', 'kitchen']);
  clearStuckCancelRequests(s);
  return once(s, actor, 'cancel', input.requestId, input, () => {
    const o = s.orders.find(o => o.id === input.orderId);
    if (!o) throw new DomainError('NOT_FOUND', 'Sipariş bulunamadı.', 404);
    if (actor.role === 'guest' && o.guestId !== actor.id) throw new DomainError('FORBIDDEN', 'Yalnızca kendi siparişinizi değiştirebilirsiniz.', 403);
    if (actor.role === 'kitchen' && (!o.cancelRequested || !['new', 'preparing', 'ready'].includes(o.status))) throw new DomainError('FORBIDDEN', 'Mutfak yalnız bekleyen iptal taleplerini onaylayabilir.', 403);
    const a = activeAccount(s, o.accountId);
    if (actor.role === 'guest') { const table = s.tables.find(t => t.id === a.tableId)!; if (actor.tableId !== table.id || actor.epoch !== table.epoch) throw new DomainError('ACCOUNT_CLOSED', 'Masa oturumu değişti. Yeni masanın QR kodunu okutun.', 409); }
    if (o.version !== input.version) throw new DomainError('VERSION_CONFLICT', 'Sipariş güncellendi. Tekrar kontrol edin.', 409);
    if (o.status === 'cancelled') throw new DomainError('INVALID_TRANSITION', 'Sipariş zaten iptal edildi.', 409);
    // Ready or served: nothing left for the kitchen to stop, so the guest talks to the staff instead.
    if (actor.role === 'guest' && !GUEST_CANCELLABLE.includes(o.status)) throw new DomainError('CANCEL_CLOSED', 'Siparişiniz hazırlandı, artık buradan iptal edilemez. Lütfen personelle görüşün.', 409);
    // 9 Ekim kullanıcı testi (K-I): a declined request is the café's answer; the guest does not ask again and again from the phone.
    if (actor.role === 'guest' && o.cancelDeclineReason) throw new DomainError('CANCEL_DECLINED', 'İptal talebiniz reddedildi. Lütfen personelle görüşün.', 409);
    if (balances(s, a.id).paid > 0) throw new DomainError('CASHIER_REVIEW', 'Bu hesaba ödeme girilmiş. Kasiyerle görüşün.', 409);
    const automatic = actor.role === 'owner' || actor.role === 'manager' || actor.role === 'kitchen' || (o.status === 'awaiting_approval' || (o.status === 'new' && ctx.now.getTime() < changeDeadline(o, s.changeSeconds)));
    if (!automatic) { delete o.cancelDeclineReason; o.cancelRequested = true; o.version++; return { requested: true }; }
    const stockQuestion = askStock(o, o.status, o.lines, actor, ctx);
    o.status = 'cancelled'; delete o.cancelDeclineReason; o.cancelRequested = false; o.version++; a.version++;
    applyBillDeals(s, a.id);
    if (actor.role === 'kitchen') s.audit.push({ action: 'order.cancel_approved', actor: actor.id, target: o.id, at: ctx.now.toISOString() });
    return { requested: false, ...(stockQuestion ? { stockQuestion } : {}) };
  });
}
export function declineCancellation(s: State, actor: Actor, input: { requestId: string; orderId: string; version: number; reason: string }, ctx: Context) {
  requireRole(s, actor, ['owner', 'manager', 'kitchen']);
  return once(s, actor, 'cancel-decline', input.requestId, input, () => {
    const o = s.orders.find(o => o.id === input.orderId);
    if (!o) throw new DomainError('NOT_FOUND', 'Sipariş bulunamadı.', 404);
    activeAccount(s, o.accountId);
    if (o.version !== input.version) throw new DomainError('VERSION_CONFLICT', 'Sipariş güncellendi. Tekrar kontrol edin.', 409);
    if (!o.cancelRequested || !['new', 'preparing', 'ready'].includes(o.status)) throw new DomainError('INVALID_TRANSITION', 'Bekleyen iptal talebi bulunamadı.', 409);
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 200) throw new DomainError('INVALID_VALUE', '3–200 karakterlik kısa bir açıklama yazın.');
    o.cancelRequested = false; o.cancelDeclineReason = reason; o.version++;
    s.audit.push({ action: 'order.cancel_declined', actor: actor.id, target: o.id, at: ctx.now.toISOString() });
    return { ok: true };
  });
}
/** The kitchen had started (or served) the order: whether its stock was used is asked (StockQuestion in types.ts). */
const KITCHEN_STARTED: readonly OrderStatus[] = ['preparing', 'ready', 'served'];
function askStock(o: Order, before: OrderStatus, lines: OrderLine[], actor: Actor, ctx: Context) {
  if (!KITCHEN_STARTED.includes(before) || !lines.length) return undefined;
  const q: StockQuestion = { id: ctx.id(), at: ctx.now.toISOString(), by: actor.id, lines: lines.map(l => ({ productId: l.productId, name: l.name, key: selectionKey(l.selections), quantity: l.quantity, ...(l.grams !== undefined ? { grams: l.grams } : {}) })) };
  o.stockQuestions = [...(o.stockQuestions ?? []), q];
  return q.id;
}
const PAID_HINT = 'Ödenmiş ürün iptal edilemez. Parası geri verilecekse işletme sahibi Kasa ve giderler → İadeler bölümünden iadeyi kaydeder.';
/** Quantity of each line of this order already paid by item payments. */
function paidQuantities(s: State, o: Order) {
  const paid = new Map<string, number>();
  for (const sel of s.payments.filter(p => p.accountId === o.accountId).flatMap(p => p.selections ?? [])) if (sel.orderId === o.id) paid.set(sel.lineId, (paid.get(sel.lineId) ?? 0) + sel.quantity);
  return paid;
}
/**
 * Staff take a whole order, or some items of it, off the bill (waiter, kitchen; the owner as supervisor; never the cashier,
 * who takes the money). Always with a reason. Paid items stay: their money goes back only as a refund record (İade ve düzeltme).
 * `lines` missing or covering everything cancels the order; otherwise the rest goes on and the kitchen gets an İPTAL slip for the part.
 */
export function cancelByStaff(s: State, actor: Actor, input: { requestId: string; orderId: string; version: number; reason: string; lines?: { lineId: string; quantity: number }[] }, ctx: Context) {
  requireRole(s, actor, ['owner', 'manager', 'waiter', 'kitchen']);
  return once(s, actor, 'staff-cancel', input.requestId, input, () => {
    const reason = readCancelReason(input.reason);
    if (!reason) throw new DomainError('REASON_REQUIRED', 'İptal nedenini seçin veya en az 3 karakterle yazın.');
    const o = s.orders.find(o => o.id === input.orderId);
    if (!o) throw new DomainError('NOT_FOUND', 'Sipariş bulunamadı.', 404);
    // 10 Ekim son kullanıcı testi: the kitchen cancelled while the counter closed the bill; staff were told the guest's
    // "QR kodunu yeniden açın". The bill is paid: the money goes back with an İade at the counter, not with a cancellation.
    if (s.accounts.find(x => x.id === o.accountId)?.status !== 'open') throw new DomainError('ACCOUNT_CLOSED', 'Bu siparişin hesabı kapandı (ödeme alındı); sipariş artık iptal edilemez. Para geri verilecekse kasada “İade” yapılır.', 409);
    const a = activeAccount(s, o.accountId);
    if (o.version !== input.version) throw new DomainError('VERSION_CONFLICT', 'Sipariş başka bir ekranda değişti. Güncel siparişi kontrol edin.', 409);
    if (o.status === 'cancelled') throw new DomainError('INVALID_TRANSITION', 'Sipariş zaten iptal edildi.', 409);
    if (o.status === 'awaiting_approval') throw new DomainError('APPROVAL_PENDING', 'Onay bekleyen QR siparişini “Reddet” ile kapatın.', 409);
    const paid = paidQuantities(s, o), before = balances(s, a.id);
    const asked = input.lines ?? o.lines.map(l => ({ lineId: l.id, quantity: l.quantity }));
    if (!asked.length || asked.length > 30) throw new DomainError('INVALID_SELECTION', 'İptal edilecek ürünleri seçin.');
    const chosen = new Set<string>();
    for (const { lineId, quantity } of asked) {
      const line = o.lines.find(l => l.id === lineId);
      if (!line || chosen.has(lineId)) throw new DomainError('INVALID_SELECTION', 'Sipariş ürünleri değişti. Pencereyi yeniden açın.', 409);
      assertInt(quantity, 1, line.quantity);
      if (line.grams !== undefined && quantity !== line.quantity) throw new DomainError('INVALID_SELECTION', 'Kiloyla satılan ürün bölünemez; satırın tamamını seçin.');
      chosen.add(lineId);
    }
    // Chosen items go line by line: one the rules refuse (paid, a paid item's campaign price, money taken) is reported back
    // and the others still go. "The whole order" (no `lines`) is all or nothing, as before.
    let cut = new Map<string, number>();
    const refused: { lineId: string; quantity: number; name: string; reason: string; code: string }[] = [];
    if (!input.lines) {
      cut = new Map(asked.map(x => [x.lineId, x.quantity]));
      const problem = cutProblem(s, o, cut, paid, before);
      if (problem) throw new DomainError(problem.code, problem.message, 409);
    } else for (const { lineId, quantity } of asked) {
      const trial = new Map(cut).set(lineId, quantity), problem = cutProblem(s, o, trial, paid, before);
      if (problem) refused.push({ lineId, quantity, name: o.lines.find(l => l.id === lineId)!.name, reason: problem.message, code: problem.code });
      else cut = trial;
    }
    if (!cut.size) throw new DomainError(refused[0].code, refused[0].reason, 409);
    const at = ctx.now.toISOString();
    const whole = o.lines.every(l => cut.get(l.id) === l.quantity);
    let stockQuestion: string | undefined;
    if (whole) {
      stockQuestion = askStock(o, o.status, o.lines, actor, ctx);
      o.status = 'cancelled'; o.cancelRequested = false; delete o.cancelDeclineReason; o.cancelReason = reason; o.cancelledBy = actor.id;
      o.version++; a.version++; applyBillDeals(s, a.id);
      s.audit.push({ action: 'order.cancelled_by_staff', actor: actor.id, target: o.id, at });
    } else {
      const { lines, total } = remainingAfterCut(o, cut);
      // The cancelled part keeps its price before account campaigns (deals.ts): those belong to what stays on the bill.
      const removed = o.lines.filter(l => cut.has(l.id)).map(l => { const { deals: _d, ...line } = structuredClone(l); return { ...line, quantity: cut.get(l.id)!, total: l.grams !== undefined ? l.total : l.unitPrice * cut.get(l.id)! }; });
      o.cancellations = [...(o.cancellations ?? []), { id: ctx.id(), at, by: actor.id, reason, lines: removed, ...(o.printedTo?.length ? { printTo: [...o.printedTo] } : {}) }];
      stockQuestion = askStock(o, o.status, removed, actor, ctx);
      o.lines = lines; o.total = total; o.version++; a.version++; applyBillDeals(s, a.id);
      s.audit.push({ action: 'order.items_cancelled', actor: actor.id, target: o.id, at });
    }
    // What is left may be paid already: the bill closes as after the last payment.
    const after = balances(s, a.id), waitForService = s.orders.some(v => v.accountId === a.id && v.paymentBeforePreparation && !['served', 'cancelled'].includes(v.status));
    if (after.paid > 0 && after.balance === 0 && !waitForService) closePaidAccount(s, a, ctx);
    return { cancelled: whole ? 'order' as const : 'items' as const, total: whole ? 0 : o.total, closed: a.status === 'closed', ...(stockQuestion ? { stockQuestion } : {}), ...(refused.length ? { refused: refused.map(({ code: _, ...r }) => r) } : {}) };
  });
}
/**
 * Garson siparişi değiştirir (order-change.ts): one line becomes another product, quantity, options or note, while the
 * kitchen has not started it and nothing of the order is paid. The price difference is the bill's (a new product is priced
 * from today's menu, a kept one keeps its saved price); a bill that took money as an amount may not drop below it. The
 * change is kept on the order (`changes`) for the kitchen card ("Değişti: Kola → Ayran") and, when the order already
 * printed, owes a DEĞİŞİKLİK slip to those printers.
 */
export function changeByStaff(s: State, actor: Actor, input: { requestId: string; orderId: string; version: number; lineId: string; line: CartLine; expectedTotal: number }, ctx: Context) {
  requireRole(s, actor, ['owner', 'manager', 'waiter']);
  return once(s, actor, 'staff-change', input.requestId, input, () => {
    const o = s.orders.find(o => o.id === input.orderId);
    if (!o) throw new DomainError('NOT_FOUND', 'Sipariş bulunamadı.', 404);
    if (s.accounts.find(x => x.id === o.accountId)?.status !== 'open') throw new DomainError('ACCOUNT_CLOSED', 'Bu siparişin hesabı kapandı; artık değiştirilemez.', 409);
    const a = activeAccount(s, o.accountId);
    if (o.version !== input.version) throw new DomainError('VERSION_CONFLICT', 'Sipariş başka bir ekranda değişti. Pencereyi kapatıp yeniden açın.', 409);
    const old = o.lines.find(l => l.id === input.lineId);
    if (!old) throw new DomainError('INVALID_LINE', 'Sipariş ürünleri değişti. Pencereyi yeniden açın.', 409);
    const paid = { ...o, paidQuantities: Object.fromEntries(paidQuantities(s, o)) }, block = changeBlock(paid, s.kitchenMode === 'ticket');
    // Hazır ürün (kutu kola ↔ ayran): any time until it is paid, without the kitchen, when the new product is ready-made too.
    const product = (id: string) => s.products.find(p => p.id === id);
    const ready = !!block && readyMade(product(old.productId)) && readyMade(product(input.line.productId));
    if (block && !ready) throw new DomainError('CHANGE_CLOSED', readyMade(product(old.productId)) ? 'Mutfak başladı: hazır ürün yalnız başka bir hazır ürünle (kola, ayran, su…) değiştirilebilir; hazırlanacak ürün için yeni sipariş girin.' : block, 409);
    const readyStop = ready ? readyBlock(paid, old.id) : null;
    if (readyStop) throw new DomainError('CHANGE_CLOSED', readyStop, 409);
    const keep = (l: OrderLine) => ({ productId: l.productId, quantity: l.quantity, selections: l.selections, ...(l.note ? { note: l.note } : {}), ...(l.grams !== undefined ? { grams: l.grams } : {}), existingId: l.id });
    const lines = relined(s, o, o.lines.map(l => l.id === old.id ? { productId: input.line.productId, quantity: input.line.quantity, selections: input.line.selections, note: input.line.note, grams: input.line.grams, existingId: old.id } : keep(l)), ctx);
    const fresh = lines[o.lines.indexOf(old)];
    const side = (l: OrderLine): ChangeSide => ({ name: l.name, quantity: l.quantity, ...(l.grams !== undefined ? { grams: l.grams } : {}), optionNames: [...l.optionNames], ...(l.note ? { note: l.note } : {}) });
    if (JSON.stringify(side(old)) === JSON.stringify(side(fresh))) throw new DomainError('NO_CHANGE', 'Bir değişiklik yapmadınız.');
    checkCampaignLimits(s, lines, o.id);
    const total = lines.reduce((n, l) => n + l.total, 0);
    if (lines.reduce((n, l) => n + lineGross(l), 0) !== input.expectedTotal) throw new DomainError('PRICE_CHANGED', 'Fiyat değişti. Güncel tutarı kontrol edip tekrar deneyin.', 409);
    // With account campaigns (deals.ts) the whole bill is priced again: another order's free tea may come or go.
    const before = balances(s, a.id), after = billTotalWith(s, a.id, { orderId: o.id, lines }) ?? before.total - o.total + total;
    if (after < before.paid) throw new DomainError('PAID_ITEMS', 'Bu hesaba tutar olarak ödeme alındı; değişiklikle hesap ödenenin altına düşer. Önce işletme sahibi iadeyi yapmalı.', 409);
    if ((o.changes?.length ?? 0) >= 30) throw new DomainError('TOO_MANY_CHANGES', 'Bu sipariş çok kez değişti. Ürünü iptal edip yeni sipariş girin.', 409);
    const at = ctx.now.toISOString();
    // A ready-made swap never involves the kitchen: no DEĞİŞİKLİK slip, no kitchen note.
    const slip = !ready && !!o.printedTo?.length, delta = after - before.total;
    o.changes = [...(o.changes ?? []), { id: ctx.id(), at, by: actor.id, from: side(old), to: side(fresh), ...(slip ? { printTo: [...o.printedTo!] } : {}), ...(ready ? { ready: true } : {}), ...(delta ? { delta } : {}) }];
    o.lines = lines; o.total = total; o.version++; a.version++; applyBillDeals(s, a.id);
    s.audit.push({ action: ready ? 'order.ready_item_changed' : 'order.line_changed', actor: actor.id, target: `${o.id}:${old.name}->${fresh.name}:${delta}`, at });
    return { orderId: o.id, number: o.number, version: o.version, total: o.total, delta, from: changeSideText(side(old)), to: changeSideText(side(fresh)), slip, ready };
  });
}
/** What stays on the order after `cut`: remaining items keep their saved price; quantity offers ("4 al 3 öde") are counted again on what is left, like a guest edit. */
function remainingAfterCut(o: Order, cut: Map<string, number>) {
  const left = o.lines.flatMap(l => { const n = l.quantity - (cut.get(l.id) ?? 0); return n ? [{ ...l, quantity: n }] : []; });
  const touched = new Set(o.lines.filter(l => cut.has(l.id)).map(l => l.productId));
  const lines = left.map(l => touched.has(l.productId) ? settleDeals(repriceSavedLine(structuredClone(l), l.quantity, productQuantity(left, l.productId)), o.lines.find(x => x.id === l.id)) : structuredClone(l));
  return { lines, total: lines.reduce((n, l) => n + l.total, 0) };
}
const CAMPAIGN_HINT = 'Bu ürünün kampanya fiyatı ödenen ürüne bağlı; önce iadeyi işletme sahibi yapmalı.';
const AMOUNT_HINT = 'Bu hesaba tutar olarak ödeme alındı; bu iptal hesabı ödenenin altına düşürür. Önce iadeyi işletme sahibi yapmalı.';
/** Why taking `cut` off a live order would be refused (a paid item, a paid item's campaign price, money already taken), or null. */
function cutProblem(s: State, o: Order, cut: Map<string, number>, paid: Map<string, number>, before: { total: number; paid: number }): { code: string; message: string } | null {
  for (const l of o.lines) if ((cut.get(l.id) ?? 0) > l.quantity - (paid.get(l.id) ?? 0)) return { code: 'PAID_ITEMS', message: PAID_HINT };
  // With account campaigns (deals.ts) the rest of the bill is priced again: a free tea elsewhere may become paid.
  if (o.lines.every(l => cut.get(l.id) === l.quantity)) return o.paidAt || (billTotalWith(s, o.accountId, { orderId: o.id, lines: null }) ?? before.total - o.total) < before.paid ? { code: 'PAID_ITEMS', message: AMOUNT_HINT } : null;
  const { lines, total } = remainingAfterCut(o, cut);
  // A paid line keeps its price: its unit price, and the free pieces of a line that has some (a cut would move them).
  if (lines.some(l => { const old = o.lines.find(x => x.id === l.id)!; return (paid.get(l.id) ?? 0) > 0 && (l.unitPrice !== old.unitPrice || (!!old.deals?.length && l.quantity !== old.quantity)); })) return { code: 'PAID_ITEMS', message: CAMPAIGN_HINT };
  if ((billTotalWith(s, o.accountId, { orderId: o.id, lines }) ?? before.total - (o.total - total)) < before.paid) return { code: 'PAID_ITEMS', message: AMOUNT_HINT };
  return null;
}
/**
 * For the staff cancel window (StaffSnapshot orders): lines whose unpaid units cannot all be cancelled because of a paid
 * item's campaign price or money already taken on the bill, with how many may go and the plain reason. Nothing paid: none.
 */
export function cancelLimits(s: State, o: Order): Record<string, { max: number; reason: string }> | undefined {
  if (['cancelled', 'awaiting_approval'].includes(o.status) || !s.payments.some(p => p.accountId === o.accountId)) return undefined;
  const paid = paidQuantities(s, o), before = balances(s, o.accountId), out: Record<string, { max: number; reason: string }> = {};
  for (const l of o.lines) {
    const free = l.quantity - (paid.get(l.id) ?? 0);
    if (free <= 0) continue;
    // Largest amount allowed on its own; usually the first try (all of it) already passes.
    let max = 0, reason = '';
    for (const q of l.grams !== undefined ? [l.quantity] : Array.from({ length: free }, (_, i) => free - i)) {
      const problem = cutProblem(s, o, new Map([[l.id, q]]), paid, before);
      if (!problem) { max = q; break; }
      reason ||= problem.message;
    }
    if (max < free) out[l.id] = { max, reason };
  }
  return Object.keys(out).length ? out : undefined;
}
export function recordPayment(s: State, actor: Actor, input: { selections?: import('./types.js').PaymentSelection[]; requestId: string; accountId: string; version: number; method: 'cash' | 'card'; amount: number; tendered: number }, ctx: Context) {
  requireRole(s, actor, ['owner', 'manager', 'cashier']);
  return once(s, actor, 'payment', input.requestId, input, () => {
    const a = activeAccount(s, input.accountId);
    if (a.version !== input.version) throw new DomainError('VERSION_CONFLICT', 'Hesap güncellendi. Güncel tutarı kontrol edin.', 409);
    if (s.orders.some(o => o.accountId === a.id && o.status === 'awaiting_approval')) throw new DomainError('APPROVAL_PENDING', 'Önce garson onayını bekleyen siparişler değerlendirilmeli.', 409);
    const { balance } = balances(s, a.id);
    if (input.selections) {
      if (!input.selections.length || input.selections.length > 100) throw new DomainError('INVALID_SELECTION', 'Ödenecek ürünleri seçin.');
      const paid = s.payments.filter(p => p.accountId === a.id);
      if (paid.some(p => !p.selections)) throw new DomainError('UNALLOCATED_PAYMENT', 'Bu hesapta tutar bazlı ödeme var. Kalan tutarı tutar girerek tahsil edin.', 409);
      if (a.deposit && !a.deposit.settledAt) throw new DomainError('UNALLOCATED_PAYMENT', 'Bu hesaptan kapora düşülüyor. Kalan tutarı tutar girerek tahsil edin.', 409);
      const seen = new Set<string>(); let selectedTotal = 0;
      for (const sel of input.selections) {
        assertInt(sel.quantity, 1, 20);
        const o = s.orders.find(o => o.id === sel.orderId && o.accountId === a.id && !['cancelled', 'awaiting_approval'].includes(o.status));
        const line = o?.lines.find(l => l.id === sel.lineId), key = `${sel.orderId}:${sel.lineId}`;
        if (!line || seen.has(key)) throw new DomainError('INVALID_SELECTION', 'Ödeme ürünleri değişti. Ekranı yeniden açın.', 409);
        if (line.grams !== undefined && sel.quantity !== 1) throw new DomainError('INVALID_SELECTION', 'Kiloyla satılan ürün bölünemez; satırın tamamını seçin.', 409);
        seen.add(key);
        const already = paid.flatMap(p => p.selections ?? []).filter(p => p.orderId === sel.orderId && p.lineId === sel.lineId).reduce((n, p) => n + p.quantity, 0);
        if (sel.quantity + already > line.quantity) throw new DomainError('ITEM_ALREADY_PAID', 'Seçilen ürünün bu adedi zaten ödendi.', 409);
        // A line with free or cheaper pieces (deals.ts) charges its full-price pieces first.
        selectedTotal += unitsCost(line, already, sel.quantity);
      }
      if (input.amount !== selectedTotal) throw new DomainError('INVALID_AMOUNT', 'Seçilen ürünlerin tutarı değişti.', 409);
    }
    assertInt(input.amount, 1, 100_000_000); assertInt(input.tendered, 1, 100_000_000);
    if (input.amount > balance) throw new DomainError('OVERPAYMENT', 'Kalan hesaptan fazla tahsilat girilemez.', 409);
    if (input.method !== 'cash' && input.method !== 'card') throw new DomainError('INVALID_METHOD', 'Ödeme yöntemi geçersiz.');
    if (input.tendered < input.amount || (input.method === 'card' && input.tendered !== input.amount)) throw new DomainError('INVALID_TENDER', 'Alınan tutarı kontrol edin.');
    const payment = { id: ctx.id(), accountId: a.id, amount: input.amount, tendered: input.tendered, change: input.method === 'cash' ? input.tendered - input.amount : 0, method: input.method, createdAt: ctx.now.toISOString(), commission: input.method === 'card' ? commissionOf(input.amount, s.commissionBps) : null, by: actor.id };
    const accountOrders = s.orders.filter(o => o.accountId === a.id && !['cancelled', 'awaiting_approval'].includes(o.status));
    const campaignTotal = accountOrders.flatMap(o => o.lines).filter(l => l.campaigns?.length || l.deals?.length).reduce((n, l) => n + l.total, 0);
    const previousPayments = s.payments.filter(p => p.accountId === a.id);
    let campaignAmount: number | null = null;
    if (input.selections) campaignAmount = input.selections.reduce((n, selected) => {
      const line = accountOrders.find(o => o.id === selected.orderId)!.lines.find(l => l.id === selected.lineId)!;
      const earlier = previousPayments.flatMap(p => p.selections ?? []).filter(p => p.orderId === selected.orderId && p.lineId === selected.lineId).reduce((m, p) => m + p.quantity, 0);
      return n + (line.campaigns?.length || line.deals?.length ? unitsCost(line, earlier, selected.quantity) : 0);
    }, 0);
    else if (campaignTotal === 0) campaignAmount = 0;
    else if (accountOrders.reduce((n, o) => n + o.total, 0) === campaignTotal) campaignAmount = input.amount;
    else if (input.amount === balance && previousPayments.every(p => typeof p.campaignAmount === 'number')) campaignAmount = campaignTotal - previousPayments.reduce((n, p) => n + (p.campaignAmount ?? 0), 0);
    s.payments.push({ ...payment, campaignAmount, ...(input.selections ? { selections: structuredClone(input.selections) } : {}) }); a.version++;
    for (const order of s.orders.filter(o => o.accountId === a.id && o.status !== 'cancelled')) if (!order.paidAt && isOrderPaid(s, order)) order.paidAt = ctx.now.toISOString();
    const remaining = balance - input.amount;
    const waitForService = s.orders.some(o => o.accountId === a.id && o.paymentBeforePreparation && !['served', 'cancelled'].includes(o.status));
    if (remaining === 0 && !waitForService) closePaidAccount(s, a, ctx);
    return { paymentId: payment.id, change: payment.change, remaining, closed: a.status === 'closed' };
  });
}
export function closeEmptyAccount(s: State, actor: Actor, accountId: string, now?: Date) {
  requireRole(s, actor, ['owner', 'manager', 'cashier']);
  const a = activeAccount(s, accountId);
  if (balances(s, a.id).total !== 0 || balances(s, a.id).paid !== 0) throw new DomainError('NOT_EMPTY', 'Hesabı tahsilat ekranından kapatın.', 409);
  settleGuest(s, a, { now: now ?? new Date(), id: randomUUID });
  a.status = 'closed'; a.version++; if (now) a.closedAt = now.toISOString();
  const table = s.tables.find(t => t.id === a.tableId)!; table.accountId = null; table.epoch++; table.needsCleaning = !!s.cleaningEnabled && !isTakeaway(table);
  return { closed: true };
}

export function moveTable(s: State, actor: Actor, input: { requestId: string; accountId: string; version: number; targetId: string; targetEpoch: number }, ctx: Context) {
  requireRole(s, actor, ['owner', 'manager', 'cashier', 'waiter']);
  return once(s, actor, 'move-table', input.requestId, input, () => {
    const account = activeAccount(s, input.accountId);
    if (account.version !== input.version) throw new DomainError('VERSION_CONFLICT', 'Hesap değişti. Pencereyi kapatıp güncel hesabı açın.', 409);
    const source = s.tables.find(t => t.id === account.tableId)!;
    const target = s.tables.find(t => t.id === input.targetId);
    if (isTakeaway(source) || isTakeaway(target)) throw new DomainError('TAKEAWAY_FIXED', 'Masasız sipariş masaya taşınamaz, masa da masasız siparişe taşınamaz.', 409);
    if (!target || target.id === source.id) throw new DomainError('INVALID_TABLE', 'Farklı bir boş masa seçin.');
    if (target.needsCleaning || target.accountId || target.epoch !== input.targetEpoch) throw new DomainError('TABLE_CHANGED', 'Hedef masa değişti veya artık boş değil. Pencereyi kapatıp tekrar deneyin.', 409);
    source.accountId = null; source.epoch++; source.needsCleaning = !!s.cleaningEnabled;
    target.accountId = account.id; target.epoch++;
    account.tableId = target.id; account.version++;
    for (const o of s.orders.filter(o => o.accountId === account.id)) { o.version++; o.tableMovedFrom = source.name; }
    s.audit.push({ action: 'table.moved', actor: actor.id, target: `${account.id}:${source.id}->${target.id}`, at: ctx.now.toISOString() });
    return { accountId: account.id, tableId: target.id, tableName: target.name };
  });
}

export function markTableClean(s: State, actor: Actor, input: { requestId: string; tableId: string; epoch: number }, ctx: Context) {
  // The waiter cleans; the cashier may mark it too when no waiter is around (owner's decision), the owner and Müdür as supervisors.
  requireRole(s, actor, ['owner', 'manager', 'cashier', 'waiter']);
  return once(s, actor, 'table-clean', input.requestId, input, () => {
    const table = s.tables.find(t => t.id === input.tableId);
    if (!table || table.accountId || table.epoch !== input.epoch || !table.needsCleaning) throw new DomainError('TABLE_CHANGED', 'Masanın durumu değişti. Güncel durumu kontrol edin.', 409);
    table.needsCleaning = false;
    // Keep sessions scanned while cleaning valid; the next close/move still expires them.
    s.audit.push({ action: 'table.cleaned', actor: actor.id, target: table.id, at: ctx.now.toISOString() });
    return { ok: true };
  });
}


export function isOrderPaid(s: State, order: Pick<Order, 'id' | 'accountId' | 'lines' | 'paidAt'>) {
  if (order.paidAt) return true;
  if (balances(s, order.accountId).balance === 0) return true;
  const selections = s.payments.filter(p => p.accountId === order.accountId).flatMap(p => p.selections ?? []);
  return order.lines.every(l => selections.filter(p => p.orderId === order.id && p.lineId === l.id).reduce((sum, p) => sum + p.quantity, 0) >= l.quantity);
}
/**
 * A seated reservation's bill is closing: the kapora part that covered it becomes a Payment marked `deposit` (part of the
 * sale; the drawer counted the money when it was taken), what is left waits for the owner's choice, and the reservation
 * notes that its guest left.
 */
export function settleGuest(s: State, a: Account, ctx: Context) {
  const at = ctx.now.toISOString(), deposit = a.deposit;
  if (deposit && !deposit.paymentId && !deposit.settledAt) {
    const credit = depositCredit(s, a), r = s.reservations?.find(r => r.id === deposit.reservationId);
    if (credit > 0) {
      const id = ctx.id(), campaigns = s.orders.some(o => o.accountId === a.id && o.status !== 'cancelled' && o.lines.some(l => l.campaigns?.length || l.deals?.length));
      s.payments.push({ id, accountId: a.id, amount: credit, tendered: credit, change: 0, method: deposit.method, createdAt: at, commission: deposit.method === 'card' ? commissionOf(credit, s.commissionBps) : null, campaignAmount: campaigns ? null : 0, deposit: { reservationId: deposit.reservationId, takenAt: deposit.takenAt } });
      deposit.paymentId = id;
    }
    deposit.settledAt = at;
    if (r?.deposit) {
      r.deposit.applied = credit; r.deposit.appliedAt = at;
      if (r.deposit.amount > credit) r.deposit.pending = { amount: r.deposit.amount - credit, reason: 'leftover', since: at };
      r.updatedAt = at;
    }
  }
  const r = a.guest?.reservationId ? s.reservations?.find(r => r.id === a.guest!.reservationId) : undefined;
  if (r && !r.closedAt) { r.closedAt = at; r.updatedAt = at; }
}
/** "Kaporayla kapat": the kapora covers the whole bill, nothing is left to collect. */
export function closeWithDeposit(s: State, actor: Actor, input: { requestId: string; accountId: string; version: number }, ctx: Context) {
  requireRole(s, actor, ['owner', 'manager', 'cashier']);
  return once(s, actor, 'close-deposit', input.requestId, input, () => {
    const a = activeAccount(s, input.accountId);
    if (a.version !== input.version) throw new DomainError('VERSION_CONFLICT', 'Hesap güncellendi. Güncel tutarı kontrol edin.', 409);
    if (s.orders.some(o => o.accountId === a.id && o.status === 'awaiting_approval')) throw new DomainError('APPROVAL_PENDING', 'Önce garson onayını bekleyen siparişler değerlendirilmeli.', 409);
    const b = balances(s, a.id);
    if (!b.depositCredit || b.balance !== 0) throw new DomainError('NOT_COVERED', 'Kapora bu hesabı karşılamıyor. Kalan tutarı tahsil edin.', 409);
    a.version++; closePaidAccount(s, a, ctx);
    return { closed: true };
  });
}
function closePaidAccount(s: State, a: Account, ctx: Context) {
  settleGuest(s, a, ctx);
  const table = s.tables.find(t => t.id === a.tableId)!;
  const payments = s.payments.filter(p => p.accountId === a.id);
  // A ready masasız order is paid for at the counter and handed over in the same moment.
  // Mutfak fişi modu: paying a table's bill also means everything printed reached the table (unprinted orders are served
  // once printed). A masasız customer often pays first and waits at the counter: the strip keeps it until "Teslim et".
  const handedOver: OrderStatus[] = isTakeaway(table) ? ['ready'] : s.kitchenMode === 'ticket' ? ['preparing', 'ready'] : [];
  for (const o of s.orders.filter(o => o.accountId === a.id && handedOver.includes(o.status) && !o.cancelRequested)) { o.status = 'served'; o.version++; delete o.statusUndo; }
  s.archives.push({ id: ctx.id(), accountId: a.id, tableName: table.name, closedAt: ctx.now.toISOString(), total: balances(s, a.id).total, cash: payments.filter(p => p.method === 'cash').reduce((n, p) => n + p.amount, 0), card: payments.filter(p => p.method === 'card').reduce((n, p) => n + p.amount, 0), payments: structuredClone(payments), orders: structuredClone(s.orders.filter(o => o.accountId === a.id)) });
  a.status = 'closed'; a.closedAt = ctx.now.toISOString(); table.accountId = null; table.epoch++; table.needsCleaning = !!s.cleaningEnabled && !isTakeaway(table);
}
