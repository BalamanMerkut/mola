// Mola Merkez for a Linux server (VDS): one tar.gz with its own Node.js runtime, the bundled merkez.mjs, the Mola Yönetim
// screens, the image library for Linux, a systemd service, a Caddyfile example (automatic HTTPS) and a settings example.
// Step-by-step use: docs/VDS_KURULUM.md. Nothing of this computer's Merkez (data, keys, backups) is ever put in.
//
//   npm run merkez:linux-paket                      → .local/installer/Mola-Merkez-Linux-<version>/
//   npm run merkez:linux-paket -- --skip-ui-build   reuse the existing dist/
//   npm run merkez:linux-paket -- --out=<folder>    (npm run installer -- --platforms=merkez-linux uses this)
//
// Built on Windows like the other packages. The Linux Node.js and image library files are downloaded once from nodejs.org and
// registry.npmjs.org, checked against the published hashes, and kept in .local/build-cache/downloads (shared with the installer).
// The archive keeps Unix permissions (a ZIP or a FAT USB stick would lose them): runtime/node, kur.sh and sifre-sifirla.sh stay
// executable. The structure is checked at the end (`--check-only=<archive>` checks an existing one).
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGzip, gunzipSync } from 'node:zlib';
import { dirname, join, relative, resolve } from 'node:path';
import { finished } from 'node:stream/promises';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const nodeVersion = process.version;
const option = name => process.argv.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
const cache = resolve('.local/build-cache'), stage = join(cache, 'stage-merkez-linux');
const BASE = 'mola-merkez';
const sha = (data, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(data).digest(encoding);
const unix = text => text.replace(/\r\n/g, '\n').trimStart();

// ---------- Downloads (cached, hash-checked) ----------
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`İndirilemedi (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
/** A small text that names the hashes (Node's SHASUMS, npm's package data): fresh when online, else the copy from last time. */
async function listing(name, url) {
  const file = join(cache, 'downloads', name);
  try { const data = await download(url); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); return data.toString('utf8'); }
  catch (error) { if (existsSync(file)) return readFileSync(file, 'utf8'); throw error; }
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
async function nodeRuntime(platform) {
  const sums = await listing(`node-${nodeVersion}-SHASUMS256.txt`, `https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`);
  const name = `node-${nodeVersion}-${platform}.tar.gz`;
  const expected = new RegExp(`^([a-f0-9]{64})\\s+${name.replaceAll('.', '\\.')}$`, 'm').exec(sums)?.[1];
  if (!expected) throw new Error(`Node.js özet listesinde yok: ${name}`);
  const files = untar(gunzipSync(await cached(name, `https://nodejs.org/dist/${nodeVersion}/${name}`, data => sha(data) === expected)));
  const pick = path => files.find(f => f.name === `node-${nodeVersion}-${platform}/${path}`)?.data ?? (() => { throw new Error(`${name} içinde ${path} yok`); })();
  return { node: pick('bin/node'), license: pick('LICENSE') };
}
const sharpPackage = JSON.parse(readFileSync('node_modules/sharp/package.json', 'utf8'));
async function npmPackage(name) {
  const wanted = sharpPackage.optionalDependencies[name];
  const meta = JSON.parse(await listing(`${name.replace('/', '__')}-${wanted}.meta.json`, `https://registry.npmjs.org/${name.replace('/', '%2f')}/${wanted}`));
  const [algorithm, digest] = meta.dist.integrity.split('-');
  const data = await cached(`${name.replace('/', '__')}-${wanted}.tgz`, meta.dist.tarball, d => sha(d, algorithm, 'base64') === digest);
  return untar(gunzipSync(data)).filter(f => f.type === '0' && f.name.startsWith('package/')).map(f => ({ name: f.name.slice(8), data: f.data }));
}

