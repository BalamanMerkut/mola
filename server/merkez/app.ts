import express, { type Express, type Request, type Response } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { sectors } from '../../packages/domain/sector.js';
import { DomainError } from '../../packages/domain/engine.js';
import { adminAuthRoutes, OWNER } from '../admin-auth.js';
import { actorOf, adminUserRoutes, adminUsersOf } from './admin-users.js';
import { ExpiringStore } from '../expiring-store.js';
import { clientKey, configureHttpSecurity, directLoopback, loopbackRequest, type HttpSecurity } from '../http-security.js';
// "Göz at": Windows' folder window on this computer (server/merkez/folder-picker.ts), only for a direct loopback admin request.
import { folderPicker, type FolderPicker } from './folder-picker.js';
import { CLOCK_WINDOW_MS, HEADER, newInstallSecret, requestSignature, responseSignature, sameSignature } from '../install-auth.js';
import { endFreeze, requestFreeze, reviewFreeze } from '../license-freeze.js';
import { APP_VERSION, contactSchema, emptyContact, extendMonths, keyFingerprint, licenseSummary, showFingerprint, signContact, signPulse, signRemoval, type License, type Ticket } from '../license.js';
import { sameBusinessName } from '../../packages/domain/invoice.js';
import { addAlert, queueMail, type MailSettings } from './alerts.js';
import type { MerkezBackups, MerkezRecovery } from './backup.js';
import type { KeyProtectionView } from './key-guard.js';
import { MailError, senderOf, sendMail, validAddress, validSettings } from './mail.js';
import { requestDiagnostics } from '../request-diagnostics.js';
import { agreementAcceptance, applicationForm, codeLocationOnly, invoiceSchema, KEY_MISMATCH, MERKEZ_ACCEPTS, MERKEZ_API, syncRequest, type ActivationResult, type ApplicationAnswer, type SyncResponse } from '../sync-protocol.js';
// Mola Lisans Sözleşmesi and the program files check (server/merkez/integrity.ts).
import { IntegrityBook, keepAgreement, recordAgreements } from './integrity.js';
import { codeHash, resetCodeHash, type Application, type Install, type MerkezBusiness, type MerkezData, type MerkezStore } from './store.js';
import { releaseRoutes, Releases, releaseUploadRoute } from './releases.js';
import { releaseRight } from './step-up.js';
import { attachmentIds, attachmentRoutes, Attachments } from './attachments.js';
// Sunucu yedeği ("B planı"): the cafés' encrypted off-site copies, ciphertext only (server/merkez/backup-vault.ts).
import { BackupVault, backupVaultRoutes, sweepVault } from './backup-vault.js';
// Tanıtım işletmesi and "Merkez adresi" (Dalga 3): their routes and signed heartbeat parts (server/merkez/demo.ts).
import { demoRoutes, demoView, merkezAddressFrom, recordDemoReports, setAddress, signedNotes } from './demo.js';
import { RelayHub, relayRoutes } from './relay.js';
import { remoteAdminRoutes } from './remote-admin.js';
// İşlem kayıtları, Çalışma klasörü, Geliştirici erişimi (server/merkez/journal*.ts, workfolder.ts, access-tokens.ts).
import { ADMIN_ACTOR, contextFor, journalContext } from './journal.js';
import { journalRoutes } from './journal-routes.js';
import { bearer, tokenGuard, type TokenScope } from './access-tokens.js';
import { WorkFolder } from './workfolder.js';
import type { AuthEvent } from '../admin-auth.js';
// Hizmet paketleri, fiyatlar ve Satışlarım (server/merkez/catalog.ts, sales.ts).
import { assignServices, catalogRoutes, catalogView, ensureCatalog, servicesView } from './catalog.js';
import { paymentSchema, saleFromExtension, SalesBook, salesRoutes } from './sales.js';
import { LEGACY_FULL, LEGACY_MENU } from '../../packages/domain/service-pricing.js';
// Duyurular (server/merkez/announcements.ts): the vendor's messages to every business, some packages or chosen ones.
import { announcementRoutes, deliverAnnouncements, forgetAnnouncementsOf } from './announcements.js';
// Sosyal medya kısa adresleri (server/merkez/social.ts): the cafés' public links and the QR codes' /s/<code>/<platform>.
import { recordSocial, socialRoutes, socialView } from './social.js';
import { ownerLoginRoutes, recordOwners } from './owner-login.js';
import { shortLinkOrigin, siteLeadRoutes } from './site-leads.js';
// İnternetten menü (server/merkez/guest-tunnel.ts): the cafés' guest tunnels and the public /q/<kod>/… addresses.
import { GuestTunnelHub, guestTunnelRoutes, menuOpen, recordTunnel } from './guest-tunnel.js';
import { MENU_ORIGIN_FLAG, menuHostName, menuHostRoutes, menuOrigin } from './menu-host.js';
// Menünün Mola Merkez'deki kopyası (8 Ekim): the cafés' guest-visible menus and photos, served while a café is away (server/merkez/menu-mirror.ts).
import { MenuMirrorStore, menuMirrorRoutes } from './menu-mirror.js';

/*
 * Mola Merkez HTTP API.
 *   /api/merkez/admin/*  the vendor's Mola Yönetim (cookie session, password + optional TOTP)
 *   /api/merkez/v1/*     café installs: activation (trial or one-time code) and the signed heartbeat ("sync")
 *   /api/merkez/v1/relay/*, /phone/*  köprü: uzaktan destek and Raporlarım (server/merkez/relay.ts; relay calls are signed
 *                        exactly like /sync, the phone's carry only ciphertext). /api/merkez/v1/releases (otomatik güncelleme: signed
 * releases the café downloads, installs at the next start or when idle, after a backup, with automatic rollback) lives in
 * server/merkez/releases.ts.
 */
const DAY = 86400000, CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', CODE_DAYS = 14;
/** Per business and day, from the heartbeat: new support tickets and new messages (the rest waits on the café). */
export const TICKETS_PER_DAY = 20, MESSAGES_PER_DAY = 200;
const id = z.string().min(1).max(100), key = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), machineId = z.string().regex(/^[a-f0-9]{64}$/);
type RawRequest = Request & { rawBody?: Buffer };
/** What a replay record keeps instead of an answer holding a secret: ids only (`ref: 1`); the answer is rebuilt on replay. */
type Ref = { ref: 1; tenantId?: string; installId?: string };
const isRef = (v: unknown): v is Ref => !!v && typeof v === 'object' && (v as Ref).ref === 1;
/**
 * Replay-safe admin and activation calls. An answer with an activation code or install secret is never kept here: `secret`
 * keeps only the ids and rebuilds the answer (a fresh code for an unused one, the install's own secret) when repeated.
 */
function once<T>(d: MerkezData, scope: string, b: object, fn: () => T, secret?: { keep: (result: T) => Ref; replay: (kept: Ref) => T }): T {
  const k = `${scope}:${(b as { requestId: string }).requestId}`, fingerprint = createHash('sha256').update(JSON.stringify(b)).digest('hex'), old = d.requests[k];
  if (old) {
    if (old.fingerprint !== fingerprint) throw new DomainError('CONFLICT', 'İşlem kimliği başka içerikle kullanıldı.', 409);
    return secret && isRef(old.result) ? secret.replay(old.result) : old.result as T;
  }
  const result = fn(); d.requests[k] = { fingerprint, result: secret ? secret.keep(result) : result }; return result;
}
/** Older records kept whole answers (codes, install secrets): reduced to their ids once. */
export function scrubRequests(d: MerkezData) {
  let changed = false;
  for (const r of Object.values(d.requests)) {
    const v = r.result as { code?: unknown; secret?: unknown; tenantId?: string; installId?: string } | null;
    if (v && typeof v === 'object' && !isRef(v) && ('code' in v || 'secret' in v)) { r.result = { ref: 1, ...(v.tenantId ? { tenantId: v.tenantId } : {}), ...(v.installId ? { installId: v.installId } : {}) } satisfies Ref; changed = true; }
  }
  return changed;
}
const normalName = (name: string) => name.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
const invoiceFieldNames: Record<string, string> = { legalName: 'ticari unvan', taxOffice: 'vergi dairesi', taxType: 'mükellef türü', taxNumber: 'vergi / T.C. kimlik no', city: 'il', district: 'ilçe', address: 'adres', phone: 'telefon', email: 'e-posta' };
/** backups/recovery: Merkez's own backup and recovery code (runtime.ts); mail: e-mail sending (tests swap it). */
export type MerkezOptions = { now?: () => Date; httpSecurity?: HttpSecurity; backups?: MerkezBackups; recovery?: MerkezRecovery; sendMail?: typeof sendMail;
  /** How Merkez's data key is kept (server/merkez/key-guard.ts), for Ayarlar → Yedek and the "kurtarma kodu" card. */
  keyProtection?: () => KeyProtectionView;
  /** Otomatik güncelleme: where uploaded release bundles are kept (default: <data folder>-guncellemeler beside it). */
  releasesDirectory?: string;
  /** Destek ekleri: where the sealed files are kept (default: <data folder>-ekler beside it) and the disk guard (tests). */
  attachmentsDirectory?: string; attachmentLimits?: { maxTotalBytes?: number; minFreeBytes?: number };
  /** Sunucu yedeği: where the cafés' encrypted copies are kept (default: <data folder>-sunucu-yedekleri beside it) and its disk guard. */
  cloudBackupDirectory?: string; cloudBackupMinFreeBytes?: number;
  /** Çalışma klasörü: the folder when the vendor has not chosen one (undefined: C:\MolaCalisma for the installed Mola Yönetim, else off). */
  workFolderDefault?: string | null;
  /** Menünün kopyası: where the photos of the cafés' menu copies are kept (default: <data folder>-menu beside it). */
  menuMirrorDirectory?: string;
  /** Tests: the "İşletmem var" code e-mail goes here instead of SMTP. */
  ownerLoginMail?: typeof sendMail;
  /** Merkez's own built screens (runtime.ts, serveBuild): the guest menu's files are served from here when they are the café's exact bytes. */
  buildDirectory?: string;
  /** The guest menu's own origin (default: MERKEZ_MENU_ORIGIN; null: none; server/merkez/menu-host.ts). */
  menuOrigin?: string | null;
  /** "Göz at" (Yedek → İkinci yedek yeri, Çalışma klasörü): the folder window and quick places (tests pass a fake runner). */
  folderPicker?: FolderPicker };
/**
 * Events the clock brings (run every 10 minutes by runtime.ts): a café not heard from for 3 days, a licence ending within 7.
 * Each once (per last contact, per end date).
 */
export function sweepAlerts(store: MerkezStore, now: Date) {
  const d = store.read(), t = now.getTime(), due: [string, Parameters<typeof addAlert>[2], string, { title?: string; priority?: 'low' }?][] = [];
  const secondTold = new Set<string>();
  for (const b of d.businesses) {
    if (!b.installId || b.suspended) continue;
    const report = store.report(b.tenantId), seen = [report?.lastSeenAt, d.installs.find(i => i.id === b.installId)?.lastSeenAt].filter(Boolean).sort().at(-1);
    if (seen && t - Date.parse(seen) > 3 * DAY) due.push([`offline:${b.tenantId}:${seen}`, 'cafe.offline', `${b.name}: işletmenin bilgisayarı ${Math.floor((t - Date.parse(seen)) / DAY)} gündür Mola Merkez’e bağlanmadı (14 günde siparişi kapanır).`]);
    const left = b.endsAt ? Date.parse(b.endsAt) - t : Infinity;
    if (left > 0 && left <= 7 * DAY) due.push([`expiring:${b.tenantId}:${b.endsAt}`, 'license.expiring', `${b.name}: lisans ${Math.ceil(left / DAY)} gün içinde bitiyor (${new Date(b.endsAt!).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}).`]);
    // Part of "yedek alınamıyor", but low: a reminder for the next call, never an e-mail or a sound. One per computer (install).
    const missing = report?.backup.enabled ? report.secondMissingSince : undefined;
    if (missing && t - Date.parse(missing) > SECOND_BACKUP_DAYS * DAY && !secondTold.has(b.installId) && secondTold.add(b.installId)) due.push([`second:${b.tenantId}:${missing}`, 'cafe.backup', `${b.name}: ${SECOND_BACKUP_DAYS} günden uzun süredir ikinci yedek yeri (flash bellek ya da OneDrive klasörü) ayarlı değil. Bilgisayar bozulursa yedekler de onunla gider; işletme şerit → Yedekle → İkinci yedek yeri’nden seçebilir.`, { title: 'İkinci yedek yeri ayarlı değil', priority: 'low' }]);
  }
  const fresh = due.filter(([key]) => !(d.alerts ?? []).some(a => a.key === key));
  if (fresh.length) store.mutate(x => { for (const [key, kind, text, more] of fresh) addAlert(x, now.toISOString(), kind, text, { tenantId: key.split(':')[1], key, ...more }); });
  return fresh.length;
}
/**
 * The café's HMAC-signed POST routes under /api/merkez/v1 (Express matches paths case-insensitively and with a trailing slash,
 * so this does too). Everything else there is public and small (PUBLIC_BODY_MAX), except /phone/admin.
 */
const SIGNED_POST = /^\/(sync|owner-reset|address\/proof|attachments|menu|menu\/photo\/[^/]+\/[^/]+|cloud-backup\/(begin|chunk|chunk-bin\/[^/]+\/[^/]+\/[^/]+|commit|list|read)|relay\/(poll|state|reply|pairing|postbox))\/?$/i;
const PUBLIC_BODY_MAX = 64 * 1024;
/** "İkinci yedek yeri ayarlı değil" becomes a (low) alert after this many days. */
export const SECOND_BACKUP_DAYS = 7;
/** The admin's own address: "Yönetici e-postası", else the notification address. */
export const adminAddress = (s?: MailSettings) => s ? (s.adminEmail || s.to) : undefined;
/** SMTP settings that can send (a server, a sender, the app password when there is a user, an admin address): the e-mail reset is on. */
export const smtpReady = (s?: MailSettings): s is MailSettings => !!s && !!s.host && !!senderOf(s) && (!s.user || !!s.password) && validAddress(adminAddress(s) ?? '');
/** "s•••@ornek.com" for the history: which mailbox, without writing the address out. */
const maskAddress = (a: string) => a.replace(/^(.)[^@]*(@.*)$/, '$1•••$2');
/** Why a remote owner session ended, as the café reports it (server/remote-admin.ts). */
const REMOTE_ENDED = { logout: 'Çıkış yapıldı', owner: 'İşletme sahibi kapattı', off: 'Uzaktan yönetim kapatıldı', device: 'Cihazın eşleşmesi kaldırıldı', expired: 'İş günü bitti (05:00)', ended: 'Oturum kafede kapatıldı', restart: 'Kafe bilgisayarı yeniden başladı' } as const;

