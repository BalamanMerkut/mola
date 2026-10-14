import type { Express, Request, Response } from 'express';
import { createHash } from 'node:crypto';
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
 *   - GET /k/<code> (public, outside /api so not even the request log sees it; limited per address like /s/), no page in
 *     between (0.1.21, the owner's own test: the old page led nowhere useful outside the café):
 *       on the café's network (heard from within FRESH_MS, the visitor from the same public address) → 302 to the café
 *       computer's first address, its usual sign-in;
 *       anywhere else, with Raporlarım in the licence ('remote-reports') → 302 to <Merkez>/yonet#k=<code> (Kafemi yönet; the last
 *       report shows even while the café computer is off; the page offers "Kafedeyim, kasayı aç" with the code it was given);
 *       without it → a small page: not in the package, the link opens the register at the café, how to reach the Mola team;
 *     `?kafe=1` ("Kafedeyim, kasayı aç": the phone reached Merkez over IPv6 while the café computer used IPv4, so the two
 *     public addresses differ inside the café) → 302 to the last address Merkez knows, whatever the freshness. A private
 *     address opens nothing outside the café, so nothing is exposed. Never anything that leads to Mola Yönetim.
 *   - "Bu cihaza kısayol ekle" (0.1.21): GET /k/<code>/kur ("Mola'yı bu cihaza ekle"), its web app manifest
 *     /k/<code>/manifest.webmanifest (id, start_url and scope "/k/<code>/": the start address is inside the scope, and the
 *     installed icon opens /k/<code>/, so the redirects above) and /k/<code>/sw.js. The service worker is there only because
 *     Chrome and Edge still offer their install prompt (beforeinstallprompt) only to a page with a fetch handler; it keeps
 *     nothing and answers nothing (every request goes to the network untouched). iPhone, iPad and Safari on a Mac get no
 *     manifest: their home screen / Dock apps keep storage apart from Safari, where Raporlarım's device keys live, so the page
 *     tells them to add a Safari shortcut (iOS 26: "Web Uygulaması olarak aç" off) or a bookmark instead.
 * The licence's state is not asked: a suspended or ended business still gets the redirect (the café computer itself enforces
 * its licence, and an owner whose licence ended still needs to reach it to sort it out). A deleted business takes its code
 * with it (404, like /s/), and a revoked install's addresses are never used. Nothing about the visitor is written anywhere.
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
const CSS = '.actions{display:grid;gap:10px;margin-top:22px}.actions a,.actions button{display:block;width:100%;padding:13px 16px;border-radius:12px;border:0;text-decoration:none;font:inherit;font-weight:600;font-size:15px;cursor:pointer}.go{background:var(--brand);color:var(--card)}.alt{border:1px solid var(--muted)!important;background:none;color:var(--ink)}'
  + '.how{margin-top:18px;text-align:left;font-size:15px;color:var(--ink)}.how ol{margin:0;padding-left:22px}.how li+li{margin-top:6px}.how p{margin-top:8px}.note{margin-top:14px;font-size:13px}[hidden]{display:none!important}';
/** The café owner's contact with the Mola team: the web site's contact page, the vendor's phone and e-mail (as Mola Yönetim keeps them). */
type Contact = { site?: string; phone?: string; email?: string };
const telHref = (v: string) => `tel:${v.trim().startsWith('+') ? '+' : ''}${v.replace(/\D/g, '')}`;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
function contactLinks(c: Contact) {
  return [c.site ? `<a class="go" href="${escape(c.site)}">Mola ekibine ulaşın</a>` : '', c.phone && /\d{7,}/.test(c.phone.replace(/\D/g, '')) ? `<a class="alt" href="${escape(telHref(c.phone))}">${escape(c.phone)}</a>` : '',
    c.email && EMAIL.test(c.email) ? `<a class="alt" href="mailto:${escape(c.email)}">${escape(c.email)}</a>` : ''].join('');
}
/** Without Raporlarım in the licence, outside the café: no page leads anywhere else (never to Mola Yönetim). */
function noRemotePage(e: Entry, code: string, contact: Contact) {
  const links = [e.origin ? `<a class="alt" href="/k/${code}?kafe=1">Kafedeyim, kasayı aç</a>` : '', contactLinks(contact)].join('');
  return molaPage('no-remote', `<h1>${escape(e.name)}</h1><p>Uzaktan erişim paketinizde yok. Kafedeyken bu bağlantı kasayı açar. Paket için Mola ekibine ulaşın.</p><p lang="en">Remote access is not in your package. At the business, this link opens the register.</p>${links ? `<div class="actions">${links}</div>` : ''}`, `${escape(e.name)} · Mola`, CSS);
}

