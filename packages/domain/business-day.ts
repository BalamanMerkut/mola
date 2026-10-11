/*
 * The business day ("kasa günü"): one rule for the gün sonu kasası, the vardiyalar and every report. No imports, so the
 * browser bundle and every domain file can use it.
 *
 * DAY_START_HOUR is the single place to change it: 5 = a day runs from 05:00 to 05:00 the next morning (Türkiye), so sales
 * at 01:30 belong to the evening before and "Bugün" after midnight still shows tonight. 0 would make every day a calendar
 * day again. Türkiye has been UTC+3 all year since 2016, so the offset is fixed; the server's own timezone is never used.
 *
 * Stored history keeps working when it changes: day summaries carry a version (server/history.ts SUMMARY_VERSION) and are
 * rebuilt from the records, and every stored day column is read one day wider and then filtered by the exact time.
 */
export const DAY_START_HOUR = 5;
export const DAY_MS = 86400000;
const TR_OFFSET = 3 * 3600_000, START = DAY_START_HOUR * 3600_000;
const ms = (at: number | string | Date) => typeof at === 'number' ? at : at instanceof Date ? at.getTime() : Date.parse(at);
/** The business day of a moment: the Turkish date of (time − DAY_START_HOUR). */
export const businessDay = (at: number | string | Date) => new Date(ms(at) + TR_OFFSET - START).toISOString().slice(0, 10);
/** When a business day starts: DAY_START_HOUR o'clock Turkish time on that date. */
export const dayStart = (day: string) => Date.parse(`${day}T00:00:00+03:00`) + START;
/** "05:00", for the screens. */
export const dayStartText = `${String(DAY_START_HOUR).padStart(2, '0')}:00`;
/** A calendar date moved by whole days. */
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/**
 * A moment written as "that day, 00:00 Turkish time" by an older version (automatic expenses): moved to the start of that
 * business day, so a rent dated 1 Ekim stays on 1 Ekim. Any other moment is returned as it is.
 */
export function midnightToDayStart(at: string) {
  const t = Date.parse(at);
  if (!START || !Number.isFinite(t) || (t + TR_OFFSET) % DAY_MS !== 0) return at;
  return new Date(t + START).toISOString();
}
/**
 * What a report period is compared with, the words before "göre" ("dünün aynı saatine", "önceki 7 güne", "geçen yılın aynı
 * dönemine"): the screen, the plain sentence, the printable page and the e-mail say the same (reports.ts previousRange).
 * `days`: business days of the period; `partial`: still running, compared up to the same clock time; `year`: a calendar year,
 * compared with the same dates of the year before.
 */
export function comparisonLabel(days: number, o: { partial?: boolean; endsToday?: boolean; year?: boolean }) {
  if (o.year) return o.partial ? 'geçen yılın aynı dönemine' : 'önceki yıla';
  return days === 1 ? (o.partial ? 'dünün aynı saatine' : o.endsToday ? 'düne' : 'önceki güne') : o.partial ? `önceki ${days} günün aynı saatine` : `önceki ${days} güne`;
}
