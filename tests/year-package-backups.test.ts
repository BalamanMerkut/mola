import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { createLiveBackup, registeredPackages, restoreBackup } from '../server/backup.js';
import { BackupScheduler } from '../server/backup-scheduler.js';
import { keptBackups, RETENTION } from '../server/backup-retention.js';
import { SecondBackup, findBackups } from '../server/second-backup.js';
import { CloudBackup, backupFiles, type CloudLink } from '../server/cloud-backup.js';
import { KeyVault } from '../server/key-vault.js';
import { MerkezLink } from '../server/kafe-link.js';
import { publicKeyFrom } from '../server/license.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { MerkezStore } from '../server/merkez/store.js';
import { BackupVault, businessView } from '../server/merkez/backup-vault.js';
import { DemoResets } from '../server/demo-reset.js';
import { blobName } from '../server/year-packages.js';
import { addDays, dayStart } from '../packages/domain/business-day.js';
import { reportRange } from '../packages/domain/reports.js';
import { FAST_KDF, fakeOsLock } from './fake-os-lock.js';
import { client, MERKEZ_PASSWORD, temp } from './merkez-fixture.js';
import { busyCafe, cafe, figures, HOUR, packerFor, RANGES, reopen, tenant } from './year-fixture.js';

/*
 * Yıl paketleri in backups (server/backup.ts manifest format 2, server/second-backup.ts, server/cloud-backup.ts,
 * server/merkez/backup-vault.ts): a package is encrypted once (the same bytes every time), stored once beside the backups,
 * copied once to the flash drive, sent once to Mola Merkez and kept there for good; a restore brings every package back and the
 * figures are the same; the café computer keeps 7 daily + 4 weekly + 12 monthly backups.
 */
const rid = () => randomUUID().replace(/-/g, '');
async function listen(server: Server) { await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }
const files = (dir: string) => readdirSync(dir).sort();

test('year package backups: referenced by SHA-256, stored once in yillar/, a restore into a fresh folder gives the same figures', async () => {
  const c = busyCafe('yil-yedek'), { store } = c, root = temp('yil-yedek-yerler');
  c.at(dayStart('2026-02-02') + 6 * HOUR);
  await packerFor(c).run();
  const before = figures(c, RANGES), backups = join(root, 'backups'), keys = join(root, 'keys');
  const first = await createLiveBackup(store.directory, backups, keys, undefined, () => new Date(c.now()));
  assert.equal(first.packages, 2);
  // The backup folder holds the open year only; the packages sit once in yillar/, described beside them.
  assert.ok(!files(first.directory).some(n => n.startsWith('yil-')), files(first.directory).join());
  const years = join(backups, 'yillar'), blobs = files(years).filter(n => n.endsWith('.bin'));
  assert.deepEqual(blobs, store.packages.list().map(p => blobName(p)).sort());
  const completion = JSON.parse(readFileSync(join(first.directory, 'complete.json'), 'utf8'));
  assert.equal(completion.format, 2); assert.deepEqual(completion.packages.map((p: { year: string }) => p.year), ['2024', '2025']);
  // The encrypted package is the same bytes the registry announced (found anywhere by it) and is never written again.
  for (const p of store.packages.list()) assert.equal(completion.packages.find((x: { year: string }) => x.year === p.year).sha256, p.encSha256);
  const stamp = statSync(join(years, blobs[0])).mtimeMs;
  c.at(c.now() + 24 * HOUR);
  const second = await createLiveBackup(store.directory, backups, keys, undefined, () => new Date(c.now()));
  assert.equal(statSync(join(years, blobs[0])).mtimeMs, stamp, 'stored once');
  // Restore into a fresh folder: every package back, checked; the same figures from the restored data.
  const restored = await restoreBackup(second.directory, second.keyPath!, join(root, 'geri'));
  assert.equal(restored.packages, 2);
  assert.ok(existsSync(join(restored.directory, 'yil-2024.sqlite')) && existsSync(join(restored.directory, 'yil-2025.sqlite')));
  const back = new Store(restored.directory, [tenant]);
  try { assert.deepEqual(figures(reopen(c, back), RANGES), before, 'the same figures from the restored folder'); } finally { back.close(); }
  // The nightly proof only checks the packages are there; a real restore without yillar/ says what is missing.
  const proof = await restoreBackup(second.directory, second.keyPath!, join(root, 'prova'), { packages: 'check' });
  assert.ok(!existsSync(join(proof.directory, 'yil-2025.sqlite')));
  renameSync(years, `${years}-gizli`);
  await assert.rejects(restoreBackup(second.directory, second.keyPath!, join(root, 'eksik')), /yıl paketi bulunamadı\. Yedek klasörünün yanındaki "yillar" klasörü de gerekir/);
  renameSync(`${years}-gizli`, years);
  // A damaged package copy never restores.
  const broken = join(years, blobs[1]), bytes = readFileSync(broken); bytes[100] ^= 0xff; writeFileSync(broken, bytes);
  await assert.rejects(restoreBackup(second.directory, second.keyPath!, join(root, 'bozuk')), /yıl paketi açılamadı/);
  store.close();
});

