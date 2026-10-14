import type { Express, Request } from 'express';
import { SOCIAL_CODE } from '../../packages/domain/social-links.js';
import { clientKey } from '../http-security.js';
import { ExpiringStore } from '../expiring-store.js';
import type { SyncRequest, SyncResponse } from '../sync-protocol.js';
import { molaPage, newSocialCode, page, takenCodes } from './social.js';
import { licenseFeatures, type Install, type MerkezBusiness, type MerkezData, type MerkezStore } from './store.js';

/*
 * Kalıcı bağlantı (14 Ekim). Laptops and phones open the café computer by its network address (http://192.168.1.104:3000),
 * which changes when the modem gives the computer another one. Each business gets one permanent, unguessable Merkez link
 * `<base>/k/<code>` instead:
 *   - the café sends the addresses it serves Mola on (`lan`, only to a Merkez that lists 'lan.link', only while it serves its
 *     network); Merkez keeps them on the install with the public address the heartbeat came from (clientKey: IPv4, or the
 *     IPv6 /64; behind the local Caddy, express trusts only the loopback proxy, so req.ip is the café's own address) and when;
 *     a heartbeat without `lan` (network off, or an older café) clears them;
 *   - each business gets a random 10-character code once (the same alphabet and pool as the social and menu codes, never one
 *     of theirs), never changed: the link saved on a laptop keeps working;
 *   - GET /k/<code> (public, outside /api so not even the request log sees it; limited per address like /s/): when the café
 *     was heard from within FRESH_MS and the visitor comes from the same public address (= the café's own network), 302 to
 *     the café computer's first address. Otherwise a small Mola page that says why, with "İşletmedeyim, yine de aç" (the
 *     address itself: harmless elsewhere, a private address opens nothing outside the café; useful when the phone reaches
 *     Merkez over another route, e.g. IPv6 while the café computer used IPv4) and, when the licence gives Raporlarım
 *     ('remote-reports'), a way to the owner's reports from anywhere.
 * The licence is not asked: a suspended or ended business still gets the page or the redirect. Nothing is exposed (the
 * address is the café's own private one; the café computer itself enforces its licence), and an owner whose licence ended
 * still needs to reach the computer to sort it out. A deleted business takes its code with it (404, like /s/), and a
 * revoked install's addresses are never used. Nothing about the visitor is written anywhere.
 */
/** Three missed heartbeats (every 10 minutes): after that the café computer counts as off. */
const FRESH_MS = 30 * 60_000;

/** The heartbeat's `lan` part: kept on the install (or cleared), each business's code given once; the answer for the café. */
export function recordLan(d: MerkezData, install: Install, mine: MerkezBusiness[], sent: SyncRequest['lan'], client: string, time: string, publicOrigin?: string): SyncResponse['lanLink'] | undefined {
  if (!sent) { delete install.lan; return undefined; }
  install.lan = { origins: sent.origins.slice(0, 4), client, at: time };
  const taken = takenCodes(d), codes: { tenantId: string; code: string }[] = [];
  for (const biz of mine) {
    if (!biz.lanCode) { biz.lanCode = newSocialCode(taken); taken.add(biz.lanCode); }
    codes.push({ tenantId: biz.tenantId, code: biz.lanCode });
  }
  return { ...(publicOrigin ? { base: publicOrigin } : {}), codes };
}

const escape = (v: string) => v.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const CSS = '.actions{display:grid;gap:10px;margin-top:22px}.actions a{display:block;padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:600;font-size:15px}.go{background:var(--brand);color:var(--card)}.alt{border:1px solid var(--muted);color:var(--ink)}';
/** The page when the visitor is not sent on: the business's name (the code is secret, so the name says nothing new). */
function lanPage(e: Entry, fresh: boolean, reportsUrl: string) {
  const [tr, en] = fresh ? ['Bu bağlantı, işletmenin Wi-Fi\'sindeyken kasa bilgisayarındaki Mola\'yı açar.', 'This link opens Mola on the register computer while you are on the business\'s Wi-Fi.']
    : ['Kasa bilgisayarı şu an kapalı ya da internete bağlı değil.', 'The register computer is off or not connected to the internet right now.'];
  const buttons = [e.origin ? `<a class="go" href="${e.origin}/">İşletmedeyim, yine de aç</a>` : '', e.reports ? `<a class="alt" href="${reportsUrl}">Raporlarım'ı aç</a>` : ''].join('');
  return molaPage(fresh ? 'elsewhere' : 'off', `<h1>${escape(e.name)}</h1><p>${tr}</p><p lang="en">${en}</p>${buttons ? `<div class="actions">${buttons}</div>` : ''}`, `${escape(e.name)} · Mola`, CSS);
}

type Entry = { name: string; origin?: string; client?: string; at?: number; reports: boolean };
export function lanLinkRoutes(app: Express, deps: { store: MerkezStore; now: () => Date; publicOrigin?: string }) {
  const { store, now } = deps;
  // Raporlarım is on Merkez's own address (not the web site's); without PUBLIC_ORIGIN (development) on this same address.
  const reportsUrl = `${deps.publicOrigin ?? ''}/raporlarim`;
  // Per address, as /s/: 60 a minute is far more than anyone opening a saved link needs, and little for someone trying codes.
  type Counter = { count: number; until: number };
  const counters = new ExpiringStore<Counter>(v => v.until, () => now().getTime(), 20000, true);
  const allowed = (req: Request) => {
    const t = now().getTime(), k = clientKey(req); let c = counters.get(k);
    if (!c || c.until <= t) { c = { count: 0, until: t + 60_000 }; counters.set(k, c); }
    return ++c.count <= 60;
  };
  // Read again only after the record changed (every heartbeat changes it) or a minute passed (a package change).
  let cache: { generation: number; at: number; byCode: Map<string, Entry> } | undefined;
  const lookup = (code: string) => {
    const t = now().getTime();
    if (!cache || cache.generation !== store.generation || t - cache.at > 60_000) {
      const d = store.read(), byCode = new Map<string, Entry>();
      for (const b of d.businesses) if (b.lanCode) {
        const lan = b.installId ? d.installs.find(i => i.id === b.installId && !i.revokedAt)?.lan : undefined;
        byCode.set(b.lanCode, { name: b.name, reports: licenseFeatures(b).includes('remote-reports'), ...(lan ? { origin: lan.origins[0], client: lan.client, at: Date.parse(lan.at) } : {}) });
      }
      cache = { generation: store.generation, at: t, byCode };
    }
    return cache.byCode.get(code);
  };
  app.get('/k/:code', (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
    if (!allowed(req)) return res.status(429).type('html').send(page('busy'));
    const code = String(req.params.code), entry = SOCIAL_CODE.test(code) ? lookup(code) : undefined;
    if (!entry) return res.status(404).type('html').send(page('missing'));
    const fresh = !!entry.origin && entry.at !== undefined && now().getTime() - entry.at < FRESH_MS;
    if (fresh && clientKey(req) === entry.client) return res.redirect(302, `${entry.origin}/`);
    res.status(200).type('html').send(lanPage(entry, fresh, reportsUrl));
  });
}
