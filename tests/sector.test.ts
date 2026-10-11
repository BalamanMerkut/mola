import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { sectorTemplate, sectorTemplateFiles } from '../server/sector-templates.js';
import { artForCategory, sectorSlogan, sectors } from '../packages/domain/sector.js';
import { menuNameEn } from '../packages/domain/menu-translation.js';

test('starter menu files equal the menus setup loads; every product is valid and sector-typed', () => {
  for (const sector of sectors) {
    const t = sectorTemplate(sector);
    assert.deepEqual(JSON.parse(readFileSync(sectorTemplateFiles[sector], 'utf8')), JSON.parse(JSON.stringify(t)), `${sectorTemplateFiles[sector]}: run npm run template:backup`);
    assert.equal(new Set(t.products.map(p => p.code)).size, t.products.length); assert.equal(new Set(t.products.map(p => p.id)).size, t.products.length);
    for (const p of t.products) {
      assert.ok(t.categories.includes(p.category), p.name); assert.ok(/^\d{1,5}$/.test(p.code)); assert.ok(p.nameEn.trim(), `${p.name} has an English name`);
      assert.ok(p.price >= 1 && p.price <= 1_000_000); assert.ok(p.price + p.groups.reduce((n, g) => n + Math.min(...g.options.map(o => o.extra), ...(g.required ? [] : [0])), 0) >= 1, `${p.name} never drops below 0,01 TL`);
      assert.ok(p.published && !p.soldOut);
    }
    // The guest's English menu translates every category and subcategory.
    for (const c of t.subcategories) { assert.notEqual(menuNameEn([], c.category), c.category); for (const n of c.names) assert.notEqual(menuNameEn([], c.category, n), n, n); }
  }
  const restaurant = sectorTemplate('restaurant'), dessert = sectorTemplate('dessert');
  assert.ok(['soup', 'burger', 'food'].every(art => restaurant.products.some(p => p.art === art)));
  assert.ok(restaurant.products.some(p => p.groups.length));
  const kg = dessert.products.filter(p => p.unit === 'kg').map(p => p.name).join(', ');
  for (const name of ['Baklava', 'Kurabiye', 'Lokum']) assert.match(kg, new RegExp(name));
  assert.ok(dessert.products.filter(p => p.unit === 'kg').every(p => p.groups.some(g => g.options.some(o => o.name === 'Hediye kutusu'))), 'gift boxes for weighed sweets');
});

test('product art and slogans follow the kind of business', () => {
  assert.deepEqual(['Kahveler', 'Çaylar', 'Soğuk İçecekler', 'Tatlılar', 'Çorbalar', 'Burgerler', 'Ana Yemekler', 'Baklavalar', 'Lokumlar', 'Kahvaltı', ''].map(artForCategory), ['coffee', 'tea', 'cold', 'cake', 'soup', 'burger', 'food', 'sweet', 'sweet', 'food', 'food']);
  assert.equal(sectorSlogan(undefined), 'Her zaman iyi bir mola.'); assert.equal(sectorSlogan('cafe', true), 'A good break, every time.');
  assert.notEqual(sectorSlogan('restaurant'), sectorSlogan('cafe')); assert.notEqual(sectorSlogan('dessert', true), sectorSlogan('cafe', true));
  // The product login and title speak of any business, not only cafés; the brand stays.
  const login = readFileSync('src/Workspace.tsx', 'utf8');
  assert.ok(!login.includes('İyi kahve.') && login.includes('Kolay işletme.')); assert.match(readFileSync('index.html', 'utf8'), /<title>Mola · İşletme yönetimi<\/title>/);
  for (const file of ['src/Customer.tsx', 'src/MenuPreview.tsx']) assert.ok(!readFileSync(file, 'utf8').includes('Her zaman iyi bir mola'), `${file} uses the sector slogan`);
});

test('HTTP: setup loads the chosen starter menu once; later the type is only a label', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/sector-')), store = new Store(directory);
  licensed(store); const server = createServer(createApp(store)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const client = () => { let cookie = ''; return async (path: string, body?: unknown) => { const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0]; return { status: r.status, data: await r.json() as any }; }; };
  const restaurant = client(), cafe = client();
  assert.equal((await restaurant('/login', { username: 'diger', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await cafe('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  let state = (await restaurant('/staff/state')).data;
  assert.equal(state.starterMenu, true); assert.equal(state.sector, 'cafe'); assert.equal('takeawayEnabled' in state, false);
  const setup = await restaurant('/staff/setup', { requestId: randomUUID(), version: state.businessRevision ?? 0, name: 'Harput Sofrası', sector: 'restaurant', tableCount: 12, changeSeconds: 60, commissionBps: null });
  assert.equal(setup.status, 200); assert.equal(setup.data.menuLoaded, true);
  const saved = store.read('other-demo'), template = sectorTemplate('restaurant');
  assert.equal(saved.sector, 'restaurant'); assert.equal(saved.takeawayEnabled, undefined, 'no sector default: masasız sales need no setting'); assert.equal(saved.waiterApproval, false);
  assert.deepEqual(saved.products.map(p => p.id), template.products.map(p => p.id)); assert.deepEqual(saved.categories, template.categories);
  assert.equal(saved.menuHero?.icon, 'food'); assert.equal(saved.tables.length, 12);
  state = (await restaurant('/staff/state')).data;
  assert.equal(state.starterMenu, undefined); assert.ok(state.categories.includes('Çorbalar'));
  const guest = await fetch(`${base}/guest/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: saved.tables[0].token }) });
  const session = await guest.json() as { session: string }, cookie = guest.headers.getSetCookie()[0].split(';')[0];
  const menu = await (await fetch(`${base}/guest/state`, { headers: { 'X-Guest-Session': session.session, Cookie: cookie } })).json() as any;
  assert.equal(menu.sector, 'restaurant'); assert.ok(menu.products.some((p: any) => p.art === 'soup'));
  // Later the owner may relabel the business: the menu and every other setting stay exactly as they were.
  const revision = saved.menuRevision;
  assert.equal((await restaurant('/staff/settings', { sector: 'dessert', changeSeconds: 60, commissionBps: null })).status, 200);
  const relabelled = store.read('other-demo');
  assert.equal(relabelled.sector, 'dessert'); assert.equal(relabelled.menuRevision, revision); assert.deepEqual(relabelled.products, saved.products);
  // An old screen may still send the removed switch: accepted, ignored.
  assert.equal((await restaurant('/staff/settings', { takeawayEnabled: false, changeSeconds: 60, commissionBps: null })).status, 200);
  assert.equal(store.read('other-demo').takeawayEnabled, undefined);
  // A business that already sold keeps its menu even when it picks another type; no type given stays a café.
  assert.equal((await cafe('/staff/orders', { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 3500, lines: [{ productId: 'tea', quantity: 1, selections: [] }] })).status, 200);
  const before = store.read('mola-demo');
  const kept = await cafe('/staff/setup', { requestId: randomUUID(), version: before.businessRevision ?? 0, name: 'Mola Tatlı', sector: 'dessert', tableCount: 12, changeSeconds: 60, commissionBps: null });
  assert.equal(kept.data.menuLoaded, false);
  const after = store.read('mola-demo');
  assert.deepEqual(after.products, before.products); assert.equal(after.sector, 'dessert');
  assert.equal((await cafe('/staff/settings', { sector: 'pizzeria', changeSeconds: 60, commissionBps: null })).status, 400);
});
