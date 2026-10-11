import { useState } from 'react';
import { Check, Plus, ShoppingBag, Wallet } from 'lucide-react';
import type { PublicOrder, StaffSnapshot, TableView } from '../packages/domain/types';
import { LABEL_MAX, stageNames, takeawayLabel, takeawayStage, type TakeawayStage } from '../packages/domain/takeaway';
import { money, requestId } from './api';
import { Composer, Empty, Modal, Notice, OrderLines, Status } from './components';
import { HelpTip } from './HelpTip';
import { PlatformBadge } from './PlatformBadge';
import { orderCancellable } from './StaffCancel';
import './takeaway.css';
// Mutfak fişi modu: a printed (Hazırlanıyor) order is handed over without a "Hazır" step.
import { canHandOver, counterRole, deliverEarly, platformReady, ticketMode } from './KitchenTickets';

// Masasız satış (`takeaway` in code): one choice in Sipariş al, a small strip on Masalar while tickets are open, and one
// ticket's window. Always available; there is no setting for it.

const title = (t: TableView) => t.takeaway?.label ? `${t.name} · ${t.takeaway.label}` : t.name;
const ticketOrders = (data: StaffSnapshot, t: TableView) => data.orders.filter(o => o.takeaway?.tableId === t.id);
export const noTableHint = 'Masaya bağlı olmayan satış: tezgâhtan alıp giden ya da ayakta bekleyen müşteri.';

/** First choice above the tables in Sipariş al: dashed, so it never reads as one more table. */
export function NoTableChoice({ onChoose }: { onChoose: () => void }) {
  return <button type="button" className="no-table-choice" onClick={onChoose}><ShoppingBag size={22} aria-hidden="true" /><span><strong>Masasız sipariş</strong><small>{noTableHint}</small></span></button>;
}

/** New ticket: an optional first name to call out, then the staff menu. The number comes with the first order. */
/** `onSent` gets the new ticket's id too: whoever takes money goes straight on to its payment. */
export function TakeawayOrder({ data, enabled, onClose, onSent }: { data: StaffSnapshot; enabled: boolean; onClose: () => void; onSent: (message: string, tableId?: string) => void }) {
  const [label, setLabel] = useState('');
  const valid = takeawayLabel(label) !== null;
  return <Modal title="Masasız sipariş" wide onClose={onClose}><div className="modal-body takeaway-order">
    <p className="muted small">{noTableHint} Numara siparişi gönderince verilir; sipariş mutfağa “MASASIZ” olarak düşer, ödemesi kasada alınır.</p>
    <label className="takeaway-label-field">Müşteri adı (isteğe bağlı)<HelpTip title="Müşteri adı">Sipariş hazır olduğunda seslenmek için kısa bir isim yazabilirsiniz, örneğin “Ahmet”. Telefon numarası yazmayın; sipariş numarası yeterlidir.</HelpTip><input aria-label="Müşteri adı" value={label} maxLength={LABEL_MAX + 8} placeholder="Örn. Ahmet" autoComplete="off" onChange={e => setLabel(e.target.value)} /></label>
    {!valid && <Notice tone="error">En fazla {LABEL_MAX} karakterlik kısa bir isim yazın. Telefon numarası yazmayın.</Notice>}
    <Composer quickCode={data.role !== 'waiter'} tableName="Masasız sipariş" takeaway={{ label }} products={data.products} categoryOrder={data.categories} subcategoryOrder={data.subcategories} tableId="" enabled={enabled && valid} onSent={result => onSent(`Masasız #${result?.takeawayNumber ?? ''} mutfağa gönderildi.`, result?.tableId)} />
  </div></Modal>;
}

type Filter = 'all' | TakeawayStage;
/** What the strip's buttons do: "Hazır" (platform orders in Fiş modu) or "Teslim edildi" for one order. */
export type TicketStep = (order: PublicOrder, status: 'ready' | 'served', message: string) => void;
/** "Kuryeye teslim edildi" for a courier platform order, "Teslim edildi" otherwise. */
const deliverText = (ext?: PublicOrder['external']) => ext && ext.deliveryType !== 'gel-al' ? 'Kuryeye teslim edildi' : 'Teslim edildi';
/**
 * The buttons a ticket offers this screen (5 Oct decisions):
 * - ready (or printed, Fiş modu) orders: "Teslim edildi" for everyone but the kitchen, paid or not (unpaid stays in the strip);
 * - paid masasız orders the kitchen is still on: "Teslim edildi" for the counter (cashier, Müdür, owner) with a small note,
 *   so the cashier decides when the waiting customer takes it;
 * - Fiş modu platform orders: "Hazır" (tells the platform) and "Kuryeye teslim edildi" for the counter, as no kitchen
 *   screen says "Hazır".
 */
