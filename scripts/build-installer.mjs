// Builds the offline desktop packages, one folder per computer type: copy the right folder to a USB stick and install
// on the café computer. Each package has its own Node.js runtime, one bundled server file, the built screens and the
// image library. No internet, no npm, no source folders. Business data, keys and backups are never copied.
//
//   npm run installer                                   all packages
//   npm run installer -- --platforms=windows            only some (windows, macos-arm64, macos-x64, linux-x64, yonetim)
//   npm run installer -- --skip-ui-build                reuse the existing dist/
//   npm run installer -- --cikti=<folder> --apksiz --guncellemesiz   elsewhere, no Android app, no update bundles (npm run test:paket)
//
// "yonetim" is not a café package: Mola-Yonetim/ is the vendor's own Windows app (Mola Yönetim + Mola Merkez on the
// vendor's computer, until Merkez runs on a VDS). The café packages trust the Merkez key found below and print it at the end.
//
// Windows is built here with the C# compiler that ships with Windows. macOS and Linux need their official Node.js and
// image library files: downloaded once from nodejs.org and registry.npmjs.org, checked against the published hashes,
// and kept in .local/build-cache.
import { build } from 'esbuild';
import sharp from 'sharp';
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { createGzip, gunzipSync } from 'node:zlib';
import { dirname, join, relative, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { folderItems, includeRuntime, updateBundlesWanted, writeUpdateBundle } from './update-bundle.mjs';
import { writeIntegrityManifest } from './integrity-manifest.mjs';
import { molaSunucuCmd } from './desktop/mola-sunucu-cmd.mjs';
import { ICO_SIZES, MOLA_GREEN, YONETIM_BLACK, exeIconImages, icoFile } from './mola-icons.mjs';

if (process.platform !== 'win32') throw new Error('Kurulum paketleri Windows bilgisayarda hazırlanmalı (Mola.exe Windows içindeki C# derleyicisiyle derlenir).');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const nodeVersion = process.version;
const option = name => process.argv.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
const TARGETS = {
  windows: { folder: 'Windows', sharp: ['@img/sharp-win32-x64'] },
  'macos-arm64': { folder: 'macOS-Apple-Silicon', label: 'macOS-AppleSilicon', node: 'darwin-arm64', sharp: ['@img/sharp-darwin-arm64', '@img/sharp-libvips-darwin-arm64'] },
  'macos-x64': { folder: 'macOS-Intel', label: 'macOS-Intel', node: 'darwin-x64', sharp: ['@img/sharp-darwin-x64', '@img/sharp-libvips-darwin-x64'] },
  'linux-x64': { folder: 'Linux-x64', label: 'Linux-x64', node: 'linux-x64', sharp: ['@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64'] },
};
// "merkez-linux": Mola Merkez for a Linux server (VDS), built by scripts/merkez-linux-paket.mjs into Mola-Merkez-Linux/.
const PACKAGES = [...Object.keys(TARGETS), 'yonetim', 'merkez-linux'];
const chosen = (option('--platforms') ?? PACKAGES.join(',')).split(',').map(s => s.trim()).filter(Boolean);
for (const name of chosen) if (!PACKAGES.includes(name)) throw new Error(`Bilinmeyen platform: ${name}. Seçenekler: ${PACKAGES.join(', ')}`);
const cafePackages = chosen.filter(k => TARGETS[k]);

// ---------- Which Mola Merkez the café packages belong to ----------
// The installed Mola Yönetim on this computer (scripts/desktop, "yonetim" package): its Windows "Uygulamalar" entry, else
// the default folder. Only read here, never changed.
const installedYonetim = (() => {
  const folders = [];
  try {
    const text = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MolaYonetim', '/v', 'InstallLocation'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const found = /InstallLocation\s+REG_\w*SZ\s+(.+)/.exec(text)?.[1]?.trim(); if (found) folders.push(found);
  } catch { /* not installed */ }
  if (process.env.LOCALAPPDATA) folders.push(join(process.env.LOCALAPPDATA, 'Mola Yonetim'));
  return folders.find(f => existsSync(join(f, 'veri', 'merkez-public-key.txt')));
})();
const DEV_KEY_FILE = '.local/merkez/merkez-public-key.txt';
// Short fingerprint of a public key (SHA-256 of its bytes), so the vendor can tell keys apart at a glance.
const fingerprint = text => createHash('sha256').update(Buffer.from(text.trim(), 'base64')).digest('hex').slice(0, 16).replace(/(.{4})(?!$)/g, '$1-');
// The Mola Merkez the café servers in these packages talk to: MOLA_MERKEZ_URL, else this computer (installed Mola Yönetim or development Merkez).
const MERKEZ = process.env.MOLA_MERKEZ_URL?.trim()
  ? { url: process.env.MOLA_MERKEZ_URL.trim(), source: 'MOLA_MERKEZ_URL' }
  : { url: 'http://127.0.0.1:4000', source: installedYonetim ? `bu bilgisayarda kurulu Mola Yönetim (${installedYonetim})` : 'varsayılan: bu bilgisayardaki geliştirme Merkezi' };
const MERKEZ_URL = MERKEZ.url;
// The café refuses plain http to a Merkez on another computer unless told it is a trusted local network (server/kafe-link.ts).
const MERKEZ_LAN = /^http:\/\//.test(MERKEZ_URL) && !/^http:\/\/(127\.|localhost[:/]|\[::1\])/.test(MERKEZ_URL);
// Its public key is baked into the café program. Order: MOLA_MERKEZ_PUBLIC_KEY (key or file) → the installed Mola Yönetim's
// key → this computer's development Merkez (.local/merkez). Only needed when a café package is built.
const MERKEZ_KEY = cafePackages.length ? (() => {
  const given = process.env.MOLA_MERKEZ_PUBLIC_KEY?.trim();
  let text, source;
  if (given && existsSync(given)) { text = readFileSync(given, 'utf8'); source = `MOLA_MERKEZ_PUBLIC_KEY dosyası (${resolve(given)})`; }
  else if (given) {
    if (!/^[A-Za-z0-9+/]{40,}={0,2}$/.test(given)) throw new Error(`MOLA_MERKEZ_PUBLIC_KEY ne açık anahtar ne de var olan bir dosya: ${given}`);
    text = given; source = 'MOLA_MERKEZ_PUBLIC_KEY (anahtarın kendisi)';
  } else if (installedYonetim) { const file = join(installedYonetim, 'veri', 'merkez-public-key.txt'); text = readFileSync(file, 'utf8'); source = `bu bilgisayarda kurulu Mola Yönetim (${file})`; }
  else if (existsSync(DEV_KEY_FILE)) { text = readFileSync(DEV_KEY_FILE, 'utf8'); source = `geliştirme Merkezi (${resolve(DEV_KEY_FILE)})`; }
  text = text?.trim();
  if (!text) throw new Error('Mola Merkez genel anahtarı bulunamadı. Mola Yönetim\'i kurup bir kez açın, ya da geliştirme Merkezini bir kez çalıştırın (npm run merkez:dev), ya da MOLA_MERKEZ_PUBLIC_KEY verin; anahtarsız paketteki kafeler lisans doğrulayamaz.');
  try { if (createPublicKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType !== 'ed25519') throw new Error(); }
  catch { throw new Error(`Mola Merkez genel anahtarı geçersiz (Ed25519 olmalı): ${source}`); }
  return { text, source, fingerprint: fingerprint(text) };
})() : undefined;

// Program dosyaları denetimi: one id for this run's café packages, written into each app/butunluk.json (and so into the update
// bundles made from the same folders). A café checks itself only against the signed list of its own build.
const BUILD_ID = randomBytes(8).toString('hex');
// --cikti=<folder>: build somewhere else (scripts/paket-testi.ts builds into its own scratch folder, so the real packages in
// .local/installer stay as they are); its stage folder is inside it, so it never meets another build's stage.
const out = option('--cikti') ? resolve(option('--cikti')) : resolve('.local/installer', `Mola-${version}`);
const cache = resolve('.local/build-cache');
const stage = option('--cikti') ? join(out, '.stage') : join(cache, 'stage');
const desktop = resolve('scripts/desktop');
rmSync(out, { recursive: true, force: true }); rmSync(stage, { recursive: true, force: true });
mkdirSync(out, { recursive: true }); mkdirSync(stage, { recursive: true });

// fs.cpSync crashes Node on this Windows/OneDrive path, so files are copied one by one (links followed, never kept).
function copyTree(source, target) {
  if (statSync(source).isDirectory()) { mkdirSync(target, { recursive: true }); for (const name of readdirSync(source)) copyTree(join(source, name), join(target, name)); }
  else { mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target); }
}
const sha = (data, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(data).digest(encoding);
const unix = text => text.replace(/\r\n/g, '\n');
const crlf = text => text.trim().split('\n').map(l => l.trimEnd()).join('\r\n') + '\r\n';
// Windows file versions are numbers only: a test or pre-release version (0.1.1-test) keeps its label elsewhere.
const fill = text => text.replaceAll('"{{VERSION}}.0"', `"${version.split('-')[0]}.0"`).replaceAll('{{VERSION}}', version);
const bom = text => '\uFEFF' + text.replace(/\r?\n/g, '\r\n');

// ---------- Shared parts: screens, server bundle, icons ----------
if (!process.argv.includes('--skip-ui-build')) execSync('npm.cmd run build', { stdio: 'inherit' });
// The thin Android app (scripts/build-apk.mjs → .local/android/Mola.apk), shipped as app/mobil/Mola.apk and served by the café
// at /uygulama/Mola.apk. Built here when the Android SDK and a JDK are on this computer; otherwise (or if it fails) a warning,
// and only an APK of this same version is shipped. The signing key (.local/android-imza) never goes into a package.
// --apksiz: no Android app (the package test does not need it).
const cafeApk = cafePackages.length && !process.argv.includes('--apksiz') ? (() => {
  try { execFileSync(process.execPath, ['scripts/build-apk.mjs', '--varsa'], { stdio: 'inherit' }); }
  catch { console.warn('UYARI: Mola.apk derlenemedi (yukarıdaki hata). Paketler Android uygulaması olmadan hazırlanıyor.'); return undefined; }
  const file = resolve('.local/android/Mola.apk'), info = resolve('.local/android/Mola.apk.json');
  try { if (existsSync(file) && JSON.parse(readFileSync(info, 'utf8')).versionName === version) return file; } catch { /* no build info */ }
  console.warn(`UYARI: ${version} sürümünün Mola.apk dosyası yok; kafe paketlerinde Android uygulaması olmayacak (/uygulama sayfası tarayıcıyla kullanımı anlatır).`);
  return undefined;
})() : undefined;
// One bundled server file each: the café's server.mjs (with the Merkez key baked in) and Mola Merkez's merkez.mjs.
const bundle = (entry, file, define = {}) => build({
  entryPoints: [entry], outfile: join(stage, file), bundle: true, platform: 'node', format: 'esm', target: 'node24',
  external: ['sharp', 'vite'], minify: true, legalComments: 'none', logLevel: 'warning', define,
  banner: { js: "import { createRequire as __mola_require } from 'node:module'; const require = __mola_require(import.meta.url);" },
});
// MOLA_RELEASE_BUILD lets esbuild drop development-only code (the demo password) from the packaged café.
if (cafePackages.length) await bundle('server/index.ts', 'server.mjs', { 'process.env.MOLA_EMBEDDED_MERKEZ_KEY': JSON.stringify(MERKEZ_KEY.text), 'process.env.MOLA_RELEASE_BUILD': '"1"' });
const iconSvg = readFileSync(join(desktop, 'mola-icon.svg'));
const png = (size, svg = iconSvg) => sharp(svg, { density: Math.max(72, Math.ceil(72 * size / 256)) }).resize(size, size).png().toBuffer();
// Windows icon (scripts/mola-icons.mjs icoFile): 16, 20, 24, 32, 40, 48, 64, 96, 128 and 256 px, the small ones drawn on the
// pixel grid, so the program, its shortcuts and (through the shortcut's taskbar identity, Ortak.cs Taskbar) the Mola window
// are sharp at 100/125/150/200 %. Café green, Mola Yönetim near-black. Checked after compiling (checkIcon).
const ico = (fill = MOLA_GREEN) => icoFile(fill);
function checkIcon(exe) {
  const sizes = exeIconImages(readFileSync(exe)).map(i => i.size);
  const missing = ICO_SIZES.filter(s => !sizes.includes(s));
  if (missing.length) throw new Error(`${exe}: simgede ${missing.join(', ')} px yok.`);
}
async function icns() {
  const parts = [];
  for (const [type, size] of [['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
    const data = await png(size), head = Buffer.alloc(8); head.write(type, 0, 'ascii'); head.writeUInt32BE(data.length + 8, 4); parts.push(head, data);
  }
  const body = Buffer.concat(parts), head = Buffer.alloc(8); head.write('icns', 0, 'ascii'); head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

// ---------- Downloads for other platforms (cached, hash-checked) ----------
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`İndirilemedi (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
async function cached(name, url, check) {
  const file = join(cache, 'downloads', name);
  if (existsSync(file)) { const data = readFileSync(file); if (check(data)) return data; }
  console.log(`İndiriliyor: ${url}`);
  const data = await download(url);
  if (!check(data)) throw new Error(`Dosya doğrulanamadı (özet uyuşmuyor): ${url}`);
  mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data);
  return data;
}
let nodeSums;
async function nodeRuntime(platform) {
  nodeSums ??= (await download(`https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`)).toString('utf8');
  const name = `node-${nodeVersion}-${platform}.tar.gz`;
  const expected = new RegExp(`^([a-f0-9]{64})\\s+${name.replaceAll('.', '\\.')}$`, 'm').exec(nodeSums)?.[1];
  if (!expected) throw new Error(`Node.js özet listesinde yok: ${name}`);
  const files = untar(gunzipSync(await cached(name, `https://nodejs.org/dist/${nodeVersion}/${name}`, data => sha(data) === expected)));
  const pick = path => files.find(f => f.name === `node-${nodeVersion}-${platform}/${path}`)?.data ?? (() => { throw new Error(`${name} içinde ${path} yok`); })();
  return { node: pick('bin/node'), license: pick('LICENSE') };
}
const sharpPackage = JSON.parse(readFileSync('node_modules/sharp/package.json', 'utf8'));
async function npmPackage(name) {
  const wanted = sharpPackage.optionalDependencies[name];
  const meta = JSON.parse((await download(`https://registry.npmjs.org/${name.replace('/', '%2f')}/${wanted}`)).toString('utf8'));
  const [algorithm, digest] = meta.dist.integrity.split('-');
  const data = await cached(`${name.replace('/', '__')}-${wanted}.tgz`, meta.dist.tarball, d => sha(d, algorithm, 'base64') === digest);
  return untar(gunzipSync(data)).filter(f => f.type === '0' && f.name.startsWith('package/')).map(f => ({ name: f.name.slice(8), data: f.data }));
}

// Minimal tar reader (ustar, GNU long names, pax paths) and writer (ustar with Unix permissions, which a ZIP or a
// FAT-formatted USB stick would lose: the Mac and Linux programs must stay executable).
function untar(buffer) {
  const files = []; let offset = 0, longName, paxName;
  while (offset + 512 <= buffer.length) {
    const h = buffer.subarray(offset, offset + 512);
    if (h.every(b => b === 0)) break;
    const field = (start, end) => h.subarray(start, end).toString('utf8').replace(/\0[\s\S]*$/, '');
    let name = field(0, 100); const prefix = field(345, 500); if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(field(124, 136).trim() || '0', 8), type = String.fromCharCode(h[156] || 48);
    const data = buffer.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0[\s\S]*$/, ''); continue; }
    if (type === 'x') { paxName = /\d+ path=([^\n]*)\n/.exec(data.toString('utf8'))?.[1]; continue; }
    if (type === 'g') continue;
    if (longName) { name = longName; longName = undefined; } if (paxName) { name = paxName; paxName = undefined; }
    files.push({ name, type: type === '\0' ? '0' : type, data });
  }
  return files;
}
async function writeTarGz(file, entries) {
  const gzip = createGzip({ level: 9 }), output = createWriteStream(file);
  gzip.pipe(output);
  const write = chunk => new Promise(done => { if (gzip.write(chunk)) done(); else gzip.once('drain', done); });
  const mtime = Math.floor(Date.now() / 1000), dirs = new Set();
  const header = (path, size, mode, type) => {
    const h = Buffer.alloc(512); let name = path, prefix = '';
    if (Buffer.byteLength(name) > 100) { const cut = path.lastIndexOf('/', 155); prefix = path.slice(0, cut); name = path.slice(cut + 1); }
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`Yol çok uzun: ${path}`);
    h.write(name, 0, 'utf8'); h.write(mode.toString(8).padStart(7, '0') + '\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write(mtime.toString(8).padStart(11, '0') + '\0', 136); h.write('        ', 148);
    h.write(type, 156); h.write('ustar\0', 257); h.write('00', 263); h.write('mola', 265); h.write('mola', 297); h.write(prefix, 345, 'utf8');
    h.write(h.reduce((n, b) => n + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  for (const entry of entries) {
    const parts = entry.path.split('/');
    for (let i = 1; i < parts.length; i++) { const d = parts.slice(0, i).join('/') + '/'; if (!dirs.has(d)) { dirs.add(d); await write(header(d, 0, 0o755, '5')); } }
    await write(header(entry.path, entry.data.length, entry.mode ?? 0o644, '0'));
    await write(entry.data);
    if (entry.data.length % 512) await write(Buffer.alloc(512 - entry.data.length % 512));
  }
  await write(Buffer.alloc(1024)); gzip.end(); await finished(output);
}

// ---------- One app folder per platform ----------
function copyPackage(name, appDir, done = new Set()) {
  if (done.has(name)) return; done.add(name);
  const source = resolve('node_modules', name);
  if (!existsSync(join(source, 'package.json'))) throw new Error(`Bağımlılık bulunamadı: ${name}`);
  copyTree(source, join(appDir, 'node_modules', name));
  // Only the image library's own platform files are added (by the caller); the others would be dead weight.
  for (const dep of Object.keys(JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).dependencies ?? {})) copyPackage(dep, appDir, done);
}
// `top`: the launchers beside app/ as they are shipped ({ target: Buffer }, scripts/integrity-manifest.mjs CODE_TOP).
async function appFolder(appDir, target, platform, top) {
  copyTree('dist', join(appDir, 'dist'));
  copyFileSync(join(stage, 'server.mjs'), join(appDir, 'server.mjs'));
  // Watchdog: the launchers run the server under it, so a crashed server comes back by itself.
  copyFileSync(join(desktop, 'nobetci.mjs'), join(appDir, 'nobetci.mjs'));
  // Otomatik güncelleme: the watchdog hands a downloaded update to this applier (scripts/desktop/guncelleyici.mjs).
  copyFileSync(join(desktop, 'guncelleyici.mjs'), join(appDir, 'guncelleyici.mjs'));
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'mola-app', version, private: true, type: 'module', author: 'Merkut Studios' }, null, 2));
  copyPackage('sharp', appDir);
  for (const name of target.sharp) {
    if (target === TARGETS.windows) copyTree(resolve('node_modules', name), join(appDir, 'node_modules', name));
    else for (const f of await npmPackage(name)) { const path = join(appDir, 'node_modules', name, f.name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, f.data); }
  }
  if (cafeApk) { mkdirSync(join(appDir, 'mobil'), { recursive: true }); copyFileSync(cafeApk, join(appDir, 'mobil', 'Mola.apk')); }
  // Program dosyaları denetimi (server/integrity.ts): the code files' list, before manifest.json (which lists it too).
  writeIntegrityManifest(appDir, { version, platform, build: BUILD_ID, top });
  writeManifest(appDir);
}
// File list with hashes: the café server refuses to start from a damaged or incomplete copy; the installers check it is there.
function writeManifest(appDir) {
  const files = [];
  (function collect(dir) { for (const name of readdirSync(dir)) { const path = join(dir, name); if (lstatSync(path).isDirectory()) collect(path); else files.push({ file: relative(appDir, path).replaceAll('\\', '/'), sha256: sha(readFileSync(path)) }); } })(appDir);
  writeFileSync(join(appDir, 'manifest.json'), JSON.stringify({ version, builtAt: new Date().toISOString(), mode: 'installer', files }, null, 2));
}
// "Mola.exe", "Mola Kurulum.exe", "Mola-Kaldir.exe" and their Mola Yönetim twins: compiled with the .NET Framework C#
// compiler that every Windows 10/11 has, each together with Urun.cs (product names; /define:YONETIM for Mola Yönetim) and Ortak.cs
// (port and ownership checks, the Mola window, firewall rules, DPI).
const csc = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
function compile(source, exe, { icon, yonetim = false }) {
  if (!existsSync(csc)) throw new Error('C# derleyicisi bulunamadı (.NET Framework 4). Mola.exe derlenemedi.');
  for (const file of [source, 'Urun.cs', 'Ortak.cs']) writeFileSync(join(stage, file), fill(readFileSync(join(desktop, file), 'utf8')));
  // The same .ico twice: as the program's Windows icon (Explorer, shortcuts, taskbar) and as "mola.ico" for its own windows
  // (Ortak.cs Ui.AppIcon: every size, where the program file's icon would give 32 px only).
  execFileSync(csc, ['/nologo', '/codepage:65001', '/target:winexe', '/optimize+', ...(yonetim ? ['/define:YONETIM'] : []), `/out:${exe}`, `/win32icon:${icon}`, `/resource:${icon},mola.ico`,
    '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Management.dll', join(stage, source), join(stage, 'Urun.cs'), join(stage, 'Ortak.cs')], { stdio: 'inherit' });
  checkIcon(exe);
}
const stopCmd = message => crlf(`
@echo off
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.ExecutablePath -eq '%~dp0runtime\\node.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo ${message}
ping -n 3 127.0.0.1 >nul
`);
function treeEntries(dir, prefix, executable = () => false) {
  const list = [];
  (function walk(d) { for (const name of readdirSync(d).sort()) { const p = join(d, name); if (lstatSync(p).isDirectory()) walk(p); else { const rel = `${prefix}/${relative(dir, p).replaceAll('\\', '/')}`; list.push({ path: rel, data: readFileSync(p), mode: executable(rel) ? 0o755 : 0o644 }); } } })(dir);
  return list;
}
const folderSize = dir => readdirSync(dir).reduce((n, name) => { const p = join(dir, name); return n + (lstatSync(p).isDirectory() ? folderSize(p) : lstatSync(p).size); }, 0);
const MB = bytes => `${(bytes / 1048576).toFixed(0)} MB`;
const report = [];

