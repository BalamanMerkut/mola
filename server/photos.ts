import sharp from 'sharp';
import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../packages/domain/engine.js';

export type PhotoSource = { data: string; crop: { zoom: number; x: number; y: number } };
export const PHOTO_QUOTA_BYTES = 500 * 1024 * 1024;
const writes = new Map<string, Promise<void>>();
let waiting = 0;
function tenantFolders(directory: string, tenant: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(tenant)) throw new DomainError('INVALID_PHOTO', 'Fotoğraf alanı geçersiz.');
  return [join(resolve(directory), 'media', tenant), join(resolve(directory), 'photo-sources', tenant)];
}
export async function photoStorage(directory: string, tenant: string, limitBytes = PHOTO_QUOTA_BYTES) {
  let usedBytes = 0;
  for (const folder of tenantFolders(directory, tenant)) {
    let entries;
    try { entries = await fs.readdir(folder, { withFileTypes: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
    for (const entry of entries) if (entry.isFile()) {
      try { usedBytes += (await fs.stat(join(folder, entry.name))).size; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
  }
  return { usedBytes, limitBytes, remainingBytes: Math.max(0, limitBytes - usedBytes) };
}
export async function savePhoto(directory: string, tenant: string, data: string, source?: PhotoSource, limitBytes = PHOTO_QUOTA_BYTES) {
  const [folder] = tenantFolders(directory, tenant);
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) throw new Error('Invalid photo storage limit');
  // Serialize the complete quota check/write per business, including source and thumbnail.
  // Bound queued decoding jobs so repeated uploads cannot grow memory indefinitely.
  if (waiting >= 8) throw new DomainError('PHOTO_BUSY', 'Fotoğraflar hazırlanıyor. Biraz sonra tekrar deneyin.', 429);
  waiting++;
  const previous = writes.get(folder) ?? Promise.resolve(); let release!: () => void;
  const current = new Promise<void>(r => { release = r; }); writes.set(folder, current);
  await previous;
  try { return await savePhotoLocked(directory, tenant, data, source, limitBytes); }
  finally { release(); if (writes.get(folder) === current) writes.delete(folder); waiting--; }
}
/** PNG, JPEG or WebP by its first bytes: nothing else (an SVG under an image label) ever reaches the image library. */
export const rasterBytes = (b: Buffer) => b.subarray(0, 4).toString('hex') === '89504e47' || b.subarray(0, 3).toString('hex') === 'ffd8ff' || (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP');
async function savePhotoLocked(directory: string, tenant: string, data: string, source: PhotoSource | undefined, limitBytes: number) {
  if (!/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(data)) throw new DomainError('INVALID_PHOTO', 'JPG, PNG veya WebP fotoğraf seçin.');
  const bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
  if (bytes.length > 1_000_000) throw new DomainError('PHOTO_TOO_LARGE', 'Fotoğrafı küçültüp tekrar deneyin.');
  let large: Buffer, small: Buffer;
  try {
    if (!rasterBytes(bytes)) throw new Error('format');
    const image = sharp(bytes, { limitInputPixels: 16_000_000, animated: false });
    const meta = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) throw new Error('format');
    large = await image.rotate().resize(800, 800, { fit: 'cover' }).webp({ quality: 78 }).toBuffer();
    small = await sharp(large).resize(320, 320).webp({ quality: 72 }).toBuffer();
  } catch { throw new DomainError('INVALID_PHOTO', 'Fotoğraf okunamadı. Başka bir JPG, PNG veya WebP seçin.'); }
  let original: Buffer | undefined;
  if (source) {
    if (!/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(source.data)) throw new DomainError('INVALID_PHOTO', 'Kaynak fotoğraf okunamadı.');
    const raw = Buffer.from(source.data.slice(source.data.indexOf(',') + 1), 'base64');
    if (raw.length > 4_000_000) throw new DomainError('PHOTO_TOO_LARGE', 'Kaynak fotoğraf çok büyük.');
    try {
      if (!rasterBytes(raw)) throw new Error('format');
      const img = sharp(raw, { limitInputPixels: 16_000_000 }); const meta = await img.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) throw new Error('format');
      original = await img.rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
    } catch { throw new DomainError('INVALID_PHOTO', 'Kaynak fotoğraf okunamadı.'); }
  }
  const id = randomUUID(), [folder, privateFolder] = tenantFolders(directory, tenant);
  const files: { path: string; data: Buffer | string }[] = [
    { path: join(folder, `${id}.webp`), data: large },
    { path: join(folder, `${id}-small.webp`), data: small },
    ...(original && source ? [{ path: join(privateFolder, `${id}.webp`), data: original }, { path: join(privateFolder, `${id}.json`), data: JSON.stringify(source.crop) }] : []),
  ];
  const storedBytes = files.reduce((n, f) => n + Buffer.byteLength(f.data), 0);
  const storage = await photoStorage(directory, tenant, limitBytes);
  if (storedBytes > storage.remainingBytes) throw new DomainError('PHOTO_QUOTA', 'Fotoğraf depolama alanı doldu. Mevcut fotoğraflarınız korunuyor. Destek bölümünden yardım isteyin.', 409);
  const created: string[] = [];
  try {
    await fs.mkdir(folder, { recursive: true });
    if (original) await fs.mkdir(privateFolder, { recursive: true });
    for (const file of files) {
      const handle = await fs.open(file.path, 'wx'); created.push(file.path);
      try { await handle.writeFile(file.data); } finally { await handle.close(); }
    }
  } catch (e) {
    // Only files created by this upload are removed. Existing product/draft photos stay intact.
    const removed = await Promise.allSettled(created.map(path => fs.unlink(path)));
    if (removed.some(r => r.status === 'rejected')) throw new DomainError('PHOTO_WRITE_FAILED', 'Fotoğraf kaydedilemedi. Geçici dosyalar için destek kontrolü gerekli.', 503);
    if (['ENOSPC', 'EDQUOT'].includes((e as NodeJS.ErrnoException).code ?? '')) throw new DomainError('PHOTO_DISK_FULL', 'Sunucuda fotoğraf için yeterli boş alan yok. Mevcut fotoğraflarınız korunuyor; destek bölümünden yardım isteyin.', 503);
    throw new DomainError('PHOTO_WRITE_FAILED', 'Fotoğraf kaydedilemedi. Biraz sonra tekrar deneyin.', 503);
  }
  return { photo: `/media/${tenant}/${id}.webp`, bytes: large.length, thumbnailBytes: small.length, storage: { usedBytes: storage.usedBytes + storedBytes, limitBytes, remainingBytes: storage.remainingBytes - storedBytes } };
}

export async function readPhotoSource(directory: string, tenant: string, photo: string) {
  const prefix = `/media/${tenant}/`; const filename = photo.slice(prefix.length);
  if (!photo.startsWith(prefix) || !/^[a-f0-9-]{36}\.webp$/.test(filename)) throw new DomainError('INVALID_PHOTO', 'Fotoğraf bulunamadı.', 404);
  try {
    const bytes = await fs.readFile(join(directory, 'photo-sources', tenant, filename));
    const crop = JSON.parse(await fs.readFile(join(directory, 'photo-sources', tenant, filename.replace('.webp', '.json')), 'utf8'));
    return { data: `data:image/webp;base64,${bytes.toString('base64')}`, crop, original: true };
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  try {
    const bytes = await fs.readFile(join(directory, 'media', tenant, filename));
    return { data: `data:image/webp;base64,${bytes.toString('base64')}`, crop: { zoom: 1, x: 50, y: 50 }, original: false };
  } catch { throw new DomainError('INVALID_PHOTO', 'Fotoğraf bulunamadı.', 404); }
}