export function ticketActions(data: StaffSnapshot, orders: PublicOrder[]) {
  const ticket = ticketMode(data), counter = counterRole(data.role);
  if (data.role === 'kitchen') return { deliver: [], ready: [], note: '' };
  const handOver = orders.filter(o => canHandOver(o, ticket)), early = counter ? orders.filter(o => !canHandOver(o, ticket) && deliverEarly(o)) : [];
  const ready = counter ? orders.filter(o => platformReady(o, ticket)) : [];
  // Fiş modu: a platform order is handed over from the counter too, "Hazır" or not.
  return { deliver: [...handOver, ...early], ready, note: early.length ? ticket ? 'Mutfağa henüz basılmadı' : 'Mutfakta hazırlanıyor' : '' };
}
/** Compact strip of open tickets: number, name, kitchen stage and payment. Only while some are open; a paid, handed-over
 * ticket leaves it. Stage filters only once the strip gets long, so a normal day stays one glance. */
export function TakeawayStrip({ data, onOpen, onStatus }: { data: StaffSnapshot; onOpen: (id: string) => void; onStatus: TicketStep }) {
  const [filter, setFilter] = useState<Filter>('all');
  const tickets = (data.takeaways ?? []).map(t => { const orders = ticketOrders(data, t); return { t, orders, stage: takeawayStage(orders) }; })
    .sort((a, b) => a.t.takeaway!.day.localeCompare(b.t.takeaway!.day) || a.t.takeaway!.number - b.t.takeaway!.number);
  if (!tickets.length) return null;
  const filters = tickets.length > 6, active = filters ? filter : 'all';
  const shown = tickets.filter(x => active === 'all' || x.stage === active);
  const count = (f: Filter) => f === 'all' ? tickets.length : tickets.filter(x => x.stage === f).length;
  return <section className="takeaway-strip" aria-labelledby="takeaway-strip-title">
    <div className="section-heading"><h2 id="takeaway-strip-title"><ShoppingBag size={18} aria-hidden="true" />Masasız siparişler <span>{tickets.length} açık</span></h2>
      {filters && <div className="segmented" role="group" aria-label="Masasız sipariş filtresi">{(['all', 'new', 'preparing', 'ready', 'served'] as const).map(f => <button key={f} aria-pressed={active === f} className={active === f ? 'selected' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'Tümü' : stageNames[f]} <small>{count(f)}</small></button>)}</div>}</div>
    {!shown.length ? <p className="takeaway-empty muted small">Bu durumda masasız sipariş yok.</p>
      : <div className="takeaway-list">{shown.map(({ t, orders, stage }) => {
        const due = t.account?.balance ?? 0, ext = orders.find(o => o.external)?.external, { deliver, ready, note } = ticketActions(data, orders);
        return <article className={`takeaway-card stage-${stage ?? 'empty'}`} key={t.id} data-ticket={t.takeaway!.number}>
          <button className="takeaway-open" onClick={() => onOpen(t.id)} aria-label={`${title(t)} · ${stage ? stageNames[stage] : 'Sipariş yok'}`}>
            {ext ? <PlatformBadge source={ext} code /> : <strong>{t.name}</strong>}{t.takeaway?.label && <span className="takeaway-name">{t.takeaway.label}</span>}
            {/* One status line (8 Ekim denetimi K7): "Yeni sipariş", "Ödendi" and "Mutfakta hazırlanıyor" stood side by side. */}
            <span className="takeaway-stage">{stage ? stageNames[stage] : 'Sipariş yok'} · {t.account && due > 0 ? `Ödeme bekliyor · ${money(due)}` : 'Ödendi'}</span>
          </button>
          {ready.length > 0 && <button className="takeaway-serve takeaway-ready" onClick={() => ready.forEach(o => onStatus(o, 'ready', `${o.tableName} hazır. Platforma bildiriliyor.`))}><Check size={14} />Hazır</button>}
          {deliver.length > 0 && <><button title={note || undefined} className="takeaway-serve" onClick={() => deliver.forEach(o => onStatus(o, 'served', `${o.tableName} teslim edildi.`))}><Check size={14} />{deliverText(ext)}</button></>}
        </article>;
      })}</div>}
  </section>;
}

