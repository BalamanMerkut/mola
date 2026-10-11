import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MERKEZ_PASSWORD, merkezPair } from './merkez-fixture.js';
import { freshCode, testBundle, withAuthenticator } from './update-fixture.js';

/*
 * Güncelleme yetkisi (server/merkez/step-up.ts): uploading, publishing, Durdur, Sil and note edits in Mola Yönetim → Güncellemeler need
 * two-step login and a fresh Authenticator code (one right code opens 10 minutes for that session). Always a scratch Merkez.
 */
test('Güncellemeler: upload, publish, stop, delete and note edits need the Güncelleme yetkisi; wrong codes are refused, counted and recorded', async t => {
  let offset = 0; const now = () => new Date(Date.now() + offset);
  const pair = await merkezPair('guncelleme-yetkisi', { now }); t.after(() => pair.close());
  const store = pair.merkezStore, base = `${pair.merkezBase}/api/merkez/admin`;
  /** A session of its own (cookie string), like a browser tab. */
  const signIn = async () => {
    const code = store.read().admin.mfa ? await freshCode(store, () => now().getTime()) : undefined;
    const r = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: MERKEZ_PASSWORD, ...(code ? { code } : {}) }) });
    assert.equal(r.status, 200); return r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  };
  const call = async (cookie: string, path: string, body?: unknown) => { const r = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json() as any }; };
  const bundle = await testBundle(join(pair.dir, 'paket'), '0.9.7');
  const upload = async (cookie: string) => { const r = await fetch(`${base}/releases/upload`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie }, body: readFileSync(bundle.file) }); return { status: r.status, data: await r.json() as any }; };
  const lines = (action: string) => store.journal.entries().map(s => s.entry).filter(e => e.action === action);

  // Two-step login off: blocked, with the plain reason (and the screen learns it from the list).
  const tab = await signIn();
  assert.deepEqual((await call(tab, '/releases')).data.right, { mfa: false, until: null, minutes: 10 });
  const blocked = await upload(tab);
  assert.equal(blocked.status, 403); assert.equal(blocked.data.code, 'MFA_REQUIRED'); assert.match(blocked.data.message, /^Güncelleme yayınlamak için önce iki adımlı doğrulamayı açın/);
  assert.equal((await call(tab, '/releases/yetki', { code: '123456' })).data.code, 'MFA_REQUIRED');
  assert.equal(lines('release.step_up_refused').at(-1)?.detail, 'İki adımlı doğrulama kapalı');

  // On, but no code yet: every critical action is refused before anything happens.
  withAuthenticator(store);
  assert.equal((await call(tab, '/releases')).data.right.mfa, true);
  for (const [path, body] of [['/releases/rollout', { id: 'x', mode: 'all' }], ['/releases/rollout', { id: 'x', mode: 'pilot', pilot: [] }], ['/releases/rollout', { id: 'x', mode: 'off' }], ['/releases/delete', { id: 'x' }], ['/releases/notes', { id: 'x', notes: 'Yeni not' }]] as const)
    assert.equal((await call(tab, path, body)).data.code, 'STEP_UP_REQUIRED', `${path} ${JSON.stringify(body)}`);
  assert.equal((await upload(tab)).data.code, 'STEP_UP_REQUIRED');
  assert.equal(store.journal.entries().filter(s => s.entry.action === 'release.imported').length, 0);

  // Wrong codes: refused and recorded; a malformed one says what is expected; after five, even the right code waits.
  const right = await freshCode(store, () => now().getTime()), wrong = right === '000000' ? '111111' : '000000';
  assert.equal((await call(tab, '/releases/yetki', { code: '12' })).status, 400);
  for (let i = 0; i < 5; i++) { const r = await call(tab, '/releases/yetki', { code: wrong }); assert.equal(r.status, 403); assert.equal(r.data.code, 'INVALID_CODE'); }
  const slowed = await call(tab, '/releases/yetki', { code: right });
  assert.equal(slowed.status, 429); assert.equal(slowed.data.code, 'RATE_LIMIT');
  assert.ok(lines('release.step_up_failed').length >= 5); assert.equal(lines('release.step_up_failed').at(-1)!.result, 'basarisiz');
  assert.match(lines('release.step_up_refused').at(-1)!.detail ?? '', /Çok fazla yanlış kod/);
  await new Promise(r => setTimeout(r, 1100));

  // The right code: 10 minutes for this session.
  const opened = await call(tab, '/releases/yetki', { code: right });
  assert.equal(opened.status, 200, JSON.stringify(opened.data));
  assert.ok(Math.abs(Date.parse(opened.data.until) - (now().getTime() + 10 * 60_000)) < 5000);
  assert.equal((await call(tab, '/releases')).data.right.until, opened.data.until);
  const step = lines('release.step_up').at(-1)!; assert.equal(step.actor.kind, 'admin'); assert.equal(step.result, 'basarili');
  assert.ok(!JSON.stringify(store.journal.entries()).includes(right), 'never the code itself');
  // A code is good once: the same one again is refused.
  assert.equal((await call(tab, '/releases/yetki', { code: right })).data.code, 'INVALID_CODE');
  const up = await upload(tab);
  assert.equal(up.status, 200, JSON.stringify(up.data)); const id = up.data.release.id;
  assert.equal((await call(tab, '/releases/rollout', { id, mode: 'all' })).status, 200);
  assert.equal((await call(tab, '/releases/rollout', { id, mode: 'off' })).status, 200);
  // Another tab (another session) has its own window.
  const other = await signIn();
  assert.equal((await call(other, '/releases/delete', { id })).data.code, 'STEP_UP_REQUIRED');
  // Editing the note signs the release again: the same right is needed (5 Oct).
  const noteOf = async () => (await call(tab, '/releases')).data.releases.find((r: { id: string }) => r.id === id).notes;
  const refused = await call(other, '/releases/notes', { id, notes: 'Başka sekmeden not' });
  assert.equal(refused.status, 403); assert.equal(refused.data.code, 'STEP_UP_REQUIRED'); assert.equal(await noteOf(), '');
  assert.equal((await call(tab, '/releases/notes', { id, notes: 'Mutfak ekranı hızlandı.' })).status, 200);
  assert.equal(await noteOf(), 'Mutfak ekranı hızlandı.');
  // "Yetkiyi kapat" ends it at once.
  assert.equal((await call(tab, '/releases/yetki/kapat', {})).data.right.until, null);
  assert.equal((await call(tab, '/releases/delete', { id })).data.code, 'STEP_UP_REQUIRED');
  assert.equal((await call(tab, '/releases/notes', { id, notes: 'Kapalı yetkiyle' })).data.code, 'STEP_UP_REQUIRED');
  assert.equal(await noteOf(), 'Mutfak ekranı hızlandı.');
  assert.equal(lines('release.step_up_ended').length, 1);
  // 10 minutes later the window is closed.
  assert.equal((await call(tab, '/releases/yetki', { code: await freshCode(store, () => now().getTime()) })).status, 200);
  offset += 10 * 60_000 + 1000;
  assert.equal((await call(tab, '/releases/delete', { id })).data.code, 'STEP_UP_REQUIRED');
  assert.equal((await call(tab, '/releases')).data.right.until, null);
  assert.equal((await call(tab, '/releases/yetki', { code: await freshCode(store, () => now().getTime()) })).status, 200);
  // Two-step login switched off (or set up again): an open window no longer counts.
  const mfa = store.read().admin.mfa!;
  store.mutate(d => { delete d.admin.mfa; });
  assert.equal((await call(tab, '/releases/delete', { id })).data.code, 'MFA_REQUIRED');
  store.mutate(d => { d.admin.mfa = { ...mfa, secret: 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU' }; });
  assert.equal((await call(tab, '/releases/delete', { id })).data.code, 'STEP_UP_REQUIRED', 'a window from the old Authenticator does not count');
  assert.equal((await call(tab, '/releases/yetki', { code: await freshCode(store, () => now().getTime()) })).status, 200);
  assert.equal((await call(tab, '/releases/delete', { id })).status, 200);
  for (const action of ['release.imported', 'release.notes', 'release.published', 'release.stopped', 'release.deleted']) assert.ok(lines(action).length, action);
  assert.equal(store.journal.verify().ok, true);
});
