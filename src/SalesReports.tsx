import { FeatureLockView, LockedRow, openFeatureLock, usePackage } from './FeatureLock';
import type { FeatureId } from '../packages/domain/feature-gate';
import { DateField } from './DateField';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarDays, CalendarRange, Mail, Smartphone, TrendingUp, Users, type LucideIcon } from 'lucide-react';
import { ProfitReport } from './ProfitReport';
import { ReservationReport } from './ReservationReport';
import { PillTabs } from './PillTabs';
import { bucketHeading, bucketize, bucketNoun, bucketTick, bucketTitle, tickStep, whole, type Bucket } from './reportBuckets';
import { EmployeeReports } from './EmployeeReports';
import { CampaignReports } from './CampaignReports';
import { RefreshStatus } from './RefreshStatus';
import { reportToday, formatReportDate } from './ReportPeriod';
import { comparisonLabel, DAY_START_HOUR, dayStartText } from '../packages/domain/business-day';
import { saatEki } from '../packages/domain/saat-eki';
import { api, money } from './api';
import { Modal, Notice } from './components';
import { formatWeight } from '../packages/domain/lines';
import { HelpTip } from './HelpTip';
import { DeleteNote, NoteCard, NoteForm, useAgendaNotes } from './Agenda';
import { longDay, type AgendaNote } from '../packages/domain/agenda';
import { ReportTools, SimpleSummary, VatPanel } from './ReportSimple';
import { YearPicker, yearOf, YearTable } from './ReportYears';
import { EmailReports } from './EmailReports';
import { PlaceLink } from './Moved';
import { goTo } from './navigate';
import './report-workspace.css';

export type Range = { from: string; to: string };
type Overview = {
  range: { from: string; to: string; days: number };
  sales: number; cash: number; card: number; posCommission: number; expenses: number; refunds: number; kept: number;
  /** `year`: a calendar year, compared with the same dates of the year before (packages/domain/reports.ts previousRange). */
  previous: { from: string; to: string; sales: number; kept: number; partial?: boolean; year?: boolean } | null;
  /** The bills open right now: only for a period holding today (null for a past one, K-O). */
  daily: { day: string; sales: number; reservation?: number }[]; openAccounts: number | null;
  topProducts: { id: string; name: string; qty: number; amount: number; unit?: 'kg'; grams?: number }[];
  hourly: { hour: number; sales: number; orders: number }[];
  orders: number; closedAccounts: number; averageAccount: number; cancelled: { count: number; amount: number };
  unknownCommission?: { count: number; amount: number };
  /** Paid online on a delivery platform, and sales by channel (packages/domain/reports.ts channelRows). */
  platform?: number; channels?: { id: string; name: string; orders: number; amount: number }[];
  /** Paid on reserved and event tables (the chart's "Rezervasyon" colour); part of `sales`. */
  reservationSales?: number;
  /** Automatic expenses of the period (Kasa ve giderler → Giderler → Otomatik giderler), part of `expenses`. */
  autoExpenses?: number;
};
type ProductReport = { total: number; products: { id: string; name: string; category: string; qty: number; amount: number; share: number; unit?: 'kg'; grams?: number }[] };
type Sold = { qty: number; unit?: 'kg'; grams?: number };
/** Products sold by kg read as their total weight ("12,5 kg"); without a weight (older records) as the sale count, never "adet". */
const weighed = (p: Sold) => p.unit === 'kg' && !!p.grams;
const qtyText = (p: Sold) => weighed(p) ? formatWeight(p.grams!) : `${p.qty.toLocaleString('tr-TR')} ${p.unit === 'kg' ? 'satış' : 'adet'}`;
/** Header total: pieces of piece products, weight of kg products, so 500 g never adds up as "1 adet". */
function soldTotal(rows: Sold[]) {
  const pieces = rows.filter(p => p.unit !== 'kg').reduce((n, p) => n + p.qty, 0), grams = rows.filter(weighed).reduce((n, p) => n + p.grams!, 0);
  const sales = rows.filter(p => p.unit === 'kg' && !p.grams).reduce((n, p) => n + p.qty, 0);
  return [(pieces || (!grams && !sales)) && `${pieces.toLocaleString('tr-TR')} adet`, grams && formatWeight(grams), sales && `${sales.toLocaleString('tr-TR')} satış`].filter(Boolean).join(' · ');
}

/**
 * Satış ve Raporlar is the read-only "işletme nasıl gidiyor?" place (10 Ekim düzeni, docs/BILGI_MIMARISI_ONERISI.md). Two
 * rows of tabs: the groups on top (icons; on a phone the icon sits above the short name, all on one row), the group's
 * reports in a quieter row under them (hidden when the group has a single report). The record books live where the work is:
 * Kasa kapanışları, Giderler, İade ve düzeltme in Kasa ve giderler; Personel ve bahşiş in Personel → Vardiya ve bahşiş (the
 * old "Para" group and its signposts went on 13 Ekim).
 */
