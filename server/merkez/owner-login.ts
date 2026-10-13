import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import express, { type Express, type Request } from 'express';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { verifierMatches, type OwnerVerifier } from '../key-vault.js';
import { MERKEZ_API, type SyncRequest } from '../sync-protocol.js';
import { clientKey } from '../http-security.js';
import { addAlert } from './alerts.js';
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
type Deps = { store: MerkezStore; vault: BackupVault; now: () => Date; limitAddress: (req: Request, purpose: string, max: number, ms: number) => void; send?: typeof sendMail };

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

const WRONG = 'Bilgiler eşleşmedi. E-posta adresini, kullanıcı adını ve şifreyi kontrol edin.';
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
  /** Businesses whose invoice e-mail is this one (contact index: keyed hashes, never a second plain copy). */
  function byEmail(store: MerkezStore, email: string) {
    const rows = store.db.prepare("SELECT tenant FROM contact_index WHERE hash=? AND kind='email'").all(store.contactHash('email', email)) as { tenant: string }[];
    const tenants = new Set(rows.map(r => r.tenant));
    return store.read().businesses.filter(b => tenants.has(b.tenantId) && !b.suspended && b.installId);
  }
  app.post(`${MERKEZ_API}/owner-login/start`, async (req, res) => {
    const { store, now, limitAddress, send = sendMail } = deps(), t = now().getTime();
    limitAddress(req, 'owner-login', 10, 15 * 60_000);
    const b = z.object({ email: z.string().trim().min(3).max(120), username: z.string().trim().min(1).max(50), password: z.string().min(1).max(200) }).strict().parse(req.body);
    sweep(t);
    const username = b.username.toLowerCase(), found = byEmail(store, b.email).find(x => x.ownerLogin?.username === username);
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
    const mail = store.read().mail?.settings, email = found.invoice?.email ?? b.email.trim();
    if (!mail?.enabled) throw new DomainError('MAIL_OFF', 'Doğrulama kodu e-postayla gönderilemiyor (Mola Merkez’in e-posta ayarı kapalı). Mola ekibine ulaşın.', 503);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0'), ticket = randomBytes(24).toString('base64url');
    try { await send(mail, email, 'Mola · İşletmem var doğrulama kodu', `Merhaba,\n\nMola'yı yeni bir bilgisayarda "${found.name}" işletmesine bağlamak için doğrulama kodunuz:\n\n${code}\n\nKod 10 dakika geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın ve işletme sahibi şifrenizi değiştirin.\n\nMola`); }
    catch { throw new DomainError('MAIL_FAILED', 'Doğrulama kodu e-postası gönderilemedi. Biraz sonra yeniden deneyin ya da Mola ekibine ulaşın.', 502); }
    pending.set(ticket, { tenantId: found.tenantId, email, codeHash: hash(code), until: t + CODE_MS, tries: 0 });
    store.mutate(d => { d.audit.push({ action: 'owner_login.code_sent', target: found.tenantId, at: now().toISOString(), by: 'cafe', detail: `İşletmem var: doğrulama kodu ${maskEmail(email)} adresine gönderildi (${clientKey(req)})` }); });
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
    });
    res.json({ name: biz.name, tenantId: biz.tenantId, cloud });
  });
}
/** A verifier that never matches (the work of a real check for an unknown e-mail or username). */
const DUMMY: OwnerVerifier = { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', N: 2 ** 15, r: 8, p: 1, hash: '0'.repeat(64) };
