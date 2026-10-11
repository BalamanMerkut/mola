import { useRef, useState } from 'react';
import { Check, CircleAlert } from 'lucide-react';
import { api, ApiError, requestId } from './api';
import type { PublicOrder } from '../packages/domain/types';
import { StockAnswer, STOCK_QUESTION } from './StockQuestions';
/**
 * A guest's cancel request on a kitchen card: approve or decline with a short note. When the kitchen had already started the
 * order and a product has a recipe, approving asks "Bu üründen stok kullanıldı mı?" first (two buttons that approve).
 */
export function KitchenCancellation({ order, tracked, onSaved }: { order: PublicOrder; tracked?: string[]; onSaved: () => Promise<void> }) {
 const [busy, setBusy] = useState(false), [error, setError] = useState('');
 const [declining, setDeclining] = useState(false), [reason, setReason] = useState(''), [asking, setAsking] = useState(false);
 const pending = useRef<{ requestId: string; orderId: string; version: number; reason?: string; stockUsed?: boolean } | null>(null);
 const ask = ['preparing', 'ready'].includes(order.status) && order.lines.some(l => tracked?.includes(l.productId));
 async function approve(decline = false, stockUsed?: boolean) {
  if (busy) return;
  setBusy(true); setError('');
  pending.current ??= { requestId: requestId(), orderId: order.id, version: order.version, ...(decline ? { reason: reason.trim() } : {}), ...(stockUsed !== undefined ? { stockUsed } : {}) };
  try { await api(pending.current.reason !== undefined ? '/api/staff/cancel-decline' : '/api/staff/cancel', pending.current); pending.current = null; await onSaved(); }
  catch (e) { if (e instanceof ApiError && e.status < 500) pending.current = null; setError((e as Error).message); }
  finally { setBusy(false); }
 }
 // The kitchen decides here, so the decision is the card's main action instead of a locked "waiting" button.
 return <div className="kitchen-cancellation"><span className="kitchen-cancel-title"><CircleAlert size={15} />Müşteri iptal istiyor</span>
  {!declining && !asking && <div className="kitchen-cancel-actions"><button className="btn primary" disabled={busy} onClick={() => { if (ask && !pending.current) setAsking(true); else void approve(false, pending.current?.stockUsed); }}><Check size={16} />{busy ? 'Kaydediliyor…' : pending.current ? 'Yeniden kontrol et' : 'İptali onayla'}</button>{!pending.current && <button className="btn secondary" disabled={busy} onClick={() => setDeclining(true)}>Reddet</button>}</div>}
  {asking && !declining && <div className="stock-answer-box"><p>{STOCK_QUESTION}</p><StockAnswer busy={busy} onAnswer={used => void approve(false, used)} /><button type="button" className="text-btn" disabled={busy || !!pending.current} onClick={() => setAsking(false)}>Vazgeç</button></div>}
  {declining && <form onSubmit={e => { e.preventDefault(); void approve(true); }}><label>Kısa açıklama<textarea required minLength={3} maxLength={200} rows={2} disabled={busy || !!pending.current} placeholder="Örn. Siparişinizin hazırlığı tamamlandı." value={reason} onChange={e => setReason(e.target.value)} /></label><div className="table-management-actions"><button className="btn secondary small-btn" disabled={busy || reason.trim().length < 3}>{busy ? 'Kaydediliyor…' : pending.current ? 'Yeniden kontrol et' : 'Talebi reddet'}</button><button type="button" className="text-btn" disabled={busy || !!pending.current} onClick={() => { setDeclining(false); setError(''); }}>Vazgeç</button></div></form>}
  {error && <p role="alert">{error}</p>}</div>;
}
