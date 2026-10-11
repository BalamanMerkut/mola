// Otomatik güncelleme: the update bundle `npm run installer` writes next to the full packages, one per café platform:
//   .local/installer/Mola-<sürüm>/Guncelleme/Mola-<sürüm>-<platform>.mola-guncelleme
// A .tar.gz whose first entry is mola-guncelleme.json (version, platform, Node.js version, whether runtime/ is inside,
// the oldest version that may update to it, the data format, short Turkish notes, every file's SHA-256), then app/…,
// runtime/… (only when Node.js changed, see below) and ust/… (Mola.exe and the other files beside app/).
// The vendor uploads it in Mola Yönetim → Ayarlar → Güncellemeler; Mola Merkez checks every file and signs it (the bundle
// itself is not signed: it never reaches a café unsigned). Format: server/update-manifest.ts.
//
// Options (npm run installer -- …):
//   --guncelleme-notu="Kısa not"        shown to the café owner (also editable in Mola Yönetim before publishing)
//   --guncelleme-en-az=0.1.0            oldest version that may update to this one (older cafés need the full installer)
//   --guncelleme-runtime=evet|hayir     runtime/ inside or not; default: only when this Node.js differs from the one in the
//                                       last bundle built here for that platform (.local/installer/guncelleme-node.json)
//   --guncellemesiz                     no update bundles
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { finished } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const RECORD = '.local/installer/guncelleme-node.json';
const option = name => process.argv.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
export const updateBundlesWanted = () => !process.argv.includes('--guncellemesiz');
/** Should runtime/ go into this platform's bundle? */
export function includeRuntime(platform, node) {
  const forced = option('--guncelleme-runtime');
  if (forced === 'evet') return true;
  if (forced === 'hayir') return false;
  let record = {}; try { record = JSON.parse(readFileSync(RECORD, 'utf8')); } catch { /* first bundle: runtime inside */ }
  return record[platform] !== node;
}
function remember(platform, node) {
  let record = {}; try { record = JSON.parse(readFileSync(RECORD, 'utf8')); } catch { /* new */ }
  record[platform] = node; mkdirSync(dirname(RECORD), { recursive: true }); writeFileSync(RECORD, JSON.stringify(record, null, 2));
}
/** Every file of a folder as bundle items under `prefix` (app, runtime). */
export function folderItems(dir, prefix, executable = () => false) {
  const items = [];
  (function walk(d) { for (const name of readdirSync(d).sort()) { const p = join(d, name); if (lstatSync(p).isDirectory()) walk(p); else { const path = `${prefix}/${relative(dir, p).replaceAll('\\', '/')}`; items.push({ path, file: p, mode: executable(path) ? 0o755 : 0o644 }); } } })(dir);
  return items;
}
async function writeTarGz(file, entries) {
  const gzip = createGzip({ level: 6 }), output = createWriteStream(file);
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
/**
 * items: [{ path: 'app/…' | 'runtime/…' | 'ust/…', file?: string, data?: Buffer, mode? }]; top: [{ file: 'ust/…', target }].
 * minFrom / notes default to the command line options; data (the data format) to packages/domain/data-format.json; record: false
 * leaves .local/installer/guncelleme-node.json alone (tests).
 * Returns the bundle's path and size.
 */
export async function writeUpdateBundle({ out, platform, version, node, items, top, runtime, minFrom = option('--guncelleme-en-az') ?? '0.0.0', notes = option('--guncelleme-notu') ?? '', data, record = true }) {
  const dataFormat = data ?? JSON.parse(readFileSync('packages/domain/data-format.json', 'utf8'));
  const files = [], entries = [];
  for (const item of items) {
    if (!runtime && item.path.startsWith('runtime/')) continue;
    const data = item.data ?? readFileSync(item.file);
    files.push({ path: item.path, sha256: createHash('sha256').update(data).digest('hex'), size: data.length, ...(item.mode && item.mode !== 0o644 ? { mode: item.mode } : {}) });
    entries.push({ path: item.path, data, mode: item.mode });
  }
  const manifest = { format: 'mola-guncelleme-paket-1', version, platform, node, runtime, minFrom, data: { minReadable: dataFormat.minReadable, maxReadable: dataFormat.maxReadable, writeVersion: dataFormat.writeVersion },
    notes: notes.trim().slice(0, 600), builtAt: new Date().toISOString(), files, top };
  const folder = join(out, 'Guncelleme'); mkdirSync(folder, { recursive: true });
  const file = join(folder, `Mola-${version}-${platform}.mola-guncelleme`);
  await writeTarGz(file, [{ path: 'mola-guncelleme.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) }, ...entries]);
  if (record) remember(platform, node);
  if (!existsSync(join(folder, 'BENIOKU.txt'))) writeFileSync(join(folder, 'BENIOKU.txt'), '﻿' + `MOLA ${version} · OTOMATİK GÜNCELLEME PAKETLERİ\r\nMerkut Studios\r\n\r\nBu klasör kafeye götürülmez. Buradaki .mola-guncelleme dosyasını Mola Yönetim → Ayarlar → Güncellemeler sayfasına\r\nsürükleyin (doğrulayıcı uygulamadaki kod sorulur); Mola Merkez paketi denetleyip imzalar. Hemen orada\r\n"Önce pilot işletmelere" ya da "Herkese yayınla". Kafeler çalışırken indirir; kapanışta, ertesi açılışta ya da boşta kurar.\r\n`);
  return { file, size: statSync(file).size, runtime };
}
