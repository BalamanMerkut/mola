import type { Product } from './types.js';
export function newProductIds(products: Product[], now: Date): string[] {
 const time = now.getTime(), lifetime = 30 * 24 * 60 * 60 * 1000;
 return products.filter(p => {
  const published = p.firstPublishedAt ? Date.parse(p.firstPublishedAt) : NaN;
  return p.published !== false && published <= time && time - published < lifetime;
 }).sort((a, b) => Date.parse(b.firstPublishedAt!) - Date.parse(a.firstPublishedAt!)).map(p => p.id);
}
