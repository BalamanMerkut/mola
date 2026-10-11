import { DomainError, requireRole } from './engine.js';
import { takeawayDay, takeawayLabel } from './takeaway.js';
import type { Account, Actor, CafeTable, Context, Order, OrderLine, Role, State } from './types.js';
import { externalName, PLATFORMS, REJECT_REASONS, type DeliveryType, type ExternalSource, type PlatformId } from './platforms.js';
import { productVat, vatSettings } from './vat.js';
export * from './platforms.js';

// Dış sipariş entegrasyonları (Yemeksepeti, Getir Yemek, Trendyol Yemek, Migros Yemek and the built-in "Deneme platformu").
// Server-side rules (browser-safe names and channels: platforms.ts); the café server polls the platforms (server/integrations/) and calls these inside store.mutate.
// An incoming order waits in `State.externalOrders` ("Onay bekliyor") and never touches tables, kitchen, payments or reports
// until someone accepts it. Kabul opens a hidden masasız ticket named after the platform ("Yemeksepeti #1234") with one
// order carrying `Order.external`; from there the kitchen, counter, receipts and history work as for any masasız order.
// Everything stays on the café computer: nothing here is ever sent to Mola Merkez.

/** One item as the platform sends it; prices in kuruş. */
export type IncomingItem = { externalId?: string; name: string; quantity: number; unitPrice: number; note?: string; options?: string[] };
/** An order as an adapter reads it from the platform. `status: 'cancelled'`: the platform (or the customer) cancelled it. */
export type IncomingOrder = { externalId: string; code?: string; customerName?: string; note?: string; deliveryType?: DeliveryType; paidOnline?: boolean; total: number; receivedAt?: string; acceptBy?: string; items: IncomingItem[]; status?: 'new' | 'cancelled'; cancelReason?: string };
/** pending: "Onay bekliyor". missed: the platform's accept deadline passed without an answer. */
export type ExternalStage = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'missed';
export type PlatformCall = 'accept' | 'reject' | 'ready' | 'delivered' | 'cancel';
/** A platform call still owed after a local step (kitchen Hazır, teslim, iptal); retried with backoff until it goes through. */
export type OutboxItem = { action: 'ready' | 'delivered' | 'cancel'; reason?: string; attempts: number; nextAt: string; error?: string };
export type ExternalOrder = ExternalSource & {
  id: string; version: number; acceptBy?: string; items: IncomingItem[]; stage: ExternalStage;
  orderId?: string; tableId?: string; reason?: string; reported: PlatformCall[]; outbox: OutboxItem[];
  /** Last failed platform call, shown on the card ("Platforma iletilemedi: …"). */
  error?: string; decidedBy?: string; updatedAt: string;
};
/** Platform item (by its id, or by name when it has none) → Mola product. */
export type MenuMapping = { key: string; name: string; productId: string };
export type PlatformSettings = { enabled: boolean; autoAccept?: boolean; mapping?: MenuMapping[]; lastOrderAt?: string };

/** Finished records stay this long for the Entegrasyonlar list, then only their key stays (dedupe). */
export const KEEP_FINISHED_MS = 48 * 3600_000;
const SEEN_MAX = 2000, MISSED_GRACE_MS = 2 * 60_000;
const BACKOFF_S = [5, 15, 30, 60, 120, 300];

const clean = (value: unknown, max: number) => {
  if (typeof value !== 'string') return undefined;
  const text = value.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return text ? [...text].slice(0, max).join('') : undefined;
};
const kurus = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100_000_000;
const isoOr = (value: unknown, fallback: string) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
/** A first name to call out; never a phone number (same rule as the masasız name). */
function customer(value: unknown) {
  let name = clean(value, 40);
  if (name && (name.match(/\d/g)?.length ?? 0) > 2) name = clean(name.replace(/\d/g, ''), 40);
  return name;
}
export const itemKey = (item: Pick<IncomingItem, 'externalId' | 'name'>) => item.externalId ? `id:${item.externalId}` : `name:${item.name.toLocaleLowerCase('tr-TR')}`;
const lower = (v: string) => v.toLocaleLowerCase('tr-TR').trim();

