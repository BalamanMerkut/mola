import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { ANNOUNCEMENT_TEXT_MAX, ANNOUNCEMENT_TITLE_MAX, announcementText, announcementTitle, type AnnouncementAudience, type AnnouncementDelivery, type AnnouncementRead } from '../../packages/domain/announcement.js';
import type { SyncRequest } from '../sync-protocol.js';
import { queueMail } from './alerts.js';
import { senderOf, validAddress } from '../smtp.js';
import type { JournalChange } from './journal.js';
import type { MerkezBusiness, MerkezData, MerkezStore } from './store.js';

/*
 * Duyurular: the vendor writes one message to every business, to the businesses of some packages, or to chosen ones.
 *   Stored    in the sealed registry (d.announcements, like the tickets), so it is in Merkez's backups.
 *   Targets   fixed when it is sent (`tenants`): a business that joins later does not get an older announcement (owner's
 *             decision, 6 Ekim: simple and predictable; a new one can always be sent). A deleted business drops out.
 *   Delivery  with the heartbeat, only to a café that asked for them (its request carries `announcements`, which it sends only
 *             to a Merkez listing 'announcements' in `accepts`): older cafés never see the field. The answer names every live
 *             announcement for this computer's businesses and carries in full only those the café does not have at that
 *             version; one missing from the list was withdrawn and goes from the café.
 *   Reads     the café sends who opened it (owner or Müdür) and when, and the owner's "Okudum" on an Önemli one.
 *   Guard     sending, editing and withdrawing need the Authenticator step-up ('announce', server/merkez/step-up.ts).
 * An e-mail copy goes through the vendor's own queue (server/merkez/mail.ts) to each business's e-mail (fatura bilgileri);
 * the queue counts what went and what failed on the announcement (MailItem.announcementId).
 */
export type Announcement = {
  id: string; v: number; title: string; text: string; important: boolean; audience: AnnouncementAudience; tenants: string[];
  createdAt: string; editedAt?: string; withdrawnAt?: string;
  reads: Record<string, AnnouncementRead>;
  /** E-posta copy: queued for `queued` businesses (`missing` had no e-mail); the mail queue counts `sent` / `failed`. */
  email?: { queued: number; sent: number; failed: number; missing: number };
};
/** Kept in the registry: the newest ANNOUNCEMENTS_KEEP (withdrawn ones go first). */
export const ANNOUNCEMENTS_KEEP = 200;
/** At most this many live announcements go to one café (the newest). */
export const ANNOUNCEMENTS_PER_CAFE = 100;
const key = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), id = z.string().min(1).max(100);
const titleSchema = z.string().transform(announcementTitle).pipe(z.string().min(3, 'Başlık en az 3 harf olmalı.').max(ANNOUNCEMENT_TITLE_MAX));
const textSchema = z.string().max(ANNOUNCEMENT_TEXT_MAX + 200).transform(t => announcementText(t)).pipe(z.string().min(3, 'Duyuru metnini yazın.').max(ANNOUNCEMENT_TEXT_MAX));
const audienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('packages'), packageIds: z.array(id).min(1).max(50) }).strict(),
  z.object({ kind: z.literal('selected'), tenantIds: z.array(id).min(1).max(5000) }).strict(),
]);
export type AudienceInput = z.infer<typeof audienceSchema>;

/** Businesses an announcement can reach: activated (they have a computer) and not suspended (a chosen one may be suspended). */
const reachable = (b: MerkezBusiness) => !!b.installId;
/** The businesses of an audience, now. */
export function resolveAudience(d: MerkezData, a: AudienceInput): { tenants: string[]; audience: AnnouncementAudience } {
  if (a.kind === 'all') return { tenants: d.businesses.filter(b => reachable(b) && !b.suspended).map(b => b.tenantId), audience: { kind: 'all' } };
  if (a.kind === 'packages') {
    const packages = (d.catalog?.packages ?? []).filter(p => a.packageIds.includes(p.id));
    if (packages.length !== new Set(a.packageIds).size) throw new DomainError('PACKAGE_NOT_FOUND', 'Seçilen paketlerden biri bulunamadı. Listeyi yenileyin.', 404);
    const ids = new Set(packages.map(p => p.id));
    return { tenants: d.businesses.filter(b => reachable(b) && !b.suspended && !!b.services?.packageId && ids.has(b.services.packageId)).map(b => b.tenantId), audience: { kind: 'packages', packageIds: packages.map(p => p.id), names: packages.map(p => p.name) } };
  }
  const chosen = new Set(a.tenantIds);
  return { tenants: d.businesses.filter(b => reachable(b) && chosen.has(b.tenantId)).map(b => b.tenantId), audience: { kind: 'selected' } };
}
/** "Tüm işletmeler", "Paket: Kafe Standart, Restoran Pro", "Seçili işletmeler" (for the list and İşlem kayıtları). */
export function audienceText(a: AnnouncementAudience) {
  return a.kind === 'all' ? 'Tüm işletmeler' : a.kind === 'packages' ? `Paket: ${(a.names ?? a.packageIds).join(', ')}` : 'Seçili işletmeler';
}
/** The vendor's e-mail can send (settings saved, on, with a sender): only then "E-postayla da gönder" is offered. */
export const emailReady = (d: MerkezData) => { const s = d.mail?.settings; return !!s?.enabled && !!s.host && !!senderOf(s) && (!s.user || !!s.password); };
/** Each business's own e-mail (from its application or typed by the vendor), when it looks like one. */
const emailOf = (b: MerkezBusiness | undefined) => { const e = b?.invoice?.email?.trim(); return e && validAddress(e) ? e : undefined; };

