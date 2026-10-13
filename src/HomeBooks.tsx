import { useEffect, useState, type ReactNode } from 'react';
import { CalendarClock, Clock3, CreditCard, Gift, ListChecks, LockKeyhole, MapPinned, MoonStar, Repeat, ShieldCheck } from 'lucide-react';
import type { Expense, ExpenseChange, StaffSnapshot } from '../packages/domain/types';
import type { FinancialReport } from '../packages/domain/reports';
import { businessDay } from '../packages/domain/business-day';
import { expenseAt, expenseMethodNames, expenseMethodText } from '../packages/domain/expense-rules';
import { repeatText } from '../packages/domain/recurring-rules';
import { money } from './api';
import { Notice } from './components';
import { HelpTip } from './HelpTip';
import { PillTabs } from './PillTabs';
import { FinancialAccess } from './ReportSecurity';
import { PeriodBar, ReportState, todayRange, useReport, type Range } from './SalesReports';
import { ReportTools } from './ReportSimple';
import { formatReportDate } from './ReportPeriod';
import { CashClosingsReport, StaffShiftsReport } from './CashReports';
import { PaymentAdjustments } from './PaymentAdjustments';
import { ExpenseForm } from './ExpenseForm';
import { RecurringEditor, RecurringExpensesPage, useRecurring } from './SettingsExpenses';
import { CashSettingsPage, type CashSettingsView } from './CashSettings';
import { CommissionCard, usePreferences } from './SettingsPages';
import { AssignmentSettings } from './AssignmentSettings';
import { FeatureLockView, usePackage } from './FeatureLock';
import { useRememberedTab } from './remember';
import { PlaceLink } from './Moved';
import { goTo, type CashTab } from './navigate';
import { useViewerRole } from './viewerRole';
import './settings-workspace.css';

/*
 * The record books and settings of two homes (10 Ekim düzeni, docs/BILGI_MIMARISI_ONERISI.md), loaded when first opened:
 * - Kasa ve giderler: Giderler (Kayıtlar · Otomatik giderler), Kapanışlar, İadeler, Kasa ayarları (Gün sonu · Kart ve yazar
 *   kasa · Kasiyer yetkileri · Kasa güvenliği);
 * - Personel: Vardiya ve bahşiş (Vardiyalar · Bahşiş) and Personel ayarları (Vardiya · Bahşiş · Garson ataması).
 * Two levels at most: the home's icon tabs (src/Homes.tsx), then these quieter sub-tabs (PillTabs variant "sub", the same
 * row as Ayarlar' parts). Every sub-tab stays chosen on this device. The money books sit behind the same "telefon kodu"
 * screen as Satış ve Raporlar (FinancialAccess): the server asks for the code on these requests too.
 */
export type CashOpening = { key: number; tab?: CashTab; part?: string; q?: string; day?: string; /** An expense to show (K2: a stock purchase's Giderlerde gör). */ focus?: string };

/** The Ayarlar look (cards, rows, switches) for a settings tab inside a home. */
export function SettingsFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className="settings-shell home-settings"><div className={`settings-page${wide ? ' wide' : ''}`}><div className="settings-page-body">{children}</div></div></div>;
}
/** The quieter second row under a home's tabs. */
function SubTabs<T extends string>({ label, value, onChange, items }: { label: string; value: T; onChange: (v: T) => void; items: { id: T; label: string; icon?: typeof Clock3; locked?: boolean }[] }) {
  return <PillTabs label={label} className="home-parts" wrapClassName="home-parts-wrap" variant="sub" dataAttr="part" value={value} onChange={onChange} items={items} />;
}

