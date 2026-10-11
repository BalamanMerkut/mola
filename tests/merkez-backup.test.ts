import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createMerkezApp } from '../server/merkez/app.js';
import { MerkezBackups, MerkezRecovery, RECOVERY_FILE, restoreMerkezBackup } from '../server/merkez/backup.js';
import { MerkezStore } from '../server/merkez/store.js';
import { verifyLicense, publicKeyFrom } from '../server/license.js';
import { FAST_KDF } from './fake-os-lock.js';
import { client, MERKEZ_PASSWORD, temp } from './merkez-fixture.js';

const rid = () => randomUUID().replace(/-/g, '');

test('Merkez backup: nightly copy proven by a restore, sealed by the data key and the recovery code; a new computer gets everything back with backup + code; licences re-signed above the cafés’ serials', async t => {
  const root = temp('merkez-backup'), dir = join(root, 'merkez'), key = randomBytes(32);
  const store = new MerkezStore(dir, key, { initialPassword: MERKEZ_PASSWORD });
  const server = createServer(createMerkezApp(store)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const admin = client(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/merkez/admin`);
  await admin('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  const imported = (await admin('/import', { requestId: rid(), businesses: [{ tenantId: 'yedek-kafe', name: 'Yedek Kafe', license: { endsAt: '2027-10-01T00:00:00.000Z', suspended: false, kind: 'subscription', planMonths: 12 } }] })).data;
  const before = verifyLicense(imported.licenses[0], publicKeyFrom(store.publicKey)).serial;
  // The recovery code: made at the first start, shown (once), confirmed. Never written anywhere in plain.
  const recovery = await MerkezRecovery.open(dir, key, FAST_KDF);
  assert.equal(recovery.view().available, true);
  const code = recovery.reveal(); recovery.confirm();
  assert.equal(recovery.view().confirmed, true); assert.throws(() => recovery.reveal(), /Gösterilecek yeni kurtarma kodu yok/);
  assert.equal(readFileSync(join(dir, RECOVERY_FILE), 'utf8').includes(code), false);
  const failures: string[] = [];
  const backups = new MerkezBackups(dir, { folder: join(root, 'merkez-yedek'), checks: join(root, 'merkez-yedek-prova'), settings: join(dir, 'merkez-yedek-ayar.json'), auto: false, protection: () => recovery.protection(), onFailure: m => failures.push(m) });
  await backups.start();
  const second = join(root, 'flash'); mkdirSync(second);
  await backups.setSecond(second);
  const status = await backups.runNow();
  assert.equal(status.lastError, undefined); assert.ok(status.lastSuccessAt); assert.equal(status.second.folder, second); assert.ok(status.second.lastCopyAt);
  assert.deepEqual(readdirSync(join(root, 'merkez-yedek-prova')), [], 'the proof copy is gone');
  const [made] = readdirSync(join(root, 'merkez-yedek')).filter(n => n.startsWith('merkez-yedek-'));
  const folder = join(root, 'merkez-yedek', made);
  // Nothing readable inside: no SQLite header, no key, no code, no business name.
  for (const name of readdirSync(folder)) { const bytes = readFileSync(join(folder, name)); for (const secret of ['SQLite format', 'Yedek Kafe', code, key.toString('base64'), key.toString('hex')]) assert.equal(bytes.includes(secret), false, `${name}: ${secret}`); }
  assert.ok(existsSync(join(second, 'Mola-Merkez-Yedek', made)), 'copied to the second place');
  // A wrong code opens nothing and leaves no folder behind.
  const target = join(root, 'yeni-bilgisayar', 'veri');
  await assert.rejects(restoreMerkezBackup(folder, '2222-3333-4444-5555-6666-7777', target), (e: Error & { code?: string }) => e.code === 'WRONG_CODE');
  assert.equal(existsSync(target), false);
  // A new recovery code: the backups here and in the second place open with it.
  const newCode = await recovery.regenerate(); recovery.confirm();
  assert.equal(await backups.rewrap(recovery.protection()), 2);
  await assert.rejects(restoreMerkezBackup(join(second, 'Mola-Merkez-Yedek', made), code, join(root, 'eski-kod')), (e: Error & { code?: string }) => e.code === 'WRONG_CODE');
  const proof = await restoreMerkezBackup(join(second, 'Mola-Merkez-Yedek', made), newCode, target);
  assert.equal(proof.businesses, 1); assert.equal(proof.publicKey, store.publicKey);
  // Merkez opens on the new computer: the same signing key and businesses, every licence re-signed 1000 serials higher.
  const restored = new MerkezStore(target, readFileSync(join(target, 'development.key')));
  try {
    assert.equal(restored.publicKey, store.publicKey);
    const biz = restored.read().businesses.find(b => b.tenantId === 'yedek-kafe')!;
    assert.equal(verifyLicense(biz.signed, publicKeyFrom(restored.publicKey)).serial, before + 1001);
    assert.ok(restored.read().audit.some(a => a.action === 'merkez.restored'));
    assert.equal(existsSync(join(target, 'geri-yuklendi.json')), false, 'only once');
    assert.equal((await MerkezRecovery.open(target, readFileSync(join(target, 'development.key')), FAST_KDF)).view().confirmed, true, 'the code used for the restore counts as saved');
  } finally { restored.close(); }
  // A failing backup is reported (Bildirim merkezi wiring is in runtime.ts).
  const broken = new MerkezBackups(dir, { folder: join(root, 'merkez-yedek'), checks: join(root, 'merkez-yedek-prova'), settings: join(dir, 'b.json'), auto: false, protection: () => { throw new Error('anahtar yok'); }, onFailure: m => failures.push(m) });
  assert.match((await broken.runNow()).lastError!, /anahtar yok/); assert.equal(failures.length, 1);
  await assert.rejects(backups.setSecond(join(root, 'takili-degil')), /bulunamadı/);
  await assert.rejects(restoreMerkezBackup(folder, newCode, target), /boş değil/);
});

test('Mola Yönetim backup card API: status, run, second place; the recovery code only on this computer and a new one only with the password', async t => {
  const root = temp('merkez-backup-api'), dir = join(root, 'merkez'), key = randomBytes(32), store = new MerkezStore(dir, key, { initialPassword: MERKEZ_PASSWORD });
  const recovery = await MerkezRecovery.open(dir, key, FAST_KDF);
  const backups = new MerkezBackups(dir, { folder: join(root, 'merkez-yedek'), checks: join(root, 'prova'), settings: join(dir, 'ayar.json'), auto: false, protection: () => recovery.protection() }); await backups.start();
  const servers = [createServer(createMerkezApp(store, { backups, recovery })), createServer(createMerkezApp(store, { backups, recovery, httpSecurity: { publicOrigin: 'https://y.example.com', trustLocalProxy: true } })), createServer(createMerkezApp(store))];
  const [local, vds, off] = await Promise.all(servers.map(async s => { await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/merkez/admin`; }));
  t.after(async () => { for (const s of servers) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); } store.close(); });
  const admin = client(local); await admin('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  let card = (await admin('/backup')).data;
  assert.equal(card.recovery.available, true); assert.equal(card.backup.auto, false); assert.equal(card.local, true);
  const shown = (await admin('/recovery/show', {})).data.code; assert.match(shown, /^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
  // Through the HTTPS proxy (Merkez on a VDS) the panel works, the code is not shown.
  const headers = { 'Content-Type': 'application/json', Origin: 'https://y.example.com', 'X-Forwarded-Proto': 'https' };
  const login = await fetch(`${vds}/login`, { method: 'POST', headers, body: JSON.stringify({ username: 'admin', password: MERKEZ_PASSWORD }) });
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const remote = await fetch(`${vds}/recovery/show`, { method: 'POST', headers: { ...headers, Cookie: cookie }, body: '{}' });
  assert.equal(remote.status, 403); assert.equal(((await remote.json()) as { code: string }).code, 'LOCAL_ONLY');
  assert.equal((await admin('/recovery/confirm', {})).data.confirmed, true);
  assert.equal((await admin('/recovery/new', { password: 'yanlis' })).data.code, 'INVALID_PASSWORD');
  const renewed = (await admin('/recovery/new', { password: MERKEZ_PASSWORD })).data.code; assert.notEqual(renewed, shown);
  const ran = (await admin('/backup/run', {})).data; assert.ok(ran.lastSuccessAt, JSON.stringify(ran));
  assert.equal((await admin('/backup/second', { folder: join(root, 'yok') })).status, 400);
  mkdirSync(join(root, 'usb')); assert.equal((await admin('/backup/second', { folder: join(root, 'usb') })).data.second.folder, join(root, 'usb'));
  card = (await admin('/backup')).data; assert.equal(card.backup.second.folder, join(root, 'usb'));
  const actions = (await admin('/state')).data.audit.map((a: { action: string }) => a.action);
  for (const a of ['merkez.recovery_confirmed', 'merkez.recovery_renewed', 'merkez.backup_made', 'merkez.second_place_set']) assert.ok(actions.includes(a), a);
  // A Merkez started without them (tests, tools) says so plainly.
  const plain = client(off); await plain('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  assert.deepEqual((await plain('/backup')).data.backup, null); assert.equal((await plain('/backup/run', {})).data.code, 'BACKUP_OFF');
});
