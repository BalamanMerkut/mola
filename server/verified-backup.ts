import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createBackup, restoreBackup } from './backup.js';
import { backupPaths, restorePaths, pathsOverlap } from './backup-paths.js';

/** Offline operation. Success is recorded only after a separate restore succeeds. */
export async function createVerifiedBackup(source: string, backups: string, keys: string, checks: string) {
  const paths = await backupPaths(source, backups, keys);
  const target = await restorePaths(paths.outputRoot, join(paths.keyRoot, 'probe.key'), checks);
  if (pathsOverlap(paths.source, target.outputRoot)) throw new Error('Prova hedefi veri klasöründen ayrı olmalı.');
  const backup = await createBackup(paths.source, paths.outputRoot, paths.keyRoot);
  let stage: 'restore' | 'record' = 'restore';
  try {
  const restored = await restoreBackup(backup.directory, backup.keyPath, target.outputRoot);
  const result = { verified: true, checkedAt: new Date().toISOString(), backupDirectory: backup.directory, verificationDirectory: restored.directory, files: restored.files };
  stage = 'record';
  await writeFile(join(backup.directory, 'verification.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return result;
  } catch (error) {
    // Keep the archive and original error; never record private error details.
    await writeFile(join(backup.directory, 'verification-failed.json'), JSON.stringify({ verified: false, checkedAt: new Date().toISOString(), stage,
      message: stage === 'restore' ? 'Ayrı klasöre geri yükleme doğrulanamadı.' : 'Doğrulama başarı kaydı yazılamadı.' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }).catch(() => {});
    throw error;
  }
}
