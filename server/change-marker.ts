import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/*
 * "Değişiklik işareti" (server/backup-scheduler.ts): whether anything a backup must hold changed since the last backup read
 * the database. The 03:30 run and the morning catch-up skip the backup when the newest verified one already holds every real
 * change (at least one a week still runs).
 *
 * A real change is a successful write request of a person (staff, guest, owner, the owner's phone, Mola destek: all come in
 * through the same /api routes) or an order a delivery platform sent (server/integrations/manager.ts). Background sweeps
 * (shifts, notifications, reservations, automatic expenses, stock, history clean-up) never count: they follow from the data
 * and the clock and come back the same after a restore.
 *
 * Every non-GET /api route is listed in exactly one of the two lists below (tests/backup-skip.test.ts checks every route the
 * app registers). A route in neither list still counts as a change: forgetting one costs a backup, never a lost day.
 */
/** Sign-in and sessions, presence, "seen/read" marks, print jobs, read-only POSTs and the computer's own tools. */
export const NOT_A_CHANGE: readonly string[] = [
  '/api/login', '/api/logout', '/api/staff/sessions/end', '/api/staff/heartbeat', '/api/guest/session',
  '/api/staff/lock', '/api/staff/unlock', '/api/staff/activity', '/api/staff/report-security/verify',
  '/api/staff/notifications/read', '/api/staff/announcements/read', '/api/staff/announcements/ack',
  '/api/staff/package/notice-seen', '/api/staff/printers/notice-seen', '/api/staff/update/seen',
  // "Gittim" on a long-open table's reminder: only when the next reminder may come.
  '/api/staff/tables/checked',
  // social-qr: reads the permanent QR address (Mola Merkez keeps the code; a restore gets it back with the next heartbeat).
  '/api/staff/photo-source', '/api/staff/social-qr', '/api/staff/support/sync', '/api/staff/email-reports/test', '/api/staff/update/install',
  '/api/staff/print/order', '/api/staff/print/bill', '/api/staff/print/payment', '/api/staff/print/kitchen', '/api/staff/printers/test', '/api/staff/cash/print',
  '/api/desktop/backup', '/api/desktop/open-backups', '/api/desktop/shutdown', '/api/desktop/firewall', '/api/desktop/unlock', '/api/desktop/unlock/retry',
  '/api/desktop/restore/merkez/open', '/api/desktop/recovery/show', '/api/desktop/second-backup', '/api/desktop/open-second',
  // İşletmem var: the sign-in and the e-mail code on a clean install (the restore itself replaces the data folder).
  '/api/desktop/owner-login/start', '/api/desktop/owner-login/verify',
  // Yeni bilgisayar için e-posta: kept by Mola Merkez, not in this computer's data.
  '/api/staff/owner-email/old-code', '/api/staff/owner-email/new-code', '/api/staff/owner-email/confirm', '/api/staff/owner-email/lock',
];
/** Orders, payments, menu, tables, settings, staff, expenses, cash, stock, shifts, reservations, platforms, licence, support… */
export const REAL_CHANGES: readonly string[] = [
  // Orders, payments, the floor
  '/api/guest/orders', '/api/guest/orders/edit', '/api/guest/call', '/api/guest/cancel',
  '/api/staff/orders', '/api/staff/takeaway/orders', '/api/staff/status', '/api/staff/status/undo', '/api/staff/cancel', '/api/staff/orders/cancel', '/api/staff/orders/change',
  '/api/staff/cancel-decline', '/api/staff/payments', '/api/staff/tables/move', '/api/staff/tables/clean', '/api/staff/close-empty', '/api/staff/accounts/merge',
  '/api/staff/orders/review', '/api/staff/calls/resolve', '/api/staff/block', '/api/staff/deliver-all', '/api/staff/print/handled',
  '/api/staff/payment-adjustments', '/api/staff/refunds', '/api/staff/refunds/requests', '/api/staff/refunds/requests/decline', '/api/staff/refunds/till-notices/seen', '/api/staff/fiscal/mark',
  // Menu, tables, settings
  '/api/staff/products', '/api/staff/products/discard-draft', '/api/staff/photos', '/api/staff/catalog/remove', '/api/staff/photo-trash', '/api/staff/photo-trash/restore',
  '/api/staff/categories', '/api/staff/campaigns', '/api/staff/vat', '/api/staff/vat/apply', '/api/staff/approval-mode', '/api/staff/settings', '/api/staff/qr-printed', '/api/staff/qr-ordering',
  '/api/staff/tables/add', '/api/staff/tables/area', '/api/staff/tables/layout', '/api/staff/tables/area-rename', '/api/staff/table-reminder',
'/api/staff/tables/remove', '/api/staff/tables/renew-qr', '/api/staff/business-profile', '/api/staff/social-links',
  '/api/staff/sounds', '/api/staff/assignments', '/api/staff/printers', '/api/staff/printers/delete', '/api/staff/kitchen-mode', '/api/staff/first-steps',
  '/api/staff/email-reports', '/api/staff/email-reports/retry', '/api/staff/lock/settings', '/api/staff/update/settings', '/api/staff/demo/reset',
  // Staff and security
  '/api/staff/users', '/api/staff/users/update', '/api/staff/users/password', '/api/staff/password', '/api/staff/setup',
  '/api/staff/report-security/setup', '/api/staff/report-security/enable', '/api/staff/report-security/recover',
  '/api/staff/remote-support', '/api/staff/remote-support/end', '/api/staff/remote-reports/pair', '/api/staff/remote-reports/pair/cancel', '/api/staff/remote-reports/phones/remove',
  '/api/staff/remote-admin', '/api/staff/remote-admin/end-all',
  '/api/desktop/owner-password/owners', '/api/desktop/owner-password', '/api/desktop/owner-password/vendor/owners', '/api/desktop/owner-password/vendor',
  '/api/desktop/restore', '/api/desktop/restore/merkez', '/api/desktop/recovery/confirm', '/api/desktop/recovery/new',
  // Money, stock, shifts, reservations, notes
  '/api/staff/expenses', '/api/staff/expenses/edit', '/api/staff/expenses/delete', '/api/staff/recurring-expenses', '/api/staff/recurring-expenses/delete',
  '/api/staff/cash/open', '/api/staff/cash/movements', '/api/staff/cash/count', '/api/staff/cash/finish', '/api/staff/cash/closing-shift', '/api/staff/cash/corrections', '/api/staff/cash/settings', '/api/staff/cash/revoke', '/api/staff/cash/receipts',
  '/api/staff/stock/items', '/api/staff/stock/items/delete', '/api/staff/stock/recipes', '/api/staff/stock/purchase', '/api/staff/stock/count', '/api/staff/stock/waste',
  '/api/staff/stock/return', '/api/staff/stock/entries/delete', '/api/staff/stock/answer', '/api/staff/profit/settings',
  '/api/staff/shifts/start', '/api/staff/shifts/end', '/api/staff/shifts/plan', '/api/staff/shifts/roles', '/api/staff/shifts/correct',
  '/api/staff/reservations', '/api/staff/reservations/cancel', '/api/staff/reservations/seat', '/api/staff/reservations/wait', '/api/staff/reservations/no-show',
  '/api/staff/reservations/deposit', '/api/staff/reservations/settings', '/api/staff/reservations/walk-in', '/api/staff/reservations/guest-name', '/api/staff/reservations/close-with-deposit',
  '/api/staff/events', '/api/staff/events/update', '/api/staff/events/start', '/api/staff/events/close', '/api/staff/events/table-name',
  '/api/staff/agenda', '/api/staff/agenda/delete',
  // Delivery platforms
  '/api/staff/integrations/demo', '/api/staff/integrations/credentials', '/api/staff/integrations/credentials/remove', '/api/staff/integrations/settings',
  '/api/staff/integrations/mapping', '/api/staff/integrations/test-order', '/api/staff/integrations/orders/accept', '/api/staff/integrations/orders/reject',
  '/api/staff/integrations/orders/cancel', '/api/staff/integrations/orders/retry',
  // Activation, licence, support (a queued message lives only here until it reaches Mola Merkez)
  '/api/activation/trial', '/api/activation/application', '/api/activation/code', '/api/activation/owner', '/api/staff/license/agreement', '/api/staff/license/freeze',
  '/api/staff/support', '/api/staff/support/reply', '/api/staff/support/attachments',
];
const ignored = new Set(NOT_A_CHANGE);
/** Does a finished request of this method and path count as a real change? Reads never do; an unlisted write does. */
export function isRealChange(method: string, url: string) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return false;
  const path = url.split('?')[0].replace(/\/+$/, '').toLowerCase();
  return path.startsWith('/api/') && !ignored.has(path);
}

