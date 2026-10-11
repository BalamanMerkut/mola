import { DomainError } from './engine.js';

/*
 * Kapanan yıl (yıl paketi, docs/GELISTIRICI_REHBERI.md "Yıl paketleri"). Every calendar year (business days, 05:00–05:00) is
 * sealed into its own read-only package on 1 February of the next year (server/year-packages.ts) and never reopened. From the
 * moment its packaging starts, nothing may be written into it: no back-dated expense and no change of an old one, no
 * payment-method correction of its payments, no correction of its cash closings, no shift correction, no stock entry dated in
 * it or taken back. A refund of one of its bills is allowed: it counts on the day it is given (today), items included, and the
 * closed year stays exactly as it was. `closedThrough` is the last business day of the newest closed year ('2025-12-31');
 * the server puts it on every State it reads (Store.read), never from stored data.
 */
export const CLOSED_YEAR = 'CLOSED_YEAR';
/** "Bu yıl kapandı: …" for a write into a closed year; `hint`: what the owner can do instead. */
export function closedYearText(day: string, hint = 'Kaydı bugünün tarihiyle girin.') {
  return `Bu yıl kapandı: ${day.slice(0, 4)} yılının kayıtları paketlendi ve artık değiştirilemez.${hint ? ` ${hint}` : ''}`;
}
/** Whether `day` (a business day) lies in a closed year. */
export const inClosedYear = (closedThrough: string | null | undefined, day: string) => !!closedThrough && day <= closedThrough;
/** Refuses a write into a closed year with the owner's plain sentence. */
export function assertOpenDay(closedThrough: string | null | undefined, day: string, hint?: string) {
  if (inClosedYear(closedThrough, day)) throw new DomainError(CLOSED_YEAR, closedYearText(day, hint), 409);
}
