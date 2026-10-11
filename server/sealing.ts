import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { State } from '../packages/domain/types.js';
import { isPacked, pack, unpack } from './packing.js';

/**
 * AES-256-GCM; `scope` is bound as AAD so a sealed row cannot be moved to another tenant or record. `packed`: compress
 * first (history rows, data version 3); readers tell packed rows from plain JSON by their first byte (server/packing.ts).
 */
export function seal(value: unknown, key: Buffer, scope: string, packed = false) {
  return sealText(Buffer.from(JSON.stringify(value), 'utf8'), key, scope, packed);
}
/** Seals JSON bytes as they are; the one-time rewrite repacks rows without parsing them. */
export function sealText(json: Buffer, key: Buffer, scope: string, packed = false) {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`mola:v1:${scope}`));
  const encrypted = Buffer.concat([cipher.update(packed ? pack(json) : json), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
}
export function unseal(data: Buffer, key: Buffer, scope: string): State {
  return open(data, key, scope);
}
export function open<T>(data: Buffer, key: Buffer, scope: string): T {
  return JSON.parse(openText(data, key, scope).json.toString('utf8'));
}
/** The JSON bytes of a sealed row, and whether it was stored packed. */
export function openText(data: Buffer, key: Buffer, scope: string) {
  const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  cipher.setAAD(Buffer.from(`mola:v1:${scope}`)); cipher.setAuthTag(data.subarray(12, 28));
  const plain = Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]);
  return { json: unpack(plain), packed: isPacked(plain) };
}
