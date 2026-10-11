import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { KeyVault, adoptKey } from '../server/key-vault.js';
import { BackupScheduler } from '../server/backup-scheduler.js';
import { ChangeMarker } from '../server/change-marker.js';
import { CloudBackup, CloudRestore, backupFiles, type CloudLink } from '../server/cloud-backup.js';
import { restoreBackup } from '../server/backup.js';
import { MerkezLink } from '../server/kafe-link.js';
import { publicKeyFrom } from '../server/license.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { MerkezStore } from '../server/merkez/store.js';
import { BackupVault, cloudWarning, LARGE_BYTES, retained, sweepVault } from '../server/merkez/backup-vault.js';
import { DomainError } from '../packages/domain/engine.js';
import { FAST_KDF, assertNoSecrets, fakeOsLock } from './fake-os-lock.js';
import { client, MERKEZ_PASSWORD, temp } from './merkez-fixture.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const rid = () => randomUUID().replace(/-/g, '');
const NAME = 'Bulut Kafe Deneme';
async function listen(server: Server) { await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }
const walk = (dir: string): string[] => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]) : [];

/**
 * A real Mola Merkez on a free port and a protected café ("eski-pc") registered at it, with nightly backups and the cloud copy.
 * `spy` sees (and may break) every call the cloud copy makes.
 */
