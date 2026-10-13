import type { Product, Selection } from './types.js';
import { businessDay, dayStart } from './business-day.js';

/*
 * Stok (Stok → Ürünler · Malzemeler · Reçeteler · Alış ve sayım). Nothing is written per sale: the stock of an item is
 *   last count (or 0 at its creation) + purchases + returns − waste − consumption since that count,
 * and consumption is computed from the sales themselves: stored daily summaries for whole past days (their `variants`
 * keep the option choices, packages/domain/history.ts) and exact lines for the few days that need a time inside the day
 * (a count, a recipe change) and for the orders still on the floor. Recipes are versions with `validFrom`, so a change
 * applies from that moment on and past consumption stays as it was.
 *
 * Browser-safe: only type imports and the import-free business day here (the screens use the same helpers). Amounts are in base units: grams, millilitres
 * or pieces. Money is kuruş; a unit cost is kuruş per base unit (a float: ₺450 / kg = 45 kuruş / g).
 */

export type StockUnit = 'g' | 'ml' | 'piece';
/** `kind: 'product'`: a ready-bought product (bottled water, canned cola, packaged cake) tracked by the piece; `productId` is that product. */
export type StockItem = {
  id: string; name: string; unit: StockUnit; min?: number; kind?: 'ingredient' | 'product'; productId?: string;
  createdAt: string; updatedAt?: string; removedAt?: string;
  /** Low-stock notification state: `low` while under the minimum, `n` counts the crossings (one notification each). */
  alert?: { low: boolean; n: number };
};
/** `amount` per piece sold, or per kilogram for products sold by weight. */
export type RecipeItem = { itemId: string; amount: number };
/**
 * What one chosen option changes: `replace` uses another item instead (Yulaf sütü instead of Süt), `scale` multiplies the
 * whole recipe (Büyük boy 1,5), `add` puts more in (Ekstra shot +9 g Kahve). Applied in that order; several chosen options combine.
 */
export type OptionRule = { groupId: string; optionId: string; scale?: number; add?: RecipeItem[]; replace?: { from: string; to: string }[] };
/** One version of a product's recipe, valid from `validFrom` until the next version. No items: the product is not tracked from then on. */
export type Recipe = { id: string; productId: string; validFrom: string; items: RecipeItem[]; options?: OptionRule[]; ready?: boolean; by?: string;
  /** Who wrote it, as named and with the role at that time (İşlem geçmişi; versions before 8 Ekim have only `by`). */
  byName?: string; role?: string };
export type StockEntryKind = 'purchase' | 'count' | 'waste' | 'return' | 'price';
/**
 * purchase: `quantity` bought for `total` kuruş (`unitCost` = total ÷ quantity), optionally recorded as an expense too (`expenseId`).
 * count: the real amount (`quantity`) and what Mola expected then (`expected`); the difference is shown as fark / fire.
 * waste: `quantity` thrown away, with `reason`. return: a refunded product came back unused; `items` are the amounts put back.
 * price: the owner set the unit cost by hand (no purchase yet).
 */
export type StockEntry = {
  id: string; kind: StockEntryKind; at: string; by: string; byName?: string;
  itemId?: string; quantity?: number; total?: number; unitCost?: number; supplier?: string; reason?: string; expected?: number;
  productId?: string; productQuantity?: number; items?: [string, number][]; expenseId?: string;
  deletedAt?: string; deletedBy?: string;
  /** Written with the item itself ("Şu an elinizde", the first price): shown as "Başlangıç", not as a count with a difference. */
  start?: boolean;
  /**
   * İşlem geçmişi (8 Ekim on): the writer's role, and for a record taken back who did it (id, role) and what it changed
   * ("Kahve 1 kg → 0 g"). Older records lack them: the history reads the role from the staff list and leaves the rest out.
   */
  role?: string; deletedById?: string; deletedRole?: string; deletedChange?: string;
  /** A purchase not paid yet ("Ödenmedi (veresiye)", 9 Ekim K-K): no expense now. Older purchases without an expense lack it. */
  unpaid?: boolean;
};
/**
 * Stok → İşlem geçmişi lines for what is not an entry or a recipe version (8 Ekim on): an item added, edited (name, unit),
 * removed, or its "Uyarı sınırı" changed. `before`/`after` are already in words ("200 g", "Kahve").
 */
