import { DomainError, once, requireRole } from './engine.js';
import type { State, Actor, Context } from './types.js';
export function removeCatalogItem(s: State, actor: Actor, input: { requestId: string; revision: number; id: string; kind: 'product' | 'campaign' }, ctx: Context) {
  requireRole(s, actor, ['owner', 'manager', 'support']);
  return once(s, actor, 'catalog-remove', input.requestId, input, () => {
    if (s.menuRevision !== input.revision) throw new DomainError('VERSION_CONFLICT', 'Menü değişti. Düzenleme ekranını yeniden açın.', 409);
    if (input.kind === 'product') {
      if (!s.products.some(p => p.id === input.id)) throw new DomainError('NOT_FOUND', 'Ürün bulunamadı.', 404);
      s.products = s.products.filter(p => p.id !== input.id);
      s.productDrafts = s.productDrafts?.filter(p => p.id !== input.id);
      // Keep campaign terms/history intact for accepted orders and financial reports.
    } else {
      const campaign = s.campaigns?.find(c => c.id === input.id);
      if (!campaign) throw new DomainError('NOT_FOUND', 'Kampanya bulunamadı.', 404);
      s.campaignHistory ??= [];
      const history = s.campaignHistory.find(c => c.reportId && c.reportId === campaign.reportId);
      if (history) history.supersededAt = ctx.now.toISOString();
      else s.campaignHistory.push({ ...campaign, recordedAt: campaign.startsAt, supersededAt: ctx.now.toISOString() });
      s.campaigns = s.campaigns!.filter(c => c.id !== input.id);
    }
    s.menuRevision++;
    s.audit.push({ actor: actor.id, action: `${input.kind}.removed`, target: input.id, at: ctx.now.toISOString() });
    return { removed: true };
  });
}
