import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkVerifier, localFailed, localWait, makeVerifier, plainEmail, VERIFIER_ITERATIONS, waitText } from '../packages/domain/local-verifier.js';

/*
 * Kafemi yönet "Çıkış" with the café off (0.1.24, packages/domain/local-verifier.ts): the device opens again with the e-mail
 * and the password checked against the verifier of its last sign-in. PBKDF2-SHA256, ≥ 310 000 rounds, a random salt, never
 * the password; wrong tries slow down (5 free, then 1 minute, doubling).
 */
test('the verifier: the right password matches, a wrong one does not; random salt; never the password itself', async () => {
  const v = await makeVerifier('MolaDemo!2026');
  assert.equal(v.v, 1); assert.ok(v.iterations >= 310_000); assert.equal(v.iterations, VERIFIER_ITERATIONS);
  assert.match(v.salt, /^[A-Za-z0-9_-]{22}$/); assert.match(v.hash, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(v).includes('MolaDemo'), 'the password is not in it');
  assert.equal(await checkVerifier(v, 'MolaDemo!2026'), true);
  for (const wrong of ['molademo!2026', 'MolaDemo!2026 ', '', 'MolaDemo!202']) assert.equal(await checkVerifier(v, wrong), false, wrong);
  // The same password twice: another salt, another hash.
  const w = await makeVerifier('MolaDemo!2026');
  assert.notEqual(w.salt, v.salt); assert.notEqual(w.hash, v.hash);
  assert.equal(await checkVerifier(w, 'MolaDemo!2026'), true);
  // Turkish letters in another Unicode form are the same password.
  const tr = await makeVerifier('Şifre-çok-gizli1');
  assert.equal(await checkVerifier(tr, 'Şifre-çok-gizli1'), true);
});

test('an edited verifier never matches: fewer rounds, another salt or hash, no verifier', async () => {
  const v = await makeVerifier('MolaDemo!2026');
  assert.equal(await checkVerifier({ ...v, iterations: 1000 }, 'MolaDemo!2026'), false);
  assert.equal(await checkVerifier({ ...v, salt: (await makeVerifier('x')).salt }, 'MolaDemo!2026'), false);
  assert.equal(await checkVerifier({ ...v, hash: v.hash.slice(0, 20) }, 'MolaDemo!2026'), false);
  assert.equal(await checkVerifier(undefined, 'MolaDemo!2026'), false);
  // A weak verifier made on purpose is refused even with its own password.
  const weak = await makeVerifier('MolaDemo!2026', 10);
  assert.equal(await checkVerifier(weak, 'MolaDemo!2026'), false);
});

test('wrong tries: 5 free, then 1 minute, 2, 4 … at most an hour; the wait is said plainly', () => {
  const t = Date.parse('2026-10-15T20:00:00Z');
  let tries = undefined as ReturnType<typeof localFailed> | undefined;
  for (let i = 1; i <= 4; i++) { tries = localFailed(tries, t); assert.equal(tries.count, i); assert.equal(localWait(tries, t), 0); }
  tries = localFailed(tries, t);
  assert.equal(localWait(tries, t), 60_000); assert.equal(waitText(localWait(tries, t)), '1 dakika');
  assert.equal(localWait(tries, t + 59_000), 1000); assert.equal(waitText(1000), '1 saniye');
  assert.equal(localWait(tries, t + 60_000), 0);
  tries = localFailed(tries, t + 60_000); assert.equal(localWait(tries, t + 60_000), 2 * 60_000);
  tries = localFailed(tries, t + 3 * 60_000); assert.equal(localWait(tries, t + 3 * 60_000), 4 * 60_000);
  for (let i = 0; i < 10; i++) tries = localFailed(tries, t);
  assert.equal(localWait(tries, t), 60 * 60_000, 'at most an hour');
  assert.equal(localWait(undefined, t), 0);
  assert.equal(plainEmail('  Sahip@OrnekKafe.com '), 'sahip@ornekkafe.com');
});
