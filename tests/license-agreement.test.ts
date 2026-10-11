import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AGREEMENT_VERSION, agreementNeeded, agreementVersionOf } from '../packages/domain/agreement.js';
import { DEMO_PASSWORD } from '../server/app.js';
import { syncRequest } from '../server/sync-protocol.js';
import { merkezPair } from './merkez-fixture.js';
import { forgetAgreementLater, postponeAgreement, rememberAccepted, resetAgreementMemory, shouldAsk } from '../src/agreementPrompt.js';

process.env.MOLA_APPLICATION_POLL_MS = '0';
const rid = () => randomUUID().replace(/-/g, '');
const agreed = { agreement: { version: AGREEMENT_VERSION } };
const form = (name: string) => ({ businessName: name, sector: 'cafe' as const, contactName: 'Ayşe Yılmaz', consent: true as const,
  invoice: { legalName: `${name} Ltd. Şti.`, taxOffice: 'Kadıköy', taxType: 'company' as const, taxNumber: '1234567890', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 1', phone: '+905321234567', email: 'ayse@example.com' } });

test('the bundled agreement: one text with its version, marked as a draft, plain Turkish without article numbers', () => {
  const text = readFileSync('docs/hukuk/MOLA_LISANS_SOZLESMESI.md', 'utf8');
  assert.equal(agreementVersionOf(text), AGREEMENT_VERSION, 'the "Sürüm:" line and AGREEMENT_VERSION say the same');
  assert.match(text, /TASLAK — yürürlüğe girmeden önce avukat tarafından kontrol edilmelidir\./);
  for (const must of [/Merkut Studios/, /işletme başına ve bilgisayar başına/i, /tersine mühendislik/, /VDS/, /alt lisans/, /5846 sayılı Fikir ve Sanat Eserleri Kanunu/, /Elazığ/, /avukat onaylasın/, /okunabilir hâlde gönderilmez/]) assert.match(text, must);
  // The draft mark is the only line with an em dash; no article numbers or penalties are cited.
  assert.deepEqual(text.split('\n').filter(l => l.includes('—') && !l.includes('TASLAK')), []);
  assert.doesNotMatch(text, /madde\s*\d|\d+\.\s*madde|hapis|adli para cezası/i);
  assert.equal(agreementNeeded(undefined), true); assert.equal(agreementNeeded({ version: AGREEMENT_VERSION - 1 }), true); assert.equal(agreementNeeded({ version: AGREEMENT_VERSION }), false);
});

test('activation by code carries the acceptance to Merkez (once, journalled); the owner is not asked again; a wrong version is refused', async t => {
  const pair = await merkezPair('agreement-code'); t.after(() => pair.close());
  await pair.adminLogin();
  const created = await pair.admin('/businesses', { requestId: rid(), name: 'Sözleşme Kafe', kind: 'trial' });
  const kafe = pair.kafe();
  assert.equal((await kafe('/activation/code', { code: created.data.code, agreement: { version: AGREEMENT_VERSION + 1 } })).status, 400);
  const activated = await kafe('/activation/code', { code: created.data.code, ...agreed });
  assert.equal(activated.status, 200, JSON.stringify(activated.data));
  const biz = pair.merkezStore.read().businesses.find(b => b.name === 'Sözleşme Kafe')!;
  assert.equal(biz.agreement?.version, AGREEMENT_VERSION); assert.ok(biz.agreement?.acceptedAt);
  assert.deepEqual(pair.link.agreement(biz.tenantId), { version: AGREEMENT_VERSION, acceptedAt: biz.agreement!.acceptedAt });
  assert.equal((await kafe('/activation/owner', { username: 'sozlesme', password: 'Sozlesme!2026' })).status, 200);
  assert.deepEqual((await kafe('/staff/license/agreement')).data, { version: AGREEMENT_VERSION, accepted: { version: AGREEMENT_VERSION, acceptedAt: biz.agreement!.acceptedAt }, needed: false });
  // Merkez already has it: heartbeats do not send it again.
  await pair.link.sync(); await pair.link.sync();
  assert.equal(pair.link.payload(pair.link.read()!).agreements, undefined);
  assert.equal(pair.merkezStore.read().audit.filter(a => a.action === 'agreement.accepted' && a.target === biz.tenantId).length, 1);
  const view = (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === biz.tenantId);
  assert.equal(view.agreement.version, AGREEMENT_VERSION); assert.equal(view.agreement.acceptedAt, biz.agreement!.acceptedAt);
});

test('the application carries it too (with the contact name); an approval keeps it; an older Merkez that refuses the field still activates', async t => {
  const pair = await merkezPair('agreement-application'); t.after(() => pair.close());
  const kafe = pair.kafe();
  assert.equal((await kafe('/activation/application', { ...form('Başvuru Kafe'), ...agreed })).status, 200);
  await pair.adminLogin();
  let biz = pair.merkezStore.read().businesses.find(b => b.name === 'Başvuru Kafe')!;
  assert.equal(biz.agreement?.version, AGREEMENT_VERSION); assert.equal(biz.agreement?.name, 'Ayşe Yılmaz');
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId: biz.tenantId })).status, 200);
  assert.equal((await kafe('/activation')).data.state, 'owner');
  assert.equal(pair.link.agreement(biz.tenantId)?.name, 'Ayşe Yılmaz');
  assert.equal(pair.link.read()!.agreements![biz.tenantId].sent, true);

  // An older Mola Merkez: strict activation schema without `agreement` (VALIDATION_ERROR). The café tries once more without it.
  const old = await merkezPair('agreement-old-merkez', {
    fetch: async (input, init) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (String(input).endsWith('/activate/code') && body.includes('"agreement"')) return new Response(JSON.stringify({ code: 'VALIDATION_ERROR', message: 'Alanları kontrol edin.' }), { status: 400, headers: { 'Content-Type': 'application/json', 'X-Mola-Server-Time': new Date().toISOString() } });
      return fetch(input, init);
    },
  });
  t.after(() => old.close());
  await old.adminLogin();
  const code = (await old.admin('/businesses', { requestId: rid(), name: 'Eski Merkez Kafe', kind: 'trial' })).data.code;
  assert.equal((await old.kafe()('/activation/code', { code, ...agreed })).status, 200);
  biz = old.merkezStore.read().businesses.find(b => b.name === 'Eski Merkez Kafe')!;
  assert.equal(biz.agreement, undefined, 'the refused field never arrived');
  assert.equal(old.link.read()!.agreements![biz.tenantId].sent, false);
  // Once the (now updated) Merkez lists 'agreement', the heartbeat delivers it.
  await old.link.sync(); await old.link.sync();
  assert.equal(old.merkezStore.read().businesses.find(b => b.tenantId === biz.tenantId)!.agreement?.version, AGREEMENT_VERSION);
  assert.equal(old.link.read()!.agreements![biz.tenantId].sent, true);
});

