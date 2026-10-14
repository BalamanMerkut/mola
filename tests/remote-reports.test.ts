import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.MOLA_RELAY_HOLD_MS = '300';
import { DEMO_PASSWORD } from '../server/app.js';
import { signedHeaders } from '../server/install-auth.js';
import { totp, base32 } from '../server/totp.js';
import { MERKEZ_API } from '../server/sync-protocol.js';
import { newCafeKeys, cafePrivateKey, deviceKindOf, deviceLabel, deviceNameOf, loginRequest, newPhoneKeys, openLoginAnswer, openReport, readLogin, sealLoginAnswer, sealReport, signLive, liveSigned, type DeviceKind, type ReportBox } from '../packages/domain/remote-crypto.js';
import { deviceLogin } from '../packages/domain/remote-login.js';
import type { PhoneReport } from '../packages/domain/remote-report.js';
import type { RelayClient } from '../server/relay.js';
import type { RemoteReports } from '../server/remote-reports.js';
import type { RelayHub } from '../server/merkez/relay.js';
import { remoteRefusal } from '../server/remote-admin.js';
import { merkezPair, OWNER_EMAIL, phonePost, remoteLoginReady } from './merkez-fixture.js';

/*
 * Raporlarım (server/remote-reports.ts; the page is "Kafemi yönet" on /yonet since 0.1.23): a device signs in with the
 * business's verified owner e-mail and the owner's password (step 1), then the phone code (step 2); the café computer checks
 * them, Mola Merkez only routes by the e-mail and carries ciphertext. Then live reports, the postbox while the café is off,
 * "Kaldır" and "Çıkış".
 */
const rid = () => randomUUID().replace(/-/g, '');
const wait = async (check: () => boolean | Promise<boolean>, ms = 8000) => { const end = Date.now() + ms; while (!(await check())) { if (Date.now() > end) throw new Error('Beklenen durum gelmedi.'); await new Promise(r => setTimeout(r, 25)); } };
/** The owner's "Raporlar için telefon kodu". */
const SECRET = base32(Buffer.from('12345678901234567890'));
const WRONG = 'E-posta ya da şifre hatalı.', CODE_WRONG = 'Telefon kodu yanlış. Doğrulama uygulamasındaki güncel kodu yazın.';
/** A start time at least an hour clear of 05:00 (the clock moves a minute per sign-in; the owner's sign-in ends at 05:00). */
const awayFrom5 = (ms: number) => { const h = new Date(ms).getHours(); return h >= 3 && h < 5 ? ms + 3 * 3600_000 : ms; };
type Keys = { privateKey: CryptoKey; publicKey: string };

