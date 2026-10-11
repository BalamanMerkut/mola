import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createPrivateKey } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { newSigningPair, signContact } from '../server/license.js';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { BackupScheduler } from '../server/backup-scheduler.js';
import { plainError } from '../server/backup-errors.js';
import { startLocalServer } from '../server/runtime.js';
import { findBackups, secondPlaceRoot } from '../server/second-backup.js';
import { Store } from '../server/store.js';
import type { ApplicationForm } from '../server/sync-protocol.js';
import { pickGroups } from '../src/recovery-groups.js';
import { FAST_KDF, fakeOsLock, type FakeLock } from './fake-os-lock.js';
import { client, licensed, merkezPair, temp } from './merkez-fixture.js';

/* Kurulum ve ilk gün (TOPARLAMA_PLANI Dalga 2): the setup wizard, "İlk adımlar", the recovery code after the owner account, restore. */
process.env.MOLA_APPLICATION_POLL_MS = '0';
process.env.MOLA_BACKUP_DISCOVERY = '0';
const rid = () => randomUUID().replace(/-/g, '');
const form = (name: string): ApplicationForm => ({ businessName: name, sector: 'cafe', contactName: 'Ayşe Yılmaz', consent: true,
  invoice: { legalName: `${name} Gıda Ltd. Şti.`, taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1234567890', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 1', phone: '+905321234567', email: 'ayse@example.com' } });

test('owner account signs in at once; the setup takes fewer tables than 12; "İlk adımlar" ticks from the data and can be put away', async t => {
  const pair = await merkezPair('first-day'); t.after(() => pair.close());
  await pair.adminLogin();
  await pair.link.apply(form('Küçük Kafe'));
  const tenantId = (await pair.admin('/state')).data.businesses[0].tenantId;
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId })).status, 200);
  await pair.link.checkApplication();
  const kafe = pair.kafe();
  const made = await kafe('/activation/owner', { username: 'ayse', password: 'AyseKafe!2026' });
  assert.equal(made.status, 200); assert.equal(made.data.signedIn, true);
  // No second login: the same browser is the owner now, straight into the first setup.
  let s = (await kafe('/staff/state')).data;
  assert.equal(s.role, 'owner'); assert.equal(s.setupCompleted, false); assert.equal(s.tables.length, 12);
  const gone = s.tables[11].token, kept = s.tables[0].token;
  const setup = { requestId: rid(), version: s.businessRevision ?? 0, name: 'Küçük Kafe', tableCount: 3, changeSeconds: 0, commissionBps: null };
  assert.equal((await kafe('/staff/setup', { ...setup, tableCount: 0 })).status, 400);
  assert.equal((await kafe('/staff/setup', setup)).status, 200);
  s = (await kafe('/staff/state')).data;
  assert.deepEqual(s.tables.map((x: { name: string }) => x.name), ['Masa 01', 'Masa 02', 'Masa 03']);
  const store = pair.store; assert.equal(store.read(tenantId).retiredTables, undefined, 'never-used tables simply go');
  assert.equal((await client(pair.kafeBase + '/api')('/guest/session', { token: gone })).status, 404, 'a dropped table\'s QR opens nothing');
  assert.equal((await client(pair.kafeBase + '/api')('/guest/session', { token: kept })).status, 200);
  // A finished setup points to where the name really changes now (no "platform yönetimi").
  const again = await kafe('/staff/setup', { ...setup, requestId: rid(), version: s.businessRevision });
  assert.equal(again.data.code, 'SETUP_COMPLETED'); assert.doesNotMatch(again.data.message, /platform/i); assert.match(again.data.message, /Ayarlar → İşletme → Görünüm/);

  let steps = (await kafe('/staff/first-steps')).data;
  assert.deepEqual(steps, { dismissed: false, steps: { menu: false, staff: false, printer: false, qr: false, recovery: null, second: null } }, 'no key protection here: those two steps are left out');
  assert.equal((await kafe('/staff/users', { username: 'garson.ali', name: 'Ali', role: 'waiter', password: 'GarsonAli!2026' })).status, 200);
  const waiter = pair.kafe(); await waiter('/login', { username: 'garson.ali', password: 'GarsonAli!2026' });
  assert.equal((await waiter('/staff/first-steps')).status, 403, 'owner only');
  store.mutate(tenantId, x => { x.printers = [{ id: randomUUID(), name: 'Kasa', enabled: false, orders: false, bill: false } as never]; });
  steps = (await kafe('/staff/first-steps')).data;
  assert.equal(steps.steps.staff, true); assert.equal(steps.steps.printer, true);
  assert.equal((await kafe('/staff/first-steps', { step: 'menu' })).data.steps.menu, true);
  // The QR step ticks from the real print record (Ayarlar → Masa QR kodları), not from a click on the card.
  assert.equal((await kafe('/staff/first-steps', { step: 'qr' })).status, 400);
  assert.equal((await kafe('/staff/qr-printed', { origin: 'http://192.168.1.20:3000' })).status, 200);
  assert.equal((await kafe('/staff/first-steps')).data.steps.qr, true);
  assert.equal((await kafe('/staff/first-steps', { step: 'nope' })).status, 400);
  assert.equal((await kafe('/staff/first-steps', { step: 'dismiss' })).data.dismissed, true);
  assert.equal((await kafe('/staff/first-steps')).data.dismissed, true, 'stays put away');
});

