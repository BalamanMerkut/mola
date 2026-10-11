import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, seal } from '../server/store.js';
import { createBackup, restoreBackup } from '../server/backup.js';
import { merkezPair, temp } from './merkez-fixture.js';

test('Mola Yönetim lists each business kind from the heartbeat; "İşletme ekle" can preselect it for the first setup', async t => {
  const pair = await merkezPair('platform-sector'); t.after(() => pair.close());
  await pair.adminLogin();
  const create = (name: string, extra: object = {}) => pair.admin('/businesses', { requestId: randomUUID().replace(/-/g, ''), name, kind: 'subscription', months: 12, ...extra });
  assert.equal((await create('Yanlış Tür', { sector: 'bar' })).status, 400);
  const restaurant = (await create('Sofra Lokanta', { sector: 'restaurant' })).data;
  // The code is used on the café computer; the vendor's preselection travels with it.
  const kafe = pair.kafe();
  assert.equal((await kafe('/activation/code', { requestId: randomUUID().replace(/-/g, ''), code: restaurant.code })).status, 200);
  assert.equal((await kafe('/activation/owner', { username: 'sofra.lokanta', password: 'SectorTest!2026' })).status, 200);
  assert.equal(pair.store.read(restaurant.tenantId).sector, 'restaurant');
  // The wizard still runs; a setup that sends no kind keeps the preselection and loads its starter menu.
  await kafe('/login', { username: 'sofra.lokanta', password: 'SectorTest!2026' });
  const s = (await kafe('/staff/state')).data;
  assert.equal(s.sector, 'restaurant');
  assert.equal((await kafe('/staff/setup', { requestId: randomUUID(), version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: 60, commissionBps: null })).status, 200);
  assert.equal(pair.store.read(restaurant.tenantId).sector, 'restaurant');
  assert.equal(pair.store.read(restaurant.tenantId).takeawayEnabled, undefined, 'no counter-sales switch: masasız orders are always available');
  // A later change on the café side reaches the list with the next heartbeat.
  pair.store.mutate(restaurant.tenantId, state => { state.sector = 'dessert'; });
  await pair.link.sync();
  const list = (await pair.admin('/state')).data.businesses;
  assert.equal(list.find((l: any) => l.tenantId === restaurant.tenantId).sector, 'dessert');
  assert.equal(list.find((l: any) => l.tenantId === restaurant.tenantId).setupCompleted, true);
});

test('directory rows written before sectors still back up and restore; the server refreshes them on start', async () => {
  const dir = temp('legacy-directory'), source = join(dir, 'source');
  let store = new Store(source, ['one']);
  store.mutate('one', s => { s.sector = 'restaurant'; });
  const legacy = { ...store.directoryEntry('one') } as Partial<ReturnType<Store['directoryEntry']>>; delete legacy.sector;
  store.db.prepare('UPDATE business_directory SET payload=? WHERE tenant=?').run(seal(legacy, store.key, 'directory:one'), 'one');
  store.close();
  const backup = await createBackup(source, join(dir, 'backups'), join(dir, 'keys'));
  const restored = await restoreBackup(backup.directory, backup.keyPath, join(dir, 'restores'));
  const copy = new Store(restored.directory, []);
  try { assert.equal('sector' in copy.directoryEntry('one'), false); } finally { copy.close(); }
  store = new Store(source, []);
  try {
    store.refreshDirectory();
    assert.equal(store.directoryEntry('one').sector, 'restaurant');
    // A row that carries a different kind is stale, not legacy: the backup is refused as before.
    const wrong = { ...store.directoryEntry('one'), sector: 'dessert' };
    store.db.prepare('UPDATE business_directory SET payload=? WHERE tenant=?').run(seal(wrong, store.key, 'directory:one'), 'one');
  } finally { store.close(); }
  await assert.rejects(createBackup(source, join(dir, 'backups-2'), join(dir, 'keys-2')), /Yedekte/);
});
