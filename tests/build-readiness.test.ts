import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { assertBuildReady } from '../server/build-readiness.js';
import { startLocalServer } from '../server/runtime.js';
import { dataLock } from '../server/data-lock.js';

test('missing build files fail before creating business data and accept valid hidden-folder builds', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(resolve('.local/tests/build-')), build = join(root, '.hidden', 'dist'), directory = join(root, 'data');
  mkdirSync(build, { recursive: true });
  const check = async () => {
    await assert.rejects(startLocalServer({ directory, port: 3199, host: '127.0.0.1', serveBuild: true, cleanInstall: true, buildDirectory: build }), /Derlenmiş arayüz/);
    assert.equal(existsSync(directory), false);
  };
  await check();
  writeFileSync(join(build, 'index.html'), '<script src="/app.js"></script><link href="/style.css">');
  await check(); writeFileSync(join(build, 'app.js'), 'console.log(1)');
  await check(); writeFileSync(join(build, 'style.css'), ''); await check();
  writeFileSync(join(build, 'style.css'), 'body{}'); assert.doesNotThrow(() => assertBuildReady(build));
  for (const ref of ['../outside.js', '/%2e%2e/outside.js', 'https://example.com/app.js']) {
    writeFileSync(join(build, 'index.html'), `<script src="${ref}"></script>`); await check();
  }
});

test('a file used as data directory is rejected without overwriting it', () => {
  mkdirSync('.local/tests', { recursive: true }); const folder = mkdtempSync(resolve('.local/tests/data-path-'));
  const file = join(folder, 'keep.txt'); writeFileSync(file, 'keep');
  assert.throws(() => dataLock(file, 'server'), /klasör değil/);
  assert.throws(() => dataLock(join(file, 'child'), 'server'), /klasör değil/);
});
