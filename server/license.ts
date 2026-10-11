import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { freezeWindow, type FreezeRequest } from './license-freeze.js';
import packageInfo from '../package.json' with { type: 'json' };
import { featureById, type FeatureId } from '../packages/domain/features.js';

/*
 * Licences and support tickets, shared by the two server roles:
 *   Merkez  (server/merkez/)  keeps the business registry, decides licences and signs them with its Ed25519 private key.
 *   Kafe    (server/app.ts)   keeps all business data, verifies the signed licence with Merkez's public key and enforces it.
 * A licence carries no sales or financial data.
 */
/** This program's version (package.json; bundled into the packaged server by esbuild). Otomatik güncelleme compares it. */
export const APP_VERSION: string = packageInfo.version;
/** 'menu': QR menu only, without customer ordering or waiter calls. Missing means the full system. */
export type ServicePlan = 'full' | 'menu';
/**
 * `features`: the services this business may use now (packages/domain/features.ts FeatureId), from the signed licence. Missing:
 * a licence from before packaging (or from an older Merkez): every service is open, as it always was.
 */
export type License = { features?: FeatureId[]; service?: ServicePlan; tenantId: string; name: string; endsAt: string | null; suspended: boolean; kind?: 'trial' | 'subscription'; trialStartedAt?: string; planMonths?: 1 | 6 | 12; freezes?: FreezeRequest[]; createdAt?: string; firstLoginAt?: string; lastSeenAt?: string };
export function licenseSummary(l: License, now: Date) {
  const freeze = freezeWindow(l, now);
  const remaining = l.endsAt ? Date.parse(l.endsAt) - (freeze ? Date.parse(freeze.until!) : now.getTime()) : 0;
  return { ...l, daysRemaining: Math.max(0, Math.ceil(remaining / 86400000)), frozen: !!freeze, active: !l.suspended && !freeze && remaining > 0 };
}
/**
 * A file on a support message (server/merkez/attachments.ts): a photo (re-encoded to WebP, no EXIF/GPS) or a PDF, kept at
 * Mola Merkez only until `expiresAt` (14 days), then deleted; the message keeps this line ("Ek silindi (14 gün)").
 */
export type AttachmentRef = { id: string; name: string; type: 'image/webp' | 'application/pdf'; size: number; expiresAt: string; width?: number; height?: number };
export type TicketMessage = { id: string; source: 'business' | 'support'; text: string; at: string; attachments?: AttachmentRef[] };
export type Ticket = { id: string; tenantId: string; subject: string; status: 'open' | 'closed'; createdAt: string; messages: TicketMessage[] };
export function extendMonths(date: Date, months: number) {
  const d = new Date(date), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString();
}

// ---------- Signed licence ----------
export type LicensePlan = 'trial' | 'monthly' | 'semiannual' | 'annual' | 'subscription';
/**
 * What Merkez signs. `serial` grows with every change; the café keeps the highest one it has verified.
 * `features` (hizmet paketleri, 5 Ekim): the services the café may use now: during a trial every sellable service, after it
 * the business's package (or its "Özel" list); a suspended licence carries the same list (status closes it anyway). Café
 * versions from before packaging check the claims strictly and refuse any licence with this field, so Merkez signs every
 * licence twice with the same serial (server/merkez/store.ts `issue`): with `features` first, then without it. A newer café
 * takes the first; an older one cannot verify the first and takes the second. Unknown ids (a newer Merkez's services) are
 * dropped on reading, never refused.
 */
