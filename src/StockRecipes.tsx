import { PlaceLink } from './Moved';
import { useId, useMemo, useState } from 'react';
import { BookOpenText, Boxes, Calculator, CircleSlash, Package, Plus, Search, Trash2, X } from 'lucide-react';
import type { Product, StaffSnapshot } from '../packages/domain/types';
import { batchShare, formatAmount, LOW_MARGIN, optionCosts, parseAmount, recipeCost, recipeUsage, type OptionRule, type Recipe, type StockUnit } from '../packages/domain/stock';
import { api, money } from './api';
import { Modal, Notice } from './components';
import { HelpTip } from './HelpTip';
import { Segmented } from './SettingsKit';
import { AmountInput, amountOf, draftOf, emptyAmount, ItemSelect, noEnter, type AmountDraft } from './StockInputs';
import { byCategory, matchText, recipeText, useStock, type ItemView, type StockView } from './stockView';
import './stock.css';

type Mode = 'recipe' | 'ready' | 'none';
type Row = { key: number; itemId: string; amount: AmountDraft };
type RuleKind = 'none' | 'scale' | 'add' | 'replace';
type RuleDraft = { kind: RuleKind; percent: string; itemId: string; amount: AmountDraft; from: string; to: string };
const RULE_KINDS: { value: RuleKind; label: string }[] = [{ value: 'none', label: 'Değişmez' }, { value: 'scale', label: 'Miktar değişir (%)' }, { value: 'add', label: 'Malzeme eklenir' }, { value: 'replace', label: 'Yerine başka malzeme' }];
let rowKey = 0;
const currentOf = (view: StockView, productId: string) => view.recipes?.find(r => r.productId === productId);

/** Cost of one piece (or kg) with today's prices, and the items that have none yet. */
export function costLine(recipe: Pick<Recipe, 'items' | 'options'>, items: Map<string, ItemView>) {
  const { cost, missing } = recipeCost(recipe, '', id => items.get(id)?.unitCost ?? null);
  return { cost: Math.round(cost), missing: missing.map(id => items.get(id)?.name ?? 'Silinmiş malzeme') };
}
const percent = (n: number) => `%${Math.round(n * 100)}`;

