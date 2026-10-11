import { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, MoreHorizontal, PackageMinus, ShoppingCart, Undo2 } from 'lucide-react';
import type { StaffSnapshot } from '../packages/domain/types';
import { businessDay } from '../packages/domain/business-day';
import { expensePayNames, expensePays, payFields, type ExpensePay } from '../packages/domain/expense-rules';
import { formatAmount, WASTE_REASONS, type StockEntry, type StockUnit } from '../packages/domain/stock';
import { api, ApiError, money, moneyError, parseMoney, requestId } from './api';
import { Modal, Notice } from './components';
import { HelpTip } from './HelpTip';
import { BelowZeroNote, belowZeroText, useDrawerExpected } from './ExpenseForm';
import { PlaceLink } from './Moved';
import { AmountInput, amountLike, amountOf, emptyAmount, ItemSelect, noEnter, unlikely, type AmountDraft } from './StockInputs';
import { unitPrice, type ItemView, type StockView } from './stockView';
import './stock.css';

type Form = 'purchase' | 'count' | 'waste' | 'return' | null;
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const KIND_NAMES: Record<StockEntry['kind'], string> = { purchase: 'Alış', count: 'Sayım', waste: 'Fire', return: 'İade', price: 'Fiyat' };
const label = (e: StockEntry) => e.kind === 'count' && e.start ? 'Başlangıç' : KIND_NAMES[e.kind];
/** "Son hareketler": the last few records only (K-L); İşlem geçmişi has them all. */
const RECENT = 3;

/**
 * Stok → Alış ve sayım: what comes in (alış), what the shelf really holds (sayım) and what was thrown away (fire), and the
 * latest of these. A wrong record can be taken back; a purchase's expense stays in Giderler (changed there).
 */
