import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Pencil } from 'lucide-react';
import type { StaffSnapshot } from '../packages/domain/types';
import { api, ApiError, requestId } from './api';
import { Modal, Notice } from './components';
import { menuLabelSuggestion, type MenuNameEn } from '../packages/domain/menu-translation';

/*
 * Menü → Kategorileri yönet. 13 Ekim tanıtım: the order (the guest menu's tabs) was hidden among five buttons per row. Now
 * the order comes first: a preview of the tabs as guests see them, rows moved by dragging or ↑↓, one "Sırayı kaydet". Name,
 * English name, sub-categories and delete sit behind each row's "Düzenle".
 */
export function CategoryManagement({ data, onClose, onSaved }: { data: StaffSnapshot; onClose: () => void; onSaved: () => void }) {
  const [subcategories, setSubcategories] = useState(data.subcategories);
  const [names, setNames] = useState(data.categories); const [revision, setRevision] = useState(data.revision);
  // The order being arranged (saved with "Sırayı kaydet"); `names` is what the server has.
  const [order, setOrder] = useState(data.categories), [dragging, setDragging] = useState<string | null>(null), [moved, setMoved] = useState<string | null>(null);
  const [newName, setNewName] = useState(''); const [renaming, setRenaming] = useState<string | null>(null); const [nextName, setNextName] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [subEdit, setSubEdit] = useState<{ category: string; name: string; removing: boolean } | null>(null);
  const [subNew, setSubNew] = useState<Record<string, string>>({});
  const [subName, setSubName] = useState('');
  const [namesEn, setNamesEn] = useState<MenuNameEn[]>(data.categoryNamesEn ?? []);
  const [english, setEnglish] = useState<{ category: string; subtype?: string } | null>(null); const [englishName, setEnglishName] = useState('');
  const [error, setError] = useState(''); const [saved, setSaved] = useState(''); const [busy, setBusy] = useState(false); const [uncertain, setUncertain] = useState(false);
  const pending = useRef<unknown>(null);
  async function save(change?: object, done?: string) {
    if (busy) return;
    pending.current ??= { requestId: requestId(), revision, ...change }; setBusy(true); setError(''); setSaved('');
    try {
      const r = await api<{ categories: string[]; subcategories: StaffSnapshot['subcategories']; namesEn: MenuNameEn[]; revision: number }>('/api/staff/categories', pending.current);
      setNames(r.categories); setOrder(r.categories); setSubcategories(r.subcategories); setNamesEn(r.namesEn); setEnglish(null); setRevision(r.revision); setNewName(''); setRenaming(null); setSubEdit(null); setSubNew({}); setUncertain(false); pending.current = null; setMoved(null);
      if (done) setSaved(done);
      onSaved();
    }
    catch (e) { const unknown = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(unknown); if (!unknown) pending.current = null; setError(unknown ? 'Sonuç alınamadı. Aynı işlemi tekrar kontrol edin.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  const changed = order.join('\n') !== names.join('\n');
  function move(name: string, to: number) { setOrder(list => { const from = list.indexOf(name); if (from < 0 || to < 0 || to >= list.length || from === to) return list; const next = [...list]; next.splice(from, 1); next.splice(to, 0, name); return next; }); setMoved(name); setSaved(''); }
  const disabled = busy || uncertain;
  // Guests on the English menu see the owner's name, else the dictionary suggestion, else the Turkish name.
  const ownEn = (category: string, subtype?: string) => namesEn.find(n => n.category === category && n.subtype === subtype)?.name ?? '';
  const englishInfo = (category: string, subtype?: string) => { const own = ownEn(category, subtype), auto = menuLabelSuggestion(subtype ?? category); return own ? 'İngilizce: ' + own : auto ? 'İngilizce: ' + auto + ' (otomatik)' : 'İngilizce adı yok; Türkçe adı gösterilir'; };
  const openEnglish = (category: string, subtype?: string) => { setRenaming(null); setSubEdit(null); setEnglish({ category, subtype }); setEnglishName(ownEn(category, subtype)); };
  const englishPanel = (category: string, subtype?: string) => { if (english?.category !== category || english.subtype !== subtype) return null; const auto = menuLabelSuggestion(subtype ?? category);
    return <div className={subtype === undefined ? 'category-rename category-english' : 'subcategory-edit'}><label>İngilizce adı<input aria-label={subtype === undefined ? 'Kategori İngilizce adı' : 'Alt kategori İngilizce adı'} maxLength={subtype === undefined ? 60 : 80} disabled={disabled} value={englishName} placeholder={auto ?? 'Örn. Breakfast'} onChange={e => setEnglishName(e.target.value)} /></label><button className="btn primary small-btn" disabled={disabled} onClick={() => void save({ action: 'english', name: category, ...(subtype === undefined ? {} : { subtype }), nextName: englishName })}>İngilizce adı kaydet</button><button className="text-btn" disabled={disabled} onClick={() => setEnglish(null)}>Vazgeç</button><p className="muted small">Boş bırakırsanız müşteriye {auto ? 'otomatik çeviri (' + auto + ')' : 'Türkçe adı'} gösterilir.</p></div>; };
  const subcats = (name: string) => subcategories.find(c => c.category === name)?.names ?? [];
  return <Modal title="Kategorileri yönet" wide onClose={() => { if (!disabled) onClose(); }}><div className="modal-body category-manager">
    <section className="category-preview" aria-label="Müşteri menüsünde sıra">
      <p className="muted small">Müşteri menüde sekmeleri bu sırayla görür:</p>
      <div className="category-preview-tabs">{order.map(name => <span key={name} className={name === moved ? 'moved' : ''}>{name}</span>)}</div>
    </section>
    <p className="muted small">Sırayı değiştirmek için satırları sürükleyin ya da ↑ ↓ düğmelerini kullanın, sonra <strong>Sırayı kaydet</strong>e basın.</p>
    {error && <Notice tone="error">{error}</Notice>}{saved && <Notice tone="success">{saved}</Notice>}{uncertain && <button className="btn primary" disabled={busy} onClick={() => void save()}>İşlemi yeniden kontrol et</button>}
    <ol className="category-order-list">{order.map((name, i) => { const count = data.products.filter(p => p.category === name).length; const subs = subcats(name);
      return <li key={name} className={`category-order-row${dragging === name ? ' dragging' : ''}${moved === name ? ' moved' : ''}`} draggable={!disabled && open !== name}
        onDragStart={e => { setDragging(name); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', name); }} onDragEnd={() => setDragging(null)}
        onDragOver={e => { if (!dragging || dragging === name) return; e.preventDefault(); move(dragging, i); }}>
        <div className="category-order-main">
          <span className="category-grip" aria-hidden="true"><GripVertical size={18} /></span>
          <span className="category-order-number">{i + 1}</span>
          <div className="grow"><strong>{name}</strong><small className="muted">{count} ürün{subs.length ? ` · ${subs.length} alt kategori` : ''}</small></div>
          <button type="button" className="icon-btn" disabled={disabled || i === 0} aria-label={`${name} yukarı`} onClick={() => move(name, i - 1)}><ArrowUp size={17} /></button>
          <button type="button" className="icon-btn" disabled={disabled || i === order.length - 1} aria-label={`${name} aşağı`} onClick={() => move(name, i + 1)}><ArrowDown size={17} /></button>
          <button type="button" className="btn secondary small-btn" aria-expanded={open === name} disabled={disabled} onClick={() => { setOpen(o => o === name ? null : name); setEnglish(null); setRenaming(null); }}><Pencil size={14} aria-hidden="true" />Düzenle</button>
        </div>
        {open === name && <div className="category-order-edit">
          <p className="muted small">{englishInfo(name)}</p>
          <div className="category-edit-actions"><button className="btn secondary small-btn" disabled={disabled} onClick={() => { setEnglish(null); setRenaming(name); setNextName(name); }}>Adını değiştir</button><button className="btn secondary small-btn" disabled={disabled} onClick={() => openEnglish(name)}>İngilizce adı</button><button className="text-btn danger-text" disabled={disabled || count > 0 || names.length <= 1} title={count ? 'Önce ürünleri başka kategoriye taşıyın.' : 'Boş kategoriyi sil'} onClick={() => void save({ action: 'remove', name }, `“${name}” silindi.`)}>Sil{count ? ' (önce ürünleri taşıyın)' : ''}</button></div>
          {renaming === name && <div className="category-rename"><label>Yeni ad<input aria-label="Kategori yeni adı" maxLength={60} disabled={disabled} value={nextName} onChange={e => setNextName(e.target.value)} /></label><button className="btn primary small-btn" disabled={disabled || !nextName.trim()} onClick={() => void save({ action: 'rename', name, nextName })}>Adı kaydet</button><button className="text-btn" disabled={disabled} onClick={() => setRenaming(null)}>Vazgeç</button></div>}
          {englishPanel(name)}
          <details className="subcategory-management"><summary>Alt kategoriler ({subs.length})</summary><p className="muted small">Ad değişikliği bu alt kategorideki bütün ürünlere uygulanır. Kaldırılan alt kategorinin ürünleri ana kategoride kalır.</p>
            <div className="category-create"><label>Yeni alt kategori adı<input aria-label={name + ' yeni alt kategori adı'} maxLength={80} disabled={disabled} value={subNew[name] ?? ''} onChange={e => setSubNew(v => ({ ...v, [name]: e.target.value }))} /></label><button className="btn primary small-btn" disabled={disabled || !(subNew[name] ?? '').trim()} onClick={() => void save({ action: 'subtype-add', name, nextName: subNew[name] })}>Alt kategori ekle</button></div>
            {subs.map((sub, index, all) => <div className="subcategory-manage-row" key={sub}><div className="grow"><span>{sub}</span><small className="muted subcategory-english">{englishInfo(name, sub)}</small></div>{[-1, 1].map(offset => <button key={offset} className="icon-btn" disabled={disabled || index + offset < 0 || index + offset >= all.length} aria-label={name + ' / ' + sub + (offset < 0 ? ' yukarı' : ' aşağı')} onClick={() => { const ordered = [...all]; [ordered[index], ordered[index + offset]] = [ordered[index + offset], ordered[index]]; void save({ action: 'subtype-order', name, names: ordered }); }}>{offset < 0 ? <ArrowUp size={15} /> : <ArrowDown size={15} />}</button>)}<button className="btn secondary small-btn" disabled={disabled} onClick={() => { setEnglish(null); setSubEdit({ category: name, name: sub, removing: false }); setSubName(sub); }}>Düzenle</button><button className="btn secondary small-btn" disabled={disabled} onClick={() => openEnglish(name, sub)}>İngilizce adı</button><button className="text-btn" disabled={disabled} onClick={() => { setEnglish(null); setSubEdit({ category: name, name: sub, removing: true }); }}>Kaldır</button>{subEdit?.category === name && subEdit.name === sub && <div className="subcategory-edit">{subEdit.removing ? <p>“{sub}” alt kategorisi kaldırılsın mı? Ürünler silinmez.</p> : <label>Alt kategori adı<input aria-label="Alt kategori yeni adı" value={subName} maxLength={80} disabled={disabled} onChange={e => setSubName(e.target.value)} /></label>}<button className="btn primary small-btn" disabled={disabled || (!subEdit.removing && !subName.trim())} onClick={() => void save({ action: subEdit.removing ? 'subtype-remove' : 'subtype-rename', name, subtype: sub, nextName: subName })}>{subEdit.removing ? 'Alt kategoriyi kaldır' : 'Alt kategori adını kaydet'}</button><button className="text-btn" disabled={disabled} onClick={() => setSubEdit(null)}>Vazgeç</button></div>}{englishPanel(name, sub)}</div>)}
          </details>
        </div>}
      </li>; })}</ol>
    {changed && <div className="category-order-save"><span>Sıra değişti.</span><button type="button" className="btn secondary small-btn" disabled={disabled} onClick={() => { setOrder(names); setMoved(null); }}>Geri al</button><button type="button" className="btn primary" disabled={disabled} onClick={() => void save({ action: 'reorder', names: order }, 'Sıra kaydedildi. Müşteri menüsü bu sırayla açılır.')}>{busy ? 'Kaydediliyor…' : 'Sırayı kaydet'}</button></div>}
    <div className="category-create"><label>Yeni kategori adı<input aria-label="Yeni kategori adı" maxLength={60} value={newName} disabled={disabled || changed} onChange={e => setNewName(e.target.value)} placeholder="Örn. Sıcak içecekler" /></label><button className="btn primary" disabled={disabled || changed || !newName.trim()} onClick={() => void save({ action: 'add', name: newName }, 'Kategori eklendi; en sona kondu, yerini yukarıdan ayarlayabilirsiniz.')}>Kategori ekle</button></div>
    <p className="muted small">Dolu kategori silinemez; ürünleri ürün düzenleme ekranından başka kategoriye taşıyabilirsiniz.</p>
  </div></Modal>;
}
