import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Request } from 'express';
import { createMerkezApp, REJECTED_KEEP_DAYS, SUPPORT_KEEP_DAYS } from '../server/merkez/app.js';
import { MerkezStore } from '../server/merkez/store.js';
import { addressMark, contextFor, hashEntry, journalRows, type JournalEntry } from '../server/merkez/journal.js';
import { open, seal } from '../server/sealing.js';
import { MERKEZ_PASSWORD, temp } from './merkez-fixture.js';
// @ts-expect-error plain .mjs without types: the independent verifier (no Mola code inside)
import { check as independentCheck, load as independentLoad } from '../scripts/islem-dogrula.mjs';

/*
 * Saklama süreleri (8 Ekim; the lawyer may change them): İşlem kayıtları IP addresses after 1 year (the hash chain stays
 * verifiable, also by the independent checker), closed support conversations after 2 years, rejected applications after 1.
 */
const DAY = 86_400_000;
function merkez(name: string) {
  const dir = temp(name), key = randomBytes(32), store = new MerkezStore(join(dir, 'merkez'), key, { initialPassword: MERKEZ_PASSWORD });
  const app = createMerkezApp(store);
  return { dir, key, store, app, close: () => { (app.locals.relayHub as { close(): void }).close(); store.close(); } };
}
const rowKey = (key: Buffer) => createHash('sha256').update(key).update('mola-islem-kayitlari:v1').digest();
const exportCheck = (m: ReturnType<typeof merkez>, name: string) => { const file = join(m.dir, `${name}.jsonl`); writeFileSync(file, m.store.journal.jsonl().text); return independentCheck(independentLoad(file)); };

test('a new line keeps its IP address apart (only a salted SHA-256 in the chain); after a year it is deleted and nothing in the chain changes', t => {
  const m = merkez('ip-yeni'); t.after(m.close);
  const j = m.store.journal;
  const line = j.append({ action: 'admin.login_failed', address: '203.0.113.5', source: 'uzak' });
  assert.equal(line.entry.address, undefined, 'never inside the chained content');
  assert.equal(line.entry.addressMark, addressMark(line.address!.salt, '203.0.113.5'));
  assert.equal(journalRows(j.entries()).find(r => r.seq === line.entry.seq)!.address, '203.0.113.5', 'the screen still shows it');
  assert.equal(j.verify().ok, true);
  let r = exportCheck(m, 'once'); assert.equal(r.ok, true, r.text);
  // The address apart cannot be swapped: the chain committed to it.
  const before = m.store.db.prepare('SELECT payload FROM islem_adresleri WHERE seq=?').get(line.entry.seq) as { payload: Uint8Array };
  m.store.db.prepare('UPDATE islem_adresleri SET payload=? WHERE seq=?').run(seal({ address: '198.51.100.1', salt: line.address!.salt }, rowKey(m.key), `merkez-islem-adres:${line.entry.seq}`), line.entry.seq);
  const broken = j.verify(); assert.equal(broken.ok, false); assert.equal(broken.problem!.seq, line.entry.seq); assert.match(broken.text, /adres/);
  m.store.db.prepare('UPDATE islem_adresleri SET payload=? WHERE seq=?').run(before.payload, line.entry.seq);
  const hashes = j.entries().map(s => s.hash);
  // Not a year yet: kept. A year and a day: gone; the chain (every hash) as it was, the deletion is a line of its own.
  assert.equal(j.maskAddresses(new Date(Date.now() + 300 * DAY)), 0);
  assert.equal(j.maskAddresses(new Date(Date.now() + 367 * DAY)), 1);
  assert.equal((m.store.db.prepare('SELECT COUNT(*) AS n FROM islem_adresleri').get() as { n: number }).n, 0);
  assert.deepEqual(j.entries().slice(0, hashes.length).map(s => s.hash), hashes);
  assert.equal(journalRows(j.entries()).find(r => r.seq === line.entry.seq)!.address, undefined);
  assert.equal(j.entries().at(-1)!.entry.action, 'journal.addresses_masked');
  assert.equal(j.verify().ok, true);
  r = exportCheck(m, 'sonra'); assert.equal(r.ok, true, r.text);
});

