import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { APP_VERSION as SERVER_VERSION } from '../server/license';
import { APP_VERSION, versionLine } from '../src/version';
import { DESKTOP_LAUNCH, holdFor, SPLASH_SURFACES, SPLASH_TIMING, splashWanted, type SplashEnv } from '../src/splashRules';
import { studioLogo } from '../scripts/studio-logo.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

test('the version has one source: package.json → the web screens, the server and the Android build', () => {
  assert.equal(APP_VERSION, pkg.version);
  assert.equal(SERVER_VERSION, pkg.version);
  assert.equal(versionLine(), `Mola ${pkg.version} · Merkut Studios`);
  assert.equal(versionLine('Mola Yönetim'), `Mola Yönetim ${pkg.version} · Merkut Studios`);
  // No screen writes a version number of its own (the sidebar label and the sign-in tag read APP_VERSION too).
  for (const file of ['src/Workspace.tsx', 'src/Platform.tsx', 'src/AppVersion.tsx', 'src/ReportsPhone.tsx'])
    assert.ok(!readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').includes(pkg.version), file);
  // The APK takes versionName from the same field.
  assert.match(readFileSync('scripts/build-apk.mjs', 'utf8'), /JSON\.parse\(readFileSync\(join\(root, 'package\.json'\), 'utf8'\)\)\.version/);
});

const desktop = `#masaustu=${'a'.repeat(43)}`;
const plain: SplashEnv = { path: '/', hash: desktop, framed: false, app: false, automated: false, seen: false };
test('Merkut Studios opening: only on a Mola.exe launch (its one-time #masaustu= address), once', () => {
  assert.equal(splashWanted('kafe', plain), true);
  // Tablets, phones, reloads and page changes: no launch address.
  assert.equal(splashWanted('kafe', { ...plain, hash: '' }), false);
  assert.equal(splashWanted('kafe', { ...plain, hash: '#masaustu=kisa' }), false);
  assert.equal(splashWanted('kafe', { ...plain, path: '/m/abc' }), false);
  for (const off of ['seen', 'framed', 'app', 'automated'] as const) assert.equal(splashWanted('kafe', { ...plain, [off]: true }), false, off);
  // The launcher really opens that address, and the desktop key reader takes the same form (then drops it from the address).
  assert.match(readFileSync('scripts/desktop/Mola.cs', 'utf8'), /"\/#masaustu=" \+ Local\.Key\(root\)/);
  assert.match(readFileSync('src/desktop-call.ts', 'utf8'), /\/\^#masaustu=\(\[A-Za-z0-9_-\]\{43\}\)\$\/[\s\S]*history\.replaceState/);
  assert.ok(DESKTOP_LAUNCH.test(desktop));
});

test('one switch file: Android, Mola Yönetim and Raporlarım are off for now and turn on from src/studio-splash.json', () => {
  assert.deepEqual(SPLASH_SURFACES, { masaustu: true, android: false, yonetim: false, raporlarim: false });
  const none = { ...plain, hash: '' };
  assert.equal(splashWanted('yonetim', none), false);
  assert.equal(splashWanted('raporlarim', none), false);
  const on = { masaustu: true, android: true, yonetim: true, raporlarim: true };
  assert.equal(splashWanted('yonetim', none, on), true);
  assert.equal(splashWanted('raporlarim', none, on), true);
  assert.equal(splashWanted('yonetim', { ...none, seen: true }, on), false);
  assert.equal(splashWanted('kafe', plain, { ...on, masaustu: false }), false);
  // The APK build writes the "android" switch into the app (res/values/acilis.xml → R.bool.merkut_acilis).
  assert.match(readFileSync('scripts/build-apk.mjs', 'utf8'), /studio-splash\.json'\), 'utf8'\)\)\.android === true/);
  assert.match(readFileSync('mobile/android/src/com/merkutstudios/mola/MainActivity.java', 'utf8'), /durum == null && getResources\(\)\.getBoolean\(R\.bool\.merkut_acilis\)/);
});

test('timing: in 600 + hold + out 600 + 150 stays within 2.5 s even when the logo takes the full 700 ms to arrive', () => {
  for (const waited of [0, 100, 350, 700]) {
    const total = waited + SPLASH_TIMING.fadeIn + holdFor(waited) + SPLASH_TIMING.fadeOut + SPLASH_TIMING.leave;
    assert.ok(total <= SPLASH_TIMING.total, `${waited}: ${total}`);
    assert.ok(holdFor(waited) >= 450);
  }
  assert.ok(holdFor(0) >= 1100 && holdFor(0) <= 1250);
});

test('the logo is made at build time: 600 px AVIF, WebP and JPEG from brand/merkut-studios, small', async () => {
  const sizes = { avif: 40_000, webp: 60_000, jpg: 90_000 };
  for (const [format, most] of Object.entries(sizes) as ['avif' | 'webp' | 'jpg', number][]) {
    const { data, width, height } = await studioLogo(format);
    const meta = await sharp(data).metadata();
    assert.equal(meta.width, 600); assert.equal(width, 600); assert.equal(meta.height, height);
    assert.equal(meta.format, format === 'jpg' ? 'jpeg' : format === 'avif' ? 'heif' : 'webp');
    assert.ok(data.length < most, `${format}: ${data.length} bytes`);
    // Black ground (the opening's own colour) at the corners.
    const { data: px } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
    assert.ok(px[0] + px[1] + px[2] < 30, `${format} corner`);
  }
});
