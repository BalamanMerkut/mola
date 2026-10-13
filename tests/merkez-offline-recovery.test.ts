import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MerkezBackups, MerkezRecovery, readRecoveryFile, restoreMerkezBackup } from '../server/merkez/backup.js';
import { MerkezKeyGuard } from '../server/merkez/key-guard.js';
import { openOfflineRecovery } from '../server/merkez/offline-recovery.js';
import { OfflineResetError } from '../server/merkez/offline-reset.js';
import { MerkezStore } from '../server/merkez/store.js';
import { dataLock } from '../server/data-lock.js';
import { fakeOsLock, FAST_KDF } from './fake-os-lock.js';
import { MERKEZ_PASSWORD, temp } from './merkez-fixture.js';

/*
 * kurtarma-kodu.sh (server/merkez/offline-recovery.ts): a new Merkez recovery code on a server, where Mola Yönetim never
 * shows it. Scratch Merkez folders under .local/tests; "computer users" are fake OS locks.
 */
async function protectedMerkez(name: string) {
  const dir = join(temp(name), 'veri'), key = randomBytes(32);
  const store = new MerkezStore(dir, key, { initialPassword: MERKEZ_PASSWORD });
  store.mutate(d => { d.businesses.push({ tenantId: 'kafe-1', name: 'Yokuş Kafe', endsAt: '2027-10-01T00:00:00.000Z', suspended: false, kind: 'subscription', planMonths: 12, service: 'full', source: 'admin', serial: 1 } as never); });
  store.close();
  writeFileSync(join(dir, 'development.key'), key, { mode: 0o600 });
  const first = await MerkezRecovery.open(dir, key, FAST_KDF), code = first.reveal(); first.confirm();
  // As the server runs it: locked to its user (here "mola"), with its own backups beside the data folder.
  const guard = await MerkezKeyGuard.open(dir, { protect: true, osLock: fakeOsLock('mola') });
  const recovery = await MerkezRecovery.open(dir, guard.key!, FAST_KDF, { seed: guard.seed(), onChange: f => guard.syncRecovery(f) });
  const root = join(dir, '..'), backups = new MerkezBackups(dir, { folder: join(root, 'merkez-yedek'), checks: join(root, 'merkez-yedek-prova'), settings: join(dir, 'merkez-yedek-ayar.json'), auto: false, protection: () => recovery.protection() });
  assert.equal((await backups.runNow()).lastError, undefined);
  // The next protected start drops the plain copy of the migration (as on the server after its first restart).
  await MerkezKeyGuard.open(dir, { protect: true, osLock: fakeOsLock('mola') });
  return { dir, key, code, root };
}

