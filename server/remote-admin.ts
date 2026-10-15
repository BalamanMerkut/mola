import type { Express, NextFunction, Request, Response } from 'express';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import { cafePrivateKey, randomB64u } from '../packages/domain/remote-crypto.js';
import { cafeSession, openCall, PART_CHARS, readAdminOpen, sealOpenAnswer, sealReply, type AdminAnswer, type AdminOpenAnswer, type TunnelRequest, type TunnelResponse } from '../packages/domain/remote-admin-crypto.js';
import type { Actor, Role } from '../packages/domain/types.js';
import { passwordMatches } from './accounts.js';
import type { MerkezLink } from './kafe-link.js';
import type { Notifications } from './notifications.js';
import type { RelayClient } from './relay.js';
import { RELAY, type AdminRequest, type RelayReply, type RelayRequest } from './relay-protocol.js';
import type { RemoteReports } from './remote-reports.js';
import { open, seal } from './sealing.js';
import { businessDayEnd } from './sessions.js';
import { snapshotKey, type Store } from './store.js';
import { verifyTotp } from './totp.js';
import { FEATURE_NOT_IN_PACKAGE, notInPackage } from '../packages/domain/feature-gate.js';

/*
 * Sahibin uzaktan yönetimi ("Kafeyi yönet"). The owner opens the café's full screens on a device paired for Raporlarım
 * (server/remote-reports.ts) from anywhere, through Mola Merkez (relay kind `admin`, server/merkez/remote-admin.ts).
 *   Açık mı   Ayarlar → Uzaktan erişim → "Uzaktan yönetim" (0.1.21), default off. Turning it on: only on a computer of the café (never
 *             remotely), with the owner's password and the 6-digit code (Raporlar için telefon kodu, which must be set up first).
 *             Turning it off works from anywhere and ends every remote session at once.
 *   Giriş     Every remote session: password, then code (0.1.24: two steps like the sign-in, a one-time 5-minute ticket
 *             between them; both at once still works), or, within 2 minutes of the device's own sign-in, the one-time `grant`
 *             that sign-in gave it: server/remote-reports.ts takeGrant), sealed by the paired device to this computer (only
 *             that device and this computer can make the key: packages/domain/remote-admin-crypto.ts). Wrong answers are counted per device
 *             (5 free, then 1 min, 2 min, 4 min … at most 15 min) and per business (20 in 15 min stops every device for 15 min).
 *             The owner gets a notification for each login; the list shows device, start and end (no address).
 *   Oturum    A real owner staff session (server/sessions.ts, `remote` = the remote session id): the same 05:00 end, the same
 *             idle lock (server/owner-lock.ts), it shows in Çalışanlar → Açık oturumlar as "Uzaktan · <cihaz>". Its token never
 *             leaves this process: each decrypted request is replayed on a loopback listener with the token and this
 *             process's secret marker (x-mola-remote), the answer is sealed for the device. The marker is checked in `gate`
 *             before every route, and a remote session's token is refused without it (server/app.ts staffActor).
 *   Yalnız kafede  Restoring a backup, the recovery code and every /api/desktop call, removing devices, setting up
 *             or resetting the phone code, turning remote management or Mola destek on, installing an update: 403
 *             REMOTE_FORBIDDEN with a plain message. Changing the owner password needs the current password and the code.
 *             Replayed requests carry a `forwarded` header, so "this computer only" checks (loopbackRequest) never pass.
 *   Biter     Logout, "Bütün uzak oturumları kapat", switching it off, removing the device, closing the staff session in
 *             Açık oturumlar, a password change, 05:00, or a restart of this server (keys live in memory only).
 */
