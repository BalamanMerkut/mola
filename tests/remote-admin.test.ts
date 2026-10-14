import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.MOLA_RELAY_HOLD_MS = '300';
process.env.MOLA_REMOTE_PART_CHARS = '8000';
import { DEMO_PASSWORD } from '../server/app.js';
import { totp, base32 } from '../server/totp.js';
import { MERKEZ_API } from '../server/sync-protocol.js';
import { newPhoneKeys } from '../packages/domain/remote-crypto.js';
import { deviceLogin } from '../packages/domain/remote-login.js';
import { adminOpen, deviceSession, openReply, readOpenAnswer, sealCall, type AdminCall, type TunnelResponse } from '../packages/domain/remote-admin-crypto.js';
import type { RelayHub } from '../server/merkez/relay.js';
import { remoteRefusal, type RemoteAdmin } from '../server/remote-admin.js';
import { merkezPair, OWNER_EMAIL, phonePost, remoteLoginReady } from './merkez-fixture.js';

/*
 * Sahibin uzaktan yönetimi (server/remote-admin.ts): the paired device opens the café's screens through Mola Merkez, end to
 * end encrypted. Merkez sees ciphertext only; replays, wrong answers, the switch, café-only actions, the session's end.
 */
const wait = async (check: () => boolean | Promise<boolean>, ms = 8000) => { const end = Date.now() + ms; while (!(await check())) { if (Date.now() > end) throw new Error('Beklenen durum gelmedi.'); await new Promise(r => setTimeout(r, 25)); } };
const SECRET = base32(Buffer.from('12345678901234567890'));

/** A start time at least an hour clear of 05:00 (the tests move the clock forward and would otherwise end the business day). */
const awayFrom5 = (ms: number) => { const h = new Date(ms).getHours(); return h >= 3 && h < 5 ? ms + 3 * 3600_000 : ms; };