test('crypto: a box opens only on its phone, from its café, unedited and for its own question; the sign-in only at its café', async () => {
  const cafe = await newCafeKeys(), other = await newCafeKeys(), phone = await newPhoneKeys(), stranger = await newPhoneKeys();
  const priv = await cafePrivateKey(cafe.privateKey), report = { sales: 125000, top: 'Caffè Latte' };
  const box = await sealReport(priv, phone.publicKey, { kind: 'live', phone: 'p'.repeat(22), at: new Date().toISOString(), ref: 'n'.repeat(22) }, report);
  assert.deepEqual(await openReport(phone.privateKey, cafe.publicKey, box, { phone: 'p'.repeat(22), ref: 'n'.repeat(22) }), report);
  assert.equal(JSON.stringify(box).includes('Latte'), false); assert.equal(JSON.stringify(box).includes('125000'), false);
  // Every box has its own ephemeral key: the same report twice looks different.
  const again = await sealReport(priv, phone.publicKey, { kind: 'live', phone: 'p'.repeat(22), at: box.at, ref: 'n'.repeat(22) }, report);
  assert.notEqual(again.eph, box.eph); assert.notEqual(again.ct, box.ct);
  await assert.rejects(openReport(stranger.privateKey, cafe.publicKey, box, { phone: 'p'.repeat(22), ref: 'n'.repeat(22) }), 'another phone');
  await assert.rejects(openReport(phone.privateKey, other.publicKey, box, { phone: 'p'.repeat(22), ref: 'n'.repeat(22) }), 'made by someone without the café key (Mola Merkez)');
  await assert.rejects(openReport(phone.privateKey, cafe.publicKey, box, { phone: 'p'.repeat(22), ref: 'x'.repeat(22) }), 'an old answer for a new question');
  await assert.rejects(openReport(phone.privateKey, cafe.publicKey, { ...box, at: new Date(0).toISOString() }, { phone: 'p'.repeat(22), ref: 'n'.repeat(22) }), 'edited header');
  const flipped = box.ct.slice(0, -2) + (box.ct.endsWith('A') ? 'B' : 'A') + box.ct.slice(-1);
  await assert.rejects(openReport(phone.privateKey, cafe.publicKey, { ...box, ct: flipped }, { phone: 'p'.repeat(22), ref: 'n'.repeat(22) }), 'edited ciphertext');
  // A forged box Mola Merkez could make (it knows the phone's public key, not the café's private key) does not open.
  const forged = await sealReport(await cafePrivateKey(other.privateKey), phone.publicKey, { kind: 'snapshot', phone: 'p'.repeat(22), at: box.at }, { sales: 1 });
  await assert.rejects(openReport(phone.privateKey, cafe.publicKey, forged, { phone: 'p'.repeat(22) }));
  // Live questions: signed with the phone's key, checked with the café's; "Çıkış" is signed apart (never taken for a question).
  const q = await signLive(phone.privateKey, cafe.publicKey, 'p'.repeat(22));
  assert.equal(await liveSigned(priv, phone.publicKey, q), true);
  assert.equal(await liveSigned(priv, stranger.publicKey, q), false);
  assert.equal(await liveSigned(priv, phone.publicKey, { ...q, at: q.at + 1 }), false);
  const out = await signLive(phone.privateKey, cafe.publicKey, 'p'.repeat(22), Date.now(), 'forget');
  assert.equal(await liveSigned(priv, phone.publicKey, out), true);
  assert.equal(await liveSigned(priv, phone.publicKey, { ...out, op: undefined }), false, 'a forget signature is no live question');
  assert.equal(await liveSigned(priv, phone.publicKey, { ...q, op: 'forget' }), false, 'a live question is no forget');
  // The sign-in: only the café whose key it was sealed to opens it; the password never shows; edited, it opens nowhere.
  const { request, key } = await loginRequest(phone.privateKey, phone.publicKey, cafe.publicKey, { password: 'Gizli!Sifre-2026', code: '123456', name: 'iPhone', kind: 'phone' });
  assert.equal(JSON.stringify(request).includes('Gizli'), false); assert.equal(JSON.stringify(request).includes('123456'), false);
  const opened = (await readLogin(priv, request))!;
  assert.deepEqual(opened.inner, { password: 'Gizli!Sifre-2026', code: '123456', name: 'iPhone', kind: 'phone' });
  assert.equal(await readLogin(await cafePrivateKey(other.privateKey), request), null, 'Mola Merkez (or another café) cannot open it');
  assert.equal(await readLogin(priv, { ...request, phonePub: stranger.publicKey }), null, 'the device key is bound');
  assert.equal(await readLogin(priv, { ...request, at: request.at + 1 }), null, 'the time is bound');
  // The café's answer opens only with the device's key, for that request.
  const answer = await sealLoginAnswer(opened.key, request.nonce, { ok: true, phoneId: 'p'.repeat(22), business: 'Mola Kafe', name: 'iPhone' });
  assert.deepEqual(await openLoginAnswer(key, request.nonce, answer), { ok: true, phoneId: 'p'.repeat(22), business: 'Mola Kafe', name: 'iPhone' });
  await assert.rejects(openLoginAnswer(key, 'x'.repeat(22), answer), 'another request');
  // The device names itself (0.1.23, no "Bu cihazın adı"): its family from the user agent and the day it signed in.
  assert.deepEqual([deviceNameOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), deviceNameOf('Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile'), deviceNameOf('Mozilla/5.0 (Linux; Android 14; SM-X710)'), deviceNameOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), deviceNameOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), deviceNameOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), deviceNameOf('Mozilla/5.0 (X11; Linux x86_64)')],
    ['iPhone', 'Android telefon', 'Android tablet', 'iPad', 'Windows laptop', 'Mac', 'Bilgisayar']);
  const oct15 = Date.parse('2026-10-15T09:00:00Z');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 0, oct15), 'iPhone · 15 Ekim');
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0, oct15), 'Windows laptop · 15 Ekim');
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile', 0, Date.parse('2026-10-15T22:30:00Z')), 'Android telefon · 16 Ekim', 'Istanbul’s day');
});

