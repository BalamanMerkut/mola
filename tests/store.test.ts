import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Store, seal, unseal, snapshotKey } from '../server/store.js';
import { seed } from '../server/seed.js';

test('indexed login opens only the target tenant, rejects redirected indexes and rebuilds after restore', () => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/login-index-'));
  let store = new Store(directory);
  try {
    const lookup = store.db.prepare('SELECT token,tenant FROM staff_login_lookup').all() as { token: string; tenant: string }[];
    assert.equal(lookup.length, 5);
    assert.ok(lookup.every(row => /^[a-f0-9]{64}$/.test(row.token)));
    const row = store.db.prepare('SELECT payload FROM staff_credentials WHERE tenant=?').get('other-demo') as { payload: Uint8Array };
    store.db.prepare('UPDATE staff_credentials SET payload=? WHERE tenant=?').run(randomBytes(48), 'other-demo');
    assert.equal(store.findUser('garson')!.tenantId, 'mola-demo');
    assert.equal(store.findUser('absent'), undefined);
    assert.throws(() => store.findUser('diger'));
    store.db.prepare('UPDATE staff_credentials SET payload=? WHERE tenant=?').run(row.payload, 'other-demo');
    assert.throws(() => store.mutate('mola-demo', s => { s.staffUsers!.find(u => u.id === 'garson')!.username = 'diger'; }));
    assert.equal(store.findUser('garson')!.tenantId, 'mola-demo');
    assert.equal(store.findUser('diger')!.tenantId, 'other-demo');
    store.db.prepare('UPDATE staff_login_lookup SET tenant=? WHERE tenant=?').run('other-demo', 'mola-demo');
    assert.equal(store.findUser('garson'), undefined);
    const snapshot = store.read('mola-demo');
    store.db.exec('DROP TABLE staff_login_lookup');
    store.close(); store = new Store(directory);
    assert.equal(store.findUser('garson')!.tenantId, 'mola-demo');
    assert.deepEqual(store.read('mola-demo'), snapshot);
    store.mutate('mola-demo', s => { s.staffUsers!.find(u => u.id === 'garson')!.username = 'new.waiter'; });
    assert.equal(store.findUser('garson'), undefined);
    assert.equal(store.findUser('new.waiter')!.user.id, 'garson');
  } finally { store.close(); }
});

test('login credentials exclude private data and stay atomic across account changes and migration', () => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/credentials-'));
  let store = new Store(directory);
  const payload = () => Buffer.from((store.db.prepare('SELECT payload FROM staff_credentials WHERE tenant=?').get('mola-demo') as { payload: Uint8Array }).payload);
  try {
    const original = store.findUser('garson')!;
    assert.deepEqual(Object.keys(original.user).sort(), ['active', 'hash', 'id', 'role', 'salt', 'username', 'version']);
    assert.equal(original.tenantId, 'mola-demo');
    assert.equal(store.findUser('diger')!.tenantId, 'other-demo');
    assert.equal(store.findUser('missing'), undefined);
    const before = payload();
    store.mutate('mola-demo', s => { s.name = 'New business name'; });
    assert.deepEqual(payload(), before);
    store.db.exec("CREATE TRIGGER reject_credentials_test BEFORE UPDATE ON snapshots BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.throws(() => store.mutate('mola-demo', s => { s.staffUsers!.find(u => u.id === 'garson')!.active = false; }));
    assert.equal(store.findUser('garson')!.user.active, true);
    store.db.exec('DROP TRIGGER reject_credentials_test');
    store.mutate('mola-demo', s => { const u = s.staffUsers!.find(u => u.id === 'garson')!; u.active = false; u.version++; });
    assert.equal(store.findUser('garson')!.user.active, false);
    assert.equal(store.findUser('garson')!.user.version, original.user.version + 1);
    const snapshot = store.read('mola-demo');
    store.db.exec('DELETE FROM staff_credentials');
    store.close(); store = new Store(directory);
    assert.deepEqual(store.read('mola-demo'), snapshot);
    assert.equal(store.findUser('garson')!.user.active, false);
    assert.throws(() => unseal(payload(), store.key, 'credentials:other-demo'));
  } finally { store.close(); }
});

