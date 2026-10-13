import { PlaceLink } from './Moved';
import { LockedHint, openFeatureLock, usePackage } from './FeatureLock';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { BadgeCheck, ChevronDown, ChevronRight, FileSpreadsheet, Landmark, Printer, Receipt, Share2, ShoppingBag, TriangleAlert, Wallet } from 'lucide-react';
import { api, ApiError, money } from './api';
import { commissionShare, MAX_COMMISSION_BPS, shareText } from '../packages/domain/commission';
import type { ExpenseBreakdown } from '../packages/domain/reports';
import { SESSION_LOCK_EVENT } from './activity';
import { Modal, Notice } from './components';
import { formatReportDate, reportToday } from './ReportPeriod';
import { RefreshStatus } from './RefreshStatus';
import { yearOf, YearTable } from './ReportYears';
import './report-simple.css';

/*
 * Satış ve Raporlar, the plain way (owner's decision, 5 Ekim):
 *   SimpleSummary   the first screen: one sentence ("Bugün 142 sipariş, ₺8.540 satış — dünün aynı saatine göre %12 fazla.
 *                   En çok kazandıran: Latte (₺1.140). Kasada ₺2.310 nakit olmalı."), then only the numbers that matter. "Detaylı
 *                   göster" opens the full reports (remembered on this device, src/SalesReports.tsx).
 *   ReportTools     on every report: "Yazdır / PDF" (a clean A4 page of the open report, made by the café computer:
 *                   server/report-export.ts) and "Muhasebeci için indir" (one Excel file of a month or the period).
 *   VatPanel        "KDV dökümü" (packages/domain/vat.ts), information only.
 * Sentences and the printable page come from the server, so the screen, the printout and the e-mail say the same thing.
 */
export type Range = { from: string; to: string };
type VatRow = { rate: number; gross: number; base: number; vat: number };
/** "Gün sonu sayımı: ₺2.895 · Beklenen: −₺557 · Fark: +₺3.452" (owner only, one day): server/report-export.ts dayCounts. */
type DayCount = { time: string; byName: string; counted: number; expected: number; difference: number; cashSales: number; cashExpenses: number; opening: number; outsideExpenses?: number; extra?: boolean };
type Simple = { sentence: string; kasa: { tone: 'ok' | 'warn' | 'quiet'; text: string }; counts?: DayCount[]; vat: { rows: VatRow[]; total: VatRow } | null; vatNote: string; top: { name: string; qty: number; amount: number; kg?: number }[]; range: Range };
type Numbers = { sales: number; cash: number; card: number; platform?: number; expenses: number; posCommission: number; refunds: number; kept: number; orders: number; averageAccount: number; closedAccounts: number; unknownCommission?: { count: number; amount: number }; expenseParts?: ExpenseBreakdown };
const signed = (k: number) => k === 0 ? money(0) : `${k > 0 ? '+' : '−'}${money(Math.abs(k))}`;
const amountText = (k: number) => k < 0 ? `−${money(-k)}` : money(k);

/**
 * A card that opens a small breakdown: on hover (desktop), on a tap anywhere on the card (phone), and from its ⓘ button
 * (keyboard, screen readers: aria-expanded / aria-controls, Escape closes). The ⓘ/popover look of HelpTip.
 */
