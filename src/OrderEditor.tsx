import { productQuantity, repriceSavedLine } from '../packages/domain/campaigns';
import { cartLineTotal, menuPrice, readNote, repriceWeightLine, soldByWeight, validGrams } from '../packages/domain/lines';
import { NoteField, WeightPicker } from './LineFields';
import { useEffect, useRef, useState } from 'react';
import type { CartLine, Product, PublicOrder } from '../packages/domain/types';
import { api, money, requestId } from './api';
import { Modal, Notice } from './components';
import { groupNameEn, optionNameEn } from '../packages/domain/menu-translation';
import { browserOrderStorage } from './pendingOrder';
import { clearPendingEdit, editDefinitelyRejected, pendingEditKey, writePendingEdit, type PendingEdit } from './pendingEdit';
import { OrderEditRecovery } from './OrderEditRecovery';

/** `note` and `weight` hold what is typed; toLine() turns them into the request's cleaned note and grams. */
type EditLine = Omit<CartLine, 'grams'> & { existingId?: string; key: string; note: string; weight?: string };
function toLine({ key: _, weight, note, ...l }: EditLine): CartLine & { existingId?: string } {
  const text = readNote(note);
  return { ...l, ...(text ? { note: text } : {}), ...(weight !== undefined ? { grams: Number(weight) } : {}) };
}
export function EditOrderButton({ order, seconds, onClick, en }: { order: PublicOrder; seconds: number; onClick: () => void; en: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const remaining = Math.max(0, Math.ceil(((order.editableUntil ? Date.parse(order.editableUntil) : Date.parse(order.createdAt) + seconds * 1000) - now) / 1000));
  if (!order.canEdit || !remaining) return null;
  return <button className="btn secondary small-btn" onClick={onClick}>{en ? 'Edit order' : 'Siparişi değiştir'} · {remaining} {en ? 's' : 'sn'}</button>;
}
export function OrderEditor({ order, products, seconds, guest, guestContext, available, en, onClose, onSaved }: { order: PublicOrder; products: Product[]; seconds: number; guest: string; guestContext: string; available: boolean; en: boolean; onClose: () => void; onSaved: () => void }) {
  const [lines, setLines] = useState<EditLine[]>(() => order.lines.map(l => ({ productId: l.productId, quantity: l.quantity, selections: l.selections, existingId: l.id, key: l.id, note: l.note ?? '', ...(l.grams ? { weight: String(l.grams) } : {}) })));
  // "Paketlensin" can be changed with the rest inside the edit window; it is always sent, so the server applies exactly this.
  const [packed, setPacked] = useState(!!order.packed);
  const [productId, setProductId] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [uncertain, setUncertain] = useState(false);
  const [now, setNow] = useState(Date.now()); const pending = useRef<PendingEdit | null>(null); const sending = useRef(false);
  const storageKey = pendingEditKey(location.pathname); const [storageUnavailable, setStorageUnavailable] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.ceil(((order.editableUntil ? Date.parse(order.editableUntil) : Date.parse(order.createdAt) + seconds * 1000) - now) / 1000));
  const locked = busy || uncertain || !left || !available;
  // Mirrors editOrder: unchanged choices keep the saved price (a weighed line is repriced from its saved per-kg price).
  function price(edit: EditLine) {
    const l = toLine(edit), previous = order.lines.find(x => x.id === l.existingId);
    const key = (v: CartLine) => JSON.stringify(v.selections.map(x => [x.groupId, x.optionId]).sort());
    if (previous && previous.productId === l.productId && key(previous) === key(l) && (previous.grams === undefined) === (l.grams === undefined)) return previous.grams === undefined ? repriceSavedLine(previous, l.quantity, productQuantity(lines, l.productId)).total : validGrams(l.grams) ? repriceWeightLine(previous, l.grams).total : 0;
    const p = products.find(p => p.id === l.productId);
    return p && (!soldByWeight(p) || validGrams(l.grams)) ? cartLineTotal(p, l, productQuantity(lines, l.productId)) : 0;
  }
  const invalid = (l: EditLine) => l.weight !== undefined ? !validGrams(Number(l.weight)) : !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 20;
  const total = lines.reduce((n, l) => n + price(l), 0);
  function update(key: string, update: Partial<EditLine>) { setLines(ls => ls.map(l => l.key === key ? { ...l, ...update } : l)); }
  async function save() {
    if (sending.current || locked) return; sending.current = true; setBusy(true); setError('');
    pending.current = { format: 1, number: order.number, body: { requestId: requestId(), guestContext, orderId: order.id, version: order.version, expectedTotal: total, packed, lines: lines.map(toLine) }, labels: lines.map(l => ({ name: (en ? products.find(p => p.id === l.productId)?.nameEn || undefined : undefined) ?? products.find(p => p.id === l.productId)?.name ?? order.lines.find(p => p.id === l.existingId)?.name ?? l.productId, quantity: l.quantity, ...(l.weight !== undefined ? { grams: Number(l.weight) } : {}), total: price(l) })) };
    setStorageUnavailable(!writePendingEdit(browserOrderStorage(), storageKey, pending.current));
    try { await api('/api/guest/orders/edit', pending.current.body, guest); clearPendingEdit(browserOrderStorage(), storageKey, pending.current.body.requestId); pending.current = null; onSaved(); }
    catch (e) {
      if (editDefinitelyRejected(e)) { clearPendingEdit(browserOrderStorage(), storageKey, pending.current!.body.requestId); pending.current = null; setError((e as Error).message); }
      else setUncertain(true);
    } finally { sending.current = false; setBusy(false); }
  }
  if (uncertain && pending.current) return <OrderEditRecovery pending={pending.current} storageKey={storageKey} guest={guest} en={en} storageUnavailable={storageUnavailable} onSaved={onSaved} onClose={onClose} />;
  // 8 Ekim: the time ran out with the window open. A clear pop-up over it (the small notice was missed); nothing is sent
  // (every field and the save button are locked by `locked`), and "Tamam" closes the edit window. A save already on its way
  // is left to the server's answer first.
  const expired = !left && !busy && !uncertain;
  // 9 Ekim kullanıcı testi: with waiter approval on, the order is not in the kitchen yet; the pop-up said it was.
  const awaiting = order.status === 'awaiting_approval';
  const expiredText = awaiting
    ? (en ? 'Your order is waiting for the waiter’s approval; please ask your waiter for any change.' : 'Siparişiniz garson onayında; değişiklik için garsonunuza seslenin.')
    : (en ? 'Your order has gone to the kitchen; please ask your waiter for any change.' : 'Siparişiniz mutfağa iletildi; değişiklik için garsonunuza seslenin.');
  return <>{expired && <Modal title={en ? 'Your editing time is up' : 'Değişiklik süreniz doldu'} className="edit-expired-dialog" onClose={onClose}><div className="modal-body"><p>{expiredText}</p><div className="modal-actions"><button type="button" className="btn primary full" autoFocus onClick={onClose}>{en ? 'OK' : 'Tamam'}</button></div></div></Modal>}
  <Modal title={en ? `Edit order #${order.number}` : `Sipariş #${order.number} · Değiştir`} dismissible={!busy && !uncertain} onClose={() => { if (!busy && !uncertain) onClose(); }}><div className="modal-body order-edit-body"><Notice>{left ? (en ? `${left} seconds remaining. Editing does not extend the deadline.` : `${left} saniye kaldı. Değişiklik yapmak süreyi uzatmaz.`) : (en ? 'The editing period has ended.' : 'Değiştirme süresi doldu.')}</Notice><p className="muted small">{en ? 'The new total is shown below before you save.' : 'Yeni toplamı kaydetmeden önce aşağıda görürsünüz.'}</p>
    {lines.map(l => { const p = products.find(p => p.id === l.productId); const old = order.lines.find(x => x.id === l.existingId); return <section className="edit-order-line" key={l.key}><div className="order-head"><strong>{en ? p?.nameEn || p?.name || old?.name : p?.name || old?.name}</strong><strong>{money(price(l))}</strong></div>{l.weight !== undefined ? <WeightPicker value={l.weight} onChange={v => update(l.key, { weight: v })} en={en} disabled={locked} name={p?.name || old?.name} /> : <label>{en ? 'Quantity' : 'Adet'}<input aria-label={`${p?.name || old?.name} adet`} type="number" min="1" max="20" value={l.quantity} disabled={locked} onChange={e => update(l.key, { quantity: Number(e.target.value) })} /></label>}{p?.groups.map(g => { const group = en ? groupNameEn(g) : g.name; return <label key={g.id}>{group}<select aria-label={group} disabled={locked} value={l.selections.find(s => s.groupId === g.id)?.optionId ?? ''} onChange={e => update(l.key, { selections: [...l.selections.filter(s => s.groupId !== g.id), ...(e.target.value ? [{ groupId: g.id, optionId: e.target.value }] : [])] })}><option value="" disabled={g.required}>{g.required ? (en ? 'Select' : 'Seçin') : (en ? 'Standard' : 'Standart')}</option>{g.options.map(o => <option key={o.id} value={o.id}>{en ? optionNameEn(g, o) : o.name} ({o.extra > 0 ? '+' : ''}{money(o.extra)})</option>)}</select></label>; })}<NoteField value={l.note} onChange={v => update(l.key, { note: v })} en={en} disabled={locked} name={p?.name || old?.name} product={p} /><button className="text-btn" disabled={locked} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}>{en ? 'Remove product' : 'Ürünü çıkar'}</button></section>; })}
    {!lines.length && <Notice>{en ? 'Keep at least one product, or close this window and cancel the order.' : 'En az bir ürün bırakın. Tamamını kaldırmak için pencereyi kapatıp siparişi iptal edin.'}</Notice>}
    <label>{en ? 'Add product' : 'Ürün ekle'}<select aria-label={en ? 'Add product' : 'Ürün ekle'} value={productId} disabled={locked} onChange={e => setProductId(e.target.value)}><option value="">{en ? 'Select product' : 'Ürün seçin'}</option>{products.filter(p => !p.soldOut).map(p => <option key={p.id} value={p.id}>#{p.code} · {en ? p.nameEn || p.name : p.name} · {money(menuPrice(p))}{soldByWeight(p) ? ' / kg' : ''}</option>)}</select></label><button className="btn secondary" disabled={locked || !productId || lines.length >= 30} onClick={() => { const p = products.find(p => p.id === productId)!; setLines(ls => [...ls, { key: requestId(), productId, quantity: 1, note: '', selections: p.groups.filter(g => g.required).map(g => ({ groupId: g.id, optionId: g.options[0].id })), ...(soldByWeight(p) ? { weight: '500' } : {}) }]); setProductId(''); }}>{en ? 'Add selected product' : 'Seçili ürünü ekle'}</button>
    <label className="checkbox-label packed-choice"><input type="checkbox" checked={packed} disabled={locked} onChange={e => setPacked(e.target.checked)} />{en ? 'Pack it to go' : 'Paketlensin (yanımda götüreceğim)'}</label>
    {error && <Notice tone="error">{error}</Notice>}<div className="total-line"><span>{en ? 'New total' : 'Yeni toplam'}</span><strong>{money(total)}</strong></div><button className="btn primary full" disabled={busy || (!uncertain && (locked || !lines.length || lines.some(invalid)))} onClick={() => void save()}>{busy ? (en ? 'Saving…' : 'Kaydediliyor…') : uncertain ? (en ? 'Check update' : 'Değişikliği yeniden kontrol et') : (en ? 'Save changes' : 'Değişiklikleri kaydet')}</button></div></Modal></>;
}
