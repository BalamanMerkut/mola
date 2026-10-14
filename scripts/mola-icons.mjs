// Every Mola icon comes from one drawing: scripts/desktop/mola-icon.svg (green rounded square, cream coffee cup); Mola Yönetim
// is the same drawing on near-black (scripts/desktop/mola-yonetim-icon.svg). Used by vite.config.ts (web app icons, generated at
// build time and served on the fly in development), scripts/build-apk.mjs (Android launcher icon), scripts/build-installer.mjs
// (the Windows .ico inside Mola.exe & co.) and scripts/ikon-sayfasi.mjs (docs/ekran/ikonlar.png). No PNG or ICO is kept in the
// source tree.
//
// Two kinds of drawing (10 Ekim; the owner: the installed Mola window's taskbar icon was blurry):
//   16, 20, 24, 32 px  pixel-grid drawings: every line on whole pixels (1-px strokes at 16/20, 2-px at 24/32), so tab, title
//                      bar and 100 % taskbar icons are sharp. The 256 drawing scaled down to these sizes gave soft 1.2-px lines.
//   40 px and up       the detailed 256 drawing.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const source = readFileSync(new URL('./desktop/mola-icon.svg', import.meta.url), 'utf8');
const glyph = /<g[\s\S]*<\/g>/.exec(source)?.[0];
if (!glyph) throw new Error('mola-icon.svg içinde fincan çizimi (<g>) bulunamadı.');
export const MOLA_GREEN = '#234c3e';
/** Mola Yönetim: the same cup, walnut on brass (14 Ekim; was near-black), as src/MolaLogo.tsx YonetimBrand and scripts/desktop/mola-yonetim-icon.svg. */
export const YONETIM_FILL = '#c9a368';
const CREAM = '#f3ebdd', WALNUT = '#3a281e';
/** The cup's colour on a background: walnut on Yönetim's brass, cream on everything else. */
const cupOn = (fill) => fill === YONETIM_FILL ? WALNUT : CREAM;
const tinted = (svg, fill) => fill === YONETIM_FILL ? svg.split(CREAM).join(WALNUT) : svg;
const SVG = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">${body}</svg>`;
// The cup sits in a 24-unit box centred on (12, 11.5); `k` is its scale in the 256 box (the desktop icon uses 7.2).
const cup = (k) => glyph.replace(/transform="[^"]*"/, `transform="translate(${+(128 - 12 * k).toFixed(2)} ${+(128 - 11.5 * k).toFixed(2)}) scale(${k})"`);

