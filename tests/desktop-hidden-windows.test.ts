import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * 13 Ekim: after an update the applier started the café server detached without windowsHide, so Windows gave it a black
 * console window of its own ("node.exe nobetci.mjs server.mjs --lan"); closing it stopped Mola. Every detached start in the
 * desktop scripts runs hidden.
 */
test('every detached process the desktop scripts start is hidden (no console window on the café computer)', () => {
  const dir = 'scripts/desktop', missing: string[] = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.mjs'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const m of text.matchAll(/spawn\([^;]*?\{[^}]*detached:\s*true[^}]*\}/g)) if (!/windowsHide:\s*true/.test(m[0])) missing.push(`${file}: ${m[0].slice(0, 80)}`);
  }
  assert.deepEqual(missing, []);
});