if (chosen.includes('windows')) {
  // Top of the Windows folder: only "Mola Kurulum.exe" and BENIOKU.txt, so the owner cannot pick the wrong file.
  // Everything the installer copies sits in program/ (which also works on its own, e.g. straight from a USB stick).
  const root = join(out, TARGETS.windows.folder), prog = join(root, 'program'), app = join(prog, 'app');
  mkdirSync(join(prog, 'runtime'), { recursive: true });
  copyFileSync(process.execPath, join(prog, 'runtime', 'node.exe'));
  const icon = join(stage, 'mola.ico');
  writeFileSync(icon, await ico());
  compile('Mola.cs', join(prog, 'Mola.exe'), { icon });
  compile('Kurulum.cs', join(root, 'Mola Kurulum.exe'), { icon });
  // Uninstaller, copied into the installation; also writes the Windows "Ayarlar > Uygulamalar" entry (--kaydet).
  compile('Kaldir.cs', join(prog, 'Mola-Kaldir.exe'), { icon });
  // Server settings: data next to the program, clean install (no demo business), reachable by tablets on the café network.
  // ayarlar.cmd next to it (the owner's, kept by updates and normal removal) may set PORT (Mola.exe reads it too) or
  // MOLA_LAN=0 (this computer only). The server runs under the watchdog (nobetci.mjs): it comes back after a crash; "Kapat"
  // and Mola-Durdur.cmd stop it for good. MOLA_MODE=installed: the packaged app, not a local test (no test badges).
  // MOLA_FIREWALL_HELPER: Tabletler > "İzni düzelt" runs Mola.exe --guvenlik-duvari (server/desktop.ts).
  // The text lives in scripts/desktop/mola-sunucu-cmd.mjs (the update tests start the same launcher).
  writeFileSync(join(prog, 'Mola-Sunucu.cmd'), molaSunucuCmd({ merkezUrl: MERKEZ_URL, merkezLan: MERKEZ_LAN }));
  writeFileSync(join(prog, 'Mola-Durdur.cmd'), stopCmd('Mola durduruldu.'));
  // The app folder after the launchers: its butunluk.json lists them as they are shipped.
  await appFolder(app, TARGETS.windows, 'windows', Object.fromEntries(['Mola.exe', 'Mola-Sunucu.cmd', 'Mola-Durdur.cmd', 'Mola-Kaldir.exe'].map(name => [name, readFileSync(join(prog, name))])));
  // Fallback installer without a window (advanced / silent use): the same job as "Mola Kurulum.exe" (scripts/desktop/Kurulum.cs).
  //   program\\Kur.cmd [target folder] [--no-shortcuts]
  writeFileSync(join(prog, 'Kur.cmd'), crlf(`
@echo off
setlocal
set TARGET=%LOCALAPPDATA%\\Mola
if not "%~1"=="" set TARGET=%~1
echo Mola kuruluyor: %TARGET%
if exist "%TARGET%\\Mola-Durdur.cmd" call "%TARGET%\\Mola-Durdur.cmd" >nul
robocopy "%~dp0app" "%TARGET%\\app" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto fail
robocopy "%~dp0runtime" "%TARGET%\\runtime" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto fail
for %%f in (Mola.exe Mola-Sunucu.cmd Mola-Durdur.cmd Mola-Kaldir.exe) do copy /y "%~dp0%%f" "%TARGET%\\%%f" >nul
if exist "%~dp0..\\BENIOKU.txt" copy /y "%~dp0..\\BENIOKU.txt" "%TARGET%\\BENIOKU.txt" >nul
if not exist "%TARGET%\\Mola.exe" goto fail
if not exist "%TARGET%\\app\\server.mjs" goto fail
del /q "%TARGET%\\Mola-Ac.cmd" "%TARGET%\\Mola-Arkaplan.vbs" 2>nul
"%TARGET%\\Mola-Kaldir.exe" --kaydet
if "%~2"=="--no-shortcuts" goto done
powershell -NoProfile -Command "$s=New-Object -ComObject WScript.Shell; foreach($f in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){ $l=$s.CreateShortcut($f+'\\Mola.lnk'); $l.TargetPath='%TARGET%\\Mola.exe'; $l.WorkingDirectory='%TARGET%'; $l.Description='Mola adisyon ve QR menu'; $l.Save() }; $a=$s.CreateShortcut([Environment]::GetFolderPath('Startup')+'\\Mola.lnk'); $a.TargetPath='%TARGET%\\Mola.exe'; $a.Arguments='--arkaplan'; $a.WorkingDirectory='%TARGET%'; $a.Save(); $k=$s.CreateShortcut([Environment]::GetFolderPath('Programs')+'\\Mola''y'+[char]0x131+' kald'+[char]0x131+'r.lnk'); $k.TargetPath='%TARGET%\\Mola-Kaldir.exe'; $k.WorkingDirectory='%TARGET%'; $k.Save()"
net session >nul 2>&1 && netsh advfirewall firewall delete rule name="Mola" program="%TARGET%\\runtime\\node.exe" >nul 2>&1
net session >nul 2>&1 && netsh advfirewall firewall add rule name="Mola" dir=in action=allow program="%TARGET%\\runtime\\node.exe" profile=private >nul
start "" "%TARGET%\\Mola.exe"
:done
echo Kurulum tamamlandi: %TARGET%
echo Mola aciliyor. Bu pencere birazdan kapanir.
ping -n 4 127.0.0.1 >nul
exit /b 0
:fail
echo Dosyalar kopyalanamadi. Kurulum yarida kaldi; mevcut veriler degistirilmedi.
pause
exit /b 1
`));
  writeFileSync(join(root, 'BENIOKU.txt'), bom(`MOLA ${version} · WINDOWS
Merkut Studios

KURULUM: Mola Kurulum.exe'ye çift tıklayın.

1. Bu klasörün tamamını flash bellekten kafenin bilgisayarına kopyalayın (ya da doğrudan flash bellekten çalıştırın).
2. "Mola Kurulum.exe"ye çift tıklayın, "Kur" düğmesine basın. İnternet gerekmez.
   Windows bir kez "değişiklik yapılsın mı?" diye sorar: yalnız tabletlerin bağlanabilmesi için (güvenlik duvarı,
   yalnız özel ağ). "Evet" deyin; "Hayır" derseniz kurulum yine biter, izni sonra Tabletler > "İzni düzelt" ile verebilirsiniz.
   Program %LOCALAPPDATA%\\Mola klasörüne kurulur ("Değiştir" ile başka bir klasör seçilebilir).
   Masaüstüne ve Başlat menüsüne "Mola" simgesi eklenir.
   Bilgisayar açıldığında Mola arka planda kendiliğinden başlar; tabletler hemen bağlanabilir.
   (Bu iki seçenek kurulum penceresinde işaretlidir; istemezseniz işareti kaldırın.)
   Windows "Bilgisayarınız korundu" derse: Ek bilgi > Yine de çalıştır.
3. Kurulum bitince "Mola'yı aç"a basın; sonra hep masaüstündeki Mola simgesini kullanın.
   Mola kendi penceresinde açılır. İlk açılışta "Mola'yı etkinleştir" çıkar: "Hesap açma başvurusu" (onaylanınca 30 günlük deneme başlar) ya da size verilen
   etkinleştirme kodunu girin. Ardından işletme sahibi hesabını oluşturun ve kurulum sihirbazını tamamlayın.
   Soldaki şeritte Panel, Yedekle, Tabletler, Güvenlik ve Kapat bulunur. Kurtarma kodunu yazdırıp saklayın.
4. Tabletler bağlanamazsa Mola penceresinde Tabletler > "İzni düzelt"e basın (Windows yönetici onayı sorar).
   Mola açıkken simgeye yeniden tıklamak açık pencereyi öne getirir. Mola beklenmedik şekilde kapanırsa kendiliğinden
   yeniden açılır (logs\\sunucu.log).

"program" klasörü kurulumun dosyalarıdır; içini açmanız gerekmez. (İçindeki Kur.cmd aynı kurulumu pencere olmadan
yapar; yalnız ileri kullanım için.)

Pencereyi kapatmak Mola'yı durdurmaz; tabletler çalışmaya devam eder. Tamamen kapatmak için şeritteki "Kapat".

GÜNCELLEME: Yeni sürümün "Mola Kurulum.exe" dosyasını çalıştırın. Mola açıksa açık masaları söyler ve "Şimdi güncelle"
       ya da "Kapanışta güncelle" (gün sonunda Kapat'a basınca) seçtirir; önce yedek alır, sonra Mola'yı yeniden açar.
       Program dosyaları değişir; veriler (veri klasörü), yedekler ve ayarlar.cmd korunur.
AYARLAR: 3000 numaralı bağlantı noktasını başka bir program kullanıyorsa Mola bunu söyler. %LOCALAPPDATA%\\Mola\\ayarlar.cmd
       dosyasına "set PORT=3100" yazıp Mola'yı yeniden açın (masalardaki QR kodlarını yeniden yazdırın).
DURDURMA: Şeritteki "Kapat" ya da %LOCALAPPDATA%\\Mola\\Mola-Durdur.cmd
KAYITLAR: %LOCALAPPDATA%\\Mola\\logs\\sunucu.log (kurulum: logs\\kurulum.log)
YEDEK: Her gece 03:30'da kendiliğinden alınır (%LOCALAPPDATA%\\Mola\\backups). Şeritteki "Yedekle" ile hemen de alınabilir.
       "Yedekle > İkinci yedek yeri" ile flash bellek ya da OneDrive seçin; her yedeğin kopyası oraya da yazılır.

KURTARMA KODU: İlk açılışta Mola 24 harflik bir kurtarma kodu gösterir. Yazdırın ve kasada/evde saklayın.
       Veriler bu bilgisayarın Windows kullanıcısına kilitlidir. Windows şifresi sıfırlanırsa ya da bilgisayar
       değişirse veriler yalnız bu kodla açılır. Kod da bilgisayar da kaybolursa veriler kurtarılamaz.
       Windows hesabının bir şifresi olsun ve Cihaz şifreleme/BitLocker açık olsun.
YENİ BİLGİSAYAR: Mola'yı kurun, ilk ekranda "Yedekten geri yükle"yi seçin, flash belleği gösterin, kodu girin.

KALDIRMA: Ayarlar > Uygulamalar > Yüklü uygulamalar > Mola > Kaldır (ya da Başlat menüsünde "Mola'yı kaldır").
       Program, simgeler ve Windows kaydı silinir. Satışlar, veriler ve yedekler %LOCALAPPDATA%\\Mola klasöründe kalır;
       Mola'yı yeniden kurarsanız kaldığı yerden devam eder. "Verileri ve yedekleri de sil" işaretlenirse onlar da
       kalıcı olarak silinir. Flash bellek ya da OneDrive'daki ikinci yedeklere (Mola-Yedek) hiç dokunulmaz.
       Güvenlik duvarındaki Mola izinlerini silmek yönetici onayı ister: kaldırma penceresinin sonundaki
       "Güvenlik duvarı izinlerini sil" düğmesi (kalırsa zararsızdır).
`));
  report.push(`Windows: ${MB(folderSize(root))}`);
  // Otomatik güncelleme bundle (scripts/update-bundle.mjs): app/, runtime/ only when Node.js changed, Mola.exe & co. as ust/.
  if (updateBundlesWanted()) {
    const top = ['Mola.exe', 'Mola-Sunucu.cmd', 'Mola-Durdur.cmd', 'Mola-Kaldir.exe'].map(name => ({ path: `ust/${name}`, file: join(prog, name), target: name })).concat({ path: 'ust/BENIOKU.txt', file: join(root, 'BENIOKU.txt'), target: 'BENIOKU.txt' });
    const b = await writeUpdateBundle({ out, platform: 'windows', version, node: nodeVersion, runtime: includeRuntime('windows', nodeVersion), items: [...folderItems(app, 'app'), ...folderItems(join(prog, 'runtime'), 'runtime'), ...top], top: top.map(t => ({ file: t.path, target: t.target })) });
    report.push(`Güncelleme (Windows): ${MB(b.size)}${b.runtime ? ', Node.js dahil' : ''}`);
  }
}