export type StockLog = { id: string; at: string; by: string; byName: string; role: string; action: 'item_add' | 'item_edit' | 'item_remove' | 'min'; itemId: string; name: string; before?: string; after?: string };
export type StockData = { items: StockItem[]; recipes: Recipe[]; entries: StockEntry[]; logs?: StockLog[] };

/** [productId, selection key ('' = no option), quantity, grams] of one business day's settled sales. */
export type MixEntry = [productId: string, key: string, quantity: number, grams: number];
/** One sold order line with its order time (ms). */
export type SoldLine = { at: number; productId: string; key: string; quantity: number; grams: number };
/**
 * Where sales come from. `dayMix`: whole business days of settled (archived) sales, aggregated; `dayLines`: the same day's
 * settled sales line by line (only asked for days with a count or recipe change inside); `live`: orders still on the floor.
 */
export type SalesFeed = { dayMix(day: string): MixEntry[]; dayLines(day: string): SoldLine[]; live: SoldLine[] };

export const DAY = 86400000;
/** Business days (05:00–05:00 Turkish time, business-day.ts), the same days as the stored day summaries of history.ts. */
export const stockDay = (at: number) => businessDay(at);
export const stockDayStart = (day: string) => dayStart(day);
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

/** The options chosen on a line, as one stable key: "group:option|group:option" (sorted). */
export function selectionKey(selections: readonly Selection[] | undefined) {
  if (!selections?.length) return '';
  return selections.map(s => `${s.groupId}:${s.optionId}`).sort().join('|');
}
/** How much one sold line counts: kilograms of a weighed line, otherwise pieces. */
export const lineMultiplier = (quantity: number, grams: number) => grams > 0 ? grams / 1000 : quantity;

/** Item amounts for one piece (or kg) of a recipe with these options chosen. */
export function recipeUsage(recipe: Pick<Recipe, 'items' | 'options'>, key = ''): Map<string, number> {
  const chosen = new Set(key ? key.split('|') : []);
  const rules = (recipe.options ?? []).filter(r => chosen.has(`${r.groupId}:${r.optionId}`));
  let items = recipe.items;
  for (const r of rules) for (const rep of r.replace ?? []) items = items.map(i => i.itemId === rep.from ? { itemId: rep.to, amount: i.amount } : i);
  const scale = rules.reduce((n, r) => n * (r.scale && r.scale > 0 ? r.scale : 1), 1);
  const out = new Map<string, number>();
  for (const i of items) out.set(i.itemId, (out.get(i.itemId) ?? 0) + i.amount * scale);
  for (const r of rules) for (const a of r.add ?? []) out.set(a.itemId, (out.get(a.itemId) ?? 0) + a.amount);
  return out;
}

/** Recipe versions per product, oldest first. */
export function recipeIndex(recipes: readonly Recipe[]) {
  const by = new Map<string, Recipe[]>();
  for (const r of recipes) { const list = by.get(r.productId); if (list) list.push(r); else by.set(r.productId, [r]); }
  for (const list of by.values()) list.sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.id.localeCompare(b.id));
  return by;
}
/** The version in force at `at` (ms), or undefined before the first one. */
const validTimes = new WeakMap<Recipe, number>();
const validFrom = (r: Recipe) => { let t = validTimes.get(r); if (t === undefined) validTimes.set(r, t = Date.parse(r.validFrom)); return t; };
export function recipeAt(versions: readonly Recipe[] | undefined, at: number) {
  if (!versions) return undefined;
  let found: Recipe | undefined;
  for (const r of versions) { if (validFrom(r) <= at) found = r; else break; }
  return found;
}
/** The current recipe of every product that has one (versions without items left out). */
export function currentRecipes(recipes: readonly Recipe[], now: number) {
  const out = new Map<string, Recipe>();
  for (const [id, versions] of recipeIndex(recipes)) { const r = recipeAt(versions, now); if (r?.items.length) out.set(id, r); }
  return out;
}