type EndedBy = 'logout' | 'owner' | 'off' | 'device' | 'expired' | 'ended' | 'restart';
type Row = { id: string; phone: string; device: string; startedAt: string; endedAt?: string; endedBy?: EndedBy };
export type RemoteAdminRecord = { v: 1; on: boolean; since?: string; by?: string; sessions: Row[] };
type Tab = { top: number; seen: Set<number>; at: number };
type Live = { id: string; tenant: string; phone: string; device: string; ownerId: string; token: string; key: CryptoKey; startedAt: number; expires: number; tabs: Map<string, Tab>; parts: Map<string, { chunks: string[]; until: number }> };
/** The café app's staff sessions, as server/app.ts lends them (the token is made and kept on this computer). */
export type RemoteSessions = {
  open: (tenant: string, user: { id: string; role: Role; version: number }, device: string, remote: string) => string;
  end: (token: string) => void;
  alive: (token: string) => boolean;
  /** Removes every remote staff session (after a restart their keys are gone). */
  purge: () => void;
  /** The report code was just given: the reports open without asking it again (server/report-security.ts). */
  grantReports?: (tenant: string, userId: string, token: string, secret: string) => void;
};
const FRESH_MS = 5 * 60_000;
const WINDOW = 512;
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const MAX_ANSWER = 64 * 1024 * 1024;
/** Sealed answers above this many characters travel in parts (MOLA_REMOTE_PART_CHARS: tests use small parts). */
const partChars = () => Number(process.env.MOLA_REMOTE_PART_CHARS) || PART_CHARS;
const clock = (t: number | string) => new Date(t).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const ENDED: Record<EndedBy, string> = { logout: 'Çıkış yapıldı', owner: 'İşletme sahibi kapattı', off: 'Uzaktan yönetim kapatıldı', device: 'Cihazın eşleşmesi kaldırıldı', expired: 'İş günü bitti (05:00)', ended: 'Oturum kafede kapatıldı', restart: 'Kafe bilgisayarı yeniden başladı' };
export const REMOTE_ENDED = (why?: EndedBy) => new DomainError('REMOTE_ENDED', `Uzak oturum kapandı${why ? ` (${ENDED[why].toLocaleLowerCase('tr')})` : ''}. Yeniden giriş yapın.`, 401);

// ---------- What a remote session may not do ----------
const CAFE_ONLY_TEXT = 'Bu işlem yalnız kafedeki bilgisayardan yapılır: yedekten geri yükleme, kurtarma kodu ve masaüstü işlemleri uzaktan açılmaz.';
const MEDIA = /^\/media\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\/[a-f0-9-]{36}(-small)?\.webp$/;
const CAFE_ONLY: [string, RegExp, string, ((body: Record<string, unknown>) => boolean)?][] = [
  ['POST', /^\/api\/staff\/remote-reports\/phones\/remove$/, 'Cihaz kaldırmak yalnız kafede olur (Ayarlar → Uzaktan erişim).'],
  ['POST', /^\/api\/staff\/report-security\/(setup|enable|recover)$/, 'Telefon kodu yalnız kafedeki bilgisayardan kurulur ya da sıfırlanır.'],
  ['POST', /^\/api\/staff\/remote-admin$/, 'Uzaktan yönetim yalnız kafedeki bilgisayardan açılır. Buradan kapatabilirsiniz.', b => b.on === true],
  ['POST', /^\/api\/staff\/remote-support$/, 'Mola ekibine uzaktan destek izni yalnız kafedeki bilgisayardan verilir. Buradan kapatabilirsiniz.', b => b.on === true],
  ['POST', /^\/api\/staff\/update\/install$/, 'Güncelleme yalnız kafedeki bilgisayardan kurulur.'],
];
/** null: a remote owner session may make this request; otherwise the plain reason it may not. */
export function remoteRefusal(method: string, path: string, body: unknown): string | null {
  const m = method.toUpperCase(), b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const allowed = (m === 'GET' && /^\/api\/(health|contact)$/.test(path)) || (m === 'POST' && path === '/api/logout') || (['GET', 'POST'].includes(m) && path.startsWith('/api/staff/')) || (m === 'GET' && MEDIA.test(path));
  if (!allowed) return CAFE_ONLY_TEXT;
  for (const [method_, pattern, text, when] of CAFE_ONLY) if (method_ === m && pattern.test(path) && (!when || when(b))) return text;
  return null;
}

