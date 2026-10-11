import { MAIL_ATTEMPTS, MAIL_RETRY_MS, type MailItem, type MailSettings } from './alerts.js';
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

/**
 * The queue (in the sealed registry): every 30 s the next due item is sent; a failure waits 1, 5, 30 minutes, 2 and 6 hours,
 * then the item is marked failed. Runs in the Merkez process; `send` is swappable for tests.
 */
export class MailQueue {
  private timer?: NodeJS.Timeout; private running = false;
  constructor(private store: MerkezStore, private now: () => Date = () => new Date(), private send = sendMail) {}
  start(ms = 30_000) { this.stop(); this.timer = setInterval(() => void this.tick(), ms); this.timer.unref(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  async tick() {
    if (this.running) return 0; this.running = true;
    let sent = 0;
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
          if (!error) { m.sentAt = this.now().toISOString(); delete m.error; if (m.announcementId) countAnnouncementMail(x, m.announcementId, true); return; }
          m.error = error;
          if (m.attempts >= MAIL_ATTEMPTS) { m.failed = true; if (m.announcementId) countAnnouncementMail(x, m.announcementId, false); } else m.nextAt = new Date(this.now().getTime() + MAIL_RETRY_MS[Math.min(m.attempts - 1, MAIL_RETRY_MS.length - 1)]).toISOString();
        });
        if (!error) sent++;
      }
    } finally { this.running = false; }
    return sent;
  }
}
export type { MailItem };
