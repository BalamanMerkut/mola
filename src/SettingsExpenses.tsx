import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CalendarClock, Info, Pencil, Percent, Plus, Repeat, Trash2 } from 'lucide-react';
import { DateField } from './DateField';
import type { ExpenseMethod } from '../packages/domain/types';
import { expenseMethodNames, expenseMethods } from '../packages/domain/expense-rules';
import { addDays, isDay, monthLength, MONTH_NAMES, occurrences, repeatText, WEEKDAY_NAMES, type RecurringExpense, type RecurringRepeat } from '../packages/domain/recurring-rules';
import { api, ApiError, money, moneyError, moneyInput, parseMoney, requestId } from './api';
import { businessDay } from '../packages/domain/business-day';
import { MARGIN_GROUPS, marginGroupNames, type MarginGroup } from '../packages/domain/margins';
import { Modal, Notice } from './components';
import { Card, Count, EmptyState, Field, Segmented, Toggle } from './SettingsKit';

/**
 * Kasa ve giderler → Giderler → "Otomatik giderler" (rent, wages, subscriptions; owner). The café server records each one on
 * its day by itself, also catching up days the computer was off; they show beside it in Giderler → Kayıtlar marked
 * "Otomatik". Also here: the "Düşük kâr uyarısı" card that Satış ve Raporlar → Kârlılık → "Uyarı sınırları" opens.
 */
