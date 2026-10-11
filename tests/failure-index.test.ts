import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FailureIndex } from '../server/failure-index.js';
test('failure index bounds history, expires at 24 hours and copies only allowed fields', () => {
  let now = 0; const index = new FailureIndex(() => now, 2);
  const event = { event: 'request_failed' as const, requestId: 'one', method: 'POST', route: '/api/test', status: 500, code: 'SERVER_ERROR', elapsedMs: 1, password: 'secret' };
  index.add(event); assert.ok(!JSON.stringify(index.find('one')).includes('secret'));
  index.find('one')!.code = 'changed'; assert.equal(index.find('one')!.code, 'SERVER_ERROR');
  index.add({ ...event, requestId: 'two' }); index.add({ ...event, requestId: 'three' });
  assert.equal(index.find('one'), null); now = 86400000; assert.equal(index.find('two'), null);
});
