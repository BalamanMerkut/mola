import { createHmac, timingSafeEqual } from 'node:crypto';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Buffer) { let bits = 0, value = 0, out = ''; for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; out += alphabet[(value >>> bits) & 31]; } } if (bits) out += alphabet[(value << (5 - bits)) & 31]; return out; }
function decode(value: string) { let bits = 0, acc = 0; const result: number[] = []; for (const c of value) { const n = alphabet.indexOf(c); if (n < 0) throw new Error('Invalid TOTP secret'); acc = (acc << 5) | n; bits += 5; if (bits >= 8) { bits -= 8; result.push((acc >>> bits) & 255); } } return Buffer.from(result); }
export function totp(secret: string, time: number, digits = 6) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const h = createHmac('sha1', decode(secret)).update(counter).digest(), offset = h[h.length - 1] & 15;
  return ((h.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, '0');
}
export function verifyTotp(secret: string, code: string, time: number, lastStep = -1) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(time / 30000);
  for (const step of [current, current - 1, current + 1]) if (step >= 0 && step > lastStep && timingSafeEqual(Buffer.from(totp(secret, step * 30000)), Buffer.from(code))) return step;
  return null;
}
