import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { DEMO_PASSWORD } from '../server/app.js';
import { keepQr } from '../server/demo-reset.js';
import { demoProducts, demoTables } from '../server/demo-template-data.js';
import { HEADER, responseSignature } from '../server/install-auth.js';
import { MerkezLink } from '../server/kafe-link.js';
import { publicKeyFrom } from '../server/license.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { DEMO_STAFF_PASSWORD, signNote, verifyNote } from '../server/signed-notes.js';
import type { Store } from '../server/store.js';
import { merkezPair } from './merkez-fixture.js';

const rid = () => randomUUID().replace(/-/g, '');
const otherKey = () => generateKeyPairSync('ed25519').privateKey;
const rows = (pair: { store: Store }, table: string, tenant: string) => Number((pair.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant=?`).get(tenant) as { n: number }).n);
async function until(check: () => boolean, what: string) { for (let i = 0; i < 400 && !check(); i++) await new Promise(r => setTimeout(r, 25)); assert.ok(check(), what); }

test('Tanıtım işletmesi: only a business Merkez marked (signed), only by hand, backup first; orders, history, cash, stock and notifications go; staff, licence and audit stay; the table QRs stay the same (printed once, reused at every demo)', async t => {
  let time = Date.parse('2026-10-05T09:00:00Z');
  const pair = await merkezPair('demo-reset', { demo: true, now: () => new Date(time) }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin(); assert.equal((await pair.link.sync()).ok, true);
  const owner = pair.kafe(), waiter = pair.kafe();
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  await waiter('/login', { username: 'garson', password: DEMO_PASSWORD });
  // Not a demo yet: no label, no reset from either side.
  assert.equal((await owner('/staff/demo')).data.demo, false); assert.equal((await owner('/staff/state')).data.demo, undefined);
  assert.equal((await owner('/staff/demo/reset', { sector: 'cafe', demoPassword: false, confirm: 'SIFIRLA' })).data.code, 'NOT_DEMO');
  assert.equal((await pair.admin('/demo/reset', { requestId: rid(), tenantId: 'mola-demo', sector: 'cafe', demoPassword: false, confirm: 'SIFIRLA' })).data.code, 'NOT_DEMO');

  // A business with a past: a paid table (moved to history after 6 hours), an expense, a cash opening and a few other records.
  const state = (await owner('/staff/state')).data, oldTables = state.tables as { id: string; token: string }[], staffBefore = (await owner('/staff/users')).data.map((u: any) => u.id).sort();
  const placed = await waiter('/staff/orders', { requestId: randomUUID(), tableId: oldTables[0].id, lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 });
  assert.equal(placed.status, 200, JSON.stringify(placed.data));
  const account = (await owner('/staff/state')).data.tables.find((x: any) => x.account?.id === placed.data.accountId).account;
  assert.equal((await owner('/staff/payments', { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'cash', amount: 7000, tendered: 7000 })).status, 200);
  assert.equal((await owner('/staff/expenses', { requestId: randomUUID(), amount: 2500, description: 'Buz', method: 'cash' })).status, 200);
  // A closed table with an order not yet served leaves the floor after 24 hours.
  time += 25 * 3600_000;
  const relogin = await owner('/login', { username: 'isletme', password: DEMO_PASSWORD }); assert.equal(relogin.status, 200, JSON.stringify(relogin.data));
  const opened = await owner('/staff/cash/open', { requestId: randomUUID(), amount: 5000 }); assert.equal(opened.status, 200, JSON.stringify(opened.data));
  for (const tenant of ['mola-demo', 'other-demo']) {
    pair.store.db.prepare('INSERT INTO stock_records (tenant,kind,id,at,payload) VALUES (?,?,?,?,?)').run(tenant, 'item', randomUUID(), time, Buffer.from('x'));
    pair.store.db.prepare('INSERT INTO agenda_notes (tenant,id,day,due,payload) VALUES (?,?,?,?,?)').run(tenant, randomUUID(), '2026-10-05', null, Buffer.from('x'));
  }
  assert.ok(rows(pair, 'history_archives', 'mola-demo') > 0, 'the paid table is in history'); assert.ok(rows(pair, 'cash_records', 'mola-demo') > 0);
  const auditBefore = rows(pair, 'history_audit', 'mola-demo'); assert.ok(auditBefore > 0);

  // The vendor marks it "Tanıtım işletmesi": it reaches the café signed; staff screens and the guest menu say "Tanıtım".
  await pair.adminLogin(); await pair.link.sync();
  assert.equal((await pair.admin('/demo', { requestId: rid(), tenantId: 'mola-demo', demo: true })).status, 200);
  assert.equal((await owner('/staff/state')).data.demo, undefined, 'nothing before the heartbeat');
  await pair.link.sync();
  assert.equal((await owner('/staff/state')).data.demo, true); assert.equal((await owner('/staff/demo')).data.demo, true);
  const guest = pair.kafe(); await guest('/guest/session', { token: oldTables[1].token });
  assert.equal((await guest('/guest/state')).data.demo, true);
  // A forged word (another key) never makes a business a demo.
  (pair.link as any).write((r: any) => { r.demo['other-demo'] = signNote('mola-tanitim-1', { v: 1, installId: r.installId, tenantId: 'other-demo', demo: true, issuedAt: new Date(time).toISOString() }, otherKey()); });
  assert.equal(pair.link.isDemo('other-demo'), false);

  // "Tanıtımı sıfırla" in Mola Yönetim: typed SIFIRLA, one pending order; the café does nothing until its heartbeat.
  assert.equal((await pair.admin('/demo/reset', { requestId: rid(), tenantId: 'mola-demo', sector: 'restaurant', demoPassword: false, confirm: 'evet' })).data.code, 'CONFIRM');
  const ordered = await pair.admin('/demo/reset', { requestId: rid(), tenantId: 'mola-demo', sector: 'restaurant', demoPassword: false, confirm: 'SIFIRLA' });
  assert.equal(ordered.status, 200, JSON.stringify(ordered.data));
  assert.equal((await pair.admin('/demo/reset', { requestId: rid(), tenantId: 'mola-demo', sector: 'cafe', demoPassword: false, confirm: 'SIFIRLA' })).data.code, 'DEMO_PENDING');
  assert.equal((await owner('/staff/state')).data.tables[0].token, oldTables[0].token, 'manual: nothing happens by itself');
  await pair.link.sync();
  await until(() => !!pair.link.read()?.demoDone?.includes(ordered.data.resetId), 'the café carried out the signed order');

  // Backup first (no nightly backup in tests: a copy of the database and key beside the data folder).
  const kafeDir = pair.store.directory, copies = readdirSync(dirname(kafeDir)).filter(n => n.startsWith(`${basename(kafeDir)}-tanitim-oncesi-`));
  assert.equal(copies.length, 1); assert.ok(existsSync(join(dirname(kafeDir), copies[0], 'merchant.sqlite'))); assert.ok(existsSync(join(dirname(kafeDir), copies[0], 'development.key')));
  // The template's 16 tables; the 12 the business had keep their ids and QR tokens (Masa 01–12), only Masa 13–16 are new.
  // Staff and licence kept; this business's records gone, the other business untouched.
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  const after = (await owner('/staff/state')).data;
  assert.equal(after.sector, 'restaurant'); assert.equal(after.tables.length, 16); assert.equal(after.products.length, demoProducts('restaurant').length);
  assert.deepEqual([...new Set(after.tables.map((x: any) => x.area))], ['İç salon', 'Bahçe', 'Teras']);
  assert.equal(oldTables.length, 12);
  assert.deepEqual(after.tables.slice(0, 12).map((x: any) => [x.id, x.token]), oldTables.map(o => [o.id, o.token]), 'every printed QR stays');
  assert.equal(after.tables.slice(12).some((x: any) => oldTables.some(o => o.token === x.token || o.id === x.id)), false, 'only the added tables get a QR');
  assert.equal(after.orders.length, 0); assert.equal(after.tables.some((x: any) => x.account), false);
  assert.deepEqual((await owner('/staff/users')).data.map((u: any) => u.id).sort(), staffBefore, 'staff accounts stay');
  assert.equal(pair.link.active('mola-demo'), true, 'the licence stays');
  // (history_days is a cache of day totals: rebuilt at once from the empty history.)
  for (const table of ['history_archives', 'history_ledger', 'history_payments', 'cash_records', 'stock_records', 'agenda_notes']) assert.equal(rows(pair, table, 'mola-demo'), 0, table);
  for (const table of ['stock_records', 'agenda_notes']) assert.equal(rows(pair, table, 'other-demo'), 1, `${table} of the other business`);
  assert.ok(rows(pair, 'history_audit', 'mola-demo') > auditBefore, 'the audit trail stays and gains the reset');
  assert.ok(pair.store.auditLog('mola-demo').some(a => a.action === 'demo.reset_by_merkez'));
  const inbox = (await owner('/staff/notifications')).data.items;
  assert.deepEqual(inbox.map((n: any) => n.kind), ['demo'], 'old notifications go; the reset leaves one'); assert.match(inbox[0].text, /Restoran şablonu yüklendi/);
  assert.match(inbox[0].text, /QR kodları değişmedi/); assert.match(inbox[0].text, /4 yeni masanın QR/);
  assert.equal((await owner('/staff/reports/overview?from=2026-10-05&to=2026-10-05')).data.sales, 0, 'reports start over (no cached day left)');
  // The old printed QR still opens the menu; a guest still on the old menu sees the session ended (not "Bu tanıtım yenilendi").
  const scan = await pair.kafe()('/guest/session', { token: oldTables[0].token });
  assert.equal(scan.status, 200, JSON.stringify(scan.data)); assert.equal(scan.data.tableId, oldTables[0].id);
  const stale = await guest('/guest/state'); assert.equal(stale.status, 200, JSON.stringify(stale.data)); assert.notEqual(stale.data.code, 'DEMO_RENEWED');
  assert.equal((await pair.kafe()('/guest/session', { token: after.tables[15].token })).status, 200);
  // Only a token that truly no longer exists (renewed by a reset before 5 Oct 2026, kept in demo_retired_qr) says "Bu tanıtım yenilendi".
  const gone = 'eski-tanitim-qr-0001';
  pair.store.db.prepare('INSERT INTO demo_retired_qr (token,tenant,at) VALUES (?,?,?)').run(createHmac('sha256', pair.store.key).update('mola:demo-retired-qr:v1\0').update(gone).digest('hex'), 'mola-demo', time);
  const retired = await pair.kafe()('/guest/session', { token: gone });
  assert.equal(retired.status, 410); assert.equal(retired.data.code, 'DEMO_RENEWED'); assert.match(retired.data.message, /^Bu tanıtım yenilendi/);
  // Mola Merkez hears it with the next heartbeat: the order is done, history and an alert.
  await pair.link.sync();
  let merkez = (await pair.admin('/state')).data, biz = merkez.businesses.find((b: any) => b.tenantId === 'mola-demo');
  assert.equal(biz.demoReset.status, 'done'); assert.equal(biz.demo, true);
  assert.ok(merkez.audit.some((a: any) => a.action === 'demo.reset_done' && a.target === 'mola-demo'));
  assert.ok(merkez.alerts.some((a: any) => a.kind === 'demo.reset' && /tanıtım sıfırlandı \(Restoran şablonu, Mola Yönetim\)/.test(a.text)));
  // Done once: more heartbeats do not reset again.
  const tokens = after.tables.map((x: any) => x.token).join();
  await pair.link.sync(); await pair.link.sync();
  assert.equal((await owner('/staff/state')).data.tables.map((x: any) => x.token).join(), tokens);

  // The owner's own reset (Ayarlar → Güvenlik ve diğer): typed SIFIRLA, the demo password for the staff (not the owner).
  assert.equal((await owner('/staff/demo/reset', { sector: 'cafe', demoPassword: true, confirm: 'yanlış' })).data.code, 'CONFIRM');
  await waiter('/login', { username: 'garson', password: DEMO_PASSWORD });
  assert.equal((await waiter('/staff/demo/reset', { sector: 'cafe', demoPassword: true, confirm: 'SIFIRLA' })).status, 403, 'owner only');
  const own = await owner('/staff/demo/reset', { sector: 'cafe', demoPassword: true, confirm: 'sıfırla' });
  assert.equal(own.status, 200, JSON.stringify(own.data)); assert.equal(own.data.newQr, 0);
  const again = (await owner('/staff/state')).data; assert.equal(again.sector, 'cafe');
  assert.equal(again.tables.map((x: any) => `${x.id}:${x.token}`).join(), after.tables.map((x: any) => `${x.id}:${x.token}`).join(), 'a second reset (another template) keeps every QR');
  assert.equal((await pair.kafe()('/login', { username: 'garson', password: DEMO_PASSWORD })).status, 401);
  assert.equal((await pair.kafe()('/login', { username: 'garson', password: DEMO_STAFF_PASSWORD })).status, 200);
  assert.equal((await pair.kafe()('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200, 'the owner keeps their password');
  await pair.link.sync();
  merkez = (await pair.admin('/state')).data;
  assert.ok(merkez.audit.some((a: any) => a.action === 'demo.reset_by_owner' && /Kafe şablonu · işletme sahibi/.test(a.detail)));

  // An order the café never heard of in time (off for more than 3 days) is not carried out later.
  assert.equal((await pair.admin('/demo/reset', { requestId: rid(), tenantId: 'mola-demo', sector: 'dessert', demoPassword: false, confirm: 'SIFIRLA' })).status, 200);
  time += 4 * 86400_000; await pair.adminLogin(); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  const before = (await owner('/staff/state')).data.tables.map((x: any) => x.token).join();
  await pair.link.sync(); await new Promise(r => setTimeout(r, 300));
  assert.equal((await owner('/staff/state')).data.tables.map((x: any) => x.token).join(), before, 'no reset');
  biz = (await pair.admin('/state')).data.businesses.find((b: any) => b.tenantId === 'mola-demo'); assert.equal(biz.demoReset.status, 'expired');

  // Turned off: the label goes with the next heartbeat; resets are refused on both sides.
  assert.equal((await pair.admin('/demo', { requestId: rid(), tenantId: 'mola-demo', demo: false })).status, 200);
  await pair.link.sync();
  assert.equal((await owner('/staff/state')).data.demo, undefined);
  assert.equal((await owner('/staff/demo/reset', { sector: 'cafe', demoPassword: false, confirm: 'SIFIRLA' })).data.code, 'NOT_DEMO');
});

test('Tanıtım QR\'ları sabit: a template table keeps the QR of the same name or number; more tables than the template stay; takeaway/event ones do not count', () => {
  const table = (name: string, extra: object = {}) => ({ id: `id-${name}`, name, token: `tok-${name}`, epoch: 3, accountId: null, ...extra });
  const old = [...Array.from({ length: 18 }, (_, i) => table(`Masa ${i + 1}`)), table('Paket 1', { takeaway: { number: 1, day: '2026-10-05' } }), table('Etkinlik', { event: { id: 'e' } }), table('Bahçe köşe')];
  const kept = keepQr(old as any, demoTables());
  assert.equal(kept.length, 16 + 2 + 1, 'Masa 17, 18 and "Bahçe köşe" stay with their QRs');
  assert.deepEqual(kept.slice(0, 16).map(t => [t.name, t.id, t.token, t.epoch]), Array.from({ length: 16 }, (_, i) => [`Masa ${String(i + 1).padStart(2, '0')}`, `id-Masa ${i + 1}`, `tok-Masa ${i + 1}`, 4]));
  assert.deepEqual(kept.slice(16).map(t => t.token), ['tok-Masa 17', 'tok-Masa 18', 'tok-Bahçe köşe']);
  assert.equal(kept.some(t => t.takeaway || t.event), false);
  // Fewer tables than the template: the existing ones keep theirs, only the rest get new tokens.
  const few = keepQr([table('Masa 01'), table('Masa 02')] as any, demoTables());
  assert.deepEqual(few.slice(0, 2).map(t => t.token), ['tok-Masa 01', 'tok-Masa 02']); assert.equal(few.length, 16);
  assert.equal(new Set(few.map(t => t.token)).size, 16);
});

test('Merkez adresi: a signed announcement moves the café only after the new address proves the same key and install; unsigned or foreign ones change nothing', async t => {
  const pair = await merkezPair('address', { demo: true }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin(); await pair.link.sync();
  const oldUrl = pair.link.url, secret = pair.link.read()!.secret;
  // The same Merkez data and key on a second address (the restored copy on the VDS).
  const moved = createServer(createMerkezApp(pair.merkezStore, {}));
  await new Promise<void>(r => moved.listen(0, '127.0.0.1', r)); t.after(() => new Promise<void>(r => { moved.closeAllConnections(); moved.close(() => r()); }));
  const newUrl = `http://127.0.0.1:${(moved.address() as AddressInfo).port}`;
  // A café whose answers can be tampered with (signed again with the install secret, as only a real Merkez could).
  let tamper: ((path: string, body: any, sent: any) => any) | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input), path = new URL(url).pathname;
    if (!tamper) return fetch(input, init);
    const sent = JSON.parse(String(init?.body ?? '{}')), nonce = new Headers(init?.headers).get(HEADER.nonce)!;
    // The proof call goes nowhere real (the made-up address); everything else reaches the real Merkez first.
    const real = path.endsWith('/address/proof') ? undefined : await fetch(input, init), text = real && real.ok ? await real.text() : '{}';
    const body = tamper(path, JSON.parse(text), sent); if (body === undefined) return new Response(text, { status: real?.status ?? 503, headers: real?.headers });
    const out = JSON.stringify(body);
    return new Response(out, { status: 200, headers: { 'Content-Type': 'application/json', 'x-mola-server-time': new Date().toISOString(), [HEADER.signature]: responseSignature(secret, nonce, out) } });
  };
  const link = new MerkezLink(pair.store, { url: pair.merkezBase, publicKey: publicKeyFrom(pair.merkezStore.publicKey), machineId: 'a'.repeat(64), machineKey: 'test:kasa-pc', fetch: fetcher });

  // 1. An unsigned / foreign announcement in a (genuine) answer: ignored.
  tamper = (path, body) => path.endsWith('/sync') ? { ...body, address: signNote('mola-adres-1', { v: 1, url: newUrl, issuedAt: new Date().toISOString() }, otherKey()) } : undefined;
  assert.equal((await link.sync()).ok, true);
  assert.equal(link.read()!.address, undefined); assert.equal(link.url, oldUrl);
  // 2. Merkez's own announcement, but the new address answers with another key: stays, and says why.
  assert.equal((await pair.admin('/address', { requestId: rid(), url: 'https://merkez-yeni.example.com' })).status, 200);
  tamper = (path, body, sent) => path.endsWith('/address/proof') ? { proof: signNote('mola-adres-kanit-1', { v: 1, installId: link.read()!.installId, nonce: sent.nonce, url: sent.url, serverTime: new Date().toISOString() }, otherKey()) } : undefined;
  await link.sync();
  assert.equal(link.read()!.address?.state, 'failed'); assert.equal(link.url, oldUrl);
  // 3. The right key but the proof is for another request (an old nonce): stays.
  tamper = (path, body, sent) => path.endsWith('/address/proof') ? { proof: signNote('mola-adres-kanit-1', { v: 1, installId: link.read()!.installId, nonce: 'f'.repeat(32), url: sent.url, serverTime: new Date().toISOString() }, (pair.merkezStore as any).signingKey) } : undefined;
  await link.sync();
  assert.equal(link.read()!.address?.state, 'failed'); assert.equal(link.url, oldUrl);
  // 4. The real move: the announced address is our own Merkez's copy; it proves itself and the café switches (and stays).
  tamper = undefined;
  assert.equal((await pair.admin('/address', { requestId: rid(), url: newUrl })).status, 200);
  assert.equal((await link.sync()).ok, true);
  assert.equal(link.url, newUrl, JSON.stringify(link.read()!.address)); assert.equal(link.read()!.address?.state, 'switched'); assert.equal(link.read()!.address?.from, oldUrl);
  assert.ok(link.read()!.audit.some(a => a.action === 'merkez.address_changed'));
  assert.equal((await link.sync()).ok, true, 'the next heartbeat goes to the new address');
  assert.equal(link.addressStatus().url, newUrl);
  // The proof itself: bound to the install, the nonce and the address, signed by Merkez's key.
  assert.throws(() => verifyNote('mola-adres-kanit-1', signNote('mola-adres-kanit-1', { v: 1, installId: 'x', nonce: 'a'.repeat(32), url: newUrl, serverTime: new Date().toISOString() }, otherKey()), publicKeyFrom(pair.merkezStore.publicKey)), /imzası geçersiz/);
  // Merkez's history says so.
  assert.ok((await pair.admin('/state')).data.audit.some((a: any) => a.action === 'merkez.address_announced' && a.detail === newUrl));
});
