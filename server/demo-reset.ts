import type { Express, Request } from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import { NEW_BUSINESS_CHANGE_SECONDS } from '../packages/domain/change-window.js';
import { sectorNames, sectors, type Sector } from '../packages/domain/sector.js';
import type { Actor, CafeTable, State } from '../packages/domain/types.js';
import { passwordRecord } from './accounts.js';
import type { BackupScheduler } from './backup-scheduler.js';
import { demoCatalog, demoLogo, demoProducts, demoTables, DEMO_PROFILES } from './demo-template-data.js';
import type { EmailReports } from './email-reports.js';
import type { MerkezLink } from './kafe-link.js';
import type { Notifications } from './notifications.js';
import { seed } from './seed.js';
import { DEMO_STAFF_PASSWORD, type DemoReset as ResetOrder } from './signed-notes.js';
import type { Store } from './store.js';
import { addTemplatePhotos } from './template-photos.js';

/*
 * "Tanıtım işletmesi" (the vendor's demo business for sales visits). Only a business Mola Merkez marked as demo (signed,
 * server/signed-notes.ts) can be reset, and only by hand: Mola Yönetim → işletme → Hizmet → "Tanıtımı sıfırla" (a signed order
 * that travels with the heartbeat answer; server/kafe-link.ts runs it once and reports back) or the owner in Ayarlar →
 * Güvenlik ve diğer (typing SIFIRLA). Nothing here ever runs on a timer.
 * A reset:
 *   1. takes a backup first (the nightly backup's own "Şimdi yedekle" when this computer has it, else a copy of the database
 *      and its key beside the data folder: "<veri>-tanitim-oncesi-<zaman>"); no backup, no reset;
 *   2. in one transaction removes the business's orders, payments, closed accounts and history days, expenses and corrections,
 *      notifications, agenda notes, cash closings, shifts, stock records and reservations (the audit trail stays);
 *   3. writes the chosen template (kafe / restoran / tatlıcı, server/demo-template-data.ts): menu, categories, profile, logo and
 *      16 tables. The table QR codes stay FIXED (the vendor prints them once and reuses them at every demo): a template table
 *      keeps the id and token of the existing table with the same name or number (`keepQr`), only a table the business never
 *      had gets a new token, and an existing table beyond the template stays as it is, so no printed QR ever stops working.
 *      (Resets before 5 Oct 2026 renewed every token; those old tokens are still in `demo_retired_qr` and answer
 *      "Bu tanıtım yenilendi" — the only case left for that text);
 *   4. keeps the staff accounts (optionally all but the owner get the known demo password, DEMO_STAFF_PASSWORD), the licence,
 *      the Merkez link, printers and sounds;
 *   5. writes it in the business's audit trail and in Bildirimler (üst çubuktaki zil), and tells Mola Merkez (its audit trail and alerts).
 */
export const DEMO_RENEWED = 'Bu tanıtım yenilendi. Masadaki yeni QR kodunu okutun.';
// (No new rows: since resets keep the table QRs, nothing is retired any more; the table stays for tokens retired before.)
/** Rows of these tables belong to one business (`tenant` column) and go in a reset. history_audit stays: who did what. */
const WIPED = ['history_archives', 'history_payments', 'history_ledger', 'history_requests', 'history_days', 'history_payment_days', 'history_months', 'history_years', 'notifications', 'agenda_notes', 'cash_records', 'staff_shifts', 'shift_codes', 'staff_activity', 'stock_records', 'reservation_records', 'event_reports'];
export type ResetOptions = { sector: Sector; demoPassword: boolean; by: 'owner' | 'merkez'; actorId?: string; resetId?: string };
export type ResetResult = { resetId: string; sector: Sector; backup: string; tables: number; products: number; newQr: number };

/**
 * The template's floor with the business's own QR codes: each template table takes over the id and token of the existing table
 * with the same name, else with the same number ("Masa 3" ↔ "Masa 03"); the epoch moves on so a guest session from before the
 * reset starts over. Existing tables the template has no place for stay too (their QR keeps working; only a second table with a
 * name already on the floor, which the app never makes, would be left out).
 */
export function keepQr(old: CafeTable[], template: CafeTable[]): CafeTable[] {
  const floor = old.filter(t => !t.takeaway && !t.event && t.token), used = new Set<CafeTable>();
  const key = (name: string) => name.trim().toLocaleLowerCase('tr-TR'), number = (name: string) => /(\d+)\s*$/.exec(name)?.[1];
  const pick = (match: (t: CafeTable) => boolean) => { const t = floor.find(t => !used.has(t) && match(t)); if (t) used.add(t); return t; };
  const kept = template.map(t => {
    const n = number(t.name), same = pick(o => key(o.name) === key(t.name)) ?? (n ? pick(o => number(o.name) !== undefined && Number(number(o.name)) === Number(n)) : undefined);
    return same ? { ...t, id: same.id, token: same.token, epoch: same.epoch + 1 } : t;
  });
  const names = new Set(kept.map(t => key(t.name)));
  return [...kept, ...floor.filter(t => !used.has(t) && !names.has(key(t.name))).map(t => ({ ...t, epoch: t.epoch + 1, accountId: null, needsCleaning: false }))];
}

