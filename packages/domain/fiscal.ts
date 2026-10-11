import type { Order, Payment } from './types.js';
import type { PaymentAdjustment } from './payment-adjustments.js';
import { addRates, allocateBill, allocateRefund, productVat, type RateAmount, type RateLine, type VatSettings } from './vat.js';

/*
 * Yazar kasa yardımcısı (interim, until a real ÖKC link): every sale needs a fiscal receipt from the yazar kasa at sale time,
 * and cafés enter each bill once per KDV department. After a payment the screen says what to enter ("%10 departman →
 * ₺347,00 · Ödeme: Nakit"); a refund says what to reverse. The cashier may tick "Girildi" (kept per payment, server/fiscal.ts).
 * At gün sonu the closing adds it all up and compares it with the Z raporu the cashier types. Nothing here is a tax document
 * and nothing is guessed: online platform payments only say to ask the accountant. Plain rules, no server imports (the
 * browser uses them too). Money in kuruş.
 */
export const FISCAL_NOTE = "Mola'nın hesap fişi resmi fiş değildir. Her satış için yazar kasadan fiş kesilmesi zorunludur.";
export const PLATFORM_FISCAL = 'Platform siparişi — fiş/fatura kuralını mali müşavirinize sorun';
/** Kasa ve giderler → Kasa ayarları: the helper (missing = off since 11 Ekim, the owner turns it on) and the "Girildi" question (missing = off). */
export type FiscalSettings = { enabled: boolean; askConfirm: boolean };
export function fiscalSettings(s?: { fiscalHelper?: boolean; fiscalConfirm?: boolean } | null): FiscalSettings {
  const enabled = s?.fiscalHelper === true;
  return { enabled, askConfirm: enabled && !!s?.fiscalConfirm };
}
/** "₺347,00": always with kuruş, as it is typed on the yazar kasa. */
export const kasaMoney = (kurus: number) => `${kurus < 0 ? '−' : ''}₺${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(kurus) / 100)}`;
/** "347,00": the number alone, for copying into the yazar kasa's keypad or a note. */
export const kasaNumber = (kurus: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(kurus / 100);
export const methodWord = (m: string) => m === 'card' ? 'Kart' : m === 'platform' ? 'Platform (online)' : 'Nakit';
/** "%10 ₺18.400,00 · %20 ₺1.200,00". */
export const ratesLine = (rows: RateAmount[]) => rows.map(r => `%${r.rate} ${kasaMoney(r.amount)}`).join(' · ');

export type FiscalMethod = 'cash' | 'card' | 'platform';
/**
 * One payment (or refund) as the yazar kasa needs it. `id`: the payment's id, or the refund's. `rows`: per rate, adding up to
 * `amount`; empty for an online platform payment (never guessed). `deposit`: the reservation's kapora part of a bill.
 */
export type FiscalEntry = { id: string; kind: 'payment' | 'refund'; paymentId: string; at: string; method: FiscalMethod; amount: number; rows: RateAmount[]; tableName?: string; deposit?: true };
/** A "Girildi" tick: the cashier confirmed this payment or refund is on the yazar kasa. Kept in cash_records (server/fiscal.ts). */
export type FiscalMark = { id: string; kind: 'fiscal'; ref: string; refKind: 'payment' | 'refund'; paymentId: string; at: string; day: string; markedAt: string; by: string; byName: string };

/** A product's rate as reports use it (today's rate; missing or removed = the default); a platform line without a product: the default. */
export function rateLookup(products: { id: string; vatRate?: number }[], settings: VatSettings) {
  const m = new Map(products.map(p => [p.id, productVat(p, settings)]));
  return (productId: string) => m.get(productId) ?? settings.default;
}
/** The bill's lines that count (cancelled and unapproved orders out), with their rates. */
export function billLines(orders: Order[], rateOf: (productId: string) => number): RateLine[] {
  // A line carries the rate it was sold with; older lines take the product's.
  return orders.filter(o => o.status !== 'cancelled' && o.status !== 'awaiting_approval').flatMap(o => o.lines.map(l => ({ orderId: o.id, lineId: l.id, rate: l.vatRate ?? rateOf(l.productId), total: l.total, unitPrice: l.unitPrice, quantity: l.quantity })));
}
/** Every payment of one bill, per rate, in payment order (see vat.ts allocateBill). */
export function billEntries(bill: { orders: Order[]; payments: Payment[]; tableName?: string }, rateOf: (productId: string) => number, fallback: number): FiscalEntry[] {
  const payments = [...bill.payments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const split = allocateBill(billLines(bill.orders, rateOf), payments, fallback);
  return payments.map(p => ({ id: p.id, kind: 'payment' as const, paymentId: p.id, at: p.createdAt, method: p.method, amount: p.amount, rows: p.method === 'platform' ? [] : split.get(p.id) ?? [], ...(bill.tableName ? { tableName: bill.tableName } : {}), ...(p.deposit ? { deposit: true as const } : {}) }));
}
/** The rate each line of these orders was sold with (OrderLine.vatRate), by order and line: refunded items go back at it. */
export function lineRates(orders: Order[]) {
  const m = new Map<string, number>();
  for (const o of orders) for (const l of o.lines) if (typeof l.vatRate === 'number') m.set(`${o.id}\0${l.id}`, l.vatRate);
  return (orderId: string, lineId: string) => m.get(`${orderId}\0${lineId}`);
}
/** A refund as the yazar kasa reverses it: items at their own rates (the rate they were sold with), an amount in proportion to the payment it gives back. */
export function refundEntry(a: Pick<PaymentAdjustment, 'id' | 'paymentId' | 'amount' | 'method' | 'createdAt' | 'items'>, payment: FiscalEntry | undefined, rateOf: (productId: string) => number, fallback: number, soldAt?: (orderId: string, lineId: string) => number | undefined): FiscalEntry {
  const rows = allocateRefund({ amount: a.amount, items: a.items?.map(i => ({ amount: i.amount, rate: soldAt?.(i.orderId, i.lineId) ?? rateOf(i.productId) })) }, payment?.rows ?? [], payment?.rows[0]?.rate ?? fallback);
  return { id: a.id, kind: 'refund', paymentId: a.paymentId, at: a.createdAt, method: a.method, amount: a.amount, rows, ...(payment?.tableName ? { tableName: payment.tableName } : {}) };
}

/** A payment or refund of the window nobody marked "Girildi". */
export type FiscalOpen = { id: string; kind: 'payment' | 'refund'; paymentId: string; at: string; amount: number; method: 'cash' | 'card'; tableName?: string };
/**
 * "Yazar kasa karşılaştırması" of one closing window: what should be on the yazar kasa per rate (payments by cash and card,
 * kapora parts included), the refunds to reverse, online platform money apart (not in the total), and what nobody ticked.
 */
export type CashFiscal = {
  rows: RateAmount[]; total: number; cash: number; card: number;
  refundRows?: RateAmount[]; refunds?: number; platform?: number;
  /** Payments and refunds to enter, and how many were ticked "Girildi". */
  count: number; entered: number;
  /** Not ticked, oldest first, at most FISCAL_LIST_MAX; `more` = how many did not fit. */
  open: FiscalOpen[]; more?: number;
  /** "Ödemeden sonra 'Girildi' onayı iste" was on when it was counted. */
  askConfirm?: boolean;
};
export const FISCAL_LIST_MAX = 300;
export function fiscalSummary(entries: FiscalEntry[], marked: (id: string) => boolean, askConfirm = false): CashFiscal {
  const sales = entries.filter(e => e.kind === 'payment' && e.method !== 'platform'), refunds = entries.filter(e => e.kind === 'refund');
  const platform = entries.filter(e => e.kind === 'payment' && e.method === 'platform').reduce((n, e) => n + e.amount, 0);
  const rows = addRates(...sales.map(e => e.rows)), refundRows = addRates(...refunds.map(e => e.rows));
  const total = rows.reduce((n, r) => n + r.amount, 0), refundTotal = refundRows.reduce((n, r) => n + r.amount, 0);
  const counted = [...sales, ...refunds].sort((a, b) => a.at.localeCompare(b.at));
  const open = counted.filter(e => !marked(e.id)).map(e => ({ id: e.id, kind: e.kind, paymentId: e.paymentId, at: e.at, amount: e.amount, method: e.method === 'card' ? 'card' as const : 'cash' as const, ...(e.tableName ? { tableName: e.tableName } : {}) }));
  return {
    rows, total, cash: sales.filter(e => e.method === 'cash').reduce((n, e) => n + e.amount, 0), card: sales.filter(e => e.method === 'card').reduce((n, e) => n + e.amount, 0),
    ...(refundTotal ? { refundRows, refunds: refundTotal } : {}), ...(platform ? { platform } : {}),
    count: counted.length, entered: counted.length - open.length, open: open.slice(0, FISCAL_LIST_MAX), ...(open.length > FISCAL_LIST_MAX ? { more: open.length - FISCAL_LIST_MAX } : {}),
    ...(askConfirm ? { askConfirm: true } : {}),
  };
}
/** The same summary after more ticks (between the count and "Kapanışı tamamla"): ticked ones leave the list. */
export function withMarks(f: CashFiscal, marked: (id: string) => boolean): CashFiscal {
  const open = f.open.filter(o => !marked(o.id)), gone = f.open.length - open.length;
  return { ...f, open, entered: f.entered + gone };
}
/** Whether the "not entered" list says anything: someone ticks "Girildi" (or was asked to). */
export const ticksUsed = (f: Pick<CashFiscal, 'entered' | 'askConfirm'>) => !!f.askConfirm || f.entered > 0;

/** The Z raporu as typed at the closing: KDV dahil total, and per rate when given; the differences are Z − Mola. */
export type FiscalZ = { total: number; rates?: RateAmount[]; difference: number; rateDifferences?: RateAmount[] };
export function zCompare(f: Pick<CashFiscal, 'rows' | 'total'>, z: { total: number; rates?: RateAmount[] }): FiscalZ {
  const rates = z.rates?.filter(r => Number.isSafeInteger(r.amount)).sort((a, b) => a.rate - b.rate);
  return { total: z.total, ...(rates?.length ? { rates, rateDifferences: rates.map(r => ({ rate: r.rate, amount: r.amount - (f.rows.find(x => x.rate === r.rate)?.amount ?? 0) })) } : {}), difference: z.total - f.total };
}
/** The plain sentence under the difference. */
export function zExplanation(f: Pick<CashFiscal, 'refunds'>, z: Pick<FiscalZ, 'difference'>) {
  const d = z.difference, refunds = f.refunds ?? 0;
  if (d === 0) return 'Z raporu Mola ile aynı: bu kapanıştaki ödemeler yazar kasaya girilmiş görünüyor.';
  if (d < 0 && refunds && -d === refunds) return `Fark bugünkü iadeler kadar (${kasaMoney(refunds)}): iadeleri yazar kasada ters işlemle düştüyseniz bu normaldir.`;
  if (d < 0) return `Z raporu Mola'dan ${kasaMoney(-d)} az. Fark varsa fiş kesilmemiş hesap olabilir; aşağıdaki “Girildi” işaretlenmemiş ödemelere bakın.`;
  return `Z raporu Mola'dan ${kasaMoney(d)} fazla. Bir tutar yazar kasaya iki kez ya da yanlış departmana girilmiş olabilir; ya da Mola'ya kaydedilmemiş bir satış var.`;
}
