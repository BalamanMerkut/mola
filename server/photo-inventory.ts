import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PHOTO_QUOTA_BYTES } from './photos.js';
import { DomainError } from '../packages/domain/engine.js';
import type { State } from '../packages/domain/types.js';

export const PHOTO_GRACE_DAYS = 7;
export async function photoInventory(directory: string, tenant: string, readState: () => Pick<State, 'products' | 'productDrafts'>, now = new Date()) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(tenant)) throw new DomainError('INVALID_PHOTO', 'Fotoğraf alanı geçersiz.');
  const groups = new Map<string, { bytes: number; latest: number; parts: Set<string> }>();
  let otherBytes = 0;
  for (const area of ['media', 'photo-sources']) {
    const folder = join(resolve(directory), area, tenant);
    let entries;
    try { entries = await fs.readdir(folder, { withFileTypes: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      let stat;
      try { stat = await fs.lstat(join(folder, entry.name)); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
      if (!stat.isFile()) continue;
      const match = entry.name.match(area === 'media' ? /^([a-f0-9-]{36})(?:-small)?\.webp$/ : /^([a-f0-9-]{36})\.(?:webp|json)$/);
      if (!match) { otherBytes += stat.size; continue; }
      const group = groups.get(match[1]) ?? { bytes: 0, latest: 0, parts: new Set<string>() };
      if (stat.size > 0) group.parts.add(`${area}/${entry.name.slice(match[1].length)}`);
      group.bytes += stat.size; group.latest = Math.max(group.latest, stat.mtimeMs); groups.set(match[1], group);
    }
  }
  // Read references after scanning: a product saved during the scan must be protected too.
  const state = readState(), prefix = `/media/${tenant}/`, referenced = new Set<string>(), invalid = new Set<string>();
  for (const product of [...state.products, ...(state.productDrafts ?? [])]) {
    if (!product.photo) continue;
    if (!product.photo.startsWith(prefix)) { invalid.add(product.photo); continue; }
    const match = product.photo.slice(prefix.length).match(/^([a-f0-9-]{36})\.webp$/);
    if (match) referenced.add(match[1]); else invalid.add(product.photo);
  }
  const inUse = { count: 0, bytes: 0 }, recent = { count: 0, bytes: 0 }, unused = { count: 0, bytes: 0 };
  const cutoff = now.getTime() - PHOTO_GRACE_DAYS * 86400000;
  const integrity = { missingPhotos: 0, missingThumbnails: 0, incompleteSources: 0, incompleteOldUploads: 0, invalidReferences: invalid.size };
  const present = async (area: string, name: string) => {
    try { const stat = await fs.lstat(join(resolve(directory), area, tenant, name)); return stat.isFile() && stat.size > 0; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
  };
  // Recheck saved references after scanning so a just-saved upload is not reported missing.
  for (const id of referenced) {
    const [main, thumb, source, crop] = await Promise.all([present('media', `${id}.webp`), present('media', `${id}-small.webp`), present('photo-sources', `${id}.webp`), present('photo-sources', `${id}.json`)]);
    if (!main) integrity.missingPhotos++;
    if (!thumb) integrity.missingThumbnails++;
    if (source !== crop) integrity.incompleteSources++;
  }
  for (const [id, group] of groups) {
    const bucket = referenced.has(id) ? inUse : group.latest >= cutoff ? recent : unused;
    bucket.count++; bucket.bytes += group.bytes;
    if (bucket === unused && (!group.parts.has('media/.webp') || !group.parts.has('media/-small.webp') || group.parts.has('photo-sources/.webp') !== group.parts.has('photo-sources/.json'))) integrity.incompleteOldUploads++;
  }
  const usedBytes = inUse.bytes + recent.bytes + unused.bytes + otherBytes;
  return { usedBytes, limitBytes: PHOTO_QUOTA_BYTES, remainingBytes: Math.max(0, PHOTO_QUOTA_BYTES - usedBytes), inUse, recent, unused, otherBytes, integrity, graceDays: PHOTO_GRACE_DAYS, checkedAt: now.toISOString() };
}
