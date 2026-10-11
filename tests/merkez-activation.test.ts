import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { MerkezLink } from '../server/kafe-link.js';
import { newSigningPair, publicKeyFrom } from '../server/license.js';
import { Store } from '../server/store.js';
import type { ApplicationForm } from '../server/sync-protocol.js';
import { client, merkezPair, temp } from './merkez-fixture.js';

// The café asks Merkez on every look while it waits (no 2 s pause in tests).
process.env.MOLA_APPLICATION_POLL_MS = '0';
const rid = () => randomUUID().replace(/-/g, '');
const DAY = 86400000;
type Pair = Awaited<ReturnType<typeof merkezPair>>;
const isCode = (code: string) => (e: Error & { code?: string }) => e.code === code;
/** A complete "Hesap açma başvurusu"; `invoice` fields override the defaults. */
function form(name: string, invoice: Partial<ApplicationForm['invoice']> = {}, extra: Partial<ApplicationForm> = {}): ApplicationForm {
  return { businessName: name, sector: 'cafe', contactName: 'Ayşe Yılmaz', consent: true, ...extra,
    invoice: { legalName: `${name} Gıda Ltd. Şti.`, taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1234567890', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 1', phone: '+905321234567', email: 'ayse@example.com', ...invoice } };
}
/** Another café computer (its own data folder and activation ids) talking to the same Merkez. */
function otherCafe(pair: Pair, name: string, options: { publicKey?: string; fetch?: typeof fetch; machine?: string } = {}) {
  const store = new Store(temp(name), []);
  return { store, link: new MerkezLink(store, { url: pair.merkezBase, publicKey: publicKeyFrom(options.publicKey ?? pair.merkezStore.publicKey), machineId: options.machine ?? 'b'.repeat(64), fetch: options.fetch }) };
}
const businesses = async (pair: Pair) => (await pair.admin('/state')).data.businesses as any[];
const ticketCount = (store: Store) => (store.db.prepare('SELECT count(*) AS n FROM merkez_activation').get() as { n: number }).n;

