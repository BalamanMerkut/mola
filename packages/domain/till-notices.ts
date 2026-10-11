import type { Role, State } from './types.js';

/*
 * "Sahip iadeyi yaptı" (9 Ekim kullanıcı testi, K-A): the owner (or the Müdür) does a refund from a phone or another screen,
 * the guest waits at the till and the cashier hands the money over. The cashier's Masalar shows a short green strip
 * ("Sahip iadeyi yaptı: Masa 02 · ₺190 nakit. Parayı müşteriye verin.") and the yazar kasa refund card comes onto the
 * cashier's screen. Kept in the state for a few hours; each person closes it for themselves (`seenBy`).
 */
export type TillNotice = { id: string; refundId: string; paymentId: string; tableName: string; amount: number; method: 'cash' | 'card'; by: string; byName: string; byRole: Role; at: string; seenBy: string[] };
/** What a counter screen gets in its snapshot. */
export type PublicTillNotice = Omit<TillNotice, 'seenBy' | 'by'>;

/** How long a strip waits for the cashier; after that the refund is old news (it is in the reports anyway). */
export const TILL_NOTICE_MS = 3 * 3600_000;
const MAX_NOTICES = 30;
/** Roles whose refunds are not done at the till itself: their cash leaves the drawer through someone else's hands. */
export const awayFromTill = (role: string) => role === 'owner' || role === 'manager';
/** Roles that stand at the till and get the strip (never the person who did the refund). */
export const atTill = (role: string) => role === 'cashier' || role === 'manager';

export function pruneTillNotices(list: TillNotice[], now: number) {
  return list.filter(n => now - Date.parse(n.at) < TILL_NOTICE_MS).slice(-MAX_NOTICES);
}
export function addTillNotice(s: State, notice: Omit<TillNotice, 'seenBy'>, now: number) {
  const list = pruneTillNotices(s.tillNotices ?? [], now);
  if (!list.some(n => n.refundId === notice.refundId)) list.push({ ...notice, seenBy: [] });
  s.tillNotices = list;
}
/** The strips one person at the till still has to see, newest first. */
export function tillNoticesFor(s: State, viewer: { id: string; role: string }, now: number): PublicTillNotice[] {
  if (!atTill(viewer.role)) return [];
  return pruneTillNotices(s.tillNotices ?? [], now).filter(n => n.by !== viewer.id && !n.seenBy.includes(viewer.id)).reverse()
    .map(({ seenBy: _seen, by: _by, ...n }) => n);
}
export function markTillNoticeSeen(s: State, viewer: string, id: string, now: number) {
  s.tillNotices = pruneTillNotices(s.tillNotices ?? [], now).map(n => n.id === id && !n.seenBy.includes(viewer) ? { ...n, seenBy: [...n.seenBy, viewer] } : n);
}
/** "Sahip iadeyi yaptı: Masa 02 · ₺190 nakit. Parayı müşteriye verin." */
export function tillNoticeText(n: Pick<PublicTillNotice, 'byRole' | 'tableName' | 'method'> & { money: string }) {
  const who = n.byRole === 'manager' ? 'Müdür' : 'Sahip';
  return `${who} iadeyi yaptı: ${n.tableName} · ${n.money} ${n.method === 'card' ? 'kart' : 'nakit'}. ${n.method === 'card' ? 'Kart iadesini POS cihazından yapın.' : 'Parayı müşteriye verin.'}`;
}
