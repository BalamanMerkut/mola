// Mola güncelleyici (applier), copied into the packaged app folder by scripts/build-installer.mjs. Otomatik güncelleme:
// GELISTIRICI_REHBERI "Otomatik güncelleme".
//
//   node guncelleyici.mjs uygula <is.json>     put the downloaded update (<update dir>/bekleyen.json) in place
//   node guncelleyici.mjs devam <is.json>      go on after a power cut / a killed run (<update dir>/gunluk.json)
//
// The watchdog (nobetci.mjs) starts it, detached, from a copy in <update dir>/arac/ (with a copy of node when the update
// replaces runtime/), then exits: nothing of the running program is in use while app/ and runtime/ are swapped.
// Steps, each written to the journal (gunluk.json, fsync) before it starts, so a power cut at any point is resumed or undone:
//   basladi      files of the update checked again (SHA-256), disk space; the data folder copied to
//                <data>/../guncelleme-yedek/veri-<from>-<time>/ and every copied file compared (the verified pre-update backup)
//   yedek        moves, one rename at a time: app → onceki/app, new app → app (runtime/ and Mola.exe & co. the same way)
//   tasindi      the new program is in place
//   baslatildi   server started (Mola-Sunucu.cmd / the launcher's command), /api/health must answer the new version with the
//                data open within the health time (90 s)
//   tamam        done: sonuc.json "installed", the downloaded files go, onceki/ stays until the next update (rollback by hand)
// Health check fails (or the new program will not start) → geri-aliniyor: the server is stopped, every move is undone in
// reverse order, and if the data folder is not byte for byte the pre-update copy any more (the new version migrated it, or
// wrote to it), it is set aside as <data>-guncelleme-sonrasi-<time> and the pre-update copy put back (and checked). Then the
// old program starts again (geri-alindi) and sonuc.json says "rolled_back" with the reason; the café reports it to Merkez and
// never downloads that version again. The data folder is never deleted.
// Exported functions are used by tests/update-apply.test.ts with fake start/stop/health hooks.
import { spawn, execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statfsSync, statSync, writeSync, chmodSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STEPS = ['basladi', 'yedek', 'tasindi', 'baslatildi', 'tamam', 'geri-aliniyor', 'geri-alindi'];
const MB = 1024 * 1024;
/** Files beside app/ an update may replace (the same list as server/update-manifest.ts TOP_TARGETS). */
export const TOP_TARGETS = {
  win32: ['Mola.exe', 'Mola-Sunucu.cmd', 'Mola-Durdur.cmd', 'Mola-Kaldir.exe', 'BENIOKU.txt'],
  darwin: ['../MacOS/Mola', '../Info.plist', 'Mola.icns'],
  linux: ['mola', 'kaldir.sh', 'BENIOKU.txt', 'mola.png'],
};
/** One log line (logs/guncelleme.log); MOLA_GUNCELLEYICI_SESSIZ=1 keeps tests quiet. */
export const say = text => { if (process.env.MOLA_GUNCELLEYICI_SESSIZ !== '1') console.log(`[güncelleyici ${new Date().toISOString()}] ${text}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

// ---------- Versions (same rules as server/update-manifest.ts compareVersions) ----------
const VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?$/;
export function compareVersions(a, b) {
  const x = VERSION.exec(a), y = VERSION.exec(b);
  if (!x || !y) throw new Error(`Geçersiz sürüm: ${!x ? a : b}`);
  for (let i = 1; i <= 3; i++) { const d = Number(x[i]) - Number(y[i]); if (d) return Math.sign(d); }
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0;
  const p = x[4].split('.'), q = y[4].split('.');
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1; if (q[i] === undefined) return 1;
    const m = /^\d+$/.test(p[i]), n = /^\d+$/.test(q[i]);
    if (m && n) { const d = Number(p[i]) - Number(q[i]); if (d) return Math.sign(d); continue; }
    if (m !== n) return m ? -1 : 1;
    if (p[i] !== q[i]) return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}

// ---------- Small file helpers ----------
export const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } };
/** Written whole or not at all: temp file, fsync, rename. */
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`, fd = openSync(tmp, 'w');
  try { writeSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  renameRetry(tmp, path);
}
export function hashFile(path) {
  const hash = createHash('sha256'), fd = openSync(path, 'r'), buffer = Buffer.alloc(1024 * 1024);
  try { for (let n; (n = readSync(fd, buffer)) > 0;) hash.update(buffer.subarray(0, n)); } finally { closeSync(fd); }
  return hash.digest('hex');
}
/** Windows: antivirus, the search indexer or OneDrive may hold a just-written file for a moment. Patient retries. */
export function renameRetry(from, to, tries = 40) {
  for (let i = 0; ; i++) {
    try { renameSync(from, to); return; }
    catch (error) {
      if (i >= tries || !['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(error.code)) throw error;
      const until = Date.now() + Math.min(2000, 100 * (i + 1)); while (Date.now() < until) { /* short synchronous wait */ }
    }
  }
}
function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name), info = lstatSync(path);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) walk(path, base, out); else out.push(relative(base, path).split(sep).join('/'));
  }
  return out;
}
const folderSize = dir => existsSync(dir) ? walk(dir).reduce((n, f) => n + statSync(join(dir, ...f.split('/'))).size, 0) : 0;
const LOCK = '.mola-operation.lock';
/** Copies a folder file by file and compares every copy with its source (SHA-256). Returns the list. */
export function copyVerified(from, to, skip = name => name === LOCK) {
  const list = [];
  mkdirSync(to, { recursive: true });
  for (const file of existsSync(from) ? walk(from) : []) {
    if (skip(basename(file))) continue;
    const src = join(from, ...file.split('/')), dst = join(to, ...file.split('/'));
    mkdirSync(dirname(dst), { recursive: true }); copyFileSync(src, dst);
    const sha256 = hashFile(src);
    if (hashFile(dst) !== sha256) throw new Error(`Yedek kopyası doğrulanamadı: ${file}`);
    list.push({ file, sha256, size: statSync(src).size });
  }
  return list;
}
/** The data folder is exactly as in the pre-update copy (same files, same contents; the lock file does not count). */
export function sameData(dir, list) {
  const now = existsSync(dir) ? walk(dir).filter(f => basename(f) !== LOCK) : [];
  if (now.length !== list.length) return false;
  const want = new Map(list.map(f => [f.file, f]));
  return now.every(f => { const w = want.get(f); return !!w && statSync(join(dir, ...f.split('/'))).size === w.size && hashFile(join(dir, ...f.split('/'))) === w.sha256; });
}
/** The data lock (server/data-lock.ts format): no server may open the data while it is copied or put back. */
function lockData(dir) {
  const path = join(dir, LOCK);
  mkdirSync(dir, { recursive: true });
  const write = () => { const fd = openSync(path, 'wx'); try { writeSync(fd, JSON.stringify({ token: randomUUID(), pid: process.pid, purpose: 'guncelleme', createdAt: new Date().toISOString() })); } finally { closeSync(fd); } };
  try { write(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = readJson(path)?.pid;
    let alive = false; try { if (Number.isSafeInteger(pid) && pid !== process.pid) { process.kill(pid, 0); alive = true; } } catch (e) { alive = e.code !== 'ESRCH'; }
    if (alive) throw new Error('Veri klasörü kullanımda (sunucu hâlâ açık).');
    rmSync(path, { force: true }); write();
  }
  return () => rmSync(path, { force: true });
}
function freeBytes(dir) { try { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return Infinity; } }

// ---------- The program's own processes ----------
const lockId = root => createHash('sha256').update(`mola-guncelleyici\n${resolve(root)}`).digest('hex').slice(0, 24);
export const lockPath = root => process.platform === 'win32' ? `\\\\.\\pipe\\mola-guncelleyici-${lockId(root)}` : join(tmpdir(), `mola-guncelleyici-${lockId(root)}.sock`);
/** One applier per installation; the lock lives as long as this process (nobetci.mjs probes it). */
export async function takeLock(root) {
  const path = lockPath(root);
  const alive = await new Promise(done => { const probe = createConnection(path); probe.once('connect', () => { probe.destroy(); done(true); }); probe.once('error', () => done(false)); });
  if (alive) return false;
  if (process.platform !== 'win32') rmSync(path, { force: true });
  const server = createServer(socket => socket.destroy());
  return new Promise(done => { server.once('error', () => done(false)); server.listen(path, () => { server.unref(); done(true); }); });
}
const portOpen = port => new Promise(done => { const s = createConnection({ host: '127.0.0.1', port: Number(port) }); s.setTimeout(1500); s.once('connect', () => { s.destroy(); done(true); }); s.once('error', () => done(false)); s.once('timeout', () => { s.destroy(); done(false); }); });
/** Every process started from this installation's runtime/node (the server and its watchdog), except this one. */
function killOwn(root) {
  const node = join(root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq '${node.replace(/'/g, "''")}' -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: 'ignore', windowsHide: true, timeout: 60000 });
    } else {
      const out = execFileSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' });
      for (const line of out.split('\n')) { const m = /^\s*(\d+)\s+(.*)$/.exec(line); if (m && Number(m[1]) !== process.pid && m[2].startsWith(node)) try { process.kill(Number(m[1]), 'SIGKILL'); } catch { /* gone */ } }
    }
  } catch (error) { say(`Süreçler durdurulamadı: ${error.message}`); }
}
/**
 * The program on the port is this installation's server: it answers GET /api/desktop/kanit with the HMAC of a fresh nonce
 * under the desktop key (server/desktop.ts), without the key being sent. Another program on the port (a test server, anything
 * answering 200) never sees the key and never passes as "the new version is up".
 */
