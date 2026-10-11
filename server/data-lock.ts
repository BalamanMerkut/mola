import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertRestoreReady } from './restore-safety.js';
/** True only when the lock names a process that no longer exists (left over from a forced close or power cut). */
export function staleLock(path: string) {
  let pid: unknown;
  try { pid = JSON.parse(readFileSync(path, 'utf8')).pid; } catch { return false; }
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0 || pid === process.pid) return false;
  try { process.kill(pid as number, 0); return false; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; }
}
export function dataLock(directory: string, purpose: string) {
  assertRestoreReady(directory);
  try { mkdirSync(directory, { recursive: true }); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTDIR') throw new Error('Veri yolu klasör değil veya üst yol bir dosya. DATA_DIR için doğru klasör yolunu seçin.');
    if (code === 'EACCES' || code === 'EPERM') throw new Error('Veri klasörüne erişilemiyor. Klasör yolunu ve yazma iznini kontrol edin.');
    throw error;
  }
  const path = join(directory, '.mola-operation.lock'), token = randomUUID();
  const write = () => writeFileSync(path, JSON.stringify({ token, pid: process.pid, purpose, createdAt: new Date().toISOString() }), { flag: 'wx' });
  try { write(); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    // A power cut or a forced close leaves the lock behind. If the process that wrote it is gone, the lock is stale:
    // remove it once and continue, so the café is not stuck with "folder in use" after a restart.
    if (!staleLock(path)) throw new Error('Veri klasörü kullanımda. Önce uygulamayı/yedeklemeyi kapatın. Beklenmeyen kapanma olduysa kilit dosyasındaki PID çalışmıyorsa kilidi kaldırın.');
    unlinkSync(path); write();
  }
  return () => { try { if (JSON.parse(readFileSync(path, 'utf8')).token === token) unlinkSync(path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } };
}
