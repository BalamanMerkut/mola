import { useMemo, useRef, useState } from 'react';
import { Minus, Plus, Replace } from 'lucide-react';
import type { CartLine, OrderLine, Product, PublicOrder, Selection } from '../packages/domain/types';
import { productQuantity, repriceSavedLine } from '../packages/domain/campaigns';
import { amountLabel, cartLineTotal, changeSideText, readNote, repriceWeightLine, soldByWeight, validGrams } from '../packages/domain/lines';
import { changeBlock, changeableLines, readyMade } from '../packages/domain/order-change';
import { api, ApiError, money, requestId } from './api';
import { Modal, Notice } from './components';
import { NoteField, WeightPicker } from './LineFields';

/*
 * Garson siparişi değiştirir (11 Ekim, hafta sonu bulgusu 5; packages/domain/order-change.ts): one line of an order becomes
 * another product, quantity, options or note while the kitchen has not started it. The window shows the old and the new
 * line and the difference on the bill before saving; the server prices it again (engine.ts changeByStaff) and the kitchen
 * card says "Değişti: Kola → Ayran" (a printed order also gets a DEĞİŞİKLİK slip). A retry after a lost answer resends the
 * same request, never a second change.
 */
const key = (selections: Selection[]) => JSON.stringify(selections.map(x => [x.groupId, x.optionId]).sort());
/** Staff snapshots carry option names, not ids: the ids are found again on the product (names are unique within a group). */
function selectionsOf(p: Product | undefined, l: Pick<OrderLine, 'optionNames'>): Selection[] {
  if (!p) return [];
  return p.groups.flatMap(g => { const o = g.options.find(o => l.optionNames.includes(o.name)); return o ? [{ groupId: g.id, optionId: o.id }] : []; });
}
type Draft = { productId: string; quantity: number; selections: Selection[]; note: string; weight?: string };
const draftOf = (products: Product[], l: OrderLine): Draft => ({ productId: l.productId, quantity: l.quantity, selections: selectionsOf(products.find(p => p.id === l.productId), l), note: l.note ?? '', ...(l.grams ? { weight: String(l.grams) } : {}) });

type ShownChange = NonNullable<PublicOrder['changes']>[number];
const clock = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
/** "Değişti: 1 x Ayran → 1 x Kola · +₺5 · Garson · 21:40": what changed, the bill's difference, who and when (the counter reads it before taking the money). */
export function changeLine(c: ShownChange, who = true) {
  return `Değişti: ${changeSideText(c.from)} → ${changeSideText(c.to)}${c.to.note && c.to.note !== c.from.note ? ` · Not: ${c.to.note}` : ''}${c.delta ? ` · ${c.delta > 0 ? '+' : '−'}${money(Math.abs(c.delta))}` : ''}${who && c.byName ? ` · ${c.byName}` : ''} · ${clock(c.at)}`;
}
/** The changes under an order (table window, kitchen card: the kitchen gets no ready-made swaps and no money). */
export function OrderChanges({ order, who = true }: { order: Pick<PublicOrder, 'changes'>; who?: boolean }) {
  if (!order.changes?.length) return null;
  return <div className="order-change-list">{order.changes.map(c => <p key={c.id} className={`order-change-notice order-line-change${c.ready ? ' ready-change' : ''}`}>{changeLine(c, who)}</p>)}</div>;
}
/**
 * The table window's part for one order: "Değiştir" while a line may change; once the kitchen started (or after serving)
 * the one line that says which way remains, and "Hazır ürünü değiştir" while a ready-made product (kola, ayran…) is unpaid.
 */
