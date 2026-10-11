import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { adminMatches } from '../server/admin-auth.js';
import { keyCheck, openRecovery } from '../server/key-vault.js';
import { MerkezBackups, MerkezRecovery, readRecoveryFile, restoreMerkezBackup } from '../server/merkez/backup.js';
import { keyOpensMerkez, MerkezKeyGuard, passphraseLock, readMerkezKeyFile, SAFETY_COPY } from '../server/merkez/key-guard.js';
import { OfflineResetError, openOfflineReset } from '../server/merkez/offline-reset.js';
import { startMerkez } from '../server/merkez/runtime.js';
import { MerkezStore } from '../server/merkez/store.js';
import { fakeOsLock, FAST_KDF } from './fake-os-lock.js';
import { client, MERKEZ_PASSWORD, temp } from './merkez-fixture.js';

/*
 * Mola Yönetim's data key locked to the computer user (server/merkez/key-guard.ts). Every Merkez here is a scratch folder
 * under .local/tests; "computer users" are fake OS locks (tests/fake-os-lock.ts), so nothing touches a real install.
 */
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
/** A Merkez as an older install leaves it: plain development.key, data, a recovery code (confirmed unless asked). */
async function plainMerkez(name: string, options: { confirmed?: boolean } = {}) {
  const dir = join(temp(name), 'veri'), key = randomBytes(32);
  const store = new MerkezStore(dir, key, { initialPassword: MERKEZ_PASSWORD });
  store.mutate(d => { d.businesses.push({ tenantId: 'kafe-1', name: 'Yokuş Kafe', endsAt: '2027-10-01T00:00:00.000Z', suspended: false, kind: 'subscription', planMonths: 12, service: 'full', source: 'admin', serial: 1 } as never); });
  store.close();
  writeFileSync(join(dir, 'development.key'), key, { mode: 0o600 });
  const recovery = await MerkezRecovery.open(dir, key, FAST_KDF), code = recovery.reveal();
  if (options.confirmed !== false) recovery.confirm();
  return { dir, key, code };
}
/** fs.cpSync stops the process on this computer's non-ASCII path (Node 24, Windows): a plain copy of the flat data folder. */
const copyFolder = (from: string, to: string) => { mkdirSync(to, { recursive: true }); for (const name of readdirSync(from)) copyFileSync(join(from, name), join(to, name)); };
const businessesOf = (dir: string, key: Buffer) => { const s = new MerkezStore(dir, key); try { return s.read().businesses.map(b => b.name); } finally { s.close(); } };

test('migration: a plain key becomes anahtar.json (this user + the SAME Merkez recovery code), verified; the data does not change; the plain copy goes at the first protected start', async () => {
  const m = await plainMerkez('anahtar-tasima'), data = sha(join(m.dir, 'merkez.sqlite')), satici = fakeOsLock('satici');
  const steps: string[] = [];
  const guard = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: satici, onStep: s => steps.push(s) });
  assert.equal(guard.state, 'open'); assert.equal(guard.migrated, true); assert.ok(guard.key!.equals(m.key), 'the same key');
  assert.deepEqual(steps, ['basla', 'gecici-yazildi', 'ana-yazildi', 'kopya-yazildi', 'dogrulandi', 'kenara-alindi']);
  assert.equal(existsSync(join(m.dir, 'development.key')), false, 'no plain key under its old name');
  assert.ok(readFileSync(join(m.dir, SAFETY_COPY)).equals(m.key), 'the plain copy is kept until the first protected start');
  const file = readMerkezKeyFile(m.dir)!, recovery = readRecoveryFile(m.dir)!;
  assert.equal(file.osLock.kind, 'dpapi'); assert.equal(file.installId, recovery.merkezId); assert.equal(file.recovery.id, recovery.recovery.id);
  // The vendor's existing code (Ayarlar → Yedek) opens the new key file; nothing in it is the key or the code.
  assert.ok((await openRecovery(file.recovery, m.code, file.installId)).equals(m.key));
  for (const name of ['anahtar.json', 'anahtar.yedek.json']) { const text = readFileSync(join(m.dir, name), 'utf8'); assert.equal(text.includes(m.key.toString('base64')) || text.includes(m.key.toString('hex')) || text.includes(m.code), false); }
  assert.equal(sha(join(m.dir, 'merkez.sqlite')), data, 'the Merkez data itself is untouched');
  assert.deepEqual(guard.view(true), { wanted: true, mode: 'protected', kind: 'dpapi', protectsAtRest: true, waitingForCode: false, migratesAtNextStart: false, safetyCopy: true, warning: null });
  // The next start opens it through this user's lock: the plain copy is overwritten and deleted.
  const again = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: satici });
  assert.equal(again.state, 'open'); assert.equal(again.migrated, false); assert.ok(again.key!.equals(m.key));
  assert.equal(existsSync(join(m.dir, SAFETY_COPY)), false);
  assert.deepEqual(businessesOf(m.dir, again.key!), ['Yokuş Kafe']);
  // Rollback by hand (MERKEZ_KEY_PROTECTION=0 and the plain key put back) opens with the plain key and touches nothing.
  writeFileSync(join(m.dir, 'development.key'), m.key);
  const back = await MerkezKeyGuard.open(m.dir, { protect: false, osLock: fakeOsLock('baska') });
  assert.equal(back.state, 'open'); assert.equal(back.protectedFile, false); assert.ok(existsSync(join(m.dir, 'anahtar.json')));
});

