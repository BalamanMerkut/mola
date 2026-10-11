import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { CODE_TOP, writeIntegrityManifest } from '../scripts/integrity-manifest.mjs';
import { IntegrityCheck, releaseBuild } from '../server/integrity.js';
import { newSigningPair, privateKeyFrom, publicKeyFrom } from '../server/license.js';
import { signRelease, type UpdatePlatform } from '../server/update-manifest.js';
import { DEMO_PASSWORD } from '../server/app.js';
import { merkezPair, temp } from './merkez-fixture.js';

const pair = newSigningPair(), signing = privateKeyFrom(pair.privateKey), publicKey = publicKeyFrom(pair.publicKey);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const put = (path: string, text: string | Buffer) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const LAUNCHERS: Record<UpdatePlatform, Record<string, string>> = {
  windows: { 'Mola.exe': 'MZ launcher', 'Mola-Sunucu.cmd': '@echo off\r\nnode nobetci.mjs server.mjs\r\n', 'Mola-Durdur.cmd': '@echo off\r\n', 'Mola-Kaldir.exe': 'MZ remover' },
  'macos-arm64': { '../MacOS/Mola': '#!/bin/sh\nexec node\n' }, 'macos-x64': { '../MacOS/Mola': '#!/bin/sh\nexec node\n' },
  'linux-x64': { mola: '#!/bin/sh\nexec node\n', 'kaldir.sh': '#!/bin/sh\nrm\n' },
};
/**
 * A packaged café as `npm run installer` lays it out: <root>/app/… (code, the image library, an icon) and the launchers beside
 * app/ (a Mac: <root> is Mola.app/Contents/Resources). Returns its app folder and the signed release of the same build.
 */
function install(root: string, version: string, options: { platform?: UpdatePlatform; key?: KeyObject; tag?: string } = {}) {
  const platform = options.platform ?? 'windows', app = join(root, 'app'), tag = options.tag ?? version;
  put(join(app, 'server.mjs'), `// Mola server ${tag}\nif (!licence) close();\n`); put(join(app, 'nobetci.mjs'), '// watchdog'); put(join(app, 'guncelleyici.mjs'), '// applier');
  put(join(app, 'package.json'), JSON.stringify({ name: 'mola-app', version })); put(join(app, 'manifest.json'), '{}');
  put(join(app, 'dist', 'index.html'), `<script src="/assets/app.js"></script>${tag}`); put(join(app, 'dist', 'assets', 'app.js'), `console.log("${tag}")`); put(join(app, 'dist', 'assets', 'app.css'), 'body{}');
  put(join(app, 'dist', 'logo.png'), randomBytes(64)); put(join(app, 'node_modules', 'sharp', 'index.js'), '// image library');
  const top: Record<string, Buffer> = {};
  for (const [target, text] of Object.entries(LAUNCHERS[platform])) { top[target] = Buffer.from(text); put(join(root, ...target.split('/')), text); }
  const build = randomBytes(8).toString('hex');
  writeIntegrityManifest(app, { version, platform, build, top });
  // The update bundle of the same build lists every app/ file; Mola Merkez signs that list on upload.
  const files: { path: string; sha256: string; size: number }[] = [];
  (function walk(dir: string) { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else { const data = readFileSync(p); files.push({ path: `app/${relative(app, p).replaceAll('\\', '/')}`, sha256: sha(data), size: data.length }); } } })(app);
  const signed = signRelease({ v: 1, id: `${platform}-${randomBytes(4).toString('hex')}`, signedAt: new Date().toISOString(), archive: { sha256: sha(Buffer.from(build)), size: 1000 }, version, platform, node: 'v24.1.0', runtime: false, minFrom: '0.0.0',
    data: { minReadable: 0, maxReadable: 100, writeVersion: 1 }, notes: '', builtAt: new Date().toISOString(), files, top: [] }, options.key ?? signing);
  return { app, build, signed };
}
function checker(root: string, version: string, options: { platform?: UpdatePlatform; app?: string; key?: KeyObject; confirmMs?: number } = {}) {
  const lines: string[] = [];
  const check = new IntegrityCheck({ appDir: options.app ?? join(root, 'app'), stateDir: join(root, 'guncelleme', 'butunluk'), updateDir: join(root, 'guncelleme'), publicKey: () => options.key ?? publicKey,
    platform: options.platform ?? 'windows', version, confirmMs: options.confirmMs ?? 5, log: line => lines.push(line) });
  return { check, lines };
}