async function provesKey(port, key) {
  const nonce = randomBytes(16).toString('hex');
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/desktop/kanit?n=${nonce}`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return false;
    const got = String((await r.json()).kanit ?? ''), want = createHmac('sha256', key).update(`mola-masaustu-kanit:${nonce}`).digest('hex');
    return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
  } catch { return false; }
}
const desktopKey = job => { try { return readFileSync(job.desktopKey, 'utf8').trim(); } catch { return ''; } };
/** The real server: started like the launcher does, stopped like "Kapat" (then by force), health from /api/health. */
export function realHooks(job) {
  return {
    async startServer() {
      const s = job.start;
      if (s.cmd) {
        const child = spawn('cmd.exe', ['/d', '/c', `""${s.cmd}""`], { cwd: job.root, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, env: s.env ?? process.env });
        child.unref(); return;
      }
      mkdirSync(dirname(s.log), { recursive: true });
      const fd = openSync(s.log, 'a');
      // windowsHide: a detached console program gets a window of its own on Windows; without it the café saw a black
      // "node.exe nobetci.mjs" window after every update (13 Ekim), and closing it stopped Mola.
      const child = spawn(s.node, s.args, { cwd: s.cwd, detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env: s.env ?? process.env });
      child.unref(); closeSync(fd);
    },
    async stopServer() {
      const key = desktopKey(job);
      // Like "Kapat": the server closes its data cleanly and its watchdog ends with it (exit 0). Only our own server gets the key.
      if (key && await portOpen(job.port) && await provesKey(job.port, key)) {
        try { await fetch(`http://127.0.0.1:${job.port}/api/desktop/shutdown`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mola-Desktop': key }, body: '{}', signal: AbortSignal.timeout(5000) }); } catch { /* closing anyway */ }
        for (let i = 0; i < 40 && await portOpen(job.port); i++) await sleep(500);
        if (!await portOpen(job.port)) { await sleep(1500); return; }
      }
      // Not answering (a version that cannot start, its watchdog restarting it) or not closing: stopped by force.
      await sleep(1500);
      killOwn(job.root);
      for (let i = 0; i < 20 && await portOpen(job.port); i++) await sleep(500);
    },
    async health(version, ms) {
      const until = Date.now() + ms, key = desktopKey(job); let last = 'yanıt yok';
      while (Date.now() < until) {
        try {
          const r = await fetch(`http://127.0.0.1:${job.port}/api/health`, { signal: AbortSignal.timeout(3000) });
          const h = await r.json();
          if (key && !await provesKey(job.port, key)) last = `${job.port} numaralı bağlantı noktasını başka bir program kullanıyor`;
          else if (r.ok && h.ok === true && h.role === 'kafe' && h.version === version && !h.locked) return { ok: true };
          else last = h.locked ? 'veriler açılamadı (kilitli)' : h.version !== version ? `başka sürüm yanıt verdi (${h.version})` : `yanıt ${r.status}`;
        } catch { /* not up yet */ }
        await sleep(1000);
      }
      return { ok: false, reason: `${Math.round(ms / 1000)} saniyede açılmadı: ${last}` };
    },
  };
}

