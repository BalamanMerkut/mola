import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, join } from 'node:path';
import { temp } from './merkez-fixture.js';
import { writeTree } from './update-fixture.js';

/*
 * The real watchdog (scripts/desktop/nobetci.mjs) and applier (guncelleyici.mjs) with real processes, on a throwaway
 * installation whose "server" is a few lines: it answers /api/health with its package.json version, closes on the desktop
 * key ("Kapat") and asks for an update with exit code 75 ("Şimdi kur"). Checks the hand-over, the health check, the
 * rollback of a version that cannot start (the watchdog keeps restarting it) and that the data stays as it was.
 */
const SERVER = `import { createServer } from 'node:http'; import { readFileSync } from 'node:fs'; import { createHmac } from 'node:crypto';
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version, key = readFileSync(process.env.MOLA_DESKTOP_KEY, 'utf8').trim();
const server = createServer((req, res) => {
  // The ownership proof of server/desktop.ts: HMAC of the nonce under the desktop key.
  if (req.url.startsWith('/api/desktop/kanit?n=')) { res.end(JSON.stringify({ kanit: createHmac('sha256', key).update('mola-masaustu-kanit:' + req.url.split('=')[1]).digest('hex') })); return; }
  if (req.url === '/api/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, role: 'kafe', version })); return; }
  if (req.url === '/api/desktop/shutdown' && req.headers['x-mola-desktop'] === key) { res.end('{}'); server.close(); setTimeout(() => process.exit(0), 50); return; }
  if (req.url === '/test/guncelle' && process.env.MOLA_NOBETCI === '1') { res.end('{}'); setTimeout(() => process.exit(75), 50); return; }
  res.statusCode = 404; res.end('{}');
});
server.listen(Number(process.env.PORT), '127.0.0.1');`;
const BROKEN = `console.error('bozuk sürüm'); process.exit(1);`;
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const freePort = () => new Promise<number>(done => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function appOf(version: string, server = SERVER): Record<string, string> {
  const files: Record<string, string> = { 'server.mjs': server, 'package.json': JSON.stringify({ name: 'mola-app', version, type: 'module' }),
    'nobetci.mjs': readFileSync('scripts/desktop/nobetci.mjs', 'utf8'), 'guncelleyici.mjs': readFileSync('scripts/desktop/guncelleyici.mjs', 'utf8') };
  files['manifest.json'] = JSON.stringify({ version, mode: 'installer', files: Object.entries(files).map(([file, d]) => ({ file, sha256: sha(d) })) });
  return files;
}
/** A downloaded, checked update waiting in guncelleme/ (what server/update-agent.ts leaves behind). */
function pending(root: string, version: string, from: string, server = SERVER) {
  const update = join(root, 'guncelleme'), folder = `${version}/hazir`, app = appOf(version, server);
  writeTree(join(update, version, 'hazir'), Object.fromEntries(Object.entries(app).map(([f, d]) => [`app/${f}`, d])));
  writeFileSync(join(update, 'bekleyen.json'), JSON.stringify({ v: 1, version, from, platform: 'windows', release: 'r', folder, runtime: false, node: process.version, top: [], readyAt: '',
    files: Object.entries(app).map(([f, d]) => ({ path: `app/${f}`, sha256: sha(d), size: Buffer.byteLength(d) })) }));
}
async function health(port: number) { try { const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) }); return (await r.json()).version as string; } catch { return undefined; } }
async function until<T>(what: string, check: () => Promise<T | undefined> | T | undefined, ms = 60_000) {
  const end = Date.now() + ms;
  for (;;) { const v = await check(); if (v) return v; if (Date.now() > end) throw new Error(`Beklenmedi: ${what}`); await sleep(300); }
}

