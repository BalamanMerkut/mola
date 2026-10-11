import { useEffect, useId, useState } from 'react';
import { Minus, PackageCheck, Plus, Send, Undo2 } from 'lucide-react';
import { cashierRefundProblem, pastDayNote, itemRefundTotal, OWNER_REQUIRED_TEXT, REFUND_REASONS, refundReasonNames, refundReasonProblem, type RefundableItem, type RefundReason } from '../packages/domain/refund-rules';
import { formatWeight } from '../packages/domain/lines';
import { api, ApiError, money, moneyError, parseMoney, requestId as newRequestId } from './api';
import { Notice } from './components';
import { trackFiscal } from './FiscalHelper';
import './cash-shifts.css';
import './refunds.css';

/*
 * One refund of one payment, the same window for the owner (Kasa ve giderler → İadeler, any day) and the counter (Masalar → Kasa →
 * "İade": owner, Müdür and cashier, today's payments). "Ürün seçerek": − / + per paid item, the amount worked out from what
 * was actually paid for them (campaign price, never more than the payment still has). "Tutar olarak iade": an amount.
 * Reason chips, the method (the payment's own by default), "stoğa ekle" (off unless ticked), then one more look before it
 * is saved. A cashier above the owner's limits sees why and sends the refund to the owner instead ("Sahibe iade isteği gönder").
 */
export type RefundPayment = { id: string; tableName: string; createdAt: string; amount: number; method: 'cash' | 'card' | 'platform'; refunded: number; refundable: number; revision: number; itemsSelected: boolean };
export type RefundDetail = { payment: RefundPayment; items: RefundableItem[] };
/** What the counter knows about the signed-in person: everything ('full') or the cashier's limits for today. */
export type RefundLimits = { power: 'full' | 'limited' | 'none'; max?: number; day?: number; usedToday?: number };
/** A cashier's request the owner is doing now: the form opens with its items, reasons and method. */
export type RefundStart = { requestId: string; items?: { lineId: string; quantity: number }[]; reasons?: RefundReason[]; note?: string; method: 'cash' | 'card'; restock?: boolean; amount: number };
type Done = { message: string; requested?: boolean };

const clock = (at: string) => new Date(at).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const methodName = (m: string) => m === 'card' ? 'Kart' : m === 'platform' ? 'Platform ödemesi' : 'Nakit';

