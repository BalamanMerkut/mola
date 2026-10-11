import type { State } from '../packages/domain/types.js';
import { seed } from './seed.js';
export function starterTemplate() {
  const base = seed('template');
  const subtype: Record<string, string> = { latte: 'Sütlü kahveler', americano: 'Sade kahveler', turkish: 'Türk kahvesi', tea: 'Demleme çay', herbal: 'Bitki çayları', lemonade: 'Limonatalar', cheesecake: 'Sütlü tatlılar', brownie: 'Çikolatalı tatlılar' };
  const products = base.products.map(p => ({ ...p, soldOut: false, published: true, subtype: subtype[p.id] }));
  const categories = ['Kahveler', 'Çaylar', 'Soğuk İçecekler', 'Tatlılar'];
  return { format: 1, name: 'Kafe başlangıç şablonu', categories, subcategories: categories.map(category => ({ category, names: [...new Set(products.filter(p => p.category === category).map(p => p.subtype))] })), products };
}
export function starterState(tenant: string, name: string): State {
  const template = starterTemplate(), state = seed(tenant);
  return { ...state, name, products: template.products, categories: template.categories, subcategoryCatalog: template.subcategories, subcategoryOrders: template.subcategories, productDrafts: [], staffUsers: [], setupCompleted: false, businessRevision: 0 };
}
