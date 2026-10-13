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
 *   GET  /api/staff/owner-email            → { available, email (masked) | null, source: 'owner'|'invoice'|null, lock, username, reason? }
 *   POST /api/staff/owner-email/old-code   { password }                       → a code to the current address (a change)
 *   POST /api/staff/owner-email/new-code   { email, password, old?: {ticket, code} } → a code to the new address
 *   POST /api/staff/owner-email/confirm    { ticket, code }                  → the new address counts
 *   POST /api/staff/owner-email/lock       { password }                       → the owner's lock made now → { lock, username }
 * First time (no application, no address): password, new-code then confirm (the code proves the address). A change: the
 * owner's password, the code sent to the OLD address, then the NEW address's code. The owner's own account only.
 * `lock`: whether İşletmem var can open this business with the owner's password (the sealed block of server/key-vault.ts;
 * null: no protection on this computer). Every step that checks the password also makes the lock (13 Ekim: an owner who
 * stayed signed in across the update had an address but no lock, so the new computer said "Bilgiler eşleşmedi").
 */
type Deps = { store: Store; staffActor: (req: Request) => Actor; link?: MerkezLink; confirmPassword: (req: Request, actor: Actor, password: string | undefined) => Promise<void>;
  lock?: { ready: (actor: Actor) => { sealed: boolean; username: string; stamp: string } | null; seal: (actor: Actor, password: string, always?: boolean) => Promise<boolean> } };
type Status = { email: string | null; source: 'owner' | 'invoice' | null };
/** Merkez's side (13 Ekim): the lock it heard with a heartbeat and its newest Sunucu yedeği copy (older Merkez: absent). */
type MerkezSide = Status & { lock?: { username: string; stamp: string; at: string } | null; lastCopyAt?: string | null };
type Code = { ticket: string; email: string };

export function ownerEmailRoutes(app: Express, d: Deps) {
  const owner = (req: Request) => { const a = d.staffActor(req); requireRole(d.store.read(a.tenantId), a, ['owner']); return a; };
  /** Why the card cannot work now, in words (undefined: it can). */
  const unavailable = () => !d.link || !d.link.relayReady() ? 'Mola bu bilgisayarda etkinleştirilmemiş ya da Mola Merkez kaydı kapalı.'
    : !d.link.read()?.accepts?.includes('owner.email') ? 'Mola Merkez henüz bu özelliği tanımıyor; Mola ekibi Merkez’i güncelleyince açılır.' : undefined;
  const relay = <T,>(path: string, body: object) => { const why = unavailable(); if (why) throw new DomainError('OWNER_EMAIL_OFF', why, 409); return d.link!.relayPost<T>(path, body, 30_000); };
  /**
   * The lock and the sign-in name İşletmem var asks for (shown on the card: the owner may not remember it). With Merkez's
   * side: `atMerkez` the lock with this password reached Merkez; `copiedAt` a Sunucu yedeği copy came after it (that copy
   * carries the lock, so a new computer gets the data back). The stamp itself never leaves this server.
   */
  const ready = (a: Actor, m?: MerkezSide) => {
    const l = d.lock?.ready(a) ?? null, ml = m?.lock;
    const atMerkez = !!(l?.sealed && ml && ml.stamp === l.stamp && ml.username === l.username.trim().toLowerCase());
    const copiedAt = atMerkez && m?.lastCopyAt && m.lastCopyAt >= ml!.at ? m.lastCopyAt : null;
    return { lock: l ? l.sealed : null, username: d.store.sessionUser(a.tenantId, a.id)?.username ?? null, atMerkez, copiedAt };
  };
  /** The password is right (checked just before): the lock follows it; a failure never stops the e-mail step. */
  const seal = (a: Actor, password: string, always = false) => d.lock?.seal(a, password, always).catch(error => { console.warn(`Sahip şifre kilidi yazılamadı: ${error instanceof Error ? error.message : error}`); return false; });
  const code6 = z.string().trim().regex(/^\d{6}$/, 'E-postadaki 6 haneli kodu yazın.'), ticket = z.string().regex(/^[A-Za-z0-9_-]{32}$/);

  app.get('/api/staff/owner-email', async (req, res) => {
    const a = owner(req), why = unavailable();
    if (why) { res.json({ available: false, email: null, source: null, ...ready(a), reason: why }); return; }
    const { lock: _l, lastCopyAt: _c, ...s } = await relay<MerkezSide>('/owner-email/status', { tenantId: a.tenantId }), m = { ...s, lock: _l, lastCopyAt: _c };
    res.json({ available: true, ...s, ...ready(a, m) });
  });
  app.post('/api/staff/owner-email/old-code', async (req, res) => {
    const a = owner(req), b = z.object({ password: z.string().max(200) }).strict().parse(req.body);
    await d.confirmPassword(req, a, b.password);
    await seal(a, b.password);
    res.json(await relay<Code>('/owner-email/old-code', { tenantId: a.tenantId }));
  });
  app.post('/api/staff/owner-email/new-code', async (req, res) => {
    const a = owner(req);
    const b = z.object({ email: z.string().trim().toLowerCase().max(120).email('Geçerli bir e-posta adresi yazın.'), password: z.string().max(200).optional(), old: z.object({ ticket, code: code6 }).strict().optional() }).strict().parse(req.body);
    // The password in this very request, the first address too: it makes the lock the address is for.
    await d.confirmPassword(req, a, b.password);
    await seal(a, b.password!);
    res.json(await relay<Code>('/owner-email/new-code', { tenantId: a.tenantId, email: b.email, ...(b.old ? { old: b.old } : {}) }));
  });
  app.post('/api/staff/owner-email/confirm', async (req, res) => {
    const a = owner(req), b = z.object({ ticket, code: code6 }).strict().parse(req.body);
    const s = await relay<Status>('/owner-email/confirm', { tenantId: a.tenantId, ticket: b.ticket, code: b.code });
    d.store.mutate(a.tenantId, st => { st.audit.push({ action: 'business.owner_email_verified', actor: a.id, target: st.tenantId, at: new Date().toISOString() }); });
    res.json({ available: true, ...s, ...ready(a) });
  });
  app.post('/api/staff/owner-email/lock', async (req, res) => {
    const a = owner(req), b = z.object({ password: z.string().max(200) }).strict().parse(req.body);
    await d.confirmPassword(req, a, b.password);
    // Also when the lock was there already: Merkez hears it now and a fresh backup takes it to Sunucu yedeği.
    await seal(a, b.password, true);
    res.json(ready(a));
  });
}
