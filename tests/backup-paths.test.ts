import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { backupPaths, pathsOverlap, restorePaths } from '../server/backup-paths.js';
test('backup targets distinguish separate Windows drives, nested folders and similar names', () => {
  assert.equal(pathsOverlap('C:\\data', 'D:\\backup', path.win32), false);
  assert.equal(pathsOverlap('C:\\data', 'c:\\DATA\\backup', path.win32), true);
  assert.equal(pathsOverlap('C:\\data', 'C:\\database', path.win32), false);
  assert.equal(pathsOverlap('/data', '/data/..cache', path.posix), true);
  assert.equal(pathsOverlap('/data', '/backup', path.posix), false);
});

test('restore targets cannot mix plaintext copies with backups, keys or live business data', async () => {
  mkdirSync('.local/tests', { recursive: true }); const root = mkdtempSync(path.resolve('.local/tests/restore-paths-'));
  const backup = path.join(root, 'backup'), keys = path.join(root, 'keys'), data = path.join(root, 'data');
  for (const dir of [backup, keys, data]) mkdirSync(dir);
  const key = path.join(keys, 'backup.key'); writeFileSync(key, 'fixture');
  const output = path.join(root, 'restores'); assert.equal((await restorePaths(backup, key, output)).outputRoot, output);
  assert.equal(existsSync(output), false);
  for (const target of [backup, path.join(backup, 'child'), keys, root]) await assert.rejects(restorePaths(backup, key, target), /ayrı olmalı/);
  writeFileSync(path.join(data, 'merchant.sqlite'), 'keep');
  await assert.rejects(restorePaths(backup, key, path.join(data, 'child', 'restore')), /işletme verisinin içinde/);
  assert.equal(existsSync(path.join(data, 'child')), false);
});
test('backup and key targets must be separate from each other and the source', async () => {
  mkdirSync('.local/tests', { recursive: true }); const root = mkdtempSync(path.resolve('.local/tests/backup-paths-'));
  const source = path.join(root, 'data'), output = path.join(root, 'backup'), keys = path.join(root, 'keys'); mkdirSync(source);
  const valid = await backupPaths(source, output, keys); assert.equal(valid.outputRoot, output);
  await assert.rejects(backupPaths(source, path.join(source, 'backup'), keys), /veri klasöründen ayrı/);
  await assert.rejects(backupPaths(source, root, keys), /veri klasöründen ayrı/);
  await assert.rejects(backupPaths(source, output, output), /ayrı klasörler/);
  await assert.rejects(backupPaths(source, output, path.join(output, 'keys')), /ayrı klasörler/);
});
