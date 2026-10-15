import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ChefHat, LogOut, Package, Printer, ShoppingBag, UserRound, Wifi, WifiOff } from 'lucide-react';
import type { PublicOrder, StaffSnapshot } from '../packages/domain/types';
import { takeawayHeading } from '../packages/domain/takeaway';
import { api, requestId } from './api';
import { Notice, OrderLines, PackedBadge, Status } from './components';
import { ApprovalQueue } from './ApprovalQueue';
import { ExternalCancel, ExternalInbox, PlatformDetails, PlatformHeading } from './ExternalOrders';
import { KitchenCancellation } from './KitchenCancellation';
import { KitchenSound, type KitchenNotice } from './KitchenSound';
import { WaitingTime, useMinuteClock, waitedMinutes } from './KitchenTimer';
import { StockQuestions } from './StockQuestions';
import { problemText } from '../packages/domain/print-problems';
import { OrderChanges } from './StaffChange';
import './kitchen-mode.css';
// "Tanıtım" label of a demo business (server/demo-reset.ts).
import { DemoBadge } from './DemoBadge';

/*
 * Mutfak modu: the kitchen board on the whole screen, read from a few steps away. No sidebar and no page title; a slim bar
 * on top says whose kitchen, the time, the sound, how many orders wait in each stage, and holds "Stok", "Hesabım" and
 * "Çıkış". Below it what needs an answer (İPTAL strip, stock questions, QR approvals, platform orders), then the board:
 * three columns side by side on a landscape screen, each scrolling on its own under its sticky heading; on a portrait
 * tablet or a phone (≤ 900 px) one stage at a time with the "Yeni · Hazırlanıyor · Hazır" tabs.
 * An order waiting 10 minutes colours its whole card amber, 20 minutes red (new and preparing; a ready order's food is done).
 * The kitchen account always works here (Stok and Hesabım open inside the same frame, so the sound and "Ekranı açık tut"
 * keep running). Only the kitchen account has it (owner's decision, 5 Ekim: the owner's "Mutfak ekranı" is gone); a café
 * with one screen for the counter and the kitchen uses the window's "İkiye böl" (src/SplitView.tsx), the board in its pane.
 */
const stageNames = { new: 'Yeni', preparing: 'Hazırlanıyor', ready: 'Hazır' } as const;
type Stage = keyof typeof stageNames;
const STAGES: Stage[] = ['new', 'preparing', 'ready'];
/** Minutes after which a waiting order colours its card: amber, then red. */
export const LATE_MINUTES = 10, VERY_LATE_MINUTES = 20;
export const lateness = (o: PublicOrder, now: number) => o.status !== 'new' && o.status !== 'preparing' ? '' : waitedMinutes(o.createdAt, now) >= VERY_LATE_MINUTES ? 'very-late' : waitedMinutes(o.createdAt, now) >= LATE_MINUTES ? 'late' : '';

