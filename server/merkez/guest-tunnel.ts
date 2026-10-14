import type { Express, NextFunction, Request, Response } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { join } from 'node:path';
import { DomainError } from '../../packages/domain/engine.js';
import { ExpiringStore } from '../expiring-store.js';
import { clientKey, hostAllowed } from '../http-security.js';
import { CLOCK_WINDOW_MS, HEADER, requestSignature, responseSignature, sameSignature } from '../install-auth.js';
import { licenseSummary } from '../license.js';
import type { SyncRequest, SyncResponse } from '../sync-protocol.js';
import { ASSET_NAME, ASSET_TYPES, connectionKey, MENU_CODE, pack, requestMac, sha256, TABLE_TOKEN, TUNNEL, TUNNEL_ACCEPTED, TUNNEL_PATH, unpack, type TunnelAnswer, type TunnelHello, type TunnelRequest, type TunnelStatus } from '../tunnel-protocol.js';
import { mirrorSnapshot } from '../../packages/domain/menu-mirror.js';
import { QR_OFFLINE_TEXT } from '../../packages/domain/qr-ordering.js';
import { tableHash } from '../menu-mirror.js';
import type { MenuMirrorStore } from './menu-mirror.js';
import { WsSocket, wsAccept } from '../ws-frames.js';
import { noticePage } from './notice-page.js';
import { newSocialCode, takenCodes } from './social.js';
import { licenseFeatures, type MerkezBusiness, type MerkezData, type MerkezStore } from './store.js';

/*
 * İnternetten menü, Mola Merkez's end (protocol: server/tunnel-protocol.ts). A guest scans the table QR anywhere (mobile data,
 * any Wi-Fi) and lands on `<menü adresi>/q/<kod>/<masa kodu>` (MERKEZ_MENU_ORIGIN, its own name: server/merkez/menu-host.ts;
 * older setups: the web site's or Merkez's address). Merkez:
 *   - knows each business's menu code (10 random characters, given once with the heartbeat to a café that asks: `tunnel`;
 *     never changed, so printed QR codes keep working; one code says nothing about another);
 *   - decides first, without asking the café, whether the menu may open: the same rule as the café's guest menu (licence
 *     active: not suspended, frozen or ended, trial started; café heard from within 14 days) and "QR menü" in the licence's
 *     services. Otherwise the plain "Bu işletmenin dijital menüsü şu anda kullanılamıyor." page (the API answers 403
 *     MENU_UNAVAILABLE, as the café would);
 *   - lets through only the guest's paths (ALLOWED below; everything else is 404 here and never reaches the café, which refuses
 *     it again on its side): the page, the page's own files (only those the café listed in its hello), /api/guest/*, the
 *     business's /media photos;
 *   - passes them to the café's open tunnel with the guest's address (per-guest limits at the café) and returns the answer;
 *     the guest cookie (`mola_browser`) is scoped to `/q/<kod>/`. Café computer off or tunnel down: "Menü şu anda
 *     açılamıyor. Lütfen garsonunuza sorun." (the page tries again by itself).
 *   - serves the page and its files without the café when it can: a file is content-addressed by the SHA-256 the café sent,
 *     from Merkez's own build (same name, same SHA-256) or its memory; product photos are kept a few minutes (MEDIA_MS).
 * Nothing of a guest's traffic is stored or logged (this is not under /api: not even the request log sees it). Per café only
 * counters stay in memory: requests, errors, timeouts, the last error time.
 */
const DAY = 86400000, OFFLINE_DAYS = 14;
/** Product photos kept in memory per café for this long (a deleted photo can show this much longer), and the caps. */
const MEDIA_MS = 10 * 60_000, MEDIA_TOTAL = 64 * 1024 * 1024, MEDIA_PER_CAFE = 16 * 1024 * 1024, FILES_TOTAL = 48 * 1024 * 1024;
const UNAVAILABLE = 'Bu işletmenin dijital menüsü şu anda kullanılamıyor. Lütfen personelle görüşün.';
const OFFLINE = 'Menü şu anda açılamıyor. Lütfen garsonunuza sorun.';
const OFFLINE_EN = 'The menu can’t be opened right now. Please ask your waiter.';

// ---------- The heartbeat part: menu codes ----------
/** The heartbeat's `tunnel` part: every business of this café gets its menu code once; the answer for the café. */
export function recordTunnel(d: MerkezData, mine: MerkezBusiness[], sent: SyncRequest['tunnel'], time: string, publicOrigin?: string): SyncResponse['tunnel'] | undefined {
  if (!sent) return undefined;
  const taken = takenCodes(d);
  const codes: { tenantId: string; code: string }[] = [];
  for (const biz of mine) {
    if (!biz.menu) { const code = newSocialCode(taken); taken.add(code); biz.menu = { code, since: time }; }
    codes.push({ tenantId: biz.tenantId, code: biz.menu.code });
  }
  return { ...(publicOrigin ? { base: publicOrigin } : {}), codes };
}
/** The guest menu may open now: the café's own rule (server/kafe-link.ts active + 'qr-menu'), decided here without the café. */
export function menuOpen(b: MerkezBusiness, d: MerkezData, now: Date) {
  if (!b.installId || !licenseSummary(b, now).active || !licenseFeatures(b).includes('qr-menu')) return false;
  const seen = d.installs.find(i => i.id === b.installId)?.lastSeenAt;
  return !!seen && now.getTime() - Date.parse(seen) < OFFLINE_DAYS * DAY;
}

