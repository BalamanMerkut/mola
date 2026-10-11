// Mola nöbetçisi (watchdog), copied into the packaged app folder by scripts/build-installer.mjs.
//
//   node nobetci.mjs <server file> [server options]        e.g. node nobetci.mjs server.mjs --lan
//
// Runs the server as a child process with the same Node.js and options. When the server stops unexpectedly (crash, killed
// from Task Manager, out of memory) it is started again after 2, 5, 10, 30, 60, 60… seconds; a run of 10 minutes resets the
// count, and after 10 short runs in a row it gives up (logged), so a server that cannot start (port taken, damaged copy)
// does not spin forever. Exit code 0 from the server ("Kapat" in the window, SIGTERM) ends the watchdog too.
// Mola-Durdur.cmd / Merkez-Durdur.cmd / `mola --durdur` stop both processes (same node executable).
//
// One watchdog per installation and server file: a second one (Mola.exe opened while this one waits to restart) exits at
// once. The lock is a named pipe (Windows) or a socket file (macOS, Linux) named after this node executable's path, so it
// disappears with the process. Lines go to standard output, which the launchers append to logs/sunucu.log (merkez.log).
// The desktop key file is kept across restarts (server/desktop.ts), so the open Mola window keeps working.
//
// Otomatik güncelleme (café server only; GELISTIRICI_REHBERI "Otomatik güncelleme"): when the server downloaded an update
// (<update dir>/bekleyen.json) the watchdog does not start it but hands over to the applier (guncelleyici.mjs, started detached
// from a copy in <update dir>/arac/) and exits, so nothing of app/ and runtime/ is in use while they are swapped; the applier
// starts the server itself. That happens at start (the morning after), when the server exits with 75 ("Şimdi kur", the café
// idle) and when it exits with 0 ("Kapat": installed then and left closed). A journal (gunluk.json) without a running applier
// (a power cut) is handed over too ("devam"). The server's child process gets MOLA_NOBETCI=1: it may ask for exit 75.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [script, ...options] = process.argv.slice(2);
if (!script) { console.error('Kullanım: node nobetci.mjs <sunucu.mjs> [seçenekler]'); process.exit(64); }
const DELAYS = [2, 5, 10, 30, 60];
const STABLE_MS = 10 * 60_000;
const GIVE_UP = 10;
/** The server asks for an update to be applied now. */
const APPLY_UPDATE = 75;
const say = text => console.log(`[nöbetçi ${new Date().toISOString()}] ${text}`);

const id = createHash('sha256').update(`${process.execPath}\n${resolve(script)}`).digest('hex').slice(0, 24);
const lockPath = process.platform === 'win32' ? `\\\\.\\pipe\\mola-nobetci-${id}` : join(tmpdir(), `mola-nobetci-${id}.sock`);

const probe = path => new Promise(done => {
  const socket = createConnection(path);
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => done(false));
});
/** True if this is the only watchdog of this installation; the lock lives as long as this process. */
async function lock() {
  if (await probe(lockPath)) return false;
  if (process.platform !== 'win32') rmSync(lockPath, { force: true });  // left by a watchdog that was killed
  const server = createServer(socket => socket.destroy());
  return new Promise(done => {
    server.once('error', () => done(false));
    server.listen(lockPath, () => { server.unref(); done(true); });
  });
}

