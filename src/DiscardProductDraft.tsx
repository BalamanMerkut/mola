import { useRef, useState } from 'react';
import { api, ApiError, requestId } from './api';
export function DiscardProductDraft({ id, revision, onSaved }: { id: string; revision: number; onSaved: () => void }) {
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState('');
  const pending = useRef<object | null>(null);
  async function discard() {
    if (busy) return; setBusy(true); setError(''); pending.current ??= { id, revision, requestId: requestId() };
    try { await api('/api/staff/products/discard-draft', pending.current); pending.current = null; setConfirm(false); setUncertain(false); onSaved(); }
    catch (e) { const u = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(u); if (!u) pending.current = null; setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="discard-draft">{!confirm ? <button className="text-btn" onClick={() => setConfirm(true)}>Taslak değişiklikleri sil</button> : <><p>Yayındaki ürün korunacak. Taslak değişiklikler silinsin mi?</p><button className="btn secondary small-btn" disabled={busy} onClick={() => void discard()}>{uncertain ? 'Silme işlemini yeniden kontrol et' : 'Evet, taslağı sil'}</button><button className="text-btn" disabled={busy || uncertain} onClick={() => setConfirm(false)}>Vazgeç</button></>}{error && <p role="alert">{error}</p>}</div>;
}