/** For Mola Yönetim: every announcement with who read it ("Okuyan: 32/40") and the businesses that have not. */
export function announcementsView(d: MerkezData) {
  const names = new Map(d.businesses.map(b => [b.tenantId, b.name]));
  return [...(d.announcements ?? [])].reverse().map(a => {
    const targets = a.tenants.filter(t => names.has(t)), read = targets.filter(t => a.reads[t]), acknowledged = targets.filter(t => a.reads[t]?.ackAt);
    return { id: a.id, title: a.title, text: a.text, important: a.important, audience: a.audience, audienceText: audienceText(a.audience), createdAt: a.createdAt, ...(a.editedAt ? { editedAt: a.editedAt } : {}), ...(a.withdrawnAt ? { withdrawnAt: a.withdrawnAt } : {}),
      total: targets.length, read: read.length, acknowledged: acknowledged.length, ...(a.email ? { email: a.email } : {}),
      businesses: targets.map(t => ({ tenantId: t, name: names.get(t)!, ...(a.reads[t] ? { readAt: a.reads[t].readAt, by: a.reads[t].by, ...(a.reads[t].ackAt ? { ackAt: a.reads[t].ackAt } : {}) } : {}) })) };
  });
}
export type AnnouncementView = ReturnType<typeof announcementsView>[number];

/**
 * The heartbeat part (inside the registry transaction): read marks from this café are kept (the first read, the owner's
 * "Okudum" once), and the answer for it. Undefined when the café did not ask (an older café, or its first heartbeat after
 * this Merkez was updated): nothing is sent then.
 */
export function deliverAnnouncements(d: MerkezData, owned: Set<string>, asked: SyncRequest['announcements']) {
  if (!asked) return undefined;
  const live = (d.announcements ?? []).filter(a => !a.withdrawnAt);
  for (const r of asked.reads) {
    const a = live.find(x => x.id === r.id);
    if (!a || !owned.has(r.tenantId) || !a.tenants.includes(r.tenantId)) continue;
    const old = a.reads[r.tenantId];
    a.reads[r.tenantId] = { readAt: old && old.readAt <= r.readAt ? old.readAt : r.readAt, by: old && old.readAt <= r.readAt ? old.by : r.by, ...(old?.ackAt ?? r.ackAt ? { ackAt: old?.ackAt ?? r.ackAt } : {}) };
  }
  const mine = live.filter(a => a.tenants.some(t => owned.has(t))).slice(-ANNOUNCEMENTS_PER_CAFE), known = new Map(asked.known.map(k => [k.id, k.v]));
  return {
    active: mine.map(a => ({ id: a.id, v: a.v })),
    items: mine.filter(a => known.get(a.id) !== a.v).map((a): AnnouncementDelivery => ({ id: a.id, v: a.v, title: a.title, text: a.text, important: a.important, sentAt: a.createdAt, ...(a.editedAt ? { editedAt: a.editedAt } : {}), tenants: a.tenants.filter(t => owned.has(t)) })),
  };
}
/** A deleted business leaves every announcement (it is no longer counted in "Okuyan: X/Y"). */
export function forgetAnnouncementsOf(d: MerkezData, tenant: string) {
  for (const a of d.announcements ?? []) { a.tenants = a.tenants.filter(t => t !== tenant); delete a.reads[tenant]; }
}
/** The mail queue (server/merkez/mail.ts) counts each copy once: sent, or failed after its last retry. */
export function countAnnouncementMail(d: MerkezData, announcementId: string, sent: boolean) {
  const a = d.announcements?.find(x => x.id === announcementId);
  if (a?.email) { if (sent) a.email.sent++; else a.email.failed++; }
}

type Deps = { store: MerkezStore; now: () => Date; admin: (req: Request) => unknown; change: (req: Request) => unknown; once: <T>(d: MerkezData, scope: string, b: object, fn: () => T) => T };
/**
 * GET  /api/merkez/admin/announcements           list with read counts, whether e-mail can go
 * POST /api/merkez/admin/announcements           { requestId, title, text, important, audience, email? } (step-up)
 * POST /api/merkez/admin/announcements/edit      { requestId, id, title, text, important } (step-up; the café shows "düzenlendi")
 * POST /api/merkez/admin/announcements/withdraw  { requestId, id } (step-up; gone from the cafés with their next heartbeat)
 */
