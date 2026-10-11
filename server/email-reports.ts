import type { Express, Request } from 'express';
import { z } from 'zod';
import { businessDay } from '../packages/domain/business-day.js';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import type { CashClosing } from '../packages/domain/cash.js';
import type { Actor } from '../packages/domain/types.js';
import { buildPeriodReport, endedPeriods, kindNames, PERIOD_KINDS, periodEnd, periodOf, plainSummary, reportHtml, reportSummary, reportText, type Period, type PeriodKind, type PeriodReport, type ReportSources } from './email-reports-content.js';
import type { Notifications } from './notifications.js';
import { htmlToPdf } from './pdf-print.js';
import { reportDocument, reportFileName } from './report-document.js';
import { open, seal } from './sealing.js';
import { safeError, sendSmtp, validAddress, validSettings, type SmtpAccount, type SmtpAttachment, type SmtpMessage } from './smtp.js';
import { snapshotKey, type Store } from './store.js';

/*
 * "E-posta raporları" (Ayarlar → İşletme → Raporlar ve e-posta, owner only). Decision of 4 Ekim: the period reports go to the
 * owner's own mailbox from the café's OWN e-mail account (Gmail address + app password, or any SMTP server), sent directly
 * from this computer through the shared SMTP client (server/smtp.ts). Nothing passes through Mola Merkez or a VDS.
 *   - Which reports: Gün sonu · Haftalık (Pazar kapanışı / Pazartesi 05:00) · Aylık · Yıllık, each its own switch.
 *   - When: the period ends at 05:00 after its last business day, or earlier right after that day's gün sonu kapanışı.
 *     A computer that was off then catches up at its next start (day reports of the last 7 days, the last week, month, year);
 *     the period key is made once (`entries`), so nothing is sent twice. Periods that ended before a switch was turned on are
 *     never made.
 *   - Each report also lands in Bildirimler (üst çubuktaki zil) with the same summary (kind 'report'), mail or no mail.
 *   - Sending is retried after 1, 5, 30 minutes, 2 and 6 hours, then "Gönderilemedi"; the screen shows the last send and error.
 * One sealed row per business (table email_reports, the business key): the account with its app password stays here, is never
 * sent back to a screen (only `hasPassword`), never logged, and never part of an error text (safeError).
 */
export type MailAccount = SmtpAccount & { provider: 'gmail' | 'other' };
export type Switches = Record<PeriodKind, boolean>;
type Entry = {
  key: string; kind: PeriodKind; from: string; to: string; title: string; createdAt: string;
  /** The report as made (sent as it is, also after retries); dropped some days after it went. */
  report?: PeriodReport;
  mail: 'pending' | 'sent' | 'failed' | 'off'; attempts: number; nextAt?: string; sentAt?: string; error?: string;
};
type Saved = {
  v: 1; account?: MailAccount; to: string[]; reports: Switches;
  /** When each switch was turned on: periods that ended before are never made (no flood of old reports). */
  since: Partial<Record<PeriodKind, string>>;
  entries: Entry[]; lastTest?: { at: string; ok: boolean; error?: string }; updatedAt: string;
};
export const MAIL_RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000], MAIL_ATTEMPTS = 6;
/** How far back a computer that was off catches up, per kind. */
const CATCH_UP: Record<PeriodKind, number> = { day: 7 * 86400_000, week: 14 * 86400_000, month: 40 * 86400_000, year: 40 * 86400_000 };
const KEEP_ENTRIES = 60, KEEP_REPORT_MS = 3 * 86400_000;
const OFF: Switches = { day: false, week: false, month: false, year: false };
export type Sender = (account: SmtpAccount, message: SmtpMessage) => Promise<void>;
/** HTML → PDF (server/pdf-print.ts: the installed Edge/Chrome); undefined when it cannot, and the HTML goes instead. */
export type PdfMaker = (html: string) => Promise<Buffer | undefined>;
/** The printable copy attached to every report mail: the A4 page as a PDF when this computer can make one, else as HTML. */
export async function reportAttachment(r: PeriodReport, pdf: PdfMaker, o: { note?: string; running?: boolean } = {}): Promise<SmtpAttachment & { kind: 'pdf' | 'html' }> {
  const html = reportDocument(r, o);
  let file: Buffer | undefined;
  try { file = await pdf(html); } catch { file = undefined; }
  return file ? { kind: 'pdf', filename: reportFileName(r, 'pdf'), contentType: 'application/pdf', content: file } : { kind: 'html', filename: reportFileName(r, 'html'), contentType: 'text/html', content: Buffer.from(html, 'utf8') };
}

