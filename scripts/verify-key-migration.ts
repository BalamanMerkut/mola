import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Store, readSnapshot } from '../server/store.js';
import { dataLock } from '../server/data-lock.js';

// Run on a restored copy first; requires the server for this directory to be stopped.
const source = process.argv[2];
if (!source) throw new Error('Kullanım: tsx scripts/verify-key-migration.ts <geri-yüklenen-veri-klasörü>');
const directory = resolve(source), release = dataLock(directory, 'verify-key-migration');
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  const before = new Map<string, string>();
  const key = readFileSync(join(directory, 'development.key'));
  const db = new DatabaseSync(join(directory, 'merchant.sqlite'), { readOnly: true });
  try { for (const row of db.prepare('SELECT tenant,payload FROM snapshots').all() as { tenant: string; payload: Uint8Array }[]) before.set(row.tenant, digest(readSnapshot(db, key, row.tenant, row.payload))); } finally { db.close(); }
  const store = new Store(directory, []);
  try {
    for (const [tenant, hash] of before) assert.equal(digest(store.read(tenant)), hash, 'Geçiş işletme içeriğini değiştirdi.');
    assert.equal(store.db.prepare('SELECT count(*) as n FROM tenant_keys').get()!.n, before.size);
    console.log(JSON.stringify({ verified: true, businesses: before.size, contentsUnchanged: true, mode: 'local-wrapped-tenant-keys-not-e2e' }));
  } finally { store.close(); }
} finally { release(); }
