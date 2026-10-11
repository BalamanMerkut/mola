import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { seed } from '../server/seed.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { Store } from '../server/store.js';
import { campaignCovers, categoriesPlace, categoryOfferText, discountedPrice, inCategory, saleProducts, type Campaign } from '../packages/domain/campaigns.js';
import { campaignReport } from '../packages/domain/campaign-reports.js';
import { changeCategories } from '../packages/domain/categories.js';
import { submitOrder } from '../packages/domain/engine.js';
import { cartLineTotal } from '../packages/domain/lines.js';
import type { CartLine, Product } from '../packages/domain/types.js';

// "Kampanya neye uygulansın? → Bütün bir bölüm": a campaign over menu categories, resolved when prices are made.
const time = new Date('2026-09-21T12:00:00Z'); // a Monday, 15:00 in Türkiye
const desserts = (extra: Partial<Campaign> = {}): Campaign => ({ id: 'desserts', name: 'Tatlılarda %10 indirim', productIds: [], categories: ['Tatlılar'], percent: 10, startsAt: time.toISOString(), endsAt: null, enabled: true, combine: false, ...extra } as Campaign);
const cake = (id: string, category = 'Tatlılar', extra: Partial<Product> = {}): Product => ({ id, code: id, name: `Pasta ${id}`, nameEn: '', category, description: '', price: 20000, soldOut: false, art: 'cake', groups: [], ...extra });
const price = (s: ReturnType<typeof seed>, id: string, at = time, quantity = 1) => { const p = saleProducts(s, at).find(p => p.id === id)!; return discountedPrice(p, p.price, quantity).price; };

test('category campaign covers every product in the category, later additions too; moved products leave; exclusions stay out', () => {
  const s = seed(); s.campaigns = [desserts()];
  assert.equal(price(s, 'cheesecake'), 17100); assert.equal(price(s, 'brownie'), 14400);
  assert.equal(price(s, 'tea'), 3500, 'other categories keep their price');
  // A dessert added after the campaign was saved is discounted with no edit of the campaign.
  s.products.push(cake('new-cake'));
  assert.equal(price(s, 'new-cake'), 18000);
  // Moved to another category: out of the campaign. Moved back: in again.
  s.products.find(p => p.id === 'new-cake')!.category = 'Kahveler';
  assert.equal(price(s, 'new-cake'), 20000);
  s.products.find(p => p.id === 'new-cake')!.category = 'Tatlılar';
  assert.equal(price(s, 'new-cake'), 18000);
  // "Hariç tut".
  s.campaigns[0].excludedProductIds = ['brownie'];
  assert.equal(price(s, 'brownie'), 16000); assert.equal(price(s, 'cheesecake'), 17100);
  // The guest's offer carries the category so menus can say "Tatlılarda %10 indirim".
  assert.deepEqual(saleProducts(s, time).find(p => p.id === 'cheesecake')!.discounts![0].categories, ['Tatlılar']);
  // Several categories, and a product-list campaign is untouched (no categories key at all).
  s.campaigns = [desserts({ categories: ['Tatlılar', 'Çaylar'] }), { id: 'old', name: 'Eski', productIds: ['latte'], percent: 20, startsAt: time.toISOString(), endsAt: null, enabled: true, combine: false }];
  assert.equal(price(s, 'tea'), 3150); assert.equal(price(s, 'latte'), 11200); assert.equal(price(s, 'americano'), 11000);
  assert.equal(saleProducts(s, time).find(p => p.id === 'latte')!.discounts![0].categories, undefined);
  assert.equal(campaignCovers({ productIds: [], categories: [] }, s.products[0]), false, 'a category campaign whose categories were all removed covers nothing');
});

test('category quantity offer (adet kampanyası) counts per product and skips products sold by weight', () => {
  const s = seed(); s.campaigns = [desserts({ minQuantity: 2 })];
  s.products.push(cake('lokum', 'Tatlılar', { unit: 'kg', price: 60000 }));
  assert.equal(price(s, 'cheesecake', time, 1), 19000); assert.equal(price(s, 'cheesecake', time, 2), 17100);
  assert.equal(saleProducts(s, time).find(p => p.id === 'lokum')!.discounts!.length, 0, 'a kg product is not in a quantity condition');
  // Without the quantity condition the same kg product gets the percentage like any dessert.
  s.campaigns[0].minQuantity = 1;
  assert.equal(saleProducts(s, time).find(p => p.id === 'lokum')!.discounts!.length, 1);
});

