import { Coffee, Leaf, Utensils, CakeSlice } from 'lucide-react';
import { defaultMenuHero, type MenuHero as Hero } from '../packages/domain/theme';
export function MenuHero({ name, value, en = false }: { name: string; value?: Hero; en?: boolean }) {
  const hero = value ?? defaultMenuHero;
  const Icon = { coffee: Coffee, tea: Leaf, food: Utensils, dessert: CakeSlice }[hero.icon] ?? Coffee;
  return <section className="customer-hero"><div><span className="eyebrow">{name}</span><h1 lang={en && hero.titleEn.trim() ? 'en' : 'tr'}>{en ? hero.titleEn.trim() || hero.title : hero.title}</h1><p lang={en && hero.descriptionEn.trim() ? 'en' : 'tr'}>{en ? hero.descriptionEn.trim() || hero.description : hero.description}</p></div><div className="hero-coffee" aria-hidden="true"><Icon size={116} strokeWidth={.8} /></div></section>;
}
