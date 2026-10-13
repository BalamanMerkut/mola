import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createMerkezApp } from '../server/merkez/app.js';
import { MerkezStore } from '../server/merkez/store.js';
import { LEAD_KEEP_DAYS, shortLinkOrigin } from '../server/merkez/site-leads.js';
import { checkSiteLead, SITE_CONSENT_VERSION, siteLeadPhone } from '../packages/domain/site-lead.js';
import { client, MERKEZ_PASSWORD, temp } from './merkez-fixture.js';

/*
 * Web sitesi talebi (server/merkez/site-leads.ts): molayazilim.com.tr's form → Mola Merkez → Mola Yönetim → Başvurular.
 */
const rid = () => randomUUID().replace(/-/g, '');
const DAY = 86400000;
async function merkez(name: string) {
  let time = Date.parse('2026-10-07T09:00:00Z');
  const store = new MerkezStore(join(temp(name), 'merkez'), randomBytes(32), { initialPassword: MERKEZ_PASSWORD });
  const app = createMerkezApp(store, { now: () => new Date(time) }), server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const site = client(`${base}/api/site`), admin = client(`${base}/api/merkez/admin`);
  return {
    store, base, site, admin,
    tick(ms: number) { time += ms; },
    async login() { assert.equal((await admin('/login', { username: 'admin', password: MERKEZ_PASSWORD })).status, 200); },
    /** A form key, then (seconds later) the form: what the page does. */
    async send(fields: Record<string, unknown> = {}, wait = 6000) {
      const key = await site('/form'); assert.equal(key.status, 200);
      time += wait;
      return site('/talep', { ...form(), token: key.data.token, ...fields });
    },
    async close() { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); (app.locals.relayHub as { close(): void } | undefined)?.close(); store.close(); },
  };
}
const form = () => ({ business: 'Çınaraltı Kafe', person: 'Ayşe Yılmaz', phone: '0532 123 45 67', email: 'ayse@example.com', city: 'Elazığ', tables: '16', type: 'kafe', message: 'Öğleden sonra arayabilirsiniz.', consent: true, consentVersion: SITE_CONSENT_VERSION, website: '' });

test('site form rules: phones, required fields, consent and its text version', () => {
  assert.equal(siteLeadPhone('0532 123 45 67'), '+905321234567');
  assert.equal(siteLeadPhone('+90 (424) 123 45 67'), '+904241234567');
  assert.equal(siteLeadPhone('532 123 4567'), '+905321234567');
  assert.equal(siteLeadPhone('0090 532 123 45 67'), '+905321234567');
  assert.equal(siteLeadPhone('+49 30 1234567'), '+49301234567');
  for (const bad of ['12345', 'beni ara', '0532 123 45', '+90 123 456 78 90']) assert.equal(siteLeadPhone(bad), undefined, bad);
  const ok = checkSiteLead(form());
  assert.ok(ok.ok); if (ok.ok) { assert.equal(ok.value.tables, 16); assert.equal(ok.value.phone, '+905321234567'); }
  const city = checkSiteLead({ ...form(), city: '' }); assert.ok(city.ok && city.value.city === 'Elazığ', 'Şehir defaults to Elazığ');
  const bare = checkSiteLead({ ...form(), tables: '', message: '' }); assert.ok(bare.ok && bare.value.email === 'ayse@example.com' && !('tables' in bare.value) && !('message' in bare.value));
  const fieldOf = (b: object) => { const r = checkSiteLead(b); return r.ok ? 'ok' : r.problem.field; };
  // The e-mail is required (13 Ekim): sign-ins and codes go there.
  assert.equal(fieldOf({ ...form(), email: '' }), 'email'); assert.equal(fieldOf({ ...form(), email: undefined }), 'email');
  assert.equal(fieldOf({ ...form(), business: ' ' }), 'business');
  assert.equal(fieldOf({ ...form(), person: 'A' }), 'person');
  assert.equal(fieldOf({ ...form(), phone: 'x' }), 'phone');
  assert.equal(fieldOf({ ...form(), email: 'ayse@' }), 'email');
  assert.equal(fieldOf({ ...form(), tables: '0' }), 'tables');
  assert.equal(fieldOf({ ...form(), tables: '2.5' }), 'tables');
  assert.equal(fieldOf({ ...form(), type: 'bar' }), 'type');
  assert.equal(fieldOf({ ...form(), message: 'x'.repeat(1501) }), 'message');
  assert.equal(fieldOf({ ...form(), consent: false }), 'consent');
  assert.equal(fieldOf({ ...form(), consent: 'true' }), 'consent');
  assert.equal(fieldOf({ ...form(), consentVersion: 'kvkk-eski' }), 'consentVersion');
});