/** The Mola product an item stands for: the owner's mapping first, then a product with exactly the same name. */
export function matchItem(s: State, platform: PlatformId, item: Pick<IncomingItem, 'externalId' | 'name'>) {
  const mapped = s.integrationSettings?.[platform]?.mapping?.find(m => m.key === itemKey(item));
  const byMap = mapped && s.products.find(p => p.id === mapped.productId);
  if (byMap) return byMap;
  return s.products.find(p => lower(p.name) === lower(item.name));
}
export function sourceOf(e: ExternalOrder): ExternalSource {
  return { platform: e.platform, externalId: e.externalId, ...(e.code ? { code: e.code } : {}), ...(e.customerName ? { customerName: e.customerName } : {}), ...(e.note ? { note: e.note } : {}), ...(e.deliveryType ? { deliveryType: e.deliveryType } : {}), ...(e.paidOnline ? { paidOnline: true } : {}), total: e.total, receivedAt: e.receivedAt };
}
/** Reads one incoming order: new ones wait for approval, known ones are never added twice (dedupe by platform + externalId). */
export function receiveExternalOrder(s: State, platform: PlatformId, input: IncomingOrder, ctx: Context): { id: string | null; created: boolean; autoAccept?: boolean } {
  const externalId = clean(input?.externalId, 80);
  if (!externalId) throw new DomainError('INVALID_EXTERNAL_ORDER', 'Platformdan gelen siparişin numarası okunamadı.');
  const known = s.externalOrders?.find(e => e.platform === platform && e.externalId === externalId);
  if (known) {
    if (input.status === 'cancelled') platformCancelled(s, known, clean(input.cancelReason, 120) ?? 'Platform iptal etti', ctx);
    return { id: known.id, created: false };
  }
  if (s.externalSeen?.includes(`${platform}:${externalId}`) || input.status === 'cancelled') return { id: null, created: false };
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) throw new DomainError('INVALID_EXTERNAL_ORDER', 'Platform siparişinde ürün listesi okunamadı.');
  const items: IncomingItem[] = input.items.map(item => {
    const name = clean(item?.name, 80);
    if (!name || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 50 || !kurus(item.unitPrice)) throw new DomainError('INVALID_EXTERNAL_ORDER', 'Platform siparişindeki bir ürün okunamadı.');
    const options = Array.isArray(item.options) ? item.options.map(o => clean(o, 60)).filter((o): o is string => !!o).slice(0, 10) : [];
    const id = clean(item.externalId, 80), note = clean(item.note, 140);
    return { ...(id ? { externalId: id } : {}), name, quantity: item.quantity, unitPrice: item.unitPrice, ...(note ? { note } : {}), ...(options.length ? { options } : {}) };
  });
  const now = ctx.now.toISOString();
  const code = clean(input.code, 20), name = customer(input.customerName), note = clean(input.note, 300);
  const total = kurus(input.total) ? input.total : items.reduce((n, i) => n + i.unitPrice * i.quantity, 0);
  const entry: ExternalOrder = {
    id: ctx.id(), version: 1, platform, externalId, ...(code ? { code } : {}), ...(name ? { customerName: name } : {}), ...(note ? { note } : {}),
    ...(input.deliveryType === 'gel-al' || input.deliveryType === 'kurye' ? { deliveryType: input.deliveryType } : {}), ...(input.paidOnline ? { paidOnline: true } : {}),
    total, receivedAt: isoOr(input.receivedAt, now), ...(input.acceptBy && Number.isFinite(Date.parse(input.acceptBy)) ? { acceptBy: new Date(input.acceptBy).toISOString() } : {}),
    items, stage: 'pending', reported: [], outbox: [], updatedAt: now,
  };
  (s.externalOrders ??= []).push(entry);
  const settings = (s.integrationSettings ??= {})[platform] ??= { enabled: false };
  settings.lastOrderAt = now;
  s.audit.push({ action: 'external.received', actor: `platform:${platform}`, target: entry.id, at: now });
  return { id: entry.id, created: true, ...(settings.autoAccept ? { autoAccept: true } : {}) };
}

const findEntry = (s: State, id: string) => {
  const e = s.externalOrders?.find(e => e.id === id);
  if (!e) throw new DomainError('NOT_FOUND', 'Platform siparişi bulunamadı.', 404);
  return e;
};
export const APPROVERS: Role[] = ['owner', 'manager', 'cashier', 'kitchen'];

