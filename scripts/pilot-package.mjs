import { mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Explicit allowlist: never copy business data, credentials, backups or developer dependencies.
const root = resolve('.local/packages', `mola-pilot-${Date.now()}-${randomUUID().slice(0, 8)}`);
const files = ['dist', 'server', 'packages', 'templates', 'scripts/backup.ts', 'scripts/update-check.ts', 'docs/GUNCELLEME_PROVASI.md', 'scripts/verify-key-migration.ts', 'scripts/pilot-preflight.ts', 'scripts/local-https.ts', 'scripts/local-https-cert.ps1', 'scripts/check-local-https.ts', 'docs/YEREL_HTTPS.md', 'docs/YEDEK_PROVASI.md', 'docs/SATISA_HAZIRLIK_2026-09-26.md', 'package.json', 'package-lock.json', 'tsconfig.json'];
for (const file of files) {
  const source = resolve(file);
  function check(path) { if (lstatSync(path).isSymbolicLink()) throw new Error('Paket kaynağında sembolik bağlantı var.'); if (lstatSync(path).isDirectory()) for (const name of readdirSync(path)) check(join(path, name)); }
  check(source);
}
mkdirSync(root, { recursive: true });
function copy(source, target) { if (lstatSync(source).isDirectory()) { mkdirSync(target, { recursive: true }); for (const name of readdirSync(source)) copy(join(source, name), join(target, name)); } else { mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, readFileSync(source), { flag: 'wx' }); } }
for (const file of files) copy(resolve(file), join(root, file));
writeFileSync(join(root, 'Temiz-Pilot-Baslat.cmd'), '@echo off\r\ncd /d "%~dp0"\r\nset MOLA_CLEAN_INSTALL=1\r\nset SERVE_BUILD=1\r\nif not defined DATA_DIR set DATA_DIR=%~dp0veri\r\ncall npm.cmd run pilot:check -- --summary\r\nif errorlevel 1 (\r\n  echo.\r\n  echo Baslatma durduruldu. Yukaridaki sorunlari kontrol edin.\r\n  pause\r\n  exit /b 1\r\n)\r\ncall npm.cmd run dev\r\n');
writeFileSync(join(root, 'ILK_KURULUM.txt'), `MOLA — YEREL PİLOT PAKETİ\n\nBu paket internete açık üretim sürümü değildir.\nNode.js 24+ kurulu olmalı. İlk hazırlıkta bu klasörde npm.cmd ci çalıştırın (internet gerekir).\nTemiz-Pilot-Baslat.cmd dosyasını çalıştırın, http://localhost:3000 adresini açın.\nİlk ekran "Mola'yı etkinleştir": Hesap açma başvurusu (Mola ekibi onaylayınca 30 günlük deneme başlar) ya da Mola ekibinin verdiği etkinleştirme kodu (internet gerekir, MOLA_MERKEZ_URL).\nSonra işletme sahibi kullanıcı adı ve şifresi bu bilgisayarda belirlenir; Mola Merkez'e gönderilmez.\nYeni ortamda demo işletme veya demo şifre oluşturulmaz.\nYeni işletme temiz kafe kategorileri ve 8 örnek ürünle başlar; sipariş/tahsilat içermez.\n\nYARDIM\nYerel HTTPS: docs/YEREL_HTTPS.md\nYedek doğrulama: docs/YEDEK_PROVASI.md\nHTTPS denemesi ayrı demo verisi oluşturur; temiz işletme başlatıcısı değildir.\n\nGÜNCELLEME\nSunucuyu durdurun. Eski pakette npm.cmd run backup -- create <veri-klasörü> çalıştırın.\nYedek ve anahtarı farklı güvenli yerlerde saklayın. Geri yüklemeyi ayrı klasörde doğrulayın.\nYeni paketi ayrı klasöre açın; bağımlılıkları npm.cmd ci ile kurun.\nÖnce docs/GUNCELLEME_PROVASI.md yönergesindeki salt okunur kontrolü ve ayrı veride provayı tamamlayın. Doğrudan canlı veriyle başlatmayın.\nMevcut veri klasörünü kopyalama/üzerine yazma/silme işlemi yapmayın.\nGeri dönüşte önceki uygulama klasörünü ve doğrulanmış yedeği kullanın.\nBu paket kaynak kod içerir; kapalı kaynak dağıtım veya tek dosyalı çevrimdışı yükleyici değildir.\n`);
const manifest = [];
function collect(dir) { for (const name of readdirSync(dir)) { const path = join(dir, name); if (lstatSync(path).isDirectory()) collect(path); else manifest.push({ file: relative(root, path).replaceAll('\\', '/'), sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }); } }
collect(root); writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version, builtAt: new Date().toISOString(), mode: 'local-pilot', files: manifest }, null, 2));
console.log(root);