async function setup(name: string, options: { mail?: { to: string; text: string }[] } = {}) {
  let time = awayFrom5(Date.now());
  const clock = { now: () => time, add: (ms: number) => { time += ms; } };
  /** Everything café ↔ Merkez and device ↔ Merkez said, both ways (Merkez's side of the wire). */
  const wire: string[] = [];
  const recording: typeof fetch = async (input, init) => { if (typeof init?.body === 'string') wire.push(init.body); const r = await fetch(input, init); wire.push(await r.clone().text()); return r; };
  const pair = await merkezPair(name, { demo: true, fetch: recording, now: () => new Date(time), ...(options.mail ? { merkez: { ownerLoginMail: async (_s, to, _subject, text) => { options.mail!.push({ to, text }); } } } : {}) });
  await pair.importDemo(); await pair.adminLogin();
  const owner = pair.kafe(); assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  const tenant = pair.store.findUser('isletme')!.tenantId;
  const mfa = (on: boolean) => pair.store.mutate(tenant, s => { const u = s.staffUsers!.find(x => x.username === 'isletme')!; if (on) u.mfa = { secret: SECRET, lastStep: -1, recoveryHashes: [] }; else delete u.mfa; });
  mfa(true);
  const relay = pair.kafeApp.locals.relay as RelayClient, remote = pair.kafeApp.locals.remote as RemoteReports, hub = pair.merkezApp.locals.relayHub as RelayHub;
  await remoteLoginReady(pair, tenant);
  const install = pair.link.read()!.installId, phone = phonePost(pair.merkezBase, wire);
  /** The owner's current phone code (the clock moves on a minute before every sign-in: a new code, the per-minute limits clear). */
  const code = () => totp(SECRET, time);
  /**
   * "Giriş yap" on a device (0.1.23, two steps): the e-mail and the password, then the ticket and the phone code; by default an
   * iPhone with the owner's right password and code. `only: 'password'` stops after step 1; `ticket` sends one step with it
   * (the code, or "Hangisinin yerine?" with `replace`); `both` sends the password and the code at once (a page from before).
   */
  const login = async (o: { name?: string; kind?: DeviceKind; device?: string; password?: string; code?: string; email?: string; keys?: Keys; ticket?: string; replace?: string; cafePublic?: string; stay?: boolean; only?: 'password'; both?: boolean } = {}) => {
    if (!o.stay) clock.add(61_000);
    await wait(() => hub.online(install));
    const keys = o.keys ?? await newPhoneKeys(), device = { name: o.name ?? 'iPhone · 15 Ekim', kind: o.kind ?? 'phone' as DeviceKind, ...(o.device ? { device: o.device } : {}) };
    const email = o.email ?? OWNER_EMAIL, step = (inner: Parameters<typeof deviceLogin>[3], cafePublic?: string) => deviceLogin(phone, keys, email, inner, { at: time, ...(cafePublic ? { cafePublic } : {}) });
    if (o.ticket) return { keys, result: await step({ ticket: o.ticket, ...(o.replace ? { replace: o.replace } : { code: o.code ?? code() }), ...device }, o.cafePublic) };
    if (o.both) return { keys, result: await step({ password: o.password ?? DEMO_PASSWORD, code: o.code ?? code(), ...device }) };
    const first = await step({ password: o.password ?? DEMO_PASSWORD, ...device });
    if (first.kind !== 'code' || o.only) return { keys, result: first };
    return { keys, result: await step({ ticket: first.ticket, code: o.code ?? code(), ...device }, first.cafePublic) };
  };
  const paired = (r: Awaited<ReturnType<typeof login>>) => { assert.equal(r.result.kind, 'paired', JSON.stringify(r.result)); return { ...r.result as Extract<typeof r.result, { kind: 'paired' }>, keys: r.keys }; };
  const devices = async () => (await owner('/staff/remote-reports')).data.phones as { id: string; name: string; kind: DeviceKind | null; lastSeenAt: string | null }[];
  return { pair, owner, tenant, relay, remote, hub, wire, phone, login, paired, devices, code, clock, mfa, install };
}

/** A real sale: a guest order paid by card (the report must show it). */
async function sell(owner: ReturnType<Awaited<ReturnType<typeof merkezPair>>['kafe']>, guest: ReturnType<Awaited<ReturnType<typeof merkezPair>>['kafe']>) {
  const s = (await owner('/staff/state')).data;
  await owner('/staff/setup', { requestId: rid(), version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: 0, commissionBps: null });
  const session = await guest('/guest/session', { token: s.tables[0].token });
  const order = await guest('/guest/orders', { requestId: rid(), tableId: session.data.tableId, lines: [{ productId: 'latte', quantity: 3, selections: [{ groupId: 'size', optionId: 'large' }] }], expectedTotal: 49500 });
  assert.equal(order.status, 200, JSON.stringify(order.data));
  const table = (await owner('/staff/state')).data.tables.find((x: { id: string }) => x.id === session.data.tableId);
  assert.equal((await owner('/staff/payments', { requestId: rid(), accountId: table.account.id, version: table.account.version, method: 'card', amount: 49500, tendered: 49500 })).status, 200);
}

