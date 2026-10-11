import { randomUUID } from 'node:crypto';
import { DomainError } from '../packages/domain/engine.js';
import type { License } from './license.js';

const DAY = 86400000;
export type FreezeRequest = { id: string; reason: string; startDate: string; days: number; requestedAt: string; status: 'pending' | 'approved' | 'rejected'; decision?: string; decidedAt?: string; startsAt?: string; until?: string; endedAt?: string };
export function freezeWindow(l: License, now: Date) {
  return l.freezes?.find(f => f.status === 'approved' && !f.endedAt && Date.parse(f.startsAt!) <= +now && +now < Date.parse(f.until!));
}
export function turkeyDate(now: Date) { return new Date(+now + 3 * 3600000).toISOString().slice(0, 10); }
function startTime(date: string) {
  const t = Date.parse(`${date}T00:00:00+03:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(t) || turkeyDate(new Date(t)) !== date) throw new DomainError('INVALID_DATE', 'Geçerli bir başlangıç tarihi seçin.');
  return t;
}
function eligibility(l: License, now: Date) {
  if (l.kind === 'trial' || l.planMonths !== 12) throw new DomainError('ANNUAL_REQUIRED', 'Dondurma yalnızca yıllık abonelikte kullanılabilir.', 409);
  if (l.suspended || !l.endsAt || Date.parse(l.endsAt) <= +now) throw new DomainError('LICENSE_INACTIVE', 'Dondurma için aktif bir abonelik gerekir.', 409);
}
function checkWindow(l: License, date: string, now: Date, exclude?: string) {
  const start = Math.max(startTime(date), +now);
  if (date < turkeyDate(now) || start >= Date.parse(l.endsAt!)) throw new DomainError('INVALID_DATE', 'Başlangıç bugün veya lisans bitmeden önceki bir tarih olmalı.');
  for (const f of l.freezes ?? []) {
    if (f.id === exclude || f.status === 'rejected') continue;
    if (f.status === 'pending' || (!f.endedAt && Date.parse(f.until!) > +now)) throw new DomainError('FREEZE_EXISTS', 'Bekleyen veya planlanmış bir dondurma işlemi var.', 409);
    if (f.endedAt && Date.parse(f.endedAt) <= Date.parse(f.startsAt!)) continue;
    // Once in a rolling twelve-month period, rather than twice across New Year.
    const next = new Date(f.startsAt!); const day = next.getUTCDate(); next.setUTCDate(1); next.setUTCFullYear(next.getUTCFullYear() + 1);
    next.setUTCDate(Math.min(day, new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()));
    if (start < +next) throw new DomainError('FREEZE_LIMIT', 'Dondurma hakkı önceki başlangıçtan 12 ay sonra yeniden kullanılabilir.', 409);
  }
  return start;
}
/** id: the café's own id for a request it queued offline, so a repeated delivery is recognised. */
export function requestFreeze(l: License, reason: string, startDate: string, days: number, now: Date, id: string = randomUUID()) {
  eligibility(l, now);
  if (!Number.isInteger(days) || days < 1 || days > 60 || reason.trim().length < 5 || reason.trim().length > 1000) throw new DomainError('INVALID_FREEZE', '5–1000 karakter gerekçe ve 1–60 gün süre girin.');
  checkWindow(l, startDate, now);
  const f: FreezeRequest = { id, reason: reason.trim(), startDate, days, requestedAt: now.toISOString(), status: 'pending' };
  (l.freezes ??= []).push(f); return { id: f.id };
}
export function reviewFreeze(l: License, id: string, approve: boolean, note: string, now: Date) {
  const f = l.freezes?.find(f => f.id === id);
  if (!f || f.status !== 'pending') throw new DomainError('CONFLICT', 'Talep artık beklemiyor. Listeyi yenileyin.', 409);
  if (!approve && !note.trim()) throw new DomainError('REASON_REQUIRED', 'Ret gerekçesini yazın.');
  if (approve) {
    eligibility(l, now); const start = checkWindow(l, f.startDate, now, f.id);
    f.startsAt = new Date(start).toISOString(); f.until = new Date(start + f.days * DAY).toISOString();
    l.endsAt = new Date(Date.parse(l.endsAt!) + f.days * DAY).toISOString();
  }
  f.status = approve ? 'approved' : 'rejected'; f.decision = note.trim(); f.decidedAt = now.toISOString(); return { ok: true };
}
export function endFreeze(l: License, id: string, now: Date) {
  const f = l.freezes?.find(f => f.id === id);
  if (!f || f.status !== 'approved' || f.endedAt || +now >= Date.parse(f.until!)) throw new DomainError('CONFLICT', 'Dondurma zaten sona ermiş. Listeyi yenileyin.', 409);
  const unused = Date.parse(f.until!) - Math.max(+now, Date.parse(f.startsAt!));
  l.endsAt = new Date(Date.parse(l.endsAt!) - unused).toISOString(); f.endedAt = now.toISOString(); return { ok: true };
}