// ---------- Otomatik güncelleme ----------
const appDir = dirname(fileURLToPath(import.meta.url)), root = resolve(appDir, '..');
const cafe = basename(script) === 'server.mjs';
const data = resolve(process.env.DATA_DIR ?? join(root, 'veri'));
const updateDir = process.env.MOLA_GUNCELLEME_DIR ? resolve(process.env.MOLA_GUNCELLEME_DIR) : join(dirname(data), 'guncelleme');
const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } };
// Same name as guncelleyici.mjs lockPath(root).
const applierLock = () => { const h = createHash('sha256').update(`mola-guncelleyici\n${resolve(root)}`).digest('hex').slice(0, 24); return process.platform === 'win32' ? `\\\\.\\pipe\\mola-guncelleyici-${h}` : join(tmpdir(), `mola-guncelleyici-${h}.sock`); };
/** 'start', 'wait' (an applier is working; it starts the server itself), 'uygula' or 'devam'. */
async function updateAction() {
  if (!cafe || !existsSync(join(appDir, 'guncelleyici.mjs'))) return 'start';
  const journal = readJson(join(updateDir, 'gunluk.json'));
  if (await probe(applierLock())) return journal && ['baslatildi', 'geri-alindi'].includes(journal.step) ? 'start' : 'wait';
  if (journal) return 'devam';
  if (existsSync(join(updateDir, 'bekleyen.json'))) return 'uygula';
  return 'start';
}
/** Starts the applier, detached, from copies outside app/ and runtime/. false: it could not be started (the server starts as before). */
function handOver(mode, after) {
  try {
    const pending = readJson(join(updateDir, 'bekleyen.json')), journal = readJson(join(updateDir, 'gunluk.json'));
    const version = pending?.version ?? journal?.version ?? '?';
    // An applier that dies at once at every start must not keep the café closed: after three tries the update is left.
    const count = readJson(join(updateDir, 'devir.json'));
    const tries = count?.version === version ? count.count : 0;
    if (tries >= 3) {
      say(`Güncelleme ${version} üç kez başlatılamadı; bırakıldı, sunucu eski sürümle açılıyor.`);
      if (pending) renameSync(join(updateDir, 'bekleyen.json'), join(updateDir, `bekleyen-birakildi-${Date.now()}.json`));
      if (journal && !['yedek', 'tasindi', 'baslatildi', 'geri-aliniyor'].includes(journal.step)) rmSync(join(updateDir, 'gunluk.json'), { force: true });
      writeFileSync(join(updateDir, 'sonuc.json'), JSON.stringify({ v: 1, version, from: journal?.from ?? pending?.from ?? '', result: 'failed', reason: 'Güncelleyici çalıştırılamadı.', at: new Date().toISOString() }));
      rmSync(join(updateDir, 'devir.json'), { force: true });
      return false;
    }
    writeFileSync(join(updateDir, 'devir.json'), JSON.stringify({ version, count: tries + 1, at: new Date().toISOString() }));
    const tools = join(updateDir, 'arac'); mkdirSync(tools, { recursive: true });
    copyFileSync(join(appDir, 'guncelleyici.mjs'), join(tools, 'guncelleyici.mjs'));
    // runtime/ is replaced too: the applier runs on a copy of this node (a running program file cannot be moved away on Windows).
    let node = process.execPath;
    if (pending?.runtime || journal?.moves?.some(m => m.from === join(root, 'runtime'))) {
      node = join(tools, basename(process.execPath));
      if (!existsSync(node) || statSync(node).size !== statSync(process.execPath).size) copyFileSync(process.execPath, node);
    }
    const logs = join(dirname(data), 'logs'); mkdirSync(logs, { recursive: true });
    const env = { ...process.env }; delete env.MOLA_NOBETCI;
    const start = process.platform === 'win32' && existsSync(join(root, 'Mola-Sunucu.cmd'))
      ? { cmd: join(root, 'Mola-Sunucu.cmd') }
      : { node: join(root, 'runtime', basename(process.execPath)), args: [...process.execArgv, 'nobetci.mjs', script, ...options], cwd: join(root, 'app'), log: join(logs, 'sunucu.log') };
    const job = { v: 1, root, data, update: updateDir, port: process.env.PORT ?? '3000', platform: process.platform, desktopKey: process.env.MOLA_DESKTOP_KEY ?? join(root, 'masaustu.anahtar'),
      watchdogPid: process.pid, after, healthMs: Number(process.env.MOLA_GUNCELLEME_SAGLIK_MS) || 90_000, start };
    writeFileSync(join(tools, 'is.json'), JSON.stringify(job, null, 2));
    const fd = openSync(join(logs, 'guncelleme.log'), 'a');
    const child = spawn(node, ['--disable-warning=ExperimentalWarning', join(tools, 'guncelleyici.mjs'), mode, join(tools, 'is.json')], { cwd: tools, detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env });
    closeSync(fd);
    if (!child.pid) return false;
    child.unref();
    say(`Güncelleme ${version} kuruluyor (${mode}); güncelleyici sunucuyu kendisi başlatacak. Ayrıntılar: logs/guncelleme.log`);
    return true;
  } catch (error) { say(`Güncelleyici başlatılamadı: ${error.message}`); return false; }
}

let child, stopping = false, failures = 0;

function start() {
  const began = Date.now();
  child = spawn(process.execPath, [...process.execArgv, script, ...options], { stdio: 'inherit', env: cafe ? { ...process.env, MOLA_NOBETCI: '1' } : process.env });
  child.once('error', error => say(`Sunucu başlatılamadı: ${error.message}`));
  child.once('exit', (code, signal) => {
    child = undefined;
    if (stopping) process.exit(0);
    // "Şimdi kur" / idle install (75), or "Kapat" with an update waiting (installed now, left closed).
    if (cafe && (code === APPLY_UPDATE || code === 0) && existsSync(join(updateDir, 'bekleyen.json'))) {
      if (handOver('uygula', code === 0 ? 'stop' : 'start')) process.exit(0);
      if (code === APPLY_UPDATE) { start(); return; }
    }
    if (code === APPLY_UPDATE) { say('Kurulacak güncelleme bulunamadı; sunucu yeniden başlatılıyor.'); start(); return; }
    if (code === 0) { say('Sunucu kapatıldı; nöbetçi de kapanıyor.'); process.exit(0); }
    if (Date.now() - began >= STABLE_MS) failures = 0;
    failures++;
    const why = signal ? `sinyal ${signal}` : `çıkış kodu ${code}`;
    if (failures > GIVE_UP) {
      say(`Sunucu ${GIVE_UP} kez üst üste kısa sürede kapandı (${why}); yeniden başlatma durduruldu. Yukarıdaki hatalara bakın; Mola'yı yeniden açınca tekrar denenir.`);
      process.exit(1);
    }
    const wait = DELAYS[Math.min(failures - 1, DELAYS.length - 1)];
    say(`Sunucu beklenmedik şekilde kapandı (${why}). ${wait} sn sonra yeniden başlatılıyor (${failures}. kez).`);
    setTimeout(start, wait * 1000);
  });
}

// macOS/Linux stop (pkill, logout): pass it on and leave with the server. Windows ends both processes directly.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  try { process.on(signal, () => { stopping = true; if (child) child.kill('SIGTERM'); else process.exit(0); }); } catch { /* not on this platform */ }
}

if (!(await lock())) {
  say('Bu kurulumun nöbetçisi zaten çalışıyor; ikincisi açılmadı.');
  process.exit(0);
}
const action = await updateAction();
if (action === 'wait') { say('Güncelleme sürüyor; sunucuyu güncelleyici başlatacak.'); process.exit(0); }
if (action !== 'start' && handOver(action, 'start')) process.exit(0);
start();