export class RemoteAdmin {
  private live = new Map<string, Live>();
  private nonces = new Map<string, number>();
  private fails = new Map<string, { count: number; until: number; blocked: number }>();
  private keys = new Map<string, Promise<CryptoKey>>();
  /** The second sign-in step's tickets (the password was right on this device a moment ago). */
  private tickets = new Map<string, { tenant: string; phone: string; ownerId: string; until: number; tries: number }>();
  /** This process's own secret: only requests replayed by `dispatch` carry it. */
  private secret = randomBytes(32).toString('base64url');
  private internal?: Promise<{ server: Server; port: number }>;
  private app?: Express; private timer?: NodeJS.Timeout;
  notifications?: () => Pick<Notifications, 'add'> | undefined;
  constructor(private store: Store, private link: MerkezLink, relay: RelayClient, private reports: () => RemoteReports, private now: () => Date, private sessions: RemoteSessions, private publicOrigin?: string) {
    store.db.exec('CREATE TABLE IF NOT EXISTS remote_admin (tenant TEXT PRIMARY KEY, payload BLOB NOT NULL)');
    // Session keys live in memory: whatever was open when this server stopped ended then, and its staff sessions go too.
    for (const { tenant } of store.db.prepare('SELECT tenant FROM remote_admin').all() as { tenant: string }[]) {
      try { if (this.read(tenant).sessions.some(s => !s.endedAt)) this.write(tenant, r => { for (const s of r.sessions) if (!s.endedAt) { s.endedAt = this.now().toISOString(); s.endedBy = 'restart'; this.link?.reportRemoteAdmin?.({ tenantId: tenant, session: s.id, event: 'end', at: s.endedAt, reason: 'restart' }); } }); } catch { /* a business without its key */ }
    }
    try { sessions.purge(); } catch { /* nothing to purge */ }
    relay.on('admin', r => this.handle(r as Extract<RelayRequest, { kind: 'admin' }>));
    this.timer = setInterval(() => { try { this.sweep(); } catch { /* store closed */ } }, 30_000); this.timer.unref();
  }
  close() { clearInterval(this.timer); void this.internal?.then(i => i.server.close()).catch(() => {}); }
  attach(app: Express) { this.app = app; }
  // ---------- The owner's record (sealed with the business key) ----------
  private key(tenant: string) { const k = snapshotKey(this.store.db, this.store.key, tenant); if (!k) throw new Error('İşletme anahtarı eksik.'); return k; }
  read(tenant: string): RemoteAdminRecord {
    const row = this.store.db.prepare('SELECT payload FROM remote_admin WHERE tenant=?').get(tenant) as { payload: Uint8Array } | undefined;
    return row ? open<RemoteAdminRecord>(Buffer.from(row.payload), this.key(tenant), `remote-admin:${tenant}`) : { v: 1, on: false, sessions: [] };
  }
  private write<T>(tenant: string, fn: (r: RemoteAdminRecord) => T): T {
    const r = this.read(tenant), result = fn(r); r.sessions = r.sessions.slice(-50);
    this.store.db.prepare('INSERT INTO remote_admin (tenant,payload) VALUES (?,?) ON CONFLICT(tenant) DO UPDATE SET payload=excluded.payload').run(tenant, seal(r, this.key(tenant), `remote-admin:${tenant}`));
    return result;
  }
  private audit(tenant: string, action: string, actor: string, target: string) { try { this.store.mutate(tenant, s => { s.audit.push({ action, actor, target, at: this.now().toISOString() }); }); } catch { /* the record has it */ } }
  private notify(tenant: string, key: string, title: string, text: string) { try { this.notifications?.()?.add(tenant, key, { kind: 'merkez', title, text }); } catch { /* the list has it */ } }
  setAccess(tenant: string, on: boolean, by: string, actor: string) {
    const changed = this.write(tenant, r => { if (r.on === on) return false; r.on = on; if (on) { r.since = this.now().toISOString(); r.by = by; } else { r.since = undefined; r.by = undefined; } return true; });
    if (!on) this.endAll(tenant, 'off');
    if (changed) this.audit(tenant, on ? 'remote_admin.on' : 'remote_admin.off', actor, tenant);
  }
  /** "Bütün uzak oturumları kapat" (and switching it off). */
  endAll(tenant: string, why: EndedBy = 'owner') { let n = 0; for (const l of [...this.live.values()]) if (l.tenant === tenant && this.end(l.id, why)) n++; return n; }
  end(id: string, why: EndedBy) {
    const l = this.live.get(id); if (!l) return false;
    this.live.delete(id);
    try { this.sessions.end(l.token); } catch { /* gone already */ }
    try { this.write(l.tenant, r => { const row = r.sessions.find(s => s.id === id); if (row && !row.endedAt) { row.endedAt = this.now().toISOString(); row.endedBy = why; } }); } catch { /* store closing */ }
    // Mola Merkez's İşlem kayıtları hears that it ended (time and reason only) with the next heartbeat.
    this.link?.reportRemoteAdmin?.({ tenantId: l.tenant, session: id, event: 'end', at: this.now().toISOString(), reason: why });
    return true;
  }
  /** Why a live session must end now, or undefined. */
  private stale(l: Live): EndedBy | undefined {
    if (this.now().getTime() >= l.expires) return 'expired';
    if (!this.sessions.alive(l.token)) return 'ended';
    try {
      if (!this.read(l.tenant).on) return 'off';
      if (!this.reports().read(l.tenant).phones.some(p => p.id === l.phone)) return 'device';
      if (!this.store.read(l.tenant).staffUsers?.some(u => u.id === l.ownerId && u.role === 'owner' && u.active)) return 'ended';
    } catch { return 'ended'; }
    return undefined;
  }
  sweep() {
    const t = this.now().getTime();
    for (const l of [...this.live.values()]) { const why = this.stale(l); if (why) this.end(l.id, why); else for (const [ref, p] of l.parts) if (p.until <= t) l.parts.delete(ref); }
    for (const [k, until] of this.nonces) if (until <= t) this.nonces.delete(k);
    for (const [k, v] of this.tickets) if (v.until <= t) this.tickets.delete(k);
    for (const [k, f] of this.fails) if (f.until <= t && f.blocked <= t) this.fails.delete(k);
  }
  /** Live remote sessions of a business (the owner's list; "current" marks the asking one). */
  active(tenant: string) { return [...this.live.values()].filter(l => l.tenant === tenant).map(l => ({ id: l.id, device: l.device, startedAt: new Date(l.startedAt).toISOString() })); }
  view(tenant: string, current?: string) {
    const r = this.read(tenant), s = this.store.read(tenant), phones = this.reports().read(tenant).phones;
    const owners = (s.staffUsers ?? []).filter(u => u.role === 'owner' && u.active);
    return { on: r.on, since: r.since ?? null, by: r.by ?? null, code: owners.some(u => !!u.mfa), activated: this.activated(), devices: phones.map(p => p.name),
      active: this.active(tenant).map(a => ({ ...a, current: a.id === current })), sessions: [...r.sessions].reverse().slice(0, 20).map(x => ({ ...x, endedText: x.endedBy ? ENDED[x.endedBy] : null })), remote: !!current };
  }
  activated() { try { return this.link.relayReady(); } catch { return false; } }