export type KitchenView = 'kitchen' | 'stock' | 'password';
export function KitchenMode({ data, view, onView, connected, error, onError, onToast, load, onPrint, onCancel, onLogout, loggingOut, notice, shiftChip, help, children }: {
  data: StaffSnapshot; view: string; onView: (view: KitchenView) => void; connected: boolean;
  error: string; onError: (message: string) => void; onToast: (message: string) => void; load: () => Promise<void>;
  /** "Fişi yeniden yazdır" on a card. */
  onPrint: (order: PublicOrder) => void;
  /** Opens the staff cancellation window for an order. */
  onCancel: (order: PublicOrder) => void;
  onLogout: () => void; loggingOut: boolean;
  /** A notice for everyone on staff (the sign-in ending at 05:00). */
  notice?: ReactNode;
  shiftChip?: ReactNode; children?: ReactNode;
  /** Mola Yardım's small "?" (src/HelpPanel.tsx): only this icon on the kitchen's bar, nothing that pops up by itself. */
  help?: ReactNode;
}) {
  const board = view === 'kitchen';
  // Hizmet paketi: no "Stok" in the package, no Stok button (the kitchen never sees closed services).
  const stockOn = !data.pkg || data.pkg.enabled.includes('stock');
  const now = useMinuteClock();
  // The stage shown on a portrait tablet, "Geri al" for the last step, the İPTAL strip, and the short pause after a tap
  // while the cards move (a hurried second tap must not land on the next card).
  const [stage, setStage] = useState<Stage>('new');
  const [undo, setUndo] = useState<{ orderId: string; version: number; text: string; key: number } | null>(null), [undoBusy, setUndoBusy] = useState(false);
  const [strip, setStrip] = useState<(KitchenNotice & { until: number })[]>([]);
  // `order`: the card just tapped; its own next button (e.g. "Hazır olarak işaretle") stays usable at once.
  const settle = useRef({ until: 0, order: '' });
  // "Geri al" stays for 5 seconds after a kitchen step (engine.ts STATUS_UNDO_MS); the İPTAL strip for 30 seconds.
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(u => u?.key === undo.key ? null : u), 5000); return () => clearTimeout(t); }, [undo]);
  useEffect(() => { if (!strip.length) return; const t = setTimeout(() => setStrip(list => list.filter(n => n.until > Date.now())), Math.max(250, Math.min(...strip.map(n => n.until)) - Date.now())); return () => clearTimeout(t); }, [strip]);
  const noteCancels = useCallback((notices: KitchenNotice[]) => setStrip(list => [...notices.map(n => ({ ...n, until: Date.now() + 30_000 })), ...list.filter(n => !notices.some(x => x.id === n.id))].slice(0, 4)), []);
  /** One kitchen step (start, ready, served). The board ignores taps until the cards have moved and ~600 ms more. */
  async function advance(o: PublicOrder, status: 'preparing' | 'ready' | 'served') {
    onError(''); settle.current = { until: Infinity, order: o.id };
    try {
      const r = await api<{ status: string; version: number }>('/api/staff/status', { requestId: requestId(), orderId: o.id, version: o.version, status });
      const where = o.takeaway ? takeawayHeading(o.takeaway.number) : o.tableName;
      if (status !== 'served') setUndo({ orderId: o.id, version: r.version, key: Date.now(), text: `${where} · #${o.number} ${status === 'preparing' ? 'hazırlanıyor' : 'hazır'}` });
      await load();
    } catch (e) { onError((e as Error).message); await load(); }
    finally { settle.current = { until: Date.now() + 600, order: o.id }; }
  }
  async function undoStep() {
    if (!undo || undoBusy) return;
    setUndoBusy(true); onError('');
    try { await api('/api/staff/status/undo', { requestId: requestId(), orderId: undo.orderId, version: undo.version }); setUndo(null); onToast('Geri alındı.'); }
    catch (e) { setUndo(null); onError((e as Error).message); }
    finally { setUndoBusy(false); await load(); }
  }
  const count = (s: Stage) => data.orders.filter(o => o.status === s).length;
  const clock = new Date(now).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  return <div className={`kitchen-mode${board ? ' on-board' : ''}`}>
    <header className="kitchen-bar">
      <div className="kitchen-bar-place">
        <span className="kitchen-bar-avatar" aria-hidden="true">{data.logo ? <img src={data.logo} alt="" /> : <ChefHat size={20} />}</span>
        <div><strong>{data.name}</strong><small>Mutfak</small></div><DemoBadge on={data.demo} />
        <time className="kitchen-bar-clock" aria-label={`Saat ${clock}`}>{clock}</time>
      </div>
      {/* Counts at a glance (landscape); a portrait screen has them on the stage tabs below. */}
      <ul className="kitchen-bar-counts" aria-label="Aşamalardaki siparişler">{STAGES.map(s => <li key={s} className={`count-${s}`}><span>{stageNames[s]}</span><strong>{count(s)}</strong></li>)}</ul>
      <div className="kitchen-bar-tools">
        {!connected && <span className="connection lost"><WifiOff size={14} />Bağlantı kesildi</span>}
        {connected && <span className="kitchen-bar-online" title="Bağlı"><Wifi size={15} aria-hidden="true" /><span className="sr-only">Bağlı</span></span>}
        {/* Sound and "Ekranı açık tut", mounted once for the whole mode: they keep working on Stok and Hesabım. */}
        <KitchenSound orders={data.orders} external={data.externalOrders} me={data.userId} memory={`kitchen:${data.username ?? ''}`} onCancel={noteCancels} />
        {shiftChip}
        {board ? stockOn && <button type="button" className="kitchen-bar-btn" onClick={() => onView('stock')}><Package size={18} aria-hidden="true" />Stok</button>
          : <button type="button" className="kitchen-bar-btn primary" onClick={() => onView('kitchen')}><ArrowLeft size={18} aria-hidden="true" />Mutfak panosu</button>}
        {help}
        {view !== 'password' && <button type="button" className="kitchen-bar-btn" onClick={() => onView('password')}><UserRound size={18} aria-hidden="true" />Hesabım</button>}
        <button type="button" className="kitchen-bar-btn" aria-label="Çıkış yap" disabled={loggingOut} onClick={onLogout}><LogOut size={18} aria-hidden="true" />Çıkış</button>
      </div>
    </header>
    <div className="kitchen-mode-body">
      {data.serviceNotice && <Notice tone="error">{data.serviceNotice}</Notice>}{notice}
      {error && <Notice tone="error">{error}<button className="text-btn" onClick={() => onError('')}>Kapat</button></Notice>}
      {board ? <>
        <div className="kitchen-notices">
          {/* Cancellations by someone else stay in red above the board for 30 s ("İPTAL · kim · neden"), with their own sound. */}
          {strip.length > 0 && <div className="kitchen-cancel-strip" role="alert">{strip.map(n => <p key={n.id}><strong>{n.kind === 'change' ? 'DEĞİŞTİ' : 'İPTAL'}</strong><span>{n.heading} · {n.who}{n.reason ? ` · ${n.reason}` : ''}</span>{n.items && <small>{n.items}</small>}</p>)}</div>}
          {!!data.stockQuestions?.length && <StockQuestions questions={data.stockQuestions} onSaved={message => { onToast(message); void load(); }} />}
          {/* QR approvals and delivery platform orders waiting for Kabul/Reddet. */}
          <ApprovalQueue data={data} onlyWaiting kitchen onSaved={() => void load()} />
          {!!data.externalOrders?.length && <ExternalInbox orders={data.externalOrders} role={data.role} onSaved={() => void load()} />}
        </div>
        {/* Portrait tablet and phone (≤ 900 px): one stage at a time, chosen here; wider screens show all three columns. */}
        <div className="kitchen-stage-tabs" role="tablist" aria-label="Mutfak aşamaları">{STAGES.map(s => <button type="button" role="tab" key={s} aria-selected={stage === s} className={stage === s ? 'selected' : ''} onClick={() => setStage(s)}>{stageNames[s]}<span>{count(s)}</span></button>)}</div>
        <div className="kitchen-board" onClickCapture={e => { const card = e.target instanceof Element ? e.target.closest('[data-order]')?.getAttribute('data-order') : null; if (Date.now() < settle.current.until && card !== settle.current.order) { e.preventDefault(); e.stopPropagation(); } }}>
          {STAGES.map(status => <section className={`kitchen-column ${stage === status ? 'stage-active' : ''}`} key={status} aria-label={stageNames[status]}>
            <div className="column-heading"><Status value={status} /><span>{count(status)}</span></div>
            {data.orders.filter(o => o.status === status).map(o => { const late = lateness(o, now); return <article className={`kitchen-card ${o.takeaway ? 'kitchen-takeaway' : ''} ${late}`.trim()} key={o.id} data-order={o.id} data-late={late || undefined}>
              <div className="order-head">{o.external ? <PlatformHeading source={o.external} /> : o.takeaway ? <h3 className="takeaway-heading"><ShoppingBag size={17} aria-hidden="true" />{takeawayHeading(o.takeaway.number)}</h3> : <h3>{o.tableName}</h3>}<span className="kitchen-card-tools">#{o.number}{data.printing?.orders && <button type="button" className="icon-btn ticket-reprint" aria-label={`Sipariş #${o.number} fişini yeniden yazdır`} title="Fişi yeniden yazdır" onClick={() => onPrint(o)}><Printer size={15} /></button>}</span></div>
              {/* 11 Ekim: the ticket did not print and why ("Yazıcıda kâğıt yok · Mutfak"), with "Tekrar bas" once fixed. */}
              {o.printProblems?.length ? o.printProblems.map(p => <p key={p.printerId} className="print-failed print-problem" role="alert"><span>Fiş basılamadı: {problemText(p.cause, p.printer)}.</span>{data.printing?.orders && <button type="button" className="btn secondary small-btn" onClick={() => onPrint(o)}><Printer size={14} aria-hidden="true" />Tekrar bas</button>}</p>)
                : !!o.printFailedTo?.length && <p className="print-failed">Fiş yazdırılamadı · Yazıcıyı kontrol edip <Printer size={12} aria-hidden="true" /> simgesine basın.</p>}
              <OrderChanges order={o} />

              <div className="order-meta"><span>{o.takeaway ? o.takeaway.label ?? '' : o.guestLabel}</span><WaitingTime since={o.createdAt} lateAfter={status === 'ready' ? Infinity : LATE_MINUTES} />{late && <span className="late-label">{late === 'very-late' ? 'Çok gecikti' : 'Gecikti'}</span>}</div>
              {o.packed && <PackedBadge loud />}{o.external && <PlatformDetails source={o.external} kitchen />}
              {o.paymentBeforePreparation && <p className="muted small">{o.paid ? 'Ödeme alındı' : 'Ödeme bekleniyor · Hazırlık kilitli'}</p>}
              {o.updatedAt && <p className="order-change-notice">Müşteri siparişi güncelledi · {new Date(o.updatedAt).toLocaleTimeString('tr-TR')}</p>}
              {o.tableMovedFrom && <p className="order-change-notice">Masa taşındı: {o.tableMovedFrom} → {o.tableName}</p>}
              <OrderLines order={o} showPrice={false} packedBadge={false} codes={false} />
              {o.cancelRequested ? <KitchenCancellation order={o} tracked={data.stockProducts} onSaved={load} /> : <>
                {/* 5 seconds to take a mistaken tap back (preparing → new, ready → preparing), on the card that just moved: nothing floats over the board. */}
                {undo?.orderId === o.id && <div className="kitchen-undo" role="status"><span>{undo.text}</span><button type="button" className="undo-btn" disabled={undoBusy} onClick={() => void undoStep()}>Geri al</button></div>}
                <KitchenAction order={o} seconds={data.changeSeconds} onStart={() => advance(o, status === 'new' ? 'preparing' : status === 'preparing' ? 'ready' : 'served')} />
              </>}
              {!o.cancelRequested && (o.external ? <ExternalCancel order={o} onDone={() => void load()} /> : <button type="button" className="text-btn kitchen-cancel-open" aria-label={`Sipariş #${o.number} · iptal et`} onClick={() => onCancel(o)}>İptal et</button>)}
            </article>; })}
            {!data.orders.some(o => o.status === status) && <div className="column-empty">Bu aşamada sipariş yok.</div>}
          </section>)}
        </div>
      </> : <div className="kitchen-mode-page">{children}</div>}
    </div>
  </div>;
}

