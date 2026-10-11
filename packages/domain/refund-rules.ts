import type { CashShiftSettings } from './cash.js';
import { businessDay } from './business-day.js';

/**
 * 9 Ekim kullanıcı testi: the refund of an earlier day's payment (even a closed year's: 4 years back) is written to today;
 * the confirmation said nothing about it. '' for today's payments. A year closes on 1 February of the next year.
 */
export function pastDayNote(paidAt: string, now: number = Date.now()) {
  const paid = businessDay(paidAt), today = businessDay(now);
  if (paid >= today) return '';
  const [y, m, d] = paid.split('-'), year = Number(y), thisYear = Number(today.slice(0, 4));
  const closedYear = year < thisYear - 1 || (year < thisYear && today >= `${thisYear}-02-01`);
  return `Ödeme ${d}.${m}.${y} tarihli${closedYear ? ' (kapanmış yıl)' : ''}; iade bugünün raporuna yazılır, o günün rakamları değişmez.`;
}

/*
 * İade kuralları shared by the screens and the server (no server-only imports: the browser bundle uses them too).
 * Money in kuruş. Who may refund how much, the reason chips, and how a capped refund is shared out over its items.
 */

export type RefundReason = 'wrong' | 'disliked' | 'late' | 'other';
export const REFUND_REASONS: RefundReason[] = ['wrong', 'disliked', 'late', 'other'];
export const refundReasonNames: Record<RefundReason, string> = { wrong: 'Yanlış ürün', disliked: 'Beğenilmedi', late: 'Geç geldi', other: 'Diğer' };

/** "Kasiyerin yapabileceği en yüksek iade" (one refund) and the cashier's daily total, when the owner set nothing. */
export const DEFAULT_CASHIER_REFUND_MAX = 15000, DEFAULT_CASHIER_REFUND_DAY = 50000;

/**
 * 'full': every refund, any amount, and payment method corrections (işletme sahibi, and the Müdür role).
 * 'limited': refunds up to the owner's limits, per refund and per cash day (kasiyer); above them an "iade isteği" to the owner.
 * 'none': no refunds (garson, mutfak, destek).
 * The one place that says which role refunds how: server routes and screens ask this, never a role list of their own.
 */
export type RefundPower = 'full' | 'limited' | 'none';
const FULL_REFUND_ROLES: readonly string[] = ['owner', 'manager', 'mudur'];
export function refundPower(role: string | undefined): RefundPower {
  if (!role) return 'none';
  return FULL_REFUND_ROLES.includes(role) ? 'full' : role === 'cashier' ? 'limited' : 'none';
}

/** The cashier's limits: `max` for one refund (0 = the cashier refunds nothing alone), `day` for the cash day's total. */
export function cashierRefundLimits(s?: Pick<CashShiftSettings, 'cashierRefundMax' | 'cashierRefundDay'> | null) {
  return { max: s?.cashierRefundMax ?? DEFAULT_CASHIER_REFUND_MAX, day: s?.cashierRefundDay ?? DEFAULT_CASHIER_REFUND_DAY };
}
const lira = (kurus: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: kurus % 100 === 0 ? 0 : 2 }).format(kurus / 100);
/** Why a cashier may not record this refund alone ('' when allowed). `usedToday`: the cashier's refunds of this cash day so far. */
export function cashierRefundProblem(amount: number, usedToday: number, limits: { max: number; day: number }) {
  if (limits.max <= 0) return 'Kasiyer iade yapamaz; iadeyi işletme sahibi yapar.';
  if (amount > limits.max) return `Kasiyer tek seferde en çok ${lira(limits.max)} iade edebilir.`;
  if (usedToday + amount > limits.day) return `Kasiyerin bugünkü iade sınırı ${lira(limits.day)}; bugün ${lira(usedToday)} iade edildi.`;
  return '';
}
export const OWNER_REQUIRED_TEXT = 'Bu iade için işletme sahibi gerekir.';

/** The reason as it is kept and shown: "Beğenilmedi · Soğuk geldi". "Diğer" alone needs a note. */
export function refundReasonText(reasons: readonly RefundReason[], note: string) {
  const words = reasons.filter(r => r !== 'other' || !note.trim()).map(r => refundReasonNames[r]);
  return [...words, ...(note.trim() ? [note.trim()] : [])].join(' · ');
}
export function refundReasonProblem(reasons: readonly RefundReason[], note: string) {
  if (!reasons.length && !note.trim()) return 'İadenin nedenini seçin.';
  if (reasons.some(r => !REFUND_REASONS.includes(r))) return 'İade nedeni geçersiz.';
  if (reasons.includes('other') && !note.trim()) return '“Diğer” için kısa bir açıklama yazın.';
  if (note.trim().length > 300) return 'Açıklama en fazla 300 karakter olabilir.';
  return '';
}

/**
 * A refund capped at what the payment still has (an amount-paid bill paid in parts): each item gets its share in proportion
 * to its value, kuruş exact, the last kuruş to the largest items. Never more than the item's own value.
 */
export function splitRefund(values: readonly number[], total: number): number[] {
  const sum = values.reduce((n, v) => n + v, 0);
  if (total >= sum) return [...values];
  if (sum <= 0 || total <= 0) return values.map(() => 0);
  const shares = values.map(v => Math.floor(v * total / sum));
  let left = total - shares.reduce((n, v) => n + v, 0);
  const order = values.map((v, i) => i).sort((a, b) => values[b] - values[a] || a - b);
  for (let k = 0; left > 0 && k < order.length * 2; k++) { const i = order[k % order.length]; if (shares[i] < values[i]) { shares[i]++; left--; } }
  return shares;
}

/** One line of a bill as an item refund offers it: what this payment paid of it and what is still refundable. */
export type RefundableItem = {
  orderId: string; lineId: string; productId: string; name: string; optionNames: string[]; grams?: number; note?: string;
  /** Paid price of one piece (a weighed line: the whole line), campaign discount already in it. */
  unit: number;
  /** Pieces this payment covers, pieces refunded already, pieces still refundable. */
  paid: number; refunded: number; left: number;
};
/** The value of the chosen pieces and the refund it makes, capped at what the payment still has. */
export function itemRefundTotal(items: readonly RefundableItem[], chosen: Record<string, number>, remaining: number) {
  const value = items.reduce((n, i) => n + i.unit * Math.max(0, Math.min(i.left, chosen[i.lineId] ?? 0)), 0);
  return { value, amount: Math.min(value, Math.max(0, remaining)), capped: value > remaining };
}
