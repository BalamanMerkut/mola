import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { announcementText, linkParts } from '../packages/domain/announcement.js';
import { DEMO_PASSWORD } from '../server/app.js';
import { signedHeaders } from '../server/install-auth.js';
import { MailQueue } from '../server/merkez/mail.js';
import { MERKEZ_API, syncRequest } from '../server/sync-protocol.js';
import { MERKEZ_PASSWORD, merkezPair } from './merkez-fixture.js';

/*
 * Duyurular (server/merkez/announcements.ts, server/kafe-link.ts) and the Mola team's "Yeni mesaj": targeting, the
 * Authenticator step-up, heartbeat delivery (and nothing for an older café), edit / withdraw, read marks and the owner's
 * "Okudum", roles on the café, the e-mail copy counted through the vendor's mail queue, and a conversation the Mola team
 * starts reaching the café as an unread ticket.
 */
const rid = () => randomUUID().replace(/-/g, '');
const PASSWORD = 'MudurDeneme!2026';
const pdf = () => Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');
const SMTP = { enabled: true, host: 'smtp.example.com', port: 465, security: 'tls' as const, user: 'bildirim@example.com', password: 'uygulama-sifresi', to: 'satici@example.com', updatedAt: new Date().toISOString() };

/** Merkez + a café with the two demo businesses imported and linked; the café has heard 'announcements' in `accepts`. */
async function setup(name: string, t: { after: (fn: () => Promise<void>) => void }) {
  const pair = await merkezPair(name, { demo: true }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin();
  assert.equal((await pair.link.sync()).ok, true);
  assert.ok(pair.link.read()!.accepts?.includes('announcements'));
  const login = async (username: string, password = DEMO_PASSWORD) => { const c = pair.kafe(); assert.equal((await c('/login', { username, password })).status, 200, username); return c; };
  return { pair, login };
}

test('plain text: hidden marks go, lines stay; links are found without HTML', () => {
  assert.equal(announcementText('Merhaba\r\nyarın‮ bakım\u0000 var.\n\n\n\n\nGörüşmek üzere'), 'Merhaba\nyarın bakım var.\n\n\nGörüşmek üzere');
  assert.deepEqual(linkParts('Ayrıntı: https://mola.example/duyuru, ya da www.mola.example.'), [{ text: 'Ayrıntı: ' }, { text: 'https://mola.example/duyuru', href: 'https://mola.example/duyuru' }, { text: ', ya da ' }, { text: 'www.mola.example', href: 'https://www.mola.example' }, { text: '.' }]);
  assert.deepEqual(linkParts('<script>alert(1)</script>'), [{ text: '<script>alert(1)</script>' }]);
});

test('step-up: without two-step login, without the code, and inside the 10-minute window (send, edit, withdraw)', async t => {
  const { pair } = await setup('announce-step-up', t);
  const body = () => ({ requestId: rid(), title: 'Bakım duyurusu', text: 'Pazar 02:00–03:00 arası bakım var.', important: false, audience: { kind: 'all' } });
  let r = await pair.admin('/announcements', body());
  assert.equal(r.status, 403); assert.equal(r.data.code, 'MFA_REQUIRED'); assert.match(r.data.message, /Duyuru göndermek/);
  pair.merkezStore.mutate(d => { d.admin.mfa = { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', lastStep: -1, recoveryHashes: [] }; });
  r = await pair.admin('/announcements', body());
  assert.equal(r.status, 403); assert.equal(r.data.code, 'STEP_UP_REQUIRED');
  assert.equal(pair.merkezStore.read().announcements, undefined, 'nothing kept from a refused send');
  // Reading the list never asks for a code.
  assert.equal((await pair.admin('/announcements')).status, 200);
  await pair.adminStepUp();
  r = await pair.admin('/announcements', body());
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.tenants, 2);
  const id = r.data.id;
  // The window closed ("Yetkiyi kapat"): edit and withdraw are refused until the next code.
  assert.equal((await pair.admin('/releases/yetki/kapat', {})).status, 200);
  assert.equal((await pair.admin('/announcements/edit', { requestId: rid(), id, title: 'Yeni başlık', text: 'Yeni metin burada.', important: true })).data.code, 'STEP_UP_REQUIRED');
  assert.equal((await pair.admin('/announcements/withdraw', { requestId: rid(), id })).data.code, 'STEP_UP_REQUIRED');
  await pair.adminStepUp();
  assert.equal((await pair.admin('/announcements/edit', { requestId: rid(), id, title: 'Yeni başlık', text: 'Yeni metin burada.', important: true })).data.changed, true);
  assert.equal((await pair.admin('/announcements/withdraw', { requestId: rid(), id })).status, 200);
  assert.equal((await pair.admin('/announcements/edit', { requestId: rid(), id, title: 'Bir daha', text: 'Olmaz bu.', important: false })).data.code, 'WITHDRAWN');
  // İşlem kayıtları: each step with the audience.
  const audit = pair.merkezStore.read().audit.filter(a => a.action.startsWith('announcement.'));
  assert.deepEqual(audit.map(a => a.action), ['announcement.sent', 'announcement.edited', 'announcement.withdrawn']);
  assert.match(audit[0].detail!, /“Bakım duyurusu” · Tüm işletmeler · 2 işletme/);
  assert.match(audit[1].detail!, /değişen: başlık, metin, önemli/);
  assert.match(audit[2].detail!, /“Yeni başlık” · Tüm işletmeler · 2 işletme · okuyan 0/);
});

test('targeting: all, packages and chosen businesses are fixed at sending; suspended and never-activated ones are left out', async t => {
  const { pair } = await setup('announce-targets', t);
  await pair.adminStepUp();
  pair.merkezStore.mutate(d => {
    const at = new Date().toISOString();
    d.businesses.find(b => b.tenantId === 'mola-demo')!.services = { packageId: 'kafe-standart', features: ['core'], updatedAt: at };
    d.businesses.find(b => b.tenantId === 'other-demo')!.services = { packageId: 'restoran-pro', features: ['core'], updatedAt: at };
  });
  // A business with a code nobody used: no computer, so no announcement can reach it.
  const waiting = (await pair.admin('/businesses', { requestId: rid(), name: 'Bekleyen Kafe', kind: 'trial' })).data.tenantId;
  const send = (audience: object, title = 'Duyuru başlığı') => pair.admin('/announcements', { requestId: rid(), title, text: 'Duyuru metni burada.', important: false, audience });
  const tenantsOf = (id: string) => pair.merkezStore.read().announcements!.find(a => a.id === id)!.tenants.sort();
  assert.deepEqual(tenantsOf((await send({ kind: 'all' })).data.id), ['mola-demo', 'other-demo']);
  assert.deepEqual(tenantsOf((await send({ kind: 'packages', packageIds: ['kafe-standart'] })).data.id), ['mola-demo']);
  assert.deepEqual(tenantsOf((await send({ kind: 'packages', packageIds: ['kafe-standart', 'restoran-pro'] })).data.id), ['mola-demo', 'other-demo']);
  assert.equal((await send({ kind: 'packages', packageIds: ['yok-boyle'] })).data.code, 'PACKAGE_NOT_FOUND');
  assert.deepEqual(tenantsOf((await send({ kind: 'selected', tenantIds: ['other-demo', waiting] })).data.id), ['other-demo']);
  assert.equal((await send({ kind: 'selected', tenantIds: [waiting] })).data.code, 'NO_AUDIENCE');
  // Suspended: not in "all" or a package, but a chosen one still gets it.
  pair.merkezStore.mutate(d => { d.businesses.find(b => b.tenantId === 'other-demo')!.suspended = true; });
  assert.deepEqual(tenantsOf((await send({ kind: 'all' })).data.id), ['mola-demo']);
  assert.deepEqual(tenantsOf((await send({ kind: 'selected', tenantIds: ['other-demo'] })).data.id), ['other-demo']);
  // The list says who it went to and how many read it.
  const list = (await pair.admin('/announcements')).data.announcements;
  assert.equal(list[0].audienceText, 'Seçili işletmeler'); assert.equal(list[0].total, 1); assert.equal(list[0].read, 0);
  assert.equal(list.find((a: any) => a.audience.kind === 'packages' && a.total === 1).audienceText, 'Paket: Kafe Standart');
  assert.ok(list.every((a: any) => !a.businesses.some((b: any) => b.tenantId === waiting)));
});

test('heartbeat delivery, roles, read marks, Önemli "Okudum", edit and withdraw; an older café never gets the field', async t => {
  const { pair, login } = await setup('announce-delivery', t);
  await pair.adminStepUp();
  const owner = await login('isletme'), cashier = await login('kasiyer'), waiter = await login('garson'), kitchen = await login('mutfak');
  assert.equal((await owner('/staff/users', { username: 'mudur', name: 'Müdür Mehmet', role: 'manager', password: PASSWORD })).status, 200);
  const manager = await login('mudur', PASSWORD);
  const sent = await pair.admin('/announcements', { requestId: rid(), title: 'Yeni sürüm geliyor', text: 'Merhaba,\nyarın yeni sürüm kuruluyor.\nAyrıntı: https://mola.example/surum', important: true, audience: { kind: 'all' } });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  const id = sent.data.id;

  // Nothing yet on the café; the next heartbeat brings it (the café now asks with its versions and read marks).
  assert.equal((await owner('/staff/announcements')).data.items.length, 0);
  assert.equal((await pair.link.sync()).ok, true);
  let view = (await owner('/staff/announcements')).data;
  assert.equal(view.items.length, 1); assert.equal(view.unread, 1); assert.equal(view.items[0].text, 'Merhaba,\nyarın yeni sürüm kuruluyor.\nAyrıntı: https://mola.example/surum');
  assert.equal(view.pending.id, id, 'the owner gets the Önemli window');
  assert.equal((await manager('/staff/announcements')).data.pending, null, 'the Müdür gets no window');
  // Cashier, waiter and kitchen never see announcements (and cannot mark them).
  for (const c of [cashier, waiter, kitchen]) { assert.equal((await c('/staff/announcements')).status, 403); assert.equal((await c('/staff/announcements/read', { ids: [id] })).status, 403); }
  assert.equal((await manager('/staff/announcements/ack', { id })).status, 403, 'only the owner says "Okudum"');
  // The other business on this computer has it too, its own way.
  assert.deepEqual(pair.link.read()!.announcements![0].tenants.sort(), ['mola-demo', 'other-demo']);

  // The Müdür opens it: read for the Müdür (the owner's dot stays) and, for Mola, the business read it.
  view = (await manager('/staff/announcements/read', { ids: [id] })).data;
  assert.equal(view.unread, 0);
  assert.equal((await owner('/staff/announcements')).data.unread, 1);
  await pair.link.sync();
  let row = (await pair.admin('/announcements')).data.announcements[0];
  assert.equal(row.read, 1); assert.equal(row.total, 2); assert.equal(row.acknowledged, 0);
  assert.equal(row.businesses.find((b: any) => b.tenantId === 'mola-demo').by, 'manager');
  assert.equal(pair.link.payload(pair.link.read()!).announcements!.reads.length, 0, 'told once');
  // The owner's "Okudum": acknowledged; the window does not come back.
  view = (await owner('/staff/announcements/ack', { id })).data;
  assert.equal(view.pending, null); assert.equal(view.items[0].acknowledged, true); assert.equal(view.unread, 0);
  await pair.link.sync();
  row = (await pair.admin('/announcements')).data.announcements[0];
  assert.equal(row.read, 1); assert.equal(row.acknowledged, 1);
  const mark = row.businesses.find((b: any) => b.tenantId === 'mola-demo');
  assert.equal(mark.by, 'manager', 'the first reader stays'); assert.ok(mark.ackAt);

  // Edit: new text and "düzenlendi" on the café with the next heartbeat; the read marks stay.
  assert.equal((await pair.admin('/announcements/edit', { requestId: rid(), id, title: 'Yeni sürüm yarın', text: 'Saat 22:00’de kuruluyor.', important: true })).data.changed, true);
  await pair.link.sync();
  view = (await owner('/staff/announcements')).data;
  assert.equal(view.items[0].title, 'Yeni sürüm yarın'); assert.ok(view.items[0].editedAt); assert.equal(view.items[0].acknowledged, true);
  assert.equal(pair.link.read()!.announcements![0].v, 2);

  // An older café: its heartbeat has no `announcements` (strict schema of its time) and its answer carries none.
  const record = pair.link.read()!, old = pair.link.payload({ ...record, accepts: record.accepts!.filter(x => x !== 'announcements') });
  assert.equal(old.announcements, undefined); syncRequest.parse(old);
  const text = JSON.stringify(old), path = `${MERKEZ_API}/sync`;
  const answer = await fetch(pair.merkezBase + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedHeaders(record.installId, record.secret, 'POST', path, text, Date.now()) }, body: text });
  assert.equal(answer.status, 200); const data = await answer.json();
  assert.equal('announcements' in data, false);
  assert.ok(data.licenses.length > 0, 'licences, the signed parts an older café checks, are as before');

  // Withdraw: gone from the café with the next heartbeat (read marks too); Mola Yönetim keeps it as "geri çekildi".
  assert.equal((await pair.admin('/announcements/withdraw', { requestId: rid(), id })).status, 200);
  await pair.link.sync();
  assert.equal((await owner('/staff/announcements')).data.items.length, 0);
  assert.deepEqual(Object.keys(pair.link.read()!.announcementReads!['mola-demo'] ?? {}), []);
  assert.ok((await pair.admin('/announcements')).data.announcements[0].withdrawnAt);
});

test('e-mail copy: only with the vendor’s e-mail set up; each business with an e-mail once; the queue counts what went', async t => {
  const { pair } = await setup('announce-mail', t);
  await pair.adminStepUp();
  const body = { title: 'Fiyat duyurusu', text: 'Yeni fiyatlar Kasım’da başlıyor.', important: false, audience: { kind: 'all' }, email: true };
  assert.equal((await pair.admin('/announcements', { requestId: rid(), ...body })).data.code, 'EMAIL_OFF');
  assert.equal((await pair.admin('/announcements')).data.emailReady, false);
  pair.merkezStore.mutate(d => {
    d.mail = { settings: { ...SMTP }, queue: [] };
    d.businesses.find(b => b.tenantId === 'mola-demo')!.invoice = { legalName: 'Mola Demo Ltd.', taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1234567890', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. 1', phone: '+905321234567', email: 'sahip@example.com' };
  });
  assert.equal((await pair.admin('/announcements')).data.emailReady, true);
  const r = await pair.admin('/announcements', { requestId: rid(), ...body });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.deepEqual(r.data.email, { queued: 1, sent: 0, failed: 0, missing: 1 });
  // The vendor's queue sends it (a fake mailer: no real e-mail) and counts it on the announcement.
  const sent: { to: string; subject: string; text: string }[] = [];
  const queue = new MailQueue(pair.merkezStore, () => new Date(), async (_s, to, subject, text) => { sent.push({ to, subject, text }); });
  await queue.tick();
  assert.deepEqual(sent.map(m => [m.to, m.subject]), [['sahip@example.com', 'Mola: Fiyat duyurusu']]);
  assert.match(sent[0].text, /Yeni fiyatlar Kasım’da başlıyor\.[\s\S]*Destek → Duyurular/);
  const row = (await pair.admin('/announcements')).data.announcements[0];
  assert.deepEqual(row.email, { queued: 1, sent: 1, failed: 0, missing: 1 });
  // A copy that keeps failing is counted once as failed after its last retry.
  const again = await pair.admin('/announcements', { requestId: rid(), ...body, title: 'İkinci duyuru' });
  pair.merkezStore.mutate(d => { for (const m of d.mail!.queue) if (m.announcementId === again.data.id) m.attempts = 5; });
  await new MailQueue(pair.merkezStore, () => new Date(), async () => { throw new Error('SMTP kapalı'); }).tick();
  assert.deepEqual((await pair.admin('/announcements')).data.announcements[0].email, { queued: 1, sent: 0, failed: 1, missing: 1 });
});

test('"Yeni mesaj": the Mola team starts a conversation; the café gets it as an unread ticket and answers in it', async t => {
  const { pair, login } = await setup('announce-ticket', t);
  const owner = await login('isletme');
  const notificationsBefore = (await owner('/staff/notifications/count')).data.unread;
  // A file first (tied to the business, then to the message); no step-up for one business.
  const cookie = (await fetch(`${pair.merkezBase}/api/merkez/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: MERKEZ_PASSWORD }) })).headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const upload = await fetch(`${pair.merkezBase}/api/merkez/admin/attachments?tenantId=mola-demo&name=fiyat.pdf`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(pdf()) });
  assert.equal(upload.status, 200); const file = (await upload.json()).attachment;
  assert.equal((await fetch(`${pair.merkezBase}/api/merkez/admin/attachments?tenantId=yok&name=x.pdf`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(pdf()) })).status, 404);
  const id = randomUUID();
  const r = await pair.admin('/tickets', { requestId: rid(), id, tenantId: 'mola-demo', subject: 'Yıllık aboneliğiniz', text: 'Merhaba, aboneliğiniz ay sonunda bitiyor.', attachments: [file.id] });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.id, id);
  // A business without a computer cannot get one; an empty message is refused.
  const waiting = (await pair.admin('/businesses', { requestId: rid(), name: 'Bekleyen Kafe', kind: 'trial' })).data.tenantId;
  assert.equal((await pair.admin('/tickets', { requestId: rid(), tenantId: waiting, subject: 'Merhaba', text: 'Deneme mesajı' })).data.code, 'NOT_ACTIVATED');
  assert.equal((await pair.admin('/tickets', { requestId: rid(), tenantId: 'mola-demo', subject: 'Merhaba', text: '' })).status, 400);
  const ticket = pair.merkezStore.read().tickets.find(x => x.id === id)!;
  assert.equal(ticket.messages[0].source, 'support'); assert.equal(ticket.messages[0].attachments?.[0].id, file.id);
  assert.match(pair.merkezStore.read().audit.find(a => a.action === 'ticket.started')!.detail!, /“Yıllık aboneliğiniz” · 1 ek/);

  // The café: an ordinary ticket in the heartbeat answer (the same fields as always), a Mola message first.
  await pair.link.sync();
  const cafe = (await owner('/staff/support')).data.tickets.find((x: any) => x.id === id);
  assert.ok(cafe); assert.equal(cafe.messages[0].source, 'support'); assert.equal(cafe.status, 'open');
  assert.deepEqual(Object.keys(cafe).sort(), ['createdAt', 'id', 'messages', 'status', 'subject', 'tenantId']);
  // Destek's red dot: one notice "Mola ekibinden mesaj".
  assert.equal((await owner('/staff/notifications/count')).data.unread, notificationsBefore + 1);
  assert.ok((await owner('/staff/notifications')).data.items.some((n: any) => n.title === 'Mola ekibinden mesaj' && /Yıllık aboneliğiniz/.test(n.text)));
  // The owner reads the file and answers in the same thread; Mola Yönetim gets the answer.
  assert.equal((await owner(`/staff/support/attachments/${file.id}`)).status, 200);
  assert.equal((await owner('/staff/support/reply', { requestId: rid(), ticketId: id, text: 'Teşekkürler, yenileyeceğiz.' })).status, 200);
  await pair.link.sync();
  const back = pair.merkezStore.read().tickets.find(x => x.id === id)!;
  assert.deepEqual(back.messages.map(m => m.source), ['support', 'business']);
  // The other business on the same computer does not see it.
  const other = await login('diger');
  assert.equal((await other('/staff/support')).data.tickets.some((x: any) => x.id === id), false);
});
