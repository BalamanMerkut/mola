// The developer studio's logo (brand/merkut-studios/merkut-studios-logo.jpg: eagle in a teal frame, "MERKUT STUDIOS", black
// ground) for the short opening screen (src/StudioSplash.tsx) and the Android app's native one (scripts/build-apk.mjs).
// The 1881×2000 source is cropped to the drawing (a thin black margin stays) and made 600 px wide: AVIF, WebP and a JPEG
// fallback. Nothing generated is kept in the source tree.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const SOURCE = new URL('../brand/merkut-studios/merkut-studios-logo.jpg', import.meta.url);
export const STUDIO_LOGO_WIDTH = 600;
/** The ground of the logo and of the opening screen around it. */
export const STUDIO_BLACK = '#000000';
let base;
/** Cropped to the drawing plus a 3 % black margin, 600 px wide (sRGB, no metadata). */
function cropped() {
  return base ??= (async () => {
    const input = readFileSync(SOURCE);
    const { info } = await sharp(input).trim({ background: '#000000', threshold: 24 }).toBuffer({ resolveWithObject: true });
    const left = -(info.trimOffsetLeft ?? 0), top = -(info.trimOffsetTop ?? 0);
    const meta = await sharp(input).metadata();
    const margin = Math.round(Math.max(info.width, info.height) * 0.03);
    const box = { left: Math.max(0, left - margin), top: Math.max(0, top - margin) };
    const region = { ...box, width: Math.min(meta.width - box.left, info.width + 2 * margin), height: Math.min(meta.height - box.top, info.height + 2 * margin) };
    return sharp(input).extract(region).resize({ width: STUDIO_LOGO_WIDTH }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  })();
}
const encoders = {
  avif: s => s.avif({ quality: 55, effort: 4 }),
  webp: s => s.webp({ quality: 82 }),
  jpg: s => s.jpeg({ quality: 82, mozjpeg: true }),
};
/** One format of the logo: { data, width, height }. */
export async function studioLogo(format) {
  const { data, info } = await cropped();
  const out = await encoders[format](sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })).toBuffer();
  return { data: out, width: info.width, height: info.height };
}
/** Android: the logo for res/drawable-nodpi (WebP, read by Android 4+). */
export const androidStudioLogo = () => studioLogo('webp');

const ID = 'virtual:merkut-studios-logo', RESOLVED = '\0' + ID;
/**
 * Vite: `import logo from 'virtual:merkut-studios-logo'` gives { avif, webp, jpg, width, height }. A build emits the three
 * files into dist/assets (hashed names; served like every other asset); development hands them out as data: URLs.
 */
export function studioLogoPlugin() {
  let build = false;
  return {
    name: 'merkut-studios-logo',
    configResolved(config) { build = config.command === 'build'; },
    resolveId(id) { return id === ID ? RESOLVED : undefined; },
    async load(id) {
      if (id !== RESOLVED) return undefined;
      const files = {}, size = { width: 0, height: 0 };
      for (const format of Object.keys(encoders)) {
        const { data, width, height } = await studioLogo(format);
        Object.assign(size, { width, height });
        if (build) files[format] = `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: 'asset', name: `merkut-studios.${format}`, source: data })}`;
        else files[format] = JSON.stringify(`data:image/${format === 'jpg' ? 'jpeg' : format};base64,${data.toString('base64')}`);
      }
      return `export default { avif: ${files.avif}, webp: ${files.webp}, jpg: ${files.jpg}, width: ${size.width}, height: ${size.height} };`;
    },
  };
}