test('year package backups: 7 daily + 4 weekly + 12 monthly over two years of nightly backups; packages stay', async () => {
  // Two years of nightly backups pruned every night, as the scheduler does: the same kept set as the rule over the whole list.
  const all: { name: string; createdAt: string }[] = [];
  let kept: { name: string; createdAt: string }[] = [];
  for (let d = 0; d < 730; d++) {
    const day = addDays('2025-01-01', d), b = { name: `backup-${day}`, createdAt: new Date(dayStart(day) + 22.5 * HOUR).toISOString() };
    all.push(b); kept.push(b);
    const keep = keptBackups(kept, new Date(Date.parse(b.createdAt) + 60_000));
    kept = kept.filter(x => keep.has(x.name));
  }
  const now = new Date(Date.parse(all.at(-1)!.createdAt) + 60_000), rule = keptBackups(all, now);
  assert.deepEqual(kept.map(b => b.name).sort(), [...rule.keys()].sort());
  assert.deepEqual(RETENTION, { daily: 7, weekly: 4, monthly: 12 });
  const tiers = [...rule.values()];
  assert.equal(tiers.filter(t => t.includes('daily')).length, 7); assert.equal(tiers.filter(t => t.includes('weekly')).length, 4); assert.equal(tiers.filter(t => t.includes('monthly')).length, 12);
  // The exact months: the 12 finished before the last backup's month (December 2026 runs), each by its last day's backup.
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(2025, 11 + i + 1, 0)); return `backup-${d.toISOString().slice(0, 10)}`; });
  assert.deepEqual(kept.filter(b => rule.get(b.name)!.includes('monthly')).map(b => b.name).sort(), months.sort());
  assert.deepEqual(kept.filter(b => rule.get(b.name)!.includes('daily')).map(b => b.name).sort(), Array.from({ length: 7 }, (_, i) => `backup-${addDays('2026-12-25', i)}`));
  assert.ok(kept.length <= 23);
  // The scheduler prunes backup folders only: yillar/ stays whatever goes.
  const c = busyCafe('yil-yedek-saklama'), root = temp('yil-yedek-saklama-yer');
  c.at(dayStart('2026-02-02') + 6 * HOUR); await packerFor(c).run();
  const options = { backups: join(root, 'b'), keys: join(root, 'k'), checks: join(root, 'c'), retention: { daily: 1, weekly: 0, monthly: 0 } };
  const scheduler = new BackupScheduler(c.store.directory, options, () => new Date(c.now()));
  for (let d = 0; d < 3; d++) { c.at(c.now() + 24 * HOUR); c.apply(() => {}); const s = await scheduler.runNow(); assert.equal(s.lastError, undefined, s.lastError); }
  assert.equal(files(options.backups).filter(n => n.startsWith('backup-')).length, 1, 'only the newest backup');
  assert.equal(files(join(options.backups, 'yillar')).filter(n => n.endsWith('.bin')).length, 2, 'both packages stay');
  const status = scheduler.status();
  assert.equal(status.keep, 1);
  c.store.close();
});

