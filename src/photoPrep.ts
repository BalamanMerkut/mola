/*
 * Telefondan ürün fotoğrafı (11 Ekim, "Kaynak fotoğraf çok büyük"): a phone photo is 12–48 MP and 3–25 MB, and iPhone Safari
 * cannot make WebP (canvas.toBlob quietly gives a PNG of several MB instead). So the photo is made small here, in the browser,
 * before anything is sent: decoded once with its EXIF orientation applied, drawn at most 2048 px on its long side, and saved
 * as WebP where the browser can, else JPEG, quality ~0.85, stepping down until it fits the server's limits (server/photos.ts
 * keeps them: crop 1 MB, source 4 MB). HEIC (iPhone) opens where the browser can decode it (Safari; iOS usually hands over a
 * JPEG anyway); elsewhere the owner gets a plain sentence on what to do.
 */
export const SOURCE_SIDE = 2048;
/** The server's limits (server/photos.ts), with room for the base64 text around them. */
export const SOURCE_BYTES = 3_900_000, CROP_BYTES = 950_000;
/** The file itself: a 48 MP JPEG is ~25 MB; anything larger is not a photo from a phone. */
export const MAX_FILE_BYTES = 60 * 1024 * 1024;
/** Decoding needs width × height × 4 bytes of memory: 48 MP is 192 MB, 100 MP is the most a phone is asked for. */
export const MAX_PIXELS = 100_000_000;
export type PhotoSource = HTMLCanvasElement | HTMLImageElement;
export const sizeOf = (s: PhotoSource) => s instanceof HTMLImageElement ? { width: s.naturalWidth, height: s.naturalHeight } : { width: s.width, height: s.height };
const heic = (file: File) => /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
export const HEIC_MESSAGE = 'Bu iPhone fotoğrafı (HEIC) bu tarayıcıda açılamadı. Fotoğrafı iPhone’da Safari ile seçin (Safari onu kendiliğinden JPG yapar) ya da iPhone’da Ayarlar → Kamera → Biçimler → “En Uyumlu”yu seçip yeniden çekin.';

async function decode(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; close: () => void }> {
  // createImageBitmap applies the EXIF orientation ("from-image") and can decode off the main thread.
  if (typeof createImageBitmap === 'function') {
    try { const b = await createImageBitmap(file, { imageOrientation: 'from-image' }); return { image: b, width: b.width, height: b.height, close: () => b.close() }; } catch { /* the <img> way below */ }
  }
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.decoding = 'async'; img.src = url; await img.decode(); return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} }; }
  finally { URL.revokeObjectURL(url); }
}
/** The chosen file as a canvas of at most 2048 px on its long side, upright. Throws a plain Turkish message. */
export async function preparePhoto(file: File): Promise<HTMLCanvasElement> {
  if (!(file.type.startsWith('image/') || heic(file))) throw new Error('Fotoğraf dosyası seçin (JPG, PNG, WebP ya da iPhone HEIC).');
  if (file.size > MAX_FILE_BYTES) throw new Error('Fotoğraf dosyası çok büyük (en fazla 60 MB). Başka bir fotoğraf seçin.');
  let d: Awaited<ReturnType<typeof decode>>;
  try { d = await decode(file); } catch { throw new Error(heic(file) ? HEIC_MESSAGE : 'Fotoğraf açılamadı. JPG, PNG ya da WebP bir fotoğraf seçin.'); }
  try {
    if (!d.width || !d.height) throw new Error('Fotoğraf açılamadı. Başka bir fotoğraf seçin.');
    if (d.width * d.height > MAX_PIXELS) throw new Error('Fotoğraf çok büyük. 100 megapikselden küçük bir fotoğraf seçin.');
    const ratio = Math.min(1, SOURCE_SIDE / Math.max(d.width, d.height));
    return scaled(d.image, d.width, d.height, ratio);
  } finally { d.close(); }
}
function scaled(image: CanvasImageSource, width: number, height: number, ratio: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Fotoğraf hazırlanamadı. Sayfayı yenileyip yeniden deneyin.');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
const blobOf = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Fotoğraf hazırlanamadı.')), type, quality));
const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = () => reject(new Error('Fotoğraf okunamadı.')); r.readAsDataURL(blob); });
/**
 * The canvas as a data URL of at most `limit` bytes: WebP, or JPEG where the browser cannot make WebP (Safari gives a PNG),
 * quality `quality` and lower, then a smaller picture if it still does not fit.
 */
export async function encodePhoto(canvas: HTMLCanvasElement, quality: number, limit: number): Promise<string> {
  let current = canvas;
  for (let round = 0; round < 4; round++) {
    for (const q of [quality, quality - .12, quality - .25]) {
      let blob = await blobOf(current, 'image/webp', q);
      if (blob.type !== 'image/webp') blob = await blobOf(current, 'image/jpeg', q);
      if (blob.size <= limit && /^image\/(webp|jpeg)$/.test(blob.type)) return dataUrl(blob);
    }
    current = scaled(current, current.width, current.height, .75);
  }
  throw new Error('Fotoğraf küçültülemedi. Başka bir fotoğraf seçin.');
}
