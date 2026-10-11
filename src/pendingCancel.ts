import { ApiError } from './api';
export type PendingCancel = { format: 1; number: number; body: { requestId: string; guestContext: string; orderId: string; version: number } };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const pendingCancelKey = (path: string) => 'mola.pending-cancel.v1:' + path;
export function readPendingCancel(storage: StorageLike | null, key: string): PendingCancel | null {
  try {
    const text = storage?.getItem(key); if (!text || text.length > 2000) return null;
    const p = JSON.parse(text) as PendingCancel, b = p.body;
    if (p.format !== 1 || !Number.isSafeInteger(p.number) || p.number < 1 || !b || typeof b.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(b.requestId) || typeof b.guestContext !== 'string' || !/^[a-f0-9]{64}$/.test(b.guestContext) || typeof b.orderId !== 'string' || !b.orderId || b.orderId.length > 100 || !Number.isSafeInteger(b.version) || b.version < 0) return null;
    return p;
  } catch { return null; }
}
export function writePendingCancel(storage: StorageLike | null, key: string, value: PendingCancel) {
  try { if (!storage) return false; storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function clearPendingCancel(storage: StorageLike | null, key: string, requestId: string) {
  try { if (readPendingCancel(storage, key)?.body.requestId === requestId) storage?.removeItem(key); } catch { /* Retry remains possible from memory. */ }
}
export function cancelDefinitelyRejected(error: unknown) {
  return error instanceof ApiError && ['NOT_FOUND', 'ACCOUNT_CLOSED', 'VERSION_CONFLICT', 'INVALID_TRANSITION', 'CASHIER_REVIEW', 'VALIDATION_ERROR', 'CANCEL_DECLINED'].includes(error.code);
}
