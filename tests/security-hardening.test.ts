import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import type { FailureEvent } from '../server/request-diagnostics.js';
import { clientKey } from '../server/http-security.js';

async function start(t: { after: (fn: () => Promise<void>) => void }) {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/hardening-'))), events: FailureEvent[] = [];
  licensed(store); const server = createServer(createApp(store, undefined, undefined, undefined, undefined, e => events.push(e)));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(root + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: r.headers.get('content-type')?.includes('json') ? await r.json() : null, cookie: r.headers.getSetCookie()[0]?.split(';')[0] ?? '' };
  };
  const login = async (username: string) => (await call('/api/login', { username, password: DEMO_PASSWORD })).cookie;
  return { store, events, root, call, login };
}

test('wrong QR links are throttled per client and never reveal anything', async t => {
  const { call } = await start(t);
  for (let i = 0; i < 20; i++) assert.equal((await call('/api/guest/session', { token: `wrong-token-${i}` })).status, 404);
  const blocked = await call('/api/guest/session', { token: 'wrong-token-21' });
  assert.equal(blocked.status, 429); assert.equal(blocked.data.code, 'RATE_LIMIT');
});
test('a flood of QR sessions from one client is stopped before it can fill the shared pool', async t => {
  const { call, login } = await start(t);
  const owner = await login('isletme');
  const token = (await call('/api/staff/state', undefined, { Cookie: owner })).data.tables[0].token;
  let limited = 0;
  for (let i = 0; i < 125; i++) if ((await call('/api/guest/session', { token })).status === 429) limited++;
  assert.equal(limited, 5, '120 per minute per client, then 429');
});
test('kitchen never receives QR links; guests never see staff ids or printer ids', async t => {
  const { call, login, store } = await start(t);
  const kitchen = await login('mutfak');
  const state = (await call('/api/staff/state', undefined, { Cookie: kitchen })).data;
  assert.ok(state.tables.every((table: { token: string }) => table.token === ''));
  const ownerState = (await call('/api/staff/state', undefined, { Cookie: await login('isletme') })).data;
  const session = await call('/api/guest/session', { token: ownerState.tables[0].token });
  await call('/api/guest/orders', { requestId: randomUUID(), tableId: session.data.tableId, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, { 'X-Guest-Session': session.data.session, Cookie: session.cookie });
  store.mutate('mola-demo', s => { s.orders[0].reviewedBy = 'garson'; s.orders[0].printedTo = ['printer-1']; s.orders[0].cancelPrinted = true; });
  const guestState = (await call('/api/guest/state', undefined, { 'X-Guest-Session': session.data.session, Cookie: session.cookie })).data;
  assert.equal(guestState.orders.length, 1);
  for (const key of ['reviewedBy', 'printedTo', 'printFailedTo', 'cancelPrinted', 'guestId']) assert.equal(key in guestState.orders[0], false, key);
});
test('one user keeps at most ten sessions; logging in again on the same browser does not use a new slot', async t => {
  const { call, login } = await start(t);
  const cookies = [];
  for (let i = 0; i < 11; i++) cookies.push(await login('garson'));
  assert.equal((await call('/api/staff/me', undefined, { Cookie: cookies[0] })).status, 401);
  for (const c of cookies.slice(1)) assert.equal((await call('/api/staff/me', undefined, { Cookie: c })).status, 200);
  const again = (await call('/api/login', { username: 'garson', password: DEMO_PASSWORD }, { Cookie: cookies[10] })).cookie;
  assert.equal((await call('/api/staff/me', undefined, { Cookie: cookies[10] })).status, 401, 'old session of this browser is replaced');
  assert.equal((await call('/api/staff/me', undefined, { Cookie: cookies[1] })).status, 200, 'other devices keep their slot');
  assert.equal((await call('/api/staff/me', undefined, { Cookie: again })).status, 200);
});
test('only wrong passwords are counted; a correct login after a few mistakes still works', async t => {
  const { call } = await start(t);
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/login', { username: 'kasiyer', password: 'wrong-password' })).status, 401);
  assert.equal((await call('/api/login', { username: 'kasiyer', password: DEMO_PASSWORD })).status, 200);
  for (let i = 0; i < 20; i++) assert.equal((await call('/api/login', { username: 'kasiyer', password: DEMO_PASSWORD })).status, 200, 'successful logins are never throttled per user');
  for (let i = 0; i < 12; i++) await call('/api/login', { username: 'mutfak', password: 'wrong-password' });
  assert.equal((await call('/api/login', { username: 'mutfak', password: DEMO_PASSWORD })).status, 429, 'the guessing client is stopped');
});
test('client keys group IPv6 by /64 and treat IPv4-mapped addresses as IPv4', () => {
  const key = (ip: string) => clientKey({ ip, socket: {} } as never);
  assert.equal(key('203.0.113.7'), '203.0.113.7');
  assert.equal(key('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(key('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), key('2001:db8:1:2::1'));
  assert.equal(key('2001:0db8:0001:0002::5'), '2001:db8:1:2::/64');
  assert.notEqual(key('2001:db8:1:2::1'), key('2001:db8:1:3::1'));
});
test('a leaked table QR cannot pile up endless pending orders for the kitchen', async t => {
  const { call, login } = await start(t);
  const owner = await login('isletme');
  await call('/api/staff/settings', { changeSeconds: 600, commissionBps: null }, { Cookie: owner });
  const token = (await call('/api/staff/state', undefined, { Cookie: owner })).data.tables[0].token;
  const session = await call('/api/guest/session', { token });
  const order = () => call('/api/guest/orders', { requestId: randomUUID().replaceAll('-', ''), tableId: session.data.tableId, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, { 'X-Guest-Session': session.data.session, Cookie: session.cookie });
  for (let i = 0; i < 20; i++) assert.equal((await order()).status, 200);
  const blocked = await order(); assert.equal(blocked.status, 429); assert.equal(blocked.data.code, 'TOO_MANY_PENDING');
});
test('missing media is a quiet 404, not a logged server error', async t => {
  const { root, events } = await start(t);
  for (const path of [`/media/mola-demo/${randomUUID()}.webp`, '/media/mola-demo/../development.key', '/media/x/y.webp', '/media/mola-demo/']) {
    const r = await fetch(root + path); assert.equal(r.status, 404, path);
  }
  assert.equal(events.length, 0);
});
test('demo login hints are only offered to a browser on the same computer, never through a proxy', async t => {
  const { call, root } = await start(t);
  const local = (await call('/api/health')).data;
  assert.equal(local.demoAvailable, true, 'direct loopback request in tests'); assert.equal(local.demo.username, 'isletme');
  for (const headers of [{ 'X-Forwarded-For': '198.51.100.4' }, { 'CF-Connecting-IP': '198.51.100.4' }] as Record<string, string>[]) {
    const proxied = (await call('/api/health', undefined, headers)).data;
    assert.equal(proxied.demoAvailable, false, JSON.stringify(headers)); assert.equal('demo' in proxied, false);
  }
  // fetch() cannot change Host; a raw request shows what a tunnel forwarding the public domain looks like.
  const port = Number(new URL(root).port);
  // A name that is not this computer's is not answered at all (DNS rebinding guard), so no hint either.
  const viaDomain = await new Promise<{ demoAvailable?: boolean; code?: string }>((done, fail) => request({ host: '127.0.0.1', port, path: '/api/health', headers: { Host: 'kafe.example.com' } }, res => { let body = ''; res.on('data', c => { body += c; }); res.on('end', () => done(JSON.parse(body))); }).on('error', fail).end());
  assert.equal(viaDomain.code, 'HOST_REJECTED'); assert.equal(viaDomain.demoAvailable, undefined);
});
test('the owner can renew one table QR: the old link stops, the new one works, busy tables are refused, others cannot', async t => {
  const { call, login } = await start(t);
  const owner = await login('isletme'), waiter = await login('garson');
  const before = (await call('/api/staff/state', undefined, { Cookie: owner })).data.tables;
  const renew = (cookie: string) => call('/api/staff/tables/renew-qr', { requestId: randomUUID().replaceAll('-', ''), tableId: before[0].id }, { Cookie: cookie });
  assert.equal((await renew(waiter)).status, 403, 'owner only');
  assert.equal((await call('/api/staff/tables/renew-qr', { requestId: randomUUID().replaceAll('-', ''), tableId: before[0].id })).status, 401);
  const renewed = await renew(owner);
  assert.equal(renewed.status, 200); assert.equal(renewed.data.tableName, before[0].name);
  const after = (await call('/api/staff/state', undefined, { Cookie: owner })).data.tables;
  assert.notEqual(after[0].token, before[0].token); assert.equal(after[1].token, before[1].token, 'other tables keep their QR');
  assert.equal((await call('/api/guest/session', { token: before[0].token })).status, 404);
  const session = await call('/api/guest/session', { token: after[0].token }); assert.equal(session.status, 200);
  await call('/api/guest/orders', { requestId: randomUUID().replaceAll('-', ''), tableId: session.data.tableId, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, { 'X-Guest-Session': session.data.session, Cookie: session.cookie });
  const busy = await renew(owner);
  assert.equal(busy.status, 409); assert.equal(busy.data.code, 'TABLE_OPEN');
  // The vendor's old panel is gone from the café: its routes answer like any unknown address.
  assert.equal((await call('/api/platform/tables', { tenantId: 'mola-demo' })).status, 404);
});
test('printer setup only accepts raw-print ports', async t => {
  const { call, login } = await start(t);
  const owner = await login('isletme');
  const printer = (port: number) => ({ printer: { name: 'Bar', enabled: true, connection: { type: 'network', host: '192.168.1.50', port }, width: 80, charset: 'pc857', orders: true, categories: [], bill: false } });
  assert.equal((await call('/api/staff/printers', printer(22), { Cookie: owner })).status, 400);
  assert.equal((await call('/api/staff/printers', printer(9100), { Cookie: owner })).status, 200);
});
