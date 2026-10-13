import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { verifierMatches, type OwnerVerifier } from '../key-vault.js';
import { MERKEZ_API, type SyncRequest } from '../sync-protocol.js';
import { clientKey } from '../http-security.js';
import { addAlert, queueMail } from './alerts.js';
import { sendMail } from './mail.js';
import type { BackupVault } from './backup-vault.js';
import type { MerkezBusiness, MerkezData, MerkezStore } from './store.js';

/*
 * "İşletmem var" (13 Ekim, sahibin kararı): a business owner installs Mola on a new computer and signs in with their own
 * username and password instead of the recovery code or a taşıma kodu from Mola ekibi.
 *   1. The café computer sends each owner's username and a scrypt verifier of the password with the heartbeat (`owners`,
 *      only to a Merkez that lists 'owner.login'). Merkez keeps it on the business; it opens nothing (another salt than
 *      the backup's owner block).
 *   2. POST /owner-login/start { email, username, password }: the business is found by its e-mail (the contact index,
 *      keyed hashes), the password checked against the verifier; a 6-digit code goes to that e-mail (10 minutes, 5 tries).
 *   3. POST /owner-login/verify { ticket, code, requester }: right code → the business's name and, when it has Sunucu
 *      yedeği copies, a taşıma session for them (the same ticket transfer/read and transfer/finish take). Without copies the
 *      new computer restores from a flash drive or a synced folder, opened with the same password.
 * Every wrong answer is the same sentence (nobody learns which part was wrong), and both steps are slowed per address and
 * per business.
 */
export type OwnerLogin = { username: string; stamp: string; verifier: OwnerVerifier; updatedAt: string };
/** The business's verified e-mail for İşletmem var (café Ayarlar → Yeni bilgisayar için e-posta), next to the invoice e-mail. */
export type OwnerEmail = { email: string; verifiedAt: string };
type Deps = {
  store: MerkezStore; vault: BackupVault; now: () => Date; limitAddress: (req: Request, purpose: string, max: number, ms: number) => void; send?: typeof sendMail;
  // The café's own signed calls (Yeni bilgisayar için e-posta).
  authenticate: (req: Request) => { install: { id: string; secret: string }; nonce: string; closed: boolean };
  limitInstall: (install: string, purpose: string, max: number, ms: number) => void;
  sendSigned: (res: Response, secret: string, nonce: string, body: unknown) => void;
  admin: (req: Request) => unknown;
};

/** The heartbeat's verifiers, kept for this install's own businesses (a changed password replaces the old one). */
export function recordOwners(d: MerkezData, mine: MerkezBusiness[], sent: SyncRequest['owners'], time: string) {
  for (const o of sent ?? []) {
    const b = mine.find(x => x.tenantId === o.tenantId);
    if (!b) continue;
    const username = o.username.trim().toLowerCase();
    if (b.ownerLogin?.stamp === o.stamp && b.ownerLogin.username === username) continue;
    b.ownerLogin = { username, stamp: o.stamp, verifier: o.verifier, updatedAt: time };
  }
}

// The same words whether the address, the name, the password or the lock is missing (no hint which one exists).
const WRONG = 'Bilgiler eşleşmedi. E-posta adresini, kullanıcı adını ve şifreyi kontrol edin. Eski bilgisayarda Ayarlar → Güvenlik ve yedek → Yedek → “Yeni bilgisayar için e-posta” kartı “İşletmem var hazır” demediyse bu giriş henüz çalışmaz; Mola ekibini arayın.';
const CODE_MS = 10 * 60_000, TRIES = 5;
type Pending = { tenantId: string; email: string; codeHash: Buffer; until: number; tries: number };
const hash = (code: string) => createHash('sha256').update(`mola:sahip-kodu:v1:${code}`).digest();
/** "y***@gmail.com": enough for the owner to see where the code went. */
export const maskEmail = (email: string) => { const [user, domain] = email.split('@'); return `${user.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`; };

