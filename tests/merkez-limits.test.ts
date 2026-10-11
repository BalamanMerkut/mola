import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { signedHeaders } from '../server/install-auth.js';
import { MESSAGES_PER_DAY, TICKETS_PER_DAY } from '../server/merkez/app.js';
import { MERKEZ_API } from '../server/sync-protocol.js';
import { merkezPair } from './merkez-fixture.js';

test('limits: per address before anything is read; per business a day for tickets from the heartbeat (the rest waits on the café)', async t => {
  const pair = await merkezPair('limits', { demo: true }); t.after(() => pair.close());
  const { installId } = await pair.importDemo();
  // Applications: 30 an hour per address, counted before the body is even checked or the registry read.
  let reads = 0; const read = pair.merkezStore.read.bind(pair.merkezStore); pair.merkezStore.read = () => { reads++; return read(); };
  const send = () => fetch(`${pair.merkezBase}${MERKEZ_API}/applications`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  for (let i = 0; i < 30; i++) assert.equal((await send()).status, 400);
  reads = 0;
  assert.equal((await send()).status, 429); assert.equal(reads, 0, 'refused without touching the registry');
  pair.merkezStore.read = read;
  // Tickets through the heartbeat: at most TICKETS_PER_DAY new ones a day per business; the others are not acknowledged.
  const record = pair.link.read()!, body = pair.link.payload(record);
  body.tickets = Array.from({ length: TICKETS_PER_DAY + 5 }, (_, i) => ({ id: randomUUID(), tenantId: 'mola-demo', subject: `Talep ${i}`, createdAt: new Date().toISOString(), messages: [{ id: randomUUID(), text: 'Yardım', at: new Date().toISOString() }] }));
  const text = JSON.stringify(body), path = `${MERKEZ_API}/sync`;
  const r = await fetch(pair.merkezBase + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedHeaders(installId, record.secret, 'POST', path, text, Date.now()) }, body: text });
  assert.equal(r.status, 200);
  const answer = await r.json() as { delivered: { messages: string[] } };
  assert.equal(answer.delivered.messages.length, TICKETS_PER_DAY, 'the rest stays queued on the café for tomorrow');
  assert.equal(pair.merkezStore.read().tickets.length, TICKETS_PER_DAY);
  assert.ok(MESSAGES_PER_DAY >= 100);
});
