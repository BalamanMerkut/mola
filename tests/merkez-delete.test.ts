import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEMO_PASSWORD } from '../server/app.js';
import { MerkezLink, REMOVED_NOTICE } from '../server/kafe-link.js';
import { licenseSummary, newSigningPair, publicKeyFrom, signRemoval, privateKeyFrom, verifyRemoval } from '../server/license.js';
import { Store } from '../server/store.js';
import type { ApplicationForm } from '../server/sync-protocol.js';
import { merkezPair, temp } from './merkez-fixture.js';

/*
 * "Kaydı sil" for a business that had connected: only after "Askıya al" and with its name typed again. Its café hears a
 * signed final "kaydı kapatıldı" with its next heartbeat, stays locked and keeps every byte of its data; the tax number
 * stays (as a keyed hash) so a new application with it is flagged to the vendor only.
 */
process.env.MOLA_APPLICATION_POLL_MS = '0';
const rid = () => randomUUID().replace(/-/g, '');
type Pair = Awaited<ReturnType<typeof merkezPair>>;
function form(name: string, taxNumber = '1234567890'): ApplicationForm {
  return { businessName: name, sector: 'cafe', contactName: 'Ayşe Yılmaz', consent: true,
    invoice: { legalName: `${name} Gıda Ltd. Şti.`, taxOffice: 'Kadıköy', taxType: 'company', taxNumber, city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 1', phone: '+905321234567', email: 'ayse@example.com' } };
}
const state = async (pair: Pair) => (await pair.admin('/state')).data;
const snapshots = (store: Store) => (store.db.prepare('SELECT tenant, payload FROM snapshots ORDER BY tenant').all() as { tenant: string; payload: Uint8Array }[]).map(r => `${r.tenant}:${Buffer.from(r.payload).toString('base64')}`);
async function suspend(pair: Pair, tenantId: string) {
  const b = (await state(pair)).businesses.find((x: any) => x.tenantId === tenantId);
  const r = await pair.admin('/licenses', { requestId: rid(), tenantId, expectedEnd: b.endsAt, expectedSuspended: false, months: 0, suspended: true, reason: 'Ödeme yapılmadı' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

test('a connected business: refused until suspended, refused with a wrong name; deleted, its café gets a signed final answer, stays locked, keeps its data; the tax number is flagged on a new application', async t => {
  let time = Date.parse('2026-10-04T09:00:00Z');
  const pair = await merkezPair('delete-connected', { now: () => new Date(time) }); t.after(() => pair.close());
  await pair.adminLogin();
  const kafe = pair.kafe();
  await pair.link.apply(form('Kapanan Kafe'));
  const tenantId = (await state(pair)).businesses[0].tenantId;
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId })).status, 200);
  await pair.link.checkApplication();
  assert.equal((await kafe('/activation/owner', { username: 'ayse', password: 'AyseKafe!2026' })).status, 200);
  await kafe('/login', { username: 'ayse', password: 'AyseKafe!2026' });
  const s = (await kafe('/staff/state')).data;
  await kafe('/staff/setup', { requestId: rid(), version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: 0, commissionBps: null });
  const token = (await kafe('/staff/state')).data.tables[0].token;
  // A support ticket reaches Merkez (with its alert and notification records).
  assert.equal((await kafe('/staff/support', { requestId: rid(), subject: 'Yazıcı', text: 'Fiş çıkmıyor.' })).status, 200);
  assert.equal((await pair.link.sync()).ok, true);
  let d = await state(pair);
  assert.equal(d.businesses[0].neverConnected, false); assert.equal(d.tickets.length, 1);
  const ticketAlert = d.alerts.find((a: any) => a.kind === 'ticket.new'); assert.ok(ticketAlert.ticketId);

  // Not suspended: refused, and the answer says what to do first.
  const refused = await pair.admin('/businesses/delete', { requestId: rid(), tenantId, confirmName: 'Kapanan Kafe' });
  assert.equal(refused.status, 409); assert.equal(refused.data.code, 'CONNECTED'); assert.match(refused.data.message, /Önce askıya alın, sonra silebilirsiniz/);
  await suspend(pair, tenantId);
  time += 60_000; assert.equal((await pair.link.sync()).ok, true);
  assert.equal(pair.link.license(tenantId)!.suspended, true);
  // Suspended, but the name is missing or wrong.
  for (const confirmName of [undefined, 'Kapanan', 'Başka Kafe']) {
    const r = await pair.admin('/businesses/delete', { requestId: rid(), tenantId, ...(confirmName ? { confirmName } : {}) });
    assert.equal(r.status, 409); assert.equal(r.data.code, 'NAME_MISMATCH');
  }
  assert.equal((await state(pair)).businesses.length, 1, 'nothing deleted by the refusals');

  const before = snapshots(pair.store);
  // Case and spaces do not matter.
  const deleted = await pair.admin('/businesses/delete', { requestId: rid(), tenantId, confirmName: '  kapanan   KAFE ' });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data)); assert.equal(deleted.data.name, 'Kapanan Kafe');
  d = await state(pair);
  assert.equal(d.businesses.length, 0); assert.equal(d.tickets.length, 0, 'its tickets went with it');
  assert.equal(d.notifications.length, 0, 'and their notification records');
  const alert = d.alerts.find((a: any) => a.id === ticketAlert.id);
  assert.ok(alert, 'the alert stays as text'); assert.equal(alert.tenantId, undefined); assert.equal(alert.ticketId, undefined);
  const audit = d.audit.find((a: any) => a.action === 'business.deleted');
  assert.deepEqual([audit.name, audit.by, audit.detail, audit.target], ['Kapanan Kafe', 'admin', 'askıdaydı, bağlanmıştı', tenantId]);
  assert.ok(d.audit.filter((a: any) => a.target === tenantId).every((a: any) => a.name === 'Kapanan Kafe'), 'older history lines keep the name');
  const registry = pair.merkezStore.read();
  assert.equal(registry.installs.length, 0);
  assert.deepEqual(Object.keys(registry.removed![0]).sort(), ['deletedAt', 'installId', 'secret', 'tenantId'], 'a minimal tombstone');
  assert.equal(pair.merkezStore.report(tenantId), undefined);
  // An older café (no "kapanış" support) holds only its suspended licence: it stays locked.
  assert.equal(licenseSummary(pair.link.license(tenantId)!, new Date(time)).active, false);

  // The café's next signed heartbeat: a signed final answer.
  time += 60_000;
  assert.equal((await pair.link.sync()).ok, true);
  const record = pair.link.read()!, claims = verifyRemoval(record.removed![tenantId], publicKeyFrom(pair.merkezStore.publicKey));
  assert.deepEqual([claims.installId, claims.tenantId], [record.installId, tenantId]);
  assert.throws(() => verifyRemoval(record.removed![tenantId], publicKeyFrom(newSigningPair().publicKey)), /imzası geçersiz/);
  assert.equal(pair.link.removed(tenantId), true); assert.equal(pair.link.closed(), true);
  assert.equal(pair.link.active(tenantId), false); assert.equal((pair.link.summary(tenantId) as { blocked?: string }).blocked, 'removed');
  assert.equal(pair.link.notice(tenantId), REMOVED_NOTICE);
  assert.equal(REMOVED_NOTICE, 'Bu işletmenin Mola kaydı kapatıldı. Yeniden başlamak için Mola ekibiyle görüşün.');
  // The owner still signs in and sees the reason on the panel and in Destek; the menu and new orders stay closed.
  assert.equal((await kafe('/login', { username: 'ayse', password: 'AyseKafe!2026' })).status, 200);
  assert.equal((await kafe('/staff/state')).data.licenseNotice, REMOVED_NOTICE);
  const support = (await kafe('/staff/support')).data;
  assert.equal(support.merkez.blocked, 'removed'); assert.equal(support.merkez.notice, REMOVED_NOTICE);
  assert.equal((await kafe('/staff/support', { requestId: rid(), subject: 'Neden', text: 'Ne oldu?' })).data.code, 'RECORD_CLOSED');
  assert.equal((await pair.kafe()('/guest/session', { token })).data.code, 'MENU_UNAVAILABLE');
  // Further heartbeats are answered the same way; nothing reopens it, and the café data is byte for byte the same.
  time += 60_000; assert.equal((await pair.link.sync()).ok, true); assert.equal(pair.link.active(tenantId), false);
  const restarted = new MerkezLink(pair.store, { now: () => new Date(time), url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), machineKey: 'test:kasa-pc' });
  assert.equal(restarted.removed(tenantId), true); assert.equal(restarted.notice(), REMOVED_NOTICE);
  assert.deepEqual(snapshots(pair.store), before, 'no café data is touched');

  // The same tax number applies again from another computer: "Onay bekleniyor" for the applicant, a flag for the vendor only.
  const other = new Store(temp('delete-again'), []); t.after(() => other.close());
  const again = new MerkezLink(other, { url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), machineId: 'c'.repeat(64) });
  assert.equal(await again.apply(form('Yeni Kafe')), 'applied');
  assert.equal(again.application()!.status, 'pending'); assert.equal(again.application()!.reason, undefined);
  const fresh = (await state(pair)).businesses.find((b: any) => b.name === 'Yeni Kafe');
  assert.equal(fresh.application.deletedTax, true); assert.equal(fresh.application.duplicateTax, false);
  assert.match((await state(pair)).alerts.at(-1).text, /daha önce silinen bir işletmeye aitti/);
  const rows = pair.merkezStore.db.prepare('SELECT hash, state FROM tax_index').all() as { hash: string; state: string }[];
  assert.ok(rows.some(r => r.state === 'deleted')); assert.equal(rows.some(r => r.hash.includes('1234567890')), false);
  // The vendor may still start it as a fresh trial.
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId: fresh.tenantId })).status, 200);
});