test('sign-in → live report → postbox → "Çıkış", end to end; Merkez never sees the password, the code or a sales figure', async t => {
  const { pair, owner, tenant, relay, remote, hub, wire, phone, login, paired, devices, clock, mfa } = await setup('remote-reports');
  t.after(() => pair.close());
  await sell(owner, pair.kafe());
  const { phoneId, token, business, cafePublic, keys, grant } = paired(await login({ name: 'Ahmet’in telefonu' }));
  assert.equal(business, pair.store.read(tenant).name); assert.match(grant ?? '', /^[A-Za-z0-9_-]{22}$/, 'the one-time grant for "Kafeyi yönet"');
  // The café computer lists it as typed, as a phone; the owner is told.
  assert.deepEqual((await devices()).map(p => [p.id, p.name, p.kind]), [[phoneId, 'Ahmet’in telefonu', 'phone']]);
  const inbox = (await owner('/staff/notifications')).data.items as { title: string; text: string }[];
  assert.ok(inbox.some(n => n.title === 'Yeni cihaz bağlandı' && n.text === 'Yeni cihaz bağlandı: Ahmet’in telefonu. Siz değilseniz Ayarlar → Uzaktan erişim’den kaldırın.'), JSON.stringify(inbox));
  // Merkez gave the token to the very device id the café named (the café's own sealed word).
  assert.equal(hub.phones(tenant), 1);
  // Live: the café answers through Merkez, sealed for this phone and this question.
  const s = await signLive(keys.privateKey, cafePublic, phoneId, clock.now()), live = await phone('live', { phoneId, token, request: s });
  assert.equal(live.status, 200, JSON.stringify(live.data));
  const report = await openReport<PhoneReport>(keys.privateKey, cafePublic, live.data.box, { phone: phoneId, ref: s.nonce, kind: 'live' });
  assert.equal(report.today.sales, 49500); assert.equal(report.today.card, 49500); assert.equal(report.reason, 'live');
  assert.ok(report.topProducts.some(p => p.qty === 3)); assert.equal(report.days.length, 30); assert.equal(report.business, business);
  // The same question again is refused (replay), and an unknown token gets nothing.
  assert.equal((await phone('live', { phoneId, token, request: s })).status, 403);
  assert.equal((await phone('live', { phoneId, token: 'x'.repeat(43), request: await signLive(keys.privateKey, cafePublic, phoneId, clock.now()) })).status, 403);
  // Postbox: the very same report sealed for the phone waits at Merkez, is handed over once, then gone.
  assert.equal(await remote.push('periodic', true), 1);
  const box = await phone('postbox', { phoneId, token });
  assert.equal(box.status, 200);
  const snapshot = await openReport<PhoneReport>(keys.privateKey, cafePublic, box.data.box as ReportBox, { phone: phoneId, kind: 'snapshot' });
  assert.equal(snapshot.today.sales, 49500); assert.deepEqual(Object.keys(snapshot).sort(), Object.keys(report).sort(), 'the snapshot holds everything Raporlarım shows');
  assert.equal((await phone('postbox', { phoneId, token })).data.box, null, 'deleted on fetch');
  // The privacy check: nothing Merkez received, sent or keeps is the password, the phone code or readable sales data.
  await remote.push('periodic', true);
  const product = report.topProducts[0].name, tables: string[] = [];
  for (const db of [pair.merkezStore.db, hub.box]) for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]) tables.push(JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all(), (_k, v) => v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v));
  for (const text of [...wire, ...tables]) for (const marker of [DEMO_PASSWORD, '"password"', product, '"topProducts"', '"closedAccounts"', '"sales"', '"lastClosing"', 'Kart', '49500', '495,00']) assert.equal(text.includes(marker), false, `Merkez saw "${marker}" in: ${text.slice(0, 200)}`);
  assert.ok(wire.some(w => w.includes('"ct"')), 'the sealed sign-in and boxes did pass through');
  // "Çıkış" on the device: the café drops it, Merkez forgets the token and the box.
  const out = await phone('forget', { phoneId, token, request: await signLive(keys.privateKey, cafePublic, phoneId, clock.now(), 'forget') });
  assert.equal(out.status, 200, JSON.stringify(out.data)); assert.equal(out.data.cafe, true);
  assert.deepEqual(await devices(), []);
  assert.equal((await phone('postbox', { phoneId, token })).status, 403);
  assert.equal(hub.hasBox(phoneId), false);
  // The phone code reset: Merkez hears it, a new sign-in is told what to do, and the café stops polling (nothing needs it).
  mfa(false); remote.codeChanged(); await pair.link.sync();
  const missing = await phone('login/start', { email: OWNER_EMAIL });
  assert.equal(missing.status, 409); assert.equal(missing.data.message, 'Önce kasada Ayarlar → Uzaktan erişim’de telefon kodunu kurun.');
  await wait(() => !relay.needed());
});

test('two steps: the password at once (a ticket for the code), then the code; wrong ones counted per business, then a wait; an unknown e-mail reads like a wrong password', async t => {
  const { pair, owner, tenant, phone, login, paired, devices, clock } = await setup('remote-login-wrong');
  t.after(() => pair.close());
  // An unknown e-mail: Merkez answers with the very words a wrong password gets.
  const unknown = await phone('login/start', { email: 'baskasi@ornek.com' });
  assert.equal(unknown.status, 403); assert.equal(unknown.data.message, WRONG);
  // Step 1: a wrong password is said on the first screen; the right one gets the code screen (a ticket, nothing paired yet).
  assert.deepEqual((await login({ password: 'yanlis-sifre-1' })).result, { kind: 'error', code: 'LOGIN_FAILED', message: WRONG });
  const first = await login({ only: 'password' });
  assert.equal(first.result.kind, 'code', JSON.stringify(first.result)); assert.deepEqual(await devices(), []);
  const ticket = (first.result as Extract<typeof first.result, { kind: 'code' }>).ticket, cafePublic = (first.result as { cafePublic: string }).cafePublic;
  // The ticket is for that device's key only.
  assert.equal(((await login({ keys: await newPhoneKeys(), ticket, cafePublic, stay: true })).result as { code: string }).code, 'LOGIN_EXPIRED');
  const again = await login({ only: 'password', stay: true }), held = again.result as Extract<typeof again.result, { kind: 'code' }>;
  // Step 2: a wrong code stays on the code screen with the same ticket and the plain words; the right one pairs.
  const wrongCode = String((Number(totp(SECRET, clock.now())) + 1) % 1_000_000).padStart(6, '0');
  const wrong = await login({ keys: again.keys, ticket: held.ticket, cafePublic: held.cafePublic, code: wrongCode, stay: true });
  assert.deepEqual(wrong.result, { kind: 'code', ticket: held.ticket, cafePublic: held.cafePublic, message: CODE_WRONG });
  const c = totp(SECRET, clock.now());
  paired(await login({ keys: again.keys, ticket: held.ticket, cafePublic: held.cafePublic, code: c, name: 'Telefonum', stay: true }));
  assert.equal(((await login({ keys: again.keys, ticket: held.ticket, cafePublic: held.cafePublic, code: c, stay: true })).result as { code: string }).code, 'LOGIN_EXPIRED', 'a ticket is good once');
  // A code is good once (step 2 of another sign-in in the same minute).
  assert.deepEqual((await login({ code: c, name: 'Başka', stay: true })).result.kind, 'code', 'the used code: back on the code screen');
  // A page from before 0.1.23 sends both at once: still checked together.
  paired(await login({ both: true, name: 'Eski sayfa' }));
  // Five wrong in a row (the count started again after the right one): the next waits even with everything right; the
  // owner hears it once.
  for (let i = 0; i < 5; i++) assert.equal((await login({ password: `yanlis-${i}` })).result.kind, 'error');
  const waiting = await login({ name: 'Bekleyen', stay: true });
  assert.equal(waiting.result.kind, 'error'); assert.match((waiting.result as { message: string }).message, /^Çok fazla hatalı deneme\. \d+ dakika sonra yeniden deneyin\.$/);
  assert.ok(((await owner('/staff/notifications')).data.items as { title: string }[]).some(n => n.title === 'Kafemi yönet: hatalı girişler'));
  assert.ok(pair.store.auditLog(tenant, 50).some(a => a.action === 'remote.login_failed'));
  // After the wait the right one goes in (and the wrong count starts over).
  clock.add(15 * 60_000);
  paired(await login({ name: 'Sonunda' }));
  assert.deepEqual((await devices()).map(p => p.name), ['Telefonum', 'Eski sayfa', 'Sonunda']);
});

