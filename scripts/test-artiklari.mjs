import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
/*
 * Test artıkları (15 Ekim): every unit and browser test run makes its own data folders under .local/tests and .local/e2e
 * (mkdtemp) and never removes them; 38 000 of them had grown to 33 GB. Each run first removes the ones left by earlier runs.
 * Only folders older than KEEP_HOURS go, so a run that is still going in another window keeps its own; selected browser runs'
 * screenshots (test-results/selected-*) stay two days for looking at. Nothing else is touched: real data lives elsewhere.
 */
const KEEP_HOURS = 12;
const places = [[resolve('.local/tests'), KEEP_HOURS], [resolve('.local/e2e'), KEEP_HOURS], [resolve('test-results'), 48, /^selected-/]];

export function clearTestLeftovers() {
  let removed = 0;
  for (const [dir, hours, only] of places) {
    let names; try { names = readdirSync(dir); } catch { continue; }
    const before = Date.now() - hours * 3_600_000;
    for (const name of names) {
      if (only && !only.test(name)) continue;
      const path = join(dir, name);
      try { if (statSync(path).mtimeMs < before) { rmSync(path, { recursive: true, force: true, maxRetries: 2 }); removed++; } } catch { /* in use or gone: next run */ }
    }
  }
  return removed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const removed = clearTestLeftovers();
  if (removed) console.log(`Eski test artıkları temizlendi: ${removed} klasör.`);
}