test('web sitesi talebi: stored sealed with the KVKK tick, shown to the vendor as its own kind, a bell alert and a journal line without personal data', async t => {
  const m = await merkez('site-lead'); t.after(() => m.close());
  const sent = await m.send();
  assert.equal(sent.status, 201, JSON.stringify(sent.data)); assert.deepEqual(sent.data, { ok: true });
  assert.equal(sent.headers.get('cache-control'), 'no-store');
  // Only the vendor sees it.
  assert.equal((await m.admin('/site-leads')).status, 401);
  await m.login();
  const list = (await m.admin('/site-leads')).data;
  assert.equal(list.leads.length, 1); assert.deepEqual(list.counts, { new: 1, called: 0, closed: 0, open: 1, total: 1 });
  const lead = list.leads[0];
  assert.equal(lead.business, 'Çınaraltı Kafe'); assert.equal(lead.person, 'Ayşe Yılmaz'); assert.equal(lead.phone, '+905321234567'); assert.equal(lead.email, 'ayse@example.com');
  assert.equal(lead.city, 'Elazığ'); assert.equal(lead.tables, 16); assert.equal(lead.type, 'kafe'); assert.equal(lead.typeName, 'Kafe'); assert.equal(lead.status, 'new'); assert.equal(lead.statusName, 'Yeni');
  assert.deepEqual(lead.consent, { at: '2026-10-07T09:00:06.000Z', version: SITE_CONSENT_VERSION });
  // Sealed in its own table: the phone and the name are not readable in the database file.
  const raw = m.store.db.prepare('SELECT payload FROM site_talepleri').get() as { payload: Uint8Array };
  assert.ok(!Buffer.from(raw.payload).includes('5321234567') && !Buffer.from(raw.payload).includes('Ayşe'));
  // Bell: a "Web sitesi talebi" with type and city only (it may go out by e-mail).
  const state = (await m.admin('/state')).data;
  const alert = state.alerts.find((a: { kind: string }) => a.kind === 'site.lead');
  assert.ok(alert); assert.equal(alert.title, 'Web sitesi talebi'); assert.match(alert.text, /Kafe · Elazığ · 16 masa/);
  assert.ok(!/Ayşe|532|example|Çınaraltı/.test(alert.text)); assert.equal(state.unread, 1);
  // İşlem kayıtları: the line, with the consent version, without the person.
  const line = state.audit.find((a: { action: string }) => a.action === 'site.lead_received');
  assert.ok(line); assert.match(line.detail, new RegExp(`Talep ${lead.id.slice(0, 8)} \\(Kafe · Elazığ\\)`)); assert.match(line.detail, /kvkk-aydinlatma/);
  assert.ok(!/Ayşe|532|example|Çınaraltı/.test(line.detail));
  const journal = m.store.journal.count(); assert.ok(journal > 0);
  // The existing Başvurular (hesap açma başvuruları) are untouched: no business was made.
  assert.equal(state.businesses.length, 0);
});

test('honeypot, timing and forged keys: a bot is thanked and forgotten, too fast or a foreign key is refused', async t => {
  const m = await merkez('site-lead-guards'); t.after(() => m.close());
  await m.login();
  const trap = await m.send({ website: 'http://spam.example' });
  assert.equal(trap.status, 200); assert.deepEqual(trap.data, { ok: true });
  const fast = await m.send({}, 1500);
  assert.equal(fast.status, 400); assert.equal(fast.data.code, 'TOO_FAST'); assert.equal(fast.data.field, 'form');
  const key = await m.site('/form'); m.tick(6000);
  const [issued, nonce] = key.data.token.split('.');
  const forged = await m.site('/talep', { ...form(), token: `${issued}.${nonce}.${'A'.repeat(43)}` });
  assert.equal(forged.status, 400); assert.equal(forged.data.code, 'FORM_EXPIRED');
  assert.equal((await m.site('/talep', { ...form() })).data.code, 'FORM_EXPIRED', 'no key at all');
  const old = await m.site('/form'); m.tick(13 * 3600_000);
  const late = await m.site('/talep', { ...form(), token: old.data.token });
  assert.equal(late.status, 400); assert.equal(late.data.code, 'FORM_EXPIRED');
  // Wrong fields: the field and the sentence the form shows; nothing kept.
  const consent = await m.send({ consent: false });
  assert.equal(consent.status, 400); assert.equal(consent.data.code, 'CONSENT_REQUIRED'); assert.equal(consent.data.field, 'consent');
  const phone = await m.send({ phone: '12' });
  assert.equal(phone.status, 400); assert.equal(phone.data.field, 'phone'); assert.match(phone.data.message, /Telefon numarası geçersiz/);
  const version = await m.send({ consentVersion: 'kvkk-eski' });
  assert.equal(version.status, 400); assert.equal(version.data.field, 'consentVersion');
  await m.login(); // the admin session ended with the 13 hours above
  assert.equal((await m.admin('/site-leads')).data.leads.length, 0);
  assert.equal(((await m.admin('/state')).data.alerts as unknown[]).length, 0);
});

