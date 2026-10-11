import type { CartLine } from '../packages/domain/types';
import { ApiError } from './api';
import { validLineExtras } from './pendingOrder';
export type PendingEdit = {
  format: 1; number: number;
  /** `packed`: the edited "Paketlensin" choice; missing (edits saved before it existed) keeps the order's own. */
  body: { requestId: string; guestContext: string; orderId: string; version: number; expectedTotal: number; packed?: boolean; lines: (CartLine & { existingId?: string })[] };
  /** `grams` repeats the line's weight so the recovery screen reads "500 g", like every other screen. */
  labels: { name: string; quantity: number; grams?: number; total: number }[];
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const pendingEditKey = (path: string) => 'mola.pending-edit.v1:' + path;
export function readPendingEdit(storage: StorageLike | null, key: string): PendingEdit | null {
  try {
    const text = storage?.getItem(key); if (!text || text.length > 60000) return null;
    const p = JSON.parse(text) as PendingEdit, b = p.body;
    const id = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100;
    const positive = (v: number) => Number.isSafeInteger(v) && v > 0 && v <= 100_000_000;
    if (p.format !== 1 || !positive(p.number) || !b || typeof b.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(b.requestId) || typeof b.guestContext !== 'string' || !/^[a-f0-9]{64}$/.test(b.guestContext) || !id(b.orderId) || !Number.isSafeInteger(b.version) || b.version < 0 || !positive(b.expectedTotal) || (b.packed !== undefined && typeof b.packed !== 'boolean') || !Array.isArray(b.lines) || !b.lines.length || b.lines.length > 30 || !Array.isArray(p.labels) || p.labels.length !== b.lines.length) return null;
    if (!b.lines.every(l => l && id(l.productId) && (l.existingId === undefined || id(l.existingId)) && Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= 20 && Array.isArray(l.selections) && l.selections.length <= 10 && l.selections.every(s => s && id(s.groupId) && id(s.optionId)) && validLineExtras(l))) return null;
    if (!p.labels.every((l, i) => l && typeof l.name === 'string' && l.name.length <= 160 && l.quantity === b.lines[i].quantity && l.grams === b.lines[i].grams && positive(l.total)) || p.labels.reduce((n, l) => n + l.total, 0) !== b.expectedTotal) return null;
    return p;
  } catch { return null; }
}
export function writePendingEdit(storage: StorageLike | null, key: string, value: PendingEdit) {
  try { if (!storage) return false; storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function clearPendingEdit(storage: StorageLike | null, key: string, requestId: string) {
  try { if (readPendingEdit(storage, key)?.body.requestId === requestId) storage?.removeItem(key); } catch { /* Keep the original request in memory if storage is unavailable. */ }
}
// These errors are produced before the edit commits. Other responses keep the request intact.
export function editDefinitelyRejected(error: unknown) {
  return error instanceof ApiError && ['NOT_FOUND', 'ACCOUNT_CLOSED', 'BROWSER_BLOCKED', 'VERSION_CONFLICT', 'EDIT_WINDOW_CLOSED', 'CASHIER_REVIEW', 'INVALID_CART', 'INVALID_LINE', 'ITEM_UNAVAILABLE', 'PRICE_CHANGED', 'INVALID_VALUE', 'INVALID_NOTE', 'INVALID_WEIGHT', 'INVALID_OPTIONS', 'OPTION_REQUIRED', 'VALIDATION_ERROR', 'CAMPAIGN_LIMIT'].includes(error.code);
}
