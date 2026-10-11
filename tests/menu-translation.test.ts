import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { changeCategories, menuNamesEn, type CategoryChange } from '../packages/domain/categories.js';
import { groupNameEn, lineNameEn, lineOptionNamesEn, menuLabelEn, menuLabelKey, menuLabelSuggestion, menuNameEn, optionLabelEn, optionLabelSuggestion, optionNameEn, productTextEn } from '../packages/domain/menu-translation.js';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { Store } from '../server/store.js';
import { sectorTemplate } from '../server/sector-templates.js';

test('option dictionary covers café, restaurant and dessert choices, reads the group for context and keeps unknown Turkish', () => {
  for (const [tr, en] of [['Boy', 'Size'], ['SÜT TERCİHİ', 'Milk'], ['Seker tercihi', 'Sugar'], ['Servis tercihi', 'Serving'], ['İç harcı', 'Filling'], ['Acı tercihi', 'Spice level'], ['Pişme derecesi', 'Doneness'], ['Porsiyon', 'Portion'], ['Paketleme', 'Packaging'], ['Ekstra', 'Extras'], ['Yanında', 'On the side'], ['Ekmek seçimi', 'Bread'], ['Sos', 'Sauce'], ['Sıcaklık', 'Temperature'], ['Tatlılık', 'Sweetness'], ['Soğan', 'Onion']]) assert.equal(optionLabelEn(tr), en, tr);
  for (const [tr, en] of [['Standart', 'Standard'], ['Büyük boy', 'Large'], ['Yulaf sütü', 'Oat milk'], ['Laktozsuz süt', 'Lactose-free milk'], ['Soğansız', 'No onion'], ['Sarımsaksız', 'No garlic'], ['Dondurmalı', 'With ice cream'], ['Hediye kutusu', 'Gift box'], ['Yarım porsiyon', 'Half portion'], ['Az pişmiş', 'Rare'], ['İyi pişmiş', 'Well done'], ['Acılı', 'Spicy'], ['Tam buğday ekmeği', 'Wholewheat bread'], ['Buzsuz', 'No ice'], ['Ekstra köfte', 'Extra patty'], ['Frambuazlı', 'Raspberry'], ['  çift   shot ', 'Double']]) assert.equal(optionLabelEn(tr), en, tr);
  // Same word, different group: Turkish coffee "Sade" has no sugar, a dessert served "Sade" is plain; "Orta" depends on the question.
  assert.equal(optionLabelEn('Sade', undefined, 'Şeker tercihi'), 'No sugar'); assert.equal(optionLabelEn('Sade', undefined, 'Servis tercihi'), 'Plain');
  assert.equal(optionLabelEn('Orta', undefined, 'Şeker tercihi'), 'Medium sweet'); assert.equal(optionLabelEn('Şekerli', undefined, 'Şeker'), 'Sweet'); assert.equal(optionLabelEn('Şekerli'), 'With sugar');
  assert.equal(optionLabelEn('Orta', undefined, 'Acı derecesi'), 'Medium spicy'); assert.equal(optionLabelEn('Orta', undefined, 'Pişme derecesi'), 'Medium'); assert.equal(optionLabelEn('Standart', undefined, 'Boy'), 'Regular');
  assert.equal(optionLabelEn('Açık', undefined, 'Açıklama'), 'Light'); // "Açık…" is not the spice group
  assert.equal(optionLabelEn('4 kişilik'), 'Serves 4'); assert.equal(optionLabelEn('2 top'), '2 scoops'); assert.equal(optionLabelEn('1 top'), '1 scoop');
  // Category dictionary and option dictionary stay apart: "Porsiyon" the category lists single portions.
  assert.equal(menuLabelEn('Porsiyon'), 'Single portions'); assert.equal(optionLabelEn('Porsiyon'), 'Portion');
  assert.equal(optionLabelSuggestion('Ev usulü harç'), undefined); assert.equal(optionLabelEn('Ev usulü harç'), 'Ev usulü harç'); assert.equal(optionLabelEn('Kaşarlı ve sucuklu'), 'Kaşarlı ve sucuklu');
  // Owner's English wins; blank falls back.
  const group = { name: 'Süt tercihi', nameEn: '  Milk choice ', options: [{ id: 'oat', name: 'Yulaf sütü', nameEn: 'Oat (barista)' }, { id: 'soy', name: 'Soya sütü', nameEn: '  ' }, { id: 'x', name: 'Ev sütü' }] };
  assert.equal(groupNameEn(group), 'Milk choice'); assert.deepEqual(group.options.map(o => optionNameEn(group, o)), ['Oat (barista)', 'Soy milk', 'Ev sütü']);
  assert.equal(groupNameEn({ name: 'Boy', nameEn: '' }), 'Size');
  assert.deepEqual(productTextEn({ name: 'Sütlaç', nameEn: 'Rice pudding', description: 'Fırında', descriptionEn: ' Baked ', ingredients: 'Süt', ingredientsEn: '' }), { name: 'Rice pudding', description: 'Baked', ingredients: 'Süt' });
  assert.deepEqual(productTextEn({ name: 'Sütlaç', nameEn: '', description: 'Fırında' }), { name: 'Sütlaç', description: 'Fırında', ingredients: undefined });
});

