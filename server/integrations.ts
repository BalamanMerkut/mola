import type { Express, Request } from 'express';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import type { Actor } from '../packages/domain/types.js';
import { requireRole, DomainError } from '../packages/domain/engine.js';
import { demoAction } from '../packages/domain/integration-demo.js';
import type { Store } from './store.js';
const contextFor = (a: Actor) => createHash('sha256').update(JSON.stringify(['integration-demo', a.tenantId, a.id])).digest('hex');
export function integrationRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date) {
  app.get('/api/staff/integrations/demo', (req, res) => { const a = actorFor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner']); res.json({ context: contextFor(a), orders: [...(s.integrationDemo ?? [])].reverse() }); });
  app.post('/api/staff/integrations/demo', (req, res) => {
    const a = actorFor(req);
    const b = z.object({ context: z.string().regex(/^[a-f0-9]{64}$/).optional(), requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), action: z.enum(['create', 'preparing', 'ready', 'delivered', 'cancelled']), id: z.string().max(100).optional(), version: z.number().int().positive().optional(), reason: z.string().trim().max(300).optional() }).strict().parse(req.body);
    if (b.context && b.context !== contextFor(a)) throw new DomainError('CONTEXT_CHANGED', 'Bu işlem başka bir işletme veya çalışan hesabına ait.', 409);
    res.json(store.mutate(a.tenantId, s => demoAction(s, a, b, { now: now(), id: randomUUID })));
  });
}