/** Stok → Reçeteler: every menu product with its recipe, cost and margin; a tap opens the recipe. */
/** Without `onOpen` (the kitchen) the list only reads: what goes into each product, no cost, no changes. */
export function RecipesTab({ data, view, onOpen, onAddItem }: { data: StaffSnapshot; view: StockView; onOpen?: (id: string) => void; onAddItem: () => void }) {
  const [query, setQuery] = useState('');
  const items = useMemo(() => new Map(view.items.map(i => [i.id, i])), [view.items]);
  const visible = data.products.filter(p => !query.trim() || matchText(`${p.name} ${p.code} ${p.category}`, query));
  const written = data.products.filter(p => currentOf(view, p.id)).length;
  const noItems = !view.items.some(i => i.kind !== 'product');
  return <section className="stock-section" aria-label="Reçeteler">
    <div className="stock-section-head"><div><h2>Reçeteler <span className="stock-count">{written} / {data.products.length}</span><HelpTip title="Reçeteler">Bir üründe hangi malzemeden ne kadar kullanıldığını yazın; her satışta o kadar stoktan düşer. Seçenekler reçeteyi değiştirebilir (Büyük boy %150, Yulaf sütü sütün yerine, Ekstra shot +9 g kahve). Değişiklik bundan sonraki satışlara uygulanır; geçmiş satışlar eski reçeteyle kalır. Ürün düzenleme penceresinde de "Reçete" bölümü vardır.</HelpTip></h2><p className="muted small">{onOpen ? 'Maliyet bugünkü alış fiyatlarıyla hesaplanır.' : 'Her üründe kullanılan malzemeler. Reçeteyi işletme sahibi değiştirir.'}</p></div>{onOpen && <PlaceLink to={{ view: 'reports', tab: 'profit' }}>Kârlılığı gör</PlaceLink>}</div>
    {noItems && onOpen && <Notice>Reçete yazmak için önce malzemeleri ekleyin.<button type="button" className="text-btn" onClick={onAddItem}>Malzeme ekle</button></Notice>}
    <div className="stock-toolbar"><label className="stock-search"><Search size={17} aria-hidden="true" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Ürün ara" aria-label="Reçetelerde ürün ara" />{query && <button type="button" className="icon-btn" aria-label="Aramayı temizle" onClick={() => setQuery('')}><X size={15} /></button>}</label></div>
    {!visible.length ? <p className="stock-empty-line">Aramaya uyan ürün yok.</p> : byCategory(visible, data.categories).map(g => <section className="stock-group" key={g.name} aria-label={g.name}>
      <h3>{g.name}<span>{g.products.length}</span></h3>
      <ul className="stock-list">{g.products.map(p => {
        const r = currentOf(view, p.id), c = r && onOpen ? costLine(r, items) : null, margin = c && !c.missing.length && p.price > 0 ? (p.price - c.cost) / p.price : null;
        const body = <>
          <span className="stock-row-name"><strong>{p.name}</strong><small>{r ? recipeText(r, items, view.names) : 'Reçete yok · stoktan düşmez'}</small></span>
          {onOpen ? <span className={`stock-row-status ${r ? '' : 'quiet'}`}>{!r ? <span className="stock-quiet"><em>Reçete yaz</em></span> : c?.missing.length ? <small className="stock-missing">Fiyatı eksik: {c.missing.join(', ')}</small> : c && <><span className="stock-row-figure"><strong>{money(c.cost)}</strong> maliyet</span><small>{margin !== null && <b className={`stock-chip ${(view.thresholds?.[p.id] ?? null) !== null && margin < view.thresholds![p.id]! ? 'warn' : 'ok'}`}>Kâr {percent(margin)}</b>}{p.unit === 'kg' ? '1 kg için' : 'adet başına'}</small></>}</span>
            : <span className={`stock-row-status ${r ? '' : 'quiet'}`}>{r ? <small>{p.unit === 'kg' ? '1 kg için' : 'adet başına'}</small> : <span className="stock-quiet">Takip yok</span>}</span>}
        </>;
        return <li key={p.id} className={`stock-row ${r ? '' : 'untracked'}`}>{onOpen ? <button type="button" className="stock-row-main" aria-label={`${p.name} reçetesi${r ? '' : ' yok'}`} onClick={() => onOpen(p.id)}>{body}</button> : <div className="stock-row-main">{body}</div>}</li>;
      })}</ul>
    </section>)}
  </section>;
}

/** The recipe of one product in its own window (Stok → Ürünler / Reçeteler, Kârlılık → "Reçete ekle"). */
export function RecipeModal({ product, view, onClose, onSaved }: { product: Product; view: StockView; onClose: () => void; onSaved: (message: string) => void }) {
  return <Modal title={`${product.name} · Reçete`} wide className="stock-modal stock-recipe-modal" onClose={onClose}>
    <div className="modal-body"><RecipeEditor product={product} view={view} onSaved={onSaved} onCancel={onClose} /></div>
  </Modal>;
}

/** Ürün düzenleme → "Reçete": the same editor inside the product window (no form of its own: buttons only). */
export default function RecipeSection({ product }: { product: Product }) {
  const { view, error, reload } = useStock(), [notice, setNotice] = useState('');
  if (error && !view) return <Notice tone="error">{error}</Notice>;
  if (!view) return <p className="muted small" role="status">Reçete yükleniyor…</p>;
  return <div className="stock-recipe-inline">{notice && <Notice tone="success">{notice}</Notice>}<RecipeEditor key={view.recipes?.find(r => r.productId === product.id)?.id ?? 'none'} product={product} view={view} onSaved={message => { setNotice(message); void reload(); }} /></div>;
}

const shareText = (n: number, unit: StockUnit) => unit === 'piece' ? `${n.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} adet` : formatAmount(n, unit);

