import { MAIL_ATTEMPTS, MAIL_RETRY_MS, addAlert, queueMail, type MailItem, type MailSettings } from './alerts.js';
import type { MerkezStore } from './store.js';
import { countAnnouncementMail } from './announcements.js';
import { safeError, sendSmtp } from '../smtp.js';
// The SMTP client itself is shared with the café's "E-posta raporları" (server/smtp.ts); these names stay importable from here.
export { MailError, NO_SENDER, senderOf, validAddress, validSettings } from '../smtp.js';

/*
 * E-posta bildirimleri of the vendor, through the shared dependency-free SMTP client (server/smtp.ts): one plain-text
 * message at a time, "From: Mola Yönetim <…>" exactly as before. Security 'none' only for a relay on this computer.
 * The password is never logged and never part of an error text.
 */
export async function sendMail(s: MailSettings, to: string, subject: string, text: string, timeoutMs = 20_000) {
  return sendSmtp(s, { to, subject, text, fromName: 'Mola Yönetim', encodeName: false, ehlo: 'mola-merkez' }, timeoutMs);
}

/** Aylık e-posta kontrolü: when nothing went for this long, one short e-mail to the vendor's own address. */
export const KEEP_ALIVE_DAYS = 30;
/**
 * The queue (in the sealed registry): every 30 s the next due item is sent; a failure waits 1, 5, 30 minutes, 2 and 6 hours,
 * then the item is marked failed. Runs in the Merkez process; `send` is swappable for tests.
 * 14 Ekim: the sending service (Brevo) drops an SMTP key that sends nothing for 90 days, and then the cafés' "İşletmem var"
 * codes would quietly stop. So after KEEP_ALIVE_DAYS without a sent e-mail the vendor gets a short check e-mail; an e-mail
 * that finally fails (any, the check too) shows in Bildirim merkezi as "E-posta gönderilemiyor", once a day.
 */
export class MailQueue {
  private timer?: NodeJS.Timeout; private running = false;
  constructor(private store: MerkezStore, private now: () => Date = () => new Date(), private send = sendMail) {}
  start(ms = 30_000) { this.stop(); this.timer = setInterval(() => void this.tick(), ms); this.timer.unref(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  /** Queues the monthly check when due (nothing sent for KEEP_ALIVE_DAYS, none waiting). A first run only starts the count. */
  keepAlive() {
    const d = this.store.read(), m = d.mail;
    if (!m?.settings?.enabled) return false;
    const t = this.now(), sent = [m.lastSentAt, ...m.queue.map(i => i.sentAt)].filter(Boolean).map(v => Date.parse(v!)), last = sent.length ? Math.max(...sent) : NaN;
    if (Number.isNaN(last)) { this.store.mutate(x => { if (x.mail && !x.mail.lastSentAt) x.mail.lastSentAt = t.toISOString(); }); return false; }
    if (t.getTime() - last < KEEP_ALIVE_DAYS * 86400_000 || m.queue.some(i => i.keepAlive && !i.sentAt && !i.failed)) return false;
    this.store.mutate(x => {
      const item = queueMail(x, t.toISOString(), 'Mola Yönetim: aylık e-posta kontrolü',
        `Mola Merkez’in e-posta gönderimi çalışıyor.\nBu kısa e-posta, ${KEEP_ALIVE_DAYS} gün hiç e-posta gitmediğinde kendiliğinden gönderilir; e-posta hizmetinin anahtarı kullanılmadığı için kapanmasın diye. Bir şey yapmanız gerekmez.\n${t.toISOString().slice(0, 16).replace('T', ' ')} (UTC)`);
      item.keepAlive = true;
    });
    return true;
  }
  async tick() {
    if (this.running) return 0; this.running = true;
    let sent = 0;
    try { this.keepAlive(); } catch { /* the registry is busy: next time */ }
    try {
      for (let i = 0; i < 10; i++) {
        const d = this.store.read(), s = d.mail?.settings, t = this.now().getTime();
        const item = s?.enabled ? d.mail!.queue.find(m => !m.sentAt && !m.failed && Date.parse(m.nextAt) <= t) : undefined;
        if (!s || !item) break;
        let error: string | undefined;
        try { await this.send(s, item.to ?? s.to, item.subject, item.text); } catch (e) { error = safeError(e); }
        this.store.mutate(x => {
          const m = x.mail?.queue.find(y => y.id === item.id); if (!m) return;
          m.attempts++;
          // A Duyuru's e-mail copy: counted on the announcement once it went, or once it finally failed.
          if (!error) { m.sentAt = this.now().toISOString(); x.mail!.lastSentAt = m.sentAt; delete m.error; if (m.announcementId) countAnnouncementMail(x, m.announcementId, true); return; }
          m.error = error;
          if (m.attempts >= MAIL_ATTEMPTS) {
            m.failed = true; if (m.announcementId) countAnnouncementMail(x, m.announcementId, false);
            const at = this.now().toISOString();
            addAlert(x, at, 'mail.failing', `Mola Merkez e-posta gönderemiyor: ${error}. Ayarlar → E-posta bildirimleri’nden bilgileri kontrol edip “Deneme e-postası gönder”e basın (e-posta hizmetinin anahtarının süresi dolmuş olabilir).`, { key: `mail.failing:${at.slice(0, 10)}` });
          } else m.nextAt = new Date(this.now().getTime() + MAIL_RETRY_MS[Math.min(m.attempts - 1, MAIL_RETRY_MS.length - 1)]).toISOString();
        });
        if (!error) sent++;
      }
    } finally { this.running = false; }
    return sent;
  }
}
export type { MailItem };
