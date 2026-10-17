import type { Express } from 'express';
import { canonicalOrigin, hostName } from '../http-security.js';
import { noticePage } from './notice-page.js';

/*
 * Misafir menüsünün kendi adresi (11 Ekim, güvenlik denetimi Y1): the guest QR menu (/q/<kod>/…) holds files the cafés send,
 * so it runs on its OWN origin, e.g. https://menu.molayazilim.com.tr, never on Mola Yönetim's (merkez.…, admin cookies, the
 * owner's device keys for Raporlarım / Kafeyi yönet) nor on the web site's. MERKEZ_MENU_ORIGIN names it:
 *   - the cafés' table QR codes and the menu copy's page use it (the heartbeat's `tunnel.base`, and 'guest.menu-origin' in
 *     `accepts` tells a new café the address is a separate menu host);
 *   - Merkez answers /q/* only when the request's Host is that name; on any other name /q/* is a 308 to it (old QR codes
 *     printed with the site's or Merkez's address keep working); on the menu name everything but /q/* is 404 (no Mola Yönetim,
 *     no /api, no /s/: the social short links stay on the web site, they are plain redirects).
 * Without it (a LAN test, Mola Yönetim on a computer before the VDS, an older setup) nothing changes.
 */
export { MENU_ORIGIN_FLAG } from '../sync-protocol.js';
const LOOPBACK_TEST = (name: string) => name === 'localhost' || name.endsWith('.localhost');
/** Browser tests only (MOLA_TEST_TUNNEL=1, never in a release build): a loopback name over plain http, e.g. http://menu.localhost:3590. */
export const testMenuHosts = () => process.env.MOLA_TEST_TUNNEL === '1' && process.env.MOLA_RELEASE_BUILD !== '1';

/**
 * MERKEZ_MENU_ORIGIN as an origin, or undefined: unset, not an https root address, or the same name as Mola Merkez's own
 * PUBLIC_ORIGIN or the web site's (MERKEZ_SITE_ORIGIN): then there is no separate menu host and nothing changes. A wrong value
 * never breaks the heartbeat; it is said once in the log.
 */
export function menuOrigin(publicOrigin?: string, siteOrigin?: string, value = process.env.MERKEZ_MENU_ORIGIN) {
  return separateOrigin('MERKEZ_MENU_ORIGIN', 'https://menu.molayazilim.com.tr', value, [publicOrigin, siteOrigin]);
}
/**
 * A name of its own for one part of Merkez (the guest menu here, İşletmemi yönet in owner-host.ts): an https root address (http
 * only for the browser tests' *.localhost), never one of the `taken` names. Unset or wrong: undefined (a wrong value is said
 * once in the log and never breaks anything).
 */
export function separateOrigin(setting: string, example: string, value: string | undefined, taken: (string | undefined)[]) {
  const raw = value?.trim();
  if (!raw) return undefined;
  let origin: string | undefined;
  try { origin = canonicalOrigin(raw); } catch {
    try {
      const url = new URL(raw);
      if (testMenuHosts() && url.protocol === 'http:' && LOOPBACK_TEST(url.hostname.toLowerCase()) && url.pathname === '/' && !url.search && !url.hash && !url.username) origin = url.origin;
    } catch { /* not an address */ }
  }
  const name = origin ? new URL(origin).hostname.toLowerCase() : '';
  const names = taken.filter((o): o is string => !!o).map(o => new URL(o).hostname.toLowerCase());
  if (!origin || names.includes(name)) { warn(setting, example, raw); return undefined; }
  return origin;
}
const warned = new Set<string>();
function warn(setting: string, example: string, raw: string) {
  if (warned.has(`${setting}:${raw}`)) return; warned.add(`${setting}:${raw}`);
  console.error(`${setting} yok sayıldı (${raw.slice(0, 80)}): Mola Merkez'in, web sitesinin ve öteki adreslerin adından farklı bir https kök adresi olmalı, ör. ${example}`);
}

/** The guest menu's name (host without port) when the menu runs on its own origin. */
export const menuHostName = (origin: string) => new URL(origin).hostname.toLowerCase();

/**
 * Registered first (before the host check): the menu name may reach Merkez only for /q/*; /q/* on another name goes there.
 * `/q` is matched case-insensitively for the redirect (Express routes do) and exactly ('/q/') on the menu name.
 */
export function menuHostRoutes(app: Express, origin: string) {
  const name = menuHostName(origin);
  app.use((req, res, next) => {
    const onMenu = hostName(req.headers.host) === name;
    if (onMenu) {
      if (req.path.startsWith('/q/')) return next();
      res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
      res.status(404).type('html').send(noticePage({ status: 'missing', tr: 'Bu bağlantı bulunamadı.', en: 'This link could not be found.', detail: 'Masanızdaki QR kodunu yeniden okutun.', detailEn: 'Please scan the QR code on your table again.' }));
      return;
    }
    if (/^\/q(\/|$)/i.test(req.path)) {
      // Only GET/HEAD are redirected with their path (a printed QR); a POST to the old name is refused (the page is on the menu name).
      if (!['GET', 'HEAD'].includes(req.method)) { res.status(404).json({ code: 'NOT_FOUND', message: 'Bulunamadı.' }); return; }
      res.set('Cache-Control', 'no-store'); res.redirect(308, origin + req.originalUrl); return;
    }
    next();
  });
}
