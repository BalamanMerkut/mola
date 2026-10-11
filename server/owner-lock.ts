import type { Express, Request } from 'express';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import type { Actor, State } from '../packages/domain/types.js';
import type { Session } from './sessions.js';
import type { Store } from './store.js';

/*
 * Sahip hesabı otomatik kilit. An owner's signed-in session locks itself after N minutes without user activity (Ayarlar →
 * Güvenlik ve diğer: 5 / 10 / 30 dk / Kapalı; default 10), or at once with "Kilitle". The lock lives on the server session
 * (server/sessions.ts `locked`, `activeAt`), so it holds on every tab of that browser and survives a restart; it is not a
 * logout: the page and its drafts stay underneath the lock screen (src/OwnerLock.tsx).
 *   Activity  Only requests the person made: the screens send `X-Mola-Activity: 1` within a few seconds of a real tap, click
 *             or key (src/activity.ts); background polling never does, so a screen left open still locks.
 *   Locked    Every /api/staff call of that session answers 423 SESSION_LOCKED, except what keeps the floor ringing and
 *             the lock itself: GET state, me, shifts/me, sounds, lock; POST heartbeat, lock, unlock. Every answer carries
 *             `X-Mola-Locked: 1`, so an open screen shows the lock within one poll.
 *   Unlock    The owner's password (POST /api/staff/unlock; wrong attempts count on the login limiter, server/app.ts).
 * Only the owner role: Müdür, kasiyer, garson and mutfak sessions are never touched.
 */
export const OWNER_LOCK_CHOICES = [5, 10, 30, 0] as const;
export const OWNER_LOCK_DEFAULT = 10;
export const lockMinutes = (s: Pick<State, 'ownerLockMinutes'>) => (OWNER_LOCK_CHOICES as readonly number[]).includes(s.ownerLockMinutes ?? -1) ? s.ownerLockMinutes! : OWNER_LOCK_DEFAULT;
export const ACTIVITY_HEADER = 'X-Mola-Activity';
const WHILE_LOCKED: [string, RegExp][] = [['GET', /^\/staff\/(state|me|shifts\/me|sounds|lock)$/], ['POST', /^\/staff\/(heartbeat|lock|unlock)$/]];
export const lockedWhileAllowed = (method: string, path: string) => WHILE_LOCKED.some(([m, p]) => m === method.toUpperCase() && p.test(path));
const LOCKED = 'Sahip hesabı kilitlendi. Devam etmek için şifrenizi girin.';

export type SessionHandle = { session: Session; save: () => void };
type Options = {
  now: () => Date;
  /** The signed-in staff session of this request (cookie), with a way to write it now. */
  sessionOf: (req: Request) => SessionHandle | undefined;
  actorFor: (req: Request) => Actor;
  confirmPassword: (req: Request, actor: Actor, password: string | undefined) => Promise<void>;
};

/** Registered before every /api/staff route (server/app.ts). */
export function ownerLock(app: Express, store: Store, o: Options) {
  // Unit tests (NODE_TEST_CONTEXT) move their clocks by hours and days: there the lock is on only where a test turned it on.
  const minutesOf = (tenant: string) => { try { const s = store.read(tenant); return s.ownerLockMinutes === undefined && process.env.NODE_TEST_CONTEXT ? 0 : lockMinutes(s); } catch { return OWNER_LOCK_DEFAULT; } };
  const owner = (h: SessionHandle | undefined) => h && h.session.actor.role === 'owner' ? h : undefined;
  app.use('/api', (req, res, next) => {
    if (!req.path.startsWith('/staff/')) return next();
    const h = owner(o.sessionOf(req)); if (!h) return next();
    const s = h.session, t = o.now().getTime(), minutes = minutesOf(s.actor.tenantId);
    // A session from before this feature starts counting now.
    s.activeAt ??= t;
    if (!s.locked && minutes > 0 && t - s.activeAt >= minutes * 60_000) { s.locked = true; h.save(); }
    if (s.locked) {
      res.setHeader('X-Mola-Locked', '1');
      return lockedWhileAllowed(req.method, req.path) ? next() : next(new DomainError('SESSION_LOCKED', LOCKED, 423));
    }
    if (req.get(ACTIVITY_HEADER) === '1') s.activeAt = t;
    next();
  });
  const view = (h: SessionHandle | undefined, tenant: string) => ({ locked: !!h?.session.locked, minutes: minutesOf(tenant), choices: OWNER_LOCK_CHOICES });
  /** The lock screen and Ayarlar read this; any role may ask (only the owner is ever locked). */
  app.get('/api/staff/lock', (req, res) => { const a = o.actorFor(req), h = owner(o.sessionOf(req)); res.json(a.role === 'owner' ? view(h, a.tenantId) : { locked: false, minutes: 0, choices: [] }); });
  /** "Kilitle": the owner locks this session at once. */
  app.post('/api/staff/lock', (req, res) => {
    const a = o.actorFor(req); requireRole(store.read(a.tenantId), a, ['owner']);
    const h = owner(o.sessionOf(req)); if (!h) throw new DomainError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403);
    if (!h.session.locked) { h.session.locked = true; h.save(); }
    res.setHeader('X-Mola-Locked', '1'); res.json(view(h, a.tenantId));
  });
  app.post('/api/staff/unlock', async (req, res) => {
    const a = o.actorFor(req); requireRole(store.read(a.tenantId), a, ['owner']);
    const { password } = z.object({ password: z.string().max(200).optional() }).strict().parse(req.body ?? {});
    await o.confirmPassword(req, a, password);
    const h = owner(o.sessionOf(req)); if (!h) throw new DomainError('UNAUTHORIZED', 'Lütfen çalışan hesabınızla giriş yapın.', 401);
    h.session.locked = false; h.session.activeAt = o.now().getTime(); h.save();
    res.json(view(h, a.tenantId));
  });
  /** A tap or a key while reading (no other request): keeps the owner's session open. The middleware above records it. */
  app.post('/api/staff/activity', (req, res) => { o.actorFor(req); res.json({ ok: true }); });
  /** Ayarlar → Güvenlik ve diğer → "Sahip hesabı otomatik kilit". */
  app.post('/api/staff/lock/settings', (req, res) => {
    const a = o.actorFor(req), { minutes } = z.object({ minutes: z.number().int() }).strict().parse(req.body);
    if (!(OWNER_LOCK_CHOICES as readonly number[]).includes(minutes)) throw new DomainError('INVALID_VALUE', 'Süre 5, 10 ya da 30 dakika olabilir ya da kilit kapalı.', 400);
    store.mutate(a.tenantId, s => { requireRole(s, a, ['owner']); s.ownerLockMinutes = minutes; s.audit.push({ action: 'owner_lock.changed', actor: a.id, target: String(minutes), at: o.now().toISOString() }); });
    res.json(view(owner(o.sessionOf(req)), a.tenantId));
  });
}