/**
 * Reçete → "Toplu üretimden hesapla" (18 Ekim): what one batch took and how many portions (or kg) came out, divided into
 * one portion. "Reçeteye yaz" only fills the rows (blank lines stay as they are); the recipe is saved with "Reçeteyi kaydet".
 */
function BatchHelper({ id, rows, items, kg, onWrite, onClose }: { id: string; rows: Row[]; items: Map<string, ItemView>; kg: boolean; onWrite: (amounts: Map<number, AmountDraft>) => void; onClose: () => void }) {
  const [totals, setTotals] = useState<Record<number, AmountDraft>>({}), [portions, setPortions] = useState(''), [tried, setTried] = useState(false);
  const portionsId = useId(), count = parseAmount(portions, 'adet');
  const lines = rows.flatMap(r => { const it = items.get(r.itemId); if (!it) return []; const d = totals[r.key] ?? emptyAmount(it.unit, true), total = d.text.trim() ? amountOf(d) : null; return [{ key: r.key, it, d, total, share: total === null ? null : batchShare(total, count, it.unit) }]; });
  const typed = lines.filter(l => l.total !== null), wrong = typed.find(l => !(l.total! > 0)), tiny = typed.find(l => l.share === null);
  const problem = !typed.length ? 'En az bir malzemenin toplam miktarını yazın.' : wrong ? `${wrong.it.name}: toplam miktarı sayı olarak yazın.`
    : !portions.trim() ? (kg ? 'Kaç kg ürün çıktığını yazın.' : 'Kaç porsiyon çıktığını yazın.') : !(count > 0) ? (kg ? 'Çıkan miktarı 0’dan büyük bir sayı olarak yazın.' : 'Porsiyon sayısını 0’dan büyük bir sayı olarak yazın.')
    : tiny ? `${tiny.it.name}: ${kg ? '1 kg için' : 'porsiyon başına'} çok az kalıyor; toplamı kontrol edin.` : '';
  const write = () => { if (problem) { setTried(true); return; } onWrite(new Map(typed.map(l => [l.key, draftOf(l.share!, l.it.unit)]))); };
  return <section id={id} className="stock-batch" aria-labelledby={`${id}-title`}>
    <div><h5 id={`${id}-title`}>Bir seferde ne kadar hazırladınız?</h5><p className="stock-hint">Kullandığınız toplam malzemeyi ve kaç {kg ? 'kg ürün' : 'porsiyon'} çıktığını yazın; {kg ? '1 kg için miktarı' : 'porsiyon başını'} hesaplayalım.</p></div>
    {!lines.length ? <p className="stock-batch-empty" role="status">Önce malzemeleri seçin.</p> : <>
      {lines.map(l => <div className="stock-batch-line" key={l.key}>
        <span className="stock-batch-name" aria-hidden="true">{l.it.name}</span>
        <AmountInput label={`${l.it.name} toplam miktarı`} hideLabel smallFirst placeholder="Toplam" value={l.d} unit={l.it.unit} invalid={!!wrong && wrong.key === l.key} onChange={d => setTotals(t => ({ ...t, [l.key]: d }))} />
      </div>)}
      <div className="stock-batch-line">
        <label className="stock-batch-name" htmlFor={portionsId}>{kg ? 'Kaç kg ürün çıktı?' : 'Kaç porsiyon çıktı?'}</label>
        <div className="stock-amount-row"><input id={portionsId} inputMode="decimal" autoComplete="off" value={portions} placeholder="0" aria-invalid={(!!portions.trim() && !(count > 0)) || undefined} onKeyDown={noEnter} onChange={e => setPortions(e.target.value)} /><span className="stock-unit-fixed" aria-hidden="true">{kg ? 'kg' : 'porsiyon'}</span></div>
      </div>
      <p className={`stock-batch-result ${problem ? 'warn' : ''}`} aria-live="polite">{problem ? (tried || portions.trim() ? problem : '') : `${kg ? '1 kg ürün' : '1 porsiyon'}: ${typed.map(l => `${l.it.name} ${shareText(l.share!, l.it.unit)}`).join(' · ')}`}</p>
    </>}
    <div className="stock-batch-actions">
      {lines.length > 0 && <button type="button" className="btn secondary small-btn" onClick={write}>Reçeteye yaz</button>}
      <button type="button" className="text-btn" onClick={onClose}>Kapat</button>
    </div>
  </section>;
}

