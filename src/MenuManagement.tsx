import { useEffect, useState } from 'react';
import { CircleSlash, Eye, FilePen, LayoutList, ListFilter, Pencil, Plus, Search, X } from 'lucide-react';
import type { Product, StaffSnapshot } from '../packages/domain/types';
import { api, money } from './api';
import { ProductArt } from './components';
import { DiscardProductDraft } from './DiscardProductDraft';
import { PillTabs } from './PillTabs';
import './menu-workspace.css';

type Props = { data: StaffSnapshot; onAdd: () => void; onEdit: (product: Product) => void; onCategories: () => void; onPreview: () => void; onSaved: () => Promise<void>; onError: (message: string) => void };
export function MenuManagement({ data, onAdd, onEdit, onCategories, onPreview, onSaved, onError }: Props) {
  const [search, setSearch] = useState(''), [category, setCategory] = useState(''), [status, setStatus] = useState('all');
  const draftIds = new Set(data.productDrafts?.map(p => p.id));
  const matches = (p: Product, value: string) => value === 'all' || (value === 'live' && p.published !== false) || (value === 'draft' && (p.published === false || draftIds.has(p.id))) || (value === 'soldout' && p.published !== false && p.soldOut);
  const categoryNames = [...new Set([...(data.categories ?? []), ...data.products.map(p => p.category).filter(Boolean)])];
  const selectedCategory = categoryNames.includes(category) ? category : '';
  const visible = data.products.filter(p => matches(p, status) && (!selectedCategory || p.category === selectedCategory) && `${p.name} ${p.code}`.toLocaleLowerCase('tr').includes(search.trim().toLocaleLowerCase('tr')));
  return <section className="menu-workspace" aria-label="Menü yönetimi">
    <div className="menu-toolbar" role="group" aria-label="Menü işlemleri">
      <button className="btn primary" onClick={onAdd}><Plus size={17} />Ürün ekle</button>
      <button className="btn secondary" onClick={onCategories}><ListFilter size={16} />Kategorileri yönet</button>
      <button className="btn secondary" onClick={onPreview}><Eye size={16} />Menüyü önizle</button>
      <label className="menu-search"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Ürün adı veya kodu" aria-label="Menüde ürün ara" />{search && <button className="icon-btn" aria-label="Aramayı temizle" onClick={() => setSearch('')}><X size={15} /></button>}</label>
    </div>
    <div className="menu-filterbar">
      <PillTabs kind="filter" label="Ürün durumu" className="menu-status-tabs" value={status} onChange={setStatus} items={([['all', 'Tümü', LayoutList], ['live', 'Yayında', Eye], ['draft', 'Taslaklar', FilePen], ['soldout', 'Tükendi', CircleSlash]] as const).map(([id, label, icon]) => ({ id, label, icon, badge: data.products.filter(p => matches(p, id)).length }))} />
      <select aria-label="Kategoriye göre filtrele" value={selectedCategory} onChange={e => setCategory(e.target.value)}><option value="">Tüm kategoriler</option>{categoryNames.map(c => <option key={c}>{c}</option>)}</select>
    </div>
    <div className="menu-table-heading" aria-hidden="true"><span>Ürün · {visible.length}</span><span>Fiyat</span><span>Durum</span><span>İşlemler</span></div>
    <div className="menu-list">{visible.map(p => <article className="menu-row" key={p.id}>
      <div className="menu-product-info"><ProductArt kind={p.art} photo={p.photo} alt={p.name} /><div className="menu-product-name"><h3>{p.name}</h3><small>#{p.code} · {p.category || 'Kategori seçilmedi'}{p.subtype ? ` / ${p.subtype}` : ''}</small>{draftIds.has(p.id) && <DiscardProductDraft id={p.id} revision={data.revision} onSaved={() => void onSaved()} />}</div></div>
      <strong className="menu-product-price">{money(p.price)}{p.unit === 'kg' ? ' / kg' : ''}</strong>
      <span className={`publication-badge ${p.published === false ? 'draft' : 'published'}`}>{p.published === false ? 'Taslak' : draftIds.has(p.id) ? 'Yayında · Taslak değişiklik var' : 'Yayında'}</span>
      <div className="menu-row-actions">{p.published !== false && <Availability product={p} onSaved={onSaved} onError={onError} />}<button className="btn secondary small-btn" onClick={() => onEdit({ ...(data.productDrafts?.find(d => d.id === p.id) ?? p), soldOut: p.soldOut })}><Pencil size={14} />Düzenle</button></div>
    </article>)}</div>
    {!visible.length && <div className="menu-empty"><Search size={24} /><h3>{data.products.length ? 'Bu seçimde ürün bulunamadı' : 'Menünüzü oluşturmaya başlayın'}</h3><p>{data.products.length ? 'Aramayı veya filtreleri değiştirin.' : 'İlk ürününüzü Ürün ekle düğmesiyle ekleyebilirsiniz.'}</p>{data.products.length > 0 && <button className="btn secondary" onClick={() => { setSearch(''); setCategory(''); setStatus('all'); }}>Filtreleri temizle</button>}</div>}
    <p className="menu-list-note">Tükendi olarak işaretlenen ürün görünür kalır, sipariş verilemez. Taslaklar müşteriye gösterilmez.</p>
  </section>;
}

function Availability({ product, onSaved, onError }: { product: Product; onSaved: () => Promise<void>; onError: (error: string) => void }) {
  const [checked, setChecked] = useState(product.soldOut);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!busy) setChecked(product.soldOut); }, [product.soldOut, busy]);
  async function toggle(value: boolean) {
    setChecked(value); setBusy(true);
    try { await api('/api/staff/products', { id: product.id, product: { ...product, soldOut: value } }); await onSaved(); }
    catch (e) { setChecked(product.soldOut); onError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <label className="availability"><input type="checkbox" checked={checked} disabled={busy} onChange={e => void toggle(e.target.checked)} />{busy ? 'Kaydediliyor…' : 'Tükendi'}</label>;
}
