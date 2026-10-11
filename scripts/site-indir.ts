/*
 * npm.cmd run site:indir: puts the café installers on the web site ("Uygulamayı indir", /indir/).
 *   1. takes the installer folder (default .local/installer/Mola-<sürüm>, made by `npm.cmd run installer`);
 *   2. packs Windows/ into Mola-Windows-<sürüm>.zip and copies the macOS / Linux archives into site/dist/indir;
 *   3. writes each file's name, size and SHA-256 into site/config.json → downloads (and SHA256SUMS.txt beside the files);
 *   4. builds the site again (npm.cmd run site:build keeps site/dist/indir).
 * The page still says "Yakında" until downloads.enabled is true (site/config.json): the owner turns it on once the installers
 * built for the VDS Merkez exist. Today's installers point to the Merkez they were built for (printed below).
 * Options: --kaynak=<installer folder>, --dist=<site output>, --config=<config file>, --ac (also set enabled: true; used by
 * the home rehearsal, scripts/ev-provasi.ts), --derleme-yok (do not build the site).
 */
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, DIST, PLATFORMS, SITE, type DownloadFile, type Downloads, type Platform } from './site-build.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name: string) => process.argv.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);

/** Where each platform's file is in the installer folder, and its name on the site. */
const SOURCES: Record<Platform, { folder: string; file: (v: string) => string }> = {
  windows: { folder: 'Windows', file: v => `Mola-Windows-${v}.zip` },
  'macos-arm64': { folder: 'macOS-Apple-Silicon', file: v => `Mola-macOS-AppleSilicon-${v}.tar.gz` },
  'macos-x64': { folder: 'macOS-Intel', file: v => `Mola-macOS-Intel-${v}.tar.gz` },
  'linux-x64': { folder: 'Linux-x64', file: v => `Mola-Linux-x64-${v}.tar.gz` },
};

function sha256(file: string) {
  return new Promise<string>((done, fail) => { const h = createHash('sha256'); createReadStream(file).on('data', d => h.update(d)).on('end', () => done(h.digest('hex'))).on('error', fail); });
}
/** The Merkez address the café program in this installer folder talks to (Mola-Sunucu.cmd), for the summary. */
export function installerMerkez(source: string) {
  const cmd = join(source, 'Windows', 'program', 'Mola-Sunucu.cmd');
  return existsSync(cmd) ? /set MOLA_MERKEZ_URL=(\S+)/.exec(readFileSync(cmd, 'utf8'))?.[1] ?? null : null;
}

export async function publishDownloads(o: { source: string; dist?: string; config?: string; enable?: boolean; build?: boolean; quiet?: boolean }) {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string;
  const dist = o.dist ? resolve(o.dist) : DIST, configFile = o.config ? resolve(o.config) : join(SITE, 'config.json');
  const source = resolve(o.source), out = join(dist, 'indir');
  if (!existsSync(source)) throw new Error(`Kurulum klasörü yok: ${source}. Önce npm.cmd run installer çalıştırın.`);
  mkdirSync(out, { recursive: true });
  // Earlier files of any version go: only the current ones are offered.
  for (const f of readdirSync(out)) if (/^Mola-.*\.(zip|tar\.gz)$/.test(f) || f === 'SHA256SUMS.txt') rmSync(join(out, f), { force: true });
  const files: Partial<Record<Platform, DownloadFile>> = {}, missing: string[] = [];
  for (const p of PLATFORMS) {
    const s = SOURCES[p], folder = join(source, s.folder), name = s.file(version), target = join(out, name);
    if (!existsSync(folder)) { missing.push(s.folder); continue; }
    if (p === 'windows') {
      if (!existsSync(join(folder, 'Mola Kurulum.exe'))) { missing.push(`${s.folder} (Mola Kurulum.exe yok)`); continue; }
      // Windows' own tar writes the ZIP (-a: by the extension); entries at the top, so "Tümünü ayıkla" makes one folder.
      execFileSync('tar.exe', ['-a', '-c', '-f', target, '-C', folder, ...readdirSync(folder)], { stdio: 'ignore' });
    } else {
      const archive = readdirSync(folder).find(f => f.endsWith('.tar.gz'));
      if (!archive) { missing.push(`${s.folder} (.tar.gz yok)`); continue; }
      copyFileSync(join(folder, archive), target);
    }
    files[p] = { file: name, size: statSync(target).size, sha256: await sha256(target) };
  }
  writeFileSync(join(out, 'SHA256SUMS.txt'), Object.values(files).map(f => `${f!.sha256}  ${f!.file}\n`).join(''));
  const config = JSON.parse(readFileSync(configFile, 'utf8')) as { downloads?: Downloads };
  config.downloads = { enabled: o.enable ? true : !!config.downloads?.enabled, version, builtAt: new Date().toISOString(), files };
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  if (o.build !== false) await buildSite({ dist, config: configFile, quiet: o.quiet });
  return { version, files, missing, merkez: installerMerkez(source), out, enabled: config.downloads.enabled };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string;
  publishDownloads({ source: option('--kaynak') ?? join(ROOT, '.local', 'installer', `Mola-${version}`), dist: option('--dist'), config: option('--config'), enable: process.argv.includes('--ac'), build: !process.argv.includes('--derleme-yok') })
    .then(r => {
      console.log(`\nİndirme dosyaları hazır: ${relative(ROOT, r.out)} (sürüm ${r.version})`);
      for (const [p, f] of Object.entries(r.files)) console.log(`  ${p.padEnd(12)} ${f!.file} · ${(f!.size / 1048576).toFixed(1)} MB · SHA-256 ${f!.sha256.slice(0, 16)}…`);
      if (r.missing.length) console.warn(`  Eksik: ${r.missing.join(', ')}`);
      if (r.merkez) console.log(`\nBu kurulum dosyalarındaki Mola, şu Mola Merkez'e bağlanır: ${r.merkez}`);
      if (r.merkez && /^http:\/\/(127\.|localhost)/.test(r.merkez)) console.warn('  DİKKAT: bu adres yalnız bu bilgisayarda çalışır. Siteye koymadan önce VDS Merkez\'i için kurulum hazırlayın (docs/VDS_KURULUM.md bölüm 13).');
      console.log(r.enabled ? '\nSitede indirme AÇIK (downloads.enabled: true).' : '\nSitede her platform hâlâ "Yakında" görünür. Açmak için site/config.json → downloads.enabled: true, sonra npm.cmd run site:build.');
    })
    .catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
