import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Attachments } from '../server/merkez/attachments.js';
import { cloudFolder, defaultWorkFolder, DEFAULT_WORK_FOLDER, folderProblem, writeAtomic, type WorkFolder } from '../server/merkez/workfolder.js';
import { istanbulDay } from '../server/merkez/journal-text.js';
import { merkezPair } from './merkez-fixture.js';
import { freshCode, testBundle, withAuthenticator } from './update-fixture.js';
// @ts-expect-error plain .mjs without types
import { check as independentCheck, load as independentLoad } from '../scripts/islem-dogrula.mjs';

/*
 * Mola çalışma klasörü (server/merkez/workfolder.ts). Scratch folders under the system temp folder only (never C:\MolaCalisma,
 * never OneDrive): every file atomic, README explains them, the chain in daily files passes the independent check, support
 * tickets (personal data) never in a cloud folder, attachments only while they exist, bundles in guncellemeler\ wait for a click.
 */
const scratch = (name: string) => mkdtempSync(join(tmpdir(), `mola-calisma-${name}-`));
const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)).map(x => `${f}/${x}`) : [f]);

test('defaults and checks: C:\\MolaCalisma only for the installed Mola Yönetim on Windows; cloud folders; refused paths', () => {
  assert.equal(defaultWorkFolder({ MOLA_MODE: 'installed' }, 'win32'), DEFAULT_WORK_FOLDER);
  assert.equal(defaultWorkFolder({}, 'win32'), null, 'development and tests: off until chosen');
  assert.equal(defaultWorkFolder({ MOLA_MODE: 'installed' }, 'linux'), null);
  assert.equal(defaultWorkFolder({ MOLA_MODE: 'installed', MERKEZ_CALISMA_KLASORU: '0' }, 'win32'), null);
  assert.ok(cloudFolder('C:\\Users\\a\\OneDrive\\Masaüstü\\Mola', {}));
  assert.ok(cloudFolder('D:\\Belgeler\\Dropbox\\Mola', {}));
  assert.ok(cloudFolder('C:\\Users\\a\\Is Yeri\\Mola', { OneDrive: 'C:\\Users\\a\\Is Yeri' }));
  assert.equal(cloudFolder('C:\\MolaCalisma', {}), false);
  const data = join(tmpdir(), 'mola-veri', 'veri');
  assert.match(folderProblem('goreli\\yol', data)!, /Tam yol/);
  assert.match(folderProblem('C:\\', data)!, /kökü/);
  assert.match(folderProblem(join(data, 'calisma'), data)!, /veri ve yedek/);
  assert.equal(folderProblem('C:\\MolaCalisma', data), null);
});

