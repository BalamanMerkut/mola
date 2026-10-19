import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireRole } from '../packages/domain/engine.js';
import type { Actor } from '../packages/domain/types.js';
import { longDay, reminderText } from '../packages/domain/agenda.js';
import { open, seal } from './sealing.js';
import { snapshotKey, type Store } from './store.js';
import type { AgendaBook } from './agenda.js';
import { featureName, type FeatureId } from '../packages/domain/feature-gate.js';
import { endedCampaigns } from '../packages/domain/campaign-ends.js';

/** 'expense': an "Otomatik gider" was recorded (server/recurring-expenses.ts). 'cash': a cash closing, an opening difference or
 * a cashier's cash expense above the owner's limit (server/cash-closing.ts). 'stock': an item went under its minimum (server/stock.ts).
 * 'report': a period report (gün sonu, hafta, ay, yıl; server/email-reports.ts). 'demo': "Tanıtım" reset (server/demo-reset.ts). */
/** 'printer': a ticket did not print ("Yazıcıda kâğıt yok · Mutfak") or the roll is nearly out (server/printing.ts PrintService).
 * 'refund' (20 Ekim): a cashier's "iade isteği" (server/refunds.ts), for the owner and the Müdür: either may do it. */
export type NotificationKind = 'reminder' | 'license' | 'backup' | 'merkez' | 'expense' | 'cash' | 'stock' | 'report' | 'demo' | 'campaign' | 'printer' | 'refund';
/** One message in the owner's Bildirimler (üst çubuktaki zil). `readBy`: owner ids that opened it (read state is per owner). */
export type CafeNotification = { id: string; kind: NotificationKind; title: string; text: string; at: string; day?: string; readBy: string[]; /** 'campaign': the ended campaign ("Kampanya bitti", packages/domain/campaign-ends.ts). */ campaign?: { id: string; reportId: string; reason: 'time' | 'quota'; endedAt: string; uses?: number } };
/** What the Müdür sees in Bildirimler: nothing about the drawer, licences or backups (K1 kör kasa), only these. */
export const MANAGER_KINDS: readonly NotificationKind[] = ['campaign', 'refund'];
export type NotificationView = Omit<CafeNotification, 'readBy'> & { read: boolean };
/** What the café knows about its licence and backups, from app.ts (Mola Merkez link, backup scheduler). */
export type NotificationSources = {
  license?: (tenant: string) => { endsAt?: string | null; active: boolean; suspended?: boolean; frozen: boolean; daysRemaining: number; blocked?: string } | undefined;
  backups?: { status(): { lastError?: string; lastAttemptAt?: string }; second?: { status(): { folder?: string | null; lastError?: string } } };
  /** Hizmet paketi: the trial ended and these services closed (server/kafe-link.ts packageNotice); one copy here. */
  package?: (tenant: string) => { id: string; closed: string[] } | undefined;
  /** Conversations the Mola team started ("Yeni mesaj" in Mola Yönetim): one notice each, so Destek's red dot shows. */
  molaTickets?: (tenant: string) => { id: string; subject: string; createdAt: string }[];
};
const DAY = 86400000;
/** Reminders the server missed (switched off) still arrive when it starts, but not ones older than this. */
export const REMINDER_LOOKBACK = 3 * DAY;
const KEEP = 90 * DAY, MAX_KEPT = 300;
/** How many of the newest unread notifications GET /api/staff/notifications/count carries for the toasts. */
export const RECENT_TOASTS = 5;

/**
 * Notifications for the owner: Ajanda reminders when due, and a few café notices (licence ending or ended, the record
 * closed by Mola, a failed backup, an automatic expense recorded via `add`). Each is created once (its `key` is unique per business), sealed with the business key,
 * kept 90 days. A sweep runs every minute on the server (also with no screen open) and again on every read.
 */
