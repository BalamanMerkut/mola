import { useEffect, useRef, useState } from 'react';
import type { Expense } from '../packages/domain/types';
import { DateField } from './DateField';
import { EXPENSE_BACKDATE_DAYS, expenseAt, expensePayNames, expensePays, payFields, payOf, type ExpensePay } from '../packages/domain/expense-rules';
import { api, ApiError, money, moneyError, moneyInput, parseMoney, requestId } from './api';
import { Modal, Notice } from './components';
import { reportToday } from './ReportPeriod';
import { businessDay } from '../packages/domain/business-day';

/** The business day (05:00–05:00) the expense counts on, as the reports and the server read it. */
const istanbulDay = (iso: string) => businessDay(iso);
const shift = (day: string, days: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

/**
 * "Para nereden çıktı?" (8 Ekim): only "Kasadan" lowers the gün sonu's expected cash; "Kasa dışından" (the owner's pocket,
 * the bank) is a gider all the same. Nothing is chosen beforehand: a silent "Kasadan" took the drawer below zero.
 */
export function DrawerChoice({ value, onChange, disabled, label = 'Para nereden çıktı? *' }: { value: ExpensePay | ''; onChange: (p: ExpensePay) => void; disabled?: boolean; label?: string }) {
  return <div className="expense-source" role="radiogroup" aria-label="Para nereden çıktı">
    <span className="expense-source-label">{label}</span>
    {(['drawer', 'outside'] as const).map(p => <button type="button" key={p} role="radio" aria-checked={value === p} className={`expense-source-option${value === p ? ' selected' : ''}`} disabled={disabled} onClick={() => onChange(p)}>
      <b>{p === 'drawer' ? 'Kasadan' : 'Kasa dışından'}</b><small>{p === 'drawer' ? 'Kasadaki nakitten ödendi; gün sonunda beklenen nakitten düşer.' : 'İşletme sahibinin cebinden ya da bankadan; kasadaki nakit değişmez.'}</small>
    </button>)}
  </div>;
}

/** The drawer's expected cash right now for the owner's "Kasadan nakit" (GET /api/staff/cash/expected); undefined while unknown. */
export function useDrawerExpected(active: boolean) {
  const [expected, setExpected] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (!active) return;
    let live = true;
    api<{ expected: number | null }>('/api/staff/cash/expected').then(r => { if (live) setExpected(r.expected); }).catch(() => { /* the server still answers CASH_BELOW_ZERO */ });
    return () => { live = false; };
  }, [active]);
  return expected;
}
const signedMoney = (kurus: number) => kurus < 0 ? `−${money(-kurus)}` : money(kurus);
/** The same words as the server's CASH_BELOW_ZERO answer (server/cash-closing.ts belowZeroText). */
export const belowZeroText = (expected: number, amount: number) => `Kasada şu an ${signedMoney(expected)} görünüyor; bu çıkışla ${signedMoney(expected - amount)} olur. Para kasadan çıkmadıysa “Kasa dışı nakit”i seçin.`;
/**
 * 8 Ekim (sahip): "Kasadan nakit" that takes the drawer below zero is a short amber note right under "Ödeme yöntemi", not a
 * second set of buttons; the form's own save button saves it as chosen (it sends `confirm`, the owner has read the note).
 */
export function BelowZeroNote({ text }: { text: string }) { return <small className="cash-below-note" role="status" data-testid="below-zero">{text}</small>; }

/**
 * owner: the bookkeeping version (rent, wages, bills) from Kasa ve giderler → Giderler and the owner's "Gider kaydet", with a date (today or up to a year
 * back) and how it was paid; otherwise a cashier's (or the Müdür's) payout at the counter (cash, now), from the drawer or not.
 * `expense`: the owner corrects or deletes that record; the earlier values stay in its history.
 */
