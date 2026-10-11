import type { Express, NextFunction, Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import { menuCategories, menuNamesEn, menuSubcategories } from '../packages/domain/categories.js';
import { newProductIds } from '../packages/domain/new-products.js';
import { SUPPORT_CAN, SUPPORT_CANNOT } from '../packages/domain/roles.js';
import { sectorOf } from '../packages/domain/sector.js';
import { socialLinksOf } from '../packages/domain/social-links.js';
import { floorTables } from '../packages/domain/takeaway.js';
import type { Actor, StaffSnapshot, State } from '../packages/domain/types.js';
import { APP_VERSION } from './license.js';
import type { MerkezLink } from './kafe-link.js';
import type { Notifications } from './notifications.js';
import type { PersistentFailures } from './persistent-failures.js';
import type { RelayClient } from './relay.js';
import { RELAY, RELAY_HEADERS, type RelayReply, type RelayRequest } from './relay-protocol.js';
import { open, seal } from './sealing.js';
import { snapshotKey, type Store } from './store.js';

/*
 * Uzaktan destek ("Mola destek", role `support`). The owner switches "Uzaktan destek izni" on or off in Destek → Uzaktan
 * erişim (no time limit). While it is on, the vendor presses "Kafeye bağlan" in Mola Yönetim; Mola Merkez asks this café over
 * the köprü (server/relay.ts) to start a session, then passes the vendor's screen requests to it (relay kind `http`). They are
 * replayed here against this very app on a private loopback listener, marked with this process's own random secret and the
 * session id (x-mola-relay); the marker is the only way to the support role: no cookie, no account, no password.
 *
 * Enforced here, on the server: `gate` lets a marked request through only on SUPPORT_ROUTES (menu, categories, products and
 * photos, campaigns, tables and QR, printers, sounds, non-money settings, the business look, diagnostics); everything else is
 * 403 SUPPORT_FORBIDDEN before any route runs. The routes it reaches check the `support` role themselves too (requireRole), the
 * screen snapshot has no orders, bills, payments, reservations or sales (`snapshot`), campaigns lose their sold counts.
 * Every change is written to the owner's log ("Mola destek: Latte fiyatı ₺90 → ₺95"), visible in Destek, and the owner gets a
 * notification when a session starts and ends. Switching the permission off ends every session at once (here, and Merkez is
 * told). A session ends after RELAY.SESSION_IDLE_MS without a request, and with this server (sessions live in memory).
 */
type SessionRow = { id: string; startedAt: string; endedAt?: string; endedBy?: 'owner' | 'vendor' | 'timeout' | 'restart' | 'off'; actions: number };
type LogRow = { at: string; session: string; text: string };
export type SupportRecord = { v: 1; on: boolean; since?: string; by?: string; sessions: SessionRow[]; log: LogRow[] };
type Live = { id: string; tenant: string; startedAt: number; lastAt: number };
/** Screen requests Mola destek may make (method + path, query ignored). Anything else: 403 before any route runs. */
const SUPPORT_ROUTES: [string, RegExp][] = [
  ['GET', /^\/api\/(health|contact)$/], ['GET', /^\/api\/staff\/(me|state|network|campaigns|printers|printers\/windows|sounds|shifts\/me|support-session|support-session\/diagnostics)$/],
  ['GET', /^\/media\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\/[a-f0-9-]{36}(-small)?\.webp$/],
  ['POST', /^\/api\/logout$/],
  ['POST', /^\/api\/staff\/(heartbeat|products|products\/discard-draft|photos|photo-source|catalog\/remove|categories|campaigns|tables\/add|tables\/area|tables\/remove|tables\/renew-qr|qr-printed|printers|printers\/delete|printers\/test|sounds|settings|business-profile|social-links)$/],
];
export const supportAllowed = (method: string, path: string) => SUPPORT_ROUTES.some(([m, p]) => m === method.toUpperCase() && p.test(path));
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const tl = (kurus: number) => `₺${(kurus / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
const clock = (iso: string | number) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
export const SUPPORT_ID = 'mola-destek';
export const SUPPORT_NAME = 'Mola destek';

export class SupportDesk {
  private live = new Map<string, Live>();
  /** This process's own secret: only requests replayed by `dispatch` carry it. */
  private secret = randomBytes(32).toString('base64url');
  private internal?: Promise<{ server: Server; port: number }>;
  private app?: Express; private timer?: NodeJS.Timeout;
  notifications?: () => Pick<Notifications, 'add'> | undefined;
  failures?: PersistentFailures;
  constructor(private store: Store, private link: MerkezLink, private relay: RelayClient, private now: () => Date, private publicOrigin?: string) {
    store.db.exec('CREATE TABLE IF NOT EXISTS support_access (tenant TEXT PRIMARY KEY, payload BLOB NOT NULL)');
    // Sessions live in memory: whatever was open when this server stopped ended then.
    for (const { tenant } of store.db.prepare('SELECT tenant FROM support_access').all() as { tenant: string }[]) {
      try { const r = this.read(tenant); if (r.sessions.some(x => !x.endedAt)) this.write(tenant, x => { for (const s of x.sessions) if (!s.endedAt) { s.endedAt = this.now().toISOString(); s.endedBy = 'restart'; } }); } catch { /* a business without its key yet */ }
    }
    relay.sources.push(() => this.tenants());
    relay.on('support.start', r => this.start(r as Extract<RelayRequest, { kind: 'support.start' }>));
    relay.on('support.end', async r => { const x = r as Extract<RelayRequest, { kind: 'support.end' }>; this.end(x.session, x.reason === 'timeout' ? 'timeout' : 'vendor'); return { status: 200, json: { ok: true } }; });
    relay.on('http', r => this.dispatch(r as Extract<RelayRequest, { kind: 'http' }>));
    this.timer = setInterval(() => { try { this.sweep(); } catch { /* store closed */ } }, 60_000); this.timer.unref();
  }
  // ---------- The owner's record (sealed with the business key) ----------
  private key(tenant: string) { const k = snapshotKey(this.store.db, this.store.key, tenant); if (!k) throw new Error('İşletme anahtarı eksik.'); return k; }
  read(tenant: string): SupportRecord {
    const row = this.store.db.prepare('SELECT payload FROM support_access WHERE tenant=?').get(tenant) as { payload: Uint8Array } | undefined;
    return row ? open<SupportRecord>(Buffer.from(row.payload), this.key(tenant), `support-access:${tenant}`) : { v: 1, on: false, sessions: [], log: [] };
  }
  private write<T>(tenant: string, fn: (r: SupportRecord) => T): T {
    const r = this.read(tenant), result = fn(r);
    r.sessions = r.sessions.slice(-50); r.log = r.log.slice(-300);
    this.store.db.prepare('INSERT INTO support_access (tenant,payload) VALUES (?,?) ON CONFLICT(tenant) DO UPDATE SET payload=excluded.payload').run(tenant, seal(r, this.key(tenant), `support-access:${tenant}`));
    return result;
  }
  /** For the relay: the businesses whose owner allows support now. */
  tenants() { return (this.store.db.prepare('SELECT tenant FROM support_access').all() as { tenant: string }[]).flatMap(({ tenant }) => { try { return this.read(tenant).on ? [{ tenantId: tenant, support: true, phones: [] }] : []; } catch { return []; } }); }
  /** Mola is activated on this computer (the relay needs the install's signed link). */
  activated() { try { return this.link.relayReady(); } catch { return false; } }
  /** A session open right now for this business (the "Mola ekibi bağlı" banner). */
  connected(tenant: string) { const l = [...this.live.values()].find(x => x.tenant === tenant); return l ? { since: new Date(l.startedAt).toISOString() } : undefined; }
  private notify(tenant: string, key: string, title: string, text: string) { try { this.notifications?.()?.add(tenant, key, { kind: 'merkez', title, text }); } catch { /* the log still has it */ } }
  setAccess(tenant: string, on: boolean, by: string) {
    const at = this.now().toISOString();
    const changed = this.write(tenant, r => { if (r.on === on) return false; r.on = on; if (on) { r.since = at; r.by = by; } else { r.since = undefined; r.by = undefined; } r.log.push({ at, session: '', text: on ? `Uzaktan destek izni açıldı (${by}).` : `Uzaktan destek izni kapatıldı (${by}).` }); return true; });
    if (!on) for (const l of [...this.live.values()]) if (l.tenant === tenant) this.end(l.id, 'off');
    if (changed) { this.relay.refresh(); void this.relay.announce(); }
    return this.read(tenant);
  }
  // ---------- Sessions ----------
  private async start(r: Extract<RelayRequest, { kind: 'support.start' }>): Promise<RelayReply> {
    const record = this.link.read();
    if (!record?.licenses[r.tenantId] || this.link.removed(r.tenantId) || !this.store.db.prepare('SELECT tenant FROM snapshots WHERE tenant=?').get(r.tenantId)) throw new DomainError('NOT_FOUND', 'İşletme bu bilgisayarda yok.', 404);
    if (!this.read(r.tenantId).on) throw new DomainError('SUPPORT_OFF', 'İşletme sahibi uzaktan destek izni vermedi.', 403);
    if (!z.string().uuid().safeParse(r.session).success) throw new DomainError('INVALID', 'Geçersiz oturum.', 400);
    // One session per business: a new one ends the one before it.
    for (const l of [...this.live.values()]) if (l.tenant === r.tenantId && l.id !== r.session) this.end(l.id, 'vendor');
    if (!this.live.has(r.session)) {
      const t = this.now();
      this.live.set(r.session, { id: r.session, tenant: r.tenantId, startedAt: t.getTime(), lastAt: t.getTime() });
      this.write(r.tenantId, x => { x.sessions.push({ id: r.session, startedAt: t.toISOString(), actions: 0 }); x.log.push({ at: t.toISOString(), session: r.session, text: 'Mola ekibi bağlandı.' }); });
      this.notify(r.tenantId, `support:start:${r.session}`, 'Mola ekibi bağlandı', `Uzaktan destek oturumu ${clock(t.getTime())}'de başladı. Yapılan her değişiklik Destek → Uzaktan erişim'de görünür; izni oradan kapatabilirsiniz.`);
    }
    return { status: 200, json: { ok: true } };
  }
  end(session: string, why: NonNullable<SessionRow['endedBy']>) {
    const l = this.live.get(session); if (!l) return false;
    this.live.delete(session);
    const at = this.now().toISOString();
    let actions = 0;
    try {
      this.write(l.tenant, x => { const row = x.sessions.find(s => s.id === session); if (row && !row.endedAt) { row.endedAt = at; row.endedBy = why; actions = row.actions; } x.log.push({ at, session, text: why === 'off' ? 'Oturum kapandı: izin kapatıldı.' : why === 'owner' ? 'Oturumu işletme sahibi kesti.' : why === 'timeout' ? 'Oturum kapandı: 30 dakika işlem yapılmadı.' : 'Mola ekibi oturumu kapattı.' }); });
      this.notify(l.tenant, `support:end:${session}`, 'Mola destek oturumu bitti', `Oturum ${clock(at)}'de bitti${actions ? ` · ${actions} değişiklik` : ' · değişiklik yapılmadı'}. Ayrıntılar Destek → Uzaktan erişim'de.`);
    } catch { /* store closing */ }
    // Merkez hears that this café ended it (the vendor's screen says "oturum kapandı").
    if (why === 'owner' || why === 'off' || why === 'timeout') void this.relay.announce();
    return true;
  }
  /** The owner's "Bağlantıyı kes": ends the open sessions, the permission stays as it is. */
  endAll(tenant: string) { let n = 0; for (const l of [...this.live.values()]) if (l.tenant === tenant && this.end(l.id, 'owner')) n++; return n; }
  sweep() { const t = this.now().getTime(); for (const l of [...this.live.values()]) if (t - l.lastAt > RELAY.SESSION_IDLE_MS || t - l.startedAt > RELAY.SESSION_MAX_MS) this.end(l.id, 'timeout'); }
  // ---------- Replaying the vendor's screen requests on this app ----------
  attach(app: Express) { this.app = app; }
  private listen() {
    return this.internal ??= new Promise((done, fail) => {
      const server = createServer(this.app!); server.unref(); server.once('error', fail);
      server.listen(0, '127.0.0.1', () => done({ server, port: (server.address() as AddressInfo).port }));
    });
  }
  close() { clearInterval(this.timer); void this.internal?.then(i => i.server.close()).catch(() => {}); }
  private async dispatch(r: Extract<RelayRequest, { kind: 'http' }>): Promise<RelayReply> {
    const l = this.live.get(r.session);
    if (!l || l.tenant !== r.tenantId) throw new DomainError('SUPPORT_ENDED', 'Destek oturumu kapandı. Mola Yönetim’den yeniden bağlanın.', 401);
    if (!['GET', 'POST'].includes(r.method) || !/^\/[\x21-\x7e]*$/.test(r.path) || r.path.length > 2000) throw new DomainError('INVALID', 'Geçersiz istek.', 400);
    const { port } = await this.listen();
    const body = r.body ? Buffer.from(r.body, 'base64') : undefined;
    const headers: Record<string, string> = { 'x-mola-relay': `${this.secret}.${r.session}` };
    for (const h of RELAY_HEADERS) if (typeof r.headers?.[h] === 'string' && r.headers[h].length <= 200) headers[h] = r.headers[h];
    if (body) headers['content-length'] = String(body.length);
    // Behind a local TLS proxy (PUBLIC_ORIGIN) the app expects HTTPS and its own origin; this listener is that proxy's side.
    if (this.publicOrigin) { headers.host = new URL(this.publicOrigin).host; headers['x-forwarded-proto'] = 'https'; if (r.method !== 'GET') headers.origin = this.publicOrigin; }
    return new Promise<RelayReply>((done, fail) => {
      const req = httpRequest({ host: '127.0.0.1', port, method: r.method, path: r.path, headers, timeout: RELAY.REQUEST_TIMEOUT_MS - 2000 }, res => {
        const parts: Buffer[] = []; let size = 0;
        res.on('data', (c: Buffer) => { size += c.length; if (size > RELAY.MAX_REPLY_B64 * 3 / 4) { req.destroy(); fail(new DomainError('TOO_LARGE', 'Yanıt çok büyük.', 502)); return; } parts.push(c); });
        res.on('end', () => { const data = Buffer.concat(parts); done({ status: res.statusCode ?? 500, ...(data.length ? { body: data.toString('base64') } : {}), ...(res.headers['content-type'] ? { type: String(res.headers['content-type']).slice(0, 100) } : {}), ...(res.headers['x-mola-tag'] ? { tag: String(res.headers['x-mola-tag']).slice(0, 100) } : {}) }); });
        res.on('error', fail);
      });
      req.on('timeout', () => req.destroy(new DomainError('TIMEOUT', 'Kafe bilgisayarı yanıt vermedi.', 504)));
      req.on('error', fail);
      req.end(body);
    });
  }
  /** The support session of a marked request (only `gate` sets it). */
  actorOf(req: Request): Actor | undefined {
    const l = req.res?.locals.supportSession as Live | undefined;
    return l ? { tenantId: l.tenant, id: SUPPORT_ID, role: 'support' } : undefined;
  }
  /**
   * Registered before every route of the café app: a request with the relay marker is a support request, and only then.
   * The marker must come from this process (its secret) over loopback, for a live session of a business that still allows it.
   */
  gate() {
    return (req: Request, res: Response, next: NextFunction) => {
      const marker = req.headers['x-mola-relay'];
      if (marker === undefined) return next();
      const [secret, session] = String(marker).split('.'), expected = Buffer.from(this.secret), given = Buffer.from(secret ?? '');
      const mine = LOOPBACK.includes(req.socket.remoteAddress ?? '') && given.length === expected.length && timingSafeEqual(given, expected);
      if (!mine) return next(new DomainError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403));
      this.sweep();
      const l = this.live.get(session ?? '');
      let allowed = false; try { allowed = !!l && this.read(l.tenant).on; } catch { allowed = false; }
      if (!l || !allowed) { if (l) this.end(l.id, 'off'); return next(new DomainError('SUPPORT_ENDED', 'Destek oturumu kapandı. Mola Yönetim’den yeniden bağlanın.', 401)); }
      if (!supportAllowed(req.method, req.path)) return next(new DomainError('SUPPORT_FORBIDDEN', 'Mola destek bu bölümü açamaz: satış, para, çalışan ve güvenlik bilgileri yalnız işletmede görünür.', 403));
      l.lastAt = this.now().getTime();
      res.locals.supportSession = l;
      if (req.method === 'GET' && req.path === '/api/health') { res.json({ ok: true, mode: 'installed', role: 'kafe', version: APP_VERSION, activation: 'ready', demoAvailable: false, support: true }); return; }
      if (req.method === 'POST' && req.path === '/api/logout') { this.end(l.id, 'vendor'); res.json({ ok: true }); return; }
      if (req.method === 'GET' && req.path === '/api/staff/me') { res.json({ role: 'support', username: SUPPORT_ID }); return; }
      if (req.method === 'GET' && req.path === '/api/staff/support-session') { res.json(this.sessionInfo(l)); return; }
      if (req.method === 'GET' && req.path === '/api/staff/support-session/diagnostics') { res.json(this.diagnostics(l.tenant)); return; }
      if (req.method !== 'GET') this.watch(req, res, l);
      next();
    };
  }
  private sessionInfo(l: Live) { const s = this.store.read(l.tenant); return { business: s.name, since: new Date(l.startedAt).toISOString(), idleMinutes: Math.round(RELAY.SESSION_IDLE_MS / 60_000), can: SUPPORT_CAN, cannot: SUPPORT_CANNOT }; }
  /** Tanılama: what helps the Mola team (versions, the link, printers, the code places of recent errors); no business numbers. */
  diagnostics(tenant: string) {
    const s = this.store.read(tenant), link = this.link.linkStatus(tenant), license = this.link.summary(tenant);
    const printers = (s.printers ?? []).map(p => ({ name: p.name, enabled: p.enabled, kind: p.connection.type, orders: p.orders, bill: p.bill }));
    const failures = (this.failures?.list(tenant) ?? []).slice(0, 30).map(f => ({ at: f.at, method: f.method, route: f.route, status: f.status, code: f.code, requestId: f.requestId, frames: f.frames ?? [] }));
    return { version: APP_VERSION, node: process.version, platform: process.platform, business: s.name, sector: sectorOf(s), setupCompleted: !!s.setupCompleted, counts: { tables: floorTables(s).length, products: s.products.length, categories: menuCategories(s).length, printers: printers.length },
      license: license ? { active: license.active, plan: license.kind, service: license.service ?? 'full', endsAt: license.endsAt ?? null, daysRemaining: license.daysRemaining } : null,
      link: { lastContactAt: link.lastContactAt, offlineDays: link.offlineDays, clockSkewMs: link.clockSkewMs, notice: link.notice }, printers, failures };
  }
  /** Writes what a support write did into the owner's log, once it succeeded. */
  private watch(req: Request, res: Response, l: Live) {
    const before = this.store.read(l.tenant), body = (req.body ?? {}) as Record<string, any>;
    let answer: unknown;
    const send = res.json.bind(res);
    res.json = (value: unknown) => { answer = value; return send(value); };
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      let text: string | undefined;
      try { text = describe(req.path, body, before, this.store.read(l.tenant), answer); } catch { text = undefined; }
      if (!text) return;
      try { this.write(l.tenant, x => { x.log.push({ at: this.now().toISOString(), session: l.id, text }); const row = x.sessions.find(s => s.id === l.id); if (row) row.actions++; }); } catch { /* store closing */ }
    });
  }
  /** Mola destek's own screen state: the menu and the floor plan; no orders, bills, payments, guests, reservations or sales. */
  snapshot(tenant: string): StaffSnapshot {
    const s: State = this.store.read(tenant), now = this.now(), l = [...this.live.values()].find(x => x.tenant === tenant);
    const printers = (s.printers ?? []).filter(p => p.enabled);
    return {
      role: 'support', username: SUPPORT_ID, displayName: SUPPORT_NAME, name: s.name, logo: s.logo, theme: s.theme, menuHero: s.menuHero, googleReviewUrl: s.googleReviewUrl, socialLinks: socialLinksOf(s), sector: sectorOf(s),
      // Campaign prices are left out (their sold counts would show); the menu screens price from the product itself.
      products: s.products.map(p => ({ ...p, discounts: [] })), productDrafts: s.productDrafts ?? [], categories: menuCategories(s), subcategories: menuSubcategories(s), categoryNamesEn: menuNamesEn(s),
      tables: floorTables(s).map(t => ({ ...t, accountId: null, needsCleaning: false, account: null })), ...(s.areaOrder?.length ? { areaOrder: s.areaOrder } : {}), takeaways: [], orders: [], popularProductIds: [], newProductIds: newProductIds(s.products, now),
      revision: s.menuRevision, businessRevision: s.businessRevision, setupCompleted: s.setupCompleted, changeSeconds: s.changeSeconds, commissionBps: null, paymentMode: s.paymentMode ?? 'after_service',
      cleaningEnabled: !!s.cleaningEnabled, waiterApproval: !!s.waiterApproval, autoApproveQr: !!s.autoApproveQr, approvalVersion: s.approvalVersion ?? 0, printing: { orders: printers.some(p => p.orders), bill: printers.some(p => p.bill) },
      ...(l ? { supportConnected: { since: new Date(l.startedAt).toISOString() } } : {}),
    };
  }
  /** Owner screen: Destek → Uzaktan erişim. */
  view(tenant: string) {
    const r = this.read(tenant), l = this.connected(tenant);
    return { on: r.on, since: r.since ?? null, by: r.by ?? null, active: l ? { since: l.since } : null, relay: { connected: this.relay.connected(), error: this.relay.lastError },
      sessions: [...r.sessions].reverse().slice(0, 20), log: [...r.log].reverse().slice(0, 100), can: SUPPORT_CAN, cannot: SUPPORT_CANNOT };
  }
}

/** One plain line per support change, in the owner's words. undefined: nothing worth a line (a read through POST). */
export function describe(path: string, b: Record<string, any>, before: State, after: State, answer: unknown): string | undefined {
  const a = (answer ?? {}) as Record<string, any>;
  const product = (s: State, id?: string) => id ? s.products.find(p => p.id === id) ?? s.productDrafts?.find(p => p.id === id) : undefined;
  switch (path) {
    case '/api/staff/products': {
      const p = b.product ?? {}, old = product(before, b.id);
      if (!old) return `Yeni ürün eklendi: ${p.name}${p.price ? ` (${tl(p.price)})` : ''}${p.published === false ? ' · taslak' : ''}.`;
      const changes = [old.name !== p.name && `ad “${old.name}” → “${p.name}”`, old.price !== p.price && `fiyat ${tl(old.price)} → ${tl(p.price)}`, old.category !== p.category && `kategori ${old.category || '—'} → ${p.category || '—'}`, !!old.soldOut !== !!p.soldOut && (p.soldOut ? 'tükendi yapıldı' : 'yeniden satışta'), b.action === 'unpublish' && 'taslağa alındı', b.action === 'publish' && 'yayınlandı'].filter(Boolean);
      return `Ürün değişti: ${p.name}${changes.length ? ` · ${changes.join(', ')}` : ''}.`;
    }
    case '/api/staff/products/discard-draft': return `Ürün taslağı silindi${product(before, b.id) ? `: ${product(before, b.id)!.name}` : ''}.`;
    case '/api/staff/photos': return 'Ürün fotoğrafı yüklendi.';
    case '/api/staff/photo-source': return undefined;
    case '/api/staff/catalog/remove': return b.kind === 'product' ? `Ürün silindi: ${product(before, b.id)?.name ?? 'ürün'}.` : `Kampanya silindi: ${before.campaigns?.find(c => c.id === b.id)?.name ?? 'kampanya'}.`;
    case '/api/staff/categories': return b.action === 'add' ? `Kategori eklendi: ${b.name}.` : b.action === 'rename' ? `Kategori adı değişti: ${b.name} → ${b.nextName}.` : b.action === 'remove' ? `Kategori silindi: ${b.name}.` : b.action === 'reorder' ? 'Kategori sırası değişti.' : b.action === 'english' ? 'Kategori İngilizce adı değişti.' : `Alt bölüm düzenlendi${b.name ? `: ${b.name}` : ''}.`;
    case '/api/staff/campaigns': return `Kampanya ${b.campaign?.id ? 'düzenlendi' : 'eklendi'}: ${b.campaign?.name ?? ''}.`;
    case '/api/staff/tables/add': return `Masa eklendi: ${a.name ?? ''}.`;
    case '/api/staff/tables/area': { const t = before.tables.find(x => x.id === b.tableId); return `Masa bölümü değişti${t ? `: ${t.name}` : ''}.`; }
    case '/api/staff/tables/layout': return 'Masaların ve bölümlerin sırası değişti.';
    case '/api/staff/tables/area-rename': return `Bölüm adı değişti: ${b.from} → ${a.area ?? b.to}.`;
    case '/api/staff/tables/remove': return `Masa çıkarıldı: ${a.name ?? ''}.`;
    case '/api/staff/tables/renew-qr': return `QR kodu yenilendi: ${a.tableName ?? ''}. Eski QR artık açılmaz; yenisini yazdırın.`;
    case '/api/staff/qr-printed': return 'Masa QR kodları yazdırıldı ya da indirildi.';
    case '/api/staff/printers': return `Yazıcı ${b.id ? 'düzenlendi' : 'eklendi'}: ${b.printer?.name ?? ''}.`;
    case '/api/staff/printers/delete': return `Yazıcı silindi: ${before.printers?.find(p => p.id === b.id)?.name ?? ''}.`;
    case '/api/staff/printers/test': return `Deneme fişi gönderildi: ${before.printers?.find(p => p.id === b.id)?.name ?? ''}.`;
    case '/api/staff/sounds': return 'Bildirim sesi değişti.';
    case '/api/staff/settings': {
      const changes = [b.sector !== undefined && b.sector !== before.sector && 'işletme türü', b.paymentMode !== undefined && b.paymentMode !== (before.paymentMode ?? 'after_service') && 'ödeme sırası', b.cleaningEnabled !== undefined && !!b.cleaningEnabled !== !!before.cleaningEnabled && 'masa temizliği', b.waiterApproval !== undefined && !!b.waiterApproval !== !!before.waiterApproval && 'QR onayı', b.changeSeconds !== undefined && b.changeSeconds !== before.changeSeconds && 'değiştirme süresi'].filter(Boolean);
      return changes.length ? `Ayar değişti: ${changes.join(', ')}.` : undefined;
    }
    case '/api/staff/business-profile': return `İşletme görünümü değişti${before.name !== after.name ? ` (ad: ${before.name} → ${after.name})` : ''}.`;
    case '/api/staff/social-links': return 'Sosyal medya bağlantıları değişti.';
    default: return undefined;
  }
}

/**
 * Owner routes (Destek → Uzaktan erişim; the owner's own account, 403 for Müdür, other staff and Mola destek):
 * GET /api/staff/remote-support, POST /api/staff/remote-support { on, password } (izin aç/kapat: turning it on needs the
 * owner's password again, checked in this request; turning it off needs nothing), POST /api/staff/remote-support/end
 * ("Bağlantıyı kes"). Mola destek's own: GET /api/staff/support-session(/diagnostics), answered in `gate`.
 */
export function supportRoutes(app: Express, store: Store, desk: SupportDesk, actorFor: (req: Request) => Actor, confirmPassword: (req: Request, actor: Actor, password: string | undefined) => Promise<void>) {
  const owner = (req: Request) => { const a = actorFor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner']); return { a, s }; };
  app.get('/api/staff/remote-support', (req, res) => { const { a } = owner(req); res.setHeader('Cache-Control', 'no-store'); res.json(desk.view(a.tenantId)); });
  app.post('/api/staff/remote-support', async (req, res) => {
    let { a, s } = owner(req);
    const { on, password } = z.object({ on: z.boolean(), password: z.string().max(200).optional() }).strict().parse(req.body);
    if (on && !desk.activated()) throw new DomainError('NOT_ACTIVATED', 'Mola bu bilgisayarda henüz etkinleştirilmedi.', 409);
    if (on) { await confirmPassword(req, a, password); ({ a, s } = owner(req)); }
    const name = s.staffUsers?.find(u => u.id === a.id)?.name ?? 'İşletme sahibi';
    desk.setAccess(a.tenantId, on, name);
    store.mutate(a.tenantId, x => { x.audit.push({ action: on ? 'support.access_on' : 'support.access_off', actor: a.id, target: a.tenantId, at: new Date().toISOString() }); });
    res.json(desk.view(a.tenantId));
  });
  app.post('/api/staff/remote-support/end', (req, res) => { const { a } = owner(req); desk.endAll(a.tenantId); res.json(desk.view(a.tenantId)); });
}
