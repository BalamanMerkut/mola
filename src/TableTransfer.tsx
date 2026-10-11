import { useRef, useState } from 'react';
import type { TableView } from '../packages/domain/types';
import { api, ApiError, money, requestId } from './api';
import { Modal, Notice } from './components';
import { HelpTip } from './HelpTip';

/**
 * One place to send a table's bill elsewhere: an empty table means "move", an occupied one means "merge".
 * Staff no longer have to know in advance which of the two words applies.
 */
export function TableTransfer({ source, tables, canMerge, onClose, onDone }: { source: TableView; tables: TableView[]; canMerge: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [targetId, setTargetId] = useState(''), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState('');
  const pending = useRef<{ path: string; body: object; merge: boolean } | null>(null);
  const empty = tables.filter(t => t.id !== source.id && !t.account && !t.needsCleaning);
  const occupied = canMerge ? tables.filter(t => t.id !== source.id && t.account) : [];
  const target = tables.find(t => t.id === targetId), merge = !!target?.account;
  async function save() {
    if (busy || (!pending.current && !target)) return;
    setBusy(true); setError('');
    pending.current ??= merge
      ? { merge, path: '/api/staff/accounts/merge', body: { requestId: requestId(), sourceId: source.account!.id, sourceVersion: source.account!.version, targetId: target!.account!.id, targetVersion: target!.account!.version } }
      : { merge, path: '/api/staff/tables/move', body: { requestId: requestId(), accountId: source.account!.id, version: source.account!.version, targetId: target!.id, targetEpoch: target!.epoch } };
    try { const r = await api<{ tableName: string }>(pending.current.path, pending.current.body); onDone(pending.current.merge ? `Hesaplar ${r.tableName} üzerinde birleştirildi.` : `Hesap taşındı · ${r.tableName}`); }
    catch (e) { const unknown = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(unknown); if (!unknown) pending.current = null; setError(unknown ? 'Sonuç alınamadı. Aynı işlemi yeniden kontrol edin.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title={`${source.name} · Taşı / birleştir`} dismissible={!busy && !uncertain} onClose={() => { if (!busy && !uncertain) onClose(); }}><form className="modal-body" onSubmit={e => { e.preventDefault(); void save(); }}>
    <p>Hesap ve siparişler seçtiğiniz masaya geçer. Müşteriler yeni masanın QR kodunu okutmalı. <HelpTip title="Taşı / birleştir">Boş masa seçerseniz hesap oraya taşınır. Dolu masa seçerseniz iki masanın hesabı tek hesapta birleşir. Siparişler, fiyatlar ve alınan ödemeler korunur.</HelpTip></p>
    <label>Hedef masa<select aria-label="Hedef masa" value={targetId} disabled={busy || uncertain} onChange={e => setTargetId(e.target.value)} required>
      <option value="">Masa seçiniz</option>
      {empty.length > 0 && <optgroup label="Boş masalar · hesap taşınır">{empty.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
      {occupied.length > 0 && <optgroup label="Dolu masalar · hesaplar birleşir">{occupied.map(t => <option key={t.id} value={t.id}>{t.name} · {money(t.account!.balance)}</option>)}</optgroup>}
    </select></label>
    {!empty.length && !occupied.length && <Notice>Şu anda seçilebilecek masa yok.</Notice>}
    {merge && <p className="muted small transfer-merge-note" role="status">{source.name} boşalır; iki masanın hesabı {target!.name} üzerinde tek hesap olur. Kalabalık grup için masaları böyle birleştirebilirsiniz; işlem kayda geçer.</p>}
    <div className="total-line"><span>{merge ? 'Birleşik kalan hesap' : 'Kalan hesap'}</span><strong>{money(source.account!.balance + (merge ? target!.account!.balance : 0))}</strong></div>
    {error && <Notice tone="error">{error}</Notice>}
    <button className="btn primary full" disabled={busy || (!uncertain && !target)}>{busy ? 'Kaydediliyor…' : uncertain ? 'Yeniden kontrol et' : !target ? 'Masa seçin' : merge ? `Hesapları birleştir · ${target.name}` : `Hesabı taşı · ${target.name}`}</button>{/* Table names already say "Masa 04"; "Masa 04 masasına" read twice. */}
  </form></Modal>;
}