export function RefundForm({ paymentId, source, limits, start, onDone, onCancel }: { paymentId: string; source: 'counter' | 'ledger'; limits?: RefundLimits; start?: RefundStart; onDone: (done: Done) => void; onCancel: () => void }) {
  const id = useId();
  const [detail, setDetail] = useState<RefundDetail | null>(null), [loadError, setLoadError] = useState(''), [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<'items' | 'amount'>(start && !start.items ? 'amount' : 'items');
  const [chosen, setChosen] = useState<Record<string, number>>(() => Object.fromEntries((start?.items ?? []).map(i => [i.lineId, i.quantity])));
  const [amountText, setAmountText] = useState(start && !start.items ? String(start.amount / 100).replace('.', ',') : '');
  const [reasons, setReasons] = useState<RefundReason[]>(start?.reasons ?? []), [note, setNote] = useState(start?.note ?? '');
  const [method, setMethod] = useState<'cash' | 'card'>(start?.method ?? 'cash'), [restock, setRestock] = useState(!!start?.restock);
  const [back, setBack] = useState(''), [backQty, setBackQty] = useState('1');
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [ownerNeeded, setOwnerNeeded] = useState('');
  // The same id is sent again after an unclear failure (a timeout), so a retry never records a second refund.
  const [request, setRequest] = useState(newRequestId);
  const changed = () => { setRequest(newRequestId()); setConfirming(false); setError(''); setOwnerNeeded(''); };
  useEffect(() => {
    let live = true; setLoadError('');
    const url = source === 'ledger' ? `/api/staff/payment-adjustments/${encodeURIComponent(paymentId)}/refund` : `/api/staff/refunds/payments/${encodeURIComponent(paymentId)}`;
    api<RefundDetail>(url).then(d => {
      if (!live) return;
      setDetail(d);
      if (!start) { setMethod(d.payment.method === 'card' ? 'card' : 'cash'); if (!d.items.some(i => i.left > 0)) setMode('amount'); }
    }).catch(e => { if (live) setLoadError((e as Error).message); });
    return () => { live = false; };
  }, [paymentId, source, attempt]);

  if (loadError) return <div className="refund-form"><Notice tone="error">{loadError}<button type="button" className="text-btn" onClick={() => setAttempt(n => n + 1)}>Yeniden dene</button></Notice><div className="refund-actions"><button type="button" className="btn secondary" onClick={onCancel}>Kapat</button></div></div>;
  if (!detail) return <p className="muted small" role="status">Ödeme açılıyor…</p>;
  const p = detail.payment;
  if (p.method === 'platform') return <div className="refund-form"><Notice>Platform ödemesi burada iade edilmez; iadeyi Yemeksepeti, Getir gibi platform kendisi yapar.</Notice><div className="refund-actions"><button type="button" className="btn secondary" onClick={onCancel}>Kapat</button></div></div>;
  const offered = detail.items.filter(i => i.paid > 0), byItems = mode === 'items';
  const total = itemRefundTotal(offered, chosen, p.refundable);
  const typed = parseMoney(amountText), amountProblem = !byItems && amountText.trim() ? moneyError(amountText, { max: p.refundable }).replace(/^En fazla (.*) yazılabilir\.$/, 'Bu ödemeden en çok $1 iade edilebilir.') : '';
  const amount = byItems ? total.amount : Number.isFinite(typed) ? typed : 0;
  const reasonProblem = refundReasonProblem(reasons, note);
  const backItem = offered[Number(back)];
  const backChoice = !byItems && restock && backItem ? { productId: backItem.productId, quantity: backItem.grams ? backItem.grams / 1000 : Math.max(1, Math.min(backItem.paid, Math.round(Number(backQty.replace(',', '.')) || 0))) } : null;
  // A cashier's limits are known in advance: the window says it before the server would.
  const limitProblem = limits?.power === 'limited' && amount > 0 ? cashierRefundProblem(amount, limits.usedToday ?? 0, { max: limits.max ?? 0, day: limits.day ?? 0 }) : '';
  const blocked = ownerNeeded || (limitProblem ? `${OWNER_REQUIRED_TEXT} ${limitProblem}` : '');
  const ready = amount > 0 && amount <= p.refundable && !reasonProblem && !amountProblem && (!restock || byItems || !!backChoice);
  const hint = !amount ? (byItems ? 'İade edilecek ürünleri seçin.' : 'İade tutarını yazın.') : reasonProblem || (restock && !byItems && !backChoice ? 'Stoğa eklenecek ürünü seçin.' : '');
  const items = byItems ? offered.filter(i => (chosen[i.lineId] ?? 0) > 0).map(i => ({ orderId: i.orderId, lineId: i.lineId, quantity: chosen[i.lineId] })) : undefined;
  const body = { requestId: request, paymentId: p.id, amount, method, reasons, ...(note.trim() ? { note: note.trim() } : {}), ...(items ? { items, ...(restock ? { restock: true } : {}) } : {}) };

  function pick(item: RefundableItem, n: number) { setChosen(c => ({ ...c, [item.lineId]: Math.max(0, Math.min(item.left, n)) })); changed(); }
  function toggle(r: RefundReason) { setReasons(list => list.includes(r) ? list.filter(x => x !== r) : [...list, r]); changed(); }
  async function save() {
    if (busy || !ready) return;
    setBusy(true); setError('');
    try {
      const url = source === 'ledger' ? '/api/staff/payment-adjustments' : '/api/staff/refunds';
      const r = await api<{ id: string; amount: number; stock?: { added: string[]; skipped: string[] } }>(url, { ...body, revision: p.revision, ...(source === 'ledger' ? { kind: 'refund', commission: 0 } : {}), ...(backChoice ? { back: backChoice } : {}), ...(start ? { fromRequest: start.requestId } : {}) });
      // Yazar kasa yardımcısı: what to reverse on the yazar kasa, per rate (a card in the dock; src/FiscalHelper.tsx).
      if (r.id) trackFiscal(p.id, { refundId: r.id, docked: true });
      const stock = r.stock?.skipped.length ?` Stok takibi olmadığı için stoğa eklenmedi: ${r.stock.skipped.join(', ')}.` : r.stock?.added.length ? ' Ürünler stoğa eklendi.' : '';
      onDone({ message: `${money(r.amount)} ${methodName(method).toLocaleLowerCase('tr')} iade kaydedildi · ${p.tableName}.${stock}` });
    } catch (e) {
      setConfirming(false);
      if (e instanceof ApiError && e.code === 'OWNER_REQUIRED') setOwnerNeeded(e.message);
      else setError(e instanceof ApiError && e.code === 'REQUEST_CONFLICT' ? 'Bu iade zaten gönderildi. Pencereyi kapatıp listeyi yenileyin.' : (e as Error).message);
      if (e instanceof ApiError && e.status < 500 && e.code !== 'REQUEST_CONFLICT') setRequest(newRequestId());
    } finally { setBusy(false); }
  }
  async function ask() {
    if (busy || !ready) return;
    setBusy(true); setError('');
    try {
      await api('/api/staff/refunds/requests', body);
      onDone({ requested: true, message: `İade isteği işletme sahibine gönderildi · ${p.tableName} · ${money(amount)}. Sahibi onaylayınca iade yapılır.` });
    } catch (e) { setError((e as Error).message); if (e instanceof ApiError && e.status < 500) setRequest(newRequestId()); } finally { setBusy(false); }
  }

  return <div className="refund-form">
    <div className="refund-head">
      <div><strong>{p.tableName}</strong><span>{clock(p.createdAt)} · {methodName(p.method)} · {money(p.amount)}</span></div>
      <p>Kalan iade hakkı: {money(p.refundable)}</p>
    </div>
    {p.refundable <= 0 ? <Notice>Bu ödemenin tamamı iade edildi.</Notice> : <>
      <div className="cash-segment small refund-mode" role="group" aria-label="İade şekli">
        <button type="button" aria-pressed={byItems} className={byItems ? 'selected' : ''} disabled={busy || !offered.length} onClick={() => { setMode('items'); changed(); }}>Ürün seçerek</button>
        <button type="button" aria-pressed={!byItems} className={!byItems ? 'selected' : ''} disabled={busy} onClick={() => { setMode('amount'); changed(); }}>Tutar olarak iade</button>
      </div>
      {byItems ? <section className="refund-items" aria-label="İade edilecek ürünler">
        {!p.itemsSelected && <p className="muted small">Ödeme tutar olarak alınmıştı: hesabın ürünleri gösteriliyor. İade, bu ödemenin kalan tutarını geçmez.</p>}
        {offered.map(i => { const n = chosen[i.lineId] ?? 0, off = busy || i.left === 0; return <div className={`refund-item${i.left === 0 ? ' done' : ''}`} key={i.lineId}>
          <span className="refund-item-name">{i.name}{i.optionNames.length > 0 && <small>{i.optionNames.join(' · ')}</small>}<small>{i.grams ? `${formatWeight(i.grams)} · ` : ''}{money(i.unit)}{i.grams ? '' : ' / adet'}{i.refunded > 0 && ` · ${i.left === 0 ? 'iade edildi' : `${i.refunded} adet iade edildi`}`}</small></span>
          {i.grams ? <label className="refund-whole"><input type="checkbox" aria-label={`${i.name} iade et`} disabled={off} checked={n > 0} onChange={e => pick(i, e.target.checked ? 1 : 0)} />Tamamı</label>
            : <div className="refund-stepper" role="group" aria-label={`${i.name} iade adedi`}>
              <button type="button" aria-label={`${i.name} bir adet azalt`} disabled={off || n === 0} onClick={() => pick(i, n - 1)}><Minus size={18} aria-hidden="true" /></button>
              <output aria-live="polite" aria-label={`${i.name} iade edilecek adet`}>{n}<small>/ {i.left}</small></output>
              <button type="button" aria-label={`${i.name} bir adet ekle`} disabled={off || n >= i.left} onClick={() => pick(i, n + 1)}><Plus size={18} aria-hidden="true" /></button>
            </div>}
        </div>; })}
        <div className="refund-total" aria-live="polite"><span>İade tutarı</span><strong>{money(total.amount)}</strong>{total.capped && <small>Ürünlerin değeri {money(total.value)}; bu ödemeden en çok {money(p.refundable)} iade edilebilir.</small>}</div>
      </section> : <label className="refund-amount" htmlFor={`${id}-amount`}>İade tutarı (TL) *<input id={`${id}-amount`} inputMode="decimal" value={amountText} disabled={busy} aria-invalid={!!amountProblem} onChange={e => { setAmountText(e.target.value); changed(); }} placeholder={`En çok ${money(p.refundable)}`} />{amountProblem && <small className="field-error" role="alert">{amountProblem}</small>}</label>}

      <fieldset className="refund-reasons"><legend>İade nedeni *</legend>
        <div className="refund-chips" role="group" aria-label="İade nedeni">{REFUND_REASONS.map(r => <button type="button" key={r} aria-pressed={reasons.includes(r)} className={reasons.includes(r) ? 'selected' : ''} disabled={busy} onClick={() => toggle(r)}>{refundReasonNames[r]}</button>)}</div>
        <label htmlFor={`${id}-note`}>{reasons.includes('other') ? 'Açıklama *' : 'Açıklama (isteğe bağlı)'}<input id={`${id}-note`} value={note} maxLength={300} disabled={busy} onChange={e => { setNote(e.target.value); changed(); }} placeholder="Örn. Kahve soğuk geldi" /></label>
      </fieldset>

      <div className="refund-method"><span id={`${id}-method`}>İade yöntemi</span>
        <div className="cash-segment small" role="group" aria-labelledby={`${id}-method`}>{(['cash', 'card'] as const).map(m => <button type="button" key={m} aria-pressed={method === m} className={method === m ? 'selected' : ''} disabled={busy} onClick={() => { setMethod(m); changed(); }}>{methodName(m)}</button>)}</div>
        <small className="muted">{method === p.method ? `Ödeme ${methodName(p.method).toLocaleLowerCase('tr')} alınmıştı.` : `Ödeme ${methodName(p.method).toLocaleLowerCase('tr')} alınmıştı; iade ${methodName(method).toLocaleLowerCase('tr')} yapılıyor.`} {method === 'cash' ? 'Parayı kasadan verin.' : 'İadeyi POS cihazından yapın.'}</small>
      </div>

      <label className="checkbox-label refund-restock"><input type="checkbox" checked={restock} disabled={busy} onChange={e => { setRestock(e.target.checked); changed(); }} /><PackageCheck size={17} aria-hidden="true" />Ürünler kullanılmadan geri döndü (stoğa ekle)</label>
      {restock && (byItems ? <p className="muted small refund-restock-note">Seçilen ürünlerin reçetesindeki malzemeler Stok'a geri eklenir. Ürün hazırlandıysa işaretlemeyin.</p>
        : <div className="restock-fields"><label>Geri dönen ürün<select value={back} disabled={busy} onChange={e => { setBack(e.target.value); changed(); }}><option value="">Ürün seçin</option>{offered.map((i, n) => <option key={i.lineId} value={n}>{i.name}</option>)}</select></label>{backItem && !backItem.grams && <label>Adet<input type="number" inputMode="numeric" min="1" max={backItem.paid} value={backQty} disabled={busy} onChange={e => { setBackQty(e.target.value); changed(); }} /></label>}<p className="muted small">Ürünün reçetesindeki malzemeler Stok'a geri eklenir. Ürün hazırlandıysa işaretlemeyin.</p></div>)}

      {error && <Notice tone="error">{error}</Notice>}
      {blocked ? <div className="refund-owner" role="alert"><p><strong>{OWNER_REQUIRED_TEXT}</strong> {blocked.replace(OWNER_REQUIRED_TEXT, '').trim()}</p>
        {limits?.power === 'limited' && <p className="muted small">İsteği gönderin; işletme sahibi Bildirimler'de görür ve iadeyi kendisi yapar.</p>}
        <div className="refund-actions">{limits?.power === 'limited' && <button type="button" className="btn primary" disabled={busy || !ready} onClick={() => void ask()}><Send size={16} aria-hidden="true" />{busy ? 'Gönderiliyor…' : 'Sahibe iade isteği gönder'}</button>}<button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Vazgeç</button></div></div>
        : confirming ? <div className="refund-confirm" role="group" aria-label="İade onayı"><p><strong>{money(amount)} {methodName(method).toLocaleLowerCase('tr')} iade</strong> kaydedilecek · {p.tableName}{items ? ` · ${items.reduce((n, i) => n + i.quantity, 0)} ürün` : ''}. {method === 'cash' ? 'Parayı kasadan verin.' : 'İadeyi POS cihazından ayrıca yapın.'}{pastDayNote(p.createdAt) && <> {pastDayNote(p.createdAt)}</>}</p>
          <div className="refund-actions"><button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Kaydediliyor…' : 'Evet, iadeyi kaydet'}</button><button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirming(false)}>Geri dön</button></div></div>
        : <>{hint && <p className="refund-hint" role="status">{hint}</p>}
          <div className="refund-actions"><button type="button" className="btn primary" disabled={busy || !ready} onClick={() => setConfirming(true)}><Undo2 size={16} aria-hidden="true" />İadeyi kaydet</button><button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Vazgeç</button></div></>}
    </>}
  </div>;
}
