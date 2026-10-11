import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, utimesSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { base32, totp, verifyTotp } from '../server/totp.js';
import { starterState } from '../server/starter-template.js';
import { cleanPhotos, restorePhotos, trashBatches } from '../server/photo-trash.js';
import { Store, seal } from '../server/store.js';
import { createBackup, restoreBackup } from '../server/backup.js';
import { adjustPayment, paymentLedger } from '../packages/domain/payment-adjustments.js';
import { financialReport } from '../packages/domain/reports.js';
import { dataLock } from '../server/data-lock.js';
function temp() { mkdirSync('.local/tests', { recursive: true }); return mkdtempSync(resolve('.local/tests/delivery-')); }

test('incomplete and failed restore directories cannot be opened or backed up', async () => {
  for (const marker of ['RESTORE_IN_PROGRESS.txt', 'RESTORE_FAILED.txt']) {
    const dir = temp(); writeFileSync(join(dir, marker), 'test');
    assert.throws(() => new Store(dir, []), /Geri yükleme/);
    assert.throws(() => dataLock(dir, 'server'), /Geri yükleme/);
    await assert.rejects(createBackup(dir, join(temp(), 'backup'), join(temp(), 'keys')), /Geri yükleme/);
    assert.equal(existsSync(join(dir, 'merchant.sqlite')), false);
  }
});

test('backup creation rejects stale/incomplete projections and marks failures; legacy tables remain optional', async () => {
  for (const mode of ['stale-directory', 'stale-credentials', 'missing-row', 'legacy'] as const) {
    const dir = temp(), source = join(dir, 'source'), store = new Store(source, ['one']);
    if (mode === 'stale-directory') {
      const entry = store.directoryEntry('one'); entry.name = 'stale name';
      store.db.prepare('UPDATE business_directory SET payload=? WHERE tenant=?').run(seal(entry, store.key, 'directory:one'), 'one');
    } else if (mode === 'stale-credentials') {
      store.db.prepare('UPDATE staff_credentials SET payload=? WHERE tenant=?').run(seal([], store.key, 'credentials:one'), 'one');
    } else if (mode === 'missing-row') store.db.exec('DELETE FROM business_directory');
    else store.db.exec('DROP TABLE business_directory; DROP TABLE staff_credentials; DROP TABLE staff_login_lookup');
    store.close();
    const restores = join(dir, 'restores');
    if (mode === 'legacy') {
      const backup = await createBackup(source, join(dir, 'backups'), join(dir, 'keys'));
      const restored = await restoreBackup(backup.directory, backup.keyPath, restores);
      assert.equal(existsSync(join(restored.directory, 'RESTORE_IN_PROGRESS.txt')), false);
      const copy = new Store(restored.directory, []);
      try { assert.equal(copy.findUser('diger')!.tenantId, 'one'); } finally { copy.close(); }
    } else {
      await assert.rejects(createBackup(source, join(dir, 'backups'), join(dir, 'keys')), /Yedekte/);
      const failed = join(dir, 'backups', readdirSync(join(dir, 'backups'))[0]);
      assert.ok(existsSync(join(failed, 'BACKUP_FAILED.txt')));
      assert.equal(existsSync(join(failed, 'complete.json')), false);
      assert.equal(existsSync(join(failed, '.snapshot.sqlite')), false);
      assert.equal(existsSync(join(source, '.mola-operation.lock')), false);
      await assert.rejects(restoreBackup(failed, 'unused-key-path', restores), /tamamlanmamış/);
    }
  }
});