export class DemoResets {
  private busy = new Set<string>();
  notifications?: Notifications; emailReports?: EmailReports;
  constructor(private store: Store, private link: MerkezLink, private now: () => Date, private backups?: BackupScheduler) {
    store.db.exec('CREATE TABLE IF NOT EXISTS demo_retired_qr (token TEXT PRIMARY KEY, tenant TEXT NOT NULL, at INTEGER NOT NULL)');
  }
  private qr(token: string) { return createHmac('sha256', this.store.key).update('mola:demo-retired-qr:v1\0').update(token).digest('hex'); }
  /** A token renewed by a reset before 5 Oct 2026 (resets keep the QRs now) that no table has any more: "Bu tanıtım yenilendi". */
  retired(token: string) { return !!this.store.db.prepare('SELECT 1 FROM demo_retired_qr WHERE token=?').get(this.qr(token)); }
  retiredTenant(token: string) { return (this.store.db.prepare('SELECT tenant FROM demo_retired_qr WHERE token=?').get(this.qr(token)) as { tenant: string } | undefined)?.tenant; }

  /** Backup first: the scheduler's verified backup when there is one, else a copy of the database and key next to the folder. */
  private async backupFirst(): Promise<string> {
    if (this.backups) {
      const started = this.now().getTime(), st = await this.backups.runNow();
      if (st.lastError || !st.lastSuccessAt || Date.parse(st.lastSuccessAt) < started - 5 * 60_000) throw new DomainError('DEMO_BACKUP', `Önce yedek alınamadı; tanıtım sıfırlanmadı.${st.lastError ? ` ${st.lastError}` : ''}`, 503);
      return st.lastDirectory ?? 'otomatik yedek';
    }
    const dir = resolve(this.store.directory), stamp = this.now().toISOString().replace(/[:.]/g, '-');
    // Two resets within the same millisecond (or a clock set back) never share or overwrite a copy.
    let copy = join(dirname(dir), `${basename(dir)}-tanitim-oncesi-${stamp}`);
    for (let n = 2; existsSync(copy); n++) copy = join(dirname(dir), `${basename(dir)}-tanitim-oncesi-${stamp}-${n}`);
    try {
      mkdirSync(copy);
      this.store.db.prepare('VACUUM INTO ?').run(join(copy, 'merchant.sqlite'));
      const keys = ['development.key', 'anahtar.json', 'anahtar.yedek.json'].filter(name => existsSync(join(dir, name)));
      if (!keys.length) throw new Error('Anahtar dosyası bulunamadı.');
      for (const name of keys) copyFileSync(join(dir, name), join(copy, name));
      writeFileSync(join(copy, 'BENIOKU.txt'), 'Tanıtım işletmesi sıfırlanmadan hemen önce alınan kopya (veritabanı ve anahtarı). Gerekirse ayrı bir klasörde açın.\n');
    } catch (e) {
      rmSync(copy, { recursive: true, force: true });
      throw new DomainError('DEMO_BACKUP', `Önce yedek alınamadı; tanıtım sıfırlanmadı. ${e instanceof Error ? e.message : ''}`.trim(), 503);
    }
    return copy;
  }

