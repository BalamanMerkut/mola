import type { CartLine, OrderLine, Product, State } from './types.js';
import { dealRuleOf, isDeal, type DealOffer, type DealRule } from './deals.js';
/** A price discount on each unit (every campaign made before the account campaigns of packages/domain/deals.ts). */
export type PriceDiscount = { kind?: 'percent'; percent: number; amount?: never } | { kind: 'fixed'; amount: number; percent?: never };
/** Price discounts, or one of the account campaigns ("2 al 1 öde", "İkincisi %50", "Hediye ürün"; packages/domain/deals.ts). */
export type CampaignDiscount = PriceDiscount | DealRule;
/**
 * A repeat inside [startsAt, endsAt), with an optional daily "HH:MM" window (start inclusive, end exclusive):
 *   weekly  `days`: ISO weekdays 1 (Pazartesi) … 7 (Pazar);
 *   monthly `monthDay`: a day of the month 1–31 ("her ayın 15. günü", 11 Ekim); a month without that day uses its last day
 *           (31 → 30 Kasım, 28/29 Şubat).
 */
export type CampaignSchedule = { days: number[]; monthDay?: undefined; from?: string; to?: string } | { monthDay: number; days?: undefined; from?: string; to?: string };
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
export type DiscountOffer = Pick<Campaign, 'id' | 'name' | 'combine' | 'reportId' | 'minQuantity' | 'categories'> & { remainingQuantity?: number } & PriceDiscount;
const tl = (amount = 0) => `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(amount / 100)} TL`;
/** "%10", "20 TL indirim · 2 adet ve üzeri", "2 al 1 öde", "İkincisi %50 indirimli", "2 adet alana Americano bedava". */
export function campaignDiscountLabel(discount: { kind?: string; amount?: number; percent?: number; minQuantity?: number; buy?: number; pay?: number; giftQuantity?: number; giftName?: string }) {
  if (discount.kind === 'buyPay') return `${discount.buy} al ${discount.pay} öde`;
  if (discount.kind === 'second') return `İkincisi %${discount.percent} indirimli`;
  if (discount.kind === 'gift') return `${discount.buy} adet alana ${(discount.giftQuantity ?? 1) > 1 ? `${discount.giftQuantity} ` : ''}${discount.giftName ?? 'hediye ürün'} bedava`;
  const label = discount.kind === 'fixed' ? `${tl(discount.amount)} indirim` : `%${discount.percent}`;
  return (discount.minQuantity ?? 1) > 1 ? `${label} · ${discount.minQuantity} adet ve üzeri` : label;
}
/**
 * The single rule for "does this campaign price this product" (saleProducts, the owner's screens, reports). A category
 * campaign with a quantity condition skips products sold by weight: quantity conditions count pieces.
 */