test('limits: one key is one lead (a double tap is not a second), 5 leads an hour per address, then 429', async t => {
  const m = await merkez('site-lead-limits'); t.after(() => m.close());
  await m.login();
  const key = await m.site('/form'); m.tick(6000);
  assert.equal((await m.site('/talep', { ...form(), token: key.data.token })).status, 201);
  const again = await m.site('/talep', { ...form(), token: key.data.token });
  assert.equal(again.status, 200); assert.equal(again.data.repeat, true);
  for (let i = 0; i < 4; i++) assert.equal((await m.send({ business: `Kafe ${i}` })).status, 201);
  const sixth = await m.send({ business: 'Fazla Kafe' });
  assert.equal(sixth.status, 429); assert.equal(sixth.data.code, 'RATE_LIMIT');
  assert.equal((await m.admin('/site-leads')).data.leads.length, 5);
  // An hour later the address may send again.
  m.tick(3600_000);
  assert.equal((await m.send({ business: 'Ertesi Saat Kafe' })).status, 201);
});

test('Mola Yönetim: Arandı, not, Kapandı, yeniden aç, işletmeye bağla, sil; each in İşlem kayıtları; closed leads go after LEAD_KEEP_DAYS', async t => {
  const m = await merkez('site-lead-admin'); t.after(() => m.close());
  await m.login();
  await m.send(); await m.send({ business: 'İkinci Kafe', type: 'restoran', city: 'Malatya' });
  const leads = (await m.admin('/site-leads')).data.leads as { id: string; business: string }[];
  const first = leads.find(l => l.business === 'Çınaraltı Kafe')!, second = leads.find(l => l.business === 'İkinci Kafe')!;
  assert.equal((await m.admin('/site-leads/status', { requestId: rid(), id: first.id, status: 'called' })).data.changed, true);
  assert.equal((await m.admin('/site-leads/note', { requestId: rid(), id: first.id, text: 'Pazartesi kurulum için uğranacak.' })).status, 200);
  assert.equal((await m.admin('/site-leads/note', { requestId: rid(), id: first.id, text: ' ' })).status, 400);
  let lead = (await m.admin('/site-leads')).data.leads.find((l: { id: string }) => l.id === first.id);
  assert.equal(lead.status, 'called'); assert.equal(lead.statusName, 'Arandı'); assert.equal(lead.notes[0].text, 'Pazartesi kurulum için uğranacak.');
  // "İşletme ekle" from the lead, then the link.
  const made = await m.admin('/businesses', { requestId: rid(), name: 'Çınaraltı Kafe', contactName: 'Ayşe Yılmaz', sector: 'cafe', kind: 'trial' });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.equal((await m.admin('/site-leads/link', { requestId: rid(), id: first.id, tenantId: made.data.tenantId })).status, 200);
  assert.equal((await m.admin('/site-leads/link', { requestId: rid(), id: first.id, tenantId: 'yok' })).status, 404);
  assert.equal((await m.admin('/site-leads/status', { requestId: rid(), id: first.id, status: 'closed' })).status, 200);
  lead = (await m.admin('/site-leads')).data.leads.find((l: { id: string }) => l.id === first.id);
  assert.equal(lead.tenantId, made.data.tenantId); assert.equal(lead.status, 'closed');
  assert.equal((await m.admin('/site-leads/status', { requestId: rid(), id: second.id, status: 'closed' })).status, 200);
  assert.equal((await m.admin('/site-leads/status', { requestId: rid(), id: second.id, status: 'new' })).status, 200);
  assert.deepEqual((await m.admin('/site-leads')).data.counts, { new: 1, called: 0, closed: 1, open: 1, total: 2 });
  const actions = ((await m.admin('/state')).data.audit as { action: string; detail?: string }[]).map(a => a.action);
  for (const a of ['site.lead_called', 'site.lead_note', 'site.lead_linked', 'site.lead_closed', 'site.lead_reopened']) assert.ok(actions.includes(a), a);
  const audit = (await m.admin('/state')).data.audit as { action: string; detail?: string }[];
  assert.ok(!audit.filter(a => a.action.startsWith('site.')).some(a => /Ayşe|532|Pazartesi/.test(a.detail ?? '')), 'no person, phone or note text in the history');
  // A repeated request (its answer lost) changes nothing twice.
  const once = { requestId: rid(), id: second.id, status: 'called' };
  await m.admin('/site-leads/status', once); assert.equal((await m.admin('/site-leads/status', once)).data.changed, true);
  assert.equal((await m.admin('/site-leads/status', { ...once, status: 'closed' })).status, 409);
  // Closed for longer than LEAD_KEEP_DAYS: gone (the open one stays).
  m.tick((LEAD_KEEP_DAYS + 1) * DAY);
  await m.login();
  const left = (await m.admin('/site-leads')).data.leads as { id: string }[];
  assert.deepEqual(left.map(l => l.id), [second.id]);
  // "Sil" (a KVKK request): gone now, the history says so.
  assert.equal((await m.admin('/site-leads/delete', { requestId: rid(), id: second.id })).status, 200);
  assert.equal((await m.admin('/site-leads')).data.leads.length, 0);
  assert.ok(((await m.admin('/state')).data.audit as { action: string }[]).some(a => a.action === 'site.lead_deleted'));
  assert.equal((await m.admin('/site-leads/delete', { requestId: rid(), id: second.id })).status, 404);
});

