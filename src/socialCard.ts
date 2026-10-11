import QRCode from 'qrcode';
import { socialHandle, socialInfo, type SocialPlatform } from '../packages/domain/social-links';
import { themes, type ThemeId } from '../packages/domain/theme';
import { socialIconSvg } from './socialIcons';

/*
 * The permanent QR codes of the social links (Ayarlar → İşletme → Sosyal medya). Since 6 Ekim the QR holds the short address
 * at Mola Merkez (`qr`: <Merkez>/s/<code>/<platform>, packages/domain/social-links.ts), which forwards to the link while the
 * business's licence is active; the card still shows the account itself ("@molacoffee") from `url`. The same QR drawing as
 * the table codes (qrcode, black on white, quiet margin). `socialCard` draws the tidy card on a canvas: one platform ("Bizi
 * Instagram'da takip edin") or the combined "Bizi takip edin" card; `scale` 2 for the A4 PDF. Nothing is fetched.
 */
export type SocialItem = { platform: SocialPlatform; url: string; qr: string };
export type CardBusiness = { name: string; logo?: string; theme?: ThemeId };

/** The QR of one address: black on white like the printed table codes, error correction M (survives a scuffed sticker). */
export const socialQr = (url: string, width = 720) => QRCode.toDataURL(url, { width, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
/** The combined card's title: "Bizi takip edin", with the Google review "… ve değerlendirin", only the review "Bizi Google’da değerlendirin". */
export const combinedTitle = (items: SocialItem[]) => items.every(i => i.platform === 'review') ? socialInfo.review.card : items.some(i => i.platform === 'review') ? 'Bizi takip edin ve değerlendirin' : 'Bizi takip edin';

const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('image')); img.src = src; });
const iconImage = (platform: SocialPlatform, color: string) => load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(socialIconSvg(platform, color))}`);
const FONT = '"Segoe UI", Arial, Helvetica, sans-serif';

/** Text centred on x, shrunk until it fits `max` (and cut with "…" below 60 % of the size). */
function centred(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, size: number, weight = 600, color = '#24382e') {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > max && s > size * 0.6) { s -= 2; ctx.font = `${weight} ${s}px ${FONT}`; }
  let shown = text;
  while (ctx.measureText(shown).width > max && shown.length > 2) shown = `${shown.slice(0, -2)}…`;
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(shown, x, y);
}
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
/** The business's logo in a round frame, and its name under it: the header of both cards. Returns the y below it. */
async function header(ctx: CanvasRenderingContext2D, b: CardBusiness, width: number, top: number, ink: string) {
  let y = top;
  if (b.logo) {
    try {
      const logo = await load(b.logo), size = 128, x = (width - size) / 2;
      ctx.save(); ctx.beginPath(); ctx.arc(width / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, size, size);
      ctx.drawImage(logo, x, y, size, size); ctx.restore();
      y += size + 18;
    } catch { /* no logo then */ }
  }
  centred(ctx, b.name, width / 2, y + 44, width - 240, 46, 700, ink);
  return y + 66;
}
function frame(ctx: CanvasRenderingContext2D, w: number, h: number, soft: string, line: string) {
  ctx.fillStyle = soft; ctx.fillRect(0, 0, w, h);
  rounded(ctx, 48, 48, w - 96, h - 96, 56); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = line; ctx.stroke();
}
/** The QR made at exactly the pixels it takes on the canvas (and drawn without smoothing), so every module stays sharp. */
async function drawQr(ctx: CanvasRenderingContext2D, address: string, x: number, y: number, size: number, scale: number) {
  const image = await load(await socialQr(address, Math.round(size * scale)));
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(image, x, y, size, size); ctx.restore();
}

/** One platform's card (1080 × 1440) or the combined card (A4 shape, 1240 × 1754), times `scale`, on a canvas. */
export async function socialCard(items: SocialItem[], business: CardBusiness, combined = items.length > 1, scale = 1): Promise<HTMLCanvasElement> {
  const t = themes[business.theme ?? 'sage'] ?? themes.sage;
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
  if (!combined) {
    const [{ platform, url, qr }] = items, W = 1080, H = 1440;
    canvas.width = W * scale; canvas.height = H * scale; ctx.scale(scale, scale);
    frame(ctx, W, H, t.soft, `${t.primary}33`);
    // Centred in the frame: header (+ logo), mark, title, QR, handle and the hint are ~1030 px (~1170 px with a logo).
    let y = await header(ctx, business, W, Math.round(48 + (H - 96 - (business.logo ? 1172 : 1026)) / 2), t.ink);
    // The platform's mark in a filled circle of the business colour.
    const r = 62; y += r + 6;
    ctx.beginPath(); ctx.arc(W / 2, y, r, 0, Math.PI * 2); ctx.fillStyle = t.primary; ctx.fill();
    ctx.drawImage(await iconImage(platform, '#ffffff'), W / 2 - 38, y - 38, 76, 76);
    y += r + 74;
    centred(ctx, socialInfo[platform].card, W / 2, y, W - 200, 58, 700, t.ink);
    const qrSize = Math.min(600, H - 150 - (y + 30) - 110);
    await drawQr(ctx, qr, (W - qrSize) / 2, y + 30, qrSize, scale);
    y += 30 + qrSize + 70;
    centred(ctx, socialHandle(platform, url), W / 2, y, W - 200, 48, 650, t.primary);
    centred(ctx, 'Telefonunuzun kamerasıyla okutun', W / 2, y + 56, W - 200, 28, 400, '#6e7b6c');
    return canvas;
  }
  const W = 1240, H = 1754, n = items.length;
  canvas.width = W * scale; canvas.height = H * scale; ctx.scale(scale, scale);
  frame(ctx, W, H, t.soft, `${t.primary}33`);
  // One column for one or two accounts, two for three or four, three above; the QRs as large as the page allows, the whole
  // block centred in the frame.
  const cols = n <= 2 ? 1 : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), gap = 28, left = 96;
  const cellW = (W - left * 2 - gap * (cols - 1)) / cols, headH = (business.logo ? 146 : 0) + 66 + 150, room = H - 96 * 2 - 80 - headH;
  const qrSize = Math.floor(Math.max(140, Math.min(cellW - 70, (room - gap * (rows - 1)) / rows - 150, 560))), cellH = qrSize + 150;
  let y = await header(ctx, business, W, Math.round((H - headH - rows * cellH - gap * (rows - 1)) / 2), t.ink);
  centred(ctx, combinedTitle(items), W / 2, y + 58, W - 240, 72, 700, t.primary);
  centred(ctx, 'Telefonunuzun kamerasıyla okutun', W / 2, y + 108, W - 240, 30, 400, '#6e7b6c');
  y += 150;
  for (const [i, { platform, url, qr }] of items.entries()) {
    const cx = left + (i % cols) * (cellW + gap), cy = y + Math.floor(i / cols) * (cellH + gap);
    rounded(ctx, cx, cy, cellW, cellH, 28); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#e4e8e0'; ctx.stroke();
    // Mark and name on one line, then the QR, then the handle.
    ctx.font = `700 30px ${FONT}`;
    const name = socialInfo[platform].name, nameW = Math.min(ctx.measureText(name).width, cellW - 110), rowW = 40 + 12 + nameW, rx = cx + (cellW - rowW) / 2;
    ctx.drawImage(await iconImage(platform, t.primary), rx, cy + 24, 40, 40);
    ctx.textAlign = 'left'; ctx.fillStyle = t.ink; ctx.fillText(name, rx + 52, cy + 55, cellW - 110);
    const qy = cy + 82;
    await drawQr(ctx, qr, cx + (cellW - qrSize) / 2, qy, qrSize, scale);
    centred(ctx, socialHandle(platform, url), cx + cellW / 2, Math.min(qy + qrSize + 46, cy + cellH - 22), cellW - 40, 28, 600, t.primary);
  }
  return canvas;
}
/** The same card as a PNG data URL ("PNG indir", the preview). */
export const socialCardPng = async (items: SocialItem[], business: CardBusiness, combined = items.length > 1) => (await socialCard(items, business, combined)).toDataURL('image/png');
