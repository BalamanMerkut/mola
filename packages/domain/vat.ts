/*
 * KDV (katma değer vergisi), information only: menu prices already include it. The owner keeps a short list of rates
 * (Ayarlar → Giderler ve kâr → "KDV oranları"; ready with %10 and %20, %10 the default), each product carries one of them
 * (`Product.vatRate`; missing or no longer on the list = the default rate). Reports split the period's sales by rate
 * ("KDV dökümü"), and the bill receipt says "KDV dahildir · %10: ₺X". The guest menu never shows it. The official return is
 * made through the yazar kasa and the accountant; nothing here is a tax document.
 * Money in kuruş, rates in whole percent.
 */
export type VatSettings = { rates: number[]; default: number };
export const DEFAULT_VAT: VatSettings = { rates: [10, 20], default: 10 };
export const VAT_NOTE = 'Bilgi amaçlıdır; resmi beyan yazar kasa ve mali müşaviriniz üzerinden yapılır.';
export const MAX_VAT_RATES = 6;

const validRate = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100;
/** The business's rates, sorted, without repeats; the default is always one of them. A broken or missing value reads as %10 / %20. */
export function vatSettings(s: { vat?: Partial<VatSettings> | null }): VatSettings {
  const rates = [...new Set((s.vat?.rates ?? []).filter(validRate))].sort((a, b) => a - b).slice(0, MAX_VAT_RATES);
  if (!rates.length) return { rates: [...DEFAULT_VAT.rates], default: DEFAULT_VAT.default };
  const chosen = s.vat?.default;
  return { rates, default: validRate(chosen) && rates.includes(chosen) ? chosen : rates.includes(DEFAULT_VAT.default) ? DEFAULT_VAT.default : rates[0] };
}
/** The rate a product is sold with: its own when it is still on the list, else the default (older products, a removed rate). */
export function productVat(p: { vatRate?: number } | undefined, settings: VatSettings) {
  return p && validRate(p.vatRate) && settings.rates.includes(p.vatRate) ? p.vatRate : settings.default;
}

/**
 * KDV of a sale is the rate it was sold with: every order line carries it (OrderLine.vatRate, stamped when the line is made),
 * so changing a product's rate today never changes a past day's "KDV dökümü". Lines from before stamping carry none; the
 * rates of that moment are written once (`vatLegacy`, the first change after this version: Store.mutate) and count for all
 * of them. Products not in it (deleted earlier) count at its default rate.
 */
export type VatLegacy = { at: string; default: number; rates: [string, number][] };
export function captureVatLegacy(s: { vat?: Partial<VatSettings> | null; products: { id: string; vatRate?: number }[]; productDrafts?: { id: string; vatRate?: number }[] }, at: string): VatLegacy {
  const settings = vatSettings(s), rates: [string, number][] = [];
  // Only rates other than the default: the snapshot is written on every action, so it stays small.
  for (const p of [...s.products, ...(s.productDrafts ?? [])]) { const rate = productVat(p, settings); if (rate !== settings.default && !rates.some(([id]) => id === p.id)) rates.push([p.id, rate]); }
  return { at, default: settings.default, rates };
}
/** The rate of a product's unstamped lines: frozen in `vatLegacy`, today's rate until that is written. */
export function legacyRateOf(s: { vat?: Partial<VatSettings> | null; vatLegacy?: VatLegacy; products: { id: string; vatRate?: number }[] }) {
  if (s.vatLegacy) { const m = new Map(s.vatLegacy.rates), fallback = s.vatLegacy.default; return (productId: string) => m.get(productId) ?? fallback; }
  const settings = vatSettings(s), m = new Map(s.products.map(p => [p.id, productVat(p, settings)]));
  return (productId: string) => m.get(productId) ?? settings.default;
}

/** Words that mark an alcoholic drink in a product's name or category: the editor suggests the highest rate (owner decides). */
export const ALCOHOL_WORDS = ['bira', 'şarap', 'sarap', 'rakı', 'raki', 'viski', 'votka', 'vodka', 'likör', 'likor', 'kokteyl', 'alkollü', 'alkollu', 'cin', 'tekila', 'rom', 'konyak', 'şampanya', 'sampanya', 'prosecco', 'shot', 'beer', 'wine', 'whisky', 'whiskey', 'gin', 'cocktail', 'aperol', 'mojito', 'margarita', 'sangria'];
const SUFFIXES = ['', 'lar', 'ler', 'ları', 'leri', 's', 'sı', 'si', 'ı', 'i'];
/** A word on its own or with a plural ending ("Efes Bira", "Kırmızı şarap", "Kokteyller", "Biralar"), never inside another
 * word ("Cinnamon roll", "Romlu kek", "Biraderler tostu"). */
