/*
 * Garson ataması (optional, off by default; Ayarlar → Sipariş ve kasa → "Garson masa/bölüm ataması", owner only).
 * When on, each waiter may be given sections (Bölümler: İç, Dış, Teras… = CafeTable.area) and single tables. Then
 * "Sipariş hazır", waiter calls and bill requests ring (sound, short note, vibration) only on the devices of the waiters
 * responsible for that table; other waiters still see them in their lists, quietly. A table nobody is responsible for
 * (also masasız tickets and event tables) rings for every waiter, as when the switch is off. The cashier, the Müdür and
 * the owner hear what they heard before. Browser-safe: types and plain rules only.
 */
export type WaiterAssignment = { areas?: string[]; tables?: string[] };
export type WaiterAssignments = { enabled?: boolean; waiters?: Record<string, WaiterAssignment> };
/** Limits per waiter (a business has at most 100 tables). */
export const MAX_ASSIGNED_AREAS = 20, MAX_ASSIGNED_TABLES = 100;
/** What one waiter's screen needs (StaffSnapshot.assignment): its own tables and every table someone is responsible for. */
export type AssignmentView = { mine: string[]; covered: string[] };

type FloorTable = { id: string; area?: string; takeaway?: unknown; event?: unknown };
/** The waiters (user ids) responsible for a table: given the table itself or its section. */
export function waitersOf(a: WaiterAssignments | undefined, table: FloorTable, active?: (userId: string) => boolean): string[] {
  if (!a?.enabled || table.takeaway || table.event) return [];
  return Object.entries(a.waiters ?? {}).filter(([id, w]) => (!active || active(id)) && (w.tables?.includes(table.id) || (!!table.area && !!w.areas?.includes(table.area)))).map(([id]) => id);
}
/** The snapshot part for one waiter; undefined while the switch is off (nothing changes on screen). */
export function assignmentView(a: WaiterAssignments | undefined, tables: FloorTable[], userId: string, active?: (userId: string) => boolean): AssignmentView | undefined {
  if (!a?.enabled) return undefined;
  const mine: string[] = [], covered: string[] = [];
  for (const t of tables) { const w = waitersOf(a, t, active); if (w.length) { covered.push(t.id); if (w.includes(userId)) mine.push(t.id); } }
  return { mine, covered };
}
/** Should this device ring (sound, note, vibration) for something at this table? Unknown or unassigned tables ring for all. */
export const ringsHere = (view: AssignmentView | undefined, tableId: string | undefined) => !view || !tableId || !view.covered.includes(tableId) || view.mine.includes(tableId);
/** Short plain text of a waiter's assignment ("İç masalar, Masa 12"), for Ayarlar and Çalışanlar. */
export function assignmentText(w: WaiterAssignment | undefined, tableName: (id: string) => string | undefined, areaName: (area: string) => string) {
  const parts = [...(w?.areas ?? []).map(areaName), ...(w?.tables ?? []).flatMap(id => { const n = tableName(id); return n ? [n] : []; })];
  return parts.length ? parts.join(', ') : 'Atanmadı';
}
