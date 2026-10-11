import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { MerkezLink, networkProblem, readSavedContact } from '../server/kafe-link.js';
import { newSigningPair, publicKeyFrom, verifyContact } from '../server/license.js';
import { sweepAlerts } from '../server/merkez/app.js';
import { Store } from '../server/store.js';
import { syncRequest, type ApplicationForm } from '../server/sync-protocol.js';
import { client, licensed, MERKEZ_PASSWORD, merkezPair, temp } from './merkez-fixture.js';

process.env.MOLA_APPLICATION_POLL_MS = '0';
// The café asks Merkez's public /contact on every look in tests (normally at most once a minute / ten minutes).
process.env.MOLA_CONTACT_POLL_MS = '1';
const rid = () => randomUUID().replace(/-/g, '');
const DAY = 86400000;
const contact = { phone: '0850 123 45 67', whatsapp: '0532 765 43 21', email: 'destek@mola.example', hours: 'Hafta içi 09:00–18:00', web: 'https://mola.example/destek' };
const blank = { phone: '', whatsapp: '', email: '', hours: '', web: '' };
function form(name: string, invoice: Partial<ApplicationForm['invoice']> = {}, extra: Partial<ApplicationForm> = {}): ApplicationForm {
  return { businessName: name, sector: 'cafe', contactName: 'Ayşe Yılmaz', consent: true, ...extra,
    invoice: { legalName: `${name} Gıda Ltd. Şti.`, taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1234567890', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 1', phone: '+905321234567', email: 'ayse@example.com', ...invoice } };
}
async function serve(handler: RequestListener) {
  const server = createServer(handler); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }) };
}

test('Mola ekibi iletişim bilgileri: typed in Mola Yönetim, signed; the café reads it before activation, keeps it after, shows it offline; empty or forged shows nothing', async t => {
  let time = Date.parse('2026-10-04T09:00:00Z');
  const pair = await merkezPair('contact', { now: () => new Date(time) }); t.after(() => pair.close());
  const kafe = pair.kafe(), key = publicKeyFrom(pair.merkezStore.publicKey);
  // Packaged default: nothing until the vendor fills it in.
  assert.deepEqual((await kafe('/contact')).data, { contact: null });
  await pair.adminLogin();
  assert.deepEqual((await pair.admin('/contact')).data, { contact: null });
  assert.equal((await client(`${pair.merkezBase}/api/merkez/admin`)('/contact', contact)).status, 401, 'only the vendor edits it');
  // Checked like the café checks it again: https web address, a phone made of digits, a real e-mail.
  for (const wrong of [{ web: 'http://mola.example' }, { phone: 'beni ara' }, { email: 'destek@' }]) {
    const r = await pair.admin('/contact', { ...contact, ...wrong }); assert.equal(r.status, 400); assert.equal(r.data.code, 'CONTACT_INVALID');
  }
  assert.equal((await pair.admin('/contact', { ...contact, extra: 'x' })).status, 400);
  const saved = await pair.admin('/contact', contact);
  assert.equal(saved.status, 200); assert.equal(saved.data.contact.phone, contact.phone);
  assert.ok((await pair.admin('/state')).data.audit.some((a: any) => a.action === 'contact.updated' && /telefon/.test(a.detail)));
  // Public, signed with Merkez's key, cache-friendly (5 minutes, ETag).
  const pub = await fetch(`${pair.merkezBase}/api/merkez/v1/contact`);
  assert.match(pub.headers.get('cache-control') ?? '', /public, max-age=300/);
  const body = await pub.json();
  assert.deepEqual((({ v, updatedAt, ...rest }) => rest)(verifyContact(body.contact, key)), contact);
  assert.equal((await fetch(`${pair.merkezBase}/api/merkez/v1/contact`, { headers: { 'If-None-Match': pub.headers.get('etag')! } })).status, 304);
  // A clean café (not activated) reads it from there and keeps the signed copy beside its data.
  assert.deepEqual((await kafe('/contact')).data.contact, contact);
  assert.ok(existsSync(join(pair.store.directory, 'mola-iletisim.json')));
  // Merkez unreachable: still shown (a new start of the café over the same folder).
  const offline = new MerkezLink(pair.store, { url: 'http://127.0.0.1:9', publicKey: key });
  await offline.refreshContact(true); assert.deepEqual(offline.contact(), contact);
  // Only what our Merkez signed: another key, or an edited copy, is ignored.
  assert.equal(readSavedContact(pair.store.directory, publicKeyFrom(newSigningPair().publicKey)), undefined);
  const file = join(pair.store.directory, 'mola-iletisim.json'), kept = readFileSync(file, 'utf8'), signed = JSON.parse(kept);
  const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(signed.payload, 'base64url').toString()), phone: '0555 000 00 00' })).toString('base64url');
  writeFileSync(file, JSON.stringify({ ...signed, payload: edited }));
  assert.equal(new MerkezLink(pair.store, { url: 'http://127.0.0.1:9', publicKey: key }).contact(), undefined);
  writeFileSync(file, kept);

  // After activation the heartbeat brings each change; an older copy never replaces a newer one.
  await kafe('/activation/application', form('Köşe Kafe'));
  const [business] = (await pair.admin('/state')).data.businesses;
  await pair.admin('/applications/approve', { requestId: rid(), tenantId: business.tenantId });
  await pair.link.checkApplication();
  await kafe('/activation/owner', { username: 'ayse', password: 'AyseKafe!2026' });
  time += 60_000;
  await pair.admin('/contact', { ...contact, phone: '0850 999 88 77' });
  assert.equal((await pair.link.sync()).ok, true);
  assert.equal(pair.link.contact()?.phone, '0850 999 88 77');
  // 14 days without Merkez: the panel's licence banner says how to reach the Mola team (plain text).
  time += 15 * DAY;
  assert.match(pair.link.bannerNotice(business.tenantId)!, /gündür bağlanılamadı.*Mola ekibi: Tel\. 0850 999 88 77 · WhatsApp 0532 765 43 21 · destek@mola\.example/);
  // The vendor clears it: nothing is shown any more.
  await pair.adminLogin(); assert.equal((await pair.admin('/contact', blank)).status, 200);
  assert.equal((await pair.link.sync()).ok, true);
  assert.equal(pair.link.contact(), undefined); assert.deepEqual((await kafe('/contact')).data, { contact: null });
  assert.doesNotMatch(pair.link.bannerNotice(business.tenantId) ?? '', /Mola ekibi:/);
});

