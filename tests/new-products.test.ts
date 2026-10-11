import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../server/seed.js';
import { newProductIds } from '../packages/domain/new-products.js';
test('new products expire at exactly 30 days, exclude drafts/legacy/future dates and sort newest first', () => {
 const p = seed().products[0], now = new Date('2026-09-29T10:00:00Z'), day = 86400000;
 const product = (id: string, age: number) => ({ ...p, id, firstPublishedAt: new Date(+now - age).toISOString() });
 assert.deepEqual(newProductIds([p, { ...p, id: 'draft', firstPublishedAt: null, published: false }, product('expired', 30 * day), product('oldest', 30 * day - 1), product('fresh', 0), product('future', -1), { ...product('hidden', 1), published: false }], now), ['fresh', 'oldest']);
});
