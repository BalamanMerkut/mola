/*
 * POS komisyonu (Ayarlar → Sipariş ve kasa → Kasa ve ödeme, and the first-setup wizard). Stored as basis points on
 * State.commissionBps (250 = %2,5); every card payment freezes its own commission when it is taken (engine.ts).
 *
 * 8 Ekim: the owner's first real day showed "Kart komisyonu ₺213" on ₺710 of card sales, i.e. %30. The rate box read the
 * percentage with the money parser and accepted anything up to %100, so a slip ("30" for "3,0", an extra zero) was saved
 * silently and nothing on screen said which rate was in use. Rates are now read by their own parser, refused above
 * MAX_COMMISSION_BPS (%10; Turkish banks charge about %1–4), the settings show what the rate means on ₺100 and the
 * reports say which share of the card sales the commission is. A legacy rate above the limit records no commission
 * (unknown, "geçici") instead of a wrong one, until the owner writes the right rate.
 */
export const MAX_COMMISSION_BPS = 1000;
/** Above this the settings ask "emin misiniz" in words (still saved). */
export const HIGH_COMMISSION_BPS = 500;

/** "2,5", "%2,5", "2.5", "1,79", "3" → basis points; '' → null; anything else → NaN. */
export function parseCommissionRate(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '').replace(/^%|%$/g, '');
  if (t === '') return null;
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}
/** The inline message under the rate box ('' when fine or empty). */
export function commissionRateProblem(text: string) {
  const bps = parseCommissionRate(text);
  if (bps === null) return '';
  if (!Number.isFinite(bps)) return 'Oranı yüzde olarak yazın: örn. 1,79 ya da 2,5.';
  if (bps > MAX_COMMISSION_BPS) return `%${rateText(bps)} çok yüksek: bankaların POS oranı genelde %1 ile %4 arasıdır. Örn. %3 için 3 yazın (en fazla %10).`;
  return '';
}
/** 250 → "2,5"; 179 → "1,79"; 300 → "3". */
export const rateText = (bps: number) => (bps / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
/** The commission of one card payment at this rate; null (unknown) without a rate or with a legacy rate above the limit. */
export const commissionOf = (amount: number, bps: number | null | undefined) => typeof bps === 'number' && bps >= 0 && bps <= MAX_COMMISSION_BPS ? Math.round(amount * bps / 10_000) : null;
/**
 * The rate an owner saves: null or 0…%10. A legacy rate above the limit may be sent back unchanged (every switch in Ayarlar
 * sends the whole preference set), never newly written.
 */
export const commissionAllowed = (next: number | null, current: number | null | undefined) => next === null || next <= MAX_COMMISSION_BPS || next === current;
export const COMMISSION_TOO_HIGH = `POS komisyon oranı en fazla %10 olabilir; bankaların oranı genelde %1 ile %4 arasıdır. Örn. %3 için 3 yazın.`;
/** "₺100 kart satışında ₺2,50 komisyon düşülür." */
export function commissionExample(bps: number, money: (k: number) => string) { return `₺100 kart satışında ${money(commissionOf(10_000, bps) ?? 0)} komisyon düşülür.`; }
/** The share of card sales the period's commission is (0.025 = %2,5); null without card sales. */
export const commissionShare = (commission: number, card: number) => card > 0 ? commission / card : null;
/** "%2,5" of a share, one decimal at most. */
/** Two decimals like the rate the owner types (%1,79 — it read %1,8, 8 Ekim denetimi K10). */
export const shareText = (share: number) => `%${(Math.round(share * 10000) / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
