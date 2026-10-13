import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor, Role, State } from '../packages/domain/types.js';
import { DomainError } from '../packages/domain/engine.js';
import { adjustPayment, declineRefundRequest, pruneRequests, refundableItems, refundItemsText, requestRefund } from '../packages/domain/payment-adjustments.js';
import { cashierRefundLimits, OWNER_REQUIRED_TEXT, REFUND_REASONS, refundPower, type RefundReason } from '../packages/domain/refund-rules.js';
import { businessDay, dayStart } from '../packages/domain/business-day.js';
import { addTillNotice, awayFromTill, markTillNoticeSeen, tillNoticeText } from '../packages/domain/till-notices.js';
import { guardOn } from '../packages/domain/cash.js';
import { saatEki } from '../packages/domain/saat-eki.js';
import type { Store } from './store.js';
import type { Notifications } from './notifications.js';

/*
 * İade (server side): item refunds and amount refunds for the owner (İade ve düzeltme, behind the report code) and for the
 * counter (the "İade" window on Masalar: today's payments only). Who may refund how much is packages/domain/refund-rules.ts
 * refundPower: owner and Müdür every refund, a cashier small ones within the owner's limits (per refund and per cash day);
 * above them the cashier sends an "iade isteği" that the owner does or declines. Every cashier refund and request is a notice
 * in the owner's Bildirimler. "Ürünler kullanılmadan geri döndü (stoğa ekle)" puts the refunded products back into Stok here,
 * after the refund is saved (server/stock.ts restock; ids from the refund, so a repeated request adds nothing twice).
 *
 * Registered after reportSecurity (the report code guards /api/staff/payment-adjustments) and before managementRoutes.
 */
export type RefundOptions = {
  notifications?: Pick<Notifications, 'add'> & Partial<Pick<Notifications, 'markKeyRead'>>;
  restock?: (tenant: string, actor: Actor, refundId: string, lines: { productId: string; quantity: number; grams?: number; name: string }[]) => { added: string[]; skipped: string[] } | undefined;
};
const money = (kurus: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: kurus % 100 === 0 ? 0 : 2 }).format(kurus / 100);
const clock = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const methodName = (m: string) => m === 'card' ? 'kart' : 'nakit';
const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const itemsInput = z.array(z.object({ orderId: z.string().min(1).max(100), lineId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(1000) })).min(1).max(100);
const reasonsInput = z.array(z.enum(REFUND_REASONS as [RefundReason, ...RefundReason[]])).max(4);
const refundInput = z.object({ requestId, paymentId: z.string().min(1).max(200), revision: z.number().int().nonnegative(), amount: z.number().int().nonnegative(), method: z.enum(['cash', 'card']),
  reason: z.string().trim().min(1).max(500).optional(), reasons: reasonsInput.optional(), note: z.string().max(300).optional(), items: itemsInput.optional(), restock: z.boolean().optional(),
  /** Amount refund only: the one product that came back unused (the older "stoğa ekle" of a refund without items). */
  back: z.object({ productId: z.string().min(1).max(100), quantity: z.number().finite().min(0.05).max(1000) }).optional(), fromRequest: z.string().min(1).max(100).optional() });

