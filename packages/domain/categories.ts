import type { State } from './types.js';
import { DomainError, requireRole, once } from './engine.js';
import type { Actor, Context } from './types.js';
export const menuCategories = (s: Pick<State, 'categories' | 'products'>) => s.categories ?? [...new Set(s.products.map(p => p.category).filter(Boolean))];
export function menuSubcategories(s: Pick<State, 'categories' | 'products' | 'subcategoryOrders' | 'subcategoryCatalog'>) {
  return menuCategories(s).map(category => {
    const current = [...new Set([...(s.subcategoryCatalog?.find(c => c.category === category)?.names ?? []), ...s.products.filter(p => p.category === category && p.subtype).map(p => p.subtype!)])];
    const saved = s.subcategoryOrders?.find(c => c.category === category)?.names ?? [];
    return { category, names: [...new Set([...saved.filter(n => current.includes(n)), ...current])] };
  });
}
/** Owner-written English names that still point at a live category / subcategory (stale ones stay stored but unused). */
export function menuNamesEn(s: Pick<State, 'categories' | 'products' | 'subcategoryOrders' | 'subcategoryCatalog' | 'categoryNamesEn'>) {
  const live = menuSubcategories(s);
  return (s.categoryNamesEn ?? []).filter(n => live.some(c => c.category === n.category && (n.subtype === undefined || c.names.includes(n.subtype))));
}
// One entry per category/subtype key: a stale entry from a subtype that later disappeared must not shadow a new one.
const setNameEn = (s: State, category: string, subtype: string | undefined, name: string) => {
  if (!s.categoryNamesEn && !name) return;
  const rest = (s.categoryNamesEn ?? []).filter(n => !(n.category === category && n.subtype === subtype));
  s.categoryNamesEn = name ? [...rest, { category, ...(subtype === undefined ? {} : { subtype }), name }] : rest;
};
export type CategoryChange = { requestId: string; revision: number; action: 'add' | 'rename' | 'remove' | 'reorder' | 'subtype-order' | 'subtype-rename' | 'subtype-remove' | 'subtype-add' | 'english'; name?: string; subtype?: string; nextName?: string; names?: string[] };
export function changeCategories(s: State, actor: Actor, b: CategoryChange, ctx: Context) {
  // 'support': Mola destek, while the owner allows it (server/support-session.ts).
  requireRole(s, actor, ['owner', 'manager', 'support']);
  return once(s, actor, 'categories', b.requestId, b, () => {
    if (b.revision !== s.menuRevision) throw new DomainError('VERSION_CONFLICT', 'Menü değişti. Pencereyi kapatıp yeniden açın.', 409);
    let names = [...menuCategories(s)];
    const key = (v: string) => v.trim().normalize('NFC').toLocaleLowerCase('tr');
    const validate = (v?: string) => {
      const name = v?.trim().normalize('NFC');
      if (!name || name.length > 60 || ['tümü', 'all'].includes(key(name))) throw new DomainError('INVALID_CATEGORY', '1–60 karakterlik kategori adı girin. Tümü ve All ayrılmış adlardır.');
      if (names.some(n => key(n) === key(name) && !(b.action === 'rename' && n === b.name))) throw new DomainError('DUPLICATE_CATEGORY', 'Bu kategori adı kullanılıyor.', 409);
      return name;
    };
    if (b.action === 'english') {
      // Empty clears the owner's name; the guest menu then falls back to the dictionary or the Turkish name.
      if (!b.name || !names.includes(b.name)) throw new DomainError('NOT_FOUND', 'Kategori bulunamadı.', 404);
      if (b.subtype !== undefined && !menuSubcategories(s).find(c => c.category === b.name)?.names.includes(b.subtype)) throw new DomainError('NOT_FOUND', 'Alt kategori bulunamadı.', 404);
      const english = (b.nextName ?? '').normalize('NFC').trim().replace(/\s+/g, ' '), max = b.subtype === undefined ? 60 : 80;
      if (english.length > max || ['all', 'all types'].includes(english.toLowerCase())) throw new DomainError('INVALID_ENGLISH_NAME', `İngilizce ad en fazla ${max} karakter olabilir. All ve All types ayrılmış adlardır.`);
      setNameEn(s, b.name, b.subtype, english);
    } else if (b.action === 'subtype-add') {
      const current = menuSubcategories(s).find(c => c.category === b.name);
      if (!current) throw new DomainError('NOT_FOUND', 'Ana kategori bulunamadı.', 404);
      const next = b.nextName?.trim().normalize('NFC');
      if (!next || next.length > 80 || ['tüm türler', 'all types'].includes(key(next))) throw new DomainError('INVALID_SUBCATEGORY', '1–80 karakterlik alt kategori adı girin.');
      if (current.names.some(n => key(n) === key(next))) throw new DomainError('DUPLICATE_SUBCATEGORY', 'Bu ana kategoride aynı adlı bir alt kategori var.', 409);
      if (current.names.length >= 100) throw new DomainError('SUBCATEGORY_LIMIT', 'Bir ana kategoride en fazla 100 alt kategori oluşturabilirsiniz.', 409);
      const catalog = s.subcategoryCatalog?.find(c => c.category === b.name)?.names ?? [];
      s.subcategoryCatalog = [...(s.subcategoryCatalog ?? []).filter(c => c.category !== b.name), { category: b.name!, names: [...catalog, next] }];
      s.subcategoryOrders = [...(s.subcategoryOrders ?? []).filter(c => c.category !== b.name), { category: b.name!, names: [...current.names, next] }];
      setNameEn(s, b.name!, next, ''); // a new subtype starts without a leftover English name
    } else if (b.action === 'subtype-rename' || b.action === 'subtype-remove') {
      const current = menuSubcategories(s).find(c => c.category === b.name);
      if (!current || !b.subtype || !current.names.includes(b.subtype)) throw new DomainError('NOT_FOUND', 'Alt kategori bulunamadı.', 404);
      const next = b.action === 'subtype-remove' ? '' : b.nextName?.trim().normalize('NFC');
      if (b.action === 'subtype-rename') {
        if (!next || next.length > 80 || ['tüm türler', 'all types'].includes(key(next))) throw new DomainError('INVALID_SUBCATEGORY', '1–80 karakterlik alt kategori adı girin.');
        if (current.names.some(n => n !== b.subtype && key(n) === key(next))) throw new DomainError('DUPLICATE_SUBCATEGORY', 'Bu ana kategoride aynı adlı bir alt kategori var.', 409);
      }
      for (const p of [...s.products, ...(s.productDrafts ?? [])]) if (p.category === b.name && p.subtype === b.subtype) p.subtype = next;
      for (const c of s.subcategoryCatalog ?? []) if (c.category === b.name) c.names = c.names.flatMap(n => n === b.subtype ? (next ? [next] : []) : [n]);
      // The English name follows the subtype: carried on rename, dropped on removal.
      const english = s.categoryNamesEn?.find(n => n.category === b.name && n.subtype === b.subtype)?.name ?? '';
      setNameEn(s, b.name!, b.subtype, '');
      if (next) setNameEn(s, b.name!, next, english);
      s.subcategoryOrders = [...(s.subcategoryOrders ?? []).filter(c => c.category !== b.name), { category: b.name!, names: current.names.flatMap(n => n === b.subtype ? (next ? [next] : []) : [n]) }];
    } else if (b.action === 'subtype-order') {
      const current = menuSubcategories(s).find(c => c.category === b.name);
      if (!current || !b.names || b.names.length !== current.names.length || new Set(b.names).size !== current.names.length || b.names.some(n => !current.names.includes(n))) throw new DomainError('INVALID_SUBCATEGORY_ORDER', 'Alt kategoriler değişti. Pencereyi kapatıp yeniden açın.', 409);
      s.subcategoryOrders = [...(s.subcategoryOrders ?? []).filter(c => c.category !== b.name), { category: b.name!, names: [...b.names] }];
    } else if (b.action === 'add') {
      if (names.length >= 40) throw new DomainError('CATEGORY_LIMIT', 'En fazla 40 kategori eklenebilir.', 409);
      const added = validate(b.name); names.push(added);
      s.categoryNamesEn = s.categoryNamesEn?.filter(n => n.category !== added);
    } else if (b.action === 'reorder') {
      if (!b.names || b.names.length !== names.length || new Set(b.names).size !== names.length || b.names.some(n => !names.includes(n))) throw new DomainError('INVALID_CATEGORY_ORDER', 'Kategori sıralaması geçersiz.');
      names = [...b.names];
    } else {
      if (!b.name || !names.includes(b.name)) throw new DomainError('NOT_FOUND', 'Kategori bulunamadı.', 404);
      if (b.action === 'remove') {
        if ([...s.products, ...(s.productDrafts ?? [])].some(p => p.category === b.name)) throw new DomainError('CATEGORY_IN_USE', 'Önce bu kategorideki ürünleri başka kategoriye taşıyın.', 409);
        if (names.length <= 1) throw new DomainError('LAST_CATEGORY', 'En az bir kategori kalmalı.', 409);
        names = names.filter(n => n !== b.name);
        s.subcategoryOrders = s.subcategoryOrders?.filter(c => c.category !== b.name);
        s.subcategoryCatalog = s.subcategoryCatalog?.filter(c => c.category !== b.name);
        s.categoryNamesEn = s.categoryNamesEn?.filter(n => n.category !== b.name);
        // A category campaign forgets the removed (already empty) category, so a later one with the same name does not join it.
        for (const c of s.campaigns ?? []) if (c.categories?.includes(b.name)) c.categories = c.categories.filter(n => n !== b.name);
      } else {
        const next = validate(b.nextName); names = names.map(n => n === b.name ? next : n);
        for (const p of [...s.products, ...(s.productDrafts ?? [])]) if (p.category === b.name) p.category = next;
        for (const c of s.subcategoryCatalog ?? []) if (c.category === b.name) c.category = next;
        for (const c of s.subcategoryOrders ?? []) if (c.category === b.name) c.category = next;
        // Category campaigns ("Tatlılarda %10") keep their category by name: the rename carries them (and their report periods).
        for (const c of [...(s.campaigns ?? []), ...(s.campaignHistory ?? [])]) if (c.categories?.includes(b.name)) c.categories = c.categories.map(n => n === b.name ? next : n);
        // Rename carries the category's and its subcategories' English names (stale ones under the new name go first).
        s.categoryNamesEn = s.categoryNamesEn?.filter(n => n.category !== next || next === b.name).map(n => n.category === b.name ? { ...n, category: next } : n);
      }
    }
    s.categories = names; s.menuRevision++;
    s.audit.push({ action: `category.${b.action}`, actor: actor.id, target: b.name ?? 'menu', at: ctx.now.toISOString() });
    return { categories: names, subcategories: menuSubcategories(s), namesEn: menuNamesEn(s), revision: s.menuRevision };
  });
}
