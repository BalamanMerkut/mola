import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer as createNet, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { MAIL_ATTEMPTS } from '../server/merkez/alerts.js';
import { sweepAlerts } from '../server/merkez/app.js';
import { MailQueue } from '../server/merkez/mail.js';
import { merkezPair } from './merkez-fixture.js';

const rid = () => randomUUID().replace(/-/g, '');
const DAY = 86400000;
/** A tiny SMTP server on 127.0.0.1: records what arrives; `password` decides AUTH (535 for anything else). */
async function fakeSmtp(password: string) {
  const received: { from: string; to: string; data: string; auth: string }[] = [];
  const server = createNet((socket: Socket) => {
    let buffer = '', data: string | null = null, from = '', to = '', auth = '';
    socket.on('error', () => {}); socket.write('220 test ESMTP\r\n');
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      for (let i; (i = buffer.indexOf('\r\n')) >= 0;) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        if (data !== null) { if (line === '.') { received.push({ from, to, data, auth }); data = null; socket.write('250 OK\r\n'); } else data += line + '\n'; continue; }
        if (/^EHLO/.test(line)) socket.write('250-test\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN /.test(line)) { auth = Buffer.from(line.slice(11), 'base64').toString('utf8'); socket.write(auth.split('\0')[2] === password ? '235 OK\r\n' : '535 no\r\n'); }
        else if (/^MAIL FROM:/.test(line)) { from = line; socket.write('250 OK\r\n'); }
        else if (/^RCPT TO:/.test(line)) { to = line; socket.write('250 OK\r\n'); }
        else if (line === 'DATA') { data = ''; socket.write('354 go\r\n'); }
        else if (line === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('500 ?\r\n');
      }
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, received, close: () => new Promise<void>(r => server.close(() => r())) };
}
const decode = (data: string) => Buffer.from(data.split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString('utf8');

test('Bildirim merkezi: important events become unread alerts (once), mark read; e-mail settings stay sealed, a test mail goes out, the queue sends and retries', async t => {
  let time = Date.parse('2026-10-04T09:00:00Z');
  const pair = await merkezPair('mail', { demo: true, now: () => new Date(time) }); t.after(() => pair.close());
  const smtp = await fakeSmtp('uygulama-sifresi-16'); t.after(() => smtp.close());
  await pair.importDemo(); await pair.adminLogin();
  // An application from a café: "Yeni hesap açma başvurusu"; its correction: "Başvuru yeniden gönderildi".
  const app = { requestId: rid(), installId: randomUUID(), machineId: 'e'.repeat(64), appVersion: '0.1.0', businessName: 'Bildirim Kafe', sector: 'cafe', contactName: 'Ayşe Yılmaz', consent: true, invoice: { legalName: 'Bildirim Kafe Ltd.', taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '6120069780', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 1', phone: '+905321234567', email: 'b@example.com' } };
  const post = (b: object) => fetch(`${pair.merkezBase}/api/merkez/v1/applications`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await post(app)).status, 200); assert.equal((await post({ ...app, businessName: 'Bildirim Kahve' })).status, 200);
  let state = (await pair.admin('/state')).data;
  assert.deepEqual(state.alerts.map((a: any) => a.kind), ['application.new', 'application.resubmitted']); assert.equal(state.unread, 2);
  assert.equal(state.alerts[0].title, 'Yeni hesap açma başvurusu'); assert.ok(state.alerts[0].tenantId, 'links to the business');
  // A support ticket from the café, and its follow-up message.
  const owner = pair.kafe(); await owner('/login', { username: 'isletme', password: 'MolaDemo!2026' });
  const ticket = (await owner('/staff/support', { requestId: rid(), subject: 'Yazıcı', text: 'Fiş çıkmıyor.' })).data;
  await pair.link.sync();
  await owner('/staff/support/reply', { requestId: rid(), ticketId: ticket.id, text: 'Hâlâ çıkmıyor.' }); await pair.link.sync(); await pair.link.sync();
  state = (await pair.admin('/state')).data;
  assert.deepEqual(state.alerts.slice(2).map((a: any) => [a.kind, a.ticketId]), [['ticket.new', ticket.id], ['ticket.reply', ticket.id]], 'each once');
  // The clock: a café silent for over 3 days, a licence ending within 7 days; each once.
  time += 4 * DAY; assert.equal(sweepAlerts(pair.merkezStore, new Date(time)), 2); assert.equal(sweepAlerts(pair.merkezStore, new Date(time)), 0);
  await pair.adminLogin(); state = (await pair.admin('/state')).data;
  assert.ok(state.alerts.some((a: any) => a.kind === 'cafe.offline' && a.tenantId === 'mola-demo'));
  const end = Date.parse(state.businesses.find((b: any) => b.tenantId === 'mola-demo').endsAt);
  time = end - 3 * DAY; await pair.link.sync(); sweepAlerts(pair.merkezStore, new Date(time));
  await pair.adminLogin(); state = (await pair.admin('/state')).data;
  assert.ok(state.alerts.some((a: any) => a.kind === 'license.expiring' && /3 gün içinde/.test(a.text)));
  // Read / unread.
  assert.equal((await pair.admin('/alerts/read', { ids: [state.alerts[0].id] })).data.unread, state.unread - 1);
  assert.equal((await pair.admin('/alerts/read', { all: true })).data.unread, 0);
  assert.equal((await pair.admin('/alerts/read', { ids: [state.alerts[0].id], unread: true })).data.unread, 1);
  // E-posta: plain SMTP only to a relay on this computer; settings saved sealed, the password never comes back.
  const settings = { enabled: true, host: '127.0.0.1', port: smtp.port, security: 'none', user: 'satici@example.com', password: 'uygulama-sifresi-16', to: 'satici@example.com' };
  assert.equal((await pair.admin('/email', { ...settings, host: 'smtp.example.com' })).data.code, 'EMAIL_SECURITY');
  assert.equal((await pair.admin('/email', { ...settings, to: 'yanlış' })).data.code, 'EMAIL_ADDRESS');
  const saved = (await pair.admin('/email', settings)).data;
  assert.equal(saved.settings.hasPassword, true); assert.equal(JSON.stringify(saved).includes('uygulama-sifresi'), false);
  assert.equal(JSON.stringify((await pair.admin('/state')).data).includes('uygulama-sifresi'), false);
  assert.equal((await pair.admin('/email', { ...settings, password: '' })).data.settings.hasPassword, true, 'an empty field keeps the saved password');
  const sent = await pair.admin('/email/test', {});
  assert.equal(sent.status, 200, JSON.stringify(sent.data)); assert.equal(smtp.received.length, 1);
  assert.match(decode(smtp.received[0].data), /deneme|e-posta bildirimleri/); assert.match(smtp.received[0].data, /Subject: =\?UTF-8\?B\?/);
  // From now on each important event is queued and sent.
  const queue = new MailQueue(pair.merkezStore, () => new Date(time));
  assert.equal((await post({ ...app, requestId: rid(), installId: randomUUID(), businessName: 'İkinci Başvuru', invoice: { ...app.invoice, taxNumber: '9000068418' } })).status, 200);
  assert.equal(await queue.tick(), 1); assert.equal(smtp.received.length, 2);
  assert.match(decode(smtp.received[1].data), /İkinci Başvuru/);
  // A wrong app password: a clear reason, tried again later, finally marked failed.
  await pair.admin('/email', { ...settings, password: 'yanlis-sifre' });
  const test = await pair.admin('/email/test', {});
  assert.equal(test.status, 409); assert.match(test.data.message, /uygulama şifresi kabul edilmedi/); assert.equal(test.data.message.includes('yanlis-sifre'), false);
  await post({ ...app, requestId: rid(), installId: randomUUID(), businessName: 'Üçüncü Başvuru', invoice: { ...app.invoice, taxNumber: '1111111114' } });
  for (let i = 0; i < MAIL_ATTEMPTS; i++) { await queue.tick(); time += 7 * 3600_000; }
  await pair.adminLogin(); const items = (await pair.admin('/email', undefined)).data.queue;
  assert.equal(items[0].failed, true); assert.equal(items[0].attempts, MAIL_ATTEMPTS); assert.match(items[0].error, /kabul edilmedi/);
});
