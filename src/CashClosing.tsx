import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Banknote, Check, CreditCard, FileText, Printer, ReceiptText, Smartphone } from 'lucide-react';
import { correctedDifference, DENOMINATIONS, denominationName, isBlind, movementNames, needsNote, negativeExpectedText, type BlindClosing, type CashClosing, type CashCorrection, type CashFigures, type CashRefundLine, type CashStatus, type ClosingView } from '../packages/domain/cash';
import { api, ApiError, money, moneyError, moneyInput, parseMoney, printProblem, requestId } from './api';
import { Modal, Notice } from './components';
import { saatEki } from '../packages/domain/saat-eki';
// "Yazar kasa karşılaştırması" (src/FiscalHelper.tsx): what should be on the yazar kasa, the Z raporu and its difference.
import { emptyZ, FiscalClosingSection, zBody, type ZDraft } from './FiscalHelper';
import { kasaMoney, ratesLine } from '../packages/domain/fiscal';
import './cash-shifts.css';

/*
 * Gün sonu kasa kapanışı on the screen: the blind count (banknotes and coins, or one total, and the bank POS end-of-day
 * total), then the expected amount and the difference, a note when it is large, what stays in the drawer, and the slip.
 * The count is saved before the expected amount is shown and can never be changed afterwards (server/cash-closing.ts).
 */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