test('saved order lines translate at render time without touching the Turkish kitchen text', () => {
  const s = seed(), latte = s.products.find(p => p.id === 'latte')!, turkish = s.products.find(p => p.id === 'turkish')!;
  latte.groups[1].nameEn = 'Milk'; latte.groups[1].options[0].nameEn = 'Oat (barista)';
  const line = { productId: 'latte', name: 'Caffè Latte', selections: [{ groupId: 'size', optionId: 'large' }, { groupId: 'milk', optionId: 'oat' }], optionNames: ['Büyük boy', 'Yulaf sütü'] };
  assert.deepEqual(lineOptionNamesEn(line, s.products), ['Large', 'Oat (barista)']);
  assert.deepEqual(lineOptionNamesEn({ productId: 'turkish', name: 'Türk Kahvesi', selections: [{ groupId: 'sugar', optionId: 'none' }], optionNames: ['Sade'] }, s.products), ['No sugar']);
  assert.equal(lineNameEn({ productId: 'turkish', name: 'Türk Kahvesi' }, s.products), 'Turkish Coffee');
  // Option renamed after the order: the dictionary reads the saved name, not the new option. Product gone: still the dictionary.
  latte.groups[1].options[0].name = 'Badem sütü';
  assert.deepEqual(lineOptionNamesEn(line, s.products), ['Large', 'Oat milk']);
  assert.deepEqual(lineOptionNamesEn(line, []), ['Large', 'Oat milk']); assert.equal(lineNameEn(line, []), 'Caffè Latte');
  turkish.name = 'Dibek kahvesi'; assert.equal(lineNameEn({ productId: 'turkish', name: 'Türk Kahvesi' }, s.products), 'Türk Kahvesi');
  assert.deepEqual(line.optionNames, ['Büyük boy', 'Yulaf sütü']);
});

test('starter menus read in English: every option group and option of the three sectors has an English label', () => {
  for (const sector of ['cafe', 'restaurant', 'dessert'] as const) for (const p of sectorTemplate(sector).products) {
    if (sector !== 'cafe') assert.ok(p.descriptionEn?.trim(), `${sector} ${p.name} description`);
    for (const g of p.groups) { assert.notEqual(groupNameEn(g), g.name, `${sector} ${g.name}`); for (const o of g.options) assert.notEqual(optionNameEn(g, o), o.name, `${sector} ${g.name}: ${o.name}`); }
  }
});

