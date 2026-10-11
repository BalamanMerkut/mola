import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

/** File consistency only; this is not a signature or a trust check. */
export function verifyPackage(root: string): 'verified' | 'development' {
  root = resolve(root);
  const manifestPath = join(root, 'manifest.json');
  if (!existsSync(manifestPath)) {
    if (existsSync(join(root, 'Temiz-Pilot-Baslat.cmd'))) throw new Error('Paket manifesti eksik. Eksiksiz pilot paketini yeniden açın.');
    return 'development';
  }
  try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      // 'local-pilot': source package run with tsx. 'installer': offline install with one bundled server file.
      if (!['local-pilot', 'installer'].includes(manifest.mode) || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error();
      const seen = new Set<string>();
      for (const entry of manifest.files) {
        if (typeof entry.file !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || entry.file.includes('\\') || entry.file.includes(':') || entry.file.split('/').some((part: string) => !part || part === '.' || part === '..')) throw new Error();
        const target = resolve(root, entry.file), rel = relative(root, target);
        if (isAbsolute(rel) || rel.startsWith('..') || seen.has(entry.file.toLowerCase())) throw new Error();
        seen.add(entry.file.toLowerCase());
        let path = root;
        for (const part of entry.file.split('/')) { path = join(path, part); if (lstatSync(path).isSymbolicLink()) throw new Error(); }
        if (createHash('sha256').update(readFileSync(target)).digest('hex') !== entry.sha256) throw new Error();
      }
      const required = manifest.mode === 'installer' ? ['server.mjs', 'dist/index.html', 'package.json'] : ['server/index.ts', 'dist/index.html', 'templates/cafe-v1.json', 'package.json'];
      for (const file of required) if (!seen.has(file)) throw new Error();
    return 'verified';
  } catch { throw new Error('Paket dosyaları eksik veya manifest ile uyuşmuyor. Eksiksiz pilot paketini yeniden açın.'); }
}
