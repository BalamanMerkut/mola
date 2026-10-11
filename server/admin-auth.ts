import type { Express, Request } from 'express';
import { createHmac, randomBytes, randomInt, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../packages/domain/engine.js';
import { weakAdminPassword } from '../packages/domain/admin-password.js';
import { consumeAdminFactor, recoveryHash, type AdminFactor } from './admin-factor.js';
import { ExpiringStore } from './expiring-store.js';
import { AttemptLimiter } from './key-vault.js';
import { clientKey, loopbackRequest, sessionCookie } from './http-security.js';
import { base32, verifyTotp } from './totp.js';

/*
 * The vendor's admin account (Mola Yönetim, on Merkez): one "admin" user, scrypt password, optional TOTP with recovery codes.
 * Moved here from the café's old in-process platform panel (server/platform.ts, archived).
 * `n`: scrypt cost of this record (missing: the old 2^15). New passwords use 2^17; an older record is re-hashed at the next
 * successful login. `mustChange`: the generated first password (merkez-first-login.txt) must be replaced before anything else.
 */
export type AdminRecord = { salt: string; hash: string; n?: number; mfa?: AdminFactor; mustChange?: boolean };
/** Reads the record; `change` runs inside the owner's transaction and may replace `holder.admin` or add audit lines. */
export type AdminAccount = { read(): AdminRecord; change<T>(fn: (holder: { admin: AdminRecord }, audit: (action: string, detail?: string) => void) => T): T };
/**
 * How a forgotten password was proven: the Merkez recovery code (Ayarlar → Yedek), one of the MFA backup codes, or a 6-digit
 * code sent to the admin e-mail ("E-postama kod gönder").
 */
export type ResetProof = 'merkez' | 'mfa' | 'email';
/**
 * "Şifremi unuttum" (Mola Yönetim): without a session. The code paths only where `allowed` says (the Merkez computer itself,
 * no proxy). `recoveryCode`: whether a code is the Merkez recovery code (a malformed one throws INVALID_CODE); missing: that
 * proof is off. `email`: the e-mail path, wherever the panel itself is reachable (HTTPS with PUBLIC_ORIGIN, else this
 * computer); `ready` false (no SMTP settings) turns it off entirely. `done`: after the change (Bildirim merkezi, e-mail);
 * `second`: what was asked besides the e-mail code when two-step login is on.
 */
export type ResetOptions = {
  allowed: (req: Request) => boolean; recoveryCode?: (code: string) => Promise<boolean>;
  email?: { ready: () => boolean; address: () => string | undefined; send: (to: string, code: string) => Promise<void> };
  done?: (how: { proof: ResetProof; mfaReset: boolean; second?: 'totp' | 'merkez' }) => void;
};
export const ADMIN_N = 2 ** 17;
/** Tests only (merkez-fixture sets it, a release build drops it): a cheaper cost, so dozens of logins stay fast under load. */
export const adminN = () => { const n = process.env.MOLA_RELEASE_BUILD === '1' ? 0 : Number(process.env.MOLA_TEST_ADMIN_SCRYPT_N); return n >= 1024 && n <= ADMIN_N && (n & (n - 1)) === 0 ? n : ADMIN_N; };
const params = (N: number) => ({ N, r: 8, p: 1, maxmem: 128 * N * 8 + 32 * 1024 * 1024 });
const derive = (password: string, salt: string, N: number) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, params(N), (e, key) => e ? reject(e) : resolve(key)));
export async function adminRecord(password: string): Promise<Pick<AdminRecord, 'salt' | 'hash' | 'n'>> {
  const salt = randomBytes(16).toString('hex'); const n = adminN(); return { salt, hash: (await derive(password, salt, n)).toString('hex'), n };
}
export async function adminMatches(password: string, record: Pick<AdminRecord, 'salt' | 'hash' | 'n'>) {
  const value = await derive(password, record.salt, record.n ?? 2 ** 15), expected = Buffer.from(record.hash, 'hex');
  return value.length === expected.length && timingSafeEqual(value, expected);
}
/** A generated password must be changed at the first login; one given by the caller (tests, scripted setup) is known already. */
export function newAdmin(password?: string) {
  const plain = password ?? randomBytes(18).toString('base64url'), salt = randomBytes(16).toString('hex'), n = adminN();
  return { password: plain, admin: { salt, hash: scryptSync(plain, salt, 32, params(n)).toString('hex'), n, ...(password ? {} : { mustChange: true }) } as AdminRecord };
}
/** `weakWords`: more words a password must not be made of (Mola Merkez: the businesses' names). */
/**
 * Security events for a tamper-evident record (Mola Merkez's İşlem kayıtları): sign-in, a wrong password or code, a refusal
 * for too many tries, sign-out, a failed check inside a session, a failed "Şifremi unuttum" proof. Never a password or code.
 */
