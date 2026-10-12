import type { Express, Request } from 'express';
import { directLoopback, type HttpSecurity } from './http-security.js';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import { QR_CHANGERS, QR_CLOSED_TEXT, QR_STAFF_WINDOW_MS, qrOrderingView, reservedText, type GuestOrdering, type QrOrderingView } from '../packages/domain/qr-ordering.js';
import { reservationSettings, tableHold } from '../packages/domain/reservations.js';
import { businessDay } from '../packages/domain/business-day.js';
import type { Actor, Role, State } from '../packages/domain/types.js';
import type { MerkezLink } from './kafe-link.js';
import type { Store } from './store.js';

/*
 * QR siparişleri açık mı? (owner's decisions, 8 Ekim; the rule itself: packages/domain/qr-ordering.ts). The café is the only
 * judge: every guest order is checked here, whatever the screen showed.
 *   Presence   every signed-in staff request (server/app.ts staffActor: the 2 s snapshot poll, the 4 s heartbeat, any action)
 *              marks that session as seen. A session counts while seen within QR_STAFF_WINDOW_MS (90 s): a tablet sleeping
 *              for a moment or a hidden window (its heartbeat keeps going) does not flap the state. Never counted: the
 *              owner's remote session (Kafeyi yönet), Mola destek, Raporlarım (no staff session at all). Kept in memory only:
 *              after a restart the screens are back within seconds.
 *   Gün sonu   a completed final closing pauses QR ordering for the rest of that business day (`paused`); "Aç", opening the
 *              cash day or the next 05:00 ends it. Extra closings pause again (more sales after gün sonu, then another count).
 *   Durdur     "QR siparişlerini durdur" (cashier, Müdür, owner) stops it until someone taps "Aç" (no time limit; the screens
 *              remind after 30 minutes). Both are audited (qr_ordering.stopped / opened / paused).
 *   Guests     POST /api/guest/orders refuses with ORDERING_CLOSED ("Şu an sipariş almıyoruz, lütfen garsonunuza sorun.");
 *              the basket stays on the phone. Garson çağır / Hesabı iste need only a connected staff screen. Editing or
 *              cancelling an order already sent is not refused (it is the guest's own, within its short change window).
 *   Rezerve    (12 Ekim) one table only: from `holdMinutes` (default 30) before a waiting reservation until "Geldi", "Gelmedi",
 *              "İptal" or the next 05:00, that table's QR refuses new orders with TABLE_RESERVED_SOON ("Bu masa 20:00 için
 *              ayrılmıştır. Sipariş için lütfen garsonunuza sorun."). A party already at the table keeps its orders, "Garson
 *              çağır" and "Hesabı iste"; staff see "20:00 rezervasyonu · masada hâlâ misafir var" (src/ReservationFloor.tsx).
 *   Not touched: staff orders, masasız sipariş, delivery platform orders.
 * MOLA_QR_STAFF_CHECK=0 (browser tests' server) or a unit test (NODE_TEST_CONTEXT) leaves the "staff screen connected" part
 * off unless a test turns it on (`staffRule`; POST /api/test/qr-staff in the browser tests): those suites order as guests
 * without any staff screen open. Stop and gün sonu pause always apply.
 */
export const BLOCK_DAYS = 90;
const DAY = 86_400_000;
type Seen = { at: number; role: Role };