for (const key of cafePackages.filter(k => k !== 'windows')) {
  const target = TARGETS[key], root = join(out, target.folder), work = join(stage, key);
  mkdirSync(root, { recursive: true });
  const { node, license } = await nodeRuntime(target.node);
  const entries = [];
  const mac = key.startsWith('macos');
  const base = mac ? 'Mola/Mola.app/Contents/Resources' : 'Mola';
  // The start scripts as shipped (also listed in app/butunluk.json, relative to the folder holding app/).
  const launcher = Buffer.from(unix(readFileSync(join(desktop, mac ? 'mola-macos.sh' : 'mola-linux.sh'), 'utf8')).replaceAll('__MOLA_MERKEZ_URL__', MERKEZ_URL).replaceAll('__MOLA_MERKEZ_LAN__', MERKEZ_LAN ? '1' : ''));
  const remover = mac ? undefined : Buffer.from(unix(readFileSync(join(desktop, 'kaldir-linux.sh'), 'utf8')));
  await appFolder(join(work, 'app'), target, key, mac ? { '../MacOS/Mola': launcher } : { mola: launcher, 'kaldir.sh': remover });
  entries.push(...treeEntries(join(work, 'app'), `${base}/app`));
  entries.push({ path: `${base}/runtime/node`, data: node, mode: 0o755 }, { path: `${base}/runtime/LICENSE`, data: license });
  const readme = mac ? `MOLA ${version} · macOS (${key === 'macos-arm64' ? 'Apple Silicon: M1, M2, M3, M4' : 'Intel işlemci'})
Merkut Studios

KURULUM
1. Mola-${target.label}-${version}.tar.gz dosyasına çift tıklayın. "Mola" klasörü açılır.
2. İçindeki Mola uygulamasını Uygulamalar (Applications) klasörüne sürükleyin.
3. Mola'yı açın. İlk açılışta "geliştirici doğrulanamadı" uyarısı çıkarsa: Mola'ya sağ tıklayın > Aç > Aç.
   (ya da Sistem Ayarları > Gizlilik ve Güvenlik > "Yine de Aç")
4. Mola kendi penceresinde açılır (Microsoft Edge, Google Chrome ya da Brave yüklüyse). Yalnız Safari varsa sekmede açılır.
   İlk açılışta "Mola'yı etkinleştir" çıkar: "Hesap açma başvurusu" gönderin (onaylanınca 30 günlük deneme başlar) ya da etkinleştirme kodunu girin.
   Soldaki şeritte Panel, Yedekle, Tabletler, Güvenlik ve Kapat bulunur.
5. Bilgisayar açılınca kendiliğinden başlasın: Sistem Ayarları > Genel > Giriş Öğeleri > + > Mola.
6. Tabletler bağlanamazsa: Sistem Ayarları > Ağ > Güvenlik Duvarı'nda Mola'ya (node) gelen bağlantı izni verin.

Gereken: macOS 13.5 (Ventura) veya daha yeni.
VERİLER: ~/Library/Application Support/Mola (veri, yedekler, kayıtlar). Güncellemede yalnız Mola uygulaması değişir.
KURTARMA KODU: İlk açılışta gösterilen 24 harflik kodu yazdırıp saklayın. Anahtar bu Mac'in anahtarlığında (Keychain)
       kilitlidir; Mac değişirse veriler yalnız bu kodla açılır. FileVault açık olsun.
GÜNCELLEME: Yeni Mola uygulamasını Uygulamalar klasöründekinin üzerine sürükleyin.
KALDIRMA: Önce şeritteki "Kapat" ile Mola'yı durdurun, sonra Uygulamalar klasöründeki Mola.app'i Çöp Kutusu'na taşıyın.
       Veriler ve yedekler ~/Library/Application Support/Mola klasöründe kalır; yeniden kurarsanız kaldığı yerden
       devam eder. Tamamen silmek için o klasörü de silin (geri alınamaz). Giriş Öğeleri'ne eklediyseniz oradan da çıkarın.
` : `MOLA ${version} · LINUX (x64: Ubuntu, Pardus, Mint, Debian, Fedora...)
Merkut Studios

KURULUM
1. Mola-${target.label}-${version}.tar.gz dosyasını açın (çift tıklayıp "Çıkart" ya da: tar xzf Mola-${target.label}-${version}.tar.gz).
2. Açılan Mola klasöründe terminal açıp çalıştırın:  ./kur.sh
   Yönetici (root) yetkisi gerekmez. Program ~/.local/share/mola klasörüne kurulur.
   Uygulama menüsüne ve masaüstüne "Mola" eklenir; oturum açılınca arka planda kendiliğinden başlar.
3. Mola kendi penceresinde açılır (Chromium, Google Chrome, Microsoft Edge ya da Brave yüklüyse); yoksa varsayılan tarayıcıda.
   İlk açılışta "Mola'yı etkinleştir" çıkar: "Hesap açma başvurusu" gönderin (onaylanınca 30 günlük deneme başlar) ya da etkinleştirme kodunu girin.

Gereken: 64 bit Linux, glibc 2.28 veya daha yeni (Ubuntu 20.04+, Pardus 21+, Debian 10+).
VERİLER: ~/.local/share/mola/veri ve ~/.local/share/mola/backups. Güncellemede korunur.
KORUMA: Linux'ta anahtar dosyada korumasız durur. Diski mutlaka şifreleyin (kurulumda "disk şifreleme / LUKS").
       İlk açılışta gösterilen 24 harflik kurtarma kodunu yazdırıp saklayın; yedekler başka bilgisayarda bu kodla açılır.
GÜNCELLEME: Yeni sürümün kur.sh dosyasını çalıştırın.
DURDURMA: Şeritteki "Kapat" ya da: ~/.local/share/mola/mola --durdur
KALDIRMA: ~/.local/share/mola/kaldir.sh
       Program, menü/masaüstü simgeleri ve otomatik başlatma silinir; veriler ve yedekler kalır (yeniden kurunca
       kaldığı yerden devam eder). Hepsini silmek için: ~/.local/share/mola/kaldir.sh --verileri-sil (geri alınamaz).
       Flash bellek ya da başka bir yerdeki ikinci yedeklere dokunulmaz.
`;
  if (mac) {
    entries.push({ path: 'Mola/Mola.app/Contents/Info.plist', data: Buffer.from(fill(unix(readFileSync(join(desktop, 'Info.plist'), 'utf8')))) });
    entries.push({ path: 'Mola/Mola.app/Contents/MacOS/Mola', data: launcher, mode: 0o755 });
    entries.push({ path: 'Mola/Mola.app/Contents/Resources/Mola.icns', data: await icns() });
  } else {
    entries.push({ path: 'Mola/mola', data: launcher, mode: 0o755 });
    entries.push({ path: 'Mola/kur.sh', data: Buffer.from(unix(readFileSync(join(desktop, 'kur-linux.sh'), 'utf8'))), mode: 0o755 });
    entries.push({ path: 'Mola/kaldir.sh', data: remover, mode: 0o755 });
    entries.push({ path: 'Mola/mola.png', data: await png(256) });
  }
  entries.push({ path: 'Mola/BENIOKU.txt', data: Buffer.from(readme) });
  const archive = join(root, `Mola-${target.label}-${version}.tar.gz`);
  await writeTarGz(archive, entries);
  writeFileSync(join(root, 'BENIOKU.txt'), bom(readme));
  report.push(`${target.folder}: ${MB(statSync(archive).size)} (sıkıştırılmış)`);
  // Otomatik güncelleme bundle: the same files, relative to the folder that holds app/ (Mola.app/Contents/Resources on a Mac).
  if (updateBundlesWanted()) {
    const tops = mac ? { 'Mola/Mola.app/Contents/MacOS/Mola': '../MacOS/Mola', 'Mola/Mola.app/Contents/Info.plist': '../Info.plist', 'Mola/Mola.app/Contents/Resources/Mola.icns': 'Mola.icns' }
      : { 'Mola/mola': 'mola', 'Mola/kaldir.sh': 'kaldir.sh', 'Mola/BENIOKU.txt': 'BENIOKU.txt', 'Mola/mola.png': 'mola.png' };
    const items = entries.flatMap(e => e.path.startsWith(`${base}/app/`) || e.path.startsWith(`${base}/runtime/`) ? [{ path: e.path.slice(base.length + 1), data: e.data, mode: e.mode }]
      : tops[e.path] ? [{ path: `ust/${tops[e.path].replace(/^\.\.\//, '').replaceAll('/', '-')}`, data: e.data, mode: e.mode, target: tops[e.path] }] : []);
    const b = await writeUpdateBundle({ out, platform: key, version, node: nodeVersion, runtime: includeRuntime(key, nodeVersion), items, top: items.filter(i => i.target).map(i => ({ file: i.path, target: i.target })) });
    report.push(`Güncelleme (${target.folder}): ${MB(b.size)}${b.runtime ? ', Node.js dahil' : ''}`);
  }
}

