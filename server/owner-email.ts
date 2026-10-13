import type { Express, Request } from 'express';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import type { Actor } from '../packages/domain/types.js';
import type { MerkezLink } from './kafe-link.js';
import type { Store } from './store.js';

/*
 * Ayarlar → Güvenlik ve yedek → "Yeni bilgisayar için e-posta" (13 Ekim, sahibin kararı): the address İşletmem var sends its
 * code to, kept and verified by Mola Merkez (server/merkez/owner-login.ts, POST /owner-email/*). The café only relays its
 * owner's steps over its signed link, and checks the owner's password itself first:
 *   GET  /api/staff/owner-email            → { available, email (masked) | null, source: 'owner'|'invoice'|null, reason? }
 *   POST /api/staff/owner-email/old-code   { password }                       → a code to the current address (a change)
 *   POST /api/staff/owner-email/new-code   { email, password?, old?: {ticket, code} } → a code to the new address
 *   POST /api/staff/owner-email/confirm    { ticket, code }                  → the new address counts
 * First time (no application, no address): new-code then confirm (the code proves the address). A change: the owner's
 * password, the code sent to the OLD address, then the NEW address's code. The owner's own account only.
 */
type Deps = { store: Store; staffActor: (req: Request) => Actor; link?: MerkezLink; confirmPassword: (req: Request, actor: Actor, password: string | undefined) => Promise<void> };
type Status = { email: string | null; source: 'owner' | 'invoice' | null };
type Code = { ticket: string; email: string };

export function ownerEmailRoutes(app: Express, d: Deps) {
  const owner = (req: Request) => { const a = d.staffActor(req); requireRole(d.store.read(a.tenantId), a, ['owner']); return a; };
  /** Why the card cannot work now, in words (undefined: it can). */
  const unavailable = () => !d.link || !d.link.relayReady() ? 'Mola bu bilgisayarda etkinleştirilmemiş ya da Mola Merkez kaydı kapalı.'
    : !d.link.read()?.accepts?.includes('owner.email') ? 'Mola Merkez henüz bu özelliği tanımıyor; Mola ekibi Merkez’i güncelleyince açılır.' : undefined;
  const relay = <T,>(path: string, body: object) => { const why = unavailable(); if (why) throw new DomainError('OWNER_EMAIL_OFF', why, 409); return d.link!.relayPost<T>(path, body, 30_000); };
  const code6 = z.string().trim().regex(/^\d{6}$/, 'E-postadaki 6 haneli kodu yazın.'), ticket = z.string().regex(/^[A-Za-z0-9_-]{32}$/);

  app.get('/api/staff/owner-email', async (req, res) => {
    const a = owner(req), why = unavailable();
    if (why) { res.json({ available: false, email: null, source: null, reason: why }); return; }
    const s = await relay<Status>('/owner-email/status', { tenantId: a.tenantId });
    res.json({ available: true, ...s });
  });
  app.post('/api/staff/owner-email/old-code', async (req, res) => {
    const a = owner(req), b = z.object({ password: z.string().max(200) }).strict().parse(req.body);
    await d.confirmPassword(req, a, b.password);
    res.json(await relay<Code>('/owner-email/old-code', { tenantId: a.tenantId }));
  });
  app.post('/api/staff/owner-email/new-code', async (req, res) => {
    const a = owner(req);
    const b = z.object({ email: z.string().trim().toLowerCase().max(120).email('Geçerli bir e-posta adresi yazın.'), password: z.string().max(200).optional(), old: z.object({ ticket, code: code6 }).strict().optional() }).strict().parse(req.body);
    // A change (the old address's code is there) needs the password again in this very request.
    if (b.old) await d.confirmPassword(req, a, b.password);
    res.json(await relay<Code>('/owner-email/new-code', { tenantId: a.tenantId, email: b.email, ...(b.old ? { old: b.old } : {}) }));
  });
  app.post('/api/staff/owner-email/confirm', async (req, res) => {
    const a = owner(req), b = z.object({ ticket, code: code6 }).strict().parse(req.body);
    const s = await relay<Status>('/owner-email/confirm', { tenantId: a.tenantId, ticket: b.ticket, code: b.code });
    d.store.mutate(a.tenantId, st => { st.audit.push({ action: 'business.owner_email_verified', actor: a.id, target: st.tenantId, at: new Date().toISOString() }); });
    res.json({ available: true, ...s });
  });
}