test('migration: no confirmed recovery code, no migration ("Önce kurtarma kodunuzu kaydedin"); confirmed, the next start migrates', async () => {
  const m = await plainMerkez('anahtar-kod-yok', { confirmed: false }), satici = fakeOsLock('satici');
  const guard = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: satici });
  assert.equal(guard.state, 'open'); assert.equal(guard.migrated, false); assert.equal(existsSync(join(m.dir, 'anahtar.json')), false);
  assert.ok(existsSync(join(m.dir, 'development.key')));
  assert.equal(guard.view(false).waitingForCode, true);
  assert.equal(satici.opens, 0, 'the lock was not even asked');
  // Development / tests (protection off) never ask for it.
  assert.equal((await MerkezKeyGuard.open(m.dir, { protect: false, osLock: satici })).view(false).waitingForCode, false);
  // "Kodu kaydettim" (Ayarlar → Yedek): the screen now says "at the next start"; the next start locks the key.
  const recovery = await MerkezRecovery.open(m.dir, m.key, FAST_KDF); recovery.confirm();
  assert.equal(guard.view(true).migratesAtNextStart, true);
  const next = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: satici });
  assert.equal(next.migrated, true); assert.ok(existsSync(join(m.dir, 'anahtar.json')));
  // A brand-new Merkez with protection: a plain key first, the code is made at that start, then the same rule.
  const fresh = join(temp('anahtar-yeni'), 'veri');
  const first = await MerkezKeyGuard.open(fresh, { protect: true, osLock: satici });
  assert.equal(first.view(false).waitingForCode, true); assert.ok(existsSync(join(fresh, 'development.key')));
});

test('migration failure: the half-made key files go, the plain key keeps working, the next start tries again; a cut before the plain key was set aside finishes later', async () => {
  const m = await plainMerkez('anahtar-hata'), broken = fakeOsLock('satici');
  // The lock writes but cannot open again (verification fails): rolled back.
  broken.fail = 'transient';
  const failed = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: broken });
  assert.equal(failed.state, 'open'); assert.ok(failed.key!.equals(m.key)); assert.equal(failed.migrated, false);
  assert.match(failed.warning!, /korumaya alınamadı/);
  assert.equal(existsSync(join(m.dir, 'anahtar.json')), false); assert.equal(existsSync(join(m.dir, 'anahtar.yedek.json')), false);
  assert.ok(readFileSync(join(m.dir, 'development.key')).equals(m.key), 'the plain key was never touched');
  assert.deepEqual(businessesOf(m.dir, failed.key!), ['Yokuş Kafe']);
  // A step that blows up halfway (disk full while writing the copy): the same rollback.
  const cut = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: fakeOsLock('satici'), onStep: s => { if (s === 'kopya-yazildi') throw new Error('disk dolu'); } });
  assert.equal(cut.migrated, false); assert.equal(existsSync(join(m.dir, 'anahtar.json')), false); assert.ok(existsSync(join(m.dir, 'development.key')));
  // A wrong plain key never becomes the key: refused, nothing written.
  const other = await plainMerkez('anahtar-yanlis');
  writeFileSync(join(other.dir, 'development.key'), randomBytes(32));
  await assert.rejects(MerkezKeyGuard.open(other.dir, { protect: true, osLock: fakeOsLock('satici') }), /bu Merkez verisini açmıyor/);
  assert.equal(existsSync(join(other.dir, 'anahtar.json')), false);
  // Power cut after anahtar.json was verified but before the plain key was set aside: the next start sets it aside.
  const ok = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: fakeOsLock('satici') });
  assert.equal(ok.migrated, true);
  renameSync(join(m.dir, SAFETY_COPY), join(m.dir, 'development.key'));
  const resumed = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: fakeOsLock('satici') });
  assert.equal(resumed.state, 'open'); assert.equal(existsSync(join(m.dir, 'development.key')), false); assert.ok(existsSync(join(m.dir, SAFETY_COPY)));
});

