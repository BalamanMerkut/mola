import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import assert from 'node:assert/strict';
import { createBackup, restoreBackup } from '../server/backup.js';
import { verifyPackage } from '../server/package-integrity.js';
import { updateReadiness } from '../server/update-readiness.js';
import { MerkezStore } from '../server/merkez/store.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { trialCode } from './merkez-code.js';

// Developer test: executes trusted, locally built packages with freshly created fixture data only.
// Both packages must be from after the Kafe/Merkez split (licences from Mola Merkez). A package from before it still has the
// in-process Ana panel: move such a data folder over once with `npm run merkez:import` instead (docs/GELISTIRICI_REHBERI.md).
const workspace = process.cwd();
if (process.argv.length !== 3) throw new Error('Kullanım: npm run test:update -- <güvenilen-eski-yerel-paket>');
const previous = resolve(process.argv[2]);
assert.equal(verifyPackage(previous), 'verified');
const candidate = execFileSync(process.execPath, ['scripts/pilot-package.mjs'], { cwd: workspace, encoding: 'utf8', windowsHide: true }).trim();
mkdirSync('.local/tests', { recursive: true });
const root = mkdtempSync(resolve('.local/tests/update-rehearsal-')), source = join(root, 'source');
const probe = createServer(); await new Promise<void>(done => probe.listen(0, '127.0.0.1', done));
const port = (probe.address() as AddressInfo).port; await new Promise<void>(done => probe.close(() => done()));
const base = `http://127.0.0.1:${port}`;
// The rehearsal's own Mola Merkez: the café packages activate and keep their licence through it.
const merkezStore = new MerkezStore(join(root, 'merkez'), randomBytes(32), { initialPassword: 'ProvaMerkez!2026' });
const merkezServer = createHttpServer(createMerkezApp(merkezStore)); await new Promise<void>(done => merkezServer.listen(0, '127.0.0.1', done));
process.env.MOLA_MERKEZ_URL = `http://127.0.0.1:${(merkezServer.address() as AddressInfo).port}`; process.env.MOLA_MERKEZ_PUBLIC_KEY = merkezStore.publicKey;
let running: Awaited<ReturnType<typeof import('../server/runtime.js').startLocalServer>> | undefined;
async function start(pkg: string, directory: string) {
  process.chdir(pkg);
  const runtime = await import(pathToFileURL(join(pkg, 'server/runtime.ts')).href) as typeof import('../server/runtime.js');
  running = await runtime.startLocalServer({ directory, port, host: '127.0.0.1', serveBuild: true, cleanInstall: true });
}
async function stop() { await running?.close(); running = undefined; process.chdir(workspace); }
async function call(path: string, body?: object, cookie = '') {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, Connection: 'close' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, `Unexpected status for ${path}`); return response;
}
async function login(password: string) {
  const response = await call('/api/login', { username: 'gecisprova', password });
  return response.headers.getSetCookie()[0].split(';')[0];
}
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
try {
  await start(previous, source);
  const ownerPassword = randomUUID();
  await call('/api/activation/code', { requestId: randomUUID().replace(/-/g, ''), code: await trialCode(process.env.MOLA_MERKEZ_URL!, 'ProvaMerkez!2026', 'Geçiş Prova Kafe') });
  await call('/api/activation/owner', { username: 'gecisprova', password: ownerPassword });
  const created = { tenantId: merkezStore.read().businesses[0].tenantId };
  let owner = await login(ownerPassword);
  const initial = await (await call('/api/staff/state', undefined, owner)).json();
  await call('/api/staff/setup', { requestId: randomUUID(), version: initial.businessRevision, name: initial.name, tableCount: initial.tables.length, changeSeconds: 0, commissionBps: 200 }, owner);
  const menu = await (await call('/api/staff/state', undefined, owner)).json();
  const product = menu.products.find((p: { groups: unknown[]; price: number }) => !p.groups.length && p.price > 0); assert.ok(product);
  await call('/api/staff/orders', { requestId: randomUUID(), tableId: menu.tables[0].id, lines: [{ productId: product.id, quantity: 2, selections: [] }], expectedTotal: product.price * 2 }, owner);
  const ordered = await (await call('/api/staff/state', undefined, owner)).json(), account = ordered.tables[0].account;
  const payment = { requestId: randomUUID(), accountId: account.id, version: account.version, amount: product.price, tendered: product.price, method: 'cash' };
  const paid = await (await call('/api/staff/payments', payment, owner)).json();
  const before = await (await call('/api/staff/state', undefined, owner)).json();
  assert.equal(before.tables[0].account.paid, product.price);
  assert.equal(before.tables[0].account.balance, product.price);
  const ticket = await (await call('/api/staff/support', { requestId: randomUUID(), subject: 'Güncelleme öncesi talep', text: 'Prova kaydı korunmalı.' }, owner)).json();
  await stop();
  const backup = await createBackup(source, join(root, 'backups'), join(root, 'keys'));
  const originalHash = hash(join(source, 'merchant.sqlite'));
  const preparation = updateReadiness(previous, candidate, source);
  const upgraded = await restoreBackup(backup.directory, backup.keyPath, join(root, 'candidate-data'));
  await start(candidate, upgraded.directory);
  owner = await login(ownerPassword);
  const after = await (await call('/api/staff/state', undefined, owner)).json();
  assert.deepEqual(after.products, before.products);
  assert.deepEqual(after.tables[0].account, before.tables[0].account);
  assert.deepEqual(after.orders, before.orders);
  assert.deepEqual(await (await call('/api/staff/payments', payment, owner)).json(), paid);
  assert.equal((await (await call('/api/staff/state', undefined, owner)).json()).tables[0].account.paid, product.price);
  const support = await (await call('/api/staff/support', undefined, owner)).json();
  assert.ok(support.tickets.some((t: { id: string }) => t.id === ticket.id));
  assert.equal(merkezStore.read().businesses[0].tenantId, created.tenantId);
  assert.equal((await (await call('/api/health')).json()).activation, 'ready', 'the restored data keeps its link to Mola Merkez');
  await call('/api/staff/support', { requestId: randomUUID(), subject: 'Güncelleme sonrası talep', text: 'Bu kayıt eski yedekte bulunmaz.' }, owner);
  await stop();
  const changedCopyHash = hash(join(upgraded.directory, 'merchant.sqlite'));
  const rollback = await restoreBackup(backup.directory, backup.keyPath, join(root, 'rollback-data'));
  await start(previous, rollback.directory);
  owner = await login(ownerPassword);
  assert.deepEqual((await (await call('/api/staff/state', undefined, owner)).json()).products, before.products);
  const rolledBack = await (await call('/api/staff/state', undefined, owner)).json();
  assert.deepEqual(rolledBack.tables[0].account, before.tables[0].account);
  assert.deepEqual(rolledBack.orders, before.orders);
  assert.deepEqual(await (await call('/api/staff/payments', payment, owner)).json(), paid);
  const restored = await (await call('/api/staff/support', undefined, owner)).json();
  assert.equal(restored.tickets.length, 1); assert.equal(restored.tickets[0].id, ticket.id);
  assert.equal((await (await call('/api/health')).json()).activation, 'ready');
  await stop();
  assert.equal(hash(join(source, 'merchant.sqlite')), originalHash);
  assert.equal(hash(join(upgraded.directory, 'merchant.sqlite')), changedCopyHash);
  const report = { passed: true, checkedAt: new Date().toISOString(), previous, candidate, preparation,
    checks: ['Eski pakette temiz prova verisi', 'Şifreli yedekten yeni pakete ayrı geri yükleme', 'İşletme, hesap, menü ve destek kaydı korunması', 'Sipariş, kısmi tahsilat ve kalan tutarın korunması; eski tahsilat tekrarının çoğalmaması', 'Yeni pakette yeni işlem', 'Eski paket ve eski yedekle ayrı geri dönüş', 'Kaynak ve yeni veri kopyalarının geri dönüşten etkilenmemesi'],
    limitations: ['Yalnız belirtilen iki yerel paket ve bu örnek veri için geçerlidir.', 'Gerçek sürüm şema değişikliği, tüm finansal senaryolar veya temiz Windows kurulumu testi değildir.', 'Geri dönüş kopyası güncelleme sonrası kayıtları içermez.'],
  };
  writeFileSync(join(root, 'result.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...report, reportPath: join(root, 'result.json') }, null, 2));
} finally { await stop(); merkezServer.closeAllConnections(); merkezServer.close(); merkezStore.close(); }

