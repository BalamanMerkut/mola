/**
 * Bars of the sales chart in Satış ve Raporlar: one bar per day up to a month, per week (Monday–Sunday) up to about four
 * months, per month for longer periods ("1 yıl", "Tümü"), per year when "Tümü" spans more than four years. The server
 * sends days (or months when "Tümü" is longer than 400 days); first and last weeks or months may be partial, and each bar
 * keeps the exact days it covers so its tip, its notes and its label say so.
 */
export type BucketKind = 'day' | 'week' | 'month' | 'year';
/** `reservation`: the part of `sales` paid on reserved or event tables (the chart's "Rezervasyon" colour). */
export type Bucket = { key: string; kind: BucketKind; from: string; to: string; sales: number; days: number; reservation?: number };

export const DAILY_MAX = 31, WEEKLY_MAX = 120, MONTHLY_MAX = 48;
const DAY = 86400000;
const add = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const monthEnd = (month: string) => { const [y, m] = month.split('-').map(Number); return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
/** Monday of the week of a date. */
export const weekStart = (day: string) => add(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Which bar size a period of `days` days gets. */
export function bucketKind(days: number): Exclude<BucketKind, 'year'> { return days <= DAILY_MAX ? 'day' : days <= WEEKLY_MAX ? 'week' : 'month'; }

/** The series from the server (days "YYYY-MM-DD" or months "YYYY-MM") as chart bars. */
export function bucketize(series: { day: string; sales: number; reservation?: number }[]): Bucket[] {
  if (!series.length) return [];
  const months = series[0].day.length === 7;
  // Months straight from the server ("Tümü" over 400 days): already one bar each.
  let list: Bucket[];
  if (months) list = series.map(m => ({ key: m.day, kind: 'month' as const, from: `${m.day}-01`, to: monthEnd(m.day), sales: m.sales, reservation: m.reservation ?? 0, days: Number(monthEnd(m.day).slice(8)) }));
  else {
    const kind = bucketKind(series.length);
    if (kind === 'day') return series.map(d => ({ key: d.day, kind, from: d.day, to: d.day, sales: d.sales, reservation: d.reservation ?? 0, days: 1 }));
    const groups = new Map<string, Bucket>();
    for (const d of series) {
      const key = kind === 'week' ? weekStart(d.day) : d.day.slice(0, 7);
      const b = groups.get(key);
      if (b) { b.sales += d.sales; b.reservation = (b.reservation ?? 0) + (d.reservation ?? 0); b.to = d.day; b.days++; } else groups.set(key, { key, kind, from: d.day, to: d.day, sales: d.sales, reservation: d.reservation ?? 0, days: 1 });
    }
    list = [...groups.values()];
  }
  if (list.length <= MONTHLY_MAX) return list;
  // Many years of "Tümü": one bar per year.
  const years = new Map<string, Bucket>();
  for (const m of list) {
    const key = m.key.slice(0, 4), y = years.get(key);
    if (y) { y.sales += m.sales; y.reservation = (y.reservation ?? 0) + (m.reservation ?? 0); y.to = m.to; y.days += m.days; } else years.set(key, { key, kind: 'year', from: m.from, to: m.to, sales: m.sales, reservation: m.reservation ?? 0, days: m.days });
  }
  return [...years.values()];
}

const fmt = (day: string, options: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString('tr-TR', { timeZone: 'UTC', ...options });
/** Whether a bar covers its whole week or month (the first and last ones of a period may not). */
export const whole = (b: Bucket) => b.kind === 'week' ? b.days === 7 : b.kind === 'month' ? b.from.endsWith('-01') && b.to === monthEnd(b.from.slice(0, 7)) : b.kind === 'year' ? b.from.endsWith('-01-01') && b.to.endsWith('-12-31') : true;
/** The tip's title: "4 Eki Cmt", "28 Eyl – 4 Eki 2026", "Ekim 2026", "Ekim 2026 (1–4 Eki)", "2025". */
export function bucketTitle(b: Bucket) {
  const range = `${fmt(b.from, { day: 'numeric', month: 'short' })} – ${fmt(b.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  switch (b.kind) {
    case 'day': return fmt(b.from, { day: 'numeric', month: 'short', weekday: 'short' });
    case 'week': return `${range}${whole(b) ? '' : ` (${b.days} gün)`}`;
    case 'month': return `${fmt(b.from, { month: 'long', year: 'numeric' })}${whole(b) ? '' : ` (${fmt(b.from, { day: 'numeric' })}–${fmt(b.to, { day: 'numeric', month: 'short' })})`}`;
    case 'year': return whole(b) ? b.key : `${b.key} (${range})`;
  }
}
/** Short text under a bar: "28 Eyl" (week), "Eki" ("Oca 26" in January), "2025". */
export function bucketTick(b: Bucket, first: boolean) {
  switch (b.kind) {
    case 'day': return fmt(b.from, { day: 'numeric', month: 'short' });
    case 'week': return fmt(b.from, { day: 'numeric', month: 'short' });
    case 'month': return b.from.slice(5, 7) === '01' || first ? `${fmt(b.from, { month: 'short' })} ${b.from.slice(2, 4)}` : fmt(b.from, { month: 'short' });
    case 'year': return b.key;
  }
}
/** Every how many bars a tick label is written, so at most about eight labels fit under the chart. */
export const tickStep = (count: number) => Math.max(1, Math.ceil(count / 8));
/** Chart heading for the bar size. */
export const bucketHeading: Record<BucketKind, string> = { day: 'Günlük satış', week: 'Haftalık satış', month: 'Aylık satış', year: 'Yıllık satış' };
export const bucketNoun: Record<BucketKind, string> = { day: 'gün', week: 'hafta', month: 'ay', year: 'yıl' };