export function ExpenseForm({ onClose, onSaved, owner = false, expense }: { onClose: () => void; onSaved: (message: string) => void; owner?: boolean; expense?: Expense }) {
  const today = reportToday();
  const [amount, setAmount] = useState(expense ? moneyInput(expense.amount) : ''), [description, setDescription] = useState(expense?.description ?? '');
  const [day, setDay] = useState(expense ? istanbulDay(expenseAt(expense)) : today), [pay, setPay] = useState<ExpensePay | ''>(expense ? payOf(expense) : '');
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef<{ path: string; body: object; message: string } | null>(null); const value = parseMoney(amount);
  // The owner's "Kasadan" expense that would leave the drawer below zero: where did the money come from? (server/cash-closing.ts)
  const [belowZero, setBelowZero] = useState(''), amountProblem = amount.trim() ? moneyError(amount) : '';
  const earliest = shift(today, -EXPENSE_BACKDATE_DAYS), validDay = !owner || (/^\d{4}-\d{2}-\d{2}$/.test(day) && day >= earliest && day <= today);
  // Only today's new "Kasadan nakit" expense of the owner is checked against the drawer (as the server does).
  const drawerToday = owner && !expense && pay === 'drawer' && day === today, expected = useDrawerExpected(drawerToday);
  const warn = drawerToday && typeof expected === 'number' && Number.isFinite(value) && value > 0 && expected - value < 0 ? belowZeroText(expected, value) : belowZero;
  async function send(next: { path: string; body: object; message: string }) {
    if (busy) return; setBusy(true); setError('');
    // The same request goes again after an unclear failure, so a retry never records twice.
    pending.current ??= next;
    try { await api(pending.current.path, pending.current.body); onSaved(pending.current.message); }
    catch (e) {
      const u = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(u); if (!u) pending.current = null;
      if (!u && e instanceof ApiError && e.code === 'CASH_BELOW_ZERO') setBelowZero(e.message); else setError(u ? 'Sonuç alınamadı. Aynı kaydı tekrar kontrol edin.' : (e as Error).message);
    }
    finally { setBusy(false); }
  }
  const fields = (p: ExpensePay | '') => ({ amount: value, description, ...(p ? (owner ? payFields(p) : { source: payFields(p).source }) : {}), ...(owner ? { day } : {}) });
  const save = (confirm = false, p: ExpensePay | '' = pay) => { setBelowZero(''); return send(expense
    ? { path: '/api/staff/expenses/edit', body: { requestId: requestId(), id: expense.id, version: expense.changes?.length ?? 0, ...fields(p) }, message: 'Gider düzeltildi.' }
    : { path: '/api/staff/expenses', body: { requestId: requestId(), ...fields(p), ...(confirm ? { confirm } : {}) }, message: p === 'outside' ? 'Gider kaydedildi (kasa dışından).' : 'Gider kaydedildi.' }); };
  const remove = () => send({ path: '/api/staff/expenses/delete', body: { requestId: requestId(), id: expense!.id, version: expense!.changes?.length ?? 0 }, message: 'Gider silindi. Kaydı “Silinen giderler” altında durur.' });
  const locked = busy || uncertain;
  return <Modal title={expense ? 'Gideri düzelt' : owner ? 'Gider ekle' : 'Gider kaydet'} className="modal-steady" onClose={() => { if (!locked) onClose(); }}><form className="modal-body expense-form" onSubmit={e => { e.preventDefault(); void save(!!warn); }}>
    {expense?.auto && <Notice>Bu gider Kasa ve giderler → Giderler → Otomatik giderler'deki bir kuralla kaydedildi. Burada düzeltmek ya da silmek yalnız bu kaydı değiştirir; kural ve sonraki kayıtlar aynı kalır.</Notice>}
    {!expense && <p className="muted">{owner ? 'Kira, elektrik, su, maaş, tedarikçi ödemesi gibi giderleri yazın. "Elde kalan" tutarından düşülür; satışlar değişmez.' : 'Yapılan ödemeyi yazın. Raporda gider olarak görünür; satış ve müşteri hesapları değişmez.'}</p>}
    <label>Gider tutarı (TL) *<input aria-label="Gider tutarı" inputMode="decimal" required value={amount} disabled={locked} aria-invalid={!!amountProblem} onChange={e => { setAmount(e.target.value); setBelowZero(''); }} />{amountProblem && <small className="field-error" role="alert">{amountProblem}</small>}</label>
    <label>Açıklama *<textarea aria-label="Gider açıklaması" required maxLength={500} value={description} disabled={locked} onChange={e => setDescription(e.target.value)} placeholder={owner ? 'Örn. Ekim kirası' : 'Örn. acil süt alımı'} /></label>
    {owner ? <div className="form-columns expense-when">
      <label>Tarih *<DateField aria-label="Gider tarihi" required value={day} min={earliest} max={today} disabled={locked} aria-invalid={!validDay} onChange={v => setDay(v)} />{!validDay && <small className="field-error" role="alert">Bugün ya da en fazla 1 yıl önceki bir gün seçin.</small>}</label>
      <label>Ödeme yöntemi *<select aria-label="Ödeme yöntemi" value={pay} disabled={locked} aria-invalid={!pay} onChange={e => { setPay(e.target.value as ExpensePay); setBelowZero(''); }}>{!pay && <option value="" disabled>Seçin</option>}{expensePays.map(m => <option key={m} value={m}>{expensePayNames[m]}</option>)}</select>
        {warn ? <BelowZeroNote text={warn} /> : pay === 'drawer' ? <small className="muted">Gün sonunda kasadaki beklenen nakitten düşer.</small> : pay === 'outside' ? <small className="muted">Gider sayılır; kasadaki nakit değişmez.</small> : null}</label>
    </div> : <DrawerChoice value={pay} disabled={locked} onChange={p => { setPay(p); setBelowZero(''); }} />}
    {value > 0 && <p>{pay === 'drawer' ? 'Kasadan çıkış' : 'Gider'}: −{money(value)}</p>}
    {error && <Notice tone="error">{error}</Notice>}
    <button className="btn primary full" disabled={busy || (!uncertain && (!Number.isFinite(value) || value <= 0 || value > 100_000_000 || !description.trim() || !validDay || !pay))}>{uncertain ? 'Kaydı yeniden kontrol et' : expense ? 'Düzeltmeyi kaydet' : 'Gideri kaydet'}</button>
    {!uncertain && !busy && Number.isFinite(value) && value > 0 && (!description.trim() ? <p className="muted small" role="status">Kaydetmek için kısa bir açıklama yazın.</p> : !pay ? <p className="muted small" role="status">{owner ? 'Nasıl ödendiğini seçin: “Kasadan nakit” gün sonunda beklenen nakitten düşer.' : 'Paranın kasadan mı, kasa dışından mı çıktığını seçin.'}</p> : null)}
    {expense && !uncertain && (confirmDelete
      ? <div className="expense-delete-confirm" role="group" aria-label="Silme onayı"><p><strong>{money(expense.amount)} · {expense.description}</strong> silinsin mi? Toplamlardan çıkar; kaydı geçmişte kalır.</p><div className="actions"><button type="button" className="btn delete-catalog" disabled={busy} onClick={() => void remove()}>Evet, gideri sil</button><button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Vazgeç</button></div></div>
      : <button type="button" className="text-btn expense-delete" disabled={busy} onClick={() => setConfirmDelete(true)}>Gideri sil</button>)}
  </form></Modal>;
}
