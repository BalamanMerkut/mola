import { useRef, useState } from 'react';
import { api, ApiError, money } from './api';
import { Modal, Notice, PackedBadge } from './components';
import { browserOrderStorage } from './pendingOrder';
import { formatWeight } from '../packages/domain/lines';
import { clearPendingEdit, editDefinitelyRejected, type PendingEdit } from './pendingEdit';

export function OrderEditRecovery({ pending, storageKey, guest, en, storageUnavailable = false, onSaved, onClose }: { pending: PendingEdit; storageKey: string; guest: string; en: boolean; storageUnavailable?: boolean; onSaved: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [rejected, setRejected] = useState(false), [changed, setChanged] = useState(false), [expired, setExpired] = useState(false);
  const sending = useRef(false);
  function clear() { clearPendingEdit(browserOrderStorage(), storageKey, pending.body.requestId); }
  async function check() {
    if (sending.current || rejected || changed) return;
    sending.current = true; setBusy(true); setError(''); setExpired(false);
    try { await api('/api/guest/orders/edit', pending.body, guest); clear(); onSaved(); }
    catch (e) {
      if (editDefinitelyRejected(e)) { clear(); setRejected(true); }
      setChanged(e instanceof ApiError && e.code === 'EDIT_CONTEXT_CHANGED');
      setExpired(e instanceof ApiError && e.status === 401);
      setError(e instanceof ApiError ? e.message : (en ? 'Connection unavailable. Check the same update again.' : 'Bağlantı kurulamadı. Aynı değişikliği tekrar kontrol edin.'));
    } finally { sending.current = false; setBusy(false); }
  }
  return <Modal title={en ? `Check update #${pending.number}` : `Sipariş #${pending.number} · Değişiklik kontrolü`} dismissible={rejected} onClose={onClose}><div className="modal-body">
    <Notice>{rejected ? (en ? 'This update was not applied. Review the current order before making another change.' : 'Bu değişiklik uygulanmadı. Yeni işlemden önce güncel siparişinizi kontrol edin.') : (en ? 'The result of your earlier update is unknown. Check the same update to continue.' : 'Önceki değişikliğin sonucu henüz doğrulanmadı. Devam etmek için aynı işlemi kontrol edin.')}</Notice>
    {pending.labels.map((l, i) => <div className="total-line" key={i}><span>{l.grams ? `${formatWeight(l.grams, en)} ${l.name}` : `${l.quantity} × ${l.name}`}{pending.body.lines[i]?.note && <small className="muted"> · {pending.body.lines[i].note}</small>}</span><strong>{money(l.total)}</strong></div>)}
    {pending.body.packed && <PackedBadge en={en} />}
    <div className="total-line"><span>{en ? 'Submitted total' : 'Gönderilen toplam'}</span><strong>{money(pending.body.expectedTotal)}</strong></div>
    <p className="muted small">{en ? 'Checking again never applies your change twice.' : 'Tekrar kontrol etmek değişikliği iki kez uygulamaz.'}</p>
    {storageUnavailable && <Notice>{en ? 'Your browser could not keep a temporary record. Keep this page open until the check completes.' : 'Tarayıcı geçici kaydı saklayamadı. Kontrol tamamlanana kadar sayfayı açık tutun.'}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    {rejected ? <button className="btn primary full" onClick={onClose}>{en ? 'Back to order' : 'Siparişe dön'}</button> : changed ? <button className="btn secondary full" onClick={() => { clear(); onClose(); }}>{en ? 'Checked with staff, close this update' : 'İşletmeyle kontrol ettim, değişikliği kapat'}</button> : expired ? <button className="btn primary full" onClick={() => location.reload()}>{en ? 'Refresh session' : 'Oturumu yenile'}</button> : <button className="btn primary full" disabled={busy} onClick={() => void check()}>{busy ? (en ? 'Checking…' : 'Kontrol ediliyor…') : (en ? 'Check update' : 'Değişikliği yeniden kontrol et')}</button>}
  </div></Modal>;
}
