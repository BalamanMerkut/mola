import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Sector } from '../packages/domain/sector.js';
import type { CafeTable, OptionGroup, Product, State } from '../packages/domain/types.js';
import { sectorTemplate } from './sector-templates.js';

/*
 * The sales demo's business ("Mola Örnek Kafe / Restoran / Tatlıcı"): its menu, profile, logo and floor. Shared by the demo
 * generator (scripts/demo-template.ts, which then plays 30 days of history through the API) and the "Tanıtım işletmesi" reset
 * (server/demo-reset.ts), which puts a demo business back to exactly this starting point. Menu specs carry how often each
 * product sells (`kind`, `w`) for the generator; the reset only uses the product fields.
 */
// kind 'starter': soups and salads next to a main; 'box': sweets sold by weight, mostly taken home.
export type Spec = { code: string; seed?: string; unit?: 'kg'; name: string; nameEn: string; category: string; subtype?: string; price: number; description: string; ingredients?: string; art: Product['art']; groups?: OptionGroup[]; kind: 'drink' | 'food' | 'dessert' | 'starter' | 'box'; w: number; hours?: [number, number]; soldOut?: boolean; publishAgo?: number; draft?: boolean };
export const option = (id: string, name: string, extra = 0) => ({ id, name, extra });
const size = (small = -1500, large = 2500): OptionGroup => ({ preset: 'size', id: 'size', name: 'Boy', required: true, options: [option('small', 'Küçük', small), option('regular', 'Standart'), option('large', 'Büyük', large)] });
const milk: OptionGroup = { preset: 'milk', id: 'milk', name: 'Süt tercihi', required: false, options: [option('normal', 'Normal süt'), option('lactose', 'Laktozsuz süt', 1500), option('oat', 'Yulaf sütü', 3000), option('almond', 'Badem sütü', 3000)] };
const syrup: OptionGroup = { preset: 'custom', id: 'syrup', name: 'Şurup', required: false, options: [option('caramel', 'Karamel', 1500), option('vanilla', 'Vanilya', 1500), option('hazelnut', 'Fındık', 1500)] };
const sugar: OptionGroup = { preset: 'custom', id: 'sugar', name: 'Şeker tercihi', required: true, options: [option('none', 'Sade'), option('little', 'Az şekerli'), option('medium', 'Orta'), option('sweet', 'Şekerli')] };
const shot: OptionGroup = { preset: 'custom', id: 'shot', name: 'Shot', required: true, options: [option('single', 'Tek'), option('double', 'Duble', 3000)] };
const service: OptionGroup = { preset: 'service', id: 'service', name: 'Servis tercihi', required: false, options: [option('plain', 'Sade'), option('icecream', 'Dondurmalı', 3500)] };
const aroma: OptionGroup = { preset: 'custom', id: 'aroma', name: 'Aroma', required: true, options: [option('plain', 'Sade'), option('lemon', 'Limonlu', 500), option('apple', 'Elmalı', 500)] };
const extra: OptionGroup = { preset: 'custom', id: 'extra', name: 'Ekstra', required: false, options: [option('cheese', 'Kaşarlı', 3000), option('sucuk', 'Sucuklu', 5000)] };
const filling: OptionGroup = { preset: 'custom', id: 'filling', name: 'İç harcı', required: true, options: [option('cheese', 'Peynirli'), option('potato', 'Patatesli'), option('mince', 'Kıymalı', 3000)] };
export const CAFE_MENU: Spec[] = [
  { seed: 'latte', code: '17', name: 'Caffè Latte', nameEn: 'Caffè Latte', category: 'Kahveler', subtype: 'Sıcak kahveler', price: 14000, art: 'coffee', kind: 'drink', w: 8, groups: [size(), milk, syrup], description: 'Çift shot espresso ve kadifemsi süt köpüğü. Günün yumuşak molası.', ingredients: 'Espresso, süt' },
  { seed: 'americano', code: '18', name: 'Americano', nameEn: 'Americano', category: 'Kahveler', subtype: 'Sıcak kahveler', price: 11000, art: 'coffee', kind: 'drink', w: 6, groups: [size()], description: 'Çift espresso, sıcak su. Sade ve dengeli.', ingredients: 'Espresso, su' },
  { code: '23', name: 'Cappuccino', nameEn: 'Cappuccino', category: 'Kahveler', subtype: 'Sıcak kahveler', price: 13500, art: 'coffee', kind: 'drink', w: 6, groups: [size(), milk], description: 'Espresso, sıcak süt ve bol köpük; üzerine bir tutam kakao.', ingredients: 'Espresso, süt, kakao' },
  { code: '24', name: 'Caramel Macchiato', nameEn: 'Caramel Macchiato', category: 'Kahveler', subtype: 'Sıcak kahveler', price: 15500, art: 'coffee', kind: 'drink', w: 4, groups: [size(), milk], description: 'Vanilyalı süt, espresso ve ev yapımı karamel sos.', ingredients: 'Espresso, süt, vanilya şurubu, karamel sos' },
  { code: '25', name: 'Mocha', nameEn: 'Caffè Mocha', category: 'Kahveler', subtype: 'Sıcak kahveler', price: 15500, art: 'coffee', kind: 'drink', w: 3, groups: [size(), milk], description: 'Bitter çikolata, espresso ve süt. Üzeri krema ile.', ingredients: 'Espresso, süt, bitter çikolata, krema' },
  { code: '26', name: 'Espresso', nameEn: 'Espresso', category: 'Kahveler', subtype: 'Sıcak kahveler', price: 8500, art: 'coffee', kind: 'drink', w: 3, groups: [shot], description: 'Günlük kavrulmuş çekirdekten yoğun ve aromalı.', ingredients: 'Espresso' },
  { code: '27', name: 'Filtre Kahve', nameEn: 'Filter Coffee', category: 'Kahveler', subtype: 'Sıcak kahveler', price: 10000, art: 'coffee', kind: 'drink', w: 4, groups: [size(-1000, 2000), milk], description: 'Haftanın tek köken çekirdeğiyle demlenir.', ingredients: 'Filtre kahve' },
  { seed: 'turkish', code: '19', name: 'Türk Kahvesi', nameEn: 'Turkish Coffee', category: 'Kahveler', subtype: 'Türk kahvesi', price: 9500, art: 'coffee', kind: 'drink', w: 10, groups: [sugar], description: 'Közde pişer; yanında lokum ve bir bardak su.', ingredients: 'Türk kahvesi, su' },
  { code: '28', name: 'Menengiç Kahvesi', nameEn: 'Terebinth Coffee', category: 'Kahveler', subtype: 'Türk kahvesi', price: 11000, art: 'coffee', kind: 'drink', w: 4, groups: [sugar], description: 'Kavrulmuş menengiçle sütte pişirilir. Kafeinsiz.', ingredients: 'Menengiç, süt' },
  { code: '32', name: 'Iced Latte', nameEn: 'Iced Latte', category: 'Kahveler', subtype: 'Soğuk kahveler', price: 15000, art: 'cold', kind: 'drink', w: 3, groups: [size(), milk], description: 'Buz üzerine espresso ve soğuk süt.', ingredients: 'Espresso, süt, buz' },
  { code: '33', name: 'Iced Americano', nameEn: 'Iced Americano', category: 'Kahveler', subtype: 'Soğuk kahveler', price: 12500, art: 'cold', kind: 'drink', w: 2, groups: [size()], description: 'Buz ve soğuk su ile ferah bir sade kahve.', ingredients: 'Espresso, su, buz' },
  { code: '34', name: 'Cold Brew', nameEn: 'Cold Brew', category: 'Kahveler', subtype: 'Soğuk kahveler', price: 14000, art: 'cold', kind: 'drink', w: 3, description: '18 saat soğuk demleme; yumuşak, düşük asitli.', ingredients: 'Soğuk demleme kahve, buz', publishAgo: 4 },
  { seed: 'tea', code: '21', name: 'Demleme Çay', nameEn: 'Turkish Tea', category: 'Çaylar', subtype: 'Demleme', price: 3500, art: 'tea', kind: 'drink', w: 16, description: 'Rize çayı, her yarım saatte taze demlenir. İnce belli bardakta.', ingredients: 'Rize çayı' },
  { seed: 'herbal', code: '22', name: 'Ihlamur', nameEn: 'Linden Tea', category: 'Çaylar', subtype: 'Bitki çayları', price: 8500, art: 'tea', kind: 'drink', w: 2, description: 'Doğal ıhlamur, limon dilimi eşliğinde.', ingredients: 'Ihlamur, limon' },
  { code: '36', name: 'Kış Çayı', nameEn: 'Winter Tea', category: 'Çaylar', subtype: 'Bitki çayları', price: 9500, art: 'tea', kind: 'drink', w: 3, description: 'Elma, tarçın ve karanfil; soğuk akşamların favorisi.', ingredients: 'Kurutulmuş elma, tarçın, karanfil, kuşburnu' },
  { seed: 'lemonade', code: '31', name: 'Ev Yapımı Limonata', nameEn: 'Homemade Lemonade', category: 'Soğuk İçecekler', subtype: 'Limonatalar', price: 12000, art: 'cold', kind: 'drink', w: 3, description: 'Taze limon, nane ve bol ferahlık.', ingredients: 'Limon, nane, şeker, su' },
  { code: '38', name: 'Çilekli Limonata', nameEn: 'Strawberry Lemonade', category: 'Soğuk İçecekler', subtype: 'Limonatalar', price: 13500, art: 'cold', kind: 'drink', w: 2, description: 'Ev yapımı limonata, taze çilek püresiyle.', ingredients: 'Limon, çilek, nane, şeker' },
  { code: '39', name: 'Ayran', nameEn: 'Ayran', category: 'Soğuk İçecekler', subtype: 'Ayran ve soda', price: 4500, art: 'cold', kind: 'drink', w: 2, description: 'Köpüklü, yayık ayranı.', ingredients: 'Yoğurt, su, tuz' },
  { code: '40', name: 'Maden Suyu', nameEn: 'Sparkling Water', category: 'Soğuk İçecekler', subtype: 'Ayran ve soda', price: 4000, art: 'cold', kind: 'drink', w: 3, groups: [aroma], description: 'Soğuk servis edilir.' },
  { code: '41', name: 'Mango Smoothie', nameEn: 'Mango Smoothie', category: 'Soğuk İçecekler', subtype: 'Smoothie', price: 16500, art: 'cold', kind: 'drink', w: 0, description: 'Mango, muz ve yoğurt. Yaz menüsü için deneniyor.', ingredients: 'Mango, muz, yoğurt, bal', draft: true },
  { seed: 'cheesecake', code: '42', name: 'San Sebastian', nameEn: 'Basque Cheesecake', category: 'Tatlılar', subtype: 'Fırın tatlıları', price: 19000, art: 'cake', kind: 'dessert', w: 5, groups: [service], description: 'İçi yumuşak, üzeri karamelize. Çikolata sosuyla.', ingredients: 'Krem peynir, yumurta, krema, şeker' },
  { seed: 'brownie', code: '43', name: 'Çikolatalı Brownie', nameEn: 'Chocolate Brownie', category: 'Tatlılar', subtype: 'Fırın tatlıları', price: 16000, art: 'cake', kind: 'dessert', w: 3, groups: [service], description: 'Yoğun bitter çikolata ve ceviz.', ingredients: 'Bitter çikolata, tereyağı, ceviz, yumurta', soldOut: true },
  { code: '44', name: 'Tiramisu', nameEn: 'Tiramisu', category: 'Tatlılar', subtype: 'Fırın tatlıları', price: 17500, art: 'cake', kind: 'dessert', w: 3, description: 'Espresso ile ıslatılmış kedi dili, mascarpone kreması.', ingredients: 'Mascarpone, espresso, kedi dili, kakao' },
  { code: '45', name: 'Fırın Sütlaç', nameEn: 'Baked Rice Pudding', category: 'Tatlılar', subtype: 'Sütlü tatlılar', price: 12000, art: 'cake', kind: 'dessert', w: 3, description: 'Günlük süt, üzeri fırında kızarmış.', ingredients: 'Süt, pirinç, şeker, tarçın' },
  { code: '46', name: 'Muzlu Magnolia', nameEn: 'Banana Magnolia', category: 'Tatlılar', subtype: 'Sütlü tatlılar', price: 14000, art: 'cake', kind: 'dessert', w: 3, description: 'Hafif krema, bisküvi ve taze muz.', ingredients: 'Süt, krema, bisküvi, muz', publishAgo: 1 },
  { code: '47', name: 'Künefe', nameEn: 'Künefe', category: 'Tatlılar', subtype: 'Şerbetli tatlılar', price: 22000, art: 'cake', kind: 'dessert', w: 4, groups: [service], description: 'Hatay peyniriyle sıcak servis, üzeri Antep fıstığı.', ingredients: 'Tel kadayıf, künefe peyniri, tereyağı, şerbet, Antep fıstığı' },
  { code: '50', name: 'Kahvaltı Tabağı', nameEn: 'Breakfast Plate', category: 'Kahvaltı', price: 32000, art: 'cake', kind: 'food', w: 4, hours: [8, 13], description: 'Beyaz peynir, kaşar, zeytin, domates, salatalık, bal-kaymak, haşlanmış yumurta. Yanında sınırsız çay.', ingredients: 'Peynir çeşitleri, zeytin, yumurta, bal, kaymak, mevsim sebzeleri' },
  { code: '51', name: 'Menemen', nameEn: 'Menemen', category: 'Kahvaltı', price: 16000, art: 'cake', kind: 'food', w: 3, hours: [8, 14], groups: [extra], description: 'Domates, biber ve köy yumurtası; sahanda.', ingredients: 'Yumurta, domates, sivri biber, tereyağı' },
  { code: '52', name: 'Gözleme', nameEn: 'Gözleme', category: 'Kahvaltı', price: 15000, art: 'cake', kind: 'food', w: 3, hours: [8, 18], groups: [filling], description: 'Sac üzerinde el açması yufka. Yanında ayran önerilir.', ingredients: 'Yufka, iç harcı, tereyağı' },
  { code: '55', name: 'Kaşarlı Tost', nameEn: 'Cheese Toast', category: 'Atıştırmalıklar', subtype: 'Tostlar', price: 12000, art: 'cake', kind: 'food', w: 3, description: 'Bol kaşarlı, yanında turşu.', ingredients: 'Tost ekmeği, kaşar peyniri' },
  { code: '56', name: 'Karışık Tost', nameEn: 'Mixed Toast', category: 'Atıştırmalıklar', subtype: 'Tostlar', price: 15000, art: 'cake', kind: 'food', w: 3, description: 'Kaşar, sucuk ve domates.', ingredients: 'Tost ekmeği, kaşar, sucuk, domates' },
  { code: '57', name: 'Patates Kızartması', nameEn: 'French Fries', category: 'Atıştırmalıklar', subtype: 'Sıcak atıştırmalıklar', price: 11000, art: 'cake', kind: 'food', w: 2, description: 'Çıtır, baharatlı; ketçap ve mayonez ile.', ingredients: 'Patates, baharat' },
];
// Restaurant and dessert shop: the starter menu the setup loads (server/sector-templates.ts), with how often each sells,
// plus one product added during the month.
const SALES: Record<'restaurant' | 'dessert', Record<string, [Spec['kind'], number]>> = {
  restaurant: { 101: ['starter', 5], 102: ['starter', 3], 103: ['starter', 2], 201: ['food', 6], 202: ['food', 5], 203: ['food', 5], 204: ['food', 3], 205: ['food', 3], 301: ['food', 5], 302: ['food', 4], 303: ['food', 3], 401: ['starter', 3], 402: ['food', 2], 501: ['dessert', 3], 502: ['dessert', 4], 601: ['drink', 6], 602: ['drink', 5], 603: ['drink', 4], 604: ['drink', 6], 605: ['drink', 3] },
  dessert: { 101: ['box', 8], 102: ['box', 5], 103: ['box', 4], 104: ['dessert', 6], 201: ['dessert', 3], 202: ['dessert', 4], 203: ['dessert', 4], 301: ['dessert', 4], 302: ['dessert', 4], 303: ['box', 1], 401: ['box', 3], 402: ['box', 3], 403: ['box', 2], 501: ['box', 3], 502: ['box', 2], 601: ['drink', 8], 602: ['drink', 4], 603: ['drink', 2], 604: ['drink', 2] },
};
/** Every product of the sector's demo menu: the café's own list, the restaurant's and dessert shop's starter menu plus one. */
export function demoMenu(sector: Sector): Spec[] {
  if (sector === 'cafe') return CAFE_MENU;
  const sales = SALES[sector];
  return [
    ...sectorTemplate(sector).products.map(p => ({ code: p.code, seed: p.id, ...(p.unit === 'kg' ? { unit: 'kg' as const } : {}), name: p.name, nameEn: p.nameEn, category: p.category, subtype: p.subtype, price: p.price, description: p.description, ingredients: p.ingredients, art: p.art, groups: p.groups, kind: sales[p.code]?.[0] ?? 'food', w: sales[p.code]?.[1] ?? 1 })),
    ...(sector === 'restaurant'
      ? [{ code: '304', name: 'Acılı Burger', nameEn: 'Spicy Burger', category: 'Burgerler', price: 34000, art: 'burger', kind: 'food', w: 3, groups: [{ preset: 'custom', id: 'doneness', name: 'Pişme derecesi', required: true, options: [option('medium', 'Orta'), option('well', 'İyi pişmiş')] }], description: 'Jalapeño, acı sos ve cheddar; patates ile.', ingredients: 'Dana köfte, jalapeño, cheddar, brioche ekmek', publishAgo: 4 } as Spec]
      : [{ code: '204', name: 'Supangle', nameEn: 'Chocolate Pudding', category: 'Sütlü Tatlılar', price: 12000, art: 'cake', kind: 'dessert', w: 3, description: 'Yoğun kakaolu, kek tabanlı.', ingredients: 'Süt, kakao, kek', publishAgo: 3 } as Spec]),
  ];
}
/** Café menu order (categories and their subtypes); the other sectors keep their starter template's order. */
export const CAFE_CATEGORIES = ['Kahveler', 'Çaylar', 'Soğuk İçecekler', 'Tatlılar', 'Kahvaltı', 'Atıştırmalıklar'];
export const CAFE_SUBTYPES: Record<string, string[]> = { Kahveler: ['Sıcak kahveler', 'Soğuk kahveler', 'Türk kahvesi'], Tatlılar: ['Fırın tatlıları', 'Sütlü tatlılar', 'Şerbetli tatlılar'] };

