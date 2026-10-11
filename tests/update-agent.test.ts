import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hashFile } from '../scripts/desktop/guncelleyici.mjs';
import { publicKeyFrom } from '../server/license.js';
import { UpdateAgent, type Pending } from '../server/update-agent.js';
import { signRelease, type ReleaseClaims } from '../server/update-manifest.js';
import { merkezPair, temp } from './merkez-fixture.js';
import { adminCall, testBundle, uploadBundle } from './update-fixture.js';

const agentFor = (dir: string, link: ConstructorParameters<typeof UpdateAgent>[0]['link'], key: () => ReturnType<typeof publicKeyFrom> | undefined, more: Partial<ConstructorParameters<typeof UpdateAgent>[0]> = {}) =>
  new UpdateAgent({ dir, link, publicKey: key, current: '0.1.0', platform: 'windows', node: process.version, dataVersion: 3, retryMs: [5], tickMs: 3_600_000, ...more });

test('the café downloads a published release in the background, resumes a cut download and unpacks only checked files', async t => {
  let cut = true; const ranges: string[] = [];
  // The first archive request breaks off after 64 KB (a dropped line); the next one must ask for the rest only.
  const flaky: typeof fetch = async (url, init) => {
    const r = await fetch(url, init);
    const range = new Headers(init?.headers).get('range'); if (String(url).endsWith('/paket')) ranges.push(range ?? '');
    if (!String(url).endsWith('/paket') || !cut) return r;
    cut = false;
    const reader = r.body!.getReader(); let sent = 0;
    return new Response(new ReadableStream({ async pull(c) { const { value, done } = await reader.read(); if (done || sent > 65536) { c.error(new Error('bağlantı koptu')); return; } sent += value.length; c.enqueue(value); } }), { status: r.status, headers: r.headers });
  };
  const pair = await merkezPair('update-agent', { demo: true, fetch: flaky }); t.after(() => pair.close());
  await pair.importDemo();
  const dir = temp('update-dir'), agent = agentFor(dir, pair.link, () => publicKeyFrom(pair.merkezStore.publicKey));
  pair.link.updates = agent; agent.start(); t.after(() => agent.stop());
  const bundle = await testBundle(temp('update-bundles'), '0.1.1', { big: 400_000, runtime: true, notes: 'Hızlı mutfak.' });
  const up = await uploadBundle(pair.merkezBase, bundle.file, pair.merkezStore);
  await adminCall(pair.merkezBase, up.cookie, '/releases/rollout', { id: up.data.release.id, mode: 'all' });
  assert.equal((await pair.link.sync()).ok, true); assert.equal((await pair.link.sync()).ok, true);
  const offer = { id: up.data.release.id, version: '0.1.1', size: bundle.size, notes: 'Hızlı mutfak.' };
  await agent.download(offer);
  assert.equal(agent.state, 'failed', 'the cut download failed');
  const part = join(dir, '0.1.1', 'paket.tar.gz.part');
  assert.ok(existsSync(part) && statSync(part).size > 0, 'what arrived is kept');
  const kept = statSync(part).size;
  await agent.download(offer);
  assert.equal(agent.state, 'ready', JSON.stringify(agent.view()));
  assert.equal(ranges.at(-1), `bytes=${kept}-`, 'resumed with Range');
  const pending = JSON.parse(readFileSync(join(dir, 'bekleyen.json'), 'utf8')) as Pending;
  assert.equal(pending.version, '0.1.1'); assert.equal(pending.from, '0.1.0'); assert.equal(pending.runtime, true);
  for (const f of pending.files) assert.equal(hashFile(join(dir, ...pending.folder.split('/'), ...f.path.split('/'))), f.sha256, f.path);
  assert.equal(existsSync(join(dir, '0.1.1', 'paket.tar.gz')), false, 'the archive goes once unpacked');
  // The heartbeat tells Merkez "indirildi, yeniden başlatma bekliyor".
  assert.equal((await pair.link.sync()).ok, true);
  const cafes = (await adminCall(pair.merkezBase, up.cookie, '/releases')).data.cafes;
  assert.equal(cafes[0].update.state, 'ready'); assert.equal(cafes[0].update.version, '0.1.1');
  // "Durdur" before it was installed: the café drops it.
  await adminCall(pair.merkezBase, up.cookie, '/releases/rollout', { id: offer.id, mode: 'off' });
  assert.equal((await pair.link.sync()).ok, true);
  assert.equal(agent.state, 'idle'); assert.equal(existsSync(join(dir, 'bekleyen.json')), false); assert.equal(existsSync(join(dir, '0.1.1')), false);
});

