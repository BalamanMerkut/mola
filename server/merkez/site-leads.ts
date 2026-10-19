import type { Express, Request, Response } from 'express';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { checkSiteLead, SITE_LEAD_MIN_SECONDS, SITE_LEAD_TYPE_NAMES, type SiteLeadInput } from '../../packages/domain/site-lead.js';
import { canonicalOrigin, clientKey } from '../http-security.js';
import { SITE_SOCIAL } from '../license.js';
import { ExpiringStore } from '../expiring-store.js';
import { open, seal } from '../sealing.js';
import { addAlert } from './alerts.js';
import type { JournalChange } from './journal.js';
import type { MerkezData, MerkezStore } from './store.js';

/*
 * Web sitesi talepleri (molayazilim.com.tr → "Destek ve İletişim" formu → Mola Yönetim → Başvurular, "Web sitesi talebi").
 *   Public    GET  /api/site/form    a short-lived form key (HMAC over its issue time; nothing is stored, no cookie)
 *             POST /api/site/talep   the form. Checked again here (packages/domain/site-lead.ts), with three guards that
 *                                    need no outside service: a hidden "website" field people never fill (a filled one
 *                                    gets a calm 200 and nothing is kept), at least SITE_LEAD_MIN_SECONDS between the form
 *                                    key and sending, and limits per address (clientKey: IPv4, IPv6 /64) and overall.
 *             GET  /api/site/iletisim  the vendor's contact from Mola Yönetim (phone, WhatsApp, e-mail, hours) for the site,
 *                                    and (19 Ekim) Mola's social media links for its footer
 *             The site and Merkez share one origin on the VDS (Caddy passes /api/site/* here; docs/VDS_KURULUM.md).
 *   Stored    own table `site_talepleri` in merkez.sqlite (in Merkez's backup), one row per lead sealed with a key of its own
 *             purpose, bound to the lead's id (like Satışlarım). The KVKK tick is kept with its time and the text version.
 *             A closed lead goes LEAD_KEEP_DAYS after it was closed (the Aydınlatma Metni says so); "Sil" removes one now.
 *   Vendor    GET  /api/merkez/admin/site-leads, POST …/status ("Arandı", "Kapandı", "Yeniden aç"), …/note, …/link (after
 *             "İşletme ekle" from the lead), …/delete. Every change is an İşlem kayıtları line; never the person's name,
 *             phone or e-mail there, nor in the bell's alert (which may also go out by e-mail): only type and city.
 * Older Merkez data has no such table: it is made on first start; nothing else in the registry changes.
 */
export type SiteLeadStatus = 'new' | 'called' | 'closed';
export type SiteLead = Omit<SiteLeadInput, 'consent' | 'consentVersion'> & {
  /** "Masa sayısı": only on leads sent before 15 Ekim (the form no longer asks it); kept and shown as it was. */
  tables?: number;
  id: string; createdAt: string; status: SiteLeadStatus; statusAt?: string;
  /** The KVKK Aydınlatma Metni tick: when, and which text version the page showed. */
  consent: { at: string; version: string };
  notes: { at: string; text: string }[];
  /** "İşletme ekle" from this lead made this business. */
  tenantId?: string;
};
export const STATUS_NAMES: Record<SiteLeadStatus, string> = { new: 'Yeni', called: 'Arandı', closed: 'Kapandı' };
/** Closed leads are deleted this many days after closing (KVKK Aydınlatma Metni: "en çok 2 yıl"). */
export const LEAD_KEEP_DAYS = 730;
export const LEAD_LIMITS = { perAddressHour: 5, attemptsPerAddress10Min: 20, perDay: 200, stored: 5000, notes: 50, formKeysPerAddressMinute: 30 } as const;
const FORM_KEY_HOURS = 12, DAY = 86400000;

