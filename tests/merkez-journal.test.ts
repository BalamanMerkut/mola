import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createMerkezApp } from '../server/merkez/app.js';
import { MerkezStore } from '../server/merkez/store.js';
import { journalRows, verifySeal, hashEntry, type JournalEntry } from '../server/merkez/journal.js';
import { canonicalJson } from '../server/merkez/journal-text.js';
import { publicKeyFrom } from '../server/license.js';
import { MerkezLink } from '../server/kafe-link.js';
import { Store } from '../server/store.js';
import { open, seal } from '../server/sealing.js';
import { findPrintBrowser } from '../server/pdf-print.js';
import { client, MERKEZ_PASSWORD, merkezPair, temp } from './merkez-fixture.js';
import { freshCode, stepUp, testBundle } from './update-fixture.js';
// @ts-expect-error plain .mjs without types: the independent verifier (no Mola code inside)
import { check as independentCheck, load as independentLoad } from '../scripts/islem-dogrula.mjs';

/*
 * İşlem kayıtları (server/merkez/journal.ts): append-only, hash-chained, sealed; the independent verifier; every vendor action
 * and security event with who/what/where/result; no secrets; the old list carried over once; Rapor al (PDF, Excel, JSONL).
 */
async function standalone(name: string) {
  const dir = temp(name), key = randomBytes(32);
  const store = new MerkezStore(join(dir, 'merkez'), key, { initialPassword: MERKEZ_PASSWORD });
  const app = createMerkezApp(store), server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const admin = client(`${base}/api/merkez/admin`);
  return { dir, key, store, base, admin, close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); (app.locals.relayHub as { close(): void }).close(); store.close(); } };
}
const rowKey = (key: Buffer) => createHash('sha256').update(key).update('mola-islem-kayitlari:v1').digest();
const lines = (store: MerkezStore) => store.journal.entries().map(s => s.entry);
const find = (store: MerkezStore, action: string) => lines(store).filter(e => e.action === action);
/** A tiny zip reader: entries by name. */
function unzip(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), files = new Map<string, string>();
  let at = buf.readUInt32LE(end + 16);
  for (let i = 0; i < buf.readUInt16LE(end + 10); i++) {
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), n = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32), offset = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + n).toString('utf8'), start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    files.set(name, (method === 8 ? inflateRawSync(buf.subarray(start, start + size)) : buf.subarray(start, start + size)).toString('utf8'));
    at += 46 + n + extra + comment;
  }
  return files;
}

test('chain and seals: every line links to the one before, seals sign the head, the check says "Kayıtlar bütün"', async t => {
  const m = await standalone('islem-zincir'); t.after(m.close);
  assert.equal((await m.admin('/login', { username: 'admin', password: MERKEZ_PASSWORD })).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await m.admin('/businesses', { requestId: randomUUID().replace(/-/g, ''), name: `Zincir Kafe ${i}`, kind: 'trial' })).status, 200);
  const all = lines(m.store);
  assert.equal(all[0].action, 'journal.started', 'a fresh Merkez starts its chain');
  assert.equal(all[0].prev, '0'.repeat(64));
  for (let i = 1; i < all.length; i++) { assert.equal(all[i].seq, all[i - 1].seq + 1); assert.equal(all[i].prev, hashEntry(all[i - 1])); }
  const s = m.store.journal.sealNow()!;
  assert.equal(s.seq, all.at(-1)!.seq); assert.equal(s.head, hashEntry(all.at(-1)!));
  assert.ok(verifySeal(s, publicKeyFrom(m.store.publicKey)));
  assert.equal(verifySeal({ ...s, head: 'f'.repeat(64) }, publicKeyFrom(m.store.publicKey)), false, 'a seal covers exactly its head');
  const v = m.store.journal.verify();
  assert.equal(v.ok, true); assert.equal(v.text, 'Kayıtlar bütün'); assert.equal(v.count, all.length); assert.equal(v.unsealed, 0);
  // Over the API too.
  const r = await m.admin('/journal/verify'); assert.equal(r.data.verify.ok, true);
});

