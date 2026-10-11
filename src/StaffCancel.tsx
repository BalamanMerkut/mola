import { useRef, useState } from 'react';
import { Minus, Plus, XCircle } from 'lucide-react';
import type { PublicOrder, Role } from '../packages/domain/types';
import { amountLabel, CANCEL_REASON_MAX, CANCEL_REASONS, readCancelReason } from '../packages/domain/lines';
import { api, ApiError, requestId } from './api';
import { Modal, Notice } from './components';
import { StockAnswer, STOCK_QUESTION } from './StockQuestions';

/** Who may cancel orders or items: waiter and kitchen, the owner as supervisor. The cashier takes the money, so never. */
export const canCancel = (role: Role) => role === 'waiter' || role === 'kitchen' || role === 'owner' || role === 'manager';
/** QR orders waiting for approval are closed with "Reddet"; cancelled ones are done. */
export const orderCancellable = (o: PublicOrder) => !['cancelled', 'awaiting_approval'].includes(o.status);

type Body = { requestId: string; orderId: string; version: number; reason: string; lines?: { lineId: string; quantity: number }[]; stockUsed?: boolean };
/** The kitchen had started (or served) it: cancelling asks whether its stock was used (server/stock.ts answer). */
export const kitchenStarted = (o: PublicOrder) => ['preparing', 'ready', 'served'].includes(o.status);
/**
 * Cancel a whole order or some of its items, with a reason (chips for the usual ones, free text for the rest). Paid items
 * cannot be chosen: their money goes back only as a refund (İade ve düzeltme), which the window explains. The kitchen gets an
 * İPTAL slip when the order was already printed. A retry after a lost answer resends the same request, never a second one.
 */