// ---------- The job ----------
/**
 * job: { root, data, update, port, platform, desktopKey, after: 'start' | 'stop', healthMs, start: { cmd? | node, args, cwd, log } }
 * hooks: startServer(), stopServer(), health(version, ms) → { ok, reason }; crash(point): tests stop the run there (a power cut).
 */
export async function runJob(job, mode, hooks = realHooks(job)) {
  const U = job.update, journalPath = join(U, 'gunluk.json'), pendingPath = join(U, 'bekleyen.json');
  const crash = point => hooks.crash?.(point);
  const save = j => writeJson(journalPath, j);
  const outcome = (j, result, reason, retry = false) => {
    writeJson(join(U, 'sonuc.json'), { v: 1, version: j.version, from: j.from, result, ...(reason ? { reason } : {}), ...(retry ? { retry: true } : {}), at: new Date().toISOString() });
    rmSync(join(U, 'devir.json'), { force: true });
  };
  const bringUp = async () => { if (job.after !== 'stop') await hooks.startServer(); };
  const appVersion = () => readJson(join(job.root, 'app', 'package.json'))?.version;
  const manifestHash = dir => { try { return hashFile(join(dir, 'manifest.json')); } catch { return null; } };

  let j = readJson(journalPath);
  if (!j) {
    const pending = readJson(pendingPath);
    if (!pending) { say('Kurulacak güncelleme yok.'); await bringUp(); return 'none'; }
    const prepared = prepare(job, pending);
    if (prepared.error) {
      say(`Güncelleme kurulmadı: ${prepared.error}`);
      rmSync(pendingPath, { force: true }); if (prepared.dropFolder) rmSync(prepared.dropFolder, { recursive: true, force: true });
      outcome({ version: pending.version, from: pending.from ?? appVersion() ?? '' }, 'failed', prepared.error, prepared.retry);
      await bringUp(); return 'failed';
    }
    j = prepared.journal; save(j); rmSync(pendingPath, { force: true });
    say(`${j.from} → ${j.version} kuruluyor.`);
  } else {
    j.attempts = (j.attempts ?? 1) + 1; save(j);
    say(`Yarım kalan güncelleme sürdürülüyor (adım: ${j.step}, ${j.attempts}. deneme).`);
    // Someone installed another program meanwhile (Mola Kurulum.exe): the journal is of no use, nothing is touched.
    const now = manifestHash(join(job.root, 'app'));
    if (['yedek', 'tasindi', 'baslatildi'].includes(j.step) && now && now !== j.appNew && now !== j.appOld) {
      say('Program bu arada elle değiştirilmiş; yarım güncelleme bırakıldı.'); rmSync(journalPath, { force: true });
      outcome(j, 'failed', 'Program bu arada kurulum paketiyle değiştirilmiş; otomatik güncelleme bırakıldı.'); await bringUp(); return 'abandoned';
    }
    if (j.attempts > 4 && !['geri-aliniyor', 'geri-alindi', 'tamam'].includes(j.step)) { j.reason = 'Güncelleme defalarca yarıda kaldı.'; j.step = 'geri-aliniyor'; save(j); }
  }
  try {
    if (j.step === 'basladi') {
      // The verified pre-update backup: the data folder copied and every copy compared with its source.
      if (freeBytes(dirname(j.dataBackup)) < folderSize(job.data) + 100 * MB) {
        rmSync(journalPath, { force: true }); rmSync(join(U, j.folder), { recursive: true, force: true });
        outcome(j, 'failed', 'Diskte yer yok: güncelleme öncesi veri yedeği alınamadı.', true); await bringUp(); return 'failed';
      }
      rmSync(j.dataBackup, { recursive: true, force: true });
      const unlock = lockData(job.data);
      try { j.dataFiles = copyVerified(job.data, join(j.dataBackup, 'veri')); } finally { unlock(); }
      writeJson(join(j.dataBackup, 'yedek.json'), { v: 1, from: j.from, to: j.version, at: new Date().toISOString(), files: j.dataFiles });
      say(`Veri yedeklendi ve doğrulandı (${j.dataFiles.length} dosya): ${j.dataBackup}`);
      j.step = 'yedek'; save(j); crash('yedek');
    }
    if (j.step === 'yedek') {
      for (const [i, m] of j.moves.entries()) {
        if (m.state === 'done') continue;
        if (m.state === 'moving' && existsSync(m.to) && !existsSync(m.from)) { m.state = 'done'; save(j); continue; }
        if (!existsSync(m.from)) { if (m.optional) { m.state = 'skipped'; save(j); continue; } throw new Error(`Taşınacak dosya yok: ${m.from}`); }
        m.state = 'moving'; save(j);
        mkdirSync(dirname(m.to), { recursive: true });
        try { renameRetry(m.from, m.to, m.stage ? 12 : 40); }
        catch (error) {
          // Mola.exe still open (the launcher waiting for the server): it replaces itself from Mola.exe.yeni at its next start.
          if (!m.stage) throw error;
          if (m.stage === 'leave') { m.state = 'skipped'; save(j); say(`${basename(m.from)} kullanımda; yeni kopyası bırakıldı.`); continue; }
          copyFileSync(m.from, m.stage); m.state = 'staged'; save(j); say(`${basename(m.to)} kullanımda; yenisi ${basename(m.stage)} olarak bırakıldı.`); continue;
        }
        m.state = 'done'; save(j); crash(`move-${i}`);
      }
      if (process.platform !== 'win32') for (const f of j.executables ?? []) try { chmodSync(f, 0o755); } catch { /* not there */ }
      j.step = 'tasindi'; save(j); crash('tasindi');
    }
    if (j.step === 'tasindi' || j.step === 'baslatildi') {
      j.step = 'baslatildi'; save(j);
      await hooks.startServer(); crash('baslatildi');
      const health = await hooks.health(j.version, job.healthMs ?? 90_000);
      if (!health.ok) { j.reason = `Yeni sürüm açılmadı (${health.reason}).`; j.step = 'geri-aliniyor'; save(j); }
      else { j.step = 'tamam'; save(j); }
    }
    if (j.step === 'tamam') {
      say(`${j.version} kuruldu ve açıldı.`);
      outcome(j, 'installed');
      rmSync(join(U, j.folder), { recursive: true, force: true });
      pruneBackups(dirname(j.dataBackup), j.dataBackup);
      rmSync(journalPath, { force: true });
      if (job.after === 'stop') await hooks.stopServer();
      return 'installed';
    }
  } catch (error) {
    if (error?.crash) throw error;
    j.reason = `Güncelleme kurulamadı: ${error.message}`; say(j.reason);
    if (j.step === 'basladi') {
      // Nothing was moved yet: the update is dropped, the program and data are as they were.
      rmSync(journalPath, { force: true }); rmSync(join(U, j.folder), { recursive: true, force: true }); rmSync(j.dataBackup, { recursive: true, force: true });
      outcome(j, 'failed', j.reason, true); await bringUp(); return 'failed';
    }
    j.step = 'geri-aliniyor'; save(j);
  }
  if (j.step === 'geri-aliniyor') {
    say(`Geri alınıyor: ${j.reason ?? ''}`);
    await hooks.stopServer(); crash('durduruldu');
    const aside = join(U, `bozuk-${j.version.replace(/[^0-9A-Za-z.-]/g, '_')}-${stamp()}`);
    for (const m of [...j.moves].reverse()) {
      if (m.state === 'staged') { rmSync(m.stage, { force: true }); m.state = 'undone'; save(j); continue; }
      if (m.state !== 'done' && m.state !== 'moving') continue;
      if (existsSync(m.to)) {
        if (existsSync(m.from)) { mkdirSync(aside, { recursive: true }); renameRetry(m.to, join(aside, `${basename(m.to)}-${randomUUID().slice(0, 8)}`)); }
        else { mkdirSync(dirname(m.from), { recursive: true }); renameRetry(m.to, m.from); }
      }
      m.state = 'undone'; save(j); crash('undo');
    }
    // The data: if the new version changed it (a migration, or anything it wrote), the verified pre-update copy goes back.
    if (j.dataFiles && !sameData(job.data, j.dataFiles)) {
      const kept = `${job.data}-guncelleme-sonrasi-${stamp()}`;
      if (existsSync(job.data)) renameRetry(job.data, kept);
      const unlock = lockData(job.data);
      try { const back = copyVerified(join(j.dataBackup, 'veri'), job.data); if (!sameData(job.data, j.dataFiles) || back.length !== j.dataFiles.length) throw new Error('Geri konan veri doğrulanamadı.'); }
      finally { unlock(); }
      j.dataRestored = kept; say(`Veri güncelleme öncesine döndürüldü; yeni sürümün yazdığı hâli ${kept} klasöründe duruyor.`);
    }
    j.step = 'geri-alindi'; save(j);
  }
  if (j.step === 'geri-alindi') {
    // Written before the old version starts: it must know at once not to download the broken version again.
    outcome(j, 'rolled_back', `${j.reason ?? 'Yeni sürüm açılmadı.'} Önceki sürüme dönüldü; veriler yerinde.`);
    await hooks.startServer();
    const health = await hooks.health(j.from, job.healthMs ?? 90_000);
    if (!health.ok) say(`Önceki sürüm de sağlık denetimini geçmedi: ${health.reason}. Kayıtlara bakın (logs/sunucu.log); elle kurtarma: GELISTIRICI_REHBERI "Otomatik güncelleme".`);
    rmSync(join(U, j.folder), { recursive: true, force: true });
    try { if (!readdirSync(join(job.root, 'onceki')).length) rmSync(join(job.root, 'onceki'), { recursive: true, force: true }); } catch { /* none */ }
    rmSync(journalPath, { force: true });
    if (job.after === 'stop') await hooks.stopServer();
    say('Geri alındı.');
    return 'rolled_back';
  }
  return j.step;
}
/** Checks a pending update again and plans the journal. { journal } or { error, retry, dropFolder }. */
export function prepare(job, pending) {
  const U = job.update, current = readJson(join(job.root, 'app', 'package.json'))?.version;
  const folder = pending.folder?.split('/')[0];
  const hazir = join(U, ...String(pending.folder ?? '').split('/'));
  const drop = { dropFolder: folder ? join(U, folder) : undefined };
  try { if (!current || compareVersions(pending.version, current) <= 0) return { error: `Eski ya da aynı sürüm (${pending.version}, kurulu ${current ?? '?'}); geri dönüş yapılmaz.`, ...drop }; }
  catch { return { error: 'Sürüm bilgisi geçersiz.', ...drop }; }
  if (!folder || !/^[0-9A-Za-z._-]+$/.test(folder) || !existsSync(hazir)) return { error: 'İndirilen güncelleme klasörü bulunamadı.', retry: true, ...drop };
  for (const f of pending.files ?? []) {
    const path = join(hazir, ...f.path.split('/'));
    if (!existsSync(path) || statSync(path).size !== f.size || hashFile(path) !== f.sha256) return { error: `İndirilen güncelleme bozulmuş (${f.path}); yeniden indirilecek.`, retry: true, ...drop };
  }
  const platform = job.platform ?? process.platform, allowed = TOP_TARGETS[platform] ?? [];
  const root = job.root, prev = join(root, 'onceki');
  rmSync(prev, { recursive: true, force: true });
  const moves = [{ from: join(root, 'app'), to: join(prev, 'app') }, { from: join(hazir, 'app'), to: join(root, 'app') }];
  if (pending.runtime) moves.push({ from: join(root, 'runtime'), to: join(prev, 'runtime') }, { from: join(hazir, 'runtime'), to: join(root, 'runtime') });
  const executables = [join(root, 'runtime', 'node')];
  for (const t of pending.top ?? []) {
    if (!allowed.includes(t.target)) return { error: `Güncelleme izin verilmeyen bir dosyayı değiştirmek istiyor: ${t.target}`, ...drop };
    const target = resolve(root, t.target), name = t.target.replace(/[./\\]+/g, '_');
    if (existsSync(target)) moves.push({ from: target, to: join(prev, 'ust', name), ...(basename(target) === 'Mola.exe' ? { stage: 'leave' } : {}) });
    moves.push({ from: join(hazir, ...t.file.split('/')), to: target, ...(basename(target) === 'Mola.exe' ? { stage: `${target}.yeni` } : {}) });
    if (!/\.(txt|plist|icns|png|cmd)$/i.test(target)) executables.push(target);
  }
  const need = folderSize(job.data) + 100 * MB;
  if (freeBytes(job.root) < need) return { error: `Diskte yer yok: güncelleme öncesi yedek için yaklaşık ${Math.ceil(need / MB)} MB gerekli.`, retry: true, ...drop };
  const hash = dir => { try { return hashFile(join(dir, 'manifest.json')); } catch { return null; } };
  return { journal: { v: 1, version: pending.version, from: current, release: pending.release, folder, step: 'basladi', attempts: 1, startedAt: new Date().toISOString(),
    dataBackup: join(dirname(job.data), 'guncelleme-yedek', `veri-${current}-${stamp()}`), moves: moves.map(m => ({ ...m, state: 'todo' })), executables,
    appOld: hash(join(root, 'app')), appNew: hash(join(hazir, 'app')) } };
}
/** Keeps the newest two pre-update data copies. */
function pruneBackups(folder, keep) {
  try {
    const list = readdirSync(folder).filter(n => n.startsWith('veri-')).map(n => join(folder, n)).filter(p => p !== keep).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    for (const old of list.slice(1)) rmSync(old, { recursive: true, force: true });
  } catch { /* nothing to prune */ }
}