  // ---------- The köprü ----------
  private async handle(r: Extract<RelayRequest, { kind: 'admin' }>): Promise<RelayReply> {
    const q = r.request as AdminRequest;
    if (q.op === 'open') return this.open(r.tenantId, r.phoneId, q);
    if (q.op === 'call') return this.call(r.tenantId, r.phoneId, q);
    return this.part(r.tenantId, r.phoneId, q);
  }
  private phone(tenant: string, phoneId: string) {
    const p = this.reports().read(tenant).phones.find(x => x.id === phoneId);
    const owner = p && this.store.read(tenant).staffUsers?.find(u => u.id === p.ownerId && u.role === 'owner' && u.active);
    if (!p || !owner) throw new DomainError('PHONE_REVOKED', 'Bu cihazın bağlantısı kaldırıldı. Kafemi yönet’e yeniden giriş yapın.', 403);
    return { p, owner };
  }
  private cafeKey(tenant: string) {
    const k = this.reports().read(tenant).key; if (!k) throw new DomainError('PHONE_REVOKED', 'Bu cihaz eşleşmemiş.', 403);
    const id = `${tenant}:${k.privateKey.slice(-16)}`;
    if (!this.keys.has(id)) this.keys.set(id, cafePrivateKey(k.privateKey));
    return this.keys.get(id)!;
  }
  /** Wrong answers per device (5 free, then 1, 2, 4 … minutes, at most 15) and per business (20 in 15 min: 15 min for all). */
  private waitFor(tenant: string, phone: string, t: number) {
    const mine = this.fails.get(`${tenant}:${phone}`), all = this.fails.get(tenant);
    const until = Math.max(mine?.blocked ?? 0, all?.blocked ?? 0);
    return until > t ? Math.ceil((until - t) / 1000) : 0;
  }
  private failed(tenant: string, phone: string, t: number) {
    for (const [key, free, block] of [[`${tenant}:${phone}`, 5, 0], [tenant, 20, 15 * 60_000]] as const) {
      const f = this.fails.get(key) ?? { count: 0, until: 0, blocked: 0 };
      if (f.until <= t) { f.count = 0; f.until = t + 15 * 60_000; }
      f.count++;
      if (f.count >= free) f.blocked = t + (block || Math.min(15 * 60_000, 60_000 * 2 ** (f.count - free)));
      this.fails.set(key, f);
    }
  }
  private async open(tenant: string, phoneId: string, q: Extract<AdminRequest, { op: 'open' }>): Promise<RelayReply> {
    const { p } = this.phone(tenant, phoneId), t = this.now().getTime();
    if (q.phone !== p.id) throw new DomainError('REQUEST_INVALID', 'İstek doğrulanamadı.', 403);
    if (Math.abs(q.at - t) > FRESH_MS) throw new DomainError('REQUEST_STALE', 'Cihazın saati kafe bilgisayarından çok farklı. Saati otomatik yapın.', 403);
    for (const [k, until] of this.nonces) if (until <= t) this.nonces.delete(k);
    if (this.nonces.has(`${p.id}:${q.nonce}`)) throw new DomainError('REPLAY', 'Bu istek daha önce kullanıldı.', 403);
    const opened = await readAdminOpen(await this.cafeKey(tenant), p.pub, q);
    if (!opened) throw new DomainError('REQUEST_INVALID', 'İstek doğrulanamadı.', 403);
    this.nonces.set(`${p.id}:${q.nonce}`, t + 2 * FRESH_MS);
    const answer = async (a: AdminOpenAnswer): Promise<RelayReply> => ({ status: 200, json: await sealOpenAnswer(opened.k1, q.nonce, a) });
    const fail = (code: string, message: string, ticket?: string) => answer({ ok: false, code, message, ...(ticket ? { ticket } : {}) });
    const wait = this.waitFor(tenant, p.id, t);
    if (wait) return fail('RATE_LIMIT', `Çok fazla hatalı deneme. ${wait < 60 ? `${wait} saniye` : `${Math.ceil(wait / 60)} dakika`} sonra yeniden deneyin.`);
    const { owner } = this.phone(tenant, phoneId);
    // Hizmet paketi: no "Uzaktan yönetim" in the package (the owner's switch and history stay as they were).
    if (!this.link.has(tenant, 'remote-admin')) return fail(FEATURE_NOT_IN_PACKAGE, notInPackage('remote-admin'));
    if (!this.read(tenant).on) return fail('REMOTE_OFF', 'Uzaktan yönetim kapalı. Kafedeyken Ayarlar → Uzaktan erişim → Uzaktan yönetim’den açabilirsiniz.');
    if (!owner.mfa) return fail('REMOTE_NEEDS_CODE', 'Önce kafede Ayarlar → Uzaktan erişim’den telefon kodunu kurun. Uzaktan yönetim şifre ve telefon koduyla açılır.');
    const { password, grant, ticket } = opened.credentials, code = opened.credentials.code.replace(/\D/g, '');
    const wrong = (code_: string, message: string, keep?: string) => { this.failed(tenant, p.id, t); this.audit(tenant, 'remote_admin.login_failed', owner.id, p.id); return fail(code_, message, keep); };
    // The code is spent only after the right password (a wrong password does not burn the owner's current code).
    const codeOk = () => this.store.mutate(tenant, s => { const u = s.staffUsers!.find(x => x.id === owner.id); const step = u?.mfa ? verifyTotp(u.mfa.secret, code, t, u.mfa.lastStep) : null; if (step === null) return false; u!.mfa!.lastStep = step; return true; });
    for (const [k, v] of this.tickets) if (v.until <= t) this.tickets.delete(k);
    if (grant) {
      // Right after the sign-in (0.1.23): its one-time grant stands for the password and the code just given on this device.
      if (this.reports().takeGrant(tenant, p.id, grant)?.ownerId !== owner.id) return wrong('GRANT_EXPIRED', 'Giriş süresi doldu. Şifrenizi ve telefon kodunu yazın.');
    } else if (ticket) {
      // Step 2 (0.1.24): the code for the password given a moment ago on this device; a wrong code keeps the ticket (5 tries).
      const held = this.tickets.get(ticket);
      if (!held || held.tenant !== tenant || held.phone !== p.id || held.ownerId !== owner.id) { this.tickets.delete(ticket); return fail('LOGIN_EXPIRED', 'Süre doldu. Şifrenizi yeniden yazın.'); }
      if (!codeOk()) {
        if (++held.tries >= 5) { this.tickets.delete(ticket); return wrong('CODE_WRONG', 'Telefon kodu yanlış. Şifrenizi yeniden yazın.'); }
        return wrong('CODE_WRONG', 'Telefon kodu yanlış. Doğrulama uygulamasındaki güncel kodu yazın.', ticket);
      }
      this.tickets.delete(ticket);
    } else {
      if (!await passwordMatches(password, owner)) return wrong('INVALID_LOGIN', code ? 'Şifre ya da telefon kodu yanlış. Doğrulama uygulamasındaki güncel kodu yazın.' : 'Şifre yanlış.');
      // Step 1 (0.1.24): the password alone; the code comes on the next screen with this one-time ticket (5 minutes).
      if (!code) { const next = randomB64u(16); this.tickets.set(next, { tenant, phone: p.id, ownerId: owner.id, until: t + RELAY.LOGIN_TICKET_MS, tries: 0 }); return fail('NEED_CODE', 'Telefon kodunu yazın.', next); }
      if (!codeOk()) return wrong('INVALID_LOGIN', 'Şifre ya da telefon kodu yanlış. Doğrulama uygulamasındaki güncel kodu yazın.');
    }
    this.fails.delete(`${tenant}:${p.id}`);
    const fresh = this.store.read(tenant), user = fresh.staffUsers!.find(x => x.id === owner.id)!;
    const sid = randomUUID(), session = await cafeSession(opened.k1, q.eph, sid), device = p.name;
    const token = this.sessions.open(tenant, user, `Uzaktan · ${device}`, sid);
    const expires = businessDayEnd(t);
    this.live.set(sid, { id: sid, tenant, phone: p.id, device, ownerId: user.id, token, key: session.key, startedAt: t, expires, tabs: new Map(), parts: new Map() });
    this.write(tenant, r => { r.sessions.push({ id: sid, phone: p.id, device, startedAt: new Date(t).toISOString() }); });
    this.audit(tenant, 'remote_admin.login', user.id, p.id);
    this.link?.reportRemoteAdmin?.({ tenantId: tenant, session: sid, event: 'start', at: new Date(t).toISOString() });
    this.notify(tenant, `remote-admin:${sid}`, 'Uzaktan yönetim girişi', `${device} ile ${clock(t)}'de kafeye uzaktan girildi. Siz değilseniz Ayarlar → Uzaktan erişim → Uzaktan yönetim → “Bütün uzak oturumları kapat”a basın ve şifrenizi değiştirin.`);
    if (user.mfa) try { this.sessions.grantReports?.(tenant, user.id, token, user.mfa.secret); } catch { /* the reports ask the code */ }
    return answer({ ok: true, sid, eph: session.eph, business: fresh.name, expiresAt: new Date(expires).toISOString(), device });
  }
  /** The live session of a sealed request; ends it here when it must not go on. */
  private session(tenant: string, phoneId: string, sid: string) {
    const l = this.live.get(sid);
    if (!l || l.tenant !== tenant || l.phone !== phoneId) throw REMOTE_ENDED();
    const why = this.stale(l); if (why) { this.end(l.id, why); throw REMOTE_ENDED(why); }
    return l;
  }
  private async call(tenant: string, phoneId: string, q: Extract<AdminRequest, { op: 'call' }>): Promise<RelayReply> {
    const l = this.session(tenant, phoneId, q.sid), t = this.now().getTime();
    if (Math.abs(q.at - t) > FRESH_MS) throw new DomainError('REQUEST_STALE', 'Cihazın saati kafe bilgisayarından çok farklı. Saati otomatik yapın.', 403);
    // Sequence numbers per browser tab: one seen before, or one far behind, is a replay.
    let tab = l.tabs.get(q.tab);
    if (tab && (tab.seen.has(q.seq) || q.seq <= tab.top - WINDOW)) throw new DomainError('REPLAY', 'Bu istek daha önce kullanıldı.', 403);
    if (!tab && l.tabs.size >= 50) { for (const [k, v] of l.tabs) if (t - v.at > 2 * FRESH_MS) l.tabs.delete(k); if (l.tabs.size >= 50) throw new DomainError('TOO_MANY_TABS', 'Çok fazla açık sekme. Birkaçını kapatıp yeniden deneyin.', 429); }
    const request = await openCall(l.key, q);
    if (!request) throw new DomainError('REQUEST_INVALID', 'İstek doğrulanamadı.', 403);
    // Counted only once it opened: a forged request cannot use up the device's numbers.
    tab = l.tabs.get(q.tab) ?? { top: 0, seen: new Set(), at: t };
    tab.seen.add(q.seq); tab.top = Math.max(tab.top, q.seq); tab.at = t; l.tabs.set(q.tab, tab);
    if (tab.seen.size > 2 * WINDOW) for (const s of tab.seen) if (s <= tab.top - WINDOW) tab.seen.delete(s);
    const response = await this.dispatch(l, request);
    const box = await sealReply(l.key, q, response);
    const part = partChars();
    if (box.ct.length <= part) return { status: 200, json: box satisfies AdminAnswer };
    // A large file (Excel, PDF): the sealed answer in parts, each within the köprü's reply limit.
    const chunks: string[] = []; for (let i = 0; i < box.ct.length; i += part) chunks.push(box.ct.slice(i, i + part));
    const ref = randomB64u(16); l.parts.set(ref, { chunks, until: t + 2 * 60_000 });
    return { status: 200, json: { iv: box.iv, ct: chunks[0], parts: chunks.length, ref } satisfies AdminAnswer };
  }
  private async part(tenant: string, phoneId: string, q: Extract<AdminRequest, { op: 'part' }>): Promise<RelayReply> {
    const l = this.session(tenant, phoneId, q.sid), p = l.parts.get(q.ref);
    if (!p || p.until <= this.now().getTime() || q.index >= p.chunks.length) throw new DomainError('NOT_FOUND', 'Dosyanın süresi doldu. Yeniden indirin.', 404);
    if (q.index === p.chunks.length - 1) l.parts.delete(q.ref);
    return { status: 200, json: { part: p.chunks[q.index] } };
  }
  // ---------- Replaying a decrypted request on this app ----------
  private listen() {
    return this.internal ??= new Promise((done, fail) => {
      const server = createServer(this.app!); server.unref(); server.once('error', fail);
      server.listen(0, '127.0.0.1', () => done({ server, port: (server.address() as AddressInfo).port }));
    });
  }
  private async dispatch(l: Live, r: TunnelRequest): Promise<TunnelResponse> {
    if (!r || !['GET', 'POST'].includes(r.m) || typeof r.p !== 'string' || !/^\/[\x21-\x7e]*$/.test(r.p) || r.p.length > 2000 || (r.b !== undefined && typeof r.b !== 'string')) return { s: 400, h: { 'content-type': 'application/json' }, b: Buffer.from(JSON.stringify({ code: 'INVALID', message: 'Geçersiz istek.' })).toString('base64url') };
    const { port } = await this.listen();
    const body = r.b !== undefined && r.m === 'POST' ? Buffer.from(r.b, 'utf8') : undefined;
    // `forwarded`: never "this computer" (loopbackRequest), whatever the socket says.
    const headers: Record<string, string> = { 'x-mola-remote': `${this.secret}.${l.id}`, cookie: `mola_staff=${l.token}`, forwarded: 'for="_mola-uzak"' };
    for (const h of ['accept', 'content-type', 'x-mola-tag', 'x-mola-activity']) { const v = r.h?.[h]; if (typeof v === 'string' && v.length <= 200) headers[h] = v; }
    if (body) headers['content-length'] = String(body.length);
    if (this.publicOrigin) { headers.host = new URL(this.publicOrigin).host; headers['x-forwarded-proto'] = 'https'; if (r.m !== 'GET') headers.origin = this.publicOrigin; }
    return new Promise<TunnelResponse>((done, fail) => {
      const req = httpRequest({ host: '127.0.0.1', port, method: r.m, path: r.p, headers, timeout: RELAY.REQUEST_TIMEOUT_MS - 2000 }, res => {
        const parts: Buffer[] = []; let size = 0;
        res.on('data', (c: Buffer) => { size += c.length; if (size > MAX_ANSWER) { req.destroy(); fail(new DomainError('TOO_LARGE', 'Yanıt uzaktan gönderilemeyecek kadar büyük.', 502)); return; } parts.push(c); });
        res.on('end', () => {
          const data = Buffer.concat(parts), h: Record<string, string> = {};
          for (const name of ['content-type', 'content-disposition', 'x-mola-tag', 'x-mola-locked', 'cache-control']) { const v = res.headers[name]; if (typeof v === 'string') h[name] = v.slice(0, 300); }
          done({ s: res.statusCode ?? 500, h, ...(data.length ? { b: data.toString('base64url') } : {}) });
        });
        res.on('error', fail);
      });
      req.on('timeout', () => req.destroy(new DomainError('TIMEOUT', 'Kafe bilgisayarı yanıt vermedi.', 504)));
      req.on('error', fail);
      req.end(body);
    });
  }
  /** The remote session of a marked request (only `gate` sets it). */
  sessionOf(req: Request): { id: string; tenant: string; phone: string } | undefined { return req.res?.locals.remoteAdmin; }
  /**
   * Registered before every route of the café app (server/app.ts, right after the Mola destek gate): a request with the
   * remote marker is a remote owner request, and only then. The marker must come from this process over loopback, for a
   * live session; café-only actions are refused here, before any route.
   */
  gate() {
    return (req: Request, res: Response, next: NextFunction) => {
      const marker = req.headers['x-mola-remote'];
      if (marker === undefined) return next();
      const [secret, sid] = String(marker).split('.'), expected = Buffer.from(this.secret), given = Buffer.from(secret ?? '');
      const mine = LOOPBACK.includes(req.socket.remoteAddress ?? '') && given.length === expected.length && timingSafeEqual(given, expected);
      if (!mine) return next(new DomainError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403));
      const l = this.live.get(sid ?? '');
      if (!l) return next(REMOTE_ENDED());
      res.locals.remoteAdmin = { id: l.id, tenant: l.tenant, phone: l.phone };
      const refused = remoteRefusal(req.method, req.path, req.body);
      if (refused) return next(new DomainError('REMOTE_FORBIDDEN', refused, 403));
      if (req.method === 'POST' && req.path === '/api/logout') { this.end(l.id, 'logout'); res.json({ ok: true }); return; }
      // The owner's own password, remotely: the current password (the route checks it) and the 6-digit code (here).
      if (req.method === 'POST' && req.path === '/api/staff/password') {
        const code = String((req.body as { code?: unknown } | undefined)?.code ?? '').replace(/\D/g, '');
        const ok = code.length === 6 && this.store.mutate(l.tenant, s => { const u = s.staffUsers?.find(x => x.id === l.ownerId); const step = u?.mfa ? verifyTotp(u.mfa.secret, code, this.now().getTime(), u.mfa.lastStep) : null; if (step === null) return false; u!.mfa!.lastStep = step; return true; });
        if (!ok) { this.failed(l.tenant, l.phone, this.now().getTime()); return next(new DomainError('CODE_REQUIRED', 'Uzaktan şifre değiştirmek için doğrulama uygulamanızdaki güncel 6 haneli kodu da yazın.', 403)); }
      }
      next();
    };
  }
}

