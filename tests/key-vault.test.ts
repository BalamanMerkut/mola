import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from '../server/store.js';
import { AttemptLimiter, KEY_COPY, KEY_FILE, KeyVault, RAW_KEY, RAW_WIPE, keyCheck, newRecoveryCode, normalizeCode, openRecovery, readKeyFile } from '../server/key-vault.js';
import { dpapiLock, fileLock, type OsLock } from '../server/os-lock.js';
import { DomainError } from '../packages/domain/engine.js';
import { FAST_KDF, assertNoSecrets, fakeOsLock } from './fake-os-lock.js';

const folder = (name: string) => { mkdirSync('.local/tests', { recursive: true }); return mkdtempSync(resolve(`.local/tests/${name}-`)); };
const open = (dir: string, lock: OsLock = fakeOsLock(), extra: Partial<Parameters<typeof KeyVault.open>[1]> = {}) => KeyVault.open(dir, { protect: true, osLock: lock, kdf: FAST_KDF, ...extra });
const code = async (vault: KeyVault) => vault.reveal();

test('recovery codes have 24 unambiguous symbols in groups of four; typing is forgiving, wrong symbols are refused', () => {
  const codes = new Set(Array.from({ length: 200 }, newRecoveryCode));
  assert.equal(codes.size, 200);
  for (const c of codes) { assert.match(c, /^([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-){5}[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/); assert.doesNotMatch(c, /[01IO]/); }
  const one = [...codes][0];
  assert.equal(normalizeCode(` ${one.toLowerCase().replace(/-/g, ' ')} `), one.replace(/-/g, ''));
  assert.throws(() => normalizeCode('ABCD-EFGH'), (e: DomainError) => e.code === 'INVALID_CODE');
  assert.throws(() => normalizeCode(one.replace(/^./, 'O')), (e: DomainError) => e.code === 'INVALID_CODE');
});

test('key file round trip: both locks open the same key, a second start needs no code, nothing raw is on disk', async () => {
  const dir = folder('vault-roundtrip'), lock = fakeOsLock();
  const vault = await open(dir, lock);
  assert.equal(vault.state, 'open'); assert.equal(vault.protection, 'dpapi');
  const key = vault.key!, shown = await code(vault);
  assert.equal(existsSync(join(dir, RAW_KEY)), false);
  const file = readKeyFile(dir)!;
  assert.deepEqual(JSON.parse(readFileSync(join(dir, KEY_COPY), 'utf8')), file, 'the copy matches');
  assert.equal(file.check, keyCheck(key));
  assert.ok(file.recovery.shownAt, 'shown before it left the server');
  assert.deepEqual(await lock.open(file.osLock.data, file.installId), key);
  assert.deepEqual(await openRecovery(file.recovery, shown, file.installId), key);
  vault.confirm();
  const again = await open(dir, lock);
  assert.equal(again.state, 'open'); assert.deepEqual(again.key, key);
  assert.equal(again.view().confirmed, true); assert.equal(again.view().available, false);
  assert.throws(() => again.reveal(), /Gösterilecek/);
  assertNoSecrets(dir, key, [shown]);
  // The store opens its data with the vault's key and never creates a development.key.
  const store = new Store(dir, ['mola-demo'], { key }); store.close();
  assert.equal(existsSync(join(dir, RAW_KEY)), false);
});

test('migration from development.key survives a power cut at every step and never leaves the data unopenable', async () => {
  const steps = ['basla', 'gecici-yazildi', 'ana-yazildi', 'kopya-yazildi', 'dogrulandi', 'kenara-alindi', 'uzerine-yazildi', 'bitti'];
  for (const step of steps) {
    const dir = folder('vault-migrate');
    const store = new Store(dir, ['mola-demo']); store.mutate('mola-demo', s => { s.name = `Göç ${step}`; }); store.close();
    const raw = readFileSync(join(dir, RAW_KEY));
    await assert.rejects(open(dir, fakeOsLock(), { onStep: name => { if (name === step) throw new Error(`elektrik kesildi: ${name}`); } }), /elektrik kesildi/);
    const vault = await open(dir);
    assert.equal(vault.state, 'open', step); assert.deepEqual(vault.key, raw, step);
    assert.equal(existsSync(join(dir, RAW_KEY)), false, `raw key gone after ${step}`); assert.equal(existsSync(join(dir, RAW_WIPE)), false, step);
    assert.equal(readdirSync(dir).some(n => n.endsWith('.tmp')), false, step);
    assert.equal(vault.view().available, true, 'a fresh code waits to be shown');
    const shown = await code(vault);
    assert.deepEqual(await openRecovery(readKeyFile(dir)!.recovery, shown, vault.installId!), raw, step);
    const reopened = new Store(dir, [], { key: vault.key }); assert.equal(reopened.read('mola-demo').name, `Göç ${step}`); reopened.close();
    assertNoSecrets(dir, raw, [shown]);
  }
});

test('a cut after the raw key was set aside, with the OS lock failing at the next start, still opens with the set-aside key', async () => {
  const dir = folder('vault-double');
  const store = new Store(dir, ['mola-demo']); store.close();
  const raw = readFileSync(join(dir, RAW_KEY));
  await assert.rejects(open(dir, fakeOsLock(), { onStep: name => { if (name === 'kenara-alindi') throw new Error('kesinti'); } }), /kesinti/);
  const other = fakeOsLock('yeni-windows-sifresi');
  const vault = await open(dir, other);
  assert.equal(vault.state, 'open'); assert.deepEqual(vault.key, raw);
  assert.equal(existsSync(join(dir, RAW_WIPE)), false, 'wiped once re-locked');
  assert.deepEqual(await other.open(readKeyFile(dir)!.osLock.data, vault.installId!), raw, 're-locked for the user who opened it');
});

test('when the OS lock does not answer, migration keeps the raw key, warns, and tries again next start', async () => {
  const dir = folder('vault-noos');
  const store = new Store(dir, ['mola-demo']); store.close();
  const raw = readFileSync(join(dir, RAW_KEY)), lock = fakeOsLock();
  lock.fail = 'transient';
  const first = await open(dir, lock);
  assert.equal(first.state, 'open'); assert.deepEqual(first.key, raw); assert.equal(first.protection, 'off');
  assert.match(first.warning ?? '', /korumaya alınamadı/);
  assert.ok(existsSync(join(dir, RAW_KEY))); assert.equal(existsSync(join(dir, KEY_FILE)), false);
  lock.fail = undefined;
  const second = await open(dir, lock);
  assert.equal(second.protection, 'dpapi'); assert.deepEqual(second.key, raw); assert.equal(existsSync(join(dir, RAW_KEY)), false);
});

test('a raw key that does not open the data is never migrated; a key file is never replaced by it', async () => {
  const dir = folder('vault-stray');
  const store = new Store(dir, ['mola-demo']); store.close();
  writeFileSync(join(dir, RAW_KEY), randomBytes(32));
  await assert.rejects(open(dir), /açmıyor/);
  assert.equal(existsSync(join(dir, KEY_FILE)), false);
  // Protected folder + a foreign development.key dropped next to it: the key file stays in charge.
  const dir2 = folder('vault-stray2'), lock = fakeOsLock();
  const first = await open(dir2, lock); const key = first.key!; first.confirm();
  const s2 = new Store(dir2, ['mola-demo'], { key }); s2.close();
  writeFileSync(join(dir2, RAW_KEY), randomBytes(32));
  const vault = await open(dir2, lock);
  assert.deepEqual(vault.key, key); assert.ok(existsSync(join(dir2, RAW_KEY)), 'left alone');
});

test('the same raw key put back into a protected folder is wiped; the key file and its saved code stay', async () => {
  const dir = folder('vault-rawback'), lock = fakeOsLock();
  const first = await open(dir, lock); const saved = await code(first); first.confirm(); const id = readKeyFile(dir)!.recovery.id;
  new Store(dir, ['mola-demo'], { key: first.key! }).close();
  writeFileSync(join(dir, RAW_KEY), first.key!);
  const again = await open(dir, lock);
  assert.deepEqual(again.key, first.key); assert.equal(existsSync(join(dir, RAW_KEY)), false);
  assert.equal(readKeyFile(dir)!.recovery.id, id, 'the code on paper still works');
  assertNoSecrets(dir, first.key!, [saved]);
});

test('locked: a wrong code is refused, tries are limited, the right code opens and re-locks for this user', async () => {
  const dir = folder('vault-locked'), oldPc = fakeOsLock('eski-kullanici');
  const first = await open(dir, oldPc); const key = first.key!, right = await code(first);
  const newPc = fakeOsLock('yeni-kullanici');
  const vault = await open(dir, newPc);
  assert.equal(vault.state, 'locked'); assert.equal(vault.key, undefined); assert.match(vault.lockReason ?? '', /açmadı/);
  let clock = 0; const limiter = new AttemptLimiter(5, 600_000, () => clock);
  const wrong = newRecoveryCode();
  for (let i = 0; i < 5; i++) await assert.rejects(limiter.run(() => vault.unlock(wrong)), (e: DomainError) => e.code === 'WRONG_CODE');
  await assert.rejects(limiter.run(() => vault.unlock(right)), (e: DomainError) => e.code === 'RATE_LIMIT');
  await assert.rejects(limiter.run(() => vault.unlock('kısa')), (e: DomainError) => e.code === 'RATE_LIMIT');
  clock += 600_001;
  await assert.rejects(limiter.run(() => vault.unlock('kısa')), (e: DomainError) => e.code === 'INVALID_CODE');
  await limiter.run(() => vault.unlock(right));
  assert.equal(vault.state, 'open'); assert.deepEqual(vault.key, key); assert.equal(vault.view().confirmed, true);
  // Re-locked for the new user: next start opens without the code; the old user can no longer open it.
  assert.equal((await open(dir, newPc)).state, 'open');
  assert.equal((await open(dir, oldPc)).state, 'locked');
  // A transient OS failure is retried, then reported as locked; retry() opens once the OS answers again.
  newPc.fail = 'transient'; newPc.opens = 0;
  const flaky = await open(dir, newPc);
  assert.equal(flaky.state, 'locked'); assert.equal(newPc.opens, 3);
  newPc.fail = undefined; assert.equal(await flaky.retry(), true); assert.deepEqual(flaky.key, key);
});

test('a new recovery code makes the old one useless at once', async () => {
  const dir = folder('vault-renew'), lock = fakeOsLock();
  const vault = await open(dir, lock); const old = await code(vault); vault.confirm();
  const fresh = await vault.regenerate();
  assert.notEqual(fresh, old); assert.equal(vault.view().confirmed, false); assert.equal(vault.view().available, true);
  const file = readKeyFile(dir)!;
  await assert.rejects(openRecovery(file.recovery, old, file.installId), (e: DomainError) => e.code === 'WRONG_CODE');
  assert.deepEqual(await openRecovery(file.recovery, fresh, file.installId), vault.key);
  const locked = await open(dir, fakeOsLock('baska'));
  await assert.rejects(locked.unlock(old), (e: DomainError) => e.code === 'WRONG_CODE');
  await locked.unlock(fresh); assert.equal(locked.state, 'open');
});

test('a code nobody saw is replaced at the next start; one that was shown is kept until confirmed', async () => {
  const dir = folder('vault-unseen'), lock = fakeOsLock();
  const first = await open(dir, lock); const firstId = readKeyFile(dir)!.recovery.id;
  void first;
  const second = await open(dir, lock);
  assert.notEqual(readKeyFile(dir)!.recovery.id, firstId, 'never shown: replaced');
  const seen = await code(second); const seenId = readKeyFile(dir)!.recovery.id;
  const third = await open(dir, lock);
  assert.equal(readKeyFile(dir)!.recovery.id, seenId, 'shown: kept, the owner may have written it down');
  assert.equal(third.view().available, false, 'not in memory any more'); assert.equal(third.view().shown, true); assert.equal(third.view().confirmed, false);
  third.confirm(); assert.equal(third.view().confirmed, true);
  assert.deepEqual(await openRecovery(readKeyFile(dir)!.recovery, seen, third.installId!), third.key);
});

test('a damaged anahtar.json is read from its copy; both damaged fails loudly instead of making a new key', async () => {
  const dir = folder('vault-damaged'), lock = fakeOsLock();
  const vault = await open(dir, lock); vault.confirm(); const key = vault.key!;
  new Store(dir, ['mola-demo'], { key }).close();
  writeFileSync(join(dir, KEY_FILE), '{ yarım');
  assert.deepEqual((await open(dir, lock)).key, key);
  writeFileSync(join(dir, KEY_FILE), '{ yarım'); writeFileSync(join(dir, KEY_COPY), 'bozuk');
  await assert.rejects(open(dir, lock), /bozuk/);
  assert.equal(existsSync(join(dir, RAW_KEY)), false);
});

test('development mode keeps the raw key file; Linux "file" lock is marked unprotected', async () => {
  const dir = folder('vault-dev');
  const dev = await KeyVault.open(dir, { protect: false });
  assert.equal(dev.protection, 'off'); assert.deepEqual(dev.key, readFileSync(join(dir, RAW_KEY)));
  const linux = await open(folder('vault-linux'), fileLock);
  assert.equal(linux.protection, 'file'); assert.equal(linux.view().protectedAtRest, false);
});

test('real Windows DPAPI seals and opens a key for this user only', { skip: process.platform !== 'win32' }, async () => {
  const key = randomBytes(32), installId = '00000000-0000-4000-8000-000000000001';
  const sealed = await dpapiLock.seal(key, installId);
  assert.ok(!sealed.includes(key.toString('base64')));
  assert.deepEqual(await dpapiLock.open(sealed, installId), key);
  // Bound to the install too (entropy): another install's id does not open it.
  await assert.rejects(dpapiLock.open(sealed, '00000000-0000-4000-8000-000000000002'), (e: { denied?: boolean }) => e.denied === true);
});