export class Notifications {
  constructor(private store: Store, private agenda: AgendaBook, private now: () => Date, private sources: NotificationSources = {}) {
    store.db.exec('CREATE TABLE IF NOT EXISTS notifications (tenant TEXT NOT NULL, id TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (tenant,id), UNIQUE (tenant,key))');
    // Looked at, never shown: the campaigns that had ended before "Kampanya bitti" existed (no flood after an update).
    store.db.exec('CREATE TABLE IF NOT EXISTS notification_marks (tenant TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY (tenant,key))');
  }
  private key(tenant: string) {
    const key = snapshotKey(this.store.db, this.store.key, tenant);
    if (!key) throw new Error('İşletme anahtarı eksik.');
    return key;
  }
  /** Adds a notification unless one with the same key exists. Returns whether it was new. */
  add(tenant: string, key: string, n: Omit<CafeNotification, 'id' | 'at' | 'readBy'>) {
    if (this.store.db.prepare('SELECT 1 FROM notifications WHERE tenant=? AND key=?').get(tenant, key)) return false;
    const at = this.now(), item: CafeNotification = { id: randomUUID(), at: at.toISOString(), readBy: [], ...n };
    this.store.db.prepare('INSERT OR IGNORE INTO notifications (tenant,id,key,at,payload) VALUES (?,?,?,?,?)').run(tenant, item.id, key, at.getTime(), seal(item, this.key(tenant), `notification:${tenant}:${item.id}`));
    return true;
  }
  private rows(tenant: string) {
    const rows = this.store.db.prepare('SELECT id,payload FROM notifications WHERE tenant=? ORDER BY at DESC, rowid DESC LIMIT ?').all(tenant, MAX_KEPT) as { id: string; payload: Uint8Array }[];
    return rows.map(r => open<CafeNotification>(Buffer.from(r.payload), this.key(tenant), `notification:${tenant}:${r.id}`));
  }
  /** `kinds`: only these (the Müdür's MANAGER_KINDS); every kind for the owner. */
  list(tenant: string, owner: string, kinds?: readonly NotificationKind[]): NotificationView[] {
    return this.rows(tenant).filter(n => !kinds || kinds.includes(n.kind)).map(({ readBy, ...n }) => ({ ...n, read: readBy.includes(owner) }));
  }
  unread(tenant: string, owner: string, kinds?: readonly NotificationKind[]) { return this.list(tenant, owner, kinds).filter(n => !n.read).length; }
  /** Marks the notification added under `key` read for `owner` (an "İade isteği" the owner has just handled). */
  markKeyRead(tenant: string, owner: string, key: string) {
    const row = this.store.db.prepare('SELECT id FROM notifications WHERE tenant=? AND key=?').get(tenant, key) as { id: string } | undefined;
    if (row) this.markRead(tenant, owner, [row.id]);
  }
  markRead(tenant: string, owner: string, ids?: string[], kinds?: readonly NotificationKind[]) {
    const scope = (id: string) => `notification:${tenant}:${id}`;
    for (const n of this.rows(tenant)) {
      if (n.readBy.includes(owner) || (ids && !ids.includes(n.id)) || (kinds && !kinds.includes(n.kind))) continue;
      n.readBy = [...n.readBy, owner];
      this.store.db.prepare('UPDATE notifications SET payload=? WHERE tenant=? AND id=?').run(seal(n, this.key(tenant), scope(n.id)), tenant, n.id);
    }
  }
  /** Creates what is due for one business; cheap enough for every read. */
  sweep(tenant: string) {
    const t = this.now().getTime();
    for (const note of this.agenda.due(tenant, t - REMINDER_LOOKBACK, t)) {
      const due = note.reminder ? `${note.reminder.offset}:${note.reminder.time}:${note.day}` : '';
      const when = `${longDay(note.day)}${note.time ? ` · ${note.time}` : ''}`;
      this.add(tenant, `reminder:${note.id}:${due}`, { kind: 'reminder', day: note.day, title: `Hatırlatma: ${note.title || note.text.slice(0, 60)}`, text: `${when}${note.title && note.text ? ` · ${note.text}` : ''} (${reminderText(note.reminder!)})` });
    }
    const l = this.sources.license?.(tenant);
    if (l?.blocked === 'removed') this.add(tenant, 'merkez:removed', { kind: 'merkez', title: 'İşletme kaydı kapatıldı', text: 'Mola ekibi bu işletmenin kaydını kapattı. Yeni destek talebi gönderilemez; Mola ekibini arayın.' });
    else if (l?.endsAt) {
      if (l.suspended) this.add(tenant, `license:suspended:${l.endsAt}`, { kind: 'license', title: 'Hizmet askıya alındı', text: 'Müşteri menüsü ve yeni siparişler kapalı. Destek bölümünden bize ulaşabilirsiniz.' });
      else if (!l.active && !l.frozen && !l.blocked) this.add(tenant, `license:expired:${l.endsAt}`, { kind: 'license', title: 'Lisans süreniz doldu', text: 'Müşteri menüsü ve yeni siparişler kapalı. Yenileme için Talepler bölümünden bize yazın.' });
      else if (l.active && l.daysRemaining <= 1) this.add(tenant, `license:1:${l.endsAt}`, { kind: 'license', title: 'Lisansınız yarın bitiyor', text: 'Yenileme için Talepler bölümünden bize yazın.' });
      else if (l.active && l.daysRemaining <= 7) this.add(tenant, `license:7:${l.endsAt}`, { kind: 'license', title: `Lisansınızın bitmesine ${l.daysRemaining} gün kaldı`, text: 'Yenileme için Talepler bölümünden bize yazın.' });
    }
    const p = this.sources.package?.(tenant);
    if (p?.closed.length) this.add(tenant, `package:${p.id}`, { kind: 'license', title: 'Deneme süreniz bitti: paketiniz başladı', text: `Paketinizde olmayan hizmetler kapandı: ${p.closed.map(id => featureName(id as FeatureId)).join(', ')}. Verileriniz saklanıyor; paketinize eklerseniz hepsi geri gelir. Eklemek için Talepler'den Mola ekibine yazın.` });
    // A new conversation from the Mola team (the last 14 days: an update does not bring up old ones).
    for (const m of this.sources.molaTickets?.(tenant) ?? []) if (t - Date.parse(m.createdAt) < 14 * DAY) this.add(tenant, `mola-ticket:${m.id}`, { kind: 'merkez', title: 'Mola ekibinden mesaj', text: `Mola ekibi “${m.subject}” konusunda size yazdı. Destek → Talepler’den okuyup yanıtlayabilirsiniz.` });
    this.campaignEnds(tenant, t);
    const b = this.sources.backups?.status(), second = this.sources.backups?.second?.status();
    if (b?.lastError && b.lastAttemptAt) this.add(tenant, `backup:${b.lastAttemptAt.slice(0, 10)}`, { kind: 'backup', title: 'Otomatik yedek alınamadı', text: `${b.lastError} Kasa bilgisayarında şerit → Yedekle'den "Şimdi yedekle"yi deneyin.` });
    if (second?.folder && second.lastError) this.add(tenant, `backup-second:${new Date(t).toISOString().slice(0, 10)}`, { kind: 'backup', title: 'İkinci yedek yerine yazılamadı', text: 'Flash bellek takılı değil ya da yazılamıyor. Takınca bir sonraki yedekte kendiliğinden kopyalanır.' });
    this.store.db.prepare('DELETE FROM notifications WHERE tenant=? AND at<?').run(tenant, t - KEEP);
  }
  /**
   * "Kampanya bitti": once per ended campaign. The first sweep after the update only marks the campaigns that had already
   * ended (no flood of old ones); from then on each new end becomes one notification.
   */
  private campaignEnds(tenant: string, t: number) {
    const started = this.marked(tenant, 'campaign-ends:since');
    const s = this.store.read(tenant);
    if (started && !s.campaigns?.length) return;
    const ended = endedCampaigns(s, t);
    if (!started) {
      for (const e of ended) this.mark(tenant, e.key);
      this.mark(tenant, 'campaign-ends:since');
      return;
    }
    for (const e of ended) {
      if (this.marked(tenant, e.key)) continue;
      this.add(tenant, e.key, { kind: 'campaign', title: e.title, text: e.text, campaign: { id: e.campaignId, reportId: e.reportId, reason: e.reason, endedAt: e.endedAt, ...(e.uses !== undefined ? { uses: e.uses } : {}) } });
      this.mark(tenant, e.key);
    }
  }
  private marked(tenant: string, key: string) { return !!this.store.db.prepare('SELECT 1 FROM notification_marks WHERE tenant=? AND key=?').get(tenant, key); }
  private mark(tenant: string, key: string) { this.store.db.prepare('INSERT OR IGNORE INTO notification_marks (tenant,key) VALUES (?,?)').run(tenant, key); }
  sweepAll() {
    for (const { tenant } of this.store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) {
      try { this.sweep(tenant); } catch (error) { if (!this.store.db.isOpen) throw error; console.warn(`Bildirimler hazırlanamadı: ${error instanceof Error ? error.message : error}`); }
    }
  }
}

