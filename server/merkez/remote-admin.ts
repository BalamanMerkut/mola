import express, { type Express, type Request } from 'express';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { MERKEZ_API } from '../sync-protocol.js';
import { adminRequestSchema, phoneId, RELAY, type RelayReply } from '../relay-protocol.js';
import type { RelayHub } from './relay.js';

/*
 * Sahibin uzaktan yönetimi, Mola Merkez's part (the café's is server/remote-admin.ts). Merkez serves "İşletmemi yönet" at /yonet
 * (index.html of this build: the sign-in, the reports and the café's own screens on one page, 0.1.23; the old /raporlarim
 * and every typed variant of either address with Turkish letters, capitals or a slash come here with a 301: `ownerPage`)
 * and passes the paired device's sealed requests to the café
 * that owns it (POST /api/merkez/v1/phone/admin, relay kind `admin`). It checks only the device's token and its limits; every
 * request and answer is ciphertext under a key Merkez never has (packages/domain/remote-admin-crypto.ts), and nothing of them
 * is written down here: no table, no log, no audit line (Merkez cannot even tell a right password from a wrong one).
 * Registered before relayRoutes: its body parser must come before the phones' 16 kB one (a product photo is ~9 MB sealed).
 */
type Deps = { limitAddress: (req: Request, purpose: string, max: number, ms: number) => void };
const body = z.object({ phoneId, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), request: adminRequestSchema }).strict();
/** Turkish letters folded the way an owner may type them (ı/İ → i, ö → o, ü → u, ş → s, ç → c, ğ → g), then lower case. */
const fold = (v: string) => v.replace(/[ıİI]/g, 'i').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u').replace(/[şŞ]/g, 's').replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').toLowerCase();
/**
 * The owner's page for an address as typed: "/yonet" for /Yönet, /raporlarım, /RAPORLARIM/, /raporlarim … (0.1.23: the owner
 * typed /raporlarım and got "Bu sayfa bulunamadı"); undefined for any other address and for /yonet itself.
 */
export function ownerPage(path: string) {
  let p: string; try { p = decodeURIComponent(path); } catch { return undefined; }
  const f = fold(p).replace(/\/+$/, '');
  return (f === '/yonet' || f === '/raporlarim') && path !== '/yonet' ? '/yonet' : undefined;
}

/**
 * index.html as İşletmemi yönet (server/merkez/runtime.ts): its own title and Home Screen name, not indexed, no referrer, and no
 * café manifest or standalone mode (the manifest's start address "/" is Mola Yönetim on Merkez). `home`: where the page is,
 * "/yonet" on Merkez's own name or "/" on its own name (MERKEZ_OWNER_ORIGIN, server/merkez/owner-host.ts); the page reads it
 * (src/ownerHome.ts) to know it is İşletmemi yönet at "/" and where "back to the start" goes.
 */
export const ownerHtml = (html: string, home: '/' | '/yonet' = '/yonet') => html
  .replace(/<link rel="manifest"[^>]*>\s*/, '').replace(/<meta name="(apple-)?mobile-web-app-capable"[^>]*>\s*/g, '')
  .replace(/<title>[^<]*<\/title>/, '<title>İşletmemi yönet · Mola</title>')
  .replace(/(name="(apple-mobile-web-app-title|application-name)" content=")[^"]*/g, '$1İşletmemi yönet')
  .replace('<head>', `<head>\n    <meta name="robots" content="noindex" />\n    <meta name="referrer" content="no-referrer" />\n    <meta name="mola-owner-home" content="${home}" />`);
export function remoteAdminRoutes(app: Express, deps: () => Deps, hub: RelayHub) {
  // Old and typed addresses (a bookmark of /raporlarim keeps working; the same origin, so the device's keys are the same).
  // With İşletmemi yönet on its own name (MERKEZ_OWNER_ORIGIN) these never get here: 404 on Merkez's name (server/merkez/owner-host.ts).
  app.use((req, res, next) => {
    const to = ['GET', 'HEAD'].includes(req.method) ? ownerPage(req.path) : undefined;
    if (!to) return next();
    const q = req.originalUrl.indexOf('?');
    res.redirect(301, to + (q >= 0 ? req.originalUrl.slice(q) : ''));
  });
  // Public (the device proves itself inside the body): counted per address before the body is read, and a large body (a
  // product photo) far more strictly, so nobody makes Merkez buffer and parse 13 MB bodies at will (güvenlik denetimi).
  app.use(`${MERKEZ_API}/phone/admin`, (req, _res, next) => {
    try {
      deps().limitAddress(req, 'phone-admin', 1200, 60_000);
      if (req.headers['transfer-encoding'] !== undefined || Number(req.get('content-length') ?? 0) > 256 * 1024) deps().limitAddress(req, 'phone-admin-large', 30, 60_000);
      next();
    } catch (e) { next(e); }
  }, express.json({ limit: '13mb' }));
  app.post(`${MERKEZ_API}/phone/admin`, async (req, res) => {
    const b = body.parse(req.body), p = hub.phone(b.phoneId, b.token);
    // A screen polls every few seconds (several tabs too); a sign-in is a handful at most.
    hub.take(b.request.op === 'open' ? `admin-open:${b.phoneId}` : `admin:${b.phoneId}`, b.request.op === 'open' ? 10 : 900, 60_000);
    if (b.request.op === 'open' && b.request.phone !== b.phoneId) throw new DomainError('INVALID', 'Geçersiz istek.', 400);
    const reply = await hub.send(p.install, { kind: 'admin', tenantId: p.tenant, phoneId: b.phoneId, request: b.request }, RELAY.REQUEST_TIMEOUT_MS)
      .catch((e: DomainError) => ({ status: e.status ?? 503, json: { code: e.code, message: e.message } }) as RelayReply);
    res.status(reply.status).json(reply.json ?? {});
  });
  // İşletmemi yönet: the sign-in, the reports and the café's own screens (the page reads the device's keys from this origin's
  // IndexedDB; on a VDS only over HTTPS: WebCrypto needs a secure page).
  app.get('/yonet', (_req, res, next) => { res.locals.molaPage = 'index.html'; res.locals.molaOwner = true; next(); });
}
