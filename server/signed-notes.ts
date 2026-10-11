import { sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { LicenseError } from './license.js';

/*
 * Small Ed25519-signed notes from Mola Merkez to the cafés, signed with the licence key but each under its own domain
 * string (so none passes as a licence, a pulse, another note or each other), the same way as the licence and "nabız":
 *   mola-tanitim-1      "Tanıtım işletmesi": this business is a demo; optionally one manual reset order ("Tanıtımı sıfırla")
 *   mola-adres-1        "Merkez adresi": Mola Merkez moved to a new address (VDS + HTTPS); the café checks it before switching
 *   mola-adres-kanit-1  the new address's proof: it answered this café's nonce with the same key and knows this install
 * The café checks every one with the Merkez key embedded in its program (server/license.ts merkezPublicKey).
 */
export type DemoSector = 'cafe' | 'restaurant' | 'dessert';
/** One manual reset ordered by the vendor; `id` is done once (the café keeps the ids it did). */
export type DemoReset = { id: string; sector: DemoSector; requestedAt: string; demoPassword: boolean };
export type DemoClaims = { v: 1; installId: string; tenantId: string; demo: boolean; issuedAt: string; reset?: DemoReset };
export type AddressClaims = { v: 1; url: string; issuedAt: string };
export type AddressProofClaims = { v: 1; installId: string; nonce: string; url: string; serverTime: string };
export type SignedNote<F extends string> = { format: F; payload: string; signature: string };
export type SignedDemo = SignedNote<'mola-tanitim-1'>;
export type SignedAddress = SignedNote<'mola-adres-1'>;
export type SignedAddressProof = SignedNote<'mola-adres-kanit-1'>;

const iso = z.string().max(40).refine(v => Number.isFinite(Date.parse(v)));
const sectors = z.enum(['cafe', 'restaurant', 'dessert']);
/** The new address: https (or this computer, for tests and a Merkez on the café's own PC); no credentials, no query. */
export const merkezAddress = z.string().trim().max(200).refine(v => {
  try { const u = new URL(v); return (u.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) && !u.username && !u.password && !u.search && !u.hash && /^https?:\/\/[^/]+\/?$/.test(v); } catch { return false; }
}, 'Merkez adresi https:// ile başlamalı (ör. https://merkez.alanadi.com).').transform(v => v.replace(/\/+$/, ''));
const schemas = {
  'mola-tanitim-1': z.object({ v: z.literal(1), installId: z.string().min(1).max(100), tenantId: z.string().min(1).max(100), demo: z.boolean(), issuedAt: iso,
    reset: z.object({ id: z.string().uuid(), sector: sectors, requestedAt: iso, demoPassword: z.boolean() }).strict().optional() }).strict(),
  'mola-adres-1': z.object({ v: z.literal(1), url: merkezAddress, issuedAt: iso }).strict(),
  'mola-adres-kanit-1': z.object({ v: z.literal(1), installId: z.string().min(1).max(100), nonce: z.string().regex(/^[a-f0-9]{32}$/), url: merkezAddress, serverTime: iso }).strict(),
};
type Formats = keyof typeof schemas;
type ClaimsOf = { 'mola-tanitim-1': DemoClaims; 'mola-adres-1': AddressClaims; 'mola-adres-kanit-1': AddressProofClaims };
const names: Record<Formats, string> = { 'mola-tanitim-1': 'Tanıtım bilgisi', 'mola-adres-1': 'Merkez adresi', 'mola-adres-kanit-1': 'Adres kanıtı' };

export function signNote<F extends Formats>(format: F, claims: ClaimsOf[F], key: KeyObject): SignedNote<F> {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return { format, payload, signature: sign(null, Buffer.from(`${format}\n${payload}`), key).toString('base64url') };
}
/** Throws LicenseError for anything not signed by this key under this format, edited after signing, or not in its shape. */
export function verifyNote<F extends Formats>(format: F, signed: unknown, key: KeyObject): ClaimsOf[F] {
  const parsed = z.object({ format: z.literal(format), payload: z.string().min(10).max(4000).regex(/^[A-Za-z0-9_-]+$/), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict().safeParse(signed);
  if (!parsed.success) throw new LicenseError(`${names[format]} biçimi geçersiz.`);
  let ok = false;
  try { ok = verify(null, Buffer.from(`${format}\n${parsed.data.payload}`), key, Buffer.from(parsed.data.signature, 'base64url')); } catch { ok = false; }
  if (!ok) throw new LicenseError(`${names[format]} imzası geçersiz.`);
  let body: unknown; try { body = JSON.parse(Buffer.from(parsed.data.payload, 'base64url').toString('utf8')); } catch { throw new LicenseError(`${names[format]} okunamadı.`); }
  const claims = schemas[format].safeParse(body);
  if (!claims.success) throw new LicenseError(`${names[format]} içeriği geçersiz.`);
  return claims.data as ClaimsOf[F];
}
/** "Tanıtım" demo staff password (only when the reset asked for it): known on purpose, for the vendor's sales visits. */
export const DEMO_STAFF_PASSWORD = 'Tanitim-2026!';
