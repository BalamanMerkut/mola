// Builds the thin Android app (mobile/android) into .local/android/Mola.apk, without Gradle and without npm packages:
//   aapt2 compile/link (resources, manifest) → javac (--release 11, against android.jar) → d8 → zipalign → apksigner.
//
//   npm run apk                 build (fails if the Android SDK or the JDK is missing)
//   node scripts/build-apk.mjs --varsa    build if the tools are there, otherwise warn and exit 0 (npm run installer)
//
// Tools: the Android SDK (ANDROID_HOME, else %LOCALAPPDATA%\Android\Sdk: platforms/android-N, build-tools/X) and a JDK 17+
// (JAVA_HOME, else C:\Program Files\Eclipse Adoptium\jdk-*). Version name/code come from package.json (0.1.0 → 100).
// Signing key: made ONCE in .local/android-imza/ (keystore + generated password). Back that folder up: Android installs an
// update only when it is signed with the same key. It is never copied into a package.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { iconSvg, renderPng } from './mola-icons.mjs';
import { androidStudioLogo } from './studio-logo.mjs';

const root = resolve(import.meta.dirname, '..');
const optional = process.argv.includes('--varsa');
export const PACKAGE = 'com.merkutstudios.mola';
const MIN_SDK = 24, TARGET_SDK = 34;
const OUT = join(root, '.local', 'android'), APK = join(OUT, 'Mola.apk');
const SIGNING = join(root, '.local', 'android-imza');

/** Highest-numbered child folder that has `file` (android-36, 36.1.0…). */
function newest(folder, file) {
  if (!existsSync(folder)) return undefined;
  const key = name => name.replace(/^android-/, '').split(/[.-]/).map(n => n.padStart(6, '0')).join('.');
  return readdirSync(folder).filter(n => existsSync(join(folder, n, file))).sort((a, b) => key(b).localeCompare(key(a))).map(n => join(folder, n))[0];
}
export function androidTools() {
  const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk')].find(p => p && existsSync(p));
  const exe = process.platform === 'win32' ? '.exe' : '';
  const jdks = [process.env.JAVA_HOME, ...(process.platform === 'win32' && existsSync('C:\\Program Files\\Eclipse Adoptium') ? readdirSync('C:\\Program Files\\Eclipse Adoptium').filter(n => n.startsWith('jdk-')).sort().reverse().map(n => join('C:\\Program Files\\Eclipse Adoptium', n)) : [])];
  const jdk = jdks.find(p => p && existsSync(join(p, 'bin', `javac${exe}`)));
  const platform = sdk && newest(join(sdk, 'platforms'), 'android.jar');
  const buildTools = sdk && newest(join(sdk, 'build-tools'), `aapt2${exe}`);
  const missing = [!sdk && 'Android SDK (ANDROID_HOME)', sdk && !platform && 'Android SDK platform (platforms/android-N)', sdk && !buildTools && 'Android build-tools', !jdk && 'JDK 17+ (JAVA_HOME)'].filter(Boolean);
  if (missing.length) return { missing };
  const bt = name => join(buildTools, name);
  return { sdk, jdk, platform, buildTools, androidJar: join(platform, 'android.jar'), aapt2: bt(`aapt2${exe}`), aapt: bt(`aapt${exe}`), zipalign: bt(`zipalign${exe}`), d8: bt('lib/d8.jar'), apksigner: bt('lib/apksigner.jar'), java: join(jdk, 'bin', `java${exe}`), javac: join(jdk, 'bin', `javac${exe}`), jar: join(jdk, 'bin', `jar${exe}`), keytool: join(jdk, 'bin', `keytool${exe}`) };
}
/** "0.1.0" → 100, "1.2.3" → 10203: grows with every release (each part below 100). */
export function versionCode(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!parts || parts.slice(1).some(p => Number(p) > 99)) throw new Error(`Sürüm Android sürüm koduna çevrilemedi: ${version}`);
  const code = Number(parts[1]) * 10000 + Number(parts[2]) * 100 + Number(parts[3]);
  if (code < 1) throw new Error('Android sürüm kodu en az 1 olmalı (package.json sürümü 0.0.0 olamaz).');
  return code;
}

const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });

