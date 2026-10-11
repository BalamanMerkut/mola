import { artForCategory } from './sector.js';
import { menuLabelKey } from './menu-translation.js';
import type { ProductArtKind } from './types.js';

/*
 * "Düşük kâr" uyarısı (Satış ve Raporlar → Kârlılık, Stok → Reçeteler). Each product belongs to a group with its own
 * threshold, from the food-service cost norms widely used in the trade (margin = 1 − cost ÷ price):
 *   İçecekler 70 % (cost at most 30 %), Yemekler 65 % (35 %), Tatlı ve fırın 65 % (35 %), Hazır ürünler 30 % (70 %).
 * The group comes from the product's category (the same words that pick a new product's picture, sector.ts), "Hazır ürün"
 * (a ready-bought product tracked by the piece in Stok) wins over the category, and the owner may move a category to
 * another group. The whole warning can be switched off (Ayarlar → Giderler). Browser-safe: no server imports.
 */
export type MarginGroup = 'drinks' | 'food' | 'dessert' | 'ready';
export const MARGIN_GROUPS: readonly MarginGroup[] = ['drinks', 'food', 'dessert', 'ready'];
export const marginGroupNames: Record<MarginGroup, string> = { drinks: 'İçecekler', food: 'Yemekler', dessert: 'Tatlı ve fırın', ready: 'Hazır ürünler' };
export const DEFAULT_MARGINS: Readonly<Record<MarginGroup, number>> = { drinks: 0.7, food: 0.65, dessert: 0.65, ready: 0.3 };
/** Stored on the business (State.marginAlerts); every field optional: missing = on, default thresholds, automatic groups. */
export type MarginSettings = { enabled?: boolean; groups?: Partial<Record<MarginGroup, number>>; categories?: Record<string, MarginGroup> };
export type MarginRules = { enabled: boolean; groups: Record<MarginGroup, number>; categories: Record<string, MarginGroup> };

export function marginRules(s?: MarginSettings): MarginRules {
  const groups = { ...DEFAULT_MARGINS };
  for (const g of MARGIN_GROUPS) { const v = s?.groups?.[g]; if (typeof v === 'number' && v > 0 && v < 1) groups[g] = v; }
  return { enabled: s?.enabled !== false, groups, categories: { ...(s?.categories ?? {}) } };
}
const ART_GROUP: Record<ProductArtKind, MarginGroup> = { coffee: 'drinks', tea: 'drinks', cold: 'drinks', cake: 'dessert', sweet: 'dessert', food: 'food', soup: 'food', burger: 'food' };
/** The group a category falls in by its name alone ("Sıcak İçecekler" → İçecekler, "Tatlılar" → Tatlı ve fırın). */
export const autoGroup = (category: string): MarginGroup => /firin|pastane|ekmek|simit/.test(menuLabelKey(category || '')) ? 'dessert' : ART_GROUP[artForCategory(category || 'Diğer')];
/** The category's group: the owner's choice, else by its name. */
export const categoryGroup = (category: string, rules: Pick<MarginRules, 'categories'>): MarginGroup => rules.categories[category] ?? autoGroup(category);
/** A product's group: "Hazır ürün" in Stok first, then its category's. */
export const productGroup = (p: { category?: string }, ready: boolean, rules: Pick<MarginRules, 'categories'>): MarginGroup => ready ? 'ready' : categoryGroup(p.category || 'Diğer', rules);
/** The margin under which a product reads "Düşük kâr"; null when the warning is off. */
export const thresholdOf = (group: MarginGroup, rules: MarginRules) => rules.enabled ? rules.groups[group] : null;
