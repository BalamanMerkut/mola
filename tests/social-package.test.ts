import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { MerkezLink } from '../server/kafe-link.js';
import { publicKeyFrom, verifyLicense, type License } from '../server/license.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { CATALOG_VERSION } from '../server/merkez/catalog.js';
import { licenseFeatures, MerkezStore, type MerkezBusiness } from '../server/merkez/store.js';
import { MERKEZ_ACCEPTS } from '../server/sync-protocol.js';
import { defaultPackages, featureById, featureIds, monthlyTotal, yearlyFromMonthly, type FeatureId } from '../packages/domain/features.js';
import { FEATURE_NOT_IN_PACKAGE, FEATURES_SOCIAL, packageName, routeFeatures } from '../packages/domain/feature-gate.js';
import { LEGACY_FULL, LEGACY_MENU, legacyFeatures, sellableFeatures, startingPackages } from '../packages/domain/service-pricing.js';
import { guestSocial } from '../packages/domain/social-links.js';
import { client, licensed, MERKEZ_PASSWORD, merkezPair, temp, testLicense, TEST_PUBLIC_KEY } from './merkez-fixture.js';

/*
 * "Sosyal medya ve QR kartları" (`social`, owner's decision 6 Ekim): a paid service (₺20/ay since 15 Ekim), in Restoran Pro, on the old
 * plans and in the trial; sold as an add-on to the others. Without it the café keeps the Google review row (core) and the
 * after-payment Google button, refuses the other platforms and the QR cards, hides the follow icons from guests; Merkez's
 * short addresses show "kullanılamıyor"; nothing is deleted. A licence from a Merkez that does not decide `social` yet keeps
 * it on; an updated Merkez signs the old plans' and trials' licences again at its first start.
 */
const TL = 100, rid = () => randomUUID().replace(/-/g, '');
const WITHOUT_SOCIAL = sellableFeatures().filter(id => id !== 'social');
const strip = (ids: readonly FeatureId[]) => ids.filter(id => id !== 'social');

test('the catalogue: ₺20/ay in Ekler, yearly ×10; Restoran Pro 2.600 TL/ay with it (and Bulutta şifreli yedek); Kafe Standart and Çay bahçesi without; old plans and the trial hold it', () => {
  const f = featureById.get('social')!;
  assert.equal(f.name, 'Sosyal medya ve QR kartları'); assert.equal(f.group, 'Ekler'); assert.equal(f.monthly, 20 * TL); assert.ok(!f.soon && !f.required);
  assert.equal(yearlyFromMonthly(f.monthly), 200 * TL);
  const pkg = (id: string) => defaultPackages.find(p => p.id === id)!.features;
  assert.ok(pkg('restoran-pro').includes('social'));
  assert.equal(monthlyTotal(pkg('restoran-pro')), 2600 * TL);
  assert.equal(pkg('kafe-standart').includes('social'), false); assert.equal(pkg('cay-bahcesi').includes('social'), false);
  assert.ok(legacyFeatures('full').includes('social')); assert.ok(legacyFeatures('menu').includes('social'));
  assert.ok(licenseFeatures({ kind: 'trial' }).includes('social'));
  assert.equal(licenseFeatures({ kind: 'subscription', services: { packageId: 'kafe-standart', features: pkg('kafe-standart'), updatedAt: '' } }).includes('social'), false);
  // The QR cards' route belongs to it; saving the links is checked in the route (the Google row stays core).
  assert.deepEqual(routeFeatures('/staff/social-qr'), ['social']); assert.deepEqual(routeFeatures('/staff/social-links'), []);
  assert.equal(packageName(pkg('restoran-pro'), { listed: true }), 'Restoran Pro');
  // The guest's part: everything, or only the Google row and `socialOff`.
  const s = { socialLinks: { instagram: 'https://instagram.com/mola' }, googleReviewUrl: 'https://g.page/r/mola/review' };
  assert.deepEqual(guestSocial(s, true), { socialLinks: { instagram: 'https://instagram.com/mola', review: 'https://g.page/r/mola/review' } });
  assert.deepEqual(guestSocial(s, false), { socialLinks: { review: 'https://g.page/r/mola/review' }, socialOff: true });
  assert.deepEqual(guestSocial({ socialLinks: s.socialLinks }, false), { socialOff: true });
  assert.ok(MERKEZ_ACCEPTS.includes(FEATURES_SOCIAL));
});

