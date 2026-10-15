import { featureById, featureIds, features, defaultPackages, isFeatureId, shownFeatures, withRequirements, yearlyFromMonthly, type FeatureId } from './features.js';
export { isFeatureId };

/*
 * Mola Merkez's side of the service catalogue (packages/domain/features.ts): the vendor's prices, packages and package
 * discounts, a business's own discount, and what a set of services costs. Browser-safe (Mola Yönetim's screens compute the
 * same live totals the server stores). All amounts are kuruş, without KDV.
 *   - Prices: each service's monthly price may be changed; the yearly price is monthly × 10 unless the vendor typed one.
 *   - Packages: a name, the services (always with their requirements: features.ts withRequirements), an optional discount
 *     (₺ per month, or %). Two "eski plan" packages keep the businesses from before packaging exactly as they were.
 *   - A business: one package or "Özel" (its own services), optionally its own discount on top.
 */
export type PriceOverride = { monthly: number; yearly?: number };
export type ServicePrices = Partial<Record<FeatureId, PriceOverride>>;
/** `amount`: kuruş off per month (×10 for the yearly price); `percent`: 1–100 off both. */
export type Discount = { kind: 'amount' | 'percent'; value: number };
export type ServicePackage = {
  id: string; name: string; features: FeatureId[]; discount?: Discount;
  /** No longer offered for new choices; businesses that have it keep it. */
  archived?: boolean;
  /** One of the two plans from before packaging (Tam sistem / Sadece QR menü): its services cannot be edited. */
  legacy?: 'full' | 'menu';
  createdAt: string; updatedAt: string;
};
export type Price = { monthly: number; yearly: number; listMonthly: number; listYearly: number };
export type PeriodMonths = 1 | 6 | 12;
export const PERIODS: PeriodMonths[] = [1, 6, 12];
export const periodName = (m: number) => m === 12 ? '1 yıl' : `${m} ay`;

/** Ids of the old plans' packages (the migration maps every business from before packaging onto one of them). */
export const LEGACY_FULL = 'eski-tam-sistem', LEGACY_MENU = 'eski-sadece-qr-menu';
/** Every service that can be sold now (not "Yakında"), in catalogue order. */
export const sellableFeatures = (): FeatureId[] => features.filter(f => !f.soon).map(f => f.id);
/**
 * The old plans, kept exactly: "Tam sistem" had everything there was; "Sadece QR menü" had everything except the customer's
 * QR ordering and waiter calls (`qr-order`). Their licences keep `service` too, so older café versions behave as before.
 */
export const legacyFeatures = (service: 'full' | 'menu'): FeatureId[] => service === 'menu' ? sellableFeatures().filter(id => id !== 'qr-order') : sellableFeatures();
/**
 * The licence's old `service` word for a set of services: without QR ordering a café is "menu only" (older café versions
 * that do not read `features` still close the customer's basket and waiter calls).
 */
export const serviceOf = (ids: readonly FeatureId[]): 'full' | 'menu' => ids.includes('qr-order') ? 'full' : 'menu';
/** A valid, ordered service list: known and sellable ids, core and every requirement added. */
export const normalFeatures = (ids: Iterable<unknown>): FeatureId[] => withRequirements([...ids].filter(isFeatureId).filter(id => !featureById.get(id)!.soon)).filter(id => !featureById.get(id)!.soon);
/** Unticking a service also unticks what needs it (QR menü off → QR sipariş off). Core stays. */
export function withoutFeature(chosen: readonly FeatureId[], id: FeatureId): FeatureId[] {
  if (featureById.get(id)?.required) return [...chosen];
  const out = new Set(chosen); out.delete(id);
  for (let changed = true; changed;) {
    changed = false;
    for (const x of [...out]) if ((featureById.get(x)?.requires ?? []).some(r => !out.has(r))) { out.delete(x); changed = true; }
  }
  return featureIds.filter(x => out.has(x));
}
/** What a choice brought along: [added service, the chosen one that needs it] ("QR sipariş için QR menü de eklendi"). */
export function addedFor(chosen: readonly FeatureId[]): [FeatureId, FeatureId][] {
  const pairs: [FeatureId, FeatureId][] = [];
  // A part sold inside another service (Uzaktan yönetim) is not shown, so it never "brings" anything.
  for (const id of shownFeatures(chosen)) for (const need of featureById.get(id)?.requires ?? []) if (!pairs.some(([a]) => a === need)) pairs.push([need, id]);
  return pairs;
}

