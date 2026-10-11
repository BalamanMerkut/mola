import { useEffect, useId, useState } from 'react';
import { ChevronDown, Clock3, CreditCard, TriangleAlert, UserRound, Wallet } from 'lucide-react';
import { movementNames, tipRuleNames, type BlindClosing, type CashClosing, type CashCorrection, type CashOpening, type CloserSummary } from '../packages/domain/cash';
import { autoEnded, hoursText, type Shift } from '../packages/domain/shifts';
import type { Range } from './SalesReports';
import { api, money, moneyError, parseAdjustment, requestId } from './api';
import { Modal, Notice } from './components';
import { HelpTip } from './HelpTip';
import { RefreshStatus } from './RefreshStatus';
import { CardLines, clock, diffTone, ExpectedLines, NegativeExpected, longDayAnyYear, RefundLines, signedMoney, SlipButtons } from './CashClosing';
import './cash-shifts.css';
import { useViewerRole } from './viewerRole';
// "Yazar kasa karşılaştırması" kept with each closing (read only here): src/FiscalHelper.tsx.
import { FiscalClosingSection } from './FiscalHelper';
import { DateTimeField } from './TimeField';

/*
 * Kasa ve giderler → "Kapanışlar" (server/cash-closing.ts) and Personel → "Vardiya ve bahşiş" (server/shifts.ts; sub-tabs
 * Vardiyalar · Bahşiş), with the period chosen above them like every report.
 */
type ClosingRow = CashClosing & { corrections: CashCorrection[]; corrected: number };
/** `closings`: the newest page (`limit`), `closingCount` how many the period has; totals and people count every one. */
type ClosingReport = { blind?: true; business: string; printing: boolean; closings: ClosingRow[]; closingCount?: number; openings: CashOpening[]; people: CloserSummary[]; totals: { count: number; difference: number; short: number; over: number; cashSales: number; cardDifference: number } };

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    api<T>(path).then(d => { if (live) setData(d); }).catch(e => { if (live) setError((e as Error).message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, version]);
  return { data, error, loading, reload: () => setVersion(v => v + 1) };
}
function State({ data, error, loading }: { data: unknown; error: string; loading: boolean }) {
  return <>{loading && !!data && <RefreshStatus />}{error && <Notice tone="error">{error}{!!data && ' Önceki sonuçlar gösteriliyor.'}</Notice>}{!data && !error && <p role="status" className="report-loading">Rapor yükleniyor…</p>}</>;
}