export function ownerLoginRoutes(app: Express, deps: () => Deps) {
  // Registered before Merkez's general JSON parser (server/merkez/app.ts): these two small bodies get their own.
  app.use(`${MERKEZ_API}/owner-login`, express.json({ limit: '4kb' }));
  const pending = new Map<string, Pending>(), perBusiness = new Map<string, { count: number; until: number }>();
  const sweep = (t: number) => { for (const [k, p] of pending) if (p.until <= t) pending.delete(k); for (const [k, v] of perBusiness) if (v.until <= t) perBusiness.delete(k); };
  /**
   * Businesses whose invoice e-mail is this one (contact index: keyed hashes, never a second plain copy), or whose owner
   * verified it in the café's Ayarlar (`ownerEmail`). `to`: where the code goes, the address that matched.
   */
  function byEmail(store: MerkezStore, email: string) {
    const rows = store.db.prepare("SELECT tenant FROM contact_index WHERE hash=? AND kind='email'").all(store.contactHash('email', email)) as { tenant: string }[];
    const tenants = new Set(rows.map(r => r.tenant)), typed = email.trim().toLowerCase();
    return store.read().businesses.filter(b => !b.suspended && b.installId).flatMap(b =>
      tenants.has(b.tenantId) ? [{ b, to: b.invoice?.email ?? email.trim() }] : b.ownerEmail?.email === typed ? [{ b, to: b.ownerEmail.email }] : []);
  }
  /** Every address of a business, for the "yeni bilgisayar" notice: invoice and the owner's own, once each. */
  const addresses = (b: MerkezBusiness) => [...new Set([b.invoice?.email, b.ownerEmail?.email].filter((x): x is string => !!x).map(x => x.trim().toLowerCase()))];
  app.post(`${MERKEZ_API}/owner-login/start`, async (req, res) => {
    const { store, now, limitAddress, send = sendMail } = deps(), t = now().getTime();
    limitAddress(req, 'owner-login', 10, 15 * 60_000);
    const b = z.object({ email: z.string().trim().min(3).max(120), username: z.string().trim().min(1).max(50), password: z.string().min(1).max(200) }).strict().parse(req.body);
    sweep(t);
    const username = b.username.toLowerCase(), match = byEmail(store, b.email).find(x => x.b.ownerLogin?.username === username), found = match?.b;
    if (found) {
      const n = perBusiness.get(found.tenantId);
      if (n && n.until > t && n.count >= 8) throw new DomainError('RATE_LIMIT', 'Bu işletme için çok fazla deneme yapıldı. Bir saat sonra yeniden deneyin.', 429);
    }
    // The same work either way (one scrypt), so a wrong e-mail answers as slowly as a wrong password.
    const ok = await verifierMatches(found?.ownerLogin?.verifier ?? DUMMY, b.password);
    if (!found || !ok) {
      if (found) { const n = perBusiness.get(found.tenantId); if (n && n.until > t) n.count++; else perBusiness.set(found.tenantId, { count: 1, until: t + 3600_000 }); }
      throw new DomainError('OWNER_LOGIN_FAILED', WRONG, 403);
    }
    const mail = store.read().mail?.settings, email = match!.to;
    if (!mail?.enabled) throw new DomainError('MAIL_OFF', 'Doğrulama kodu e-postayla gönderilemiyor (Mola Merkez’in e-posta ayarı kapalı). Mola ekibine ulaşın.', 503);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0'), ticket = randomBytes(24).toString('base64url');
    try { await send(mail, email, 'Mola · İşletmem var doğrulama kodu', `Merhaba,\n\nMola'yı yeni bir bilgisayarda "${found.name}" işletmesine bağlamak için doğrulama kodunuz:\n\n${code}\n\nKod 10 dakika geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın ve işletme sahibi şifrenizi değiştirin.\n\nMola`); }
    catch { throw new DomainError('MAIL_FAILED', 'Doğrulama kodu e-postası gönderilemedi. Biraz sonra yeniden deneyin ya da Mola ekibine ulaşın.', 502); }
    pending.set(ticket, { tenantId: found.tenantId, email, codeHash: hash(code), until: t + CODE_MS, tries: 0 });
    store.mutate(d => { d.audit.push({ action: 'owner_login.code_sent', target: found.tenantId, at: now().toISOString(), by: 'cafe', detail: `İşletmem var: doğrulama kodu ${maskEmail(email)} adresine gönderildi` }); });
    res.json({ ticket, email: maskEmail(email), name: found.name });
  });
  app.post(`${MERKEZ_API}/owner-login/verify`, (req, res) => {
    const { store, vault, now, limitAddress } = deps(), t = now().getTime();
    limitAddress(req, 'owner-login-verify', 20, 15 * 60_000);
    const b = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{32}$/), code: z.string().trim().regex(/^\d{6}$/), requester: z.string().regex(/^[a-f0-9-]{36}$/) }).strict().parse(req.body);
    sweep(t);
    const p = pending.get(b.ticket);
    if (!p || p.until <= t) throw new DomainError('CODE_EXPIRED', 'Kodun süresi doldu. Baştan başlayıp yeni kod isteyin.', 403);
    if (!timingSafeEqual(hash(b.code), p.codeHash)) {
      if (++p.tries >= TRIES) pending.delete(b.ticket);
      throw new DomainError('WRONG_CODE', p.tries >= TRIES ? 'Çok fazla yanlış kod. Baştan başlayıp yeni kod isteyin.' : 'Kod yanlış. E-postadaki 6 haneli kodu yazın.', 403);
    }
    pending.delete(b.ticket);
    const biz = store.read().businesses.find(x => x.tenantId === p.tenantId);
    if (!biz?.installId) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
    // Sunucu yedeği copies: a taşıma session exactly like a code from Mola ekibi (bound to this new computer).
    const copies = vault.copies(biz.installId);
    let cloud: { ticket: string; expiresAt: string; name: string; copies: unknown[] } | null = null;
    if (copies.length) {
      const issued = vault.issueCode(biz.tenantId, now());
      const opened = vault.openCode(issued.code, b.requester, tenantId => store.read().businesses.find(x => x.tenantId === tenantId)?.installId, now());
      if (opened) cloud = { ticket: opened.ticket, expiresAt: opened.expiresAt, name: biz.name, copies: vault.copies(opened.installId).map(c => ({ id: c.id, createdAt: c.createdAt, uploadedAt: c.uploadedAt, bytes: c.bytes, files: c.files.length, appVersion: c.appVersion, verified: c.verified, list: c.files })) };
    }
    const time = now().toISOString();
    store.mutate(d => {
      d.audit.push({ action: 'owner_login.verified', target: biz.tenantId, at: time, by: 'cafe', detail: `İşletmem var: sahip yeni bir bilgisayarda doğrulandı${cloud ? ' (sunucu yedeği açıldı)' : ''}` });
      addAlert(d, time, 'cafe.cloud_backup', `${biz.name}: işletme sahibi yeni bir bilgisayarda kendi şifresi ve e-posta koduyla giriş yaptı ("İşletmem var"). Yeni bilgisayar bağlanınca eski bilgisayarda sipariş kapanır.`, { tenantId: biz.tenantId, title: 'İşletmem var: yeni bilgisayar' });
      // 13 Ekim: the owner hears it too, at every address of the business (the mail queue retries; SMTP off: nothing goes).
      if (d.mail?.settings?.enabled) for (const to of addresses(biz)) queueMail(d, time, 'Mola · İşletmeniz yeni bir bilgisayarda açıldı', `Merhaba,\n\n"${biz.name}" işletmeniz ${time.slice(0, 16).replace('T', ' ')} (UTC) itibarıyla Mola'da yeni bir bilgisayara taşındı ("İşletmem var": işletme sahibi şifresi ve e-posta koduyla).${cloud ? ' Veriler Mola Merkez\'deki şifreli yedekten indiriliyor.' : ''}\n\nYeni bilgisayar internete bağlanınca eski bilgisayarda sipariş alınmaz.\n\nBunu siz yapmadıysanız hemen Mola ekibini arayın ve işletme sahibi şifrenizle e-posta şifrenizi değiştirin.\n\nMola`, undefined, to);
    });
    res.json({ name: biz.name, tenantId: biz.tenantId, cloud });
  });

  /*
   * "Yeni bilgisayar için e-posta" (13 Ekim, sahibin kararı): the café's Ayarlar sets the address İşletmem var uses.
   *   POST /owner-email/status   { tenantId }                          → { email (masked) | null, source: 'owner'|'invoice'|null }
   *   POST /owner-email/old-code { tenantId }                          → code to the CURRENT address (a change starts here)
   *   POST /owner-email/new-code { tenantId, email, old?: {ticket,code} } → code to the NEW address; with a current address
   *                                                                       the old address's code is required first
   *   POST /owner-email/confirm  { tenantId, ticket, code }            → the new address is kept (verified)
   * The café checks the owner's password before old-code and new-code; Merkez only answers its own install's businesses
   * (signed calls). Codes: 6 digits, 10 minutes, 5 tries. The old address(es) hear about a change. A lost old address:
   * Mola Yönetim → İşletme → Bilgiler → "Kaldır" (after the vendor checked the caller), then the first-time flow.
   */
  type EmailPending = { tenantId: string; purpose: 'old' | 'new'; email: string; codeHash: Buffer; until: number; tries: number };
  const emailPending = new Map<string, EmailPending>();
  const current = (b: MerkezBusiness) => b.ownerEmail ? { email: b.ownerEmail.email, source: 'owner' as const } : b.invoice?.email ? { email: b.invoice.email.trim().toLowerCase(), source: 'invoice' as const } : null;
  app.use(`${MERKEZ_API}/owner-email`, express.json({ limit: '4kb', verify: (req, _res, buf) => { (req as Request & { rawBody?: Buffer }).rawBody = buf; } }));
  function cafe(req: Request, purpose: string, max: number) {
    const { authenticate, limitAddress, limitInstall, store } = deps();
    limitAddress(req, `owner-email-${purpose}`, max * 2, 15 * 60_000);
    const { install, nonce, closed } = authenticate(req);
    limitInstall(install.id, `owner-email-${purpose}`, max, 15 * 60_000);
    if (closed) throw new DomainError('RECORD_CLOSED', 'Bu işletmenin Mola kaydı kapatıldı.', 409);
    const { tenantId } = z.object({ tenantId: z.string().min(1).max(100) }).passthrough().parse(req.body);
    const biz = store.read().businesses.find(b => b.tenantId === tenantId && b.installId === install.id);
    // Not NOT_FOUND: the café reads a 404 NOT_FOUND as "this Merkez does not know the call" (server/kafe-link.ts failure).
    if (!biz) throw new DomainError('BUSINESS_NOT_FOUND', 'İşletme bu kurulumda bulunamadı.', 404);
    return { install, nonce, biz };
  }
  async function sendCode(biz: MerkezBusiness, purpose: 'old' | 'new', email: string) {
    const { store, now, send = sendMail } = deps(), t = now().getTime();
    const mail = store.read().mail?.settings;
    if (!mail?.enabled) throw new DomainError('MAIL_OFF', 'Doğrulama kodu e-postayla gönderilemiyor (Mola Merkez’in e-posta ayarı kapalı). Mola ekibine ulaşın.', 503);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0'), ticket = randomBytes(24).toString('base64url');
    const why = purpose === 'old' ? `"${biz.name}" işletmesinin Mola'daki e-posta adresini değiştirmek için` : `Bu adresi "${biz.name}" işletmesinin Mola e-postası yapmak için`;
    try { await send(mail, email, 'Mola · E-posta doğrulama kodu', `Merhaba,\n\n${why} doğrulama kodunuz:\n\n${code}\n\nKod 10 dakika geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın ve işletme sahibi şifrenizi değiştirin.\n\nMola`); }
    catch { throw new DomainError('MAIL_FAILED', 'Doğrulama kodu e-postası gönderilemedi. Adresi kontrol edip biraz sonra yeniden deneyin.', 502); }
    for (const [k, p] of emailPending) if (p.until <= t || (p.tenantId === biz.tenantId && p.purpose === purpose)) emailPending.delete(k);
    emailPending.set(ticket, { tenantId: biz.tenantId, purpose, email, codeHash: hash(code), until: t + CODE_MS, tries: 0 });
    return { ticket, email: maskEmail(email) };
  }
  /** A ticket's code: right once, wrong at most 5 times; the business must be the caller's. */
  function checkCode(biz: MerkezBusiness, purpose: 'old' | 'new', ticket: string, code: string) {
    const t = deps().now().getTime(), p = emailPending.get(ticket);
    if (!p || p.until <= t || p.tenantId !== biz.tenantId || p.purpose !== purpose) throw new DomainError('CODE_EXPIRED', 'Kodun süresi doldu. Yeniden kod isteyin.', 403);
    if (!timingSafeEqual(hash(code), p.codeHash)) {
      if (++p.tries >= TRIES) emailPending.delete(ticket);
      throw new DomainError('WRONG_CODE', p.tries >= TRIES ? 'Çok fazla yanlış kod. Yeniden kod isteyin.' : `Kod yanlış. ${purpose === 'old' ? 'Eski' : 'Yeni'} adrese gelen 6 haneli kodu yazın.`, 403);
    }
    emailPending.delete(ticket);
    return p;
  }
  const code6 = z.string().trim().regex(/^\d{6}$/, 'E-postadaki 6 haneli kodu yazın.'), ticketSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
  app.post(`${MERKEZ_API}/owner-email/status`, (req, res) => {
    const { install, nonce, biz } = cafe(req, 'status', 60), c = current(biz);
    // Whether İşletmem var would work now (13 Ekim): the owner's lock as Merkez heard it (the café compares the stamp with
    // its own) and the newest Sunucu yedeği copy (one taken after the lock carries it). The café's own facts, signed back.
    const lock = biz.ownerLogin ? { username: biz.ownerLogin.username, stamp: biz.ownerLogin.stamp, at: biz.ownerLogin.updatedAt } : null;
    const lastCopyAt = biz.installId ? deps().vault.copies(biz.installId).map(x => x.uploadedAt).sort().at(-1) ?? null : null;
    deps().sendSigned(res, install.secret, nonce, { email: c ? maskEmail(c.email) : null, source: c?.source ?? null, lock, lastCopyAt });
  });
  app.post(`${MERKEZ_API}/owner-email/old-code`, async (req, res) => {
    const { install, nonce, biz } = cafe(req, 'code', 10), c = current(biz);
    if (!c) throw new DomainError('NO_EMAIL', 'Kayıtlı e-posta yok; yeni adresi yazıp kod isteyin.', 409);
    deps().sendSigned(res, install.secret, nonce, await sendCode(biz, 'old', c.email));
  });
  app.post(`${MERKEZ_API}/owner-email/new-code`, async (req, res) => {
    const { install, nonce, biz } = cafe(req, 'code', 10), c = current(biz);
    const b = z.object({ tenantId: z.string(), email: z.string().trim().toLowerCase().max(120).email('Geçerli bir e-posta adresi yazın.'), old: z.object({ ticket: ticketSchema, code: code6 }).strict().optional() }).strict().parse(req.body);
    if (c) {
      if (!b.old) throw new DomainError('OLD_CODE_REQUIRED', 'Önce eski adrese gelen kodu yazın.', 409);
      if (b.email === c.email) throw new DomainError('SAME_EMAIL', 'Bu zaten kayıtlı adres. Başka bir adres yazın.', 409);
      checkCode(biz, 'old', b.old.ticket, b.old.code);
    }
    deps().sendSigned(res, install.secret, nonce, await sendCode(biz, 'new', b.email));
  });
  app.post(`${MERKEZ_API}/owner-email/confirm`, (req, res) => {
    const { install, nonce, biz } = cafe(req, 'confirm', 20), { store, now } = deps();
    const b = z.object({ tenantId: z.string(), ticket: ticketSchema, code: code6 }).strict().parse(req.body);
    const p = checkCode(biz, 'new', b.ticket, b.code), time = now().toISOString(), before = addresses(biz);
    store.mutate(d => {
      const target = d.businesses.find(x => x.tenantId === biz.tenantId);
      if (!target) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
      target.ownerEmail = { email: p.email, verifiedAt: time };
      d.audit.push({ action: before.length ? 'owner_email.changed' : 'owner_email.set', target: biz.tenantId, at: time, by: 'cafe', detail: `İşletmem var e-postası doğrulandı: ${maskEmail(p.email)}` });
      // The earlier address(es) hear about it: a change nobody asked for is noticed.
      if (d.mail?.settings?.enabled) for (const to of before.filter(x => x !== p.email)) queueMail(d, time, 'Mola · İşletmenizin e-posta adresi değişti', `Merhaba,\n\n"${biz.name}" işletmesinin Mola'daki e-posta adresi ${maskEmail(p.email)} olarak değiştirildi (işletme sahibi şifresi ve iki adresteki kodla).\n\nBunu siz yapmadıysanız hemen Mola ekibini arayın.\n\nMola`, undefined, to);
    });
    deps().sendSigned(res, install.secret, nonce, { email: maskEmail(p.email), source: 'owner' });
  });
  // Mola Yönetim → İşletme → Bilgiler: the owner lost the verified address (the vendor checked who calls). Then the café's
  // first-time flow (a code to the new address only) or the invoice e-mail counts again.
  app.post('/api/merkez/admin/owner-email/clear', express.json({ limit: '4kb' }), (req, res) => {
    const { store, now, admin } = deps();
    admin(req);
    const { tenantId } = z.object({ tenantId: z.string().min(1).max(100) }).strict().parse(req.body);
    store.mutate(d => {
      const b = d.businesses.find(x => x.tenantId === tenantId);
      if (!b) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
      if (!b.ownerEmail) return;
      d.audit.push({ action: 'owner_email.cleared', target: tenantId, at: now().toISOString(), by: 'admin', detail: `İşletmem var e-postası kaldırıldı (${maskEmail(b.ownerEmail.email)})` });
      delete b.ownerEmail;
    });
    res.json({ ok: true });
  });
}
/** A verifier that never matches (the work of a real check for an unknown e-mail or username). */
const DUMMY: OwnerVerifier = { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', N: 2 ** 15, r: 8, p: 1, hash: '0'.repeat(64) };
