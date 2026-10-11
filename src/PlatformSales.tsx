import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, CheckCircle2, FileSpreadsheet, FileText, Pencil, Plus, Printer, Repeat, Wallet } from 'lucide-react';
import { DateField } from './DateField';
import { netFromGross, periodPrice, vatOf } from '../packages/domain/service-pricing';
import { api, ApiError, money, moneyError, moneyInput, parseMoney, requestId } from './api';
import { Modal, Notice } from './components';
import { ADMIN, dateTime } from './platformStatus';
import { withStepUp } from './platformStepUp';

type Method = 'cash' | 'transfer' | 'card';
type Status = 'paid' | 'unpaid' | 'cancelled';
type Change = { field: string; from: string; to: string };
export type SaleRow = { id: string; tenantId: string; business: string; packageName: string; months: 1 | 6 | 12 | null; day: string; net: number; vatRate: number; method: Method; invoiceNo?: string; note?: string; status: Status; paidDay?: string; source: 'extend' | 'manual'; createdAt: string; updatedAt?: string; history?: { at: string; changes: Change[] }[] };
type Sum = { net: number; vat: number; gross: number };
type Totals = Sum & { count: number; paid: number; unpaid: number; rates: (Sum & { rate: number })[]; months: (Sum & { month: string; name: string; count: number; paid: number; unpaid: number })[] };
type SalesData = { entries: SaleRow[]; totals: Totals; vatRate: number; years: string[]; today: string;
  kpis: { month: string; monthName: string; collected: number; collectedCount: number; mrr: { total: number; count: number }; pending: { count: number; gross: number } };
  businesses: { tenantId: string; name: string; packageName: string; monthly: number; yearly: number; planMonths?: number; kind?: string; removed?: boolean }[] };
const METHODS: [Method, string][] = [['cash', 'Nakit'], ['transfer', 'Havale / EFT'], ['card', 'Kart']];
const STATUS: Record<Status, [string, string]> = { paid: ['Ödendi', 'ok'], unpaid: ['Ödenmedi', 'warn'], cancelled: ['İptal', 'idle'] };
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const gross = (e: Pick<SaleRow, 'net' | 'vatRate'>) => e.net + vatOf(e.net, e.vatRate);
const day = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const period = (m: number | null) => m === 12 ? '1 yıl' : m ? `${m} ay` : 'Diğer';
type Filter = { year: string; month: string; tenant: string };
const queryOf = (f: Filter) => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();

/**
 * Satışlarım (only the vendor): the vendor's own sales and payments. Three cards (Bu ay tahsilat, Aylık düzenli gelir, Bekleyen
 * ödemeler), filters (year, month, business), the list (date, business, package, period, amount, method, invoice, status), the
 * month totals and the KDV breakdown, Excel and PDF for the accountant. Entries come from "Ödeme alındı" when a licence is
 * extended, or are added here; an edit keeps the old values. The cafés' own sales are never here (Merkez has none).
 */
