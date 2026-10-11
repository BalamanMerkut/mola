import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExpiringStore } from '../server/expiring-store.js';
import { DomainError } from '../packages/domain/engine.js';

test('expired sessions are rejected at deadline without extending active lifetimes', () => {
  let time = 0;
  const sessions = new ExpiringStore<{ expires: number; name: string }>(s => s.expires, () => time, 3);
  sessions.set('one', { expires: 100, name: 'one' });
  sessions.set('two', { expires: 60000, name: 'two' });
  time = 99; assert.equal(sessions.get('one')!.name, 'one');
  time = 100; assert.equal(sessions.get('one'), undefined);
  assert.equal(sessions.get('two')!.name, 'two');
  time = 60000; assert.equal(sessions.get('two'), undefined); assert.equal(sessions.size, 0);
});

test('capacity refuses new sessions without eviction, reclaims expiry, and allows logout and replacement', () => {
  let time = 0;
  const sessions = new ExpiringStore<number>(expiry => expiry, () => time, 2);
  sessions.set('one', 2000); sessions.set('two', 60000);
  assert.throws(() => sessions.set('three', 70000), (e: unknown) => e instanceof DomainError && e.code === 'SESSION_CAPACITY' && e.status === 503);
  assert.equal(sessions.get('one'), 2000); assert.equal(sessions.get('two'), 60000);
  sessions.set('two', 80000); assert.equal(sessions.get('two'), 80000);
  time = 2000; sessions.set('three', 70000);
  assert.equal(sessions.get('one'), undefined); assert.equal(sessions.size, 2);
  sessions.delete('two'); sessions.set('four', 50000); assert.equal(sessions.size, 2);
  sessions.clear(); assert.equal(sessions.size, 0);
  sessions.set('already-expired', 100); assert.equal(sessions.size, 0);
  assert.throws(() => sessions.set('invalid', NaN));
});

test('traffic sweeps untouched expired records and idle instances need no timer', () => {
  let time = 0;
  const sessions = new ExpiringStore<number>(expiry => expiry, () => time, 1000);
  for (let i = 0; i < 1000; i++) sessions.set(String(i), 20000);
  time = 30000; sessions.get('unknown'); assert.equal(sessions.size, 0);
  sessions.set('new', 90000); assert.equal(sessions.size, 1);
  assert.throws(() => new ExpiringStore<number>(v => v, () => time, 0));
});
