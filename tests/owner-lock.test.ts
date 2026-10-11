import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { lockMinutes, lockedWhileAllowed, OWNER_LOCK_DEFAULT } from '../server/owner-lock.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * Sahip hesabı otomatik kilit (server/owner-lock.ts): an owner session locks after N minutes without the person's activity
 * (requests marked X-Mola-Activity), background polling never keeps it open nor unlocks it, a locked session gets 423 on
 * everything but the floor's polling and the lock itself, the password (on the login limiter) unlocks it; "Kilitle" locks
 * at once; Müdür and other staff are never locked; Kapalı turns it off.
 */
type Answer = { status: number; data: any; locked: boolean };
const MANAGER = 'MudurDeneme!2026';
async function cafe(t: { after: (fn: () => Promise<void>) => void }) {
  const store = new Store(temp('owner-lock')); licensed(store);
  let clock = new Date('2026-10-05T08:00:00Z');
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client(username: string, password = DEMO_PASSWORD) {
    let cookie = '';
    /** `active`: the person just tapped (the screens send X-Mola-Activity then); polling does not. */
    const call = async (path: string, body?: unknown, active = false): Promise<Answer> => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(active ? { 'X-Mola-Activity': '1' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
      return { status: r.status, data: r.status === 204 ? {} : await r.json().catch(() => ({})), locked: r.headers.get('X-Mola-Locked') === '1' };
    };
    return Object.assign(call, { login: () => call('/login', { username, password }) });
  }
  const owner = client('isletme'), cashier = client('kasiyer');
  for (const c of [owner, cashier]) assert.equal((await c.login()).status, 200);
  assert.equal((await owner('/staff/users', { username: 'mudur', name: 'Müdür Mehmet', role: 'manager', password: MANAGER }, true)).status, 200);
  const manager = client('mudur', MANAGER); assert.equal((await manager.login()).status, 200);
  return { store, owner, manager, cashier, client, pass: (minutes: number) => { clock = new Date(clock.getTime() + minutes * 60_000); } };
}

test('owner lock: setting values, default 10, what stays open while locked', () => {
  assert.equal(OWNER_LOCK_DEFAULT, 10);
  assert.equal(lockMinutes({}), 10); assert.equal(lockMinutes({ ownerLockMinutes: 5 }), 5); assert.equal(lockMinutes({ ownerLockMinutes: 30 }), 30);
  assert.equal(lockMinutes({ ownerLockMinutes: 0 }), 0, 'Kapalı'); assert.equal(lockMinutes({ ownerLockMinutes: 7 }), 10, 'an odd value falls back');
  for (const [m, p] of [['GET', '/staff/state'], ['POST', '/staff/heartbeat'], ['POST', '/staff/unlock'], ['GET', '/staff/lock'], ['POST', '/staff/lock']]) assert.equal(lockedWhileAllowed(m, p), true, `${m} ${p}`);
  for (const [m, p] of [['GET', '/staff/users'], ['GET', '/staff/reports/overview'], ['POST', '/staff/settings'], ['POST', '/staff/lock/settings'], ['POST', '/staff/activity'], ['GET', '/staff/remote-reports'], ['POST', '/staff/payments']]) assert.equal(lockedWhileAllowed(m, p), false, `${m} ${p}`);
});

test('idle → locked → polling neither keeps it open nor unlocks it → the password unlocks; 423 while locked; staff never locked', async t => {
  const { owner, manager, cashier, pass } = await cafe(t);
  // Ayarlar: 5 / 10 / 30 / Kapalı, owner only.
  assert.equal((await owner('/staff/lock/settings', { minutes: 7 }, true)).status, 400);
  assert.equal((await manager('/staff/lock/settings', { minutes: 0 }, true)).status, 403);
  assert.equal((await cashier('/staff/lock/settings', { minutes: 0 }, true)).status, 403);
  const set = await owner('/staff/lock/settings', { minutes: 10 }, true);
  assert.equal(set.status, 200); assert.deepEqual([set.data.locked, set.data.minutes, set.data.choices], [false, 10, [5, 10, 30, 0]]);
  // A tap at minute 9 keeps it open; polling alone (state every few seconds, heartbeat) does not count.
  pass(9); assert.equal((await owner('/staff/users', undefined, true)).status, 200);
  for (let i = 0; i < 9; i++) { pass(1); assert.equal((await owner('/staff/state')).status, 200); assert.equal((await owner('/staff/heartbeat', {})).status, 200); }
  assert.equal((await owner('/staff/users')).status, 200, '9 minutes since the last tap');
  pass(1.5);
  // Locked: the floor still polls (and rings), every answer says "locked", owner data and actions are 423.
  const state = await owner('/staff/state');
  assert.equal(state.status, 200); assert.equal(state.locked, true);
  for (const path of ['/staff/users', '/staff/sessions', '/staff/remote-reports', '/staff/report-security', '/staff/backup-status']) {
    const r = await owner(path); assert.equal(r.status, 423, path); assert.equal(r.data.code, 'SESSION_LOCKED', path); assert.equal(r.locked, true);
  }
  for (const [path, body] of [['/staff/settings', { waiterApproval: true }], ['/staff/lock/settings', { minutes: 0 }], ['/staff/activity', {}]] as const) assert.equal((await owner(path, body, true)).status, 423, path);
  assert.equal((await owner('/staff/heartbeat', {})).status, 200);
  assert.equal((await owner('/staff/lock')).data.locked, true);
  // Polling, even right after a tap on the lock screen, does not unlock.
  for (let i = 0; i < 3; i++) { pass(1); assert.equal((await owner('/staff/state', undefined, true)).locked, true); }
  assert.equal((await owner('/staff/users', undefined, true)).status, 423);
  // Müdür, kasiyer: never locked, however long.
  for (const who of [manager, cashier]) { const r = await who('/staff/state'); assert.equal(r.status, 200); assert.equal(r.locked, false); }
  assert.equal((await manager('/staff/stock')).status, 200);
  // The password: wrong ones are refused (and counted), the right one unlocks.
  const none = await owner('/staff/unlock', {}, true); assert.equal(none.data.code, 'PASSWORD_REQUIRED');
  const wrong = await owner('/staff/unlock', { password: 'yanlis-sifre' }, true); assert.equal(wrong.status, 403); assert.equal(wrong.data.code, 'INVALID_PASSWORD');
  assert.equal((await owner('/staff/users')).status, 423);
  assert.equal((await manager('/staff/unlock', { password: MANAGER }, true)).status, 403, 'not for the Müdür');
  const opened = await owner('/staff/unlock', { password: DEMO_PASSWORD }, true);
  assert.equal(opened.status, 200, JSON.stringify(opened.data)); assert.equal(opened.data.locked, false);
  const users = await owner('/staff/users'); assert.equal(users.status, 200); assert.equal(users.locked, false);
});

test('"Kilitle" locks at once; the unlock password is on the login limiter; Kapalı never locks', async t => {
  const { owner, manager, client, pass } = await cafe(t);
  assert.equal((await manager('/staff/lock', {}, true)).status, 403, 'the Müdür has no owner lock');
  const locked = await owner('/staff/lock', {}, true);
  assert.equal(locked.status, 200); assert.equal(locked.data.locked, true);
  assert.equal((await owner('/staff/users', undefined, true)).status, 423);
  // Twelve wrong passwords: then even the right one waits, and so does the login (the same counters).
  for (let i = 0; i < 12; i++) assert.equal((await owner('/staff/unlock', { password: `yanlis-${i}` }, true)).data.code, 'INVALID_PASSWORD');
  assert.equal((await owner('/staff/unlock', { password: DEMO_PASSWORD }, true)).status, 429);
  assert.equal((await client('isletme').login()).status, 429);
  pass(1.1);
  assert.equal((await owner('/staff/unlock', { password: DEMO_PASSWORD }, true)).status, 200);
  // Logging out works while locked (the page offers "Çıkış yap" on the lock screen).
  await owner('/staff/lock', {}, true);
  assert.equal((await owner('/logout', {})).status, 200);
  assert.equal((await owner('/staff/state')).status, 401);
  // Kapalı: hours without a tap, still open.
  assert.equal((await owner.login()).status, 200);
  assert.equal((await owner('/staff/lock/settings', { minutes: 0 }, true)).data.minutes, 0);
  pass(120);
  assert.equal((await owner('/staff/users')).status, 200);
  // Back to 5 minutes: counted from the last tap.
  assert.equal((await owner('/staff/lock/settings', { minutes: 5 }, true)).data.minutes, 5);
  pass(4); assert.equal((await owner('/staff/users')).status, 200);
  pass(1); assert.equal((await owner('/staff/users')).status, 423);
});
