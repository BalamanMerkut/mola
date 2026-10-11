import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { renewedTiming } from '../packages/domain/campaign-ends.js';
import { licensed, temp } from './merkez-fixture.js';

test('"Kampanya yinele": same length from today; a weekly one starts today at 00:00 for as many weeks', () => {
  const now = Date.parse('2026-10-10T12:30:00Z'); // 15:30 in Türkiye
  // 1 Eki 09:00 – 8 Eki 23:00 (TR) → today 09:00 – 17 Eki 23:00.
  assert.deepEqual(renewedTiming({ startsAt: '2026-10-01T06:00:00.000Z', endsAt: '2026-10-08T20:00:00.000Z' }, now), { startsAt: '2026-10-10T06:00:00.000Z', endsAt: '2026-10-17T20:00:00.000Z' });
  // A two-hour happy hour (10:00–12:00) that today would already be over starts now.
  assert.deepEqual(renewedTiming({ startsAt: '2026-10-03T07:00:00.000Z', endsAt: '2026-10-03T09:00:00.000Z' }, now), { startsAt: '2026-10-10T12:30:00.000Z', endsAt: '2026-10-10T14:30:00.000Z' });
  assert.deepEqual(renewedTiming({ startsAt: '2026-09-27T21:00:00.000Z', endsAt: '2026-10-25T21:00:00.000Z', schedule: { days: [6, 7] } }, now), { startsAt: '2026-10-09T21:00:00.000Z', endsAt: '2026-11-06T21:00:00.000Z' });
});

test('Kampanya bitti: one notification per ended campaign, none for those that ended before the update; Müdür sees only these, kasiyer none', async t => {
  const directory = temp('campaign-ends'), store = new Store(directory); licensed(store);
  let clock = new Date('2026-10-10T09:00:00Z');
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client() { let cookie = ''; return async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
    return { status: r.status, data: await r.json() as any };
  }; }
  const owner = client(), manager = client(), cashier = client();
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  const product = (await owner('/staff/state')).data.products[0];
  async function campaign(name: string, startsAt: string, endsAt: string) {
    const { revision } = (await owner('/staff/campaigns')).data;
    const r = await owner('/staff/campaigns', { requestId: randomUUID(), revision, campaign: { name, productIds: [product.id], percent: 10, startsAt, endsAt, enabled: true, combine: false } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  // "Before the update": a campaign that has already ended when the first sweep runs.
  await campaign('Eski kampanya', '2026-10-01T09:00:00Z', '2026-10-05T09:00:00Z');
  await campaign('2 al 1 öde', '2026-10-09T09:00:00Z', '2026-10-10T10:00:00Z');
  const campaigns = (n: any) => n.data.items.filter((i: any) => i.kind === 'campaign');
  assert.deepEqual(campaigns(await owner('/staff/notifications')), [], 'old ended campaigns do not flood the bell');
  clock = new Date('2026-10-10T10:30:00Z');
  let mine = campaigns(await owner('/staff/notifications'));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].title, `Kampanya bitti: 2 al 1 öde · ${product.name}`);
  assert.equal(mine[0].campaign.reason, 'time'); assert.equal(mine[0].campaign.uses, 0); assert.ok(mine[0].campaign.reportId);
  assert.match(mine[0].text, /Süresi doldu\. 0 siparişte uygulandı\./);
  mine = campaigns(await owner('/staff/notifications'));
  assert.equal(mine.length, 1, 'announced once');

  // The Müdür: the same notification, nothing about the drawer, licences or backups; reading it is the Müdür's own.
  assert.equal((await owner('/staff/users', { username: 'mudur1', name: 'Müdür', role: 'manager', password: 'MudurDeneme!2026' })).status, 200);
  assert.equal((await owner('/staff/users', { username: 'kasa1', name: 'Kasa', role: 'cashier', password: 'KasaDeneme!2026' })).status, 200);
  assert.equal((await manager('/login', { username: 'mudur1', password: 'MudurDeneme!2026' })).status, 200);
  assert.equal((await cashier('/login', { username: 'kasa1', password: 'KasaDeneme!2026' })).status, 200);
  const seen = await manager('/staff/notifications');
  assert.deepEqual(seen.data.items.map((i: any) => i.kind), ['campaign']);
  const count = (await manager('/staff/notifications/count')).data;
  assert.equal(count.unread, 1);
  // The toasts of an open screen (10 Ekim) carry the Müdür's kinds only, with their line.
  assert.deepEqual(count.recent.map((i: any) => i.kind), ['campaign']); assert.ok(count.recent[0].text);
  assert.ok((await owner('/staff/notifications/count')).data.recent.every((i: any) => typeof i.title === 'string' && typeof i.text === 'string'));
  assert.equal((await manager('/staff/notifications/read', {})).data.unread, 0);
  assert.deepEqual((await manager('/staff/notifications/count')).data.recent, [], 'read ones never come back as toasts');
  assert.equal(campaigns(await owner('/staff/notifications'))[0].read, false, 'read per person');
  assert.equal((await cashier('/staff/notifications')).status, 403);
});
