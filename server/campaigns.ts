import type { Express, Request } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { DomainError, once, requireRole } from '../packages/domain/engine.js';
import type { Actor } from '../packages/domain/types.js';
import type { Store } from './store.js';
import { campaignTimingError, campaignUsage, campaignViews, weightRuleMessage, type CampaignScope } from '../packages/domain/campaigns.js';
import { soldByWeight } from '../packages/domain/lines.js';
import { menuCategories } from '../packages/domain/categories.js';
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
// null clears a weekly schedule; leaving it out keeps the saved one, so an older open screen cannot drop it unseen.
const schedule = z.object({ days: z.array(z.number().int().min(1).max(7)).min(1).max(7), from: hhmm.optional(), to: hhmm.optional() }).strict().nullable().optional();
const campaignBase = z.object({ schedule, maxQuantity: z.number().int().min(1).max(1_000_000).nullable().optional(), minQuantity: z.number().int().min(1).max(20).optional(), id: z.string().optional(), name: z.string().trim().min(2).max(80), productIds: z.array(z.string()).max(200), categories: z.array(z.string().max(80)).max(40).optional(), excludedProductIds: z.array(z.string()).max(200).optional(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime().nullable(), enabled: z.boolean(), combine: z.boolean() });
const campaignInput = z.union([
  campaignBase.extend({ kind: z.literal('percent').optional(), percent: z.number().int().min(1).max(90), amount: z.never().optional() }),
  campaignBase.extend({ kind: z.literal('fixed'), amount: z.number().int().min(1).max(100_000_000), percent: z.never().optional() }),
]);
export function campaignRoutes(app: Express, store: Store, actor: (req: Request) => Actor, now: () => Date) {
  // Mola destek (`support`, server/support-session.ts) edits campaigns too, but never sees how many were sold under them.
  app.get('/api/staff/campaigns', (req, res) => { const a = actor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner', 'manager', 'support']); res.json({ campaigns: a.role === 'support' ? campaignViews(s).map(c => ({ ...c, usedQuantity: 0, remainingQuantity: null })) : campaignViews(s), categories: menuCategories(s), revision: s.menuRevision }); });
  app.post('/api/staff/campaigns', (req, res) => {
    const a = actor(req); const b = z.object({ requestId: z.string(), revision: z.number().int(), campaign: campaignInput }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => { requireRole(s, a, ['owner', 'manager', 'support']); return once(s, a, 'campaign', b.requestId, b, () => {
      if (s.menuRevision !== b.revision) throw new DomainError('VERSION_CONFLICT', 'Menü veya kampanyalar değişti. Formu kapatıp yeniden açın.', 409);
      const c = b.campaign;
      if (c.endsAt && Date.parse(c.endsAt) <= Date.parse(c.startsAt)) throw new DomainError('INVALID_DATE', 'Bitiş, başlangıçtan sonra olmalı.');
      // "Bütün bir bölüm": menu categories (resolved at pricing time, packages/domain/campaigns.ts campaignCovers) and optional exclusions.
      const scope: CampaignScope = c.categories ? { productIds: [], categories: [...new Set(c.categories)], ...(c.excludedProductIds?.length ? { excludedProductIds: [...new Set(c.excludedProductIds)] } : {}) } : { productIds: c.productIds };
      if (scope.categories) {
        const menu = menuCategories(s);
        if (c.productIds.length || !scope.categories.length || scope.categories.length !== c.categories!.length || scope.categories.some(n => !menu.includes(n))) throw new DomainError('INVALID_CATEGORIES', 'Menüdeki bölümlerden en az birini seçin.');
        if (scope.excludedProductIds?.some(id => !s.products.some(p => p.id === id))) throw new DomainError('INVALID_PRODUCTS', 'Hariç tutulan ürünlerden biri menüde bulunamadı. Formu kapatıp yeniden açın.');
      } else {
        if (!c.productIds.length || new Set(c.productIds).size !== c.productIds.length || c.productIds.some(id => !s.products.some(p => p.id === id && p.published !== false))) throw new DomainError('INVALID_PRODUCTS', 'Yayındaki ürünlerden seçim yapın.');
        // Category campaigns skip weighed products for quantity conditions by themselves; chosen products are refused instead.
        const weighed = (c.minQuantity ?? 1) > 1 ? s.products.filter(p => c.productIds.includes(p.id) && soldByWeight(p)) : [];
        if (weighed.length) throw new DomainError('QUANTITY_RULE_WEIGHT', weightRuleMessage(weighed.map(p => p.name)));
      }
      if (c.id && !s.campaigns?.some(v => v.id === c.id)) throw new DomainError('NOT_FOUND', 'Kampanya bulunamadı.', 404);
      if (!c.id && (s.campaigns?.length ?? 0) >= 100) throw new DomainError('LIMIT', 'En fazla 100 kampanya kaydı olabilir.');
      const at = now().toISOString(); const previous = s.campaigns?.find(v => v.id === c.id);
      const maxQuantity = c.maxQuantity === undefined ? previous?.maxQuantity : c.maxQuantity;
      const weekly = c.schedule === undefined ? previous?.schedule : c.schedule ? { days: [...new Set(c.schedule.days)].sort((x, y) => x - y), ...(c.schedule.from ? { from: c.schedule.from } : {}), ...(c.schedule.to ? { to: c.schedule.to } : {}) } : undefined;
      const timing = campaignTimingError({ startsAt: c.startsAt, endsAt: c.endsAt, schedule: weekly });
      if (timing) throw new DomainError('INVALID_SCHEDULE', timing);
      if (maxQuantity != null && maxQuantity < (c.minQuantity ?? 1)) throw new DomainError('INVALID_CAMPAIGN_LIMIT', 'Toplam adet sınırı, en az alım adedinden küçük olamaz.');
      if (maxQuantity != null && maxQuantity < (campaignUsage(s).get(c.id ?? '') ?? 0)) throw new DomainError('CAMPAIGN_LIMIT_USED', 'Adet sınırı kullanılan adetten küçük olamaz. Güncel kullanımı kontrol edin.', 409);
      s.campaignHistory ??= [];
      if (previous) {
        const history = s.campaignHistory.find(v => v.reportId && v.reportId === previous.reportId);
        if (history) history.supersededAt = at;
        else s.campaignHistory.push({ ...previous, recordedAt: previous.startsAt, supersededAt: at });
      }
      const { schedule: _, productIds: _p, categories: _c, excludedProductIds: _e, ...fields } = c;
      const saved = { ...fields, ...scope, ...(weekly ? { schedule: weekly } : {}), maxQuantity, id: c.id ?? randomUUID(), reportId: randomUUID() };
      s.campaignHistory.push({ ...saved, recordedAt: at });
      s.campaigns = [...(s.campaigns ?? []).filter(v => v.id !== saved.id), saved]; s.menuRevision++;
      s.audit.push({ actor: a.id, action: 'campaign.saved', target: saved.id, at: now().toISOString() }); return { id: saved.id };
    }); }));
  });
}
