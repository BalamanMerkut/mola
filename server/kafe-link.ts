import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { hostname, networkInterfaces, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { DomainError } from '../packages/domain/engine.js';
import type { Sector } from '../packages/domain/sector.js';
import { AGREEMENT_VERSION, type AgreementAcceptance } from '../packages/domain/agreement.js';
import { ANNOUNCEMENT_TEXT_MAX, ANNOUNCEMENT_TITLE_MAX, announcementText, announcementTitle, type AnnouncementDelivery, type AnnouncementRead, type AnnouncementReader } from '../packages/domain/announcement.js';
import type { State } from '../packages/domain/types.js';
import { closedFeatures, enabledFeatures, FEATURES_SOCIAL, hasFeature, isFeatureId, packageName, type FeatureId, type PackageView } from '../packages/domain/feature-gate.js';
import { HEADER, responseSignature, sameSignature, signedHeaders } from './install-auth.js';
import { writeAtomic } from './key-vault.js';
import { requestFreeze } from './license-freeze.js';
import { APP_VERSION, claimsToLicense, DEV_MERKEZ_URL, emptyContact, keyFingerprint, licenseSummary, merkezPublicKey, showFingerprint, verifyContact, verifyLicense, verifyPulse, verifyRemoval, type ContactClaims, type ContactInfo, type License, type LicenseClaims, type PulseClaims, type SignedLicense, type SignedPulse, type SignedRemoval, type Ticket, type TicketMessage, type AttachmentRef } from './license.js';
import { runQuiet } from './os-lock.js';
import { open, seal } from './sealing.js';
import { starterState } from './starter-template.js';
import type { StaffUser } from './accounts.js';
import type { Store } from './store.js';
import { SOCIAL_CODE } from '../packages/domain/social-links.js';
import { merkezAddress, verifyNote, type DemoClaims, type DemoReset, type DemoSector, type SignedAddress, type SignedDemo } from './signed-notes.js';
import { KEY_MISMATCH, MENU_ORIGIN_FLAG, MERKEZ_API, privateLanOrigin, type ActivationResult, type ApplicationAnswer, type ApplicationForm, type BusinessReport, type FailureReport, type SyncRequest, type SyncResponse, type UpdateOffer } from './sync-protocol.js';

/*
 * The café's link to Mola Merkez ("Kafe" role). One sealed row in merchant.sqlite (table merkez_link, sealed with the data
 * key, so it is protected exactly like the data: DPAPI/Keychain + recovery code when key protection is on):
 *   install id + secret      from activation; sign every request to Merkez (server/install-auth.ts)
 *   licences                 the latest signed licence per business, verified with Merkez's public key on every use
 *   tickets, freeze requests written here first and delivered with the next heartbeat (retried until Merkez confirms)
 * Before that, table merkez_activation holds the activation ids every try reuses and the "Hesap açma başvurusu" while it
 * waits for the vendor (gone once activation succeeds).
 * Licence rules are enforced only from a verified licence: a missing, forged, edited or foreign licence means closed
 * (menu and new orders); staff can still settle open bills and reach support. Offline, the last licence holds until it ends,
 * but at most OFFLINE_DAYS after the last contact with Merkez (its signed "nabız"); a warning shows from WARN_DAYS on.
 * Licence time never runs backwards: the latest of this computer's clock, Merkez's last time, staff activity and the
 * newest order/payment, kept in the record and in a sealed mark file beside the data folder (lisans-izi/, never in a
 * backup) together with the highest licence serials, so an old backup cannot bring back an older licence.
 * When Merkez says another computer now holds this install ("replaced"), menu and ordering close here too.
 * The old in-process platform record (table `platform`) is never read or deleted here.
 * PHASE M2 seam: `supportAccess` (owner-granted, revocable remote support for a server-enforced 'support' role that can never
 * read money) belongs in this record and in SyncRequest. Otomatik güncelleme rides on the heartbeat (`updates`, below;
 * server/update-agent.ts): its state goes up, Merkez's offer comes back, and `signedGet` fetches the signed release.
 */
export type LinkTicket = Omit<Ticket, 'messages'> & { messages: (TicketMessage & { queued?: true })[] };
export type QueuedFreeze = { id: string; tenantId: string; reason: string; startDate: string; days: number; requestedAt: string };
export type PendingBusiness = { tenantId: string; name: string; sector?: Sector };
/** The application as this computer last heard of it; `form` refills "Bilgileri düzelt". `error`: the last check failed. */
export type CafeApplication = { status: 'pending' | 'rejected'; name: string; submittedAt: string; reason?: string; decidedAt?: string; checkedAt?: string; error?: string; form: ApplicationForm };
/** Table merkez_activation (one sealed row, only until activation succeeds): see MerkezLink.activationTicket. */
export type PendingActivation = { v: 1; activationId: string; installId: string; createdAt: string; application?: CafeApplication;
  /** Mola Lisans Sözleşmesi, accepted on the activation screen; `sent`: the activation request that Merkez took carried it. */
  agreement?: AgreementAcceptance & { sent?: boolean } };
export type LinkRecord = {
  v: 1; installId: string; secret: string; activatedAt: string;
  licenses: Record<string, SignedLicense>;
  /** Activated at Merkez; the owner account is not made yet (onboarding step 2). */
  pending: PendingBusiness[];
  tickets: LinkTicket[]; freezes: QueuedFreeze[];
  requests: Record<string, { fingerprint: string; at: string; result: unknown }>;
  /** Failure records up to this time (ms) have been delivered. */
  failuresSentAt: number;
  lastSync?: { at: string; ok: boolean; error?: string }; lastSuccessAt?: string;
  /** Merkez's clock at the last answer: licence time never runs behind it, so turning the computer's clock back does not help. */
  serverTime?: string;
  /** The newest signed "nabız" from Merkez: the last contact the offline limit counts from. */
  pulse?: SignedPulse;
  /** The latest licence time this install has seen (ms); see licenseNow(). */
  highWater?: number;
  /** Merkez's clock minus this computer's at the last answer (ms), for the "saat farklı" warning. */
  skewMs?: number;
  /** Merkez's signed "kaydı kapatıldı" per business (deleted by the vendor after suspension): final, the business stays locked. */
  removed?: Record<string, SignedRemoval>;
  /** Optional heartbeat fields the Merkez said it understands (SyncResponse.accepts); none until then (older Merkez). */
  accepts?: string[];
  firstOwnerLogin: Record<string, string>;
  audit: { action: string; at: string }[];
  /** "Tanıtım işletmesi" (server/signed-notes.ts mola-tanitim-1): Merkez's newest signed word per business; `demoDone`: reset ids
   * already carried out (each one once); `demoReports`: their results, waiting for the next heartbeat. */
  demo?: Record<string, SignedDemo>; demoDone?: string[]; demoReports?: DemoReport[];
  /** Sahibin uzaktan yönetimi: session starts/ends (ids and times only) waiting for the next heartbeat (Merkez's İşlem kayıtları). */
  remoteAdminReports?: RemoteAdminReport[];
  /** Hizmet paketi: "deneme bitti, şu hizmetler kapandı" per business, kept until the owner closes it (`seenAt`). */
  packageNotices?: Record<string, { id: string; closed: FeatureId[]; at: string; seenAt?: string }>;
  /** "Merkez adresi": the address Mola Merkez moved to, used instead of the package's MOLA_MERKEZ_URL once it proved itself. */
  merkezUrl?: string;
  /** The newest signed announcement and how checking it went ('switched', or the last error while it is not proven). */
  address?: { signed: SignedAddress; url: string; issuedAt: string; state: 'checking' | 'failed' | 'switched'; error?: string; checkedAt?: string; from?: string };
  /**
   * Mola Lisans Sözleşmesi per business (packages/domain/agreement.ts): the newest acceptance; `sent` once Merkez has it (the
   * activation carried it, or a heartbeat to a Merkez that listed 'agreement').
   */
  agreements?: Record<string, AgreementAcceptance & { sent?: boolean }>;
  /** Duyurular from Mola Merkez (this computer's businesses only; a withdrawn one goes with the next heartbeat). */
  announcements?: AnnouncementDelivery[];
  /**
   * Per business and announcement: the first opening here (owner or Müdür) and the owner's "Okudum" (Önemli), told to Merkez
   * once (`sent`); `seenBy`: the accounts that opened it, for each one's own red dot.
   */
  announcementReads?: Record<string, Record<string, AnnouncementRead & { sent?: boolean; seenBy: string[] }>>;
  /**
   * Sosyal medya: Merkez's short-address code per business (given once, never changed) and its public address when it named
   * one; the permanent social QR codes hold `<base>/s/<code>/<platform>` (packages/domain/social-links.ts socialShortUrl).
   * `sent`: the links Merkez last confirmed per business (JSON), so the QR screen knows they have arrived.
   */
  social?: { base?: string; codes: Record<string, string>; sent?: Record<string, string> };
  /**
   * İnternetten menü (server/guest-tunnel.ts): Merkez's menu code per business (given once, never changed) and its public address
   * when it named one; the table QR codes hold `<base>/q/<code>/<masa kodu>` (else the café's Merkez address).
   */
  tunnel?: { base?: string; codes: Record<string, string> };
  /**
   * Kalıcı bağlantı (server/merkez/lan-link.ts): Merkez's `/k/<code>` per business (given once, never changed) and its public
   * address when it named one: `<base>/k/<code>` opens this computer's Mola on the café's network whatever its address is.
   */
  lanLink?: { base?: string; codes: Record<string, string> };
  /** Businesses for which a licence with `features` was accepted here once (see LEGACY_LICENCE_UNTIL); also kept in the mark. */
  withFeatures?: Record<string, true>;
};
/**
 * Güvenlik denetimi O6 (11 Ekim): Mola Merkez no longer signs a licence copy without `features` (it used to sign one for café
 * versions from before packaging, with the same serial). A licence without `features` means "every service" only when it was
 * issued before this moment (Türkiye midnight) AND no licence with `features` was ever accepted here for that business; any
 * other one (a stripped copy written into the data by hand) opens the core only. An old install keeps all its services until
 * its next heartbeat brings the licence with its list (Merkez signs every licence again once: server/merkez/catalog.ts step 3).
 */
export const LEGACY_LICENCE_UNTIL = Date.parse('2026-10-12T00:00:00+03:00');
/** A demo reset carried out here, told to Merkez with the next heartbeat (`by`: Mola Yönetim's order or the owner's own). */
export type DemoReport = { tenantId: string; resetId: string; ok: boolean; error?: string; at: string; by: 'merkez' | 'owner'; sector: DemoSector };
/** A remote owner session started or ended (server/remote-admin.ts); told to Merkez with the next heartbeat. */
export type RemoteAdminReport = { tenantId: string; session: string; event: 'start' | 'end'; at: string; reason?: 'logout' | 'owner' | 'off' | 'device' | 'expired' | 'ended' | 'restart' };
/** Sealed file outside the data folder (and so outside every backup): what an old backup must not undo. */
type Mark = { v: 1; installId: string; highWater: number; pulseAt: number; serials: Record<string, number>; withFeatures?: string[] };
export const OFFLINE_DAYS = 14, WARN_DAYS = 7, CLOCK_WARN_MS = 10 * 60_000;
/** What the owner reads once the vendor deleted the business's record (the panel banner and Destek). */
export const REMOVED_NOTICE = 'Bu işletmenin Mola kaydı kapatıldı. Yeniden başlamak için Mola ekibiyle görüşün.';
/** Mola suspended the service ("Askıya al" in Mola Yönetim): what the owner and the staff read. */
export const SUSPENDED_NOTICE = 'Bu işletmenin hizmeti Mola tarafından durduruldu. Mola ekibiyle görüşün.';
/** A closed install asks Merkez once a day only (nothing will change; no busy retrying). */
const CLOSED_MS = 24 * 3600_000;
/** A "Tanıtımı sıfırla" order older than this (the café was off all along) is not carried out: the vendor asks again. */
const DEMO_ORDER_DAYS = 3;
/** Automatic heartbeats at most every 2.5 s: 24 a minute, under Merkez's 30 per install (see MerkezLink.beat). */
const AUTO_GAP_MS = 2500;
const DAY = 86400000;
/** "12 dakika ileri", "3 saat geri", "2 gün ileri": this computer's clock against Merkez's. */
export function skewText(skewMs: number) {
  const ahead = skewMs < 0, m = Math.round(Math.abs(skewMs) / 60_000);
  const amount = m < 120 ? `${m} dakika` : m < 2880 ? `${Math.round(m / 60)} saat` : `${Math.round(m / 1440)} gün`;
  return `${amount} ${ahead ? 'ileri' : 'geri'}`;
}
let machineRaw: Promise<string> | undefined;
/**
 * The operating system's own id of this installation (Windows MachineGuid, Linux machine-id, Mac IOPlatformUUID): stable
 * across network changes, renames and Mola updates; another computer (or a reinstalled Windows) has another one.
 * Never sent as it is: the heartbeat carries only an HMAC of it under the install secret.
 */
export function machineKey(): Promise<string> {
  return machineRaw ??= (async () => {
    try {
      if (process.platform === 'win32') {
        const { out } = await runQuiet('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], '', 10_000);
        const m = /MachineGuid\s+REG_SZ\s+([0-9a-f-]{36})/i.exec(out); if (m) return `win:${m[1].toLowerCase()}`;
      } else if (process.platform === 'darwin') {
        const { out } = await runQuiet('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], '', 10_000);
        const m = /"IOPlatformUUID"\s*=\s*"([0-9a-f-]{36})"/i.exec(out); if (m) return `mac:${m[1].toLowerCase()}`;
      } else for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try { const id = readFileSync(file, 'utf8').trim(); if (/^[a-f0-9]{32}$/.test(id)) return `linux:${id}`; } catch { /* next */ }
      }
    } catch { /* fall back to the name */ }
    return `name:${hostname()}`;
  })();
}
/** What the café reports about itself; app.ts fills it from the data it already has (never orders, payments or menus). */
export type Reporter = { businesses(): Omit<BusinessReport, 'lastActivityAt' | 'firstOwnerLoginAt'>[]; backup(): SyncRequest['backup']; failures(since: number): FailureReport[];
  /** Sosyal medya: each business's public links (the guest menu's, Google review included) for Merkez's short QR addresses. */
  social?(): NonNullable<SyncRequest['social']>;
  /** "İşletmem var" (13 Ekim): each business owner's username and password verifier (never the password, never a key). */
  owners?(): NonNullable<SyncRequest['owners']>;
  /** Kalıcı bağlantı: the addresses Mola is served on in the café's network (none while it is open to this computer only). */
  lan?(): string[];
  /** Raporlarım giriş (0.1.22): each business's public key and whether the owner has the phone code (server/remote-reports.ts). */
  remote?(): NonNullable<SyncRequest['remote']> };
/** 'applied': an application waits for the vendor (or was refused); nothing else works until it is approved. */
export type LinkState = 'activate' | 'applied' | 'owner' | 'ready';
/** machineKey: tests stand in another computer (default: machineKey()). */
export type LinkOptions = { now?: () => Date; url?: string; publicKey?: KeyObject; fetch?: typeof fetch; machineId?: string; machineKey?: string };
// MOLA_HEARTBEAT_MS: browser tests only, so a vendor's change reaches the test café in seconds instead of ten minutes.
const HEARTBEAT_MS = Number(process.env.MOLA_HEARTBEAT_MS) || 600_000, RETRIES = [30_000, 60_000, 120_000, 300_000, 600_000].map(ms => Math.min(ms, HEARTBEAT_MS));
const UNREACHABLE = 'Mola Merkez’e ulaşılamadı. İnternet bağlantısını kontrol edip yeniden deneyin.';
/**
 * Why Merkez could not be reached, told apart so the owner knows what to do: no internet here ('offline'), Merkez not answering
 * ('down'), a wrong or refusing address: DNS, TLS certificate, Host refused, not a Merkez, a captive Wi-Fi page ('address'),
 * this computer's clock ('clock': certificates "expired" or "not yet valid", signed requests outside the time window).
 */
export type MerkezProblem = 'offline' | 'down' | 'address' | 'clock';
const ADDRESS = 'Bu kurulumdaki Merkez adresi yanlış olabilir; Mola ekibiyle görüşün.';
export function merkezProblem(kind: MerkezProblem, detail: 'dns' | 'tls' | 'foreign' | 'skew' | number = 0) {
  const [code, message] = kind === 'offline' ? ['MERKEZ_OFFLINE', 'İnternet bağlantısı yok: Mola Merkez’e ulaşılamadı. Modemi, kabloyu ya da Wi-Fi bağlantısını kontrol edip yeniden deneyin.']
    : kind === 'down' ? ['MERKEZ_UNREACHABLE', 'Mola Merkez’e ulaşılamadı: Merkez şu anda yanıt vermiyor. İnternetiniz çalışıyorsa birkaç dakika sonra yeniden deneyin; sürerse Mola ekibine haber verin.']
    : kind === 'clock' ? ['MERKEZ_CLOCK', `${detail === 'skew' ? 'Bilgisayarın saati Mola Merkez’in saatinden çok farklı' : 'Mola Merkez’le güvenli bağlantı kurulamadı: bilgisayarın tarihi veya saati yanlış görünüyor'}. Windows’ta Ayarlar → Saat ve dil → “Saati otomatik olarak ayarla”yı açıp yeniden deneyin.`]
    : ['MERKEZ_ADDRESS', detail === 'dns' ? 'Mola Merkez’in adresi bulunamadı. İnternet bağlantınızı kontrol edin; internet çalışıyorsa bu kurulumdaki Merkez adresi yanlış olabilir, Mola ekibiyle görüşün.'
      : detail === 'tls' ? `Mola Merkez’le güvenli bağlantı kurulamadı (güvenlik sertifikası doğrulanamadı). ${ADDRESS}`
      : detail === 'foreign' ? 'Bu adreste yanıt veren sunucu Mola Merkez değil. Kablosuz ağ önce bir giriş sayfası istiyorsa tarayıcıda açıp onaylayın; yoksa bu kurulumdaki Merkez adresi yanlış olabilir, Mola ekibiyle görüşün.'
      : detail === 404 ? 'Mola Merkez bu işlemi tanımıyor (yanıt 404): Mola Yönetim güncel değil ya da bu kurulumdaki Merkez adresi yanlış. Mola ekibiyle görüşün.'
      : `Mola Merkez bağlantıyı reddetti${detail ? ` (yanıt ${detail})` : ''}. ${ADDRESS}`];
  return new DomainError(code, message, 503);
}
/** Error codes anywhere in a fetch failure's cause chain (undici wraps them; a dual-stack connect wraps several). */
function causeCodes(error: unknown, depth = 0): string[] {
  if (!error || typeof error !== 'object' || depth > 5) return [];
  const e = error as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown };
  return [...(typeof e.code === 'string' ? [e.code] : []), ...(e.name === 'TimeoutError' ? ['TIMEOUT'] : []), ...causeCodes(e.cause, depth + 1), ...(Array.isArray(e.errors) ? e.errors.flatMap(x => causeCodes(x, depth + 1)) : [])];
}
/** Some network besides loopback (a cable or Wi-Fi with an address); false: this computer is not connected at all. */
export function hasNetwork() {
  return Object.values(networkInterfaces()).flat().some(i => !!i && !i.internal && (i.family === 'IPv4' ? !i.address.startsWith('169.254.') : !/^fe80/i.test(i.address)));
}
/**
 * İnternetten menü: may the table QR codes hold this Mola Merkez address? Only an https address of a public name (Merkez on
 * the VDS: MERKEZ_SITE_ORIGIN or PUBLIC_ORIGIN, or the café's https Merkez address): a guest's phone on mobile data can open
 * it. A Merkez on this computer or the café's network (Mola Yönetim before the VDS, http://127.0.0.1:4000, 192.168.x.x, a
 * name without a dot or of a local zone) is not: the QR codes keep the café's Wi-Fi address instead.
 * Browser tests only (MOLA_TEST_TUNNEL=1 from scripts/test-server.mjs; never in a release build): their Merkez on 127.0.0.1
 * and its menu name http://menu.localhost:<port> (MERKEZ_MENU_ORIGIN, server/merkez/menu-host.ts).
 */
const sameHost = (a: string, b: string) => { try { return new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase(); } catch { return false; } };
const testTunnel = () => process.env.MOLA_TEST_TUNNEL === '1' && process.env.MOLA_RELEASE_BUILD !== '1';
/** The heartbeat's menu address (`tunnel.base`): a Merkez address, or (browser tests only) an http *.localhost menu name. */
function menuBaseAddress(base: unknown) {
  if (typeof base !== 'string') return undefined;
  const parsed = merkezAddress.safeParse(base);
  if (parsed.success) return parsed.data;
  try { const u = new URL(base); if (testTunnel() && u.protocol === 'http:' && u.hostname.endsWith('.localhost') && /^http:\/\/[^/]+\/?$/.test(base)) return u.origin; } catch { /* not an address */ }
  return undefined;
}
export function publicMenuBase(base: string) {
  let url: URL; try { url = new URL(base); } catch { return false; }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (testTunnel() && (['localhost', '127.0.0.1', '::1'].includes(host) || host.endsWith('.localhost'))) return true;
  if (url.protocol !== 'https:' || !host) return false;
  const ip = isIP(host);
  if (ip === 4) {
    const [a, b] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224);
  }
  // IPv6: loopback, unspecified, unique local (fc00::/7), link-local (fe80::/10) and IPv4-mapped addresses are not public.
  if (ip === 6) return !(host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:'));
  return host.includes('.') && !/(^|\.)(localhost|local|lan|home|internal|intranet|corp|test|invalid|example|home\.arpa)$/.test(host);
}
/** A failed fetch to Merkez, classified. `online`: tests stand in a disconnected computer. */
export function networkProblem(error: unknown, url: string, online = hasNetwork()) {
  const codes = causeCodes(error), has = (re: RegExp) => codes.some(c => re.test(c));
  let local = false; try { local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname.toLowerCase()); } catch { /* checked before */ }
  if (has(/^(CERT_NOT_YET_VALID|CERT_HAS_EXPIRED)$/)) return merkezProblem('clock');
  if (has(/CERT|SSL|TLS|EPROTO|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/)) return merkezProblem('address', 'tls');
  if (!local && !online) return merkezProblem('offline');
  if (!local && has(/^EAI_AGAIN$/)) return merkezProblem('offline');
  if (has(/^ENOTFOUND$/)) return merkezProblem('address', 'dns');
  return merkezProblem('down');
}
const CONTACT_FILE = 'mola-iletisim.json';
/**
 * The vendor's contact as this café last heard it, from the signed copy beside the data (mola-iletisim.json): readable without
 * the data key, so the locked screen can show it too. Anything our Merkez key did not sign is ignored.
 */
