// Menu, stock and calendar of the "5 yıllık hız ve hata testi" café (scripts/bes-yil-testi.ts). Deterministic: the same
// date always gives the same prices, campaigns and recipes, so a run can be split (uret, then canli) and repeated.
import { addDays, businessDay, dayStart } from '../packages/domain/business-day.js';
import type { Campaign } from '../packages/domain/campaigns.js';
import type { OptionGroup, Product } from '../packages/domain/types.js';
import type { OptionRule, Recipe, RecipeItem, StockItem, StockUnit } from '../packages/domain/stock.js';

export type Profile = 'orta' | 'yogun';
export const PROFILES: Record<Profile, { bills: number; tables: number; staff: number; waiters: number; kitchen: number; cashiers: number; reservations: number; events: number; label: string }> = {
  orta: { bills: 150, tables: 30, staff: 8, waiters: 3, kitchen: 1, cashiers: 1, reservations: 2, events: 1, label: 'Orta kafe (≈150 hesap/gün)' },
  yogun: { bills: 600, tables: 30, staff: 15, waiters: 6, kitchen: 2, cashiers: 2, reservations: 6, events: 2, label: 'Yoğun kafe (≈600 hesap/gün, Elazığ)' },
};

// ---- Seeded randomness: one stream per (seed, day), so a day is the same whether it ran in `uret` or in `canli` ----
export function rng(seed: number) {
  let v = seed | 0;
  const next = () => { v = (v + 0x6d2b79f5) | 0; let t = v; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const int = (a: number, b: number) => Math.floor(a + next() * (b - a + 1));
  const chance = (p: number) => next() < p;
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)];
  const weighted = <T>(items: readonly (readonly [T, number])[]) => { let r = next() * items.reduce((n, [, w]) => n + w, 0); for (const [item, w] of items) if ((r -= w) < 0) return item; return items.at(-1)![0]; };
  return { next, int, chance, pick, weighted };
}
export type Rng = ReturnType<typeof rng>;
export const daySeed = (seed: number, day: string) => (seed * 1_000_003 + Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000)) | 0;

// ---- Calendar (Türkiye, UTC+3, no DST) ----
export const HOUR = 3600_000, MIN = 60_000;
/** A Turkish wall clock time on a business day: hours after midnight; 24.5 = 00:30 the next calendar day. */
export const at = (day: string, hours: number) => Date.parse(`${day}T00:00:00+03:00`) + Math.round(hours * HOUR);
export const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Pazar
/** Ramazan (approximate, by year): busy evenings, quiet days. */
const RAMAZAN: [string, string][] = [['2021-04-13', '2021-05-12'], ['2022-04-02', '2022-05-01'], ['2023-03-23', '2023-04-20'], ['2024-03-11', '2024-04-08'], ['2025-03-01', '2025-03-29'], ['2026-02-18', '2026-03-19'], ['2027-02-08', '2027-03-09'], ['2028-01-28', '2028-02-26']];
export const ramazan = (day: string) => RAMAZAN.some(([a, b]) => day >= a && day <= b);
/** Match nights (Elazığspor, derbiler): about one a week, the same days every run. */
export const matchNight = (day: string) => (Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000) * 2654435761 >>> 0) % 7 === 0;
/** How busy a day is against the profile's average (≈1.0 over a year). */
export function dayFactor(day: string) {
  const w = weekday(day), month = Number(day.slice(5, 7));
  let f = w === 6 ? 1.3 : w === 0 ? 1.22 : w === 5 ? 1.08 : 0.9;
  f *= [0.88, 0.86, 0.92, 0.98, 1.04, 1.1, 1.16, 1.16, 1.06, 1.0, 0.94, 0.92][month - 1];
  if (ramazan(day)) f *= 0.82;
  if (matchNight(day)) f *= 1.25;
  return f;
}
/** Visit start weights per Turkish hour (08:00 … 01:00). */
export const HOURS: [number, number][] = [[8, 2], [9, 3], [10, 4], [11, 5], [12, 7], [13, 8], [14, 6], [15, 5], [16, 5], [17, 6], [18, 7], [19, 8], [20, 9], [21, 9], [22, 8], [23, 6], [24, 3], [25, 1]];

