import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, ChevronUp, Copy, ReceiptText, X } from 'lucide-react';
import { FISCAL_NOTE, kasaMoney, kasaNumber, methodWord, PLATFORM_FISCAL, ratesLine, ticksUsed, zCompare, zExplanation, type CashFiscal, type FiscalEntry, type FiscalOpen, type FiscalZ } from '../packages/domain/fiscal';
import type { RateAmount } from '../packages/domain/vat';
import { api, moneyError, parseMoney } from './api';
import './fiscal-helper.css';

/*
 * Yazar kasa yardımcısı on the screen (rules in packages/domain/fiscal.ts, server in server/fiscal.ts).
 * - After a payment or refund: a large card "Yazar kasaya girin: %10 departman → ₺347,00 · Ödeme: Nakit", one line per rate,
 *   each amount a big copy button, and an optional "Girildi" tick. Inside the payment window while it stays open (a part
 *   payment); once it closes the card moves to a small dock at the bottom right of the screen (its own React root, so no
 *   shared screen file has to mount it). Never modal, never takes the focus: the next table is one tap away. With "Ödemeden
 *   sonra 'Girildi' onayı iste" on, ✕ becomes "Sonra" and only folds the card; it leaves when "Girildi" is pressed.
 * - Gün sonu: FiscalClosingSection, the "Yazar kasa karşılaştırması" of a closing (Z raporu fields, difference, not-ticked list).
 */
type View = { enabled: boolean; askConfirm: boolean; entry?: FiscalEntry; marked?: { at: string; byName: string } };
type Item = { key: string; paymentId: string; refundId?: string; view?: View; error?: string; docked: boolean; folded: boolean; busy?: boolean; markError?: string };

let items: Item[] = [], seq = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => items;
const patch = (key: string, p: Partial<Item>) => { items = items.map(i => i.key === key ? { ...i, ...p } : i); emit(); };
const remove = (key: string) => { items = items.filter(i => i.key !== key); emit(); };
// 9 Ekim kullanıcı testi (K-E): at a busy hour the cards covered the tables at the bottom right. A card marked "Girildi"
// leaves at once, and more than GROUP_FROM cards in the dock fold into one line ("4 ödeme yazar kasaya girilmedi").
const MAX_DOCKED = 12, GROUP_FROM = 3;

async function load(key: string, paymentId: string, refundId?: string) {
  try {
    const view = await api<View>(`/api/staff/fiscal/payments/${encodeURIComponent(paymentId)}${refundId ? `?refund=${encodeURIComponent(refundId)}` : ''}`);
    if (!view.enabled || !view.entry) remove(key); else patch(key, { view, error: undefined });
  } catch (e) { patch(key, { error: (e as Error).message || 'Yazar kasa tutarı alınamadı.' }); }
}
/** A payment (or a refund of it) was just saved: its card. `docked`: straight to the dock (the window is closing). */
export function trackFiscal(paymentId: string, options: { refundId?: string; docked?: boolean } = {}) {
  const key = `fiscal-${++seq}`;
  items = [...items, { key, paymentId, ...(options.refundId ? { refundId: options.refundId } : {}), docked: false, folded: false }]; emit();
  if (options.docked) dockFiscal(key);
  void load(key, paymentId, options.refundId);
  return key;
}
/** The payment window closed (or took the next payment): the card goes on in the dock, older ones fold. */
export function dockFiscal(key: string | null | undefined) {
  if (!key || !items.some(i => i.key === key)) return;
  // Already "Girildi" inside the payment window: nothing left to do with it, so it does not come into the dock.
  if (items.find(i => i.key === key)?.view?.marked) { remove(key); return; }
  items = items.map(i => i.key === key ? { ...i, docked: true, folded: false } : i.docked ? { ...i, folded: true } : i);
  // A busy counter: the oldest cards leave first, but a card still waiting for its "Girildi" stays while there is room.
  const docked = items.filter(i => i.docked);
  if (docked.length > MAX_DOCKED) { const drop = new Set(docked.slice(0, docked.length - MAX_DOCKED).map(i => i.key)); items = items.filter(i => !drop.has(i.key)); }
  emit(); ensureDock();
}
function dismiss(item: Item) {
  const waiting = item.view?.askConfirm && !item.view.marked && item.view.entry?.method !== 'platform';
  if (waiting && item.docked) patch(item.key, { folded: true }); else remove(item.key);
}
async function mark(item: Item) {
  if (item.busy || !item.view?.entry) return;
  patch(item.key, { busy: true, markError: undefined });
  try {
    const r = await api<{ marked: { at: string; byName: string } }>('/api/staff/fiscal/mark', { paymentId: item.paymentId, ...(item.refundId ? { refundId: item.refundId } : {}) });
    const now = items.find(i => i.key === item.key);
    if (now?.view) patch(item.key, { busy: false, view: { ...now.view, marked: r.marked } });
    // Done: a docked card leaves at once (K-E); the window's own card shows "Girildi" until the window closes.
    if (item.docked) remove(item.key);
  } catch (e) { patch(item.key, { busy: false, markError: (e as Error).message }); }
}