const live = (e: StockEntry) => !e.deletedAt;
/** Where an item's stock starts: its last count, or 0 when it was added. */
export function baselineOf(item: StockItem, entries: readonly StockEntry[], until = Infinity) {
  let base = { at: Date.parse(item.createdAt), amount: 0, counted: false };
  for (const e of entries) if (e.kind === 'count' && e.itemId === item.id && live(e)) { const at = Date.parse(e.at); if (at <= until && at >= base.at) base = { at, amount: e.quantity ?? 0, counted: true }; }
  return base;
}

export type StockLevel = {
  itemId: string; stock: number; since: string; counted: boolean; baseAmount: number;
  purchased: number; wasted: number; returned: number; used: number;
  low: boolean; empty: boolean;
};

/**
 * Stock of every item at `now`. The work grows with the number of days since the oldest count (or creation) and the
 * products sold on them; it never opens a sale more than once.
 */
export function stockLevels(data: StockData, feed: SalesFeed, now: number): Map<string, StockLevel> {
  const items = data.items.filter(i => !i.removedAt);
  // Entries are read once, by item (a year holds a few thousand).
  const byItem = new Map<string, { e: StockEntry; at: number }[]>();
  const push = (id: string, v: { e: StockEntry; at: number }) => { const list = byItem.get(id); if (list) list.push(v); else byItem.set(id, [v]); };
  for (const e of data.entries) {
    if (!live(e)) continue;
    const at = Date.parse(e.at); if (!(at <= now)) continue;
    if (e.itemId) push(e.itemId, { e, at });
    if (e.kind === 'return') for (const [id] of e.items ?? []) if (id !== e.itemId) push(id, { e, at });
  }
  const base = new Map(items.map(i => {
    let b = { at: Date.parse(i.createdAt), amount: 0, counted: false };
    for (const { e, at } of byItem.get(i.id) ?? []) if (e.kind === 'count' && at >= b.at) b = { at, amount: e.quantity ?? 0, counted: true };
    return [i.id, b];
  }));
  const used = new Map<string, number>();
  const index = recipeIndex(data.recipes), memo = new Map<Recipe, Map<string, [string, number][]>>();
  const usageOf = (r: Recipe, key: string) => { let m = memo.get(r); if (!m) memo.set(r, m = new Map()); let u = m.get(key); if (!u) m.set(key, u = [...recipeUsage(r, key)].filter(([id]) => base.has(id))); return u; };
  /** Consumption of one sale (or one product's day) at `at`: only items whose stock started before that moment. */
  const consume = (at: number, productId: string, key: string, quantity: number, grams: number) => {
    const r = recipeAt(index.get(productId), at);
    if (!r?.items.length) return;
    const n = lineMultiplier(quantity, grams);
    if (!n) return;
    for (const [itemId, amount] of usageOf(r, key)) if (at > base.get(itemId)!.at) used.set(itemId, (used.get(itemId) ?? 0) + amount * n);
  };
  // Days that need a time inside them: a count or creation (where a stock starts) and every recipe change.
  const boundaries = new Set<string>();
  for (const b of base.values()) boundaries.add(stockDay(b.at));
  for (const r of data.recipes) boundaries.add(stockDay(Date.parse(r.validFrom)));
  const tracked = new Set(data.recipes.flatMap(r => [...r.items.map(i => i.itemId), ...(r.options ?? []).flatMap(o => [...(o.add ?? []).map(a => a.itemId), ...(o.replace ?? []).map(x => x.to)])]));
  const starts = [...base.entries()].filter(([id]) => tracked.has(id)).map(([, b]) => b.at);
  if (starts.length) {
    const last = stockDay(now);
    for (let day = stockDay(Math.min(...starts)); day <= last; day = nextDay(day)) {
      if (boundaries.has(day)) { for (const l of feed.dayLines(day)) if (l.at <= now) consume(l.at, l.productId, l.key, l.quantity, l.grams); continue; }
      // No count and no recipe change inside: one moment of the day stands for all of it.
      const at = stockDayStart(day) + DAY / 2;
      for (const [productId, key, quantity, grams] of feed.dayMix(day)) consume(at, productId, key, quantity, grams);
    }
    for (const l of feed.live) if (l.at <= now) consume(l.at, l.productId, l.key, l.quantity, l.grams);
  }
  const out = new Map<string, StockLevel>();
  for (const item of items) {
    const b = base.get(item.id)!;
    let purchased = 0, wasted = 0, returned = 0;
    for (const { e, at } of byItem.get(item.id) ?? []) {
      if (at <= b.at) continue;
      if (e.kind === 'purchase') purchased += e.quantity ?? 0;
      else if (e.kind === 'waste') wasted += e.quantity ?? 0;
      else if (e.kind === 'return') for (const [id, amount] of e.items ?? []) if (id === item.id) returned += amount;
    }
    const u = used.get(item.id) ?? 0, stock = b.amount + purchased + returned - wasted - u;
    out.set(item.id, { itemId: item.id, stock, since: new Date(b.at).toISOString(), counted: b.counted, baseAmount: b.amount, purchased, wasted, returned, used: u, low: item.min !== undefined && item.min > 0 && stock < item.min, empty: stock <= 0 });
  }
  return out;
}

