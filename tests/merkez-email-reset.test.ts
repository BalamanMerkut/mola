import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { adminMatches } from '../server/admin-auth.js';
import { recoveryHash } from '../server/admin-factor.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { MerkezRecovery } from '../server/merkez/backup.js';
import type { MailSettings } from '../server/merkez/alerts.js';
import { MerkezStore } from '../server/merkez/store.js';
import { totp } from '../server/totp.js';
import { FAST_KDF } from './fake-os-lock.js';
import { client, MERKEZ_PASSWORD, temp } from './merkez-fixture.js';

/*
 * "Şifremi unuttum → E-postama kod gönder" (server/admin-auth.ts, wired in server/merkez/app.ts): a 6-digit code to the admin
 * e-mail, 15 minutes, single use; with two-step login on the Authenticator code too (or the Merkez recovery code instead).
 * Mail goes through a fake sender (no network).
 */
const NEW = 'Yesil-Kapi-Bahce-47', SECRET = 'JBSWY3DPEHPK3PXP', ADMIN_MAIL = 'Satici@Example.com';
type Sent = { to: string; subject: string; text: string };
const SMTP: MailSettings = { enabled: true, host: 'smtp.example.com', port: 465, security: 'tls', user: 'bildirim@example.com', password: 'uygulama-sifresi', to: 'bildirim@example.com', adminEmail: ADMIN_MAIL, updatedAt: '2026-10-05T09:00:00.000Z' };
async function listen(server: Server) { await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/merkez/admin`; }
async function merkez(name: string, options: { smtp?: MailSettings | null; mfa?: boolean; vds?: boolean } = {}) {
  let time = Date.parse('2026-10-05T09:00:00Z');
  const dir = join(temp(name), 'merkez'), key = randomBytes(32), store = new MerkezStore(dir, key, { initialPassword: MERKEZ_PASSWORD });
  const recovery = await MerkezRecovery.open(dir, key, FAST_KDF), code = recovery.reveal(); recovery.confirm();
  const smtp = options.smtp === undefined ? SMTP : options.smtp;
  store.mutate(d => { if (smtp) d.mail = { settings: smtp, queue: [] }; if (options.mfa) d.admin.mfa = { secret: SECRET, lastStep: 0, recoveryHashes: [recoveryHash('0123456789abcdef0123456789abcdef')] }; });
  const sent: Sent[] = [];
  const sendMail = async (_s: MailSettings, to: string, subject: string, text: string) => { sent.push({ to, subject, text }); };
  const server = createServer(createMerkezApp(store, { now: () => new Date(time), recovery, sendMail, ...(options.vds ? { httpSecurity: { publicOrigin: 'https://y.example.com', trustLocalProxy: true } } : {}) }));
  const base = await listen(server);
  /** The fire-and-forget sends finish on the next turns of the event loop. */
  const settle = async (count: number) => { for (let i = 0; i < 100 && sent.length < count; i++) await new Promise(r => setTimeout(r, 10)); };
  const codeIn = (mail: Sent) => /\b(\d{6})\b/.exec(mail.text)![1];
  return { store, code, base, sent, settle, codeIn, tick: (ms: number) => { time += ms; }, now: () => time, close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); } };
}

test('E-postama kod gönder: the code goes to the admin e-mail, single use, a strong new password, every session signed out, history + Bildirim merkezi + "Şifreniz değiştirildi"', async t => {
  const m = await merkez('eposta-sifirla'); t.after(() => m.close());
  const signedIn = client(m.base), door = client(m.base);
  assert.equal((await signedIn('/login', { username: 'admin', password: MERKEZ_PASSWORD })).status, 200);
  assert.deepEqual((await door('/reset')).data, { available: true, recoveryCode: true, email: true });
  const asked = await door('/reset/email/send', { username: 'admin', email: ' satici@example.com ' });
  assert.equal(asked.status, 200); assert.deepEqual(asked.data, { ok: true, minutes: 15 });
  await m.settle(1);
  assert.equal(m.sent.length, 1); assert.equal(m.sent[0].to, ADMIN_MAIL, 'the "Yönetici e-postası", not the notification address');
  assert.match(m.sent[0].subject, /şifre sıfırlama kodu/); const code = m.codeIn(m.sent[0]);
  // The code is never stored in the sealed registry or its history (kept only as a keyed hash in memory).
  assert.equal(JSON.stringify(m.store.read()).includes(code), false);
  await new Promise(r => setTimeout(r, 30));
  assert.ok(m.store.read().audit.some(a => a.action === 'admin.reset_code_sent' && /S•••@example\.com/i.test(a.detail ?? '')));
  const malformed = await door('/reset/email/verify', { username: 'admin', email: ADMIN_MAIL, code: '12345' });
  assert.equal(malformed.status, 400); assert.equal(malformed.data.code, 'INVALID_CODE');
  const wrong = await door('/reset/email/verify', { username: 'admin', email: ADMIN_MAIL, code: code === '000000' ? '000001' : '000000' });
  assert.equal(wrong.status, 403); assert.equal(wrong.data.code, 'WRONG_CODE');
  const ok = await door('/reset/email/verify', { username: 'ADMIN', email: ADMIN_MAIL, code });
  assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.equal(ok.data.needsAuthenticator, false); assert.match(ok.data.ticket, /^[a-f0-9]{64}$/);
  assert.equal((await door('/reset/email/verify', { username: 'admin', email: ADMIN_MAIL, code })).data.code, 'WRONG_CODE', 'a code works once');
  const weak = await door('/reset/complete', { ticket: ok.data.ticket, newPassword: 'Mola2026Mola!' });
  assert.equal(weak.status, 400); assert.equal(weak.data.code, 'WEAK_PASSWORD');
  const done = await door('/reset/complete', { ticket: ok.data.ticket, newPassword: NEW });
  assert.equal(done.status, 200, JSON.stringify(done.data)); assert.equal(done.data.mfaReset, false);
  assert.equal((await signedIn('/state')).status, 401, 'every admin session ended');
  assert.equal(await adminMatches(NEW, m.store.read().admin), true);
  await m.settle(2);
  const changed = m.sent.find(s => s.subject === 'Mola Yönetim: Şifreniz değiştirildi');
  assert.ok(changed); assert.equal(changed.to, ADMIN_MAIL); assert.match(changed.text, /e-postaya gönderilen kodla \(iki adımlı giriş kapalıyken\)/);
  const d = m.store.read();
  assert.ok(d.audit.some(a => a.action === 'admin.password_reset' && /e-postaya gönderilen kodla \(iki adımlı giriş kapalıydı\)/.test(a.detail ?? '')));
  assert.ok(d.alerts!.some(a => a.kind === 'admin.password_reset' && a.title === 'Yönetici şifresi değiştirildi'));
  // The alert's own e-mail went to the notification address (another address): both are told once.
  assert.ok(d.mail!.queue.some(q => q.subject === 'Mola Yönetim: Yönetici şifresi değiştirildi' && !q.to));
});

test('E-posta yolu: the same answer whether or not the account and address are right (no enumeration); the notification address stands in for an empty "Yönetici e-postası"; a new code replaces the old', async t => {
  const m = await merkez('eposta-sinir'); t.after(() => m.close());
  const door = client(m.base);
  const answers = [];
  for (const body of [{ username: 'admin', email: 'baskasi@example.com' }, { username: 'yonetici', email: ADMIN_MAIL }, { username: 'admin', email: ADMIN_MAIL }]) {
    const r = await client(m.base)('/reset/email/send', body); answers.push([r.status, JSON.stringify(r.data)]);
  }
  assert.equal(new Set(answers.map(a => a.join(' '))).size, 1, 'one answer for all three');
  await m.settle(1); await new Promise(r => setTimeout(r, 30));
  assert.equal(m.sent.length, 1, 'only the right pair gets a mail');
  // Notification address as the admin address when "Yönetici e-postası" is empty; the old code is replaced by a new one.
  m.store.mutate(d => { delete d.mail!.settings!.adminEmail; });
  await door('/reset/email/send', { username: 'admin', email: 'bildirim@example.com' }); await m.settle(2);
  assert.equal(m.sent[1].to, 'bildirim@example.com');
  const old = m.codeIn(m.sent[0]), fresh = m.codeIn(m.sent[1]);
  if (old !== fresh) assert.equal((await door('/reset/email/verify', { username: 'admin', email: 'bildirim@example.com', code: old })).data.code, 'WRONG_CODE');
});

test('E-posta yolu limits: 3 codes per address + account in 15 minutes and 10 per address an hour, counted on what was typed; a code lives 15 minutes; 5 wrong tries end it', async t => {
  const m = await merkez('eposta-sinir-2'); t.after(() => m.close());
  const door = client(m.base), send = (username: string, email: string) => door('/reset/email/send', { username, email });
  for (let i = 0; i < 3; i++) assert.equal((await send('admin', ADMIN_MAIL)).status, 200);
  const fourth = await send('admin', ADMIN_MAIL);
  assert.equal(fourth.status, 429); assert.match(fourth.data.message, /Çok sık kod istendi/);
  // A wrong address is counted the same way: the refusal says nothing about what is right.
  for (let i = 0; i < 3; i++) assert.equal((await send('kimse', `x${i}@example.com`)).status, 200);
  assert.equal((await send('kimse', 'y@example.com')).status, 429);
  // Per address (this one already sent 8): two more names, then every name waits.
  assert.equal((await send('u1', 'a@example.com')).status, 200); assert.equal((await send('u2', 'b@example.com')).status, 200);
  assert.equal((await send('u3', 'c@example.com')).status, 429);
  await m.settle(3); assert.equal(m.sent.length, 3);
  // A code expires after 15 minutes (the newest of the three; older ones were replaced).
  const fresh = await merkez('eposta-sure'); t.after(() => fresh.close());
  const one = client(fresh.base), verify = (code: string) => one('/reset/email/verify', { username: 'admin', email: ADMIN_MAIL, code });
  await one('/reset/email/send', { username: 'admin', email: ADMIN_MAIL }); await fresh.settle(1);
  fresh.tick(16 * 60_000);
  assert.equal((await verify(fresh.codeIn(fresh.sent[0]))).data.code, 'WRONG_CODE', 'expired');
  // 5 wrong tries end the live code: afterwards even the right one is refused. (The address waits a little between tries.)
  await one('/reset/email/send', { username: 'admin', email: ADMIN_MAIL }); await fresh.settle(2);
  const live = fresh.codeIn(fresh.sent[1]), other = live === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i++) { fresh.tick(60_000); assert.equal((await verify(other)).data.code, 'WRONG_CODE'); }
  fresh.tick(60_000);
  assert.equal((await verify(live)).data.code, 'WRONG_CODE', 'the code ended after 5 wrong tries');
  // Too many wrong answers from one address: it waits (like the login).
  assert.equal((await verify(other)).status, 429);
});

test('E-posta yolu with two-step login on: the Authenticator code is required too; a lost Authenticator: the Merkez recovery code instead ("Doğrulayıcıyı da sıfırla" optional)', async t => {
  const m = await merkez('eposta-mfa', { mfa: true }); t.after(() => m.close());
  const door = client(m.base);
  const ticket = async () => {
    const n = m.sent.length;
    await door('/reset/email/send', { username: 'admin', email: ADMIN_MAIL }); await m.settle(n + 1);
    const r = await door('/reset/email/verify', { username: 'admin', email: ADMIN_MAIL, code: m.codeIn(m.sent.at(-1)!) });
    assert.equal(r.status, 200); assert.equal(r.data.needsAuthenticator, true, 'said only after the e-mail code passed');
    return r.data.ticket as string;
  };
  const first = await ticket();
  const alone = await door('/reset/complete', { ticket: first, newPassword: NEW });
  assert.equal(alone.status, 400); assert.equal(alone.data.code, 'AUTHENTICATOR_REQUIRED', 'the e-mail alone is not enough');
  assert.equal((await door('/reset/complete', { ticket: first, newPassword: NEW, code: '000000' })).data.code, 'INVALID_CODE');
  assert.equal((await door('/reset/complete', { ticket: first, newPassword: NEW, resetAuthenticator: true })).data.code, 'AUTHENTICATOR_REQUIRED', '"turn MFA off" is no way around it');
  m.tick(31_000);
  const viaTotp = await door('/reset/complete', { ticket: first, newPassword: NEW, code: totp(SECRET, m.now()) });
  assert.equal(viaTotp.status, 200, JSON.stringify(viaTotp.data)); assert.equal(viaTotp.data.mfaReset, false);
  assert.ok(m.store.read().admin.mfa, 'MFA stays'); assert.equal(await adminMatches(NEW, m.store.read().admin), true);
  assert.match(m.store.read().audit.findLast(a => a.action === 'admin.password_reset')!.detail!, /doğrulayıcı koduyla/);
  // Lost the phone: the Merkez recovery code (24 characters, Ayarlar → Yedek) substitutes.
  const second = await ticket(), next = 'Mavi-Kapi-Bahce-58';
  assert.equal((await door('/reset/complete', { ticket: second, newPassword: next, recoveryCode: 'kisa' })).data.code, 'INVALID_CODE');
  assert.equal((await door('/reset/complete', { ticket: second, newPassword: next, recoveryCode: '2222-3333-4444-5555-6666-7777' })).data.code, 'WRONG_CODE');
  const kept = await door('/reset/complete', { ticket: second, newPassword: next, recoveryCode: m.code });
  assert.equal(kept.status, 200, JSON.stringify(kept.data)); assert.equal(kept.data.mfaReset, false); assert.ok(m.store.read().admin.mfa);
  const third = await ticket(), last = 'Mor-Kapi-Bahce-69';
  const off = await door('/reset/complete', { ticket: third, newPassword: last, recoveryCode: m.code, resetAuthenticator: true });
  assert.equal(off.status, 200); assert.equal(off.data.mfaReset, true); assert.equal(m.store.read().admin.mfa, undefined);
  const state = m.store.read();
  assert.ok(state.audit.some(a => a.action === 'admin.password_reset' && /Merkez kurtarma koduyla/.test(a.detail ?? '')));
  assert.ok(state.audit.some(a => a.action === 'admin.mfa_reset'));
  assert.ok(state.alerts!.some(a => /İki adımlı giriş de kapatıldı/.test(a.text)));
});

test('E-posta yolu without SMTP: off entirely and the screen is told; on a VDS (PUBLIC_ORIGIN) it works over HTTPS while the code paths stay on the Merkez computer', async t => {
  const off = await merkez('eposta-kapali', { smtp: null }); t.after(() => off.close());
  const door = client(off.base);
  assert.equal((await door('/reset')).data.email, false);
  const refused = await door('/reset/email/send', { username: 'admin', email: ADMIN_MAIL });
  assert.equal(refused.status, 409); assert.equal(refused.data.code, 'EMAIL_RESET_OFF'); assert.match(refused.data.message, /SMTP/);
  assert.equal((await door('/reset/email/verify', { username: 'admin', email: ADMIN_MAIL, code: '123456' })).data.code, 'EMAIL_RESET_OFF');
  // Half-made settings (no sender, no password) do not count as SMTP.
  off.store.mutate(d => { d.mail = { settings: { ...SMTP, user: 'kullanici', from: undefined, password: '' }, queue: [] }; });
  assert.equal((await door('/reset')).data.email, false);
  // Mola Yönetim → Ayarlar → E-posta bildirimleri: the "Yönetici e-postası" field.
  const admin = client(off.base); await admin('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  const bad = await admin('/email', { enabled: true, host: 'smtp.example.com', port: 465, security: 'tls', user: 'bildirim@example.com', password: 'x', to: 'bildirim@example.com', adminEmail: 'adres-degil' });
  assert.equal(bad.data.code, 'EMAIL_ADDRESS');
  const saved = await admin('/email', { enabled: false, host: 'smtp.example.com', port: 465, security: 'tls', user: 'bildirim@example.com', password: 'x', to: 'bildirim@example.com', adminEmail: 'satici@example.com' });
  assert.equal(saved.status, 200); assert.equal(saved.data.settings.adminEmail, 'satici@example.com'); assert.equal(saved.data.resetReady, true);
  assert.equal((await door('/reset')).data.email, true, 'SMTP saved (even with notifications off): the e-mail path is on');
  // A Merkez on a VDS behind HTTPS: the whole e-mail path from a browser anywhere; the code paths are refused there.
  const vds = await merkez('eposta-vds', { vds: true }); t.after(() => vds.close());
  const https = { Origin: 'https://y.example.com', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.7' };
  const remote = client(vds.base), call = (path: string, body?: unknown) => remote(path, body, https);
  assert.deepEqual((await call('/reset')).data, { available: false, recoveryCode: true, email: true });
  assert.equal((await call('/reset/verify', { proof: 'merkez', code: vds.code })).data.code, 'LOCAL_ONLY');
  assert.equal((await call('/reset/email/send', { username: 'admin', email: ADMIN_MAIL })).status, 200); await vds.settle(1);
  const ticket = await call('/reset/email/verify', { username: 'admin', email: ADMIN_MAIL, code: vds.codeIn(vds.sent[0]) });
  assert.equal(ticket.status, 200, JSON.stringify(ticket.data));
  assert.equal((await call('/reset/complete', { ticket: ticket.data.ticket, newPassword: NEW })).status, 200);
  assert.equal(await adminMatches(NEW, vds.store.read().admin), true);
  // Plain HTTP to a public Merkez is refused before anything (the panel's own rule).
  assert.equal((await remote('/reset/email/send', { username: 'admin', email: ADMIN_MAIL }, { Origin: 'https://y.example.com' })).status, 403);
});