export function PlatformSales({ disabled }: { disabled: boolean }) {
  const [data, setData] = useState<SalesData | null>(null), [filter, setFilter] = useState<Filter>(() => ({ year: String(new Date().getFullYear()), month: '', tenant: '' }));
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(''), [editing, setEditing] = useState<SaleRow | 'new' | null>(null);
  const load = (f = filter) => api<SalesData>(`${ADMIN}/sales?${queryOf(f)}`).then(setData, e => setError((e as Error).message));
  useEffect(() => { void load(filter); }, [filter]);
  async function take(kind: 'report.pdf' | 'report.xlsx') {
    setBusy(kind); setError(''); setNotice('');
    try {
      const r = await fetch(`${ADMIN}/sales/${kind}?${queryOf(filter)}`, { credentials: 'same-origin' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new ApiError(j.message ?? 'Rapor alınamadı.', r.status, j.code); }
      const blob = await r.blob(), name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `mola-satislarim.${kind.split('.')[1]}`;
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      setNotice(`${name} indirildi.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function markPaid(e: SaleRow) {
    setBusy(e.id); setError(''); setNotice('');
    const body = { requestId: requestId(), id: e.id, tenantId: e.tenantId, day: e.day, months: e.months, packageName: e.packageName, net: e.net, vatRate: e.vatRate, method: e.method, status: 'paid', ...(e.invoiceNo ? { invoiceNo: e.invoiceNo } : {}), ...(e.note ? { note: e.note } : {}), expectedUpdatedAt: e.updatedAt ?? e.createdAt };
    try { await withStepUp('Ödendi', () => api(`${ADMIN}/sales`, body)); setNotice(`${e.business}: ödendi olarak işaretlendi.`); await load(); }
    catch (x) { setError((x as Error).message); } finally { setBusy(''); }
  }
  const t = data?.totals;
  const names = useMemo(() => new Map(data?.businesses.map(b => [b.tenantId, b.name]) ?? []), [data]);
  return <section className="sales-page" aria-label="Satışlarım">
    <header className="page-head"><div><h1>Satışlarım</h1><p className="page-lead">İşletmelere sattığınız paketler ve tahsilatlarınız. Tutarlar KDV hariç girilir; KDV dökümü muhasebeci için hazırdır. İşletmelerin kendi satışları burada yoktur.</p></div>
      <div className="sales-head-actions">
        <button type="button" className="btn secondary small-btn" disabled={!!busy || !data} onClick={() => void take('report.xlsx')}><FileSpreadsheet size={15} />{busy === 'report.xlsx' ? 'Hazırlanıyor…' : 'Excel'}</button>
        <button type="button" className="btn secondary small-btn" disabled={!!busy || !data} onClick={() => void take('report.pdf')}><FileText size={15} />{busy === 'report.pdf' ? 'Hazırlanıyor…' : 'PDF'}</button>
        <a className="btn secondary small-btn" href={`${ADMIN}/sales/report.html?${queryOf(filter)}`} target="_blank" rel="noopener" aria-label="Yazdırılabilir sayfayı aç"><Printer size={15} />Yazdır</a>
        <button type="button" className="btn primary small-btn" disabled={disabled || !data} onClick={() => { setEditing('new'); setNotice(''); }}><Plus size={15} />Ödeme ekle</button>
      </div></header>
    {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    {data && <div className="sales-kpis">
      <article className="kpi-card"><span className="kpi-icon ok" aria-hidden="true"><Wallet size={20} /></span><span className="kpi-label">Bu ay tahsilat</span><strong>{money(data.kpis.collected)}</strong><small>{data.kpis.monthName} · {data.kpis.collectedCount} ödeme · KDV dahil</small></article>
      <article className="kpi-card"><span className="kpi-icon info" aria-hidden="true"><Repeat size={20} /></span><span className="kpi-label">Aylık düzenli gelir</span><strong>{money(Math.round(data.kpis.mrr.total / 100) * 100)}</strong><small>{data.kpis.mrr.count} ücretli işletme · KDV hariç</small></article>
      <article className={`kpi-card${data.kpis.pending.count ? ' warn' : ''}`}><span className={`kpi-icon ${data.kpis.pending.count ? 'warn' : 'idle'}`} aria-hidden="true"><CalendarClock size={20} /></span><span className="kpi-label">Bekleyen ödemeler</span><strong>{money(data.kpis.pending.gross)}</strong><small>{data.kpis.pending.count ? `${data.kpis.pending.count} kayıt ödenmedi` : 'Bekleyen yok'}</small></article>
    </div>}
    <div className="sales-filters" role="group" aria-label="Süzgeçler">
      <label>Yıl<select value={filter.year} onChange={e => setFilter({ ...filter, year: e.target.value, ...(e.target.value ? {} : { month: '' }) })}><option value="">Bütün yıllar</option>{(data?.years ?? [filter.year]).map(y => <option key={y} value={y}>{y}</option>)}</select></label>
      <label>Ay<select value={filter.month} disabled={!filter.year} onChange={e => setFilter({ ...filter, month: e.target.value })}><option value="">Bütün yıl</option>{MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}</select></label>
      <label className="grow">İşletme<select value={filter.tenant} onChange={e => setFilter({ ...filter, tenant: e.target.value })}><option value="">Bütün işletmeler</option>{data?.businesses.map(b => <option key={b.tenantId} value={b.tenantId}>{b.name}{b.removed ? ' (silindi)' : ''}</option>)}</select></label>
    </div>
    {t && <div className="sales-totals" aria-label="Dönem toplamı">
      <div><span>KDV hariç</span><strong>{money(t.net)}</strong></div>
      <div><span>KDV</span><strong>{money(t.vat)}</strong></div>
      <div><span>Toplam</span><strong>{money(t.gross)}</strong></div>
      <div className={t.unpaid ? 'warn' : ''}><span>Bekleyen</span><strong>{money(t.unpaid)}</strong></div>
    </div>}
    {data && (data.entries.length ? <div className="sales-list" role="table" aria-label="Satışlar">
      <div className="sales-row head" role="row"><span role="columnheader">Tarih</span><span role="columnheader">İşletme ve paket</span><span role="columnheader">Dönem</span><span role="columnheader" className="r">Tutar</span><span role="columnheader">Yöntem · fatura</span><span role="columnheader">Durum</span><span role="columnheader"><span className="visually-hidden">İşlemler</span></span></div>
      {data.entries.map(e => <div key={e.id} role="row" className={`sales-row${e.status === 'cancelled' ? ' cancelled' : ''}`}>
        <span role="cell" className="c-day">{day(e.day)}</span>
        <span role="cell" className="c-biz"><strong>{names.get(e.tenantId) ?? e.business}</strong><small>{e.packageName}{e.source === 'extend' ? ' · lisans uzatması' : ''}</small></span>
        <span role="cell" className="c-period">{period(e.months)}</span>
        <span role="cell" className="c-amount r"><strong>{money(gross(e))}</strong><small>KDV hariç {money(e.net)} · %{e.vatRate}</small></span>
        <span role="cell" className="c-method">{METHODS.find(([k]) => k === e.method)![1]}<small>{e.invoiceNo ? `Fatura ${e.invoiceNo}` : 'Fatura no yok'}</small></span>
        <span role="cell" className="c-status"><span className={`status-chip ${STATUS[e.status][1]}`}>{STATUS[e.status][0]}</span>{e.history?.length ? <small className="muted">düzeltildi</small> : null}</span>
        <span role="cell" className="c-actions">
          {e.status === 'unpaid' && <button type="button" className="btn secondary small-btn" disabled={disabled || !!busy} aria-label={`${e.business} ödendi yap`} onClick={() => void markPaid(e)}><CheckCircle2 size={14} />Ödendi</button>}
          <button type="button" className="icon-btn" disabled={disabled || !!busy} aria-label={`${e.business} kaydını düzenle`} onClick={() => { setEditing(e); setNotice(''); }}><Pencil size={16} /></button>
        </span>
      </div>)}
    </div> : <p className="platform-empty">Bu süzgeçte satış kaydı yok. Lisans uzatırken “Ödeme alındı” ile ya da “Ödeme ekle” ile kayıt eklenir.</p>)}
    {t && t.count > 0 && <div className="sales-breakdown">
      <section className="panel" aria-label="Aylık toplam"><h2>Aylık toplam</h2>
        <table className="mini-table"><thead><tr><th>Ay</th><th className="r">KDV hariç</th><th className="r">KDV</th><th className="r">Toplam</th><th className="r">Bekleyen</th></tr></thead>
          <tbody>{t.months.map(m => <tr key={m.month}><td>{m.name}</td><td className="r">{money(m.net)}</td><td className="r">{money(m.vat)}</td><td className="r">{money(m.gross)}</td><td className={`r${m.unpaid ? ' warn' : ''}`}>{money(m.unpaid)}</td></tr>)}</tbody>
          <tfoot><tr><td>Toplam</td><td className="r">{money(t.net)}</td><td className="r">{money(t.vat)}</td><td className="r">{money(t.gross)}</td><td className="r">{money(t.unpaid)}</td></tr></tfoot></table></section>
      <section className="panel" aria-label="KDV dökümü"><h2>KDV dökümü</h2>
        <table className="mini-table"><thead><tr><th>Oran</th><th className="r">KDV hariç</th><th className="r">KDV</th><th className="r">Toplam</th></tr></thead>
          <tbody>{t.rates.map(r => <tr key={r.rate}><td>%{r.rate}</td><td className="r">{money(r.net)}</td><td className="r">{money(r.vat)}</td><td className="r">{money(r.gross)}</td></tr>)}</tbody></table>
        <VatRate rate={data!.vatRate} disabled={disabled} onSaved={() => void load()} /></section>
    </div>}
    {t && t.count === 0 && data && <section className="panel sales-vat-alone" aria-label="KDV oranı"><VatRate rate={data.vatRate} disabled={disabled} onSaved={() => void load()} /></section>}
    {editing && data && <SaleForm entry={editing === 'new' ? null : editing} data={data} onClose={() => setEditing(null)} onSaved={msg => { setEditing(null); setNotice(msg); void load(); }} />}
  </section>;
}

/** "Yazılım hizmeti KDV oranı": used for new entries (each entry keeps its own rate). */
function VatRate({ rate, disabled, onSaved }: { rate: number; disabled: boolean; onSaved: () => void }) {
  const [text, setText] = useState(String(rate)), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => setText(String(rate)), [rate]);
  const ok = /^\d{1,3}$/.test(text) && Number(text) <= 100;
  return <form className="vat-rate" onSubmit={async e => { e.preventDefault(); if (!ok) return; setBusy(true); setError(''); try { await withStepUp('KDV oranını kaydet', () => api(`${ADMIN}/catalog/vat`, { vatRate: Number(text) })); onSaved(); } catch (x) { setError((x as Error).message); } finally { setBusy(false); } }}>
    <label>Yazılım hizmeti KDV oranı<span className="money-input narrow"><span className="affix">%</span><input inputMode="numeric" value={text} disabled={disabled || busy} onChange={e => setText(e.target.value)} aria-invalid={!ok} /></span></label>
    <button className="btn secondary small-btn" disabled={disabled || busy || !ok || Number(text) === rate}>Kaydet</button>
    <small className="muted">Yeni kayıtlarda kullanılır; önceki kayıtlar kendi oranıyla kalır.</small>
    {error && <Notice tone="error">{error}</Notice>}
  </form>;
}

/** Add or correct one entry. The amount is typed with or without KDV; what is stored is the amount without it. */
function SaleForm({ entry, data, onClose, onSaved }: { entry: SaleRow | null; data: SalesData; onClose: () => void; onSaved: (message: string) => void }) {
  const first = data.businesses.find(b => !b.removed);
  const [tenantId, setTenantId] = useState(entry?.tenantId ?? first?.tenantId ?? ''), [dayValue, setDay] = useState(entry?.day ?? data.today);
  const [months, setMonths] = useState<1 | 6 | 12 | null>(entry ? entry.months : 1), [vatRate, setVatRate] = useState(String(entry?.vatRate ?? data.vatRate));
  const [withVat, setWithVat] = useState(false), [amount, setAmount] = useState(entry ? moneyInput(entry.net) : ''), [edited, setEdited] = useState(!!entry);
  const [method, setMethod] = useState<Method>(entry?.method ?? 'transfer'), [invoiceNo, setInvoiceNo] = useState(entry?.invoiceNo ?? ''), [note, setNote] = useState(entry?.note ?? ''), [status, setStatus] = useState<Status>(entry?.status ?? 'paid');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const biz = data.businesses.find(b => b.tenantId === tenantId);
  const suggested = biz && months ? periodPrice({ monthly: biz.monthly, yearly: biz.yearly }, months) : 0;
  useEffect(() => { if (!edited && suggested) setAmount(moneyInput(withVat ? suggested + vatOf(suggested, Number(vatRate) || 0) : suggested)); }, [suggested, edited, withVat]);
  const rate = Number(vatRate), rateOk = /^\d{1,3}$/.test(vatRate) && rate <= 100, typed = parseMoney(amount), problem = moneyError(amount, { min: 0 });
  const net = Number.isFinite(typed) && rateOk ? (withVat ? netFromGross(typed, rate) : typed) : NaN;
  async function save() {
    if (problem || !rateOk || !tenantId) return;
    setBusy(true); setError('');
    try {
      const body = { requestId: requestId(), ...(entry ? { id: entry.id, expectedUpdatedAt: entry.updatedAt ?? entry.createdAt } : {}), tenantId, day: dayValue, months, net, vatRate: rate, method, status, ...(invoiceNo.trim() ? { invoiceNo: invoiceNo.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...(entry && entry.tenantId === tenantId ? { packageName: entry.packageName } : {}) };
      await withStepUp(entry ? 'Kaydı düzelt' : 'Ödeme ekle', () => api(`${ADMIN}/sales`, body));
      onSaved(entry ? 'Kayıt düzeltildi; önceki değerler kaydın geçmişinde.' : 'Ödeme kaydedildi.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const pills = <T extends string | number | null>(label: string, value: T, set: (v: T) => void, options: [T, string][]) => <div className="payment-pills"><span className="pill-label">{label}</span><div className="platform-pills" role="radiogroup" aria-label={label}>{options.map(([k, t]) => <button type="button" role="radio" key={String(k)} aria-checked={value === k} className={value === k ? 'active' : ''} disabled={busy} onClick={() => set(k)}>{t}</button>)}</div></div>;
  return <Modal title={entry ? 'Satış kaydını düzelt' : 'Ödeme ekle'} wide className="sale-dialog" dismissible={!busy} onClose={onClose}>
    <form className="sale-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <div className="sale-fields">
        <label className="span-2">İşletme<select value={tenantId} disabled={busy} onChange={e => { setTenantId(e.target.value); setEdited(!!entry); }}>{data.businesses.filter(b => !b.removed || b.tenantId === entry?.tenantId).map(b => <option key={b.tenantId} value={b.tenantId}>{b.name}</option>)}</select>
          {biz && <small className="muted">{biz.packageName}{biz.monthly ? ` · ${money(biz.monthly)}/ay · ${money(biz.yearly)}/yıl` : ''}</small>}</label>
        <label>Tarih<DateField required value={dayValue} disabled={busy} onChange={v => setDay(v)} /></label>
        {pills<1 | 6 | 12 | null>('Dönem', months, v => { setMonths(v); if (!entry) setEdited(false); }, [[1, '1 ay'], [6, '6 ay'], [12, '1 yıl'], [null, 'Diğer']])}
        <div className="span-2 sale-amount">
          <div className="segmented" role="radiogroup" aria-label="Tutar türü">{([[false, 'KDV hariç'], [true, 'KDV dahil']] as const).map(([k, t]) => <button type="button" role="radio" key={t} aria-checked={withVat === k} className={withVat === k ? 'active' : ''} disabled={busy} onClick={() => { if (Number.isFinite(typed) && rateOk) setAmount(moneyInput(k ? typed + vatOf(typed, rate) : netFromGross(typed, rate))); setWithVat(k); }}>{t}</button>)}</div>
          <label>Tutar ({withVat ? 'KDV dahil' : 'KDV hariç'})<span className="money-input"><span className="affix">₺</span><input inputMode="decimal" required value={amount} disabled={busy} aria-invalid={!!problem && !!amount} onChange={e => { setAmount(e.target.value); setEdited(true); }} /></span>
            {suggested > 0 && <small className="muted">Önerilen: {money(suggested)} (KDV hariç, {period(months)})</small>}{problem && amount && <small className="field-problem">{problem}</small>}</label>
          <label>KDV oranı<span className="money-input narrow"><span className="affix">%</span><input inputMode="numeric" value={vatRate} disabled={busy} onChange={e => setVatRate(e.target.value)} aria-invalid={!rateOk} /></span></label>
          <div className="payment-total" aria-live="polite"><span>KDV hariç</span><b>{Number.isFinite(net) ? money(net) : '—'}</b><span>KDV</span><b>{Number.isFinite(net) ? money(vatOf(net, rate)) : '—'}</b><span>Toplam</span><b className="big">{Number.isFinite(net) ? money(net + vatOf(net, rate)) : '—'}</b></div>
        </div>
        {pills<Method>('Yöntem', method, setMethod, METHODS)}
        <label>Fatura no <span className="muted small">(isteğe bağlı)</span><input maxLength={60} value={invoiceNo} disabled={busy} onChange={e => setInvoiceNo(e.target.value)} /></label>
        {pills<Status>('Durum', status, setStatus, entry ? [['paid', 'Ödendi'], ['unpaid', 'Ödenmedi'], ['cancelled', 'İptal']] : [['paid', 'Ödendi'], ['unpaid', 'Ödenmedi']])}
        <label className="span-2">Not <span className="muted small">(isteğe bağlı)</span><input maxLength={300} value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></label>
        {entry?.history?.length ? <details className="span-2 sale-history"><summary>Değişiklik geçmişi ({entry.history.length})</summary><ul>{entry.history.slice().reverse().map(h => <li key={h.at}><small className="muted">{dateTime(h.at)}</small>{h.changes.map(c => <span key={c.field}>{c.field}: {c.from} → {c.to}</span>)}</li>)}</ul></details> : null}
      </div>
      {error && <div className="sale-error"><Notice tone="error"><AlertCircle size={15} /> {error}</Notice></div>}
      <div className="platform-create-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || !!problem || !rateOk || !tenantId}>{busy ? 'Kaydediliyor…' : entry ? 'Düzeltmeyi kaydet' : 'Kaydet'}</button></div>
    </form>
  </Modal>;
}