// ---------- tar (ustar with Unix permissions) ----------
function untar(buffer) {
  const files = []; let offset = 0, longName, paxName;
  while (offset + 512 <= buffer.length) {
    const h = buffer.subarray(offset, offset + 512);
    if (h.every(b => b === 0)) break;
    const field = (start, end) => h.subarray(start, end).toString('utf8').replace(/\0[\s\S]*$/, '');
    let name = field(0, 100); const prefix = field(345, 500); if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(field(124, 136).trim() || '0', 8), type = String.fromCharCode(h[156] || 48), mode = parseInt(field(100, 108).trim() || '0', 8);
    const data = buffer.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0[\s\S]*$/, ''); continue; }
    if (type === 'x') { paxName = /\d+ path=([^\n]*)\n/.exec(data.toString('utf8'))?.[1]; continue; }
    if (type === 'g') continue;
    if (longName) { name = longName; longName = undefined; } if (paxName) { name = paxName; paxName = undefined; }
    files.push({ name, type: type === '\0' ? '0' : type, data, mode });
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
function treeEntries(dir, prefix) {
  const list = [];
  (function walk(d) { for (const name of readdirSync(d).sort()) { const p = join(d, name); if (lstatSync(p).isDirectory()) walk(p); else list.push({ path: `${prefix}/${relative(dir, p).replaceAll('\\', '/')}`, data: readFileSync(p), mode: 0o644 }); } })(dir);
  return list;
}

