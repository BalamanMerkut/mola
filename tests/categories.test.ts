import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { changeCategories, menuCategories, menuSubcategories, type CategoryChange } from '../packages/domain/categories.js';
import { submitOrder } from '../packages/domain/engine.js';

test('explicit empty subcategories persist, reject duplicates and follow rename/remove lifecycle', () => {
  const s = seed(), actor = { tenantId: s.tenantId, id: 'owner', role: 'owner' as const }, ctx = { now: new Date(), id: randomUUID };
  const change = (action: CategoryChange['action'], nextName?: string, subtype?: string) => ({ requestId: randomUUID(), revision: s.menuRevision, action, name: 'Çaylar', nextName, subtype });
  const b = change('subtype-add', ' Özel harman ');
  assert.throws(() => changeCategories(s, { ...actor, role: 'waiter' }, b, ctx));
  assert.throws(() => changeCategories(s, { ...actor, tenantId: 'other' }, b, ctx));
  const result = changeCategories(s, actor, b, ctx);
  assert.deepEqual(changeCategories(s, actor, b, ctx), result);
  assert.deepEqual(menuSubcategories(JSON.parse(JSON.stringify(s))).find(c => c.category === 'Çaylar')!.names, ['Özel harman']);
  for (const name of ['', '  ÖZEL HARMAN ', 'x'.repeat(81)]) assert.throws(() => changeCategories(s, actor, change('subtype-add', name), ctx));
  assert.throws(() => changeCategories(s, actor, { ...change('subtype-add', 'Yeni'), revision: 0 }, ctx));
  changeCategories(s, actor, change('subtype-rename', 'Yeni harman', 'Özel harman'), ctx);
  assert.deepEqual(menuSubcategories(s).find(c => c.category === 'Çaylar')!.names, ['Yeni harman']);
  changeCategories(s, actor, change('subtype-remove', undefined, 'Yeni harman'), ctx);
  assert.deepEqual(menuSubcategories(s).find(c => c.category === 'Çaylar')!.names, []);
  changeCategories(s, actor, change('subtype-add', 'Son harman'), ctx);
  changeCategories(s, actor, change('rename', 'Yeni Çaylar'), ctx);
  assert.deepEqual(menuSubcategories(s).find(c => c.category === 'Yeni Çaylar')!.names, ['Son harman']);
  assert.ok(s.products.every(p => !p.subtype));
});

test('subcategory rename and removal affect only matching current products, preserve order and reject duplicates', () => {
  const s = seed(), actor = { tenantId: s.tenantId, id: 'owner', role: 'owner' as const }, ctx = { now: new Date(), id: randomUUID };
  s.products.find(p => p.id === 'tea')!.subtype = 'Demleme';
  s.products.find(p => p.id === 'herbal')!.subtype = 'Bitki';
  s.products.find(p => p.id === 'latte')!.subtype = 'Bitki';
  submitOrder(s, actor, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 3500, lines: [{ productId: 'tea', quantity: 1, selections: [] }] }, ctx);
  const history = structuredClone(s.orders), size = s.products.length;
  const b: CategoryChange = { requestId: randomUUID(), revision: s.menuRevision, action: 'subtype-rename', name: 'Çaylar', subtype: 'Bitki', nextName: 'Bitki çayları' };
  for (const nextName of ['', ' DEMLEME ', 'x'.repeat(81)]) assert.throws(() => changeCategories(s, actor, { ...b, nextName }, ctx));
  const result = changeCategories(s, actor, b, ctx);
  assert.deepEqual(changeCategories(s, actor, b, ctx), result);
  assert.deepEqual(menuSubcategories(s).find(c => c.category === 'Çaylar')!.names, ['Demleme', 'Bitki çayları']);
  assert.equal(s.products.find(p => p.id === 'latte')!.subtype, 'Bitki');
  const remove: CategoryChange = { requestId: randomUUID(), revision: s.menuRevision, action: 'subtype-remove', name: 'Çaylar', subtype: 'Bitki çayları' };
  assert.throws(() => changeCategories(s, { ...actor, role: 'waiter' }, remove, ctx));
  assert.throws(() => changeCategories(s, { ...actor, tenantId: 'other' }, remove, ctx));
  assert.throws(() => changeCategories(s, actor, { ...remove, revision: -1 }, ctx));
  const removed = changeCategories(s, actor, remove, ctx);
  assert.deepEqual(changeCategories(s, actor, remove, ctx), removed);
  assert.equal(s.products.length, size);
  assert.equal(s.products.find(p => p.id === 'herbal')!.category, 'Çaylar');
  assert.equal(s.products.find(p => p.id === 'herbal')!.subtype, '');
  assert.deepEqual(s.orders, history);
});

