import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer as createNet } from 'node:net';
import type { AddressInfo } from 'node:net';
import { weakAdminPassword } from '../packages/domain/admin-password.js';
import { withoutHiddenMarks } from '../packages/domain/plain-text.js';
import { DEMO_PASSWORD } from '../server/app.js';
import { extendMonths, publicKeyFrom } from '../server/license.js';
import { cleanName } from '../server/merkez/attachments.js';
import { senderOf, sendMail } from '../server/merkez/mail.js';
import { releaseNotes } from '../server/merkez/releases.js';
import { verifyRelease } from '../server/update-manifest.js';
import { ApiError } from '../src/api.js';
import { businessesCsv, compareVersion, csvCell, expiresSoon, localDay, machineSwapOpen, olderThanCafes, runningTrial, signInError, type Business } from '../src/platformStatus.js';
import { uploadBlocker } from '../src/TicketFiles.js';
import { merkezPair, temp } from './merkez-fixture.js';
import { adminCall, testBundle, uploadBundle } from './update-fixture.js';

/*
 * Mola Yönetim QA turu (docs: GELISTIRICI_REHBERI bölüm 12): each test names the QA item it guards.
 */
const rid = () => randomUUID().replace(/-/g, '');
const DAY = 86400000;
const business = (over: Partial<Business>): Business => ({ tenantId: 't', name: 'Kafe', endsAt: new Date(Date.now() + 30 * DAY).toISOString(), suspended: false, daysRemaining: 30, active: true, frozen: false, setupCompleted: true, appVersion: '0.1.0', openTickets: 0, activation: 'active', kind: 'subscription', planMonths: 12, ...over } as Business);

test('1 · "1 ay / 6 ay / 1 yıl uzat" only adds time: a yearly plan stays yearly (freeze still allowed); the plan changes only on its own', async t => {
  let time = Date.parse('2026-10-05T09:00:00Z');
  const pair = await merkezPair('qa-extend', { demo: true, now: () => new Date(time) }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin();
  const state = async () => (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo');
  let b = await state();
  assert.equal(b.planMonths, 12);
  for (const months of [1, 6, 12]) {
    const before = b.endsAt;
    const r = await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: before, expectedSuspended: false, months, suspended: false });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    b = await state();
    assert.equal(b.planMonths, 12, `${months} ay uzatma planı değiştirmez`); assert.equal(b.kind, 'subscription');
    assert.equal(b.endsAt, extendMonths(new Date(before), months));
  }
  assert.equal(pair.merkezStore.read().audit.filter(a => a.action === 'license.extended').length, 3);
  // The café gets the extended yearly licence: its freeze rights are still there.
  await pair.link.sync();
  assert.equal(pair.link.license('mola-demo')!.planMonths, 12);
  const owner = pair.kafe(); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  const freeze = await owner('/staff/license/freeze', { requestId: rid(), reason: 'Tadilat', startDate: '2026-10-10', days: 10 });
  assert.equal(freeze.status, 200, JSON.stringify(freeze.data));
  // Changing the plan is its own action: no time added, the end date stays; refused together with a term.
  const end = b.endsAt;
  assert.equal((await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: end, expectedSuspended: false, months: 1, suspended: false, plan: 1 })).status, 400);
  assert.equal((await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: end, expectedSuspended: false, months: 0, suspended: false, plan: 12 })).data.code, 'CONFLICT', 'already yearly');
  assert.equal((await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: end, expectedSuspended: false, months: 0, suspended: false, plan: 6 })).status, 200);
  b = await state();
  assert.equal(b.planMonths, 6); assert.equal(b.endsAt, end, 'a plan change adds no time');
  assert.match(pair.merkezStore.read().audit.findLast(a => a.action === 'license.plan_changed')!.detail!, /12 ay → 6 ay/);
});

