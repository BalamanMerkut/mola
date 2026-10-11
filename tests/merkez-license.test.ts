import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEMO_PASSWORD } from '../server/app.js';
import { extendMonths } from '../server/license.js';
import { REQUEST_RETENTION_MS } from '../server/merkez/store.js';
import { merkezPair } from './merkez-fixture.js';

const rid = () => randomUUID().replace(/-/g, '');
const DAY = 86400000;

test('an imported trial that never started waits for setup, lasts exactly 30 days, expires safely and converts without losing days', async t => {
  let time = Date.parse('2026-01-31T09:00:00.000Z');
  const pair = await merkezPair('legacy-trial', { demo: true, now: () => new Date(time) }); t.after(() => pair.close());
  await pair.adminLogin();
  // The old in-process panel had created this business as a trial that starts after setup (endsAt null).
  const imported = await pair.admin('/import', { requestId: rid(), businesses: [
    { tenantId: 'mola-demo', name: 'Pilot Kafe', license: { endsAt: null, suspended: false, kind: 'trial', createdAt: new Date(time).toISOString() } },
    { tenantId: 'other-demo', name: 'İkinci Pilot', license: { endsAt: null, suspended: false, kind: 'trial' } },
  ] });
  assert.equal(imported.status, 200); pair.link.adopt(imported.data);
  const owner = pair.kafe(), start = { requestId: rid(), tenantId: 'mola-demo' };
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  let s = (await owner('/staff/state')).data;
  assert.match(s.licenseNotice, /deneme/);
  const order = { requestId: rid(), tableId: s.tables[0].id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 };
  assert.equal((await owner('/staff/orders', order)).data.code, 'LICENSE_EXPIRED');
  assert.equal((await pair.admin('/trials/start', start)).data.code, 'SETUP_REQUIRED');
  time += 5 * DAY; await pair.adminLogin(); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  assert.equal((await owner('/staff/setup', { requestId: rid(), version: s.businessRevision ?? 0, name: 'Pilot Kafe', tableCount: s.tables.length, changeSeconds: 0, commissionBps: null })).status, 200);
  // Merkez learns about the setup from the heartbeat, then the vendor starts the trial.
  assert.equal((await pair.admin('/trials/start', start)).data.code, 'SETUP_REQUIRED');
  await pair.link.sync();
  let progress = (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo');
  assert.equal(progress.setupCompleted, true); assert.equal(progress.setupCompletedAt, new Date(time).toISOString());
  assert.equal(progress.firstLoginAt, new Date(time - 5 * DAY).toISOString(), 'the first owner login, reported once');
  assert.equal(progress.payments, undefined); assert.equal(progress.products, undefined);
  assert.equal((await pair.admin('/trials/start', start)).status, 200);
  assert.equal((await pair.admin('/trials/start', start)).status, 200, 'a repeated request is answered once');
  assert.equal((await pair.admin('/trials/start', { ...start, requestId: rid() })).status, 409);
  assert.equal(pair.merkezStore.read().audit.filter(a => a.action === 'trial.started').length, 1);
  // Not yet at the café: until the heartbeat it still has the licence without a start.
  assert.equal((await owner('/staff/orders', { ...order, requestId: rid() })).data.code, 'LICENSE_EXPIRED');
  await pair.link.sync();
  const started = pair.link.license('mola-demo')!;
  assert.equal(started.trialStartedAt, new Date(time).toISOString()); assert.equal(Date.parse(started.endsAt!) - time, 30 * DAY);
  // The exact expiry boundary rejects new orders but keeps retries and collection.
  time = Date.parse(started.endsAt!) - 1;
  // Connected the day before (the offline limit is apart from this: tests/kafe-offline.test.ts).
  time -= DAY; await pair.link.sync(); time += DAY;
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  assert.equal((await owner('/staff/orders', order)).status, 200);
  time += 1;
  assert.equal((await owner('/staff/orders', order)).status, 200, 'the same request again');
  assert.equal((await owner('/staff/orders', { ...order, requestId: rid() })).data.code, 'LICENSE_EXPIRED');
  assert.equal((await pair.kafe()('/guest/session', { token: s.tables[0].token })).data.code, 'MENU_UNAVAILABLE');
  assert.equal((await owner('/staff/support')).data.license.active, false);
  s = (await owner('/staff/state')).data;
  const account = s.tables.find((table: any) => table.id === order.tableId).account;
  assert.equal((await owner('/staff/payments', { requestId: rid(), accountId: account.id, version: account.version, method: 'cash', amount: 3500, tendered: 3500 })).status, 200);
  await pair.adminLogin();
  const renewal = { requestId: rid(), tenantId: 'mola-demo', expectedEnd: started.endsAt, expectedSuspended: false, months: 1, suspended: false };
  assert.equal((await pair.admin('/licenses', renewal)).status, 200);
  assert.equal((await pair.admin('/licenses', renewal)).status, 200);
  await pair.link.sync();
  assert.equal(pair.link.license('mola-demo')!.kind, 'subscription'); assert.equal(pair.link.license('mola-demo')!.planMonths, 1);
  assert.equal((await owner('/staff/orders', { ...order, requestId: rid() })).status, 200);
  // A second pilot converted early keeps the full remaining trial before the paid month.
  const other = pair.kafe();
  await other('/login', { username: 'diger', password: DEMO_PASSWORD });
  const o = (await other('/staff/state')).data;
  await other('/staff/setup', { requestId: rid(), version: o.businessRevision ?? 0, name: 'İkinci Pilot', tableCount: o.tables.length, changeSeconds: 0, commissionBps: null });
  await pair.link.sync();
  await pair.admin('/trials/start', { requestId: rid(), tenantId: 'other-demo' });
  const trialEnd = (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'other-demo').endsAt;
  assert.equal((await pair.admin('/licenses', { ...renewal, requestId: rid(), tenantId: 'other-demo', expectedEnd: trialEnd })).status, 200);
  const paidEnd = new Date(trialEnd); paidEnd.setUTCMonth(paidEnd.getUTCMonth() + 1);
  await pair.link.sync();
  assert.equal(pair.link.license('other-demo')!.endsAt, paidEnd.toISOString());
  assert.equal(pair.merkezStore.read().audit.filter(a => a.action === 'trial.converted').length, 2);
  // "6 ay uzat" adds six months from the current end and keeps the plan (monthly stays monthly); the plan changes on its own.
  const now = (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo');
  await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: now.endsAt, expectedSuspended: false, months: 6, suspended: false });
  const renewed = (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo');
  assert.equal(renewed.planMonths, 1); assert.equal(renewed.endsAt, extendMonths(new Date(now.endsAt), 6));
  // Every change is a new signed licence with a higher serial.
  assert.ok(renewed.serial > now.serial);
  assert.equal((await pair.admin('/logout', {})).status, 200); assert.equal((await pair.admin('/state')).status, 401);
});

test('the Merkez record stays small: replays keep a fingerprint for a week, audit and notifications are capped', async t => {
  let time = Date.parse('2026-03-02T09:00:00.000Z');
  const pair = await merkezPair('merkez-growth', { demo: true, now: () => new Date(time) }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin();
  for (let i = 0; i < 20; i++) { time += 600_000; assert.equal((await pair.admin('/service-plan', { requestId: rid(), tenantId: 'mola-demo', service: i % 2 ? 'full' : 'menu' })).status, 200); }
  const before = Object.keys(pair.merkezStore.read().requests).length;
  assert.ok(before >= 20);
  assert.ok(Object.values(pair.merkezStore.read().requests).every(r => r.fingerprint && r.at));
  time += REQUEST_RETENTION_MS + DAY; await pair.adminLogin();
  assert.equal((await pair.admin('/service-plan', { requestId: rid(), tenantId: 'mola-demo', service: 'full' })).status, 200);
  assert.ok(Object.keys(pair.merkezStore.read().requests).length <= 2, 'old replay records are gone');
  pair.merkezStore.mutate(d => { d.audit = Array.from({ length: 2500 }, (_, i) => ({ action: 'license.updated', target: 'x', at: new Date(time + i).toISOString() })); d.notifications = Array.from({ length: 2100 }, (_, i) => ({ id: String(i), ticketId: 't', event: 'ticket.created' as const, channel: 'sms' as const, audience: 'platform' as const, status: 'awaiting_configuration' as const, at: new Date(time).toISOString() })); });
  const d = pair.merkezStore.read();
  assert.equal(d.audit.length, 2000); assert.equal(d.audit.at(-1)!.at, new Date(time + 2499).toISOString());
  assert.equal(d.notifications.length, 2000); assert.equal(d.notifications[0].id, '100');
});