async function setup(name: string) {
  let time = awayFrom5(Date.now());
  const clock = { get: () => time, add: (ms: number) => { time += ms; } };
  const wire: string[] = [];
  const recording: typeof fetch = async (input, init) => { if (typeof init?.body === 'string') wire.push(init.body); const r = await fetch(input, init); wire.push(await r.clone().text()); return r; };
  const pair = await merkezPair(name, { demo: true, fetch: recording, now: () => new Date(time) });
  await pair.importDemo(); await pair.adminLogin();
  const owner = pair.kafe(); assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  const tenant = pair.store.findUser('isletme')!.tenantId;
  const hub = pair.merkezApp.locals.relayHub as RelayHub, admin = pair.kafeApp.locals.remoteAdmin as RemoteAdmin;
  // A device signs in the usual way (0.1.23: the e-mail and the password, then the phone code). The code goes off again
  // right after: the device keeps working, and the tests below turn the code on when they need it.
  const mfa = (on: boolean) => pair.store.mutate(tenant, s => { const u = s.staffUsers!.find(u => u.username === 'isletme')!; if (on) u.mfa = { secret: SECRET, lastStep: -1, recoveryHashes: [] }; else delete u.mfa; });
  mfa(true);
  await remoteLoginReady(pair, tenant);
  // The heartbeats above say counts ("products": 12) and are no part of this: the wire is checked from the sign-in on.
  wire.length = 0;
  const merkez = phonePost(pair.merkezBase, wire), keys = await newPhoneKeys();
  const step1 = await deviceLogin(merkez, keys, OWNER_EMAIL, { password: DEMO_PASSWORD, name: 'Ahmet’in telefonu', kind: 'phone' }, { at: time });
  assert.equal(step1.kind, 'code', JSON.stringify(step1));
  const { ticket, cafePublic: first } = step1 as Extract<typeof step1, { kind: 'code' }>;
  const paired = await deviceLogin(merkez, keys, OWNER_EMAIL, { ticket, code: totp(SECRET, time), name: 'Ahmet’in telefonu', kind: 'phone' }, { at: time, cafePublic: first });
  assert.equal(paired.kind, 'paired', JSON.stringify(paired));
  const { phoneId, token, cafePublic, grant } = paired as Extract<typeof paired, { kind: 'paired' }>, link = { cafePublic };
  mfa(false);
  /** The owner's code on: the TOTP secret, as "Telefon kodunu kur" would leave it. */
  const codeOn = () => pair.store.mutate(tenant, s => { s.staffUsers!.find(u => u.username === 'isletme')!.mfa = { secret: SECRET, lastStep: -1, recoveryHashes: [] }; });
  /** The next unused code: one step ahead each time (the café accepts ±1 step, never the same step twice). */
  const code = () => { time += 30_000; return totp(SECRET, time); };
  /** The device: open (password + code), then sealed calls; `raw` sends a prepared envelope as it is. */
  const device = () => {
    let s: { sid: string; key: CryptoKey } | undefined, seq = 0;
    const tab = 'AAAAAAAAAAA';
    const raw = (request: unknown) => merkez('admin', { phoneId, token, request });
    return {
      raw, get sid() { return s?.sid; },
      async open(password: string, c: string, grant?: string) {
        const o = await adminOpen(keys.privateKey, link.cafePublic, phoneId, { password, code: c, ...(grant ? { grant } : {}) }, time);
        const r = await raw(o.request);
        if (r.status !== 200) return { ok: false as const, code: r.data.code as string, status: r.status, request: o.request };
        const answer = await readOpenAnswer(o.k1, o.request.nonce, r.data as { iv: string; ct: string });
        if (!answer.ok) return { ok: false as const, code: answer.code, status: r.status, message: answer.message, request: o.request };
        s = { sid: answer.sid, key: await deviceSession(o.k1, o.ephPrivate, o.request.eph, answer.eph, answer.sid) };
        return { ok: true as const, answer, request: o.request };
      },
      async seal(m: 'GET' | 'POST', p: string, body?: unknown, n = ++seq, headers: Record<string, string> = {}) {
        return sealCall(s!.key, { sid: s!.sid, tab, seq: n, at: time }, { m, p, h: { 'content-type': 'application/json', 'x-mola-activity': '1', ...headers }, ...(body !== undefined ? { b: JSON.stringify(body) } : {}) });
      },
      async send(call: AdminCall) {
        const r = await raw(call);
        if (r.status !== 200) return { status: r.status, code: r.data.code as string, envelope: true, data: r.data, headers: {} as Record<string, string>, bytes: Buffer.alloc(0), parts: undefined };
        let ct = r.data.ct as string;
        for (let i = 1; i < (r.data.parts ?? 1); i++) { const p = await raw({ v: 1, op: 'part', sid: s!.sid, ref: r.data.ref, index: i }); assert.equal(p.status, 200, JSON.stringify(p.data)); ct += p.data.part; }
        const reply: TunnelResponse = await openReply(s!.key, call, { iv: r.data.iv, ct });
        const bytes = reply.b ? Buffer.from(reply.b, 'base64url') : Buffer.alloc(0);
        let data: any = null; try { data = JSON.parse(bytes.toString('utf8')); } catch { /* a file */ }
        return { status: reply.s, headers: reply.h, bytes, data, code: data?.code as string | undefined, parts: r.data.parts as number | undefined, envelope: false };
      },
      async call(m: 'GET' | 'POST', p: string, body?: unknown) { return this.send(await this.seal(m, p, body)); },
    };
  };
  return { pair, owner, tenant, hub, admin, wire, phoneId, token, keys, link, codeOn, code, device, clock, merkez, grant };
}

test('right after the sign-in its one-time grant opens "Kafeyi yönet" without the password and the code; once, within 2 minutes', async t => {
  const { pair, owner, codeOn, code, device, grant, clock } = await setup('remote-admin-grant');
  t.after(() => pair.close());
  assert.match(grant ?? '', /^[A-Za-z0-9_-]{22}$/);
  codeOn(); assert.equal((await owner('/staff/remote-admin', { on: true, password: DEMO_PASSWORD, code: code() })).status, 200);
  // A made-up grant is a wrong answer (counted like a wrong password).
  const made = await device().open('', '', 'x'.repeat(22));
  assert.equal(made.ok, false); assert.equal(made.code, 'GRANT_EXPIRED');
  const d = device(), opened = await d.open('', '', grant);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal((await d.call('GET', '/api/staff/me')).data.role, 'owner');
  // Once only.
  assert.equal((await device().open('', '', grant)).code, 'GRANT_EXPIRED');
  void clock;
});