export class EmailReports {
  private running = false;
  constructor(private store: Store, private now: () => Date, private sources: Omit<ReportSources, 'store'> & { notifications?: Notifications; enabled?: (tenant: string) => boolean }, private send: Sender = (a, m) => sendSmtp(a, m), private pdf: PdfMaker = html => htmlToPdf(html)) {
    store.db.exec('CREATE TABLE IF NOT EXISTS email_reports (tenant TEXT PRIMARY KEY, payload BLOB NOT NULL)');
  }
  private key(tenant: string) { const k = snapshotKey(this.store.db, this.store.key, tenant); if (!k) throw new Error('İşletme anahtarı eksik.'); return k; }
  read(tenant: string): Saved | undefined {
    const row = this.store.db.prepare('SELECT payload FROM email_reports WHERE tenant=?').get(tenant) as { payload: Uint8Array } | undefined;
    return row ? open<Saved>(Buffer.from(row.payload), this.key(tenant), `email-reports:${tenant}`) : undefined;
  }
  private write(tenant: string, s: Saved) {
    if (s.entries.length > KEEP_ENTRIES) s.entries = s.entries.slice(-KEEP_ENTRIES);
    this.store.db.prepare('INSERT INTO email_reports (tenant,payload) VALUES (?,?) ON CONFLICT(tenant) DO UPDATE SET payload=excluded.payload').run(tenant, seal(s, this.key(tenant), `email-reports:${tenant}`));
  }
  private update<T>(tenant: string, fn: (s: Saved) => T): T {
    const s = this.read(tenant) ?? { v: 1, to: [], reports: { ...OFF }, since: {}, entries: [], updatedAt: this.now().toISOString() };
    const result = fn(s); this.write(tenant, s); return result;
  }
  private sources_(): ReportSources { return { store: this.store, cash: this.sources.cash, shifts: this.sources.shifts }; }

