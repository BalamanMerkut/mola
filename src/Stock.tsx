import { useId, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, History, BookOpenText, Boxes, Coffee, LayoutList, Package, PackageOpen, PackagePlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { Product, StaffSnapshot } from '../packages/domain/types';
import { formatAmount, perBigUnit, bigUnit, recipeUsage, type StockUnit } from '../packages/domain/stock';
import { api, ApiError, moneyError, parseMoney } from './api';
import { Modal, Notice } from './components';
import { HelpTip } from './HelpTip';
import { PillTabs } from './PillTabs';
import { Segmented } from './SettingsKit';
import { AmountInput, amountOf, draftOf, emptyAmount, LabelWithHelp, noEnter, type AmountDraft } from './StockInputs';
import { byCategory, limitText, matchText, productStatus, recipeText, unitPrice, useStock, type ItemView, type StockView } from './stockView';
import { RecipeModal, RecipesTab } from './StockRecipes';
import { EntriesTab } from './StockEntries';
import { StockHistory, StockHistoryButton } from './StockHistory';
import { PlaceLink } from './Moved';
import './stock.css';

export type StockTab = 'products' | 'items' | 'recipes' | 'entries';
/** Opens Stok on a tab; `productId` opens that product's recipe (Kârlılık → "Reçete ekle"). */
export type StockOpening = { key: number; tab: StockTab; productId?: string };
const TABS: [StockTab, string, typeof Coffee][] = [['items', 'Malzemeler', Boxes], ['recipes', 'Reçeteler', BookOpenText], ['products', 'Ürünler', Coffee], ['entries', 'Alış ve sayım', ArrowLeftRight]];

/**
 * Stok: what the menu can still be made of. The owner sees the four parts and changes everything; the kitchen reads
 * Malzemeler, Reçeteler and Ürünler and records counts and fire ("Sayım ve fire"), never money, purchases or recipes. The
 * cashier and waiters have no Stok. Nothing here is needed for selling: with nothing set up every product reads "Takip yok".
 */
export function Stock({ data, open }: { data: StaffSnapshot; open?: StockOpening }) {
  // The owner and the Müdür manage everything here; the kitchen counts and records waste.
  const owner = data.role === 'owner' || data.role === 'manager';
  const [tab, setTab] = useState<StockTab>(open?.tab ?? 'items');
  const [recipeFor, setRecipeFor] = useState<string | null>(open?.productId ?? null);
  const [itemForm, setItemForm] = useState<ItemView | 'new' | null>(null), [notice, setNoticeText] = useState(''), [noticeExpense, setNoticeExpense] = useState('');
  const setNotice = (message: string, expenseId = '') => { setNoticeText(message); setNoticeExpense(expenseId); };
  // İşlem geçmişi: every item (header) or one item (its window); the owner, the Müdür and the kitchen (its own records).
  // "Son hareketler → Tümü" opens it on every period (K-L).
  const [history, setHistory] = useState<{ itemId?: string; all?: boolean } | null>(null);
  const { view, error, reload } = useStock();
  const tabs = TABS.map(([id, label, icon]) => [id, !owner && id === 'entries' ? 'Sayım ve fire' : label, icon] as const);
  const product = recipeFor ? data.products.find(p => p.id === recipeFor) : undefined;
  const saved = (message: string, expenseId?: string) => { setNotice(message, expenseId); void reload(); };
  return <div className="stock-workspace">
    <div className="stock-top"><PillTabs label="Stok bölümleri" className="stock-tabs" value={tab} onChange={t => { setTab(t); setNotice(''); void reload(); }} items={tabs.map(([id, label, icon]) => ({ id, label, icon, ...(id === 'items' && view?.items.some(i => i.low && i.kind !== 'product') ? { badge: view.items.filter(i => i.low && i.kind !== 'product').length, badgeTone: 'warn' as const } : {}) }))} /><StockHistoryButton onClick={() => setHistory({})} /></div>
    {notice && <Notice tone="success">{notice}{noticeExpense && <PlaceLink to={{ view: 'cash', tab: 'expenses', part: 'records', focus: noticeExpense }}>Giderlerde gör</PlaceLink>}<button type="button" className="text-btn" onClick={() => setNotice('')}>Kapat</button></Notice>}
    {error && <Notice tone="error">{error}{view ? ' Son görülen bilgiler gösteriliyor.' : ''}</Notice>}
    {!view && !error && <p className="stock-loading" role="status">Stok bilgileri yükleniyor…</p>}
    {view && (tab === 'products' ? <ProductsTab data={data} view={view} onRecipe={owner ? setRecipeFor : undefined} onFirstItem={() => { setTab('items'); setItemForm('new'); }} onTab={setTab} />
      : tab === 'items' ? <ItemsTab data={data} view={view} onEdit={owner ? setItemForm : undefined} />
      : tab === 'recipes' ? <RecipesTab data={data} view={view} onOpen={owner ? setRecipeFor : undefined} onAddItem={() => { setTab('items'); setItemForm('new'); }} />
      : <EntriesTab data={data} view={view} onSaved={saved} onHistory={() => setHistory({ all: true })} />)}
    {view && itemForm && <ItemForm item={itemForm === 'new' ? undefined : itemForm} view={view} data={data} onHistory={id => { setItemForm(null); setHistory({ itemId: id }); }} onClose={() => setItemForm(null)} onSaved={message => { setItemForm(null); saved(message); }} />}
    {view && product && owner && <RecipeModal product={product} view={view} onClose={() => setRecipeFor(null)} onSaved={message => { setRecipeFor(null); saved(message); }} />}
    {history && <StockHistory itemId={history.itemId} all={history.all} onClose={() => setHistory(null)} />}
  </div>;
}

type Filter = 'all' | 'low' | 'tracked' | 'none';
function ProductsTab({ data, view, onRecipe, onFirstItem, onTab }: { data: StaffSnapshot; view: StockView; onRecipe?: (id: string) => void; onFirstItem: () => void; onTab: (t: StockTab) => void }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('all');
  const items = useMemo(() => new Map(view.items.map(i => [i.id, i])), [view.items]);
  const recipes = useMemo(() => new Map((view.recipes ?? []).map(r => [r.productId, r])), [view.recipes]);
  const state = (p: Product) => view.products[p.id];
  const tracked = data.products.filter(p => state(p) && state(p).status !== 'none'), low = tracked.filter(p => state(p).low);
  const matches = (p: Product, f: Filter) => f === 'all' || (f === 'low' ? !!state(p)?.low && state(p).status !== 'none' : f === 'tracked' ? state(p)?.status !== 'none' : !state(p) || state(p).status === 'none');
  const visible = data.products.filter(p => matches(p, filter) && (!query.trim() || matchText(`${p.name} ${p.code} ${p.category}`, query)));
  const nothing = !view.items.length;
  return <section className="stock-section" aria-label="Ürünler">
    <div className="stock-stats">
      <div><span>Takipte</span><strong>{tracked.length}</strong><small>ürün</small></div>
      <div className={low.length ? 'warn' : ''}><span>Azalan</span><strong>{low.length}</strong><small>{low.length ? 'göz atın' : 'sorun yok'}</small></div>
      <div><span>Takip yok</span><strong>{data.products.length - tracked.length}</strong><small>ürün</small></div>
    </div>
    {nothing && <div className="stock-guide">
      <span className="stock-guide-icon" aria-hidden="true"><PackageOpen size={26} /></span>
      <div><h3>Stok takibi henüz başlamadı</h3>
        <ol><li><b>Malzemeleri ekleyin:</b> kahve, süt, şeker… şu an elinizde ne kadar varsa.</li><li><b>Reçeteleri yazın:</b> bir lattede ne kadar kahve ve süt var.</li><li><b>Satın, gerisini Mola hesaplasın:</b> her satış stoğu kendiliğinden düşürür.</li></ol>
        <p className="muted small">Şişe su, kutu kola gibi hazır aldığınız ürünleri Reçeteler'de "Hazır ürün" olarak adetle takip edebilirsiniz. Stok kullanmak zorunlu değildir.</p>
        {onRecipe && <button type="button" className="btn primary" onClick={onFirstItem}><PackagePlus size={17} />İlk malzemeyi ekle</button>}</div>
    </div>}
    <div className="stock-toolbar">
      <label className="stock-search"><Search size={17} aria-hidden="true" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Ürün ara" aria-label="Stokta ürün ara" />{query && <button type="button" className="icon-btn" aria-label="Aramayı temizle" onClick={() => setQuery('')}><X size={15} /></button>}</label>
      <PillTabs kind="filter" label="Ürün stok durumu" className="stock-filter" wrapClassName="stock-filter-wrap" value={filter} onChange={setFilter} items={([['all', 'Tümü', LayoutList], ['low', 'Azalanlar', AlertTriangle], ['tracked', 'Takipte', Package], ['none', 'Takip yok', PackageOpen]] as const).map(([id, label, icon]) => ({ id, label, icon, badge: data.products.filter(p => matches(p, id)).length, ...(id === 'low' && low.length ? { badgeTone: 'warn' as const } : {}) }))} />
    </div>
    {!visible.length ? <p className="stock-empty-line">{query ? 'Aramaya uyan ürün yok.' : filter === 'low' ? 'Azalan ürün yok. Her şey yolunda.' : 'Bu seçimde ürün yok.'}</p>
      : byCategory(visible, data.categories).map(g => <section className="stock-group" key={g.name} aria-label={g.name}>
        <h3>{g.name}<span>{g.products.length}</span></h3>
        <ul className="stock-list">{g.products.map(p => {
          const v = state(p), status = productStatus(p, v, view.names), none = !v || v.status === 'none';
          const sub = none ? (p.published === false ? 'Menüde yayında değil' : '') : recipeText(recipes.get(p.id), items, view.names);
          // "Sınırlayan malzeme: Süt" ⓘ: outside the row's button (a button inside a button would open the recipe instead).
          const limiting = !none && status.limit && v.limitingId ? items.get(v.limitingId) : undefined, recipe = recipes.get(p.id);
          const limit = limiting && recipe ? <p className="stock-row-limit">Sınırlayan malzeme: <b>{status.limit}</b><HelpTip title="Sınırlayan malzeme">{limitText(p, v.makeable ?? 0, limiting, recipeUsage(recipe, '').get(limiting.id), recipe.items.length)}</HelpTip></p> : null;
          const body = <>
            <span className="stock-row-name"><strong>{p.name}</strong>{sub && <small>{sub}</small>}</span>
            <span className={`stock-row-status ${none ? 'quiet' : ''}`}>
              {none ? <span className="stock-quiet">Takip yok{onRecipe && <em><Plus size={13} aria-hidden="true" />Reçete</em>}</span>
                : <><span className="stock-row-figure"><strong>{status.value}</strong> {status.label}</span>{(v.low || status.note) && <small>{v.low && <b className="stock-chip warn">{v.empty ? 'Bitti' : 'Azalıyor'}</b>}{status.note}</small>}</>}
            </span>
          </>;
          return <li key={p.id} className={`stock-row ${v?.low && !none ? 'low' : ''} ${none ? 'untracked' : ''} ${limit ? 'limited' : ''}`}>
            {onRecipe ? <button type="button" className="stock-row-main" aria-label={`${p.name}: ${none ? 'takip yok' : `${status.value} ${status.label}`}${v?.low && !none ? ', azalıyor' : ''}`} onClick={() => onRecipe(p.id)}>{body}</button> : <div className="stock-row-main">{body}</div>}
            {limit}
          </li>;
        })}</ul>
      </section>)}
    {!nothing && <p className="stock-footnote">Hesap: son sayım + alışlar − fire − satışlar. Satışlar reçeteden düşer; iptal edilen ürünler düşmez. Rakam tutmuyorsa <button type="button" className="text-btn" onClick={() => onTab('entries')}>sayım yapın</button></p>}
  </section>;
}

function ItemsTab({ data, view, onEdit }: { data: StaffSnapshot; view: StockView; onEdit?: (item: ItemView | 'new') => void }) {
  const productName = (id: string) => data.products.find(p => p.id === id)?.name ?? '';
  const ingredients = view.items.filter(i => i.kind !== 'product').sort((a, b) => Number(b.low) - Number(a.low) || a.name.localeCompare(b.name, 'tr'));
  const ready = view.items.filter(i => i.kind === 'product').sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const card = (i: ItemView) => {
    const fill = i.min ? Math.max(0, Math.min(1, i.stock / (i.min * 3))) : null;
    const body = <>
      <div className="stock-item-head"><strong>{i.name}</strong>{i.low ? <b className="stock-chip warn">{i.empty ? 'Bitti' : 'Az kaldı'}</b> : i.empty ? <b className="stock-chip">Yok</b> : null}</div>
      <div className="stock-item-amount">{formatAmount(i.stock, i.unit)}</div>
      {fill !== null && <div className={`stock-meter ${i.low ? 'low' : ''}`} aria-hidden="true"><i style={{ width: `${fill * 100}%` }} /><span style={{ left: `${100 / 3}%` }} /></div>}
      <dl className="stock-item-facts">
        <div><dt>Uyarı sınırı</dt><dd>{i.min ? formatAmount(i.min, i.unit) : '—'}</dd></div>
        {i.unitCost !== undefined && <div><dt>Birim fiyat</dt><dd>{unitPrice(i.unitCost, i.unit) || '—'}</dd></div>}
      </dl>
      {i.hints.length > 0 && <p className="stock-hints">{i.hints.map(h => `≈ ${h.count.toLocaleString('tr-TR')} ${productName(h.productId).toLocaleLowerCase('tr')}`).join(' · ')}</p>}
    </>;
    return <li key={i.id} className={`stock-item ${i.low ? 'low' : ''}`}>{onEdit ? <button type="button" className="stock-item-main" aria-label={`${i.name}: ${formatAmount(i.stock, i.unit)}${i.low ? ', az kaldı' : ''} · düzenle`} onClick={() => onEdit(i)}>{body}<span className="stock-item-edit" aria-hidden="true"><Pencil size={14} /></span></button> : <div className="stock-item-main">{body}</div>}</li>;
  };
  return <section className="stock-section" aria-label="Malzemeler">
    <div className="stock-section-head"><div><h2>Malzemeler <span className="stock-count">{ingredients.length}</span><HelpTip title="Malzemeler">Kalan miktar: son sayım + alışlar − fire − satışlarda kullanılan. Kalan miktar "Uyarı sınırı"nın altına inince Bildirimler'e (üst çubuktaki zil) bir kez "azaldı" bildirimi gelir. Alt satırdaki "≈" rakamları, yalnız bu malzemeye bakarak en çok satan ürünlerden kaç tane daha yapılabileceğini gösterir.</HelpTip></h2><p className="muted small">Kalan miktar satışlardan kendiliğinden hesaplanır.</p></div>{onEdit && <button type="button" className="btn primary" onClick={() => onEdit('new')}><PackagePlus size={17} />Malzeme ekle</button>}</div>
    {!ingredients.length ? <div className="stock-empty"><Boxes size={28} aria-hidden="true" /><strong>Henüz malzeme yok</strong><span>Kahve, süt, şeker gibi malzemeleri ve şu an elinizdeki miktarı ekleyin.</span>{onEdit && <button type="button" className="btn primary" onClick={() => onEdit('new')}><PackagePlus size={17} />İlk malzemeyi ekle</button>}</div>
      : <ul className="stock-items">{ingredients.map(card)}</ul>}
    {ready.length > 0 && <><h3 className="stock-subhead">Hazır ürünler <span className="stock-count">{ready.length}</span></h3><ul className="stock-items">{ready.map(card)}</ul><p className="stock-footnote">Hazır ürünler Reçeteler'den açılıp kapatılır; alış ve sayımları Alış ve sayım'da. Uyarı sınırını ve fiyatını kartına dokunarak yazabilirsiniz.</p></>}
  </section>;
}

const UNITS: { value: StockUnit; label: string }[] = [{ value: 'g', label: 'Gram · kg' }, { value: 'ml', label: 'ml · Litre' }, { value: 'piece', label: 'Adet' }];
/** Add or change an ingredient: name, unit, what is on the shelf now (new only), minimum and price. */
function ItemForm({ item, view, data, onClose, onSaved, onHistory }: { item?: ItemView; view: StockView; data: StaffSnapshot; onClose: () => void; onSaved: (message: string) => void; onHistory?: (itemId: string) => void }) {
  const [name, setName] = useState(item?.name ?? ''), [unit, setUnit] = useState<StockUnit>(item?.unit ?? 'g');
  const [initial, setInitial] = useState<AmountDraft>(emptyAmount(item?.unit ?? 'g'));
  const [min, setMin] = useState<AmountDraft>(item?.min ? draftOf(item.min, item.unit) : emptyAmount(item?.unit ?? 'g'));
  const [price, setPrice] = useState(item?.unitCost !== undefined && item.unitCost !== null ? String(Math.round(perBigUnit(item.unitCost, item.unit)) / 100).replace('.', ',') : '');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(false), formId = useId();
  const ready = item?.kind === 'product';
  const changeUnit = (u: StockUnit) => { setUnit(u); setInitial(d => ({ ...emptyAmount(u), text: d.text })); setMin(d => ({ ...emptyAmount(u), text: d.text })); };
  const initialValue = initial.text.trim() ? amountOf(initial) : null, minValue = min.text.trim() ? amountOf(min) : null, priceValue = price.trim() ? parseMoney(price) : null;
  const problems = [!name.trim() && 'Malzemenin adını yazın.', Number.isNaN(initialValue) && 'Elinizdeki miktarı sayı olarak yazın.', Number.isNaN(minValue) && 'Uyarı sınırını sayı olarak yazın.', priceValue !== null && Number.isNaN(priceValue) && `Birim fiyat: ${moneyError(price, { min: 0 })}`].filter(Boolean) as string[];
  const used = item ? item.usedIn.map(id => data.products.find(p => p.id === id)?.name).filter(Boolean) : [];
  async function save() {
    if (problems.length) { setError(problems[0]); return; }
    setBusy(true); setError('');
    try {
      await api('/api/staff/stock/items', { ...(item ? { id: item.id } : {}), name: name.trim(), unit, min: minValue ?? null, unitCost: priceValue === null ? null : priceValue / bigUnit(unit).factor, ...(item ? {} : { initial: initialValue ?? 0 }) });
      onSaved(item ? `${name.trim()} güncellendi.` : `${name.trim()} eklendi.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try { await api('/api/staff/stock/items/delete', { id: item!.id }); onSaved(`${item!.name} kaldırıldı.`); }
    catch (e) { setError(e instanceof ApiError ? e.message : (e as Error).message); setConfirm(false); } finally { setBusy(false); }
  }
  const big = bigUnit(unit).label, priceId = `${formId}-price`;
  // Spoken units for the examples: "süt için 2 litre", "kilosu 900 TL".
  const per = unit === 'piece' ? 'tanesi' : unit === 'g' ? 'kilosu' : 'litresi', example = unit === 'piece' ? '5' : unit === 'g' ? '900' : '40';
  const minLine = minValue !== null && minValue > 0 ? `Kalan miktar ${formatAmount(minValue, unit)} sınırının altına inince size “Azalıyor” bildirimi gelir.` : 'İsteğe bağlı. Boş bırakırsanız uyarı gelmez.';
  return <Modal title={ready ? 'Hazır ürün' : item ? 'Malzemeyi düzenle' : 'Malzeme ekle'} className="stock-modal" onClose={() => { if (!busy) onClose(); }}>
    <form className="modal-body stock-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      {ready ? <p className="stock-ready-note"><Package size={16} aria-hidden="true" /><span><b>{item!.name}</b> hazır ürün olarak adetle takip ediliyor. Adı menüden gelir.</span></p> : <><label className="stock-field"><span className="stock-label">Malzeme adı *</span><input value={name} maxLength={60} required disabled={busy} placeholder="Örn. Süt" onChange={e => setName(e.target.value)} /></label>
      <div className="stock-field"><LabelWithHelp label="Ölçü birimi" help="Malzemeyi neyle ölçtüğünüzü seçin. Gram · kg: kahve, şeker, un. ml · Litre: süt, şurup. Adet: limon, yumurta, bardak. Reçetede küçük birimle (g, ml), alışta büyük birimle (kg, L) yazabilirsiniz; Mola çevirir." /><Segmented label="Ölçü birimi" value={unit} disabled={busy || (!!item && (item.usedIn.length > 0 || item.counted))} options={UNITS} onChange={changeUnit} /><small className="stock-hint">{unit === 'piece' ? 'Adetle sayılanlar: limon, yumurta, bardak…' : unit === 'g' ? 'Kahve, şeker, un… Reçetede gram, alışta kg yazabilirsiniz.' : 'Süt, şurup, krema… Reçetede ml, alışta litre yazabilirsiniz.'}</small></div></>}
      {!item && <AmountInput label="Şu an elinizde ne kadar var?" value={initial} unit={unit} onChange={setInitial} disabled={busy} invalid={Number.isNaN(initialValue)}
        help="Bugün rafta ve depoda olan miktar. Stok bu miktardan başlar ve her satışta reçeteye göre kendiliğinden düşer."
        hint="Bilmiyorsanız boş bırakın; sonra Alış ve sayım → Sayım yap ile yazarsınız." />}
      <AmountInput label="Uyarı sınırı" value={min} unit={unit} onChange={setMin} disabled={busy} invalid={Number.isNaN(minValue)} placeholder="Örn. 2"
        help={`Stok bu miktarın altına düşünce size “Azalıyor” bildirimi gelir (üst çubuktaki zil: Bildirimler). Örnek: süt için 2 litre, kahve için 500 gram.`}
        hint={minLine} />
      <div className="stock-field">
        <LabelWithHelp label={`Birim fiyat (TL / ${big})`} htmlFor={priceId} help={`1 ${big} için ödediğiniz para. Kârlılık raporu ürünlerin maliyetini buradan hesaplar. Alış kaydettikçe kendiliğinden güncellenir.`} />
        <input id={priceId} inputMode="decimal" value={price} disabled={busy} placeholder="İsteğe bağlı" onKeyDown={noEnter} onChange={e => setPrice(e.target.value)} aria-invalid={priceValue !== null && Number.isNaN(priceValue) || undefined} aria-describedby={`${priceId}-hint`} />
        {priceValue !== null && Number.isNaN(priceValue) ? <small className="field-error" role="alert">{moneyError(price, { min: 0 })}</small> : <small id={`${priceId}-hint`} className="stock-hint">İsteğe bağlı. Örn. {per} {example} TL ise {example} yazın.</small>}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="modal-actions stock-actions">
        {item && !ready && !confirm && <button type="button" className="btn ghost stock-delete" disabled={busy} onClick={() => setConfirm(true)}><Trash2 size={15} />Malzemeyi kaldır</button>}
        <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button>
        <button className="btn primary" disabled={busy || problems.length > 0}>{busy ? 'Kaydediliyor…' : item ? 'Kaydet' : 'Malzemeyi ekle'}</button>
      </div>
      {item && confirm && <div className="stock-confirm" role="group" aria-label="Kaldırma onayı">
        {used.length ? <p>Bu malzeme şu reçetelerde: <b>{used.join(', ')}</b>. Önce reçetelerden çıkarın.</p> : <p><b>{item.name}</b> listeden kaldırılsın mı? Geçmiş kayıtları silinmez.</p>}
        <div className="actions">{!used.length && <button type="button" className="btn delete-catalog" disabled={busy} onClick={() => void remove()}>Evet, kaldır</button>}<button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirm(false)}>Vazgeç</button></div>
      </div>}
      {item && onHistory && <button type="button" className="text-btn stock-item-history" disabled={busy} onClick={() => onHistory(item.id)}><History size={15} aria-hidden="true" />Bu malzemenin işlem geçmişi</button>}
      {view.items.length === 0 && !item && <p className="stock-hint">İpucu: önce en çok kullandığınız 5–10 malzemeyi ekleyin; gerisini zamanla tamamlarsınız.</p>}
    </form>
  </Modal>;
}
