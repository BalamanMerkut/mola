import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { desktopKey } from '../server/desktop.js';

async function start(t: { after: (fn: () => Promise<void>) => void }, withDesktop: boolean) {
  mkdirSync('.local/tests', { recursive: true });
  const dir = mkdtempSync(resolve('.local/tests/desktop-'));
  const store = new Store(join(dir, 'veri'));
  let stopped = 0;
  const token = withDesktop ? desktopKey(join(dir, 'masaustu.anahtar')) : '';
  licensed(store); const app = createApp(store, undefined, undefined, { lan: false, port: 3000 }, undefined, undefined, undefined, undefined, withDesktop ? { token, shutdown: () => { stopped++; } } : undefined);
  const server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, key?: string, post = false) => {
    const r = await fetch(root + path, { method: post ? 'POST' : 'GET', headers: { ...(key === undefined ? {} : { 'X-Mola-Desktop': key }), ...(post ? { 'Content-Type': 'application/json' } : {}) }, body: post ? '{}' : undefined });
    return { status: r.status, data: await r.json() };
  };
  return { dir, token, call, stopped: () => stopped };
}

test('desktop key is random, private to the user and long enough', async t => {
  const { dir, token } = await start(t, true);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(readFileSync(join(dir, 'masaustu.anahtar'), 'utf8'), token);
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'masaustu.anahtar')).mode & 0o077, 0);
  assert.notEqual(desktopKey(join(dir, 'other.anahtar')), token);
});

test('desktop tools answer only the desktop window holding the key', async t => {
  const { token, call, stopped } = await start(t, true);
  for (const key of [undefined, '', 'x'.repeat(43), token.slice(1)]) {
    assert.equal((await call('/api/desktop/status', key)).status, 404);
    assert.equal((await call('/api/desktop/shutdown', key, true)).status, 404);
  }
  assert.equal(stopped(), 0);
  const status = await call('/api/desktop/status', token);
  assert.equal(status.status, 200);
  assert.deepEqual(status.data.addresses, []);
  assert.equal(status.data.lan, false);
  assert.equal(status.data.backup.enabled, false);
  assert.equal((await call('/api/desktop/backup', token, true)).status, 409);
  assert.equal((await call('/api/desktop/shutdown', token, true)).status, 200);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(stopped(), 1);
});

test('development mode shows the rail only to this computer', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(join(mkdtempSync(resolve('.local/tests/desktop-')), 'veri'));
  let local = true;
  licensed(store); const server = createServer(createApp(store, undefined, undefined, { lan: true, port: 3000 }, undefined, undefined, undefined, undefined, { token: '', loopback: () => local, shutdown: () => {} }));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await (await fetch(root + '/api/health')).json()).desktop, true);
  assert.equal((await fetch(root + '/api/desktop/status')).status, 200);
  local = false;
  assert.equal((await (await fetch(root + '/api/health')).json()).desktop, undefined);
  assert.equal((await fetch(root + '/api/desktop/status')).status, 404);
  // An empty key must never match an empty header.
  assert.equal((await fetch(root + '/api/desktop/status', { headers: { 'X-Mola-Desktop': '' } })).status, 404);
});

test('without the desktop app the routes do not exist', async t => {
  const { call } = await start(t, false);
  assert.equal((await call('/api/desktop/status', 'x'.repeat(43))).status, 404);
  assert.equal((await call('/api/desktop/shutdown', '', true)).status, 404);
});
