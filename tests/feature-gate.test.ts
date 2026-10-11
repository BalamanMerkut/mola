import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { LEGACY_LICENCE_UNTIL, MerkezLink } from '../server/kafe-link.js';
import { publicKeyFrom, type License } from '../server/license.js';
import { withoutComparison } from '../server/feature-guard.js';
import { closedFeatures, enabledFeatures, FEATURE_NOT_IN_PACKAGE, featureIds, missingForRoute, packageName, routeFeatures, type FeatureId } from '../packages/domain/feature-gate.js';
import { licensed, temp, testLicense, TEST_PUBLIC_KEY } from './merkez-fixture.js';

/*
 * Hizmet paketi on the café (packages/domain/feature-gate.ts, server/feature-guard.ts): every service's routes are refused
 * while it is off and answer again when it is on; a licence without `features` keeps everything on only when it is old and
 * the business never had a listed one here (güvenlik denetimi O6), else the core only; "Sadece QR menü" keeps
 * its MENU_ONLY answer; data entered before stays; the Müdür is core (never gated); "deneme bitti" comes once.
 */
const ALL_BUT = (...off: FeatureId[]) => featureIds.filter(id => !off.includes(id));
type Answer = { status: number; data: any };

async function cafe(t: { after: (fn: () => Promise<void>) => void }, first: Partial<License> = {}) {
  const store = new Store(temp('feature-gate'));
  let clock = new Date('2026-10-05T12:00:00Z');
  const base: License = { tenantId: 'mola-demo', name: 'Mola Demo', endsAt: new Date(Date.now() + 300 * 86400000).toISOString(), suspended: false, kind: 'subscription', planMonths: 12, service: 'full' };
  const installId = licensed(store, first);
  const link = new MerkezLink(store, { publicKey: publicKeyFrom(TEST_PUBLIC_KEY), now: () => clock });
  const server = createServer(createApp(store, () => clock, undefined, undefined, undefined, () => {}, undefined, undefined, undefined, undefined, link));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { link.stop(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let serial = 1;
  /** A new licence from "Merkez" (same rules as the heartbeat): `features` undefined = an older Merkez without the field. */
  const license = (patch: Partial<License>) => { serial++; const { features: _f, ...rest } = base; assert.equal(link.receive(testLicense(installId, { ...rest, ...patch }, serial)), true); };
  function client(username: string, password = DEMO_PASSWORD) {
    let cookie = '', guest = '';
    const call = async (path: string, body?: unknown): Promise<Answer> => {
      const r = await fetch(api + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(guest ? { 'X-Guest-Session': guest } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of r.headers.getSetCookie()) cookie = [cookie, c.split(';')[0]].filter(Boolean).join('; ');
      const data = await r.json().catch(() => ({})) as any;
      if (data?.session) guest = data.session;
      return { status: r.status, data };
    };
    return Object.assign(call, { login: () => call('/login', { username, password }) });
  }
  const owner = client('isletme');
  assert.equal((await owner.login()).status, 200);
  return { store, link, owner, client, license, set: (iso: string) => { clock = new Date(iso); } };
}
const refused = (r: Answer, what = '') => { assert.equal(r.status, 403, `${what} ${JSON.stringify(r.data)}`); assert.equal(r.data.code, FEATURE_NOT_IN_PACKAGE, what); assert.match(r.data.message, what.startsWith('guest') || ['menu', 'waiter call'].includes(what) ? /personel/ : /paket/i); };
const allowed = (r: Answer, what = '') => assert.notEqual(r.data?.code, FEATURE_NOT_IN_PACKAGE, `${what} ${JSON.stringify(r.data)}`);

test('the rules: no features = everything, requirements, route map, names, what closed', () => {
  assert.deepEqual(enabledFeatures(undefined), [...featureIds]);
  assert.deepEqual(enabledFeatures(null), [...featureIds]);
  // QR sipariş needs QR menü; Uzaktan yönetim needs Uzaktan raporlar; unknown ids are ignored; core is always on.
  assert.deepEqual(enabledFeatures(['qr-order', 'remote-admin', 'kahve-makinesi']), ['core']);
  // "Yakında" (integrations) is not sellable yet, so no package or trial holds it: closed until it is sold (6 Ekim).
  assert.deepEqual(enabledFeatures(['qr-menu', 'qr-order']), ['core', 'qr-menu', 'qr-order']);
  assert.ok(enabledFeatures(undefined).includes('integrations'), 'a licence without features keeps everything on');
  assert.deepEqual(routeFeatures('/guest/orders'), ['qr-menu', 'qr-order']);
  assert.deepEqual(routeFeatures('/guest/state'), ['qr-menu']);
  assert.deepEqual(routeFeatures('/staff/stock/items'), ['stock']);
  assert.deepEqual(routeFeatures('/staff/reports/profit'), ['stock']);
  assert.deepEqual(routeFeatures('/staff/shifts/me'), []);
  assert.deepEqual(routeFeatures('/staff/shifts/code'), ['shifts']);
  assert.deepEqual(routeFeatures('/staff/reports/overview'), []);
  assert.deepEqual(routeFeatures('/staff/agenda'), []);
  assert.deepEqual(routeFeatures('/staff/reports/accountant.xlsx'), ['reports-advanced']);
  assert.equal(missingForRoute('/staff/remote-admin', ['core', 'remote-reports']), 'remote-admin');
  assert.equal(missingForRoute('/staff/remote-admin', undefined), undefined);
  assert.equal(packageName(['core', 'qr-menu', 'email-reports'], { listed: true }), 'Çay bahçesi');
  assert.equal(packageName(['core', 'stock'], { listed: true }), 'Size özel paket');
  assert.equal(packageName([...featureIds], { trial: true }), 'Deneme');
  assert.equal(packageName([...featureIds], {}), 'Tam paket');
  assert.deepEqual(closedFeatures([...featureIds], ['core', 'qr-menu']), featureIds.filter(id => !['core', 'qr-menu', 'integrations'].includes(id)));
  assert.equal(withoutComparison('Bugün 142 sipariş, ₺8.540 satış — dünün aynı saatine göre %12 fazla. En çok kazandıran: Latte (₺2.660).'), 'Bugün 142 sipariş, ₺8.540 satış. En çok kazandıran: Latte (₺2.660).');
  assert.equal(withoutComparison('2026 yılında bugüne kadar 9 sipariş, ₺900 satış — geçen yılın aynı dönemine göre %12 fazla. En çok kazandıran: Latte (₺300).'), '2026 yılında bugüne kadar 9 sipariş, ₺900 satış. En çok kazandıran: Latte (₺300).');
});

test('every service: refused while off, answered when on; a licence without features after one with them: the core only', async t => {
  const c = await cafe(t);
  const routes: [FeatureId, string, unknown?][] = [
    ['stock', '/staff/stock'], ['stock', '/staff/reports/profit?from=2026-10-05&to=2026-10-05'], ['stock', '/staff/profit/settings'],
    ['reservations', '/staff/reservations?from=2026-10-01&to=2026-10-31'], ['reservations', '/staff/events'], ['reservations', '/staff/reports/reservations?from=2026-10-05&to=2026-10-05'],
    ['shifts', '/staff/shifts/code'], ['shifts', '/staff/shifts/plans'], ['shifts', '/staff/reports/staff-shifts?from=2026-10-05&to=2026-10-05'],
    ['reports-advanced', '/staff/reports/document?from=2026-10-05&to=2026-10-05'], ['reports-advanced', '/staff/reports/accountant.xlsx?from=2026-10-05&to=2026-10-05'],
    ['remote-reports', '/staff/remote-reports'], ['remote-admin', '/staff/remote-admin'], ['email-reports', '/staff/email-reports'],
    ['integrations', '/staff/integrations'], ['integrations', '/staff/integrations/orders'],
  ];
  for (const [, path, body] of routes) allowed(await c.owner(path, body), path);
  c.license({ features: ['core'] });
  for (const [id, path, body] of routes) refused(await c.owner(path, body), `${id} ${path}`);
  // Core stays: the floor, the simple summary, Ajanda's notes, payments' screens.
  for (const path of ['/staff/state', '/staff/reports/overview?from=2026-10-05&to=2026-10-05', '/staff/reports/simple?from=2026-10-05&to=2026-10-05', '/staff/agenda?from=2026-10-01&to=2026-10-31', '/staff/shifts/me']) assert.equal((await c.owner(path)).status, 200, path);
  // One service on again: only its routes answer.
  c.license({ features: ['core', 'stock'] });
  allowed(await c.owner('/staff/stock'));
  refused(await c.owner('/staff/events'));
  // Güvenlik denetimi O6: once a licence with the list was taken here, one without it (even Merkez-signed, a newer serial)
  // opens the core only: a copy without `features` can never unlock services.
  c.license({ features: undefined });
  for (const [id, path, body] of routes) refused(await c.owner(path, body), `${id} ${path}`);
  const state = await c.owner('/staff/state');
  assert.deepEqual(state.data.pkg.enabled, ['core']); assert.equal(state.data.pkg.listed, true);
});

test('O6: a stripped licence copy never unlocks services; an old install keeps its services and moves to the listed licence', async t => {
  // An old install: its business only ever had a licence without `features`, issued before the cut-off: everything, as before.
  const c = await cafe(t, { features: undefined });
  const before = new Date(LEGACY_LICENCE_UNTIL - 86400000), after = new Date(LEGACY_LICENCE_UNTIL + 86400000);
  const installId = c.link.read()!.installId, base: License = { tenantId: 'mola-demo', name: 'Mola Demo', endsAt: new Date(Date.now() + 300 * 86400000).toISOString(), suspended: false, kind: 'subscription', planMonths: 12, service: 'full' };
  assert.equal(c.link.receive(testLicense(installId, base, 2, before)), true);
  assert.deepEqual(c.link.features('mola-demo'), [...featureIds]);
  allowed(await c.owner('/staff/stock'));
  // A licence without `features` issued after the cut-off (only an older Merkez still signs one): the core only.
  assert.equal(c.link.receive(testLicense(installId, base, 3, after)), true);
  assert.deepEqual(c.link.features('mola-demo'), ['core']);
  // Its twin with the list (same serial, as an older Merkez signs both) replaces it; the paid services are there.
  const paid: FeatureId[] = ['core', 'qr-menu', 'qr-order', 'stock', 'reservations'];
  assert.equal(c.link.receive(testLicense(installId, { ...base, features: paid }, 3, after)), true);
  assert.deepEqual(c.link.features('mola-demo'), paid);
  allowed(await c.owner('/staff/stock')); refused(await c.owner('/staff/shifts/code'));
  // The other way round (the twin without the list after the listed one, same serial) is refused, as any same serial.
  assert.equal(c.link.receive(testLicense(installId, base, 3, after)), false);
  assert.equal(c.link.receive(testLicense(installId, base, 3, before)), false);
  // A stripped copy written straight into the data (by hand, bypassing the heartbeat): even an old one opens the core only now,
  // because a licence with the list was taken here (kept in the record and in the mark beside the data folder).
  const write = (fn: (r: any) => void) => (c.link as unknown as { write(fn: (r: any) => void): void }).write(fn);
  write(r => { r.licenses['mola-demo'] = testLicense(installId, base, 4, before); });
  assert.deepEqual(c.link.features('mola-demo'), ['core']);
  refused(await c.owner('/staff/stock'), 'stock');
  write(r => { delete r.withFeatures; r.licenses['mola-demo'] = testLicense(installId, base, 5, before); });
  assert.deepEqual(c.link.features('mola-demo'), ['core'], 'the mark remembers it');
  // A Merkez-signed licence with the list again: exactly its services.
  assert.equal(c.link.receive(testLicense(installId, { ...base, features: paid }, 6, after)), true);
  assert.deepEqual(c.link.features('mola-demo'), paid);
});

test('the snapshot and core answers leave a closed service out (reservations, stock, comparisons, KDV)', async t => {
  const c = await cafe(t, { features: ALL_BUT('reservations', 'stock', 'reports-advanced', 'shifts') });
  const s = (await c.owner('/staff/state')).data;
  assert.deepEqual(s.pkg.enabled, ALL_BUT('reservations', 'stock', 'reports-advanced', 'shifts'));
  assert.equal(s.pkg.name, 'Size özel paket');
  assert.equal(s.stockProducts, undefined);
  assert.deepEqual(s.reservationMarks, []); assert.equal(s.reservations.canReserve, false);
  const overview = (await c.owner('/staff/reports/overview?from=2026-10-05&to=2026-10-05')).data;
  assert.equal(overview.previous, null); assert.equal(overview.channels, undefined);
  const simple = (await c.owner('/staff/reports/simple?from=2026-10-05&to=2026-10-05')).data;
  assert.equal(simple.vat, null); assert.doesNotMatch(simple.sentence, / göre /);
  // The vardiya switch and the bahşiş rule are refused; the closing time (core) still saves.
  refused(await c.owner('/staff/cash/settings', { shiftTracking: true }));
  refused(await c.owner('/staff/cash/settings', { tipRule: 'hours' }));
  assert.equal((await c.owner('/staff/cash/settings', { closingTime: '23:00' })).status, 200);
  assert.equal((await c.owner('/staff/cash/settings')).data.shiftTracking, false);
});

test('data entered while a service was on stays while it is off and comes back when it is on again', async t => {
  const c = await cafe(t);
  const item = await c.owner('/staff/stock/items', { name: 'Paket sütü', unit: 'ml', min: 1000 });
  assert.equal(item.status, 200, JSON.stringify(item.data));
  const table = (await c.owner('/staff/state')).data.tables[0];
  const booked = await c.owner('/staff/reservations', { requestId: randomUUID().replace(/-/g, ''), tableId: table.id, day: '2026-10-06', time: '20:00', name: 'Ayşe', people: 4 });
  assert.equal(booked.status, 200, JSON.stringify(booked.data));
  c.license({ features: ['core'] });
  refused(await c.owner('/staff/stock')); refused(await c.owner('/staff/reservations?from=2026-10-01&to=2026-10-31'));
  // Nothing was touched while off.
  assert.ok((c.store.read('mola-demo').reservations ?? []).some(r => r.name === 'Ayşe'));
  c.license({ features: ['core', 'stock', 'reservations'] });
  const stock = (await c.owner('/staff/stock')).data;
  assert.ok(JSON.stringify(stock).includes('Paket sütü'));
  const list = (await c.owner('/staff/reservations?from=2026-10-01&to=2026-10-31')).data;
  assert.ok(list.reservations.some((r: { name: string }) => r.name === 'Ayşe'));
});

test('Müdür is part of the core: made, signed in and kept with any package; an old licence listing "manager-role" is read as usual', async t => {
  const c = await cafe(t, { features: ['core'] });
  const made = await c.owner('/staff/users', { username: 'mudur', name: 'Müdür Mehmet', role: 'manager', password: 'MudurDeneme!2026' });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const manager = c.client('mudur', 'MudurDeneme!2026');
  assert.equal((await manager.login()).status, 200);
  assert.equal((await manager('/staff/state')).status, 200);
  const kasiyer = (await c.owner('/staff/users')).data.find((u: { username: string }) => u.username === 'kasiyer');
  assert.equal((await c.owner('/staff/users/update', { id: kasiyer.id, version: kasiyer.version, role: 'manager', active: true })).status, 200);
  // A licence signed before 6 Ekim still lists the retired 'manager-role': accepted, the id dropped, nothing else changes.
  const old = ['core', 'qr-menu', 'manager-role'] as unknown as FeatureId[];
  c.license({ features: old });
  assert.deepEqual(enabledFeatures(old), ['core', 'qr-menu']);
  const state = await manager('/staff/state');
  assert.equal(state.status, 200); assert.deepEqual(state.data.pkg.enabled, ['core', 'qr-menu']);
  assert.equal((await c.client('mudur', 'MudurDeneme!2026').login()).status, 200);
  assert.equal((await c.owner('/staff/state')).data.pkg.name, 'Size özel paket');
});

test('guests: QR menü off closes the menu; QR sipariş off keeps the menu but not ordering; Sadece QR menü is unchanged', async t => {
  const c = await cafe(t);
  const token = c.store.read('mola-demo').tables.find(tb => tb.token)!.token;
  const guest = () => c.client('misafir');
  c.license({ features: ALL_BUT('qr-order') });
  let g = guest();
  const opened = await g('/guest/session', { token }); assert.equal(opened.status, 200);
  const state = await g('/guest/state'); assert.equal(state.status, 200); assert.equal(state.data.menuOnly, true);
  const product = state.data.products[0];
  const order = await g('/guest/orders', { requestId: randomUUID().replace(/-/g, ''), tableId: opened.data.tableId, expectedTotal: product.price, lines: [{ productId: product.id, quantity: 1, selections: [] }] });
  refused(order, 'guest order');
  refused(await g('/guest/call', { requestId: randomUUID().replace(/-/g, ''), kind: 'waiter' }), 'waiter call');
  c.license({ features: ALL_BUT('qr-menu', 'qr-order') });
  g = guest();
  refused(await g('/guest/session', { token }), 'menu');
  // "Sadece QR menü" (service 'menu') with the menu in its list: exactly the old answer (MENU_ONLY, 409), the menu open.
  c.license({ service: 'menu', features: [...featureIds] });
  g = guest();
  assert.equal((await g('/guest/session', { token })).status, 200);
  const menu = await g('/guest/state'); assert.equal(menu.data.menuOnly, true);
  const call = await g('/guest/call', { requestId: randomUUID().replace(/-/g, ''), kind: 'waiter' });
  assert.equal(call.status, 409); assert.equal(call.data.code, 'MENU_ONLY');
});

test('trial → package: the owner hears once which services closed; Bildirimler keeps a copy', async t => {
  const c = await cafe(t, { kind: 'trial', planMonths: undefined, features: ALL_BUT('integrations') });
  const trial = (await c.owner('/staff/state')).data.pkg;
  assert.equal(trial.name, 'Deneme'); assert.ok(trial.trial); assert.equal(trial.notice, undefined);
  c.license({ kind: 'subscription', planMonths: 12, features: ['core', 'qr-menu', 'email-reports'] });
  const after = (await c.owner('/staff/state')).data.pkg;
  assert.equal(after.name, 'Çay bahçesi');
  assert.ok(after.notice); assert.ok(after.notice.closed.includes('stock')); assert.ok(!after.notice.closed.includes('qr-menu'));
  const inbox = (await c.owner('/staff/notifications')).data.items;
  assert.equal(inbox.filter((n: { title: string }) => /Deneme süreniz bitti/.test(n.title)).length, 1);
  assert.equal((await c.owner('/staff/package/notice-seen', { id: after.notice.id })).status, 200);
  assert.equal((await c.owner('/staff/state')).data.pkg.notice, undefined);
  // A later licence (renewal) does not bring it back.
  c.license({ kind: 'subscription', planMonths: 12, features: ['core', 'qr-menu', 'email-reports'] });
  assert.equal((await c.owner('/staff/state')).data.pkg.notice, undefined);
  assert.equal((await c.owner('/staff/notifications')).data.items.filter((n: { title: string }) => /Deneme süreniz bitti/.test(n.title)).length, 1);
  // Non-owners get only the services.
  const kasa = c.client('kasiyer'); await kasa.login();
  assert.deepEqual(Object.keys((await kasa('/staff/state')).data.pkg).sort(), ['enabled', 'listed']);
});
