import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createMerkezApp } from '../server/merkez/app.js';
import { MerkezStore } from '../server/merkez/store.js';
import { totp } from '../server/totp.js';
import { client, temp } from './merkez-fixture.js';

/*
 * Ayarlar → Kullanıcılar (server/merkez/admin-users.ts): the owner ("admin") adds yetkililer who can do everything else in
 * Mola Yönetim with their own password and two-step login; only the owner sees the list, the e-mail settings, the Merkez
 * recovery code and the access keys.
 */
const rid = () => randomUUID().replace(/-/g, '');
async function merkez(name: string, now: () => Date) {
  const dir = join(temp(name), 'merkez'), store = new MerkezStore(dir, randomBytes(32));
  store.mutate(d => { delete d.admin.mustChange; });
  const server = createServer(createMerkezApp(store, { now })); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/merkez/admin`;
  return { store, base, password: readFileSync(join(dir, 'merkez-first-login.txt'), 'utf8').match(/Şifre: (.+)/)![1].trim(),
    close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); } };
}
const FIRST = 'HocaIlkSifre!2026', OWN = 'HocaKendiSifresi!2026';

test('Kullanıcılar: the owner adds a yetkili; they sign in with their own name, change the first password, can work but never see users, e-mail settings or access keys', async t => {
  let now = new Date('2026-10-13T10:00:00Z');
  const m = await merkez('admin-users', () => now); t.after(() => m.close());
  const owner = client(m.base), hoca = client(m.base), guest = client(m.base);
  assert.equal((await owner('/login', { username: 'admin', password: m.password })).status, 200);
  assert.deepEqual((await owner('/me')).data, { owner: true, username: 'admin', name: 'Yönetici' });
  const add = (body: object) => owner('/users', { name: 'Prof. Dr. Ayşe Yılmaz', username: 'ayse.yilmaz', password: FIRST, ownerPassword: m.password, ...body });
  // The owner's own password again; a weak first password; "admin" is the owner's name.
  assert.equal((await add({ ownerPassword: 'yanlis' })).status, 403);
  assert.equal((await add({ password: '12345678' })).data.code, 'WEAK_PASSWORD');
  assert.equal((await add({ username: 'admin' })).data.code, 'USERNAME_TAKEN');
  assert.equal((await add({ username: 'A' })).status, 400);
  const added = await add({});
  assert.equal(added.status, 200, JSON.stringify(added.data));
  assert.equal((await add({})).data.code, 'USERNAME_TAKEN');
  const list = (await owner('/users')).data.users;
  assert.equal(list.length, 1); assert.equal(list[0].username, 'ayse.yilmaz'); assert.equal(list[0].mustChange, true);
  assert.equal(JSON.stringify(list).includes(m.store.read().adminUsers![0].record.hash), false, 'no hash on screen');

  // An unknown name and a wrong password get the same answer.
  assert.equal((await guest('/login', { username: 'yok.boyle', password: FIRST })).data.code, 'INVALID_LOGIN');
  assert.equal((await guest('/login', { username: 'ayse.yilmaz', password: 'Yanlis!2026x' })).data.code, 'INVALID_LOGIN');
  // First sign-in (the name in any case): the first password must be changed before anything else.
  const first = await hoca('/login', { username: 'Ayse.Yilmaz', password: FIRST });
  assert.equal(first.status, 200); assert.equal(first.data.mustChangePassword, true);
  assert.equal((await hoca('/state')).data.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await hoca('/password', { currentPassword: FIRST, newPassword: OWN })).status, 200);
  // The owner's session stays (only the yetkili's own sessions end).
  assert.equal((await owner('/state')).status, 200);
  assert.equal((await hoca('/login', { username: 'ayse.yilmaz', password: OWN })).status, 200);
  assert.deepEqual((await hoca('/me')).data, { owner: false, username: 'ayse.yilmaz', name: 'Prof. Dr. Ayşe Yılmaz' });

  // Everything else works: a new business; İşlem kayıtları names her.
  const made = await hoca('/businesses', { requestId: rid(), name: 'Hoca Deneme Kafesi', kind: 'trial' });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const created = m.store.journal.entries().map(s => s.entry).find(e => e.action === 'business.created');
  assert.equal(created?.actor.name, 'Prof. Dr. Ayşe Yılmaz (yetkili)');
  const signIn = m.store.journal.entries().map(s => s.entry).filter(e => e.action === 'admin.login').at(-1);
  assert.equal(signIn?.actor.name, 'Prof. Dr. Ayşe Yılmaz (yetkili)');
  // The owner's parts: the list, the e-mail settings (where "Şifremi unuttum" sends the owner's code), access keys.
  assert.equal((await hoca('/users')).data.code, 'OWNER_ONLY');
  assert.equal((await hoca('/users', { name: 'Başka Biri', username: 'baska', password: FIRST, ownerPassword: OWN })).data.code, 'OWNER_ONLY');
  assert.equal((await hoca('/email', { enabled: true, host: 'smtp.example.com', port: 587, security: 'starttls', user: '', to: 'hoca@example.com' })).data.code, 'OWNER_ONLY');
  assert.equal((await hoca('/access-tokens', { name: 'Hoca anahtarı', scope: 'calisma', password: OWN })).data.code, 'OWNER_ONLY');
  assert.equal((await hoca('/email')).status, 200, 'the settings can be read');

  // Her own two-step login: her own Authenticator, not the owner's.
  const setup = (await hoca('/mfa/setup', { password: OWN })).data;
  assert.match(setup.uri, /:ayse\.yilmaz\?/);
  now = new Date(+now + 61000);
  assert.equal((await hoca('/mfa/enable', { saved: true, code: totp(setup.secret, +now) })).status, 200);
  assert.equal(m.store.read().admin.mfa, undefined, 'the owner\'s account is untouched');
  assert.equal((await owner('/mfa')).data.enabled, false);
  now = new Date(+now + 61000);
  assert.equal((await hoca('/login', { username: 'ayse.yilmaz', password: OWN })).data.code, 'MFA_REQUIRED');
  assert.equal((await hoca('/login', { username: 'ayse.yilmaz', password: OWN, code: totp(setup.secret, +now) })).status, 200);

  // A new first password from the owner: her sessions end, two-step login stays.
  const id = list[0].id;
  assert.equal((await owner('/users/password', { id, password: 'YeniIlkSifre!2026', ownerPassword: m.password })).status, 200);
  assert.equal((await hoca('/state')).status, 401);
  assert.ok(m.store.read().adminUsers![0].record.mfa);
  // Removed: her session ends and her name signs in no more; the owner's session stays.
  now = new Date(+now + 61000);
  const back = await hoca('/login', { username: 'ayse.yilmaz', password: 'YeniIlkSifre!2026', code: totp(setup.secret, +now) });
  assert.equal(back.status, 200); assert.equal(back.data.mustChangePassword, true);
  assert.equal((await owner('/users/delete', { id, ownerPassword: m.password })).status, 200);
  assert.equal((await hoca('/me')).status, 401);
  assert.equal((await guest('/login', { username: 'ayse.yilmaz', password: 'YeniIlkSifre!2026' })).data.code, 'INVALID_LOGIN');
  assert.equal((await owner('/state')).status, 200);
  const actions = m.store.journal.entries().map(s => s.entry.action);
  for (const a of ['admin.user_added', 'admin.user_password_set', 'admin.user_removed']) assert.ok(actions.includes(a), a);
});
