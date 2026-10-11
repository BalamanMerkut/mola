import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { hashFile, readJson, runJob, takeLock, type Hooks, type Job } from '../scripts/desktop/guncelleyici.mjs';
import { temp } from './merkez-fixture.js';
import { appFiles, writeTree } from './update-fixture.js';

process.env.MOLA_GUNCELLEYICI_SESSIZ = '1';

/*
 * The applier (scripts/desktop/guncelleyici.mjs) on a fake installation: app/, runtime/, Mola-Sunucu.cmd, veri/ and a
 * downloaded update in guncelleme/0.1.1/hazir. Start, stop and the health check are fakes: "the server" is whatever
 * app/package.json says; a broken version never passes the health check (and may migrate the data first).
 */
function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  (function walk(d: string) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else out[relative(dir, p).split(sep).join('/')] = hashFile(p); } })(dir);
  return out;
}
function install(o: { runtime?: boolean; to?: string; top?: readonly { file: string; target: string }[] } = {}) {
  const root = temp('update-install'), to = o.to ?? '0.1.1', update = join(root, 'guncelleme'), folder = `${to}/hazir`;
  writeTree(root, { ...Object.fromEntries(Object.entries(appFiles('0.1.0')).map(([f, d]) => [`app/${f}`, d])), 'runtime/node.exe': 'node 24 eski', 'Mola-Sunucu.cmd': '@rem eski\r\n',
    'veri/merchant.sqlite': randomBytes(60_000), 'veri/anahtar.json': '{"v":1}', 'veri/media/t1/a.webp': randomBytes(5000) });
  const hazir: Record<string, string | Buffer> = { ...Object.fromEntries(Object.entries(appFiles(to)).map(([f, d]) => [`app/${f}`, d])), 'ust/Mola-Sunucu.cmd': `@rem ${to}\r\n` };
  if (o.runtime) hazir['runtime/node.exe'] = 'node 24 yeni';
  writeTree(join(update, ...folder.split('/')), hazir);
  const list = Object.entries(hazir).map(([path, data]) => ({ path, sha256: createHash('sha256').update(data).digest('hex'), size: Buffer.byteLength(data) }));
  writeFileSync(join(update, 'bekleyen.json'), JSON.stringify({ v: 1, version: to, from: '0.1.0', platform: 'windows', release: 'windows-1', folder, runtime: !!o.runtime, node: process.version, files: list, top: o.top ?? [{ file: 'ust/Mola-Sunucu.cmd', target: 'Mola-Sunucu.cmd' }], readyAt: '' }));
  const job: Job = { root, data: join(root, 'veri'), update, platform: 'win32', after: 'start', healthMs: 10 };
  return { root, job, data: files(join(root, 'veri')) };
}
const version = (root: string) => readJson(join(root, 'app', 'package.json'))?.version;
function fake(root: string, o: { broken?: string; migrate?: string; crashAt?: string } = {}) {
  const h: Hooks & { starts: string[]; stops: number; crashed: boolean } = {
    starts: [], stops: 0, crashed: false,
    async startServer() {
      const v = version(root); h.starts.push(v);
      // A new version that migrates the data as it opens it (and then fails its health check).
      if (o.migrate && o.migrate === v) { writeFileSync(join(root, 'veri', 'merchant.sqlite'), 'veri sürüm 4'); writeFileSync(join(root, 'veri', 'yeni.bin'), 'x'); }
    },
    async stopServer() { h.stops++; },
    async health(want) { const v = version(root); return v === want && v !== o.broken ? { ok: true } : { ok: false, reason: 'test: açılmadı' }; },
    crash(point) { if (point === o.crashAt && !h.crashed) { h.crashed = true; throw Object.assign(new Error('elektrik kesildi'), { crash: true }); } },
  };
  return h;
}
const outcome = (job: Job) => readJson(join(job.update, 'sonuc.json'));

test('applier: verified data backup, old program kept, new one in place and healthy', async () => {
  const { root, job, data } = install({ runtime: true });
  const hooks = fake(root);
  assert.equal(await runJob(job, 'uygula', hooks), 'installed');
  assert.equal(version(root), '0.1.1'); assert.equal(readFileSync(join(root, 'runtime', 'node.exe'), 'utf8'), 'node 24 yeni');
  assert.equal(readFileSync(join(root, 'Mola-Sunucu.cmd'), 'utf8'), '@rem 0.1.1\r\n');
  assert.equal(version(join(root, 'onceki')), '0.1.0', 'the previous program stays in onceki/ (rollback by hand)');
  assert.equal(readFileSync(join(root, 'onceki', 'runtime', 'node.exe'), 'utf8'), 'node 24 eski');
  assert.deepEqual(files(join(root, 'veri')), data, 'data untouched');
  const backups = readdirSync(join(root, 'guncelleme-yedek'));
  assert.equal(backups.length, 1); assert.match(backups[0], /^veri-0\.1\.0-/);
  assert.deepEqual(files(join(root, 'guncelleme-yedek', backups[0], 'veri')), data, 'the pre-update copy is the data, byte for byte');
  assert.deepEqual(outcome(job), { ...outcome(job), v: 1, version: '0.1.1', from: '0.1.0', result: 'installed' });
  for (const gone of ['bekleyen.json', 'gunluk.json', '0.1.1']) assert.equal(existsSync(join(job.update, gone)), false, gone);
  assert.deepEqual(hooks.starts, ['0.1.1']);
});