test('category campaign with a weekly schedule prices only inside its days and hours', () => {
  const s = seed(); s.campaigns = [desserts({ schedule: { days: [1], from: '14:00', to: '16:00' }, startsAt: '2026-09-20T21:00:00.000Z', endsAt: '2026-10-18T21:00:00.000Z' })];
  assert.equal(price(s, 'cheesecake', time), 17100); // Monday 15:00
  assert.equal(price(s, 'cheesecake', new Date('2026-09-21T13:30:00Z')), 19000); // Monday 16:30
  assert.equal(price(s, 'cheesecake', new Date('2026-09-22T12:00:00Z')), 19000); // Tuesday
  s.products.push(cake('late')); assert.equal(price(s, 'late', new Date('2026-09-28T12:00:00Z')), 18000); // next Monday, added later
});

test('the order engine prices with the same resolution as the menu (client quote = server price)', () => {
  const s = seed(); s.campaigns = [desserts({ minQuantity: 2 })]; s.products.push(cake('added-later'));
  const actor = { tenantId: s.tenantId, role: 'guest' as const, id: 'guest', tableId: 'table-1', epoch: 0 }, ctx = { now: time, id: randomUUID };
  const lines: CartLine[] = [{ productId: 'cheesecake', quantity: 2, selections: [] }, { productId: 'added-later', quantity: 3, selections: [] }, { productId: 'tea', quantity: 1, selections: [] }];
  const menu = saleProducts(s, time), quote = lines.reduce((n, l) => n + cartLineTotal(menu.find(p => p.id === l.productId)!, l, lines.filter(x => x.productId === l.productId).reduce((q, x) => q + x.quantity, 0)), 0);
  assert.equal(quote, 2 * 17100 + 3 * 18000 + 3500);
  submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', lines, expectedTotal: quote }, ctx);
  assert.equal(s.orders[0].total, quote);
  assert.deepEqual(s.orders[0].lines.map(l => l.campaigns?.[0]?.id), ['desserts', 'desserts', undefined]);
  // A product moved out after the menu was read: the server no longer discounts it and refuses the stale total.
  s.products.find(p => p.id === 'added-later')!.category = 'Kahveler';
  assert.throws(() => submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', lines: [lines[1]], expectedTotal: 3 * 18000 }, ctx), /Fiyat değişti/);
});

test('report keeps per-product lines: products in the category now plus every product the campaign discounted', () => {
  const s = seed(); s.changeSeconds = 600; s.campaigns = [desserts({ reportId: 'r1' })]; s.products.push(cake('moved'));
  const actor = { tenantId: s.tenantId, role: 'guest' as const, id: 'guest', tableId: 'table-1', epoch: 0 }, ctx = { now: time, id: randomUUID };
  submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'moved', quantity: 1, selections: [] }], expectedTotal: 18000 }, ctx);
  s.products.find(p => p.id === 'moved')!.category = 'Kahveler'; s.products.push(cake('fresh'));
  const row = campaignReport(s, new Date(+time + 3600_000)).campaigns[0];
  assert.deepEqual(row.products.map(p => p.id).sort(), ['brownie', 'cheesecake', 'fresh', 'moved']);
  assert.equal(row.products.find(p => p.id === 'moved')!.appliedAmount, 18000);
  assert.equal(row.appliedAmount, 18000); assert.equal(row.discount, 2000);
  assert.equal(row.scopeText, 'Tatlılarda geçerli (bölümün tamamı)');
});

test('category rename carries the campaign; removal forgets the category', () => {
  const s = seed(); s.campaigns = [desserts()];
  const owner = { tenantId: s.tenantId, role: 'owner' as const, id: 'owner' }, ctx = { now: time, id: randomUUID };
  changeCategories(s, owner, { requestId: randomUUID(), revision: s.menuRevision, action: 'rename', name: 'Tatlılar', nextName: 'Pastalar' }, ctx);
  assert.deepEqual(s.campaigns[0].categories, ['Pastalar']); assert.equal(price(s, 'cheesecake'), 17100);
  changeCategories(s, owner, { requestId: randomUUID(), revision: s.menuRevision, action: 'add', name: 'Boş' }, ctx);
  s.campaigns[0].categories = ['Pastalar', 'Boş'];
  changeCategories(s, owner, { requestId: randomUUID(), revision: s.menuRevision, action: 'remove', name: 'Boş' }, ctx);
  assert.deepEqual(s.campaigns[0].categories, ['Pastalar']);
});