export class QrOrdering {
  /** "A staff screen is connected" is required (off in unit tests and the browser tests' server unless turned on). */
  staffRule = process.env.MOLA_RELEASE_BUILD === '1' || (process.env.MOLA_QR_STAFF_CHECK !== '0' && !process.env.NODE_TEST_CONTEXT);
  /** How long a screen counts as connected after its last request (QR_STAFF_WINDOW_MS; browser tests shorten it). */
  windowMs = QR_STAFF_WINDOW_MS;
  private seen = new Map<string, Map<string, Seen>>();
  /** Called after any change a guest would notice (stop, open, pause, a staff screen came or went). */
  onChange: (() => void)[] = [];
  private last = new Map<string, string>();
  private timer: NodeJS.Timeout;
  constructor(private store: Store, private link: MerkezLink, private now: () => Date) {
    // Staff screens come and go with time: checked every few seconds; also the 90-day blocks (cheap: one read per business a day).
    this.timer = setInterval(() => { try { this.check(); } catch { /* the store is closing */ } }, 5000); this.timer.unref();
    link.onStop.push(() => clearInterval(this.timer));
  }
  /** A signed-in staff request (not remote, not Mola destek). */
  touch(tenant: string, session: string, role: Role) {
    if (role === 'support') return;
    let m = this.seen.get(tenant); if (!m) { m = new Map(); this.seen.set(tenant, m); }
    const fresh = !this.connectedRaw(tenant);
    m.set(session, { at: this.now().getTime(), role });
    if (m.size > 200) { const t = this.now().getTime(); for (const [k, v] of m) if (t - v.at > this.windowMs) m.delete(k); }
    if (fresh) this.notify();
  }
  /** That session signed out: it no longer counts (a closed tablet should not keep ordering open for 90 seconds). */
  forget(tenant: string, session: string) { if (this.seen.get(tenant)?.delete(session)) this.notify(); }
  private connectedRaw(tenant: string) {
    const t = this.now().getTime(), m = this.seen.get(tenant);
    if (!m) return false;
    for (const v of m.values()) if (t - v.at <= this.windowMs) return true;
    return false;
  }
  /** A staff screen that would see a guest's order is connected now (always true while the rule is off). */
  staffConnected(tenant: string) { return !this.staffRule || this.connectedRaw(tenant); }
  /** QR ordering is part of this business's service at all (package and "Sadece QR menü"). */
  applies(tenant: string) { return this.link.has(tenant, 'qr-order') && !this.link.menuOnly(tenant); }
  view(tenant: string, s?: Pick<State, 'qrOrdering'>, role?: Actor['role']): QrOrderingView {
    const state = (s ?? this.store.read(tenant)).qrOrdering;
    const v = qrOrderingView(state, this.staffConnected(tenant), this.now().getTime());
    return role && (QR_CHANGERS as readonly string[]).includes(role) ? { ...v, canChange: true } : v;
  }
  /**
   * Rezerve masada QR (12 Ekim): the reservation holding this table now, if any. Only with "Rezervasyon ve etkinlik" in the
   * service (without it the floor shows no reservations either; the data stays). The setting and the rule:
   * packages/domain/reservations.ts (holdMinutes, tableHold).
   */
  tableHold(tenant: string, s: Pick<State, 'reservations' | 'reservationSettings'>, tableId: string | undefined) {
    if (!tableId || !this.link.has(tenant, 'reservations')) return undefined;
    return tableHold(s.reservations, tableId, this.now().getTime(), reservationSettings(s.reservationSettings).holdMinutes);
  }
  /** The guest snapshot's part: the café's state, or this table held for a reservation ("Bu masa 20:00 için ayrılmıştır"). */
  guestView(tenant: string, s: Pick<State, 'qrOrdering' | 'reservations' | 'reservationSettings'>, tableId?: string): GuestOrdering {
    const { open, reason, call } = this.view(tenant, s), hold = this.tableHold(tenant, s, tableId);
    if (hold) return { open: false, reason: 'reserved', call, reservedFor: hold.time };
    return { open, ...(reason ? { reason } : {}), call };
  }
  /** A new guest order: refused while closed or while its table is held (the café's word, whatever the phone showed). */
  assertGuestOrder(tenant: string, s: Pick<State, 'qrOrdering' | 'reservations' | 'reservationSettings'>, tableId?: string) {
    const hold = this.tableHold(tenant, s, tableId);
    if (hold) throw new DomainError('TABLE_RESERVED_SOON', reservedText(hold.time).tr, 409);
    if (!this.view(tenant, s).open) throw new DomainError('ORDERING_CLOSED', QR_CLOSED_TEXT.tr, 409);
  }
  /** Garson çağır / Hesabı iste: only while someone could hear it. */
  assertGuestCall(tenant: string) {
    if (!this.staffConnected(tenant)) throw new DomainError('CALL_UNAVAILABLE', 'Şu an personel ekranı bağlı değil. Lütfen garsonunuza seslenin.', 409);
  }
  /** Gün sonu completed (server/cash-closing.ts): paused for this business day. */
  pauseForClosing(tenant: string, at: Date, byName?: string) {
    this.store.mutate(tenant, s => {
      if (!this.applies(tenant)) return;
      s.qrOrdering = { ...s.qrOrdering, paused: { at: at.toISOString(), day: businessDay(at.getTime()), ...(byName ? { byName } : {}) } };
      s.audit.push({ action: 'qr_ordering.paused', actor: 'system', target: 'closing', at: at.toISOString() });
    });
    this.notify();
  }
  /** The cash day was opened (sabah açılışı): a gün sonu pause ends by itself. */
  openedCashDay(tenant: string) {
    const s = this.store.read(tenant);
    if (!s.qrOrdering?.paused) return;
    this.store.mutate(tenant, x => { if (x.qrOrdering?.paused) { delete x.qrOrdering.paused; x.audit.push({ action: 'qr_ordering.opened', actor: 'system', target: 'cash_open', at: this.now().toISOString() }); } });
    this.notify();
  }
  notify() { for (const f of this.onChange) try { f(); } catch { /* their own business */ } }
  /** What changed since the last look (the tunnel tells Mola Merkez at once); blocks older than 90 days are lifted. */
  private check() {
    let any = false;
    for (const tenant of Object.keys(this.link.read()?.licenses ?? {})) {
      let s: State; try { s = this.store.read(tenant); } catch { continue; }
      const key = JSON.stringify(this.applies(tenant) ? this.view(tenant, s) : null);
      if (this.last.get(tenant) !== key) { this.last.set(tenant, key); any = true; }
      pruneBlocked(this.store, tenant, s, this.now());
    }
    if (any) this.notify();
  }
  /** Every business of this install, for Mola Merkez (Mola Yönetim's Özet): null where QR ordering is not in the service. */
  report(): Record<string, { open: boolean; reason?: string; since?: string; call: boolean } | null> {
    const out: Record<string, { open: boolean; reason?: string; since?: string; call: boolean } | null> = {};
    for (const tenant of Object.keys(this.link.read()?.licenses ?? {})) {
      try {
        if (!this.applies(tenant)) { out[tenant] = null; continue; }
        const { open, reason, since, call } = this.view(tenant);
        out[tenant] = { open, ...(reason ? { reason } : {}), ...(since ? { since } : {}), call };
      } catch { /* a business being set up */ }
    }
    return out;
  }
}

