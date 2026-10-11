import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store, snapshotKey } from '../server/store.js';
import { open, openText, seal } from '../server/sealing.js';
import { isPacked, pack, PACKING_DICTIONARY_V1, unpack } from '../server/packing.js';
import { SEALED_HISTORY } from '../server/history.js';
import { assertDataVersion, DATA_VERSION } from '../server/data-version.js';
import { createBackup, restoreBackup, validateBackupDatabase } from '../server/backup.js';
import { financialFrom, reportRange } from '../packages/domain/reports.js';
import { recordExpense } from '../packages/domain/expenses.js';
import type { Actor } from '../packages/domain/types.js';

const DAY = 86400000, MIN = 60000;
function folder(name: string) { mkdirSync('.local/tests', { recursive: true }); return mkdtempSync(resolve(`.local/tests/${name}-`)); }
const siblings = (directory: string, tag = '') => readdirSync(dirname(directory)).filter(n => n.startsWith(`${basename(directory)}-tasima-oncesi-${tag}`));
/** Best effort, like the other test folders: Windows (or a sync client) may still hold a just-closed file. */
const cleanup = (directory: string) => { for (const n of [basename(directory), ...siblings(directory)]) try { rmSync(join(dirname(directory), n), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* left in .local/tests */ } };
const tenant = 'mola-demo', owner: Actor = { tenantId: tenant, id: 'isletme', role: 'owner' };

/** `accounts` settled tables (with orders and payments), a few expenses and audit entries, written by a store. */
function fill(store: Store, accounts: number, start = Date.parse('2026-06-01T07:00:00Z')) {
  let t = start + accounts * 20 * MIN + 2 * DAY; store.clock = () => new Date(t);
  store.mutate(tenant, s => {
    for (let i = 0; i < accounts; i++) {
      const accountId = randomUUID(), at = new Date(start + i * 20 * MIN).toISOString(), total = 3500 + (i % 7) * 1000;
      const o = { id: randomUUID(), number: i + 1, accountId, guestId: 'garson', guestLabel: 'Personel', source: 'staff' as const, createdAt: at, status: 'served' as const, version: 4, menuRevision: 1, total, cancelRequested: false, lines: [{ id: randomUUID(), productId: 'tea', name: 'Demleme Çay', code: '21', optionNames: [], selections: [], quantity: 1, unitPrice: total, total }] };
      const payment = { id: randomUUID(), accountId, amount: total, tendered: total, change: 0, method: i % 3 ? 'card' as const : 'cash' as const, createdAt: at, commission: i % 3 ? 60 : 0, campaignAmount: 0 };
      s.accounts.push({ id: accountId, tableId: s.tables[i % s.tables.length].id, status: 'closed', version: 3, openedAt: at, closedAt: at }); s.orders.push(o); s.payments.push(payment);
      s.archives.push({ id: randomUUID(), accountId, tableName: s.tables[i % s.tables.length].name, closedAt: at, total, cash: payment.method === 'cash' ? total : 0, card: payment.method === 'card' ? total : 0, orders: [o], payments: [payment] });
    }
  });
  for (let i = 0; i < 5; i++) store.mutate(tenant, s => recordExpense(s, owner, { requestId: randomUUID(), amount: 15000 + i, description: `Süt ${i}` }, { now: new Date(start + i * DAY), id: randomUUID }));
  t += DAY; store.mutate(tenant, () => {});
}
const report = (store: Store) => { const s = store.read(tenant), { start, end } = reportRange('all', 'all'); return JSON.stringify([financialFrom(store.history.reportDays(tenant, s, start, end), 'all', 'all', start, end, store.history.adjustments(tenant, start, end), store.history.expenses(tenant, start, end)), store.history.paymentLedger(tenant, s, { from: 'all', to: 'all', limit: 500 }, Infinity).rows, store.auditLog(tenant, 5000)]); };
/** Opens every sealed history row: [packed, plain]. */
function census(store: Store) {
  let packed = 0, plain = 0;
  for (const [table, columns, scope] of SEALED_HISTORY) for (const row of store.db.prepare(`SELECT ${columns} FROM ${table}`).all() as (Record<string, string> & { payload: Uint8Array })[]) {
    if (openText(Buffer.from(row.payload), snapshotKey(store.db, store.key, row.tenant)!, scope(row)).packed) packed++; else plain++;
  }
  return [packed, plain];
}
/** A version 2 data folder (uncompressed history), as the previous app version left it. */
function version2(name: string, accounts = 300) {
  const directory = folder(name), store = new Store(directory, [tenant]);
  store.history.packing = false; fill(store, accounts); const expected = report(store);
  assert.deepEqual(census(store)[0], 0); store.close();
  const db = new DatabaseSync(join(directory, 'merchant.sqlite')); db.exec('PRAGMA user_version=2'); db.close();
  return { directory, expected };
}

test('packed rows round-trip; rows that would not shrink stay plain; the dictionary never changes', () => {
  const key = randomBytes(32), value = { id: randomUUID(), payments: Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, amount: 3500, method: 'card', createdAt: '2026-10-02T11:30:00.000Z' })), note: 'Çilekli Limonata · ₺' };
  for (const packed of [false, true]) assert.deepEqual(open(seal(value, key, 'archive:t:a', packed), key, 'archive:t:a'), value);
  const big = seal(value, key, 'archive:t:a', true), plain = seal(value, key, 'archive:t:a');
  assert.ok(big.length * 2 < plain.length, `${big.length} vs ${plain.length}`); assert.ok(openText(big, key, 'archive:t:a').packed);
  // Authentication still covers everything: a packed row cannot move to another record or tenant.
  assert.throws(() => open(big, key, 'archive:t:b')); assert.throws(() => open(big, randomBytes(32), 'archive:t:a'));
  // Short rows compress too, thanks to the dictionary; a row that would grow is kept as JSON.
  const audit = Buffer.from(JSON.stringify({ action: 'order.approved', actor: 'garson', target: randomUUID(), at: new Date().toISOString() }));
  assert.ok(isPacked(pack(audit)) && pack(audit).length < audit.length * 0.75, `${pack(audit).length} / ${audit.length}`);
  for (const tiny of ['1', '{}', '"x"']) assert.deepEqual(pack(Buffer.from(tiny)), Buffer.from(tiny));
  assert.deepEqual(unpack(pack(audit)), audit); assert.deepEqual(unpack(audit), audit);
  assert.throws(() => unpack(Buffer.from([0, 9, 1, 2])), /tanımadığı/);
  assert.equal(createHash('sha256').update(PACKING_DICTIONARY_V1).digest('hex'), 'd324ab61945703b7053112859c06301d20fff875d7c4d45bd667c2189f69808f', 'codec 1 dictionary must never change');
});