const TAB_NAMES = { summary: 'Özet', products: 'Ürünler', profit: 'Kârlılık', campaigns: 'Kampanyalar', employees: 'Çalışanlar', reservations: 'Rezervasyon' } as const;
export type ReportTab = keyof typeof TAB_NAMES;
type Tab = ReportTab;
/** Tabs of the earlier reports, remembered on devices or opened by older links: where they land now. */
const OLD_TABS: Record<string, Tab> = { cash: 'summary', expenses: 'summary', corrections: 'summary', money: 'summary', staff: 'employees' };
type Group = 'sales' | 'people' | 'reservations';
const GROUPS: { id: Group; label: string; icon: LucideIcon; tabs: Tab[] }[] = [
  { id: 'sales', label: 'Satış', icon: TrendingUp, tabs: ['summary', 'products', 'profit', 'campaigns'] },
  { id: 'people', label: 'Personel', icon: Users, tabs: ['employees'] },
  { id: 'reservations', label: 'Rezervasyon', icon: CalendarRange, tabs: ['reservations'] },
];
const groupOf = (tab: Tab) => GROUPS.find(g => g.tabs.includes(tab)) ?? GROUPS[0];
/** Hizmet paketi: reports that are one service each; closed, they are faded (owner, Müdür) and open the blurred card. */
const TAB_FEATURE: Partial<Record<Tab, FeatureId>> = { profit: 'stock', reservations: 'reservations' };
/** Where the reports were left on this device: the open report and, per group, the report it shows when chosen again. */
type Place = { tab: Tab; last: Partial<Record<Group, Tab>> };
const PLACE_KEY = 'mola-report-place';
const isTab = (v: unknown): v is Tab => typeof v === 'string' && Object.keys(TAB_NAMES).includes(v);
/** A report id of now or of the earlier reports ("expenses" → Özet); null when unknown. */
export const reportTab = (v: unknown): Tab | null => isTab(v) ? v : typeof v === 'string' && OLD_TABS[v] ? OLD_TABS[v] : null;
function rememberedPlace(): Place {
  try {
    const saved = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null') as { tab?: unknown; last?: Record<string, unknown> } | null;
    const tab = reportTab(saved?.tab);
    if (saved && tab) {
      const last: Place['last'] = {};
      for (const g of GROUPS) { const t = reportTab(saved.last?.[g.id]); if (t && g.tabs.includes(t)) last[g.id] = t; }
      return { tab, last };
    }
  } catch { /* preference only */ }
  return { tab: 'summary', last: {} };
}
/** "Sade özet" (default) or the full reports ("Detaylı göster"), remembered on this device. */
const VIEW_KEY = 'mola-report-view';
function rememberedDetail() { try { return localStorage.getItem(VIEW_KEY) === 'detail'; } catch { return false; } }
const shift = (day: string, days: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
// Business days in Turkish time. "Yıl ▾" (src/ReportYears.tsx) sits between "30 gün" and "Tümü": a calendar year, read
// from its monthly and yearly roll-ups.
const PRESETS: [string, string, () => Range][] = [
  ['today', 'Bugün', () => ({ from: reportToday(), to: reportToday() })],
  ['7', '7 gün', () => ({ from: shift(reportToday(), -6), to: reportToday() })],
  ['30', '30 gün', () => ({ from: shift(reportToday(), -29), to: reportToday() })],
  ['all', 'Tümü', () => ({ from: 'all', to: 'all' })],
];
/** The period every report (and the record books of Kasa ve giderler and Personel) starts on: today. */
export const todayRange = PRESETS[0][2];

/** Opens the reports on a tab (and so on its group); `campaign`: Kampanyalar on that campaign; `margins`: Kârlılık's "Uyarı sınırları". */
export type ReportsOpening = { key: number; tab: Tab; campaign?: string; margins?: boolean; send?: boolean };

/** Sales and reports: one period for every tab, plain words for money (satış, çıkan para, elde kalan). */
/** `onRecipe`: Kârlılık → "Reçete ekle" opens that product's recipe in Stok. */
export function SalesReports({ open, onRecipe }: { open?: ReportsOpening; onRecipe?: (productId: string) => void }) {
  // A link to one report wins over the remembered place; either way the place is remembered on this device.
  const [place, setPlace] = useState<Place>(() => { const saved = rememberedPlace(); return open ? { tab: open.tab, last: { ...saved.last, [groupOf(open.tab).id]: open.tab } } : saved; });
  useEffect(() => { try { localStorage.setItem(PLACE_KEY, JSON.stringify(place)); } catch { /* preference only */ } }, [place]);
  const tab = place.tab, group = groupOf(tab);
  const setTab = (next: Tab) => setPlace(p => ({ tab: next, last: { ...p.last, [groupOf(next).id]: next } }));
  // A group opens on the report last seen in it, else its first one.
  const setGroup = (id: Group) => { const g = GROUPS.find(x => x.id === id)!; setTab(place.last[id] ?? g.tabs[0]); };
  const [range, setRange] = useState<Range>(todayRange);
  // The plain summary first; a link to one report (ReportsOpening) opens the full reports without changing the remembered choice.
  const [detail, setDetailState] = useState(() => (!!open && !open.send) || rememberedDetail());
  const setDetail = (on: boolean) => { setDetailState(on); try { localStorage.setItem(VIEW_KEY, on ? 'detail' : 'simple'); } catch { /* preference only */ } };
  // Campaigns are compared on their own dates, so the period does not apply there.
  const usesPeriod = !detail || tab !== 'campaigns';
  const pk = usePackage(), tabLocked = (id: Tab) => { const f = TAB_FEATURE[id]; return !!f && !pk.has(f); }, lockedHere = TAB_FEATURE[tab] && tabLocked(tab) ? TAB_FEATURE[tab] : undefined;
  // The owner's own: "Raporları gönder" (e-posta raporları) and "Raporları telefonda gör" (Ayarlar → Uzaktan erişim).
  const owner = pk.owner, [sending, setSending] = useState(!!open?.send && pk.has('email-reports'));
  return <div className="reports-workspace reports-v2">
    {usesPeriod && <PeriodBar range={range} onChange={setRange} />}
    <div className="report-toolbar">
      {detail && <button type="button" className="btn secondary report-mode-btn" onClick={() => setDetail(false)}>Sade özete dön</button>}
      <ReportTools view={detail ? tab : 'summary'} viewName={detail ? TAB_NAMES[tab] : 'Satış özeti'} range={range} extra={owner ? [
        { id: 'email', icon: <Mail size={18} aria-hidden="true" />, label: 'Raporları gönder', sub: 'Günlük, haftalık, aylık özet e-postayla', locked: !pk.has('email-reports'), onClick: () => pk.has('email-reports') ? setSending(true) : openFeatureLock('email-reports') },
        { id: 'phone', icon: <Smartphone size={18} aria-hidden="true" />, label: 'Raporları telefonda gör', sub: 'Telefonunuzu bir kez eşleştirin, her yerden bakın', onClick: () => goTo({ view: 'settings', topic: 'remote' }) },
      ] : []} />
    </div>
    {sending && <Modal title="Raporları gönder" wide className="email-reports-dialog" onClose={() => setSending(false)}><div className="modal-body settings-shell"><div className="settings-page wide email-reports-page"><div className="settings-page-body"><EmailReports /></div></div></div></Modal>}
    {!detail ? <SimpleSummary range={range} onDetail={() => setDetail(true)} onRange={setRange} /> : <>
    <div className="report-nav">
      <PillTabs label="Rapor bölümleri" className="report-groups" phoneStack dataAttr="report-group" value={group.id} onChange={setGroup} items={GROUPS.map(g => ({ id: g.id, label: g.label, icon: g.icon, locked: g.tabs.every(tabLocked) }))} />
      {group.tabs.length > 1 && <PillTabs label="Rapor sekmeleri" className="report-tabs" variant="sub" dataAttr="report-tab" value={tab} onChange={setTab} items={group.tabs.map(id => ({ id, label: TAB_NAMES[id], locked: tabLocked(id) }))} />}
    </div>
    {lockedHere ? <FeatureLockView feature={lockedHere} compact onClose={() => setTab('summary')} /> : tab === 'summary' ? <Summary range={range} onProducts={() => setTab('products')} onRange={setRange} /> : tab === 'products' ? <Products range={range} /> : tab === 'profit' ? <ProfitReport range={range} onRecipe={onRecipe} margins={open?.margins} /> : tab === 'employees' ? <EmployeeReports range={range} /> : tab === 'campaigns' ? <CampaignReports initial={open?.campaign} /> : <ReservationReport range={range} />}
    </>}
  </div>;
}

export function PeriodBar({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  const custom = useRef<HTMLDetailsElement>(null);
  const [from, setFrom] = useState(range.from === 'all' ? reportToday() : range.from), [to, setTo] = useState(range.to === 'all' ? reportToday() : range.to);
  const selected = PRESETS.find(([, , make]) => { const r = make(); return r.from === range.from && r.to === range.to; })?.[0] ?? (yearOf(range) ? 'year' : undefined);
  const tooLong = (Date.parse(to) - Date.parse(from)) / 86400000 > 365;
  const pill = ([id, label, make]: typeof PRESETS[number]) => <button key={id} type="button" className={selected === id ? 'active' : ''} aria-pressed={selected === id} onClick={() => onChange(make())}>{label}</button>;
  return <section className="period-bar" aria-label="Rapor dönemi">
    <div className="period-pills" role="group" aria-label="Dönem">{PRESETS.slice(0, 3).map(pill)}<YearPicker range={range} onChange={onChange} />{pill(PRESETS[3])}
      <details className="period-custom" ref={custom}><summary className={selected ? '' : 'active'}><CalendarDays size={14} />Tarih seç</summary>
        <form onSubmit={e => { e.preventDefault(); onChange({ from, to }); if (custom.current) custom.current.open = false; }}><label>Başlangıç<DateField required value={from} max={reportToday()} onChange={v => setFrom(v)} /></label><label>Bitiş<DateField required value={to} min={from} max={reportToday()} onChange={v => setTo(v)} /></label><button className="btn primary small-btn" disabled={!from || !to || from > to || tooLong}>Göster</button>{tooLong && <p className="muted small">En fazla 366 gün seçilebilir. Daha uzun dönem için "Tümü".</p>}</form>
      </details></div>
    <span className="period-label">{rangeLabel(range)}<HelpTip title={selected === 'today' ? `Bugün (kasa günü, ${saatEki(dayStartText, 'e')} kadar)` : 'Rapor dönemi'}>{`Her gün, gün sonu kasası gibi sabah ${saatEki(dayStartText, 'de')} başlar ve ertesi sabah ${saatEki(dayStartText, 'e')} kadar sürer: gece yarısından sonraki satışlar o geceye yazılır. Bütün raporlar aynı günü kullanır. Satış, ödemenin alındığı güne yazılır; henüz ödenmemiş açık hesaplar satışa dahil değildir.`}</HelpTip></span>
  </section>;
}
function rangeLabel(r: Range) { const year = yearOf(r); return r.from === 'all' ? 'Tüm zamanlar' : year ? (r.to.endsWith('-12-31') ? `${year} yılı` : `${year} yılı · bugüne kadar`) : r.from === r.to ? formatReportDate(r.from) : `${formatReportDate(r.from)} – ${formatReportDate(r.to)}`; }

/** Loads one report for the period; keeps the last result on screen while a new period loads. */
export function useReport<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!path) return;
    let live = true; setLoading(true); setError('');
    api<T>(path).then(d => { if (live) setData(d); }).catch(e => { if (live) setError((e as Error).message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path]);
  return { data, error, loading };
}
export function ReportState({ data, error, loading, children }: { data: unknown; error: string; loading: boolean; children: ReactNode }) {
  return <>{loading && !!data && <RefreshStatus />}{error && <Notice tone="error">{error}{!!data && ' Önceki sonuçlar gösteriliyor.'}</Notice>}{!data && !error && <p role="status" className="report-loading">Rapor yükleniyor…</p>}{!!data && children}</>;
}
const query = (r: Range) => `from=${r.from}&to=${r.to}`;

function Summary({ range, onProducts, onRange }: { range: Range; onProducts: () => void; onRange: (r: Range) => void }) {
  const { data, error, loading } = useReport<Overview>(`/api/staff/reports/overview?${query(range)}`), advanced = usePackage().has('reports-advanced');
  // "Tümü": the table of years under the headline figures (served from the yearly roll-ups); a year opens that year.
  return <ReportState data={data} error={error} loading={loading}>{data && <><SummaryView d={data} onProducts={onProducts} years={range.from === 'all' ? <YearTable onYear={onRange} /> : null} />{advanced ? <VatPanel range={range} /> : <LockedRow feature="reports-advanced" title="KDV dökümü" line="Orana göre satış, matrah ve KDV: Gelişmiş raporlar hizmetiyle." />}</>}</ReportState>;
}
function SummaryView({ d, onProducts, years }: { d: Overview; onProducts: () => void; years?: ReactNode }) {
  const out = d.expenses + d.posCommission, provisional = !!d.unknownCommission?.count;
  const paid = d.cash + d.card;
  // Automatic expenses (a month's rent on its day) that make up most of a short period's expenses, or push it below zero.
  const bulky = !!d.autoExpenses && d.autoExpenses * 2 >= d.expenses && (d.range.days < 28 || d.kept < 0);
  return <>
    <div className="kpi-row">
      <article className="kpi"><span>Satış<HelpTip title="Satış">Bu dönemde kasaya giren para: nakit ve kart ödemeleri. Açık hesaplar, ödenene kadar satışa yazılmaz.</HelpTip></span><strong>{money(d.sales)}</strong>{d.previous !== null && <Change now={d.sales} before={d.previous?.sales} days={d.range.days} to={d.range.to} partial={!!d.previous?.partial} year={!!d.previous?.year} />}</article>
      <article className="kpi"><span>Çıkan para</span><strong>{money(out)}</strong><small><b>Giderler {money(d.expenses)}</b> · <b>POS {money(d.posCommission)}</b><span className="kpi-explain">POS komisyonu = bankanın kart satışlarından aldığı pay</span></small><PlaceLink to={{ view: 'cash', tab: 'expenses', part: 'records' }}>Gider kayıtlarını aç</PlaceLink></article>
      <article className="kpi kpi-main"><span>{provisional ? 'Elde kalan (geçici)' : 'Elde kalan'}<HelpTip title="Elde kalan">Satış − giderler − POS komisyonu − iadeler. Kira, maaş gibi Mola'ya girilmeyen giderler düşülmediği için net kâr değildir.</HelpTip></span><strong>{money(d.kept)}</strong><small>{d.refunds ? `İadeler ${money(d.refunds)} düşüldü` : 'Satış − çıkan para'}<span className="kpi-explain">Elde kalan = satış − giderler − iadeler − kart komisyonu</span></small>{bulky && <small className="kpi-bulk-note">Bu dönemde aylık kira gibi toplu giderler var ({money(d.autoExpenses!)}); elde kalan bu yüzden düşük görünebilir.</small>}</article>
    </div>
    {provisional && <Notice>{d.unknownCommission!.count} kart ödemesinin ({money(d.unknownCommission!.amount)}) POS komisyonu bilinmiyor; elde kalan biraz daha düşük olabilir.</Notice>}
    {years}
    <section className="panel split-card"><div className="split-legend"><span><i className="dot cash" />Nakit <b>{money(d.cash)}</b></span>{d.openAccounts !== null && <span className="muted" data-testid="open-accounts">Açık hesaplar: {money(d.openAccounts)} <small>(henüz ödenmedi)</small></span>}<span><i className="dot card" />Kart <b>{money(d.card)}</b></span>{!!d.platform && <span>Platform ödemesi <b>{money(d.platform)}</b></span>}{!!d.reservationSales && <span><i className="dot resv" />Rezervasyon <b>{money(d.reservationSales)}</b> <small className="muted">(satışın içinde)</small></span>}</div>
      <div className="split-bar" role="img" aria-label={`Nakit yüzde ${pct(d.cash, paid)}, kart yüzde ${pct(d.card, paid)}`}>{paid > 0 ? <><div className="cash" style={{ width: `${d.cash / paid * 100}%` }} /><div className="card" style={{ width: `${d.card / paid * 100}%` }} /></> : <div className="empty" />}</div></section>
    {d.range.from === d.range.to && d.range.from !== 'all' ? <TodayNote day={d.range.from} /> : <DailyBars days={d.daily} />}
    <div className="report-pair">
      <section className="panel"><div className="report-section-heading"><h3>En çok kazandıranlar</h3><button type="button" className="text-btn" onClick={onProducts}>Tüm ürünler</button></div>
        {!d.topProducts.length ? <p className="report-empty-note">Bu dönemde satılan ürün yok.</p> : d.topProducts.map(p => <div className="rank-row" key={p.id}><span className="rank-name" title={p.name}>{p.name}</span><small>{qtyText(p)}</small><span className="rank-bar"><i style={{ width: `${p.amount / Math.max(1, d.topProducts[0].amount) * 100}%` }} /></span><strong>{money(p.amount)}</strong></div>)}</section>
      <HourHeat hours={d.hourly} />
    </div>
    <div className="mini-stats"><div><span>Sipariş</span><strong>{d.orders.toLocaleString('tr-TR')}</strong></div><div><span>Ortalama hesap</span><strong>{money(d.averageAccount)}</strong></div><div><span>İptal</span><strong>{d.cancelled.count.toLocaleString('tr-TR')} · {money(d.cancelled.amount)}</strong></div></div>
    {d.channels?.some(c => c.id !== 'salon' && c.orders > 0) && <section className="panel channel-card" aria-label="Kanallar"><div className="report-section-heading"><h3>Kanallar</h3><span className="muted small">Sipariş tutarı, iptaller hariç</span></div>{d.channels.map(c => <div className="rank-row" key={c.id}><span className="rank-name">{c.name}</span><small>{c.orders.toLocaleString('tr-TR')} sipariş</small><span className="rank-bar"><i style={{ width: `${c.amount / Math.max(1, ...d.channels!.map(x => x.amount)) * 100}%` }} /></span><strong>{money(c.amount)}</strong></div>)}</section>}
  </>;
}
const pct = (part: number, total: number) => total ? Math.round(part / total * 100) : 0;

/** `partial`: the period is still running, so the server compared it with the same stretch before it up to this clock time. */
function Change({ now, before, days, to, partial, year }: { now: number; before?: number; days: number; to: string; partial: boolean; year: boolean }) {
  if (before === undefined) return <small>Tüm zamanlar</small>;
  // The same words as the plain sentence and the printout ("geçen yılın aynı dönemine göre" for this year so far).
  const than = `${comparisonLabel(days, { partial, endsToday: to === reportToday(), year })} göre`;
  if (!before) return <small>{than}: önceki dönemde satış yok</small>;
  // A business that just started has a near-empty previous period; a 3000% jump would only confuse.
  if (before * 4 < now) return <small>{than}: önceki dönemde satış çok azdı</small>;
  const change = Math.round((now - before) / before * 100);
  return <small className={change >= 0 ? 'up' : 'down'}>{change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}%{Math.abs(change)} {than}</small>;
}

/** Tooltip above the hovered bar or hour, shown at once (the browser's own title tip waits a second). `part`: the bar's
 * coloured share ("rezervasyon ₺805"), said after the amount like the bar's aria-label says it. */
function Tip({ at, count, bottom, title, value, part, note }: { at: number; count: number; bottom: string; title: string; value: string; part?: string; note?: string }) {
  const x = (at + 0.5) / count, side = x < 0.12 ? 'start' : x > 0.88 ? 'end' : 'middle';
  return <div className={`chart-tip ${side}`} style={{ left: `${x * 100}%`, bottom }} aria-hidden="true"><span>{title}</span><strong>{value}{part && <small className="chart-tip-part">, {part}</small>}</strong>{note && <em className="chart-tip-note">{note}</em>}</div>;
}
/** The words a day's notes show in the chart's tip: the sales note first, then Ajanda titles. */
const notePreview = (notes: AgendaNote[]) => { const n = notes.find(x => x.kind === 'sales') ?? notes[0]; if (!n) return undefined; const text = n.title || n.text; return `${text.length > 60 ? `${text.slice(0, 57)}…` : text}${notes.length > 1 ? ` (+${notes.length - 1})` : ''}`; };

/**
 * The sales chart: one bar per day up to a month, per week up to about four months, per month for "1 yıl" and "Tümü"
 * (src/reportBuckets.ts). Notes of Ajanda and "Satış notu" mark the bar that holds their day; the tip lists them. A day
 * bar opens that day's notes (and "Bu güne not yaz"); a week or month bar opens the notes inside it.
 */
function DailyBars({ days }: { days: Overview['daily'] }) {
  const [focus, setFocus] = useState<number | null>(null), [open, setOpen] = useState<string | null>(null);
  const bars = bucketize(days), kind = bars[0]?.kind ?? 'day', daily = kind === 'day';
  const top = Math.max(1, ...bars.map(b => b.sales));
  // Notes of the days on the chart (Ajanda reads at most 400 days at once: the most recent ones of a longer "Tümü").
  const first = bars[0]?.from ?? null, last = bars.at(-1)?.to ?? null;
  const notesFrom = first && last && Date.parse(last) - Date.parse(first) > 399 * 86400000 ? new Date(Date.parse(`${last}T00:00:00Z`) - 399 * 86400000).toISOString().slice(0, 10) : first;
  const { notes, reload } = useAgendaNotes(bars.length < 2 ? null : notesFrom, bars.length < 2 ? null : last);
  const inBar = (b: Bucket) => (notes ?? []).filter(n => n.day >= b.from && n.day <= b.to).sort((a, c) => a.day.localeCompare(c.day));
  const height = (sales: number) => Math.max(2, sales / top * 100);
  if (bars.length < 2) return null;
  const step = tickStep(bars.length), openBar = bars.find(b => b.key === open);
  const tipNote = (b: Bucket) => { const list = inBar(b); if (!list.length) return undefined; return daily ? notePreview(list) : `${list.length} not: ${notePreview(list)}`; };
  return <section className={`panel daily-card bars-${kind}`} data-bars={kind}><div className="report-section-heading"><h3>{bucketHeading[kind]}</h3><span className="muted small">En yüksek {bucketNoun[kind]}: {money(top)}</span></div>
    <div className="chart-area" onMouseLeave={() => setFocus(null)}>
      <div className={`daily-bars${bars.length > 40 ? ' dense' : ''}`}>{bars.map((b, i) => { const weekend = daily && [0, 6].includes(new Date(`${b.from}T12:00:00Z`).getUTCDay()), noted = inBar(b).length > 0; return <button type="button" key={b.key} className={[weekend && 'weekend', !whole(b) && 'partial', focus === i && 'focus', noted && 'noted', open === b.key && 'open'].filter(Boolean).join(' ')} style={{ height: `${height(b.sales)}%` }} aria-label={`${bucketTitle(b)}: ${money(b.sales)}${b.reservation ? `, rezervasyon ${money(b.reservation)}` : ''}${noted ? daily ? ', not var' : `, ${inBar(b).length} not` : ''}`} aria-expanded={open === b.key} onMouseEnter={() => setFocus(i)} onFocus={() => setFocus(i)} onBlur={() => setFocus(null)} onClick={() => { setFocus(i); setOpen(o => o === b.key ? null : b.key); }}>{!!b.reservation && <i className="bar-resv" style={{ height: `${Math.min(100, b.reservation / Math.max(1, b.sales) * 100)}%` }} />}</button>; })}</div>
      {focus !== null && bars[focus] && <Tip at={focus} count={bars.length} bottom={`calc(${height(bars[focus].sales) * 1.2}px + 16px)`} title={bucketTitle(bars[focus])} value={money(bars[focus].sales)} part={bars[focus].reservation ? `rezervasyon ${money(bars[focus].reservation)}` : undefined} note={tipNote(bars[focus])} />}
    </div>
    {daily ? <div className="daily-axis muted small"><span>{bucketTitle(bars[0])}</span><span className="daily-legend"><span><i className="dot weekend" />Hafta sonu</span><span><i className="dot noted" />Notlu gün</span>{bars.some(b => b.reservation) && <span><i className="dot resv" />Rezervasyon</span>}</span><span>{bucketTitle(bars.at(-1)!)}</span></div>
      : <><div className="chart-ticks muted small" aria-hidden="true">{bars.map((b, i) => <span key={b.key} className={i % step === 0 ? (i / step) % 2 ? 'tick alt' : 'tick' : ''}>{i % step === 0 ? bucketTick(b, i === 0) : ''}</span>)}</div>
        <div className="daily-axis muted small legend-only"><span className="daily-legend">{bars.some(b => !whole(b)) && <span><i className="dot partial" />Yarım {bucketNoun[kind]}</span>}<span><i className="dot noted" />Notlu {bucketNoun[kind]}</span>{bars.some(b => b.reservation) && <span><i className="dot resv" />Rezervasyon</span>}</span></div></>}
    {!open && <p className="muted small day-note-hint">{daily ? 'Bir güne dokunarak o güne not yazabilirsiniz (ör. "Kampanya bugün satışları artırdı").' : `Bir ${bucketNoun[kind]} sütununa dokunarak içindeki notları görebilirsiniz. Güne not yazmak için Ajanda'yı ya da 30 günlük dönemi açın.`}</p>}
    {open && daily && <DayNotes key={open} day={open} notes={openBar ? inBar(openBar) : []} onChanged={reload} onClose={() => setOpen(null)} />}
    {open && !daily && openBar && <BucketNotes key={open} bar={openBar} notes={inBar(openBar)} onChanged={reload} onClose={() => setOpen(null)} />}
  </section>;
}

/** The notes inside one week, month or year bar, day by day. */
function BucketNotes({ bar, notes, onChanged, onClose }: { bar: Bucket; notes: AgendaNote[]; onChanged: () => void; onClose: () => void }) {
  const days = [...new Set(notes.map(n => n.day))];
  return <div className="day-notes bucket-notes" role="region" aria-label={`${bucketTitle(bar)} notları`}>
    <div className="day-notes-head"><h4>{bucketTitle(bar)}</h4><button type="button" className="text-btn" onClick={onClose}>Kapat</button></div>
    {!days.length ? <p className="muted small day-note-empty">Bu {bucketNoun[bar.kind]} için not yok.</p>
      : days.map(day => <DayNotes key={day} day={day} notes={notes.filter(n => n.day === day)} onChanged={onChanged} canAdd={false} />)}
  </div>;
}

/** "Bugün" has no bars: the day's note sits in its own small card. */
function TodayNote({ day }: { day: string }) {
  const { notes, reload } = useAgendaNotes(day, day);
  return <section className="panel daily-card day-note-card"><DayNotes day={day} notes={notes ?? []} onChanged={reload} /></section>;
}

/**
 * The notes of one day under the sales chart: the day's "Satış notu" (written here, one per day) and the day's Ajanda
 * notes. The same notes show in Ajanda, marked "Satış notu".
 */
function DayNotes({ day, notes, onChanged, onClose, canAdd = true }: { day: string; notes: AgendaNote[]; onChanged: () => void; onClose?: () => void; canAdd?: boolean }) {
  const [editing, setEditing] = useState<AgendaNote | 'new' | null>(null), [deleting, setDeleting] = useState<AgendaNote | null>(null);
  const sales = notes.find(n => n.kind === 'sales');
  return <div className="day-notes" role="region" aria-label={`${longDay(day)} notları`}>
    <div className="day-notes-head"><h4>{longDay(day)}</h4>{onClose && <button type="button" className="text-btn" onClick={onClose}>Kapat</button>}</div>
    {editing === 'new' && <NoteForm day={day} kind="sales" simple onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    {notes.length > 0 && <ul className="agenda-notes">{notes.map(n => editing !== null && editing !== 'new' && editing.id === n.id
      ? <li key={n.id} className="agenda-note editing"><NoteForm day={day} note={n} simple={n.kind === 'sales'} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} /></li>
      : <NoteCard key={n.id} note={n} onEdit={() => setEditing(n)} onDelete={() => setDeleting(n)} />)}</ul>}
    {canAdd && !sales && editing === null && <button type="button" className="btn secondary day-note-add" onClick={() => setEditing('new')}>Bu güne not yaz</button>}
    {canAdd && !notes.length && editing === null && <p className="muted small day-note-empty">Bu gün için not yok. Yazdığınız not Ajanda'da da görünür.</p>}
    {deleting && <DeleteNote note={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); onChanged(); }} />}
  </div>;
}

