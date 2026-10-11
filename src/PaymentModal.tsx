import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, CreditCard, Printer, Wallet } from 'lucide-react';
import type { PaymentSelection } from '../packages/domain/types';
import { api, ApiError, money, moneyError, moneyInput, parseMoney, printProblem, requestId } from './api';
import { Modal, Notice } from './components';
import { PaymentItems } from './PaymentItems';
import './payment-modal.css';
import { clearPendingPayment, paymentStorage, writePendingPayment, type PaymentTable, type PendingPayment } from './pendingPayment';
// Yazar kasa yardımcısı: what to enter on the yazar kasa after each payment (src/FiscalHelper.tsx).
import { dockFiscal, FiscalSlot, trackFiscal } from './FiscalHelper';

const printPreference = 'mola-print-after-payment';
/** `onLater`: a masasız ticket opened right after sending can be paid later; "Sonra öde" closes without a payment. */
/** `prefer`: the guest said how they will pay when asking for the bill ("Hesap · Kart"); the window opens on that method. */
export function PaymentModal({ table, context, restored, canPay, printing = false, prefer, onClose, onSuccess, onRefresh, onPrintError, onLater }: { table: PaymentTable; context: string; restored?: PendingPayment; canPay: boolean; printing?: boolean; prefer?: 'cash' | 'card'; onClose: () => void; onSuccess: (msg: string, settled: boolean, change?: number) => Promise<void>; onRefresh: () => void; onPrintError?: (message: string) => void; onLater?: () => void }) {
  const paymentForm = useRef<HTMLFormElement>(null);
  // Remembered per device: the cashier sets it once instead of pressing print after every payment.
  const [printAfter, setPrintAfter] = useState(() => { try { return localStorage.getItem(printPreference) !== '0'; } catch { return true; } });
  const [billBusy, setBillBusy] = useState(false), [billNotice, setBillNotice] = useState<{ ok: boolean; text: string } | null>(null);
  function rememberPrint(value: boolean) { setPrintAfter(value); try { localStorage.setItem(printPreference, value ? '1' : '0'); } catch { /* preference only */ } }
  async function printBill() {
    setBillBusy(true); setBillNotice(null);
    // A printer timeout must be impossible to miss: it shows as an error, not as faint small print.
    try { await api('/api/staff/print/bill', { accountId: account.id }); setBillNotice({ ok: true, text: 'Hesap fişi yazdırıldı.' }); }
    catch (e) { setBillNotice({ ok: false, text: printProblem(e) }); } finally { setBillBusy(false); }
  }
  const [paymentNotice, setPaymentNotice] = useState('');
  // 9 Ekim kullanıcı testi (K-D): after a part payment in cash the big box went back to ₺0 and the change to hand over was only
  // in the small green line. Now the big box says "Verilecek para üstü ₺15" for a few seconds (until the next typing).
  const [givenChange, setGivenChange] = useState<number | null>(null);
  useEffect(() => { if (givenChange === null) return; const t = setTimeout(() => setGivenChange(null), 8000); return () => clearTimeout(t); }, [givenChange]);
  // The yazar kasa card of the last payment: here while the window stays open, in the dock once it closes.
  const fiscal = useRef<string | null>(null), [fiscalKey, setFiscalKey] = useState<string | null>(null);
  useEffect(() => () => dockFiscal(fiscal.current), []);
  const [refreshAfter, setRefreshAfter] = useState<number | null>(null);
  // Whole bill is the usual case, so it needs no amount typing; part and item payments are one tap away.
  const [mode, setMode] = useState<'all' | 'part' | 'items'>(restored?.body.selections ? 'items' : restored && restored.body.amount !== restored.table.account.balance ? 'part' : 'all'); const byItems = mode === 'items'; const [chosen, setChosen] = useState<{ selections: PaymentSelection[]; total: number } | null>(null);
  const account = table.account!; const [method, setMethod] = useState<'cash' | 'card'>(restored?.body.method ?? prefer ?? 'cash'); const [amount, setAmount] = useState(moneyInput(account.balance)); const [tendered, setTendered] = useState(moneyInput(account.balance));
  const [busy, setBusy] = useState(false); const [uncertain, setUncertain] = useState(!!restored); const [error, setError] = useState(''); const pending = useRef<PendingPayment | null>(restored ?? null);
  const sending = useRef(false); const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [reviewedVersion, setReviewedVersion] = useState(account.version);
  useEffect(() => { if (refreshAfter !== null && account.version > refreshAfter) { setReviewedVersion(account.version); setRefreshAfter(null); } }, [account.version, refreshAfter]);
  const needsReview = !pending.current && refreshAfter === null && account.version !== reviewedVersion;
  const locked = busy || refreshAfter !== null || needsReview;
  function chooseMode(next: 'all' | 'part' | 'items') {
    setMode(next); setChosen(null);
    const whole = moneyInput(account.balance); setAmount(whole); setTendered(next === 'items' ? '0' : whole);
  }
  function reviewAccount() {
    setReviewedVersion(account.version); setChosen(null);
    setAmount(moneyInput(account.balance)); setTendered(byItems ? '0' : moneyInput(account.balance));
    setPaymentNotice(''); setError('');
  }
  // "Bahşiş": optional, never part of the sale; the cash handed over (or the card charge) includes it.
  const [tipOpen, setTipOpen] = useState(!!restored?.body.tip), [tip, setTip] = useState(restored?.body.tip ? moneyInput(restored.body.tip) : '');
  const tipValue = tipOpen && tip.trim() !== '' ? parseMoney(tip) : 0;
  // How the tip is paid: like the bill unless chosen otherwise (a card bill with a cash tip). Only a tip paid the same way is in "Alınan nakit" / the POS charge.
  const [tipMethod, setTipMethod] = useState<'cash' | 'card' | null>(restored?.body.tipMethod ?? null), tipWay = tipMethod ?? method, tipInside = tipWay === method && Number.isFinite(tipValue) ? tipValue : 0;
  // "Kart bahşişini kasadan nakit öde" (Kasa ve giderler → Kasa ayarları → Gün sonu, off by default; 8 Ekim K2): one question.
  const [askTipOut, setAskTipOut] = useState(false), [tipPaidOut, setTipPaidOut] = useState<boolean | null>(null);
  useEffect(() => { let live = true; void api<{ tipCashOut?: boolean }>('/api/staff/cash/settings').then(s => { if (live) setAskTipOut(!!s.tipCashOut); }).catch(() => {}); return () => { live = false; }; }, []);
  const tipOutAsked = askTipOut && tipWay === 'card' && Number.isFinite(tipValue) && tipValue > 0;
  const value = byItems ? chosen?.total ?? 0 : mode === 'all' ? account.balance : parseMoney(amount); const cash = method === 'card' ? value + tipInside : parseMoney(tendered); const change = cash - value - tipInside;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending.current || busy || (!pending.current && (locked || !canPay))) return;
    // A new payment starts clean: the previous one's "Para üstü" is no longer on screen.
    sending.current = true; setBusy(true); setError(''); setPaymentNotice(''); setGivenChange(null);
    if (!pending.current) {
      pending.current = { version: 1, table: { name: table.name, account: { id: account.id, version: account.version, balance: account.balance, paid: account.paid } }, body: { requestId: requestId(), paymentContext: context, accountId: account.id, version: account.version, method, amount: value, tendered: cash, ...(byItems ? { selections: chosen?.selections ?? [] } : {}), ...(tipValue > 0 ? { tip: tipValue, ...(tipWay !== method ? { tipMethod: tipWay } : {}) } : {}) } };
      setStorageUnavailable(!writePendingPayment(paymentStorage(), pending.current));
    }
    const submitted = pending.current, payOut = tipOutAsked && tipPaidOut === true && !restored ? tipValue : 0;
    try {
      const r = await api<{ paymentId: string; change: number; remaining: number; closed: boolean }>('/api/staff/payments', submitted.body);
      clearPendingPayment(paymentStorage(), context, submitted.body.requestId);
      dockFiscal(fiscal.current); fiscal.current = trackFiscal(r.paymentId); setFiscalKey(fiscal.current);
      // The payment is already saved; a printer problem is reported separately and never undoes it.
      if (printing && printAfter) void api('/api/staff/print/payment', { paymentId: r.paymentId }).catch(e => onPrintError?.(`Ödeme kaydedildi. ${printProblem(e)}`));
      pending.current = null; setUncertain(false); setChosen(null); setTip(''); setTipOpen(false); setTipMethod(null); setTipPaidOut(null);
      // "Evet, kasadan nakit verildi": the drawer's "Kart bahşişi nakit ödendi" movement (never undoes the payment if it fails).
      // The closing reads "Kart bahşişi nakit ödendi ₺20 · Kasa Kerem · Masa 05 · kartla bahşiş" (10 Ekim son kullanıcı testi:
      // the table's name and the error's reason had gone missing, the line read "· · kartla bahşiş").
      if (payOut > 0) void api('/api/staff/cash/movements', { requestId: requestId(), type: 'tip_out', amount: payOut, note: `${table.name} · kartla bahşiş` }).catch(e => setPaymentNotice(`Ödeme kaydedildi. Bahşiş kasadan çıkışı yazılamadı: ${(e as Error).message}`));
      const changeText = `${r.change > 0 ? ` · Para üstü: ${money(r.change)}` : ''}${submitted.body.tip ? ` · Bahşiş: ${money(submitted.body.tip)}` : ''}`;
      setPaymentNotice(`Ödeme kaydedildi. Kalan: ${money(r.remaining)}${changeText}`);
      if (r.change > 0 && submitted.body.method === 'cash') setGivenChange(r.change);
      setAmount(moneyInput(r.remaining)); setTendered(byItems ? '0' : moneyInput(r.remaining));
      if (r.remaining > 0) setRefreshAfter(submitted.body.version);
      await onSuccess(r.remaining === 0 ? `${r.closed ? 'Hesap kapandı' : 'Ödeme tamamlandı'}.${r.change > 0 ? ` Para üstü: ${money(r.change)}` : ''}${submitted.body.tip ? ` Bahşiş: ${money(submitted.body.tip)}` : ''}` : `Ödeme kaydedildi. Kalan: ${money(r.remaining)}${changeText}`, r.remaining === 0, r.remaining === 0 && submitted.body.method === 'cash' ? r.change : 0);
      if (r.remaining > 0) requestAnimationFrame(() => paymentForm.current?.closest('dialog')?.scrollTo({ top: 0, behavior: 'instant' }));
    } catch (e) {
      // Only definitive domain rejections permit a new payment request. Authentication,
      // rate limits and unknown responses keep the original identity and amount intact.
      const rejected = e instanceof ApiError && ['VERSION_CONFLICT', 'ACCOUNT_CLOSED', 'APPROVAL_PENDING', 'INVALID_SELECTION', 'UNALLOCATED_PAYMENT', 'ITEM_ALREADY_PAID', 'INVALID_AMOUNT', 'INVALID_VALUE', 'OVERPAYMENT', 'INVALID_METHOD', 'INVALID_TENDER', 'VALIDATION_ERROR'].includes(e.code);
      if (rejected) { clearPendingPayment(paymentStorage(), context, submitted.body.requestId); pending.current = null; }
      setUncertain(!!pending.current);
      setError(e instanceof ApiError ? e.message : 'Sonuç alınamadı. Aynı tahsilatı tekrar kontrol edin.');
      onRefresh();
    } finally { sending.current = false; setBusy(false); }
  }
  if (uncertain && pending.current) {
    const body = pending.current.body;
    return <Modal title={`${pending.current.table.name} · Tahsilat kontrolü`} dismissible={false} onClose={() => {}}><form className="modal-body" onSubmit={e => void submit(e)}>
      <Notice>Önceki tahsilatın sonucu henüz doğrulanmadı. Aynı kaydı kontrol ederek devam edin.</Notice>
      <div className="payment-balance"><small>{body.method === 'cash' ? 'NAKİT TAHSİLAT' : 'KART TAHSİLATI'}</small><h2>{money(body.amount)}</h2><p>{body.selections ? `${body.selections.reduce((n, s) => n + s.quantity, 0)} adet ürün seçildi` : 'Tutar üzerinden ödeme'}</p></div>
      {body.method === 'cash' && <div className="total-line"><span>Alınan nakit</span><strong>{money(body.tendered)}</strong></div>}
      {!!body.tip && <div className="total-line"><span>Bahşiş</span><strong>{money(body.tip)}</strong></div>}
      <p className="muted small">Kontrol sırasında aynı işlem numarası kullanılır; kaydedilmiş bir tahsilat ikinci kez yazılmaz.{body.method === 'card' ? ' POS cihazından yeniden çekim yapmayın.' : ''}</p>
      {storageUnavailable && <Notice>Tarayıcı geçici kaydı saklayamadı. Kontrol tamamlanana kadar bu sayfayı açık tutun.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn primary full" disabled={busy}>{busy ? 'Kontrol ediliyor…' : 'Tahsilatı yeniden kontrol et'}<Check size={18} /></button>
    </form></Modal>;
  }
  // What still blocks "Ödemeyi kaydet", said in words next to the button (never a button that just stays grey).
  const due = value + tipInside, depositCredit = account.depositCredit ?? 0;
  const amountProblem = mode === 'part' ? moneyError(amount) : '', tipProblem = tipOpen && tip.trim() ? moneyError(tip) : '';
  const tenderedProblem = method === 'cash' ? (tendered.trim() ? moneyError(tendered, { min: 0 }) : 'Alınan nakdi yazın.') : '';
  const hint = !canPay || uncertain || busy || locked ? '' : byItems && value <= 0 ? 'Ödenecek ürünleri seçin.' : tipOutAsked && tipPaidOut === null ? 'Bahşişin garsona kasadan nakit verilip verilmediğini seçin.' : amountProblem || tipProblem || tenderedProblem || (method === 'cash' && change < 0 ? `Alınan nakit ${money(-change)} eksik.` : '');
  // "Tam" = exactly what is due (with a cash tip); the notes fill "Alınan nakit" at one tap. A note smaller than the bill is greyed.
  const quick: [string, number][] = [['Tam', due], ['₺100', 10000], ['₺200', 20000], ['₺500', 50000], ['₺1.000', 100000]];
  const typing = (set: (v: string) => void) => (v: string) => { set(v); setPaymentNotice(''); setGivenChange(null); };
  return <Modal title={`${table.name} · Ödeme al`} className="modal-steady payment-modal" dismissible={!busy && !uncertain} onClose={() => { if (!busy && !uncertain) onClose(); }}><form ref={paymentForm} className="modal-body payment-form" onSubmit={e => void submit(e)}>
    <div className="payment-main">
      {!canPay && <Notice>Bu hesapta tahsil edilecek tutar kalmadı. Pencereyi kapatıp güncel masayı kontrol edin.</Notice>}
      {needsReview && <Notice>Bu hesap başka bir işlemle güncellendi. Devam etmeden kalan tutarı kontrol edin.<button type="button" className="text-btn" disabled={busy} onClick={reviewAccount}>Güncel hesabı kullan</button></Notice>}
      {paymentNotice && <Notice tone="success">{paymentNotice}</Notice>}
      <FiscalSlot itemKey={fiscalKey} />
      <div className="payment-balance"><small>KALAN HESAP</small><h2>{money(account.balance)}</h2>{account.paid > 0 && <p>{money(account.paid)} tahsil edildi</p>}{depositCredit > 0 && <p className="payment-deposit">Kapora düşüldü: {money(depositCredit)} <small>(rezervasyonda alınmıştı)</small></p>}</div>
      {printing && <div className="payment-bill-row"><button type="button" className="btn secondary small-btn" disabled={billBusy || !canPay} onClick={() => void printBill()}><Printer size={15} />{billBusy ? 'Yazdırılıyor…' : 'Hesap fişi'}</button></div>}
      {billNotice && <Notice tone={billNotice.ok ? 'success' : 'error'}>{billNotice.text}</Notice>}
      <div className="payment-method"><button type="button" disabled={locked || uncertain} className={method === 'cash' ? 'selected' : ''} onClick={() => setMethod('cash')}><Wallet size={20} />Nakit</button><button type="button" disabled={locked || uncertain} className={method === 'card' ? 'selected' : ''} onClick={() => setMethod('card')}><CreditCard size={20} />Kart</button></div>
      {prefer && <p className="payment-prefer" role="status">Müşteri hesabı isterken “{prefer === 'card' ? 'Kart' : 'Nakit'}” dedi.</p>}
      <div className="payment-scope" role="group" aria-label="Ne kadar ödenecek">{([['all', 'Tamamı'], ['part', 'Bir kısmı'], ['items', 'Ürün seç']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={mode === value} className={mode === value ? 'selected' : ''} disabled={locked || uncertain} onClick={() => chooseMode(value)}>{label}</button>)}</div>
      {byItems && <PaymentItems accountId={account.id} version={account.version} deposit={depositCredit > 0} disabled={locked || uncertain} onChange={v => { setChosen(v); setTendered(moneyInput(v?.total ?? 0)); }} />}
      {mode === 'part' && <><label>Tahsil edilecek tutar (TL)<input inputMode="decimal" value={amount} disabled={locked || uncertain} aria-invalid={!!amountProblem} onChange={e => { typing(setAmount)(e.target.value); setTendered(e.target.value); }} required />{amountProblem && <small className="field-error" role="alert">{amountProblem}</small>}</label><small className="muted">Hesabın bir kısmını alıyorsanız tutarı yazın.</small></>}
      {byItems && <small className="muted">Seçtiğiniz ürünlerin toplamı tahsil edilir: {money(value)}</small>}
      {tipOpen ? <div className="payment-tip"><label>Bahşiş (TL)<input aria-label="Bahşiş tutarı" inputMode="decimal" value={tip} placeholder="Örn. 20" disabled={locked || uncertain} aria-invalid={!!tipProblem} onChange={e => { const next = e.target.value.trim() === '' ? 0 : parseMoney(e.target.value); setTip(e.target.value); if (method === 'cash' && tipWay === 'cash' && Number.isFinite(next) && parseMoney(tendered) === value + tipInside) setTendered(moneyInput(value + next)); }} />{tipProblem && <small className="field-error" role="alert">{tipProblem}</small>}</label><div className="payment-tip-way" role="group" aria-label="Bahşiş nasıl ödendi">{(['cash', 'card'] as const).map(w => <button type="button" key={w} aria-pressed={tipWay === w} className={tipWay === w ? 'selected' : ''} disabled={locked || uncertain} onClick={() => { if (method === 'cash' && parseMoney(tendered) === value + tipInside) setTendered(moneyInput(value + (w === 'cash' && Number.isFinite(tipValue) ? tipValue : 0))); setTipMethod(w === method ? null : w); }}>{w === 'cash' ? 'Nakit bahşiş' : 'Kartla bahşiş'}</button>)}</div><small className="muted">Bahşiş satışa yazılmaz; gün sonunda ayrı satırda görünür.{method === 'card' && tipInside > 0 ? ` POS'tan toplam ${money(value + tipInside)} çekin.` : method === 'cash' && tipWay === 'card' && tipValue > 0 ? ` Bahşişi POS'tan ayrıca ${money(tipValue)} çekin.` : method === 'card' && tipWay === 'cash' && tipValue > 0 ? ' Nakit bahşiş kasaya girer.' : ''}</small>{tipOutAsked && <div className="payment-tip-out" role="radiogroup" aria-label="Bahşiş garsona kasadan nakit verildi mi"><span>Bahşiş garsona kasadan nakit verildi mi?</span>{([[true, 'Evet'], [false, 'Hayır']] as const).map(([v, label]) => <button type="button" role="radio" key={label} aria-checked={tipPaidOut === v} className={tipPaidOut === v ? 'selected' : ''} disabled={locked || uncertain} onClick={() => setTipPaidOut(v)}>{label}</button>)}<small className="muted">{tipPaidOut === true ? 'Kasadan “Kart bahşişi nakit ödendi” çıkışı yazılır.' : tipPaidOut === false ? 'Bahşiş Personel → Vardiya ve bahşiş → Bahşiş’te garsona ödenecek olarak kalır.' : ''}</small></div>}<button type="button" className="text-btn" disabled={locked || uncertain} onClick={() => { setTipOpen(false); setTip(''); setTipMethod(null); setTipPaidOut(null); }}>Bahşişi kaldır</button></div> : <button type="button" className="text-btn payment-tip-open" disabled={locked || uncertain} onClick={() => setTipOpen(true)}>+ Bahşiş ekle</button>}
      {method === 'cash' && <div className="payment-cash"><label>Alınan nakit (TL)<input inputMode="decimal" value={tendered} disabled={locked || uncertain} aria-invalid={!!tendered.trim() && !!tenderedProblem} onChange={e => typing(setTendered)(e.target.value)} required />{tendered.trim() && tenderedProblem && <small className="field-error" role="alert">{tenderedProblem}</small>}</label>
        <div className="payment-quick" role="group" aria-label="Hızlı nakit tutarı">{quick.map(([label, kurus]) => <button type="button" key={label} className={Number.isFinite(due) && parseMoney(tendered) === kurus ? 'selected' : ''} disabled={locked || uncertain || !Number.isFinite(due) || due <= 0 || kurus < due} onClick={() => typing(setTendered)(moneyInput(kurus))}>{label}</button>)}</div></div>}
      {refreshAfter !== null && <Notice>Ödeme alındı. Kalan ürünler güncelleniyor…<button type="button" className="text-btn" onClick={onRefresh}>Yeniden kontrol et</button></Notice>}
    </div>
    {/* Always in sight, whatever is open above it (a tip, a print error, a long item list): the change and the save button. */}
    <div className="payment-footer">
      {givenChange !== null ? <div className="payment-change given" aria-live="polite" data-testid="given-change"><span>Verilecek para üstü</span><strong>{money(givenChange)}</strong></div>
        : method === 'cash' ? <div className={`payment-change${Number.isFinite(change) && change < 0 ? ' short' : ''}`} aria-live="polite"><span>{Number.isFinite(change) && change < 0 ? 'Eksik tutar' : 'Para üstü'}</span><strong>{Number.isFinite(change) ? money(Math.abs(change)) : '—'}</strong></div>
        : <p className="payment-card-note">Kart tahsilatını POS cihazında {Number.isFinite(due) && due > 0 ? `${money(due)} olarak ` : ''}tamamladıktan sonra kaydedin.</p>}
      {error && <Notice tone="error">{error}</Notice>}
      {hint && <p className="payment-save-hint" role="status">{hint}</p>}
      <div className="payment-footer-actions">
        {printing && <label className="checkbox-label payment-print-after"><input type="checkbox" checked={printAfter} onChange={e => rememberPrint(e.target.checked)} />Ödemeden sonra fiş yazdır</label>}
        <button className="btn primary full" disabled={!canPay || locked || (!uncertain && (!Number.isFinite(value) || value <= 0 || change < 0 || !Number.isFinite(cash) || !Number.isFinite(tipValue) || (tipOutAsked && tipPaidOut === null)))}>{busy ? 'Kaydediliyor…' : uncertain ? 'Tahsilatı yeniden kontrol et' : 'Ödemeyi kaydet'}<Check size={18} /></button>
        {onLater && !busy && <button type="button" className="btn secondary full" onClick={onLater}>Sonra öde</button>}
      </div>
    </div>
  </form></Modal>;
}