/** Kasa kapanışları lists this many cards at first, and this many more with every "Daha eski kapanışlar". */
const CLOSING_PAGE = 62;
export function CashClosingsReport({ range }: { range: Range }) {
  // The newest closings first, more on request: the server sends a page (five years are 1 800 closings), the totals and
  // the people count every closing (monthly roll-ups, server/cash-closing.ts).
  const [page, setPage] = useState({ key: `${range.from}:${range.to}`, shown: CLOSING_PAGE });
  const shown = page.key === `${range.from}:${range.to}` ? page.shown : CLOSING_PAGE;
  const { data, error, loading, reload } = useLoad<ClosingReport>(`/api/staff/reports/cash-closings?from=${range.from}&to=${range.to}&limit=${shown}`);
  // Asked once for the whole list: every card asking for itself sent one request per closing (1 800 for five years).
  const [open, setOpen] = useState<string | null>(null), owner = useViewerRole() === 'owner';
  const setShown = (more: (n: number) => number) => setPage({ key: `${range.from}:${range.to}`, shown: more(shown) });
  const total = data?.closingCount ?? data?.closings.length ?? 0;
  const openingDiffs = data?.openings.filter(o => o.difference !== 0) ?? [];
  // K1: the Müdür's copy is blind (server/cash-closing.ts): who closed, when and what was counted, nothing to compare with.
  if (data?.blind) return <>
    <State data={data} error={error} loading={loading} />
    <div className="kpi-row cash-kpis"><article className="kpi"><span>Kapanış</span><strong>{data.totals.count}</strong><small>Gün sonu ve vardiya devri</small></article></div>
    <p className="muted small" data-testid="blind-closings">Beklenen nakit ve fark yalnız işletme sahibinde görünür.</p>
    {!data.closings.length ? <section className="panel"><p className="report-empty-note">Bu dönemde kasa kapanışı yok.</p></section>
      : <div className="cash-closing-list">{(data.closings as unknown as BlindClosing[]).slice(0, shown).map(c => <article key={c.id} className="panel cash-closing-card"><div className="cash-closing-head"><div className="cash-closing-title"><strong>{longDayAnyYear(c.day)}</strong><small>{c.mode === 'final' ? (c.extra ? 'Gün sonu · ek kapanış' : 'Gün sonu') : 'Vardiya devri'} · {clock(c.to)} · {c.byName}{c.status === 'counted' ? ' · tamamlanmadı' : ''}</small></div><dl className="cash-closing-figures"><div><dt>Sayılan</dt><dd>{money(c.counted)}</dd></div><div><dt>Fark</dt><dd>—</dd></div></dl></div>{c.note && <p className="cash-closing-note"><strong>Not:</strong> {c.note}</p>}</article>)}</div>}
    {total > Math.min(shown, data.closings.length) && <button type="button" className="btn secondary cash-closing-more" disabled={loading} onClick={() => setShown(n => n + CLOSING_PAGE)}>{loading ? 'Yükleniyor…' : `Daha eski kapanışlar (${total - Math.min(shown, data.closings.length)})`}</button>}
  </>;
  return <>
    <State data={data} error={error} loading={loading} />
    {data && <>
      <div className="kpi-row cash-kpis">
        <article className="kpi"><span>Kapanış</span><strong>{data.totals.count}</strong><small>Gün sonu ve vardiya devri</small></article>
        <article className={`kpi cash-kpi ${diffTone(data.totals.difference)}`}><span>Toplam fark<HelpTip title="Toplam fark">Sayılan nakit − beklenen nakit, düzeltmelerle birlikte. Eksi işaret kasanın eksik çıktığını gösterir.</HelpTip></span><strong>{signedMoney(data.totals.difference)}</strong><small>Eksik {money(data.totals.short)} · Fazla {money(data.totals.over)}</small></article>
        <article className="kpi"><span>Kart farkı<HelpTip title="Kart farkı">Banka POS gün sonu toplamı − Mola'daki kart satışları ve kart bahşişleri. POS toplamı girilmeyen kapanışlar sayılmaz.</HelpTip></span><strong>{signedMoney(data.totals.cardDifference)}</strong><small>Nakit satış {money(data.totals.cashSales)}</small></article>
      </div>
      {data.people.length > 0 && <section className="panel product-table cash-people" aria-label="Kişilere göre farklar"><div className="report-section-heading"><h3>Kişilere göre farklar<HelpTip title="Kişilere göre">Her kapanışı sayan kişiye göre. Sık tekrarlanan küçük eksikler de burada görünür.</HelpTip></h3><span className="muted small">Düzeltmeler dahil</span></div>
        <table><thead><tr><th>Sayan</th><th>Kapanış</th><th>Eksik</th><th>Fazla</th><th className="cash-trend-col">Gidişat</th><th>Toplam</th></tr></thead><tbody>{data.people.map(p => <tr key={p.by}><th>{p.byName}<small>{p.shortCount ? `${p.shortCount} kez eksik · en büyük ${money(p.largestShort)}` : 'Eksik yok'}</small></th><td>{p.count}</td><td className="cash-short">{p.short ? `−${money(p.short)}` : '—'}</td><td className="cash-over">{p.over ? `+${money(p.over)}` : '—'}</td><td className="cash-trend-col"><Trend rows={data.closings.filter(c => c.by === p.by && c.status === 'closed')} /></td><td><span className={`cash-badge ${diffTone(p.total)}`}>{signedMoney(p.total)}</span></td></tr>)}</tbody></table>
      </section>}
      {openingDiffs.length > 0 && <section className="panel cash-openings" aria-label="Açılış farkları"><div className="report-section-heading"><h3>Açılış farkları</h3></div><ul>{openingDiffs.map(o => <li key={o.id}><span>{longDayAnyYear(o.day)} · {clock(o.at)}</span><strong className={`cash-diff-text ${diffTone(o.difference)}`}>{signedMoney(o.difference)}</strong><small>{o.byName} · devreden {money(o.carried ?? 0)}, sayılan {money(o.amount)}{o.note ? ` · ${o.note}` : ''}</small></li>)}</ul></section>}
      {!data.closings.length ? <section className="panel"><p className="report-empty-note">Bu dönemde kasa kapanışı yok. Kasiyer ya da siz Masalar ekranındaki “Gün sonu” ile kasayı kapattığınızda burada görünür.</p></section>
        : <><div className="cash-closing-list">{data.closings.slice(0, shown).map(c => <ClosingCard key={c.id} c={c} owner={owner} open={open === c.id} onToggle={() => setOpen(o => o === c.id ? null : c.id)} business={data.business} printing={data.printing} onCorrected={reload} />)}</div>
          {total > Math.min(shown, data.closings.length) && <button type="button" className="btn secondary cash-closing-more" disabled={loading} onClick={() => setShown(n => n + CLOSING_PAGE)}>{loading ? 'Yükleniyor…' : `Daha eski kapanışlar (${total - Math.min(shown, data.closings.length)})`}</button>}</>}
    </>}
  </>;
}

