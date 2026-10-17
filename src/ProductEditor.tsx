import { LockedRow, usePackage } from './FeatureLock';
import { CropControl } from './CropControl';
import { DeleteCatalogItem } from './DeleteCatalogItem';
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type FormEvent } from 'react';
import { ImagePlus, Plus, Trash2, Check } from 'lucide-react';
import type { Product, OptionGroup } from '../packages/domain/types';
import { api, ApiError, parseMoney, parseAdjustment, requestId } from './api';
import { Modal, Notice, ProductArt, ProductDialog } from './components';
import { HelpTip } from './HelpTip';
import { PlaceLink } from './Moved';
import { artForCategory } from '../packages/domain/sector';
import { optionLabelSuggestion } from '../packages/domain/menu-translation';
import { DEFAULT_VAT, productVat, suggestVat, vatSettings, type VatSettings } from '../packages/domain/vat';
import { CROP_BYTES, encodePhoto, preparePhoto, sizeOf, SOURCE_BYTES, SOURCE_SIDE, type PhotoSource } from './photoPrep';
import './menu-workspace.css';
import './vat.css';
// "Reçete": the Stok recipe of this product (src/StockRecipes.tsx), loaded only when the section is opened.
const RecipeSection = lazy(() => import('./StockRecipes'));


const kinds: Record<string, string[]> = { Kahveler: ['Espresso bazlı', 'Filtre kahve', 'Türk kahvesi'], Çaylar: ['Demleme', 'Bitki çayı', 'Meyve çayı'], 'Soğuk İçecekler': ['Limonata', 'Meyve suyu', 'Gazlı içecek'], Tatlılar: ['Sütlü', 'Şerbetli', 'Çikolatalı', 'Meyveli'] };
type DraftGroup = Omit<OptionGroup, 'options'> & { options: { id: string; name: string; nameEn?: string; extra: string }[] };
export const ProductEditor = memo(function ProductEditor({ initial, liveProduct, nextCode, revision, categoriesKey, subcategoriesKey = '[]', onClose, onSave, onDelete }: { subcategoriesKey?: string; categoriesKey: string; initial: Product | null; liveProduct?: Product; nextCode: string; revision: number; onClose: () => void; onDelete: () => void; onSave: (published: boolean) => void }) {
  const subcategories = useMemo(() => JSON.parse(subcategoriesKey) as { category: string; names: string[] }[], [subcategoriesKey]);
  const categories = useMemo(() => JSON.parse(categoriesKey) as string[], [categoriesKey]);
  const [form, setForm] = useState({ code: initial?.code ?? nextCode, name: initial?.name ?? '', nameEn: initial?.nameEn ?? '', category: initial?.category ?? '', subtype: initial?.subtype ?? '', ingredients: initial?.ingredients ?? '', description: initial?.description ?? '', descriptionEn: initial?.descriptionEn ?? '', ingredientsEn: initial?.ingredientsEn ?? '', price: initial ? String(initial.price / 100) : '', soldOut: initial?.soldOut ?? false, readyMade: initial?.readyMade ?? false, unit: (initial?.unit === 'kg' ? 'kg' : 'piece') as 'piece' | 'kg' });
  const [groups, setGroups] = useState<DraftGroup[]>(() => (initial?.groups ?? []).map(g => ({ ...g, preset: g.preset ?? ({ boy: 'size', 'süt tercihi': 'milk', 'servis tercihi': 'service' } as Record<string, OptionGroup['preset']>)[g.name.trim().toLocaleLowerCase('tr')], options: g.options.map(o => ({ ...o, extra: String(o.extra / 100) })) })));
  const openedRevision = useRef(revision);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ requestId: string; revision: number; action: 'draft' | 'publish' | 'unpublish'; id?: string; product: Product } | null>(null);
  const draftMissing = (): string[] => [...missing.filter(m => !m.startsWith('Kategori seçin') && !m.startsWith('Fiyat:') && !m.startsWith('İndirimlerle')), ...(form.price.trim() && (!Number.isFinite(price) || price > 1_000_000) ? ['Taslak fiyatı boş, sıfır veya geçerli bir tutar olmalı.'] : [])];
  const [preview, setPreview] = useState(false), [recipeOpen, setRecipeOpen] = useState(false), stockOn = usePackage().has('stock');
  const [photo, setPhoto] = useState<string | null>(initial?.photo ?? null);
  // KDV: one of the owner's rates (Menü yönetimi → KDV oranları); new products start on the default.
  const vatList = useVatRates(), [vat, setVat] = useState<number | null>(initial?.vatRate ?? null);
  // A new product that reads like alcohol ("Bira", "Efes", "Kokteyller") starts on the higher rate until the owner picks one:
  // the hint alone let "Bira" go out at %10 and the yazar kasa list followed it (8 Ekim denetimi).
  const autoVat = !initial?.id && vat === null ? suggestVat(form.name, form.category, vatList) : null;
  const vatRate = vat !== null && vatList.rates.includes(vat) ? vat : autoVat ?? productVat(initial ?? undefined, vatList);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [photoBusy, setPhotoBusy] = useState(false);
  // Keep each category's draft separate so a cake never inherits coffee size/milk fields.
  const drafts = useRef<Record<string, { subtype: string; groups: DraftGroup[] }>>({});
  // Illustration without a photo follows the category name, for restaurant and dessert-shop menus too (packages/domain/sector.ts).
  const art = initial && form.category === initial.category ? initial.art : artForCategory(form.category);
  const missing: string[] = [];
  if (!/^\d{1,5}$/.test(form.code)) missing.push('Ürün kodu: 1–5 rakam girin.');
  if (!form.name.trim()) missing.push('Ürün adını yazın.');
  if (!categories.includes(form.category)) missing.push('Kategori seçin.');
  const price = parseMoney(form.price);
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) missing.push('Fiyat: 0 TL’den büyük, en fazla 10.000 TL girin.');
  for (const [i, g] of groups.entries()) {
    if (!g.name.trim()) missing.push(`${i + 1}. seçenek grubunun alan adını yazın.`);
    for (const [j, o] of g.options.entries()) {
      if (!o.name.trim()) missing.push(`${g.name || 'Seçenek grubu'}: ${j + 1}. seçeneğin adını yazın.`);
      const extra = parseAdjustment(o.extra);
      if (!Number.isFinite(extra) || extra < -1_000_000 || extra > 1_000_000) missing.push(`${g.name || 'Seçenek grubu'}: ${j + 1}. fiyat farkını −10.000 ile 10.000 TL arasında girin.`);
    }
  }
  const minimumPrice = price + groups.reduce((sum, g) => sum + Math.min(...g.options.map(o => parseAdjustment(o.extra)), ...(g.required ? [] : [0])), 0);
  if (price > 0 && Number.isFinite(minimumPrice) && minimumPrice < 1) missing.push('İndirimlerle birlikte ürünün fiyatı en az 0,01 TL olmalı.');
  if (photoBusy) missing.push('Fotoğraf kırpmasını “Fotoğrafı kullan” ile tamamlayın veya vazgeçin.');
  const saveHint = busy ? 'Ürün kaydediliyor…' : missing.length ? missing.join('\n') : 'Ürünü kaydeder ve müşteri menüsünde yayınlar.';
  const previewProduct = useMemo<Product | null>(() => preview ? ({ ...form, id: initial?.id ?? 'preview', name: form.name.trim() || 'Ürün adı', price: Number.isFinite(price) ? price : 0, art, photo, groups: groups.map(g => ({ ...g, options: g.options.map(o => ({ ...o, extra: Number.isFinite(parseAdjustment(o.extra)) ? parseAdjustment(o.extra) : 0 })) })) }) : null, [preview, form, initial?.id, price, art, photo, groups]);
  function changeCategory(category: string) {
    drafts.current[form.category] = { subtype: form.subtype, groups };
    const previous = drafts.current[category];
    setForm(f => ({ ...f, category, subtype: previous?.subtype ?? '' })); setGroups(previous?.groups ?? []);
  }
  async function save(e: FormEvent, published = true) {
    e.preventDefault(); const problems = published ? missing : draftMissing();
    if (busy || (!pending.current && problems.length)) { setError(problems.join(' ')); return; }
    setError(''); setBusy(true);
    pending.current ??= { requestId: requestId(), revision: openedRevision.current, action: published ? 'publish' : liveProduct ? 'unpublish' : 'draft', id: initial?.id, product: { ...form, vatRate, id: initial?.id ?? '', published, price: Number.isFinite(price) && price >= 0 && price <= 1_000_000 ? price : 0, art, photo, groups: groups.map(g => ({ ...g, options: g.options.map(o => ({ ...o, extra: parseAdjustment(o.extra) })) })) } };
    try { await api('/api/staff/products', pending.current); const savedPublished = pending.current.product.published !== false; pending.current = null; setUncertain(false); onSave(savedPublished); }
    catch (e) { const unknown = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(unknown); if (!unknown) pending.current = null; setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <><Modal title={initial ? 'Ürünü düzenle' : 'Yeni ürün'} onClose={() => { if (!busy && !photoBusy && !uncertain) onClose(); }} wide className="product-editor-dialog">
    <form noValidate className="modal-body product-editor" onSubmit={e => void save(e)}><div className="editor-scroll-body">
      {liveProduct && <Notice>Bu ürün müşteri menüsünde. “Taslağa al” ürünü menüden kaldırır; mevcut siparişler korunur. Değişiklikleri yayında tutmak için “Kaydet ve yayınla”yı kullanın.</Notice>}<fieldset className="editor-fields" disabled={busy || uncertain}>
      <div className="editor-primary-grid"><section className="editor-basics"><p className="editor-required-note">Ad, kategori ve fiyat girin. <span className="required-mark">*</span> zorunlu alan.</p>
        <label>Ürün adı <span aria-hidden="true" className="required-mark">*</span><input aria-label="Ürün adı" placeholder="Örn. Caffè Latte" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required maxLength={80} /></label>
        <label>Kategori <span aria-hidden="true" className="required-mark">*</span><select required aria-label="Kategori" value={form.category} onChange={e => changeCategory(e.target.value)}><option value="">Kategori seçiniz</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <div className="editor-unit"><label>Satış birimi<select aria-label="Satış birimi" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value as 'piece' | 'kg' }))}><option value="piece">Adet</option><option value="kg">Kilogram</option></select></label><HelpTip title="Satış birimi">Kilogram seçilirse fiyat 1 kg içindir. Müşteri ve personel 250 g, 500 g, 1 kg ya da 50 g adımlarla başka bir ağırlık (en az 50 g, en çok 20 kg) seçer; tutar ağırlığa göre hesaplanıp kuruşa yuvarlanır. Seçeneklerin ek ücreti kiloya göre değil, ürüne bir kez eklenir (ör. hediye kutusu); kilo fiyatı farklı çeşitler için ayrı ürün açın. Kiloluk ürün adet kampanyalarına (4 al 3 öde gibi) katılmaz; yüzde ve TL indirimleri satırın tutarına uygulanır. Hesap bölünürken kiloluk satır bölünmez, tamamı ödenir.</HelpTip></div>
        <VatField rate={vatRate} auto={autoVat !== null} list={vatList} name={form.name} category={form.category} onChange={setVat} onApplied={revision => { openedRevision.current = revision; }} />
        <div className="editor-price-code"><label>{form.unit === 'kg' ? 'Fiyat (TL / kg)' : 'Fiyat (TL)'} <span aria-hidden="true" className="required-mark">*</span><input aria-label={form.unit === 'kg' ? 'Fiyat (TL / kg)' : 'Fiyat (TL)'} inputMode="decimal" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} required /></label><label>Ürün kodu <span aria-hidden="true" className="required-mark">*</span><input aria-label="Ürün kodu" inputMode="numeric" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} required /><small>Otomatik verilir, değiştirilebilir.</small></label></div>
        <label>{form.category === 'Tatlılar' ? 'Tatlı türü' : 'Alt kategori'} <small>İsteğe bağlı</small><select id="product-subtypes" disabled={!form.category} value={form.subtype} onChange={e => setForm(f => ({ ...f, subtype: e.target.value }))}><option value="">Alt kategori seçiniz</option>{[...new Set([...(subcategories.find(c => c.category === form.category)?.names ?? []), ...(kinds[form.category] ?? []), ...(form.subtype ? [form.subtype] : [])])].map(k => <option key={k} value={k}>{k}</option>)}</select></label>
        {/* 11 Ekim: a bottled/canned drink the kitchen does not prepare; the waiter may swap it until the bill is paid (packages/domain/order-change.ts). */}
        <label className="checkbox-label editor-ready-made"><input type="checkbox" checked={form.readyMade} onChange={e => setForm(f => ({ ...f, readyMade: e.target.checked }))} />Hazır ürün (kutu, şişe: mutfakta hazırlanmaz)<HelpTip title="Hazır ürün">Kola, ayran, su, soda gibi hazır gelen ürünler. Garson bu ürünü hesap ödenene kadar başka bir hazır ürünle değiştirebilir ya da adedini değiştirebilir; fiyat farkı hesaba kendiliğinden yansır ve kasada “Değişti” diye görünür. Mutfak bu değişiklik için uyarılmaz.</HelpTip></label>
      </section><section className="editor-photo"><h3>Ürün fotoğrafı <small>İsteğe bağlı</small></h3><PhotoEditor photo={photo} art={art} onChange={setPhoto} onBusy={setPhotoBusy} /></section></div>
      <details className="editor-disclosure" open={!!initial?.groups.length || undefined}><summary>Müşteri seçenekleri <small>Boy, süt tercihi veya ek malzeme</small></summary><p className="muted small">Fiyat farkında −10 gibi negatif bir tutar ürün fiyatını düşürür.</p><OptionFields groups={groups} category={form.category} setGroups={setGroups} /></details>
      {!stockOn && <LockedRow feature="stock" title="Reçete" line="Stok ve kârlılık için malzeme miktarları: Stok, reçete ve kârlılık hizmetiyle." />}
      {stockOn && <details className="editor-disclosure editor-recipe" onToggle={e => setRecipeOpen(e.currentTarget.open)}><summary>Reçete <small>Stok ve kârlılık için: hangi malzemeden ne kadar</small></summary><section className="editor-section">{!initial ? <p className="muted small">Reçeteyi ürünü kaydettikten sonra buradan ya da Stok → Reçeteler'den yazabilirsiniz.</p> : recipeOpen && <Suspense fallback={<p className="muted small" role="status">Reçete yükleniyor…</p>}><RecipeSection product={liveProduct ?? initial} /></Suspense>}{initial && <p className="muted small">Reçete ayrı kaydedilir ("Reçeteyi kaydet"); ürünün seçenek değişiklikleri yayınlandıktan sonra reçetede görünür.</p>}</section></details>}
      <details className="editor-disclosure"><summary>Diğer bilgiler <small>Açıklama ve içindekiler</small></summary><section className="editor-section"><label>İçindekiler<input value={form.ingredients} maxLength={500} placeholder="Örn. süt, kahve" onChange={e => setForm(f => ({ ...f, ingredients: e.target.value }))} /></label><label>Açıklama<textarea value={form.description} maxLength={240} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="İsterseniz ürününüzü kısaca anlatın." /></label><label className="checkbox-label"><input type="checkbox" checked={form.soldOut} onChange={e => setForm(f => ({ ...f, soldOut: e.target.checked }))} />Tükendi</label></section></details>
      <EnglishFields values={form} onChange={change => setForm(f => ({ ...f, ...change }))} groups={groups} setGroups={setGroups} />
      </fieldset>{error && <Notice tone="error">{error}</Notice>}{uncertain && <button type="button" className="btn primary" disabled={busy} onClick={e => void save(e)}>Kaydı yeniden kontrol et</button>}
      </div><div className="editor-save-area"><div className="modal-actions"><button type="button" className="btn secondary" disabled={busy || photoBusy || uncertain} onClick={onClose}>Vazgeç</button>{initial && <DeleteCatalogItem kind="product" id={initial.id} name={initial.name} revision={openedRevision.current} disabled={busy || photoBusy || uncertain} onDeleted={onDelete} />}<button type="button" className="btn secondary" disabled={photoBusy} onClick={() => setPreview(true)}>Önizleme</button>{<button type="button" className="btn secondary" title={draftMissing().join(' ') || (liveProduct ? 'Ürünü müşteri menüsünden kaldırır ve değişiklikleri taslak olarak saklar.' : 'Ürün adı ve koduyla saklar; müşteri menüsünde göstermez.')} disabled={busy || uncertain || draftMissing().length > 0} onClick={e => void save(e, false)}>{liveProduct ? 'Taslağa al' : 'Taslak kaydet'}</button>}<span className="save-help" tabIndex={0} aria-label="Kaydetme koşulları" aria-describedby="product-save-hint"><button className="btn primary" disabled={busy || uncertain || missing.length > 0}>{busy ? 'Kaydediliyor…' : 'Kaydet ve yayınla'}</button><span role="tooltip" id="product-save-hint">{saveHint}</span></span></div>{missing.length > 0 && <p className="missing-fields" role="status">{missing.slice(0, 2).join(' ')}{missing.length > 2 ? ` +${missing.length - 2} eksik alan.` : ''}</p>}</div>
    </form></Modal>{previewProduct && <ProductDialog product={previewProduct} en={false} preview onClose={() => setPreview(false)} onAdd={() => {}} />}</>;
});