// ---------- Command line ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, jobFile] = process.argv.slice(2);
  const job = readJson(jobFile ?? '');
  if (!['uygula', 'devam'].includes(mode) || !job?.root) { console.error('Kullanım: node guncelleyici.mjs uygula|devam <is.json>'); process.exit(64); }
  if (!(await takeLock(job.root))) { say('Güncelleyici zaten çalışıyor.'); process.exit(0); }
  // A run that hangs (a frozen disk) does not hold the café forever: the journal stays, the next start resumes it.
  setTimeout(() => { say('Güncelleyici 20 dakikada bitmedi; bir sonraki açılışta sürdürülecek.'); process.exit(3); }, 20 * 60_000).unref();
  // The watchdog (and its cmd.exe) must be gone: their working folder is app/.
  for (let i = 0; i < 120 && job.watchdogPid; i++) { try { process.kill(job.watchdogPid, 0); } catch { break; } await sleep(500); }
  await sleep(1000);
  try { const result = await runJob(job, mode); say(`Bitti: ${result}.`); process.exitCode = 0; }
  catch (error) {
    say(`Güncelleyici hata verdi: ${error.stack ?? error.message}`);
    // Whatever happened, the café must have a server: the journal stays for the next start.
    try { if (job.after !== 'stop') await realHooks(job).startServer(); } catch { /* nothing more to do */ }
    process.exitCode = 1;
  }
}
