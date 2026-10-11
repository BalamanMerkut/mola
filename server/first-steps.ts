import type { Express, Request } from 'express';
import { z } from 'zod';
import { requireRole } from '../packages/domain/engine.js';
import type { Actor } from '../packages/domain/types.js';
import type { Store } from './store.js';

/** Marks the owner made from the card itself; everything else is read from the live data. */
type Marks = { menu?: string; dismissed?: string };
/** null = not on this install (no key protection: development, tests), so the card leaves the step out. */
export type FirstSteps = { dismissed: boolean; steps: { menu: boolean; staff: boolean; printer: boolean; qr: boolean; recovery: boolean | null; second: boolean | null } };
export type FirstStepsContext = { recovery: () => boolean | null; second: () => boolean | null };

/**
 * "İlk adımlar" on the owner's Masalar after the first setup: check the menu, add staff, a printer, print the QR codes, keep
 * the recovery code and choose a second backup place. Steps tick themselves from the data; the card can be put away.
 * Kept in its own small table (no business data in it), so it travels with every backup like the rest of the database.
 */
export function firstStepsRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, ctx: FirstStepsContext) {
  store.db.exec('CREATE TABLE IF NOT EXISTS first_steps (tenant TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  const marks = (tenant: string): Marks => { try { return JSON.parse((store.db.prepare('SELECT payload FROM first_steps WHERE tenant=?').get(tenant) as { payload: string } | undefined)?.payload ?? '{}'); } catch { return {}; } };
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner']); return a; };
  const view = (tenant: string): FirstSteps => {
    const s = store.read(tenant), m = marks(tenant);
    return { dismissed: !!m.dismissed, steps: {
      // QR: ticked once the table QR codes were printed or downloaded (Ayarlar → Masa QR kodları records the address, State.qrPrint).
      menu: !!m.menu, qr: !!s.qrPrint,
      staff: (s.staffUsers ?? []).some(u => u.active && u.role !== 'owner'),
      printer: !!s.printers?.length,
      recovery: ctx.recovery(), second: ctx.second(),
    } };
  };
  app.get('/api/staff/first-steps', (req, res) => { const a = owner(req); res.json(view(a.tenantId)); });
  app.post('/api/staff/first-steps', (req, res) => {
    const a = owner(req), { step } = z.object({ step: z.enum(['menu', 'dismiss']) }).parse(req.body);
    const next = { ...marks(a.tenantId), [step === 'dismiss' ? 'dismissed' : step]: now().toISOString() };
    store.db.prepare('INSERT INTO first_steps VALUES (?,?) ON CONFLICT(tenant) DO UPDATE SET payload=excluded.payload').run(a.tenantId, JSON.stringify(next));
    res.json(view(a.tenantId));
  });
}
