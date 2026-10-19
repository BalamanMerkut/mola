import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { busyText } from '../packages/domain/update-busy.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { desktopKey } from '../server/desktop.js';
import { licensed } from './merkez-fixture.js';

test('busyText: says what waits', () => {
  assert.equal(busyText({ openAccounts: 0, pendingOrders: 0 }), '');
  assert.equal(busyText({ openAccounts: 2, pendingOrders: 1 }), '2 açık masa ve 1 bitmemiş sipariş');
  assert.equal(busyText({ openAccounts: 1, pendingOrders: 3, qrApprovals: 1, platformWaiting: 1 }), '1 açık masa, 1 bitmemiş sipariş, 1 onay bekleyen QR siparişi ve 1 Kabul bekleyen paket servis siparişi');
  assert.equal(busyText({ openAccounts: 0, pendingOrders: 1, platformWaiting: 1 }), '1 Kabul bekleyen paket servis siparişi');
});

// 19 Ekim (owner): "ödemeyi aldım, mutfakta sipariş yok" but the update still said "bitmemiş sipariş var". A paid table's order
// the kitchen never marked, and finished platform orders (kept 48 hours), held the update.
test('activity: a paid table and finished platform orders do not hold an update; open work does', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const dir = mkdtempSync(resolve('.local/tests/update-busy-')), store = new Store(join(dir, 'veri'));
  const token = desktopKey(join(dir, 'masaustu.anahtar'));
  licensed(store);
  const server = createServer(createApp(store, undefined, undefined, { lan: false, port: 3000 }, undefined, undefined, undefined, undefined, { token, shutdown: () => {} }));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const activity = async () => await (await fetch(`${root}/api/desktop/activity`, { headers: { 'X-Mola-Desktop': token } })).json() as Record<string, number>;
  const tenant = (store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[])[0].tenant;
  const set = (accounts: unknown[], orders: unknown[], externalOrders: unknown[]) => store.mutate(tenant, s => { Object.assign(s, { accounts, orders, externalOrders }); });

  // Paid (closed) table whose order is still "new" in the kitchen, and finished platform orders: nothing waits.
  set([{ id: 'a1', status: 'closed' }], [{ id: 'o1', accountId: 'a1', status: 'new' }], [{ stage: 'accepted' }, { stage: 'rejected' }, { stage: 'missed' }, { stage: 'cancelled' }]);
  assert.deepEqual(await activity(), { openAccounts: 0, pendingOrders: 0, qrApprovals: 0, platformWaiting: 0 });

  // An open table with an order in the kitchen, a QR order waiting for the waiter, a platform order waiting for Kabul.
  set([{ id: 'a1', status: 'closed' }, { id: 'a2', status: 'open' }], [{ id: 'o1', accountId: 'a1', status: 'ready' }, { id: 'o2', accountId: 'a2', status: 'preparing' }, { id: 'o3', accountId: 'a2', status: 'awaiting_approval' }, { id: 'o4', accountId: 'a2', status: 'served' }], [{ stage: 'pending' }, { stage: 'accepted' }]);
  assert.deepEqual(await activity(), { openAccounts: 1, pendingOrders: 3, qrApprovals: 1, platformWaiting: 1 });
});