test('clean install: "Hesap açma başvurusu" waits for the vendor, approval unlocks the café through its poll, the owner account stays here', async t => {
  let time = Date.parse('2026-10-03T09:00:00Z');
  const pair = await merkezPair('application', { now: () => new Date(time) }); t.after(() => pair.close());
  const kafe = pair.kafe();
  assert.equal((await kafe('/health')).data.activation, 'activate');
  assert.deepEqual((await kafe('/activation')).data, { state: 'activate', local: true, existingData: false });
  // No self-serve trial any more, on the café or at Merkez.
  assert.equal((await kafe('/activation/trial', { requestId: rid(), businessName: 'Köşe Kafe', sector: 'cafe', contactName: 'Ayşe Yılmaz' })).status, 410);
  assert.equal((await client(`${pair.merkezBase}/api/merkez/v1`)('/activate/trial', { requestId: rid(), machineId: 'a'.repeat(64), appVersion: '0.1.0', businessName: 'Köşe Kafe', sector: 'cafe', contactName: 'Ayşe' })).status, 410);
  // Not from a tablet or through a tunnel; every field checked (official VKN checksum).
  assert.equal((await kafe('/activation/application', form('Köşe Kafe'), { 'X-Forwarded-For': '192.168.1.20' })).data.code, 'LOCAL_ONLY');
  assert.equal((await kafe('/activation/application', form('Köşe Kafe', { taxNumber: '1234567891' }))).status, 400);
  assert.equal((await kafe('/activation/application', { ...form('Köşe Kafe'), consent: false })).status, 400);
  const sent = await kafe('/activation/application', form('Köşe Kafe', { phone: '0532 123 45 67' }, { sector: 'restaurant' }));
  assert.equal(sent.status, 200, JSON.stringify(sent.data)); assert.equal(sent.data.state, 'applied');
  let status = (await kafe('/activation')).data;
  assert.equal(status.state, 'applied'); assert.equal(status.application.status, 'pending'); assert.equal(status.application.name, 'Köşe Kafe');
  assert.equal(status.application.form.invoice.phone, '+905321234567', 'kept for "Bilgileri düzelt"');
  // Nothing works yet: no login, no owner account.
  assert.equal((await kafe('/activation/owner', { username: 'ayse', password: 'AyseKafe!2026' })).data.code, 'NOT_PENDING');
  // The vendor sees the application with every invoice field; no licence, no install until approved.
  await pair.adminLogin();
  let [business] = await businesses(pair);
  assert.equal(business.application.status, 'pending'); assert.equal(business.activation, 'pending'); assert.equal(business.endsAt, null); assert.equal(business.source, 'application');
  assert.deepEqual(business.invoice, { legalName: 'Köşe Kafe Gıda Ltd. Şti.', taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1234567890', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 1', phone: '+905321234567', email: 'ayse@example.com' });
  assert.equal(pair.merkezStore.read().installs.length, 0);
  assert.equal((await pair.admin('/codes', { requestId: rid(), tenantId: business.tenantId })).data.code, 'CONFLICT', 'an application is not activated with a code');
  // "Bilgileri düzelt": the same application changes; no second record.
  assert.equal((await kafe('/activation/application', form('Köşe Kahve', {}, { sector: 'restaurant' }))).status, 200);
  assert.equal((await businesses(pair)).length, 1); assert.equal((await businesses(pair))[0].name, 'Köşe Kahve');
  // Approval: the café's next look picks the licence up and moves on to the owner account.
  time += 3600_000;
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId: business.tenantId })).status, 200);
  status = (await kafe('/activation')).data;
  assert.equal(status.state, 'owner'); assert.deepEqual(status.pending, { name: 'Köşe Kahve', sector: 'restaurant' }); assert.equal(status.application, undefined);
  assert.equal(ticketCount(pair.store), 0, 'the activation ids and the application leave the café once the licence is kept');
  [business] = await businesses(pair);
  assert.equal(business.application.status, 'approved'); assert.equal(business.activation, 'active'); assert.equal(business.kind, 'trial');
  assert.equal(Date.parse(business.endsAt) - time, 30 * DAY, 'the trial starts at approval'); assert.equal(business.daysRemaining, 30);
  // Owner account: only here.
  assert.equal((await kafe('/activation/owner', { username: 'ayse', password: 'kisa' })).status, 400);
  const owner = await kafe('/activation/owner', { username: 'Ayse', password: 'AyseKafe!2026', name: 'Ayşe' });
  assert.equal(owner.status, 200); assert.equal(owner.data.state, 'ready');
  assert.equal((await kafe('/login', { username: 'ayse', password: 'AyseKafe!2026' })).status, 200);
  const s = (await kafe('/staff/state')).data;
  assert.equal(s.name, 'Köşe Kahve'); assert.equal(s.sector, 'restaurant'); assert.equal(s.licenseNotice, undefined);
  assert.equal((await pair.kafe()('/guest/session', { token: s.tables[0].token })).status, 200, 'the trial runs: menu and orders open');
  // The heartbeat never carries invoice data (it travels only with the application).
  const payload = JSON.stringify(pair.link.payload(pair.link.read()!));
  for (const secret of ['1234567890', 'ayse@example.com', '+905321234567', 'Kadıköy', 'Moda']) assert.equal(payload.includes(secret), false, secret);
  await pair.link.sync();
  [business] = await businesses(pair);
  assert.equal(business.lastSeenAt, new Date(time).toISOString()); assert.equal(business.neverConnected, false);
  assert.equal(JSON.stringify(await businesses(pair)).includes('ayse"'), false, 'the owner account never reaches Merkez');
  // The trial ends on its own: menu closed, no automatic paid subscription.
  time += 30 * DAY;
  assert.equal((await pair.kafe()('/guest/session', { token: s.tables[0].token })).data.code, 'MENU_UNAVAILABLE');
});

