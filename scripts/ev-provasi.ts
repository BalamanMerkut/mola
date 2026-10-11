/*
 * npm.cmd run ev-provasi: the "Ev ağı provası" (docs/EV_AGI_PROVASI.md). Before the VDS, this computer and the home modem play
 * the VDS: friends on the same Wi-Fi open the web site from their own laptops and phones, download Mola, install it, apply
 * ("Kodum yok, başvuru yapacağım") and the owner approves in his Mola Yönetim.
 *   1. finds this computer's address on the home network (or --ip=192.168.1.20);
 *   2. builds café installers whose Mola Merkez is http://<ip>:<merkez port> into .local/ev-provasi/kurulum (never the real
 *      .local/installer/Mola-<sürüm>), with the public key of the Mola Yönetim installed here (read only, like npm run installer);
 *   3. builds the web site into .local/ev-provasi/site with those files on /indir/ and downloads turned on;
 *   4. serves it on the home network at http://<ip>:<site port>, passing /api/site/*, /s/*, /q/* to the Merkez on this computer
 *      (127.0.0.1:<merkez port>) the way Caddy will on the VDS;
 *   5. prints the address, a QR code and what the owner must do (MERKEZ_LAN=1 in Mola Yönetim's ayarlar.cmd, Windows' firewall
 *      question). It changes no system setting: no firewall rule, no Mola Yönetim setting.
 * Ctrl+C stops the site. Options: --ip=, --merkez-port=4000, --site-port=8080, --cikti=.local/ev-provasi,
 * --platforms=windows,macos-arm64,macos-x64,linux-x64, --hazir (reuse the installers already built there), --dinleme-yok
 * (build only), --merkez-anahtar=<file> (another Merkez's public key, for tests).
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { publishDownloads } from './site-indir.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name: string) => process.argv.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
const flag = (name: string) => process.argv.includes(name);

/** Private IPv4 addresses of this computer, the home Wi-Fi / cable first (virtual adapters last). */
export function lanAddresses() {
  const out: { name: string; address: string; score: number }[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) for (const a of list ?? []) {
    if (a.family !== 'IPv4' || a.internal || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
    const virtual = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|vpn/i.test(name);
    out.push({ name, address: a.address, score: (virtual ? 0 : 10) + (a.address.startsWith('192.168.') ? 2 : 0) + (/wi-?fi|wlan|ethernet|eth/i.test(name) ? 1 : 0) });
  }
  return out.sort((x, y) => y.score - x.score);
}

async function main() {
  const found = lanAddresses(), ip = option('--ip') ?? found[0]?.address;
  if (!ip) throw new Error('Bu bilgisayarın ev ağındaki adresi bulunamadı (Wi-Fi ya da kabloya bağlı mı?). Adresi kendiniz verin: npm.cmd run ev-provasi -- --ip=192.168.1.20');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error(`Geçersiz IP adresi: ${ip}`);
  const merkezPort = Number(option('--merkez-port') ?? 4000), sitePort = Number(option('--site-port') ?? 8080);
  const out = resolve(option('--cikti') ?? join(ROOT, '.local', 'ev-provasi'));
  // Never the real installer folder or the real site output.
  if ([join(ROOT, '.local', 'installer'), join(ROOT, 'site', 'dist')].some(p => out === p || out.startsWith(p + '\\') || out.startsWith(p + '/'))) throw new Error('--cikti gerçek kurulum ya da site klasörü olamaz.');
  const kurulum = join(out, 'kurulum'), site = join(out, 'site'), config = join(out, 'site-config.json');
  const merkezUrl = `http://${ip}:${merkezPort}`, siteUrl = `http://${ip}:${sitePort}`;
  console.log(`\nEv ağı provası · bu bilgisayar: ${ip}${found.length > 1 && !option('--ip') ? ` (diğer adresler: ${found.slice(1).map(f => `${f.address} ${f.name}`).join(', ')})` : ''}`);
  console.log(`  Kafe programı bu Merkez'e bağlanacak: ${merkezUrl}`);
  mkdirSync(out, { recursive: true });

  if (!flag('--hazir') || !existsSync(join(kurulum, 'Windows'))) {
    console.log(`\n1/3 Kurulum dosyaları hazırlanıyor (${relative(ROOT, kurulum)}). İlk sefer birkaç dakika sürer…`);
    const env = { ...process.env, MOLA_MERKEZ_URL: merkezUrl, ...(option('--merkez-anahtar') ? { MOLA_MERKEZ_PUBLIC_KEY: resolve(option('--merkez-anahtar')!) } : {}) };
    const built = spawnSync(process.execPath, ['scripts/build-installer.mjs', `--cikti=${kurulum}`, `--platforms=${option('--platforms') ?? 'windows,macos-arm64,macos-x64,linux-x64'}`, '--guncellemesiz', ...(flag('--skip-ui-build') ? ['--skip-ui-build'] : [])], { cwd: ROOT, env, stdio: 'inherit' });
    if (built.status !== 0) throw new Error('Kurulum dosyaları hazırlanamadı (yukarıdaki hataya bakın).');
  } else console.log(`\n1/3 Hazır kurulum dosyaları kullanılıyor (${relative(ROOT, kurulum)}).`);

  console.log('\n2/3 Web sitesi hazırlanıyor (indirme açık)…');
  copyFileSync(join(ROOT, 'site', 'config.json'), config);
  const published = await publishDownloads({ source: kurulum, dist: site, config, enable: true, quiet: true });
  if (published.merkez && published.merkez !== merkezUrl) console.warn(`  DİKKAT: kurulum dosyaları başka bir Merkez'e bağlanıyor (${published.merkez}). --hazir olmadan yeniden çalıştırın.`);
  for (const [p, f] of Object.entries(published.files)) console.log(`  ${p.padEnd(12)} ${f!.file} · ${(f!.size / 1048576).toFixed(0)} MB`);
  if (published.missing.length) console.warn(`  Hazırlanmayan: ${published.missing.join(', ')} (o kart "Yakında" görünür)`);

  // Is the Merkez on this computer open to the home network (MERKEZ_LAN=1)? Asked on the LAN address, like a friend's café would.
  let merkezOpen = false;
  try { merkezOpen = (await fetch(`${merkezUrl}/api/merkez/v1/health`, { signal: AbortSignal.timeout(3000) })).ok; } catch { merkezOpen = false; }
  const qr = await QRCode.toString(`${siteUrl}/indir/`, { type: 'terminal', small: true });
  console.log(`
3/3 Hazır. Arkadaşlarınız (aynı Wi-Fi'de) şu adresi açsın:

    ${siteUrl}/indir/
${qr}
  - Bilgisayarına uygun dosyayı indirip kursun (Windows "Bilgisayarınız korundu" derse: "Ek bilgi" → "Yine de çalıştır").
  - Mola açılınca "Kodum yok, başvuru yapacağım"ı seçip formu göndersin.
  - Siz Mola Yönetim → Başvurular'dan onaylayın (zilde de görünür); arkadaşınızın ekranı kendiliğinden ilerler, 30 günlük deneme başlar.

  Mola Merkez ev ağından: ${merkezOpen ? 'AÇIK (MERKEZ_LAN=1).' : `KAPALI. ${merkezUrl} adresine ulaşılamadı.`}${merkezOpen ? '' : `
    Arkadaşlarınızın Mola'sı başvuru gönderemez. Mola Yönetim'i ev ağına açın (docs/EV_AGI_PROVASI.md, adım 2):
      1. %LOCALAPPDATA%\\Mola Yonetim\\ayarlar.cmd dosyasına şu satırı ekleyin:  set MERKEZ_LAN=1
      2. Mola Yönetim'i kapatıp yeniden açın (ya da "Mola Yönetim Kurulum.exe"yi yeniden çalıştırın).
      3. Windows güvenlik duvarı sorarsa yalnız "Özel ağlar"ı işaretleyip "İzin ver"e basın.
    Mola Yönetim ekranları yine yalnız bu bilgisayardan açılır; ağa yalnız kafelerin konuştuğu kısım açılır.`}
  Bu sitenin kendisi için de Windows güvenlik duvarı (Node.js) izin isteyebilir: yalnız "Özel ağlar" → "İzin ver".

  Bitince: Ctrl+C ile siteyi durdurun, ayarlar.cmd'deki "set MERKEZ_LAN=1" satırını silip Mola Yönetim'i yeniden başlatın.
`);
  if (flag('--dinleme-yok')) return;
  const server = spawn(process.execPath, ['--import', 'tsx', 'scripts/site-dev.ts', '--host', '0.0.0.0', '--port', String(sitePort), '--merkez', `http://127.0.0.1:${merkezPort}`, '--dist', site, '--config', config, '--no-watch', '--no-build'], { cwd: ROOT, stdio: 'inherit' });
  for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { if (server.exitCode === null) server.kill(); process.exit(0); });
  server.on('exit', code => process.exit(code ?? 0));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(`\n${e instanceof Error ? e.message : e}`); process.exit(1); });