test('an existing install: only the owner is asked, staff are not; the acceptance reaches Merkez with the heartbeat; old heartbeats still pass', async t => {
  const pair = await merkezPair('agreement-existing', { demo: true }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin();
  const owner = pair.kafe(), cashier = pair.kafe(), waiter = pair.kafe(), kitchen = pair.kafe();
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  for (const [c, username] of [[cashier, 'kasiyer'], [waiter, 'garson'], [kitchen, 'mutfak']] as const) {
    assert.equal((await c('/login', { username, password: DEMO_PASSWORD })).status, 200);
    assert.equal((await c('/staff/license/agreement')).status, 403, `${username} is never asked`);
    assert.equal((await c('/staff/license/agreement', { version: AGREEMENT_VERSION })).status, 403);
  }
  const before = (await owner('/staff/license/agreement')).data;
  assert.deepEqual(before, { version: AGREEMENT_VERSION, accepted: null, needed: true });
  // Not accepting changes nothing for anyone: the cashier still takes orders.
  const s = (await cashier('/staff/state')).data;
  assert.equal((await cashier('/staff/orders', { requestId: rid(), tableId: s.tables[0].id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 })).status, 200);
  // The heartbeat of a café that never accepted (and of older cafés) has no such field and passes the strict schema.
  await pair.link.sync();
  assert.equal(pair.link.payload(pair.link.read()!).agreements, undefined);
  assert.equal(syncRequest.safeParse({ ...pair.link.payload(pair.link.read()!), agreements: undefined, integrity: undefined }).success, true);
  // A version the screen no longer shows is refused (the page reloads and asks again).
  assert.equal((await owner('/staff/license/agreement', { version: AGREEMENT_VERSION + 1 })).status, 409);
  const accepted = (await owner('/staff/license/agreement', { version: AGREEMENT_VERSION })).data.accepted;
  assert.equal(accepted.version, AGREEMENT_VERSION); assert.equal(accepted.name, 'İşletme sahibi');
  assert.equal((await owner('/staff/license/agreement')).data.needed, false);
  assert.deepEqual(pair.link.payload(pair.link.read()!).agreements, [{ tenantId: 'mola-demo', version: AGREEMENT_VERSION, acceptedAt: accepted.acceptedAt, name: 'İşletme sahibi' }]);
  await pair.link.sync();
  const biz = pair.merkezStore.read().businesses.find(b => b.tenantId === 'mola-demo')!;
  assert.equal(biz.agreement?.version, AGREEMENT_VERSION); assert.equal(biz.agreement?.acceptedAt, accepted.acceptedAt);
  const lines = pair.merkezStore.read().audit.filter(a => a.action === 'agreement.accepted' && a.target === 'mola-demo');
  assert.equal(lines.length, 1); assert.equal(lines[0].by, 'cafe');
  assert.equal(pair.link.payload(pair.link.read()!).agreements, undefined, 'sent once');
  // The other business on this computer was not accepted by its owner: still asked there.
  assert.equal(pair.link.agreement('other-demo'), undefined);
});

test('8 Ekim: accepted once, never asked again (heartbeats, Merkez confirming, more looks); a locked owner session is refused until unlocked', async t => {
  const pair = await merkezPair('agreement-repeat', { demo: true }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin();
  const owner = pair.kafe();
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await owner('/staff/license/agreement')).data.needed, true);
  // The idle lock came while the window was open (the owner's report): the server refuses the acceptance with 423, so the
  // window must let the lock screen be reached (src/OwnerLock.tsx opens above it); nothing is kept meanwhile.
  assert.equal((await owner('/staff/lock', {})).status, 200);
  const refused = await owner('/staff/license/agreement', { version: AGREEMENT_VERSION });
  assert.equal(refused.status, 423); assert.equal(refused.data.code, 'SESSION_LOCKED');
  assert.equal(pair.link.agreement('mola-demo'), undefined);
  assert.equal((await owner('/staff/unlock', { password: DEMO_PASSWORD })).status, 200);
  const accepted = (await owner('/staff/license/agreement', { version: AGREEMENT_VERSION })).data.accepted;
  for (let i = 0; i < 3; i++) {
    await pair.link.sync();
    const look = (await owner('/staff/license/agreement')).data;
    assert.equal(look.needed, false, `look ${i + 1}`); assert.deepEqual(look.accepted, accepted);
  }
  assert.equal(pair.link.read()!.agreements!['mola-demo'].sent, true);
  // Signing in again (a new session) does not ask either.
  const again = pair.kafe();
  assert.equal((await again('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await again('/staff/license/agreement')).data.needed, false);
});

test('the window in this tab: "Daha sonra" holds for the sign-in (refreshes too), the next sign-in asks again, an acceptance holds; storage refused works from memory', () => {
  const box = new Map<string, string>(), storage = { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v), removeItem: (k: string) => void box.delete(k) };
  resetAgreementMemory();
  const needed = { needed: true, version: AGREEMENT_VERSION };
  assert.equal(shouldAsk(null, 'isletme', storage), false, 'nothing known yet: no window');
  assert.equal(shouldAsk({ needed: false, version: AGREEMENT_VERSION }, 'isletme', storage), false);
  assert.equal(shouldAsk(needed, 'isletme', storage), true);
  postponeAgreement('isletme', AGREEMENT_VERSION, storage);
  // A refresh reads the same sessionStorage (the in-memory copy is gone after a reload).
  resetAgreementMemory();
  assert.equal(shouldAsk(needed, 'isletme', storage), false, 'postponed for this sign-in');
  assert.equal(shouldAsk(needed, 'baska-sahip', storage), true, 'another owner signing in on this tab is asked');
  assert.equal(shouldAsk({ needed: true, version: AGREEMENT_VERSION + 1 }, 'isletme', storage), true, 'a newer text is asked');
  forgetAgreementLater(storage);
  assert.equal(shouldAsk(needed, 'isletme', storage), true, 'the next sign-in asks again');
  rememberAccepted('isletme', AGREEMENT_VERSION, storage);
  forgetAgreementLater(storage); resetAgreementMemory();
  assert.equal(shouldAsk(needed, 'isletme', storage), false, 'accepted in this tab: not shown again even if an older answer says needed');
  // Storage refused (private window, blocked site data): the same rules from memory.
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
  resetAgreementMemory();
  assert.equal(shouldAsk(needed, 'isletme', broken), true);
  postponeAgreement('isletme', AGREEMENT_VERSION, broken);
  assert.equal(shouldAsk(needed, 'isletme', broken), false);
});