test('version 2 data moves to version 3 with one readable copy first; old and packed rows read alike; reports never change', async () => {
  const { directory, expected } = version2('pack-upgrade');
  try {
    let store = new Store(directory, []);
    // Version 3 (packed rows); 4 comes only with the first year package (server/year-packer.ts).
    assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 3); assert.equal(DATA_VERSION, 4);
    // The copy is version 2 and opens as it was; it is taken once.
    assert.equal(siblings(directory, 'v2-').length, 1);
    const copy = join(dirname(directory), siblings(directory, 'v2-')[0]);
    assert.ok(existsSync(join(copy, 'development.key')) && existsSync(join(copy, 'BENIOKU.txt')));
    const old = new DatabaseSync(join(copy, 'merchant.sqlite'), { readOnly: true });
    try { assert.equal(Number(old.prepare('PRAGMA user_version').get()!.user_version), 2); assert.equal((old.prepare('SELECT count(*) AS n FROM history_archives').get() as { n: number }).n, 300); } finally { old.close(); }
    // Mixed: old plain rows, plus new rows written packed from now on; everything reads the same.
    assert.equal(report(store), expected);
    const [, plainBefore] = census(store);
    fill(store, 40, Date.parse('2026-08-01T07:00:00Z'));
    const [packedMixed, plainMixed] = census(store);
    assert.ok(packedMixed >= 40 && plainMixed > 0 && plainBefore > 300, `${packedMixed} packed, ${plainMixed} plain`);
    const mixed = report(store);
    // The rewrite packs every old row and changes no figure.
    assert.equal(await store.history.compact({ sliceMs: 2, pauseMs: 0 }), true);
    assert.deepEqual(census(store)[1], 0); assert.equal(report(store), mixed);
    store.close(); store = new Store(directory, []);
    assert.equal(siblings(directory, 'v2-').length, 1, 'no second copy'); assert.equal(report(store), mixed);
    // Backups carry packed rows; creation and restore verify every one of them.
    await validateBackupDatabase(join(directory, 'merchant.sqlite'), join(directory, 'development.key'));
    store.close();
    const target = folder('pack-backup'), made = await createBackup(directory, join(target, 'b'), join(target, 'k'));
    const restored = await restoreBackup(made.directory, made.keyPath, join(target, 'r'));
    store = new Store(restored.directory, []);
    try { assert.equal(report(store), mixed); assert.deepEqual(census(store)[1], 0); } finally { store.close(); rmSync(target, { recursive: true, force: true }); }
    // A forged packed row is caught like any other.
    store = new Store(directory, []);
    const key = snapshotKey(store.db, store.key, tenant)!;
    store.db.prepare('UPDATE history_archives SET payload=? WHERE rowid=(SELECT min(rowid) FROM history_archives)').run(seal({ forged: true }, key, `archive:${tenant}:other`, true));
    store.close();
    await assert.rejects(validateBackupDatabase(join(directory, 'merchant.sqlite'), join(directory, 'development.key')));
  } finally { cleanup(directory); }
});