/** One service's price now: the vendor's, else the starting price; yearly = monthly × 10 unless typed. */
export function priceOf(id: FeatureId, prices: ServicePrices = {}) {
  const f = featureById.get(id)!, o = prices[id], monthly = o?.monthly ?? f.monthly;
  return { monthly, yearly: o?.yearly ?? yearlyFromMonthly(monthly), yearlyTyped: o?.yearly !== undefined, changed: !!o && (o.monthly !== f.monthly || o.yearly !== undefined) };
}
/** A discount on a price for `months` months of service (yearly: 10). Never below zero. */
export function discounted(amount: number, d: Discount | undefined, months: number) {
  if (!d || !d.value) return amount;
  return Math.max(0, d.kind === 'percent' ? Math.round(amount * (100 - Math.min(100, d.value)) / 100) : amount - d.value * months);
}
/**
 * The price of a set of services ("Yakında" ones cost nothing: they cannot be used yet; nor does a part sold inside another
 * service, 'remote-admin', even when an older catalogue stored a price for it), then each discount in turn.
 */
export function priceFor(ids: Iterable<FeatureId>, prices: ServicePrices = {}, ...discounts: (Discount | undefined)[]): Price {
  let listMonthly = 0, listYearly = 0;
  for (const id of new Set(ids)) { const f = featureById.get(id); if (!f || f.soon || f.partOf) continue; const p = priceOf(id, prices); listMonthly += p.monthly; listYearly += p.yearly; }
  let monthly = listMonthly, yearly = listYearly;
  for (const d of discounts) { monthly = discounted(monthly, d, 1); yearly = discounted(yearly, d, 10); }
  return { monthly, yearly, listMonthly, listYearly };
}
/** What `months` of service cost: 1 or 6 months at the monthly price, a year at the yearly price. */
export const periodPrice = (p: Pick<Price, 'monthly' | 'yearly'>, months: number) => months === 12 ? p.yearly : p.monthly * months;
/** Monthly recurring revenue of one paying business: a yearly plan counts as a twelfth of its yearly price. */
export const monthlyRevenue = (p: Pick<Price, 'monthly' | 'yearly'>, planMonths: number | undefined) => (planMonths ?? 12) === 12 ? Math.round(p.yearly / 12) : p.monthly;

/** The starting packages (features.ts defaultPackages) and the two old plans, made once on the first start of this version. */
export function startingPackages(at: string): ServicePackage[] {
  return [
    ...defaultPackages.map(p => ({ id: p.id, name: p.name, features: normalFeatures(p.features), ...(p.discount ? { discount: { ...p.discount } } : {}), createdAt: at, updatedAt: at })),
    { id: LEGACY_FULL, name: 'Tam sistem (eski plan)', features: legacyFeatures('full'), legacy: 'full', createdAt: at, updatedAt: at },
    { id: LEGACY_MENU, name: 'Sadece QR menü (eski plan)', features: legacyFeatures('menu'), legacy: 'menu', createdAt: at, updatedAt: at },
  ];
}
export const discountText = (d?: Discount) => !d || !d.value ? '' : d.kind === 'percent' ? `%${d.value} indirim` : `${lira(d.value)}/ay indirim`;

// ---------- KDV ----------
/** "Yazılım hizmeti KDV oranı" (Satışlarım); the vendor may change it. */
export const DEFAULT_VAT_RATE = 20;
export const vatOf = (net: number, rate: number) => Math.round(net * rate / 100);
export const netFromGross = (gross: number, rate: number) => Math.round(gross * 100 / (100 + rate));
/** "₺1.250" / "₺1.250,50". */
export const lira = (k: number) => `${k < 0 ? '−' : ''}₺${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: k % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(Math.abs(k) / 100)}`;