/** Checks before the platform is asked to accept (the server calls the platform between this and acceptExternalOrder). */
export function checkAcceptable(s: State, actor: Actor, input: { id: string; version: number }) {
  requireRole(s, actor, APPROVERS);
  const e = findEntry(s, input.id);
  if (e.stage === 'accepted') return { entry: e, already: true };
  if (e.version !== input.version) throw new DomainError('VERSION_CONFLICT', 'Sipariş başka bir ekranda değişti. Güncel durumu kontrol edin.', 409);
  if (e.stage !== 'pending') throw new DomainError('INVALID_TRANSITION', e.stage === 'missed' ? 'Platformun onay süresi doldu.' : 'Bu sipariş artık onay beklemiyor.', 409);
  return { entry: e, already: false };
}

/**
 * Kabul: the platform already confirmed. Opens the masasız ticket and its kitchen order. Paid online: a "Platform ödemesi"
 * payment (never cash or card) settles the bill at once, so the drawer total stays right; the ticket closes when handed over.
 */
export function acceptExternalOrder(s: State, actor: Actor, input: { id: string; version: number }, ctx: Context) {
  const { entry: e, already } = checkAcceptable(s, actor, input);
  if (already) return { orderId: e.orderId!, already: true };
  const now = ctx.now.toISOString(), info = PLATFORMS[e.platform];
  const label = takeawayLabel(e.customerName?.split(' ')[0]);
  const table: CafeTable = { takeaway: { number: 0, day: takeawayDay(ctx.now), ...(label ? { label } : {}) }, id: ctx.id(), name: externalName(e), token: '', epoch: 0, accountId: null };
  const account: Account = { id: ctx.id(), tableId: table.id, status: 'open', version: 0, openedAt: now };
  table.accountId = account.id;
  const vat = vatSettings(s);
  const lines: OrderLine[] = e.items.map(item => {
    const product = matchItem(s, e.platform, item);
    const optionNames = item.options ?? [];
    // The KDV rate of the sale (an unmatched item: the default rate), like every order line.
    return { productId: product?.id ?? `ext:${e.platform}:${itemKey(item)}`.slice(0, 120), quantity: item.quantity, selections: [], ...(item.note ? { note: item.note } : {}), id: ctx.id(), name: product?.name ?? item.name, code: product?.code ?? '', optionNames: product && lower(product.name) !== lower(item.name) ? [item.name, ...optionNames] : optionNames, unitPrice: item.unitPrice, total: item.unitPrice * item.quantity, vatRate: productVat(product, vat), ...(product ? {} : { unmatched: true }) };
  });
  const total = lines.reduce((n, l) => n + l.total, 0);
  const order: Order = { id: ctx.id(), number: (s.orderNumberBase ?? 0) + s.orders.length + 1, accountId: account.id, guestId: `platform:${e.platform}`, guestLabel: info.name, source: 'staff', createdAt: now, status: 'new', version: 1, menuRevision: s.menuRevision, lines, total, cancelRequested: false, external: sourceOf(e), ...(e.paidOnline ? { paymentBeforePreparation: true, paidAt: now } : {}) };
  s.tables.push(table); s.accounts.push(account); s.orders.push(order); account.version++;
  if (e.paidOnline && total > 0) { s.payments.push({ id: ctx.id(), accountId: account.id, amount: total, tendered: total, change: 0, method: 'platform', createdAt: now, commission: null, campaignAmount: 0 }); account.version++; }
  e.stage = 'accepted'; e.orderId = order.id; e.tableId = table.id; e.reported.push('accept'); e.decidedBy = actor.id; delete e.error; e.version++; e.updatedAt = now;
  s.audit.push({ action: 'external.accepted', actor: actor.id, target: e.id, at: now });
  return { orderId: order.id, already: false };
}

