import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { Product } from '../packages/domain/types.js';
import { sectors } from '../packages/domain/sector.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { buildMirror } from '../server/menu-mirror.js';
import { sectorTemplate } from '../server/sector-templates.js';
import { Store } from '../server/store.js';
import { SHARED_TEMPLATE_PHOTOS, TEMPLATE_PHOTO_DIR, addTemplatePhotos, templatePhotoName } from '../server/template-photos.js';
import type { ApplicationForm } from '../server/sync-protocol.js';
import { client, licensed, merkezPair, temp } from './merkez-fixture.js';

/* Hazır şablon görselleri (server/template-photos.ts): the starter menus' product photos, given to a business made from a template. */
process.env.MOLA_APPLICATION_POLL_MS = '0';
const rid = () => randomUUID().replace(/-/g, '');
const folder = resolve(TEMPLATE_PHOTO_DIR);
const PHOTO = /^\/media\/([a-zA-Z0-9_-]+)\/([a-f0-9-]{36})\.webp$/;
const file = (directory: string, photo: string, small = false) => { const m = PHOTO.exec(photo)!; return join(directory, 'media', m[1], `${m[2]}${small ? '-small' : ''}.webp`); };

test('the image files: 800×800 and 320×320 WebP without metadata, at most 150 KB, each kept once and used by a template product', async () => {
  const files = readdirSync(folder).sort(), names = files.filter(f => !f.endsWith('-small.webp')).map(f => f.slice(0, -5));
  assert.equal(names.length, 41, `${names.length} images`);
  assert.deepEqual(files, names.flatMap(n => [`${n}-small.webp`, `${n}.webp`]).sort(), 'every image with its thumbnail, nothing else');
  for (const name of names) for (const [suffix, size] of [['', 800], ['-small', 320]] as const) {
    const path = join(folder, `${name}${suffix}.webp`), meta = await sharp(path).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['webp', size, size], path);
    assert.ok(!meta.exif && !meta.icc && !meta.xmp, `${path}: no metadata`);
    assert.ok(statSync(path).size <= 150 * 1024, `${path}: ${statSync(path).size} bytes`);
  }
  const used = new Set(sectors.flatMap(s => sectorTemplate(s).products.map(p => templatePhotoName(p.id))));
  assert.deepEqual(names.filter(n => !used.has(n)), [], 'no image without a product');
  // Shared photos are stored once: the tea of all three menus is tea.webp, never d-cay.webp or r-cay.webp.
  for (const [id, name] of Object.entries(SHARED_TEMPLATE_PHOTOS)) { assert.ok(!names.includes(id), `${id} uses ${name}.webp`); assert.ok(names.includes(name), name); }
});