test('without its safety copy (a full disk) the data stays version 2 and uncompressed until the next start', () => {
  const { directory, expected } = version2('pack-nocopy', 30);
  const proto = Store.prototype as unknown as { safetyCopy: () => void }, real = proto.safetyCopy, warn = console.warn;
  try {
    const warnings: string[] = []; console.warn = (m: string) => { warnings.push(m); };
    proto.safetyCopy = () => { throw new Error('SQLITE_FULL'); };
    let store = new Store(directory, []);
    assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 2); assert.equal(store.history.packing, false);
    assert.match(warnings.join(), /kopya alınamadı/); assert.equal(siblings(directory).length, 0);
    fill(store, 10, Date.parse('2026-08-01T07:00:00Z')); assert.equal(census(store)[0], 0, 'nothing packed while version 2');
    store.close(); proto.safetyCopy = real;
    store = new Store(directory, []);
    assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 3); assert.equal(siblings(directory, 'v2-').length, 1);
    assert.notEqual(report(store), expected); store.close();
  } finally { proto.safetyCopy = real; console.warn = warn; cleanup(directory); }
});

test('an older app refuses version 3 data with a clear message (the same check guards its backup verification)', async () => {
  const directory = folder('pack-older');
  try {
    const store = new Store(directory, [tenant]); fill(store, 20); store.close();
    const db = new DatabaseSync(join(directory, 'merchant.sqlite'), { readOnly: true });
    try {
      assert.equal(assertDataVersion(db), 3);
      // The previous release read 0–2 (packages/domain/data-format.json before this change).
      assert.throws(() => assertDataVersion(db, { minReadable: 0, maxReadable: 2, writeVersion: 2 }), /Veri biçimi bu uygulamayla uyumlu değil \(veri: 3, desteklenen: 2\)/);
    } finally { db.close(); }
  } finally { cleanup(directory); }
});

test('the rewrite survives a crash in the middle: committed batches stay, nothing is lost, the next run finishes', async () => {
  const { directory, expected } = version2('pack-crash', 400);
  try {
    let store = new Store(directory, []);
    // A crash while rewriting one row late in the table: its batch rolls back as a whole.
    const late = (store.db.prepare('SELECT rowid AS r FROM history_archives ORDER BY rowid LIMIT 1 OFFSET 350').get() as { r: number }).r;
    store.db.exec(`CREATE TRIGGER crash BEFORE UPDATE ON history_archives WHEN OLD.rowid=${late} BEGIN SELECT RAISE(ABORT, 'simulated crash'); END`);
    let batches = 0;
    await assert.rejects(store.history.compact({ sliceMs: 1, pauseMs: 0, onBatch: () => batches++ }), /simulated crash/);
    assert.ok(batches > 1, `${batches} batches committed before the crash`);
    const [packed, plain] = census(store);
    assert.ok(packed > 0 && plain > 0, `${packed} packed, ${plain} plain`); assert.equal(report(store), expected);
    const mark = Number((store.db.prepare("SELECT value FROM history_meta WHERE key='packed:history_archives'").get() as { value: string }).value);
    assert.ok(mark > 0 && mark < late, 'progress mark is the last committed row');
    store.db.exec('DROP TRIGGER crash'); store.close();
    // Shutdown in the middle of a run stops cleanly at a batch boundary.
    store = new Store(directory, []);
    const halfway = store.history.compact({ sliceMs: 1, pauseMs: 1, onBatch: () => store.history.stop() });
    assert.equal(await halfway, false); store.close();
    store = new Store(directory, []);
    assert.equal(await store.history.compact({ pauseMs: 0 }), true);
    assert.deepEqual(census(store)[1], 0); assert.equal(report(store), expected);
    assert.ok(store.db.prepare("SELECT value FROM history_meta WHERE key='packed:complete'").get());
    store.close();
  } finally { cleanup(directory); }
});

test('after a full rewrite the next start gives the space back once (VACUUM), keeping every record', async () => {
  const { directory } = version2('pack-vacuum', 1500);
  try {
    let store = new Store(directory, []);
    await store.history.compact({ pauseMs: 0 }); const expected = report(store);
    // Small test data saves less than the 16 MB threshold; pretend the rewrite saved most of the file.
    store.db.prepare("UPDATE history_meta SET value=? WHERE key='packed:saved'").run(String(64 * 1024 * 1024));
    store.close();
    const size = () => statSync(join(directory, 'merchant.sqlite')).size, before = size();
    store = new Store(directory, []);
    assert.ok(size() < before * 0.8, `${before} → ${size()} bytes`); assert.equal(report(store), expected);
    assert.ok(store.db.prepare("SELECT value FROM history_meta WHERE key='vacuumed'").get());
    store.close();
    const again = size(); store = new Store(directory, []); store.close(); assert.equal(size(), again, 'only once');
  } finally { cleanup(directory); }
});