export function readRejectReason(value: unknown) {
  const reason = clean(value, 120);
  if (!reason || [...reason].length < 3) throw new DomainError('REASON_REQUIRED', 'Ret nedenini seçin.');
  return reason;
}
export function checkRejectable(s: State, actor: Actor, input: { id: string; version: number }) {
  requireRole(s, actor, APPROVERS);
  const e = findEntry(s, input.id);
  if (e.stage === 'rejected') return { entry: e, already: true };
  if (e.version !== input.version) throw new DomainError('VERSION_CONFLICT', 'Sipariş başka bir ekranda değişti. Güncel durumu kontrol edin.', 409);
  if (e.stage !== 'pending') throw new DomainError('INVALID_TRANSITION', 'Bu sipariş artık onay beklemiyor.', 409);
  return { entry: e, already: false };
}
/** Reddet: the platform already confirmed. Nothing reaches the kitchen. */
export function rejectExternalOrder(s: State, actor: Actor, input: { id: string; version: number; reason: string }, ctx: Context) {
  const reason = readRejectReason(input.reason), { entry: e, already } = checkRejectable(s, actor, input);
  if (already) return { already: true };
  const now = ctx.now.toISOString();
  e.stage = 'rejected'; e.reason = reason; e.reported.push('reject'); e.decidedBy = actor.id; delete e.error; e.version++; e.updatedAt = now;
  s.audit.push({ action: 'external.rejected', actor: actor.id, target: e.id, at: now });
  return { already: false };
}

/** Takes an accepted order off: removes the placeholder platform payment (no money was taken here) and closes an empty ticket. */
function cancelAccepted(s: State, e: ExternalOrder, reason: string, by: string, now: string) {
  const o = s.orders.find(o => o.id === e.orderId);
  if (o && o.status !== 'cancelled') {
    s.payments = s.payments.filter(p => !(p.accountId === o.accountId && p.method === 'platform'));
    o.status = 'cancelled'; o.cancelReason = reason; o.cancelledBy = by; o.cancelRequested = false; delete o.paidAt; o.version++;
    const a = s.accounts.find(a => a.id === o.accountId && a.status === 'open');
    if (a) {
      a.version++;
      const live = s.orders.some(v => v.accountId === a.id && v.status !== 'cancelled'), paid = s.payments.some(p => p.accountId === a.id);
      if (!live && !paid) { a.status = 'closed'; a.closedAt = now; const t = s.tables.find(t => t.id === a.tableId); if (t) { t.accountId = null; t.epoch++; } }
    }
  }
  e.stage = 'cancelled'; e.reason = reason; e.version++; e.updatedAt = now;
}
/** The platform (or its customer) cancelled: a waiting order just closes; an accepted one leaves the kitchen. */
function platformCancelled(s: State, e: ExternalOrder, reason: string, ctx: Context) {
  if (['rejected', 'cancelled'].includes(e.stage)) return;
  const now = ctx.now.toISOString();
  if (e.stage === 'accepted') {
    const o = s.orders.find(o => o.id === e.orderId);
    if (o?.status === 'served') return;
    cancelAccepted(s, e, reason, `platform:${e.platform}`, now);
  } else { e.stage = 'cancelled'; e.reason = reason; e.version++; e.updatedAt = now; }
  e.reported.push('cancel');
  s.audit.push({ action: 'external.cancelled_by_platform', actor: `platform:${e.platform}`, target: e.id, at: now });
}
/** İşletme cancels an accepted order (before it is handed over); the platform is told through the outbox. */
export function cancelExternalOrder(s: State, actor: Actor, input: { id: string; version: number; reason: string }, ctx: Context) {
  requireRole(s, actor, ['owner', 'manager', 'kitchen']);
  const e = findEntry(s, input.id);
  if (e.stage === 'cancelled') return { already: true };
  if (e.version !== input.version) throw new DomainError('VERSION_CONFLICT', 'Sipariş başka bir ekranda değişti. Güncel durumu kontrol edin.', 409);
  const o = s.orders.find(o => o.id === e.orderId);
  if (e.stage !== 'accepted' || !o || ['served', 'cancelled'].includes(o.status)) throw new DomainError('INVALID_TRANSITION', 'Bu sipariş artık iptal edilemez.', 409);
  const reason = readRejectReason(input.reason), now = ctx.now.toISOString();
  cancelAccepted(s, e, reason, actor.id, now);
  e.outbox.push({ action: 'cancel', reason, attempts: 0, nextAt: now });
  s.audit.push({ action: 'external.cancelled', actor: actor.id, target: e.id, at: now });
  return { already: false };
}

/**
 * Turns local steps into owed platform calls: kitchen Hazır → `ready`, handed over (Teslim / Kuryeye teslim edildi) →
 * `delivered`, a staff cancellation → `cancel`. Also marks waiting orders whose accept deadline passed, and forgets
 * finished records after two days (their key stays so a late repeat is never added again). Returns whether anything changed.
 */
