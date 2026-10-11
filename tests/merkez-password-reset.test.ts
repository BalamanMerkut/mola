import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { recoveryHash } from '../server/admin-factor.js';
import { adminMatches } from '../server/admin-auth.js';
import { dataLock } from '../server/data-lock.js';
import { KeyVault } from '../server/key-vault.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { MerkezRecovery } from '../server/merkez/backup.js';
import { OfflineResetError, openOfflineReset } from '../server/merkez/offline-reset.js';
import { MerkezStore } from '../server/merkez/store.js';
import { totp } from '../server/totp.js';
import { fakeOsLock, FAST_KDF } from './fake-os-lock.js';
import { client, MERKEZ_PASSWORD, temp } from './merkez-fixture.js';

const NEW = 'Yesil-Kapi-Bahce-47';
const SECRET = 'JBSWY3DPEHPK3PXP';
const BACKUP = ['0123456789abcdef0123456789abcdef', 'fedcba9876543210fedcba9876543210', 'aaaabbbbccccdddd0000111122223333'];
async function listen(server: Server) { await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/merkez/admin`; }
async function stop(server: Server) { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
/** A Merkez with its recovery code (cheap scrypt) on a test clock; `mfa`: two-step login on with known backup codes. */
async function merkez(name: string, options: { mfa?: boolean; vds?: boolean } = {}) {
  let time = Date.parse('2026-10-05T09:00:00Z');
  const dir = join(temp(name), 'merkez'), key = randomBytes(32), store = new MerkezStore(dir, key, { initialPassword: MERKEZ_PASSWORD });
  const recovery = await MerkezRecovery.open(dir, key, FAST_KDF), code = recovery.reveal(); recovery.confirm();
  if (options.mfa) store.mutate(d => { d.admin.mfa = { secret: SECRET, lastStep: 0, recoveryHashes: BACKUP.map(recoveryHash) }; });
  const mails: { to: string; subject: string }[] = [];
  const server = createServer(createMerkezApp(store, { now: () => new Date(time), recovery, sendMail: async (_s, to, subject) => { mails.push({ to, subject }); }, ...(options.vds ? { httpSecurity: { publicOrigin: 'https://y.example.com', trustLocalProxy: true } } : {}) }));
  const base = await listen(server);
  return { dir, store, code, base, mails, admin: client(base), tick: (ms: number) => { time += ms; }, now: () => time, close: async () => { await stop(server); store.close(); } };
}

test('Şifremi unuttum with the Merkez recovery code: only this computer, a strong new password, every session signed out, audit + Bildirim merkezi + e-mail', async t => {
  const m = await merkez('reset-merkez'); t.after(() => m.close());
  m.store.mutate(d => { d.mail = { settings: { enabled: true, host: 'smtp.example.com', port: 465, security: 'tls', user: 'satici@example.com', password: 'x', to: 'satici@example.com', updatedAt: new Date().toISOString() }, queue: [] }; });
  const one = client(m.base), two = client(m.base), door = client(m.base);
  for (const c of [one, two]) assert.equal((await c('/login', { username: 'admin', password: MERKEZ_PASSWORD })).status, 200);
  assert.deepEqual((await door('/reset')).data, { available: true, recoveryCode: true, email: true });
  // A malformed code is answered at once; a wrong one after the scrypt; neither says anything about the account.
  const malformed = await door('/reset/verify', { proof: 'merkez', code: 'kisa' });
  assert.equal(malformed.status, 400); assert.equal(malformed.data.code, 'INVALID_CODE'); assert.match(malformed.data.message, /24 harf/);
  const wrong = await door('/reset/verify', { proof: 'merkez', code: '2222-3333-4444-5555-6666-7777' });
  assert.equal(wrong.status, 403); assert.equal(wrong.data.code, 'WRONG_CODE');
  const ok = await door('/reset/verify', { proof: 'merkez', code: m.code.toLowerCase().replace(/-/g, ' ') });
  assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.equal(ok.data.needsAuthenticator, false); assert.match(ok.data.ticket, /^[a-f0-9]{64}$/);
  // The same strength rule as every other password; nothing changes until it passes.
  const weak = await door('/reset/complete', { ticket: ok.data.ticket, newPassword: 'Mola2026Mola!' });
  assert.equal(weak.status, 400); assert.equal(weak.data.code, 'WEAK_PASSWORD');
  assert.equal(await adminMatches(MERKEZ_PASSWORD, m.store.read().admin), true);
  const done = await door('/reset/complete', { ticket: ok.data.ticket, newPassword: NEW });
  assert.equal(done.status, 200, JSON.stringify(done.data)); assert.equal(done.data.mfaReset, false);
  assert.equal((await door('/reset/complete', { ticket: ok.data.ticket, newPassword: NEW })).data.code, 'RESET_EXPIRED', 'a ticket works once');
  for (const c of [one, two]) assert.equal((await c('/state')).status, 401, 'every admin session ended');
  assert.equal((await door('/login', { username: 'admin', password: MERKEZ_PASSWORD })).status, 401);
  assert.equal((await door('/login', { username: 'admin', password: NEW })).status, 200);
  const state = (await door('/state')).data;
  const line = state.audit.find((a: { action: string }) => a.action === 'admin.password_reset');
  assert.ok(line); assert.match(line.detail, /Merkez kurtarma kodu/);
  const alert = state.alerts.find((a: { kind: string }) => a.kind === 'admin.password_reset');
  assert.equal(alert.title, 'Yönetici şifresi değiştirildi'); assert.match(alert.text, /Merkez kurtarma kodu/);
  // SMTP is set up: "Şifreniz değiştirildi" goes to the admin address at once (here the notification address too, so the
  // alert's own e-mail is not queued a second time).
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(m.mails, [{ to: 'satici@example.com', subject: 'Mola Yönetim: Şifreniz değiştirildi' }]);
  assert.equal(m.store.read().mail!.queue.some(item => item.subject === 'Mola Yönetim: Yönetici şifresi değiştirildi'), false);
  // The code itself is never stored or echoed.
  assert.equal(JSON.stringify(m.store.read()).includes(m.code), false);
});

test('Şifremi unuttum with an MFA backup code: single use, MFA stays; with the Merkez code the Authenticator is asked too, or "Doğrulayıcıyı da sıfırla" turns it off', async t => {
  const m = await merkez('reset-mfa', { mfa: true }); t.after(() => m.close());
  const door = client(m.base);
  // A backup code (spaces/dashes and capitals are forgiven): no Authenticator needed; the code is used up by the reset.
  const viaBackup = await door('/reset/verify', { proof: 'mfa', code: BACKUP[0].toUpperCase().replace(/(.{8})/g, '$1-').slice(0, -1) });
  assert.equal(viaBackup.status, 200, JSON.stringify(viaBackup.data)); assert.equal(viaBackup.data.needsAuthenticator, false);
  assert.equal((await door('/reset/complete', { ticket: viaBackup.data.ticket, newPassword: NEW })).status, 200);
  assert.equal(m.store.read().admin.mfa!.recoveryHashes.length, 2);
  assert.equal((await door('/reset/verify', { proof: 'mfa', code: BACKUP[0] })).data.code, 'WRONG_CODE', 'single use');
  assert.equal((await door('/login', { username: 'admin', password: NEW })).data.code, 'MFA_REQUIRED', 'MFA stays as it was');
  assert.match(m.store.read().audit.at(-1)!.detail!, /yedek kod/);
  // The Merkez code with MFA on: the current Authenticator code too.
  const viaMerkez = await door('/reset/verify', { proof: 'merkez', code: m.code });
  assert.equal(viaMerkez.data.needsAuthenticator, true);
  const second = 'Mavi-Kapi-Bahce-58';
  assert.equal((await door('/reset/complete', { ticket: viaMerkez.data.ticket, newPassword: second })).data.code, 'AUTHENTICATOR_REQUIRED');
  assert.equal((await door('/reset/complete', { ticket: viaMerkez.data.ticket, newPassword: second, code: '000000' })).data.code, 'INVALID_CODE');
  m.tick(31_000);
  assert.equal((await door('/reset/complete', { ticket: viaMerkez.data.ticket, newPassword: second, code: totp(SECRET, m.now()) })).status, 200);
  assert.ok(m.store.read().admin.mfa, 'MFA kept');
  assert.equal(await adminMatches(second, m.store.read().admin), true);
  // Lost the Authenticator: "Doğrulayıcıyı da sıfırla" turns two-step login off, said in the history and the notice.
  const lost = await door('/reset/verify', { proof: 'merkez', code: m.code });
  const off = await door('/reset/complete', { ticket: lost.data.ticket, newPassword: NEW, resetAuthenticator: true });
  assert.equal(off.status, 200); assert.equal(off.data.mfaReset, true);
  assert.equal(m.store.read().admin.mfa, undefined);
  assert.equal((await door('/login', { username: 'admin', password: NEW })).status, 200, 'no Authenticator code needed any more');
  const state = (await door('/state')).data;
  assert.ok(state.audit.some((a: { action: string }) => a.action === 'admin.mfa_reset'));
  assert.ok(state.alerts.some((a: { kind: string; text: string }) => a.kind === 'admin.password_reset' && /İki adımlı giriş de kapatıldı/.test(a.text)));
});

test('Şifremi unuttum: wrong codes are limited per address and overall, and the answers never tell whether MFA is on', async t => {
  const m = await merkez('reset-limits'); t.after(() => m.close());
  const door = client(m.base);
  // No MFA here: a backup code is answered exactly like a wrong one on an account with MFA.
  const noMfa = await door('/reset/verify', { proof: 'mfa', code: BACKUP[1] });
  const withMfa = await merkez('reset-limits-mfa', { mfa: true }); t.after(() => withMfa.close());
  const wrongWithMfa = await client(withMfa.base)('/reset/verify', { proof: 'mfa', code: 'ffffffffffffffffffffffffffffffff' });
  assert.deepEqual([noMfa.status, noMfa.data.code, noMfa.data.message], [wrongWithMfa.status, wrongWithMfa.data.code, wrongWithMfa.data.message]);
  // Merkez code: five wrong ones (with the backup try above: the address is already counting), then even the right code waits.
  for (let i = 0; i < 4; i++) assert.equal((await door('/reset/verify', { proof: 'merkez', code: '2222-3333-4444-5555-6666-777' + (i + 2) })).data.code, 'WRONG_CODE');
  const held = await door('/reset/verify', { proof: 'merkez', code: m.code });
  assert.equal(held.status, 429); assert.match(held.data.message, /Çok fazla yanlış deneme/);
  // After the wait the address may try again, but the Merkez code itself allows 5 wrong ones per 10 minutes.
  m.tick(2000);
  assert.equal((await door('/reset/verify', { proof: 'merkez', code: '2222-3333-4444-5555-6666-7788' })).data.code, 'WRONG_CODE');
  m.tick(5000);
  assert.equal((await door('/reset/verify', { proof: 'merkez', code: m.code })).status, 429, 'Merkez code: 10 minutes');
  m.tick(11 * 60_000);
  assert.equal((await door('/reset/verify', { proof: 'merkez', code: m.code })).status, 200, 'after the window the right code works');
  // MFA backup codes: five wrong ones from one address, then it waits.
  const guess = client(withMfa.base);
  for (let i = 0; i < 4; i++) assert.equal((await guess('/reset/verify', { proof: 'mfa', code: `${i}`.repeat(32) })).data.code, 'WRONG_CODE');
  assert.equal((await guess('/reset/verify', { proof: 'mfa', code: BACKUP[2] })).status, 429);
});

/** A request with chosen headers (fetch cannot set Host). */
function raw(base: string, path: string, body: unknown, headers: Record<string, string>) {
  const url = new URL(base + path), text = JSON.stringify(body);
  return new Promise<{ status: number; code?: string }>((done, fail) => {
    const req = request({ host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers } }, res => {
      let data = ''; res.setEncoding('utf8'); res.on('data', c => { data += c; }); res.on('end', () => { let parsed: { code?: string } = {}; try { parsed = JSON.parse(data); } catch { /* text */ } done({ status: res.statusCode ?? 0, code: parsed.code }); });
    });
    req.on('error', fail); req.end(text);
  });
}
test('Şifremi unuttum is refused from anywhere but this computer: LAN name, proxy, public HTTPS Merkez', async t => {
  const m = await merkez('reset-local'); t.after(() => m.close());
  const body = { proof: 'merkez', code: m.code };
  // This computer's own name (what a LAN browser would send) and a proxy in between: refused before any code is looked at.
  const lan = await raw(m.base, '/reset/verify', body, { Host: hostname().toLowerCase() });
  assert.equal(lan.status, 403); assert.equal(lan.code, 'LOCAL_ONLY');
  const proxied = await raw(m.base, '/reset/verify', body, { 'X-Forwarded-For': '192.168.1.40' });
  assert.equal(proxied.status, 403); assert.equal(proxied.code, 'LOCAL_ONLY');
  // A Merkez on a VDS (PUBLIC_ORIGIN): never through the web, even with the right code; the vendor uses the server's command.
  const vds = await merkez('reset-vds', { vds: true }); t.after(() => vds.close());
  const headers = { 'Content-Type': 'application/json', Origin: 'https://y.example.com', 'X-Forwarded-Proto': 'https' };
  const info = await fetch(`${vds.base}/reset`, { headers }); assert.equal(((await info.json()) as { available: boolean }).available, false);
  const remote = await fetch(`${vds.base}/reset/verify`, { method: 'POST', headers, body: JSON.stringify({ proof: 'merkez', code: vds.code }) });
  assert.equal(remote.status, 403); assert.equal(((await remote.json()) as { code: string }).code, 'LOCAL_ONLY');
  assert.equal(await adminMatches(MERKEZ_PASSWORD, vds.store.read().admin), true);
});

test('Sifre-Sifirla (offline): a stopped Merkez only, opened like the server opens it, a one-time password that must be changed; the command line too', async t => {
  const root = temp('reset-offline'), dir = join(root, 'veri'), key = randomBytes(32);
  mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'development.key'), key);
  const created = new MerkezStore(dir, key);
  assert.ok(existsSync(join(dir, 'merkez-first-login.txt')));
  created.mutate(d => { d.admin.mfa = { secret: SECRET, lastStep: 0, recoveryHashes: [] }; }); created.close();
  // No data here, or Merkez running (its data lock): nothing happens.
  await assert.rejects(openOfflineReset(join(root, 'bos')), (e: OfflineResetError) => e.code === 'NO_DATA');
  const running = dataLock(dir, 'merkez');
  await assert.rejects(openOfflineReset(dir), (e: OfflineResetError) => e.code === 'RUNNING' && /Merkez-Durdur\.cmd/.test(e.message));
  running();
  const reset = await openOfflineReset(dir);
  let password = '';
  try { assert.equal(reset.mfa, true); password = (await reset.apply()).password; } finally { reset.close(); }
  assert.match(password, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  assert.equal(existsSync(join(dir, 'merkez-first-login.txt')), false, 'the stale first password is not shown any more');
  assert.equal(existsSync(join(dir, '.mola-operation.lock')), false, 'the data lock is released');
  const store = new MerkezStore(dir, key), server = createServer(createMerkezApp(store, { now: () => new Date(Date.parse('2026-10-05T12:00:00Z')) })), base = await listen(server);
  let open = true; t.after(async () => { if (open) { await stop(server); store.close(); } });
  const d = store.read();
  assert.equal(d.admin.mustChange, true); assert.ok(d.admin.mfa, 'MFA stays unless asked'); assert.equal(await adminMatches(password, d.admin), true);
  assert.ok(d.audit.some(a => a.action === 'admin.password_reset_offline' && a.by === 'system'));
  assert.ok(d.alerts!.some(a => a.kind === 'admin.password_reset' && /Sifre-Sifirla/.test(a.text)));
  assert.equal(JSON.stringify(d).includes(password), false);
  // The forced first-password change: the temporary password opens nothing else.
  store.mutate(x => { delete x.admin.mfa; });
  const admin = client(base);
  assert.equal((await admin('/login', { username: 'admin', password })).data.mustChangePassword, true);
  assert.equal((await admin('/state')).data.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await admin('/password', { currentPassword: password, newPassword: NEW })).status, 200);
  assert.equal((await admin('/login', { username: 'admin', password: NEW })).status, 200);
  assert.equal(store.read().admin.mustChange, undefined);
  open = false; await stop(server); store.close();
  // The command (npm run merkez:sifre-sifirla): exit 3 while Merkez runs, then the password on the screen; MFA off on request.
  const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/merkez-sifre-sifirla.ts', ...args], { encoding: 'utf8', env: { ...process.env, MERKEZ_KEY_PROTECTION: '' } });
  const held = dataLock(dir, 'merkez');
  const busy = cli(dir, '--evet'); held();
  assert.equal(busy.status, 3, busy.stderr); assert.match(busy.stderr, /çalışıyor/);
  assert.equal(cli(dir).status, 2, 'no terminal and no --evet: nothing is done');
  const reopened = new MerkezStore(dir, key); reopened.mutate(x => { x.admin.mfa = { secret: SECRET, lastStep: 0, recoveryHashes: [] }; }); reopened.close();
  const ran = cli(dir, '--evet', '--iki-adimli-kapat');
  assert.equal(ran.status, 0, ran.stderr);
  const printed = ran.stdout.match(/Geçici şifre\s*:\s*(\S+)/)?.[1];
  assert.ok(printed, ran.stdout); assert.match(ran.stdout, /İki adımlı giriş kapatıldı/);
  const after = new MerkezStore(dir, key);
  try { assert.equal(await adminMatches(printed!, after.read().admin), true); assert.equal(after.read().admin.mfa, undefined); assert.equal(after.read().admin.mustChange, true); }
  finally { after.close(); }
});

test('Sifre-Sifirla on a protected Merkez: only the computer user who owns the data opens it', async () => {
  const dir = join(temp('reset-offline-protected'), 'veri'), owner = fakeOsLock('satici');
  const vault = await KeyVault.open(dir, { protect: true, osLock: owner, kdf: FAST_KDF });
  new MerkezStore(dir, vault.key!, { initialPassword: MERKEZ_PASSWORD }).close();
  await assert.rejects(openOfflineReset(dir, { protect: true, osLock: fakeOsLock('baska-kullanici'), kdf: FAST_KDF }), (e: OfflineResetError) => e.code === 'LOCKED' && /bilgisayar kullanıcısıyla/.test(e.message));
  assert.equal(existsSync(join(dir, '.mola-operation.lock')), false, 'the lock is released after a refusal');
  const reset = await openOfflineReset(dir, { protect: true, osLock: owner, kdf: FAST_KDF });
  try { const { password } = await reset.apply(); assert.ok(password); } finally { reset.close(); }
});
