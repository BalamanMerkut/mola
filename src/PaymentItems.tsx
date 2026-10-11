import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { PaymentSelection } from '../packages/domain/types';
import { api, money } from './api';
import { Notice } from './components';
import { formatWeight } from '../packages/domain/lines';
import './order-lines.css';
/** `grams`: a weighed line, sold and paid as one whole item (its unitPrice is the line price). */
type Item = PaymentSelection & { grams?: number; name: string; orderNumber: number; guestLabel: string; movedFrom?: string; options: string[]; unitPrice: number; remaining: number };
/**
 * "Ürün seç": each line with − / + (big enough for a finger, no drop-down to open), a weighed line as one "Tamamı" box.
 * `deposit`: the bill has a reservation's kapora, which is paid against the amount, never against chosen items.
 */
export function PaymentItems({ accountId, version, disabled, deposit = false, onChange }: { accountId: string; version: number; disabled: boolean; deposit?: boolean; onChange: (v: { selections: PaymentSelection[]; total: number } | null) => void }) {
  const [data, setData] = useState<{ version: number; unallocated: boolean; items: Item[] } | null>(null), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(true);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  useEffect(() => { let live = true; setLoading(true); setError(''); setData(null); setQuantities({}); onChange({ selections: [], total: 0 }); api<NonNullable<typeof data>>(`/api/staff/accounts/${accountId}/items`).then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, [accountId, version, attempt]);
  function change(item: Item, value: number) {
    const next = { ...quantities, [item.lineId]: Math.max(0, Math.min(item.remaining, value)) }; setQuantities(next);
    const selected = data!.items.filter(i => next[i.lineId] > 0);
    onChange({ selections: selected.map(i => ({ orderId: i.orderId, lineId: i.lineId, quantity: next[i.lineId] })), total: selected.reduce((sum, i) => sum + next[i.lineId] * i.unitPrice, 0) });
  }
  const stale = !!data && data.version !== version;
  return <section className="payment-items" aria-busy={loading}>{loading && <p className="muted small" role="status">Ödenecek ürünler yükleniyor…</p>}{error && <Notice tone="error">{error}<button type="button" className="text-btn" disabled={disabled || loading} onClick={() => setAttempt(n => n + 1)}>Yeniden yükle</button></Notice>}
    {data?.unallocated ? <Notice>{deposit ? 'Bu hesaba rezervasyon kaporası düşüldü; kalan tutarı “Tamamı” ya da “Bir kısmı” ile alın. Ürün seçerek ödeme kaporalı hesapta yapılamaz.' : 'Bu hesapta tutar bazlı ödeme var; kalan ödemeyi tutar girerek alın.'}</Notice> : data?.items.map(i => {
      const n = quantities[i.lineId] ?? 0, off = disabled || i.remaining === 0 || stale;
      return <div className={`payment-item ${i.remaining === 0 ? 'line-paid' : ''}`} key={i.lineId}>
        <span>{i.name}<small>Sipariş #{i.orderNumber} · {i.guestLabel}{i.movedFrom ? ' · ' + i.movedFrom : ''}</small><small>{i.grams ? `${formatWeight(i.grams)} · ` : ''}{i.options.length ? i.options.join(' · ') + ' · ' : ''}{money(i.unitPrice)}</small>{i.grams && i.remaining > 0 && <small className="payment-weight-note">Kiloyla satıldı: bölünemez, tamamı ödenir.</small>}{i.remaining < i.quantity && <small className={`paid-label ${i.remaining === 0 ? 'paid-full' : 'paid-part'}`}>{i.remaining === 0 ? 'Ödendi' : `${i.quantity - i.remaining} / ${i.quantity} adet ödendi`}</small>}</span>
        {i.grams
          ? <label className="payment-whole"><input type="checkbox" aria-label={`${i.name} ödenecek miktar`} disabled={off} checked={n > 0} onChange={e => change(i, e.target.checked ? 1 : 0)} />Tamamı · {formatWeight(i.grams)}</label>
          : <div className="payment-stepper" role="group" aria-label={`${i.name} ödenecek adet`}>
            <button type="button" aria-label={`${i.name} bir adet azalt`} disabled={off || n === 0} onClick={() => change(i, n - 1)}><Minus size={18} aria-hidden="true" /></button>
            <output aria-live="polite" aria-label={`${i.name} seçilen adet`}>{n}<small>/ {i.remaining}</small></output>
            <button type="button" aria-label={`${i.name} bir adet ekle`} disabled={off || n >= i.remaining} onClick={() => change(i, n + 1)}><Plus size={18} aria-hidden="true" /></button>
          </div>}
      </div>;
    })}</section>;
}
