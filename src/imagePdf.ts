/*
 * A real one-page PDF file of a picture (the social QR cards' "PDF indir", src/SocialSettings.tsx), made in the browser with
 * no package and no network: the card is drawn on a canvas at print resolution and put on an A4 or A6 page as one lossless
 * image (Flate, the PNG kind of compression; JPEG only in a browser without CompressionStream), centred within a margin.
 * `pdfWithImage` is plain bytes in, bytes out (tests/social-links.test.ts checks the file's structure). `pdfPages` is the
 * many-page form (the table stands' A6 cards, one or four a page, src/tableStand.ts).
 */
export type PaperSize = 'a4' | 'a6';
/** Page sizes in PDF points (1/72 inch) and the margin around the picture. */
export const PAPER: Record<PaperSize, { width: number; height: number; margin: number; name: string }> = {
  a4: { width: 595.28, height: 841.89, margin: 28.35, name: 'A4' },
  a6: { width: 297.64, height: 419.53, margin: 8.5, name: 'A6' },
};
export type PdfImage = { data: Uint8Array; width: number; height: number; filter: 'FlateDecode' | 'DCTDecode' };
const ascii = (s: string) => new TextEncoder().encode(s);
/** A text string the PDF reader shows as it is (Turkish letters too): UTF-16BE with its byte order mark, in hex. */
function pdfText(text: string) {
  let hex = 'FEFF';
  for (const ch of text) { const c = ch.codePointAt(0)!; const units = c > 0xffff ? [0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff)] : [c]; for (const u of units) hex += u.toString(16).padStart(4, '0').toUpperCase(); }
  return `<${hex}>`;
}
const fixed = (n: number) => (Math.round(n * 100) / 100).toString();

/** One page (`paper`) with the picture as large as the margin allows, centred. */
export function pdfWithImage(image: PdfImage, paper: PaperSize, title: string): Uint8Array {
  const page = PAPER[paper], room = { w: page.width - page.margin * 2, h: page.height - page.margin * 2 };
  const scale = Math.min(room.w / image.width, room.h / image.height), w = image.width * scale, h = image.height * scale;
  return pdfPages([{ images: [{ image, x: (page.width - w) / 2, y: (page.height - h) / 2, w, h }] }], paper, title);
}
/**
 * A page of pictures placed in points (origin bottom left), with optional extra drawing (`draw`: PDF path operators, e.g.
 * the table stands' cut lines, src/tableStand.ts). Every picture is its own image object, so a page of four A6 cards keeps
 * each card at its own resolution.
 */
export type PdfPage = { images: { image: PdfImage; x: number; y: number; w: number; h: number }[]; draw?: string };
export function pdfPages(pages: PdfPage[], paper: PaperSize, title: string): Uint8Array {
  const page = PAPER[paper];
  // 1 catalog, 2 page tree, then per page: the page, its images, its content; the document info last.
  const objects: (Uint8Array | string)[][] = [['<< /Type /Catalog /Pages 2 0 R >>'], []];
  const kids: number[] = [];
  for (const p of pages) {
    const at = objects.length + 1, contentNo = at + 1 + p.images.length;
    kids.push(at);
    const names = p.images.map((_, i) => `/Im${i} ${at + 1 + i} 0 R`).join(' ');
    objects.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fixed(page.width)} ${fixed(page.height)}] /Resources << /XObject << ${names} >> /ProcSet [/PDF /ImageC] >> /Contents ${contentNo} 0 R >>`]);
    for (const { image } of p.images) objects.push([`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.data.length} >>\nstream\n`, image.data, '\nendstream']);
    const content = ascii(p.images.map(({ x, y, w, h }, i) => `q ${fixed(w)} 0 0 ${fixed(h)} ${fixed(x)} ${fixed(y)} cm /Im${i} Do Q\n`).join('') + (p.draw ?? ''));
    objects.push([`<< /Length ${content.length} >>\nstream\n`, content, 'endstream']);
  }
  objects[1] = [`<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${pages.length} >>`];
  objects.push([`<< /Title ${pdfText(title)} /Producer (Mola) >>`]);
  // "%PDF-1.4" and a comment of four high bytes (tells readers the file is binary).
  const parts: Uint8Array[] = [ascii('%PDF-1.4\n'), new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  let length = parts[0].length + parts[1].length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = [ascii(`${i + 1} 0 obj\n`), ...body.map(b => typeof b === 'string' ? ascii(b) : b), ascii('\nendobj\n')];
    for (const c of chunk) { parts.push(c); length += c.length; }
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(ascii(xref));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** The canvas as a PDF picture: its pixels without alpha, compressed losslessly (or JPEG where that is all there is). */
export async function canvasImage(canvas: HTMLCanvasElement): Promise<PdfImage> {
  if (typeof CompressionStream === 'function') {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height), rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) { rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2]; }
    return { data: await deflate(rgb), width: canvas.width, height: canvas.height, filter: 'FlateDecode' };
  }
  const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('jpeg')), 'image/jpeg', 0.95));
  return { data: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height, filter: 'DCTDecode' };
}
export const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
/** The canvas as the picture of a one-page PDF. */
export async function canvasPdf(canvas: HTMLCanvasElement, paper: PaperSize, title: string): Promise<Blob> {
  return pdfBlob(pdfWithImage(await canvasImage(canvas), paper, title));
}
