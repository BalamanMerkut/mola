import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { businessDayEnd, deviceLabel } from '../server/sessions.js';
import { businessDay, dayStart } from '../packages/domain/business-day.js';
import { client, licensed, temp } from './merkez-fixture.js';

test('a business day ends at 05:00 Türkiye time', () => {
  // 13:00 in Istanbul → 05:00 next morning; 04:30 → 05:00 the same morning.
  assert.equal(new Date(businessDayEnd(Date.parse('2026-10-03T10:00:00Z'))).toISOString(), '2026-10-04T02:00:00.000Z');
  assert.equal(new Date(businessDayEnd(Date.parse('2026-10-03T01:30:00Z'))).toISOString(), '2026-10-03T02:00:00.000Z');
  assert.equal(new Date(businessDayEnd(Date.parse('2026-10-03T02:00:00Z'))).toISOString(), '2026-10-04T02:00:00.000Z');
  // The same day as the kasa günü and every report (one DAY_START_HOUR): a sign-in ends exactly when its business day does.
  for (let t = Date.parse('2026-10-03T00:00:00Z'); t < Date.parse('2026-10-05T00:00:00Z'); t += 17 * 60_000) {
    const end = businessDayEnd(t);
    assert.equal(businessDay(end - 1), businessDay(t)); assert.notEqual(businessDay(end), businessDay(t)); assert.equal(end, dayStart(businessDay(end)));
  }
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'), 'Android tablet · Chrome');
});

test('staff sessions survive a restart, end the next business day, and the owner signs a device out', async t => {
  const dir = temp('staff-sessions');
  let now = new Date('2026-10-03T10:00:00Z');
  let store = new Store(dir); licensed(store);
  let server: Server | undefined;
  async function start() {
    server = createServer(createApp(store, () => now));
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api`;
  }
  async function stop() { server!.closeAllConnections(); await new Promise<void>(r => server!.close(() => r())); store.close(); }
  t.after(async () => { if (server?.listening) await stop(); });
  let base = await start();
  const login = async (username: string, agent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0') => {
    const r = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': agent }, body: JSON.stringify({ username, password: DEMO_PASSWORD }) });
    assert.equal(r.status, 200);
    const cookie = r.headers.getSetCookie().find(c => c.startsWith('mola_staff='))!;
    return { cookie: cookie.split(';')[0], raw: cookie };
  };
  const me = (cookie: string) => fetch(`${base}/staff/me`, { headers: { Cookie: cookie } });
  const owner = await login('isletme'), waiter = await login('garson', 'Mozilla/5.0 (Linux; Android 14; Tab) Chrome/131.0'), kitchen = await login('mutfak');
  // HttpOnly, SameSite=Strict, and the cookie lives exactly until 05:00 next morning (16 h after 13:00 Istanbul).
  assert.match(owner.raw, /HttpOnly/); assert.match(owner.raw, /SameSite=Strict/); assert.match(owner.raw, /Max-Age=57600/);
  // Only keyed hashes of the tokens are on disk, never the tokens.
  const token = decodeURIComponent(owner.cookie.slice('mola_staff='.length));
  const rows = store.db.prepare('SELECT token, payload FROM sessions').all() as { token: string; payload: Uint8Array }[];
  assert.ok(rows.length >= 3); assert.ok(rows.every(r => r.token !== token && !Buffer.from(r.payload).includes(Buffer.from(token))));

  // Power cut: the server and its data are opened again from disk.
  await stop(); store = new Store(dir); base = await start();
  for (const s of [owner, waiter, kitchen]) assert.equal((await me(s.cookie)).status, 200, 'still signed in after a restart');

  // The owner sees the open devices and signs the waiter's tablet out.
  const ownerCall = (path: string, body?: unknown) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: owner.cookie }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json() as any }));
  const list = await ownerCall('/staff/sessions');
  assert.equal(list.status, 200);
  const tablet = list.data.find((s: { username: string }) => s.username === 'garson');
  assert.equal(tablet.device, 'Android tablet · Chrome'); assert.equal(list.data.find((s: { username: string; current: boolean }) => s.username === 'isletme').current, true);
  assert.equal((await fetch(`${base}/staff/sessions`, { headers: { Cookie: waiter.cookie } })).status, 403, 'owner only');
  assert.equal((await ownerCall('/staff/sessions/end', { id: tablet.id })).status, 200);
  assert.equal((await me(waiter.cookie)).status, 401);
  assert.equal((await me(kitchen.cookie)).status, 200);
  assert.ok(store.auditLog('mola-demo').some(a => a.action === 'staff.session_ended'));

  // Still the same business day at 04:59; from 05:00 everyone signs in again (also after another restart).
  now = new Date('2026-10-04T01:59:00Z'); assert.equal((await me(kitchen.cookie)).status, 200);
  await stop(); store = new Store(dir); base = await start();
  now = new Date('2026-10-04T02:00:00Z');
  assert.equal((await me(kitchen.cookie)).status, 401); assert.equal((await me(owner.cookie)).status, 401);
});

test('guest QR sessions survive a restart until their normal expiry', async t => {
  const dir = temp('guest-sessions');
  let now = new Date('2026-10-03T10:00:00Z');
  let store = new Store(dir); licensed(store);
  let server = createServer(createApp(store, () => now)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const guest = client(`http://127.0.0.1:${port}/api`), table = store.read('mola-demo').tables[0];
  assert.equal((await guest('/guest/session', { token: table.token })).status, 200);
  server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close();
  store = new Store(dir); server = createServer(createApp(store, () => now));
  await new Promise<void>(r => server.listen(port, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  assert.equal((await guest('/guest/state')).status, 200, 'same phone, same QR session after the restart');
  now = new Date(now.getTime() + 6 * 3600_000 + 1000);
  assert.equal((await guest('/guest/state')).status, 401, 'six hours later the QR is scanned again');
});

test('an open session count per user stays at ten; the same browser logging in again replaces its own session', async t => {
  const store = new Store(temp('session-limit')); licensed(store);
  const server = createServer(createApp(store)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const devices = Array.from({ length: 11 }, () => client(base));
  for (const d of devices) assert.equal((await d('/login', { username: 'garson', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await devices[0]('/staff/me')).status, 401, 'the oldest of eleven is signed out');
  assert.equal((await devices[1]('/staff/me')).status, 200);
  await devices[1]('/login', { username: 'garson', password: DEMO_PASSWORD });
  assert.equal((await devices[2]('/staff/me')).status, 200, 'logging in again on the same browser did not use a slot');
  assert.equal((store.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE kind='staff'").get() as { n: number }).n, 10);
});

test('installed mode never offers the demo password and tells the screens to hide developer wording', async t => {
  const store = new Store(temp('installed-mode')); licensed(store);
  const dev = createServer(createApp(store)), installed = createServer(createApp(store, undefined, undefined, { lan: false, port: 3000, mode: 'installed' }));
  for (const s of [dev, installed]) await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  t.after(async () => { for (const s of [dev, installed]) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); } store.close(); });
  const health = async (s: Server) => (await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/health`)).json() as Promise<{ mode: string; demoAvailable: boolean; demo?: unknown }>;
  const d = await health(dev), i = await health(installed);
  assert.equal(d.mode, 'development'); assert.equal(d.demoAvailable, true);
  assert.equal(i.mode, 'installed'); assert.equal(i.demoAvailable, false); assert.equal('demo' in i, false);
});