async function world(name: string, options: { spy?: (path: string, body: any) => void; chunk?: number; binary?: boolean; oldMerkez?: boolean; changes?: boolean } = {}) {
  const dir = temp(name), clock = { t: Date.now() }, now = () => new Date(clock.t);
  const merkezStore = new MerkezStore(join(dir, 'merkez'), randomBytes(32), { initialPassword: MERKEZ_PASSWORD });
  const merkezApp = createMerkezApp(merkezStore, { now, cloudBackupMinFreeBytes: 0 }), server = createServer(merkezApp), base = await listen(server);
  const vaultDir = join(dir, 'merkez-sunucu-yedekleri'), merkezVault = merkezApp.locals.backupVault as BackupVault;
  const admin = client(`${base}/api/merkez/admin`); await admin('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  const publicKey = publicKeyFrom(merkezStore.publicKey);
  const stores: Store[] = [];
  /** A protected café computer with one business, registered at Merkez like `merkez:import` does. */
  async function cafe(folder: string, tenant: string, title: string, machine: string) {
    const data = join(dir, folder, 'veri'), vault = await KeyVault.open(data, { protect: true, osLock: fakeOsLock(machine), kdf: FAST_KDF });
    const code = vault.reveal(); vault.confirm();
    const store = new Store(data, [tenant], { key: vault.key! }); stores.push(store);
    store.mutate(tenant, s => { s.name = title; });
    const link = new MerkezLink(store, { now, url: base, publicKey, machineKey: `test:${machine}` });
    const r = await admin('/import', { requestId: rid(), businesses: [{ tenantId: tenant, name: title, license: { endsAt: new Date(clock.t + 365 * 86400000).toISOString(), suspended: false, kind: 'subscription', planMonths: 12 } }] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    link.adopt(r.data);
    assert.equal((await link.sync()).ok, true);
    const folders = { backups: join(dir, folder, 'backups'), keys: join(dir, folder, 'keys'), checks: join(dir, folder, 'checks') };
    // `binary`: this café can send raw pieces (postBytes); `oldMerkez`: its Merkez does not list 'cloud.backup.binary'.
    const cloudLink: CloudLink = { ready: () => link.relayReady(), accepts: () => link.read()?.accepts?.filter(a => !options.oldMerkez || a !== 'cloud.backup.binary'), post: (path, body, timeout) => { options.spy?.(path, body); return link.relayPost(path, body, timeout); },
      ...(options.binary ? { postBytes: <T,>(path: string, data: Buffer, timeout?: number) => { options.spy?.(path, { data }); return link.relayPostBytes<T>(path, data, timeout); } } : {}) };
    const cloud = new CloudBackup(join(folders.backups, 'sunucu-yedegi.json'), cloudLink, { now, retryDelays: [], chunkRetryMs: [], chunkBytes: options.chunk ?? 16 * 1024 });
    const changes = options.changes ? new ChangeMarker(store.db, now) : undefined;
    const scheduler = new BackupScheduler(data, { ...folders, protection: () => vault.backupProtection(), cloud, changes }, now);
    return { data, vault, code, store, link, cloud, scheduler, folders, changes, installId: r.data.installId as string, tenant };
  }
  return {
    dir, clock, now, base, merkezStore, merkezApp, merkezVault, vaultDir, admin, publicKey, cafe,
    async close() { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); (merkezApp.locals.relayHub as { close(): void }).close(); for (const s of stores) s.close(); merkezStore.close(); },
  };
}

test('after a verified backup the encrypted copy goes to Mola Merkez in chunks, byte for byte, and Merkez holds only ciphertext', async () => {
  const calls: string[] = [];
  const w = await world('cloud-upload', { spy: path => calls.push(path) });
  try {
    const a = await w.cafe('eski', 'bulut-a', NAME, 'eski-pc');
    assert.ok(a.link.read()?.accepts?.includes('cloud.backup'), 'this Merkez says it keeps copies');
    const s = await a.scheduler.runNow(); assert.equal(s.lastError, undefined, s.lastError);
    await a.scheduler.uploading;
    const status = a.cloud.status();
    assert.equal(status.lastError, undefined, status.lastError); assert.ok(status.lastSuccessAt); assert.equal(status.copies, 1); assert.ok(status.bytes! > 0);
    assert.ok(calls.filter(c => c === '/cloud-backup/chunk').length > 3, 'several chunks');
    // Merkez's copy: the same files as the local backup (without the local proof record), each blob byte for byte.
    const local = s.lastDirectory!, files = await backupFiles(local), copies = w.merkezVault.copies(a.installId);
    assert.equal(copies.length, 1); assert.equal(copies[0].id, local.split(/[\\/]/).at(-1));
    assert.deepEqual(copies[0].files.map(f => f.name).sort(), files.map(f => f.name).sort());
    assert.ok(!files.some(f => f.name === 'verification.json' || f.name.endsWith('.key')));
    for (const f of files) assert.equal(sha(readFileSync(join(w.vaultDir, a.installId, 'parcalar', f.sha256))), sha(readFileSync(join(local, f.name))), f.name);
    // The same backup again: nothing travels (Merkez already has it).
    calls.length = 0; await a.cloud.upload(local, true);
    assert.deepEqual(calls, ['/cloud-backup/begin']);
    // Bandwidth: the nightly run right after a copy went up does not upload again; Gün sonu (and "Şimdi yedekle") always does.
    w.clock.t += 60_000; calls.length = 0; await a.scheduler.runNow('auto'); await a.scheduler.uploading;
    assert.equal(calls.length, 0, calls.join());
    w.clock.t += 60_000; a.scheduler.afterDayClose(10); await new Promise(r => setTimeout(r, 60)); await a.scheduler.runNow(); await a.scheduler.uploading;
    assert.ok(calls.includes('/cloud-backup/commit'), 'Gün sonu uploads');
    assert.equal(w.merkezVault.copies(a.installId).length, 1, 'one copy a day: the newest of the day replaces the earlier one');
    // Scan: no business name, no SQLite page, no key, no code anywhere on Merkez's side.
    assertNoSecrets(w.vaultDir, a.vault.key!, [a.code]);
    for (const file of walk(w.vaultDir)) {
      const data = readFileSync(file);
      for (const needle of [Buffer.from(NAME), Buffer.from('SQLite format 3'), Buffer.from('bulut-a')]) assert.equal(data.indexOf(needle), -1, `${needle} in ${file}`);
    }
    // The rail and Ayarlar read it from the café: "Sunucu yedeği: … · başarılı".
    assert.equal(a.scheduler.cloud?.status().enabled, true);
  } finally { await w.close(); }
});

test('a cut line resumes where it stopped, and a file that arrives broken is sent again', async () => {
  // Phase 1: the line drops on the second piece of the first file that needs more than one. Phase 2: the first piece sent
  // is damaged on the way (its file's SHA-256 then fails on Merkez).
  let phase = 1, corrupt = false, sent = 0;
  const first = new Map<string, number>();
  const w = await world('cloud-resume', { spy: (path, body) => {
    if (path !== '/cloud-backup/chunk') return;
    if (phase === 1 && body.offset > 0) throw new DomainError('MERKEZ_UNREACHABLE', 'Mola Merkez yanıt vermiyor.', 503);
    if (phase === 2 && !first.has(body.sha256)) first.set(body.sha256, body.offset);
    if (corrupt) { corrupt = false; body.data = Buffer.from(Buffer.from(body.data, 'base64').map(b => b ^ 0xff)).toString('base64'); }
    sent += Buffer.from(body.data, 'base64').length;
  } });
  try {
    const a = await w.cafe('eski', 'bulut-a', NAME, 'eski-pc');
    const s = await a.scheduler.runNow(); assert.equal(s.lastError, undefined, 'the backup itself is fine');
    await a.scheduler.uploading;
    assert.match(a.cloud.status().lastError ?? '', /Merkez/); assert.equal(w.merkezVault.copies(a.installId).length, 0);
    const total = (await backupFiles(s.lastDirectory!)).reduce((n, f) => n + f.size, 0);
    assert.ok(sent > 0 && sent < total);
    // Next try: Merkez says where each file stands; the cut file goes on from its offset, and comes once more when damaged.
    phase = 2; sent = 0; corrupt = true;
    const second = await a.cloud.upload(s.lastDirectory!, true);
    assert.equal(second.lastError, undefined, second.lastError); assert.equal(w.merkezVault.copies(a.installId).length, 1);
    assert.ok([...first.values()].some(offset => offset > 0), 'resumed from the byte Merkez had');
    for (const f of w.merkezVault.copies(a.installId)[0].files) assert.equal(sha(readFileSync(join(w.vaultDir, a.installId, 'parcalar', f.sha256))), f.sha256);
  } finally { await w.close(); }
});

test('Merkez keeps the newest of each of 3 business days and 2 weeks; the room grows with the café; only a copy above the per-copy cap is refused', async () => {
  // Pure rule: four copies a day for 60 days (03:30, 09:30, 15:30, 21:30 Türkiye).
  const start = Date.parse('2026-08-01T00:30:00Z'), list = Array.from({ length: 240 }, (_, i) => ({ id: `c${i}`, createdAt: new Date(start + i * 6 * 3600_000).toISOString() }));
  const keep = retained(list, { daily: 3, weekly: 2 }), kept = list.filter(c => keep.has(c.id));
  assert.ok(keep.has('c239'), 'the newest stays');
  // Business days (05:00 to 05:00): the 03:30 copy belongs to the evening before, and is the newest of that day.
  const days = new Set(kept.map(c => new Date(Date.parse(c.createdAt) + 3 * 3600_000 - 5 * 3600_000).toISOString().slice(0, 10)));
  assert.equal(days.size, kept.length, 'one copy per business day at most');
  assert.ok(kept.length >= 3 && kept.length <= 5, String(kept.length));
  assert.ok(kept.filter(c => c.id !== 'c239').every(c => new Date(Date.parse(c.createdAt) + 3 * 3600_000).getUTCHours() === 3), 'each the 03:30 copy, the newest of its business day');
  assert.ok(Date.parse(kept[0].createdAt) > Date.parse(list[239].createdAt) - 21 * 86400000, 'nothing older than about 2 weeks');
  assert.equal(retained(list, { daily: 2, weekly: 0 }).size, 2);
  assert.deepEqual(new BackupVault(join(temp('cloud-defaults'), 'kasa')).settings('x'), { daily: 3, weekly: 2, capMb: 4096 });

  // The vault itself: small fake copies on different days.
  const MB = 1024 * 1024, vault = new BackupVault(join(temp('cloud-vault'), 'kasa'), { minFreeBytes: 0 }), install = randomUUID(), alerts: string[] = [];
  const files = (bytes: number) => ['complete.json', 'anahtar-kurtarma.json', 'manifest.bin', '0.bin'].map(name => { const data = randomBytes(name === '0.bin' ? bytes : 50); return { name, size: data.length, sha256: sha(data), data }; });
  const begin = (day: number, list: ReturnType<typeof files>) => { const at = new Date(start + day * 86400000); return vault.begin(install, 'bulut-a', { copyId: `backup-2026-gun-${String(day).padStart(3, '0')}`, createdAt: at.toISOString(), appVersion: '0.1.0', files: list.map(({ data: _d, ...f }) => f) }, at, (kind, text) => alerts.push(`${kind}: ${text}`)); };
  const put = async (day: number, bytes = 1000) => {
    const at = new Date(start + day * 86400000), list = files(bytes), b = begin(day, list);
    assert.equal(b.done, false);
    if (b.done) return;
    for (const n of b.need) await vault.chunk(install, { uploadId: b.uploadId, sha256: n.sha256, offset: 0, data: list.find(f => f.sha256 === n.sha256)!.data }, at, () => {});
    return vault.commit(install, 'bulut-a', b.uploadId, at);
  };
  for (let day = 0; day < 40; day++) await put(day);
  const copies = vault.copies(install);
  assert.ok(copies.length >= 3 && copies.length <= 5, String(copies.length));
  assert.equal(copies[0].id, 'backup-2026-gun-039');
  // Blobs of dropped copies are gone too: what is on disk is what the copies use.
  assert.equal(readdirSync(join(vault.directory, install, 'parcalar')).length, new Set(copies.flatMap(c => c.files.map(f => f.sha256))).size);

  // A growing café is never refused: the room is (3 + 2 + 1) × its largest copy. The old fixed quota refused every upload
  // once one copy was over half of it (here: 2 MB quota, 1,5 MB copies).
  writeFileSync(join(vault.directory, 'ayarlar.json'), JSON.stringify({ businesses: { 'bulut-a': { daily: 3, weekly: 2, quotaMb: 2 } } }));
  assert.deepEqual(vault.settings('bulut-a'), { daily: 3, weekly: 2, capMb: 4096 }, 'an older Merkez’s fixed quota is ignored');
  for (let day = 40; day < 46; day++) await put(day, 1.5 * MB + day * 1000);
  assert.equal(vault.copies(install)[0].id, 'backup-2026-gun-045');
  assert.ok(!alerts.some(a => a.startsWith('quota:') || a.startsWith('cap:')), alerts.join());
  const largest = Math.max(...vault.copies(install).map(c => c.bytes));
  assert.equal(vault.limit(install, vault.settings('bulut-a')), 6 * largest);
  assert.ok(vault.used(install) <= vault.limit(install, vault.settings('bulut-a')));
  // An upload that was given up (a newer backup came) does not hold the disk: the next begin drops it.
  const given = files(3000), first = begin(46, given);
  assert.equal(first.done, false); if (first.done) return;
  await vault.chunk(install, { uploadId: first.uploadId, sha256: first.need[0].sha256, offset: 0, data: given.find(f => f.sha256 === first.need[0].sha256)!.data.subarray(0, 10) }, new Date(), () => {});
  await put(47);
  assert.deepEqual(readdirSync(join(vault.directory, install, 'yukleme')), [], 'the older unfinished upload is gone');
  // The same copy again with a re-sealed key file (a new recovery code) while its first upload was unfinished: a file that
  // already arrived is kept for it (not sent again) and the copy commits.
  const shared = files(2000), b1 = begin(48, shared); if (b1.done) return;
  const big = shared.find(f => f.name === '0.bin')!;
  await vault.chunk(install, { uploadId: b1.uploadId, sha256: big.sha256, offset: 0, data: big.data }, new Date(), () => {});
  const resealed = shared.map(f => { if (f.name !== 'anahtar-kurtarma.json') return f; const data = randomBytes(50); return { ...f, data, size: data.length, sha256: sha(data) }; });
  const b2 = begin(48, resealed); if (b2.done) return;
  assert.ok(!b2.need.some(n => n.sha256 === big.sha256), 'the file already there is not sent again');
  for (const n of b2.need) await vault.chunk(install, { uploadId: b2.uploadId, sha256: n.sha256, offset: 0, data: resealed.find(f => f.sha256 === n.sha256)!.data }, new Date(), () => {});
  assert.equal(vault.commit(install, 'bulut-a', b2.uploadId, new Date(start + 48 * 86400000)).copy.id, 'backup-2026-gun-048');

  // Only one copy larger than the per-copy cap is refused, with an alert and a warning for Mola Yönetim.
  vault.setSettings('bulut-a', { daily: 3, weekly: 2, capMb: 1 });
  await assert.rejects(put(49, 2 * MB), (e: DomainError) => e.code === 'CLOUD_QUOTA');
  assert.ok(alerts.some(a => a.startsWith('cap:'))); assert.equal(vault.copies(install)[0].id, 'backup-2026-gun-048');
  assert.equal(vault.state(install).lastError, 'Kopya üst sınırı aşıldı');
  assert.equal(cloudWarning(vault.state(install).lastError, 1000, 1000, MB)?.tone, 'bad');
  assert.equal(cloudWarning(undefined, 0.85 * 4096 * MB, 0, 4096 * MB)?.tone, 'warn', 'near the cap');
  assert.match(cloudWarning(undefined, 1, LARGE_BYTES, 4096 * MB)?.text ?? '', /yer tutuyor/);
  assert.equal(cloudWarning(undefined, MB, 10 * MB, 4096 * MB), null);
  vault.setSettings('bulut-a', { daily: 3, weekly: 2, capMb: 4096 });
  await put(50); assert.equal(vault.state(install).lastError, undefined, 'a copy that fits clears it');
  // Disk guard: too little free space, nothing is taken; the disk counts as low (Bugün, Bildirim merkezi).
  vault.minFree = 10 * MB; vault.freeSpace = () => 5 * MB;
  await assert.rejects(put(51), (e: DomainError) => e.code === 'CLOUD_DISK');
  assert.ok(alerts.some(a => a.startsWith('disk:'))); assert.equal(vault.disk().low, true);
});

test('only the business’s own install lists and reads its copies; unsigned calls and wrong tickets are refused', async () => {
  const w = await world('cloud-other');
  try {
    const a = await w.cafe('eski', 'bulut-a', NAME, 'eski-pc'), b = await w.cafe('baska', 'bulut-b', 'Başka Kafe', 'baska-pc');
    await a.scheduler.runNow(); await a.scheduler.uploading;
    const copy = w.merkezVault.copies(a.installId)[0], file = copy.files[0];
    const mine = await a.link.relayPost<{ copies: { id: string }[] }>('/cloud-backup/list', {});
    assert.deepEqual(mine.copies.map(c => c.id), [copy.id]);
    const piece = await a.link.relayPost<{ data: string }>('/cloud-backup/read', { copy: copy.id, sha256: file.sha256, offset: 0, length: 10 });
    assert.equal(Buffer.from(piece.data, 'base64').length, Math.min(10, file.size));
    // The other business's install: nothing listed, the same copy not found.
    assert.deepEqual((await b.link.relayPost<{ copies: unknown[] }>('/cloud-backup/list', {})).copies, []);
    await assert.rejects(b.link.relayPost('/cloud-backup/read', { copy: copy.id, sha256: file.sha256, offset: 0, length: 10 }), (e: DomainError) => e.code === 'COPY_NOT_FOUND');
    // No signature: refused before anything is read; a made-up ticket: refused.
    const raw = await fetch(`${w.base}/api/merkez/v1/cloud-backup/list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(raw.status, 401);
    const ticket = await fetch(`${w.base}/api/merkez/v1/cloud-backup/transfer/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: 'x'.repeat(43), copy: copy.id, sha256: file.sha256, offset: 0, length: 10 }) });
    assert.equal(ticket.status, 403);
  } finally { await w.close(); }
});

