import { Tags } from 'lucide-react';
import { categoryOfferText, type DiscountOffer } from '../packages/domain/campaigns';
import { soldByWeight, weightOffers } from '../packages/domain/lines';
import type { Product } from '../packages/domain/types';
import './campaign-offers.css';
/**
 * Category campaigns on the photo menu (guest, preview): "Tatlılarda %10 indirim" on each covered product card and, above
 * the cards, one line per campaign that covers something on screen. Product-list campaigns keep their usual look.
 * `label`: the category name the menu shows (English on the EN menu).
 */
type Label = (category: string) => string;
const categoryOffers = (p: Product) => (soldByWeight(p) ? weightOffers(p.discounts) : p.discounts)?.filter(o => o.categories?.length) ?? [];
const text = (o: DiscountOffer, en: boolean, label: Label) => categoryOfferText(o, en ? label : undefined);
export function CategoryOfferBadge({ product, en, label }: { product: Product; en: boolean; label: Label }) {
  const offers = categoryOffers(product);
  return offers.length ? <span className="category-offer-badge">{offers.map(o => text(o, en, label)).join(' · ')}</span> : null;
}
export function CategoryOfferStrip({ products, en, label }: { products: readonly Product[]; en: boolean; label: Label }) {
  const offers = new Map<string, DiscountOffer>();
  for (const p of products) for (const o of categoryOffers(p)) if (!offers.has(o.id)) offers.set(o.id, o);
  if (!offers.size) return null;
  return <ul className="category-offer-strip" aria-label={en ? 'Offers' : 'Kampanyalar'}>{[...offers.values()].map(o => <li key={o.id}><Tags size={15} strokeWidth={1.8} aria-hidden="true" /><span>{text(o, en, label)}</span>{o.remainingQuantity !== undefined && <small>{en ? `${o.remainingQuantity} left` : `${o.remainingQuantity} adet kaldı`}</small>}</li>)}</ul>;
}