test('tamper evidence: an edited, deleted, reordered or cut line is found exactly; SQLite refuses UPDATE and DELETE', async t => {
  const m = await standalone('islem-bozma'); t.after(m.close);
  await m.admin('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  for (let i = 0; i < 6; i++) await m.admin('/businesses', { requestId: randomUUID().replace(/-/g, ''), name: `Bozma Kafe ${i}`, kind: 'trial' });
  m.store.journal.sealNow();
  const db = m.store.db, k = rowKey(m.key);
  assert.throws(() => db.prepare('UPDATE islem_kayitlari SET at=? WHERE seq=3').run('2020-01-01T00:00:00.000Z'), /degistirilemez/);
  assert.throws(() => db.prepare('DELETE FROM islem_kayitlari WHERE seq=3').run(), /silinemez/);
  assert.throws(() => db.prepare('DELETE FROM islem_muhurleri').run(), /silinemez/);
  const backup = db.prepare('SELECT * FROM islem_kayitlari ORDER BY seq').all() as { seq: number; at: string; hash: string; prev: string; payload: Uint8Array }[];
  const restore = () => { db.exec('DELETE FROM islem_kayitlari'); for (const r of backup) db.prepare('INSERT INTO islem_kayitlari VALUES (?,?,?,?,?)').run(r.seq, r.at, r.hash, r.prev, r.payload); };
  // Someone with the database file and the key, without the triggers.
  db.exec('DROP TRIGGER islem_degismez; DROP TRIGGER islem_silinmez; DROP TRIGGER islem_ozet_degismez;');
  const edit = (seq: number, change: (e: JournalEntry) => void, rehash = false) => {
    const row = backup.find(r => r.seq === seq)!, e = open<JournalEntry>(Buffer.from(row.payload), k, `merkez-islem:${seq}`); change(e);
    db.prepare('UPDATE islem_kayitlari SET payload=?, hash=? WHERE seq=?').run(seal(e, k, `merkez-islem:${seq}`), rehash ? hashEntry(e) : row.hash, seq);
  };
  edit(4, e => { e.detail = 'değiştirildi'; });
  let v = m.store.journal.verify(); assert.equal(v.ok, false); assert.equal(v.problem!.seq, 4); assert.equal(v.problem!.kind, 'degistirilmis'); assert.match(v.text, /Zincir 4\. kayıtta bozuk/);
  restore(); edit(4, e => { e.detail = 'değiştirildi'; }, true);
  v = m.store.journal.verify(); assert.equal(v.problem!.seq, 5, 'a re-hashed line breaks the next link'); assert.equal(v.problem!.kind, 'zincir');
  restore(); db.prepare('DELETE FROM islem_kayitlari WHERE seq=3').run();
  v = m.store.journal.verify(); assert.equal(v.problem!.seq, 3); assert.equal(v.problem!.kind, 'eksik');
  restore();
  const [a, b] = [backup[2], backup[3]];
  db.prepare('UPDATE islem_kayitlari SET payload=?, hash=?, prev=? WHERE seq=?').run(b.payload, b.hash, b.prev, a.seq);
  db.prepare('UPDATE islem_kayitlari SET payload=?, hash=?, prev=? WHERE seq=?').run(a.payload, a.hash, a.prev, b.seq);
  v = m.store.journal.verify(); assert.equal(v.ok, false, 'reordered lines'); assert.equal(v.problem!.seq, a.seq);
  // The newest lines cut off (the chain itself is fine up to there): the seal says so.
  restore(); db.prepare('DELETE FROM islem_kayitlari WHERE seq >= ?').run(backup.at(-1)!.seq - 1);
  v = m.store.journal.verify(); assert.equal(v.problem!.kind, 'muhur'); assert.match(v.text, /son kayıtlar silinmiş/);
  restore(); assert.equal(m.store.journal.verify().ok, true, 'restored exactly: whole again');
  // The screen and a Bildirim merkezi alert say it (once).
  db.prepare('DELETE FROM islem_kayitlari WHERE seq=2').run();
  const r = await m.admin('/journal/verify'); assert.equal(r.data.verify.ok, false);
  assert.ok((m.store.read().alerts ?? []).some(x => x.kind === 'journal.broken'));
});

test('every vendor action and security event is a line: who, what, business, old → new, source, result; never a secret', async t => {
  const pair = await merkezPair('islem-her-sey', { demo: true }); t.after(() => pair.close());
  const wrong = client(`${pair.merkezBase}/api/merkez/admin`);
  assert.equal((await wrong('/login', { username: 'admin', password: 'YanlisSifre!2026' })).status, 401);
  await pair.adminLogin();
  await pair.importDemo();
  const created = await pair.admin('/businesses', { requestId: randomUUID().replace(/-/g, ''), name: 'Kod Kafe', kind: 'subscription', months: 12 });
  const code2 = await pair.admin('/codes', { requestId: randomUUID().replace(/-/g, ''), tenantId: created.data.tenantId });
  // Applications from two other café computers: one approved, one refused.
  const form = (name: string, taxNumber: string) => ({ businessName: name, sector: 'cafe' as const, contactName: 'Ayşe Yılmaz', consent: true as const, invoice: { legalName: `${name} Ltd.`, taxOffice: 'Kadıköy', taxType: 'company' as const, taxNumber, city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 1', phone: '+905321234567', email: 'ayse@example.com' } });
  const apply = async (dir: string, name: string, tax: string) => { const s = new Store(join(pair.dir, dir), []); const l = new MerkezLink(s, { url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), machineId: 'b'.repeat(64) }); t.after(() => { l.stop(); s.close(); }); assert.equal(await l.apply(form(name, tax)), 'applied'); };
  await apply('kafe-b', 'Başvuru Kafe', '1234567890'); await apply('kafe-c', 'Ret Kafe', '2222222224');
  const ids = () => pair.merkezStore.read().businesses;
  assert.equal((await pair.admin('/applications/approve', { requestId: randomUUID().replace(/-/g, ''), tenantId: ids().find(b => b.name === 'Başvuru Kafe')!.tenantId })).status, 200);
  assert.equal((await pair.admin('/applications/reject', { requestId: randomUUID().replace(/-/g, ''), tenantId: ids().find(b => b.name === 'Ret Kafe')!.tenantId, reason: 'Vergi levhası okunmuyor' })).status, 200);
  // Licence: extend, plan, suspend, resume, service package.
  const demo = ids().find(b => b.source === 'import')!, lic = (b = ids().find(x => x.tenantId === demo.tenantId)!) => ({ requestId: randomUUID().replace(/-/g, ''), tenantId: b.tenantId, expectedEnd: b.endsAt, expectedSuspended: b.suspended });
  assert.equal((await pair.admin('/licenses', { ...lic(), months: 6, suspended: false })).status, 200);
  assert.equal((await pair.admin('/licenses', { ...lic(), months: 0, suspended: false, plan: 6 })).status, 200);
  assert.equal((await pair.admin('/licenses', { ...lic(), months: 0, suspended: true, reason: 'Ödeme gecikti' })).status, 200);
  assert.equal((await pair.admin('/licenses', { ...lic(), months: 0, suspended: false })).status, 200);
  assert.equal((await pair.admin('/service-plan', { requestId: randomUUID().replace(/-/g, ''), tenantId: demo.tenantId, service: 'menu' })).status, 200);
  const reset = await pair.admin('/owner-reset-codes', { requestId: randomUUID().replace(/-/g, ''), tenantId: demo.tenantId });
  assert.equal(reset.status, 200);
  // Settings: contact, e-mail (an app password that must never show up), retention, Çalışma klasörü.
  assert.equal((await pair.admin('/contact', { phone: '+905551112233', whatsapp: '', email: 'destek@mola.example', hours: 'Hafta içi 09–18', web: '' })).status, 200);
  assert.equal((await pair.admin('/contact', { phone: '+905551112244', whatsapp: '', email: 'destek@mola.example', hours: 'Hafta içi 09–18', web: '' })).status, 200);
  const SMTP_SECRET = 'SmtpUygulamaSifresi-9911';
  assert.equal((await pair.admin('/email', { enabled: false, host: 'smtp.example.com', port: 465, security: 'tls', user: 'bildirim@example.com', password: SMTP_SECRET, to: 'ben@example.com' })).status, 200);
  assert.equal((await pair.admin('/journal/settings', { retentionYears: 12 })).status, 200);
  const folder = mkdtempSync(join(tmpdir(), 'mola-calisma-test-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  assert.equal((await pair.admin('/workfolder', { path: folder })).status, 200);
  // Geliştirici erişimi: made with the password, used for a release, revoked, refused afterwards.
  assert.equal((await pair.admin('/access-tokens', { name: 'Yanlış', scope: 'releases', password: 'yanlis' })).status, 403);
  const made = await pair.admin('/access-tokens', { name: 'Yayın komutu', scope: 'releases', password: MERKEZ_PASSWORD });
  assert.equal(made.status, 200); const TOKEN = made.data.token as string;
  const bearer = (path: string, init: RequestInit = {}) => fetch(`${pair.merkezBase}/api/merkez/admin${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers as Record<string, string> ?? {}) } });
  const bundle = await testBundle(join(pair.dir, 'paket'), '0.9.1');
  // Güncelleme yetkisi: the key and the session each open it with a fresh Authenticator code.
  await stepUp(pair.merkezBase, pair.merkezStore, { Authorization: `Bearer ${TOKEN}` });
  assert.equal((await pair.admin('/releases/yetki', { code: await freshCode(pair.merkezStore) })).status, 200);
  const up = await bearer('/releases/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: (await import('node:fs')).readFileSync(bundle.file) });
  assert.equal(up.status, 200); const release = (await up.json() as { release: { id: string } }).release;
  assert.equal((await bearer('/releases/rollout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: release.id, mode: 'pilot', pilot: [demo.tenantId] }) })).status, 200);
  assert.equal((await pair.admin('/releases/rollout', { id: release.id, mode: 'off' })).status, 200);
  assert.equal((await bearer('/state')).status, 401, 'a releases key never opens the rest of the panel');
  assert.equal((await pair.admin('/access-tokens/revoke', { id: made.data.view.id })).status, 200);
  assert.equal((await bearer('/releases')).status, 401, 'revoked');
  // Two-step login off again (straight in the store), so the later sign-in below needs only the password.
  pair.merkezStore.mutate(d => { delete d.admin.mfa; });
  // The café's own reports: a new version and the owner's remote sessions (times only).
  assert.equal((await pair.link.sync()).ok, true);
  const report = pair.merkezStore.report(demo.tenantId)!; pair.merkezStore.saveReport(demo.tenantId, { ...report, appVersion: '0.0.9' });
  const session = randomUUID();
  pair.link.reportRemoteAdmin({ tenantId: demo.tenantId, session, event: 'start', at: new Date().toISOString() });
  pair.link.reportRemoteAdmin({ tenantId: demo.tenantId, session, event: 'end', at: new Date().toISOString(), reason: 'logout' });
  assert.equal((await pair.link.sync()).ok, true);
  pair.link.reportRemoteAdmin({ tenantId: demo.tenantId, session, event: 'end', at: new Date().toISOString(), reason: 'logout' });
  assert.equal((await pair.link.sync()).ok, true, 'a report sent again (lost answer) is written once');
  // Session security: a wrong current password, a sign-out, a password change.
  assert.equal((await pair.admin('/password', { currentPassword: 'yanlis-sifre', newPassword: 'YeniSifre!2026-Mola' })).status, 400);
  const NEW_PASSWORD = 'YeniSifre!2026-Mola-Kayit';
  assert.equal((await pair.admin('/password', { currentPassword: MERKEZ_PASSWORD, newPassword: NEW_PASSWORD })).status, 200);
  const again = client(`${pair.merkezBase}/api/merkez/admin`);
  assert.equal((await again('/login', { username: 'admin', password: NEW_PASSWORD })).status, 200);
  assert.equal((await again('/logout', {})).status, 200);

  const s = pair.merkezStore;
  const expect = (action: string, check: (e: JournalEntry) => void = () => {}) => { const found = find(s, action); assert.ok(found.length, `${action} is written`); check(found.at(-1)!); return found; };
  expect('admin.login_failed', e => { assert.equal(e.result, 'basarisiz'); assert.equal(e.source, 'bu-bilgisayar'); assert.equal(e.detail, 'Şifre yanlış'); });
  expect('admin.login', e => { assert.equal(e.actor.kind, 'admin'); assert.equal(e.result, 'basarili'); });
  expect('business.imported'); expect('business.created', e => assert.equal(e.business?.name, 'Kod Kafe')); expect('code.created');
  expect('application.received', e => assert.equal(e.actor.kind, 'cafe'));
  expect('application.approved', e => { assert.equal(e.actor.kind, 'admin'); assert.equal(e.business?.name, 'Başvuru Kafe'); });
  expect('application.rejected', e => assert.equal(e.business?.name, 'Ret Kafe'));
  expect('license.extended', e => { assert.equal(e.changes?.[0].field, 'lisans bitişi'); assert.notEqual(e.changes?.[0].from, e.changes?.[0].to); assert.equal(e.business?.id, demo.tenantId); });
  expect('license.plan_changed', e => assert.deepEqual(e.changes, [{ field: 'abonelik planı', from: '12 ay', to: '6 ay' }]));
  expect('license.suspended', e => { assert.equal(e.detail, 'Neden: Ödeme gecikti'); assert.deepEqual(e.changes, [{ field: 'hizmet', from: 'açık', to: 'askıda' }]); });
  expect('license.resumed'); expect('service-plan.menu', e => assert.deepEqual(e.changes, [{ field: 'hizmet paketi', from: 'Tam sistem', to: 'Sadece QR menü' }]));
  expect('owner_reset.issued');
  expect('contact.updated', e => assert.deepEqual(e.changes, [{ field: 'telefon', from: '+905551112233', to: '+905551112244' }]));
  expect('email.settings_saved', e => { assert.ok(e.changes?.some(c => c.field === 'uygulama şifresi' && c.to === 'yeni şifre kaydedildi (gösterilmez)')); assert.ok(e.changes?.some(c => c.field === 'sunucu' && c.to === 'smtp.example.com')); });
  expect('journal.retention_set', e => assert.equal(e.detail, '10 yıl → 12 yıl'));
  expect('workfolder.set', e => assert.equal(e.changes?.[0].to, folder));
  expect('admin.check_failed');
  expect('token.created', e => assert.match(e.detail ?? '', /Yayın komutu/));
  expect('release.imported', e => { assert.equal(e.actor.kind, 'token'); assert.equal(e.actor.name, 'Geliştirici erişimi · Yayın komutu'); });
  expect('release.pilot', e => assert.equal(e.actor.kind, 'token')); expect('release.stopped', e => assert.equal(e.actor.kind, 'admin'));
  const rights = expect('release.step_up');
  assert.deepEqual(rights.map(e => e.actor.kind), ['token', 'admin'], 'Güncelleme yetkisi: who opened it');
  expect('token.revoked'); expect('token.refused', e => assert.equal(e.result, 'reddedildi'));
  expect('cafe.version_changed', e => { assert.equal(e.actor.kind, 'cafe'); assert.deepEqual(e.changes, [{ field: 'sürüm', from: '0.0.9', to: report.appVersion }]); });
  assert.equal(expect('remote_admin.session_started').length, 1); assert.equal(expect('remote_admin.session_ended', e => assert.match(e.detail ?? '', /Çıkış yapıldı/)).length, 1);
  expect('admin.password_change_failed', e => assert.equal(e.result, 'basarisiz')); expect('admin.password_changed'); expect('admin.logout');
  // Every line has the five things a reader needs.
  for (const e of lines(s)) { assert.ok(e.at && e.actor.kind && e.action && e.text && e.source && e.result, `${e.seq} ${e.action}`); assert.match(e.at, /^\d{4}-\d{2}-\d{2}T/); }
  // Never a secret: passwords, codes, keys, install secrets.
  const everything = JSON.stringify(lines(s)) + JSON.stringify(s.read().audit);
  const secrets = [MERKEZ_PASSWORD, 'YanlisSifre!2026', NEW_PASSWORD, 'yanlis-sifre', SMTP_SECRET, TOKEN, TOKEN.slice(11), created.data.code, code2.data.code, reset.data.code, ...s.read().installs.map(i => i.secret)].filter(Boolean);
  for (const secret of secrets) assert.ok(!everything.includes(secret), `secret leaked: ${String(secret).slice(0, 6)}…`);
  assert.equal(s.journal.verify().ok, true);
});

test('the old İşlem geçmişi becomes ONE "Geçmiş kayıtlar aktarıldı" block with its own hash; the old list stays as it was', async () => {
  const dir = temp('islem-aktarma'), key = randomBytes(32), at = new Date('2026-09-01T10:00:00Z');
  let store = new MerkezStore(join(dir, 'merkez'), key, { initialPassword: MERKEZ_PASSWORD });
  const tenantId = randomUUID();
  store.mutate(d => {
    d.businesses.push({ tenantId, name: 'Eski Kafe', source: 'admin', serial: 0, kind: 'trial', endsAt: null, suspended: false, service: 'full', createdAt: at.toISOString() });
    for (let i = 0; i < 30; i++) d.audit.push({ action: i % 2 ? 'license.extended' : 'notes.updated', target: tenantId, at: new Date(at.getTime() + i * 60_000).toISOString(), by: 'admin', detail: `eski ${i}` });
  });
  store.close();
  // Data from before this version: no chain tables at all.
  { const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(join(dir, 'merkez', 'merkez.sqlite')); db.exec('DROP TABLE islem_kayitlari; DROP TABLE islem_muhurleri; DROP TABLE islem_ayar;'); db.close(); }
  store = new MerkezStore(join(dir, 'merkez'), key);
  const all = lines(store);
  assert.equal(all.length, 1, 'one line for the whole old list');
  const block = all[0];
  assert.equal(block.action, 'journal.legacy_imported'); assert.equal(block.text, 'Geçmiş kayıtlar aktarıldı');
  assert.equal(block.legacy!.count, 30); assert.equal(block.legacy!.entries.length, 30);
  assert.equal(block.legacy!.hash, createHash('sha256').update(canonicalJson(block.legacy!.entries)).digest('hex'));
  assert.equal(block.legacy!.entries[3].business?.name, 'Eski Kafe');
  assert.equal(store.read().audit.length, 30, 'the old list is untouched');
  assert.ok(store.journal.lastSeal(), 'sealed at once');
  // On screen the block opens into its old lines, marked.
  const rows = journalRows(store.journal.entries());
  const old = rows.filter(r => r.legacy);
  assert.equal(old.length, 30); assert.equal(old.at(-1)!.text, 'Satıcı notu güncellendi', 'oldest last'); assert.equal(old[0].text, 'Lisans uzatıldı'); assert.equal(old[0].business?.name, 'Eski Kafe');
  // A second start does nothing again; new lines follow the block.
  store.close(); store = new MerkezStore(join(dir, 'merkez'), key);
  store.mutate(d => { d.audit.push({ action: 'notes.updated', target: tenantId, at: new Date().toISOString(), by: 'admin' }); });
  assert.equal(lines(store).length, 2); assert.equal(store.journal.verify().ok, true);
  store.close();
});

test('Rapor al: PDF (cover page with the check and the seal), Excel, and JSONL that the independent verifier accepts', async t => {
  const m = await standalone('islem-rapor'); t.after(m.close);
  const login = await fetch(`${m.base}/api/merkez/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: MERKEZ_PASSWORD }) });
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const call = (path: string, body?: unknown) => fetch(`${m.base}/api/merkez/admin${path}`, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  for (const name of ['Rapor Kafe', 'Şube Çay Evi']) await call('/businesses', { requestId: randomUUID().replace(/-/g, ''), name, kind: 'trial' });
  // The list with filters.
  const list = await (await call('/journal?q=%C3%A7ay%20evi')).json() as { rows: { text: string }[]; total: number; verify: { ok: boolean } };
  assert.equal(list.total, 1); assert.equal(list.rows[0].text, 'İşletme oluşturuldu'); assert.equal(list.verify.ok, true);
  const failed = await (await call('/journal?result=basarisiz')).json() as { total: number }; assert.equal(failed.total, 0);
  assert.equal((await call('/journal?from=2026-10-09&to=2026-10-01')).status, 400);
  // Excel: a real workbook with the lines and the report's facts.
  const x = await call('/journal/report.xlsx'); assert.equal(x.status, 200);
  const files = unzip(Buffer.from(await x.arrayBuffer()));
  assert.ok(files.get('xl/worksheets/sheet1.xml')!.includes('Şube Çay Evi')); assert.ok(files.get('xl/worksheets/sheet2.xml')!.includes('Kayıtlar bütün'));
  // JSONL: the whole period, hashes and seals; the verifier (no Mola code) says whole, and fails on one changed character.
  const j = await call('/journal/export.jsonl'); assert.equal(j.status, 200);
  const text = await j.text(), folder = temp('islem-jsonl'), file = join(folder, 'kopya.jsonl');
  (await import('node:fs')).writeFileSync(file, text);
  const ok = independentCheck(independentLoad(file)); assert.equal(ok.ok, true, ok.text); assert.ok(ok.seals >= 1);
  (await import('node:fs')).writeFileSync(file, text.replace('Rapor Kafe', 'Rapor Kafa'));
  const bad = independentCheck(independentLoad(file)); assert.equal(bad.ok, false); assert.match(bad.text, /içeriği değiştirilmiş/);
  const kept = text.split('\n'); kept.splice(2, 1);
  (await import('node:fs')).writeFileSync(file, kept.join('\n'));
  assert.throws(() => independentLoad(file), /kayıt silinmiş ya da eklenmiş/);
  // Another key cannot pass the seals.
  const other = (await import('../server/license.js')).newSigningPair().publicKey;
  (await import('node:fs')).writeFileSync(file, text);
  assert.equal(independentCheck(independentLoad(file, other)).ok, false);
  // PDF, when this computer has Edge or Chrome (the vendor's Windows always has Edge).
  if (findPrintBrowser()) {
    const p = await call('/journal/report.pdf'); assert.equal(p.status, 200);
    const pdf = Buffer.from(await p.arrayBuffer()); assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(pdf.length > 2000);
  }
  // Each report is itself a line.
  assert.ok(find(m.store, 'journal.exported').length >= 2);
});

test('retention: only lines older than the setting go (never younger than 2 years); the chain starts from the kept anchor', async t => {
  const m = await standalone('islem-saklama'); t.after(m.close);
  const j = m.store.journal, YEAR = 365.25 * 86400000, later = new Date(Date.now() + 12 * YEAR);
  // Seen from 12 years later: the first six lines are 12 years old, the last one a year.
  for (let i = 0; i < 5; i++) j.append({ action: 'notes.updated' });
  j.append({ action: 'notes.updated', at: new Date(later.getTime() - YEAR).toISOString(), detail: 'bir yıllık' });
  j.sealNow();
  assert.throws(() => j.setRetention(1)); assert.equal(j.retentionYears(), 10);
  const removed = j.prune(later);
  assert.equal(removed, 6, 'the first line and the five 12-year-old ones');
  assert.ok(lines(m.store).some(e => e.detail === 'bir yıllık'));
  assert.equal(lines(m.store).at(-1)!.action, 'journal.pruned');
  assert.equal(j.anchor().seq, 6);
  assert.equal(j.verify().ok, true);
  j.setRetention(2); assert.equal(j.prune(later), 0, 'a one-year-old line stays even at the shortest retention');
});
