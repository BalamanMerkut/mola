import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Café → Merkez request signing. Each café install holds an install id and a 32-byte secret that only it and Merkez know.
 * A request carries time + a fresh nonce and an HMAC over method, path, time, nonce and the body hash. Merkez accepts
 * a time within CLOCK_WINDOW_MS of its own clock and each nonce once (replays fail). Merkez signs its answer the same
 * way, bound to the request's nonce, so a swapped answer (support messages) is noticed too. Licences are signed apart.
 */
export const CLOCK_WINDOW_MS = 5 * 60_000;
export const HEADER = { install: 'x-mola-install', time: 'x-mola-time', nonce: 'x-mola-nonce', signature: 'x-mola-signature' } as const;
export const newInstallSecret = () => randomBytes(32).toString('base64url');
const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const mac = (secret: string, text: string) => createHmac('sha256', Buffer.from(secret, 'base64url')).update(text).digest('base64url');
export function requestSignature(secret: string, method: string, path: string, time: string, nonce: string, body: string | Buffer) {
  return mac(secret, ['MOLA-HMAC-1', method.toUpperCase(), path, time, nonce, hash(body)].join('\n'));
}
export function responseSignature(secret: string, nonce: string, body: string | Buffer) {
  return mac(secret, ['MOLA-HMAC-1-RESP', nonce, hash(body)].join('\n'));
}
export function signedHeaders(installId: string, secret: string, method: string, path: string, body: string | Buffer, time: number) {
  const nonce = randomBytes(16).toString('hex'), at = String(Math.round(time));
  return { [HEADER.install]: installId, [HEADER.time]: at, [HEADER.nonce]: nonce, [HEADER.signature]: requestSignature(secret, method, path, at, nonce, body) };
}
export function sameSignature(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
