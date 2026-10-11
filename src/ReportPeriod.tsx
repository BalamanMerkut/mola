import { businessDay } from '../packages/domain/business-day';

// Business calendar helpers for report screens: Turkish business days (05:00–05:00, packages/domain/business-day.ts), never
// the device's own timezone. After midnight "today" is still tonight's business day, like the gün sonu kasası.
export function reportToday() { return businessDay(Date.now()); }
export function formatReportDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Istanbul' });
}
