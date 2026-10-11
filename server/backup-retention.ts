import { addDays, businessDay } from '../packages/domain/business-day.js';

/*
 * Which automatic backups stay on the café computer (server/backup-scheduler.ts). Closed years live in their year packages
 * (server/year-packages.ts), stored once beside the backups in yillar/ and kept for good, so a backup only carries the open year:
 *   - one per business day (05:00 to 05:00): a newer verified backup of the same day replaces the older one
 *     (gün sonu 23:41, then a change at 00:30 and the 03:30 backup: only the 03:30 one stays);
 *   - Günlük: the newest of each of the last 7 business days that have a backup;
 *   - Haftalık: the newest of each of the last 4 finished ISO weeks (Monday to Sunday, by business day);
 *   - Aylık: the newest of each of the last 12 finished months (3 before the year packages, Faz 4).
 * "Last … that have a backup": a computer that was off for weeks keeps what it had instead of losing every older copy.
 * At most 7 + 4 + 12 = 23 backups over a year, each only as large as the open year (docs/HIZ_TESTI_5_YIL.md "Faz 4 sonrası").
 */
export type Tier = 'daily' | 'weekly' | 'monthly';
export type Retention = Record<Tier, number>;
export const RETENTION: Retention = { daily: 7, weekly: 4, monthly: 12 };
export const TIER_NAMES: Record<Tier, string> = { daily: 'Günlük', weekly: 'Haftalık', monthly: 'Aylık' };

/** ISO week of a calendar date ("2026-W41"): the Thursday of that week names its year. */
export function isoWeek(day: string) {
  const d = new Date(`${day}T00:00:00Z`), monday = addDays(day, -((d.getUTCDay() + 6) % 7)), thursday = addDays(monday, 3);
  const year = Number(thursday.slice(0, 4)), jan4 = new Date(Date.UTC(year, 0, 4)), firstMonday = addDays(`${year}-01-04`, -((jan4.getUTCDay() + 6) % 7));
  return `${year}-W${String(1 + Math.round((Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${firstMonday}T00:00:00Z`)) / (7 * 86400000))).padStart(2, '0')}`;
}
/** The longest-lived reason a backup stays: what the backup screen shows next to it. */
export const mainTier = (tiers: Tier[]): Tier => tiers.includes('monthly') ? 'monthly' : tiers.includes('weekly') ? 'weekly' : 'daily';

/** Newest first: by time, then by the order they were made in (`order`, equal times), then by name. */
export const newestFirst = (a: { name: string; createdAt: string; order?: number }, b: { name: string; createdAt: string; order?: number }) =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt) || (b.order ?? 0) - (a.order ?? 0) || b.name.localeCompare(a.name);
/**
 * The kept set: name → why it stays. `protect`: never dropped (the backup just made). Never empty when the list is not: the
 * newest backup is always the newest of its day.
 */
export function keptBackups<T extends { name: string; createdAt: string; order?: number }>(list: T[], now: Date, protect: string[] = [], rule: Retention = RETENTION) {
  const sorted = [...list].filter(b => Number.isFinite(Date.parse(b.createdAt))).sort(newestFirst);
  // The newest of each business day; the rest are the same day's older copies.
  const days: { name: string; day: string }[] = [], seenDays = new Set<string>();
  for (const b of sorted) { const day = businessDay(b.createdAt); if (!seenDays.has(day)) { seenDays.add(day); days.push({ name: b.name, day }); } }
  const today = businessDay(now), thisWeek = isoWeek(today), thisMonth = today.slice(0, 7);
  const kept = new Map<string, Tier[]>();
  const add = (name: string, tier: Tier) => kept.set(name, [...(kept.get(name) ?? []), tier]);
  for (const d of days.slice(0, Math.max(0, rule.daily))) add(d.name, 'daily');
  for (const [tier, count, bucket, current] of [['weekly', rule.weekly, (day: string) => isoWeek(day), thisWeek], ['monthly', rule.monthly, (day: string) => day.slice(0, 7), thisMonth]] as const) {
    const seen = new Set<string>();
    for (const d of days) {
      const key = bucket(d.day);
      // Only finished weeks and months (a copy dated in the future by a wrong clock never counts as one).
      if (key >= current || seen.has(key)) continue;
      if (seen.size >= count) break;
      seen.add(key); add(d.name, tier);
    }
  }
  for (const name of protect) if (!kept.has(name) && list.some(b => b.name === name)) kept.set(name, ['daily']);
  return kept;
}
