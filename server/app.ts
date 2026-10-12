import { COMMISSION_TOO_HIGH, commissionAllowed } from '../packages/domain/commission.js';
import { newProductIds } from '../packages/domain/new-products.js';
import { consumeAdminFactor } from './admin-factor.js';
import { integrationRoutes } from './integrations.js';
import { IntegrationManager } from './integrations/manager.js';
import { externalOrderRoutes } from './integrations/routes.js';
import { publicExternalOrders } from '../packages/domain/external-orders.js';
import { ExpiringStore } from './expiring-store.js';
import { businessDayEnd, deviceLabel, SessionBook, staffCookieName, staffToken } from './sessions.js';
import { requestDiagnostics, type FailureEvent } from './request-diagnostics.js';
import { PersistentFailures } from './persistent-failures.js';
import { clientKey, configureHttpSecurity, directLoopback, sessionCookie, type HttpSecurity } from './http-security.js';
import { campaignRoutes } from './campaigns.js';
import { saleProducts } from '../packages/domain/campaigns.js';
import { billVatTotal } from '../packages/domain/vat.js';
import { markTableClean, isOrderPaid } from '../packages/domain/engine.js';
import { MerkezLink } from './kafe-link.js';
import { kafeRoutes } from './kafe-routes.js';
import { businessProfileRoutes } from './business-profile.js';
import { soundSettingsRoutes } from './sound-settings.js';
import { staffOrders } from './staff-orders.js';
import { APP_VERSION } from './license.js';
import { mergeAccounts } from '../packages/domain/merge.js';
import { reviewOrder, setAutomaticApproval } from '../packages/domain/approvals.js';
import { popularProductIds } from '../packages/domain/popular.js';
import { menuCategories, menuNamesEn, menuSubcategories } from '../packages/domain/categories.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor, GuestSnapshot, Role, StaffSnapshot, State } from '../packages/domain/types.js';
import { balances, moveTable, editOrder, changeDeadline, cancelByStaff, changeByStaff, cancelOrder, declineCancellation, closeEmptyAccount, DomainError, once, recordPayment, requireRole, setStatus, undoStatus, submitOrder, submitTakeaway } from '../packages/domain/engine.js';
import type { CafeTable, Order, OrderLine } from '../packages/domain/types.js';
import { floorTables } from '../packages/domain/takeaway.js';
import { sectorOf, sectors } from '../packages/domain/sector.js';
import { guestSocial, socialLinksOf } from '../packages/domain/social-links.js';
import { untouchedStarterMenu } from './sector-templates.js';
import type { Store } from './store.js';
import { savePhoto, readPhotoSource } from './photos.js';
import { photoInventory } from './photo-inventory.js';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AFTER_UPDATE_MS, YearPacker } from './year-packer.js';
import { cashDayOf } from '../packages/domain/cash.js';

export { DEMO_PASSWORD } from './accounts.js';
import { DEMO_PASSWORD, passwordMatches } from './accounts.js';
import { reportSecurity } from './report-security.js';
import { managementRoutes } from './management.js';
import { refundRoutes } from './refunds.js';
import { tillNoticesFor } from '../packages/domain/till-notices.js';
import { PrintService, printingRoutes, printingView } from './printing.js';
import type { BackupScheduler } from './backup-scheduler.js';
import { isRealChange } from './change-marker.js';
import { desktopGuard, desktopRoutes, lanOrigins, paneGuard, type Desktop } from './desktop.js';
import { NetworkProfile } from './network-profile.js';
import { fromThisComputer, recoveryView, restoreRoutes, securityRoutes, type Security } from './security-routes.js';
import { CloudRestore, cloudRestoreRoutes } from './cloud-backup.js';
import { firstStepsRoutes } from './first-steps.js';
import { agendaRoutes } from './agenda.js';
import { floorReservations, reservationReportRoutes, reservationRoutes } from './reservations.js';
import { notificationRoutes } from './notifications.js';
import { stockRoutes } from './stock.js';
import { recurringExpenseRoutes } from './recurring-expenses.js';
import { CashBook, cashReportRoutes, cashRoutes } from './cash-closing.js';
import { shiftRoutes, staffShiftReportRoutes } from './shifts.js';
import type { UpdateAgent } from './update-agent.js';
import { updateRoutes } from './update-routes.js';
import { mobileAppRoutes } from './mobile-app.js';
import { activeCalls, publicBillMethods, publicCalls, requestServiceCall, resolveServiceCall } from '../packages/domain/service-calls.js';
import { isManagement } from '../packages/domain/roles.js';
import { assignmentView } from '../packages/domain/assignments.js';
import { checkTable, DEFAULT_REMINDER_MINUTES, dueReminders, MAX_REMINDER_MINUTES, MIN_REMINDER_MINUTES, reminderMinutes } from '../packages/domain/table-reminders.js';
import { assignmentRoutes } from './assignments.js';
import { emailReportRoutes } from './email-reports.js';
import { reportExportRoutes } from './report-export.js';
import { DEMO_RENEWED, DemoResets, demoResetRoutes } from './demo-reset.js';
// Köprü through Mola Merkez: uzaktan destek ("Mola destek") and uzaktan raporlar (the owner's phone, end to end encrypted).
import { RelayClient } from './relay.js';
import { SupportDesk, supportRoutes } from './support-session.js';
import { RemoteReports, remoteReportRoutes } from './remote-reports.js';
import { ownerLock } from './owner-lock.js';
import { RemoteAdmin, remoteAdminRoutes, type RemoteSessions } from './remote-admin.js';
// Hizmet paketi: services not in this business's package are refused before their routes (server/feature-guard.ts).
import { featureGuard, featureRefusal } from './feature-guard.js';
// İnternetten menü: the guest menu through Mola Merkez for guests on any network (server/guest-tunnel.ts).
import { GuestTunnel, tunnelTestRoute } from './guest-tunnel.js';
// QR siparişleri açık mı (8 Ekim): a staff screen connected, not paused after gün sonu, not stopped by hand (server/qr-ordering.ts).
import { QrOrdering, qrOrderingRoutes, qrTestRoute } from './qr-ordering.js';
// Menünün Mola Merkez'deki kopyası (8 Ekim): the guest-visible menu pushed to Merkez, so guests browse it with the café off (server/menu-mirror.ts).
import { MenuMirror } from './menu-mirror.js';
const idSchema = z.string().min(1).max(100);
const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const selection = z.object({ groupId: idSchema, optionId: idSchema });
// The note and grams are checked exactly in the domain (cleaned length, 50 g steps) so guests get its plain message.
const line = z.object({ productId: idSchema, quantity: z.number().int().min(1).max(20), selections: z.array(selection).max(10), note: z.string().max(1000).optional(), grams: z.number().int().optional() });
// packed: "Paketlensin" for a table order; sent only when ticked, so older pending orders keep their request fingerprint.
const orderInput = z.object({ requestId, tableId: idSchema, expectedTotal: z.number().int().positive().max(100_000_000), lines: z.array(line).min(1).max(30), packed: z.boolean().optional() });
const guestOrderInput = orderInput.extend({ guestContext: z.string().regex(/^[a-f0-9]{64}$/).optional() });
const guestContext = (actor: Actor) => createHash('sha256').update(JSON.stringify([actor.tenantId, actor.id, actor.tableId, actor.epoch])).digest('hex');
const paymentContext = (actor: Actor) => createHash('sha256').update(JSON.stringify(['payment', actor.tenantId, actor.id])).digest('hex');
const paymentInput = z.object({ paymentContext: z.string().regex(/^[a-f0-9]{64}$/).optional(), selections: z.array(z.object({ orderId: idSchema, lineId: idSchema, quantity: z.number().int().min(1).max(20) })).min(1).max(100).optional(), requestId, accountId: idSchema, version: z.number().int().nonnegative(), method: z.enum(['cash', 'card']), amount: z.number().int().positive().max(100_000_000), tendered: z.number().int().positive().max(100_000_000), tip: z.number().int().positive().max(100_000_000).optional(), tipMethod: z.enum(['cash', 'card']).optional() });
// Optional English for the EN guest menu, as long as the Turkish field; blank is dropped so the dictionary or Turkish text shows.
const englishText = (max: number) => z.string().trim().max(max).optional().transform(v => v || undefined);
const productInput = z.object({ readyMade: z.boolean().optional(), vatRate: z.number().int().min(0).max(100).optional(), unit: z.enum(['piece', 'kg']).optional(), published: z.boolean().optional(), code: z.string().regex(/^\d{1,5}$/), name: z.string().trim().min(1).max(80), nameEn: z.string().trim().max(80), category: z.string().trim().max(60), description: z.string().max(240), price: z.number().int().min(0).max(1_000_000), soldOut: z.boolean(), art: z.enum(['coffee', 'tea', 'cold', 'cake', 'food', 'soup', 'burger', 'sweet']), subtype: z.string().trim().max(80).optional(), ingredients: z.string().trim().max(500).optional(), descriptionEn: englishText(240), ingredientsEn: englishText(500), photo: z.string().max(200).nullable().optional(), groups: z.array(z.object({ preset: z.enum(['size', 'milk', 'service', 'custom']).optional(), id: idSchema, name: z.string().trim().min(1).max(60), nameEn: englishText(60), required: z.boolean(), options: z.array(z.object({ id: idSchema, name: z.string().trim().min(1).max(60), nameEn: englishText(60), extra: z.number().int().min(-1000000).max(1000000) })).min(1).max(12) })).max(8).optional() });
/**
 * Hizmet paketi: without "Rezervasyon ve etkinlik" the floor keeps an open event's tables (their bills must still be
 * settled) but shows no reservation marks or questions, and nobody books from the floor. Nothing is removed from the data.
 */
function floorPart(part: ReturnType<typeof floorReservations>, on: boolean) {
  const rules = (part as { reservations?: StaffSnapshot['reservations'] }).reservations;
  if (on || !rules) return part;
  return { ...part, reservations: { ...rules, canReserve: false, canRunEvents: false }, reservationMarks: [] } as typeof part;
}
function cookies(req: Request) {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').map(x => x.trim().split('=')).filter(x => x.length === 2));
}
/** The kitchen's copy of a menu item (8 Ekim denetimi K11): it never shows money, so it is not sent any (price, option extras, campaigns). */
export function kitchenProduct<P extends { price: number; groups?: { options: { extra: number }[] }[]; discounts?: unknown[] }>(p: P): P {
  return { ...p, price: 0, ...(p.groups ? { groups: p.groups.map(g => ({ ...g, options: g.options.map(o => ({ ...o, extra: 0 })) })) } : {}), ...(p.discounts ? { discounts: [] } : {}) };
}
/**
 * The café server (Kafe role). Licences come only from Mola Merkez, signed (server/kafe-link.ts); there is no admin panel here.
 * merkez: the link to Mola Merkez; runtime.ts passes one that runs the heartbeat, tests pass their own.
 */