// ---------- The files around the program ----------
const SERVICE = `# Mola Merkez as a systemd service (docs/VDS_KURULUM.md). kur.sh copies this to /etc/systemd/system/mola-merkez.service.
[Unit]
Description=Mola Merkez (lisans, destek, Mola Yönetim)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mola
Group=mola
WorkingDirectory=/opt/mola-merkez/app
# Mola çalışma klasörü (README, durum özeti, işlem/hata kayıtları, destek talepleri; server/merkez/workfolder.ts): the vendor's
# PC copies it every day with "npm run vds:cek" (docs/VDS_KURULUM.md). Inside ReadWritePaths, only mola reads it (UMask).
# ayarlar.env may set another folder or 0 (off); its values win over this line.
Environment=MERKEZ_CALISMA_KLASORU=/var/lib/mola-merkez/calisma
# Settings (PUBLIC_ORIGIN, data folder, key passphrase file...): /etc/mola-merkez/ayarlar.env
EnvironmentFile=/etc/mola-merkez/ayarlar.env
Environment=SERVE_BUILD=1
Environment=MOLA_MODE=installed
# Only Caddy on this same server talks to Merkez; the internet reaches it through HTTPS (Caddyfile).
Environment=MERKEZ_HOST=127.0.0.1
ExecStart=/opt/mola-merkez/runtime/node --disable-warning=ExperimentalWarning merkez.mjs
Restart=always
RestartSec=5
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/mola-merkez
# Sandboxing (docs/GUVENLIK_DENETIMI.md): no capabilities, no devices, no kernel settings; only network and local sockets.
# Not set: MemoryDenyWriteExecute (Node's JIT needs it) and RestrictNamespaces (a headless browser for PDFs needs its sandbox).
CapabilityBoundingSet=
AmbientCapabilities=
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
ProtectProc=invisible
RestrictSUIDSGID=true
RestrictRealtime=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
const SETTINGS = `# Mola Merkez settings (/etc/mola-merkez/ayarlar.env). Lines starting with # are notes. After a change:
#   sudo systemctl restart mola-merkez
# The domain below is an EXAMPLE: write your own (the same as in /etc/caddy/Caddyfile).
PUBLIC_ORIGIN=https://merkez.ornek-alanadi.com
TRUST_LOCAL_PROXY=1
MERKEZ_PORT=4000
MERKEZ_DATA_DIR=/var/lib/mola-merkez/veri
MERKEZ_BACKUP_DIR=/var/lib/mola-merkez/merkez-yedek
# Mola çalışma klasörü on this server; the vendor's PC copies it (and the backups above) every day with "npm run vds:cek".
# Only the mola user reads it; "npm run vds:cek" reads it through /usr/local/sbin/mola-oku (docs/VDS_KURULUM.md bölüm 15).
MERKEZ_CALISMA_KLASORU=/var/lib/mola-merkez/calisma
# The data key is locked with this passphrase file (at least 12 characters; kur.sh makes a random one). Keep a copy of it
# AND of the 24-letter Merkez recovery code somewhere else: without both, a lost server's backups stay closed.
MERKEZ_KEY_PROTECTION=1
MERKEZ_KEY_PASSPHRASE_FILE=/etc/mola-merkez/anahtar-parolasi
# Only on the OLD Merkez (the one the cafés use now), to move them here: its own address announcement (signed). Not here.
# MERKEZ_YENI_ADRES=https://merkez.ornek-alanadi.com
# The web site's address: the social QR codes' short links (/s/…). Set it BEFORE the cafés print social QR cards
# (docs/VDS_KURULUM.md bölüm 13); without it PUBLIC_ORIGIN is used.
# MERKEZ_SITE_ORIGIN=https://ornek-alanadi.com
# REQUIRED (security, GUVENLIK_DENETIMI Y1): the guest QR menu's OWN address, the table QR codes (/q/…). Another name than
# PUBLIC_ORIGIN and the web site: the cafés' guest pages never open where Mola Yönetim's cookies or the web site live. Its DNS
# "A" record and the Caddyfile block "menu.ornek-alanadi.com" must exist first. Set it BEFORE the cafés print table QR codes.
MERKEZ_MENU_ORIGIN=https://menu.ornek-alanadi.com
`;
const CADDYFILE = `# Caddy: HTTPS for Mola Merkez with an automatic certificate (Let's Encrypt). /etc/caddy/Caddyfile
# Replace merkez.ornek-alanadi.com and menu.ornek-alanadi.com with your own names; their DNS "A" records must point at this
# server's IP address first.
# Slow clients (slowloris) may not hold connections open: headers within 15 s, idle keep-alive 2 minutes.
{
	servers {
		timeouts {
			read_header 15s
			idle 2m
		}
	}
}
merkez.ornek-alanadi.com {
	encode zstd gzip
	# Destek ekleri (photos, PDFs) are at most a few MB; anything bigger is refused here already.
	request_body {
		max_size 30MB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		-Server
	}
	# Güvenlik (GUVENLIK_DENETIMI Y1): the guest menu (/q/…) holds files the cafés send; it never runs on Mola Yönetim's own
	# address, only on its own name below (MERKEZ_MENU_ORIGIN). A QR printed with this address still works: 308 there.
	redir /q/* https://menu.ornek-alanadi.com{uri} 308
	# Merkez listens only on this server (127.0.0.1); Caddy passes X-Forwarded-Proto/For/Host (TRUST_LOCAL_PROXY=1). The cafés'
	# guest tunnels (WebSocket, /api/merkez/v1/tunnel; İnternetten menü) pass as they are; on a Caddy reload they are kept
	# for up to 5 minutes and the cafés reconnect by themselves anyway.
	reverse_proxy 127.0.0.1:4000 {
		stream_close_delay 5m
	}
}
# İnternetten menü, the guest QR menu on its own name (MERKEZ_MENU_ORIGIN=https://menu.ornek-alanadi.com): only /q/* goes to
# Merkez, with its own Host (Merkez answers /q/* only on this name), everything else is 404. The menu's CSP comes from Merkez.
menu.ornek-alanadi.com {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		X-Frame-Options "DENY"
		-Server
	}
	handle /q/* {
		request_body {
			max_size 64KB
		}
		reverse_proxy 127.0.0.1:4000
	}
	handle {
		respond 404
	}
}
`;
const INSTALL = `#!/bin/sh
# Mola Merkez on a Linux server: install or update (docs/VDS_KURULUM.md). Run as root from the unpacked folder:
#   sudo ./kur.sh
# Program: /opt/mola-merkez (replaced on update). Data: /var/lib/mola-merkez (never touched by this script).
# Settings: /etc/mola-merkez/ayarlar.env and the key passphrase /etc/mola-merkez/anahtar-parolasi (made once, kept).
set -eu
[ "$(id -u)" = 0 ] || { echo "Yönetici olarak çalıştırın: sudo ./kur.sh"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
id mola >/dev/null 2>&1 || useradd --system --home-dir /var/lib/mola-merkez --shell /usr/sbin/nologin mola
install -d -o mola -g mola -m 700 /var/lib/mola-merkez
install -d -o mola -g mola -m 700 /var/lib/mola-merkez/calisma
install -d -o root -g mola -m 750 /etc/mola-merkez
if [ ! -f /etc/mola-merkez/ayarlar.env ]; then install -o root -g mola -m 640 "$HERE/ayarlar.env.ornek" /etc/mola-merkez/ayarlar.env; YENI=1; fi
if [ ! -f /etc/mola-merkez/anahtar-parolasi ]; then
  ( umask 027; head -c 32 /dev/urandom | base64 | tr -d '\\n' > /etc/mola-merkez/anahtar-parolasi )
  chown root:mola /etc/mola-merkez/anahtar-parolasi; chmod 440 /etc/mola-merkez/anahtar-parolasi
  echo "Anahtar parolası oluşturuldu: /etc/mola-merkez/anahtar-parolasi  (bir kopyasını güvenli bir yere alın)"
fi
systemctl stop mola-merkez 2>/dev/null || true
rm -rf /opt/mola-merkez.yeni
mkdir -p /opt/mola-merkez.yeni
cp -R "$HERE/app" "$HERE/runtime" /opt/mola-merkez.yeni/
cp "$HERE/sifre-sifirla.sh" "$HERE/kurtarma-kodu.sh" "$HERE/BENIOKU.txt" "$HERE/mola-okuma.sudoers.ornek" /opt/mola-merkez.yeni/
chmod 755 /opt/mola-merkez.yeni/runtime/node /opt/mola-merkez.yeni/sifre-sifirla.sh /opt/mola-merkez.yeni/kurtarma-kodu.sh
# Read-only helper for "npm run vds" / "npm run vds:cek" (never writes). Its password-less sudo rule is the owner's own step:
# mola-okuma.sudoers.ornek → /etc/sudoers.d/mola-okuma (docs/VDS_KURULUM.md bölüm 15).
install -o root -g root -m 755 "$HERE/mola-oku" /usr/local/sbin/mola-oku
rm -rf /opt/mola-merkez.eski; [ -d /opt/mola-merkez ] && mv /opt/mola-merkez /opt/mola-merkez.eski
mv /opt/mola-merkez.yeni /opt/mola-merkez
chown -R root:root /opt/mola-merkez
install -m 644 "$HERE/mola-merkez.service" /etc/systemd/system/mola-merkez.service
systemctl daemon-reload
systemctl enable mola-merkez >/dev/null
if [ "\${YENI:-0}" = 1 ]; then
  echo "İlk kurulum: önce /etc/mola-merkez/ayarlar.env içindeki PUBLIC_ORIGIN'i kendi alan adınızla değiştirin, sonra:"
  echo "  sudo systemctl start mola-merkez"
else
  systemctl start mola-merkez
  echo "Mola Merkez güncellendi ve yeniden başladı. Durum: systemctl status mola-merkez"
fi
`;
const RESET = `#!/bin/sh
# Mola Yönetim: yönetici şifresini sıfırla (son çare). Sunucuda, Merkez durdurulmuşken:
#   sudo systemctl stop mola-merkez && sudo -u mola /opt/mola-merkez/sifre-sifirla.sh && sudo systemctl start mola-merkez
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/app" || exit 1
NODE="$DIR/runtime/node"; [ -x "$NODE" ] || NODE="$(command -v node)"
[ -n "$NODE" ] || { echo "Node.js bulunamadı."; exit 1; }
if [ -r /etc/mola-merkez/ayarlar.env ]; then set -a; . /etc/mola-merkez/ayarlar.env; set +a; fi
: "\${MERKEZ_DATA_DIR:=/var/lib/mola-merkez/veri}"; export MERKEZ_DATA_DIR
"$NODE" --disable-warning=ExperimentalWarning merkez-sifre-sifirla.mjs "$@"
code=$?
[ "$code" = 3 ] && echo "Önce Mola Merkez'i durdurun: sudo systemctl stop mola-merkez"
exit $code
`;
// A new Merkez recovery code (Mola Yönetim never shows it on a server): scripts/merkez-kurtarma-kodu.ts.
const RECOVERY = `#!/bin/sh
# Mola Merkez: yeni kurtarma kodu. Sunucuda, Merkez durdurulmuşken (kod ekrana yazılır, iki parçası geri sorulur):
#   sudo systemctl stop mola-merkez && sudo -u mola /opt/mola-merkez/kurtarma-kodu.sh; sudo systemctl start mola-merkez
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/app" || exit 1
NODE="$DIR/runtime/node"; [ -x "$NODE" ] || NODE="$(command -v node)"
[ -n "$NODE" ] || { echo "Node.js bulunamadı."; exit 1; }
if [ -r /etc/mola-merkez/ayarlar.env ]; then set -a; . /etc/mola-merkez/ayarlar.env; set +a; fi
: "\${MERKEZ_DATA_DIR:=/var/lib/mola-merkez/veri}"; export MERKEZ_DATA_DIR
"$NODE" --disable-warning=ExperimentalWarning merkez-kurtarma-kodu.mjs "$@"
code=$?
[ "$code" = 3 ] && echo "Önce Mola Merkez'i durdurun: sudo systemctl stop mola-merkez"
exit $code
`;
const README = `MOLA MERKEZ ${version} · LINUX SUNUCU (VDS) · x64
Merkut Studios

YALNIZ SATICININ SUNUCUSU İÇİN. Kafelere kurulmaz.
Adım adım anlatım: docs/VDS_KURULUM.md (Ubuntu LTS, SSH anahtarı, güvenlik duvarı, Caddy ile HTTPS, yedek, güncelleme).

İÇİNDEKİLER
  app/                 Mola Merkez (merkez.mjs), Mola Yönetim ekranları (dist/), resim kitaplığı (node_modules/sharp, Linux)
  runtime/node         Node.js ${nodeVersion} (Linux x64)
  kur.sh               kurar / günceller: sudo ./kur.sh  (program /opt/mola-merkez, veri /var/lib/mola-merkez)
  mola-merkez.service  systemd servisi (kur.sh kurar)
  ayarlar.env.ornek    ayarlar (/etc/mola-merkez/ayarlar.env olur; PUBLIC_ORIGIN ve MERKEZ_MENU_ORIGIN'i kendi adlarınızla değiştirin)
  Caddyfile.ornek      Caddy ile otomatik HTTPS (/etc/caddy/Caddyfile)
  sifre-sifirla.sh     Mola Yönetim yönetici şifresi için son çare
  kurtarma-kodu.sh     yeni Merkez kurtarma kodu (Mola Yönetim sunucuda kodu göstermez); Merkez durdurulmuşken
  mola-oku             yalnız okuyan yardımcı (kur.sh /usr/local/sbin/mola-oku yapar): npm run vds ve npm run vds:cek kullanır
  mola-okuma.sudoers.ornek  o yardımcının parolasız izni (/etc/sudoers.d/mola-okuma; elle kurulur, docs/VDS_KURULUM.md 15)

KISACA
  tar xzf Mola-Merkez-Linux-x64-${version}.tar.gz && cd ${BASE} && sudo ./kur.sh
  sudo nano /etc/mola-merkez/ayarlar.env     (PUBLIC_ORIGIN=https://merkez.<alan adınız>, MERKEZ_MENU_ORIGIN=https://menu.<alan adınız>)
  sudo systemctl start mola-merkez && systemctl status mola-merkez
  Sağlık: curl -fsS https://<alan adınız>/api/merkez/v1/health

Veriler, anahtar ve yedekler bu pakette YOKTUR. Mevcut Merkez'i taşımak için yedeğini ve kurtarma kodunu kullanın (docs/VDS_KURULUM.md).
`;

// ---------- Build ----------
/** Checks an archive: every required file, executables executable, nothing that is data or a key. Throws with the list. */
function checkArchive(file) {
  const files = untar(gunzipSync(readFileSync(file)));
  const byName = new Map(files.filter(f => f.type === '0').map(f => [f.name, f]));
  const problems = [];
  const need = ['app/merkez.mjs', 'app/merkez-sifre-sifirla.mjs', 'app/merkez-kurtarma-kodu.mjs', 'app/package.json', 'app/manifest.json', 'app/dist/merkez.html', 'app/node_modules/sharp/package.json', 'app/node_modules/@img/sharp-linux-x64/package.json', 'runtime/node', 'runtime/LICENSE', 'kur.sh', 'sifre-sifirla.sh', 'kurtarma-kodu.sh', 'mola-merkez.service', 'ayarlar.env.ornek', 'Caddyfile.ornek', 'BENIOKU.txt', 'mola-oku', 'mola-okuma.sudoers.ornek'];
  for (const name of need) if (!byName.has(`${BASE}/${name}`)) problems.push(`eksik: ${name}`);
  for (const name of ['runtime/node', 'kur.sh', 'sifre-sifirla.sh', 'kurtarma-kodu.sh', 'mola-oku']) { const f = byName.get(`${BASE}/${name}`); if (f && !(f.mode & 0o100)) problems.push(`çalıştırılabilir değil: ${name}`); }
  const node = byName.get(`${BASE}/runtime/node`);
  if (node && node.data.subarray(0, 4).toString('latin1') !== '\x7fELF') problems.push('runtime/node bir Linux programı değil');
  for (const name of byName.keys()) if (/(^|\/)(veri|merkez-yedek)\/|development\.key|anahtar(\.yedek)?\.json|merkez\.sqlite|\.exe$|node\.exe$/.test(name)) problems.push(`pakete girmemeli: ${name}`);
  for (const name of ['kur.sh', 'sifre-sifirla.sh', 'kurtarma-kodu.sh', 'mola-merkez.service', 'ayarlar.env.ornek', 'Caddyfile.ornek', 'mola-oku', 'mola-okuma.sudoers.ornek']) { const f = byName.get(`${BASE}/${name}`); if (f?.data.includes('\r\n')) problems.push(`Windows satır sonu: ${name}`); }
  const service = byName.get(`${BASE}/mola-merkez.service`)?.data.toString('utf8') ?? '';
  if (!/ExecStart=\/opt\/mola-merkez\/runtime\/node .*merkez\.mjs/.test(service) || !/MERKEZ_HOST=127\.0\.0\.1/.test(service)) problems.push('mola-merkez.service beklenen ExecStart/MERKEZ_HOST satırlarını içermiyor');
  const workFolder = /^(Environment=)?MERKEZ_CALISMA_KLASORU=\/var\/lib\/mola-merkez\/calisma$/m;
  if (!workFolder.test(service) || !workFolder.test(byName.get(`${BASE}/ayarlar.env.ornek`)?.data.toString('utf8') ?? '')) problems.push('MERKEZ_CALISMA_KLASORU (servis ve ayarlar.env.ornek) eksik');
  if (!(byName.get(`${BASE}/mola-oku`)?.data.toString('utf8') ?? '').startsWith('#!/bin/bash\n')) problems.push('mola-oku bir bash betiği değil');
  if (problems.length) throw new Error(`Linux Merkez paketi hatalı:\n  ${problems.join('\n  ')}`);
  return { files: byName.size, size: statSync(file).size };
}

const checkOnly = option('--check-only');
if (checkOnly) { const r = checkArchive(resolve(checkOnly)); console.log(`Paket yapısı doğru: ${r.files} dosya, ${(r.size / 1048576).toFixed(0)} MB`); process.exit(0); }
if (!process.argv.includes('--skip-ui-build')) execSync(process.platform === 'win32' ? 'npm.cmd run build' : 'npm run build', { stdio: 'inherit' });
if (!existsSync('dist/merkez.html')) throw new Error('dist/merkez.html yok: önce npm run build.');
const out = resolve(option('--out') ?? join('.local/installer', `Mola-Merkez-Linux-${version}`));
rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true }); mkdirSync(out, { recursive: true });
const bundle = (entry, file) => build({
  entryPoints: [entry], outfile: join(stage, file), bundle: true, platform: 'node', format: 'esm', target: 'node24',
  external: ['sharp', 'vite'], minify: true, legalComments: 'none', logLevel: 'warning', define: { 'process.env.MOLA_RELEASE_BUILD': '"1"' },
  banner: { js: "import { createRequire as __mola_require } from 'node:module'; const require = __mola_require(import.meta.url);" },
});
await bundle('server/merkez/index.ts', 'merkez.mjs');
await bundle('scripts/merkez-sifre-sifirla.ts', 'merkez-sifre-sifirla.mjs');
await bundle('scripts/merkez-kurtarma-kodu.ts', 'merkez-kurtarma-kodu.mjs');

