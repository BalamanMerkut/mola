import type { z } from 'zod';
import type { agreementAcceptance, IntegrityReport, SyncRequest } from '../sync-protocol.js';
import type { SignedRelease } from '../update-manifest.js';
import { addAlert } from './alerts.js';
import type { Releases } from './releases.js';
import type { Install, MerkezBusiness, MerkezData, MerkezStore } from './store.js';

/*
 * Mola Merkez's side of two things the café tells it (GELISTIRICI_REHBERI "Lisans sözleşmesi" and "Program dosyaları denetimi"):
 *   Mola Lisans Sözleşmesi   the version the owner accepted, when and the name typed: with the activation (application or
 *                            code) and later with the heartbeat (`agreements`, re-acceptance of a new text). Kept on the business.
 *   program files check      the café's latest result (per install: the businesses of one computer share its program), table
 *                            integrity_status. "Dosyalar değiştirilmiş" is shown and alerted once, journalled when first seen and
 *                            when it is back to normal. Nothing happens by itself: the vendor decides (call, "Askıya al").
 * Both fields are optional both ways: an older café sends neither, an older Merkez never lists them in `accepts`.
 */
export type AgreementRecord = z.infer<typeof agreementAcceptance> & { receivedAt: string };
/** Keeps an acceptance on the business; a new one (another version or time) writes one journal line. True when it was new. */
export function keepAgreement(d: MerkezData, biz: MerkezBusiness, accepted: z.infer<typeof agreementAcceptance> | undefined, time: string, by: 'cafe' = 'cafe') {
  if (!accepted) return false;
  const old = biz.agreement;
  if (old && old.version === accepted.version && old.acceptedAt === accepted.acceptedAt) {
    // The same acceptance again (a retry); a name added later is kept.
    if (accepted.name && accepted.name !== old.name) biz.agreement = { ...old, name: accepted.name };
    return false;
  }
  // An older acceptance arriving late never replaces a newer one.
  if (old && (old.version > accepted.version || (old.version === accepted.version && old.acceptedAt > accepted.acceptedAt))) return false;
  biz.agreement = { version: accepted.version, acceptedAt: accepted.acceptedAt, ...(accepted.name ? { name: accepted.name } : {}), receivedAt: time };
  d.audit.push({ action: 'agreement.accepted', target: biz.tenantId, at: time, by, detail: `Sürüm ${accepted.version}${accepted.name ? ` · ${accepted.name}` : ''}` });
  return true;
}
/** The heartbeat's acceptances, for the businesses of this install only. */
export function recordAgreements(d: MerkezData, list: SyncRequest['agreements'], mine: MerkezBusiness[], time: string) {
  for (const a of list ?? []) { const biz = mine.find(x => x.tenantId === a.tenantId); if (biz) keepAgreement(d, biz, { version: a.version, acceptedAt: a.acceptedAt, ...(a.name ? { name: a.name } : {}) }, time); }
}

export type IntegrityStatus = {
  state: IntegrityReport['state']; version: string; platform: string; changed: string[]; missing: string[]; signatureFailed?: boolean; manifestChanged?: boolean;
  /** When "changed" was first reported (kept while it stays changed). */
  firstSeenAt?: string;
  /** The café's own check time and when Merkez heard it. */
  checkedAt: string; receivedAt: string;
};
/** One short line of what was found, for the journal and the alert (file names only, at most a few). */
export function integritySummary(s: Pick<IntegrityStatus, 'changed' | 'missing' | 'signatureFailed' | 'manifestChanged'>) {
  const list = (files: string[]) => files.slice(0, 4).join(', ') + (files.length > 4 ? ` ve ${files.length - 4} dosya daha` : '');
  return [s.changed.length && `değişen: ${list(s.changed)}`, s.missing.length && `eksik: ${list(s.missing)}`, s.signatureFailed && 'imzalı liste doğrulanamadı', s.manifestChanged && !s.changed.length && 'dosya listesi değişmiş'].filter(Boolean).join('; ').slice(0, 400);
}
export class IntegrityBook {
  constructor(private store: MerkezStore) { store.db.exec('CREATE TABLE IF NOT EXISTS integrity_status (install TEXT PRIMARY KEY, payload TEXT NOT NULL)'); }
  status(install?: string): IntegrityStatus | undefined {
    if (!install) return undefined;
    const r = this.store.db.prepare('SELECT payload FROM integrity_status WHERE install=?').get(install) as { payload: string } | undefined;
    return r ? JSON.parse(r.payload) as IntegrityStatus : undefined;
  }
  private save(install: string, s: IntegrityStatus) { this.store.db.prepare('INSERT INTO integrity_status VALUES (?,?) ON CONFLICT(install) DO UPDATE SET payload=excluded.payload').run(install, JSON.stringify(s)); }
  forget(install: string) { this.store.db.prepare('DELETE FROM integrity_status WHERE install=?').run(install); }
  /**
   * The café's result with its heartbeat. "unknown" (no signed list yet, a file busy) never clears "changed": only a clean
   * check does. First "changed": journal line per business and one alert; back to "ok": journal line.
   */
  record(d: MerkezData, install: Install, report: IntegrityReport | undefined, mine: MerkezBusiness[], time: string) {
    if (!report) return;
    const before = this.status(install.id);
    const base = { version: report.version, platform: report.platform, checkedAt: report.at, receivedAt: time };
    if (report.state === 'unknown') { this.save(install.id, before && before.state !== 'unknown' ? { ...before, receivedAt: time } : { ...base, state: 'unknown', changed: [], missing: [] }); return; }
    if (report.state === 'ok') {
      this.save(install.id, { ...base, state: 'ok', changed: [], missing: [] });
      if (before?.state === 'changed') for (const b of mine) d.audit.push({ action: 'integrity.restored', target: b.tenantId, at: time, by: 'cafe', detail: `Sürüm ${report.version}` });
      return;
    }
    const now: IntegrityStatus = { ...base, state: 'changed', changed: report.changed ?? [], missing: report.missing ?? [], ...(report.signatureFailed ? { signatureFailed: true } : {}), ...(report.manifestChanged ? { manifestChanged: true } : {}),
      firstSeenAt: before?.state === 'changed' ? before.firstSeenAt ?? time : time };
    this.save(install.id, now);
    if (before?.state === 'changed') return;
    const what = integritySummary(now), names = mine.map(x => x.name).join(', ') || 'Bir işletme';
    for (const b of mine) d.audit.push({ action: 'integrity.changed', target: b.tenantId, at: time, by: 'cafe', detail: `Sürüm ${report.version} · ${what}` });
    addAlert(d, time, 'cafe.integrity', `${names}: işletmenin bilgisayarındaki Mola program dosyaları ${report.version} sürümünün imzalı listesiyle uyuşmuyor (${what}). İşletmenin çalışması durdurulmadı. İşletmeyle görüşebilir, gerekirse “Askıya al” ile hizmeti durdurabilirsiniz.`, { ...(mine[0] ? { tenantId: mine[0].tenantId } : {}), key: `integrity:${install.id}:${time}` });
  }
  /** The answer to `need`: the signed release of the café's version and platform, when the vendor uploaded that bundle. */
  manifestFor(releases: Releases, report?: IntegrityReport): SignedRelease | undefined {
    if (!report?.need) return undefined;
    return releases.list().find(r => r.platform === report.platform && r.version === report.version)?.signed;
  }
}