export type LicenseClaims = {
  v: 1; serial: number; issuedAt: string; installId: string; tenantId: string; name: string; plan: LicensePlan; service: ServicePlan;
  expiresAt: string | null; status: 'active' | 'suspended'; freezes: FreezeRequest[]; trialStartedAt?: string; createdAt?: string; features?: FeatureId[];
};
export type SignedLicense = { format: 'mola-lisans-1'; payload: string; signature: string };
const FORMAT = 'mola-lisans-1', DOMAIN = 'mola-lisans-1\n';
const iso = z.string().max(40).refine(v => Number.isFinite(Date.parse(v)));
const freezeSchema = z.object({ id: z.string().min(1).max(100), reason: z.string().max(1000), startDate: z.string().max(10), days: z.number().int(), requestedAt: iso, status: z.enum(['pending', 'approved', 'rejected']), decision: z.string().max(1000).optional(), decidedAt: iso.optional(), startsAt: iso.optional(), until: iso.optional(), endedAt: iso.optional() }).strict();
const claimsSchema = z.object({
  v: z.literal(1), serial: z.number().int().positive(), issuedAt: iso, installId: z.string().min(1).max(100), tenantId: z.string().min(1).max(100), name: z.string().max(200),
  plan: z.enum(['trial', 'monthly', 'semiannual', 'annual', 'subscription']), service: z.enum(['full', 'menu']), expiresAt: iso.nullable(), status: z.enum(['active', 'suspended']),
  freezes: z.array(freezeSchema).max(100), trialStartedAt: iso.optional(), createdAt: iso.optional(),
  features: z.array(z.string().min(1).max(40)).max(64).optional(),
}).strict();
const signedSchema = z.object({ format: z.literal(FORMAT), payload: z.string().min(10).max(200_000).regex(/^[A-Za-z0-9_-]+$/), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict();
export class LicenseError extends Error {}
export function signLicense(claims: LicenseClaims, key: KeyObject): SignedLicense {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return { format: FORMAT, payload, signature: sign(null, Buffer.from(DOMAIN + payload), key).toString('base64url') };
}
/** Throws LicenseError for anything not signed by this key, edited after signing, or not in the licence shape. */
export function verifyLicense(signed: unknown, key: KeyObject): LicenseClaims {
  const parsed = signedSchema.safeParse(signed);
  if (!parsed.success) throw new LicenseError('Lisans biçimi geçersiz.');
  const { payload, signature } = parsed.data;
  let ok = false;
  try { ok = verify(null, Buffer.from(DOMAIN + payload), key, Buffer.from(signature, 'base64url')); } catch { ok = false; }
  if (!ok) throw new LicenseError('Lisans imzası geçersiz.');
  let body: unknown;
  try { body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new LicenseError('Lisans okunamadı.'); }
  const claims = claimsSchema.safeParse(body);
  if (!claims.success) throw new LicenseError('Lisans içeriği geçersiz.');
  const { features, ...rest } = claims.data;
  return (features ? { ...rest, features: features.filter((f): f is FeatureId => featureById.has(f as FeatureId)) } : rest) as LicenseClaims;
}
/**
 * "Nabız": Merkez's signed word that this install reached it at `serverTime` (and whether this computer still holds the
 * install). Signed apart from licences (its own domain string, so neither passes as the other) and sent with every heartbeat
 * answer; the café counts its offline days from the newest one, which nobody can forge or move forward without Merkez's key.
 */
export type PulseClaims = { v: 1; installId: string; serverTime: string; machine: 'active' | 'replaced' | 'unknown' };
export type SignedPulse = { format: 'mola-nabiz-1'; payload: string; signature: string };
const PULSE = 'mola-nabiz-1', PULSE_DOMAIN = 'mola-nabiz-1\n';
const pulseSchema = z.object({ v: z.literal(1), installId: z.string().min(1).max(100), serverTime: iso, machine: z.enum(['active', 'replaced', 'unknown']) }).strict();
export function signPulse(claims: PulseClaims, key: KeyObject): SignedPulse {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return { format: PULSE, payload, signature: sign(null, Buffer.from(PULSE_DOMAIN + payload), key).toString('base64url') };
}
export function verifyPulse(signed: unknown, key: KeyObject): PulseClaims {
  const parsed = z.object({ format: z.literal(PULSE), payload: z.string().min(10).max(2000).regex(/^[A-Za-z0-9_-]+$/), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict().safeParse(signed);
  if (!parsed.success) throw new LicenseError('Nabız biçimi geçersiz.');
  let ok = false;
  try { ok = verify(null, Buffer.from(PULSE_DOMAIN + parsed.data.payload), key, Buffer.from(parsed.data.signature, 'base64url')); } catch { ok = false; }
  if (!ok) throw new LicenseError('Nabız imzası geçersiz.');
  let body: unknown; try { body = JSON.parse(Buffer.from(parsed.data.payload, 'base64url').toString('utf8')); } catch { throw new LicenseError('Nabız okunamadı.'); }
  const claims = pulseSchema.safeParse(body); if (!claims.success) throw new LicenseError('Nabız içeriği geçersiz.');
  return claims.data;
}
/**
 * "Kapanış": Merkez's signed word that one business's record was closed (the vendor deleted it after suspending it). Final:
 * the café keeps it and stays locked for that business; its data stays where it is. Its own domain string, so it passes
 * neither as a licence nor as a pulse. Sent with the heartbeat answer (older cafés ignore the field).
 */
export type RemovalClaims = { v: 1; installId: string; tenantId: string; removedAt: string };
export type SignedRemoval = { format: 'mola-kapanis-1'; payload: string; signature: string };
const REMOVAL = 'mola-kapanis-1', REMOVAL_DOMAIN = 'mola-kapanis-1\n';
const removalSchema = z.object({ v: z.literal(1), installId: z.string().min(1).max(100), tenantId: z.string().min(1).max(100), removedAt: iso }).strict();
export function signRemoval(claims: RemovalClaims, key: KeyObject): SignedRemoval {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return { format: REMOVAL, payload, signature: sign(null, Buffer.from(REMOVAL_DOMAIN + payload), key).toString('base64url') };
}
export function verifyRemoval(signed: unknown, key: KeyObject): RemovalClaims {
  const parsed = z.object({ format: z.literal(REMOVAL), payload: z.string().min(10).max(2000).regex(/^[A-Za-z0-9_-]+$/), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict().safeParse(signed);
  if (!parsed.success) throw new LicenseError('Kapanış biçimi geçersiz.');
  let ok = false;
  try { ok = verify(null, Buffer.from(REMOVAL_DOMAIN + parsed.data.payload), key, Buffer.from(parsed.data.signature, 'base64url')); } catch { ok = false; }
  if (!ok) throw new LicenseError('Kapanış imzası geçersiz.');
  let body: unknown; try { body = JSON.parse(Buffer.from(parsed.data.payload, 'base64url').toString('utf8')); } catch { throw new LicenseError('Kapanış okunamadı.'); }
  const claims = removalSchema.safeParse(body); if (!claims.success) throw new LicenseError('Kapanış içeriği geçersiz.');
  return claims.data;
}
/**
 * "Mola ekibi iletişim bilgileri": what the café shows when it needs the vendor (application waiting or refused, Merkez
 * unreachable, a closed or moved licence, "Şifremi unuttum", Destek). Typed by the vendor in Mola Yönetim and signed like
 * the pulse (its own domain string), so the café keeps it beside its data and shows it offline, and a copy edited on disk
 * or sent by anything but our Merkez is ignored. Every field may be empty; empty means "not shown".
 */
export type ContactInfo = { phone: string; whatsapp: string; email: string; hours: string; web: string };
export type ContactClaims = ContactInfo & { v: 1; updatedAt: string };
export type SignedContact = { format: 'mola-iletisim-1'; payload: string; signature: string };
const CONTACT = 'mola-iletisim-1', CONTACT_DOMAIN = 'mola-iletisim-1\n';
const phoneText = z.string().trim().max(30).regex(/^[+0-9 ()-]*$/, 'Telefonda yalnız rakam, boşluk, +, ( ) ve - olabilir.').refine(v => !v || v.replace(/\D/g, '').length >= 7, 'Telefon numarası eksik.');
/** The vendor's form and the signed claims share these rules (the café checks them again before showing a link). */
export const contactSchema = z.object({
  phone: phoneText, whatsapp: phoneText,
  email: z.string().trim().max(120).refine(v => !v || /^[^\s@<>"]{1,64}@[^\s@<>"]{1,180}\.[^\s@<>".]{2,}$/.test(v), 'E-posta adresi geçersiz.'),
  hours: z.string().trim().max(120).regex(/^[^\u0000-\u001f<>]*$/, 'Çalışma saatlerinde kullanılamayan karakter var.'),
  web: z.string().trim().max(200).refine(v => !v || /^https:\/\/[^\s<>"]{3,190}$/.test(v), 'Web adresi https:// ile başlamalı.'),
}).strict();
export const emptyContact = (c: ContactInfo) => !c.phone && !c.whatsapp && !c.email && !c.hours && !c.web;
export function signContact(claims: ContactClaims, key: KeyObject): SignedContact {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return { format: CONTACT, payload, signature: sign(null, Buffer.from(CONTACT_DOMAIN + payload), key).toString('base64url') };
}
export function verifyContact(signed: unknown, key: KeyObject): ContactClaims {
  const parsed = z.object({ format: z.literal(CONTACT), payload: z.string().min(10).max(4000).regex(/^[A-Za-z0-9_-]+$/), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict().safeParse(signed);
  if (!parsed.success) throw new LicenseError('İletişim bilgisi biçimi geçersiz.');
  let ok = false;
  try { ok = verify(null, Buffer.from(CONTACT_DOMAIN + parsed.data.payload), key, Buffer.from(parsed.data.signature, 'base64url')); } catch { ok = false; }
  if (!ok) throw new LicenseError('İletişim bilgisi imzası geçersiz.');
  let body: unknown; try { body = JSON.parse(Buffer.from(parsed.data.payload, 'base64url').toString('utf8')); } catch { throw new LicenseError('İletişim bilgisi okunamadı.'); }
  const claims = contactSchema.extend({ v: z.literal(1), updatedAt: iso }).strict().safeParse(body);
  if (!claims.success) throw new LicenseError('İletişim bilgisi içeriği geçersiz.');
  return claims.data as ContactClaims;
}
export const planOf =(l: Pick<License, 'kind' | 'planMonths'>): LicensePlan => l.kind === 'trial' ? 'trial' : l.planMonths === 1 ? 'monthly' : l.planMonths === 6 ? 'semiannual' : l.planMonths === 12 ? 'annual' : 'subscription';
const MONTHS = { monthly: 1, semiannual: 6, annual: 12 } as const;
/** The verified claims in the shape the screens and freeze rules already use. */
export function claimsToLicense(c: LicenseClaims): License {
  return { tenantId: c.tenantId, name: c.name, endsAt: c.expiresAt, suspended: c.status === 'suspended', kind: c.plan === 'trial' ? 'trial' : 'subscription', service: c.service,
    ...(c.plan in MONTHS ? { planMonths: MONTHS[c.plan as keyof typeof MONTHS] } : {}), freezes: c.freezes, ...(c.trialStartedAt ? { trialStartedAt: c.trialStartedAt } : {}), ...(c.createdAt ? { createdAt: c.createdAt } : {}),
    ...(c.features ? { features: c.features } : {}) };
}
/** `features` only when the licence has them (License.features); Merkez signs a copy without them for older cafés. */
export function licenseClaims(l: License, installId: string, serial: number, issuedAt: Date): LicenseClaims {
  return { v: 1, serial, issuedAt: issuedAt.toISOString(), installId, tenantId: l.tenantId, name: l.name, plan: planOf(l), service: l.service ?? 'full', expiresAt: l.endsAt,
    status: l.suspended ? 'suspended' : 'active', freezes: l.freezes ?? [], ...(l.trialStartedAt ? { trialStartedAt: l.trialStartedAt } : {}), ...(l.createdAt ? { createdAt: l.createdAt } : {}),
    ...(l.features ? { features: [...l.features] } : {}) };
}

// ---------- Keys ----------
/** Base64 DER: PKCS#8 for the private key (Merkez only), SPKI for the public key (every café). */
export function newSigningPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
}
/** The short "parmak izi" the installer prints (SHA-256 of the key bytes, 16 hex): café and Merkez compare keys by it. */
export function keyFingerprint(key: KeyObject | string) {
  const der = typeof key === 'string' ? Buffer.from(key.trim(), 'base64') : key.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}
export const showFingerprint = (hex: string) => hex.replace(/(.{4})(?!$)/g, '$1-');
export const privateKeyFrom = (b64: string) => createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
export function publicKeyFrom(b64: string) {
  const key = createPublicKey({ key: Buffer.from(b64.trim(), 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw new LicenseError('Mola Merkez anahtarı Ed25519 olmalı.');
  return key;
}
/** Release builds bake Merkez's public key in here at bundle time (esbuild define in scripts/build-installer.mjs); empty in development. */
export const EMBEDDED_MERKEZ_PUBLIC_KEY: string = process.env.MOLA_EMBEDDED_MERKEZ_KEY ?? '';
/** Development default: the café talks to a Merkez on this computer (`npm run merkez`). */
export const DEV_MERKEZ_URL = 'http://127.0.0.1:4000';
export const DEV_MERKEZ_KEY_FILE = '.local/merkez/merkez-public-key.txt';
/**
 * The key a café verifies licences with: MOLA_MERKEZ_PUBLIC_KEY (the key itself or a file holding it), else the embedded
 * release key, else the local development Merkez's key file. undefined: none configured, so no licence can be valid.
 */
export function merkezPublicKey(env: NodeJS.ProcessEnv = process.env): KeyObject | undefined {
  // A packaged café trusts only the key baked into its program: an edited start-up file must not swap in another key.
  if (EMBEDDED_MERKEZ_PUBLIC_KEY) { try { return publicKeyFrom(EMBEDDED_MERKEZ_PUBLIC_KEY); } catch { return undefined; } }
  const value = env.MOLA_MERKEZ_PUBLIC_KEY?.trim();
  let text = '';
  try {
    if (value) text = /^[A-Za-z0-9+/]{40,}={0,2}$/.test(value) ? value : readFileSync(resolve(value), 'utf8');
    else if (existsSync(DEV_MERKEZ_KEY_FILE)) text = readFileSync(DEV_MERKEZ_KEY_FILE, 'utf8');
  } catch { return undefined; }
  if (!text.trim()) return undefined;
  try { return publicKeyFrom(text); } catch { return undefined; }
}