export function refundRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, options: RefundOptions = {}) {
  const ctx = () => ({ now: now(), id: randomUUID });
  const who = (req: Request, need?: 'full') => {
    const a = actorFor(req), s = store.read(a.tenantId), power = a.tenantId === s.tenantId ? refundPower(a.role) : 'none';
    if (power === 'none' || (need === 'full' && power !== 'full')) throw new DomainError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403);
    return { a, s, power };
  };
  const notify = (tenant: string, key: string, title: string, text: string) => { try { options.notifications?.add(tenant, key, { kind: 'cash', title, text }); } catch (error) { console.warn(`İade bildirimi yazılamadı: ${error instanceof Error ? error.message : error}`); } };
  // 9 Ekim kullanıcı testi: the owner did (or declined) the requested refund, but Masalar still said "İade isteği … İadeyi yap".
  const readKey = (tenant: string, owner: string, key: string) => { try { options.notifications?.markKeyRead?.(tenant, owner, key); } catch { /* only the banner */ } };
  const handled = (tenant: string, owner: string, requestId: string) => readKey(tenant, owner, `refund-request:${requestId}`);
  const today = () => businessDay(now().getTime());
  /** The person's refunds of this cash day so far (the cashier's daily limit). */
  function usedToday(tenant: string, s: State, actorId: string) {
    const start = dayStart(today()), seen = new Set<string>(); let total = 0;
    for (const a of [...store.history.adjustments(tenant, start, now().getTime() + 1), ...(s.paymentAdjustments ?? [])])
      if (!seen.has(a.id) && a.kind === 'refund' && a.actor === actorId && Date.parse(a.createdAt) >= start) { seen.add(a.id); total += a.amount; }
    return total;
  }
  /** The payment with its bill and corrections; the counter (cashier) only reaches today's payments. */
  function paymentOf(tenant: string, s: State, paymentId: string, counter: boolean) {
    const account = store.history.refundAccount(tenant, s, paymentId), payment = account?.payments.find(p => p.id === paymentId);
    if (!account || !payment) throw new DomainError('NOT_FOUND', 'Tahsilat bulunamadı.', 404);
    if (counter && businessDay(payment.createdAt) !== today()) throw new DomainError('OWNER_REQUIRED', `${OWNER_REQUIRED_TEXT} Kasada yalnız bugünkü ödemeler iade edilir.`, 403);
    const history = account.adjustments.filter(a => a.paymentId === paymentId), refunded = history.filter(a => a.kind === 'refund').reduce((n, a) => n + a.amount, 0);
    return { account, payment, history, tableName: account.tableName ?? 'Masa', refunded };
  }
  /** What a refund window shows for one payment: the bill's refundable items and what the payment still has. */
  function detail(tenant: string, s: State, paymentId: string, counter: boolean) {
    const { account, payment, history, tableName, refunded } = paymentOf(tenant, s, paymentId, counter);
    const items = refundableItems(paymentId, account).map(({ key: _key, ...i }) => i);
    return { payment: { id: payment.id, tableName, createdAt: payment.createdAt, amount: payment.amount, method: payment.method, refunded, refundable: payment.amount - refunded, revision: history.length, itemsSelected: !!payment.selections?.length }, items };
  }
  app.get('/api/staff/refunds/limits', (req, res) => {
    const { a, s, power } = who(req), limits = cashierRefundLimits(s.cashShift);
    res.setHeader('Cache-Control', 'no-store');
    res.json(power === 'full' ? { power } : { power, max: limits.max, day: limits.day, usedToday: usedToday(a.tenantId, s, a.id) });
  });
  // The counter's list: today's payments (cash day), newest first, searchable like İade ve düzeltme; no commission or totals.
  app.get('/api/staff/refunds/payments', (req, res) => {
    const { a, s } = who(req), q = z.object({ q: z.string().max(80).optional() }).parse(req.query), day = today();
    const page = store.history.paymentLedger(a.tenantId, s, { from: day, to: day, q: q.q, limit: 100 });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ day, rows: page.rows.map(r => ({ id: r.id, tableName: r.tableName, createdAt: r.createdAt, amount: r.amount, method: r.method, refunded: r.refunded, refundable: r.refundable, revision: r.revision, itemsSelected: r.itemsSelected })), more: !!page.next });
  });
  app.get('/api/staff/refunds/payments/:paymentId', (req, res) => {
    const { a, s } = who(req), id = z.string().min(1).max(200).parse(req.params.paymentId);
    res.setHeader('Cache-Control', 'no-store'); res.json(detail(a.tenantId, s, id, true));
  });
  // The same for any day, from İade ve düzeltme (the report code guards this path).
  app.get('/api/staff/payment-adjustments/:paymentId/refund', (req, res) => {
    const { a, s } = who(req, 'full'), id = z.string().min(1).max(200).parse(req.params.paymentId);
    res.setHeader('Cache-Control', 'no-store'); res.json(detail(a.tenantId, s, id, false));
  });

  /** Records a refund (or, from İade ve düzeltme, a method correction), then puts items back into stock and tells the owner. */
  function record(req: Request, res: Response, counter: boolean) {
    const { a, s, power } = who(req, counter ? undefined : 'full');
    const b = counter ? { ...refundInput.parse(req.body), kind: 'refund' as const, commission: 0 } : refundInput.extend({ kind: z.enum(['refund', 'method']), commission: z.number().int().nonnegative() }).parse(req.body);
    if (b.kind === 'refund' && !b.reasons && !b.reason) throw new DomainError('INVALID_ADJUSTMENT', 'İadenin nedenini seçin.');
    const { back, ...body } = b;
    const row = store.mutate(a.tenantId, state => {
      const found = paymentOf(a.tenantId, state, b.paymentId, counter && power !== 'full');
      return adjustPayment(state, a, body, ctx(), { payment: found.payment, history: found.history, account: found.account }, power === 'limited' ? { usedToday: usedToday(a.tenantId, state, a.id) } : undefined);
    });
    let stock: { added: string[]; skipped: string[] } | undefined;
    if (row.kind === 'refund' && options.restock) {
      const lines = row.restock && row.items?.length ? row.items.map(i => ({ productId: i.productId, quantity: i.quantity, ...(i.grams ? { grams: i.grams } : {}), name: i.name }))
        : !row.items && back ? [{ productId: back.productId, quantity: back.quantity, name: s.products.find(p => p.id === back.productId)?.name ?? 'Ürün' }] : [];
      if (lines.length) stock = options.restock(a.tenantId, a, row.id, lines);
    }
    if (row.kind === 'refund' && power !== 'full') {
      const table = store.history.refundAccount(a.tenantId, store.read(a.tenantId), row.paymentId)?.tableName ?? 'Masa';
      notify(a.tenantId, `refund:${row.id}`, `Kasiyer iadesi: ${money(row.amount)} · ${table}`, `${row.byName ?? 'Kasiyer'} · ${row.items?.length ? refundItemsText(row.items) : 'tutar olarak'} · ${row.reason} · ${methodName(row.method)} · ${clock(row.createdAt)}${row.restock ? ' · stoğa eklendi' : ''}. Kasa ve giderler → İadeler'de görünür.`);
    }
    // Kasa güvenliği → methodAlert (14 Ekim): cash written as card (or back) afterwards by someone else than the owner; the
    // owner hears who changed it and who took the payment (Payment.by, missing on older payments).
    if (row.kind === 'method' && a.role !== 'owner' && guardOn(store.read(a.tenantId).cashShift, 'methodAlert')) {
      const now$ = store.read(a.tenantId), account = store.history.refundAccount(a.tenantId, now$, row.paymentId), paid = account?.payments.find(p => p.id === row.paymentId);
      const taker = paid?.by ? now$.staffUsers?.find(u => u.id === paid.by)?.name : undefined, changer = row.byName ?? now$.staffUsers?.find(u => u.id === a.id)?.name ?? 'Müdür';
      notify(a.tenantId, `payment-method:${row.id}`, `Ödeme türü değişti: ${money(row.amount)} · ${account?.tableName ?? 'Masa'}`,
        `${changer} ${saatEki(clock(row.createdAt), 'de')} ödemeyi ${methodName(row.method)} olarak düzeltti${paid ? ` (ödeme ${saatEki(clock(paid.createdAt), 'de')} alınmıştı${taker ? `, alan: ${taker}` : ''})` : ''} · Neden: ${row.reason}. Kasa ve giderler → İadeler'de görünür.`);
    }
    if (body.fromRequest && power === 'full') handled(a.tenantId, a.id, body.fromRequest);
    // K-A (9 Ekim kullanıcı testi): a refund done away from the till (the owner's phone, the Müdür) reaches the cashier: a green
    // strip on Masalar and the yazar kasa refund card (till-notices.ts); a line in Bildirimler too (read for the one who did it).
    if (row.kind === 'refund' && awayFromTill(a.role)) {
      const table = store.history.refundAccount(a.tenantId, store.read(a.tenantId), row.paymentId)?.tableName ?? 'Masa';
      try {
        store.mutate(a.tenantId, s => addTillNotice(s, { id: `till-${row.id}`, refundId: row.id, paymentId: row.paymentId, tableName: table, amount: row.amount, method: row.method, by: a.id, byName: row.byName ?? (a.role === 'owner' ? 'İşletme sahibi' : 'Müdür'), byRole: a.role as Role, at: row.createdAt }, now().getTime()));
      } catch (error) { console.warn(`İade şeridi yazılamadı: ${error instanceof Error ? error.message : error}`); }
      const key = `refund-done:${row.id}`, text = tillNoticeText({ byRole: a.role, tableName: table, method: row.method, money: money(row.amount) });
      notify(a.tenantId, key, `İade yapıldı: ${money(row.amount)} · ${table}`, `${row.byName ?? ''}${row.byName ? ' · ' : ''}${row.items?.length ? refundItemsText(row.items) : 'tutar olarak'} · ${methodName(row.method)} · ${clock(row.createdAt)}. Kasadaki ekrana “${text}” uyarısı ve yazar kasa kartı gitti.`);
      if (a.role === 'owner') readKey(a.tenantId, a.id, key);
    }
    res.json({ ...row, ...(stock ? { stock } : {}) });
  }
  // İade ve düzeltme (owner, Müdür): refunds of any day and method corrections.
  app.post('/api/staff/payment-adjustments', (req, res) => record(req, res, false));
  // The counter's "İade" window: owner, Müdür and cashier (within the limits), today's payments.
  app.post('/api/staff/refunds', (req, res) => record(req, res, true));

  // K-A: the cashier closes "Sahip iadeyi yaptı" (for themselves; another person at the till still sees it).
  app.post('/api/staff/refunds/till-notices/seen', (req, res) => {
    const a = actorFor(req), { id } = z.object({ id: z.string().min(1).max(200) }).parse(req.body);
    if (a.role !== 'cashier' && a.role !== 'manager') throw new DomainError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403);
    store.mutate(a.tenantId, s => markTillNoticeSeen(s, a.id, id, now().getTime()));
    res.json({ ok: true });
  });
  // "Sahibe iade isteği gönder": a cashier's refund above the limits waits for the owner.
  app.post('/api/staff/refunds/requests', (req, res) => {
    const { a } = who(req), b = refundInput.omit({ revision: true, reason: true, back: true, fromRequest: true }).extend({ reasons: reasonsInput }).parse(req.body);
    const r = store.mutate(a.tenantId, s => { const found = paymentOf(a.tenantId, s, b.paymentId, true); return requestRefund(s, a, b, ctx(), { payment: found.payment, history: found.history, account: found.account, tableName: found.tableName }); });
    notify(a.tenantId, `refund-request:${r.id}`, `İade isteği: ${r.tableName} · ${money(r.amount)}`, `${r.byName} · ${r.items?.length ? refundItemsText(r.items) : 'tutar olarak'} · ${r.reason} · ${methodName(r.method)} iade · ${clock(r.at)}. Kasa ve giderler → İadeler'in üstündeki “Bekleyen iade istekleri”nden yapın ya da reddedin.`);
    res.json(r);
  });
  // The owner: every waiting request and the last two weeks' answers; a cashier: their own of the last two days.
  app.get('/api/staff/refunds/requests', (req, res) => {
    const { a, s, power } = who(req), t = now().getTime(), list = pruneRequests(s.refundRequests ?? [], t);
    const mine = power === 'full' ? list : list.filter(r => r.by === a.id && t - Date.parse(r.at) < 2 * 86400_000);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ requests: [...mine].sort((x, y) => Number(y.status === 'pending') - Number(x.status === 'pending') || y.at.localeCompare(x.at)) });
  });
  app.post('/api/staff/refunds/requests/decline', (req, res) => {
    const { a } = who(req, 'full'), b = z.object({ id: z.string().min(1).max(100), note: z.string().max(300).optional() }).parse(req.body);
    const declined = store.mutate(a.tenantId, s => declineRefundRequest(s, a, b, ctx()));
    handled(a.tenantId, a.id, b.id);
    res.json(declined);
  });
}