test('locked: another user (or a reset Windows password) gets "kilitli"; the recovery code opens it and locks it again for that user; the plain copy of a recent migration is used before asking', async () => {
  const m = await plainMerkez('anahtar-kilit'), satici = fakeOsLock('satici'), yeni = fakeOsLock('yeni-kullanici');
  await MerkezKeyGuard.open(m.dir, { protect: true, osLock: satici });
  // Right after the migration the plain copy still exists: a refusing lock falls back to it and re-locks for this user.
  const copy = join(temp('anahtar-kilit-kopya'), 'veri'); copyFolder(m.dir, copy);
  const fallback = await MerkezKeyGuard.open(copy, { protect: true, osLock: yeni });
  assert.equal(fallback.state, 'open'); assert.match(fallback.warning!, /yeniden kilitlendi/); assert.ok(existsSync(join(copy, SAFETY_COPY)));
  assert.equal((await MerkezKeyGuard.open(copy, { protect: true, osLock: yeni })).state, 'open', 'locked to the new user now');
  // After the first protected start there is no plain copy: another user is locked out.
  await MerkezKeyGuard.open(m.dir, { protect: true, osLock: satici });
  assert.equal(existsSync(join(m.dir, SAFETY_COPY)), false);
  const locked = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: yeni });
  assert.equal(locked.state, 'locked'); assert.equal(locked.key, undefined); assert.match(locked.lockReason!, /açmadı/);
  await assert.rejects(locked.unlock('kisa'), (e: Error & { code?: string }) => e.code === 'INVALID_CODE');
  await assert.rejects(locked.unlock('2222-3333-4444-5555-6666-7777'), (e: Error & { code?: string }) => e.code === 'WRONG_CODE');
  assert.equal(locked.state, 'locked');
  await locked.unlock(m.code.toLowerCase());
  assert.equal(locked.state, 'open'); assert.ok(locked.key!.equals(m.key)); assert.equal(locked.warning, undefined);
  // Re-locked for the new user: it opens without the code; the old user is now the one locked out.
  assert.equal((await MerkezKeyGuard.open(m.dir, { protect: true, osLock: yeni })).state, 'open');
  assert.equal((await MerkezKeyGuard.open(m.dir, { protect: true, osLock: satici })).state, 'locked');
  // "Windows kilidini yeniden dene": a lock that was only slow opens on retry.
  const slow = fakeOsLock('yeni-kullanici'); slow.fail = 'transient';
  const waiting = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: slow });
  assert.equal(waiting.state, 'locked'); slow.fail = undefined;
  assert.equal(await waiting.retry(), true); assert.equal(waiting.state, 'open');
});