export function looksAlcoholic(...texts: (string | undefined)[]) {
  const words = texts.join(' ').toLocaleLowerCase('tr').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.some(w => ALCOHOL_WORDS.some(a => SUFFIXES.some(s => w === a + s)));
}
/** The rate to suggest for a product with this name and category: the highest rate for alcohol, else none (keep the choice). */
export function suggestVat(name: string, category: string, settings: VatSettings): number | null {
  if (!looksAlcoholic(name, category)) return null;
  const top = Math.max(...settings.rates);
  return top > settings.default ? top : null;
}

/** KDV inside a price that includes it: matrah = gross × 100 / (100 + rate), rounded to the kuruş; KDV = gross − matrah. */
export function vatOf(gross: number, rate: number) {
  const base = Math.round(gross * 100 / (100 + rate));
  return { gross, base, vat: gross - base };
}
export type VatRow = { rate: number; gross: number; base: number; vat: number };
/** Splits `total` over `weights` in proportion, to the kuruş, so the parts add up exactly (largest remainder). */
export function shareOut(total: number, weights: number[]) {
  const sum = weights.reduce((n, w) => n + Math.max(0, w), 0);
  if (!sum) return weights.map((_, i) => i === 0 ? total : 0);
  const raw = weights.map(w => total * Math.max(0, w) / sum), out = raw.map(Math.floor);
  let left = total - out.reduce((n, v) => n + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}
/**
 * The period's "KDV dökümü". `products`: what each product sold in the period (order line amounts, campaign discounts
 * already off, cancelled orders out, item refunds taken off: netProducts); they only give each rate its share. The money
 * itself is what was collected (`sales`: cash + card + platform) minus the period's refunds, so the rows add up to
 * "Satış − iadeler" exactly. No product sold (only kapora, say): everything at the default rate.
 */
export function vatBreakdown(input: ({ products: Iterable<[string, { amount: number }]>; rateOf: (productId: string) => number } | { weights: Map<number, number> }) & { sales: number; refunds: number; settings: VatSettings }) {
  // `weights`: each rate's share already worked out (history.ts vatWeights: stamped rates, frozen ones for older lines).
  let byRate = new Map<number, number>();
  if ('weights' in input) byRate = new Map([...input.weights].filter(([, v]) => v > 0));
  else for (const [id, p] of input.products) if (p.amount > 0) { const r = input.rateOf(id); byRate.set(r, (byRate.get(r) ?? 0) + p.amount); }
  const net = Math.max(0, input.sales - input.refunds);
  const rates = byRate.size ? [...byRate.keys()].sort((a, b) => a - b) : [input.settings.default];
  const parts = shareOut(net, rates.map(r => byRate.get(r) ?? 1));
  const rows: VatRow[] = rates.map((rate, i) => ({ rate, ...vatOf(parts[i], rate) }));
  const total = rows.reduce((t, r) => ({ rate: -1, gross: t.gross + r.gross, base: t.base + r.base, vat: t.vat + r.vat }), { rate: -1, gross: 0, base: 0, vat: 0 });
  return { rows, total, sales: input.sales, refunds: input.refunds };
}
export type VatBreakdown = ReturnType<typeof vatBreakdown>;
/** Several periods' rows added up per rate (the "Tümü" KDV is the sum of its years, so the year table adds up). */
export function addVatRows(lists: VatRow[][]) {
  const m = new Map<number, VatRow>();
  for (const r of lists.flat()) { const v = m.get(r.rate) ?? { rate: r.rate, gross: 0, base: 0, vat: 0 }; v.gross += r.gross; v.base += r.base; v.vat += r.vat; m.set(r.rate, v); }
  const rows = [...m.values()].sort((a, b) => a.rate - b.rate);
  return { rows, total: rows.reduce((t, r) => ({ rate: -1, gross: t.gross + r.gross, base: t.base + r.base, vat: t.vat + r.vat }), { rate: -1, gross: 0, base: 0, vat: 0 }) };
}
/*
 * Yazar kasa yardımcısı (packages/domain/fiscal.ts): what one payment or refund means per KDV rate, so the cashier enters
 * each rate's amount on its yazar kasa department ("%10 departman → ₺347,00"). Money in kuruş; every split adds up exactly.
 */
export type RateAmount = { rate: number; amount: number };
/** Summed per rate, sorted by rate, zero rows left out. */
export function byRate(parts: Iterable<RateAmount>): RateAmount[] {
  const m = new Map<number, number>();
  for (const p of parts) if (p.amount) m.set(p.rate, (m.get(p.rate) ?? 0) + p.amount);
  return [...m].filter(([, v]) => v !== 0).sort((a, b) => a[0] - b[0]).map(([rate, amount]) => ({ rate, amount }));
}
/** Several per-rate lists added together (a day's payments). */
export const addRates = (...lists: RateAmount[][]) => byRate(lists.flat());
/** `total` over the rates in proportion to `weights` (largest remainder, to the kuruş). No positive weight: all at `fallback`. */
export function splitByRate(total: number, weights: RateAmount[], fallback: number): RateAmount[] {
  const w = weights.filter(x => x.amount > 0);
  if (!total) return [];
  if (!w.length) return [{ rate: fallback, amount: total }];
  const parts = shareOut(total, w.map(x => x.amount));
  return byRate(w.map((x, i) => ({ rate: x.rate, amount: parts[i] })));
}
/** One line of a bill (amounts after campaign discounts) with its product's rate. Weighed lines: quantity 1, unitPrice = the line. */
export type RateLine = { orderId: string; lineId: string; rate: number; total: number; unitPrice: number; quantity: number };
/** A payment of the bill, in the order it was taken; `selections` when it was paid by choosing items. */
export type RatePayment = { id: string; amount: number; selections?: { orderId: string; lineId: string; quantity: number }[] };
/**
 * Every payment of one bill per rate. Paid by choosing items: those items (unit price × quantity, so campaign prices are in),
 * scaled to what was actually paid. Paid as an amount ("Tamamı", "Bir kısmı", a kapora): what the bill still owes per rate,
 * in proportion, so a coffee already paid by item is never counted again. Payments go in order and use up what each rate owes.
 */
export function allocateBill(lines: RateLine[], payments: RatePayment[], fallback: number): Map<string, RateAmount[]> {
  const owed = new Map<number, number>(), bill = new Map<number, number>();
  for (const l of lines) { owed.set(l.rate, (owed.get(l.rate) ?? 0) + l.total); bill.set(l.rate, (bill.get(l.rate) ?? 0) + l.total); }
  const asRows = (m: Map<number, number>) => [...m].map(([rate, amount]) => ({ rate, amount }));
  const out = new Map<string, RateAmount[]>();
  for (const p of payments) {
    let weights: RateAmount[] = [];
    if (p.selections?.length) weights = byRate(p.selections.flatMap(sel => { const l = lines.find(x => x.orderId === sel.orderId && x.lineId === sel.lineId); return l ? [{ rate: l.rate, amount: l.unitPrice * sel.quantity }] : []; }));
    if (!weights.some(w => w.amount > 0)) weights = asRows(owed);
    if (!weights.some(w => w.amount > 0)) weights = asRows(bill);
    const rows = splitByRate(p.amount, weights, fallback);
    for (const r of rows) owed.set(r.rate, Math.max(0, (owed.get(r.rate) ?? 0) - r.amount));
    out.set(p.id, rows);
  }
  return out;
}
/** A refund per rate: its items at their own rates (amounts already capped), or an amount in proportion to the payment it reverses. */
export function allocateRefund(refund: { amount: number; items?: { amount: number; rate: number }[] }, payment: RateAmount[], fallback: number): RateAmount[] {
  if (refund.items?.length) {
    const rows = byRate(refund.items), sum = rows.reduce((n, r) => n + r.amount, 0);
    return sum === refund.amount ? rows : splitByRate(refund.amount, rows, fallback);
  }
  return splitByRate(refund.amount, payment, fallback);
}
/** The bill receipt's line: "KDV dahildir · %10: ₺12,73 · %20: ₺5,00" from the bill's lines (amounts after discounts). */
export function receiptVat(lines: { amount: number; rate: number }[]) {
  const byRate = new Map<number, number>();
  for (const l of lines) if (l.amount > 0) byRate.set(l.rate, (byRate.get(l.rate) ?? 0) + l.amount);
  return [...byRate].sort((a, b) => a[0] - b[0]).map(([rate, gross]) => ({ rate, vat: vatOf(gross, rate).vat }));
}
