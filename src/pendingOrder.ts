import type { CartLine } from '../packages/domain/types';
import { readNote, validGrams } from '../packages/domain/lines';

/** A stored line's note must already be in its cleaned form and a weight a valid one: the retry resends the body byte for byte,
 * so the request fingerprint (and the line identity) stays the one the first attempt used. */
export const validLineExtras = (l: Pick<CartLine, 'note' | 'grams' | 'quantity'>) => (l.note === undefined || (typeof l.note === 'string' && readNote(l.note) === l.note)) && (l.grams === undefined || (validGrams(l.grams) && l.quantity === 1));

export type PendingOrder = {
  version: 1;
  /** `packed` is only ever `true` ("Paketlensin"): absent keeps a not-ticked order's body, and so its fingerprint, as before. */
  body: { requestId: string; tableId: string; guestContext: string; expectedTotal: number; lines: CartLine[]; packed?: true };
  labels: { name: string; options: string; total: number }[];
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function browserOrderStorage(): StorageLike | null { try { return window.sessionStorage; } catch { return null; } }
const prefix = 'mola.pending-order.v1:';
export function pendingOrderKey(path: string) { return prefix + path; }
export function readPendingOrder(storage: StorageLike | null, key: string): PendingOrder | null {
  try {
    if (!storage) return null;
    const text = storage.getItem(key);
    if (!text || text.length > 60000) return null;
    const value = JSON.parse(text) as PendingOrder;
    const b = value.body;
    if (value.version !== 1 || !b || !/^[a-zA-Z0-9_-]{8,100}$/.test(b.requestId) || !/^[a-f0-9]{64}$/.test(b.guestContext) || typeof b.tableId !== 'string' || !b.tableId || b.tableId.length > 100 || !Number.isSafeInteger(b.expectedTotal) || b.expectedTotal <= 0 || b.expectedTotal > 100_000_000 || (b.packed !== undefined && b.packed !== true) || !Array.isArray(b.lines) || !b.lines.length || b.lines.length > 30 || !Array.isArray(value.labels) || value.labels.length !== b.lines.length) return null;
    const validId = (id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 100;
    if (!b.lines.every(l => l && validId(l.productId) && Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= 20 && Array.isArray(l.selections) && l.selections.length <= 10 && l.selections.every(s => s && validId(s.groupId) && validId(s.optionId)) && validLineExtras(l))) return null;
    if (!value.labels.every(l => l && typeof l.name === 'string' && l.name.length <= 160 && typeof l.options === 'string' && l.options.length <= 2000 && Number.isSafeInteger(l.total) && l.total > 0)) return null;
    if (value.labels.reduce((sum, l) => sum + l.total, 0) !== b.expectedTotal) return null;
    return value;
  } catch { return null; }
}
export function writePendingOrder(storage: StorageLike | null, key: string, value: PendingOrder) {
  try { if (!storage) return false; storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function clearPendingOrder(storage: StorageLike | null, key: string, requestId?: string) {
  try {
    if (requestId && readPendingOrder(storage, key)?.body.requestId !== requestId) return;
    storage?.removeItem(key);
  } catch { /* In-memory retry remains available when browser storage is unavailable. */ }
}