test('the real order (0.1.23, the owner: "kasa açıkken Raporlarım çalışmıyor"): sign in, then the live report at once and after the köprü moved on; the first postbox box is there right away', async t => {
  const { pair, owner, hub, phone, login, paired, clock, remote } = await setup('remote-live-order');
  t.after(() => pair.close());
  await sell(owner, pair.kafe());
  const d = paired(await login({ name: 'iPhone · 15 Ekim' }));
  // Right after the sign-in, as the page does: no waiting for anything.
  const ask = async () => { const q = await signLive(d.keys.privateKey, d.cafePublic, d.phoneId, clock.now()); const r = await phone('live', { phoneId: d.phoneId, token: d.token, request: q }); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.ok(r.data.box, JSON.stringify(r.data)); return openReport<PhoneReport>(d.keys.privateKey, d.cafePublic, r.data.box, { phone: d.phoneId, ref: q.nonce, kind: 'live' }); };
  assert.equal((await ask()).today.sales, 49500);
  // The café's postbox box for the new device came by itself (0.1.23: "son durum" even if the café goes off a minute later).
  await wait(() => hub.hasBox(d.phoneId));
  // Several köprü polls later (the one in flight at the sign-in carried the list from before it): still answered live.
  await new Promise(r => setTimeout(r, 1500));
  for (let i = 0; i < 3; i++) { clock.add(1000); assert.equal((await ask()).today.sales, 49500); }
  // The report carries the business's palette for the page.
  pair.store.mutate(pair.store.findUser('isletme')!.tenantId, s => { s.theme = 'navy'; });
  assert.equal((await ask()).theme, 'navy');
  void remote;
});