test('the café refuses releases that are tampered, signed by another key, older, for another computer or for other data', async () => {
  const merkez = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519');
  let answer: unknown, paket = Buffer.from('x');
  const link = { signedGet: async (path: string) => path.endsWith('/manifest') ? new Response(JSON.stringify({ release: answer }), { status: 200 }) : new Response(paket, { status: 200 }) };
  const dir = temp('update-refuse'), agent = agentFor(dir, link, () => merkez.publicKey);
  const claims = (o: Partial<ReleaseClaims> = {}): ReleaseClaims => ({ v: 1, id: 'windows-11111111', version: '0.1.1', platform: 'windows', node: process.version, runtime: false, minFrom: '0.0.0', data: { minReadable: 0, maxReadable: 3, writeVersion: 3 }, notes: '', builtAt: '', signedAt: '',
    archive: { sha256: 'a'.repeat(64), size: 1 }, files: [{ path: 'app/server.mjs', sha256: 'b'.repeat(64), size: 1 }, { path: 'app/manifest.json', sha256: 'c'.repeat(64), size: 1 }], top: [], ...o });
  const offer = (c: ReleaseClaims) => ({ id: c.id, version: c.version, size: c.archive.size, notes: '' });
  const refused = async (c: ReleaseClaims, key = merkez.privateKey) => { answer = signRelease(c, key); await agent.download(offer(c)); assert.equal(agent.state, 'failed'); return agent.view().error ?? ''; };
  assert.match(await refused(claims(), other.privateKey), /imza/i, 'another Merkez key');
  const good = signRelease(claims(), merkez.privateKey), body = JSON.parse(Buffer.from(good.payload, 'base64url').toString()); body.notes = 'değiştirildi';
  answer = { ...good, payload: Buffer.from(JSON.stringify(body)).toString('base64url') }; await agent.download(offer(claims()));
  assert.match(agent.view().error ?? '', /imza/i, 'edited after signing');
  assert.match(await refused(claims({ id: 'windows-22222222', version: '0.0.9' })), /geri dönüş/, 'downgrade');
  assert.match(await refused(claims({ id: 'windows-33333333', version: '0.1.0' })), /aynı sürüm/, 'same version');
  assert.match(await refused(claims({ id: 'windows-44444444', platform: 'linux-x64' })), /bilgisayar türü/);
  assert.match(await refused(claims({ id: 'windows-55555555', minFrom: '0.1.5', version: '0.2.0' })), /kurulum paketi/, 'needs a newer starting point');
  assert.match(await refused(claims({ id: 'windows-66666666', data: { minReadable: 4, maxReadable: 5, writeVersion: 5 } })), /veri biçimi/);
  assert.match(await refused(claims({ id: 'windows-77777777', node: 'v99.0.0' })), /Node\.js/, 'new Node.js without runtime/');
  // A correctly signed release whose archive does not match: refused, the broken download deleted, tried again later.
  paket = Buffer.from('bozuk arşiv'); const c = claims({ id: 'windows-88888888', archive: { sha256: 'a'.repeat(64), size: paket.length } });
  assert.match(await refused(c), /bozuk/);
  assert.equal(existsSync(join(dir, '0.1.1', 'paket.tar.gz.part')), false);
  assert.equal(existsSync(join(dir, 'bekleyen.json')), false, 'nothing ever ready');
});