/**
 * "Bu tarayıcıyı engelle" lasts 90 days (retention, 8 Ekim): an older block is lifted. Blocks from before the date was kept
 * get today's date once, so they too end 90 days later.
 */
export function pruneBlocked(store: Store, tenant: string, s: State, now: Date) {
  if (!s.blocked.length) return;
  const t = now.getTime(), undated = s.blocked.filter(id => !s.blockedInfo?.[id]?.at), expired = s.blocked.filter(id => { const at = Date.parse(s.blockedInfo?.[id]?.at ?? ''); return Number.isFinite(at) && t - at > BLOCK_DAYS * DAY; });
  if (!undated.length && !expired.length) return;
  store.mutate(tenant, x => {
    for (const id of x.blocked) { const info = x.blockedInfo?.[id]; if (!info?.at) (x.blockedInfo ??= {})[id] = { ...(info ?? { orderId: '', number: 0, label: '' }), at: now.toISOString() }; }
    const gone = new Set(x.blocked.filter(id => { const at = Date.parse(x.blockedInfo?.[id]?.at ?? ''); return Number.isFinite(at) && t - at > BLOCK_DAYS * DAY; }));
    if (!gone.size) return;
    x.blocked = x.blocked.filter(id => !gone.has(id));
    for (const id of gone) delete x.blockedInfo?.[id];
    x.audit.push({ action: 'browser.unblocked_expired', actor: 'system', target: String(gone.size), at: now.toISOString() });
  });
}

/** GET /api/staff/qr-ordering (the chip), POST { requestId, open } ("QR siparişlerini durdur" / "Aç"). */
export function qrOrderingRoutes(app: Express, store: Store, qr: QrOrdering, staffActor: (req: Request) => Actor, now: () => Date) {
  app.get('/api/staff/qr-ordering', (req, res) => {
    const a = staffActor(req);
    res.json(qr.applies(a.tenantId) ? qr.view(a.tenantId, undefined, a.role) : null);
  });
  app.post('/api/staff/qr-ordering', (req, res) => {
    const a = staffActor(req), b = z.object({ requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), open: z.boolean() }).strict().parse(req.body);
    if (!qr.applies(a.tenantId)) throw new DomainError('FEATURE_NOT_IN_PACKAGE', 'Bu işletmede QR siparişi yok.', 403);
    store.mutate(a.tenantId, s => {
      requireRole(s, a, [...QR_CHANGERS]);
      const at = now().toISOString(), name = s.staffUsers?.find(u => u.id === a.id)?.name ?? '';
      if (b.open) {
        const was = s.qrOrdering?.stopped ? 'manual' : s.qrOrdering?.paused ? 'closing' : '';
        if (s.qrOrdering) { delete s.qrOrdering.stopped; delete s.qrOrdering.paused; }
        if (was) s.audit.push({ action: 'qr_ordering.opened', actor: a.id, target: was, at });
      } else if (!s.qrOrdering?.stopped) {
        s.qrOrdering = { ...s.qrOrdering, stopped: { at, by: a.id, byName: name } };
        s.audit.push({ action: 'qr_ordering.stopped', actor: a.id, target: 'manual', at });
      }
    });
    qr.notify();
    res.json(qr.view(a.tenantId, undefined, a.role));
  });
}

/**
 * Browser tests only (MOLA_TEST_TUNNEL=1 from scripts/test-server.mjs; never in a release build): from this computer, turn the
 * "a staff screen is connected" rule on (the tests' server starts with it off) and shorten its window.
 */
export function qrTestRoute(app: Express, qr: QrOrdering, security: HttpSecurity) {
  if (process.env.MOLA_TEST_TUNNEL !== '1' || process.env.MOLA_RELEASE_BUILD === '1') return;
  app.post('/api/test/qr-staff', (req, res) => {
    if (!directLoopback(req, security)) throw new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404);
    const b = z.object({ on: z.boolean(), windowMs: z.number().int().min(500).max(QR_STAFF_WINDOW_MS).optional() }).strict().parse(req.body);
    qr.staffRule = b.on; qr.windowMs = b.windowMs ?? QR_STAFF_WINDOW_MS; qr.notify();
    res.json({ on: qr.staffRule, windowMs: qr.windowMs });
  });
}