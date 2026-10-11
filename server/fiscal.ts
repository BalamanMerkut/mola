import type { Express, Request } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import type { Actor, Order, Payment, State } from '../packages/domain/types.js';
import type { PaymentAdjustment } from '../packages/domain/payment-adjustments.js';
import { stateRecords } from '../packages/domain/history.js';
import { vatSettings } from '../packages/domain/vat.js';
import { cashDayOf } from '../packages/domain/cash.js';
import { billEntries, fiscalSettings, fiscalSummary, lineRates, rateLookup, refundEntry, withMarks, type CashFiscal, type FiscalEntry, type FiscalMark } from '../packages/domain/fiscal.js';
import type { Store } from './store.js';
import type { CashBook } from './cash-closing.js';

/*
 * Yazar kasa yardımcısı (server side; rules in packages/domain/fiscal.ts). A payment's per-rate amounts are worked out from its
 * bill wherever the bill is now (the floor or long-term history, History.refundAccount), each line at the rate it was sold with
 * (OrderLine.vatRate; lines from before that at today's product rate). A "Girildi" tick is a FiscalMark row in cash_records (kind 'fiscal', `at` = the payment's own time so a
 * closing window finds it); its id comes from the payment, so ticking twice keeps the first. Nothing changes the payment.
 */
export const fiscalId = (tenant: string, ref: string) => `fiscal-${createHash('sha256').update(`${tenant}\0${ref}`).digest('hex').slice(0, 32)}`;
function rates(s: State) {
  const settings = vatSettings(s);
  return { rateOf: rateLookup([...s.products, ...(s.productDrafts ?? [])], settings), fallback: settings.default };
}
/** One payment, or one refund of it, as the card after a payment shows it; undefined when unknown. */
export function fiscalEntry(store: Store, tenant: string, s: State, paymentId: string, refundId?: string): FiscalEntry | undefined {
  const bill = store.history.refundAccount(tenant, s, paymentId);
  if (!bill) return undefined;
  const { rateOf, fallback } = rates(s), payment = billEntries(bill, rateOf, fallback).find(e => e.id === paymentId);
  if (!payment || !refundId) return payment;
  const a = bill.adjustments.find(x => x.id === refundId && x.kind === 'refund' && x.paymentId === paymentId);
  return a ? refundEntry(a, payment, rateOf, fallback, lineRates(bill.orders)) : undefined;
}
/** The "Yazar kasa karşılaştırması" of a closing window [from, to): its payments and refunds, and which were ticked. */
export function fiscalWindow(store: Store, book: CashBook, tenant: string, s: State, from: number, to: number): CashFiscal {
  const inside = (iso: string) => { const t = Date.parse(iso); return t >= from && t < to; };
  const view = store.history.view(tenant, s, from, to), records = stateRecords(view), { rateOf, fallback } = rates(s);
  const orders = new Map<string, Order[]>(), payments = new Map<string, Payment[]>();
  for (const o of records.orders) orders.set(o.accountId, [...(orders.get(o.accountId) ?? []), o]);
  for (const p of records.payments) payments.set(p.accountId, [...(payments.get(p.accountId) ?? []), p]);
  const tableOf = new Map<string, string>();
  for (const a of view.archives) if (a.tableName) tableOf.set(a.accountId, a.tableName);
  for (const t of [...s.tables, ...(s.retiredTables ?? [])]) if (t.accountId && !tableOf.has(t.accountId)) tableOf.set(t.accountId, t.name);
  const entries: FiscalEntry[] = [], byPayment = new Map<string, FiscalEntry>();
  for (const [accountId, list] of payments) {
    if (!list.some(p => inside(p.createdAt))) continue;
    for (const e of billEntries({ orders: orders.get(accountId) ?? [], payments: list, tableName: tableOf.get(accountId) }, rateOf, fallback)) { byPayment.set(e.id, e); if (inside(e.at)) entries.push(e); }
  }
  const refunds = new Map<string, PaymentAdjustment>();
  for (const a of [...store.history.adjustments(tenant, from, to), ...(s.paymentAdjustments ?? [])]) if (a.kind === 'refund' && inside(a.createdAt)) refunds.set(a.id, a);
  // Refunded items go back at the rate they were sold with (their bill's lines).
  const soldOrders = [...orders.values()].flat();
  for (const a of refunds.values()) {
    // A refund of an older payment: that bill is read once, by its payment.
    if (!byPayment.has(a.paymentId)) { const bill = store.history.refundAccount(tenant, s, a.paymentId); if (bill) { for (const e of billEntries(bill, rateOf, fallback)) byPayment.set(e.id, e); soldOrders.push(...bill.orders); } }
    const payment = byPayment.get(a.paymentId);
    if (payment?.method === 'platform') continue;
    entries.push(refundEntry(a, payment, rateOf, fallback, a.items?.length ? lineRates(soldOrders) : undefined));
  }
  const marked = marksOf(book, tenant, from, to);
  return fiscalSummary(entries, id => marked.has(id), fiscalSettings(s.cashShift).askConfirm);
}
/** Ticked refs of [from, to) (by the payment's or refund's own time). */
export function marksOf(book: CashBook, tenant: string, from: number, to: number) { return new Set(book.list<FiscalMark>(tenant, ['fiscal'], from, to).map(m => m.ref)); }
/** The summary again at "Kapanışı tamamla": ticks made since the count take their payments off the list. */
export function refreshFiscal(book: CashBook, tenant: string, f: CashFiscal, from: string, to: string) {
  const marked = marksOf(book, tenant, Date.parse(from), Date.parse(to));
  return withMarks(f, id => marked.has(id));
}
function markOf(book: CashBook, tenant: string, ref: string) {
  const m = book.get<FiscalMark>(tenant, fiscalId(tenant, ref));
  return m?.kind === 'fiscal' ? { at: m.markedAt, byName: m.byName } : undefined;
}

