import { readFileSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

export function assertBuildReady(directory: string) {
  try {
    const root = resolve(directory), html = readFileSync(resolve(root, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi)].map(match => match[1]);
    if (!html.trim() || !refs.some(ref => /\.js(?:\?|$)/.test(ref))) throw new Error();
    for (const ref of refs) {
      if (/^(?:[a-z]+:|\/\/)/i.test(ref) || ref.includes('\\')) throw new Error();
      const file = resolve(root, decodeURIComponent(ref.split('?')[0]).replace(/^\//, ''));
      const path = relative(root, file);
      if (!path || isAbsolute(path) || path.startsWith('..')) throw new Error();
      const stat = statSync(file); if (!stat.isFile() || stat.size === 0) throw new Error();
    }
  } catch { throw new Error('Derlenmiş arayüz eksik veya okunamıyor. Geliştirmede npm.cmd run build çalıştırın; pilot kurulumda eksiksiz paketi yeniden açın.'); }
}
