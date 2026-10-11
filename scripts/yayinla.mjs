#!/usr/bin/env node
// Yayınlama komutu: builds the update bundle, uploads it to Mola Merkez and publishes it (pilot or everyone).
//
//   npm run yayinla -- --surum 0.1.1 --pilot "Mola Kafe" "Deniz Kafe"      what it would do (nothing is sent)
//   npm run yayinla -- --surum 0.1.1 --herkes --evet --kod 123456           really: build if needed, upload, publish to all
//   npm run yayinla -- --erisim-kaydet                                      once: keeps the key from Mola Yönetim → Ayarlar →
//                                                                           Geliştirici erişimi (asked on the keyboard)
// Options:
//   --pilot <işletme…>   names (as in Mola Yönetim) or ids of activated businesses; --herkes: every café
//   --not "…"            note for the café owner (600 characters)
//   --platform windows   windows (default), linux-x64, macos-arm64, macos-x64
//   --paket <dosya>      an existing .mola-guncelleme (no build); default .local/installer/Mola-<sürüm>/Guncelleme/…
//   --merkez <adres>     Mola Merkez (default: the saved one, else http://127.0.0.1:4000)
//   --erisim <dosya>     the key file (default %APPDATA%\Mola\yayin-erisimi.json, outside the project and OneDrive)
//   --evet               really do it; without it the command only prints the plan
//   --kod <6 haneli>     with --evet (required): the current code of the Authenticator app of Mola Yönetim's two-step login.
//                        It opens the 10-minute "güncelleme yetkisi" for this key (server/merkez/step-up.ts); two-step login
//                        must be on (Mola Yönetim → Ayarlar → Hesap güvenliği). A dry run needs no code.
// The key only reaches Güncellemeler (scope "releases"); everything it does is in İşlem kayıtları as "Geliştirici erişimi".
// Environment: MOLA_YAYIN_ANAHTARI (the key itself) and MOLA_YAYIN_MERKEZ override the file.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const PLATFORMS = ['windows', 'linux-x64', 'macos-arm64', 'macos-x64'];
const PLATFORM_NAMES = { windows: 'Windows', 'linux-x64': 'Linux', 'macos-arm64': 'macOS (Apple Silicon)', 'macos-x64': 'macOS (Intel)' };
const TOKEN = /^mola_yayin_[A-Za-z0-9_-]{43}$/;
/**
 * Stops the command with a plain reason. Thrown, not process.exit(): exiting while fetch still holds a kept-alive connection
 * can crash Node on Windows (exit code 0xC0000409 instead of 1 or 2).
 */
class Stop extends Error { constructor(message, code) { super(message); this.code = code; } }
const fail = (message, code = 1) => { throw new Stop(message, code); };

function parse(argv) {
  const o = { pilot: [], evet: false, herkes: false, kaydet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], value = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) fail(`${a} için bir değer yazın.`, 2); return v; };
    if (a === '--surum') o.surum = value();
    else if (a === '--pilot') { while (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) o.pilot.push(argv[++i]); if (!o.pilot.length) fail('--pilot için en az bir işletme yazın.', 2); }
    else if (a === '--herkes') o.herkes = true;
    else if (a === '--evet') o.evet = true;
    else if (a === '--not') o.not = value();
    else if (a === '--platform') o.platform = value();
    else if (a === '--paket') o.paket = value();
    else if (a === '--merkez') o.merkez = value();
    else if (a === '--erisim') o.erisim = value();
    else if (a === '--erisim-kaydet') o.kaydet = true;
    else if (a === '--kod') o.kod = value().replace(/[\s-]/g, '');
    else fail(`Bilinmeyen seçenek: ${a}`, 2);
  }
  return o;
}
const defaultAccessFile = () => join(process.env.APPDATA ?? join(homedir(), '.config'), 'Mola', 'yayin-erisimi.json');
function readAccess(file) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } }

async function call(base, token, path, init = {}) {
  const url = new URL(path, base), headers = { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) };
  // A Merkez behind HTTPS (VDS) wants the Origin of its own address on every change.
  if (init.method && init.method !== 'GET') headers.Origin = url.origin;
  let r; try { r = await fetch(url, { ...init, headers }); } catch { fail(`Mola Merkez’e ulaşılamadı (${base}). Mola Yönetim açık mı?`); }
  const body = await r.json().catch(() => ({}));
  const hint = r.status === 401 ? ' (Geliştirici erişimi anahtarını kontrol edin: Mola Yönetim → Ayarlar → Geliştirici erişimi.)'
    : body.code === 'STEP_UP_REQUIRED' ? ' Güncelleme yetkisinin 10 dakikası doldu (paket derlenirken olabilir). Paket hazır: aynı komutu yeni kodla (--kod) yeniden çalıştırın.' : '';
  if (!r.ok) fail(`${body.message ?? `Mola Merkez ${r.status} döndü.`}${hint}`);
  return body;
}

