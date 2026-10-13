import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Banknote, ChevronDown, CircleEllipsis, Clock3, HandCoins, Landmark, MoonStar, PlusCircle, QrCode, ReceiptText, RotateCcw, Sunrise, TriangleAlert, Undo2, Wallet } from 'lucide-react';
import { movementNames, type CashMovementKind, type CashStatus, type PendingReceipt } from '../packages/domain/cash';
import type { StaffSnapshot } from '../packages/domain/types';
import { api, ApiError, money, moneyError, moneyInput, parseMoney, requestId } from './api';
import { Modal, Notice } from './components';
import { clock, ClosingDialog, longDay, signedMoney } from './CashClosing';
import { CounterCodeDialog } from './Shifts';
import { RefundWindow } from './RefundWindow';
import { refundPower } from '../packages/domain/refund-rules';
import { saatEki } from '../packages/domain/saat-eki';
import './cash-shifts.css';

/*
 * The cash day on Masalar and on Kasa ve giderler → Bugün (owner, Müdür, cashier; server/cash-closing.ts): the morning opening, "Dünün kasası
 * kapanmadı", the reminder after the closing time when the last bill is closed, a waiting count, and the "Kasa" strip with
 * Para bozdurma, the owner's cash movements, the vardiya code and "Gün sonu". Nothing here blocks the floor: the cards sit
 * above the tables. `mola:cash-close` (the desktop rail's "Kapat") opens the closing from any screen.
 */
export function useCashStatus(enabled: boolean) {
  const [status, setStatus] = useState<CashStatus | null>(null);
  const load = useCallback(async () => { try { setStatus(await api<CashStatus>('/api/staff/cash/status')); } catch { /* shown by the workspace */ } }, []);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => clearInterval(t);
  }, [enabled, load]);
  return { status, reload: load };
}
/** "23:00" is past (until 05:00 the next morning, the same cash day). */
function pastClosingTime(time: string | null) {
  if (!time) return false;
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  return time >= '05:00' ? now >= time || now < '05:00' : now >= time && now < '05:00';
}

/** What the "Kasa" strip says; null while the morning's opening card is on screen (it says it already). */
export function stripState(status: CashStatus): { title: string; line: string } | null {
  if (status.showOpening) return null;
  if (status.closedToday) return { title: 'Kasa kapandı', line: status.afterClose ? 'Gün sonundan sonra satış var · ek kapanış yapın' : `${clock(status.closedToday.at)} · ${status.closedToday.byName} · Yarın sabah açılış` };
  if (!status.start && !status.opening.confirmed) return { title: 'Kasa açılmadı', line: 'Açılış bekleniyor' };
  const moves = status.movements.length ? ` · ${status.movements.length} hareket` : '';
  // After a "Vardiya devri" the window starts at the handover, with what was handed over.
  if (status.handover) return { title: 'Kasa açık', line: `Devir ${clock(status.handover.at)} · ${money(status.handover.amount)}${moves}` };
  const since = status.opening.at ?? status.start;
  return { title: 'Kasa açık', line: `${since ? `${saatEki(clock(since), 'den')} beri · ` : ''}Açılış ${money(status.opening.amount)}${moves}` };
}

/**
 * `compact` (the counter's Masalar, ≥ 900 px): the strip becomes one status chip ("Kasa açık · 08:12'den beri · ₺500") whose
 * menu holds the same actions, plus `onExpense` ("Gider kaydet": everyone at the counter, the owner too since 10 Ekim). The morning opening and the warnings stay
 * as banners under the head; nothing is lost, only folded.
 */
/**
 * Bills still open when the gün sonu starts (8 Ekim denetimi: the count went ahead with Masa 02's ₺230 unpaid and nothing
 * said so). One line in the count window; the count is not blocked (a bill paid later goes to an "Ek kapanış").
 */
