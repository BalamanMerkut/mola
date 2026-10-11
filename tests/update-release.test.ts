import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { compareVersions as applierCompare } from '../scripts/desktop/guncelleyici.mjs';
import { publicKeyFrom, signLicense, licenseClaims } from '../server/license.js';
import { MERKEZ_API } from '../server/sync-protocol.js';
import { compareVersions, currentPlatform, safeBundlePath, signRelease, verifyRelease, type ReleaseClaims } from '../server/update-manifest.js';
import { merkezPair, temp } from './merkez-fixture.js';
import { adminCall, testBundle, uploadBundle } from './update-fixture.js';

test('versions: semantic order, the same in the server and in the applier', () => {
  const ordered = ['0.0.9', '0.1.0-alpha', '0.1.0-alpha.2', '0.1.0-beta', '0.1.0', '0.1.1-test', '0.1.1', '0.2.0', '1.0.0'];
  for (let i = 0; i < ordered.length; i++) for (let j = 0; j < ordered.length; j++) {
    const want = Math.sign(i - j);
    assert.equal(compareVersions(ordered[i], ordered[j]), want, `${ordered[i]} ? ${ordered[j]}`);
    assert.equal(applierCompare(ordered[i], ordered[j]), want, `applier ${ordered[i]} ? ${ordered[j]}`);
  }
  assert.throws(() => compareVersions('1.0', '1.0.0'));
  assert.equal(currentPlatform('win32', 'x64'), 'windows'); assert.equal(currentPlatform('darwin', 'arm64'), 'macos-arm64'); assert.equal(currentPlatform('linux', 'arm64'), undefined);
  for (const bad of ['app/../veri/x', '../app/x', '/app/x', 'app\\x', 'veri/merchant.sqlite', 'app/x:y', 'app/.', 'app//x']) assert.equal(safeBundlePath(bad), false, bad);
  assert.equal(safeBundlePath('app/node_modules/@img/sharp-win32-x64/lib/libvips-42.dll'), true);
});

test('release manifest: only Merkez’s key, only this purpose, nothing edited', () => {
  const merkez = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519');
  const claims: ReleaseClaims = { v: 1, id: 'windows-0a1b2c3d', version: '0.1.1', platform: 'windows', node: process.version as `v${string}`, runtime: false, minFrom: '0.0.0', data: { minReadable: 0, maxReadable: 3, writeVersion: 3 }, notes: 'Deneme', builtAt: new Date().toISOString(), signedAt: new Date().toISOString(),
    archive: { sha256: 'a'.repeat(64), size: 100 }, files: [{ path: 'app/server.mjs', sha256: 'b'.repeat(64), size: 1 }, { path: 'app/manifest.json', sha256: 'c'.repeat(64), size: 1 }], top: [] };
  const signed = signRelease(claims, merkez.privateKey);
  assert.equal(verifyRelease(signed, merkez.publicKey).version, '0.1.1');
  assert.throws(() => verifyRelease(signed, other.publicKey), /imza/i, 'another Merkez key');
  assert.throws(() => verifyRelease(signRelease(claims, other.privateKey), merkez.publicKey), /imza/i, 'signed by someone else');
  const edited = JSON.parse(Buffer.from(signed.payload, 'base64url').toString()); edited.archive.sha256 = 'd'.repeat(64);
  assert.throws(() => verifyRelease({ ...signed, payload: Buffer.from(JSON.stringify(edited)).toString('base64url') }, merkez.publicKey), /imza/i, 'edited after signing');
  // A licence signature (another purpose) is never a release, even with the same key.
  const licence = signLicense(licenseClaims({ tenantId: 't', name: 'x', endsAt: null, suspended: false }, 'i', 1, new Date()), merkez.privateKey);
  assert.throws(() => verifyRelease({ ...licence, format: 'mola-guncelleme-1' }, merkez.publicKey), /imza|içeri/i);
  // A signed release may still not write outside the program's own files.
  const escape = signRelease({ ...claims, top: [{ file: 'app/server.mjs', target: '../../Windows/evil.exe' }] }, merkez.privateKey);
  assert.throws(() => verifyRelease(escape, merkez.publicKey), /liste|içeri/i);
});