test('a grant older than 2 minutes asks the password and the code', async t => {
  const { pair, owner, codeOn, code, device, grant, clock } = await setup('remote-admin-grant-late');
  t.after(() => pair.close());
  codeOn(); assert.equal((await owner('/staff/remote-admin', { on: true, password: DEMO_PASSWORD, code: code() })).status, 200);
  clock.add(2 * 60_000);
  const late = await device().open('', '', grant);
  assert.equal(late.ok, false); assert.equal(late.code, 'GRANT_EXPIRED'); assert.equal(late.message, 'Giriş süresi doldu. Şifrenizi ve telefon kodunu yazın.');
  assert.equal((await device().open(DEMO_PASSWORD, code())).ok, true);
});

test('off by default; turning it on needs the phone code, the password and the code, and only at the café', async t => {
  const { pair, owner, codeOn, code, device } = await setup('remote-admin-switch');
  t.after(() => pair.close());
  const d = device();
  // Off: the device is told plainly (inside the sealed answer).
  const off = await d.open(DEMO_PASSWORD, '000000');
  assert.equal(off.ok, false); assert.equal(off.code, 'REMOTE_OFF');
  let v = (await owner('/staff/remote-admin')).data;
  assert.equal(v.on, false); assert.equal(v.code, false); assert.deepEqual(v.devices, ['Ahmet’in telefonu']);
  // No phone code yet: it cannot be turned on ("Önce telefon kodunu kurun").
  assert.equal((await owner('/staff/remote-admin', { on: true, password: DEMO_PASSWORD, code: '123456' })).data.code, 'REMOTE_NEEDS_CODE');
  codeOn();
  // Password again, then the code; wrong ones refused.
  assert.equal((await owner('/staff/remote-admin', { on: true, code: code() })).data.code, 'PASSWORD_REQUIRED');
  assert.equal((await owner('/staff/remote-admin', { on: true, password: 'yanlis-sifre', code: code() })).data.code, 'INVALID_PASSWORD');
  assert.equal((await owner('/staff/remote-admin', { on: true, password: DEMO_PASSWORD, code: '000000' })).data.code, 'CODE_WRONG');
  const on = await owner('/staff/remote-admin', { on: true, password: DEMO_PASSWORD, code: code() });
  assert.equal(on.status, 200, JSON.stringify(on.data)); assert.equal(on.data.on, true);
  // Other staff: 403 on all of it.
  const cashier = pair.kafe(); await cashier('/login', { username: 'kasiyer', password: DEMO_PASSWORD });
  for (const [path, body] of [['/staff/remote-admin', undefined], ['/staff/remote-admin', { on: false }], ['/staff/remote-admin/end-all', {}]] as const) assert.equal((await cashier(path, body)).status, 403);
  // Turned off at the café: remote logins are refused again.
  assert.equal((await owner('/staff/remote-admin', { on: false })).data.on, false);
  assert.equal((await d.open(DEMO_PASSWORD, code())).code, 'REMOTE_OFF');
});

