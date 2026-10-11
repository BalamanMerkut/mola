// Program dosyaları denetimi (server/integrity.ts): app/butunluk.json, the list of the café package's CODE files with their
// SHA-256 as shipped (bytes exactly as written into the package), written by `npm run installer` into every café app/ folder.
//   app/server.mjs, nobetci.mjs, guncelleyici.mjs, package.json   the server, the watchdog, the update applier
//   app/dist/**/*.html|js|mjs|css                                 the screens
//   the launchers beside app/ (CODE_TOP)                          Mola.exe & the .cmd files; the Mac and Linux start scripts
// Not the Node.js runtime, the image library (node_modules), the Android app, icons, data, logs or settings. Paths are relative to
// the folder that holds app/ (the Windows install folder, Mola.app/Contents/Resources, ~/.local/share/mola).
// The list is signed through the update bundle of the same build: it is one of its app/ files, and Mola Merkez signs every
// file's SHA-256 on upload (mola-guncelleme-1). `build` tells two builds of one version apart.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const INTEGRITY_FILE = 'butunluk.json';
/** Launchers beside app/ that are program code, by update platform (names as in server/update-manifest.ts TOP_TARGETS). */
export const CODE_TOP = { windows: ['Mola.exe', 'Mola-Sunucu.cmd', 'Mola-Durdur.cmd', 'Mola-Kaldir.exe'], 'macos-arm64': ['../MacOS/Mola'], 'macos-x64': ['../MacOS/Mola'], 'linux-x64': ['mola', 'kaldir.sh'] };
const CODE_APP = ['server.mjs', 'nobetci.mjs', 'guncelleyici.mjs', 'package.json'];
const SCREEN = /\.(html|js|mjs|css)$/i;
const sha = data => createHash('sha256').update(data).digest('hex');

/** Writes <appDir>/butunluk.json. `top`: { target: Buffer } for every CODE_TOP launcher of the platform. Returns the file list. */
export function writeIntegrityManifest(appDir, { version, platform, build, top }) {
  if (!CODE_TOP[platform]) throw new Error(`Bilinmeyen platform: ${platform}`);
  const files = [], add = (path, data) => files.push({ path, sha256: sha(data), size: data.length });
  for (const name of CODE_APP) add(`app/${name}`, readFileSync(join(appDir, name)));
  const dist = join(appDir, 'dist'), screens = [];
  (function walk(dir) { for (const name of readdirSync(dir).sort()) { const p = join(dir, name); if (lstatSync(p).isDirectory()) walk(p); else if (SCREEN.test(name)) screens.push(p); } })(dist);
  if (!screens.some(p => p.endsWith('index.html'))) throw new Error('dist/index.html yok: önce npm run build.');
  for (const p of screens) add(`app/dist/${relative(dist, p).replaceAll('\\', '/')}`, readFileSync(p));
  for (const target of CODE_TOP[platform]) {
    const data = top?.[target];
    if (!Buffer.isBuffer(data)) throw new Error(`Bütünlük listesi: ${platform} için ${target} verilmedi.`);
    add(target, data);
  }
  writeFileSync(join(appDir, INTEGRITY_FILE), JSON.stringify({ format: 'mola-butunluk-1', version, platform, build, builtAt: new Date().toISOString(), files }, null, 2));
  return files;
}
