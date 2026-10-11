import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { campaignActiveAt, campaignPhase, campaignState, campaignStatus, campaignTimingError, campaignWhen, discountedPrice, nextCampaignStart, repeatEnd, repeatMonths, repeatMonthsEnd, saleProducts, scheduleSlots, scheduleSummary, scheduleText, type Campaign } from '../packages/domain/campaigns.js';
import { editOrder, submitOrder } from '../packages/domain/engine.js';
import { campaignReport } from '../packages/domain/campaign-reports.js';
// Turkish wall time; 3 Oct 2026 is a Saturday.
const tr = (local: string) => Date.parse(`${local}+03:00`);
const iso = (local: string) => new Date(tr(local)).toISOString();
const weekend = (extra: Partial<Campaign> = {}) => ({ id: 'weekend', reportId: 'weekend1', name: 'Hafta Sonu İndirim Fırsatı', productIds: ['tea'], percent: 20, startsAt: iso('2026-10-03T00:00'), endsAt: repeatEnd(iso('2026-10-03T00:00'), 5), schedule: { days: [6, 7] }, enabled: true, combine: false, ...extra }) as Campaign;

test('weekday and daily window decide activity in Istanbul time, with exclusive ends and midnight edges', () => {
  const c = weekend({ schedule: { days: [6], from: '14:00', to: '17:00' } });
  assert.equal(campaignActiveAt(c, tr('2026-10-03T13:59:59')), false);
  assert.equal(campaignActiveAt(c, tr('2026-10-03T14:00')), true);
  assert.equal(campaignActiveAt(c, tr('2026-10-03T16:59:59')), true);
  assert.equal(campaignActiveAt(c, tr('2026-10-03T17:00')), false);
  assert.equal(campaignActiveAt(c, tr('2026-10-04T15:00')), false);
  assert.equal(campaignActiveAt(c, tr('2026-10-05T15:00')), false);
  // A whole Saturday starts at 00:00 Turkish time, when UTC is still on Friday.
  const day = weekend({ schedule: { days: [6] } });
  assert.equal(campaignActiveAt(day, Date.parse('2026-10-09T20:59:59.999Z')), false);
  assert.equal(campaignActiveAt(day, Date.parse('2026-10-09T21:00:00Z')), true);
  assert.equal(campaignActiveAt(day, tr('2026-10-10T23:59:59')), true);
  assert.equal(campaignActiveAt(day, tr('2026-10-11T00:00')), false);
  // The repeat ends exactly five weeks later: the sixth Saturday is outside.
  assert.equal(day.endsAt, iso('2026-11-07T00:00'));
  assert.equal(campaignActiveAt(day, tr('2026-10-31T12:00')), true);
  assert.equal(campaignActiveAt(day, tr('2026-11-07T12:00')), false);
  assert.equal(campaignActiveAt(day, tr('2026-09-26T12:00')), false);
  // Date-range campaigns are untouched.
  assert.equal(campaignActiveAt(weekend({ schedule: undefined }), tr('2026-10-05T15:00')), true);
});

