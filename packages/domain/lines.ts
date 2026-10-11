import { discountedPrice, type DiscountOffer } from './campaigns.js';
import { menuLabelKey } from './menu-translation.js';
import type { CartLine, OptionGroup, OrderLine, Product, Selection } from './types.js';

// Order line details shared by the server (engine.ts), the screens and the tickets: item notes and sale by weight.
// Kept free of DomainError so browsers can import it; the engine turns the problems into errors.

export const NOTE_MAX = 140;
/** Weighed lines: grams in 50 g steps, 50 g – 20 kg. */
export const GRAM_MIN = 50, GRAM_STEP = 50, GRAM_MAX = 20_000;
export const GRAM_PRESETS = [250, 500, 1000];

export const soldByWeight = (p?: Pick<Product, 'unit'> | null) => p?.unit === 'kg';
/** NFC, control characters as spaces, invisible format characters (bidi overrides, zero-width) removed, spaces collapsed. */
export function cleanNote(value: string) {
  return value.normalize('NFC').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
}
/** Code points, so an emoji counts once, as people count it. */
export const noteLength = (note: string) => [...note].length;
/** The stored note, or undefined for none; null when the note is invalid. */
export function readNote(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const note = cleanNote(value);
  return !note ? undefined : noteLength(note) > NOTE_MAX ? null : note;
}
export const validGrams = (grams: unknown): grams is number => typeof grams === 'number' && Number.isSafeInteger(grams) && grams >= GRAM_MIN && grams <= GRAM_MAX && grams % GRAM_STEP === 0;
/** "500 g", "1 kg", "1,5 kg". */
export function formatWeight(grams: number, en = false) {
  return grams < 1000 ? `${grams} g` : `${new Intl.NumberFormat(en ? 'en-US' : 'tr-TR', { maximumFractionDigits: 2 }).format(grams / 1000)} kg`;
}
/** What staff read before the product name: "500 g" for weighed lines, the piece count otherwise. */
export const amountLabel = (line: Pick<CartLine, 'quantity' | 'grams'>, en = false) => line.grams ? formatWeight(line.grams, en) : String(line.quantity);
/** "1 x Kola", "500 g Baklava (Fıstıklı)": one side of a waiter's line change, for the DEĞİŞİKLİK slip and the kitchen card. */
export const changeSideText = (c: import('./types.js').ChangeSide) => `${c.grams ? `${formatWeight(c.grams)} ${c.name}` : `${c.quantity} x ${c.name}`}${c.optionNames.length ? ` (${c.optionNames.join(', ')})` : ''}`;

/**
 * The option a required group starts with: the one without a price difference ("Standart"), so a cheaper size is never
 * charged by accident. Several free options: "Standart"/"Normal" first, else the first free one. No free option: none,
 * and the guest or staff must choose before adding. Optional groups never start with a choice.
 */
export function defaultOption(g: Pick<OptionGroup, 'required' | 'options'>) {
  if (!g.required) return undefined;
  const free = g.options.filter(o => o.extra === 0);
  return (free.find(o => /^(standart|normal|regular)/.test(menuLabelKey(o.name))) ?? free[0])?.id;
}
/** Optional group: the "no choice" entry ("Seçim yok") is shown only when no option is already free ("Normal süt ₺0" says it). */
export const showsNoChoice = (g: Pick<OptionGroup, 'required' | 'options'>) => !g.required && !g.options.some(o => o.extra === 0);
/** Required groups still without a choice, by name: the add button waits for these. */
export const missingChoices = (p: Pick<Product, 'groups'>, chosen: Record<string, string>) => p.groups.filter(g => g.required && !g.options.some(o => o.id === chosen[g.id]));

// Staff cancellation of a whole order or of some items (packages/domain/engine.ts cancelByStaff). A reason is always
// required; the presets are what cafés say most, free text covers the rest.
export const CANCEL_REASONS = ['Yanlış sipariş', 'Müşteri vazgeçti', 'Ürün bitti'];
export const CANCEL_REASON_MAX = 120;
/** The cleaned reason, or undefined when it is missing, too short or too long. */
export function readCancelReason(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const reason = cleanNote(value);
  return reason.length >= 3 && noteLength(reason) <= CANCEL_REASON_MAX ? reason : undefined;
}