test('fewer tables in the setup: a busy table stops it, a used one is retired (name kept for history), unused ones go', async t => {
  const directory = temp('setup-tables'), store = new Store(directory); licensed(store);
  const server = createServer(createApp(store)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const owner = client(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`);
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  await owner('/staff/orders', { requestId: rid(), tableId: 'table-12', expectedTotal: 3500, lines: [{ productId: 'tea', quantity: 1, selections: [] }] });
  await owner('/staff/orders', { requestId: rid(), tableId: 'table-11', expectedTotal: 3500, lines: [{ productId: 'tea', quantity: 1, selections: [] }] });
  const base = { version: store.read('mola-demo').businessRevision ?? 0, name: 'Az Masalı', changeSeconds: 0, commissionBps: null };
  const busy = await owner('/staff/setup', { ...base, requestId: rid(), tableCount: 10 });
  assert.equal(busy.status, 409); assert.equal(busy.data.code, 'TABLE_BUSY'); assert.match(busy.data.message, /Masa 12/);
  assert.equal(store.read('mola-demo').tables.length, 12, 'nothing changed');
  // Table 11's bill is settled (closed account, order served); table 12 is cleared completely.
  store.mutate('mola-demo', s => {
    for (const a of s.accounts) { a.status = 'closed'; } for (const o of s.orders) o.status = 'served';
    for (const tb of s.tables) tb.accountId = null;
    const t12 = new Set(s.accounts.filter(a => a.tableId === 'table-12').map(a => a.id));
    s.orders = s.orders.filter(o => !t12.has(o.accountId)); s.accounts = s.accounts.filter(a => a.tableId !== 'table-12');
  });
  const done = await owner('/staff/setup', { ...base, requestId: rid(), tableCount: 10 });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const after = store.read('mola-demo');
  assert.equal(after.tables.length, 10); assert.deepEqual(after.retiredTables?.map(x => x.id), ['table-11']);
});

async function freePort() { const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = (probe.address() as AddressInfo).port; await new Promise<void>(r => probe.close(() => r())); return port; }
async function start(root: string, lock: FakeLock, clean = false) {
  const port = await freePort(), keyFile = join(root, 'masaustu.anahtar');
  const runtime = await startLocalServer({ directory: join(root, 'veri'), port, host: '127.0.0.1', serveBuild: true, cleanInstall: clean, desktopKeyFile: keyFile, keyProtection: { protect: true, osLock: lock, kdf: FAST_KDF } });
  const base = `http://127.0.0.1:${port}`, token = readFileSync(keyFile, 'utf8');
  const call = async (path: string, body?: unknown, desktop = true) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(desktop ? { 'X-Mola-Desktop': token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => ({})) as any };
  };
  return { runtime, call };
}

test('recovery code: "Kaydettim" needs two groups of the code (or the whole code after a restart); no owner yet on a clean install', async () => {
  const root = temp('recovery-groups');
  let cafe = await start(root, fakeOsLock());
  try {
    assert.equal((await cafe.call('/api/desktop/status')).data.security.owner, true, 'the demo café has owners');
    const code: string = (await cafe.call('/api/desktop/recovery/show', {})).data.code, parts = code.split('-');
    const wrong = await cafe.call('/api/desktop/recovery/confirm', { groups: [{ group: 2, value: parts[2] }, { group: 5, value: parts[4] }] });
    assert.equal(wrong.status, 400); assert.equal(wrong.data.code, 'WRONG_GROUPS');
    assert.equal((await cafe.call('/api/desktop/recovery/confirm', { groups: [{ group: 2, value: parts[1] }, { group: 2, value: parts[1] }] })).status, 400, 'the same group twice is not two');
    assert.equal((await cafe.call('/api/desktop/recovery')).data.confirmed, false);
    const ok = await cafe.call('/api/desktop/recovery/confirm', { groups: [{ group: 2, value: parts[1].toLowerCase() }, { group: 6, value: parts[5] }] });
    assert.equal(ok.status, 200); assert.equal(ok.data.confirmed, true);
    // A new code, shown, then the server restarts before "Kaydettim": the whole code from paper confirms it.
    const renewed: string = (await cafe.call('/api/desktop/recovery/new', { password: DEMO_PASSWORD })).data.code;
    await cafe.runtime.close();
    cafe = await start(root, fakeOsLock());
    const view = (await cafe.call('/api/desktop/recovery')).data;
    assert.equal(view.available, false); assert.equal(view.confirmed, false);
    assert.equal((await cafe.call('/api/desktop/recovery/confirm', { groups: [{ group: 1, value: renewed.slice(0, 4) }, { group: 2, value: renewed.slice(5, 9) }] })).data.code, 'NO_CODE');
    assert.equal((await cafe.call('/api/desktop/recovery/confirm', { code })).data.code, 'WRONG_CODE', 'the old code is not this one');
    assert.equal((await cafe.call('/api/desktop/recovery/confirm', { code: renewed })).data.confirmed, true);
  } finally { await cafe.runtime.close(); }
  const fresh = await start(temp('recovery-clean'), fakeOsLock(), true);
  try {
    const security = (await fresh.call('/api/desktop/status')).data.security;
    assert.equal(security.owner, false); assert.equal(security.recoveryAvailable, true, 'the code waits for the owner account');
  } finally { await fresh.runtime.close(); }
});

test('locked data: the Mola team\'s contact is still answered (null when none saved, the signed one when kept)', async () => {
  const root = temp('locked-contact'), pair = newSigningPair(), saved = process.env.MOLA_MERKEZ_PUBLIC_KEY;
  process.env.MOLA_MERKEZ_PUBLIC_KEY = pair.publicKey;
  try {
    const first = await start(root, fakeOsLock('eski-windows'));
    await first.call('/api/desktop/recovery/show', {}); await first.call('/api/desktop/recovery/confirm', {});
    await first.runtime.close();
    let locked = await start(root, fakeOsLock('yeni-windows'));
    assert.equal(locked.runtime.vault().state, 'locked');
    assert.deepEqual((await locked.call('/api/contact', undefined, false)).data, { contact: null });
    assert.equal((await locked.call('/api/staff/state', undefined, false)).status, 423, 'everything else stays locked');
    await locked.runtime.close();
    const claims = { v: 1 as const, updatedAt: new Date().toISOString(), phone: '0850 123 45 67', whatsapp: '', email: 'destek@mola.example', hours: 'Hafta içi 09:00–18:00', web: '' };
    writeFileSync(join(root, 'veri', 'mola-iletisim.json'), JSON.stringify(signContact(claims, createPrivateKey({ key: Buffer.from(pair.privateKey, 'base64'), format: 'der', type: 'pkcs8' }))));
    locked = await start(root, fakeOsLock('yeni-windows'));
    assert.deepEqual((await locked.call('/api/contact', undefined, false)).data.contact, { phone: '0850 123 45 67', whatsapp: '', email: 'destek@mola.example', hours: 'Hafta içi 09:00–18:00', web: '' });
    await locked.runtime.close();
  } finally { if (saved === undefined) delete process.env.MOLA_MERKEZ_PUBLIC_KEY; else process.env.MOLA_MERKEZ_PUBLIC_KEY = saved; }
});

test('two groups to type: always two different numbers 1–6, in order', () => {
  for (const r of [0, 0.2, 0.5, 0.99]) for (const q of [0, 0.4, 0.99]) {
    let n = 0; const [a, b] = pickGroups(() => (n++ === 0 ? r : q));
    assert.ok(a >= 1 && b <= 6 && a < b, `${a},${b}`);
  }
});

test('restore list: newest checked backup first, with size and where it is; this install\'s own copies are left out; the second place is kept after a restore', async () => {
  const oldRoot = temp('restore-list-old');
  const old = await start(oldRoot, fakeOsLock('eski-pc'));
  const flash = join(oldRoot, 'flash'); mkdirSync(flash);
  let code = '';
  try {
    code = (await old.call('/api/desktop/recovery/show', {})).data.code; await old.call('/api/desktop/recovery/confirm', {});
    assert.equal((await old.call('/api/desktop/second-backup', { folder: flash, kind: 'usb', label: 'Flash bellek' })).status, 200);
    assert.equal((await old.call('/api/desktop/backup', {})).data.lastError, null);
    assert.equal((await old.call('/api/desktop/backup', {})).data.lastError, null);
  } finally { await old.runtime.close(); }
  // An unchecked newer copy (verification record missing) must not be the one picked.
  const copies = join(flash, 'Mola-Yedek'), install = readdirSync(copies).find(n => /^[a-f0-9-]{36}$/.test(n))!;
  const names = readdirSync(join(copies, install)).filter(n => n.startsWith('backup-')).sort();
  rmSync(join(copies, install, names[1], 'verification.json'));
  assert.equal(secondPlaceRoot(join(copies, install, names[0])), flash);

  const newRoot = temp('restore-list-new');
  const fresh = await start(newRoot, fakeOsLock('yeni-pc'), true);
  try {
    // A clean install makes no automatic backup of its empty data, and lists none of its own.
    const own = await fresh.call('/api/desktop/backup', {}); assert.equal(own.status, 200);
    const list = (await fresh.call(`/api/desktop/restore/backups?folder=${encodeURIComponent(flash)}`)).data.backups as { path: string; verified: boolean; source: string; bytes: number; installId: string }[];
    assert.equal(list.length, 2, JSON.stringify(list));
    assert.equal(list[0].verified, true); assert.ok(list[0].path.endsWith(names[0])); assert.equal(list[1].verified, false);
    assert.ok(list.every(b => b.source === 'second' && b.bytes > 1000 && b.installId === install));
    assert.equal((await fresh.call('/api/desktop/restore', { backup: list[0].path, code })).status, 200);
    const second = (await fresh.call('/api/desktop/second-backup')).data;
    assert.equal(second.folder, flash, 'the flash drive the backup came from stays the second place');
    assert.equal((await fresh.call('/api/desktop/backup', {})).data.lastError, null);
    assert.equal(readdirSync(join(copies, install)).filter(n => n.startsWith('backup-')).length, 3, 'the next backup goes on to the same drive');
  } finally { await fresh.runtime.close(); }
});

test('backups: "Şimdi yedekle" during a running backup waits for it; a clean install skips the automatic run; errors are plain Turkish', async () => {
  const root = temp('scheduler-wait'), data = join(root, 'veri');
  const store = new Store(data, ['mola-demo']); store.close();
  const scheduler = new BackupScheduler(data, { backups: join(root, 'backups'), keys: join(root, 'keys'), checks: join(root, 'checks') });
  const [a, b] = await Promise.all([scheduler.runNow(), scheduler.runNow()]);
  assert.equal(a.lastError, undefined); assert.equal(b.running, false); assert.equal(a.lastSuccessAt, b.lastSuccessAt, 'the second call got the finished run, not "running"');
  assert.equal(readdirSync(join(root, 'backups')).filter(n => n.startsWith('backup-')).length, 1);
  // A catch-up run planned for 2 minutes after start is dropped once a manual backup succeeds.
  let time = Date.parse('2026-10-04T10:00:00'); const later = new BackupScheduler(data, { backups: join(root, 'b2'), keys: join(root, 'k2'), checks: join(root, 'c2'), idle: () => false }, () => new Date(time));
  await later.start(); assert.equal(Date.parse(later.status().nextRunAt!), time + 2 * 60000);
  await later.runNow(); later.stop();
  assert.equal(new Date(later.status().nextRunAt!).getHours(), 3, 'next is tonight\'s');
  assert.equal(plainError(Object.assign(new Error('ENAMETOOLONG: name too long, open \'C:\\…\''), { code: 'ENAMETOOLONG' })), 'Klasör yolu çok uzun. Yedeği kısa bir klasöre (ör. D:\\Mola-Yedek) kopyalayıp yeniden deneyin.');
  assert.equal(plainError(new Error('file is not a database'), 'X'), 'X');
  assert.equal(plainError(new Error('Yedek bütünlüğü doğrulanamadı.')), 'Yedek bütünlüğü doğrulanamadı.');
  assert.match(plainError(Object.assign(new Error('x'), { code: 'ERR_SQLITE_ERROR' })), /yedek bozuk/);
  const found = await findBackups([{ path: join(root, 'backups'), label: 'Bu bilgisayar', source: 'local' }]);
  assert.equal(found.length, 0, 'unprotected backups (raw key file) are not offered for a code restore');
});
