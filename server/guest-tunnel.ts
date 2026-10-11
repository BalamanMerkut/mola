import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Agent, createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { join } from 'node:path';
import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../packages/domain/engine.js';
import { directLoopback, type HttpSecurity } from './http-security.js';
import { HEADER } from './install-auth.js';
import type { MerkezLink } from './kafe-link.js';
import { APP_VERSION } from './license.js';
import { ASSET_NAME, ASSET_TYPES, BACKOFF, connectionKey, pack, requestMac, sha256, TUNNEL, TUNNEL_ACCEPTED, TUNNEL_PATH, unpack, type TunnelRequest, type TunnelStatus } from './tunnel-protocol.js';
import { WsSocket, wsAccept } from './ws-frames.js';

/*
 * İnternetten menü, the café's end (protocol: server/tunnel-protocol.ts; Merkez's end: server/merkez/guest-tunnel.ts).
 * The café keeps one outbound WebSocket to its Mola Merkez, signed with the install's own secret like the heartbeat, while Mola
 * is activated, Merkez takes guest tunnels ('guest.tunnel' in its `accepts`) and this café has the built guest page (installed
 * runs: runtime.ts `serveFrom`). No port is opened here; the modem and firewall see one ordinary HTTPS connection out.
 * Over it come only guest requests that Merkez already checked; they are checked here once more (`tunnelAllowed`):
 *   GET  /m/<masa kodu>     the guest page (menu.html of the build, read from disk here: never reaches the app)
 *   GET  /assets/<file>     only the files menu.html loads (Vite's manifest, `guestBuild`)
 *   GET  /api/guest/state, POST /api/guest/session|orders|orders/edit|call|cancel
 *   GET  /media/<işletme>/<foto>.webp   that business's photos only
 * Everything else is 404. The API and photo requests are replayed on this very app on a private loopback listener (like Mola
 * destek, server/support-session.ts) with this process's own random secret (`x-mola-tunnel`), the business Merkez named and
 * the guest's address. `gate` (before every route) lets a marked request through only on that allow-list and makes the
 * guest's address the one every per-client limit counts (http-security.ts clientKey). It is never a staff, Mola destek, remote
 * or desktop request: no such cookie or header is ever passed, and a forwarding header makes the "this computer only" checks
 * see an outside request. Answers go back in parts, interleaved (`pump`), so a large photo never holds a small answer.
 * Reconnects: 1, 2, 5, 10, 30, 60 s (+ up to a quarter at random), reset after a connection that held a minute.
 */