export function optionExtra(p: Product, selections: Selection[]) {
  return selections.reduce((n, sel) => n + (p.groups.find(g => g.id === sel.groupId)?.options.find(o => o.id === sel.optionId)?.extra ?? 0), 0);
}
/** Quantity conditions ("4 al 3 öde") count pieces; a weighed line never meets or uses them. */
export const weightOffers = (offers?: DiscountOffer[]) => offers?.filter(c => (c.minQuantity ?? 1) <= 1);
/** Weighed line before campaigns: the per-kg price for the weight, plus option extras once per line (a gift box costs the same for 250 g or 2 kg). */
export const weightBase = (perKg: number, grams: number, extra: number) => Math.round(perKg * grams / 1000) + extra;
/** A basket line's total as menus show it. The server's quote() is the authority and computes the same number. */
export function cartLineTotal(p: Product, line: CartLine, productCount: number) {
  const extra = optionExtra(p, line.selections);
  if (soldByWeight(p)) return discountedPrice({ discounts: weightOffers(p.discounts) }, weightBase(p.price, line.grams ?? 0, extra), 1).price;
  return discountedPrice(p, p.price + extra, productCount).price * line.quantity;
}
/** The price a menu card shows: per piece with campaigns, or per kg with percentage campaigns (TL discounts apply once per weighed line, not per kg). */
export function menuPrice(p: Product) {
  return discountedPrice({ discounts: soldByWeight(p) ? weightOffers(p.discounts)?.filter(c => c.kind !== 'fixed') : p.discounts }, p.price).price;
}
/** A saved weighed line with a new weight, priced by what was quoted (not today's menu), like repriceSavedLine for pieces. */
export function repriceWeightLine(line: OrderLine, grams: number): OrderLine {
  if (!line.weightPricing || line.grams === grams) return { ...line };
  const { perKg, extra, offers } = line.weightPricing, original = weightBase(perKg, grams, extra), discount = discountedPrice({ discounts: offers }, original, 1);
  return { ...line, grams, quantity: 1, unitPrice: discount.price, total: discount.price, originalUnitPrice: discount.campaigns.length ? original : undefined, campaigns: discount.campaigns.length ? discount.campaigns : undefined };
}
// Note placeholder examples that fit the product: "Soğansız olsun" under a tea reads wrong. The owner's category words
// ("Soğuk Kahveler", "Çaylar") are more specific than the illustration, so they come first; the illustration decides otherwise.
type NoteKind = 'weight' | 'turkish' | 'espresso' | 'coffee' | 'tea' | 'cold' | 'icecream' | 'sweet' | 'soup' | 'food' | 'other';
const noteExamples: Record<NoteKind, [string, string]> = {
  weight: ['Örn. hediye paketi olsun', 'e.g. Gift-wrapped, please'],
  turkish: ['Örn. orta şekerli, bol köpüklü', 'e.g. Medium sweet, extra foam'],
  espresso: ['Örn. yanında su, ekstra sıcak', 'e.g. Water on the side, extra hot'],
  coffee: ['Örn. az sütlü, ekstra sıcak', 'e.g. A little milk, extra hot'],
  tea: ['Örn. açık demli, limonlu', 'e.g. Light brew, with lemon'],
  cold: ['Örn. buzsuz, az şekerli', 'e.g. No ice, less sugar'],
  icecream: ['Örn. külahta, ekstra sos', 'e.g. In a cone, extra sauce'],
  sweet: ['Örn. ayrı tabakta, dondurmasız', 'e.g. On a separate plate, no ice cream'],
  soup: ['Örn. limonlu, acısız', 'e.g. With lemon, not spicy'],
  food: ['Örn. soğansız, az pişmiş', 'e.g. No onions, rare'],
  other: ['Örn. özel isteğiniz', 'e.g. Any special request'],
};
// Folded words (menuLabelKey): cold before coffee and tea, so "Soğuk Kahveler" and "Buzlu Çay" read as cold drinks.
const noteCategoryKinds: [RegExp, NoteKind][] = [
  [/soguk|buzlu|(^|\s)iced?(\s|$)|frozen|frappe|limonata|milkshake|smoothie|mesrubat|meyve suyu|(^|\s)soda|ayran|gazli/, 'cold'],
  [/kahve|espresso/, 'coffee'], [/(^|\s)cay|bitki/, 'tea'],
  [/dondurma|gelato/, 'icecream'],
  [/tatli|pasta|baklava|serbetli|kurabiye|lokum|(^|\s)kek|cheesecake|puding|sutlac|kunefe/, 'sweet'],
  [/corba/, 'soup'],
  [/burger|yemek|izgara|kebap|kofte|salata|pizza|makarna|tost|sandvic|durum|kahvalti|meze|tavuk|balik|pide|lahmacun|ara sicak|baslangic/, 'food'],
];
// The product's own name and subtype are the most specific of all: a Türk kahvesi or an espresso is never "az sütlü".
// Cold words still win ("Iced Americano"), the other drinks fall through to the category rules.
const noteNameKinds: [RegExp, NoteKind][] = [
  [noteCategoryKinds[0][0], 'cold'],
  [/turk kahve|dibek|menengic|osmanli kahve|kum kahve/, 'turkish'],
  [/espresso|ristretto|americano|lungo|doppio|cortado|macchiato/, 'espresso'],
];
const noteArtKinds: Partial<Record<Product['art'], NoteKind>> = { coffee: 'coffee', tea: 'tea', cold: 'cold', cake: 'sweet', sweet: 'sweet', food: 'food', soup: 'soup', burger: 'food' };
/** Example text for a line's note field, chosen by what the product is: sold by weight, then its name and subtype, then category words, then its illustration. */
export function notePlaceholder(p: Pick<Product, 'art' | 'category' | 'unit'> & { subtype?: string; name?: string }, en = false) {
  const own = menuLabelKey(`${p.name ?? ''} ${p.subtype ?? ''}`), key = menuLabelKey(`${p.category} ${p.subtype ?? ''}`);
  const kind = soldByWeight(p) ? 'weight' : noteNameKinds.find(([rule]) => rule.test(own))?.[1] ?? noteCategoryKinds.find(([rule]) => rule.test(key))?.[1] ?? noteArtKinds[p.art] ?? 'other';
  return noteExamples[kind][en ? 1 : 0];
}
/**
 * Search text as people type it on a phone: Turkish letters folded both ways (İ/I/ı → i, ç → c, ş → s, ğ → g, ö → o,
 * ü → u), lower case, so "cay", "ÇAY" and "Çay" all find "Demleme Çay" and "ihlamur" finds "Ihlamur".
 */