/** Signing key, made once. Its password is generated and kept next to it (sifre.txt); both stay in .local/android-imza. */
function signingKey(tools) {
  const keystore = join(SIGNING, 'mola-android.p12'), password = join(SIGNING, 'sifre.txt');
  if (existsSync(keystore) && existsSync(password)) return { keystore, password };
  if (existsSync(keystore) || existsSync(password)) throw new Error(`${SIGNING} içinde imza dosyalarından biri eksik (mola-android.p12 ve sifre.txt birlikte olmalı). Yedekten geri koyun; yenisini üretmek eski uygulamaların güncellenmesini engeller.`);
  mkdirSync(SIGNING, { recursive: true });
  writeFileSync(password, randomBytes(24).toString('base64url'), { mode: 0o600 });
  run(tools.keytool, ['-genkeypair', '-keystore', keystore, '-storetype', 'PKCS12', '-storepass:file', password, '-keypass:file', password, '-alias', 'mola', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000', '-dname', 'CN=Mola, O=Merkut Studios, C=TR']);
  writeFileSync(join(SIGNING, 'OKUBENI.txt'), '\uFEFF' + `MOLA ANDROID İMZA ANAHTARI · YEDEKLEYİN
Merkut Studios

Bu klasör Mola Android uygulamasının (Mola.apk) imza anahtarıdır:
  mola-android.p12   anahtar deposu (PKCS12, takma ad: mola)
  sifre.txt          deponun şifresi (ilk derlemede rastgele üretildi)

YEDEKLEYİN: aynı imza olmadan güncelleme kurulmaz. Android, telefondaki Mola'nın üzerine yalnız aynı anahtarla imzalanmış
yeni bir Mola.apk kurar. Bu klasör kaybolursa yeni anahtarla imzalanan uygulama, her telefonda eskisi kaldırılıp
yeniden kurulmadan yüklenemez.

Bu klasörü flash belleğe ve bilgisayardan ayrı bir yere kopyalayın. Kimseyle paylaşmayın; kurulum paketlerine girmez.
Oluşturulma: ${new Date().toISOString()}
`.replace(/\n/g, '\r\n'));
  return { keystore, password };
}

function copyTree(source, target) {
  if (statSync(source).isDirectory()) { mkdirSync(target, { recursive: true }); for (const name of readdirSync(source)) copyTree(join(source, name), join(target, name)); }
  else { mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target); }
}
const files = (dir, ext) => readdirSync(dir, { recursive: true }).map(String).filter(n => n.endsWith(ext)).map(n => join(dir, n));

/** What `aapt2 dump badging` says about an APK: package, versions, SDK levels, permissions, label. */
export function badging(tools, apk) {
  const text = run(tools.aapt2, ['dump', 'badging', apk]);
  const field = (re) => re.exec(text)?.[1];
  return {
    text,
    package: field(/package: name='([^']+)'/), versionCode: Number(field(/versionCode='(\d+)'/)), versionName: field(/versionName='([^']+)'/),
    minSdk: Number(field(/minSdkVersion:'(\d+)'/)), targetSdk: Number(field(/targetSdkVersion:'(\d+)'/)), label: field(/application-label:'([^']*)'/),
    permissions: [...text.matchAll(/uses-permission: name='([^']+)'/g)].map(m => m[1]),
  };
}
export function verifySignature(tools, apk) {
  return run(tools.java, ['-jar', tools.apksigner, 'verify', '--verbose', '--print-certs', apk]);
}

