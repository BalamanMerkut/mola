import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { createBackup } from '../server/backup.js';
import { join, resolve } from 'node:path';
import { Store } from '../server/store.js';
import { BackupScheduler } from '../server/backup-scheduler.js';

test('automatic backup runs while the store is open, proves itself, removes the proof copy and keeps the newest', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(resolve('.local/tests/auto-backup-')), data = join(root, 'data');
  const store = new Store(data, ['mola-demo']);
  try {
    store.mutate('mola-demo', s => { s.name = 'Canlı yedek kafe'; });
    // Two günlük only: backups on three business days leave the newest two.
    const options = { backups: join(root, 'backups'), keys: join(root, 'keys'), checks: join(root, 'checks'), retention: { daily: 2, weekly: 0, monthly: 0 } };
    let clock = new Date('2026-10-03T10:00:00');
    const scheduler = new BackupScheduler(data, options, () => clock);
    const first = await scheduler.runNow();
    assert.equal(first.lastError, undefined, first.lastError); assert.ok(first.lastSuccessAt); assert.ok(first.files! >= 2, 'database and data key');
    assert.ok(existsSync(join(first.lastDirectory!, 'complete.json')));
    assert.ok(existsSync(join(first.lastDirectory!, 'verification.json')));
    assert.deepEqual(readdirSync(options.checks), [], 'the plaintext proof copy is deleted');
    // Still writable while backups run: the server is never locked out.
    store.mutate('mola-demo', s => { s.name = 'Sonraki değişiklik'; });
    for (let i = 0; i < 2; i++) { clock = new Date(clock.getTime() + 86400000); await scheduler.runNow(); }
    const kept = readdirSync(options.backups).filter(n => n.startsWith('backup-'));
    assert.equal(kept.length, 2); assert.equal(readdirSync(options.keys).length, 2, 'keys of removed backups are removed too');
    assert.ok(!kept.includes(first.lastDirectory!.split(/[\\/]/).at(-1)!), 'the oldest backup was pruned');
    // Status survives a restart.
    const reloaded = await new BackupScheduler(data, options, () => clock).load();
    assert.equal(reloaded.kept, 2); assert.ok(reloaded.lastSuccessAt);
  } finally { store.close(); }
});
test('the café computer can back up now; owners only see whether the data is safe; manual backups are never pruned', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(resolve('.local/tests/auto-backup-api-')), data = join(root, 'data');
  const store = new Store(data, ['mola-demo']);
  const options = { backups: join(root, 'backups'), keys: join(root, 'keys'), checks: join(root, 'checks') };
  const manual = await createBackup(data, options.backups, options.keys);
  const scheduler = new BackupScheduler(data, options);
  const token = 'k'.repeat(43);
  licensed(store); const server = createServer(createApp(store, undefined, undefined, undefined, undefined, () => {}, undefined, scheduler, { token, shutdown: () => {} }));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, cookie = '', desktop = '') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(desktop ? { 'X-Mola-Desktop': desktop } : {}) }, body: JSON.stringify(body) });
  // Only the café computer's own Mola window (desktop key) runs a backup; the vendor's panel is not on this computer.
  assert.equal((await post('/api/desktop/backup', {})).status, 404);
  assert.equal((await post('/api/platform/backup/run', {})).status, 404);
  for (let i = 0; i < 3; i++) { const r = await (await post('/api/desktop/backup', {}, '', token)).json(); assert.ok(r.lastSuccessAt); assert.equal(r.lastError, null); }
  assert.ok(existsSync(manual.directory), 'a backup the operator made by hand is kept');
  assert.equal(readdirSync(options.backups).filter(n => n.startsWith('backup-')).length, 2, 'manual + the newest of this business day');
  const owner = (await post('/api/login', { username: 'isletme', password: DEMO_PASSWORD })).headers.getSetCookie()[0].split(';')[0];
  const status = await (await fetch(base + '/api/staff/backup-status', { headers: { Cookie: owner } })).json();
  assert.deepEqual(Object.keys(status).sort(), ['enabled', 'healthy', 'lastSuccessAt']); assert.equal(status.healthy, true);
});
test('a backup target inside the data folder is refused and reported, not silently written', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(resolve('.local/tests/auto-backup-bad-')), data = join(root, 'data');
  const store = new Store(data, ['mola-demo']);
  try {
    const status = await new BackupScheduler(data, { backups: join(data, 'inside'), keys: join(root, 'keys'), checks: join(root, 'checks') }).runNow();
    assert.match(status.lastError ?? '', /başarısız/); assert.equal(status.lastSuccessAt, undefined); assert.equal(status.running, false);
  } finally { store.close(); }
});
test('a backup is not started when the disk has no room for it, so years of history never fill the disk the café writes to', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(resolve('.local/tests/auto-backup-disk-')), data = join(root, 'data');
  const store = new Store(data, ['mola-demo']); store.close();
  const asked: string[] = [];
  const disk = (freeMiB: number) => async (path: string) => { asked.push(path); return { status: 'ok', availableMiB: freeMiB, totalMiB: 100000, message: '' }; };
  const options = { backups: join(root, 'backups'), keys: join(root, 'keys'), checks: join(root, 'checks') };
  const full = await new BackupScheduler(data, { ...options, checkDisk: disk(400) }).runNow();
  assert.match(full.lastError ?? '', /yer yok/); assert.equal(full.lastSuccessAt, undefined);
  assert.deepEqual(readdirSync(options.backups).filter(n => n.startsWith('backup-')), [], 'nothing half-written');
  // Backup and proof folders on one disk are counted together: one question for that disk.
  assert.equal(asked.length, 1);
  const roomy = await new BackupScheduler(data, { ...options, checkDisk: disk(600) }).runNow();
  assert.equal(roomy.lastError, undefined); assert.ok(roomy.lastSuccessAt);
});
test('next run is tonight at 03:30, or tomorrow if that time has passed; an overdue backup runs soon after start', async () => {
  const scheduler = new BackupScheduler('x', { backups: 'b', keys: 'k', checks: 'c' }, () => new Date('2026-10-03T10:00:00'));
  const next = scheduler.nextRun(new Date('2026-10-03T10:00:00'));
  assert.equal(next.getDate(), 4); assert.equal(next.getHours(), 3); assert.equal(next.getMinutes(), 30);
  assert.equal(scheduler.nextRun(new Date('2026-10-03T01:00:00')).getDate(), 3);
});