export function readSavedContact(directory: string, key: KeyObject | undefined): ContactClaims | undefined {
  if (!key) return undefined;
  try { return verifyContact(JSON.parse(readFileSync(join(directory, CONTACT_FILE), 'utf8')), key); } catch { return undefined; }
}
/** One plain line for text-only places (the panel's licence banner). */
export const contactLine = (c: ContactInfo) => `Mola ekibi: ${[c.phone && `Tel. ${c.phone}`, c.whatsapp && `WhatsApp ${c.whatsapp}`, c.email, c.web, c.hours && `(${c.hours})`].filter(Boolean).join(' · ')}`;
function fingerprint(body: unknown) { return createHash('sha256').update(JSON.stringify(body)).digest('hex'); }
/** A stable, one-way id of this computer (not reversible to a name): Merkez lists repeated trials from the same machine. */
export function machineId() {
  let user = ''; try { user = userInfo().username; } catch { /* no user info */ }
  const mac = Object.values(networkInterfaces()).flat().find(i => i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')?.mac ?? '';
  return createHash('sha256').update(['mola-makine:v1', hostname(), user, mac].join('\n')).digest('hex');
}

export class MerkezLink {
  private cache: LinkRecord | null | undefined;
  private verified = new Map<string, { signature: string; claims: LicenseClaims }>();
  private activity = new Map<string, string>();
  private key: KeyObject | undefined; private skew = 0; private skewKnown = false;
  private inflight?: Promise<{ ok: boolean; error?: string }>; private again = false; private activating = false;
  private timer?: NodeJS.Timeout; private auto = false; private failuresInRow = 0; private lastAttempt = 0; private failuresUntil = 0; private owed = false;
  reporter: Reporter = { businesses: () => [], backup: () => ({ enabled: false, lastSuccessAt: null, failing: false }), failures: () => [] };
  /** Otomatik güncelleme (server/update-agent.ts): reports its state with the heartbeat and hears Merkez's offer. */
  updates?: { report(): SyncRequest['update']; offer(offer: UpdateOffer | null): void };
  /** Program dosyaları denetimi (server/integrity.ts): its result goes up; Merkez's signed release (when asked) comes back. */
  integrity?: { report(): SyncRequest['integrity']; manifest(signed: unknown): unknown };
  readonly now: () => Date;
  constructor(private store: Store, private options: LinkOptions = {}) {
    this.now = options.now ?? (() => new Date());
    store.db.exec('CREATE TABLE IF NOT EXISTS merkez_link (id INTEGER PRIMARY KEY CHECK (id = 1), payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS merkez_activation (id INTEGER PRIMARY KEY CHECK (id = 1), payload BLOB NOT NULL)');
  }
  /** Merkez's address: the one it moved to and proved (signed announcement + same key, see `checkAddress`), else the package's. */
  get url() { return (this.read()?.merkezUrl ?? this.packageUrl).replace(/\/+$/, ''); }
  get packageUrl() { return (this.options.url ?? (process.env.MOLA_MERKEZ_URL || DEV_MERKEZ_URL)).replace(/\/+$/, ''); }
  /**
   * Install secrets, invoice details and licences travel to Merkez: over the network only with HTTPS. A Merkez on this
   * computer (127.0.0.1) is fine; one on another computer of a trusted LAN only with MOLA_MERKEZ_LAN=1 (set by the package).
   */
  private assertSecureUrl() {
    let url: URL; try { url = new URL(this.url); } catch { throw new DomainError('MERKEZ_URL', 'Mola Merkez adresi geçersiz. Destek ekibiyle görüşün.', 503); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    if (url.protocol !== 'https:' && !loopback && process.env.MOLA_MERKEZ_LAN !== '1') throw new DomainError('MERKEZ_INSECURE', 'Mola Merkez adresi güvenli değil (https değil). Bu kurulum yerel ağdaki bir Merkez için hazırlanmadı; destek ekibiyle görüşün.', 503);
  }
  publicKey() { return this.key ??= this.options.publicKey ?? merkezPublicKey(); }
  read(): LinkRecord | null {
    if (this.cache === undefined) {
      const row = this.store.db.prepare('SELECT payload FROM merkez_link WHERE id=1').get() as { payload: Uint8Array } | undefined;
      this.cache = row ? open<LinkRecord>(Buffer.from(row.payload), this.store.key, 'merkez-link') : null;
    }
    return this.cache;
  }
  /** Writes inside a transaction the caller already holds (with a business snapshot, for example). */
  private saveIn(record: LinkRecord) {
    const now = this.now().getTime();
    for (const [k, r] of Object.entries(record.requests)) if (Date.parse(r.at) < now - 7 * 86400000) delete record.requests[k];
    if (record.audit.length > 200) record.audit = record.audit.slice(-200);
    if (record.tickets.length > 300) record.tickets = record.tickets.slice(-300);
    this.store.db.prepare('INSERT INTO merkez_link (id,payload) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(seal(record, this.store.key, 'merkez-link'));
  }
  private write<T>(fn: (record: LinkRecord) => T): T {
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.cache = undefined; const current = this.read();
      if (!current) throw new DomainError('NOT_ACTIVATED', 'Mola bu bilgisayarda henüz etkinleştirilmedi.', 409);
      const record = structuredClone(current), result = fn(record);
      this.saveIn(record); this.store.db.exec('COMMIT'); this.cache = record; return result;
    } catch (e) { this.store.db.exec('ROLLBACK'); this.cache = undefined; throw e; }
  }
  private once<T>(record: LinkRecord, scope: string, body: { requestId: string }, fn: () => T): T {
    const k = `${scope}:${body.requestId}`, print = fingerprint(body), old = record.requests[k];
    if (old) { if (old.fingerprint !== print) throw new DomainError('CONFLICT', 'İşlem kimliği başka içerikle kullanıldı.', 409); return old.result as T; }
    const result = fn(); record.requests[k] = { fingerprint: print, at: this.now().toISOString(), result }; return result;
  }
  state(): LinkState { const r = this.read(); return !r ? (this.ticket()?.application ? 'applied' : 'activate') : r.pending.length ? 'owner' : 'ready'; }
  pending() { return this.read()?.pending[0]; }
  connection() { const r = this.read(); return { lastSyncAt: r?.lastSync?.at ?? null, ok: r?.lastSync?.ok ?? false, error: r?.lastSync?.ok ? null : r?.lastSync?.error ?? null, lastSuccessAt: r?.lastSuccessAt ?? null }; }

  // ---------- Licence ----------
  /** The verified claims of one business, or undefined: no licence, not signed by Merkez, edited, or for another install. */
  claims(tenant: string): LicenseClaims | undefined {
    const record = this.read(), signed = record?.licenses[tenant];
    if (!record || !signed) return undefined;
    const hit = this.verified.get(tenant);
    if (hit && hit.signature === signed.signature) return hit.claims;
    const key = this.publicKey(); if (!key) return undefined;
    try {
      const claims = verifyLicense(signed, key);
      if (claims.installId !== record.installId || claims.tenantId !== tenant) return undefined;
      // Older than one this computer already had (an old backup put back): not used; the next heartbeat brings the newest.
      if (claims.serial < (this.mark()?.serials[tenant] ?? 0)) return undefined;
      this.verified.set(tenant, { signature: signed.signature, claims }); return claims;
    } catch { return undefined; }
  }
  license(tenant: string): License | undefined { const c = this.claims(tenant); return c ? claimsToLicense(c) : undefined; }

  // ---------- Licence time, offline limit, the mark beside the data folder ----------
  private high = 0; private savedHigh = 0; private markCache?: { installId: string; mark: Mark | null }; private floor?: number;
  /** The newest verified pulse in the record (another install's, or a forged one, is ignored). */
  private pulseHit?: { signature: string; claims: PulseClaims | undefined };
  private pulse(record = this.read()): PulseClaims | undefined {
    const key = this.publicKey(); if (!record?.pulse || !key) return undefined;
    if (this.pulseHit?.signature === record.pulse.signature) return this.pulseHit.claims;
    let claims: PulseClaims | undefined;
    try { const p = verifyPulse(record.pulse, key); claims = p.installId === record.installId ? p : undefined; } catch { claims = undefined; }
    this.pulseHit = { signature: record.pulse.signature, claims }; return claims;
  }
  private markPath(installId: string) { return join(dirname(this.store.directory), 'lisans-izi', `${installId}.json`); }
  private markKey() { return Buffer.from(hkdfSync('sha256', this.store.key, Buffer.alloc(0), 'mola:lisans-izi:v1', 32)); }
  /** The mark of this install, or null (none yet, or unreadable: it is only ever a floor, never a requirement). */
  private mark(): Mark | null {
    const record = this.read(); if (!record) return null;
    if (this.markCache?.installId === record.installId) return this.markCache.mark;
    let mark: Mark | null = null;
    try {
      const file = JSON.parse(readFileSync(this.markPath(record.installId), 'utf8')) as { iv: string; data: string; tag: string };
      const decipher = createDecipheriv('aes-256-gcm', this.markKey(), Buffer.from(file.iv, 'base64')); decipher.setAAD(Buffer.from(`mola:lisans-izi:${record.installId}`)); decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
      const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]).toString('utf8')) as Mark;
      if (value.v === 1 && value.installId === record.installId) mark = value;
    } catch { /* none yet */ }
    this.markCache = { installId: record.installId, mark };
    return mark;
  }
  /** Raises the mark (never lowers it): highest licence serials, latest licence time, newest pulse. Best effort. */
  /** eset: right after a real contact with Merkez its (signed) time replaces the kept high-water mark, so a clock that
   * once ran far ahead (a flat BIOS battery) does not keep the café closed after it is fixed. */
  private saveMark(record: LinkRecord, reset = false) {
    try {
      const key = this.publicKey(), old = this.mark(), serials: Record<string, number> = { ...(old?.serials ?? {}) };
      const withFeatures = new Set([...(old?.withFeatures ?? []), ...Object.keys(record.withFeatures ?? {})]);
      for (const [tenant, signed] of Object.entries(record.licenses)) { try { const c = verifyLicense(signed, key!); serials[tenant] = Math.max(serials[tenant] ?? 0, c.serial); if (Array.isArray(c.features)) withFeatures.add(tenant); } catch { /* not counted */ } }
      const pulseAt = Math.max(old?.pulseAt ?? 0, Date.parse(this.pulse(record)?.serverTime ?? '') || 0);
      const mark: Mark = { v: 1, installId: record.installId, highWater: reset ? record.highWater ?? 0 : Math.max(old?.highWater ?? 0, record.highWater ?? 0, this.high), pulseAt, serials, ...(withFeatures.size ? { withFeatures: [...withFeatures].sort() } : {}) };
      if (old && JSON.stringify(old) === JSON.stringify(mark)) return;
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.markKey(), iv); cipher.setAAD(Buffer.from(`mola:lisans-izi:${record.installId}`));
      const data = Buffer.concat([cipher.update(JSON.stringify(mark), 'utf8'), cipher.final()]);
      const path = this.markPath(record.installId); mkdirSync(dirname(path), { recursive: true });
      writeAtomic(path, JSON.stringify({ v: 1, iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') }));
      this.markCache = { installId: record.installId, mark };
    } catch { /* a read-only disk: the record still holds the same values */ }
  }
  /**
   * The newest order or payment time in the open data, read once when the heartbeat starts (never inside a request: a
   * guest's QR request reads only its own business): a clock turned back behind them does not help either.
   */
  private dataFloor() {
    if (this.floor !== undefined) return this.floor;
    let floor = 0;
    try {
      for (const { tenant } of this.store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) {
        const s = this.store.read(tenant);
        for (const x of [...s.orders, ...s.payments]) { const t = Date.parse(x.createdAt); if (t > floor) floor = t; }
      }
    } catch { floor = 0; }
    return this.floor = floor;
  }
  /**
   * Licence time: the latest of this computer's clock, Merkez's last answer and signed pulse, staff activity, the newest
   * order/payment and the kept high-water mark (record and mark file). Turning the clock back or restoring an old backup
   * does not make a licence (or the offline allowance) last longer.
   */
  licenseNow() {
    const r = this.read(), m = this.mark(), server = Date.parse(r?.serverTime ?? '');
    // This computer's clock, corrected by Merkez's when it is known to be more than 10 minutes off.
    const skew = this.skewKnown ? this.skew : r?.skewMs ?? 0, clock = this.now().getTime() + (Math.abs(skew) > CLOCK_WARN_MS ? skew : 0);
    const t = Math.max(clock, Number.isFinite(server) ? server : 0, Date.parse(this.pulse(r)?.serverTime ?? '') || 0, r?.highWater ?? 0, m?.highWater ?? 0, m?.pulseAt ?? 0, this.high, this.floor ?? 0);
    this.high = t; return new Date(t);
  }
  /** The last contact with Merkez: its signed pulse; before the first one (or from an older Merkez) the last good heartbeat. */
  lastContact(r = this.read()) {
    if (!r) return 0;
    const pulse = Math.max(Date.parse(this.pulse(r)?.serverTime ?? '') || 0, this.mark()?.pulseAt ?? 0);
    return pulse || Math.max(Date.parse(r.lastSuccessAt ?? '') || 0, Date.parse(r.serverTime ?? '') || 0, Date.parse(r.activatedAt) || 0);
  }
  /** Whole days since the last contact with Merkez (licence time). */
  offlineDays() { const r = this.read(); return r ? Math.max(0, Math.floor((this.licenseNow().getTime() - this.lastContact(r)) / DAY)) : 0; }
  /** Merkez said (signed, for this install) that this business's record was closed. Never undone here; no data is touched. */
  private removedHit = new Map<string, boolean>();
  removed(tenant: string): boolean {
    const r = this.read(), signed = r?.removed?.[tenant], key = this.publicKey();
    if (!r || !signed || !key) return false;
    const cacheKey = `${r.installId}:${tenant}:${signed.signature}`, hit = this.removedHit.get(cacheKey);
    if (hit !== undefined) return hit;
    let ok = false;
    try { const c = verifyRemoval(signed, key); ok = c.installId === r.installId && c.tenantId === tenant; } catch { ok = false; }
    this.removedHit.set(cacheKey, ok); return ok;
  }
  /** Every business of this install was closed at Merkez: heartbeats once a day, no ticket or freeze is queued any more. */
  closed() { const tenants = Object.keys(this.read()?.licenses ?? {}); return tenants.length > 0 && tenants.every(t => this.removed(t)); }
  /** Why a valid licence does not open the menu here: 'moved' (another computer holds the install) or 'offline' (too long). */
  blocked(): 'moved' | 'offline' | undefined {
    const r = this.read(); if (!r) return undefined;
    if (this.pulse(r)?.machine === 'replaced') return 'moved';
    return this.licenseNow().getTime() - this.lastContact(r) >= OFFLINE_DAYS * DAY ? 'offline' : undefined;
  }
  /** Merkez's clock against this computer's, when it is more than 10 minutes off (ms; positive: this clock is behind). */
  clockSkew() { const skew = this.skewKnown ? this.skew : this.read()?.skewMs ?? 0; return Math.abs(skew) > CLOCK_WARN_MS ? skew : 0; }
  /**
   * The one sentence the owner should read first about the link (the panel's licence notice, the support screen). `tenant`:
   * that business's own state first (its record closed at Merkez); without it, closed only when every business is.
   */
  notice(tenant?: string): string | undefined {
    if (tenant ? this.removed(tenant) : this.closed()) return REMOVED_NOTICE;
    const blocked = this.blocked(), days = this.offlineDays(), skew = this.clockSkew();
    if (blocked === 'moved') return 'Bu lisans başka bir bilgisayarda kullanılıyor. Bu bilgisayarda müşteri menüsü ve yeni siparişler kapalı; açık hesaplar kapatılabilir. Bu bilgisayarla devam etmek için destek ekibiyle görüşün.';
    if (blocked === 'offline') return `Mola Merkez’e ${days} gündür bağlanılamadı: müşteri menüsü ve yeni siparişler kapalı. Açık hesaplar kapatılabilir, destek talebi yazılabilir. İnternet bağlantısını kontrol edin; bağlantı gelince kendiliğinden açılır.`;
    if (days >= WARN_DAYS) return `Mola Merkez’e ${days} gündür bağlanılamadı. ${OFFLINE_DAYS - days} gün içinde bağlanmazsa müşteri menüsü ve yeni siparişler kapanır. İnternet bağlantısını kontrol edin.`;
    if (skew) return `Bilgisayarın saati ${skewText(skew)}. Windows ayarlarında “Saati otomatik olarak ayarla”yı açın.`;
    return undefined;
  }
  /** The panel banner: the notice, and for a closed, moved or offline licence how to reach the Mola team (plain text). */
  bannerNotice(tenant: string) {
    const text = this.notice(tenant); if (!text) return undefined;
    const contact = this.removed(tenant) || this.blocked() ? this.contact() : undefined;
    return contact ? `${text} ${contactLine(contact)}` : text;
  }

  // ---------- Mola ekibi iletişim bilgileri ----------
  private contactKept?: { claims?: ContactClaims };
  private contactCheck: { at: number; ok: boolean; running?: Promise<void> } = { at: 0, ok: false };
  /** The vendor's contact (undefined: none yet, or the vendor left every field empty). Works offline. */
  contact(): ContactInfo | undefined {
    this.contactKept ??= { claims: readSavedContact(this.store.directory, this.publicKey()) };
    const c = this.contactKept.claims;
    return c && !emptyContact(c) ? { phone: c.phone, whatsapp: c.whatsapp, email: c.email, hours: c.hours, web: c.web } : undefined;
  }
  /** A signed contact from Merkez (heartbeat answer or /contact): kept when our key signed it and it is not older than ours. */
  private keepContact(signed: unknown) {
    const key = this.publicKey(); if (!key || !signed) return;
    let claims: ContactClaims; try { claims = verifyContact(signed, key); } catch { return; }
    const old = (this.contactKept ??= { claims: readSavedContact(this.store.directory, key) }).claims;
    if (old && Date.parse(old.updatedAt) >= Date.parse(claims.updatedAt)) return;
    try { writeAtomic(join(this.store.directory, CONTACT_FILE), JSON.stringify(signed)); } catch { /* a read-only disk: kept in memory */ }
    this.contactKept = { claims };
  }
  /**
   * Before activation there is no heartbeat: the contact comes from Merkez's public /contact, asked at most every 10 minutes
   * once known, every minute while Merkez has none, 30 s after a failure (MOLA_CONTACT_POLL_MS: tests). `wait`: the first look
   * of a screen waits briefly for it.
   */
  refreshContact(wait = false): Promise<void> {
    const t = Date.now(), every = Number(process.env.MOLA_CONTACT_POLL_MS) || (!this.contactCheck.ok ? 30_000 : this.contact() ? 600_000 : 60_000);
    if (!this.contactCheck.running && t - this.contactCheck.at > every) {
      this.contactCheck.at = t;
      this.contactCheck.running = this.request('/contact', { method: 'GET' }, 5000)
        .then(async r => { if (!r.ok) throw new Error(String(r.status)); const body = await r.json() as { contact?: unknown }; this.keepContact(body.contact); this.contactCheck.ok = true; })
        .catch(() => { this.contactCheck.ok = false; })
        .finally(() => { this.contactCheck.running = undefined; });
    }
    return wait && this.contactCheck.running ? this.contactCheck.running : Promise.resolve();
  }
  /** For the support screen: the link's health in one object. */
  linkStatus(tenant?: string) {
    const r = this.read(), contact = this.lastContact(r), removed = tenant ? this.removed(tenant) : this.closed();
    return { lastContactAt: contact ? new Date(contact).toISOString() : null, offlineDays: this.offlineDays(), offlineLimitDays: OFFLINE_DAYS, warnFromDays: WARN_DAYS, blocked: removed ? 'removed' as const : this.blocked() ?? null, clockSkewMs: this.clockSkew(), notice: this.notice(tenant) ?? null };
  }
  summary(tenant: string) {
    const l = this.license(tenant); if (!l) return undefined;
    const s = licenseSummary(l, this.licenseNow()), blocked = this.removed(tenant) ? 'removed' as const : this.blocked();
    return blocked ? { ...s, active: false, blocked } : s;
  }
  active(tenant: string) { return !!this.summary(tenant)?.active; }
  assertMenu(tenant: string) { if (!this.active(tenant)) throw new DomainError('MENU_UNAVAILABLE', 'Bu işletmenin dijital menüsü şu anda kullanılamıyor. Lütfen personelle görüşün.', 403); }
  menuOnly(tenant: string) { return this.license(tenant)?.service === 'menu'; }
  assertGuestService(tenant: string) { if (this.menuOnly(tenant)) throw new DomainError('MENU_ONLY', 'Bu işletmede menüden sipariş verilemiyor. Siparişinizi personele iletebilirsiniz.', 409); }

  // ---------- Hizmet paketi (packages/domain/feature-gate.ts, server/feature-guard.ts) ----------
  /**
   * The signed licence's `features` as sent (undefined: a licence without the field, from an older Merkez, or none at all).
   * "Sosyal medya ve QR kartları" was core until 6 Ekim: a Merkez that has not said it decides it (FEATURES_SOCIAL in its
   * `accepts`) signed its lists without knowing it, so the café keeps it on, as before. An updated Merkez signs every licence
   * again at its first start; its next heartbeat brings the new `accepts` and the new licence together.
   */
  private listedFeatures(c: LicenseClaims | undefined, accepts = this.read()?.accepts, record = this.read()): readonly unknown[] | undefined {
    const raw = (c as (LicenseClaims & { features?: unknown }) | undefined)?.features;
    if (!c) return undefined;
    // A licence without the list (güvenlik denetimi O6): every service only for an old one on a business that never had a
    // licence with the list here; otherwise the core only (LEGACY_LICENCE_UNTIL).
    if (!Array.isArray(raw)) return this.legacyAllOpen(c, record) ? undefined : [];
    return accepts && !accepts.includes(FEATURES_SOCIAL) && !raw.includes('social') ? [...raw, 'social'] : raw;
  }
  private legacyAllOpen(c: LicenseClaims, record: LinkRecord | null | undefined) {
    if (!(Date.parse(c.issuedAt) < LEGACY_LICENCE_UNTIL)) return false;
    return !record?.withFeatures?.[c.tenantId] && !this.mark()?.withFeatures?.includes(c.tenantId);
  }
  /** The services this business may use now. No licence yet: all of them (nothing runs without an active licence anyway). */
  features(tenant: string): FeatureId[] { return enabledFeatures(this.listedFeatures(this.claims(tenant))); }
  has(tenant: string, id: FeatureId) { return hasFeature(this.features(tenant), id); }
  /** A service of the computer rather than one business (Sunucu yedeği): on when every business here has it. */
  installHas(id: FeatureId) { const tenants = Object.keys(this.read()?.licenses ?? {}); return tenants.every(t => this.has(t, id)); }
  /** What the owner's screens show about the package ("Paketiniz", the faded places, the one-time "deneme bitti"). */
  packageView(tenant: string, owner: boolean): PackageView {
    const claims = this.claims(tenant), listed = !!this.listedFeatures(claims), enabled = enabledFeatures(this.listedFeatures(claims));
    if (!owner) return { enabled, listed };
    const s = this.summary(tenant), trial = claims?.plan === 'trial', menuOnly = claims?.service === 'menu';
    const name = (claims as (LicenseClaims & { packageName?: unknown }) | undefined)?.packageName;
    const notice = this.packageNotice(tenant);
    return { enabled, listed, name: packageName(enabled, { trial, menuOnly, listed, name: typeof name === 'string' ? name : undefined }), ...(menuOnly ? { menuOnly } : {}),
      ...(trial ? { trial: { daysLeft: s?.daysRemaining ?? 0, started: !!s?.endsAt } } : {}),
      // "Paketiniz" shows these quietly: whether the licence runs now, its plan and until when (only what the licence says).
      ...(s ? { active: s.active, ...(!trial && s.endsAt ? { until: s.endsAt } : {}), ...(!trial && s.planMonths ? { planMonths: s.planMonths } : {}) } : {}),
      ...(notice && !notice.seenAt ? { notice: { id: notice.id, closed: notice.closed, at: notice.at } } : {}) };
  }
  /** The owner closed "deneme bitti" (once per notice). */
  seePackageNotice(tenant: string, id: string) {
    const n = this.read()?.packageNotices?.[tenant]; if (!n || n.id !== id || n.seenAt) return false;
    this.write(r => { const x = r.packageNotices?.[tenant]; if (x && x.id === id) x.seenAt = this.now().toISOString(); }); return true;
  }
  /** The unseen-or-seen notice for Bildirimler (üst çubuktaki zil) (server/notifications.ts makes it once by its id). */
  packageNotice(tenant: string) { const n = this.read()?.packageNotices?.[tenant]; return n && { ...n, closed: n.closed.filter(isFeatureId) }; }
  /**
   * No new orders. A guest is told to talk to the staff; the staff and the owner (they ARE the staff) hear the real reason:
   * a suspension by Mola ("…durduruldu. Mola ekibiyle görüşün." with the Mola team's contact), an ended or frozen licence…
   */
  assertOrdering(tenant: string, who: 'guest' | 'staff' = 'guest') {
    if (this.active(tenant)) return;
    if (who === 'guest') throw new DomainError('LICENSE_EXPIRED', 'İşletme şu anda yeni sipariş kabul edemiyor. Personelle görüşün.', 409);
    const suspended = !this.removed(tenant) && !!this.license(tenant)?.suspended;
    throw new DomainError(suspended ? 'SERVICE_SUSPENDED' : 'LICENSE_EXPIRED', this.withContact(this.staffReason(tenant)), 409);
  }
  /** The owner's banner while Mola has suspended the service (plain text, with the Mola team's contact when known). */
  suspendedNotice() { return this.withContact(SUSPENDED_NOTICE); }
  private withContact(text: string) { const c = this.contact(); return c ? `${text} ${contactLine(c)}` : text; }
  /** Why ordering is closed here, in words for the café's own people. */
  private staffReason(tenant: string) {
    if (this.removed(tenant)) return REMOVED_NOTICE;
    const s = this.summary(tenant);
    if (!s) return 'Lisans doğrulanamadı: yeni sipariş alınamıyor. İşletme sahibi Destek bölümünden Mola ekibine ulaşabilir.';
    if (s.suspended) return SUSPENDED_NOTICE;
    if ('blocked' in s && s.blocked) return this.notice(tenant) ?? 'Lisans bu bilgisayarda şu anda kullanılamıyor: yeni sipariş alınamıyor.';
    if (s.frozen) return 'Hizmet donduruldu: dondurma bitene kadar yeni sipariş alınamıyor. Açık hesaplar kapatılabilir.';
    if (!s.endsAt) return 'Deneme süresi henüz başlatılmadı: yeni sipariş alınamıyor. İşletme sahibi Destek bölümünden Mola ekibine ulaşabilir.';
    return 'Lisans süresi doldu: yeni sipariş alınamıyor. Açık hesaplar kapatılabilir; yenilemek için işletme sahibi Mola ekibiyle görüşebilir.';
  }
  /** Staff activity for the heartbeat ("son panel bağlantısı"); the first owner login is kept once. */
  touch(tenant: string, at: Date, ownerLogin = false) {
    this.activity.set(tenant, at.toISOString());
    const r = this.read();
    if (ownerLogin && r && !r.firstOwnerLogin[tenant]) this.write(x => { x.firstOwnerLogin[tenant] ??= at.toISOString(); });
    // Staff use moves licence time forward; it is kept every 10 minutes, so a restart with the clock turned back keeps it.
    this.high = Math.max(this.high, at.getTime());
    if (r && this.high - this.savedHigh > 10 * 60_000) this.keepHigh();
  }
  private keepHigh() {
    try { this.write(x => { x.highWater = Math.max(x.highWater ?? 0, this.high); }); this.savedHigh = this.high; this.saveMark(this.read()!); } catch { /* next time */ }
  }
  audit(action: string) { if (this.read()) this.write(r => { r.audit.push({ action, at: this.now().toISOString() }); }); }
  /**
   * A licence from Merkez replaces the cached one only when it verifies, belongs to this install and has a higher serial.
   * Returns false for anything else (a forged or older one is simply not used).
   */
  private accept(record: LinkRecord, signed: SignedLicense) {
    const key = this.publicKey(); if (!key) return false;
    let claims: LicenseClaims;
    try { claims = verifyLicense(signed, key); } catch { return false; }
    if (claims.installId !== record.installId) return false;
    const current = record.licenses[claims.tenantId];
    let serial = 0, before: LicenseClaims | undefined;
    if (current) try { before = verifyLicense(current, key); serial = before.serial; } catch { serial = 0; }
    // The mark beside the data folder remembers the highest serial even when an old backup was put back.
    const kept = this.mark()?.serials[claims.tenantId] ?? 0;
    // The licence with `features` replaces its own twin without them (same serial: an older Merkez signed both; O6).
    const listed = Array.isArray(claims.features), twin = !!before && claims.serial === serial && listed && !Array.isArray(before.features);
    if ((claims.serial <= serial && !twin) || claims.serial < kept) return false;
    // Deneme bitti: the trial's services (all of them) became the package's; the owner hears once which ones closed.
    if (before?.plan === 'trial' && claims.plan !== 'trial') {
      const closed = closedFeatures(enabledFeatures(this.listedFeatures(before, record.accepts, record)), enabledFeatures(this.listedFeatures(claims, record.accepts, record)));
      if (closed.length) (record.packageNotices ??= {})[claims.tenantId] = { id: `deneme-${claims.serial}`, closed, at: this.now().toISOString() };
    }
    if (listed) (record.withFeatures ??= {})[claims.tenantId] = true;
    record.licenses[claims.tenantId] = signed; return true;
  }

  /** A licence handed over outside the heartbeat (tests, a support tool): the same rules as one from Merkez. */
  receive(signed: SignedLicense) { const ok = this.write(r => this.accept(r, signed)); if (ok) this.saveMark(this.read()!); return ok; }

  // ---------- Activation ----------
  private ticketCache: PendingActivation | null | undefined; private checking?: Promise<void>; private lastCheck = 0;
  /** The kept activation ids (and the application, once sent); null before the first try and after activation. */
  ticket(): PendingActivation | null {
    if (this.ticketCache === undefined) {
      const row = this.store.db.prepare('SELECT payload FROM merkez_activation WHERE id=1').get() as { payload: Uint8Array } | undefined;
      this.ticketCache = row ? open<PendingActivation>(Buffer.from(row.payload), this.store.key, 'merkez-activation') : null;
    }
    return this.ticketCache;
  }
  private saveTicket(ticket: PendingActivation) {
    this.store.db.prepare('INSERT INTO merkez_activation (id,payload) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(seal(ticket, this.store.key, 'merkez-activation'));
    this.ticketCache = ticket;
  }
  /**
   * This computer's activation ids, made and kept (sealed) before the first try and reused for every one after it: "Yeniden
   * dene", Geri and back, an edited form, a restart, an answer lost on the way. Merkez finds the same application, install
   * and business by them instead of making another. Removed in the same transaction that keeps the licence.
   */
  activationTicket(): PendingActivation {
    const found = this.ticket(); if (found) return found;
    const ticket: PendingActivation = { v: 1, activationId: randomUUID().replace(/-/g, ''), installId: randomUUID(), createdAt: this.now().toISOString() };
    this.saveTicket(ticket); return ticket;
  }
  /** The application waiting for the vendor (or refused), while this computer is not activated. */
  application() { return this.read() ? undefined : this.ticket()?.application; }
  private begin() {
    if (this.read()) throw new DomainError('ALREADY_ACTIVE', 'Mola bu bilgisayarda zaten etkinleştirildi.', 409);
    const key = this.publicKey();
    if (!key) throw new DomainError('MERKEZ_KEY_MISSING', 'Mola Merkez anahtarı bu kurulumda yok. Destek ekibiyle görüşün.', 503);
    if (this.activating) throw new DomainError('RATE_LIMIT', 'Etkinleştirme sürüyor. Birkaç saniye bekleyin.', 429);
    return key;
  }
  /** What every activation request carries besides its own fields: the kept ids and this package's key fingerprint. */
  private ids(key: KeyObject) { const t = this.activationTicket(); return { requestId: t.activationId, installId: t.installId, keyId: keyFingerprint(key), machineId: this.options.machineId ?? machineId(), appVersion: APP_VERSION }; }
  /** "Etkinleştirme kodum var". The screen's own request id is not used: the kept ticket makes every try the same one. */
  async activate(kind: 'code', body: { requestId?: string } & Record<string, unknown>, agreement?: { version: number; name?: string }) {
    const key = this.begin(); this.activating = true;
    try {
      const { requestId: _screen, ...fields } = body;
      this.keep(await this.withAgreement<ActivationResult>(`/activate/${kind}`, { ...fields, ...this.ids(key) }, agreement), kind, key);
      return this.state();
    } finally { this.activating = false; }
  }
  /** "Hesap açma başvurusu": sent (or sent again, corrected) under the same ids; the vendor decides in Mola Yönetim. */
  async apply(form: ApplicationForm, agreement?: { version: number; name?: string }) {
    const key = this.begin(); this.activating = true;
    try { this.take(await this.withAgreement<ApplicationAnswer>('/applications', { ...form, ...this.ids(key) }, agreement), key, form); return this.state(); }
    finally { this.activating = false; }
  }
  /**
   * Mola Lisans Sözleşmesi, accepted on the activation screen: kept in the ticket first (a retry, or the approval later, finds
   * it), then sent with the request. A Merkez from before the agreement refuses the unknown field (VALIDATION_ERROR): the same
   * request once more without it; the acceptance then goes with a heartbeat as soon as that Merkez takes it ('agreement').
   */
  private async withAgreement<T>(path: string, body: Record<string, unknown>, agreement?: { version: number; name?: string }): Promise<T> {
    if (!agreement) return this.post<T>(path, body);
    const ticket = this.activationTicket(), kept = ticket.agreement?.version === agreement.version ? ticket.agreement : undefined;
    const accepted: AgreementAcceptance = { version: agreement.version, acceptedAt: kept?.acceptedAt ?? this.now().toISOString(), ...(agreement.name ? { name: agreement.name.slice(0, 80) } : kept?.name ? { name: kept.name } : {}) };
    this.saveTicket({ ...ticket, agreement: { ...accepted, sent: false } });
    let answer: T;
    try { answer = await this.post<T>(path, { ...body, agreement: accepted }); }
    catch (e) { if (e instanceof DomainError && e.code === 'VALIDATION_ERROR') return this.post<T>(path, body); throw e; }
    const now = this.ticket(); if (now) this.saveTicket({ ...now, agreement: { ...accepted, sent: true } });
    return answer;
  }
  /**
   * While the application waits, the screen asks every few seconds; Merkez is asked at most every 2 s (MOLA_APPLICATION_POLL_MS).
   * Approved: the licence is kept here and the owner account comes next. Unreachable: noted, asked again next time.
   */
  checkApplication(): Promise<void> {
    const key = this.publicKey(), ticket = this.ticket();
    if (!key || !ticket?.application || this.read() || this.activating || Date.now() - this.lastCheck < Number(process.env.MOLA_APPLICATION_POLL_MS ?? 2000)) return this.checking ?? Promise.resolve();
    if (this.checking) return this.checking;
    this.lastCheck = Date.now();
    this.checking = this.post<ApplicationAnswer>('/applications/status', { requestId: ticket.activationId, installId: ticket.installId })
      .then(answer => this.take(answer, key))
      .catch(e => {
        const current = this.ticket(); if (!current?.application || this.read()) return;
        const at = this.now().toISOString(), message = e instanceof DomainError ? e.message : UNREACHABLE;
        // Removed at Merkez (the vendor deleted it): the owner corrects and sends it again, under the same ids.
        if (e instanceof DomainError && e.code === 'APPLICATION_NOT_FOUND') this.saveTicket({ ...current, application: { ...current.application, status: 'rejected', reason: message, decidedAt: at, checkedAt: at, error: undefined } });
        else this.saveTicket({ ...current, application: { ...current.application, checkedAt: at, error: message } });
      })
      .finally(() => { this.checking = undefined; });
    return this.checking;
  }
  private take(answer: ApplicationAnswer, key: KeyObject, form?: ApplicationForm) {
    if (answer.status === 'approved') { this.keep(answer.activation, 'application', key); return; }
    const ticket = this.activationTicket(), old = ticket.application, at = this.now().toISOString();
    // An older status that arrives after a resubmission does not undo it.
    if (!form && old && Date.parse(answer.submittedAt) < Date.parse(old.submittedAt)) return;
    if (!form && !old) return;
    this.saveTicket({ ...ticket, application: { status: answer.status, name: answer.name, submittedAt: answer.submittedAt, ...(answer.reason ? { reason: answer.reason } : {}), ...(answer.decidedAt ? { decidedAt: answer.decidedAt } : {}), checkedAt: at, form: form ?? old!.form } });
  }
  /** The licence from Merkez, verified with this package's key, becomes the link record; the ticket goes in the same step. */
  private keep(answer: ActivationResult, kind: string, key: KeyObject) {
    const ticket = this.activationTicket();
    let claims: LicenseClaims;
    // Not signed with the key this package trusts: another Mola Yönetim. Not a network problem, so no "Yeniden dene" loop.
    try { claims = verifyLicense(answer.license, key); } catch { throw new DomainError('MERKEZ_KEY_MISMATCH', `${KEY_MISMATCH} (Kurulumdaki anahtar: ${showFingerprint(keyFingerprint(key))})`, 409); }
    if (answer.installId !== ticket.installId || claims.installId !== answer.installId || claims.tenantId !== answer.tenantId) throw new DomainError('LICENSE_INVALID', 'Mola Merkez’den gelen lisans bu kuruluma ait değil.', 502);
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.store.db.prepare('SELECT id FROM merkez_link WHERE id=1').get()) throw new DomainError('ALREADY_ACTIVE', 'Mola bu bilgisayarda zaten etkinleştirildi.', 409);
      const record: LinkRecord = { v: 1, installId: answer.installId, secret: answer.secret, activatedAt: this.now().toISOString(), licenses: { [answer.tenantId]: answer.license }, pending: [{ tenantId: answer.tenantId, name: answer.name, ...(answer.sector ? { sector: answer.sector } : {}) }], tickets: [], freezes: [], requests: {}, failuresSentAt: this.now().getTime(), serverTime: answer.serverTime, firstOwnerLogin: {}, audit: [{ action: `activated.${kind}`, at: this.now().toISOString() }], ...(ticket.agreement ? { agreements: { [answer.tenantId]: ticket.agreement } } : {}), ...(Array.isArray(claims.features) ? { withFeatures: { [answer.tenantId]: true as const } } : {}) };
      this.saveIn(record); this.store.db.exec('DELETE FROM merkez_activation'); this.store.db.exec('COMMIT'); this.cache = record; this.ticketCache = null;
    } catch (e) { this.store.db.exec('ROLLBACK'); this.cache = undefined; this.ticketCache = undefined; throw e; }
  }
  /**
   * Migration (scripts/merkez-import.ts): a data folder from before the split, registered at Merkez with its own business
   * ids. Kept only when every licence verifies and belongs to this install; tickets arrive as already delivered.
   */
  adopt(result: { installId: string; secret: string; licenses: SignedLicense[]; serverTime: string; reused?: boolean }, tickets: Ticket[] = [], agreement?: AgreementAcceptance) {
    const key = this.publicKey();
    if (!key) throw new Error('Mola Merkez açık anahtarı bulunamadı (MOLA_MERKEZ_PUBLIC_KEY).');
    const licenses: Record<string, SignedLicense> = {}, withFeatures: Record<string, true> = {};
    for (const signed of result.licenses) {
      const claims = verifyLicense(signed, key);
      if (claims.installId !== result.installId) throw new Error('Merkez’den gelen lisans bu kuruluma ait değil.');
      licenses[claims.tenantId] = signed;
      if (Array.isArray(claims.features)) withFeatures[claims.tenantId] = true;
    }
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.store.db.prepare('SELECT id FROM merkez_link WHERE id=1').get()) throw new Error('Bu veri klasörü zaten Mola Merkez’e bağlı.');
      const record: LinkRecord = { v: 1, installId: result.installId, secret: result.secret, activatedAt: this.now().toISOString(), licenses, pending: [], tickets: tickets.map(t => ({ ...t, messages: t.messages.map(m => ({ ...m })) })), freezes: [], requests: {}, failuresSentAt: this.now().getTime(), serverTime: result.serverTime, firstOwnerLogin: {}, audit: [{ action: 'activated.import', at: this.now().toISOString() }],
        // Demo and test folders only (merkez-import --sozlesme-kabul): a migrated café's owner is asked after signing in.
        ...(agreement ? { agreements: Object.fromEntries(Object.keys(licenses).map(t => [t, { ...agreement }])) } : {}), ...(Object.keys(withFeatures).length ? { withFeatures } : {}) };
      this.saveIn(record); this.store.db.exec('COMMIT'); this.cache = record;
    } catch (e) { this.store.db.exec('ROLLBACK'); this.cache = undefined; throw e; }
  }
  /** Onboarding step 2: the owner account is made here and stays on this computer; Merkez never sees it. */
  createOwner(owner: Pick<StaffUser, 'username' | 'name' | 'salt' | 'hash'>) {
    const pending = this.pending();
    if (!pending) throw new DomainError('NOT_PENDING', 'Kurulacak işletme yok.', 409);
    if (this.store.findUser(owner.username)) throw new DomainError('USERNAME_TAKEN', 'Bu kullanıcı adı kullanılıyor.', 409);
    const state: State = starterState(pending.tenantId, pending.name);
    state.staffUsers = [{ id: randomUUID(), role: 'owner', active: true, version: 1, createdAt: this.now().toISOString(), ...owner }]; state.setupCompleted = false;
    // Only a preselection: the first setup still asks and loads that kind's starter menu (server/management.ts).
    if (pending.sector) state.sector = pending.sector;
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.cache = undefined; const record = structuredClone(this.read()!);
      if (this.store.db.prepare('SELECT tenant FROM snapshots WHERE tenant=?').get(pending.tenantId)) throw new DomainError('CONFLICT', 'Bu işletme zaten kurulmuş.', 409);
      this.store.db.prepare('INSERT INTO snapshots VALUES (?,?)').run(pending.tenantId, this.store.encode(state));
      record.pending = record.pending.filter(p => p.tenantId !== pending.tenantId);
      record.audit.push({ action: 'owner.created', at: this.now().toISOString() });
      this.saveIn(record); this.store.db.exec('COMMIT'); this.cache = record;
    } catch (e) { this.store.db.exec('ROLLBACK'); this.cache = undefined; throw e; }
    return { tenantId: pending.tenantId };
  }

  // ---------- Owner support (queued for Merkez) ----------
  tickets(tenant: string) { return (this.read()?.tickets ?? []).filter(t => t.tenantId === tenant); }
  queuedFreezes(tenant: string) { return (this.read()?.freezes ?? []).filter(f => f.tenantId === tenant); }
  /** A closed record: nothing new can reach Merkez for it (the owner calls the Mola team instead). */
  private assertOpen(tenant: string) { if (this.removed(tenant)) throw new DomainError('RECORD_CLOSED', REMOVED_NOTICE, 409); }
  // ---------- Destek ekleri: the file goes to Mola Merkez at once (signed); the message naming it follows with the heartbeat ----------
  /** Files this server sent to Merkez for a message not written yet (kept in memory: a restart asks to add them again). */
  private uploads = new Map<string, { tenant: string; ref: AttachmentRef; at: number }>();
  async uploadAttachment(tenant: string, b: { name: string; data: string }): Promise<AttachmentRef> {
    this.assertOpen(tenant);
    if (!this.read()) throw new DomainError('NOT_ACTIVATED', 'Mola bu bilgisayarda henüz etkinleştirilmedi.', 409);
    const answer = await this.signed<{ attachment: AttachmentRef }>('/attachments', { tenantId: tenant, name: b.name, data: b.data }, true, 120_000).catch(error => {
      // An older Mola Merkez has no /attachments: said in plain words instead of "wrong address".
      if (error instanceof DomainError && error.code === 'MERKEZ_ADDRESS' && this.read()?.accepts && !this.read()!.accepts!.includes('ticket.attachments')) throw new DomainError('ATTACHMENT_UNSUPPORTED', 'Mola Merkez henüz ek almıyor. Mola ekibinden güncellemesini isteyin.', 409);
      throw error;
    });
    // The upload itself proves this Merkez takes files on messages (even before a heartbeat answer said so).
    this.write(r => { if (!r.accepts?.includes('ticket.attachments')) r.accepts = [...(r.accepts ?? []), 'ticket.attachments']; });
    const now = Date.now();
    for (const [id, u] of this.uploads) if (now - u.at > 86_400_000) this.uploads.delete(id);
    this.uploads.set(answer.attachment.id, { tenant, ref: answer.attachment, at: now });
    return answer.attachment;
  }
  /** The uploads a new message names (this business's, at most 5); an unknown one asks to add it again. */
  private attached(tenant: string, ids: string[] | undefined) {
    return [...new Set(ids ?? [])].slice(0, 5).map(id => {
      const u = this.uploads.get(id);
      if (!u || u.tenant !== tenant) throw new DomainError('ATTACHMENT_GONE', 'Bir ek bulunamadı. Eki kaldırıp yeniden ekleyin.', 400);
      return u.ref;
    });
  }
  /** One file of this business's tickets, fetched from Merkez for the owner (never kept on this computer). */
  async attachment(tenant: string, id: string, small: boolean): Promise<{ data: Buffer; type: string; disposition: string }> {
    const known = this.tickets(tenant).some(t => t.messages.some(m => m.attachments?.some(a => a.id === id))) || this.uploads.get(id)?.tenant === tenant;
    if (!known) throw new DomainError('NOT_FOUND', 'Ek bulunamadı.', 404);
    const response = await this.signedGet(`/attachments/${id}${small ? '/kucuk' : ''}`);
    if (!response.ok) {
      let data: { code?: string; message?: string } = {}; try { data = await response.json(); } catch { /* not JSON */ }
      if (response.status === 410) throw new DomainError('ATTACHMENT_EXPIRED', 'Ek silindi (14 gün).', 410);
      throw new DomainError(data.code ?? 'MERKEZ_ERROR', data.message ?? 'Ek Mola Merkez’den alınamadı.', response.status >= 500 ? 502 : response.status);
    }
    const type = response.headers.get('content-type') ?? '';
    if (!['image/webp', 'application/pdf'].includes(type)) throw new DomainError('MERKEZ_ERROR', 'Ek Mola Merkez’den alınamadı.', 502);
    return { data: Buffer.from(await response.arrayBuffer()), type, disposition: response.headers.get('content-disposition') ?? 'inline' };
  }
  createTicket(tenant: string, actor: string, b: { requestId: string; subject: string; text: string; attachments?: string[] }) {
    this.assertOpen(tenant);
    const files = this.attached(tenant, b.attachments);
    const result = this.write(r => this.once(r, `ticket:${tenant}:${actor}`, b, () => {
      if (r.tickets.filter(t => t.tenantId === tenant && t.status === 'open').length >= 20) throw new DomainError('TICKET_LIMIT', 'En fazla 20 açık destek talebi olabilir.', 409);
      const at = this.now().toISOString(), ticket: LinkTicket = { id: randomUUID(), tenantId: tenant, subject: b.subject, status: 'open', createdAt: at, messages: [{ id: randomUUID(), source: 'business', text: b.text, at, queued: true, ...(files.length ? { attachments: files } : {}) }] };
      r.tickets.push(ticket); return { id: ticket.id };
    }));
    this.nudge(); return result;
  }
  reply(tenant: string, actor: string, b: { requestId: string; ticketId: string; text: string; attachments?: string[] }) {
    this.assertOpen(tenant);
    const files = this.attached(tenant, b.attachments);
    const result = this.write(r => this.once(r, `reply:${tenant}:${actor}`, b, () => {
      const t = r.tickets.find(t => t.id === b.ticketId && t.tenantId === tenant);
      if (!t) throw new DomainError('NOT_FOUND', 'Destek talebi bulunamadı.', 404);
      if (t.status === 'closed') throw new DomainError('TICKET_CLOSED', 'Talep kapalı. Yeni talep oluşturabilirsiniz.', 409);
      t.messages.push({ id: randomUUID(), source: 'business', text: b.text, at: this.now().toISOString(), queued: true, ...(files.length ? { attachments: files } : {}) }); return { ok: true };
    }));
    this.nudge(); return result;
  }
  /** Checked here against the verified licence (and requests still on their way), decided by the vendor in Mola Yönetim. */
  requestFreeze(tenant: string, b: { requestId: string; reason: string; startDate: string; days: number }) {
    this.assertOpen(tenant);
    const result = this.write(r => this.once(r, `freeze:${tenant}`, b, () => {
      const license = this.license(tenant);
      if (!license) throw new DomainError('NOT_FOUND', 'Lisans bulunamadı.', 404);
      const draft: License = { ...license, freezes: [...(license.freezes ?? []), ...r.freezes.filter(f => f.tenantId === tenant).map(f => ({ ...f, status: 'pending' as const }))] };
      const { id } = requestFreeze(draft, b.reason, b.startDate, b.days, this.licenseNow());
      const f = draft.freezes!.find(x => x.id === id)!;
      r.freezes.push({ id, tenantId: tenant, reason: f.reason, startDate: f.startDate, days: f.days, requestedAt: f.requestedAt });
      return { id };
    }));
    this.nudge(); return result;
  }

  /**
   * "Mola ekibinden kod": the owner lost the password and the recovery code; the vendor read out a one-time code. Checked
   * (`use: false`) or spent (`use: true`) at Merkez over the signed link: only Merkez can say it was made for this install,
   * and its answer is signed with this install's secret. Nothing about the owner account is sent.
   */
  async ownerReset(code: string, use: boolean): Promise<{ tenantId: string; name: string }> {
    const record = this.read();
    if (!record) throw new DomainError('NOT_ACTIVATED', 'Mola bu bilgisayarda henüz etkinleştirilmedi.', 409);
    if (this.closed()) throw new DomainError('RECORD_CLOSED', REMOVED_NOTICE, 409);
    const answer = await this.signed<{ ok: true; tenantId: string; name: string }>('/owner-reset', { code: code.toUpperCase().replace(/[^A-Z0-9]/g, ''), use });
    if (!answer?.ok || !record.licenses[answer.tenantId] || this.removed(answer.tenantId)) throw new DomainError('WRONG_CODE', 'Kod bu bilgisayardaki işletmeye ait değil.', 403);
    return { tenantId: answer.tenantId, name: answer.name };
  }

  // ---------- Tanıtım işletmesi ----------
  /** Merkez's verified word about one business ("Tanıtım işletmesi" and a reset order), for this install only. */
  demoClaims(tenant: string): DemoClaims | undefined {
    const r = this.read(), signed = r?.demo?.[tenant], key = this.publicKey();
    if (!r || !signed || !key) return undefined;
    try { const c = verifyNote('mola-tanitim-1', signed, key); return c.installId === r.installId && c.tenantId === tenant ? c : undefined; } catch { return undefined; }
  }
  /** A demo business: "Tanıtım" label on staff screens and the guest menu, and the manual reset ("Tanıtımı sıfırla"). */
  isDemo(tenant: string) { return !!this.demoClaims(tenant)?.demo && !this.removed(tenant); }
  /**
   * Carries out a reset ordered from Mola Yönetim (server/demo-reset.ts, attached by app.ts): never on its own, only for an
   * order Merkez signed for this install and business, each order once, and not one older than DEMO_ORDER_DAYS.
   */
  demoReset?: (tenant: string, reset: DemoReset) => Promise<void>;
  private demoRunning = new Set<string>();
  /** A reset done here (the owner's or Merkez's): told to Merkez with the next heartbeats until it has it. */
  /** Never fails the session itself: at most 50 wait (older ones go first when Merkez is long away). */
  // ---------- Mola Lisans Sözleşmesi ----------
  /** The acceptance kept for a business; undefined: none yet (installed before the agreement existed). */
  agreement(tenant: string): AgreementAcceptance | undefined {
    const a = this.read()?.agreements?.[tenant];
    return a ? { version: a.version, acceptedAt: a.acceptedAt, ...(a.name ? { name: a.name } : {}) } : undefined;
  }
  /** The owner accepted in the window after signing in: kept here, told to Merkez with the next heartbeat. */
  acceptAgreement(tenant: string, version: number, name?: string): AgreementAcceptance {
    if (version !== AGREEMENT_VERSION) throw new DomainError('AGREEMENT_VERSION', 'Sözleşmenin yeni bir sürümü var. Sayfayı yenileyip yeniden okuyun.', 409);
    const accepted: AgreementAcceptance = { version, acceptedAt: this.now().toISOString(), ...(name?.trim() ? { name: name.trim().slice(0, 80) } : {}) };
    this.write(r => { (r.agreements ??= {})[tenant] = { ...accepted }; r.audit.push({ action: 'agreement.accepted', at: accepted.acceptedAt }); });
    this.soon();
    return accepted;
  }
  // ---------- Duyurular (Mola Merkez → Destek → Duyurular; owner and Müdür) ----------
  /**
   * This business's announcements, newest first, as `viewer` sees them: read by this account or not, and whether the owner
   * said "Okudum" on an Önemli one. `pending` (owner only): the oldest Önemli one still waiting for that, for the window.
   */
  announcements(tenant: string, viewer: { id: string; role: AnnouncementReader }) {
    const r = this.read(), reads = r?.announcementReads?.[tenant] ?? {};
    const items = (r?.announcements ?? []).filter(a => a.tenants.includes(tenant) && !this.removed(tenant)).sort((a, b) => b.sentAt.localeCompare(a.sentAt) || b.id.localeCompare(a.id))
      .map(a => ({ id: a.id, title: a.title, text: a.text, important: a.important, sentAt: a.sentAt, ...(a.editedAt ? { editedAt: a.editedAt } : {}), read: !!reads[a.id]?.seenBy.includes(viewer.id), acknowledged: !!reads[a.id]?.ackAt }));
    const pending = viewer.role === 'owner' ? [...items].reverse().find(a => a.important && !a.acknowledged) ?? null : null;
    return { items, unread: items.filter(a => !a.read).length, pending };
  }
  /** Opened in Destek → Duyurular (or the Önemli window): read for this account, and for the business the first time. */
  readAnnouncements(tenant: string, viewer: { id: string; role: AnnouncementReader }, ids: string[], ack = false) {
    let told = false;
    this.write(r => {
      const mine = new Set((r.announcements ?? []).filter(a => a.tenants.includes(tenant)).map(a => a.id)), at = this.now().toISOString(), reads = (r.announcementReads ??= {})[tenant] ??= {};
      for (const id of ids) {
        if (!mine.has(id)) continue;
        const x = reads[id] ??= { readAt: at, by: viewer.role, seenBy: [], sent: false };
        if (!reads[id].seenBy.includes(viewer.id)) x.seenBy = [...x.seenBy, viewer.id].slice(-50);
        // The owner's "Okudum" on an Önemli one: kept once, told to Merkez with the next heartbeat.
        if (ack && viewer.role === 'owner' && !x.ackAt) { x.ackAt = at; x.sent = false; }
        if (x.sent === false) told = true;
      }
    });
    if (told) this.nudge();
  }
  reportRemoteAdmin(report: RemoteAdminReport) { try { this.write(r => { (r.remoteAdminReports ??= []).push(report); if (r.remoteAdminReports.length > 50) r.remoteAdminReports = r.remoteAdminReports.slice(-50); }); } catch { /* not activated or closing */ } }
  reportDemo(report: DemoReport) { this.write(r => { (r.demoReports ??= []).push(report); if (r.demoReports.length > 20) r.demoReports = r.demoReports.slice(-20); (r.demoDone ??= []).push(report.resetId); if (r.demoDone.length > 100) r.demoDone = r.demoDone.slice(-100); r.audit.push({ action: `demo.reset${report.ok ? '' : '_failed'}`, at: report.at }); }); }
  private runDemoOrders() {
    const r = this.read(); if (!r?.demo || !this.demoReset) return;
    for (const tenant of Object.keys(r.demo)) {
      const c = this.demoClaims(tenant), reset = c?.reset;
      if (!c?.demo || !reset || r.demoDone?.includes(reset.id) || this.demoRunning.has(reset.id)) continue;
      const at = this.now().toISOString();
      if (this.now().getTime() - Date.parse(reset.requestedAt) > DEMO_ORDER_DAYS * DAY) { this.reportDemo({ tenantId: tenant, resetId: reset.id, ok: false, error: 'Sıfırlama isteği çok eski (3 günden fazla); yapılmadı. Gerekirse yeniden isteyin.', at, by: 'merkez', sector: reset.sector }); continue; }
      this.demoRunning.add(reset.id);
      void this.demoReset(tenant, reset)
        .then(() => this.reportDemo({ tenantId: tenant, resetId: reset.id, ok: true, at: this.now().toISOString(), by: 'merkez', sector: reset.sector }))
        .catch(e => this.reportDemo({ tenantId: tenant, resetId: reset.id, ok: false, error: e instanceof DomainError ? e.message : 'Tanıtım sıfırlanamadı.', at: this.now().toISOString(), by: 'merkez', sector: reset.sector }))
        .finally(() => { this.demoRunning.delete(reset.id); this.nudge(); });
    }
  }

  // ---------- Merkez adresi ----------
  /** The address state for the screens (Destek): the address in use and, while moving, the announced one and why not yet. */
  addressStatus() { const r = this.read(); return { url: this.url, packageUrl: this.packageUrl, ...(r?.address && r.address.state !== 'switched' ? { announced: r.address.url, state: r.address.state, error: r.address.error ?? null, checkedAt: r.address.checkedAt ?? null } : {}) }; }
  /**
   * Mola Merkez moved (VDS + HTTPS) and the current Merkez announced the new address, signed with its key. Before switching,
   * the new address must answer this café's fresh nonce with a proof signed by the same key and know this install (the
   * request is signed with the install secret): an address alone, a forged announcement or another Merkez never takes over.
   * Until then the café keeps the address it has and tries again with the next heartbeat.
   */
  private async checkAddress(record: LinkRecord) {
    const a = record.address, key = this.publicKey();
    if (!a || a.state === 'switched' || !key || a.url === this.url) return;
    const nonce = randomBytes(16).toString('hex'), at = this.now().toISOString();
    let error: string | undefined;
    try {
      const answer = await this.signedAt<{ proof?: unknown }>(a.url, '/address/proof', { nonce, url: a.url });
      const proof = verifyNote('mola-adres-kanit-1', answer.proof, key);
      if (proof.installId !== record.installId || proof.nonce !== nonce || proof.url !== a.url) throw new DomainError('ADDRESS_PROOF', 'Yeni Merkez adresi bu kurulumu doğrulayamadı.', 502);
    } catch (e) { error = e instanceof DomainError ? e.message : 'Yeni Merkez adresine ulaşılamadı.'; }
    this.write(r => {
      if (!r.address || r.address.url !== a.url) return;
      r.address = { ...r.address, checkedAt: at, ...(error ? { state: 'failed' as const, error } : { state: 'switched' as const }) };
      if (!error) { delete r.address.error; r.address.from = this.url; r.merkezUrl = a.url; r.audit.push({ action: 'merkez.address_changed', at }); }
    });
  }

  // ---------- Heartbeat ----------
  /** Runs at start and every 10 minutes (sooner after a failure, and while the owner has the support screen open). */
  start() { this.auto = true; this.dataFloor(); this.schedule(3000); }
  stop() { this.auto = false; clearTimeout(this.timer); for (const f of this.onStop) try { f(); } catch { /* stopping anyway */ } }
  /** Köprü (server/relay.ts): stopped with the link; `beforeClose` runs once when Mola closes (the phones' last postbox box). */
  onStop: (() => void)[] = []; beforeClose: (() => Promise<unknown>)[] = [];
  /** After every good heartbeat (İnternetten menü: Merkez may have just said it takes guest tunnels; server/guest-tunnel.ts). */
  afterSync: (() => void)[] = [];
  /** Runs `beforeClose` for at most `ms` (Kapat, Windows shutting down): never holds the closing longer. */
  async flush(ms = 4000) {
    const all = Promise.allSettled(this.beforeClose.map(f => f()));
    await Promise.race([all, new Promise(r => setTimeout(r, ms).unref?.())]);
  }
  private schedule(ms: number) { clearTimeout(this.timer); if (!this.auto) return; this.timer = setTimeout(() => void this.beat(), ms); this.timer.unref?.(); }
  /**
   * One automatic delivery (heartbeat, nudge or the support screen), at least AUTO_GAP_MS after the previous attempt; the next
   * heartbeat counts from it. Merkez takes 30 heartbeats a minute per install and refuses the rest of that minute, so automatic
   * ones never add up past it (browser tests run a 2 s heartbeat beside a polling support screen). Explicit sync() is not held.
   */
  private beat(): Promise<void> {
    // Too soon: it is owed, not dropped; a heartbeat finishing meanwhile comes back for it instead of waiting the full interval.
    const wait = this.lastAttempt + AUTO_GAP_MS - Date.now();
    if (wait > 0) { this.owed = true; this.schedule(wait); return Promise.resolve(); }
    this.owed = false;
    return this.sync().then(r => this.schedule(this.owed ? AUTO_GAP_MS : this.closed() ? CLOSED_MS : r.ok ? HEARTBEAT_MS : RETRIES[Math.min(this.failuresInRow - 1, RETRIES.length - 1)]));
  }
  /** New ticket, reply or freeze: deliver now (in the background) instead of waiting for the next heartbeat. */
  nudge() { if (this.auto && !this.closed()) void this.beat(); }
  /** The support screen polls every few seconds; at most one delivery every 15 s comes of it (MOLA_SYNC_SOON_MS: browser tests). */
  soon() { if (this.auto && !this.closed() && Date.now() - this.lastAttempt > Number(process.env.MOLA_SYNC_SOON_MS ?? 15_000)) void this.beat(); }
  sync(): Promise<{ ok: boolean; error?: string }> {
    if (this.inflight) { this.again = true; return this.inflight; }
    this.inflight = this.run().finally(() => { this.inflight = undefined; if (this.again) { this.again = false; void this.sync(); } });
    return this.inflight;
  }
  /** Exactly what is sent: the allowlisted shape of server/sync-protocol.ts. Exported for the privacy test. */
  payload(record: LinkRecord): SyncRequest {
    // Only this install's businesses at Merkez: another business on the same computer is not reported.
    const raw = this.reporter.failures(record.failuresSentAt).slice(0, 100), last = raw.reduce((n, f) => Math.max(n, Date.parse(f.at) || 0), record.failuresSentAt);
    // A full batch may have left records with the same millisecond behind: the next one starts just before it (Merkez skips repeats).
    this.failuresUntil = raw.length >= 100 ? last - 1 : last;
    // A business whose record Merkez closed reports nothing more (no counts, no tickets or freezes waiting forever).
    const open = (tenant: string) => !!record.licenses[tenant] && !this.removed(tenant);
    const failures = raw.filter(f => !f.tenantId || open(f.tenantId)).map(({ event, requestId, method, route, status, code, elapsedMs, tenantId, role, fingerprint, frames, at }) => ({ event, requestId, method, route, status, code, elapsedMs, ...(tenantId ? { tenantId } : {}), ...(role ? { role } : {}), ...(fingerprint ? { fingerprint } : {}), ...(frames?.length ? { frames } : {}), at }));
    return {
      v: 1, appVersion: APP_VERSION, sentAt: this.now().toISOString(), ...(this.machineHash?.install === record.installId ? { machine: this.machineHash.hash } : {}),
      businesses: this.reporter.businesses().filter(b => open(b.tenantId)).map(b => ({ tenantId: b.tenantId, name: b.name, sector: b.sector, setupCompleted: b.setupCompleted, ...(b.setupCompletedAt ? { setupCompletedAt: b.setupCompletedAt } : {}), counts: { tables: b.counts.tables, staff: b.counts.staff, products: b.counts.products }, ...(this.activity.get(b.tenantId) ? { lastActivityAt: this.activity.get(b.tenantId) } : {}), ...(record.firstOwnerLogin[b.tenantId] ? { firstOwnerLoginAt: record.firstOwnerLogin[b.tenantId] } : {}) })),
      // The second backup place and the last attempt only to a Merkez that said it takes them (an older one refuses extra fields).
      backup: (({ enabled, lastSuccessAt, failing, lastAttemptAt, second }) => ({ enabled, lastSuccessAt, failing, ...(record.accepts?.includes('backup.second') ? { lastAttemptAt: lastAttemptAt ?? null, ...(second ? { second: { set: second.set, lastCopyAt: second.lastCopyAt, failing: second.failing } } : {}) } : {}) }))(this.reporter.backup()),
      failures,
      // At most 50 tickets and 50 waiting messages each per heartbeat (Merkez's limits; the rest goes with the next one).
      tickets: record.tickets.filter(t => !this.removed(t.tenantId) && t.messages.some(m => m.queued)).slice(0, 50).map(t => ({ id: t.id, tenantId: t.tenantId, subject: t.subject, createdAt: t.createdAt, messages: t.messages.filter(m => m.queued).slice(0, 50).map(m => ({ id: m.id, text: m.text, at: m.at, ...(m.attachments?.length && record.accepts?.includes('ticket.attachments') ? { attachments: m.attachments.map(a => a.id) } : {}) })) })),
      freezes: record.freezes.filter(f => !this.removed(f.tenantId)).slice(0, 20).map(f => ({ id: f.id, tenantId: f.tenantId, reason: f.reason, startDate: f.startDate, days: f.days, requestedAt: f.requestedAt })),
      // Otomatik güncelleme, only to a Merkez that takes it (and never from a closed record: nothing would be offered).
      ...(record.accepts?.includes('update') && !this.closed() ? (u => u ? { update: u } : {})(this.updates?.report()) : {}),
      // Tanıtım işletmesi: the results of resets done here (Mola Yönetim's order or the owner's), only to a Merkez that takes them.
      ...(record.accepts?.includes('demo') && record.demoReports?.length ? { demo: record.demoReports.slice(0, 20).map(({ tenantId, resetId, ok, error, at, by, sector }) => ({ tenantId, resetId, ok, ...(error ? { error: error.slice(0, 300) } : {}), at, by, sector })) } : {}),
      // Remote owner sessions (start/end times only), only to a Merkez that takes them.
      ...(record.accepts?.includes('remote_admin') && record.remoteAdminReports?.length ? { remoteAdmin: record.remoteAdminReports.filter(x => open(x.tenantId)).slice(0, 50).map(({ tenantId, session, event, at, reason }) => ({ tenantId, session, event, at, ...(reason ? { reason } : {}) })) } : {}),
      // Mola Lisans Sözleşmesi acceptances Merkez does not have yet, only to a Merkez that takes them.
      ...(record.accepts?.includes('agreement') ? (list => list.length ? { agreements: list } : {})(Object.entries(record.agreements ?? {}).filter(([tenant, a]) => !a.sent && open(tenant)).slice(0, 50).map(([tenantId, a]) => ({ tenantId, version: a.version, acceptedAt: a.acceptedAt, ...(a.name ? { name: a.name } : {}) }))) : {}),
      // Program dosyaları denetimi: file names only, only to a Merkez that takes it (and never from a closed record).
      ...(record.accepts?.includes('integrity') && !this.closed() ? (x => x ? { integrity: x } : {})(this.integrity?.report()) : {}),
      // Duyurular: the versions this café has and the read marks not told yet, only to a Merkez that takes them (asking for them).
      ...(record.accepts?.includes('announcements') && !this.closed() ? { announcements: {
        known: (record.announcements ?? []).slice(-200).map(a => ({ id: a.id, v: a.v })),
        reads: Object.entries(record.announcementReads ?? {}).filter(([tenant]) => open(tenant)).flatMap(([tenantId, list]) => Object.entries(list).filter(([, x]) => !x.sent).map(([id, x]) => ({ tenantId, id, readAt: x.readAt, by: x.by, ...(x.ackAt ? { ackAt: x.ackAt } : {}) }))).slice(0, 200),
      } } : {}),
      // Sosyal medya: the public links per business (also when empty: Merkez then forwards nothing), only to a Merkez that takes them.
      ...(record.accepts?.includes('social') && !this.closed() && this.reporter.social ? { social: this.reporter.social().filter(x => open(x.tenantId)).slice(0, 50) } : {}),
      // İnternetten menü: "this café serves its guest menu through Merkez" (it has the built guest page), only to a Merkez that takes it.
      ...(record.accepts?.includes('guest.tunnel') && !this.closed() && this.tunnelWanted?.() ? { tunnel: { v: 1 as const } } : {}),
      // "İşletmem var": the owners' verifiers, only to a Merkez that keeps them (it checks a sign-in on a new computer with them).
      ...(record.accepts?.includes('owner.login') && !this.closed() && this.reporter.owners ? { owners: this.reporter.owners().filter(x => open(x.tenantId)).slice(0, 50) } : {}),
      // Kalıcı bağlantı: this computer's network addresses (checked here too: one odd address must not cost the heartbeat), only
      // to a Merkez that takes them and only while the café serves its network; without them Merkez forgets the old ones.
      ...(record.accepts?.includes('lan.link') && !this.closed() ? (list => list.length ? { lan: { origins: list } } : {})((this.reporter.lan?.() ?? []).filter(privateLanOrigin).slice(0, 4)) : {}),
      // Raporlarım giriş: the businesses' public keys and phone-code state, always the whole list (a missing one has no sign-in).
      ...(record.accepts?.includes('remote.login') && !this.closed() && this.reporter.remote ? { remote: this.reporter.remote().filter(x => open(x.tenantId)).slice(0, 50) } : {}),
    };
  }
  /** İnternetten menü (server/guest-tunnel.ts): this café can serve its guest menu over the tunnel (the built page is here). */
  tunnelWanted?: () => boolean;
  /**
   * The public address the table QR codes of this business hold (`<base>/q/<code>`; the table's code is added per QR), or why
   * there is none yet: 'inactive' (Mola is not activated here, or the record was closed), 'old' (this Mola Merkez does not take
   * guest tunnels yet), 'private' (Mola Merkez is not on the internet: on this computer or the café's network, Mola Yönetim
   * before the VDS; a phone could not open its address, see publicMenuBase), 'waiting' (no menu code yet: the next heartbeat
   * brings it). Without an address the QR codes keep the café's Wi-Fi address.
   */
  menuAddress(tenant: string): { base: string } | { problem: 'inactive' | 'old' | 'waiting' | 'private' } {
    const r = this.read();
    if (!r || this.removed(tenant) || !r.licenses[tenant]) return { problem: 'inactive' };
    // Said first: whatever Merkez answers, a phone could not open an address on this computer or the café's network.
    if (!publicMenuBase(r.tunnel?.base ?? this.url)) return { problem: 'private' };
    // Misafir menüsünün kendi adresi (11 Ekim, GUVENLIK_DENETIMI Y1): a Merkez that says 'guest.menu-origin' serves /q/ only on
    // its separate menu name. Its `tunnel.base` must be that name, never Merkez's own address (Mola Yönetim's): else wait for
    // the next heartbeat. An older Merkez (no flag): as before.
    if (r.accepts?.includes(MENU_ORIGIN_FLAG) && (!r.tunnel?.base || sameHost(r.tunnel.base, this.url))) return { problem: 'waiting' };
    return this.tunnelAddress(tenant);
  }
  /**
   * The business's menu address at Mola Merkez whatever Merkez's address is (the menu copy, server/menu-mirror.ts, goes to any
   * Merkez that takes it); the table QR codes use menuAddress, which also asks for a public address.
   */
  tunnelAddress(tenant: string): { base: string } | { problem: 'inactive' | 'old' | 'waiting' } {
    const r = this.read();
    if (!r || this.removed(tenant) || !r.licenses[tenant]) return { problem: 'inactive' };
    if (!r.accepts?.includes('guest.tunnel')) return { problem: r.accepts ? 'old' : 'waiting' };
    const code = r.tunnel?.codes[tenant];
    if (!code || !/^[A-Za-z0-9]{10}$/.test(code)) return { problem: 'waiting' };
    return { base: `${(r.tunnel?.base ?? this.url).replace(/\/+$/, '')}/q/${code}` };
  }
  /**
   * The signed WebSocket upgrade for the guest tunnel: the same address and HTTPS rule as every call, the heartbeat's signature
   * (GET, the tunnel path, empty body). `accepted`: Merkez's 101 answer must carry its signature over this nonce.
   */
  tunnelRequest(path: string) {
    const record = this.read();
    if (!record) throw new DomainError('NOT_ACTIVATED', 'Mola bu bilgisayarda henüz etkinleştirilmedi.', 409);
    this.assertSecureUrl();
    const headers = signedHeaders(record.installId, record.secret, 'GET', path, '', this.now().getTime() + this.skew), nonce = headers[HEADER.nonce];
    return { url: new URL(this.url + path), headers, secret: record.secret, nonce, accepted: (signature: string, expected: string) => sameSignature(responseSignature(record.secret, nonce, expected), signature) };
  }
  /** A tunnel refusal that carried Merkez's clock (CLOCK_SKEW): the next signed call uses it. */
  learnClock(serverTime: string | undefined) { const server = Date.parse(serverTime ?? ''); if (Number.isFinite(server)) { this.skew = server - this.now().getTime(); this.skewKnown = true; } }
  /**
   * The short address the social QR codes of this business hold (`<base>/s/<code>`; the platform is added per QR), or why
   * there is none yet: 'inactive' (Mola is not activated here), 'old' (this Mola Merkez does not take social links yet),
   * 'waiting' (no code, or the links on this screen have not reached Merkez yet).
   */
  socialAddress(tenant: string, links?: Record<string, string>): { base: string } | { problem: 'inactive' | 'old' | 'waiting' } {
    const r = this.read();
    if (!r || this.removed(tenant)) return { problem: 'inactive' };
    if (r.accepts && !r.accepts.includes('social')) return { problem: 'old' };
    const code = r.social?.codes[tenant];
    if (!code || !SOCIAL_CODE.test(code)) return { problem: 'waiting' };
    if (links && r.social?.sent?.[tenant] !== JSON.stringify(links)) return { problem: 'waiting' };
    return { base: `${(r.social?.base ?? this.url).replace(/\/+$/, '')}/s/${code}` };
  }
  /**
   * Kalıcı bağlantı: this business's permanent link to this computer (`<base>/k/<code>`), or why there is none: 'inactive'
   * (Mola is not activated here, or the record was closed), 'off' (Mola is open to this computer only), 'old' (this Mola
   * Merkez does not keep them yet), 'waiting' (no code yet: the next heartbeat brings it).
   */
  lanAddress(tenant: string): { url: string } | { problem: 'inactive' | 'old' | 'waiting' | 'off' } {
    const r = this.read();
    if (!r || this.removed(tenant) || !r.licenses[tenant]) return { problem: 'inactive' };
    if (!(this.reporter.lan?.() ?? []).some(privateLanOrigin)) return { problem: 'off' };
    if (r.accepts && !r.accepts.includes('lan.link')) return { problem: 'old' };
    const code = r.lanLink?.codes[tenant];
    if (!code || !SOCIAL_CODE.test(code)) return { problem: 'waiting' };
    return { url: `${(r.lanLink?.base ?? this.url).replace(/\/+$/, '')}/k/${code}` };
  }
  /** The desktop window's Kafe içi cihazlar: the link of this computer's business (the first one when it has several). */
  installLanAddress() {
    const tenant = Object.keys(this.read()?.licenses ?? {}).find(t => !this.removed(t));
    return tenant ? this.lanAddress(tenant) : { problem: 'inactive' as const };
  }
  /**
   * Merkez's list is the whole truth for this computer: one it no longer names was withdrawn (it goes, with its read marks);
   * new or edited ones come in full. Checked field by field (only this install's businesses, plain text, sizes) before kept.
   */
  private takeAnnouncements(r: LinkRecord, given: unknown) {
    const g = given as { active?: unknown; items?: unknown };
    if (!g || !Array.isArray(g.active) || !Array.isArray(g.items)) return;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, version = (v: unknown) => Number.isInteger(v) && (v as number) >= 1;
    const time = (v: unknown) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
    const active = new Map<string, number>();
    for (const a of g.active.slice(0, 200) as { id?: unknown; v?: unknown }[]) if (a && typeof a.id === 'string' && uuid.test(a.id) && version(a.v)) active.set(a.id, a.v as number);
    const ours = (t: unknown) => typeof t === 'string' && (!!r.licenses[t] || !!this.store.db.prepare('SELECT tenant FROM snapshots WHERE tenant=?').get(t));
    const list = new Map((r.announcements ?? []).filter(a => active.has(a.id)).map(a => [a.id, a]));
    for (const raw of g.items.slice(0, 200) as Partial<Record<keyof AnnouncementDelivery, unknown>>[]) {
      if (!raw || typeof raw.id !== 'string' || active.get(raw.id) !== raw.v || typeof raw.title !== 'string' || typeof raw.text !== 'string' || typeof raw.important !== 'boolean' || !time(raw.sentAt) || (raw.editedAt !== undefined && !time(raw.editedAt)) || !Array.isArray(raw.tenants)) continue;
      const tenants = (raw.tenants as unknown[]).filter(ours) as string[];
      if (!tenants.length) continue;
      list.set(raw.id, { id: raw.id, v: raw.v as number, title: announcementTitle(raw.title).slice(0, ANNOUNCEMENT_TITLE_MAX), text: announcementText(raw.text, ANNOUNCEMENT_TEXT_MAX), important: raw.important, sentAt: raw.sentAt as string, ...(raw.editedAt ? { editedAt: raw.editedAt as string } : {}), tenants });
    }
    r.announcements = [...list.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    for (const reads of Object.values(r.announcementReads ?? {})) for (const id of Object.keys(reads)) if (!list.has(id)) delete reads[id];
  }
  /** This computer, as Merkez sees it: an HMAC of the OS's machine id under the install secret (not linkable elsewhere). */
  private machineHash?: { install: string; hash: string };
  private async machine(record: LinkRecord) {
    if (this.machineHash?.install === record.installId) return;
    const raw = this.options.machineKey ?? await machineKey();
    this.machineHash = { install: record.installId, hash: createHmac('sha256', Buffer.from(record.secret, 'base64url')).update(`mola-makine:v2\n${raw}`).digest('hex') };
  }
  private async run(): Promise<{ ok: boolean; error?: string }> {
    const record = this.read(); if (!record) return { ok: false, error: 'Etkinleştirilmedi.' };
    const knew = new Set(record.accepts ?? []);
    this.lastAttempt = Date.now();
    await this.machine(record).catch(() => {});
    const body = this.payload(record);
    const sentUntil = this.failuresUntil;
    try {
      const answer = await this.signed<SyncResponse>('/sync', body);
      const key = this.publicKey();
      this.write(r => {
        // The newest signed pulse is kept (a late answer never replaces a newer one).
        if (answer.pulse && key) try {
          const p = verifyPulse(answer.pulse, key), old = this.pulse(r);
          if (p.installId === r.installId && (!old || Date.parse(p.serverTime) >= Date.parse(old.serverTime))) r.pulse = answer.pulse;
        } catch { /* not from our Merkez: ignored */ }
        // A real, signed contact: Merkez's time is the licence time now (the kept mark starts again from it).
        r.skewMs = this.skew; const contact = Math.max(Date.parse(answer.serverTime) || 0, Date.parse(this.pulse(r)?.serverTime ?? '') || 0);
        r.highWater = contact || Math.max(r.highWater ?? 0, this.licenseNow().getTime());
        for (const signed of answer.licenses ?? []) this.accept(r, signed);
        // "Kaydı kapatıldı": kept only when Merkez's key signed it for this install; final (nothing here ever removes it).
        if (key) for (const signed of answer.removed ?? []) {
          try {
            const c = verifyRemoval(signed, key);
            if (c.installId === r.installId && !r.removed?.[c.tenantId]) { (r.removed ??= {})[c.tenantId] = signed; r.audit.push({ action: 'merkez.record_closed', at: this.now().toISOString() }); }
          } catch { /* not from our Merkez: ignored */ }
        }
        const acked = new Set(answer.delivered?.messages ?? []);
        for (const remote of answer.tickets ?? []) {
          if (!this.store.db.prepare('SELECT tenant FROM snapshots WHERE tenant=?').get(remote.tenantId) && !r.licenses[remote.tenantId]) continue;
          let local = r.tickets.find(t => t.id === remote.id);
          if (local && local.tenantId !== remote.tenantId) continue;
          if (!local) { local = { ...remote, messages: [] }; r.tickets.push(local); }
          local.status = remote.status; local.subject = remote.subject;
          // Files on a message: Mola Merkez's list is the one that counts (an expired upload it left out is not shown).
          for (const m of remote.messages) { const files = Array.isArray(m.attachments) && m.attachments.length ? { attachments: m.attachments.slice(0, 5) } : {}; const mine = local.messages.find(x => x.id === m.id); if (mine) { delete mine.queued; if (files.attachments) mine.attachments = files.attachments; } else local.messages.push({ id: m.id, source: m.source, text: m.text, at: m.at, ...files }); }
          local.messages.sort((a, b) => a.at.localeCompare(b.at));
        }
        for (const t of r.tickets) for (const m of t.messages) if (acked.has(m.id)) delete m.queued;
        // Saklama (8 Ekim): a closed conversation goes 2 years after its last message, here as at Mola Merkez.
        const keepFrom = this.now().getTime() - 730 * 86_400_000;
        r.tickets = r.tickets.filter(t => t.status !== 'closed' || t.messages.some(m => m.queued) || Math.max(Date.parse(t.createdAt) || 0, ...t.messages.map(m => Date.parse(m.at) || 0)) >= keepFrom);
        const freezes = new Set(answer.delivered?.freezes ?? []); r.freezes = r.freezes.filter(f => !freezes.has(f.id));
        r.failuresSentAt = sentUntil; r.serverTime = answer.serverTime;
        r.accepts = Array.isArray(answer.accepts) ? answer.accepts.filter(x => typeof x === 'string').slice(0, 50) : [];
        r.lastSync = { at: this.now().toISOString(), ok: true }; r.lastSuccessAt = r.lastSync.at;
        // Tanıtım işletmesi: reports Merkez now has go; Merkez's signed word per business is kept (the newest, ours only).
        if (body.demo?.length) { const sent = new Set(body.demo.map(x => x.resetId)); r.demoReports = (r.demoReports ?? []).filter(x => !sent.has(x.resetId)); }
        if (body.remoteAdmin?.length) { const sent = new Set(body.remoteAdmin.map(x => `${x.session}:${x.event}`)); r.remoteAdminReports = (r.remoteAdminReports ?? []).filter(x => !sent.has(`${x.session}:${x.event}`)); }
        // Acceptances Merkez now has (a newer one made meanwhile goes with the next heartbeat).
        for (const x of body.agreements ?? []) { const a = r.agreements?.[x.tenantId]; if (a && a.version === x.version && a.acceptedAt === x.acceptedAt) a.sent = true; }
        // Duyurular: read marks Merkez now has; the announcements as Merkez listed them (only when this café asked).
        for (const x of body.announcements?.reads ?? []) { const a = r.announcementReads?.[x.tenantId]?.[x.id]; if (a && a.readAt === x.readAt && a.ackAt === x.ackAt) a.sent = true; }
        if (body.announcements && answer.announcements) this.takeAnnouncements(r, answer.announcements);
        // Sosyal medya: the short-address codes of this install's businesses (a code never changes once given) and the links Merkez now has.
        if (body.social && answer.social && Array.isArray(answer.social.codes)) {
          const social = r.social ??= { codes: {} }, base = answer.social.base;
          for (const c of answer.social.codes.slice(0, 50)) if (c && typeof c.tenantId === 'string' && typeof c.code === 'string' && SOCIAL_CODE.test(c.code) && body.social.some(x => x.tenantId === c.tenantId)) social.codes[c.tenantId] = c.code;
          if (typeof base === 'string' && merkezAddress.safeParse(base).success) social.base = merkezAddress.parse(base); else delete social.base;
          social.sent = Object.fromEntries(body.social.filter(x => social.codes[x.tenantId]).map(x => [x.tenantId, JSON.stringify(x.links)]));
        }
        // İnternetten menü: the menu codes of this install's businesses (a code never changes once given) and Merkez's public address.
        if (body.tunnel && answer.tunnel && Array.isArray(answer.tunnel.codes)) {
          const tunnel = r.tunnel ??= { codes: {} }, base = answer.tunnel.base;
          for (const c of answer.tunnel.codes.slice(0, 50)) if (c && typeof c.tenantId === 'string' && typeof c.code === 'string' && /^[A-Za-z0-9]{10}$/.test(c.code) && r.licenses[c.tenantId]) tunnel.codes[c.tenantId] = c.code;
          const menuBase = menuBaseAddress(base); if (menuBase) tunnel.base = menuBase; else delete tunnel.base;
        }
        // Kalıcı bağlantı: the /k/ codes of this install's businesses (a code never changes once given) and Merkez's public address.
        if (body.lan && answer.lanLink && Array.isArray(answer.lanLink.codes)) {
          const lan = r.lanLink ??= { codes: {} }, base = answer.lanLink.base;
          for (const c of answer.lanLink.codes.slice(0, 50)) if (c && typeof c.tenantId === 'string' && typeof c.code === 'string' && SOCIAL_CODE.test(c.code) && r.licenses[c.tenantId]) lan.codes[c.tenantId] = c.code;
          if (typeof base === 'string' && merkezAddress.safeParse(base).success) lan.base = merkezAddress.parse(base); else delete lan.base;
        }
        if (key) for (const signed of Array.isArray(answer.demo) ? answer.demo.slice(0, 50) : []) {
          try {
            const c = verifyNote('mola-tanitim-1', signed, key), old = r.demo?.[c.tenantId];
            const oldAt = old ? (() => { try { return Date.parse(verifyNote('mola-tanitim-1', old, key).issuedAt); } catch { return 0; } })() : 0;
            if (c.installId === r.installId && Date.parse(c.issuedAt) >= oldAt) (r.demo ??= {})[c.tenantId] = signed;
          } catch { /* not from our Merkez: ignored */ }
        }
        // "Merkez adresi": a newer signed announcement of another address is checked after this write (checkAddress).
        if (key && answer.address) try {
          const c = verifyNote('mola-adres-1', answer.address, key);
          if (c.url !== (r.merkezUrl ?? this.packageUrl).replace(/\/+$/, '') && (!r.address || Date.parse(c.issuedAt) > Date.parse(r.address.issuedAt) || (r.address.url === c.url && r.address.state !== 'switched')))
            r.address = { signed: answer.address, url: c.url, issuedAt: c.issuedAt, state: r.address?.url === c.url && r.address.state !== 'switched' ? r.address.state : 'checking', ...(r.address?.url === c.url && r.address.error ? { error: r.address.error } : {}) };
        } catch { /* not from our Merkez: ignored */ }
      });
      // A reset ordered from Mola Yönetim (each order once, backed up first; server/demo-reset.ts), in the background.
      this.runDemoOrders();
      { const kept = this.read(); if (kept?.address && kept.address.state !== 'switched') await this.checkAddress(kept).catch(() => {}); }
      if (answer.contact) this.keepContact(answer.contact);
      // Merkez's release for this café (null: none, or stopped); a Merkez without updates sends no field at all.
      if (answer.update !== undefined && this.updates) try { this.updates.offer(answer.update && typeof answer.update === 'object' ? answer.update : null); } catch (e) { console.warn(`[güncelleme] ${(e as Error).message}`); }
      // Program dosyaları denetimi: the signed release it asked for (checked against this program's own list, in the background).
      if (answer.integrityManifest && this.integrity) try { void Promise.resolve(this.integrity.manifest(answer.integrityManifest)).catch(() => {}); } catch { /* checked again tomorrow */ }
      { const kept = this.read()!; this.high = Math.max(kept.highWater ?? 0, this.floor ?? 0); this.saveMark(kept, true); this.savedHigh = this.high; }
      for (const f of this.afterSync) try { f(); } catch { /* their own business */ }
      // Merkez just said it takes something new (an update of Merkez, or this café's first heartbeat): what goes with it
      // (0.1.22's `remote`: Raporlarım's sign-in key) leaves with the next heartbeat in a few seconds, not in 10 minutes
      // (0.1.22: "Kasa bilgisayarı hazırlanıyor" for 10–20 minutes after an update). Once: the next answer brings nothing new.
      if ((this.read()?.accepts ?? []).some(x => !knew.has(x))) { this.owed = true; if (this.auto && !this.closed()) this.schedule(AUTO_GAP_MS); }
      this.failuresInRow = 0; return { ok: true };
    } catch (error) {
      this.failuresInRow++;
      const message = error instanceof DomainError ? error.message : UNREACHABLE;
      try { this.write(r => { r.lastSync = { at: this.now().toISOString(), ok: false, error: message }; if (this.skewKnown) r.skewMs = this.skew; r.highWater = Math.max(r.highWater ?? 0, this.licenseNow().getTime()); }); this.saveMark(this.read()!); } catch { /* reported next time */ }
      return { ok: false, error: message };
    }
  }

  // ---------- Köprü (Mola Merkez relay: uzaktan destek ve uzaktan raporlar, server/relay.ts) ----------
  /** Activated here and the record is not closed for every business: the relay may run. */
  relayReady() { return !!this.read() && !this.closed(); }
  /** A signed call to Mola Merkez for the relay (same HMAC, nonce and answer signature as the heartbeat). */
  relayPost<T>(path: string, body: unknown, timeout = 15_000): Promise<T> {
    if (!this.read()) return Promise.reject(new DomainError('NOT_ACTIVATED', 'Mola bu bilgisayarda henüz etkinleştirilmedi.', 409));
    return this.signed<T>(path, body, true, timeout);
  }
  /** The same signed call with a raw body (sunucu yedeği pieces to a Merkez that lists 'cloud.backup.binary'). */
  relayPostBytes<T>(path: string, data: Buffer, timeout = 15_000): Promise<T> {
    if (!this.read()) return Promise.reject(new DomainError('NOT_ACTIVATED', 'Mola bu bilgisayarda henüz etkinleştirilmedi.', 409));
    return this.signed<T>(path, undefined, true, timeout, undefined, data);
  }
  /**
   * Sunucu yedeği taşıma (server/cloud-backup.ts): a clean install on a new computer has no install secret yet; the vendor's
   * one-time taşıma kodu is its proof. Same address and HTTPS rule as every call; the answer is returned raw (bytes or JSON).
   */
  async transferPost(path: string, body: unknown, timeout = 120_000): Promise<Response> {
    const response = await this.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeout);
    this.learn(response);
    if (!response.ok) throw await this.failure(response);
    if (!MerkezLink.fromMerkez(response)) throw merkezProblem('address', 'foreign');
    return response;
  }

  // ---------- HTTP ----------
  private learn(response: Response) {
    const server = Date.parse(response.headers.get('x-mola-server-time') ?? '');
    if (Number.isFinite(server)) { this.skew = server - this.now().getTime(); this.skewKnown = true; }
  }
  /** `base`: another Merkez address (only the announced new one, already checked to be https or this computer). */
  private async request(path: string, init: RequestInit, timeout = 15_000, base?: string) {
    if (base === undefined) this.assertSecureUrl(); else if (!merkezAddress.safeParse(base).success) throw merkezProblem('address');
    const url = base ?? this.url;
    try { return await (this.options.fetch ?? fetch)(url + MERKEZ_API + path, { ...init, signal: AbortSignal.timeout(timeout) }); }
    catch (error) { throw networkProblem(error, url); }
  }
  /** Every Merkez answer carries its clock; without it (and without Merkez's JSON) something else answered at this address. */
  private static fromMerkez(response: Response, data?: { code?: unknown }) { return !!response.headers.get('x-mola-server-time') || typeof data?.code === 'string'; }
  private async failure(response: Response) {
    let data: { code?: unknown; message?: unknown } = {};
    try { data = JSON.parse(await response.text()); } catch { /* not JSON */ }
    // Not Merkez: a proxy whose Merkez is down (5xx), something refusing us (401/403/407), or another server altogether.
    if (!MerkezLink.fromMerkez(response, data)) return response.status >= 500 ? merkezProblem('down') : [401, 403, 407].includes(response.status) ? merkezProblem('address', response.status) : merkezProblem('address', 'foreign');
    // Merkez itself refused this address (Host check, Mola Yönetim only) or does not know the call (older Mola Yönetim).
    if (data.code === 'HOST_REJECTED' || data.code === 'LOCAL_ONLY') return merkezProblem('address', response.status);
    if (response.status === 404 && data.code === 'NOT_FOUND') return merkezProblem('address', 404);
    return new DomainError(typeof data.code === 'string' ? data.code : 'MERKEZ_ERROR', typeof data.message === 'string' ? data.message : 'Mola Merkez isteği tamamlayamadı.', response.status >= 500 ? 502 : response.status);
  }
  /** A 200 that is not Merkez's (a Wi-Fi login page, another server): said so instead of a parse error. */
  private static async answer<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!MerkezLink.fromMerkez(response)) throw merkezProblem('address', 'foreign');
    try { return JSON.parse(text) as T; } catch { throw merkezProblem('address', 'foreign'); }
  }
  /** Activation: no install secret yet; the answer's licence is verified with the public key before anything is kept. */
  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    this.learn(response);
    if (!response.ok) throw await this.failure(response);
    return await MerkezLink.answer<T>(response);
  }
  /** A signed call to the announced new Merkez address (checkAddress): same install signature, same answer check. */
  private signedAt<T>(base: string, path: string, body: unknown) { return this.signed<T>(path, body, true, 15_000, base); }
  /** `bytes`: a raw body instead of `body` as JSON (signed byte for byte all the same). */
  private async signed<T>(path: string, body: unknown, retry = true, timeout = 15_000, base?: string, bytes?: Buffer): Promise<T> {
    const record = this.read()!, payload = bytes ?? JSON.stringify(body), route = MERKEZ_API + path;
    const headers = signedHeaders(record.installId, record.secret, 'POST', route, payload, this.now().getTime() + this.skew);
    const response = await this.request(path, { method: 'POST', headers: { 'Content-Type': bytes ? 'application/octet-stream' : 'application/json', ...headers }, body: bytes ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) as Uint8Array<ArrayBuffer> : payload as string }, timeout, base);
    this.learn(response);
    if (!response.ok) {
      const error = await this.failure(response);
      // The computer's clock is off: Merkez's own time came with the answer, so one more try passes.
      if (error.code === 'CLOCK_SKEW' && retry) return this.signed(path, body, false, timeout, base, bytes);
      if (error.code === 'CLOCK_SKEW') throw merkezProblem('clock', 'skew');
      throw error;
    }
    if (!MerkezLink.fromMerkez(response)) throw merkezProblem('address', 'foreign');
    const answer = await response.text();
    if (!sameSignature(responseSignature(record.secret, headers[HEADER.nonce], answer), response.headers.get(HEADER.signature) ?? '')) throw new DomainError('MERKEZ_SIGNATURE', 'Mola Merkez yanıtı doğrulanamadı.', 502);
    return JSON.parse(answer) as T;
  }
  /**
   * Otomatik güncelleme: a signed GET (release manifest, archive with Range). The answer is returned as it is, whatever its
   * status: its content is checked by the release's own Ed25519 signature and SHA-256 (server/update-agent.ts), not here.
   */
  async signedGet(path: string, extra: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
    const record = this.read();
    if (!record) throw new DomainError('NOT_ACTIVATED', 'Mola bu bilgisayarda henüz etkinleştirilmedi.', 409);
    this.assertSecureUrl();
    const route = MERKEZ_API + path, headers = signedHeaders(record.installId, record.secret, 'GET', route, '', this.now().getTime() + this.skew);
    // Slow café lines: up to 30 minutes for one archive request; a cut one is resumed with Range next time.
    const limit = AbortSignal.timeout(30 * 60_000), both = signal ? AbortSignal.any([signal, limit]) : limit;
    let response: Response;
    try { response = await (this.options.fetch ?? fetch)(this.url + route, { method: 'GET', headers: { ...headers, ...extra }, signal: both }); }
    catch (error) { if (signal?.aborted) throw error; throw networkProblem(error, this.url); }
    this.learn(response);
    return response;
  }
}
