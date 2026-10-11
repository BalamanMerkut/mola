import type { State } from './types.js';
import { BEFORE_WEEKS, campaignProducts, campaignViews, categoriesPlace, isMonthly, scheduleDayLength, scheduleOccurrences, scheduleSlots, scheduleText } from './campaigns.js';
import { campaignKey, mergeTotals, stateRecords, summarize, type Totals } from './history.js';
const DAY = 86400000;
/** Totals of all orders created inside [start, end). The server answers from stored daily summaries. */
export type SpanTotals = (start: number, end: number) => Totals;
export function stateSpans(s: State): SpanTotals { const records = stateRecords(s), orders = [...records.orders]; return (start, end) => mergeTotals(summarize({ ...records, orders }, start, end).values()); }
export function campaignReport(s: State, now: Date, span: SpanTotals = stateSpans(s)) {
  const steps = campaignReportSteps(s, now, span);
  for (;;) { const r = steps.next(); if (r.done) return r.value; }
}
/**
 * The campaign report one window at a time: every span (a weekly campaign has one per active window of its weeks, each a part
 * of a day read from its bills) is a step, so the server answers it in slices (drainSlowly) and tablets never wait for five
 * years of campaigns (3.6 s on a weak café PC in one piece; docs/HIZ_TESTI_5_YIL.md "Zayıf bilgisayar son kontrol").
 */
