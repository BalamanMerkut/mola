import QRCode from 'qrcode';
import { tableLabelSize } from '../packages/domain/table-label';

/*
 * One table's QR as a PNG ("QR kodunu indir" in Masalar → masa → QR menü): the code with the table's name under it, large and
 * bold (packages/domain/table-label.ts), so a sticker made from it reads like the printed A4 sheet. A long custom name wraps
 * on spaces and steps down in size; a single very long word is broken as a last resort. Drawn in the browser, nothing fetched.
 */
const FONT = '"Segoe UI", Arial, Helvetica, sans-serif';
const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('image')); img.src = src; });

/** The name in lines that fit `max` px at `size` (words kept whole while they fit; a longer word is cut into pieces). */
export function lines(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const out: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    const last = out.at(-1);
    if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= max) { out[out.length - 1] = `${last} ${word}`; continue; }
    let piece = word;
    while (ctx.measureText(piece).width > max && piece.length > 1) {
      let cut = piece.length - 1; while (cut > 1 && ctx.measureText(piece.slice(0, cut)).width > max) cut--;
      out.push(piece.slice(0, cut)); piece = piece.slice(cut);
    }
    out.push(piece);
  }
  return out;
}

export async function tableQrPng(url: string, tableName: string, businessName: string): Promise<string> {
  const W = 1000, side = 760, canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
  // The name's lines decide the height: measured first on the same context.
  let size = tableLabelSize(tableName, 'png'), text: string[] = [];
  for (; ; size -= 6) {
    ctx.font = `800 ${size}px ${FONT}`; text = lines(ctx, tableName, W - 120);
    if (text.length <= 2 || size <= 60) break;
  }
  const lineH = Math.round(size * 1.12), H = 70 + 50 + side + 40 + text.length * lineH + 90;
  canvas.width = W; canvas.height = H;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#4a5a50'; ctx.font = `600 34px ${FONT}`;
  ctx.fillText(businessName, W / 2, 80, W - 120);
  const qr = await load(await QRCode.toDataURL(url, { width: side, margin: 1, color: { dark: '#000000', light: '#ffffff' } }));
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(qr, (W - side) / 2, 110, side, side); ctx.restore();
  let y = 110 + side + 40 + size * 0.9;
  ctx.fillStyle = '#111111'; ctx.font = `800 ${size}px ${FONT}`;
  for (const line of text) { ctx.fillText(line, W / 2, y, W - 80); y += lineH; }
  ctx.fillStyle = '#4a5a50'; ctx.font = `400 30px ${FONT}`;
  ctx.fillText('Menü ve sipariş için telefonunuzun kamerasıyla okutun.', W / 2, y + 22, W - 120);
  return canvas.toDataURL('image/png');
}
