import { useState } from 'react';
import { QrCode } from 'lucide-react';
import { QR_REMIND_MS, QR_STOP_CONFIRM, qrClosedLine, qrReasonText, type QrOrderingView } from '../packages/domain/qr-ordering';
import { api, requestId } from './api';
import { Modal } from './components';
import './qr-ordering.css';

/*
 * QR siparişleri açık mı? (8 Ekim; the rule: packages/domain/qr-ordering.ts, the server: server/qr-ordering.ts). 10 Ekim
 * (sahibin onayı): the state moved from a small top-bar chip to where the eye goes first.
 *   QrOrderingCard  the top of the sidebar, under the business card (owner, Müdür, cashier; a waiter's tablet sees it too,
 *                   without buttons): a calm green "QR siparişleri açık · Müşteriler telefondan sipariş verebilir · Durdur",
 *                   or an amber "QR siparişleri kapalı" with the reason and "Siparişleri aç" where one tap may reopen it.
 *                   "Durdur" asks first in the owner's words ("Emin misiniz? …" Durdur / Vazgeç).
 *   QrOrderingBar   a slim strip at the top of the page. Wide screens: only while closed, on Masalar ("QR siparişleri kapalı:
 *                   müşteriler masadan sipariş veremiyor · Aç"), and on every screen once a manual stop is 30 minutes old
 *                   (the reminder). Phones (no sidebar): the card's state in one line, under the top bar; while open only for
 *                   those who may stop it (the waiter's phone keeps the closed line only).
 * "Aç" is one tap (no question). The state comes with the 2 s snapshot (StaffSnapshot.qrOrdering); a change reloads it.
 */
async function change(open: boolean) { return api<QrOrderingView>('/api/staff/qr-ordering', { requestId: requestId(), open }); }
/** A closed state one tap can open: a manual stop or the gün sonu pause (a missing staff screen cannot be tapped open). */
const reopenable = (v: QrOrderingView) => !v.open && !!v.canChange && (v.reason === 'stopped' || v.reason === 'closing');
/** Minutes or hours a stop has lasted ("45 dakikadır", "2 saattir"). */
const lasted = (ms: number) => { const m = Math.floor(ms / 60_000); return m < 60 ? `${m} dakikadır` : `${Math.floor(m / 60)} saattir`; };
/** How long a manual stop has lasted once it is 30 minutes old (the reminder), else 0. */
function stoppedFor(v: QrOrderingView, now: number) {
  const since = Date.parse(v.since ?? '');
  return !v.open && v.reason === 'stopped' && Number.isFinite(since) && now - since >= QR_REMIND_MS ? now - since : 0;
}

/** Stop (after the question) and reopen, shared by the card and the phone bar. */
function useQrChange(onChanged: () => void, onError: (message: string) => void) {
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  async function run(open: boolean) {
    setBusy(true);
    try { await change(open); setConfirm(false); onChanged(); }
    catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  }
  const dialog = confirm && <Modal title="QR siparişlerini durdur" onClose={() => { if (!busy) setConfirm(false); }}>
    <div className="modal-body qr-ordering-confirm"><p>{QR_STOP_CONFIRM}</p>
      <div className="modal-actions"><button type="button" className="btn primary" disabled={busy} onClick={() => void run(false)}>Durdur</button><button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirm(false)}>Vazgeç</button></div></div>
  </Modal>;
  return { busy, open: () => void run(true), ask: () => setConfirm(true), dialog };
}

type Props = { view: QrOrderingView; now: number; onChanged: () => void; onError: (message: string) => void };

export function QrOrderingCard({ view, now, onChanged, onError }: Props) {
  const q = useQrChange(onChanged, onError), long = stoppedFor(view, now);
  return <><section className={`qr-card ${view.open ? 'is-open' : 'is-closed'}`} aria-label="QR siparişleri" data-testid="qr-ordering-card" data-open={view.open ? 'yes' : 'no'} data-reason={view.reason ?? ''}>
    <div className="qr-card-head"><QrCode size={14} aria-hidden="true" /><strong>QR siparişleri {view.open ? 'açık' : 'kapalı'}</strong></div>
    <div className="qr-card-body">
      <p>{view.open ? 'Müşteriler telefondan sipariş verebilir' : `${qrClosedLine(view)}${long ? ` · ${lasted(long)}` : ''}`}</p>
      {view.open && view.canChange && <button type="button" className="qr-card-stop" data-testid="qr-ordering-stop" aria-label="QR siparişlerini durdur" onClick={q.ask}>Durdur</button>}
    </div>
    {reopenable(view) && <button type="button" className="btn primary qr-card-open" data-testid="qr-ordering-open" disabled={q.busy} onClick={q.open}>Siparişleri aç</button>}
    {!view.open && !view.canChange && view.reason !== 'staff' && <p className="qr-card-hint">Açmak için kasiyere ya da işletme sahibine haber verin.</p>}
  </section>{q.dialog}</>;
}

/** `phone`: no sidebar on this screen. `masalar`: the floor is open (the closed strip belongs there on wide screens). */
export function QrOrderingBar({ view, now, phone, masalar, onChanged, onError }: Props & { phone: boolean; masalar: boolean }) {
  const q = useQrChange(onChanged, onError), long = stoppedFor(view, now);
  if (view.open && !(phone && view.canChange)) return q.dialog || null;
  if (!view.open && !phone && !masalar && !long) return null;
  const text = view.open ? 'QR siparişleri açık'
    : long ? `QR siparişleri ${lasted(long)} kapalı${phone ? '' : ': müşteriler masadan sipariş veremiyor'}`
    : phone ? `QR siparişleri kapalı · ${qrReasonText(view.reason)}` : 'QR siparişleri kapalı: müşteriler masadan sipariş veremiyor';
  return <><div className={`qr-bar ${view.open ? 'is-open' : 'is-closed'}${long ? ' is-long' : ''}${phone ? ' is-phone' : ''}`} role="status" data-testid={long ? 'qr-ordering-reminder' : 'qr-ordering-bar'} data-open={view.open ? 'yes' : 'no'}>
    <span className="qr-bar-dot" aria-hidden="true" /><span className="qr-bar-text">{text}</span>
    {view.open && <button type="button" className="text-btn qr-bar-action" data-testid="qr-ordering-bar-stop" aria-label="QR siparişlerini durdur" onClick={q.ask}>Durdur</button>}
    {reopenable(view) && <button type="button" className="btn primary qr-bar-action" data-testid="qr-ordering-bar-open" disabled={q.busy} onClick={q.open}>Aç</button>}
  </div>{q.dialog}</>;
}
