import { COMMISSION_TOO_HIGH, commissionAllowed } from '../packages/domain/commission.js';
import { removeCatalogItem } from '../packages/domain/catalog-removal.js';
import { employeeRoles } from '../packages/domain/roles.js';
import { campaignReportSteps } from '../packages/domain/campaign-reports.js';
import { deleteExpense, editExpense, expenseMethods, recordExpense } from '../packages/domain/expenses.js';
import type { Express, Request, Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor, Expense, State } from '../packages/domain/types.js';
import type { PaymentAdjustment } from '../packages/domain/payment-adjustments.js';
import { MAX_VAT_RATES, productVat, vatSettings } from '../packages/domain/vat.js';
import { DomainError, once, requireRole } from '../packages/domain/engine.js';
import { passwordMatches, passwordRecord, publicUser } from './accounts.js';
import type { Store } from './store.js';
import { staffCookieName } from './sessions.js';
import { sessionCookie } from './http-security.js';
import { automaticExpenses, expenseBreakdown, employeeFrom, financialFrom, mergeDays, openBalance, overviewFrom, previousRange, productsFrom, reportRange } from '../packages/domain/reports.js';
import { businessDay } from '../packages/domain/history.js';
import { changeCategories } from '../packages/domain/categories.js';
import { LEDGER_MAX_LIMIT, LEDGER_PAGE, paymentDetail } from '../packages/domain/payment-history.js';
import { drainSlowly, readyFor } from './history.js';
import { cleanPhotos, restorePhotos, trashBatches } from './photo-trash.js';
import { floorTables } from '../packages/domain/takeaway.js';
import { cleanArea, sameArea } from '../packages/domain/table-sections.js';
import { sectorHeroes, sectorOf, sectors } from '../packages/domain/sector.js';
import { loadSectorMenu, untouchedStarterMenu } from './sector-templates.js';
import { addTemplatePhotos } from './template-photos.js';

