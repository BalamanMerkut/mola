import { existsSync, mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { State } from '../packages/domain/types.js';
import { DomainError } from '../packages/domain/engine.js';
const uuid = /^[a-f0-9-]{36}$/;
type Batch = { id: string; createdAt: string; restoredAt?: string; files: { area: string; name: string }[] };
function root(directory: string, tenant: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(tenant)) throw new DomainError('INVALID_PHOTO', 'Fotoğraf alanı geçersiz.');
  return join(directory, 'photo-trash', tenant);
}
export function trashBatches(directory: string, tenant: string): Batch[] {
  const folder = root(directory, tenant);
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter(id => uuid.test(id)).map(id => {
    const file = join(folder, id, 'manifest.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Batch : null;
  }).filter((x): x is Batch => !!x && !x.restoredAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
// Synchronous reference check and moves share one event-loop turn with product writes.
// The durable manifest is written first so even an interrupted move can be undone.
export function cleanPhotos(directory: string, tenant: string, s: State, now: Date) {
  const base = root(directory, tenant), references = new Set([...s.products, ...(s.productDrafts ?? [])].map(p => p.photo));
  const groups = new Map<string, { latest: number; files: Batch['files'] }>();
  for (const area of ['media', 'photo-sources']) {
    const folder = join(directory, area, tenant); if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder)) {
      const m = name.match(area === 'media' ? /^([a-f0-9-]{36})(?:-small)?\.webp$/ : /^([a-f0-9-]{36})\.(webp|json)$/);
      if (!m) continue;
      const stat = lstatSync(join(folder, name)); if (!stat.isFile()) continue;
      const group = groups.get(m[1]) ?? { latest: 0, files: [] };
      group.latest = Math.max(group.latest, stat.mtimeMs); group.files.push({ area, name }); groups.set(m[1], group);
    }
  }
  const files = [...groups].filter(([id, g]) => !references.has(`/media/${tenant}/${id}.webp`) && g.latest < now.getTime() - 7 * 86400000).flatMap(([, g]) => g.files);
  if (!files.length) return { count: 0 };
  const batch: Batch = { id: randomUUID(), createdAt: now.toISOString(), files }, folder = join(base, batch.id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify(batch), { flag: 'wx' });
  for (const file of files) {
    mkdirSync(join(folder, file.area), { recursive: true });
    renameSync(join(directory, file.area, tenant, file.name), join(folder, file.area, file.name));
  }
  return { count: files.length, id: batch.id };
}
export function restorePhotos(directory: string, tenant: string, id: string, now: Date) {
  if (!uuid.test(id)) throw new DomainError('INVALID_PHOTO', 'Geri alma kaydı geçersiz.');
  const folder = join(root(directory, tenant), id), manifest = join(folder, 'manifest.json');
  if (!existsSync(manifest)) throw new DomainError('NOT_FOUND', 'Geri alma kaydı bulunamadı.', 404);
  const batch = JSON.parse(readFileSync(manifest, 'utf8')) as Batch;
  if (batch.restoredAt) return { ok: true };
  for (const f of batch.files) {
    if (!['media', 'photo-sources'].includes(f.area) || !/^[a-f0-9-]{36}(?:-small)?\.(webp|json)$/.test(f.name)) throw new Error('Geçersiz fotoğraf günlüğü.');
    const source = join(folder, f.area, f.name), target = join(directory, f.area, tenant, f.name);
    if (existsSync(source) && existsSync(target)) throw new DomainError('PHOTO_CONFLICT', 'Aynı isimli dosya var. Üzerine yazılmadı.', 409);
    if (!existsSync(source) && !existsSync(target)) throw new Error('Geri alınacak dosya bulunamadı.');
  }
  for (const f of batch.files) { const source = join(folder, f.area, f.name); if (existsSync(source)) { mkdirSync(join(directory, f.area, tenant), { recursive: true }); renameSync(source, join(directory, f.area, tenant, f.name)); } }
  batch.restoredAt = now.toISOString();
  writeFileSync(join(folder, 'manifest.next'), JSON.stringify(batch)); renameSync(join(folder, 'manifest.next'), manifest);
  return { ok: true };
}