test('end to end: login, change a price, reports, Excel in parts; Merkez only ever sees ciphertext', async t => {
  const { pair, owner, tenant, hub, admin, wire, codeOn, code, device } = await setup('remote-admin-e2e');
  t.after(() => pair.close());
  codeOn(); assert.equal((await owner('/staff/remote-admin', { on: true, password: DEMO_PASSWORD, code: code() })).status, 200);
  const d = device();
  const opened = await d.open(DEMO_PASSWORD, code());
  assert.equal(opened.ok, true, JSON.stringify(opened));
  // The café's screens, as the owner.
  const me = await d.call('GET', '/api/staff/me');
  assert.equal(me.status, 200); assert.equal(me.data.role, 'owner');
  const state = await d.call('GET', '/api/staff/state');
  assert.equal(state.status, 200); assert.ok(state.headers['x-mola-tag']);
  // Polling: the same tag again is 204, nothing to download.
  const again = await d.send(await d.seal('GET', '/api/staff/state', undefined, undefined, { 'x-mola-tag': state.headers['x-mola-tag'] }));
  assert.equal(again.status, 204); assert.equal(again.bytes.length, 0);
  const product = state.data.products.find((p: { id: string }) => p.id === 'latte');
  const price = product.price + 1234;
  const saved = await d.call('POST', '/api/staff/products', { id: product.id, product: { ...product, nameEn: product.nameEn ?? '', description: product.description ?? '', price } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(pair.store.read(tenant).products.find(p => p.id === 'latte')!.price, price);
  // Reports open without a second code (the login just checked it).
  const day = new Date().toISOString().slice(0, 10);
  const overview = await d.call('GET', `/api/staff/reports/overview?from=${day}&to=${day}`);
  assert.equal(overview.status, 200, JSON.stringify(overview.data));
  // Muhasebeci için indir: an Excel file, sealed and sent in parts, opens whole on the device.
  const xlsx = await d.call('GET', `/api/staff/reports/accountant.xlsx?from=${day}&to=${day}`);
  assert.equal(xlsx.status, 200, xlsx.bytes.toString('utf8').slice(0, 200));
  assert.ok((xlsx.parts ?? 1) > 1, 'came in parts');
  assert.equal(xlsx.bytes.subarray(0, 2).toString('latin1'), 'PK');
  assert.match(xlsx.headers['content-disposition'] ?? '', /\.xlsx"/);
  // The owner was told, and the café lists the session (device, start; no address).
  const notes = (await owner('/staff/notifications')).data.items as { title: string; text: string }[];
  assert.ok(notes.some(n => n.title === 'Uzaktan yönetim girişi' && n.text.includes('Ahmet’in telefonu')));
  const view = (await owner('/staff/remote-admin')).data;
  assert.equal(view.active.length, 1); assert.equal(view.active[0].device, 'Ahmet’in telefonu');
  assert.equal(JSON.stringify(view).match(/127\.0\.0\.1|::1/), null);
  const sessions = (await owner('/staff/sessions')).data as { device: string }[];
  assert.ok(sessions.some(s => s.device === 'Uzaktan · Ahmet’in telefonu'));
  // The privacy check: nothing Merkez received, sent or keeps is readable café data.
  const tables: string[] = [];
  for (const db of [pair.merkezStore.db, hub.box]) for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]) tables.push(JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all(), (_k, v) => v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v));
  const markers = [product.name, `\"price\":${price}`, DEMO_PASSWORD, '"role":"owner"', '"products"', '"currentPassword"', 'reports/overview', 'accountant.xlsx', '/api/staff/', 'Ahmet’in telefonu'];
  for (const text of [...wire, ...tables]) for (const marker of markers) assert.equal(text.includes(marker), false, `Merkez saw "${marker}" in: ${text.slice(0, 200)}`);
  assert.ok(wire.some(w => w.includes('"op":"call"')), 'the sealed calls did pass through');
  // A remote session's token works only through its tunnel: the bare cookie on the café network is refused.
  const live = [...(admin as any).live.values()][0] as { token: string };
  const lan = await fetch(`${pair.kafeBase}/api/staff/me`, { headers: { Cookie: `mola_staff=${live.token}` } });
  assert.equal(lan.status, 401);
  // A forged marker (no process secret) gets nothing.
  assert.equal((await fetch(`${pair.kafeBase}/api/staff/me`, { headers: { 'x-mola-remote': `x.${d.sid}`, Cookie: `mola_staff=${live.token}` } })).status, 403);
  // Çıkış: the session ends at the café; its next call is refused.
  assert.equal((await d.call('POST', '/api/logout', {})).status, 200);
  assert.equal((await d.call('GET', '/api/staff/me')).code, 'REMOTE_ENDED');
  assert.equal((await owner('/staff/remote-admin')).data.sessions[0].endedBy, 'logout');
});