export function StaffCancel({ order, kitchen = false, tracked, onClose, onDone }: { order: PublicOrder; kitchen?: boolean; tracked?: string[]; onClose: () => void; onDone: (message: string) => void }) {
  const paid = (id: string) => order.paidQuantities?.[id] ?? 0;
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [preset, setPreset] = useState(''), [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<Body | null>(null);
  const reason = readCancelReason(text.trim() || preset);
  const chosen = order.lines.filter(l => (counts[l.id] ?? 0) > 0);
  const whole = order.lines.every(l => (counts[l.id] ?? 0) === l.quantity);
  const anyPaid = order.lines.some(l => paid(l.id) > 0);
  // Only the kitchen answers here; a waiter's or the owner's cancellation leaves the question on the kitchen screen.
  const [used, setUsed] = useState<boolean | null>(null);
  const ask = kitchen && kitchenStarted(order) && chosen.some(l => tracked?.includes(l.productId));
  const set = (id: string, n: number) => { if (!pending.current) setCounts(c => ({ ...c, [id]: n })); };
  async function submit() {
    if (busy || (!pending.current && (!chosen.length || !reason || (ask && used === null)))) return;
    setBusy(true); setError('');
    pending.current ??= { requestId: requestId(), orderId: order.id, version: order.version, reason: reason!, ...(whole ? {} : { lines: chosen.map(l => ({ lineId: l.id, quantity: counts[l.id] })) }), ...(ask && used !== null ? { stockUsed: used } : {}) };
    try {
      const r = await api<{ cancelled: 'order' | 'items'; refused?: { lineId: string; name: string; reason: string }[] }>('/api/staff/orders/cancel', pending.current);
      // A line the rules refused does not stop the others: they are cancelled and the refused one is named with its reason.
      const refused = r.refused ?? [], count = chosen.filter(l => !refused.some(x => x.lineId === l.id)).reduce((n, l) => n + (l.grams ? 1 : counts[l.id]), 0);
      pending.current = null;
      onDone((r.cancelled === 'order' ? `Sipariş #${order.number} iptal edildi.` : `Sipariş #${order.number}: ${count} ürün iptal edildi.`) + refused.map(x => ` İptal edilmedi: ${x.name}. ${x.reason}`).join(''));
    } catch (e) {
      // A definite answer (refused, changed) ends this attempt; a lost connection keeps it for "Yeniden kontrol et".
      if (e instanceof ApiError && e.status < 500) pending.current = null;
      setError(e instanceof ApiError ? e.message : 'Bağlantı kesildi. Aynı iptali yeniden kontrol edin; ikinci kez uygulanmaz.');
    } finally { setBusy(false); }
  }
  return <Modal title={`Sipariş #${order.number} · İptal`} onClose={() => { if (!busy) onClose(); }}><div className="modal-body staff-cancel">
    <p className="muted small">{order.takeaway ? order.tableName : `${order.tableName} · ${order.guestLabel}`}. İptal edilecek ürünleri ve nedenini seçin.{order.printedTo?.length ? ' Mutfağa İPTAL fişi gider.' : ''}</p>
    <div className="staff-cancel-lines">{order.lines.map(l => {
      // What the server would accept for this line alone: unpaid pieces, fewer when a paid item's campaign price or money
      // already taken depends on them (StaffSnapshot `cancelLimits`, engine.ts cancelLimits).
      const limit = order.cancelLimits?.[l.id], free = Math.min(l.quantity - paid(l.id), limit?.max ?? Infinity), n = counts[l.id] ?? 0;
      return <div className={`staff-cancel-line ${n ? 'chosen' : ''}`} key={l.id}>
        <div className="grow"><strong>{amountLabel(l)} {l.name}</strong>{l.optionNames.length > 0 && <small>{l.optionNames.join(' · ')}</small>}{paid(l.id) > 0 && <small className="paid-label">{paid(l.id) >= l.quantity ? 'Ödendi · iptal edilemez' : `${paid(l.id)} adet ödendi · iptal edilemez`}</small>}{limit && <small className="paid-label cancel-limit">{limit.max > 0 && !l.grams ? `En çok ${limit.max} adet iptal edilebilir. ` : ''}{limit.reason}</small>}</div>
        {free > 0 && (l.grams || l.quantity === 1
          ? <label className="checkbox-label"><input type="checkbox" checked={n > 0} disabled={busy || !!pending.current} onChange={e => set(l.id, e.target.checked ? l.quantity : 0)} aria-label={`${l.name} iptal`} />İptal</label>
          : <div className="stepper" role="group" aria-label={`${l.name} iptal adedi`}><button type="button" aria-label={`${l.name} · bir az iptal`} disabled={busy || !n || !!pending.current} onClick={() => set(l.id, n - 1)}><Minus size={15} /></button><strong>{n}</strong><button type="button" aria-label={`${l.name} · bir daha iptal`} disabled={busy || n >= free || !!pending.current} onClick={() => set(l.id, n + 1)}><Plus size={15} /></button></div>)}
      </div>;
    })}</div>
    {!anyPaid && !order.cancelLimits && <button type="button" className="text-btn" disabled={busy || !!pending.current} onClick={() => setCounts(Object.fromEntries(order.lines.map(l => [l.id, l.quantity])))}>Siparişin tamamını seç</button>}
    {(anyPaid || !!order.cancelLimits) && <Notice>Ödenmiş ürünler iptal edilemez. Parası geri verilecekse işletme sahibi Kasa ve giderler → İadeler'den iadeyi kaydeder.</Notice>}
    <fieldset className="cancel-reasons" disabled={busy || !!pending.current}><legend>İptal nedeni *</legend>
      <div className="reason-chips">{CANCEL_REASONS.map(r => <button type="button" key={r} aria-pressed={preset === r && !text.trim()} className={preset === r && !text.trim() ? 'selected' : ''} onClick={() => { setPreset(r); setText(''); }}>{r}</button>)}</div>
      <label>Başka bir neden<input value={text} maxLength={CANCEL_REASON_MAX} placeholder="Örn. Müşteri masadan kalktı" onChange={e => setText(e.target.value)} /></label>
    </fieldset>
    {!reason && chosen.length > 0 && <p className="option-hint" role="status">Bir neden seçin ya da yazın.</p>}
    {ask && <div className="stock-answer-box"><p>{STOCK_QUESTION}</p><StockAnswer busy={busy || !!pending.current} chosen={used} onAnswer={setUsed} /></div>}
    {kitchen && <p className="muted small">Fiyat ve ödeme bilgisi kasada görünür.</p>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="modal-actions"><button type="button" className="btn secondary" disabled={busy || !!pending.current} onClick={onClose}>Vazgeç</button><button type="button" className="btn danger" disabled={busy || (!pending.current && (!chosen.length || !reason || (ask && used === null)))} onClick={() => void submit()}><XCircle size={17} />{busy ? 'Kaydediliyor…' : pending.current ? 'Yeniden kontrol et' : whole ? 'Siparişi iptal et' : 'Seçilenleri iptal et'}</button></div>
  </div></Modal>;
}