export function queueExternalUpdates(s: State, now: Date) {
  if (!s.externalOrders?.length) return false;
  let changed = false;
  const at = now.toISOString(), orders = new Map(s.orders.map(o => [o.id, o]));
  for (const e of s.externalOrders) {
    if (e.stage === 'pending' && e.acceptBy && now.getTime() > Date.parse(e.acceptBy) + MISSED_GRACE_MS) { e.stage = 'missed'; e.version++; e.updatedAt = at; changed = true; continue; }
    if (e.stage !== 'accepted') continue;
    const o = orders.get(e.orderId ?? '');
    if (!o) continue;
    const owed = (a: PlatformCall) => !e.reported.includes(a) && !e.outbox.some(x => x.action === a);
    if (o.status === 'cancelled') {
      if (owed('cancel')) e.outbox.push({ action: 'cancel', reason: o.cancelReason ?? 'İşletme iptal etti', attempts: 0, nextAt: at });
      e.stage = 'cancelled'; e.reason ??= o.cancelReason; e.version++; e.updatedAt = at; changed = true; continue;
    }
    if (['ready', 'served'].includes(o.status) && owed('ready')) { e.outbox.push({ action: 'ready', attempts: 0, nextAt: at }); e.updatedAt = at; changed = true; }
    if (o.status === 'served' && owed('delivered')) { e.outbox.push({ action: 'delivered', attempts: 0, nextAt: at }); e.updatedAt = at; changed = true; }
  }
  const before = s.externalOrders.length;
  const finished = (e: ExternalOrder) => !e.outbox.length && (['rejected', 'cancelled', 'missed'].includes(e.stage) || e.reported.includes('delivered')) && now.getTime() - Date.parse(e.updatedAt) > KEEP_FINISHED_MS;
  const leaving = s.externalOrders.filter(finished);
  if (leaving.length) {
    s.externalSeen = [...(s.externalSeen ?? []), ...leaving.map(e => `${e.platform}:${e.externalId}`)].slice(-SEEN_MAX);
    s.externalOrders = s.externalOrders.filter(e => !finished(e));
  }
  return changed || s.externalOrders.length !== before;
}
/**
 * Accounts holding an accepted platform order whose local step (Hazır, teslim, iptal) has not been turned into an owed call
 * yet. Such an account stays in the snapshot (server/history.ts settle) until queueExternalUpdates has seen it: once its
 * order leaves the floor the step could never be read again, and the platform would not hear `ready` / `delivered`.
 */
export function unqueuedPlatformAccounts(s: State) {
  const out = new Set<string>();
  if (!s.externalOrders?.length) return out;
  const orders = new Map(s.orders.map(o => [o.id, o]));
  for (const e of s.externalOrders) {
    const o = e.stage === 'accepted' ? orders.get(e.orderId ?? '') : undefined;
    if (!o) continue;
    const owed = (a: PlatformCall) => !e.reported.includes(a) && !e.outbox.some(x => x.action === a);
    if (o.status === 'cancelled' || (['ready', 'served'].includes(o.status) && owed('ready')) || (o.status === 'served' && owed('delivered'))) out.add(o.accountId);
  }
  return out;
}
/** Owed calls whose time has come; one per order at a time, in order (ready before delivered). */
export function dueCalls(s: State, now: Date) {
  return (s.externalOrders ?? []).flatMap(e => {
    const next = e.outbox[0];
    return next && Date.parse(next.nextAt) <= now.getTime() ? [{ id: e.id, platform: e.platform, externalId: e.externalId, action: next.action, ...(next.reason ? { reason: next.reason } : {}) }] : [];
  });
}
/** The outcome of one owed call: done, or retried later with a growing wait and the error on screen. */
export function reportCall(s: State, id: string, action: OutboxItem['action'], result: { ok: true } | { ok: false; error: string }, now: Date) {
  const e = s.externalOrders?.find(e => e.id === id), item = e?.outbox.find(x => x.action === action);
  if (!e || !item) return;
  if (result.ok) { e.outbox = e.outbox.filter(x => x !== item); e.reported.push(action); if (!e.outbox.some(x => x.error)) delete e.error; }
  else { item.attempts++; item.error = result.error; item.nextAt = new Date(now.getTime() + BACKOFF_S[Math.min(item.attempts - 1, BACKOFF_S.length - 1)] * 1000).toISOString(); e.error = result.error; }
  e.version++; e.updatedAt = now.toISOString();
}
/** "Tekrar dene": owed calls go at once. */
export function retryExternal(s: State, actor: Actor, id: string, now: Date) {
  requireRole(s, actor, APPROVERS);
  const e = findEntry(s, id);
  for (const x of e.outbox) x.nextAt = now.toISOString();
  return { retrying: e.outbox.length };
}
/** A failed accept/reject is kept on the card so everyone sees it; the waiting order stays as it was. */
export function noteFailure(s: State, id: string, error: string, now: Date) {
  const e = s.externalOrders?.find(e => e.id === id);
  if (e) { e.error = error; e.updatedAt = now.toISOString(); }
}

