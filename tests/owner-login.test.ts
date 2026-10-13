import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { KeyVault, adoptKey, makeVerifier, openOwner, verifierMatches, wrapOwner } from '../server/key-vault.js';
import { BackupScheduler } from '../server/backup-scheduler.js';
import { CloudBackup, CloudRestore, type CloudLink } from '../server/cloud-backup.js';
import { restoreBackup } from '../server/backup.js';
import { masterFromPassword, readBackupKeyFile } from '../server/backup-key.js';
import { MerkezLink } from '../server/kafe-link.js';
import { publicKeyFrom } from '../server/license.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { MerkezStore } from '../server/merkez/store.js';
import { maskEmail } from '../server/merkez/owner-login.js';
import type { BackupVault } from '../server/merkez/backup-vault.js';
import { DomainError } from '../packages/domain/engine.js';
import { FAST_KDF, fakeOsLock } from './fake-os-lock.js';
import { client, MERKEZ_PASSWORD, temp } from './merkez-fixture.js';

const rid = () => randomUUID().replace(/-/g, '');
const NAME = 'Sahip Kafe', EMAIL = 'ayse@ornekkafe.com', USER = 'ayse.kafe', PASSWORD = 'SahipSifresi!2026';
const FAST = { N: 2 ** 12, r: 8, p: 1 };
async function listen(server: Server) { await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }
const failsWith = (code: string) => (e: DomainError) => { assert.equal(e.code, code, e.message); return true; };

test('owner block: the password opens the master key, a wrong one or another business’s AAD does not; the verifier checks without opening', async () => {
  const master = randomBytes(32), install = randomUUID();
  const block = await wrapOwner(master, { password: PASSWORD, username: USER, tenantId: 't1', stamp: 's1', installId: install }, FAST);
  assert.deepEqual(await openOwner(block, PASSWORD, install), master);
  await assert.rejects(openOwner(block, 'yanlis-sifre-123', install), failsWith('WRONG_PASSWORD'));
  await assert.rejects(openOwner(block, PASSWORD, randomUUID()), failsWith('WRONG_PASSWORD'), 'bound to its install');
  await assert.rejects(openOwner({ ...block, tenantId: 't2' }, PASSWORD, install), failsWith('WRONG_PASSWORD'), 'bound to its business');
  // The verifier Merkez keeps: its own salt, never the wrapping key.
  assert.equal(await verifierMatches(block.verifier, PASSWORD), true);
  assert.equal(await verifierMatches(block.verifier, 'yanlis-sifre-123'), false);
  assert.notEqual(block.verifier.salt, block.salt);
  const v = await makeVerifier(PASSWORD);
  assert.equal(await verifierMatches({ ...v, hash: 'zz' }, PASSWORD), false, 'a broken verifier never matches');
});

