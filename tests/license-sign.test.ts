import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { claimsToLicense, licenseClaims, LicenseError, newSigningPair, privateKeyFrom, publicKeyFrom, signLicense, verifyLicense, merkezPublicKey, type License } from '../server/license.js';
import { MerkezLink } from '../server/kafe-link.js';
import { seal } from '../server/sealing.js';
import { Store } from '../server/store.js';
import { newInstallSecret } from '../server/install-auth.js';
import { temp } from './merkez-fixture.js';

const DAY = 86400000, now = new Date('2026-10-03T09:00:00Z');
const base = (over: Partial<License> = {}): License => ({ tenantId: 'mola-demo', name: 'Mola Kafe', endsAt: new Date(+now + 30 * DAY).toISOString(), suspended: false, kind: 'subscription', planMonths: 12, service: 'full', ...over });
function editPayload(signed: { payload: string }, change: (claims: Record<string, unknown>) => void) {
  const claims = JSON.parse(Buffer.from(signed.payload, 'base64url').toString('utf8')); change(claims);
  return { ...signed, payload: Buffer.from(JSON.stringify(claims)).toString('base64url') };
}

test('a licence verifies only with Merkez’s key and only unchanged; its claims carry the rules and no business data', () => {
  const merkez = newSigningPair(), stranger = newSigningPair(), installId = randomUUID();
  const signed = signLicense(licenseClaims(base(), installId, 3, now), privateKeyFrom(merkez.privateKey));
  const claims = verifyLicense(signed, publicKeyFrom(merkez.publicKey));
  assert.deepEqual(Object.keys(claims).sort(), ['createdAt', 'expiresAt', 'freezes', 'installId', 'issuedAt', 'name', 'plan', 'serial', 'service', 'status', 'tenantId', 'v'].filter(k => k !== 'createdAt').sort());
  assert.equal(claims.plan, 'annual'); assert.equal(claims.status, 'active'); assert.equal(claims.serial, 3);
  assert.deepEqual(claimsToLicense(claims), { tenantId: 'mola-demo', name: 'Mola Kafe', endsAt: base().endsAt, suspended: false, kind: 'subscription', service: 'full', planMonths: 12, freezes: [] });
  // Another key, an edited expiry, a swapped signature, a missing field or another format: all refused.
  assert.throws(() => verifyLicense(signed, publicKeyFrom(stranger.publicKey)), LicenseError);
  assert.throws(() => verifyLicense(editPayload(signed, c => { c.expiresAt = '2099-01-01T00:00:00.000Z'; }), publicKeyFrom(merkez.publicKey)), /imzası/);
  assert.throws(() => verifyLicense(editPayload(signed, c => { c.status = 'active'; c.service = 'menu'; }), publicKeyFrom(merkez.publicKey)), /imzası/);
  const other = signLicense(licenseClaims(base({ suspended: true }), installId, 4, now), privateKeyFrom(merkez.privateKey));
  assert.throws(() => verifyLicense({ ...signed, signature: other.signature }, publicKeyFrom(merkez.publicKey)), /imzası/);
  assert.throws(() => verifyLicense({ ...signed, format: 'mola-lisans-2' }, publicKeyFrom(merkez.publicKey)), /biçimi/);
  const extra = signLicense({ ...licenseClaims(base(), installId, 5, now), revenue: 100 } as never, privateKeyFrom(merkez.privateKey));
  assert.throws(() => verifyLicense(extra, publicKeyFrom(merkez.publicKey)), /içeriği/, 'a field outside the licence shape is refused even when signed');
  // The public key can come from the environment (the key itself or a file); a non-Ed25519 or junk value is no key at all.
  assert.ok(merkezPublicKey({ MOLA_MERKEZ_PUBLIC_KEY: merkez.publicKey }));
  assert.equal(merkezPublicKey({ MOLA_MERKEZ_PUBLIC_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }), undefined);
});