test('new computer: taşıma kodu + recovery code bring the café back from Mola Merkez; wrong codes are refused; the old computer is locked', async () => {
  const w = await world('cloud-move');
  try {
    const a = await w.cafe('eski', 'bulut-a', NAME, 'eski-pc');
    await a.scheduler.runNow(); await a.scheduler.uploading;
    assert.equal(a.cloud.status().lastError, undefined);
    // The vendor issues a one-time taşıma kodu (Mola Yönetim → işletme → Lisans).
    const issued = await w.admin('/cloud-backups/transfer-code', { tenantId: 'bulut-a' });
    assert.equal(issued.status, 200); assert.match(issued.data.code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    // A clean install on another computer.
    const newData = join(w.dir, 'yeni', 'veri'), newVault = await KeyVault.open(newData, { protect: true, osLock: fakeOsLock('yeni-pc'), kdf: FAST_KDF });
    const clean = new Store(newData, [], { key: newVault.key! }), cleanLink = new MerkezLink(clean, { now: w.now, url: w.base, publicKey: w.publicKey });
    const restore = new CloudRestore(cleanLink, join(w.dir, 'yeni', 'veri-merkez-indirme'), () => newVault.installId, w.now);
    await assert.rejects(restore.open('AAAA-BBBB-CCCC-DDDD'), (e: DomainError) => e.code === 'WRONG_TRANSFER_CODE');
    const opened = await restore.open(issued.data.code.toLowerCase());
    assert.equal(opened.name, NAME); assert.equal(opened.copies.length, 1); assert.ok(opened.copies[0].bytes > 0);
    assert.ok(!('list' in opened.copies[0]), 'the screen gets dates and sizes only');
    // The same code on yet another computer: refused (bound to the first one).
    const third = new CloudRestore(cleanLink, join(w.dir, 'ucuncu'), () => randomUUID(), w.now);
    await assert.rejects(third.open(issued.data.code), (e: DomainError) => e.code === 'WRONG_TRANSFER_CODE');
    const folder = await restore.download(opened.copies[0].id);
    // Downloaded again (a second try): whole files already here are kept.
    assert.equal(await restore.download(opened.copies[0].id), folder);
    // The wrong recovery code does not open it; the café's own code does.
    await assert.rejects(restoreBackup(folder, { code: newVault.reveal() }, join(w.dir, 'yeni', 'deneme')), (e: DomainError) => e.code === 'WRONG_CODE');
    await restore.finish(opened.copies[0].id);
    const restored = await restoreBackup(folder, { code: a.code }, join(w.dir, 'yeni', 'geri'));
    await adoptKey(restored.directory, restored.master!, restored.recovery!, restored.installId!, fakeOsLock('yeni-pc'));
    const opened2 = await KeyVault.open(restored.directory, { protect: true, osLock: fakeOsLock('yeni-pc'), kdf: FAST_KDF });
    const back = new Store(restored.directory, [], { key: opened2.key! });
    try {
      assert.equal(back.read('bulut-a').name, NAME);
      // The code is spent: no second taşıma with it; Merkez wrote it down.
      const again = new CloudRestore(cleanLink, join(w.dir, 'tekrar'), () => newVault.installId, w.now);
      await assert.rejects(again.open(issued.data.code), (e: DomainError) => e.code === 'WRONG_TRANSFER_CODE');
      const d = w.merkezStore.read();
      assert.ok(d.audit.some(x => x.action === 'cloud.transfer_used' && x.target === 'bulut-a'));
      assert.ok((d.alerts ?? []).some(x => x.kind === 'cafe.cloud_backup' && x.tenantId === 'bulut-a'));
      // Two-computer rule: the new computer's heartbeat takes the licence; the old one hears "başka bilgisayar" and closes ordering.
      const moved = new MerkezLink(back, { now: w.now, url: w.base, publicKey: w.publicKey, machineKey: 'test:yeni-pc' });
      assert.equal((await moved.sync()).ok, true); assert.equal(moved.blocked(), undefined);
      assert.equal((await a.link.sync()).ok, true); assert.equal(a.link.blocked(), 'moved');
    } finally { back.close(); clean.close(); }
  } finally { await w.close(); }
});

test('Mola Yönetim: per-business view and settings, "2 gündür sunucu yedeği yok" alert, a deleted business takes its copies along', async () => {
  const w = await world('cloud-admin');
  try {
    const a = await w.cafe('eski', 'bulut-a', NAME, 'eski-pc');
    await a.scheduler.runNow(); await a.scheduler.uploading;
    let view = await w.admin('/cloud-backups');
    assert.equal(view.status, 200);
    const row = view.data.businesses.find((x: { tenantId: string }) => x.tenantId === 'bulut-a');
    assert.equal(row.count, 1); assert.ok(row.bytes > 0); assert.ok(row.lastUploadAt); assert.equal(row.stale, false);
    assert.deepEqual(row.settings, { daily: 3, weekly: 2, capMb: 4096 });
    // The room follows the café's own size; nothing to warn about for a small café.
    assert.equal(row.limit, 6 * row.copies[0].bytes); assert.equal(row.cap, 4096 * 1024 * 1024); assert.equal(row.warning, null);
    assert.ok(view.data.disk.used > 0); assert.equal(typeof view.data.disk.low, 'boolean');
    assert.equal((await w.admin('/cloud-backups/settings', { tenantId: 'bulut-a', daily: 5, weekly: 2, capMb: 1024 })).data.settings.capMb, 1024);
    // A Mola Yönetim page loaded before this version still sends `quotaMb`: accepted, ignored (the cap stays).
    const old = await w.admin('/cloud-backups/settings', { tenantId: 'bulut-a', daily: 4, weekly: 1, quotaMb: 2048 });
    assert.equal(old.status, 200); assert.deepEqual(old.data.settings, { daily: 4, weekly: 1, capMb: 1024 });
    assert.equal((await w.admin('/cloud-backups/settings', { tenantId: 'bulut-a', daily: 0, weekly: 2, capMb: 1024 })).status, 400);
    // Three days without an upload: once in Bildirim merkezi, and "stale" for the Bugün list.
    w.clock.t += 3 * 86400000;
    assert.equal(sweepVault(w.merkezVault, w.merkezStore, w.now()), 1);
    assert.equal(sweepVault(w.merkezVault, w.merkezStore, w.now()), 0);
    await w.admin('/login', { username: 'admin', password: MERKEZ_PASSWORD }); // the session ended with the clock
    view = await w.admin('/cloud-backups');
    assert.equal(view.data.businesses.find((x: { tenantId: string }) => x.tenantId === 'bulut-a').stale, true);
    // Suspended, then deleted: its copies are gone from Merkez.
    const biz = (await w.admin('/state')).data.businesses.find((x: { tenantId: string }) => x.tenantId === 'bulut-a');
    assert.equal((await w.admin('/licenses', { requestId: rid(), tenantId: 'bulut-a', expectedEnd: biz.endsAt, expectedSuspended: false, months: 0, suspended: true, reason: 'deneme' })).status, 200);
    const gone = await w.admin('/businesses/delete', { requestId: rid(), tenantId: 'bulut-a', confirmName: NAME });
    assert.equal(gone.status, 200, JSON.stringify(gone.data));
    assert.equal(existsSync(join(w.vaultDir, a.installId)), false);
  } finally { await w.close(); }
});

test('pieces go as raw bytes to a Merkez that takes them (a quarter less traffic); an older Merkez still gets base64 JSON', async () => {
  const calls: { path: string; bytes: number }[] = [];
  const w = await world('cloud-binary', { binary: true, spy: (path, body) => calls.push({ path, bytes: Buffer.isBuffer(body?.data) ? body.data.length : typeof body?.data === 'string' ? body.data.length : 0 }) });
  try {
    const a = await w.cafe('eski', 'bulut-a', NAME, 'eski-pc');
    assert.ok(a.link.read()?.accepts?.includes('cloud.backup.binary'), 'this Merkez lists raw pieces');
    const s = await a.scheduler.runNow(); await a.scheduler.uploading;
    assert.equal(a.cloud.status().lastError, undefined, a.cloud.status().lastError);
    const pieces = calls.filter(c => c.path.startsWith('/cloud-backup/chunk-bin/'));
    assert.ok(pieces.length > 3, 'several raw pieces'); assert.ok(!calls.some(c => c.path === '/cloud-backup/chunk'), 'no base64 piece');
    // Byte for byte the same files, and exactly their size on the wire (base64 would be 4/3).
    const files = await backupFiles(s.lastDirectory!), total = files.reduce((n, f) => n + f.size, 0);
    assert.equal(pieces.reduce((n, c) => n + c.bytes, 0), total);
    for (const f of files) assert.equal(sha(readFileSync(join(w.vaultDir, a.installId, 'parcalar', f.sha256))), f.sha256);
    // The raw call is signed like every other: unsigned or tampered bytes are refused.
    const upload = '0'.repeat(32), unsigned = await fetch(`${w.base}/api/merkez/v1/cloud-backup/chunk-bin/${upload}/${'a'.repeat(64)}/0`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([1, 2, 3]) });
    assert.equal(unsigned.status, 401);
  } finally { await w.close(); }
  // A café with raw pieces and a Merkez that does not list them (older Merkez): the JSON call, and the copy arrives.
  calls.length = 0;
  const old = await world('cloud-binary-old', { binary: true, oldMerkez: true, spy: (path, body) => calls.push({ path, bytes: typeof body?.data === 'string' ? body.data.length : 0 }) });
  try {
    const a = await old.cafe('eski', 'bulut-a', NAME, 'eski-pc');
    await a.scheduler.runNow(); await a.scheduler.uploading;
    assert.equal(a.cloud.status().lastError, undefined);
    assert.ok(calls.some(c => c.path === '/cloud-backup/chunk')); assert.ok(!calls.some(c => c.path.startsWith('/cloud-backup/chunk-bin/')));
    assert.equal(old.merkezVault.copies(a.installId).length, 1);
  } finally { await old.close(); }
});