export function createMerkezApp(store: MerkezStore, options: MerkezOptions = {}) {
  const now = options.now ?? (() => new Date()); store.clock = now;
  // Remote owner session reports already written (a heartbeat whose answer was lost sends them again); 90 days are enough.
  store.db.exec('CREATE TABLE IF NOT EXISTS remote_admin_seen (k TEXT PRIMARY KEY, at TEXT NOT NULL)');
  store.db.prepare('DELETE FROM remote_admin_seen WHERE at < ?').run(new Date(now().getTime() - 90 * DAY).toISOString());
  const app = express(); app.disable('x-powered-by'); app.set('env', 'production');
  // İşlem kayıtları: who and from where, for every line this request writes (server/merkez/journal.ts journalContext).
  app.use((req, _res, next) => journalContext.run(contextFor(req), next));
  const diagnostics = requestDiagnostics(event => console.error(JSON.stringify(event)));
  app.use('/api', diagnostics.begin);
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); next(); });
  // Every install answer carries Merkez's clock, so a café with a wrong clock can still sign requests that pass.
  app.use(MERKEZ_API, (_req, res, next) => { res.set('X-Mola-Server-Time', now().toISOString()); next(); });
  // Misafir menüsünün kendi adresi (MERKEZ_MENU_ORIGIN, server/merkez/menu-host.ts): /q/* only there, nothing else there.
  const siteOrigin = shortLinkOrigin(options.httpSecurity?.publicOrigin);
  const guestOrigin = options.menuOrigin === null ? undefined : menuOrigin(options.httpSecurity?.publicOrigin, siteOrigin, options.menuOrigin);
  if (guestOrigin) menuHostRoutes(app, guestOrigin);
  configureHttpSecurity(app, options.httpSecurity ?? {}, guestOrigin ? [menuHostName(guestOrigin)] : []);
  // Mola Yönetim (its screens and /api/merkez/admin) answers only this computer, unless Merkez runs behind HTTPS
  // (PUBLIC_ORIGIN). MERKEZ_LAN opens the café-facing /api/merkez/v1 to the network and nothing else: the vendor's
  // password never crosses a LAN in plain HTTP.
  const httpsOrigin = options.httpSecurity?.publicOrigin;
  app.use((req, res, next) => {
    // /s/: the social QR codes' public short addresses (server/merkez/social.ts), reachable like the café calls; /q/: the guest
    // menu over the internet (server/merkez/guest-tunnel.ts).
    if (req.path === MERKEZ_API || req.path.startsWith(`${MERKEZ_API}/`) || req.path.startsWith('/s/') || req.path.startsWith('/q/') || (httpsOrigin ? req.secure : loopbackRequest(req))) return next();
    res.status(403);
    if (req.path.startsWith('/api/')) res.json({ code: 'LOCAL_ONLY', message: 'Mola Yönetim yalnız Mola Merkez’in çalıştığı bilgisayardan açılır.' });
    else res.type('text/plain').send('Mola Yönetim yalnız Mola Merkez’in çalıştığı bilgisayardan açılır.');
  });
  // Güvenlik denetimi (docs/GUVENLIK_DENETIMI.md): before a byte of a body is read. Signed café calls carry up to 15 MB: their
  // install headers (format, a known install, the clock) are checked first, so nobody without an install makes Merkez buffer and
  // parse large bodies. The full check (HMAC over the exact body, the nonce) follows in each route as before. Public calls are
  // small (a code, a form, a phone's token); only the owner's paired device sends large sealed requests (limited in its route).
  app.use(MERKEZ_API, (req, _res, next) => {
    if (req.method !== 'POST') return next();
    if (SIGNED_POST.test(req.path)) {
      const installId = req.get(HEADER.install) ?? '', time = req.get(HEADER.time) ?? '', nonce = req.get(HEADER.nonce) ?? '', signature = req.get(HEADER.signature) ?? '';
      const refuse = () => next(new DomainError('INSTALL_AUTH', 'Kurulum kimliği doğrulanamadı.', 401));
      if (!/^[a-f0-9-]{36}$/.test(installId) || !/^\d{10,16}$/.test(time) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return refuse();
      const d = store.read();
      if (!d.installs.some(i => i.id === installId && !i.revokedAt) && !d.removed?.some(r => r.installId === installId && r.secret)) return refuse();
      if (Math.abs(Number(time) - now().getTime()) > CLOCK_WINDOW_MS) return next(new DomainError('CLOCK_SKEW', 'Bilgisayarın saati Mola Merkez saatinden çok farklı.', 401));
      return next();
    }
    if (/^\/phone\/admin\/?$/i.test(req.path)) return next();
    if (req.headers['transfer-encoding'] !== undefined || Number(req.get('content-length') ?? 0) > PUBLIC_BODY_MAX) return next(new DomainError('PAYLOAD_TOO_LARGE', 'Gönderilen içerik çok büyük. İçeriği küçültüp tekrar deneyin.', 413));
    next();
  });
  // İnternetten menü: the cafés' tunnels (WebSocket upgrades: runtime.ts tunnelUpgrades) and the guests' /q/<kod>/… (before the
  // JSON parser: a guest's order goes on to the café byte for byte). Nothing of it is logged.
  // The menu copies: one sealed row per business, photos sealed beside the data folder (<data>-menu/), never in Merkez's backup.
  const menuMirror = new MenuMirrorStore(store, options.menuMirrorDirectory ?? `${store.directory.replace(/[\\/]+$/, '')}-menu`); menuMirror.tidy(); app.locals.menuMirror = menuMirror;
  const guestTunnel = new GuestTunnelHub(store, now, { publicOrigin: options.httpSecurity?.publicOrigin, trustLocalProxy: options.httpSecurity?.trustLocalProxy, buildDirectory: options.buildDirectory, mirror: menuMirror });
  app.locals.guestTunnel = guestTunnel;
  guestTunnelRoutes(app, { hub: guestTunnel, store, now, publicOrigin: options.httpSecurity?.publicOrigin, siteOrigin, menuOrigin: guestOrigin });
  // Otomatik güncelleme: the bundle upload is raw bytes, so it comes before the JSON-only rule (the admin session is checked inside).
  const releases = new Releases(store, options.releasesDirectory ?? `${store.directory.replace(/[\\/]+$/, '')}-guncellemeler`);
  // Program dosyaları denetimi: each install's latest result (table integrity_status); the signed lists are the releases'.
  const integrity = new IntegrityBook(store);
  const releaseDeps =() => ({ store, releases, now, admin, authenticate: (req: Request) => authenticate(req as RawRequest),
    limitAddress: (req: Request, purpose: string, max: number, ms: number) => limit(addressPool, `${purpose}:${clientKey(req)}`, max, ms),
    limitInstall: (install: string, purpose: string, max: number, ms: number) => limit(installPool, `${purpose}:${install}`, max, ms) });
  // Güncellemeler also take a "releases" token (Geliştirici erişimi; npm run yayinla), never the other admin routes.
  releaseUploadRoute(app, () => ({ ...releaseDeps(), admin: releaseAdmin, right }));
  // Destek ekleri (server/merkez/attachments.ts): Mola Yönetim's raw upload and the café's signed JSON upload (up to 10 MB)
  // come before the JSON-only rule and the 64 kB parser. Files beside the data folder (merkez-ekler/), never in backups.
  const attachments = new Attachments(store, options.attachmentsDirectory ?? `${store.directory.replace(/[\\/]+$/, '')}-ekler`, options.attachmentLimits);
  app.locals.attachments = attachments;
  attachmentRoutes(app, () => ({ ...releaseDeps(), attachments, sendSigned }));
  // Sunucu yedeği (server/merkez/backup-vault.ts): signed JSON chunks (up to 8 MB) before the JSON-only rule and the 64 kB parser.
  // Ciphertext beside the data folder (<data>-sunucu-yedekleri/), never in Merkez's own backup (they are backups already).
  const vault = new BackupVault(options.cloudBackupDirectory ?? `${store.directory.replace(/[\\/]+$/, '')}-sunucu-yedekleri`, { minFreeBytes: options.cloudBackupMinFreeBytes });
  app.locals.backupVault = vault;
  backupVaultRoutes(app, () => ({ ...releaseDeps(), vault, sendSigned }));
  // "İşletmem var" (server/merkez/owner-login.ts): the owner's own sign-in on a new computer, a code to the business's e-mail.
  ownerLoginRoutes(app, () => ({ ...releaseDeps(), vault, sendSigned, ...(options.ownerLoginMail ? { send: options.ownerLoginMail } : {}) }));
  { const t = setInterval(() => { try { sweepVault(vault, store, now()); } catch { /* closed or busy: next time */ } }, 10 * 60_000); t.unref(); }
  // Köprü (server/merkez/relay.ts): uzaktan destek and uzaktan raporlar. Before the JSON-only rule and the 64 kB parser (held
  // polls, relayed photos); its postbox is beside the data folder (<data>-kutu/), never in a backup.
  const relayHub = new RelayHub(store, now); relayHub.attach((res, secret, nonce, body) => sendSigned(res, secret, nonce, body));
  app.locals.relayHub = relayHub;
  // Sahibin uzaktan yönetimi (server/merkez/remote-admin.ts): sealed requests only; before relayRoutes (its body parser first).
  remoteAdminRoutes(app, releaseDeps, relayHub);
  relayRoutes(app, () => ({ ...releaseDeps(), sendSigned }), relayHub);
  // The menu copy (up to 2 MB of JSON) and its photos (raw bytes): signed like the heartbeat, before the JSON-only rule.
  menuMirrorRoutes(app, menuMirror, () => ({ ...releaseDeps(), sendSigned }));
  app.use('/api', (req, _res, next) => { if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return next(new DomainError('JSON_REQUIRED', 'JSON içerik gerekli.', 415)); next(); });
  // The heartbeat body is signed byte for byte: keep the raw body for the check.
  app.use(`${MERKEZ_API}/sync`, express.json({ limit: '512kb', verify: (req, _res, buf) => { (req as RawRequest).rawBody = buf; } }));
  app.use(`${MERKEZ_API}/owner-reset`, express.json({ limit: '4kb', verify: (req, _res, buf) => { (req as RawRequest).rawBody = buf; } }));
  // "Merkez adresi" proof (server/merkez/demo.ts): signed like the heartbeat.
  app.use(`${MERKEZ_API}/address/proof`, express.json({ limit: '4kb', verify: (req, _res, buf) => { (req as RawRequest).rawBody = buf; } }));
  app.use(express.json({ limit: '64kb' }));
  // Separate pools per kind of key: a flood of fresh addresses can only push out other addresses' counters, never an
  // install's or a business's; the overall ceilings are plain counters nothing can evict.
  type Counter = { count: number; until: number };
  const pool = () => new ExpiringStore<Counter>(v => v.until, () => now().getTime(), 20000, true);
  const addressPool = pool(), installPool = pool(), ticketPool = pool(), overall = new Map<string, Counter>();
  /** Counts one; false once `max` is passed within the window. */
  function take(p: ExpiringStore<Counter> | Map<string, Counter>, k: string, max: number, ms: number) {
    const t = now().getTime(); let l = p.get(k);
    if (!l || l.until <= t) { l = { count: 0, until: t + ms }; p.set(k, l); }
    return ++l.count <= max;
  }
  function limit(p: ExpiringStore<Counter> | Map<string, Counter>, k: string, max: number, ms: number) {
    if (!take(p, k, max, ms)) throw new DomainError('RATE_LIMIT', 'Çok sık deneme yapıldı. Biraz bekleyip tekrar deneyin.', 429);
  }
  const at = () => now().toISOString();
  // Hizmet paketleri: the first start of this version seeds packages and maps every business to its old plan (additive).
  ensureCatalog(store, now());
  /** Satışlarım: the vendor's own sales ledger (its own table in merkez.sqlite). */
  const sales = new SalesBook(store);
  const mailer = options.sendMail ?? sendMail;
  /** The vendor's contact, signed for the cafés (heartbeat answer, public /contact); undefined until it was saved once. */
  const signedContact = (d: MerkezData) => d.contact ? signContact({ v: 1, phone: d.contact.phone, whatsapp: d.contact.whatsapp, email: d.contact.email, hours: d.contact.hours, web: d.contact.web, updatedAt: d.contact.updatedAt }, store.signingKey) : undefined;

  // ---------- Vendor admin ----------
  const auth = adminAuthRoutes(app, {
    read: () => store.read().admin,
    change: fn => store.mutate(d => fn(d, (action, detail) => d.audit.push({ action, target: 'admin', at: at(), ...(detail ? { detail } : {}) }))),
  }, { prefix: '/api/merkez/admin', cookie: 'mola_merkez', label: 'Mola Yönetim', issuer: 'Mola Yönetim', now,
    // Yetkililer (Ayarlar → Kullanıcılar, server/merkez/admin-users.ts): own sign-in, password and two-step login.
    users: adminUsersOf(store, at),
    // A business's name on this Merkez is no password either.
    weakWords: () => store.read().businesses.map(b => b.name),
    // "Şifremi unuttum": only from this computer's own browser, never through a proxy and never on a public (HTTPS) Merkez:
    // there the vendor connects to the server (SSH) and runs the offline command (scripts/merkez-sifre-sifirla.ts).
    reset: {
      allowed: req => !httpsOrigin && loopbackRequest(req),
      ...(options.recovery ? { recoveryCode: (code: string) => options.recovery!.matches(code) } : {}),
      // "E-postama kod gönder": only with the vendor's SMTP settings saved; to the "Yönetici e-postası" (else the notification address).
      email: {
        ready: () => smtpReady(store.read().mail?.settings),
        address: () => adminAddress(store.read().mail?.settings),
        send: async (to, code) => {
          const s = store.read().mail?.settings;
          if (!s) return;
          try {
            await mailer(s, to, 'Mola Yönetim: şifre sıfırlama kodu', `Mola Yönetim yönetici şifresini sıfırlamak için kodunuz:\n\n    ${code}\n\nKod 15 dakika geçerlidir ve bir kez kullanılır. İki adımlı giriş açıksa doğrulayıcı uygulamadaki kod da sorulur.\nBu isteği siz yapmadıysanız bu e-postayı dikkate almayın; şifreniz değişmedi. Sık gelirse Mola Yönetim’de iki adımlı girişi açın.\n${at().slice(0, 16).replace('T', ' ')} (UTC)`);
            store.mutate(d => { d.audit.push({ action: 'admin.reset_code_sent', target: 'admin', at: at(), by: 'system', detail: `Şifre sıfırlama kodu e-postayla gönderildi (${maskAddress(to)})` }); });
          } catch (e) {
            store.mutate(d => { d.audit.push({ action: 'admin.reset_code_failed', target: 'admin', at: at(), by: 'system', detail: e instanceof MailError ? e.message : 'E-posta gönderilemedi.' }); });
          }
        },
      },
      done: ({ proof, mfaReset, second }) => {
        const how = proof === 'merkez' ? 'Merkez kurtarma kodu kullanılarak bu bilgisayarda' : proof === 'mfa' ? 'iki adımlı doğrulamanın bir yedek kodu kullanılarak bu bilgisayarda'
          : `e-postaya gönderilen kodla${second === 'totp' ? ' ve doğrulayıcı koduyla' : second === 'merkez' ? ' ve Merkez kurtarma koduyla' : ' (iki adımlı giriş kapalıyken)'}`;
        const text = `Mola Yönetim yönetici şifresi “Şifremi unuttum” ile ${how} yenilendi. Bütün yönetici oturumları kapatıldı.${mfaReset ? ' İki adımlı giriş de kapatıldı: Ayarlar → Hesap güvenliği’nden yeniden kurun.' : ''} Bunu siz yapmadıysanız hemen şifreyi değiştirin ve Merkez kurtarma kodunu yenileyin.`;
        const s = store.read().mail?.settings, to = smtpReady(s) ? adminAddress(s) : undefined;
        store.mutate(d => {
          const alert = addAlert(d, at(), 'admin.password_reset', text);
          // "Şifreniz değiştirildi" goes to the admin address below; the same news is not mailed twice to it.
          if (to && alert && d.mail?.settings?.to === to) d.mail.queue = d.mail.queue.filter(m => m.alertId !== alert.id);
        });
        if (to && s) {
          const subject = 'Mola Yönetim: Şifreniz değiştirildi', body = `${text}\n${at().slice(0, 16).replace('T', ' ')} (UTC)`;
          // Not sent now (the server is down, no network): kept in the queue, which tries again while notifications are on.
          void mailer(s, to, subject, body).catch(() => { try { store.mutate(d => { queueMail(d, at(), subject, body, undefined, to); }); } catch { /* Merkez is closing */ } });
        }
      },
    },
    // The first-login file holds the old generated password: of no use once it changed. A locked file must not fail the change.
    onPasswordChanged: () => { try { rmSync(join(store.directory, 'merkez-first-login.txt'), { force: true }); } catch { /* removed later or by hand */ } },
    // Sign-ins, wrong passwords and codes, refusals, sign-outs: İşlem kayıtları only (never the password or the code).
    onEvent: authEvent });
  /** A signed-in admin: the actor of every line this request writes. */
  const admin = (req: Request, o?: { evenIfMustChange?: boolean }) => { const token = auth.admin(req, o); const ctx = journalContext.getStore(); if (ctx && ctx.actor?.kind !== 'token') ctx.actor = actorOf(store, auth.whoOf(req), ADMIN_ACTOR); return token; };
  // Ayarlar → Kullanıcılar: the owner's yetkililer; `ownerOnly` also guards the e-mail settings (server/merkez/admin-users.ts).
  const ownerOnly = adminUserRoutes(app, { store, at, admin: req => admin(req), whoOf: auth.whoOf, endSessions: auth.endSessions, checkPassword: auth.checkPassword, strong: auth.strong }).owner;
  const tokenAuth = tokenGuard(store, now);
  /** Güncellemeler: the admin session, or a "releases" token from Geliştirici erişimi. */
  const releaseAdmin = (req: Request) => bearer(req) !== undefined ? tokenAuth(req, 'releases') : admin(req);
  /** Güncelleme yetkisi (server/merkez/step-up.ts): upload, publish, Durdur, Sil need a fresh Authenticator code. */
  const right = releaseRight({ store, now, confirm: auth.confirmCode, secretOf: who => auth.mfaSecretOf(String(who)) });
  const releaseChange = (req: Request) => { const who = releaseAdmin(req); right.require(who); return who; };
  const tokenOrAdmin = (req: Request, scope: TokenScope) => bearer(req) !== undefined ? tokenAuth(req, scope) : admin(req);
  const refusedTold = new Map<string, number>();
  function authEvent(e: AuthEvent) {
    const action = { login: 'admin.login', login_failed: 'admin.login_failed', login_refused: 'admin.login_refused', logout: 'admin.logout', password_change_failed: 'admin.password_change_failed', check_failed: 'admin.check_failed', reset_failed: 'admin.reset_failed' }[e.kind];
    // A locked-out address keeps trying: one "durduruldu" line per address every 5 minutes is enough.
    if (e.kind === 'login_refused') { const k = clientKey(e.req), t = now().getTime(); if ((refusedTold.get(k) ?? 0) > t - 300_000) return; refusedTold.set(k, t); if (refusedTold.size > 1000) refusedTold.clear(); }
    const actor = e.who ? actorOf(store, e.who, ADMIN_ACTOR) : ADMIN_ACTOR;
    store.journal.append({ action, actor, target: { kind: 'admin', id: e.who && e.who !== OWNER ? e.who : 'admin', name: e.who && e.who !== OWNER ? actor.name ?? 'Yetkili' : 'Yönetici hesabı' }, ...(e.detail ? { detail: e.detail } : {}) });
  }
  const find = (d: MerkezData, tenantId: string) => { const b = d.businesses.find(x => x.tenantId === tenantId); if (!b) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404); return b; };
  const activated = (b: MerkezBusiness) => { if (!b.installId) throw new DomainError('NOT_ACTIVATED', 'İşletme Mola’yı henüz etkinleştirmedi. Önce etkinleştirme kodu kullanılmalı.', 409); return b; };
  function newCode(d: MerkezData, tenantId: string) {
    const text = [...randomBytes(12)].map(n => CODE_ALPHABET[n & 31]).join('').replace(/(.{4})(?!$)/g, '$1-');
    const expiresAt = new Date(now().getTime() + CODE_DAYS * DAY).toISOString();
    d.codes = d.codes.filter(c => c.tenantId !== tenantId || !!c.usedAt);
    d.codes.push({ hash: codeHash(text), tenantId, createdAt: at(), expiresAt });
    return { code: text, codeExpiresAt: expiresAt };
  }
  /** A repeated "İşletme ekle" / "Yeni kod" (its answer was lost): the code was never seen, so a fresh one replaces it. */
  const codeAgain = (d: MerkezData) => ({
    keep: (r: { tenantId: string }): Ref => ({ ref: 1, tenantId: r.tenantId }),
    replay: (kept: Ref): { tenantId: string; code?: string; codeExpiresAt?: string } => { const biz = d.businesses.find(x => x.tenantId === kept.tenantId); return biz && !biz.installId && !biz.application ? { tenantId: biz.tenantId, ...newCode(d, biz.tenantId) } : { tenantId: kept.tenantId ?? '' }; },
  });
  /**
   * Never connected: no heartbeat ever reached Merkez for it (so no owner account either), no ticket, not imported from a
   * working café. Only such a record (a half-made trial, an unused code) can be deleted; anything else is suspended instead.
   */
  const neverConnected = (b: MerkezBusiness, d: MerkezData) => b.source !== 'import' && !store.report(b.tenantId) && !d.installs.find(i => i.id === b.installId)?.lastSeenAt && !d.tickets.some(t => t.tenantId === b.tenantId);
  /**
   * The business, its codes, tickets (and their notification records) and (when nothing else uses it) its install go; old
   * activation answers holding its secret too. Alerts about it stay as plain text (no link), history lines keep its name.
   * `closed`: a connected business deleted after suspension: a tombstone stays so its café hears a signed final answer, and
   * its tax numbers stay marked as a deleted business's.
   */
  function remove(d: MerkezData, b: MerkezBusiness, closed = false) {
    const tickets = new Set(d.tickets.filter(t => t.tenantId === b.tenantId).map(t => t.id));
    d.tickets = d.tickets.filter(t => !tickets.has(t.id)); d.notifications = d.notifications.filter(n => !tickets.has(n.ticketId));
    for (const a of d.alerts ?? []) if (a.tenantId === b.tenantId || (a.ticketId && tickets.has(a.ticketId))) { delete a.tenantId; delete a.ticketId; }
    for (const a of d.audit) if (a.target === b.tenantId || tickets.has(a.target)) a.name ??= b.name;
    d.businesses = d.businesses.filter(x => x !== b); d.codes = d.codes.filter(c => c.tenantId !== b.tenantId);
    if (d.ownerResets) d.ownerResets = d.ownerResets.filter(c => c.tenantId !== b.tenantId);
    for (const [k, r] of Object.entries(d.requests)) if ((r.result as { tenantId?: string } | null)?.tenantId === b.tenantId) delete d.requests[k];
    const install = b.installId ? d.installs.find(i => i.id === b.installId) : undefined, installGoes = !!install && !d.businesses.some(x => x.installId === install.id);
    if (closed && install) (d.removed ??= []).push({ tenantId: b.tenantId, installId: install.id, deletedAt: at(), ...(installGoes ? { secret: install.secret } : {}) });
    if (installGoes) d.installs = d.installs.filter(i => i !== install);
    store.forget(b.tenantId, closed);
    forgetAnnouncementsOf(d, b.tenantId);
    attachments.forgetTenant(b.tenantId, now());
    // Its menu copy and photos go with the record.
    menuMirror.forget(b.tenantId);
    // Sunucu yedeği: the install's copies go with its last business (a copy holds every business of that computer).
    vault.forget(installGoes ? install!.id : undefined, b.tenantId);
  }
  const looseName = (name: string) => normalName(name).replace(/[^\p{L}\p{N}]/gu, '');
  const sameText = (a?: string, b?: string) => !!a?.trim() && !!b?.trim() && looseName(a) === looseName(b);
  const taxDigits = (b: MerkezBusiness) => b.invoice?.taxNumber.replace(/\D/g, '') || undefined;
  /**
   * "Olası tekrar": only strong signals name another record: the same tax number, the same computer (activation fingerprint)
   * with a different tax number, the same phone or e-mail (keyed hashes, MerkezStore.contactHash). A name alone is no hint any
   * more (imports and demos from one computer, common names): only a soft note when two other fields match as well. A branch
   * the vendor accepted is no repeat of its own company.
   */
  // Normalized names and tax numbers once per registry read (the list compares every record with every other).
  const prepared = new WeakMap<MerkezData, Map<MerkezBusiness, { name: string; tax?: string }>>();
  const facts = (d: MerkezData, b: MerkezBusiness) => {
    let all = prepared.get(d);
    if (!all) { all = new Map(d.businesses.map(x => [x, { name: looseName(x.name), tax: taxDigits(x) }])); prepared.set(d, all); }
    return all.get(b) ?? { name: looseName(b.name), tax: taxDigits(b) };
  };
  function duplicatesOf(b: MerkezBusiness, d: MerkezData, contact: Map<string, Set<'phone' | 'email'>>) {
    const { name, tax } = facts(d, b);
    return d.businesses.filter(o => o !== b).flatMap(o => {
      const other = facts(d, o), otherTax = other.tax, sameTax = !!tax && tax === otherTax, sameComputer = !!b.machineId && o.machineId === b.machineId, kinds = contact.get(o.tenantId);
      if (sameTax && (b.application?.branch || o.application?.branch)) return [];
      const reasons: string[] = [];
      if (sameTax) reasons.push('Aynı vergi / T.C. kimlik no');
      if (sameComputer && tax && otherTax && !sameTax) reasons.push('Aynı bilgisayar, farklı vergi no');
      if (kinds?.has('phone')) reasons.push('Aynı telefon');
      if (kinds?.has('email')) reasons.push('Aynı e-posta');
      const strong = reasons.length > 0;
      if (name && other.name === name) {
        if (strong) reasons.push('Aynı ad');
        else {
          const address = (x: MerkezBusiness) => x.invoice ? `${x.invoice.city} ${x.invoice.district} ${x.invoice.address}` : undefined;
          const weak = [sameComputer && 'aynı bilgisayar', sameText(b.contactName, o.contactName) && 'aynı yetkili', sameText(b.invoice?.legalName, o.invoice?.legalName) && 'aynı ticari unvan', sameText(address(b), address(o)) && 'aynı adres'].filter(Boolean);
          if (weak.length >= 2) reasons.push(`Benzer ad; ${weak.join(', ')}`);
        }
      }
      return reasons.length ? [{ tenantId: o.tenantId, name: o.name, createdAt: o.createdAt, sameComputer, neverConnected: neverConnected(o, d), strong, reasons }] : [];
    }).sort((x, y) => Number(y.strong) - Number(x.strong)).slice(0, 8);
  }
  function view(b: MerkezBusiness, d: MerkezData) {
    const r = store.report(b.tenantId), license: License = { tenantId: b.tenantId, name: b.name, endsAt: b.endsAt, suspended: b.suspended, kind: b.kind, planMonths: b.planMonths, service: b.service, freezes: b.freezes, trialStartedAt: b.trialStartedAt, createdAt: b.createdAt };
    const code = !b.installId ? d.codes.find(c => c.tenantId === b.tenantId && !c.usedAt) : undefined;
    // Each possible repeat names the other record and why, so the vendor can open it and see which one is really in use.
    const contact = store.sameContact(b.tenantId), duplicates = duplicatesOf(b, d, contact);
    // Only for the vendor: the same tax number elsewhere (branches), and the same phone or e-mail (flagged, never blocked).
    const others = d.businesses.filter(o => o.tenantId !== b.tenantId && o.invoice), inv = b.invoice;
    const sameTax = inv ? others.filter(o => o.invoice!.taxNumber === inv.taxNumber).map(o => ({ tenantId: o.tenantId, name: o.name })) : [];
    const sameContact = inv ? { phone: [...contact.values()].some(k => k.has('phone')), email: [...contact.values()].some(k => k.has('email')) } : undefined;
    // The computers that sent heartbeats for this install, newest last; more than one means a move or a copy.
    const install = b.installId ? d.installs.find(i => i.id === b.installId) : undefined, seen = install?.lastSeenAt;
    const machines = (install?.machines ?? []).map(m => ({ hash: m.hash, firstSeenAt: m.firstSeenAt, lastSeenAt: m.lastSeenAt, active: !m.replacedAt, ...(m.replacedAt ? { replacedAt: m.replacedAt } : {}), ...(m.restoredAt ? { restoredAt: m.restoredAt } : {}) }));
    return { ...licenseSummary(license, now()), sector: b.sector, contactName: b.contactName, ...(b.formerNames?.length ? { formerNames: b.formerNames } : {}), installId: b.installId, source: b.source, serial: b.serial, activation: b.installId ? 'active' : 'pending', activatedAt: b.activatedAt,
      ...(code ? { codeExpiresAt: code.expiresAt } : {}), lastSeenAt: [r?.lastSeenAt, seen].filter(Boolean).sort().at(-1), firstLoginAt: r?.firstOwnerLoginAt, lastActivityAt: r?.lastActivityAt, appVersion: r?.appVersion ?? '', setupCompleted: r?.setupCompleted ?? false, setupCompletedAt: r?.setupCompletedAt,
      counts: r?.counts, backup: r?.backup, ...(r?.secondMissingSince ? { secondMissingSince: r.secondMissingSince } : {}), openTickets: d.tickets.filter(t => t.tenantId === b.tenantId && t.status === 'open').length, duplicates, neverConnected: neverConnected(b, d), machines,
      // Install last seen (any heartbeat) next to the business report: one connection time on every screen.
      installSeenAt: seen,
      licenseDelivered: !!b.installId && !!r && r.deliveredSerial === b.serial, services: servicesView(d, b), ...(b.notes ? { notes: b.notes } : {}), ...(b.suspendReason ? { suspendReason: b.suspendReason } : {}), ...demoView(b), ...socialView(b),
      // İşletmem var: the address the owner verified in the café (Bilgiler shows it, with Kaldır) and whether the owner's sign-in lock reached us.
      ...(b.ownerEmail ? { ownerEmail: b.ownerEmail } : {}), ownerLoginReady: !!b.ownerLogin,
      // İnternetten menü: the menu code and, live, whether the café's tunnel is up (counters only, nothing of the traffic).
      ...(b.menu && b.installId ? { menu: { code: b.menu.code, since: b.menu.since, open: menuOpen(b, d, now()), ...(({ online, connectedAt, requests, errors, timeouts }) => ({ online, ...(connectedAt ? { connectedAt } : {}), requests, errors, timeouts }))(guestTunnel.view(b.installId)),
        // QR siparişleri as the café said it over the tunnel (null: not in its service; missing: not told: café away or older) and the menu copy.
        ...(guestTunnel.orderingOf(b.installId, b.tenantId) !== undefined ? { ordering: guestTunnel.orderingOf(b.installId, b.tenantId) } : {}), ...(menuMirror.usage(b.tenantId) ? { mirror: menuMirror.usage(b.tenantId) } : {}) } } : {}),
      // Mola Lisans Sözleşmesi (Lisans tab) and the program files check ("Dosyalar değiştirilmiş").
      ...(b.agreement ? { agreement: b.agreement } : {}), ...(b.installId && integrity.status(b.installId) ? { integrity: integrity.status(b.installId) } : {}),
      ...(inv ? { invoice: inv, sameTax, sameContact } : {}), ...(b.application ? { application: (({ status, submittedAt, decidedAt, reason, branch, submissions }, a) => ({ status, submittedAt, firstSubmittedAt: firstOf(a), decidedAt, reason, branch, submissions: submissions ?? 1, duplicateTax: !!a.duplicateTax || duplicateTax(b), deletedTax: deletedTax(b) }))(b.application, b.application) } : {}) };
  }
  app.get('/api/merkez/admin/state', (req, res) => {
    admin(req); const d = store.read();
    const alerts = (d.alerts ?? []).slice(-200);
    res.json({ businesses: d.businesses.map(b => view(b, d)), tickets: d.tickets, notifications: d.notifications, audit: d.audit.slice(-300), alerts, unread: alerts.filter(a => !a.readAt).length, version: APP_VERSION, catalog: catalogView(d) });
  });
  // "İşletme ekle": the vendor prepares the business and its plan; the café enters the one-time code to activate it.
  app.post('/api/merkez/admin/businesses', (req, res) => {
    admin(req);
    const b = z.object({ requestId: key, name: z.string().trim().min(2).max(80), contactName: z.string().trim().max(80).optional(), sector: z.enum(sectors).optional(), kind: z.enum(['trial', 'subscription']).default('subscription'), months: z.union([z.literal(1), z.literal(6), z.literal(12)]).optional(), service: z.enum(['full', 'menu']).optional(), packageId: id.optional(), invoice: invoiceSchema.optional() }).strict()
      .refine(b => b.kind === 'trial' ? b.months === undefined : b.months !== undefined, 'Lisans türüne uygun süre seçin.').parse(req.body);
    res.json(store.mutate(d => once(d, 'business', b, () => {
      const tenantId = randomUUID();
      const biz: MerkezBusiness = { tenantId, name: b.name, ...(b.sector ? { sector: b.sector } : {}), ...(b.contactName ? { contactName: b.contactName } : {}), source: 'admin', serial: 0, kind: b.kind, ...(b.months ? { planMonths: b.months } : {}), endsAt: null, suspended: false, service: b.service ?? 'full', createdAt: at(), ...(b.invoice ? { invoice: b.invoice } : {}) };
      // Hizmet paketi: the chosen package; an older screen's "Tam sistem / Sadece QR menü" maps to the old plans.
      const pkg = b.packageId ? d.catalog?.packages.find(p => p.id === b.packageId) : undefined;
      if (b.packageId && (!pkg || pkg.archived || pkg.legacy)) throw new DomainError('PACKAGE_UNAVAILABLE', 'Bu paket seçilemez. Listeyi yenileyin.', 409);
      assignServices(store, d, biz, { packageId: pkg ? pkg.id : b.service === 'menu' ? LEGACY_MENU : LEGACY_FULL }, now());
      d.businesses.push(biz); if (biz.invoice) indexTax(biz);
      d.audit.push({ action: 'business.created', target: tenantId, at: at(), by: 'admin', detail: `${b.kind === 'trial' ? '30 gün deneme' : `${b.months} ay abonelik`} · ${servicesView(d, biz).packageName}` });
      return { tenantId, ...newCode(d, tenantId) };
    }, codeAgain(d))));
  });
  // "Eski bilgisayarı yeniden etkinleştir": the install goes back to a computer a newer one replaced (that one closes next).
  app.post('/api/merkez/admin/installs/machine', (req, res) => {
    admin(req); const b = z.object({ requestId: key, tenantId: id, machine: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
    res.json(store.mutate(d => once(d, 'install-machine', b, () => {
      const biz = activated(find(d, b.tenantId)), install = d.installs.find(i => i.id === biz.installId), m = install?.machines?.find(x => x.hash === b.machine);
      if (!install || !m) throw new DomainError('NOT_FOUND', 'Bu bilgisayar kaydı bulunamadı. Listeyi yenileyin.', 404);
      const time = at();
      for (const x of install.machines!) if (x !== m && !x.replacedAt) x.replacedAt = time;
      delete m.replacedAt; m.restoredAt = time;
      d.audit.push({ action: 'install.machine_restored', target: biz.tenantId, at: time, by: 'admin', detail: `→ ${m.hash.slice(0, 8)}` });
      return { ok: true, tenantId: biz.tenantId };
    })));
  });
  /*
   * "Kaydı sil". A record that never connected (duplicate half-made trials, a wrong "İşletme ekle") goes after one confirm.
   * A connected business only once it is suspended, and only with its name typed again: its café stays locked for good (a
   * signed "kaydı kapatıldı" with its next heartbeat), its sales data stays on the café computer. Audited with the name.
   */
  app.post('/api/merkez/admin/businesses/delete', (req, res) => {
    admin(req); const b = z.object({ requestId: key, tenantId: id, confirmName: z.string().max(200).optional() }).strict().parse(req.body);
    res.json(store.mutate(d => once(d, 'business-delete', b, () => {
      const biz = find(d, b.tenantId);
      if (neverConnected(biz, d)) { remove(d, biz); d.audit.push({ action: 'business.deleted', target: biz.tenantId, name: biz.name, at: at(), by: 'admin', detail: 'hiç bağlanmamıştı' }); return { ok: true, name: biz.name }; }
      if (!biz.suspended) throw new DomainError('CONNECTED', 'Bu işletme Mola Merkez’e bağlandı. Önce askıya alın, sonra silebilirsiniz.', 409);
      if (!b.confirmName || !sameBusinessName(b.confirmName, biz.name)) throw new DomainError('NAME_MISMATCH', 'Silmek için işletmenin adını aynen yazın.', 409);
      remove(d, biz, true); d.audit.push({ action: 'business.deleted', target: biz.tenantId, name: biz.name, at: at(), by: 'admin', detail: 'askıdaydı, bağlanmıştı' });
      return { ok: true, name: biz.name };
    })));
  });
  // Başvurular: the vendor starts the 30-day trial (the café picks it up within seconds) or refuses it with a reason the café
  // shows; the owner can correct and resubmit the same application. `branch`: accept a number refused as already used.
  app.post('/api/merkez/admin/applications/approve', (req, res) => {
    admin(req); const b = z.object({ requestId: key, tenantId: id, branch: z.boolean().optional() }).strict().parse(req.body);
    res.json(store.mutate(d => once(d, 'application-approve', b, () => {
      const biz = find(d, b.tenantId), a = biz.application;
      if (!a || a.status === 'approved' || biz.installId) throw new DomainError('CONFLICT', 'Başvuru zaten karara bağlandı. Listeyi yenileyin.', 409);
      // Older records refused on arrival for the number ("Reddedildi · aynı numara") may still be accepted as a branch.
      if (a.status === 'rejected' && !(a.duplicateTax && b.branch)) throw new DomainError('CONFLICT', 'Reddedilen başvuru, işletme bilgileri düzeltip yeniden gönderince onaylanabilir.', 409);
      if (a.status === 'pending' && duplicateTax(biz) && !b.branch) throw new DomainError('DUPLICATE_TAX', 'Bu vergi / T.C. kimlik numarası daha önce başka bir kayıtta kullanılmış. Ek şubeyse “Ek şube olarak kabul et”i kullanın; değilse başvuruyu reddedin.', 409);
      if (d.installs.some(i => i.id === a.installId)) throw new DomainError('CONFLICT', 'Bu kurulum başka bir işletmeyle etkinleştirildi.', 409);
      const t = now(), install: Install = { id: a.installId, secret: newInstallSecret(), createdAt: t.toISOString(), machineId: a.machineId, appVersion: a.appVersion, activationId: a.activationId };
      d.installs.push(install);
      biz.installId = install.id; biz.activationId = a.activationId; biz.activatedAt = t.toISOString(); biz.kind = 'trial'; biz.trialStartedAt = t.toISOString(); biz.endsAt = new Date(t.getTime() + 30 * DAY).toISOString();
      a.status = 'approved'; a.decidedAt = t.toISOString(); delete a.reason; if (b.branch) a.branch = true;
      store.issue(biz, t); indexTax(biz); d.audit.push({ action: b.branch ? 'application.branch_approved' : 'application.approved', target: biz.tenantId, at: t.toISOString() });
      return { ok: true };
    })));
  });
  app.post('/api/merkez/admin/applications/reject', (req, res) => {
    admin(req); const b = z.object({ requestId: key, tenantId: id, reason: z.string().trim().min(3).max(300) }).strict().parse(req.body);
    res.json(store.mutate(d => once(d, 'application-reject', b, () => {
      const biz = find(d, b.tenantId), a = biz.application;
      if (!a || a.status !== 'pending') throw new DomainError('CONFLICT', 'Yalnız onay bekleyen başvuru reddedilebilir. Listeyi yenileyin.', 409);
      a.status = 'rejected'; a.reason = b.reason; a.decidedAt = at(); delete a.duplicateTax;
      indexTax(biz); d.audit.push({ action: 'application.rejected', target: biz.tenantId, at: at() });
      return { ok: true };
    })));
  });
  // "Fatura bilgileri" in the Genel tab: for applications and for businesses the vendor added.
  app.post('/api/merkez/admin/invoice', (req, res) => {
    admin(req); const b = z.object({ requestId: key, tenantId: id, invoice: invoiceSchema }).strict().parse(req.body);
    res.json(store.mutate(d => once(d, 'invoice', b, () => {
      const biz = find(d, b.tenantId), before = biz.invoice;
      const changed = before ? (Object.keys(b.invoice) as (keyof typeof b.invoice)[]).filter(k => before[k] !== b.invoice[k]) : [];
      biz.invoice = b.invoice; indexTax(biz);
      // Which fields changed, never their values (the history is not a second copy of invoice data).
      d.audit.push({ action: 'invoice.updated', target: biz.tenantId, at: at(), by: 'admin', detail: before ? `Değişen: ${changed.map(k => invoiceFieldNames[k]).join(', ') || 'yok'}` : 'İlk kez girildi' }); return { ok: true };
    })));
  });
  // Vendor notes per business: only in Mola Yönetim, never sent to the café.
  app.post('/api/merkez/admin/notes', (req, res) => {
    admin(req); const b = z.object({ requestId: key, tenantId: id, notes: z.string().max(4000) }).strict().parse(req.body);
    res.json(store.mutate(d => once(d, 'notes', b, () => {
      const biz = find(d, b.tenantId); const text = b.notes.trim();
      if (text) biz.notes = text; else delete biz.notes;
      d.audit.push({ action: 'notes.updated', target: biz.tenantId, at: at(), by: 'admin' }); return { ok: true };
    })));
  });
  app.post('/api/merkez/admin/codes', (req, res) => {
    admin(req); const b = z.object({ requestId: key, tenantId: id }).strict().parse(req.body);
    res.json(store.mutate(d => once(d, 'code', b, () => {
      const biz = find(d, b.tenantId);
      if (biz.installId) throw new DomainError('ALREADY_ACTIVE', 'İşletme zaten etkinleştirildi.', 409);
      if (biz.application) throw new DomainError('CONFLICT', 'Başvuru ile gelen işletme kodla değil, “30 günlük denemeyi başlat” ile etkinleşir.', 409);
      d.audit.push({ action: 'code.created', target: biz.tenantId, at: at(), by: 'admin' });
      return { tenantId: biz.tenantId, ...newCode(d, biz.tenantId) };
    }, codeAgain(d))));
  });
  /*
   * "Sahip şifresi sıfırlama kodu ver": the owner lost both the password and the recovery code. A one-time code (shown once,
   * read out on the phone), valid 30 minutes, bound to this business's install: the café checks it with Merkez over its
   * signed link, so it is useless at any other café. Only its hash stays here; a new one replaces an unused older one.
   */
  const RESET_MINUTES = 30;
  function newResetCode(d: MerkezData, biz: MerkezBusiness) {
    const text = [...randomBytes(12)].map(n => CODE_ALPHABET[n & 31]).join('').replace(/(.{4})(?!$)/g, '$1-');
    const t = now(), expiresAt = new Date(t.getTime() + RESET_MINUTES * 60_000).toISOString();
    d.ownerResets = (d.ownerResets ?? []).filter(c => c.tenantId !== biz.tenantId && Date.parse(c.expiresAt) > t.getTime() - DAY);
    d.ownerResets.push({ hash: resetCodeHash(text), tenantId: biz.tenantId, installId: biz.installId!, createdAt: t.toISOString(), expiresAt });
    return { tenantId: biz.tenantId, code: text, expiresAt };
  }
  const resettable = (d: MerkezData, tenantId: string) => {
    const biz = activated(find(d, tenantId));
    if (biz.suspended) throw new DomainError('SUSPENDED', 'Hizmet askıdaki işletmeye şifre sıfırlama kodu verilemez.', 409);
    if (!d.installs.some(i => i.id === biz.installId)) throw new DomainError('NOT_ACTIVATED', 'İşletmenin kurulumu bulunamadı.', 409);
    return biz;
  };
  app.post('/api/merkez/admin/owner-reset-codes', (req, res) => {
    admin(req); const b = z.object({ requestId: key, tenantId: id }).strict().parse(req.body);
    res.json(store.mutate(d => once(d, 'owner-reset-code', b, () => {
      const biz = resettable(d, b.tenantId);
      d.audit.push({ action: 'owner_reset.issued', target: biz.tenantId, at: at(), by: 'admin', detail: `${RESET_MINUTES} dakika geçerli, tek kullanımlık` });
      return newResetCode(d, biz);
    // A repeated request (its answer was lost): the code was never seen, so a fresh one replaces it.
    }, { keep: (r: { tenantId: string }): Ref => ({ ref: 1, tenantId: r.tenantId }), replay: (kept: Ref) => newResetCode(d, resettable(d, kept.tenantId ?? '')) })));
  });
  const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }) : 'başlamadı';
  /*
   * Lisans: "1 ay / 6 ay / 1 yıl uzat" only adds time; a subscription keeps its plan (a yearly one stays yearly, with its
   * freeze rights). A trial given a paid term becomes that plan ("… aboneliğe geçir"). Changing a subscription's plan is its
   * own action (`plan`, no time added).
   */
  app.post('/api/merkez/admin/licenses', (req, res) => {
    const plans = z.union([z.literal(1), z.literal(6), z.literal(12)]);
    const who = admin(req); const b = z.object({ requestId: key, tenantId: id, expectedEnd: z.string().nullable(), expectedSuspended: z.boolean(), months: z.union([z.literal(0), plans]), suspended: z.boolean(), reason: z.string().trim().max(300).optional(), plan: plans.optional(),
      // "Ödeme alındı" (Satışlarım): with an extension or a conversion only; written in the same transaction.
      payment: paymentSchema.optional() }).parse(req.body);
    if (b.payment && !b.months) throw new DomainError('CONFLICT', 'Ödeme kaydı yalnız süre eklenirken yapılır.', 400);
    // "Ödeme alındı" writes a Satışlarım entry: the Authenticator step-up first (an extension without it does not need one).
    if (b.payment) right.require(who, 'sales');
    res.json(store.mutate(d => once(d, 'license', b, () => {
      const l = d.businesses.find(l => l.tenantId === b.tenantId); if (!l || l.endsAt !== b.expectedEnd || l.suspended !== b.expectedSuspended) throw new DomainError('VERSION_CONFLICT', 'Lisans değişti. Listeyi yenileyin.', 409);
      activated(l);
      if (b.plan !== undefined) {
        if (b.months || b.suspended !== l.suspended) throw new DomainError('CONFLICT', 'Plan değişikliği süre eklemeden, ayrı yapılır.', 400);
        if (l.kind === 'trial') throw new DomainError('CONFLICT', 'Deneme önce ücretli aboneliğe geçirilir; plan o sırada seçilir.', 409);
        const before = l.planMonths ?? 12;
        if (before === b.plan) throw new DomainError('CONFLICT', 'İşletme zaten bu planda.', 409);
        l.planMonths = b.plan; store.issue(l, now());
        d.audit.push({ action: 'license.plan_changed', target: l.tenantId, at: at(), by: 'admin', detail: `${before} ay → ${b.plan} ay · bitiş değişmedi (${day(l.endsAt)})`, changes: [{ field: 'abonelik planı', from: `${before} ay`, to: `${b.plan} ay` }] });
        return { ok: true };
      }
      const converted = b.months > 0 && l.kind === 'trial', oldEnd = l.endsAt, oldPlan = l.kind === 'trial' ? 'deneme' : `${l.planMonths ?? 12} ay`;
      if (b.months) {
        l.endsAt = extendMonths(new Date(Math.max(now().getTime(), l.endsAt ? Date.parse(l.endsAt) : 0)), b.months);
        // Only a trial takes the plan from the term; an extension never changes a subscription's plan.
        if (converted) { l.kind = 'subscription'; l.planMonths = b.months; }
      }
      const action = converted ? 'trial.converted' : b.months ? 'license.extended' : b.suspended !== l.suspended ? (b.suspended ? 'license.suspended' : 'license.resumed') : 'license.updated';
      // Why it was suspended stays with the business until service resumes; the history keeps it too.
      if (b.suspended && !l.suspended) { if (b.reason) l.suspendReason = b.reason; else delete l.suspendReason; }
      if (!b.suspended) delete l.suspendReason;
      const detail = b.months ? `Bitiş ${day(oldEnd)} → ${day(l.endsAt)}${converted ? ` · ${oldPlan} → ${b.months} ay abonelik` : ''}` : b.suspended && b.reason ? `Neden: ${b.reason}` : undefined;
      const changes = [...(oldEnd !== l.endsAt ? [{ field: 'lisans bitişi', from: day(oldEnd), to: day(l.endsAt) }] : []), ...(converted ? [{ field: 'plan', from: oldPlan, to: `${b.months} ay abonelik` }] : []), ...(b.suspended !== l.suspended ? [{ field: 'hizmet', from: l.suspended ? 'askıda' : 'açık', to: b.suspended ? 'askıda' : 'açık' }] : [])];
      l.suspended = b.suspended; store.issue(l, now()); d.audit.push({ action, target: l.tenantId, at: at(), by: 'admin', ...(detail ? { detail } : {}), ...(changes.length ? { changes } : {}) });
      const sale = b.payment && b.months ? saleFromExtension(sales, d, l, b.months, b.payment, now()) : undefined;
      return { ok: true, ...(sale ? { saleId: sale.id } : {}) };
    })));
  });
  app.post('/api/merkez/admin/service-plan', (req, res) => {
    admin(req); const b = z.object({ requestId: key, tenantId: id, service: z.enum(['full', 'menu']) }).parse(req.body);
    res.json(store.mutate(d => once(d, 'service-plan', b, () => {
      const l = find(d, b.tenantId), names = { full: 'Tam sistem', menu: 'Sadece QR menü' };
      const detail = `${names[l.service ?? 'full']} → ${names[b.service]}`;
      const changes = [{ field: 'hizmet paketi', from: names[l.service ?? 'full'], to: names[b.service] }];
      // Before packaging this was the whole Hizmet tab; it now puts the matching old plan on the business (same behaviour).
      assignServices(store, d, l, { packageId: b.service === 'menu' ? LEGACY_MENU : LEGACY_FULL }, now());
      l.service = b.service; store.issue(l, now()); d.audit.push({ action: `service-plan.${b.service}`, target: l.tenantId, at: at(), by: 'admin', detail, changes }); return { ok: true };
    })));
  });
  // Imported trials that never started (old in-process records): the vendor starts them once the owner finished setup.
  app.post('/api/merkez/admin/trials/start', (req, res) => {
    admin(req); const b = z.object({ requestId: key, tenantId: id }).parse(req.body);
    res.json(store.mutate(d => once(d, 'trial-start', b, () => {
      const l = activated(find(d, b.tenantId));
      if (l.kind !== 'trial' || l.trialStartedAt || l.endsAt !== null) throw new DomainError('CONFLICT', 'Deneme zaten başlatıldı veya aboneliğe geçildi. Listeyi yenileyin.', 409);
      if (l.suspended) throw new DomainError('CONFLICT', 'Önce askıya alınan hizmeti açın.', 409);
      if (!store.report(l.tenantId)?.setupCompleted) throw new DomainError('SETUP_REQUIRED', 'Önce işletmenin ilk kurulumunu tamamlayın.', 409);
      const started = now(); l.trialStartedAt = started.toISOString(); l.endsAt = new Date(started.getTime() + 30 * DAY).toISOString();
      store.issue(l, started); d.audit.push({ action: 'trial.started', target: l.tenantId, at: l.trialStartedAt }); return { ok: true };
    })));
  });
  app.post('/api/merkez/admin/freezes/review', (req, res) => {
    admin(req); const b = z.object({ requestId: key, tenantId: id, freezeId: id, approve: z.boolean(), note: z.string().trim().max(1000) }).parse(req.body);
    res.json(store.mutate(d => once(d, 'freeze-review', b, () => {
      const l = find(d, b.tenantId);
      const result = reviewFreeze(l, b.freezeId, b.approve, b.note, now()); store.issue(l, now()); d.audit.push({ action: b.approve ? 'freeze.approved' : 'freeze.rejected', target: l.tenantId, at: at() }); return result;
    })));
  });
  app.post('/api/merkez/admin/freezes/end', (req, res) => {
    admin(req); const b = z.object({ requestId: key, tenantId: id, freezeId: id }).parse(req.body);
    res.json(store.mutate(d => once(d, 'freeze-end', b, () => {
      const l = find(d, b.tenantId);
      const result = endFreeze(l, b.freezeId, now()); store.issue(l, now()); d.audit.push({ action: 'freeze.ended', target: l.tenantId, at: at() }); return result;
    })));
  });
  app.post('/api/merkez/admin/tickets/reply', (req, res) => {
    // `attachments`: files uploaded for this ticket first (/admin/attachments); a message may be files only.
    admin(req); const b = z.object({ requestId: key, ticketId: id, text: z.string().trim().max(4000), close: z.boolean().optional(), attachments: attachmentIds.optional() }).refine(x => x.text.length > 0 || !!x.attachments?.length, { message: 'Mesaj boş olamaz.', path: ['text'] }).parse(req.body);
    res.json(store.mutate(d => once(d, 'support-reply', b, () => {
      const t = d.tickets.find(t => t.id === b.ticketId);
      if (!t) throw new DomainError('NOT_FOUND', 'Destek talebi bulunamadı.', 404);
      if (t.status === 'closed') throw new DomainError('TICKET_CLOSED', 'Talep kapalı. Yeni talep oluşturabilirsiniz.', 409);
      const time = at(), messageId = randomUUID(), files = attachments.claim(b.attachments, t.tenantId, t.id, messageId, 'support', true);
      t.messages.push({ id: messageId, source: 'support', text: b.text, at: time, ...(files.length ? { attachments: files } : {}) });
      if (b.close) { t.status = 'closed'; d.notifications.push({ id: randomUUID(), ticketId: t.id, event: 'ticket.closed', channel: 'sms', audience: 'business', status: 'awaiting_configuration', at: time }); }
      d.audit.push({ action: b.close ? 'ticket.closed' : 'ticket.replied', target: t.id, at: time }); return { ok: true };
    })));
  });
  /*
   * "Yeni mesaj" (işletme sayfası → Destek): the Mola team starts a conversation with one business. It is an ordinary ticket
   * whose first message is the Mola team's, so it reaches every café version with the next heartbeat (an older one shows it as
   * a ticket with a Mola answer); newer screens say "Mola ekibi başlattı". No step-up: one business, like a reply.
   * `id`: chosen by the screen, so files uploaded for it first (/admin/attachments?tenantId=) and a repeat find the same one.
   */
  app.post('/api/merkez/admin/tickets', (req, res) => {
    admin(req);
    const b = z.object({ requestId: key, id: z.string().uuid().optional(), tenantId: id, subject: z.string().trim().min(3, 'Konu en az 3 harf olmalı.').max(120), text: z.string().trim().max(4000), attachments: attachmentIds.optional() }).strict()
      .refine(x => x.text.length >= 3 || !!x.attachments?.length, { message: 'Mesajı yazın.', path: ['text'] }).parse(req.body);
    res.json(store.mutate(d => once(d, 'support-start', b, () => {
      const biz = activated(find(d, b.tenantId));
      if (b.id && d.tickets.some(t => t.id === b.id)) throw new DomainError('CONFLICT', 'Bu talep zaten var. Listeyi yenileyin.', 409);
      const time = at(), ticket: Ticket = { id: b.id ?? randomUUID(), tenantId: biz.tenantId, subject: b.subject, status: 'open', createdAt: time, messages: [] };
      const messageId = randomUUID(), files = attachments.claim(b.attachments, biz.tenantId, ticket.id, messageId, 'support', true);
      ticket.messages.push({ id: messageId, source: 'support', text: b.text, at: time, ...(files.length ? { attachments: files } : {}) });
      d.tickets.push(ticket);
      d.audit.push({ action: 'ticket.started', target: ticket.id, at: time, by: 'admin', detail: `“${b.subject}”${files.length ? ` · ${files.length} ek` : ''}` });
      return { id: ticket.id };
    })));
  });
  // ---------- Mola ekibi iletişim bilgileri (Ayarlar) ----------
  app.get('/api/merkez/admin/contact', (req, res) => { admin(req); res.json({ contact: store.read().contact ?? null }); });
  app.post('/api/merkez/admin/contact', (req, res) => {
    admin(req);
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) throw new DomainError('CONTACT_INVALID', parsed.error.issues[0]?.message ?? 'Alanları kontrol edin.', 400);
    const c = parsed.data;
    res.json(store.mutate(d => {
      const before = d.contact, names = { phone: 'telefon', whatsapp: 'WhatsApp', email: 'e-posta', hours: 'çalışma saatleri', web: 'web' } as const;
      const keys = (Object.keys(names) as (keyof typeof names)[]).filter(k => (before?.[k] ?? '') !== c[k]), changed = keys.map(k => names[k]);
      d.contact = { ...c, updatedAt: at() };
      // Which fields changed in the short list; old → new values only in İşlem kayıtları (the vendor's own public contact).
      d.audit.push({ action: 'contact.updated', target: 'admin', at: at(), by: 'admin', detail: emptyContact(c) ? 'Boş: işletmelerde gösterilmez' : `Değişen: ${changed.join(', ') || 'yok'}`, changes: keys.map(k => ({ field: names[k], from: before?.[k] || '—', to: c[k] || '—' })) });
      return { contact: d.contact };
    }));
  });
  // ---------- Bildirim merkezi ----------
  app.post('/api/merkez/admin/alerts/read', (req, res) => {
    admin(req); const b = z.object({ ids: z.array(id).max(500).optional(), all: z.boolean().optional(), unread: z.boolean().optional() }).strict().parse(req.body);
    res.json(store.mutate(d => {
      const time = at(), ids = new Set(b.ids ?? []);
      for (const a of d.alerts ?? []) if (b.all || ids.has(a.id)) { if (b.unread) delete a.readAt; else a.readAt ??= time; }
      return { unread: (d.alerts ?? []).filter(a => !a.readAt).length };
    }));
  });
  // ---------- E-posta bildirimleri (the vendor's own SMTP account; the app password stays in the sealed registry) ----------
  const mailView = (d: MerkezData) => {
    const s = d.mail?.settings;
    return { settings: s ? { enabled: s.enabled, host: s.host, port: s.port, security: s.security, user: s.user, to: s.to, from: s.from ?? '', adminEmail: s.adminEmail ?? '', hasPassword: !!s.password, updatedAt: s.updatedAt } : null, resetReady: smtpReady(s),
      queue: (d.mail?.queue ?? []).slice(-20).reverse().map(({ id, subject, createdAt, sentAt, failed, error, attempts }) => ({ id, subject, createdAt, sentAt, failed: !!failed, error, attempts })) };
  };
  app.get('/api/merkez/admin/email', (req, res) => { admin(req); res.json(mailView(store.read())); });
  app.post('/api/merkez/admin/email', (req, res) => {
    // The owner's only (13 Ekim): the SMTP server and the addresses decide where the owner's "Şifremi unuttum" code goes.
    ownerOnly(req);
    const b = z.object({ enabled: z.boolean(), host: z.string().trim().regex(/^[a-z0-9.-]{1,200}$/i), port: z.number().int().min(1).max(65535), security: z.enum(['tls', 'starttls', 'none']), user: z.string().trim().max(200), password: z.string().max(200).optional(), to: z.string().trim().max(200), from: z.string().trim().max(200).optional(), adminEmail: z.string().trim().max(200).optional() }).strict().parse(req.body);
    if (!validAddress(b.to)) throw new DomainError('EMAIL_ADDRESS', 'Bildirimlerin gideceği adresi kontrol edin (ör. ad@ornek.com).', 400);
    if (b.from && !validAddress(b.from)) throw new DomainError('EMAIL_ADDRESS', 'Gönderen adresini kontrol edin (ör. bildirim@ornek.com).', 400);
    if (b.adminEmail && !validAddress(b.adminEmail)) throw new DomainError('EMAIL_ADDRESS', 'Yönetici e-postasını kontrol edin (ör. ad@ornek.com).', 400);
    if (b.user.includes('@') && !validAddress(b.user)) throw new DomainError('EMAIL_ADDRESS', 'Kullanıcı adresini kontrol edin (ör. ad@gmail.com).', 400);
    // Never "From: Mola Yönetim <>": a user that is no e-mail address needs a sender address.
    if (b.enabled && !senderOf({ from: b.from, user: b.user })) throw new DomainError('EMAIL_FROM', 'Gönderen adresini yazın: SMTP kullanıcısı bir e-posta adresi değil, e-postalar hangi adresten gideceğini bilmiyor.', 400);
    try { validSettings(b); } catch (e) { throw new DomainError('EMAIL_SECURITY', (e as Error).message, 400); }
    res.json(store.mutate(d => {
      const old = d.mail?.settings, password = b.password ? b.password : old?.password ?? '';
      if (b.enabled && b.user && !password) throw new DomainError('EMAIL_PASSWORD', 'Uygulama şifresini girin.', 400);
      (d.mail ??= { queue: [] }).settings = { enabled: b.enabled, host: b.host.toLowerCase(), port: b.port, security: b.security, user: b.user, password, to: b.to, ...(b.from ? { from: b.from } : {}), ...(b.adminEmail ? { adminEmail: b.adminEmail } : {}), updatedAt: at() };
      // Old → new of every setting except the app password (only whether it changed).
      const fields: [string, string | undefined, string | undefined][] = [['açık', old ? String(old.enabled) : undefined, String(b.enabled)], ['sunucu', old?.host, b.host.toLowerCase()], ['port', old ? String(old.port) : undefined, String(b.port)], ['güvenlik', old?.security, b.security], ['kullanıcı', old?.user, b.user], ['alıcı', old?.to, b.to], ['gönderen', old?.from, b.from], ['yönetici e-postası', old?.adminEmail, b.adminEmail]];
      const changes = fields.filter(([, x, y]) => (x ?? '') !== (y ?? '')).map(([field, x, y]) => ({ field, from: x || '—', to: y || '—' }));
      if (b.password) changes.push({ field: 'uygulama şifresi', from: old?.password ? 'kayıtlı' : '—', to: 'yeni şifre kaydedildi (gösterilmez)' });
      d.audit.push({ action: 'email.settings_saved', target: 'admin', at: at(), by: 'admin', detail: `${b.enabled ? `Açık · ${b.host}:${b.port} → ${b.to}` : 'Kapalı'}${(old?.adminEmail ?? '') !== (b.adminEmail ?? '') ? ` · yönetici e-postası ${b.adminEmail ? 'değişti' : 'kaldırıldı (bildirim adresi kullanılır)'}` : ''}`, changes });
      return mailView(d);
    }));
  });
  // "Deneme e-postası gönder": sent right now with the saved settings; the answer says plainly what went wrong.
  app.post('/api/merkez/admin/email/test', async (req, res) => {
    admin(req); auth.throttle(req);
    const s = store.read().mail?.settings;
    if (!s) throw new DomainError('EMAIL_OFF', 'Önce e-posta ayarlarını kaydedin.', 409);
    try { await (options.sendMail ?? sendMail)(s, s.to, 'Mola Yönetim: deneme e-postası', `Bu e-posta Mola Yönetim’in e-posta bildirimleri ayarından gönderildi.\nBundan sonra önemli olaylar (yeni başvuru, destek talebi, yedek sorunu…) bu adrese de gelir.\n${at().slice(0, 16).replace('T', ' ')} (UTC)`); }
    catch (e) { throw new DomainError('EMAIL_FAILED', e instanceof MailError ? e.message : 'Deneme e-postası gönderilemedi.', 409); }
    store.mutate(d => { d.audit.push({ action: 'email.test_sent', target: 'admin', at: at(), by: 'admin' }); });
    res.json({ ok: true, to: s.to });
  });
  // ---------- Merkez yedeği ve kurtarma kodu ----------
  const backupOff = () => new DomainError('BACKUP_OFF', 'Merkez yedeği bu çalıştırmada kapalı.', 409);
  // The recovery code opens Merkez's whole registry and signing key: shown only on the screen of this computer.
  const here = (req: Request) => { if (!loopbackRequest(req)) throw new DomainError('LOCAL_ONLY', 'Kurtarma kodu yalnız Mola Merkez’in çalıştığı bilgisayarda gösterilir.', 403); };
  app.get('/api/merkez/admin/backup', (req, res) => { admin(req); res.json({ backup: options.backups?.status() ?? null, recovery: options.recovery?.view() ?? null, local: loopbackRequest(req), keyProtection: options.keyProtection?.() ?? null }); });
  app.post('/api/merkez/admin/backup/run', async (req, res) => {
    admin(req); if (!options.backups) throw backupOff();
    const status = await options.backups.runNow();
    store.mutate(d => { d.audit.push({ action: status.lastError ? 'merkez.backup_failed' : 'merkez.backup_made', target: 'admin', at: at(), by: 'admin' }); });
    res.json(status);
  });
  app.post('/api/merkez/admin/backup/second', async (req, res) => {
    admin(req); if (!options.backups) throw backupOff();
    const b = z.object({ folder: z.string().trim().min(1).max(400).nullable() }).strict().parse(req.body);
    const status = await options.backups.setSecond(b.folder);
    store.mutate(d => { d.audit.push({ action: b.folder ? 'merkez.second_place_set' : 'merkez.second_place_off', target: 'admin', at: at(), by: 'admin' }); });
    res.json(status);
  });
  // "Göz at": the folder window opens on the screen of the computer Merkez runs on, so only for this computer's own browser
  // talking to Merkez directly (no proxy, no PUBLIC_ORIGIN) with the admin session. One window at a time; the vendor's answer
  // only fills the field (saving still goes through /backup/second or /workfolder with their own checks).
  const picker = options.folderPicker ?? folderPicker();
  let picking = false;
  const pickerHere = (req: Request) => directLoopback(req, options.httpSecurity ?? {});
  app.get('/api/merkez/admin/folders', async (req, res) => {
    admin(req);
    const local = pickerHere(req);
    res.json({ picker: local && picker.available(), places: local ? await picker.places().catch(() => []) : [] });
  });
  app.post('/api/merkez/admin/folders/pick', async (req, res) => {
    admin(req);
    if (!pickerHere(req)) throw new DomainError('LOCAL_ONLY', 'Klasör seçme penceresi yalnız Mola Merkez’in çalıştığı bilgisayarda açılır. Klasör yolunu elle yazın.', 403);
    const b = z.object({ purpose: z.enum(['second', 'workfolder']), start: z.string().max(400).nullable().optional() }).strict().parse(req.body);
    if (!picker.available()) throw new DomainError('PICKER_UNAVAILABLE', 'Bu bilgisayarda klasör seçme penceresi açılamıyor. Klasör yolunu elle yazın.', 409);
    if (picking) throw new DomainError('PICKER_BUSY', 'Klasör seçme penceresi zaten açık. Görev çubuğundaki pencereye bakın.', 409);
    picking = true;
    try { res.json({ path: await picker.pick({ purpose: b.purpose, start: b.start ?? null }) }); }
    catch (e) { if (e instanceof DomainError) throw e; throw new DomainError('PICKER_FAILED', 'Klasör seçme penceresi açılamadı. Klasör yolunu elle yazın.', 409); }
    finally { picking = false; }
  });
  // The Merkez recovery code is the owner's last key (13 Ekim): a yetkili neither sees nor renews it.
  app.post('/api/merkez/admin/recovery/show', (req, res) => { ownerOnly(req); here(req); if (!options.recovery) throw backupOff(); const code = options.recovery.reveal(); store.journal.append({ action: 'merkez.recovery_shown', target: { kind: 'merkez', id: 'merkez', name: 'Mola Merkez' } }); res.json({ code }); });
  app.post('/api/merkez/admin/recovery/confirm', (req, res) => {
    ownerOnly(req); if (!options.recovery) throw backupOff(); options.recovery.confirm();
    store.mutate(d => { d.audit.push({ action: 'merkez.recovery_confirmed', target: 'admin', at: at(), by: 'admin' }); });
    res.json(options.recovery.view());
  });
  app.post('/api/merkez/admin/recovery/new', async (req, res) => {
    ownerOnly(req); here(req); if (!options.recovery) throw backupOff();
    const { password } = z.object({ password: z.string().min(1).max(128) }).strict().parse(req.body);
    if (!await auth.checkPassword(req, password)) throw new DomainError('INVALID_PASSWORD', 'Yönetici şifresi yanlış.', 403);
    const code = await options.recovery.regenerate();
    // Backups this computer can reach open with the new code too (copies elsewhere: the old code).
    await options.backups?.rewrap(options.recovery.protection()).catch(() => 0);
    store.mutate(d => { d.audit.push({ action: 'merkez.recovery_renewed', target: 'admin', at: at(), by: 'admin' }); });
    res.json({ code });
  });
  // Failure records arrive with the heartbeat: code locations only, never messages, values or business data.
  app.post('/api/merkez/admin/diagnostics/find', (req, res) => {
    admin(req); const { trackingId } = z.object({ trackingId: z.string().uuid() }).parse(req.body);
    res.json({ record: store.failure(trackingId.toLowerCase()) });
  });
  // Hatalar tab: the newest records as a list (no download, no audit line).
  app.post('/api/merkez/admin/diagnostics/list', (req, res) => {
    admin(req); const { tenantId } = z.object({ tenantId: id }).strict().parse(req.body);
    res.json({ records: store.failures(tenantId).slice(0, 100) });
  });
  app.post('/api/merkez/admin/diagnostics/export', (req, res) => {
    admin(req); const { tenantId } = z.object({ tenantId: id }).parse(req.body);
    const records = store.failures(tenantId); store.mutate(d => { find(d, tenantId); d.audit.push({ action: 'diagnostics.exported', target: tenantId, at: at() }); });
    res.json({ format: 1, appVersion: store.report(tenantId)?.appVersion ?? '', exportedAt: at(), tenantId, retentionHours: 30 * 24, count: records.length, records,
      scope: 'İşletmenin bilgisayarından bağlantıyla gelen sunucu 5xx hataları: işletme başına en fazla 500 kayıt, 30 gün saklanır; yalnız kodun yeri, mesaj ve değer yok. İstemci hatalarını veya tüm işlemleri kapsamaz. Kayıt olmaması hata olmadığı anlamına gelmez.' });
  });
  /**
   * Development / migration only: a café data folder from before the split (licences kept in the café itself) is registered
   * with the same business ids and its current licences, under one install. scripts/merkez-import.ts calls this.
   */
  // Exactly the licence fields the signed claims carry (server/license.ts): anything else would make every café refuse the licence.
  const when = z.string().max(40).refine(v => Number.isFinite(Date.parse(v)));
  const importedFreeze = z.object({ id, reason: z.string().max(1000), startDate: z.string().max(10), days: z.number().int(), requestedAt: when, status: z.enum(['pending', 'approved', 'rejected']), decision: z.string().max(1000).optional(), decidedAt: when.optional(), startsAt: when.optional(), until: when.optional(), endedAt: when.optional() }).strip();
  const importedLicense = z.object({ endsAt: when.nullable(), suspended: z.boolean(), kind: z.enum(['trial', 'subscription']).optional(), planMonths: z.union([z.literal(1), z.literal(6), z.literal(12)]).optional(), service: z.enum(['full', 'menu']).optional(), freezes: z.array(importedFreeze).max(100).optional(), trialStartedAt: when.optional(), createdAt: when.optional() }).strip();
  app.post('/api/merkez/admin/import', (req, res) => {
    admin(req);
    const b = z.object({ requestId: key, machineId: machineId.optional(), businesses: z.array(z.object({ tenantId: id, name: z.string().trim().min(1).max(200), sector: z.enum(sectors).optional(), license: importedLicense }).strict()).min(1).max(50),
      tickets: z.array(z.object({ id, tenantId: id, subject: z.string().max(200), status: z.enum(['open', 'closed']), createdAt: z.string(), messages: z.array(z.object({ id, source: z.enum(['business', 'support']), text: z.string().max(4000), at: z.string() })).max(500) })).max(500).optional() }).parse(req.body);
    res.json(store.mutate(d => once(d, 'import', b, () => {
      const existing = new Set(b.businesses.map(x => d.businesses.find(y => y.tenantId === x.tenantId)?.installId).filter(Boolean));
      if (existing.size > 1) throw new DomainError('CONFLICT', 'Bu işletmeler Merkez’de farklı kurulumlara bağlı.', 409);
      let install = d.installs.find(i => existing.has(i.id));
      // A re-import of the same folder keeps its install and business ids and gets a fresh secret: only the folder written now
      // can sign in. The computer ids were HMACs under the old secret and can never match again: forgotten, so the first
      // heartbeat with the new secret is this install's first computer, not a false "İki farklı bilgisayar".
      if (install) { install.secret = newInstallSecret(); delete install.machines; d.audit.push({ action: 'install.reimported', target: b.businesses[0].tenantId, at: at(), by: 'admin' }); }
      else { install = { id: randomUUID(), secret: newInstallSecret(), createdAt: at(), ...(b.machineId ? { machineId: b.machineId } : {}) }; d.installs.push(install); }
      for (const x of b.businesses) {
        if (d.businesses.some(y => y.tenantId === x.tenantId)) continue;
        const biz: MerkezBusiness = { ...x.license, tenantId: x.tenantId, name: x.name, ...(x.sector ? { sector: x.sector } : {}), installId: install.id, source: 'import', serial: 0, activatedAt: at(), createdAt: x.license.createdAt ?? at(), ...(b.machineId ? { machineId: b.machineId } : {}) };
        // Its old plan, as on the café (Tam sistem / Sadece QR menü); assigning signs the first licence.
        assignServices(store, d, biz, { packageId: biz.service === 'menu' ? LEGACY_MENU : LEGACY_FULL }, now());
        if (!biz.signed) store.issue(biz, now()); d.businesses.push(biz); d.audit.push({ action: 'business.imported', target: biz.tenantId, at: at() });
      }
      for (const t of b.tickets ?? []) if (!d.tickets.some(y => y.id === t.id) && b.businesses.some(x => x.tenantId === t.tenantId)) d.tickets.push(t as Ticket);
      const mine = d.businesses.filter(y => y.installId === install.id);
      return { installId: install.id, secret: install.secret, licenses: mine.map(y => y.signed!), serverTime: at(), ...(existing.size ? { reused: true } : {}) };
    }, { keep: r => ({ ref: 1, installId: r.installId }), replay: kept => { const install = d.installs.find(i => i.id === kept.installId); if (!install) throw new DomainError('NOT_FOUND', 'Kurulum bulunamadı.', 404); return { installId: install.id, secret: install.secret, licenses: d.businesses.filter(y => y.installId === install.id).map(y => y.signed!), serverTime: at() }; } })));
  });

  // ---------- Café installs ----------
  // Sosyal medya: the public short addresses of the cafés' social QR codes (outside /api: no request log).
  socialRoutes(app, { store, now });
  app.get(`${MERKEZ_API}/health`, (_req, res) => { res.json({ ok: true, role: 'merkez', version: APP_VERSION, mode: process.env.MOLA_MODE === 'installed' ? 'installed' : 'development' }); });
  /*
   * "Mola ekibi iletişim bilgileri" for a café that is not activated yet (no install secret to sign with): the vendor's contact
   * is public anyway. Signed, so the café keeps only what our key signed; cache-friendly (ETag, 5 minutes) and limited per address.
   */
  app.get(`${MERKEZ_API}/contact`, (req, res) => {
    limit(addressPool, `contact:${clientKey(req)}`, 60, 60_000);
    const contact = signedContact(store.read()), tag = `"${createHash('sha256').update(contact?.signature ?? 'yok').digest('hex').slice(0, 24)}"`;
    res.set('Cache-Control', 'public, max-age=300'); res.set('ETag', tag);
    if (req.get('If-None-Match') === tag) { res.status(304).end(); return; }
    res.json({ contact: contact ?? null });
  });
  const result = (install: Install, b: MerkezBusiness): ActivationResult => ({ installId: install.id, secret: install.secret, tenantId: b.tenantId, name: b.name, ...(b.sector ? { sector: b.sector } : {}), license: b.signed!, serverTime: at() });
  /*
   * Retry-safe activation: the café picks its install id and an activation id (`requestId`) once, keeps them sealed on its
   * computer and sends the same pair with every try (a retry, Geri and back, an edited form, a restart, a lost answer) until
   * it has kept the licence. A repeat finds the same application, install and business: nothing new is made, and an activated
   * one gets a freshly signed licence (serial + 1). Cafés from before this send no install id: one request id, one result.
   */
  const installIdSchema = z.string().regex(/^[a-f0-9-]{36}$/);
  // `agreement`: Mola Lisans Sözleşmesi as the owner ticked it on the activation screen (cafés from before it send none).
  const activationBody = { requestId: key, machineId, appVersion: z.string().max(40), installId: installIdSchema.optional(), keyId: z.string().regex(/^[a-f0-9]{16}$/).optional(), agreement: agreementAcceptance.optional() };
  type ActivationBody = { requestId: string; machineId: string; appVersion: string; installId?: string; keyId?: string };
  const ownKey = keyFingerprint(store.publicKey);
  // A café package built with another Mola Yönetim's key could never verify our licence: refused before anything is made.
  const sameKey = (b: ActivationBody) => { if (b.keyId && b.keyId !== ownKey) throw new DomainError('MERKEZ_KEY_MISMATCH', `${KEY_MISMATCH} (Kurulumdaki anahtar: ${showFingerprint(b.keyId)}, bu Mola Yönetim: ${showFingerprint(ownKey)})`, 409); };
  /** The install this café already made here and never used; undefined when it is the first try. */
  function knownInstall(d: MerkezData, b: ActivationBody) {
    const install = b.installId ? d.installs.find(i => i.id === b.installId) : undefined;
    if (!install) return undefined;
    if (install.activationId !== b.requestId) throw new DomainError('CONFLICT', 'Bu kurulum kimliği başka bir etkinleştirmeye ait.', 409);
    // Once the café has connected with it, activation is over.
    if (install.lastSeenAt || install.revokedAt) throw new DomainError('ALREADY_ACTIVE', 'Bu kurulum zaten etkinleştirildi.', 409);
    install.appVersion = b.appVersion;
    return install;
  }
  function newInstall(d: MerkezData, b: ActivationBody, when: Date): Install {
    const install: Install = { id: b.installId ?? randomUUID(), secret: newInstallSecret(), createdAt: when.toISOString(), machineId: b.machineId, appVersion: b.appVersion, ...(b.installId ? { activationId: b.requestId } : {}) };
    d.installs.push(install); return install;
  }
  const repeated = (d: MerkezData, install: Install, biz: MerkezBusiness) => { store.issue(biz, now()); d.audit.push({ action: 'activation.repeated', target: biz.tenantId, at: at() }); return result(install, biz); };
  /** The tax index follows the business: a pending application, or a licence ever issued, blocks the number for others. */
  const taxState = (b: MerkezBusiness) => b.installId || b.application?.status === 'approved' ? 'granted' as const : b.application?.status === 'pending' ? 'pending' as const : 'none' as const;
  // The phone / e-mail index follows the invoice too (every place that changes it calls this).
  const indexTax = (b: MerkezBusiness) => { store.indexTax(b.tenantId, b.invoice?.taxNumber, taxState(b), b.application ? b.application.firstSubmittedAt ?? b.application.submittedAt : b.createdAt ?? ''); store.indexContact(b.tenantId, b.invoice); };
  // Index rows from before the first-submission order: filled once from the registry.
  if (store.db.prepare('SELECT 1 FROM tax_index WHERE since IS NULL LIMIT 1').get()) {
    store.mutate(d => { for (const b of d.businesses) if (b.invoice) indexTax(b); });
    store.db.prepare("UPDATE tax_index SET since='' WHERE since IS NULL").run();
  }
  // The phone / e-mail index is derived: rebuilt from the sealed registry on every start (older data had none).
  { const d = store.read(); store.db.exec('DELETE FROM contact_index'); for (const b of d.businesses) store.indexContact(b.tenantId, b.invoice); }
  if (scrubRequests(store.read())) store.mutate(d => { scrubRequests(d); });

  // The self-serve "30 gün ücretsiz dene" is retired: a trial starts only when the vendor approves an application.
  app.post(`${MERKEZ_API}/activate/trial`, () => { throw new DomainError('TRIAL_RETIRED', 'Ücretsiz deneme artık “Hesap açma başvurusu” ile başlıyor. Mola’yı güncelleyip başvurun.', 410); });

  // ---------- Hesap açma başvurusu ----------
  /** What the café sees of its application; the install credentials and licence only once the vendor started the trial. */
  /**
   * What the café sees of its application. The install secret and licence go out only between approval and the café's first
   * heartbeat (that is when it needs them); afterwards activation is over and the answer is ALREADY_ACTIVE.
   */
  function answer(d: MerkezData, biz: MerkezBusiness): ApplicationAnswer {
    const a = biz.application!, install = biz.installId ? d.installs.find(i => i.id === biz.installId) : undefined;
    if (a.status === 'approved' && install && biz.signed) {
      if (install.lastSeenAt || install.revokedAt) throw new DomainError('ALREADY_ACTIVE', 'Bu kurulum zaten etkinleştirildi.', 409);
      return { status: 'approved', name: biz.name, submittedAt: a.submittedAt, activation: result(install, biz) };
    }
    return { status: a.status === 'rejected' ? 'rejected' : 'pending', name: biz.name, submittedAt: a.submittedAt, ...(a.reason ? { reason: a.reason } : {}), ...(a.decidedAt ? { decidedAt: a.decidedAt } : {}) };
  }
  const applicationOf = (d: MerkezData, installId: string) => d.businesses.find(x => x.application?.installId === installId);
  /** First submission of an application (older records kept only the latest). */
  const firstOf = (a: Application) => a.firstSubmittedAt ?? a.submittedAt;
  /** Another business holds this number before this application: a licence ever, or a pending application sent earlier. */
  const duplicateTax = (b: MerkezBusiness) => !!b.invoice && !!b.application && b.application.status !== 'approved' && store.taxTaken(b.invoice.taxNumber, b.tenantId, firstOf(b.application));
  /** The number belonged to a business the vendor deleted after it had connected: only flagged; a plain approval still works. */
  const deletedTax = (b: MerkezBusiness) => !!b.invoice && !!b.application && b.application.status !== 'approved' && store.taxDeleted(b.invoice.taxNumber, b.tenantId);
  /** At most this many waiting applications in all; and a few different tax numbers per application. */
  const MAX_PENDING = 1000, TAX_NUMBERS = 3;
  // One application per install: a resubmission (after "Bilgileri düzelt" or a rejection) updates it and waits again.
  app.post(`${MERKEZ_API}/applications`, (req, res) => {
    // Per address first, before anything is parsed further or read: corrections count here too.
    limit(addressPool, `application-any:${clientKey(req)}`, 30, 3600_000);
    const b = z.object({ ...applicationForm.shape, ...activationBody, installId: installIdSchema }).strict().parse(req.body);
    sameKey(b);
    limit(installPool, `application:${b.installId}`, 20, 3600_000);
    if (!applicationOf(store.read(), b.installId)) { limit(addressPool, `application:${clientKey(req)}`, 10, 3600_000); limit(overall, 'application:all', 300, 3600_000); }
    res.json(store.mutate(d => {
      const when = at(); let biz = applicationOf(d, b.installId);
      if (biz && biz.application!.activationId !== b.requestId) throw new DomainError('CONFLICT', 'Bu kurulum kimliği başka bir başvuruya ait.', 409);
      const install = d.installs.find(i => i.id === b.installId);
      // A code already activated this computer (its answer may have been lost): the same code finishes it, not an application.
      if (!biz && install) throw install.lastSeenAt ? new DomainError('ALREADY_ACTIVE', 'Bu kurulum zaten etkinleştirildi.', 409) : new DomainError('CONFLICT', 'Bu bilgisayar etkinleştirme koduyla etkinleştirildi. Aynı kodu yeniden girin.', 409);
      // Decided and started: nothing to change any more; the café just takes its licence.
      if (biz?.application!.status === 'approved') return answer(d, biz);
      const fresh = !biz, prior = biz?.application, hash = store.taxHash(b.invoice.taxNumber);
      if (fresh && d.businesses.filter(x => x.application?.status === 'pending').length >= MAX_PENDING) throw new DomainError('BUSY', 'Şu anda çok fazla başvuru bekliyor. Lütfen birkaç saat sonra yeniden deneyin.', 503);
      // Changing the number again and again (trying numbers) is cut short; the vendor can still correct it in Mola Yönetim.
      const hashes = prior?.taxHashes ?? (biz?.invoice ? [store.taxHash(biz.invoice.taxNumber)] : []);
      if (!hashes.includes(hash) && hashes.length >= TAX_NUMBERS) throw new DomainError('TAX_CHANGES', 'Bu başvuruda vergi / T.C. kimlik numarası en fazla 3 kez değiştirilebilir. Doğru numara için Mola ekibiyle iletişime geçin.', 409);
      if (!biz) { biz = { tenantId: randomUUID(), name: b.businessName, source: 'application', serial: 0, kind: 'trial', endsAt: null, suspended: false, service: 'full', createdAt: when }; d.businesses.push(biz); }
      biz.name = b.businessName; biz.sector = b.sector; biz.contactName = b.contactName; biz.invoice = b.invoice; biz.machineId = b.machineId;
      // Every application waits for the vendor, also one whose number another business already has: the applicant is never told
      // (no probing who applied); the vendor sees it flagged, in order of first submission, so an earlier applicant keeps its place.
      biz.application = { status: 'pending', installId: b.installId, activationId: b.requestId, machineId: b.machineId, appVersion: b.appVersion, submittedAt: when, firstSubmittedAt: prior ? firstOf(prior) : when, taxHashes: [...new Set([...hashes, hash])], submissions: (prior?.submissions ?? (prior ? 1 : 0)) + 1 };
      keepAgreement(d, biz, b.agreement, when);
      indexTax(biz);
      const repeat = duplicateTax(biz), wasDeleted = deletedTax(biz);
      const flags = [repeat && 'Aynı vergi / T.C. kimlik no başka kayıtta da var', wasDeleted && 'Vergi no daha önce silinen bir işletmeye aitti'].filter(Boolean).join(' · ');
      d.audit.push({ action: fresh ? 'application.received' : 'application.updated', target: biz.tenantId, at: when, by: 'cafe', ...(flags ? { detail: flags } : {}) });
      addAlert(d, when, fresh ? 'application.new' : 'application.resubmitted', `${biz.name}${b.contactName ? ` (${b.contactName})` : ''}${repeat ? ' · aynı vergi no başka kayıtta da var' : ''}${wasDeleted ? ' · vergi no daha önce silinen bir işletmeye aitti' : ''}`, { tenantId: biz.tenantId });
      return answer(d, biz);
    }));
  });
  // The café asks every few seconds while it waits (POST: the ids are not put in a URL).
  app.post(`${MERKEZ_API}/applications/status`, (req, res) => {
    limit(addressPool, `application-status:${clientKey(req)}`, 600, 60_000);
    const b = z.object({ requestId: key, installId: installIdSchema }).strict().parse(req.body);
    limit(installPool, `application-status:${b.installId}`, 60, 60_000);
    const d = store.read(), biz = applicationOf(d, b.installId);
    if (!biz || biz.application!.activationId !== b.requestId) throw new DomainError('APPLICATION_NOT_FOUND', 'Başvurunuz Mola Merkez’de bulunamadı. Bilgileri kontrol edip yeniden gönderin.', 404);
    res.json(answer(d, biz));
  });

  const codeFailures = new ExpiringStore<{ count: number; until: number }>(v => v.until, () => now().getTime(), 20000, true);
  let codeFailuresAll = { count: 0, until: 0 };
  app.post(`${MERKEZ_API}/activate/code`, (req, res) => {
    const t = now().getTime(), ip = clientKey(req), mine = codeFailures.get(ip);
    if (t >= codeFailuresAll.until) codeFailuresAll = { count: 0, until: t + 600_000 };
    if ((mine && mine.count >= 10) || codeFailuresAll.count >= 300) throw new DomainError('RATE_LIMIT', 'Çok fazla yanlış kod denendi. 10 dakika sonra tekrar deneyin.', 429);
    const b = z.object({ ...activationBody, code: z.string().trim().min(4).max(40) }).strict().parse(req.body);
    sameKey(b);
    const use = (d: MerkezData, known: Install | undefined) => {
      const hash = codeHash(b.code), code = d.codes.find(c => c.hash === hash), when = now();
      const biz = code && d.businesses.find(x => x.tenantId === code.tenantId);
      // The same café with the same code again (its answer was lost or not kept): the business it already activated.
      if (known && biz?.installId === known.id) return repeated(d, known, biz);
      if (!code || !biz || code.usedAt || Date.parse(code.expiresAt) <= when.getTime() || biz.installId) throw new DomainError('INVALID_CODE', 'Etkinleştirme kodu geçersiz, kullanılmış ya da süresi dolmuş.', 403);
      // What this café left here before switching to the code: an application (or the old self-serve trial), never used.
      const earlier = d.businesses.filter(x => x !== biz && ((known && x.installId === known.id) || (!!b.installId && !x.installId && x.application?.installId === b.installId && x.application.activationId === b.requestId)));
      if (earlier.some(x => x.source !== 'trial' && x.source !== 'application')) throw new DomainError('CONFLICT', 'Bu bilgisayar başka bir etkinleştirme koduyla etkinleştirildi. O kodu yeniden girin.', 409);
      const install = known ?? newInstall(d, b, when); code.usedAt = when.toISOString();
      // The paid term or the trial starts when the café really starts using Mola.
      biz.installId = install.id; biz.activatedAt = when.toISOString(); biz.machineId = b.machineId; biz.source = 'code';
      if (install.activationId) biz.activationId = install.activationId;
      if (biz.kind === 'trial') { biz.trialStartedAt = when.toISOString(); biz.endsAt = new Date(when.getTime() + 30 * DAY).toISOString(); }
      else biz.endsAt = extendMonths(when, biz.planMonths ?? 12);
      store.issue(biz, when); indexTax(biz); d.audit.push({ action: 'business.activated', target: biz.tenantId, at: when.toISOString() });
      keepAgreement(d, biz, b.agreement, when.toISOString());
      for (const old of earlier) { remove(d, old); d.audit.push({ action: 'application.replaced', target: old.tenantId, name: old.name, at: when.toISOString() }); }
      return result(install, biz);
    };
    try {
      res.json(store.mutate(d => b.installId ? use(d, knownInstall(d, b)) : once(d, 'activate-code', b, () => use(d, undefined), { keep: r => ({ ref: 1, tenantId: r.tenantId, installId: r.installId }), replay: kept => { const install = d.installs.find(i => i.id === kept.installId), biz = d.businesses.find(x => x.tenantId === kept.tenantId); if (!install || !biz || biz.installId !== install.id) throw new DomainError('INVALID_CODE', 'Etkinleştirme kodu geçersiz, kullanılmış ya da süresi dolmuş.', 403); return repeated(d, install, biz); } })));
    } catch (e) {
      if (e instanceof DomainError && e.code === 'INVALID_CODE') { codeFailuresAll.count++; if (mine && mine.until > t) mine.count++; else codeFailures.set(ip, { count: 1, until: t + 600_000 }); }
      throw e;
    }
  });
  /** The café's signature: known install, exact bytes, time within the window, nonce never seen before. */
  function authenticate(req: RawRequest) {
    const installId = req.get(HEADER.install) ?? '', time = req.get(HEADER.time) ?? '', nonce = req.get(HEADER.nonce) ?? '', signature = req.get(HEADER.signature) ?? '';
    const refuse = (code = 'INSTALL_AUTH', message = 'Kurulum kimliği doğrulanamadı.') => new DomainError(code, message, 401);
    if (!/^[a-f0-9-]{36}$/.test(installId) || !/^\d{10,16}$/.test(time) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw refuse();
    const d = store.read(), live = d.installs.find(i => i.id === installId && !i.revokedAt);
    // An install whose businesses were all deleted (after suspension): still checked with its own secret, answered "closed".
    const closed = live ? undefined : d.removed?.find(t => t.installId === installId && t.secret);
    const install = live ?? (closed ? { id: closed.installId, secret: closed.secret!, createdAt: closed.deletedAt } satisfies Install : undefined);
    if (!install) throw refuse();
    const expected = requestSignature(install.secret, req.method, req.originalUrl.split('?')[0], time, nonce, req.rawBody ?? Buffer.alloc(0));
    if (!sameSignature(expected, signature)) throw refuse();
    if (Math.abs(Number(time) - now().getTime()) > CLOCK_WINDOW_MS) throw refuse('CLOCK_SKEW', 'Bilgisayarın saati Mola Merkez saatinden çok farklı.');
    if (!store.useNonce(installId, nonce, now().getTime())) throw refuse('REPLAY', 'Bu istek daha önce kullanıldı.');
    return { install, nonce, closed: !live };
  }
  /** Signed "kaydı kapatıldı" for every deleted business of this install (final; the café stays locked for each). */
  const removals = (d: MerkezData, installId: string) => (d.removed ?? []).filter(t => t.installId === installId).map(t => signRemoval({ v: 1, installId, tenantId: t.tenantId, removedAt: t.deletedAt }, store.signingKey));
  function sendSigned(res: Response, secret: string, nonce: string, body: unknown) {
    const text = JSON.stringify(body);
    res.set(HEADER.signature, responseSignature(secret, nonce, text)); res.type('application/json').send(text);
  }
  /**
   * Licence copy: the heartbeat names its computer (an HMAC of the machine id). A new computer for an install takes it over
   * (a restored backup on a new PC just works); the computer it replaced is told so with its next heartbeat and closes
   * ordering, and the vendor gets "İki farklı bilgisayar" (and may give it back: "Eski bilgisayarı yeniden etkinleştir").
   */
  function seenMachine(d: MerkezData, install: Install, hash: string | undefined, time: string, mine: MerkezBusiness[]): 'active' | 'replaced' | 'unknown' {
    if (!hash) return 'unknown';
    const list = install.machines ??= [];
    let m = list.find(x => x.hash === hash);
    if (!m) {
      m = { hash, firstSeenAt: time, lastSeenAt: time };
      const previous = list.filter(x => !x.replacedAt);
      for (const p of previous) p.replacedAt = time;
      list.push(m);
      if (previous.length) {
        const names = mine.map(x => x.name).join(', ') || 'Bir işletme';
        addAlert(d, time, 'machine.conflict', `${names}: lisans yeni bir bilgisayardan kullanılmaya başlandı. Eski bilgisayarda sipariş kapandı. Bilgisayar değişikliği değilse “Eski bilgisayarı yeniden etkinleştir” ile geri verebilirsiniz.`, { ...(mine[0] ? { tenantId: mine[0].tenantId } : {}) });
        for (const x of mine) d.audit.push({ action: 'install.machine_changed', target: x.tenantId, at: time, by: 'cafe', detail: `${previous.map(p => p.hash.slice(0, 8)).join(', ')} → ${hash.slice(0, 8)}` });
      }
      // The newest few computers are enough to tell the story.
      if (list.length > 8) install.machines = [...list.filter(x => !x.replacedAt), ...list.filter(x => x.replacedAt).slice(-7)];
    }
    m.lastSeenAt = time;
    return m.replacedAt ? 'replaced' : 'active';
  }
  app.post(`${MERKEZ_API}/sync`, (req, res) => {
    // Per address before anything is read: unsigned junk costs no registry work.
    limit(addressPool, `sync:${clientKey(req)}`, 120, 60_000);
    const { install: caller, nonce, closed } = authenticate(req as RawRequest);
    limit(installPool, `sync:${caller.id}`, 30, 60_000);
    const b = syncRequest.parse(req.body), when = now(), time = when.toISOString();
    if (closed) {
      // Every business of this install was deleted: nothing is kept from the heartbeat; the café hears it, signed, and waits a day.
      const d = store.read(), pulse = signPulse({ v: 1, installId: caller.id, serverTime: time, machine: 'unknown' }, store.signingKey), contact = signedContact(d);
      // The contact still goes: "Yeniden başlamak için Mola ekibiyle görüşün" needs it most.
      sendSigned(res, caller.secret, nonce, { v: 1, serverTime: time, licenses: [], tickets: [], delivered: { messages: [], freezes: [] }, next: 86400, pulse, removed: removals(d, caller.id), ...(contact ? { contact } : {}) } satisfies SyncResponse);
      return;
    }
    const answer = store.mutate((d): SyncResponse => {
      const install = d.installs.find(i => i.id === caller.id);
      if (!install) throw new DomainError('INSTALL_AUTH', 'Kurulum kimliği doğrulanamadı.', 401);
      const firstContact = !install.lastSeenAt;
      install.lastSeenAt = time; install.appVersion = b.appVersion;
      const mine = d.businesses.filter(x => x.installId === caller.id), owned = new Set(mine.map(x => x.tenantId));
      // Activation (and an import) hands over the licence without `features` (any café version can read it). At the first
      // heartbeat each licence is signed once more, so a newer café takes the copy with `features` (a higher serial).
      if (firstContact) for (const x of mine) store.issue(x, when);
      const machine = seenMachine(d, install, b.machine, time, mine);
      // A computer that another one replaced: it hears that (signed) and gets no licence; its reports do not overwrite the new one's.
      const replaced = machine === 'replaced';
      for (const r of replaced ? [] : b.businesses) {
        const biz = mine.find(x => x.tenantId === r.tenantId); if (!biz) continue;
        const before = store.report(biz.tenantId);
        // A new Mola version on this café (an update, or a full installer): one line in İşlem kayıtları and its version history.
        if (before?.appVersion && before.appVersion !== b.appVersion) d.audit.push({ action: 'cafe.version_changed', target: biz.tenantId, at: time, by: 'cafe', detail: `${before.appVersion} → ${b.appVersion}`, changes: [{ field: 'sürüm', from: before.appVersion, to: b.appVersion }] });
        biz.sector = r.sector;
        // The owner renames the business on the café computer; the licence (and the vendor's list) follows.
        if (r.name.trim() && r.name !== biz.name) { biz.formerNames = [biz.name, ...(biz.formerNames ?? []).filter(n => n !== biz.name && n !== r.name)].slice(0, 5); biz.name = r.name; store.issue(biz, when); }
        // `deliveredSerial`: the licence this answer carries ("lisans kafeye ulaştı" when it equals the newest serial).
        // No second backup place: since when (kept across heartbeats) for the low "ikinci yedek yeri ayarlı değil" alert.
        const missing = b.backup.second && !b.backup.second.set ? before?.secondMissingSince ?? time : undefined;
        store.saveReport(biz.tenantId, { lastSeenAt: time, appVersion: b.appVersion, setupCompleted: r.setupCompleted, ...(r.setupCompletedAt ? { setupCompletedAt: r.setupCompletedAt } : {}), counts: r.counts, backup: b.backup, ...(r.lastActivityAt ? { lastActivityAt: r.lastActivityAt } : {}), ...(r.firstOwnerLoginAt ? { firstOwnerLoginAt: r.firstOwnerLoginAt } : {}), deliveredSerial: biz.serial, ...(missing ? { secondMissingSince: missing } : {}) });
        if (b.backup.enabled && b.backup.failing && !before?.backup.failing) addAlert(d, time, 'cafe.backup', `${biz.name}: işletmenin bilgisayarındaki otomatik yedek başarısız oldu.`, { tenantId: biz.tenantId });
      }
      const delivered = { messages: [] as string[], freezes: [] as string[] };
      for (const t of b.tickets) {
        if (!owned.has(t.tenantId)) continue;
        let ticket = d.tickets.find(x => x.id === t.id);
        if (ticket && ticket.tenantId !== t.tenantId) continue;
        const name = mine.find(x => x.tenantId === t.tenantId)?.name ?? 'İşletme';
        if (!ticket) {
          // Per business: at most TICKETS_PER_DAY new tickets a day. The rest stays queued on the café (not acknowledged) and comes later.
          if (!take(ticketPool, `new:${t.tenantId}`, TICKETS_PER_DAY, DAY)) continue;
          ticket = { id: t.id, tenantId: t.tenantId, subject: t.subject, status: 'open', createdAt: t.createdAt, messages: [] }; d.tickets.push(ticket);
          for (const channel of ['email', 'sms'] as const) d.notifications.push({ id: randomUUID(), ticketId: ticket.id, event: 'ticket.created', channel, audience: 'platform', status: 'awaiting_configuration', at: time });
          addAlert(d, time, 'ticket.new', `${name}: “${t.subject}”`, { tenantId: t.tenantId, ticketId: t.id });
        } else if (t.messages.some(m => !ticket!.messages.some(x => x.id === m.id))) addAlert(d, time, 'ticket.reply', `${name} yanıt yazdı: “${ticket.subject}”`, { tenantId: t.tenantId, ticketId: t.id });
        for (const m of t.messages) {
          if (!ticket.messages.some(x => x.id === m.id)) {
            if (!take(ticketPool, `message:${t.tenantId}`, MESSAGES_PER_DAY, DAY)) continue;
            // Files the café uploaded for this message (same business, not used elsewhere); unknown ones are left out.
            const files = attachments.claim(m.attachments, t.tenantId, ticket.id, m.id, 'business');
            ticket.messages.push({ id: m.id, source: 'business', text: m.text, at: m.at, ...(files.length ? { attachments: files } : {}) }); ticket.status = 'open';
          }
          delivered.messages.push(m.id);
        }
        ticket.messages.sort((x, y) => x.at.localeCompare(y.at));
      }
      for (const f of b.freezes) {
        const biz = mine.find(x => x.tenantId === f.tenantId); if (!biz) continue;
        if (!biz.freezes?.some(x => x.id === f.id)) {
          // A request the café accepted offline may no longer fit (another one was approved meanwhile): it is recorded as declined.
          try { requestFreeze(biz, f.reason, f.startDate, f.days, when, f.id); d.audit.push({ action: 'freeze.requested', target: biz.tenantId, at: time }); }
          catch (e) { if (!(e instanceof DomainError)) throw e; (biz.freezes ??= []).push({ id: f.id, reason: f.reason, startDate: f.startDate, days: f.days, requestedAt: f.requestedAt, status: 'rejected', decision: e.message, decidedAt: time }); }
          store.issue(biz, when);
        }
        delivered.freezes.push(f.id);
      }
      if (mine.length && !replaced) store.addFailures(b.failures.filter(codeLocationOnly), owned, mine[0].tenantId);
      // Otomatik güncelleme: the café's state (a failure or a rollback alerts the vendor) and the release for it, if any.
      releases.record(d, install, b.update, mine.map(x => x.name).join(', ') || 'Bir işletme', mine[0]?.tenantId, time);
      // Tanıtım işletmesi: the café's reset results (history, alert); the signed demo word and the moved address go back.
      recordDemoReports(d, b.demo, mine, when);
      // Mola Lisans Sözleşmesi (a newer text accepted by the owner) and the program files check; a replaced computer's are not kept.
      if (!replaced) { recordAgreements(d, b.agreements, mine, time); integrity.record(d, install, b.integrity, mine, time); }
      // Sahibin uzaktan yönetimi: start and end of each remote session (times and the reason only), once each.
      for (const r of replaced ? [] : b.remoteAdmin ?? []) {
        if (!owned.has(r.tenantId) || !store.db.prepare('INSERT OR IGNORE INTO remote_admin_seen (k, at) VALUES (?,?)').run(`${r.session}:${r.event}`, time).changes) continue;
        d.audit.push({ action: r.event === 'start' ? 'remote_admin.session_started' : 'remote_admin.session_ended', target: r.tenantId, at: r.at, by: 'cafe', detail: `Oturum ${r.session.slice(0, 8)}${r.reason ? ` · ${REMOTE_ENDED[r.reason]}` : ''}` });
      }
      // Duyurular: read marks in, this café's announcements out (only when it asked; a replaced computer gets none).
      const announcements = replaced ? undefined : deliverAnnouncements(d, owned, b.announcements);
      // Sosyal medya: the businesses' public links in, their short-address codes out (a replaced computer's are not kept).
      const social = replaced ? undefined : recordSocial(d, mine, b.social, time, shortLinkOrigin(options.httpSecurity?.publicOrigin));
      // İşletmem var: the owners' password verifiers (a replaced computer's are not kept).
      if (!replaced) recordOwners(d, mine, b.owners, time);
      // İnternetten menü: each business's menu code for the table QR codes (only when the café asks; a replaced computer gets none).
      const tunnel = replaced ? undefined : recordTunnel(d, mine, b.tunnel, time, guestOrigin ?? siteOrigin);
      const notes = signedNotes(store, d, caller.id, replaced ? [] : mine, when);
      const update = replaced ? (b.update ? null : undefined) : releases.offer(b.update, b.appVersion, [...owned]);
      const pulse = signPulse({ v: 1, installId: caller.id, serverTime: time, machine }, store.signingKey);
      const removed = removals(d, caller.id);
      const contact = signedContact(d);
      return { v: 1, serverTime: time, licenses: replaced ? [] : mine.flatMap(x => x.signed ? [x.signed] : []), tickets: d.tickets.filter(x => owned.has(x.tenantId)).slice(-50), delivered, next: 600, pulse, ...(removed.length ? { removed } : {}), ...(contact ? { contact } : {}), accepts: guestOrigin ? [...MERKEZ_ACCEPTS, MENU_ORIGIN_FLAG] : MERKEZ_ACCEPTS,...(update !== undefined ? { update } : {}), ...notes,
        ...(!replaced ? (m => m ? { integrityManifest: m } : {})(integrity.manifestFor(releases, b.integrity)) : {}), ...(announcements ? { announcements } : {}), ...(social ? { social } : {}), ...(tunnel ? { tunnel } : {}) };
    });
    sendSigned(res, caller.secret, nonce, answer);
  });
  /*
   * The café checks an owner reset code (`use: false`, when the owner typed it) and spends it (`use: true`, right before it
   * sets the new password). Signed both ways like the heartbeat; the code must belong to this very install. Five wrong,
   * expired or used codes per install lock it for 15 minutes. Merkez learns nothing about the owner account.
   */
  const resetFailures = new ExpiringStore<Counter>(v => v.until, () => now().getTime(), 20000, true);
  app.post(`${MERKEZ_API}/owner-reset`, (req, res) => {
    limit(addressPool, `owner-reset:${clientKey(req)}`, 60, 60_000);
    const { install: caller, nonce, closed } = authenticate(req as RawRequest);
    const b = z.object({ code: z.string().trim().min(4).max(40), use: z.boolean() }).strict().parse(req.body);
    if (closed) throw new DomainError('RECORD_CLOSED', 'Bu işletmenin Mola kaydı kapatıldı.', 409);
    const t = now().getTime(), tries = resetFailures.get(caller.id);
    if (tries && tries.until > t && tries.count >= 5) throw new DomainError('RATE_LIMIT', 'Çok fazla yanlış deneme. 15 dakika sonra tekrar deneyin.', 429);
    const fail = (code: string, message: string) => {
      const c = resetFailures.get(caller.id);
      if (c && c.until > t) c.count++; else resetFailures.set(caller.id, { count: 1, until: t + 15 * 60_000 });
      return new DomainError(code, message, 403);
    };
    const answer = store.mutate(d => {
      const hash = resetCodeHash(b.code), code = (d.ownerResets ?? []).find(c => c.hash === hash && c.installId === caller.id);
      // A code made for another café is simply wrong here (nothing tells which café it belongs to).
      if (!code) throw fail('WRONG_CODE', 'Kod yanlış. Mola ekibinin okuduğu kodu kontrol edin.');
      if (code.usedAt) throw fail('CODE_USED', 'Bu kod daha önce kullanıldı. Mola ekibinden yeni kod isteyin.');
      if (Date.parse(code.expiresAt) <= t) throw fail('CODE_EXPIRED', 'Kodun süresi dolmuş (30 dakika). Mola ekibinden yeni kod isteyin.');
      const biz = d.businesses.find(x => x.tenantId === code.tenantId && x.installId === caller.id);
      if (!biz) throw fail('WRONG_CODE', 'Kod yanlış. Mola ekibinin okuduğu kodu kontrol edin.');
      if (biz.suspended) throw new DomainError('SUSPENDED', 'Hizmet askıda; şifre sıfırlama kodu kullanılamaz. Mola ekibiyle görüşün.', 409);
      if (b.use) {
        const time = at(); code.usedAt = time;
        d.audit.push({ action: 'owner_reset.used', target: biz.tenantId, at: time, by: 'cafe' });
        addAlert(d, time, 'owner.reset', `${biz.name}: işletme sahibinin şifresi, Mola ekibinin verdiği tek kullanımlık kodla işletmenin bilgisayarında yenilendi.`, { tenantId: biz.tenantId });
      }
      return { ok: true as const, tenantId: biz.tenantId, name: biz.name, expiresAt: code.expiresAt };
    });
    sendSigned(res, caller.secret, nonce, answer);
  });
  releaseRoutes(app, { ...releaseDeps(), admin: releaseAdmin, right });
  // İşlem kayıtları, Çalışma klasörü (written by runtime.ts's timer; tests call run()), Geliştirici erişimi, "Klasörde hazır".
  const workFolder = new WorkFolder({ store, releases, attachments, backups: () => options.backups?.status() ?? null, now, version: APP_VERSION, ...(options.workFolderDefault !== undefined ? { fallback: options.workFolderDefault } : {}) });
  app.locals.workFolder = workFolder;
  journalRoutes(app, { store, now, admin, owner: ownerOnly, releaseAdmin, releaseChange, tokenOrAdmin, checkPassword: auth.checkPassword, releases, workFolder, version: APP_VERSION });
  // Prices, packages and payments: the same Authenticator step-up as Güncellemeler (server/merkez/step-up.ts).
  const salesChange = (req: Request) => { const who = admin(req); right.require(who, 'sales'); return who; };
  catalogRoutes(app, { store, now, admin, change: salesChange, once: (d, scope, b, fn) => once(d, scope, b, fn), find });
  salesRoutes(app, { store, now, admin, change: salesChange, book: sales, once: (d, scope, b, fn) => once(d, scope, b, fn) });
  // Duyurular: sending, editing and withdrawing need the same step-up ('announce'); reading the list does not.
  announcementRoutes(app, { store, now, admin, change: req => { const who = admin(req); right.require(who, 'announce'); return who; }, once: (d, scope, b, fn) => once(d, scope, b, fn) });
  demoRoutes(app, { store, now, admin, once: (d, scope, b, fn) => once(d, scope, b, fn), find, authenticate: req => authenticate(req as RawRequest), sendSigned, limit: (k, max, ms) => limit(addressPool, k, max, ms) });
  // Web sitesi talepleri (server/merkez/site-leads.ts): molayazilim.com.tr's contact form → Başvurular.
  siteLeadRoutes(app, { store, now, admin, once: (d, scope, b, fn) => once(d, scope, b, fn) });
  // MERKEZ_YENI_ADRES (ayarlar.cmd / systemd): the address this Merkez announces after a move, set once at start (docs/VDS_KURULUM.md).
  { const announced = process.env.MERKEZ_YENI_ADRES?.trim(); if (announced) { const url = merkezAddressFrom(announced); if (url && store.read().address?.url !== url) store.mutate(d => { setAddress(d, url, now()); }); } }
  /**
   * Saklama süreleri (8 Ekim; the lawyer may change them, docs/hukuk): closed support conversations 2 years after their last
   * message (with any files left), rejected applications 1 year after the decision (never connected: no install, no sales),
   * IP addresses in İşlem kayıtları after 1 year (server/merkez/journal.ts maskAddresses: the chain stays verifiable).
   * Every 6 hours (and from tests: app.locals.retention). Each deletion is one line in İşlem kayıtları, without personal data.
   */
  function retention(at = now()) {
    const t = at.getTime(), d = store.read(), stamp = at.toISOString();
    const lastOf = (x: Ticket) => [x.createdAt, ...x.messages.map(m => m.at)].sort().at(-1)!;
    const tickets = d.tickets.filter(x => x.status === 'closed' && t - Date.parse(lastOf(x)) > SUPPORT_KEEP_DAYS * DAY).map(x => x.id);
    const rejected = d.businesses.filter(b => !b.installId && b.application?.status === 'rejected' && t - Date.parse(b.application.decidedAt ?? b.application.submittedAt) > REJECTED_KEEP_DAYS * DAY).map(b => b.tenantId);
    if (tickets.length || rejected.length) store.mutate(x => {
      const gone = new Set(tickets);
      for (const k of x.tickets.filter(k => gone.has(k.id))) { attachments.forgetTicket(k.id, at); x.audit.push({ action: 'ticket.deleted_retention', target: k.tenantId, at: stamp, by: 'system', detail: `Talep ${k.id.slice(0, 8)} (kapanalı ${SUPPORT_KEEP_DAYS / 365} yıl)` }); }
      x.tickets = x.tickets.filter(k => !gone.has(k.id)); x.notifications = x.notifications.filter(n => !gone.has(n.ticketId));
      for (const a of x.alerts ?? []) if (a.ticketId && gone.has(a.ticketId)) delete a.ticketId;
      for (const id of rejected) { const biz = x.businesses.find(b => b.tenantId === id); if (biz) { remove(x, biz); x.audit.push({ action: 'application.deleted_retention', target: id, name: biz.name, at: stamp, by: 'system', detail: `reddedileli ${REJECTED_KEEP_DAYS / 365} yıl` }); } }
    });
    return { tickets: tickets.length, applications: rejected.length, addresses: store.journal.maskAddresses(at) };
  }
  app.locals.retention = retention;
  { const t = setInterval(() => { try { retention(); } catch { /* closed or busy: next time */ } }, 6 * 3600_000); t.unref(); }
  app.use('/api', (_req, _res, next) => next(new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404)));
  app.use(diagnostics.error);
  return app;
}
/** Saklama: closed support conversations (days after their last message) and rejected applications (days after the decision). */
export const SUPPORT_KEEP_DAYS = 730, REJECTED_KEEP_DAYS = 365;
export type MerkezApp = Express;