test('rejection: the café shows the reason; corrected and resubmitted, the same application waits again', async t => {
  const pair = await merkezPair('application-reject'); t.after(() => pair.close());
  const kafe = pair.kafe(); await pair.adminLogin();
  await kafe('/activation/application', form('Yanlış Kafe', { taxOffice: 'Yok' }));
  const [business] = await businesses(pair);
  assert.equal((await pair.admin('/applications/reject', { requestId: rid(), tenantId: business.tenantId, reason: 'x' })).status, 400, 'a reason is required');
  assert.equal((await pair.admin('/applications/reject', { requestId: rid(), tenantId: business.tenantId, reason: 'Vergi dairesi eksik.' })).status, 200);
  let status = (await kafe('/activation')).data;
  assert.equal(status.state, 'applied'); assert.equal(status.application.status, 'rejected'); assert.equal(status.application.reason, 'Vergi dairesi eksik.');
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId: business.tenantId })).data.code, 'CONFLICT', 'waits for the correction');
  assert.equal((await kafe('/activation/application', form('Doğru Kafe', { taxOffice: 'Kadıköy' }))).status, 200);
  status = (await kafe('/activation')).data;
  assert.equal(status.application.status, 'pending'); assert.equal(status.application.reason, null);
  const list = await businesses(pair);
  assert.equal(list.length, 1); assert.equal(list[0].tenantId, business.tenantId); assert.equal(list[0].application.status, 'pending'); assert.equal(list[0].name, 'Doğru Kafe');
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId: business.tenantId })).status, 200);
  assert.equal((await kafe('/activation')).data.state, 'owner');
});

test('retries are one application: changed fields, a restart, an answer lost after Merkez kept it, a café with another Merkez key', async t => {
  let lose = false;
  // The answer is lost on the way back: Merkez has already written the application.
  const lossy: typeof fetch = async (input, init) => { const r = await fetch(input, init); if (lose) { lose = false; throw new Error('bağlantı koptu'); } return r; };
  const pair = await merkezPair('application-retry', { fetch: lossy }); t.after(() => pair.close());
  await pair.adminLogin();
  lose = true;
  await assert.rejects(pair.link.apply(form('Kayıp Yanıt')), isCode('MERKEZ_UNREACHABLE'));
  assert.equal(pair.link.state(), 'activate', 'the café never heard back');
  assert.equal((await businesses(pair)).length, 1, 'Merkez kept it');
  const ids = pair.link.ticket()!;
  // "Yeniden dene" with different values, then a restart (a new link over the same data folder), then again.
  assert.equal(await pair.link.apply(form('Kayıp Yanıt Kafe', { email: 'yeni@example.com' })), 'applied');
  const restarted = new MerkezLink(pair.store, { url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), machineId: 'a'.repeat(64), fetch: lossy });
  assert.deepEqual(restarted.ticket(), { ...ids, application: restarted.ticket()!.application }, 'the same ids after a restart');
  assert.equal(await restarted.apply(form('Kayıp Yanıt Kafe', { email: 'yeni@example.com' }, { sector: 'dessert' })), 'applied');
  let list = await businesses(pair);
  assert.equal(list.length, 1); assert.equal(list[0].name, 'Kayıp Yanıt Kafe'); assert.equal(list[0].sector, 'dessert'); assert.equal(list[0].invoice.email, 'yeni@example.com');
  // The approval answer itself is lost once: the next poll still gets the same business, nothing new is made.
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId: list[0].tenantId })).status, 200);
  lose = true; await restarted.checkApplication();
  assert.equal(restarted.state(), 'applied');
  assert.match(restarted.application()!.error!, /ulaşılamadı/);
  await restarted.checkApplication();
  assert.equal(restarted.state(), 'owner'); assert.equal(restarted.read()!.installId, ids.installId, 'the install id the café chose');
  list = await businesses(pair);
  assert.equal(list.length, 1); assert.equal(pair.merkezStore.read().installs.length, 1);
  // The same ids cannot start another application once activated.
  assert.equal(await restarted.apply(form('Bir Daha')).catch((e: Error & { code?: string }) => e.code), 'ALREADY_ACTIVE');

  // A café package built for another Mola Yönetim: refused before anything is made at Merkez, again and again.
  const foreign = otherCafe(pair, 'foreign-key', { publicKey: newSigningPair().publicKey });
  for (let i = 0; i < 3; i++) await assert.rejects(foreign.link.apply(form('Yabancı Kafe', { taxNumber: '2222222224' })), (e: Error & { code?: string }) => e.code === 'MERKEZ_KEY_MISMATCH' && /kurulum paketi bu Mola Yönetim için üretilmeli/.test(e.message));
  assert.equal((await businesses(pair)).length, 1); assert.equal(foreign.link.state(), 'activate');
  // An older Merkez would not check the key: the café still refuses the licence it cannot verify, and a retry makes nothing new.
  const stripKey: typeof fetch = async (input, init) => fetch(input, { ...init, body: typeof init?.body === 'string' ? JSON.stringify({ ...JSON.parse(init.body), keyId: undefined }) : init?.body });
  const old = otherCafe(pair, 'foreign-old', { publicKey: newSigningPair().publicKey, fetch: stripKey, machine: 'c'.repeat(64) });
  assert.equal(await old.link.apply(form('Eski Merkez Kafe', { taxNumber: '3333333339' })), 'applied');
  const added = (await businesses(pair)).find(b => b.name === 'Eski Merkez Kafe');
  await pair.admin('/applications/approve', { requestId: rid(), tenantId: added.tenantId });
  for (let i = 0; i < 2; i++) { await old.link.checkApplication(); assert.equal(old.link.state(), 'applied'); assert.match(old.link.application()!.error!, /Merkez anahtarı farklı/); }
  assert.equal((await businesses(pair)).length, 2, 'no new record per retry');
  old.store.close(); foreign.store.close();
});