  /** What the owner's screen shows: never the password. */
  view(tenant: string) {
    const s = this.read(tenant), a = s?.account, entries = s?.entries ?? [];
    const sent = entries.filter(e => e.sentAt).sort((x, y) => x.sentAt!.localeCompare(y.sentAt!)).at(-1);
    const failing = entries.filter(e => e.error && e.mail !== 'sent').sort((x, y) => x.createdAt.localeCompare(y.createdAt)).at(-1);
    return {
      account: a ? { provider: a.provider, host: a.host, port: a.port, security: a.security, user: a.user, from: a.from ?? '', hasPassword: !!a.password } : null,
      to: s?.to ?? [], reports: s?.reports ?? { ...OFF },
      status: { lastSentAt: sent?.sentAt ?? null, lastSentTitle: sent?.title ?? null, lastError: failing?.error ?? null, lastErrorTitle: failing?.title ?? null, waiting: entries.filter(e => e.mail === 'pending').length, failed: entries.filter(e => e.mail === 'failed').length, lastTest: s?.lastTest ?? null },
      recent: entries.slice(-8).reverse().map(e => ({ key: e.key, title: e.title, createdAt: e.createdAt, mail: e.mail, attempts: e.attempts, ...(e.sentAt ? { sentAt: e.sentAt } : {}), ...(e.error ? { error: e.error } : {}), ...(e.nextAt && e.mail === 'pending' ? { nextAt: e.nextAt } : {}) })),
    };
  }
  /** Saves the account (a blank password keeps the saved one), recipients and switches. */
  save(tenant: string, b: SaveInput) {
    return this.update(tenant, s => {
      const at = this.now().toISOString();
      if (b.account === null) delete s.account;
      else if (b.account) {
        const password = b.account.password ? b.account.password : s.account?.password ?? '';
        const account: MailAccount = { provider: b.account.provider, host: b.account.host.trim(), port: b.account.port, security: b.account.security, user: b.account.user.trim(), password, ...(b.account.from?.trim() ? { from: b.account.from.trim() } : {}) };
        try { validSettings(account); } catch (e) { throw new DomainError('EMAIL_SECURITY', safeError(e)); }
        if (!account.from && !validAddress(account.user)) throw new DomainError('EMAIL_FROM', 'Gönderen adresi yok: kullanıcı adı bir e-posta adresi değilse “Gönderen adresi”ni yazın.');
        if (account.user && !account.password) throw new DomainError('EMAIL_PASSWORD', 'Uygulama şifresini yazın.');
        s.account = account;
      }
      if (b.to) { if (b.to.some(x => !validAddress(x))) throw new DomainError('EMAIL_ADDRESS', 'Alıcı e-posta adreslerinden biri geçersiz.'); s.to = [...new Set(b.to.map(x => x.trim()))]; }
      if (b.reports) for (const k of PERIOD_KINDS) { if (b.reports[k] && !s.reports[k]) s.since[k] = at; s.reports[k] = b.reports[k]; }
      s.updatedAt = at;
      return true;
    });
  }
  /** "Deneme e-postası gönder": the business day so far, in the report's own look, to every recipient; the answer says why not. */
  async test(tenant: string) {
    const s = this.read(tenant);
    if (!s?.account) throw new DomainError('EMAIL_ACCOUNT', 'Önce e-posta hesabını kaydedin.', 409);
    if (!s.to.length) throw new DomainError('EMAIL_ADDRESS', 'Önce raporların gideceği adresi kaydedin.', 409);
    const now = this.now(), report = buildPeriodReport(this.sources_(), tenant, periodOf('day', businessDay(now.getTime())), now);
    const intro = 'Bu bir deneme e-postasıdır: Mola’nın e-posta raporları bu hesaptan böyle gelecek. Aşağıda bugünün şu ana kadarki rakamları var.';
    try {
      const file = await reportAttachment(report, this.pdf, { note: 'Deneme: bugünün şu ana kadarki rakamları.', running: true });
      const o = { intro, lead: plainSummary(report, true), attached: file.kind };
      await this.send(s.account, { to: s.to, subject: `Deneme · ${report.business} · Mola e-posta raporları`, text: reportText(report, o), html: reportHtml(report, o), fromName: report.business ? `${report.business} · Mola` : 'Mola', attachments: [file] });
      this.update(tenant, x => { x.lastTest = { at: now.toISOString(), ok: true }; });
      return { ok: true as const };
    } catch (e) {
      const error = safeError(e);
      this.update(tenant, x => { x.lastTest = { at: now.toISOString(), ok: false, error }; });
      throw new DomainError('EMAIL_FAILED', error, 502);
    }
  }
  /** Failed reports go again (from the first try's waiting time). */
  retry(tenant: string) {
    return this.update(tenant, s => { let n = 0; for (const e of s.entries) if (e.mail === 'failed' && e.report) { e.mail = 'pending'; e.attempts = 0; e.nextAt = this.now().toISOString(); n++; } return n; });
  }