/** What a backup holds: the marker's identity (a restored database brings another) and its change count. */
export type ChangeMark = { instance: string; seq: number };
type Saved = { instance: string; seq: number; armed: number; changedAt?: string; open?: boolean };
/**
 * Kept in the database itself (one small row, no business data), so a restored copy brings its own marker: its identity then
 * matches no backup in this computer's folder and the next run backs it up. `seq` moves on only at the first real change after
 * a backup read the database (`armed`), so a busy day costs one write, not one per order.
 */
export class ChangeMarker {
  private state: Saved;
  constructor(private db: DatabaseSync, private now: () => Date = () => new Date()) {
    db.exec('CREATE TABLE IF NOT EXISTS backup_marker (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)');
    let saved: Partial<Saved> | undefined;
    try { saved = JSON.parse((db.prepare('SELECT payload FROM backup_marker WHERE id = 1').get() as { payload: string } | undefined)?.payload ?? 'null') ?? undefined; } catch { saved = undefined; }
    const valid = !!saved && typeof saved.instance === 'string' && /^[a-f0-9-]{36}$/.test(saved.instance) && Number.isSafeInteger(saved.seq) && Number.isSafeInteger(saved.armed);
    // New or unreadable: a fresh identity that no backup holds yet, already "changed".
    this.state = valid ? saved as Saved : { instance: randomUUID(), seq: 1, armed: 0 };
    if (!valid) this.save();
  }
  private save() {
    try { this.db.prepare('INSERT INTO backup_marker (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload').run(JSON.stringify(this.state)); }
    catch { /* closed database (shutting down): the in-memory mark still counts for this run */ }
  }
  /** A real change. Cheap: only the first one after a backup started writes anything. */
  changed() {
    if (this.state.seq !== this.state.armed) return;
    this.state = { ...this.state, seq: this.state.seq + 1, changedAt: this.now().toISOString() };
    this.save();
  }
  /** Right before a backup reads the database: what it will hold. The next real change moves the count on. */
  arm(): ChangeMark {
    this.state = { ...this.state, armed: this.state.seq };
    this.save();
    return this.current();
  }
  current(): ChangeMark { return { instance: this.state.instance, seq: this.state.seq }; }
  /** Changed since the last backup started (or never backed up). */
  get dirty() { return this.state.seq !== this.state.armed; }
  get changedAt() { return this.state.changedAt; }
  /**
   * The server starts. Left "open" by the previous run (power cut, killed process, a restored copy of a running database):
   * a write may have been saved without its mark, so it counts as a change.
   */
  open() {
    const unclean = !!this.state.open;
    this.state = { ...this.state, open: true };
    this.save();
    if (unclean) this.changed();
    return unclean;
  }
  /** A clean stop. */
  close() { if (!this.state.open) return; this.state = { ...this.state, open: false }; this.save(); }
}
