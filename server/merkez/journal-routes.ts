import { copyFileSync, mkdirSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { pdfOf, pdfProblemText } from '../pdf-print.js';
import { platformNames } from '../update-manifest.js';
import { newToken, SCOPE_NAMES, tokenView, type TokenScope } from './access-tokens.js';
import { addAlert } from './alerts.js';
import { filterRows, journalRows, MAX_RETENTION_YEARS, MIN_RETENTION_YEARS, type Journal, type JournalFilter, type JournalRow, type VerifyReport } from './journal.js';
import { reportHtml, reportXlsx, type ReportInfo } from './journal-report.js';
import { ACTOR_NAMES, GROUP_NAMES, RESULT_NAMES, actionText, knownActions, type JournalGroup, type JournalResult } from './journal-text.js';
import type { Releases } from './releases.js';
import type { MerkezStore } from './store.js';
import { buildSnapshot, folderProblem, type WorkFolder } from './workfolder.js';

/*
 * Mola Yönetim → Ayarlar: "İşlem kayıtları" (list, filters, Rapor al), "Çalışma klasörü", "Geliştirici erişimi", and the
 * Güncellemeler page's "Klasörde hazır" (bundles dropped into <çalışma klasörü>\guncellemeler). All need the admin session;
 * the snapshot also takes a "calisma" token (the VDS sync), the release-folder list a "releases" token.
 *   GET  /api/merkez/admin/journal?from&to&business&actor&group&action&result&q&page   rows (50 a page, newest first) + facets
 *   GET  /api/merkez/admin/journal/verify                                              the whole chain now (and a fresh seal)
 *   GET  /api/merkez/admin/journal/report.pdf | report.xlsx | export.jsonl (same query)  "Rapor al"
 *   GET  /api/merkez/admin/journal/report.html (same query)                            "Yazdır" (printable A4 page)
 *   GET/POST /api/merkez/admin/journal/settings { retentionYears }                     saklama süresi (2–100, default 10)
 *   GET/POST /api/merkez/admin/access-tokens, POST access-tokens/revoke                Geliştirici erişimi
 *   GET/POST /api/merkez/admin/workfolder, POST workfolder/sync, GET workfolder/snapshot?since=
 *   GET  /api/merkez/admin/releases/folder, POST releases/folder/import { name }
 */
type Deps = {
  store: MerkezStore; now: () => Date; admin: (req: Request) => unknown; releaseAdmin: (req: Request) => unknown;
  /** releaseAdmin plus the Güncelleme yetkisi (server/merkez/step-up.ts): "Klasörde hazır" → "Yükle ve doğrula". */
  releaseChange: (req: Request) => unknown;
  tokenOrAdmin: (req: Request, scope: TokenScope) => unknown; checkPassword: (req: Request, password: string) => Promise<boolean>;
  releases: Releases; workFolder: WorkFolder; version: string;
};
const PAGE = 50;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined));
const filterSchema = z.object({ from: day, to: day, business: z.string().max(100).optional(), actor: z.string().max(120).optional(), group: z.string().max(40).optional(), action: z.string().max(80).optional(), result: z.enum(['basarili', 'basarisiz', 'reddedildi']).optional().or(z.literal('').transform(() => undefined)), q: z.string().max(200).optional(), page: z.coerce.number().int().min(1).max(100000).optional() });