/** The business's KDV rates; until they load (or for Mola destek, who may not read them) the ready-made %10 / %20. */
function useVatRates(): VatSettings {
  const [list, setList] = useState<VatSettings>(DEFAULT_VAT);
  useEffect(() => { let live = true; void api<VatSettings>('/api/staff/vat').then(v => { if (live) setList(vatSettings({ vat: v })); }).catch(() => {}); return () => { live = false; }; }, []);
  return list;
}
/**
 * "KDV": the product's rate. A name or category that reads like alcohol ("Efes bira", "Kokteyller") gets a small hint
 * with the higher rate; the owner decides. "Bu bölümdeki ürünlere uygula" gives every product of the category this rate.
 */
function VatField({ rate, auto = false, list, name, category, onChange, onApplied }: { rate: number; auto?: boolean; list: VatSettings; name: string; category: string; onChange: (rate: number) => void; onApplied: (revision: number) => void }) {
  const [asking, setAsking] = useState(false), [busy, setBusy] = useState(false), [note, setNote] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const suggestion = suggestVat(name, category, list), owner = usePackage().owner;
  useEffect(() => { setAsking(false); setNote(null); }, [category, rate]);
  async function apply() {
    setBusy(true); setNote(null);
    try { const r = await api<{ changed: number; revision: number }>('/api/staff/vat/apply', { requestId: requestId(), category, rate }); onApplied(r.revision); setNote({ tone: 'success', text: r.changed ? `${category} bölümündeki ${r.changed} ürün %${rate} oldu.` : `${category} bölümündeki ürünler zaten %${rate}.` }); setAsking(false); }
    catch (e) { setNote({ tone: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  }
  return <div className="editor-vat">
    <div className="editor-unit"><label>KDV<select aria-label="KDV" value={rate} onChange={e => onChange(Number(e.target.value))}>{list.rates.map(r => <option key={r} value={r}>%{r}{r === list.default ? ' (varsayılan)' : ''}</option>)}</select></label><HelpTip title="KDV">Menü fiyatları KDV dahildir; müşteri menüsünde KDV görünmez. Oran, raporlardaki KDV dökümü ve hesap fişindeki "KDV dahildir" satırı içindir. Oranları Menü yönetimi → KDV oranları'ndan değiştirebilirsiniz.</HelpTip></div>
    {owner && <PlaceLink to={{ view: 'menu', tab: 'vat' }} className="vat-manage">KDV oranlarını yönet</PlaceLink>}
    {auto && suggestion === rate && <p className="vat-hint" role="status">Alkollü içecek gibi göründüğü için %{rate} seçildi. Değilse yukarıdan değiştirin.</p>}
    {suggestion !== null && suggestion !== rate && <p className="vat-hint" role="status">Alkollü içecek gibi görünüyor: genelde %{suggestion} uygulanır. <button type="button" className="text-btn" onClick={() => onChange(suggestion)}>%{suggestion} seç</button></p>}
    {category && !asking && <button type="button" className="text-btn vat-apply" onClick={() => { setNote(null); setAsking(true); }}>Bu bölümdeki ürünlere uygula</button>}
    {asking && <div className="vat-confirm" role="group" aria-label="KDV'yi bölüme uygula"><span>{category} bölümündeki bütün ürünler %{rate} olsun mu?</span><button type="button" className="btn primary small-btn" disabled={busy} onClick={() => void apply()}>{busy ? 'Uygulanıyor…' : 'Evet, uygula'}</button><button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => setAsking(false)}>Vazgeç</button></div>}
    {note && <Notice tone={note.tone}>{note.text}</Notice>}
  </div>;
}

const OptionFields = memo(function OptionFields({ groups, category, setGroups }: { groups: DraftGroup[]; category: string; setGroups: Dispatch<SetStateAction<DraftGroup[]>> }) {
  const [presetNotice, setPresetNotice] = useState('');
  useEffect(() => setPresetNotice(''), [category]);
  // `required`: a size is always chosen; "Standart" (₺0) starts selected for the guest, Küçük/Büyük get their price difference.
  function addGroup(name: string, values: string[], preset: NonNullable<OptionGroup['preset']> = 'custom', required = false) {
    const matches = (g: DraftGroup) => preset !== 'custom' && (g.preset === preset || (!g.preset && g.name.trim().toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr')));
    if (groups.some(matches)) { setPresetNotice(`${name} zaten eklendi. Aşağıdaki mevcut alanı düzenleyebilirsiniz.`); return; }
    setPresetNotice('');
    setGroups(gs => gs.some(matches) ? gs : [...gs, { id: requestId(), name, preset, required, options: values.map(name => ({ id: requestId(), name, extra: '0' })) }]);
  }
  function updateGroup(id: string, change: Partial<DraftGroup>) { setGroups(gs => gs.map(g => g.id === id ? { ...g, ...change } : g)); }
  return (      <section className="editor-section"><p className="muted small">Yalnızca ihtiyacınız olan alanları ekleyin. Her grubu ayrı düzenleyebilir veya kaldırabilirsiniz.</p>
      <div className="option-presets">{category === 'Kahveler' && <><button type="button" className="btn secondary small-btn" disabled={groups.length >= 8} onClick={() => addGroup('Boy', ['Küçük', 'Standart', 'Büyük'], 'size', true)}><Plus size={14} />Boy ekle</button><button type="button" className="btn secondary small-btn" disabled={groups.length >= 8} onClick={() => addGroup('Süt tercihi', ['Normal süt', 'Laktozsuz süt', 'Yulaf sütü'], 'milk')}><Plus size={14} />Süt tercihi ekle</button></>}{category === 'Tatlılar' && <button type="button" className="btn secondary small-btn" disabled={groups.length >= 8} onClick={() => addGroup('Servis tercihi', ['Sade', 'Dondurmalı'], 'service')}><Plus size={14} />Servis tercihi ekle</button>}<button type="button" className="btn secondary small-btn" disabled={groups.length >= 8} onClick={() => addGroup('Yeni seçenek', ['Seçenek 1'])}><Plus size={14} />Özel alan ekle</button></div>
      {presetNotice && <Notice tone="error">{presetNotice}</Notice>}
      {groups.length === 0 && <p className="empty-inline small">Bu ürün doğrudan sepete eklenebilir; ek seçim istenmez.</p>}
      {groups.map(g => <fieldset key={g.id} className="group-editor"><legend>{g.name || 'Seçenek grubu'}</legend><div className="group-heading"><label>Alan adı <span aria-hidden="true" className="required-mark">*</span><input aria-label="Alan adı" value={g.name} maxLength={60} required onChange={e => updateGroup(g.id, { name: e.target.value })} /></label><button type="button" className="text-btn" onClick={() => setGroups(gs => gs.filter(x => x.id !== g.id))}><Trash2 size={14} />Alanı kaldır</button></div><label className="checkbox-label"><input type="checkbox" checked={g.required} onChange={e => updateGroup(g.id, { required: e.target.checked })} />Müşteri seçim yapmak zorunda</label>{g.required && <p className="muted small">Ek ücreti 0 olan seçenek (ör. Standart) hazır seçili gelir. Hiçbiri 0 değilse müşteri seçmeden sepete ekleyemez.</p>}{g.options.map((o, i) => <div className="option-edit-row" key={o.id}><label>Seçenek {i + 1} <span aria-hidden="true" className="required-mark">*</span><input aria-label={`Seçenek ${i + 1}`} value={o.name} required maxLength={60} onChange={e => updateGroup(g.id, { options: g.options.map(x => x.id === o.id ? { ...x, name: e.target.value } : x) })} /></label><label>Ek ücret (TL) <span aria-hidden="true" className="required-mark">*</span><input aria-label="Ek ücret (TL)" inputMode="text" value={o.extra} required onChange={e => updateGroup(g.id, { options: g.options.map(x => x.id === o.id ? { ...x, extra: e.target.value } : x) })} /></label><button type="button" className="icon-btn" aria-label={`${o.name} seçeneğini kaldır`} disabled={g.options.length === 1} onClick={() => updateGroup(g.id, { options: g.options.filter(x => x.id !== o.id) })}><Trash2 size={16} /></button></div>)}<button type="button" className="text-btn" disabled={g.options.length >= 12} onClick={() => updateGroup(g.id, { options: [...g.options, { id: requestId(), name: '', extra: '0' }] })}>+ Seçenek ekle</button></fieldset>)}
      </section>);
});

type EnglishText = { nameEn: string; descriptionEn: string; ingredientsEn: string };
// One closed section keeps the editor short; placeholders show what the guest's EN menu shows when a field stays empty.
const EnglishFields = memo(function EnglishFields({ values, onChange, groups, setGroups }: { values: EnglishText & { name: string }; onChange: (change: Partial<EnglishText>) => void; groups: DraftGroup[]; setGroups: Dispatch<SetStateAction<DraftGroup[]>> }) {
  const filled = [values.nameEn, values.descriptionEn, values.ingredientsEn, ...groups.flatMap(g => [g.nameEn, ...g.options.map(o => o.nameEn)])].filter(v => v?.trim()).length;
  const [openAtStart] = useState(filled > 0); // fixed, so clearing the last field does not fold the section mid-typing
  const setGroup = (id: string, change: (g: DraftGroup) => DraftGroup) => setGroups(gs => gs.map(g => g.id === id ? change(g) : g));
  return <details className="editor-disclosure" open={openAtStart || undefined}><summary>İngilizce (isteğe bağlı) <small>{filled ? `${filled} alan yazıldı` : 'Müşteri menüyü EN seçince görür'}</small></summary><section className="editor-section">
    <p className="muted small">Boş bıraktığınız alanda gri öneri, öneri yoksa Türkçe metin gösterilir. Mutfak ve fişler Türkçe kalır.</p>
    <label>İngilizce adı<input aria-label="İngilizce adı" value={values.nameEn} maxLength={80} placeholder={values.name.trim() || 'Örn. Caffè Latte'} onChange={e => onChange({ nameEn: e.target.value })} /></label>
    <label>İngilizce açıklama<textarea aria-label="İngilizce açıklama" value={values.descriptionEn} maxLength={240} placeholder="Boşsa Türkçe açıklama gösterilir." onChange={e => onChange({ descriptionEn: e.target.value })} /></label>
    <label>İngilizce içindekiler<input aria-label="İngilizce içindekiler" value={values.ingredientsEn} maxLength={500} placeholder="Örn. milk, coffee" onChange={e => onChange({ ingredientsEn: e.target.value })} /></label>
    {groups.map(g => <fieldset key={g.id} className="english-group"><legend>{g.name || 'Seçenek grubu'}</legend>
      <label>Alan adı<input aria-label={`İngilizce alan adı · ${g.name}`} value={g.nameEn ?? ''} maxLength={60} placeholder={optionLabelSuggestion(g.name) ?? g.name} onChange={e => setGroup(g.id, x => ({ ...x, nameEn: e.target.value }))} /></label>
      {g.options.map((o, i) => <label key={o.id}>{o.name || `Seçenek ${i + 1}`}<input aria-label={`İngilizce seçenek · ${g.name} · ${o.name}`} value={o.nameEn ?? ''} maxLength={60} placeholder={optionLabelSuggestion(o.name, g.name) ?? o.name} onChange={e => setGroup(g.id, x => ({ ...x, options: x.options.map(y => y.id === o.id ? { ...y, nameEn: e.target.value } : y) }))} /></label>)}
    </fieldset>)}
  </section></details>;
});

const PhotoEditor = memo(function PhotoEditor({ photo, art, onChange, onBusy }: { photo: string | null; art: Product['art']; onChange: (value: string | null) => void; onBusy: (value: boolean) => void }) {
  const [source, setSource] = useState<PhotoSource | null>(null); const [legacy, setLegacy] = useState(false); const [zoom, setZoom] = useState(1); const [x, setX] = useState(50); const [y, setY] = useState(50); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null); const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!source || !canvas.current) return;
    const frame = requestAnimationFrame(() => { if (canvas.current) drawCrop(canvas.current, source, zoom, x, y); });
    return () => cancelAnimationFrame(frame);
  }, [source, zoom, x, y]);
  async function choose(file?: File) {
    if (!file) return; setError('');
    // A phone photo (12–48 MP, iPhone HEIC too) is made at most 2048 px here, upright, before anything is sent (src/photoPrep.ts).
    const run = ++generation.current; onBusy(true); setBusy(true);
    try { const prepared = await preparePhoto(file); if (run !== generation.current) return; setSource(prepared); setLegacy(false); setZoom(1); setX(50); setY(50); }
    catch (e) { setError((e as Error).message); onBusy(false); } finally { setBusy(false); }
  }
  async function editPhoto() {
    if (!photo) return; setBusy(true); onBusy(true); setError('');
    try {
      const saved = await api<{ data: string; crop: { zoom: number; x: number; y: number }; original: boolean }>('/api/staff/photo-source', { photo });
      const img = new Image(); img.src = saved.data; await img.decode();
      setSource(img); setZoom(saved.crop.zoom); setX(saved.crop.x); setY(saved.crop.y); setLegacy(!saved.original);
    } catch (e) { setError((e as Error).message); onBusy(false); } finally { setBusy(false); }
  }
  async function usePhoto() {
    setBusy(true); setError('');
    try { const output = document.createElement('canvas'); output.width = 800; output.height = 800;
      drawCrop(output, source!, zoom, x, y);
      const data = await encodePhoto(output, .82, CROP_BYTES);
      const size = sizeOf(source!), ratio = Math.min(1, SOURCE_SIDE / Math.max(size.width, size.height));
      let originalCanvas = source as HTMLCanvasElement;
      if (!(source instanceof HTMLCanvasElement) || ratio < 1) {
        originalCanvas = document.createElement('canvas');
        originalCanvas.width = Math.max(1, Math.round(size.width * ratio)); originalCanvas.height = Math.max(1, Math.round(size.height * ratio));
        originalCanvas.getContext('2d')!.drawImage(source!, 0, 0, originalCanvas.width, originalCanvas.height);
      }
      const originalData = await encodePhoto(originalCanvas, .85, SOURCE_BYTES);
      const result = await api<{ photo: string }>('/api/staff/photos', { data, source: { data: originalData, crop: { zoom, x, y } } }); onChange(result.photo); setSource(null); onBusy(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="photo-editor">{source ? <>{legacy && <p className="small muted">Bu eski fotoğrafın yalnızca kaydedilmiş kırpımı var; kırpımın dışındaki alanlar geri getirilemez.</p>}<div className="crop-preview"><canvas ref={canvas} width={320} height={320} aria-label="Fotoğraf kırpma önizlemesi" /></div><div className="crop-controls"><CropControl label="Yakınlaştır" value={zoom} initial={1} min={1} max={3} step={.05} onChange={setZoom} disabled={busy} /><CropControl label="Yatay konum" value={x} initial={50} min={0} max={100} onChange={setX} disabled={busy} /><CropControl label="Dikey konum" value={y} initial={50} min={0} max={100} onChange={setY} disabled={busy} /></div><div className="option-presets"><button type="button" disabled={busy} className="btn primary" onClick={() => void usePhoto()}><Check size={16} />{busy ? 'Fotoğraf hazırlanıyor…' : 'Fotoğrafı kullan'}</button><button type="button" className="btn secondary" disabled={busy} onClick={() => { setSource(null); onBusy(false); }}>Kırpmadan vazgeç</button></div></> : <div className="photo-current"><ProductArt kind={art} photo={photo} alt="Ürün fotoğrafı önizlemesi" /><div><label className="photo-upload"><ImagePlus size={20} />{busy ? 'Fotoğraf açılıyor…' : photo ? 'Fotoğrafı değiştir' : 'Fotoğraf seç'}<input aria-label="Ürün fotoğrafı seç" type="file" accept="image/*" disabled={busy} onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} /></label><p className="small muted">Telefonla çekilmiş fotoğraf da olur (JPG, PNG, WebP, iPhone HEIC).<br />Gönderilmeden önce küçültülür; kare kırpılır.</p>{photo && <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => void editPhoto()}>Fotoğrafı düzenle</button>}{photo && <button type="button" className="text-btn" onClick={() => onChange(null)}>Fotoğrafı kaldır</button>}</div></div>}{error && <Notice tone="error">{error}</Notice>}</div>;
});

function drawCrop(canvas: HTMLCanvasElement, source: PhotoSource, zoom: number, x: number, y: number) {
  const { width, height } = sizeOf(source), side = Math.min(width, height) / zoom, g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height); g.imageSmoothingQuality = 'high';
  g.drawImage(source, (width - side) * x / 100, (height - side) * y / 100, side, side, 0, 0, canvas.width, canvas.height);
}
