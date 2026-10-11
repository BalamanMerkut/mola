/*
 * Day typing rules of src/DateField.tsx (kept apart so tests can read them without the screen). The field shows and takes
 * "08.10.2026" (gün.ay.yıl) whatever the computer's or phone's language; the browser's own date field showed 10/08/2026
 * (month first) on an English Windows (8 Ekim denetimi). The value the app keeps stays "2026-10-08".
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() && y >= 2000 && y <= 2100;
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** "2026-10-08" → "08.10.2026" ('' stays ''). */
export function showDay(value: string) { const m = ISO.exec(value); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; }
/** What was typed as a day ("8.10.2026", "08/10/2026", "08102026", or "2026-10-08") → "2026-10-08"; '' when not a whole, real day. */
export function dayOf(text: string) {
  const t = text.trim();
  let m = ISO.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]) ? t : '';
  m = /^(\d{1,2})[./ -](\d{1,2})[./ -](\d{4})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  return m && valid(+m[3], +m[2], +m[1]) ? iso(+m[3], +m[2], +m[1]) : '';
}
/** Tidied while typing: digits and dots, the dots added after the day and the month ("0810" → "08.10."). ISO typing passes. */
export function shapeDay(raw: string, previous: string) {
  if (/^\d{4}-/.test(raw)) return raw.replace(/[^\d-]/g, '').slice(0, 10);
  const forward = raw.length > previous.length;
  if (/[./]/.test(raw)) {
    // Dotted: the day and the month at most two digits each (a third goes on to the next part), the year four; a dot is
    // added after a finished day or month while typing forward ("01.02" + "2" → "01.02.2").
    const parts = raw.replace(/\//g, '.').replace(/[^\d.]/g, '').split('.').slice(0, 3);
    for (let i = 0; i < 2 && i < parts.length; i++) if (parts[i].length > 2) { const rest = parts[i].slice(2); parts[i] = parts[i].slice(0, 2); if (parts.length === i + 1) parts.push(rest); else parts[i + 1] = rest + parts[i + 1]; }
    if (parts.length > 3) parts.length = 3;
    if (parts[2] !== undefined) parts[2] = parts[2].slice(0, 4);
    const out = parts.join('.');
    return forward && parts.length < 3 && parts[parts.length - 1].length === 2 && !out.endsWith('.') ? `${out}.` : out;
  }
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  const out = digits.length > 4 ? `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}` : digits.length > 2 ? `${digits.slice(0, 2)}.${digits.slice(2)}` : digits;
  return forward && (digits.length === 2 || digits.length === 4) ? `${out}.` : out;
}
