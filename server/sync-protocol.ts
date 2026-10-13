import { z } from 'zod';
import { normalEmail, normalPhone, validEmail, validTaxNumber, type Invoice } from '../packages/domain/invoice.js';
import { sectors } from '../packages/domain/sector.js';
import { FEATURES_SOCIAL } from '../packages/domain/feature-gate.js';
import { PLATFORMS, type SignedRelease } from './update-manifest.js';
import type { SignedContact, SignedLicense, SignedPulse, SignedRemoval, Ticket } from './license.js';
import type { SignedAddress, SignedDemo } from './signed-notes.js';
import type { AnnouncementDelivery } from '../packages/domain/announcement.js';

/*
 * Everything a café sends to Merkez, as one strict allowlist. Merkez refuses any other field, so a café build can
 * never quietly start sending sales, payments, orders, menus, staff names or customer data. Counts are counts only.
 * PHASE M2 seam (not built): `supportAccess` (owner-controlled remote support grant) will be added here as a new optional
 * field, with the same strict rule. `update` (otomatik güncelleme): platform, state and version only, never a path or a name.
 */
const id = z.string().min(1).max(100), at = z.string().max(40);
export const businessReport = z.object({
  tenantId: id, name: z.string().max(200), sector: z.enum(sectors), setupCompleted: z.boolean(), setupCompletedAt: at.optional(),
  counts: z.object({ tables: z.number().int().min(0).max(100000), staff: z.number().int().min(0).max(100000), products: z.number().int().min(0).max(100000) }).strict(),
  lastActivityAt: at.optional(), firstOwnerLoginAt: at.optional(),
}).strict();
/** The existing privacy-safe failure record (server/persistent-failures.ts): code locations, never messages or values. */
export const failureReport = z.object({
  event: z.literal('request_failed'), requestId: z.string().uuid(), method: z.string().max(10), route: z.string().max(200), status: z.number().int(), code: z.string().max(80),
  elapsedMs: z.number().int().min(0), tenantId: id.optional(), role: z.string().max(20).optional(), fingerprint: z.string().max(64).optional(), frames: z.array(z.string().max(300)).max(8).optional(), at,
}).strict();
/**
 * Merkez keeps a failure record only when every field is what a code location looks like: a route pattern, an error code,
 * "fn (server/x.ts:12:3)" frames. Anything that could carry text (a message, a value, a path with a name in it) is dropped
 * at Merkez instead of refusing the whole heartbeat.
 */
const FRAME = /^(?:[\w$.<> [\]-]{1,80} \()?(?:server|packages)\/[\w./-]{1,200}:\d{1,6}:\d{1,6}\)?$/;
export const codeLocationOnly = (f: FailureReport) => /^(?:unmatched|\/[\w/:.*-]{0,199})$/.test(f.route) && /^[A-Z][A-Z0-9_]{0,79}$/.test(f.code)
  && /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(f.method) && (!f.role || /^[a-z_]{1,20}$/.test(f.role)) && (!f.fingerprint || /^[a-f0-9]{8,64}$/.test(f.fingerprint))
  && (f.frames ?? []).every(x => FRAME.test(x)) && Number.isFinite(Date.parse(f.at));
/**
 * Mola Lisans Sözleşmesi (packages/domain/agreement.ts): the version an owner accepted, when, and the name typed, if any.
 * Activation bodies and the heartbeat carry it; Merkez keeps it on the business. Never part of the signed licence.
 */
const agreementShape = { version: z.number().int().min(1).max(1000), acceptedAt: at, name: z.string().trim().max(80).optional() };
export const agreementAcceptance = z.object(agreementShape).strict();
/** A program file in an integrity report, relative to the folder that holds app/ (app/…, or a launcher beside it). */
const programFile = z.string().max(200).regex(/^(?:\.\.\/)?[A-Za-z0-9._@+ ()\-/]+$/);
/**
 * Program dosyaları denetimi (server/integrity.ts): how the café's own program files compare with the signed list of its
 * version. `changed`/`missing`: relative file names, nothing of their contents. `signatureFailed`: the kept signed list did not
 * verify; `manifestChanged`: the list file itself is not the signed one. `need`: the café has no signed list for its build yet
 * and asks Merkez for the release of its version and platform (answered in `integrityManifest`).
 */
