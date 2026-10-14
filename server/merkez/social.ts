import type { Express, Request } from 'express';
import { randomBytes } from 'node:crypto';
import { cleanSocialLinks, isSocialPlatform, SOCIAL_CODE, socialEntries, type SocialLinks } from '../../packages/domain/social-links.js';
import { clientKey } from '../http-security.js';
import { licenseSummary } from '../license.js';
import { ExpiringStore } from '../expiring-store.js';
import type { SyncRequest, SyncResponse } from '../sync-protocol.js';
import { licenseFeatures, type MerkezBusiness, type MerkezData, type MerkezStore } from './store.js';

/*
 * Sosyal medya kısa adresleri (6 Ekim). The café's permanent social QR codes hold `<Merkez>/s/<code>/<platform>` instead of the
 * link itself, so they stop working while Mola has suspended the business (or its licence ended or is frozen) and work again
 * when it is open, without reprinting:
 *   - the café sends its public links with the heartbeat (`social`, only to a Merkez that lists 'social'); they are checked
 *     here again with the same rules as the café (packages/domain/social-links.ts) and kept on the business record;
 *   - each business gets one random 10-character code the first time, never changed afterwards (an edited link keeps its
 *     printed QR; one business's code says nothing about another's: no counting through them);
 *   - GET /s/<code>/<platform> (public, limited per address like the other public Merkez calls): 302 to the kept link while
 *     the licence is active exactly as the café's guest menu is (licenseSummary().active: not suspended, not frozen, not
 *     ended, trial started; and the café heard from within OFFLINE_DAYS), else a small Mola page "Bu işletmenin bu hizmeti
 *     şu anda kullanılamıyor." (no business data); an unknown code or a platform without a link: 404 page.
 *   - 6 Ekim: the same page while the business's licence does not give "Sosyal medya ve QR kartları" (a paid service now).
 * Nothing about the visitor is written anywhere (this route is outside /api, so not even the request log sees it).
 */
/** The café's own rule (server/kafe-link.ts OFFLINE_DAYS): its guest menu closes after this many days without Merkez. */
const OFFLINE_DAYS = 14, DAY = 86400000;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** 10 characters of 62: about 59 bits, drawn without bias. */
export function newSocialCode(taken: Set<string>) {
  for (;;) {
    let code = '';
    while (code.length < 10) for (const byte of randomBytes(16)) if (byte < 248 && code.length < 10) code += ALPHABET[byte % 62];
    if (!taken.has(code)) return code;
  }
}
/** Every short code given so far (social, menu, Kalıcı bağlantı): a new one never repeats any of them, whatever it is for. */
export const takenCodes = (d: MerkezData) => new Set(d.businesses.flatMap(b => [b.social?.code, b.menu?.code, b.lanCode]).filter((c): c is string => !!c));

/** The heartbeat's `social` part: keeps each listed business's checked links, gives a code once; the answer for the café. */
export function recordSocial(d: MerkezData, mine: MerkezBusiness[], sent: SyncRequest['social'], time: string, publicOrigin?: string): SyncResponse['social'] | undefined {
  if (!sent) return undefined;
  const taken = takenCodes(d);
  const codes: { tenantId: string; code: string }[] = [];
  for (const item of sent) {
    const biz = mine.find(b => b.tenantId === item.tenantId); if (!biz) continue;
    const known = Object.fromEntries(Object.entries(item.links).filter(([k]) => isSocialPlatform(k))) as SocialLinks;
    const links = cleanSocialLinks(known) ?? {};
    if (!biz.social) { const code = newSocialCode(taken); taken.add(code); biz.social = { code, links, updatedAt: time }; }
    else if (JSON.stringify(biz.social.links) !== JSON.stringify(links)) { biz.social.links = links; biz.social.updatedAt = time; }
    codes.push({ tenantId: biz.tenantId, code: biz.social.code });
  }
  return { ...(publicOrigin ? { base: publicOrigin } : {}), codes };
}

/** Mola Yönetim → işletme → Bilgiler: the links as Merkez has them (read-only) and when they last changed. */
export function socialView(b: MerkezBusiness) {
  if (!b.social) return {};
  const entries = socialEntries(b.social.links as SocialLinks);
  return { social: { code: b.social.code, links: Object.fromEntries(entries.map(e => [e.platform, e.url])), updatedAt: b.social.updatedAt } };
}