test('kurtarma-kodu: nothing changes until commit; then the new code opens the key file and the backups, the old one nothing; audit + Bildirim merkezi', async () => {
  const m = await protectedMerkez('kurtarma-kodu'), mola = fakeOsLock('mola');
  // Another computer user: refused, nothing opened.
  await assert.rejects(openOfflineRecovery(m.dir, { protect: true, osLock: fakeOsLock('baska'), kdf: FAST_KDF }), (e: OfflineResetError) => e.code === 'LOCKED');
  // Merkez running (its data lock held): refused.
  const running = dataLock(m.dir, 'test');
  await assert.rejects(openOfflineRecovery(m.dir, { protect: true, osLock: mola, kdf: FAST_KDF }), (e: OfflineResetError) => e.code === 'RUNNING');
  running();
  // Cancelled (closed without commit): the old code is still the code.
  const before = JSON.stringify(readRecoveryFile(m.dir));
  const cancelled = await openOfflineRecovery(m.dir, { protect: true, osLock: mola, kdf: FAST_KDF });
  assert.match(cancelled.code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/); assert.notEqual(cancelled.code, m.code);
  cancelled.close();
  assert.equal(JSON.stringify(readRecoveryFile(m.dir)), before);
  // Committed.
  const renewal = await openOfflineRecovery(m.dir, { protect: true, osLock: mola, kdf: FAST_KDF });
  const fresh = renewal.code, done = await renewal.commit();
  renewal.close();
  assert.equal(done.rewrapped, 1);
  const file = readRecoveryFile(m.dir)!;
  assert.ok(file.recovery.shownAt && file.recovery.confirmedAt, 'counts as shown and saved: the next start keeps it');
  // The key file: the new code unlocks it for another user, the old one no longer.
  const other = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: fakeOsLock('yeni-sunucu') });
  assert.equal(other.state, 'locked');
  await assert.rejects(other.unlock(m.code), (e: Error & { code?: string }) => e.code === 'WRONG_CODE');
  await other.unlock(fresh); assert.equal(other.state, 'open'); assert.ok(other.key!.equals(m.key));
  // The server's own start keeps it (no new code nobody saw) and it matches.
  const guard = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: fakeOsLock('yeni-sunucu') });
  const kept = await MerkezRecovery.open(m.dir, guard.key!, FAST_KDF, { seed: guard.seed() });
  assert.equal(kept.view().confirmed, true); assert.equal(await kept.matches(fresh), true); assert.equal(await kept.matches(m.code), false);
  // The backup made before: opens with the new code only.
  const [made] = readdirSync(join(m.root, 'merkez-yedek')).filter(n => n.startsWith('merkez-yedek-'));
  await assert.rejects(restoreMerkezBackup(join(m.root, 'merkez-yedek', made), m.code, join(temp('kurtarma-eski'), 'veri')));
  assert.equal((await restoreMerkezBackup(join(m.root, 'merkez-yedek', made), fresh, join(temp('kurtarma-yeni'), 'veri'))).businesses, 1);
  // İşlem geçmişi and Bildirim merkezi; the code itself nowhere in the data.
  const store = new MerkezStore(m.dir, m.key);
  try {
    const d = store.read();
    assert.ok(d.audit.some(a => a.action === 'merkez.recovery_renewed' && a.by === 'system'));
    assert.equal((d.alerts ?? []).filter(a => a.kind === 'merkez.recovery').length, 1, 'one Bildirim merkezi entry');
    assert.ok(!JSON.stringify(d).includes(fresh));
  } finally { store.close(); }
});

test('the command: --evet commits without asking (scripts); without a terminal and without --evet it refuses; prints the code once', () => {
  const run = (dir: string, flags: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/merkez-kurtarma-kodu.ts', dir, ...flags], { encoding: 'utf8', env: { ...process.env, MERKEZ_KEY_PROTECTION: '0' } });
  const refused = run(join(temp('kurtarma-cli-yok'), 'veri'), []);
  assert.equal(refused.status, 2, refused.stderr);
  const missing = run(join(temp('kurtarma-cli-bos'), 'veri'), ['--evet']);
  assert.equal(missing.status, 1); assert.match(missing.stderr, /Mola Merkez verisi yok/);
});

test('the command on a plain (development) Merkez: --evet makes a new code that the recovery file then matches', async () => {
  const dir = join(temp('kurtarma-cli'), 'veri'), key = randomBytes(32);
  new MerkezStore(dir, key, { initialPassword: MERKEZ_PASSWORD }).close();
  writeFileSync(join(dir, 'development.key'), key, { mode: 0o600 });
  const first = await MerkezRecovery.open(dir, key, FAST_KDF); first.reveal(); first.confirm();
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/merkez-kurtarma-kodu.ts', dir, '--evet'], { encoding: 'utf8', env: { ...process.env, MERKEZ_KEY_PROTECTION: '0' } });
  assert.equal(r.status, 0, r.stderr);
  const code = /((?:[A-Z2-9]{4}\s{2}){5}[A-Z2-9]{4})/.exec(r.stdout)![1].split(/\s+/).join('-');
  assert.match(r.stdout, /Yeni kurtarma kodu geçerli/);
  const reopened = await MerkezRecovery.open(dir, key, FAST_KDF);
  assert.equal(await reopened.matches(code), true);
});