export function openBillsNote(data: Pick<StaffSnapshot, 'tables'>) {
  const open = data.tables.filter(t => t.account && t.account.balance > 0);
  if (!open.length) return '';
  return `${open.length} açık hesap var: ${open.slice(0, 3).map(t => `${t.name} ${money(t.account!.balance)}`).join(', ')}${open.length > 3 ? '…' : ''}. Mümkünse önce ödemesini alın; gün sonundan sonra alınan ödeme için ek kapanış gerekir.`;
}
/**
 * 9 Ekim kullanıcı testi (K-C): the count window also says what the kitchen has not finished yet (new or being prepared).
 * The gün sonu does not stop the kitchen: it ends only the closing person's own shift.
 */
export function kitchenNote(data: Pick<StaffSnapshot, 'orders'>) {
  const n = data.orders.filter(o => o.status === 'new' || o.status === 'preparing').length;
  return n ? `Mutfakta ${n} sipariş bitmedi.` : '';
}
export function CashDayPanel({ data, visible, onToast, compact = false, onExpense, slot }: { data: StaffSnapshot; visible: boolean; onToast: (message: string) => void; compact?: boolean; onExpense?: () => void; slot?: HTMLElement | null }) {
  const owner = data.role === 'owner';
  const { status, reload } = useCashStatus(true);
  const [closing, setClosing] = useState(false), [moving, setMoving] = useState(false), [code, setCode] = useState(false), [refund, setRefund] = useState(false), [revoking, setRevoking] = useState(false);
  const [menu, setMenu] = useState(false), menuId = useId(), [receiving, setReceiving] = useState<PendingReceipt | null>(null);
  useEffect(() => { if (!menu) return; const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target instanceof Element && e.target.closest('.cash-chip-wrap'))) setMenu(false); }; document.addEventListener('pointerdown', close); document.addEventListener('keydown', close); return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); }; }, [menu]);
  // "İade": owner and Müdür any refund, the cashier small ones (or a request to the owner); packages/domain/refund-rules.ts.
  const canRefund = refundPower(data.role) !== 'none';
  useEffect(() => { const open = () => setClosing(true); window.addEventListener('mola:cash-close', open); return () => window.removeEventListener('mola:cash-close', open); }, []);
  // Coming back to Masalar (from Ayarlar, a report) shows the current day at once, not after the next 30-second read.
  useEffect(() => { if (visible) void reload(); }, [visible, reload]);
  // 9 Ekim kullanıcı testi: a bill paid after the closing said "Yarın sabah açılış" for up to 30 s; once the day is closed,
  // any change on the floor (a payment) reads the cash day again so "ek kapanış yapın" shows at once.
  const closedQuiet = !!status?.closedToday && !status.afterClose;
  // `data` is a new snapshot only when the floor changed (the poll answers 204 otherwise; `revision` is the menu's).
  useEffect(() => { if (closedQuiet) void reload(); }, [data, closedQuiet, reload]);
  if (!status) return null;
  const openBills = data.tables.filter(t => t.account).length + (data.takeaways ?? []).filter(t => t.account).length + (data.eventTables ?? []).filter(t => t.account).length;
  const running = !!status.start && !status.closedToday && !status.showOpening;
  // "Bütün hesaplar kapandı" only once something was sold today: a kasa opened after the closing time with nothing sold is no reminder.
  const remind = running && !status.unclosedPrevious && !status.draft && openBills === 0 && pastClosingTime(status.settings.closingTime) && !!status.sold;
  const state = stripState(status);
  // After the day is closed "Gün sonu" is no longer the main action, unless the floor kept selling (one more closing).
  const closePrimary = !status.closedToday || !!status.afterClose;
  const act = (open: () => void) => () => { setMenu(false); open(); };
  const actions = <>
          <button type="button" className="btn secondary small-btn" onClick={act(() => setMoving(true))}><ArrowLeftRight size={16} aria-hidden="true" />{owner ? 'Kasa hareketi' : 'Para bozdurma'}</button>
          {onExpense && <button type="button" className="btn secondary small-btn" onClick={act(onExpense)}><ReceiptText size={16} aria-hidden="true" />Gider kaydet</button>}
          {canRefund && <button type="button" className="btn secondary small-btn" onClick={act(() => setRefund(true))}><Undo2 size={16} aria-hidden="true" />İade</button>}
          {status.settings.shiftTracking && <button type="button" className="btn secondary small-btn" onClick={act(() => setCode(true))}><QrCode size={16} aria-hidden="true" />Vardiya kodu</button>}
          <button type="button" className={`btn ${closePrimary && !status.showOpening ? 'primary' : 'secondary'} small-btn cash-close-button`} onClick={act(() => setClosing(true))}><MoonStar size={16} aria-hidden="true" />Gün sonu</button>
          {/* 13 Ekim: a gün sonu done by mistake is taken back the same night, before any new payment (the person who did it, the owner, the Müdür). */}
          {status.closedToday?.id && status.closedToday.revoke === null && <button type="button" className="btn secondary small-btn cash-revoke-button" onClick={act(() => setRevoking(true))}><RotateCcw size={16} aria-hidden="true" />Gün sonunu geri al</button>}
  </>;
  // Compact: the chip and banners go into the counter's head (`slot`); the dialogs stay here, so they live on across sizes.
  // Kasa ve giderler → Bugün passes its own slot (not compact): the full strip is drawn there.
  const place = (node: ReactNode) => slot ? createPortal(node, slot) : node;
  const chip = state ? `${state.title} · ${state.line.replace('Açılış ', '')}` : 'Kasa açılışı bekliyor';
  return <>
    {visible && (!compact || slot) && place(<section className={`cash-day${compact ? ' compact' : ''}`} aria-label="Kasa">
      {compact && <div className="cash-chip-wrap"><button type="button" className={`cash-chip${status.afterClose || status.unclosedPrevious || status.showOpening ? ' warn' : ''}`} aria-expanded={menu} aria-controls={menuId} onClick={() => setMenu(m => !m)}><Banknote size={17} aria-hidden="true" /><span>{chip}</span><ChevronDown size={16} aria-hidden="true" /></button>
        {menu && <div className="cash-menu" id={menuId} role="group" aria-label="Kasa işlemleri">{actions}</div>}</div>}
      {status.showOpening && <OpeningCard status={status} owner={owner} onSaved={message => { onToast(message); void reload(); }} />}
      {/* Kasa güvenliği → receipt: the money taken out at a gün sonu waits for the owner's count. */}
      {owner && status.receipts?.map(r => <div className="cash-alert receipt" role="status" key={r.closingId}><HandCoins size={20} aria-hidden="true" /><div><strong>Teslim alınacak para: {money(r.taken)}</strong><span>{r.byName} {longDay(r.day)} gün sonunda kasadan çıkardı ({clock(r.at)}). Sayıp teslim alın.</span></div><button type="button" className="btn primary" onClick={() => setReceiving(r)}>Teslim al</button></div>)}
      {status.unclosedPrevious && !status.draft && <div className="cash-alert warn" role="status"><TriangleAlert size={20} aria-hidden="true" /><div><strong>Dünün kasası kapanmadı</strong><span>{longDay(status.unclosedPrevious.day)} açılan kasa sayılıp kapatılmadı. Yeni güne başlamadan önce gün sonunu yapın.</span></div><button type="button" className="btn primary" onClick={() => setClosing(true)}>Dünün kasasını kapat</button></div>}
      {status.draft && <div className="cash-alert" role="status"><Clock3 size={20} aria-hidden="true" /><div><strong>Kasa sayımı bekliyor</strong><span>{status.draft.byName} {saatEki(clock(status.draft.countedAt), 'de')} saydı; kapanış henüz tamamlanmadı.</span></div><button type="button" className="btn primary" onClick={() => setClosing(true)}>Kapanışı tamamla</button></div>}
      {remind && <div className="cash-alert" role="status"><MoonStar size={20} aria-hidden="true" /><div><strong>Bütün hesaplar kapandı</strong><span>Kapanış saati ({status.settings.closingTime}) geçti. Gün sonu kasasını sayıp kapatın.</span></div><button type="button" className="btn primary" onClick={() => setClosing(true)}>Gün sonunu yap</button></div>}
      {!compact && <div className={`cash-strip${status.afterClose ? ' after-close' : ''}`}>
        {/* While the morning's "Kasa açılışı" card waits, it says it all: no second "Kasa açılmadı" beside it. */}
        {state && <div className="cash-strip-state"><span className="cash-strip-icon" aria-hidden="true"><Banknote size={20} /></span><div>
          <strong>{state.title}</strong><small className={status.afterClose ? 'cash-strip-warn' : undefined}>{state.line}</small>
        </div></div>}
        <div className="cash-strip-actions">{actions}</div>
      </div>}
    </section>)}
    {closing && <ClosingDialog openBills={openBillsNote(data)} kitchen={kitchenNote(data)} status={status} printing={!!data.printing?.bill} business={data.name} owner={owner} onClose={() => { setClosing(false); void reload(); }} onDone={message => { onToast(message); void reload(); }} />}
    {moving && <MovementDialog status={status} owner={owner} onClose={() => setMoving(false)} onSaved={message => { setMoving(false); onToast(message); void reload(); }} />}
    {receiving && <ReceiptDialog receipt={receiving} onClose={() => setReceiving(null)} onDone={message => { setReceiving(null); onToast(message); void reload(); }} />}
    {revoking && status.closedToday && <RevokeDialog status={status} onClose={() => setRevoking(false)} onDone={message => { setRevoking(false); onToast(message); void reload(); }} />}
    {code && <CounterCodeDialog onClose={() => setCode(false)} />}
    {refund && <RefundWindow onClose={() => setRefund(false)} onDone={message => { setRefund(false); onToast(message); void reload(); }} />}
  </>;
}