test('an older line with its address in the chained content is rewritten without it, listed with both hashes; the chain still verifies, a later edit does not', t => {
  const m = merkez('ip-eski'); t.after(m.close);
  const j = m.store.journal, k = rowKey(m.key), head = j.head()!;
  // A line as a version before 8 Ekim wrote it: the address inside the entry (and so inside its hash).
  const old: JournalEntry = { v: 1, seq: head.seq + 1, at: new Date(Date.now() - 400 * DAY).toISOString(), actor: { kind: 'admin', id: 'admin', name: 'Yönetici' }, action: 'admin.login', text: 'Yönetici girişi', source: 'uzak', result: 'basarili', address: '198.51.100.7', prev: head.hash };
  const oldHash = hashEntry(old);
  m.store.db.prepare('INSERT INTO islem_kayitlari (seq, at, hash, prev, payload) VALUES (?,?,?,?,?)').run(old.seq, old.at, oldHash, old.prev, seal(old, k, `merkez-islem:${old.seq}`));
  j.append({ action: 'admin.logout' });
  assert.equal(j.verify().ok, true);
  assert.equal(j.maskAddresses(), 1);
  const stored = j.entries().find(s => s.entry.seq === old.seq)!;
  assert.equal(stored.entry.address, undefined); assert.ok(stored.entry.masked); assert.equal(stored.hash, oldHash, 'its place in the chain unchanged');
  const record = j.entries().at(-1)!.entry;
  assert.equal(record.action, 'journal.addresses_masked'); assert.deepEqual(record.masks, [{ seq: old.seq, hash: oldHash, masked: hashEntry(stored.entry) }]);
  assert.equal(j.verify().ok, true);
  const r = exportCheck(m, 'maske'); assert.equal(r.ok, true, r.text);
  assert.ok(!m.store.journal.jsonl().text.includes('198.51.100.7'));
  // The masked line cannot be edited afterwards (by someone who gets past the triggers): the masking record says what it was.
  m.store.db.exec('DROP TRIGGER islem_degismez; DROP TRIGGER islem_ozet_degismez;');
  const e = open<JournalEntry>(Buffer.from((m.store.db.prepare('SELECT payload FROM islem_kayitlari WHERE seq=?').get(old.seq) as { payload: Uint8Array }).payload), k, `merkez-islem:${old.seq}`);
  e.text = 'değiştirildi';
  m.store.db.prepare('UPDATE islem_kayitlari SET payload=? WHERE seq=?').run(seal(e, k, `merkez-islem:${old.seq}`), old.seq);
  const v = j.verify(); assert.equal(v.ok, false); assert.equal(v.problem!.seq, old.seq);
});

test('closed support conversations go 2 years after their last message, rejected applications 1 year after the decision; open and newer ones stay', t => {
  const m = merkez('saklama'); t.after(m.close);
  const now = Date.now(), iso = (ms: number) => new Date(ms).toISOString();
  const ticket = (id: string, status: 'open' | 'closed', last: number) => ({ id, tenantId: 'isletme-1', subject: 'Yazıcı sorunu', status, createdAt: iso(last - DAY), messages: [{ id: randomUUID(), source: 'business' as const, text: 'Merhaba, fiş çıkmıyor. Telefonum 0532 000 00 00', at: iso(last) }] });
  const old = randomUUID(), recent = randomUUID(), open = randomUUID();
  m.store.mutate(d => {
    d.tickets.push(ticket(old, 'closed', now - (SUPPORT_KEEP_DAYS + 1) * DAY), ticket(recent, 'closed', now - 30 * DAY), ticket(open, 'open', now - (SUPPORT_KEEP_DAYS + 30) * DAY));
    const app = (decided: number, tenantId: string) => ({ tenantId, name: `Reddedilen ${tenantId}`, source: 'application' as const, serial: 0, kind: 'trial' as const, endsAt: null, suspended: false, service: 'full' as const, createdAt: iso(decided - DAY),
      application: { status: 'rejected' as const, installId: randomUUID(), activationId: randomUUID(), machineId: 'a'.repeat(64), appVersion: '0.1.0', submittedAt: iso(decided - DAY), decidedAt: iso(decided), reason: 'Eksik bilgi' } });
    d.businesses.push(app(now - (REJECTED_KEEP_DAYS + 2) * DAY, 'red-eski'), app(now - 10 * DAY, 'red-yeni'));
  });
  const result = (m.app.locals.retention as (at?: Date) => { tickets: number; applications: number })(new Date(now));
  assert.equal(result.tickets, 1); assert.equal(result.applications, 1);
  const d = m.store.read();
  assert.deepEqual(d.tickets.map(x => x.id).sort(), [recent, open].sort());
  assert.deepEqual(d.businesses.map(b => b.tenantId).filter(x => x.startsWith('red-')), ['red-yeni']);
  const lines = m.store.journal.entries().map(s => s.entry);
  assert.ok(lines.some(e => e.action === 'ticket.deleted_retention')); assert.ok(lines.some(e => e.action === 'application.deleted_retention'));
  assert.ok(!JSON.stringify(lines.filter(e => e.action === 'ticket.deleted_retention')).includes('0532'), 'no personal data in the record of the deletion');
});

test('the web site form is a visitor’s: its address is never written into İşlem kayıtları', () => {
  const req = (path: string) => ({ path, ip: '203.0.113.9', socket: { remoteAddress: '203.0.113.9' }, headers: {}, get: () => undefined } as unknown as Request);
  assert.equal(contextFor(req('/api/site/talep')).address, undefined);
  assert.equal(contextFor(req('/api/merkez/admin/login')).address, '203.0.113.9');
});