function KitchenAction({ order, seconds, onStart }: { order: PublicOrder; seconds: number; onStart: () => Promise<void> }) {
  const [now, setNow] = useState(Date.now());
  // A hurried double tap must not send a second, stale status change.
  const [busy, setBusy] = useState(false);
  async function start() { if (busy) return; setBusy(true); try { await onStart(); } finally { setBusy(false); } }
  // Only QR guest orders have a change window ("Müşteri değiştirebilir"); staff, masasız and platform orders start at once.
  const deadline = order.source !== 'qr' ? 0 : order.editableUntil ? Date.parse(order.editableUntil) : Date.parse(order.createdAt) + seconds * 1000;
  // The countdown shows whole seconds: tick once a second, and only while it is running.
  useEffect(() => { if (order.status !== 'new' || deadline <= Date.now()) return; const timer = setInterval(() => { setNow(Date.now()); if (Date.now() >= deadline) clearInterval(timer); }, 1000); return () => clearInterval(timer); }, [order.status, deadline]);
  const paymentBlocked = !!order.paymentBeforePreparation && !order.paid;
  const remaining = order.status === 'new' ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  const blocked = order.cancelRequested || remaining > 0 || paymentBlocked;
  return <><button className={`btn full kitchen-step ${order.status === 'ready' ? 'secondary' : 'primary'}`} disabled={blocked || busy} onClick={() => void start()}>{busy ? 'Kaydediliyor…' : order.cancelRequested ? 'İptal talebi bekleniyor' : paymentBlocked ? 'Ödeme bekleniyor' : remaining > 0 ? `Müşteri değiştirebilir · ${remaining} sn` : order.status === 'new' ? (order.paymentBeforePreparation ? 'Ödeme alındı · Hazırlamaya başla' : 'Hazırlamaya başla') : order.status === 'preparing' ? 'Hazır olarak işaretle' : order.external && order.external.deliveryType !== 'gel-al' ? 'Kuryeye teslim edildi' : 'Teslim edildi'}{!blocked && !busy && <Check size={16} />}</button>{!order.cancelRequested && paymentBlocked && <p className="hold-hint">Kasiyer tahsilatı kaydettiğinde otomatik açılır.</p>}</>;
}
