import type { IncomingOrder, PlatformId } from '../../packages/domain/external-orders.js';

// The contract every delivery platform adapter fulfils (docs/GELISTIRICI_REHBERI.md, "Dış sipariş entegrasyonları").
// Adapters run only on the café server. They get the credentials for one call and must never log, store or return them;
// everything they read stays on this computer (nothing goes to Mola Merkez).

/** One field of the "Bağla" form. `secret`: shown as "kayıtlı" after saving, never sent back to a screen. */
export type CredentialField = { key: string; label: string; secret: boolean; hint?: string };
export type Credentials = Record<string, string>;
/** Everything one call may use. `cursor`: what the adapter returned last time (kept in memory), e.g. the last order time. */
export type AdapterContext = { tenantId: string; credentials: Credentials; cursor?: string; now: Date; signal: AbortSignal };
export type RejectInput = { reason: string };

export interface PlatformAdapter {
  id: PlatformId;
  name: string;
  /** false: the platform's partner (entegratör) approval and API documentation are still missing; it cannot be switched on. */
  available: boolean;
  /** How new orders arrive. 'poll' today; 'webhook' needs a public HTTPS address in front of the café (receive() below). */
  modes: ('poll' | 'webhook')[];
  fields: CredentialField[];
  /** Short honest note for the owner (what is still needed). */
  status?: string;
  /** New and changed orders since `cursor`. Repeats are fine: the café drops orders it already knows (platform + externalId). */
  fetchOrders(ctx: AdapterContext): Promise<{ orders: IncomingOrder[]; cursor?: string }>;
  accept(ctx: AdapterContext, externalId: string): Promise<void>;
  reject(ctx: AdapterContext, externalId: string, input: RejectInput): Promise<void>;
  /** The kitchen marked it Hazır (ready for the courier / for pick-up). */
  ready(ctx: AdapterContext, externalId: string): Promise<void>;
  /** Handed to the courier (or to the customer for gel-al). */
  delivered(ctx: AdapterContext, externalId: string): Promise<void>;
  /** The café cancelled an order it had accepted. */
  cancel(ctx: AdapterContext, externalId: string, input: RejectInput): Promise<void>;
  /** Optional check for the "Bağla" form (e.g. a token request). */
  verify?(ctx: AdapterContext): Promise<void>;
  /** Later, for webhooks: check the platform's signature and read the pushed orders. Must throw on a bad signature. */
  receive?(ctx: AdapterContext, request: { headers: Record<string, string | undefined>; body: unknown }): Promise<IncomingOrder[]>;
}

/** An adapter's failure in words the owner can read. `retry: false`: trying again will not help (wrong key, not available). */
export class AdapterError extends Error {
  constructor(public code: string, message: string, public retry = true) { super(message); }
}
export const notAvailable = (name: string) => new AdapterError('NOT_AVAILABLE', `${name}: bağlantı izni bekleniyor`, false);
