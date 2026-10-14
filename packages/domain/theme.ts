export const themeIds = ['sage', 'coffee', 'navy', 'burgundy', 'forest', 'olive', 'teal', 'petrol', 'blue', 'indigo', 'plum', 'rose', 'terracotta', 'copper', 'chocolate', 'graphite'] as const;
export type ThemeId = typeof themeIds[number];
export const themes: Record<ThemeId, { name: string; primary: string; hover: string; soft: string; background: string; ink: string; accent: string }> = {
  sage: { name: 'Adaçayı', primary: '#234c3e', hover: '#183b2f', soft: '#edf3ed', background: '#f6f7f4', ink: '#24382e', accent: '#b96844' },
  coffee: { name: 'Kahve · Krem', primary: '#624330', hover: '#493022', soft: '#f3ede5', background: '#faf7f2', ink: '#382d26', accent: '#a65c35' },
  navy: { name: 'Lacivert', primary: '#294660', hover: '#1e3449', soft: '#eaf0f6', background: '#f5f7fa', ink: '#263745', accent: '#97613c' },
  burgundy: { name: 'Bordo', primary: '#703c4c', hover: '#552b39', soft: '#f5ecef', background: '#faf6f7', ink: '#432e35', accent: '#9b593f' },
  forest: { name: 'Orman', primary: '#244c35', hover: '#193725', soft: '#eaf2eb', background: '#f5f8f4', ink: '#28392c', accent: '#976138' },
  olive: { name: 'Zeytin', primary: '#505728', hover: '#383e1c', soft: '#f0f1e5', background: '#f8f8f2', ink: '#343727', accent: '#97603b' },
  teal: { name: 'Turkuaz', primary: '#22605b', hover: '#174640', soft: '#e6f2ef', background: '#f3f8f7', ink: '#273c39', accent: '#a45f3f' },
  petrol: { name: 'Petrol', primary: '#285361', hover: '#1b3c47', soft: '#e8f0f3', background: '#f4f8f9', ink: '#293b42', accent: '#9b613a' },
  blue: { name: 'Mavi', primary: '#315a86', hover: '#234263', soft: '#eaf1fa', background: '#f5f8fc', ink: '#29394d', accent: '#986038' },
  indigo: { name: 'İndigo', primary: '#494979', hover: '#343458', soft: '#eeedf7', background: '#f7f6fb', ink: '#333247', accent: '#9e603e' },
  plum: { name: 'Mürdüm', primary: '#674365', hover: '#4a3049', soft: '#f3ebf3', background: '#faf6fa', ink: '#402e40', accent: '#a26042' },
  rose: { name: 'Gül kurusu', primary: '#85485b', hover: '#623443', soft: '#f8edf0', background: '#fcf7f8', ink: '#482f37', accent: '#9c5c3f' },
  terracotta: { name: 'Kiremit', primary: '#8a4935', hover: '#653425', soft: '#f7ede7', background: '#fcf8f4', ink: '#48352d', accent: '#976130' },
  copper: { name: 'Bakır', primary: '#805625', hover: '#5e3e1a', soft: '#f5efe2', background: '#faf8f2', ink: '#413629', accent: '#a45538' },
  chocolate: { name: 'Çikolata', primary: '#51372f', hover: '#38261f', soft: '#eee8e5', background: '#f8f5f2', ink: '#382e29', accent: '#a2633d' },
  graphite: { name: 'Antrasit', primary: '#414a50', hover: '#2c3338', soft: '#eceff1', background: '#f7f8f9', ink: '#30373b', accent: '#95603e' },
};

export const heroIcons = ['coffee', 'tea', 'food', 'dessert'] as const;
export type MenuHero = { title: string; description: string; titleEn: string; descriptionEn: string; icon: typeof heroIcons[number] };
export const defaultMenuHero: MenuHero = { title: 'Kendinize güzel bir mola verin.', description: 'İyi kahve, taze lezzetler. Siz favorinizi seçin, biz masanıza getirelim.', titleEn: 'Your little coffee break.', descriptionEn: 'Good coffee, fresh flavours. Pick your favourites; we’ll bring them to your table.', icon: 'coffee' };

/*
 * Each palette's own matte surfaces (14 Ekim: "the white hurts the eyes"; the palette now colours the whole page, not just its
 * buttons). A warm paper base with a little of the palette's colour mixed in: page < field < card in darkness, so cards
 * stand off the page and fields sit into the cards. Kept faint on purpose: table states, warnings and the kitchen's stage
 * colours read the same on every palette. Computed here (not with CSS color-mix) so older tablets get them too.
 */
export type Surfaces = { page: string; card: string; field: string; soft: string; line: string; selected: string; rail: string };
const hex = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
export function surfaces(theme: ThemeId): Surfaces {
  const p = (themes[theme] ?? themes.sage).primary;
  return {
    page: mix(p, '#efe9de', 0.05), card: mix(p, '#f8f5ef', 0.025), field: mix(p, '#f1ece3', 0.035), soft: mix(p, '#ebe5da', 0.06),
    line: mix(p, '#e6e0d4', 0.05), selected: mix(p, '#f4f0e8', 0.14), rail: mix(p, '#141414', 0.7),
  };
}