function HourHeat({ hours }: { hours: Overview['hourly'] }) {
  const [focus, setFocus] = useState<number | null>(null);
  // Opening hours only: a few orders after midnight must not stretch the strip to 00–24, so hours under 5% of the busiest are trimmed at the edges.
  // The business day runs 05:00–05:00: the hours are laid out from 05:00, so a night that goes past midnight stays one strip.
  const ordered = [...hours.slice(DAY_START_HOUR), ...hours.slice(0, DAY_START_HOUR)];
  const most = Math.max(0, ...ordered.map(h => h.orders)), busy = ordered.map((h, i) => [h, i] as const).filter(([h]) => h.orders > 0 && h.orders >= most * 0.05);
  if (!busy.length) return <section className="panel"><h3>Yoğun saatler</h3><p className="report-empty-note">Bu dönemde sipariş yok.</p></section>;
  const span = ordered.slice(busy[0][1], busy.at(-1)![1] + 1), first = span[0].hour, last = span.at(-1)!.hour;
  const top = Math.max(...span.map(h => h.orders)), peak = span.find(h => h.orders === top)!;
  const clock = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;
  return <section className="panel"><div className="report-section-heading"><h3>Yoğun saatler</h3><span className="muted small">En yoğun: {clock(peak.hour)}–{clock(peak.hour + 1)}</span></div>
    <div className="chart-area" onMouseLeave={() => setFocus(null)}>
      <div className="hour-heat" style={{ gridTemplateColumns: `repeat(${span.length}, 1fr)` }}>{span.map((h, i) => <button type="button" key={h.hour} className={focus === i ? 'focus' : ''} style={{ opacity: 0.12 + h.orders / top * 0.88 }} aria-label={`${clock(h.hour)}–${clock(h.hour + 1)}: ${h.orders} sipariş, ${money(h.sales)}`} onMouseEnter={() => setFocus(i)} onFocus={() => setFocus(i)} onBlur={() => setFocus(null)} onClick={() => setFocus(i)} />)}</div>
      {focus !== null && <Tip at={focus} count={span.length} bottom="50px" title={`${clock(span[focus].hour)}–${clock(span[focus].hour + 1)} · ${span[focus].orders} sipariş`} value={money(span[focus].sales)} />}
    </div>
    <div className="daily-axis muted small"><span>{clock(first)}</span><span>{clock(last + 1)}</span></div></section>;
}
function Products({ range }: { range: Range }) {
  const { data, error, loading } = useReport<ProductReport>(`/api/staff/reports/products?${query(range)}`);
  const [category, setCategory] = useState('');
  const categories = [...new Set(data?.products.map(p => p.category) ?? [])];
  const rows = (data?.products ?? []).filter(p => !category || p.category === category), top = Math.max(1, ...rows.map(p => p.amount));
  return <ReportState data={data} error={error} loading={loading}>{data && <section className="panel product-table">
    <div className="report-section-heading"><h3>Ürün satışları<HelpTip title="Ürün satışları">İptal edilen siparişler hariç. Tutarlar indirimler düşüldükten sonraki satış tutarıdır.</HelpTip></h3><span className="muted small">{soldTotal(rows)} · {money(rows.reduce((n, p) => n + p.amount, 0))}</span></div>
    {categories.length > 1 && <div className="period-pills category-pills" role="group" aria-label="Kategori"><button type="button" className={!category ? 'active' : ''} onClick={() => setCategory('')}>Tümü</button>{categories.map(c => <button type="button" key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div>}
    {!rows.length ? <p className="report-empty-note">Bu dönemde satılan ürün yok.</p> : <table><thead><tr><th>Ürün</th><th>{rows.some(p => p.unit === 'kg') ? 'Miktar' : 'Adet'}</th><th>Tutar</th><th className="share-col">Pay</th></tr></thead><tbody>{rows.map(p => <tr key={p.id}><th>{p.name}<small>{p.category}</small></th><td>{p.unit === 'kg' ? qtyText(p) : p.qty.toLocaleString('tr-TR')}</td><td>{money(p.amount)}</td><td className="share-col"><span className="share"><i style={{ width: `${p.amount / top * 100}%` }} /></span>%{Math.round(p.share * 100)}</td></tr>)}</tbody></table>}
  </section>}</ReportState>;
}
