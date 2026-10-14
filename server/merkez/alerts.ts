import { randomUUID } from 'node:crypto';
import type { MerkezData } from './store.js';

/*
 * "Bildirim merkezi": the events the vendor must not miss, kept in the sealed registry (newest ALERTS_KEEP). Each one may
 * also go out by e-mail (server/merkez/mail.ts) when the vendor set it up: queued here, sent and retried by the mail loop.
 * `key` makes an event once-only (the same café offline since the same last contact, the same licence end date).
 */
export type AlertKind = 'application.new' | 'application.resubmitted' | 'machine.conflict' | 'cafe.offline' | 'cafe.backup' | 'backup.failing' | 'ticket.new' | 'ticket.reply' | 'license.expiring' | 'owner.reset' | 'mail.test' | 'mail.failing' | 'update.failed' | 'admin.password_reset' | 'demo.reset' | 'support.access' | 'support.session' | 'cafe.cloud_backup' | 'journal.broken' | 'cafe.integrity' | 'site.lead' | 'merkez.recovery';
/** `priority: 'low'`: shown grey, no sound, never e-mailed (e.g. "ikinci yedek yeri ayarlı değil"). */
export type Alert = { id: string; kind: AlertKind; title: string; text: string; at: string; tenantId?: string; ticketId?: string; key?: string; readAt?: string; priority?: 'low' };
/** E-mail: SMTP settings (the app password stays in this sealed record; never logged, never sent back to the screen). */
/** `adminEmail`: "Yönetici e-postası" for the password reset code and "Şifreniz değiştirildi" (empty: the notification address `to`). */
export type MailSettings = { enabled: boolean; host: string; port: number; security: 'tls' | 'starttls' | 'none'; user: string; password: string; to: string; from?: string; adminEmail?: string; updatedAt: string };
/** `announcementId`: an e-mail copy of a Duyuru to one business (the queue counts it on the announcement when it goes or fails). */
/** `keepAlive`: the monthly check of the mailbox (server/merkez/mail.ts keepAlive). */
export type MailItem = { id: string; alertId?: string; announcementId?: string; keepAlive?: true; subject: string; text: string; to?: string; attempts: number; nextAt: string; createdAt: string; sentAt?: string; error?: string; failed?: boolean };
export const ALERTS_KEEP = 500, MAIL_KEEP = 200, MAIL_ATTEMPTS = 6;
/** Retry after 1, 5, 30 minutes, 2 and 6 hours; then the item is marked failed (shown in "E-posta bildirimleri"). */
export const MAIL_RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
export const alertTitles: Record<AlertKind, string> = {
  'application.new': 'Yeni hesap açma başvurusu', 'application.resubmitted': 'Başvuru yeniden gönderildi', 'machine.conflict': 'İki farklı bilgisayar',
  'cafe.offline': 'İşletme 3 gündür bağlanmadı', 'cafe.backup': 'İşletmenin yedeği başarısız', 'backup.failing': 'Mola Merkez yedeği alınamadı',
  'ticket.new': 'Yeni destek talebi', 'ticket.reply': 'Destek talebine yanıt', 'license.expiring': 'Lisans 7 gün içinde bitiyor', 'owner.reset': 'Sahip şifresi Mola koduyla yenilendi', 'mail.test': 'Deneme e-postası', 'mail.failing': 'E-posta gönderilemiyor', 'update.failed': 'Güncelleme kurulamadı',
  'admin.password_reset': 'Yönetici şifresi değiştirildi', 'demo.reset': 'Tanıtım işletmesi sıfırlandı',
  // Uzaktan destek (server/merkez/relay.ts): the owner's permission and each session's start and end.
  'support.access': 'Uzaktan destek izni', 'support.session': 'Destek oturumu',
  // Sunucu yedeği (server/merkez/backup-vault.ts): no upload for 2 days, quota, Merkez's disk, a taşıma to a new computer.
  'cafe.cloud_backup': 'Sunucu yedeği',
  // İşlem kayıtları (server/merkez/journal.ts): the chain check found a changed, missing or moved line.
  'journal.broken': 'İşlem kayıtlarında bozulma',
  // Program dosyaları denetimi (server/merkez/integrity.ts): the café's program files differ from its signed list.
  'cafe.integrity': 'Dosyalar değiştirilmiş',
  // Web sitesi talebi (server/merkez/site-leads.ts): the contact form on molayazilim.com.tr (type and city only).
  'site.lead': 'Web sitesi talebi',
  // The server's kurtarma-kodu.sh (server/merkez/offline-recovery.ts): a new Merkez recovery code; the old one no longer opens.
  'merkez.recovery': 'Merkez kurtarma kodu yenilendi',
};
/** Adds an event (once per `key`) and queues its e-mail. Runs inside the registry transaction. */
export function addAlert(d: MerkezData, at: string, kind: AlertKind, text: string, options: { tenantId?: string; ticketId?: string; key?: string; title?: string; priority?: 'low' } = {}) {
  const alerts = d.alerts ??= [], { title, ...extra } = options;
  if (extra.key && alerts.some(a => a.key === extra.key)) return undefined;
  const alert: Alert = { id: randomUUID(), kind, title: title ?? alertTitles[kind], text, at, ...extra };
  alerts.push(alert);
  if (alerts.length > ALERTS_KEEP) d.alerts = alerts.slice(-ALERTS_KEEP);
  if (d.mail?.settings?.enabled && alert.priority !== 'low') queueMail(d, at, `Mola Yönetim: ${alert.title}`, `${text}\n\nMola Yönetim’de “Bildirim merkezi”nden açabilirsiniz.\n${at.slice(0, 16).replace('T', ' ')} (UTC)`, alert.id);
  return alert;
}
export function queueMail(d: MerkezData, at: string, subject: string, text: string, alertId?: string, to?: string) {
  const mail = d.mail ??= { queue: [] };
  const item: MailItem = { id: randomUUID(), ...(alertId ? { alertId } : {}), subject, text, ...(to ? { to } : {}), attempts: 0, nextAt: at, createdAt: at };
  mail.queue.push(item);
  // Sent and failed items are kept a while for the screen; the oldest go first.
  if (mail.queue.length > MAIL_KEEP) mail.queue = [...mail.queue.filter(m => !m.sentAt && !m.failed), ...mail.queue.filter(m => m.sentAt || m.failed).slice(-(MAIL_KEEP / 2))].slice(-MAIL_KEEP);
  return item;
}