test('the package list holds only code files, with the launchers beside app/; dev mode never checks', () => {
  const root = temp('integrity-list'), { app } = install(root, '0.1.0');
  const list = JSON.parse(readFileSync(join(app, 'butunluk.json'), 'utf8'));
  assert.equal(list.format, 'mola-butunluk-1'); assert.match(list.build, /^[a-f0-9]{16}$/);
  assert.deepEqual(list.files.map((f: { path: string }) => f.path).sort(), ['Mola-Durdur.cmd', 'Mola-Kaldir.exe', 'Mola-Sunucu.cmd', 'Mola.exe', 'app/dist/assets/app.css', 'app/dist/assets/app.js', 'app/dist/index.html', 'app/guncelleyici.mjs', 'app/nobetci.mjs', 'app/package.json', 'app/server.mjs']);
  // Bytes exactly as shipped (CRLF stays CRLF).
  assert.equal(list.files.find((f: { path: string }) => f.path === 'Mola-Sunucu.cmd').sha256, sha(Buffer.from(LAUNCHERS.windows['Mola-Sunucu.cmd'])));
  assert.deepEqual(CODE_TOP.windows, Object.keys(LAUNCHERS.windows));
  assert.equal(releaseBuild(process.env.MOLA_RELEASE_BUILD), false, 'tests and npm run dev are not a release build');
  assert.equal(releaseBuild('1'), true);
});

test('fresh install: no signed list yet → asks Merkez; the same build verifies, another build of the version is not trusted', async () => {
  const root = temp('integrity-fresh'), { signed } = install(root, '0.1.0'), { check, lines } = checker(root, '0.1.0');
  assert.equal(check.report(), undefined, 'nothing before the first check');
  assert.equal((await check.run())?.state, 'unknown');
  assert.equal(check.report()?.need, true);
  // Another build of 0.1.0 (the vendor rebuilt it): never a false "changed", and not asked again for a day.
  const other = install(temp('integrity-other'), '0.1.0').signed;
  await check.manifest(other);
  assert.equal(check.last()?.state, 'unknown'); assert.equal(check.report()?.need, undefined);
  assert.equal(existsSync(join(root, 'guncelleme', 'butunluk')), false);
  // A forged release (another key) is ignored.
  await check.manifest(install(temp('integrity-forged'), '0.1.0', { key: privateKeyFrom(newSigningPair().privateKey) }).signed);
  assert.equal(check.last()?.state, 'unknown');
  await check.manifest(signed);
  assert.equal(check.last()?.state, 'ok');
  assert.deepEqual(check.report(), { state: 'ok', version: '0.1.0', platform: 'windows', at: check.last()!.at });
  assert.deepEqual(lines, []);
});

test('a changed or missing file is reported by name only (after a second look); a passing change and a file held by another program are not', async () => {
  const root = temp('integrity-tamper'), { signed } = install(root, '0.1.0'), { check, lines } = checker(root, '0.1.0', { confirmMs: 150 });
  await check.manifest(signed);
  const server = join(root, 'app', 'server.mjs'), original = readFileSync(server);
  writeFileSync(server, Buffer.from('// Mola server\n/* licence check removed */\n'));
  rmSync(join(root, 'Mola-Durdur.cmd'));
  let r = await check.run();
  assert.equal(r?.state, 'changed'); assert.deepEqual(r?.changed, ['app/server.mjs']); assert.deepEqual(r?.missing, ['Mola-Durdur.cmd']);
  const report = check.report()!;
  assert.deepEqual({ ...report, at: '' }, { state: 'changed', version: '0.1.0', platform: 'windows', at: '', changed: ['app/server.mjs'], missing: ['Mola-Durdur.cmd'] });
  assert.doesNotMatch(JSON.stringify(report), /licence check removed/, 'never the contents');
  assert.equal(lines.length, 1); assert.match(lines[0], /değişen: app\/server\.mjs; eksik: Mola-Durdur\.cmd/); assert.match(lines[0], /çalışmaya devam ediyor/);
  await check.run(); assert.equal(lines.length, 1, 'the same finding is logged once');
  // Put back: ok again, said once.
  writeFileSync(server, original); writeFileSync(join(root, 'Mola-Durdur.cmd'), LAUNCHERS.windows['Mola-Durdur.cmd']);
  assert.equal((await check.run())?.state, 'ok'); assert.equal(lines.length, 2); assert.match(lines[1], /yeniden imzalı listeyle aynı/);
  // A file changed for a moment (a copy, an antivirus scan) is back before the second look: no verdict, no log.
  const js = join(root, 'app', 'dist', 'assets', 'app.js'), jsText = readFileSync(js);
  writeFileSync(js, 'half-written'); setTimeout(() => writeFileSync(js, jsText), 30);
  assert.equal((await check.run())?.state, 'ok'); assert.equal(lines.length, 2);
  // An update being applied (the applier's journal): no verdict meanwhile, the last result stays.
  writeFileSync(js, 'new version half moved'); writeFileSync(join(root, 'guncelleme', 'gunluk.json'), '{}');
  assert.equal((await check.run())?.state, 'ok'); assert.equal(check.report()?.state, 'ok');
  rmSync(join(root, 'guncelleme', 'gunluk.json')); writeFileSync(js, jsText);
  // Mola.exe still the old one while Mola.exe.yeni waits for the launcher's next start.
  writeFileSync(join(root, 'Mola.exe'), 'MZ older launcher'); writeFileSync(join(root, 'Mola.exe.yeni'), LAUNCHERS.windows['Mola.exe']);
  assert.equal((await check.run())?.state, 'ok');
  check.stop();
});

