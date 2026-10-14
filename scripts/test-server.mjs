import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';
// Browser tests: a fresh Mola Merkez (port 3190) and a café server (port 3100), each with its own folder under
// .local/e2e/run-*/ (merkez/, kafe/). The café folder gets the demo businesses and is registered at the test Merkez the way
// `npm run merkez:import` does it, so every suite starts with licensed demo businesses.
mkdirSync('.local/e2e', { recursive: true });
const root = mkdtempSync(resolve('.local/e2e/run-')), merkez = join(root, 'merkez'), kafe = join(root, 'kafe');
// E2E_PORT / E2E_MERKEZ_PORT: a second run on the same computer; the run folder is noted for tests/browser/helpers.ts.
const MERKEZ_PORT = process.env.E2E_MERKEZ_PORT ?? '3190', KAFE_PORT = process.env.E2E_PORT ?? '3100', merkezUrl = `http://127.0.0.1:${MERKEZ_PORT}`;
// Another run (or a server left over from one) on these ports would answer instead of ours: stop with a clear message.
for (const port of [MERKEZ_PORT, KAFE_PORT]) {
  const free = await new Promise(done => { const probe = createNetServer(); probe.once('error', () => done(false)); probe.listen(Number(port), '127.0.0.1', () => probe.close(() => done(true))); });
  if (!free) { console.error(`Port ${port} kullanımda: başka bir tarayıcı testi ya da kalmış bir sunucu açık. Kapatıp yeniden deneyin (ya da E2E_PORT / E2E_MERKEZ_PORT verin).`); process.exit(1); }
}
writeFileSync(`.local/e2e/current-${KAFE_PORT}.txt`, root);
// MOLA_TEST_OPEN_SOON (read by Mola Merkez only): the demo businesses (old plan) keep the "Yakında" Deneme platformu open for
// the suites that drive it (server/merkez/store.ts withTestSoon); a business given a package or "Özel" has it closed, as everywhere.
const quiet = { ...process.env, MOLA_AUTO_BACKUP: '0', MOLA_BACKUP_DISCOVERY: '0', MOLA_TEST_OPEN_SOON: '1' };
const children = [];
// Windows: the whole process tree, so no server outlives a failed start.
const stop = signal => { for (const child of children) if (child.exitCode === null) { if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill(signal); } };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(signal); process.exit(0); });
// Misafir menüsünün kendi adresi (server/merkez/menu-host.ts): as on the VDS (menu.molayazilim.com.tr), the guest menu has its
// own name, here menu.localhost (the browser and Node resolve *.localhost to this computer); Mola Yönetim stays on 127.0.0.1.
// MOLA_TEST_TUNNEL lets that plain-http loopback name through (never in a release build).
const merkezChild = spawn(process.execPath, ['--import', 'tsx', 'server/merkez/index.ts'], { stdio: 'inherit', env: { ...quiet, MERKEZ_PORT, MERKEZ_DATA_DIR: merkez, SERVE_BUILD: '1', MOLA_TEST_TUNNEL: '1', MERKEZ_MENU_ORIGIN: `http://menu.localhost:${MERKEZ_PORT}` } });
children.push(merkezChild);
merkezChild.on('exit', code => { stop('SIGTERM'); process.exit(code ?? 1); });
for (let i = 0; ; i++) {
  // Our own Merkez (its folder is filled before it listens), not another run's on the same port.
  try { if ((await fetch(`${merkezUrl}/api/merkez/v1/health`)).ok && existsSync(join(merkez, 'merkez-public-key.txt'))) break; } catch { /* starting */ }
  if (i > 160) { stop('SIGTERM'); throw new Error('Test Mola Merkez açılmadı.'); }
  await new Promise(r => setTimeout(r, 125));
}
// The generated first password must be changed before anything else (Mola Yönetim forces it); the suites use a known one
// (run-*/merkez/e2e-admin-password.txt, read by tests/browser/helpers.ts).
// Not made of "yönetim", a year and "şifre": Mola Merkez refuses such easy passwords (packages/domain/admin-password.ts).
const ADMIN_PASSWORD = 'E2e-Kirmizi-Bisiklet!26';
{
  const first = readFileSync(join(merkez, 'merkez-first-login.txt'), 'utf8').match(/Şifre: (.+)/)[1].trim();
  const login = await fetch(`${merkezUrl}/api/merkez/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: first }) });
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const changed = await fetch(`${merkezUrl}/api/merkez/admin/password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ currentPassword: first, newPassword: ADMIN_PASSWORD }) });
  if (!changed.ok) { stop('SIGTERM'); throw new Error(`Test Mola Yönetim şifresi değiştirilemedi: ${await changed.text()}`); }
  writeFileSync(join(merkez, 'e2e-admin-password.txt'), ADMIN_PASSWORD);
}
const imported = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/merkez-import.ts', kafe, '--merkez', merkezUrl, '--merkez-data', merkez, '--demo', '--sozlesme-kabul', '--password', ADMIN_PASSWORD], { stdio: 'inherit', env: quiet });
if (imported.status !== 0) { stop('SIGTERM'); process.exit(1); }
const kafeChild = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  // MOLA_DESKTOP_KEY: the café computer's window (rail, İkiye böl) for specs that open `/#masaustu=<key>`; the others never see it.
  stdio: 'inherit', env: { ...quiet, PORT: KAFE_PORT, SERVE_BUILD: '1', DATA_DIR: kafe, MOLA_DESKTOP_KEY: join(root, 'masaustu.anahtar'), MOLA_MERKEZ_URL: merkezUrl, MOLA_MERKEZ_PUBLIC_KEY: join(merkez, 'merkez-public-key.txt'), MOLA_SYNC_SOON_MS: '1000', MOLA_HEARTBEAT_MS: '2000',
    // İnternetten menü (server/guest-tunnel.ts): the guest tunnel comes back within half a second, and tests/browser/guest-internet.spec.ts
    // may switch it off and on from this computer (POST /api/test/tunnel) as if the café computer were off.
    MOLA_TEST_TUNNEL: '1', MOLA_TUNNEL_RETRY_MS: '500',
    // QR siparişleri (server/qr-ordering.ts): the suites order as guests without a staff screen open, so "a staff screen is
    // connected" starts off here; tests/browser/qr-ordering.spec.ts turns it on (POST /api/test/qr-staff). The menu copy goes fast.
    MOLA_QR_STAFF_CHECK: '0', MOLA_MIRROR_DELAY_MS: '500',
    // A laptop on the café's Wi-Fi (not the café computer itself): tests/browser/permanent-link.spec.ts opens Mola as
    // http://laptop.localhost (the browser resolves *.localhost to this computer; the page's address is not loopback).
    MOLA_ALLOWED_HOSTS: 'laptop.localhost' },
});
children.push(kafeChild);
kafeChild.on('exit', code => { stop('SIGTERM'); process.exit(code ?? 0); });
