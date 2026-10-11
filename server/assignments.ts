import type { Express, Request } from 'express';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import type { Actor, State } from '../packages/domain/types.js';
import { floorTables } from '../packages/domain/takeaway.js';
import { MAX_ASSIGNED_AREAS, MAX_ASSIGNED_TABLES, type WaiterAssignments } from '../packages/domain/assignments.js';
import type { Store } from './store.js';

/*
 * Garson masa/bölüm ataması (packages/domain/assignments.ts): Ayarlar → Sipariş ve kasa, owner only like every setting.
 * GET /api/staff/assignments: the switch, every waiter with their sections and tables, and the floor's sections and tables.
 * POST /api/staff/assignments: `{ enabled }` turns it on/off (nothing is forgotten when off), `{ waiter: { id, areas, tables } }`
 * sets one waiter's part. Tables and sections that no longer exist are dropped when read.
 */
const view = (s: State) => {
  const a = s.waiterAssignments ?? {}, tables = floorTables(s), ids = new Set(tables.map(t => t.id));
  const areas = [...new Set(tables.map(t => t.area ?? '').filter(Boolean))];
  const waiters = (s.staffUsers ?? []).filter(u => u.role === 'waiter').map(u => {
    const w = a.waiters?.[u.id];
    return { id: u.id, name: u.name, active: u.active, areas: (w?.areas ?? []).filter(x => areas.includes(x)), tables: (w?.tables ?? []).filter(x => ids.has(x)) };
  });
  return { enabled: !!a.enabled, waiters, areas, tables: tables.map(t => ({ id: t.id, name: t.name, ...(t.area ? { area: t.area } : {}) })) };
};

export function assignmentRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date) {
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner']); return a; };
  app.get('/api/staff/assignments', (req, res) => { const a = owner(req); res.setHeader('Cache-Control', 'no-store'); res.json(view(store.read(a.tenantId))); });
  app.post('/api/staff/assignments', (req, res) => {
    const a = owner(req);
    const b = z.object({ enabled: z.boolean().optional(), waiter: z.object({ id: z.string().min(1).max(100), areas: z.array(z.string().trim().min(1).max(40)).max(MAX_ASSIGNED_AREAS), tables: z.array(z.string().min(1).max(100)).max(MAX_ASSIGNED_TABLES) }).optional() }).strict().parse(req.body);
    res.json(store.mutate(a.tenantId, s => {
      requireRole(s, a, ['owner']);
      const next: WaiterAssignments = { ...(s.waiterAssignments ?? {}), waiters: { ...(s.waiterAssignments?.waiters ?? {}) } };
      if (b.enabled !== undefined) next.enabled = b.enabled;
      if (b.waiter) {
        const user = s.staffUsers?.find(u => u.id === b.waiter!.id);
        if (!user || user.role !== 'waiter') throw new DomainError('NOT_FOUND', 'Garson bulunamadı.', 404);
        const tables = floorTables(s), ids = new Set(tables.map(t => t.id)), areas = new Set(tables.map(t => t.area ?? '').filter(Boolean));
        if (b.waiter.tables.some(id => !ids.has(id)) || b.waiter.areas.some(x => !areas.has(x))) throw new DomainError('TABLES_CHANGED', 'Masa düzeni değişti. Sayfayı yenileyip tekrar seçin.', 409);
        const w = { areas: [...new Set(b.waiter.areas)], tables: [...new Set(b.waiter.tables)] };
        if (w.areas.length || w.tables.length) next.waiters![user.id] = w; else delete next.waiters![user.id];
      }
      s.waiterAssignments = next;
      s.audit.push({ action: 'staff.assignment', actor: a.id, target: b.waiter?.id ?? (b.enabled ? 'on' : 'off'), at: now().toISOString() });
      return view(s);
    }));
  });
}
