import express, { type Express, type Request } from 'express';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { MERKEZ_API } from '../sync-protocol.js';
import { adminRequestSchema, phoneId, RELAY, type RelayReply } from '../relay-protocol.js';
import type { RelayHub } from './relay.js';

/*
 * Sahibin uzaktan yönetimi, Mola Merkez's part (the café's is server/remote-admin.ts). Merkez serves the café's screens at
 * /yonet (index.html of this build, like a Mola destek session) and passes the paired device's sealed requests to the café
 * that owns it (POST /api/merkez/v1/phone/admin, relay kind `admin`). It checks only the device's token and its limits; every
 * request and answer is ciphertext under a key Merkez never has (packages/domain/remote-admin-crypto.ts), and nothing of them
 * is written down here: no table, no log, no audit line (Merkez cannot even tell a right password from a wrong one).
 * Registered before relayRoutes: its body parser must come before the phones' 16 kB one (a product photo is ~9 MB sealed).
 */
type Deps = { limitAddress: (req: Request, purpose: string, max: number, ms: number) => void };
const body = z.object({ phoneId, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), request: adminRequestSchema }).strict();

export function remoteAdminRoutes(app: Express, deps: () => Deps, hub: RelayHub) {
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
  // The café's own screens for the owner's paired device (the page reads the device's keys from this origin's IndexedDB).
  app.get(/^\/yonet\/?$/, (_req, res, next) => { res.locals.molaPage = 'index.html'; next(); });
}
