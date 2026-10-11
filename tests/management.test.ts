import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';

test('persistent accounts, revocation and setup preserve business records', async t => {
  mkdirSync('.local/tests', { recursive: true }); const directory = mkdtempSync(resolve('.local/tests/management-'));
  const store = new Store(directory); licensed(store); const server = createServer(createApp(store));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client() { let cookie = ''; return async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
    return { status: r.status, data: await r.json() as any };
  }; }
  const owner = client(), employee = client(), other = client();
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  await other('/login', { username: 'diger', password: DEMO_PASSWORD });
  let user: any;
  await t.test('create a private password hash, enforce username uniqueness and role boundary', async () => {
    const response = await owner('/staff/users', { username: 'ayse', name: 'Ayşe', role: 'waiter', password: 'AyseDeneme!2026' });
    assert.equal(response.status, 200); user = response.data;
    assert.equal('hash' in user, false); assert.equal('salt' in user, false);
    assert.equal((await owner('/staff/users', { username: 'AYSE', name: 'Tekrar', role: 'cashier', password: 'AyseDeneme!2026' })).status, 409);
    assert.equal((await owner('/staff/users', { username: 'yetkisiz', name: 'Yetkisiz', role: 'owner', password: 'AyseDeneme!2026' })).status, 400);
    assert.equal((await employee('/login', { username: 'ayse', password: 'AyseDeneme!2026' })).status, 200);
    assert.equal((await employee('/staff/users')).status, 403);
    assert.equal((await employee('/staff/setup', {})).status, 403);
    assert.equal((await employee('/staff/categories', {})).status, 403);
    assert.equal((await employee('/staff/reports/employees?from=2026-01-01&to=2026-12-31')).status, 403);
    assert.equal((await owner('/staff/reports/employees?from=invalid&to=2026-12-31')).status, 400);
    const report = await other('/staff/reports/employees?from=2026-01-01&to=2026-12-31');
    assert.equal(report.status, 200); assert.equal(report.data.rows.some((r: any) => r.name === 'Ayşe'), false);
    assert.equal((await employee('/staff/reports/financial?from=2026-01-01&to=2026-12-31')).status, 403);
    assert.equal((await owner('/staff/reports/financial?from=wrong&to=2026-12-31')).status, 400);
    const financial = await other('/staff/reports/financial?from=2026-01-01&to=2026-12-31');
    assert.equal(financial.status, 200); assert.equal(financial.data.collected, 0);
  });
  await t.test('role change and disabling revoke existing sessions immediately', async () => {
    user = (await owner('/staff/users/update', { id: user.id, version: user.version, role: 'cashier', active: true })).data;
    assert.equal((await employee('/staff/state')).status, 401);
    await employee('/login', { username: 'ayse', password: 'AyseDeneme!2026' });
    assert.equal((await employee('/staff/state')).data.role, 'cashier');
    assert.equal((await other('/staff/users/update', { id: user.id, version: user.version, role: 'waiter', active: false })).status, 404);
    user = (await owner('/staff/users/update', { id: user.id, version: user.version, role: 'cashier', active: false })).data;
    assert.equal((await employee('/staff/state')).status, 401);
    assert.equal((await employee('/login', { username: 'ayse', password: 'AyseDeneme!2026' })).status, 401);
    assert.equal((await owner('/staff/users/update', { id: 'isletme', version: 1, role: 'cashier', active: false })).status, 403);
  });
  await t.test('password reset persists and old password/session stop working', async () => {
    user = (await owner('/staff/users/update', { id: user.id, version: user.version, role: 'cashier', active: true })).data;
    await employee('/login', { username: 'ayse', password: 'AyseDeneme!2026' });
    assert.equal((await owner('/staff/users/password', { id: user.id, version: user.version, password: 'YeniSifre!2026' })).status, 200);
    assert.equal((await employee('/staff/state')).status, 401);
    assert.equal((await employee('/login', { username: 'ayse', password: 'AyseDeneme!2026' })).status, 401);
    assert.equal((await employee('/login', { username: 'ayse', password: 'YeniSifre!2026' })).status, 200);
    const reopened = new Store(directory); assert.equal(reopened.findUser('ayse')!.user.version, user.version + 1); reopened.close();
    assert.equal((await employee('/staff/password', { currentPassword: 'wrong', password: 'MyNextPassword!' })).status, 400);
    assert.equal((await employee('/staff/password', { currentPassword: 'YeniSifre!2026', password: 'MyNextPassword!' })).status, 200);
    assert.equal((await employee('/staff/state')).status, 401);
    assert.equal((await employee('/login', { username: 'ayse', password: 'MyNextPassword!' })).status, 200);
  });
  await t.test('setup adds tables without resetting old QR, orders or account; rejects stale updates', async () => {
    const before = store.read('mola-demo');
    await owner('/staff/orders', { requestId: 'setup-test-order', tableId: 'table-1', expectedTotal: 3500, lines: [{ productId: 'tea', quantity: 1, selections: [] }] });
    const b = { requestId: 'setup-test-save', version: 0, name: 'Yeni Kafe', tableCount: 25, changeSeconds: 0, commissionBps: 300 };
    assert.equal((await owner('/staff/setup', b)).status, 200);
    assert.equal((await owner('/staff/setup', b)).status, 200);
    const after = store.read('mola-demo'); assert.equal(after.tables.length, 25); assert.equal(after.tables[0].token, before.tables[0].token);
    assert.equal(after.orders.length, 1); assert.ok(after.tables[0].accountId); assert.equal(after.products.length, before.products.length);
    assert.equal(after.setupCompleted, true); assert.equal(after.commissionBps, 300);
    const repeatSetup = await owner('/staff/setup', { ...b, requestId: 'setup-again-valid', version: after.businessRevision, name: 'Changed name' });
    assert.equal(repeatSetup.status, 409); assert.equal(repeatSetup.data.code, 'SETUP_COMPLETED');
    assert.equal(store.read('mola-demo').name, 'Yeni Kafe');
    assert.equal((await owner('/staff/setup', { ...b, requestId: 'setup-stale-save', name: 'Stale' })).status, 409);
    assert.equal((await owner('/staff/setup', { ...b, requestId: 'setup-less-tables', version: 1, tableCount: 5 })).status, 409);
    // The audit trail lives in its own sealed table since data version 2.
    const log = store.auditLog('mola-demo'), audit = JSON.stringify(log); assert.ok(log.some(a => a.action === 'staff.password_changed')); assert.ok(!audit.includes('Sifre')); assert.ok(!audit.includes('AyseDeneme'));
  });
  await t.test('owner adds/removes tables once, preserves QR/history and rejects busy or foreign tables', async () => {
    const before = store.read('mola-demo');
    assert.equal((await employee('/staff/tables/add', { requestId: 'not-allowed-add' })).status, 403);
    const add = { requestId: 'new-table-once' }; const added = await owner('/staff/tables/add', add);
    assert.equal(added.status, 200); assert.deepEqual((await owner('/staff/tables/add', add)).data, added.data);
    const table = store.read('mola-demo').tables.find(t => t.id === added.data.id)!;
    assert.equal((await other('/staff/tables/remove', { requestId: 'foreign-remove', tableId: table.id, epoch: 0 })).status, 404);
    assert.equal((await owner('/staff/tables/remove', { requestId: 'stale-table-remove', tableId: table.id, epoch: 1 })).status, 409);
    assert.equal((await owner('/staff/tables/remove', { requestId: 'busy-table-remove', tableId: 'table-1', epoch: 0 })).status, 409);
    // A settled account may still have kitchen work.
    store.mutate('mola-demo', s => { s.accounts[0].status = 'closed'; s.tables[0].accountId = null; });
    assert.equal((await owner('/staff/tables/remove', { requestId: 'pending-kitchen-remove', tableId: 'table-1', epoch: 0 })).status, 409);
    const remove = { requestId: 'remove-table-once', tableId: table.id, epoch: table.epoch };
    assert.equal((await owner('/staff/tables/remove', remove)).status, 200); assert.equal((await owner('/staff/tables/remove', remove)).status, 200);
    assert.equal((await client()('/guest/session', { token: table.token })).status, 404);
    const next = await owner('/staff/tables/add', { requestId: 'next-table-unique' });
    assert.notEqual(next.data.name, table.name);
    const after = store.read('mola-demo'); assert.equal(after.tables[0].token, before.tables[0].token); assert.equal(after.orders.length, before.orders.length);
    assert.equal(after.retiredTables!.length, 1);
  });
});
