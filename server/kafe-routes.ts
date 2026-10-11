import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import type { Actor } from '../packages/domain/types.js';
import { AGREEMENT_VERSION, agreementNeeded } from '../packages/domain/agreement.js';
import { applicationForm } from './sync-protocol.js';
import { passwordRecord } from './accounts.js';
import { AttemptLimiter } from './key-vault.js';
import type { MerkezLink } from './kafe-link.js';
import { fromThisComputer, type Security } from './security-routes.js';
import type { Store } from './store.js';

const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), id = z.string().min(1).max(100);
const password = z.string().min(10, 'Şifre en az 10 karakter olmalı.').max(128, 'Şifre en fazla 128 karakter olabilir.');
/** The owner's username, with the rule in words: the screen shows the same rule under the field. */
const ownerUsername = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9._-]{2,31}$/, 'Kullanıcı adı küçük harfle başlamalı; yalnız küçük harf, rakam, nokta, alt çizgi ve tire olabilir (3–32 karakter, boşluk yok).');
/**
 * The café side of Mola Merkez: onboarding ("Mola'yı etkinleştir"), the owner's support screen and freeze requests.
 * Activation and the owner account are made only from this computer itself (no tablet, no tunnel or proxy).
 */
export function kafeRoutes(app: Express, store: Store, link: MerkezLink, staffActor: (req: Request) => Actor, ctx: { security?: Security; localDesktop: (req: Request) => void; signIn?: (req: Request, res: Response, username: string) => boolean }) {
  const owner = (req: Request) => { const a = staffActor(req); requireRole(store.read(a.tenantId), a, ['owner']); return a; };
  const here = (req: Request) => { if (!fromThisComputer(req)) throw new DomainError('LOCAL_ONLY', 'Mola’yı kasa bilgisayarından etkinleştirin.', 403); };
  const hasData = () => !!store.db.prepare('SELECT tenant FROM snapshots LIMIT 1').get();
  // While an application waits, every look at this screen also asks Merkez (at most every 2 s): approval arrives in seconds.
  app.get('/api/activation', async (req, res) => {
    if (link.state() === 'applied') await link.checkApplication();
    const state = link.state(), local = fromThisComputer(req), pending = link.pending(), application = link.application();
    // Invoice details are shown (for "Bilgileri düzelt") only in this computer's own window.
    const applied = application ? { status: application.status, name: application.name, submittedAt: application.submittedAt, reason: application.reason ?? null, checkedAt: application.checkedAt ?? null, error: application.error ?? null, ...(local ? { form: application.form } : {}) } : undefined;
    res.json({ state, local, ...(local && pending ? { pending: { name: pending.name, sector: pending.sector ?? null } } : {}), ...(applied ? { application: applied } : {}), existingData: state === 'activate' && hasData() });
  });
  /*
   * "Mola ekibi iletişim bilgileri": the vendor's own public contact, for every screen that may need it (activation, Destek,
   * "Şifremi unuttum"). Kept signed on this computer, so it shows offline too. Before activation (no heartbeat), or while none
   * is known, Merkez is asked now and then; a screen's first look waits briefly for it.
   */
  app.get('/api/contact', async (_req, res) => {
    if (!link.read() || !link.contact()) await link.refreshContact(!link.contact());
    res.json({ contact: link.contact() ?? null });
  });
  // Accepted from older screens but not needed: MerkezLink keeps its own activation ids for every retry.
  const activationBody = { requestId: requestId.optional() };
  // The self-serve trial is retired: a trial starts only when Mola approves a "Hesap açma başvurusu".
  app.post('/api/activation/trial', () => { throw new DomainError('TRIAL_RETIRED', 'Ücretsiz deneme artık “Hesap açma başvurusu” ile başlıyor.', 410); });
  /*
   * Mola Lisans Sözleşmesi: the screen sends the version the owner ticked ("okudum ve kabul ediyorum") with either way of
   * activating; it is kept here and goes to Merkez with the request. Without it (an older screen, a direct call) activation
   * still works and the owner is asked after signing in instead.
   */
  const agreement = z.object({ version: z.number().int() }).strict().refine(a => a.version === AGREEMENT_VERSION, 'Mola Lisans Sözleşmesi’nin güncel sürümünü kabul edin. Sayfayı yenileyip yeniden deneyin.').optional();
  app.post('/api/activation/application', async (req, res) => {
    here(req);
    const { agreement: accepted, ...form } = z.object({ ...applicationForm.shape, agreement }).strict().parse(req.body);
    res.json({ state: await link.apply(form, accepted && { version: accepted.version, name: form.contactName }) });
  });
  app.post('/api/activation/code', async (req, res) => {
    here(req);
    const { agreement: accepted, ...b } = z.object({ ...activationBody, code: z.string().trim().min(4).max(40), agreement }).strict().parse(req.body);
    res.json({ state: await link.activate('code', b, accepted && { version: accepted.version }) });
  });
  /*
   * The owner's one window after signing in (src/LicenseAgreement.tsx): asked when this business has no acceptance yet, or one
   * of an older text, and only once Mola Merkez knows it (activated here). Never asked of staff; nothing waits on it.
   */
  app.get('/api/staff/license/agreement', (req, res) => {
    const a = owner(req), accepted = link.agreement(a.tenantId);
    res.json({ version: AGREEMENT_VERSION, accepted: accepted ?? null, needed: !!link.read() && !!link.claims(a.tenantId) && agreementNeeded(accepted) });
  });
  app.post('/api/staff/license/agreement', (req, res) => {
    const a = owner(req), b = z.object({ version: z.number().int() }).strict().parse(req.body);
    const name = store.read(a.tenantId).staffUsers?.find(u => u.id === a.id)?.name;
    res.json({ accepted: link.acceptAgreement(a.tenantId, b.version, name) });
  });
  app.post('/api/activation/owner', async (req, res) => {
    here(req);
    const b = z.object({ username: ownerUsername, password, name: z.string().trim().max(60, 'Ad en fazla 60 karakter olabilir.').optional() }).strict().parse(req.body);
    if (link.state() !== 'owner') throw new DomainError('NOT_PENDING', 'Kurulacak işletme yok.', 409);
    const secret = await passwordRecord(b.password);
    link.createOwner({ username: b.username, name: b.name || 'İşletme sahibi', ...secret });
    // The owner just chose this password here: signed in at once, no second login (signedIn tells the screen).
    const signedIn = ctx.signIn?.(req, res, b.username) ?? false;
    res.json({ ok: true, username: b.username, state: link.state(), signedIn });
  });

  // ---------- Owner: Destek ----------
  app.get('/api/staff/support', (req, res) => {
    const a = owner(req); link.soon();
    const summary = link.summary(a.tenantId), queued = link.queuedFreezes(a.tenantId).map(f => ({ ...f, status: 'pending' as const }));
    // `merkez`: offline days (closes at 14, warns from 7), "another computer" lock, a wrong clock; `notice` says it in one sentence.
    res.json({ tickets: link.tickets(a.tenantId), license: summary ? { ...summary, freezes: [...(summary.freezes ?? []), ...queued] } : undefined, queuedFreezes: queued.map(f => f.id), connection: link.connection(), merkez: link.linkStatus(a.tenantId), notificationsConfigured: false });
  });
  // Destek → "Yeniden dene": one heartbeat now (at most every 5 s for this computer), then the link's state after it.
  let retried = 0;
  app.post('/api/staff/support/sync', async (req, res) => {
    const a = owner(req);
    if (Date.now() - retried > 5000) { retried = Date.now(); await link.sync(); }
    res.json({ connection: link.connection(), merkez: link.linkStatus(a.tenantId) });
  });
  // `attachments`: files sent first with /support/attachments (up to 5); a reply may be files only.
  const attachmentIds = z.array(z.string().uuid()).max(5).optional();
  app.post('/api/staff/support', (req, res) => {
    const a = owner(req); const b = z.object({ requestId, subject: z.string().trim().min(3).max(120), text: z.string().trim().min(3).max(4000), attachments: attachmentIds }).parse(req.body);
    res.json(link.createTicket(a.tenantId, a.id, b));
  });
  app.post('/api/staff/support/reply', (req, res) => {
    const a = owner(req); const b = z.object({ requestId, ticketId: id, text: z.string().trim().max(4000), close: z.boolean().optional(), attachments: attachmentIds }).refine(x => x.text.length > 0 || !!x.attachments?.length, { message: 'Mesaj boş olamaz.', path: ['text'] }).parse(req.body);
    if (b.close) throw new DomainError('FORBIDDEN', 'Talebi destek ekibi kapatabilir.', 403);
    res.json(link.reply(a.tenantId, a.id, { requestId: b.requestId, ticketId: b.ticketId, text: b.text, ...(b.attachments?.length ? { attachments: b.attachments } : {}) }));
  });
  /*
   * Destek ekleri: the owner's browser sends the file here (JSON, base64, up to 10 MB); this server passes it to Mola Merkez
   * signed and keeps nothing. Reading goes the same way back. Staff browsers never talk to Merkez themselves.
   */
  app.post('/api/staff/support/attachments', async (req, res) => {
    const a = owner(req); const b = z.object({ name: z.string().max(300), data: z.string().min(1).max(Math.ceil(10 * 1024 * 1024 / 3) * 4 + 8) }).strict().parse(req.body);
    res.json({ attachment: await link.uploadAttachment(a.tenantId, b) });
  });
  for (const small of [false, true]) app.get(`/api/staff/support/attachments/:id${small ? '/kucuk' : ''}`, async (req, res) => {
    const a = owner(req), file = await link.attachment(a.tenantId, z.string().uuid().parse(req.params.id), small);
    res.set({ 'Content-Type': file.type, 'Content-Length': String(file.data.length), 'Content-Disposition': file.disposition, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" });
    res.end(file.data);
  });
  /*
   * Duyurular (Mola ekibinden, server/merkez/announcements.ts): the owner and the Müdür read them; cashier, waiter, kitchen and
   * Mola destek are refused (403). Opening marks them read for that account (and, the first time, for the business at Merkez);
   * only the owner says "Okudum" on an Önemli one (the window after signing in).
   */
  const reader = (req: Request) => { const a = staffActor(req); requireRole(store.read(a.tenantId), a, ['owner', 'manager']); return { tenantId: a.tenantId, id: a.id, role: a.role as 'owner' | 'manager' }; };
  app.get('/api/staff/announcements', (req, res) => { const a = reader(req); res.json(link.announcements(a.tenantId, a)); });
  app.post('/api/staff/announcements/read', (req, res) => {
    const a = reader(req), b = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).strict().parse(req.body);
    link.readAnnouncements(a.tenantId, a, b.ids);
    res.json(link.announcements(a.tenantId, a));
  });
  app.post('/api/staff/announcements/ack', (req, res) => {
    const a = owner(req), b = z.object({ id: z.string().uuid() }).strict().parse(req.body);
    link.readAnnouncements(a.tenantId, { id: a.id, role: 'owner' }, [b.id], true);
    res.json(link.announcements(a.tenantId, { id: a.id, role: 'owner' }));
  });
  app.post('/api/staff/license/freeze', (req, res) => {
    const a = owner(req); const b = z.object({ requestId, reason: z.string().trim().min(5).max(1000), startDate: z.string(), days: z.number().int().min(1).max(60) }).parse(req.body);
    res.json(link.requestFreeze(a.tenantId, b));
  });

  // ---------- Café computer: owner forgot the password ----------
  /*
   * Only in this computer's Mola window (desktop key, this computer itself; never a tablet, the LAN or a tunnel). Two ways,
   * each in two steps (step 1 shows this computer's owner accounts, step 2 sets the new password and proves the code again):
   *   recovery code   proof of owning this data (key protection on); nobody at Merkez can do it.
   *   "Mola ekibinden kod"   the vendor's one-time code, checked and spent at Merkez over the signed link (works without
   *                   key protection too); Merkez never learns the username or the password.
   * All of that owner's sessions end; staff accounts are not touched.
   */
  const vendorAttempts = new AttemptLimiter(5, 15 * 60_000, () => link.now().getTime());
  const recovery = () => {
    const vault = ctx.security?.vault;
    if (!vault || vault.protection === 'off' || !ctx.security) throw new DomainError('NO_PROTECTION', 'Bu kurulumda kurtarma kodu yok. “Mola ekibinden kod” ile devam edin.', 409);
    return { vault, attempts: ctx.security.attempts };
  };
  /** Active owner accounts (only on this computer's own screen): of one business, or of every business here. */
  const owners = (tenant?: string) => (store.db.prepare('SELECT tenant FROM snapshots ORDER BY tenant').all() as { tenant: string }[]).filter(r => !tenant || r.tenant === tenant).flatMap(({ tenant: t }) => {
    const s = store.read(t);
    return (s.staffUsers ?? []).filter(u => u.role === 'owner' && u.active).map(u => ({ username: u.username, name: u.name, business: s.name }));
  });
  /** A wrong, expired or used vendor code counts as a wrong try (5 in 15 minutes, then a 15-minute wait). */
  const vendorCheck = (code: string, use: boolean) => vendorAttempts.run(async () => {
    try { return await link.ownerReset(code, use); }
    catch (e) { if (e instanceof DomainError && ['CODE_EXPIRED', 'CODE_USED'].includes(e.code)) throw new DomainError('WRONG_CODE', e.message, 403); throw e; }
  });
  async function setOwnerPassword(username: string, newPassword: string, actor: 'recovery-code' | 'vendor-code', tenant?: string, spend?: () => Promise<unknown>) {
    const found = store.findUser(username);
    if (!found || found.user.role !== 'owner' || !found.user.active || (tenant && found.tenantId !== tenant)) throw new DomainError('NOT_FOUND', 'Bu kullanıcı adıyla işletme sahibi hesabı bulunamadı.', 404);
    const secret = await passwordRecord(newPassword);
    await spend?.();
    store.mutate(found.tenantId, s => {
      const u = s.staffUsers!.find(u => u.id === found.user.id && u.role === 'owner' && u.active);
      if (!u) throw new DomainError('NOT_FOUND', 'İşletme sahibi hesabı bulunamadı.', 404);
      Object.assign(u, secret); u.version++;
      s.audit.push({ action: 'owner.password_reset', actor, target: u.id, at: link.now().toISOString() });
    });
    link.audit(actor === 'vendor-code' ? 'owner.password_reset.vendor_code' : 'owner.password_reset');
  }
  const codeBody = { code: z.string().min(1).max(64) }, passwordBody = { username: z.string().trim().toLowerCase().max(50), newPassword: z.string().min(12).max(128) };
  // Recovery code, step 1: the code alone; the owner picks the account from the list.
  app.post('/api/desktop/owner-password/owners', async (req, res) => {
    ctx.localDesktop(req);
    const b = z.object(codeBody).strict().parse(req.body), { vault, attempts } = recovery();
    await attempts.run(() => vault.verify(b.code));
    res.json({ owners: owners() });
  });
  // Recovery code, step 2 (also the older one-step call): the code is checked again, never trusted from step 1.
  app.post('/api/desktop/owner-password', async (req, res) => {
    ctx.localDesktop(req);
    const b = z.object({ ...codeBody, ...passwordBody }).strict().parse(req.body), { vault, attempts } = recovery();
    await attempts.run(() => vault.verify(b.code));
    await setOwnerPassword(b.username, b.newPassword, 'recovery-code');
    res.json({ ok: true });
  });
  // "Mola ekibinden kod", step 1: checked at Merkez (not spent); the owners of that business only.
  app.post('/api/desktop/owner-password/vendor/owners', async (req, res) => {
    ctx.localDesktop(req);
    const b = z.object(codeBody).strict().parse(req.body);
    const business = await vendorCheck(b.code, false);
    res.json({ business: business.name, owners: owners(business.tenantId) });
  });
  // Step 2: checked again, the account must be that business's owner, then the code is spent and the password set.
  app.post('/api/desktop/owner-password/vendor', async (req, res) => {
    ctx.localDesktop(req);
    const b = z.object({ ...codeBody, ...passwordBody }).strict().parse(req.body);
    const business = await vendorCheck(b.code, false);
    await setOwnerPassword(b.username, b.newPassword, 'vendor-code', business.tenantId, () => vendorCheck(b.code, true));
    res.json({ ok: true });
  });
}