let dockRoot: HTMLElement | null = null;
function ensureDock() {
  if (dockRoot || typeof document === 'undefined') return;
  dockRoot = document.createElement('div'); dockRoot.id = 'fiscal-dock-root';
  document.body.appendChild(dockRoot);
  createRoot(dockRoot).render(<FiscalDock />);
}
function FiscalDock() {
  const list = useSyncExternalStore(subscribe, snapshot).filter(i => i.docked && (i.view || i.error)), open = list.some(i => !i.folded);
  // More than GROUP_FROM cards: the folded ones are one line until it is tapped (K-E).
  const [expanded, setExpanded] = useState(false), folded = list.filter(i => i.folded), grouped = list.length > GROUP_FROM && folded.length > 1 && !expanded;
  useEffect(() => { if (list.length <= GROUP_FROM) setExpanded(false); }, [list.length]);
  // The next action elsewhere on the screen folds the cards to one line each, so they never sit over the next table.
  useEffect(() => {
    if (!open && !expanded) return;
    const fold = (e: PointerEvent) => { if (!(e.target instanceof Node && dockRoot?.contains(e.target))) { setExpanded(false); items = items.map(i => i.docked && !i.folded ? { ...i, folded: true } : i); emit(); } };
    document.addEventListener('pointerdown', fold, true);
    return () => document.removeEventListener('pointerdown', fold, true);
  }, [open, expanded]);
  if (!list.length) return null;
  return <aside className="fiscal-dock" aria-label="Yazar kasa yardımcısı">
    {grouped && <button type="button" className="fiscal-group" aria-expanded="false" onClick={() => setExpanded(true)}><ReceiptText size={16} aria-hidden="true" /><span>{folded.length} ödeme yazar kasaya girilmedi</span><ChevronUp size={16} aria-hidden="true" /></button>}
    {(grouped ? list.filter(i => !i.folded) : list).map(i => <FiscalCard key={i.key} item={i} />)}
  </aside>;
}
/** The card of one payment inside the payment window (`itemKey` from trackFiscal). */
export function FiscalSlot({ itemKey }: { itemKey: string | null }) {
  const item = useSyncExternalStore(subscribe, snapshot).find(i => i.key === itemKey && !i.docked);
  if (!item || (!item.view && !item.error)) return null;
  return <FiscalCard item={item} />;
}

function copyText(text: string) {
  try { if (navigator.clipboard && window.isSecureContext) { void navigator.clipboard.writeText(text); return true; } } catch { /* below */ }
  // A café LAN address is not a secure context: the old way still copies.
  try { const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch { return false; }
}
function Amount({ value, label }: { value: number; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(t); }, [copied]);
  return <button type="button" className="fiscal-amount" aria-label={`${label}: ${kasaMoney(value)}. Kopyala`} title="Tutarı kopyala" onClick={() => setCopied(copyText(kasaNumber(value)))}>
    <strong>{kasaMoney(value)}</strong>{copied ? <small>Kopyalandı</small> : <Copy size={15} aria-hidden="true" />}</button>;
}

