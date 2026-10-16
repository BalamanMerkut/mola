import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Product } from '../packages/domain/types.js';

/*
 * Hazır şablon görselleri: the starter menus' product photos (kafe, restoran, tatlıcı). templates/gorseller/<ad>.webp (800×800)
 * and <ad>-small.webp (320×320), made from the owner's studio photos by `npx tsx scripts/sablon-gorselleri.ts <klasör>`, the
 * same sizes an upload is stored in (server/photos.ts). Each image is kept once; a product uses the one named by its id, or the
 * one SHARED_TEMPLATE_PHOTOS names (the tea of all three menus is one photo).
 * A business made from a template (a new business: server/kafe-link.ts createOwner; the sector's menu at first setup:
 * server/management.ts; "Tanıtımı sıfırla": server/demo-reset.ts) gets them as its own photos: every one is copied into
 * media/<işletme>/<uuid>.webp (+ -small) exactly as an upload is stored, so the owner can replace or remove it, the guest
 * menu shows it and the internet menu's copy (server/menu-mirror.ts) carries it. Businesses that exist already never change.
 * Every starter product has one. A missing or unreadable image never stops anything: that product keeps its drawing.
 */
export const TEMPLATE_PHOTO_DIR = 'templates/gorseller';
/** Products shown with another product's photo; every other one uses the photo named by its own id, when there is one. */
export const SHARED_TEMPLATE_PHOTOS: Record<string, string> = {
  'd-cay': 'tea', 'r-cay': 'tea', 'd-limonata': 'lemonade', 'r-su': 'd-su',
  // The photo has a glass of water but no lokum, though both menus say "lokumla".
  'd-turk-kahvesi': 'turkish', 'r-turk-kahvesi': 'turkish',
};
const NAME = /^[a-z0-9][a-z0-9-]{0,59}$/;
/** The image a template product is shown with ("tea" for d-cay), or undefined for a name that cannot be a file of ours. */
export function templatePhotoName(productId: string) {
  const name = SHARED_TEMPLATE_PHOTOS[productId] ?? productId;
  return NAME.test(name) ? name : undefined;
}
/** The image's two files in `folder` when both are there (the photo and its thumbnail), else undefined. */
export function templatePhotoFiles(productId: string, folder = resolve(TEMPLATE_PHOTO_DIR)) {
  const name = templatePhotoName(productId);
  if (!name) return undefined;
  const large = join(folder, `${name}.webp`), small = join(folder, `${name}-small.webp`);
  return existsSync(large) && existsSync(small) ? { name, large, small } : undefined;
}

/**
 * Gives every product of `products` that has a template photo and no photo yet its own copy of it (the products are changed in
 * place). Never throws: a product whose files cannot be read or written keeps its drawing. Returns how many got a photo.
 */
export function addTemplatePhotos(directory: string, tenant: string, products: Product[], folder = resolve(TEMPLATE_PHOTO_DIR)) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(tenant)) return 0;
  const media = join(resolve(directory), 'media', tenant), read = new Map<string, [Buffer, Buffer]>();
  let added = 0;
  for (const product of products) {
    if (product.photo) continue;
    const files = templatePhotoFiles(product.id, folder);
    if (!files) continue;
    const id = randomUUID(), written: string[] = [];
    try {
      let data = read.get(files.name);
      if (!data) { data = [readFileSync(files.large), readFileSync(files.small)]; read.set(files.name, data); }
      mkdirSync(media, { recursive: true });
      // Written, not copied: the files get today's time like an upload (server/photo-trash.ts reads it).
      for (const [file, bytes] of [[`${id}.webp`, data[0]], [`${id}-small.webp`, data[1]]] as const) { writeFileSync(join(media, file), bytes, { flag: 'wx' }); written.push(file); }
      product.photo = `/media/${tenant}/${id}.webp`; added++;
    } catch {
      for (const file of written) try { unlinkSync(join(media, file)); } catch { /* an unused file goes with the photo cleaning */ }
    }
  }
  return added;
}
