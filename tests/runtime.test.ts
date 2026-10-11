import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startLocalServer } from '../server/runtime.js';
import { Store } from '../server/store.js';

test('startup failure releases only its own lock and the same directory can restart', async () => {
  mkdirSync('.local/tests', { recursive: true }); const directory = mkdtempSync(resolve('.local/tests/runtime-'));
  const occupied = createServer(); occupied.listen(0, '127.0.0.1'); await once(occupied, 'listening');
  const port = (occupied.address() as AddressInfo).port;
  const options = { directory, port, host: '127.0.0.1' as const, serveBuild: true, cleanInstall: true };
  try { await assert.rejects(startLocalServer(options), /portu başka/); } finally { await new Promise<void>(r => occupied.close(() => r())); }
  assert.equal(existsSync(join(directory, '.mola-operation.lock')), false);
  const runtime = await startLocalServer(options);
  try {
    const lock = readFileSync(join(directory, '.mola-operation.lock'), 'utf8');
    await assert.rejects(startLocalServer(options), /kullanımda/);
    assert.equal(readFileSync(join(directory, '.mola-operation.lock'), 'utf8'), lock);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
  } finally { await Promise.all([runtime.close(), runtime.close()]); }
  assert.equal(existsSync(join(directory, '.mola-operation.lock')), false);
  const store = new Store(directory, []); store.close();
  await assert.rejects(startLocalServer({ ...options, port: -1 }), /Port/);
  assert.equal(existsSync(join(directory, '.mola-operation.lock')), false);
});

test('shutdown drains an accepted request before releasing database ownership', async () => {
  mkdirSync('.local/tests', { recursive: true }); const directory = mkdtempSync(resolve('.local/tests/runtime-drain-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as AddressInfo).port; await new Promise<void>(r => probe.close(() => r()));
  const runtime = await startLocalServer({ directory, port, host: '127.0.0.1', serveBuild: true, cleanInstall: true });
  const accepted = once(runtime.server, 'request');
  const req = request(`http://127.0.0.1:${port}/api/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '2' } });
  const response = new Promise<number | undefined>((done, reject) => { req.on('response', res => { res.resume(); res.on('end', () => done(res.statusCode)); }); req.on('error', reject); });
  try {
    req.write('{'); await accepted;
    let closed = false; const closing = runtime.close().then(() => { closed = true; });
    await new Promise<void>(r => setImmediate(r));
    assert.equal(closed, false); assert.ok(existsSync(join(directory, '.mola-operation.lock')));
    req.end('}'); assert.equal(await response, 200); await closing;
    assert.equal(existsSync(join(directory, '.mola-operation.lock')), false);
  } finally { req.destroy(); await runtime.close(); }
});

test('a lock left behind by a process that no longer exists is removed on start; a live or unreadable lock is respected', async () => {
  const { dataLock, staleLock } = await import('../server/data-lock.js');
  const { mkdtempSync: temp, writeFileSync: write, mkdirSync: mk } = await import('node:fs');
  const { resolve: res, join: j } = await import('node:path');
  mk('.local/tests', { recursive: true });
  const dir = temp(res('.local/tests/stale-lock-')), lock = j(dir, '.mola-operation.lock');
  write(lock, JSON.stringify({ token: 'x', pid: 2147483646, purpose: 'server', createdAt: new Date().toISOString() }));
  assert.equal(staleLock(lock), true);
  const release = dataLock(dir, 'server'); release();
  write(lock, JSON.stringify({ token: 'y', pid: process.pid, purpose: 'server' }));
  assert.equal(staleLock(lock), false); assert.throws(() => dataLock(dir, 'server'), /kullanımda/);
  write(lock, 'not json'); assert.throws(() => dataLock(dir, 'server'), /kullanımda/);
});