function rulesOf(product: Product, recipe: Recipe | undefined, units: Map<string, ItemView>) {
  const out: Record<string, RuleDraft> = {};
  for (const g of product.groups) for (const o of g.options) {
    const r = recipe?.options?.find(x => x.groupId === g.id && x.optionId === o.id), add = r?.add?.[0], rep = r?.replace?.[0];
    const unit = units.get(add?.itemId ?? '')?.unit ?? 'g';
    out[`${g.id}:${o.id}`] = { kind: rep ? 'replace' : add ? 'add' : r?.scale ? 'scale' : 'none', percent: r?.scale ? String(Math.round(r.scale * 100)) : '150', itemId: add?.itemId ?? '', amount: add ? draftOf(add.amount, unit) : emptyAmount('g', true), from: rep?.from ?? '', to: rep?.to ?? '' };
  }
  return out;
}

/** Ingredients and amounts for one piece (or one kg), how options change them, or "hazır ürün" / "takip yok". */
export function RecipeEditor({ product, view, onSaved, onCancel }: { product: Product; view: StockView; onSaved: (message: string) => void; onCancel?: () => void }) {
  const current = currentOf(view, product.id), items = useMemo(() => new Map(view.items.map(i => [i.id, i])), [view.items]);
  const ingredients = view.items.filter(i => i.kind !== 'product');
  const [mode, setMode] = useState<Mode>(current?.ready ? 'ready' : 'recipe');
  const [rows, setRows] = useState<Row[]>(() => current && !current.ready ? current.items.map(i => ({ key: ++rowKey, itemId: i.itemId, amount: draftOf(i.amount, items.get(i.itemId)?.unit ?? 'g') })) : [{ key: ++rowKey, itemId: '', amount: emptyAmount('g', true) }]);
  const [rules, setRules] = useState(() => rulesOf(product, current, items));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [batch, setBatch] = useState(false);
  const kg = product.unit === 'kg', batchId = useId();
  const setRow = (key: number, change: Partial<Row>) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...change } : r));
  const setRule = (key: string, change: Partial<RuleDraft>) => setRules(rs => ({ ...rs, [key]: { ...rs[key], ...change } }));
  const chosen = rows.filter(r => r.itemId);
  const recipeItems = chosen.map(r => ({ itemId: r.itemId, amount: amountOf(r.amount) }));
  const options: OptionRule[] = [];
  const problems: string[] = [];
  if (mode === 'recipe') {
    if (!chosen.length) problems.push('En az bir malzeme seçin.');
    if (recipeItems.some(i => !(i.amount > 0))) problems.push('Her malzemenin miktarını yazın.');
    if (new Set(chosen.map(r => r.itemId)).size !== chosen.length) problems.push('Bir malzeme reçetede bir kez yazılır.');
    for (const g of product.groups) for (const o of g.options) {
      const d = rules[`${g.id}:${o.id}`]; if (!d || d.kind === 'none') continue;
      if (d.kind === 'scale') { const n = Number(d.percent.replace(',', '.')); if (!(n >= 5 && n <= 2000)) problems.push(`${o.name}: yüzdeyi 5 ile 2000 arasında yazın.`); else if (n !== 100) options.push({ groupId: g.id, optionId: o.id, scale: n / 100 }); }
      else if (d.kind === 'add') { const n = amountOf(d.amount); if (!d.itemId || !(n > 0)) problems.push(`${o.name}: eklenecek malzemeyi ve miktarını seçin.`); else options.push({ groupId: g.id, optionId: o.id, add: [{ itemId: d.itemId, amount: n }] }); }
      else { if (!d.from || !d.to || d.from === d.to) problems.push(`${o.name}: hangi malzemenin yerine neyin kullanıldığını seçin.`); else options.push({ groupId: g.id, optionId: o.id, replace: [{ from: d.from, to: d.to }] }); }
    }
  }
  const preview = mode === 'recipe' && !problems.length ? costLine({ items: recipeItems }, items) : null;
  // 8 Ekim: each option costed alone, the same way Kârlılık costs that variant (packages/domain/stock.ts optionCosts).
  const costRows = preview && product.groups.length ? optionCosts(product, { items: recipeItems, options }, id => items.get(id)?.unitCost ?? null) : null;
  const lowLine = view.thresholds?.[product.id] ?? LOW_MARGIN;
  // "Sütlü satılınca stoktan: Kahve 20 g, Süt 100 ml düşer." from what is typed now (rules with a problem left out).
  const draft = { items: recipeItems.filter(i => i.amount > 0), options };
  const takes = (key: string) => [...recipeUsage(draft, key)].filter(([, n]) => n > 0).map(([id, n]) => { const it = items.get(id); return `${it?.name ?? 'Silinmiş malzeme'} ${it ? formatAmount(n, it.unit) : n}`; }).join(', ');
  async function save() {
    if (problems.length) { setError(problems[0]); return; }
    setBusy(true); setError('');
    try {
      const r = await api<{ unchanged?: boolean }>('/api/staff/stock/recipes', { productId: product.id, mode, items: mode === 'recipe' ? recipeItems : [], options: mode === 'recipe' ? options : [] });
      onSaved(r.unchanged ? 'Reçete zaten bu hâliyle kayıtlı.' : mode === 'none' ? `${product.name} artık stoktan düşmüyor.` : mode === 'ready' ? `${product.name} hazır ürün olarak adetle takip ediliyor.` : `${product.name} reçetesi kaydedildi. Bundan sonraki satışlara uygulanır.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const readyStock = view.products[product.id]?.status === 'ready' ? view.products[product.id].stock : undefined;
  return <div className="stock-recipe">
    <div className="stock-field"><span className="stock-label">Bu ürün nasıl takip edilsin?</span>
      <Segmented label="Takip şekli" wide value={mode} disabled={busy} onChange={setMode} options={[{ value: 'recipe', label: <><BookOpenText size={15} aria-hidden="true" />Malzemelerden</> }, ...(kg ? [] : [{ value: 'ready' as const, label: <><Package size={15} aria-hidden="true" />Hazır ürün</> }]), { value: 'none', label: <><CircleSlash size={15} aria-hidden="true" />Takip yok</> }]} />
    </div>
    {mode === 'ready' && <div className="stock-mode-note"><Package size={20} aria-hidden="true" /><p><b>Hazır alınıp satılan ürün</b> (şişe su, kutu kola, paketli kek). Her satış stoktan 1 adet düşer; alışları ve sayımı Alış ve sayım'dan girersiniz.{readyStock !== undefined && <> Şu an <b>{readyStock} adet</b> görünüyor.</>}</p></div>}
    {mode === 'none' && <div className="stock-mode-note quiet"><CircleSlash size={20} aria-hidden="true" /><p>Bu ürün satılınca stoktan bir şey düşmez{current ? '; bundan önceki satışlar eski reçeteyle kalır' : ''}.</p></div>}
    {mode === 'recipe' && <>
      {!ingredients.length ? <div className="stock-empty"><Boxes size={26} aria-hidden="true" /><strong>Önce malzeme ekleyin</strong><span>Stok → Malzemeler'den kahve, süt gibi malzemeleri ekleyince burada seçebilirsiniz.</span></div> : <>
        <div className="stock-recipe-head"><h4>{kg ? '1 kg ürün için' : '1 adet için'}</h4><span className="stock-recipe-head-side"><span className="muted small">Malzeme ve miktar</span><button type="button" className="text-btn stock-batch-toggle" aria-expanded={batch} aria-controls={batch ? batchId : undefined} disabled={busy} onClick={() => setBatch(b => !b)}><Calculator size={14} aria-hidden="true" />Toplu üretimden hesapla</button></span></div>
        <ul className="stock-recipe-rows">{rows.map((r, i) => {
          const unit = items.get(r.itemId)?.unit ?? 'g';
          return <li key={r.key} className="stock-recipe-row">
            <ItemSelect label={`${i + 1}. malzeme`} hideLabel items={ingredients} allowProducts={false} value={r.itemId} disabled={busy} onChange={id => { const u = items.get(id)?.unit ?? 'g'; setRow(r.key, { itemId: id, amount: { text: r.amount.text, unit: emptyAmount(u, true).unit } }); }} />
            <AmountInput label={`${i + 1}. malzemenin miktarı`} hideLabel smallFirst value={r.amount} unit={unit} disabled={busy || !r.itemId} onChange={amount => setRow(r.key, { amount })} invalid={!!r.itemId && !!r.amount.text && !(amountOf(r.amount) > 0)} />
            <button type="button" className="icon-btn stock-row-remove" aria-label={`${items.get(r.itemId)?.name ?? `${i + 1}. malzeme`} satırını kaldır`} disabled={busy || rows.length === 1} onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}><Trash2 size={16} /></button>
          </li>;
        })}</ul>
        {batch && <BatchHelper id={batchId} rows={rows} items={items} kg={kg} onClose={() => setBatch(false)} onWrite={amounts => { setRows(rs => rs.map(r => amounts.has(r.key) ? { ...r, amount: amounts.get(r.key)! } : r)); setBatch(false); }} />}
        <button type="button" className="text-btn stock-add-row" disabled={busy || rows.length >= 30} onClick={() => setRows(rs => [...rs, { key: ++rowKey, itemId: '', amount: emptyAmount('g', true) }])}><Plus size={15} />Malzeme ekle</button>
        {product.groups.length > 0 && <details className="stock-options" open={!!current?.options?.length || undefined}><summary><span>Seçenekler stoktan düşen miktarı değiştiriyor mu?</span><HelpTip title="Seçenek kuralları">Değişmez: seçenek stoktan düşeni değiştirmez. Miktar değişir (%): reçetedeki bütün malzemeler bu oranda düşer (Büyük boy %150 = her malzemeden 1,5 kat). Malzeme eklenir: reçeteye ek olarak bir malzeme düşer (Ekstra shot +9 g kahve). Yerine başka malzeme: reçetedeki bir malzemenin yerine başkası düşer, miktar aynı kalır (Yulaf sütü, sütün yerine).</HelpTip> <small>Müşteriye görünmez · {product.groups.map(g => g.name).join(', ')}</small></summary>
          <p className="stock-hint">Örnek: Büyük boy %150 · Yulaf sütü, sütün yerine · Ekstra shot, +9 g kahve. Seçilmeyen seçenek reçeteyi değiştirmez.</p>
          {product.groups.map(g => <fieldset key={g.id} className="stock-option-group"><legend>{g.name}</legend>{g.options.map(o => {
            const key = `${g.id}:${o.id}`, d = rules[key], addUnit = items.get(d.itemId)?.unit ?? 'g', text = takes(key);
            return <div className="stock-option-row" key={o.id}>
              <span className="stock-option-name">{o.name}</span>
              <select aria-label={`${o.name} seçeneği reçeteyi nasıl değiştirir`} value={d.kind} disabled={busy} onChange={e => setRule(key, { kind: e.target.value as RuleKind })}>{RULE_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
              {d.kind === 'scale' && <label className="stock-option-percent"><span className="sr-only">{o.name} için yüzde</span><span aria-hidden="true">%</span><input inputMode="decimal" value={d.percent} disabled={busy} onKeyDown={noEnter} onChange={e => setRule(key, { percent: e.target.value })} /></label>}
              {d.kind === 'add' && <div className="stock-option-inputs"><ItemSelect label={`${o.name} ile eklenen malzeme`} hideLabel items={ingredients} allowProducts={false} value={d.itemId} disabled={busy} onChange={id => setRule(key, { itemId: id, amount: { text: d.amount.text, unit: emptyAmount(items.get(id)?.unit ?? 'g', true).unit } })} /><AmountInput label={`${o.name} ile eklenen miktar`} hideLabel smallFirst value={d.amount} unit={addUnit} disabled={busy || !d.itemId} onChange={amount => setRule(key, { amount })} /></div>}
              {d.kind === 'replace' && <div className="stock-option-inputs replace"><ItemSelect label={`${o.name}: yerine kullanılmayan malzeme`} hideLabel placeholder="Hangisinin yerine?" items={ingredients.filter(x => chosen.some(r => r.itemId === x.id))} allowProducts={false} value={d.from} disabled={busy} onChange={id => setRule(key, { from: id })} /><span className="stock-arrow" aria-hidden="true">→</span><ItemSelect label={`${o.name}: kullanılan malzeme`} hideLabel placeholder="Ne kullanılır?" items={ingredients} allowProducts={false} value={d.to} disabled={busy} onChange={id => setRule(key, { to: id })} /></div>}
              {text && <p className="stock-option-effect">{o.name} satılınca stoktan: {text} düşer.</p>}
            </div>;
          })}</fieldset>)}
        </details>}
        {preview && (preview.missing.length ? <div className="stock-cost-preview"><span>Maliyet için fiyatı eksik: <b>{preview.missing.join(', ')}</b> (Malzemeler'den yazabilirsiniz)</span></div>
          : costRows ? <div className="stock-cost-preview options">
            <table className="stock-cost-table" aria-label="Seçeneklere göre maliyet">
              <thead><tr><th scope="col">Seçenek</th><th scope="col">Maliyet</th><th scope="col">Satış</th><th scope="col">Kâr</th></tr></thead>
              <tbody>{costRows.map(r => <tr key={r.key}><th scope="row">{r.name}{r.extra > 0 && <small> (+{money(r.extra)})</small>}</th><td>{r.cost === null ? '—' : money(r.cost)}</td><td>{money(r.price)}</td><td>{r.margin === null ? '—' : <b className={r.margin < lowLine ? 'warn' : ''}>{percent(r.margin)}</b>}</td></tr>)}</tbody>
            </table>
            <small className="stock-hint">Her satır: yalnız o seçenek seçilince 1 {kg ? 'kg' : 'adet'}. Bugünkü alış fiyatlarıyla, Kârlılık raporuyla aynı hesap.</small>
          </div>
          : <div className="stock-cost-preview"><span>Maliyet <b>{money(preview.cost)}</b></span><span>Satış fiyatı <b>{money(product.price)}</b></span>{product.price > 0 && <span>Kâr oranı <b className={(product.price - preview.cost) / product.price < lowLine ? 'warn' : ''}>{percent((product.price - preview.cost) / product.price)}</b></span>}</div>)}
      </>}
    </>}
    <p className="stock-hint">Kaydettiğiniz andan sonraki satışlara uygulanır; geçmiş satışlar ve stok hesabı eski reçeteyle kalır.</p>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="modal-actions stock-actions">
      {onCancel && <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Vazgeç</button>}
      <button type="button" className="btn primary" disabled={busy || (mode === 'recipe' && !ingredients.length)} onClick={() => void save()}>{busy ? 'Kaydediliyor…' : 'Reçeteyi kaydet'}</button>
    </div>
    {current && mode === 'recipe' && <p className="stock-hint">Şu anki reçete: {recipeText(current, items, view.names) || '—'}{current.items.some(i => !items.has(i.itemId)) ? ' (kaldırılmış malzeme var)' : ''} · {new Date(current.validFrom).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric' })} tarihinden beri</p>}
  </div>;
}
