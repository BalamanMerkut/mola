// docs/ekran/ikonlar.png: every Mola icon at its real size, to check by eye that the small ones are sharp (10 Ekim; the
// installed Mola window's taskbar icon was blurry). The Windows icons are read back from the built programs
// (.local/installer/Mola-<sürüm>/…/Mola.exe, Mola Yönetim.exe) when they exist, otherwise made here the same way
// (scripts/mola-icons.mjs icoFile). Next to the real size, 16–32 px are also shown 6× enlarged without smoothing, so every
// pixel can be seen. The web icons come from the same module as dist/.
//
//   node scripts/ikon-sayfasi.mjs [--cikti=<png>] [--paketsiz]   (--paketsiz: never read the built programs)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { ICO_SIZES, MOLA_GREEN, YONETIM_FILL, exeIconImages, icoFile, icoImages, iconImagePng, webIcon } from './mola-icons.mjs';

const option = name => process.argv.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
const output = resolve(option('--cikti') ?? 'docs/ekran/ikonlar.png');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const built = resolve('.local/installer', `Mola-${version}`);

async function windowsIcon(exe, fill) {
  if (existsSync(exe) && !process.argv.includes('--paketsiz')) {
    const images = exeIconImages(readFileSync(exe));
    if (images.length) return { from: `${relative(process.cwd(), exe).replaceAll('\\', '/')} içindeki simge`, images };
  }
  return { from: 'scripts/mola-icons.mjs icoFile (paket henüz derlenmedi)', images: icoImages(await icoFile(fill)) };
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const WIDTH = 1180, PAD = 24, GAP = 22;
const texts = [], rects = [], images = [];
let y = PAD;
const text = (x, at, value, size = 14, weight = 400, color = '#24302a') => texts.push(`<text x="${x}" y="${at}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(value)}</text>`);
const rect = (x, top, w, h, fill) => rects.push(`<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="10" fill="${fill}"/>`);
const zoom = (png, size, k) => sharp(png).resize(size * k, size * k, { kernel: 'nearest' }).png().toBuffer();

text(PAD, y + 22, 'Mola simgeleri: gerçek boyut ve 6× büyütülmüş (yumuşatmasız)', 22, 600); y += 34;
text(PAD, y + 16, 'Windows simgesi (.ico): 16, 20, 24, 32 piksel ızgarasına çizilmiş; 40 ve üstü ayrıntılı çizim. Görev çubuğu 100 % = 24, 125 % = 30→32, 150 % = 36→40, 200 % = 48.', 13, 400, '#56645b'); y += 34;

for (const [name, exe, fill] of [['Mola (kafe)', join(built, 'Windows', 'program', 'Mola.exe'), MOLA_GREEN], ['Mola Yönetim', join(built, 'Mola-Yonetim', 'program', 'Mola Yönetim.exe'), YONETIM_FILL]]) {
  const icon = await windowsIcon(exe, fill);
  const sizes = icon.images.map(i => i.size);
  for (const want of ICO_SIZES) if (!sizes.includes(want)) throw new Error(`${name}: ${want} px simge yok (${icon.from}).`);
  text(PAD, y + 18, name, 17, 600); text(PAD + 150, y + 18, icon.from, 13, 400, '#56645b'); y += 30;
  // Every size at its real size on white, bottom-aligned.
  rect(PAD, y, WIDTH - 2 * PAD, 256 + 50, '#ffffff');
  let x = PAD + 16;
  for (const image of icon.images.sort((a, b) => a.size - b.size)) {
    images.push({ input: await iconImagePng(image.data), left: x, top: y + 16 + 256 - image.size });
    text(x, y + 256 + 38, `${image.size}`, 12, 400, '#56645b');
    x += image.size + GAP;
  }
  y += 256 + 50 + 12;
  // Small sizes on a dark taskbar-like strip, then 16–32 enlarged.
  rect(PAD, y, WIDTH - 2 * PAD, 230, '#202020');
  x = PAD + 16;
  const small = icon.images.filter(i => i.size <= 48);
  for (const image of small) {
    images.push({ input: await iconImagePng(image.data), left: x, top: y + 20 + 48 - image.size });
    text(x, y + 88, `${image.size}`, 12, 400, '#c9c9c9');
    x += image.size + 18;
  }
  x += 20;
  for (const image of small.filter(i => i.size <= 32)) {
    images.push({ input: await zoom(await iconImagePng(image.data), image.size, 6), left: x, top: y + 16 });
    text(x, y + 16 + image.size * 6 + 18, `${image.size} px · 6×`, 12, 400, '#c9c9c9');
    x += image.size * 6 + 18;
  }
  y += 230 + 22;
}

// Web icons (dist/): tab icons, then the large ones of the two manifests.
text(PAD, y + 18, 'Web simgeleri (dist/; sekme simgeleri gerçek boyut + 4×, büyükler 160 px gösterim)', 17, 600); y += 30;
rect(PAD, y, WIDTH - 2 * PAD, 232, '#f6f7f4');
let x = PAD + 16;
for (const file of ['favicon-16.png', 'favicon-32.png', 'favicon-yonetim-16.png', 'favicon-yonetim-32.png']) {
  const png = await webIcon(file), size = (await sharp(png).metadata()).width;
  images.push({ input: png, left: x, top: y + 16 });
  images.push({ input: await zoom(png, size, 4), left: x, top: y + 56 });
  text(x, y + 56 + size * 4 + 18, file.replace('.png', ''), 11, 400, '#56645b');
  x += Math.max(size * 4, 110) + 14;
}
for (const file of ['icon-192.png', 'icon-maskable-192.png', 'icon-yonetim-192.png']) {
  const png = await sharp(await webIcon(file)).resize(160, 160).png().toBuffer();
  images.push({ input: png, left: x, top: y + 16 });
  text(x, y + 196, file.replace('.png', ''), 11, 400, '#56645b');
  x += 160 + 26;
}
y += 232 + PAD;

const height = y;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}"><rect width="100%" height="100%" fill="#e9ece6"/>${rects.join('')}${texts.join('')}</svg>`;
const png = await sharp(Buffer.from(svg)).composite(images).png().toBuffer();
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, png);
console.log(`${relative(process.cwd(), output)}: ${WIDTH}×${height}`);
