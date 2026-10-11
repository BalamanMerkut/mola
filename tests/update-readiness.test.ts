import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { updateReadiness } from '../server/update-readiness.js';
function fixture() {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(resolve('.local/tests/update-'));
  const old = join(root, 'old'), next = join(root, 'next'), data = join(old, 'veri');
  for (const [dir, version] of [[old, '0.1.0'], [next, '0.2.0']]) {
    const files: Record<string, string> = {
      'server/index.ts': 'throw new Error("Candidate code must never execute")',
      'dist/index.html': '<script src="/app.js"></script>', 'dist/app.js': 'console.log(1)',
      'packages/domain/data-format.json': JSON.stringify({ format: 1, minReadable: 0, maxReadable: 1, writeVersion: 1 }),
      'templates/cafe-v1.json': '{}', 'package.json': JSON.stringify({ name: 'mola-cafe', version }),
    };
    for (const [file, text] of Object.entries(files)) { mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), text); }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ mode: 'local-pilot', version, files: Object.entries(files).map(([file, text]) => ({ file, sha256: createHash('sha256').update(text).digest('hex') })) }));
  }
  mkdirSync(data); const db = new DatabaseSync(join(data, 'merchant.sqlite')); db.exec('CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES ("unchanged")'.replace('"unchanged"', "'unchanged'")); db.close(); writeFileSync(join(data, 'development.key'), Buffer.alloc(32));
  return { old, next, data };
}
test('update preflight preserves original data and only authorizes a rehearsal, not compatibility', () => {
  const { old, next, data } = fixture(), before = readdirSync(data);
  const bytes = readFileSync(join(data, 'merchant.sqlite'));
  const result = updateReadiness(old, next, data);
  assert.equal(result.databaseVersion, 0);
  assert.equal(result.eligibleForRehearsal, true); assert.equal(result.next.version, '0.2.0');
  assert.ok(result.warnings.some(w => w.includes('uyumluluğunu kanıtlamaz')));
  assert.deepEqual(readdirSync(data), before); assert.deepEqual(readFileSync(join(data, 'merchant.sqlite')), bytes);
  assert.throws(() => updateReadiness(old, old, data), /ayrı klasör/);
  assert.throws(() => updateReadiness(old, data, data), /ayrı klasör/);
});
test('update preflight rejects locks, partial restore, missing data and altered packages without cleaning them', () => {
  const { old, next, data } = fixture();
  writeFileSync(join(data, '.mola-operation.lock'), 'keep');
  assert.throws(() => updateReadiness(old, next, data), /kullanımda/);
  assert.equal(readFileSync(join(data, '.mola-operation.lock'), 'utf8'), 'keep'); unlinkSync(join(data, '.mola-operation.lock'));
  writeFileSync(join(data, 'RESTORE_IN_PROGRESS.txt'), 'keep');
  assert.throws(() => updateReadiness(old, next, data)); unlinkSync(join(data, 'RESTORE_IN_PROGRESS.txt'));
  writeFileSync(join(next, 'dist/app.js'), 'changed'); assert.throws(() => updateReadiness(old, next, data), /manifest/);
  unlinkSync(join(data, 'merchant.sqlite')); assert.throws(() => updateReadiness(old, next, data), /veritabanı bulunamadı/);
});

test('candidate declares its own supported version; future data is never changed', () => {
  const { old, next, data } = fixture(), path = join(data, 'merchant.sqlite');
  const db = new DatabaseSync(path); db.exec('PRAGMA user_version=2'); db.close();
  const bytes = readFileSync(path);
  assert.throws(() => updateReadiness(old, next, data), /veri biçimini desteklemiyor/);
  assert.deepEqual(readFileSync(path), bytes);
  const manifestPath = join(next, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const file = 'packages/domain/data-format.json';
  const content = JSON.stringify({ format: 1, minReadable: 2, maxReadable: 2, writeVersion: 2 });
  writeFileSync(join(next, file), content);
  manifest.files.find((e: { file: string }) => e.file === file).sha256 = createHash('sha256').update(content).digest('hex');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal(updateReadiness(old, next, data).databaseVersion, 2);
  assert.deepEqual(readFileSync(path), bytes);
  manifest.files = manifest.files.filter((e: { file: string }) => e.file !== file);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => updateReadiness(old, next, data), /bildirimi eksik/);
});
