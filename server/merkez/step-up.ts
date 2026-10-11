import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { DomainError } from '../../packages/domain/engine.js';
import { ExpiringStore } from '../expiring-store.js';
import { clientKey } from '../http-security.js';
import type { MerkezStore } from './store.js';

/*
 * Güncelleme yetkisi (step-up for Güncellemeler; GELISTIRICI_REHBERI "Otomatik güncelleme"). Uploading a bundle (screen,
 * "Klasörde hazır", npm run yayinla), publishing (pilot / herkese), Durdur, Sil and editing a release note (a new signature) need a fresh code from the vendor's
 * Authenticator app on top of the session (or the "releases" access key). One right code opens a 10-minute window for that
 * session (or that key); the window is kept in memory only (a restart ends it), ends with the session, and ends when two-step
 * login is turned off or set up again. Without two-step login these actions are refused with MFA_REQUIRED.
 * Every try is in İşlem kayıtları: release.step_up (açıldı), release.step_up_failed (kod yanlış),
 * release.step_up_refused (çok fazla deneme / iki adımlı doğrulama kapalı), release.step_up_ended (elle kapatıldı).
 * Since 6 Ekim the same window also guards money changes (`require(who, 'sales')`): Hizmet fiyatları, Paketler, an
 * işletme's Hizmet, "Ödeme alındı" with a licence extension, Satışlarım entries and the KDV rate (server/merkez/catalog.ts,
 * sales.ts, app.ts). One code opens both for 10 minutes; only the words of the refusal differ.
 * Duyurular (`require(who, 'announce')`, server/merkez/announcements.ts): sending, editing and withdrawing an announcement, in the
 * same window.
 */
export const RELEASE_RIGHT_MINUTES = 10;
export const MFA_FIRST = 'Güncelleme yayınlamak için önce iki adımlı doğrulamayı açın (Ayarlar → Hesap güvenliği).';
export const MFA_FIRST_SALES = 'Fiyat, paket ve ödeme değişiklikleri için önce iki adımlı doğrulamayı açın (Ayarlar → Hesap güvenliği).';
export const MFA_FIRST_ANNOUNCE = 'Duyuru göndermek, düzeltmek ve geri çekmek için önce iki adımlı doğrulamayı açın (Ayarlar → Hesap güvenliği).';
/** What the right guards: Güncellemeler, prices / packages / payments, or Duyurular. */
export type RightUse = 'release' | 'sales' | 'announce';
/** Who asks: the admin session (its cookie value) or an access key record. */
type Who = unknown;
const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32);

export function releaseRight(o: { store: MerkezStore; now: () => Date; confirm: (req: Request, code: string) => void }) {
  const grants = new ExpiringStore<{ until: number; factor: string }>(v => v.until, () => o.now().getTime(), 1000, true);
  const keyOf = (who: Who) => typeof who === 'string' ? `oturum:${sha(who)}` : `anahtar:${(who as { id?: string }).id ?? ''}`;
  /** The current Authenticator (a fingerprint of its secret): a window from an older one does not count. */
  const factor = () => { const s = o.store.read().admin.mfa?.secret; return s ? sha(`mola-guncelleme-yetkisi:${s}`) : undefined; };
  const live = (who: Who) => { const g = grants.get(keyOf(who)), f = factor(); return g && f && g.factor === f ? g : undefined; };
  const record = (action: string, detail: string) => { try { o.store.journal.append({ action, target: { kind: 'admin', id: 'admin', name: 'Güncelleme yetkisi' }, detail }); } catch { /* the record is secondary to the answer */ } };
  const refusedTold = new Map<string, number>();
  return {
    /** For the screen: is two-step login on, and until when the window is open (null: closed). */
    status(who: Who) { const g = live(who); return { mfa: !!factor(), until: g ? new Date(g.until).toISOString() : null, minutes: RELEASE_RIGHT_MINUTES }; },
    /** Checks the code and opens the window; every outcome is recorded. */
    open(req: Request, who: Who, code: string) {
      const f = factor();
      if (!f) { record('release.step_up_refused', 'İki adımlı doğrulama kapalı'); throw new DomainError('MFA_REQUIRED', MFA_FIRST, 403); }
      try { o.confirm(req, code); }
      catch (e) {
        if (e instanceof DomainError && e.code === 'RATE_LIMIT') {
          // A guessing run keeps trying: one "durduruldu" line per address every 5 minutes is enough.
          const k = clientKey(req), t = o.now().getTime();
          if ((refusedTold.get(k) ?? 0) <= t - 300_000) { refusedTold.set(k, t); if (refusedTold.size > 1000) refusedTold.clear(); record('release.step_up_refused', 'Çok fazla yanlış kod; bir süre beklenmeli'); }
        } else if (e instanceof DomainError && e.code === 'MFA_OFF') { record('release.step_up_refused', 'İki adımlı doğrulama kapalı'); throw new DomainError('MFA_REQUIRED', MFA_FIRST, 403); }
        else if (e instanceof DomainError) record('release.step_up_failed', e.status === 400 ? 'Kod 6 rakam değil' : 'Doğrulayıcı kodu yanlış, kullanılmış ya da süresi dolmuş');
        throw e;
      }
      const until = o.now().getTime() + RELEASE_RIGHT_MINUTES * 60_000;
      grants.set(keyOf(who), { until, factor: factor() ?? f });
      record('release.step_up', `Doğrulayıcı koduyla ${RELEASE_RIGHT_MINUTES} dakikalık güncelleme yetkisi açıldı`);
      return new Date(until).toISOString();
    },
    end(who: Who) { if (grants.delete(keyOf(who))) record('release.step_up_ended', 'Güncelleme yetkisi elle kapatıldı'); },
    /** Before an upload, a publish, Durdur, Sil or a note edit (the release is signed again); sales: a price, package or payment change. */
    require(who: Who, use: RightUse = 'release') {
      if (!factor()) throw new DomainError('MFA_REQUIRED', use === 'sales' ? MFA_FIRST_SALES : use === 'announce' ? MFA_FIRST_ANNOUNCE : MFA_FIRST, 403);
      if (!live(who)) throw new DomainError('STEP_UP_REQUIRED', use !== 'release' ? `Bu değişiklik için doğrulayıcı uygulamadaki güncel 6 haneli kodu girin (onay ${RELEASE_RIGHT_MINUTES} dakika geçerli olur).` : `Bu işlem için doğrulayıcı uygulamadaki güncel 6 haneli kodu girin (güncelleme yetkisi ${RELEASE_RIGHT_MINUTES} dakika geçerli olur).`, 403);
    },
  };
}
export type ReleaseRight = ReturnType<typeof releaseRight>;