test('year package backups: the flash drive gets each package once (yillar/), a restore from it brings them back', async () => {
  const c = busyCafe('yil-usb'), { store } = c, root = temp('yil-usb-yer');
  c.at(dayStart('2026-02-02') + 6 * HOUR); await packerFor(c).run();
  const before = figures(c, RANGES), usb = join(root, 'usb'); mkdirSync(usb);
  const copied: string[] = [];
  const second = new SecondBackup(join(root, 'ikinci.json'), '11111111-1111-4111-8111-111111111111', { data: store.directory, backups: join(root, 'b'), checks: join(root, 'c') }, 3, async (from, to) => { copied.push(to); copyFileSync(from, to); });
  await second.choose(usb, 'usb');
  const made: string[] = [];
  for (let d = 0; d < 4; d++) {
    c.at(c.now() + 24 * HOUR); c.apply(() => {});
    const b = await createLiveBackup(store.directory, join(root, 'b'), join(root, 'k'), undefined, () => new Date(c.now()));
    // A raw-key backup has no sealed key inside; the second place copies protected backups only, so seal a stand-in record.
    writeFileSync(join(b.directory, 'anahtar-kurtarma.json'), JSON.stringify({ installId: '22222222-2222-4222-8222-222222222222' }));
    made.push(b.directory);
    const st = await second.copy(b.directory); assert.equal(st.lastError, undefined, st.lastError);
  }
  const place = second.root!;
  assert.equal(readdirSync(place).filter(n => n.startsWith('backup-')).length, 3, 'newest 3 copies');
  assert.equal(readdirSync(join(place, 'yillar')).filter(n => n.endsWith('.bin')).length, 2);
  assert.equal(copied.filter(p => p.includes(`${'yillar'}`) && p.includes('.bin')).length, 2, 'each package copied once, not with every backup');
  // Restore the newest flash drive copy (its packages next to it in yillar/) into a fresh folder.
  const newest = join(place, readdirSync(place).filter(n => n.startsWith('backup-')).sort().at(-1)!);
  const keyFile = join(root, 'k', `${newest.split(/[\\/]/).at(-1)}.key`);
  const restored = await restoreBackup(newest, keyFile, join(root, 'geri'));
  assert.equal(restored.packages, 2);
  const back = new Store(restored.directory, [tenant]);
  try { assert.deepEqual(figures(reopen(c, back), RANGES).years, before.years); } finally { back.close(); }
  // The restore list counts the packages in a copy's size.
  const found = await findBackups([{ path: place, label: 'USB' }]);
  assert.ok(found.length >= 1 && found.every(f => f.bytes > store.packages.list().reduce((n, p) => n + p.size, 0)));
  store.close();
});

