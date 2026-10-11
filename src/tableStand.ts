import QRCode from 'qrcode';
import { labelLimits, tableLabelSize } from '../packages/domain/table-label';
import { themes, type ThemeId } from '../packages/domain/theme';
import { canvasImage, pdfBlob, pdfPages, PAPER, type PdfPage } from './imagePdf';
import { lines } from './tableQrCard';

/*
 * "A6 masa standı" (Ayarlar → Masalar ve QR → QR kodlarını yazdır): one portrait A6 card (10,5 × 14,8 cm) per table for the
 * acrylic table stands cafés buy. Drawn on a canvas at 300 dpi (1240 × 1748 px): the business's logo and name, a large QR
 * (black on white, four modules of white quiet zone, whole pixels per module), the table's name very large and bold
 * (packages/domain/table-label.ts `a6`; a long name wraps and steps down), "Menü ve sipariş için okutun" and the English
 * line (the guest menu always has EN). The theme colour only tints the name and a thin frame. The same card is printed
 * ("Yazdır": four on an A4 sheet with cut lines and crop marks, or one per A6 sheet) and put into the PDF ("PDF indir"),
 * so both are the same. Nothing is fetched.
 */
export const STAND = { width: 1240, height: 1748 };
export type StandPaper = 'a4' | 'a6';
export type StandBusiness = { name: string; logo?: string; theme?: ThemeId; orders: boolean };
export type StandLabel = { size: number; lines: string[]; widest: number; room: number };
const FONT = '"Segoe UI", Arial, Helvetica, sans-serif';
const PX_MM = 300 / 25.4, PT_MM = 72 / 25.4;
const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('image')); img.src = src; });
/** The line under the name: orders by QR only when the package has them ("Sadece QR menü": the menu alone). */
export const standHint = (orders: boolean) => orders ? ['Menü ve sipariş için okutun', 'Scan for menu & ordering'] : ['Menü için okutun', 'Scan for the menu'];

/** Text centred on x, shrunk until it fits `max` (cut with "…" below 60 % of the size). */
function centred(ctx: CanvasRenderingContext2D, text: string, y: number, max: number, size: number, weight: number, color: string) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > max && s > size * 0.6) { s -= 2; ctx.font = `${weight} ${s}px ${FONT}`; }
  let shown = text;
  while (ctx.measureText(shown).width > max && shown.length > 2) shown = `${shown.slice(0, -2)}…`;
  ctx.fillStyle = color; ctx.fillText(shown, STAND.width / 2, y);
}