export const searchKey = (text: string) => menuLabelKey(text.replace(/[İI]/g, 'i')).replace(/̇/g, '');
/** Menu search for guests and staff: product number ("22" or "#22"), name and description, Turkish and English. */
export function matchesSearch(p: Pick<Product, 'code' | 'name' | 'nameEn' | 'description' | 'descriptionEn'>, query: string) {
  const q = searchKey(query).replace(/^#/, '').trim();
  if (!q) return true;
  return searchKey([p.code, p.name, p.nameEn, p.description, p.descriptionEn].filter(Boolean).join(' \n ')).includes(q);
}
/** A basket line as the guest's phone keeps it: `seen` is the one-piece price shown when it was added ("₺30 → ₺35"). */
export type BasketLine = CartLine & { seen?: number };
/** One piece (a weighed line: the line) at today's menu price, campaigns for a single piece included. */
export function unitPriceOf(p: Product, line: CartLine) {
  return cartLineTotal(p, soldByWeight(p) ? line : { ...line, quantity: 1 }, 1);
}
/** Whether a saved basket line can still be ordered as it is: the product is on the menu and its options still exist. Sold-out lines stay (marked). */
export function basketLineFits(p: Product | undefined, line: CartLine) {
  if (!p || p.published === false) return false;
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) return false;
  if (!Array.isArray(line.selections) || new Set(line.selections.map(s => s.groupId)).size !== line.selections.length) return false;
  if (!line.selections.every(s => p.groups.some(g => g.id === s.groupId && g.options.some(o => o.id === s.optionId)))) return false;
  if (p.groups.some(g => g.required && !line.selections.some(s => s.groupId === g.id))) return false;
  return soldByWeight(p) ? validGrams(line.grams) && line.quantity === 1 : line.grams === undefined;
}
const text = (v: unknown) => typeof v === 'string' && v.length <= 200;
/**
 * The guest's basket read back after a reload (sessionStorage, per table session). Anything malformed is ignored; lines
 * whose product or options are gone are dropped (`dropped` says how many) so the guest is told.
 */
export function restoreBasket(saved: unknown, products: Product[]): { lines: BasketLine[]; packed: boolean; dropped: number } {
  const value = saved as { v?: unknown; lines?: unknown; packed?: unknown } | null;
  if (!value || typeof value !== 'object' || value.v !== 1 || !Array.isArray(value.lines)) return { lines: [], packed: false, dropped: 0 };
  const lines: BasketLine[] = []; let dropped = 0;
  for (const raw of value.lines.slice(0, 30)) {
    const l = raw as Record<string, unknown> | null;
    if (!l || typeof l !== 'object' || !text(l.productId) || typeof l.quantity !== 'number' || !Array.isArray(l.selections) || !l.selections.every(s => s && typeof s === 'object' && text((s as Selection).groupId) && text((s as Selection).optionId))) { dropped++; continue; }
    const note = typeof l.note === 'string' ? readNote(l.note) : undefined;
    const line: BasketLine = { productId: l.productId as string, quantity: l.quantity, selections: (l.selections as Selection[]).map(s => ({ groupId: s.groupId, optionId: s.optionId })), ...(note ? { note } : {}), ...(typeof l.grams === 'number' ? { grams: l.grams } : {}), ...(typeof l.seen === 'number' && Number.isSafeInteger(l.seen) ? { seen: l.seen } : {}) };
    if (basketLineFits(products.find(p => p.id === line.productId), line)) lines.push(line); else dropped++;
  }
  return { lines, packed: value.packed === true, dropped };
}
/** Same line with this note, or without one. */
export function withNote<T extends { note?: string }>(line: T, note: string | undefined): T {
  const { note: _, ...rest } = line;
  return (note ? { ...rest, note } : rest) as T;
}