/**
 * Owner routes (Ayarlar → Uzaktan erişim → Uzaktan yönetim; the owner's own account): GET /api/staff/remote-admin,
 * POST /api/staff/remote-admin { on, password, code } (on: only at the café, password + code; off: anywhere, nothing asked),
 * POST /api/staff/remote-admin/end-all ("Bütün uzak oturumları kapat").
 */
export function remoteAdminRoutes(app: Express, store: Store, admin: RemoteAdmin, actorFor: (req: Request) => Actor, confirmPassword: (req: Request, actor: Actor, password: string | undefined) => Promise<void>, now: () => Date = () => new Date()) {
  const owner = (req: Request) => { const a = actorFor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner']); return { a, s }; };
  const tries = new Map<string, { count: number; until: number }>();
  app.get('/api/staff/remote-admin', (req, res) => { const { a } = owner(req); res.setHeader('Cache-Control', 'no-store'); res.json(admin.view(a.tenantId, admin.sessionOf(req)?.id)); });
  app.post('/api/staff/remote-admin', async (req, res) => {
    let { a, s } = owner(req);
    const b = z.object({ on: z.boolean(), password: z.string().max(200).optional(), code: z.string().max(12).optional() }).strict().parse(req.body);
    const name = s.staffUsers?.find(u => u.id === a.id)?.name ?? 'İşletme sahibi';
    if (b.on) {
      // (A remote session never gets here: server/remote-admin.ts gate refuses turning it on remotely.)
      if (!admin.activated()) throw new DomainError('NOT_ACTIVATED', 'Mola bu bilgisayarda henüz etkinleştirilmedi.', 409);
      if (!s.staffUsers?.find(u => u.id === a.id)?.mfa) throw new DomainError('REMOTE_NEEDS_CODE', 'Önce telefon kodunu kurun: Ayarlar → Uzaktan erişim → 1. adım.', 409);
      const t = now().getTime(), k =`${a.tenantId}:${a.id}`, c = tries.get(k);
      if (c && c.until > t && c.count >= 5) throw new DomainError('RATE_LIMIT', 'Bir dakika sonra tekrar deneyin.', 429);
      await confirmPassword(req, a, b.password);
      ({ a, s } = owner(req));
      const code = (b.code ?? '').replace(/\D/g, '');
      const ok = code.length === 6 && store.mutate(a.tenantId, x => { const u = x.staffUsers?.find(v => v.id === a.id); const step = u?.mfa ? verifyTotp(u.mfa.secret, code, t, u.mfa.lastStep) : null; if (step === null) return false; u!.mfa!.lastStep = step; return true; });
      if (!ok) { const e = c && c.until > t ? c : { count: 0, until: t + 60_000 }; e.count++; tries.set(k, e); throw new DomainError('CODE_WRONG', 'Telefon kodu yanlış ya da süresi geçti. Doğrulama uygulamasındaki yeni kodu yazın.', 403); }
      tries.delete(k);
    }
    admin.setAccess(a.tenantId, b.on, name, a.id);
    res.json(admin.view(a.tenantId, admin.sessionOf(req)?.id));
  });
  app.post('/api/staff/remote-admin/end-all', (req, res) => {
    const { a } = owner(req), current = admin.sessionOf(req)?.id;
    const n = admin.endAll(a.tenantId, 'owner');
    store.mutate(a.tenantId, x => { x.audit.push({ action: 'remote_admin.ended_all', actor: a.id, target: String(n), at: now().toISOString() }); });
    res.json({ ...admin.view(a.tenantId, current), ended: n });
  });
}
