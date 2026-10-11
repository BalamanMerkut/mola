import type { PaymentSelection } from '../packages/domain/types';

/** `depositCredit`: the reservation kapora already taken off this bill (shown in the payment window; never stored here). */
export type PaymentTable = { name: string; account: { id: string; version: number; balance: number; paid: number; depositCredit?: number } };
export type PendingPayment = {
  version: 1;
  table: PaymentTable;
  /** `tip`: "Bahşiş", kept apart from the sale; `tendered` includes it unless `tipMethod` differs from `method` (server/cash-closing.ts payWithTip). */
  body: { requestId: string; paymentContext: string; accountId: string; version: number; method: 'cash' | 'card'; amount: number; tendered: number; selections?: PaymentSelection[]; tip?: number; tipMethod?: 'cash' | 'card' };
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function paymentStorage(): StorageLike | null { try { return window.sessionStorage; } catch { return null; } }
const key = (context: string) => 'mola.pending-payment.v1:' + context;
export function readPendingPayment(storage: StorageLike | null, context: string): PendingPayment | null {
  try {
    const text = storage?.getItem(key(context));
    if (!text || text.length > 50000) return null;
    const p = JSON.parse(text) as PendingPayment, b = p.body, a = p.table?.account;
    const id = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100;
    const amount = (v: number) => Number.isSafeInteger(v) && v >= 0 && v <= 100_000_000;
    if (p.version !== 1 || !b || !a || typeof b.requestId !== 'string' || !/^[a-f0-9]{64}$/.test(context) || b.paymentContext !== context || !/^[a-zA-Z0-9_-]{8,100}$/.test(b.requestId) || !id(b.accountId) || a.id !== b.accountId || a.version !== b.version || !Number.isSafeInteger(b.version) || b.version < 0 || !['cash', 'card'].includes(b.method) || !amount(b.amount) || b.amount === 0 || !amount(b.tendered) || b.tendered < b.amount || !Number.isSafeInteger(a.balance) || a.balance < 0 || !Number.isSafeInteger(a.paid) || a.paid < 0 || typeof p.table.name !== 'string' || !p.table.name || p.table.name.length > 100) return null;
    if (b.tipMethod !== undefined && !['cash', 'card'].includes(b.tipMethod)) return null;
    if (b.tip !== undefined && (!amount(b.tip) || b.tip === 0 || ((b.tipMethod ?? b.method) === b.method && b.tendered < b.amount + b.tip))) return null;
    if (b.selections !== undefined && (!Array.isArray(b.selections) || !b.selections.length || b.selections.length > 100 || !b.selections.every(s => s && id(s.orderId) && id(s.lineId) && Number.isInteger(s.quantity) && s.quantity >= 1 && s.quantity <= 20))) return null;
    return p;
  } catch { return null; }
}
export function writePendingPayment(storage: StorageLike | null, payment: PendingPayment) {
  try { if (!storage) return false; storage.setItem(key(payment.body.paymentContext), JSON.stringify(payment)); return true; } catch { return false; }
}
export function clearPendingPayment(storage: StorageLike | null, context: string, requestId: string) {
  try { if (readPendingPayment(storage, context)?.body.requestId === requestId) storage?.removeItem(key(context)); } catch { /* The in-memory request remains usable when storage is blocked. */ }
}