test('a night with nothing new takes no backup and uploads nothing; the next real change is backed up and sent', async () => {
  const calls: string[] = [];
  const w = await world('cloud-skip', { changes: true, spy: path => calls.push(path) });
  try {
    const a = await w.cafe('eski', 'bulut-a', NAME, 'eski-pc');
    w.clock.t = Date.parse('2026-10-05T23:41:00+03:00');
    const closing = await a.scheduler.runNow('day-close'); await a.scheduler.uploading;
    assert.equal(closing.lastError, undefined); assert.ok(calls.includes('/cloud-backup/commit'));
    const before = readdirSync(a.folders.backups).filter(n => n.startsWith('backup-'));
    calls.length = 0; w.clock.t = Date.parse('2026-10-06T03:30:00+03:00');
    const night = await a.scheduler.runNow('auto'); await a.scheduler.uploading;
    assert.equal(night.skipped?.text, 'Gece yedeği gerekmedi: 23:41 gün sonu yedeği güncel.');
    assert.equal(calls.length, 0, `nothing goes to Mola Merkez: ${calls.join()}`); assert.deepEqual(readdirSync(a.folders.backups).filter(n => n.startsWith('backup-')), before);
    // A real change, the next night: backed up, and uploaded (the last copy went up more than 6 hours before).
    w.clock.t = Date.parse('2026-10-06T12:00:00+03:00'); a.changes!.changed();
    w.clock.t = Date.parse('2026-10-07T03:30:00+03:00');
    const next = await a.scheduler.runNow('auto'); await a.scheduler.uploading;
    assert.equal(next.lastError, undefined); assert.ok(next.lastSuccessAt! > closing.lastSuccessAt!);
    assert.ok(calls.includes('/cloud-backup/commit'), calls.join());
  } finally { await w.close(); }
});