export function* campaignReportSteps(s: State, now: Date, span: SpanTotals = stateSpans(s)) {
  const availability = new Map(campaignViews(s).map(c => [c.reportId ?? c.id, c]));
  const history = [...(s.campaignHistory ?? [])];
  for (const c of s.campaigns ?? []) if (!history.some(h => c.reportId ? h.reportId === c.reportId : h.id === c.id)) history.push({ ...c, recordedAt: c.startsAt });
  const rows = [];
  for (const c of history.filter(c => c.enabled)) {
    const current = availability.get(c.reportId ?? c.id);
    const quotaUnavailable = !c.supersededAt && current?.remainingQuantity != null && current.remainingQuantity < (c.minQuantity ?? 1);
    const start = Math.max(Date.parse(c.startsAt), Date.parse(c.recordedAt));
    const end = Math.max(start, Math.min(+now, c.endsAt ? Date.parse(c.endsAt) : +now, c.supersededAt ? Date.parse(c.supersededAt) : +now));
    // Weekly campaigns count only their active days and hours, against the same weekdays and hours of the weeks before;
    // "a day" is one active window, so averages stay per active day. Date-range campaigns keep the plain 7-day comparison.
    const recurring = !!c.schedule, dayLength = scheduleDayLength(c.schedule), previousStart = start - (recurring ? BEFORE_WEEKS * 7 : 7) * DAY;
    // A monthly campaign ("her ayın 15'i") is compared with every day of the 4 weeks before it (same hours): an ordinary day.
    const monthly = isMonthly(c.schedule), beforeSchedule = monthly ? { days: [1, 2, 3, 4, 5, 6, 7], ...(c.schedule!.from && c.schedule!.to ? { from: c.schedule!.from, to: c.schedule!.to } : {}) } : c.schedule;
    const slots = (from: number, to: number) => scheduleSlots(c.schedule, from, to), length = (list: [number, number][]) => list.reduce((n, [a, b]) => n + b - a, 0) / dayLength;
    const duringSlots = slots(start, end), beforeSlots = scheduleSlots(beforeSchedule, previousStart, start);
    // "Tekrarlar": each day the campaign ran, with what it discounted that day (newest last).
    const occurrences: { start: string; end: string; quantity: number; amount: number; discount: number }[] = [];
    const occurrence = (a: number, b: number, t: Totals) => { let quantity = 0, amount = 0, discount = 0; for (const p of t.campaigns.get(campaignKey(c))?.values() ?? []) { quantity += p.quantity; amount += p.amount; discount += p.discount; } occurrences.push({ start: new Date(a).toISOString(), end: new Date(b).toISOString(), quantity, amount, discount }); };
    function* spans(list: [number, number][], record = false) { const parts: Totals[] = []; for (const [a, b] of list) { if (record) for (const [x, y] of scheduleOccurrences(c.schedule!, a, b)) { const t = span(x, y); parts.push(t); occurrence(x, y, t); yield; } else { parts.push(span(a, b)); yield; } } return mergeTotals(parts); }
    function* one(a: number, b: number) { const t = span(a, b); yield; return t; }
    const durationDays = recurring ? length(duringSlots) : (end - start) / DAY, beforeDays = recurring ? length(beforeSlots) : 7;
    const beforeSpan = recurring ? yield* spans(beforeSlots) : yield* one(previousStart, start), during = recurring ? yield* spans(duringSlots, monthly) : yield* one(start, end);
    // Discounted lines are counted over the whole period, so nothing priced by the campaign is ever left out.
    const applied = (recurring ? yield* one(start, end) : during).campaigns.get(campaignKey(c));
    // A category campaign lists what is in its categories now plus everything it actually discounted (a product moved
    // out later keeps its line; one never discounted and no longer in the category has nothing to report).
    const ids = c.categories ? [...new Set([...campaignProducts(c, s.products).map(p => p.id), ...(applied?.keys() ?? [])])] : c.productIds;
    const products = ids.map(id => {
      const b = beforeSpan.products.get(id), d = during.products.get(id), a = applied?.get(id);
      // Name as last ordered in these windows; a product with no orders here keeps its menu name.
      const name = d?.last ?? b?.last ?? s.products.find(p => p.id === id)?.name ?? 'Eski ürün';
      const before = b?.quantity ?? 0, quantity = d?.quantity ?? 0, amount = d?.amount ?? 0, appliedQuantity = a?.quantity ?? 0, appliedAmount = a?.amount ?? 0, discount = a?.discount ?? 0;
      const dailyBefore = beforeDays ? before / beforeDays : 0, dailyDuring = durationDays ? quantity / durationDays : 0;
      return { id, name, before, quantity, amount, appliedQuantity, appliedAmount, discount, dailyBefore, dailyDuring, changePercent: dailyBefore && durationDays ? (dailyDuring / dailyBefore - 1) * 100 : null };
    });
    const before = products.reduce((n, p) => n + p.before, 0), quantity = products.reduce((n, p) => n + p.quantity, 0);
    const dailyBefore = beforeDays ? before / beforeDays : 0, dailyDuring = durationDays ? quantity / durationDays : 0;
    const appliedAmount = products.reduce((n, p) => n + p.appliedAmount, 0), discount = products.reduce((n, p) => n + p.discount, 0);
    rows.push({ quotaUnavailable, id: c.reportId ?? c.id, name: c.name, minQuantity: c.minQuantity, kind: c.kind ?? 'percent', percent: c.percent, amount: c.amount, ...(c.schedule ? { scheduleText: scheduleText(c.schedule) } : {}), ...(monthly ? { monthly: true, occurrences } : {}), ...(c.categories ? { scopeText: `${categoriesPlace(c.categories)} geçerli (bölümün tamamı${c.excludedProductIds?.length ? `, ${c.excludedProductIds.length} ürün hariç` : ''})` } : {}), recurring, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), previousStart: new Date(previousStart).toISOString(), durationDays, beforeDays, ongoing: !quotaUnavailable && start <= +now && !c.supersededAt && (!c.endsAt || Date.parse(c.endsAt) > +now), products, before, quantity, dailyBefore, dailyDuring, changePercent: dailyBefore && durationDays ? (dailyDuring / dailyBefore - 1) * 100 : null, appliedAmount, appliedQuantity: products.reduce((n, p) => n + p.appliedQuantity, 0), discount, originalAmount: appliedAmount + discount });
  }
  return { generatedAt: now.toISOString(), campaigns: rows.sort((a, b) => b.startsAt.localeCompare(a.startsAt)) };
}
export type CampaignReport = ReturnType<typeof campaignReport>;
