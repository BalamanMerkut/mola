// What the desktop launchers and the installer rely on (scripts/desktop/Ortak.cs, mola-macos.sh, mola-linux.sh):
// a desktop key kept across restarts, the ownership proof, the activity count and the firewall helper routes.
import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { desktopKey, desktopProof, type Desktop } from '../server/desktop.js';

const temp = () => { mkdirSync('.local/tests', { recursive: true }); return mkdtempSync(resolve('.local/tests/launcher-')); };

test('the desktop key survives a restart; a damaged key file gets a new one', () => {
  const dir = temp(), file = join(dir, 'masaustu.anahtar');
  const first = desktopKey(file);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(desktopKey(file), first, 'a restart (watchdog, update) keeps the key, so the open window keeps its rail');
  writeFileSync(file, 'kısa');
  const second = desktopKey(file);
  assert.notEqual(second, first);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(readFileSync(file, 'utf8'), second);
});

async function proofServer(t: { after: (fn: () => Promise<void>) => void }, desktop: Desktop | undefined) {
  const server = createServer((req, res) => { if (!desktopProof(desktop, req, res)) { res.statusCode = 418; res.end(); } });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('the server proves it holds the key without revealing it', async t => {
  const token = randomBytes(32).toString('base64url');
  const root = await proofServer(t, { token, shutdown: () => {} });
  const nonce = randomBytes(16).toString('hex');
  const r = await fetch(`${root}/api/desktop/kanit?n=${nonce}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const body = await r.json() as { kanit: string };
  assert.equal(body.kanit, createHmac('sha256', token).update(`mola-masaustu-kanit:${nonce}`).digest('hex'));
  assert.ok(!JSON.stringify(body).includes(token));
  // Another nonce, another answer: a recorded answer is no use to an impostor.
  const other = await (await fetch(`${root}/api/desktop/kanit?n=${randomBytes(16).toString('hex')}`)).json() as { kanit: string };
  assert.notEqual(other.kanit, body.kanit);
  for (const bad of ['', '?n=', '?n=kisa', `?n=${'x'.repeat(129)}`, '?n=..%2F..%2Fetc%2Fpasswd%2F%2F%2F%2F']) assert.equal((await fetch(`${root}/api/desktop/kanit${bad}`)).status, 404, bad);
  assert.equal((await fetch(`${root}/api/desktop/kanit?n=${nonce}`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${root}/api/desktop/kanitx?n=${nonce}`)).status, 404);
  assert.equal((await fetch(`${root}/api/health`)).status, 418, 'every other request goes on to the app');
});

test('without a desktop key there is nothing to prove', async t => {
  const root = await proofServer(t, undefined);
  assert.equal((await fetch(`${root}/api/desktop/kanit?n=${randomBytes(16).toString('hex')}`)).status, 404);
  const dev = await proofServer(t, { token: '', loopback: () => true, shutdown: () => {} });
  assert.equal((await fetch(`${dev}/api/desktop/kanit?n=${randomBytes(16).toString('hex')}`)).status, 404);
});

test('activity and firewall routes answer only the desktop window', async t => {
  const dir = temp(), store = new Store(join(dir, 'veri'));
  const token = desktopKey(join(dir, 'masaustu.anahtar'));
  licensed(store);
  const helper = process.env.MOLA_FIREWALL_HELPER;
  delete process.env.MOLA_FIREWALL_HELPER;
  const server = createServer(createApp(store, undefined, undefined, { lan: false, port: 3000 }, undefined, undefined, undefined, undefined, { token, shutdown: () => {} }));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { if (helper !== undefined) process.env.MOLA_FIREWALL_HELPER = helper; server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, key?: string, post = false) => fetch(root + path, { method: post ? 'POST' : 'GET', headers: { ...(key ? { 'X-Mola-Desktop': key } : {}), ...(post ? { 'Content-Type': 'application/json' } : {}) }, body: post ? '{}' : undefined });
  for (const key of [undefined, 'x'.repeat(43)]) {
    assert.equal((await call('/api/desktop/activity', key)).status, 404);
    assert.equal((await call('/api/desktop/firewall', key)).status, 404);
    assert.equal((await call('/api/desktop/firewall', key, true)).status, 404);
  }
  const activity = await (await call('/api/desktop/activity', token)).json() as { openAccounts: number; pendingOrders: number };
  assert.equal(typeof activity.openAccounts, 'number');
  assert.equal(typeof activity.pendingOrders, 'number');
  // Outside the packaged Windows app (no Mola.exe helper) the window offers nothing to fix.
  assert.deepEqual(await (await call('/api/desktop/firewall', token)).json(), { supported: false });
  assert.equal((await call('/api/desktop/firewall', token, true)).status, 409);
});
