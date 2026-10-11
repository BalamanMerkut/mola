/*
 * A staff basket that is still being written (Sipariş al) lives in this browser tab's sessionStorage, per person and table
 * (Composer `staffBasket`, same format and menu check as the guest's basket), so the 05:00 sign-out or a reload does not lose
 * it: after signing in again the same table opens with the same basket. It is cleared once the order is sent or emptied.
 */
const PREFIX = 'mola-staff-basket:';
export const basketKey = (username: string | undefined, tableId: string) => `${PREFIX}${username ?? ''}:${tableId}`;
const lastKey = (username: string | undefined) => `${PREFIX}${username ?? ''}:last-table`;
/** The table the person was taking an order for, so Sipariş al reopens on it after signing in again. */
export function readLastTable(username: string | undefined) { try { return sessionStorage.getItem(lastKey(username)) ?? ''; } catch { return ''; } }
export function writeLastTable(username: string | undefined, tableId: string) { try { if (tableId) sessionStorage.setItem(lastKey(username), tableId); else sessionStorage.removeItem(lastKey(username)); } catch { /* preference only */ } }
