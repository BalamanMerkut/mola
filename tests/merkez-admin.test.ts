import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import sharp from 'sharp';
import { adminMatches } from '../server/admin-auth.js';
import { DEMO_PASSWORD } from '../server/app.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { MerkezStore } from '../server/merkez/store.js';
import { totp } from '../server/totp.js';
import { client, merkezPair, temp } from './merkez-fixture.js';

const rid = () => randomUUID().replace(/-/g, '');
async function merkezOnly(name: string, now: () => Date, key = randomBytes(32), firstChange = false) {
  const dir = join(temp(name), 'merkez'), store = new MerkezStore(dir, key);
  // These tests are about later logins; the forced first change has its own test below.
  if (!firstChange) store.mutate(d => { delete d.admin.mustChange; });
  const server = createServer(createMerkezApp(store, { now })); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/merkez/admin`;
  return { dir, key, store, base, password: readFileSync(join(dir, 'merkez-first-login.txt'), 'utf8').match(/Şifre: (.+)/)![1].trim(),
    close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); } };
}

test('Mola Yönetim MFA gates login, revokes sessions, consumes codes once and survives password changes and restarts', async t => {
  let now = new Date('2026-09-26T10:00:00Z');
  const m = await merkezOnly('merkez-mfa', () => now); t.after(() => m.close());
  // A generated first password is written once for the vendor; the signing key never leaves the database.
  assert.ok(existsSync(join(m.dir, 'merkez-public-key.txt'))); assert.equal(readFileSync(join(m.dir, 'merkez-public-key.txt'), 'utf8').trim(), m.store.publicKey);
  const admin = client(m.base), other = client(m.base), guest = client(m.base), login = { username: 'admin', password: m.password };
  assert.equal((await guest('/mfa')).status, 401);
  await admin('/login', login); await other('/login', login);
  assert.equal((await admin('/mfa/setup', { password: 'wrong' })).status, 403);
  const setup = (await admin('/mfa/setup', { password: m.password })).data;
  assert.equal(setup.recoveryCodes.length, 8); assert.match(setup.uri, /issuer=Mola%20Y%C3%B6netim/);
  assert.equal((await admin('/mfa')).data.enabled, false);
  assert.equal((await other('/mfa/enable', { saved: true, code: totp(setup.secret, +now) })).status, 409);
  assert.equal((await admin('/mfa/enable', { saved: false, code: totp(setup.secret, +now) })).status, 400);
  now = new Date(+now + 61000);
  assert.equal((await admin('/mfa/enable', { saved: true, code: totp(setup.secret, +now) })).status, 200);
  assert.equal((await other('/state')).status, 401);
  assert.equal((await admin('/state')).status, 401);
  assert.equal((await guest('/login', login)).data.code, 'MFA_REQUIRED');
  assert.equal((await guest('/login', { ...login, code: totp(setup.secret, +now) })).status, 403);
  now = new Date(+now + 61000);
  const signedIn = client(m.base), code = totp(setup.secret, +now);
  assert.equal((await signedIn('/login', { ...login, code })).status, 200);
  assert.equal((await guest('/login', { ...login, code })).status, 403);
  const recovered = client(m.base);
  assert.equal((await recovered('/login', { ...login, code: setup.recoveryCodes[0] })).status, 200);
  assert.equal((await guest('/login', { ...login, code: setup.recoveryCodes[0] })).status, 403);
  assert.equal((await recovered('/mfa')).data.recoveryRemaining, 7);
  const state = JSON.stringify((await recovered('/state')).data);
  assert.equal(state.includes(setup.secret), false); assert.equal(state.includes(setup.recoveryCodes[0]), false);
  assert.ok(m.store.read().admin.mfa);
  const newPassword = 'ChangedMerkez!2026';
  assert.equal((await recovered('/password', { currentPassword: m.password, newPassword })).status, 200);
  assert.equal((await signedIn('/state')).status, 401);
  assert.equal((await guest('/login', { username: 'admin', password: newPassword })).data.code, 'MFA_REQUIRED');
  assert.equal((await recovered('/login', { username: 'admin', password: newPassword, code: setup.recoveryCodes[1] })).status, 200);
  assert.equal((await recovered('/mfa/disable', { password: newPassword, code: setup.recoveryCodes[2] })).status, 200);
  now = new Date(+now + 61000);
  assert.equal((await guest('/login', { username: 'admin', password: newPassword })).status, 200);
  assert.equal((await guest('/mfa')).data.enabled, false);
  const actions = (await guest('/state')).data.audit.map((a: { action: string }) => a.action);
  for (const action of ['admin.mfa_enabled', 'admin.mfa_recovery_used', 'admin.password_changed', 'admin.mfa_disabled']) assert.ok(actions.includes(action), action);
});

test('admin password rotation rejects unauthorized attempts, revokes every admin session and survives a restart', async t => {
  const m = await merkezOnly('merkez-password', () => new Date());
  let closed = false; t.after(async () => { if (!closed) await m.close(); });
  const admin = client(m.base), other = client(m.base), guest = client(m.base);
  const newPassword = 'NewAdminSecret!2026', body = { currentPassword: m.password, newPassword };
  assert.equal((await guest('/password', body)).status, 401);
  for (const c of [admin, other]) assert.equal((await c('/login', { username: 'admin', password: m.password })).status, 200);
  assert.equal((await admin('/password', { ...body, currentPassword: 'wrong' })).data.code, 'INVALID_PASSWORD');
  assert.equal((await admin('/password', { ...body, newPassword: m.password })).data.code, 'SAME_PASSWORD');
  assert.equal((await admin('/password', { ...body, newPassword: 'short' })).status, 400);
  assert.equal((await admin('/password', body)).status, 200);
  assert.equal((await admin('/state')).status, 401); assert.equal((await other('/state')).status, 401);
  assert.equal(existsSync(join(m.dir, 'merkez-first-login.txt')), false, 'the first password file goes once replaced');
  assert.equal((await other('/password', body)).status, 401);
  assert.equal((await admin('/login', { username: 'admin', password: m.password })).status, 401);
  assert.equal((await admin('/login', { username: 'admin', password: newPassword })).status, 200);
  assert.equal((await admin('/state')).data.audit.filter((a: { action: string }) => a.action === 'admin.password_changed').length, 1);
  const raw = JSON.stringify(m.store.read());
  assert.equal(raw.includes(newPassword), false); assert.equal(raw.includes(m.password), false);
  // Ten wrong passwords from one address make that address wait a minute.
  for (let i = 0; i < 10; i++) await guest('/login', { username: 'admin', password: 'yanlis' });
  assert.equal((await guest('/login', { username: 'admin', password: newPassword })).status, 429);
  await m.close(); closed = true;
  const reopened = new MerkezStore(m.dir, m.key);
  try {
    assert.equal(await adminMatches(newPassword, reopened.read().admin), true); assert.equal(await adminMatches(m.password, reopened.read().admin), false);
    assert.equal(reopened.publicKey, m.store.publicKey, 'the signing key is kept, sealed, across restarts');
  } finally { reopened.close(); }
});

test('provisioning without business data: the vendor creates, the café activates and owns its account and appearance', async t => {
  const pair = await merkezPair('readiness'); t.after(() => pair.close());
  await pair.adminLogin();
  const created = (await pair.admin('/businesses', { requestId: rid(), name: 'Yeni Kafe', kind: 'subscription', months: 12 })).data;
  const kafe = pair.kafe();
  assert.equal((await kafe('/health')).data.demoAvailable, false);
  assert.equal((await kafe('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 401, 'a clean install has no demo accounts');
  await kafe('/activation/code', { requestId: rid(), code: created.code });
  await kafe('/activation/owner', { username: 'yeni.kafe', password: 'PrivateTest!2026' });
  const tenantId = created.tenantId, original = pair.store.read(tenantId);
  assert.equal(original.orders.length, 0); assert.equal(original.staffUsers?.length, 1);
  await kafe('/login', { username: 'yeni.kafe', password: 'PrivateTest!2026' });
  // Name, logo and colours are the owner's to change now, on the café computer.
  const logo = 'data:image/png;base64,' + (await sharp({ create: { width: 400, height: 400, channels: 4, background: '#246644' } }).png().toBuffer()).toString('base64');
  const body = { requestId: rid(), version: 0, name: 'Yeni İsim', logo, theme: 'coffee' };
  assert.equal((await kafe('/staff/business-profile', body)).status, 200);
  assert.equal((await kafe('/staff/business-profile', body)).status, 200, 'a repeated request is answered once');
  assert.equal((await kafe('/staff/business-profile', { ...body, requestId: rid() })).status, 409, 'an old version');
  assert.equal((await kafe('/staff/business-profile', { ...body, requestId: rid(), version: 1, logo: 'data:image/svg+xml;base64,AAAA' })).status, 400);
  assert.equal((await kafe('/staff/business-profile', { ...body, requestId: rid(), version: 1, theme: 'invalid' })).status, 400);
  const waiter = pair.kafe();
  const state = (await kafe('/staff/state')).data;
  assert.equal(state.theme, 'coffee'); assert.equal(state.name, 'Yeni İsim'); assert.match(state.logo, /^data:image\/webp;base64,/);
  assert.equal((await sharp(Buffer.from(state.logo.split(',')[1], 'base64')).metadata()).width, 256);
  assert.equal((await waiter('/staff/business-profile', { ...body, requestId: rid(), version: 1 })).status, 401);
  // The new name reaches Mola Yönetim with the heartbeat; the logo, the menu and the account never do.
  await pair.link.sync();
  const merkez = (await pair.admin('/state')).data, listed = merkez.businesses.find((b: any) => b.tenantId === tenantId);
  assert.equal(listed.name, 'Yeni İsim'); assert.equal(listed.logo, undefined); assert.equal(listed.products, undefined); assert.equal(listed.ownerAccount, undefined);
  assert.equal(JSON.stringify(merkez).includes('yeni.kafe'), false);
  // There is no way to reset the owner's password from Merkez any more.
  assert.equal((await pair.admin('/owner-password', { requestId: rid(), tenantId, ownerId: 'x', version: 1, adminPassword: 'x', newPassword: 'ResetOwnerSecret!2026' })).status, 404);
  assert.deepEqual(pair.store.read(tenantId).tables.map(t => t.token), original.tables.map(t => t.token));
});

test('the generated first password must be changed before anything else; older data with the first-login file is held to it too; scrypt 2^17, older hashes upgraded at login', async t => {
  // The real cost here (the fixture makes it cheap for the other tests).
  const cheap = process.env.MOLA_TEST_ADMIN_SCRYPT_N; delete process.env.MOLA_TEST_ADMIN_SCRYPT_N; t.after(() => { process.env.MOLA_TEST_ADMIN_SCRYPT_N = cheap; });
  const m = await merkezOnly('merkez-first', () => new Date(), randomBytes(32), true); t.after(() => m.close());
  const admin = client(m.base);
  assert.equal(m.store.read().admin.n, 2 ** 17); assert.equal(m.store.read().admin.mustChange, true);
  const login = await admin('/login', { username: 'admin', password: m.password });
  assert.equal(login.status, 200); assert.equal(login.data.mustChangePassword, true);
  for (const [path, body] of [['/state', undefined], ['/businesses', { requestId: rid(), name: 'Erken Kafe', kind: 'trial' }], ['/mfa/setup', { password: m.password }]] as const) {
    const r = await admin(path, body); assert.equal(r.status, 403, path); assert.equal(r.data.code, 'PASSWORD_CHANGE_REQUIRED');
  }
  assert.equal((await admin('/mfa')).status, 200, 'the security page itself opens');
  assert.equal((await admin('/password', { currentPassword: m.password, newPassword: 'IlkDegisim!2026x' })).status, 200);
  assert.equal(existsSync(join(m.dir, 'merkez-first-login.txt')), false);
  const again = await admin('/login', { username: 'admin', password: 'IlkDegisim!2026x' });
  assert.equal(again.data.mustChangePassword, undefined); assert.equal((await admin('/state')).status, 200);
  assert.equal(m.store.read().admin.mustChange, undefined);
  // An older record (2^15, no flag) with the first-login file still there: held to the change; the hash is upgraded at login.
  const dir = join(temp('merkez-old-admin'), 'merkez'), key = randomBytes(32), old = new MerkezStore(dir, key);
  const password = readFileSync(join(dir, 'merkez-first-login.txt'), 'utf8').match(/Şifre: (.+)/)![1].trim(), salt = 'aa'.repeat(16);
  old.mutate(d => { d.admin = { salt, hash: scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex') }; }); old.close();
  const reopened = new MerkezStore(dir, key);
  try {
    assert.equal(reopened.read().admin.mustChange, true);
    const server = createServer(createMerkezApp(reopened)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const c = client(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/merkez/admin`);
      assert.equal((await c('/login', { username: 'admin', password })).data.mustChangePassword, true);
      assert.equal(reopened.read().admin.n, 2 ** 17, 'upgraded'); assert.notEqual(reopened.read().admin.salt, salt);
      assert.equal((await client(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/merkez/admin`)('/login', { username: 'admin', password })).status, 200, 'the same password still works');
    } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
  } finally { reopened.close(); }
});

test('password and Authenticator checks count only wrong answers, per address: the right code after a typo works; guessing still stops; weak new passwords are refused in words', async t => {
  let time = Date.parse('2026-10-05T10:00:00Z');
  const dir = join(temp('merkez-checks'), 'merkez'), store = new MerkezStore(dir, randomBytes(32), { initialPassword: 'VdsAdmin!2026xx' });
  const origin = 'https://yonetim.example.com';
  const server = createServer(createMerkezApp(store, { now: () => new Date(time), httpSecurity: { publicOrigin: origin, trustLocalProxy: true } }));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/merkez/admin`;
  /** A browser behind the HTTPS proxy at one address, with its own cookie jar. */
  const browser = (ip: string) => {
    const jar = new Map<string, string>();
    return async (path: string, body?: unknown) => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': ip, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of r.headers.getSetCookie()) { const [k, v] = c.split(';')[0].split('='); jar.set(k, v); }
      return { status: r.status, data: await r.json().catch(() => ({})) as any };
    };
  };
  const vendor = browser('203.0.113.7');
  assert.equal((await vendor('/login', { username: 'admin', password: 'VdsAdmin!2026xx' })).status, 200);
  // Many right answers in a row are no attempts at all (the old counter refused the sixth call in a minute).
  for (let i = 0; i < 4; i++) assert.equal((await vendor('/mfa/setup', { password: 'VdsAdmin!2026xx' })).status, 200);
  const setup = (await vendor('/mfa/setup', { password: 'VdsAdmin!2026xx' })).data;
  // A typo, then the right code: accepted at once.
  assert.equal((await vendor('/mfa/enable', { saved: true, code: '000000' })).data.code, 'INVALID_CODE');
  const enabled = await vendor('/mfa/enable', { saved: true, code: totp(setup.secret, time) });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.data));
  time += 61_000;
  assert.equal((await vendor('/login', { username: 'admin', password: 'VdsAdmin!2026xx', code: totp(setup.secret, time) })).status, 200);
  // Someone guessing the password inside a session: five wrong ones are free, then each waits longer, even the right one.
  for (let i = 0; i < 5; i++) assert.equal((await vendor('/password', { currentPassword: 'yanlis', newPassword: 'Kirmizi-Bisiklet-27' })).data.code, 'INVALID_PASSWORD');
  assert.equal((await vendor('/password', { currentPassword: 'VdsAdmin!2026xx', newPassword: 'Kirmizi-Bisiklet-27' })).status, 429);
  // Another address (the vendor at home) is not held up by it.
  time += 61_000;
  const home = browser('198.51.100.9');
  assert.equal((await home('/login', { username: 'admin', password: 'VdsAdmin!2026xx', code: totp(setup.secret, time) })).status, 200);
  // Weak new passwords: refused with what to change, the old one stays.
  for (const [weak, why] of [['aaaaaaaaaaaa', /tekrar/], ['123456789012', /ardışık/], ['Mola2026Mola!', /mola/], ['Admin12345678', /ardışık|admin/], ['kısa', /12 karakter/]] as const) {
    const r = await home('/password', { currentPassword: 'VdsAdmin!2026xx', newPassword: weak });
    assert.equal(r.status, 400, weak); assert.equal(r.data.code, 'WEAK_PASSWORD', weak); assert.match(r.data.message, why);
  }
  // The name of a business on this Merkez is no password either.
  store.mutate(d => { d.businesses.push({ tenantId: 'derbi', name: 'Derbi Kafe', source: 'admin', serial: 0, kind: 'trial', endsAt: null, suspended: false, service: 'full', createdAt: new Date(time).toISOString() }); });
  assert.equal((await home('/password', { currentPassword: 'VdsAdmin!2026xx', newPassword: 'DerbiKafe2026!' })).data.code, 'WEAK_PASSWORD');
  assert.equal((await home('/password', { currentPassword: 'VdsAdmin!2026xx', newPassword: 'Kirmizi-Bisiklet-27' })).status, 200);
});

