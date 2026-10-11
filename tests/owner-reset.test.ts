import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEMO_PASSWORD } from '../server/app.js';
import { MerkezLink } from '../server/kafe-link.js';
import { publicKeyFrom } from '../server/license.js';
import { Store } from '../server/store.js';
import { DESKTOP_KEY, merkezPair, temp } from './merkez-fixture.js';

/*
 * The owner lost the password, and maybe the username and the recovery code too. "Mola ekibinden kod": the vendor issues a
 * one-time code in Mola Yönetim (30 minutes, bound to that business's install); on the café computer's own window the code
 * shows the owner accounts, then sets a new password. Merkez checks and spends the code; it never sees a username or password.
 */
process.env.MOLA_APPLICATION_POLL_MS = '0';
const rid = () => randomUUID().replace(/-/g, '');
const MINUTE = 60_000;

test('vendor code: two steps on the café window only; wrong, expired, reused and another café’s codes refused; 5 wrong tries lock 15 minutes; suspended businesses get none; audited on both sides', async t => {
  let time = Date.parse('2026-10-04T09:00:00Z');
  const pair = await merkezPair('owner-reset', { demo: true, now: () => new Date(time), desktop: true }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin();
  assert.equal((await pair.link.sync()).ok, true);
  const kafe = pair.kafe(), desktop = (path: string, body: unknown, headers: Record<string, string> = {}) => kafe(path, body, { 'X-Mola-Desktop': DESKTOP_KEY, ...headers });
  const issue = async (tenantId = 'mola-demo') => (await pair.admin('/owner-reset-codes', { requestId: rid(), tenantId })).data as { code: string; expiresAt: string };

  // Mola Yönetim: a short readable one-time code, 30 minutes; only its hash stays at Merkez.
  const first = await issue();
  assert.match(first.code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(Date.parse(first.expiresAt) - time, 30 * MINUTE);
  assert.equal(JSON.stringify(pair.merkezStore.read()).includes(first.code.replace(/-/g, '')), false, 'only the hash is kept');
  assert.ok((await pair.admin('/state')).data.audit.some((a: any) => a.action === 'owner_reset.issued' && a.by === 'admin' && a.target === 'mola-demo'));

  // Never without the window key, never from another device or through a proxy/tunnel.
  assert.equal((await kafe('/desktop/owner-password/vendor/owners', { code: first.code })).status, 404);
  assert.equal((await desktop('/desktop/owner-password/vendor/owners', { code: first.code }, { 'X-Forwarded-For': '192.168.1.20' })).status, 404);
  // The recovery-code way needs key protection (off here): the vendor code is the way.
  assert.equal((await desktop('/desktop/owner-password/owners', { code: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF' })).data.code, 'NO_PROTECTION');

  // Step 1: the code alone shows that business's owner accounts (not the other business's on this computer).
  const step1 = await desktop('/desktop/owner-password/vendor/owners', { code: first.code.toLowerCase() });
  assert.equal(step1.status, 200, JSON.stringify(step1.data));
  assert.deepEqual(step1.data.owners.map((o: any) => o.username), ['isletme']); assert.ok(step1.data.business);
  // Step 2: the code is checked again; an account of another business, or a staff account, is not taken.
  const reset = { code: first.code, username: 'isletme', newPassword: 'SahipYeniSifre!2026' };
  assert.equal((await desktop('/desktop/owner-password/vendor', { ...reset, username: 'diger' })).status, 404);
  assert.equal((await desktop('/desktop/owner-password/vendor', { ...reset, username: 'garson' })).status, 404);
  assert.ok(!pair.merkezStore.read().ownerResets![0].usedAt, 'a refused step 2 does not spend the code');
  const owner = pair.kafe(); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  assert.equal((await desktop('/desktop/owner-password/vendor', reset)).status, 200);
  assert.equal((await owner('/staff/state')).status, 401, 'the owner’s open sessions end');
  assert.equal((await pair.kafe()('/login', { username: 'isletme', password: reset.newPassword })).status, 200);
  assert.equal((await pair.kafe()('/login', { username: 'garson', password: DEMO_PASSWORD })).status, 200, 'staff untouched');
  assert.ok(pair.store.auditLog('mola-demo').some(a => a.action === 'owner.password_reset' && a.actor === 'vendor-code'));
  let merkez = (await pair.admin('/state')).data;
  assert.ok(merkez.audit.some((a: any) => a.action === 'owner_reset.used' && a.by === 'cafe'));
  assert.ok(merkez.alerts.some((a: any) => a.kind === 'owner.reset' && a.tenantId === 'mola-demo'));
  assert.equal(JSON.stringify(merkez).includes(reset.newPassword) || JSON.stringify(pair.merkezStore.read()).includes(reset.newPassword), false, 'Merkez never sees the password');

  // Used once only.
  const reused = await desktop('/desktop/owner-password/vendor/owners', { code: first.code });
  assert.equal(reused.status, 403); assert.match(reused.data.message, /daha önce kullanıldı/);
  // Expired after 30 minutes.
  const second = await issue();
  time += 31 * MINUTE;
  const expired = await desktop('/desktop/owner-password/vendor/owners', { code: second.code });
  assert.equal(expired.status, 403); assert.match(expired.data.message, /süresi dolmuş/);
  // A code made for another café (another install at the same Merkez) is just wrong here, and still works at its own café.
  const otherStore = new Store(temp('owner-reset-other'), []); t.after(() => otherStore.close());
  const other = new MerkezLink(otherStore, { now: () => new Date(time), url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), machineId: 'b'.repeat(64) });
  await other.apply({ businessName: 'Başka Kafe', sector: 'cafe', contactName: 'Ali Veli', consent: true, invoice: { legalName: 'Başka Kafe Ltd. Şti.', taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1234567890', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 3', phone: '+905321112233', email: 'ali@example.com' } });
  const otherId = (await pair.admin('/state')).data.businesses.find((b: any) => b.name === 'Başka Kafe').tenantId;
  await pair.admin('/applications/approve', { requestId: rid(), tenantId: otherId }); await other.checkApplication();
  const foreign = await issue(otherId);
  const wrongCafe = await desktop('/desktop/owner-password/vendor/owners', { code: foreign.code });
  assert.equal(wrongCafe.status, 403); assert.equal(wrongCafe.data.code, 'WRONG_CODE');
  assert.equal((await other.ownerReset(foreign.code, false)).tenantId, otherId, 'its own café accepts it');
  // A plainly wrong code; then the fifth wrong try within 15 minutes locks the way, even for a right code.
  time += 16 * MINUTE;
  const good = await issue();
  for (let i = 0; i < 5; i++) assert.equal((await desktop('/desktop/owner-password/vendor/owners', { code: 'ABCD-EFGH-JKLM' })).data.code, 'WRONG_CODE');
  const locked = await desktop('/desktop/owner-password/vendor/owners', { code: good.code });
  assert.equal(locked.status, 429); assert.match(locked.data.message, /15 dakika/);
  time += 16 * MINUTE;
  assert.equal((await desktop('/desktop/owner-password/vendor/owners', { code: good.code })).status, 200, 'open again after 15 minutes');

  // Suspended: no new code, and a code issued before does not work.
  const b = (await pair.admin('/state')).data.businesses.find((x: any) => x.tenantId === 'mola-demo');
  await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: false, months: 0, suspended: true, reason: 'Ödeme yok' });
  assert.equal((await pair.admin('/owner-reset-codes', { requestId: rid(), tenantId: 'mola-demo' })).data.code, 'SUSPENDED');
  assert.equal((await desktop('/desktop/owner-password/vendor/owners', { code: good.code })).data.code, 'SUSPENDED');
  // Not activated, or deleted: no code either.
  const added = await pair.admin('/businesses', { requestId: rid(), name: 'Kodsuz Kafe', kind: 'trial' });
  assert.equal((await pair.admin('/owner-reset-codes', { requestId: rid(), tenantId: added.data.tenantId })).data.code, 'NOT_ACTIVATED');
  assert.equal((await pair.admin('/owner-reset-codes', { requestId: rid(), tenantId: 'yok' })).status, 404);
  merkez = (await pair.admin('/state')).data;
  assert.equal(merkez.audit.filter((a: any) => a.action === 'owner_reset.used').length, 1);
});