/**
 * The morning: the carried amount to confirm (cashier), or to correct (owner). A cashier reports a difference with a note.
 * Kasa güvenliği (14 Ekim): a blind opening (`status.blindOpening`) shows no carried amount and asks no note; after a
 * "Vardiya devri" with handoverCount on, the incoming person counts the same way ("Vardiya devrini al").
 */
function OpeningCard({ status, owner, onSaved }: { status: CashStatus; owner: boolean; onSaved: (message: string) => void }) {
  const id = useId(), carried = status.carried, blind = !!status.blindOpening, handover = status.handoverWaiting;
  const [other, setOther] = useState(owner || carried === null || blind), [amount, setAmount] = useState(carried === null ? '' : moneyInput(carried)), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [touched, setTouched] = useState(false);
  const value = other ? parseMoney(amount) : carried ?? 0, differs = carried !== null && Number.isFinite(value) && value !== carried;
  const amountProblem = other && (touched || amount.trim()) ? moneyError(amount, { min: 0 }) : '';
  async function save() {
    if (busy || !Number.isFinite(value)) return;
    setBusy(true); setError('');
    try { await api('/api/staff/cash/open', { requestId: requestId(), amount: value, ...(note.trim() ? { note: note.trim() } : {}) }); onSaved(handover ? `Vardiya devri alındı: ${money(value)} sayıldı.` : `Kasa açıldı: ${money(value)}.`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const lead = handover && blind ? <>{handover.byName} kasayı {saatEki(clock(handover.at), 'de')} devretti. Devredilen tutarı görmeden kasayı sayıp yazın; fark işletme sahibine iletilir.</>
    : handover ? <>{handover.byName} kasayı {saatEki(clock(handover.at), 'de')} devretti: <strong>{money(carried ?? 0)}</strong>. Kasayı sayın; tutar aynıysa onaylayın.</>
    : blind ? 'Kasadaki nakdi sayıp yazın. Dünden devreden tutar gösterilmez; fark işletme sahibine iletilir.'
    : carried === null ? 'İlk açılış: kasadaki nakdi sayıp yazın.' : <>Dünden devreden: <strong>{money(carried)}</strong>. Kasayı sayın; tutar aynıysa onaylayın.</>;
  return <form className="cash-opening" aria-labelledby={`${id}-title`} onSubmit={e => { e.preventDefault(); void save(); }}>
    <span className="cash-opening-icon" aria-hidden="true"><Sunrise size={22} /></span>
    <div className="cash-opening-copy">
      <h2 id={`${id}-title`}>{handover ? 'Vardiya devrini al' : 'Kasa açılışı'}</h2>
      <p>{lead}</p>
    </div>
    <div className="cash-opening-form">
      {other && <label htmlFor={`${id}-amount`}>Kasadaki nakit (TL)<input id={`${id}-amount`} aria-label="Açılış tutarı" inputMode="decimal" value={amount} aria-invalid={!!amountProblem} onBlur={() => setTouched(true)} onChange={e => setAmount(e.target.value)} placeholder="Örn. 500" />{amountProblem && <small className="field-error" role="alert">{amountProblem}</small>}</label>}
      {other && (differs || (!owner && carried !== null)) && <label htmlFor={`${id}-note`}>{!owner && differs ? 'Farkın nedeni *' : 'Not (isteğe bağlı)'}<input id={`${id}-note`} aria-label="Açılış notu" value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="Örn. Sabah 50 TL bozuk para alındı" /></label>}
      {differs && <p className="cash-opening-diff">Devredenden fark: <strong>{signedMoney(value - carried!)}</strong>{!owner && ' · İşletme sahibine bildirilir.'}{!owner && !note.trim() && ' Farkın nedenini yazın.'}</p>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="cash-opening-actions">
        {!other && <button type="button" className="btn secondary" onClick={() => setOther(true)}>Farklı tutar bildir</button>}
        {other && !owner && carried !== null && <button type="button" className="btn secondary" onClick={() => { setOther(false); setAmount(moneyInput(carried)); setNote(''); }}>Vazgeç</button>}
        <button className="btn primary" disabled={busy || !Number.isFinite(value) || (other && amount.trim() === '') || (!owner && differs && !note.trim())}>{busy ? 'Kaydediliyor…' : handover && other ? 'Sayımı kaydet ve devri al' : other ? 'Açılışı kaydet' : handover ? `Devri onayla · ${money(value)}` : `Açılışı onayla · ${money(value)}`}</button>
      </div>
    </div>
  </form>;
}

/**
 * 13 Ekim tanıtım ("çok karışık"): the owner first says what happened in plain words, then (for money out) why. Three
 * big choices instead of five tabs; the cashier keeps only Para bozdurma, as before.
 */
type MovementGroup = 'exchange' | 'out' | 'in';
const outKinds: { kind: CashMovementKind; label: string; icon: ReactNode }[] = [
  { kind: 'owner_took', label: 'Ben aldım', icon: <Wallet size={18} aria-hidden="true" /> },
  { kind: 'bank', label: 'Bankaya yatırdım', icon: <Landmark size={18} aria-hidden="true" /> },
  { kind: 'tip_out', label: 'Garsona kart bahşişi', icon: <HandCoins size={18} aria-hidden="true" /> },
  { kind: 'other_out', label: 'Başka bir şey', icon: <CircleEllipsis size={18} aria-hidden="true" /> },
];
const groupOf = (k: CashMovementKind): MovementGroup => k === 'exchange' ? 'exchange' : k === 'owner_in' ? 'in' : 'out';
/**
 * "Teslim aldım" (Kasa güvenliği → receipt): the owner counts the money taken out at a gün sonu and writes what is there; a
 * difference needs a short note and stays with the closing (Kapanışlar).
 */
function ReceiptDialog({ receipt, onClose, onDone }: { receipt: PendingReceipt; onClose: () => void; onDone: (message: string) => void }) {
  const id = useId(), [amount, setAmount] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [request] = useState(requestId);
  const value = parseMoney(amount), problem = amount.trim() ? moneyError(amount, { min: 0 }) : '', differs = amount.trim() !== '' && Number.isFinite(value) && value !== receipt.taken;
  async function save() {
    if (busy || !Number.isFinite(value) || (differs && !note.trim())) return; setBusy(true); setError('');
    try { await api('/api/staff/cash/receipts', { requestId: request, closingId: receipt.closingId, received: value, ...(note.trim() ? { note: note.trim() } : {}) }); onDone(differs ? `Teslim alındı; ${signedMoney(value - receipt.taken)} fark kaydedildi.` : 'Teslim alındı; tutar tutuyor.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="Parayı teslim al" onClose={() => { if (!busy) onClose(); }}><form className="modal-body cash-receipt" onSubmit={e => { e.preventDefault(); void save(); }}>
    <p>{receipt.byName}, {longDay(receipt.day)} gün sonunda kasadan <strong>{money(receipt.taken)}</strong> çıkardığını yazdı. Parayı sayın ve elinize geçen tutarı yazın.</p>
    <label htmlFor={`${id}-amount`}>Saydığınız tutar (TL) *<input id={`${id}-amount`} aria-label="Teslim alınan tutar" inputMode="decimal" value={amount} aria-invalid={!!problem} autoFocus onChange={e => setAmount(e.target.value)} />{problem && <small className="field-error" role="alert">{problem}</small>}</label>
    {differs && <p className="cash-opening-diff">Fark: <strong>{signedMoney(value - receipt.taken)}</strong>. Kısa bir not yazın; kapanışta görünür.</p>}
    {differs && <label htmlFor={`${id}-note`}>Not *<input id={`${id}-note`} aria-label="Teslim notu" value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="Örn. Zarfta 200 TL eksik çıktı" /></label>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="modal-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || !amount.trim() || !!problem || (differs && !note.trim())}>{busy ? 'Kaydediliyor…' : 'Teslim aldım'}</button></div>
  </form></Modal>;
}
/** "Gün sonunu geri al": why, then the closing is taken back and the kasa is open again (server/cash-closing.ts revoke). */
function RevokeDialog({ status, onClose, onDone }: { status: CashStatus; onClose: () => void; onDone: (message: string) => void }) {
  const id = useId(), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [request] = useState(requestId);
  const closed = status.closedToday!;
  async function save() {
    if (busy || reason.trim().length < 3) return; setBusy(true); setError('');
    try { await api('/api/staff/cash/revoke', { requestId: request, id: closed.id, reason: reason.trim() }); onDone('Gün sonu geri alındı. Kasa yeniden açık.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="Gün sonunu geri al" onClose={() => { if (!busy) onClose(); }}><form className="modal-body cash-revoke" onSubmit={e => { e.preventDefault(); void save(); }}>
    <p>{saatEki(clock(closed.at), 'de')} {closed.byName} gün sonu yaptı. Geri alınca:</p>
    <ul className="cash-revoke-list"><li>Kasa, gün sonundan önceki gibi <strong>yeniden açık</strong> olur; satışa devam edersiniz.</li><li>Bu gün sonu raporlardan çıkar. Akşam yapacağınız gün sonu, günün tek kapanışı olur.</li><li>Kim, ne zaman, neden geri aldı işletme sahibine bildirilir ve kayıtta kalır.</li></ul>
    <label htmlFor={`${id}-reason`}>Neden geri alıyorsunuz? *<input id={`${id}-reason`} aria-label="Geri alma nedeni" value={reason} maxLength={300} autoFocus onChange={e => setReason(e.target.value)} placeholder="Örn. Yanlışlıkla bastım, müşteriler hâlâ içeride" /></label>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="modal-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || reason.trim().length < 3}>{busy ? 'Geri alınıyor…' : 'Gün sonunu geri al'}</button></div>
  </form></Modal>;
}
/** Para bozdurma for everyone at the counter; the owner also records real money taken out or put in. */
function MovementDialog({ status, owner, onClose, onSaved }: { status: CashStatus; owner: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const id = useId();
  // The owner starts on the three choices; the cashier has only Para bozdurma.
  const [group, setGroup] = useState<MovementGroup | null>(owner ? null : 'exchange');
  const [type, setType] = useState<CashMovementKind>('exchange'), [amount, setAmount] = useState(''), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [request] = useState(requestId);
  // "Sahip aldı" more than the drawer holds: the server asks once ("Yine de kaydet"), the amount may have an extra zero.
  const [belowZero, setBelowZero] = useState('');
  const value = parseMoney(amount), needsNote = type === 'other_out', amountProblem = amount.trim() ? moneyError(amount) : '';
  async function save(confirm = false) {
    if (busy) return; setBusy(true); setError(''); setBelowZero('');
    try { await api('/api/staff/cash/movements', { requestId: request, type, amount: value, ...(note.trim() ? { note: note.trim() } : {}), ...(confirm ? { confirm } : {}) }); onSaved(`${movementNames[type]} kaydedildi.`); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'CASH_BELOW_ZERO') setBelowZero(e.message);
      else setError(e instanceof ApiError && e.code === 'REQUEST_CONFLICT' ? 'Bu kayıt zaten gönderildi. Pencereyi kapatıp yeniden açın.' : (e as Error).message);
    } finally { setBusy(false); }
  }
  const lead: Record<CashMovementKind, string> = {
    exchange: 'Kasadan çıkan ve kasaya giren para aynı (ör. 200 TL verildi, 10 × 20 TL alındı). Beklenen tutar değişmez.',
    owner_took: 'Kasadan sizin aldığınız nakit. Gün sonunda beklenen tutardan düşülür.',
    bank: 'Bankaya yatırmak için kasadan çıkan nakit.',
    tip_out: 'Kartla alınan bahşiş garsona kasadan nakit verildi. Gün sonunda beklenen tutardan düşülür.',
    other_out: 'Gider olmayan başka bir nakit çıkışı. Kısa bir açıklama yazın.',
    owner_in: 'Kasaya sizin koyduğunuz nakit (ör. bozuk para). Beklenen tutara eklenir.',
  };
  const choose = (g: MovementGroup) => { setGroup(g); setType(g === 'exchange' ? 'exchange' : g === 'in' ? 'owner_in' : 'owner_took'); setError(''); setBelowZero(''); };
  const sign = (k: CashMovementKind) => k === 'exchange' ? '' : groupOf(k) === 'in' ? '+' : '−';
  const list = status.movements.length > 0 && <div className="cash-movement-list"><h3>Bugünkü hareketler</h3><ul>{status.movements.map(m => <li key={m.id}><span>{clock(m.at)}</span><strong>{movementNames[m.type]}</strong><span className={`move-amount ${groupOf(m.type)}`}>{sign(m.type)}{money(m.amount)}</span><small>{m.byName}{m.note ? ` · ${m.note}` : ''}</small></li>)}</ul></div>;
  // Step 1 (owner): what happened, in three plain choices.
  if (!group) return <Modal title="Kasa hareketi" onClose={onClose}><div className="modal-body cash-movement">
    <p className="muted">Kasada ne oldu?</p>
    <div className="move-choices">
      <button type="button" className="move-choice" onClick={() => choose('exchange')}><span className="move-icon neutral"><ArrowLeftRight size={22} aria-hidden="true" /></span><span><strong>Para bozdurdum</strong><small>Kasadaki toplam değişmez (ör. 200 TL → 10 × 20 TL)</small></span></button>
      <button type="button" className="move-choice" onClick={() => choose('out')}><span className="move-icon out"><ArrowUpFromLine size={22} aria-hidden="true" /></span><span><strong>Kasadan para çıktı</strong><small>Ben aldım, bankaya yatırdım, garsona bahşiş…</small></span></button>
      <button type="button" className="move-choice" onClick={() => choose('in')}><span className="move-icon in"><ArrowDownToLine size={22} aria-hidden="true" /></span><span><strong>Kasaya para koydum</strong><small>Ör. bozuk para, eksik kalan nakit</small></span></button>
    </div>
    <p className="muted small"><PlusCircle size={13} aria-hidden="true" /> Kira, maaş, alışveriş gibi ödemeler için “Gider kaydet”i kullanın.</p>
    {list}
  </div></Modal>;
  const title = group === 'exchange' ? 'Para bozdurma' : group === 'in' ? 'Kasaya para koydum' : 'Kasadan para çıktı';
  return <Modal title={title} onClose={() => { if (!busy) onClose(); }}><form className="modal-body cash-movement" onSubmit={e => { e.preventDefault(); void save(); }}>
    {owner && <button type="button" className="text-btn move-back" disabled={busy} onClick={() => setGroup(null)}>← Başka bir hareket</button>}
    {group === 'out' && <fieldset className="move-reasons"><legend>Para nereye gitti?</legend>{outKinds.map(k => <button type="button" key={k.kind} aria-pressed={type === k.kind} className={type === k.kind ? 'selected' : ''} onClick={() => { setType(k.kind); setBelowZero(''); }}>{k.icon}{k.label}</button>)}</fieldset>}
    <p className="muted">{lead[type]}</p>
    {!owner && <p className="muted small">Kasadan yapılan ödemeyi “Gider kaydet” ile yazın. Kasadan para alma yalnız işletme sahibinin hesabından kaydedilir.</p>}
    <label htmlFor={`${id}-amount`}>{type === 'exchange' ? 'Bozdurulan tutar (TL) *' : 'Tutar (TL) *'}<input id={`${id}-amount`} aria-label="Hareket tutarı" inputMode="decimal" value={amount} aria-invalid={!!amountProblem} autoFocus onChange={e => { setAmount(e.target.value); setBelowZero(''); }} required />{amountProblem && <small className="field-error" role="alert">{amountProblem}</small>}</label>
    <label htmlFor={`${id}-note`}>{needsNote ? 'Ne için? *' : 'Not (isteğe bağlı)'}<input id={`${id}-note`} aria-label="Hareket açıklaması" value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder={type === 'exchange' ? 'Örn. 200 TL → 10 × 20 TL' : type === 'bank' ? 'Örn. Ziraat hesabına' : type === 'other_out' ? 'Örn. Komşu esnafa borç' : ''} required={needsNote} />{needsNote && amount.trim() && !note.trim() && <small className="field-error">Kısa bir açıklama yazın.</small>}</label>
    {error && <Notice tone="error">{error}</Notice>}
    {belowZero ? <div className="cash-confirm" role="alert"><Notice tone="error">{belowZero}</Notice><div className="modal-actions"><button type="button" className="btn secondary" disabled={busy} onClick={() => setBelowZero('')}>Tutarı düzelt</button><button type="button" className="btn primary" disabled={busy} onClick={() => void save(true)}>Yine de kaydet</button></div></div>
      : <button className="btn primary full" disabled={busy || !Number.isFinite(value) || value <= 0 || (needsNote && !note.trim())}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button>}
    {list}
  </form></Modal>;
}

/** Desktop rail → Kapat: before shutting Mola down, a reminder if today's cash is still open (owner or cashier signed in). */
export function CashCloseReminder({ onGo }: { onGo: () => void }) {
  const [status, setStatus] = useState<CashStatus | null>(null);
  useEffect(() => { let live = true; void api<CashStatus>('/api/staff/cash/status').then(s => { if (live) setStatus(s); }).catch(() => {}); return () => { live = false; }; }, []);
  if (!status || status.closedToday || !(status.draft || status.unclosedPrevious || (status.start && status.opening.confirmed))) return null;
  return <Notice>{status.draft ? 'Kasa sayımı tamamlanmadı.' : 'Bugünün kasası kapatılmadı.'}<button type="button" className="text-btn" onClick={() => { window.dispatchEvent(new Event('mola:cash-close')); onGo(); }}>Gün sonuna git</button></Notice>;
}