export type AuthEvent = { kind: 'login' | 'login_failed' | 'login_refused' | 'logout' | 'password_change_failed' | 'check_failed' | 'reset_failed'; req: Request; detail?: string };
type Options = { prefix: string; cookie: string; label: string; issuer: string; now: () => Date; onPasswordChanged?: () => void; weakWords?: () => string[]; reset?: ResetOptions; onEvent?: (event: AuthEvent) => void };
type Counter = { count: number; until: number; last: number };
const MINUTE = 60_000, WINDOW = 15 * MINUTE, MAX_DELAY = 15 * MINUTE, DEVICE_DAYS = 90;
export function adminAuthRoutes(app: Express, account: AdminAccount, o: Options) {
  const { prefix, cookie, now } = o, deviceCookie = `${cookie}_cihaz`;
  const sessions = new ExpiringStore<number>(expires => expires, () => now().getTime(), 1000);
  const setups = new ExpiringStore<{ secret: string; hashes: string[]; hash: string; until: number }>(v => v.until, () => now().getTime(), 1000);
  // Wrong passwords per address (IPv6 per /64) in their own pool; the account-wide counters are plain fields nothing can evict.
  const addressFailures = new ExpiringStore<Counter>(v => v.until, () => now().getTime(), 5000, true);
  let accountFailures: Counter = { count: 0, until: 0, last: 0 }, mfaFailures: Counter = { count: 0, until: 0, last: 0 };
  const cookieOf = (req: Request, name: string) => (req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
  /**
   * "Known device": a browser that signed in before carries a signed mark (tied to the current password). Account-wide slowing
   * never applies to it or to this computer itself, so strangers guessing from many addresses cannot lock the real vendor out.
   */
  const deviceMac = (issued: string, hash: string) => createHmac('sha256', Buffer.from(hash, 'hex')).update(`mola-cihaz:v1:${issued}`).digest('base64url');
  function knownDevice(req: Request) {
    const [issued, mac] = (cookieOf(req, deviceCookie) ?? '').split('.'), hash = account.read().hash;
    if (!issued || !mac || !/^\d{10,16}$/.test(issued) || now().getTime() - Number(issued) > DEVICE_DAYS * 86400_000) return false;
    const expected = Buffer.from(deviceMac(issued, hash)), given = Buffer.from(mac);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
  /** After `free` failures each further try waits twice as long since the last failure (1 s, 2 s, 4 s … at most 15 min). */
  const wait = (c: Counter | undefined, free: number, t: number) => !c || c.until <= t || c.count < free ? 0 : Math.max(0, c.last + Math.min(MAX_DELAY, 1000 * 2 ** (c.count - free)) - t);
  const fail = (c: Counter | undefined, t: number): Counter => c && c.until > t ? { count: c.count + 1, until: t + WINDOW, last: t } : { count: 1, until: t + WINDOW, last: t };
  const slow = (ms: number) => new DomainError('RATE_LIMIT', `Çok fazla yanlış deneme. ${ms > 90_000 ? `${Math.ceil(ms / 60_000)} dakika` : `${Math.ceil(ms / 1000)} saniye`} sonra tekrar deneyin.`, 429);
  function admin(req: Request, options: { evenIfMustChange?: boolean } = {}) {
    const token = cookieOf(req, cookie);
    if (!token || (sessions.get(token) ?? 0) <= now().getTime()) throw new DomainError('UNAUTHORIZED', `${o.label} hesabıyla giriş yapın.`, 401);
    if (!options.evenIfMustChange && account.read().mustChange) throw new DomainError('PASSWORD_CHANGE_REQUIRED', 'Devam etmek için önce ilk şifreyi değiştirin.', 403);
    return token;
  }
  const clear = (req: Request, res: { clearCookie: (name: string, options: object) => void }) => res.clearCookie(cookie, sessionCookie(req, prefix));
  const emit = (kind: AuthEvent['kind'], req: Request, detail?: string) => { try { o.onEvent?.({ kind, req, ...(detail ? { detail } : {}) }); } catch { /* the record is secondary to the answer */ } };
  app.post(`${prefix}/login`, async (req, res) => {
    const b = z.object({ username: z.literal('admin'), password: z.string().max(128), code: z.string().max(32).optional() }).parse(req.body);
    const key = clientKey(req), t = now().getTime(), local = loopbackRequest(req), trusted = local || knownDevice(req);
    // Per address: 5 free tries, then an ever longer wait (this computer too, so a script cannot hammer it).
    const mine = wait(addressFailures.get(key), 5, t);
    if (mine) { emit('login_refused', req); throw slow(mine); }
    // Account-wide (many addresses together): from 20 failures on, slowed for strangers only.
    const overall = trusted ? 0 : wait(accountFailures, 20, t);
    if (overall) { emit('login_refused', req, 'hesap genelinde'); throw slow(overall); }
    const failed = (error: DomainError) => { addressFailures.set(key, fail(addressFailures.get(key), t)); if (!local) accountFailures = fail(accountFailures, t); return error; };
    const credential = account.read();
    if (!await adminMatches(b.password, credential) || account.read().hash !== credential.hash) { emit('login_failed', req, 'Şifre yanlış'); throw failed(new DomainError('INVALID_LOGIN', 'Giriş bilgileri yanlış.', 401)); }
    // Authenticator codes: 5 wrong ones in 15 minutes and strangers wait (a stolen password does not open a code-guessing run).
    if (credential.mfa && b.code && !trusted) { const m = wait(mfaFailures, 5, t); if (m) { emit('login_refused', req, 'iki adımlı kod denemeleri'); throw slow(m); } }
    try {
      account.change((p, audit) => {
        if (p.admin.hash !== credential.hash) throw new DomainError('INVALID_LOGIN', 'Giriş bilgileri değişti. Yeniden deneyin.', 401);
        if (p.admin.mfa && consumeAdminFactor(p.admin.mfa, b.code, now().getTime()) === 'recovery') audit('admin.mfa_recovery_used');
      });
    } catch (e) { if (e instanceof DomainError && e.code === 'INVALID_CODE') { emit('login_failed', req, 'Şifre doğru, iki adımlı giriş kodu yanlış'); if (!local) mfaFailures = fail(mfaFailures, t); throw failed(e); } throw e; }
    addressFailures.delete(key);
    emit('login', req, credential.mfa ? 'şifre + iki adımlı kod' : 'şifre');
    // An older, cheaper hash is replaced now that the password is known to be right.
    if ((credential.n ?? 2 ** 15) < adminN()) {
      const upgraded = await adminRecord(b.password);
      try { account.change(p => { if (p.admin.hash === credential.hash) p.admin = { ...p.admin, ...upgraded }; }); } catch { /* next login */ }
    }
    const current = account.read(), token = randomBytes(32).toString('hex'); sessions.set(token, now().getTime() + 4 * 3600000);
    const issued = String(now().getTime());
    res.cookie(cookie, token, { ...sessionCookie(req, prefix), maxAge: 4 * 3600000 });
    res.cookie(deviceCookie, `${issued}.${deviceMac(issued, current.hash)}`, { ...sessionCookie(req, prefix), maxAge: DEVICE_DAYS * 86400_000 });
    res.json({ ok: true, ...(current.mustChange ? { mustChangePassword: true } : {}) });
  });
  /*
   * Password and Authenticator checks inside a session (şifre değiştir, iki adımlı giriş aç/kapat, kurtarma kodu): only WRONG
   * answers count, per account and address (IPv6 per /64), never the right ones and never other addresses. Five are free,
   * then each try waits twice as long (1 s, 2 s … at most 15 min), so a typo followed by the right code just works and a
   * guessing run still stops.
   */
  const checkFailures = new ExpiringStore<Counter>(v => v.until, () => now().getTime(), 5000, true);
  const checkKey = (req: Request) => `admin:${clientKey(req)}`;
  function guarded(req: Request) {
    const k = checkKey(req), t = now().getTime(), w = wait(checkFailures.get(k), 5, t);
    if (w) throw slow(w);
    return {
      /** Counts a wrong password or code and gives the error back to throw. `quiet`: the caller writes its own record line. */
      failed: (error: DomainError, quiet = false) => { checkFailures.set(k, fail(checkFailures.get(k), now().getTime())); if (!quiet) emit(req.path.endsWith('/password') ? 'password_change_failed' : 'check_failed', req, req.path.slice(prefix.length + 1)); return error; },
      passed: () => { checkFailures.delete(k); },
    };
  }
  /** Not a secret check (a test e-mail): at most 5 a minute from one address. */
  const sends = new ExpiringStore<Counter>(v => v.until, () => now().getTime(), 5000, true);
  function throttle(req: Request) {
    const k = checkKey(req), t = now().getTime(), c = sends.get(k);
    const next = c && c.until > t ? { ...c, count: c.count + 1 } : { count: 1, until: t + MINUTE, last: t };
    sends.set(k, next);
    if (next.count > 5) throw new DomainError('RATE_LIMIT', 'Bir dakika sonra tekrar deneyin.', 429);
  }
  /** Weak passwords are refused with what to change (first password, a change, any reset). */
  const strong = (password: string) => { const problem = weakAdminPassword(password, o.weakWords?.() ?? []); if (problem) throw new DomainError('WEAK_PASSWORD', problem, 400); };
  app.post(`${prefix}/password`, async (req, res) => {
    admin(req, { evenIfMustChange: true });
    const b = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().max(128) }).strict().parse(req.body);
    const check = guarded(req);
    const old = account.read();
    if (!await adminMatches(b.currentPassword, old)) throw check.failed(new DomainError('INVALID_PASSWORD', 'Mevcut şifre yanlış.', 400));
    check.passed();
    if (b.currentPassword === b.newPassword) throw new DomainError('SAME_PASSWORD', 'Yeni şifre mevcut şifreden farklı olmalı.', 400);
    strong(b.newPassword);
    const credential = await adminRecord(b.newPassword);
    admin(req, { evenIfMustChange: true });
    account.change((p, audit) => {
      if (p.admin.hash !== old.hash) throw new DomainError('VERSION_CONFLICT', 'Şifre başka bir oturumda değişti. Yeniden giriş yapın.', 409);
      p.admin = { ...credential, ...(p.admin.mfa ? { mfa: p.admin.mfa } : {}) };
      audit('admin.password_changed');
    });
    sessions.clear(); setups.clear();
    o.onPasswordChanged?.();
    clear(req, res); res.json({ ok: true });
  });
  app.post(`${prefix}/logout`, (req, res) => { const token = admin(req, { evenIfMustChange: true }); sessions.delete(token); emit('logout', req); clear(req, res); res.json({ ok: true }); });
  app.get(`${prefix}/mfa`, (req, res) => { admin(req, { evenIfMustChange: true }); const m = account.read().mfa; res.json({ enabled: !!m, recoveryRemaining: m?.recoveryHashes.length ?? 0 }); });
  app.post(`${prefix}/mfa/setup`, async (req, res) => {
    admin(req); const check = guarded(req); const b = z.object({ password: z.string().max(128) }).parse(req.body), credential = account.read();
    if (!await adminMatches(b.password, credential)) throw check.failed(new DomainError('INVALID_PASSWORD', 'Şifre yanlış.', 403));
    check.passed();
    const token = admin(req), current = account.read();
    if (current.hash !== credential.hash) throw new DomainError('VERSION_CONFLICT', 'Hesap değişti. Yeniden giriş yapın.', 409);
    if (current.mfa) throw new DomainError('MFA_ENABLED', 'İki adımlı giriş zaten açık.', 409);
    const secret = base32(randomBytes(20)), recoveryCodes = Array.from({ length: 8 }, () => randomBytes(16).toString('hex'));
    setups.set(token, { secret, hashes: recoveryCodes.map(recoveryHash), hash: current.hash, until: now().getTime() + 600000 });
    const issuer = encodeURIComponent(o.issuer);
    res.json({ secret, recoveryCodes, uri: `otpauth://totp/${issuer}:admin?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` });
  });
  app.post(`${prefix}/mfa/enable`, (req, res) => {
    const token = admin(req), check = guarded(req); const b = z.object({ code: z.string().length(6), saved: z.literal(true) }).parse(req.body), setup = setups.get(token);
    if (!setup) throw new DomainError('MFA_SETUP_EXPIRED', 'Kurulumu yeniden başlatın.', 409);
    const step = verifyTotp(setup.secret, b.code, now().getTime());
    if (step === null) throw check.failed(new DomainError('INVALID_CODE', 'Doğrulama kodu geçersiz.', 403));
    check.passed();
    account.change((p, audit) => {
      if (p.admin.mfa || p.admin.hash !== setup.hash) throw new DomainError('VERSION_CONFLICT', 'Güvenlik ayarı değişti. Yeniden giriş yapın.', 409);
      p.admin.mfa = { secret: setup.secret, lastStep: step, recoveryHashes: setup.hashes };
      audit('admin.mfa_enabled');
    });
    setups.clear(); sessions.clear(); clear(req, res); res.json({ ok: true });
  });
  app.post(`${prefix}/mfa/disable`, async (req, res) => {
    admin(req); const check = guarded(req); const b = z.object({ password: z.string().max(128), code: z.string().max(32) }).parse(req.body), credential = account.read();
    if (!await adminMatches(b.password, credential)) throw check.failed(new DomainError('INVALID_PASSWORD', 'Şifre yanlış.', 403));
    admin(req);
    try {
      account.change((p, audit) => {
        if (p.admin.hash !== credential.hash || !p.admin.mfa) throw new DomainError('VERSION_CONFLICT', 'Güvenlik ayarı değişti.', 409);
        consumeAdminFactor(p.admin.mfa, b.code, now().getTime()); delete p.admin.mfa;
        audit('admin.mfa_disabled');
      });
    } catch (e) { if (e instanceof DomainError && e.code === 'INVALID_CODE') throw check.failed(e); throw e; }
    check.passed();
    setups.clear(); sessions.clear(); clear(req, res); res.json({ ok: true });
  });

  /*
   * "Şifremi unuttum": only on the Merkez computer itself (o.reset.allowed), with ONE proof of ownership:
   *   merkez  the Merkez recovery code (Ayarlar → Yedek, 24 characters): it opens Merkez's own key (scrypt, constant-time).
   *   mfa     one unused MFA backup code (used up by the reset).
   * Step 1 (/reset/verify) checks the proof and gives a 10-minute ticket for this address; step 2 (/reset/complete) sets the
   * new password (the same strength rule). With MFA on and the Merkez code as proof, a current Authenticator code is needed
   * too, unless the vendor lost it: "Doğrulayıcıyı da sıfırla" turns MFA off. Every admin session ends. Wrong codes: per
   * address 5 free, then doubling waits (like the login); 20 across all addresses; the Merkez code also one try at a time
   * and at most 5 wrong in 10 minutes (AttemptLimiter, like the café's recovery code). Answers never say whether MFA is on
   * before a proof passed.
   */
  const resets = new ExpiringStore<{ proof: ResetProof; key: string; hash: string; backup?: string; until: number }>(v => v.until, () => now().getTime(), 100, true);
  const resetFailures = new ExpiringStore<Counter>(v => v.until, () => now().getTime(), 5000, true);
  let resetAccount: Counter = { count: 0, until: 0, last: 0 };
  const recoveryAttempts = new AttemptLimiter(5, 10 * MINUTE, () => now().getTime());
  const notHere = () => new DomainError('LOCAL_ONLY', 'Şifre sıfırlama yalnız Mola Merkez’in çalıştığı bilgisayarda, o bilgisayardaki tarayıcıdan yapılır.', 403);
  const wrongProof = () => new DomainError('WRONG_CODE', 'Kod doğrulanamadı. Harf harf kontrol edin; yedek kodlar bir kez kullanılır.', 403);
  /** `local`: the code paths (this computer only); the e-mail path is checked by the panel's own reachability rule. */
  function resetGuard(req: Request, local = true) {
    if (local && !o.reset?.allowed(req)) throw notHere();
    const k = `reset:${clientKey(req)}`, t = now().getTime(), w = Math.max(wait(resetFailures.get(k), 5, t), wait(resetAccount, 20, t));
    if (w) throw slow(w);
    return {
      key: k,
      failed: (error: DomainError) => { const at = now().getTime(); resetFailures.set(k, fail(resetFailures.get(k), at)); resetAccount = fail(resetAccount, at); emit('reset_failed', req, req.path.slice(prefix.length + 1)); return error; },
      passed: () => { resetFailures.delete(k); },
    };
  }
  /** Whether an MFA backup code is still unused: every stored hash is compared (constant-time), none is used up yet. */
  const backupLeft = (factor: AdminFactor | undefined, code: string) => {
    const given = Buffer.from(recoveryHash(code), 'hex'); let found = false;
    for (const hash of factor?.recoveryHashes ?? []) { const stored = Buffer.from(hash, 'hex'); if (stored.length === given.length && timingSafeEqual(stored, given)) found = true; }
    return found;
  };
  app.get(`${prefix}/reset`, (req, res) => { res.json({ available: !!o.reset?.allowed(req), recoveryCode: !!o.reset?.recoveryCode, email: !!o.reset?.email?.ready() }); });

  /*
   * "E-postama kod gönder" (also on a VDS, over HTTPS): the vendor types the account name and the admin e-mail address. Only
   * when both are right a 6-digit code (15 minutes, single use, 5 wrong tries end it, a newer one replaces it) is sent to that
   * address; the answer is the same either way, so nobody learns the account or the address. Sends are counted on what was
   * typed, never on whether it matched: per address (IPv6 /64) and account name 3 per 15 minutes, per address 10 an hour, all
   * together 30 an hour. The code is kept only as an HMAC with a key of this process (a restart ends it). Then the usual
   * ticket; with two-step login on, the Authenticator code is needed too (or the Merkez recovery code instead).
   */
  const codeKey = randomBytes(32), codeMac = (code: string) => createHmac('sha256', codeKey).update(`mola-eposta-kodu:v1:${code}`).digest();
  let emailCode: { mac: Buffer; until: number; tries: number; hash: string; address: string } | undefined;
  const sendCounts = new ExpiringStore<Counter>(v => v.until, () => now().getTime(), 5000, true);
  let sendOverall: Counter = { count: 0, until: 0, last: 0 };
  const countSend = (c: Counter | undefined, t: number, ms: number): Counter => c && c.until > t ? { ...c, count: c.count + 1, last: t } : { count: 1, until: t + ms, last: t };
  const tooMany = () => new DomainError('RATE_LIMIT', 'Çok sık kod istendi. Bir süre sonra yeniden deneyin; son gelen kod 15 dakika geçerlidir.', 429);
  const emailOff = () => new DomainError('EMAIL_RESET_OFF', 'E-postayla sıfırlama kapalı: Mola Yönetim’de e-posta (SMTP) ayarları yapılmamış. Merkez kurtarma kodunu ya da Sifre-Sifirla komutunu kullanın.', 409);
  const sameText = (a: string, b: string) => { const x = Buffer.from(a.trim().toLowerCase()), y = Buffer.from(b.trim().toLowerCase()); return x.length === y.length && timingSafeEqual(x, y); };
  app.post(`${prefix}/reset/email/send`, (req, res) => {
    const mail = o.reset?.email;
    if (!mail?.ready()) throw emailOff();
    const b = z.object({ username: z.string().trim().min(1).max(64), email: z.string().trim().min(3).max(200) }).strict().parse(req.body);
    const t = now().getTime(), ip = clientKey(req), pair = `send:${ip}:${b.username.toLowerCase()}`, one = `send:${ip}`;
    const next = { pair: countSend(sendCounts.get(pair), t, WINDOW), one: countSend(sendCounts.get(one), t, 60 * MINUTE), all: countSend(sendOverall, t, 60 * MINUTE) };
    sendCounts.set(pair, next.pair); sendCounts.set(one, next.one); sendOverall = next.all;
    if (next.pair.count > 3 || next.one.count > 10 || next.all.count > 30) throw tooMany();
    const target = mail.address(), code = String(randomInt(0, 1_000_000)).padStart(6, '0'), mac = codeMac(code);
    if (b.username.toLowerCase() === 'admin' && target && sameText(target, b.email)) {
      emailCode = { mac, until: t + 15 * MINUTE, tries: 0, hash: account.read().hash, address: target };
      // Not awaited: the answer must not take longer when the address is the right one.
      void mail.send(target, code).catch(() => {});
    }
    res.json({ ok: true, minutes: 15 });
  });
  app.post(`${prefix}/reset/email/verify`, (req, res) => {
    if (!o.reset?.email?.ready()) throw emailOff();
    const guard = resetGuard(req, false);
    const b = z.object({ username: z.string().trim().min(1).max(64), email: z.string().trim().min(3).max(200), code: z.string().max(16) }).strict().parse(req.body);
    const code = b.code.replace(/[\s-]/g, '');
    if (!/^\d{6}$/.test(code)) throw new DomainError('INVALID_CODE', 'E-postadaki kod 6 rakamdan oluşur.', 400);
    const c = emailCode, current = account.read(), given = codeMac(code);
    const right = !!c && c.until > now().getTime() && c.hash === current.hash && b.username.toLowerCase() === 'admin' && sameText(c.address, b.email) && timingSafeEqual(given, c.mac);
    if (!right) {
      if (c && ++c.tries >= 5) emailCode = undefined;
      throw guard.failed(new DomainError('WRONG_CODE', 'Kod yanlış ya da süresi doldu. E-postadaki son kodu yazın ya da yeni kod isteyin.', 403));
    }
    emailCode = undefined; guard.passed();
    const ticket = randomBytes(32).toString('hex');
    resets.set(ticket, { proof: 'email', key: guard.key, hash: current.hash, until: now().getTime() + 10 * MINUTE });
    res.json({ ticket, needsAuthenticator: !!current.mfa });
  });
  app.post(`${prefix}/reset/verify`, async (req, res) => {
    const guard = resetGuard(req);
    const b = z.object({ proof: z.enum(['merkez', 'mfa']), code: z.string().trim().min(1).max(64) }).strict().parse(req.body);
    const before = account.read();
    if (b.proof === 'merkez') await merkezCode(b.code, guard);
    else {
      const code = b.code.toLowerCase().replace(/[\s-]/g, '');
      if (!/^[a-f0-9]{32}$/.test(code)) throw new DomainError('INVALID_CODE', 'Yedek kod 32 harf ve rakamdan oluşur (0–9 ve a–f). İki adımlı girişi açarken kaydettiğiniz kodlardan birini yazın.', 400);
      if (!backupLeft(before.mfa, code)) throw guard.failed(wrongProof());
      b.code = code;
    }
    guard.passed();
    const ticket = randomBytes(32).toString('hex');
    resets.set(ticket, { proof: b.proof, key: guard.key, hash: before.hash, ...(b.proof === 'mfa' ? { backup: b.code } : {}), until: now().getTime() + 10 * MINUTE });
    res.json({ ticket, needsAuthenticator: b.proof === 'merkez' && !!before.mfa });
  });
  /** The Merkez recovery code (one try at a time, 5 wrong per 10 minutes); a wrong one counts for the address too. */
  async function merkezCode(code: string, guard: ReturnType<typeof resetGuard>) {
    const check = o.reset?.recoveryCode;
    if (!check) throw new DomainError('RESET_OFF', 'Merkez kurtarma kodu bu çalıştırmada kullanılamıyor. İki adımlı doğrulamanın yedek kodunu ya da Sifre-Sifirla komutunu kullanın.', 409);
    try { await recoveryAttempts.run(async () => { if (!await check(code)) throw wrongProof(); }); }
    catch (e) {
      if (e instanceof DomainError && e.code === 'WRONG_CODE') throw guard.failed(e);
      if (e instanceof DomainError && e.code === 'RATE_LIMIT') throw e;
      // A malformed code (wrong length, letters that are never used) costs nothing and is said plainly.
      if (e instanceof DomainError && e.code === 'INVALID_CODE') throw new DomainError('INVALID_CODE', 'Merkez kurtarma kodu 24 harf ve rakamdan oluşur (ör. ABCD-EFGH-…). Ayarlar → Yedek’te gösterilen kodu kontrol edin.', 400);
      throw e;
    }
  }
  app.post(`${prefix}/reset/complete`, async (req, res) => {
    const b = z.object({ ticket: z.string().regex(/^[a-f0-9]{64}$/), newPassword: z.string().max(128), code: z.string().trim().max(32).optional(), recoveryCode: z.string().trim().max(64).optional(), resetAuthenticator: z.boolean().optional() }).strict().parse(req.body);
    const ticket = resets.get(b.ticket);
    // An e-mail ticket finishes wherever it began (HTTPS on a VDS); the code paths only on this computer.
    const guard = resetGuard(req, ticket?.proof !== 'email');
    if (!ticket || ticket.key !== guard.key) throw new DomainError('RESET_EXPIRED', 'Bu sıfırlamanın süresi doldu. Kodu yeniden girin.', 409);
    strong(b.newPassword);
    const current = account.read();
    if (current.hash !== ticket.hash) { resets.delete(b.ticket); throw new DomainError('VERSION_CONFLICT', 'Şifre bu arada değişti. Kodu yeniden girin.', 409); }
    let step: number | null = null, second: 'totp' | 'merkez' | undefined, mfaReset = false;
    const totpStep = (code: string | undefined, missing: string) => {
      if (!code) throw new DomainError('AUTHENTICATOR_REQUIRED', missing, 400);
      const found = verifyTotp(current.mfa!.secret, code, now().getTime(), current.mfa!.lastStep);
      if (found === null) throw guard.failed(new DomainError('INVALID_CODE', 'Doğrulayıcı kodu yanlış veya süresi dolmuş. Uygulamadaki yeni kodu bekleyip yazın.', 403));
      return found;
    };
    if (ticket.proof === 'email') {
      // The owner's choice: an e-mail alone never resets a password protected by two-step login.
      if (current.mfa && b.recoveryCode) { await merkezCode(b.recoveryCode, guard); second = 'merkez'; mfaReset = b.resetAuthenticator === true; }
      else if (current.mfa) { step = totpStep(b.code, 'İki adımlı giriş açık: doğrulayıcı uygulamadaki 6 haneli kodu girin. Doğrulayıcınız yoksa Merkez kurtarma kodunu kullanın.'); second = 'totp'; }
    } else {
      mfaReset = ticket.proof === 'merkez' && !!current.mfa && b.resetAuthenticator === true;
      if (ticket.proof === 'merkez' && current.mfa && !mfaReset) step = totpStep(b.code, 'Doğrulayıcı uygulamadaki 6 haneli kodu girin. Doğrulayıcınız yoksa “Doğrulayıcıyı da sıfırla”yı seçin.');
    }
    const credential = await adminRecord(b.newPassword);
    account.change((p, audit) => {
      if (p.admin.hash !== ticket.hash) throw new DomainError('VERSION_CONFLICT', 'Şifre bu arada değişti. Kodu yeniden girin.', 409);
      const mfa = p.admin.mfa;
      if (ticket.proof === 'mfa') {
        // Used up now, inside the transaction: the same backup code never resets twice.
        const index = mfa?.recoveryHashes.indexOf(recoveryHash(ticket.backup!)) ?? -1;
        if (!mfa || index < 0) throw new DomainError('INVALID_CODE', 'Bu yedek kod bu arada kullanıldı. Başka bir kodla yeniden deneyin.', 409);
        mfa.recoveryHashes.splice(index, 1);
      }
      if (step !== null && mfa) mfa.lastStep = step;
      p.admin = { ...credential, ...(mfa && !mfaReset ? { mfa } : {}) };
      audit('admin.password_reset', ticket.proof === 'merkez' ? 'Merkez kurtarma koduyla' : ticket.proof === 'mfa' ? 'iki adımlı doğrulama yedek koduyla'
        : `e-postaya gönderilen kodla${second === 'totp' ? ' ve doğrulayıcı koduyla' : second === 'merkez' ? ' ve Merkez kurtarma koduyla' : ' (iki adımlı giriş kapalıydı)'}`);
      if (mfaReset) audit('admin.mfa_reset', 'şifre sıfırlamada doğrulayıcı da sıfırlandı');
    });
    guard.passed();
    resets.clear(); sessions.clear(); setups.clear(); emailCode = undefined;
    o.onPasswordChanged?.();
    try { o.reset?.done?.({ proof: ticket.proof, mfaReset, ...(second ? { second } : {}) }); } catch { /* the password is changed; the notice is secondary */ }
    clear(req, res); res.json({ ok: true, mfaReset });
  });
  return {
    admin,
    /** A non-secret action from one address (the test e-mail): at most 5 a minute. */
    throttle,
    /** The admin password for a sensitive action (a new recovery code): wrong answers count like the others. */
    checkPassword: async (req: Request, password: string) => { const check = guarded(req); if (!await adminMatches(password, account.read())) { check.failed(new DomainError('INVALID_PASSWORD', '', 403)); return false; } check.passed(); return true; },
    /**
     * A fresh Authenticator code for a critical action (Güncellemeler, server/merkez/step-up.ts): the 6-digit TOTP only (no
     * backup code), used once (a code already used for a sign-in or an earlier check is refused). Wrong codes count like the
     * other checks in a session (5 free, then doubling waits, RATE_LIMIT); the caller writes the record line. MFA_OFF when
     * two-step login is not set up.
     */
    confirmCode: (req: Request, code: string) => {
      if (!account.read().mfa) throw new DomainError('MFA_OFF', 'İki adımlı doğrulama açık değil.', 409);
      const check = guarded(req), value = code.replace(/[\s-]/g, '');
      if (!/^\d{6}$/.test(value)) throw new DomainError('INVALID_CODE', 'Doğrulayıcı uygulamadaki 6 haneli kodu yazın.', 400);
      try {
        account.change(p => {
          const m = p.admin.mfa;
          if (!m) throw new DomainError('MFA_OFF', 'İki adımlı doğrulama açık değil.', 409);
          const step = verifyTotp(m.secret, value, now().getTime(), m.lastStep);
          if (step === null) throw new DomainError('INVALID_CODE', 'Kod yanlış, kullanılmış ya da süresi dolmuş. Uygulamadaki yeni kodu bekleyip yazın.', 403);
          m.lastStep = step;
        });
      } catch (e) { if (e instanceof DomainError && e.code === 'INVALID_CODE') throw check.failed(e, true); throw e; }
      check.passed();
    },
  };
}
