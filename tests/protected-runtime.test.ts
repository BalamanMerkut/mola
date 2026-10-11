import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Request } from 'express';
import { startLocalServer } from '../server/runtime.js';
import { Store } from '../server/store.js';
import { KeyVault, KEY_FILE, RAW_KEY, adoptKey, readKeyFile } from '../server/key-vault.js';
import { createBackup, restoreBackup } from '../server/backup.js';
import { fromThisComputer } from '../server/security-routes.js';
import { DEMO_PASSWORD } from '../server/app.js';
import type { DomainError } from '../packages/domain/engine.js';
import { FAST_KDF, assertNoSecrets, fakeOsLock, type FakeLock } from './fake-os-lock.js';
// Never pick up a real Mola install's copies (OneDrive, USB stick) on the developer's machine.
process.env.MOLA_BACKUP_DISCOVERY = '0';

const folder = (name: string) => { mkdirSync('.local/tests', { recursive: true }); return mkdtempSync(resolve(`.local/tests/${name}-`)); };
async function freePort() { const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = (probe.address() as AddressInfo).port; await new Promise<void>(r => probe.close(() => r())); return port; }
/** Everything the server prints during a test, so it can be searched for secrets. */
function captureLog() {
  const original = { log: console.log, warn: console.warn, error: console.error }; let text = '';
  for (const name of ['log', 'warn', 'error'] as const) console[name] = (...args: unknown[]) => { text += args.map(String).join(' ') + '\n'; };
  return { text: () => text, restore: () => Object.assign(console, original) };
}
async function start(root: string, lock: FakeLock, clean = false) {
  const port = await freePort(), keyFile = join(root, 'masaustu.anahtar');
  const runtime = await startLocalServer({ directory: join(root, 'veri'), port, host: '127.0.0.1', serveBuild: true, cleanInstall: clean, desktopKeyFile: keyFile, keyProtection: { protect: true, osLock: lock, kdf: FAST_KDF } });
  const base = `http://127.0.0.1:${port}`, token = readFileSync(keyFile, 'utf8');
  const call = async (path: string, options: { body?: unknown; desktop?: boolean; headers?: Record<string, string>; cookie?: string } = {}) => {
    const r = await fetch(base + path, { method: options.body === undefined ? 'GET' : 'POST', headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(options.desktop ? { 'X-Mola-Desktop': token } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}), ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const text = await r.text(); let data: Record<string, unknown> = {}; try { data = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, data, text, cookie: r.headers.getSetCookie()[0]?.split(';')[0] };
  };
  return { runtime, call, token };
}

test('locked data answers 423 everywhere; only the desktop window on this computer unlocks it, and it is re-locked for the new user', async () => {
  const root = folder('locked-runtime'), oldPc = fakeOsLock('eski-windows'), newPc = fakeOsLock('yeni-windows');
  const log = captureLog();
  try {
    let cafe = await start(root, oldPc);
    const code = (await cafe.call('/api/desktop/recovery/show', { body: {}, desktop: true })).data.code as string;
    assert.match(code, /^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
    await cafe.call('/api/desktop/recovery/confirm', { body: {}, desktop: true });
    const key = cafe.runtime.vault().key!;
    await cafe.runtime.close();

    cafe = await start(root, newPc);
    assert.equal(cafe.runtime.vault().state, 'locked');
    const health = await cafe.call('/api/health');
    assert.equal(health.status, 200); assert.equal(health.data.locked, true);
    for (const [path, body] of [['/api/staff/state'], ['/api/guest/state'], ['/api/activation'], ['/api/login', { username: 'isletme', password: DEMO_PASSWORD }], ['/api/staff/support'], ['/api/guest/session', { token: 'abcdefgh12' }], ['/api/desktop/backup', {}]] as [string, unknown?][]) {
      const r = await cafe.call(path, { body, desktop: true });
      assert.equal(r.status, 423, path); assert.equal(r.data.code, 'LOCKED'); assert.match(String(r.data.message), /Kasa bilgisayarında kilit açılmalı/);
    }
    assert.match((await cafe.call('/')).text, /<div id="root">/, 'the screens still load, to show the locked message');
    // The launcher's own check works while locked; nobody else learns the route exists.
    assert.equal((await cafe.call('/api/desktop/status', { desktop: true })).data.locked, true);
    assert.equal((await cafe.call('/api/desktop/status')).status, 404);
    // Not from a tablet, a tunnel or a proxy: without the window's key, or with any forwarding header, it does not exist.
    assert.equal((await cafe.call('/api/desktop/unlock', { body: { code } })).status, 404);
    for (const header of ['X-Forwarded-For', 'Cf-Connecting-Ip', 'Forwarded', 'X-Real-Ip']) assert.equal((await cafe.call('/api/desktop/unlock', { body: { code }, desktop: true, headers: { [header]: '203.0.113.9' } })).status, 404, header);
    assert.equal(fromThisComputer({ headers: {}, socket: { remoteAddress: '192.168.1.20' } } as unknown as Request), false, 'a tablet on the café Wi-Fi');
    assert.equal(fromThisComputer({ headers: { host: '127.0.0.1:3000' }, socket: { remoteAddress: '127.0.0.1' } } as unknown as Request), true);
    assert.equal(fromThisComputer({ headers: { host: 'evil.example' }, socket: { remoteAddress: '127.0.0.1' } } as unknown as Request), false, 'a rebound DNS name pointing at this computer');
    const wrong = await cafe.call('/api/desktop/unlock', { body: { code: '2222-3333-4444-5555-6666-7777' }, desktop: true });
    assert.equal(wrong.status, 403); assert.equal(wrong.data.code, 'WRONG_CODE');
    assert.equal((await cafe.call('/api/desktop/unlock', { body: { code: 'yanlis' }, desktop: true })).data.code, 'INVALID_CODE');
    const opened = await cafe.call('/api/desktop/unlock', { body: { code: code.toLowerCase() }, desktop: true });
    assert.equal(opened.status, 200, JSON.stringify(opened.data));
    assert.equal((await cafe.call('/api/health')).data.locked, undefined);
    assert.equal((await cafe.call('/api/login', { body: { username: 'isletme', password: DEMO_PASSWORD } })).status, 200, 'the café works again');
    assert.equal((await cafe.call('/api/desktop/unlock', { body: { code }, desktop: true })).status, 404, 'unlock exists only while locked');
    await cafe.runtime.close();

    cafe = await start(root, newPc);
    assert.equal(cafe.runtime.vault().state, 'open', 'the new user opens it without the code');
    await cafe.runtime.close();
    cafe = await start(root, oldPc);
    assert.equal(cafe.runtime.vault().state, 'locked', 'the old lock no longer opens it');
    await cafe.runtime.close();
    log.restore();
    assertNoSecrets(root, key, [code], log.text());
  } finally { log.restore(); }
});

test('wrong recovery codes through the window are limited', async () => {
  const root = folder('locked-limit');
  let cafe = await start(root, fakeOsLock('a'));
  await cafe.runtime.close();
  cafe = await start(root, fakeOsLock('b'));
  try {
    for (let i = 0; i < 5; i++) assert.equal((await cafe.call('/api/desktop/unlock', { body: { code: '2222-3333-4444-5555-6666-7777' }, desktop: true })).status, 403);
    const blocked = await cafe.call('/api/desktop/unlock', { body: { code: '2222-3333-4444-5555-6666-7777' }, desktop: true });
    assert.equal(blocked.status, 429); assert.match(String(blocked.data.message), /10 dakika/);
  } finally { await cafe.runtime.close(); }
});

test('recovery card: the code is shown only until it is confirmed; a new code needs an owner password; the code resets a forgotten owner password', async () => {
  const root = folder('recovery-api'), lock = fakeOsLock();
  const log = captureLog();
  const cafe = await start(root, lock);
  try {
    // The vendor's panel is not on the café computer any more: only this computer's window shows the code.
    assert.equal((await cafe.call('/api/platform/recovery')).status, 404);
    let view = (await cafe.call('/api/desktop/recovery', { desktop: true })).data;
    assert.equal(view.protection, 'dpapi'); assert.equal(view.available, true); assert.equal(view.confirmed, false);
    assert.equal(((await cafe.call('/api/desktop/status', { desktop: true })).data.security as { recoveryConfirmed: boolean }).recoveryConfirmed, false);
    const first = (await cafe.call('/api/desktop/recovery/show', { body: {}, desktop: true })).data.code as string;
    view = (await cafe.call('/api/desktop/recovery/confirm', { body: {}, desktop: true })).data;
    assert.equal(view.confirmed, true); assert.equal(view.available, false);
    assert.equal((await cafe.call('/api/desktop/recovery/show', { body: {}, desktop: true })).status, 409, 'never shown again');
    // Never over the café network (plain HTTP) or through a proxy/tunnel.
    const proxied = await cafe.call('/api/desktop/recovery/new', { body: { password: DEMO_PASSWORD }, desktop: true, headers: { 'X-Forwarded-For': '192.168.1.20' } });
    assert.equal(proxied.status, 404);
    // A protected backup: its key travels sealed inside it, no key file is written.
    const backup = await cafe.call('/api/desktop/backup', { body: {}, desktop: true });
    assert.equal(backup.status, 200); assert.equal(backup.data.lastError, null);
    assert.deepEqual(readdirSync(join(root, 'backup-keys')), []);
    const backupDir = join(root, 'backups', readdirSync(join(root, 'backups')).find(n => n.startsWith('backup-'))!);
    const wrong = await cafe.call('/api/desktop/recovery/new', { body: { password: 'yanlis-sifre' }, desktop: true });
    assert.equal(wrong.status, 403); assert.match(String(wrong.data.message), /İşletme sahibi şifresi/);
    // Only an active owner's exact password counts (a near miss does not).
    assert.equal((await cafe.call('/api/desktop/recovery/new', { body: { password: DEMO_PASSWORD.slice(0, -1) }, desktop: true })).status, 403);
    const renewed = await cafe.call('/api/desktop/recovery/new', { body: { password: DEMO_PASSWORD }, desktop: true });
    assert.equal(renewed.status, 200); const second = renewed.data.code as string; assert.notEqual(second, first);
    assert.equal((await cafe.call('/api/desktop/recovery', { desktop: true })).data.confirmed, false, 'a new code waits for "Kodu kaydettim"');
    // The old code opens nothing any more: not the key file, not the backup made before the change.
    await assert.rejects(restoreBackup(backupDir, { code: first }, join(root, 'r1')), (e: DomainError) => e.code === 'WRONG_CODE');
    const restored = await restoreBackup(backupDir, { code: second }, join(root, 'r2'));
    assert.ok(restored.master!.equals(cafe.runtime.vault().key!));
    // The owner forgot the password: the recovery code on paper sets a new one, only from this computer's window.
    const owner = (await cafe.call('/api/login', { body: { username: 'isletme', password: DEMO_PASSWORD } })).cookie!;
    const reset = { username: 'isletme', code: second, newPassword: 'YeniSahipSifresi!2026' };
    assert.equal((await cafe.call('/api/desktop/owner-password', { body: reset })).status, 404, 'not without the window key');
    assert.equal((await cafe.call('/api/desktop/owner-password', { body: { ...reset, code: first }, desktop: true })).data.code, 'WRONG_CODE');
    assert.equal((await cafe.call('/api/desktop/owner-password', { body: { ...reset, username: 'garson' }, desktop: true })).status, 404, 'owners only');
    // Step 1 (the owner forgot the username too): the code alone lists this computer's owner accounts; not over the network.
    assert.equal((await cafe.call('/api/desktop/owner-password/owners', { body: { code: first }, desktop: true })).data.code, 'WRONG_CODE');
    assert.equal((await cafe.call('/api/desktop/owner-password/owners', { body: { code: second }, desktop: true, headers: { 'X-Forwarded-For': '192.168.1.20' } })).status, 404);
    assert.equal((await cafe.call('/api/desktop/owner-password/owners', { body: { code: second } })).status, 404, 'not without the window key');
    const listed = await cafe.call('/api/desktop/owner-password/owners', { body: { code: second.toLowerCase() }, desktop: true });
    assert.equal(listed.status, 200); assert.deepEqual((listed.data.owners as { username: string }[]).map(o => o.username).sort(), ['diger', 'isletme']);
    assert.equal((await cafe.call('/api/desktop/owner-password', { body: reset, desktop: true })).status, 200);
    assert.equal((await cafe.call('/api/staff/state', { cookie: owner })).status, 401, 'the old session ends');
    assert.equal((await cafe.call('/api/login', { body: { username: 'isletme', password: reset.newPassword } })).status, 200);
    assert.equal((await cafe.call('/api/login', { body: { username: 'garson', password: DEMO_PASSWORD } })).status, 200, 'staff accounts unchanged');
    const key = cafe.runtime.vault().key!;
    await cafe.runtime.close();
    log.restore();
    for (const dir of ['veri', 'backups', 'backup-keys']) assertNoSecrets(join(root, dir), key, [first, second], log.text());
  } finally { log.restore(); await cafe.runtime.close(); }
});

test('a clean install on a new computer restores a protected backup with the recovery code, from the second place', async () => {
  const log = captureLog();
  const cafeRoot = folder('restore-old-pc'), newRoot = folder('restore-new-pc');
  try {
    const old = await start(cafeRoot, fakeOsLock('eski-pc'));
    const code = (await old.call('/api/desktop/recovery/show', { body: {}, desktop: true })).data.code as string;
    await old.call('/api/desktop/recovery/confirm', { body: {}, desktop: true });
    const flash = join(cafeRoot, 'flash'); mkdirSync(flash);
    const place = await old.call('/api/desktop/second-backup', { body: { folder: flash, kind: 'usb', label: 'Flash bellek' }, desktop: true });
    assert.equal(place.status, 200, JSON.stringify(place.data)); assert.equal(place.data.folder, flash);
    assert.equal((await old.call('/api/desktop/restore/backups', { desktop: true })).data.code, 'NOT_CLEAN', 'never over a working café');
    assert.equal((await old.call('/api/desktop/backup', { body: {}, desktop: true })).data.lastError, null);
    const status = (await old.call('/api/desktop/second-backup', { desktop: true })).data;
    assert.ok(status.lastCopyAt); assert.equal(status.lastError, undefined);
    const oldKey = old.runtime.vault().key!;
    await old.runtime.close();

    const fresh = await start(newRoot, fakeOsLock('yeni-pc'), true);
    const desk = (await fresh.call('/api/desktop/status', { desktop: true })).data.security as { clean: boolean };
    assert.equal(desk.clean, true);
    const freshCode = (await fresh.call('/api/desktop/recovery/show', { body: {}, desktop: true })).data.code as string;
    const found = await fresh.call(`/api/desktop/restore/backups?folder=${encodeURIComponent(flash)}`, { desktop: true });
    assert.equal(found.status, 200); const backups = found.data.backups as { path: string; verified: boolean }[];
    assert.equal(backups.length, 1); assert.equal(backups[0].verified, true);
    assert.equal((await fresh.call('/api/desktop/restore', { body: { backup: backups[0].path, code } })).status, 404, 'desktop window only');
    const wrong = await fresh.call('/api/desktop/restore', { body: { backup: backups[0].path, code: freshCode }, desktop: true });
    assert.equal(wrong.status, 403, 'this install\'s own code does not open another café\'s backup');
    const done = await fresh.call('/api/desktop/restore', { body: { backup: backups[0].path, code }, desktop: true });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    assert.equal((await fresh.call('/api/login', { body: { username: 'isletme', password: DEMO_PASSWORD } })).status, 200, 'the old café is here');
    assert.equal(((await fresh.call('/api/desktop/status', { desktop: true })).data.security as { clean: boolean; recoveryConfirmed: boolean }).clean, false);
    assert.equal((await fresh.call('/api/desktop/restore', { body: { backup: backups[0].path, code }, desktop: true })).data.code, 'NOT_CLEAN');
    assert.ok(readdirSync(newRoot).some(n => n.startsWith('veri-bos-kurulum-')), 'the empty install is kept aside');
    assert.equal(existsSync(join(newRoot, 'veri', RAW_KEY)), false);
    await fresh.runtime.close();
    // Locked for the new computer's user: it opens without the code; the old computer's lock does not open it.
    const again = await start(newRoot, fakeOsLock('yeni-pc'));
    assert.equal(again.runtime.vault().state, 'open'); assert.ok(again.runtime.vault().key!.equals(oldKey));
    assert.equal(again.runtime.vault().view().confirmed, true, 'the code just used counts as saved');
    await again.runtime.close();
    log.restore();
    for (const r of [cafeRoot, newRoot]) assertNoSecrets(r, oldKey, [code, freshCode], log.text());
  } finally { log.restore(); }
});

test('old-format backups (raw key file) still restore, and a protected start migrates the restored raw key', async () => {
  const root = folder('old-format');
  const legacy = join(root, 'eski'), store = new Store(legacy, ['mola-demo']); store.mutate('mola-demo', s => { s.name = 'Eski biçim'; }); store.close();
  const made = await createBackup(legacy, join(root, 'backups'), join(root, 'keys'));
  assert.ok(existsSync(made.keyPath));
  await assert.rejects(restoreBackup(made.directory, { code: '2222-3333-4444-5555-6666-7777' }, join(root, 'r')), (e: DomainError) => e.code === 'OLD_BACKUP');
  const restored = await restoreBackup(made.directory, made.keyPath, join(root, 'r'));
  const raw = readFileSync(join(restored.directory, RAW_KEY));
  const vault = await KeyVault.open(restored.directory, { protect: true, osLock: fakeOsLock(), kdf: FAST_KDF });
  assert.ok(vault.key!.equals(raw)); assert.equal(existsSync(join(restored.directory, RAW_KEY)), false); assert.ok(readKeyFile(restored.directory));
  const opened = new Store(restored.directory, [], { key: vault.key! }); assert.equal(opened.read('mola-demo').name, 'Eski biçim'); opened.close();
  // adoptKey refuses a key that does not open the data it is given for.
  await assert.rejects(adoptKey(restored.directory, Buffer.alloc(32, 7), readKeyFile(restored.directory)!.recovery, vault.installId!, fakeOsLock()), /açılmıyor/);
  assert.ok(existsSync(join(restored.directory, KEY_FILE)));
});

test('after migration nothing on the disk holds the raw key: old backups are sealed and safety copies re-keyed, all still restorable', async () => {
  const root = folder('migrate-leftovers'), data = join(root, 'veri');
  const store = new Store(data, ['mola-demo']); store.mutate('mola-demo', s => { s.name = 'Korumadan önce'; }); store.close();
  const raw = readFileSync(join(data, RAW_KEY));
  // Nightly backups taken while the install was still unprotected: raw key files in backup-keys.
  const { BackupScheduler } = await import('../server/backup-scheduler.js');
  const old = new BackupScheduler(data, { backups: join(root, 'backups'), keys: join(root, 'backup-keys'), checks: join(root, 'restore-checks') });
  assert.equal((await old.runNow()).lastError, undefined);
  assert.equal(readdirSync(join(root, 'backup-keys')).length, 1);
  const oldBackup = join(root, 'backups', readdirSync(join(root, 'backups')).find(n => n.startsWith('backup-'))!);
  // A copy kept before a data version upgrade, with the raw key in it.
  const copy = join(root, 'veri-tasima-oncesi-2026-01-01'); mkdirSync(copy);
  const { copyFileSync, writeFileSync } = await import('node:fs');
  copyFileSync(join(data, RAW_KEY), join(copy, RAW_KEY)); copyFileSync(join(data, 'merchant.sqlite'), join(copy, 'merchant.sqlite')); writeFileSync(join(copy, 'BENIOKU.txt'), 'Eski kopya.\n');
  const log = captureLog();
  const cafe = await start(root, fakeOsLock());
  try {
    const code = (await cafe.call('/api/desktop/recovery/show', { body: {}, desktop: true })).data.code as string;
    for (let i = 0; i < 40 && readdirSync(join(root, 'backup-keys')).length; i++) await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(readdirSync(join(root, 'backup-keys')), [], 'raw backup key files are gone');
    assert.ok(existsSync(join(oldBackup, 'anahtar-kurtarma.json')));
    assert.equal(existsSync(join(copy, RAW_KEY)), false); assert.ok(existsSync(join(copy, KEY_FILE)));
    assert.match(readFileSync(join(copy, 'BENIOKU.txt'), 'utf8'), /korumaya alındı/);
    await cafe.runtime.close(); log.restore();
    assertNoSecrets(root, raw, [code], log.text());
    // Still restorable: the old backup with the recovery code (on another computer), the copy with this computer's lock.
    const elsewhere = folder('migrate-leftovers-restore');
    const restored = await restoreBackup(oldBackup, { code }, elsewhere);
    await adoptKey(restored.directory, restored.master!, restored.recovery!, restored.installId!, fakeOsLock('baska-pc'));
    assert.equal(existsSync(join(restored.directory, RAW_KEY)), false, 'the raw key inside an old backup is not left on the new computer');
    const reopened = await KeyVault.open(restored.directory, { protect: true, osLock: fakeOsLock('baska-pc'), kdf: FAST_KDF });
    const s = new Store(restored.directory, [], { key: reopened.key! }); assert.equal(s.read('mola-demo').name, 'Korumadan önce'); s.close();
    const copyVault = await KeyVault.open(copy, { protect: true, osLock: fakeOsLock(), kdf: FAST_KDF });
    assert.ok(copyVault.key!.equals(raw));
  } finally { log.restore(); await cafe.runtime.close(); }
});

test('developer CLI: restore-with-code reads the code from stdin (never argv) and leaves a verified, re-locked folder', { skip: process.platform === 'darwin' }, async () => {
  const root = folder('cli-restore'), data = join(root, 'veri');
  const vault = await KeyVault.open(data, { protect: true, osLock: fakeOsLock(), kdf: FAST_KDF }); const code = vault.reveal(); vault.confirm();
  const store = new Store(data, ['mola-demo'], { key: vault.key! }); store.mutate('mola-demo', s => { s.name = 'Komut satırı'; }); store.close();
  const { BackupScheduler } = await import('../server/backup-scheduler.js');
  const scheduler = new BackupScheduler(data, { backups: join(root, 'backups'), keys: join(root, 'keys'), checks: join(root, 'checks'), protection: () => vault.backupProtection() });
  assert.equal((await scheduler.runNow()).lastError, undefined);
  const backup = scheduler.status().lastDirectory!;
  const { spawn } = await import('node:child_process');
  const run = (input: string) => new Promise<{ code: number | null; out: string; err: string }>(done => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/backup.ts', 'restore-with-code', backup, join(root, 'cikti')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', c => done({ code: c, out, err })); child.stdin.end(input);
  });
  const wrong = await run('2222-3333-4444-5555-6666-7777\n');
  assert.notEqual(wrong.code, 0); assert.match(wrong.err, /Kurtarma kodu yanlış/);
  const ok = await run(`${code}\n`);
  assert.equal(ok.code, 0, ok.err);
  const result = JSON.parse(ok.out) as { directory: string; files: number };
  assert.ok(existsSync(join(result.directory, KEY_FILE))); assert.equal(existsSync(join(result.directory, RAW_KEY)), false);
  assert.equal(ok.out.includes(code) || ok.err.includes(code) || ok.out.includes(vault.key!.toString('hex')), false, 'nothing secret printed');
  assert.equal(readKeyFile(result.directory)!.osLock.kind, process.platform === 'win32' ? 'dpapi' : 'file');
});

test('development (no protection) keeps working as before and says so', async () => {
  const root = folder('dev-runtime'), port = await freePort();
  const runtime = await startLocalServer({ directory: join(root, 'veri'), port, host: '127.0.0.1', serveBuild: true, cleanInstall: true, desktopKeyFile: join(root, 'k') });
  try {
    const token = readFileSync(join(root, 'k'), 'utf8'), get = (p: string) => fetch(`http://127.0.0.1:${port}${p}`, { headers: { 'X-Mola-Desktop': token } }).then(r => r.json());
    assert.ok(existsSync(join(root, 'veri', RAW_KEY))); assert.equal(existsSync(join(root, 'veri', KEY_FILE)), false);
    assert.equal((await get('/api/desktop/recovery')).protection, 'off');
    assert.equal((await get('/api/desktop/second-backup')).available, false);
  } finally { await runtime.close(); }
});
