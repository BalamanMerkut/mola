import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { MerkezLink } from '../server/kafe-link.js';
import { publicKeyFrom } from '../server/license.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { MerkezStore } from '../server/merkez/store.js';
import { seal, Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { MERKEZ_PASSWORD, client, temp } from './merkez-fixture.js';

function run(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; out: string }>(done => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/merkez-import.ts', ...args], { env: { ...process.env, ...env } });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    child.on('exit', code => done({ code, out }));
  });
}

test('migration: a data folder from before the split keeps opening and, once imported, keeps its businesses, licences and support history', async t => {
  const dir = temp('legacy-import'), cafe = join(dir, 'kafe');
  const now = Date.now(), day = 86400000;
  // A café folder as the old version left it: two businesses and the in-process platform record (licences, tickets).
  let store = new Store(cafe);
  store.mutate('mola-demo', s => { s.name = 'Eski Kafe'; }); store.mutate('other-demo', s => { s.name = 'Askıdaki Kafe'; });
  const legacy = { admin: { salt: 'x', hash: 'y' }, audit: [], notifications: [], requests: {},
    licenses: [
      { tenantId: 'mola-demo', name: 'Eski Kafe', endsAt: new Date(now + 40 * day).toISOString(), suspended: false, kind: 'subscription', planMonths: 12, service: 'menu', freezes: [{ id: 'f1', reason: 'Tadilat', startDate: '2026-01-10', days: 5, requestedAt: '2026-01-01T10:00:00.000Z', status: 'rejected', decision: 'Tarih uygun değil', decidedAt: '2026-01-02T10:00:00.000Z' }], createdAt: '2025-12-01T10:00:00.000Z' },
      { tenantId: 'other-demo', name: 'Askıdaki Kafe', endsAt: new Date(now + 10 * day).toISOString(), suspended: true, kind: 'subscription', planMonths: 1 },
    ],
    tickets: [{ id: randomUUID(), tenantId: 'mola-demo', subject: 'Eski talep', status: 'closed', createdAt: '2026-01-05T10:00:00.000Z', messages: [{ id: randomUUID(), source: 'business', text: 'Yardım', at: '2026-01-05T10:00:00.000Z' }, { id: randomUUID(), source: 'support', text: 'Çözüldü', at: '2026-01-05T11:00:00.000Z' }] }] };
  store.db.exec('CREATE TABLE IF NOT EXISTS platform (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)');
  const sealed = seal(legacy, store.key, 'platform');
  store.db.prepare('INSERT INTO platform VALUES (1,?)').run(sealed);
  // It still opens in the Kafe role; without activation the menus are closed and the first screen asks to activate.
  const app = createServer(createApp(store));
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const kafe = client(`http://127.0.0.1:${(app.address() as AddressInfo).port}/api`);
  assert.equal((await kafe('/health')).data.activation, 'activate');
  assert.equal((await kafe('/activation')).data.existingData, true);
  assert.equal((await kafe('/guest/session', { token: store.read('mola-demo').tables[0].token })).data.code, 'MENU_UNAVAILABLE');
  app.closeAllConnections(); await new Promise<void>(r => app.close(() => r())); store.close();

  const merkezStore = new MerkezStore(join(dir, 'merkez'), randomBytes(32), { initialPassword: MERKEZ_PASSWORD });
  const merkez = createServer(createMerkezApp(merkezStore)); await new Promise<void>(r => merkez.listen(0, '127.0.0.1', r));
  t.after(async () => { merkez.closeAllConnections(); await new Promise<void>(r => merkez.close(() => r())); merkezStore.close(); });
  const url = `http://127.0.0.1:${(merkez.address() as AddressInfo).port}`;
  const env = { MOLA_MERKEZ_PUBLIC_KEY: merkezStore.publicKey, MOLA_AUTO_BACKUP: '0' };
  const result = await run([cafe, '--merkez', url, '--password', MERKEZ_PASSWORD], env);
  assert.equal(result.code, 0, result.out); assert.match(result.out, /2 işletme Mola Merkez’e kaydedildi/);
  // A second run changes nothing.
  const again = await run([cafe, '--merkez', url, '--password', MERKEZ_PASSWORD], env);
  assert.notEqual(again.code, 0); assert.match(again.out, /zaten Mola Merkez’e bağlı/);

  store = new Store(cafe, []);
  try {
    const link = new MerkezLink(store, { url, publicKey: publicKeyFrom(merkezStore.publicKey) });
    assert.equal(link.state(), 'ready');
    const first = link.license('mola-demo')!, second = link.license('other-demo')!;
    assert.equal(first.endsAt, legacy.licenses[0].endsAt); assert.equal(first.service, 'menu'); assert.equal(first.planMonths, 12); assert.equal(first.freezes![0].status, 'rejected');
    assert.equal(second.suspended, true); assert.equal(second.planMonths, 1);
    assert.equal(link.active('mola-demo'), true); assert.equal(link.menuOnly('mola-demo'), true); assert.equal(link.active('other-demo'), false);
    assert.deepEqual(link.tickets('mola-demo').map(x => x.subject), ['Eski talep']);
    // Merkez has the same ids, the licences and the history; the old record is still there, untouched.
    const registry = merkezStore.read();
    assert.deepEqual(registry.businesses.map(b => [b.tenantId, b.name, b.source]).sort(), [['mola-demo', 'Eski Kafe', 'import'], ['other-demo', 'Askıdaki Kafe', 'import']]);
    assert.equal(registry.tickets.length, 1);
    assert.deepEqual(Buffer.from((store.db.prepare('SELECT payload FROM platform WHERE id=1').get() as { payload: Uint8Array }).payload), sealed);
    // The first heartbeat works with the imported credentials.
    assert.equal((await link.sync()).ok, true);
  } finally { store.close(); }
});