test('one tax number: a repeat never tells the applicant, waits flagged for the vendor in first-submission order; an earlier applicant keeps its place; number changes limited; only HMACs stored', async t => {
  const pair = await merkezPair('application-tax'); t.after(() => pair.close());
  await pair.adminLogin();
  const a = pair.link, b = otherCafe(pair, 'tax-b'), c = otherCafe(pair, 'tax-c'), d = otherCafe(pair, 'tax-d'), e = otherCafe(pair, 'tax-e'), f = otherCafe(pair, 'tax-f');
  t.after(() => { for (const x of [b, c, d, e, f]) x.store.close(); });
  assert.equal(await a.apply(form('Merkez Şube', { taxNumber: '4444444444' })), 'applied');
  // Same VKN from another computer while the first is pending: the applicant sees the usual "Onay bekleniyor" (no probing).
  assert.equal(await b.link.apply(form('İkinci Şube', { taxNumber: '4444444444', phone: '+905551112233', email: 'b@example.com' })), 'applied');
  assert.equal(b.link.application()!.status, 'pending'); assert.equal(b.link.application()!.reason, undefined);
  // The earlier applicant corrects its application after the later one arrived: still first, never flagged or refused.
  assert.equal(await a.apply(form('Merkez Şube Kafe', { taxNumber: '4444444444' })), 'applied');
  assert.equal(a.application()!.status, 'pending');
  let list = await businesses(pair), first = list.find(x => x.name === 'Merkez Şube Kafe'), second = list.find(x => x.name === 'İkinci Şube');
  assert.equal(first.application.duplicateTax, false); assert.equal(first.application.submissions, 2);
  assert.ok(Date.parse(first.application.firstSubmittedAt) <= Date.parse(first.application.submittedAt), 'the first submission time is kept');
  assert.equal(second.application.duplicateTax, true); assert.deepEqual(second.sameTax, [{ tenantId: first.tenantId, name: 'Merkez Şube Kafe' }], 'listed only to the vendor');
  // A plain approve of the flagged one is refused with the reason; the first one is approved.
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId: second.tenantId })).data.code, 'DUPLICATE_TAX');
  await pair.admin('/applications/approve', { requestId: rid(), tenantId: first.tenantId }); await a.checkApplication(); assert.equal(a.state(), 'owner');
  // After a licence the number stays flagged for every later application; still nothing is said to the café.
  await c.link.apply(form('Üçüncü', { taxNumber: '4444444444', phone: '+905551112244', email: 'c@example.com' }));
  assert.equal(c.link.application()!.status, 'pending');
  assert.equal((await businesses(pair)).find(x => x.name === 'Üçüncü').application.duplicateTax, true);
  // "Ek şube olarak kabul et" starts it anyway.
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId: second.tenantId, branch: true })).status, 200);
  await b.link.checkApplication(); assert.equal(b.link.state(), 'owner', 'the branch café moves on');
  assert.equal((await businesses(pair)).find(x => x.tenantId === second.tenantId).application.branch, true);
  // Someone applied first with a stranger's TCKN; the real owner applies later. Rejecting the first lets the second through.
  assert.equal(await e.link.apply(form('Sahte Başvuru', { taxType: 'person', taxNumber: '12345678950', phone: '+905551112255', email: 'e@example.com' })), 'applied');
  await f.link.apply(form('Gerçek Sahip', { taxType: 'person', taxNumber: '12345678950', phone: '+905551112266', email: 'f@example.com' }));
  assert.equal(f.link.application()!.status, 'pending');
  list = await businesses(pair);
  const fake = list.find(x => x.name === 'Sahte Başvuru'), real = list.find(x => x.name === 'Gerçek Sahip');
  assert.equal(real.application.duplicateTax, true);
  assert.equal((await pair.admin('/applications/reject', { requestId: rid(), tenantId: fake.tenantId, reason: 'Kimlik doğrulanamadı.' })).status, 200);
  assert.equal((await businesses(pair)).find(x => x.tenantId === real.tenantId).application.duplicateTax, false);
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId: real.tenantId })).status, 200);
  // Same phone and e-mail as another business, different number: flagged for the vendor, not blocked.
  await d.link.apply(form('Telefon Tekrar', { taxNumber: '5555555553', phone: '+905321234567', email: 'ayse@example.com' }));
  assert.equal(d.link.application()!.status, 'pending');
  list = await businesses(pair);
  assert.deepEqual(list.find(x => x.name === 'Telefon Tekrar').sameContact, { phone: true, email: true });
  assert.deepEqual(list.find(x => x.name === 'Gerçek Sahip').sameContact, { phone: false, email: false });
  // Trying numbers through one application: three different numbers at most.
  assert.equal(await d.link.apply(form('Telefon Tekrar', { taxNumber: '6120069780', phone: '+905321234567', email: 'ayse@example.com' })), 'applied');
  assert.equal(await d.link.apply(form('Telefon Tekrar', { taxNumber: '9000068418', phone: '+905321234567', email: 'ayse@example.com' })), 'applied');
  await assert.rejects(d.link.apply(form('Telefon Tekrar', { taxNumber: '1111111114', phone: '+905321234567', email: 'ayse@example.com' })), isCode('TAX_CHANGES'));
  assert.equal(await d.link.apply(form('Telefon Tekrar Kafe', { taxNumber: '5555555553', phone: '+905321234567', email: 'ayse@example.com' })), 'applied', 'going back to a number it used is fine');
  // A trial ever granted keeps the number flagged even when its (never connected) record is deleted.
  assert.equal((await pair.admin('/businesses/delete', { requestId: rid(), tenantId: first.tenantId })).status, 200);
  const g = otherCafe(pair, 'tax-g'); t.after(() => g.store.close());
  await g.link.apply(form('Silinen Sonrası', { taxNumber: '4444444444', phone: '+905551112277', email: 'g@example.com' }));
  assert.equal(g.link.application()!.status, 'pending');
  assert.equal((await businesses(pair)).find(x => x.name === 'Silinen Sonrası').application.duplicateTax, true);
  // The index holds keyed hashes only: never a number, never a plain SHA-256 of it; the registry itself is sealed.
  const rows = pair.merkezStore.db.prepare('SELECT hash, state FROM tax_index').all() as { hash: string; state: string }[];
  assert.ok(rows.length >= 4);
  for (const n of ['4444444444', '12345678950', '5555555553']) {
    assert.equal(rows.some(r => r.hash.includes(n) || r.hash === createHash('sha256').update(n).digest('hex')), false, n);
    for (const file of ['merkez.sqlite', 'merkez.sqlite-wal']) { let bytes = ''; try { bytes = readFileSync(join(pair.merkezStore.directory, file)).toString('latin1'); } catch { /* no WAL */ } assert.equal(bytes.includes(n), false, `${file}: ${n}`); }
  }
});

