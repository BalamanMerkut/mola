import type { Express, Request } from 'express';
import { z } from 'zod';
import { requireRole } from '../packages/domain/engine.js';
import { resolveSounds, setSoundChoice, soundEvents, soundIds } from '../packages/domain/sound-settings.js';
import type { Actor } from '../packages/domain/types.js';
import type { Store } from './store.js';

/*
 * Ayarlar → Sesler: every staff screen reads which sound each event plays (business-wide, so all tablets agree);
 * only the owner changes it. The sounds are made in the browser (src/sounds.ts); nothing here is an audio file.
 */
export function soundSettingsRoutes(app: Express, store: Store, staffActor: (req: Request) => Actor, now: () => Date) {
  app.get('/api/staff/sounds', (req, res) => {
    const a = staffActor(req), s = store.read(a.tenantId);
    requireRole(s, a, ['owner', 'manager', 'cashier', 'waiter', 'kitchen', 'support']);
    res.json(resolveSounds(s.sounds));
  });
  app.post('/api/staff/sounds', (req, res) => {
    const a = staffActor(req);
    const b = z.object({ event: z.enum(soundEvents), sound: z.enum(soundIds).optional(), on: z.boolean().optional() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => setSoundChoice(s, a, b, now())));
  });
}
