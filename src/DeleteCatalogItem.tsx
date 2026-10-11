import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api, ApiError, requestId } from './api';
import { Modal, Notice } from './components';
export function DeleteCatalogItem({ kind, id, name, revision, disabled, onDeleted }: { kind: 'product' | 'campaign'; id: string; name: string; revision: number; disabled?: boolean; onDeleted: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState('');
  const pending = useRef<object | null>(null);
  const title = kind === 'product' ? 'Ürünü sil' : 'Kampanyayı sil';
  async function remove() {
    if (busy) return; setBusy(true); setError(''); pending.current ??= { kind, id, revision, requestId: requestId() };
    try { await api('/api/staff/catalog/remove', pending.current); setOpen(false); onDeleted(); }
    catch (e) { const unknown = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(unknown); if (!unknown) pending.current = null; setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <><button type="button" className="btn delete-catalog" disabled={disabled} onClick={() => setOpen(true)}><Trash2 size={18} />{title}</button>{open && <Modal title={title} dismissible={!busy && !uncertain} onClose={() => setOpen(false)}><div className="modal-body"><p><strong>{name}</strong> silinsin mi?</p><p>{kind === 'product' ? 'Ürün ve taslağı menüden kaldırılır; yeni sipariş verilemez.' : 'Kampanya listeden kaldırılır ve yeni siparişlere uygulanmaz.'} Önceden verilen siparişler, tahsilatlar ve raporlar korunur.</p>{error && <Notice tone="error">{error}</Notice>}<div className="modal-actions"><button type="button" className="btn secondary" disabled={busy || uncertain} onClick={() => setOpen(false)}>Vazgeç</button><button type="button" className="btn delete-catalog" disabled={busy} onClick={() => void remove()}><Trash2 size={18} />{uncertain ? 'Silme işlemini yeniden kontrol et' : 'Evet, sil'}</button></div></div></Modal>}</>;
}