const EXPENSE_PARTS = ['records', 'auto'] as const;
const CASH_SETTING_PARTS = ['closing', 'card', 'limits', 'guard'] as const;
export function CashBooks({ tab, open, data, onSaved }: { tab: Exclude<CashTab, 'today'>; open?: CashOpening; data: StaffSnapshot; onSaved: () => void }) {
  const owner = usePackage().owner, [range, setRange] = useState<Range>(todayRange);
  const [expensePart, setExpensePart] = useRememberedTab<typeof EXPENSE_PARTS[number]>('mola-cash-expenses-part', owner ? EXPENSE_PARTS : ['records'], 'records', open?.tab === 'expenses' ? open.part as never : undefined, open?.key);
  const [settingsPart, setSettingsPart] = useRememberedTab<typeof CASH_SETTING_PARTS[number]>('mola-cash-settings-part', CASH_SETTING_PARTS, 'closing', open?.tab === 'settings' ? open.part as never : undefined, open?.key);
  if (tab === 'settings') return <>
    <SubTabs label="Kasa ayarları bölümleri" value={settingsPart} onChange={setSettingsPart} items={[{ id: 'closing', label: 'Gün sonu', icon: MoonStar }, { id: 'card', label: 'Kart ve yazar kasa', icon: CreditCard }, { id: 'limits', label: 'Kasiyer yetkileri', icon: ShieldCheck }, { id: 'guard', label: 'Kasa güvenliği', icon: LockKeyhole }]} />
    <SettingsFrame><CashSettingsTab key={settingsPart} view={settingsPart} data={data} onSaved={onSaved} /></SettingsFrame>
  </>;
  const books = (view: string, name: string, body: ReactNode, period = true) => <FinancialAccess><div className="reports-workspace reports-v2 home-books">
    {period && <PeriodBar range={range} onChange={setRange} />}
    <div className="report-toolbar"><ReportTools view={view} viewName={name} range={range} /></div>
    {body}
  </div></FinancialAccess>;
  if (tab === 'expenses') return <>
    {owner && <SubTabs label="Giderler bölümleri" value={expensePart} onChange={setExpensePart} items={[{ id: 'records', label: 'Kayıtlar', icon: ListChecks }, { id: 'auto', label: 'Otomatik giderler', icon: Repeat }]} />}
    {expensePart === 'auto' && owner ? <SettingsFrame><RecurringExpensesPage /></SettingsFrame> : books('expenses', 'Giderler', <Expenses key={open?.key} range={range} focus={open?.tab === 'expenses' ? open.focus : undefined} onAuto={owner ? () => setExpensePart('auto') : undefined} />)}
  </>;
  if (tab === 'closings') return books('cash', 'Kasa kapanışları', <CashClosingsReport range={range} />);
  // İadeler: the ledger has its own day picker (a table's "Ödemeyi düzelt" opens it on that payment's day and table).
  return books('corrections', 'İadeler', <PaymentAdjustments initial={open?.tab === 'refunds' && open.day ? { q: open.q ?? '', day: open.day } : undefined} />, false);
}
function CashSettingsTab({ view, data, onSaved }: { view: CashSettingsView; data: StaffSnapshot; onSaved: () => void }) {
  const prefs = usePreferences(data, onSaved);
  return <CashSettingsPage view={view} commission={view === 'card' ? <CommissionCard prefs={prefs} /> : undefined} />;
}