test('the site shows Mola Yönetim’s contact: GET /api/site/iletisim, only the four public fields, empty ones left out; a lead without e-mail is refused', async t => {
  const m = await merkez('site-contact'); t.after(() => m.close());
  // Nothing saved yet: an empty answer (the site keeps its own).
  const none = await m.site('/iletisim');
  assert.equal(none.status, 200); assert.deepEqual(none.data, { contact: {} }); assert.equal(none.headers.get('cache-control'), 'public, max-age=60');
  await m.login();
  const saved = await m.admin('/contact', { phone: '0538 049 20 02', whatsapp: '0538 049 20 02', email: 'destek@example.com', hours: '', web: 'https://molayazilim.com.tr/' });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const c = (await m.site('/iletisim')).data.contact;
  assert.deepEqual(Object.keys(c).sort(), ['email', 'phone', 'whatsapp'], 'no web, no empty hours');
  assert.equal(c.email, 'destek@example.com'); assert.match(c.phone, /538/);
  // The e-mail is required on the site form now.
  const bare = await m.send({ email: '' });
  assert.equal(bare.status, 400); assert.equal(bare.data.field, 'email');
});

test('social short links: MERKEZ_SITE_ORIGIN (the web site) when set, else PUBLIC_ORIGIN; a wrong value never breaks anything', () => {
  const before = process.env.MERKEZ_SITE_ORIGIN;
  try {
    delete process.env.MERKEZ_SITE_ORIGIN;
    assert.equal(shortLinkOrigin('https://merkez.molayazilim.com.tr'), 'https://merkez.molayazilim.com.tr');
    assert.equal(shortLinkOrigin(undefined), undefined);
    process.env.MERKEZ_SITE_ORIGIN = 'https://molayazilim.com.tr';
    assert.equal(shortLinkOrigin('https://merkez.molayazilim.com.tr'), 'https://molayazilim.com.tr');
    process.env.MERKEZ_SITE_ORIGIN = 'http://molayazilim.com.tr/yol';
    assert.equal(shortLinkOrigin('https://merkez.molayazilim.com.tr'), 'https://merkez.molayazilim.com.tr');
  } finally { if (before === undefined) delete process.env.MERKEZ_SITE_ORIGIN; else process.env.MERKEZ_SITE_ORIGIN = before; }
});