test('3 · CSV: formula-looking cells stay text, a phone keeps its +90, the file is named with the date in Türkiye', () => {
  for (const evil of ['=HYPERLINK("http://x","tıkla")', '+90 532', '-2+3', '@SUM(A1)', '\tsekme', '\rsatır']) assert.ok(csvCell(evil).replace(/^"/, '').startsWith(`'`), JSON.stringify(evil));
  assert.equal(csvCell('Köşe Kafe'), 'Köşe Kafe'); assert.equal(csvCell('a;b'), '"a;b"'); assert.equal(csvCell('say "x"'), '"say ""x"""');
  const csv = businessesCsv([business({ name: '=cmd|"/c calc"!A1', invoice: { legalName: '@Unvan', taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1234567890', city: 'İstanbul', district: 'Kadıköy', address: '-adres', phone: '+905321234567', email: 'a@b.co' } })]);
  const row = csv.split('\r\n')[1];
  assert.ok(row.startsWith(`"'=cmd|""/c calc""!A1"`), row);
  assert.ok(row.includes(`;'+905321234567;`), 'the phone is text'); assert.ok(row.includes(`;'@Unvan;`)); assert.ok(row.includes(`;'-adres;`));
  // 01:49 on 5 October in Türkiye is still 4 October in UTC.
  assert.equal(localDay(new Date('2026-10-04T22:49:00Z')), '2026-10-05');
  assert.equal(localDay(new Date('2026-10-05T12:00:00Z')), '2026-10-05');
});

test('5 · weak Mola Yönetim passwords are refused with what to change', () => {
  for (const weak of ['aaaaaaaaaaaa', '111111111111', '123456789012', 'abcdefghijkl', 'qwertyuiop12', 'Mola2026Mola', 'molamolamola1', 'Admin12345678', 'Password1234!', 'M0la!Y0netim2026', 'Şifre12345678', '121212121212'])
    assert.ok(weakAdminPassword(weak), weak);
  assert.match(weakAdminPassword('kisa')!, /12 karakter/);
  assert.match(weakAdminPassword('aaaaaaaaaaaa')!, /tekrar/);
  assert.match(weakAdminPassword('123456789012')!, /ardışık/);
  assert.match(weakAdminPassword('Mola2026Mola!')!, /mola/);
  // The business name is no password either.
  assert.equal(weakAdminPassword('DerbiKafe2026!'), undefined);
  assert.ok(weakAdminPassword('DerbiKafe2026!', ['Derbi Kafe Şube R1']));
  for (const fine of ['ChangedMerkez!2026', 'NewAdminSecret!2026', 'IlkDegisim!2026x', 'AdminBrowserTest!2026', 'BenimSifrem!2026', 'kırmızı-bisiklet-yokuş', 'Tq7#pLm2vXz9']) assert.equal(weakAdminPassword(fine), undefined, fine);
});

test('6 · attachment names lose direction marks and control characters', () => {
  assert.equal(cleanName('fatura‮fdp.exe', 'pdf'), 'faturafdp.pdf');
  assert.equal(cleanName('⁦gizli⁩‏ ad\u0085.jpg', 'webp'), 'gizli ad.webp');
  assert.equal(withoutHiddenMarks('a‫b‎c\u0007d'), 'abcd');
  assert.equal(withoutHiddenMarks('Öğle menüsü.pdf'), 'Öğle menüsü.pdf');
});

test('7 · release notes are plain text: "<" is accepted, the signed copy still verifies on an installed café; a long note says so', async t => {
  assert.equal(releaseNotes('  Fiyat < 100 TL ve "x" & y \r\n ikinci satır\u0007 '), 'Fiyat < 100 TL ve "x" & y \n ikinci satır');
  assert.throws(() => releaseNotes('x'.repeat(601)), (e: Error & { code?: string }) => e.code === 'NOTES_TOO_LONG' && /600 karakter/.test(e.message));
  const pair = await merkezPair('qa-release-notes', { demo: true }); t.after(() => pair.close());
  const up = await uploadBundle(pair.merkezBase, (await testBundle(temp('qa-bundle'), '0.1.1')).file, pair.merkezStore);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const saved = await adminCall(pair.merkezBase, up.cookie, '/releases/notes', { id: up.data.release.id, notes: 'Masa < 10 olunca <b>hızlı</b> açılır' });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.release.notes, 'Masa < 10 olunca <b>hızlı</b> açılır', 'shown as written (escaped on screen)');
  const row = pair.merkezStore.db.prepare('SELECT payload FROM releases').get() as { payload: string };
  const claims = verifyRelease(JSON.parse(row.payload).signed, publicKeyFrom(pair.merkezStore.publicKey));
  assert.equal(claims.notes, 'Masa ‹ 10 olunca ‹b›hızlı‹/b› açılır', 'older cafés accept the signed copy');
  const long = await adminCall(pair.merkezBase, up.cookie, '/releases/notes', { id: up.data.release.id, notes: 'x'.repeat(700) });
  assert.equal(long.status, 400); assert.equal(long.data.code, 'NOTES_TOO_LONG'); assert.equal(long.data.fields, undefined);
  // A bundle no café needs is said so.
  assert.equal(compareVersion('0.1.10', '0.1.9'), 1); assert.equal(compareVersion('0.1.0-beta', '0.1.0'), -1);
  const cafes = [{ appVersion: '0.1.2', installId: 'a', update: { platform: 'windows' } }, { appVersion: '0.1.1', installId: 'b', update: null }];
  assert.match(olderThanCafes({ version: '0.1.1', platform: 'windows' }, cafes), /Bu sürüm işletmelerdekinden eski; kimseye sunulmaz/);
  assert.match(olderThanCafes({ version: '0.1.2', platform: 'windows' }, cafes.slice(0, 1)), /zaten kurulu; kimseye sunulmaz/);
  assert.equal(olderThanCafes({ version: '0.1.3', platform: 'windows' }, cafes), '');
  assert.equal(olderThanCafes({ version: '0.1.1', platform: 'linux-x64' }, cafes.slice(0, 1)), '', 'another platform');
});

test('8 · a new 30-day trial is "Denemede", not "Bitiyor", until its last 7 days; paid licences keep 30', () => {
  const trial = business({ kind: 'trial', planMonths: undefined, daysRemaining: 30 });
  assert.equal(expiresSoon(trial), false); assert.equal(runningTrial(trial), true);
  assert.equal(expiresSoon({ ...trial, daysRemaining: 8 }), false);
  assert.equal(expiresSoon({ ...trial, daysRemaining: 7 }), true);
  assert.equal(expiresSoon(business({ daysRemaining: 30 })), true); assert.equal(expiresSoon(business({ daysRemaining: 31 })), false);
});

test('9 · "İki farklı bilgisayar" leaves Bugün once the vendor settled it, and comes back with the next new computer', async t => {
  const now = Date.parse('2026-10-05T12:00:00Z'), iso = (d: number) => new Date(now - d * 3600_000).toISOString();
  assert.equal(machineSwapOpen({ machines: [{ hash: 'a', firstSeenAt: iso(50), lastSeenAt: iso(5), active: false, replacedAt: iso(5) }, { hash: 'b', firstSeenAt: iso(5), lastSeenAt: iso(1), active: true }] }, now), true);
  assert.equal(machineSwapOpen({ machines: [{ hash: 'a', firstSeenAt: iso(50), lastSeenAt: iso(5), active: true, restoredAt: iso(2) }, { hash: 'b', firstSeenAt: iso(5), lastSeenAt: iso(1), active: false, replacedAt: iso(2) }] }, now), false);
  assert.equal(machineSwapOpen({ machines: [{ hash: 'a', firstSeenAt: iso(50), lastSeenAt: iso(5), active: false, restoredAt: iso(20), replacedAt: iso(3) }, { hash: 'c', firstSeenAt: iso(3), lastSeenAt: iso(1), active: true }] }, now), true, 'a newer swap after the vendor settled one');
  assert.equal(machineSwapOpen({ machines: [{ hash: 'a', firstSeenAt: iso(500), lastSeenAt: iso(200), active: false, replacedAt: iso(200) }] }, now), false, 'older than 7 days');
  // Merkez marks the computer the vendor gave the licence back to.
  const pair = await merkezPair('qa-machine', { demo: true }); t.after(() => pair.close());
  const { installId } = await pair.importDemo(); await pair.adminLogin();
  pair.merkezStore.mutate(d => { d.installs.find(i => i.id === installId)!.machines = [{ hash: 'a'.repeat(64), firstSeenAt: iso(50), lastSeenAt: iso(5), replacedAt: iso(5) }, { hash: 'b'.repeat(64), firstSeenAt: iso(5), lastSeenAt: iso(1) }]; });
  assert.equal((await pair.admin('/installs/machine', { requestId: rid(), tenantId: 'mola-demo', machine: 'a'.repeat(64) })).status, 200);
  const b = (await pair.admin('/state')).data.businesses.find((x: any) => x.tenantId === 'mola-demo');
  assert.equal(machineSwapOpen(b), false); assert.ok(b.machines.find((m: any) => m.hash === 'a'.repeat(64)).restoredAt);
});

test('10 · e-mail: never "From: <>": a sender address is required when the user is no e-mail address, checked before connecting', async t => {
  assert.equal(senderOf({ from: '', user: 'satici@example.com' }), 'satici@example.com');
  assert.equal(senderOf({ from: 'bildirim@example.com', user: 'apikey' }), 'bildirim@example.com');
  assert.equal(senderOf({ from: undefined, user: '' }), '');
  // A local relay that would accept anything: nothing reaches it without a sender.
  let connections = 0;
  const relay = createNet(s => { connections++; s.destroy(); }); await new Promise<void>(r => relay.listen(0, '127.0.0.1', r)); t.after(() => new Promise<void>(r => relay.close(() => r())));
  const port = (relay.address() as AddressInfo).port;
  await assert.rejects(sendMail({ enabled: true, host: '127.0.0.1', port, security: 'none', user: '', password: '', to: 'a@example.com', updatedAt: '' }, 'a@example.com', 'x', 'y'), /Gönderen adresi/);
  assert.equal(connections, 0);
  const pair = await merkezPair('qa-mail'); t.after(() => pair.close()); await pair.adminLogin();
  const settings = { enabled: true, host: '127.0.0.1', port, security: 'none', user: '', to: 'satici@example.com' };
  const refused = await pair.admin('/email', settings);
  assert.equal(refused.status, 400); assert.equal(refused.data.code, 'EMAIL_FROM'); assert.match(refused.data.message, /Gönderen adresini yazın/);
  assert.equal((await pair.admin('/email', { ...settings, from: 'bildirim@example.com' })).status, 200);
  assert.equal((await pair.admin('/email', { ...settings, enabled: false })).status, 200, 'turning it off needs no sender');
  const test = await pair.admin('/email/test', {});
  assert.equal(test.status, 409); assert.match(test.data.message, /Gönderen adresi/);
});

test('11 · sign-in errors: a definite answer as it is, the "check again" hint only when the answer may be lost', () => {
  assert.equal(signInError(new ApiError('Şifre yanlış.', 403, 'INVALID_PASSWORD')), 'Şifre yanlış.');
  assert.equal(signInError(new ApiError('Doğrulama kodu geçersiz.', 403, 'INVALID_CODE')), 'Doğrulama kodu geçersiz.');
  assert.equal(signInError(new ApiError('Giriş bilgileri yanlış.', 401, 'INVALID_LOGIN')), 'Giriş bilgileri yanlış.');
  assert.match(signInError(new TypeError('Failed to fetch')), /^Mola Merkez’e ulaşılamadı\. İşlem sonucu belirsizse sayfayı yenileyip/);
  assert.match(signInError(new ApiError('Sunucu hatası.', 500, 'INTERNAL')), /İşlem sonucu belirsizse/);
});

test('13 · a refused attachment says why next to "Gönder" (no pointless retry); a lost upload offers a retry', () => {
  assert.equal(uploadBlocker([{ name: 'virus‮fdp.exe', error: 'Yalnız fotoğraf (JPG, PNG, WEBP, HEIC) ve PDF eklenebilir.', refused: true }]), 'virusfdp.exe gönderilemez: Yalnız fotoğraf (JPG, PNG, WEBP, HEIC) ve PDF eklenebilir. Mesajı göndermek için eki kaldırın.');
  assert.equal(uploadBlocker([{ name: 'a.jpg', error: 'Bağlantı kesildi.' }, { name: 'b.jpg', error: 'Bağlantı kesildi.' }]), 'a.jpg ve 1 ek daha yüklenemedi: Bağlantı kesildi. Tekrar deneyin ya da eki kaldırın.');
});

test('14 · a suspended café: staff and owner read that Mola stopped the service (with the contact), guests are sent to the staff', async t => {
  const pair = await merkezPair('qa-suspended', { demo: true }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin();
  await pair.admin('/contact', { phone: '0850 123 45 67', whatsapp: '', email: 'destek@mola.example', hours: '', web: '' });
  const owner = pair.kafe(); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  const s = (await owner('/staff/state')).data;
  await owner('/staff/setup', { requestId: rid(), version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: 0, commissionBps: null });
  const guest = pair.kafe(), session = await guest('/guest/session', { token: s.tables[0].token });
  assert.equal(session.status, 200);
  const b = (await pair.admin('/state')).data.businesses.find((x: any) => x.tenantId === 'mola-demo');
  assert.equal((await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: false, months: 0, suspended: true, reason: 'Ödeme gecikti' })).status, 200);
  await pair.link.sync();
  const staffOrder = await owner('/staff/orders', { requestId: rid(), tableId: s.tables[1].id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
  assert.equal(staffOrder.status, 409); assert.equal(staffOrder.data.code, 'SERVICE_SUSPENDED');
  assert.match(staffOrder.data.message, /^Bu işletmenin hizmeti Mola tarafından durduruldu\. Mola ekibiyle görüşün\. Mola ekibi: Tel\. 0850 123 45 67/);
  assert.doesNotMatch(staffOrder.data.message, /Personelle görüşün|LICENSE_EXPIRED/);
  assert.match((await owner('/staff/state')).data.licenseNotice, /^Bu işletmenin hizmeti Mola tarafından durduruldu\. Mola ekibiyle görüşün\. Mola ekibi: Tel\./);
  // A guest still hears "talk to the staff" (never the vendor's contact).
  const guestOrder = await guest('/guest/orders', { requestId: rid(), tableId: session.data.tableId, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
  assert.ok(guestOrder.status >= 400); assert.match(guestOrder.data.message, /personel/i); assert.doesNotMatch(JSON.stringify(guestOrder.data), /Mola ekibi/);
});