const app = join(stage, 'app');
// The whole built screens: merkez.html (Mola Yönetim), and index.html / raporlarim.html that the Köprü pages name.
(function copy(source, target) { if (statSync(source).isDirectory()) { mkdirSync(target, { recursive: true }); for (const n of readdirSync(source)) copy(join(source, n), join(target, n)); } else { mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target); } })('dist', join(app, 'dist'));
copyFileSync(join(stage, 'merkez.mjs'), join(app, 'merkez.mjs'));
copyFileSync(join(stage, 'merkez-sifre-sifirla.mjs'), join(app, 'merkez-sifre-sifirla.mjs'));
copyFileSync(join(stage, 'merkez-kurtarma-kodu.mjs'), join(app, 'merkez-kurtarma-kodu.mjs'));
writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'mola-merkez', version, private: true, type: 'module', author: 'Merkut Studios' }, null, 2));
// The image library (Destek ekleri: photos made upright, small, without EXIF/GPS): sharp + its Linux files.
(function copyPackage(name, done = new Set()) {
  if (done.has(name)) return; done.add(name);
  const source = resolve('node_modules', name);
  if (!existsSync(join(source, 'package.json'))) throw new Error(`Bağımlılık bulunamadı: ${name}`);
  (function copy(s, t) { if (statSync(s).isDirectory()) { mkdirSync(t, { recursive: true }); for (const n of readdirSync(s)) copy(join(s, n), join(t, n)); } else { mkdirSync(dirname(t), { recursive: true }); copyFileSync(s, t); } })(source, join(app, 'node_modules', name));
  for (const dep of Object.keys(JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).dependencies ?? {})) copyPackage(dep, done);
})('sharp');
for (const name of ['@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64']) for (const f of await npmPackage(name)) { const path = join(app, 'node_modules', name, f.name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, f.data); }
// File list with hashes (as in every Mola package).
{
  const files = [];
  (function collect(dir) { for (const name of readdirSync(dir)) { const path = join(dir, name); if (lstatSync(path).isDirectory()) collect(path); else files.push({ file: relative(app, path).replaceAll('\\', '/'), sha256: sha(readFileSync(path)) }); } })(app);
  writeFileSync(join(app, 'manifest.json'), JSON.stringify({ version, builtAt: new Date().toISOString(), mode: 'merkez-linux', files }, null, 2));
}
const { node, license } = await nodeRuntime('linux-x64');
const entries = [
  ...treeEntries(app, `${BASE}/app`),
  { path: `${BASE}/runtime/node`, data: node, mode: 0o755 }, { path: `${BASE}/runtime/LICENSE`, data: license },
  { path: `${BASE}/kur.sh`, data: Buffer.from(unix(INSTALL)), mode: 0o755 },
  { path: `${BASE}/sifre-sifirla.sh`, data: Buffer.from(unix(RESET)), mode: 0o755 },
  { path: `${BASE}/kurtarma-kodu.sh`, data: Buffer.from(unix(RECOVERY)), mode: 0o755 },
  { path: `${BASE}/mola-merkez.service`, data: Buffer.from(unix(SERVICE)) },
  { path: `${BASE}/ayarlar.env.ornek`, data: Buffer.from(unix(SETTINGS)) },
  { path: `${BASE}/Caddyfile.ornek`, data: Buffer.from(unix(CADDYFILE)) },
  { path: `${BASE}/BENIOKU.txt`, data: Buffer.from(unix(README)) },
  // Read-only helper and its sudo rule (npm run vds, npm run vds:cek): kept as real files in scripts/linux/.
  { path: `${BASE}/mola-oku`, data: Buffer.from(unix(readFileSync('scripts/linux/mola-oku', 'utf8'))), mode: 0o755 },
  { path: `${BASE}/mola-okuma.sudoers.ornek`, data: Buffer.from(unix(readFileSync('scripts/linux/mola-okuma.sudoers.ornek', 'utf8'))) },
];
const archive = join(out, `Mola-Merkez-Linux-x64-${version}.tar.gz`);
await writeTarGz(archive, entries);
writeFileSync(join(out, 'BENIOKU.txt'), '﻿' + README.replace(/\r?\n/g, '\r\n'));
rmSync(stage, { recursive: true, force: true });
const checked = checkArchive(archive);
console.log(`${archive}\nPaket yapısı doğru: ${checked.files} dosya, ${(checked.size / 1048576).toFixed(0)} MB (sıkıştırılmış)`);
