import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { addDays, businessDay, dayStart, dayStartText } from '../packages/domain/business-day.ts';
import { clearTestLeftovers } from './test-artiklari.mjs';
{ const removed = clearTestLeftovers(); if (removed) console.log(`Eski test artıkları temizlendi: ${removed} klasör.`); }
// Each suite gets a fresh server/data directory: no shared receipts, menu edits or login limits.
const args = process.argv.slice(2);
const suites = args.length ? [args] : readdirSync('tests/browser').filter(f => f.endsWith('.spec.ts')).sort().map(f => [f]);
// A selected run gets its own output folder (selected-<pid>): Playwright empties its output folder at start, so two
// selected runs side by side (other E2E_PORT) would otherwise wipe each other's screenshots and traces.
const selectedDir = resolve('test-results', `selected-${process.pid}`);
// Staff sign-ins end when the business day turns (DAY_START_HOUR, 05:00 Türkiye; server/sessions.ts businessDayEnd). A suite
// running across that moment would be signed out halfway, as a real tablet is. So no suite starts in the last minutes before
// the turn: the run waits for the new business day instead (the longest suite takes about 1.5 minutes with its servers).
const TURN_GUARD_MS = 4 * 60_000;
async function clearOfDayTurn() {
  const left = dayStart(addDays(businessDay(Date.now()), 1)) - Date.now();
  if (left > TURN_GUARD_MS) return;
  console.log(`İş günü değişiyor (${dayStartText}); oturumlar o anda kapanır. Sonraki paket ${Math.ceil(left / 1000) + 15} sn sonra başlayacak.`);
  await new Promise(done => setTimeout(done, left + 15_000));
}
let failures = 0;
for (const [index, suite] of suites.entries()) {
  await clearOfDayTurn();
  const filters = args.length ? suite : ['(?:^|[\\\\/])' + suite[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'];
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...filters], {
    stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_OUTPUT_DIR: args.length ? selectedDir : resolve('test-results', suite[0].replace('.spec.ts', '')) },
  });
  if (args.length) console.log(`Çıktılar: ${selectedDir}`);
  if (result.status !== 0) failures++;
  console.log(`Tarayıcı paketi ${index + 1}/${suites.length}: ${result.status === 0 ? 'başarılı' : 'başarısız'}`);
}
process.exitCode = failures ? 1 : 0;
