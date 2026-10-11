import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import type { Actor } from '../packages/domain/types.js';
import { isDay, reminderDue, sortNotes, TIME_PATTERN, type AgendaNote } from '../packages/domain/agenda.js';
import { open, seal } from './sealing.js';
import { snapshotKey, type Store } from './store.js';

/** At most this many notes per business (a café writes a few a week; this is only a guard against a runaway client). */
const MAX_NOTES = 5000, MAX_PER_DAY = 40;
const time = z.string().regex(TIME_PATTERN);
const day = z.string().refine(isDay, 'Geçersiz gün.');
export const noteInput = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/).optional(),
  day, time: time.optional().nullable(),
  title: z.string().trim().max(80), text: z.string().trim().max(1000),
  kind: z.enum(['agenda', 'sales']).optional(),
  reminder: z.object({ offset: z.enum(['same', 'day', 'week']), time }).optional().nullable(),
});
export type NoteInput = z.infer<typeof noteInput>;

/**
 * The owner's notes per day (Ajanda and the "Satış notu" of the daily sales chart). One row per note, sealed with the
 * business's own key like history rows; the day and the reminder's due time stay readable for range queries and the
 * reminder sweep. The table lives in merchant.sqlite, so every backup (VACUUM INTO) carries it.
 */
export class AgendaBook {
  constructor(private store: Store, private now: () => Date) {
    store.db.exec('CREATE TABLE IF NOT EXISTS agenda_notes (tenant TEXT NOT NULL, id TEXT NOT NULL, day TEXT NOT NULL, due INTEGER, payload BLOB NOT NULL, PRIMARY KEY (tenant,id)); CREATE INDEX IF NOT EXISTS agenda_notes_day ON agenda_notes(tenant,day); CREATE INDEX IF NOT EXISTS agenda_notes_due ON agenda_notes(due)');
  }
  private key(tenant: string) {
    const key = snapshotKey(this.store.db, this.store.key, tenant);
    if (!key) throw new Error('İşletme anahtarı eksik.');
    return key;
  }
  private openRow(tenant: string, row: { id: string; payload: Uint8Array }) {
    return open<AgendaNote>(Buffer.from(row.payload), this.key(tenant), `agenda:${tenant}:${row.id}`);
  }
  get(tenant: string, id: string) {
    const row = this.store.db.prepare('SELECT id,payload FROM agenda_notes WHERE tenant=? AND id=?').get(tenant, id) as { id: string; payload: Uint8Array } | undefined;
    return row ? this.openRow(tenant, row) : undefined;
  }
  list(tenant: string, from: string, to: string) {
    const rows = this.store.db.prepare('SELECT id,payload FROM agenda_notes WHERE tenant=? AND day>=? AND day<=? ORDER BY day').all(tenant, from, to) as { id: string; payload: Uint8Array }[];
    return sortNotes(rows.map(r => this.openRow(tenant, r)));
  }
  /** Reminders due in (since, until] (ms), oldest first. */
  due(tenant: string, since: number, until: number) {
    const rows = this.store.db.prepare('SELECT id,payload FROM agenda_notes WHERE tenant=? AND due IS NOT NULL AND due>? AND due<=? ORDER BY due').all(tenant, since, until) as { id: string; payload: Uint8Array }[];
    return rows.map(r => this.openRow(tenant, r));
  }
  save(tenant: string, by: string, input: NoteInput) {
    const at = this.now().toISOString(), old = input.id ? this.get(tenant, input.id) : undefined;
    if (input.id && !old) throw new DomainError('NOT_FOUND', 'Not bulunamadı. Başka bir cihazda silinmiş olabilir.', 404);
    if (!input.title && !input.text) throw new DomainError('EMPTY_NOTE', 'Başlık ya da not yazın.', 400);
    if (!old) {
      const count = (sql: string, ...args: string[]) => Number((this.store.db.prepare(sql).get(...args) as { n: number }).n);
      if (count('SELECT COUNT(*) AS n FROM agenda_notes WHERE tenant=?', tenant) >= MAX_NOTES) throw new DomainError('AGENDA_FULL', 'Ajanda dolu. Eski notlardan bazılarını silin.', 409);
      if (count('SELECT COUNT(*) AS n FROM agenda_notes WHERE tenant=? AND day=?', tenant, input.day) >= MAX_PER_DAY) throw new DomainError('AGENDA_DAY_FULL', 'Bu güne en çok 40 not yazılabilir.', 409);
    }
    const note: AgendaNote = {
      id: old?.id ?? randomUUID(), day: input.day, title: input.title, text: input.text, kind: input.kind ?? old?.kind ?? 'agenda',
      ...(input.time ? { time: input.time } : {}), ...(input.reminder ? { reminder: input.reminder } : {}),
      createdAt: old?.createdAt ?? at, updatedAt: at, by: old?.by ?? by,
    };
    const due = reminderDue(note) ?? null;
    this.store.db.prepare('INSERT INTO agenda_notes (tenant,id,day,due,payload) VALUES (?,?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET day=excluded.day,due=excluded.due,payload=excluded.payload')
      .run(tenant, note.id, note.day, due, seal(note, this.key(tenant), `agenda:${tenant}:${note.id}`));
    return note;
  }
  remove(tenant: string, id: string) {
    return Number(this.store.db.prepare('DELETE FROM agenda_notes WHERE tenant=? AND id=?').run(tenant, id).changes) > 0;
  }
}

/** Owner only: GET /api/staff/agenda?from&to, POST /api/staff/agenda (new or edit), POST /api/staff/agenda/delete. */
export function agendaRoutes(app: Express, store: Store, actorFor: (req: Request) => Actor, now: () => Date, onChange: (tenant: string) => void = () => {}) {
  const book = new AgendaBook(store, now);
  // Ajanda: the owner and the Müdür (packages/domain/roles.ts).
  const owner = (req: Request) => { const a = actorFor(req); requireRole(store.read(a.tenantId), a, ['owner', 'manager']); return a; };
  app.get('/api/staff/agenda', (req, res) => {
    const a = owner(req), { from, to } = z.object({ from: day, to: day }).parse(req.query);
    if (from > to || Date.parse(to) - Date.parse(from) > 400 * 86400000) throw new DomainError('RANGE', 'En çok 400 günlük notlar okunabilir.', 400);
    res.json({ notes: book.list(a.tenantId, from, to) });
  });
  app.post('/api/staff/agenda', (req, res) => {
    const a = owner(req), note = book.save(a.tenantId, a.id, noteInput.parse(req.body));
    onChange(a.tenantId);
    res.json({ note });
  });
  app.post('/api/staff/agenda/delete', (req, res) => {
    const a = owner(req), { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.body);
    if (!book.remove(a.tenantId, id)) throw new DomainError('NOT_FOUND', 'Not bulunamadı. Başka bir cihazda silinmiş olabilir.', 404);
    res.json({ ok: true });
  });
  return book;
}
