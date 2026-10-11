import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

test('sessions use tenant-scoped account records, revoke changed accounts and expire when the business day ends', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/session-directory-')));
  let now = new Date('2026-09-26T10:00:00Z');
  licensed(store); const server = createServer(createApp(store, () => now));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  async function login(username: string) {
    const res = await fetch(base + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'MolaDemo!2026' }) });
    assert.equal(res.status, 200);
    return res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  }
  const me = (cookie: string) => fetch(base + '/staff/me', { headers: { Cookie: cookie } });
  const waiter = await login('garson'), owner = await login('isletme'), other = await login('diger');
  assert.equal(store.sessionUser('other-demo', 'garson'), undefined);
  assert.equal(store.sessionUser('missing', 'garson'), undefined);
  assert.deepEqual(Object.keys(store.sessionUser('mola-demo', 'garson')!).sort(), ['active', 'id', 'role', 'username', 'version']);
  const read = store.read;
  store.read = () => { throw new Error('Session must not open business records'); };
  try {
    const res = await me(waiter);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { role: 'waiter', username: 'garson' });
    assert.equal((await me(other)).status, 200);
  } finally { store.read = read; }
  store.mutate('mola-demo', s => { s.staffUsers!.find(u => u.id === 'garson')!.version++; });
  assert.equal((await me(waiter)).status, 401);
  assert.equal((await me(owner)).status, 200);
  assert.equal((await me(other)).status, 200);
  const next = await login('garson');
  // Even a malformed role change without a version bump must not upgrade an old session.
  store.mutate('mola-demo', s => { s.staffUsers!.find(u => u.id === 'garson')!.role = 'cashier'; });
  assert.equal((await me(next)).status, 401);
  const cashier = await login('garson');
  store.mutate('mola-demo', s => { s.staffUsers!.find(u => u.id === 'garson')!.active = false; });
  assert.equal((await me(cashier)).status, 401);
  store.mutate('mola-demo', s => { s.staffUsers!.find(u => u.id === 'garson')!.active = true; });
  assert.equal((await me(cashier)).status, 401);
  // Sessions now last the business day (they survive restarts); at 05:00 next morning everyone signs in again.
  now = new Date(+now + 8 * 3600_000);
  assert.equal((await me(owner)).status, 200);
  now = new Date('2026-09-27T02:00:00Z');
  assert.equal((await me(owner)).status, 401);
  assert.equal((await me(other)).status, 401);
});