  /** The periods due now for one business (not made yet): ended (05:00), or the last day's gün sonu kapanışı is done. */
  due(tenant: string, s: Saved, now: number): Period[] {
    const out: Period[] = [], made = new Set(s.entries.map(e => e.key));
    const today = businessDay(now), closedToday = this.sources.cash?.days<CashClosing>(tenant, ['closing'], today, today).some(c => c.status === 'closed' && !c.extra);
    for (const kind of PERIOD_KINDS) {
      if (!s.reports[kind]) continue;
      const since = Date.parse(s.since[kind] ?? '') || now;
      const candidates = [...endedPeriods(kind, now, CATCH_UP[kind]).reverse()];
      // The running period whose last day is today, once today's gün sonu kapanışı is done ("Pazar kapanışı").
      const current = periodOf(kind, today);
      if (current.to === today && closedToday) candidates.push(current);
      for (const p of candidates) if (!made.has(p.key) && periodEnd(p) > since) out.push(p);
    }
    return out;
  }
  /** Makes what is due (report + Bildirimler copy, mail queued) and sends what waits. Every minute and soon after start. */
  async tick() {
    if (this.running) return 0;
    this.running = true; let sent = 0;
    try {
      for (const { tenant } of this.store.db.prepare('SELECT tenant FROM email_reports').all() as { tenant: string }[]) {
        // Hizmet paketi: no "E-posta raporları" in the package, nothing is made or sent (settings and the list stay).
        if (this.sources.enabled && !this.sources.enabled(tenant)) continue;
        try { this.make(tenant); sent += await this.deliver(tenant); }
        catch (error) { if (!this.store.db.isOpen) throw error; console.warn(`E-posta raporu hazırlanamadı: ${error instanceof Error ? error.message : error}`); }
      }
    } finally { this.running = false; }
    return sent;
  }
  make(tenant: string) {
    const s = this.read(tenant); if (!s) return [];
    const now = this.now(), due = this.due(tenant, s, now.getTime()); if (!due.length) return [];
    const made: Entry[] = due.map(p => {
      const report = buildPeriodReport(this.sources_(), tenant, p, now), mailOn = !!s.account && s.to.length > 0;
      try { this.sources.notifications?.add(tenant, `report:${p.key}`, { kind: 'report', title: p.title, text: reportSummary(report) }); } catch (error) { console.warn(`Rapor bildirimi yazılamadı: ${error instanceof Error ? error.message : error}`); }
      return { key: p.key, kind: p.kind, from: p.from, to: p.to, title: p.title, createdAt: now.toISOString(), report, mail: mailOn ? 'pending' : 'off', attempts: 0, ...(mailOn ? { nextAt: now.toISOString() } : {}) };
    });
    this.update(tenant, x => { const known = new Set(x.entries.map(e => e.key)); x.entries.push(...made.filter(e => !known.has(e.key))); });
    return made;
  }
  private async deliver(tenant: string) {
    let sent = 0;
    for (let i = 0; i < 10; i++) {
      const s = this.read(tenant), t = this.now().getTime();
      const item = s?.account && s.to.length ? s.entries.find(e => e.mail === 'pending' && e.report && Date.parse(e.nextAt ?? '') <= t) : undefined;
      if (!s?.account || !item) break;
      let error: string | undefined;
      try {
        const r = item.report!, file = await reportAttachment(r, this.pdf);
        await this.send(s.account, { to: s.to, subject: `${item.title} · ${r.business}`, text: reportText(r, { attached: file.kind }), html: reportHtml(r, { attached: file.kind }), fromName: r.business ? `${r.business} · Mola` : 'Mola', attachments: [file] });
      } catch (e) { error = safeError(e); }
      this.update(tenant, x => {
        const e = x.entries.find(y => y.key === item.key); if (!e) return;
        e.attempts++;
        if (!error) { e.mail = 'sent'; e.sentAt = this.now().toISOString(); delete e.error; delete e.nextAt; return; }
        e.error = error;
        if (e.attempts >= MAIL_ATTEMPTS) { e.mail = 'failed'; delete e.nextAt; } else e.nextAt = new Date(this.now().getTime() + MAIL_RETRY_MS[Math.min(e.attempts - 1, MAIL_RETRY_MS.length - 1)]).toISOString();
      });
      if (!error) sent++;
    }
    // A sent report's figures are not kept for long (the summary stays in Bildirimler and in the owner's mailbox).
    this.update(tenant, x => { const t = this.now().getTime(); for (const e of x.entries) if (e.report && (e.mail === 'sent' || e.mail === 'off') && t - Date.parse(e.createdAt) > KEEP_REPORT_MS) delete e.report; });
    return sent;
  }
  /** A demo reset (server/demo-reset.ts) starts its reports over: the account and switches stay, the list goes. */
  forgetEntries(tenant: string) { if (this.read(tenant)) this.update(tenant, s => { s.entries = []; for (const k of PERIOD_KINDS) if (s.reports[k]) s.since[k] = this.now().toISOString(); }); }
}

