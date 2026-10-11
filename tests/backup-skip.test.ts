import { licensed, temp } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { createBackup } from '../server/backup.js';
import { BackupScheduler, FORCE_AFTER_MS } from '../server/backup-scheduler.js';
import { isoWeek, keptBackups, mainTier } from '../server/backup-retention.js';
import { ChangeMarker, isRealChange, NOT_A_CHANGE, REAL_CHANGES } from '../server/change-marker.js';
import { SecondBackup } from '../server/second-backup.js';
import { IntegrationManager } from '../server/integrations/manager.js';
import { TestPlatform } from '../server/integrations/adapters.js';
import { Store } from '../server/store.js';
import { addDays, businessDay } from '../packages/domain/business-day.js';

const iso = (s: string) => new Date(s).toISOString();
const backupsIn = (dir: string) => readdirSync(dir).filter(n => n.startsWith('backup-')).sort();

test('dirty marker: every write route the app registers is decided (change or not); sign-in, reads and refused writes never count', async t => {
  // No route in both lists, none twice.
  const both = REAL_CHANGES.filter(p => NOT_A_CHANGE.includes(p));
  assert.deepEqual(both, []); assert.equal(new Set(REAL_CHANGES).size, REAL_CHANGES.length); assert.equal(new Set(NOT_A_CHANGE).size, NOT_A_CHANGE.length);
  const root = temp('marker-routes'), data = join(root, 'data'), store = new Store(data, ['mola-demo']);
  licensed(store);
  let clock = new Date('2026-10-05T12:00:00+03:00');
  const marker = new ChangeMarker(store.db, () => clock);
  const scheduler = new BackupScheduler(data, { backups: join(root, 'backups'), keys: join(root, 'keys'), checks: join(root, 'checks'), changes: marker }, () => clock);
  const app = createApp(store, undefined, undefined, undefined, undefined, () => {}, undefined, scheduler, { token: 'k'.repeat(43), shutdown: () => {} });
  const server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { (app.locals.integrations as IntegrationManager).stop(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  // Every non-GET route of the café app is in exactly one list: a new route must be decided here.
  const routes: string[] = [];
  for (const layer of (app as unknown as { router: { stack: { route?: { path: string | string[]; methods: Record<string, boolean> } }[] } }).router.stack) {
    if (!layer.route) continue;
    for (const path of ([] as string[]).concat(layer.route.path)) for (const method of Object.keys(layer.route.methods)) if (!['get', 'head', '_all'].includes(method)) routes.push(path);
  }
  assert.ok(routes.length > 150, String(routes.length));
  const undecided = [...new Set(routes)].filter(p => !REAL_CHANGES.includes(p) && !NOT_A_CHANGE.includes(p));
  assert.deepEqual(undecided, [], 'add these to REAL_CHANGES or NOT_A_CHANGE in server/change-marker.ts');
  assert.equal(isRealChange('GET', '/api/staff/orders'), false); assert.equal(isRealChange('POST', '/api/login'), false);
  assert.equal(isRealChange('POST', '/api/staff/payments?x=1'), true); assert.equal(isRealChange('POST', '/api/staff/yeni-bir-yol'), true, 'an unlisted write counts (safe side)');

  // Over HTTP: clean after a backup started; a login, a read and a refused write leave it clean; a real write marks it.
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, cookie = '') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  marker.arm(); assert.equal(marker.dirty, false);
  const login = await post('/api/login', { username: 'isletme', password: DEMO_PASSWORD });
  const owner = login.headers.getSetCookie()[0].split(';')[0];
  await fetch(`${base}/api/staff/state`, { headers: { Cookie: owner } });
  assert.equal((await post('/api/login', { username: 'isletme', password: 'yanlis' })).status, 401);
  assert.equal((await post('/api/staff/qr-printed', { origin: 'yanlış' }, owner)).status, 400);
  assert.equal((await post('/api/staff/heartbeat', {}, owner)).status, 200);
  assert.equal(marker.dirty, false, 'sign-in, reads, presence and refused writes are not changes');
  clock = new Date('2026-10-05T12:05:00+03:00');
  assert.equal((await post('/api/staff/qr-printed', { origin: 'http://192.168.1.20:3000' }, owner)).status, 200);
  assert.equal(marker.dirty, true); assert.equal(marker.changedAt, clock.toISOString());
  // Only the first change after a backup writes; the next ones cost nothing.
  const seq = marker.current().seq;
  await post('/api/staff/qr-printed', { origin: 'http://192.168.1.21:3000' }, owner);
  assert.equal(marker.current().seq, seq);
  // The owner sees the skipped night where the backup status is shown today; the rail also lists the kept set.
  clock = new Date(Date.now() - 2 * 3600_000); assert.equal((await scheduler.runNow('day-close')).lastError, undefined);
  clock = new Date(Date.now() - 3600_000); assert.match((await scheduler.runNow('auto')).skipped?.text ?? '', /^Gece yedeği gerekmedi: /);
  const rail = await (await fetch(`${base}/api/desktop/status`, { headers: { 'X-Mola-Desktop': 'k'.repeat(43) } })).json();
  assert.match(rail.backup.note, /^Gece yedeği gerekmedi: /); assert.deepEqual(rail.backup.set.map((b: { tier: string }) => b.tier), ['daily']);
  const mine = await (await fetch(`${base}/api/staff/backup-status`, { headers: { Cookie: owner } })).json();
  assert.equal(mine.note, rail.backup.note); assert.equal(mine.healthy, true);
  // A real backup afterwards: the line goes away.
  clock = new Date(); marker.changed(); await scheduler.runNow('manual');
  assert.equal((await (await fetch(`${base}/api/staff/backup-status`, { headers: { Cookie: owner } })).json()).note, undefined);
});

test('dirty marker: a platform order counts; status calls and background sweeps do not; the marker survives a restart', async t => {
  const root = temp('marker-platform'), store = new Store(join(root, 'data'), ['mola-demo']);
  const now = () => new Date('2026-10-05T12:00:00+03:00'), platform = new TestPlatform(), marker = new ChangeMarker(store.db, now);
  const manager = new IntegrationManager(store, now, { tickMs: 0, retryMs: [1], testPlatform: platform });
  manager.onChange = () => marker.changed();
  t.after(() => { manager.stop(); store.close(); });
  store.mutate('mola-demo', s => { s.integrationSettings = { test: { enabled: true } }; });
  marker.arm();
  await manager.tick('mola-demo');
  assert.equal(marker.dirty, false, 'a poll with nothing new is not a change');
  platform.createOrder('mola-demo', store.read('mola-demo').products, now());
  await manager.tick('mola-demo', { forcePoll: 'test' });
  assert.equal(store.read('mola-demo').externalOrders?.length, 1); assert.equal(marker.dirty, true);
  // The same database opened again (a restart): same identity and count.
  const again = new ChangeMarker(store.db, now);
  assert.deepEqual(again.current(), marker.current()); assert.equal(again.dirty, true);
  // A damaged row: a new identity that no backup holds (so the next run backs up).
  store.db.prepare("UPDATE backup_marker SET payload = 'bozuk' WHERE id = 1").run();
  const fresh = new ChangeMarker(store.db, now);
  assert.notEqual(fresh.current().instance, marker.current().instance); assert.equal(fresh.dirty, true);
  // Stopped without close (power cut, killed process): the next start counts it as a change.
  fresh.arm(); assert.equal(fresh.open(), false); assert.equal(fresh.dirty, false);
  const afterCut = new ChangeMarker(store.db, now);
  assert.equal(afterCut.open(), true); assert.equal(afterCut.dirty, true);
  afterCut.arm(); afterCut.close();
  const clean = new ChangeMarker(store.db, now); assert.equal(clean.open(), false); assert.equal(clean.dirty, false);
});

test('03:30 is skipped when a verified backup holds every change (with a plain line), one backup per business day, a week at most without one', async () => {
  const root = temp('backup-skip'), data = join(root, 'data'), store = new Store(data, ['mola-demo']);
  try {
    const options = { backups: join(root, 'backups'), keys: join(root, 'keys'), checks: join(root, 'checks') };
    // A backup the operator made by hand (the backup command): never pruned by these rules.
    const manual = await createBackup(data, options.backups, options.keys);
    let clock = new Date('2026-10-05T23:41:00+03:00');
    const marker = new ChangeMarker(store.db, () => clock), scheduler = new BackupScheduler(data, { ...options, changes: marker }, () => clock);
    const run = (reason: 'auto' | 'day-close' | 'manual', at: string, catchUp = false) => { clock = new Date(at); return scheduler.runNow(reason, catchUp); };

    // Gün sonu 23:41, nothing after it: the night run is not needed, the owner reads why.
    const closing = await run('day-close', '2026-10-05T23:41:00+03:00');
    assert.equal(closing.lastError, undefined, closing.lastError);
    const afterClosing = backupsIn(options.backups);
    const night = await run('auto', '2026-10-06T03:30:00+03:00');
    assert.equal(night.skipped?.text, 'Gece yedeği gerekmedi: 23:41 gün sonu yedeği güncel.');
    assert.deepEqual(backupsIn(options.backups), afterClosing, 'no new backup');
    assert.equal(night.lastSuccessAt, closing.lastSuccessAt); assert.equal(night.currentAt, iso('2026-10-06T03:30:00+03:00'));
    // The same rule for the morning catch-up, in its own words.
    assert.equal((await run('auto', '2026-10-06T03:40:00+03:00', true)).skipped?.text, 'Açılış yedeği gerekmedi: 23:41 gün sonu yedeği güncel.');

    // Gün sonu 23:41, a real change at 00:30 (the same business day), 03:30: backed up; only the newest of that day stays.
    clock = new Date('2026-10-06T00:30:00+03:00'); marker.changed();
    const second = await run('auto', '2026-10-06T03:45:00+03:00');
    assert.equal(second.lastError, undefined); assert.notEqual(second.lastDirectory, closing.lastDirectory);
    assert.equal(existsSync(closing.lastDirectory!), false, 'the 23:41 backup of the same business day is replaced');
    assert.ok(existsSync(manual.directory), 'a manual backup is never deleted');
    assert.equal(second.skipped, undefined);
    const proof = JSON.parse(readFileSync(join(second.lastDirectory!, 'verification.json'), 'utf8'));
    assert.equal(proof.reason, 'auto'); assert.deepEqual(proof.changes, marker.current()); assert.ok(proof.order >= 2);

    // A closed day (no change): the next night says since when nothing changed.
    assert.equal((await run('auto', '2026-10-07T03:30:00+03:00')).skipped?.text, 'Gece yedeği gerekmedi: 6 Ekim 03:45 yedeğinden beri değişiklik yok.');
    // A crash after a backup started (power cut mid-backup): no verified backup holds that start, so the next run backs up.
    clock = new Date('2026-10-07T10:00:00+03:00'); marker.changed(); marker.arm();
    const afterCrash = await run('auto', '2026-10-07T10:05:00+03:00');
    assert.equal(afterCrash.skipped, undefined, 'not skipped'); assert.equal(afterCrash.lastSuccessAt, iso('2026-10-07T10:05:00+03:00'));

    // Safety net: nothing changes for a week; at most 6½ days pass without a backup.
    const last = Date.parse(afterCrash.lastSuccessAt!);
    const quiet = await run('auto', new Date(last + FORCE_AFTER_MS - 3600_000).toISOString());
    assert.match(quiet.skipped?.text ?? '', /değişiklik yok/); assert.equal(quiet.lastSuccessAt, afterCrash.lastSuccessAt);
    const forced = await run('auto', new Date(last + 7 * 86400000).toISOString());
    assert.ok(Date.parse(forced.lastSuccessAt!) > last, 'the weekly backup ran without any change');
    // A copy dated in the future (the clock was set back since) never counts as holding the data.
    clock = new Date(last - 3 * 86400000);
    const back = await scheduler.runNow('auto');
    assert.notEqual(back.lastDirectory, forced.lastDirectory, 'backed up instead of trusting a backup "from the future"');

    // What the backup screen lists: each kept backup and why it stays.
    assert.ok(back.set!.length >= 2 && back.set!.every(b => ['daily', 'weekly', 'monthly'].includes(b.tier)));
    const status = JSON.parse(readFileSync(join(options.backups, 'auto-backup-status.json'), 'utf8'));
    assert.equal(status.keep, 23); assert.ok(status.currentAt);
  } finally { store.close(); }
});

/** 120 business days (8 June – 5 October 2026), the computer off on 1–2 October. Each day: gün sonu 23:41, sometimes one after
 *  midnight, and the 03:30 backup (the newest of that business day). */
function timeline() {
  const list: { name: string; createdAt: string }[] = [];
  for (let i = 0; i < 120; i++) {
    const day = addDays('2026-06-08', i);
    if (day === '2026-10-01' || day === '2026-10-02') continue;
    list.push({ name: `gun-sonu-${day}`, createdAt: iso(`${day}T23:41:00+03:00`) });
    if (i % 5 === 0) list.push({ name: `gece-yarisi-${day}`, createdAt: iso(`${addDays(day, 1)}T00:30:00+03:00`) });
    list.push({ name: `gece-${day}`, createdAt: iso(`${addDays(day, 1)}T03:30:00+03:00`) });
  }
  return list;
}
// 7 günlük (the last 7 business days with a backup: 1–2 October missing), 4 haftalık (weeks 37–40), 12 aylık (every finished month the
// timeline has: June–September).
const EXPECTED = ['2026-10-05', '2026-10-04', '2026-10-03', '2026-09-30', '2026-09-29', '2026-09-28', '2026-09-27', '2026-09-20', '2026-09-13', '2026-08-31', '2026-07-31', '2026-06-30'];

test('retention over 120 days: exactly the newest of 7 days, 4 finished weeks and 12 finished months', () => {
  const now = new Date('2026-10-06T03:35:00+03:00'), kept = keptBackups(timeline(), now);
  assert.deepEqual([...kept.keys()].sort().reverse(), EXPECTED.map(d => `gece-${d}`));
  assert.deepEqual(kept.get('gece-2026-10-04'), ['daily', 'weekly']); assert.equal(mainTier(kept.get('gece-2026-09-30')!), 'monthly');
  assert.deepEqual(kept.get('gece-2026-09-13'), ['weekly']); assert.deepEqual(kept.get('gece-2026-07-31'), ['monthly']);
  assert.equal(isoWeek('2026-10-05'), '2026-W41'); assert.equal(isoWeek('2026-01-01'), '2026-W01'); assert.equal(isoWeek('2027-01-01'), '2026-W53');
  // 05:00 boundary: 04:59 is still the evening before, 05:00 the new day.
  assert.equal(businessDay(iso('2026-10-06T04:59:00+03:00')), '2026-10-05'); assert.equal(businessDay(iso('2026-10-06T05:00:00+03:00')), '2026-10-06');
  // The backup just made always stays, even if a wrong clock dated another one later the same day.
  const odd = [...timeline(), { name: 'saat-ileri', createdAt: iso('2026-10-06T04:50:00+03:00') }];
  assert.ok(keptBackups(odd, now, ['gece-2026-10-05']).has('gece-2026-10-05'));
  // A computer that was off for months keeps what it had (the last days that have a backup), not nothing.
  const old = keptBackups(timeline().filter(b => b.createdAt < iso('2026-07-01T05:00:00+03:00')), now);
  assert.equal([...old.values()].filter(t => t.includes('daily')).length, 7);
});

test('old backup folders: the new rules prune them by the same calendar; manual and unfinished ones stay; a crashed run is cleaned up', async () => {
  const root = temp('backup-upgrade'), data = join(root, 'data'), store = new Store(data, ['mola-demo']);
  try {
    const options = { backups: join(root, 'backups'), keys: join(root, 'keys'), checks: join(root, 'checks') };
    mkdirSync(options.backups, { recursive: true }); mkdirSync(options.checks, { recursive: true });
    // Folders as an older version left them: complete + verification.json with only `automatic` (no reason, marker or order).
    const folder = (name: string, createdAt: string, verified = true) => {
      const dir = join(options.backups, `backup-${createdAt.replace(/[:.]/g, '-')}-${name.replace(/[^a-z0-9]/g, '').slice(-8)}`);
      mkdirSync(dir); writeFileSync(join(dir, 'complete.json'), JSON.stringify({ format: 1, createdAt, files: 2 }));
      if (verified) writeFileSync(join(dir, 'verification.json'), JSON.stringify({ verified: true, checkedAt: createdAt, automatic: true }));
      return dir;
    };
    const dirs = new Map(timeline().map(b => [b.name, folder(b.name, b.createdAt)]));
    const unverified = folder('elle', iso('2026-06-01T12:00:00+03:00'), false);
    // A crashed backup (still "in progress", with its plain database copy) and a proof copy from two hours ago; one from now.
    const crashed = folder('yarim', iso('2026-10-04T10:00:00+03:00'), false), fresh = folder('simdi', iso('2026-10-05T10:00:00+03:00'), false);
    for (const dir of [crashed, fresh]) { writeFileSync(join(dir, 'BACKUP_IN_PROGRESS.txt'), ''); writeFileSync(join(dir, '.snapshot.sqlite'), 'SQLite format 3'); }
    const proof = join(options.checks, 'restore-eski'); mkdirSync(proof); writeFileSync(join(proof, 'merchant.sqlite'), 'açık veri');
    const hoursAgo = new Date(Date.now() - 2 * 3600_000);
    for (const dir of [crashed, proof]) utimesSync(dir, hoursAgo, hoursAgo);
    // An old status file (no currentAt, keep 14) loads.
    writeFileSync(join(options.backups, 'auto-backup-status.json'), JSON.stringify({ running: false, lastSuccessAt: iso('2026-10-06T03:30:00+03:00'), keep: 14, kept: 14 }));
    const clock = new Date('2026-10-06T03:35:00+03:00');
    const scheduler = new BackupScheduler(data, { ...options, changes: new ChangeMarker(store.db, () => clock) }, () => clock);
    assert.equal((await scheduler.load()).lastSuccessAt, iso('2026-10-06T03:30:00+03:00'));
    // Old backups hold no marker: the first night after the update always backs up.
    const s = await scheduler.runNow('auto');
    assert.equal(s.lastError, undefined, s.lastError); assert.equal(s.skipped, undefined);
    const left = new Set(backupsIn(options.backups).map(n => join(options.backups, n)));
    // The 03:30 backup of 5 October was replaced by the one just made (same business day, newer).
    const expected = [...EXPECTED.filter(d => d !== '2026-10-05').map(d => dirs.get(`gece-${d}`)!), s.lastDirectory!, unverified, fresh];
    assert.deepEqual([...left].sort(), expected.sort());
    assert.equal(existsSync(crashed), false, 'an interrupted backup with its plain copy is cleaned up'); assert.equal(existsSync(proof), false, 'an old proof copy too');
    assert.deepEqual(s.set!.map(b => businessDay(b.at)), EXPECTED);
    assert.equal(s.set!.find(b => businessDay(b.at) === '2026-08-31')?.tier, 'monthly');
    // The only verified backup of an old install (months old) stays next to the new one.
    const lone = temp('backup-lone'), loneData = join(lone, 'data'), loneStore = new Store(loneData, ['mola-demo']);
    try {
      const o = { backups: join(lone, 'backups'), keys: join(lone, 'keys'), checks: join(lone, 'checks') };
      const first = await new BackupScheduler(loneData, o, () => new Date('2026-01-10T03:30:00+03:00')).runNow('auto');
      const next = await new BackupScheduler(loneData, o, () => clock).runNow('auto');
      assert.deepEqual(backupsIn(o.backups).map(n => join(o.backups, n)).sort(), [first.lastDirectory!, next.lastDirectory!].sort());
    } finally { loneStore.close(); }
  } finally { store.close(); }
});

test('a restored database (another marker) is never taken as backed up; USB keeps the newest 3', async () => {
  const root = temp('backup-restored'), data = join(root, 'data'), store = new Store(data, ['mola-demo']);
  try {
    const options = { backups: join(root, 'backups'), keys: join(root, 'keys'), checks: join(root, 'checks') };
    let clock = new Date('2026-10-05T23:41:00+03:00');
    const first = await new BackupScheduler(data, { ...options, changes: new ChangeMarker(store.db, () => clock) }, () => clock).runNow('day-close');
    assert.equal(first.lastError, undefined);
    // Another database in its place (a restore): its own marker identity holds no backup here.
    const other = new DatabaseSync(':memory:'), restored = new ChangeMarker(other, () => clock); restored.arm();
    clock = new Date('2026-10-06T03:30:00+03:00');
    const night = await new BackupScheduler(data, { ...options, changes: restored }, () => clock).runNow('auto');
    assert.equal(night.skipped, undefined); assert.notEqual(night.lastDirectory, first.lastDirectory);
    other.close();
  } finally { store.close(); }
  // USB / OneDrive: the newest 3 copies (the computer keeps the longer history).
  const usb = join(root, 'usb'); mkdirSync(usb);
  const second = new SecondBackup(join(root, 'ikinci.json'), '00000000-0000-4000-8000-000000000001', { data: join(root, 'data'), backups: join(root, 'backups'), checks: join(root, 'checks') });
  assert.equal(second.keep, 3);
  await second.choose(usb, 'usb');
  for (let i = 1; i <= 5; i++) {
    const dir = join(root, 'kaynak', `backup-2026-10-0${i}T00-30-00-000Z-0000000${i}`); mkdirSync(dir, { recursive: true });
    for (const name of ['complete.json', 'anahtar-kurtarma.json', '0.bin']) writeFileSync(join(dir, name), `${name}:${i}`);
    assert.equal((await second.copy(dir)).lastError, undefined);
  }
  assert.deepEqual(readdirSync(second.root!).filter(n => n.startsWith('backup-')).map(n => n.slice(-1)), ['3', '4', '5']);
});
