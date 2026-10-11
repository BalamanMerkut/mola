/* 24-hour time typing rules of src/TimeField.tsx (kept apart so tests can read them without the screen). */
export const VALID = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (v: string) => VALID.test(v);

/** What the guest of the field typed, tidied while typing: digits and one colon, the colon added after the hour. */
export function shapeTime(raw: string, previous: string): string {
  const typedForward = raw.length > previous.length;
  if (raw.includes(':')) {
    const [h, ...rest] = raw.split(':');
    const hour = h.replace(/\D/g, '').slice(0, 2), minute = rest.join('').replace(/\D/g, '').slice(0, 2);
    return `${hour}:${minute}`;
  }
  let digits = raw.replace(/\D/g, '').slice(0, 4);
  // "9" cannot start a two-digit hour above 23: it is 09.
  if (digits.length >= 1 && Number(digits[0]) > 2) digits = `0${digits}`.slice(0, 4);
  else if (digits.length >= 2 && Number(digits.slice(0, 2)) > 23) digits = `0${digits}`.slice(0, 4);
  if (digits.length > 2) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return digits.length === 2 && typedForward ? `${digits}:` : digits;
}
/** On leaving the field: "9" → "09:00", "19:3" → "19:30", "7:5" → "07:50". Anything else stays as typed (and invalid). */
export function finishTime(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const [h, m = ''] = t.includes(':') ? t.split(':') : [t.slice(0, 2), t.slice(2)];
  if (!/^\d{1,2}$/.test(h) || !/^\d{0,2}$/.test(m)) return t;
  const out = `${h.padStart(2, '0')}:${m.padEnd(2, '0')}`;
  return VALID.test(out) ? out : t;
}