test('what is missing is said plainly: no package, the e-mail not verified (the application’s address verified as it is), no phone code, café off', async t => {
  const mail: { to: string; text: string }[] = [];
  const { pair, owner, tenant, relay, phone, login, paired, clock, hub } = await setup('remote-login-missing', { mail });
  t.after(() => pair.close());
  const biz = () => pair.merkezStore.read().businesses.find(b => b.tenantId === tenant)!;
  // No Uzaktan raporlar in the package: a clear line, nothing reaches the café.
  pair.merkezStore.mutate(d => { d.businesses.find(b => b.tenantId === tenant)!.services = { packageId: null, features: ['qr-menu'] as never, updatedAt: new Date().toISOString() }; });
  const none = await phone('login/start', { email: OWNER_EMAIL });
  assert.equal(none.status, 403); assert.equal(none.data.message, 'Bu işletmenin paketinde uzaktan raporlar yok. Mola ekibine ulaşın.');
  pair.merkezStore.mutate(d => { delete d.businesses.find(b => b.tenantId === tenant)!.services; });
  // Only the application's e-mail, not verified: "önce doğrulayın".
  pair.merkezStore.mutate(d => { const b = d.businesses.find(x => x.tenantId === tenant)!; delete b.ownerEmail; b.invoice = { legalName: 'Mola Ltd.', taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1111111114', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. 1', email: OWNER_EMAIL, phone: '05551112233' } as never; d.mail = { settings: { enabled: true, host: 'smtp.example.com', port: 465, security: 'tls', user: 'x', password: 'y', to: 'x@example.com', updatedAt: new Date().toISOString() }, queue: [] }; });
  pair.merkezStore.indexContact(tenant, { email: OWNER_EMAIL, phone: '05551112233' });
  const unverified = await phone('login/start', { email: OWNER_EMAIL });
  assert.equal(unverified.status, 409); assert.equal(unverified.data.message, 'Önce kasada Ayarlar → Uzaktan erişim’de e-postanızı doğrulayın.');
  // Ayarlar → Uzaktan erişim → 2: the application's address itself, verified with the code sent to it (no "old address"
  // step); another address is said plainly to go through Yedek's change.
  const status = (await owner('/staff/owner-email')).data;
  assert.equal(status.source, 'invoice');
  const other = await owner('/staff/owner-email/new-code', { email: 'yeni@ornek.com', password: DEMO_PASSWORD });
  assert.equal(other.status, 409); assert.match(other.data.message, /^Başvurudaki adresiniz s\*+@ornekkafe\.com\. Önce o adresi doğrulayın/);
  const sent = await owner('/staff/owner-email/new-code', { email: OWNER_EMAIL, password: DEMO_PASSWORD });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  const emailCode = /\b(\d{6})\b/.exec(mail.at(-1)!.text)![1];
  assert.equal((await owner('/staff/owner-email/confirm', { ticket: sent.data.ticket, code: emailCode })).status, 200);
  assert.equal(biz().ownerEmail?.email, OWNER_EMAIL);
  paired(await login());
  // No phone code at the café: Merkez knows it from the heartbeat and says what to do.
  pair.merkezStore.mutate(d => { d.businesses.find(b => b.tenantId === tenant)!.remoteLogin!.code = false; });
  const noCode = await phone('login/start', { email: OWNER_EMAIL });
  assert.equal(noCode.status, 409); assert.equal(noCode.data.message, 'Önce kasada Ayarlar → Uzaktan erişim’de telefon kodunu kurun.');
  pair.merkezStore.mutate(d => { d.businesses.find(b => b.tenantId === tenant)!.remoteLogin!.code = true; });
  // The café computer off: a new device waits for it (paired ones read the postbox meanwhile).
  relay.stop(); await new Promise(r => setTimeout(r, 800)); clock.add(60_000);
  assert.equal(hub.online(pair.link.read()!.installId), false);
  const off = await phone('login/start', { email: OWNER_EMAIL });
  assert.equal(off.status, 503); assert.equal(off.data.message, 'Kasa bilgisayarı şu an kapalı. Yeni cihaz, kasa açıkken bağlanır.');
});