// ---- Prices: the menu below is today's; going back, prices drop 18 % at every 1 January and 1 July ----
const STEP = 1.18;
export function priceIndex(day: string, today: string) {
  let steps = 0;
  for (let y = Number(day.slice(0, 4)); y <= Number(today.slice(0, 4)); y++) for (const md of ['01-01', '07-01']) { const d = `${y}-${md}`; if (d > day && d <= today) steps++; }
  return 1 / STEP ** steps;
}
const round50 = (kurus: number) => Math.max(50, Math.round(kurus / 50) * 50);

// ---- Menu: 120 products in 8 categories ----
const size: OptionGroup = { preset: 'size', id: 'size', name: 'Boy', required: true, options: [{ id: 'small', name: 'Küçük', extra: -1500 }, { id: 'regular', name: 'Standart', extra: 0 }, { id: 'large', name: 'Büyük', extra: 2500 }] };
const milk: OptionGroup = { preset: 'milk', id: 'milk', name: 'Süt tercihi', required: false, options: [{ id: 'lactose', name: 'Laktozsuz süt', extra: 1500 }, { id: 'oat', name: 'Yulaf sütü', extra: 3000 }, { id: 'almond', name: 'Badem sütü', extra: 3000 }] };
const syrup: OptionGroup = { preset: 'custom', id: 'syrup', name: 'Şurup', required: false, options: [{ id: 'caramel', name: 'Karamel', extra: 1500 }, { id: 'vanilla', name: 'Vanilya', extra: 1500 }, { id: 'hazelnut', name: 'Fındık', extra: 1500 }] };
const sugar: OptionGroup = { preset: 'custom', id: 'sugar', name: 'Şeker tercihi', required: true, options: [{ id: 'none', name: 'Sade', extra: 0 }, { id: 'medium', name: 'Orta', extra: 0 }, { id: 'sweet', name: 'Şekerli', extra: 0 }] };
const extra: OptionGroup = { preset: 'custom', id: 'extra', name: 'Ekstra', required: false, options: [{ id: 'cheese', name: 'Kaşarlı', extra: 3000 }, { id: 'sucuk', name: 'Sucuklu', extra: 5000 }] };
const service: OptionGroup = { preset: 'service', id: 'service', name: 'Servis tercihi', required: false, options: [{ id: 'icecream', name: 'Dondurmalı', extra: 3500 }] };
type Use = [item: string, amount: number];
/** [name, price (kuruş, today), recipe ('ready' = bought ready, [] = not tracked), groups, weight (how often sold)] */
type Spec = [string, number, Use[] | 'ready', OptionGroup[], number];
const coffee = (bean: number, milkMl = 0): Use[] => [['Espresso çekirdeği', bean], ...(milkMl ? [['Süt', milkMl] as Use] : [])];
export const CATEGORIES: [string, number, Spec[]][] = [
  ['Kahveler', 10, [
    ['Espresso', 9000, coffee(9), [], 3], ['Doppio', 11000, coffee(18), [], 2], ['Americano', 12000, coffee(18), [size], 6], ['Caffè Latte', 14000, coffee(18, 200), [size, milk, syrup], 9],
    ['Cappuccino', 14000, coffee(18, 150), [size, milk], 6], ['Flat White', 15000, coffee(18, 120), [milk], 3], ['Cortado', 13000, coffee(18, 60), [], 2], ['Macchiato', 12500, coffee(9, 30), [], 2],
    ['Mocha', 16000, [...coffee(18, 180), ['Kakao', 15]], [size, milk], 4], ['Beyaz Mocha', 16500, [...coffee(18, 180), ['Beyaz çikolata', 20]], [size, milk], 3], ['Karamel Latte', 16000, [...coffee(18, 200), ['Karamel şurubu', 20]], [size, milk], 4],
    ['Vanilyalı Latte', 16000, [...coffee(18, 200), ['Vanilya şurubu', 20]], [size, milk], 3], ['Fındıklı Latte', 16000, [...coffee(18, 200), ['Fındık şurubu', 20]], [size, milk], 2], ['Filtre Kahve', 11000, [['Filtre kahve', 15]], [size, milk], 4],
    ['Türk Kahvesi', 9500, [['Türk kahvesi', 7]], [sugar], 10], ['Menengiç Kahvesi', 11000, [['Menengiç', 10], ['Süt', 120]], [sugar], 3], ['Dibek Kahvesi', 10500, [['Dibek kahvesi', 8]], [sugar], 3],
    ['Damla Sakızlı Türk Kahvesi', 10500, [['Türk kahvesi', 7]], [sugar], 2], ['Sütlü Türk Kahvesi', 10500, [['Türk kahvesi', 7], ['Süt', 60]], [sugar], 2], ['Affogato', 15000, [...coffee(9), ['Dondurma', 80]], [], 1],
  ]],
  ['Çaylar', 10, [
    ['Demleme Çay', 2500, [['Siyah çay', 3], ['Şeker', 6]], [], 30], ['Fincan Çay', 4500, [['Siyah çay', 5], ['Şeker', 6]], [], 6], ['Kupa Çay', 5000, [['Siyah çay', 6]], [], 4], ['Yeşil Çay', 7500, [['Yeşil çay', 3]], [], 2],
    ['Ihlamur', 8500, [['Ihlamur', 4]], [], 3], ['Adaçayı', 8000, [['Adaçayı', 4]], [], 3], ['Kuşburnu', 8000, [['Kuşburnu', 5]], [], 2], ['Papatya', 8000, [['Papatya', 3]], [], 1],
    ['Nane Limon', 8500, [['Nane', 5], ['Limon', 30]], [], 2], ['Sahlep', 11000, [['Sahlep tozu', 25], ['Süt', 200]], [], 3], ['Sıcak Çikolata', 12000, [['Kakao', 25], ['Süt', 200]], [], 3], ['Elma Çayı', 6000, [], [], 2],
  ]],
  ['Soğuk İçecekler', 10, [
    ['Ice Latte', 15000, coffee(18, 200), [milk, syrup], 5], ['Ice Americano', 13000, coffee(18), [], 4], ['Ice Mocha', 17000, [...coffee(18, 180), ['Kakao', 15]], [milk], 2], ['Frappe', 16000, [...coffee(9, 150), ['Krema', 40]], [], 2],
    ['Cold Brew', 15000, [['Filtre kahve', 25]], [], 2], ['Limonata', 12000, [['Limon', 120], ['Şeker', 25]], [], 5], ['Çilekli Limonata', 13500, [['Limon', 100], ['Çilek', 60]], [], 2], ['Naneli Limonata', 13000, [['Limon', 110], ['Nane', 5]], [], 2],
    ['Çikolatalı Milkshake', 16000, [['Süt', 200], ['Dondurma', 120], ['Kakao', 15]], [], 2], ['Çilekli Milkshake', 16000, [['Süt', 200], ['Dondurma', 120], ['Çilek', 60]], [], 2], ['Vanilyalı Milkshake', 15500, [['Süt', 200], ['Dondurma', 140]], [], 1],
    ['Orman Meyveli Smoothie', 16500, [['Orman meyvesi', 120], ['Yoğurt', 100]], [], 1], ['Muzlu Smoothie', 15500, [['Muz', 1], ['Süt', 150]], [], 1], ['Şeftalili Ice Tea', 11000, [['Siyah çay', 4], ['Şeker', 20]], [], 2],
    ['Taze Portakal Suyu', 14000, [['Portakal', 400]], [], 3], ['Ayran', 5000, 'ready', [], 4], ['Soda', 4500, 'ready', [], 3], ['Su', 2500, 'ready', [], 6],
  ]],
  ['Meşrubat', 20, [
    ['Kola', 7000, 'ready', [], 6], ['Kola Zero', 7000, 'ready', [], 2], ['Gazoz', 6000, 'ready', [], 3], ['Portakallı Gazoz', 6500, 'ready', [], 2], ['Vişne Suyu', 6500, 'ready', [], 2],
    ['Şeftali Suyu', 6500, 'ready', [], 2], ['Limonlu Maden Suyu', 5000, 'ready', [], 3], ['Enerji İçeceği', 9500, 'ready', [], 1], ['Kutu Soğuk Çay', 6500, 'ready', [], 2], ['Su (1 L)', 4000, 'ready', [], 1],
  ]],
  ['Tatlılar', 10, [
    ['San Sebastian', 19000, [['Krem peynir', 90], ['Krema', 40], ['Yumurta', 1], ['Şeker', 25]], [service], 5], ['Brownie', 16000, [['Bitter çikolata', 40], ['Tereyağı', 25], ['Un', 20], ['Yumurta', 1]], [service], 4],
    ['Tiramisu', 17500, [['Krem peynir', 70], ['Espresso çekirdeği', 9], ['Kakao', 5]], [], 3], ['Magnolia', 15000, [['Süt', 150], ['Muz', 1], ['Bisküvi', 30]], [], 3], ['Profiterol', 16000, [['Bitter çikolata', 40], ['Krema', 50]], [], 2],
    ['Limonlu Cheesecake', 18500, [['Krem peynir', 90], ['Limon', 20], ['Bisküvi', 30]], [], 2], ['Frambuazlı Cheesecake', 18500, [['Krem peynir', 90], ['Orman meyvesi', 40], ['Bisküvi', 30]], [], 2],
    ['Sufle', 17000, [['Bitter çikolata', 50], ['Yumurta', 1], ['Tereyağı', 20]], [service], 3], ['Waffle', 22000, [['Un', 80], ['Yumurta', 1], ['Süt', 80], ['Muz', 1], ['Çilek', 50], ['Bitter çikolata', 30]], [], 3],
    ['Künefe', 21000, [['Kadayıf', 80], ['Künefe peyniri', 70], ['Tereyağı', 30]], [service], 3], ['Fıstıklı Baklava', 24000, 'ready', [service], 2], ['Trileçe', 14000, [], [], 2],
    ['Sütlaç', 12000, [['Süt', 200], ['Pirinç', 20], ['Şeker', 30]], [], 2], ['Kazandibi', 13000, [], [], 1], ['Havuç Dilimi', 18000, 'ready', [], 1], ['Top Dondurma', 9000, [['Dondurma', 80]], [], 2],
    ['Çikolatalı Pasta', 16000, [], [], 2], ['Elmalı Turta', 15000, [], [], 1],
  ]],
  ['Kahvaltı', 10, [
    ['Serpme Kahvaltı (2 kişilik)', 90000, [['Beyaz peynir', 120], ['Kaşar', 80], ['Zeytin', 80], ['Domates', 150], ['Salatalık', 120], ['Yumurta', 2], ['Bal', 30], ['Kaymak', 30], ['Ekmek', 1], ['Tereyağı', 20]], [], 3],
    ['Kahvaltı Tabağı', 38000, [['Beyaz peynir', 60], ['Kaşar', 40], ['Zeytin', 40], ['Domates', 80], ['Salatalık', 60], ['Yumurta', 1], ['Ekmek', 1]], [], 5], ['Menemen', 22000, [['Yumurta', 2], ['Domates', 150], ['Biber', 40], ['Tereyağı', 10]], [extra], 5],
    ['Sucuklu Yumurta', 24000, [['Yumurta', 2], ['Sucuk', 60], ['Tereyağı', 10]], [], 4], ['Omlet', 19000, [['Yumurta', 3], ['Tereyağı', 10]], [extra], 3], ['Pişi', 15000, [['Un', 120], ['Sıvı yağ', 60]], [], 2],
    ['Peynirli Gözleme', 20000, [['Un', 150], ['Beyaz peynir', 60]], [], 3], ['Patatesli Gözleme', 19000, [['Un', 150], ['Patates', 120]], [], 2], ['Simit Tabağı', 16000, [['Simit', 1], ['Beyaz peynir', 40], ['Domates', 60]], [], 3],
    ['Avokadolu Ekmek', 26000, [['Ekmek', 1], ['Avokado', 1], ['Yumurta', 1]], [], 1], ['Bal Kaymak', 18000, [['Bal', 40], ['Kaymak', 50], ['Ekmek', 1]], [], 2], ['Kaşarlı Omlet', 21000, [['Yumurta', 3], ['Kaşar', 40]], [], 2],
    ['Haşlanmış Yumurta', 6000, [['Yumurta', 1]], [], 2], ['Ekstra Peynir Tabağı', 14000, [['Beyaz peynir', 80], ['Kaşar', 60]], [], 1],
  ]],
  ['Atıştırmalıklar', 10, [
    ['Patates Kızartması', 15000, [['Patates', 250], ['Sıvı yağ', 50]], [], 6], ['Soğan Halkası', 15000, [['Soğan', 150], ['Un', 40], ['Sıvı yağ', 50]], [], 2], ['Çıtır Tavuk', 28000, [['Tavuk göğsü', 180], ['Un', 40], ['Sıvı yağ', 60]], [], 3],
    ['Nachos', 22000, [['Kaşar', 60]], [], 2], ['Pizza Dilim', 18000, [['Un', 100], ['Kaşar', 70], ['Sucuk', 30]], [], 3], ['Mantı', 30000, [['Un', 100], ['Kıyma', 60], ['Yoğurt', 120]], [], 2],
    ['Sigara Böreği', 16000, [['Yufka', 1], ['Beyaz peynir', 60], ['Sıvı yağ', 40]], [], 3], ['Paçanga Böreği', 20000, [['Yufka', 1], ['Pastırma', 40], ['Kaşar', 40]], [], 2], ['Penne Arabiata', 26000, [['Makarna', 120], ['Domates', 120]], [], 2],
    ['Sezar Salata', 27000, [['Marul', 150], ['Tavuk göğsü', 100], ['Kaşar', 20]], [], 2], ['Ton Balıklı Salata', 28000, [['Marul', 150], ['Ton balığı', 80]], [], 1], ['Köfte Ekmek', 26000, [['Kıyma', 120], ['Ekmek', 1], ['Domates', 50]], [], 3],
    ['Hamburger', 32000, [['Kıyma', 150], ['Hamburger ekmeği', 1], ['Marul', 30], ['Patates', 150]], [], 4], ['Cheeseburger', 35000, [['Kıyma', 150], ['Hamburger ekmeği', 1], ['Kaşar', 30], ['Patates', 150]], [], 3],
    ['Kumpir', 30000, [['Patates', 350], ['Kaşar', 60], ['Tereyağı', 20]], [], 2], ['Tavuk Wrap', 27000, [['Lavaş', 1], ['Tavuk göğsü', 120], ['Marul', 40]], [], 3],
  ]],
  ['Tostlar ve Sandviçler', 10, [
    ['Kaşarlı Tost', 14000, [['Tost ekmeği', 2], ['Kaşar', 60], ['Tereyağı', 10]], [], 7], ['Karışık Tost', 17000, [['Tost ekmeği', 2], ['Kaşar', 50], ['Sucuk', 30]], [], 6], ['Sucuklu Tost', 16000, [['Tost ekmeği', 2], ['Sucuk', 50]], [], 3],
    ['Ayvalık Tostu', 22000, [['Somun', 1], ['Kaşar', 60], ['Sucuk', 40], ['Domates', 50]], [], 3], ['Bazlama Tost', 19000, [['Bazlama', 1], ['Kaşar', 60]], [extra], 3], ['Tavuklu Sandviç', 21000, [['Ciabatta', 1], ['Tavuk göğsü', 100], ['Marul', 30]], [], 2],
    ['Ton Balıklı Sandviç', 21000, [['Ciabatta', 1], ['Ton balığı', 70]], [], 1], ['Hindi Füme Sandviç', 21000, [['Ciabatta', 1], ['Hindi füme', 60], ['Kaşar', 30]], [], 2], ['Kumru', 22000, [['Somun', 1], ['Sucuk', 50], ['Kaşar', 50]], [], 2],
    ['Panini', 22000, [['Ciabatta', 1], ['Kaşar', 50], ['Domates', 40]], [], 2], ['Peynirli Ciabatta', 19000, [['Ciabatta', 1], ['Beyaz peynir', 60]], [], 1], ['Simit Tost', 15000, [['Simit', 1], ['Kaşar', 50]], [], 3],
  ]],
];
export const UNITS: Record<string, StockUnit> = {
  'Süt': 'ml', 'Yulaf sütü': 'ml', 'Laktozsuz süt': 'ml', 'Badem sütü': 'ml', 'Karamel şurubu': 'ml', 'Vanilya şurubu': 'ml', 'Fındık şurubu': 'ml', 'Krema': 'ml', 'Sıvı yağ': 'ml',
  'Yumurta': 'piece', 'Ekmek': 'piece', 'Simit': 'piece', 'Tost ekmeği': 'piece', 'Somun': 'piece', 'Bazlama': 'piece', 'Ciabatta': 'piece', 'Hamburger ekmeği': 'piece', 'Lavaş': 'piece', 'Yufka': 'piece', 'Muz': 'piece', 'Avokado': 'piece',
};
/** Unit cost today (kuruş per g, ml or piece). */
export const COSTS: Record<string, number> = {
  'Espresso çekirdeği': 120, 'Filtre kahve': 90, 'Türk kahvesi': 80, 'Menengiç': 60, 'Dibek kahvesi': 85, 'Siyah çay': 40, 'Yeşil çay': 120, 'Ihlamur': 150, 'Adaçayı': 90, 'Kuşburnu': 70, 'Papatya': 100, 'Sahlep tozu': 120,
  'Kakao': 70, 'Beyaz çikolata': 60, 'Bitter çikolata': 55, 'Şeker': 4, 'Un': 2, 'Tereyağı': 45, 'Kaşar': 40, 'Beyaz peynir': 30, 'Krem peynir': 35, 'Künefe peyniri': 40, 'Sucuk': 70, 'Hindi füme': 60, 'Pastırma': 150,
  'Ton balığı': 80, 'Tavuk göğsü': 25, 'Kıyma': 55, 'Patates': 3, 'Domates': 4, 'Salatalık': 4, 'Biber': 6, 'Marul': 5, 'Soğan': 2, 'Zeytin': 25, 'Bal': 40, 'Kaymak': 50, 'Çilek': 15, 'Orman meyvesi': 25, 'Limon': 5,
  'Portakal': 3, 'Nane': 20, 'Dondurma': 20, 'Yoğurt': 6, 'Bisküvi': 12, 'Kadayıf': 15, 'Pirinç': 6, 'Makarna': 5, 'Süt': 4, 'Yulaf sütü': 12, 'Laktozsuz süt': 6, 'Badem sütü': 14, 'Karamel şurubu': 12,
  'Vanilya şurubu': 12, 'Fındık şurubu': 12, 'Krema': 10, 'Sıvı yağ': 7, 'Yumurta': 500, 'Ekmek': 1500, 'Simit': 1500, 'Tost ekmeği': 400, 'Somun': 1500, 'Bazlama': 1200, 'Ciabatta': 2000, 'Hamburger ekmeği': 1500,
  'Lavaş': 600, 'Yufka': 900, 'Muz': 1200, 'Avokado': 3500,
};
/** Option effects on the stock: smaller/larger cups, other milks. */
const SIZE_RULES: OptionRule[] = [{ groupId: 'size', optionId: 'small', scale: 0.75 }, { groupId: 'size', optionId: 'large', scale: 1.35 }];
const MILK_RULES: OptionRule[] = [{ groupId: 'milk', optionId: 'lactose', replace: [{ from: 'Süt', to: 'Laktozsuz süt' }] }, { groupId: 'milk', optionId: 'oat', replace: [{ from: 'Süt', to: 'Yulaf sütü' }] }, { groupId: 'milk', optionId: 'almond', replace: [{ from: 'Süt', to: 'Badem sütü' }] }];
const SYRUP_RULES: OptionRule[] = [{ groupId: 'syrup', optionId: 'caramel', add: [{ itemId: 'Karamel şurubu', amount: 15 }] }, { groupId: 'syrup', optionId: 'vanilla', add: [{ itemId: 'Vanilya şurubu', amount: 15 }] }, { groupId: 'syrup', optionId: 'hazelnut', add: [{ itemId: 'Fındık şurubu', amount: 15 }] }];
const EXTRA_RULES: OptionRule[] = [{ groupId: 'extra', optionId: 'cheese', add: [{ itemId: 'Kaşar', amount: 30 }] }, { groupId: 'extra', optionId: 'sucuk', add: [{ itemId: 'Sucuk', amount: 30 }] }];
const SERVICE_RULES: OptionRule[] = [{ groupId: 'service', optionId: 'icecream', add: [{ itemId: 'Dondurma', amount: 60 }] }];

