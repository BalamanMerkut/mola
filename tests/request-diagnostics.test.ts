import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FailureEvent } from '../server/request-diagnostics.js';
import { merkezPair } from './merkez-fixture.js';

test('diagnostics correlate failures without credentials, money, URLs or internal error details', async t => {
  const events: FailureEvent[] = [];
  const pair = await merkezPair('diagnostics', { demo: true, logFailure: event => events.push(event) }), { store } = pair;
  t.after(() => pair.close());
  await pair.importDemo();
  const url = `${pair.kafeBase}/api/login?secret=QUERY_SECRET`;
  const headers = { 'Content-Type': 'application/json', 'X-Request-Id': 'ATTACKER_VALUE', Cookie: 'private=COOKIE_SECRET' };
  const malformed = await fetch(url, { method: 'POST', headers, body: '{' });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).code, 'INVALID_JSON');
  const oversized = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ username: 'u', password: 'a'.repeat(70000) }) });
  assert.equal(oversized.status, 413); assert.equal((await oversized.json()).code, 'PAYLOAD_TOO_LARGE');
  assert.equal(events.length, 0);
  store.findUser = () => { throw new SyntaxError('SECRET_DB financial=12345'); };
  const failed = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ username: 'person', password: 'PASSWORD_SECRET' }) });
  const result = await failed.json();
  assert.equal(failed.status, 500); assert.equal(result.code, 'SERVER_ERROR');
  assert.match(result.requestId, /^[a-f0-9-]{36}$/); assert.equal(result.requestId, failed.headers.get('x-request-id'));
  assert.equal(events.length, 1); assert.equal(events[0].requestId, result.requestId); assert.equal(events[0].route, '/api/login');
  // The café keeps the record and delivers it with the next heartbeat; the vendor looks the code up in Mola Yönetim.
  const lookup = () => pair.admin('/diagnostics/find', { trackingId: result.requestId });
  assert.equal((await lookup()).status, 401);
  assert.equal((await pair.link.sync()).ok, true);
  await pair.adminLogin();
  const found = await lookup(); assert.equal(found.status, 200);
  const record = found.data.record;
  assert.equal(record.requestId, result.requestId); assert.equal(record.route, '/api/login');
  assert.deepEqual(Object.keys(record).sort(), ['event','requestId','method','route','status','code','elapsedMs','at','fingerprint','frames'].sort());
  assert.match(record.fingerprint, /^[a-f0-9]{24}$/);
  // Frames point to our code for debugging, never to absolute paths or the thrown message.
  assert.ok(record.frames.length > 0 && record.frames.every((f: string) => /(server|packages)\/[\w./-]+:\d+:\d+/.test(f) && !/[A-Za-z]:\/|Users/.test(f)));
  const exported = (await pair.admin('/diagnostics/export', { tenantId: 'mola-demo' })).data;
  assert.equal(exported.records.some((r: { requestId: string }) => r.requestId === result.requestId), true);
  // Delivered once: the next heartbeat does not send it again.
  assert.equal(pair.link.payload(pair.link.read()!).failures.length, 0);

  const output = JSON.stringify({ result, events, record, exported });
  for (const secret of ['QUERY_SECRET', 'COOKIE_SECRET', 'PASSWORD_SECRET', 'ATTACKER_VALUE', 'SECRET_DB', '12345', 'person']) assert.equal(output.includes(secret), false);
});