test('Mola Merkez: an uploaded bundle is checked file by file and signed; tampered, foreign or repeated ones are refused', async t => {
  const pair = await merkezPair('update-upload', { demo: true }); t.after(() => pair.close());
  const out = temp('update-bundles');
  const bundle = await testBundle(out, '0.1.1', { notes: 'Mutfak ekranı hızlandı.' });
  const anonymous = await fetch(`${pair.merkezBase}/api/merkez/admin/releases/upload`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: readFileSync(bundle.file) });
  assert.equal(anonymous.status, 401, 'Mola Yönetim session required');
  const up = await uploadBundle(pair.merkezBase, bundle.file, pair.merkezStore);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const release = up.data.release;
  assert.equal(release.version, '0.1.1'); assert.equal(release.platform, 'windows'); assert.equal(release.rollout.mode, 'off', 'nothing is offered until published');
  assert.equal(release.notes, 'Mutfak ekranı hızlandı.');
  assert.equal((await uploadBundle(pair.merkezBase, bundle.file, pair.merkezStore)).status, 409, 'the same version twice');
  // One byte changed inside the archive: the file no longer matches its listed hash.
  const tar = gunzipSync(readFileSync((await testBundle(temp('update-bundles'), '0.1.2')).file));
  const at = tar.indexOf(Buffer.from('// Mola 0.1.2')); tar[at + 3] ^= 1;
  const tampered = join(out, 'bozuk.mola-guncelleme'); writeFileSync(tampered, gzipSync(tar));
  const refused = await uploadBundle(pair.merkezBase, tampered, pair.merkezStore);
  assert.equal(refused.status, 400); assert.match(refused.data.message, /bozuk|uyuşmuyor/);
  const junk = join(out, 'cop.mola-guncelleme'); writeFileSync(junk, gzipSync(Buffer.from('bu bir paket değil')));
  assert.equal((await uploadBundle(pair.merkezBase, junk, pair.merkezStore)).status, 400);
  // The signature verifies with Merkez's own public key (the one baked into café packages).
  const list = await adminCall(pair.merkezBase, up.cookie, '/releases');
  assert.equal(list.data.releases.length, 1);
  assert.equal(list.data.releases[0].signed, undefined, 'the signed blob is not sent to the screen');
});