test('a new Merkez recovery code reaches anahtar.json: the new code unlocks, the old one no longer; a lost merkez-kurtarma.json comes back from the key file', async () => {
  const m = await plainMerkez('anahtar-yeni-kod'), satici = fakeOsLock('satici');
  const guard = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: satici });
  const recovery = await MerkezRecovery.open(m.dir, guard.key!, FAST_KDF, { seed: guard.seed(), onChange: f => guard.syncRecovery(f) });
  const fresh = await recovery.regenerate(); recovery.confirm();
  await MerkezKeyGuard.open(m.dir, { protect: true, osLock: satici }); // the plain copy of the migration goes
  const locked = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: fakeOsLock('baska') });
  assert.equal(locked.state, 'locked');
  await assert.rejects(locked.unlock(m.code), (e: Error & { code?: string }) => e.code === 'WRONG_CODE');
  await locked.unlock(fresh); assert.equal(locked.state, 'open');
  // merkez-kurtarma.json deleted by hand: rebuilt from the key file, still confirmed (no new code nobody saw).
  renameSync(join(m.dir, 'merkez-kurtarma.json'), join(m.dir, 'kayip.json'));
  const reopened = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: fakeOsLock('baska') });
  const rebuilt = await MerkezRecovery.open(m.dir, reopened.key!, FAST_KDF, { seed: reopened.seed() });
  assert.equal(rebuilt.view().confirmed, true); assert.equal(await rebuilt.matches(fresh), true);
});

test('backups keep working under protection and open with the recovery code under another user / on a new computer', async () => {
  const m = await plainMerkez('anahtar-yedek'), root = join(m.dir, '..');
  const guard = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: fakeOsLock('satici') });
  const recovery = await MerkezRecovery.open(m.dir, guard.key!, FAST_KDF, { seed: guard.seed(), onChange: f => guard.syncRecovery(f) });
  const backups = new MerkezBackups(m.dir, { folder: join(root, 'merkez-yedek'), checks: join(root, 'merkez-yedek-prova'), settings: join(m.dir, 'merkez-yedek-ayar.json'), auto: false, protection: () => recovery.protection() });
  const status = await backups.runNow();
  assert.equal(status.lastError, undefined); assert.ok(status.lastSuccessAt);
  const [made] = readdirSync(join(root, 'merkez-yedek')).filter(n => n.startsWith('merkez-yedek-'));
  // Another computer (another user's lock, no access to this one): backup + code.
  const target = join(temp('anahtar-yedek-yeni'), 'veri');
  const proof = await restoreMerkezBackup(join(root, 'merkez-yedek', made), m.code, target);
  assert.equal(proof.businesses, 1);
  const there = await MerkezKeyGuard.open(target, { protect: true, osLock: fakeOsLock('yeni-pc') });
  assert.equal(there.state, 'open'); assert.equal(there.migrated, true, 'the restored code counts as saved: locked to the new user at once');
  assert.ok(there.key!.equals(m.key)); assert.deepEqual(businessesOf(target, there.key!), ['Yokuş Kafe']);
  assert.equal(keyOpensMerkez(target, there.key!), true);
  assert.ok((await openRecovery(readMerkezKeyFile(target)!.recovery, m.code, readMerkezKeyFile(target)!.installId)).equals(m.key));
});

test('Linux / a VDS: a passphrase (MERKEZ_KEY_PASSPHRASE) instead of DPAPI; without it the key file only (mode 600); a wrong or missing passphrase is "locked" and the code opens it', async () => {
  assert.throws(() => passphraseLock('kisa'), /en az 12/);
  const m = await plainMerkez('anahtar-parola'), pass = passphraseLock('uzun-sunucu-parolasi-1', FAST_KDF);
  const sealed = await pass.seal(m.key, 'f'.repeat(8) + '-0000-4000-8000-' + '0'.repeat(12));
  await assert.rejects(passphraseLock('baska-sunucu-parolasi', FAST_KDF).open(sealed, 'f'.repeat(8) + '-0000-4000-8000-' + '0'.repeat(12)), /Parola bu anahtarı açmadı/);
  const guard = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: pass });
  assert.equal(guard.migrated, true); assert.equal(readMerkezKeyFile(m.dir)!.osLock.kind, 'parola');
  assert.equal(guard.view(true).protectsAtRest, true);
  await MerkezKeyGuard.open(m.dir, { protect: true, osLock: pass }); // the plain copy goes
  const wrong = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: passphraseLock('yanlis-sunucu-parolasi', FAST_KDF) });
  assert.equal(wrong.state, 'locked');
  const none = await MerkezKeyGuard.open(m.dir, { protect: true, osLock: (await import('../server/os-lock.js')).fileLock });
  assert.equal(none.state, 'locked'); assert.match(none.lockReason!, /parola/i);
  await none.unlock(m.code);
  assert.equal(none.state, 'open'); assert.equal(readMerkezKeyFile(m.dir)!.osLock.kind, 'file', 'no passphrase now: the file lock');
  assert.equal(none.view(true).protectsAtRest, false);
});

