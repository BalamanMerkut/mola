import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupAge } from '../server/backup-age.js';

test('backup age distinguishes missing, invalid, future and expired backups at the 24-hour boundary', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  assert.equal(backupAge(null, now).status, 'missing');
  assert.equal(backupAge('bad', now).status, 'invalid');
  assert.equal(backupAge('2026-09-27T12:00:00.001Z', now).status, 'invalid');
  assert.deepEqual(backupAge('2026-09-26T12:00:00Z', now), { status: 'recent', ageHours: 24 });
  assert.equal(backupAge('2026-09-26T11:59:59.999Z', now).status, 'stale');
});
