import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { transformSync } from 'esbuild';

/*
 * Browser code must never reach a server-only module. Vite dev mode breaks on the first `node:crypto` it meets (it once did,
 * through src/sounds.ts → packages/domain/sound-settings.ts → engine.ts), and a production build only hides it behind an empty
 * shim. Every file under src/ (main.tsx, merkez-main.tsx and the rest) is an entry; each value import is followed through src/,
 * packages/domain and anything else it reaches. Type-only imports are left out the way Vite leaves them out: each file is first
 * compiled with esbuild (TypeScript rules: `import type`, `type` specifiers and imports used only as types disappear).
 */
const root = resolve(import.meta.dirname, '..');
const builtins = new Set(builtinModules.flatMap(m => [m, m.split('/')[0]]));
/** Packages that only run on the server, imported by name instead of `node:`. */
const SERVER_PACKAGES = new Set(['express', 'sharp', 'tsx', 'esbuild', 'vite', '@playwright/test']);
const serverOnly = (specifier: string) => specifier.startsWith('node:') || builtins.has(specifier) || builtins.has(specifier.split('/')[0]) || SERVER_PACKAGES.has(specifier);

/** The value imports of one file, as written (static, re-exports and dynamic `import('…')`). */
function valueImports(file: string): string[] {
  const loader = file.endsWith('.tsx') ? 'tsx' : 'ts';
  const { code } = transformSync(readFileSync(file, 'utf8'), { loader, jsx: 'preserve', format: 'esm', target: 'es2023', legalComments: 'none' });
  const found = new Set<string>();
  for (const pattern of [/^\s*(?:import|export)\b[^;"'`]*?\bfrom\s*"([^"]+)"/gm, /^\s*import\s*"([^"]+)"/gm, /\bimport\(\s*"([^"]+)"\s*\)/g])
    for (const match of code.matchAll(pattern)) found.add(match[1]);
  // A dynamic import with anything but a plain string can not be followed: refuse it rather than miss what it loads.
  assert.doesNotMatch(code, /\bimport\(\s*(?!")/, `${relative(root, file)}: import() with a computed path`);
  return [...found];
}

function resolveRelative(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier), bare = base.replace(/\.(?:m?js|jsx)$/, '');
  for (const candidate of [base, bare + '.ts', bare + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')])
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  return null; // CSS, JSON, images: no imports of their own
}

/** Every server-only import reachable from `entries`, with the chain that reaches it. */
function serverOnlyReach(entries: string[]): string[] {
  const seen = new Map<string, string[]>(), queue = entries.map(entry => [entry]), problems: string[] = [];
  while (queue.length) {
    const chain = queue.shift()!, file = chain.at(-1)!;
    if (seen.has(file)) continue;
    seen.set(file, chain);
    for (const specifier of valueImports(file)) {
      if (specifier.startsWith('.')) { const next = resolveRelative(file, specifier); if (next && !seen.has(next)) queue.push([...chain, next]); }
      else if (serverOnly(specifier)) problems.push([...chain.map(f => relative(root, f).replaceAll('\\', '/')), specifier].join(' → '));
    }
  }
  return problems;
}

const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [join(dir, entry.name)] : []);

test('browser code never imports a server-only module: no value import from src/ reaches node:*, express or sharp', () => {
  const entries = sourceFiles(join(root, 'src'));
  for (const name of ['main.tsx', 'merkez-main.tsx']) assert.ok(entries.includes(join(root, 'src', name)), name);
  assert.deepEqual(serverOnlyReach(entries), []);
});

test('the browser import guard sees through chains and ignores type-only imports', () => {
  // The walker is not passing by accident: the domain engine itself does use node:crypto, one and two steps away.
  assert.ok(serverOnlyReach([join(root, 'packages/domain/engine.ts')]).some(p => p.endsWith('→ node:crypto')));
  assert.ok(serverOnlyReach([join(root, 'packages/domain/sound-settings.ts')]).some(p => p === 'packages/domain/sound-settings.ts → packages/domain/engine.ts → node:crypto'));
  // …while src/ files that use only its types (reports, payment history) stay clean.
  assert.deepEqual(serverOnlyReach([join(root, 'src/SoundPreview.tsx'), join(root, 'src/SalesReports.tsx')]), []);
});