/** A request with chosen headers (fetch cannot set Host). */
function raw(port: number, path: string, body: unknown, headers: Record<string, string>) {
  const text = JSON.stringify(body);
  return new Promise<{ status: number; code?: string }>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers } }, res => {
      let data = ''; res.setEncoding('utf8'); res.on('data', c => { data += c; }); res.on('end', () => { let parsed: { code?: string } = {}; try { parsed = JSON.parse(data); } catch { /* text */ } done({ status: res.statusCode ?? 0, code: parsed.code }); });
    });
    req.on('error', fail); req.end(text);
  });
}
test('Merkez runtime: locked start serves only health and the unlock screen (this computer); the code opens the full Merkez in the same process', async t => {
  const m = await plainMerkez('anahtar-sunucu');
  // The installed Mola Yönetim migrates at its start (MERKEZ_KEY_PROTECTION=1)…
  const first = await startMerkez({ directory: m.dir, port: 0, host: '127.0.0.1', serveBuild: true, protect: true, initialPassword: MERKEZ_PASSWORD, kdf: FAST_KDF, osLock: fakeOsLock('satici'), backupDirectory: join(m.dir, '..', 'yedek') });
  assert.equal(first.guard.migrated, true);
  const base1 = `http://127.0.0.1:${(first.server.address() as AddressInfo).port}`, admin1 = client(`${base1}/api/merkez/admin`);
  assert.equal((await admin1('/login', { username: 'admin', password: MERKEZ_PASSWORD })).status, 200);
  const view = (await admin1('/backup')).data.keyProtection;
  assert.equal(view.mode, 'protected'); assert.equal(view.kind, 'dpapi'); assert.equal(view.safetyCopy, true);
  assert.ok(first.store!.read().audit.some(a => a.action === 'merkez.key_protected'));
  await first.close();
  // The next start as the same user removes the plain copy kept by the migration…
  await MerkezKeyGuard.open(m.dir, { protect: true, osLock: fakeOsLock('satici') });
  assert.equal(existsSync(join(m.dir, SAFETY_COPY)), false);
  // …then Windows is reinstalled / another user: locked.
  const locked = await startMerkez({ directory: m.dir, port: 0, host: '127.0.0.1', serveBuild: true, protect: true, kdf: FAST_KDF, osLock: fakeOsLock('yeni-kullanici') });
  t.after(() => locked.close());
  const port = (locked.server.address() as AddressInfo).port, base = `http://127.0.0.1:${port}`, admin = client(`${base}/api/merkez/admin`);
  assert.equal(locked.store, undefined);
  const health = await (await fetch(`${base}/api/merkez/v1/health`)).json() as { role: string; locked?: boolean };
  assert.equal(health.role, 'merkez'); assert.equal(health.locked, true);
  assert.equal((await fetch(`${base}/api/merkez/v1/contact`)).status, 503, 'cafés: later');
  const state = await admin('/state'); assert.equal(state.status, 423); assert.equal(state.data.code, 'MERKEZ_LOCKED');
  assert.equal((await admin('/login', { username: 'admin', password: MERKEZ_PASSWORD })).status, 423);
  const lock = (await admin('/lock')).data; assert.equal(lock.locked, true); assert.equal(lock.local, true);
  // Only directly on this computer: its LAN name or a proxy header is refused before any code is looked at.
  assert.equal((await raw(port, '/api/merkez/admin/unlock', { code: m.code }, { Host: hostname().toLowerCase() })).code, 'LOCAL_ONLY');
  assert.equal((await raw(port, '/api/merkez/admin/unlock', { code: m.code }, { 'X-Forwarded-For': '10.0.0.9' })).code, 'LOCAL_ONLY');
  assert.equal((await raw(port, '/api/merkez/admin/unlock', { code: m.code }, { Origin: 'http://evil.example' })).code, 'ORIGIN_REJECTED');
  const wrong = await admin('/unlock', { code: '2222-3333-4444-5555-6666-7777' }); assert.equal(wrong.status, 403); assert.equal(wrong.data.code, 'WRONG_CODE');
  const opened = await admin('/unlock', { code: m.code }); assert.equal(opened.status, 200, JSON.stringify(opened.data));
  const after = await (await fetch(`${base}/api/merkez/v1/health`)).json() as { locked?: boolean };
  assert.equal(after.locked, undefined);
  assert.equal((await admin('/login', { username: 'admin', password: MERKEZ_PASSWORD })).status, 200);
  assert.deepEqual((await admin('/state')).data.businesses.map((b: { name: string }) => b.name), ['Yokuş Kafe']);
  assert.ok(locked.store);
});