test('repeat for N weeks gives N of each weekday, a plain summary and the next start', () => {
  const c = weekend();
  const slots = scheduleSlots(c.schedule, Date.parse(c.startsAt), Date.parse(c.endsAt!));
  assert.equal(slots.length, 5);
  assert.equal(slots.reduce((n, [a, b]) => n + b - a, 0), 10 * 86400000);
  assert.equal(scheduleSummary(c), 'Her Cumartesi ve Pazar · 5 hafta (3 Eki – 1 Kas)');
  assert.equal(scheduleSummary(weekend({ schedule: { days: [1, 2, 3, 4, 5], from: '14:00', to: '17:00' }, endsAt: iso('2026-10-09T00:00') })), 'Hafta içi her gün · 14:00–17:00 · 5 Eki – 8 Eki');
  assert.equal(scheduleSummary(weekend({ schedule: { days: [1, 3, 5] }, endsAt: repeatEnd(c.startsAt, 1) })), 'Her Pazartesi, Çarşamba ve Cuma · 1 hafta (5 Eki – 9 Eki)');
  assert.equal(nextCampaignStart(c, tr('2026-10-05T10:00')), tr('2026-10-10T00:00'));
  assert.equal(nextCampaignStart(c, tr('2026-11-02T10:00')), null);
  const view = { ...c, remainingQuantity: null };
  assert.equal(campaignStatus(view, tr('2026-10-03T10:00')), 'Şu an aktif');
  assert.equal(campaignStatus(view, tr('2026-10-05T10:00')), 'Sıradaki: Cumartesi 00:00');
  assert.equal(campaignStatus(view, tr('2026-10-09T10:00')), 'Sıradaki: Yarın 00:00');
  // Not started yet: never "running", the first day is named instead.
  assert.equal(campaignStatus(view, tr('2026-09-20T10:00')), 'Başlamadı · 3 Eki Cumartesi başlar');
  assert.equal(campaignStatus(view, tr('2026-10-02T10:00')), 'Başlamadı · yarın başlar');
  assert.deepEqual(['2026-09-20T10:00', '2026-10-05T10:00', '2026-11-03T10:00'].map(t => campaignPhase(view, tr(t))), ['upcoming', 'active', 'ended']);
  assert.equal(campaignStatus({ ...view, schedule: { days: [6], from: '14:00', to: '17:00' } }, tr('2026-10-03T10:00')), 'Sıradaki: Bugün 14:00');
  assert.equal(campaignStatus(view, tr('2026-11-03T10:00')), 'Sona erdi');
  assert.equal(campaignStatus({ ...view, schedule: undefined, startsAt: iso('2026-10-10T00:00') }, tr('2026-10-05T10:00')), 'Başlamadı · Cumartesi başlar');
});

test('schedule validation: weekdays, window order, an end and at least one active day', () => {
  const start = iso('2026-10-05T00:00'), end = repeatEnd(start, 4);
  const check = (schedule: Campaign['schedule'], endsAt: string | null = end) => campaignTimingError({ startsAt: start, endsAt, schedule });
  assert.equal(check({ days: [6, 7], from: '14:00', to: '17:00' }), null);
  assert.equal(check({ days: [] }), 'En az bir gün seçin.');
  assert.equal(check({ days: [0] }), 'Günler geçersiz.');
  assert.equal(check({ days: [6, 6] }), 'Günler geçersiz.');
  assert.equal(check({ days: [6], from: '14:00' }), 'Saat aralığının başlangıç ve bitiş saatini birlikte girin.');
  assert.equal(check({ days: [6], from: '17:00', to: '14:00' }), 'Saat aralığında başlangıç, bitişten önce olmalı.');
  assert.equal(check({ days: [6], from: '14:00', to: '14:10' }), 'Saat aralığı en az 15 dakika olmalı.');
  assert.equal(check({ days: [6], from: '24:00', to: '25:00' }), 'Saatleri SS:DD biçiminde girin.');
  assert.equal(check({ days: [6] }, null), 'Tekrarlanan kampanya için hafta sayısı veya son gün seçin.');
  assert.equal(check({ days: [6] }, repeatEnd(start, 53)), 'Tekrarlanan kampanya en fazla 52 hafta sürebilir.');
  assert.equal(check({ days: [6] }, iso('2026-10-08T00:00')), 'Seçilen tarihler arasında bu günler yok. Günleri veya tarihleri kontrol edin.');
  assert.equal(check(undefined, null), null);
});

test('weekly campaign prices only on active days; accepted prices survive an edit after the window closes', () => {
  const s = seed(); s.changeSeconds = 600;
  s.campaigns = [weekend({ schedule: { days: [6], from: '14:00', to: '17:00' } })];
  const price = (at: number) => { const p = saleProducts(s, new Date(at)).find(p => p.id === 'tea')!; return discountedPrice(p, p.price).price; };
  assert.equal(price(tr('2026-10-03T15:00')), 2800); assert.equal(price(tr('2026-10-03T17:00')), 3500); assert.equal(price(tr('2026-10-05T15:00')), 3500);
  assert.equal(saleProducts(s, new Date(tr('2026-10-05T15:00'))).find(p => p.id === 'tea')!.discounts!.length, 0);
  const actor = { tenantId: s.tenantId, role: 'guest' as const, id: 'guest', tableId: 'table-1', epoch: 0 };
  const line = { productId: 'tea', quantity: 1, selections: [] };
  submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 2800, lines: [line] }, { now: new Date(tr('2026-10-03T16:58')), id: randomUUID });
  const o = s.orders[0];
  // Two minutes later the window has closed: the saved line keeps its price, a new order pays the menu price.
  const later = { now: new Date(tr('2026-10-03T17:00')), id: randomUUID };
  editOrder(s, actor, { requestId: randomUUID(), orderId: o.id, version: o.version, expectedTotal: 5600, lines: [{ ...line, existingId: o.lines[0].id, quantity: 2 }] }, later);
  assert.equal(o.total, 5600);
  assert.throws(() => submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 2800, lines: [line] }, later), /Fiyat değişti/);
  submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 3500, lines: [line] }, later);
  assert.equal(s.orders[1].lines[0].campaigns, undefined);
});