export type DemoProfile = { name: string; theme: string; googleReviewUrl: string; menuHero: { title: string; description: string; titleEn: string; descriptionEn: string; icon: 'coffee' | 'food' | 'dessert' }; logoSvg: string };
export const DEMO_PROFILES: Record<Sector, DemoProfile> = {
  cafe: { name: 'Mola Örnek Kafe', theme: 'coffee', googleReviewUrl: 'https://g.page/r/mola-ornek-kafe/review',
    menuHero: { title: 'Elazığ’da güzel bir mola.', description: 'Taze demlenmiş çay, özenle hazırlanan kahveler ve ev yapımı tatlılar. Siz seçin, masanıza getirelim.', titleEn: 'A proper break in Elazığ.', descriptionEn: 'Freshly brewed tea, carefully made coffee and homemade desserts. Pick your favourites; we’ll bring them to your table.', icon: 'coffee' },
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><circle cx="128" cy="128" r="124" fill="#624330"/><circle cx="128" cy="128" r="106" fill="none" stroke="#f3ede5" stroke-width="4" opacity=".45"/><path d="M78 112h86v34c0 26-19 44-43 44s-43-18-43-44z" fill="#f3ede5"/><path d="M164 122h10a18 18 0 0 1 0 36h-12" fill="none" stroke="#f3ede5" stroke-width="10"/><path d="M98 96c-8-10 8-18 0-30M121 96c-8-10 8-18 0-30M144 96c-8-10 8-18 0-30" fill="none" stroke="#e0b48a" stroke-width="7" stroke-linecap="round"/><rect x="70" y="198" width="104" height="9" rx="4.5" fill="#e0b48a"/></svg>` },
  // Restaurant: crossed fork and knife on terracotta; dessert shop: a slice of cake on rose.
  restaurant: { name: 'Mola Örnek Restoran', theme: 'terracotta', googleReviewUrl: 'https://g.page/r/mola-ornek-restoran/review',
    menuHero: { title: 'Elazığ’da ocakbaşı keyfi.', description: 'Günün çorbası, közde kebaplar ve ev yapımı tatlılar. Dilerseniz siparişinizi yanınızda götürebilirsiniz.', titleEn: 'Grill house in Elazığ.', descriptionEn: 'Soup of the day, charcoal kebabs and homemade desserts. We also pack orders to take away.', icon: 'food' },
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><circle cx="128" cy="128" r="124" fill="#8a4935"/><circle cx="128" cy="128" r="106" fill="none" stroke="#f7ede7" stroke-width="4" opacity=".45"/><path d="M84 76l88 104M172 76l-88 104" stroke="#f7ede7" stroke-width="12" stroke-linecap="round"/><path d="M76 70v26M88 64v30M100 70v26" stroke="#e8b48f" stroke-width="7" stroke-linecap="round"/></svg>` },
  dessert: { name: 'Mola Örnek Tatlıcı', theme: 'rose', googleReviewUrl: 'https://g.page/r/mola-ornek-tatlici/review',
    menuHero: { title: 'Elazığ’ın tatlı molası.', description: 'Günlük baklava, taze pastalar, kiloyla kurabiye ve lokum. Hediye kutusunda paketliyoruz.', titleEn: 'A sweet break in Elazığ.', descriptionEn: 'Fresh baklava, cakes, cookies and Turkish delight by the kilo. Gift-boxed to take away.', icon: 'dessert' },
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><circle cx="128" cy="128" r="124" fill="#85485b"/><circle cx="128" cy="128" r="106" fill="none" stroke="#f8edf0" stroke-width="4" opacity=".45"/><path d="M70 170V128l116-36v78z" fill="#f8edf0"/><path d="M70 146l116-30" stroke="#e7a9b8" stroke-width="9"/><circle cx="150" cy="86" r="10" fill="#e7a9b8"/></svg>` },
};
/** The logo as the business profile keeps it (WebP data URL, like server/business-profile.ts shrinkLogo). */
export async function demoLogo(sector: Sector) {
  const data = await sharp(Buffer.from(DEMO_PROFILES[sector].logoSvg)).resize(256, 256, { fit: 'inside' }).webp({ quality: 80 }).toBuffer();
  return `data:image/webp;base64,${data.toString('base64')}`;
}
/** The demo floor: 8 tables "İç salon", 4 "Bahçe", 4 "Teras" (16), each with a new id and a new QR token. */
export const DEMO_AREAS = [...Array(8).fill('İç salon'), ...Array(4).fill('Bahçe'), ...Array(4).fill('Teras')] as string[];
export function demoTables(): CafeTable[] {
  return DEMO_AREAS.map((area, i) => ({ id: randomUUID(), name: `Masa ${String(i + 1).padStart(2, '0')}`, token: randomBytes(18).toString('base64url'), epoch: 0, accountId: null, area }));
}
/** The menu as products (published ones; drafts and "later" products of the generator are left out; none marked "Yeni"). */
export function demoProducts(sector: Sector): Product[] {
  return demoMenu(sector).filter(s => !s.draft && !s.publishAgo).map(s => ({ id: s.seed ?? randomUUID(), code: s.code, ...(s.unit ? { unit: s.unit } : {}), name: s.name, nameEn: s.nameEn, category: s.category, ...(s.subtype ? { subtype: s.subtype } : {}), description: s.description, ...(s.ingredients ? { ingredients: s.ingredients } : {}), price: s.price, soldOut: !!s.soldOut, art: s.art, groups: structuredClone(s.groups ?? []), published: true }));
}
/** Categories and subtype order of the demo menu (State.categories, subcategoryCatalog/Orders). */
export function demoCatalog(sector: Sector, products: Product[]): Pick<State, 'categories' | 'subcategoryCatalog' | 'subcategoryOrders'> {
  const categories = sector === 'cafe' ? CAFE_CATEGORIES : sectorTemplate(sector).categories;
  const subcategories = categories.map(category => ({ category, names: sector === 'cafe' && CAFE_SUBTYPES[category] ? CAFE_SUBTYPES[category] : [...new Set(products.filter(p => p.category === category && p.subtype).map(p => p.subtype!))] }));
  return { categories, subcategoryCatalog: subcategories, subcategoryOrders: subcategories };
}