test('one business of a shared install (imported folder): only that one closes; a forged "kapanış" is ignored', async t => {
  let time = Date.parse('2026-10-04T09:00:00Z');
  const pair = await merkezPair('delete-shared', { demo: true, now: () => new Date(time) }); t.after(() => pair.close());
  const { installId } = await pair.importDemo(); await pair.adminLogin();
  assert.equal((await pair.link.sync()).ok, true);
  await suspend(pair, 'other-demo');
  const name = (await state(pair)).businesses.find((b: any) => b.tenantId === 'other-demo').name;
  assert.equal((await pair.admin('/businesses/delete', { requestId: rid(), tenantId: 'other-demo', confirmName: name })).status, 200);
  assert.equal(pair.merkezStore.read().installs.length, 1, 'the install stays for the other business');
  assert.equal(pair.merkezStore.read().removed![0].secret, undefined, 'no secret kept while the install lives');
  time += 60_000; assert.equal((await pair.link.sync()).ok, true);
  assert.equal(pair.link.removed('other-demo'), true); assert.equal(pair.link.removed('mola-demo'), false); assert.equal(pair.link.closed(), false);
  assert.equal(pair.link.active('mola-demo'), true); assert.equal(pair.link.active('other-demo'), false);
  const owner = pair.kafe(); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  assert.notEqual((await owner('/staff/state')).data.licenseNotice, REMOVED_NOTICE);
  // A "kapanış" not signed by this Merkez (put into the record by hand) closes nothing.
  const forged = signRemoval({ v: 1, installId, tenantId: 'mola-demo', removedAt: new Date(time).toISOString() }, privateKeyFrom(newSigningPair().privateKey));
  const fresh = new MerkezLink(pair.store, { now: () => new Date(time), url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), machineKey: 'test:kasa-pc' });
  const row = fresh.read()!; (row as any).removed['mola-demo'] = forged;
  assert.equal(fresh.removed('mola-demo'), false); assert.equal(fresh.active('mola-demo'), true);
});