export function createApp(store: Store, now: () => Date = () => new Date(), processorReady: (tenant: string) => boolean = () => true, network: { lan: boolean; port: number; mode?: 'development' | 'installed' } = { lan: false, port: 3000 }, httpSecurity: HttpSecurity = {}, logFailure?: (event: FailureEvent) => void, printService = new PrintService(store, now), backups?: BackupScheduler, desktop?: Desktop, security?: Security, merkez?: MerkezLink, updates?: UpdateAgent) {
  const app = express(); const link = merkez ?? new MerkezLink(store, { now });
  // Güvenlik denetimi (docs/GUVENLIK_DENETIMI.md): routes match exactly as written. Express otherwise matches /api/Staff/users
  // and /api/staff/users/ too, while the guards before the routes (sahip kilidi, uzaktan yönetimin "yalnız kafede" listesi,
  // hizmet paketi) compare the path as written: a changed letter case or a trailing slash slipped past them.
  app.set('case sensitive routing', true);
  // Express's own last-resort error page never shows a stack trace or a folder path (NODE_ENV stays unset on purpose).
  app.set('env', 'production');
  app.use('/api', (req, _res, next) => { if (req.path.length > 1 && req.path.endsWith('/')) return next(new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404)); next(); });
  store.refreshDirectory();
  // Closed tables and replay records age by the same clock as orders (tests and the demo generator move it).
  store.clock = now;
  const clock = () => now().getTime();
  // Shared pools never refuse everyone when full: the oldest entry makes room, so one flood cannot lock out every business.
  // Kept in the store database (server/sessions.ts): a restart keeps everyone signed in until the next business day.
  const staff = new SessionBook(store.db, store.key, 'staff', clock, 10000);
  const guests = new SessionBook(store.db, store.key, 'guest', clock, 50000);
  // QR siparişleri: every signed-in staff request marks its screen as connected (staffActor below); stop, gün sonu pause, guests' refusal.
  const qrOrdering = new QrOrdering(store, link, now); app.locals.qrOrdering = qrOrdering;
  // This process IS the local merchant processor. Browser tab timers are not processor health.
  const limits = new ExpiringStore<{ count: number; until: number }>(v => v.until, clock, 20000, true);
  // Anonymous traffic (QR scans, logins) is counted per client IP in its own pool, apart from signed-in limits.
  const ipLimits = new ExpiringStore<{ count: number; until: number }>(v => v.until, clock, 20000, true);
  // Failed-login counters live apart from everything else, so floods of other traffic cannot evict (reset) them.
  const authLimits = new ExpiringStore<{ count: number; until: number }>(v => v.until, clock, 100000, true);
  const dummyPassword = { salt: randomBytes(16).toString('hex'), hash: randomBytes(32).toString('hex') };
  function count(pool: typeof limits, key: string, max: number, ms: number) {
    const t = now().getTime(); let l = pool.get(key);
    if (!l || l.until <= t) { l = { count: 0, until: t + ms }; pool.set(key, l); }
    if (++l.count > max) throw new DomainError('RATE_LIMIT', 'Çok sık deneme yapıldı. Biraz bekleyip tekrar deneyin.', 429);
  }
  function limit(key: string, max: number, ms: number) { count(limits, key, max, ms); }
  function limitIp(req: Request, purpose: string, max: number, ms: number) { count(ipLimits, `${purpose}:${clientKey(req)}`, max, ms); }
  function staffActor(req: Request) {
    // "Mola destek": only a request the support gate marked (server/support-session.ts); never a cookie or an account.
    const support = desk.actorOf(req);
    if (support) { req.res!.locals.diagnosticTenant = support.tenantId; req.res!.locals.diagnosticRole = 'support'; return support; }
    const token = staffToken(req), s = staff.get(token);
    if (!s) { staff.delete(token); throw new DomainError('UNAUTHORIZED', 'Lütfen çalışan hesabınızla giriş yapın.', 401); }
    // A remote owner session (server/remote-admin.ts) works only through its own sealed tunnel, never with the bare token.
    if (s.remote && remoteAdmin.sessionOf(req)?.id !== s.remote) throw new DomainError('UNAUTHORIZED', 'Lütfen çalışan hesabınızla giriş yapın.', 401);
    req.res!.locals.diagnosticTenant = s.actor.tenantId; req.res!.locals.diagnosticRole = s.actor.role;
    const user = store.sessionUser(s.actor.tenantId, s.actor.id);
    if (!user?.active || user.version !== s.userVersion || user.role !== s.actor.role || user.role === 'support') { staff.delete(token); throw new DomainError('UNAUTHORIZED', 'Hesabınız değişti. Yeniden giriş yapın.', 401); }
    staff.touch(token!);
    // A screen at the café (never the owner's remote session): QR ordering needs one connected (server/qr-ordering.ts).
    if (!s.remote) qrOrdering.touch(s.actor.tenantId, s.id ?? token!, user.role);
    return { ...s.actor, role: user.role };
  }
  function guestActor(req: Request) {
    const s = guests.get(req.get('X-Guest-Session') ?? '');
    if (!s || s.browser !== cookies(req).mola_browser) throw new DomainError('UNAUTHORIZED', 'Menüyü QR bağlantısından yeniden açın.', 401);
    // Through Mola Merkez (İnternetten menü) a guest session serves only the business whose menu code the guest opened.
    const through = req.res!.locals.tunnelTenant as string | undefined;
    if (through && s.actor.tenantId !== through) throw new DomainError('UNAUTHORIZED', 'Menüyü QR bağlantısından yeniden açın.', 401);
    req.res!.locals.diagnosticTenant = s.actor.tenantId; req.res!.locals.diagnosticRole = s.actor.role;
    return s.actor;
  }
  function online(tenant: string) { return processorReady(tenant); }
  const ctx = () => ({ now: now(), id: randomUUID });
  app.disable('x-powered-by');
  // The vendor's panel lives on Mola Merkez only: the café answers its old address like any unknown page.
  app.use((req, res, next) => { if (/^\/(platform(\/|$)|merkez\.html$|raporlarim(\.html)?$)/i.test(req.path)) { res.status(404).type('text/plain').send('Bulunamadı.'); return; } next(); });
  const failures = new PersistentFailures(store.db, () => now().getTime());
  const diagnostics = requestDiagnostics(event => { failures.add(event); if (logFailure) logFailure(event); else console.error(JSON.stringify(event)); });
  app.use('/api', diagnostics.begin);
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); next(); });
  configureHttpSecurity(app, httpSecurity);
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return next(new DomainError('JSON_REQUIRED', 'JSON içerik gerekli.', 415));
    next();
  });
  // Değişiklik işareti (server/change-marker.ts): a write that went through (or broke off half way) is a real change for the
  // nightly backup; a refused one (4xx: nothing was written) is not. The remote owner and Mola destek come through here too.
  if (backups) app.use('/api', (req, res, next) => {
    if (isRealChange(req.method, req.originalUrl)) res.on('close', () => { const s = res.statusCode; if (!res.writableFinished || s < 400 || s >= 500 || s === 424) backups.changed(); });
    next();
  });
  // İki ekran (src/SplitView.tsx): a pane of the café computer's window speaks for its own staff session (server/sessions.ts
  // staffToken); refused for anyone else, and a pane never reaches the desktop tools (those are the outer window's).
  const paneOf = paneGuard(desktop);
  app.use('/api', (req, res, next) => { const pane = paneOf(req); if (pane) res.locals.staffPane = pane; next(); });
  app.use('/api/staff/photos', express.json({ limit: '8mb' }));
  // Destek ekleri: one photo or PDF (10 MB, base64) passed on to Mola Merkez (server/kafe-routes.ts).
  app.use('/api/staff/support/attachments', express.json({ limit: '15mb' }));
  app.use(express.json({ limit: '64kb' }));
  // Köprü (server/relay.ts) runs only while support is allowed or a phone is paired. The support gate comes before every route:
  // a relayed "Mola destek" request reaches only its allow-list (server/support-session.ts), everything else is 403.
  const relay = new RelayClient(link), desk = new SupportDesk(store, link, relay, now, httpSecurity.publicOrigin);
  desk.failures = failures; desk.attach(app); app.use(desk.gate());
  // İnternetten menü: guest requests Mola Merkez passed on through the café's own tunnel are replayed here, marked; their gate
  // (before every route too) lets only the guest's paths through and counts limits by the guest's own address.
  const guestTunnel = new GuestTunnel(link, httpSecurity); guestTunnel.attach(app); app.use(guestTunnel.gate()); app.locals.guestTunnel = guestTunnel;
  tunnelTestRoute(app, guestTunnel, httpSecurity); qrTestRoute(app, qrOrdering, httpSecurity);
  // QR siparişleri açık mı: told to Mola Merkez over the tunnel at once on every change (Mola Yönetim → işletme → Özet).
  guestTunnel.statusSource = () => qrOrdering.report(); qrOrdering.onChange.push(() => guestTunnel.pushStatus());
  // Menünün Mola Merkez'deki kopyası: a few seconds after a change, on every reconnect and every 10 minutes (server/menu-mirror.ts).
  const menuMirror = new MenuMirror(store, link, (tenant, s) => popularProductIds(s, now(), store.history.recentQuantities(tenant, now().getTime())));
  guestTunnel.onOpen.push(() => menuMirror.reconnected()); app.locals.menuMirror = menuMirror;
  link.onStop.push(() => { relay.stop(); desk.close(); });
  // Sahibin uzaktan yönetimi (server/remote-admin.ts): the paired device's sealed requests become an owner staff session of
  // their own (token kept here, never sent); its gate comes before every route too and refuses the café-only actions.
  const remoteSessions: RemoteSessions = {
    open: (tenantId, user, device, remote) => {
      const token = randomBytes(32).toString('base64url'), t = now().getTime();
      staff.set(token, { actor: { role: user.role, tenantId, id: user.id }, userVersion: user.version, expires: businessDayEnd(t), id: randomBytes(12).toString('base64url'), createdAt: t, seenAt: t, activeAt: t, device, remote });
      const open = staff.list(s => s.actor.tenantId === tenantId && s.actor.id === user.id).sort((a, b) => (a.session.createdAt ?? 0) - (b.session.createdAt ?? 0));
      while (open.length > 10) staff.end(open.shift()!.hash);
      return token;
    },
    end: token => staff.delete(token),
    alive: token => !!staff.get(token),
    purge: () => { for (const { hash } of staff.list(s => !!s.remote)) staff.end(hash); },
    grantReports: (tenant, userId, token, secret) => (app.locals.reportGrant as ((t: string, u: string, k: string, s: string) => void) | undefined)?.(tenant, userId, token, secret),
  };
  const remoteAdmin = new RemoteAdmin(store, link, relay, () => remote, now, remoteSessions, httpSecurity.publicOrigin);
  remoteAdmin.attach(app); app.use(remoteAdmin.gate()); app.locals.remoteAdmin = remoteAdmin;
  link.onStop.push(() => remoteAdmin.close());
  // Sahip hesabı otomatik kilit (server/owner-lock.ts): before every /api/staff route; a locked owner session gets 423.
  ownerLock(app, store, { now, actorFor: staffActor, confirmPassword, sessionOf: req => { const token = staffToken(req), session = staff.get(token); return token && session ? { session, save: () => staff.save(token) } : undefined; } });
  // Otomatik güncelleme installs while running only when the café is idle: any write request (order, payment, login) is activity.
  if (updates) app.use('/api', (req, _res, next) => { if (!['GET', 'HEAD'].includes(req.method)) updates.touch(); next(); });
  // Hizmet paketi (server/feature-guard.ts): before the shift guard and every staff and guest route.
  featureGuard(app, { link, store, staffActor, guestTenant: req => req.path === '/guest/session' ? store.findTable(String((req.body as { token?: unknown } | undefined)?.token ?? ''))?.tenantId : guests.get(req.get('X-Guest-Session') ?? '')?.actor.tenantId });
  // Gün sonu kasası (server/cash-closing.ts, routes further down) and vardiya takibi, whose guard must come before the staff routes.
  const cash = new CashBook(store), shifts = shiftRoutes(app, store, staffActor, now, undefined, tenant => link.has(tenant, 'shifts'), {
    // K-B (9 Ekim): "Bir sonraki girişte" compares the sign-in's start; "Şu an N kişi çalışıyor" counts the café's sign-ins.
    startedAt: req => staff.get(staffToken(req))?.createdAt,
    signedIn: tenant => staff.list(v => v.actor.tenantId === tenant && !v.remote && v.expires > now().getTime()).map(({ session: v }) => ({ userId: v.actor.id, role: v.actor.role })),
  });
  // Tanıtım işletmesi (server/demo-reset.ts): manual reset only, table QRs kept; tokens renewed by older resets answer "Bu tanıtım yenilendi".
  const demoResets = new DemoResets(store, link, now, backups); app.locals.demoResets = demoResets;
  // Uzaktan destek and uzaktan raporlar: the owner's switches and phones (Destek → Uzaktan erişim); before the cash routes,
  // because a gün sonu sends the phones' postbox at once.
  const remote = new RemoteReports(store, link, relay, now, cash);
  link.onStop.push(() => remote.close()); link.beforeClose.push(() => remote.push('shutdown', true));
  // Turning support on and pairing a device ask the owner's password again (confirmPassword, below the login).
  supportRoutes(app, store, desk, staffActor, confirmPassword); remoteReportRoutes(app, store, remote, staffActor, confirmPassword);
  remoteAdminRoutes(app, store, remoteAdmin, staffActor, confirmPassword, now);
  app.locals.relay = relay; app.locals.support = desk; app.locals.remote = remote;
  relay.refresh();
  // Stok is registered later (after the report guard); the snapshot and the cancel routes reach it from here at request time.
  let stockApi: ReturnType<typeof stockRoutes> | undefined;
  app.get('/api/staff/photo-storage', async (req, res) => {
    const actor = staffActor(req); requireRole(store.read(actor.tenantId), actor, ['owner']);
    limit(`photo-storage:${actor.id}`, 12, 60000);
    res.json(await photoInventory(store.directory, actor.tenantId, () => store.read(actor.tenantId), now()));
  });
  app.post('/api/staff/photos', async (req, res) => {
    const actor = staffActor(req); requireRole(store.read(actor.tenantId), actor, ['owner', 'manager', 'support']);
    limit(`photo:${actor.id}`, 20, 60000);
    const { data, source } = z.object({ data: z.string().max(1400000), source: z.object({ data: z.string().max(5600000), crop: z.object({ zoom: z.number().min(1).max(3), x: z.number().min(0).max(100), y: z.number().min(0).max(100) }) }).optional() }).parse(req.body);
    res.json(await savePhoto(store.directory, actor.tenantId, data, source));
  });
  app.post('/api/staff/photo-source', async (req, res) => {
    const actor = staffActor(req); requireRole(store.read(actor.tenantId), actor, ['owner', 'manager', 'support']);
    const { photo } = z.object({ photo: z.string().max(200) }).parse(req.body);
    res.json(await readPhotoSource(store.directory, actor.tenantId, photo));
  });
  // `printed`: the address inside the last printed/downloaded QR set, so the owner is warned when the LAN address changed.
  // İnternetten menü: `public` once this business has its menu code at a Merkez that takes guest tunnels and this café serves the
  // built guest page: the table QR codes then hold `<base>/<masa kodu>` (guests on any network). Otherwise `publicProblem` says
  // why and the QR codes keep the LAN address (only the café's Wi-Fi), with a note to reprint once the public address is ready.
  const networkProfile = new NetworkProfile({ lan: () => network.lan ? lanOrigins(network.port).map(a => a.name) : [] }); app.locals.networkProfile = networkProfile;
  app.get('/api/staff/network', (req, res) => {
    const actor = staffActor(req), printed = store.read(actor.tenantId).qrPrint;
    const address = link.menuAddress(actor.tenantId);
    const internet = !guestTunnel.ready() ? { publicProblem: 'local' as const } : 'base' in address ? { public: { base: address.base, connected: guestTunnel.connected() } } : { publicProblem: address.problem };
    if (httpSecurity.publicOrigin) return res.json({ lan: true, addresses: [{ name: 'HTTPS test', origin: httpSecurity.publicOrigin }], printed, ...internet });
    res.json({ lan: network.lan, addresses: network.lan ? lanOrigins(network.port) : [], printed, ...internet });
  });
  // Ayarlar → Cihazlar ("Tablet ve telefon bağlama"): the connection phones use is on Windows' "Genel" profile, so Mola's
  // firewall rule (private networks only) keeps them out. Read only (server/network-profile.ts); the owner or Müdür reads it.
  app.get('/api/staff/network-profile', async (req, res) => {
    const actor = staffActor(req); requireRole(store.read(actor.tenantId), actor, ['owner', 'manager', 'support']);
    res.json(await networkProfile.view());
  });
  app.post('/api/staff/qr-printed', (req, res) => {
    // An origin (the café's LAN address) or the public menu address `<site>/q/<kod>` (İnternetten menü).
    const actor = staffActor(req), { origin } = z.object({ origin: z.string().url().max(200).refine(v => /^https?:\/\/[^/]+(\/q\/[A-Za-z0-9]{10})?$/.test(v)) }).parse(req.body);
    store.mutate(actor.tenantId, s => { requireRole(s, actor, ['owner', 'manager', 'cashier', 'waiter', 'support']); if (s.qrPrint?.origin !== origin) s.qrPrint = { origin, at: now().toISOString() }; });
    res.json({ ok: true });
  });
  // One exact path shape only: '//', '.', other letter cases or extra segments never reach the file system,
  // so the license check and the served file always refer to the same business.
  app.use('/media', (req, res) => {
    const m = /^\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,99})\/([a-f0-9-]{36}(?:-small)?\.webp)$/.exec(req.path);
    const known = m && ['GET', 'HEAD'].includes(req.method) && store.db.prepare('SELECT tenant FROM snapshots WHERE tenant=?').get(m[1]);
    if (!m || !known) { res.status(404).end(); return; }
    const [, tenant, file] = m;
    res.set('Cache-Control', 'private, no-cache'); res.set('X-Content-Type-Options', 'nosniff');
    // Staff can maintain their own menu while public service is suspended.
    let ownStaff = false;
    try { ownStaff = staffActor(req).tenantId === tenant; } catch (e) { if (!(e instanceof DomainError) || e.status !== 401) throw e; }
    if (!ownStaff && !link.active(tenant)) throw new DomainError('MENU_UNAVAILABLE', 'Bu işletmenin dijital menüsü şu anda kullanılamıyor. Lütfen personelle görüşün.', 403);
    if (!ownStaff && !link.has(tenant, 'qr-menu')) throw featureRefusal('qr-menu', 'guest');
    res.sendFile(file, { root: join(store.directory, 'media', tenant), dotfiles: 'deny', cacheControl: false }, error => { if (error && !res.headersSent) res.status(404).end(); });
  });
  // `mode` tells the screens whether to show developer wording (`npm run dev*` without SERVE_BUILD); an address like
  // 192.168.x.x is a real café too. Demo login hints only in development, for a browser on this same computer with no
  // proxy in between, never for the network, a domain or an installed café. The password comes from here, not the page code.
  const mode = network.mode ?? 'development';
  app.get('/api/health', (req, res) => {
    const demo = mode === 'development' && directLoopback(req, httpSecurity) && !!store.db.prepare("SELECT tenant FROM snapshots WHERE tenant='mola-demo' OR tenant LIKE 'mola-demo-%'").get();
    res.json({ ok: true, mode, role: 'kafe', version: APP_VERSION, activation: link.state(), demoAvailable: demo, ...(demo ? { demo: { username: 'isletme', password: DEMO_PASSWORD } } : {}), ...(desktop?.loopback?.(req) ? { desktop: true } : {}) });
  });
  app.post('/api/login', async (req, res) => {
    const body = z.object({ username: z.string().trim().toLowerCase().max(50), password: z.string().max(200), code: z.string().max(32).optional() }).parse(req.body);
    const client = clientKey(req), mineKey = `fail:${body.username}:${client}`, anyKey = `fail-any:${body.username}`;
    limitIp(req, 'login', 40, 60_000);
    // Only wrong attempts are counted. A device with no failures of its own is never blocked because of someone else's guessing,
    // so a stranger cannot lock a real employee out; once a username is under attack, failing clients are stopped.
    authBlocked(mineKey, anyKey);
    const failed = (error: DomainError) => { authFailed(mineKey, anyKey); return error; };
    const found = store.findUser(body.username);
    const valid = await passwordMatches(body.password, found?.user ?? dummyPassword);
    const fresh = store.findUser(body.username);
    if (!found || !fresh || !fresh.user.active || fresh.tenantId !== found.tenantId || fresh.user.id !== found.user.id || fresh.user.version !== found.user.version || fresh.user.hash !== found.user.hash || fresh.user.salt !== found.user.salt || !valid) throw failed(new DomainError('INVALID_LOGIN', 'Kullanıcı adı veya şifre yanlış.', 401));
    if (fresh.user.mfaEnabled) try {
      store.mutate(fresh.tenantId, s => {
        const current = s.staffUsers!.find(u => u.id === fresh.user.id)!;
        if (!current.active || current.version !== fresh.user.version || current.hash !== fresh.user.hash) throw new DomainError('INVALID_LOGIN', 'Giriş bilgileri değişti. Yeniden giriş yapın.', 401);
        if (current.mfa && consumeAdminFactor(current.mfa, body.code, now().getTime()) === 'recovery') s.audit.push({ action: 'mfa.login_recovery_used', actor: current.id, target: current.id, at: now().toISOString() });
      });
    } catch (e) { throw e instanceof DomainError && e.code === 'INVALID_CODE' ? failed(e) : e; }
    openSession(req, res, fresh.tenantId, fresh.user);
    res.json({ role: fresh.user.role });
  });
  /** The login's failed-attempt limit: 12 wrong per user and device, or 60 per user once that device failed too (1 min). */
  function authBlocked(mineKey: string, anyKey: string) {
    const mine = authLimits.get(mineKey)?.count ?? 0, any = authLimits.get(anyKey)?.count ?? 0;
    if (mine >= 12 || (any >= 60 && mine > 0)) throw new DomainError('RATE_LIMIT', 'Çok sık deneme yapıldı. Biraz bekleyip tekrar deneyin.', 429);
  }
  function authFailed(...keys: string[]) { for (const key of keys) { const t = now().getTime(), entry = authLimits.get(key); if (entry && entry.until > t) entry.count++; else authLimits.set(key, { count: 1, until: t + 60_000 }); } }
  /**
   * "Şifrenizi yeniden yazın" (Telefonu eşleştir, uzaktan destek iznini açmak): the signed-in user's own password, checked
   * in this very request. Wrong attempts count on the login's own counters (same keys), so guessing here slows the login
   * down too, and the other way round. Wrong: 403 INVALID_PASSWORD (not 401: the session itself stays).
   */
  async function confirmPassword(req: Request, actor: Actor, password: string | undefined) {
    if (!password) throw new DomainError('PASSWORD_REQUIRED', 'Güvenlik için giriş şifrenizi yazın.', 400);
    const me = store.sessionUser(actor.tenantId, actor.id);
    if (!me?.active) throw new DomainError('UNAUTHORIZED', 'Hesabınız değişti. Yeniden giriş yapın.', 401);
    // A remote session's requests all come over loopback: they count per paired device instead (server/remote-admin.ts).
    const remoteDevice = remoteAdmin.sessionOf(req)?.phone;
    const mineKey = `fail:${me.username}:${remoteDevice ? `uzak:${remoteDevice}` : clientKey(req)}`, anyKey = `fail-any:${me.username}`;
    authBlocked(mineKey, anyKey);
    const found = store.findUser(me.username), user = found && found.tenantId === actor.tenantId && found.user.id === actor.id ? found.user : undefined;
    if (!await passwordMatches(password, user ?? dummyPassword) || !user) { authFailed(mineKey, anyKey); throw new DomainError('INVALID_PASSWORD', 'Şifre yanlış. Giriş yaparken kullandığınız şifreyi yazın.', 403); }
  }
  /** A signed-in browser for this user: after a login, and right after the first owner account is made (no second login). */
  function openSession(req: Request, res: Response, tenantId: string, user: { id: string; role: Role; version: number }) {
    link.touch(tenantId, now(), user.role === 'owner'); const token = randomBytes(32).toString('base64url'); const fresh = { tenantId };
    // The same user logging in again on the same browser replaces that old session instead of using up another slot.
    // Another user's session is left alone.
    const prior = staffToken(req), priorSession = prior ? staff.get(prior) : undefined;
    const previous = priorSession && priorSession.actor.tenantId === fresh.tenantId && priorSession.actor.id === user.id ? prior : undefined;
    if (previous) staff.delete(previous);
    // Kalıcı ama günde bir giriş: the session survives restarts but ends when the next business day starts (05:00 Türkiye).
    const t = now().getTime(), expires = businessDayEnd(t);
    staff.set(token, { actor: { role: user.role, tenantId: fresh.tenantId, id: user.id }, userVersion: user.version, expires, id: randomBytes(12).toString('base64url'), createdAt: t, seenAt: t, device: deviceLabel(req.get('user-agent')) + (res.locals.staffPane ? (res.locals.staffPane === 2 ? ' · sağ ekran' : ' · sol ekran') : '') });
    // At most 10 open sessions per user (a shared café account on many tablets); the oldest is signed out.
    // Keeps one business from filling the shared pool.
    const open = staff.list(s => s.actor.tenantId === fresh.tenantId && s.actor.id === user.id).sort((a, b) => (a.session.createdAt ?? 0) - (b.session.createdAt ?? 0));
    while (open.length > 10) staff.end(open.shift()!.hash);
    res.cookie(staffCookieName(req), token, { ...sessionCookie(req), maxAge: expires - t });
  }
  // İki ekran: only this pane's session and cookie end; the other pane stays signed in.
  app.post('/api/logout', (req, res) => { const out = staffToken(req), was = out ? staff.get(out) : undefined; if (was && !was.remote) qrOrdering.forget(was.actor.tenantId, was.id ?? out!); staff.delete(out); res.clearCookie(staffCookieName(req), sessionCookie(req)); res.json({ ok: true }); });
  // "Açık oturumlar" (Çalışanlar): which devices are signed in to this business, and signing one out. Owner only.
  app.get('/api/staff/sessions', (req, res) => {
    const a = staffActor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner']);
    const current = staffToken(req), users = new Map(s.staffUsers!.map(u => [u.id, u]));
    res.json(staff.list(v => v.actor.tenantId === a.tenantId).map(({ hash, session: v }) => ({ id: v.id ?? hash.slice(0, 16), name: users.get(v.actor.id)?.name ?? 'Eski çalışan', username: users.get(v.actor.id)?.username ?? '', role: v.actor.role, device: v.device ?? 'Bilinmeyen cihaz', createdAt: v.createdAt ? new Date(v.createdAt).toISOString() : null, seenAt: v.seenAt ? new Date(v.seenAt).toISOString() : null, expiresAt: new Date(v.expires).toISOString(), current: staff.isCurrent(hash, current) })).reverse());
  });
  app.post('/api/staff/sessions/end', (req, res) => {
    const a = staffActor(req); requireRole(store.read(a.tenantId), a, ['owner']);
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.body);
    const found = staff.list(v => v.actor.tenantId === a.tenantId).find(({ hash, session: v }) => (v.id ?? hash.slice(0, 16)) === id);
    if (!found) throw new DomainError('NOT_FOUND', 'Oturum zaten kapanmış.', 404);
    staff.end(found.hash);
    store.mutate(a.tenantId, s => { s.audit.push({ action: 'staff.session_ended', actor: a.id, target: found.session.actor.id, at: now().toISOString() }); });
    res.json({ ok: true, current: staff.isCurrent(found.hash, staffToken(req)) });
  });
  app.get('/api/staff/me', (req, res) => { const actor = staffActor(req); res.json({ role: actor.role, username: store.sessionUser(actor.tenantId, actor.id)!.username }); });
  app.post('/api/staff/heartbeat', (req, res) => {
    const actor = staffActor(req); requireRole(store.read(actor.tenantId), actor, ['owner', 'manager', 'cashier', 'kitchen', 'support']);
    res.json({ online: online(actor.tenantId) });
  });
  // Screens poll these every few seconds. The answer carries a tag of its exact content; a client that already shows
  // that content gets 204 instead of the same snapshot again (no download, no parse, no re-render on the tablet).
  app.use(['/api/staff/state', '/api/guest/state'], (req, res, next) => {
    if (req.method !== 'GET') return next();
    const send = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode !== 200) return send(body);
      const text = JSON.stringify(body), tag = createHash('sha256').update(text).digest('base64url').slice(0, 27);
      res.setHeader('X-Mola-Tag', tag);
      if (req.get('X-Mola-Tag') === tag) { res.status(204).end(); return res; }
      res.type('application/json').send(text); return res;
    };
    next();
  });
  app.get('/api/staff/state', (req, res) => {
    const actor = staffActor(req);
    // Mola destek: the menu and the floor plan only (no orders, bills, guests, reservations or sales; server/support-session.ts).
    if (actor.role === 'support') { res.json(desk.snapshot(actor.tenantId)); return; }
    link.touch(actor.tenantId, now()); const s = store.read(actor.tenantId);
    const hiddenMoney = actor.role === 'kitchen';
    // Owner and Müdür only: a table whose bill was paid and closed in the last hours links to that payment ("Ödemeyi düzelt").
    const lastPaid = new Map<string, string>(), manages = isManagement(actor.role);
    if (manages) {
      const closed = new Map(s.accounts.filter(a => a.status === 'closed').map(a => [a.id, a.tableId]));
      for (const p of s.payments) { const table = closed.get(p.accountId); if (table && !((lastPaid.get(table) ?? '') >= p.createdAt)) lastPaid.set(table, p.createdAt); }
    }
    // The kitchen also approves QR orders now, so it sees those waiting for approval (without prices, like every kitchen card).
    // Served and paid rounds leave the list after 30 minutes; the table only counts them (server/staff-orders.ts).
    const { orders, doneOrders } = staffOrders(s, actor.role as Role, now().getTime());
    const view = (t: CafeTable) => {
      const a = s.accounts.find(a => a.id === t.accountId), paidAt = lastPaid.get(t.id), done = a && doneOrders.get(a.id);
      // The kitchen never prints or shows table QR codes, so it never receives their secret links. It only cooks: no
      // reservation guest's name and no kapora either (owner's decision; kitchen cards never show them).
      const { guest: _guest, deposit: _deposit, ...plain } = a ?? {};
      return { ...t, ...(hiddenMoney ? { token: '' } : {}), account: a ? { ...(hiddenMoney ? plain as typeof a : a), ...(hiddenMoney ? { total: 0, paid: 0, balance: 0 } : balances(s, a.id)), ...(done ? { doneOrders: done } : {}) } : null, ...(paidAt ? { lastPaidAt: paidAt } : {}) };
    };
    const tables = floorTables(s).map(view);
    // A ticket stays in the strip while its bill is open or the kitchen still works on it. Once paid and handed over it
    // leaves at once; it does not wait on the floor for 6 hours like a closed table (server/history.ts).
    const inKitchen = new Set(orders.flatMap(o => o.takeaway && ['awaiting_approval', 'new', 'preparing', 'ready'].includes(o.status) ? [o.takeaway.tableId] : []));
    const takeaways = s.tables.filter(t => t.takeaway && (t.accountId || inKitchen.has(t.id))).map(view);
    const staffUser = s.staffUsers!.find(u => u.id === actor.id)!;
    const ls = actor.role === 'owner' ? link.summary(actor.tenantId) : undefined;
    // Offline days and "used on another computer" from the Merkez link come first; otherwise the licence state below.
    const licenseNotice = actor.role !== 'owner' ? undefined : link.bannerNotice(actor.tenantId) ?? (!ls ? 'Lisans doğrulanamadı: müşteri menüsü ve yeni siparişler kapalı. Destek bölümünden bize ulaşın.' : ls.suspended ? link.suspendedNotice() : ls.frozen ? 'Hizmet donduruldu. Müşteri menüsü ve yeni siparişler kapalı.' : !ls.endsAt ? 'Kurulumdan sonra deneme sürenizi destek ekibi başlatacak.' : !ls.active ? 'Lisans süreniz doldu. Yenileme için destek bölümünden bize ulaşın.' : ls.daysRemaining <= 7 ? `Lisansınızın bitmesine ${ls.daysRemaining} gün kaldı. Yenileme için destek bölümünü kullanabilirsiniz.` : undefined);
    // Mola suspended the service: every staff screen says so all the time, with the owner's same text (not only when ordering fails).
    const serviceNotice = actor.role !== 'owner' && link.summary(actor.tenantId)?.suspended ? link.suspendedNotice() : undefined;
    // Ajanda ve rezervasyon: open events' temporary tables, upcoming reservations and the floor rules (server/reservations.ts).
    // Stok: which products have a recipe (the kitchen's cancel window asks about those) and the kitchen's waiting questions.
    // Hizmet paketi: what this business may use; a closed service's parts of the snapshot are left out (its data stays).
    const pkg = link.packageView(actor.tenantId, actor.role === 'owner'), on = (id: Parameters<typeof link.has>[1]) => pkg.enabled.includes(id);
    const stockPart = stockApi && on('stock') && (actor.role === 'kitchen' || manages) ? { stockProducts: [...stockApi.tracked(s.tenantId, now().getTime())], ...(actor.role === 'kitchen' ? { stockQuestions: stockApi.questions(s, now().getTime()) } : {}) } : {};
    // When this sign-in ends (the next 05:00): the screens warn half an hour before and explain the sign-out after it.
    const signedIn = staff.get(staffToken(req)), session = signedIn ? { sessionEndsAt: new Date(signedIn.expires).toISOString(), userId: actor.id } : {};
    // Garson ataması (packages/domain/assignments.ts): a waiter's own and covered tables, only while the switch is on.
    const users = new Map((s.staffUsers ?? []).map(u => [u.id, u])), assignment = actor.role === 'waiter' ? assignmentView(s.waiterAssignments, floorTables(s), actor.id, id => !!users.get(id)?.active && users.get(id)?.role === 'waiter') : undefined;
    // "Mola ekibi bağlı": a support session is open for this business (every staff screen shows it).
    const supportOpen = desk.connected(actor.tenantId);
    // QR siparişleri açık mı: the chip on the counter, the waiter's and the owner's screens (not the kitchen's).
    const qrPart = actor.role !== 'kitchen' && qrOrdering.applies(actor.tenantId) ? { qrOrdering: qrOrdering.view(actor.tenantId, s, actor.role) } : {};
    const result: StaffSnapshot = { ...qrPart, ...(link.isDemo(s.tenantId) ? { demo: true } : {}), ...session,...(supportOpen ? { supportConnected: supportOpen } : {}),...(assignment ? { assignment } : {}), ...(serviceNotice ? { serviceNotice } : {}), ...stockPart, ...floorPart(floorReservations(s, actor.role as Role, now().getTime(), view, qrOrdering.applies(actor.tenantId) && on('reservations')), on('reservations')), pkg, ...(actor.role !== 'waiter' && s.externalOrders?.length ? { externalOrders: publicExternalOrders(s, actor.role as Role) } : {}), sector: sectorOf(s), takeaways, ...(actor.role === 'owner' && !s.setupCompleted ? { starterMenu: untouchedStarterMenu(s) } : {}), ...(actor.role === 'kitchen' ? {} : { serviceCalls: publicCalls(s), billMethods: publicBillMethods(s) }), printing: printingView(s), licenseNotice, logo: s.logo, theme: s.theme, menuHero: s.menuHero, googleReviewUrl: s.googleReviewUrl, socialLinks: socialLinksOf(s), ...(['owner', 'manager', 'cashier'].includes(actor.role) ? { paymentContext: paymentContext(actor) } : {}), ...(manages ? { productDrafts: s.productDrafts ?? [] } : {}), paymentMode: s.paymentMode ?? 'after_service', cleaningEnabled: !!s.cleaningEnabled, waiterApproval: !!s.waiterApproval, autoApproveQr: !!s.autoApproveQr, approvalVersion: s.approvalVersion ?? 0, newProductIds: newProductIds(s.products, now()), popularProductIds: popularProductIds(s, now(), store.history.recentQuantities(s.tenantId, now().getTime())), categories: menuCategories(s), subcategories: menuSubcategories(s), categoryNamesEn: menuNamesEn(s), setupCompleted: s.setupCompleted, businessRevision: s.businessRevision, username: staffUser.username, displayName: staffUser.name, name: s.name, role: actor.role as Role, revision: s.menuRevision, products: saleProducts(s, now()).filter(p => manages || p.published !== false).map(p => hiddenMoney ? kitchenProduct(p) : p), tables, orders, changeSeconds: s.changeSeconds, commissionBps: actor.role === 'owner' ? s.commissionBps : null };
    // K-A (9 Ekim): "Sahip iadeyi yaptı" for the people at the till (packages/domain/till-notices.ts); only while there is one.
    const till = tillNoticesFor(s, actor, now().getTime()); if (till.length) result.tillNotices = till;
    // Masa bölümlerinin sırası (Ayarlar → Masalar ve QR) and the long-open table reminders (waiters; the owner reads the setting).
    if (s.areaOrder?.length) result.areaOrder = s.areaOrder;
    if (actor.role === 'waiter') { const due = dueReminders(s, now().getTime(), assignment); if (due.length) result.tableReminders = due; }
    if (actor.role === 'owner') result.tableReminderMinutes = reminderMinutes(s);
    res.json(result);
  });
  app.post('/api/guest/session', (req, res) => {
    const { token } = z.object({ token: z.string().min(8).max(100) }).parse(req.body);
    // Wrong links spend only their own small budget, so junk from one phone cannot use up the café's real scans.
    // Real scans are counted per client too; a café shares one address, so those limits are generous.
    const miss = () => { limitIp(req, 'qr-miss', 20, 60_000); return new DomainError('INVALID_QR', 'QR bağlantısı bulunamadı.', 404); };
    const location = store.findTable(token);
    // A demo business's QR renewed by a reset before 5 Oct 2026 ("Tanıtımı sıfırla" keeps the table QRs now): only a token no
    // table has any more says "Bu tanıtım yenilendi".
    if (!location) throw demoResets.retired(token) ? new DomainError('DEMO_RENEWED', DEMO_RENEWED, 410) : miss();
    // Through Mola Merkez (İnternetten menü) only a table of the business whose menu code was opened.
    if (res.locals.tunnelTenant && location.tenantId !== res.locals.tunnelTenant) throw miss();
    limitIp(req, 'qr', 120, 60_000); limitIp(req, 'qr-6h', 1500, 6 * 3600_000);
    link.assertMenu(location.tenantId);
    const s = store.read(location.tenantId); const table = s.tables.find(t => t.id === location.tableId && t.token === token && !t.takeaway);
    if (!table) throw miss();
    let browser = cookies(req).mola_browser;
    if (!browser || !/^[a-f0-9]{48}$/.test(browser)) { browser = randomBytes(24).toString('hex'); res.cookie('mola_browser', browser, { ...sessionCookie(req), maxAge: 30 * 86400_000 }); }
    limit(`session:${browser}`, 30, 60_000);
    const session = randomBytes(32).toString('base64url');
    // `createdAt`: which orders and bills belong to this visit when the table later moves, merges or closes (/api/guest/state).
    guests.set(session, { actor: { tenantId: s.tenantId, id: browser, role: 'guest', tableId: table.id, epoch: table.epoch }, expires: now().getTime() + 6 * 3600_000, createdAt: now().getTime(), browser });
    res.json({ session, tableId: table.id, guestContext: guestContext(guests.get(session)!.actor) });
  });
  app.get('/api/guest/state', (req, res) => {
    const actor = guestActor(req); link.assertMenu(actor.tenantId); const s = store.read(actor.tenantId); const table = s.tables.find(t => t.id === actor.tableId); if (!table) throw new DomainError('TABLE_REMOVED', 'Bu masa kullanımdan kaldırıldı. Güncel masa QR kodunu okutun.', 410);
    // This visit: since the QR was opened (older sessions saved before `createdAt` count their 6 hours back from expiry).
    const visit = guests.get(req.get('X-Guest-Session') ?? ''), since = new Date(visit?.createdAt ?? (visit ? visit.expires - 6 * 3600_000 : 0)).toISOString();
    const ended = table.epoch !== actor.epoch, accountOf = (id: string) => s.accounts.find(a => a.id === id);
    // Staff moved the bill to another table ("Masayı taşı") or joined it to another bill ("Hesapları birleştir"): the guest's
    // orders now sit on an open bill at another table. They stay listed here, but the other table is never named.
    const moved = ended ? s.orders.filter(o => o.guestId === actor.id && o.tableMovedFrom !== undefined && (o.createdAt >= since || o.tableMovedFrom === table.name) && (a => !!a && a.status === 'open' && a.tableId !== table.id)(accountOf(o.accountId))) : [];
    // "Paid" only when a bill of this table closed during this visit with money taken; a move, a merge or an emptied bill is not.
    const paid = ended && !moved.length && s.accounts.some(a => a.tableId === table.id && a.status === 'closed' && (a.closedAt ?? '') >= since && s.payments.some(p => p.accountId === a.id));
    const own = s.orders.filter(o => o.guestId === actor.id && accountOf(o.accountId)?.tableId === table.id && (o.accountId === table.accountId || ended));
    const orders: GuestSnapshot['orders'] = [...own, ...moved.filter(o => !own.includes(o))].map(({ guestId: _, reviewedBy: __, printedTo: ___, printFailedTo: ____, cancelPrinted: _____, printProblems: _printProblems, changes: _changes, cancelledBy: ______, tableMovedFrom: _______, cancellations, ...o }) => ({ ...o, ...(cancellations ? { cancellations: cancellations.map(({ by: _by, printTo: _to, ...c }) => ({ ...c, by: '' })) } : {}), tableName: table.name, cancelRequested: o.cancelRequested && ['new', 'preparing', 'ready'].includes(o.status), canEdit: !ended && ['new', 'awaiting_approval'].includes(o.status) && now().getTime() < changeDeadline(o, s.changeSeconds) && balances(s, o.accountId).paid === 0 && accountOf(o.accountId)?.status === 'open' && !s.blocked.includes(actor.id) }));
    // Masanın hesabı (8 Ekim, the owner's decision): while this visit's bill is open, the guest sees every item on it, also
    // what the waiter added from his phone ("Garson ekledi") or another phone at the table sent; those are read-only here
    // (no change, no cancel; the server refuses them anyway: they are not this browser's). Only this table's open bill of
    // this visit (`ended` false = same epoch): once it closes or moves, a new scan starts empty and nothing old shows.
    const billId = !ended && table.accountId && accountOf(table.accountId)?.status === 'open' ? table.accountId : null;
    const pieces = (o: Order) => { const m: Record<string, number> = {}; for (const p of s.payments) if (p.accountId === o.accountId) for (const x of p.selections ?? []) if (x.orderId === o.id) m[x.lineId] = (m[x.lineId] ?? 0) + x.quantity; return Object.keys(m).length ? { paidQuantities: m } : {}; };
    if (billId) for (const o of orders) if (o.accountId === billId) Object.assign(o, pieces(s.orders.find(x => x.id === o.id)!), { paid: isOrderPaid(s, s.orders.find(x => x.id === o.id)!) });
    const others = billId ? s.orders.filter(o => o.accountId === billId && o.guestId !== actor.id && o.status !== 'cancelled' && o.status !== 'awaiting_approval') : [];
    for (const o of others) orders.push({ id: o.id, number: o.number, accountId: o.accountId, guestLabel: '', source: o.source, createdAt: o.createdAt, status: o.status, version: o.version, menuRevision: o.menuRevision, lines: o.lines, total: o.total, cancelRequested: false, ...(o.packed ? { packed: true } : {}), tableName: table.name, canEdit: false, addedBy: o.source === 'staff' ? 'staff' as const : 'table' as const, paid: isOrderPaid(s, o), ...pieces(o) });
    // "Masanın hesabı": the whole open bill, what was paid (also split and partial payments) and what is left to pay.
    const bill = billId ? balances(s, billId) : null;
    // The KDV inside it (prices include KDV), as on the printed bill: "KDV dahil · ₺X" under Masanın hesabı.
    const billVat = billId ? billVatTotal(s, s.orders.filter(o => o.accountId === billId && o.status !== 'cancelled' && o.status !== 'awaiting_approval').flatMap(o => o.lines)) : 0;
    const calls = activeCalls(s).filter(c => c.tableId === table.id && c.epoch === actor.epoch);
    // QR siparişleri: open, or why not (the guest's line), and whether Garson çağır works; none for "Sadece QR menü".
    // Rezerve masada QR (12 Ekim): this table held for a reservation closes ordering here only ("Bu masa 20:00 için ayrılmıştır").
    const ordering = qrOrdering.applies(actor.tenantId) ? { ordering: qrOrdering.guestView(actor.tenantId, s, table.epoch === actor.epoch ? table.id : undefined) } : {};
    const result: GuestSnapshot = { ...ordering, ...(link.isDemo(actor.tenantId) ? { demo: true } : {}), ...(ended ?{ ended: moved.length ? 'moved' as const : paid ? 'paid' as const : 'other' as const } : {}), ...(bill && bill.total > 0 ? { due: Math.max(0, bill.balance), bill: { total: bill.total, paid: bill.paid, ...(bill.depositCredit ? { depositCredit: bill.depositCredit } : {}), ...(billVat ? { vat: billVat } : {}) } } : {}), ...(s.blocked.includes(actor.id) ? { blocked: true } : {}), sector: sectorOf(s), menuOnly: link.menuOnly(actor.tenantId) || !link.has(actor.tenantId, 'qr-order'), calls: { waiter: calls.some(c => c.kind === 'waiter'), bill: calls.some(c => c.kind === 'bill') }, tableHasAccount: !!table.accountId && table.epoch === actor.epoch, logo: s.logo, theme: s.theme, menuHero: s.menuHero, googleReviewUrl: s.googleReviewUrl, ...guestSocial(s, link.has(actor.tenantId, 'social')), paymentMode: s.paymentMode ?? 'after_service', needsCleaning: !!table.needsCleaning, newProductIds: newProductIds(s.products, now()), popularProductIds: popularProductIds(s, now(), store.history.recentQuantities(s.tenantId, now().getTime())), categories: menuCategories(s), categoryNamesEn: menuNamesEn(s), subcategories: menuSubcategories({ ...s, products: s.products.filter(p => p.published !== false) }), table: { name: table.name }, products: saleProducts(s, now()).filter(p => p.published !== false), name: s.name, menuRevision: s.menuRevision, online: online(s.tenantId), closed: table.epoch !== actor.epoch, orders, changeSeconds: s.changeSeconds };
    res.json(result);
  });
  app.post('/api/guest/orders', (req, res) => {
    const actor = guestActor(req); limit(`orders:${actor.id}`, 30, 60_000); limitIp(req, 'guest-order', 60, 60_000);
    if (!online(actor.tenantId)) throw new DomainError('BUSINESS_OFFLINE', 'İşletme şu anda sipariş alamıyor. Biraz sonra tekrar deneyin.', 503);
    const body = guestOrderInput.parse(req.body);
    link.assertGuestService(actor.tenantId);
    if (!store.hasRequest(actor.tenantId, `${actor.tenantId}:${actor.id}:order:${body.requestId}`)) {
      if (body.guestContext && body.guestContext !== guestContext(actor)) throw new DomainError('ORDER_CONTEXT_CHANGED', 'Bu gönderim önceki masa veya tarayıcı oturumuna ait. Sipariş durumunu işletmeyle kontrol edin; yeniden gönderilmedi.', 409);
      link.assertOrdering(actor.tenantId);
      // QR siparişleri kapalı (no staff screen, gün sonu, stopped): refused; the basket stays on the phone. A replay of an
      // order already taken (lost answer) is never refused: it is above, outside this check.
      // A table held for a reservation (12 Ekim) refuses with TABLE_RESERVED_SOON; staff orders never come here.
      if (qrOrdering.applies(actor.tenantId)) qrOrdering.assertGuestOrder(actor.tenantId, store.read(actor.tenantId), actor.tableId);
    }
    // `status` tells the guest's screen whether the order went to the kitchen or waits for the waiter's approval.
    res.json(store.mutate(actor.tenantId, s => { const r = submitOrder(s, actor, body, ctx()); const status = s.orders.find(o => o.id === r.orderId)?.status; return { ...r, ...(status ? { status } : {}) }; }));
  });
  app.post('/api/guest/orders/edit', (req, res) => {
    const actor = guestActor(req); limit(`edit:${actor.id}`, 30, 60_000); limitIp(req, 'guest-edit', 60, 60_000);
    if (!online(actor.tenantId)) throw new DomainError('BUSINESS_OFFLINE', 'İşletmeyle bağlantı yok.', 503);
    const body = z.object({ guestContext: z.string().regex(/^[a-f0-9]{64}$/).optional(), requestId, orderId: idSchema, version: z.number().int().nonnegative(), expectedTotal: z.number().int().positive().max(100_000_000), packed: z.boolean().optional(), lines: z.array(line.extend({ existingId: idSchema.optional() })).min(1).max(30) }).parse(req.body);
    if (!store.hasRequest(actor.tenantId, `${actor.tenantId}:${actor.id}:edit-order:${body.requestId}`)) {
      if (body.guestContext && body.guestContext !== guestContext(actor)) throw new DomainError('EDIT_CONTEXT_CHANGED', 'Bu değişiklik önceki masa veya tarayıcı oturumuna ait. Sipariş durumunu işletmeyle kontrol edin; yeniden uygulanmadı.', 409);
      link.assertMenu(actor.tenantId);
    }
    res.json(store.mutate(actor.tenantId, s => editOrder(s, actor, body, ctx())));
  });
  app.post('/api/guest/call', (req, res) => {
    const actor = guestActor(req); limit(`call:${actor.id}`, 6, 60_000); limitIp(req, 'guest-call', 30, 60_000);
    if (!online(actor.tenantId)) throw new DomainError('BUSINESS_OFFLINE', 'İşletmeyle bağlantı kurulamadı. Personele seslenebilirsiniz.', 503);
    // `payWith`: "Nasıl ödeyeceksiniz? Nakit / Kart" answered when asking for the bill (optional).
    const body = z.object({ requestId, kind: z.enum(['waiter', 'bill']), payWith: z.enum(['cash', 'card']).optional() }).parse(req.body);
    link.assertGuestService(actor.tenantId); link.assertOrdering(actor.tenantId);
    // Garson çağır / Hesabı iste: only while a staff screen could hear it (gün sonu or a manual stop do not matter here).
    if (!store.hasRequest(actor.tenantId, `${actor.tenantId}:${actor.id}:service-call:${body.requestId}`)) qrOrdering.assertGuestCall(actor.tenantId);
    res.json(store.mutate(actor.tenantId, s => requestServiceCall(s, actor, body, ctx())));
  });
  app.post('/api/staff/calls/resolve', (req, res) => {
    const actor = staffActor(req); const b = z.object({ callId: idSchema }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => resolveServiceCall(s, actor, b, ctx())));
  });
  // "Uzun süredir sipariş yok" (packages/domain/table-reminders.ts): "Gittim" on the waiter's reminder.
  app.post('/api/staff/tables/checked', (req, res) => {
    const actor = staffActor(req); const b = z.object({ tableId: idSchema, epoch: z.number().int().nonnegative() }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => {
      requireRole(s, actor, ['owner', 'manager', 'cashier', 'waiter']);
      const table = s.tables.find(t => t.id === b.tableId);
      // The table's session ended meanwhile (paid, moved): nothing to remind any more, not an error.
      if (!table || table.epoch !== b.epoch || !table.accountId) return { ok: true };
      checkTable(s, table.id, table.epoch, now().toISOString());
      s.audit.push({ action: 'table.checked', actor: actor.id, target: table.id, at: now().toISOString() });
      return { ok: true };
    }));
  });
  // Ayarlar → Sipariş ve mutfak → Sipariş ve onay: after how many minutes (0 = off).
  app.post('/api/staff/table-reminder', (req, res) => {
    const actor = staffActor(req); const b = z.object({ minutes: z.number().int().min(0).max(MAX_REMINDER_MINUTES) }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => {
      requireRole(s, actor, ['owner', 'support']);
      if (b.minutes && b.minutes < MIN_REMINDER_MINUTES) throw new DomainError('INVALID_VALUE', `Süre en az ${MIN_REMINDER_MINUTES} dakika olmalı.`);
      if (b.minutes === DEFAULT_REMINDER_MINUTES) delete s.tableReminderMinutes; else s.tableReminderMinutes = b.minutes;
      s.audit.push({ action: 'settings.table_reminder', actor: actor.id, target: String(b.minutes), at: now().toISOString() });
      return { minutes: reminderMinutes(s) };
    }));
  });
  app.post('/api/guest/cancel', (req, res) => {
    const actor = guestActor(req); limitIp(req, 'guest-cancel', 30, 60_000);
    if (!online(actor.tenantId)) throw new DomainError('BUSINESS_OFFLINE', 'İşletmeyle bağlantı kurulamadı.', 503);
    const body = z.object({ guestContext: z.string().regex(/^[a-f0-9]{64}$/).optional(), requestId, orderId: idSchema, version: z.number().int().nonnegative() }).parse(req.body);
    if (!store.hasRequest(actor.tenantId, `${actor.tenantId}:${actor.id}:cancel:${body.requestId}`) && body.guestContext && body.guestContext !== guestContext(actor)) throw new DomainError('CANCEL_CONTEXT_CHANGED', 'Bu iptal talebi önceki masa veya tarayıcı oturumuna ait. Sipariş durumunu işletmeyle kontrol edin; yeniden uygulanmadı.', 409);
    res.json(store.mutate(actor.tenantId, s => cancelOrder(s, actor, body, ctx())));
  });
  app.post('/api/staff/orders', (req, res) => {
    const actor = staffActor(req);
    if (!online(actor.tenantId)) throw new DomainError('BUSINESS_OFFLINE', 'İşletme ekranı açık olmalıdır.', 503);
    const body = orderInput.parse(req.body);
    if (!store.hasRequest(actor.tenantId, `${actor.tenantId}:${actor.id}:order:${body.requestId}`)) link.assertOrdering(actor.tenantId, 'staff');
    res.json(store.mutate(actor.tenantId, s => submitOrder(s, actor, body, ctx())));
  });
  // New masasız ticket with its first order (Sipariş al → Masasız sipariş). Later rounds use /api/staff/orders with the ticket's tableId.
  app.post('/api/staff/takeaway/orders', (req, res) => {
    const actor = staffActor(req);
    if (!online(actor.tenantId)) throw new DomainError('BUSINESS_OFFLINE', 'İşletme ekranı açık olmalıdır.', 503);
    const body = orderInput.omit({ tableId: true, packed: true }).extend({ label: z.string().max(200).optional() }).parse(req.body);
    if (!store.hasRequest(actor.tenantId, `${actor.tenantId}:${actor.id}:takeaway:${body.requestId}`)) link.assertOrdering(actor.tenantId, 'staff');
    res.json(store.mutate(actor.tenantId, s => submitTakeaway(s, actor, body, ctx())));
  });
  app.post('/api/staff/status', (req, res) => {
    const actor = staffActor(req); const b = z.object({ requestId, orderId: idSchema, version: z.number().int(), status: z.enum(['preparing', 'ready', 'served']) }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => once(s, actor, 'status', b.requestId, b, () => setStatus(s, actor, b.orderId, b.version, b.status, now()))));
  });
  // Mutfak "Geri al": the last preparing/ready step back, a few seconds only (engine.ts undoStatus, audited).
  app.post('/api/staff/status/undo', (req, res) => {
    const actor = staffActor(req); const b = z.object({ requestId, orderId: idSchema, version: z.number().int().nonnegative() }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => undoStatus(s, actor, b, ctx())));
  });
  // Approving a guest's own cancel request (Müşteri iptal istiyor). Any other cancellation by staff needs a reason: /api/staff/orders/cancel.
  app.post('/api/staff/cancel', (req, res) => {
    const actor = staffActor(req); requireRole(store.read(actor.tenantId), actor, ['owner', 'manager', 'kitchen']);
    const { stockUsed, ...body } = z.object({ requestId, orderId: idSchema, version: z.number().int(), stockUsed: z.boolean().optional() }).parse(req.body);
    const result = store.mutate(actor.tenantId, s => {
      const o = s.orders.find(o => o.id === body.orderId);
      if (isManagement(actor.role) && o && !o.cancelRequested && !store.hasRequest(actor.tenantId, `${actor.tenantId}:${actor.id}:cancel:${body.requestId}`)) throw new DomainError('REASON_REQUIRED', 'İptal için siparişteki “İptal et” düğmesini kullanıp nedenini seçin.', 409);
      return cancelOrder(s, actor, body, ctx());
    });
    res.json(answerAtOnce(actor, body.orderId, result, stockUsed));
  });
  /** The kitchen cancelling something it had started answers "Bu üründen stok kullanıldı mı?" in the same window. */
  function answerAtOnce<T extends { stockQuestion?: string }>(actor: Actor, orderId: string, result: T, used?: boolean) {
    if (used === undefined || !result.stockQuestion || !stockApi || !link.has(actor.tenantId, 'stock') || !['owner', 'manager', 'kitchen'].includes(actor.role)) return result;
    try { return { ...result, stock: stockApi.answer(actor, { orderId, questionId: result.stockQuestion, used }) }; } catch { return result; }
  }
  // Waiter and kitchen (the owner as supervisor) cancel a whole order or some items, always with a reason; never the cashier.
  app.post('/api/staff/orders/cancel', (req, res) => {
    const actor = staffActor(req);
    const { stockUsed, ...body } = z.object({ requestId, orderId: idSchema, version: z.number().int().nonnegative(), reason: z.string().max(400), lines: z.array(z.object({ lineId: idSchema, quantity: z.number().int().min(1).max(20) })).min(1).max(30).optional(), stockUsed: z.boolean().optional() }).parse(req.body);
    res.json(answerAtOnce(actor, body.orderId, store.mutate(actor.tenantId, s => cancelByStaff(s, actor, body, ctx())), stockUsed));
  });
  // Garson siparişi değiştirir (packages/domain/order-change.ts): one line, before the kitchen starts it; audited, the kitchen
  // card says "Değişti: …" and a printed order gets a DEĞİŞİKLİK slip (server/printing.ts).
  app.post('/api/staff/orders/change', (req, res) => {
    const actor = staffActor(req);
    const body = z.object({ requestId, orderId: idSchema, version: z.number().int().nonnegative(), lineId: idSchema, line, expectedTotal: z.number().int().positive().max(100_000_000) }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => changeByStaff(s, actor, body, ctx())));
  });
  app.post('/api/staff/cancel-decline', (req, res) => {
    const actor = staffActor(req);
    const body = z.object({ requestId, orderId: idSchema, version: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(200) }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => declineCancellation(s, actor, body, ctx())));
  });
  app.post('/api/staff/payments', (req, res) => {
    const actor = staffActor(req), body = paymentInput.parse(req.body);
    requireRole(store.read(actor.tenantId), actor, ['owner', 'manager', 'cashier']);
    if (body.paymentContext && body.paymentContext !== paymentContext(actor)) throw new DomainError('PAYMENT_CONTEXT_CHANGED', 'Bu tahsilat başka bir çalışan hesabına ait. Gönderen çalışan hesabıyla giriş yapın.', 409);
    // An optional tip ("Bahşiş") is kept apart from the sale (server/cash-closing.ts payWithTip).
    res.json(store.mutate(actor.tenantId, s => body.tip ? cash.payWithTip(s, actor, body, ctx()) : recordPayment(s, actor, body, ctx())));
  });
  app.post('/api/staff/tables/move', (req, res) => {
    const actor = staffActor(req);
    const body = z.object({ requestId, accountId: idSchema, version: z.number().int().nonnegative(), targetId: idSchema, targetEpoch: z.number().int().nonnegative() }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => moveTable(s, actor, body, ctx())));
  });
  app.post('/api/staff/tables/clean', (req, res) => {
    const actor = staffActor(req); const b = z.object({ requestId, tableId: idSchema, epoch: z.number().int().nonnegative() }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => markTableClean(s, actor, b, ctx())));
  });
  app.post('/api/staff/close-empty', (req, res) => {
    const actor = staffActor(req); const b = z.object({ requestId, accountId: idSchema }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => once(s, actor, 'close-empty', b.requestId, b, () => closeEmptyAccount(s, actor, b.accountId, now()))));
  });
  app.post('/api/staff/products', (req, res) => {
    const actor = staffActor(req); const b = z.object({ requestId: requestId.optional(), revision: z.number().int().nonnegative().optional(), action: z.enum(['draft', 'publish', 'unpublish']).optional(), id: idSchema.optional(), product: productInput }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => {
      requireRole(s, actor, ['owner', 'manager', 'support']);
      const apply = () => {
      if (b.revision !== undefined && b.revision !== s.menuRevision) throw new DomainError('VERSION_CONFLICT', 'Menü başka bir ekranda değişti. Pencereyi kapatıp yeniden açın.', 409);
      if (b.action === 'unpublish' && (!b.id || !b.requestId || b.revision === undefined || b.product.published !== false)) throw new DomainError('INVALID_UNPUBLISH', 'Taslağa almak için güncel ürün ve işlem bilgileri gerekli.');
      const publishing = b.product.published ?? s.products.find(p => p.id === b.id)?.published ?? true;
      if (publishing && !b.product.category) throw new DomainError('INVALID_CATEGORY', 'Yayınlamak için kategori seçin.');
      if (publishing && b.product.price < 1) throw new DomainError('INVALID_PRICE', 'Yayınlamak için sıfırdan büyük fiyat girin.');
      if ((publishing || b.product.category) && !menuCategories(s).includes(b.product.category)) throw new DomainError('INVALID_CATEGORY', 'Kategori bulunamadı. Güncel kategorilerden seçim yapın.', 409);
      if ([...s.products, ...(s.productDrafts ?? [])].some(p => p.code === b.product.code && p.id !== b.id)) throw new DomainError('DUPLICATE_CODE', 'Bu ürün kodu zaten kullanılıyor.', 409);
      if (b.product.photo) {
        const prefix = `/media/${actor.tenantId}/`;
        const file = b.product.photo.slice(prefix.length);
        if (!b.product.photo.startsWith(prefix) || !/^[a-f0-9-]{36}\.webp$/.test(file) || !existsSync(join(store.directory, 'media', actor.tenantId, file))) throw new DomainError('INVALID_PHOTO', 'Yüklenen fotoğraf bulunamadı.');
      }
      if (b.product.groups) {
        const presets = b.product.groups.map(g => g.preset).filter(p => p && p !== 'custom');
        if (new Set(presets).size !== presets.length) throw new DomainError('DUPLICATE_PRESET', 'Aynı hazır alan birden fazla eklenemez.');
        if (new Set(b.product.groups.map(g => g.id)).size !== b.product.groups.length || b.product.groups.some(g => new Set(g.options.map(o => o.id)).size !== g.options.length)) throw new DomainError('INVALID_OPTIONS', 'Seçenek kimlikleri tekrarlanamaz.');
      }
      const existing = s.products.find(p => p.id === b.id);
      const minimum = b.product.price + (b.product.groups ?? existing?.groups ?? []).reduce((sum, g) => sum + Math.min(...g.options.map(o => o.extra), ...(g.required ? [] : [0])), 0);
      if (publishing && minimum < 1) throw new DomainError('INVALID_OPTION_PRICE', 'İndirimlerle birlikte ürünün fiyatı en az 0,01 TL olmalı.');
      if (b.id && !existing) throw new DomainError('NOT_FOUND', 'Ürün bulunamadı.', 404);
      if (existing && b.action === 'unpublish') {
        Object.assign(existing, b.product, { published: false });
        s.productDrafts = s.productDrafts?.filter(p => p.id !== existing.id);
      } else if (existing && existing.published !== false && !publishing) {
        s.productDrafts = [...(s.productDrafts ?? []).filter(p => p.id !== existing.id), { ...existing, ...b.product, published: false }];
      } else if (existing) {
        if (publishing && existing.firstPublishedAt === null) existing.firstPublishedAt = now().toISOString();
        Object.assign(existing, b.product);
        if (b.action === 'publish') s.productDrafts = s.productDrafts?.filter(p => p.id !== existing.id);
      }
      else s.products.push({ ...b.product, firstPublishedAt: publishing ? now().toISOString() : null, id: randomUUID(), groups: b.product.groups ?? [] });
      s.menuRevision++;
      s.audit.push({ actor: actor.id, action: b.action === 'unpublish' ? 'menu.unpublished' : 'menu.updated', target: b.id ?? b.product.code, at: now().toISOString() });
      return { ok: true };
      };
      return b.requestId ? once(s, actor, 'save-product', b.requestId, b, apply) : apply();
    }));
  });
  app.post('/api/staff/products/discard-draft', (req, res) => {
    const actor = staffActor(req); const b = z.object({ requestId, revision: z.number().int().nonnegative(), id: idSchema }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => {
      requireRole(s, actor, ['owner', 'manager', 'support']);
      return once(s, actor, 'discard-product-draft', b.requestId, b, () => {
        if (b.revision !== s.menuRevision) throw new DomainError('VERSION_CONFLICT', 'Menü değişti. Listeyi yenileyin.', 409);
        if (!s.productDrafts?.some(p => p.id === b.id)) throw new DomainError('NOT_FOUND', 'Düzenleme taslağı bulunamadı.', 404);
        s.productDrafts = s.productDrafts.filter(p => p.id !== b.id); s.menuRevision++;
        s.audit.push({ actor: actor.id, action: 'menu.draft-discarded', target: b.id, at: now().toISOString() }); return { ok: true };
      });
    }));
  });
  app.post('/api/staff/accounts/merge', (req, res) => {
    const a = staffActor(req); const b = z.object({ requestId, sourceId: idSchema, sourceVersion: z.number().int(), targetId: idSchema, targetVersion: z.number().int() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => mergeAccounts(s, a, b, ctx())));
  });
  app.get('/api/staff/accounts/:id/items', (req, res) => {
    const a = staffActor(req), s = store.read(a.tenantId); requireRole(s, a, ['cashier', 'manager', 'owner']);
    const account = s.accounts.find(v => v.id === req.params.id && v.status === 'open');
    if (!account) throw new DomainError('NOT_FOUND', 'Hesap bulunamadı.', 404);
    const paid = s.payments.filter(p => p.accountId === account.id);
    const items = s.orders.filter(o => o.accountId === account.id && !['cancelled', 'awaiting_approval'].includes(o.status)).flatMap(o => o.lines.map(l => ({ orderId: o.id, lineId: l.id, name: l.name, orderNumber: o.number, guestLabel: o.guestLabel, movedFrom: o.tableMovedFrom, options: l.optionNames, unitPrice: l.unitPrice, quantity: l.quantity, ...(l.grams ? { grams: l.grams } : {}), remaining: l.quantity - paid.flatMap(p => p.selections ?? []).filter(p => p.orderId === o.id && p.lineId === l.id).reduce((n, p) => n + p.quantity, 0) })));
    res.json({ version: account.version, unallocated: paid.some(p => !p.selections) || !!(account.deposit && !account.deposit.settledAt), items });
  });
  app.post('/api/staff/orders/review', (req, res) => {
    const a = staffActor(req); const b = z.object({ requestId, orderId: idSchema, version: z.number().int(), approve: z.boolean(), reason: z.string().trim().max(240).optional() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => reviewOrder(s, a, b, ctx())));
  });
  app.post('/api/staff/approval-mode', (req, res) => {
    const a = staffActor(req); const b = z.object({ requestId, version: z.number().int(), enabled: z.boolean() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => setAutomaticApproval(s, a, b, ctx())));
  });
  app.post('/api/staff/settings', (req, res) => {
    const actor = staffActor(req); const b = z.object({ sector: z.enum(sectors).optional(), paymentMode: z.enum(['before_preparation', 'after_service']).optional(), cleaningEnabled: z.boolean().optional(), waiterApproval: z.boolean().optional(), changeSeconds: z.number().int().min(0).max(600), commissionBps: z.number().int().min(0).max(10000).nullable() }).parse(req.body);
    // Mola destek may change these too, but never the card commission (money): its screen does not even receive it.
    res.json(store.mutate(actor.tenantId, s => { requireRole(s, actor, ['owner', 'support']); if (actor.role !== 'support' && !commissionAllowed(b.commissionBps, s.commissionBps)) throw new DomainError('INVALID_COMMISSION', COMMISSION_TOO_HIGH); s.changeSeconds = b.changeSeconds; if (actor.role !== 'support') s.commissionBps = b.commissionBps; if (b.paymentMode !== undefined) s.paymentMode = b.paymentMode;
      // Changing the kind of business later is a label only: the menu and every other setting stay as they are.
      if (b.sector !== undefined) s.sector = b.sector;
      if (b.cleaningEnabled !== undefined) { s.cleaningEnabled = b.cleaningEnabled; if (!b.cleaningEnabled) for (const t of s.tables) t.needsCleaning = false; }
       if (b.waiterApproval !== undefined && b.waiterApproval !== !!s.waiterApproval) { s.waiterApproval = b.waiterApproval; s.autoApproveQr = false; s.approvalVersion = (s.approvalVersion ?? 0) + 1; } s.businessRevision = (s.businessRevision ?? 0) + 1; return { ok: true }; }));
  });
  app.post('/api/staff/block', (req, res) => {
    const actor = staffActor(req); const b = z.object({ orderId: idSchema, blocked: z.boolean() }).parse(req.body);
    res.json(store.mutate(actor.tenantId, s => {
      requireRole(s, actor, ['owner', 'manager']); const order = s.orders.find(o => o.id === b.orderId);
      // A blocked browser whose orders already left the floor is still found by the order shown in the list.
      const kept = order ? undefined : Object.entries(s.blockedInfo ?? {}).find(([, v]) => v.orderId === b.orderId);
      if (kept && !b.blocked) { s.blocked = s.blocked.filter(id => id !== kept[0]); delete s.blockedInfo![kept[0]]; s.audit.push({ action: 'browser.unblocked', actor: actor.id, target: b.orderId, at: now().toISOString() }); return { ok: true }; }
      if (!order || order.source !== 'qr') throw new DomainError('NOT_FOUND', 'Müşteri siparişi bulunamadı.', 404);
      s.blocked = s.blocked.filter(id => id !== order.guestId); if (b.blocked) s.blocked.push(order.guestId);
      if (b.blocked) (s.blockedInfo ??= {})[order.guestId] = { orderId: order.id, number: order.number, label: order.guestLabel };
      else if (s.blockedInfo?.[order.guestId]) delete s.blockedInfo[order.guestId];
      s.audit.push({ action: b.blocked ? 'browser.blocked' : 'browser.unblocked', actor: actor.id, target: order.id, at: now().toISOString() });
      return { ok: true };
    }));
  });
  app.get('/api/staff/blocks', (req, res) => {
    const actor = staffActor(req); link.touch(actor.tenantId, now()); const s = store.read(actor.tenantId); requireRole(s, actor, ['owner']);
    res.json(s.blocked.flatMap(id => { const o = s.orders.find(o => o.guestId === id); const v = o ? { orderId: o.id, number: o.number, label: o.guestLabel } : s.blockedInfo?.[id]; return v ? [v] : []; }));
  });
  campaignRoutes(app, store, staffActor, now);
  // Key protection: recovery code and second backup place, for the café computer's own window only.
  const desktopOnly = desktopGuard(desktop), localDesktop = (req: Request) => { desktopOnly(req); if (!fromThisComputer(req)) throw new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404); };
  // A new recovery code asks for an owner's password (the vendor has no account on this computer any more).
  let ownerTries = 0, ownerTriesReset = 0;
  const attempt = () => { const t = now().getTime(); if (t >= ownerTriesReset) { ownerTries = 0; ownerTriesReset = t + 60000; } if (++ownerTries > 5) throw new DomainError('RATE_LIMIT', 'Bir dakika sonra tekrar deneyin.', 429); };
  const checkPassword = async (password: string) => {
    for (const { tenant } of store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) for (const u of store.read(tenant).staffUsers ?? []) if (u.role === 'owner' && u.active && await passwordMatches(password, u)) return true;
    return false;
  };
  securityRoutes(app, '/api/desktop', localDesktop, { security, backups, checkPassword, attempt, audit: action => link.audit(action) });
  kafeRoutes(app, store, link, staffActor, { security, localDesktop, signIn: (req, res, username) => { const found = store.findUser(username); if (found) openSession(req, res, found.tenantId, found.user); return !!found; } });
  // "İlk adımlar" card: recovery code and second place come from this computer's key protection and backups.
  firstStepsRoutes(app, store, staffActor, now, { recovery: () => { const v = recoveryView(security); return v.protection === 'off' ? null : v.confirmed; }, second: () => backups?.second ? !!backups.second.status().folder : null });
  businessProfileRoutes(app, store, staffActor, now, link);
  // Ajanda ve rezervasyon: masa ayırma, kapora, etkinlikler (server/reservations.ts); before Bildirimler so its reminders are ready when they are read.
  let inbox: ReturnType<typeof notificationRoutes> | undefined;
  const reservations = reservationRoutes(app, store, staffActor, now, () => inbox, undefined, tenant => link.has(tenant, 'reservations'));
  // Ajanda (owner's day notes, also the sales chart's "Satış notu") and Bildirimler (üst çubuktaki zil) (reminders, licence, backup).
  const notifications = inbox = notificationRoutes(app, store, staffActor, now, agendaRoutes(app, store, staffActor, now), { license: tenant => link.summary(tenant), backups, package: tenant => link.packageNotice(tenant),
    molaTickets: tenant => link.tickets(tenant).filter(t => t.messages[0]?.source === 'support').map(t => ({ id: t.id, subject: t.subject, createdAt: t.createdAt })) });
  // "Mola ekibi bağlandı / oturum bitti", "Telefon eşleştirildi": the owner's Bildirimler (üst çubuktaki zil).
  desk.notifications = () => notifications; remote.notifications = () => notifications; remoteAdmin.notifications = () => notifications;
  // "Yazıcıda kâğıt yok · Mutfak" (11 Ekim, hafta sonu bulgusu 1): a ticket that did not print reaches the owner's bell too.
  printService.notify = (tenant, key, title, text) => { try { notifications.add(tenant, key, { kind: 'printer', title, text }); } catch { /* printing goes on */ } };
  // Ayarlar → Giderler "Otomatik giderler": recorded on their days (before the report routes below read expenses).
  recurringExpenseRoutes(app, store, staffActor, now, notifications);
  // Before managementRoutes: it also watches POST /api/staff/expenses for a cashier's expense above the owner's limit.
  cashRoutes(app, store, staffActor, now, { book: cash, notifications, print: (printer, ticket) => printService.printNow(printer, ticket), shifts, dayClosed: () => backups?.afterDayClose(),
    // QR siparişleri: a completed gün sonu pauses them for that business day; opening the cash day ends the pause.
    closingDone: (tenant, byName) => { try { qrOrdering.pauseForClosing(tenant, now(), byName); } catch { /* the closing itself is saved */ } },
    cashOpened: tenant => { try { qrOrdering.openedCashDay(tenant); } catch { /* the opening itself is saved */ } } });
  // "QR siparişleri: Açık / Kapalı · … · Aç" and "QR siparişlerini durdur" (server/qr-ordering.ts).
  qrOrderingRoutes(app, store, qrOrdering, staffActor, now);
  soundSettingsRoutes(app, store, staffActor, now);
  // Garson masa/bölüm ataması (Ayarlar → Sipariş ve kasa; server/assignments.ts).
  assignmentRoutes(app, store, staffActor, now);
  // E-posta raporları (Ayarlar → İşletme → Raporlar ve e-posta): period reports made here, a copy in Bildirimler, sent from the
  // café's own e-mail account; never through Mola Merkez (server/email-reports.ts). No timer in unit tests: they call tick().
  const emailReports = emailReportRoutes(app, store, staffActor, now, { cash, shifts, notifications, enabled: tenant => link.has(tenant, 'email-reports') }, process.env.NODE_TEST_CONTEXT ? 0 : Number(process.env.MOLA_EMAIL_REPORTS_MS) || 60_000); app.locals.emailReports = emailReports;
  // "Tanıtımı sıfırla": the owner's (Ayarlar → Güvenlik ve diğer) and Mola Yönetim's signed order (through the heartbeat).
  demoResets.notifications = notifications; demoResets.emailReports = emailReports;
  demoResetRoutes(app, store, staffActor, link, demoResets);
  // What the heartbeat tells Mola Merkez: setup progress, counts, backup health and the code-location failure records.
  link.reporter = {
    businesses: () => (store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).map(({ tenant }) => {
      const s = store.read(tenant), setupCompletedAt = store.directoryEntry(tenant).setupCompletedAt;
      return { tenantId: tenant, name: s.name, sector: sectorOf(s), setupCompleted: !!s.setupCompleted, ...(setupCompletedAt ? { setupCompletedAt } : {}), counts: { tables: floorTables(s).length, staff: (s.staffUsers ?? []).filter(u => u.active).length, products: s.products.length } };
    }),
    // Times and yes/no only: the last try, and whether a second backup place is set and its last copy worked (no paths).
    // "Son yedek" is when the backups were last known to hold everything: a night with nothing new needs no backup, and a
    // closed week must not look like a failing one in Mola Yönetim (server/backup-scheduler.ts currentAt).
    backup: () => { const s = backups?.status(), second = backups?.second?.status(); return { enabled: !!backups, lastSuccessAt: s?.currentAt ?? s?.lastSuccessAt ?? null, failing: !!s?.lastError, lastAttemptAt: s?.lastAttemptAt ?? null, ...(backups?.second ? { second: { set: !!second?.folder, lastCopyAt: second?.folder ? second.lastCopyAt ?? null : null, failing: !!second?.folder && !!second.lastError } } : {}) }; },
    failures: since => failures.since(since),
    // Sosyal medya: the guest menu's public links (Google review included), for the permanent QR codes' short addresses at Merkez.
    social: () => (store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).map(({ tenant }) => ({ tenantId: tenant, links: socialLinksOf(store.read(tenant)) ?? {} })),
  };
  const clean = () => !store.db.prepare('SELECT tenant FROM snapshots LIMIT 1').get() && !link.read();
  restoreRoutes(app, localDesktop, { security, backups, clean });
  // "Mola Merkez'den geri yükle" (server/cloud-backup.ts): taşıma kodu + recovery code; the copy is downloaded beside the data folder.
  cloudRestoreRoutes(app, localDesktop, { security, clean, restore: security?.restore ? new CloudRestore(link, `${store.directory.replace(/[\\/]+$/, '')}-merkez-indirme`, () => security.vault?.installId, now) : undefined });
  // The recovery code is shown once an owner account exists (after "İşletme sahibi hesabı"), never on the activation screens.
  const hasOwner = () => (store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).some(({ tenant }) => store.read(tenant).staffUsers?.some(u => u.role === 'owner' && u.active));
  // Owners only see whether their data is safe, not paths or details.
  app.get('/api/staff/backup-status', (req, res) => {
    const a = staffActor(req); requireRole(store.read(a.tenantId), a, ['owner']);
    const s = backups?.status(), cloud = backups?.cloud?.status(), current = s?.currentAt ?? s?.lastSuccessAt;
    // A night with nothing new needs no backup: healthy while the backups hold everything ("Gece yedeği gerekmedi: …" as `note`).
    const note = s?.skipped && (!s.lastSuccessAt || s.skipped.at > s.lastSuccessAt) ? s.skipped.text : undefined;
    // Sunucu yedeği: only its time and whether it worked ("Sunucu yedeği: dün 23:40 · başarılı").
    res.json({ enabled: !!backups, lastSuccessAt: s?.lastSuccessAt ?? null, healthy: !!s?.lastSuccessAt && !!current && now().getTime() - Date.parse(current) < 36 * 3600_000 && !s.lastError, ...(note ? { note } : {}), ...(cloud?.enabled ? { cloud: { lastSuccessAt: cloud.lastSuccessAt ?? null, failing: !!cloud.lastError, running: cloud.running } } : {}) });
  });
  reportSecurity(app, store, staffActor, now);
  // İade: item and amount refunds, the cashier's small refunds and requests (server/refunds.ts); after reportSecurity, before managementRoutes.
  refundRoutes(app, store, staffActor, now, { notifications, restock: (tenant, actor, refundId, lines) => stockApi?.restock(tenant, actor, refundId, lines) });
  managementRoutes(app, store, staffActor, now);
  // Stok and Satış ve Raporlar → Kârlılık (server/stock.ts); after reportSecurity so the report code guards /reports/profit too.
  stockApi = stockRoutes(app, store, staffActor, now, notifications, undefined, tenant => link.has(tenant, 'stock'));
  // Satış ve Raporlar → Kasa kapanışları and Personel ve bahşiş; after reportSecurity so the report code guards them too.
  cashReportRoutes(app, store, staffActor, cash); staffShiftReportRoutes(app, store, staffActor, now, shifts, cash);
  // Satış ve Raporlar → Rezervasyon; after reportSecurity too.
  reservationReportRoutes(app, store, staffActor, reservations.book);
  // Satış ve Raporlar → sade özet, "Yazdır / PDF", "Muhasebeci için indir" (server/report-export.ts); after reportSecurity too.
  reportExportRoutes(app, store, staffActor, now, { cash, shifts, stock: () => stockApi?.book });
  integrationRoutes(app, store, staffActor, now);
  // Delivery platform orders (server/integrations/): polling runs only while a platform is on or an order is in progress.
  // An order a delivery platform sent is a real change for the nightly backup (server/change-marker.ts).
  const integrations = new IntegrationManager(store, now); integrations.onChange = () => backups?.changed(); externalOrderRoutes(app, store, staffActor, now, integrations); integrations.start(); app.locals.integrations = integrations;
  printingRoutes(app, store, staffActor, now, printService);
  /**
   * Open tables and orders not yet served (and delivery platform orders waiting for Kabul/Reddet), over every business here:
   * the installer asks before an update, and otomatik güncelleme installs while running only when all are zero.
   */
  function activity() {
    let openAccounts = 0, pendingOrders = 0;
    for (const { tenant } of store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) {
      const s = store.read(tenant);
      openAccounts += s.accounts.filter(a => a.status === 'open').length;
      pendingOrders += s.orders.filter(o => ['awaiting_approval', 'new', 'preparing', 'ready'].includes(o.status)).length + (s.externalOrders?.length ?? 0);
    }
    return { openAccounts, pendingOrders };
  }
  desktopRoutes(app, desktop, network, backups, () => {
    const view = recoveryView(security), second = backups?.second?.status();
    return { protection: view.protection, recoveryConfirmed: view.confirmed, recoveryAvailable: view.available, warning: view.warning, secondFolder: second?.folder ?? null, secondError: second?.folder ? second.lastError ?? null : null, clean: clean(), owner: hasOwner(), split: link.installHas('split-screen') };
  }, activity, networkProfile);
  // Otomatik güncelleme: the owner's banner and "Şimdi kur" (server/update-routes.ts); the agent asks the same activity question.
  updates?.attach({ activity });
  updateRoutes(app, store, staffActor, updates);
  // Yıl paketleri (server/year-packer.ts): from 1 February the year before is sealed into its own file, when the café is quiet,
  // never in the week after an update; a verified backup first and one after. Weekly SHA-256 check, monthly row check.
  const packer = new YearPacker(store, {
    backup: backups ? async () => { const started = now().getTime(), s = await backups.runNow(); return { ok: !s.lastError && Date.parse(s.lastSuccessAt ?? '') >= started - 60_000, error: s.lastError }; } : undefined,
    prepare: (tenant, s, from, to) => [cash.prepare(tenant, from, to), shifts.prepare(tenant, s, from, to, now().getTime(), cash)],
    opening: (tenant, s, t0, year) => stockApi?.book.openYearSteps(tenant, s, t0, year),
    blockers: (tenant, _s, end) => {
      const t = now().getTime(), p = cash.position(tenant, t), out: string[] = [];
      shifts.sweep(tenant, t);
      const day = p.draft?.day ?? (p.opening ? cashDayOf(p.opening.at) : undefined);
      if (day && day <= end) out.push(`Kasa ${new Date(`${day}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} gününden beri kapatılmadı. Gün sonunu yapınca yıl kendiliğinden paketlenir.`);
      if (shifts.openShifts(tenant).some(x => x.day <= end)) out.push('Geçen yıldan açık kalan bir vardiya var. Vardiya bitince yıl kendiliğinden paketlenir.');
      return out;
    },
    notify: (tenant, key, title, text) => { try { notifications.add(tenant, key, { kind: 'backup', title, text }); } catch { /* the packaging itself goes on */ } },
    recentUpdate: () => updates?.installedWithin(AFTER_UPDATE_MS) ?? false,
    idle: () => { const a = activity(); return !a.openAccounts && !a.pendingOrders; },
    after: () => { void backups?.runNow(); },
    // The readable copy before the first package goes 90 days later, after a verified backup newer than that packaging.
    verifiedBackupAt: () => backups?.status().lastSuccessAt,
  }, now);
  app.locals.packer = packer;
  if (!process.env.NODE_TEST_CONTEXT && process.env.MOLA_YIL_PAKETI !== '0') {
    const check = () => { if (!store.db.isOpen) return; void packer.tick().then(() => packer.checkPackages({ folders: () => [backups ? join(backups.folder, 'yillar') : '', backups?.second?.root ? join(backups.second.root, 'yillar') : ''].filter(Boolean), cloud: backups?.cloud ? (sha, size, target) => backups.cloud!.fetchFile(sha, size, target) : undefined })).catch(error => { if (store.db.isOpen) console.warn(`Yıl paketi denetimi yapılamadı: ${error instanceof Error ? error.message : error}`); }); };
    const first = setTimeout(check, Number(process.env.MOLA_YIL_PAKETI_MS ?? 10 * 60_000)); first.unref();
    const hourly = setInterval(check, 3600_000); hourly.unref();
  }
  // /uygulama: installing Mola on the staff's phones and tablets (Android APK, iPhone "Ana Ekrana Ekle"); café network only.
  mobileAppRoutes(app, { version: APP_VERSION, name: () => { const row = store.db.prepare('SELECT tenant FROM snapshots ORDER BY tenant LIMIT 1').get() as { tenant: string } | undefined; return row ? store.read(row.tenant).name || null : null; } });
  app.use('/api', (_req, _res, next) => next(new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404)));
  app.use(diagnostics.error);
  return app;
}
