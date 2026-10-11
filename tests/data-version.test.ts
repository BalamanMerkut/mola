import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.js';
import { DATA_VERSION } from '../server/data-version.js';
import { PACKAGE_DATA_VERSION } from '../server/year-packages.js';
import { validateBackupDatabase } from '../server/backup.js';
function fixture() {
  mkdirSync('.local/tests', { recursive: true });
  return mkdtempSync(resolve('.local/tests/data-version-'));
}
test('new and legacy databases acquire a version without changing stored business data', () => {
  // Version 4 (yıl paketleri) is written by the first year package only (server/year-packer.ts); until then data stays 3.
  assert.equal(DATA_VERSION, PACKAGE_DATA_VERSION);
  const dir = fixture(); let store = new Store(dir); const state = store.read('mola-demo');
  assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 3);
  store.db.exec('PRAGMA user_version=0'); store.close();
  store = new Store(dir);
  assert.deepEqual(store.read('mola-demo'), state);
  assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 3); store.close();
});
test('unsupported data is rejected before schema or journal changes and backup validation also rejects it', async () => {
  const dir = fixture(); const store = new Store(dir); store.close();
  const path = join(dir, 'merchant.sqlite'), db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA user_version=999'); db.close();
  const bytes = readFileSync(path), names = readdirSync(dir);
  assert.throws(() => new Store(dir), /Veri biçimi.*uyumlu değil/);
  await assert.rejects(validateBackupDatabase(path, join(dir, 'development.key')), /Veri biçimi/);
  assert.deepEqual(readFileSync(path), bytes); assert.deepEqual(readdirSync(dir), names);
  const check = new DatabaseSync(path, { readOnly: true });
  assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 999);
  assert.equal(check.prepare('PRAGMA journal_mode').get()?.journal_mode, 'delete'); check.close();
});
