import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../server/seed.js';
import { popularProductIds } from '../packages/domain/popular.js';
import type { Order } from '../packages/domain/types.js';

test('popular menu ranks quantities, deduplicates archives and excludes cancelled, stale, future and unavailable products', () => {
  const s = seed(), now = new Date('2026-09-17T12:00:00Z');
  const order = (id: string, productId: string, quantity: number, date = now.toISOString()): Order => ({ id, number: 1, accountId: 'account', guestId: 'private', guestLabel: 'Guest', source: 'qr', createdAt: date, status: 'served', version: 1, menuRevision: 1, cancelRequested: false, total: 100, lines: [{ id, productId, quantity, selections: [], name: productId, code: '1', optionNames: [], unitPrice: 100, total: 100 }] });
  assert.deepEqual(popularProductIds(s, now), []);
  s.orders = [order('tea', 'tea', 2), order('herbal', 'herbal', 3), order('cancelled', 'latte', 100), order('sold', 'brownie', 100), order('deleted', 'deleted', 100), order('old', 'americano', 100, '2026-08-18T11:59:59Z'), order('future', 'turkish', 100, '2026-09-17T12:00:01Z')];
  s.orders[2].status = 'cancelled';
  s.archives = [{ id: 'archive', accountId: 'account', tableName: 'Table', closedAt: now.toISOString(), total: 100, cash: 100, card: 0, payments: [], orders: [structuredClone(s.orders[0]), { ...structuredClone(s.orders[2]), status: 'served' }] }];
  assert.deepEqual(popularProductIds(s, now), ['herbal', 'tea']);
  s.orders.push(order('boundary', 'lemonade', 4, '2026-08-18T12:00:00Z'));
  assert.deepEqual(popularProductIds(s, now), ['lemonade', 'herbal', 'tea']);
  assert.deepEqual(popularProductIds(seed('other'), now), []);
});

test('popular menu caps at six and resolves equal quantities consistently', () => {
  const s = seed(), now = new Date();
  s.products.forEach(p => p.soldOut = false);
  s.orders = [{ id: 'o', number: 1, accountId: 'a', guestId: 'g', guestLabel: '', source: 'staff', createdAt: now.toISOString(), status: 'new', version: 1, menuRevision: 1, total: 1, cancelRequested: false, lines: s.products.map(p => ({ id: p.id, productId: p.id, name: p.name, code: p.code, quantity: 1, selections: [], optionNames: [], unitPrice: 1, total: 1 })) }];
  const expected = s.products.map(p => p.id).sort((a, b) => a.localeCompare(b)).slice(0, 6);
  assert.deepEqual(popularProductIds(s, now), expected);
});
