import { backupVerification } from '../server/backup-verification.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dataLock } from '../server/data-lock.js';
import { Store } from '../server/store.js';
import { createVerifiedBackup } from '../server/verified-backup.js';
import { sqliteJob, validateBackupDatabase } from '../server/backup.js';
import { DatabaseSync } from 'node:sqlite';
import { AgendaBook } from '../server/agenda.js';
import { Notifications } from '../server/notifications.js';
import { CredentialVault } from '../server/integrations/secrets.js';

test('verified backup records success after restoring separate data and leaves source unchanged', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(resolve('.local/tests/verified-backup-'));
  const source = join(root, 'data'); const store = new Store(source); store.close();
  const before = readFileSync(join(source, 'merchant.sqlite'));
  const result = await createVerifiedBackup(source, join(root, 'backups'), join(root, 'keys'), join(root, 'checks'));
  assert.equal(result.verified, true);
  assert.equal(backupVerification(result.backupDirectory).status, 'recorded');
  assert.ok(existsSync(join(result.verificationDirectory, 'merchant.sqlite')));
  assert.deepEqual(JSON.parse(readFileSync(join(result.backupDirectory, 'verification.json'), 'utf8')), result);
  assert.deepEqual(readFileSync(join(source, 'merchant.sqlite')), before);
  const record = join(result.backupDirectory, 'verification.json');
  for (const changed of [{ files: result.files + 1 }, { checkedAt: '2099-01-01T00:00:00Z' }, { backupDirectory: source }]) {
    writeFileSync(record, JSON.stringify({ ...result, ...changed }));
    assert.equal(backupVerification(result.backupDirectory).status, 'invalid');
  }
  assert.equal(backupVerification(null).status, 'missing');
  assert.equal(backupVerification(source).status, 'unverified');
});

test('verified backup rejects live data and overlapping restore targets without claiming success', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(resolve('.local/tests/verified-backup-'));
  const source = join(root, 'data'); const store = new Store(source);
  const release = dataLock(source, 'server');
  try { await assert.rejects(createVerifiedBackup(source, join(root, 'backups'), join(root, 'keys'), join(root, 'checks'))); }
  finally { release(); store.close(); }
  assert.equal(existsSync(join(root, 'backups')), false);
  await assert.rejects(createVerifiedBackup(source, join(root, 'backups'), join(root, 'keys'), join(source, 'checks')));
  assert.equal(existsSync(join(root, 'backups')), false);
});

test('whole-database copy and integrity check run off the main thread, so a backup does not pause a running café', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(resolve('.local/tests/verified-backup-'));
  const source = join(root, 'data'); const store = new Store(source); store.close();
  let done = false;
  const copy = sqliteJob({ vacuum: [join(source, 'merchant.sqlite'), join(root, 'copy.sqlite')] }).then(v => { done = true; return v; });
  // A synchronous VACUUM INTO would already be finished here; in a worker it is still running while the server answers.
  await new Promise(r => setImmediate(r)); assert.equal(done, false);
  assert.equal(await copy, 'ok'); assert.ok(existsSync(join(root, 'copy.sqlite')));
  assert.equal(await sqliteJob({ check: join(root, 'copy.sqlite') }), 'ok');
  writeFileSync(join(root, 'broken.sqlite'), 'not a database');
  await assert.rejects(sqliteJob({ check: join(root, 'broken.sqlite') }));
  await validateBackupDatabase(join(root, 'copy.sqlite'), join(source, 'development.key'));
});

test('backup check opens Ajanda notes, notifications and platform credentials too: a damaged row fails it', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(resolve('.local/tests/verified-backup-'));
  const source = join(root, 'data'), store = new Store(source), tenant = 'mola-demo', now = () => new Date();
  const agenda = new AgendaBook(store, now);
  agenda.save(tenant, 'owner', { day: '2026-10-04', title: 'Tedarikçi', text: 'Süt siparişi' });
  new Notifications(store, agenda, now).add(tenant, 'test:1', { kind: 'backup', title: 'Yedek', text: 'Deneme' });
  new CredentialVault(store).save(tenant, 'yemeksepeti', { apiKey: 'test-anahtar-123' });
  store.close();
  const copy = join(root, 'copy.sqlite');
  await sqliteJob({ vacuum: [join(source, 'merchant.sqlite'), copy] });
  await validateBackupDatabase(copy, join(source, 'development.key'));
  for (const table of ['agenda_notes', 'notifications', 'integration_secrets']) {
    const damaged = join(root, `${table}.sqlite`); writeFileSync(damaged, readFileSync(copy));
    const db = new DatabaseSync(damaged); db.prepare(`UPDATE ${table} SET payload=? WHERE tenant=?`).run(Buffer.from('bozuk'), tenant); db.close();
    await assert.rejects(validateBackupDatabase(damaged, join(source, 'development.key')), Error, table);
  }
});

test('failed verification keeps archive but records no successful restore', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(resolve('.local/tests/verified-backup-'));
  const source = join(root, 'data'); const store = new Store(source); store.close();
  const checks = join(root, 'checks'); writeFileSync(checks, 'occupied');
  await assert.rejects(createVerifiedBackup(source, join(root, 'backups'), join(root, 'keys'), checks));
  const backup = join(root, 'backups', readdirSync(join(root, 'backups'))[0]);
  assert.equal(existsSync(join(backup, 'complete.json')), true);
  assert.equal(existsSync(join(backup, 'verification.json')), false);
  const failed = JSON.parse(readFileSync(join(backup, 'verification-failed.json'), 'utf8'));
  assert.equal(failed.verified, false); assert.equal(failed.stage, 'restore');
  assert.equal(backupVerification(backup).status, 'failed');
  assert.equal(readFileSync(checks, 'utf8'), 'occupied');
});