export class SiteLeadBook {
  private key: Buffer;
  constructor(private store: MerkezStore) {
    store.db.exec('CREATE TABLE IF NOT EXISTS site_talepleri (id TEXT PRIMARY KEY, created INTEGER NOT NULL, status TEXT NOT NULL, closed INTEGER, payload BLOB NOT NULL)');
    this.key = store.subkey('site-talepleri');
  }
  all(): SiteLead[] {
    const rows = this.store.db.prepare('SELECT id, payload FROM site_talepleri ORDER BY created DESC').all() as { id: string; payload: Uint8Array }[];
    return rows.map(r => open<SiteLead>(Buffer.from(r.payload), this.key, `merkez-site-talebi:${r.id}`));
  }
  get(id: string): SiteLead | undefined {
    const r = this.store.db.prepare('SELECT payload FROM site_talepleri WHERE id=?').get(id) as { payload: Uint8Array } | undefined;
    return r ? open<SiteLead>(Buffer.from(r.payload), this.key, `merkez-site-talebi:${id}`) : undefined;
  }
  count() { return (this.store.db.prepare('SELECT COUNT(*) AS n FROM site_talepleri').get() as { n: number }).n; }
  /** Inside the caller's MerkezStore.mutate: the row and its history line are written together. */
  put(l: SiteLead) {
    this.store.db.prepare('INSERT INTO site_talepleri (id, created, status, closed, payload) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, closed=excluded.closed, payload=excluded.payload')
      .run(l.id, Date.parse(l.createdAt), l.status, l.status === 'closed' ? Date.parse(l.statusAt ?? l.createdAt) : null, seal(l, this.key, `merkez-site-talebi:${l.id}`));
  }
  remove(id: string) { this.store.db.prepare('DELETE FROM site_talepleri WHERE id=?').run(id); }
  /** Closed leads past LEAD_KEEP_DAYS go; the number removed. */
  purge(now: Date) { return Number(this.store.db.prepare('DELETE FROM site_talepleri WHERE status=\'closed\' AND closed < ?').run(now.getTime() - LEAD_KEEP_DAYS * DAY).changes); }
}

/** "Talep 1a2b3c4d (Kafe · Elazığ)": how a lead is named in İşlem kayıtları and the bell (no personal data). */
export const leadRef = (l: Pick<SiteLead, 'id' | 'type' | 'city'>) => `Talep ${l.id.slice(0, 8)} (${SITE_LEAD_TYPE_NAMES[l.type]} · ${l.city})`;
export const leadView = (l: SiteLead) => ({ ...l, typeName: SITE_LEAD_TYPE_NAMES[l.type], statusName: STATUS_NAMES[l.status] });
export type SiteLeadView = ReturnType<typeof leadView>;
export function leadCounts(list: SiteLead[]) {
  const n = (s: SiteLeadStatus) => list.filter(l => l.status === s).length;
  return { new: n('new'), called: n('called'), closed: n('closed'), open: n('new') + n('called'), total: list.length };
}

/**
 * The address the social QR codes' short links use (`<base>/s/<code>/<platform>`, server/merkez/social.ts): MERKEZ_SITE_ORIGIN
 * when set (the web site's own HTTPS origin, e.g. https://molayazilim.com.tr, whose Caddy passes /s/* to this Merkez), else
 * Merkez's PUBLIC_ORIGIN as before. Decide before printing QR cards in bulk: a printed code keeps its address.
 */
export function shortLinkOrigin(publicOrigin?: string) {
  const site = process.env.MERKEZ_SITE_ORIGIN?.trim();
  // A wrong value (not an https root address) must never break the heartbeat: then the old address stays.
  try { return site ? canonicalOrigin(site) ?? publicOrigin : publicOrigin; } catch { return publicOrigin; }
}

