import { test, mock } from 'node:test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { savePhoto, readPhotoSource, photoStorage } from '../server/photos.js';
test('photos are re-encoded into bounded WebP and thumbnail without metadata', async () => {
  mkdirSync('.local/tests', { recursive: true }); const directory = mkdtempSync(resolve('.local/tests/photo-'));
  const input = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#bc7046' } }).jpeg().toBuffer();
  const result = await savePhoto(directory, 'mola-demo', `data:image/jpeg;base64,${input.toString('base64')}`);
  const path = join(directory, result.photo.slice(1));
  const large = await sharp(readFileSync(path)).metadata(); const small = await sharp(readFileSync(path.replace('.webp', '-small.webp'))).metadata();
  assert.equal(large.width, 800); assert.equal(large.height, 800); assert.equal(large.format, 'webp'); assert.equal(large.exif, undefined);
  assert.equal(small.width, 320); assert.equal(small.height, 320);
});
test('invalid, disguised SVG and oversized photo bodies are rejected', async () => {
  await assert.rejects(savePhoto('.local/tests', 'mola-demo', 'data:image/svg+xml;base64,AA=='));
  await assert.rejects(savePhoto('.local/tests', 'mola-demo', `data:image/png;base64,${Buffer.from('<svg></svg>').toString('base64')}`));
  await assert.rejects(savePhoto('.local/tests', 'mola-demo', `data:image/png;base64,${Buffer.alloc(1000001).toString('base64')}`));
});
test('uncropped source and crop settings survive reopen; other tenant cannot read them', async () => {
  mkdirSync('.local/tests', { recursive: true }); const directory = mkdtempSync(resolve('.local/tests/source-'));
  const input = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#caae91' } }).png().toBuffer();
  const data = `data:image/png;base64,${input.toString('base64')}`;
  const crop = { zoom: 1.5, x: 20, y: 80 };
  const saved = await savePhoto(directory, 'mola-demo', data, { data, crop });
  const reopened = await readPhotoSource(directory, 'mola-demo', saved.photo);
  assert.equal(reopened.original, true); assert.deepEqual(reopened.crop, crop);
  const original = await sharp(Buffer.from(reopened.data.split(',')[1], 'base64')).metadata();
  assert.equal(original.width, 1200); assert.equal(original.height, 800);
  await assert.rejects(readPhotoSource(directory, 'other-demo', saved.photo));
  const legacy = await savePhoto(directory, 'mola-demo', data);
  assert.equal((await readPhotoSource(directory, 'mola-demo', legacy.photo)).original, false);
});

test('photo quota includes source, crop metadata and thumbnail; simultaneous uploads cannot exceed it', async () => {
  const directory = mkdtempSync(resolve('.local/tests/quota-'));
  const input = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#caae9180' } }).png().toBuffer();
  const data = `data:image/png;base64,${input.toString('base64')}`, source = { data, crop: { zoom: 1, x: 50, y: 50 } };
  const first = await savePhoto(directory, 'one', data, source);
  const size = first.storage.usedBytes;
  assert.ok(size > first.bytes + first.thumbnailBytes);
  const results = await Promise.allSettled([savePhoto(directory, 'one', data, source, size * 2), savePhoto(directory, 'one', data, source, size * 2)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.some(r => r.status === 'rejected' && r.reason.code === 'PHOTO_QUOTA'));
  assert.deepEqual(await photoStorage(directory, 'one', size * 2), { usedBytes: size * 2, limitBytes: size * 2, remainingBytes: 0 });
  assert.equal((await readPhotoSource(directory, 'one', first.photo)).original, true);
  assert.equal((await savePhoto(directory, 'two', data, source, size)).storage.remainingBytes, 0);
  assert.equal((await fs.readdir(join(directory, 'media', 'one'))).length, 4);
  assert.equal((await fs.readdir(join(directory, 'photo-sources', 'one'))).length, 4);
  assert.equal((await sharp(readFileSync(join(directory, first.photo.slice(1)))).metadata()).hasAlpha, true);
  await assert.rejects(savePhoto(directory, '../outside', data), { code: 'INVALID_PHOTO' });
});

test('disk failure removes only this uploads partial files, leaves existing photos intact and releases its queue', async () => {
  const directory = mkdtempSync(resolve('.local/tests/photo-disk-'));
  const input = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#305746' } }).png().toBuffer();
  const data = `data:image/png;base64,${input.toString('base64')}`;
  const first = await savePhoto(directory, 'one', data), open = fs.open;
  let calls = 0;
  const failure = mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]).startsWith(directory) && ++calls === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return open(...args);
  });
  try { await assert.rejects(savePhoto(directory, 'one', data), { code: 'PHOTO_DISK_FULL' }); }
  finally { failure.mock.restore(); }
  assert.equal((await photoStorage(directory, 'one')).usedBytes, first.storage.usedBytes);
  assert.equal((await fs.readdir(join(directory, 'media', 'one'))).length, 2);
  assert.equal((await readPhotoSource(directory, 'one', first.photo)).original, false);
  assert.ok((await savePhoto(directory, 'one', data)).photo);
});