test('one tax number, the later one accepted first as "Ek şube": the earlier applicant is still approved as the main business (QA: önce başvuran sonradan gelen yüzünden işaretlenmez)', async t => {
  let time = Date.parse('2026-10-05T09:00:00Z');
  const pair = await merkezPair('application-tax-order', { now: () => new Date(time) }); t.after(() => pair.close());
  await pair.adminLogin();
  const k2 = otherCafe(pair, 'tax-order-k2'); t.after(() => k2.store.close());
  assert.equal(await pair.link.apply(form('K1 Ana Kafe', { taxNumber: '4444444444' })), 'applied');
  time += 60_000;
  assert.equal(await k2.link.apply(form('K2 Şube', { taxNumber: '4444444444', phone: '+905551119900', email: 'k2@example.com' })), 'applied');
  let list = await businesses(pair);
  const k1 = list.find(x => x.name === 'K1 Ana Kafe'), later = list.find(x => x.name === 'K2 Şube');
  assert.equal(k1.application.duplicateTax, false); assert.equal(later.application.duplicateTax, true);
  // The vendor accepts the later one as a branch first…
  time += 60_000;
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId: later.tenantId, branch: true })).status, 200);
  // …the earlier applicant is still not flagged and starts its trial as the main business, with a plain approval.
  list = await businesses(pair);
  assert.equal(list.find(x => x.tenantId === k1.tenantId).application.duplicateTax, false);
  assert.deepEqual(list.find(x => x.tenantId === k1.tenantId).sameTax, [{ tenantId: later.tenantId, name: 'K2 Şube' }], 'the vendor still sees the branch');
  const approved = await pair.admin('/applications/approve', { requestId: rid(), tenantId: k1.tenantId });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  await pair.link.checkApplication(); assert.equal(pair.link.state(), 'owner');
  const audit = pair.merkezStore.read().audit;
  assert.deepEqual(audit.filter(a => a.action.startsWith('application.') && a.action.endsWith('approved')).map(a => [a.target, a.action]), [[later.tenantId, 'application.branch_approved'], [k1.tenantId, 'application.approved']]);
  list = await businesses(pair);
  assert.equal(list.find(x => x.tenantId === k1.tenantId).application.branch, undefined);
  // A third applicant after both is flagged as before.
  const k3 = otherCafe(pair, 'tax-order-k3'); t.after(() => k3.store.close());
  time += 60_000;
  await k3.link.apply(form('K3', { taxNumber: '4444444444', phone: '+905551119911', email: 'k3@example.com' }));
  assert.equal((await businesses(pair)).find(x => x.name === 'K3').application.duplicateTax, true);
});

