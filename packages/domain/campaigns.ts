import type { CartLine, OrderLine, Product, State } from './types.js';
export type CampaignDiscount = { kind?: 'percent'; percent: number; amount?: never } | { kind: 'fixed'; amount: number; percent?: never };
/** Weekly repeat inside [startsAt, endsAt): ISO weekdays 1 (Pazartesi) … 7 (Pazar) and an optional daily "HH:MM" window, start inclusive, end exclusive. */
export type CampaignSchedule = { days: number[]; from?: string; to?: string };
/**
 * What a campaign applies to. Without `categories` (every campaign made before category campaigns): the chosen
 * `productIds`. With `categories` ("Bütün bir bölüm"): `productIds` is empty and the campaign covers every product that is
 * in one of these menu categories at pricing time (products added later join, a product moved out leaves), minus
 * `excludedProductIds`. Categories are kept by name (the menu has no category ids); a category rename carries them.
 */
export type CampaignScope = { productIds: string[]; categories?: string[]; excludedProductIds?: string[] };
export type Campaign = { schedule?: CampaignSchedule; maxQuantity?: number | null; minQuantity?: number; reportId?: string; id: string; name: string; startsAt: string; endsAt: string | null; enabled: boolean; combine: boolean } & CampaignScope & CampaignDiscount;
type Timing = Pick<Campaign, 'startsAt' | 'endsAt' | 'schedule'>;
export type CampaignView = Campaign & { usedQuantity: number; remainingQuantity: number | null };
/** `categories`: set on a category campaign's offer, so menus can say "Tatlılarda %10 indirim". */
export type DiscountOffer = Pick<Campaign, 'id' | 'name' | 'combine' | 'reportId' | 'minQuantity' | 'categories'> & { remainingQuantity?: number } & CampaignDiscount;
const tl = (amount = 0) => `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(amount / 100)} TL`;
export function campaignDiscountLabel(discount: { kind?: string; amount?: number; percent?: number; minQuantity?: number }) {
  const label = discount.kind === 'fixed' ? `${tl(discount.amount)} indirim` : `%${discount.percent}`;
  return (discount.minQuantity ?? 1) > 1 ? `${label} · ${discount.minQuantity} adet ve üzeri` : label;
}
/**
 * The single rule for "does this campaign price this product" (saleProducts, the owner's screens, reports). A category
 * campaign with a quantity condition skips products sold by weight: quantity conditions count pieces.
 */
export function campaignCovers(c: CampaignScope & Pick<Campaign, 'minQuantity'>, p: Pick<Product, 'id' | 'category' | 'unit'>) {
  if (!c.categories) return c.productIds.includes(p.id);
  return c.categories.includes(p.category) && !c.excludedProductIds?.includes(p.id) && !((c.minQuantity ?? 1) > 1 && p.unit === 'kg');
}
export const campaignProducts = <P extends Pick<Product, 'id' | 'category' | 'unit'>>(c: CampaignScope & Pick<Campaign, 'minQuantity'>, products: readonly P[]) => products.filter(p => campaignCovers(c, p));
const VOWELS = 'aıoueiöü', BACK = 'aıou', VOICELESS = 'fstkçşhp';
/** Turkish "in": "Tatlılar" → "Tatlılarda", "Tost" → "Tostta", "Kekler" → "Keklerde"; a name that ends oddly ("Menü 2") → "Menü 2 bölümünde". */
export function inCategory(name: string) {
  const text = name.trim(), lower = text.toLocaleLowerCase('tr'), last = lower.at(-1) ?? '', vowel = [...lower].reverse().find(ch => VOWELS.includes(ch));
  if (!vowel || !/[a-zçğıöşü]/.test(last)) return `${text} bölümünde`;
  const suffix = (VOICELESS.includes(last) ? 't' : 'd') + (BACK.includes(vowel) ? 'a' : 'e');
  return text + (text !== lower && text === text.toLocaleUpperCase('tr') ? suffix.toLocaleUpperCase('tr') : suffix);
}
/** "Tatlılarda", "Kahveler ve Tatlılarda", "Çaylar, Kahveler ve Tatlılarda"; more than three: "4 bölümde". */
export function categoriesPlace(names: readonly string[]) {
  if (names.length > 3) return `${names.length} bölümde`;
  return names.length <= 1 ? inCategory(names[0] ?? '') : `${names.slice(0, -1).join(', ')} ve ${inCategory(names.at(-1)!)}`;
}
/**
 * How menus name a category campaign: "Tatlılarda %10 indirim", "Tatlılarda 20 TL indirim · 2 adet ve üzeri".
 * `en`: the English menu ("10% off Desserts"), with the category names it shows.
 */