test('management directory is minimal, synchronized, atomic and backfilled without changing snapshots', () => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/directory-'));
  let store = new Store(directory);
  const payload = () => Buffer.from((store.db.prepare('SELECT payload FROM business_directory WHERE tenant=?').get('mola-demo') as { payload: Uint8Array }).payload);
  try {
    const entry = store.directoryEntry('mola-demo');
    // `sector` is the kind of business (Kafe/Restoran/Tatlıcı) for the admin list's chip; nothing else from the business record.
    assert.deepEqual(Object.keys(entry).sort(), ['businessRevision', 'name', 'ownerAccount', 'sector', 'setupCompleted', 'tenantId']);
    assert.equal(entry.sector, 'cafe');
    assert.deepEqual(Object.keys(entry.ownerAccount!).sort(), ['id', 'username', 'version']);
    const before = payload();
    store.mutate('mola-demo', s => { s.audit.push({ target: 'test-private', action: 'test.private', at: '2026-09-26T10:00:00Z', actor: 'test' }); });
    assert.deepEqual(payload(), before);
    store.mutate('mola-demo', s => { s.name = 'Updated'; s.setupCompleted = true; s.staffUsers!.find(u => u.role === 'owner')!.version++; });
    assert.equal(store.directoryEntry('mola-demo').name, 'Updated');
    assert.equal(store.directoryEntry('mola-demo').setupCompleted, true);
    assert.equal(store.directoryEntry('mola-demo').ownerAccount!.version, entry.ownerAccount!.version + 1);
    store.db.exec("CREATE TRIGGER reject_snapshot BEFORE UPDATE ON snapshots BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.throws(() => store.mutate('mola-demo', s => { s.name = 'Must rollback'; }));
    assert.equal(store.directoryEntry('mola-demo').name, 'Updated');
    assert.equal(store.read('mola-demo').name, 'Updated');
    store.db.exec('DROP TRIGGER reject_snapshot');
    const snapshot = store.read('mola-demo');
    store.db.exec('DELETE FROM business_directory');
    store.close(); store = new Store(directory);
    assert.equal(store.directoryEntry('mola-demo').name, 'Updated');
    assert.deepEqual(store.read('mola-demo'), snapshot);
    assert.throws(() => unseal(payload(), store.key, 'directory:other-demo'));
  } finally { store.close(); }
});
test('authenticated encryption rejects tampering, wrong key and wrong tenant', () => {
  const key = randomBytes(32), s = seed(), blob = seal(s, key, s.tenantId);
  assert.deepEqual(unseal(blob, key, s.tenantId), s);
  assert.throws(() => unseal(blob, randomBytes(32), s.tenantId));
  assert.throws(() => unseal(blob, key, 'other-demo'));
  blob[blob.length - 1] ^= 1; assert.throws(() => unseal(blob, key, s.tenantId));
});
test('persistent transaction survives restart, rolls back failures and hides plaintext', () => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/store-'));
  let store = new Store(directory);
  store.mutate('mola-demo', s => { s.name = 'SECRET_FINANCIAL_MARKER'; });
  assert.throws(() => store.mutate('mola-demo', s => { s.name = 'BROKEN'; throw new Error('simulate'); }));
  assert.equal(store.read('mola-demo').name, 'SECRET_FINANCIAL_MARKER');
  assert.notEqual(store.read('other-demo').name, 'SECRET_FINANCIAL_MARKER');
  store.close(); assert.equal(readFileSync(join(directory, 'merchant.sqlite')).includes('SECRET_FINANCIAL_MARKER'), false);
  store = new Store(directory); assert.equal(store.read('mola-demo').name, 'SECRET_FINANCIAL_MARKER'); store.close();
});


test('legacy snapshots migrate atomically to different tenant keys with a readable rollback copy', () => {
  mkdirSync('.local/tests', { recursive: true }); const directory = mkdtempSync(resolve('.local/tests/keys-'));
  const master = randomBytes(32); writeFileSync(join(directory, 'development.key'), master);
  const db = new DatabaseSync(join(directory, 'merchant.sqlite'));
  db.exec('CREATE TABLE snapshots (tenant TEXT PRIMARY KEY, payload BLOB NOT NULL)');
  const originals = ['one', 'two'].map(tenant => ({ ...seed(tenant), staffUsers: [] }));
  for (const s of originals) db.prepare('INSERT INTO snapshots VALUES (?,?)').run(s.tenantId, seal(s, master, s.tenantId)); db.close();
  let store = new Store(directory, []);
  const first = snapshotKey(store.db, master, 'one')!, second = snapshotKey(store.db, master, 'two')!;
  assert.notDeepEqual(first, second); assert.notDeepEqual(first, master);
  for (const s of originals) assert.deepEqual(store.read(s.tenantId), s);
  const row = store.db.prepare('SELECT payload FROM snapshots WHERE tenant=?').get('two') as { payload: Uint8Array };
  assert.throws(() => unseal(Buffer.from(row.payload), first, 'two'));
  assert.throws(() => unseal(Buffer.from(row.payload), master, 'two'));
  const backupFile = readdirSync(join(directory, 'backups')).find(n => n.startsWith('before-tenant-keys-'))!;
  const backup = new DatabaseSync(join(directory, 'backups', backupFile), { readOnly: true });
  try { const row = backup.prepare('SELECT payload FROM snapshots WHERE tenant=?').get('one') as { payload: Uint8Array }; assert.deepEqual(unseal(Buffer.from(row.payload), master, 'one'), originals[0]); } finally { backup.close(); }
  store.close(); store = new Store(directory, []);
  assert.deepEqual(snapshotKey(store.db, master, 'one'), first);
  assert.equal(readdirSync(join(directory, 'backups')).length, 1);
  store.db.prepare('DELETE FROM tenant_keys WHERE tenant=?').run('one'); store.close();
  assert.throws(() => new Store(directory, []));
});

test('damaged legacy snapshot aborts migration before touching any business', () => {
  mkdirSync('.local/tests', { recursive: true }); const directory = mkdtempSync(resolve('.local/tests/bad-keys-'));
  const master = randomBytes(32); writeFileSync(join(directory, 'development.key'), master);
  const db = new DatabaseSync(join(directory, 'merchant.sqlite')); db.exec('CREATE TABLE snapshots (tenant TEXT PRIMARY KEY,payload BLOB NOT NULL)');
  const good = seal(seed('one'), master, 'one'); db.prepare('INSERT INTO snapshots VALUES (?,?)').run('one', good); db.prepare('INSERT INTO snapshots VALUES (?,?)').run('two', randomBytes(50)); db.close();
  assert.throws(() => new Store(directory, []));
  const verify = new DatabaseSync(join(directory, 'merchant.sqlite'));
  try { assert.equal(verify.prepare('SELECT count(*) as n FROM tenant_keys').get()!.n, 0); assert.deepEqual(Buffer.from((verify.prepare('SELECT payload FROM snapshots WHERE tenant=?').get('one') as { payload: Uint8Array }).payload), good); } finally { verify.close(); }
});