/**
 * Whether a business's short addresses forward now: the same rule that keeps its guest menu open at the café, and (6 Ekim)
 * "Sosyal medya ve QR kartları" in what its licence gives now (package, Özel, old plan or trial). Without it the links stay
 * kept here (and keep arriving with the heartbeat); the QR forwards again as soon as the service is added.
 */
export function socialOpen(b: MerkezBusiness, d: MerkezData, now: Date) {
  if (!b.installId || !licenseSummary(b, now).active || !licenseFeatures(b).includes('social')) return false;
  const seen = d.installs.find(i => i.id === b.installId)?.lastSeenAt;
  return !!seen && now.getTime() - Date.parse(seen) < OFFLINE_DAYS * DAY;
}

/** The small Mola page of the public short addresses (also Kalıcı bağlantı's, server/merkez/lan-link.ts): `inner` is HTML. */
export const molaPage = (status: string, inner: string, title = 'Mola', css = '') => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>
:root{color-scheme:light dark;--bg:#f4f1ea;--card:#fff;--ink:#22352c;--muted:#66746b;--brand:#2f6b55}
@media (prefers-color-scheme:dark){:root{--bg:#141a17;--card:#1d2621;--ink:#e8eee9;--muted:#9fb0a5;--brand:#7cc3a4}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;padding:16px}
main{max-width:420px;width:100%;background:var(--card);border-radius:20px;padding:32px 24px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.08)}
.mark{display:inline-grid;place-items:center;width:52px;height:52px;border-radius:16px;background:var(--brand);color:var(--card);font-weight:800;font-size:22px;margin-bottom:14px}
h1{font-size:19px;margin:0 0 8px;line-height:1.35}p{margin:0;color:var(--muted);font-size:15px}small{display:block;margin-top:22px;color:var(--muted);font-size:12px}${css}
</style></head><body><main data-status="${status}"><div class="mark" aria-hidden="true">M</div>${inner}<small>Mola</small></main></body></html>`;
export const page = (status: 'unavailable' | 'missing' | 'busy') => {
  const [tr, en] = status === 'unavailable' ? ['Bu işletmenin bu hizmeti şu anda kullanılamıyor.', 'This service of the business is currently unavailable.']
    : status === 'missing' ? ['Bu bağlantı bulunamadı.', 'This link could not be found.']
      : ['Çok sık deneme yapıldı. Biraz bekleyip tekrar deneyin.', 'Too many tries. Please wait a moment and try again.'];
  return molaPage(status, `<h1>${tr}</h1><p lang="en">${en}</p>`);
};

type Entry = { tenantId: string; links: SocialLinks; open: boolean };
export function socialRoutes(app: Express, deps: { store: MerkezStore; now: () => Date }) {
  const { store, now } = deps;
  // Per address: 60 a minute is far more than anyone scanning a QR needs, and little for someone trying codes.
  type Counter = { count: number; until: number };
  const counters = new ExpiringStore<Counter>(v => v.until, () => now().getTime(), 20000, true);
  const allowed = (req: Request) => {
    const t = now().getTime(), k = clientKey(req); let c = counters.get(k);
    if (!c || c.until <= t) { c = { count: 0, until: t + 60_000 }; counters.set(k, c); }
    return ++c.count <= 60;
  };
  // The sealed record is read again only after it changed (or a minute passed: a licence ends with the clock, not a change).
  let cache: { generation: number; at: number; byCode: Map<string, Entry> } | undefined;
  const lookup = (code: string) => {
    const t = now().getTime();
    if (!cache || cache.generation !== store.generation || t - cache.at > 60_000) {
      const d = store.read(), byCode = new Map<string, Entry>(), when = now();
      for (const b of d.businesses) if (b.social) byCode.set(b.social.code, { tenantId: b.tenantId, links: b.social.links as SocialLinks, open: socialOpen(b, d, when) });
      cache = { generation: store.generation, at: t, byCode };
    }
    return cache.byCode.get(code);
  };
  app.get('/s/:code/:platform', (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
    const html = (status: number, kind: Parameters<typeof page>[0]) => { res.status(status).type('html').send(page(kind)); };
    if (!allowed(req)) return html(429, 'busy');
    const code = String(req.params.code), platform = String(req.params.platform);
    const entry = SOCIAL_CODE.test(code) ? lookup(code) : undefined;
    if (!entry) return html(404, 'missing');
    if (!entry.open) return html(200, 'unavailable');
    const url = isSocialPlatform(platform) ? socialEntries(entry.links).find(e => e.platform === platform)?.url : undefined;
    if (!url) return html(404, 'missing');
    res.redirect(302, url);
  });
}