  async reset(tenant: string, o: ResetOptions): Promise<ResetResult> {
    if (!this.link.isDemo(tenant)) throw new DomainError('NOT_DEMO', 'Bu işletme tanıtım işletmesi değil; sıfırlama yalnız tanıtım işletmelerinde yapılır.', 409);
    if (!sectors.includes(o.sector)) throw new DomainError('INVALID_SECTOR', 'Şablon seçin: kafe, restoran ya da tatlıcı.');
    if (this.busy.has(tenant)) throw new DomainError('DEMO_BUSY', 'Tanıtım şu anda sıfırlanıyor; birkaç saniye bekleyin.', 409);
    this.busy.add(tenant);
    try {
      const backup = await this.backupFirst();
      const [logo, secret] = await Promise.all([demoLogo(o.sector), o.demoPassword ? passwordRecord(DEMO_STAFF_PASSWORD) : Promise.resolve(undefined)]);
      const at = this.now().toISOString(), resetId = o.resetId ?? randomUUID();
      const old = this.store.read(tenant), profile = DEMO_PROFILES[o.sector], products = demoProducts(o.sector), tables = keepQr(old.tables, demoTables());
      // Printed QRs stay valid: only tables the business did not have before got a new token (to print once).
      const added = tables.filter(t => !old.tables.some(x => x.id === t.id)).length;
      // The template's product photos, new copies (server/template-photos.ts); the old ones are left unused for the photo cleaning.
      addTemplatePhotos(this.store.directory, tenant, products);
      // Staff stay; with the demo password every account but the owner's gets it (and is signed out: its version moves on).
      const staffUsers = (old.staffUsers ?? []).map(u => secret && u.role !== 'owner' ? { ...u, ...secret, version: u.version + 1 } : u);
      const next: State = {
        ...seed(tenant), name: old.name, sector: o.sector, products, ...demoCatalog(o.sector, products), productDrafts: [], tables, staffUsers,
        setupCompleted: true, businessRevision: (old.businessRevision ?? 0) + 1, menuRevision: (old.menuRevision ?? 1) + 1, approvalVersion: (old.approvalVersion ?? 0) + 1,
        paymentMode: 'after_service', cleaningEnabled: true, waiterApproval: true, autoApproveQr: false, changeSeconds: NEW_BUSINESS_CHANGE_SECONDS, commissionBps: 175,
        logo, theme: profile.theme as State['theme'], menuHero: profile.menuHero, googleReviewUrl: profile.googleReviewUrl,
        // The café computer's own devices and choices are not demo data.
        ...(old.printers ? { printers: old.printers } : {}), ...(old.sounds ? { sounds: old.sounds } : {}),
        // Who did it: the owner's id, or 'mola' for Mola Yönetim's order (the template is in Bildirimler and at Merkez).
        audit: [{ actor: o.actorId ?? 'mola', action: o.by === 'merkez' ? 'demo.reset_by_merkez' : 'demo.reset', target: tenant, at }],
      };
      const db = this.store.db;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const table of WIPED) if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) db.prepare(`DELETE FROM ${table} WHERE tenant=?`).run(tenant);
        // Closed years' packages are never written: this business's rows there are simply not read any more.
        this.store.packages.forget(tenant);
        db.prepare('UPDATE snapshots SET payload=? WHERE tenant=?').run(this.store.encode(next), tenant);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); this.store.packages.refresh(); throw e; }
      // Caches built on the removed rows (reports, stock, shifts) start over.
      this.store.history.forget(tenant);
      try { this.emailReports?.forgetEntries(tenant); } catch { /* the reports start again anyway */ }
      try { this.notifications?.add(tenant, `demo-reset:${resetId}`, { kind: 'demo', title: 'Tanıtım sıfırlandı', text: `${sectorNames[o.sector]} şablonu yüklendi (${o.by === 'merkez' ? 'Mola Yönetim’den' : 'işletme sahibi'}). Satışlar, ödemeler, kasa, stok, rezervasyon ve bildirim kayıtları silindi; önce yedek alındı. Masaların QR kodları değişmedi: basılı QR’lar aynen çalışır.${added ? ` ${added} yeni masanın QR’ını Ayarlar → Masalar ve QR → QR kodlarını yazdır’dan yazdırın.` : ''}${o.demoPassword ? ` Çalışan şifreleri: ${DEMO_STAFF_PASSWORD}` : ''}` }); } catch { /* the reset is done */ }
      // Mola Yönetim's order arrives with the heartbeat, not as a request: the new data is a real change for tonight's backup.
      this.backups?.changed();
      return { resetId, sector: o.sector, backup, tables: tables.length, products: products.length, newQr: added };
    } finally { this.busy.delete(tenant); }
  }
}

/**
 * GET /api/staff/demo (owner: is this a demo business, the templates), POST /api/staff/demo/reset { sector, demoPassword,
 * confirm: 'SIFIRLA' } (owner, demo businesses only). The Merkez order runs through link.demoReset (attached here).
 */
export function demoResetRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, link: MerkezLink, resets: DemoResets) {
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner']); return a; };
  link.demoReset = async (tenant, order: ResetOrder) => { await resets.reset(tenant, { sector: order.sector, demoPassword: order.demoPassword, by: 'merkez', resetId: order.id }); };
  app.get('/api/staff/demo', (req, res) => {
    const a = owner(req), demo = link.isDemo(a.tenantId);
    res.json({ demo, ...(demo ? { sector: store.read(a.tenantId).sector ?? 'cafe', templates: sectors.map(id => ({ id, name: sectorNames[id] })), demoPassword: DEMO_STAFF_PASSWORD } : {}) });
  });
  app.post('/api/staff/demo/reset', async (req, res) => {
    const a = owner(req), b = z.object({ sector: z.enum(sectors), demoPassword: z.boolean(), confirm: z.string() }).parse(req.body);
    if (b.confirm.trim().toLocaleUpperCase('tr-TR') !== 'SIFIRLA') throw new DomainError('CONFIRM', 'Onaylamak için kutuya SIFIRLA yazın.');
    let result: ResetResult;
    try { result = await resets.reset(a.tenantId, { sector: b.sector, demoPassword: b.demoPassword, by: 'owner', actorId: a.id }); }
    catch (e) { if (e instanceof DomainError && e.code !== 'NOT_DEMO' && e.code !== 'DEMO_BUSY') link.reportDemo({ tenantId: a.tenantId, resetId: randomUUID(), ok: false, error: e.message, at: new Date().toISOString(), by: 'owner', sector: b.sector }); throw e; }
    // Mola Merkez hears of it too (its audit trail), with the next heartbeat.
    link.reportDemo({ tenantId: a.tenantId, resetId: result.resetId, ok: true, at: new Date().toISOString(), by: 'owner', sector: result.sector }); link.nudge();
    res.json({ ok: true, sector: result.sector, tables: result.tables, products: result.products, newQr: result.newQr });
  });
}