test('the café keeps only verified licences of its own install: forged, edited, foreign, older and expired ones do not count', () => {
  const merkez = newSigningPair(), forger = newSigningPair(), key = privateKeyFrom(merkez.privateKey), installId = randomUUID();
  const store = new Store(temp('license-cache'), ['mola-demo']);
  try {
    let time = +now;
    const link = new MerkezLink(store, { now: () => new Date(time), publicKey: publicKeyFrom(merkez.publicKey) });
    assert.equal(link.state(), 'activate'); assert.equal(link.active('mola-demo'), false, 'no licence: closed');
    assert.throws(() => link.assertMenu('mola-demo'), /dijital menüsü/); assert.throws(() => link.assertOrdering('mola-demo'), /yeni sipariş/);
    const v5 = signLicense(licenseClaims(base(), installId, 5, now), key);
    link.adopt({ installId, secret: newInstallSecret(), licenses: [v5], serverTime: now.toISOString() });
    assert.equal(link.active('mola-demo'), true); assert.equal(link.state(), 'ready');
    // A newer serial replaces it; an older or equal one never does, even with a longer term.
    const v4 = signLicense(licenseClaims(base({ endsAt: new Date(+now + 900 * DAY).toISOString() }), installId, 4, now), key);
    assert.equal(link.receive(v4), false); assert.equal(link.receive(v5), false);
    const v6 = signLicense(licenseClaims(base({ suspended: true }), installId, 6, now), key);
    assert.equal(link.receive(v6), true); assert.equal(link.active('mola-demo'), false, 'suspended');
    assert.equal(link.receive(signLicense(licenseClaims(base(), installId, 9, now), privateKeyFrom(forger.privateKey))), false, 'forged');
    assert.equal(link.receive(signLicense(licenseClaims(base(), randomUUID(), 9, now), key)), false, 'another install');
    const v7 = signLicense(licenseClaims(base(), installId, 7, now), key);
    assert.equal(link.receive(v7), true); assert.equal(link.active('mola-demo'), true);
    // Someone edits the stored licence on disk (raw key in development): it no longer verifies, so the café closes.
    const record = link.read()!;
    const edited = { ...record, licenses: { 'mola-demo': editPayload(v7, c => { c.expiresAt = '2099-01-01T00:00:00.000Z'; }) } };
    store.db.prepare('UPDATE merkez_link SET payload=? WHERE id=1').run(seal(edited, store.key, 'merkez-link'));
    const reread = new MerkezLink(store, { now: () => new Date(time), publicKey: publicKeyFrom(merkez.publicKey) });
    assert.equal(reread.active('mola-demo'), false, 'an edited licence is refused');
    // Connected the day before its end (the 14-day offline limit is tests/kafe-offline.test.ts).
    store.db.prepare('UPDATE merkez_link SET payload=? WHERE id=1').run(seal({ ...record, lastSuccessAt: new Date(Date.parse(base().endsAt!) - DAY).toISOString() }, store.key, 'merkez-link'));
    const restored = new MerkezLink(store, { now: () => new Date(time), publicKey: publicKeyFrom(merkez.publicKey) });
    assert.equal(restored.active('mola-demo'), true);
    // Offline: the cached licence holds until its end, to the millisecond, and not after.
    time = Date.parse(base().endsAt!) - 1; assert.equal(restored.active('mola-demo'), true);
    time += 1; assert.equal(restored.active('mola-demo'), false);
    // Turning the computer's clock back below Merkez's last known time does not reopen it.
    store.db.prepare('UPDATE merkez_link SET payload=? WHERE id=1').run(seal({ ...record, serverTime: new Date(Date.parse(base().endsAt!) + DAY).toISOString() }, store.key, 'merkez-link'));
    const clockBack = new MerkezLink(store, { now: () => new Date(+now), publicKey: publicKeyFrom(merkez.publicKey) });
    assert.equal(clockBack.active('mola-demo'), false);
    // Without Merkez's public key nothing verifies.
    const noKey = new MerkezLink(store, { now: () => new Date(+now), publicKey: undefined });
    const saved = process.env.MOLA_MERKEZ_PUBLIC_KEY; delete process.env.MOLA_MERKEZ_PUBLIC_KEY;
    try { assert.equal(noKey.active('mola-demo'), false); } finally { if (saved !== undefined) process.env.MOLA_MERKEZ_PUBLIC_KEY = saved; }
  } finally { store.close(); }
});
