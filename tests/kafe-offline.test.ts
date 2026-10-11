import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { DEMO_PASSWORD } from '../server/app.js';
import { createApp } from '../server/app.js';
import { MerkezLink, skewText } from '../server/kafe-link.js';
import { publicKeyFrom, verifyPulse } from '../server/license.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { MerkezStore } from '../server/merkez/store.js';
import { Store } from '../server/store.js';
import { client, MERKEZ_PASSWORD, merkezPair, temp } from './merkez-fixture.js';

const rid = () => randomUUID().replace(/-/g, '');
const DAY = 86400000;

test('offline limit: counted from Merkez’s signed pulse, warning from day 7, closed at day 14 (bills and support still work); an old backup and a clock turned back do not help', async t => {
  let time = Date.parse('2026-10-01T09:00:00Z');
  const pair = await merkezPair('offline-limit', { demo: true, now: () => new Date(time) }); t.after(() => pair.close());
  const { installId } = await pair.importDemo();
  const owner = pair.kafe(), login = () => owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  await login();
  const s = (await owner('/staff/state')).data;
  await owner('/staff/setup', { requestId: rid(), version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: 0, commissionBps: null });
  const token = s.tables[0].token;
  assert.equal((await pair.link.sync()).ok, true);
  // The pulse is Merkez-signed (a forged or edited one is ignored) and names this install.
  const record = pair.link.read()!, pulse = verifyPulse(record.pulse, publicKeyFrom(pair.merkezStore.publicKey));
  assert.equal(pulse.installId, installId); assert.equal(pulse.serverTime, new Date(time).toISOString()); assert.equal(pulse.machine, 'active');
  // The mark beside the data folder (not inside it, so never in a backup) is sealed: no plain times or serials.
  const markFile = join(dirname(pair.store.directory), 'lisans-izi', `${installId}.json`);
  assert.ok(existsSync(markFile)); assert.doesNotMatch(readFileSync(markFile, 'utf8'), /highWater|serial|mola-demo/);
  // An "old backup" of the café's link record (licence serial and pulse of today).
  const oldRow = (pair.store.db.prepare('SELECT payload FROM merkez_link WHERE id=1').get() as { payload: Uint8Array }).payload;
  // The vendor renews; the café takes the newer licence with the next heartbeat.
  await pair.adminLogin();
  const business = (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo');
  assert.equal((await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: business.endsAt, expectedSuspended: false, months: 1, suspended: false })).status, 200);
  time += DAY; assert.equal((await pair.link.sync()).ok, true);
  const renewed = pair.link.license('mola-demo')!.endsAt;
  // Offline from here on.
  const down: typeof fetch = () => Promise.reject(new TypeError('fetch failed'));
  const contact = time;
  const offline = new MerkezLink(pair.store, { now: () => new Date(time), url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), fetch: down, machineKey: 'test:kasa-pc' });
  time = contact + 6 * DAY;
  assert.equal(offline.notice(), undefined, 'no warning before day 7');
  time = contact + 7 * DAY;
  assert.equal(offline.offlineDays(), 7); assert.match(offline.notice()!, /7 gündür bağlanılamadı\. 7 gün içinde bağlanmazsa/);
  assert.equal(offline.active('mola-demo'), true);
  time = contact + 14 * DAY;
  assert.equal(offline.blocked(), 'offline'); assert.equal(offline.active('mola-demo'), false); assert.match(offline.notice()!, /14 gündür/);
  // The same through the café server: no menu, no new order; the open bill is still settled, support still answers.
  await login();
  assert.equal((await pair.kafe()('/guest/session', { token })).data.code, 'MENU_UNAVAILABLE');
  const support = (await owner('/staff/support')).data;
  assert.equal(support.merkez.blocked, 'offline'); assert.equal(support.merkez.offlineLimitDays, 14); assert.equal(support.license.active, false);
  assert.equal((await owner('/staff/support', { requestId: rid(), subject: 'İnternet yok', text: 'Bağlantı kesik, yardım.' })).status, 200);
  // Clock turned back by 10 days and the server restarted: the kept high-water mark holds.
  time = contact + 4 * DAY;
  const restarted = new MerkezLink(pair.store, { now: () => new Date(time), url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), fetch: down, machineKey: 'test:kasa-pc' });
  assert.equal(restarted.blocked(), 'offline', 'turning the clock back does not reopen it');
  assert.ok(restarted.licenseNow().getTime() >= contact + 14 * DAY);
  // The old backup put back: its older licence (and older pulse) is not used; the mark still has the newest serial and time.
  pair.store.db.prepare('UPDATE merkez_link SET payload=? WHERE id=1').run(oldRow);
  const restored = new MerkezLink(pair.store, { now: () => new Date(time), url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), fetch: down, machineKey: 'test:kasa-pc' });
  assert.equal(restored.license('mola-demo'), undefined, 'an older licence than one already seen is not used');
  assert.equal(restored.blocked(), 'offline');
  // Back online: the newest licence and a fresh pulse arrive, the café opens again.
  time = contact + 15 * DAY;
  const online = new MerkezLink(pair.store, { now: () => new Date(time), url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), machineKey: 'test:kasa-pc' });
  assert.equal((await online.sync()).ok, true);
  assert.equal(online.license('mola-demo')!.endsAt, renewed); assert.equal(online.blocked(), undefined); assert.equal(online.active('mola-demo'), true);
});