test('a business from each template: every product gets its own copy of its image (the upload layout)', t => {
  const directory = temp('template-photos'); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const expected = Object.fromEntries(sectors.map(s => [s, sectorTemplate(s).products.map(p => p.id)])) as Record<typeof sectors[number], string[]>;
  assert.equal(Object.values(expected).flat().length, 47, 'all 47 starter products');
  for (const sector of sectors) {
    const tenant = `sablon-${sector}`, products = structuredClone(sectorTemplate(sector).products);
    assert.equal(addTemplatePhotos(directory, tenant, products), expected[sector].length, sector);
    assert.deepEqual(products.filter(p => p.photo).map(p => p.id), expected[sector], sector);
    for (const p of products.filter(p => p.photo)) {
      assert.equal(PHOTO.exec(p.photo!)?.[1], tenant, p.id);
      const name = templatePhotoName(p.id)!;
      assert.deepEqual(readFileSync(file(directory, p.photo!)), readFileSync(join(folder, `${name}.webp`)), p.id);
      assert.deepEqual(readFileSync(file(directory, p.photo!, true)), readFileSync(join(folder, `${name}-small.webp`)), p.id);
    }
    // One file pair per product (as if each were uploaded): removing one product's photo never touches another's.
    assert.equal(new Set(products.map(p => p.photo).filter(Boolean)).size, expected[sector].length);
    assert.equal(readdirSync(join(directory, 'media', tenant)).length, expected[sector].length * 2);
  }
  // The same photo for the tea of the dessert shop and the café's tea.
  const tea = (sector: 'cafe' | 'dessert' | 'restaurant', id: string) => { const products = structuredClone(sectorTemplate(sector).products); addTemplatePhotos(directory, `cay-${sector}`, products); return readFileSync(file(directory, products.find(p => p.id === id)!.photo!)); };
  assert.deepEqual(tea('dessert', 'd-cay'), tea('cafe', 'tea')); assert.deepEqual(tea('restaurant', 'r-cay'), tea('cafe', 'tea'));
  // A product that already has a photo keeps it; no image folder, a bad business id or an unwritable place: nothing breaks.
  const own: Product[] = [{ ...structuredClone(sectorTemplate('cafe').products[0]), photo: '/media/x/11111111-1111-1111-1111-111111111111.webp' }];
  assert.equal(addTemplatePhotos(directory, 'x', own), 0); assert.equal(own[0].photo, '/media/x/11111111-1111-1111-1111-111111111111.webp');
  const plain = structuredClone(sectorTemplate('cafe').products);
  assert.equal(addTemplatePhotos(directory, 'y', plain, join(directory, 'yok')), 0); assert.ok(plain.every(p => !p.photo));
  assert.equal(addTemplatePhotos(directory, '../y', plain), 0); assert.ok(plain.every(p => !p.photo));
  const blocked = join(directory, 'blocked'); mkdirSync(blocked); writeFileSync(join(blocked, 'media'), 'not a folder');
  assert.equal(addTemplatePhotos(blocked, 'z', plain), 0); assert.ok(plain.every(p => !p.photo), 'drawings stay');
});