/** A café with the demo businesses and a licence from "Merkez" (test key); `license` hands it a newer one. */
async function cafe(t: { after: (fn: () => Promise<void>) => void }, features?: FeatureId[]) {
  const store = new Store(temp('social-package'));
  const base: License = { tenantId: 'mola-demo', name: 'Mola Demo', endsAt: new Date(Date.now() + 300 * 86400000).toISOString(), suspended: false, kind: 'subscription', planMonths: 12, service: 'full' };
  const installId = licensed(store, features ? { features } : {});
  const link = new MerkezLink(store, { publicKey: publicKeyFrom(TEST_PUBLIC_KEY) });
  const server = createServer(createApp(store, () => new Date(), undefined, undefined, undefined, () => {}, undefined, undefined, undefined, undefined, link));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { link.stop(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let serial = 1;
  const license = (patch: Partial<License>) => { serial++; assert.equal(link.receive(testLicense(installId, { ...base, ...patch }, serial)), true); };
  /** What the last heartbeat's Merkez said it understands (undefined: never heard). */
  const accepts = (list: string[] | undefined) => (link as unknown as { write(fn: (r: { accepts?: string[] }) => void): void }).write(r => { if (list) r.accepts = list; else delete r.accepts; });
  const owner = client(api);
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  const state = async () => (await owner('/staff/state')).data;
  const guest = async () => {
    const g = client(api), token = store.read('mola-demo').tables.find(tb => tb.token)!.token;
    assert.equal((await g('/guest/session', { token })).status, 200);
    return (await g('/guest/state')).data;
  };
  return { store, link, owner, state, guest, license, accepts };
}

test('café without the service: the Google row saves, other platforms 403, QR cards 403, guests get only the Google row; nothing deleted; a licence without features after one with them opens the core only', async t => {
  const c = await cafe(t, WITHOUT_SOCIAL);
  c.store.mutate('mola-demo', s => { s.socialLinks = { instagram: 'https://instagram.com/mola', whatsapp: 'https://wa.me/905321234567' }; s.googleReviewUrl = 'https://g.page/r/mola/review'; });
  let s = await c.state();
  assert.equal(s.pkg.enabled.includes('social'), false);
  assert.deepEqual(Object.keys(s.socialLinks).sort(), ['instagram', 'review', 'whatsapp'], 'the owner still sees what is kept');
  // The Google review row (core) saves; the other links stay exactly as they were (not removed by a request without them).
  let r = await c.owner('/staff/social-links', { requestId: rid(), version: s.businessRevision ?? 0, links: { review: 'https://g.page/r/yeni/review' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(c.store.read('mola-demo').googleReviewUrl, 'https://g.page/r/yeni/review');
  assert.deepEqual(c.store.read('mola-demo').socialLinks, { instagram: 'https://instagram.com/mola', whatsapp: 'https://wa.me/905321234567' });
  // Unchanged values may come along; a changed, new or removed platform is refused.
  r = await c.owner('/staff/social-links', { requestId: rid(), version: r.data.revision, links: { instagram: '@mola', review: 'https://g.page/r/yeni/review' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  for (const links of [{ instagram: '@baska' }, { facebook: 'molacafe' }, { whatsapp: '' }, { instagram: '@baska', review: '' }]) {
    const refused = await c.owner('/staff/social-links', { requestId: rid(), version: r.data.revision, links });
    assert.equal(refused.status, 403, JSON.stringify(links)); assert.equal(refused.data.code, FEATURE_NOT_IN_PACKAGE); assert.match(refused.data.message, /Sosyal medya ve QR kartları/);
  }
  assert.equal(c.store.read('mola-demo').googleReviewUrl, 'https://g.page/r/yeni/review', 'a refused request changes nothing');
  // QR cards: refused for every platform, the Google one too.
  const qr = await c.owner('/staff/social-qr', {});
  assert.equal(qr.status, 403); assert.equal(qr.data.code, FEATURE_NOT_IN_PACKAGE);
  // Guests: only the Google row (the after-payment button), no follow icons.
  let g = await c.guest();
  assert.deepEqual(g.socialLinks, { review: 'https://g.page/r/yeni/review' }); assert.equal(g.socialOff, true);
  // Added to the package: everything is back as it was.
  c.license({ features: sellableFeatures() });
  g = await c.guest();
  assert.deepEqual(g.socialLinks, { instagram: 'https://instagram.com/mola', whatsapp: 'https://wa.me/905321234567', review: 'https://g.page/r/yeni/review' }); assert.equal(g.socialOff, undefined);
  s = await c.state();
  assert.equal((await c.owner('/staff/social-links', { requestId: rid(), version: s.businessRevision, links: { instagram: '@baska', review: 'https://g.page/r/yeni/review' } })).status, 200);
  // A licence without `features` after one with them (güvenlik denetimi O6): the core only, never "everything".
  c.license({ features: WITHOUT_SOCIAL }); assert.equal((await c.state()).pkg.enabled.includes('social'), false);
  c.license({ features: undefined });
  s = await c.state();
  assert.deepEqual(s.pkg.enabled, ['core']);
  assert.equal((await c.owner('/staff/social-qr', {})).status, 403);
});

test('a licence from a Merkez that does not decide "social" yet keeps it on; once Merkez says it does, the list counts', async t => {
  const c = await cafe(t, WITHOUT_SOCIAL);
  // The heartbeat of an older Merkez: its accepts list has no FEATURES_SOCIAL; its licence lists were signed before the service.
  c.accepts(['backup.second', 'update', 'social']);
  assert.ok((await c.state()).pkg.enabled.includes('social'));
  assert.equal((await c.owner('/staff/social-qr', {})).data.code === FEATURE_NOT_IN_PACKAGE, false, 'not refused by the package');
  assert.equal((await c.guest()).socialOff, undefined);
  // An updated Merkez: the licence's own list decides.
  c.accepts([...MERKEZ_ACCEPTS]);
  assert.equal((await c.state()).pkg.enabled.includes('social'), false);
  assert.equal((await c.owner('/staff/social-qr', {})).status, 403);
  // Never heard any Merkez (tests, a licence handed over): read as listed.
  c.accepts(undefined);
  assert.equal((await c.state()).pkg.enabled.includes('social'), false);
});

test('Merkez update: the old plans get "social", their businesses and trials are signed again at once; other packages untouched; once only', async t => {
  const dir = temp('social-catalog'), key = randomBytes(32);
  const old = new MerkezStore(join(dir, 'merkez'), key, { initialPassword: MERKEZ_PASSWORD });
  const installId = randomUUID(), at = new Date().toISOString(), end = new Date(Date.now() + 90 * 86400000).toISOString();
  const pkg = (id: string) => strip(startingPackages(at).find(p => p.id === id)!.features);
  old.mutate(d => {
    d.installs.push({ id: installId, secret: 'x'.repeat(43), createdAt: at, lastSeenAt: at });
    // The 5 Ekim catalogue: no `social` anywhere, no version.
    d.catalog = { prices: {}, packages: startingPackages(at).map(p => ({ ...p, features: strip(p.features) })), vatRate: 20, createdAt: at, updatedAt: at };
    const biz = (tenantId: string, packageId: string, extra: Partial<MerkezBusiness> = {}): MerkezBusiness => ({ tenantId, name: tenantId, source: 'admin', serial: 7, installId, kind: 'subscription', planMonths: 12, endsAt: end, suspended: false, service: 'full', createdAt: at, services: { packageId, features: pkg(packageId), updatedAt: at }, ...extra });
    d.businesses.push(biz('tam', LEGACY_FULL), biz('menu', LEGACY_MENU, { service: 'menu' }), biz('deneme', 'kafe-standart', { kind: 'trial', trialStartedAt: at }), biz('standart', 'kafe-standart'), biz('pro', 'restoran-pro'));
  });
  old.close();
  const store = new MerkezStore(join(dir, 'merkez'), key); t.after(() => store.close());
  createMerkezApp(store);
  const d = store.read(), pub = publicKeyFrom(store.publicKey), one = (id: string) => d.businesses.find(b => b.tenantId === id)!;
  assert.equal(d.catalog!.version, CATALOG_VERSION);
  const stored = (id: string) => d.catalog!.packages.find(p => p.id === id)!.features;
  assert.deepEqual(stored(LEGACY_FULL), legacyFeatures('full')); assert.deepEqual(stored(LEGACY_MENU), legacyFeatures('menu'));
  // Step 2 leaves a stored package alone (the vendor's); step 4 (15 Ekim, the owner's 2026-10 list) then gives the three starting
  // packages their starting contents once: Restoran Pro holds it from there, Kafe Standart does not.
  assert.equal(stored('restoran-pro').includes('social'), true);
  assert.equal(stored('kafe-standart').includes('social'), false);
  // Old plans and the trial: signed again (step 2, serial + 1) with `social`, then step 3 (11 Ekim) signs every connected
  // business once more as its one licence with the list (serial + 1): no copy without features any more.
  for (const id of ['tam', 'menu', 'deneme']) {
    assert.equal(one(id).serial, 9, id);
    assert.ok(verifyLicense(one(id).signed, pub).features!.includes('social'), id);
    assert.equal(one(id).signedFeatures, undefined, id);
  }
  assert.deepEqual(one('tam').services!.features, legacyFeatures('full'));
  assert.deepEqual(verifyLicense(one('menu').signed, pub).features, legacyFeatures('menu'));
  // Packages without it: step 2 had nothing to sign; step 3 signs them with their list, still without `social`; step 4 gives
  // Restoran Pro its starting contents (with `social`): its business follows and is signed once more.
  assert.equal(one('standart').serial, 8); assert.equal(one('pro').serial, 9);
  assert.ok(verifyLicense(one('pro').signed, pub).features!.includes('social'));
  assert.equal(verifyLicense(one('standart').signed, pub).features!.includes('social'), false);
  const line = d.audit.filter(a => a.action === 'catalog.service_added');
  assert.equal(line.length, 1); assert.match(line[0].detail!, /Eski planlara eklendi \(2 işletme\); 3 işletmenin lisansı yeniden imzalandı/);
  assert.match(d.audit.find(a => a.action === 'catalog.single_licence')!.detail!, /5 işletmenin lisansı yeniden imzalandı/);
  // Once only.
  createMerkezApp(store);
  assert.equal(store.read().businesses.find(b => b.tenantId === 'tam')!.serial, 9);
  assert.equal(store.read().audit.filter(a => a.action === 'catalog.service_added').length, 1);
  assert.equal(store.read().audit.filter(a => a.action === 'catalog.single_licence').length, 1);
  // A Merkez from before packaging (no catalogue at all) gets both steps at once: old plans with `social`, no second line.
  const fresh = temp('social-catalog-fresh'), key2 = randomBytes(32);
  const older = new MerkezStore(join(fresh, 'merkez'), key2, { initialPassword: MERKEZ_PASSWORD });
  older.mutate(x => { x.installs.push({ id: installId, secret: 'x'.repeat(43), createdAt: at, lastSeenAt: at }); x.businesses.push({ tenantId: 'eski', name: 'eski', source: 'admin', serial: 2, installId, kind: 'subscription', planMonths: 12, endsAt: end, suspended: false, service: 'full', createdAt: at }); });
  older.close();
  const s2 = new MerkezStore(join(fresh, 'merkez'), key2); t.after(() => s2.close());
  createMerkezApp(s2);
  const e = s2.read().businesses[0];
  assert.equal(e.services!.packageId, LEGACY_FULL); assert.ok(verifyLicense(e.signed, publicKeyFrom(s2.publicKey)).features!.includes('social'));
  assert.equal(s2.read().catalog!.version, CATALOG_VERSION);
});

const page = async (url: string) => { const r = await fetch(url, { redirect: 'manual' }); return { status: r.status, location: r.headers.get('location'), text: await r.text() }; };
test('Merkez short addresses need the service: a package without it shows "kullanılamıyor" (links kept, still synced); added back, they forward again', async t => {
  const pair = await merkezPair('social-package-merkez', { demo: true }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin(); await pair.adminStepUp();
  const owner = pair.kafe(); assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  let s = (await owner('/staff/state')).data;
  assert.ok(s.pkg.enabled.includes('social'), 'the old plan holds it');
  assert.equal((await owner('/staff/social-links', { requestId: rid(), version: s.businessRevision ?? 0, links: { instagram: '@molacoffee', review: 'https://g.page/r/mola/review' } })).status, 200);
  const qr = await owner('/staff/social-qr', {});
  assert.equal(qr.status, 200, JSON.stringify(qr.data));
  const base: string = qr.data.base;
  assert.equal((await page(`${base}/instagram`)).status, 302);
  // Kafe Standart (no social): the short addresses stop at once, the Google one too (the QR cards are the paid part).
  assert.equal((await pair.admin('/business-services', { requestId: rid(), tenantId: 'mola-demo', packageId: 'kafe-standart', discount: null })).status, 200);
  for (const platform of ['instagram', 'review']) {
    const p = await page(`${base}/${platform}`);
    assert.equal(p.status, 200, platform); assert.match(p.text, /Bu işletmenin bu hizmeti şu anda kullanılamıyor\./); assert.equal(p.text.includes('instagram.com'), false);
  }
  // The café hears it with the next heartbeat: QR cards refused, the Google row still saves, the links still go up.
  assert.equal((await pair.link.sync()).ok, true);
  s = (await owner('/staff/state')).data;
  assert.equal(s.pkg.enabled.includes('social'), false);
  assert.equal((await owner('/staff/social-qr', {})).status, 403);
  assert.equal((await owner('/staff/social-links', { requestId: rid(), version: s.businessRevision, links: { review: 'https://g.page/r/mola-yeni/review' } })).status, 200);
  assert.equal((await pair.link.sync()).ok, true);
  const biz = () => pair.merkezStore.read().businesses.find(b => b.tenantId === 'mola-demo')!;
  assert.deepEqual(biz().social?.links, { instagram: 'https://instagram.com/molacoffee', review: 'https://g.page/r/mola-yeni/review' }, 'kept and kept in step');
  // Added back (Restoran Pro holds it): forwards again, nothing to reprint.
  assert.equal((await pair.admin('/business-services', { requestId: rid(), tenantId: 'mola-demo', packageId: 'restoran-pro', discount: null })).status, 200);
  const p = await page(`${base}/instagram`);
  assert.equal(p.status, 302); assert.equal(p.location, 'https://instagram.com/molacoffee');
  assert.equal((await page(`${base}/review`)).location, 'https://g.page/r/mola-yeni/review');
});