export function EntriesTab({ data, view, onSaved, onHistory }: { data: StaffSnapshot; view: StockView; onSaved: (message: string, expenseId?: string) => void; onHistory: () => void }) {
  const [form, setForm] = useState<Form>(null), [undo, setUndo] = useState<StockEntry | null>(null);
  const items = new Map(view.items.map(i => [i.id, i]));
  // Prices typed with a new item are part of its start; they would only repeat the item's own line.
  // K-L (9 Ekim): only the last 3 here; every record is in İşlem geçmişi ("Tümü"), not listed twice.
  const entries = (view.entries ?? []).filter(e => !(e.kind === 'price' && e.start)).slice(0, RECENT);
  const none = !view.items.length;
  const done = (message: string, expenseId?: string) => { setForm(null); onSaved(message, expenseId); };
  const describe = (e: StockEntry) => {
    const item = e.itemId ? items.get(e.itemId) : undefined, name = e.itemId ? view.names[e.itemId] ?? 'Silinmiş malzeme' : data.products.find(p => p.id === e.productId)?.name ?? 'Ürün';
    const amount = (n: number | undefined) => item && n !== undefined ? formatAmount(n, item.unit) : n?.toLocaleString('tr-TR') ?? '';
    if (e.kind === 'purchase') return { name, figure: `+${amount(e.quantity)}`, detail: [e.total ? money(e.total) : 'Ücretsiz', item && e.unitCost !== undefined ? unitPrice(e.unitCost, item.unit) : '', e.supplier, e.expenseId ? 'Gider olarak kaydedildi' : e.unpaid ? 'Ödenmedi (veresiye)' : ''].filter(Boolean).join(' · ') };
    if (e.kind === 'count' && e.start) return { name, figure: amount(e.quantity), detail: 'Başlangıç miktarı' };
    if (e.kind === 'count') { const diff = (e.quantity ?? 0) - (e.expected ?? 0); return { name, figure: amount(e.quantity), detail: Math.abs(diff) < 0.5 ? 'Fark yok' : `Fark ${diff > 0 ? '+' : ''}${amount(diff)}`, warn: diff < -0.5 }; }
    if (e.kind === 'waste') return { name, figure: `−${amount(e.quantity)}`, detail: e.reason ?? '', warn: true };
    if (e.kind === 'return') return { name, figure: `+${(e.productQuantity ?? 0).toLocaleString('tr-TR')}`, detail: `İade stoğa döndü · ${(e.items ?? []).map(([id, n]) => { const it = items.get(id); return `${view.names[id] ?? 'malzeme'} +${it ? formatAmount(n, it.unit) : n}`; }).join(', ')}` };
    return { name, figure: item && e.unitCost !== undefined ? unitPrice(e.unitCost, item.unit) : '', detail: 'Fiyat elle yazıldı' };
  };
  // The kitchen counts and records fire; purchases, prices and returns are the owner's. It takes back only its own records.
  const owner = data.role === 'owner' || data.role === 'manager', mine = (e: StockEntry) => owner || ((e.kind === 'count' || e.kind === 'waste') && !e.start && e.byName === data.displayName);
  // Taken back only on the business day it was written (the server says the same, server/stock.ts undoable); never "Başlangıç".
  const today = businessDay(view.now), undoable = (e: StockEntry) => mine(e) && !e.start && businessDay(e.at) === today;
  return <section className="stock-section" aria-label={owner ? 'Alış ve sayım' : 'Sayım ve fire'}>
    <div className={`stock-actions-grid ${owner ? '' : 'two'}`}>
      {owner && <ActionTile icon={<ShoppingCart size={22} />} title="Alış kaydet" text="Gelen malı yazın; birim fiyat ve stok güncellenir." disabled={none} onClick={() => setForm('purchase')} />}
      <ActionTile icon={<ClipboardCheck size={22} />} title="Sayım yap" text="Rafta gerçekte ne varsa yazın; fark görünür." disabled={none} onClick={() => setForm('count')} />
      <ActionTile icon={<PackageMinus size={22} />} title="Fire kaydet" text="Bozulan, dökülen, atılan malzemeyi düşün." disabled={none} onClick={() => setForm('waste')} />
    </div>
    {none ? <p className="stock-empty-line">{owner ? "Önce Malzemeler'den malzeme ekleyin." : 'Malzemeleri işletme sahibi ekler.'}</p> : owner && <p className="stock-return-line"><Undo2 size={15} aria-hidden="true" />Para iadesi stoğu değiştirmez. Ürün hiç kullanılmadan geri geldiyse <button type="button" className="text-btn" onClick={() => setForm('return')}>iadeyi stoğa ekleyin</button></p>}
    <section className="stock-panel" aria-label="Son hareketler">
      <div className="stock-section-head stock-recent-head"><div><h2>Son hareketler<HelpTip title="Son hareketler">Son 3 alış, sayım, fire ya da iade kaydı; hepsi “Tümü”de (İşlem geçmişi). Satışlar burada tek tek görünmez; stoktan reçeteyle kendiliğinden düşer. Bugün yazılan yanlış bir kaydı satırın sonundaki ⋯ → “Bu kaydı geri al” ile kaldırabilirsiniz; önce stoğun nasıl değişeceği gösterilir. Daha eski bir kayıt ya da başlangıç miktarı yanlışsa Sayım yapın: stok sayılan miktardan devam eder. Alışla yazılan gider Giderler'de kalır.</HelpTip></h2></div>
        {entries.length > 0 && <button type="button" className="text-btn stock-recent-all" aria-label="Tümü · İşlem geçmişi" onClick={onHistory}>Tümü</button>}</div>
      {!entries.length ? <p className="stock-empty-line">Henüz kayıt yok. İlk alışınızı ya da sayımınızı yazın.</p>
        : <ul className="stock-entries">{entries.map(e => { const d = describe(e); return <li key={e.id} className={`stock-entry ${e.kind}`}>
          <span className={`stock-kind ${e.kind}`}>{label(e)}</span>
          <span className="stock-entry-text"><strong>{d.name}</strong><small>{d.detail}{d.detail ? ' · ' : ''}{when(e.at)}{e.byName ? ` · ${e.byName}` : ''}</small></span>
          <b className={`stock-entry-figure ${d.warn ? 'warn' : ''}`}>{d.figure}</b>
          {undoable(e) ? <RowMenu name={`${label(e)} · ${d.name}`} onUndo={() => setUndo(e)} /> : <span className="stock-row-menu" aria-hidden="true" />}
        </li>; })}</ul>}
      {/* Nothing taken back is erased: who and when stays in view. */}
      {!!view.undone?.length && <details className="stock-undone"><summary>Geri alınanlar <span className="stock-count">{view.undone.length}</span></summary>
        <ul>{view.undone.map(e => { const d = describe(e); return <li key={e.id}><span className={`stock-kind ${e.kind}`}>{label(e)}</span><span><s>{d.name} {d.figure}</s><small>{when(e.at)} kaydı · geri alan {e.deletedBy ?? '—'}{e.deletedAt ? `, ${when(e.deletedAt)}` : ''}</small></span></li>; })}</ul>
      </details>}
    </section>
    {form === 'purchase' && <PurchaseForm view={view} owner={data.role === 'owner'} onClose={() => setForm(null)} onSaved={done} />}
    {form === 'count' && <CountForm view={view} onClose={() => setForm(null)} onSaved={done} />}
    {form === 'waste' && <WasteForm view={view} onClose={() => setForm(null)} onSaved={done} />}
    {form === 'return' && <ReturnForm data={data} view={view} onClose={() => setForm(null)} onSaved={done} />}
    {undo && <UndoEntry entry={undo} name={describe(undo).name} figure={describe(undo).figure} onClose={() => setUndo(null)} onSaved={message => { setUndo(null); onSaved(message); }} />}
  </section>;
}

