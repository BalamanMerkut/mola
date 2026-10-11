import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MERKEZ_PASSWORD, merkezPair } from './merkez-fixture.js';
import { freshCode, testBundle, withAuthenticator } from './update-fixture.js';

/*
 * Geliştirici erişimi + `npm run yayinla` (scripts/yayinla.mjs), always against a scratch Mola Merkez on a free port with
 * a scratch key file: never the real Merkez (127.0.0.1:4000) and never the vendor's own key file.
 */
function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number; out: string }>(done => {
    // Never the real key file or Merkez: APPDATA points at a scratch folder too, MOLA_YAYIN_* are cleared.
    const child = spawn(process.execPath, ['scripts/yayinla.mjs', ...args], { env: { ...process.env, MOLA_YAYIN_ANAHTARI: '', MOLA_YAYIN_MERKEZ: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    child.stdin.end(env.STDIN ?? '');
    child.on('close', code => done({ code: code ?? 1, out }));
  });
}

test('a releases key: shown once, only Güncellemeler, revocable; yayinla prints the plan without --evet and publishes with it', async t => {
  const pair = await merkezPair('yayinla', { demo: true }); t.after(() => pair.close());
  const scratch = mkdtempSync(join(tmpdir(), 'mola-yayinla-')); t.after(() => rmSync(scratch, { recursive: true, force: true }));
  await pair.adminLogin(); await pair.importDemo();
  const cafe = pair.merkezStore.read().businesses.find(b => b.installId)!;
  const made = await pair.admin('/access-tokens', { name: 'Test yayını', scope: 'releases', password: MERKEZ_PASSWORD });
  assert.equal(made.status, 200); assert.match(made.data.token, /^mola_yayin_/);
  assert.equal(JSON.stringify((await pair.admin('/access-tokens')).data).includes(made.data.token), false, 'shown once: never listed again');
  assert.ok(!JSON.stringify(pair.merkezStore.read()).includes(made.data.token), 'only its hash is kept');
  // Scope: the key opens Güncellemeler only; a "calisma" key does not open them.
  const as = (token: string, path: string) => fetch(`${pair.merkezBase}/api/merkez/admin${path}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await as(made.data.token, '/releases')).status, 200);
  for (const path of ['/state', '/journal', '/access-tokens', '/email', '/workfolder', '/backup']) assert.equal((await as(made.data.token, path)).status, 401, path);
  const folderKey = await pair.admin('/access-tokens', { name: 'VDS klasörü', scope: 'calisma', password: MERKEZ_PASSWORD });
  assert.equal((await as(folderKey.data.token, '/releases')).status, 401);
  assert.equal((await as(folderKey.data.token, '/workfolder/snapshot')).status, 200);
  assert.equal((await as(made.data.token, '/workfolder/snapshot')).status, 401);

  const keyFile = join(scratch, 'yayin-erisimi.json'), env = { APPDATA: scratch };
  const bundle = await testBundle(join(pair.dir, 'paket'), '0.9.5');
  // Saving the key: read from the keyboard (stdin), checked with Merkez, written to the scratch file.
  const saved = await run(['--erisim-kaydet', '--erisim', keyFile, '--merkez', pair.merkezBase], { ...env, STDIN: `${made.data.token}\n` });
  assert.equal(saved.code, 0, saved.out); assert.match(saved.out, /Anahtar kaydedildi/);
  const base = ['--surum', '0.9.5', '--paket', bundle.file, '--erisim', keyFile, '--not', 'Mutfak ekranı hızlandı.'];
  // Without --evet: the plan, nothing sent.
  // Two demo businesses share a name here: a name that fits two is refused, the id is exact.
  if (pair.merkezStore.read().businesses.filter(b => b.name === cafe.name).length > 1) { const two = await run([...base, '--pilot', cafe.name], env); assert.equal(two.code, 2); assert.match(two.out, /birden çok işletme/); }
  const dry = await run([...base, '--pilot', cafe.tenantId], env);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /Sürüm:\s+0\.9\.5 \(Windows\)/); assert.match(dry.out, new RegExp(`Pilot → ${cafe.name}`)); assert.match(dry.out, /Bu bir deneme/);
  assert.equal((await pair.admin('/releases')).data.releases.length, 0, 'dry run: nothing uploaded');
  // Wrong input stops before anything is sent.
  assert.equal((await run([...base, '--pilot', 'Olmayan Kafe'], env)).code, 2);
  assert.equal((await run([...base, '--pilot', cafe.tenantId, '--herkes'], env)).code, 2);
  assert.equal((await run(['--surum', '0.9.5', '--herkes', '--paket', bundle.file, '--erisim', join(scratch, 'yok.json')], env)).code, 2, 'no key: refused');
  // --evet needs --kod (the Authenticator code): refused before anything is sent; a malformed code too.
  const noCode = await run([...base, '--pilot', cafe.tenantId, '--evet'], env);
  assert.equal(noCode.code, 2); assert.match(noCode.out, /--kod/);
  assert.equal((await run([...base, '--pilot', cafe.tenantId, '--evet', '--kod', '12ab'], env)).code, 2);
  // Two-step login off on Merkez: the key alone publishes nothing.
  const noMfa = await run([...base, '--pilot', cafe.tenantId, '--evet', '--kod', '123456'], env);
  assert.equal(noMfa.code, 1); assert.match(noMfa.out, /önce iki adımlı doğrulamayı açın/);
  withAuthenticator(pair.merkezStore);
  // A wrong code: nothing uploaded.
  const right = await freshCode(pair.merkezStore), wrongCode = right === '000000' ? '111111' : '000000';
  const wrong = await run([...base, '--pilot', cafe.tenantId, '--evet', '--kod', wrongCode], env);
  assert.equal(wrong.code, 1); assert.match(wrong.out, /Kod yanlış/);
  assert.equal((await pair.admin('/releases')).data.releases.length, 0, 'wrong code: nothing uploaded');
  // With --evet and the current code: uploaded, note saved, published to the pilot.
  const real = await run([...base, '--pilot', cafe.tenantId, '--evet', '--kod', await freshCode(pair.merkezStore)], env);
  assert.equal(real.code, 0, real.out); assert.match(real.out, /Yayınlandı: 0\.9\.5 → pilot/);
  const list = (await pair.admin('/releases')).data.releases;
  assert.equal(list.length, 1); assert.equal(list[0].version, '0.9.5'); assert.equal(list[0].notes, 'Mutfak ekranı hızlandı.');
  assert.deepEqual(list[0].rollout.pilot, [cafe.tenantId]); assert.equal(list[0].rollout.mode, 'pilot');
  // Again with --herkes: the same package is not uploaded twice, just published to all.
  const all = await run(['--surum', '0.9.5', '--herkes', '--paket', bundle.file, '--erisim', keyFile, '--evet', '--kod', await freshCode(pair.merkezStore)], env);
  assert.equal(all.code, 0, all.out); assert.match(all.out, /zaten yüklü/);
  assert.equal((await pair.admin('/releases')).data.releases[0].rollout.mode, 'all');
  // İşlem kayıtları: what the key did, as the key.
  const lines = pair.merkezStore.journal.entries().map(s => s.entry);
  for (const action of ['release.step_up', 'release.step_up_failed', 'release.step_up_refused', 'release.imported', 'release.notes', 'release.pilot', 'release.published']) assert.ok(lines.some(e => e.action === action && e.actor.kind === 'token' && e.actor.name === 'Geliştirici erişimi · Test yayını'), action);
  // Revoked: the command stops with a plain reason.
  await pair.admin('/access-tokens/revoke', { id: made.data.view.id });
  const refused = await run(['--surum', '0.9.5', '--herkes', '--paket', bundle.file, '--erisim', keyFile], env);
  assert.equal(refused.code, 1); assert.match(refused.out, /iptal edilmiş/);
  writeFileSync(keyFile, '{}');
});
