import { useEffect, useState } from 'react';
import { api } from './api';
import type { NotificationItem } from './notificationActions';

/** Fired after something changed the owner's notifications (read, a new note with a reminder): the bell asks again. */
export const NOTIFICATIONS_CHANGED = 'mola:notifications';
export const notificationsChanged = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));

/** The newest unread notification: the banner says what happened ("İade isteği: Masa 06 · ₺160") and offers its action. */
export type LatestNotification = { id: string; kind: string; title: string };
/** One of the newest unread notifications with its line (10 Ekim): the toast of a screen that is open (src/NotificationToasts.tsx). */
export type RecentNotification = Omit<NotificationItem, 'read'>;
type Count = { unread: number; latest?: LatestNotification; recent?: RecentNotification[] };
/**
 * Unread notifications of the signed-in owner or Müdür (the bell on the top bar), for its count, the banner on Masalar and
 * the toasts. Asks every 15 seconds while the page is visible, when it comes back, and after a change on this device.
 */
export function useUnreadNotifications(enabled: boolean) {
  const [state, setState] = useState<Count>({ unread: 0 });
  useEffect(() => {
    if (!enabled) { setState({ unread: 0 }); return; }
    let live = true;
    const read = () => { if (document.hidden) return; api<Count>('/api/staff/notifications/count').then(r => { if (live) setState({ unread: r.unread, latest: r.latest, recent: r.recent ?? [] }); }).catch(() => { /* the bell waits for the next read */ }); };
    read();
    const timer = setInterval(read, 15000);
    window.addEventListener(NOTIFICATIONS_CHANGED, read); document.addEventListener('visibilitychange', read);
    return () => { live = false; clearInterval(timer); window.removeEventListener(NOTIFICATIONS_CHANGED, read); document.removeEventListener('visibilitychange', read); };
  }, [enabled]);
  return state;
}
/** The banner's one direct action for a notification, when it has one (a cashier's refund request: "İadeyi yap"). */
export const notificationAction = (n?: LatestNotification) => n && /^İade isteği:/.test(n.title) ? 'İadeyi yap' : null;
