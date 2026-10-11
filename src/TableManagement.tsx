import { TableAreaPicker } from './TableAreaPicker';
import { useRef, useState } from 'react';
import type { StaffSnapshot } from '../packages/domain/types';
import { api, ApiError, requestId } from './api';
import { Modal, Notice } from './components';

export function TableManagement({ mode, data, onClose, onSaved }: { mode: 'add' | 'remove'; data: StaffSnapshot; onClose: () => void; onSaved: (message: string) => void }) {
  const [area, setArea] = useState('');
  const [selected, setSelected] = useState(''); const [busy, setBusy] = useState(false); const [uncertain, setUncertain] = useState(false); const [error, setError] = useState('');
  const pending = useRef<unknown>(null);
  const blocked = (id: string) => !!data.tables.find(t => t.id === id)?.account || data.orders.some(o => o.tableName === data.tables.find(t => t.id === id)?.name && ['new', 'preparing', 'ready'].includes(o.status));
  const eligible = mode === 'add' ? data.tables.length < 100 : data.tables.length > 1 && !!selected && !blocked(selected) && data.tables.some(t => t.id === selected);
  async function save() {
    if (busy || (!uncertain && !eligible)) return;
    const table = data.tables.find(t => t.id === selected);
    pending.current ??= mode === 'add' ? { requestId: requestId(), area: area || undefined } : { requestId: requestId(), tableId: table!.id, epoch: table!.epoch };
    setBusy(true); setError('');
    try { const r = await api<{ name: string }>(`/api/staff/tables/${mode}`, pending.current); onSaved(mode === 'add' ? `${r.name} eklendi. Masa kartından QR kodunu açabilirsiniz.` : `${r.name} kullanımdan kaldırıldı.`); }
    catch (e) { const unknown = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(unknown); if (!unknown) pending.current = null; setError(unknown ? 'Sonuç alınamadı. Aynı işlemi yeniden kontrol edin.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title={mode === 'add' ? 'Masa ekle' : 'Masa çıkar'} onClose={() => { if (!busy && !uncertain) onClose(); }}><div className="modal-body">{mode === 'add' ? <p>Yeni masa otomatik numarayla ve kendine ait QR koduyla oluşturulur. Mevcut masaların numaraları ve QR kodları değişmez.</p> : <><label>Çıkarılacak masa<select aria-label="Çıkarılacak masa" value={selected} disabled={busy || uncertain} onChange={e => setSelected(e.target.value)}><option value="">Masa seçin</option>{data.tables.map(t => <option key={t.id} value={t.id} disabled={blocked(t.id)}>{t.name}{blocked(t.id) ? ' · Hesap/sipariş devam ediyor' : ''}</option>)}</select></label><Notice>Yalnızca boş ve mutfakta bekleyen siparişi olmayan masa çıkarılabilir. Eski QR kodu geçersiz olur; geçmiş satış kayıtları korunur. Diğer masalar yeniden numaralanmaz.</Notice></>}{mode === 'add' && <TableAreaPicker value={area} areas={data.tables.map(t => t.area ?? '')} onChange={setArea} disabled={busy || uncertain} />}{mode === 'add' && data.tables.length >= 100 && <Notice>100 aktif masa sınırına ulaşıldı.</Notice>}{mode === 'remove' && data.tables.length <= 1 && <Notice>En az bir masa kalmalı.</Notice>}{error && <Notice tone="error">{error}</Notice>}<button className="btn primary full" disabled={busy || (!uncertain && !eligible)} onClick={() => void save()}>{busy ? 'Kaydediliyor…' : uncertain ? 'İşlemi yeniden kontrol et' : mode === 'add' ? 'Yeni masayı oluştur' : 'Seçili masayı çıkar'}</button></div></Modal>;
}