type BuiltFile = { body: Buffer; sha: string; type: string };
export type GuestBuild = { page: Buffer; pageSha: string; files: Map<string, BuiltFile> };
type Manifest = Record<string, { file?: string; css?: string[]; assets?: string[]; imports?: string[]; dynamicImports?: string[] }>;
/** menu.html and exactly the files it loads (its entry in Vite's manifest, followed through imports); null without a build. */
export function guestBuild(dir: string): GuestBuild | null {
  try {
    const page = readFileSync(join(dir, 'menu.html'));
    const manifest = JSON.parse(readFileSync(join(dir, '.vite', 'manifest.json'), 'utf8')) as Manifest;
    const entry = Object.keys(manifest).find(k => k === 'menu.html' || k.endsWith('/menu.html'));
    if (!entry) return null;
    const seen = new Set<string>(), names = new Set<string>();
    const walk = (k: string) => {
      const e = manifest[k]; if (seen.has(k) || !e) return; seen.add(k);
      for (const f of [e.file, ...(e.css ?? []), ...(e.assets ?? [])]) if (f) names.add(f);
      for (const i of [...(e.imports ?? []), ...(e.dynamicImports ?? [])]) walk(i);
    };
    walk(entry);
    const files = new Map<string, BuiltFile>();
    for (const f of names) {
      const name = f.replace(/^assets\//, '');
      if (!f.startsWith('assets/') || !ASSET_NAME.test(name)) continue;
      const body = readFileSync(join(dir, 'assets', name));
      files.set(name, { body, sha: sha256(body), type: ASSET_TYPES[name.split('.').pop()!] });
    }
    return { page, pageSha: sha256(page), files };
  } catch { return null; }
}
/** The café's own allow-list (Merkez has its own; both must say yes). `tenant`: the business whose menu code was used. */
const ROUTES: [string, RegExp][] = [
  ['GET', /^\/m\/[A-Za-z0-9_-]{16,100}$/], ['GET', /^\/assets\/[A-Za-z0-9_.-]{1,120}$/],
  ['GET', /^\/api\/guest\/state$/], ['POST', /^\/api\/guest\/(session|orders|orders\/edit|call|cancel)$/],
  ['GET', /^\/media\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,99})\/[a-f0-9-]{36}(-small)?\.webp$/],
];
export function tunnelAllowed(method: string, path: string, tenant: string) {
  for (const [m, re] of ROUTES) {
    const x = re.exec(path);
    if (x && m === method.toUpperCase()) return !path.startsWith('/media/') || x[1] === tenant;
  }
  return false;
}
const GUEST_ADDRESS = /^[0-9A-Fa-f:.\/]{2,64}$/;
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
type Reply = { s: number; h: Record<string, string>; body: Buffer };
const json = (s: number, code: string, message: string): Reply => ({ s, h: { 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from(JSON.stringify({ code, message })) });
const notFound = () => json(404, 'NOT_FOUND', 'İşlem bulunamadı.');
type Outgoing = { id: number; ws: WsSocket; parts: Buffer[] };

export class GuestTunnel {
  /** This process's own secret: only requests replayed by `replay` carry it. */
  private secret = randomBytes(32).toString('base64url');
  private internal?: Promise<{ server: Server; port: number }>;
  private app?: Express; private build: GuestBuild | null = null;
  private ws?: WsSocket; private key?: Buffer;
  private connecting = false; private failures = 0; private stopped = false; private paused = false;
  private retry?: NodeJS.Timeout; private watch: NodeJS.Timeout; private heardAt = 0; private openedAt = 0;
  private aborts = new Map<number, () => void>();
  private outbox: Outgoing[] = []; private pumping = false;
  private agent = new Agent({ keepAlive: true, maxSockets: 32 });
  lastError: string | null = null; connectedAt: string | null = null;
  /** After every connection's hello (the menu copy is sent again: server/menu-mirror.ts). */
  onOpen: (() => void)[] = [];
  /** QR siparişleri per business (server/qr-ordering.ts report), told to Mola Merkez at once on every change (Mola Yönetim's Özet). */
  statusSource?: () => TunnelStatus['tenants'];
  private lastStatus = '';
  /** Counters only (no content): requests answered, refused by the allow-list, failed. */
  readonly counts = { requests: 0, refused: 0, failed: 0 };
  constructor(private link: MerkezLink, private security: HttpSecurity = {}) {
    link.tunnelWanted = () => !!this.build && !this.stopped;
    link.afterSync.push(() => this.refresh());
    link.onStop.push(() => this.stop());
    this.watch = setInterval(() => this.refresh(), 15_000); this.watch.unref();
  }
  attach(app: Express) { this.app = app; }
  /** Installed runs (runtime.ts): the built guest page and its files; the tunnel runs only with them. */
  serveFrom(dir: string) {
    this.build = guestBuild(dir);
    if (!this.build) console.warn('İnternetten menü: derlenmiş misafir sayfası (menu.html) bulunamadı; tünel açılmıyor.');
    this.refresh();
  }
  /** The guest page can be served from here (so table QR codes may hold the public address). */
  ready() { return !!this.build && !this.stopped; }
  connected() { return !!this.ws && !this.ws.closed; }
  needed() { try { return !this.stopped && !this.paused && !!this.build && this.link.relayReady() && !!this.link.read()?.accepts?.includes('guest.tunnel'); } catch { return false; } }
  /** Opens the tunnel when it is needed, closes it when not (after every heartbeat and every 15 s). */
  refresh() {
    if (!this.needed()) { if (this.ws && !this.ws.closed) this.ws.close(1000); return; }
    if (this.ws || this.connecting || this.retry) return;
    this.connect();
  }
  stop() {
    this.stopped = true; clearInterval(this.watch); clearTimeout(this.retry); this.retry = undefined;
    this.ws?.close(1001); this.agent.destroy();
    void this.internal?.then(i => i.server.close()).catch(() => {});
  }
  /** Tells Mola Merkez the QR ordering state when it changed (a tiny message; an older Merkez ignores it). */
  pushStatus() {
    const ws = this.ws; if (!ws || ws.closed || !this.statusSource) return;
    let tenants: TunnelStatus['tenants']; try { tenants = this.statusSource(); } catch { return; }
    const text = JSON.stringify(tenants); if (text === this.lastStatus) return;
    this.lastStatus = text; ws.send(pack({ t: 'status', v: 1, tenants }));
  }
  /** Browser tests only (MOLA_TEST_TUNNEL): the café computer "off" for Mola Merkez, then back. */
  pause(on: boolean) { this.paused = on; if (on) { clearTimeout(this.retry); this.retry = undefined; this.ws?.destroy(); } this.refresh(); }
  status() { return { ready: this.ready(), connected: this.connected(), connectedAt: this.connectedAt, lastError: this.lastError }; }
  private later() {
    if (this.stopped || this.paused || this.retry) return;
    const base = BACKOFF[Math.min(this.failures++, BACKOFF.length - 1)], ms = Number(process.env.MOLA_TUNNEL_RETRY_MS) || base + Math.floor(Math.random() * base / 4);
    this.retry = setTimeout(() => { this.retry = undefined; this.refresh(); }, ms); this.retry.unref();
  }
  private connect() {
    let call: ReturnType<MerkezLink['tunnelRequest']>;
    try { call = this.link.tunnelRequest(TUNNEL_PATH); } catch (e) { this.lastError = e instanceof Error ? e.message : 'Mola Merkez adresi kullanılamıyor.'; this.later(); return; }
    this.connecting = true;
    let settled = false;
    const key = randomBytes(16).toString('base64'), request = call.url.protocol === 'https:' ? httpsRequest : httpRequest;
    const fail = (why: string) => { if (settled) return; settled = true; this.connecting = false; this.lastError = why; this.later(); };
    const req = request(call.url, { method: 'GET', agent: false, timeout: 15_000, headers: { ...call.headers, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key } });
    req.on('upgrade', (res: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (settled) { socket.destroy(); return; }
      // Only our own Merkez can sign this nonce with the install secret.
      if (res.headers['sec-websocket-accept'] !== wsAccept(key) || !call.accepted(String(res.headers[HEADER.signature] ?? ''), TUNNEL_ACCEPTED)) { socket.destroy(); fail('Mola Merkez’in yanıtı doğrulanamadı.'); return; }
      settled = true; this.connecting = false;
      this.open(socket, head, connectionKey(call.secret, call.nonce));
    });
    req.on('response', res => {
      let text = ''; res.setEncoding('utf8');
      res.on('data', (c: string) => { if (text.length < 4000) text += c; });
      res.on('end', () => {
        let code = ''; try { code = String(JSON.parse(text).code ?? ''); } catch { /* not Merkez's JSON */ }
        if (code === 'CLOCK_SKEW') this.link.learnClock(String(res.headers['x-mola-server-time'] ?? ''));
        fail(`Mola Merkez internetten menü bağlantısını kabul etmedi (${res.statusCode}${code ? ` ${code}` : ''}).`);
      });
      res.on('error', () => fail('Mola Merkez’e ulaşılamadı.'));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => fail('Mola Merkez’e ulaşılamadı.'));
    req.end();
  }
  private open(socket: Duplex, head: Buffer, key: Buffer) {
    const ws = new WsSocket(socket, 'client', TUNNEL.MAX_MESSAGE, head), build = this.build;
    this.ws = ws; this.key = key; this.heardAt = this.openedAt = Date.now(); this.connectedAt = new Date().toISOString(); this.lastError = null;
    if (!build) { ws.close(1000); return; }
    ws.send(pack({ t: 'hello', v: 1, app: APP_VERSION, page: build.pageSha, assets: Object.fromEntries([...build.files].map(([n, f]) => [n, f.sha])) }));
    this.lastStatus = ''; this.pushStatus();
    for (const f of this.onOpen) try { f(); } catch { /* their own business */ }
    ws.on('message', (m: Buffer) => { this.heardAt = Date.now(); void this.message(ws, m); });
    ws.on('ping', () => { this.heardAt = Date.now(); });
    // Merkez pings every PING_MS; nothing at all for SILENT_MS: the line is dead (a sleeping modem, a dropped NAT entry).
    const alive = setInterval(() => { if (Date.now() - this.heardAt > TUNNEL.SILENT_MS) ws.destroy(); }, Math.min(5000, TUNNEL.SILENT_MS / 2)); alive.unref();
    ws.on('close', () => {
      clearInterval(alive);
      if (this.ws !== ws) return;
      this.ws = undefined; this.key = undefined;
      for (const abort of this.aborts.values()) abort();
      this.aborts.clear(); this.outbox = this.outbox.filter(o => o.ws !== ws);
      if (Date.now() - this.openedAt > 60_000) this.failures = 0;
      this.lastError ??= 'Bağlantı kesildi.';
      this.later();
    });
  }
  private async message(ws: WsSocket, raw: Buffer) {
    let m: ReturnType<typeof unpack>;
    try { m = unpack(raw); } catch { ws.destroy(1002); return; }
    const head = m.head;
    if (head.t === 'cancel') { this.aborts.get(Number(head.id))?.(); this.outbox = this.outbox.filter(o => o.id !== head.id || o.ws !== ws); return; }
    if (head.t !== 'req') return;
    const r = head as TunnelRequest, key = this.key;
    if (!Number.isSafeInteger(r.id) || !key || this.ws !== ws) return;
    const valid = (r.m === 'GET' || r.m === 'POST') && typeof r.p === 'string' && r.p.length <= 300 && typeof r.ip === 'string' && typeof r.tenant === 'string' && r.tenant.length <= 100 && typeof r.mac === 'string'
      && !!r.h && typeof r.h === 'object' && (() => { const x = Buffer.from(requestMac(key, r, m.body)), y = Buffer.from(r.mac); return x.length === y.length && timingSafeEqual(x, y); })();
    let reply: Reply;
    if (!valid) reply = json(400, 'INVALID', 'Geçersiz istek.');
    else try { reply = await this.handle(r, Buffer.from(m.body)); } catch { this.counts.failed++; reply = json(502, 'TUNNEL_FAILED', 'Menü şu anda açılamıyor. Lütfen garsonunuza sorun.'); }
    if (this.ws !== ws || ws.closed) return;
    this.send(ws, r.id, reply);
  }
  private async handle(r: TunnelRequest, body: Buffer): Promise<Reply> {
    // Checked again here, whatever Merkez said: the path, the business (one of this computer's), the guest's address.
    if (!tunnelAllowed(r.m, r.p, r.tenant) || !this.link.read()?.licenses[r.tenant] || !GUEST_ADDRESS.test(r.ip)) { this.counts.refused++; return notFound(); }
    this.counts.requests++;
    const build = this.build;
    if (r.p.startsWith('/m/')) return build ? { s: 200, h: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: build.page } : json(503, 'CAFE_OFFLINE', 'Menü şu anda açılamıyor.');
    if (r.p.startsWith('/assets/')) { const f = build?.files.get(r.p.slice(8)); return f ? { s: 200, h: { 'content-type': f.type, 'cache-control': 'public, max-age=31536000, immutable' }, body: f.body } : notFound(); }
    return this.replay(r, body);
  }
  private listen() {
    return this.internal ??= new Promise((done, fail) => {
      if (!this.app) { fail(new Error('no app')); return; }
      const server = createServer(this.app); server.unref(); server.keepAliveTimeout = 30_000; server.once('error', fail);
      server.listen(0, '127.0.0.1', () => done({ server, port: (server.address() as AddressInfo).port }));
    });
  }
  /** Replays a guest call on this very app (loopback, marked); only the headers a guest call uses go along. */
  private async replay(r: TunnelRequest, body: Buffer): Promise<Reply> {
    const { port } = await this.listen();
    const headers: Record<string, string> = { 'x-mola-tunnel': this.secret, 'x-mola-tunnel-tenant': r.tenant, 'x-mola-tunnel-ip': r.ip, forwarded: 'for=unknown;proto=https' };
    const h = r.h;
    if (typeof h.accept === 'string' && h.accept.length <= 100) headers.accept = h.accept;
    if (typeof h['x-guest-session'] === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(h['x-guest-session'])) headers['x-guest-session'] = h['x-guest-session'];
    if (typeof h['x-mola-tag'] === 'string' && h['x-mola-tag'].length <= 100 && /^[\x21-\x7e]+$/.test(h['x-mola-tag'])) headers['x-mola-tag'] = h['x-mola-tag'];
    if (typeof h.cookie === 'string' && /^mola_browser=[a-f0-9]{48}$/.test(h.cookie)) headers.cookie = h.cookie;
    if (r.m === 'POST') { headers['content-type'] = 'application/json'; headers['content-length'] = String(body.length); }
    // Behind a local TLS proxy (PUBLIC_ORIGIN) the app expects HTTPS and its own origin; this listener stands in that proxy's place.
    if (this.security.publicOrigin) { headers.host = new URL(this.security.publicOrigin).host; headers['x-forwarded-proto'] = 'https'; if (r.m === 'POST') headers.origin = this.security.publicOrigin; }
    return new Promise<Reply>((done, fail) => {
      const req = httpRequest({ host: '127.0.0.1', port, method: r.m, path: r.p, headers, agent: this.agent, timeout: TUNNEL.REQUEST_MS - 2000 }, res => {
        const parts: Buffer[] = []; let size = 0;
        res.on('data', (c: Buffer) => { size += c.length; if (size > TUNNEL.MAX_ANSWER) { req.destroy(); fail(new Error('too large')); return; } parts.push(c); });
        res.on('end', () => {
          this.aborts.delete(r.id);
          const out: Record<string, string> = {};
          for (const name of ['content-type', 'cache-control', 'x-mola-tag', 'etag', 'last-modified']) { const v = res.headers[name]; if (typeof v === 'string' && v.length <= 200) out[name] = v; }
          const cookie = (res.headers['set-cookie'] ?? []).find(c => /^mola_browser=[a-f0-9]{48};/.test(c)); if (cookie) out['set-cookie'] = cookie.slice(0, 300);
          done({ s: res.statusCode ?? 502, h: out, body: Buffer.concat(parts, size) });
        });
        res.on('error', fail);
      });
      this.aborts.set(r.id, () => req.destroy(new Error('cancelled')));
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', e => { this.aborts.delete(r.id); fail(e); });
      req.end(r.m === 'POST' ? body : undefined);
    });
  }
  /** An answer in parts of TUNNEL.CHUNK, queued with the others: `pump` sends one part of each in turn. */
  private send(ws: WsSocket, id: number, reply: Reply) {
    const n = Math.max(1, Math.ceil(reply.body.length / TUNNEL.CHUNK)), parts: Buffer[] = [];
    for (let i = 0; i < n; i++) {
      const chunk = reply.body.subarray(i * TUNNEL.CHUNK, (i + 1) * TUNNEL.CHUNK);
      parts.push(i === 0 ? pack({ t: 'res', id, s: reply.s, h: reply.h, ...(n > 1 ? { more: true } : {}) }, chunk) : pack({ t: 'data', id, ...(i === n - 1 ? { end: true } : {}) }, chunk));
    }
    this.outbox.push({ id, ws, parts }); void this.pump();
  }
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.outbox.length) {
        const item = this.outbox.shift()!;
        if (item.ws.closed) continue;
        const part = item.parts.shift()!;
        if (item.parts.length) this.outbox.push(item);
        if (!item.ws.send(part) && !item.ws.closed) await new Promise<void>(go => { const done = () => { item.ws.socket.off('drain', done); item.ws.off('close', done); go(); }; item.ws.socket.once('drain', done); item.ws.once('close', done); });
      }
    } finally { this.pumping = false; }
  }
  /**
   * Registered before every route of the café app: a request with the tunnel marker is a guest's from Mola Merkez, and only then.
   * The marker must come from this process (its secret) over loopback; the path must be on the allow-list (the page and its
   * files never come this way: they are answered from the build above).
   */
  gate() {
    return (req: Request, res: Response, next: NextFunction) => {
      const marker = req.headers['x-mola-tunnel'];
      if (marker === undefined) return next();
      const given = Buffer.from(String(marker)), expected = Buffer.from(this.secret);
      const mine = LOOPBACK.includes(req.socket.remoteAddress ?? '') && given.length === expected.length && timingSafeEqual(given, expected);
      if (!mine) return next(new DomainError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403));
      const tenant = String(req.headers['x-mola-tunnel-tenant'] ?? ''), ip = String(req.headers['x-mola-tunnel-ip'] ?? '');
      if (!tunnelAllowed(req.method, req.path, tenant) || /^\/(m|assets)\//.test(req.path) || !GUEST_ADDRESS.test(ip) || req.headers['x-mola-relay'] !== undefined || req.headers['x-mola-remote'] !== undefined) return next(new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404));
      (req as Request & { molaClient?: string }).molaClient = ip;
      res.locals.tunnelTenant = tenant;
      next();
    };
  }
}
/**
 * Browser tests only (scripts/test-server.mjs sets MOLA_TEST_TUNNEL=1; never in a release build): from this computer, stop and
 * start the tunnel as if the café computer were switched off for Mola Merkez.
 */
export function tunnelTestRoute(app: Express, tunnel: GuestTunnel, security: HttpSecurity) {
  if (process.env.MOLA_TEST_TUNNEL !== '1' || process.env.MOLA_RELEASE_BUILD === '1') return;
  app.post('/api/test/tunnel', (req, res) => {
    if (!directLoopback(req, security)) throw new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404);
    const { on } = z.object({ on: z.boolean() }).strict().parse(req.body);
    tunnel.pause(!on);
    res.json(tunnel.status());
  });
}