test('report counts only active days and hours, compared with the same hours of the four weeks before', () => {
  const s = seed();
  s.campaigns = [weekend({ schedule: { days: [6], from: '14:00', to: '17:00' }, endsAt: repeatEnd(iso('2026-10-03T00:00'), 2) })];
  const actor = { tenantId: s.tenantId, role: 'owner' as const, id: 'owner' };
  const order = (local: string, quantity: number, unit: number) => submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: quantity * unit, lines: [{ productId: 'tea', quantity, selections: [] }] }, { now: new Date(tr(local)), id: randomUUID });
  // Before: four Saturday windows (5, 12, 19, 26 Sep); other hours and days do not count.
  order('2026-09-19T15:00', 4, 3500); order('2026-09-26T15:00', 4, 3500); order('2026-09-26T18:00', 10, 3500); order('2026-09-27T15:00', 10, 3500); order('2026-09-04T15:00', 9, 3500);
  // During: two Saturday windows; the evening order is outside the campaign.
  order('2026-10-03T15:00', 6, 2800); order('2026-10-03T18:00', 20, 3500); order('2026-10-10T16:00', 6, 2800);
  const row = campaignReport(s, new Date(tr('2026-10-17T12:00'))).campaigns[0];
  assert.equal(row.recurring, true); assert.equal(row.scheduleText, 'Her Cumartesi · 14:00–17:00');
  assert.equal(row.previousStart, iso('2026-09-05T00:00'));
  assert.equal(row.beforeDays, 4); assert.equal(row.before, 8); assert.equal(row.dailyBefore, 2);
  assert.equal(row.durationDays, 2); assert.equal(row.quantity, 12); assert.equal(row.dailyDuring, 6); assert.equal(row.changePercent, 200);
  assert.equal(row.appliedQuantity, 12); assert.equal(row.appliedAmount, 33600); assert.equal(row.discount, 8400); assert.equal(row.originalAmount, 42000);
  // Mid-window the elapsed part counts as a fraction of an active day.
  const live = campaignReport(s, new Date(tr('2026-10-03T15:30'))).campaigns[0];
  assert.equal(live.durationDays, 0.5); assert.equal(live.ongoing, true);
});

// ---- Her ayın N'inci günü (11 Ekim, sahibin isteği: maaş günü kampanyası her ayın 15'i). ----
const monthly = (extra: Partial<Campaign> = {}) => weekend({ id: 'maas', reportId: 'maas1', name: 'Maaş günü', startsAt: iso('2026-10-01T00:00'), endsAt: repeatMonthsEnd(iso('2026-10-01T00:00'), 3), schedule: { monthDay: 15 }, ...extra });

