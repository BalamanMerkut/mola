import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock, X } from 'lucide-react';
import { PlatformBadge, platformColour } from './PlatformBadge';
import { deliveryText, externalName, REJECT_REASONS, type ExternalSource } from '../packages/domain/platforms';
import type { PublicExternalOrder } from '../packages/domain/external-orders';
import type { PublicOrder, Role } from '../packages/domain/types';
import { api, money, requestId } from './api';
import { Modal, Notice } from './components';
import './external-orders.css';

// Delivery platform orders on staff screens: the platform's name on its own colour (text only, no logos), the
// "Onay bekliyor" cards with the platform's accept countdown, and the kitchen card heading "YEMEKSEPETI #1234".

export { PlatformBadge, PlatformHeading } from './PlatformBadge';
const colour = platformColour;
/** Under the heading: how it leaves, whether it is paid, and the customer's note. */
export function PlatformDetails({ source, kitchen = false }: { source: ExternalSource; kitchen?: boolean }) {
  return <div className="platform-details"><span>{deliveryText(source)}</span>{!kitchen && <span>{source.paidOnline ? 'Çevrimiçi ödendi' : 'Kapıda ödeme'}</span>}{source.note && <p className="platform-note">Not: {source.note}</p>}</div>;
}

function useClock(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [active]);
  return now;
}
/** Fixed-width "4:59" so the card never jumps while it counts down. */
function Countdown({ until, now }: { until?: string; now: number }) {
  if (!until) return <span className="accept-countdown none" aria-hidden="true" />;
  const left = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
  return <span className={`accept-countdown ${left <= 60 ? 'urgent' : ''}`} role="timer" aria-label={left ? `Onay için kalan süre ${Math.floor(left / 60)} dakika ${left % 60} saniye` : 'Onay süresi doldu'}><Clock size={14} aria-hidden="true" />{left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Süre doldu'}</span>;
}

/**
 * Platform orders waiting for Kabul/Reddet, and platform calls that did not go through yet. Owner and cashier on Masalar,
 * the kitchen above its board; only while there is something to show. `kitchen`: no prices.
 */
export function ExternalInbox({ orders, role, onSaved }: { orders: PublicExternalOrder[]; role: Role; onSaved: () => void }) {
  const kitchen = role === 'kitchen';
  const waiting = orders.filter(o => o.stage === 'pending'), stuck = orders.filter(o => o.stage !== 'pending' && (o.error || o.outbox.length));
  const now = useClock(waiting.some(o => o.acceptBy));
  const [busy, setBusy] = useState(''), [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<PublicExternalOrder | null>(null), [reason, setReason] = useState<string>(REJECT_REASONS[0]), [other, setOther] = useState('');
  async function run(id: string, path: string, body: object) {
    if (busy) return;
    setBusy(id); setError(null);
    try { await api(path, { requestId: requestId(), ...body }); setRejecting(null); onSaved(); }
    catch (e) { setError({ id, text: (e as Error).message }); onSaved(); } finally { setBusy(''); }
  }
  if (!waiting.length && !stuck.length) return null;
  return <section className="panel external-inbox" aria-label="Platform siparişleri">
    {waiting.length > 0 && <div className="section-heading"><h2>Platform siparişi onay bekliyor <span>{waiting.length} bekleyen</span></h2></div>}
    <div className="external-cards">{waiting.map(o => <article className="external-card" key={o.id} style={colour(o)} aria-label={`${externalName(o)} · onay bekliyor`}>
      <div className="external-card-head"><PlatformBadge source={o} code /><Countdown until={o.acceptBy} now={now} /></div>
      <p className="external-meta">{o.customerName && <strong>{o.customerName}</strong>}<span>{deliveryText(o)}</span>{!kitchen && <span>{o.paidOnline ? 'Çevrimiçi ödendi' : 'Kapıda ödeme'}</span>}</p>
      <ul className="external-items">{o.items.map((item, i) => <li key={i}><span className="qty-badge">{item.quantity}</span><div className="grow"><strong>{item.productName ?? item.name}</strong>{item.productName && item.productName !== item.name && <small>Platformda: {item.name}</small>}{!!item.options?.length && <small>{item.options.join(' · ')}</small>}{item.note && <small>Not: {item.note}</small>}{item.unmatched && <small className="unmatched-warning"><AlertTriangle size={13} aria-hidden="true" />Menüde eşleşmeyen ürün</small>}</div>{!kitchen && <span>{money(item.unitPrice * item.quantity)}</span>}</li>)}</ul>
      {o.note && <p className="platform-note">Müşteri notu: {o.note}</p>}
      {!kitchen && <div className="total-line"><span>Toplam</span><strong>{money(o.total)}</strong></div>}
      {(error?.id === o.id || o.error) && <Notice tone="error">{error?.id === o.id ? error.text : `Son deneme: ${o.error}`}</Notice>}
      <div className="external-actions"><button className="btn primary" disabled={!!busy} onClick={() => void run(o.id, '/api/staff/integrations/orders/accept', { id: o.id, version: o.version })}><Check size={17} />{busy === o.id ? 'Gönderiliyor…' : 'Kabul et'}</button><button className="btn secondary" disabled={!!busy} onClick={() => { setRejecting(o); setReason(REJECT_REASONS[0]); setOther(''); }}><X size={17} />Reddet</button></div>
    </article>)}</div>
    {stuck.map(o => <div className="external-stuck" key={o.id}><PlatformBadge source={o} code /><span className="grow">{o.error ? `Platforma iletilemedi: ${o.error}. Kendiliğinden yeniden deneniyor.` : 'Platforma bildiriliyor…'}</span><button className="btn secondary small-btn" disabled={!!busy} onClick={() => void run(o.id, '/api/staff/integrations/orders/retry', { id: o.id })}>Şimdi dene</button></div>)}
    {rejecting && <Modal title={`${externalName(rejecting)} · Reddet`} onClose={() => { if (!busy) setRejecting(null); }}><form className="modal-body external-reject" onSubmit={e => { e.preventDefault(); void run(rejecting.id, '/api/staff/integrations/orders/reject', { id: rejecting.id, version: rejecting.version, reason: reason === 'Diğer' ? other.trim() : reason }); }}>
      <fieldset><legend>Ret nedeni (platforma iletilir)</legend>{REJECT_REASONS.map(r => <label key={r} className="radio-row"><input type="radio" name="reject-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />{r}</label>)}</fieldset>
      {reason === 'Diğer' && <label>Kısa açıklama *<input value={other} maxLength={120} onChange={e => setOther(e.target.value)} /></label>}
      {error?.id === rejecting.id && <Notice tone="error">{error.text}</Notice>}
      <button className="btn primary full" disabled={!!busy || (reason === 'Diğer' && other.trim().length < 3)}>{busy ? 'Gönderiliyor…' : 'Siparişi reddet'}</button>
    </form></Modal>}
  </section>;
}

/** Kitchen/owner "İptal et" on an accepted platform order: tells the platform; a paid-online order needs no refund here. */
export function ExternalCancel({ order, onDone }: { order: PublicOrder; onDone: () => void }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState<string>(REJECT_REASONS[0]), [other, setOther] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function send() {
    setBusy(true); setError('');
    try { await api('/api/staff/integrations/orders/cancel', { requestId: requestId(), orderId: order.id, orderVersion: order.version, reason: reason === 'Diğer' ? other.trim() : reason }); setOpen(false); onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!order.external) return null;
  return <><button type="button" className="text-btn kitchen-cancel-open" aria-label={`Sipariş #${order.number} · iptal et`} onClick={() => { setOpen(true); setError(''); }}>İptal et</button>
    {open && <Modal title={`${externalName(order.external)} · İptal`} onClose={() => { if (!busy) setOpen(false); }}><div className="modal-body external-reject"><p className="muted small">İptal platforma bildirilir.{order.external.paidOnline ? ' Müşterinin ödemesini platform iade eder; kasada iade gerekmez.' : ''}</p>
      <fieldset><legend>İptal nedeni</legend>{REJECT_REASONS.map(r => <label key={r} className="radio-row"><input type="radio" name="cancel-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />{r}</label>)}</fieldset>
      {reason === 'Diğer' && <label>Kısa açıklama *<input value={other} maxLength={120} onChange={e => setOther(e.target.value)} /></label>}
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn primary full" disabled={busy || (reason === 'Diğer' && other.trim().length < 3)} onClick={() => void send()}>{busy ? 'Gönderiliyor…' : 'Siparişi iptal et'}</button></div></Modal>}</>;
}