test('year package backups: Mola Merkez receives a package once, keeps it for good, counts it once in the room; a copy from Merkez restores', async () => {
  const dir = temp('yil-bulut'), clock = { t: dayStart('2026-02-02') + 6 * HOUR }, now = () => new Date(clock.t);
  const merkezStore = new MerkezStore(join(dir, 'merkez'), randomBytes(32), { initialPassword: MERKEZ_PASSWORD });
  const merkezApp = createMerkezApp(merkezStore, { now, cloudBackupMinFreeBytes: 0 }), server = createServer(merkezApp), base = await listen(server);
  const vault = merkezApp.locals.backupVault as BackupVault, vaultDir = join(dir, 'merkez-sunucu-yedekleri');
  const admin = client(`${base}/api/merkez/admin`); await admin('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  const stores: Store[] = [];
  try {
    // A protected café computer with bills in 2024 and 2025.
    const data = join(dir, 'veri'), keyVault = await KeyVault.open(data, { protect: true, osLock: fakeOsLock('pc'), kdf: FAST_KDF });
    const code = keyVault.reveal(); keyVault.confirm();
    const real = cafeOn(data, keyVault.key!, ['2024-12-28', '2024-12-29', '2025-06-10', '2025-12-30']); stores.push(real.store);
    clock.t = dayStart('2026-02-02') + 6 * HOUR; real.at(clock.t);
    await packerFor({ ...real, now: () => clock.t }).run();
    assert.deepEqual(real.store.packages.list().map(p => p.year), ['2024', '2025']);
    const link = new MerkezLink(real.store, { now, url: base, publicKey: publicKeyFrom(merkezStore.publicKey), machineKey: 'test:pc' });
    const r = await admin('/import', { requestId: rid(), businesses: [{ tenantId: tenant, name: 'Yıl Kafe', license: { endsAt: new Date(clock.t + 365 * 86400000).toISOString(), suspended: false, kind: 'subscription', planMonths: 12 } }] });
    assert.equal(r.status, 200, JSON.stringify(r.data)); link.adopt(r.data); assert.equal((await link.sync()).ok, true);
    const calls: { path: string; sha?: string }[] = [];
    const cloudLink: CloudLink = { ready: () => link.relayReady(), accepts: () => link.read()?.accepts, post: (path, body, timeout) => { calls.push({ path, sha: (body as { sha256?: string } | undefined)?.sha256 }); return link.relayPost(path, body, timeout); } };
    const folders = { backups: join(dir, 'b'), keys: join(dir, 'k'), checks: join(dir, 'c') };
    const cloud = new CloudBackup(join(folders.backups, 'sunucu-yedegi.json'), cloudLink, { now, retryDelays: [], chunkRetryMs: [], chunkBytes: 256 * 1024 });
    const scheduler = new BackupScheduler(data, { ...folders, protection: () => keyVault.backupProtection(), cloud }, now);
    const st = await scheduler.runNow(); assert.equal(st.lastError, undefined, st.lastError); await scheduler.uploading;
    assert.equal(cloud.status().lastError, undefined, cloud.status().lastError);
    const install = r.data.installId as string, packages = real.store.packages.list(), shas = packages.map(p => p.encSha256!);
    const first = vault.copies(install)[0];
    for (const p of packages) assert.ok(first.files.some(f => f.name === blobName(p) && f.sha256 === p.encSha256), `${p.year} in the copy`);
    assert.deepEqual(Object.keys(vault.years(install)).sort(), [...shas].sort(), 'kept for good');
    // The next days: only the open year travels; the packages are never sent again.
    for (let d = 0; d < 6; d++) {
      clock.t += 24 * HOUR; real.at(clock.t); real.apply(() => {});
      calls.length = 0;
      const s = await scheduler.runNow(); assert.equal(s.lastError, undefined); await scheduler.uploading;
      assert.ok(!calls.some(x => x.path === '/cloud-backup/chunk' && shas.includes(x.sha!)), 'no package piece sent again');
    }
    // 3 daily + 2 weekly copies stay; the packages stay whatever copies went; the room counts them once.
    const copies = vault.copies(install);
    assert.ok(copies.length <= 5, `${copies.length} copies`);
    for (const sha of shas) assert.ok(existsSync(join(vaultDir, install, 'parcalar', sha)), 'package blob kept');
    const live = Math.max(...copies.map(cp => cp.files.filter(f => !f.name.startsWith('yil-')).reduce((n, f) => n + f.size, 0)));
    const settings = vault.settings(tenant), years = packages.reduce((n, p) => n + p.encSize!, 0);
    assert.equal(vault.limit(install, settings), (settings.daily + settings.weekly + 1) * live + years);
    const view = businessView(vault, merkezStore.read(), tenant, now());
    assert.deepEqual([view.years.count, view.years.bytes], [2, years]);
    // A copy from Merkez (as "Mola Merkez'den geri yükle" downloads it: every file in one folder) restores with the code.
    const newest = copies[0], copyDir = join(dir, 'indirilen', newest.id); mkdirSync(copyDir, { recursive: true });
    for (const f of newest.files) copyFileSync(join(vaultDir, install, 'parcalar', f.sha256), join(copyDir, f.name));
    const restored = await restoreBackup(copyDir, { code }, join(dir, 'geri'));
    assert.equal(restored.packages, 2);
    assert.deepEqual(registeredPackages(join(restored.directory, 'merchant.sqlite')).map(p => p.sha256), packages.map(p => p.sha256));
    // The upload list names the packages from yillar/ (backupFiles), never from inside the backup folder.
    const list = await backupFiles(scheduler.status().lastDirectory!);
    assert.ok(packages.every(p => list.some(f => f.name === blobName(p) && f.path.includes('yillar'))));
    // A package lost on this computer with no copy here or on a flash drive comes back from Mola Merkez.
    const notes: string[] = [];
    real.store.packages.closeShard('2025'); rmSync(real.store.packages.path('2025'));
    const problems = await packerFor({ ...real, now: () => clock.t }, { notify: (_t, _k, title) => notes.push(title) }).checkPackages({ folders: () => [], cloud: (sha, size, target) => cloud.fetchFile(sha, size, target), force: true });
    assert.deepEqual(problems.map(p => p.year), ['2025']); assert.ok(notes.includes('2025 yıl paketi onarıldı'), notes.join(' | '));
    assert.equal(real.store.packages.check('2025')?.ok, true);
    link.stop();
  } finally {
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); (merkezApp.locals.relayHub as { close(): void }).close();
    for (const s of stores) { try { s.close(); } catch { /* closed */ } }
    merkezStore.close();
  }
});

