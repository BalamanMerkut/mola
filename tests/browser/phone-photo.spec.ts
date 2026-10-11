import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { ensureSetup, openView } from './helpers';

/*
 * Telefondan ürün fotoğrafı (11 Ekim, "Kaynak fotoğraf çok büyük"): 12 MP and 48 MP phone photos are made at most 2048 px in
 * the browser before upload (src/photoPrep.ts), upright by their EXIF orientation, as WebP or, where the browser cannot make
 * WebP (iPhone Safari gives a PNG of several MB, the real cause), as JPEG. The server's limits stay (server/photos.ts).
 */
const side = (w: number, h: number) => ({ create: { width: w, height: h, channels: 3 as const, background: '#c9a27a', noise: { type: 'gaussian' as const, mean: 128, sigma: 22 } } });
/** A camera-like JPEG: noise (does not compress away), the top half red and the bottom half blue, with an EXIF orientation. */
async function cameraPhoto(width: number, height: number, orientation = 1) {
  const noise = await sharp(side(width, height)).jpeg().toBuffer();
  const half = await sharp({ create: { width, height: Math.round(height / 2), channels: 3, background: '#d02020' } }).png().toBuffer();
  const bottom = await sharp({ create: { width, height: height - Math.round(height / 2), channels: 3, background: '#2030d0' } }).png().toBuffer();
  return sharp(noise).composite([{ input: half, top: 0, left: 0, blend: 'overlay' }, { input: bottom, top: Math.round(height / 2), left: 0, blend: 'overlay' }]).withMetadata({ orientation }).jpeg({ quality: 92 }).toBuffer();
}
async function openEditor(page: Page) {
  await page.goto('/'); await openView(page, 'Menü yönetimi');
  await page.getByRole('button', { name: 'Ürün ekle', exact: true }).click();
}
/** Chooses the file, uses the crop, and returns what was sent and what the server keeps as the source. */
async function upload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  const sent: number[] = [];
  const watch = (r: import('@playwright/test').Request) => { if (r.url().endsWith('/api/staff/photos') && r.method() === 'POST') sent.push(r.postDataBuffer()?.length ?? 0); };
  page.on('request', watch);
  await page.getByLabel('Ürün fotoğrafı seç').setInputFiles({ name, mimeType, buffer });
  await expect(page.getByLabel('Fotoğraf kırpma önizlemesi')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Fotoğrafı kullan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fotoğrafı kaldır' })).toBeVisible({ timeout: 20_000 });
  page.off('request', watch);
  const photo = await page.locator('.photo-current img').getAttribute('src');
  const source = await (await page.request.post('/api/staff/photo-source', { data: { photo: new URL(photo!, 'http://x').pathname } })).json();
  const bytes = Buffer.from(source.data.slice(source.data.indexOf(',') + 1), 'base64');
  return { sent: sent[0], meta: await sharp(bytes).metadata(), bytes };
}

test('phone photos: 12 MP and 48 MP are made small before upload, kept upright, JPEG where WebP cannot be made, HEIC explained', async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } }); await ensureSetup(page.request);
  await page.setViewportSize({ width: 1280, height: 900 });

  // 12 MP, held sideways: EXIF orientation 6 (the camera's "rotate 90°"). The source arrives upright: portrait, 2048 tall.
  const twelve = await cameraPhoto(4000, 3000, 6);
  info.annotations.push({ type: '12 MP', description: `${(twelve.length / 1e6).toFixed(1)} MB` });
  await openEditor(page);
  const a = await upload(page, 'IMG_1201.JPG', 'image/jpeg', twelve);
  expect(a.sent).toBeLessThan(5_500_000);
  expect([a.meta.width, a.meta.height]).toEqual([1536, 2048]);
  // Upright: the photo's top (red) is on the right after a quarter turn, its bottom (blue) on the left.
  const { data } = await sharp(a.bytes).resize(4, 4, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => { const i = (y * 4 + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  expect(px(3, 1)[0]).toBeGreaterThan(px(3, 1)[2]);
  expect(px(0, 1)[2]).toBeGreaterThan(px(0, 1)[0]);

  // 48 MP (8000 × 6000), the big phone sensors: refused before (40 MP and 10 MB limits); now just made small.
  const big = await cameraPhoto(8000, 6000);
  info.annotations.push({ type: '48 MP', description: `${(big.length / 1e6).toFixed(1)} MB` });
  expect(big.length).toBeGreaterThan(10 * 1024 * 1024);
  await openEditor(page);
  const b = await upload(page, 'IMG_4801.JPG', 'image/jpeg', big);
  expect(b.sent).toBeLessThan(5_500_000);
  expect([b.meta.width, b.meta.height]).toEqual([2048, 1536]);
  await page.screenshot({ path: info.outputPath('photo-48mp.png') });
});

test('a browser that cannot make WebP (iPhone Safari) sends JPEG instead of a huge PNG; HEIC it cannot open gets a plain sentence', async ({ page }) => {
  test.setTimeout(120_000);
  // Safari's canvas gives PNG for "image/webp": the old code sent that PNG and the server said "Kaynak fotoğraf çok büyük".
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback, type?: string, quality?: number) { return original.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality); };
  });
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } }); await ensureSetup(page.request);
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  const c = await upload(page, 'IMG_2001.JPG', 'image/jpeg', await cameraPhoto(4032, 3024));
  expect(c.sent).toBeLessThan(5_500_000);
  expect([c.meta.width, c.meta.height]).toEqual([2048, 1536]);
  await expect(page.getByRole('dialog')).not.toContainText('çok büyük');
  // An iPhone HEIC this browser cannot decode: what to do, in plain words; nothing is sent.
  await page.getByRole('button', { name: 'Fotoğrafı kaldır' }).click();
  await page.getByLabel('Ürün fotoğrafı seç').setInputFiles({ name: 'IMG_3001.HEIC', mimeType: 'image/heic', buffer: Buffer.from('00000018667479706865696300000000', 'hex') });
  await expect(page.getByRole('dialog')).toContainText('Bu iPhone fotoğrafı (HEIC) bu tarayıcıda açılamadı.');
  await expect(page.getByRole('dialog')).toContainText('En Uyumlu');
  // Not a photo at all.
  await page.getByLabel('Ürün fotoğrafı seç').setInputFiles({ name: 'menu.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(page.getByRole('dialog')).toContainText('Fotoğraf dosyası seçin');
});
