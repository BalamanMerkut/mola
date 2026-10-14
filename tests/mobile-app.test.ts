import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import sharp from 'sharp';
import { licensed } from './merkez-fixture.js';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { lanClient, mobileAppRoutes, privateAddress } from '../server/mobile-app.js';
import { devAllowList } from '../server/web-serving.js';
import { WEB_ICONS, YONETIM_FILL, iconSvg, webIcon } from '../scripts/mola-icons.mjs';
import { androidTools, badging, PACKAGE, verifySignature, versionCode } from '../scripts/build-apk.mjs';

/** A raw GET with chosen headers (fetch cannot send a forwarding header the way a tunnel does… it can, but this keeps Host exact). */
function get(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => { const parts: Buffer[] = []; res.on('data', c => parts.push(c)); res.on('end', () => done({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(parts) })); });
    req.on('error', fail); req.end();
  });
}

test('only the café network counts as LAN: private, loopback and link-local addresses, never through a proxy', () => {
  for (const ip of ['192.168.1.20', '10.0.0.5', '172.16.0.1', '172.31.255.254', '127.0.0.1', '::1', '::ffff:192.168.0.7', '169.254.10.1', 'fd12:3456::1', 'fe80::1%eth0'])
    assert.equal(privateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '100.64.0.1', '192.169.1.1', '2a00:1450::1', '::ffff:8.8.8.8', '', 'kafe.local', '300.1.1.1'])
    assert.equal(privateAddress(ip), false, ip);
  const req = (remoteAddress: string, headers: Record<string, string> = {}) => ({ headers, socket: { remoteAddress } });
  assert.equal(lanClient(req('192.168.1.30')), true);
  assert.equal(lanClient(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' })), false, 'a tunnel on this computer forwards strangers');
  assert.equal(lanClient(req('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9' })), false);
  assert.equal(lanClient(req('203.0.113.9')), false);
});

test('/api/uygulama and /uygulama/Mola.apk: business name, the APK with its Android type, café network only', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/mobile-')));
  licensed(store);
  // Under a dot folder, as development's .local/android/Mola.apk is.
  const folder = join(mkdtempSync(join(tmpdir(), 'mola-apk-test-')), '.local'); mkdirSync(folder);
  const fake = join(folder, 'Mola.apk');
  writeFileSync(fake, Buffer.from('PK\x03\x04 mola test apk'));
  const before = process.env.MOLA_APK; process.env.MOLA_APK = fake;
  const server = createServer(createApp(store));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { if (before === undefined) delete process.env.MOLA_APK; else process.env.MOLA_APK = before; server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const port = (server.address() as AddressInfo).port;

  const info = await get(port, '/api/uygulama');
  assert.equal(info.status, 200);
  const body = JSON.parse(info.body.toString('utf8'));
  assert.equal(body.app, 'mola'); assert.equal(body.role, 'kafe');
  assert.equal(typeof body.name, 'string'); assert.ok(body.name.length > 0, 'the business name for the Android café search');
  assert.deepEqual(body.apk, { size: readFileSync(fake).length, path: '/uygulama/Mola.apk' });
  assert.equal(info.headers['cache-control'], 'no-store');

  const apk = await get(port, '/uygulama/Mola.apk');
  assert.equal(apk.status, 200);
  assert.equal(apk.headers['content-type'], 'application/vnd.android.package-archive');
  assert.match(String(apk.headers['content-disposition']), /attachment; filename="Mola\.apk"/);
  assert.equal(apk.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(apk.body, readFileSync(fake));
  assert.equal((await get(port, '/uygulama/Mola.apk', { 'X-Forwarded-For': '203.0.113.9' })).status, 404, 'not through a tunnel');
  assert.equal((await get(port, '/api/uygulama', { Forwarded: 'for=203.0.113.9' })).status, 404);
  assert.equal((await get(port, '/uygulama/Baska.apk')).status, 404);
  // The health answer the Android app's search checks first.
  assert.equal(JSON.parse((await get(port, '/api/health')).body.toString('utf8')).role, 'kafe');
});

test('without a built APK the page is told so and the download is 404', async t => {
  const app = express(); mobileAppRoutes(app, { name: () => null, version: '9.9.9', apk: () => undefined });
  const server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise<void>(r => server.close(() => r())));
  const port = (server.address() as AddressInfo).port;
  assert.deepEqual(JSON.parse((await get(port, '/api/uygulama')).body.toString('utf8')), { app: 'mola', role: 'kafe', name: null, version: '9.9.9', apk: null });
  assert.equal((await get(port, '/uygulama/Mola.apk')).status, 404);
});