export function announcementRoutes(app: Express, o: Deps) {
  const at = () => o.now().toISOString();
  const find = (d: MerkezData, announcementId: string) => {
    const a = d.announcements?.find(x => x.id === announcementId);
    if (!a) throw new DomainError('NOT_FOUND', 'Duyuru bulunamadı. Listeyi yenileyin.', 404);
    if (a.withdrawnAt) throw new DomainError('WITHDRAWN', 'Bu duyuru geri çekildi; değiştirilemez.', 409);
    return a;
  };
  app.get('/api/merkez/admin/announcements', (req, res) => { o.admin(req); const d = o.store.read(); res.json({ announcements: announcementsView(d), emailReady: emailReady(d) }); });
  app.post('/api/merkez/admin/announcements', (req, res) => {
    o.change(req);
    const b = z.object({ requestId: key, title: titleSchema, text: textSchema, important: z.boolean(), audience: audienceSchema, email: z.boolean().optional() }).strict().parse(req.body);
    res.json(o.store.mutate(d => o.once(d, 'announcement', b, () => {
      const { tenants, audience } = resolveAudience(d, b.audience);
      if (!tenants.length) throw new DomainError('NO_AUDIENCE', 'Bu hedefte duyuru gidecek işletme yok (etkinleştirilmiş ve askıda olmayan işletmeler sayılır).', 409);
      if (b.email && !emailReady(d)) throw new DomainError('EMAIL_OFF', 'E-posta ayarları kapalı ya da eksik: Ayarlar → E-posta bildirimleri.', 409);
      const time = at(), a: Announcement = { id: randomUUID(), v: 1, title: b.title, text: b.text, important: b.important, audience, tenants, createdAt: time, reads: {} };
      // E-posta copy: one message per business with an e-mail; the queue sends and retries them and counts on `a.email`.
      if (b.email) {
        const byId = new Map(d.businesses.map(x => [x.tenantId, x])), to = tenants.map(t => emailOf(byId.get(t))).filter((e): e is string => !!e);
        const body = `${b.text}\n\n${b.important ? 'Bu duyuru önemlidir. ' : ''}Mola’da Destek → Duyurular bölümünden de okuyabilir, “Bu konuda Mola ekibine yaz” ile bize yazabilirsiniz.\n\nMola ekibi`;
        for (const address of to) queueMail(d, time, `Mola: ${b.title}`, body, undefined, address).announcementId = a.id;
        a.email = { queued: to.length, sent: 0, failed: 0, missing: tenants.length - to.length };
      }
      (d.announcements ??= []).push(a);
      if (d.announcements.length > ANNOUNCEMENTS_KEEP) { const drop = d.announcements.length - ANNOUNCEMENTS_KEEP, gone = [...d.announcements.filter(x => x.withdrawnAt), ...d.announcements.filter(x => !x.withdrawnAt)].slice(0, drop); d.announcements = d.announcements.filter(x => !gone.includes(x)); }
      d.audit.push({ action: 'announcement.sent', target: 'merkez', at: time, by: 'admin', detail: `“${a.title}” · ${audienceText(audience)} · ${tenants.length} işletme${a.important ? ' · Önemli' : ''}${a.email ? ` · e-posta ${a.email.queued} işletmeye` : ''}` });
      return { id: a.id, tenants: tenants.length, ...(a.email ? { email: a.email } : {}) };
    })));
  });
  app.post('/api/merkez/admin/announcements/edit', (req, res) => {
    o.change(req);
    const b = z.object({ requestId: key, id, title: titleSchema, text: textSchema, important: z.boolean() }).strict().parse(req.body);
    res.json(o.store.mutate(d => o.once(d, 'announcement-edit', b, () => {
      const a = find(d, b.id), changes: JournalChange[] = [];
      if (a.title !== b.title) changes.push({ field: 'başlık', from: a.title, to: b.title });
      if (a.text !== b.text) changes.push({ field: 'metin', from: a.text.slice(0, 300), to: b.text.slice(0, 300) });
      if (a.important !== b.important) changes.push({ field: 'önemli', from: a.important ? 'evet' : 'hayır', to: b.important ? 'evet' : 'hayır' });
      if (!changes.length) return { ok: true, changed: false };
      const time = at();
      a.title = b.title; a.text = b.text; a.important = b.important; a.v++; a.editedAt = time;
      d.audit.push({ action: 'announcement.edited', target: 'merkez', at: time, by: 'admin', detail: `“${a.title}” · ${audienceText(a.audience)} · ${a.tenants.length} işletme · değişen: ${changes.map(c => c.field).join(', ')}`, changes });
      return { ok: true, changed: true };
    })));
  });
  app.post('/api/merkez/admin/announcements/withdraw', (req, res) => {
    o.change(req);
    const b = z.object({ requestId: key, id }).strict().parse(req.body);
    res.json(o.store.mutate(d => o.once(d, 'announcement-withdraw', b, () => {
      const a = find(d, b.id), time = at();
      a.withdrawnAt = time;
      const read = a.tenants.filter(t => a.reads[t]).length;
      d.audit.push({ action: 'announcement.withdrawn', target: 'merkez', at: time, by: 'admin', detail: `“${a.title}” · ${audienceText(a.audience)} · ${a.tenants.length} işletme · okuyan ${read}` });
      return { ok: true };
    })));
  });
}