const host = z.string().trim().min(3).max(200).regex(/^[A-Za-z0-9.-]+$/, 'Sunucu adı geçersiz.');
const saveInput = z.object({
  account: z.object({ provider: z.enum(['gmail', 'other']), host, port: z.number().int().min(1).max(65535), security: z.enum(['tls', 'starttls', 'none']), user: z.string().trim().max(200), password: z.string().max(200).optional(), from: z.string().trim().max(200).optional() }).strict().nullable().optional(),
  to: z.array(z.string().trim().max(200)).max(5).optional(),
  reports: z.object({ day: z.boolean(), week: z.boolean(), month: z.boolean(), year: z.boolean() }).strict().optional(),
}).strict();
export type SaveInput = z.infer<typeof saveInput>;

/**
 * Owner only: GET /api/staff/email-reports, POST /api/staff/email-reports (save), POST /api/staff/email-reports/test
 * ("Deneme e-postası gönder", at most 5 a minute), POST /api/staff/email-reports/retry. The loop runs every minute
 * (and 10 s after start: the catch-up of a computer that was off); `everyMs` 0 in tests, which call tick().
 */
export function emailReportRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, sources: Omit<ReportSources, 'store'> & { notifications?: Notifications; enabled?: (tenant: string) => boolean }, everyMs = 60_000, send?: Sender, pdf?: PdfMaker) {
  // Unit tests attach the HTML (no browser started) unless MOLA_PDF_BROWSER names one.
  const maker = pdf ?? (process.env.NODE_TEST_CONTEXT && !process.env.MOLA_PDF_BROWSER ? async () => undefined : undefined);
  const book = new EmailReports(store, now, sources, send, maker);
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner']); return a; };
  const tests = new Map<string, number[]>();
  app.get('/api/staff/email-reports', (req, res) => { const a = owner(req); res.setHeader('Cache-Control', 'no-store'); res.json(book.view(a.tenantId)); });
  app.post('/api/staff/email-reports', (req, res) => {
    const a = owner(req), b = saveInput.parse(req.body);
    book.save(a.tenantId, b);
    // A switch turned on for a period whose day already closed makes it at once (the next tick would too).
    book.make(a.tenantId);
    res.json(book.view(a.tenantId));
  });
  app.post('/api/staff/email-reports/test', async (req, res) => {
    const a = owner(req), t = now().getTime(), list = (tests.get(a.tenantId) ?? []).filter(x => x > t - 60_000);
    if (list.length >= 5) throw new DomainError('RATE_LIMIT', 'Bir dakikada en fazla 5 deneme e-postası gönderilebilir.', 429);
    tests.set(a.tenantId, [...list, t]);
    await book.test(a.tenantId);
    res.json(book.view(a.tenantId));
  });
  app.post('/api/staff/email-reports/retry', async (req, res) => { const a = owner(req); book.retry(a.tenantId); await book.tick(); res.json(book.view(a.tenantId)); });
  if (everyMs > 0) {
    const first = setTimeout(() => void book.tick().catch(() => {}), Math.min(everyMs, 10_000));
    const timer = setInterval(() => void book.tick().catch(() => clearInterval(timer)), everyMs);
    first.unref(); timer.unref();
  }
  return book;
}
export { kindNames };
