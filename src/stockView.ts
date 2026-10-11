import { useCallback, useEffect, useState } from 'react';
import type { Product } from '../packages/domain/types';
import { formatWeight } from '../packages/domain/lines';
import { formatAmount, perBigUnit, bigUnit, type ProductStock, type Recipe, type StockEntry, type StockUnit } from '../packages/domain/stock';
import { api, money } from './api';

/** One item as GET /api/staff/stock gives it (server/stock.ts); money only for the owner. */
export type ItemView = {
  id: string; name: string; unit: StockUnit; min: number | null; kind: 'ingredient' | 'product'; productId?: string; createdAt: string;
  stock: number; low: boolean; empty: boolean; counted: boolean; since: string; usedIn: string[]; hints: { productId: string; count: number }[];
  unitCost?: number | null; lastPurchase?: { at: string; quantity?: number; total?: number; supplier?: string } | null;
};
export type ProductView = ProductStock & { cost?: number | null; missing?: string[] };
export type StockView = { canEdit: boolean; canCount?: boolean; /** Owner: each product's "Düşük kâr" line (null: the warning is off). */ thresholds?: Record<string, number | null>; now: string; items: ItemView[]; products: Record<string, ProductView>; names: Record<string, string>; recipes?: Recipe[]; entries?: StockEntry[]; /** The last records taken back ("Geri alınanlar"), newest first. */ undone?: StockEntry[] };

/** The whole stock picture; read again every 30 s while the screen is visible and after every change. */
export function useStock(active = true) {
  const [view, setView] = useState<StockView | null>(null), [error, setError] = useState('');
  const reload = useCallback(async () => { try { setView(await api<StockView>('/api/staff/stock')); setError(''); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => {
    if (!active) return;
    void reload();
    const t = setInterval(() => { if (!document.hidden) void reload(); }, 30000);
    return () => clearInterval(t);
  }, [active, reload]);
  return { view, error, reload };
}

const lower = (v: string) => v.toLocaleLowerCase('tr');
/**
 * "≈ 133 adet yapılabilir", "≈ 4,5 kg yapılabilir", "48 adet kaldı" or "Takip yok". `limit`: the item that runs out first
 * ("Sınırlayan malzeme: Süt"; 8 Ekim: "süt yüzünden" was not understood).
 */
export function productStatus(p: Pick<Product, 'unit'>, v: ProductView | undefined, names: Record<string, string>) {
  if (!v || v.status === 'none') return { value: 'Takip yok', label: '', note: '', limit: '' };
  if (v.status === 'ready') return { value: `${(v.stock ?? 0).toLocaleString('tr-TR')}`, label: 'adet kaldı', note: v.empty ? 'Bitti' : '', limit: '' };
  const n = v.makeable ?? 0;
  const value = p.unit === 'kg' ? `≈ ${formatWeight(Math.round(n * 1000))}` : `≈ ${n.toLocaleString('tr-TR')}`;
  return { value, label: p.unit === 'kg' ? 'yapılabilir' : 'adet yapılabilir', note: '', limit: v.limitingId && names[v.limitingId] ? names[v.limitingId] : '' };
}
/**
 * The ⓘ beside "Sınırlayan malzeme": "Bu üründen en fazla 200 adet yapılabilir; çünkü tarifindeki malzemeler arasında en önce
 * süt bitecek (stok: 50 L, ürün başına 250 ml)." `amount`: the item in one plain product (no option chosen).
 */
export function limitText(p: Pick<Product, 'unit'>, makeable: number, item: { name: string; stock: number; unit: StockUnit }, amount: number | undefined, ingredients: number) {
  const most = p.unit === 'kg' ? formatWeight(Math.round(makeable * 1000)) : `${makeable.toLocaleString('tr-TR')} adet`;
  const facts = `stok: ${formatAmount(Math.max(0, item.stock), item.unit)}${amount ? `, ürün başına ${formatAmount(amount, item.unit)}` : ''}`;
  return ingredients > 1
    ? `Bu üründen en fazla ${most} yapılabilir; çünkü tarifindeki malzemeler arasında en önce ${lower(item.name)} bitecek (${facts}).`
    : `Bu üründen en fazla ${most} yapılabilir; tarifindeki ${lower(item.name)} ancak bu kadarına yetiyor (${facts}).`;
}
/** "Kahve 18 g · Süt 200 ml" */
export function recipeText(r: Recipe | undefined, items: Map<string, { name: string; unit: StockUnit }>, names: Record<string, string>) {
  if (!r?.items.length) return '';
  if (r.ready) return 'Hazır ürün · adet stoklu';
  return r.items.map(i => { const it = items.get(i.itemId); return `${it?.name ?? names[i.itemId] ?? 'Silinmiş malzeme'} ${it ? formatAmount(i.amount, it.unit) : i.amount}`; }).join(' · ');
}
/** "₺450 / kg" */
export const unitPrice = (unitCost: number | null | undefined, unit: StockUnit) => unitCost === null || unitCost === undefined ? '' : `${money(Math.round(perBigUnit(unitCost, unit)))} / ${bigUnit(unit).label}`;
/** Products in menu order: categories as the menu lists them, then the rest. */
export function byCategory(products: readonly Product[], order: readonly string[]) {
  const names = [...new Set([...order, ...products.map(p => p.category || 'Diğer')])];
  return names.map(name => ({ name, products: products.filter(p => (p.category || 'Diğer') === name) })).filter(g => g.products.length);
}
export const matchText = (text: string, query: string) => lower(text).includes(lower(query.trim()));