// ---------- Mola Yönetim: the vendor's own Windows app (Mola Merkez on this computer until it moves to a VDS) ----------
// Same layout as the café's Windows folder: only "Mola Yönetim Kurulum.exe" and BENIOKU.txt on top, the rest in program/.
// The Merkez listens on 127.0.0.1 unless MERKEZ_LAN=1; data in <install>\veri; no business data ever (see server/merkez).
if (chosen.includes('yonetim')) {
  const root = join(out, 'Mola-Yonetim'), prog = join(root, 'program'), app = join(prog, 'app');
  await bundle('server/merkez/index.ts', 'merkez.mjs', { 'process.env.MOLA_RELEASE_BUILD': '"1"' });
  // "Şifremi unuttum" without any code: Sifre-Sifirla.cmd runs this on the Merkez computer (scripts/merkez-sifre-sifirla.ts).
  await bundle('scripts/merkez-sifre-sifirla.ts', 'merkez-sifre-sifirla.mjs', { 'process.env.MOLA_RELEASE_BUILD': '"1"' });
  mkdirSync(join(prog, 'runtime'), { recursive: true });
  // The built screens: Merkez serves merkez.html for every page; index.html only inside a Mola destek session
  // (/destek/<id>, server/merkez/relay.ts) and raporlarim.html on /raporlarim (the owner's phone).
  for (const name of readdirSync('dist')) copyTree(join('dist', name), join(app, 'dist', name));
  if (!existsSync(join(app, 'dist', 'raporlarim.html'))) throw new Error('dist/raporlarim.html yok: önce npm run build.');
  if (!existsSync(join(app, 'dist', 'merkez.html'))) throw new Error('dist/merkez.html yok: önce npm run build.');
  copyFileSync(join(stage, 'merkez.mjs'), join(app, 'merkez.mjs'));
  copyFileSync(join(stage, 'merkez-sifre-sifirla.mjs'), join(app, 'merkez-sifre-sifirla.mjs'));
  copyFileSync(join(desktop, 'nobetci.mjs'), join(app, 'nobetci.mjs'));
  // Destek ekleri (server/merkez/attachments.ts): merkez.mjs imports the image library, so it ships with it (Windows files).
  copyPackage('sharp', app);
  for (const name of TARGETS.windows.sharp) copyTree(resolve('node_modules', name), join(app, 'node_modules', name));
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'mola-yonetim', version, private: true, type: 'module', author: 'Merkut Studios' }, null, 2));
  writeManifest(app);
  copyFileSync(process.execPath, join(prog, 'runtime', 'node.exe'));
  const icon = join(stage, 'mola-yonetim.ico');
  writeFileSync(icon, await ico(YONETIM_BLACK));
  compile('Mola.cs', join(prog, 'Mola Yönetim.exe'), { icon, yonetim: true });
  compile('Kurulum.cs', join(root, 'Mola Yönetim Kurulum.exe'), { icon, yonetim: true });
  compile('Kaldir.cs', join(prog, 'Mola-Yonetim-Kaldir.exe'), { icon, yonetim: true });
  // Merkez settings. ayarlar.cmd next to it (kept by updates) may set MERKEZ_LAN=1 or MERKEZ_PORT; so may the Windows user's
  // environment. Only MERKEZ_LAN=1 opens it to the network: MERKEZ_HOST is always decided here.
  // Runs under the same watchdog as the café server (nobetci.mjs). MOLA_MODE=installed: no "Yerel test ortamı" badge.
  // MERKEZ_KEY_PROTECTION=1: the data key is locked to this Windows user (DPAPI) + the Merkez recovery code, once that code
  // is confirmed (server/merkez/key-guard.ts). "set MERKEZ_KEY_PROTECTION=0" in ayarlar.cmd is the vendor's way back.
  writeFileSync(join(prog, 'Merkez-Sunucu.cmd'), crlf(`
@echo off
cd /d "%~dp0app"
if exist "%~dp0ayarlar.cmd" call "%~dp0ayarlar.cmd"
set SERVE_BUILD=1
set MOLA_MODE=installed
if not defined MERKEZ_KEY_PROTECTION set MERKEZ_KEY_PROTECTION=1
if not defined MERKEZ_DATA_DIR set MERKEZ_DATA_DIR=%~dp0veri
if not defined MERKEZ_PORT set MERKEZ_PORT=4000
set MERKEZ_HOST=127.0.0.1
if "%MERKEZ_LAN%"=="1" set MERKEZ_HOST=0.0.0.0
if not exist "%~dp0logs" mkdir "%~dp0logs"
"%~dp0runtime\\node.exe" --disable-warning=ExperimentalWarning nobetci.mjs merkez.mjs >> "%~dp0logs\\merkez.log" 2>&1
`));
  writeFileSync(join(prog, 'Merkez-Durdur.cmd'), stopCmd('Mola Merkez durduruldu.'));
  // Last-resort password reset (no Merkez recovery code, no MFA backup code). Opens veri\ like the server (same user's key;
  // locked for this user: asks the Merkez recovery code, hidden), refuses while Merkez runs (exit 3): then offers to stop it
  // with Merkez-Durdur.cmd and tries again.
  writeFileSync(join(prog, 'Sifre-Sifirla.cmd'), crlf(`
@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0app"
if exist "%~dp0ayarlar.cmd" call "%~dp0ayarlar.cmd"
if not defined MERKEZ_KEY_PROTECTION set MERKEZ_KEY_PROTECTION=1
if not defined MERKEZ_DATA_DIR set MERKEZ_DATA_DIR=%~dp0veri
set DURDURULDU=
:dene
"%~dp0runtime\\node.exe" --disable-warning=ExperimentalWarning merkez-sifre-sifirla.mjs %*
set SONUC=%errorlevel%
if "%SONUC%"=="3" goto calisiyor
if "%SONUC%"=="0" if defined DURDURULDU echo Mola Merkez durduruldu. Masaüstündeki "Mola Yönetim" simgesiyle açın; Merkez de yeniden başlar.
goto son
:calisiyor
echo.
choice /c EH /n /m "Mola Merkez şimdi durdurulsun mu? Kafeler birkaç dakika bağlanamaz; Mola Yönetim'i açınca yeniden başlar. [E/H] "
if errorlevel 2 goto son
call "%~dp0Merkez-Durdur.cmd"
set DURDURULDU=1
goto dene
:son
echo.
pause
`));
  // The same for a Merkez copied to macOS or Linux (e.g. a VDS): runtime/node next to it, else node on the PATH.
  writeFileSync(join(prog, 'sifre-sifirla.sh'), `#!/bin/sh
# Mola Yönetim: yönetici şifresini sıfırla (son çare). Merkez'in bilgisayarında, Merkez verisinin sahibi kullanıcıyla çalıştırın.
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/app" || exit 1
NODE="$DIR/runtime/node"; [ -x "$NODE" ] || NODE="$(command -v node)"
[ -n "$NODE" ] || { echo "Node.js bulunamadı."; exit 1; }
: "\${MERKEZ_DATA_DIR:=$DIR/veri}"; export MERKEZ_DATA_DIR
"$NODE" --disable-warning=ExperimentalWarning merkez-sifre-sifirla.mjs "$@"
code=$?
[ "$code" = 3 ] && echo "Önce Mola Merkez'i durdurun (çalışan 'node merkez.mjs' işlemi ya da sunucudaki servisi), sonra yeniden çalıştırın."
exit $code
`, { mode: 0o755 });
  writeFileSync(join(root, 'BENIOKU.txt'), bom(`MOLA YÖNETİM ${version} · WINDOWS
Merkut Studios

YALNIZ SATICININ (Merkut Studios) BİLGİSAYARI İÇİN. KAFELERE KURULMAZ; kafeler için "Windows" klasörü.

NEDİR: Mola Yönetim, kafelerin lisanslarını, etkinleştirme kodlarını ve destek taleplerini yönettiğiniz paneldir.
Arkasında Mola Merkez çalışır: kafelerdeki Mola programları lisansını ondan alır ve ona bağlanır. Merkez internetteki
bir sunucuya (VDS) taşınınca bu paket gerekmez; Mola Yönetim o adresten açılır.

KURULUM
1. "Mola Yönetim Kurulum.exe"ye çift tıklayın, "Kur"a basın. İnternet ve yönetici yetkisi gerekmez.
   Program %LOCALAPPDATA%\\Mola Yonetim klasörüne kurulur. Masaüstüne ve Başlat menüsüne "Mola Yönetim" eklenir.
   "Bilgisayar açılınca Merkez'i başlat" işaretli gelir: Windows açılınca Merkez arka planda başlar, kafeler lisans alır.
   (Merkez kapalıyken de kafelerin lisansı bitiş tarihine kadar çalışır; deneme başlatmak, kod girmek ve uzatmanın kafeye
   ulaşması için Merkez açık olmalı.)
   Windows "Bilgisayarınız korundu" derse: Ek bilgi > Yine de çalıştır.
2. "Mola Yönetim'i aç". İlk açılışta küçük bir pencere ilk giriş bilgilerini gösterir (kullanıcı adı: admin ve şifre).
   Bu bilgiler yalnız bu bilgisayarın ekranında gösterilir, ağdan görülmez. Giriş yapın, "Hesap güvenliği"nde kendi
   şifrenizi belirleyin ve iki adımlı girişi açın. Şifre değişince ilk şifre silinir, o pencere bir daha çıkmaz.

GÜNLÜK KULLANIM: Masaüstündeki "Mola Yönetim" simgesi. Pencereyi kapatmak Merkez'i durdurmaz; kafeler bağlanmaya devam eder.
DURDURMA: %LOCALAPPDATA%\\Mola Yonetim\\Merkez-Durdur.cmd
KAYITLAR: %LOCALAPPDATA%\\Mola Yonetim\\logs\\merkez.log (kurulum: logs\\kurulum.log)

ŞİFREMİ UNUTTUM (Mola Yönetim yönetici şifresi)
   1. Bu bilgisayarda Mola Yönetim'i açın, giriş ekranında "Şifremi unuttum"a basın. Yalnız Merkez'in çalıştığı bu
      bilgisayarda çalışır; başka bilgisayardan ya da ağdan yapılamaz. Elinizdeki kodlardan birini girin:
      - Merkez kurtarma kodu: Ayarlar > Yedek'te gösterilen 24 harflik kod (yazdırdığınız ya da kopyaladığınız kod), ya da
      - iki adımlı doğrulamanın yedek kodlarından biri (iki adımlı girişi açarken kaydettiğiniz 32 karakterlik kodlar;
        her biri bir kez kullanılır).
      Sonra yeni şifreyi belirleyin. Bütün yönetici oturumları kapanır. İki adımlı giriş açıksa ve Merkez kurtarma
      kodunu kullandıysanız doğrulayıcı uygulamadaki kod da sorulur; telefonunuz yoksa "Doğrulayıcıyı da sıfırla"yı seçin
      (iki adımlı giriş kapanır, girişten sonra Ayarlar > Hesap güvenliği'nden yeniden kurun).
   2. E-posta ayarlarını yaptıysanız (Ayarlar > E-posta bildirimleri): "Şifremi unuttum" > "E-postayla" > "E-postama kod gönder".
      Kullanıcı adı (admin) ve yönetici e-postanızı yazın; 6 haneli kod gelir (15 dakika, tek kullanımlık). İki adımlı giriş
      açıksa doğrulayıcı uygulamadaki kod da sorulur; telefonunuz yoksa onun yerine Merkez kurtarma kodu.
   3. Hiçbir kodunuz yoksa (son çare): %LOCALAPPDATA%\\Mola Yonetim\\Sifre-Sifirla.cmd'ye çift tıklayın. Mola Yönetim'i
      kuran Windows kullanıcısıyla, bu bilgisayarda çalıştırın. Merkez açıksa durdurmayı sorar. Veriler bu kullanıcıyla
      açılamıyorsa (başka kullanıcı, sıfırlanan Windows şifresi) Merkez kurtarma kodunu sorar. Ekrana tek kullanımlık
      geçici bir şifre yazar (başka hiçbir yere yazılmaz); Mola Yönetim'i açıp bu şifreyle girin, hemen kendi şifrenizi
      belirlemeniz istenir.
   Her sıfırlama İşlem geçmişine ve Bildirim merkezine yazılır; e-posta ayarları yapıldıysa "Şifreniz değiştirildi"
   e-postası gelir.

VERİLER VE İMZA ANAHTARI: %LOCALAPPDATA%\\Mola Yonetim\\veri
   merkez.sqlite (işletmeler, lisanslar, destek; satış verisi hiç gelmez), anahtar.json ve anahtar.yedek.json (bu verinin
   anahtarı, bu Windows kullanıcısına ve Merkez kurtarma koduna kilitli), merkez-kurtarma.json, merkez-public-key.txt
   (kafelerin lisans doğruladığı açık anahtar), merkez-first-login.txt (ilk şifre; değiştirince silinir).
   ANAHTAR KORUMASI: Merkez kurtarma kodunu (Ayarlar > Yedek) kaydedip "Kodu kaydettim" dedikten sonraki ilk açılışta
   verinin anahtarı (eskiden düz development.key dosyası) bu Windows kullanıcısına (DPAPI) ve kurtarma koduna kilitlenir.
   Kod kaydedilmeden kilitlenmez; Mola Yönetim önce kodu kaydetmenizi ister. Kenara alınan düz kopya
   (development.key.tasindi) bir sonraki açılışta silinir. Windows şifreniz sıfırlanır, başka kullanıcıyla ya da yeni
   bilgisayarda açılırsa Mola Yönetim "Veriler kilitli" ekranında kurtarma kodunu ister ve anahtarı yeni kullanıcıya kilitler.
   ÖNEMLİ: Lisansları imzalayan anahtar bu klasördedir. Kaybolursa bu anahtarla kurulan kafeler lisans uzatamaz; hepsine yeni
   anahtarla hazırlanmış paket kurmak gerekir. Gece yedeği (merkez-yedek) + kurtarma kodu yeni bilgisayarda yeter; ayrıca
   Ayarlar > Yedek'te ikinci yedek yeri (flash bellek, OneDrive) seçin. Windows hesabının şifresi olsun, BitLocker/Cihaz
   şifreleme açık olsun.

KAFE PAKETLERİ BU MERKEZE NASIL BAĞLANIR: Kafe paketlerini bu bilgisayarda hazırlarsanız (npm.cmd run installer), paket bu
   kurulumun açık anahtarını (veri\\merkez-public-key.txt) kendiliğinden alır; adres http://127.0.0.1:4000 olur. Paket
   hazırlanırken hangi anahtarın kullanıldığı ve kısa parmak izi ekrana yazılır. Önce Mola Yönetim'i bir kez açın (anahtar
   ilk açılışta oluşur).

AYNI AĞDAKİ BAŞKA BİLGİSAYARLARDAKİ KAFELER (MERKEZ_LAN)
   Güvenlik için Merkez varsayılan olarak yalnız bu bilgisayardan erişilir (127.0.0.1). Aynı ağda başka bir bilgisayarda kafe
   varsa:
   1. %LOCALAPPDATA%\\Mola Yonetim klasöründe "ayarlar.cmd" adlı bir dosya oluşturun, içine şu satırı yazın:
          set MERKEZ_LAN=1
      (ya da PowerShell'de bir kez: setx MERKEZ_LAN 1)
   2. "Mola Yönetim Kurulum.exe"yi yeniden çalıştırın: Windows bir kez yönetici onayı sorar ("Mola Yönetim" izni, yalnız özel ağ)
      ve Merkez ağa açık olarak yeniden başlar.
   3. Kafe paketini bu bilgisayarın ağ adresiyle hazırlayın, örneğin:
          $env:MOLA_MERKEZ_URL="http://192.168.1.20:4000"; npm.cmd run installer
      (adres: bu bilgisayarda "ipconfig" > IPv4 adresi; modemde bu bilgisayara sabit IP verin).
   DİKKAT: Ağ açıkken Mola Yönetim girişi ağda şifresiz HTTP ile gider. Yalnız kendi güvendiğiniz ağda açın, internete açmayın
   (internet için VDS + HTTPS). Kapatmak için ayarlar.cmd'yi silin (ya da setx MERKEZ_LAN 0) ve Merkez'i yeniden başlatın.
   Bağlantı noktası varsayılan 4000; değiştirmek için ayarlar.cmd'ye "set MERKEZ_PORT=4100" (kafe paketindeki adres de öyle olmalı).

GELİŞTİRME MERKEZİ İLE ÇAKIŞMA: Bu bilgisayarda "npm run merkez:dev" açıksa 4000 numaralı bağlantı noktası doludur. Mola Yönetim
   ona bağlanmaz, "başka bir Merkez kullanıyor" der; önce onu kapatın. İkisinin verisi ve anahtarı ayrıdır (geliştirme:
   .local\\merkez, kurulu: %LOCALAPPDATA%\\Mola Yonetim\\veri). Bir kafe, paketi hangi anahtarla hazırlandıysa o Merkez'e bağlıdır.

GÜNCELLEME: Yeni sürümün "Mola Yönetim Kurulum.exe"sini çalıştırın. Program değişir; veri klasörü ve ayarlar.cmd korunur.
KALDIRMA: Ayarlar > Uygulamalar > Mola Yönetim > Kaldır (ya da Başlat menüsünde "Mola Yönetim'i kaldır"). Program, simgeler ve
   Windows kaydı silinir; veri klasörü kalır. "Merkez verilerini ve imza anahtarını da sil" işaretlenirse kalıcı olarak silinir:
   önce mutlaka bir kopyasını alın.
`));
  report.push(`Mola-Yonetim: ${MB(folderSize(root))}`);
}
// Mola Merkez for a Linux server (docs/VDS_KURULUM.md): the same Merkez as Mola-Yonetim, as one tar.gz with a systemd service.
if (chosen.includes('merkez-linux')) {
  execFileSync(process.execPath, ['scripts/merkez-linux-paket.mjs', '--skip-ui-build', `--out=${join(out, 'Mola-Merkez-Linux')}`], { stdio: 'inherit' });
  report.push(`Mola-Merkez-Linux: ${MB(folderSize(join(out, 'Mola-Merkez-Linux')))} (sıkıştırılmış)`);
}