/** The row's "⋯": a small menu with "Bu kaydı geri al" (no undo link on every row: one curious tap emptied a stock, 8 Ekim). */
function RowMenu({ name, onUndo }: { name: string; onUndo: () => void }) {
  const [open, setOpen] = useState(false), box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); box.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return <span className="stock-row-menu" ref={box}>
    <button type="button" className="icon-btn stock-row-more" aria-label={`${name} · diğer işlemler`} title="Diğer işlemler" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}><MoreHorizontal size={18} aria-hidden="true" /></button>
    {open && <span className="stock-row-popup" role="menu" aria-label={name}><button type="button" role="menuitem" autoFocus onClick={() => { setOpen(false); onUndo(); }}><Undo2 size={15} aria-hidden="true" />Bu kaydı geri al</button></span>}
  </span>;
}

function ActionTile({ icon, title, text, disabled, onClick }: { icon: React.ReactNode; title: string; text: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className="stock-action" disabled={disabled} onClick={onClick}><span className="stock-action-icon" aria-hidden="true">{icon}</span><span><strong>{title}</strong><small>{text}</small></span></button>;
}

/** One request per window, sent again unchanged after an unclear failure, so a retry never records twice. */
function useSend(onSaved: (message: string, result?: unknown) => void) {
  const pending = useRef<{ path: string; body: object; message: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false), [code, setCode] = useState('');
  async function send(next: { path: string; body: object; message: string }) {
    if (busy) return; setBusy(true); setError(''); setCode('');
    pending.current ??= next;
    try { const result = await api(pending.current.path, pending.current.body); onSaved(pending.current.message, result); }
    catch (e) { const u = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(u); if (!u) pending.current = null; setCode(!u && e instanceof ApiError ? e.code ?? '' : ''); setError(u ? 'Sonuç alınamadı. Aynı kaydı tekrar gönderebilirsiniz; iki kez yazılmaz.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  return { send, busy, error, uncertain, setError, code };
}

/** "850 kg mı? Beklenen 904 g": asked once before saving an amount ten times off; "Evet, doğru" saves it as typed. */
function UnitCheck({ text, busy, onFix, onConfirm }: { text: string; busy: boolean; onFix: () => void; onConfirm: () => void }) {
  return <div className="stock-unit-check" role="alert"><p><strong>{text}</strong> Birimi (g / kg, ml / L) kontrol edin.</p><div className="modal-actions stock-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onFix}>Düzelt</button><button type="button" className="btn primary" disabled={busy} onClick={onConfirm}>Evet, doğru</button></div></div>;
}

/**
 * 9 Ekim K-K: "Para nereden çıktı?" instead of the "Gider olarak da kaydet" box (left unticked, a milk bought from the drawer
 * wrote no expense and the gün sonu came out short). Nothing is chosen beforehand; with an amount, saving waits for an answer.
 *   Kasadan          an expense from the drawer ("Kasadan nakit"): the gün sonu's expected cash drops;
 *   Kasa dışından    an expense paid otherwise: Kasa dışı nakit / Kart / Havale / Diğer (asked next), the drawer stays;
 *   Ödenmedi         veresiye: the stock only, no expense now (the entry keeps `unpaid`).
 */
type Paid = 'drawer' | 'outside' | 'unpaid';
const PAID: { value: Paid; title: string; text: string }[] = [
  { value: 'drawer', title: 'Kasadan', text: 'Kasadaki nakitten ödendi; gün sonunda beklenen nakitten düşer.' },
  { value: 'outside', title: 'Kasa dışından', text: 'Cepten, bankadan ya da kartla; kasadaki nakit değişmez.' },
  { value: 'unpaid', title: 'Ödenmedi (veresiye)', text: 'Sonra ödenecek; şimdi gider yazılmaz.' },
];
const OUTSIDE_PAYS = expensePays.filter(p => p !== 'drawer');
function PaidChoice({ value, onChange, disabled }: { value: Paid | ''; onChange: (p: Paid) => void; disabled?: boolean }) {
  return <div className="expense-source stock-paid" role="radiogroup" aria-label="Para nereden çıktı">
    <span className="expense-source-label">Para nereden çıktı? *</span>
    {PAID.map(p => <button type="button" key={p.value} role="radio" aria-checked={value === p.value} className={`expense-source-option${value === p.value ? ' selected' : ''}`} disabled={disabled} onClick={() => onChange(p.value)}><b>{p.title}</b><small>{p.text}</small></button>)}
  </div>;
}

function PurchaseForm({ view, owner, onClose, onSaved }: { view: StockView; owner: boolean; onClose: () => void; onSaved: (message: string, expenseId?: string) => void }) {
  const [itemId, setItemId] = useState(''), item = view.items.find(i => i.id === itemId);
  const [quantity, setQuantity] = useState<AmountDraft>(emptyAmount('g')), [total, setTotal] = useState(''), [supplier, setSupplier] = useState('');
  const [paid, setPaid] = useState<Paid | ''>(''), [outside, setOutside] = useState<ExpensePay | ''>(''), [check, setCheck] = useState('');
  // K2 (10 Ekim): the expense written with the purchase goes back with the message ("Giderlerde gör" on the green line).
  const { send, busy, error, uncertain, setError, code } = useSend((message, result) => onSaved(message, (result as { entry?: { expenseId?: string } } | undefined)?.entry?.expenseId)), belowZero = code === 'CASH_BELOW_ZERO' && !!error;
  const q = amountOf(quantity), money_ = total.trim() ? parseMoney(total) : 0;
  const totalProblem = total.trim() ? moneyError(total, { min: 0 }) : '';
  const expense = paid === 'drawer' || paid === 'outside', pay: ExpensePay | '' = paid === 'drawer' ? 'drawer' : paid === 'outside' ? outside : '';
  const problems = [!item && 'Malzemeyi seçin.', !(q > 0) && 'Alınan miktarı yazın.', totalProblem, money_ > 0 && !paid && 'Paranın nereden çıktığını seçin.', expense && !(money_ > 0) && 'Gider olarak yazılması için toplam tutarı yazın.', paid === 'outside' && !outside && 'Nasıl ödendiğini seçin.'].filter(Boolean) as string[];
  // "Kasadan" below the drawer: the owner's note under the question (src/ExpenseForm.tsx BelowZeroNote); "Alışı kaydet" saves it
  // as chosen. The Müdür never sees the drawer's expected cash (K1): the server does not ask the Müdür either.
  const expected = useDrawerExpected(owner && paid === 'drawer');
  // The same words as Gider ekle, naming this form's own answer ("Kasa dışından", not the select's "Kasa dışı nakit").
  const warn = (owner && paid === 'drawer' && typeof expected === 'number' && Number.isFinite(money_) && money_ > 0 && expected - money_ < 0 ? belowZeroText(expected, money_) : belowZero ? error : '').replace('“Kasa dışı nakit”i', '“Kasa dışından”ı');
  const saved = paid === 'drawer' ? ' Gider olarak da yazıldı (kasadan).' : paid === 'outside' ? ' Gider olarak da yazıldı (kasa dışından).' : paid === 'unpaid' ? ' Ödenmedi: gider yazılmadı.' : '';
  const save = (confirmed = false, confirm = !!warn) => { if (problems.length) { setError(problems[0]); return; } const odd = item ? unlikely(q, item.lastPurchase?.quantity, item.unit) : ''; if (odd && !confirmed) { setCheck(odd); return; } setCheck(''); void send({ path: '/api/staff/stock/purchase', body: { requestId: requestId(), itemId, quantity: q, total: money_, ...(supplier.trim() ? { supplier: supplier.trim() } : {}), ...(paid ? { paid } : {}), expense, ...(expense && pay ? payFields(pay) : {}), ...(confirm ? { confirm } : {}) }, message: `${item!.name}: ${formatAmount(q, item!.unit)} alış kaydedildi.${saved}` }); };
  return <Modal title="Alış kaydet" className="stock-modal" onClose={() => { if (!busy) onClose(); }}><form className="modal-body stock-form" onSubmit={e => { e.preventDefault(); save(); }}>
    <ItemSelect label="Malzeme *" items={view.items} value={itemId} disabled={busy || uncertain} onChange={id => { setItemId(id); const u = view.items.find(i => i.id === id)?.unit ?? 'g'; setQuantity(d => ({ ...emptyAmount(u), text: d.text })); }} />
    <div className="stock-form-pair">
      <AmountInput label="Alınan miktar *" value={quantity} unit={item?.unit ?? 'g'} disabled={busy || uncertain || !item} onChange={d => { setCheck(''); setQuantity(d); }} />
      <label className="stock-field"><span className="stock-label">Toplam tutar (TL)</span><input inputMode="decimal" value={total} disabled={busy || uncertain} placeholder="Örn. 480" aria-invalid={!!totalProblem} onKeyDown={noEnter} onChange={e => setTotal(e.target.value)} />{totalProblem && <small className="field-error" role="alert">{totalProblem}</small>}</label>
    </div>
    {item && q > 0 && money_ > 0 && <p className="stock-calc">Birim fiyat: <b>{unitPrice(money_ / q, item.unit)}</b>{item.unitCost !== undefined && item.unitCost !== null && <span className="muted"> · önceki {unitPrice(item.unitCost, item.unit)}</span>}</p>}
    <label className="stock-field"><span className="stock-label">Tedarikçi <small>İsteğe bağlı</small></span><input value={supplier} maxLength={80} disabled={busy || uncertain} placeholder="Örn. Mandıra Ali" onChange={e => setSupplier(e.target.value)} /></label>
    <PaidChoice value={paid} disabled={busy || uncertain} onChange={p => { setPaid(p); setError(''); }} />
    {paid === 'drawer' && (warn ? <BelowZeroNote text={warn} /> : <small className="muted stock-paid-line">Kasa ve giderler → Giderler'e bugünün gideri olarak yazılır. <PlaceLink to={{ view: 'cash', tab: 'expenses', part: 'records' }}>Giderlerde gör</PlaceLink></small>)}
    {paid === 'outside' && <label className="stock-field"><span className="stock-label">Nasıl ödendi? *</span><select aria-label="Nasıl ödendi" value={outside} disabled={busy || uncertain} aria-invalid={!outside} onChange={e => { setOutside(e.target.value as ExpensePay); setError(''); }}><option value="" disabled>Seçin</option>{OUTSIDE_PAYS.map(m => <option key={m} value={m}>{expensePayNames[m]}</option>)}</select>
      <small className="muted">Kasa ve giderler → Giderler'e bugünün gideri olarak yazılır; kasadaki nakit değişmez. <PlaceLink to={{ view: 'cash', tab: 'expenses', part: 'records' }}>Giderlerde gör</PlaceLink></small></label>}
    {paid === 'unpaid' && <small className="muted stock-paid-line">Gider olarak yazılmaz; yalnız stok artar. Ödediğinizde Kasa ve giderler → Giderler'den ekleyin.</small>}
    {error && !belowZero && <Notice tone="error">{error}</Notice>}
    {!uncertain && !error && problems.length > 0 && (q > 0 || !!item) && <p className="stock-hint" role="status">{problems[0]}</p>}
    {check ? <UnitCheck text={check} busy={busy} onFix={() => setCheck('')} onConfirm={() => save(true)} />
      : <div className="modal-actions stock-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || (!uncertain && problems.length > 0)}>{busy ? 'Kaydediliyor…' : uncertain ? 'Yeniden gönder' : 'Alışı kaydet'}</button></div>}
  </form></Modal>;
}

/** Sayım: the real amount of each item counted; only filled rows are saved, with the difference from what Mola expected. */
function CountForm({ view, onClose, onSaved }: { view: StockView; onClose: () => void; onSaved: (message: string) => void }) {
  const list = [...view.items].sort((a, b) => Number(a.kind === 'product') - Number(b.kind === 'product') || a.name.localeCompare(b.name, 'tr'));
  // Each row starts in the unit its "Beklenen" is shown in (904 g → g, 2,4 kg → kg): 850 typed there means 850 g.
  const [drafts, setDrafts] = useState<Record<string, AmountDraft>>(() => Object.fromEntries(list.map(i => [i.id, amountLike(i.stock, i.unit)]))), [check, setCheck] = useState('');
  const { send, busy, error, uncertain, setError } = useSend(onSaved);
  const filled = list.filter(i => drafts[i.id].text.trim());
  const bad = filled.filter(i => !(amountOf(drafts[i.id]) >= 0));
  const save = (confirmed = false) => { if (!filled.length) { setError('En az bir malzemenin sayılan miktarını yazın.'); return; } if (bad.length) { setError(`${bad[0].name}: sayıyı doğru yazın.`); return; }
    const odd = filled.map(i => { const w = unlikely(amountOf(drafts[i.id]), i.stock, i.unit); return w && `${i.name}: ${w}`; }).filter(Boolean);
    if (odd.length && !confirmed) { setCheck(odd.join(' ')); return; } setCheck(''); void send({ path: '/api/staff/stock/count', body: { requestId: requestId(), counts: filled.map(i => ({ itemId: i.id, quantity: amountOf(drafts[i.id]) })) }, message: `Sayım kaydedildi (${filled.length} malzeme). Stok sayılan miktardan devam ediyor.` }); };
  return <Modal title="Sayım yap" wide className="stock-modal" onClose={() => { if (!busy) onClose(); }}><form className="modal-body stock-form" onSubmit={e => { e.preventDefault(); save(); }}>
    <p className="stock-hint">Rafta ve depoda gerçekte ne varsa yazın. Boş bıraktıklarınız değişmez. Mola'nın beklediği miktarla fark, fire ya da sayım hatası olarak görünür.</p>
    <ul className="stock-count-list">{list.map((i: ItemView) => {
      const value = amountOf(drafts[i.id]), diff = drafts[i.id].text.trim() && value >= 0 ? value - i.stock : null;
      return <li key={i.id} className="stock-count-row">
        <span className="stock-count-name"><strong>{i.name}</strong><small>Beklenen {formatAmount(Math.max(0, i.stock), i.unit)}{i.stock < 0 ? ' (eksiye düştü)' : ''}</small></span>
        <AmountInput label={`${i.name} sayılan miktar`} hideLabel value={drafts[i.id]} unit={i.unit} disabled={busy || uncertain} placeholder="Sayılan" onChange={d => { setCheck(''); setDrafts(x => ({ ...x, [i.id]: d })); }} />
        <span className={`stock-count-diff ${diff !== null && diff < 0 ? 'warn' : ''}`} aria-live="polite">{diff === null ? '' : Math.abs(diff) < 0.5 ? 'Fark yok' : `${diff > 0 ? '+' : ''}${formatAmount(diff, i.unit)}`}</span>
      </li>;
    })}</ul>
    {error && <Notice tone="error">{error}</Notice>}
    {check ? <UnitCheck text={check} busy={busy} onFix={() => setCheck('')} onConfirm={() => save(true)} /> :
    <div className="modal-actions stock-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || (!uncertain && !filled.length)}>{busy ? 'Kaydediliyor…' : uncertain ? 'Yeniden gönder' : `Sayımı kaydet${filled.length ? ` (${filled.length})` : ''}`}</button></div>}
  </form></Modal>;
}

function WasteForm({ view, onClose, onSaved }: { view: StockView; onClose: () => void; onSaved: (message: string) => void }) {
  const [itemId, setItemId] = useState(''), item = view.items.find(i => i.id === itemId);
  const [quantity, setQuantity] = useState<AmountDraft>(emptyAmount('g', true)), [reason, setReason] = useState(WASTE_REASONS[0]), [other, setOther] = useState(''), [check, setCheck] = useState('');
  const { send, busy, error, uncertain, setError } = useSend(onSaved);
  const q = amountOf(quantity), text = reason === 'Diğer' ? other.trim() : reason;
  // A fire ten times the shelf is almost always the wrong unit; a small one is normal (only the upward check).
  const save = (confirmed = false) => { if (!item) return setError('Malzemeyi seçin.'); if (!(q > 0)) return setError('Atılan miktarı yazın.'); if (!text) return setError('Nedenini yazın.'); const odd = unlikely(q, item.stock, item.unit, false); if (odd && !confirmed) return setCheck(odd); setCheck(''); void send({ path: '/api/staff/stock/waste', body: { requestId: requestId(), itemId, quantity: q, reason: text }, message: `${item.name}: ${formatAmount(q, item.unit)} fire kaydedildi.` }); };
  return <Modal title="Fire kaydet" className="stock-modal" onClose={() => { if (!busy) onClose(); }}><form className="modal-body stock-form" onSubmit={e => { e.preventDefault(); save(); }}>
    <ItemSelect label="Malzeme *" items={view.items} value={itemId} disabled={busy || uncertain} onChange={id => { setItemId(id); const u = view.items.find(i => i.id === id)?.unit ?? 'g'; setQuantity(d => ({ ...emptyAmount(u, true), text: d.text })); }} />
    <AmountInput label="Atılan miktar *" smallFirst value={quantity} unit={item?.unit ?? 'g'} disabled={busy || uncertain || !item} onChange={d => { setCheck(''); setQuantity(d); }} />
    <label className="stock-field"><span className="stock-label">Neden *</span><select value={reason} disabled={busy || uncertain} onChange={e => setReason(e.target.value)}>{[...WASTE_REASONS, 'Diğer'].map(r => <option key={r}>{r}</option>)}</select></label>
    {reason === 'Diğer' && <label className="stock-field"><span className="stock-label">Neden (kısaca)</span><input value={other} maxLength={120} disabled={busy || uncertain} onChange={e => setOther(e.target.value)} /></label>}
    {item && q > 0 && item.unitCost ? <p className="stock-calc">Değeri yaklaşık <b>{money(Math.round(q * item.unitCost))}</b></p> : null}
    {error && <Notice tone="error">{error}</Notice>}
    {check ? <UnitCheck text={check} busy={busy} onFix={() => setCheck('')} onConfirm={() => save(true)} />
      : <div className="modal-actions stock-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy}>{busy ? 'Kaydediliyor…' : uncertain ? 'Yeniden gönder' : 'Fireyi kaydet'}</button></div>}
  </form></Modal>;
}

/** "Ürün iade edildi, stoğa geri döndü": the product's recipe goes back into stock. Never done by a refund itself. */
function ReturnForm({ data, view, onClose, onSaved }: { data: StaffSnapshot; view: StockView; onClose: () => void; onSaved: (message: string) => void }) {
  const tracked = data.products.filter(p => view.products[p.id] && view.products[p.id].status !== 'none');
  const [productId, setProductId] = useState(''), [quantity, setQuantity] = useState('1'), product = tracked.find(p => p.id === productId);
  const { send, busy, error, uncertain, setError } = useSend(onSaved);
  const q = Number(quantity.replace(',', '.'));
  const save = () => { if (!product) return setError('Ürünü seçin.'); if (!(q > 0)) return setError('Adedi yazın.'); void send({ path: '/api/staff/stock/return', body: { requestId: requestId(), productId, quantity: q }, message: `${product.name} stoğa geri eklendi.` }); };
  return <Modal title="İade stoğa döndü" className="stock-modal" onClose={() => { if (!busy) onClose(); }}><form className="modal-body stock-form" onSubmit={e => { e.preventDefault(); save(); }}>
    <p className="stock-hint">Yalnız ürün hiç kullanılmadan geri geldiyse (ör. açılmamış şişe su) kullanın. Ürünün bugünkü reçetesindeki malzemeler stoğa eklenir. Para iadesi Kasa ve giderler → İadeler'dedir.</p>
    <label className="stock-field"><span className="stock-label">Ürün *</span><select value={productId} disabled={busy || uncertain} onChange={e => setProductId(e.target.value)}><option value="">Ürün seçin</option>{tracked.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="stock-field"><span className="stock-label">{product?.unit === 'kg' ? 'Miktar (kg) *' : 'Adet *'}</span><input inputMode="decimal" value={quantity} disabled={busy || uncertain} onKeyDown={noEnter} onChange={e => setQuantity(e.target.value)} /></label>
    {!tracked.length && <p className="stock-hint">Stok takibi olan ürün yok.</p>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="modal-actions stock-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || !tracked.length}>{busy ? 'Kaydediliyor…' : uncertain ? 'Yeniden gönder' : 'Stoğa ekle'}</button></div>
  </form></Modal>;
}

type UndoPreview = { kind: StockEntry['kind']; changes: { itemId: string; name: string; unit: StockUnit; before: number; after: number }[]; expenseKept: boolean };
const KIND_WORDS: Record<StockEntry['kind'], string> = { purchase: 'alış', count: 'sayım', waste: 'fire', return: 'iade', price: 'fiyat' };
/** "Kahve stoğu 1.000 g → 0 g olur." (a stock below zero reads as 0: sales went past it). */
export const undoLine = (c: UndoPreview['changes'][number]) => `${c.name} stoğu ${formatAmount(Math.max(0, c.before), c.unit)} → ${formatAmount(Math.max(0, c.after), c.unit)} olur.`;
/** Confirmation with the exact effect, read from the server before anything changes. */
function UndoEntry({ entry, name, figure, onClose, onSaved }: { entry: StockEntry; name: string; figure: string; onClose: () => void; onSaved: (message: string) => void }) {
  const { send, busy, error } = useSend(onSaved);
  const [preview, setPreview] = useState<UndoPreview | null>(null), [problem, setProblem] = useState('');
  useEffect(() => { let live = true; void api<UndoPreview>(`/api/staff/stock/entries/undo?id=${encodeURIComponent(entry.id)}`).then(p => { if (live) setPreview(p); }, e => { if (live) setProblem((e as Error).message); }); return () => { live = false; }; }, [entry.id]);
  const moved = preview?.changes.filter(c => Math.abs(c.after - c.before) >= 0.5) ?? [];
  return <Modal title="Bu kaydı geri al" className="stock-modal stock-undo-modal" onClose={() => { if (!busy) onClose(); }}><div className="modal-body stock-form">
    <p className="stock-undo-what"><span className={`stock-kind ${entry.kind}`}>{label(entry)}</span><span><span><b>{name}</b> · {figure}</span><small>{when(entry.at)}{entry.byName ? ` · ${entry.byName}` : ''}</small></span></p>
    {problem ? <Notice tone="error">{problem}</Notice> : !preview ? <p className="stock-hint" role="status">Stoğa etkisi hesaplanıyor…</p> : <div className="stock-undo-effect" role="status">
      <p><b>Bu {KIND_WORDS[entry.kind]} kaydı silinir.</b></p>
      {moved.length ? <ul>{moved.map(c => <li key={c.itemId}>{undoLine(c)}</li>)}</ul>
        : <p>{entry.kind === 'price' ? 'Stok değişmez; birim fiyat bir önceki fiyata döner.' : 'Stok değişmez: bu kayıttan sonra sayım yapılmış, stok o sayımdan devam ediyor.'}</p>}
    </div>}
    {preview?.expenseKept && <Notice>Bu alışla birlikte yazılan gider Kasa ve giderler → Giderler'de kalır; gerekiyorsa oradan silin.</Notice>}
    <p className="stock-hint">Kimin ne zaman geri aldığı kaydedilir; kayıt “Geri alınanlar” listesinde görünür.</p>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="modal-actions stock-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose} autoFocus>Vazgeç</button><button type="button" className="btn delete-catalog" disabled={busy || !preview} onClick={() => void send({ path: '/api/staff/stock/entries/delete', body: { id: entry.id }, message: moved.length ? `Kayıt geri alındı. ${moved.map(c => `${c.name}: ${formatAmount(Math.max(0, c.after), c.unit)}`).join(', ')}.` : 'Kayıt geri alındı.' })}>{busy ? 'Geri alınıyor…' : 'Evet, geri al'}</button></div>
  </div></Modal>;
}