test('any device first; at most 3 devices: "Hangisinin yerine?" with a one-time ticket; the same device id again replaces its own line', async t => {
  const { pair, owner, tenant, remote, hub, phone, login, paired, devices, clock } = await setup('remote-login-devices');
  t.after(() => pair.close());
  // What the Raporlarım page says it is, from its own user agent (iPad asking for the desktop site: a Mac with touch).
  const UA = { iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0' };
  assert.deepEqual([deviceKindOf(UA.iphone), deviceKindOf(UA.android), deviceKindOf(UA.androidTablet), deviceKindOf(UA.ipad, 5), deviceKindOf(UA.ipad, 0), deviceKindOf(UA.windows)], ['phone', 'phone', 'tablet', 'tablet', 'computer', 'computer']);
  // 0.1.23: no phone-first rule; a laptop goes in first. The kind is only the list's icon.
  const IPHONE = 'i'.repeat(22), LAPTOP = 'l'.repeat(22);
  const first = paired(await login({ name: 'Windows laptop · 15 Ekim', kind: 'computer', device: LAPTOP }));
  // The same laptop again (its browser dropped the keys, its own id stayed): its own line is replaced, the old token is gone.
  const laptop = paired(await login({ name: 'Windows laptop · 22 Ekim', kind: 'computer', device: LAPTOP }));
  assert.equal((await phone('postbox', { phoneId: first.phoneId, token: first.token })).status, 403, 'the second sign-in of the same laptop replaced the first');
  assert.deepEqual((await devices()).map(p => [p.id, p.name, p.kind]), [[laptop.phoneId, 'Windows laptop · 22 Ekim', 'computer']]);
  assert.equal(hub.phones(tenant), 1);
  // The report says "Kafeyi yönet" is in the package (not turned on yet).
  const q = await signLive(laptop.keys.privateKey, laptop.cafePublic, laptop.phoneId, clock.now()), asked = await phone('live', { phoneId: laptop.phoneId, token: laptop.token, request: q });
  assert.equal((await openReport<PhoneReport>(laptop.keys.privateKey, laptop.cafePublic, asked.data.box, { phone: laptop.phoneId, ref: q.nonce, kind: 'live' })).admin, 'off');
  // The phone, and a tablet whose browser forgot everything (no id): new lines.
  paired(await login({ name: 'iPhone · 22 Ekim', device: IPHONE }));
  paired(await login({ name: 'iPad · 22 Ekim', kind: 'tablet' }));
  assert.deepEqual((await devices()).map(p => p.name), ['Windows laptop · 22 Ekim', 'iPhone · 22 Ekim', 'iPad · 22 Ekim']);
  // A fourth: the right password and code get the list and a ticket; nothing is added yet.
  const fourth = await login({ name: 'Mac · 22 Ekim', kind: 'computer' });
  assert.equal(fourth.result.kind, 'full', JSON.stringify(fourth.result));
  const full = fourth.result as Extract<typeof fourth.result, { kind: 'full' }>;
  assert.equal(full.message, 'En fazla 3 cihaz. Hangisinin yerine?');
  assert.deepEqual(full.devices.map(d => [d.name, d.kind]), [['Windows laptop · 22 Ekim', 'computer'], ['iPhone · 22 Ekim', 'phone'], ['iPad · 22 Ekim', 'tablet']]);
  assert.equal(hub.phones(tenant), 3);
  // The ticket is for this device's key only, and once.
  const stolen = await login({ keys: await newPhoneKeys(), ticket: full.ticket, replace: full.devices[1].id, name: 'Mac · 22 Ekim', kind: 'computer', cafePublic: full.cafePublic });
  assert.equal((stolen.result as { code: string }).code, 'LOGIN_EXPIRED');
  const again = await login({ name: 'Mac · 22 Ekim', kind: 'computer' }), ticket = (again.result as typeof full);
  // A code ticket is no replace ticket.
  assert.equal(ticket.kind, 'full');
  const replaced = paired(await login({ keys: again.keys, ticket: ticket.ticket, replace: ticket.devices.find(d => d.name === 'Windows laptop · 22 Ekim')!.id, name: 'Mac · 22 Ekim', kind: 'computer', cafePublic: ticket.cafePublic }));
  assert.deepEqual((await devices()).map(p => p.name), ['iPhone · 22 Ekim', 'iPad · 22 Ekim', 'Mac · 22 Ekim']);
  assert.equal((await phone('postbox', { phoneId: laptop.phoneId, token: laptop.token })).status, 403, 'the replaced laptop is gone at Merkez too');
  assert.equal((await login({ keys: again.keys, ticket: ticket.ticket, replace: ticket.devices[0].id, name: 'Mac · 22 Ekim', kind: 'computer', cafePublic: ticket.cafePublic })).result.kind, 'error', 'a ticket is good once');
  void replaced;
  // Merkez keeps a device added a moment ago against a poll's list from before it (the poll can arrive after the sign-in's
  // reply); a removal announced by the café (/relay/state) is not held back.
  const install = pair.link.read()!.installId;
  hub.tenants(install, [], pair.merkezStore.read(), true);
  assert.doesNotThrow(() => hub.phone(replaced.phoneId, replaced.token));
  pair.merkezStore.db.prepare('UPDATE relay_phones SET created=? WHERE phone=?').run(new Date(Date.now() - 3 * 60_000).toISOString(), replaced.phoneId);
  hub.tenants(install, [], pair.merkezStore.read(), true);
  assert.throws(() => hub.phone(replaced.phoneId, replaced.token), /bağlı değil/);
  // The phone removed on the café computer: a laptop still goes in (no phone needed); devices paired before 0.1.21 (no
  // kind) are listed as "Cihaz".
  const phoneId = (await devices()).find(p => p.kind === 'phone')!.id;
  assert.equal((await owner('/staff/remote-reports/phones/remove', { id: phoneId, password: DEMO_PASSWORD })).status, 200);
  (remote as unknown as { write: (t: string, fn: (r: { phones: { kind?: string }[] }) => void) => void }).write(tenant, r => { for (const p of r.phones) delete p.kind; });
  assert.deepEqual((await devices()).map(p => p.kind), [null, null]);
  paired(await login({ name: 'Windows laptop · 23 Ekim', kind: 'computer' }));
});

test('the owner’s own list: Müdür and staff 403, "Kaldır" asks the password (not the code), no pairing routes left; a device keeps working without the code; "Son rapor"', async t => {
  const { pair, owner, tenant, phone, login, paired, devices, mfa, clock } = await setup('remote-reauth');
  t.after(() => pair.close());
  const MANAGER = 'MudurDeneme!2026';
  const made = await owner('/staff/users', { username: 'mudur', name: 'Müdür Mehmet', role: 'manager', password: MANAGER });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const manager = pair.kafe(); assert.equal((await manager('/login', { username: 'mudur', password: MANAGER })).status, 200);
  const cashier = pair.kafe(); assert.equal((await cashier('/login', { username: 'kasiyer', password: DEMO_PASSWORD })).status, 200);
  for (const who of [manager, cashier]) {
    assert.equal((await who('/staff/remote-reports')).status, 403);
    const r = await who('/staff/remote-reports/phones/remove', { id: 'p'.repeat(22), password: DEMO_PASSWORD }); assert.equal(r.status, 403); assert.equal(r.data.code, 'FORBIDDEN');
  }
  // The QR pairing is gone (0.1.22): its routes answer nothing.
  for (const path of ['/staff/remote-reports/pair', '/staff/remote-reports/pair/cancel']) assert.equal((await owner(path, { name: 'X', password: DEMO_PASSWORD, code: '123456' })).status, 404, path);
  // The view tells the Raporlarım address and whether the owner has the code.
  const view = (await owner('/staff/remote-reports')).data;
  assert.equal(view.address, `${pair.merkezBase}/yonet`); assert.equal(view.code, true);
  const ahmet = paired(await login({ name: 'Ahmet’in telefonu' })), laptop = await login({ name: 'Ev laptopu', kind: 'computer' }), lp = paired(laptop);
  // "Son rapor": when each device last fetched a live report.
  const live = await phone('live', { phoneId: lp.phoneId, token: lp.token, request: await signLive(laptop.keys.privateKey, lp.cafePublic, lp.phoneId, clock.now()) });
  assert.equal(live.status, 200, JSON.stringify(live.data));
  const seen = await devices();
  assert.equal(seen.find(p => p.name === 'Ev laptopu')!.lastSeenAt, new Date(clock.now()).toISOString());
  assert.equal(seen.find(p => p.name === 'Ahmet’in telefonu')!.lastSeenAt, null);
  // A device signed in before keeps working when the owner turns the code off (only new sign-ins need it).
  mfa(false);
  assert.equal((await phone('live', { phoneId: lp.phoneId, token: lp.token, request: await signLive(laptop.keys.privateKey, lp.cafePublic, lp.phoneId, clock.now()) })).status, 200);
  // "Kaldır": the password again, not the phone code (the lost phone may hold the authenticator app).
  const bare = await owner('/staff/remote-reports/phones/remove', { id: ahmet.phoneId });
  assert.equal(bare.status, 400); assert.equal(bare.data.code, 'PASSWORD_REQUIRED');
  const wrongPassword = await owner('/staff/remote-reports/phones/remove', { id: ahmet.phoneId, password: 'yanlis' });
  assert.equal(wrongPassword.status, 403); assert.equal(wrongPassword.data.code, 'INVALID_PASSWORD');
  assert.equal((await owner('/staff/remote-reports/phones/remove', { id: ahmet.phoneId, password: DEMO_PASSWORD })).status, 200);
  assert.deepEqual((await devices()).map(p => p.name), ['Ev laptopu']);
  // A remote session ("Kafeyi yönet") cannot remove, password or not.
  assert.ok(remoteRefusal('POST', '/api/staff/remote-reports/phones/remove', { id: ahmet.phoneId, password: DEMO_PASSWORD }));
  void tenant;
});

test('postbox: only the café’s own phones, size limit, deleted after 7 days', async t => {
  const { pair, hub, phone, login, paired, clock } = await setup('remote-postbox');
  t.after(() => pair.close());
  const { phoneId, token, keys } = paired(await login());
  const record = pair.link.read()!, path = `${MERKEZ_API}/relay/postbox`;
  const send = (body: unknown) => { const text = JSON.stringify(body); return fetch(pair.merkezBase + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedHeaders(record.installId, record.secret, 'POST', path, text, clock.now()) }, body: text }); };
  const tenantId = pair.store.findUser('isletme')!.tenantId;
  const box = await sealReport(await cafePrivateKey((await newCafeKeys()).privateKey), keys.publicKey, { kind: 'snapshot', phone: phoneId, at: new Date(clock.now()).toISOString() }, { x: 1 });
  // Too large: refused as a whole.
  assert.equal((await send({ items: [{ tenantId, phoneId, box: { ...box, ct: 'A'.repeat(400 * 1024) } }] })).status, 400);
  // A phone of another business / an unknown phone: not kept.
  assert.equal((await (await send({ items: [{ tenantId: 'baska', phoneId, box }, { tenantId, phoneId: 'q'.repeat(22), box: { ...box, phone: 'q'.repeat(22) } }] })).json()).kept, 0);
  assert.equal((await (await send({ items: [{ tenantId, phoneId, box }] })).json()).kept, 1);
  assert.equal(hub.hasBox(phoneId), true);
  // Not fetched for 8 days: gone.
  clock.add(8 * 86400_000); hub.sweep();
  assert.equal(hub.hasBox(phoneId), false);
  assert.equal((await phone('postbox', { phoneId, token })).data.box, null);
});

