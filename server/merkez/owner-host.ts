import type { Express } from 'express';
import { hostName } from '../http-security.js';
import { MERKEZ_API } from '../sync-protocol.js';
import { separateOrigin } from './menu-host.js';
import { noticePage } from './notice-page.js';
import { ownerPage } from './remote-admin.js';

/*
 * Kafemi yönet'in kendi adresi (16 Ekim, sahibin kararı): the owner's page ("Kafemi yönet": sign-in, reports, the café's own
 * screens through the sealed tunnel) runs on its OWN origin, e.g. https://kafem.molayazilim.com.tr, so owners never see
 * "merkez" (Mola Yönetim's name) and the page's device keys (IndexedDB) never share an origin with Mola Yönetim's cookies.
 * Modelled on the guest menu's own name (menu-host.ts). MERKEZ_OWNER_ORIGIN names it:
 *   - on that name Merkez answers only the owner's things: the page at "/" (index.html as Kafemi yönet), its built files
 *     (/assets/…, the icons the page names) and exactly the calls the page makes (POST /api/merkez/v1/phone/login/start,
 *     login, live, status, postbox, forget, admin); /yonet and its typed variants there are a 308 to "/" (typed by hand);
 *     everything else is 404 (no Mola Yönetim, no /api/merkez/admin, no /q/, /s/, /k/, no café calls);
 *   - on Merkez's own name the page is not served: /yonet, /raporlarim and their typed variants are a plain 404 like any
 *     unknown address (no customer used the old address yet: the owner's decision, no redirect kept for it);
 *   - the cafés learn the address with the heartbeat (`ownerHost.base`; Ayarlar → Uzaktan erişim shows it) and /k/<kod> off
 *     the café's network goes there; the web site's /yonet, /raporlarim, /kafemi-yonet pages send typed addresses there.
 * Without it (development, tests, an older setup) nothing changes: Kafemi yönet is <Merkez>/yonet.
 */
export function ownerOrigin(publicOrigin?: string, siteOrigin?: string, menuOrigin?: string, value = process.env.MERKEZ_OWNER_ORIGIN) {
  return separateOrigin('MERKEZ_OWNER_ORIGIN', 'https://kafem.molayazilim.com.tr', value, [publicOrigin, siteOrigin, menuOrigin]);
}
export const ownerHostName = (origin: string) => new URL(origin).hostname.toLowerCase();

/** The calls the page makes (src/ReportsPhone.tsx, packages/domain/remote-login.ts, src/remoteTransport.ts), each exactly. */
const OWNER_CALLS = new RegExp(`^${MERKEZ_API.replace(/\//g, '\\/')}\\/phone\\/(login\\/start|login|live|status|postbox|forget|admin)\\/?$`, 'i');
/** The page's built files: Vite's hashed /assets/<file> and the icons index.html names (the manifest is removed: ownerHtml). */
const OWNER_FILES = /^\/(assets\/[A-Za-z0-9_-][A-Za-z0-9._-]*|favicon(-16|-32)?\.(png|svg)|icon-(192|512)\.png|apple-touch-icon\.png)$/;
/** Development only (Mola Merkez on Vite, no build): the dev server's own paths (its allow-list guards them further). */
const DEV_FILES = /^\/(src|node_modules|@vite|@id|@fs|@react-refresh)(\/|$)/;

/**
 * Registered first (before the guest menu's routes and the host check). `menuName`: the guest menu's own name, left to
 * menuHostRoutes (everything but /q/ is 404 there). `development`: Merkez serves its screens through Vite (no built dist/),
 * so the page's files have Vite's paths.
 */
export function ownerHostRoutes(app: Express, origin: string, o: { menuName?: string; development?: boolean } = {}) {
  const name = ownerHostName(origin);
  app.use((req, res, next) => {
    const read = ['GET', 'HEAD'].includes(req.method), host = hostName(req.headers.host);
    const typed = read && (req.path === '/yonet' || !!ownerPage(req.path));
    if (host !== name) {
      if (!typed || host === o.menuName) return next();
      // Merkez's own name: the owner's page is not here, the same 404 page as any unknown address (server/merkez/runtime.ts).
      res.status(404).type('html').set('Cache-Control', 'no-store').send(missingPage(origin)); return;
    }
    res.set('X-Robots-Tag', 'noindex');
    if (typed) { const q = req.originalUrl.indexOf('?'); res.set('Cache-Control', 'no-store'); res.redirect(308, `/${q >= 0 ? req.originalUrl.slice(q) : ''}`); return; }
    // The page itself (server/merkez/runtime.ts serves index.html as Kafemi yönet with "/" as its home).
    if (read && req.path === '/') { res.locals.molaPage = 'index.html'; res.locals.molaOwner = true; res.locals.molaOwnerHome = '/'; res.locals.molaOwnerHost = true; return next(); }
    if ((read && (OWNER_FILES.test(req.path) || (o.development && DEV_FILES.test(req.path)))) || (req.method === 'POST' && OWNER_CALLS.test(req.path))) { res.locals.molaOwnerHost = true; return next(); }
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
    if (req.path.startsWith('/api/')) { res.status(404).json({ code: 'NOT_FOUND', message: 'Bulunamadı.' }); return; }
    res.status(404).type('html').send(missingPage('/'));
  });
}
/** "Bu sayfa bulunamadı." with one plain link to Kafemi yönet (server/merkez/runtime.ts uses it for every unknown address). */
export const missingPage = (owner: string) => noticePage({ status: 'missing', tr: 'Bu sayfa bulunamadı.', en: 'This page could not be found.', link: { href: owner === '/' || owner === '/yonet' ? owner : `${owner}/`, text: 'Kafemi yönet’e git' } });