test('login slowing: per address after 5 wrong tries (doubling waits), account-wide after 20 for strangers only; a known device and this computer stay in; Authenticator codes limited', async t => {
  let time = Date.parse('2026-10-03T10:00:00Z');
  const dir = join(temp('merkez-lockout'), 'merkez'), store = new MerkezStore(dir, randomBytes(32), { initialPassword: 'VdsAdmin!2026xx' });
  const origin = 'https://yonetim.example.com';
  const server = createServer(createMerkezApp(store, { now: () => new Date(time), httpSecurity: { publicOrigin: origin, trustLocalProxy: true } }));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/merkez/admin`;
  // Through the HTTPS proxy: each "address" is what the proxy says (X-Forwarded-For).
  const from = (ip: string, cookie = '') => async (password: string, code?: string) => {
    const r = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ username: 'admin', password, ...(code ? { code } : {}) }) });
    return { status: r.status, code: ((await r.json()) as { code?: string }).code, cookies: r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
  };
  // The vendor signed in from home before: the browser keeps a "known device" mark.
  const vendor = await from('203.0.113.7')('VdsAdmin!2026xx'); assert.equal(vendor.status, 200);
  const device = vendor.cookies.split('; ').find(c => c.startsWith('mola_merkez_cihaz='))!; assert.ok(device);
  // One address: five wrong tries are free, then it waits (1 s, 2 s, …), even with the right password.
  const one = from('198.51.100.1');
  for (let i = 0; i < 5; i++) assert.equal((await one('yanlis')).status, 401);
  assert.equal((await one('VdsAdmin!2026xx')).status, 429);
  time += 1500; assert.equal((await one('yanlis')).status, 401, 'after the wait one more try');
  assert.equal((await one('yanlis')).status, 429, 'now 2 s');
  // Many addresses guessing together: from 20 failures on, strangers wait; the vendor's known device does not.
  for (let i = 0; i < 14; i++) assert.equal((await from(`198.51.100.${10 + i}`)('yanlis')).status, 401);
  assert.equal((await from('198.51.100.200')('VdsAdmin!2026xx')).status, 429, 'a stranger with the right password waits');
  assert.equal((await from('192.0.2.50', device)('VdsAdmin!2026xx')).status, 200, 'the known device signs in');
  time += 16 * 60_000;
  assert.equal((await from('198.51.100.200')('VdsAdmin!2026xx')).status, 200, 'after the window');
  // Authenticator: five wrong codes from strangers, then codes wait too.
  store.mutate(d => { d.admin.mfa = { secret: 'JBSWY3DPEHPK3PXP', lastStep: 0, recoveryHashes: [] }; });
  for (let i = 0; i < 5; i++) assert.equal((await from(`203.0.113.${100 + i}`)('VdsAdmin!2026xx', '000000')).code, 'INVALID_CODE');
  assert.equal((await from('203.0.113.120')('VdsAdmin!2026xx', '000000')).status, 429);
});