test('subcategory order persists through category rename, appends new types and rejects stale or invalid changes', () => {
  const s = seed(), actor = { tenantId: s.tenantId, id: 'owner', role: 'owner' as const }, ctx = { now: new Date(), id: randomUUID };
  s.products.find(p => p.id === 'tea')!.subtype = 'Demleme';
  s.products.find(p => p.id === 'herbal')!.subtype = 'Bitki';
  const b: CategoryChange = { requestId: randomUUID(), revision: s.menuRevision, action: 'subtype-order', name: 'Çaylar', names: ['Bitki', 'Demleme'] };
  for (const invalid of [{ ...b, names: ['Bitki', 'Bitki'] }, { ...b, names: ['Bitki'] }, { ...b, name: 'Yok' }]) assert.throws(() => changeCategories(s, actor, invalid, ctx));
  assert.throws(() => changeCategories(s, { ...actor, role: 'waiter' }, b, ctx));
  assert.throws(() => changeCategories(s, { ...actor, tenantId: 'other' }, b, ctx));
  const result = changeCategories(s, actor, b, ctx);
  assert.deepEqual(changeCategories(s, actor, b, ctx), result);
  assert.throws(() => changeCategories(s, actor, { ...b, requestId: randomUUID() }, ctx));
  changeCategories(s, actor, { requestId: randomUUID(), revision: s.menuRevision, action: 'rename', name: 'Çaylar', nextName: 'Çay çeşitleri' }, ctx);
  assert.deepEqual(menuSubcategories(s).find(c => c.category === 'Çay çeşitleri')!.names, ['Bitki', 'Demleme']);
  s.products.find(p => p.id === 'tea')!.subtype = 'Yeni tür';
  assert.deepEqual(menuSubcategories(s).find(c => c.category === 'Çay çeşitleri')!.names, ['Bitki', 'Yeni tür']);
  assert.equal(s.audit.filter(a => a.action === 'category.subtype-order').length, 1);
});

test('category migration, rename and ordering preserve products and historic orders; retry once', () => {
  const s = seed(), owner = { tenantId: s.tenantId, id: 'owner', role: 'owner' as const }, ctx = { now: new Date(), id: randomUUID };
  submitOrder(s, owner, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 3500, lines: [{ productId: 'tea', quantity: 1, selections: [] }] }, ctx);
  const oldOrders = structuredClone(s.orders); const old = menuCategories(s);
  const b: CategoryChange = { requestId: randomUUID(), revision: s.menuRevision, action: 'rename', name: 'Çaylar', nextName: 'Sıcak Çaylar' };
  const r = changeCategories(s, owner, b, ctx); assert.deepEqual(changeCategories(s, owner, b, ctx), r);
  assert.equal(s.products.find(p => p.id === 'tea')!.category, 'Sıcak Çaylar'); assert.equal(r.categories.length, old.length); assert.deepEqual(s.orders, oldOrders);
  const reversed = [...r.categories].reverse(); changeCategories(s, owner, { requestId: randomUUID(), revision: s.menuRevision, action: 'reorder', names: reversed }, ctx);
  assert.deepEqual(menuCategories(s), reversed);
});
test('categories enforce owner, tenant, version, duplicate and nonempty constraints', () => {
  const s = seed(), owner = { tenantId: s.tenantId, id: 'owner', role: 'owner' as const }, ctx = { now: new Date(), id: randomUUID };
  const change = (b: Partial<CategoryChange>) => ({ requestId: randomUUID(), revision: s.menuRevision, action: 'add' as const, name: 'Kahvaltılar', ...b });
  for (const actor of [{ ...owner, role: 'waiter' as const }, { ...owner, tenantId: 'other' }]) assert.throws(() => changeCategories(s, actor, change({}), ctx));
  for (const b of [change({ revision: -1 }), change({ name: '  KAHVELER  ' }), change({ name: 'Tümü' }), change({ action: 'remove', name: 'Kahveler' }), change({ action: 'reorder', names: ['Kahveler'] })]) assert.throws(() => changeCategories(s, owner, b, ctx));
  changeCategories(s, owner, change({}), ctx); assert.ok(menuCategories(s).includes('Kahvaltılar'));
  changeCategories(s, owner, change({ action: 'remove' }), ctx); assert.ok(!menuCategories(s).includes('Kahvaltılar'));
  s.products = []; s.categories = ['Tek']; assert.throws(() => changeCategories(s, owner, change({ action: 'remove', name: 'Tek' }), ctx));
});
