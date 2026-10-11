/*
 * The table's name under its printed QR code (Ayarlar → Masalar ve QR → Yazdır, and the single table's "QR kodunu indir"):
 * large and bold, so the guest still remembers "Masa 12" at the till. Short names ("Masa 1", "Bahçe 4") get the full size;
 * a longer custom name goes to two lines at a smaller size (and smaller still when one word is too long for a line), never
 * below a readable minimum. Sizes are in points for the A4 sheet (6 or 12 codes a page) and in pixels for the PNG (`png`,
 * a 1000 px wide card) and the A6 table stand card (`a6`: 1240 × 1748 px, 300 dpi; 220 px ≈ 53 pt, src/tableStand.ts).
 */
export type LabelSheet = 6 | 12 | 'png' | 'a6';
// `max`: one line; `two`: the largest size for two lines (the cell's height); `line`: about how many characters of the
// largest size fit on one line of the cell.
const SIZES: Record<LabelSheet, { max: number; two: number; min: number; line: number }> = {
  6: { max: 34, two: 20, min: 13, line: 11 },
  12: { max: 22, two: 12, min: 9, line: 9 },
  png: { max: 150, two: 104, min: 60, line: 11 },
  a6: { max: 220, two: 150, min: 84, line: 8 },
};
/** The two-line size and the floor, for a drawing that measures its lines (src/tableStand.ts steps down between them). */
export const labelLimits = (sheet: LabelSheet) => ({ two: SIZES[sheet].two, min: SIZES[sheet].min });
const length = (s: string) => [...s].length;
/** The font size for this name: full size while it fits on one line, else the two-line size, smaller for a long word. */
export function tableLabelSize(name: string, sheet: LabelSheet) {
  const { max, two, min, line } = SIZES[sheet], text = name.trim() || ' ';
  if (length(text) <= line) return max;
  // Characters of the one-line size per line, at a size s: line * max / s. The longest word must fit one line, the whole
  // name two.
  const longest = Math.max(...text.split(/\s+/).map(length));
  return Math.max(min, Math.floor(Math.min(two, max * line / longest, max * line * 2 / length(text))));
}

/** A table section's heading as Masalar writes it (also the plan of Ajanda → Rezervasyonlar, where the stored "inside"/"outside" showed in English, 8 Ekim denetimi). */
export const areaTitle = (area: string) => area === 'inside' ? 'İç masalar' : area === 'outside' ? 'Dış masalar' : area ? `${area} masaları` : 'Diğer masalar';