test('an edited list or a broken signature is reported as such', async () => {
  const root = temp('integrity-list-edit'), { app, signed } = install(root, '0.1.0'), { check } = checker(root, '0.1.0');
  await check.manifest(signed);
  // A careful edit: server.mjs changed and its hash rewritten in butunluk.json, so the list "matches" the files.
  const server = join(app, 'server.mjs'); writeFileSync(server, '// no licence');
  const list = JSON.parse(readFileSync(join(app, 'butunluk.json'), 'utf8'));
  list.files.find((f: { path: string }) => f.path === 'app/server.mjs').sha256 = sha(readFileSync(server)); list.files.find((f: { path: string }) => f.path === 'app/server.mjs').size = readFileSync(server).length;
  writeFileSync(join(app, 'butunluk.json'), JSON.stringify(list));
  let r = await check.run();
  assert.equal(r?.state, 'changed'); assert.equal(r?.manifestChanged, true); assert.deepEqual(r?.changed, ['app/butunluk.json']);
  // The kept signed release itself edited: its signature fails.
  const kept = join(root, 'guncelleme', 'butunluk', readdirSync(join(root, 'guncelleme', 'butunluk'))[0]), data = JSON.parse(readFileSync(kept, 'utf8'));
  data.signed.signature = data.signed.signature.replace(/^./, (c: string) => c === 'A' ? 'B' : 'A'); writeFileSync(kept, JSON.stringify(data));
  r = await check.run();
  assert.equal(r?.state, 'changed'); assert.equal(r?.signatureFailed, true); assert.equal(check.report()?.signatureFailed, true);
  // The list deleted altogether.
  rmSync(join(app, 'butunluk.json'));
  r = await check.run(); assert.equal(r?.state, 'changed'); assert.deepEqual(r?.missing, ['app/butunluk.json']);
});

test('an automatic update brings its own signed list, and a rollback finds the old one again', async () => {
  const root = temp('integrity-update'), a = install(root, '0.1.0');
  await checker(root, '0.1.0').check.manifest(a.signed);
  // The update agent unpacked 0.1.1 into guncelleme/0.1.1/hazir/ and verified its signed release (UpdateAgent → remember).
  const ready = join(root, 'guncelleme', '0.1.1', 'hazir'), b = install(ready, '0.1.1');
  // (its launchers belong beside the real app/; the applier moves them there)
  for (const [target, text] of Object.entries(LAUNCHERS.windows)) writeFileSync(join(root, target), text);
  const before = checker(root, '0.1.0');
  before.check.remember(b.signed, b.app);
  before.check.remember(install(temp('integrity-other-build'), '0.1.1').signed, b.app);
  // The applier: app → onceki/app, the new app in place; the new version starts and checks itself without asking Merkez.
  mkdirSync(join(root, 'onceki'), { recursive: true }); renameSync(join(root, 'app'), join(root, 'onceki', 'app')); renameSync(b.app, join(root, 'app'));
  const after = checker(root, '0.1.1');
  assert.equal((await after.check.run())?.state, 'ok'); assert.equal(after.check.report()?.need, undefined);
  // Rolled back (the new version did not start healthy): the old program and its own signed list.
  renameSync(join(root, 'app'), join(root, 'guncelleme', 'bozuk-app')); renameSync(join(root, 'onceki', 'app'), join(root, 'app'));
  assert.equal((await checker(root, '0.1.0').check.run())?.state, 'ok');
});