test('web app manifests, iOS tags and icons: Mola, standalone, staff entry, 16/32 tab icons, 192/256/512 + maskable + apple-touch-icon; Mola Yönetim near-black', async () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.name, 'Mola'); assert.equal(manifest.short_name, 'Mola');
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/');
  assert.equal(manifest.theme_color, '#234c3e'); assert.equal(manifest.background_color, '#f6f7f4'); assert.equal(manifest.lang, 'tr');
  const icons = manifest.icons as { src: string; sizes: string; type: string; purpose: string }[];
  for (const [size, purpose] of [['192x192', 'any'], ['256x256', 'any'], ['512x512', 'any'], ['192x192', 'maskable'], ['512x512', 'maskable']])
    assert.ok(icons.some(i => i.sizes === size && i.purpose === purpose && i.type === 'image/png'), `${size} ${purpose}`);
  // Mola Yönetim (merkez.html): its own manifest with the near-black icons.
  const yonetim = JSON.parse(readFileSync('public/manifest-yonetim.webmanifest', 'utf8'));
  assert.equal(yonetim.name, 'Mola Yönetim'); assert.equal(yonetim.theme_color, YONETIM_FILL); assert.equal(yonetim.start_url, '/');
  const yonetimIcons = yonetim.icons as typeof icons;
  for (const [size, purpose] of [['192x192', 'any'], ['256x256', 'any'], ['512x512', 'any'], ['512x512', 'maskable']])
    assert.ok(yonetimIcons.some(i => i.sizes === size && i.purpose === purpose && /^\/icon-yonetim-/.test(i.src)), `Mola Yönetim ${size} ${purpose}`);
  // Every PNG the manifests and pages name is generated (scripts/mola-icons.mjs), with its real size.
  const html = readFileSync('index.html', 'utf8'), merkez = readFileSync('merkez.html', 'utf8');
  const named = [...icons, ...yonetimIcons].filter(i => i.type === 'image/png').map(i => i.src);
  for (const page of [html, merkez, readFileSync('raporlarim.html', 'utf8')]) named.push(...[...page.matchAll(/href="(\/[^"]+\.png)"/g)].map(m => m[1]));
  for (const src of named) assert.ok(Object.hasOwn(WEB_ICONS, src.slice(1)), `${src} is generated`);
  for (const [name, [, size]] of Object.entries(WEB_ICONS)) {
    const meta = await sharp(await webIcon(name)!).metadata();
    assert.equal(meta.format, 'png'); assert.equal(meta.width, size, name); assert.equal(meta.height, size, name);
  }
  // Tab and window icons: sizes declared, pixel-grid 16 and 32 before the vector one and the large ones.
  for (const [page, prefix] of [[html, 'favicon'], [merkez, 'favicon-yonetim']]) {
    const order = [`sizes="16x16" href="/${prefix}-16.png"`, `sizes="32x32" href="/${prefix}-32.png"`, `sizes="any" href="/${prefix}.svg"`, 'sizes="192x192"', 'sizes="512x512"'].map(s => page.indexOf(s));
    assert.ok(order.every(i => i > 0), `${prefix}: ${order}`); assert.deepEqual([...order].sort((a, b) => a - b), order, `${prefix}: order`);
  }
  assert.ok(merkez.includes('rel="manifest" href="/manifest-yonetim.webmanifest"'));
  // Café green and Mola Yönetim near-black stay apart at every size.
  for (const [cafe, vendor] of [['favicon-16.png', 'favicon-yonetim-16.png'], ['favicon-32.png', 'favicon-yonetim-32.png'], ['icon-192.png', 'icon-yonetim-192.png'], ['icon-512.png', 'icon-yonetim-512.png']]) {
    const middleBottom = async (name: string) => { const { data, info } = await sharp(await webIcon(name)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); const at = ((info.height - 2) * info.width + info.width / 2) * 4; return [...data.subarray(at, at + 3)].map(v => v.toString(16).padStart(2, '0')).join(''); };
    assert.equal(`#${await middleBottom(cafe)}`, '#234c3e', cafe); assert.equal(`#${await middleBottom(vendor)}`, YONETIM_FILL, vendor);
  }
  // Maskable and apple-touch-icon fill the square (Android crops them, iOS shows transparency black).
  for (const name of ['icon-maskable-512.png', 'icon-yonetim-maskable-512.png', 'apple-touch-icon.png']) {
    const { data } = await sharp(await webIcon(name)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 255, `${name} corner is opaque`);
  }
  for (const tag of ['name="apple-mobile-web-app-capable" content="yes"', 'name="apple-mobile-web-app-status-bar-style"', 'name="apple-mobile-web-app-title" content="Mola"', 'rel="apple-touch-icon" sizes="180x180"', 'rel="manifest" href="/manifest.webmanifest"', 'viewport-fit=cover'])
    assert.ok(html.includes(tag), tag);
  // Browser tab icons: the pixel-aligned 32-px drawing (sharp at tab size), green for cafés, near-black for Mola Yönetim.
  assert.equal(readFileSync('public/favicon.svg', 'utf8'), iconSvg.small());
  assert.equal(readFileSync('public/favicon-yonetim.svg', 'utf8'), iconSvg.small(YONETIM_FILL));
  assert.ok(readFileSync('merkez.html', 'utf8').includes('href="/favicon-yonetim.svg"'));
  // No service worker: nothing may ever cache the API (orders must be live).
  assert.equal(existsSync('public/sw.js'), false);
  // Development serving lets the icons through (and nothing else new).
  const app = express(); devAllowList(app, 'index.html'); app.use((req, res) => res.end(`ok ${req.path}`));
  const server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const port = (server.address() as AddressInfo).port;
    for (const path of ['/icon-maskable-512.png', '/icon-maskable-192.png', '/apple-touch-icon.png', '/manifest.webmanifest', '/favicon-16.png', '/favicon-yonetim-16.png', '/icon-256.png', '/icon-yonetim-192.png', '/icon-yonetim-maskable-512.png', '/manifest-yonetim.webmanifest'])
      assert.equal((await get(port, path)).status, 200, path);
    for (const path of ['/icon-maskable-1024.png', '/icon-yonetim-1024.png', '/favicon-64.png', '/manifest-baska.webmanifest']) assert.equal((await get(port, path)).status, 404, path);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});