test('atomic writes: a temporary file then a rename; an unchanged file is not touched; nothing half-written stays', async () => {
  const dir = scratch('atomik'), file = join(dir, 'a', 'b.md');
  try {
    assert.equal(await writeAtomic(file, 'bir'), true);
    const first = statSync(file).mtimeMs;
    await new Promise(r => setTimeout(r, 20));
    assert.equal(await writeAtomic(file, 'bir'), false, 'same content: no write');
    assert.equal(statSync(file).mtimeMs, first);
    assert.equal(await writeAtomic(file, 'iki'), true); assert.equal(readFileSync(file, 'utf8'), 'iki');
    assert.deepEqual(walk(dir), ['a/b.md'], 'no temporary files left');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the folder: README, durum özeti, daily chain files that pass the independent check, errors, tickets with attachments, versions, guncellemeler', async t => {
  const pair = await merkezPair('calisma', { demo: true }); t.after(() => pair.close());
  const folder = scratch('tam'); t.after(() => rmSync(folder, { recursive: true, force: true }));
  await pair.adminLogin(); await pair.importDemo();
  const store = pair.merkezStore, biz = store.read().businesses[0];
  // A ticket from the café with a PDF attachment, and an answer.
  const attachments = pair.merkezApp.locals.attachments as Attachments, now = new Date(), ticketId = randomUUID(), messageId = randomUUID();
  const ref = await attachments.add({ tenant: biz.tenantId, source: 'business', ticket: ticketId, name: 'fatura.pdf', bytes: Buffer.from('%PDF-1.4\n% Mola test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), now });
  attachments.claim([ref.id], biz.tenantId, ticketId, messageId, 'business');
  store.mutate(d => { d.tickets.push({ id: ticketId, tenantId: biz.tenantId, subject: 'Yazıcı çalışmıyor', status: 'open', createdAt: now.toISOString(), messages: [{ id: messageId, source: 'business', text: 'Mutfak yazıcısı fiş basmıyor.\nNe yapalım?', at: now.toISOString(), attachments: [ref] }] }); });
  // A failure record from the café (code location only).
  store.addFailures([{ event: 'request_failed', requestId: randomUUID(), method: 'POST', route: '/api/staff/orders', status: 500, code: 'SERVER_ERROR', elapsedMs: 12, tenantId: biz.tenantId, role: 'waiter', fingerprint: 'abcdef0123456789', frames: ['submitOrder (server/app.ts:120:5)'], at: now.toISOString() }], new Set([biz.tenantId]), biz.tenantId);
  assert.equal((await pair.link.sync()).ok, true);
  // Set over the API (as Ayarlar → Çalışma klasörü does): written at once.
  const r = await pair.admin('/workfolder', { path: folder });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.path, folder); assert.equal(r.data.lastError, undefined); assert.equal(r.data.cloud, false);
  const files = walk(folder), day = istanbulDay(now.toISOString());
  for (const f of ['README.md', 'durum-ozeti.md', `islem-kayitlari/${day}.jsonl`, `islem-kayitlari/${day}-dogrulama.md`, 'islem-kayitlari/muhurler.jsonl', 'islem-kayitlari/merkez-acik-anahtar.txt', 'hata-kayitlari/hatalar.json', 'destek-talepleri/KISISEL-VERI.txt', 'surumler/yayinlar.md', 'guncellemeler/BENIOKU.txt'])
    assert.ok(files.includes(f), `${f} is there`);
  assert.ok(!files.some(f => f.endsWith('.yaziliyor')), 'no temporary files');
  const readme = readFileSync(join(folder, 'README.md'), 'utf8');
  for (const part of ['durum-ozeti.md', 'islem-kayitlari/', 'hata-kayitlari/', 'destek-talepleri/', 'surumler/', 'guncellemeler/', 'Kişisel veri', 'islem-dogrula.mjs', 'Claude için not']) assert.ok(readme.toLocaleLowerCase('tr').includes(part.toLocaleLowerCase('tr')), `README explains ${part}`);
  assert.match(readFileSync(join(folder, 'durum-ozeti.md'), 'utf8'), new RegExp(biz.name));
  assert.match(readFileSync(join(folder, 'durum-ozeti.md'), 'utf8'), /Kayıtlar bütün/);
  assert.match(readFileSync(join(folder, 'islem-kayitlari', `${day}-dogrulama.md`), 'utf8'), /Kayıtlar bütün/);
  // The daily files are the chain itself: the independent check accepts them.
  const result = independentCheck(independentLoad(join(folder, 'islem-kayitlari'))); assert.equal(result.ok, true, result.text);
  // Errors: one readable file per group, code locations only.
  const errors = files.filter(f => /^hata-kayitlari\/hata-.*\.md$/.test(f)); assert.equal(errors.length, 1);
  const error = readFileSync(join(folder, errors[0]), 'utf8'); assert.match(error, /server\/app\.ts:120:5/); assert.match(error, new RegExp(biz.name));
  // Tickets: the conversation as .md, the attachment beside it.
  const ticket = files.find(f => f.startsWith('destek-talepleri/') && f.endsWith('.md'))!; assert.ok(ticket);
  const md = readFileSync(join(folder, ticket), 'utf8'); assert.match(md, /Yazıcı çalışmıyor/); assert.match(md, /> Mutfak yazıcısı fiş basmıyor\.\n> Ne yapalım\?/); assert.match(md, /fatura\.pdf/);
  const saved = files.find(f => f.includes('/ekler/'))!; assert.ok(saved); assert.equal(readFileSync(join(folder, saved)).subarray(0, 5).toString(), '%PDF-');
  // The attachment expires: gone from the folder too at the next write.
  attachments.sweep(new Date(Date.now() + 15 * 86400000));
  store.mutate(d => { const m = d.tickets.find(x => x.id === ticketId)!.messages[0]; m.attachments = m.attachments!.map(a => ({ ...a, expiresAt: new Date(Date.now() - 1000).toISOString() })); });
  const wf = pair.merkezApp.locals.workFolder as WorkFolder; await wf.run();
  assert.equal(existsSync(join(folder, saved)), false, 'deleted with Merkez’s copy');
  assert.match(readFileSync(join(folder, ticket), 'utf8'), /silindi ya da süresi doldu/);
  // Versions: the café's file.
  assert.ok(walk(folder).some(f => f.startsWith('surumler/') && f.endsWith('.md') && f !== 'surumler/yayinlar.md'));
  // guncellemeler\: a dropped bundle shows as "Klasörde hazır"; loading it needs a click, publishing another one.
  const bundle = await testBundle(join(pair.dir, 'paket'), '0.9.2');
  writeFileSync(join(folder, 'guncellemeler', 'Mola-0.9.2-windows.mola-guncelleme'), readFileSync(bundle.file));
  const ready = await pair.admin('/releases/folder');
  assert.equal(ready.data.files.length, 1); assert.equal(ready.data.files[0].version, '0.9.2'); assert.equal(ready.data.files[0].imported, false);
  assert.equal((await pair.admin('/releases')).data.releases.length, 0, 'nothing loaded by itself');
  // "Yükle ve doğrula" from the folder needs the Güncelleme yetkisi like a drop: two-step login first, then a fresh code.
  const name = 'Mola-0.9.2-windows.mola-guncelleme';
  assert.equal((await pair.admin('/releases/folder/import', { name })).data.code, 'MFA_REQUIRED');
  withAuthenticator(store);
  assert.equal((await pair.admin('/releases/folder/import', { name })).data.code, 'STEP_UP_REQUIRED');
  assert.equal((await pair.admin('/releases/yetki', { code: await freshCode(store) })).status, 200);
  assert.equal((await pair.admin('/releases/folder/import', { name: '..\\..\\x.mola-guncelleme' })).status, 404);
  const loaded = await pair.admin('/releases/folder/import', { name: 'Mola-0.9.2-windows.mola-guncelleme' });
  assert.equal(loaded.status, 200, JSON.stringify(loaded.data)); assert.equal(loaded.data.release.rollout.mode, 'off', 'never published by itself');
  assert.ok(existsSync(join(folder, 'guncellemeler', 'yuklenenler', 'Mola-0.9.2-windows.mola-guncelleme')));
  assert.equal((await pair.admin('/releases/folder')).data.files.length, 0);
  assert.ok(store.journal.entries().some(s => s.entry.action === 'release.imported' && /çalışma klasöründen/.test(s.entry.detail ?? '')));
  // A past day's file that changed (a restored Merkez) keeps its old copy beside it.
  const past = join(folder, 'islem-kayitlari', `${day}.jsonl`);
  writeFileSync(past, '{"type":"kayit","hash":"x","entry":{}}\n');
  await (pair.merkezApp.locals.workFolder as unknown as { known: Map<string, string> }).known.clear();
  await wf.run();
  assert.ok(readdirSync(join(folder, 'islem-kayitlari')).some(f => f.startsWith(`${day}.onceki-`)), 'old copy kept');
  // Off: nothing more is written, files stay.
  assert.equal((await pair.admin('/workfolder', { path: null })).data.path, null);
  rmSync(join(folder, 'README.md')); await wf.run(); assert.equal(existsSync(join(folder, 'README.md')), false);
});

test('a cloud-synced folder (OneDrive) never gets the support tickets; the README says why', async t => {
  const pair = await merkezPair('calisma-bulut', { demo: true }); t.after(() => pair.close());
  const root = scratch('bulut'), folder = join(root, 'OneDrive', 'Mola'); mkdirSync(folder, { recursive: true }); t.after(() => rmSync(root, { recursive: true, force: true }));
  await pair.adminLogin(); await pair.importDemo();
  const biz = pair.merkezStore.read().businesses[0];
  pair.merkezStore.mutate(d => { d.tickets.push({ id: randomUUID(), tenantId: biz.tenantId, subject: 'Kişisel', status: 'open', createdAt: new Date().toISOString(), messages: [{ id: randomUUID(), source: 'business', text: 'Telefonum 0532…', at: new Date().toISOString() }] }); });
  const r = await pair.admin('/workfolder', { path: folder });
  assert.equal(r.data.cloud, true);
  assert.equal(existsSync(join(folder, 'destek-talepleri')), false);
  assert.match(readFileSync(join(folder, 'README.md'), 'utf8'), /destek talepleri buraya YAZILMAZ/);
  assert.ok(existsSync(join(folder, 'durum-ozeti.md')));
  // The VDS sync's source: the same snapshot over the API (admin session here; a "calisma" token on a VDS).
  const snap = await pair.admin('/workfolder/snapshot?since=0');
  assert.equal(snap.data.format, 'mola-calisma-1'); assert.ok(snap.data.journal.entries.length > 0); assert.equal(snap.data.journal.verify.ok, true);
  const since = snap.data.journal.entries.at(-1).entry.seq;
  assert.equal((await pair.admin(`/workfolder/snapshot?since=${since}`)).data.journal.entries.length, 0);
});