test('applier: a new version that does not come up (and migrated the data) is rolled back with the data it had before', async () => {
  const { root, job, data } = install({ runtime: true });
  const hooks = fake(root, { broken: '0.1.1', migrate: '0.1.1' });
  assert.equal(await runJob(job, 'uygula', hooks), 'rolled_back');
  assert.equal(version(root), '0.1.0'); assert.equal(readFileSync(join(root, 'runtime', 'node.exe'), 'utf8'), 'node 24 eski'); assert.equal(readFileSync(join(root, 'Mola-Sunucu.cmd'), 'utf8'), '@rem eski\r\n');
  assert.deepEqual(files(join(root, 'veri')), data, 'the data is exactly as before the update');
  const aside = readdirSync(root).filter(n => n.startsWith('veri-guncelleme-sonrasi-'));
  assert.equal(aside.length, 1, 'what the new version wrote is kept aside, never deleted');
  assert.equal(readFileSync(join(root, aside[0], 'merchant.sqlite'), 'utf8'), 'veri sürüm 4');
  const result = outcome(job); assert.equal(result.result, 'rolled_back'); assert.match(result.reason, /açılmadı.*Önceki sürüme dönüldü/);
  assert.deepEqual(hooks.starts, ['0.1.1', '0.1.0'], 'the old version is started again');
  assert.equal(existsSync(join(job.update, 'gunluk.json')), false);
});

test('applier: rolled back without touching data that the broken version never changed', async () => {
  const { root, job, data } = install();
  assert.equal(await runJob(job, 'uygula', fake(root, { broken: '0.1.1' })), 'rolled_back');
  assert.equal(version(root), '0.1.0'); assert.deepEqual(files(join(root, 'veri')), data);
  assert.equal(readdirSync(root).some(n => n.startsWith('veri-guncelleme-sonrasi-')), false);
});

test('applier: a power cut at any step is resumed from the journal; the result is always one whole version with its data', async () => {
  const points = ['yedek', 'move-0', 'move-1', 'move-2', 'move-3', 'move-5', 'tasindi', 'baslatildi'];
  for (const broken of [undefined, '0.1.1']) for (const at of [...points, ...(broken ? ['durduruldu', 'undo'] : [])]) {
    const { root, job, data } = install({ runtime: true });
    const first = fake(root, { broken, migrate: broken, crashAt: at });
    await assert.rejects(runJob(job, 'uygula', first), /elektrik/, `${at}: the cut happened`);
    assert.ok(existsSync(join(job.update, 'gunluk.json')), `${at}: the journal survives`);
    const after = fake(root, { broken, migrate: broken });
    const result = await runJob(job, 'devam', after);
    assert.equal(result, broken ? 'rolled_back' : 'installed', `${at} ${broken ?? ''}`);
    assert.equal(version(root), broken ? '0.1.0' : '0.1.1', `${at}: one whole version`);
    assert.equal(readFileSync(join(root, 'runtime', 'node.exe'), 'utf8'), broken ? 'node 24 eski' : 'node 24 yeni', `${at}: runtime matches`);
    assert.deepEqual(files(join(root, 'veri')), data, `${at}: data as before`);
    assert.equal(existsSync(join(job.update, 'gunluk.json')), false, `${at}: journal closed`);
    assert.equal(outcome(job).result, broken ? 'rolled_back' : 'installed');
  }
});

test('applier: refuses a downgrade, a damaged download or a file outside the program; the old program starts as it was', async () => {
  for (const [name, setup, why] of [
    ['downgrade', { to: '0.0.9' }, /Eski ya da aynı/],
    ['outside', { top: [{ file: 'ust/Mola-Sunucu.cmd', target: '../../Windows/x.cmd' }] }, /izin verilmeyen/],
  ] as const) {
    const { root, job, data } = install(setup);
    const hooks = fake(root);
    assert.equal(await runJob(job, 'uygula', hooks), 'failed', name);
    assert.match(outcome(job).reason, why);
    assert.equal(version(root), '0.1.0'); assert.deepEqual(files(join(root, 'veri')), data); assert.deepEqual(hooks.starts, ['0.1.0']);
    assert.equal(existsSync(join(root, 'onceki')), false, 'nothing moved');
  }
  const { root, job } = install();
  writeFileSync(join(job.update, '0.1.1', 'hazir', 'app', 'server.mjs'), 'değişmiş');
  assert.equal(await runJob(job, 'uygula', fake(root)), 'failed');
  assert.match(outcome(job).reason, /bozulmuş/); assert.equal(outcome(job).retry, true, 'downloaded again later');
  assert.equal(existsSync(join(job.update, '0.1.1')), false);
});

test('applier: a program replaced by hand meanwhile is left alone; "Kapat" installs and leaves Mola closed; one applier at a time', async () => {
  const { root, job } = install();
  await assert.rejects(runJob(job, 'uygula', fake(root, { crashAt: 'tasindi' })));
  writeTree(root, Object.fromEntries(Object.entries(appFiles('0.3.0')).map(([f, d]) => [`app/${f}`, d])));
  assert.equal(await runJob(job, 'devam', fake(root)), 'abandoned');
  assert.equal(version(root), '0.3.0'); assert.match(outcome(job).reason, /elle|kurulum paketiyle/);
  const closing = install(); closing.job.after = 'stop';
  const hooks = fake(closing.root);
  assert.equal(await runJob(closing.job, 'uygula', hooks), 'installed');
  assert.equal(hooks.stops, 1, 'started for the health check, then closed again as the owner wanted');
  const lockRoot = temp('update-lock');
  assert.equal(await takeLock(lockRoot), true); assert.equal(await takeLock(lockRoot), false);
});