test('Kaydı sil: only a record that never connected; refused for a connected one; audited with its name', async t => {
  const pair = await merkezPair('delete-record'); t.after(() => pair.close());
  await pair.adminLogin();
  // Two half-made records from the same computer and name (the owner's "mcafe" twice) list each other.
  const one = otherCafe(pair, 'delete-one', { machine: 'd'.repeat(64) }), two = otherCafe(pair, 'delete-two', { machine: 'd'.repeat(64) });
  t.after(() => { one.store.close(); two.store.close(); });
  await one.link.apply(form('mcafe', { taxNumber: '6120069780' })); await two.link.apply(form('MCafe', { taxNumber: '9000068418' }));
  let list = await businesses(pair);
  const [x, y] = [list.find(b => b.name === 'mcafe'), list.find(b => b.name === 'MCafe')];
  assert.deepEqual(x.duplicates.map((o: any) => [o.tenantId, o.sameComputer, o.neverConnected]), [[y.tenantId, true, true]]);
  assert.equal(x.neverConnected, true);
  // A connected business cannot be deleted (suspend instead).
  // Its own phone and e-mail: the same ones would (rightly) list it as a possible repeat of mcafe.
  await pair.link.apply(form('Bağlı Kafe', { taxNumber: '1111111114', phone: '+905559998877', email: 'bagli@example.com' }));
  const connected = (await businesses(pair)).find(b => b.name === 'Bağlı Kafe');
  await pair.admin('/applications/approve', { requestId: rid(), tenantId: connected.tenantId });
  await pair.link.checkApplication(); await pair.link.sync();
  assert.equal((await businesses(pair)).find(b => b.name === 'Bağlı Kafe').neverConnected, false);
  const refused = await pair.admin('/businesses/delete', { requestId: rid(), tenantId: connected.tenantId });
  assert.equal(refused.status, 409); assert.equal(refused.data.code, 'CONNECTED'); assert.match(refused.data.message, /Önce askıya alın/);
  // An unused activation code record can go too.
  const added = await pair.admin('/businesses', { requestId: rid(), name: 'Yanlış Eklenen', kind: 'trial' });
  for (const tenantId of [y.tenantId, added.data.tenantId]) {
    const r = await pair.admin('/businesses/delete', { requestId: rid(), tenantId }); assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  assert.equal(pair.merkezStore.read().codes.length, 0, 'its code went with it');
  list = await businesses(pair);
  assert.deepEqual(list.map(b => b.name).sort(), ['Bağlı Kafe', 'mcafe']); assert.deepEqual(list.find(b => b.name === 'mcafe').duplicates, []);
  const audit = (await pair.admin('/state')).data.audit.filter((a: any) => a.action === 'business.deleted');
  assert.deepEqual(audit.map((a: any) => a.name), ['MCafe', 'Yanlış Eklenen']);
  // The deleted café's poll learns it is gone and lets the owner send it again (a new record, same ids).
  await two.link.checkApplication();
  assert.equal(two.link.application()!.status, 'rejected'); assert.match(two.link.application()!.reason!, /bulunamadı/);
  assert.equal((await pair.admin('/businesses/delete', { requestId: rid(), tenantId: 'yok' })).status, 404);
});

test('activation code: one-time, expires, limited guesses; a retry after a lost answer is the same business; a waiting application gives way', async t => {
  let time = Date.parse('2026-10-03T09:00:00Z'), lose = false;
  const lossy: typeof fetch = async (input, init) => { const r = await fetch(input, init); if (lose) { lose = false; throw new Error('bağlantı koptu'); } return r; };
  const pair = await merkezPair('code', { now: () => new Date(time), fetch: lossy }); t.after(() => pair.close());
  await pair.adminLogin();
  const created = await pair.admin('/businesses', { requestId: rid(), name: 'Harput Kahve', contactName: 'Mehmet', sector: 'cafe', kind: 'subscription', months: 6, service: 'menu' });
  assert.equal(created.status, 200); assert.match(created.data.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  let [business] = await businesses(pair);
  assert.equal(business.activation, 'pending'); assert.equal(business.endsAt, null);
  assert.equal(JSON.stringify(pair.merkezStore.read().codes).includes(created.data.code), false, 'Merkez keeps only a hash of the code');
  assert.equal((await pair.admin('/licenses', { requestId: rid(), tenantId: created.data.tenantId, expectedEnd: null, expectedSuspended: false, months: 12, suspended: false })).data.code, 'NOT_ACTIVATED');
  time += 3 * DAY; await pair.adminLogin();
  // This café first sent an application, then got a code from the vendor: the application gives way to the code.
  await pair.link.apply(form('Harput Başvuru', { taxNumber: '1111111114' }));
  assert.equal((await businesses(pair)).length, 2);
  const kafe = pair.kafe();
  assert.equal((await kafe('/activation/code', { requestId: rid(), code: 'ABCD-EFGH-JKLM' })).data.code, 'INVALID_CODE');
  lose = true;
  assert.equal((await kafe('/activation/code', { code: created.data.code })).data.code, 'MERKEZ_UNREACHABLE');
  const used = await kafe('/activation/code', { code: created.data.code.toLowerCase().replace(/-/g, ' ') });
  assert.equal(used.status, 200, JSON.stringify(used.data)); assert.equal(used.data.state, 'owner');
  const list = await businesses(pair);
  assert.equal(list.length, 1, 'the waiting application was removed'); business = list[0];
  assert.equal(business.activation, 'active'); assert.equal(business.source, 'code'); assert.equal(business.service, 'menu'); assert.equal(business.serial, 2, 'signed again for the retry');
  assert.equal(business.endsAt, new Date(Date.UTC(2027, 3, 6, 9)).toISOString(), 'six months from the activation day, not from creation');
  assert.equal(pair.merkezStore.read().installs.length, 1);
  // The same code on another computer: refused.
  const other = otherCafe(pair, 'code-again'); t.after(() => other.store.close());
  await assert.rejects(other.link.activate('code', { code: created.data.code }), isCode('INVALID_CODE'));
  // A code expires after 14 days; a fresh one replaces the old.
  const late = await pair.admin('/businesses', { requestId: rid(), name: 'Geç Kafe', kind: 'trial' });
  const fresh = await pair.admin('/codes', { requestId: rid(), tenantId: late.data.tenantId });
  assert.notEqual(fresh.data.code, late.data.code);
  await assert.rejects(other.link.activate('code', { code: late.data.code }), isCode('INVALID_CODE'), 'the replaced code');
  time += 15 * DAY;
  await assert.rejects(other.link.activate('code', { code: fresh.data.code }), isCode('INVALID_CODE'), 'expired');
  for (let i = 0; i < 10; i++) await assert.rejects(other.link.activate('code', { code: `WRNG-${i}AAA-BBBB` }));
  await assert.rejects(other.link.activate('code', { code: 'WRNG-ZZZZ-BBBB' }), isCode('RATE_LIMIT'));
});

test('Merkez unreachable during onboarding: a clear Turkish message, nothing kept but the ids, and the same application can be retried', async t => {
  const pair = await merkezPair('unreachable'); t.after(() => pair.close());
  const probe = createServer(); await new Promise<void>(r => probe.listen(0, '127.0.0.1', r)); const port = (probe.address() as AddressInfo).port; await new Promise<void>(r => probe.close(() => r()));
  const store = new Store(temp('offline-onboarding'), []);
  const link = new MerkezLink(store, { url: `http://127.0.0.1:${port}`, publicKey: publicKeyFrom(pair.merkezStore.publicKey) });
  const server = createServer(createApp(store, undefined, undefined, undefined, undefined, () => {}, undefined, undefined, undefined, undefined, link));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const kafe = client(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`);
  const failed = await kafe('/activation/application', form('Bağlantısız Kafe'));
  assert.equal(failed.status, 503); assert.equal(failed.data.code, 'MERKEZ_UNREACHABLE'); assert.match(failed.data.message, /Mola Merkez’e ulaşılamadı/);
  assert.equal(link.state(), 'activate');
  assert.equal((store.db.prepare('SELECT count(*) AS n FROM merkez_link').get() as { n: number }).n, 0);
  const ids = link.ticket()!; assert.equal(ids.application, undefined);
  assert.equal((await kafe('/activation/application', form('Bağlantısız Kafe'))).status, 503);
  assert.deepEqual(link.ticket(), ids, 'the same ids for the next try');
});