export const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' });
/** 9 Ekim kullanıcı testi: Kasa kapanışları → Tümü (5 yıl) listed "14 Ağustos Pazar" without a year; another year's day says it. */
export const longDayAnyYear = (day: string, now = new Date()) => day.slice(0, 4) === String(now.getFullYear()) ? longDay(day) : new Date(`${day}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', timeZone: 'UTC' });
export const signedMoney = (kurus: number) => kurus === 0 ? money(0) : `${kurus > 0 ? '+' : '−'}${money(Math.abs(kurus))}`;
export const diffTone = (kurus: number) => kurus === 0 ? 'even' : kurus < 0 ? 'short' : 'over';
/** "Kasa eksik" / "Kasa fazla" (never "açık": that reads as "the kasa is open"). */
export const diffWord = (kurus: number) => kurus === 0 ? 'Fark yok' : kurus < 0 ? 'Kasa eksik' : 'Kasa fazla';

/** The formula, line by line: opening, sales, refunds, expenses, owner in/out, tips → expected. */
export function ExpectedLines({ f }: { f: CashFigures }) {
  const rows: [string, number, string?][] = [['Açılış (devreden)', f.opening], ['Nakit satış', f.cashSales], ['Nakit iade', -(f.cashRefunds - (f.cashierRefunds ?? 0))], ['Kasiyer iadesi (nakit)', -(f.cashierRefunds ?? 0), 'Kasiyerin kendi yaptığı iadeler'], ['Nakit gider', -f.cashExpenses], ['Kasaya konan (sahip)', f.ownerIn], ['Kasadan alınan (sahip)', -f.ownerOut], ['Nakit bahşiş', f.cashTips, 'Satış değildir; kasada ayrı durur'], ['Kart bahşişi garsona (nakit)', -(f.tipsPaidOut ?? 0), 'Kartla alınan bahşiş kasadan nakit verildi'], ['Kapora (nakit)', f.deposits ?? 0, 'Rezervasyon için alınan; hesaba düşülünce tekrar sayılmaz'], ['Kapora iadesi', -(f.depositRefunds ?? 0)]];
  return <dl className="cash-lines">
    {rows.filter(([label, v]) => v !== 0 || label.startsWith('Açılış') || label === 'Nakit satış').map(([label, v, hint]) => <div key={label}><dt>{label}{hint && <small>{hint}</small>}</dt><dd>{label.startsWith('Açılış') ? money(v) : signedMoney(v)}</dd></div>)}
    <div className={`cash-lines-total${f.expected < 0 ? ' negative' : ''}`}><dt>Beklenen nakit</dt><dd>{f.expected < 0 ? signedMoney(f.expected) : money(f.expected)}</dd></div>
    {f.exchanges > 0 && <div className="cash-lines-quiet"><dt>Para bozdurma<small>Giren ve çıkan aynı; beklenen tutar değişmez</small></dt><dd>{money(f.exchanges)}</dd></div>}
    {!!f.outsideExpenses && <div className="cash-lines-quiet"><dt>Kasa dışından ödenen gider<small>Gider sayılır, kasadan çıkmadığı için beklenen nakde girmez</small></dt><dd>{money(f.outsideExpenses)}</dd></div>}
  </dl>;
}
/** Below zero is no amount a drawer can hold: what it means and how to put it right (owner only). */
export function NegativeExpected({ f }: { f: CashFigures }) {
  const text = negativeExpectedText(f, money);
  return text ? <Notice tone="error"><span data-testid="negative-expected">{text}</span></Notice> : null;
}
/** What the counter (cashier, Müdür) sees after a count: only that it was saved and passed on (owner's decision, 8 Ekim). */
export const BLIND_DONE = 'Gün sonu kaydedildi; sayım işletme sahibine iletildi.';
export const BLIND_HANDOVER_DONE = 'Vardiya devri kaydedildi; sayım işletme sahibine iletildi.';
/** The window's refunds, one per line: time, who (a cashier's marked), what, how much and how. */
export function RefundLines({ refunds }: { refunds?: CashRefundLine[] }) {
  if (!refunds?.length) return null;
  return <section className="cash-detail-list cash-refund-list" aria-label="İadeler"><h4>İadeler</h4><ul>{refunds.map(r => <li key={r.id}><span>{clock(r.at)}</span><strong>{r.text || 'İade'}</strong><span>{signedMoney(-r.amount)} · {r.method === 'card' ? 'kart' : 'nakit'}</span><small>{r.byName}{r.cashier ? ' (kasiyer)' : ''}</small></li>)}</ul></section>;
}
/** "₺900 satış + ₺15 bahşiş + ₺300 kapora − ₺20 iade": the parts that add up to the Mola card total (empty when it is only sales). */
export function cardBreakdown(f: Pick<CashFigures, 'cardSales' | 'cardTips' | 'cardRefunds' | 'cardDeposits'>) {
  const deposits = f.cardDeposits ?? 0;
  if (!f.cardTips && !f.cardRefunds && !deposits) return '';
  return `${money(f.cardSales)} satış${f.cardTips ? ` + ${money(f.cardTips)} bahşiş` : ''}${deposits > 0 ? ` + ${money(deposits)} kapora` : deposits < 0 ? ` − ${money(-deposits)} kapora iadesi` : ''}${f.cardRefunds ? ` − ${money(f.cardRefunds)} iade` : ''}`;
}
/** Card (Mola vs. bank POS) and platform payments, apart from the drawer. */
export function CardLines({ c }: { c: Pick<CashClosing, 'figures' | 'pos' | 'cardDifference'> }) {
  const f = c.figures, parts = cardBreakdown(f);
  return <div className="cash-side">
    <div><CreditCard size={16} aria-hidden="true" /><span>Kart (Mola)</span><strong>{money(f.card)}</strong>{parts && <small>{parts}</small>}</div>
    <div><ReceiptText size={16} aria-hidden="true" /><span>Banka POS gün sonu</span><strong>{c.pos === null ? '—' : money(c.pos)}</strong>{c.cardDifference !== null && <small className={`cash-diff-text ${diffTone(c.cardDifference)}`}>Fark {signedMoney(c.cardDifference)}</small>}</div>
    {f.platform > 0 && <div><Smartphone size={16} aria-hidden="true" /><span>Platform ödemesi</span><strong>{money(f.platform)}</strong><small>Kasaya ve POS'a girmez</small></div>}
  </div>;
}
/** The big difference card shown right after the count. */
export function DifferenceCard({ c, corrections = [] }: { c: CashClosing; corrections?: CashCorrection[] }) {
  const corrected = correctedDifference(c, corrections);
  return <div className={`cash-difference ${diffTone(c.difference)}`} role="status">
    <span>{diffWord(c.difference)}</span><strong>{money(Math.abs(c.difference))}</strong>
    <small>Sayılan {money(c.counted)} · Beklenen {money(c.figures.expected)}</small>
    {corrections.length > 0 && <small>Düzeltmelerle: {signedMoney(corrected)}</small>}
  </div>;
}

type Step = { kind: 'count' } | { kind: 'result'; closing: ClosingView } | { kind: 'done'; closing: ClosingView };
/** "Gün sonu" (and "Vardiya devri"). `status`: the cash day as the server sees it; a waiting count opens at its result. */
export function ClosingDialog({ openBills = '', kitchen = '', status, printing, business, owner = false, onClose, onDone }: { openBills?: string; kitchen?: string; status: CashStatus; printing: boolean; business: string; owner?: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const id = useId();
  const [step, setStep] = useState<Step>({ kind: 'count' }), [loading, setLoading] = useState(!!status.draft);
  const [mode, setMode] = useState<'final' | 'handover'>(status.draft?.mode ?? 'final'), [entry, setEntry] = useState<'notes' | 'total'>('notes');
  const [counts, setCounts] = useState<Record<number, string>>({}), [total, setTotal] = useState(''), [pos, setPos] = useState('');
  const [note, setNote] = useState(''), [left, setLeft] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [z, setZ] = useState<ZDraft>(emptyZ), zProblem = z.total.trim() ? moneyError(z.total, { min: 0 }) : '';
  const pending = useRef<{ requestId: string } | null>(null);
  // The status is read again every few seconds while this window is open; once a count is on screen (our own, or the waiting
  // one opened here) it is never loaded again, so what the counter typed ("Kasada bırakılan", the note) is never overwritten.
  const stepKind = useRef(step.kind); stepKind.current = step.kind;
  const ownShift = useRef(false), [closingDown, setClosingDown] = useState(false);
  useEffect(() => {
    if (!status.draft || stepKind.current !== 'count') return;
    let live = true;
    api<{ closing: ClosingView }>(`/api/staff/cash/closing/${status.draft.id}`).then(r => { if (!live || stepKind.current !== 'count') return; setStep({ kind: 'result', closing: r.closing }); setLeft(v => v.trim() ? v : moneyInput(r.closing.counted)); }).catch(e => { if (live) setError((e as Error).message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [status.draft?.id]);
  /** "Tamam": the closing person's own shift of the closed day ends only now, after the result and the slip. */
  async function close() {
    if (step.kind === 'done' && ownShift.current) {
      setClosingDown(true);
      try { await api('/api/staff/cash/closing-shift', { id: step.closing.id }); } catch { /* it ends at 05:00 anyway */ }
      ownShift.current = false; window.dispatchEvent(new Event('mola:shift'));
    }
    onClose();
  }
  const noteCounts = Object.fromEntries(Object.entries(counts).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
  const notesTotal = Object.entries(noteCounts).reduce((n, [k, v]) => n + Number(k) * (Number.isInteger(v) && v >= 0 ? v : NaN), 0);
  const counted = entry === 'notes' ? notesTotal : parseMoney(total), posValue = pos.trim() === '' ? null : parseMoney(pos);
  const countReady = Number.isFinite(counted) && counted >= 0 && (entry === 'total' ? total.trim() !== '' : Object.keys(noteCounts).length > 0) && (posValue === null || Number.isFinite(posValue));
  async function saveCount() {
    if (busy || !countReady) return;
    setBusy(true); setError('');
    pending.current ??= { requestId: requestId() };
    try {
      const closing = await api<ClosingView>('/api/staff/cash/count', { requestId: pending.current.requestId, mode, ...(entry === 'notes' ? { denominations: noteCounts } : { counted }), pos: posValue });
      pending.current = null; setStep({ kind: 'result', closing }); setLeft(moneyInput(closing.counted));
    } catch (e) { setError((e as Error).message); if (e instanceof ApiError && e.status < 500) pending.current = null; }
    finally { setBusy(false); }
  }
  async function finish(closing: ClosingView) {
    const leftValue = closing.mode === 'final' ? parseMoney(left) : closing.counted;
    if (busy || !Number.isFinite(leftValue) || zProblem) return;
    setBusy(true); setError('');
    const fiscalZ = closing.fiscal && closing.mode === 'final' ? zBody(z) : undefined;
    try {
      const r = await api<{ closing: ClosingView; ownShift?: boolean }>('/api/staff/cash/finish', { id: closing.id, ...(note.trim() ? { note: note.trim() } : {}), ...(closing.mode === 'final' ? { left: leftValue } : {}), ...(fiscalZ ? { fiscalZ } : {}) });
      ownShift.current = !!r.ownShift;
      setStep({ kind: 'done', closing: r.closing });
      onDone(isBlind(r.closing) ? (r.closing.mode === 'final' ? BLIND_DONE : BLIND_HANDOVER_DONE) : r.closing.mode === 'final' ? 'Gün sonu kasası kapatıldı.' : 'Vardiya devri kaydedildi.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const handover = step.kind === 'count' ? mode === 'handover' : step.closing.mode === 'handover';
  // "Ek kapanış": today's gün sonu is done and the night kept selling; this second closing counts what came after it.
  const extra = step.kind === 'count' ? !handover && !!status.closedToday : !!step.closing.extra;
  const title = step.kind === 'count' ? (handover ? 'Vardiya devri · kasa sayımı' : extra ? 'Ek kapanış · kasa sayımı' : 'Gün sonu · kasa sayımı') : step.kind === 'result' ? (handover ? 'Vardiya devri · sonuç' : extra ? 'Ek kapanış · sonuç' : 'Gün sonu · sonuç') : handover ? 'Vardiya devri kaydedildi' : extra ? 'Ek kapanış kaydedildi' : 'Kasa kapatıldı';
  const locked = busy || step.kind === 'result';
  // Inline messages under the money fields (never a silent red border or a button that just stays grey).
  const totalProblem = entry === 'total' && total.trim() ? moneyError(total, { min: 0 }) : '', posProblem = moneyError(pos, { required: false, min: 0 });
  const leftProblem = step.kind === 'result' && step.closing.mode === 'final' ? moneyError(left, { min: 0, max: step.closing.counted }).replace(/^En fazla (.*) yazılabilir\.$/, 'Kasada bırakılan, sayılan tutardan ($1) fazla olamaz.') : '';
  return <Modal title={title} wide className="modal-steady cash-dialog" dismissible={!busy && !closingDown} onClose={() => { if (!busy && !closingDown) void close(); }}><div className="modal-body">
    {loading && <p role="status" className="muted">Bekleyen sayım açılıyor…</p>}
    {step.kind === 'count' && !loading && <form onSubmit={e => { e.preventDefault(); void saveCount(); }}>
      {!!status.start && <div className="cash-segment" role="group" aria-label="Kapanış türü">
        <button type="button" aria-pressed={mode === 'final'} className={mode === 'final' ? 'selected' : ''} onClick={() => setMode('final')}>Gün sonu</button>
        <button type="button" aria-pressed={mode === 'handover'} className={mode === 'handover' ? 'selected' : ''} onClick={() => setMode('handover')}>Vardiya devri</button>
      </div>}
      {extra && <Notice><span>Bugünün gün sonu {status.closedToday ? `${saatEki(clock(status.closedToday.at), 'de')} ` : ''}yapıldı{status.afterClose ? '; ondan sonra satış oldu' : ''}. Bu <strong>ek kapanış</strong> yalnız o kapanıştan sonraki satışları sayar ve kasada bırakılan {status.carried === null ? 'tutarla' : money(status.carried)} başlar. İkisi de aynı günün kasa kapanışları olarak raporda görünür.</span></Notice>}
      {mode === 'final' && openBills && <p className="cash-open-bills" role="status" data-testid="open-bills">{openBills}</p>}
      {mode === 'final' && kitchen && <p className="cash-open-bills" role="status" data-testid="kitchen-open">{kitchen}</p>}
      {/* K-C (9 Ekim): the gün sonu ends only the closing person's shift; the kitchen and the waiters finish theirs. */}
      {mode === 'final' && status.settings.shiftTracking && <p className="muted small" data-testid="closing-shift-note">Gün sonu yalnız sizin vardiyanızı bitirir. Mutfak ve garsonlar kendi “Vardiyayı bitir”iyle ya da 05:00'te çıkar.</p>}
      <p className="cash-lead">{mode === 'final' ? 'Kasadaki bütün nakdi sayın.' : 'Kasayı devretmeden önce birlikte sayın; sonraki kasiyer bu tutarla başlar.'} <strong>{owner ? 'Mola beklenen tutarı sayımdan sonra gösterir.' : 'Sayımınız işletme sahibine iletilir.'}</strong></p>
      {!status.opening.confirmed && !extra && <Notice>Bugün kasa açılışı onaylanmadı; açılış tutarı olarak {status.carried === null ? '0 ₺' : `devreden ${money(status.carried)}`} kullanılır.</Notice>}
      <div className="cash-segment small" role="group" aria-label="Sayım şekli">
        <button type="button" aria-pressed={entry === 'notes'} className={entry === 'notes' ? 'selected' : ''} onClick={() => setEntry('notes')}>Banknot ve bozuk para</button>
        <button type="button" aria-pressed={entry === 'total'} className={entry === 'total' ? 'selected' : ''} onClick={() => setEntry('total')}>Tek toplam</button>
      </div>
      {entry === 'notes' ? <div className="cash-notes">
        {DENOMINATIONS.map(v => { const n = Number(counts[v] ?? ''); return <label key={v} className={v >= 500 ? 'note' : 'coin'}>
          <span className="cash-note-face">{denominationName(v)}</span>
          <input aria-label={`${denominationName(v)} adedi`} inputMode="numeric" pattern="[0-9]*" placeholder="0" value={counts[v] ?? ''} onChange={e => setCounts(c => ({ ...c, [v]: e.target.value.replace(/\D/g, '').slice(0, 5) }))} />
          <small>{counts[v] ? money(v * n) : ''}</small>
        </label>; })}
      </div> : <label className="cash-field" htmlFor={`${id}-total`}>Kasadaki nakit (TL)<input id={`${id}-total`} aria-label="Kasadaki nakit toplamı" inputMode="decimal" value={total} aria-invalid={!!totalProblem} onChange={e => setTotal(e.target.value)} placeholder="Örn. 1.250" />{totalProblem && <small className="field-error" role="alert">{totalProblem}</small>}</label>}
      <div className="cash-counted" aria-live="polite"><span>Sayılan nakit</span><strong>{Number.isFinite(counted) ? money(counted) : '—'}</strong></div>
      <label className="cash-field" htmlFor={`${id}-pos`}>Banka POS gün sonu toplamı (TL) <span className="muted">· isteğe bağlı</span><input id={`${id}-pos`} aria-label="Banka POS gün sonu toplamı" inputMode="decimal" value={pos} aria-invalid={!!posProblem} onChange={e => setPos(e.target.value)} placeholder="POS cihazının gün sonu fişindeki toplam" />{posProblem && <small className="field-error" role="alert">{posProblem}</small>}</label>
      {error && <Notice tone="error">{error}</Notice>}
      {!countReady && !busy && !totalProblem && !posProblem && <p className="muted small cash-hint" role="status">{entry === 'notes' ? 'Saydığınız banknot ve bozuk paraların adedini yazın.' : 'Kasadaki toplam nakdi yazın.'}</p>}
      <button className="btn primary full" disabled={busy || !countReady}>{busy ? 'Kaydediliyor…' : 'Sayımı kaydet'}<Check size={18} /></button>
      <p className="muted small cash-hint">{owner ? 'Sayım kaydedildikten sonra değiştirilemez; fark varsa açıklamasını bir sonraki adımda yazarsınız.' : 'Sayım kaydedildikten sonra değiştirilemez; sonucu işletme sahibi görür.'}</p>
    </form>}
    {step.kind !== 'count' && <ClosingResult closing={step.closing} status={status} done={step.kind === 'done'} business={business} printing={printing}
      fiscal={step.closing.fiscal && <FiscalClosingSection fiscal={step.closing.fiscal} z={step.closing.fiscalZ} final={step.closing.mode === 'final'} edit={step.kind === 'result' ? { value: z, onChange: setZ } : undefined} />}>
      {step.kind === 'result' && <form className="cash-finish" onSubmit={e => { e.preventDefault(); void finish(step.closing); }}>
        {(() => { const c = step.closing, required = !isBlind(c) && needsNote(c.difference, { differenceNote: status.settings.differenceNote }); return <label className="cash-field" htmlFor={`${id}-note`}>{required ? 'Fark açıklaması *' : 'Not (isteğe bağlı)'}<textarea id={`${id}-note`} aria-label="Kapanış notu" value={note} maxLength={500} required={required} onChange={e => setNote(e.target.value)} placeholder={required ? `Fark ${money(status.settings.differenceNote)} sınırını aşıyor: nedenini kısaca yazın.` : isBlind(c) ? 'Örn. 50 TL bozuk para bankaya götürülecek. İşletme sahibi görür.' : 'Örn. 50 TL bozuk para bankaya götürülecek.'} /></label>; })()}
        {step.closing.mode === 'final' && <label className="cash-field" htmlFor={`${id}-left`}>Kasada bırakılan (yarının açılışı, TL)<input id={`${id}-left`} aria-label="Kasada bırakılan" inputMode="decimal" value={left} aria-invalid={!!leftProblem} onChange={e => setLeft(e.target.value)} />
          {leftProblem ? <small className="field-error" role="alert">{leftProblem}</small> : parseMoney(left) < step.closing.counted && <small className="muted">Kasadan çıkarılan: {money(step.closing.counted - parseMoney(left))}</small>}</label>}
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn primary full" disabled={(locked && busy) || !!leftProblem || !!zProblem}>{busy ? 'Kaydediliyor…' : step.closing.mode === 'final' ? 'Kapanışı tamamla' : 'Devri tamamla'}<Check size={18} /></button>
      </form>}
      {step.kind === 'done' && ownShift.current && <p className="muted small" role="status">Vardiyanız “Tamam”a basınca biter.</p>}
      {step.kind === 'done' && <button type="button" className="btn secondary full" disabled={closingDown} onClick={() => void close()}>Tamam</button>}
    </ClosingResult>}
  </div></Modal>;
}

/** After the count: difference, the formula, card and platform, and (when closed) the slip buttons. */
function ClosingResult({ closing, status, done, business, printing, fiscal, children }: { closing: ClosingView; status: CashStatus; done: boolean; business: string; printing: boolean; fiscal?: ReactNode; children: ReactNode }) {
  if (isBlind(closing)) return <BlindResult closing={closing} done={done} business={business} printing={printing} fiscal={fiscal}>{children}</BlindResult>;
  return <div className="cash-result">
    {done && <Notice tone="success">{closing.mode === 'final' ? `Kasa kapatıldı. Yarının açılışı: ${money(closing.left ?? closing.counted)}.` : `Vardiya devri kaydedildi. Sonraki kasiyer ${money(closing.counted)} ile başlar.`}{closing.shiftsEnded ? ` ${closing.shiftsEnded} açık vardiya kapanışla bitti.` : ''}</Notice>}
    {!done && status.settings && <p className="muted small">Sayım kaydedildi ({clock(closing.to)}). Sonuç aşağıda.</p>}
    <DifferenceCard c={closing} />
    <NegativeExpected f={closing.figures} />
    <div className="cash-result-grid">
      <section aria-label="Beklenen nakit"><h3><Banknote size={16} aria-hidden="true" />Kasa</h3><ExpectedLines f={closing.figures} /></section>
      <section aria-label="Kart ve platform"><h3><CreditCard size={16} aria-hidden="true" />Kart ve platform</h3><CardLines c={closing} /></section>
    </div>
    <RefundLines refunds={closing.refunds} />
    {fiscal}
    {children}
    {done && <SlipButtons closing={closing} corrections={[]} business={business} printing={printing} />}
  </div>;
}

/**
 * The counter's result (cashier, Müdür): what they counted and typed, the yazar kasa part, the note and the amount left.
 * No expected cash, no difference, no "kasa fazla/eksik": the server does not even send them (packages/domain/cash.ts).
 */
function BlindResult({ closing, done, business, printing, fiscal, children }: { closing: BlindClosing; done: boolean; business: string; printing: boolean; fiscal?: ReactNode; children: ReactNode }) {
  return <div className="cash-result cash-result-blind">
    <div className={`cash-difference blind${done ? ' done' : ''}`} role="status" data-testid="blind-result">
      <span>{done ? (closing.mode === 'final' ? BLIND_DONE : BLIND_HANDOVER_DONE) : `Sayım kaydedildi (${clock(closing.to)}).`}</span>
      <strong>{money(closing.counted)}</strong>
      <small>Sayılan nakit{closing.pos !== null ? ` · Banka POS ${money(closing.pos)}` : ''}</small>
      {done && closing.mode === 'final' && <small>Yarının açılışı: {money(closing.left ?? closing.counted)}{closing.shiftsEnded ? ` · ${closing.shiftsEnded} açık vardiya kapanışla bitti` : ''}</small>}
    </div>
    {!done && <p className="muted small">{closing.mode === 'final' ? 'Kasada bırakılan tutarı yazıp kapanışı tamamlayın. Sonucu işletme sahibi görür.' : 'Devri tamamlayın; sonraki kasiyer bu tutarla başlar.'}</p>}
    {fiscal}
    {children}
    {done && <SlipButtons closing={closing} corrections={[]} business={business} printing={printing} />}
  </div>;
}

/** Receipt printer (when one prints bills) and A4 through the browser's own print window. */
export function SlipButtons({ closing, corrections, business, printing }: { closing: ClosingView; corrections: CashCorrection[]; business: string; printing: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null), [a4, setA4] = useState(false);
  async function receipt() { setBusy(true); setMessage(null); try { await api('/api/staff/cash/print', { id: closing.id }); setMessage({ ok: true, text: 'Kapanış fişi yazdırıldı.' }); } catch (e) { setMessage({ ok: false, text: printProblem(e) }); } finally { setBusy(false); } }
  return <div className="cash-slip-actions">
    {printing && <button type="button" className="btn secondary" disabled={busy} onClick={() => void receipt()}><Printer size={16} aria-hidden="true" />{busy ? 'Yazdırılıyor…' : 'Fiş yazdır'}</button>}
    <button type="button" className="btn secondary" onClick={() => setA4(true)}><FileText size={16} aria-hidden="true" />A4 yazdır</button>
    {message && <Notice tone={message.ok ? 'success' : 'error'}>{message.text}</Notice>}
    {a4 && <PrintSheet closing={closing} corrections={corrections} business={business} onDone={() => setA4(false)} />}
  </div>;
}

/** The A4 slip: rendered only for printing (everything else on the page is hidden while it prints). */
function PrintSheet({ closing: c, corrections, business, onDone }: { closing: ClosingView; corrections: CashCorrection[]; business: string; onDone: () => void }) {
  useEffect(() => {
    document.body.classList.add('cash-printing');
    const finish = () => { document.body.classList.remove('cash-printing'); onDone(); };
    window.addEventListener('afterprint', finish, { once: true });
    const t = setTimeout(() => { window.print(); }, 50);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', finish); document.body.classList.remove('cash-printing'); };
  }, []);
  if (isBlind(c)) return createPortal(<div className="cash-print-root" aria-hidden="true">
    <h1>{business}</h1>
    <h2>{c.mode === 'final' ? (c.extra ? 'Gün sonu · ek kapanış' : 'Gün sonu kasa sayımı') : 'Vardiya devri'} · {longDay(c.day)}</h2>
    <p>Sayım {clock(c.to)} · {c.byName}{c.closedBy ? ` · Tamamlayan: ${c.closedBy}` : ''}</p>
    <table><tbody>
      <tr className="total"><th>Sayılan nakit</th><td>{money(c.counted)}</td></tr>
      {c.pos !== null && <tr><th>Banka POS gün sonu</th><td>{money(c.pos)}</td></tr>}
      {c.mode === 'final' && <tr><th>Kasada bırakılan</th><td>{money(c.left ?? c.counted)}</td></tr>}
      {c.fiscal && <tr className="total"><th>Yazar kasaya girilmesi gereken</th><td>{kasaMoney(c.fiscal.total)}</td></tr>}
    </tbody></table>
    {c.note && <p><strong>Not:</strong> {c.note}</p>}
    <p className="cash-print-foot">Sayım işletme sahibine iletildi. Bilgi fişidir. Mali değeri yoktur.</p>
  </div>, document.body);
  const f = c.figures;
  return createPortal(<div className="cash-print-root" aria-hidden="true">
    <h1>{business}</h1>
    <h2>{c.mode === 'final' ? (c.extra ? 'Gün sonu · ek kapanış' : 'Gün sonu kasa kapanışı') : 'Vardiya devri'} · {longDay(c.day)}</h2>
    <p>Sayım {clock(c.to)} · {c.byName}{c.closedBy ? ` · Tamamlayan: ${c.closedBy}` : ''}</p>
    <table><tbody>
      <tr><th>Açılış (devreden)</th><td>{money(f.opening)}</td></tr>
      <tr><th>Nakit satış</th><td>{money(f.cashSales)}</td></tr>
      <tr><th>Nakit iade{f.cashierRefunds ? <small> (kasiyer: {money(f.cashierRefunds)})</small> : null}</th><td>{signedMoney(-f.cashRefunds)}</td></tr>
      <tr><th>Nakit gider</th><td>{signedMoney(-f.cashExpenses)}</td></tr>
      <tr><th>Kasaya konan / alınan (sahip)</th><td>{signedMoney(f.ownerIn - f.ownerOut)}</td></tr>{!!f.tipsPaidOut && <tr><th>Kart bahşişi garsona (nakit)</th><td>{signedMoney(-f.tipsPaidOut)}</td></tr>}
      <tr><th>Nakit bahşiş</th><td>{signedMoney(f.cashTips)}</td></tr>
      {!!(f.deposits || f.depositRefunds) && <tr><th>Kapora (nakit) / iadesi</th><td>{signedMoney((f.deposits ?? 0) - (f.depositRefunds ?? 0))}</td></tr>}
      <tr className="total"><th>Beklenen nakit</th><td>{money(f.expected)}</td></tr>
      <tr className="total"><th>Sayılan nakit</th><td>{money(c.counted)}</td></tr>
      <tr className="total"><th>Fark</th><td>{signedMoney(c.difference)}</td></tr>
      {corrections.length > 0 && <tr><th>Düzeltmelerle fark</th><td>{signedMoney(correctedDifference(c, corrections))}</td></tr>}
      <tr><th>Kart (Mola) / Banka POS{cardBreakdown(f) && <small> ({cardBreakdown(f)})</small>}</th><td>{money(f.card)} / {c.pos === null ? '—' : money(c.pos)}</td></tr>
      {f.platform > 0 && <tr><th>Platform ödemesi</th><td>{money(f.platform)}</td></tr>}
      {c.mode === 'final' && <tr><th>Kasada bırakılan</th><td>{money(c.left ?? c.counted)}</td></tr>}
      {c.fiscal && <tr className="total"><th>Yazar kasaya girilmesi gereken<small> ({c.fiscal.rows.length ? `${ratesLine(c.fiscal.rows)} · ` : ''}nakit {kasaMoney(c.fiscal.cash)} / kart {kasaMoney(c.fiscal.card)})</small></th><td>{kasaMoney(c.fiscal.total)}</td></tr>}
      {!!c.fiscal?.refunds && <tr><th>Yazar kasada iade / ters işlem</th><td>{kasaMoney(-c.fiscal.refunds)}</td></tr>}
      {c.fiscalZ && <tr><th>Z raporu (KDV dahil) / Z farkı</th><td>{kasaMoney(c.fiscalZ.total)} / {signedMoney(c.fiscalZ.difference)}</td></tr>}
    </tbody></table>
    {c.note && <p><strong>Not:</strong> {c.note}</p>}
    {c.movements.length > 0 && <><h3>Kasa hareketleri</h3><ul>{c.movements.map(m => <li key={m.id}>{clock(m.at)} · {movementNames[m.type]} · {money(m.amount)} · {m.byName}{m.note ? ` · ${m.note}` : ''}</li>)}</ul></>}
    {c.expenses.length > 0 && <><h3>Nakit giderler</h3><ul>{c.expenses.map(e => <li key={e.id}>{clock(e.at)} · {e.description} · {money(e.amount)} · {e.byName}</li>)}</ul></>}
    {!!c.refunds?.length && <><h3>İadeler</h3><ul>{c.refunds.map(r => <li key={r.id}>{clock(r.at)} · {r.text || 'İade'} · {money(r.amount)} {r.method === 'card' ? 'kart' : 'nakit'} · {r.byName}{r.cashier ? ' (kasiyer)' : ''}</li>)}</ul></>}
    {corrections.length > 0 && <><h3>Düzeltmeler</h3><ul>{corrections.map(x => <li key={x.id}>{clock(x.at)} · {signedMoney(x.amount)} · {x.note} · {x.byName}</li>)}</ul></>}
    <p className="cash-print-foot">Bilgi fişidir. Mali değeri yoktur.</p>
  </div>, document.body);
}