function FiscalCard({ item }: { item: Item }) {
  const e = item.view?.entry, refund = e?.kind === 'refund', platform = e?.method === 'platform', marked = item.view?.marked, ask = !!item.view?.askConfirm;
  const title = refund ? 'Yazar kasada iade / ters işlem' : 'Yazar kasaya girin';
  const close = <button type="button" className="fiscal-close" onClick={() => dismiss(item)} aria-label={ask && !marked && !platform && item.docked ? 'Sonra (kartı küçült)' : 'Kartı kapat'}>{ask && !marked && !platform && item.docked ? <span>Sonra</span> : <X size={18} aria-hidden="true" />}</button>;
  if (item.error && !e) return <section className="fiscal-card fiscal-card-error" role="status"><header><ReceiptText size={18} aria-hidden="true" /><strong>Yazar kasa</strong>{close}</header>
    <p>{item.error}</p><button type="button" className="text-btn" onClick={() => { patch(item.key, { error: undefined }); void load(item.key, item.paymentId, item.refundId); }}>Yeniden dene</button></section>;
  if (!e) return null;
  const method = `${refund ? 'İade' : 'Ödeme'}: ${methodWord(e.method)}`;
  // Folded (an older card in the dock): one line, still with its "Girildi".
  if (item.folded) return <section className={`fiscal-card folded${marked ? ' marked' : ''}`} aria-label={`${title} · ${e.tableName ?? ''}`}>
    <button type="button" className="fiscal-unfold" aria-expanded="false" onClick={() => patch(item.key, { folded: false })}><ReceiptText size={16} aria-hidden="true" /><span>{refund ? 'İade · ' : ''}{e.tableName ?? 'Yazar kasa'}</span><strong>{platform ? 'Platform' : kasaMoney(e.amount)}</strong><small>{methodWord(e.method)}</small><ChevronUp size={16} aria-hidden="true" /></button>
    {!platform && !marked && <button type="button" className="fiscal-tick small" disabled={item.busy} onClick={() => void mark(item)}><Check size={15} aria-hidden="true" />Girildi</button>}
    {marked && <span className="fiscal-done"><Check size={14} aria-hidden="true" />Girildi</span>}
    {!(ask && !marked && !platform) && <button type="button" className="fiscal-close" onClick={() => remove(item.key)} aria-label="Kartı kapat"><X size={16} aria-hidden="true" /></button>}
  </section>;
  return <section className={`fiscal-card${refund ? ' refund' : ''}${marked ? ' marked' : ''}`} aria-label={title}>
    <header><ReceiptText size={18} aria-hidden="true" /><strong>{title}</strong>{e.tableName && <small>{e.tableName}</small>}{close}</header>
    {platform ? <p className="fiscal-platform">{PLATFORM_FISCAL}</p> : <ul className="fiscal-rows">
      {e.rows.map(r => <li key={r.rate}><span>%{r.rate} departman →</span><Amount value={r.amount} label={`%${r.rate} departman`} /></li>)}
    </ul>}
    <p className="fiscal-method"><span>{method}</span>{!platform && e.rows.length > 1 && <span> · Toplam {kasaMoney(e.amount)}</span>}{e.deposit && <span> · kapora</span>}</p>
    {!platform && (marked ? <p className="fiscal-done" role="status"><Check size={16} aria-hidden="true" />Girildi · {marked.byName}</p>
      : <div className="fiscal-actions"><button type="button" className="fiscal-tick" disabled={item.busy} onClick={() => void mark(item)}><Check size={18} aria-hidden="true" />{item.busy ? 'Kaydediliyor…' : 'Girildi'}</button>
        <small>{ask ? 'Yazar kasaya girince “Girildi”ye basın.' : 'İsteğe bağlı: gün sonunda karşılaştırmayı kolaylaştırır.'}</small></div>)}
    {item.markError && <p className="field-error" role="alert">{item.markError}</p>}
  </section>;
}

