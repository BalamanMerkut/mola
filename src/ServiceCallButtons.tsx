import { useState } from 'react';
import { Banknote, BellRing, Check, CreditCard, ReceiptText } from 'lucide-react';
import { api, requestId } from './api';
import { guestMessage } from './guestText';
import './bill-request.css';

type Props = { guest: string; en: boolean; calls?: { waiter: boolean; bill: boolean }; canAskBill: boolean; disabled: boolean; onSent: () => void };
type PayWith = 'cash' | 'card';
export function ServiceCallButtons({ guest, en, calls, canAskBill, disabled, onSent }: Props) {
  const [busy, setBusy] = useState<'waiter' | 'bill' | null>(null);
  // "Hesabı iste" first asks how the guest will pay (the waiter brings the POS for a card); answering is optional.
  const [asking, setAsking] = useState(false);
  // Kept here, not in the page error: the 2-second menu refresh would wipe it before it is read.
  const [error, setError] = useState('');
  async function call(kind: 'waiter' | 'bill', payWith?: PayWith) {
    if (busy) return; setBusy(kind); setError('');
    try { await api('/api/guest/call', { requestId: requestId(), kind, ...(payWith ? { payWith } : {}) }, guest); setAsking(false); onSent(); }
    catch (e) { setError(guestMessage(e, en)); }
    finally { setBusy(null); }
  }
  const button = (kind: 'waiter' | 'bill', icon: React.ReactNode, label: string, done: string) => {
    const waiting = !!calls?.[kind];
    return <button type="button" className={`service-call ${waiting ? 'waiting' : ''}${kind === 'bill' && asking ? ' asking' : ''}`} disabled={disabled || waiting || !!busy} aria-live="polite" aria-expanded={kind === 'bill' ? asking : undefined} onClick={() => { if (kind === 'bill') setAsking(v => !v); else void call(kind); }}>{waiting ? <Check size={16} aria-hidden="true" /> : icon}<span>{busy === kind ? (en ? 'Sending…' : 'Gönderiliyor…') : waiting ? done : label}</span></button>;
  };
  return <>
    <div className="service-calls" aria-label={en ? 'Ask staff' : 'Personel çağır'}>
      {button('waiter', <BellRing size={16} aria-hidden="true" />, en ? 'Call waiter' : 'Garson çağır', en ? 'Waiter called' : 'Garson çağrıldı')}
      {canAskBill && button('bill', <ReceiptText size={16} aria-hidden="true" />, en ? 'Ask for the bill' : 'Hesabı iste', en ? 'Bill requested' : 'Hesap istendi')}
    </div>
    {asking && canAskBill && !calls?.bill && <div className="bill-pay-choice" role="group" aria-label={en ? 'How will you pay?' : 'Nasıl ödeyeceksiniz?'}>
      <p>{en ? 'How will you pay?' : 'Nasıl ödeyeceksiniz?'}</p>
      <div className="bill-pay-options">
        <button type="button" disabled={disabled || !!busy} onClick={() => void call('bill', 'cash')}><Banknote size={18} aria-hidden="true" />{en ? 'Cash' : 'Nakit'}</button>
        <button type="button" disabled={disabled || !!busy} onClick={() => void call('bill', 'card')}><CreditCard size={18} aria-hidden="true" />{en ? 'Card' : 'Kart'}</button>
      </div>
      <button type="button" className="bill-pay-skip" disabled={disabled || !!busy} onClick={() => void call('bill')}>{en ? 'Skip, just ask for the bill' : 'Fark etmez, hesabı iste'}</button>
    </div>}
    {error && <p className="service-call-error" role="alert">{error}</p>}
  </>;
}
