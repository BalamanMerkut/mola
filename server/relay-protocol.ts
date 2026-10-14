import { z } from 'zod';

/*
 * Köprü (relay) through Mola Merkez: what the café computer and Mola Merkez say to each other. Cafés sit behind the modem
 * (NAT), so Mola Merkez never connects to a café: the café keeps one outbound long-poll open (HMAC-signed like the
 * heartbeat, server/install-auth.ts) only while a feature needs it (uzaktan destek izni açık, a paired phone, or Raporlarım
 * giriş possible: the package and the owner's phone code, 0.1.22), and answers
 * each request it is handed with a separate signed reply. Merkez routes, limits and times out; it holds nothing but
 * ciphertext for the phones (server/merkez/relay.ts).
 *
 *   POST /api/merkez/v1/relay/poll     { v, tenants }       → { requests } (held up to RELAY.HOLD_MS while there is nothing)
 *   POST /api/merkez/v1/relay/reply    { id, status, … }    → { ok }
 *   POST /api/merkez/v1/relay/state    { v, tenants }       → { ok }   (at once: permission switched off, a phone removed)
 *   POST /api/merkez/v1/relay/postbox  { items }            → { ok }   (encrypted snapshots for the phones)
 * (0.1.22: /relay/pairing went with the QR; a device signs in on the Raporlarım page, relay kind `login`.)
 */
const ms = (name: string, fallback: number) => Number(process.env[name]) || fallback;
export const RELAY = {
  /** How long Merkez holds a poll with nothing to hand over (MOLA_RELAY_HOLD_MS: tests). */
  get HOLD_MS() { return ms('MOLA_RELAY_HOLD_MS', 25_000); },
  /** How long Merkez waits for the café's answer to one request. */
  REQUEST_TIMEOUT_MS: 20_000,
  /** Requests waiting for the café's next poll (older ones are answered "kafe yanıt vermedi"). */
  MAX_QUEUE: 50,
  /** A relayed request body (a product photo is the largest: 8 MB of JSON) and a reply body, as base64 text. */
  MAX_REQUEST_B64: 12 * 1024 * 1024, MAX_REPLY_B64: 8 * 1024 * 1024,
  /** One encrypted snapshot for one phone. */
  MAX_BOX_BYTES: 256 * 1024,
  /** Postbox: one box per phone, deleted on fetch or after this many days. */
  POSTBOX_DAYS: 7,
  /** A support session ends after this long without a request, and at the latest after SESSION_MAX_MS. */
  get SESSION_IDLE_MS() { return ms('MOLA_SUPPORT_IDLE_MS', 30 * 60_000); },
  SESSION_MAX_MS: 8 * 3600_000,
  /** Phones per business. */
  MAX_PHONES: 3,
  /** "Hangisinin yerine?": the café's one-time ticket after a right password and code, when the list is full. */
  LOGIN_TICKET_MS: 5 * 60_000,
} as const;
export const tenantId = z.string().min(1).max(100);
export const phoneId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const b64u = (max: number) => z.string().max(max).regex(/^[A-Za-z0-9_-]*$/);
export const sessionId = z.string().uuid();
/** What each business of this café allows right now; Merkez forgets phones that are not listed any more. */
export const tenantState = z.object({ tenantId, support: z.boolean(), phones: z.array(phoneId).max(RELAY.MAX_PHONES) }).strict();
export type TenantState = z.infer<typeof tenantState>;
export const stateBody = z.object({ v: z.literal(1), tenants: z.array(tenantState).max(50) }).strict();
/** Raporlarım giriş (0.1.22, packages/domain/remote-crypto.ts loginRequest): everything that matters is inside `ct`. */
export const loginRequestSchema = z.object({ v: z.literal(1), phonePub: b64u(43).length(43), at: z.number().int().positive(), nonce: b64u(22).length(22), eph: b64u(43).length(43), iv: b64u(16).length(16), ct: b64u(4000) }).strict();
/** `op: 'forget'`: "Çıkış" on the device (signed like a live question). */
export const liveRequestSchema = z.object({ phone: phoneId, at: z.number().int().positive(), nonce: b64u(22).length(22), mac: b64u(43).length(43), op: z.literal('forget').optional() }).strict();
export const reportBoxSchema = z.object({ v: z.literal(1), kind: z.enum(['live', 'snapshot']), phone: phoneId, at: z.string().max(40), ref: b64u(22).optional(), eph: b64u(43).length(43), iv: b64u(16).length(16), ct: b64u(Math.ceil(RELAY.MAX_BOX_BYTES * 4 / 3) + 4) }).strict();
/**
 * Sahibin uzaktan yönetimi (server/remote-admin.ts, packages/domain/remote-admin-crypto.ts): the paired device's sealed
 * requests, passed to the café as they are. `open`: password + code sealed to the café; `call`: one /api request sealed with
 * the session key; `part`: the next part of a large sealed answer (ciphertext only).
 */
export const adminRequestSchema = z.discriminatedUnion('op', [
  z.object({ v: z.literal(1), op: z.literal('open'), phone: phoneId, at: z.number().int().positive(), nonce: b64u(22).length(22), eph: b64u(43).length(43), iv: b64u(16).length(16), ct: b64u(4000) }).strict(),
  z.object({ v: z.literal(1), op: z.literal('call'), sid: z.string().uuid(), tab: b64u(11).length(11), seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), at: z.number().int().positive(), iv: b64u(16).length(16), ct: b64u(RELAY.MAX_REQUEST_B64) }).strict(),
  z.object({ v: z.literal(1), op: z.literal('part'), sid: z.string().uuid(), ref: b64u(22).length(22), index: z.number().int().min(1).max(1000) }).strict(),
]);
export type AdminRequest = z.infer<typeof adminRequestSchema>;
/** The headers a relayed screen request may carry (nothing else: no cookie, no desktop key, no forwarding header). */
export const RELAY_HEADERS = ['accept', 'content-type', 'x-mola-tag'] as const;
export type RelayRequest =
  | { id: string; kind: 'support.start'; tenantId: string; session: string }
  | { id: string; kind: 'support.end'; tenantId: string; session: string; reason: 'vendor' | 'timeout' }
  | { id: string; kind: 'http'; tenantId: string; session: string; method: string; path: string; headers: Record<string, string>; body?: string }
  | { id: string; kind: 'login'; tenantId: string; request: z.infer<typeof loginRequestSchema> }
  | { id: string; kind: 'phone'; tenantId: string; phoneId: string; request: z.infer<typeof liveRequestSchema> }
  | { id: string; kind: 'admin'; tenantId: string; phoneId: string; request: AdminRequest };
export type RelayKind = RelayRequest['kind'];
/** A request before Merkez gives it its id. */
export type RelayCall = RelayRequest extends infer R ? R extends unknown ? Omit<R, 'id'> : never : never;
/** The café's answer: an HTTP-like status and either JSON or raw bytes (base64) with their type. */
export type RelayReply = { status: number; json?: unknown; body?: string; type?: string; tag?: string };
export const replyBody = z.object({ id: z.string().uuid(), status: z.number().int().min(100).max(599), json: z.unknown().optional(), body: z.string().max(RELAY.MAX_REPLY_B64).optional(), type: z.string().max(100).optional(), tag: z.string().max(100).optional() }).strict();
export const postboxBody = z.object({ items: z.array(z.object({ tenantId, phoneId, box: reportBoxSchema }).strict()).max(150) }).strict();