/** A real Mola Merkez with mail "on" (codes caught here) and a protected café whose owner has signed in once. */
async function world(name: string, options: { cloud?: boolean } = {}) {
  const dir = temp(name), clock = { t: Date.now() }, now = () => new Date(clock.t), mails: { to: string; text: string }[] = [];
  const merkezStore = new MerkezStore(join(dir, 'merkez'), randomBytes(32), { initialPassword: MERKEZ_PASSWORD });
  const merkezApp = createMerkezApp(merkezStore, { now, cloudBackupMinFreeBytes: 0, ownerLoginMail: async (_s, to, _subject, text) => { mails.push({ to, text }); } });
  const server = createServer(merkezApp), base = await listen(server), merkezVault = merkezApp.locals.backupVault as BackupVault;
  const admin = client(`${base}/api/merkez/admin`); await admin('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  merkezStore.mutate(d => { d.mail = { settings: { enabled: true, host: 'smtp.example.com', port: 465, security: 'tls', user: 'x', password: 'y', to: 'x@example.com', updatedAt: now().toISOString() }, queue: [] }; });
  const publicKey = publicKeyFrom(merkezStore.publicKey), stores: Store[] = [];
  // The old computer: one business, the owner signed in once (KeyVault.ensureOwner, as server/app.ts does after login).
  const data = join(dir, 'eski', 'veri'), vault = await KeyVault.open(data, { protect: true, osLock: fakeOsLock('eski-pc'), kdf: FAST_KDF });
  const code = vault.reveal(); vault.confirm();
  const store = new Store(data, ['sahip-a'], { key: vault.key! }); stores.push(store);
  store.mutate('sahip-a', s => { s.name = NAME; });
  const link = new MerkezLink(store, { now, url: base, publicKey, machineKey: 'test:eski-pc' });
  const r = await admin('/import', { requestId: rid(), businesses: [{ tenantId: 'sahip-a', name: NAME, license: { endsAt: new Date(clock.t + 365 * 86400000).toISOString(), suspended: false, kind: 'subscription', planMonths: 12 } }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  link.adopt(r.data);
  // The business's invoice e-mail, as an approved application leaves it (contact index: keyed hashes).
  merkezStore.mutate(d => { const b = d.businesses.find(x => x.tenantId === 'sahip-a')!; b.invoice = { ...(b.invoice ?? {}), email: EMAIL, phone: '05551112233' } as never; });
  merkezStore.indexContact('sahip-a', { email: EMAIL, phone: '05551112233' });
  assert.equal(await vault.ensureOwner({ tenantId: 'sahip-a', username: USER, password: PASSWORD, stamp: 'a1b2c3d4e5f6' }), true);
  assert.equal(await vault.ensureOwner({ tenantId: 'sahip-a', username: USER, password: PASSWORD, stamp: 'a1b2c3d4e5f6' }), false, 'the same password is not wrapped again');
  link.reporter = { ...link.reporter, owners: () => vault.ownerLogins() };
  assert.equal((await link.sync()).ok, true);
  assert.equal((await link.sync()).ok, true); // the second heartbeat knows what this Merkez accepts
  const folders = { backups: join(dir, 'eski', 'backups'), keys: join(dir, 'eski', 'keys'), checks: join(dir, 'eski', 'checks') };
  const cloudLink: CloudLink = { ready: () => link.relayReady(), accepts: () => link.read()?.accepts, post: (path, body, timeout) => link.relayPost(path, body, timeout) };
  const cloud = options.cloud ? new CloudBackup(join(folders.backups, 'sunucu-yedegi.json'), cloudLink, { now, retryDelays: [], chunkRetryMs: [], chunkBytes: 64 * 1024 }) : undefined;
  const scheduler = new BackupScheduler(data, { ...folders, protection: () => vault.backupProtection(), cloud }, now);
  // The new computer: a clean install talking to the same Merkez.
  const newData = join(dir, 'yeni', 'veri'), newVault = await KeyVault.open(newData, { protect: true, osLock: fakeOsLock('yeni-pc'), kdf: FAST_KDF });
  const clean = new Store(newData, [], { key: newVault.key! }); stores.push(clean);
  const cleanLink = new MerkezLink(clean, { now, url: base, publicKey });
  const post = async <T,>(path: string, body: object) => await (await cleanLink.transferPost(path, body)).json() as T;
  return {
    dir, clock, now, mails, merkezStore, merkezVault, vault, code, link, scheduler, installId: r.data.installId as string, newVault, cleanLink, post,
    async close() { server.closeAllConnections(); await new Promise<void>(res => server.close(() => res())); (merkezApp.locals.relayHub as { close(): void }).close(); for (const s of stores) s.close(); merkezStore.close(); },
  };
}

test('İşletmem var: the heartbeat brings the verifier; e-mail + username + password → a code by e-mail → the backup opens with the password', async () => {
  const w = await world('owner-folder');
  try {
    // Merkez keeps the verifier only (no wrapping key, no password).
    const kept = w.merkezStore.read().businesses.find(b => b.tenantId === 'sahip-a')!.ownerLogin!;
    assert.equal(kept.username, USER); assert.equal(await verifierMatches(kept.verifier, PASSWORD), true);
    assert.ok(!JSON.stringify(w.merkezStore.read()).includes(PASSWORD));
    const backup = await w.scheduler.runNow(); assert.equal(backup.lastError, undefined, backup.lastError);
    // The backup's key file carries the owner's block: the password opens it like the recovery code does.
    const wrapper = (await readBackupKeyFile(backup.lastDirectory!))!;
    assert.equal(wrapper.owners?.length, 1);
    await assert.rejects(masterFromPassword(wrapper, USER, 'yanlis-sifre-123'), failsWith('WRONG_PASSWORD'));
    await assert.rejects(masterFromPassword(wrapper, 'baskasi', PASSWORD), (e: DomainError) => e.code === 'WRONG_PASSWORD' || e.code === 'NO_OWNER_LOCK');
    // Wrong e-mail, wrong username, wrong password: the same sentence, and no mail.
    for (const body of [{ email: 'baska@ornek.com', username: USER, password: PASSWORD }, { email: EMAIL, username: 'baskasi', password: PASSWORD }, { email: EMAIL, username: USER, password: 'yanlis-sifre-123' }]) {
      await assert.rejects(w.post('/owner-login/start', body), (e: DomainError) => e.code === 'OWNER_LOGIN_FAILED' && /eşleşmedi/.test(e.message));
    }
    assert.equal(w.mails.length, 0);
    // Right: the code goes to the business's invoice e-mail; the screen sees it masked.
    const started = await w.post<{ ticket: string; email: string; name: string }>('/owner-login/start', { email: EMAIL.toUpperCase(), username: USER.toUpperCase(), password: PASSWORD });
    assert.equal(started.name, NAME); assert.equal(started.email, maskEmail(EMAIL)); assert.ok(!started.email.includes('ayse'));
    assert.equal(w.mails.length, 1); assert.equal(w.mails[0].to, EMAIL);
    const code = /\b(\d{6})\b/.exec(w.mails[0].text)![1];
    const wrong = code === '000000' ? '111111' : '000000';
    await assert.rejects(w.post('/owner-login/verify', { ticket: started.ticket, code: wrong, requester: w.newVault.installId }), failsWith('WRONG_CODE'));
    // No Sunucu yedeği: verified, nothing to download; the folder backup is next.
    const verified = await w.post<{ name: string; cloud: unknown }>('/owner-login/verify', { ticket: started.ticket, code, requester: w.newVault.installId });
    assert.equal(verified.name, NAME); assert.equal(verified.cloud, null);
    await assert.rejects(w.post('/owner-login/verify', { ticket: started.ticket, code, requester: w.newVault.installId }), failsWith('CODE_EXPIRED'), 'a code works once');
    const d = w.merkezStore.read();
    assert.ok(d.audit.some(x => x.action === 'owner_login.verified' && x.target === 'sahip-a'));
    assert.ok((d.alerts ?? []).some(x => x.tenantId === 'sahip-a' && /İşletmem var/.test(x.title ?? x.text)));
    // The flash-drive copy opens with the password; the new computer keeps the owner's block, and makes a new recovery code.
    const restored = await restoreBackup(backup.lastDirectory!, { username: USER, password: PASSWORD }, join(w.dir, 'yeni', 'geri'));
    assert.equal(restored.owners?.length, 1);
    await adoptKey(restored.directory, restored.master!, restored.recovery!, restored.installId!, fakeOsLock('yeni-pc'), { owners: restored.owners, codeKnown: false });
    const opened = await KeyVault.open(restored.directory, { protect: true, osLock: fakeOsLock('yeni-pc'), kdf: FAST_KDF });
    assert.equal(opened.ownerLogins().length, 1, 'İşletmem var works again from this computer');
    assert.ok(opened.view().available && !opened.view().confirmed, 'a new recovery code waits to be shown');
    const back = new Store(restored.directory, [], { key: opened.key! });
    try { assert.equal(back.read('sahip-a').name, NAME); } finally { back.close(); }
  } finally { await w.close(); }
});

test('İşletmem var with Sunucu yedeği: the e-mail code opens the copies on Mola Merkez for this computer only', async () => {
  const w = await world('owner-cloud', { cloud: true });
  try {
    const backup = await w.scheduler.runNow(); await w.scheduler.uploading;
    assert.equal(w.merkezVault.copies(w.installId).length, 1);
    const started = await w.post<{ ticket: string }>('/owner-login/start', { email: EMAIL, username: USER, password: PASSWORD });
    const code = /\b(\d{6})\b/.exec(w.mails.at(-1)!.text)![1];
    const verified = await w.post<{ name: string; cloud: Parameters<CloudRestore['useSession']>[0] }>('/owner-login/verify', { ticket: started.ticket, code, requester: w.newVault.installId });
    assert.ok(verified.cloud); assert.equal(verified.cloud.copies.length, 1);
    const restore = new CloudRestore(w.cleanLink, join(w.dir, 'yeni', 'veri-merkez-indirme'), () => w.newVault.installId, w.now);
    const view = restore.useSession(verified.cloud);
    assert.ok(!('list' in view.copies[0]), 'the screen gets dates and sizes only');
    const folder = await restore.download(view.copies[0].id);
    assert.deepEqual(readFileSync(join(folder, 'anahtar-kurtarma.json')), readFileSync(join(backup.lastDirectory!, 'anahtar-kurtarma.json')));
    await restore.finish(view.copies[0].id);
    const restored = await restoreBackup(folder, { username: USER, password: PASSWORD }, join(w.dir, 'yeni', 'geri'));
    await adoptKey(restored.directory, restored.master!, restored.recovery!, restored.installId!, fakeOsLock('yeni-pc'), { owners: restored.owners, codeKnown: false });
    const opened = await KeyVault.open(restored.directory, { protect: true, osLock: fakeOsLock('yeni-pc'), kdf: FAST_KDF });
    const back = new Store(restored.directory, [], { key: opened.key! });
    try { assert.equal(back.read('sahip-a').name, NAME); } finally { back.close(); }
    // Many wrong tries against one business: slowed for an hour.
    let limited = false;
    for (let i = 0; i < 9 && !limited; i++) await w.post('/owner-login/start', { email: EMAIL, username: USER, password: `yanlis-${i}-sifre` }).catch((e: DomainError) => { limited = e.code === 'RATE_LIMIT'; });
    assert.ok(limited, 'per-address or per-business limit reached');
  } finally { await w.close(); }
});
