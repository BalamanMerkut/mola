import { createHmac, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { addDays, businessDay, dayStart } from '../packages/domain/business-day.js';
import { DomainError } from '../packages/domain/engine.js';
import type { Actor } from '../packages/domain/types.js';
import { open, seal } from './sealing.js';

/**
 * Signed-in staff devices and guest QR sessions, kept in the store database so a restart or a power cut does not sign every
 * tablet out ("Kalıcı ama günde bir giriş"). Only a keyed hash of each token is stored, never the token; the rest is sealed
 * with the data key. Staff sessions end at the next business-day start (05:00 Türkiye), guest ones after their usual hours.
 * The live copy is a bounded map in memory (lookups never touch the disk); writes happen on login, logout and rarely on use.
 */
/** `activeAt` / `locked`: the owner's idle lock (server/owner-lock.ts): the last user activity and whether the session is locked. */
/** `remote`: a remote owner session (server/remote-admin.ts), usable only through its own sealed tunnel. */
export type Session = { actor: Actor; expires: number; browser?: string; userVersion?: number; id?: string; createdAt?: number; seenAt?: number; device?: string; activeAt?: number; locked?: boolean; remote?: string };
type Kind = 'staff' | 'guest';
/**
 * When this business day ends: the start of the next one, DAY_START_HOUR (05:00) Türkiye time. The same constant as the
 * kasa günü and every report (packages/domain/business-day.ts), so a sign-in never outlives the day it was made in.
 */
export function businessDayEnd(now: number) {
  return dayStart(addDays(businessDay(now), 1));
}
/** A short, human label of the device for the owner's "Açık oturumlar" list; no address or identifier is kept. */
export function deviceLabel(agent = '') {
  const os = /iPad/.test(agent) ? 'iPad' : /iPhone/.test(agent) ? 'iPhone' : /Android/.test(agent) ? (/Mobile/.test(agent) ? 'Android telefon' : 'Android tablet') : /Windows/.test(agent) ? 'Windows' : /Mac OS X|Macintosh/.test(agent) ? 'Mac' : /Linux/.test(agent) ? 'Linux' : 'Bilinmeyen cihaz';
  const browser = /Edg\//.test(agent) ? 'Edge' : /OPR\//.test(agent) ? 'Opera' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : '';
  return browser ? `${os} · ${browser}` : os;
}
const SEEN_WRITE_MS = 10 * 60_000;

/**
 * İki ekran (src/SplitView.tsx): the café computer's Mola window can show two Mola screens side by side, each with its own
 * sign-in. Cookies are shared by every frame of one origin, so each pane names itself on every call (`X-Mola-Pane`, checked
 * by server/desktop.ts `paneGuard`, which leaves the pane in `res.locals.staffPane`) and gets a cookie of its own: pane 1 (and
 * every ordinary window, tablet and phone) `mola_staff`, pane 2 `mola_staff_p2`. Same flags (HttpOnly, SameSite=Strict), same
 * book, same 05:00 end; logging out of one pane clears only that pane's cookie.
 */
export type StaffPane = 1 | 2;
export const STAFF_COOKIE = 'mola_staff';
type WithPane = { headers: { cookie?: string }; res?: { locals: Record<string, unknown> } };
export function staffCookieName(req: WithPane) { return req.res?.locals.staffPane === 2 ? `${STAFF_COOKIE}_p2` : STAFF_COOKIE; }
/** The staff session token of this request's pane (undefined without one). */
export function staffToken(req: WithPane) {
  const name = `${staffCookieName(req)}=`;
  const found = (req.headers.cookie ?? '').split(';').map(c => c.trim()).find(c => c.startsWith(name));
  return found ? found.slice(name.length) || undefined : undefined;
}

export class SessionBook {
  private live = new Map<string, Session>();
  private written = new Map<string, number>();
  private sweptAt = -Infinity;
  constructor(private db: DatabaseSync, private key: Buffer, private kind: Kind, private now: () => number, private capacity: number) {
    db.exec('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, kind TEXT NOT NULL, expires INTEGER NOT NULL, payload BLOB NOT NULL); CREATE INDEX IF NOT EXISTS sessions_kind ON sessions(kind, expires)');
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now());
    // Oldest first, so the map's order is the eviction order again; a row that does not open (other key, damage) is dropped.
    for (const row of db.prepare('SELECT token, payload FROM sessions WHERE kind=? ORDER BY rowid').all(kind) as { token: string; payload: Uint8Array }[]) {
      try { this.live.set(row.token, open<Session>(Buffer.from(row.payload), key, `session:${kind}:${row.token}`)); this.written.set(row.token, now()); }
      catch { db.prepare('DELETE FROM sessions WHERE token=?').run(row.token); }
    }
    while (this.live.size > capacity) this.remove(this.live.keys().next().value!);
  }
  private hash(token: string) { return createHmac('sha256', this.key).update(`mola:session:${this.kind}:v1\0`).update(token).digest('hex'); }
  private write(hash: string, s: Session) {
    this.db.prepare('INSERT INTO sessions (token, kind, expires, payload) VALUES (?,?,?,?) ON CONFLICT(token) DO UPDATE SET expires=excluded.expires, payload=excluded.payload').run(hash, this.kind, s.expires, seal(s, this.key, `session:${this.kind}:${hash}`));
    this.written.set(hash, this.now());
  }
  private remove(hash: string) { this.live.delete(hash); this.written.delete(hash); this.db.prepare('DELETE FROM sessions WHERE token=?').run(hash); }
  /** Expired entries go from memory and disk at most every 30 s, driven by traffic like ExpiringStore. */
  private sweep() {
    const t = this.now();
    if (t - this.sweptAt < 30_000 && t >= this.sweptAt) return;
    this.sweptAt = t;
    for (const [hash, s] of this.live) if (s.expires <= t) { this.live.delete(hash); this.written.delete(hash); }
    this.db.prepare('DELETE FROM sessions WHERE kind=? AND expires <= ?').run(this.kind, t);
  }
  get(token: string | undefined) {
    if (!token || token.length > 200) return undefined;
    this.sweep();
    const hash = this.hash(token), s = this.live.get(hash);
    if (s && s.expires <= this.now()) { this.remove(hash); return undefined; }
    return s;
  }
  /** Last use, for the owner's list; written to disk at most every 10 minutes per session. */
  touch(token: string) {
    const hash = this.hash(token), s = this.live.get(hash), t = this.now();
    if (!s) return;
    s.seenAt = t;
    if (t - (this.written.get(hash) ?? 0) >= SEEN_WRITE_MS) this.write(hash, s);
  }
  /** Writes the session at once (locking and unlocking must survive a restart). */
  save(token: string) { const hash = this.hash(token), s = this.live.get(hash); if (s) this.write(hash, s); }
  set(token: string, s: Session) {
    if (!Number.isFinite(s.expires)) throw new Error('Geçersiz oturum süresi.');
    this.sweep();
    const hash = this.hash(token);
    if (s.expires <= this.now()) { this.remove(hash); return; }
    // A full pool drops its oldest session instead of refusing everyone (same rule as before the sessions were kept on disk).
    if (!this.live.has(hash) && this.live.size >= this.capacity) this.remove(this.live.keys().next().value!);
    if (this.live.size >= this.capacity) throw new DomainError('SESSION_CAPACITY', 'Sistem şu anda yoğun. Kısa süre sonra yeniden deneyin.', 503);
    this.live.set(hash, s); this.write(hash, s);
  }
  delete(token: string | undefined) { if (token && token.length <= 200) this.remove(this.hash(token)); }
  /** Sessions matching `which`, oldest first, with the private key to end one of them (never the token). */
  list(which: (s: Session) => boolean) { this.sweep(); return [...this.live].filter(([, s]) => s.expires > this.now() && which(s)).map(([hash, s]) => ({ hash, session: s })); }
  end(hash: string) { if (this.live.has(hash)) { this.remove(hash); return true; } return false; }
  isCurrent(hash: string, token: string | undefined) { return !!token && token.length <= 200 && this.hash(token) === hash; }
  get size() { this.sweep(); return this.live.size; }
}