function TipCard({ className, label, title, tip, children }: { className: string; label: ReactNode; title: string; tip: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false), id = useId(), hover = useRef(false);
  // A click while the mouse holds it open pins it (it stays after the mouse leaves); otherwise a click opens or closes it.
  const toggle = () => { if (hover.current) { hover.current = false; setOpen(true); } else setOpen(o => !o); };
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target instanceof Element && e.target.closest(`[data-tip="${id}"]`))) setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open, id]);
  return <article className={`${className} simple-tip-card${open ? ' tip-open' : ''}`} data-tip={id}
    onPointerEnter={e => { if (e.pointerType !== 'mouse') return; hover.current = true; setOpen(true); }} onPointerLeave={e => { if (e.pointerType === 'mouse' && hover.current) { hover.current = false; setOpen(false); } }}
    onClick={e => { if (e.target instanceof Element && e.target.closest('.simple-tip-pop')) return; toggle(); }}>
    <span className="simple-label">{label}<button type="button" className="help-dot simple-tip-dot" aria-label={`${title}: dökümü göster`} aria-expanded={open} aria-controls={`${id}-pop`} onClick={e => { e.stopPropagation(); toggle(); }}>i</button></span>
    {children}
    {open && <div id={`${id}-pop`} className="simple-tip-pop" role="group" aria-label={title} data-testid="simple-tip-pop">{tip}</div>}
  </article>;
}
/** "Giderler nereden oluşuyor?": groups (Stok alışları ₺467, Diğer giderler ₺500) and, for a short list, each record. */
function ExpenseTip({ n }: { n: Numbers }) {
  const p = n.expenseParts;
  if (!p) return <p className="simple-tip-note">Bu dönemin giderleri: {money(n.expenses)}. Kayıtların listesi için bir yıl ya da daha kısa bir dönem seçin.</p>;
  if (!p.count) return <p className="simple-tip-note">Bu dönemde gider kaydı yok.</p>;
  return <>
    <dl className="simple-tip-rows">{p.groups.map(g => <div key={g.key}><dt>{g.label}<small>{g.count} kayıt</small></dt><dd>{money(g.amount)}</dd></div>)}
      <div className="simple-tip-total"><dt>Giderler</dt><dd>{money(n.expenses)}</dd></div></dl>
    {p.lines.length > 0 && <ul className="simple-tip-lines" aria-label="Gider kayıtları">{p.lines.map((l, i) => <li key={i}><span>{l.description}{l.method && <small>{l.method}</small>}</span><b>{money(l.amount)}</b></li>)}</ul>}
    {p.groups.some(g => g.key === 'stock') && <p className="simple-tip-note">Stok alışları alındığı gün gider sayılır (paranın çıktığı gün). Malzemenin satılan ürünlerdeki maliyeti Kârlılık'ta ayrıca görünür.</p>}
    {p.outside > 0 && <p className="simple-tip-note">{money(p.outside)} kasa dışından ödendi; kasadaki nakdi değiştirmez.</p>}
  </>;
}
/** Elde kalan, worked out: Satış − Giderler − İadeler − Kart komisyonu = … */
function KeptTip({ n }: { n: Numbers }) {
  const share = commissionShare(n.posCommission, n.card), stock = n.expenseParts?.groups.find(g => g.key === 'stock');
  return <>
    <dl className="simple-tip-rows simple-tip-sum">
      <div><dt>Satış</dt><dd>{money(n.sales)}</dd></div>
      <div><dt>− Giderler{stock && <small>stok alışları dahil</small>}</dt><dd>−{money(n.expenses)}</dd></div>
      <div><dt>− İadeler</dt><dd>−{money(n.refunds)}</dd></div>
      <div><dt>− Kart komisyonu{share !== null && n.posCommission > 0 && <small>kart satışına oranı {shareText(share)}</small>}</dt><dd>−{money(n.posCommission)}</dd></div>
      <div className="simple-tip-total"><dt>= Elde kalan</dt><dd>{amountText(n.kept)}</dd></div>
    </dl>
    {!!n.unknownCommission?.count && <p className="simple-tip-note">{n.unknownCommission.count} kart ödemesinin komisyonu bilinmiyor; elde kalan biraz daha düşük olabilir.</p>}
    <p className="simple-tip-note">Net kâr değildir: kira, maaş gibi Mola'ya girilmeyen giderler düşülmedi.</p>
  </>;
}
const q = (r: Range) => `from=${r.from}&to=${r.to}`;

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    api<T>(path).then(d => { if (live) setData(d); }).catch(e => { if (live) setError((e as Error).message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path]);
  return { data, error, loading };
}
/** The plain sentence of the period (also on top of the detailed Özet). */
export function useSimple(range: Range) { return useLoad<Simple>(`/api/staff/reports/simple?${q(range)}`); }

const qty = (p: Simple['top'][number]) => p.kg ? `${p.kg.toLocaleString('tr-TR')} kg` : `${p.qty.toLocaleString('tr-TR')} adet`;
export function SimpleSummary({ range, onDetail, onRange }: { range: Range; onDetail: () => void; onRange?: (r: Range) => void }) {
  const simple = useSimple(range), numbers = useLoad<Numbers>(`/api/staff/reports/overview?${q(range)}`);
  const s = simple.data, n = numbers.data, error = simple.error || numbers.error, owner = usePackage().owner;
  if (!s || !n) return error ? <Notice tone="error">{error}</Notice> : <p role="status" className="report-loading">Rapor yükleniyor…</p>;
  const split = [['Nakit', n.cash], ['Kart', n.card], ...(n.platform ? [['Platform', n.platform] as [string, number]] : [])] as [string, number][];
  const KasaIcon = s.kasa.tone === 'warn' ? TriangleAlert : s.kasa.tone === 'ok' ? BadgeCheck : Landmark;
  const share = commissionShare(n.posCommission, n.card), oddCommission = share !== null && share * 10_000 > MAX_COMMISSION_BPS;
  const stockAmount = n.expenseParts?.groups.find(g => g.key === 'stock')?.amount ?? 0;
  return <div className="simple-report" aria-label="Sade özet">
    {(simple.loading || numbers.loading) && <RefreshStatus />}
    {error && <Notice tone="error">{error} Önceki sonuçlar gösteriliyor.</Notice>}
    <p className="simple-sentence" data-testid="simple-sentence">{s.sentence}</p>
    <div className="simple-grid">
      <article className="simple-card simple-sales"><span className="simple-label"><Wallet size={16} aria-hidden="true" />Satış</span><strong>{money(n.sales)}</strong>
        <ul className="simple-split" aria-label="Ödeme türleri">{split.map(([k, v]) => <li key={k}><span>{k}</span><b>{money(v)}</b></li>)}</ul>
        {/* Prices include KDV (11 Ekim): the KDV inside the sales, refunds taken off; the full table is "KDV dökümü" in the details. */}
        {!!s.vat?.total.vat && <small className="simple-vat" data-testid="simple-vat">Bu satışın içindeki KDV: <b>{money(s.vat.total.vat)}</b>{n.refunds > 0 ? ' (iadeler düşülünce)' : ''}</small>}</article>
      <TipCard className="simple-card simple-expenses" title="Giderler" label={<><Receipt size={16} aria-hidden="true" /><span>Giderler</span></>} tip={<ExpenseTip n={n} />}><strong>{money(n.expenses)}</strong>
        <small>{stockAmount ? <>Stok alışları dahil (<b>{money(stockAmount)}</b>)</> : 'Kira, malzeme, fatura gibi kayıtlı ödemeler.'}</small><PlaceLink to={{ view: 'cash', tab: 'expenses', part: 'records' }}>Gider kayıtlarını aç</PlaceLink></TipCard>
      <TipCard className="simple-card simple-kept" title="Elde kalan" label={<><Landmark size={16} aria-hidden="true" /><span>Elde kalan{n.unknownCommission?.count ? ' (geçici)' : ''}</span></>} tip={<KeptTip n={n} />}><strong>{amountText(n.kept)}</strong>
        <small className="simple-formula">Elde kalan = satış − giderler − iadeler − kart komisyonu</small>
        {!!n.unknownCommission?.count && <small>Kart komisyonu oranı girilmediği için geçici; biraz daha düşük olabilir.</small>}
        {(n.refunds > 0 || n.posCommission > 0) && <small>{[n.refunds > 0 && `İadeler ${money(n.refunds)}`, n.posCommission > 0 && `Kart komisyonu ${money(n.posCommission)}${share !== null ? ` (kart satışına oranı ${shareText(share)})` : ''}`].filter(Boolean).join(' · ')}</small>}
        {oddCommission && <small className="simple-warn" role="note" data-testid="commission-warning">Kart komisyonunun kart satışına oranı {shareText(share!)}; bankaların oranı genelde %1–4. </small>}{oddCommission && owner && <PlaceLink to={{ view: 'cash', tab: 'settings', part: 'card' }}>POS oranını kontrol et</PlaceLink>}</TipCard>
      <article className="simple-card simple-small"><span className="simple-label"><ShoppingBag size={16} aria-hidden="true" />Sipariş</span><strong>{n.orders.toLocaleString('tr-TR')}</strong><small>Ortalama hesap <b>{money(n.averageAccount)}</b></small></article>
    </div>
    {range.from === 'all' && onRange && <YearTable onYear={onRange} />}
    <div className="simple-pair">
      <section className="simple-card simple-top" aria-label="En çok kazandıranlar"><h3>En çok kazandıran 3 ürün</h3>
        {s.top.length ? <ol>{s.top.map(p => <li key={p.name}><span className="simple-top-name">{p.name}</span><small>{qty(p)}</small><b>{money(p.amount)}</b></li>)}</ol> : <p className="muted small">Bu dönemde satılan ürün yok.</p>}</section>
      <section className={`simple-card simple-kasa tone-${s.kasa.tone}`} aria-label="Kasa durumu"><h3><KasaIcon size={17} aria-hidden="true" />Kasa durumu</h3><p>{s.kasa.text}</p>
        {s.counts?.map((c, i) => <div key={i} className="simple-count" data-testid="simple-count"><p><b>{c.extra ? 'Ek kapanış sayımı' : 'Gün sonu sayımı'}:</b> {money(c.counted)} · <b>Beklenen:</b> {amountText(c.expected)} · <b>Fark:</b> {signed(c.difference)}</p>
          <small data-testid="simple-count-formula" className="simple-count-formula">{/* Adds up on paper (8 Ekim denetimi): the cash refund was only named in brackets, so ₺500 + ₺535 − ₺30 read ₺1.005 against a "Beklenen ₺970". */}Beklenen = açılış {money(c.opening)} + nakit satış {money(c.cashSales)} − kasadan ödenen gider {money(c.cashExpenses)}{(() => { const rest = c.expected - (c.opening + c.cashSales - c.cashExpenses); return rest ? ` ${rest < 0 ? '−' : '+'} nakit iade, bahşiş ve sahibin hareketleri ${money(Math.abs(rest))}` : ''; })()} = {amountText(c.expected)}. Sayım yalnız kasadaki nakdi gösterir; Elde kalan kart dahil bütün satıştan hesaplanır.{c.outsideExpenses ? ` Kasa dışından ödenen ${money(c.outsideExpenses)} beklenene girmez.` : ''}</small></div>)}<PlaceLink to={{ view: 'cash', tab: 'closings' }}>Kasa kapanışları</PlaceLink></section>
    </div>
    <div className="simple-more"><button type="button" className="btn primary simple-detail-btn" onClick={onDetail}>Detaylı göster<ChevronRight size={17} aria-hidden="true" /></button><span className="muted small">Grafikler, ürünler, kârlılık, kampanyalar, çalışanlar ve rezervasyon raporları.</span></div>
  </div>;
}

/** "KDV dökümü": per rate, sales (KDV dahil), matrah and KDV; refunds already taken off. */
export function VatPanel({ range }: { range: Range }) {
  const { data, error } = useSimple(range);
  if (error) return null;
  if (!data) return null;
  const rows = data.vat?.rows ?? [];
  return <section className="panel vat-panel" aria-label="KDV dökümü"><div className="report-section-heading"><h3>KDV dökümü</h3><span className="muted small">Satıştan iadeler düşüldü; kalan, ürünlerin KDV oranına göre bölündü.</span></div>
    {!rows.length ? <p className="report-empty-note">Bu dönemde satış yok.</p> : <div className="vat-table-wrap"><table className="vat-table"><thead><tr><th>Oran</th><th>Satış (KDV dahil)</th><th>Matrah<small>KDV hariç tutar</small></th><th>KDV</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.rate}><th>%{r.rate}</th><td>{money(r.gross)}</td><td>{money(r.base)}</td><td>{money(r.vat)}</td></tr>)}</tbody>
      {rows.length > 1 && <tfoot><tr><th>Toplam</th><td>{money(data.vat!.total.gross)}</td><td>{money(data.vat!.total.base)}</td><td>{money(data.vat!.total.vat)}</td></tr></tfoot>}</table></div>}
    <p className="vat-note">{data.vatNote}</p>
  </section>;
}