/**
 * `variants` (13 Ekim tanıtım): the options that change the recipe ("Orta şekerli" adds sugar, "Büyük boy" scales it, "Yulaf
 * sütü" swaps the milk), each with how many pieces of that choice the stock is enough for. One option at a time; missing when
 * no option changes the recipe.
 */
export type ProductVariantStock = { key: string; group: string; option: string; makeable: number; limitingId?: string };
export type ProductStock = {
  productId: string; status: 'recipe' | 'ready' | 'none';
  /** Pieces (or kg for weighed products) the current stock is enough for, with the plain recipe (no option). */
  makeable?: number; limitingId?: string; stock?: number; low: boolean; empty: boolean;
  variants?: ProductVariantStock[];
};
/** "≈ 133 adet yapılabilir" (and which item limits it), "48 adet kaldı" for ready-bought products, or not tracked. */
export function productStock(products: readonly (Pick<Product, 'id' | 'unit'> & Partial<Pick<Product, 'groups'>>)[], data: StockData, levels: Map<string, StockLevel>, now: number): Map<string, ProductStock> {
  const current = currentRecipes(data.recipes, now), items = new Map(data.items.map(i => [i.id, i]));
  const out = new Map<string, ProductStock>();
  for (const p of products) {
    const r = current.get(p.id);
    if (!r) { out.set(p.id, { productId: p.id, status: 'none', low: false, empty: false }); continue; }
    if (r.ready) {
      const level = levels.get(r.items[0]?.itemId ?? '');
      const stock = Math.max(0, Math.floor((level?.stock ?? 0) + 1e-9));
      out.set(p.id, { productId: p.id, status: 'ready', stock, makeable: stock, limitingId: r.items[0]?.itemId, low: !!level?.low || stock <= 0, empty: stock <= 0 });
      continue;
    }
    /** How many pieces (kg) this usage allows, the item that limits it, and whether any of its items is low. */
    const enough = (usage: Map<string, number>) => {
      let makeable = Infinity, limitingId: string | undefined, low = false;
      for (const [itemId, amount] of usage) {
        if (!(amount > 0)) continue;
        const level = levels.get(itemId), have = items.get(itemId)?.removedAt ? 0 : Math.max(0, level?.stock ?? 0);
        const n = have / amount;
        if (n < makeable) { makeable = n; limitingId = itemId; }
        if (level?.low) low = true;
      }
      const value = !Number.isFinite(makeable) ? null : p.unit === 'kg' ? Math.floor(makeable * 10 + 1e-9) / 10 : Math.floor(makeable + 1e-9);
      return { value, limitingId, low };
    };
    const plain = enough(recipeUsage(r));
    if (plain.value === null) { out.set(p.id, { productId: p.id, status: 'none', low: false, empty: false }); continue; }
    const value = plain.value;
    // Each option with a rule of its own (an option the menu no longer has is left out).
    const variants: ProductVariantStock[] = [];
    for (const rule of r.options ?? []) {
      const group = p.groups?.find(g => g.id === rule.groupId), option = group?.options.find(o => o.id === rule.optionId);
      if (!group || !option) continue;
      const v = enough(recipeUsage(r, `${rule.groupId}:${rule.optionId}`));
      if (v.value !== null) variants.push({ key: `${rule.groupId}:${rule.optionId}`, group: group.name, option: option.name, makeable: v.value, ...(v.limitingId ? { limitingId: v.limitingId } : {}) });
    }
    out.set(p.id, { productId: p.id, status: 'recipe', makeable: value, limitingId: plain.limitingId, low: plain.low || value <= 0, empty: value <= 0, ...(variants.length ? { variants } : {}) });
  }
  return out;
}