test('completed backups reject failure markers and mismatched completion metadata', async () => {
  const dir = temp(), source = join(dir, 'source'), store = new Store(source, []); store.close();
  const backup = await createBackup(source, join(dir, 'backups'), join(dir, 'keys'));
  assert.equal(existsSync(join(backup.directory, 'BACKUP_IN_PROGRESS.txt')), false);
  assert.equal(existsSync(join(backup.directory, 'complete.partial')), false);
  const completePath = join(backup.directory, 'complete.json'), complete = JSON.parse(readFileSync(completePath, 'utf8'));
  writeFileSync(completePath, JSON.stringify({ ...complete, files: complete.files + 1 }));
  await assert.rejects(restoreBackup(backup.directory, backup.keyPath, join(dir, 'restore')), /uyuşmuyor/);
  writeFileSync(completePath, JSON.stringify(complete));
  writeFileSync(join(backup.directory, 'BACKUP_FAILED.txt'), 'test');
  await assert.rejects(restoreBackup(backup.directory, backup.keyPath, join(dir, 'restore')), /tamamlanmamış/);
});
test('data lock prevents online backup and releases without removing another operation', async () => {
  const dir = temp(), source = join(dir, 'source'), store = new Store(source, []); store.close();
  const release = dataLock(source, 'server');
  assert.throws(() => dataLock(source, 'backup'));
  await assert.rejects(createBackup(source, join(dir, 'backups'), join(dir, 'keys')), /kullanımda/);
  release(); const second = dataLock(source, 'server'); release();
  assert.throws(() => dataLock(source, 'backup')); second();
  const backup = await createBackup(source, join(dir, 'backups'), join(dir, 'keys'));
  const restored = await restoreBackup(backup.directory, backup.keyPath, join(dir, 'restores'));
  assert.equal(existsSync(join(restored.directory, '.mola-operation.lock')), false);
});
test('RFC6238 SHA1 vectors, drift and replay protection', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  for (const [seconds, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']] as const) assert.equal(totp(secret, seconds * 1000, 8), expected);
  const now = Date.now(), code = totp(secret, now), step = verifyTotp(secret, code, now)!;
  assert.ok(step >= 0); assert.equal(verifyTotp(secret, code, now, step), null); assert.equal(verifyTotp(secret, 'abc123', now), null);
});
test('clean template has examples, no personal or transaction data and unique QR tokens', () => {
  const a = starterState('one', 'One'), b = starterState('two', 'Two');
  assert.equal(a.products.length, 8); assert.equal(a.categories?.length, 4); assert.ok(a.subcategoryCatalog?.length);
  for (const key of ['orders', 'payments', 'archives', 'audit', 'staffUsers'] as const) assert.equal(a[key]?.length, 0);
  assert.notEqual(a.tables[0].token, b.tables[0].token); assert.equal(a.setupCompleted, false);
});
test('photo cleanup protects drafts/recent files and restores originals idempotently', () => {
  const dir = temp(), s = starterState('one', 'One'), old = new Date('2026-01-01'), now = new Date('2026-09-21');
  const ids = Array.from({ length: 4 }, () => randomUUID());
  mkdirSync(join(dir, 'media', 'one'), { recursive: true });
  for (const id of ids) { const file = join(dir, 'media', 'one', id + '.webp'); writeFileSync(file, id); utimesSync(file, old, old); }
  s.products[0].photo = `/media/one/${ids[0]}.webp`; s.productDrafts = [{ ...s.products[1], photo: `/media/one/${ids[1]}.webp` }];
  utimesSync(join(dir, 'media', 'one', ids[2] + '.webp'), now, now);
  const result = cleanPhotos(dir, 'one', s, now); assert.equal(result.count, 1);
  assert.ok(existsSync(join(dir, 'media', 'one', ids[0] + '.webp'))); assert.ok(existsSync(join(dir, 'media', 'one', ids[1] + '.webp')));
  assert.equal(existsSync(join(dir, 'media', 'one', ids[3] + '.webp')), false);
  assert.equal(trashBatches(dir, 'one').length, 1); assert.equal(trashBatches(dir, 'other').length, 0);
  restorePhotos(dir, 'one', result.id!, now); restorePhotos(dir, 'one', result.id!, now);
  assert.equal(readFileSync(join(dir, 'media', 'one', ids[3] + '.webp'), 'utf8'), ids[3]); assert.equal(trashBatches(dir, 'one').length, 0);
  assert.throws(() => restorePhotos(dir, 'one', '../other', now));
});
test('encrypted backup roundtrip and wrong-key/tamper rejection', async () => {
  const dir = temp(), source = join(dir, 'source'), store = new Store(source, ['one']);
  const original = store.read('one'); store.close(); writeFileSync(join(source, 'example.txt'), 'private picture sample');
  const backup = await createBackup(source, join(dir, 'backups'), join(dir, 'keys'));
  const restored = await restoreBackup(backup.directory, backup.keyPath, join(dir, 'restores'));
  const copy = new Store(restored.directory, []); assert.deepEqual(copy.read('one'), original); copy.close();
  assert.equal(readFileSync(join(restored.directory, 'example.txt'), 'utf8'), 'private picture sample');
  const wrong = join(dir, 'wrong.key'); writeFileSync(wrong, randomBytes(32)); await assert.rejects(restoreBackup(backup.directory, wrong, join(dir, 'restores')));
  const manifest = join(backup.directory, 'manifest.bin'), bytes = readFileSync(manifest); bytes[15] ^= 1; writeFileSync(manifest, bytes);
  await assert.rejects(restoreBackup(backup.directory, backup.keyPath, join(dir, 'restores')));
});
test('payment correction preserves originals, refunds cannot overrun, reports use refund date', () => {
  const s = starterState('one', 'One'), actor = { id: 'owner', tenantId: 'one', role: 'owner' as const }, ctx = { now: new Date('2026-09-21T12:00:00Z'), id: randomUUID };
  s.payments.push({ id: 'p', accountId: 'closed', amount: 10000, tendered: 10000, change: 0, method: 'cash', commission: 0, createdAt: '2026-09-20T12:00:00Z' });
  const method = { requestId: randomUUID(), paymentId: 'p', revision: 0, kind: 'method' as const, amount: 0, method: 'card' as const, commission: 300, reason: 'Kart ödemesi yanlış işaretlendi' };
  adjustPayment(s, actor, method, ctx); assert.equal(s.payments[0].method, 'cash'); assert.equal(paymentLedger(s)[0].method, 'card');
  const b = { requestId: randomUUID(), paymentId: 'p', revision: 1, kind: 'refund' as const, amount: 4000, method: 'card' as const, commission: 0, reason: 'Müşteri iadesi' };
  const first = adjustPayment(s, actor, b, ctx); assert.deepEqual(adjustPayment(s, actor, b, ctx), first);
  assert.throws(() => adjustPayment(s, actor, { ...b, requestId: randomUUID(), revision: 2, amount: 7000 }, ctx));
  // A waiter never refunds; a cashier's small refunds within the owner's limits are tests/refunds.test.ts.
  assert.throws(() => adjustPayment(s, { ...actor, role: 'waiter' }, { ...b, requestId: randomUUID(), revision: 2 }, ctx));
  assert.throws(() => adjustPayment(s, actor, { ...method, requestId: randomUUID(), revision: 2, method: 'cash' }, ctx));
  const before = financialReport(s, '2026-09-20', '2026-09-20'), today = financialReport(s, '2026-09-21', '2026-09-21'), all = financialReport(s, '2026-09-20', '2026-09-21');
  assert.equal(before.card, 10000); assert.equal(before.refundTotal, 0); assert.equal(today.refundTotal, 4000); assert.equal(today.afterCommission, -4000); assert.equal(all.afterCommission, 5700);
});