// ---------- The cafés' connections ----------
type Stream = { done: (a: Answer) => void; fail: (e: DomainError) => void; timer: NodeJS.Timeout; head?: TunnelAnswer; parts: Buffer[]; size: number };
type Connection = { install: string; ws: WsSocket; key: Buffer; hello?: TunnelHello; status?: TunnelStatus['tenants']; streams: Map<number, Stream>; next: number; active: number; waiting: (() => void)[]; heardAt: number; connectedAt: number; ping?: NodeJS.Timeout };
export type Answer = { status: number; headers: Record<string, string>; body: Buffer };
type Counters = { requests: number; errors: number; timeouts: number; refused: number; lastErrorAt?: string; connectedAt?: string; disconnectedAt?: string; app?: string };
export type HubOptions = { publicOrigin?: string; trustLocalProxy?: boolean; buildDirectory?: string; mirror?: MenuMirrorStore };
const offline = () => new DomainError('CAFE_OFFLINE', OFFLINE, 503);

export class GuestTunnelHub {
  private connections = new Map<string, Connection>();
  private counters = new Map<string, Counters>();
  private limits = new ExpiringStore<{ count: number; until: number }>(v => v.until, () => this.now().getTime(), 20000, true);
  /** Built files by SHA-256 (any café's, they are the same program files) and product photos per café (`install path`). */
  private files = new Map<string, Buffer>(); private filesSize = 0;
  private media = new Map<string, { body: Buffer; etag: string; type: string; until: number; install: string }>(); private mediaSize = 0;
  private own = new Map<string, string | null>();
  constructor(private store: MerkezStore, private now: () => Date, private options: HubOptions = {}) {}
  close() { for (const c of [...this.connections.values()]) this.drop(c, 1001); }
  online(install: string) { const c = this.connections.get(install); return !!c?.hello && !c.ws.closed; }
  helloOf(install: string) { return this.connections.get(install)?.hello; }
  /** QR siparişleri of one business as its café last said (connected cafés only; undefined: not told, an older café). */
  orderingOf(install: string, tenant: string) { const c = this.connections.get(install); return c?.hello && !c.ws.closed ? c.status?.[tenant] : undefined; }
  get mirror() { return this.options.mirror; }
  view(install: string) { const c = this.connections.get(install), n = this.counters.get(install); return { online: this.online(install), ...(c ? { connectedAt: new Date(c.connectedAt).toISOString(), inFlight: c.active, waiting: c.waiting.length } : {}), ...(n ?? { requests: 0, errors: 0, timeouts: 0, refused: 0 }) }; }
  private count(install: string, what: 'requests' | 'errors' | 'timeouts' | 'refused') {
    let n = this.counters.get(install); if (!n) { n = { requests: 0, errors: 0, timeouts: 0, refused: 0 }; this.counters.set(install, n); }
    n[what]++; if (what !== 'requests') n.lastErrorAt = this.now().toISOString();
  }
  private take(key: string, max: number, ms: number) {
    const t = this.now().getTime(); let l = this.limits.get(key);
    if (!l || l.until <= t) { l = { count: 0, until: t + ms }; this.limits.set(key, l); }
    return ++l.count <= max;
  }
  /** Behind the same computer's TLS proxy (PUBLIC_ORIGIN + TRUST_LOCAL_PROXY) the connection must have come over HTTPS. */
  private secure(req: IncomingMessage) {
    if (!this.options.publicOrigin) return true;
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    return !!this.options.trustLocalProxy && loopback && String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
  }
  private address(req: IncomingMessage) {
    const forwarded = this.options.trustLocalProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') ? String(req.headers['x-forwarded-for'] ?? '').split(',').pop()?.trim() : '';
    return clientKey({ ip: forwarded || req.socket.remoteAddress, socket: req.socket } as unknown as Request);
  }
  /** `server.on('upgrade')`: a café opening its tunnel. Anything else, or a wrong signature, is answered and closed. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const refuse = (status: number, code: string, message: string) => {
      const body = JSON.stringify({ code, message });
      try { socket.end(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 429 ? 'Too Many Requests' : status === 404 ? 'Not Found' : 'Forbidden'}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nX-Mola-Server-Time: ${this.now().toISOString()}\r\nConnection: close\r\n\r\n${body}`); } catch { /* gone */ }
      socket.destroy();
    };
    socket.on('error', () => socket.destroy());
    const url = (req.url ?? '').split('?')[0];
    if (url !== TUNNEL_PATH || req.method !== 'GET' || String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13' || !/^[A-Za-z0-9+/]{22}==$/.test(String(req.headers['sec-websocket-key'] ?? ''))) return refuse(404, 'NOT_FOUND', 'Bulunamadı.');
    if (!hostAllowed(req.headers.host, this.options.publicOrigin)) return refuse(403, 'HOST_REJECTED', 'Bu adres bu sunucuya ait değil.');
    if (!this.secure(req)) return refuse(403, 'HTTPS_REQUIRED', 'Güvenli bağlantı gerekli.');
    if (!this.take(`connect:${this.address(req)}`, 60, 60_000)) return refuse(429, 'RATE_LIMIT', 'Çok sık deneme.');
    const header = (name: string) => String(req.headers[name] ?? '');
    const installId = header(HEADER.install), time = header(HEADER.time), nonce = header(HEADER.nonce), signature = header(HEADER.signature);
    if (!/^[a-f0-9-]{36}$/.test(installId) || !/^\d{10,16}$/.test(time) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return refuse(401, 'INSTALL_AUTH', 'Kurulum kimliği doğrulanamadı.');
    const d = this.store.read(), install = d.installs.find(i => i.id === installId && !i.revokedAt);
    if (!install || !sameSignature(requestSignature(install.secret, 'GET', TUNNEL_PATH, time, nonce, ''), signature)) return refuse(401, 'INSTALL_AUTH', 'Kurulum kimliği doğrulanamadı.');
    if (Math.abs(Number(time) - this.now().getTime()) > CLOCK_WINDOW_MS) return refuse(401, 'CLOCK_SKEW', 'Bilgisayarın saati Mola Merkez saatinden çok farklı.');
    if (!this.store.useNonce(installId, nonce, this.now().getTime())) return refuse(401, 'REPLAY', 'Bu istek daha önce kullanıldı.');
    if (!this.take(`connect-install:${installId}`, 30, 60_000)) return refuse(429, 'RATE_LIMIT', 'Çok sık deneme.');
    if (!d.businesses.some(b => b.installId === installId)) return refuse(403, 'RECORD_CLOSED', 'Bu kurulumun işletmesi yok.');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsAccept(header('sec-websocket-key'))}\r\n${HEADER.signature}: ${responseSignature(install.secret, nonce, TUNNEL_ACCEPTED)}\r\nX-Mola-Server-Time: ${this.now().toISOString()}\r\n\r\n`);
    const ws = new WsSocket(socket, 'server', TUNNEL.MAX_MESSAGE, head), t = Date.now();
    const c: Connection = { install: installId, ws, key: connectionKey(install.secret, nonce), streams: new Map(), next: 0, active: 0, waiting: [], heardAt: t, connectedAt: t };
    // A café that connects again (a restart, a network change) replaces its old connection.
    const old = this.connections.get(installId); if (old) this.drop(old, 4000);
    this.connections.set(installId, c);
    const n = this.counters.get(installId) ?? { requests: 0, errors: 0, timeouts: 0, refused: 0 }; n.connectedAt = this.now().toISOString(); this.counters.set(installId, n);
    const helloTimer = setTimeout(() => { if (!c.hello) this.drop(c, 1008); }, TUNNEL.HELLO_MS); helloTimer.unref();
    c.ping = setInterval(() => {
      if (Date.now() - c.heardAt > TUNNEL.SILENT_MS) { this.drop(c, 1006); return; }
      c.ws.ping();
    }, TUNNEL.PING_MS); c.ping.unref();
    ws.on('pong', () => { c.heardAt = Date.now(); });
    ws.on('message', (m: Buffer) => { c.heardAt = Date.now(); this.message(c, m); });
    ws.on('close', () => { clearTimeout(helloTimer); this.gone(c); });
  }
  private drop(c: Connection, code: number) { c.ws.close(code); c.ws.socket.destroy(); this.gone(c); }
  private gone(c: Connection) {
    clearInterval(c.ping);
    if (this.connections.get(c.install) === c) { this.connections.delete(c.install); const n = this.counters.get(c.install); if (n) n.disconnectedAt = this.now().toISOString(); }
    for (const [id, s] of [...c.streams]) { c.streams.delete(id); clearTimeout(s.timer); s.fail(offline()); }
    for (const w of c.waiting.splice(0)) w();
  }
  private message(c: Connection, message: Buffer) {
    let m: ReturnType<typeof unpack>;
    try { m = unpack(message); } catch { this.drop(c, 1002); return; }
    const head = m.head;
    if (head.t === 'hello') {
      const assets = head.assets && typeof head.assets === 'object' ? Object.entries(head.assets).slice(0, 300).filter(([name, sha]) => ASSET_NAME.test(name) && /^[a-f0-9]{64}$/.test(String(sha))) : [];
      c.hello = { t: 'hello', v: 1, app: String(head.app ?? '').slice(0, 40), ...(typeof head.page === 'string' && /^[a-f0-9]{64}$/.test(head.page) ? { page: head.page } : {}), assets: Object.fromEntries(assets) as Record<string, string> };
      const n = this.counters.get(c.install); if (n) n.app = c.hello.app;
      return;
    }
    if (head.t === 'status') {
      // QR siparişleri per business (8 Ekim): kept with the connection only (gone with it: then ordering counts as closed).
      // A socket event: Merkez's store may be closing (shutdown, tests), so a failed read just drops this message.
      let mine: Set<string>; try { mine = new Set(this.store.read().businesses.filter(b => b.installId === c.install).map(b => b.tenantId)); } catch { return; }
      const tenants = head.tenants && typeof head.tenants === 'object' ? head.tenants : {}, out: NonNullable<Connection['status']> = {};
      for (const [tenant, v] of Object.entries(tenants).slice(0, 50)) if (mine.has(tenant)) out[tenant] = v && typeof v === 'object' ? { open: v.open === true, ...(typeof v.reason === 'string' && /^(staff|closing|stopped)$/.test(v.reason) ? { reason: v.reason } : {}), ...(typeof v.since === 'string' && v.since.length <= 40 ? { since: v.since } : {}), call: v.call === true } : null;
      c.status = out; return;
    }
    if (head.t !== 'res' && head.t !== 'data') return;
    const s = c.streams.get(Number(head.id)); if (!s) return;
    if (head.t === 'res') {
      if (s.head) return;
      s.head = { t: 'res', id: head.id, s: Number(head.s) || 502, h: head.h && typeof head.h === 'object' ? head.h : {}, ...(head.more ? { more: true } : {}) };
    } else if (!s.head) return;
    s.size += m.body.length;
    if (s.size > TUNNEL.MAX_ANSWER) { this.finish(c, Number(head.id)); c.ws.send(pack({ t: 'cancel', id: Number(head.id) })); s.fail(new DomainError('TOO_LARGE', OFFLINE, 502)); return; }
    s.parts.push(Buffer.from(m.body));
    if ((head.t === 'res' && !head.more) || (head.t === 'data' && head.end)) {
      this.finish(c, Number(head.id));
      s.done({ status: s.head!.s, headers: s.head!.h, body: Buffer.concat(s.parts, s.size) });
    }
  }
  private finish(c: Connection, id: number) { const s = c.streams.get(id); if (s) { clearTimeout(s.timer); c.streams.delete(id); } }
  /** One request to the café that holds `install`, after the allow-list (only the routes below call it). */
  async forward(install: string, tenant: string, r: { m: 'GET' | 'POST'; p: string; h: Record<string, string>; ip: string; body?: Buffer }): Promise<Answer> {
    const c = this.connections.get(install);
    if (!c?.hello || c.ws.closed) throw offline();
    const started = Date.now();
    // Each café works on PARALLEL requests at once; the rest wait in its own queue. One slow café never holds another's guests.
    if (c.active >= TUNNEL.PARALLEL) {
      if (c.waiting.length >= TUNNEL.QUEUE) { this.count(install, 'refused'); throw new DomainError('CAFE_BUSY', 'İşletme şu anda çok yoğun. Biraz sonra yeniden deneyin.', 503); }
      await new Promise<void>((go, stop) => { const t = setTimeout(() => { const i = c.waiting.indexOf(next); if (i >= 0) c.waiting.splice(i, 1); stop(new DomainError('CAFE_TIMEOUT', OFFLINE, 504)); }, TUNNEL.REQUEST_MS); const next = () => { clearTimeout(t); go(); }; c.waiting.push(next); });
      if (c.ws.closed || this.connections.get(install) !== c) throw offline();
    }
    c.active++; this.count(install, 'requests');
    try {
      const body = r.body ?? Buffer.alloc(0), id = ++c.next;
      const head: TunnelRequest = { t: 'req', id, m: r.m, p: r.p, h: r.h, ip: r.ip, tenant, mac: '' };
      head.mac = requestMac(c.key, head, body);
      return await new Promise<Answer>((done, fail) => {
        const timer = setTimeout(() => { c.streams.delete(id); c.ws.send(pack({ t: 'cancel', id })); this.count(install, 'timeouts'); fail(new DomainError('CAFE_TIMEOUT', OFFLINE, 504)); }, Math.max(1000, TUNNEL.REQUEST_MS - (Date.now() - started)));
        timer.unref();
        c.streams.set(id, { done, fail, timer, parts: [], size: 0 });
        if (!c.ws.send(pack(head, body)) && c.ws.closed) { clearTimeout(timer); c.streams.delete(id); fail(offline()); }
      });
    } catch (e) { if (!(e instanceof DomainError && e.code === 'CAFE_TIMEOUT')) this.count(install, 'errors'); throw e; }
    finally { c.active--; c.waiting.shift()?.(); }
  }
  // ---------- Merkez's own copies of the page's files ----------
  /** The file with this SHA-256 when Merkez has it: memory, or its own build (same name, same bytes). */
  file(name: string, sha: string): Buffer | undefined {
    const kept = this.files.get(sha); if (kept) { this.files.delete(sha); this.files.set(sha, kept); return kept; }
    if (!this.options.buildDirectory) return undefined;
    const path = name === 'menu.html' ? join(this.options.buildDirectory, 'menu.html') : join(this.options.buildDirectory, 'assets', name);
    let ownSha = this.own.get(path);
    if (ownSha === undefined) { try { const s = statSync(path); ownSha = s.isFile() && s.size < 4 * 1024 * 1024 ? sha256(readFileSync(path)) : null; } catch { ownSha = null; } this.own.set(path, ownSha); }
    if (ownSha !== sha) return undefined;
    try { const body = readFileSync(path); if (sha256(body) === sha) { this.keepFile(sha, body); return body; } } catch { /* removed meanwhile */ }
    return undefined;
  }
  /**
   * Merkez's own built guest page or one of its files, by name (the menu copy is shown with it while the café cannot be
   * reached; a page loaded that way asks for these names later too). Undefined without a build (npm run merkez:dev).
   */
  ownFile(name: string): Buffer | undefined {
    if (!this.options.buildDirectory || (name !== 'menu.html' && !ASSET_NAME.test(name))) return undefined;
    const path = name === 'menu.html' ? join(this.options.buildDirectory, 'menu.html') : join(this.options.buildDirectory, 'assets', name);
    try { const s = statSync(path); if (!s.isFile() || s.size > 4 * 1024 * 1024) return undefined; const body = readFileSync(path); this.keepFile(sha256(body), body); return body; } catch { return undefined; }
  }
  keepFile(sha: string, body: Buffer) {
    if (body.length > 4 * 1024 * 1024 || this.files.has(sha)) return;
    this.files.set(sha, body); this.filesSize += body.length;
    for (const [k, v] of this.files) { if (this.filesSize <= FILES_TOTAL) break; this.files.delete(k); this.filesSize -= v.length; }
  }
  photo(install: string, path: string) {
    const k = `${install} ${path}`, m = this.media.get(k);
    if (!m) return undefined;
    if (m.until <= this.now().getTime()) { this.media.delete(k); this.mediaSize -= m.body.length; return undefined; }
    return m;
  }
  keepPhoto(install: string, path: string, body: Buffer, type: string) {
    if (body.length > 2 * 1024 * 1024) return;
    const k = `${install} ${path}`, old = this.media.get(k); if (old) { this.media.delete(k); this.mediaSize -= old.body.length; }
    let mine = 0; for (const v of this.media.values()) if (v.install === install) mine += v.body.length;
    for (const [key, v] of this.media) { if (mine + body.length <= MEDIA_PER_CAFE) break; if (v.install === install) { this.media.delete(key); this.mediaSize -= v.body.length; mine -= v.body.length; } }
    this.media.set(k, { body, etag: `"${sha256(body).slice(0, 32)}"`, type, until: this.now().getTime() + MEDIA_MS, install }); this.mediaSize += body.length;
    for (const [key, v] of this.media) { if (this.mediaSize <= MEDIA_TOTAL) break; this.media.delete(key); this.mediaSize -= v.body.length; }
  }
  forgetPhotos(install: string) { for (const [k, v] of [...this.media]) if (v.install === install) { this.media.delete(k); this.mediaSize -= v.body.length; } }
}
/** Merkez's own HTTP server takes the tunnels' upgrades (runtime.ts and the tests' fixture). */
export function tunnelUpgrades(server: Server, hub: () => GuestTunnelHub | undefined) {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Another upgrade (Vite's reload socket in development) is left to its own listener; with none, it is closed.
    if ((req.url ?? '').split('?')[0] !== TUNNEL_PATH) { if (server.listenerCount('upgrade') <= 1) socket.destroy(); return; }
    const h = hub();
    if (!h) { socket.on('error', () => socket.destroy()); socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    h.upgrade(req, socket, head);
  });
}

// ---------- The guest's side: /q/<kod>/… ----------
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const NOTICE_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
/** The guest's paths after `/q/<kod>` (method, pattern, kind). Nothing else ever reaches a café. */
const ALLOWED: [string, RegExp, 'page' | 'asset' | 'api' | 'media'][] = [
  ['GET', /^\/([A-Za-z0-9_-]{16,100})$/, 'page'],
  ['GET', /^\/assets\/([A-Za-z0-9_.-]{1,120})$/, 'asset'],
  ['GET', /^\/api\/guest\/state$/, 'api'],
  ['POST', /^\/api\/guest\/(session|orders|orders\/edit|call|cancel)$/, 'api'],
  ['GET', /^\/media\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,99})\/[a-f0-9-]{36}(-small)?\.webp$/, 'media'],
];
export function guestPathKind(method: string, rest: string) {
  for (const [m, re, kind] of ALLOWED) { const x = re.exec(rest); if (x && m === method) return { kind, match: x }; }
  return undefined;
}
type Entry = { tenantId: string; install?: string; open: boolean };
async function rawBody(req: Request, max: number) {
  const parts: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += (chunk as Buffer).length; if (size > max) throw new DomainError('TOO_LARGE', 'İstek çok büyük.', 413); parts.push(chunk as Buffer); }
  return Buffer.concat(parts);
}
/**
 * Registered before Merkez's JSON parser (the guest's body goes on byte for byte) and after its host check. `menuOrigin`: the
 * guest menu's own address (MERKEZ_MENU_ORIGIN, server/merkez/menu-host.ts: /q/* reaches this only on that name), then a
 * guest's POST must come from exactly there. Without it (older setups, LAN): the QR codes' address (MERKEZ_SITE_ORIGIN, else
 * PUBLIC_ORIGIN) or Merkez's own, as before.
 */
export function guestTunnelRoutes(app: Express, o: { hub: GuestTunnelHub; store: MerkezStore; now: () => Date; publicOrigin?: string; siteOrigin?: string; menuOrigin?: string }) {
  const { hub, store, now } = o;
  type Counter = { count: number; until: number };
  const counters = new ExpiringStore<Counter>(v => v.until, () => now().getTime(), 50000, true);
  const allowed = (req: Request, purpose: string, max: number, ms: number) => {
    const t = now().getTime(), k = `${purpose}:${clientKey(req)}`; let c = counters.get(k);
    if (!c || c.until <= t) { c = { count: 0, until: t + ms }; counters.set(k, c); }
    return ++c.count <= max;
  };
  let cache: { generation: number; at: number; byCode: Map<string, Entry> } | undefined;
  const lookup = (code: string) => {
    const t = now().getTime();
    if (!cache || cache.generation !== store.generation || t - cache.at > 60_000) {
      const d = store.read(), byCode = new Map<string, Entry>(), when = now();
      for (const b of d.businesses) if (b.menu) byCode.set(b.menu.code, { tenantId: b.tenantId, install: b.installId, open: menuOpen(b, d, when) });
      cache = { generation: store.generation, at: t, byCode };
    }
    return cache.byCode.get(code);
  };
  app.use('/q', async (req: Request, res: Response, next: NextFunction) => {
    try { await serve(req, res); } catch (e) { next(e); }
  });
  async function serve(req: Request, res: Response) {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store', 'Content-Security-Policy': NOTICE_CSP });
    const api = /^\/[A-Za-z0-9]{10}\/api\//.test(req.path);
    const notice = (status: number, kind: 'unavailable' | 'missing' | 'busy' | 'offline') => {
      if (api) {
        const [code, message] = kind === 'unavailable' ? ['MENU_UNAVAILABLE', UNAVAILABLE] : kind === 'missing' ? ['NOT_FOUND', 'Bulunamadı.'] : kind === 'busy' ? ['RATE_LIMIT', 'Çok sık deneme yapıldı. Biraz bekleyip tekrar deneyin.'] : ['CAFE_OFFLINE', OFFLINE];
        res.status(status).json({ code, message }); return;
      }
      if (kind === 'offline') res.set('Retry-After', '15');
      res.status(status).type('html').send(kind === 'unavailable' ? noticePage({ status: kind, tr: 'Bu işletmenin dijital menüsü şu anda kullanılamıyor.', en: 'This business’s digital menu is currently unavailable.', detail: 'Lütfen personelle görüşün.', detailEn: 'Please ask the staff.' })
        : kind === 'offline' ? noticePage({ status: kind, tr: OFFLINE, en: OFFLINE_EN, detail: 'Sayfa birkaç saniye içinde yeniden denenecek.', refresh: 15 })
          : kind === 'busy' ? noticePage({ status: kind, tr: 'Çok sık deneme yapıldı. Biraz bekleyip tekrar deneyin.', en: 'Too many tries. Please wait a moment and try again.' })
            : noticePage({ status: kind, tr: 'Bu bağlantı bulunamadı.', en: 'This link could not be found.', detail: 'Masanızdaki QR kodunu yeniden okutun.', detailEn: 'Please scan the QR code on your table again.' }));
    };
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) return notice(404, 'missing');
    // Per guest address (IPv6 per /64): far more than one table needs (a menu with photos, polling every 2 s), little for a flood.
    if (!allowed(req, 'q-all', 1200, 60_000)) return notice(429, 'busy');
    const m = /^\/([A-Za-z0-9]{10})(\/.*)?$/.exec(req.path);
    const entry = m && MENU_CODE.test(m[1]) ? lookup(m[1]) : undefined;
    if (!entry) { if (!allowed(req, 'q-miss', 30, 60_000)) return notice(429, 'busy'); return notice(404, 'missing'); }
    const code = m![1], rest = m![2] ?? '', method = req.method === 'HEAD' ? 'GET' : req.method;
    const kind = guestPathKind(method, rest);
    if (!kind) return notice(404, 'missing');
    if (kind.kind === 'media' && kind.match[1] !== entry.tenantId) return notice(404, 'missing');
    if (kind.kind === 'page' && !TABLE_TOKEN.test(kind.match[1])) return notice(404, 'missing');
    // Suspended, frozen, ended, no "QR menü", or the café not heard from in 14 days: said here, the café is not asked.
    if (!entry.open || !entry.install) return kind.kind === 'page' || kind.kind === 'api' ? notice(kind.kind === 'api' ? 403 : 200, 'unavailable') : notice(404, 'missing');
    const install = entry.install;
    if (kind.kind === 'page' && (!allowed(req, 'q-page', 120, 60_000) || !allowed(req, 'q-page-6h', 1500, 6 * 3600_000))) return notice(429, 'busy');
    const online = hub.online(install), copy = hub.mirror?.get(entry.tenantId);
    let body: Buffer | undefined;
    if (req.method === 'POST') {
      // A guest's POST comes from the page itself (the QR's site address or Merkez's own): no other site may send one.
      const origin = req.get('Origin'), own = `${req.protocol}://${req.get('host')}`;
      if (!origin || !(o.menuOrigin ? [o.menuOrigin] : [o.siteOrigin, o.publicOrigin, own]).includes(origin)) { res.status(403).json({ code: 'ORIGIN_REJECTED', message: 'İstek kaynağı geçersiz.' }); return; }
      if (!req.is('application/json')) { res.status(415).json({ code: 'JSON_REQUIRED', message: 'JSON içerik gerekli.' }); return; }
      body = await rawBody(req, 64 * 1024);
    }
    const ip = clientKey(req), prefix = `/q/${code}/`;
    const session = req.get('X-Guest-Session'), mirrorTable = session ? mirrorSessionTable(code, session) : undefined;
    const send = async (path: string, headers: Record<string, string>) => {
      try { return await hub.forward(install, entry.tenantId, { m: method as 'GET' | 'POST', p: path, h: headers, ip, ...(body ? { body } : {}) }); }
      catch (e) { if (e instanceof DomainError && ['CAFE_OFFLINE', 'CAFE_TIMEOUT', 'TOO_LARGE'].includes(e.code)) return null; if (e instanceof DomainError && e.code === 'CAFE_BUSY') return 'busy' as const; throw e; }
    };
    const sendFile = (name: string, file: Buffer, sha: string) => {
      if (name === 'menu.html') { res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP, 'Cache-Control': 'no-store' }); res.status(200).end(req.method === 'HEAD' ? undefined : file); return; }
      const etag = `"${sha.slice(0, 32)}"`;
      res.set({ 'Content-Type': ASSET_TYPES[name.split('.').pop()!] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', ETag: etag, 'Content-Security-Policy': PAGE_CSP });
      if (req.get('If-None-Match') === etag) { res.status(304).end(); return; }
      res.status(200).end(req.method === 'HEAD' ? undefined : file);
    };
    if (kind.kind === 'media') {
      const reply = (b: Buffer, etag: string) => {
        res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=600', ETag: etag, 'Content-Security-Policy': NOTICE_CSP });
        if (req.get('If-None-Match') === etag) { res.status(304).end(); return; }
        res.status(200).end(req.method === 'HEAD' ? undefined : b);
      };
      // The menu copy's photos first (they never ask the café), then the few minutes' memory, then the café.
      const fromCopy = hub.mirror?.photo(entry.tenantId, rest.slice(rest.lastIndexOf('/') + 1));
      if (fromCopy) return reply(fromCopy.body, fromCopy.etag);
      const kept = hub.photo(install, rest);
      if (kept) return reply(kept.body, kept.etag);
      if (!online) { res.status(503).end(); return; }
      const a = await send(rest, {});
      if (a === 'busy' || !a) { res.status(503).end(); return; }
      if (a.status !== 200 || a.headers['content-type'] !== 'image/webp') { res.status(a.status === 403 ? 403 : 404).end(); return; }
      hub.keepPhoto(install, rest, a.body, 'image/webp');
      return reply(a.body, hub.photo(install, rest)?.etag ?? `"${sha256(a.body).slice(0, 32)}"`);
    }
    if (!online) {
      // Menünün kopyası (8 Ekim): the café cannot be reached; the guest browses the copy its café last sent, ordering closed.
      if (!copy) return notice(503, 'offline');
      if (kind.kind === 'page') {
        if (!copy.tables.some(t => t.h === tableHash(kind.match[1]))) return notice(404, 'missing');
        const page = hub.ownFile('menu.html');
        return page ? sendFile('menu.html', page, sha256(page)) : notice(503, 'offline');
      }
      if (kind.kind === 'asset') { const f = hub.ownFile(kind.match[1]); return f ? sendFile(kind.match[1], f, sha256(f)) : notice(404, 'missing'); }
      if (rest === '/api/guest/session') {
        let token = ''; try { token = String((JSON.parse(body?.toString('utf8') ?? '{}') as { token?: unknown }).token ?? ''); } catch { /* not JSON */ }
        const h = TABLE_TOKEN.test(token) ? tableHash(token) : '', table = copy.tables.find(t => t.h === h);
        if (!table) { if (!allowed(req, 'q-miss', 30, 60_000)) return notice(429, 'busy'); res.status(404).json({ code: 'INVALID_QR', message: 'QR bağlantısı bulunamadı.' }); return; }
        res.json({ session: mirrorSession(code, h), tableId: 'mirror', guestContext: sha256(`mola-kopya:${code}:${h}`), mirror: true }); return;
      }
      if (rest === '/api/guest/state' && mirrorTable) {
        const table = copy.tables.find(t => t.h === mirrorTable);
        if (!table) return notice(503, 'offline');
        const text = JSON.stringify(mirrorSnapshot(copy, table.name, now(), table.h)), tag = createHash('sha256').update(text).digest('base64url').slice(0, 27);
        res.set('X-Mola-Tag', tag);
        if (req.get('X-Mola-Tag') === tag) { res.status(204).end(); return; }
        res.status(200).type('application/json').send(text); return;
      }
      // Ordering, the waiter, the bill, edits and cancels need the café: plainly said (a real session keeps what it shows).
      res.status(503).json({ code: 'CAFE_OFFLINE', message: QR_OFFLINE_TEXT.tr }); return;
    }
    const hello = hub.helloOf(install)!;
    // A page that opened on the copy while the café was away: its session is Merkez's, so it starts a real one now.
    if (kind.kind === 'api' && mirrorTable) { res.status(409).json({ code: 'SESSION_RENEW', message: 'Menü yenileniyor.' }); return; }
    if (kind.kind === 'page' || kind.kind === 'asset') {
      const name = kind.kind === 'page' ? 'menu.html' : kind.match[1], sha = kind.kind === 'page' ? hello.page : hello.assets[name];
      if (kind.kind === 'asset' && !ASSET_NAME.test(name)) return notice(404, 'missing');
      // A file the café did not list: Merkez's own build's (a page opened on the menu copy loads its own files later).
      if (!sha) { if (kind.kind === 'page') return notice(503, 'offline'); const f = hub.ownFile(name); return f ? sendFile(name, f, sha256(f)) : notice(404, 'missing'); }
      let file = hub.file(name, sha);
      if (!file) {
        const a = await send(kind.kind === 'page' ? `/m/${kind.match[1]}` : `/assets/${name}`, {});
        if (a === 'busy') return notice(503, 'busy');
        if (!a || a.status !== 200) return a?.status === 404 ? notice(404, 'missing') : notice(503, 'offline');
        file = a.body;
        // Kept only when it is exactly the file the café listed (SHA-256), so a copy serves every café with that file.
        if (sha256(file) === sha) hub.keepFile(sha, file);
      }
      return sendFile(name, file, sha);
    }
    // /api/guest/*: only the headers a guest call needs; the guest cookie only, and only its own value.
    const h: Record<string, string> = {};
    const accept = req.get('Accept'); if (accept && accept.length <= 100) h.accept = accept;
    if (body) h['content-type'] = 'application/json';
    if (session && /^[A-Za-z0-9_-]{1,200}$/.test(session)) h['x-guest-session'] = session;
    const tag = req.get('X-Mola-Tag'); if (tag && tag.length <= 100 && /^[\x21-\x7e]+$/.test(tag)) h['x-mola-tag'] = tag;
    const browser = /(?:^|;\s*)mola_browser=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]; if (browser) h.cookie = `mola_browser=${browser}`;
    const a = await send(rest, h);
    if (a === 'busy') return notice(503, 'busy');
    if (!a) return notice(503, 'offline');
    res.status(a.status);
    const type = a.headers['content-type']; if (type && /^application\/json/.test(type)) res.set('Content-Type', type);
    if (a.headers['x-mola-tag'] && a.headers['x-mola-tag'].length <= 100) res.set('X-Mola-Tag', a.headers['x-mola-tag']);
    // The guest cookie, scoped to this business's prefix (two cafés on the same site never share one), HTTPS-only behind TLS.
    // No Domain: a host-only cookie of the menu's own name (MERKEZ_MENU_ORIGIN), never seen by Mola Yönetim or the web site.
    const cookie = /^mola_browser=([a-f0-9]{48});/.exec(a.headers['set-cookie'] ?? '');
    if (cookie) { const age = /Max-Age=(\d{1,9})/i.exec(a.headers['set-cookie']!)?.[1] ?? '2592000'; res.append('Set-Cookie', `mola_browser=${cookie[1]}; Max-Age=${age}; Path=${prefix}; HttpOnly; SameSite=Strict${req.secure ? '; Secure' : ''}`); }
    res.end([204, 304].includes(a.status) ? undefined : a.body);
  }
  /** A session Merkez gives for its menu copy: the table's hash and an HMAC under Merkez's own key (nothing is stored). */
  function mirrorSession(code: string, h: string) { return `mirror${h}${createHmac('sha256', store.subkey('menu-oturumu')).update(`${code}:${h}`).digest('base64url').slice(0, 22)}`; }
  function mirrorSessionTable(code: string, session: string) {
    const m = /^mirror([a-f0-9]{40})([A-Za-z0-9_-]{22})$/.exec(session);
    if (!m) return undefined;
    const x = Buffer.from(mirrorSession(code, m[1])), y = Buffer.from(session);
    return x.length === y.length && timingSafeEqual(x, y) ? m[1] : undefined;
  }
}
