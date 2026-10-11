import path from 'node:path';
import fs from 'node:fs/promises';

export function pathsOverlap(a: string, b: string, paths = path) {
  const inside = (parent: string, child: string) => {
    const rel = paths.relative(paths.resolve(parent), paths.resolve(child));
    return !paths.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${paths.sep}`);
  };
  return inside(a, b) || inside(b, a);
}
async function canonical(target: string): Promise<string> {
  target = path.resolve(target);
  try { return await fs.realpath(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(target); if (parent === target) throw error;
    return path.join(await canonical(parent), path.basename(target));
  }
}
export async function backupPaths(source: string, output: string, keys: string) {
  const [data, backups, secrets] = await Promise.all([canonical(source), canonical(output), canonical(keys)]);
  if (pathsOverlap(data, backups) || pathsOverlap(data, secrets)) throw new Error('Yedek ve anahtar hedefleri veri klasöründen ayrı olmalı; birbirinin alt klasörü olamaz.');
  if (pathsOverlap(backups, secrets)) throw new Error('Yedek ve anahtar hedefleri ayrı klasörler olmalı; aynı veya iç içe klasör kullanmayın.');
  return { source: data, outputRoot: backups, keyRoot: secrets };
}

/** key: the old raw key file; a protected backup carries its sealed key inside, so there is none. */
export async function restorePaths(backup: string, key: string | undefined, output: string) {
  const [source, keyPath, target] = await Promise.all([canonical(backup), key === undefined ? undefined : canonical(key), canonical(output)]);
  if (pathsOverlap(source, target) || (keyPath !== undefined && pathsOverlap(path.dirname(keyPath), target))) throw new Error('Geri yükleme hedefi yedek ve anahtar klasörlerinden ayrı olmalı.');
  // Never place restored data below an existing application data directory.
  let parent = target;
  while (true) {
    for (const name of ['merchant.sqlite', '.mola-operation.lock', 'RESTORE_IN_PROGRESS.txt', 'RESTORE_FAILED.txt']) {
      try { await fs.lstat(path.join(parent, name)); throw new Error('Geri yükleme hedefi mevcut işletme verisinin içinde olamaz. Ayrı bir klasör seçin.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const next = path.dirname(parent); if (next === parent) break; parent = next;
  }
  return { backup: source, keyPath, outputRoot: target };
}