/**
 * GET /api/staff/fiscal/payments/:paymentId (?refund=…): the card after a payment or a refund (owner, Müdür, cashier).
 * POST /api/staff/fiscal/mark { paymentId, refundId? }: "Girildi". Registered by cashRoutes.
 */
export function fiscalRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, book: CashBook, now: () => Date) {
  const counter = (req: Request) => { const a = actorFor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner', 'manager', 'cashier']); return { a, s }; };
  const id = z.string().min(1).max(200);
  app.get('/api/staff/fiscal/payments/:paymentId', (req, res) => {
    const { a, s } = counter(req), paymentId = id.parse(req.params.paymentId), refundId = id.optional().parse(req.query.refund || undefined);
    const settings = fiscalSettings(s.cashShift);
    res.setHeader('Cache-Control', 'no-store');
    if (!settings.enabled) { res.json({ ...settings }); return; }
    const entry = fiscalEntry(store, a.tenantId, s, paymentId, refundId);
    if (!entry) throw new DomainError('NOT_FOUND', 'Tahsilat bulunamadı.', 404);
    const marked = markOf(book, a.tenantId, entry.id);
    res.json({ ...settings, entry, ...(marked ? { marked } : {}) });
  });
  app.post('/api/staff/fiscal/mark', (req, res) => {
    const { a, s } = counter(req), b = z.object({ paymentId: id, refundId: id.optional() }).parse(req.body);
    const entry = fiscalEntry(store, a.tenantId, s, b.paymentId, b.refundId);
    if (!entry) throw new DomainError('NOT_FOUND', 'Tahsilat bulunamadı.', 404);
    if (entry.method === 'platform') throw new DomainError('PLATFORM_PAYMENT', 'Platform ödemesi yazar kasaya girilmez; mali müşavirinize sorun.', 409);
    const user = s.staffUsers?.find(u => u.id === a.id);
    const mark: FiscalMark = { id: fiscalId(a.tenantId, entry.id), kind: 'fiscal', ref: entry.id, refKind: entry.kind, paymentId: entry.paymentId, at: entry.at, day: cashDayOf(entry.at), markedAt: now().toISOString(), by: a.id, byName: user?.name ?? (a.role === 'owner' ? 'İşletme sahibi' : 'Kasiyer') };
    book.insert(a.tenantId, mark, entry.id);
    res.json({ marked: markOf(book, a.tenantId, entry.id) });
  });
}