export function updatePlatformSettings(s: State, actor: Actor, input: { platform: PlatformId; enabled?: boolean; autoAccept?: boolean }, now = new Date()) {
  requireRole(s, actor, ['owner']);
  const settings = (s.integrationSettings ??= {})[input.platform] ??= { enabled: false };
  if (input.enabled !== undefined) settings.enabled = input.enabled;
  if (input.autoAccept !== undefined) { if (input.autoAccept) settings.autoAccept = true; else delete settings.autoAccept; }
  s.audit.push({ action: 'integration.settings', actor: actor.id, target: input.platform, at: now.toISOString() });
  return { enabled: settings.enabled, autoAccept: !!settings.autoAccept };
}
/** Menü eşleştirme: one platform item to one Mola product; `productId: null` removes it. Applies from the next Kabul on. */
export function setMenuMapping(s: State, actor: Actor, input: { platform: PlatformId; key: string; name: string; productId: string | null }) {
  requireRole(s, actor, ['owner']);
  const key = clean(input.key, 100), name = clean(input.name, 80);
  if (!key || !name) throw new DomainError('INVALID_VALUE', 'Ürün eşleştirmesi okunamadı.');
  if (input.productId !== null && !s.products.some(p => p.id === input.productId)) throw new DomainError('NOT_FOUND', 'Menüde bu ürün bulunamadı.', 404);
  const settings = (s.integrationSettings ??= {})[input.platform] ??= { enabled: false };
  const mapping = (settings.mapping ?? []).filter(m => m.key !== key);
  if (input.productId) mapping.push({ key, name, productId: input.productId });
  if (mapping.length > 500) throw new DomainError('MAPPING_LIMIT', 'Bir platform için en fazla 500 eşleştirme tutulur.', 409);
  settings.mapping = mapping;
  return { mapped: mapping.length };
}

/** Items seen from a platform that match no Mola product yet ("Menüde eşleşmeyen ürün"), for the mapping table. */
export function unmatchedItems(s: State, platform: PlatformId) {
  const out = new Map<string, { key: string; name: string }>();
  for (const e of s.externalOrders ?? []) if (e.platform === platform) for (const item of e.items) if (!matchItem(s, platform, item)) out.set(itemKey(item), { key: itemKey(item), name: item.name });
  return [...out.values()];
}

export type PublicExternalItem = IncomingItem & { productName?: string; unmatched?: boolean };
export type PublicExternalOrder = Omit<ExternalOrder, 'items' | 'decidedBy'> & { items: PublicExternalItem[]; orderStatus?: Order['status']; orderVersion?: number };
/** Waiting orders and ones with an owed call, as kitchen, cashier and owner see them (the kitchen never sees money). */
export function publicExternalOrders(s: State, role: Role, all = false): PublicExternalOrder[] {
  const orders = new Map(s.orders.map(o => [o.id, o]));
  return (s.externalOrders ?? [])
    .filter(e => all || e.stage === 'pending' || e.outbox.length > 0 || (e.stage === 'accepted' && !!e.error))
    .map(({ decidedBy: _, ...e }) => {
      const o = orders.get(e.orderId ?? '');
      const items = e.items.map(i => { const p = matchItem(s, e.platform, i); return { ...i, ...(role === 'kitchen' ? { unitPrice: 0 } : {}), ...(p ? { productName: p.name } : { unmatched: true }) }; });
      return { ...e, items, ...(role === 'kitchen' ? { total: 0 } : {}), ...(o ? { orderStatus: o.status, orderVersion: o.version } : {}) };
    })
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}
