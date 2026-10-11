import type { Express, Request } from 'express';
import { ExpiringStore } from './expiring-store.js';
import { staffToken } from './sessions.js';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { passwordMatches } from './accounts.js';
import { base32, verifyTotp } from './totp.js';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import type { Actor, State } from '../packages/domain/types.js';
import type { Store } from './store.js';
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
export function reportSecurity(app: Express, store: Store, actorFor: (r: Request) => Actor, now: () => Date) {
  const clock = () => now().getTime();
  const grants = new ExpiringStore<{ until: number; secret: string }>(v => v.until, clock, 10000);
  const pending = new ExpiringStore<{ secret: string; until: number }>(v => v.until, clock, 10000);
  const attempts = new ExpiringStore<{ count: number; until: number }>(v => v.until, clock, 10000);
  const wrong = new ExpiringStore<{ count: number; until: number; waitUntil: number }>(v => v.until, clock, 10000), WRONG_PER_DAY = 50;
  function owner(req: Request) { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner']); return a; }
  // İki ekran: the pane's own sign-in (server/sessions.ts staffToken), written as `mola_staff=<token>` for every pane.
  function session(req: Request, a: Actor) { const token = staffToken(req); return digest(`${a.tenantId}:${a.id}:${token ? `mola_staff=${token}` : ''}`); }
  function attempt(a: Actor) { const k = a.tenantId + ':' + a.id, t = now().getTime(), v = attempts.get(k); const next = !v || v.until <= t ? { count: 0, until: t + 60000 } : v; next.count++; attempts.set(k, next); if (next.count > 8) throw new DomainError('RATE_LIMIT', 'Bir dakika sonra tekrar deneyin.', 429); }
  /** Reports are read by the owner and the Müdür; setting the code up, and resetting it, stay with the owner. */
  function reader(req: Request) { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner', 'manager']); return a; }
  /** Whose code opens the reports: the owner's own; a Müdür types an owner's code (any active owner who turned it on). */
  function codeHolders(s: State, a: Actor) { const users = s.staffUsers ?? []; return a.role === 'owner' ? users.filter(u => u.id === a.id) : users.filter(u => u.role === 'owner' && u.active); }
  function status(req: Request) {
    const a = reader(req), secrets = codeHolders(store.read(a.tenantId), a).flatMap(u => u.mfa ? [u.mfa.secret] : []), grant = grants.get(session(req, a));
    return { enabled: secrets.length > 0, verified: !secrets.length || !!grant && grant.until > now().getTime() && secrets.includes(grant.secret), until: grant?.until ?? null, ...(a.role === 'owner' ? {} : { owner: false }) };
  }
  // Sahibin uzaktan yönetimi (server/remote-admin.ts): the remote login just checked the owner's code, so that session's
  // reports open without asking it again (10 minutes, like a code typed here). Keyed exactly like `session()`.
  app.locals.reportGrant = (tenant: string, userId: string, token: string, secret: string) => grants.set(digest(`${tenant}:${userId}:mola_staff=${token}`), { secret, until: now().getTime() + 600000 });
  function guard(req: Request) { if (!status(req).verified) throw new DomainError('MFA_REQUIRED', 'Mali raporlar için doğrulama kodunu girin.', 403); }
  app.get('/api/staff/report-security', (req, res) => res.json(status(req)));
  app.post('/api/staff/report-security/setup', async (req, res) => {
    let a = owner(req); attempt(a); const { password } = z.object({ password: z.string().max(128) }).parse(req.body);
    const u = store.read(a.tenantId).staffUsers!.find(u => u.id === a.id)!;
    if (u.mfa) throw new DomainError('MFA_ENABLED', 'Doğrulama zaten açık.', 409);
    if (!await passwordMatches(password, u)) throw new DomainError('INVALID_PASSWORD', 'Şifre yanlış.', 403);
    a = owner(req); const secret = base32(randomBytes(20)); pending.set(session(req, a), { secret, until: now().getTime() + 600000 });
    res.json({ secret, uri: `otpauth://totp/${encodeURIComponent(`Mola:${u.username}`)}?secret=${secret}&issuer=Mola&algorithm=SHA1&digits=6&period=30` });
  });
  app.post('/api/staff/report-security/enable', (req, res) => {
    const a = owner(req); attempt(a); const { code } = z.object({ code: z.string().max(6) }).parse(req.body), key = session(req, a), p = pending.get(key);
    if (!p || p.until <= now().getTime()) throw new DomainError('MFA_SETUP_EXPIRED', 'Kurulumu yeniden başlatın.', 409);
    const step = verifyTotp(p.secret, code, now().getTime()); if (step === null) throw new DomainError('INVALID_CODE', 'Kod yanlış veya süresi dolmuş.', 403);
    const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(16).toString('hex'));
    store.mutate(a.tenantId, s => { const u = s.staffUsers!.find(u => u.id === a.id)!; if (u.mfa) throw new DomainError('MFA_ENABLED', 'Doğrulama zaten açık.', 409); u.mfa = { secret: p.secret, lastStep: step, recoveryHashes: recoveryCodes.map(digest) }; s.audit.push({ action: 'mfa.enabled', actor: a.id, target: a.id, at: now().toISOString() }); });
    pending.delete(key); grants.set(key, { secret: p.secret, until: now().getTime() + 600000 }); res.json({ recoveryCodes });
  });
  app.post('/api/staff/report-security/verify', (req, res) => {
    const a = reader(req); attempt(a); const { code } = z.object({ code: z.string().max(6) }).parse(req.body);
    // Güvenlik denetimi: wrong codes add up for a day per person (a Müdür guessing the owner's code 8 times a minute would find
    // one within weeks): after 5, each try waits twice as long (1, 2, 4 … at most 15 minutes); 50 in a day close it until tomorrow.
    const k = `${a.tenantId}:${a.id}`, t = clock(), w = wrong.get(k);
    if (w && w.until > t && w.count >= WRONG_PER_DAY) throw new DomainError('RATE_LIMIT', 'Bugün çok fazla yanlış kod yazıldı. Yarın yeniden deneyin ya da işletme sahibine haber verin.', 429);
    if (w && w.waitUntil > t) throw new DomainError('RATE_LIMIT', `Çok fazla yanlış kod. ${Math.ceil((w.waitUntil - t) / 60000)} dakika sonra yeniden deneyin.`, 429);
    let secret: string;
    try { secret = store.mutate(a.tenantId, s => {
      const holders = codeHolders(s, a).filter(u => u.mfa);
      if (!holders.length) throw new DomainError('MFA_DISABLED', a.role === 'owner' ? 'Önce doğrulamayı kurun.' : 'Raporlar kodla korunmuyor.', 409);
      for (const u of holders) {
        const m = u.mfa!, step = verifyTotp(m.secret, code, now().getTime(), m.lastStep);
        if (step === null) continue;
        m.lastStep = step;
        if (a.role !== 'owner') s.audit.push({ action: 'mfa.manager_verified', actor: a.id, target: u.id, at: now().toISOString() });
        return m.secret;
      }
      throw new DomainError('INVALID_CODE', 'Kod yanlış, kullanılmış veya süresi dolmuş. Yeni kodu bekleyin.', 403);
    }); } catch (e) {
      if (e instanceof DomainError && e.code === 'INVALID_CODE') {
        const v = w && w.until > t ? w : { count: 0, until: t + 86400_000, waitUntil: 0 };
        v.count++; if (v.count >= 5) v.waitUntil = t + Math.min(15 * 60_000, 60_000 * 2 ** (v.count - 5)); wrong.set(k, v);
      }
      throw e;
    }
    wrong.delete(k);
    grants.set(session(req, a), { secret, until: now().getTime() + 600000 }); res.json({ ok: true });
  });
  app.post('/api/staff/report-security/recover', async (req, res) => {
    let a = owner(req); attempt(a); const b = z.object({ password: z.string().max(128), recoveryCode: z.string().length(32) }).parse(req.body);
    const u = store.read(a.tenantId).staffUsers!.find(u => u.id === a.id)!;
    if (!await passwordMatches(b.password, u)) throw new DomainError('INVALID_PASSWORD', 'Şifre yanlış.', 403);
    a = owner(req); store.mutate(a.tenantId, s => { const user = s.staffUsers!.find(u => u.id === a.id)!; if (!user.mfa?.recoveryHashes.includes(digest(b.recoveryCode))) throw new DomainError('INVALID_CODE', 'Kurtarma kodu geçersiz.', 403); delete user.mfa; s.audit.push({ action: 'mfa.recovered', actor: a.id, target: a.id, at: now().toISOString() }); });
    grants.delete(session(req, a)); res.json({ ok: true });
  });
  app.use('/api/staff/reports', (req, _res, next) => { try { guard(req); next(); } catch (e) { next(e); } });
  app.use('/api/staff/payment-adjustments', (req, _res, next) => { try { guard(req); next(); } catch (e) { next(e); } });
  return guard;
}