test('idle install: only after 20 quiet minutes with nothing open, after a backup; "Şimdi kur" says why not', async () => {
  let now = Date.parse('2026-10-05T10:00:00Z'), open = { openAccounts: 0, pendingOrders: 0 }, restarted = 0, backupOk = true;
  const dir = temp('update-idle');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bekleyen.json'), JSON.stringify({ v: 1, version: '0.1.1', from: '0.1.0', platform: 'windows', release: 'windows-1', folder: '0.1.1/hazir', runtime: false, node: process.version, files: [], top: [], readyAt: '' }));
  writeFileSync(join(dir, 'durum.json'), JSON.stringify({ v: 1, state: 'ready', version: '0.1.1', release: 'windows-1', at: '', rejected: [] }));
  const make = (canApply = true) => agentFor(dir, { signedGet: async () => new Response('', { status: 404 }) }, () => undefined, { now: () => new Date(now), canApply, restart: () => { restarted++; }, activity: () => open, backup: async () => ({ ok: backupOk, error: backupOk ? undefined : 'disk dolu' }) });
  const agent = make(); agent.start(); agent.stop();
  assert.equal(agent.state, 'ready');
  now += 19 * 60_000; assert.equal(await agent.tick(), false, 'not 20 minutes yet');
  now += 2 * 60_000; open = { openAccounts: 2, pendingOrders: 1 };
  assert.equal(await agent.tick(), false, 'open tables');
  await assert.rejects(agent.installNow(), (e: Error) => /2 açık masa ve 1 bitmemiş sipariş/.test(e.message));
  open = { openAccounts: 0, pendingOrders: 0 }; agent.touch(); now += 5 * 60_000;
  assert.equal(await agent.tick(), false, 'an order a few minutes ago');
  agent.setIdleInstall(false); now += 30 * 60_000;
  assert.equal(await agent.tick(), false, 'the owner turned it off');
  agent.setIdleInstall(true); backupOk = false;
  assert.equal(await agent.tick(), false, 'no backup, no install');
  assert.equal(agent.state, 'ready'); assert.equal(restarted, 0);
  backupOk = true;
  assert.equal(await agent.tick(), true); assert.equal(restarted, 1); assert.equal(agent.state, 'installing');
  // Not under the watchdog (development, tests): installed at the next start instead.
  writeFileSync(join(dir, 'durum.json'), JSON.stringify({ v: 1, state: 'ready', version: '0.1.1', release: 'windows-1', at: '', rejected: [] }));
  const plain = make(false); plain.start(); plain.stop();
  await assert.rejects(plain.installNow(), (e: Error) => /bir sonraki açılışta/.test(e.message));
  assert.equal(plain.view().restartable, false);
});

test('the applier’s outcome comes back at start: installed, or rolled back and never downloaded again', () => {
  const dir = temp('update-outcome'); mkdirSync(dir, { recursive: true });
  const offers: string[] = [];
  const link = { signedGet: async (path: string) => { offers.push(path); return new Response('', { status: 404 }); } };
  writeFileSync(join(dir, 'durum.json'), JSON.stringify({ v: 1, state: 'installing', version: '0.1.1', at: '', rejected: [] }));
  writeFileSync(join(dir, 'sonuc.json'), JSON.stringify({ v: 1, version: '0.1.1', from: '0.1.0', result: 'rolled_back', reason: 'Yeni sürüm açılmadı.', at: '' }));
  const agent = agentFor(dir, link, () => undefined); agent.start(); agent.stop();
  assert.equal(agent.state, 'rolled_back'); assert.equal(agent.report()?.error, 'Yeni sürüm açılmadı.');
  assert.equal(existsSync(join(dir, 'sonuc.json')), false);
  agent.offer({ id: 'windows-1', version: '0.1.1', size: 1, notes: '' });
  assert.equal(offers.length, 0, 'a rolled back version is not fetched again');
  agent.dismiss(); assert.equal(agent.view().seen, true);
  writeFileSync(join(dir, 'sonuc.json'), JSON.stringify({ v: 1, version: '0.1.2', from: '0.1.1', result: 'installed', at: '' }));
  const after = agentFor(dir, link, () => undefined, { current: '0.1.2' }); after.start(); after.stop();
  assert.equal(after.state, 'installed'); assert.equal(after.view().seen, false);
});