/** Price points of an item (purchases and hand-set prices), oldest first. */
export function pricePoints(itemId: string, entries: readonly StockEntry[]) {
  return entries.filter(e => live(e) && e.itemId === itemId && (e.kind === 'purchase' || e.kind === 'price') && typeof e.unitCost === 'number' && Number.isFinite(e.unitCost) && e.unitCost >= 0)
    .map(e => ({ at: Date.parse(e.at), unitCost: e.unitCost! })).sort((a, b) => a.at - b.at);
}
/** Unit cost at `at`: the last price before it, or (for sales before the first purchase) the first price; null when none. */
export function unitCostAt(points: readonly { at: number; unitCost: number }[], at: number) {
  if (!points.length) return null;
  // The last point at or before `at` (binary search: a year of purchases is a few hundred points).
  let lo = 0, hi = points.length - 1;
  if (points[0].at > at) return points[0].unitCost;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (points[mid].at <= at) lo = mid; else hi = mid - 1; }
  return points[lo].unitCost;
}
/** Cost of one piece (or kg) of a recipe with these options at the prices of `at`; `missing` lists items without a price. */
export function recipeCost(recipe: Pick<Recipe, 'items' | 'options'>, key: string, prices: (itemId: string) => number | null) {
  let cost = 0; const missing: string[] = [];
  for (const [itemId, amount] of recipeUsage(recipe, key)) {
    if (!(amount > 0)) continue;
    const unit = prices(itemId);
    if (unit === null) missing.push(itemId); else cost += unit * amount;
  }
  return { cost, missing };
}
/**
 * Reçete penceresi → "Seçeneklere göre maliyet" (8 Ekim): each option on its own, as Kârlılık costs that variant (the same
 * recipeUsage/recipeCost, today's prices): what one piece takes from stock, its cost, its price (product + the option's
 * extra) and the margin. The plain product ("Seçeneksiz") is a row only when no group must be chosen. `cost` null: an item
 * has no price yet (`missing`).
 */
