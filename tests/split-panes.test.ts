import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { desktopKey, paneKey, type Desktop } from '../server/desktop.js';
import { businessDayEnd } from '../server/sessions.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * İki ekran (src/SplitView.tsx, src/pane.ts, server/sessions.ts, server/desktop.ts paneGuard): two Mola screens in the café
 * computer's window, each with its own sign-in. One cookie jar (as in the browser: every frame of the origin shares it), the
 * pane named on every call.
 */
async function start(t: { after: (fn: () => Promise<void>) => void }, desktop: 'key' | 'none' | { loopback: () => boolean }, clock?: () => Date) {
  const dir = temp('split-panes'), store = new Store(join(dir, 'veri')); licensed(store);
  const token = desktop === 'key' ? desktopKey(join(dir, 'masaustu.anahtar')) : '';
  const d: Desktop | undefined = desktop === 'key' ? { token, shutdown: () => {} } : desktop === 'none' ? undefined : { token: '', loopback: desktop.loopback, shutdown: () => {} };
  const server = createServer(createApp(store, clock, undefined, { lan: true, port: 3000 }, undefined, undefined, undefined, undefined, d));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, key = token ? paneKey(token) : '';
  // The browser's one cookie jar for this origin.
  const jar = new Map<string, string>();
  const call = async (path: string, o: { pane?: string | null; key?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const pane = o.pane === undefined ? null : o.pane;
    const headers: Record<string, string> = { ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...(pane ? { 'X-Mola-Pane': pane } : {}), ...(pane && (o.key ?? key) ? { 'X-Mola-Pane-Key': o.key ?? key } : {}), ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...o.headers };
    const r = await fetch(base + path, { method: o.body === undefined ? 'GET' : 'POST', headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    const set = r.headers.getSetCookie();
    for (const c of set) { const [pair] = c.split(';'), at = pair.indexOf('='), name = pair.slice(0, at), value = pair.slice(at + 1); if (!value || /Expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(name); else jar.set(name, value); }
    return { status: r.status, data: await r.json().catch(() => ({})) as any, set };
  };
  const login = (username: string, pane: string | null) => call('/api/login', { pane, body: { username, password: DEMO_PASSWORD } });
  return { call, login, jar, token, store, base };
}

test('two panes, two sessions: each pane has its own HttpOnly SameSite=Strict cookie; logging out of one keeps the other', async t => {
  const { call, login, jar } = await start(t, 'key');
  const left = await login('kasiyer', '1'), right = await login('mutfak', '2');
  assert.equal(left.status, 200); assert.equal(right.status, 200);
  assert.match(left.set.find(c => c.startsWith('mola_staff='))!, /HttpOnly/);
  const p2 = right.set.find(c => c.startsWith('mola_staff_p2='))!;
  assert.ok(p2, 'the right pane gets a cookie of its own'); assert.match(p2, /HttpOnly/); assert.match(p2, /SameSite=Strict/); assert.match(p2, /Path=\//);
  assert.equal(right.set.some(c => c.startsWith('mola_staff=')), false, 'the right pane never touches the left pane\'s cookie');
  assert.deepEqual([...jar.keys()].sort(), ['mola_staff', 'mola_staff_p2']);
  assert.equal((await call('/api/staff/me', { pane: '1' })).data.role, 'cashier');
  assert.equal((await call('/api/staff/me', { pane: '2' })).data.role, 'kitchen');
  // The window itself (no pane) and every tablet read mola_staff, as before.
  assert.equal((await call('/api/staff/me')).data.role, 'cashier');
  // Each pane's snapshot is its own role's: the kitchen sees no prices, the cashier gets a payment context.
  const kitchen = (await call('/api/staff/state', { pane: '2' })).data, cashier = (await call('/api/staff/state', { pane: '1' })).data;
  assert.equal(kitchen.role, 'kitchen'); assert.equal(kitchen.paymentContext, undefined); assert.equal(cashier.role, 'cashier'); assert.ok(cashier.paymentContext);
  assert.notEqual(kitchen.userId, cashier.userId);
  // Logging out on the left clears only the left cookie and session.
  const out = await call('/api/logout', { pane: '1', body: {} });
  assert.equal(out.status, 200);
  assert.ok(out.set.some(c => c.startsWith('mola_staff=;'))); assert.equal(out.set.some(c => c.startsWith('mola_staff_p2=')), false);
  assert.equal((await call('/api/staff/me', { pane: '1' })).status, 401);
  assert.equal((await call('/api/staff/me', { pane: '2' })).data.role, 'kitchen');
  // And the other way round: the right pane out, a new left sign-in untouched.
  await login('garson', '1');
  await call('/api/logout', { pane: '2', body: {} });
  assert.equal((await call('/api/staff/me', { pane: '2' })).status, 401);
  assert.equal((await call('/api/staff/me', { pane: '1' })).data.role, 'waiter');
});

test('pane mode only in the café computer\'s window: a wrong or missing key, a proxy, another pane number or no desktop app is refused', async t => {
  const { call, login, token } = await start(t, 'key');
  assert.equal((await login('kasiyer', '2')).status, 200);
  for (const o of [{ key: 'x'.repeat(43) }, { key: token }, { key: '' }]) {
    const r = await call('/api/staff/me', { pane: '2', ...o });
    assert.equal(r.status, 403, JSON.stringify(o)); assert.equal(r.data.code, 'PANE_REFUSED');
  }
  for (const pane of ['3', '0', '', 'p2']) assert.equal((await call('/api/staff/me', { pane: pane || ' ' })).status, 403, pane);
  // Through a proxy / tunnel (or anything that is not this computer directly): refused even with the right key.
  assert.equal((await call('/api/staff/me', { pane: '2', headers: { 'X-Forwarded-For': '192.168.1.40' } })).status, 403);
  // A refused pane never falls back to another session, and logging in there is refused too.
  assert.equal((await call('/api/login', { pane: '2', key: '', body: { username: 'mutfak', password: DEMO_PASSWORD } })).status, 403);
  // Guest (QR) routes do not care: no pane header from a guest.
  assert.notEqual((await call('/api/guest/session', { body: { token: 'yok-boyle-bir-qr' } })).data.code, 'PANE_REFUSED');
});

test('no desktop app (a plain server, tablets) and development seen from the network: pane mode is refused', async t => {
  const plain = await start(t, 'none');
  const r = await plain.login('kasiyer', '2');
  assert.equal(r.status, 403); assert.equal(r.data.code, 'PANE_REFUSED');
  assert.equal((await plain.login('kasiyer', null)).status, 200, 'ordinary sign-ins are unchanged');
  let local = false;
  const dev = await start(t, { loopback: () => local });
  assert.equal((await dev.login('kasiyer', '2')).status, 403, 'development, but not this computer\'s own browser');
  local = true;
  assert.equal((await dev.login('mutfak', '2')).status, 200, 'development (--masaustu) on this computer: no key needed');
  assert.equal((await dev.call('/api/staff/me', { pane: '2' })).data.role, 'kitchen');
});

test('a pane never reaches the desktop tools, even holding the desktop key; the rail fetches the panes\' key', async t => {
  const { call, token } = await start(t, 'key');
  const rail = await call('/api/desktop/pane', { headers: { 'X-Mola-Desktop': token } });
  assert.equal(rail.status, 200); assert.equal(rail.data.key, paneKey(token)); assert.notEqual(rail.data.key, token);
  assert.equal((await call('/api/desktop/pane')).status, 404, 'without the desktop key');
  for (const path of ['/api/desktop/status', '/api/desktop/pane']) assert.equal((await call(path, { pane: '1', headers: { 'X-Mola-Desktop': token } })).status, 404, path);
  assert.equal((await call('/api/desktop/shutdown', { pane: '2', body: {}, headers: { 'X-Mola-Desktop': token } })).status, 404);
  assert.equal((await call('/api/desktop/status', { headers: { 'X-Mola-Desktop': token } })).status, 200, 'the window itself still can');
});

test('CSRF and origin rules hold for panes: a foreign Origin is refused, a cross-site form cannot name a pane', async t => {
  const { call, login, jar, base } = await start(t, 'key');
  assert.equal((await login('kasiyer', '2')).status, 200);
  const foreign = await call('/api/logout', { pane: '2', body: {}, headers: { Origin: 'http://evil.example' } });
  assert.equal(foreign.status, 403); assert.equal(foreign.data.code, 'ORIGIN_REJECTED');
  assert.equal((await call('/api/staff/me', { pane: '2' })).status, 200, 'still signed in');
  const sameOrigin = await call('/api/staff/heartbeat', { pane: '2', body: {}, headers: { Origin: 'http://evil.example' } });
  assert.equal(sameOrigin.status, 403);
  // A cross-site form post can carry neither JSON nor the pane header (and SameSite=Strict keeps the cookies home anyway).
  const form = await fetch(base + '/api/logout', { method: 'POST', headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x=1' });
  assert.equal(form.status, 415);
  assert.equal((await call('/api/staff/me', { pane: '2' })).status, 200, 'still signed in');
});

test('owner idle lock, Açık oturumlar and the 05:00 end are per pane', async t => {
  let now = new Date('2026-10-03T10:00:00Z');
  const { call, login } = await start(t, 'key', () => now);
  assert.equal((await login('isletme', '1')).status, 200);
  assert.equal((await login('isletme', '2')).status, 200);
  // Two sessions of the same owner, one per pane; the list names the right pane's device.
  const list = (await call('/api/staff/sessions', { pane: '1' })).data as { device: string; current: boolean }[];
  assert.equal(list.length, 2);
  assert.ok(list.some(s => s.device.endsWith('sağ ekran') && !s.current)); assert.ok(list.some(s => s.device.endsWith('sol ekran') && s.current));
  // "Kilitle" on the right locks only the right pane's session.
  assert.equal((await call('/api/staff/lock', { pane: '2', body: {} })).status, 200);
  assert.equal((await call('/api/staff/sessions', { pane: '2' })).status, 423);
  assert.equal((await call('/api/staff/sessions', { pane: '1' })).status, 200);
  assert.equal((await call('/api/staff/lock', { pane: '1' })).data.locked, false);
  assert.equal((await call('/api/staff/unlock', { pane: '2', body: { password: DEMO_PASSWORD } })).status, 200);
  assert.equal((await call('/api/staff/sessions', { pane: '2' })).status, 200);
  // Each pane reads its own sign-in's end: a pane signed in after 05:00 lives on while the older one has ended.
  assert.equal((await call('/api/staff/state', { pane: '2' })).data.sessionEndsAt, new Date(businessDayEnd(now.getTime())).toISOString());
  now = new Date('2026-10-04T03:00:00Z');
  assert.equal((await call('/api/staff/me', { pane: '1' })).status, 401);
  assert.equal((await login('mutfak', '2')).status, 200);
  assert.equal((await call('/api/staff/me', { pane: '2' })).data.role, 'kitchen');
  assert.equal((await call('/api/staff/me', { pane: '1' })).status, 401);
});
