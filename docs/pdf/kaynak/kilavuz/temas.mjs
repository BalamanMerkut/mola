// Önizleme sayfalarından temas sayfaları (kontrol için): node docs/pdf/kaynak/kilavuz/temas.mjs <önizleme klasörü> <çıktı öneki> [sütun] [satır]
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const [dir, out, cols = '4', rows = '3'] = process.argv.slice(2);
const files = readdirSync(dir).filter(f => /^sayfa-\d+\.png$/.test(f)).sort();
const C = Number(cols), R = Number(rows), W = 420, H = Math.round(W * 297 / 210);
for (let s = 0; s * C * R < files.length; s++) {
  const part = files.slice(s * C * R, (s + 1) * C * R);
  const comps = await Promise.all(part.map(async (f, i) => ({ input: await sharp(join(dir, f)).resize(W, H).png().toBuffer(), left: (i % C) * (W + 10), top: Math.floor(i / C) * (H + 10) })));
  await sharp({ create: { width: C * (W + 10), height: R * (H + 10), channels: 3, background: '#888' } }).composite(comps).png().toFile(`${out}-${String(s + 1).padStart(2, '0')}.png`);
}
console.log(files.length, 'sayfa');