async function saveKey(o) {
  const file = resolve(o.erisim ?? defaultAccessFile()), old = readAccess(file);
  const base = (o.merkez ?? old.url ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
  process.stdout.write('Mola Yönetim → Ayarlar → Geliştirici erişimi’nde gösterilen anahtarı yapıştırıp Enter’a basın:\n');
  // The first line typed (or piped); a BOM from a Windows pipe is dropped.
  const token = await new Promise(done => {
    let text = '', over = false; process.stdin.setEncoding('utf8');
    const finish = () => { if (over) return; over = true; process.stdin.pause(); done(text.split(/\r?\n/)[0].replace(/^﻿/, '').trim()); };
    process.stdin.on('data', d => { text += d; if (text.includes('\n')) finish(); }); process.stdin.on('end', finish);
  });
  if (!TOKEN.test(token)) fail('Bu bir yayınlama anahtarı değil (mola_yayin_… ile başlamalı).', 2);
  const check = await fetch(new URL('/api/merkez/admin/releases', base), { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (check && !check.ok) fail(`Mola Merkez bu anahtarı kabul etmedi (${check.status}). Mola Yönetim’de yeni anahtar oluşturun.`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ url: base, token, savedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  console.log(`Anahtar kaydedildi: ${file}${check ? '' : ' (Mola Merkez şu anda kapalı; ilk yayında denenecek)'}.`);
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.kaydet) return saveKey(o);
  if (!o.surum || !/^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/.test(o.surum)) fail('Sürümü yazın: --surum 0.1.1', 2);
  if (o.herkes === !!o.pilot.length) fail('Ya --pilot <işletme…> ya da --herkes seçin (biri).', 2);
  const platform = o.platform ?? 'windows';
  if (!PLATFORMS.includes(platform)) fail(`Platform şunlardan biri olmalı: ${PLATFORMS.join(', ')}`, 2);
  if (o.not !== undefined && o.not.length > 600) fail('Not en fazla 600 karakter olabilir.', 2);
  // Güncelleme yetkisi: a real run needs the current Authenticator code as well as the key (a dry run needs neither code nor change).
  if (o.evet && o.kod === undefined) fail('--evet ile doğrulayıcı uygulamadaki güncel kodu da yazın: --kod 123456 (Mola Yönetim’in iki adımlı doğrulaması; açık değilse Mola Yönetim → Ayarlar → Hesap güvenliği).', 2);
  if (o.kod !== undefined && !/^\d{6}$/.test(o.kod)) fail('--kod 6 rakamdan oluşur: doğrulayıcı uygulamadaki güncel kod.', 2);
  const accessFile = resolve(o.erisim ?? defaultAccessFile()), access = readAccess(accessFile);
  const token = process.env.MOLA_YAYIN_ANAHTARI?.trim() || access.token;
  const base = (o.merkez || process.env.MOLA_YAYIN_MERKEZ?.trim() || access.url || 'http://127.0.0.1:4000').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) fail(`Mola Merkez adresi http:// ya da https:// ile başlamalı: ${base}`, 2);
  if (!token || !TOKEN.test(token)) fail(`Yayınlama anahtarı yok. Mola Yönetim → Ayarlar → Geliştirici erişimi’nden oluşturun, sonra: npm run yayinla -- --erisim-kaydet (aranan dosya: ${accessFile})`, 2);

  // The bundle: given, or where `npm run installer` writes it.
  const expected = resolve('.local', 'installer', `Mola-${o.surum}`, 'Guncelleme', `Mola-${o.surum}-${platform}.mola-guncelleme`);
  const bundle = resolve(o.paket ?? expected), exists = existsSync(bundle);
  if (o.paket && !exists) fail(`Paket bulunamadı: ${bundle}`, 2);
  let build = false;
  if (!exists) {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    if (version !== o.surum) fail(`package.json sürümü ${version}, istenen ${o.surum}. Önce package.json’daki sürümü ${o.surum} yapın (ya da --paket ile hazır dosyayı verin).`, 2);
    build = true;
  }
  // What Merkez knows: the releases and the activated businesses.
  const state = await call(base, token, '/api/merkez/admin/releases');
  const cafes = (state.cafes ?? []).filter(c => c.installId), lower = s => s.toLocaleLowerCase('tr-TR').trim();
  const pilot = o.pilot.map(p => {
    const found = cafes.filter(c => c.tenantId === p || lower(c.name) === lower(p));
    if (found.length !== 1) fail(found.length ? `“${p}” adında birden çok işletme var; kimliğini (tenantId) yazın: ${found.map(c => c.tenantId).join(', ')}` : `“${p}” adında etkinleşmiş işletme yok. Var olanlar: ${cafes.map(c => c.name).join(', ') || '—'}`, 2);
    return found[0];
  });
  const already = (state.releases ?? []).find(r => r.version === o.surum && r.platform === platform);
  console.log('\nMola yayınlama');
  console.log(`  Sürüm:   ${o.surum} (${PLATFORM_NAMES[platform]})`);
  console.log(`  Paket:   ${already ? 'Mola Merkez’de zaten yüklü (yeniden yüklenmez)' : exists ? `${bundle} (${(statSync(bundle).size / 1048576).toFixed(1)} MB)` : `henüz yok: önce "npm run installer -- --platforms=${platform}" çalıştırılacak`}`);
  console.log(`  Merkez:  ${base}`);
  console.log(`  Yayın:   ${o.herkes ? `Herkese (${cafes.length} etkin işletme; ${PLATFORM_NAMES[platform]} kullananlar indirir)` : `Pilot → ${pilot.map(c => `${c.name} (şu an ${c.appVersion || 'sürüm bilinmiyor'})`).join(', ')}`}`);
  if (o.not !== undefined) console.log(`  Not:     ${o.not || '(boş)'}`);
  if (already && already.rollout?.mode !== 'off') console.log(`  Şu an:   ${already.rollout.mode === 'all' ? 'herkese yayında' : `pilot (${already.rollout.pilot.length} işletme)`}`);
  console.log('  Güvenlik: işletmeler kurmadan önce yedek alır; yeni sürüm açılmazsa eskisine döner.');
  if (!o.evet) { console.log('\nBu bir deneme: hiçbir şey derlenmedi, yüklenmedi, yayınlanmadı. Gerçekten yapmak için aynı komutu --evet --kod <doğrulayıcı kodu> ile çalıştırın.'); return; }

  // First the Güncelleme yetkisi (before a long build): a wrong code stops here and nothing is built or sent.
  const right = await call(base, token, '/api/merkez/admin/releases/yetki', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: o.kod }) });
  console.log(`\nGüncelleme yetkisi açıldı (bitiş saati ${new Date(right.until).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}).`);
  let release = already;
  if (!release) {
    if (build) {
      console.log(`\nPaket oluşturuluyor: npm run installer -- --platforms=${platform}`);
      const args = ['scripts/build-installer.mjs', `--platforms=${platform}`, ...(o.not ? [`--guncelleme-notu=${o.not}`] : [])];
      const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
      if (r.status !== 0 || !existsSync(bundle)) fail(`Paket oluşturulamadı (${bundle} yok).`);
    }
    console.log('\nYükleniyor ve denetleniyor…');
    const up = await call(base, token, '/api/merkez/admin/releases/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: readFileSync(bundle) });
    release = up.release;
    console.log(`  ${release.version} (${PLATFORM_NAMES[release.platform]}) yüklendi, denetlendi ve imzalandı.`);
  }
  if (o.not !== undefined && o.not.trim() !== (release.notes ?? '')) { await call(base, token, '/api/merkez/admin/releases/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: release.id, notes: o.not }) }); console.log('  Not kaydedildi.'); }
  const body = o.herkes ? { id: release.id, mode: 'all' } : { id: release.id, mode: 'pilot', pilot: pilot.map(c => c.tenantId) };
  const done = await call(base, token, '/api/merkez/admin/releases/rollout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(`\nYayınlandı: ${done.release.version} → ${o.herkes ? 'herkese' : `pilot (${pilot.map(c => c.name).join(', ')})`}. İşletmeler bir sonraki bağlantıda (en geç 10 dakika) indirmeye başlar.`);
  console.log('Durumu Mola Yönetim → Ayarlar → Güncellemeler’de izleyin; durdurmak için oradaki “Durdur”.');
}
main().catch(e => { console.error(`\nYayınlanmadı: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = e instanceof Stop ? e.code : 1; });
