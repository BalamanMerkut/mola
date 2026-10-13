import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { defaultPackages, features, monthlyTotal, type FeatureId } from '../packages/domain/features.js';
import { addedFor, LEGACY_FULL, LEGACY_MENU, legacyFeatures, monthlyRevenue, normalFeatures, periodPrice, priceFor, sellableFeatures, withoutFeature } from '../packages/domain/service-pricing.js';
import { publicKeyFrom, signLicense, verifyLicense } from '../server/license.js';
import { LEGACY_LICENCE_UNTIL } from '../server/kafe-link.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { ensureCatalog } from '../server/merkez/catalog.js';
import { journalRows } from '../server/merkez/journal.js';
import { salesDocument, salesTotals, salesXlsx, type SaleEntry } from '../server/merkez/sales.js';
import { licenseFeatures, MerkezStore } from '../server/merkez/store.js';
import { MERKEZ_PASSWORD, merkezPair, temp } from './merkez-fixture.js';

const rid = () => randomUUID().replace(/-/g, '');
const TL = 100;
/** The exact claim keys a café from before packaging accepts (its schema is strict). */
const OLD_KEYS = ['createdAt', 'expiresAt', 'freezes', 'installId', 'issuedAt', 'name', 'plan', 'serial', 'service', 'status', 'tenantId', 'trialStartedAt', 'v'];
const payloadKeys = (s: { payload: string }) => Object.keys(JSON.parse(Buffer.from(s.payload, 'base64url').toString('utf8')));

test('prices: package totals follow the services, their requirements and discounts; yearly is ×10 unless typed', () => {
  // QR sipariş needs QR menü; core is always in.
  assert.deepEqual(normalFeatures(['qr-order']), ['core', 'qr-menu', 'qr-order']);
  assert.deepEqual(addedFor(['qr-order']), [['qr-menu', 'qr-order']]);
  assert.deepEqual(withoutFeature(['core', 'qr-menu', 'qr-order', 'stock'], 'qr-menu'), ['core', 'stock'], 'unticking QR menü unticks QR sipariş');
  assert.deepEqual(withoutFeature(['core', 'stock'], 'core'), ['core', 'stock'], 'core stays');
  assert.equal(normalFeatures(['integrations']).includes('integrations'), false, '"Yakında" is not sellable');
  // Çay bahçesi: 750 + 200 + 75 = 1.025 TL/ay, 10.250 TL/yıl (docs/FIYAT_ARASTIRMASI.md).
  const cay = priceFor(['core', 'qr-menu', 'email-reports']);
  assert.deepEqual(cay, { monthly: 1025 * TL, yearly: 10250 * TL, listMonthly: 1025 * TL, listYearly: 10250 * TL });
  // A changed price, a typed yearly price, a package discount (%) and a business discount (₺/ay, ×10 for the year).
  const prices = { core: { monthly: 800 * TL }, 'qr-menu': { monthly: 200 * TL, yearly: 1800 * TL } };
  const p = priceFor(['core', 'qr-menu'], prices, { kind: 'percent', value: 10 }, { kind: 'amount', value: 50 * TL });
  assert.equal(p.listMonthly, 1000 * TL); assert.equal(p.listYearly, 9800 * TL);
  assert.equal(p.monthly, 900 * TL - 50 * TL); assert.equal(p.yearly, Math.round(9800 * TL * 0.9) - 500 * TL);
  assert.equal(priceFor(['core'], {}, { kind: 'amount', value: 99999 * TL }).monthly, 0, 'never below zero');
  assert.equal(periodPrice(cay, 6), 6 * 1025 * TL); assert.equal(periodPrice(cay, 12), 10250 * TL);
  assert.equal(monthlyRevenue(cay, 12), Math.round(10250 * TL / 12)); assert.equal(monthlyRevenue(cay, 1), 1025 * TL);
  // The old plans: everything sellable; menu only = everything but QR ordering.
  assert.deepEqual(legacyFeatures('full'), features.filter(f => !f.soon).map(f => f.id));
  assert.deepEqual(legacyFeatures('menu'), sellableFeatures().filter(f => f !== 'qr-order'));
  // 6 Ekim: the Müdür account is in the core (no separate service). 14 Ekim (sahibin kararı): Bulutta şifreli yedek is in Restoran Pro too.
  assert.equal(features.some(f => (f.id as string) === 'manager-role'), false);
  const pro = defaultPackages.find(p => p.id === 'restoran-pro')!;
  assert.equal(pro.features.includes('cloud-backup'), true);
  // 6 Ekim: Sosyal medya ve QR kartları (₺75) is a paid service, in Restoran Pro.
  assert.equal(monthlyTotal(pro.features), 2450 * TL);
  assert.ok(legacyFeatures('full').includes('cloud-backup'), 'Tam sistem (eski plan) keeps every sellable service');
  // "Yakında" (Paket servis platformları) is in no licence, the trial's neither; only the browser tests' Merkez opens it on old plans.
  for (const b of [{ kind: 'trial' as const }, { kind: 'subscription' as const, service: 'full' as const }]) assert.equal(licenseFeatures(b).includes('integrations'), false);
  process.env.MOLA_TEST_OPEN_SOON = '1';
  try {
    assert.ok(licenseFeatures({ kind: 'subscription', service: 'full' }).includes('integrations'));
    assert.equal(licenseFeatures({ kind: 'subscription', services: { packageId: 'cay-bahcesi', features: ['core', 'qr-menu'], updatedAt: '' } }).includes('integrations'), false);
  } finally { delete process.env.MOLA_TEST_OPEN_SOON; }
});

