import { useEffect, useRef, useState } from 'react';
import type { LedgerFilter, LedgerRow, PaymentDetail, PaymentLedgerPage } from '../packages/domain/payment-history';
import { DateField } from './DateField';
import { RefreshStatus } from './RefreshStatus';
import { formatReportDate, reportToday } from './ReportPeriod';
import { api, money, requestId as newRequestId } from './api';
import { Notice } from './components';
import { HelpTip } from './HelpTip';
import { LineNote } from './LineFields';
import { formatWeight } from '../packages/domain/lines';
import type { RefundRequest } from '../packages/domain/payment-adjustments';
import { RefundForm, type RefundStart } from './RefundForm';
import './payment-ledger.css';
import './refunds.css';

// İade ve düzeltme: one statement of payments, newest first, over any period. The server filters and pages (50 rows a
// step); a long search may answer in slices, which are shown as they come. Totals of periods over 31 days are counted
// by a second request.
const PAGE = 50, MAX_ROWS = 500;
const FILTERS: [LedgerFilter, string][] = [['all', 'Tümü'], ['cash', 'Nakit'], ['card', 'Kart'], ['corrected', 'Düzeltilenler']];
/** [id, pill, header label, days ending today; null = all time]. */
const PERIODS: [string, string, string, number | null][] = [['today', 'Bugün', 'Bugün', 1], ['7', '7 gün', 'Son 7 gün', 7], ['30', '30 gün', 'Son 30 gün', 30], ['365', '1 yıl', 'Son 1 yıl', 365], ['all', 'Tümü', 'Tüm zamanlar', null]];
const shift = (day: string, days: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const periodRange = (days: number | null, today: string) => days === null ? { from: 'all', to: 'all' } : { from: shift(today, 1 - days), to: today };
const zone = { timeZone: 'Europe/Istanbul' } as const;
const clock = (at: string) => new Date(at).toLocaleTimeString('tr-TR', { ...zone, hour: '2-digit', minute: '2-digit' });
const dateTime = (at: string) => new Date(at).toLocaleString('tr-TR', { ...zone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const year = (at: string | Date) => new Date(at).toLocaleDateString('tr-TR', { ...zone, year: 'numeric' });
/** "3 Eki"; rows of another year carry it ("3 Eki 2025"), which matters once a period spans years. */
const shortDate = (at: string) => new Date(at).toLocaleDateString('tr-TR', { ...zone, day: 'numeric', month: 'short', ...(year(at) === year(new Date()) ? {} : { year: 'numeric' }) });
const methodName = (m: 'cash' | 'card' | 'platform') => m === 'cash' ? 'Nakit' : m === 'platform' ? 'Platform ödemesi' : 'Kart';
/** "2 ×" for pieces, "500 g" for a weighed line ("2 × 500 g" when equal weighed lines were merged). */
const itemAmount = (item: PaymentDetail['items'][number]) => item.grams ? `${item.quantity > 1 ? `${item.quantity} × ` : ''}${formatWeight(item.grams)}` : `${item.quantity} ×`;
type Query = { from: string; to: string; filter: LedgerFilter; q: string; limit: number; revision: number };

/** Small labels on a corrected row; the full story (reasons, who, when) is in the row's details. */
function badges(row: LedgerRow) {
  const out: string[] = [];
  if (row.refunded > 0) out.push(row.refundable === 0 ? 'Tamamı iade edildi' : `Kısmi iade ${money(row.refunded)}`);
  const method = row.corrections.filter(c => c.kind === 'method').at(-1);
  if (method) out.push(method.method === 'card' ? 'Karta çevrildi' : 'Nakde çevrildi');
  return out;
}

const params = (q: Query, limit: number, before?: string) => { const p = new URLSearchParams({ from: q.from, to: q.to, filter: q.filter, limit: String(limit) }); if (q.q) p.set('q', q.q); if (before) p.set('before', before); return p; };

/** `initial`: opened from a table ("Ödemeyi düzelt") with its name in the search box and the payment's day. */
export function PaymentAdjustments({ initial }: { initial?: { q: string; day: string } }) {
  const today = reportToday(), yesterday = shift(today, -1);
  const [query, setQuery] = useState<Query>(() => ({ from: initial?.day ?? today, to: initial?.day ?? today, filter: 'all', q: initial?.q ?? '', limit: PAGE, revision: 0 }));
  const [search, setSearch] = useState(initial?.q ?? ''), [custom, setCustom] = useState(false), [from, setFrom] = useState(today), [to, setTo] = useState(today);
  const [result, setResult] = useState<PaymentLedgerPage | null>(null), [loading, setLoading] = useState(true), [more, setMore] = useState(false), [error, setError] = useState('');
  // Totals of a long period, counted by their own request; undefined while counting, null when that failed.
  const [counted, setCounted] = useState<{ total: number; amount: number } | null | undefined>(undefined);
  const [open, setOpen] = useState<string[]>([]), [details, setDetails] = useState<Record<string, PaymentDetail | string>>({});
  const [selected, setSelected] = useState<LedgerRow | null>(null), [busy, setBusy] = useState(false), [formError, setFormError] = useState('');
  // Refunds (by item or amount) are src/RefundForm.tsx; this form keeps the payment method correction.
  const [kind, setKind] = useState<'refund' | 'method'>('refund'), [method, setMethod] = useState<'cash' | 'card'>('cash'), [commission, setCommission] = useState('0'), [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState(() => newRequestId());
  // The cashiers' "iade isteği"s waiting for the owner (on top of the statement); bumped after a refund to read them again.
  const [requestsRevision, setRequestsRevision] = useState(0);
  // Answers of an older question (previous filter, slow "show more") never overwrite a newer list.
  const generation = useRef(0);
  useEffect(() => { const timer = setTimeout(() => setQuery(q => q.q === search.trim() ? q : { ...q, q: search.trim(), limit: PAGE }), 250); return () => clearTimeout(timer); }, [search]);
  /**
   * Reads pages until `wanted` rows are on screen or the list ends. A page with fewer rows but a cursor is a long search
   * that paused; it goes on from there, and every slice is shown at once.
   */
  async function fill(q: Query, wanted: number, base: PaymentLedgerPage | null, mine: number) {
    let page = base, before = base?.next ?? undefined;
    do {
      const data = await api<PaymentLedgerPage>('/api/staff/payment-adjustments?' + params(q, Math.max(1, wanted - (page?.rows.length ?? 0)), before));
      if (generation.current !== mine) return null;
      page = page ? { ...data, rows: [...page.rows, ...data.rows] } : data; setResult(page); before = data.next ?? undefined;
    } while (before && page.rows.length < wanted);
    return page;
  }
  useEffect(() => {
    const mine = ++generation.current; setLoading(true); setError(''); setSelected(null); setCounted(undefined);
    fill(query, query.limit, null, mine).then(page => {
      if (!page || page.total !== null) return;
      // The first count over years also fills the server's per-day caches, so it may take a while once; later ones are quick.
      api<{ total: number; amount: number }>('/api/staff/payment-adjustments/totals?' + params(query, PAGE), undefined, undefined, 120_000).then(t => { if (generation.current === mine) setCounted(t); }, () => { if (generation.current === mine) setCounted(null); });
    }).catch(e => { if (generation.current === mine) setError((e as Error).message); }).finally(() => { if (generation.current === mine) setLoading(false); });
  }, [query]);
  const update = (patch: Partial<Query>) => setQuery(q => ({ ...q, ...patch, limit: PAGE }));
  // After a correction the list is read again with as many rows as were on screen, so the owner keeps their place.
  const refresh = () => setQuery(q => ({ ...q, limit: Math.min(MAX_ROWS, Math.max(PAGE, Math.ceil((result?.rows.length ?? 0) / PAGE) * PAGE)), revision: q.revision + 1 }));
  async function showMore() {
    if (!result?.next || more) return;
    const mine = generation.current; setMore(true); setError('');
    try { await fill(query, result.rows.length + PAGE, result, mine); }
    catch (e) { if (generation.current === mine) setError((e as Error).message); } finally { setMore(false); }
  }
  function toggle(row: LedgerRow) {
    const opening = !open.includes(row.id);
    setOpen(list => opening ? [...list, row.id] : list.filter(id => id !== row.id));
    if (opening && typeof details[row.id] !== 'object') api<PaymentDetail>('/api/staff/payment-adjustments/' + encodeURIComponent(row.id))
      .then(d => setDetails(m => ({ ...m, [row.id]: d }))).catch(e => setDetails(m => ({ ...m, [row.id]: (e as Error).message })));
  }
  function startFix(row: LedgerRow) { setSelected(row); setKind('refund'); setMethod(row.method === 'platform' ? 'cash' : row.method === 'cash' ? 'card' : 'cash'); setCommission('0'); setReason(''); setFormError(''); changed(); }
  // The same request id is sent again after an unclear failure (timeout), so a retry never records a second correction.
  async function submit() {
    if (!selected || busy) return; setBusy(true); setFormError('');
    try {
      await api('/api/staff/payment-adjustments', { requestId, paymentId: selected.id, revision: selected.revision, kind: 'method', amount: 0, method, commission: method === 'card' ? Math.round(Number(commission) * 100) : 0, reason });
      setSelected(null); refresh();
    }
    catch (e) { setFormError((e as Error).message); } finally { setBusy(false); }
  }
  function changed() { setRequestId(newRequestId()); }
  /** A refund saved from a row or from a cashier's request: the list (and the requests) are read again. */
  function refunded(message: string) { setSelected(null); setNotice(message); setRequestsRevision(n => n + 1); refresh(); }
  const [notice, setNotice] = useState('');
  const validRange = !!from && !!to && from <= to && to <= today;
  const preset = PERIODS.find(([, , , days]) => { const r = periodRange(days, today); return r.from === query.from && r.to === query.to; });
  const period = preset ? preset[2] : query.from === query.to ? (query.from === yesterday ? 'Dün' : formatReportDate(query.from)) : `${formatReportDate(query.from)} – ${formatReportDate(query.to)}`;
  const multiDay = !!result && (result.from !== result.to || result.from === 'all'), filtered = query.filter !== 'all' || !!query.q;
  const total = result?.total ?? counted?.total, sum = result?.amount ?? counted?.amount;
  const totals = total !== undefined && sum !== undefined ? `${total.toLocaleString('tr-TR')} tahsilat · ${money(sum)}` : counted === null ? 'toplam hesaplanamadı' : 'tahsilatlar sayılıyor…';
  return <section className="payment-ledger">
    <div className="ledger-heading"><h2>İade ve düzeltme</h2><HelpTip title="İade ve düzeltme">Liste tahsilatın alındığı güne göredir; sonradan yapılan düzeltmeler de o satırda görünür. Düzeltmeler gerekçesiyle saklanır. İade kaydı bankadan para göndermez; nakit veya POS iadesini ayrıca gerçekleştirin. İadeler masa hesabını yeniden açmaz. Ürün seçerek yapılan iade, o ürünün satışından (Ürünler ve Kârlılık) düşülür; tutar olarak iade yalnız parayı düşer. Ürün hiç kullanılmadan geri döndüyse “stoğa ekle” kutusunu işaretleyin; işaretlenmezse Stok değişmez.</HelpTip></div>
    {notice && <Notice tone="success">{notice}<button type="button" className="text-btn" onClick={() => setNotice('')}>Kapat</button></Notice>}
    <RefundRequests revision={requestsRevision} onDone={refunded} />
    <div className="ledger-controls">
      <input className="ledger-search" type="search" aria-label="Tahsilat ara" placeholder="Masa, tutar veya saat: 12, 35,50, 14:30" maxLength={80} value={search} disabled={busy} onChange={e => setSearch(e.target.value)} />
      <div className="ledger-toolbar">
        <div className="ledger-pills" role="group" aria-label="Tahsilat türü">{FILTERS.map(([id, label]) => <button key={id} type="button" className={query.filter === id ? 'active' : ''} aria-pressed={query.filter === id} disabled={busy} onClick={() => update({ filter: id })}>{label}</button>)}</div>
        <div className="ledger-pills" role="group" aria-label="Tahsilat dönemi">
          {PERIODS.map(([id, label, , days]) => <button key={id} type="button" className={preset?.[0] === id ? 'active' : ''} aria-pressed={preset?.[0] === id} disabled={busy} onClick={() => { setCustom(false); update(periodRange(days, today)); }}>{label}</button>)}
          <button type="button" className={preset ? '' : 'active'} aria-expanded={custom} disabled={busy} onClick={() => { setFrom(query.from === 'all' ? today : query.from); setTo(query.to === 'all' ? today : query.to); setCustom(v => !v); }}>Tarih seç</button>
        </div>
      </div>
      {custom && <form className="ledger-custom" onSubmit={e => { e.preventDefault(); if (validRange) { setCustom(false); update({ from, to }); } }}>
        <label>Başlangıç<DateField required value={from} max={today} onChange={v => setFrom(v)} /></label>
        <label>Bitiş<DateField required value={to} min={from} max={today} onChange={v => setTo(v)} /></label>
        <button className="btn primary small-btn" disabled={!validRange}>Göster</button>
        <p className="muted small">Tek gün için iki tarihi aynı seçin.</p>
      </form>}
    </div>
    {loading && result && <RefreshStatus />}
    {error && <Notice tone="error">{error}{result && ' Önceki sonuçlar gösteriliyor. Yenilemeden işlem yapmayın.'}</Notice>}
    {result && <div className="ledger-summary"><span><strong>{period}</strong> · {totals}{filtered && ' (filtreli)'}</span><button type="button" className="btn secondary small-btn" disabled={loading || busy} onClick={refresh}>Yenile</button></div>}
    {!result && loading && <p role="status">Tahsilatlar yükleniyor…</p>}
    {result && <ol className="ledger-list" aria-busy={loading} inert={loading || !!error}>{result.rows.map(row => {
      const expanded = open.includes(row.id), detail = details[row.id];
      return <li key={row.id} className={`ledger-row${expanded ? ' open' : ''}`}>
        <button type="button" className="ledger-main" aria-expanded={expanded} onClick={() => toggle(row)}>
          <time dateTime={row.createdAt}>{multiDay && <small>{shortDate(row.createdAt)}</small>}{clock(row.createdAt)}</time>
          <span className="ledger-table">{row.tableName}</span>
          <strong className="ledger-amount">{money(row.amount)}</strong>
          <span className="ledger-badges"><span className={`ledger-badge ${row.method}`}>{methodName(row.method)}</span>{badges(row).map(b => <span key={b} className="ledger-badge fix">{b}</span>)}</span>
        </button>
        <button type="button" className="btn secondary small-btn ledger-fix" disabled={busy} onClick={() => startFix(row)}>Düzelt / iade</button>
        {expanded && <div className="ledger-detail">
          <section><h4>{typeof detail === 'object' && !detail.itemsSelected ? 'Hesaptaki ürünler' : 'Ödenen ürünler'}</h4>
            {detail === undefined ? <p className="muted small" role="status">Ürünler yükleniyor…</p> : typeof detail === 'string' ? <p className="muted small">{detail} Satırı kapatıp yeniden açın.</p> : <>
              {!detail.itemsSelected && <p className="muted small">Ürün seçilmeden tutar olarak alındı. Hesabın tüm ürünleri gösteriliyor.</p>}
              {detail.items.length ? <ul className="ledger-items">{detail.items.map((item, i) => <li key={i}><span>{itemAmount(item)} {item.name}{item.optionNames.length > 0 && <small> {item.optionNames.join(', ')}</small>}<LineNote note={item.note} /></span><span>{money(item.total)}</span></li>)}</ul> : <p className="muted small">Ürün kaydı yok.</p>}
            </>}
          </section>
          <dl className="ledger-facts">
            <div><dt>Tahsilat</dt><dd>{methodName(row.method)} · {dateTime(row.createdAt)}</dd></div>
            {row.method === 'card' ? <div><dt>POS komisyonu</dt><dd>{row.commission === null ? 'Bilinmiyor' : money(row.commission)}</dd></div> : row.change > 0 && <div><dt>Verilen / para üstü</dt><dd>{money(row.tendered)} / {money(row.change)}</dd></div>}
            {row.refunded > 0 && <div><dt>Kalan iade hakkı</dt><dd>{money(row.refundable)}</dd></div>}
          </dl>
          <section><h4>Düzeltmeler</h4>{row.corrections.length ? <ul className="ledger-corrections">{row.corrections.map(c => <li key={c.id}>
            <strong>{c.kind === 'refund' ? `İade ${money(c.amount)} · ${methodName(c.method)}` : `Yöntem ${c.method === 'card' ? 'karta' : 'nakde'} çevrildi${c.method === 'card' ? ` · POS komisyonu ${money(c.commission)}` : ''}`}</strong>
            {c.items && <span className="ledger-refund-items">{c.items.map(i => i.grams ? `${i.name} (${formatWeight(i.grams)})` : `${i.quantity} × ${i.name}`).join(', ')}{c.restock ? ' · stoğa eklendi' : ''}</span>}
            <small>{dateTime(c.createdAt)} · {c.by}{c.cashier ? ' (kasiyer)' : ''}</small><p>{c.reason}</p></li>)}</ul> : <p className="muted small">Bu tahsilatta düzeltme yok.</p>}</section>
        </div>}
        {selected?.id === row.id && <div className="ledger-form settings-section"><h3>{selected.tableName} · {money(selected.amount)}</h3>
          <label>İşlem<select value={kind} disabled={busy} onChange={e => { setKind(e.target.value as typeof kind); changed(); }}><option value="refund">İade kaydet</option><option value="method" disabled={selected.refunded > 0 || selected.method === 'platform'}>Ödeme yöntemini düzelt</option></select></label>
          {kind === 'refund' ? <RefundForm key={`${selected.id}:${selected.revision}`} paymentId={selected.id} source="ledger" onCancel={() => setSelected(null)} onDone={done => refunded(done.message)} /> : <>
            <p>Kalan iade hakkı: {money(selected.refundable)}</p>
            <label>Doğru ödeme yöntemi<select value={method} disabled={busy} onChange={e => { setMethod(e.target.value as typeof method); changed(); }}><option value="cash">Nakit</option><option value="card">Kart</option></select></label>
            {method === 'card' && <label>Kaydedilecek POS komisyonu (TL) *<input type="number" min="0" step="0.01" value={commission} disabled={busy} onChange={e => { setCommission(e.target.value); changed(); }} /></label>}
            <label>Gerekçe *<textarea maxLength={500} value={reason} disabled={busy} onChange={e => { setReason(e.target.value); changed(); }} /></label>
            <p className="muted small">Yöntem düzeltmesi tahsilatın alındığı tarihin raporuna yansır.</p>
            {formError && <Notice tone="error">{formError}</Notice>}
            <div className="actions"><button className="btn primary" disabled={busy || !reason.trim() || method === selected.method} onClick={() => void submit()}>Kaydı onayla</button><button className="btn secondary" disabled={busy} onClick={() => setSelected(null)}>Vazgeç</button></div>
          </>}
        </div>}
      </li>;
    })}</ol>}
    {result && !result.rows.length && !loading && !error && <p className="ledger-empty">{filtered ? 'Aramanıza uygun tahsilat yok.' : 'Bu dönemde tahsilat yok.'}</p>}
    {result && ((total ?? 0) > PAGE || !!result.next) && <div className="ledger-more"><small>{total === undefined ? `${result.rows.length} gösteriliyor` : `${result.rows.length} / ${total} gösteriliyor`}</small>{result.next && <button type="button" className="btn secondary" disabled={more || loading} onClick={() => void showMore()}>{more ? 'Yükleniyor…' : 'Daha fazla göster'}</button>}</div>}
  </section>;
}

/**
 * "Bekleyen iade istekleri": refunds a cashier could not do alone (above the owner's limits). The owner opens one ("İadeyi yap":
 * the refund form with the cashier's items, reason and method, still changeable) or declines it with an optional note.
 */
function RefundRequests({ revision, onDone }: { revision: number; onDone: (message: string) => void }) {
  const [list, setList] = useState<RefundRequest[]>([]), [open, setOpen] = useState<string | null>(null), [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => { let live = true; api<{ requests: RefundRequest[] }>('/api/staff/refunds/requests').then(r => { if (live) setList(r.requests.filter(x => x.status === 'pending')); }).catch(() => {}); return () => { live = false; }; }, [revision, reload]);
  if (!list.length) return null;
  async function decline(id: string) {
    setBusy(true); setError('');
    try { await api('/api/staff/refunds/requests/decline', { id, ...(note.trim() ? { note: note.trim() } : {}) }); setDeclining(null); setNote(''); setReload(n => n + 1); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const start = (r: RefundRequest): RefundStart => ({ requestId: r.id, ...(r.items ? { items: r.items.map(i => ({ lineId: i.lineId, quantity: i.quantity })) } : {}), ...(r.reasons ? { reasons: r.reasons } : {}), ...(r.note ? { note: r.note } : {}), method: r.method, ...(r.restock ? { restock: true } : {}), amount: r.amount });
  return <section className="refund-requests" aria-label="Bekleyen iade istekleri"><h3>Bekleyen iade istekleri ({list.length})</h3>
    {error && <Notice tone="error">{error}</Notice>}
    <ul>{list.map(r => <li key={r.id} className="refund-request">
      <div className="refund-request-line"><strong>{r.tableName} · {money(r.amount)} {r.method === 'card' ? 'kart' : 'nakit'} iade</strong><span className="muted small">{dateTime(r.at)} · {r.byName}</span></div>
      <p>{r.items?.length ? r.items.map(i => i.grams ? `${i.name} (${formatWeight(i.grams)})` : `${i.quantity} × ${i.name}`).join(', ') : 'Tutar olarak'} · {r.reason}{r.restock ? ' · stoğa eklensin' : ''}</p>
      {open === r.id ? <RefundForm paymentId={r.paymentId} source="ledger" start={start(r)} onCancel={() => setOpen(null)} onDone={done => { setOpen(null); onDone(done.message); }} />
        : declining === r.id ? <div className="refund-confirm" role="group" aria-label="İsteği reddet"><label>Kasiyere not (isteğe bağlı)<input value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="Örn. Ürün tüketilmiş, iade yapılmaz" /></label>
          <div className="refund-actions"><button type="button" className="btn primary" disabled={busy} onClick={() => void decline(r.id)}>{busy ? 'Kaydediliyor…' : 'Reddet'}</button><button type="button" className="btn secondary" disabled={busy} onClick={() => setDeclining(null)}>Vazgeç</button></div></div>
        : <div className="refund-actions"><button type="button" className="btn primary" onClick={() => { setOpen(r.id); setDeclining(null); }}>İadeyi yap</button><button type="button" className="btn secondary" onClick={() => { setDeclining(r.id); setOpen(null); setNote(''); }}>Reddet</button></div>}
    </li>)}</ul>
  </section>;
}