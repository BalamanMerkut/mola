import { useEffect, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import type { RefundRequest } from '../packages/domain/payment-adjustments';
import { api, money } from './api';
import { Modal, Notice } from './components';
import { RefundForm, type RefundLimits, type RefundPayment } from './RefundForm';
import './refunds.css';

/*
 * Masalar → Kasa → "İade" (owner, Müdür, cashier): today's payments, newest first, searchable by table, amount or time; pick
 * the paid bill, then the refund (src/RefundForm.tsx). A cashier sees their limits and their own requests to the owner.
 */
type Row = Omit<RefundPayment, 'itemsSelected' | 'revision'> & { itemsSelected: boolean; revision: number };
const clock = (at: string) => new Date(at).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const methodName = (m: string) => m === 'card' ? 'Kart' : m === 'platform' ? 'Platform' : 'Nakit';
const statusName = { pending: 'Sahibin onayını bekliyor', done: 'Sahip iadeyi yaptı', declined: 'Sahip reddetti' } as const;

export function RefundWindow({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [limits, setLimits] = useState<RefundLimits | null>(null), [rows, setRows] = useState<Row[] | null>(null), [error, setError] = useState('');
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [chosen, setChosen] = useState<string | null>(null);
  const [requests, setRequests] = useState<RefundRequest[]>([]), [sent, setSent] = useState('');
  useEffect(() => { void api<RefundLimits>('/api/staff/refunds/limits').then(setLimits).catch(e => setError((e as Error).message)); }, []);
  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  useEffect(() => {
    let live = true;
    api<{ rows: Row[] }>(`/api/staff/refunds/payments${query ? `?q=${encodeURIComponent(query)}` : ''}`).then(r => { if (live) setRows(r.rows); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [query, sent]);
  useEffect(() => { if (limits?.power === 'limited') void api<{ requests: RefundRequest[] }>('/api/staff/refunds/requests').then(r => setRequests(r.requests)).catch(() => {}); }, [limits?.power, sent]);
  const selected = rows?.find(r => r.id === chosen);
  return <Modal title={selected ? `İade · ${selected.tableName}` : 'İade'} wide className="modal-steady refund-window" onClose={onClose}><div className="modal-body">
    {error && <Notice tone="error">{error}</Notice>}
    {sent && !chosen && <Notice tone="success">{sent}</Notice>}
    {chosen && limits ? <RefundForm paymentId={chosen} source="counter" limits={limits} onCancel={() => setChosen(null)} onDone={done => { if (done.requested) { setSent(done.message); setChosen(null); } else onDone(done.message); }} />
      : <>
        {limits?.power === 'limited' && <p className="refund-limits">{(limits.max ?? 0) > 0 ? <>Tek seferde en çok <strong>{money(limits.max ?? 0)}</strong>, bugün toplam <strong>{money(limits.day ?? 0)}</strong> iade yapabilirsiniz{limits.usedToday ? <> (bugün {money(limits.usedToday)} yapıldı)</> : null}. Fazlası için işletme sahibine istek gönderilir.</> : <>İadeyi işletme sahibi yapar. Ödemeyi seçip <strong>sahibe iade isteği</strong> gönderebilirsiniz.</>}</p>}
        <label className="refund-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Ödeme ara" placeholder="Masa, tutar veya saat: 12, 35,50, 14:30" maxLength={80} value={search} onChange={e => setSearch(e.target.value)} /></label>
        {!rows ? <p className="muted small" role="status">Bugünkü ödemeler yükleniyor…</p> : !rows.length ? <p className="ledger-empty">{query ? 'Aramanıza uygun ödeme yok.' : 'Bugün henüz ödeme alınmadı.'}</p>
          : <ul className="refund-payments" aria-label="Bugünkü ödemeler">{rows.map(r => <li key={r.id}><button type="button" disabled={r.method === 'platform' || r.refundable <= 0} onClick={() => setChosen(r.id)}>
            <time dateTime={r.createdAt}>{clock(r.createdAt)}</time><span className="refund-payment-table">{r.tableName}</span>
            <span className="refund-payment-amount"><strong>{money(r.amount)}</strong><small>{methodName(r.method)}{r.refunded > 0 ? ` · ${r.refundable <= 0 ? 'tamamı iade edildi' : `${money(r.refunded)} iade`}` : ''}{r.method === 'platform' ? ' · iadeyi platform yapar' : ''}</small></span>
            <ChevronRight size={16} aria-hidden="true" /></button></li>)}</ul>}
        {requests.length > 0 && <section className="refund-my-requests" aria-label="İade isteklerim"><h3>İade isteklerim</h3><ul>{requests.map(r => <li key={r.id} className={r.status}><span>{clock(r.at)} · {r.tableName} · {money(r.amount)}</span><strong>{statusName[r.status]}</strong>{r.declineNote && <small>{r.declineNote}</small>}</li>)}</ul></section>}
      </>}
  </div></Modal>;
}
