import type { Express, Request } from 'express';
import { z } from 'zod';
import { requireRole } from '../packages/domain/engine.js';
import type { Actor } from '../packages/domain/types.js';
import type { Store } from './store.js';
import type { UpdateAgent } from './update-agent.js';

/*
 * Otomatik güncelleme for the owner (src/UpdateBanner.tsx): the quiet banner "Yeni sürüm hazır", "Şimdi kur" (only when
 * nothing is open; the server backs up first, then restarts so the watchdog applies it) and "Boşta kendiliğinden kur".
 * Without an agent (tests, development without a package) the state is 'idle' and nothing can be installed.
 */
export function updateRoutes(app: Express, store: Store, staffActor: (req: Request) => Actor, updates?: UpdateAgent) {
  const owner = (req: Request) => { const actor = staffActor(req); requireRole(store.read(actor.tenantId), actor, ['owner']); return actor; };
  const view = () => updates?.view() ?? { current: '', state: 'idle', version: null, notes: '', error: null, from: null, seen: true, progress: null, idleInstall: true, idleMinutes: 20, canInstallNow: false, openAccounts: 0, pendingOrders: 0, restartable: false };
  app.get('/api/staff/update', (req, res) => { owner(req); res.json(view()); });
  app.post('/api/staff/update/settings', (req, res) => {
    owner(req); const b = z.object({ idleInstall: z.boolean() }).strict().parse(req.body);
    updates?.setIdleInstall(b.idleInstall); res.json(view());
  });
  app.post('/api/staff/update/seen', (req, res) => { owner(req); updates?.dismiss(); res.json(view()); });
  app.post('/api/staff/update/install', async (req, res) => {
    owner(req);
    if (!updates) { res.status(409).json({ code: 'NO_UPDATE', message: 'Kurulmayı bekleyen güncelleme yok.' }); return; }
    const restart = await updates.installNow();
    res.json({ ok: true, restarting: true });
    // Answer first; then the server closes (running requests finish) and the watchdog applies the update.
    res.on('finish', () => setTimeout(restart, 300));
  });
}
