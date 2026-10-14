import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { sessionCookie } from '../http-security.js';
import type { Install, MerkezData, MerkezStore } from './store.js';
import { addAlert } from './alerts.js';
import { MERKEZ_API } from '../sync-protocol.js';
import { liveRequestSchema, pairingBody, pairRequestSchema, phoneId, postboxBody, RELAY, RELAY_HEADERS, replyBody, stateBody, tenantId as tenantIdSchema, type RelayCall, type RelayReply, type RelayRequest, type TenantState } from '../relay-protocol.js';

/*
 * Mola Merkez's end of the köprü (server/relay-protocol.ts). Cafés poll (HMAC-signed, the heartbeat's own checks); Merkez
 * hands each request to the café that owns the business and waits for its signed reply. Nothing here is kept but routing:
 *   relay_tenants     per business: does the owner allow support now, last seen (no business data)
 *   relay_phones      per paired phone: its business, a hash of the token the phone shows Merkez (never a key)
 *   support_sessions  who connected when (history for Mola Yönetim and the owner's Destek)
 *   kutu.sqlite       the postbox, beside the data folder (`<data>-kutu/`, never in a backup): one encrypted box per phone,
 *                     deleted when the phone fetches it or after RELAY.POSTBOX_DAYS. Merkez cannot open a box: it never sees a
 *                     private key or the pairing secret (packages/domain/remote-crypto.ts).
 * Uzaktan destek: "Kafeye bağlan" (Mola Yönetim, admin session) starts a session at the café and sets the browser's
 * `mola_destek` cookie; with it the café's own screens (index.html from this Merkez's build) talk to /api/staff/* here, which
 * is passed to the café as it is. The café decides what support may see (server/support-session.ts); Merkez adds limits,
 * timeouts and the audit. The owner switching support off, or the session idle for RELAY.SESSION_IDLE_MS, ends it here too.
 */