test('replays, sequence numbers, edited requests and forged sessions are refused', async t => {
  const { pair, owner, codeOn, code, device } = await setup('remote-admin-replay');
  t.after(() => pair.close());
  codeOn(); await owner('/staff/remote-admin', { on: true, password: DEMO_PASSWORD, code: code() });
  const d = device(), opened = await d.open(DEMO_PASSWORD, code());
  assert.equal(opened.ok, true);
  // The same open request again: replay.
  assert.equal((await d.raw(opened.request)).data.code, 'REPLAY');
  const call = await d.seal('GET', '/api/staff/me');
  assert.equal((await d.send(call)).status, 200);
  assert.equal((await d.send(call)).code, 'REPLAY', 'the same sealed call twice');
  // Out of order is fine (polls overlap), far behind the newest is not.
  const later = await d.seal('GET', '/api/staff/me', undefined, 2000), earlier = await d.seal('GET', '/api/staff/me', undefined, 1900);
  assert.equal((await d.send(later)).status, 200); assert.equal((await d.send(earlier)).status, 200);
  assert.equal((await d.send(await d.seal('GET', '/api/staff/me', undefined, 1000))).code, 'REPLAY');
  // An edited ciphertext or header does not open (and does not use up the number).
  const fresh = await d.seal('GET', '/api/staff/me', undefined, 2100);
  assert.equal((await d.send({ ...fresh, ct: fresh.ct.slice(0, -2) + (fresh.ct.endsWith('A') ? 'BB' : 'AA') })).code, 'REQUEST_INVALID');
  assert.equal((await d.send({ ...fresh, at: fresh.at + 1 })).code, 'REQUEST_INVALID');
  assert.equal((await d.send(fresh)).status, 200);
  // Another session id (Merkez guessing one) or a stale request.
  assert.equal((await d.send({ ...await d.seal('GET', '/api/staff/me'), sid: '00000000-0000-4000-8000-000000000000' })).code, 'REMOTE_ENDED');
  assert.equal((await d.send({ ...await d.seal('GET', '/api/staff/me'), at: Date.now() - 3600_000 })).code, 'REQUEST_STALE');
});

test('wrong password or code: counted per device, then waits; café-only actions refused; remote password change needs the code', async t => {
  const { pair, owner, codeOn, code, device, clock } = await setup('remote-admin-limits');
  t.after(() => pair.close());
  codeOn(); await owner('/staff/remote-admin', { on: true, password: DEMO_PASSWORD, code: code() });
  const d = device();
  assert.equal((await d.open('yanlis', code())).code, 'INVALID_LOGIN');
  assert.equal((await d.open(DEMO_PASSWORD, '000000')).code, 'INVALID_LOGIN');
  for (let i = 0; i < 3; i++) assert.equal((await d.open(`yanlis-${i}`, code())).code, 'INVALID_LOGIN');
  // Five wrong: even the right answer waits now.
  assert.equal((await d.open(DEMO_PASSWORD, code())).code, 'RATE_LIMIT');
  clock.add(31_000);
  const ok = await d.open(DEMO_PASSWORD, code());
  assert.equal(ok.ok, true, JSON.stringify(ok));
  // Café-only: refused before any route, with a plain reason.
  for (const [m, p, body] of [['POST', '/api/staff/remote-reports/phones/remove', { id: 'p'.repeat(22) }], ['GET', '/api/desktop/recovery', undefined], ['POST', '/api/desktop/restore', {}], ['POST', '/api/staff/report-security/setup', { password: DEMO_PASSWORD }], ['POST', '/api/staff/remote-admin', { on: true, password: DEMO_PASSWORD, code: '123456' }], ['POST', '/api/staff/remote-support', { on: true, password: DEMO_PASSWORD }], ['POST', '/api/login', { username: 'isletme', password: DEMO_PASSWORD }], ['GET', '/api/activation', undefined]] as const) {
    const r = await d.call(m, p, body);
    assert.equal(r.status, 403, `${p} ${JSON.stringify(r.data)}`); assert.equal(r.code, 'REMOTE_FORBIDDEN', p); assert.ok(r.data.message.length > 10);
  }
  assert.equal((await owner('/staff/remote-reports')).data.phones.length, 1, 'the device is still there');
  assert.equal(remoteRefusal('POST', '/api/staff/remote-support', { on: false }), null, 'switching support off is fine remotely');
  // The owner's password: the current one and the code.
  const NEW = 'YeniSifre!2026x';
  assert.equal((await d.call('POST', '/api/staff/password', { currentPassword: DEMO_PASSWORD, password: NEW })).code, 'CODE_REQUIRED');
  const changed = await d.call('POST', '/api/staff/password', { currentPassword: DEMO_PASSWORD, password: NEW, code: code() });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  // Every session of that account ends (the remote one too).
  assert.equal((await d.call('GET', '/api/staff/me')).status, 401);
  assert.equal((await d.call('GET', '/api/staff/me')).code, 'REMOTE_ENDED');
});