// `day` (YYYY-MM-DD, Turkish date) and `method` are optional, so older pending expense requests keep their fingerprint.
/** "Tümü" in Giderler lists this many of the newest expenses (and corrections); a year shows all of its own. */
export const LIST_PAGE = 200;
const expenseInput = z.object({ amount: z.number().int().positive().max(100_000_000), description: z.string().trim().min(1).max(500), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), method: z.enum(expenseMethods as ['cash', 'card', 'transfer', 'other']).optional(), source: z.enum(['drawer', 'outside']).optional() });
export function managementRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date) {
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner']); return a; };
  // Owner or Müdür (packages/domain/roles.ts): menu, campaigns, refunds and reports; settings, staff and expense edits stay owner().
  const boss = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner', 'manager']); return a; };
  // Menu and tables may also be changed by Mola destek while the owner allows it (server/support-session.ts).
  const menuEditor = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner', 'manager', 'support']); return a; };
  const tableEditor = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner', 'support']); return a; };
  /** "Şifrem": wrong current passwords per person (15 minutes). */
  const passwordWrong = new Map<string, { count: number; until: number }>();
  app.post('/api/staff/catalog/remove', (req, res) => {
    const a = menuEditor(req), input = z.object({ requestId: z.string().min(1), revision: z.number().int().nonnegative(), id: z.string().min(1), kind: z.enum(['product', 'campaign']) }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => removeCatalogItem(s, a, input, { now: now(), id: randomUUID })));
  });
  app.get('/api/staff/photo-trash', (req, res) => { const a = owner(req); res.json(trashBatches(store.directory, a.tenantId).map(b => ({ id: b.id, createdAt: b.createdAt, count: b.files.length }))); });
  app.post('/api/staff/photo-trash', (req, res) => { const a = owner(req); const result = cleanPhotos(store.directory, a.tenantId, store.read(a.tenantId), now()); store.mutate(a.tenantId, s => { s.audit.push({ actor: a.id, action: 'photos.cleaned', target: result.id ?? 'empty', at: now().toISOString() }); }); res.json(result); });
  app.post('/api/staff/photo-trash/restore', (req, res) => { const a = owner(req), b = z.object({ id: z.string() }).parse(req.body); const result = restorePhotos(store.directory, a.tenantId, b.id, now()); store.mutate(a.tenantId, s => { s.audit.push({ actor: a.id, action: 'photos.restored', target: b.id, at: now().toISOString() }); }); res.json(result); });
  const ledgerInput = (req: Request) => { const today = businessDay(now().getTime()); return z.object({ from: z.string().max(10).default(today), to: z.string().max(10).default(today), q: z.string().max(80).optional(), filter: z.enum(['all', 'cash', 'card', 'corrected']).default('all'), limit: z.coerce.number().int().min(1).max(LEDGER_MAX_LIMIT).default(LEDGER_PAGE), before: z.string().max(300).optional() }).parse(req.query); };
  app.get('/api/staff/payment-adjustments', (req, res) => {
    const a = boss(req), s = store.read(a.tenantId), query = ledgerInput(req);
    // Cached per-day payment lists are read newest first until the page is full; no settled account is opened.
    res.setHeader('Cache-Control', 'no-store'); res.json(store.history.paymentLedger(a.tenantId, s, query));
  });
  // Header totals of a range longer than 31 days: counted in short slices so tablets keep their answers meanwhile.
  app.get('/api/staff/payment-adjustments/totals', async (req, res) => {
    const a = boss(req), s = store.read(a.tenantId), query = ledgerInput(req);
    let left = false; res.on('close', () => { left = true; });
    const totals = await drainSlowly(store.history.ledgerTotals(a.tenantId, s, query), () => left);
    if (totals) { res.setHeader('Cache-Control', 'no-store'); res.json(totals); }
  });
  app.get('/api/staff/payment-adjustments/:paymentId', (req, res) => {
    const a = boss(req), s = store.read(a.tenantId), id = z.string().min(1).max(200).parse(req.params.paymentId);
    res.setHeader('Cache-Control', 'no-store'); res.json(paymentDetail(s, id, () => store.history.paymentAccount(a.tenantId, id)));
  });
  // POST /api/staff/payment-adjustments (refunds, item refunds, method corrections) lives in server/refunds.ts.
  app.post('/api/staff/expenses', (req, res) => {
    const a = actorFor(req); const b = expenseInput.extend({ requestId: z.string() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => recordExpense(s, a, b, { now: now(), id: randomUUID })));
  });
  // Owner corrections: the expense may already be in long-term history; it is read in the same transaction.
  app.post('/api/staff/expenses/edit', (req, res) => {
    const a = owner(req), b = expenseInput.extend({ requestId: z.string(), id: z.string().min(1).max(100), version: z.number().int().nonnegative() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => editExpense(s, a, b, { now: now(), id: randomUUID }, store.history.expense(a.tenantId, b.id))));
  });
  app.post('/api/staff/expenses/delete', (req, res) => {
    const a = owner(req), b = z.object({ requestId: z.string(), id: z.string().min(1).max(100), version: z.number().int().nonnegative() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => deleteExpense(s, a, b, { now: now(), id: randomUUID }, store.history.expense(a.tenantId, b.id))));
  });
  const employeeRole = z.enum(employeeRoles);
  app.post('/api/staff/categories', (req, res) => {
    const a = menuEditor(req);
    const b = z.object({ requestId: z.string(), revision: z.number().int().nonnegative(), action: z.enum(['add', 'rename', 'remove', 'reorder', 'subtype-order', 'subtype-rename', 'subtype-remove', 'subtype-add', 'english']), name: z.string().max(60).optional(), subtype: z.string().max(80).optional(), nextName: z.string().max(80).optional(), names: z.array(z.string().max(80)).max(1000).optional() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => changeCategories(s, a, b, { now: now(), id: randomUUID })));
  });
  app.post('/api/staff/tables/add', (req, res) => {
    const a = tableEditor(req); const b = z.object({ requestId: z.string(), area: z.string().trim().min(1).max(40).optional() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => once(s, a, 'table-add', b.requestId, b, () => {
      if (floorTables(s).length >= 100) throw new DomainError('TABLE_LIMIT', 'En fazla 100 aktif masa eklenebilir.', 409);
      // An open event's temporary table may carry a "Masa NN" name too: the new table never repeats it.
      const used = [...floorTables(s), ...(s.retiredTables ?? []), ...s.tables.filter(t => t.event)];
      const number = Math.max(0, ...used.map(t => Number(t.name.match(/^Masa (\d+)$/)?.[1] ?? 0))) + 1;
      const table = { area: b.area, id: randomUUID(), name: `Masa ${String(number).padStart(2, '0')}`, token: randomBytes(18).toString('base64url'), epoch: 0, accountId: null };
      s.tables.push(table); s.businessRevision = (s.businessRevision ?? 0) + 1;
      s.audit.push({ actor: a.id, action: 'table.added', target: table.id, at: now().toISOString() });
      return { id: table.id, name: table.name };
    })));
  });
  app.post('/api/staff/tables/area', (req, res) => {
    const a = tableEditor(req); const b = z.object({ requestId: z.string(), tableId: z.string(), version: z.number().int(), area: z.string().trim().min(1).max(40).nullable() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => once(s, a, 'table-area', b.requestId, b, () => {
      if ((s.businessRevision ?? 0) !== b.version) throw new DomainError('VERSION_CONFLICT', 'Masa düzeni değişti. Yenileyip tekrar deneyin.', 409);
      const table = floorTables(s).find(t => t.id === b.tableId);
      if (!table) throw new DomainError('NOT_FOUND', 'Masa bulunamadı.', 404);
      // "üst kat" typed again is the existing "Üst kat", not a second section.
      const known = [...new Set(floorTables(s).map(t => t.area ?? '').filter(Boolean))];
      table.area = b.area ? sameArea(known, b.area) ?? b.area.replace(/\s+/g, ' ') : undefined; s.businessRevision = b.version + 1;
      s.audit.push({ actor: a.id, action: 'table.area_changed', target: table.id, at: now().toISOString() });
      return { ok: true };
    })));
  });
  // Ayarlar → Masalar ve QR (11 Ekim): the order of the tables and of their sections, as the owner arranged them
  // (packages/domain/table-sections.ts). Every floor table once; masasız tickets and event tables keep their place.
  app.post('/api/staff/tables/layout', (req, res) => {
    const a = tableEditor(req), b = z.object({ requestId: z.string(), version: z.number().int(), tables: z.array(z.string().min(1).max(100)).max(100), areas: z.array(z.string().max(40)).max(101) }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => once(s, a, 'table-layout', b.requestId, b, () => {
      if ((s.businessRevision ?? 0) !== b.version) throw new DomainError('VERSION_CONFLICT', 'Masa düzeni değişti. Yenileyip tekrar deneyin.', 409);
      const floor = floorTables(s), byId = new Map(floor.map(t => [t.id, t]));
      if (b.tables.length !== floor.length || new Set(b.tables).size !== floor.length || b.tables.some(id => !byId.has(id))) throw new DomainError('VERSION_CONFLICT', 'Masa düzeni değişti. Yenileyip tekrar deneyin.', 409);
      const used = new Set(floor.map(t => t.area ?? ''));
      if (b.areas.some(x => !used.has(x)) || new Set(b.areas).size !== b.areas.length) throw new DomainError('VERSION_CONFLICT', 'Bölümler değişti. Yenileyip tekrar deneyin.', 409);
      s.tables = [...b.tables.map(id => byId.get(id)!), ...s.tables.filter(t => !byId.has(t.id))];
      if (b.areas.length) s.areaOrder = b.areas; else delete s.areaOrder;
      s.businessRevision = b.version + 1;
      s.audit.push({ actor: a.id, action: 'table.layout_changed', target: `${floor.length}`, at: now().toISOString() });
      return { ok: true };
    })));
  });
  // A section's new name for all its tables (İç → "Salon", "Bahçe" → "Teras"); a name another section has joins them.
  // Garson ataması and the section order follow the new name.
  app.post('/api/staff/tables/area-rename', (req, res) => {
    const a = tableEditor(req), b = z.object({ requestId: z.string(), version: z.number().int(), from: z.string().trim().min(1).max(40), to: z.string().max(80) }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => once(s, a, 'table-area-rename', b.requestId, b, () => {
      if ((s.businessRevision ?? 0) !== b.version) throw new DomainError('VERSION_CONFLICT', 'Masa düzeni değişti. Yenileyip tekrar deneyin.', 409);
      const floor = floorTables(s), areas = [...new Set(floor.map(t => t.area ?? '').filter(Boolean))];
      if (!areas.includes(b.from)) throw new DomainError('NOT_FOUND', 'Bölüm bulunamadı. Yenileyip tekrar deneyin.', 404);
      const typed = cleanArea(b.to);
      if (!typed) throw new DomainError('INVALID_AREA', '1–40 karakter arasında bir bölüm adı yazın.');
      const to = sameArea(areas, typed) ?? typed;
      if (to === b.from) throw new DomainError('NO_CHANGE', 'Bölümün adı zaten bu.');
      for (const t of floor) if (t.area === b.from) t.area = to;
      for (const w of Object.values(s.waiterAssignments?.waiters ?? {})) if (w.areas?.includes(b.from)) w.areas = [...new Set(w.areas.map(x => x === b.from ? to : x))];
      if (s.areaOrder) s.areaOrder = [...new Set(s.areaOrder.map(x => x === b.from ? to : x))];
      s.businessRevision = b.version + 1;
      s.audit.push({ actor: a.id, action: 'table.area_renamed', target: `${b.from}->${to}`, at: now().toISOString() });
      return { area: to, joined: areas.includes(to) };
    })));
  });
  app.post('/api/staff/tables/remove', (req, res) => {
    const a = tableEditor(req); const b = z.object({ requestId: z.string(), tableId: z.string(), epoch: z.number().int().nonnegative() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => once(s, a, 'table-remove', b.requestId, b, () => {
      const t = floorTables(s).find(t => t.id === b.tableId);
      if (!t) throw new DomainError('NOT_FOUND', 'Masa bulunamadı.', 404);
      if (floorTables(s).length <= 1) throw new DomainError('LAST_TABLE', 'En az bir masa kalmalı.', 409);
      if (t.epoch !== b.epoch) throw new DomainError('VERSION_CONFLICT', 'Masa değişti. Listeyi yenileyin.', 409);
      const accounts = new Set(s.accounts.filter(a => a.tableId === t.id).map(a => a.id));
      if (t.accountId || s.accounts.some(a => a.tableId === t.id && a.status === 'open') || s.orders.some(o => accounts.has(o.accountId) && ['new', 'preparing', 'ready'].includes(o.status))) throw new DomainError('TABLE_BUSY', 'Açık hesabı veya tamamlanmamış siparişi olan masa çıkarılamaz.', 409);
      s.retiredTables ??= []; s.retiredTables.push({ ...t, epoch: t.epoch + 1 }); s.tables = s.tables.filter(x => x.id !== t.id);
      s.businessRevision = (s.businessRevision ?? 0) + 1;
      s.audit.push({ actor: a.id, action: 'table.removed', target: t.id, at: now().toISOString() });
      return { name: t.name };
    })));
  });
  // Reports read stored daily summaries plus the live floor; the snapshot no longer holds closed history.
  // One campaign window per step, between the tablets' requests (five years of weekly campaigns: 3.6 s in one piece on a weak PC).
  app.get('/api/staff/reports/campaigns', async (req, res) => {
    const a = boss(req), s = store.read(a.tenantId);
    let left = false; res.on('close', () => { left = true; });
    const report = await drainSlowly(campaignReportSteps(s, now(), store.history.spanTotals(a.tenantId, s)), () => left);
    if (report) res.json(report);
  });
  // Every period is read through History.reportSpan: closed months and years from their roll-ups, built first in steps (a
  // year or "Tümü" right after an update never holds the tablets). null: the asker left meanwhile.
  const period = async (req: Request, res: Response) => {
    const a = boss(req), q = z.object({ from: z.string(), to: z.string() }).parse(req.query), range = reportRange(q.from, q.to); res.setHeader('Cache-Control', 'no-store');
    const before = previousRange(q.from, q.to, now().getTime());
    if (!await readyFor(res, [store.history.prepare(a.tenantId, store.read(a.tenantId), range.start, range.end), ...(before ? [store.history.prepare(a.tenantId, store.read(a.tenantId), before.start, before.end)] : [])])) return null;
    const s = store.read(a.tenantId);
    return { a, s, ...q, ...range, before, span: () => store.history.reportSpan(a.tenantId, s, range.start, range.end) };
  };
  app.get('/api/staff/reports/financial', async (req, res) => {
    const p = await period(req, res); if (!p) return;
    const { a, s, from, to, start, end } = p, span = p.span();
    if (Number.isFinite(start)) { res.json(financialFrom(span, from, to, start, end, store.history.adjustments(a.tenantId, start, end), store.history.expenses(a.tenantId, start, end))); return; }
    // "Tümü": the newest LIST_PAGE expenses and corrections (the screen asks for a year to see older ones); totals from the span.
    const expenses = store.history.newestLedger<Expense>(a.tenantId, 'expense', LIST_PAGE + 1), adjustments = store.history.newestLedger<PaymentAdjustment>(a.tenantId, 'adjustment', LIST_PAGE + 1);
    const fin = financialFrom(span, from, to, start, end, adjustments.slice(0, LIST_PAGE), expenses.slice(0, LIST_PAGE));
    if (expenses.length <= LIST_PAGE && adjustments.length <= LIST_PAGE) { res.json(fin); return; }
    const t = span.total, { cashAfterExpenses: _partial, ...rest } = fin;
    res.json({ ...rest, expenseTotal: t.expenseTotal, refundTotal: t.refundTotal, cashRefunds: t.cashRefunds, afterCommission: t.unknownCommissionCount ? null : t.cash + t.card + t.platform - t.commission - t.refundTotal, listed: { page: LIST_PAGE, expenses: t.expenses, refunds: t.refunds } });
  });
  app.get('/api/staff/reports/employees', async (req, res) => {
    const p = await period(req, res); if (!p) return;
    res.json(employeeFrom(mergeDays(p.span()), p.s.staffUsers, p.from, p.to));
  });
  // Sales overview: headline figures, the previous period of equal length, daily and hourly series, top products.
  app.get('/api/staff/reports/overview', async (req, res) => {
    // A period still running (today) is compared with the same stretch before it up to the same clock time.
    const p = await period(req, res); if (!p) return;
    const { a, s, from, to, start, end, before } = p;
    const overview = overviewFrom({ from, to, start, end, today: businessDay(now().getTime()), days: p.span(), previous: before && { from: before.from, to: before.to, partial: before.partial, year: before.year, days: store.history.reportSpan(a.tenantId, s, before.start, before.end) }, openBalance: openBalance(s), products: s.products });
    // Live copies first: an owner's edit waiting in the snapshot wins over the stored row. Not for "Tümü": years of rent are
    // never "most of the period" there, and its expenses are not read one by one.
    const rows = overview.expenses && Number.isFinite(start) ? [...(s.expenses ?? []), ...store.history.expenses(a.tenantId, start, end)] : [];
    const autoExpenses = rows.length ? automaticExpenses(rows, start, end) : 0;
    // "Giderler" on the Sade özet opens to what it is made of (Stok alışları, Diğer giderler…); not for "Tümü".
    const expenseParts = rows.length ? expenseBreakdown(rows, start, end) : null;
    res.json({ ...overview, ...(autoExpenses ? { autoExpenses } : {}), ...(expenseParts ? { expenseParts } : {}) });
  });
  app.get('/api/staff/reports/products', async (req, res) => {
    const p = await period(req, res); if (!p) return;
    res.json(productsFrom(p.span(), p.s.products));
  });
  // KDV oranları (packages/domain/vat.ts): the owner keeps the list (Ayarlar → Giderler ve kâr); the menu editors read it.
  const vatView = (s: State) => { const v = vatSettings(s), all = [...s.products, ...(s.productDrafts ?? [])]; return { ...v, counts: Object.fromEntries(v.rates.map(r => [r, all.filter(p => productVat(p, v) === r).length])), products: all.length }; };
  app.get('/api/staff/vat', (req, res) => { const a = menuEditor(req); res.setHeader('Cache-Control', 'no-store'); res.json(vatView(store.read(a.tenantId))); });
  app.post('/api/staff/vat', (req, res) => {
    const a = owner(req), b = z.object({ rates: z.array(z.number().int().min(0).max(100)).min(1).max(MAX_VAT_RATES), default: z.number().int().min(0).max(100) }).parse(req.body);
    const rates = [...new Set(b.rates)].sort((x, y) => x - y);
    if (!rates.includes(b.default)) throw new DomainError('INVALID_VAT', 'Varsayılan oran listede olmalı.');
    res.json(store.mutate(a.tenantId, s => { s.vat = { rates, default: b.default }; s.audit.push({ actor: a.id, action: 'vat.changed', target: rates.join(','), at: now().toISOString() }); return vatView(s); }));
  });
  // "Bu bölümdeki ürünlere uygula": one rate for every product (and draft) of a menu category.
  app.post('/api/staff/vat/apply', (req, res) => {
    const a = menuEditor(req), b = z.object({ requestId: z.string().min(1).max(100), category: z.string().trim().min(1).max(60), rate: z.number().int().min(0).max(100) }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => once(s, a, 'vat-apply', b.requestId, b, () => {
      if (!vatSettings(s).rates.includes(b.rate)) throw new DomainError('INVALID_VAT', 'Bu KDV oranı listede yok. Menü yönetimi → KDV oranları\'na bakın.', 409);
      let changed = 0;
      for (const p of [...s.products, ...(s.productDrafts ?? [])]) if (p.category === b.category && p.vatRate !== b.rate) { p.vatRate = b.rate; changed++; }
      if (changed) { s.menuRevision++; s.audit.push({ actor: a.id, action: 'vat.applied', target: `${b.category}:${b.rate}`, at: now().toISOString() }); }
      return { changed, revision: s.menuRevision };
    })));
  });
  const password = z.string().min(10).max(128);
  const username = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9._-]{2,31}$/);
  app.get('/api/staff/users', (req, res) => { const a = owner(req); res.json(store.read(a.tenantId).staffUsers!.map(publicUser)); });
  // Usernames are global, so trying names here could reveal other businesses' accounts: creation is rate limited.
  const creations = new Map<string, { count: number; until: number }>();
  app.post('/api/staff/users', async (req, res) => {
    const first = owner(req), t = now().getTime(); let c = creations.get(first.tenantId);
    if (!c || c.until <= t) { if (creations.size > 5000) creations.clear(); c = { count: 0, until: t + 3600_000 }; creations.set(first.tenantId, c); }
    // Only "name already taken" answers reveal other businesses' usernames, so only those use up the hourly budget.
    if (c.count >= 10) throw new DomainError('RATE_LIMIT', 'Bir saat içinde çok fazla dolu kullanıcı adı denendi. Daha sonra tekrar deneyin.', 429);
    const b = z.object({ username, name: z.string().trim().min(1).max(80), role: employeeRole, password }).parse(req.body);
    const secret = await passwordRecord(b.password); const a = owner(req);
    if (store.findUser(b.username)) { c.count++; throw new DomainError('USERNAME_TAKEN', 'Bu kullanıcı adı kullanılıyor.', 409); }
    res.json(store.mutate(a.tenantId, s => {
      if (s.staffUsers!.length >= 60) throw new DomainError('STAFF_LIMIT', 'En fazla 60 çalışan hesabı açılabilir. Kullanılmayan hesapları kapatın.', 409);
      const u = { id: randomUUID(), username: b.username, name: b.name, role: b.role, ...secret, active: true, version: 1, createdAt: now().toISOString() };
      s.staffUsers!.push(u); s.audit.push({ actor: a.id, action: 'staff.created', target: u.id, at: now().toISOString() }); return publicUser(u);
    }));
  });
  app.post('/api/staff/users/update', (req, res) => {
    const a = owner(req); const b = z.object({ id: z.string(), version: z.number().int(), role: employeeRole, active: z.boolean() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => {
      const u = s.staffUsers!.find(u => u.id === b.id);
      if (!u) throw new DomainError('NOT_FOUND', 'Çalışan bulunamadı.', 404);
      if (u.role === 'owner' || u.id === a.id) throw new DomainError('OWNER_PROTECTED', 'İşletme sahibi bu ekrandan kapatılamaz veya yetkisi değiştirilemez.', 403);
      if (u.version !== b.version) throw new DomainError('VERSION_CONFLICT', 'Çalışan bilgisi değişti. Listeyi yenileyin.', 409);
      u.role = b.role; u.active = b.active; u.version++;
      s.audit.push({ actor: a.id, action: b.active ? 'staff.updated' : 'staff.disabled', target: u.id, at: now().toISOString() }); return publicUser(u);
    }));
  });
  app.post('/api/staff/users/password', async (req, res) => {
    owner(req); const b = z.object({ id: z.string(), version: z.number().int(), password }).parse(req.body);
    const secret = await passwordRecord(b.password); const a = owner(req);
    res.json(store.mutate(a.tenantId, s => {
      const u = s.staffUsers!.find(u => u.id === b.id);
      if (!u) throw new DomainError('NOT_FOUND', 'Çalışan bulunamadı.', 404);
      if (u.role === 'owner') throw new DomainError('OWNER_PROTECTED', 'Kendi şifrenizi Şifrem bölümünden değiştirin.', 403);
      if (u.version !== b.version) throw new DomainError('VERSION_CONFLICT', 'Çalışan bilgisi değişti. Listeyi yenileyin.', 409);
      Object.assign(u, secret); u.version++;
      s.audit.push({ actor: a.id, action: 'staff.password_reset', target: u.id, at: now().toISOString() }); return { ok: true };
    }));
  });
  app.post('/api/staff/password', async (req, res) => {
    const a = actorFor(req); const b = z.object({ currentPassword: z.string().max(128), password }).parse(req.body);
    const original = store.read(a.tenantId).staffUsers!.find(u => u.id === a.id)!;
    // Güvenlik denetimi: an open session (a tablet left signed in) must not try passwords here without end: 5 wrong in 15 minutes.
    const k = `${a.tenantId}:${a.id}`, t = now().getTime(), w = passwordWrong.get(k);
    if (w && w.until > t && w.count >= 5) throw new DomainError('RATE_LIMIT', 'Çok fazla yanlış şifre. 15 dakika sonra yeniden deneyin.', 429);
    if (!await passwordMatches(b.currentPassword, original)) {
      if (passwordWrong.size > 5000) passwordWrong.clear();
      passwordWrong.set(k, w && w.until > t ? { count: w.count + 1, until: w.until } : { count: 1, until: t + 15 * 60_000 });
      throw new DomainError('INVALID_PASSWORD', 'Mevcut şifre yanlış.', 400);
    }
    passwordWrong.delete(k);
    const secret = await passwordRecord(b.password); actorFor(req);
    store.mutate(a.tenantId, s => {
      const u = s.staffUsers!.find(u => u.id === a.id)!;
      if (u.version !== original.version) throw new DomainError('VERSION_CONFLICT', 'Hesabınız değişti. Yeniden giriş yapın.', 409);
      Object.assign(u, secret); u.version++;
      s.audit.push({ actor: a.id, action: 'staff.password_changed', target: u.id, at: now().toISOString() });
    });
    // Same attributes as the sign-in cookie (and /api/logout), so an HTTPS browser really drops it.
    res.clearCookie(staffCookieName(req), sessionCookie(req)); res.json({ ok: true });
  });
  app.post('/api/staff/setup', (req, res) => {
    const a = owner(req); const b = z.object({ requestId: z.string(), version: z.number().int(), name: z.string().trim().min(2).max(80), sector: z.enum(sectors).optional(), tableCount: z.number().int().min(1).max(100), insideCount: z.number().int().min(0).max(100).optional(), paymentMode: z.enum(['before_preparation', 'after_service']).optional(), cleaningEnabled: z.boolean().optional(), waiterApproval: z.boolean().optional(), changeSeconds: z.number().int().min(0).max(600), commissionBps: z.number().int().min(0).max(10000).nullable() }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => once(s, a, 'setup', b.requestId, b, () => {
      if (s.setupCompleted) throw new DomainError('SETUP_COMPLETED', 'İlk kurulum zaten tamamlandı. İşletme adını ve logoyu Ayarlar → İşletme → Görünüm’den değiştirebilirsiniz.', 409);
      if ((s.businessRevision ?? 0) !== b.version) throw new DomainError('VERSION_CONFLICT', 'Ayarlar başka bir ekranda değişti. Yenileyip tekrar deneyin.', 409);
      if (!commissionAllowed(b.commissionBps, s.commissionBps)) throw new DomainError('INVALID_COMMISSION', COMMISSION_TOO_HIGH);
      const floor = floorTables(s);
      // Fewer tables than the starter 12: the last ones go. A table with an open bill or unfinished order stays; one that was
      // ever used is kept as retired (its name stays in the history), an unused one simply disappears.
      for (const t of floor.slice(b.tableCount).reverse()) {
        const accounts = new Set(s.accounts.filter(x => x.tableId === t.id).map(x => x.id));
        if (t.accountId || s.accounts.some(x => x.tableId === t.id && x.status === 'open') || s.orders.some(o => accounts.has(o.accountId) && ['awaiting_approval', 'new', 'preparing', 'ready'].includes(o.status))) throw new DomainError('TABLE_BUSY', `${t.name} masasında açık hesap var. Önce hesabı kapatın ya da masa sayısını artırın.`, 409);
        if (accounts.size) { s.retiredTables ??= []; s.retiredTables.push({ ...t, epoch: t.epoch + 1 }); }
        s.tables = s.tables.filter(x => x.id !== t.id);
      }
      if (b.insideCount !== undefined && b.insideCount > b.tableCount) throw new DomainError('INVALID_AREAS', 'İç masa sayısı toplam masa sayısını aşamaz.');
      for (let i = floor.length; i < b.tableCount; i++) s.tables.push({ id: randomUUID(), name: `Masa ${String(i + 1).padStart(2, '0')}`, token: randomBytes(18).toString('base64url'), epoch: 0, accountId: null });
      if (b.insideCount !== undefined) floorTables(s).forEach((table, i) => { table.area = i < b.insideCount! ? 'inside' : 'outside'; });
      // The sector's starter menu replaces only a starter menu nobody touched; edits, campaigns and sales are never thrown away.
      const sector = b.sector ?? sectorOf(s), menuLoaded = sector !== 'cafe' && untouchedStarterMenu(s);
      // With the menu its photos (server/template-photos.ts); the café menu's came with the business (server/kafe-link.ts).
      if (menuLoaded) { loadSectorMenu(s, sector); addTemplatePhotos(store.directory, s.tenantId, s.products); }
      if (sector !== 'cafe') s.menuHero ??= sectorHeroes[sector];
      s.sector = sector;
      s.paymentMode = b.paymentMode ?? 'after_service'; s.cleaningEnabled = b.cleaningEnabled ?? false; s.waiterApproval = b.waiterApproval ?? false; s.autoApproveQr = false; s.name = b.name; s.changeSeconds = b.changeSeconds; s.commissionBps = b.commissionBps; s.setupCompleted = true; s.businessRevision = b.version + 1;
      s.audit.push({ actor: a.id, action: 'business.configured', target: s.tenantId, at: now().toISOString() });
      return { ok: true, revision: s.businessRevision, menuLoaded };
    })));
  });
}