test('old data with the retired "manager-role" (prices, packages, Özel, old plan) is read without error and simply ignored', async t => {
  const pair = await merkezPair('packages-retired', { demo: true }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin(); await pair.adminStepUp(); await pair.link.sync();
  assert.equal((await pair.admin('/business-services', { requestId: rid(), tenantId: 'mola-demo', packageId: null, features: ['qr-menu'], discount: null })).status, 200);
  // What a Merkez from before 6 Ekim may hold: written straight into the record, as the older version stored it.
  const retired = 'manager-role' as FeatureId;
  pair.merkezStore.mutate(d => {
    d.catalog!.prices[retired] = { monthly: 75 * TL };
    for (const p of d.catalog!.packages) if (p.id === 'restoran-pro' || p.legacy === 'full') p.features = [...p.features, retired];
    d.businesses.find(b => b.tenantId === 'mola-demo')!.services!.features.push(retired);
  });
  const d = pair.merkezStore.read();
  assert.ok(!JSON.stringify(d.catalog).includes('manager-role')); assert.ok(!JSON.stringify(d.businesses).includes('manager-role'));
  const cat = (await pair.admin('/catalog')).data;
  assert.ok(!cat.features.some((f: any) => f.id === 'manager-role'));
  const pro = cat.packages.find((p: any) => p.id === 'restoran-pro');
  assert.equal(pro.price.monthly, 2450 * TL);
  // The package comes back from the screen as it was shown and saves; the business's price leaves the old service out.
  assert.equal((await pair.admin('/packages', { requestId: rid(), id: pro.id, name: pro.name, features: pro.features, discount: { kind: 'percent', value: 5 }, expectedUpdatedAt: pro.updatedAt })).status, 200);
  const b = (await pair.admin('/state')).data.businesses.find((x: any) => x.tenantId === 'mola-demo');
  assert.deepEqual(b.services.features, ['core', 'qr-menu']); assert.equal(b.services.price.monthly, 950 * TL);
  assert.equal((await pair.admin('/sales')).status, 200);
  assert.equal((await pair.admin('/catalog/prices', { requestId: rid(), prices: [{ id: 'core', monthly: 750 * TL, yearly: null }] })).status, 200);
});

test('prices, packages and payments need the Authenticator step-up (same 10-minute window as Güncellemeler)', async t => {
  const pair = await merkezPair('packages-step-up', { demo: true }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin();
  const b = (await pair.admin('/state')).data.businesses.find((x: any) => x.tenantId === 'mola-demo');
  const changes: [string, object][] = [
    ['/catalog/prices', { requestId: rid(), prices: [{ id: 'qr-menu', monthly: 250 * TL, yearly: null }] }],
    ['/catalog/vat', { vatRate: 18 }],
    ['/packages', { requestId: rid(), name: 'Onaylı paket', features: ['qr-menu'], discount: null }],
    ['/packages/archive', { requestId: rid(), id: 'cay-bahcesi', archived: true }],
    ['/business-services', { requestId: rid(), tenantId: 'mola-demo', packageId: 'kafe-standart', discount: null }],
    ['/sales', { requestId: rid(), tenantId: 'mola-demo', day: new Date().toISOString().slice(0, 10), months: 1, net: 1000 * TL, vatRate: 20, method: 'cash', status: 'paid' }],
    ['/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: false, months: 1, suspended: false, payment: { net: 1625 * TL, method: 'cash', status: 'paid' } }],
  ];
  // Two-step login off: refused like publishing an update, with the way to turn it on.
  for (const [path, body] of changes) { const r = await pair.admin(path, body); assert.equal(r.status, 403, path); assert.equal(r.data.code, 'MFA_REQUIRED', path); assert.match(r.data.message, /^Fiyat, paket ve ödeme değişiklikleri için önce iki adımlı doğrulamayı açın/); }
  // An extension without "Ödeme alındı" needs no code; reading needs none either.
  assert.equal((await pair.admin('/catalog')).status, 200); assert.equal((await pair.admin('/sales')).status, 200);
  // On, but no code yet: refused before anything is written.
  pair.merkezStore.mutate(d => { d.admin.mfa = { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', lastStep: -1, recoveryHashes: [] }; });
  for (const [path, body] of changes) assert.equal((await pair.admin(path, body)).data.code, 'STEP_UP_REQUIRED', path);
  assert.equal(pair.merkezStore.read().catalog!.vatRate, 20); assert.equal((await pair.admin('/sales')).data.entries.length, 0);
  // One right code (the Güncelleme yetkisi's own route): every one of them goes through within the window.
  await pair.adminStepUp();
  for (const [path, body] of changes) { const r = await pair.admin(path, body); assert.equal(r.status, 200, `${path} ${JSON.stringify(r.data)}`); }
  assert.equal((await pair.admin('/sales')).data.entries.length, 2);
  // "Yetkiyi kapat" ends it for these too.
  await pair.admin('/releases/yetki/kapat', {});
  assert.equal((await pair.admin('/catalog/vat', { vatRate: 20 })).data.code, 'STEP_UP_REQUIRED');
});

test('first start of this version: starting packages, every old business on its old plan, licences signed again with features', async t => {
  const dir = temp('packages-migration'), key = randomBytes(32);
  // An older Merkez's data: two connected businesses, Tam sistem and Sadece QR menü, no catalogue yet.
  const old = new MerkezStore(join(dir, 'merkez'), key, { initialPassword: MERKEZ_PASSWORD });
  const installId = randomUUID(), at = new Date().toISOString(), end = new Date(Date.now() + 90 * 86400000).toISOString();
  old.mutate(d => {
    d.installs.push({ id: installId, secret: 'x'.repeat(43), createdAt: at, lastSeenAt: at });
    for (const [tenantId, service] of [['tam', 'full'], ['menu', 'menu']] as const) {
      const b = { tenantId, name: tenantId, source: 'admin' as const, serial: 4, installId, kind: 'subscription' as const, planMonths: 12 as const, endsAt: end, suspended: false, service, createdAt: at };
      d.businesses.push(b);
    }
  });
  // What the older Merkez had signed (no features): serial 4 → re-signing puts every licence above it.
  old.close();
  const store = new MerkezStore(join(dir, 'merkez'), key); t.after(() => store.close());
  createMerkezApp(store);
  const d = store.read(), pub = publicKeyFrom(store.publicKey);
  assert.deepEqual(d.catalog!.packages.map(p => p.id), ['cay-bahcesi', 'kafe-standart', 'restoran-pro', LEGACY_FULL, LEGACY_MENU]);
  const full = d.businesses.find(b => b.tenantId === 'tam')!, menu = d.businesses.find(b => b.tenantId === 'menu')!;
  assert.equal(full.services!.packageId, LEGACY_FULL); assert.equal(menu.services!.packageId, LEGACY_MENU);
  assert.equal(full.serial, 5); assert.equal(menu.serial, 5);
  // One licence with features (güvenlik denetimi O6, 11 Ekim: no copy without them any more); Tam sistem keeps everything,
  // Sadece QR menü everything but QR ordering (and `service: menu`).
  const fullClaims = verifyLicense(full.signed, pub), menuClaims = verifyLicense(menu.signed, pub);
  assert.deepEqual(fullClaims.features, sellableFeatures()); assert.equal(fullClaims.service, 'full');
  assert.deepEqual(menuClaims.features, legacyFeatures('menu')); assert.equal(menuClaims.service, 'menu');
  assert.equal(full.signedFeatures, undefined); assert.equal(menu.signedFeatures, undefined);
  for (const s of [full.signed!, menu.signed!]) assert.deepEqual(payloadKeys(s).filter(k => !OLD_KEYS.includes(k)), ['features']);
  // Recorded once; running again changes nothing.
  assert.equal(d.audit.filter(a => a.action === 'catalog.created').length, 1);
  assert.match(d.audit.find(a => a.action === 'catalog.created')!.detail!, /Tam sistem 1, Sadece QR menü 1/);
  createMerkezApp(store);
  assert.equal(store.read().businesses.find(b => b.tenantId === 'tam')!.serial, 5);
});

test('O6: an install that only held the old licence copy keeps its services and moves to the one listed licence on the heartbeat', async t => {
  const pair = await merkezPair('packages-o6', { demo: true }); t.after(() => pair.close());
  await pair.adminLogin(); await pair.adminStepUp();
  const tenants = (pair.store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).map(r => r.tenant);
  const imported = await pair.admin('/import', { requestId: rid(), businesses: tenants.map(x => ({ tenantId: x, name: x, license: { endsAt: new Date(Date.now() + 300 * 86400000).toISOString(), suspended: false, kind: 'subscription', planMonths: 12 } })) });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  // What an older Merkez gave this install: licences without `features` (issued before the cut-off), never a listed one.
  const old = imported.data.licenses.map((s: any) => { const c = verifyLicense(s, publicKeyFrom(pair.merkezStore.publicKey)); const { features: _f, ...rest } = c; return signLicense({ ...rest, issuedAt: new Date(LEGACY_LICENCE_UNTIL - 2 * 86400000).toISOString() }, pair.merkezStore.signingKey); });
  pair.link.adopt({ ...imported.data, licenses: old });
  assert.equal(pair.link.read()!.withFeatures, undefined);
  assert.deepEqual(pair.link.features('mola-demo'), features.map(f => f.id), 'an old install: every service, as before');
  // The vendor had put the business on a package; the updated Merkez signs every licence once more (catalogue step 3).
  const standart = defaultPackages.find(p => p.id === 'kafe-standart')!;
  pair.merkezStore.mutate(d => { const b = d.businesses.find(x => x.tenantId === 'mola-demo')!; b.services = { packageId: 'kafe-standart', features: [...standart.features], updatedAt: new Date().toISOString() }; d.catalog!.version = 2; });
  const serial = pair.merkezStore.read().businesses.find(x => x.tenantId === 'mola-demo')!.serial!;
  ensureCatalog(pair.merkezStore, new Date());
  const b = pair.merkezStore.read().businesses.find(x => x.tenantId === 'mola-demo')!;
  assert.equal(b.serial, serial + 1); assert.equal(b.signedFeatures, undefined);
  assert.deepEqual(verifyLicense(b.signed, publicKeyFrom(pair.merkezStore.publicKey)).features, licenseFeatures(b));
  // The heartbeat: only that licence comes, and the café keeps exactly its paid services.
  await pair.link.sync();
  assert.ok(pair.link.claims('mola-demo')!.serial > serial);
  assert.deepEqual(pair.link.features('mola-demo'), [...pair.link.features('mola-demo')].filter(id => licenseFeatures(pair.merkezStore.read().businesses.find(x => x.tenantId === 'mola-demo')!).includes(id) || id === 'core'));
  for (const id of standart.features) assert.ok(pair.link.features('mola-demo').includes(id), id);
  assert.ok(pair.link.read()!.withFeatures!['mola-demo']);
  // The stripped old copy can never come back as "everything": refused by the heartbeat rule, and core-only if written by hand.
  assert.equal(pair.link.receive(old.find((s: any) => verifyLicense(s, publicKeyFrom(pair.merkezStore.publicKey)).tenantId === 'mola-demo')), false);
  (pair.link as unknown as { write(fn: (r: any) => void): void }).write(r => { r.licenses['mola-demo'] = signLicense({ ...verifyLicense(b.signed, publicKeyFrom(pair.merkezStore.publicKey)), features: undefined, serial: serial + 5, issuedAt: new Date(LEGACY_LICENCE_UNTIL - 86400000).toISOString() } as never, pair.merkezStore.signingKey); });
  assert.deepEqual(pair.link.features('mola-demo'), ['core']);
});

test('trial = every service; after it the package; Özel with a discount; the café receives features over the heartbeat', async t => {
  const pair = await merkezPair('packages-trial', { demo: true }); t.after(() => pair.close());
  await pair.adminLogin(); await pair.adminStepUp();
  const imported = await pair.admin('/import', { requestId: rid(), businesses: [{ tenantId: 'mola-demo', name: 'Deneme Kafe', license: { endsAt: new Date(Date.now() + 20 * 86400000).toISOString(), suspended: false, kind: 'trial', trialStartedAt: new Date().toISOString() } }] });
  pair.link.adopt(imported.data);
  await pair.link.sync();
  // The first heartbeat signs again: the café now holds the copy with features (a trial: everything open).
  assert.deepEqual(pair.link.claims('mola-demo')!.features, sellableFeatures());
  const state = async () => (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo');
  let b = await state();
  assert.equal(b.services.packageName, 'Tam sistem (eski plan)'); assert.deepEqual(b.services.licenseFeatures, sellableFeatures());
  // The vendor picks Çay bahçesi during the trial: the licence still opens everything until the trial ends.
  const serial = b.serial;
  assert.equal((await pair.admin('/business-services', { requestId: rid(), tenantId: 'mola-demo', packageId: 'cay-bahcesi', discount: null })).status, 200);
  b = await state();
  assert.equal(b.services.packageName, 'Çay bahçesi'); assert.deepEqual(b.services.features, ['core', 'qr-menu', 'email-reports']);
  assert.deepEqual(b.services.licenseFeatures, sellableFeatures()); assert.equal(b.serial, serial, 'nothing changes for the café during the trial');
  // An old plan cannot be given to someone new; an archived package neither.
  assert.equal((await pair.admin('/business-services', { requestId: rid(), tenantId: 'mola-demo', packageId: LEGACY_MENU, discount: null })).data.code, 'PACKAGE_UNAVAILABLE');
  // Paid: the trial converts with "Ödeme alındı"; the licence now carries the package only.
  const pay = await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: false, months: 1, suspended: false, payment: { net: 1025 * TL, method: 'transfer', invoiceNo: 'MOL2026000001', status: 'paid' } });
  assert.equal(pay.status, 200); assert.ok(pay.data.saleId);
  await pair.link.sync();
  let claims = pair.link.claims('mola-demo')!;
  assert.deepEqual(claims.features, ['core', 'qr-menu', 'email-reports']); assert.equal(claims.service, 'menu', 'no QR ordering: older cafés close it too');
  // Özel: QR sipariş brings QR menü along; a business discount of 10%.
  b = await state();
  assert.equal((await pair.admin('/business-services', { requestId: rid(), tenantId: 'mola-demo', packageId: null, features: ['qr-order', 'stock'], discount: { kind: 'percent', value: 10 }, expectedUpdatedAt: b.services.updatedAt })).status, 200);
  b = await state();
  assert.equal(b.services.packageName, 'Özel'); assert.deepEqual(b.services.features, ['core', 'qr-menu', 'qr-order', 'stock']);
  assert.equal(b.services.price.monthly, Math.round((750 + 200 + 150 + 250) * TL * 0.9));
  await pair.link.sync();
  claims = pair.link.claims('mola-demo')!;
  assert.deepEqual(claims.features, ['core', 'qr-menu', 'qr-order', 'stock']); assert.equal(claims.service, 'full');
  assert.deepEqual(pair.link.license('mola-demo')!.features, claims.features);
  // A stale screen is refused.
  assert.equal((await pair.admin('/business-services', { requestId: rid(), tenantId: 'mola-demo', packageId: 'kafe-standart', discount: null, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })).data.code, 'VERSION_CONFLICT');
  // Suspended: the same list, status closes it.
  assert.equal((await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: false, months: 0, suspended: true })).status, 200);
  await pair.link.sync();
  assert.equal(pair.link.claims('mola-demo')!.status, 'suspended'); assert.deepEqual(pair.link.claims('mola-demo')!.features, ['core', 'qr-menu', 'qr-order', 'stock']);
  // İşlem kayıtları: services, payment (with old → new values).
  const rows = journalRows(pair.merkezStore.journal.entries());
  for (const action of ['services.changed', 'sale.created', 'trial.converted']) assert.ok(rows.some(r => r.action === action), action);
  assert.ok(rows.find(r => r.action === 'services.changed' && r.changes?.some(c => c.field === 'işletme indirimi')));
});

test('packages and prices: build, edit (businesses on it follow), archive, duplicate names refused; prices audited', async t => {
  const pair = await merkezPair('packages-edit', { demo: true }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin(); await pair.adminStepUp(); await pair.link.sync();
  const created = await pair.admin('/packages', { requestId: rid(), name: 'Kahve Köşesi', features: ['qr-order', 'reservations'], discount: { kind: 'amount', value: 100 * TL } });
  assert.equal(created.status, 200);
  const id = created.data.id;
  let cat = (await pair.admin('/catalog')).data, pkg = cat.packages.find((p: any) => p.id === id);
  assert.deepEqual(pkg.features, ['core', 'qr-menu', 'qr-order', 'reservations']);
  assert.equal(pkg.price.monthly, (750 + 200 + 150 + 150 - 100) * TL); assert.equal(pkg.price.yearly, (750 + 200 + 150 + 150) * 10 * TL - 1000 * TL);
  assert.equal((await pair.admin('/packages', { requestId: rid(), name: 'kahve köşesi', features: ['core'], discount: null })).data.code, 'NAME_TAKEN');
  assert.equal((await pair.admin('/packages', { requestId: rid(), name: 'Yakında', features: ['integrations'], discount: null })).data.code, 'FEATURE_SOON');
  // Put it on the demo business (subscription), then add stock to the package: the business follows, its licence is signed again.
  assert.equal((await pair.admin('/business-services', { requestId: rid(), tenantId: 'mola-demo', packageId: id, discount: null })).status, 200);
  const before = pair.merkezStore.read().businesses.find(b => b.tenantId === 'mola-demo')!.serial;
  assert.equal((await pair.admin('/packages', { requestId: rid(), id, name: 'Kahve Köşesi', features: [...pkg.features, 'stock'], discount: { kind: 'amount', value: 100 * TL }, expectedUpdatedAt: pkg.updatedAt })).data.businesses, 1);
  const biz = pair.merkezStore.read().businesses.find(b => b.tenantId === 'mola-demo')!;
  assert.ok(biz.serial > before); assert.ok(biz.services!.features.includes('stock'));
  await pair.link.sync(); assert.ok(pair.link.claims('mola-demo')!.features!.includes('stock'));
  // The old plans cannot be edited or archived.
  assert.equal((await pair.admin('/packages', { requestId: rid(), id: LEGACY_FULL, name: 'Tam', features: ['core'], discount: null })).data.code, 'LEGACY_LOCKED');
  assert.equal((await pair.admin('/packages/archive', { requestId: rid(), id: LEGACY_FULL, archived: true })).data.code, 'LEGACY_LOCKED');
  // Archived: kept by the business that has it, not offered to others.
  assert.equal((await pair.admin('/packages/archive', { requestId: rid(), id, archived: true })).status, 200);
  assert.equal((await pair.admin('/business-services', { requestId: rid(), tenantId: 'other-demo', packageId: id, discount: null })).data.code, 'PACKAGE_UNAVAILABLE');
  assert.equal((await pair.admin('/business-services', { requestId: rid(), tenantId: 'mola-demo', packageId: id, discount: { kind: 'percent', value: 5 } })).status, 200);
  // Prices: QR menü 250 TL; the yearly price of core typed; only real changes are written.
  assert.equal((await pair.admin('/catalog/prices', { requestId: rid(), prices: [{ id: 'qr-menu', monthly: 250 * TL, yearly: null }, { id: 'core', monthly: 750 * TL, yearly: 7000 * TL }, { id: 'stock', monthly: 250 * TL, yearly: null }] })).data.changed, 2);
  cat = (await pair.admin('/catalog')).data;
  const qr = cat.features.find((f: any) => f.id === 'qr-menu'), core = cat.features.find((f: any) => f.id === 'core'), soon = cat.features.find((f: any) => f.id === 'integrations');
  assert.equal(qr.monthly, 250 * TL); assert.equal(qr.yearly, 2500 * TL); assert.equal(core.yearly, 7000 * TL); assert.equal(core.yearlyTyped, true); assert.equal(soon.soon, true);
  assert.equal((await pair.admin('/catalog/vat', { vatRate: 18 })).data.vatRate, 18);
  const rows = journalRows(pair.merkezStore.journal.entries());
  for (const action of ['package.created', 'package.updated', 'package.archived', 'services.package_updated', 'catalog.prices_changed', 'catalog.vat_changed']) assert.ok(rows.some(r => r.action === action), action);
  const prices = rows.find(r => r.action === 'catalog.prices_changed')!;
  assert.deepEqual(prices.changes?.map(c => c.field), ['QR menü', 'Adisyon çekirdeği']);
  assert.match(prices.changes![0].from ?? '', /₺200\/ay/); assert.match(prices.changes![0].to ?? '', /₺250\/ay/);
});

test('Satışlarım: the ledger from an extension and by hand, edits keep history, MRR, KDV, Excel and the printable page', async t => {
  const pair = await merkezPair('packages-sales', { demo: true }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin(); await pair.adminStepUp();
  await pair.admin('/business-services', { requestId: rid(), tenantId: 'mola-demo', packageId: 'kafe-standart', discount: null });
  const b = (await pair.admin('/state')).data.businesses.find((x: any) => x.tenantId === 'mola-demo');
  // Kafe Standart = 750 + 200 + 150 + 250 + 200 + 75 = 1.625 TL/ay (docs/FIYAT_ARASTIRMASI.md).
  assert.equal(b.services.price.monthly, 1625 * TL); assert.equal(b.services.price.yearly, 16250 * TL);
  assert.equal((await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: false, months: 12, suspended: false, payment: { net: 16250 * TL, method: 'card', status: 'paid' } })).status, 200);
  assert.equal((await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: false, months: 0, suspended: false, payment: { net: 1, method: 'card' } })).status, 400, 'a payment needs an extension');
  const manual = await pair.admin('/sales', { requestId: rid(), tenantId: 'other-demo', day: new Date().toISOString().slice(0, 10), months: 1, net: 1000 * TL, vatRate: 20, method: 'cash', status: 'unpaid', invoiceNo: 'A-2' });
  assert.equal(manual.status, 200);
  let sales = (await pair.admin('/sales')).data;
  assert.equal(sales.entries.length, 2);
  // MRR: the yearly Kafe Standart counts as a twelfth of its yearly price; the other demo business (old plan) too.
  const other = (await pair.admin('/state')).data.businesses.find((x: any) => x.tenantId === 'other-demo');
  assert.equal(sales.kpis.mrr.total, Math.round(16250 * TL / 12) + Math.round(other.services.price.yearly / 12)); assert.equal(sales.kpis.mrr.count, 2);
  assert.equal(sales.kpis.pending.count, 1); assert.equal(sales.kpis.pending.gross, 1200 * TL);
  assert.equal(sales.kpis.collected, 16250 * TL * 1.2);
  // KDV: 20% of both.
  assert.equal(sales.totals.net, 17250 * TL); assert.equal(sales.totals.vat, 3450 * TL); assert.equal(sales.totals.gross, 20700 * TL);
  assert.deepEqual(sales.totals.rates.map((r: any) => r.rate), [20]);
  // Mark the manual one paid, then correct its amount: the history keeps the old values.
  const id = manual.data.id, entry = () => pair.admin('/sales').then(r => r.data.entries.find((e: any) => e.id === id));
  let e = await entry();
  assert.equal((await pair.admin('/sales', { requestId: rid(), id, tenantId: e.tenantId, day: e.day, months: 1, net: e.net, vatRate: 20, method: 'cash', status: 'paid', invoiceNo: 'A-2', expectedUpdatedAt: e.createdAt })).status, 200);
  e = await entry();
  assert.equal(e.status, 'paid'); assert.ok(e.paidDay);
  assert.equal((await pair.admin('/sales', { requestId: rid(), id, tenantId: e.tenantId, day: e.day, months: 1, net: 900 * TL, vatRate: 20, method: 'cash', status: 'paid', invoiceNo: 'A-2', expectedUpdatedAt: e.updatedAt })).status, 200);
  e = await entry();
  assert.equal(e.history.length, 2); assert.deepEqual(e.history[1].changes, [{ field: 'tutar (KDV hariç)', from: '₺1.000', to: '₺900' }]);
  assert.equal((await pair.admin('/sales', { requestId: rid(), id, tenantId: e.tenantId, day: e.day, months: 1, net: 900 * TL, vatRate: 20, method: 'cash', status: 'paid', expectedUpdatedAt: 'eski' })).data.code, 'VERSION_CONFLICT');
  // Filters: by business.
  sales = (await pair.admin(`/sales?tenant=other-demo`)).data;
  assert.equal(sales.entries.length, 1); assert.equal(sales.totals.net, 900 * TL);
  const rows = journalRows(pair.merkezStore.journal.entries());
  for (const action of ['sale.created', 'sale.paid', 'sale.updated']) assert.ok(rows.some(r => r.action === action), action);
  // Excel: a real .xlsx (zip) with the three sheets; the printable page has the totals.
  const all = (await pair.admin('/sales')).data.entries as SaleEntry[];
  const file = salesXlsx(all, { year: new Date().getFullYear().toString() }, undefined, new Date());
  assert.equal(file.subarray(0, 2).toString('latin1'), 'PK');
  const names = unzipNames(file); assert.ok(names.includes('xl/worksheets/sheet3.xml'));
  assert.match(unzipText(file, 'xl/workbook.xml'), /Satışlar.*Aylık toplam.*KDV dökümü/);
  assert.match(unzipText(file, 'xl/worksheets/sheet1.xml'), /Kart/);
  const html = salesDocument(all, {}, undefined, new Date());
  assert.match(html, /KDV dökümü/); assert.ok(html.includes('₺20.580'), 'gross total on the page');
  assert.equal(salesTotals(all.map(x => ({ ...x, status: 'cancelled' as const }))).gross, 0, 'cancelled entries do not count');
  // The download routes answer with the right type (PDF only where a browser can make one).
  const xl = await fetch(`${pair.merkezBase}/api/merkez/admin/sales/report.xlsx`, { headers: { Cookie: '' } });
  assert.equal(xl.status, 401, 'only the signed-in vendor');
});

/** Names and contents of a zip made by server/report-export-xlsx.ts (deflated entries). */
function entries(zip: Buffer) {
  const out = new Map<string, Buffer>();
  for (let i = 0; i + 30 < zip.length && zip.readUInt32LE(i) === 0x04034b50;) {
    const size = zip.readUInt32LE(i + 18), nameLen = zip.readUInt16LE(i + 26), extra = zip.readUInt16LE(i + 28), name = zip.subarray(i + 30, i + 30 + nameLen).toString('utf8'), start = i + 30 + nameLen + extra;
    out.set(name, inflateRawSync(zip.subarray(start, start + size))); i = start + size;
  }
  return out;
}
const unzipNames = (zip: Buffer) => [...entries(zip).keys()];
const unzipText = (zip: Buffer, name: string) => entries(zip).get(name)!.toString('utf8');
