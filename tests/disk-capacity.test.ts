import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diskCapacity } from '../server/disk-capacity.js';

test('disk capacity uses process-available blocks and detects absolute and relative low space', async () => {
  const check = (available: bigint, total = 20000n) => diskCapacity('fixture', async () => ({ bavail: available, blocks: total, bsize: 1024n * 1024n }));
  assert.equal((await check(255n)).status, 'critical');
  assert.equal((await check(256n)).status, 'low');
  assert.equal((await check(2047n)).status, 'low');
  assert.equal((await check(2048n)).status, 'ok');
  assert.equal((await check(4096n, 100000n)).status, 'low');
  assert.equal((await check(5000n, 100000n)).status, 'ok');
  const full = await check(0n);
  assert.equal(full.status, 'critical'); assert.equal(full.availableMiB, 0);
  assert.doesNotThrow(() => JSON.stringify(full));
});

test('unavailable and invalid filesystem counters produce an explicit unknown result without leaking paths', async () => {
  const denied = await diskCapacity('private/path', async () => { throw new Error('secret filesystem information'); });
  assert.equal(denied.status, 'unknown'); assert.equal(denied.availableMiB, null);
  assert.ok(!JSON.stringify(denied).includes('secret')); assert.ok(!JSON.stringify(denied).includes('private'));
  for (const stats of [
    { bavail: -1n, blocks: 10n, bsize: 1n }, { bavail: 11n, blocks: 10n, bsize: 1n },
    { bavail: 0n, blocks: 0n, bsize: 1n }, { bavail: 1n, blocks: 10n, bsize: 0n },
  ]) assert.equal((await diskCapacity('fixture', async () => stats)).status, 'unknown');
});
