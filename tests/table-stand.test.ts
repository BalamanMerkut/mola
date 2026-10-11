import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelLimits, tableLabelSize } from '../packages/domain/table-label.js';
import { PAPER, pdfPages } from '../src/imagePdf.js';

/*
 * "A6 masa standı" (Ayarlar → Masalar ve QR): the table's name on the A6 card (300 dpi pixels) and the many-page PDF that
 * holds the cards (four on A4 or one on A6). The cards themselves are drawn in the browser (tests/browser/daily-screens.spec.ts).
 */
test('A6 stand card: short names at the full size, a long custom name two lines smaller, never below the floor', () => {
  assert.equal(tableLabelSize('Masa 5', 'a6'), 220); assert.equal(tableLabelSize('Bahçe 4', 'a6'), 220);
  const { two, min } = labelLimits('a6');
  assert.deepEqual({ two, min }, { two: 150, min: 84 });
  const long = tableLabelSize('Teras Pencere Kenarı 12', 'a6');
  assert.ok(long <= two && long >= min, String(long));
  assert.ok(tableLabelSize('Çokuzunbirmasaadıdenemesiiçinyazıldı', 'a6') >= min);
  // The older sheets keep their sizes.
  assert.equal(tableLabelSize('Masa 1', 6), 34); assert.equal(tableLabelSize('Bahçe 4', 'png'), 150);
});

test('stand PDF: pages with several images each, cut lines drawn, every object where the xref says', () => {
  const image = (n: number) => ({ data: new Uint8Array([n, n, n]), width: 1240, height: 1748, filter: 'FlateDecode' as const });
  const w = 297.64, h = 419.53, top = PAPER.a4.height;
  const place = (k: number) => ({ image: image(k), x: (k % 2) * w, y: top - (Math.floor(k / 2) + 1) * h, w, h });
  const bytes = pdfPages([{ images: [0, 1, 2, 3].map(place), draw: '0 0 m 10 10 l S\n' }, { images: [place(0)] }], 'a4', 'Mola Kafe · masa QR kartları');
  const text = Buffer.from(bytes).toString('latin1');
  assert.equal(text.slice(0, 8), '%PDF-1.4'); assert.match(text, /%%EOF\n$/);
  assert.match(text, /\/Type \/Pages \/Kids \[3 0 R 9 0 R\] \/Count 2/);
  assert.equal(text.match(/\/Type \/Page /g)?.length, 2);
  assert.equal(text.match(/\/Subtype \/Image \/Width 1240 \/Height 1748/g)?.length, 5);
  assert.match(text, /\/XObject << \/Im0 4 0 R \/Im1 5 0 R \/Im2 6 0 R \/Im3 7 0 R >>/);
  assert.match(text, /\/Contents 8 0 R/); assert.match(text, /0 0 m 10 10 l S/);
  assert.match(text, /297\.64 0 0 419\.53 297\.64 2\.83 cm \/Im3 Do Q/);
  const at = text.indexOf('\nxref\n') + 1, offsets = [...text.slice(at).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  assert.equal(offsets.length, 12);
  offsets.forEach((o, i) => assert.equal(text.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  assert.equal(Number(/startxref\n(\d+)/.exec(text)![1]), at);
  assert.match(text, /\/Info 12 0 R/);
});