test('rollout: nothing until published, pilot only to chosen businesses, Durdur takes it back; downloads only for those cafés', async t => {
  const pair = await merkezPair('update-rollout', { demo: true }); t.after(() => pair.close());
  await pair.importDemo();
  const offers: unknown[] = [];
  let report: { platform: 'windows'; state: 'idle'; at: string } = { platform: 'windows', state: 'idle', at: new Date().toISOString() };
  pair.link.updates = { report: () => report, offer: o => { offers.push(o); } };
  const beat = async () => { offers.length = 0; const r = await pair.link.sync(); assert.equal(r.ok, true, r.error); return offers.at(-1); };
  assert.equal(await beat(), undefined, 'the first heartbeat learns that Merkez takes the update field');
  assert.equal(await beat(), null, 'nothing published');
  const bundle = await testBundle(temp('update-bundles'), '0.1.1', { big: 50_000 });
  const up = await uploadBundle(pair.merkezBase, bundle.file, pair.merkezStore); const id = up.data.release.id;
  assert.equal(await beat(), null, 'uploaded is not published');
  const tenants = (pair.store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).map(r => r.tenant);
  const other = (await adminCall(pair.merkezBase, up.cookie, '/businesses', { requestId: 'p'.repeat(16), name: 'Başka Kafe', kind: 'trial' })).data.tenantId;
  assert.equal((await adminCall(pair.merkezBase, up.cookie, '/releases/rollout', { id, mode: 'pilot', pilot: [other] })).status, 400, 'a pilot needs an activated business');
  assert.equal((await adminCall(pair.merkezBase, up.cookie, '/releases/rollout', { id, mode: 'pilot', pilot: [tenants[0]] })).status, 200);
  assert.deepEqual(await beat(), { id, version: '0.1.1', size: bundle.size, notes: '' }, 'a pilot business of this install');
  // Signed downloads, only for an install it is offered to; Range resumes.
  assert.equal((await fetch(`${pair.merkezBase}${MERKEZ_API}/releases/${id}/manifest`)).status, 401, 'unsigned');
  const manifest = await pair.link.signedGet(`/releases/${id}/manifest`);
  assert.equal(manifest.status, 200);
  assert.equal(verifyRelease((await manifest.json()).release, publicKeyFrom(pair.merkezStore.publicKey)).archive.size, bundle.size);
  const whole = readFileSync(bundle.file);
  const part = await pair.link.signedGet(`/releases/${id}/paket`, { Range: 'bytes=1000-' });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 1000-${whole.length - 1}/${whole.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), whole.subarray(1000));
  assert.equal((await pair.link.signedGet(`/releases/${id}/paket`, { Range: `bytes=${whole.length}-` })).status, 416);
  await adminCall(pair.merkezBase, up.cookie, '/releases/rollout', { id, mode: 'all' });
  assert.equal((await beat() as { version: string }).version, '0.1.1');
  // Older cafés need the full installer (minFrom), another platform hears nothing, and a newer café nothing either.
  report = { ...report, platform: 'linux-x64' as 'windows' };
  assert.equal(await beat(), null, 'another platform');
  report = { ...report, platform: 'windows' };
  assert.equal((await adminCall(pair.merkezBase, up.cookie, '/releases/rollout', { id, mode: 'off' })).status, 200);
  assert.equal(await beat(), null, 'Durdur');
  assert.equal((await pair.link.signedGet(`/releases/${id}/manifest`)).status, 404, 'a stopped release cannot be downloaded');
  assert.equal((await adminCall(pair.merkezBase, up.cookie, '/releases/delete', { id })).status, 200);
  const newer = await uploadBundle(pair.merkezBase, (await testBundle(temp('update-bundles'), '0.2.0', { minFrom: '0.1.5' })).file, pair.merkezStore);
  await adminCall(pair.merkezBase, up.cookie, '/releases/rollout', { id: newer.data.release.id, mode: 'all' });
  assert.equal(await beat(), null, '0.1.0 may not jump to a release that needs 0.1.5');
});

test('café update state reaches Mola Yönetim; a rollback alerts the vendor once', async t => {
  const pair = await merkezPair('update-status', { demo: true }); t.after(() => pair.close());
  await pair.importDemo();
  let report: any = { platform: 'windows', state: 'idle', at: new Date().toISOString() };
  pair.link.updates = { report: () => report, offer: () => {} };
  await pair.link.sync(); await pair.link.sync();
  report = { platform: 'windows', state: 'rolled_back', version: '0.1.1', error: 'Yeni sürüm açılmadı (90 saniyede açılmadı).', at: new Date().toISOString(), idleInstall: true };
  await pair.link.sync(); await pair.link.sync();
  await pair.adminLogin();
  const state = (await pair.admin('/state')).data;
  const alerts = state.alerts.filter((a: { kind: string }) => a.kind === 'update.failed');
  assert.equal(alerts.length, 1, 'once per version and outcome'); assert.match(alerts[0].text, /önceki sürüme/);
  const releases = (await pair.admin('/releases')).data;
  assert.equal(releases.cafes[0].update.state, 'rolled_back'); assert.equal(releases.cafes[0].update.version, '0.1.1');
});