test('Merkez not reached: no internet, Merkez not answering, a wrong or refusing address and a wrong clock are told apart', async t => {
  const failed = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
  const remote = 'https://merkez.example.com', local = 'http://127.0.0.1:4000';
  const kind = (e: unknown, url = remote, online = true) => networkProblem(e, url, online).code;
  assert.equal(kind(failed('ECONNREFUSED')), 'MERKEZ_UNREACHABLE');
  assert.equal(kind(new TypeError('fetch failed', { cause: new AggregateError([Object.assign(new Error('x'), { code: 'ECONNREFUSED' })]) })), 'MERKEZ_UNREACHABLE');
  assert.equal(kind(new DOMException('zaman aşımı', 'TimeoutError')), 'MERKEZ_UNREACHABLE');
  assert.equal(kind(failed('ENOTFOUND')), 'MERKEZ_ADDRESS');
  assert.equal(kind(failed('EAI_AGAIN')), 'MERKEZ_OFFLINE');
  assert.equal(kind(failed('ECONNREFUSED'), remote, false), 'MERKEZ_OFFLINE', 'no network at all on this computer');
  assert.equal(kind(failed('ECONNREFUSED'), local, false), 'MERKEZ_UNREACHABLE', 'a Merkez on this computer needs no internet');
  assert.equal(kind(failed('CERT_HAS_EXPIRED')), 'MERKEZ_CLOCK'); assert.equal(kind(failed('CERT_NOT_YET_VALID')), 'MERKEZ_CLOCK');
  assert.equal(kind(failed('DEPTH_ZERO_SELF_SIGNED_CERT')), 'MERKEZ_ADDRESS'); assert.equal(kind(failed('ERR_TLS_CERT_ALTNAME_INVALID')), 'MERKEZ_ADDRESS');
  assert.match(networkProblem(failed('EAI_AGAIN'), remote, true).message, /İnternet bağlantısı yok/);
  assert.match(networkProblem(failed('CERT_HAS_EXPIRED'), remote, true).message, /saati yanlış/);
  // HTTP answers from something that is not Merkez (no clock header, no Merkez JSON).
  const page = await serve((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>Wi-Fi giriş sayfası</html>'); });
  const refuse = await serve((_req, res) => { res.writeHead(403, { 'Content-Type': 'application/json', 'X-Mola-Server-Time': new Date().toISOString() }); res.end(JSON.stringify({ code: 'HOST_REJECTED', message: 'Bu adres kabul edilmiyor.' })); });
  const proxy = await serve((_req, res) => { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Bad Gateway'); });
  const skew = await serve((_req, res) => { res.writeHead(401, { 'Content-Type': 'application/json', 'X-Mola-Server-Time': new Date().toISOString() }); res.end(JSON.stringify({ code: 'CLOCK_SKEW', message: 'saat' })); });
  t.after(async () => { for (const s of [page, refuse, proxy, skew]) await s.close(); });
  const key = publicKeyFrom(newSigningPair().publicKey);
  const activate = (url: string) => new MerkezLink(new Store(temp('problem'), []), { url, publicKey: key }).activate('code', { code: 'ABCD-EFGH-JKLM' });
  await assert.rejects(activate(page.url), (e: Error & { code?: string }) => e.code === 'MERKEZ_ADDRESS' && /Mola Merkez değil/.test(e.message));
  await assert.rejects(activate(refuse.url), (e: Error & { code?: string }) => e.code === 'MERKEZ_ADDRESS' && /reddetti \(yanıt 403\)/.test(e.message));
  await assert.rejects(activate(proxy.url), (e: Error & { code?: string }) => e.code === 'MERKEZ_UNREACHABLE');
  // A signed heartbeat refused for the clock even after the retry with Merkez's time: said as a clock problem.
  const store = new Store(temp('problem-clock'), []); licensed(store); t.after(() => store.close());
  const sync = await new MerkezLink(store, { url: skew.url }).sync();
  assert.equal(sync.ok, false); assert.match(sync.error!, /Bilgisayarın saati Mola Merkez’in saatinden çok farklı/);
});

test('second backup: reported to Merkez only once it says it takes it; the vendor sees it; 7 days without a second place: a quiet alert, never e-mailed', async t => {
  let time = Date.parse('2026-10-04T09:00:00Z');
  const pair = await merkezPair('backup-second', { demo: true, now: () => new Date(time) }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin();
  let backup = { enabled: true, lastSuccessAt: new Date(time).toISOString(), failing: false, lastAttemptAt: new Date(time).toISOString() as string | null, second: { set: false, lastCopyAt: null as string | null, failing: false } };
  const reporter = pair.link.reporter; pair.link.reporter = { ...reporter, backup: () => backup };
  // Before Merkez said it takes them (an older Merkez refuses unknown fields), nothing extra is sent.
  assert.deepEqual(Object.keys(pair.link.payload(pair.link.read()!).backup).sort(), ['enabled', 'failing', 'lastSuccessAt']);
  assert.equal((await pair.link.sync()).ok, true);
  // Merkez lists every optional field it takes (others too: 'update', …); this test is about 'backup.second'.
  assert.ok(pair.link.read()!.accepts?.includes('backup.second'));
  const payload = pair.link.payload(pair.link.read()!);
  assert.doesNotThrow(() => syncRequest.parse(payload));
  assert.deepEqual(payload.backup.second, { set: false, lastCopyAt: null, failing: false }, 'yes/no and times only, never a path');
  assert.equal((await pair.link.sync()).ok, true);
  let biz = (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo');
  assert.deepEqual(biz.backup.second, { set: false, lastCopyAt: null, failing: false }); assert.equal(biz.secondMissingSince, new Date(time).toISOString());
  // E-mail is on, but this one is low priority: no e-mail, no sound; once per period.
  pair.merkezStore.mutate(d => { d.mail = { settings: { enabled: true, host: 'smtp.example.com', port: 465, security: 'tls', user: 'v@example.com', password: 'x', to: 'v@example.com', updatedAt: new Date(time).toISOString() }, queue: [] }; });
  time += 6 * DAY; await pair.link.sync(); sweepAlerts(pair.merkezStore, new Date(time));
  assert.equal((pair.merkezStore.read().alerts ?? []).filter(a => a.title === 'İkinci yedek yeri ayarlı değil').length, 0, 'not before 7 days');
  time += 2 * DAY; await pair.link.sync();
  assert.equal(sweepAlerts(pair.merkezStore, new Date(time)), 1); assert.equal(sweepAlerts(pair.merkezStore, new Date(time + 3600_000)), 0);
  const alert = pair.merkezStore.read().alerts!.find(a => a.title === 'İkinci yedek yeri ayarlı değil')!;
  assert.equal(alert.kind, 'cafe.backup'); assert.equal(alert.priority, 'low'); assert.equal(alert.tenantId, 'mola-demo');
  assert.equal(pair.merkezStore.read().mail!.queue.length, 0, 'never e-mailed');
  // Set at last, with a failed copy: shown as it is; the "since" goes.
  backup = { ...backup, second: { set: true, lastCopyAt: null, failing: true } };
  await pair.link.sync(); await pair.adminLogin();
  biz = (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo');
  assert.deepEqual(biz.backup.second, { set: true, lastCopyAt: null, failing: true }); assert.equal(biz.secondMissingSince, undefined);
  assert.equal(biz.backup.lastAttemptAt, backup.lastAttemptAt);
});

test('Olası tekrar: only strong signals, each with its reason; a name alone is quiet; phone and e-mail kept only as keyed hashes', async t => {
  const pair = await merkezPair('repeats'); t.after(() => pair.close());
  await pair.adminLogin();
  const merkez = client(`${pair.merkezBase}/api/merkez/v1`);
  const apply = async (name: string, machine: string, invoice: Partial<ApplicationForm['invoice']>, extra: Partial<ApplicationForm> = {}) => {
    const r = await merkez('/applications', { ...form(name, invoice, extra), requestId: rid(), installId: randomUUID(), machineId: machine.repeat(64), appVersion: '0.1.0' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  };
  await apply('Köşe Kafe', 'a', { taxNumber: '1234567890', phone: '+905321111111', email: 'kose@example.com' });
  // The same name from another computer, nothing else shared: no hint.
  await apply('Köşe Kafe', 'b', { taxNumber: '6120069780', phone: '+905322222222', email: 'baska@example.com', city: 'Ankara', district: 'Çankaya', address: 'Atatürk Blv. 5', legalName: 'Başka Gıda A.Ş.' }, { contactName: 'Mehmet Demir' });
  // The same computer as the first, another tax number: strong.
  await apply('Yan Kafe', 'a', { taxNumber: '9000068418', phone: '+905323333333', email: 'yan@example.com', address: 'Bahariye Cd. 3' }, { contactName: 'Can Er' });
  // The same phone (written differently) and e-mail (letter case) as the first: strong.
  await apply('Telefon Kafe', 'd', { taxNumber: '1111111114', phone: '0532 111 11 11', email: 'KOSE@example.com', address: 'Moda Cd. No: 9' }, { contactName: 'Ali Veli' });
  // A similar name with the same contact person and address but nothing strong: a soft note.
  await apply('köşe  kafe!', 'e', { taxNumber: '3333333339', phone: '+905325555555', email: 'e@example.com', legalName: 'Kuzey Ltd.' });
  // Imports from one computer (demo folders): same computer, same name, no invoices: no hint.
  const importer = client(`${pair.merkezBase}/api/merkez/admin`); await importer('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  for (const tenantId of ['demo-1', 'demo-2']) assert.equal((await importer('/import', { requestId: rid(), machineId: 'f'.repeat(64), businesses: [{ tenantId, name: 'Mola Coffee House', license: { endsAt: new Date(Date.now() + 365 * DAY).toISOString(), suspended: false, kind: 'subscription', planMonths: 12 } }] })).status, 200);
  const list = (await pair.admin('/state')).data.businesses as any[];
  const byName = (name: string, machineHint?: string) => list.find(b => b.name === name && (!machineHint || b.invoice?.phone.endsWith(machineHint)))!;
  const first = byName('Köşe Kafe', '1111111'), twin = byName('Köşe Kafe', '2222222'), side = byName('Yan Kafe'), phone = byName('Telefon Kafe'), soft = byName('köşe  kafe!');
  const reasons = (b: any) => Object.fromEntries((b.duplicates as any[]).map(o => [o.name + (o.tenantId === first.tenantId ? '#1' : o.tenantId === twin.tenantId ? '#2' : ''), [o.strong, o.reasons]]));
  assert.deepEqual(reasons(first), { 'Yan Kafe': [true, ['Aynı bilgisayar, farklı vergi no']], 'Telefon Kafe': [true, ['Aynı telefon', 'Aynı e-posta']], 'köşe  kafe!': [false, ['Benzer ad; aynı yetkili, aynı adres']] });
  assert.deepEqual(twin.duplicates, [], 'the same name alone says nothing');
  assert.deepEqual(reasons(side), { 'Köşe Kafe#1': [true, ['Aynı bilgisayar, farklı vergi no']] });
  assert.deepEqual(reasons(phone), { 'Köşe Kafe#1': [true, ['Aynı telefon', 'Aynı e-posta']] });
  assert.deepEqual(phone.sameContact, { phone: true, email: true }); assert.deepEqual(twin.sameContact, { phone: false, email: false });
  assert.deepEqual(reasons(soft), { 'Köşe Kafe#1': [false, ['Benzer ad; aynı yetkili, aynı adres']] });
  for (const id of ['demo-1', 'demo-2']) assert.deepEqual(list.find(b => b.tenantId === id).duplicates, []);
  // Only keyed hashes in the index: no number or address, no plain SHA-256 of one; the registry itself is sealed.
  const rows = pair.merkezStore.db.prepare('SELECT hash, kind FROM contact_index').all() as { hash: string; kind: string }[];
  assert.ok(rows.length >= 10);
  for (const value of ['5321111111', '905321111111', '+905321111111', 'kose@example.com']) {
    assert.equal(rows.some(r => r.hash.includes(value) || r.hash === createHash('sha256').update(value).digest('hex')), false, value);
    assert.equal(readFileSync(join(pair.merkezStore.directory, 'merkez.sqlite')).toString('latin1').includes(value), false, value);
  }
  // A deleted (never connected) record leaves the index too.
  assert.equal((await pair.admin('/businesses/delete', { requestId: rid(), tenantId: phone.tenantId })).status, 200);
  assert.equal((pair.merkezStore.db.prepare('SELECT count(*) AS n FROM contact_index WHERE tenant=?').get(phone.tenantId) as { n: number }).n, 0);
  assert.deepEqual(reasons((await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === first.tenantId)), { 'Yan Kafe': [true, ['Aynı bilgisayar, farklı vergi no']], 'köşe  kafe!': [false, ['Benzer ad; aynı yetkili, aynı adres']] });
});

test('re-import of the same folder: the same install and business ids, a new secret, and no false "İki farklı bilgisayar"', async t => {
  const pair = await merkezPair('reimport', { demo: true }); t.after(() => pair.close());
  const first = await pair.importDemo() as { installId: string; secret?: string };
  assert.equal((await pair.link.sync()).ok, true);
  const oldSecret = pair.link.read()!.secret;
  // The folder lost its link (a copy from before the import, an interrupted script) and is imported again.
  pair.store.db.exec('DELETE FROM merkez_link');
  const importer = client(`${pair.merkezBase}/api/merkez/admin`); await importer('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  const again = await importer('/import', { requestId: rid(), businesses: ['mola-demo', 'other-demo'].map(tenantId => ({ tenantId, name: pair.store.directoryEntry(tenantId).name, license: { endsAt: new Date(Date.now() + 365 * DAY).toISOString(), suspended: false, kind: 'subscription', planMonths: 12 } })) });
  assert.equal(again.status, 200); assert.equal(again.data.installId, first.installId); assert.equal(again.data.reused, true); assert.notEqual(again.data.secret, oldSecret);
  const link = new MerkezLink(pair.store, { url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), machineKey: 'test:kasa-pc' });
  link.adopt(again.data);
  assert.equal((await link.sync()).ok, true);
  await pair.adminLogin();
  const state = (await pair.admin('/state')).data;
  assert.equal(state.alerts.some((a: any) => a.kind === 'machine.conflict'), false, 'the same computer, not a copy');
  const biz = state.businesses.find((b: any) => b.tenantId === 'mola-demo');
  assert.equal(biz.installId, first.installId); assert.deepEqual(biz.machines.map((m: any) => m.active), [true]);
  assert.equal(state.businesses.length, 2, 'no new businesses');
  assert.ok(state.audit.some((a: any) => a.action === 'install.reimported'));
  // The old secret no longer signs in.
  const old = new MerkezLink(new Store(temp('reimport-old'), []), { url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey) });
  old.adopt({ installId: first.installId, secret: oldSecret, licenses: [], serverTime: new Date().toISOString() });
  assert.equal((await old.sync()).ok, false);
});