test('product save validates and stores the optional English fields', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.local/tests/menu-english-')), store = new Store(directory);
  licensed(store); const server = createServer(createApp(store)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`; let cookie = '';
  const call = async (path: string, body: unknown) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) }); if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0]; return { status: r.status, data: await r.json() as any }; };
  assert.equal((await call('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  const product = { code: '88', name: 'Fırın Sütlaç', nameEn: 'Baked rice pudding', category: 'Tatlılar', description: 'Fırında.', descriptionEn: '  Oven-baked.  ', ingredients: 'Süt', ingredientsEn: 'Milk, rice', price: 12000, soldOut: false, art: 'cake', photo: null, groups: [{ id: 'serve', name: 'Servis', nameEn: ' Topping ', required: false, options: [{ id: 'plain', name: 'Sade', nameEn: '', extra: 0 }, { id: 'ice', name: 'Dondurmalı', nameEn: 'With a scoop', extra: 2500 }] }] };
  // Lengths follow the Turkish fields: description 240, ingredients 500, group and option names 60.
  for (const bad of [{ descriptionEn: 'x'.repeat(241) }, { ingredientsEn: 'x'.repeat(501) }, { descriptionEn: 5 }, { groups: [{ ...product.groups[0], nameEn: 'x'.repeat(61) }] }, { groups: [{ ...product.groups[0], options: [{ ...product.groups[0].options[0], nameEn: 'x'.repeat(61) }] }] }]) assert.equal((await call('/staff/products', { product: { ...product, ...bad } })).status, 400, JSON.stringify(bad).slice(0, 60));
  assert.equal((await call('/staff/products', { product: { ...product, descriptionEn: 'x'.repeat(240), code: '89' } })).status, 200);
  assert.equal((await call('/staff/products', { product })).status, 200);
  let saved = store.read('mola-demo').products.find(p => p.code === '88')!;
  assert.equal(saved.descriptionEn, 'Oven-baked.'); assert.equal(saved.ingredientsEn, 'Milk, rice'); assert.equal(saved.groups[0].nameEn, 'Topping');
  assert.equal(saved.groups[0].options[0].nameEn, undefined); assert.equal(saved.groups[0].options[1].nameEn, 'With a scoop');
  // Clearing a field drops it, so the dictionary or the Turkish text shows again.
  assert.equal((await call('/staff/products', { id: saved.id, product: { ...product, descriptionEn: ' ', groups: [{ ...product.groups[0], nameEn: '' }] } })).status, 200);
  saved = store.read('mola-demo').products.find(p => p.code === '88')!;
  assert.equal(saved.descriptionEn, undefined); assert.equal(saved.groups[0].nameEn, undefined); assert.equal(groupNameEn(saved.groups[0]), 'Serving');
  assert.equal(productTextEn(saved).description, 'Fırında.');
});

test('dictionary normalises spacing, case, NFC and missing Turkish letters; unknown labels stay Turkish', () => {
  for (const [tr, en] of [['Kahvaltı', 'Breakfast'], ['  ATIŞTIRMALIKLAR ', 'Snacks'], ['Sıcak  kahveler', 'Hot coffees'], ['Soğuk Kahveler', 'Iced coffees'], ['IZGARALAR', 'Grills'], ['Tatlilar', 'Desserts'], ['Espresso bazlı', 'Espresso-based'], ['Şerbetli tatlılar', 'Desserts in syrup'], ['Sütlü', 'With milk'], ['Çocuk menüsü', "Kids' menu"], ['Su ve maden suyu', 'Water & mineral water'], ['Kahveler', 'Coffee'], ['Soğuk İçecekler', 'Cold drinks'], ['Tümü', 'All']]) assert.equal(menuLabelEn(tr), en, tr);
  // Decomposed ş/ç/ğ (macOS keyboards, copy-paste) read the same as the composed letters.
  assert.equal(menuLabelEn('Kahvaltı'.normalize('NFD')), 'Breakfast'); assert.equal(menuLabelEn('Başlangıçlar'.normalize('NFD')), 'Starters');
  assert.equal(menuLabelKey(' İçecekler '), 'icecekler'); assert.equal(menuLabelKey('ICECEKLER'), 'icecekler');
  assert.equal(menuLabelSuggestion('Ev yapımı mantı'), undefined); assert.equal(menuLabelEn('Ev yapımı mantı'), 'Ev yapımı mantı');
  assert.equal(menuLabelEn('Kahvaltı', '  Brunch '), 'Brunch'); assert.equal(menuLabelEn('Kahvaltı', '   '), 'Breakfast');
  const names = [{ category: 'Tatlılar', name: 'Sweets' }, { category: 'Tatlılar', subtype: 'Sütlü', name: 'Milk puddings' }];
  assert.equal(menuNameEn(names, 'Tatlılar'), 'Sweets'); assert.equal(menuNameEn(names, 'Tatlılar', 'Sütlü'), 'Milk puddings');
  assert.equal(menuNameEn(names, 'Kahveler', 'Sütlü'), 'With milk'); assert.equal(menuNameEn(undefined, 'Kahvaltı'), 'Breakfast');
});

test('english category action validates, follows rename/remove and retries once', () => {
  const s = seed(), owner = { tenantId: s.tenantId, id: 'owner', role: 'owner' as const }, ctx = { now: new Date(), id: randomUUID };
  s.products.find(p => p.id === 'tea')!.subtype = 'Demleme';
  const change = (b: Partial<CategoryChange>): CategoryChange => ({ requestId: randomUUID(), revision: s.menuRevision, action: 'english', name: 'Çaylar', ...b });
  for (const actor of [{ ...owner, role: 'waiter' as const }, { ...owner, tenantId: 'other' }]) assert.throws(() => changeCategories(s, actor, change({ nextName: 'Teas' }), ctx));
  for (const b of [change({ nextName: 'x'.repeat(61) }), change({ subtype: 'Demleme', nextName: 'x'.repeat(81) }), change({ nextName: ' ALL ' }), change({ subtype: 'Demleme', nextName: 'all types' }), change({ name: 'Yok', nextName: 'X' }), change({ subtype: 'Yok', nextName: 'X' }), change({ revision: 0, nextName: 'X' })]) assert.throws(() => changeCategories(s, owner, b, ctx));
  assert.equal(s.categoryNamesEn, undefined);
  const b = change({ nextName: '  Tea  selection ' }), first = changeCategories(s, owner, b, ctx), revision = s.menuRevision;
  assert.deepEqual(changeCategories(s, owner, b, ctx), first); assert.equal(s.menuRevision, revision);
  assert.deepEqual(first.namesEn, [{ category: 'Çaylar', name: 'Tea selection' }]);
  changeCategories(s, owner, change({ subtype: 'Demleme', nextName: 'Slow brew' }), ctx);
  changeCategories(s, owner, change({ subtype: 'Demleme', nextName: 'Steeped tea' }), ctx);
  assert.equal(menuNameEn(menuNamesEn(s), 'Çaylar', 'Demleme'), 'Steeped tea'); assert.equal(s.categoryNamesEn!.length, 2);
  // Category rename carries both names; subtype rename carries its own; removal drops it.
  changeCategories(s, owner, change({ action: 'rename', nextName: 'Çay çeşitleri' }), ctx);
  assert.deepEqual(menuNamesEn(s).map(n => [n.category, n.subtype, n.name]), [['Çay çeşitleri', undefined, 'Tea selection'], ['Çay çeşitleri', 'Demleme', 'Steeped tea']]);
  changeCategories(s, owner, change({ action: 'subtype-rename', name: 'Çay çeşitleri', subtype: 'Demleme', nextName: 'Demlik' }), ctx);
  assert.equal(menuNameEn(menuNamesEn(s), 'Çay çeşitleri', 'Demlik'), 'Steeped tea');
  changeCategories(s, owner, change({ action: 'subtype-remove', name: 'Çay çeşitleri', subtype: 'Demlik' }), ctx);
  assert.deepEqual(s.categoryNamesEn, [{ category: 'Çay çeşitleri', name: 'Tea selection' }]);
  // Empty clears the owner's name: the dictionary takes over again.
  changeCategories(s, owner, change({ name: 'Çay çeşitleri', nextName: ' ' }), ctx);
  assert.deepEqual(s.categoryNamesEn, []);
  changeCategories(s, owner, change({ action: 'add', name: 'Kahvaltılar' }), ctx);
  changeCategories(s, owner, change({ name: 'Kahvaltılar', nextName: 'Brunch' }), ctx);
  changeCategories(s, owner, change({ action: 'remove', name: 'Kahvaltılar' }), ctx);
  assert.deepEqual(s.categoryNamesEn, []);
  changeCategories(s, owner, change({ action: 'add', name: 'Kahvaltılar' }), ctx);
  assert.equal(menuNameEn(menuNamesEn(s), 'Kahvaltılar'), 'Breakfast');
  assert.equal(s.audit.filter(a => a.action === 'category.english').length, 5);
});