export type MenuEntry = { product: Product; weight: number; use: Use[] | 'ready' };
/** The menu as it is today (prices of `today`); `priced` gives a past day's prices. */
export function menu(): MenuEntry[] {
  let n = 0;
  return CATEGORIES.flatMap(([category, vat, specs]) => specs.map(([name, price, use, groups, weight]) => {
    n++;
    const product: Product = { id: `p${String(n).padStart(3, '0')}`, code: String(n), name, nameEn: name, category, description: `${name}, Mola 5 yıl testi menüsü.`, price, soldOut: false, art: category === 'Tatlılar' ? 'cake' : category === 'Çaylar' ? 'tea' : category === 'Kahveler' ? 'coffee' : category.includes('İçecek') || category === 'Meşrubat' ? 'cold' : 'food', groups: structuredClone(groups), ...(vat !== 10 ? { vatRate: vat } : {}), published: true, firstPublishedAt: null };
    return { product, weight, use };
  }));
}
export const priced = (price: number, day: string, today: string) => round50(price * priceIndex(day, today));

/** Stock items: the ingredients the recipes use and one "hazır ürün" per ready-bought product. Ids are stable. */
export function stockItems(entries: MenuEntry[], createdAt: string): StockItem[] {
  const names = [...new Set([...entries.flatMap(e => e.use === 'ready' ? [] : e.use.map(([i]) => i)), 'Laktozsuz süt', 'Yulaf sütü', 'Badem sütü', 'Karamel şurubu', 'Vanilya şurubu', 'Fındık şurubu'])];
  const items: StockItem[] = names.map((name, i) => ({ id: `s${String(i + 1).padStart(3, '0')}`, name, unit: UNITS[name] ?? 'g', createdAt }));
  for (const e of entries) if (e.use === 'ready') items.push({ id: `h-${e.product.id}`, name: e.product.name, unit: 'piece', kind: 'product', productId: e.product.id, createdAt });
  return items;
}
/** Recipe versions: the first at `validFrom`; some products get a second version (a smaller portion) in the third year. */
export function recipes(entries: MenuEntry[], items: StockItem[], validFrom: string, change: string): Recipe[] {
  const id = new Map(items.map(i => [i.name, i.id])), out: Recipe[] = [];
  const ref = (u: Use[]): RecipeItem[] => u.map(([name, amount]) => ({ itemId: id.get(name)!, amount }));
  const rules = (groups: OptionGroup[]) => groups.flatMap(g => g.id === 'size' ? SIZE_RULES : g.id === 'milk' ? MILK_RULES : g.id === 'syrup' ? SYRUP_RULES : g.id === 'extra' ? EXTRA_RULES : g.id === 'service' ? SERVICE_RULES : [])
    .map(r => ({ ...r, ...(r.add ? { add: r.add.map(a => ({ itemId: id.get(a.itemId)!, amount: a.amount })) } : {}), ...(r.replace ? { replace: r.replace.map(x => ({ from: id.get(x.from)!, to: id.get(x.to)! })) } : {}) }))
    .filter(r => !r.replace || r.replace.every(x => x.from && x.to));
  entries.forEach((e, n) => {
    if (e.use === 'ready') { out.push({ id: `r-${e.product.id}-1`, productId: e.product.id, validFrom, items: [{ itemId: `h-${e.product.id}`, amount: 1 }], ready: true, by: 'isletme' }); return; }
    if (!e.use.length) return;
    const options = rules(e.product.groups);
    out.push({ id: `r-${e.product.id}-1`, productId: e.product.id, validFrom, items: ref(e.use), ...(options.length ? { options } : {}), by: 'isletme' });
    if (n % 5 === 0) out.push({ id: `r-${e.product.id}-2`, productId: e.product.id, validFrom: change, items: ref(e.use).map(i => ({ ...i, amount: Math.max(1, Math.round(i.amount * 0.9)) })), ...(options.length ? { options } : {}), by: 'isletme' });
  });
  return out;
}