// Pixel-grid cups, drawn for their own size (stroke centres: x.5 for 1-px lines, whole numbers for 2-px lines). L/R cup walls,
// T top, B bottom, r its lower corners; the handle goes out to Hx and down to HB (corners c); three steam lines at `steam`
// from sy1 to sy2. Every drawing leaves the same margin left/right and top/bottom.
const PIXEL = {
  16: { w: 1, rx: 3.5, L: 2.5, R: 10.5, T: 6.5, B: 12.5, r: 2, Hx: 13.5, HB: 10.5, c: 1, steam: [4.5, 6.5, 8.5], sy1: 3, sy2: 5 },
  20: { w: 1, rx: 4.5, L: 3.5, R: 13.5, T: 7.5, B: 16.5, r: 2.5, Hx: 16.5, HB: 13.5, c: 1.5, steam: [5.5, 8.5, 11.5], sy1: 3, sy2: 6 },
  24: { w: 2, rx: 5, L: 4, R: 16, T: 9, B: 20, r: 3, Hx: 20, HB: 16, c: 2, steam: [6, 10, 14], sy1: 3, sy2: 6 },
};
function pixelCup(size, fill) {
  const p = PIXEL[size];
  const body = `M${p.L} ${p.T}V${p.B - p.r}A${p.r} ${p.r} 0 0 0 ${p.L + p.r} ${p.B}H${p.R - p.r}A${p.r} ${p.r} 0 0 0 ${p.R} ${p.B - p.r}V${p.T}Z`;
  const handle = `M${p.R} ${p.T}H${p.Hx - p.c}A${p.c} ${p.c} 0 0 1 ${p.Hx} ${p.T + p.c}V${p.HB - p.c}A${p.c} ${p.c} 0 0 1 ${p.Hx - p.c} ${p.HB}H${p.R}`;
  const steam = p.steam.map(x => `<path d="M${x} ${p.sy1}V${p.sy2}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${p.rx}" fill="${fill}"/>` +
    `<g fill="none" stroke="${cupOn(fill)}" stroke-width="${p.w}" stroke-linecap="butt" stroke-linejoin="miter"><path d="${body}"/><path d="${handle}"/>${steam}</g></svg>\n`;
}

export const iconSvg = {
  /** The desktop icon as it is: rounded corners, transparent outside. "any" icons, the large Windows icon sizes. */
  rounded: (fill = MOLA_GREEN) => fill === MOLA_GREEN ? source : tinted(source.replace(MOLA_GREEN, fill), fill),
  /** Full square, smaller cup: maskable icons (Android crops to a circle or squircle, safe zone 80 %) and iOS. */
  square: (k = 6, fill = MOLA_GREEN) => tinted(SVG(`<rect width="256" height="256" fill="${fill}"/>${cup(k)}`), fill),
  /** Cup only, transparent: the Android adaptive icon's foreground layer (and its monochrome layer). */
  cup: (k = 5.4) => SVG(cup(k)),
  /**
   * Browser tabs (favicon.svg, favicon-32.png) and the 32-px Windows icon: the cup on a 32-px grid at its own 24-px size with
   * 2-px strokes, so every line falls on whole pixels. public/favicon.svg and public/favicon-yonetim.svg are exactly this text
   * (tests/mobile-app.test.ts).
   */
  small: (fill = MOLA_GREEN) => tinted(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="7" fill="${fill}"/>${glyph.replace(/transform="[^"]*"/, 'transform="translate(4 5)"').replace(/stroke-width="[^"]*"/, 'stroke-width="2"')}</svg>\n`, fill),
  /** The drawing for one icon size: pixel-grid at 16/20/24/32, the detailed one from 40 px up. */
  forSize: (size, fill = MOLA_GREEN) => PIXEL[size] ? pixelCup(size, fill) : size === 32 ? iconSvg.small(fill) : iconSvg.rounded(fill),
};
export function renderPng(svg, size) {
  return sharp(Buffer.from(svg), { density: Math.max(72, Math.ceil(72 * size / 256)) }).resize(size, size).png().toBuffer();
}

/** The web app's icons (public paths at the site root): manifest.webmanifest, manifest-yonetim.webmanifest and the pages name these. */
export const WEB_ICONS = {
  'favicon-16.png': [() => iconSvg.forSize(16), 16],
  'favicon-32.png': [() => iconSvg.small(), 32],
  // Mola Yönetim's tab and window (merkez.html): brass.
  'favicon-yonetim-16.png': [() => iconSvg.forSize(16, YONETIM_FILL), 16],
  'favicon-yonetim-32.png': [() => iconSvg.small(YONETIM_FILL), 32],
  'icon-192.png': [iconSvg.rounded, 192],
  'icon-256.png': [iconSvg.rounded, 256],
  'icon-512.png': [iconSvg.rounded, 512],
  'icon-maskable-192.png': [() => iconSvg.square(), 192],
  'icon-maskable-512.png': [() => iconSvg.square(), 512],
  'icon-yonetim-192.png': [() => iconSvg.rounded(YONETIM_FILL), 192],
  'icon-yonetim-256.png': [() => iconSvg.rounded(YONETIM_FILL), 256],
  'icon-yonetim-512.png': [() => iconSvg.rounded(YONETIM_FILL), 512],
  'icon-yonetim-maskable-512.png': [() => iconSvg.square(6, YONETIM_FILL), 512],
  // iOS rounds the corners itself and shows transparency as black: a full square.
  'apple-touch-icon.png': [() => iconSvg.square(6.4), 180],
};
const made = new Map();
export function webIcon(name) {
  const entry = WEB_ICONS[name];
  if (!entry) return undefined;
  if (!made.has(name)) made.set(name, renderPng(entry[0](), entry[1]));
  return made.get(name);
}

/** Vite: emits the icons into dist/ at build time; development serves the same files from memory. */
export function molaIcons() {
  return {
    name: 'mola-icons',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '');
        const png = Object.hasOwn(WEB_ICONS, name) ? webIcon(name) : undefined;
        if (!png) return next();
        png.then(data => { res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'no-cache'); res.end(data); }, next);
      });
    },
    async generateBundle() {
      for (const name of Object.keys(WEB_ICONS)) this.emitFile({ type: 'asset', fileName: name, source: await webIcon(name) });
    },
  };
}

// ---------- Windows icons (.ico inside Mola.exe, Mola Kurulum.exe, Mola-Kaldir.exe and the Mola Yönetim twins) ----------
/** Every size Windows asks for at 100/125/150/200 % (16·20·24·32 small and taskbar, 40·48·64 large, 96·128·256 Explorer views). */
export const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

/** A multi-size .ico: classic 32-bit bitmaps below 256 px (every Windows API and .NET reads them), 256 px as PNG. */
export async function icoFile(fill = MOLA_GREEN) {
  const entries = [];
  for (const size of ICO_SIZES) {
    const png = await renderPng(iconSvg.forSize(size, fill), size);
    if (size === 256) { entries.push({ size, data: png }); continue; }
    const raw = await sharp(png).ensureAlpha().raw().toBuffer();
    const header = Buffer.alloc(40); header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8); header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14);
    header.writeUInt32LE(size * size * 4, 20);
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4, to = ((size - 1 - y) * size + x) * 4;
      pixels[to] = raw[from + 2]; pixels[to + 1] = raw[from + 1]; pixels[to + 2] = raw[from]; pixels[to + 3] = raw[from + 3];
    }
    // AND mask (rows padded to 4 bytes): all zero, the alpha channel decides.
    entries.push({ size, data: Buffer.concat([header, pixels, Buffer.alloc(Math.ceil(size / 32) * 4 * size)]) });
  }
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const directory = entries.map(({ size, data }) => {
    const e = Buffer.alloc(16); e[0] = size % 256; e[1] = size % 256; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length; return e;
  });
  return Buffer.concat([head, ...directory, ...entries.map(e => e.data)]);
}

/** The images of an .ico file: [{ size, data }] (data: PNG or a 32-bit bitmap without file header, as stored). */
export function icoImages(ico) {
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('ICO dosyası değil.');
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const e = 6 + 16 * i;
    return { size: ico[e] || 256, data: ico.subarray(ico.readUInt32LE(e + 12), ico.readUInt32LE(e + 12) + ico.readUInt32LE(e + 8)) };
  });
}

/** The icon a Windows program shows (its first icon group, as Explorer and the taskbar read it): [{ size, data }]. */
export function exeIconImages(exe) {
  const pe = exe.readUInt32LE(0x3c);
  if (exe.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('Windows programı değil.');
  const first = pe + 24 + exe.readUInt16LE(pe + 20);
  let rsrc;
  for (let i = 0; i < exe.readUInt16LE(pe + 6); i++) {
    const s = first + 40 * i;
    if (exe.toString('latin1', s, s + 8).replace(/\0+$/, '') === '.rsrc') rsrc = { rva: exe.readUInt32LE(s + 12), raw: exe.readUInt32LE(s + 20) };
  }
  if (!rsrc) return [];
  // Resource directories: offsets relative to the section; leaves point at data entries (RVA + size).
  const entries = (at) => Array.from({ length: exe.readUInt16LE(at + 12) + exe.readUInt16LE(at + 14) }, (_, k) => {
    const e = at + 16 + 8 * k, name = exe.readUInt32LE(e), target = exe.readUInt32LE(e + 4);
    return { id: name & 0x80000000 ? undefined : name, at: rsrc.raw + (target & 0x7fffffff), dir: !!(target & 0x80000000) };
  });
  const leaf = (at) => { let e = { at, dir: true }; while (e.dir) e = entries(e.at)[0]; const rva = exe.readUInt32LE(e.at); return exe.subarray(rva - rsrc.rva + rsrc.raw, rva - rsrc.rva + rsrc.raw + exe.readUInt32LE(e.at + 4)); };
  const type = (id) => entries(rsrc.raw).find(e => e.id === id);
  const groups = type(14), icons = type(3);
  if (!groups || !icons) return [];
  const group = leaf(entries(groups.at)[0].at), byId = new Map(entries(icons.at).map(e => [e.id, e.at]));
  return Array.from({ length: group.readUInt16LE(4) }, (_, i) => {
    const e = 6 + 14 * i;
    return { size: group[e] || 256, data: leaf(byId.get(group.readUInt16LE(e + 12))) };
  });
}

/** One icon image (PNG, or a 32-bit bitmap as stored in .ico/.exe) as PNG. */
export async function iconImagePng(data) {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return Buffer.from(data);
  const width = data.readInt32LE(4), height = data.readInt32LE(8) / 2, bits = data.readUInt16LE(14), header = data.readUInt32LE(0);
  if (bits !== 32) throw new Error(`Desteklenmeyen simge biçimi: ${bits} bit`);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = header + ((height - 1 - y) * width + x) * 4, to = (y * width + x) * 4;
    rgba[to] = data[from + 2]; rgba[to + 1] = data[from + 1]; rgba[to + 2] = data[from]; rgba[to + 3] = data[from + 3];
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
