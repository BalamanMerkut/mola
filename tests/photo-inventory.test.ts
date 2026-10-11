import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { photoInventory } from '../server/photo-inventory.js';
import { seed } from '../server/seed.js';

test('photo file checks detect missing references and partial uploads without exposing paths or changing files', async () => {
  await fs.mkdir('.local/tests', { recursive: true }); const root = await fs.mkdtemp(resolve('.local/tests/photo-check-'));
  const now = new Date('2026-09-26T12:00:00Z'), old = new Date('2026-09-01T12:00:00Z');
  const [missing, partial, orphan, recent, empty, legacy] = Array.from({ length: 6 }, () => randomUUID());
  async function write(area: string, name: string, content = '123', date = old) {
    const folder = join(root, area, 'one'); await fs.mkdir(folder, { recursive: true });
    const path = join(folder, name); await fs.writeFile(path, content); await fs.utimes(path, date, date);
  }
  for (const id of [partial, legacy]) { await write('media', `${id}.webp`); await write('media', `${id}-small.webp`); }
  await write('photo-sources', `${partial}.webp`);
  await write('photo-sources', `${orphan}.json`);
  await write('media', `${recent}.webp`, '123', now);
  await write('media', `${empty}.webp`, ''); await write('media', `${empty}-small.webp`);
  const state = seed('one'), template = state.products[0];
  state.products = [missing, partial, empty, legacy].map((id, n) => ({ ...template, id: `product-${n}`, photo: `/media/one/${id}.webp` }));
  state.productDrafts = [{ ...template, photo: '/media/another/private.webp' }];
  const before = await fs.readdir(join(root, 'media', 'one'));
  const result = await photoInventory(root, 'one', () => state, now);
  assert.deepEqual(result.integrity, { missingPhotos: 2, missingThumbnails: 1, incompleteSources: 1, incompleteOldUploads: 1, invalidReferences: 1 });
  assert.deepEqual(await fs.readdir(join(root, 'media', 'one')), before);
  assert.equal((await fs.stat(join(root, 'media', 'one', `${empty}.webp`))).size, 0);
  assert.equal(JSON.stringify(result).includes(missing), false);
  assert.equal(JSON.stringify(result).includes('private.webp'), false);
});
test('photo inventory protects live/hidden/draft references and recent groups without deleting any files', async () => {
  await fs.mkdir('.local/tests', { recursive: true }); const root = await fs.mkdtemp(resolve('.local/tests/inventory-'));
  const now = new Date('2026-09-21T12:00:00Z'), old = new Date('2026-09-01T12:00:00Z');
  const state = seed('one'); state.products = []; state.productDrafts = [];
  const template = seed('one').products[0];
  const photos: string[] = [];
  for (let i = 0; i < 5; i++) {
    const id = randomUUID(); photos.push(`/media/one/${id}.webp`);
    for (const [area, suffix] of [['media', '.webp'], ['media', '-small.webp'], ['photo-sources', '.webp'], ['photo-sources', '.json']]) {
      const folder = join(root, area, 'one'); await fs.mkdir(folder, { recursive: true });
      const file = join(folder, id + suffix); await fs.writeFile(file, '12345'); await fs.utimes(file, old, old);
      if (i === 3 && suffix === '.json') await fs.utimes(file, now, now);
    }
  }
  state.products.push({ ...template, photo: photos[0] }, { ...template, id: 'hidden', published: false, photo: photos[1] });
  state.productDrafts.push({ ...template, photo: photos[2] });
  await fs.writeFile(join(root, 'media', 'one', 'unknown.dat'), '123');
  const before = await fs.readdir(join(root, 'media', 'one'));
  const result = await photoInventory(root, 'one', () => state, now);
  assert.deepEqual(result.inUse, { count: 3, bytes: 60 }); assert.deepEqual(result.recent, { count: 1, bytes: 20 }); assert.deepEqual(result.unused, { count: 1, bytes: 20 });
  assert.equal(result.otherBytes, 3); assert.equal(result.usedBytes, 103);
  assert.deepEqual(await fs.readdir(join(root, 'media', 'one')), before);
  assert.equal((await photoInventory(root, 'other', () => state, now)).usedBytes, 0);
  // The callback observes references at the end of scanning, not a stale pre-scan snapshot.
  const protectedLater = await photoInventory(root, 'one', () => ({ ...state, products: [...state.products, { ...template, photo: photos[4] }] }), now);
  assert.equal(protectedLater.unused.count, 0); assert.equal(protectedLater.inUse.count, 4);
  await assert.rejects(photoInventory(root, '../one', () => state, now), { code: 'INVALID_PHOTO' });
});