/** One ticket's window: its orders, adding more, payment and handing over. No QR, area, cleaning or table move here. */
export function TakeawayDetail({ data, ticket, onClose, onAdd, onPay, onAction, onCancel }: { data: StaffSnapshot; ticket: TableView; onClose: () => void; onAdd: () => void; onPay: () => void; onAction: (path: string, body: unknown, message: string) => void; onCancel?: (order: PublicOrder) => void }) {
  const owner = data.role === 'owner' || data.role === 'manager', cashier = ['owner', 'manager', 'cashier'].includes(data.role), account = ticket.account;
  const orders = ticketOrders(data, ticket), ext = orders.find(o => o.external)?.external;
  return <Modal title={title(ticket)} onClose={onClose} wide><div className="modal-body takeaway-detail">
    <div className="table-detail-summary"><div><span className="muted">{account ? 'Kalan hesap' : 'Hesap'}</span><h2>{account ? money(account.balance) : 'Ödendi'}</h2></div>{ext ? <PlatformBadge source={ext} /> : <span className="table-pill"><ShoppingBag size={15} />Masasız · QR yok</span>}</div>
    {!orders.length && <Empty title="Bu masasız hesapta sipariş yok" detail="Ürün ekleyebilir veya boş hesabı kapatabilirsiniz." />}
    {orders.map(o => <div className="detail-order" key={o.id}><div className="order-head"><strong>#{o.number} · {o.guestLabel}</strong><Status value={o.status} /></div><OrderLines order={o} />
      {onCancel && orderCancellable(o) && <button className="text-btn order-cancel-open" aria-label={`Sipariş #${o.number} · iptal et`} onClick={() => onCancel(o)}>İptal et</button>}
      {owner && o.cancelRequested && <Notice>İptal talebi var.<button className="text-btn" onClick={() => onAction('/api/staff/cancel', { requestId: requestId(), orderId: o.id, version: o.version }, 'Sipariş iptal edildi.')}>İptali onayla</button></Notice>}
      {counterRole(data.role) && platformReady(o, ticketMode(data)) && <button className="btn secondary small-btn" onClick={() => onAction('/api/staff/status', { requestId: requestId(), orderId: o.id, version: o.version, status: 'ready' }, `${ticket.name} hazır. Platforma bildiriliyor.`)}><Check size={15} />Hazır</button>}
      {data.role !== 'kitchen' && (canHandOver(o, ticketMode(data)) || (counterRole(data.role) && deliverEarly(o))) && <>{!canHandOver(o, ticketMode(data)) && <small className="muted takeaway-detail-note">{ticketMode(data) ? 'Mutfağa henüz basılmadı' : 'Mutfakta hazırlanıyor'}</small>}<button className="btn secondary small-btn" onClick={() => onAction('/api/staff/status', { requestId: requestId(), orderId: o.id, version: o.version, status: 'served' }, `${ticket.name} teslim edildi.`)}><Check size={15} />{deliverText(ext)}</button></>}
    </div>)}
    <div className="modal-actions table-detail-actions">
      {account && <button className="btn secondary" onClick={onAdd}><Plus size={17} />Ürün ekle</button>}
      {cashier && account && (account.balance > 0 ? <button className="btn primary" onClick={onPay}><Wallet size={17} />Ödeme al</button> : account.total > 0 ? <span className="notice">Ödendi · Teslim bekleniyor</span> : <button className="btn primary" onClick={() => onAction('/api/staff/close-empty', { requestId: requestId(), accountId: account.id }, 'Boş masasız hesap kapatıldı.')}>Boş hesabı kapat</button>)}
      {!account && <span className="notice">Ödendi · Müşteri alınca “Teslim edildi”ye basın</span>}
    </div>
  </div></Modal>;
}