test('a wrong computer clock is named against Merkez’s time; a non-loopback Merkez over plain HTTP is refused unless MOLA_MERKEZ_LAN=1', async t => {
  let time = Date.parse('2026-10-03T09:00:00Z');
  const dir = temp('clock'), merkez = new MerkezStore(join(dir, 'merkez'), randomBytes(32), { initialPassword: MERKEZ_PASSWORD });
  const server = createServer(createMerkezApp(merkez, { now: () => new Date(time) })); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const store = new Store(join(dir, 'kafe'), undefined);
  // This computer's clock is 25 minutes behind Merkez.
  const cafeClock = () => new Date(time - 25 * 60_000);
  const link = new MerkezLink(store, { now: cafeClock, url: base, publicKey: publicKeyFrom(merkez.publicKey), machineKey: 'test:kasa-pc' });
  const kafeServer = createServer(createApp(store, cafeClock, undefined, undefined, undefined, () => {}, undefined, undefined, undefined, undefined, link)); await new Promise<void>(r => kafeServer.listen(0, '127.0.0.1', r));
  t.after(async () => { for (const s of [server, kafeServer]) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); } store.close(); merkez.close(); });
  const admin = client(`${base}/api/merkez/admin`); await admin('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  const tenants = (store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).map(r => r.tenant);
  const imported = await admin('/import', { requestId: rid(), businesses: tenants.map(t => ({ tenantId: t, name: store.directoryEntry(t).name, license: { endsAt: new Date(time + 365 * DAY).toISOString(), suspended: false, kind: 'subscription', planMonths: 12 } })) });
  link.adopt(imported.data);
  assert.equal((await link.sync()).ok, true, 'it signs with Merkez’s time and gets through');
  assert.equal(skewText(link.clockSkew()), '25 dakika geri');
  assert.match(link.notice()!, /Bilgisayarın saati 25 dakika geri/);
  const owner = client(`http://127.0.0.1:${(kafeServer.address() as AddressInfo).port}/api`);
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  assert.match((await owner('/staff/support')).data.merkez.notice, /saati 25 dakika geri/);
  assert.equal(skewText(-3 * 3600_000), '3 saat ileri'); assert.equal(skewText(2 * DAY + 5), '2 gün geri');
  // A clock far ahead (a flat BIOS battery): closed until Merkez is reached; then Merkez's time counts, and once the clock
  // is fixed the kept mark does not hold the café shut.
  let ahead = 400 * DAY;
  const wrong = new MerkezLink(store, { now: () => new Date(time + ahead), url: base, publicKey: publicKeyFrom(merkez.publicKey), machineKey: 'test:kasa-pc' });
  assert.equal(wrong.blocked(), 'offline');
  assert.equal((await wrong.sync()).ok, true);
  assert.equal(wrong.blocked(), undefined); assert.match(wrong.notice()!, /Bilgisayarın saati 400 gün ileri/);
  assert.equal(wrong.active('mola-demo'), true, 'Merkez’s time decides, not the wrong clock');
  ahead = 0;
  const fixed = new MerkezLink(store, { now: () => new Date(time), url: base, publicKey: publicKeyFrom(merkez.publicKey), machineKey: 'test:kasa-pc' });
  assert.equal(fixed.blocked(), undefined); assert.equal(fixed.active('mola-demo'), true);
  // Merkez on another computer, plain HTTP: refused before anything is sent (install secret, invoice details).
  const sent: string[] = [];
  const spy: typeof fetch = async input => { sent.push(String(input)); throw new TypeError('fetch failed'); };
  const lan = new MerkezLink(new Store(temp('lan-merkez'), []), { url: 'http://192.168.1.50:4000', publicKey: publicKeyFrom(merkez.publicKey), fetch: spy });
  await assert.rejects(lan.activate('code', { code: 'ABCD-EFGH-JKLM' }), (e: Error & { code?: string }) => e.code === 'MERKEZ_INSECURE' && /https değil/.test(e.message));
  assert.deepEqual(sent, []);
  process.env.MOLA_MERKEZ_LAN = '1';
  try { await assert.rejects(lan.activate('code', { code: 'ABCD-EFGH-JKLM' }), (e: Error & { code?: string }) => e.code === 'MERKEZ_UNREACHABLE'); }
  finally { delete process.env.MOLA_MERKEZ_LAN; }
  assert.equal(sent.length, 1, 'with the LAN opt-in it is sent');
  const secure = new MerkezLink(new Store(temp('https-merkez'), []), { url: 'https://merkez.example.com', publicKey: publicKeyFrom(merkez.publicKey), fetch: spy });
  await assert.rejects(secure.activate('code', { code: 'ABCD-EFGH-JKLM' }), (e: Error & { code?: string }) => e.code === 'MERKEZ_UNREACHABLE');
});