/** The business day an expense counts on (an expense paid at 01:00 belongs to the evening before, like its report). */
const expenseDate = (iso: string) => formatReportDate(businessDay(iso));
const changeTime = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** One line of an expense's own history: what it was before an edit, or that it was deleted. */
function changeText(c: ExpenseChange) {
  return `${changeTime(c.at)} · ${c.by} · ${c.kind === 'deleted' ? 'sildi' : `düzeltti (önceki: ${money(c.before.amount)}, ${expenseDate(c.before.spentAt)}${c.before.method ? `, ${expenseMethodNames[c.before.method]}` : ''}, “${c.before.description}”)`}`;
}
const query = (r: Range) => `from=${r.from}&to=${r.to}`;
/** Giderler → Kayıtlar: the expense book (add, correct, deleted ones), the owner and the Müdür; correcting stays with the owner. */
function Expenses({ range, focus, onAuto }: { range: Range; focus?: string; onAuto?: () => void }) {
  const [editing, setEditing] = useState<Expense | 'new' | null>(null), [saved, setSaved] = useState(0), [notice, setNotice] = useState('');
  // The extra parameter only forces a fresh read after a change; the server ignores it.
  const { data, error, loading } = useReport<FinancialReport>(`/api/staff/reports/financial?${query(range)}&v=${saved}`);
  // "Otomatik giderler" (the sub-tab beside this one): a recorded one links back to its rule, which opens here to be changed.
  const recurring = useRecurring(), [rule, setRule] = useState<string | null>(null);
  // The Müdür adds expenses and reads them; correcting or deleting one stays with the owner (server: 403).
  const owner = useViewerRole() === 'owner';
  const rules = recurring.view?.rules ?? [], openRule = rules.find(r => r.id === rule);
  const list = data?.expenses ?? [], deleted = data?.deletedExpenses ?? [], auto = list.filter(e => e.auto).length;
  // K2 (10 Ekim): opened from a stock purchase's green line, the record is brought into view and marked.
  const focused = !!focus && list.some(e => e.id === focus);
  useEffect(() => { if (focused) document.querySelector(`[data-expense="${CSS.escape(focus!)}"]`)?.scrollIntoView({ block: 'center' }); }, [focused, focus]);
  // "Tümü" lists the newest page of expenses (server/management.ts LIST_PAGE); the totals count every one.
  const listed = (data as (FinancialReport & { listed?: { page: number; expenses: number } }) | null)?.listed;
  const autoBadge = (e: Expense) => { const r = rules.find(x => x.id === e.auto!.ruleId); return <span className="expense-auto"><span className="expense-auto-badge"><CalendarClock size={12} aria-hidden="true" />Otomatik</span>{r ? <button type="button" className="text-btn" title={`${repeatText(r.repeat)} · kuralı aç`} onClick={() => { setNotice(''); setRule(r.id); }}>{r.name} kuralı</button> : recurring.view && <span className="muted">kural silindi</span>}</span>; };
  return <ReportState data={data} error={error} loading={loading}>{data && <>
    <div className="kpi-row"><article className="kpi"><span>Giderler</span><strong>{money(data.expenseTotal ?? 0)}</strong><small>{listed ? listed.expenses.toLocaleString('tr-TR') : list.length} kayıt{auto && !listed ? ` · ${auto} otomatik` : ''}</small></article><article className="kpi"><span>POS komisyonu</span><strong>{money(data.commission)}</strong><small>Kart ödemelerinden</small></article><article className="kpi"><span>İadeler</span><strong>{money(data.refundTotal ?? 0)}</strong><small>İadeler sekmesinden</small></article></div>
    {owner && <div className="home-links">{onAuto && <button type="button" className="text-btn place-link" onClick={onAuto}>Otomatik giderleri yönet</button>}<PlaceLink to={{ view: 'cash', tab: 'settings', part: 'limits' }}>Kasiyerin gider sınırı</PlaceLink></div>}
    {notice && <Notice tone="success">{notice}</Notice>}
    {listed && <Notice>Tüm zamanlarda en yeni {listed.page} gider kaydı listeleniyor; toplamlar bütün kayıtları ({listed.expenses.toLocaleString('tr-TR')}) sayar. Daha eskileri için dönem olarak bir yıl seçin.</Notice>}
    <section className="panel product-table expense-table"><div className="report-section-heading"><h3>Gider kayıtları<HelpTip title="Giderler">Kira, elektrik, maaş gibi giderleri buradan ekleyebilirsiniz; kasiyerin kasadan yaptığı ödemeler de burada görünür. Düzenli giderleri yandaki “Otomatik giderler” sekmesinde bir kez yazarsanız günü gelince kendiliğinden kaydedilir ve burada “Otomatik” olarak görünür. Giderler gider tarihine yazılır ve "Elde kalan" tutarından düşülür; nakit giderler elde kalan nakitten de düşer. Düzeltilen ve silinen giderlerin önceki hâli kaydında saklanır.</HelpTip></h3><button type="button" className="btn primary small-btn" onClick={() => { setNotice(''); setEditing('new'); }}>Gider ekle</button></div>
      {!list.length ? <p className="report-empty-note">Bu dönemde gider kaydı yok.</p> : <table><thead><tr><th>Açıklama</th><th className="expense-col-date">Tarih</th><th className="expense-col-method">Yöntem</th><th className="expense-col-by">Kaydeden</th><th>Tutar</th><th><span className="sr-only">İşlem</span></th></tr></thead><tbody>{list.map(e => <tr key={e.id} data-expense={e.id} className={[e.auto ? 'expense-auto-row' : '', e.id === focus ? 'expense-focus' : ''].filter(Boolean).join(' ') || undefined}><th>{e.description}{e.auto && autoBadge(e)}{!!e.changes?.length && <small title={e.changes.map(changeText).join('\n')}>Düzeltildi · {changeTime(e.changes.at(-1)!.at)}</small>}<small className="expense-meta">{expenseDate(expenseAt(e))} · {expenseMethodText(e) || '—'} · {e.actorName}</small></th><td className="expense-col-date">{expenseDate(expenseAt(e))}</td><td className="expense-col-method">{expenseMethodText(e) || '—'}</td><td className="expense-col-by">{e.actorName}</td><td>{money(e.amount)}</td><td>{owner && <button type="button" className="text-btn" aria-label={`${e.description} giderini düzelt`} onClick={() => { setNotice(''); setEditing(e); }}>Düzelt</button>}</td></tr>)}</tbody></table>}
      {/* Deleted expenses count nowhere but stay readable, with who changed what and when. */}
      {deleted.length > 0 && <details className="expense-deleted"><summary>Silinen giderler ({deleted.length})</summary><ul>{deleted.map(e => <li key={e.id}><span><del>{money(e.amount)}</del> · {e.description}{e.auto ? ' (otomatik)' : ''} · {expenseDate(expenseAt(e))}</span>{(e.changes ?? []).map((c, i) => <small key={i}>{changeText(c)}</small>)}</li>)}</ul></details>}
    </section></>}{editing && <ExpenseForm owner expense={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={message => { setEditing(null); setNotice(message); setSaved(n => n + 1); }} />}
    {openRule && <RecurringEditor rule={openRule} today={recurring.view?.today} onClose={() => setRule(null)} onSaved={(next, message) => { setRule(null); recurring.setView(next); setNotice(`${message} Kural değişikliği yalnız bundan sonraki kayıtlara uygulanır.`); setSaved(n => n + 1); }} />}</ReportState>;
}

export type StaffOpening = { key: number; tab?: 'staff' | 'shifts' | 'settings'; part?: string };
const SHIFT_PARTS = ['shifts', 'tips'] as const;
const STAFF_SETTING_PARTS = ['shifts', 'tips', 'assignments'] as const;
/** Personel → Vardiya ve bahşiş (owner; the Müdür reads) and Personel ayarları (owner). */
export function StaffBooks({ tab, open }: { tab: 'shifts' | 'settings'; open?: StaffOpening }) {
  const pk = usePackage(), [range, setRange] = useState<Range>(todayRange);
  const [shiftPart, setShiftPart] = useRememberedTab<typeof SHIFT_PARTS[number]>('mola-staff-shifts-part', SHIFT_PARTS, 'shifts', open?.tab === 'shifts' ? open.part as never : undefined, open?.key);
  const [settingsPart, setSettingsPart] = useRememberedTab<typeof STAFF_SETTING_PARTS[number]>('mola-staff-settings-part', STAFF_SETTING_PARTS, 'shifts', open?.tab === 'settings' ? open.part as never : undefined, open?.key);
  if (tab === 'settings') return <>
    <SubTabs label="Personel ayarları bölümleri" value={settingsPart} onChange={setSettingsPart} items={[{ id: 'shifts', label: 'Vardiya', icon: Clock3 }, { id: 'tips', label: 'Bahşiş', icon: Gift }, { id: 'assignments', label: 'Garson ataması', icon: MapPinned }]} />
    <SettingsFrame>{settingsPart === 'assignments' ? <AssignmentSettings /> : <><CashSettingsPage key={settingsPart} view={settingsPart} />{settingsPart === 'shifts' && <div className="home-links"><PlaceLink to={{ view: 'cash', tab: 'today' }}>Vardiya kodu kasada: Kasa ve giderler → Bugün</PlaceLink></div>}</>}</SettingsFrame>
  </>;
  return <>
    <SubTabs label="Vardiya ve bahşiş bölümleri" value={shiftPart} onChange={setShiftPart} items={[{ id: 'shifts', label: 'Vardiyalar', icon: Clock3, locked: !pk.has('shifts') }, { id: 'tips', label: 'Bahşiş', icon: Gift, locked: !pk.has('shifts') }]} />
    {!pk.has('shifts') ? <FeatureLockView feature="shifts" compact onClose={() => goTo({ view: 'tables' })} /> : <FinancialAccess><div className="reports-workspace reports-v2 home-books">
      <PeriodBar range={range} onChange={setRange} />
      <div className="report-toolbar"><ReportTools view="staff" viewName="Personel ve bahşiş" range={range} /></div>
      <div className="home-links"><PlaceLink to={{ view: 'reports', tab: 'employees' }}>Çalışan satışları (Satış ve Raporlar)</PlaceLink></div>
      <StaffShiftsReport range={range} part={shiftPart} />
    </div></FinancialAccess>}
  </>;
}
