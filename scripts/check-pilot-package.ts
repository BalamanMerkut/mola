import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { MerkezStore } from '../server/merkez/store.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { trialCode } from './merkez-code.js';

// Runs only an isolated local package. Never uses an existing business data folder.
const workspace = process.cwd();
const packageDir = execFileSync(process.execPath, ['scripts/pilot-package.mjs'], { cwd: workspace, encoding: 'utf8', windowsHide: true }).trim();
mkdirSync('.local/tests', { recursive: true });
const dataDir = mkdtempSync(resolve('.local/tests/package-check-'));
const freePort = async () => { const probe = createServer(); await new Promise<void>(done => probe.listen(0, '127.0.0.1', done)); const port = (probe.address() as AddressInfo).port; await new Promise<void>(done => probe.close(() => done())); return port; };
const port = await freePort();
const manifest = JSON.parse(readFileSync(join(packageDir, 'manifest.json'), 'utf8'));
for (const entry of manifest.files) assert.ok(!/(^|\/)(\.local|node_modules|platform-first-login\.txt|merkez-first-login\.txt|development\.key|server-key\.pem|merchant\.sqlite|merkez\.sqlite)(\/|$)/.test(entry.file), 'Pakette özel veri bulundu.');
for (const file of ['docs/YEREL_HTTPS.md', 'docs/YEDEK_PROVASI.md', 'scripts/local-https.ts', 'scripts/local-https-cert.ps1']) assert.ok(existsSync(join(packageDir, file)));
// A Mola Merkez for this check only (in memory key, own folder): the package's café activates against it.
const merkezStore = new MerkezStore(mkdtempSync(resolve('.local/tests/package-merkez-')), randomBytes(32), { initialPassword: 'PaketMerkez!2026' });
const merkezServer = createHttpServer(createMerkezApp(merkezStore)); await new Promise<void>(done => merkezServer.listen(0, '127.0.0.1', done));
process.env.MOLA_MERKEZ_URL = `http://127.0.0.1:${(merkezServer.address() as AddressInfo).port}`;
process.env.MOLA_MERKEZ_PUBLIC_KEY = merkezStore.publicKey;
const { startLocalServer } = await import(pathToFileURL(join(packageDir, 'server/runtime.ts')).href) as typeof import('../server/runtime.js');
const { pilotReadiness } = await import(pathToFileURL(join(packageDir, 'server/pilot-readiness.ts')).href) as typeof import('../server/pilot-readiness.js');
const ready = await pilotReadiness(packageDir, dataDir, port); assert.equal(ready.ready, true); assert.equal(ready.packageIntegrity, 'verified');
process.chdir(packageDir);
const options = { directory: dataDir, port, host: '127.0.0.1' as const, serveBuild: true, cleanInstall: true };
let runtime: Awaited<ReturnType<typeof startLocalServer>> | undefined;
const base = `http://127.0.0.1:${port}`;
const get = (path: string, cookie = '') => fetch(base + path, { headers: { Connection: 'close', Cookie: cookie }, signal: AbortSignal.timeout(5000) });
async function post(path: string, data: unknown, cookie = '') {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Connection: 'close' }, body: JSON.stringify(data), signal: AbortSignal.timeout(10000) });
}
try {
  runtime = await startLocalServer(options);
  const health = await (await get('/api/health')).json();
  assert.equal(health.demoAvailable, false); assert.equal(health.activation, 'activate');
  const page = await get('/'); assert.equal(page.status, 200);
  const asset = (await page.text()).match(/src="([^"]+\.js)"/)?.[1]; assert.ok(asset);
  assert.equal((await get(asset)).status, 200);
  // No vendor panel in a café package.
  assert.equal((await get('/platform')).status, 404); assert.equal((await get('/merkez.html')).status, 404);
  assert.equal((await get('/api/platform/state')).status, 404);
  assert.equal((await post('/api/login', { username: 'isletme', password: 'MolaDemo!2026' })).status, 401);
  // Onboarding: the self-serve trial is retired (410); a vendor's trial code from this computer, then the owner account kept here.
  assert.equal((await post('/api/activation/trial', { businessName: 'Paket Prova Kafe', sector: 'cafe', contactName: 'Paket Prova' })).status, 410);
  const trial = await post('/api/activation/code', { code: await trialCode(process.env.MOLA_MERKEZ_URL!, 'PaketMerkez!2026', 'Paket Prova Kafe') });
  assert.equal(trial.status, 200, await trial.clone().text());
  assert.equal((await post('/api/activation/owner', { username: 'paketprova', password: 'PaketProva!2026' })).status, 200);
  await runtime.close(); runtime = undefined;
  assert.equal(existsSync(join(dataDir, '.mola-operation.lock')), false);
  runtime = await startLocalServer(options);
  assert.equal((await (await get('/api/health')).json()).activation, 'ready', 'the link to Mola Merkez survives a restart');
  assert.equal((await post('/api/login', { username: 'paketprova', password: 'PaketProva!2026' })).status, 200);
  const businesses = merkezStore.read().businesses;
  assert.equal(businesses.length, 1); assert.equal(businesses[0].name, 'Paket Prova Kafe'); assert.equal(businesses[0].kind, 'trial');
  await runtime.close(); runtime = undefined;
  const changedFile = join(packageDir, 'templates/cafe-v1.json'), originalFile = readFileSync(changedFile);
  const database = readFileSync(join(dataDir, 'merchant.sqlite'));
  try {
    writeFileSync(changedFile, Buffer.concat([originalFile, Buffer.from('\n')]));
    await assert.rejects(startLocalServer(options), /manifest ile uyuşmuyor/);
    assert.equal(existsSync(join(dataDir, '.mola-operation.lock')), false);
    assert.deepEqual(readFileSync(join(dataDir, 'merchant.sqlite')), database);
  } finally { writeFileSync(changedFile, originalFile); }
  assert.equal((await pilotReadiness(packageDir, dataDir, port)).packageIntegrity, 'verified');
  console.log(JSON.stringify({ passed: true, packageDir, checks: ['Paket bütünlüğü', 'Özel veri hariç tutma', 'Noktalı klasörde SPA ve JS', 'Demo hesapsız kurulum', 'Kafede yönetim paneli yok', 'Mola Merkez ile etkinleştirme', 'Yeniden başlatmada bağlantı ve hesap koruma'] }, null, 2));
} finally { await runtime?.close(); process.chdir(workspace); merkezServer.closeAllConnections(); merkezServer.close(); merkezStore.close(); }