test('menu wording: Turkish locative and the guest line', () => {
  assert.equal(inCategory('Tatlılar'), 'Tatlılarda'); assert.equal(inCategory('Kekler'), 'Keklerde'); assert.equal(inCategory('Tost'), 'Tostta');
  assert.equal(inCategory('Soğuk İçecekler'), 'Soğuk İçeceklerde'); assert.equal(inCategory('Kek'), 'Kekte'); assert.equal(inCategory('Pizza'), 'Pizzada');
  assert.equal(inCategory('Menü'), 'Menüde'); assert.equal(inCategory('TATLILAR'), 'TATLILARDA'); assert.equal(inCategory('Menü 2'), 'Menü 2 bölümünde');
  assert.equal(categoriesPlace(['Çaylar', 'Kahveler', 'Tatlılar']), 'Çaylar, Kahveler ve Tatlılarda'); assert.equal(categoriesPlace(['a', 'b', 'c', 'd']), '4 bölümde');
  assert.equal(categoryOfferText({ categories: ['Tatlılar'], percent: 10 }), 'Tatlılarda %10 indirim');
  assert.equal(categoryOfferText({ categories: ['Tatlılar'], kind: 'fixed', amount: 2000, minQuantity: 2 }), 'Tatlılarda 20 TL indirim · 2 adet ve üzeri');
  assert.equal(categoryOfferText({ categories: ['Tatlılar', 'Çaylar'], percent: 10 }, c => ({ Tatlılar: 'Desserts', Çaylar: 'Teas' })[c]!), '10% off Desserts & Teas');
});

test('HTTP: owner saves a category campaign; a dessert added afterwards is discounted for the guest and priced by the server', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/category-campaigns-')));
  licensed(store); const server = createServer(createApp(store, () => new Date(), () => true));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = () => { const jar = new Map<string, string>(); let session = ''; return { async call(path: string, body?: unknown) {
    const response = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'X-Guest-Session': session }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const value of response.headers.getSetCookie()) { const [k, v] = value.split(';')[0].split('='); jar.set(k, v); }
    const data = await response.json() as any; if (data.session) session = data.session; return { status: response.status, data };
  } }; };
  const owner = client(), guest = client();
  assert.equal((await owner.call('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  const table = store.read('mola-demo').tables[0];
  assert.equal((await guest.call('/guest/session', { token: table.token })).status, 200);
  const listed = (await owner.call('/staff/campaigns')).data;
  assert.ok(listed.categories.includes('Tatlılar'));
  const campaign = { name: 'Tatlılarda %10 indirim', productIds: [], categories: ['Tatlılar'], percent: 10, startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: null, enabled: true, combine: false };
  const save = async (c: object) => (await owner.call('/staff/campaigns', { requestId: randomUUID(), revision: store.read('mola-demo').menuRevision, campaign: c }));
  assert.equal((await save({ ...campaign, categories: ['Yok böyle bölüm'] })).data.code, 'INVALID_CATEGORIES');
  assert.equal((await save({ ...campaign, categories: [] })).data.code, 'INVALID_CATEGORIES');
  assert.equal((await save({ ...campaign, productIds: ['tea'] })).data.code, 'INVALID_CATEGORIES');
  assert.equal((await save({ ...campaign, excludedProductIds: ['nope'] })).data.code, 'INVALID_PRODUCTS');
  assert.equal((await save({ ...campaign, categories: undefined })).data.code, 'INVALID_PRODUCTS', 'a product campaign still needs products');
  assert.equal((await save(campaign)).status, 200);
  const saved = store.read('mola-demo').campaigns!.find(c => c.name === campaign.name)!;
  assert.deepEqual([saved.productIds, saved.categories, saved.excludedProductIds], [[], ['Tatlılar'], undefined]);
  // A product-list campaign is stored exactly as before.
  assert.equal((await save({ name: 'Çay', productIds: ['tea'], percent: 5, startsAt: campaign.startsAt, endsAt: null, enabled: true, combine: false })).status, 200);
  assert.equal('categories' in store.read('mola-demo').campaigns!.find(c => c.name === 'Çay')!, false);
  // The dessert is added after the campaign.
  const product = { code: '88', name: 'Fırın Sütlaç', nameEn: '', category: 'Tatlılar', description: '', price: 15000, soldOut: false, art: 'cake', photo: null, groups: [] };
  assert.equal((await owner.call('/staff/products', { product })).status, 200);
  const menu: Product[] = (await guest.call('/guest/state')).data.products, added = menu.find(p => p.code === '88')!;
  assert.equal(added.discounts?.[0]?.categories?.[0], 'Tatlılar');
  const lines = [{ productId: added.id, quantity: 2, selections: [] }], quote = cartLineTotal(added, lines[0], 2);
  assert.equal(quote, 27000);
  // No client trust: the full price is refused, the menu's quote is accepted and stored as the server priced it.
  assert.equal((await guest.call('/guest/orders', { requestId: randomUUID(), tableId: table.id, lines, expectedTotal: 30000 })).data.code, 'PRICE_CHANGED');
  assert.equal((await guest.call('/guest/orders', { requestId: randomUUID(), tableId: table.id, lines, expectedTotal: quote })).status, 200);
  const order = store.read('mola-demo').orders.at(-1)!;
  assert.equal(order.total, 27000); assert.equal(order.lines[0].campaigns?.[0]?.name, 'Tatlılarda %10 indirim');
});