test('a new business (Merkez approval, owner account): the café photos at once; the sector\'s menu at setup brings its own; guests and the internet menu get them', async t => {
  const pair = await merkezPair('template-photos'); t.after(() => pair.close());
  await pair.adminLogin();
  const form = (name: string): ApplicationForm => ({ businessName: name, sector: 'cafe', contactName: 'Ayşe Yılmaz', consent: true,
    invoice: { legalName: `${name} Gıda Ltd. Şti.`, taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1234567890', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 1', phone: '+905321234567', email: 'ayse@example.com' } });
  await pair.link.apply(form('Fotoğraflı Kafe'));
  const tenantId = (await pair.admin('/state')).data.businesses[0].tenantId;
  assert.equal((await pair.admin('/applications/approve', { requestId: rid(), tenantId })).status, 200);
  await pair.link.checkApplication();
  const kafe = pair.kafe();
  assert.equal((await kafe('/activation/owner', { username: 'ayse', password: 'AyseKafe!2026' })).status, 200);
  const made = pair.store.read(tenantId);
  assert.deepEqual(made.products.filter(p => p.photo).map(p => p.id), ['latte', 'americano', 'turkish', 'tea', 'herbal', 'lemonade', 'cheesecake', 'brownie']);
  assert.equal(made.menuRevision, 1, 'still the untouched starter menu (setup may replace it)');
  for (const p of made.products.filter(p => p.photo)) assert.ok(existsSync(file(pair.store.directory, p.photo!)) && existsSync(file(pair.store.directory, p.photo!, true)), p.id);
  // The owner sees them in the menu; a guest at a table gets them in the menu and from /media.
  let state = (await kafe('/staff/state')).data;
  assert.equal(state.products.find((p: Product) => p.id === 'latte').photo, made.products.find(p => p.id === 'latte')!.photo);
  const guest = client(`${pair.kafeBase}/api`);
  assert.equal((await guest('/guest/session', { token: made.tables[0].token })).status, 200);
  const menu = (await guest('/guest/state')).data;
  const latte = menu.products.find((p: Product) => p.id === 'latte');
  assert.match(latte.photo, PHOTO); assert.ok(menu.products.every((p: Product) => p.photo && PHOTO.test(p.photo)), 'every product with its photo');
  for (const path of [latte.photo, latte.photo.replace('.webp', '-small.webp')]) {
    const r = await fetch(pair.kafeBase + path); assert.equal(r.status, 200, path); assert.equal(r.headers.get('content-type'), 'image/webp');
  }
  // The internet menu's copy carries the photo files like uploaded ones.
  const { menu: copy, files } = buildMirror(pair.store.read(tenantId), pair.store.directory, { menuOnly: false, demo: false, social: true, popular: [] });
  assert.equal(copy.products.filter(p => p.photo).length, 8); assert.equal(files.size, 16);
  // Setup as a dessert shop: its starter menu, every product with its photo; the café's copies are left unused (photo cleaning).
  state = (await kafe('/staff/state')).data;
  const setup = await kafe('/staff/setup', { requestId: rid(), version: state.businessRevision ?? 0, name: 'Fotoğraflı Tatlıcı', sector: 'dessert', tableCount: 4, changeSeconds: 60, commissionBps: null });
  assert.equal(setup.status, 200); assert.equal(setup.data.menuLoaded, true);
  const dessert = pair.store.read(tenantId);
  assert.equal(dessert.products.length, 19); assert.ok(dessert.products.every(p => p.photo && existsSync(file(pair.store.directory, p.photo))), 'all 19 with a photo');
  assert.equal(readdirSync(join(pair.store.directory, 'media', tenantId)).length, (8 + 19) * 2);
  // The owner may replace or remove one like any photo: removing it leaves the drawing.
  const owner = (await kafe('/staff/state')).data, kazandibi = owner.products.find((p: Product) => p.id === 'd-kazandibi');
  const { id: _id, discounts: _d, firstPublishedAt: _f, ...fields } = kazandibi;
  const saved = await kafe('/staff/products', { requestId: randomUUID(), revision: owner.revision, id: kazandibi.id, product: { ...fields, photo: null } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(pair.store.read(tenantId).products.find(p => p.id === 'd-kazandibi')!.photo ?? null, null);
});

test('existing businesses never change: a stored menu, a reopened data folder and a later setup keep their drawings', async t => {
  const directory = temp('template-photos-existing');
  let store = new Store(directory);
  const before = store.read('mola-demo').products;
  assert.ok(before.every(p => !p.photo), 'the development demo seed is not made from a template');
  store.close(); store = new Store(directory); licensed(store);
  assert.deepEqual(store.read('mola-demo').products, before, 'opening the folder with this version adds nothing');
  assert.equal(existsSync(join(directory, 'media')), false);
  const server = createServer(createApp(store)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const api = client(`http://127.0.0.1:${(server.address() as { port: number }).port}/api`);
  assert.equal((await api('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  // Setup as a café keeps the menu it has (no template load, no photos).
  const state = (await api('/staff/state')).data;
  const setup = await api('/staff/setup', { requestId: rid(), version: state.businessRevision ?? 0, name: 'Eski Kafe', sector: 'cafe', tableCount: 12, changeSeconds: 60, commissionBps: null });
  assert.equal(setup.status, 200); assert.equal(setup.data.menuLoaded, false);
  assert.deepEqual(store.read('mola-demo').products, before); assert.equal(existsSync(join(directory, 'media')), false);
});

test('packages carry the images: the installer copies them into app/ before its file list, the pilot package has templates/', () => {
  const build = readFileSync('scripts/build-installer.mjs', 'utf8'), app = build.slice(build.indexOf('async function appFolder'), build.indexOf('function writeManifest'));
  assert.match(app, /copyTree\('templates\/gorseller', join\(appDir, 'templates', 'gorseller'\)\)/);
  assert.ok(app.indexOf("copyTree('templates/gorseller'") < app.indexOf('writeManifest(appDir)'), 'listed (with hashes) in manifest.json');
  // The installed server runs in app/ (Mola-Sunucu.cmd, nobetci.mjs): the relative folder is found there.
  assert.match(readFileSync('scripts/desktop/mola-sunucu-cmd.mjs', 'utf8'), /cd \/d "%~dp0app"/);
  assert.match(readFileSync('scripts/desktop/nobetci.mjs', 'utf8'), /cwd: join\(root, 'app'\)/);
  assert.match(readFileSync('scripts/pilot-package.mjs', 'utf8'), /'templates'/);
});
