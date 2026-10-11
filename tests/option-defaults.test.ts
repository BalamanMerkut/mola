import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed } from '../server/seed.js';
import { quote, submitOrder } from '../packages/domain/engine.js';
import { defaultOption, missingChoices, notePlaceholder, showsNoChoice } from '../packages/domain/lines.js';
import type { OptionGroup, Product } from '../packages/domain/types.js';

const group = (required: boolean, options: [string, number][]): OptionGroup => ({ id: 'g', name: 'Boy', required, options: options.map(([name, extra], i) => ({ id: `o${i}`, name, extra })) });
const ctx = () => ({ now: new Date('2026-10-03T09:00:00Z'), id: randomUUID });

test('a required group starts on its free option; none free means no choice and the item waits', () => {
  // "Küçük −₺15" first must never be chosen by itself: that was lost revenue.
  assert.equal(defaultOption(group(true, [['Küçük', -1500], ['Standart', 0], ['Büyük', 2500]])), 'o1');
  assert.equal(defaultOption(group(true, [['Küçük', 0], ['Standart', 0], ['Büyük', 0]])), 'o1', 'several free: "Standart" first');
  assert.equal(defaultOption(group(true, [['Sade', 0], ['Orta', 0]])), 'o0', 'several free without "Standart": the first');
  assert.equal(defaultOption(group(true, [['Küçük', -1500], ['Büyük', 2500]])), undefined, 'nothing free: the guest chooses');
  assert.equal(defaultOption(group(false, [['Normal süt', 0], ['Yulaf sütü', 3000]])), undefined, 'optional groups start empty');
  const product = { groups: [group(true, [['Küçük', -1500], ['Büyük', 2500]])] } as Pick<Product, 'groups'>;
  assert.deepEqual(missingChoices(product, {}).map(g => g.name), ['Boy']);
  assert.deepEqual(missingChoices(product, { g: 'o1' }), []);
  assert.deepEqual(missingChoices(product, { g: 'other' }).length, 1, 'an unknown option is no choice');
});

test('an optional group shows "Seçim yok" only when no option is already free', () => {
  assert.equal(showsNoChoice(group(false, [['Normal süt', 0], ['Yulaf sütü', 3000]])), false, '"Standart" next to "Normal süt ₺0" was a duplicate');
  assert.equal(showsNoChoice(group(false, [['Yulaf sütü', 3000], ['Laktozsuz', 1500]])), true);
  assert.equal(showsNoChoice(group(true, [['Standart', 0]])), false);
});

test('the server prices only what was chosen: a required group without a choice or a foreign option is refused', () => {
  const s = seed(), latte = s.products.find(p => p.id === 'latte')!;
  assert.throws(() => quote(s.products, [{ productId: 'latte', quantity: 1, selections: [] }], ctx()), { code: 'OPTION_REQUIRED' });
  assert.throws(() => quote(s.products, [{ productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'oat' }] }], ctx()), { code: 'INVALID_OPTIONS' });
  assert.throws(() => quote(s.products, [{ productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'regular' }, { groupId: 'size', optionId: 'large' }] }], ctx()), { code: 'INVALID_OPTIONS' });
  // A client that claims a lower total for the large size is refused; the price is the server's.
  const large = [{ productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'large' }] }];
  assert.equal(quote(s.products, large, ctx())[0].total, latte.price + 2500);
  assert.throws(() => submitOrder(s, { tenantId: s.tenantId, id: 'w', role: 'waiter' }, { requestId: randomUUID(), tableId: 'table-1', lines: large, expectedTotal: latte.price }, ctx()), { code: 'PRICE_CHANGED' });
});

test('note examples follow the product: Türk kahvesi and espresso are never "az sütlü"', () => {
  const p = (name: string, category = 'Kahveler', subtype?: string) => ({ name, category, subtype, art: 'coffee' as const });
  assert.equal(notePlaceholder(p('Türk Kahvesi')), 'Örn. orta şekerli, bol köpüklü');
  assert.equal(notePlaceholder(p('Dibek Kahvesi')), 'Örn. orta şekerli, bol köpüklü');
  assert.equal(notePlaceholder(p('Espresso')), 'Örn. yanında su, ekstra sıcak');
  assert.equal(notePlaceholder(p('Americano', 'Kahveler', 'Espresso bazlı')), 'Örn. yanında su, ekstra sıcak');
  assert.equal(notePlaceholder(p('Iced Americano')), 'Örn. buzsuz, az şekerli', 'cold words still win');
  assert.equal(notePlaceholder(p('Caffè Latte')), 'Örn. az sütlü, ekstra sıcak');
  assert.equal(notePlaceholder(p('Turkish Coffee', 'Kahveler', 'Türk Kahvesi'), true), 'e.g. Medium sweet, extra foam');
});