export function campaignCovers(c: CampaignScope & Pick<Campaign, 'minQuantity'> & { kind?: string }, p: Pick<Product, 'id' | 'category' | 'unit'>) {
  if (!c.categories) return c.productIds.includes(p.id);
  // Account campaigns ("2 al 1 öde") count pieces too.
  return c.categories.includes(p.category) && !c.excludedProductIds?.includes(p.id) && !(((c.minQuantity ?? 1) > 1 || isDeal(c)) && p.unit === 'kg');
}
export const campaignProducts = <P extends Pick<Product, 'id' | 'category' | 'unit'>>(c: CampaignScope & Pick<Campaign, 'minQuantity'> & { kind?: string }, products: readonly P[]) => products.filter(p => campaignCovers(c, p));
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
type CampaignData = Pick<State, 'campaigns'> & Partial<Pick<State, 'orders' | 'archives' | 'archivedCampaignUsage'>>;
export function campaignQuantities(lines: OrderLine[]) {
  const result = new Map<string, number>();
  for (const line of lines) for (const id of new Set(line.campaigns?.map(c => c.id))) result.set(id, (result.get(id) ?? 0) + line.quantity);
  // Account campaigns use up their quota by the units they made free or cheaper (deals.ts), not by the units that earned them.
  for (const line of lines) for (const d of line.deals ?? []) result.set(d.id, (result.get(d.id) ?? 0) + d.units);
  return result;
}
export function campaignUsage(s: CampaignData, exceptOrderId?: string) {
  const orders = new Map((s.archives ?? []).flatMap(a => a.orders).map(o => [o.id, o]));
  for (const order of s.orders ?? []) orders.set(order.id, order);
  // Units of orders already moved to long-term history are carried as one counter per campaign.
  const used = new Map<string, number>(Object.entries(s.archivedCampaignUsage ?? {}));
  for (const order of orders.values()) if (order.status !== 'cancelled' && order.id !== exceptOrderId) {
    for (const [id, quantity] of campaignQuantities(order.lines)) used.set(id, (used.get(id) ?? 0) + quantity);
  }
  return used;
}
export function campaignViews(s: CampaignData, exceptOrderId?: string): CampaignView[] {
  const used = campaignUsage(s, exceptOrderId);
  return (s.campaigns ?? []).map(c => ({ ...c, usedQuantity: used.get(c.id) ?? 0, remainingQuantity: c.maxQuantity == null ? null : Math.max(0, c.maxQuantity - (used.get(c.id) ?? 0)) }));
}
export function saleProducts(s: Pick<State, 'products'> & CampaignData, now: Date, exceptOrderId?: string): Product[] {
  const views = s.campaigns?.some(c => c.maxQuantity != null) ? campaignViews(s, exceptOrderId) : (s.campaigns ?? []).map(c => ({ ...c, remainingQuantity: null }));
  // The single place that decides whether a campaign prices anything: menus, orders, edits and limits all come from here.
  const active = views.filter(c => c.enabled && (c.remainingQuantity === null || c.remainingQuantity >= (c.minQuantity ?? 1)) && campaignActiveAt(c, +now));
  // Category campaigns are resolved here, at pricing time, from each product's current category (campaignCovers).
  // Account campaigns never become price discounts: they go to `deals` (only when there are any, so other menus stay as they were).
  const priced = active.filter((c): c is typeof c & PriceDiscount => !isDeal(c)), deals = active.filter(c => isDeal(c));
  return s.products.map(p => {
    const offers = deals.length ? dealOffers(deals, p, s.products) : [];
    return { ...p, discounts: priced.filter(c => campaignCovers(c, p)).map(c => ({ id: c.id, name: c.name, combine: c.combine, reportId: c.reportId, minQuantity: c.minQuantity, ...(c.categories ? { categories: c.categories } : {}), ...(c.remainingQuantity === null ? {} : { remainingQuantity: c.remainingQuantity }), ...(c.kind === 'fixed' ? { kind: 'fixed' as const, amount: c.amount } : { kind: 'percent' as const, percent: c.percent }) })), ...(offers.length ? { deals: offers } : {}) };
  });
}
type Named = Pick<Product, 'id' | 'name' | 'nameEn' | 'category' | 'unit'>;
/** The account campaigns a product takes part in: counted for the condition (`counts`), or as the gift (`gift`). Pieces only. */
function dealOffers(deals: (Campaign & { remainingQuantity: number | null })[], p: Named, products: readonly Named[]): DealOffer[] {
  if (p.unit === 'kg') return [];
  const names = (x?: Named) => x ? { tr: x.name, en: x.nameEn || x.name } : undefined;
  return deals.flatMap(c => {
    const rule = dealRuleOf(c);
    if (!rule) return [];
    const counts = campaignCovers(c, p), gift = rule.kind === 'gift' && rule.giftProductId === p.id;
    if (!counts && !gift) return [];
    const one = !c.categories && c.productIds.length === 1 ? names(products.find(x => x.id === c.productIds[0])) : undefined;
    const giftName = rule.kind === 'gift' ? names(products.find(x => x.id === rule.giftProductId)) : undefined;
    return [{ id: c.id, name: c.name, ...(c.reportId ? { reportId: c.reportId } : {}), ...rule, ...(counts ? { counts: true as const } : {}), ...(gift ? { gift: true as const } : {}), ...(c.categories ? { categories: c.categories } : {}), ...(one ? { scopeName: one } : {}), ...(giftName ? { giftName } : {}), ...(c.remainingQuantity === null ? {} : { remainingQuantity: c.remainingQuantity }) }];
  });
}
export function discountedPrice(product: Pick<Product, 'discounts'>, original: number, quantity = 1) {
  const apply = (price: number, discount: PriceDiscount) => Math.max(1, discount.kind === 'fixed' ? price - discount.amount : Math.round(price * (100 - discount.percent) / 100));
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
/** The day of the month (1–31) of a Turkish calendar day number, and how many days its month has. */
const calendarOf = (day: number) => { const d = new Date(day * DAY); return { date: d.getUTCDate(), length: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() }; };
export const isMonthly = (s: CampaignSchedule | undefined): s is Extract<CampaignSchedule, { monthDay: number }> => !!s && s.monthDay !== undefined;
/** Does the repeat run on this Turkish calendar day: a chosen weekday, or the month's chosen day (its last day when shorter). */
function onDay(s: CampaignSchedule, day: number) {
  if (!isMonthly(s)) return s.days.includes(weekdayOf(day));
  const { date, length } = calendarOf(day);
  return date === Math.min(s.monthDay, length);
}
/** How far ahead the next run of a repeat can be: a week, or a month and a bit. */
const lookahead = (s: CampaignSchedule | undefined) => (isMonthly(s) ? 32 : 8) * DAY;
/** Inside [startsAt, endsAt) and, for a repeating campaign, on one of its days and inside its daily window. Ignores enabled and quotas. */
export function campaignActiveAt(c: Timing, at: number) {
  if (Date.parse(c.startsAt) > at || (c.endsAt && at >= Date.parse(c.endsAt))) return false;
  const s = c.schedule; if (!s) return true;
  const day = localDay(at); if (!onDay(s, day)) return false;
  if (!s.from || !s.to) return true;
  const minute = Math.floor((at + TR - day * DAY) / MINUTE);
  return minute >= minutesOf(s.from) && minute < minutesOf(s.to);
}
/** Active stretches inside [from, to); touching ones (whole days in a row) are merged. Without a schedule it is the range itself. */
export function scheduleSlots(s: CampaignSchedule | undefined, from: number, to: number): [number, number][] {
  if (!s) return from < to ? [[from, to]] : [];
  const out: [number, number][] = [], open = s.from && s.to ? minutesOf(s.from) * MINUTE : 0, close = s.from && s.to ? minutesOf(s.to) * MINUTE : DAY;
  for (let day = localDay(from); day * DAY - TR < to; day++) {
    if (!onDay(s, day)) continue;
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
  return scheduleSlots(c.schedule, from, Math.min(end, from + lookahead(c.schedule)))[0]?.[0] ?? null;
}
/** "Next N weeks": the end is exactly N weeks after the start, so every chosen weekday occurs N times. */
export const repeatEnd = (startsAt: string, weeks: number) => new Date(Date.parse(startsAt) + weeks * WEEK).toISOString();
export const CAMPAIGN_MAX_MONTHS = 12;
/**
 * "Next N months" of a monthly campaign: the same day of the month N months later (the month's last day when it is shorter),
 * at the start's time of day, so the chosen day of the month occurs exactly N times.
 */
export function repeatMonthsEnd(startsAt: string, months: number) {
  const start = Date.parse(startsAt), day = localDay(start), d = new Date(day * DAY), offset = start - (day * DAY - TR);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)), length = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), length));
  return new Date(target.getTime() - TR + offset).toISOString();
}
/** Whole months between a monthly campaign's start and end (1–12), or null when the end is a chosen last day. */
export function repeatMonths(c: Pick<Campaign, 'startsAt' | 'endsAt'>) {
  if (!c.endsAt) return null;
  for (let n = 1; n <= CAMPAIGN_MAX_MONTHS; n++) if (repeatMonthsEnd(c.startsAt, n) === new Date(Date.parse(c.endsAt)).toISOString()) return n;
  return null;
}
/** Plain message for the first problem, or null. Shared by the editor and the server. */
export function campaignTimingError(c: Timing) {
  const start = Date.parse(c.startsAt), end = c.endsAt ? Date.parse(c.endsAt) : null;
  if (!Number.isFinite(start) || (end !== null && !Number.isFinite(end))) return 'Tarihleri kontrol edin.';
  if (end !== null && end <= start) return 'Bitiş, başlangıçtan sonra olmalı.';
  const s = c.schedule; if (!s) return null;
  if (isMonthly(s)) {
    if (s.days !== undefined) return 'Ayın günüyle hafta günleri birlikte seçilemez.';
    if (!Number.isInteger(s.monthDay) || s.monthDay < 1 || s.monthDay > 31) return 'Ayın gününü 1–31 arasında seçin.';
  } else {
    if (!Array.isArray(s.days) || !s.days.length) return 'En az bir gün seçin.';
    if (s.days.some(d => !Number.isInteger(d) || d < 1 || d > 7) || new Set(s.days).size !== s.days.length) return 'Günler geçersiz.';
  }
  if (!s.from !== !s.to) return 'Saat aralığının başlangıç ve bitiş saatini birlikte girin.';
  if (s.from && s.to) {
    if (![s.from, s.to].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return 'Saatleri SS:DD biçiminde girin.';
    if (minutesOf(s.from) >= minutesOf(s.to)) return 'Saat aralığında başlangıç, bitişten önce olmalı.';
    if (minutesOf(s.to) - minutesOf(s.from) < 15) return 'Saat aralığı en az 15 dakika olmalı.';
  }
  if (isMonthly(s)) {
    if (end === null) return 'Her ay tekrarlanan kampanya için ay sayısı veya son gün seçin.';
    if (end > Date.parse(repeatMonthsEnd(c.startsAt, CAMPAIGN_MAX_MONTHS))) return `Her ay tekrarlanan kampanya en fazla ${CAMPAIGN_MAX_MONTHS} ay sürebilir.`;
    if (!scheduleSlots(s, start, end).length) return 'Seçilen tarihler arasında ayın bu günü yok. Ayın gününü veya tarihleri kontrol edin.';
    return null;
  }
  if (end === null) return 'Tekrarlanan kampanya için hafta sayısı veya son gün seçin.';
  if (end - start > CAMPAIGN_MAX_WEEKS * WEEK) return `Tekrarlanan kampanya en fazla ${CAMPAIGN_MAX_WEEKS} hafta sürebilir.`;
  if (!scheduleSlots(s, start, end).length) return 'Seçilen tarihler arasında bu günler yok. Günleri veya tarihleri kontrol edin.';
  return null;
}
/** "Her ayın 15. günü", "Her ayın 31. günü (kısa aylarda ayın son günü)": the same words on every screen. */
export const monthDayText = (n: number) => `Her ayın ${n}. günü${n >= 29 ? ' (kısa aylarda ayın son günü)' : ''}`;
/** "Her Cumartesi ve Pazar · 14:00–17:00", "Her ayın 15. günü · 12:00–15:00" */
export function scheduleText(s: CampaignSchedule) {
  if (isMonthly(s)) return s.from && s.to ? `${monthDayText(s.monthDay)} · ${s.from}–${s.to}` : monthDayText(s.monthDay);
  const days = [...s.days].sort((a, b) => a - b), names = days.map(d => WEEKDAY_NAMES[d - 1]);
  const text = days.length === 7 ? 'Her gün' : days.join() === '1,2,3,4,5' ? 'Hafta içi her gün' : `Her ${names.length > 1 ? `${names.slice(0, -1).join(', ')} ve ${names.at(-1)}` : names[0]}`;
  return s.from && s.to ? `${text} · ${s.from}–${s.to}` : text;
}
/** "Her Cumartesi ve Pazar · 5 hafta (4 Eki – 2 Kas)": first and last active day of the whole campaign. */
export function scheduleSummary(c: Timing) {
  if (!c.schedule) return '';
  const start = Date.parse(c.startsAt), end = c.endsAt ? Date.parse(c.endsAt) : NaN, text = scheduleText(c.schedule);
  if (!Number.isFinite(end) || end <= start) return text;
  const ahead = lookahead(c.schedule), first = scheduleSlots(c.schedule, start, Math.min(end, start + ahead))[0], last = scheduleSlots(c.schedule, Math.max(start, end - ahead), end).at(-1);
  if (!first || !last) return text;
  const dates = localDay(first[0]) === localDay(last[1] - 1) ? shortDate(first[0]) : `${shortDate(first[0])} – ${shortDate(last[1] - 1)}`;
  if (isMonthly(c.schedule)) { const months = repeatMonths(c as Pick<Campaign, 'startsAt' | 'endsAt'>); return `${text} · ${months ? `${months} ay (${dates})` : dates}`; }
  const weeks = (end - start) / WEEK;
  return `${text} · ${Number.isInteger(weeks) ? `${weeks} hafta (${dates})` : dates}`;
}
/**
 * The dates a repeating campaign ran on, one per active day (its window that day), oldest first: the report's "Tekrarlar".
 * Touching whole days of a weekly campaign stay separate occurrences here.
 */
export function scheduleOccurrences(s: CampaignSchedule, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of scheduleSlots(s, from, to)) for (let day = localDay(a); day * DAY - TR < b; day++) {
    const start = Math.max(a, day * DAY - TR), end = Math.min(b, (day + 1) * DAY - TR);
    if (start < end) out.push([start, end]);
  }
  return out;
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
/**
 * The four states the owner sees (11 Ekim, "onaya düşüyor" karışıklığı): there is no approval step, a saved campaign is
 * one of these. Taslak = not enabled; Planlandı = its start is still ahead; Aktif = between its start and end (a repeating
 * one prices only on its days and hours); Bitti = its end passed or its quota is used up.
 */
export type CampaignState = 'draft' | 'planned' | 'active' | 'ended';
export const CAMPAIGN_STATES: Record<CampaignState, { label: string; line: string }> = {
  draft: { label: 'Taslak', line: 'Kaydedildi ama kapalı: menüde görünmez, indirim uygulanmaz.' },
  planned: { label: 'Planlandı', line: 'Başlangıç zamanı gelince kendiliğinden başlar; o zamana kadar menüde görünmez, indirim uygulanmaz.' },
  active: { label: 'Aktif', line: 'Menüde görünür ve indirim siparişe kendiliğinden uygulanır (tekrarlanan kampanyada yalnız seçilen gün ve saatlerde).' },
  ended: { label: 'Bitti', line: 'Süresi doldu ya da adet sınırı bitti: menüde görünmez, indirim uygulanmaz.' },
};
export function campaignState(c: Timing & Pick<CampaignView, 'enabled' | 'remainingQuantity' | 'minQuantity'>, at: number): CampaignState {
  if (!c.enabled) return 'draft';
  const phase = campaignPhase(c, at);
  if (phase === 'ended' || (c.remainingQuantity !== null && c.remainingQuantity < (c.minQuantity ?? 1))) return 'ended';
  return phase === 'upcoming' ? 'planned' : 'active';
}
/** The card's second line next to the state: "Şu an uygulanıyor", "Başlıyor: Yarın 14:00", "Sıradaki: Cuma 14:00", "Süresi doldu". */
export function campaignWhen(c: Timing & Pick<CampaignView, 'enabled' | 'remainingQuantity' | 'minQuantity'>, at: number) {
  const state = campaignState(c, at);
  if (state === 'draft') return 'Menüde görünmez';
  if (state === 'ended') return c.endsAt && Date.parse(c.endsAt) <= at ? 'Süresi doldu' : c.remainingQuantity === 0 ? 'Adet sınırı doldu' : c.remainingQuantity !== null && c.remainingQuantity < (c.minQuantity ?? 1) ? 'Kalan adet yetersiz' : 'Süresi doldu';
  if (campaignActiveAt(c, at)) return 'Şu an uygulanıyor';
  const next = nextCampaignStart(c, at);
  return next === null ? 'Süresi doldu' : `${state === 'planned' ? 'Başlıyor' : 'Sıradaki'}: ${whenLabel(next, at)}`;
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