test('a heartbeat that brings new `accepts` is followed by one more within seconds, once (after an update the sign-in key reaches Merkez at once, not in 10–20 minutes)', async t => {
  const sent: string[] = [];
  const recording: typeof fetch = async (input, init) => { if (String(input).endsWith('/sync') && typeof init?.body === 'string') sent.push(init.body); return fetch(input, init); };
  const pair = await merkezPair('accepts-nudge', { demo: true, fetch: recording });
  t.after(() => pair.close());
  await pair.importDemo();
  const remote = pair.kafeApp.locals.remote as RemoteReports;
  // The business key made beforehand (its own heartbeat is not part of this).
  await wait(() => remote.loginReport().length > 0);
  // The café knew a Merkez without 'remote.login' (before Merkez was updated); its automatic heartbeats run.
  const link = pair.link as unknown as { auto: boolean; write: (fn: (r: { accepts?: string[] }) => void) => void };
  link.write(r => { r.accepts = (r.accepts ?? []).filter(x => x !== 'remote.login'); });
  link.auto = true; t.after(() => pair.link.stop());
  sent.length = 0;
  await pair.link.sync();
  assert.equal(sent.length, 1); assert.equal(JSON.parse(sent[0]).remote, undefined, 'the first one did not know yet');
  // The answer said 'remote.login': the next heartbeat goes in a few seconds and carries the business's sign-in key.
  await wait(() => sent.length >= 2, 8000);
  assert.ok(Array.isArray(JSON.parse(sent[1]).remote), sent[1].slice(0, 200));
  // Once: nothing new in that answer, so no third one.
  await new Promise(r => setTimeout(r, 4000));
  assert.equal(sent.length, 2);
});