test('the session ends: switched off, device removed, end-all, Açık oturumlar, idle lock with password, 05:00', async t => {
  const { pair, owner, tenant, admin, codeOn, code, device, clock } = await setup('remote-admin-end');
  t.after(() => pair.close());
  codeOn(); await owner('/staff/remote-admin', { on: true, password: DEMO_PASSWORD, code: code() });
  const login = async () => { const d = device(); const r = await d.open(DEMO_PASSWORD, code()); assert.equal(r.ok, true, JSON.stringify(r)); return d; };
  // Idle lock (10 min): the remote screen locks like any owner screen; the password opens it.
  pair.store.mutate(tenant, s => { s.ownerLockMinutes = 10; });
  let d = await login();
  clock.add(11 * 60_000);
  const locked = await d.call('GET', `/api/staff/reports/overview?from=2026-01-01&to=2026-01-01`);
  assert.equal(locked.status, 423); assert.equal(locked.code, 'SESSION_LOCKED'); assert.equal(locked.headers['x-mola-locked'], '1');
  assert.equal((await d.call('POST', '/api/staff/unlock', { password: 'yanlis' })).code, 'INVALID_PASSWORD');
  assert.equal((await d.call('POST', '/api/staff/unlock', { password: DEMO_PASSWORD })).status, 200);
  assert.equal((await d.call('GET', '/api/staff/me')).status, 200);
  pair.store.mutate(tenant, s => { s.ownerLockMinutes = 0; });
  // "Bütün uzak oturumları kapat".
  assert.equal((await owner('/staff/remote-admin/end-all', {})).data.ended, 1);
  assert.equal((await d.call('GET', '/api/staff/me')).code, 'REMOTE_ENDED');
  // Switched off from the remote screen itself: allowed, and it ends that very session.
  d = await login();
  const offRemote = await d.call('POST', '/api/staff/remote-admin', { on: false });
  assert.equal(offRemote.status, 200, JSON.stringify(offRemote.data)); assert.equal(offRemote.data.on, false);
  assert.equal((await d.call('GET', '/api/staff/me')).code, 'REMOTE_ENDED');
  await owner('/staff/remote-admin', { on: true, password: DEMO_PASSWORD, code: code() });
  // Closed in Çalışanlar → Açık oturumlar.
  d = await login();
  const row = ((await owner('/staff/sessions')).data as { id: string; device: string }[]).find(s => s.device.startsWith('Uzaktan'))!;
  assert.equal((await owner('/staff/sessions/end', { id: row.id })).status, 200);
  assert.equal((await d.call('GET', '/api/staff/me')).code, 'REMOTE_ENDED');
  // 05:00: the business day ends, so does the session (and the café's own sign-ins: the owner signs in again).
  d = await login();
  clock.add(25 * 3600_000);
  assert.equal((await d.call('GET', '/api/staff/me')).code, 'REMOTE_ENDED');
  const owner2 = pair.kafe(), again = await owner2('/login', { username: 'isletme', password: DEMO_PASSWORD, code: code() }); assert.equal(again.status, 200, JSON.stringify(again.data));
  // The device removed at the café: its session ends (Merkez forgets the device at once, the café on its next look).
  d = await login();
  const phone = (await owner2('/staff/remote-reports')).data.phones[0].id;
  assert.equal((await owner2('/staff/remote-reports/phones/remove', { id: phone, password: DEMO_PASSWORD })).status, 200);
  const gone = await d.call('GET', '/api/staff/me');
  assert.ok(['REMOTE_ENDED', 'PHONE_UNKNOWN', 'PHONE_REVOKED'].includes(gone.code!), JSON.stringify(gone));
  admin.sweep();
  const ended = (await owner2('/staff/remote-admin')).data.sessions.map((s: { endedBy: string }) => s.endedBy);
  for (const why of ['owner', 'off', 'ended', 'expired', 'device']) assert.ok(ended.includes(why), `${why} in ${ended}`);
  assert.equal(admin.active(tenant).length, 0);
});