/**
 * Owner only: GET /api/staff/notifications (list + unread), GET /api/staff/notifications/count, POST
 * /api/staff/notifications/read { ids? } (no ids: all). Starts the minute sweep; it stops when the store closes.
 */
export function notificationRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, agenda: AgendaBook, sources: NotificationSources = {}, everyMs = 60_000) {
  const book = new Notifications(store, agenda, now, sources);
  // The owner reads every notification; the Müdür only MANAGER_KINDS ("Kampanya bitti", "İade isteği"), never the drawer, licence or backups.
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner', 'manager']); return { a, kinds: a.role === 'owner' ? undefined : MANAGER_KINDS }; };
  app.get('/api/staff/notifications', (req, res) => {
    const { a, kinds } = owner(req); book.sweep(a.tenantId);
    const items = book.list(a.tenantId, a.id, kinds);
    res.json({ items, unread: items.filter(n => !n.read).length });
  });
  app.get('/api/staff/notifications/count', (req, res) => {
    const { a, kinds } = owner(req); book.sweep(a.tenantId);
    // `latest`: the newest unread one, so the banner on Masalar says what happened (8 Ekim denetimi K4), not only "Yeni bir bildiriminiz var".
    const unread = book.list(a.tenantId, a.id, kinds).filter(n => !n.read), latest = unread[0];
    // `recent`: the newest unread ones with their line (10 Ekim): a screen that is open shows the ones it had not seen as a
    // small toast (src/NotificationToasts.tsx); what was already there when it opened stays quiet.
    const recent = unread.slice(0, RECENT_TOASTS).map(({ id, kind, title, text, at, day, campaign }) => ({ id, kind, title, text, at, ...(day ? { day } : {}), ...(campaign ? { campaign } : {}) }));
    res.json({ unread: unread.length, ...(latest ? { latest: { id: latest.id, kind: latest.kind, title: latest.title } } : {}), recent });
  });
  app.post('/api/staff/notifications/read', (req, res) => {
    const { a, kinds } = owner(req), { ids } = z.object({ ids: z.array(z.string().min(1).max(64)).max(300).optional() }).parse(req.body);
    book.markRead(a.tenantId, a.id, ids, kinds);
    res.json({ unread: book.unread(a.tenantId, a.id, kinds) });
  });
  if (everyMs > 0) {
    const timer = setInterval(() => { try { book.sweepAll(); } catch { clearInterval(timer); } }, everyMs);
    timer.unref();
  }
  return book;
}