test('macOS and Linux layouts: the launcher outside app/ is checked too', async () => {
  const mac = join(temp('integrity-mac'), 'Mola.app', 'Contents', 'Resources'), m = install(mac, '0.1.0', { platform: 'macos-arm64' });
  const macCheck = checker(mac, '0.1.0', { platform: 'macos-arm64' }).check;
  await macCheck.manifest(m.signed); assert.equal(macCheck.last()?.state, 'ok');
  writeFileSync(join(mac, '..', 'MacOS', 'Mola'), '#!/bin/sh\necho no licence\n');
  assert.deepEqual((await macCheck.run())?.changed, ['../MacOS/Mola']);
  const linux = temp('integrity-linux'), l = install(linux, '0.1.0', { platform: 'linux-x64' }), linuxCheck = checker(linux, '0.1.0', { platform: 'linux-x64' }).check;
  await linuxCheck.manifest(l.signed); assert.equal(linuxCheck.last()?.state, 'ok');
  rmSync(join(linux, 'kaldir.sh'));
  assert.deepEqual((await linuxCheck.run())?.missing, ['kaldir.sh']);
});

test('the heartbeat carries the result; Merkez answers `need` with the release, keeps the status, alerts once and journals; the café keeps working', async t => {
  const merkez = await merkezPair('integrity-heartbeat', { demo: true }); t.after(() => merkez.close());
  await merkez.importDemo(); await merkez.adminLogin();
  await merkez.link.sync();
  const root = temp('integrity-cafe'), mine = install(root, '0.1.0', { key: merkez.merkezStore.signingKey });
  const { check } = checker(root, '0.1.0', { key: publicKeyFrom(merkez.merkezStore.publicKey) });
  merkez.link.integrity = check;
  // An older Merkez (no 'integrity' in accepts) never gets the field.
  assert.equal(merkez.link.payload({ ...merkez.link.read()!, accepts: ['update'] }).integrity, undefined);
  await check.run();
  assert.equal(merkez.link.payload(merkez.link.read()!).integrity?.need, true);
  // The vendor uploaded this build's update bundle (not published): Merkez has its signed release.
  merkez.merkezStore.db.prepare('INSERT INTO releases VALUES (?,?)').run('windows-0a1b2c3d', JSON.stringify({ id: 'windows-0a1b2c3d', version: '0.1.0', platform: 'windows', notes: '', size: 1000, sha256: 'x', node: 'v24.1.0', runtime: false, minFrom: '0.0.0', data: { minReadable: 0, maxReadable: 100, writeVersion: 1 }, files: 1, builtAt: '', importedAt: '', signed: mine.signed, rollout: { mode: 'off', pilot: [] } }));
  await merkez.link.sync();
  for (let i = 0; i < 50 && check.last()?.state !== 'ok'; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(check.last()?.state, 'ok');
  await merkez.link.sync();
  let view = (await merkez.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo');
  assert.equal(view.integrity.state, 'ok');
  // Someone removes the licence check: changed, reported; Merkez alerts once and journals per business.
  writeFileSync(join(root, 'app', 'server.mjs'), '// licence check removed');
  await check.run(); await merkez.link.sync(); await merkez.link.sync();
  view = (await merkez.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo');
  assert.equal(view.integrity.state, 'changed'); assert.deepEqual(view.integrity.changed, ['app/server.mjs']); assert.ok(view.integrity.firstSeenAt);
  const d = merkez.merkezStore.read();
  assert.equal(d.alerts!.filter(a => a.kind === 'cafe.integrity').length, 1);
  assert.match(d.alerts!.find(a => a.kind === 'cafe.integrity')!.text, /app\/server\.mjs/);
  assert.deepEqual(d.audit.filter(a => a.action === 'integrity.changed').map(a => a.target).sort(), ['mola-demo', 'other-demo']);
  // Nothing is locked: the licence stays, orders go on.
  const owner = merkez.kafe();
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  const s = (await owner('/staff/state')).data;
  assert.equal((await owner('/staff/orders', { requestId: randomUUID().replace(/-/g, ''), tableId: s.tables[0].id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 })).status, 200);
  assert.equal(merkez.merkezStore.read().businesses.find(b => b.tenantId === 'mola-demo')!.suspended, false);
  // "unknown" never clears it; a clean check does, with a journal line.
  writeFileSync(join(root, 'guncelleme', 'gunluk.json'), '{}'); await check.run(); await merkez.link.sync(); rmSync(join(root, 'guncelleme', 'gunluk.json'));
  assert.equal((await merkez.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo').integrity.state, 'changed');
  writeFileSync(join(root, 'app', 'server.mjs'), `// Mola server 0.1.0\nif (!licence) close();\n`);
  await check.run(); await merkez.link.sync();
  assert.equal((await merkez.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo').integrity.state, 'ok');
  assert.equal(merkez.merkezStore.read().audit.filter(a => a.action === 'integrity.restored').length, 2);
  assert.equal(merkez.merkezStore.read().alerts!.filter(a => a.kind === 'cafe.integrity').length, 1);
});