writeFileSync(join(out, 'HANGI-KLASOR.txt'), bom(`MOLA ${version} · Merkut Studios

Kafenin bilgisayarına göre klasörü seçin. Her klasörde kurulum anlatan BENIOKU.txt var.

  Windows 10 / 11 ................................ Windows             (içindeki Mola Kurulum.exe'ye çift tıklayın)
  Mac, Apple M1/M2/M3/M4 işlemci (2020 sonrası) ... macOS-Apple-Silicon
  Mac, Intel işlemci ............................. macOS-Intel
  Linux (Ubuntu, Pardus, Mint, Debian...) ......... Linux-x64

Mac'te hangisi? Elma menüsü > Bu Mac Hakkında. "Çip: Apple M..." yazıyorsa Apple Silicon, "İşlemci: ... Intel" yazıyorsa Intel.
Kafelerin çoğunda Windows bulunur.

  Mola-Yonetim: KAFEYE DEĞİL, yalnız satıcının (Merkut Studios) Windows bilgisayarına. Mola Yönetim paneli ve Mola Merkez
                (lisans, etkinleştirme, destek). İçindeki "Mola Yönetim Kurulum.exe".
${chosen.includes('merkez-linux') ? `  Mola-Merkez-Linux: KAFEYE DEĞİL. Mola Merkez'in internetteki Linux sunucusu (VDS) için; docs/VDS_KURULUM.md.
` : ''}`));
rmSync(stage, { recursive: true, force: true });
console.log(`${out}\n${report.join('\n')}`);
if (MERKEZ_KEY) {
  console.log(`\nKafe paketlerinin Mola Merkezi:\n  Adres: ${MERKEZ.url}  (${MERKEZ.source})\n  Açık anahtar: ${MERKEZ_KEY.source}\n  Parmak izi: ${MERKEZ_KEY.fingerprint}`);
  // A different key on this computer's installed Mola Yönetim is worth a warning: those cafés would not trust it.
  const installedKey = installedYonetim && readFileSync(join(installedYonetim, 'veri', 'merkez-public-key.txt'), 'utf8').trim();
  if (installedKey && installedKey !== MERKEZ_KEY.text) console.log(`  DİKKAT: bu bilgisayarda kurulu Mola Yönetim başka bir anahtar kullanıyor (parmak izi ${fingerprint(installedKey)}). Bu paketlerdeki kafeler ona bağlanamaz.`);
  if (/^http:\/\/(127\.|localhost)/.test(MERKEZ.url)) console.log('  Bu adres yalnız Merkez ile aynı bilgisayardaki kafe için çalışır. Başka bilgisayardaki kafe için: $env:MOLA_MERKEZ_URL="http://<Merkez bilgisayarının IP adresi>:4000" (ve Merkez\'de MERKEZ_LAN=1).');
}
