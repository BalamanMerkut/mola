import type { Product } from './types.js';
import { marginRules, productGroup, categoryGroup, thresholdOf, type MarginGroup, type MarginSettings } from './margins.js';
import { currentRecipes, DAY, LOW_MARGIN, lineMultiplier, pricePoints, recipeAt, recipeIndex, recipeUsage, stockDayStart, unitCostAt, type Recipe, type StockData } from './stock.js';

/*
 * Satış ve Raporlar → Kârlılık. Revenue is what the products sold for (line totals, after campaign discounts; cancelled
 * orders left out), cost is the recipe in force at the sale × the item prices of that day (the last purchase before it).
 * Sales from before stock tracking started use the first recipe and the first price, so a café that just wrote its recipes
 * sees this month's profit at once. Ready-bought products cost their own purchase price. Item refunds ("Ürün bazlı iade") take
 * their pieces and paid amount off the product, on the day of the payment; their cost stays (the product was made) unless the
 * items went back into stock unused ("stoğa ekle"). Amount-only refunds are money, not products: the Özet's "Elde kalan" has them.
 */

/** One day of sales as the stored summaries keep it (packages/domain/history.ts Totals): products and option variants. */
export type ProfitDay = {
  products: Map<string, { first: string; quantity: number; amount: number; grams: number }>;
  variants: Map<string, Map<string, { quantity: number; grams: number }>>;
  /** Item refunds of that day's payments (history.ts Totals.returned). */
  returned?: Map<string, { productId: string; key: string; name: string; quantity: number; amount: number; grams: number; restocked: number; restockedGrams: number }>;
};
export type ProfitRow = {
  id: string; name: string; category: string; unit?: 'kg'; quantity: number; grams: number; revenue: number;
  /** null: no cost known ("Maliyet girilmemiş"); `missing` says why. */
  cost: number | null; profit: number | null; margin: number | null; low: boolean;
  /** The product's "Düşük kâr" group and the margin under which it is marked (null: the warning is off). */
  group?: MarginGroup; threshold: number | null;
  missing?: 'recipe' | 'price'; missingItems?: string[];
};
export type ProfitCategory = { name: string; revenue: number; costedRevenue: number; cost: number; profit: number; margin: number | null; uncosted: number; group?: MarginGroup; threshold: number | null };
export type ProfitReport = {
  from: string; to: string; rows: ProfitRow[]; categories: ProfitCategory[];
  totals: { revenue: number; costedRevenue: number; cost: number; profit: number; margin: number | null; uncostedRevenue: number; uncostedProducts: number; lowProducts: number };
  /** The one line of a plain call (no `margins`); null when groups decide (`rows[].threshold`). */
  lowMargin: number | null;
  /** Whether "Düşük kâr" marks are given at all (Ayarlar → Giderler). */
  marginAlerts: boolean;
  /** 'sale': the recipe and prices in force on each sale's day; 'today': every sale costed with today's recipe and latest prices. */
  basis: ProfitBasis;
};
export type ProfitBasis = 'sale' | 'today';

/**
 * `lowMargin`: the business's "Düşük kâr" line (Ayarlar; LOW_MARGIN when missing). `basis` 'today' answers "what would these
 * sales earn at today's costs?": the current recipe (or the first one, for a product whose tracking has ended) and the latest price.
 */