test('watchdog hands a downloaded update to the applier; a version that cannot start is rolled back; data untouched', { timeout: 240_000 }, async t => {
  const root = temp('update-handover'), port = await freePort(), node = join(root, 'runtime', basename(process.execPath));
  mkdirSync(join(root, 'runtime'), { recursive: true }); copyFileSync(process.execPath, node);
  writeTree(root, { ...Object.fromEntries(Object.entries(appOf('0.1.0')).map(([f, d]) => [`app/${f}`, d])), 'masaustu.anahtar': 'test-anahtari', 'veri/merchant.sqlite': 'satışlar', 'veri/media/a.webp': 'foto' });
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), DATA_DIR: join(root, 'veri'), MOLA_DESKTOP_KEY: join(root, 'masaustu.anahtar'), MOLA_GUNCELLEME_SAGLIK_MS: '12000' };
  delete env.MOLA_NOBETCI;
  const watch = () => spawn(node, ['nobetci.mjs', 'server.mjs'], { cwd: join(root, 'app'), env, stdio: 'ignore', detached: true, windowsHide: true }).unref();
  t.after(() => {
    // Every process of this throwaway installation's node (watchdog, server, applier).
    if (process.platform === 'win32') try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='${basename(node)}'" | Where-Object { $_.ExecutablePath -eq '${node}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: 'ignore' }); } catch { /* none */ }
    else try { execFileSync('pkill', ['-f', node], { stdio: 'ignore' }); } catch { /* none */ }
    // The copied node is large: the throwaway installation goes once the test is done.
    for (let i = 0; i < 10; i++) { try { rmSync(root, { recursive: true, force: true }); break; } catch { execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},500)']); } }
  });
  const outcome = () => { try { return JSON.parse(readFileSync(join(root, 'guncelleme', 'sonuc.json'), 'utf8')); } catch { return undefined; } };
  watch();
  assert.equal(await until('0.1.0', () => health(port)), '0.1.0');
  // "Şimdi kur": the server exits with 75, the watchdog hands over, the applier puts 0.1.1 in place and starts it.
  pending(root, '0.1.1', '0.1.0');
  await fetch(`http://127.0.0.1:${port}/test/guncelle`);
  assert.equal(await until('0.1.1 running', async () => (await health(port)) === '0.1.1' && outcome()?.result === 'installed' ? '0.1.1' : undefined, 90_000), '0.1.1');
  assert.equal(JSON.parse(readFileSync(join(root, 'onceki', 'app', 'package.json'), 'utf8')).version, '0.1.0');
  assert.equal(readFileSync(join(root, 'veri', 'merchant.sqlite'), 'utf8'), 'satışlar');
  writeFileSync(join(root, 'guncelleme', 'sonuc.json'), '');
  // "Kapat" with a broken update waiting: installed at closing, it cannot start (the watchdog keeps restarting it), so
  // 0.1.1 comes back; Mola stays closed as the owner wanted.
  pending(root, '0.1.2', '0.1.1', BROKEN);
  await fetch(`http://127.0.0.1:${port}/api/desktop/shutdown`, { method: 'POST', headers: { 'X-Mola-Desktop': 'test-anahtari' } });
  const back = await until('rolled back', () => outcome()?.result, 120_000);
  assert.equal(back, 'rolled_back');
  assert.match(outcome().reason, /açılmadı/);
  assert.equal(JSON.parse(readFileSync(join(root, 'app', 'package.json'), 'utf8')).version, '0.1.1');
  assert.equal(readFileSync(join(root, 'veri', 'merchant.sqlite'), 'utf8'), 'satışlar');
  // The applier finishes by closing Mola again (the owner pressed Kapat).
  await until('applier done', () => /Bitti: rolled_back/.test(readFileSync(join(root, 'logs', 'guncelleme.log'), 'utf8')) || undefined, 60_000);
  assert.equal(existsSync(join(root, 'guncelleme', 'gunluk.json')), false);
  assert.equal(await health(port), undefined, 'closed after Kapat');
  // Next morning: Mola starts again with 0.1.1.
  watch();
  assert.equal(await until('0.1.1 again', () => health(port)), '0.1.1');
  assert.match(readFileSync(join(root, 'logs', 'guncelleme.log'), 'utf8'), /Geri alındı/);
});