type Counter = { count: number; until: number };
type Deps = { store: MerkezStore; now: () => Date; admin: (req: Request) => unknown; once: <T>(d: MerkezData, scope: string, b: object, fn: () => T) => T; book?: SiteLeadBook };
export function siteLeadRoutes(app: Express, o: Deps) {
  const book = o.book ?? new SiteLeadBook(o.store);
  app.locals.siteLeads = book;
  const at = () => o.now().toISOString();
  const formKey = o.store.subkey('site-formu');
  const mac = (text: string) => createHmac('sha256', formKey).update(`mola-site-formu:v1:${text}`).digest('base64url');
  // Per-address counters (the oldest addresses are forgotten first; overall ceilings are plain counters).
  const pool = () => new ExpiringStore<Counter>(v => v.until, () => o.now().getTime(), 20000, true);
  const keys = pool(), attempts = pool(), saved = pool(), daily = new Map<string, Counter>();
  /** Form keys already used for a stored lead (a double tap gets the same answer, not a second lead). */
  const used = new ExpiringStore<{ id: string; until: number }>(v => v.until, () => o.now().getTime(), 20000, true);
  const over = (p: ExpiringStore<Counter> | Map<string, Counter>, k: string, max: number, ms: number, take = true) => {
    const t = o.now().getTime(); let c = p.get(k);
    if (!c || c.until <= t) { c = { count: 0, until: t + ms }; p.set(k, c); }
    // take: count this one and say whether it went over; otherwise only ask whether one more would.
    if (take) c.count++;
    return take ? c.count > max : c.count >= max;
  };
  const busy = (res: Response) => res.status(429).json({ code: 'RATE_LIMIT', field: 'form', message: 'Kısa sürede çok fazla deneme yapıldı. Biraz bekleyip yeniden deneyin ya da bize telefonla ulaşın.' });
  const noStore = (res: Response) => res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });

  app.get('/api/site/form', (req, res) => {
    noStore(res);
    if (over(keys, clientKey(req), LEAD_LIMITS.formKeysPerAddressMinute, 60_000)) return busy(res);
    const issued = o.now().getTime(), nonce = randomBytes(12).toString('base64url');
    res.json({ token: `${issued}.${nonce}.${mac(`${issued}.${nonce}`)}`, minSeconds: SITE_LEAD_MIN_SECONDS });
  });

  /*
   * "Mola ekibi iletişim bilgileri" for the site (13 Ekim): Mola Yönetim → Ayarlar → İletişim bilgileri shows on
   * molayazilim.com.tr too (site.js puts the filled fields over what the build wrote from site/config.json). Read-only, the
   * vendor's own public contact (already shown to every café), only these four fields; an empty one is left out (the
   * site keeps its own). The page writes them as text and builds the links from digits and a checked address.
   */
  const contactReads = pool();
  app.get('/api/site/iletisim', (req, res) => {
    if (over(contactReads, clientKey(req), 120, 60_000)) return busy(res);
    const c = o.store.read().contact, out: Record<string, string> = {};
    for (const k of ['phone', 'whatsapp', 'email', 'hours'] as const) if (c?.[k]?.trim()) out[k] = c[k].trim();
    // 19 Ekim: the footer's social links, all four once one was filled in Mola Yönetim ("" = hidden on the site); never
    // filled: no `social`, the site keeps the build's own (site/config.json).
    const social = c?.social ? Object.fromEntries((Object.keys(SITE_SOCIAL) as (keyof typeof SITE_SOCIAL)[]).map(k => [k, c.social?.[k]?.trim() ?? ''])) : undefined;
    res.set({ 'Cache-Control': 'public, max-age=60', 'X-Robots-Tag': 'noindex' }).json({ contact: out, ...(social ? { social } : {}) });
  });

  app.post('/api/site/talep', (req, res) => {
    noStore(res);
    const ip = clientKey(req), body = (req.body ?? {}) as Record<string, unknown>;
    if (over(attempts, ip, LEAD_LIMITS.attemptsPerAddress10Min, 10 * 60_000)) return busy(res);
    // Honeypot: people never see this field. A bot that filled it is told "thank you" and nothing is kept.
    if (typeof body.website === 'string' && body.website.trim()) return res.status(200).json({ ok: true });
    // The form key: ours, at least a few seconds old, not older than FORM_KEY_HOURS.
    const token = typeof body.token === 'string' ? body.token : '', [issuedText, nonce, sig] = token.split('.');
    const issued = Number(issuedText), expected = issuedText && nonce ? mac(`${issuedText}.${nonce}`) : '';
    if (!sig || !expected || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) || !Number.isFinite(issued))
      return res.status(400).json({ code: 'FORM_EXPIRED', field: 'form', message: 'Form süresi doldu. Sayfayı yenileyip yeniden gönderin.' });
    const age = o.now().getTime() - issued;
    if (age > FORM_KEY_HOURS * 3600_000) return res.status(400).json({ code: 'FORM_EXPIRED', field: 'form', message: 'Form süresi doldu. Sayfayı yenileyip yeniden gönderin.' });
    if (age < SITE_LEAD_MIN_SECONDS * 1000) return res.status(400).json({ code: 'TOO_FAST', field: 'form', message: 'Form çok hızlı gönderildi. Birkaç saniye bekleyip yeniden gönderin.' });
    const repeat = used.get(nonce);
    if (repeat) return res.status(200).json({ ok: true, repeat: true });
    const checked = checkSiteLead(body);
    if (!checked.ok) return res.status(400).json({ code: checked.problem.field === 'consent' ? 'CONSENT_REQUIRED' : 'INVALID', field: checked.problem.field, message: checked.problem.message });
    if (over(saved, ip, LEAD_LIMITS.perAddressHour, 3600_000, false) || over(daily, 'all', LEAD_LIMITS.perDay, DAY, false)) return busy(res);
    if (book.count() >= LEAD_LIMITS.stored) { book.purge(o.now()); if (book.count() >= LEAD_LIMITS.stored) return res.status(503).json({ code: 'LEADS_FULL', field: 'form', message: 'Şu anda talep alınamıyor. Lütfen bize telefonla ya da e-postayla ulaşın.' }); }
    const { consent: _c, consentVersion, ...rest } = checked.value, time = at();
    const lead: SiteLead = { ...rest, id: randomUUID(), createdAt: time, status: 'new', consent: { at: time, version: consentVersion }, notes: [] };
    o.store.mutate(d => {
      book.purge(o.now());
      book.put(lead);
      addAlert(d, time, 'site.lead', `Web sitesinden yeni bir talep geldi: ${SITE_LEAD_TYPE_NAMES[lead.type]} · ${lead.city}. Başvurular → Web sitesi talepleri.`, { key: `site:${lead.id}` });
      d.audit.push({ action: 'site.lead_received', target: 'merkez', at: time, by: 'system', detail: `${leadRef(lead)} · KVKK onayı ${lead.consent.version}` });
    });
    over(saved, ip, LEAD_LIMITS.perAddressHour, 3600_000); over(daily, 'all', LEAD_LIMITS.perDay, DAY);
    used.set(nonce, { id: lead.id, until: issued + FORM_KEY_HOURS * 3600_000 });
    res.status(201).json({ ok: true });
  });

  // ---------- Mola Yönetim ----------
  const key = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), id = z.string().uuid();
  const find = (leadId: string) => { const l = book.get(leadId); if (!l) throw new DomainError('NOT_FOUND', 'Talep bulunamadı. Listeyi yenileyin.', 404); return l; };
  app.get('/api/merkez/admin/site-leads', (req, res) => {
    o.admin(req);
    if (book.purge(o.now())) { /* closed ones past their time went just now */ }
    const list = book.all();
    res.json({ leads: list.map(leadView), counts: leadCounts(list) });
  });
  app.post('/api/merkez/admin/site-leads/status', (req, res) => {
    o.admin(req);
    const b = z.object({ requestId: key, id, status: z.enum(['new', 'called', 'closed']) }).strict().parse(req.body);
    res.json(o.store.mutate(d => o.once(d, 'site-lead-status', b, () => {
      const l = find(b.id); if (l.status === b.status) return { ok: true, changed: false };
      const time = at(), from = l.status; l.status = b.status; l.statusAt = time; book.put(l);
      const changes: JournalChange[] = [{ field: 'durum', from: STATUS_NAMES[from], to: STATUS_NAMES[b.status] }];
      d.audit.push({ action: b.status === 'called' ? 'site.lead_called' : b.status === 'closed' ? 'site.lead_closed' : 'site.lead_reopened', target: 'merkez', at: time, by: 'admin', detail: `${leadRef(l)} · ${STATUS_NAMES[from]} → ${STATUS_NAMES[b.status]}`, changes });
      return { ok: true, changed: true };
    })));
  });
  app.post('/api/merkez/admin/site-leads/note', (req, res) => {
    o.admin(req);
    const b = z.object({ requestId: key, id, text: z.string().trim().min(1, 'Notu yazın.').max(500) }).strict().parse(req.body);
    res.json(o.store.mutate(d => o.once(d, 'site-lead-note', b, () => {
      const l = find(b.id), time = at();
      l.notes = [...l.notes, { at: time, text: b.text }].slice(-LEAD_LIMITS.notes); book.put(l);
      // The note itself stays with the lead (it may hold what the person said); the history says only that one was added.
      d.audit.push({ action: 'site.lead_note', target: 'merkez', at: time, by: 'admin', detail: `${leadRef(l)} · not eklendi` });
      return { ok: true };
    })));
  });
  app.post('/api/merkez/admin/site-leads/link', (req, res) => {
    o.admin(req);
    const b = z.object({ requestId: key, id, tenantId: z.string().min(1).max(100) }).strict().parse(req.body);
    res.json(o.store.mutate(d => o.once(d, 'site-lead-link', b, () => {
      const l = find(b.id), biz = d.businesses.find(x => x.tenantId === b.tenantId);
      if (!biz) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
      l.tenantId = biz.tenantId; book.put(l);
      d.audit.push({ action: 'site.lead_linked', target: biz.tenantId, at: at(), by: 'admin', detail: `${leadRef(l)} → işletme eklendi` });
      return { ok: true };
    })));
  });
  app.post('/api/merkez/admin/site-leads/delete', (req, res) => {
    o.admin(req);
    const b = z.object({ requestId: key, id }).strict().parse(req.body);
    res.json(o.store.mutate(d => o.once(d, 'site-lead-delete', b, () => {
      const l = find(b.id); book.remove(l.id);
      d.audit.push({ action: 'site.lead_deleted', target: 'merkez', at: at(), by: 'admin', detail: `${leadRef(l)} silindi` });
      return { ok: true };
    })));
  });
  return book;
}