test('Android version code follows package.json', () => {
  assert.equal(versionCode('0.1.0'), 100); assert.equal(versionCode('1.2.3'), 10203); assert.equal(versionCode('2.0.0'), 20000);
  assert.throws(() => versionCode('0.0.0')); assert.throws(() => versionCode('1.100.0'));
});

test('built Mola.apk: package, version, permissions and signature (skipped when the APK or the Android SDK is missing)', t => {
  const tools = androidTools(), apk = resolve('.local/android/Mola.apk');
  if ('missing' in tools && tools.missing) return t.skip(`Android SDK yok: ${tools.missing.join(', ')}`);
  if (!existsSync(apk)) return t.skip('Önce npm run apk');
  const tool = tools as Exclude<typeof tools, { missing: string[] }>;
  // aapt2 dislikes non-ASCII folder names: the check reads a copy in the temp folder.
  const copy = join(mkdtempSync(join(tmpdir(), 'mola-apk-check-')), 'Mola.apk'); copyFileSync(apk, copy);
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const info = badging(tool, copy);
  assert.equal(info.package, PACKAGE); assert.equal(info.package, 'com.merkutstudios.mola');
  assert.equal(info.versionName, version); assert.equal(info.versionCode, versionCode(version));
  assert.equal(info.label, 'Mola'); assert.equal(info.minSdk, 24);
  // CAMERA: only for "QR okut" (the vardiya code) and the product photo camera; asked when first used.
  assert.deepEqual(info.permissions.sort(), ['android.permission.ACCESS_NETWORK_STATE', 'android.permission.CAMERA', 'android.permission.INTERNET']);
  assert.match(info.text, /launchable-activity: name='com\.merkutstudios\.mola\.MainActivity'/);
  const proof = verifySignature(tool, copy);
  assert.match(proof, /^Verifies/m); assert.match(proof, /Verified using v2 scheme \(APK Signature Scheme v2\): true/);
});
