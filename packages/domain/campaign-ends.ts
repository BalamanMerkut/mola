import type { State } from './types.js';
import { campaignViews, categoriesPlace, type CampaignView } from './campaigns.js';

/**
 * "Kampanya bitti" (10 Ekim, sahibin onayı): a campaign whose end time passed or whose quota is used up is announced once, in
 * Bildirimler (owner and Müdür) and as a one-time window for the owner (src/CampaignEnded.tsx). The key carries the end that was
 * reached, so renaming an ended campaign does not announce it again, while extending it and reaching the new end does.
 */
export type CampaignEnd = { key: string; campaignId: string; reportId: string; reason: 'time' | 'quota'; endedAt: string; title: string; text: string; uses?: number };

/** "Latte", "Latte, Mocha", "Latte, Mocha +2", or "Tatlılarda" for a category campaign. */
export function campaignScopeName(c: Pick<CampaignView, 'productIds' | 'categories'>, s: Pick<State, 'products'>) {
  if (c.categories) return categoriesPlace(c.categories);
  const names = c.productIds.map(id => s.products.find(p => p.id === id)?.name).filter((n): n is string => !!n);
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
}

/**
 * Orders (not cancelled) with a line priced by the campaign, from the floor and the kept archives. Undefined when some of its
 * orders were already moved to the long-term summaries (`archivedCampaignUsage`): a partial count would mislead.
 */
export function campaignUses(s: Pick<State, 'orders' | 'archives' | 'archivedCampaignUsage'>, campaignId: string) {
  if ((s.archivedCampaignUsage?.[campaignId] ?? 0) > 0) return undefined;
  const orders = new Map((s.archives ?? []).flatMap(a => a.orders).map(o => [o.id, o]));
  for (const o of s.orders ?? []) orders.set(o.id, o);
  let n = 0;
  for (const o of orders.values()) if (o.status !== 'cancelled' && o.lines.some(l => l.campaigns?.some(c => c.id === campaignId))) n++;
  return n;
}

/** Every enabled campaign that has ended by `at` (time first; a quota used up before its end time counts as 'quota'). */
export function endedCampaigns(s: State, at: number): CampaignEnd[] {
  const out: CampaignEnd[] = [];
  for (const c of campaignViews(s)) {
    if (!c.enabled) continue;
    const timeUp = !!c.endsAt && Date.parse(c.endsAt) <= at;
    const quotaUp = !timeUp && c.remainingQuantity !== null && c.remainingQuantity < (c.minQuantity ?? 1);
    if (!timeUp && !quotaUp) continue;
    const scope = campaignScopeName(c, s);
    const uses = campaignUses(s, c.id);
    out.push({
      key: timeUp ? `campaign-ended:${c.id}:${c.endsAt}` : `campaign-ended:${c.id}:quota:${c.maxQuantity}`,
      campaignId: c.id, reportId: c.reportId ?? c.id, reason: timeUp ? 'time' : 'quota', endedAt: timeUp ? c.endsAt! : new Date(at).toISOString(),
      title: `Kampanya bitti: ${c.name}${scope ? ` · ${scope}` : ''}`,
      text: `${timeUp ? 'Süresi doldu.' : 'Adet sınırı doldu.'}${uses !== undefined ? ` ${uses.toLocaleString('tr-TR')} siparişte uygulandı.` : ''} Sonuçları Satış ve Raporlar → Kampanyalar'da.`,
      ...(uses !== undefined ? { uses } : {}),
    });
  }
  return out;
}

/** Same end time and length, starting today: "Kampanyayı yinele" (a copy for the editor, never saved by itself). */
export function renewedTiming(c: Pick<CampaignView, 'startsAt' | 'endsAt' | 'schedule'>, now: number) {
  const DAY = 86400000, TR = 3 * 3600000, start = Date.parse(c.startsAt), end = c.endsAt ? Date.parse(c.endsAt) : null;
  const today = Math.floor((now + TR) / DAY) * DAY - TR;
  if (c.schedule) return { startsAt: new Date(today).toISOString(), endsAt: end === null ? null : new Date(today + (end - start)).toISOString() };
  // Today at the original start's time of day; if that leaves nothing of it (a short one that would already be over), from now.
  const timeOfDay = ((start + TR) % DAY + DAY) % DAY;
  let from = today + timeOfDay;
  if (end !== null && from + (end - start) <= now) from = Math.floor(now / 60000) * 60000;
  return { startsAt: new Date(from).toISOString(), endsAt: end === null ? null : new Date(from + (end - start)).toISOString() };
}