export type RecurringView = { today: string; rules: RecurringExpense[]; next: Record<string, string | null> };
export function useRecurring() {
  const [view, setView] = useState<RecurringView | null>(null), [error, setError] = useState('');
  const load = useCallback(() => api<RecurringView>('/api/staff/recurring-expenses').then(v => { setView(v); setError(''); }).catch(e => setError((e as Error).message)), []);
  useEffect(() => { void load(); }, [load]);
  return { view, error, load, setView };
}
export const dayText = (day: string, year = true) => new Date(`${day}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
/** "Sonraki: 1 Kasım 2026" / "Durduruldu" / "Bitti" for a rule. */
export function ruleState(rule: RecurringExpense, next: string | null | undefined, today: string) {
  if (!rule.active) return { tone: 'paused', text: 'Durduruldu' };
  if (!next) return { tone: 'ended', text: 'Bitti' };
  return { tone: 'on', text: next === today ? 'Bugün kaydedilecek' : `Sonraki: ${dayText(next, next.slice(0, 4) !== today.slice(0, 4))}` };
}

type MarginView = { enabled: boolean; groups: Record<MarginGroup, number>; defaults: Record<MarginGroup, number>; categories: { name: string; auto: MarginGroup; group: MarginGroup | null }[] };
const COST_HELP = 'Sektörde yaygın kabul gören maliyet oranlarına göre: içeceklerde maliyetin satış fiyatının %30\'unu, yemek ve tatlıda %35\'ini, hazır ürünlerde %70\'ini geçmemesi önerilir. Bu değerleri değiştirebilirsiniz.';
/**
 * Satış ve Raporlar → Kârlılık "Düşük kâr" uyarısı: on/off (default on), the margin line of each product group and, for a
 * menu category the names do not place well, its group. Saved with one button; "Varsayılana dön" fills the trade defaults.
 */
export function MarginCard() {
  const id = useId();
  const [view, setView] = useState<MarginView | null>(null), [enabled, setEnabled] = useState(true);
  const [groups, setGroups] = useState<Record<MarginGroup, string>>({ drinks: '', food: '', dessert: '', ready: '' }), [categories, setCategories] = useState<Record<string, MarginGroup | ''>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  const fill = (v: MarginView) => { setView(v); setEnabled(v.enabled); setGroups(Object.fromEntries(MARGIN_GROUPS.map(g => [g, String(v.groups[g])])) as Record<MarginGroup, string>); setCategories(Object.fromEntries(v.categories.map(c => [c.name, c.group ?? '']))); };
  useEffect(() => { void api<MarginView>('/api/staff/profit/settings').then(fill).catch(e => setError((e as Error).message)); }, []);
  const values = Object.fromEntries(MARGIN_GROUPS.map(g => [g, Number(groups[g])])) as Record<MarginGroup, number>;
  const bad = MARGIN_GROUPS.filter(g => !(Number.isInteger(values[g]) && values[g] >= 1 && values[g] <= 95));
  async function save(next = { enabled, groups: values, categories }) {
    if (MARGIN_GROUPS.some(g => !(Number.isInteger(next.groups[g]) && next.groups[g] >= 1 && next.groups[g] <= 95))) return;
    setBusy(true); setError(''); setDone(false);
    try { fill(await api<MarginView>('/api/staff/profit/settings', { enabled: next.enabled, groups: next.groups, categories: Object.fromEntries(Object.entries(next.categories).map(([k, v]) => [k, v || null])) })); setDone(true); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const defaults = () => { if (!view) return; const next = { enabled: true, groups: { ...view.defaults }, categories: Object.fromEntries(view.categories.map(c => [c.name, '' as const])) }; setEnabled(true); setGroups(Object.fromEntries(MARGIN_GROUPS.map(g => [g, String(view.defaults[g])])) as Record<MarginGroup, string>); setCategories(next.categories); void save(next); };
  return <Card icon={<Percent size={18} aria-hidden="true" />} title="Düşük kâr uyarısı" className="margin-card" tip={COST_HELP}
    lead="Kârlılık raporunda kâr oranı, ürünün grubundaki sınırın altında kalan ürünler 'Düşük kâr' diye işaretlenir. Örnek: 100 TL'ye satılan, maliyeti 70 TL olan ürünün kâr oranı %30'dur.">
    {!view && !error ? <p className="settings-card-note" aria-busy="true">Okunuyor…</p> : view && <form className="margin-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label className="margin-switch" htmlFor={`${id}-on`}><span><b>Düşük kâr uyarısı</b><small>{enabled ? 'Açık: sınırın altındaki ürünler işaretlenir.' : 'Kapalı: hiçbir ürün işaretlenmez.'}</small></span><Toggle id={`${id}-on`} checked={enabled} disabled={busy} onChange={setEnabled} /></label>
      <p className="settings-card-note">{COST_HELP}</p>
      {enabled && <>
        <div className="margin-groups">{MARGIN_GROUPS.map(g => <label key={g} className="margin-group"><span>{marginGroupNames[g]}<small>Maliyet en çok %{100 - (values[g] || 0)}</small></span>
          <span className="settings-number-control"><span aria-hidden="true">%</span><input type="number" inputMode="numeric" min="1" max="95" aria-label={`${marginGroupNames[g]}: en az kâr oranı (%)`} value={groups[g]} disabled={busy} aria-invalid={bad.includes(g) || undefined} onChange={e => { setGroups(x => ({ ...x, [g]: e.target.value })); setDone(false); }} /></span></label>)}</div>
        {bad.length > 0 && <p className="option-hint" role="status">Kâr oranını 1 ile 95 arasında yazın.</p>}
        {view.categories.length > 0 && <details className="margin-categories"><summary>Kategorilerin grubu</summary>
          <p className="settings-card-note">Grup kategorinin adından anlaşılır; uymayanı buradan değiştirin. Stokta "Hazır ürün" olarak takip edilen ürünler her zaman Hazır ürünler grubundadır.</p>
          <ul>{view.categories.map(c => <li key={c.name}><span>{c.name}</span><select aria-label={`${c.name} kategorisinin grubu`} value={categories[c.name] ?? ''} disabled={busy} onChange={e => { setCategories(x => ({ ...x, [c.name]: e.target.value as MarginGroup | '' })); setDone(false); }}>
            <option value="">Otomatik: {marginGroupNames[c.auto]}</option>{MARGIN_GROUPS.map(g => <option key={g} value={g}>{marginGroupNames[g]}</option>)}</select></li>)}</ul>
        </details>}
      </>}
      <div className="margin-actions"><button className="btn primary" disabled={busy || bad.length > 0}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button><button type="button" className="btn secondary" disabled={busy} onClick={defaults}>Varsayılana dön</button></div>
    </form>}
    {done && <Notice tone="success">Kaydedildi. Kârlılık raporu ve reçeteler bu sınırlarla işaretlenir.</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
  </Card>;
}

export function RecurringExpensesPage() {
  const { view, error, load, setView } = useRecurring();
  const [editing, setEditing] = useState<RecurringExpense | 'new' | null>(null), [notice, setNotice] = useState('');
  const rules = view?.rules ?? [], monthly = rules.filter(r => r.active && r.repeat.every === 'month').reduce((n, r) => n + r.amount, 0);
  return <>
    <Card icon={<Repeat size={18} aria-hidden="true" />} title="Otomatik giderler" className="recurring-card"
      tip="Kira, maaş, internet gibi düzenli ödemeleri bir kez yazın; Mola her biri günü gelince gideri kendisi kaydeder. Bilgisayar o gün kapalıysa açılınca geçen günleri de yazar, aynı günü iki kez yazmaz. Kaydedilen gider Giderler → Kayıtlar'da “Otomatik” olarak görünür; orada düzeltip silebilirsiniz. Nakit giderler elde kalan nakitten düşer."
      aside={rules.length > 0 ? <Count>{rules.length}</Count> : undefined}
      lead="Kira, maaş, abonelik gibi düzenli ödemeler günü gelince kendiliğinden kaydedilir.">
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!view && !error ? <p className="settings-card-note" aria-busy="true">Otomatik giderler okunuyor…</p>
        : !rules.length ? <EmptyState icon={<CalendarClock size={24} aria-hidden="true" />} title="Henüz otomatik gider yok" text="Örneğin her ayın 1'inde ödenen kirayı bir kez ekleyin; Mola her ay kendisi kaydetsin." action={<button type="button" className="btn primary" onClick={() => { setNotice(''); setEditing('new'); }}><Plus size={16} aria-hidden="true" />Otomatik gider ekle</button>} />
        : <>
          <ul className="recurring-list">{rules.map(r => { const state = ruleState(r, view!.next[r.id], view!.today); return <li key={r.id} className={`recurring-row ${r.active ? '' : 'paused'}`}>
            <span className="recurring-icon" aria-hidden="true"><CalendarClock size={18} /></span>
            <div className="recurring-copy"><strong>{r.name}</strong><span>{repeatText(r.repeat)} · {expenseMethodNames[r.method]}{r.end ? ` · ${dayText(r.end)} tarihine kadar` : ''}</span></div>
            <div className="recurring-side"><strong className="recurring-amount">{money(r.amount)}</strong><span className={`recurring-state ${state.tone}`}>{state.text}</span></div>
            <button type="button" className="btn secondary recurring-edit" aria-label={`${r.name} otomatik giderini düzenle`} onClick={() => { setNotice(''); setEditing(r); }}><Pencil size={15} aria-hidden="true" /><span aria-hidden="true">Düzenle</span></button>
          </li>; })}</ul>
          <div className="recurring-foot">{monthly > 0 && <span className="settings-chip">Aylık sabit giderler: {money(monthly)}</span>}<button type="button" className="btn primary" onClick={() => { setNotice(''); setEditing('new'); }}><Plus size={16} aria-hidden="true" />Otomatik gider ekle</button></div>
        </>}
    </Card>
    {/* Short facts as chips; the full rules in the ⓘ. */}
    <Card icon={<Info size={18} aria-hidden="true" />} title="Nasıl çalışır?" className="settings-card-quiet settings-card-compact" tip="Gider, günü gelince (Türkiye saatiyle sabah 05:00'ten sonra; gün, kasa günü gibi 05:00'te başlar) kasa bilgisayarında kendiliğinden kaydedilir; Bildirimler'e (üst çubuktaki zil) de yazılır. Bilgisayar o gün kapalıysa açıldığında geçen günlerin giderleri de yazılır; aynı gün hiçbir zaman iki kez kaydedilmez. Ayın 29'u, 30'u ya da 31'i seçilirse kısa aylarda ayın son günü kaydedilir. Nakit giderler “Elde kalan nakit” tutarından düşer; kart, havale ve diğer yöntemler düşmez. Kaydedilen bir gideri Giderler → Kayıtlar'dan (“Otomatik” etiketiyle) düzeltebilir ya da silebilirsiniz; kural değişmez.">
      <ul className="settings-facts settings-facts-row">
        <li>Günü gelince 05:00'ten sonra kaydedilir; Bildirimler'e de yazılır.</li>
        <li>Bilgisayar kapalıysa açılınca geçen günler yazılır, hiçbiri iki kez değil.</li>
        <li>Nakit giderler elde kalan nakitten düşer.</li>
      </ul>
    </Card>
    {editing && <RecurringEditor rule={editing === 'new' ? undefined : editing} today={view?.today} onClose={() => setEditing(null)} onSaved={(next, message) => { setEditing(null); setView(next); setNotice(message); void load(); }} />}
  </>;
}

type Every = RecurringRepeat['every'];
const everyNames: Record<Every, string> = { month: 'Her ay', year: 'Her yıl', days: 'N günde bir', week: 'Her hafta' };
/** Today's business day (05:00–05:00), the day the server records rules on. */
const localToday = () => businessDay(Date.now());

/** Add or change one rule; the next three days it will record are shown before saving. Also opened from the expense reports. */
export function RecurringEditor({ rule, today = localToday(), onClose, onSaved }: { rule?: RecurringExpense; today?: string; onClose: () => void; onSaved: (view: RecurringView, message: string) => void }) {
  const id = useId();
  const [name, setName] = useState(rule?.name ?? ''), [amount, setAmount] = useState(rule ? moneyInput(rule.amount) : '');
  const [method, setMethod] = useState<ExpenseMethod>(rule?.method ?? 'transfer'), [every, setEvery] = useState<Every>(rule?.repeat.every ?? 'month');
  const startDay = rule?.start ?? today, [, m0, d0] = startDay.split('-').map(Number);
  const [monthDay, setMonthDay] = useState(rule?.repeat.every === 'month' ? rule.repeat.day : d0);
  const [yearMonth, setYearMonth] = useState(rule?.repeat.every === 'year' ? rule.repeat.month : m0), [yearDay, setYearDay] = useState(rule?.repeat.every === 'year' ? rule.repeat.day : d0);
  const [days, setDays] = useState(String(rule?.repeat.every === 'days' ? rule.repeat.days : 14)), [weekday, setWeekday] = useState(rule?.repeat.every === 'week' ? rule.repeat.weekday : ((new Date(`${startDay}T12:00:00Z`).getUTCDay() + 6) % 7) + 1);
  const [start, setStart] = useState(startDay), [hasEnd, setHasEnd] = useState(!!rule?.end), [end, setEnd] = useState(rule?.end ?? '');
  const [active, setActive] = useState(rule?.active ?? true);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [confirmDelete, setConfirmDelete] = useState(false), [tried, setTried] = useState(false);
  const pending = useRef<{ path: string; body: object; message: string } | null>(null);
  const value = parseMoney(amount), n = Number(days);
  const repeat: RecurringRepeat = every === 'month' ? { every, day: monthDay } : every === 'year' ? { every, month: yearMonth, day: Math.min(yearDay, monthLength(2028, yearMonth)) } : every === 'days' ? { every, days: n } : { every, weekday };
  const problems = {
    name: !name.trim() ? 'Gidere bir ad verin (ör. Kira).' : '',
    amount: moneyError(amount),
    days: every === 'days' && (!Number.isInteger(n) || n < 1 || n > 365) ? '1 ile 365 arasında bir gün sayısı yazın.' : '',
    start: !isDay(start) ? 'Başlangıç tarihini seçin.' : '',
    end: hasEnd && (!isDay(end) || end < start) ? 'Bitiş tarihi başlangıçtan önce olamaz.' : '',
  };
  const valid = !Object.values(problems).some(Boolean);
  // What it will record next: from today (never days before it was made) and the start day on.
  const from = [today, start, rule ? addDays(rule.doneThrough, 1) : today].sort().at(-1)!;
  const upcoming = valid && active ? occurrences({ repeat, start, end: hasEnd ? end : undefined }, from, addDays(from, 800)).slice(0, 3) : [];
  async function send(next: { path: string; body: object; message: string }) {
    if (busy) return; setBusy(true); setError('');
    pending.current ??= next;
    try {
      const r = await api<RecurringView & { rule?: RecurringExpense }>(pending.current.path, pending.current.body);
      // A rule due today records today's expense at once; say so.
      const today = r.rule?.last?.day === r.today && rule?.last?.day !== r.today ? ' Bugünün gideri de kaydedildi; Giderler → Kayıtlar\'da görünür.' : '';
      onSaved(r, pending.current.message + today);
    }
    catch (e) { const u = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(u); if (!u) pending.current = null; setError(u ? 'Sonuç alınamadı. Aynı kaydı tekrar kontrol edin.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  function save() {
    setTried(true); if (!valid && !uncertain) return;
    void send({ path: '/api/staff/recurring-expenses', body: { requestId: requestId(), ...(rule ? { id: rule.id, version: rule.version } : {}), name: name.trim(), amount: value, method, repeat, start, end: hasEnd ? end : null, active }, message: rule ? `${name.trim()} güncellendi.` : `${name.trim()} eklendi. Günü gelince kendiliğinden kaydedilecek.` });
  }
  const locked = busy || uncertain, show = (key: keyof typeof problems) => tried && problems[key] ? problems[key] : undefined;
  return <Modal title={rule ? 'Otomatik gideri düzenle' : 'Otomatik gider ekle'} className="modal-steady recurring-modal" onClose={() => { if (!locked) onClose(); }} dismissible={!locked}>
    <form className="modal-body recurring-form" noValidate onSubmit={e => { e.preventDefault(); save(); }}>
      <div className="recurring-form-grid">
        <Field label="Gider adı *" error={show('name')}><input value={name} maxLength={80} placeholder="Örn. Kira, Elektrik, İnternet" disabled={locked} aria-invalid={!!show('name')} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Tutar (TL) *" error={show('amount') ?? (amount.trim() ? problems.amount || undefined : undefined)}><input inputMode="decimal" value={amount} placeholder="15.000" disabled={locked} aria-invalid={!!(show('amount') ?? (amount.trim() && problems.amount))} onChange={e => setAmount(e.target.value)} /></Field>
      </div>
      <div className="settings-field"><span className="settings-field-label" id={`${id}-method`}>Ödeme yöntemi *</span>
        <div className="settings-segmented wide" role="group" aria-labelledby={`${id}-method`}>{expenseMethods.map(m => <button type="button" key={m} aria-pressed={method === m} className={method === m ? 'selected' : ''} disabled={locked} onClick={() => setMethod(m)}>{expenseMethodNames[m]}</button>)}</div>
        <span className="settings-field-hint">{method === 'cash' ? 'Nakit giderler elde kalan nakitten düşer.' : 'Kasadaki nakdi değiştirmez; raporlarda gider olarak düşülür.'}</span></div>
      <div className="settings-field"><span className="settings-field-label" id={`${id}-every`}>Ne sıklıkla? *</span>
        <Segmented label="Tekrar sıklığı" wide value={every} disabled={locked} onChange={setEvery} options={(Object.keys(everyNames) as Every[]).map(v => ({ value: v, label: everyNames[v] }))} /></div>
      <div className="recurring-repeat">
        {every === 'month' && <Field label="Ayın kaçında?" hint={monthDay >= 29 ? `${monthDay} çekmeyen aylarda ayın son günü kaydedilir (Şubat'ta 28 ya da 29).` : undefined}><select value={monthDay} disabled={locked} onChange={e => setMonthDay(Number(e.target.value))}>{Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></Field>}
        {every === 'year' && <div className="recurring-form-grid"><Field label="Ay"><select value={yearMonth} disabled={locked} onChange={e => setYearMonth(Number(e.target.value))}>{MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
          <Field label="Gün" hint={yearMonth === 2 && yearDay === 29 ? '29 Şubat olmayan yıllarda 28 Şubat kaydedilir.' : undefined}><select value={Math.min(yearDay, monthLength(2028, yearMonth))} disabled={locked} onChange={e => setYearDay(Number(e.target.value))}>{Array.from({ length: monthLength(2028, yearMonth) }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></Field></div>}
        {every === 'days' && <Field label="Kaç günde bir?" hint="Başlangıç günü ilk kayıttır, sonra bu kadar günde bir." error={show('days')}><div className="settings-number-control"><input inputMode="numeric" value={days} disabled={locked} aria-invalid={!!show('days')} onChange={e => setDays(e.target.value.replace(/\D/g, '').slice(0, 3))} /><span aria-hidden="true">gün</span></div></Field>}
        {every === 'week' && <div className="settings-field"><span className="settings-field-label" id={`${id}-weekday`}>Hangi gün?</span><div className="settings-segmented weekdays" role="group" aria-labelledby={`${id}-weekday`}>{WEEKDAY_NAMES.map((w, i) => <button type="button" key={w} title={w} aria-label={w} aria-pressed={weekday === i + 1} className={weekday === i + 1 ? 'selected' : ''} disabled={locked} onClick={() => setWeekday(i + 1)}>{w.slice(0, 3)}</button>)}</div></div>}
      </div>
      <div className="recurring-form-grid">
        <Field label="Başlangıç tarihi *" error={show('start')}><DateField value={start} disabled={locked} onChange={v => setStart(v)} /></Field>
        <div className="settings-field"><label className="check-row recurring-end-check"><input type="checkbox" checked={hasEnd} disabled={locked} onChange={e => { setHasEnd(e.target.checked); if (e.target.checked && !end) setEnd(addDays(start, 364)); }} />Bitiş tarihi var</label>
          {hasEnd ? <label><span className="sr-only">Bitiş tarihi</span><DateField aria-label="Bitiş tarihi" value={end} min={start} disabled={locked} aria-invalid={!!show('end')} onChange={v => setEnd(v)} /></label> : <span className="settings-field-hint">Siz durdurana kadar sürer.</span>}
          {show('end') && <small className="field-error" role="alert">{show('end')}</small>}</div>
      </div>
      <div className="settings-row recurring-active"><div className="settings-row-copy"><div className="settings-row-title"><label htmlFor={`${id}-active`}>Aktif</label></div><p id={`${id}-active-help`}>Kapalıyken gider kaydedilmez; açınca kaçırılan günler yazılmaz.</p></div><div className="settings-row-control"><Toggle id={`${id}-active`} checked={active} disabled={locked} onChange={setActive} /></div></div>
      <div className="recurring-preview" role="status">
        <strong>{valid ? repeatText(repeat) : 'Bilgileri tamamlayın'}{valid && Number.isFinite(value) && value > 0 ? ` · ${money(value)}` : ''}</strong>
        {!active ? <span>Durduruldu: siz açana kadar gider kaydedilmez.</span> : upcoming.length ? <span>Sonraki kayıtlar: {upcoming.map(d => d === today ? 'bugün' : dayText(d)).join(', ')}</span> : valid ? <span>Bu tarihler arasında kaydedilecek gün kalmadı.</span> : null}
        {!rule && start < today && <span className="muted">Bugünden önceki günler için kayıt oluşturulmaz.</span>}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {tried && !valid && !uncertain && <p className="field-error" role="status">Kaydetmek için işaretli alanları düzeltin.</p>}
      <div className="modal-actions recurring-actions">
        {rule && !uncertain && (confirmDelete ? null : <button type="button" className="btn delete-catalog" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} aria-hidden="true" />Sil</button>)}
        <span className="grow" />
        <button type="button" className="btn secondary" disabled={locked} onClick={onClose}>Vazgeç</button>
        <button className="btn primary" disabled={busy}>{uncertain ? 'Kaydı yeniden kontrol et' : busy ? 'Kaydediliyor…' : 'Kaydet'}</button>
      </div>
      {rule && confirmDelete && <div className="expense-delete-confirm" role="group" aria-label="Silme onayı"><p><strong>{rule.name}</strong> otomatik gideri silinsin mi? Bundan sonra kaydedilmez; daha önce kaydedilen giderler raporlarda kalır.</p><div className="actions"><button type="button" className="btn delete-catalog" disabled={busy} onClick={() => void send({ path: '/api/staff/recurring-expenses/delete', body: { requestId: requestId(), id: rule.id, version: rule.version }, message: `${rule.name} silindi. Daha önce kaydedilen giderler raporlarda kalır.` })}>Evet, sil</button><button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Vazgeç</button></div></div>}
    </form>
  </Modal>;
}