/** One table's card on a canvas, and how its name was laid out (the browser test checks that it fits). */
export async function standCard(tableName: string, url: string, business: StandBusiness): Promise<{ canvas: HTMLCanvasElement; label: StandLabel }> {
  const { width: W, height: H } = STAND, t = themes[business.theme ?? 'sage'] ?? themes.sage;
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
  canvas.width = W; canvas.height = H;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  // A thin frame in the business colour, 6 mm in (inside what a printer can print, and under the stand's edge).
  const inset = Math.round(6 * PX_MM);
  ctx.beginPath(); ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, 44); ctx.lineWidth = 4; ctx.strokeStyle = `${t.primary}5c`; ctx.stroke();

  // The name: the size from table-label.ts, then down until it is one line, or two at the two-line size (a floor at last).
  const room = W - 240, { two, min } = labelLimits('a6');
  let size = tableLabelSize(tableName, 'a6'), text: string[] = [];
  for (; ; size -= 4) {
    ctx.font = `800 ${size}px ${FONT}`; text = lines(ctx, tableName, room);
    if (text.length === 1 || (text.length <= 2 && size <= two) || size <= min) break;
  }
  const widest = Math.max(...text.map(l => ctx.measureText(l).width));
  let logo: HTMLImageElement | undefined;
  if (business.logo) try { logo = await load(business.logo); } catch { /* no logo then */ }

  // Heights top to bottom; the QR takes what is left (at most ~70 mm with its quiet zone) and the block is centred.
  const logoH = logo ? 176 + 26 : 0, headH = 80, lineH = Math.round(size * 1.06), nameH = text.length * lineH, hintH = 66, enH = 52;
  const fixedH = logoH + headH + 10 + 18 + nameH + 34 + hintH + enH;
  const code = QRCode.create(url, { errorCorrectionLevel: 'M' }), cells = code.modules.size + 8;
  const scale = Math.max(4, Math.floor(Math.min(840, H - (inset + 46) * 2 - fixedH) / cells)), side = scale * cells;
  let y = Math.round((H - fixedH - side) / 2);
  if (logo) {
    const s = 176, x = (W - s) / 2;
    ctx.save(); ctx.beginPath(); ctx.arc(W / 2, y + s / 2, s / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, s, s); ctx.drawImage(logo, x, y, s, s); ctx.restore();
    y += logoH;
  }
  centred(ctx, business.name, y + 60, W - 260, 62, 650, t.primary);
  y += headH + 10;
  // The QR at whole pixels per module, four white modules round it, drawn without smoothing: sharp on paper.
  const qr = await load(await QRCode.toDataURL(url, { scale, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }));
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(qr, Math.round((W - side) / 2), y, side, side); ctx.restore();
  y += side + 18;
  ctx.fillStyle = '#111111'; ctx.font = `800 ${size}px ${FONT}`;
  for (const [i, line] of text.entries()) ctx.fillText(line, W / 2, y + Math.round(size * 0.86) + i * lineH);
  y += nameH + 34;
  const [hint, english] = standHint(business.orders);
  centred(ctx, hint, y + 50, W - 260, 52, 600, t.ink);
  centred(ctx, english, y + hintH + 40, W - 260, 38, 400, '#6e7b6c');
  return { canvas, label: { size, lines: text, widest: Math.round(widest), room } };
}

/*
 * Four cards on A4 (2 × 2, 105 × 148 mm each, top left first): cut along the dashed cross; short solid crop marks at its
 * ends, 5–11 mm in from the paper's edge (printers leave the outer few millimetres blank). The print sheet draws the same
 * marks with CSS (settings-qr.css `.qr-stand-page`).
 */
export const A4_CUTS = { x: 105, y: 148, bottom: 296 };
function cutMarks() {
  const top = PAPER.a4.height, right = PAPER.a4.width, x = A4_CUTS.x * PT_MM, y = top - A4_CUTS.y * PT_MM, bottom = top - A4_CUTS.bottom * PT_MM;
  const line = (x1: number, y1: number, x2: number, y2: number) => `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
  const mm = (n: number) => n * PT_MM;
  return `q 0.55 G 0.6 w [4 3] 0 d\n${line(x, top, x, bottom)}${line(0, y, right, y)}Q\n`
    + `q 0 G 0.7 w\n${line(x, top - mm(5), x, top - mm(11))}${line(x, bottom + mm(5), x, bottom + mm(11))}${line(mm(5), y, mm(11), y)}${line(right - mm(5), y, right - mm(11), y)}Q\n`;
}

/**
 * "PDF indir": the same cards, four on each A4 page with the cut marks, or one on each A6 page. Cards are drawn one at a
 * time (`card(i)`) and kept only compressed: fifty tables' canvases at 300 dpi would not fit in memory together.
 */
export async function standPdf(count: number, card: (i: number) => Promise<HTMLCanvasElement>, paper: StandPaper, title: string): Promise<Blob> {
  const pages: PdfPage[] = [], w = 105 * PT_MM, h = 148 * PT_MM;
  for (let i = 0; i < count; i++) {
    const canvas = await card(i), image = await canvasImage(canvas);
    canvas.width = 0; canvas.height = 0;
    if (paper === 'a6') { pages.push({ images: [{ image, x: 0, y: 0, w: PAPER.a6.width, h: PAPER.a6.height }] }); continue; }
    const k = i % 4;
    if (k === 0) pages.push({ images: [], draw: cutMarks() });
    pages.at(-1)!.images.push({ image, x: (k % 2) * w, y: PAPER.a4.height - (Math.floor(k / 2) + 1) * h, w, h });
  }
  return pdfBlob(pdfPages(pages, paper, title));
}