/** One person's last closings, oldest first: a bar above the line for "fazla", below for "eksik" (patterns over time). */
function Trend({ rows }: { rows: ClosingRow[] }) {
  const last = [...rows].sort((a, b) => a.to.localeCompare(b.to)).slice(-14), top = Math.max(1, ...last.map(r => Math.abs(r.corrected)));
  return <span className="cash-trend" role="img" aria-label={`Son ${last.length} kapanış: ${last.map(r => signedMoney(r.corrected)).join(', ')}`}>{last.map(r => <i key={r.id} className={diffTone(r.corrected)} title={`${longDayAnyYear(r.day)}: ${signedMoney(r.corrected)}`} style={{ height: `${r.corrected === 0 ? 2 : Math.max(3, Math.abs(r.corrected) / top * 13)}px` }} />)}</span>;
}

function ClosingCard({ c, owner, open, onToggle, business, printing, onCorrected }: { c: ClosingRow; owner: boolean; open: boolean; onToggle: () => void; business: string; printing: boolean; onCorrected: () => void }) {
  // The Müdür reads closings; adding a correction stays with the owner (POST /api/staff/cash/corrections).
  const [correcting, setCorrecting] = useState(false), id = useId();
  return <article className={`panel cash-closing-card ${open ? 'open' : ''}`}>
    <button type="button" className="cash-closing-head" aria-expanded={open} aria-controls={`${id}-details`} onClick={onToggle}>
      <div className="cash-closing-title"><strong>{longDayAnyYear(c.day)}</strong><small>{c.mode === 'final' ? (c.extra ? 'Gün sonu · ek kapanış' : 'Gün sonu') : 'Vardiya devri'} · {clock(c.to)} · {c.byName}{c.status === 'counted' ? ' · tamamlanmadı' : ''}</small></div>
      <dl className="cash-closing-figures"><div><dt>Açılış</dt><dd>{money(c.figures.opening)}</dd></div><div><dt>Beklenen</dt><dd>{c.figures.expected < 0 ? signedMoney(c.figures.expected) : money(c.figures.expected)}</dd></div><div><dt>Sayılan</dt><dd>{money(c.counted)}</dd></div></dl>
      <span className={`cash-badge ${diffTone(c.corrected)}`}>{c.corrected === 0 ? 'Fark yok' : signedMoney(c.corrected)}</span>
      <ChevronDown size={18} aria-hidden="true" className="cash-chevron" />
    </button>
    {c.note && <p className="cash-closing-note"><strong>Not:</strong> {c.note}</p>}
    {!!c.fiscalZ?.difference && <p className="cash-closing-note"><strong>Yazar kasa:</strong> Z raporu farkı {signedMoney(c.fiscalZ.difference)}</p>}
    {open && <div id={`${id}-details`} className="cash-closing-details">
      <div className="cash-result-grid">
        <section aria-label="Kasa"><h3><Wallet size={16} aria-hidden="true" />Kasa · {c.difference ? `sayım farkı ${signedMoney(c.difference)}` : 'fark yok'}</h3><ExpectedLines f={c.figures} /><NegativeExpected f={c.figures} />
          <dl className="cash-lines"><div><dt>Sayılan nakit</dt><dd>{money(c.counted)}</dd></div>{c.mode === 'final' && <div><dt>Kasada bırakılan</dt><dd>{money(c.left ?? c.counted)}</dd></div>}{!!c.taken && <div><dt>Kapanışta çıkarılan</dt><dd>{money(c.taken)}</dd></div>}{c.unconfirmedOpening && <div className="cash-lines-quiet"><dt>Açılış onaylanmamıştı<small>Devreden tutar kullanıldı</small></dt><dd /></div>}</dl></section>
        <section aria-label="Kart ve platform"><h3><CreditCard size={16} aria-hidden="true" />Kart ve platform</h3><CardLines c={c} /></section>
      </div>
      {c.movements.length > 0 && <section className="cash-detail-list"><h4>Kasa hareketleri</h4><ul>{c.movements.map(m => <li key={m.id}><span>{clock(m.at)}</span><strong>{movementNames[m.type]}</strong><span>{money(m.amount)}</span><small>{m.byName}{m.note ? ` · ${m.note}` : ''}</small></li>)}</ul></section>}
      <RefundLines refunds={c.refunds} />
      {c.fiscal && <FiscalClosingSection fiscal={c.fiscal} z={c.fiscalZ} final={c.mode === 'final'} />}
      {c.expenses.length > 0 && <section className="cash-detail-list"><h4>Nakit giderler</h4><ul>{c.expenses.map(e => <li key={e.id}><span>{clock(e.at)}</span><strong>{e.description}</strong><span>{money(e.amount)}</span><small>{e.byName}</small></li>)}</ul></section>}
      <section className="cash-detail-list"><h4>Düzeltmeler</h4>{c.corrections.length ? <ul>{c.corrections.map(x => <li key={x.id}><span>{clock(x.at)}</span><strong>{signedMoney(x.amount)}</strong><span>{x.byName}</span><small>{x.note}</small></li>)}</ul> : <p className="muted small">Kayıt değiştirilemez; bir şey sonradan bulunursa düzeltme ekleyin.</p>}
        {c.status === 'closed' && owner && <button type="button" className="btn secondary small-btn" onClick={() => setCorrecting(true)}>Düzeltme ekle</button>}</section>
      {c.status === 'closed' && <SlipButtons closing={c} corrections={c.corrections} business={business} printing={printing} />}
    </div>}
    {correcting && <CorrectionDialog closing={c} onClose={() => setCorrecting(false)} onSaved={() => { setCorrecting(false); onCorrected(); }} />}
  </article>;
}
function CorrectionDialog({ closing, onClose, onSaved }: { closing: ClosingRow; onClose: () => void; onSaved: () => void }) {
  const id = useId(), [amount, setAmount] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [request] = useState(requestId);
  const value = parseAdjustment(amount);
  async function save() { setBusy(true); setError(''); try { await api('/api/staff/cash/corrections', { requestId: request, closingId: closing.id, amount: value, note }); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Modal title="Kapanışa düzeltme ekle" onClose={() => { if (!busy) onClose(); }}><form className="modal-body" onSubmit={e => { e.preventDefault(); void save(); }}>
    <p className="muted">Kapanış kaydı değişmez; düzeltme ayrı bir satır olarak eklenir ve işlem kaydına yazılır. Bulunan para için artı (ör. +50), sonradan fark edilen eksik için eksi (ör. -20) yazın.</p>
    <label htmlFor={`${id}-amount`}>Fark düzeltmesi (TL) *<input id={`${id}-amount`} aria-label="Düzeltme tutarı" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="+50 ya da -20" aria-invalid={!!amount.trim() && !Number.isFinite(value)} required />{!!amount.trim() && !Number.isFinite(value) && <small className="field-error" role="alert">{moneyError(amount.trim().replace(/^[+-]/, ''))}</small>}</label>
    <label htmlFor={`${id}-note`}>Neden *<textarea id={`${id}-note`} aria-label="Düzeltme nedeni" value={note} maxLength={500} onChange={e => setNote(e.target.value)} required /></label>
    {Number.isFinite(value) && <p>Düzeltilmiş fark: <strong>{signedMoney(closing.corrected + value)}</strong></p>}
    {error && <Notice tone="error">{error}</Notice>}
    {Number.isFinite(value) && note.trim().length < 3 && <p className="muted small" role="status">Düzeltmenin nedenini yazın (en az 3 harf).</p>}
    <button className="btn primary full" disabled={busy || !Number.isFinite(value) || note.trim().length < 3}>{busy ? 'Kaydediliyor…' : 'Düzeltmeyi kaydet'}</button>
  </form></Modal>;
}

type StaffRow = { id: string; name: string; role: string; active: boolean; shifts: (Shift & { minutes: number; late: number | null })[]; shiftCount?: number; minutes: number; estimatedMinutes: number; days: number; lateCount: number; lateTotal: number; orders: number; items: number; sales: number; perHour: number | null; tips: number };
/** `listFrom`: a period of closed months (a year, "Tümü") lists the shifts from this day on; the hours count every one. */
type StaffReport = { tracking: boolean; tipRule: keyof typeof tipRuleNames; tips: { total: number; cash: number; card: number; unassigned: number }; rows: StaffRow[]; listFrom?: string };
const roleNames: Record<string, string> = { manager: 'Müdür', cashier: 'Kasiyer', waiter: 'Garson', kitchen: 'Mutfak', eski: 'Eski hesap' };
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' });

/** part: Personel → Vardiya ve bahşiş's sub-tab (Vardiyalar: hours, lateness, corrections; Bahşiş: the tips and each one's share). */
export function StaffShiftsReport({ range, part }: { range: Range; part?: 'shifts' | 'tips' }) {
  const tips = part !== 'shifts', shifts = part !== 'tips';
  const { data, error, loading, reload } = useLoad<StaffReport>(`/api/staff/reports/staff-shifts?from=${range.from}&to=${range.to}`);
  const [open, setOpen] = useState<string | null>(null), [editing, setEditing] = useState<StaffRow['shifts'][number] | null>(null);
  // Shift times are corrected by the owner only; the Müdür reads them.
  const owner = useViewerRole() === 'owner';
  const rows = data?.rows.filter(r => r.minutes || r.orders || r.tips || r.shifts.length || r.active) ?? [];
  const best = Math.max(1, ...rows.map(r => r.perHour ?? 0));
  return <>
    <State data={data} error={error} loading={loading} />
    {data && <>
      <div className="kpi-row cash-kpis">
        {tips && <><article className="kpi"><span>Bahşiş<HelpTip title="Bahşiş">Ödeme alırken yazılan bahşişler. Satışa ve elde kalan tutara girmez; nakit bahşiş gün sonunda kasada ayrı satırda görünür.</HelpTip></span><strong>{money(data.tips.total)}</strong><small>Nakit {money(data.tips.cash)} · Kart {money(data.tips.card)}</small></article>
        <article className="kpi"><span>Dağıtım</span><strong className="cash-kpi-text">{tipRuleNames[data.tipRule]}</strong><small>{data.tips.unassigned ? `${money(data.tips.unassigned)} dağıtılamadı (o gün çalışan yok)` : 'Personel ayarları → Bahşiş'}</small></article></>}
        {shifts && <article className="kpi"><span>Çalışılan süre</span><strong>{hoursText(rows.reduce((n, r) => n + r.minutes, 0))}</strong><small>{data.tracking ? 'Vardiya kayıtlarından' : 'Tahmini: ilk ve son işleme göre'}</small></article>}
      </div>
      {shifts && !data.tracking && <Notice>Vardiya takibi kapalı: saatler her çalışanın günün ilk ve son işlemine göre <strong>tahmini</strong> hesaplanır. Açmak için Personel → Personel ayarları → Vardiya.</Notice>}
      {!shifts && <section className="panel product-table staff-tips-table" aria-label="Bahşiş payları"><div className="report-section-heading"><h3>Bahşiş payları<HelpTip title="Bahşiş payları">Her çalışanın payı Personel ayarları → Bahşiş'teki dağıtıma göre hesaplanır. Bahşiş satışa ve elde kalan tutara girmez.</HelpTip></h3><span className="muted small">{tipRuleNames[data.tipRule]}</span></div>
        {!rows.some(r => r.tips) ? <p className="report-empty-note">Bu dönemde bahşiş yok.</p> : <table><thead><tr><th>Çalışan</th><th>Bahşiş payı</th></tr></thead><tbody>{rows.filter(r => r.tips).map(r => <tr key={r.id}><th>{r.name}<small>{roleNames[r.role] ?? r.role}</small></th><td>{money(r.tips)}</td></tr>)}</tbody></table>}
      </section>}
      {shifts && <section className="panel product-table staff-table" aria-label="Personel"><div className="report-section-heading"><h3>Personel verimliliği<HelpTip title="Saat başı satış">Çalışanın aldığı siparişlerin tutarı ÷ çalışılan saat. Kasiyer ve mutfak sipariş almadığında satış görünmez; bu bir başarı sıralaması değil, yoğunluğu görmek içindir.</HelpTip></h3><span className="muted small">Saat başı satışa göre</span></div>
        {!rows.length ? <p className="report-empty-note">Bu dönemde çalışan kaydı yok.</p> : <table><thead><tr><th>Çalışan</th><th>Süre</th><th>Sipariş</th><th>Satış</th><th>Saat başı</th><th>Bahşiş</th></tr></thead>
          <tbody>{rows.map(r => <StaffLine key={r.id} r={r} best={best} open={open === r.id} onToggle={() => setOpen(o => o === r.id ? null : r.id)} onEdit={owner ? setEditing : undefined} listFrom={data.listFrom} />)}</tbody></table>}
      </section>}
    </>}
    {editing && <ShiftCorrection shift={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
  </>;
}
function StaffLine({ r, best, open, onToggle, onEdit, listFrom }: { r: StaffRow; best: number; open: boolean; onToggle: () => void; onEdit?: (s: StaffRow['shifts'][number]) => void; listFrom?: string }) {
  const estimated = r.estimatedMinutes > 0 && r.estimatedMinutes === r.minutes, count = r.shiftCount ?? r.shifts.length;
  return <>
    <tr className="staff-line">
      <th><button type="button" className="staff-name" aria-expanded={open} onClick={onToggle}><UserRound size={15} aria-hidden="true" />{r.name}<ChevronDown size={15} aria-hidden="true" className="cash-chevron" /></button><small>{roleNames[r.role] ?? r.role}{r.lateCount ? ` · ${r.lateCount} kez geç (${r.lateTotal} dk)` : ''}{count ? ` · ${count.toLocaleString('tr-TR')} vardiya` : ''}</small></th>
      <td>{r.minutes ? hoursText(r.minutes) : '—'}{(estimated || (r.estimatedMinutes > 0 && r.minutes > 0)) && <span className="estimate-tag" title="İlk ve son işleme göre">tahmini</span>}</td>
      <td>{r.orders.toLocaleString('tr-TR')}</td><td>{money(r.sales)}</td>
      <td>{r.perHour === null ? '—' : <span className="per-hour"><i style={{ width: `${(r.perHour / best) * 100}%` }} aria-hidden="true" />{money(r.perHour)}</span>}</td>
      <td>{r.tips ? money(r.tips) : '—'}</td>
    </tr>
    {open && <tr className="staff-shifts"><td colSpan={6}>{!r.shifts.length ? <p className="muted small">{listFrom && count ? `${shortDay(listFrom)} gününden beri vardiya kaydı yok; bu dönemde toplam ${count.toLocaleString('tr-TR')} vardiya var. Listelemek için dönem olarak bir ay ya da tarih seçin.` : `Bu dönemde vardiya kaydı yok${r.minutes ? '; süre ilk ve son işleme göre tahmini' : ''}.`}</p>
      : <ul>{r.shifts.map(s => <li key={s.id}><Clock3 size={14} aria-hidden="true" /><span>{shortDay(s.day)}</span><strong>{clock(s.startAt)}–{s.endAt ? clock(s.endAt) : 'sürüyor'}</strong><span>{hoursText(s.minutes)}</span>
        {(s.late ?? 0) > 0 && <span className="late-tag"><TriangleAlert size={12} aria-hidden="true" />{s.late} dk geç</span>}
        {autoEnded(s) && <span className="auto-tag">Kapanışta kendiliğinden bitti</span>}
        {!!s.changes?.length && <span className="auto-tag" title={s.changes.map(c => `${c.by}: önceki ${clock(c.before.startAt)}–${c.before.endAt ? clock(c.before.endAt) : '—'} · ${c.note}`).join('\n')}>Düzeltildi</span>}
        {onEdit && <button type="button" className="text-btn" aria-label={`${r.name} ${shortDay(s.day)} vardiyasını düzelt`} onClick={() => onEdit(s)}>Düzelt</button>}</li>)}</ul>}
      {!!r.shifts.length && count > r.shifts.length && <p className="muted small">{listFrom ? `${shortDay(listFrom)} gününden bu yana ${r.shifts.length} vardiya gösteriliyor` : `Son ${r.shifts.length} vardiya gösteriliyor`}; bu dönemde toplam {count.toLocaleString('tr-TR')} vardiya var. Daha eskiler için dönemi daraltın.</p>}</td></tr>}
  </>;
}
const localInput = (iso?: string) => iso ? new Date(Date.parse(iso) + 3 * 3600_000).toISOString().slice(0, 16) : '';
const fromLocal = (v: string) => new Date(`${v}:00+03:00`).toISOString();
function ShiftCorrection({ shift, onClose, onSaved }: { shift: Shift; onClose: () => void; onSaved: () => void }) {
  const id = useId(), [start, setStart] = useState(localInput(shift.startAt)), [end, setEnd] = useState(localInput(shift.endAt)), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() { setBusy(true); setError(''); try { await api('/api/staff/shifts/correct', { id: shift.id, startAt: fromLocal(start), endAt: end ? fromLocal(end) : null, note }); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Modal title={`${shift.name} · vardiyayı düzelt`} onClose={() => { if (!busy) onClose(); }}><form className="modal-body" onSubmit={e => { e.preventDefault(); void save(); }}>
    <p className="muted">Önceki saatler vardiyanın kaydında ve işlem geçmişinde kalır.</p>
    <div className="form-columns"><label htmlFor={`${id}-start`}>Başlangıç<DateTimeField id={`${id}-start`} label="Başlangıç" value={start} onChange={setStart} required /></label><label htmlFor={`${id}-end`}>Bitiş<DateTimeField id={`${id}-end`} label="Bitiş" value={end} onChange={setEnd} /></label></div>
    <label htmlFor={`${id}-note`}>Neden *<input id={`${id}-note`} value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="Örn. Kod ekranı kapalıydı, 09:00'da geldi" required /></label>
    {error && <Notice tone="error">{error}</Notice>}
    <button className="btn primary full" disabled={busy || !start || note.trim().length < 3}>{busy ? 'Kaydediliyor…' : 'Düzeltmeyi kaydet'}</button>
  </form></Modal>;
}