export const integrityReport = z.object({
  state: z.enum(['ok', 'changed', 'unknown']), version: z.string().max(40), platform: z.enum(PLATFORMS), at,
  changed: z.array(programFile).max(50).optional(), missing: z.array(programFile).max(50).optional(),
  signatureFailed: z.boolean().optional(), manifestChanged: z.boolean().optional(), need: z.boolean().optional(),
}).strict();
export type IntegrityReport = z.infer<typeof integrityReport>;
export const ticketDelivery =z.object({ id: z.string().uuid(), tenantId: id, subject: z.string().max(120), createdAt: at, messages: z.array(z.object({ id: z.string().uuid(), text: z.string().max(4000), at, attachments: z.array(z.string().uuid()).max(5).optional() }).strict()).max(50) }).strict();
export const freezeDelivery = z.object({ id: z.string().uuid(), tenantId: id, reason: z.string().max(1000), startDate: z.string().max(10), days: z.number().int(), requestedAt: at }).strict();
export const syncRequest = z.object({
  v: z.literal(1), appVersion: z.string().max(40), sentAt: at,
  /** This computer: HMAC of the OS machine id under the install secret (licence copy detection). Older cafés send none. */
  machine: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  businesses: z.array(businessReport).max(50),
  /**
   * Backup health, times and yes/no only (no paths, no names). `lastAttemptAt` and `second` (the second backup place: set?,
   * last copy, failing) are sent only to a Merkez that listed 'backup.second' in `accepts`: an older Merkez refuses unknown fields.
   */
  backup: z.object({ enabled: z.boolean(), lastSuccessAt: at.nullable(), failing: z.boolean(), lastAttemptAt: at.nullable().optional(),
    second: z.object({ set: z.boolean(), lastCopyAt: at.nullable(), failing: z.boolean() }).strict().optional() }).strict(),
  failures: z.array(failureReport).max(100),
  tickets: z.array(ticketDelivery).max(50),
  freezes: z.array(freezeDelivery).max(20),
  /**
   * Otomatik güncelleme (server/update-agent.ts): this computer's package kind and where its update stands. Sent only to a Merkez
   * that listed 'update' in `accepts`. `error`: the café's own short Turkish reason (disk full, signature, rolled back…).
   */
  update: z.object({ platform: z.enum(PLATFORMS), state: z.enum(['idle', 'downloading', 'ready', 'installing', 'installed', 'failed', 'rolled_back']), release: z.string().max(60).optional(), version: z.string().max(60).optional(),
    progress: z.number().int().min(0).max(100).optional(), error: z.string().max(300).optional(), at, idleInstall: z.boolean().optional() }).strict().optional(),
  /**
   * Tanıtım işletmesi (server/demo-reset.ts): the outcome of each demo reset done on this computer (Mola Yönetim's signed order or
   * the owner's own), ids, yes/no, a short Turkish reason and the template only. Sent only to a Merkez that listed 'demo'.
   */
  demo: z.array(z.object({ tenantId: id, resetId: z.string().uuid(), ok: z.boolean(), error: z.string().max(300).optional(), at, by: z.enum(['merkez', 'owner']), sector: z.enum(sectors) }).strict()).max(20).optional(),
  /**
   * Sahibin uzaktan yönetimi (server/remote-admin.ts): that a remote owner session started or ended, when and why it ended.
   * Ids and times only: no device name, no address, nothing of what was done. Sent only to a Merkez that listed 'remote_admin'
   * (Mola Merkez's İşlem kayıtları).
   */
  remoteAdmin: z.array(z.object({ tenantId: id, session: z.string().uuid(), event: z.enum(['start', 'end']), at, reason: z.enum(['logout', 'owner', 'off', 'device', 'expired', 'ended', 'restart']).optional() }).strict()).max(50).optional(),
  /** Mola Lisans Sözleşmesi: acceptances Merkez has not confirmed yet (per business). Sent only to a Merkez that listed 'agreement'. */
  agreements: z.array(z.object({ tenantId: id, ...agreementShape }).strict()).max(50).optional(),
  /** Program dosyaları denetimi (server/integrity.ts): file names only, never contents. Sent only to a Merkez that listed 'integrity'. */
  integrity: integrityReport.optional(),
  /**
   * Duyurular (server/merkez/announcements.ts): the announcements this café has (id and version: Merkez sends in full only the
   * new or edited ones) and who opened them (owner or Müdür, when; the owner's "Okudum" on an Önemli one). Sent only to a Merkez
   * that listed 'announcements'; its presence is also what makes Merkez answer with `announcements` (older cafés never ask).
   */
  announcements: z.object({
    known: z.array(z.object({ id: z.string().uuid(), v: z.number().int().min(1).max(1_000_000) }).strict()).max(200),
    reads: z.array(z.object({ tenantId: id, id: z.string().uuid(), readAt: at, by: z.enum(['owner', 'manager']), ackAt: at.optional() }).strict()).max(200),
  }).strict().optional(),
  /**
   * Sosyal medya (6 Ekim): each business's public social links and Google review link, as the guest menu shows them (public
   * links, nothing else). Merkez keeps them for the permanent QR codes' short addresses (`<Merkez>/s/<code>/<platform>`) and
   * answers with each business's code. Sent only to a Merkez that listed 'social'; older cafés send none (no short codes).
   */
  social: z.array(z.object({ tenantId: id, links: z.record(z.string().max(20), z.string().max(2048)) }).strict()).max(50).optional(),
  /**
   * İnternetten menü (7 Ekim): "this café serves its guest menu through Mola Merkez" (server/guest-tunnel.ts). Nothing but the
   * version; Merkez answers with each business's menu code (`tunnel`). Sent only to a Merkez that listed 'guest.tunnel'.
   */
  tunnel: z.object({ v: z.literal(1) }).strict().optional(),
  /**
   * "İşletmem var" (13 Ekim): each business owner's username and a scrypt verifier of the password (its own salt; it cannot
   * open anything, the backup's owner block uses another salt). Merkez checks a sign-in on a new computer with it and sends
   * a one-time code to the business's e-mail. Sent only to a Merkez that listed 'owner.login'.
   */
  owners: z.array(z.object({ tenantId: id, username: z.string().min(1).max(50), stamp: z.string().regex(/^[a-f0-9]{8,64}$/),
    verifier: z.object({ salt: z.string().regex(/^[A-Za-z0-9+/=]{16,64}$/), N: z.number().int(), r: z.number().int(), p: z.number().int(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict() }).strict()).max(50).optional(),
}).strict();
export type SyncRequest = z.infer<typeof syncRequest>;
export type BusinessReport = z.infer<typeof businessReport>;
export type FailureReport = z.infer<typeof failureReport>;
/**
 * `pulse`: Merkez's signed "nabız" (server/license.ts); older Merkez versions send none and older cafés ignore it.
 * `removed`: signed "kapanış" of businesses of this install the vendor deleted (after suspending them); older cafés ignore it
 * and stay locked by their suspended licence.
 */
export type SyncResponse = { v: 1; serverTime: string; licenses: SignedLicense[]; tickets: Ticket[]; delivered: { messages: string[]; freezes: string[] }; next: number; pulse?: SignedPulse; removed?: SignedRemoval[];
  /** "Mola ekibi iletişim bilgileri", signed; missing until the vendor fills it in (and from older Merkez versions). */
  contact?: SignedContact;
  /** Optional request fields this Merkez understands (MERKEZ_ACCEPTS); the café sends them only then. */
  accepts?: string[];
  /** Otomatik güncelleme: the release for this café (null: none, or the vendor stopped it); missing from an older Merkez. */
  update?: UpdateOffer | null;
  /** Tanıtım işletmesi: signed per business of this install the vendor ever marked (server/signed-notes.ts mola-tanitim-1). */
  demo?: SignedDemo[];
  /** "Merkez adresi": Mola Merkez moved; signed (mola-adres-1). The café switches only after the new address proves itself. */
  address?: SignedAddress;
  /** Program dosyaları denetimi: the signed release of the café's own version and platform, only when its report asked (`need`). */
  integrityManifest?: SignedRelease;
  /**
   * Duyurular, only for a café that sent `announcements`: every live one for this computer's businesses (`active`, id and
   * version) and in full only those the café does not have at that version. One the café has but `active` does not name was
   * withdrawn. Missing (an older Merkez, or the café did not ask): the café keeps what it has.
   */
  announcements?: { active: { id: string; v: number }[]; items: AnnouncementDelivery[] };
  /**
   * Sosyal medya, only for a café that sent `social`: each of those businesses' short-address code (given once, never changed)
   * and, when Merkez runs behind its public HTTPS address, that address (the café uses its own Merkez address otherwise).
   */
  social?: { base?: string; codes: { tenantId: string; code: string }[] };
  /**
   * İnternetten menü, only for a café that sent `tunnel`: each of its businesses' menu code (given once, never changed) and the
   * public address the table QR codes should hold (MERKEZ_SITE_ORIGIN, else PUBLIC_ORIGIN; missing: the café's Merkez address).
   */
  tunnel?: { base?: string; codes: { tenantId: string; code: string }[] } };
/** A release Merkez offers one café: its signed manifest and archive come from /releases/:id/manifest and /paket. */
export type UpdateOffer = { id: string; version: string; size: number; notes: string };
/** Optional heartbeat fields of this version: an older Merkez (strict schema) never lists them, so it never gets them. */
// 'ticket.attachments': a message may name files already uploaded to /attachments (destek ekleri). 'demo': demo reset results.
// 'remote_admin': the start and end of the owner's remote sessions (times only), for İşlem kayıtları.
// 'cloud.backup': this Merkez keeps encrypted backup copies (/cloud-backup, server/merkez/backup-vault.ts); older ones are not asked.
// 'agreement': Mola Lisans Sözleşmesi acceptances; 'integrity': the program files check (both optional both ways).
// 'announcements': Duyurular (the café's versions and read marks up, the announcements down).
// 'cloud.backup.binary': this Merkez takes sunucu yedeği pieces as raw bytes (/cloud-backup/chunk-bin); older ones get base64 JSON.
// 'social': the businesses' public social links up, their short-address codes down (Merkez's /s/<code>/<platform>).
// 'features.social' (FEATURES_SOCIAL): not a request field but a promise: this Merkez's licences decide 'social' (paid since 6 Ekim);
// a café keeps it on under a licence from a Merkez that does not say so (server/kafe-link.ts listedFeatures).
// 'guest.tunnel': İnternetten menü: this Merkez takes the cafés' guest tunnels (/api/merkez/v1/tunnel) and answers /q/<kod>/…;
// the café asks for its menu codes (`tunnel`) and prints table QR codes with the public address only then.
// 'menu.mirror' (8 Ekim): this Merkez keeps the cafés' guest-visible menu copies (POST /api/merkez/v1/menu, /menu/photo) and serves
// the menu from them while a café is away; the café sends QR ordering state over the tunnel (status).
/**
 * Not in MERKEZ_ACCEPTS: listed only by a Merkez whose guest menu runs on its own name (MERKEZ_MENU_ORIGIN; 11 Ekim,
 * server/merkez/menu-host.ts). Its `tunnel.base` is then that name; the café prints table QR codes with it and never with
 * Merkez's own address.
 */
export const MENU_ORIGIN_FLAG = 'guest.menu-origin';
// 'owner.login' (13 Ekim): this Merkez keeps the owners' password verifiers (`owners`) for "İşletmem var" on a new computer;
// 'owner.email' (13 Ekim): it keeps a verified e-mail per business for İşletmem var (POST /owner-email/*, server/merkez/owner-login.ts).
export const MERKEZ_ACCEPTS = ['backup.second', 'update', 'ticket.attachments', 'demo', 'remote_admin', 'cloud.backup', 'agreement', 'integrity', 'announcements', 'cloud.backup.binary', 'social', FEATURES_SOCIAL, 'guest.tunnel', 'menu.mirror', 'owner.login', 'owner.email'];
/** Activation answer: the install credentials (kept only on the café computer, sealed) and the first signed licence. */
export type ActivationResult = { installId: string; secret: string; tenantId: string; name: string; sector?: typeof sectors[number]; license: SignedLicense; serverTime: string };
// ---------- Hesap açma başvurusu ----------
// Invoice data travels only here (and in the vendor's own edits), never with the heartbeat.
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const invoiceSchema = z.object({
  legalName: text(3, 200), taxOffice: text(2, 60), taxType: z.enum(['company', 'person']), taxNumber: z.string().trim().regex(/^\d{10,11}$/),
  city: text(2, 40), district: text(2, 60), address: text(5, 300), phone: z.string().max(30), email: z.string().max(120),
}).strict().superRefine((v, ctx) => {
  if (!validTaxNumber(v.taxType, v.taxNumber)) ctx.addIssue({ code: 'custom', path: ['taxNumber'], message: v.taxType === 'company' ? 'Vergi kimlik numarası geçersiz.' : 'T.C. kimlik numarası geçersiz.' });
  if (!normalPhone(v.phone)) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Cep telefonu numarası geçersiz.' });
  if (!validEmail(v.email)) ctx.addIssue({ code: 'custom', path: ['email'], message: 'E-posta adresi geçersiz.' });
}).transform((v): Invoice => ({ ...v, phone: normalPhone(v.phone), email: normalEmail(v.email) }));
export const applicationForm = z.object({ businessName: text(2, 80), sector: z.enum(sectors), contactName: text(2, 80), consent: z.literal(true), invoice: invoiceSchema }).strict();
export type ApplicationForm = z.infer<typeof applicationForm>;
/** Merkez's answer to a submitted or polled application; `activation` once the vendor started the trial. */
export type ApplicationAnswer = { status: 'pending' | 'rejected'; name: string; submittedAt: string; reason?: string; decidedAt?: string }
  | { status: 'approved'; name: string; submittedAt: string; activation: ActivationResult };
export const MERKEZ_API = '/api/merkez/v1';
/** Both sides say the same thing when a café package was built for another Mola Yönetim (another signing key). */
export const KEY_MISMATCH = 'Bu kurulumun Merkez anahtarı farklı; kurulum paketi bu Mola Yönetim için üretilmeli.';