test('Sifre-Sifirla with protection: as the same user it opens; another user is asked the recovery code (then locked to that user); 3 wrong codes change nothing; the command reads the code', async () => {
  const m = await plainMerkez('anahtar-sifre'), satici = fakeOsLock('satici');
  await MerkezKeyGuard.open(m.dir, { protect: true, osLock: satici });
  await MerkezKeyGuard.open(m.dir, { protect: true, osLock: satici });
  const same = await openOfflineReset(m.dir, { protect: true, osLock: satici });
  try { assert.equal(same.unlocked, false); assert.ok((await same.apply()).password); } finally { same.close(); }
  const other = fakeOsLock('baska');
  await assert.rejects(openOfflineReset(m.dir, { protect: true, osLock: other }), (e: OfflineResetError) => e.code === 'LOCKED');
  const asked: (string | undefined)[] = [];
  await assert.rejects(openOfflineReset(m.dir, { protect: true, osLock: other, askCode: async (_n, problem) => { asked.push(problem); return '2222-3333-4444-5555-6666-7777'; } }), (e: OfflineResetError) => e.code === 'LOCKED' && /Hiçbir şey değişmedi/.test(e.message));
  assert.equal(asked.length, 3); assert.match(asked[2]!, /yanlış/);
  assert.equal(existsSync(join(m.dir, '.mola-operation.lock')), false);
  const reset = await openOfflineReset(m.dir, { protect: true, osLock: other, askCode: async () => m.code });
  let password = '';
  try { assert.equal(reset.unlocked, true); password = (await reset.apply()).password; } finally { reset.close(); }
  assert.equal((await MerkezKeyGuard.open(m.dir, { protect: true, osLock: other })).state, 'open', 'locked again for the user who ran it');
  const s = new MerkezStore(m.dir, m.key); try { assert.equal(await adminMatches(password, s.read().admin), true); assert.equal(s.read().admin.mustChange, true); } finally { s.close(); }
  // The command (Sifre-Sifirla.cmd → merkez-sifre-sifirla): a key file from another system's lock is "locked" for this
  // computer; the code comes on stdin (a terminal asks it hidden). Then the key is locked for this computer's real user.
  const moved = join(temp('anahtar-sifre-komut'), 'veri'); copyFolder(m.dir, moved);
  const file = JSON.parse(readFileSync(join(moved, 'anahtar.json'), 'utf8'));
  for (const name of ['anahtar.json', 'anahtar.yedek.json']) writeFileSync(join(moved, name), JSON.stringify({ ...file, osLock: { kind: 'keychain', data: `anahtar-${file.installId}` } }));
  const cli = (input: string) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/merkez-sifre-sifirla.ts', moved, '--evet'], { encoding: 'utf8', input, env: { ...process.env, MERKEZ_KEY_PROTECTION: '1' } });
  const refused = cli('2222-3333-4444-5555-6666-7777\n\n');
  assert.equal(refused.status, 1, refused.stdout + refused.stderr); assert.match(refused.stdout, /kurtarma kodu/i);
  const ran = cli(`${m.code}\n`);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /yeniden kilitlendi/); assert.match(ran.stdout, /Geçici şifre\s*:\s*\S+/);
  assert.notEqual(readMerkezKeyFile(moved)!.osLock.kind, 'keychain');
  assert.equal(keyCheck(m.key), readMerkezKeyFile(moved)!.check);
});
