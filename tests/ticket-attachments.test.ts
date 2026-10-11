import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import sharp from 'sharp';
import { DEMO_PASSWORD } from '../server/app.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { Attachments, cleanName, sniff } from '../server/merkez/attachments.js';
import { MerkezBackups, MerkezRecovery } from '../server/merkez/backup.js';
import { MerkezStore } from '../server/merkez/store.js';
import { FAST_KDF } from './fake-os-lock.js';
import { MERKEZ_PASSWORD, merkezPair, temp } from './merkez-fixture.js';

const rid = () => randomUUID().replace(/-/g, '');
const DAY = 86_400_000;
const pdf = (extra = 0) => Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n'), randomBytes(extra)]);
/** Mola Yönetim with its session cookie, for raw uploads and file reads. */
async function adminSession(base: string) {
  const login = await fetch(`${base}/api/merkez/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: MERKEZ_PASSWORD }) });
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  return {
    upload: (ticketId: string, name: string, bytes: Buffer, type = 'application/octet-stream') => fetch(`${base}/api/merkez/admin/attachments?ticketId=${ticketId}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': type }, body: new Uint8Array(bytes) }),
    get: (path: string) => fetch(`${base}/api/merkez/admin${path}`, { headers: { Cookie: cookie } }),
  };
}

