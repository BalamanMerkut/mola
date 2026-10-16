// Hazır şablon görselleri (docs/SABLON_GORSELLERI.md): the owner's studio photos → templates/gorseller/, the files a new
// business's starter menu gets as its product photos (server/template-photos.ts).
//   npx tsx scripts/sablon-gorselleri.ts <fotoğraf-klasörü>
// Every photo in the folder (PNG, JPEG or WebP; named by product id, e.g. latte.png, d-fistikli.png) becomes <ad>.webp
// (800×800) and <ad>-small.webp (320×320), the sizes an upload is stored in (server/photos.ts), without metadata. A photo
// used by several products (tea.png: tea, d-cay, r-cay) is written once; server/template-photos.ts SHARED_TEMPLATE_PHOTOS
// says who else uses it. Files of photos no longer in the folder are removed, so the same folder always gives the same result.
// At the end: sizes, and every template product with the photo it gets (or "çizim": it keeps its drawing).
import { readdirSync, readFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { rasterBytes } from '../server/photos.js';
import { sectorTemplate } from '../server/sector-templates.js';
import { TEMPLATE_PHOTO_DIR, templatePhotoFiles } from '../server/template-photos.js';

const source = process.argv[2];
if (!source) { console.error('Kullanım: npx tsx scripts/sablon-gorselleri.ts <fotoğraf-klasörü>'); process.exit(2); }
const out = resolve(TEMPLATE_PHOTO_DIR), LIMIT = 150 * 1024;
const photos = readdirSync(source).filter(f => ['.png', '.jpg', '.jpeg', '.webp'].includes(extname(f).toLowerCase())).sort();
if (!photos.length) { console.error(`${source}: fotoğraf yok.`); process.exit(1); }
mkdirSync(out, { recursive: true });
const names = new Set<string>();
for (const file of photos) {
  const name = file.slice(0, -extname(file).length).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(name)) throw new Error(`${file}: ad yalnız küçük harf, rakam ve tire olabilir (ürün kimliği).`);
  if (names.has(name)) throw new Error(`${name}: aynı ada iki fotoğraf var.`);
  const bytes = readFileSync(join(source, file));
  // The owner's files say .png but are JPEG inside: the bytes decide, not the name.
  if (!rasterBytes(bytes)) throw new Error(`${file}: PNG, JPEG ya da WebP değil.`);
  const image = () => sharp(bytes, { limitInputPixels: 64_000_000 }).rotate();
  const large = await image().resize(800, 800, { fit: 'cover' }).webp({ quality: 85, effort: 6 }).toBuffer();
  const small = await image().resize(320, 320, { fit: 'cover' }).webp({ quality: 78, effort: 6 }).toBuffer();
  writeFileSync(join(out, `${name}.webp`), large); writeFileSync(join(out, `${name}-small.webp`), small);
  names.add(name);
  console.log(`${name.padEnd(18)} ${(large.length / 1024).toFixed(0).padStart(4)} KB + ${(small.length / 1024).toFixed(0).padStart(3)} KB${large.length > LIMIT ? '  UYARI: 150 KB üstü' : ''}`);
}
for (const file of readdirSync(out)) {
  const m = /^(.+?)(-small)?\.webp$/.exec(file);
  if (!m || !names.has(m[1])) { rmSync(join(out, file)); console.log(`Silindi (klasörde fotoğrafı yok): ${file}`); }
}
const size = readdirSync(out).reduce((n, f) => n + statSync(join(out, f)).size, 0);
console.log(`\n${names.size} görsel, ${names.size * 2} dosya, ${(size / 1024).toFixed(0)} KB → ${out}`);
for (const sector of ['cafe', 'dessert', 'restaurant'] as const) {
  const list = sectorTemplate(sector).products.map(p => `${p.id}: ${templatePhotoFiles(p.id, out)?.name ?? 'çizim'}`);
  console.log(`\n${sector}\n  ${list.join('\n  ')}`);
}
