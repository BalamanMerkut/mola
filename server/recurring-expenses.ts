import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../packages/domain/types.js';
import { requireRole } from '../packages/domain/engine.js';
import { businessDay } from '../packages/domain/history.js';
import { expenseMethodNames, expenseMethods } from '../packages/domain/expense-rules.js';
import { longDay } from '../packages/domain/agenda.js';
import { anyDue, deleteRecurring, nextOccurrence, runRecurring, saveRecurring } from '../packages/domain/recurring-expenses.js';
import type { Store } from './store.js';
import type { Notifications } from './notifications.js';

const money = (kurus: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: kurus % 100 === 0 ? 0 : 2 }).format(kurus / 100);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const repeat = z.discriminatedUnion('every', [
  z.object({ every: z.literal('month'), day: z.number().int().min(1).max(31) }),
  z.object({ every: z.literal('year'), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) }),
  z.object({ every: z.literal('days'), days: z.number().int().min(1).max(365) }),
  z.object({ every: z.literal('week'), weekday: z.number().int().min(1).max(7) }),
]);
const input = z.object({ requestId: z.string().min(8).max(100), id: z.string().min(1).max(100).optional(), version: z.number().int().nonnegative().optional(), name: z.string().max(200), amount: z.number().int(), method: z.enum(expenseMethods as ['cash', 'card', 'transfer', 'other']), repeat, start: day, end: day.nullable().optional(), active: z.boolean() });

/**
 * "Otomatik giderler": records each rule's due expenses on the café computer, in Turkish dates, also with no screen open
 * (a minute sweep) and right before the owner reads the rules or the expense reports. A computer that was switched off
 * catches up the days it missed when it starts; a day is never recorded twice (packages/domain/recurring-expenses.ts).
 * Each recorded expense becomes one notification in Bildirimler (üst çubuktaki zil) (many at once for one rule: one summary).
 */
export class RecurringExpenses {
  constructor(private store: Store, private now: () => Date, private notifications?: Pick<Notifications, 'add'>) {}
  /** Records what is due for one business; reads only, unless something is due. Returns how many were recorded. */
  run(tenant: string) {
    const now = this.now();
    if (!anyDue(this.store.read(tenant), now)) return 0;
    const made = this.store.mutate(tenant, s => runRecurring(s, now, id => !!this.store.history.expense(tenant, id)));
    const byRule = new Map<string, typeof made>();
    for (const m of made) byRule.set(m.rule.id, [...(byRule.get(m.rule.id) ?? []), m]);
    for (const [ruleId, list] of byRule) {
      try {
        const { rule } = list[0], first = list[0].expense, last = list.at(-1)!.expense;
        if (list.length <= 3) for (const { expense: e } of list) this.notifications?.add(tenant, `expense-auto:${e.id}`, { kind: 'expense', day: e.auto!.day, title: `Otomatik gider kaydedildi: ${e.description}`, text: `${longDay(e.auto!.day)} · ${money(e.amount)} · ${expenseMethodNames[e.method ?? 'cash']}. Kasa ve giderler → Giderler'de görünür; gerekirse düzeltip silebilirsiniz.` });
        else this.notifications?.add(tenant, `expense-auto:${ruleId}:${first.auto!.day}:${last.auto!.day}`, { kind: 'expense', day: last.auto!.day, title: `${list.length} otomatik gider kaydedildi: ${rule.name}`, text: `${longDay(first.auto!.day)} – ${longDay(last.auto!.day)} arası, her biri ${money(rule.amount)} · ${expenseMethodNames[rule.method]}. Bilgisayar kapalıyken geçen günler de yazıldı; Kasa ve giderler → Giderler'de görünür.` });
      } catch (error) { console.warn(`Otomatik gider bildirimi yazılamadı: ${error instanceof Error ? error.message : error}`); }
    }
    return made.length;
  }
  runAll() {
    for (const { tenant } of this.store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) {
      try { this.run(tenant); } catch (error) { if (!this.store.db.isOpen) throw error; console.warn(`Otomatik giderler yazılamadı: ${error instanceof Error ? error.message : error}`); }
    }
  }
}

/**
 * Owner only: GET /api/staff/recurring-expenses → { rules, today, next: { [id]: day | null } }, POST
 * /api/staff/recurring-expenses (new, or `id` + `version` for a change), POST /api/staff/recurring-expenses/delete
 * { requestId, id, version }. Must be registered before the report routes: it records what is due before they read.
 */
export function recurringExpenseRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, notifications?: Pick<Notifications, 'add'>, everyMs = 60_000) {
  const book = new RecurringExpenses(store, now, notifications);
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner']); return a; };
  const view = (tenant: string) => {
    const s = store.read(tenant), today = businessDay(now().getTime()), rules = s.recurringExpenses ?? [];
    return { today, rules, next: Object.fromEntries(rules.map(r => [r.id, nextOccurrence(r, today)])) };
  };
  // The expense reports read after the due ones are in (the minute sweep may not have run yet after midnight).
  app.use(['/api/staff/reports/financial', '/api/staff/reports/overview'], (req, _res, next) => {
    try { const a = actorFor(req); if (a.role === 'owner' || a.role === 'manager') book.run(a.tenantId); } catch { /* the report route answers for itself */ }
    next();
  });
  app.get('/api/staff/recurring-expenses', (req, res) => {
    const a = owner(req); book.run(a.tenantId);
    res.setHeader('Cache-Control', 'no-store'); res.json(view(a.tenantId));
  });
  app.post('/api/staff/recurring-expenses', (req, res) => {
    const a = owner(req), b = input.parse(req.body);
    const rule = store.mutate(a.tenantId, s => saveRecurring(s, a, b, { now: now(), id: randomUUID }));
    // A rule due today records today's expense at once; the answer shows the rule after that.
    book.run(a.tenantId);
    const v = view(a.tenantId);
    res.json({ rule: v.rules.find(r => r.id === rule.id) ?? rule, ...v });
  });
  app.post('/api/staff/recurring-expenses/delete', (req, res) => {
    const a = owner(req), b = z.object({ requestId: z.string().min(8).max(100), id: z.string().min(1).max(100), version: z.number().int().nonnegative() }).parse(req.body);
    store.mutate(a.tenantId, s => deleteRecurring(s, a, b, { now: now(), id: randomUUID }));
    res.json(view(a.tenantId));
  });
  if (everyMs > 0) {
    // Soon after start (catching up days the computer was off), then every minute.
    const first = setTimeout(() => { try { book.runAll(); } catch { /* closed */ } }, Math.min(everyMs, 5000));
    const timer = setInterval(() => { try { book.runAll(); } catch { clearInterval(timer); } }, everyMs);
    first.unref(); timer.unref();
  }
  return book;
}
