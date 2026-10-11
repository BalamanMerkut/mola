import { businessDay } from './business-day.js';

/*
 * QR siparişleri açık mı? (sahibin kararları, 8 Ekim). The guest menu is always visible; ordering from the phone is open only
 * while ALL of these hold:
 *   - a staff screen that would see the order is connected now (kitchen, waiter, cashier, Müdür or the owner at the café; never
 *     the owner's remote device): server/qr-ordering.ts counts recent polls, with a grace period so a tablet that sleeps for a
 *     moment does not flap it;
 *   - not paused after gün sonu: a completed gün sonu pauses it until someone taps "Aç", the cash day is opened again or the
 *     next business day (05:00) begins;
 *   - not stopped by hand ("QR siparişlerini durdur", cashier, Müdür, owner); a reminder after 30 minutes.
 * There is no closing-hour setting (rejected by the owner). Platform (delivery) orders and staff orders are not affected.
 * No imports beyond the business day: the screens use the same texts.
 */
export type QrOrderingReason = 'staff' | 'closing' | 'stopped' | 'offline';
/** Kept in the business's State (`qrOrdering`); missing = never stopped or paused. */
export type QrOrderingState = {
  /** "QR siparişlerini durdur": when and by whom (name for the chip; the id is in the audit). */
  stopped?: { at: string; by: string; byName: string };
  /** Gün sonu completed: paused for the rest of that business day (`day`), until "Aç" or the cash day is opened again. */
  paused?: { at: string; day: string; byName?: string };
};
/** What the staff screens show (StaffSnapshot.qrOrdering) and what the café tells Mola Merkez. */
export type QrOrderingView = {
  open: boolean; reason?: QrOrderingReason;
  /** Since when it is stopped or paused (the 30-minute reminder counts from `since` of a manual stop). */
  since?: string; byName?: string;
  /** "Garson çağır" and "Hesabı iste" work while a staff screen is connected (whatever the other two say). */
  call: boolean;
  /** This viewer may stop and reopen (cashier, Müdür, owner). */
  canChange?: boolean;
};
/** A connected staff screen is one that polled within this long: a short sleep does not close ordering. */
export const QR_STAFF_WINDOW_MS = 90_000;
/** "QR siparişleri 30 dakikadır kapalı · Aç": the reminder after a manual stop. */
export const QR_REMIND_MS = 30 * 60_000;
/** The roles whose screens may stop and reopen QR ordering. */
export const QR_CHANGERS = ['owner', 'manager', 'cashier'] as const;

/** The pause that holds now (a manual stop first, then the gün sonu pause of this business day). */
export function qrPause(state: QrOrderingState | undefined, now: number): { reason: 'stopped' | 'closing'; since: string; byName?: string } | undefined {
  if (state?.stopped) return { reason: 'stopped', since: state.stopped.at, byName: state.stopped.byName };
  if (state?.paused && state.paused.day === businessDay(now)) return { reason: 'closing', since: state.paused.at, ...(state.paused.byName ? { byName: state.paused.byName } : {}) };
  return undefined;
}
/** The whole rule: the pause or stop first (one tap reopens those), else whether a staff screen is connected. */
export function qrOrderingView(state: QrOrderingState | undefined, staffConnected: boolean, now: number): QrOrderingView {
  const pause = qrPause(state, now);
  if (pause) return { open: false, reason: pause.reason, since: pause.since, ...(pause.byName ? { byName: pause.byName } : {}), call: staffConnected };
  return staffConnected ? { open: true, call: true } : { open: false, reason: 'staff', call: false };
}
/** "personel ekranı bağlı değil", "gün sonu yapıldı", "elle durduruldu" (the phone bar's and Mola Yönetim's reason). */
export function qrReasonText(reason: QrOrderingReason | undefined) {
  return reason === 'staff' ? 'personel ekranı bağlı değil' : reason === 'closing' ? 'gün sonu yapıldı' : reason === 'stopped' ? 'elle durduruldu' : reason === 'offline' ? 'kafenin interneti yok' : '';
}
/**
 * The sidebar card's second line while closed (10 Ekim, src/QrOrdering.tsx): why, in the owner's words. "Gün sonu yapıldı ·
 * müşteriler telefondan sipariş veremiyor", "Elle durduruldu (Ayşe)", "Personel ekranı bağlı değil".
 */
export function qrClosedLine(v: Pick<QrOrderingView, 'reason' | 'byName'>) {
  const by = v.byName ? ` (${v.byName})` : '';
  return v.reason === 'closing' ? 'Gün sonu yapıldı · müşteriler telefondan sipariş veremiyor'
    : v.reason === 'stopped' ? `Elle durduruldu${by}`
    : v.reason === 'staff' ? 'Personel ekranı bağlı değil'
    : v.reason === 'offline' ? 'Kafenin interneti yok' : 'Müşteriler telefondan sipariş veremiyor';
}
/** The guest's line while the café says no (staff, gün sonu, stopped). */
export const QR_CLOSED_TEXT = { tr: 'Şu an sipariş almıyoruz, lütfen garsonunuza sorun.', en: 'We are not taking orders right now. Please ask your waiter.' };
/** The guest's line while the café cannot be reached (Mola Merkez serves the menu copy; tunnel down, café computer off). */
export const QR_OFFLINE_TEXT = { tr: 'Şu an sipariş alınamıyor, lütfen garsonunuza sorun.', en: 'Orders cannot be placed right now. Please ask your waiter.' };
/** The confirmation of "QR siparişlerini durdur" (owner's wording). */
export const QR_STOP_CONFIRM = 'Emin misiniz? Müşteriler telefondan sipariş veremez. Menü görünmeye devam eder, siparişleri garsonlar alır.';
