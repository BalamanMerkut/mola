import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaTitle } from '../packages/domain/table-label';
import { shareText } from '../packages/domain/commission';
import { kitchenProduct } from '../server/app';
import { addToCart } from '../src/cartLines';
import { matchesSearch } from '../src/platformStatus';
import { dayOf, shapeDay, showDay } from '../src/dateText';

// 8 Ekim denetimi: Ajanda → Rezervasyonlar' masa planı bölümleri "inside" / "outside" diye İngilizce yazıyordu.
test('table section headings are Turkish, as on Masalar', () => {
  assert.equal(areaTitle('inside'), 'İç masalar');
  assert.equal(areaTitle('outside'), 'Dış masalar');
  assert.equal(areaTitle('Bahçe'), 'Bahçe masaları');
  assert.equal(areaTitle(''), 'Diğer masalar');
});

// K10: the share of card commission reads like the rate the owner typed (%1,79), not %1,8.
test('commission share with two decimals', () => {
  assert.equal(shareText(0.0179), '%1,79');
  assert.equal(shareText(0.025), '%2,5');
});

// K11: the kitchen tablet is not sent prices it never shows.
test('kitchen copy of a product carries no money', () => {
  const p = kitchenProduct({ id: 'latte', price: 14000, groups: [{ id: 'size', options: [{ id: 'large', extra: 2500 }] }], discounts: [{ id: 'k' }] });
  assert.equal(p.price, 0); assert.equal(p.groups[0].options[0].extra, 0); assert.deepEqual(p.discounts, []); assert.equal(p.id, 'latte');
});

// K8: the same item with the same choices is one basket line with more pieces.
test('basket merges identical lines', () => {
  const big: { productId: string; quantity: number; selections: { groupId: string; optionId: string }[]; note?: string } = { productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'large' }] };
  let cart = addToCart([], big); cart = addToCart(cart, { ...big });
  assert.deepEqual(cart.map(l => l.quantity), [2]);
  cart = addToCart(cart, { ...big, note: 'az şekerli' }); cart = addToCart(cart, { productId: 'latte', quantity: 1, selections: [] });
  assert.deepEqual(cart.map(l => l.quantity), [2, 1, 1]);
});

// K9: Mola Yönetim still finds a business by the name it was registered under after the owner renamed it.
test('business search finds former names', () => {
  const b = { name: 'Harput Kahve Evi', formerNames: ['Denetim Kafe'] } as unknown as Parameters<typeof matchesSearch>[0];
  assert.equal(matchesSearch(b, 'denetim'), true); assert.equal(matchesSearch(b, 'harput'), true); assert.equal(matchesSearch(b, 'başka'), false);
});

// K5: dates as gün.ay.yıl, whatever the browser's language.
test('day field typing rules', () => {
  assert.equal(showDay('2026-10-08'), '08.10.2026');
  assert.equal(dayOf('08.10.2026'), '2026-10-08'); assert.equal(dayOf('8.10.2026'), '2026-10-08'); assert.equal(dayOf('08102026'), '2026-10-08'); assert.equal(dayOf('2026-10-08'), '2026-10-08');
  assert.equal(dayOf('31.02.2026'), ''); assert.equal(dayOf('10/08'), '');
  assert.equal(shapeDay('08', '0'), '08.'); assert.equal(shapeDay('08.10', '08.1'), '08.10.');
  let typed = ''; for (const ch of '01022027') typed = shapeDay(typed + ch, typed); assert.equal(typed, '01.02.2027');
  assert.equal(shapeDay('01.022', '01.02'), '01.02.2'); assert.equal(shapeDay('0810', '081'), '08.10.'); assert.equal(shapeDay('08102026', '0810202'), '08.10.2026');
});