test('file recognition and clean names', () => {
  assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(sniff(Buffer.from('%PDF-1.7')), 'pdf');
  assert.equal(sniff(Buffer.from('MZ\x90\x00 program')), null);
  assert.equal(sniff(Buffer.from('<html><script>')), null);
  assert.equal(sniff(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic')])), 'heic');
  assert.equal(cleanName('..\\..\\Windows\\Fotoğraf 1.JPG', 'webp'), 'Fotoğraf 1.webp');
  assert.equal(cleanName('../../etc/<passwd>|x.pdf', 'pdf'), 'passwdx.pdf');
  assert.equal(cleanName('', 'pdf'), 'belge.pdf');
  assert.equal(cleanName('.jpg', 'webp'), 'fotograf.webp');
});

test('destek ekleri both ways: EXIF gone, PDF kept, types and sizes refused, other business shut out, 14-day deletion', async t => {
  let time = Date.now();
  const pair = await merkezPair('attachments', { demo: true, now: () => new Date(time) }); t.after(() => pair.close());
  await pair.importDemo();
  const owner = pair.kafe(), other = pair.kafe();
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD }); await other('/login', { username: 'diger', password: DEMO_PASSWORD });
  // A phone photo: big, with the camera's name and a GPS position in EXIF.
  const photo = await sharp({ create: { width: 3200, height: 1600, channels: 3, background: '#c0392b' } }).jpeg().withExif({ IFD0: { Make: 'GizliKamera', Copyright: 'GIZLI-SAHIP' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 1/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '29/1 0/1 0/1' } }).toBuffer();
  assert.ok((await sharp(photo).metadata()).exif, 'the test photo really has EXIF');
  const up = await owner('/staff/support/attachments', { name: '..\\Masaüstü\\Yazıcı hatası.JPG', data: photo.toString('base64') });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const image = up.data.attachment;
  assert.equal(image.type, 'image/webp'); assert.equal(image.name, 'Yazıcı hatası.webp'); assert.equal(image.width, 2000); assert.equal(image.height, 1000);
  assert.equal(Date.parse(image.expiresAt) - time, 14 * DAY);
  const doc = (await owner('/staff/support/attachments', { name: 'Fatura.pdf', data: pdf(2000).toString('base64') })).data.attachment;
  assert.equal(doc.type, 'application/pdf'); assert.equal(doc.name, 'Fatura.pdf');
  // Refused: a program, a web page, an empty file, more than 10 MB.
  for (const [bytes, code] of [[Buffer.from('MZ\x90\x00This program cannot be run'), 'ATTACHMENT_TYPE'], [Buffer.from('<html><script>alert(1)</script>'), 'ATTACHMENT_TYPE'], [Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024 - 4)]), 'ATTACHMENT_TOO_LARGE']] as const) {
    const r = await owner('/staff/support/attachments', { name: 'x.pdf', data: bytes.toString('base64') });
    assert.equal(r.data.code, code, JSON.stringify(r.data));
  }
  assert.equal((await owner('/staff/support/attachments', { name: 'bos.pdf', data: '' })).status, 400);
  // The files on Merkez's disk are sealed: no PDF header, no picture, no EXIF text.
  const folder = join(pair.dir, 'merkez-ekler');
  const files = readdirSync(folder);
  assert.ok(files.length >= 3);
  for (const f of files) { const b = readFileSync(join(folder, f)); for (const plain of ['%PDF', 'RIFF', 'WEBP', 'GizliKamera', 'Fatura']) assert.equal(b.includes(plain), false, `${f}: ${plain}`); }

  // A ticket with both files; an unknown id is refused.
  assert.equal((await owner('/staff/support', { requestId: rid(), subject: 'Ekli talep', text: 'Fotoğraf ve fatura ekte.', attachments: [randomUUID()] })).data.code, 'ATTACHMENT_GONE');
  const created = await owner('/staff/support', { requestId: rid(), subject: 'Ekli talep', text: 'Fotoğraf ve fatura ekte.', attachments: [image.id, doc.id] });
  assert.equal(created.status, 200);
  assert.equal((await pair.link.sync()).ok, true);
  await pair.adminLogin();
  const ticket = (await pair.admin('/state')).data.tickets.find((x: { id: string }) => x.id === created.data.id);
  assert.deepEqual(ticket.messages[0].attachments.map((a: { id: string }) => a.id), [image.id, doc.id]);

  // Mola Yönetim reads them: WebP without EXIF, the PDF byte for byte (as a download, never as a page).
  let admin = await adminSession(pair.merkezBase);
  const seen = await admin.get(`/attachments/${image.id}`);
  assert.equal(seen.status, 200); assert.equal(seen.headers.get('content-type'), 'image/webp'); assert.match(seen.headers.get('content-security-policy') ?? '', /sandbox/);
  const webp = Buffer.from(await seen.arrayBuffer()), meta = await sharp(webp).metadata();
  assert.equal(meta.format, 'webp'); assert.equal(meta.exif, undefined); assert.equal(meta.width, 2000);
  assert.equal(webp.includes('GizliKamera'), false); assert.equal(webp.includes('GIZLI-SAHIP'), false);
  const small = Buffer.from(await (await admin.get(`/attachments/${image.id}/kucuk`)).arrayBuffer());
  assert.ok((await sharp(small).metadata()).width! <= 480);
  const gotPdf = await admin.get(`/attachments/${doc.id}`);
  assert.match(gotPdf.headers.get('content-disposition') ?? '', /^attachment;/);
  assert.equal(Buffer.from(await gotPdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  // The Mola team answers with a screenshot only (no text).
  const png = await sharp({ create: { width: 800, height: 600, channels: 4, background: '#2c3e50' } }).png().toBuffer();
  const sent = await admin.upload(ticket.id, 'Ekran görüntüsü.png', png, 'image/png');
  assert.equal(sent.status, 200);
  const screenshot = (await sent.json()).attachment;
  assert.equal((await admin.upload(ticket.id, 'kod.js', Buffer.from('console.log(1)'))).status, 415);
  assert.equal((await pair.admin('/tickets/reply', { requestId: rid(), ticketId: ticket.id, text: '', attachments: [randomUUID()] })).data.code, 'ATTACHMENT_GONE');
  assert.equal((await pair.admin('/tickets/reply', { requestId: rid(), ticketId: ticket.id, text: '' })).status, 400, 'an empty message needs a file');
  assert.equal((await pair.admin('/tickets/reply', { requestId: rid(), ticketId: ticket.id, text: '', attachments: [screenshot.id] })).status, 200);
  // The café's file cannot be put on a Mola message, nor the Mola file twice.
  assert.equal((await pair.admin('/tickets/reply', { requestId: rid(), ticketId: ticket.id, text: 'x', attachments: [image.id] })).data.code, 'ATTACHMENT_GONE');
  await pair.link.sync();
  const mine = (await owner('/staff/support')).data.tickets.find((x: { id: string }) => x.id === ticket.id);
  assert.equal(mine.messages[1].source, 'support'); assert.equal(mine.messages[1].attachments[0].id, screenshot.id);
  // The café owner reads it through the café server; the other business of this computer cannot.
  const cookieOf = async (username: string) => { const r = await fetch(`${pair.kafeBase}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: DEMO_PASSWORD }) }); return r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); };
  let ownerCookie = await cookieOf('isletme'); const otherCookie = await cookieOf('diger');
  const fromCafe = (cookie: string, path: string) => fetch(`${pair.kafeBase}/api/staff/support/attachments/${path}`, { headers: { Cookie: cookie } });
  const got = await fromCafe(ownerCookie, screenshot.id);
  assert.equal(got.status, 200); assert.equal(got.headers.get('content-type'), 'image/webp');
  assert.equal((await sharp(Buffer.from(await got.arrayBuffer())).metadata()).width, 800);
  assert.equal((await fromCafe(ownerCookie, `${image.id}/kucuk`)).status, 200);
  assert.equal((await fromCafe(otherCookie, screenshot.id)).status, 404, 'another business on the same computer');
  assert.equal((await fromCafe(otherCookie, image.id)).status, 404);
  // At Merkez, a file is only for the café of its business.
  const ekler = new Attachments(pair.merkezStore, folder);
  assert.throws(() => ekler.read(image.id, ['baska-isletme'], false, new Date(time)), /Ek bulunamadı/);
  assert.equal(ekler.read(image.id, ['mola-demo'], false, new Date(time)).ref.id, image.id);

  // A file uploaded but never sent goes after a day.
  const orphan = (await owner('/staff/support/attachments', { name: 'unutulan.pdf', data: pdf().toString('base64') })).data.attachment;
  time += DAY + 60_000; ekler.sweep(new Date(time)); ownerCookie = await cookieOf('isletme');
  { const r = await fromCafe(ownerCookie, orphan.id); assert.equal(r.status, 410, await r.text()); }
  assert.throws(() => ekler.read(orphan.id, null, false, new Date(time)), /Ek silindi/);
  // 14 days: gone on read (even before the sweep), the message keeps its line.
  time += 13 * DAY; ownerCookie = await cookieOf('isletme'); admin = await adminSession(pair.merkezBase); await pair.adminLogin();
  const expired = await fromCafe(ownerCookie, screenshot.id);
  assert.equal(expired.status, 410); assert.match((await expired.json()).message, /Ek silindi \(14 gün\)/);
  assert.equal((await admin.get(`/attachments/${image.id}`)).status, 410);
  ekler.sweep(new Date(time));
  assert.deepEqual(readdirSync(folder).filter(f => f.endsWith('.ek')), [], 'every file deleted from the disk');
  const after = (await pair.admin('/state')).data.tickets.find((x: { id: string }) => x.id === ticket.id);
  assert.equal(after.messages[0].attachments.length, 2, 'the message still names its files');
});

test('daily limit per business and the Merkez-wide disk guard', async t => {
  const pair = await merkezPair('attachment-limits', { demo: true }); t.after(() => pair.close());
  await pair.importDemo();
  const owner = pair.kafe(); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  const big = pdf(9 * 1024 * 1024).toString('base64');
  for (let i = 0; i < 5; i++) assert.equal((await owner('/staff/support/attachments', { name: `b${i}.pdf`, data: big })).status, 200, `file ${i}`);
  const over = await owner('/staff/support/attachments', { name: 'fazla.pdf', data: big });
  assert.equal(over.status, 429); assert.equal(over.data.code, 'ATTACHMENT_DAILY');
  const tight = new Attachments(pair.merkezStore, join(pair.dir, 'dar-ekler'), { maxTotalBytes: 1000 });
  await assert.rejects(tight.add({ tenant: 'mola-demo', source: 'support', name: 'x.pdf', bytes: pdf(5000), now: new Date() }), (e: { code?: string }) => e.code === 'ATTACHMENT_SPACE');
});

test('Merkez backups leave the attachments out', async t => {
  const root = temp('attachment-backup'), dir = join(root, 'merkez'), key = randomBytes(32);
  const store = new MerkezStore(dir, key, { initialPassword: MERKEZ_PASSWORD });
  const app = createMerkezApp(store), server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  void (server.address() as AddressInfo);
  const ekler = app.locals.attachments as Attachments;
  await ekler.add({ tenant: 'yedek-kafe', source: 'support', name: 'buyuk.pdf', bytes: pdf(3 * 1024 * 1024), now: new Date() });
  assert.ok(existsSync(join(root, 'merkez-ekler')));
  const recovery = await MerkezRecovery.open(dir, key, FAST_KDF); recovery.reveal(); recovery.confirm();
  const backups = new MerkezBackups(dir, { folder: join(root, 'merkez-yedek'), checks: join(root, 'merkez-yedek-prova'), settings: join(dir, 'merkez-yedek-ayar.json'), auto: false, protection: () => recovery.protection(), onFailure: () => {} });
  await backups.start();
  const status = await backups.runNow(); assert.equal(status.lastError, undefined);
  const [made] = readdirSync(join(root, 'merkez-yedek')).filter(n => n.startsWith('merkez-yedek-'));
  const backup = join(root, 'merkez-yedek', made);
  assert.equal(JSON.parse(readFileSync(join(backup, 'complete.json'), 'utf8')).files, 2, 'merkez.sqlite and the public key only');
  const size = readdirSync(backup).reduce((n, f) => n + statSync(join(backup, f)).size, 0);
  assert.ok(size < 1024 * 1024, `the 3 MB attachment is not in the backup (${size} bytes)`);
  backups.stop();
});

test('a long queue of messages goes 50 at a time (Merkez takes at most 50 per ticket in one heartbeat)', async t => {
  const pair = await merkezPair('ticket-queue', { demo: true }); t.after(() => pair.close());
  await pair.importDemo();
  const owner = pair.kafe(); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  const ticket = (await owner('/staff/support', { requestId: rid(), subject: 'Uzun', text: 'Mesaj 0' })).data;
  for (let i = 1; i <= 70; i++) assert.equal((await owner('/staff/support/reply', { requestId: rid(), ticketId: ticket.id, text: `Mesaj ${i}` })).status, 200);
  assert.equal((await pair.link.sync()).ok, true);
  await pair.adminLogin();
  assert.equal((await pair.admin('/state')).data.tickets[0].messages.length, 50);
  assert.equal((await pair.link.sync()).ok, true);
  assert.equal((await pair.admin('/state')).data.tickets[0].messages.length, 71);
});