// ---------- Yazdır / PDF and Muhasebeci için indir ----------
async function fail(r: Response) {
  let message = 'İşlem tamamlanamadı.', code = '';
  try { const j = await r.json() as { message?: string; code?: string }; message = j.message ?? message; code = j.code ?? ''; } catch { /* not JSON */ }
  // 423 is two things (like src/api.ts): the owner's idle lock (SESSION_LOCKED, the password screen over this page) or the
  // data key locked on the café computer (the "Veriler kilitli" screen).
  if (r.headers.get('X-Mola-Locked') === '1' || code === 'SESSION_LOCKED') window.dispatchEvent(new Event(SESSION_LOCK_EVENT));
  else if (r.status === 423) window.dispatchEvent(new Event('mola:locked'));
  return new ApiError(message, r.status, code);
}
/** Saves a file the server makes (PDF, Excel) under the name it gives. */
async function download(path: string, fallback: string) {
  const r = await fetch(path, { credentials: 'same-origin', signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw await fail(r);
  const blob = await r.blob(), name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? fallback;
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
}
const rangeText = (r: Range) => r.from === 'all' ? 'Tüm zamanlar' : yearOf(r) ? `${yearOf(r)} yılı${r.to.endsWith('-12-31') ? '' : ' (bugüne kadar)'}` : r.from === r.to ? formatReportDate(r.from) : `${formatReportDate(r.from)} – ${formatReportDate(r.to)}`;

/** One more line in the "Yazdır ve paylaş" menu (the owner's e-mail reports and phone). */
export type ReportAction = { id: string; icon: ReactNode; label: string; sub: string; locked?: boolean; onClick: () => void };
/**
 * 13 Ekim tanıtım ("tıkış tıkış"): Yazdır / PDF, Muhasebeci için indir and the owner's Raporları gönder / telefonda gör were
 * four buttons in two rows. Now one "Yazdır ve paylaş" button opens them as a short menu, each with what it does.
 */
export function ReportTools({ view, viewName, range, extra = [] }: { view: string; viewName: string; range: Range; extra?: ReportAction[] }) {
  const [open, setOpen] = useState<'print' | 'excel' | null>(null), [menu, setMenu] = useState(false), menuId = useId();
  // Hizmet paketi: without "Gelişmiş raporlar" both stay, faded with "Pakette yok", and open the package card.
  const locked = !usePackage().has('reports-advanced'), choose = (what: 'print' | 'excel') => { setMenu(false); if (locked) openFeatureLock('reports-advanced'); else setOpen(what); };
  useEffect(() => { if (!menu) return; const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target instanceof Element && e.target.closest('.report-share'))) setMenu(false); }; document.addEventListener('pointerdown', close); document.addEventListener('keydown', close); return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); }; }, [menu]);
  const items: ReportAction[] = [
    { id: 'print', icon: <Printer size={18} aria-hidden="true" />, label: 'Yazdır / PDF', sub: 'Bu ekranın A4 çıktısı ya da PDF dosyası', locked, onClick: () => choose('print') },
    { id: 'excel', icon: <FileSpreadsheet size={18} aria-hidden="true" />, label: 'Muhasebeci için indir', sub: 'Ay ya da dönemin Excel dosyası', locked, onClick: () => choose('excel') },
    ...extra.map(x => ({ ...x, onClick: () => { setMenu(false); x.onClick(); } })),
  ];
  return <div className="report-tools report-share" role="group" aria-label="Rapor dosyaları">
    <button type="button" className="btn secondary report-share-btn" aria-expanded={menu} aria-controls={menuId} onClick={() => setMenu(m => !m)}><Share2 size={16} aria-hidden="true" />Yazdır ve paylaş<ChevronDown size={15} aria-hidden="true" /></button>
    {menu && <div className="report-share-menu" id={menuId} role="menu">{items.map(x => <button key={x.id} type="button" role="menuitem" className={`report-share-item${x.locked ? ' locked' : ''}`} onClick={x.onClick}><span className="report-share-icon">{x.icon}</span><span><strong>{x.label}{x.locked && <LockedHint />}</strong><small>{x.sub}</small></span></button>)}</div>}
    {open === 'print' && <PrintPreview view={view} viewName={viewName} range={range} onClose={() => setOpen(null)} />}
    {open === 'excel' && <AccountantExport range={range} onClose={() => setOpen(null)} />}
  </div>;
}