async function main() {
  const tools = androidTools();
  if (tools.missing) {
    const message = `Android uygulaması derlenmedi: ${tools.missing.join(', ')} bulunamadı.`;
    if (optional) { console.warn(`UYARI: ${message} Paketlere Mola.apk girmeyecek.`); return; }
    throw new Error(message);
  }
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, code = versionCode(version);
  // d8 and apksigner are Java programs: they run with this JDK.
  const env = { ...process.env, JAVA_HOME: tools.jdk, PATH: `${join(tools.jdk, 'bin')};${process.env.PATH}` };
  // aapt2 does not like non-ASCII folder names (the project lives under "Masaüstü"): everything is built in a temp folder.
  const work = mkdtempSync(join(tmpdir(), 'mola-apk-'));
  try {
    const src = join(work, 'android');
    copyTree(join(root, 'mobile', 'android'), src);
    // Launcher icon from scripts/desktop/mola-icon.svg: adaptive (API 26+) foreground and the old square icon.
    for (const [folder, scale] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
      const dir = join(src, 'res', `mipmap-${folder}`); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'ic_launcher.png'), await renderPng(iconSvg.rounded(), Math.round(48 * scale)));
      writeFileSync(join(dir, 'ic_launcher_on.png'), await renderPng(iconSvg.cup(), Math.round(108 * scale)));
    }
    // Merkut Studios açılışı (MainActivity.acilisGoster): the logo (600 px WebP, scripts/studio-logo.mjs) and its switch,
    // "android" in src/studio-splash.json (the one file that turns the opening on or off everywhere).
    mkdirSync(join(src, 'res', 'drawable-nodpi'), { recursive: true });
    writeFileSync(join(src, 'res', 'drawable-nodpi', 'merkut_studios.webp'), (await androidStudioLogo()).data);
    const splashOn = JSON.parse(readFileSync(join(root, 'src', 'studio-splash.json'), 'utf8')).android === true;
    writeFileSync(join(src, 'res', 'values', 'acilis.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <bool name="merkut_acilis">${splashOn}</bool>\n</resources>\n`);
    const compiled = join(work, 'res.zip'), unsigned = join(work, 'unsigned.apk'), gen = join(work, 'gen'), classes = join(work, 'classes'), dex = join(work, 'dex');
    run(tools.aapt2, ['compile', '--dir', join(src, 'res'), '-o', compiled]);
    run(tools.aapt2, ['link', '-o', unsigned, '-I', tools.androidJar, '--manifest', join(src, 'AndroidManifest.xml'), '--java', gen,
      '--min-sdk-version', String(MIN_SDK), '--target-sdk-version', String(TARGET_SDK), '--version-code', String(code), '--version-name', version, '--auto-add-overlay', compiled]);
    mkdirSync(classes, { recursive: true });
    run(tools.javac, ['--release', '11', '-encoding', 'UTF-8', '-Xlint:-options', '-nowarn', '-classpath', tools.androidJar, '-d', classes, ...files(join(src, 'src'), '.java'), ...files(gen, '.java')], { env });
    const jar = join(work, 'classes.jar');
    run(tools.jar, ['cf', jar, '-C', classes, '.'], { env });
    mkdirSync(dex, { recursive: true });
    run(tools.java, ['-cp', tools.d8, 'com.android.tools.r8.D8', '--release', '--min-api', String(MIN_SDK), '--lib', tools.androidJar, '--output', dex, jar], { env });
    // classes.dex goes in at the archive root (aapt add stores the path as given, so it runs inside dex/).
    run(tools.aapt, ['add', unsigned, 'classes.dex'], { cwd: dex });
    const aligned = join(work, 'aligned.apk'), signed = join(work, 'Mola.apk');
    run(tools.zipalign, ['-f', '4', unsigned, aligned]);
    const key = signingKey(tools);
    run(tools.java, ['-jar', tools.apksigner, 'sign', '--ks', key.keystore, '--ks-type', 'PKCS12', '--ks-key-alias', 'mola', '--ks-pass', `file:${key.password}`, '--out', signed, aligned], { env });
    // Checks before it goes anywhere: signature, package, version, permissions.
    const proof = verifySignature(tools, signed);
    const info = badging(tools, signed);
    if (info.package !== PACKAGE || info.versionCode !== code || info.versionName !== version || info.minSdk !== MIN_SDK) throw new Error(`APK bilgisi beklenenden farklı:\n${info.text}`);
    // CAMERA: "QR okut" (vardiya kodu, QrOkuyucu) and product photos; asked only when first used.
    const allowed = ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.CAMERA'];
    if (info.permissions.some(p => !allowed.includes(p))) throw new Error(`APK beklenmeyen izin istiyor: ${info.permissions.join(', ')}`);
    mkdirSync(OUT, { recursive: true });
    copyFileSync(signed, APK);
    const size = statSync(APK).size;
    writeFileSync(join(OUT, 'Mola.apk.json'), JSON.stringify({ package: info.package, versionName: info.versionName, versionCode: info.versionCode, minSdk: info.minSdk, targetSdk: info.targetSdk, size, builtAt: new Date().toISOString() }, null, 2));
    const signer = /Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/.exec(proof)?.[1] ?? '?';
    console.log(`Mola.apk hazır: ${relative(root, APK)} (${(size / 1024).toFixed(0)} KB)\n  ${info.package} · sürüm ${info.versionName} (kod ${info.versionCode}) · Android ${MIN_SDK}+ (hedef ${info.targetSdk})\n  izinler: ${info.permissions.join(', ')}\n  imza SHA-256: ${signer.slice(0, 16)}… (anahtar: ${relative(root, key.keystore)}; YEDEKLEYİN)`);
  } catch (error) {
    // A failed tool prints its own reason on stderr.
    const detail = error.stderr || error.stdout ? `\n${String(error.stderr || '')}${String(error.stdout || '')}`.trimEnd() : '';
    throw new Error(`${error.message.split('\n')[0]}${detail}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