/** Campaigns: one new every ~5 weeks, 2 to 8 weeks long, the same every run. Old ones stay in the list (owners rarely delete). */
export function campaignsUntil(firstDay: string, day: string): Campaign[] {
  const out: Campaign[] = [], kinds = ['coffee-hours', 'desserts', 'lemonade', 'breakfast', 'weekend-tost'] as const;
  const all = menu(), ids = (...names: string[]) => all.filter(e => names.includes(e.product.name)).map(e => e.product.id);
  const lemonade = ids('Limonata', 'Çilekli Limonata', 'Naneli Limonata'), breakfast = ids('Serpme Kahvaltı (2 kişilik)', 'Kahvaltı Tabağı');
  for (let d = addDays(firstDay, 20), n = 0; d <= day; d = addDays(d, 35), n++) {
    const kind = kinds[n % kinds.length], ends = addDays(d, 14 + (n % 4) * 14), startsAt = new Date(dayStart(d)).toISOString(), endsAt = new Date(dayStart(ends)).toISOString();
    const base = { id: `kampanya-${n + 1}`, startsAt, endsAt, enabled: true, combine: false };
    if (kind === 'coffee-hours') out.push({ ...base, name: 'Hafta içi kahve saati', productIds: [], categories: ['Kahveler'], schedule: { days: [1, 2, 3, 4, 5], from: '14:00', to: '17:00' }, percent: 15 });
    else if (kind === 'desserts') out.push({ ...base, name: 'Tatlılarda %10', productIds: [], categories: ['Tatlılar'], percent: 10 });
    else if (kind === 'lemonade') out.push({ ...base, name: 'Limonata 2 al %20', productIds: lemonade, minQuantity: 2, percent: 20 });
    else if (kind === 'breakfast') out.push({ ...base, name: 'Kahvaltıda 50 TL indirim', productIds: breakfast, kind: 'fixed', amount: 5000 });
    else out.push({ ...base, name: 'Hafta sonu tost', productIds: [], categories: ['Tostlar ve Sandviçler'], schedule: { days: [6, 7] }, percent: 10 });
  }
  return out;
}
/** Business days from `from` to `to` inclusive. */
export function* days(from: string, to: string) { for (let d = from; d <= to; d = addDays(d, 1)) yield d; }
export { addDays, businessDay, dayStart };
