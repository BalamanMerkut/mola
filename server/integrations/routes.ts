import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError, once, requireRole } from '../../packages/domain/engine.js';
import { APPROVERS, cancelExternalOrder, PLATFORM_IDS, PLATFORMS, publicExternalOrders, REJECT_REASONS, retryExternal, setMenuMapping, unmatchedItems, updatePlatformSettings } from '../../packages/domain/external-orders.js';
import type { Actor } from '../../packages/domain/types.js';
import type { Store } from '../store.js';
import type { IntegrationManager } from './manager.js';

const platform = z.enum(PLATFORM_IDS);
const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const id = z.string().min(1).max(100);

/**
 * Entegrasyonlar (owner) and the platform order steps (owner, cashier, kitchen). Credentials go in once and never come back:
 * the page only learns which fields are "kayıtlı".
 */
export function externalOrderRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, manager: IntegrationManager) {
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner']); return a; };
  app.get('/api/staff/integrations', (req, res) => {
    const a = owner(req), s = store.read(a.tenantId);
    res.json({
      rejectReasons: REJECT_REASONS,
      platforms: PLATFORM_IDS.map(p => {
        const adapter = manager.adapters[p], settings = s.integrationSettings?.[p];
        return { id: p, name: PLATFORMS[p].name, color: PLATFORMS[p].color, available: adapter.available, status: adapter.status, modes: adapter.modes,
          fields: adapter.fields, saved: manager.vault.saved(a.tenantId, p), enabled: !!settings?.enabled, autoAccept: !!settings?.autoAccept, lastOrderAt: settings?.lastOrderAt,
          health: manager.healthOf(a.tenantId, p), mapping: settings?.mapping ?? [], unmatched: unmatchedItems(s, p) };
      }),
      orders: publicExternalOrders(s, 'owner', true).reverse().slice(0, 50),
      products: s.products.filter(p => p.published !== false).map(p => ({ id: p.id, name: p.name, category: p.category })),
    });
  });
  // Saving replaces the platform's credentials; empty fields keep what was saved. Nothing is echoed back.
  app.post('/api/staff/integrations/credentials', (req, res) => {
    const a = owner(req), b = z.object({ platform, values: z.record(z.string().max(60), z.string().max(500)) }).strict().parse(req.body);
    const fields = manager.adapters[b.platform].fields;
    if (!fields.length) throw new DomainError('NO_CREDENTIALS', 'Bu platform anahtar istemez.');
    const unknown = Object.keys(b.values).find(k => !fields.some(f => f.key === k));
    if (unknown) throw new DomainError('INVALID_VALUE', 'Bilinmeyen alan.');
    const merged = { ...(manager.vault.read(a.tenantId, b.platform) ?? {}) };
    for (const f of fields) { const v = b.values[f.key]?.trim(); if (v) merged[f.key] = v; }
    const missing = fields.filter(f => !merged[f.key]);
    if (missing.length) throw new DomainError('FIELDS_REQUIRED', `Eksik alan: ${missing.map(f => f.label).join(', ')}.`);
    manager.vault.save(a.tenantId, b.platform, merged);
    store.mutate(a.tenantId, s => { s.audit.push({ action: 'integration.credentials_saved', actor: a.id, target: b.platform, at: now().toISOString() }); });
    res.json({ saved: manager.vault.saved(a.tenantId, b.platform) });
  });
  app.post('/api/staff/integrations/credentials/remove', (req, res) => {
    const a = owner(req), b = z.object({ platform }).strict().parse(req.body);
    manager.vault.remove(a.tenantId, b.platform);
    store.mutate(a.tenantId, s => { if (s.integrationSettings?.[b.platform]) s.integrationSettings[b.platform]!.enabled = false; s.audit.push({ action: 'integration.credentials_removed', actor: a.id, target: b.platform, at: now().toISOString() }); });
    manager.refresh(a.tenantId);
    res.json({ saved: [] });
  });
  app.post('/api/staff/integrations/settings', (req, res) => {
    const a = owner(req), b = z.object({ platform, enabled: z.boolean().optional(), autoAccept: z.boolean().optional() }).strict().parse(req.body);
    const adapter = manager.adapters[b.platform];
    if (b.enabled && !adapter.available) throw new DomainError('NOT_AVAILABLE', `${adapter.name} için bağlantı izni bekleniyor. Mola ekibi izin ve API anahtarı gelince bağlantıyı açar.`, 409);
    if (b.enabled && adapter.fields.length && manager.vault.saved(a.tenantId, b.platform).length < adapter.fields.length) throw new DomainError('FIELDS_REQUIRED', 'Önce bağlantı bilgilerini kaydedin.', 409);
    const result = store.mutate(a.tenantId, s => updatePlatformSettings(s, a, b, now()));
    manager.refresh(a.tenantId);
    if (b.enabled) void manager.tick(a.tenantId, { forcePoll: b.platform });
    res.json(result);
  });
  app.post('/api/staff/integrations/mapping', (req, res) => {
    const a = owner(req), b = z.object({ platform, key: z.string().min(1).max(100), name: z.string().min(1).max(80), productId: z.string().max(100).nullable() }).strict().parse(req.body);
    res.json(store.mutate(a.tenantId, s => setMenuMapping(s, a, b)));
  });
  // "Deneme siparişi gönder": the built-in test platform gets a realistic order and is read at once.
  app.post('/api/staff/integrations/test-order', async (req, res) => {
    const a = owner(req), b = z.object({ requestId, paidOnline: z.boolean().optional(), deliveryType: z.enum(['kurye', 'gel-al']).optional() }).strict().parse(req.body);
    const s = store.read(a.tenantId);
    if (!s.integrationSettings?.test?.enabled) throw new DomainError('PLATFORM_OFF', 'Önce Deneme platformunu açın.', 409);
    const scope = `${a.tenantId}:${a.id}:test-order:${b.requestId}`;
    if (!store.hasRequest(a.tenantId, scope)) {
      const pending = (s.externalOrders ?? []).filter(e => e.stage === 'pending').length;
      if (pending >= 20) throw new DomainError('TOO_MANY_PENDING', 'Onay bekleyen çok deneme siparişi var. Önce onları kabul edin ya da reddedin.', 429);
    }
    const sent = store.mutate(a.tenantId, live => once(live, a, 'test-order', b.requestId, b, () => {
      const order = manager.test.createOrder(a.tenantId, live.products, now(), b);
      return { externalId: order.externalId, code: order.code };
    }));
    await manager.tick(a.tenantId, { forcePoll: 'test' });
    manager.refresh(a.tenantId);
    const entry = store.read(a.tenantId).externalOrders?.find(e => e.platform === 'test' && e.externalId === sent.externalId);
    res.json({ ...sent, id: entry?.id ?? null });
  });
  // Steps on a platform order, from the "Onay bekliyor" cards (owner, cashier, kitchen).
  app.post('/api/staff/integrations/orders/accept', async (req, res) => {
    const a = actorFor(req), b = z.object({ requestId, id, version: z.number().int().positive() }).strict().parse(req.body);
    res.json(await manager.accept(a.tenantId, a, b));
  });
  app.post('/api/staff/integrations/orders/reject', async (req, res) => {
    const a = actorFor(req), b = z.object({ requestId, id, version: z.number().int().positive(), reason: z.string().max(200) }).strict().parse(req.body);
    res.json(await manager.reject(a.tenantId, a, b));
  });
  app.post('/api/staff/integrations/orders/cancel', (req, res) => {
    // From the integration list (entry id + version) or from a kitchen card (its order id + version).
    const a = actorFor(req), b = z.object({ requestId, id: id.optional(), version: z.number().int().positive().optional(), orderId: id.optional(), orderVersion: z.number().int().positive().optional(), reason: z.string().max(200) }).strict().parse(req.body);
    const result = store.mutate(a.tenantId, s => {
      const entry = b.orderId ? s.externalOrders?.find(e => e.orderId === b.orderId) : s.externalOrders?.find(e => e.id === b.id);
      if (!entry) throw new DomainError('NOT_FOUND', 'Platform siparişi bulunamadı.', 404);
      if (b.orderId && s.orders.find(o => o.id === b.orderId)?.version !== b.orderVersion && entry.stage !== 'cancelled') throw new DomainError('VERSION_CONFLICT', 'Sipariş başka bir ekranda değişti. Güncel durumu kontrol edin.', 409);
      return cancelExternalOrder(s, a, { id: entry.id, version: b.orderId ? entry.version : b.version ?? 0, reason: b.reason }, { now: now(), id: randomUUID });
    });
    manager.refresh(a.tenantId); void manager.tick(a.tenantId);
    res.json(result);
  });
  app.post('/api/staff/integrations/orders/retry', async (req, res) => {
    const a = actorFor(req), b = z.object({ id }).strict().parse(req.body);
    const result = store.mutate(a.tenantId, s => retryExternal(s, a, b.id, now()));
    await manager.tick(a.tenantId);
    res.json(result);
  });
  app.get('/api/staff/integrations/orders', (req, res) => {
    const a = actorFor(req), s = store.read(a.tenantId); requireRole(s, a, APPROVERS);
    res.json({ orders: publicExternalOrders(s, a.role as 'owner' | 'cashier' | 'kitchen'), rejectReasons: REJECT_REASONS });
  });
}
