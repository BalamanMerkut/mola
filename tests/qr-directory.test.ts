import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

function temp() { mkdirSync('.local/tests', { recursive: true }); return mkdtempSync(resolve('.local/tests/qr-directory-')); }

test('QR index follows renewal/removal atomically and rebuilds without changing printed tokens', () => {
  const dir = temp(); let store = new Store(dir);
  try {
    const first = store.read('mola-demo').tables[0], other = store.read('other-demo').tables[0];
    assert.deepEqual(store.findTable(first.token), { tenantId: 'mola-demo', tableId: first.id });
    const rows = store.db.prepare('SELECT token FROM table_qr_lookup').all() as { token: string }[];
    assert.ok(rows.every(r => /^[a-f0-9]{64}$/.test(r.token) && r.token !== first.token));
    // An ordinary change must not rewrite the QR index.
    store.db.exec("CREATE TRIGGER reject_qr_write BEFORE DELETE ON table_qr_lookup BEGIN SELECT RAISE(ABORT, 'unnecessary rewrite'); END");
    store.mutate('mola-demo', s => { s.name = 'Updated name'; });
    store.db.exec('DROP TRIGGER reject_qr_write');
    store.db.exec("CREATE TRIGGER reject_qr_snapshot BEFORE UPDATE ON snapshots BEGIN SELECT RAISE(ABORT, 'failure'); END");
    assert.throws(() => store.mutate('mola-demo', s => { s.tables[0].token = 'renewed-token-123'; }));
    assert.ok(store.findTable(first.token)); assert.equal(store.findTable('renewed-token-123'), undefined);
    store.db.exec('DROP TRIGGER reject_qr_snapshot');
    assert.throws(() => store.mutate('mola-demo', s => { s.tables[0].token = other.token; }));
    assert.equal(store.findTable(other.token)!.tenantId, 'other-demo');
    store.mutate('mola-demo', s => { s.tables[0].token = 'renewed-token-123'; });
    assert.equal(store.findTable(first.token), undefined); assert.ok(store.findTable('renewed-token-123'));
    store.mutate('mola-demo', s => { s.tables = s.tables.filter(t => t.id !== first.id); });
    assert.equal(store.findTable('renewed-token-123'), undefined);
    const before = store.read('mola-demo');
    store.db.exec('DROP TABLE table_qr_lookup'); store.close(); store = new Store(dir);
    assert.deepEqual(store.read('mola-demo'), before);
    assert.equal(store.findTable(other.token)!.tenantId, 'other-demo');
  } finally { store.close(); }
});

test('QR session opens only its own business and rejects a redirected lookup', async t => {
  const store = new Store(temp()), first = store.read('mola-demo').tables[0];
  licensed(store); const server = createServer(createApp(store));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/guest/session`;
  const open = (token: string) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  const originalRead = store.read.bind(store); const reads: string[] = [];
  store.read = tenant => { reads.push(tenant); return originalRead(tenant); };
  const other = store.db.prepare('SELECT payload FROM snapshots WHERE tenant=?').get('other-demo') as { payload: Uint8Array };
  store.db.prepare('UPDATE snapshots SET payload=? WHERE tenant=?').run(randomBytes(50), 'other-demo');
  assert.equal((await open(first.token)).status, 200);
  assert.deepEqual(reads, ['mola-demo']); reads.length = 0;
  assert.equal((await open('missing-qr-token')).status, 404); assert.deepEqual(reads, []);
  store.db.prepare('UPDATE snapshots SET payload=? WHERE tenant=?').run(other.payload, 'other-demo');
  store.db.prepare('UPDATE table_qr_lookup SET tenant=? WHERE tenant=?').run('other-demo', 'mola-demo');
  const rejected = await open(first.token);
  assert.equal(rejected.status, 404); assert.equal(rejected.headers.get('set-cookie'), null);
});