export function ChangeOpener({ order, products, ticketMode, onOpen }: { order: PublicOrder; products: Product[]; ticketMode: boolean; onOpen: () => void }) {
  if (order.status === 'cancelled' || order.external) return null;
  const blocked = changeBlock(order, ticketMode), { lines, readyOnly } = changeableLines(order, products, ticketMode);
  if (!blocked) return <button type="button" className="text-btn staff-change-open" aria-label={`Sipariş #${order.number} · değiştir`} onClick={onOpen}>Değiştir</button>;
  return <>{order.status !== 'served' && <p className="change-block-note">{blocked}</p>}{readyOnly && lines.length > 0 && <button type="button" className="text-btn staff-change-open" aria-label={`Sipariş #${order.number} · hazır ürünü değiştir`} onClick={onOpen}>Hazır ürünü değiştir</button>}</>;
}
export function StaffChange({ order, products, ticketMode, line: firstLine, onClose, onDone }: { order: PublicOrder; products: Product[]; ticketMode: boolean; line?: string; onClose: () => void; onDone: (message: string) => void }) {
  // Once the kitchen started, only ready-made products (kola, ayran…) may still be swapped, for another ready-made one.
  const { lines: open, readyOnly } = changeableLines(order, products, ticketMode);
  const [lineId, setLineId] = useState(firstLine && open.some(l => l.id === firstLine) ? firstLine : open[0]?.id ?? '');
  const old = order.lines.find(l => l.id === lineId);
  const [draft, setDraft] = useState<Draft | null>(() => old ? draftOf(products, old) : null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<object | null>(null);
  const blocked = open.length ? null : changeBlock(order, ticketMode) ?? 'Bu siparişte değiştirilebilecek ürün kalmadı.';
  const product = draft ? products.find(p => p.id === draft.productId) : undefined;
  const sellable = useMemo(() => products.filter(p => p.published !== false && (!p.soldOut || p.id === old?.productId) && (!readyOnly || readyMade(p))), [products, old?.productId, readyOnly]);
  const categories = [...new Set(sellable.map(p => p.category || 'Diğer'))];
  const toLine = (d: Draft): CartLine => { const note = readNote(d.note); return { productId: d.productId, quantity: d.weight !== undefined ? 1 : d.quantity, selections: d.selections, ...(note ? { note } : {}), ...(d.weight !== undefined ? { grams: Number(d.weight) } : {}) }; };
  // Mirrors engine.ts relined: kept product and options keep the saved price; a new product or options is today's menu price.
  const lines = draft && old ? order.lines.map(l => l.id === old.id ? toLine(draft) : { productId: l.productId, quantity: l.quantity, selections: selectionsOf(products.find(p => p.id === l.productId), l), ...(l.grams ? { grams: l.grams } : {}) }) : [];
  function price(l: CartLine, previous: OrderLine) {
    if (previous.productId === l.productId && key(selectionsOf(products.find(p => p.id === previous.productId), previous)) === key(l.selections) && (previous.grams === undefined) === (l.grams === undefined))
      return previous.grams === undefined ? repriceSavedLine(previous, l.quantity, productQuantity(lines, l.productId)).total : validGrams(l.grams) ? repriceWeightLine(previous, l.grams!).total : 0;
    const p = products.find(p => p.id === l.productId);
    return p && (!soldByWeight(p) || validGrams(l.grams)) ? cartLineTotal(p, l, productQuantity(lines, l.productId)) : 0;
  }
  const total = lines.reduce((n, l, i) => n + price(l, order.lines[i]), 0);
  const newLine = draft && old ? price(lines[order.lines.indexOf(old)], old) : 0;
  const missing = !!product && product.groups.some(g => g.required && !draft!.selections.some(s => s.groupId === g.id));
  const invalid = !draft || !product || missing || (draft.weight !== undefined ? !validGrams(Number(draft.weight)) : draft.quantity < 1 || draft.quantity > 20);
  const same = !!draft && !!old && draft.productId === old.productId && key(draft.selections) === key(selectionsOf(product, old)) && (draft.weight === undefined ? draft.quantity === old.quantity : Number(draft.weight) === old.grams) && (readNote(draft.note) ?? '') === (old.note ?? '');
  function choose(id: string) {
    const l = order.lines.find(x => x.id === id); if (!l || pending.current) return;
    setLineId(id); setDraft(draftOf(products, l)); setError('');
  }
  function pickProduct(id: string) {
    const p = products.find(x => x.id === id); if (!p || !draft) return;
    // A new product starts with its required options on the first choice; the note stays (it was the guest's wish).
    setDraft({ productId: p.id, quantity: draft.weight !== undefined ? 1 : draft.quantity, note: draft.note, selections: p.id === old?.productId ? selectionsOf(p, old) : p.groups.filter(g => g.required).map(g => ({ groupId: g.id, optionId: g.options[0].id })), ...(soldByWeight(p) ? { weight: p.id === old?.productId && old?.grams ? String(old.grams) : '500' } : {}) });
  }
  async function save() {
    if (busy || (!pending.current && (invalid || same || !old || !draft))) return;
    setBusy(true); setError('');
    pending.current ??= { requestId: requestId(), orderId: order.id, version: order.version, lineId: old!.id, line: toLine(draft!), expectedTotal: total };
    try {
      const r = await api<{ from: string; to: string; slip: boolean; ready: boolean; delta: number }>('/api/staff/orders/change', pending.current);
      pending.current = null;
      onDone(`Sipariş #${order.number} değişti: ${r.from} → ${r.to}.${r.delta ? ` Hesaba ${r.delta > 0 ? '+' : '−'}${money(Math.abs(r.delta))} yansıdı.` : ''}${r.slip ? ' Mutfağa DEĞİŞİKLİK fişi gidiyor.' : ''}`);
    } catch (e) {
      // A definite answer ends this attempt; a lost connection keeps it for "Yeniden kontrol et" (applied once at most).
      if (e instanceof ApiError && e.status < 500) pending.current = null;
      setError(e instanceof ApiError ? e.message : 'Bağlantı kesildi. Aynı değişikliği yeniden kontrol edin; ikinci kez uygulanmaz.');
    } finally { setBusy(false); }
  }
  const locked = busy || !!pending.current;
  const where = order.takeaway ? order.tableName : `${order.tableName} · ${order.guestLabel}`;
  return <Modal title={`Sipariş #${order.number} · Değiştir`} onClose={() => { if (!busy) onClose(); }}><div className="modal-body staff-cancel staff-change">
    {blocked ? <><Notice>{blocked}</Notice><div className="modal-actions"><button type="button" className="btn primary" onClick={onClose}>Tamam</button></div></> : <>
      {readyOnly ? <p className="muted small">{where}. Hazır ürün (kola, ayran, su…): hesap ödenene kadar başka bir hazır ürünle ya da adediyle değiştirilebilir. Mutfak uyarılmaz; fiyat farkı hesaba yansır ve kasada görünür.</p>
        : <p className="muted small">{where}. Mutfak henüz başlamadı: bir ürünü başka ürünle, adediyle, seçeneğiyle ya da notuyla değiştirebilirsiniz.{order.printedTo?.length ? ' Fiş basıldı: mutfağa DEĞİŞİKLİK fişi çıkar.' : ''}</p>}
      {open.length > 1 && <fieldset className="change-line-pick" disabled={locked}><legend>Hangi ürün değişsin?</legend>
        {open.map(l => <label key={l.id} className={`checkbox-label${l.id === lineId ? ' selected' : ''}`}><input type="radio" name="change-line" checked={l.id === lineId} onChange={() => choose(l.id)} />{amountLabel(l)} {l.name}{l.optionNames.length ? ` · ${l.optionNames.join(', ')}` : ''}</label>)}
      </fieldset>}
      {draft && old && <section className="edit-order-line">
        <label>Yeni ürün<select aria-label="Yeni ürün" value={draft.productId} disabled={locked} onChange={e => pickProduct(e.target.value)}>
          {categories.map(c => <optgroup key={c} label={c}>{sellable.filter(p => (p.category || 'Diğer') === c).map(p => <option key={p.id} value={p.id}>{p.name}{p.soldOut ? ' · tükendi' : ''}</option>)}</optgroup>)}
        </select></label>
        {draft.weight !== undefined ? <WeightPicker value={draft.weight} onChange={v => setDraft({ ...draft, weight: v })} en={false} disabled={locked} name={product?.name} />
          : <div className="change-quantity"><span>Adet</span><div className="stepper" role="group" aria-label="Adet"><button type="button" aria-label="Bir azalt" disabled={locked || draft.quantity <= 1} onClick={() => setDraft({ ...draft, quantity: draft.quantity - 1 })}><Minus size={15} /></button><strong>{draft.quantity}</strong><button type="button" aria-label="Bir artır" disabled={locked || draft.quantity >= 20} onClick={() => setDraft({ ...draft, quantity: draft.quantity + 1 })}><Plus size={15} /></button></div></div>}
        {product?.groups.map(g => <label key={g.id}>{g.name}<select aria-label={g.name} disabled={locked} value={draft.selections.find(s => s.groupId === g.id)?.optionId ?? ''} onChange={e => setDraft({ ...draft, selections: [...draft.selections.filter(s => s.groupId !== g.id), ...(e.target.value ? [{ groupId: g.id, optionId: e.target.value }] : [])] })}><option value="" disabled={g.required}>{g.required ? 'Seçin' : 'Standart'}</option>{g.options.map(o => <option key={o.id} value={o.id}>{o.name}{o.extra ? ` (+${money(o.extra)})` : ''}</option>)}</select></label>)}
        <NoteField value={draft.note} onChange={v => setDraft({ ...draft, note: v })} en={false} disabled={locked} name={product?.name} product={product} />
      </section>}
      {draft && old && <div className="change-summary" aria-live="polite">
        <p><span className="muted">Eski</span> <strong>{amountLabel(old)} {old.name}</strong>{old.optionNames.length ? <small> · {old.optionNames.join(', ')}</small> : null} <span>{money(old.total)}</span></p>
        <p><span className="muted">Yeni</span> <strong>{draft.weight !== undefined ? `${draft.weight} g` : draft.quantity} {product?.name ?? old.name}</strong> <span>{money(newLine)}</span></p>
        <div className="total-line"><span>Hesap farkı</span><strong>{total - order.total === 0 ? 'Fark yok' : `${total > order.total ? '+' : '−'}${money(Math.abs(total - order.total))}`}</strong></div>
      </div>}
      {missing && <p className="option-hint" role="status">Zorunlu seçenekleri seçin.</p>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="modal-actions"><button type="button" className="btn secondary" disabled={locked} onClick={onClose}>Vazgeç</button><button type="button" className="btn primary" disabled={busy || (!pending.current && (invalid || same))} onClick={() => void save()}><Replace size={17} aria-hidden="true" />{busy ? 'Kaydediliyor…' : pending.current ? 'Yeniden kontrol et' : same ? 'Bir değişiklik yapın' : 'Değişikliği kaydet'}</button></div>
    </>}
  </div></Modal>;
}