test('licence copy: the same install from a second computer takes over; the first closes with a clear reason; the vendor is told and can give it back', async t => {
  let time = Date.parse('2026-10-03T09:00:00Z');
  const pair = await merkezPair('two-machines', { demo: true, now: () => new Date(time), machineKey: 'test:eski-pc' }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin();
  const owner = pair.kafe(); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  const s = (await owner('/staff/state')).data;
  await owner('/staff/setup', { requestId: rid(), version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: 0, commissionBps: null });
  const token = s.tables[0].token;
  assert.equal((await pair.link.sync()).ok, true);
  let biz = (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo');
  assert.equal(biz.machines.length, 1); assert.equal(biz.machines[0].active, true);
  assert.equal(JSON.stringify(biz.machines).includes('eski-pc'), false, 'only an HMAC of the machine id reaches Merkez');
  // A copy of the data folder (backup + recovery code) on another computer.
  const copy = join(temp('second-pc'), 'kafe'); mkdirSync(copy, { recursive: true });
  pair.store.db.exec(`VACUUM INTO '${join(copy, 'merchant.sqlite').replace(/'/g, "''")}'`);
  copyFileSync(join(pair.store.directory, 'development.key'), join(copy, 'development.key'));
  const second = new Store(copy, []); t.after(() => second.close());
  const other = new MerkezLink(second, { now: () => new Date(time), url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), machineKey: 'test:yeni-pc' });
  time += 60_000;
  assert.equal((await other.sync()).ok, true);
  assert.equal(other.blocked(), undefined); assert.equal(other.active('mola-demo'), true, 'a restore on a new computer just works');
  const state = (await pair.admin('/state')).data;
  biz = state.businesses.find((b: any) => b.tenantId === 'mola-demo');
  assert.deepEqual(biz.machines.map((m: any) => m.active), [false, true]);
  assert.ok(state.alerts.some((a: any) => a.kind === 'machine.conflict' && a.title === 'İki farklı bilgisayar' && a.tenantId === 'mola-demo'));
  // The first computer hears it with its next heartbeat: ordering closes there, with the reason; bills and support stay.
  time += 60_000;
  assert.equal((await pair.link.sync()).ok, true);
  assert.equal(pair.link.blocked(), 'moved');
  assert.equal((await pair.kafe()('/guest/session', { token })).data.code, 'MENU_UNAVAILABLE');
  assert.match((await owner('/staff/support')).data.merkez.notice, /Bu lisans başka bir bilgisayarda kullanılıyor/);
  // It stays closed: a known, replaced computer never takes the install back by itself.
  time += 60_000; await pair.link.sync(); assert.equal(pair.link.blocked(), 'moved');
  // The vendor gives it back ("Eski bilgisayarı yeniden etkinleştir"): the old one opens, the new one closes.
  const old = biz.machines.find((m: any) => !m.active);
  assert.equal((await pair.admin('/installs/machine', { requestId: rid(), tenantId: 'mola-demo', machine: old.hash })).status, 200);
  time += 60_000; await pair.link.sync(); await other.sync();
  assert.equal(pair.link.blocked(), undefined); assert.equal((await pair.kafe()('/guest/session', { token })).status, 200);
  assert.equal(other.blocked(), 'moved');
  assert.ok((await pair.admin('/state')).data.audit.some((a: any) => a.action === 'install.machine_restored' && a.by === 'admin'));
});