/** The fixture café on a store opened with a given master key (a protected computer). */
function cafeOn(dir: string, key: Buffer, days: string[]) {
  const c = cafe(dir, days, key);
  c.at(dayStart(addDays(days.at(-1)!, 3))); c.apply(() => {});
  return c;
}

test('year package checks: the weekly check finds a damaged or missing package and puts it back from yillar/; the monthly one opens every row', async () => {
  const c = busyCafe('yil-denetim'), { store } = c, root = temp('yil-denetim-yer'), backups = join(root, 'b');
  c.at(dayStart('2026-02-02') + 6 * HOUR); await packerFor(c).run();
  await createLiveBackup(store.directory, backups, join(root, 'k'), undefined, () => new Date(c.now()));
  const before = figures(c, RANGES), notes: string[] = [];
  const packer = packerFor(c, { notify: (_t, _k, title) => notes.push(title) }), folders = () => [join(backups, 'yillar')];
  assert.deepEqual(await packer.checkPackages({ folders, force: true }), [], 'healthy');
  assert.equal(store.packages.check('2024')?.kind, 'open', 'the monthly check opened one package row by row');
  // Not again within the week.
  assert.deepEqual(await packer.checkPackages({ folders }), []);
  // A damaged file (a disk error): found by its SHA-256, put back from the encrypted copy.
  const file = store.packages.path('2025'); store.packages.closeShard('2025');
  const bytes = readFileSync(file); bytes[Math.floor(bytes.length / 2)] ^= 0x55; writeFileSync(file, bytes);
  const damaged = await packer.checkPackages({ folders, force: true });
  assert.deepEqual(damaged.map(p => p.year), ['2025']); assert.match(damaged[0].error, /SHA-256 tutmuyor/);
  assert.ok(notes.includes('2025 yıl paketi onarıldı'), notes.join(' | '));
  assert.equal(store.packages.check('2025')?.ok, true);
  assert.deepEqual(figures(c, RANGES), before, 'the same figures after the repair');
  // A missing file with no copy anywhere: the owner is told to call.
  store.packages.closeShard('2024'); rmSync(store.packages.path('2024'));
  const missing = await packer.checkPackages({ folders: () => [], force: true });
  assert.match(missing[0].error, /bulunamadı/); assert.ok(notes.includes('2024 yıl paketi bozuk ya da eksik'));
  // Reports of that year stop with a plain sentence instead of reading around it; the copy puts it back.
  assert.throws(() => figures(c, RANGES), /2024 yıl paketi açılamadı/);
  await packer.checkPackages({ folders, force: true });
  assert.deepEqual(figures(c, RANGES), before);
  store.close();
});

test('year package backups: a "Tanıtım" reset hides the business\'s packaged years; reports start from nothing', async () => {
  const c = busyCafe('yil-tanitim'), { store } = c;
  c.at(dayStart('2026-02-02') + 6 * HOUR); await packerFor(c).run();
  const link = { isDemo: () => true } as unknown as ConstructorParameters<typeof DemoResets>[1];
  const resets = new DemoResets(store, link, () => new Date(c.now()));
  await resets.reset(tenant, { sector: 'cafe', demoPassword: false, by: 'owner' });
  const s = store.read(tenant), all = reportRange('all', 'all'), span = store.history.reportSpan(tenant, s, all.start, all.end);
  assert.equal(span.total.payments, 0, 'no sales of the packaged years');
  assert.equal(store.history.dataBounds(tenant), null);
  assert.equal(c.cash.bounds(tenant), null);
  assert.equal(store.packages.closedEnd(), '2025-12-31', 'the closed years stay closed');
  // The packages themselves are untouched (another business of this computer still reads them).
  assert.equal(store.packages.list().length, 2);
  store.close();
});
