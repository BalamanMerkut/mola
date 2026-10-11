import { createHash, createHmac } from 'node:crypto';
import { MERKEZ_API } from './sync-protocol.js';

/*
 * İnternetten menü (7 Ekim): a guest opens the table QR from any network (mobile data, any Wi-Fi). The QR holds Mola Merkez's
 * public address `https://<site>/q/<kod>/<masa kodu>`; Mola Merkez passes the guest's requests to the café computer through
 * the café's own outbound WebSocket (no port opened at the café, works behind any modem), and the answers back. This file is
 * what both ends say to each other; server/merkez/guest-tunnel.ts is Merkez's end, server/guest-tunnel.ts the café's.
 *
 *   Connect   GET /api/merkez/v1/tunnel, WebSocket upgrade, signed like the heartbeat (install id, time, nonce, HMAC over
 *             method + path + empty body; server/install-auth.ts). The 101 answer carries Merkez's signature over the nonce, so
 *             the café knows it reached its own Merkez. A second connection of the same install replaces the first.
 *   Messages  one binary WebSocket message each: [u32 header length][header JSON][body bytes]
 *     café → Merkez  hello  { t, v, app, page, assets: { name: sha256 } }   what the café serves (the guest page and exactly
 *                                                                          the files it loads, read from Vite's manifest)
 *                    res    { t, id, s, h, more? } + body                 an answer (bodies over CHUNK bytes follow in parts)
 *                    data   { t, id, end? } + body                        the next part of an answer
 *                    status { t, v, tenants }                         QR siparişleri açık mı, per business (8 Ekim; on change)
 *     Merkez → café  req    { t, id, m, p, h, ip, tenant, mac } + body    one guest request, already on Merkez's allow-list
 *                    cancel { t, id }                                     the guest went away or Merkez gave up waiting
 *   `mac`: HMAC over the request (id, method, path, client address, business, body hash) with a key only this connection's two
 *   ends know (the install secret and the connection's nonce): the café believes the guest's address (its per-guest limits)
 *   and the business only from a request Merkez really sent on this connection.
 *   Keepalive: Merkez pings every PING_MS; a café that hears nothing for SILENT_MS reconnects, a Merkez that gets no pong for
 *   as long drops the connection. Reconnects wait BACKOFF (1 s … 60 s, with jitter), reset after a connection that held.
 */
export const TUNNEL_PATH = `${MERKEZ_API}/tunnel`;
export const TUNNEL = {
  /** Merkez pings this often; nothing heard for SILENT_MS means the connection is dead. */
  get PING_MS() { return Number(process.env.MOLA_TUNNEL_PING_MS) || 20_000; },
  get SILENT_MS() { return Number(process.env.MOLA_TUNNEL_SILENT_MS) || 50_000; },
  /** One guest request, from Merkez's side, end to end (the café's own work, the transfer, a queue wait). */
  get REQUEST_MS() { return Number(process.env.MOLA_TUNNEL_REQUEST_MS) || 20_000; },
  /** The café's hello must come this soon after connecting. */
  HELLO_MS: 10_000,
  /** Requests one café works on at once; more wait in its own queue (QUEUE), so a slow café never holds another's. */
  PARALLEL: 48, QUEUE: 300,
  /** A guest request body (an order is a few kB; the café's own JSON limit is 64 kB) and one answer. */
  MAX_REQUEST: 64 * 1024, MAX_ANSWER: 8 * 1024 * 1024,
  /** Answers travel in parts of this size, interleaved, so one large photo never holds the small answers behind it. */
  CHUNK: 64 * 1024,
  /** A WebSocket message (one part plus its header). */
  MAX_MESSAGE: 256 * 1024,
} as const;
/** Reconnect waits (ms); a random quarter is added, so cafés do not all come back in the same second after a Merkez restart. */
export const BACKOFF = [1000, 2000, 5000, 10_000, 30_000, 60_000];

export type TunnelHello = { t: 'hello'; v: 1; app: string; page?: string; assets: Record<string, string> };
export type TunnelRequest = { t: 'req'; id: number; m: 'GET' | 'POST'; p: string; h: Record<string, string>; ip: string; tenant: string; mac: string };
export type TunnelAnswer = { t: 'res'; id: number; s: number; h: Record<string, string>; more?: boolean };
export type TunnelPart = { t: 'data'; id: number; end?: boolean };
export type TunnelCancel = { t: 'cancel'; id: number };
/** café → Merkez (8 Ekim): QR siparişleri per business (null: not in its service), sent after hello and on every change. */
export type TunnelStatus = { t: 'status'; v: 1; tenants: Record<string, { open: boolean; reason?: string; since?: string; call: boolean } | null> };
export type TunnelMessage = TunnelHello | TunnelRequest | TunnelAnswer | TunnelPart | TunnelCancel | TunnelStatus;

export function pack(head: TunnelMessage, body?: Buffer) {
  const h = Buffer.from(JSON.stringify(head)), out = Buffer.allocUnsafe(4 + h.length + (body?.length ?? 0));
  out.writeUInt32BE(h.length, 0); h.copy(out, 4); body?.copy(out, 4 + h.length);
  return out;
}
export function unpack(message: Buffer): { head: TunnelMessage; body: Buffer } {
  if (message.length < 4) throw new Error('short');
  const n = message.readUInt32BE(0);
  if (n > 64 * 1024 || 4 + n > message.length) throw new Error('header');
  const head = JSON.parse(message.subarray(4, 4 + n).toString('utf8')) as TunnelMessage;
  if (!head || typeof head !== 'object' || typeof head.t !== 'string') throw new Error('header');
  return { head, body: message.subarray(4 + n) };
}
/** The key of one connection: the install secret and the nonce of its signed upgrade request. */
export const connectionKey = (secret: string, nonce: string) => createHmac('sha256', Buffer.from(secret, 'base64url')).update(`MOLA-TUNNEL-1\n${nonce}`).digest();
export const requestMac = (key: Buffer, r: Pick<TunnelRequest, 'id' | 'm' | 'p' | 'ip' | 'tenant'>, body: Buffer) =>
  createHmac('sha256', key).update(JSON.stringify(['req', r.id, r.m, r.p, r.ip, r.tenant, createHash('sha256').update(body).digest('hex')])).digest('base64url');
/** What Merkez signs in its 101 answer (the café checks it with the install secret: server/install-auth.ts responseSignature). */
export const TUNNEL_ACCEPTED = 'mola-tunnel-1';
export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
/** Content types of the guest page's files, by extension (nothing else is ever sent). */
export const ASSET_TYPES: Record<string, string> = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', avif: 'image/avif', jpg: 'image/jpeg', woff2: 'font/woff2' };
/** A built file's name: Vite's `<name>-<hash>.<ext>`, one level, nothing that could climb out of the folder. */
export const ASSET_NAME = /^[A-Za-z0-9_-]{1,80}-[A-Za-z0-9_-]{8}\.(js|css|svg|png|webp|avif|jpg|woff2)$/;
/** A table QR token (server/business-profile.ts: 18 random bytes, base64url) and, more loosely, older ones. */
export const TABLE_TOKEN = /^[A-Za-z0-9_-]{8,100}$/;
/** A business's public menu code (Merkez gives it once, like the social short code). */
export const MENU_CODE = /^[A-Za-z0-9]{10}$/;