export type OptionCostRow = { key: string; name: string; extra: number; usage: [string, number][]; cost: number | null; missing: string[]; price: number; margin: number | null };
export function optionCosts(product: Pick<Product, 'price' | 'groups'>, recipe: Pick<Recipe, 'items' | 'options'>, prices: (itemId: string) => number | null): OptionCostRow[] {
  const row = (key: string, name: string, extra: number): OptionCostRow => {
    const usage = [...recipeUsage(recipe, key)].filter(([, n]) => n > 0), { cost, missing } = recipeCost(recipe, key, prices);
    const price = product.price + extra, rounded = missing.length ? null : Math.round(cost);
    return { key, name, extra, usage, cost: rounded, missing, price, margin: rounded === null || price <= 0 ? null : (price - rounded) / price };
  };
  const rows: OptionCostRow[] = [];
  if (product.groups.every(g => !g.required)) rows.push(row('', 'Seçeneksiz', 0));
  for (const g of product.groups) for (const o of g.options) rows.push(row(`${g.id}:${o.id}`, o.name, o.extra));
  return rows;
}

// ---- Units and words ----
export const UNIT_NAMES: Record<StockUnit, string> = { g: 'Gram / kilogram', ml: 'Mililitre / litre', piece: 'Adet' };
/** The bigger unit a person thinks in: kg, L or adet, and how many base units it holds. */
export const bigUnit = (unit: StockUnit) => unit === 'g' ? { label: 'kg', factor: 1000 } : unit === 'ml' ? { label: 'L', factor: 1000 } : { label: 'adet', factor: 1 };
export const smallUnit = (unit: StockUnit) => unit === 'g' ? 'g' : unit === 'ml' ? 'ml' : 'adet';
// One formatter per digit count: toLocaleString builds a new one on every call (~45 µs; five years of stock history is
// 30 000 amounts, K-T 9 Ekim). The same words as `n.toLocaleString('tr-TR', { maximumFractionDigits: digits })`.
const formatters = new Map<number, Intl.NumberFormat>();
const number = (n: number, digits: number) => { let f = formatters.get(digits); if (!f) formatters.set(digits, f = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits })); return f.format(n); };
/** "2,4 kg", "850 g", "1,2 L", "48 adet". */
export function formatAmount(amount: number, unit: StockUnit) {
  const sign = amount < 0 ? '−' : '', a = Math.abs(amount);
  if (unit === 'piece') return `${sign}${number(a, a < 10 ? 1 : 0)} adet`;
  const big = unit === 'g' ? 'kg' : 'L', small = unit === 'g' ? 'g' : 'ml';
  if (a >= 1000) return `${sign}${number(a / 1000, a >= 100_000 ? 0 : a >= 10_000 ? 1 : 2)} ${big}`;
  return `${sign}${number(a, a < 10 ? 1 : 0)} ${small}`;
}
/** A person's typed amount ("1,5") in `unit` ("kg", "g", "L", "ml", "adet") to base units; NaN when not a number. */
export function parseAmount(text: string, unit: string) {
  const normal = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(normal)) return NaN;
  const value = Number(normal);
  return unit === 'kg' || unit === 'L' ? Math.round(value * 1000 * 1000) / 1000 : value;
}
/** Unit cost in kuruş per base unit as a person reads it: per kg, per L or per piece (kuruş). */
export const perBigUnit = (unitCost: number, unit: StockUnit) => unitCost * bigUnit(unit).factor;
/** The input units offered for an item: big first (purchases, counts) or small first (recipes). */
export const inputUnits = (unit: StockUnit, smallFirst = false) => unit === 'piece' ? ['adet'] : smallFirst ? [smallUnit(unit), bigUnit(unit).label] : [bigUnit(unit).label, smallUnit(unit)];

/** Reasons offered for waste (fire); free text is allowed too. */
export const WASTE_REASONS = ['Bozuldu', 'Döküldü / kırıldı', 'Son kullanma tarihi geçti', 'Deneme / ikram'];
/** Products under this gross margin are marked in Kârlılık. */
export const LOW_MARGIN = 0.4;
