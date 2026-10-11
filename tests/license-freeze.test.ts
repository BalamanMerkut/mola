import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestFreeze, reviewFreeze, endFreeze } from '../server/license-freeze.js';
import { licenseSummary, type License } from '../server/license.js';
const now = new Date('2026-09-21T09:00:00Z');
const day = 86400000;
const license = (): License => ({ tenantId: 'cafe', name: 'Kafe', kind: 'subscription', planMonths: 12, endsAt: new Date(+now + 20 * day).toISOString(), suspended: false });

test('freeze preserves twenty remaining days throughout a sixty day closure and automatically reopens at boundary', () => {
  const l = license(), original = l.endsAt;
  const { id } = requestFreeze(l, 'Dükkân taşınması', '2026-09-21', 60, now);
  assert.equal(l.endsAt, original); assert.equal(licenseSummary(l, now).active, true);
  reviewFreeze(l, id, true, '', now);
  assert.equal(licenseSummary(l, now).active, false);
  assert.equal(licenseSummary(l, new Date(+now + 59 * day)).daysRemaining, 20);
  const end = new Date(+now + 60 * day);
  assert.equal(licenseSummary(l, end).active, true); assert.equal(licenseSummary(l, end).daysRemaining, 20);
  assert.equal(licenseSummary(l, new Date(+end + 20 * day)).active, false);
  assert.throws(() => reviewFreeze(l, id, true, '', now));
});
test('future freeze starts exactly on Turkey midnight; early resume credits actual elapsed time only', () => {
  const l = license(), original = Date.parse(l.endsAt!);
  const { id } = requestFreeze(l, 'Tadilat çalışması', '2026-09-23', 30, now);
  reviewFreeze(l, id, true, '', now);
  const start = Date.parse('2026-09-23T00:00:00+03:00');
  assert.equal(licenseSummary(l, new Date(start - 1)).active, true);
  assert.equal(licenseSummary(l, new Date(start)).active, false);
  endFreeze(l, id, new Date(start + 2 * day + 1000));
  assert.equal(Date.parse(l.endsAt!), original + 2 * day + 1000);
  assert.equal(licenseSummary(l, new Date(start + 2 * day + 1000)).active, true);
  assert.throws(() => endFreeze(l, id, now));
});
test('scheduled cancellation and rejection do not consume annual right; suspension survives resume', () => {
  const l = license(), original = l.endsAt;
  const first = requestFreeze(l, 'Taşınma ertelendi', '2026-09-23', 10, now);
  reviewFreeze(l, first.id, true, '', now); endFreeze(l, first.id, now); assert.equal(l.endsAt, original);
  const second = requestFreeze(l, 'Başka taşınma', '2026-09-21', 10, now);
  assert.throws(() => reviewFreeze(l, second.id, false, '', now));
  reviewFreeze(l, second.id, false, 'Tarih değiştirilmeli.', now);
  const third = requestFreeze(l, 'Yeni tarih kesinleşti', '2026-09-21', 10, now);
  reviewFreeze(l, third.id, true, '', now); l.suspended = true;
  endFreeze(l, third.id, new Date(+now + day));
  assert.equal(licenseSummary(l, new Date(+now + day)).active, false);
  assert.equal(l.suspended, true);
});
test('monthly, trial, expired, suspended, invalid dates and repeated annual freezes are rejected', () => {
  for (const l of [{ ...license(), planMonths: 1 as const }, { ...license(), kind: 'trial' as const }, { ...license(), suspended: true }, { ...license(), endsAt: now.toISOString() }]) {
    assert.throws(() => requestFreeze(l, 'Taşınma var', '2026-09-21', 10, now));
  }
  for (const [date, days] of [['2026-09-20', 10], ['2026-02-30', 10], ['2026-12-01', 10], ['2026-09-21', 61], ['2026-09-21', 0]] as const) assert.throws(() => requestFreeze(license(), 'Taşınma var', date, days, now));
  const l = license(); const f = requestFreeze(l, 'Taşınma var', '2026-09-21', 10, now);
  assert.throws(() => requestFreeze(l, 'İkinci talep', '2026-09-22', 1, now));
  reviewFreeze(l, f.id, true, '', now); endFreeze(l, f.id, new Date(+now + day));
  l.endsAt = '2028-01-01T00:00:00Z';
  assert.throws(() => requestFreeze(l, 'Tekrar taşınma', '2027-01-02', 1, new Date('2027-01-01T12:00:00Z')));
  assert.doesNotThrow(() => requestFreeze(l, 'Yıllık yeni hak', '2027-09-22', 1, new Date('2027-09-21T12:00:00Z')));
});