type ProfitInput = { from: string; to: string; days: Iterable<[string, ProfitDay]>; products: readonly Product[]; data: StockData; now: number; lowMargin?: number; margins?: MarginSettings; basis?: ProfitBasis };
export function profitReport(input: ProfitInput): ProfitReport { const steps = profitReportSteps(input); for (;;) { const r = steps.next(); if (r.done) return r.value; } }
/** profitReport a day per step: "Tümü" (five years of days × products) runs in slices between the tablets' requests (server/stock.ts). */
export function* profitReportSteps(input: ProfitInput): Generator<void, ProfitReport> {
  const basis = input.basis ?? 'sale', today = basis === 'today';
  // "Düşük kâr": the business's groups (margins.ts) when given, else one flat line.
  const rules = input.margins ? marginRules(input.margins) : null, flat = rules ? null : input.lowMargin ?? LOW_MARGIN;
  const ready = rules ? new Set([...currentRecipes(input.data.recipes, input.now)].filter(([, r]) => r.ready).map(([id]) => id)) : new Set<string>();
  const groupOf = (id: string, category: string) => rules ? productGroup({ category }, ready.has(id), rules) : undefined;
  const limit = (g: MarginGroup | undefined) => rules && g ? thresholdOf(g, rules) : flat;
  const index = recipeIndex(input.data.recipes), items = new Map(input.data.items.map(i => [i.id, i]));
  // Price points of every item, read once; recipe amounts per option key, worked out once.
  const points = new Map<string, { at: number; unitCost: number }[]>();
  for (const id of new Set(input.data.entries.map(e => e.itemId).filter((v): v is string => !!v))) points.set(id, pricePoints(id, input.data.entries));
  const priceAt = (itemId: string, at: number) => unitCostAt(points.get(itemId) ?? [], at);
  const usageMemo = new Map<Recipe, Map<string, [string, number][]>>();
  const usage = (r: Recipe, key: string) => { let m = usageMemo.get(r); if (!m) usageMemo.set(r, m = new Map()); let u = m.get(key); if (!u) m.set(key, u = [...recipeUsage(r, key)].filter(([, n]) => n > 0)); return u; };
  const byId = new Map(input.products.map(p => [p.id, p]));
  type Acc = { name: string; quantity: number; grams: number; revenue: number; cost: number; costed: boolean; missing?: 'recipe' | 'price'; missingItems: Set<string> };
  const acc = new Map<string, Acc>();
  /** The recipe used for a sale at `at`: the one in force, or the first one for sales before stock tracking. */
  const recipeFor = (productId: string, at: number): Recipe | undefined => { const versions = index.get(productId); return recipeAt(versions, today ? input.now : at) ?? versions?.[0]; };
  // A recipe's cost changes only when a price does: costs are kept while no new price point has started (most days).
  const times = [...points.values()].flatMap(list => list.map(p => p.at)).sort((x, y) => x - y);
  const epochOf = (at: number) => { let lo = 0, hi = times.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= at) lo = mid + 1; else hi = mid; } return lo; };
  let epoch = -1, costs = new Map<Recipe, Map<string, number | string[]>>(), at = 0;
  /** Cost of one piece (or kg) at the current day's prices, or the items without a price. */
  const costOf = (r: Recipe, key: string) => {
    let m = costs.get(r); if (!m) costs.set(r, m = new Map());
    let c = m.get(key);
    if (c === undefined) {
      let cost = 0; const missing: string[] = [];
      for (const [itemId, amount] of usage(r, key)) { const unit = priceAt(itemId, at); if (unit === null) missing.push(itemId); else cost += unit * amount; }
      m.set(key, c = missing.length ? missing : cost);
    }
    return c;
  };
  const addCost = (a: Acc, r: Recipe, key: string, quantity: number, grams: number) => {
    const cost = costOf(r, key);
    if (typeof cost !== 'number') { a.costed = false; a.missing = 'price'; for (const m of cost) a.missingItems.add(items.get(m)?.name ?? 'Silinmiş malzeme'); return; }
    a.cost += cost * lineMultiplier(quantity, grams);
  };
  // forEach, not for…of: a year of days × products would otherwise allocate an entry array per step.
  for (const [day, d] of input.days) {
    at = today ? input.now : Math.min(stockDayStart(day) + DAY - 1, input.now);
    const e = epochOf(at);
    if (e !== epoch) { epoch = e; costs = new Map(); }
    d.products.forEach((p, id) => {
      let a = acc.get(id);
      if (!a) acc.set(id, a = { name: p.first, quantity: 0, grams: 0, revenue: 0, cost: 0, costed: true, missingItems: new Set() });
      a.quantity += p.quantity; a.grams += p.grams; a.revenue += p.amount;
      const r = recipeFor(id, at);
      if (!r?.items.length) { a.costed = false; a.missing ??= 'recipe'; return; }
      // Lines with options first, the rest is the plain product.
      let q = p.quantity, g = p.grams;
      const variants = d.variants.get(id);
      if (variants) for (const [key, v] of variants) { addCost(a, r, key, v.quantity, v.grams); q -= v.quantity; g -= v.grams; }
      if (q > 0 || g > 0) addCost(a, r, '', Math.max(0, q), Math.max(0, g));
    });
    d.returned?.forEach(back => {
      const a = acc.get(back.productId);
      if (!a) return;
      a.quantity = Math.max(0, a.quantity - back.quantity); a.grams = Math.max(0, a.grams - back.grams); a.revenue = Math.max(0, a.revenue - back.amount);
      // Back in stock unused: its ingredients were not used up after all.
      const r = recipeFor(back.productId, at);
      if ((back.restocked > 0 || back.restockedGrams > 0) && r?.items.length && a.costed) { const cost = costOf(r, back.key); if (typeof cost === 'number') a.cost = Math.max(0, a.cost - cost * lineMultiplier(back.restocked, back.restockedGrams)); }
    });
    yield;
  }
  const rows: ProfitRow[] = [...acc].map(([id, a]) => {
    const product = byId.get(id), cost = a.costed ? Math.round(a.cost) : null, profit = cost === null ? null : a.revenue - cost;
    const margin = profit === null || a.revenue <= 0 ? null : profit / a.revenue, category = product?.category || 'Diğer';
    const group = groupOf(id, category), threshold = limit(group);
    return { id, name: product?.name ?? a.name, category, ...(product?.unit === 'kg' ? { unit: 'kg' as const } : {}), quantity: a.quantity, grams: a.grams, revenue: a.revenue, cost, profit, margin, low: margin !== null && threshold !== null && margin < threshold, ...(group ? { group } : {}), threshold,
      ...(cost === null ? { missing: a.missing ?? 'recipe', ...(a.missingItems.size ? { missingItems: [...a.missingItems] } : {}) } : {}) };
  }).sort((x, y) => (y.profit ?? -Infinity) - (x.profit ?? -Infinity) || y.revenue - x.revenue || x.name.localeCompare(y.name, 'tr'));
  const categories = new Map<string, ProfitCategory>();
  for (const r of rows) {
    let c = categories.get(r.category);
    if (!c) { const group = rules ? categoryGroup(r.category, rules) : undefined; categories.set(r.category, c = { name: r.category, revenue: 0, costedRevenue: 0, cost: 0, profit: 0, margin: null, uncosted: 0, ...(group ? { group } : {}), threshold: limit(group) }); }
    c.revenue += r.revenue;
    if (r.cost === null) c.uncosted++; else { c.costedRevenue += r.revenue; c.cost += r.cost; c.profit += r.profit!; }
  }
  for (const c of categories.values()) c.margin = c.costedRevenue > 0 ? c.profit / c.costedRevenue : null;
  // A category's line follows what it sold: its costed products' lines weighted by revenue (a "Tatlılar" of ready-bought
  // cakes is held to the ready-product line, not the dessert one).
  if (rules?.enabled) for (const c of categories.values()) {
    const mine = rows.filter(r => r.category === c.name && r.cost !== null && r.threshold !== null && r.revenue > 0), weight = mine.reduce((n, r) => n + r.revenue, 0);
    if (weight > 0) c.threshold = mine.reduce((n, r) => n + r.threshold! * r.revenue, 0) / weight;
  }
  const costed = rows.filter(r => r.cost !== null), revenue = rows.reduce((n, r) => n + r.revenue, 0);
  const costedRevenue = costed.reduce((n, r) => n + r.revenue, 0), cost = costed.reduce((n, r) => n + r.cost!, 0), profit = costedRevenue - cost;
  return { from: input.from, to: input.to, rows, lowMargin: flat, marginAlerts: rules ? rules.enabled : true, basis,
    categories: [...categories.values()].sort((a, b) => b.profit - a.profit || b.revenue - a.revenue || a.name.localeCompare(b.name, 'tr')),
    totals: { revenue, costedRevenue, cost, profit, margin: costedRevenue > 0 ? profit / costedRevenue : null, uncostedRevenue: revenue - costedRevenue, uncostedProducts: rows.length - costed.length, lowProducts: rows.filter(r => r.low).length } };
}