/*
 * "Mola'yı bu cihaza ekle": the page script. Constant (the business's code and name are in data attributes), so the page's
 * CSP allows exactly this script by its hash. It shows the one way that works on this browser; on Chrome and Edge the
 * button opens the browser's own install prompt.
 */
const KUR_SCRIPT = `(() => {
  const base = document.getElementById('kur').dataset.base, ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const firefox = /Firefox\\/|FxiOS/.test(ua), android = /Android/.test(ua);
  const macSafari = !ios && /Macintosh/.test(ua) && /Safari\\//.test(ua) && !/Chrome\\/|Chromium|Edg\\//.test(ua);
  const button = document.getElementById('add');
  const show = id => { for (const el of document.querySelectorAll('[data-how]')) el.hidden = el.dataset.how !== id; };
  // The address a shortcut or a bookmark keeps: the permanent link itself, not this page.
  history.replaceState(null, '', base + '/');
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) { button.hidden = true; show('installed'); return; }
  if (ios || macSafari || firefox) { button.hidden = true; show(ios ? 'ios' : macSafari ? 'mac' : 'firefox'); return; }
  const link = document.createElement('link'); link.rel = 'manifest'; link.href = base + '/manifest.webmanifest'; document.head.append(link);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(base + '/sw.js', { scope: base + '/' }).catch(() => {});
  let asked = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); asked = e; });
  addEventListener('appinstalled', () => { button.hidden = true; show('installed'); });
  button.addEventListener('click', async () => {
    if (!asked) { show(android ? 'android' : 'desktop'); return; }
    const prompt = asked; asked = null;
    try { await prompt.prompt(); const choice = await prompt.userChoice; if (choice && choice.outcome === 'accepted') { button.hidden = true; show('installed'); } } catch { show(android ? 'android' : 'desktop'); }
  });
})();`;
const KUR_HASH = `'sha256-${createHash('sha256').update(KUR_SCRIPT).digest('base64')}'`;
function kurPage(e: Entry, code: string) {
  const name = escape(e.name), line = e.reports ? 'Simge kafedeyken kasayı, dışarıdayken Kafemi yönet’i açar.' : 'Simge kafenin Wi-Fi’sindeyken kasayı açar.';
  return molaPage('kur', `<h1>Mola'yı bu cihaza ekle</h1><p>${name}</p>
<div class="actions" id="kur" data-base="/k/${code}"><button type="button" class="go" id="add">Mola'yı bu cihaza ekle</button></div>
<div class="how" data-how="ios" hidden><ol><li>Alttaki <b>Paylaş</b> düğmesine dokunun.</li><li><b>Ana Ekrana Ekle</b>’ye dokunun. “Web Uygulaması olarak aç” görünürse kapatın, sonra <b>Ekle</b>.</li></ol><p class="note">Simge Safari’de açılır: bu cihazın eşleşmesi Safari’de kayıtlı.</p></div>
<div class="how" data-how="android" hidden><p>Tarayıcının <b>⋮</b> menüsü → <b>Ana ekrana ekle</b>.</p></div>
<div class="how" data-how="desktop" hidden><p>Adres çubuğundaki <b>Yükle</b> simgesine basın; görünmüyorsa tarayıcı menüsünden <b>Uygulamayı yükle</b>.</p></div>
<div class="how" data-how="mac" hidden><p>Safari’de <b>⌘D</b> ile yer işaretlerine ya da Favoriler’e ekleyin. Dock’a eklemeyin: eşleşmeniz Safari’de kalır.</p></div>
<div class="how" data-how="firefox" hidden><p><b>Ctrl+D</b> (Mac’te <b>⌘D</b>) ile yer işaretlerine ekleyin.</p></div>
<div class="how" data-how="installed" hidden><p>Eklendi ✓ Mola’yı artık bu simgeden açın.</p></div>
<p class="note">${line}</p>`, `Mola · ${name}`, CSS, {
    head: '<meta name="theme-color" content="#234c3e"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    tail: `<script>${KUR_SCRIPT}</script>`,
  });
}
/** A web app per business: the start address is the permanent link (inside the scope), the café's own Mola icons. */
const manifest = (e: Entry, code: string) => ({
  id: `/k/${code}/`, name: `Mola · ${e.name}`, short_name: 'Mola', description: 'Kafedeyken kasayı, dışarıdayken Kafemi yönet’i açar.', lang: 'tr', dir: 'ltr',
  start_url: `/k/${code}/`, scope: `/k/${code}/`, display: 'standalone', background_color: '#f6f7f4', theme_color: '#234c3e',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' }, { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});
/** Keeps nothing, answers nothing: every request goes to the network as it is (see the comment at the top). */
const SW = `// Mola · kısayol. Chrome ve Edge "Yükle" önerisini yalnız bir fetch dinleyicisi olan sayfaya gösteriyor; bu dinleyici hiçbir
// şeyi saklamaz ve hiçbir isteğe cevap vermez: her istek ağdan olduğu gibi gider.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => { if (event.request.method !== 'GET') return; });
`;

type Entry = { name: string; origin?: string; client?: string; at?: number; reports: boolean };
export function lanLinkRoutes(app: Express, deps: { store: MerkezStore; now: () => Date; publicOrigin?: string; siteOrigin?: string }) {
  const { store, now } = deps;
  // Kafemi yönet is on Merkez's own address (not the web site's); without PUBLIC_ORIGIN (development) on this same address.
  const reportsUrl = `${deps.publicOrigin ?? ''}/yonet`;
  // Per address, as /s/: 60 a minute is far more than anyone opening a saved link needs, and little for someone trying codes.
  type Counter = { count: number; until: number };
  const counters = new ExpiringStore<Counter>(v => v.until, () => now().getTime(), 20000, true);
  const allowed = (req: Request) => {
    const t = now().getTime(), k = clientKey(req); let c = counters.get(k);
    if (!c || c.until <= t) { c = { count: 0, until: t + 60_000 }; counters.set(k, c); }
    return ++c.count <= 60;
  };
  // Read again only after the record changed (every heartbeat changes it) or a minute passed (a package change).
  let cache: { generation: number; at: number; byCode: Map<string, Entry>; contact: Contact } | undefined;
  const read = () => {
    const t = now().getTime();
    if (!cache || cache.generation !== store.generation || t - cache.at > 60_000) {
      const d = store.read(), byCode = new Map<string, Entry>();
      for (const b of d.businesses) if (b.lanCode) {
        const lan = b.installId ? d.installs.find(i => i.id === b.installId && !i.revokedAt)?.lan : undefined;
        byCode.set(b.lanCode, { name: b.name, reports: licenseFeatures(b).includes('remote-reports'), ...(lan ? { origin: lan.origins[0], client: lan.client, at: Date.parse(lan.at) } : {}) });
      }
      const web = d.contact?.web?.trim(), site = deps.siteOrigin ? `${deps.siteOrigin}/iletisim/` : web && /^https:\/\/[^\s<>"']+$/.test(web) ? web : undefined;
      cache = { generation: store.generation, at: t, byCode, contact: { ...(site ? { site } : {}), ...(d.contact?.phone?.trim() ? { phone: d.contact.phone.trim() } : {}), ...(d.contact?.email?.trim() ? { email: d.contact.email.trim() } : {}) } };
    }
    return cache;
  };
  /** The business of a /k/ request (headers set, limit counted), or undefined when the answer was already sent. */
  const entryOf = (req: Request, res: Response, csp = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'") => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': csp });
    if (!allowed(req)) { res.status(429).type('html').send(page('busy')); return undefined; }
    const code = String(req.params.code), entry = SOCIAL_CODE.test(code) ? read().byCode.get(code) : undefined;
    if (!entry) { res.status(404).type('html').send(page('missing')); return undefined; }
    return { code, entry };
  };
  // "/k/<code>" and "/k/<code>/" (the installed icon's start address).
  app.get('/k/:code', (req, res) => {
    const found = entryOf(req, res); if (!found) return;
    const { code, entry } = found;
    if (entry.origin && req.query.kafe === '1') return res.redirect(302, `${entry.origin}/`);
    const fresh = !!entry.origin && entry.at !== undefined && now().getTime() - entry.at < FRESH_MS;
    if (fresh && clientKey(req) === entry.client) return res.redirect(302, `${entry.origin}/`);
    if (entry.reports) return res.redirect(302, `${reportsUrl}#k=${code}`);
    res.status(200).type('html').send(noRemotePage(entry, code, read().contact));
  });
  app.get('/k/:code/kur', (req, res) => {
    const found = entryOf(req, res, `default-src 'none'; style-src 'unsafe-inline'; script-src ${KUR_HASH}; img-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`); if (!found) return;
    res.status(200).type('html').send(kurPage(found.entry, found.code));
  });
  app.get('/k/:code/manifest.webmanifest', (req, res) => {
    const found = entryOf(req, res); if (!found) return;
    res.status(200).type('application/manifest+json').send(JSON.stringify(manifest(found.entry, found.code)));
  });
  app.get('/k/:code/sw.js', (req, res) => {
    const found = entryOf(req, res); if (!found) return;
    res.set('Cache-Control', 'no-cache').status(200).type('text/javascript').send(SW);
  });
}