export function journalRoutes(app: Express, deps: Deps) {
  const { store, now, admin } = deps, journal: Journal = store.journal;
  let verified: { head: string | null; at: number; report: VerifyReport } | undefined;
  /** The chain check, again when the chain grew or after 10 minutes (it walks every line). */
  const check = (fresh = false) => {
    const head = journal.head()?.hash ?? null, t = now().getTime();
    if (fresh || !verified || verified.head !== head || t - verified.at > 600_000) {
      verified = { head, at: t, report: journal.verify() };
      if (!verified.report.ok) noteBroken(verified.report);
    }
    return verified.report;
  };
  /** A broken chain is said once per place (a line in the chain itself, and a Bildirim merkezi alert via the store). */
  const told = new Set<string>();
  function noteBroken(v: VerifyReport) {
    const k = `${v.problem?.seq}:${v.problem?.kind}`; if (told.has(k)) return; told.add(k);
    try { store.mutate(d => { addAlert(d, now().toISOString(), 'journal.broken', `${v.text} Kayıtları değiştirmek mümkün olmamalı: bilgisayara erişimi olan biri veritabanı dosyasıyla oynamış olabilir. Çalışma klasöründeki günlük dosyalar ve alınmış raporlar karşılaştırma için saklanmalı.`, { key: `journal:${k}` }); }); } catch { /* shown on screen anyway */ }
    try { journal.append({ action: 'journal.broken', detail: v.text }); } catch { /* reported on screen anyway */ }
  }
  const query = (req: Request) => {
    const f = filterSchema.parse(req.query); const { page, ...filter } = f;
    if (filter.from && filter.to && filter.from > filter.to) throw new DomainError('PERIOD_INVALID', 'Başlangıç tarihi bitiş tarihinden sonra olamaz.', 400);
    return { filter: filter as JournalFilter, page: page ?? 1 };
  };
  const rowsFor = (filter: JournalFilter) => filterRows(journalRows(journal.entries()), filter);
  const describeFilter = (f: JournalFilter, all: JournalRow[]) => [
    f.business && `İşletme: ${all.find(r => r.business?.id === f.business)?.business?.name ?? f.business}`,
    f.actor && `Kim: ${f.actor.startsWith('token:') ? all.find(r => r.actor.kind === 'token' && r.actor.id === f.actor!.slice(6))?.actor.name ?? 'Geliştirici erişimi' : ACTOR_NAMES[f.actor as keyof typeof ACTOR_NAMES] ?? f.actor}`,
    f.group && `İşlem türü: ${GROUP_NAMES[f.group as JournalGroup] ?? f.group}`, f.action && `İşlem: ${actionText(f.action)}`,
    f.result && `Sonuç: ${RESULT_NAMES[f.result as JournalResult]}`, f.q?.trim() && `Arama: “${f.q.trim()}”`,
  ].filter(Boolean) as string[];

  app.get('/api/merkez/admin/journal', (req, res) => {
    admin(req); const { filter, page } = query(req);
    const all = journalRows(journal.entries()), rows = filterRows(all, filter), pages = Math.max(1, Math.ceil(rows.length / PAGE)), current = Math.min(page, pages);
    const businesses = new Map<string, string>(), tokens = new Map<string, string>(), actions = new Set<string>();
    for (const r of all) { if (r.business) businesses.set(r.business.id, r.business.name ?? businesses.get(r.business.id) ?? r.business.id); if (r.actor.kind === 'token' && r.actor.id) tokens.set(r.actor.id, r.actor.name ?? 'Geliştirici erişimi'); actions.add(r.action); }
    // The current names first (a renamed business shows its new name).
    for (const b of store.read().businesses) if (businesses.has(b.tenantId)) businesses.set(b.tenantId, b.name);
    res.json({ rows: rows.slice((current - 1) * PAGE, current * PAGE), total: rows.length, all: all.length, page: current, pages,
      facets: { businesses: [...businesses].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'tr')), tokens: [...tokens].map(([id, name]) => ({ id, name })), groups: Object.entries(GROUP_NAMES).map(([id, name]) => ({ id, name })), actions: [...actions].filter(a => knownActions().includes(a) || a).map(a => ({ id: a, name: actionText(a) })).sort((a, b) => a.name.localeCompare(b.name, 'tr')) },
      verify: check(), retentionYears: journal.retentionYears(), seal: (s => s ? { seq: s.seq, at: s.at } : null)(journal.lastSeal()) });
  });
  app.get('/api/merkez/admin/journal/verify', (req, res) => { admin(req); journal.sealNow(); res.json({ verify: check(true) }); });
  const info = (filter: JournalFilter, rows: JournalRow[]): ReportInfo => {
    const seal = journal.sealNow();
    return { filter, filterText: describeFilter(filter, journalRows(journal.entries())), verify: check(true), seal, generatedAt: now().toISOString(), keyId: journal.keyId, total: rows.length };
  };
  const fileName = (f: JournalFilter, ext: string) => `islem-kayitlari-${f.from ?? 'baslangic'}-${f.to ?? 'bugun'}.${ext}`;
  const exported = (format: string, f: JournalFilter, count: number, extra: string[]) => journal.append({ action: 'journal.exported', detail: `${format} · ${count} kayıt · ${[f.from || f.to ? `${f.from ?? '…'} – ${f.to ?? '…'}` : 'bütün dönem', ...extra].join(' · ')}` });
  app.get('/api/merkez/admin/journal/report.pdf', async (req, res) => {
    admin(req); const { filter } = query(req), rows = rowsFor(filter), about = info(filter, rows);
    const made = await pdfOf(reportHtml(rows, about));
    if (!made.pdf) throw new DomainError('PDF_UNAVAILABLE', pdfProblemText(made, '“Yazdır” ile tarayıcıdan PDF olarak kaydedebilir ya da Excel veya JSONL olarak alabilirsiniz.'), 409);
    exported('PDF', filter, rows.length, about.filterText);
    send(res, made.pdf, 'application/pdf', fileName(filter, 'pdf'));
  });
  // "Yazdır": the same A4 report as a page (the browser's own print, also "PDF olarak kaydet" when no PDF can be made here).
  app.get('/api/merkez/admin/journal/report.html', (req, res) => {
    admin(req); const { filter } = query(req), rows = rowsFor(filter), about = info(filter, rows);
    exported('Yazdırılabilir sayfa', filter, rows.length, about.filterText);
    res.set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:" });
    res.type('text/html; charset=utf-8').send(reportHtml(rows, about));
  });
  app.get('/api/merkez/admin/journal/report.xlsx', (req, res) => {
    admin(req); const { filter } = query(req), rows = rowsFor(filter), about = info(filter, rows);
    const data = reportXlsx(rows, about, now());
    exported('Excel', filter, rows.length, about.filterText);
    send(res, data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName(filter, 'xlsx'));
  });
  app.get('/api/merkez/admin/journal/export.jsonl', (req, res) => {
    // Only the period applies: an independent check needs every line of it, unbroken.
    admin(req); const { filter } = query(req), out = journal.jsonl(filter.from, filter.to);
    exported('JSONL (denetlenebilir)', filter, out.count, []);
    send(res, Buffer.from(out.text, 'utf8'), 'application/x-ndjson; charset=utf-8', fileName(filter, 'jsonl'));
  });
  app.get('/api/merkez/admin/journal/settings', (req, res) => { admin(req); res.json({ retentionYears: journal.retentionYears(), min: MIN_RETENTION_YEARS, max: MAX_RETENTION_YEARS }); });
  app.post('/api/merkez/admin/journal/settings', (req, res) => {
    admin(req); const b = z.object({ retentionYears: z.number().int() }).strict().parse(req.body);
    if (b.retentionYears < MIN_RETENTION_YEARS || b.retentionYears > MAX_RETENTION_YEARS) throw new DomainError('RETENTION_INVALID', `Saklama süresi ${MIN_RETENTION_YEARS} ile ${MAX_RETENTION_YEARS} yıl arasında olmalı (önerilen 10 yıl).`, 400);
    const before = journal.retentionYears();
    if (before !== b.retentionYears) { journal.setRetention(b.retentionYears); journal.append({ action: 'journal.retention_set', detail: `${before} yıl → ${b.retentionYears} yıl`, changes: [{ field: 'saklama süresi', from: `${before} yıl`, to: `${b.retentionYears} yıl` }] }); }
    res.json({ retentionYears: journal.retentionYears(), min: MIN_RETENTION_YEARS, max: MAX_RETENTION_YEARS });
  });

  // ---------- Geliştirici erişimi ----------
  const tokens = () => (store.read().accessTokens ?? []).map(tokenView).reverse();
  app.get('/api/merkez/admin/access-tokens', (req, res) => { admin(req); res.json({ tokens: tokens(), scopes: SCOPE_NAMES }); });
  app.post('/api/merkez/admin/access-tokens', async (req, res) => {
    admin(req); const b = z.object({ name: z.string().trim().min(2).max(60), scope: z.enum(['releases', 'calisma']).default('releases'), password: z.string().min(1).max(128) }).strict().parse(req.body);
    if (!await deps.checkPassword(req, b.password)) throw new DomainError('INVALID_PASSWORD', 'Yönetici şifresi yanlış.', 403);
    const made = store.mutate(d => {
      if ((d.accessTokens ?? []).filter(t => !t.revokedAt).length >= 10) throw new DomainError('TOO_MANY_TOKENS', 'En fazla 10 etkin anahtar olabilir. Kullanmadıklarınızı iptal edin.', 409);
      const t = newToken(d, b.name, b.scope, now().toISOString());
      d.audit.push({ action: 'token.created', target: 'admin', at: now().toISOString(), by: 'admin', detail: `${b.name} · ${SCOPE_NAMES[b.scope]} · ${t.record.hint}` });
      return t;
    });
    res.json({ token: made.text, view: tokenView(made.record), tokens: tokens() });
  });
  app.post('/api/merkez/admin/access-tokens/revoke', (req, res) => {
    admin(req); const b = z.object({ id: z.string().uuid() }).strict().parse(req.body);
    store.mutate(d => {
      const t = d.accessTokens?.find(x => x.id === b.id); if (!t) throw new DomainError('NOT_FOUND', 'Anahtar bulunamadı.', 404);
      if (!t.revokedAt) { t.revokedAt = now().toISOString(); d.audit.push({ action: 'token.revoked', target: 'admin', at: t.revokedAt, by: 'admin', detail: `${t.name} · ${t.hint}` }); }
    });
    res.json({ tokens: tokens() });
  });

  // ---------- Çalışma klasörü ----------
  const folderView = () => ({ ...deps.workFolder.status(), dataDirectory: store.directory });
  app.get('/api/merkez/admin/workfolder', (req, res) => { admin(req); res.json(folderView()); });
  app.post('/api/merkez/admin/workfolder', async (req, res) => {
    admin(req); const b = z.object({ path: z.string().trim().max(400).nullable() }).strict().parse(req.body);
    if (b.path !== null) {
      const problem = folderProblem(b.path, store.directory);
      if (problem) throw new DomainError('FOLDER_INVALID', problem, 400);
      try { mkdirSync(b.path, { recursive: true }); } catch { throw new DomainError('FOLDER_INVALID', 'Klasör oluşturulamadı. Yolu ve yazma izni olup olmadığını kontrol edin.', 400); }
    }
    const before = deps.workFolder.path();
    store.mutate(d => {
      d.workFolder = { path: b.path, updatedAt: now().toISOString() };
      d.audit.push({ action: b.path ? 'workfolder.set' : 'workfolder.off', target: 'merkez', at: now().toISOString(), by: 'admin', ...(b.path ? { detail: b.path } : {}), changes: [{ field: 'çalışma klasörü', from: before ?? 'kapalı', to: b.path ?? 'kapalı' }] });
    });
    await deps.workFolder.run();
    res.json(folderView());
  });
  app.post('/api/merkez/admin/workfolder/sync', async (req, res) => { admin(req); await deps.workFolder.run(); res.json(folderView()); });
  /** The VDS sync's source (and anyone checking what the folder would hold): journal lines after `since`, and the rest whole. */
  app.get('/api/merkez/admin/workfolder/snapshot', (req, res) => {
    deps.tokenOrAdmin(req, 'calisma');
    const since = z.coerce.number().int().min(0).default(0).parse(req.query.since ?? 0);
    res.json(buildSnapshot({ store, releases: deps.releases, now, version: deps.version }, since, check()));
  });

  // ---------- Güncellemeler: "Klasörde hazır" ----------
  app.get('/api/merkez/admin/releases/folder', (req, res) => {
    deps.releaseAdmin(req); const ready = deps.workFolder.readyBundles(), list = deps.releases.list();
    res.json({ folder: ready.folder, files: ready.files.map(f => ({ ...f, platformName: f.platform ? platformNames[f.platform as keyof typeof platformNames] ?? f.platform : null, imported: !!f.version && list.some(r => r.version === f.version && r.platform === f.platform) })) });
  });
  app.post('/api/merkez/admin/releases/folder/import', async (req, res) => {
    deps.releaseChange(req); const { name } = z.object({ name: z.string().max(220) }).strict().parse(req.body);
    const path = deps.workFolder.bundlePath(name);
    if (!path) throw new DomainError('NOT_FOUND', 'Bu dosya çalışma klasörünün güncellemeler bölümünde bulunamadı. Listeyi yenileyin.', 404);
    mkdirSync(deps.releases.directory, { recursive: true });
    const upload = join(deps.releases.directory, `yukleme-${randomBytes(6).toString('hex')}.part`);
    copyFileSync(path, upload);
    const release = await deps.releases.importBundle(upload, now());
    // Loaded: moved aside so the list shows only what still waits (never deleted).
    try { const done = join(path, '..', 'yuklenenler'); mkdirSync(done, { recursive: true }); renameSync(path, join(done, name)); } catch { /* stays; shown as already loaded */ }
    store.mutate(d => { d.audit.push({ action: 'release.imported', target: 'admin', at: now().toISOString(), by: 'admin', detail: `${release.version} · ${platformNames[release.platform]} · çalışma klasöründen` }); });
    const { signed: _s, ...summary } = release;
    res.json({ release: summary });
  });
}
function send(res: Response, data: Buffer, type: string, name: string) {
  res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': String(data.length) });
  res.end(data);
}
