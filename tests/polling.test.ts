import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';

test('screen polling gets 204 while the snapshot is unchanged and the new snapshot after a change', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/polling-')));
  licensed(store); const server = createServer(createApp(store));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(root + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'isletme', password: DEMO_PASSWORD }) });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const read = (tag = '') => fetch(root + '/api/staff/state', { headers: { Cookie: cookie, ...(tag ? { 'X-Mola-Tag': tag } : {}) } });

  const first = await read();
  assert.equal(first.status, 200);
  const tag = first.headers.get('X-Mola-Tag')!;
  assert.match(tag, /^[A-Za-z0-9_-]{27}$/);
  await first.json();
  const same = await read(tag);
  assert.equal(same.status, 204);
  assert.equal(await same.text(), '');
  // A wrong or missing tag always gets the full snapshot.
  assert.equal((await read('x'.repeat(27))).status, 200);

  const settings = await fetch(root + '/api/staff/settings', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ cleaningEnabled: false, changeSeconds: 90, commissionBps: null, waiterApproval: false }) });
  assert.equal(settings.status, 200);
  const changed = await read(tag);
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get('X-Mola-Tag'), tag);
  assert.equal((await changed.json()).changeSeconds, 90);

  // Errors are never turned into 204.
  assert.equal((await fetch(root + '/api/staff/state', { headers: { 'X-Mola-Tag': tag } })).status, 401);
});