export function categoryOfferText(o: Pick<DiscountOffer, 'categories' | 'minQuantity'> & { kind?: string; percent?: number; amount?: number }, en?: (category: string) => string) {
  const names = o.categories ?? [], many = (o.minQuantity ?? 1) > 1;
  if (en) {
    const list = names.length > 3 ? `${names.length} menu sections` : names.map(en).join(', ').replace(/, ([^,]*)$/, ' & $1');
    return `${o.kind === 'fixed' ? `${tl(o.amount)} off` : `${o.percent}% off`} ${list}${many ? ` · ${o.minQuantity}+ of an item` : ''}`;
  }
  return `${categoriesPlace(names)} ${o.kind === 'fixed' ? tl(o.amount) : `%${o.percent}`} indirim${many ? ` · ${o.minQuantity} adet ve üzeri` : ''}`;
}
/** Quantity conditions count pieces, so they cannot include products sold by weight. Shared by the editor and the server. */
export const weightRuleMessage = (names: string[]) => `Adet koşulu kiloyla satılan ürünlerde kullanılamaz: ${names.join(', ')}. Bu ürünleri çıkarın veya adet koşulunu kapatın.`;
export const productQuantity =(lines: CartLine[], productId: string) => lines.filter(l => l.productId === productId).reduce((sum, l) => sum + l.quantity, 0);
type CampaignState = Pick<State, 'campaigns'> & Partial<Pick<State, 'orders' | 'archives' | 'archivedCampaignUsage'>>;
export function campaignQuantities(lines: OrderLine[]) {
  const result = new Map<string, number>();
  for (const line of lines) for (const id of new Set(line.campaigns?.map(c => c.id))) result.set(id, (result.get(id) ?? 0) + line.quantity);
  return result;
}
export function campaignUsage(s: CampaignState, exceptOrderId?: string) {
  const orders = new Map((s.archives ?? []).flatMap(a => a.orders).map(o => [o.id, o]));
  for (const order of s.orders ?? []) orders.set(order.id, order);
  // Units of orders already moved to long-term history are carried as one counter per campaign.
  const used = new Map<string, number>(Object.entries(s.archivedCampaignUsage ?? {}));
  for (const order of orders.values()) if (order.status !== 'cancelled' && order.id !== exceptOrderId) {
    for (const [id, quantity] of campaignQuantities(order.lines)) used.set(id, (used.get(id) ?? 0) + quantity);
  }
  return used;
}
export function campaignViews(s: CampaignState, exceptOrderId?: string): CampaignView[] {
  const used = campaignUsage(s, exceptOrderId);
  return (s.campaigns ?? []).map(c => ({ ...c, usedQuantity: used.get(c.id) ?? 0, remainingQuantity: c.maxQuantity == null ? null : Math.max(0, c.maxQuantity - (used.get(c.id) ?? 0)) }));
}
export function saleProducts(s: Pick<State, 'products'> & CampaignState, now: Date, exceptOrderId?: string): Product[] {
  const views = s.campaigns?.some(c => c.maxQuantity != null) ? campaignViews(s, exceptOrderId) : (s.campaigns ?? []).map(c => ({ ...c, remainingQuantity: null }));
  // The single place that decides whether a campaign prices anything: menus, orders, edits and limits all come from here.
  const active = views.filter(c => c.enabled && (c.remainingQuantity === null || c.remainingQuantity >= (c.minQuantity ?? 1)) && campaignActiveAt(c, +now));
  // Category campaigns are resolved here, at pricing time, from each product's current category (campaignCovers).
  return s.products.map(p => ({ ...p, discounts: active.filter(c => campaignCovers(c, p)).map(c => ({ id: c.id, name: c.name, combine: c.combine, reportId: c.reportId, minQuantity: c.minQuantity, ...(c.categories ? { categories: c.categories } : {}), ...(c.remainingQuantity === null ? {} : { remainingQuantity: c.remainingQuantity }), ...(c.kind === 'fixed' ? { kind: 'fixed' as const, amount: c.amount } : { kind: 'percent' as const, percent: c.percent }) })) }));
}
export function discountedPrice(product: Pick<Product, 'discounts'>, original: number, quantity = 1) {
  const apply = (price: number, discount: CampaignDiscount) => Math.max(1, discount.kind === 'fixed' ? price - discount.amount : Math.round(price * (100 - discount.percent) / 100));
  let price = original; let campaigns: { id: string; name: string; reportId?: string }[] = [];
  const offers = [...(product.discounts ?? [])].filter(c => quantity >= (c.minQuantity ?? 1)).sort((a, b) => a.id.localeCompare(b.id));
  // Percentages precede fixed amounts; ID order keeps integer rounding deterministic.
  const together = offers.filter(c => c.combine).sort((a, b) => Number(a.kind === 'fixed') - Number(b.kind === 'fixed') || a.id.localeCompare(b.id));
  const combined = together.reduce((p, c) => apply(p, c), original);
  if (combined < price) { price = combined; campaigns = together.map(({ id, name, reportId }) => ({ id, name, reportId })); }
  for (const c of offers.filter(c => !c.combine)) { const candidate = apply(original, c); if (candidate < price) { price = candidate; campaigns = [{ id: c.id, name: c.name, reportId: c.reportId }]; } }
  return { price, campaigns };
}