type Waiter = { install: string; res: Response; secret: string; nonce: string; timer?: NodeJS.Timeout };
type Pending = { install: string; done: (reply: RelayReply) => void; fail: (error: DomainError) => void; timer: NodeJS.Timeout; session?: string };
type Session = { id: string; tenant: string; install: string; secret: string; startedAt: number; lastAt: number; requests: number };
type Counter = { count: number; until: number };
type Deps = {
  store: MerkezStore; now: () => Date; admin: (req: Request) => unknown;
  authenticate: (req: Request) => { install: Install; nonce: string; closed: boolean };
  sendSigned: (res: Response, secret: string, nonce: string, body: unknown) => void;
  limitAddress: (req: Request, purpose: string, max: number, ms: number) => void; limitInstall: (install: string, purpose: string, max: number, ms: number) => void;
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const cookieOf = (req: Request, name: string) => (req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
const DAY = 86400000;
/** A phone paired this recently is not forgotten for missing from a poll's list (see `tenants`). */
export const PAIRED_GRACE_MS = 2 * 60_000;
export const SUPPORT_COOKIE = 'mola_destek';

export class RelayHub {
  private waiters = new Map<string, Waiter>();
  private queues = new Map<string, RelayRequest[]>();
  private pending = new Map<string, Pending>();
  private lastPoll = new Map<string, number>();
  private pairings = new Map<string, { install: string; tenant: string; expiresAt: number }>();
  private sessions = new Map<string, Session>();
  private counters = new Map<string, Counter>();
  readonly box: DatabaseSync;
  private timer: NodeJS.Timeout;
  constructor(private store: MerkezStore, private now: () => Date, boxDirectory = `${store.directory.replace(/[\\/]+$/, '')}-kutu`) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS relay_tenants (tenant TEXT PRIMARY KEY, install TEXT NOT NULL, support INTEGER NOT NULL, since TEXT, seen TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS relay_phones (phone TEXT PRIMARY KEY, tenant TEXT NOT NULL, install TEXT NOT NULL, token TEXT NOT NULL, created TEXT NOT NULL, seen TEXT);
      CREATE TABLE IF NOT EXISTS support_sessions (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, started TEXT NOT NULL, ended TEXT, ended_by TEXT, requests INTEGER NOT NULL DEFAULT 0);`);
    mkdirSync(boxDirectory, { recursive: true });
    this.box = new DatabaseSync(join(boxDirectory, 'kutu.sqlite'));
    this.box.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS postbox (phone TEXT PRIMARY KEY, tenant TEXT NOT NULL, install TEXT NOT NULL, at TEXT NOT NULL, box TEXT NOT NULL, created INTEGER NOT NULL)');
    // Sessions live in memory: whatever was open when Merkez stopped has ended.
    store.db.prepare("UPDATE support_sessions SET ended=?, ended_by='restart' WHERE ended IS NULL").run(now().toISOString());
    this.timer = setInterval(() => { try { this.sweep(); } catch { /* closed */ } }, 60_000); this.timer.unref();
    this.sweep();
  }
  close() { clearInterval(this.timer); for (const w of this.waiters.values()) clearTimeout(w.timer); try { this.box.close(); } catch { /* closed */ } }
  /** Counts one in `key`; false once `max` is passed within the window. */
  take(key: string, max: number, ms: number) {
    const t = this.now().getTime(); let c = this.counters.get(key);
    if (!c || c.until <= t) { if (this.counters.size > 20000) this.counters.clear(); c = { count: 0, until: t + ms }; this.counters.set(key, c); }
    if (++c.count > max) throw new DomainError('RATE_LIMIT', 'Çok sık istek. Biraz bekleyip yeniden deneyin.', 429);
  }
  sweep() {
    const t = this.now().getTime();
    this.box.prepare('DELETE FROM postbox WHERE created < ?').run(t - RELAY.POSTBOX_DAYS * DAY);
    for (const [id, p] of this.pairings) if (p.expiresAt <= t) this.pairings.delete(id);
    for (const s of [...this.sessions.values()]) if (t - s.lastAt > RELAY.SESSION_IDLE_MS || t - s.startedAt > RELAY.SESSION_MAX_MS) this.endSession(s.id, 'timeout', true);
    // A business deleted in Mola Yönetim takes its routing rows, phones and boxes with it.
    const known = new Set(this.store.read().businesses.map(b => b.tenantId));
    for (const { tenant } of this.store.db.prepare('SELECT DISTINCT tenant FROM relay_tenants UNION SELECT DISTINCT tenant FROM relay_phones').all() as { tenant: string }[]) if (!known.has(tenant)) this.forgetTenant(tenant);
  }
  forgetTenant(tenant: string) {
    this.store.db.prepare('DELETE FROM relay_tenants WHERE tenant=?').run(tenant); this.store.db.prepare('DELETE FROM relay_phones WHERE tenant=?').run(tenant);
    this.box.prepare('DELETE FROM postbox WHERE tenant=?').run(tenant);
    for (const s of [...this.sessions.values()]) if (s.tenant === tenant) this.endSession(s.id, 'off', false);
  }
  // ---------- Café side ----------
  online(install: string) { return this.waiters.has(install) || this.now().getTime() - (this.lastPoll.get(install) ?? 0) < RELAY.HOLD_MS + 10_000; }
  seenAt(install: string) { const t = this.lastPoll.get(install); return t ? new Date(t).toISOString() : null; }
  /**
   * What the café says each business allows; anything of this install's not listed allows nothing. Alerts on changes.
   * `poll`: the list came with a long-poll, which may have left the café before a pairing it does not know of yet.
   */
  tenants(install: string, list: TenantState[], d: MerkezData, poll = false) {
    const mine = d.businesses.filter(b => b.installId === install), at = this.now().toISOString(), changed: { tenant: string; name: string; on: boolean }[] = [];
    for (const b of mine) {
      const t = list.find(x => x.tenantId === b.tenantId) ?? { tenantId: b.tenantId, support: false, phones: [] };
      const before = this.store.db.prepare('SELECT support FROM relay_tenants WHERE tenant=?').get(b.tenantId) as { support: number } | undefined;
      if (!!before?.support !== t.support) changed.push({ tenant: b.tenantId, name: b.name, on: t.support });
      this.store.db.prepare('INSERT INTO relay_tenants (tenant,install,support,since,seen) VALUES (?,?,?,?,?) ON CONFLICT(tenant) DO UPDATE SET install=excluded.install, support=excluded.support, since=CASE WHEN relay_tenants.support=excluded.support THEN relay_tenants.since ELSE excluded.since END, seen=excluded.seen')
        .run(b.tenantId, install, t.support ? 1 : 0, at, at);
      // A phone the café no longer lists is gone at once: its token and its box. Except, in a poll's list, one paired in the
      // last PAIRED_GRACE_MS: the café's next poll leaves with the list from before the pairing and, over the internet, can
      // arrive after the pairing reply (a fresh connection for the poll, an idle one for the reply). Forgetting the new phone
      // then made Raporlarım fall back to "Eşleştir" right after a pairing the café computer showed as done (0.1.21, the
      // owner's test). A removal is announced at once (/relay/state, no grace); the café itself answers no removed phone.
      const keep = new Set(t.phones), since = poll ? new Date(this.now().getTime() - PAIRED_GRACE_MS).toISOString() : undefined;
      for (const { phone, created } of this.store.db.prepare('SELECT phone, created FROM relay_phones WHERE tenant=?').all(b.tenantId) as { phone: string; created: string }[]) if (!keep.has(phone) && (!since || created < since)) this.forgetPhone(phone);
      if (!t.support) for (const s of [...this.sessions.values()]) if (s.tenant === b.tenantId) this.endSession(s.id, 'off', false);
    }
    if (changed.length) this.store.mutate(x => { for (const c of changed) { addAlert(x, at, 'support.access', `${c.name}: işletme sahibi uzaktan destek iznini ${c.on ? 'açtı. Mola Yönetim → işletme → Destek → “Kafeye bağlan”' : 'kapattı'}.`, { tenantId: c.tenant, title: c.on ? 'Uzaktan destek izni verildi' : 'Uzaktan destek izni kapatıldı', ...(c.on ? {} : { priority: 'low' as const }) }); x.audit.push({ action: c.on ? 'support.access_on' : 'support.access_off', target: c.tenant, at, by: 'cafe' }); } });
  }
  access(tenant: string) {
    const r = this.store.db.prepare('SELECT install, support, since, seen FROM relay_tenants WHERE tenant=?').get(tenant) as { install: string; support: number; since: string | null; seen: string } | undefined;
    return r ? { on: !!r.support, since: r.support ? r.since : null, seenAt: r.seen, install: r.install } : null;
  }
  forgetPhone(phone: string) { this.store.db.prepare('DELETE FROM relay_phones WHERE phone=?').run(phone); this.box.prepare('DELETE FROM postbox WHERE phone=?').run(phone); }
  poll(install: string, secret: string, nonce: string, res: Response) {
    this.lastPoll.set(install, this.now().getTime());
    // A second poll of the same café (a restarted server) replaces the first one.
    const old = this.waiters.get(install);
    if (old) { clearTimeout(old.timer); this.waiters.delete(install); this.answer(old, []); }
    const queue = this.queues.get(install) ?? [];
    if (queue.length) { this.queues.delete(install); if (queue.length > 20) this.queues.set(install, queue.slice(20)); this.answer({ install, res, secret, nonce }, queue.slice(0, 20)); return; }
    const waiter: Waiter = { install, res, secret, nonce, timer: setTimeout(() => { if (this.waiters.get(install) === waiter) this.waiters.delete(install); this.answer(waiter, []); }, RELAY.HOLD_MS) };
    waiter.timer!.unref?.();
    this.waiters.set(install, waiter);
    res.on('close', () => { if (this.waiters.get(install) === waiter) { clearTimeout(waiter.timer); this.waiters.delete(install); } });
  }
  private sendSigned?: Deps['sendSigned'];
  private answer(w: Waiter, requests: RelayRequest[]) {
    this.lastPoll.set(w.install, this.now().getTime());
    if (w.res.headersSent || w.res.writableEnded) return;
    try { this.sendSigned!(w.res, w.secret, w.nonce, { requests }); } catch { /* the café went away */ }
  }
  hasBox(phone: string) { return !!this.box.prepare('SELECT 1 FROM postbox WHERE phone=?').get(phone); }
  /** Hands one request to the café that owns `install` and waits for its reply. */
  send(install: string, request: RelayCall, timeout: number = RELAY.REQUEST_TIMEOUT_MS): Promise<RelayReply> {
    if (!this.online(install)) return Promise.reject(new DomainError('CAFE_OFFLINE', 'İşletmenin bilgisayarı şu anda Mola Merkez’e bağlı değil.', 503));
    const id = randomUUID(), full = { ...request, id } as RelayRequest;
    return new Promise<RelayReply>((done, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); const q = this.queues.get(install); if (q) this.queues.set(install, q.filter(r => r.id !== id)); fail(new DomainError('CAFE_TIMEOUT', 'İşletmenin bilgisayarı yanıt vermedi. Biraz sonra yeniden deneyin.', 504)); }, timeout);
      timer.unref?.();
      this.pending.set(id, { install, done, fail, timer, ...('session' in request && request.kind === 'http' ? { session: request.session } : {}) });
      const waiter = this.waiters.get(install);
      if (waiter) { clearTimeout(waiter.timer); this.waiters.delete(install); this.answer(waiter, [full]); return; }
      const queue = this.queues.get(install) ?? [];
      if (queue.length >= RELAY.MAX_QUEUE) { clearTimeout(timer); this.pending.delete(id); fail(new DomainError('CAFE_BUSY', 'İşletmenin bilgisayarına çok fazla istek bekliyor. Biraz sonra yeniden deneyin.', 503)); return; }
      queue.push(full); this.queues.set(install, queue);
    });
  }
  reply(install: string, body: z.infer<typeof replyBody>) {
    const p = this.pending.get(body.id);
    if (!p || p.install !== install) return false;
    clearTimeout(p.timer); this.pending.delete(body.id);
    p.done({ status: body.status, ...(body.json !== undefined ? { json: body.json } : {}), ...(body.body !== undefined ? { body: body.body } : {}), ...(body.type ? { type: body.type } : {}), ...(body.tag ? { tag: body.tag } : {}) });
    return true;
  }
  // ---------- Phones ----------
  pairing(install: string, tenant: string, pairId: string, expiresAt: string) {
    const t = this.now().getTime(), until = Math.min(Date.parse(expiresAt) || 0, t + RELAY.PAIRING_MS);
    if (until <= t) throw new DomainError('INVALID', 'Süre geçersiz.', 400);
    for (const [id, p] of this.pairings) if (p.tenant === tenant) this.pairings.delete(id);
    this.pairings.set(pairId, { install, tenant, expiresAt: until });
  }
  pairingOf(pairId: string) { const p = this.pairings.get(pairId); return p && p.expiresAt > this.now().getTime() ? p : undefined; }
  usedPairing(pairId: string) { this.pairings.delete(pairId); }
  addPhone(phone: string, install: string, tenant: string) {
    const token = randomBytes(32).toString('base64url');
    this.store.db.prepare('INSERT OR REPLACE INTO relay_phones (phone,tenant,install,token,created,seen) VALUES (?,?,?,?,?,NULL)').run(phone, tenant, install, hash(token), this.now().toISOString());
    return token;
  }
  phone(phone: string, token: string) {
    const r = this.store.db.prepare('SELECT phone, tenant, install, token FROM relay_phones WHERE phone=?').get(phone) as { phone: string; tenant: string; install: string; token: string } | undefined;
    if (!r || !same(r.token, hash(token))) throw new DomainError('PHONE_UNKNOWN', 'Bu cihaz eşleştirilmemiş ya da eşleşmesi kaldırılmış. Kafede Ayarlar → Uzaktan erişim’den yeniden eşleştirin.', 403);
    this.store.db.prepare('UPDATE relay_phones SET seen=? WHERE phone=?').run(this.now().toISOString(), phone);
    return r;
  }
  putBoxes(install: string, items: z.infer<typeof postboxBody>['items'], d: MerkezData) {
    const mine = new Set(d.businesses.filter(b => b.installId === install).map(b => b.tenantId));
    let kept = 0;
    for (const { tenantId, phoneId: phone, box } of items) {
      const row = this.store.db.prepare('SELECT tenant, install FROM relay_phones WHERE phone=?').get(phone) as { tenant: string; install: string } | undefined;
      if (!mine.has(tenantId) || !row || row.tenant !== tenantId || row.install !== install || box.phone !== phone || box.kind !== 'snapshot') continue;
      const text = JSON.stringify(box);
      if (text.length > RELAY.MAX_BOX_BYTES * 4 / 3 + 512) continue;
      this.box.prepare('INSERT OR REPLACE INTO postbox (phone,tenant,install,at,box,created) VALUES (?,?,?,?,?,?)').run(phone, tenantId, install, box.at, text, this.now().getTime());
      kept++;
    }
    return kept;
  }
  /** The phone's box, removed as it is handed over (the phone keeps it). */
  takeBox(phone: string) {
    const r = this.box.prepare('SELECT box FROM postbox WHERE phone=?').get(phone) as { box: string } | undefined;
    if (r) this.box.prepare('DELETE FROM postbox WHERE phone=?').run(phone);
    return r ? JSON.parse(r.box) : null;
  }
  // ---------- Support sessions ----------
  async startSession(tenant: string, install: string, name: string) {
    const access = this.access(tenant);
    if (!access?.on || access.install !== install) throw new DomainError('SUPPORT_OFF', 'İşletme sahibi uzaktan destek izni vermedi. İzni işletmenin bilgisayarında Destek → Mola desteği’nden açabilir.', 409);
    if (!this.online(install)) throw new DomainError('CAFE_OFFLINE', 'İşletmenin bilgisayarı şu anda Mola Merkez’e bağlı değil. Bilgisayar açık ve internete bağlı olmalı.', 409);
    for (const s of [...this.sessions.values()]) if (s.tenant === tenant) this.endSession(s.id, 'vendor', false);
    const id = randomUUID(), secret = randomBytes(32).toString('base64url');
    const reply = await this.send(install, { kind: 'support.start', tenantId: tenant, session: id }, 10_000);
    if (reply.status !== 200) { const j = (reply.json ?? {}) as { code?: string; message?: string }; throw new DomainError(j.code ?? 'SUPPORT_REFUSED', j.message ?? 'İşletmenin bilgisayarı bağlantıyı kabul etmedi.', 409); }
    const t = this.now().getTime(), at = new Date(t).toISOString();
    this.sessions.set(id, { id, tenant, install, secret: hash(secret), startedAt: t, lastAt: t, requests: 0 });
    this.store.db.prepare('INSERT INTO support_sessions (id,tenant,started) VALUES (?,?,?)').run(id, tenant, at);
    this.store.mutate(d => { d.audit.push({ action: 'support.session_started', target: tenant, at, by: 'admin' }); addAlert(d, at, 'support.session', `${name}: Mola destek oturumu başladı.`, { tenantId: tenant, title: 'Destek oturumu başladı', priority: 'low' }); });
    return { id, cookie: `${id}.${secret}` };
  }
  endSession(id: string, why: 'vendor' | 'owner' | 'off' | 'timeout' | 'restart', tellCafe: boolean) {
    const s = this.sessions.get(id); if (!s) return false;
    this.sessions.delete(id);
    // Screen requests of this session still waiting for the café end now ("Destek oturumu kapandı"), not after the timeout.
    for (const [rid, p] of [...this.pending]) if (p.session === id) {
      clearTimeout(p.timer); this.pending.delete(rid);
      const q = this.queues.get(p.install); if (q) this.queues.set(p.install, q.filter(r => r.id !== rid));
      p.fail(new DomainError('SUPPORT_ENDED', 'Destek oturumu kapandı. Mola Yönetim’den yeniden bağlanın.', 401));
    }
    const at = this.now().toISOString();
    this.store.db.prepare('UPDATE support_sessions SET ended=?, ended_by=?, requests=? WHERE id=?').run(at, why, s.requests, id);
    try {
      const name = this.store.read().businesses.find(b => b.tenantId === s.tenant)?.name ?? 'İşletme';
      this.store.mutate(d => { d.audit.push({ action: 'support.session_ended', target: s.tenant, at, by: why === 'vendor' ? 'admin' : why === 'timeout' ? 'system' : 'cafe', detail: { vendor: 'Mola ekibi kapattı', owner: 'İşletme sahibi kesti', off: 'İzin kapatıldı', timeout: '30 dakika işlem yok', restart: 'Yeniden başlatma' }[why] }); addAlert(d, at, 'support.session', `${name}: Mola destek oturumu bitti (${why === 'off' ? 'işletme sahibi izni kapattı' : why === 'owner' ? 'işletme sahibi kesti' : why === 'timeout' ? '30 dakika işlem yapılmadı' : 'Mola ekibi kapattı'}).`, { tenantId: s.tenant, title: 'Destek oturumu bitti', priority: 'low' }); });
    } catch { /* closing */ }
    if (tellCafe && this.online(s.install)) void this.send(s.install, { kind: 'support.end', tenantId: s.tenant, session: id, reason: why === 'timeout' ? 'timeout' : 'vendor' }, 10_000).catch(() => {});
    return true;
  }
  /** The live session a browser's cookie names (secret checked), or undefined. */
  sessionFor(cookie: string | undefined) {
    const [id, secret] = (cookie ?? '').split('.'); const s = id ? this.sessions.get(id) : undefined;
    return s && secret && same(s.secret, hash(secret)) ? s : undefined;
  }
  active(tenant: string) { const s = [...this.sessions.values()].find(x => x.tenant === tenant); return s ? { id: s.id, startedAt: new Date(s.startedAt).toISOString(), lastAt: new Date(s.lastAt).toISOString(), requests: s.requests } : null; }
  history(tenant: string) { return (this.store.db.prepare('SELECT id, started, ended, ended_by, requests FROM support_sessions WHERE tenant=? ORDER BY started DESC LIMIT 20').all(tenant) as { id: string; started: string; ended: string | null; ended_by: string | null; requests: number }[]).map(r => ({ id: r.id, startedAt: r.started, endedAt: r.ended, endedBy: r.ended_by, requests: r.requests })); }
  phones(tenant: string) { return (this.store.db.prepare('SELECT COUNT(*) AS n FROM relay_phones WHERE tenant=?').get(tenant) as { n: number }).n; }
  attach(sendSigned: Deps['sendSigned']) { this.sendSigned = sendSigned; }
}

/** Screen requests passed to the café in a support session (the café checks them again, exactly). */
const RELAYED = /^\/(api\/(health|contact|logout|staff\/[A-Za-z0-9/_-]{1,200})|media\/[A-Za-z0-9_-]{1,100}\/[a-f0-9-]{36}(-small)?\.webp)$/;
/** Relayed answers never run anything on Merkez's origin (a page opened from one is sandboxed, no script, no form). */
export const RELAYED_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
const RELAYED_TYPES = /^(application\/json|image\/(webp|png|jpeg)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|text\/csv|text\/plain)(;|$)/i;
/** The café's answer type when it is one a screen asks for; HTML only for the printable report; anything else is bytes. */
export function relayedType(type: string, path: string) {
  if (RELAYED_TYPES.test(type)) return type;
  if (/^text\/html(;|$)/i.test(type) && path === '/api/staff/reports/document') return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}
async function rawBody(req: Request, max: number) {
  const parts: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += (chunk as Buffer).length; if (size > max) throw new DomainError('TOO_LARGE', 'İstek çok büyük.', 413); parts.push(chunk as Buffer); }
  return Buffer.concat(parts);
}

/**
 * Registered before the JSON-only rule and the 64 kB parser (relayed bodies may be photos, held polls must not be parsed
 * twice). Café-facing routes are HMAC-signed like /sync; phone routes are public and limited; admin routes need Mola Yönetim.
 */
export function relayRoutes(app: Express, deps: () => Deps, hub: RelayHub) {
  const raw = express.json({ limit: '10mb', verify: (req, _res, buf) => { (req as Request & { rawBody?: Buffer }).rawBody = buf; } });
  app.use(`${MERKEZ_API}/relay`, raw);
  app.use(`${MERKEZ_API}/phone`, express.json({ limit: '16kb' }));
  /** The calling café (signed) and the businesses it holds. */
  const cafe = (req: Request, purpose: string, max: number) => {
    const { authenticate, limitAddress, limitInstall, store } = deps();
    limitAddress(req, `relay-${purpose}`, max * 2, 60_000);
    const caller = authenticate(req);
    limitInstall(caller.install.id, `relay-${purpose}`, max, 60_000);
    if (caller.closed) throw new DomainError('RECORD_CLOSED', 'Bu işletmenin Mola kaydı kapatıldı.', 409);
    return { ...caller, d: store.read() };
  };
  app.post(`${MERKEZ_API}/relay/poll`, (req, res) => {
    const { install, nonce, d } = cafe(req, 'poll', 120), b = stateBody.parse(req.body);
    hub.tenants(install.id, b.tenants, d, true);
    hub.poll(install.id, install.secret, nonce, res);
  });
  app.post(`${MERKEZ_API}/relay/state`, (req, res) => {
    const { install, nonce, d } = cafe(req, 'state', 30), b = stateBody.parse(req.body);
    hub.tenants(install.id, b.tenants, d);
    deps().sendSigned(res, install.secret, nonce, { ok: true });
  });
  app.post(`${MERKEZ_API}/relay/reply`, (req, res) => {
    const { install, nonce } = cafe(req, 'reply', 600), b = replyBody.parse(req.body);
    deps().sendSigned(res, install.secret, nonce, { ok: hub.reply(install.id, b) });
  });
  app.post(`${MERKEZ_API}/relay/pairing`, (req, res) => {
    const { install, nonce, d } = cafe(req, 'pairing', 10), b = pairingBody.parse(req.body);
    if (!d.businesses.some(x => x.tenantId === b.tenantId && x.installId === install.id)) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
    hub.pairing(install.id, b.tenantId, b.pairId, b.expiresAt);
    deps().sendSigned(res, install.secret, nonce, { ok: true });
  });
  app.post(`${MERKEZ_API}/relay/postbox`, (req, res) => {
    const { install, nonce, d } = cafe(req, 'postbox', 30), b = postboxBody.parse(req.body);
    deps().sendSigned(res, install.secret, nonce, { ok: true, kept: hub.putBoxes(install.id, b.items, d) });
  });

  // ---------- The owner's phone (public; the phone proves itself with its token, the café with its own keys) ----------
  const phoneLimits = (req: Request, purpose: string, max: number) => deps().limitAddress(req, `phone-${purpose}`, max, 60_000);
  app.post(`${MERKEZ_API}/phone/pair`, async (req, res) => {
    phoneLimits(req, 'pair', 20);
    const r = pairRequestSchema.parse(req.body), p = hub.pairingOf(r.pairId);
    if (!p) throw new DomainError('PAIRING_EXPIRED', 'Eşleştirme kodunun süresi doldu ya da kullanıldı. Kafede Ayarlar → Uzaktan erişim’den yeniden eşleştirin.', 410);
    hub.take(`pair:${r.pairId}`, 8, 10 * 60_000);
    const reply = await hub.send(p.install, { kind: 'pair', tenantId: p.tenant, request: r }, 15_000);
    const j = (reply.json ?? {}) as { ok?: boolean; phoneId?: string; business?: string; confirm?: string; code?: string; message?: string };
    if (reply.status !== 200 || !j.ok || !phoneId.safeParse(j.phoneId).success) { res.status(reply.status === 200 ? 502 : reply.status).json({ code: j.code ?? 'PAIRING_FAILED', message: j.message ?? 'Eşleştirme tamamlanamadı.' }); return; }
    hub.usedPairing(r.pairId);
    const token = hub.addPhone(j.phoneId!, p.install, p.tenant);
    deps().store.mutate(d => { d.audit.push({ action: 'remote.phone_paired', target: p.tenant, at: deps().now().toISOString(), by: 'cafe' }); });
    res.json({ ok: true, phoneId: j.phoneId, business: j.business, confirm: j.confirm, token });
  });
  const phoneBody = z.object({ phoneId, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
  app.post(`${MERKEZ_API}/phone/live`, async (req, res) => {
    phoneLimits(req, 'live', 120);
    const b = phoneBody.extend({ request: liveRequestSchema }).strict().parse(req.body), p = hub.phone(b.phoneId, b.token);
    hub.take(`live:${b.phoneId}`, 30, 60_000);
    if (!hub.online(p.install)) { res.json({ offline: true, seenAt: hub.seenAt(p.install), waiting: hub.hasBox(b.phoneId) }); return; }
    const reply = await hub.send(p.install, { kind: 'phone', tenantId: p.tenant, phoneId: b.phoneId, request: b.request }, 12_000).catch((e: DomainError) => ({ status: e.status, json: { code: e.code, message: e.message } }) as RelayReply);
    if (reply.status === 504 || reply.status === 503) { res.json({ offline: true, seenAt: hub.seenAt(p.install), waiting: hub.hasBox(b.phoneId) }); return; }
    res.status(reply.status).json(reply.json ?? {});
  });
  app.post(`${MERKEZ_API}/phone/postbox`, (req, res) => {
    phoneLimits(req, 'postbox', 120);
    const b = phoneBody.strict().parse(req.body), p = hub.phone(b.phoneId, b.token);
    hub.take(`box:${b.phoneId}`, 30, 60_000);
    res.json({ box: hub.takeBox(b.phoneId), online: hub.online(p.install), seenAt: hub.seenAt(p.install) });
  });

  // ---------- Mola Yönetim ----------
  app.get('/api/merkez/admin/support-sessions', (req, res) => {
    const { admin, store } = deps(); admin(req);
    const tenant = tenantIdSchema.parse(req.query.tenantId), b = store.read().businesses.find(x => x.tenantId === tenant);
    if (!b) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
    const access = hub.access(tenant);
    res.json({ access: access ? { on: access.on, since: access.since, seenAt: access.seenAt } : null, online: !!b.installId && hub.online(b.installId), active: hub.active(tenant), history: hub.history(tenant), phones: hub.phones(tenant) });
  });
  // These routes come before Merkez's own JSON parser: they bring a small one of their own.
  const json = express.json({ limit: '16kb' });
  app.post('/api/merkez/admin/support-sessions', json, async (req, res) => {
    const { admin, store } = deps(); admin(req);
    const { tenantId } = z.object({ tenantId: tenantIdSchema }).strict().parse(req.body), b = store.read().businesses.find(x => x.tenantId === tenantId);
    if (!b?.installId) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
    if (b.suspended) throw new DomainError('SUSPENDED', 'Askıdaki işletmeye bağlanılamaz.', 409);
    const s = await hub.startSession(tenantId, b.installId, b.name);
    res.cookie(SUPPORT_COOKIE, s.cookie, { ...sessionCookie(req), maxAge: RELAY.SESSION_MAX_MS });
    res.json({ sessionId: s.id, url: `/destek/${s.id}` });
  });
  app.post('/api/merkez/admin/support-sessions/end', json, (req, res) => {
    const { admin } = deps(); admin(req);
    const { tenantId } = z.object({ tenantId: tenantIdSchema }).strict().parse(req.body);
    const s = hub.active(tenantId); if (s) hub.endSession(s.id, 'vendor', true);
    res.clearCookie(SUPPORT_COOKIE, sessionCookie(req));
    res.json({ ok: true });
  });
  // "Raporlarım": the owner's phone page (raporlarim.html; on a VDS only over HTTPS, the WebCrypto keys need a secure page).
  app.get(/^\/raporlarim\/?$/, (_req, res, next) => { res.locals.molaPage = 'raporlarim.html'; next(); });
  // The café's screens for this session (index.html of this Merkez's build; runtime.ts serves the page named in res.locals).
  app.get(/^\/destek\/[0-9a-f-]{36}\/?$/, (req, res, next) => {
    const s = hub.sessionFor(cookieOf(req, SUPPORT_COOKIE));
    if (!s || !req.path.includes(s.id)) { res.status(403).type('text/plain; charset=utf-8').send('Destek oturumu kapandı. Mola Yönetim’de işletmenin Destek bölümünden yeniden bağlanın.'); return; }
    res.locals.molaPage = 'index.html'; next();
  });
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (!RELAYED.test(req.path) || !['GET', 'POST'].includes(req.method)) return next();
    const cookie = cookieOf(req, SUPPORT_COOKIE);
    if (cookie === undefined) return next();
    const s = hub.sessionFor(cookie);
    if (!s) { if (req.path.startsWith('/api/')) throw new DomainError('SUPPORT_ENDED', 'Destek oturumu kapandı. Mola Yönetim’den yeniden bağlanın.', 401); res.status(404).end(); return; }
    hub.take(`support:${s.id}`, 600, 60_000);
    s.lastAt = deps().now().getTime(); s.requests++;
    if (req.path === '/api/logout' && req.method === 'POST') { hub.endSession(s.id, 'vendor', true); res.clearCookie(SUPPORT_COOKIE, sessionCookie(req)); res.json({ ok: true }); return; }
    const body = req.method === 'POST' ? await rawBody(req, 9 * 1024 * 1024) : undefined;
    const headers: Record<string, string> = {};
    for (const h of RELAY_HEADERS) { const v = req.get(h); if (v && v.length <= 200) headers[h] = v; }
    const reply = await hub.send(s.install, { kind: 'http', tenantId: s.tenant, session: s.id, method: req.method, path: req.originalUrl, headers, ...(body?.length ? { body: body.toString('base64') } : {}) });
    // İşlem kayıtları: every change made in a support session, as the screen's request and its answer (never its content).
    if (req.method === 'POST') try {
      const store = deps().store, name = store.read().businesses.find(b => b.tenantId === s.tenant)?.name;
      store.journal.append({ action: 'support.action', actor: { kind: 'admin', id: 'admin', name: 'Yönetici (uzaktan destek)' }, target: { kind: 'business', id: s.tenant, ...(name ? { name } : {}) }, business: { id: s.tenant, ...(name ? { name } : {}) },
        detail: `Oturum ${s.id.slice(0, 8)} · ${req.method} ${req.path.slice(0, 200)} → ${reply.status}`, result: reply.status < 400 ? 'basarili' : reply.status === 403 ? 'reddedildi' : 'basarisiz' });
    } catch { /* the record is secondary to the answer */ }
    const code = (reply.json as { code?: string } | undefined)?.code;
    if (reply.status === 401 && (code === 'SUPPORT_ENDED' || reply.type?.includes('json'))) {
      let ended = code === 'SUPPORT_ENDED';
      if (!ended && reply.body) try { ended = JSON.parse(Buffer.from(reply.body, 'base64').toString('utf8')).code === 'SUPPORT_ENDED'; } catch { /* not JSON */ }
      if (ended) hub.endSession(s.id, 'off', false);
    }
    res.status(reply.status);
    if (req.path.startsWith('/media/')) {
      if (reply.status !== 200 || !reply.body || reply.type !== 'image/webp') { res.status(404).end(); return; }
      res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' }).end(Buffer.from(reply.body, 'base64')); return;
    }
    if (reply.tag) res.set('X-Mola-Tag', reply.tag);
    // Güvenlik denetimi: these answers come from the café yet are shown on Mola Yönetim's own origin. Nothing in them may run
    // there: only known types (HTML only for the printable report), never sniffed, a sandbox CSP on every answer.
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': RELAYED_CSP });
    if (reply.json !== undefined) { res.json(reply.json); return; }
    if (reply.type) res.type(relayedType(reply.type, req.path));
    res.end(reply.body ? Buffer.from(reply.body, 'base64') : undefined);
  });
}
