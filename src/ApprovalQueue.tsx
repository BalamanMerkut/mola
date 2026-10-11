import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { StaffSnapshot } from '../packages/domain/types';
import { api, requestId } from './api';
import { Notice, OrderLines } from './components';
import { HelpTip } from './HelpTip';

/**
 * QR orders waiting for approval: waiters, the kitchen and the owner (as supervisor) approve or reject; the cashier only
 * sees the state on the table. onlyWaiting: the queue appears only while a QR order actually waits, without the settings
 * switch. kitchen: no prices (the kitchen never sees money) and a heading the kitchen reads at a glance.
 */
/** `compact` (the waiter's phone on Masalar, 8 Ekim): one short line "2 QR siparişi onay bekliyor · Göster" until opened, so the table grid stays on the first screen. */
export function ApprovalQueue({ data, onSaved, onlyWaiting = false, kitchen = false, compact = false }: { data: StaffSnapshot; onSaved: () => void; onlyWaiting?: boolean; kitchen?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [automatic, setAutomatic] = useState(!!data.autoApproveQr);
  useEffect(() => { if (!busy) setAutomatic(!!data.autoApproveQr); }, [data.autoApproveQr, data.approvalVersion]);
  const [rejecting, setRejecting] = useState(''), [reason, setReason] = useState('');
  const waiting = data.orders.filter(o => o.status === 'awaiting_approval');
  async function run(path: string, body: object) {
    setBusy(true); setError('');
    try { await api(path, { requestId: requestId(), ...body }); setRejecting(''); setReason(''); onSaved(); }
    catch (e) { setAutomatic(!!data.autoApproveQr); setError((e as Error).message); onSaved(); } finally { setBusy(false); }
  }
  // 8 Ekim denetimi K6: no empty "0 bekleyen" box; it comes back while automatic approval is on (to see and turn it off).
  if ((!data.waiterApproval || onlyWaiting) && !waiting.length) return null;
  // Nothing waits: one quiet line keeps the "Otomatik onay" switch (the waiter may turn it on, K3) without an empty box.
  if (!waiting.length && !data.autoApproveQr) return <label className="checkbox-label approval-auto-line"><input type="checkbox" checked={automatic} disabled={busy} onChange={e => { setAutomatic(e.target.checked); void run('/api/staff/approval-mode', { enabled: e.target.checked, version: data.approvalVersion ?? 0 }); }} />Otomatik onay<HelpTip title="Otomatik onay">Açıksa bu işletmeye yeni gelen QR siparişleri kontrol edilmeden mutfağa gider. İşletmedeki bütün garson ve mutfak ekranlarına uygulanır.</HelpTip>{error && <span className="field-error" role="alert">{error}</span>}</label>;
  if (compact && !open) return <button type="button" className="approval-compact" data-testid="approval-compact" onClick={() => setOpen(true)}><span className="approval-compact-count">{waiting.length}</span><span>{waiting.length} QR siparişi onay bekliyor</span><span className="approval-compact-show">Göster<ChevronDown size={15} aria-hidden="true" /></span></button>;
  return <section className={`panel approval-queue ${kitchen ? 'approval-kitchen' : ''}`} aria-label={kitchen ? 'Onay bekleyen QR siparişleri' : 'QR sipariş onayları'}><div className="section-heading"><h2>{kitchen ? 'Onay bekleyen QR siparişleri' : 'QR sipariş onayları'} <span>{waiting.length} bekleyen</span></h2>{compact && <button type="button" className="text-btn" onClick={() => setOpen(false)}>Gizle</button>}{data.waiterApproval && !onlyWaiting && <label className="checkbox-label"><input type="checkbox" checked={automatic} disabled={busy} onChange={e => { setAutomatic(e.target.checked); void run('/api/staff/approval-mode', { enabled: e.target.checked, version: data.approvalVersion ?? 0 }); }} />Otomatik onay<HelpTip title="Otomatik onay">Açıksa bu işletmeye yeni gelen QR siparişleri kontrol edilmeden mutfağa gider. Önceden bekleyen siparişler için ayrıca onay gerekir. İşletmedeki bütün garson ve mutfak ekranlarına uygulanır.</HelpTip></label>}</div>
    {data.autoApproveQr && !onlyWaiting && <Notice>Otomatik onay açık: yeni QR siparişleri doğrudan mutfağa gidiyor.</Notice>}{error && <Notice tone="error">{error}</Notice>}
    {kitchen && <p className="muted small">Onaylanan sipariş aşağıda “Yeni sipariş” olarak düşer.</p>}
    {waiting.map(o => { const actions = <div className="modal-actions"><button className="btn primary" disabled={busy} onClick={() => void run('/api/staff/orders/review', { orderId: o.id, version: o.version, approve: true })}>Onayla ve mutfağa gönder</button><button className="btn secondary" disabled={busy} onClick={() => { setRejecting(o.id); setReason(''); }}>Reddet</button></div>;
      // The kitchen tablet (landscape): the queue is a short strip above the board, so the buttons sit beside the table's
      // name; under a two-line order they were cut off below the strip with no scroll bar on a touch screen (8 Ekim denetimi).
      return <article className="report-row" key={o.id}>{kitchen ? <div className="approval-head"><h3>{o.tableName} · #{o.number}</h3>{actions}</div> : <h3>{o.tableName} · #{o.number}</h3>}<OrderLines order={o} showPrice={!kitchen} codes={!kitchen} />{o.updatedAt && <p className="order-change-notice">Müşteri siparişi güncelledi. Güncel içeriği kontrol edin.</p>}{!kitchen && actions}{rejecting === o.id && <form onSubmit={e => { e.preventDefault(); void run('/api/staff/orders/review', { orderId: o.id, version: o.version, approve: false, reason }); }}><label>Müşteriye gösterilecek açıklama *<input value={reason} maxLength={240} required onChange={e => setReason(e.target.value)} /></label><button className="btn primary" disabled={busy || !reason.trim()}>Reddi kaydet</button><button type="button" className="text-btn" onClick={() => setRejecting('')}>Vazgeç</button></form>}</article>; })}
  </section>;
}