// ---- Weekly schedules. Istanbul has stayed on UTC+3 all year since 2016; the whole app uses that fixed offset. ----
const MINUTE = 60000, DAY = 86400000, WEEK = 7 * DAY, TR = 3 * 3600000;
export const CAMPAIGN_MAX_WEEKS = 52;
/** The campaign report compares a weekly campaign with the same weekdays and hours of this many weeks before its start. */
export const BEFORE_WEEKS = 4;
export const WEEKDAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
export const WEEKDAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const localDay = (at: number) => Math.floor((at + TR) / DAY);
/** ISO weekday of a Turkish calendar day number; day 0 (1 Jan 1970) was a Thursday. */
const weekdayOf = (day: number) => (day + 3) % 7 + 1;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const clock = (at: number) => new Date(at + TR).toISOString().slice(11, 16);
const shortDate = (at: number) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'Europe/Istanbul' }).format(at);
/** Inside [startsAt, endsAt) and, for a weekly campaign, on a chosen weekday and inside its daily window. Ignores enabled and quotas. */
export function campaignActiveAt(c: Timing, at: number) {
  if (Date.parse(c.startsAt) > at || (c.endsAt && at >= Date.parse(c.endsAt))) return false;
  const s = c.schedule; if (!s) return true;
  const day = localDay(at); if (!s.days.includes(weekdayOf(day))) return false;
  if (!s.from || !s.to) return true;
  const minute = Math.floor((at + TR - day * DAY) / MINUTE);
  return minute >= minutesOf(s.from) && minute < minutesOf(s.to);
}
/** Active stretches inside [from, to); touching ones (whole days in a row) are merged. Without a schedule it is the range itself. */
export function scheduleSlots(s: CampaignSchedule | undefined, from: number, to: number): [number, number][] {
  if (!s) return from < to ? [[from, to]] : [];
  const out: [number, number][] = [], open = s.from && s.to ? minutesOf(s.from) * MINUTE : 0, close = s.from && s.to ? minutesOf(s.to) * MINUTE : DAY;
  for (let day = localDay(from); day * DAY - TR < to; day++) {
    if (!s.days.includes(weekdayOf(day))) continue;
    const base = day * DAY - TR, start = Math.max(from, base + open), end = Math.min(to, base + close);
    if (start >= end) continue;
    const last = out.at(-1); if (last && last[1] === start) last[1] = end; else out.push([start, end]);
  }
  return out;
}
/** Length of one active day: the daily window, or 24 hours. Reports count active days with it. */
export const scheduleDayLength = (s: CampaignSchedule | undefined) => s?.from && s.to ? (minutesOf(s.to) - minutesOf(s.from)) * MINUTE : DAY;
/** First moment at or after `at` when the campaign runs; null when it never runs again. */
export function nextCampaignStart(c: Timing, at: number) {
  const from = Math.max(at, Date.parse(c.startsAt)), end = c.endsAt ? Date.parse(c.endsAt) : Infinity;
  if (from >= end) return null;
  if (!c.schedule) return from;
  return scheduleSlots(c.schedule, from, Math.min(end, from + 8 * DAY))[0]?.[0] ?? null;
}
/** "Next N weeks": the end is exactly N weeks after the start, so every chosen weekday occurs N times. */
export const repeatEnd = (startsAt: string, weeks: number) => new Date(Date.parse(startsAt) + weeks * WEEK).toISOString();
/** Plain message for the first problem, or null. Shared by the editor and the server. */
export function campaignTimingError(c: Timing) {
  const start = Date.parse(c.startsAt), end = c.endsAt ? Date.parse(c.endsAt) : null;
  if (!Number.isFinite(start) || (end !== null && !Number.isFinite(end))) return 'Tarihleri kontrol edin.';
  if (end !== null && end <= start) return 'Bitiş, başlangıçtan sonra olmalı.';
  const s = c.schedule; if (!s) return null;
  if (!Array.isArray(s.days) || !s.days.length) return 'En az bir gün seçin.';
  if (s.days.some(d => !Number.isInteger(d) || d < 1 || d > 7) || new Set(s.days).size !== s.days.length) return 'Günler geçersiz.';
  if (!s.from !== !s.to) return 'Saat aralığının başlangıç ve bitiş saatini birlikte girin.';
  if (s.from && s.to) {
    if (![s.from, s.to].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return 'Saatleri SS:DD biçiminde girin.';
    if (minutesOf(s.from) >= minutesOf(s.to)) return 'Saat aralığında başlangıç, bitişten önce olmalı.';
    if (minutesOf(s.to) - minutesOf(s.from) < 15) return 'Saat aralığı en az 15 dakika olmalı.';
  }
  if (end === null) return 'Tekrarlanan kampanya için hafta sayısı veya son gün seçin.';
  if (end - start > CAMPAIGN_MAX_WEEKS * WEEK) return `Tekrarlanan kampanya en fazla ${CAMPAIGN_MAX_WEEKS} hafta sürebilir.`;
  if (!scheduleSlots(s, start, end).length) return 'Seçilen tarihler arasında bu günler yok. Günleri veya tarihleri kontrol edin.';
  return null;
}
/** "Her Cumartesi ve Pazar · 14:00–17:00" */
export function scheduleText(s: CampaignSchedule) {
  const days = [...s.days].sort((a, b) => a - b), names = days.map(d => WEEKDAY_NAMES[d - 1]);
  const text = days.length === 7 ? 'Her gün' : days.join() === '1,2,3,4,5' ? 'Hafta içi her gün' : `Her ${names.length > 1 ? `${names.slice(0, -1).join(', ')} ve ${names.at(-1)}` : names[0]}`;
  return s.from && s.to ? `${text} · ${s.from}–${s.to}` : text;
}
/** "Her Cumartesi ve Pazar · 5 hafta (4 Eki – 2 Kas)": first and last active day of the whole campaign. */
export function scheduleSummary(c: Timing) {
  if (!c.schedule) return '';
  const start = Date.parse(c.startsAt), end = c.endsAt ? Date.parse(c.endsAt) : NaN, text = scheduleText(c.schedule);
  if (!Number.isFinite(end) || end <= start) return text;
  const first = scheduleSlots(c.schedule, start, Math.min(end, start + 8 * DAY))[0], last = scheduleSlots(c.schedule, Math.max(start, end - 8 * DAY), end).at(-1);
  if (!first || !last) return text;
  const dates = localDay(first[0]) === localDay(last[1] - 1) ? shortDate(first[0]) : `${shortDate(first[0])} – ${shortDate(last[1] - 1)}`, weeks = (end - start) / WEEK;
  return `${text} · ${Number.isInteger(weeks) ? `${weeks} hafta (${dates})` : dates}`;
}
/** "Bugün 14:00", "Yarın 08:00", "Cumartesi 00:00", or with the date when more than a week away. */
function whenLabel(next: number, at: number) {
  const diff = localDay(next) - localDay(at), name = WEEKDAY_NAMES[weekdayOf(localDay(next)) - 1];
  return `${diff === 0 ? 'Bugün' : diff === 1 ? 'Yarın' : diff < 7 ? name : `${shortDate(next)} ${name}`} ${clock(next)}`;
}
/** "bugün", "yarın", "Cumartesi", or "12 Eki Pazartesi" when more than a week away: the day something starts. */
function dayLabel(next: number, at: number) {
  const diff = localDay(next) - localDay(at), name = WEEKDAY_NAMES[weekdayOf(localDay(next)) - 1];
  return diff === 0 ? 'bugün' : diff === 1 ? 'yarın' : diff < 7 ? name : `${shortDate(next)} ${name}`;
}
/** Where a campaign stands, for sorting the owner's cards: running (or between its weekly slots), not started yet, or over. */
export function campaignPhase(c: Timing, at: number): 'active' | 'upcoming' | 'ended' {
  if (c.endsAt && Date.parse(c.endsAt) <= at) return 'ended';
  if (Date.parse(c.startsAt) > at) return 'upcoming';
  return c.schedule && nextCampaignStart(c, at) === null && !campaignActiveAt(c, at) ? 'ended' : 'active';
}
/** Status line on the owner's campaign card. */
export function campaignStatus(c: Timing & Pick<CampaignView, 'enabled' | 'remainingQuantity' | 'minQuantity'>, at: number) {
  if (!c.enabled) return 'Pasif';
  // Not started yet, weekly or not: never "running" before its first day.
  if (Date.parse(c.startsAt) > at && (!c.endsAt || Date.parse(c.endsAt) > at)) { const first = nextCampaignStart(c, at); return first === null ? 'Sona erdi' : `Başlamadı · ${dayLabel(first, at)} başlar`; }
  if (c.endsAt && Date.parse(c.endsAt) <= at) return 'Sona erdi';
  if (c.remainingQuantity === 0) return 'Adet sınırı doldu';
  if (c.remainingQuantity !== null && c.remainingQuantity < (c.minQuantity ?? 1)) return 'Kalan kontenjan yetersiz';
  if (!c.schedule) return 'Aktif';
  if (campaignActiveAt(c, at)) return 'Şu an aktif';
  const next = nextCampaignStart(c, at);
  return next === null ? 'Sona erdi' : `Sıradaki: ${whenLabel(next, at)}`;
}

export function repriceSavedLine(line: OrderLine, quantity: number, productCount: number): OrderLine {
  if (!line.quantityPricing) return { ...line, quantity, total: line.unitPrice * quantity };
  const { original, offers } = line.quantityPricing;
  const discount = discountedPrice({ discounts: offers }, original, productCount);
  return { ...line, quantity, unitPrice: discount.price, total: discount.price * quantity, originalUnitPrice: discount.campaigns.length ? original : undefined, campaigns: discount.campaigns.length ? discount.campaigns : undefined };
}
