import { useState } from 'react';
import { Check, Printer } from 'lucide-react';
import type { PublicOrder, StaffSnapshot } from '../packages/domain/types';
import { canHandOver, openProblems, ticketMode } from './printAlerts';
import { causeAdvice, problemText, type PrintProblem } from '../packages/domain/print-problems';
import { takeawayHeading } from '../packages/domain/takeaway';
import { amountLabel } from '../packages/domain/lines';
import { api, requestId } from './api';
import './kitchen-tickets.css';

/*
 * Mutfak fişi modu (Ayarlar → Sipariş ve mutfak → Mutfak → "Mutfak nasıl çalışıyor?" → Fiş): the kitchen works from printed tickets.
 * - KitchenModeCard (src/KitchenModeCard.tsx): the owner's choice, Ekran / Fiş, with an example of each.
 * - PrintAlerts: the red "Masa 5 siparişi mutfağa basılamadı — Yazıcıda kâğıt yok · Mutfak" warning on the counter and the waiters' phones,
 *   with Tekrar bas / Elle iletildi; it stays until someone handles it (server/printing.ts). Tek mutfak: there is one
 *   kitchen printer, so no "Başka yazıcıya bas".
 * - DeliverOrder / DeliverAll: "Teslim edildi" on the table window (no kitchen says "Hazır" in this mode).
 */
export { canHandOver, counterRole, deliverEarly, hiddenInTicketMode, platformReady, printAlertEvents, ticketMode } from './printAlerts';

const whereOf = (o: PublicOrder) => o.takeaway ? takeawayHeading(o.takeaway.number) : o.tableName;

function ProblemCard({ order, problem, data, onDone, onError }: { order: PublicOrder; problem: PrintProblem; data: StaffSnapshot; onDone: (message: string) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState('');
  // "Tekrar bas" goes to the kitchen printer: the one that failed, or (none was set then, or the role moved) today's one.
  const kitchen = data.printing?.kitchenPrinters?.[0], where = whereOf(order);
  async function run(kind: string, path: string, body: unknown, message: string) {
    setBusy(kind); onError('');
    try { await api(path, body); onDone(message); } catch (e) { onError((e as Error).message); onDone(''); } finally { setBusy(''); }
  }
  const body = { orderId: order.id, printerId: problem.printerId };
  return <article className="print-alert" aria-label={`${where} siparişi mutfağa basılamadı`}>
    <Printer size={20} aria-hidden="true" className="print-alert-icon" />
    <div className="print-alert-body">
      <p className="print-alert-title"><strong>{where} siparişi mutfağa basılamadı</strong> — {problemText(problem.cause, problem.printer)}</p>
      <p className="print-alert-items">#{order.number} · {order.lines.map(l => `${amountLabel(l)} ${l.name}`).join(', ')}</p>{problem.cause !== 'no_printer' && <p className="print-alert-items">{causeAdvice(problem.cause)}</p>}
      <div className="print-alert-actions">
        {kitchen && <button type="button" className="btn primary small-btn" disabled={!!busy} onClick={() => void run('retry', '/api/staff/print/kitchen', kitchen.id === problem.printerId ? body : { ...body, to: kitchen.id }, `${where} siparişi mutfağa basıldı.`)}>{busy === 'retry' ? 'Basılıyor…' : 'Tekrar bas'}</button>}
        <button type="button" className="btn secondary small-btn" disabled={!!busy} title="Siparişi mutfağa kendiniz ilettiniz: uyarı kapanır, kimin kapattığı kayda geçer." onClick={() => void run('manual', '/api/staff/print/handled', body, `${where} siparişi elle iletildi olarak işaretlendi.`)}>Elle iletildi</button>
      </div>
    </div>
  </article>;
}

/** The persistent red warning (Fiş modu) for the owner, the Müdür, the cashier and the waiters, on every view. */
export function PrintAlerts({ data, onDone, onError }: { data: StaffSnapshot; onDone: (message: string) => void; onError: (message: string) => void }) {
  if (!ticketMode(data) || data.role === 'kitchen') return null;
  const problems = openProblems(data.orders), noPrinter = !data.printing?.kitchenPrinters?.length;
  if (!problems.length && !noPrinter) return null;
  return <section className="print-alerts" aria-live="assertive">
    {noPrinter && <div className="print-alert" role="alert"><Printer size={20} aria-hidden="true" className="print-alert-icon" /><div className="print-alert-body"><p className="print-alert-title"><strong>Mutfak fiş modunda ama mutfak fişlerini basan yazıcı yok.</strong></p><p className="print-alert-items">Yeni siparişler mutfağa basılamaz. İşletme sahibi Ayarlar → Cihazlar → Yazıcılar’dan bir yazıcıyı “Mutfak fişleri” için seçmeli ya da Ayarlar → Sipariş ve mutfak → Mutfak’tan “Ekran”a dönmeli.</p></div></div>}
    {problems.map(({ order, problem }) => <ProblemCard key={`${order.id}:${problem.printerId}`} order={order} problem={problem} data={data} onDone={onDone} onError={onError} />)}
  </section>;
}

/** "Teslim edildi" for one order on the table window (Fiş modu: printed orders, there is no "Servise hazır" step). */
export function DeliverOrder({ order, data, onAction }: { order: PublicOrder; data: StaffSnapshot; onAction: (path: string, body: unknown, message: string) => void }) {
  if (!ticketMode(data) || !['owner', 'manager', 'waiter'].includes(data.role) || !canHandOver(order, true)) return null;
  return <button type="button" className="btn secondary small-btn deliver-btn" aria-label={`Sipariş #${order.number} · teslim edildi`} onClick={() => onAction('/api/staff/status', { requestId: requestId(), orderId: order.id, version: order.version, status: 'served' }, `Sipariş #${order.number} teslim edildi.`)}><Check size={15} aria-hidden="true" />Teslim edildi</button>;
}
/** "Hepsini teslim edildi": every printed order of this bill, when there are two or more. */
export function DeliverAll({ accountId, data, onAction }: { accountId: string; data: StaffSnapshot; onAction: (path: string, body: unknown, message: string) => void }) {
  if (!ticketMode(data) || !['owner', 'manager', 'waiter'].includes(data.role)) return null;
  const count = data.orders.filter(o => o.accountId === accountId && canHandOver(o, true)).length;
  if (count < 2) return null;
  return <button type="button" className="btn secondary" onClick={() => onAction('/api/staff/deliver-all', { requestId: requestId(), accountId }, `${count} sipariş teslim edildi.`)}><Check size={17} aria-hidden="true" />Hepsini teslim edildi</button>;
}