function PrintPreview({ view, viewName, range, onClose }: { view: string; viewName: string; range: Range; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [note, setNote] = useState<{ tone: 'info' | 'success' | 'error'; text: string } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null), path = `view=${view}&${q(range)}`;
  useEffect(() => {
    let live = true;
    fetch(`/api/staff/reports/document?${path}`, { credentials: 'same-origin', signal: AbortSignal.timeout(30_000) })
      .then(async r => { if (!r.ok) throw await fail(r); const text = await r.text(); if (live) setHtml(text); })
      .catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [path]);
  function print() { const w = frame.current?.contentWindow; if (!w) return; w.focus(); w.print(); }
  async function pdf() {
    setBusy(true); setNote(null);
    try { const name = await download(`/api/staff/reports/document.pdf?${path}`, 'Mola-rapor.pdf'); setNote({ tone: 'success', text: `PDF indirildi: ${name}` }); }
    catch (e) { setNote(e instanceof ApiError && e.code === 'PDF_UNAVAILABLE' ? { tone: 'info', text: 'Bu bilgisayarda PDF hazırlanamadı. "Yazdır"a basın ve yazıcı olarak "PDF olarak kaydet"i seçin.' } : { tone: 'error', text: (e as Error).message }); }
    finally { setBusy(false); }
  }
  return <Modal title="Yazdır / PDF" wide className="print-preview-dialog" onClose={onClose}>
    <div className="modal-body print-preview">
      <p className="print-preview-lead"><b>{viewName}</b> · {rangeText(range)}. A4 kâğıda uygun, sayfa numaralı temiz sayfa; e-posta raporlarıyla aynı görünüm.</p>
      {error ? <Notice tone="error">{error}</Notice> : html ? <iframe ref={frame} className="print-frame" title="Yazdırılacak sayfa" sandbox="allow-same-origin allow-modals" srcDoc={html} /> : <p role="status" className="report-loading">Sayfa hazırlanıyor…</p>}
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <div className="modal-actions print-actions"><button type="button" className="btn secondary" onClick={onClose}>Kapat</button><button type="button" className="btn secondary" disabled={!html || busy} onClick={() => void pdf()}>{busy ? 'PDF hazırlanıyor…' : 'PDF indir'}</button><button type="button" className="btn primary" disabled={!html} onClick={print}><Printer size={16} aria-hidden="true" />Yazdır</button></div>
    </div>
  </Modal>;
}

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const monthRange = (month: string, today: string): Range => { const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10); return { from: `${month}-01`, to: last < today ? last : today }; };
const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const shiftMonth = (month: string, n: number) => { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
type Choice = 'this' | 'last' | 'month' | 'screen';
function AccountantExport({ range, onClose }: { range: Range; onClose: () => void }) {
  const today = reportToday(), thisMonth = today.slice(0, 7), lastMonth = shiftMonth(thisMonth, -1), early = Number(today.slice(8, 10)) <= 10;
  // Early in a month the accountant usually wants the month before, unless it sold nothing (a café opened this month, K-M):
  // then "Bu ay". The month before is asked once (one month of day summaries); meanwhile nothing is chosen yet.
  const [choice, setChoice] = useState<Choice | null>(early ? null : 'this'), [month, setMonth] = useState(lastMonth);
  useEffect(() => {
    if (!early) return;
    let live = true;
    api<{ sales: number; orders: number }>(`/api/staff/reports/overview?${q(monthRange(lastMonth, today))}`)
      .then(d => { if (live) setChoice(c => c ?? (d.sales || d.orders ? 'last' : 'this')); })
      .catch(() => { if (live) setChoice(c => c ?? 'last'); });
    return () => { live = false; };
  }, [early, lastMonth, today]);
  const [busy, setBusy] = useState(false), [note, setNote] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const screenOk = range.from === 'all' || (Date.parse(range.to) - Date.parse(range.from)) / 86400000 <= 365;
  const chosen: Range = choice === 'this' ? monthRange(thisMonth, today) : choice === 'last' ? monthRange(lastMonth, today) : choice === 'month' ? monthRange(month, today) : range;
  const valid = choice !== null && (choice !== 'month' || (/^\d{4}-\d{2}$/.test(month) && month <= thisMonth));
  async function save() {
    setBusy(true); setNote(null);
    try { const name = await download(`/api/staff/reports/accountant.xlsx?${q(chosen)}`, 'Mola-Muhasebe.xlsx'); setNote({ tone: 'success', text: `İndirildi: ${name}. Dosyayı muhasebecinize e-postayla gönderebilirsiniz.` }); }
    catch (e) { setNote({ tone: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  }
  const options: [Choice, string, string][] = [['this', 'Bu ay', `${monthName(thisMonth)} (bugüne kadar)`], ['last', 'Geçen ay', monthName(lastMonth)], ['month', 'Başka bir ay', 'Ayı aşağıdan seçin'], ...(screenOk ? [['screen', 'Ekrandaki dönem', rangeText(range)] as [Choice, string, string]] : [])];
  return <Modal title="Muhasebeci için indir" onClose={onClose} className="export-dialog">
    <div className="modal-body accountant-export">
      <p className="muted">Tek Excel dosyası: günlük satışlar, ödemeler (nakit, kart, platform), giderler, iadeler, kasa kapanışları, KDV dökümü ve ürün satışları. Tutarlar TL, günler iş günüdür (05:00–05:00).</p>
      <fieldset className="export-choices"><legend>Hangi dönem?</legend>
        {options.map(([id, label, detail]) => <label key={id} className={`export-choice${choice === id ? ' active' : ''}`}><input type="radio" name="export-period" value={id} checked={choice === id} onChange={() => { setChoice(id); setNote(null); }} /><span><b>{label}</b><small>{detail}</small></span></label>)}
      </fieldset>
      {choice === 'month' && <label className="export-month">Ay<input type="month" value={month} max={thisMonth} onChange={e => { setMonth(e.target.value); setNote(null); }} /></label>}
      {choice === 'screen' && chosen.from === 'all' && <p className="muted small">Tüm zamanlar: yıllar, her yılın ayları, günlük satışlar, yıllara göre KDV ve ürünler. Gider, iade ve kasa kapanışlarının tek tek listesi için dönem olarak bir yıl seçin.</p>}
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Kapat</button><button type="button" className="btn primary" disabled={busy || !valid} onClick={() => void save()}><FileSpreadsheet size={16} aria-hidden="true" />{busy ? 'Hazırlanıyor…' : 'Excel dosyasını indir'}</button></div>
    </div>
  </Modal>;
}