test('monthly: the chosen day of every month, the last day of shorter months, with an optional window', () => {
  const c = monthly();
  assert.equal(campaignActiveAt(c, tr('2026-10-14T23:59:59')), false);
  assert.equal(campaignActiveAt(c, tr('2026-10-15T00:00')), true);
  assert.equal(campaignActiveAt(c, tr('2026-10-15T23:59:59')), true);
  assert.equal(campaignActiveAt(c, tr('2026-10-16T00:00')), false);
  assert.equal(campaignActiveAt(c, tr('2026-11-15T12:00')), true);
  // Three months from 1 Ekim: 15 Ekim, 15 Kasım, 15 Aralık; 15 Ocak is outside.
  assert.equal(c.endsAt, iso('2027-01-01T00:00'));
  assert.equal(campaignActiveAt(c, tr('2026-12-15T12:00')), true);
  assert.equal(campaignActiveAt(c, tr('2027-01-15T12:00')), false);
  // 31: 31 Ekim, 30 Kasım (no 31st), 31 Aralık; 28 Şubat 2027.
  const last = monthly({ schedule: { monthDay: 31 }, endsAt: repeatMonthsEnd(iso('2026-10-01T00:00'), 5) });
  assert.deepEqual(scheduleSlots(last.schedule, Date.parse(last.startsAt), Date.parse(last.endsAt!)).map(([a]) => new Date(a + 3 * 3600000).toISOString().slice(0, 10)), ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  // A window: only those hours of the day.
  const lunch = monthly({ schedule: { monthDay: 15, from: '12:00', to: '15:00' } });
  assert.equal(campaignActiveAt(lunch, tr('2026-10-15T11:59')), false);
  assert.equal(campaignActiveAt(lunch, tr('2026-10-15T12:00')), true);
  assert.equal(campaignActiveAt(lunch, tr('2026-10-15T15:00')), false);
  assert.equal(scheduleText(lunch.schedule!), 'Her ayın 15. günü · 12:00–15:00');
  assert.equal(scheduleText({ monthDay: 31 }), 'Her ayın 31. günü (kısa aylarda ayın son günü)');
  // Prices follow it like every campaign (saleProducts).
  const s = seed(); s.campaigns = [c];
  const price = (at: number) => { const p = saleProducts(s, new Date(at)).find(p => p.id === 'tea')!; return discountedPrice(p, p.price).price; };
  assert.equal(price(tr('2026-10-15T10:00')), 2800); assert.equal(price(tr('2026-10-16T10:00')), 3500);
});

test('monthly: N months give N runs, a plain summary, the next start and plain errors', () => {
  assert.equal(repeatMonthsEnd(iso('2026-10-11T00:00'), 3), iso('2027-01-11T00:00'));
  assert.equal(repeatMonthsEnd(iso('2026-01-31T00:00'), 1), iso('2026-02-28T00:00'));
  assert.equal(repeatMonths(monthly()), 3);
  assert.equal(repeatMonths(monthly({ endsAt: iso('2026-12-20T00:00') })), null);
  const c = monthly();
  assert.equal(scheduleSummary(c), 'Her ayın 15. günü · 3 ay (15 Eki – 15 Ara)');
  assert.equal(nextCampaignStart(c, tr('2026-10-16T10:00')), tr('2026-11-15T00:00'));
  assert.equal(nextCampaignStart(c, tr('2026-12-16T10:00')), null);
  const view = { ...c, remainingQuantity: null };
  assert.equal(campaignStatus(view, tr('2026-10-20T10:00')), 'Sıradaki: 15 Kas Pazar 00:00');
  assert.equal(campaignPhase(view, tr('2026-12-20T10:00')), 'ended');
  const check = (schedule: Campaign['schedule'], endsAt: string | null) => campaignTimingError({ startsAt: c.startsAt, endsAt, schedule });
  assert.equal(check({ monthDay: 15 }, c.endsAt), null);
  assert.equal(check({ monthDay: 0 }, c.endsAt), 'Ayın gününü 1–31 arasında seçin.');
  assert.equal(check({ monthDay: 32 }, c.endsAt), 'Ayın gününü 1–31 arasında seçin.');
  assert.equal(check({ monthDay: 15 }, null), 'Her ay tekrarlanan kampanya için ay sayısı veya son gün seçin.');
  assert.equal(check({ monthDay: 15 }, repeatMonthsEnd(c.startsAt, 12)), null);
  assert.equal(check({ monthDay: 15 }, repeatMonthsEnd(c.startsAt, 13)), 'Her ay tekrarlanan kampanya en fazla 12 ay sürebilir.');
  assert.equal(check({ monthDay: 20 }, iso('2026-10-10T00:00')), 'Seçilen tarihler arasında ayın bu günü yok. Ayın gününü veya tarihleri kontrol edin.');
  assert.equal(check({ monthDay: 15, days: [1] } as unknown as Campaign['schedule'], c.endsAt), 'Ayın günüyle hafta günleri birlikte seçilemez.');
});

test('the four states the owner sees: Taslak, Planlandı, Aktif, Bitti, with the card line', () => {
  const view = { ...monthly(), remainingQuantity: null };
  assert.equal(campaignState({ ...view, enabled: false }, tr('2026-10-15T10:00')), 'draft');
  assert.equal(campaignWhen({ ...view, enabled: false }, tr('2026-10-15T10:00')), 'Menüde görünmez');
  assert.equal(campaignState(view, tr('2026-09-20T10:00')), 'planned');
  assert.equal(campaignWhen(view, tr('2026-09-20T10:00')), 'Başlıyor: 15 Eki Perşembe 00:00');
  assert.equal(campaignState(view, tr('2026-10-15T10:00')), 'active');
  assert.equal(campaignWhen(view, tr('2026-10-15T10:00')), 'Şu an uygulanıyor');
  assert.equal(campaignWhen(view, tr('2026-10-16T10:00')), 'Sıradaki: 15 Kas Pazar 00:00');
  assert.equal(campaignState(view, tr('2027-01-02T10:00')), 'ended');
  assert.equal(campaignWhen(view, tr('2027-01-02T10:00')), 'Süresi doldu');
  // A used-up quota ends it as well; a plain date-range campaign that has started is Aktif.
  assert.equal(campaignState({ ...view, remainingQuantity: 0 }, tr('2026-10-15T10:00')), 'ended');
  assert.equal(campaignWhen({ ...view, remainingQuantity: 0 }, tr('2026-10-15T10:00')), 'Adet sınırı doldu');
  const plain = { ...view, schedule: undefined, endsAt: null };
  assert.equal(campaignState(plain, tr('2026-10-02T10:00')), 'active');
  assert.equal(campaignWhen(plain, tr('2026-10-02T10:00')), 'Şu an uygulanıyor');
});

test('monthly report: its days against an ordinary day of the four weeks before, one row per occurrence', () => {
  const s = seed();
  s.campaigns = [monthly({ endsAt: repeatMonthsEnd(iso('2026-10-01T00:00'), 2) })];
  const actor = { tenantId: s.tenantId, role: 'owner' as const, id: 'owner' };
  const order = (local: string, quantity: number, unit: number) => submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: quantity * unit, lines: [{ productId: 'tea', quantity, selections: [] }] }, { now: new Date(tr(local)), id: randomUUID });
  // Before: every day of 3 Eylül – 30 Eylül counts (14 teas over 28 days); 30 Ağustos is outside.
  order('2026-08-30T12:00', 9, 3500); order('2026-09-10T12:00', 7, 3500); order('2026-09-20T12:00', 7, 3500);
  // During: 15 Ekim and 15 Kasım; 16 Ekim is not a campaign day.
  order('2026-10-15T12:00', 6, 2800); order('2026-10-16T12:00', 5, 3500); order('2026-11-15T09:00', 4, 2800);
  const row = campaignReport(s, new Date(tr('2026-12-05T12:00'))).campaigns[0];
  assert.equal(row.recurring, true); assert.equal(row.monthly, true); assert.equal(row.scheduleText, 'Her ayın 15. günü');
  assert.equal(row.previousStart, iso('2026-09-03T00:00'));
  assert.equal(row.beforeDays, 28); assert.equal(row.before, 14); assert.equal(row.dailyBefore, 0.5);
  assert.equal(row.durationDays, 2); assert.equal(row.quantity, 10); assert.equal(row.dailyDuring, 5); assert.equal(row.changePercent, 900);
  assert.equal(row.appliedQuantity, 10); assert.equal(row.discount, 7000);
  assert.deepEqual(row.occurrences, [
    { start: iso('2026-10-15T00:00'), end: iso('2026-10-16T00:00'), quantity: 6, amount: 16800, discount: 4200 },
    { start: iso('2026-11-15T00:00'), end: iso('2026-11-16T00:00'), quantity: 4, amount: 11200, discount: 2800 },
  ]);
});

test('Kampanyayı yinele: a monthly campaign of whole months runs as many months again from today', async () => {
  const { renewedTiming } = await import('../packages/domain/campaign-ends.js');
  assert.deepEqual(renewedTiming(monthly(), tr('2027-01-20T10:00')), { startsAt: iso('2027-01-20T00:00'), endsAt: iso('2027-04-20T00:00') });
});
