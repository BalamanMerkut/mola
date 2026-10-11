import type { MenuHero } from './theme.js';
import type { ProductArtKind } from './types.js';
import { menuLabelKey } from './menu-translation.js';

// Kind of business: chosen once in the first setup (starter menu), later only a label in Ayarlar.
// Item notes, waiter approval and masasız (counter) sales work the same in every sector.
// Browser-safe: the setup wizard, settings and the guest menu read the same names and texts.

export const sectors = ['cafe', 'restaurant', 'dessert'] as const;
export type Sector = typeof sectors[number];
export const sectorNames: Record<Sector, string> = { cafe: 'Kafe', restaurant: 'Restoran', dessert: 'Tatlıcı / Pastane' };
/** Businesses set up before sectors existed are cafés. */
export const sectorOf = (s: { sector?: Sector }): Sector => s.sector ?? 'cafe';
const slogans: Record<Sector, [string, string]> = { cafe: ['Her zaman iyi bir mola.', 'A good break, every time.'], restaurant: ['Afiyet olsun, yine bekleriz.', 'Enjoy your meal. See you again soon.'], dessert: ['Tatlı bir mola için.', 'For a sweet break.'] };
/** Customer menu footer line. */
export const sectorSlogan = (sector: Sector | undefined, en = false) => slogans[sector ?? 'cafe'][en ? 1 : 0];
/** Menu hero a new restaurant or dessert shop starts with (the café keeps the general default in theme.ts). */
export const sectorHeroes: Partial<Record<Sector, MenuHero>> = {
  restaurant: { title: 'Sofranız hazır.', description: 'Günün çorbası, ızgaralar ve ev yapımı tatlılar. Siz seçin, sıcak sıcak getirelim.', titleEn: 'Your table is ready.', descriptionEn: 'Soup of the day, grills and homemade desserts. Pick your favourites; we’ll bring them hot.', icon: 'food' },
  dessert: { title: 'Tatlı bir mola verin.', description: 'Taze baklava, günlük pastalar ve kurabiyeler. Tabakta da, kutuda da.', titleEn: 'Take a sweet break.', descriptionEn: 'Fresh baklava, daily cakes and cookies. On a plate, or boxed to take home.', icon: 'dessert' },
};

export const artKinds: readonly ProductArtKind[] = ['coffee', 'tea', 'cold', 'cake', 'food', 'soup', 'burger', 'sweet'];
// Checked in this order on the folded name (no Turkish letters, lower case): "Çorbalar" → "corbalar".
const artRules: [RegExp, ProductArtKind][] = [
  [/kahve|espresso/, 'coffee'], [/(^|\s)cay|bitki|salep/, 'tea'], [/corba/, 'soup'], [/burger/, 'burger'],
  [/baklava|kurabiye|lokum|serbetli|kuruyemis|unlu|borek|pogaca|cikolatalar/, 'sweet'],
  [/tatli|pasta|cheesecake|sutlu|dondurma|puding|muhallebi|kek|tart|brownie/, 'cake'],
  [/icecek|limonata|soguk|mesrubat|meyve suyu|smoothie|ayran|soda|kokteyl|shake|frozen|frappe|(^|\s)su($|\s)/, 'cold'],
];
/** Illustration for a new product of this category: food for anything savoury or unknown. */
export function artForCategory(category: string): ProductArtKind {
  const key = menuLabelKey(category);
  return artRules.find(([rule]) => rule.test(key))?.[1] ?? 'food';
}