/* ---- Gün sonu: "Yazar kasa karşılaştırması" ---- */
export type ZDraft = { total: string; rates: Record<number, string> };
export const emptyZ = (): ZDraft => ({ total: '', rates: {} });
/** What the finish request sends for a typed Z raporu (nothing when the total is empty or wrong). */
export function zBody(d: ZDraft): { total: number; rates?: RateAmount[] } | undefined {
  const total = parseMoney(d.total);
  if (!d.total.trim() || !Number.isFinite(total) || total < 0) return undefined;
  const rates = Object.entries(d.rates).filter(([, v]) => v.trim() && Number.isFinite(parseMoney(v))).map(([rate, v]) => ({ rate: Number(rate), amount: parseMoney(v) }));
  return { total, ...(rates.length ? { rates } : {}) };
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const signed = (k: number) => k === 0 ? kasaMoney(0) : `${k > 0 ? '+' : '−'}${kasaMoney(Math.abs(k))}`;
const tone = (k: number) => k === 0 ? 'even' : k < 0 ? 'short' : 'over';

/**
 * In the closing (result step: `edit` with the Z fields and live "Girildi" ticks) and in Kasa kapanışları (read only, the Z
 * kept with the closing). `final`: "Bugün…"; a vardiya devri says "Bu vardiyada…" and asks no Z raporu.
 */
export function FiscalClosingSection({ fiscal, z, final, edit }: { fiscal: CashFiscal; z?: FiscalZ; final: boolean; edit?: { value: ZDraft; onChange: (v: ZDraft) => void } }) {
  const id = useId(), [ticked, setTicked] = useState<Set<string>>(new Set()), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState(''), [all, setAll] = useState(false);
  const typed = edit ? zBody(edit.value) : undefined, result = z ?? (typed ? zCompare(fiscal, typed) : undefined);
  const totalProblem = edit && edit.value.total.trim() ? moneyError(edit.value.total, { min: 0 }) : '';
  const open = fiscal.open.filter(o => !ticked.has(o.id)), openCount = open.length + (fiscal.more ?? 0);
  async function tick(o: FiscalOpen) {
    setBusy(o.id); setError('');
    try { await api('/api/staff/fiscal/mark', { paymentId: o.paymentId, ...(o.kind === 'refund' ? { refundId: o.id } : {}) }); setTicked(s => new Set(s).add(o.id)); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  const shown = all ? open : open.slice(0, 8);
  return <section className="fiscal-closing" aria-label="Yazar kasa karşılaştırması">
    <h3><ReceiptText size={16} aria-hidden="true" />Yazar kasa karşılaştırması</h3>
    <p className="fiscal-should"><span>{final ? 'Bugün yazar kasaya girilmesi gereken' : 'Bu kapanışta yazar kasaya girilmesi gereken'}:</span>{' '}
      <strong>{fiscal.rows.length ? `${ratesLine(fiscal.rows)} · ` : ''}Toplam {kasaMoney(fiscal.total)}</strong>{' '}
      {/* Kasa güvenliği → strictCount: the counter's copy has no split (it would give the expected cash away). */}
      {!fiscal.hiddenSplit && <small>(Nakit {kasaMoney(fiscal.cash)} / Kart {kasaMoney(fiscal.card)})</small>}</p>
    {!!fiscal.refunds && <p className="fiscal-sub">İade / ters işlem: <strong>{fiscal.refundRows?.length ? ratesLine(fiscal.refundRows) : kasaMoney(fiscal.refunds)}</strong>{fiscal.refundRows && fiscal.refundRows.length > 1 && <> · Toplam {kasaMoney(fiscal.refunds)}</>}</p>}
    {!!fiscal.platform && <p className="fiscal-sub">Platform (online ödenen) {kasaMoney(fiscal.platform)}: toplama katılmadı. {PLATFORM_FISCAL.replace('Platform siparişi — ', '')}.</p>}
    {edit && final && <div className="fiscal-z-fields">
      <label htmlFor={`${id}-z`}>Z raporu toplamı (KDV dahil, TL) <span className="muted">· isteğe bağlı</span>
        <input id={`${id}-z`} aria-label="Z raporu toplamı" inputMode="decimal" placeholder="Yazar kasanın Z raporundaki toplam" value={edit.value.total} aria-invalid={!!totalProblem} onChange={e => edit.onChange({ ...edit.value, total: e.target.value })} />
        {totalProblem && <small className="field-error" role="alert">{totalProblem}</small>}</label>
      {fiscal.rows.length > 1 && <details className="fiscal-z-rates"><summary>Oranlara göre de yazın (isteğe bağlı)</summary>
        {fiscal.rows.map(r => <label key={r.rate} htmlFor={`${id}-z${r.rate}`}>%{r.rate} departman (TL)<input id={`${id}-z${r.rate}`} aria-label={`Z raporu %${r.rate}`} inputMode="decimal" value={edit.value.rates[r.rate] ?? ''} onChange={e => edit.onChange({ ...edit.value, rates: { ...edit.value.rates, [r.rate]: e.target.value } })} /></label>)}
      </details>}
    </div>}
    {result && <div className={`fiscal-z ${tone(result.difference)}`} role="status">
      <span>{result.difference === 0 ? 'Z raporu tutuyor' : 'Z farkı'}</span><strong>{signed(result.difference)}</strong>
      <small>Z raporu {kasaMoney(result.total)} · Mola {kasaMoney(fiscal.total)}{result.rateDifferences?.filter(r => r.amount).map(r => ` · %${r.rate} farkı ${signed(r.amount)}`).join('') ?? ''}</small>
      <p>{zExplanation(fiscal, result)}</p>
    </div>}
    {fiscal.hiddenSplit ? null : ticksUsed(fiscal) ? <div className="fiscal-open">
      <h4>“Girildi” işaretlenmemiş {openCount ? `(${openCount})` : ''}</h4>
      {!openCount ? <p className="muted small">Hepsi “Girildi” olarak işaretlenmiş.</p> : <ul>{shown.map(o => <li key={o.id}>
        <span>{clock(o.at)}</span><strong>{o.tableName ?? 'Hesap'}{o.kind === 'refund' ? ' · iade' : ''}</strong><span>{kasaMoney(o.amount)} · {methodWord(o.method).toLocaleLowerCase('tr')}</span>
        {edit && <button type="button" className="fiscal-tick small" disabled={busy === o.id} onClick={() => void tick(o)}><Check size={14} aria-hidden="true" />Girildi</button>}
      </li>)}</ul>}
      {open.length > shown.length && <button type="button" className="text-btn" onClick={() => setAll(true)}>Hepsini göster ({open.length})</button>}
      {!!fiscal.more && <p className="muted small">Listede yer almayan {fiscal.more} kayıt daha var.</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div> : <p className="muted small">“Girildi” işareti kullanılmadığı için ödeme listesi yok. İsterseniz Kasa ve giderler → Kasa ayarları → Kart ve yazar kasa'dan “Ödemeden sonra ‘Girildi’ onayı iste”yi açın.</p>}
    <p className="muted small fiscal-note">{FISCAL_NOTE}</p>
  </section>;
}
