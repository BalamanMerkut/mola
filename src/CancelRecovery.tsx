import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { Modal, Notice } from './components';
import { browserOrderStorage } from './pendingOrder';
import { cancelDefinitelyRejected, clearPendingCancel, type PendingCancel } from './pendingCancel';
import { guestMessage } from './guestText';

export function CancelRecovery({ pending, storageKey, guest, en, autoStart, storageUnavailable, onDone, onClose }: { pending: PendingCancel; storageKey: string; guest: string; en: boolean; autoStart: boolean; storageUnavailable: boolean; onDone: (requested: boolean) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(autoStart), [error, setError] = useState('');
  const [rejected, setRejected] = useState(false), [changed, setChanged] = useState(false), [expired, setExpired] = useState(false);
  const sending = useRef(false), started = useRef(false);
  function clear() { clearPendingCancel(browserOrderStorage(), storageKey, pending.body.requestId); }
  async function check() {
    if (sending.current || rejected || changed) return;
    sending.current = true; setBusy(true); setError(''); setExpired(false);
    try { const result = await api<{ requested: boolean }>('/api/guest/cancel', pending.body, guest); clear(); onDone(result.requested); }
    catch (e) {
      if (cancelDefinitelyRejected(e)) { clear(); setRejected(true); }
      setChanged(e instanceof ApiError && e.code === 'CANCEL_CONTEXT_CHANGED');
      setExpired(e instanceof ApiError && e.status === 401);
      // A declined or closed request is said in the menu's language (src/guestText.ts); other answers stay as the server wrote them.
      setError(e instanceof ApiError ? (en && ['CANCEL_DECLINED', 'CANCEL_CLOSED'].includes(e.code) ? guestMessage(e, en) : e.message) : (en ? 'Connection unavailable. Check the same cancellation request again.' : 'Bağlantı kurulamadı. Aynı iptal talebini yeniden kontrol edin.'));
    } finally { sending.current = false; setBusy(false); }
  }
  useEffect(() => { if (autoStart && !started.current) { started.current = true; void check(); } }, []);
  return <Modal title={en ? `Cancellation #${pending.number}` : `Sipariş #${pending.number} · İptal talebi`} dismissible={rejected} onClose={onClose}><div className="modal-body">
    <Notice>{busy ? (en ? 'Checking your cancellation request…' : 'İptal talebiniz kontrol ediliyor…') : rejected ? (en ? 'This request was not applied. Review your current order.' : 'Bu talep uygulanmadı. Güncel siparişinizi kontrol edin.') : (en ? 'Your cancellation result has not been confirmed. Check the same request to continue.' : 'İptal talebinizin sonucu henüz doğrulanmadı. Devam etmek için aynı talebi kontrol edin.')}</Notice>
    <p className="muted small">{en ? 'Some orders are cancelled at once; others wait for the staff to approve.' : 'Bazı siparişler hemen iptal edilir, bazıları için personel onayı beklenir.'}</p>
    {storageUnavailable && <Notice>{en ? 'Your browser could not store the request. Keep this page open until the result is confirmed.' : 'Tarayıcı geçici kaydı saklayamadı. Sonuç doğrulanana kadar bu sayfayı açık tutun.'}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    {rejected ? <button className="btn primary full" onClick={onClose}>{en ? 'Back to order' : 'Siparişe dön'}</button> : changed ? <button className="btn secondary full" onClick={() => { clear(); onClose(); }}>{en ? 'Checked with staff, close this request' : 'İşletmeyle kontrol ettim, talebi kapat'}</button> : expired ? <button className="btn primary full" onClick={() => location.reload()}>{en ? 'Refresh session' : 'Oturumu yenile'}</button> : <button className="btn primary full" disabled={busy} onClick={() => void check()}>{busy ? (en ? 'Checking…' : 'Kontrol ediliyor…') : (en ? 'Check cancellation' : 'İptal talebini yeniden kontrol et')}</button>}
  </div></Modal>;
}
