import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KeyObject } from 'node:crypto';
import type { Invoice } from '../../packages/domain/invoice.js';
import type { Sector } from '../../packages/domain/sector.js';
import { open, seal } from '../sealing.js';
import { newAdmin, type AdminRecord } from '../admin-auth.js';
import { licenseClaims, newSigningPair, privateKeyFrom, signLicense, type ContactInfo, type License, type SignedLicense, type Ticket } from '../license.js';
import type { FailureReport, SyncRequest } from '../sync-protocol.js';
import { features, type FeatureId } from '../../packages/domain/features.js';
import { isFeatureId, LEGACY_FULL, LEGACY_MENU, legacyFeatures, sellableFeatures, serviceOf, type Discount, type ServicePackage, type ServicePrices } from '../../packages/domain/service-pricing.js';
import type { Alert, MailItem, MailSettings } from './alerts.js';
import { Journal, type JournalChange } from './journal.js';
import type { Announcement } from './announcements.js';

/*
 * Mola Merkez data (data folder, e.g. .local/merkez): merkez.sqlite + its key (development.key, or anahtar.json when
 * MERKEZ_KEY_PROTECTION=1). One sealed record holds the registry: admin, businesses with their licences, installs,
 * activation codes (hashes), tickets, audit, notifications. Heartbeat reports, failure records and nonces sit in their own
 * tables. The Ed25519 private key is sealed with the same key; only the public key is written out as a plain file.
 * Never here: sales, payments, orders, menus, staff accounts or customer data. Those stay on the café computer.
 */
/** 'trial': the retired self-serve trial (older records); 'application': "Hesap açma başvurusu", started by the vendor. */
export type BusinessSource = 'trial' | 'code' | 'import' | 'admin' | 'application';
/**
 * A café's application before the vendor decides. The install is made only on approval (with the café's own install id).
 * `duplicateTax`: refused on arrival because the tax number already has a pending application or a licence;
 * `branch`: the vendor accepted it anyway as another branch ("Ek şube olarak kabul et").
 */
export type Application = {
  status: 'pending' | 'rejected' | 'approved'; installId: string; activationId: string; machineId: string; appVersion: string;
  submittedAt: string; decidedAt?: string; reason?: string; duplicateTax?: boolean; branch?: boolean;
  /** The first time this application arrived (kept across corrections; older records: submittedAt). */
  firstSubmittedAt?: string;
  /** Keyed hashes of the tax numbers this application has used, so changing the number again and again is limited. */
  taxHashes?: string[];
  /** How many times the café sent it (first + corrections). */
  submissions?: number;
};
export type MerkezBusiness = License & {
  /** Chosen by the vendor or the café; unset until then (the owner picks it in the first setup). */
  sector?: Sector; contactName?: string; /** Names before the owner renamed it on the café computer (newest first, at most 5): the vendor still finds "Denetim Kafe". */ formerNames?: string[]; installId?: string; source: BusinessSource; serial: number; signed?: SignedLicense;
  machineId?: string; activatedAt?: string;
  /** Fatura bilgileri: from the application or typed by the vendor. Only in this sealed registry, never in logs. */
  invoice?: Invoice; application?: Application;
  /** The café's stable activation id (kept across its retries): a repeat finds this business instead of making another. */
  activationId?: string;
  /** "İşletmem var" (13 Ekim): the owner's username and password verifier from the café (server/merkez/owner-login.ts). */
  ownerLogin?: import('./owner-login.js').OwnerLogin;
  /** The e-mail the owner verified in the café's Ayarlar (İşletmem var code and notices), next to the invoice e-mail. */
  ownerEmail?: import('./owner-login.js').OwnerEmail;
  /** The vendor's own notes about this business (never sent to the café). */
  notes?: string;
  /** Why the vendor suspended it (shown in Mola Yönetim and the history). */
  suspendReason?: string;
  /**
   * "Tanıtım işletmesi" (Hizmet): the vendor's demo for sales visits (`demo` false once turned off, so the café hears it).
   * `demoReset`: the last "Tanıtımı sıfırla" order, signed into the heartbeat answer while pending (server/signed-notes.ts).
   */
  demo?: boolean; demoSince?: string;
  demoReset?: { id: string; sector: 'cafe' | 'restaurant' | 'dessert'; demoPassword: boolean; requestedAt: string; status: 'pending' | 'done' | 'failed' | 'expired'; doneAt?: string; error?: string };
  /**
   * Hizmet (paketler, 5 Ekim): the package (`packageId`) or "Özel" (null) and the services it gives, kept resolved here (a
   * package edit rewrites them for every business on it), plus this business's own discount. Missing: no package chosen yet
   * (a new application): every sellable service, as before packaging. See server/merkez/catalog.ts.
   */
  services?: BusinessServices;
  /** Until 11 Ekim: the copy of `signed` with `features` (then `signed` had none). No longer written or sent (O6); see `issue`. */
  signedFeatures?: SignedLicense;
  /** Mola Lisans Sözleşmesi: the newest acceptance the café sent (activation or heartbeat; server/merkez/integrity.ts keepAgreement). */
  agreement?: { version: number; acceptedAt: string; name?: string; receivedAt: string };
  /**
   * Sosyal medya (6 Ekim): the business's public links as its café last sent them (checked again here) and its short-address
   * code (`/s/<code>/<platform>`, random, given once and never changed). Public data; forwarded only while the licence is active.
   */
  social?: { code: string; links: Partial<Record<string, string>>; updatedAt: string };
  /**
   * İnternetten menü (7 Ekim): the business's public menu code (`/q/<code>/<masa kodu>`, server/merkez/guest-tunnel.ts), random,
   * given once when its café first asks (heartbeat `tunnel`) and never changed: printed table QR codes keep working.
   */
  menu?: { code: string; since: string };
};
export type BusinessServices = { packageId: string | null; features: FeatureId[]; discount?: Discount; updatedAt: string };
/** "Hizmet fiyatları" and "Paketler" (Ayarlar) and the KDV rate of Satışlarım; made once, with the starting packages. */
export type Catalog = {
  prices: ServicePrices; packages: ServicePackage[]; vatRate: number; createdAt: string; updatedAt: string;
  /** Which catalogue step this record has had (server/merkez/catalog.ts CATALOG_VERSION); missing = 1 (5 Ekim). */
  version?: number;
};
/**
 * One computer that sent heartbeats for an install (HMAC of its machine id). `replacedAt`: a newer computer took over.
 * `restoredAt`: the vendor gave the licence back to it ("Eski bilgisayarı yeniden etkinleştir"): the swap is settled.
 */
export type InstallMachine = { hash: string; firstSeenAt: string; lastSeenAt: string; replacedAt?: string; restoredAt?: string };
/** `activationId`: set when the café chose the install id itself (retry-safe activation); older installs have none. */
export type Install = { id: string; secret: string; createdAt: string; machineId?: string; lastSeenAt?: string; appVersion?: string; revokedAt?: string; activationId?: string; machines?: InstallMachine[] };
export type ActivationCode = { hash: string; tenantId: string; createdAt: string; expiresAt: string; usedAt?: string };
export type Notification = { id: string; ticketId: string; event: 'ticket.created' | 'ticket.closed'; channel: 'email' | 'sms'; audience: 'platform' | 'business'; status: 'awaiting_configuration'; at: string };
/**
 * A connected business the vendor deleted after suspending it: just enough so its café's next signed heartbeat gets a signed
 * final answer ("kaydı kapatıldı"). Ids and time only (the name stays in the history). `secret`: the install's own secret,
 * kept only when the install went with the business, to check the café's signature and sign the answer.
 */
export type Tombstone = { tenantId: string; installId: string; deletedAt: string; secret?: string };
/**
 * "Sahip şifresi sıfırlama kodu": the vendor reads it to an owner who lost both password and recovery code. Only its hash is
 * kept, bound to the business and its install (useless at another café), valid 30 minutes, used once. Merkez never sees the
 * owner's username or password: the café shows its own owners and sets the password itself.
 */
export type OwnerResetCode = { hash: string; tenantId: string; installId: string; createdAt: string; expiresAt: string; usedAt?: string };
/**
 * One line of "İşlem geçmişi": who (`by`), what, and for changes the old → new value (`detail`). `changes`: the same as
 * fields for the tamper-evident İşlem kayıtları (server/merkez/journal.ts), which gets every line; never secrets.
 */
export type AuditEntry = { action: string; target: string; at: string; name?: string; by?: 'admin' | 'cafe' | 'system'; detail?: string; changes?: JournalChange[] };
/**
 * "Geliştirici erişimi": a token for scripts (npm run yayinla), shown once; only its SHA-256 is kept. `scope`: what it may do
 * (releases: Güncellemeler only; calisma: read the Çalışma klasörü snapshot, for the VDS sync).
 */
export type AccessToken = { id: string; name: string; scope: 'releases' | 'calisma'; hash: string; hint: string; createdAt: string; lastUsedAt?: string; revokedAt?: string };
export type MerkezData = {
  admin: AdminRecord; businesses: MerkezBusiness[]; installs: Install[]; codes: ActivationCode[]; tickets: Ticket[];
  /** `name`: kept when the target itself is gone (a deleted record), so the history still says which business it was. */
  audit: AuditEntry[]; notifications: Notification[]; requests: Record<string, { fingerprint: string; at?: string; result: unknown }>;
  /** "Bildirim merkezi" and the e-mail queue (server/merkez/alerts.ts); missing in older records. */
  alerts?: Alert[]; mail?: { settings?: MailSettings; queue: MailItem[] };
  /** Deleted connected businesses (see Tombstone); missing in older records. */
  removed?: Tombstone[];
  /** Owner password reset codes (hashes only); missing in older records. */
  ownerResets?: OwnerResetCode[];
  /** "Mola ekibi iletişim bilgileri" (Ayarlar), signed for the cafés; missing until the vendor saves it. */
  contact?: ContactInfo & { updatedAt: string };
  /** "Merkez adresi": Mola Merkez moved here (VDS + HTTPS); announced signed to every café (server/signed-notes.ts mola-adres-1). */
  address?: { url: string; issuedAt: string };
  /** Geliştirici erişimi (hashes only); missing until the first token. */
  accessTokens?: AccessToken[];
  /** "Çalışma klasörü" (server/merkez/workfolder.ts): `path` null = off; missing = the default for this run. */
  workFolder?: { path: string | null; updatedAt: string };
  /** Prices, packages, KDV rate (server/merkez/catalog.ts); missing until this version's first start (it seeds them). */
  catalog?: Catalog;
  /** Duyurular (server/merkez/announcements.ts): what the vendor sent to the businesses and who read it; missing until the first. */
  announcements?: Announcement[];
};
/** The last heartbeat of one business: setup progress, counts, backup health. No business data. */
export type Report = {
  lastSeenAt: string; appVersion: string; setupCompleted: boolean; setupCompletedAt?: string; counts: { tables: number; staff: number; products: number };
  backup: SyncRequest['backup']; lastActivityAt?: string; firstOwnerLoginAt?: string;
  /** The licence serial sent back with this heartbeat: the café has the newest licence when it equals the business's serial. */
  deliveredSerial?: number;
  /** Since when the café has reported "no second backup place" (kept across heartbeats; gone once one is set). */
  secondMissingSince?: string;
};
/** The services a business was given (its package or "Özel"); none chosen yet: as its old plan (everything, or menu only). */
export const assignedFeatures = (b: Pick<MerkezBusiness, 'services' | 'service'>): FeatureId[] => b.services?.features ?? legacyFeatures(b.service ?? 'full');
/**
 * What the signed licence lets the café use: during the trial every sellable service ("şu an her şey açık"); afterwards the
 * business's own services. A suspended business keeps the same list (its status closes ordering anyway).
 */
export const licenseFeatures = (b: Pick<MerkezBusiness, 'services' | 'service' | 'kind'>): FeatureId[] => withTestSoon(b, b.kind === 'trial' ? sellableFeatures() : assignedFeatures(b));
/**
 * "Yakında" services are in no licence (6 Ekim: closed on every café until sold). Only the browser tests' own Merkez
 * (scripts/test-server.mjs sets MOLA_TEST_OPEN_SOON=1; never a real Merkez) adds them for businesses still on an old plan, so
 * the suites that drive the Deneme platformu keep working; a business given a package or "Özel" gets them closed as usual.
 */
function withTestSoon(b: Pick<MerkezBusiness, 'services'>, list: FeatureId[]): FeatureId[] {
  if (process.env.MOLA_RELEASE_BUILD === '1' || process.env.MOLA_TEST_OPEN_SOON !== '1' || (b.services && b.services.packageId !== LEGACY_FULL && b.services.packageId !== LEGACY_MENU)) return list;
  return [...list, ...features.filter(f => f.soon && !list.includes(f.id)).map(f => f.id)];
}
/** Written by a restore from backup; the next start re-signs every licence above the cafés' serials. */
export const MARK_RESTORED = 'geri-yuklendi.json';
export const REQUEST_RETENTION_MS = 7 * 86400000, AUDIT_KEEP = 2000, NOTIFICATIONS_KEEP = 2000, FAILURES_PER_BUSINESS = 500;
export const codeHash = (code: string) => createHash('sha256').update(`mola-etkinlestirme:v1:${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}`).digest('hex');
/** Its own domain: an owner reset code never matches an activation code's hash and the other way round. */
export const resetCodeHash = (code: string) => createHash('sha256').update(`mola-sahip-sifre:v1:${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}`).digest('hex');

export class MerkezStore {
  db: DatabaseSync; signingKey: KeyObject; publicKey: string;
  clock: () => Date = () => new Date();
  constructor(public directory: string, private key: Buffer, options: { initialPassword?: string } = {}) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'merkez.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS merkez (id INTEGER PRIMARY KEY, payload BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS signing (id INTEGER PRIMARY KEY, payload BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS reports (tenant TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS failures (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS failures_tenant_time ON failures(tenant, at);
      CREATE TABLE IF NOT EXISTS nonces (install TEXT NOT NULL, nonce TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (install, nonce));
      CREATE TABLE IF NOT EXISTS tax_index (hash TEXT NOT NULL, tenant TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (hash, tenant));
      CREATE TABLE IF NOT EXISTS contact_index (hash TEXT NOT NULL, tenant TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (hash, tenant, kind));`);
    // Since first submission (data from before this column: filled by createMerkezApp on its first start).
    if (!(this.db.prepare('PRAGMA table_info(tax_index)').all() as { name: string }[]).some(c => c.name === 'since')) this.db.exec('ALTER TABLE tax_index ADD COLUMN since TEXT');
    if (!this.db.prepare('SELECT id FROM merkez WHERE id=1').get()) {
      const { admin, password } = newAdmin(options.initialPassword);
      const data: MerkezData = { admin, businesses: [], installs: [], codes: [], tickets: [], audit: [], notifications: [], requests: {} };
      this.db.prepare('INSERT INTO merkez VALUES (1,?)').run(seal(data, key, 'merkez'));
      // A password given by the caller (tests, scripted setup) is already known; a generated one is written once for the vendor.
      if (!options.initialPassword) writeFileSync(join(directory, 'merkez-first-login.txt'), `Mola Yönetim ilk giriş\nAdres: /\nKullanıcı: admin\nŞifre: ${password}\n`, { flag: 'wx', mode: 0o600 });
    }
    let row = this.db.prepare('SELECT payload FROM signing WHERE id=1').get() as { payload: Uint8Array } | undefined;
    if (!row) {
      const pair = newSigningPair();
      this.db.prepare('INSERT INTO signing VALUES (1,?)').run(seal({ ...pair, createdAt: new Date().toISOString() }, key, 'merkez-signing'));
      row = this.db.prepare('SELECT payload FROM signing WHERE id=1').get() as { payload: Uint8Array };
    }
    const pair = open<{ privateKey: string; publicKey: string }>(Buffer.from(row.payload), key, 'merkez-signing');
    this.signingKey = privateKeyFrom(pair.privateKey); this.publicKey = pair.publicKey;
    // İşlem kayıtları (additive tables; the old list is carried over once as one block) before anything new is written.
    this.journal = new Journal(this.db, key, this.signingKey, this.publicKey, () => this.clock());
    this.journal.migrate(this.read());
    // Older Merkez data whose generated first password was never changed (its file is still there): change it first.
    const first = join(directory, 'merkez-first-login.txt');
    if (existsSync(first) && !options.initialPassword) {
      const d = this.read();
      if (d.admin.mustChange === undefined && !d.audit.some(a => a.action === 'admin.password_changed')) this.mutate(x => { x.admin.mustChange = true; });
    }
    // Cafés need only this: copy it to MOLA_MERKEZ_PUBLIC_KEY (or into the release build). It is not secret.
    const file = join(directory, 'merkez-public-key.txt');
    if (!existsSync(file) || readText(file) !== pair.publicKey) writeFileSync(file, pair.publicKey + '\n');
    // Restored from a backup (server/merkez/backup.ts): cafés may hold licences signed after that backup, with higher
    // serials than the restored ones. Each licence is signed again well above them, so every café takes the next one.
    const restored = join(directory, MARK_RESTORED);
    if (existsSync(restored)) {
      this.mutate(d => { for (const b of d.businesses) if (b.installId) { b.serial = (b.serial ?? 0) + 1000; this.issue(b, this.clock()); } d.audit.push({ action: 'merkez.restored', target: 'admin', at: this.clock().toISOString(), by: 'system' }); });
      rmSync(restored, { force: true });
    }
  }
  read(): MerkezData { const r = this.db.prepare('SELECT payload FROM merkez WHERE id=1').get() as { payload: Uint8Array }; return withKnownServices(open<MerkezData>(Buffer.from(r.payload), this.key, 'merkez')); }
  mutate<T>(fn: (d: MerkezData) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    let result: T;
    try {
      const d = this.read(), before = d.audit.length; result = fn(d); const now = this.clock().getTime();
      // Every new history line goes into the tamper-evident chain in the same transaction (both or neither).
      for (const entry of d.audit.slice(before)) { this.journal.fromAudit(entry, d); delete entry.changes; }
      for (const record of Object.values(d.requests)) record.at ??= new Date(now).toISOString();
      for (const [k, record] of Object.entries(d.requests)) if (Date.parse(record.at!) < now - REQUEST_RETENTION_MS) delete d.requests[k];
      if (d.audit.length > AUDIT_KEEP) d.audit = d.audit.slice(-AUDIT_KEEP);
      if (d.notifications.length > NOTIFICATIONS_KEEP) d.notifications = d.notifications.slice(-NOTIFICATIONS_KEEP);
      this.db.prepare('UPDATE merkez SET payload=? WHERE id=1').run(seal(d, this.key, 'merkez'));
      this.db.exec('COMMIT');
      this.generation++;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    try { this.onChange?.(); } catch { /* the Çalışma klasörü catches up on its own timer */ }
    return result;
  }
  /** After every committed change (the Çalışma klasörü follows it). */
  onChange?: () => void;
  /** Grows with every committed change: a reader's cache (the public social short addresses) knows when to read again. */
  generation = 0;
  /** İşlem kayıtları (server/merkez/journal.ts). */
  journal: Journal;
  /**
   * Every change to a licence is a new signed licence with a higher serial; the café keeps the highest. One licence, always
   * with `features` (güvenlik denetimi O6, 11 Ekim): the second copy without them (for cafés from before packaging) is no
   * longer signed or sent, so nobody can put a "no list = everything" copy in place of a paid package. `service` still follows
   * the services. `signedFeatures` (the old second field) is cleared.
   */
  issue(b: MerkezBusiness, now: Date) {
    if (!b.installId) return;
    b.serial = (b.serial ?? 0) + 1;
    const features = licenseFeatures(b), claims = licenseClaims({ ...b, features: undefined, service: serviceOf(features) }, b.installId, b.serial, now);
    b.signed = signLicense({ ...claims, features }, this.signingKey);
    delete b.signedFeatures;
  }
  report(tenant: string): Report | undefined {
    const row = this.db.prepare('SELECT payload FROM reports WHERE tenant=?').get(tenant) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  }
  /**
   * A deleted business: its report and failure rows go with it. Never connected: a tax number that once got a licence stays
   * blocked. Connected (deleted after suspension, `closed`): its numbers stay as 'deleted' (keyed hashes only), so a new
   * application with one is flagged to the vendor ("daha önce silinen bir işletmeye aitti") without blocking it.
   */
  forget(tenant: string, closed = false) {
    this.db.prepare('DELETE FROM reports WHERE tenant=?').run(tenant); this.db.prepare('DELETE FROM failures WHERE tenant=?').run(tenant);
    this.db.prepare('DELETE FROM contact_index WHERE tenant=?').run(tenant);
    if (closed) this.db.prepare("UPDATE tax_index SET state='deleted' WHERE tenant=?").run(tenant);
    else this.db.prepare("DELETE FROM tax_index WHERE tenant=? AND state <> 'granted'").run(tenant);
  }
  /** The number belonged to a business deleted after it had connected (see forget). */
  taxDeleted(taxNumber: string, except: string) {
    return !!this.db.prepare("SELECT 1 FROM tax_index WHERE hash=? AND tenant<>? AND state='deleted' LIMIT 1").get(this.taxHash(taxNumber), except);
  }
  /**
   * Tax number index (table tax_index): HMAC-SHA256 with a key derived from Merkez's data key, never the number itself (a
   * TCKN space is small enough to hash through). `state`: 'pending' application, 'granted' (a trial or licence was ever
   * issued: kept), 'none'. Lets one person or company apply once; the vendor adds branches deliberately.
   */
  taxHash(taxNumber: string) { return createHmac('sha256', createHmac('sha256', this.key).update('mola-vergi-dizini:v1').digest()).update(taxNumber.replace(/\D/g, '')).digest('hex'); }
  /** `since`: when this business first sent the number (its first application), so earlier applicants come first. */
  indexTax(tenant: string, taxNumber: string | undefined, state: 'pending' | 'granted' | 'none', since = '') {
    // Once granted, always granted for this business: a number corrected later by the vendor keeps the old one blocked too.
    const granted = !!this.db.prepare("SELECT 1 FROM tax_index WHERE tenant=? AND state='granted'").get(tenant);
    this.db.prepare("DELETE FROM tax_index WHERE tenant=? AND state <> 'granted'").run(tenant);
    if (taxNumber) this.db.prepare('INSERT OR REPLACE INTO tax_index (hash, tenant, state, since) VALUES (?,?,?,?)').run(this.taxHash(taxNumber), tenant, granted ? 'granted' : state, since);
  }
  /**
   * Another business holds the number ahead of this one: a licence or a pending application first sent earlier (`before`,
   * ties by id). "Önce başvuran sonradan gelen yüzünden işaretlenmez": a later applicant the vendor accepted anyway (an
   * "Ek şube") does not flag the earlier one. Rows without a time (older data) always count. Without `before` every pending
   * or granted one counts. Never refuses anything by itself: only flags it.
   */
  taxTaken(taxNumber: string, except: string, before?: string) {
    const hash = this.taxHash(taxNumber);
    if (before === undefined) return !!this.db.prepare("SELECT 1 FROM tax_index WHERE hash=? AND tenant<>? AND state IN ('pending','granted') LIMIT 1").get(hash, except);
    return !!this.db.prepare("SELECT 1 FROM tax_index WHERE hash=? AND tenant<>? AND state IN ('pending','granted') AND (COALESCE(since,'') = '' OR COALESCE(since,'') < ? OR (COALESCE(since,'') = ? AND tenant < ?)) LIMIT 1").get(hash, except, before, before, except);
  }
  /**
   * Phone / e-mail index (table contact_index) for "Olası tekrar": keyed HMACs of the normalized values only (the numbers and
   * addresses stay in the sealed registry), so the same phone or e-mail on two records is found without a second plain copy.
   */
  contactHash(kind: 'phone' | 'email', value: string) {
    const normal = kind === 'phone' ? value.replace(/\D/g, '').slice(-10) : value.trim().toLocaleLowerCase('tr-TR').replace(/\+[^@]*@/, '@');
    return createHmac('sha256', createHmac('sha256', this.key).update('mola-iletisim-dizini:v1').digest()).update(`${kind}:${normal}`).digest('hex');
  }
  indexContact(tenant: string, invoice?: Pick<Invoice, 'phone' | 'email'>) {
    this.db.prepare('DELETE FROM contact_index WHERE tenant=?').run(tenant);
    if (!invoice) return;
    for (const kind of ['phone', 'email'] as const) if (invoice[kind]?.trim()) this.db.prepare('INSERT OR IGNORE INTO contact_index (hash, tenant, kind) VALUES (?,?,?)').run(this.contactHash(kind, invoice[kind]), tenant, kind);
  }
  /** Other records with the same phone or e-mail as this one: tenant → kinds. */
  sameContact(tenant: string) {
    const rows = this.db.prepare('SELECT DISTINCT b.tenant AS tenant, b.kind AS kind FROM contact_index a JOIN contact_index b ON a.hash=b.hash AND a.kind=b.kind WHERE a.tenant=? AND b.tenant<>?').all(tenant, tenant) as { tenant: string; kind: 'phone' | 'email' }[];
    const found = new Map<string, Set<'phone' | 'email'>>();
    for (const r of rows) (found.get(r.tenant) ?? found.set(r.tenant, new Set()).get(r.tenant)!).add(r.kind);
    return found;
  }
  /** A key for one purpose, derived from Merkez's data key (destek ekleri: server/merkez/attachments.ts). */
  subkey(purpose: string) { return createHmac('sha256', this.key).update(`mola-alt-anahtar:v1:${purpose}`).digest(); }
  saveReport(tenant: string, report: Report) { this.db.prepare('INSERT INTO reports VALUES (?,?) ON CONFLICT(tenant) DO UPDATE SET payload=excluded.payload').run(tenant, JSON.stringify(report)); }
  addFailures(records: FailureReport[], tenants: Set<string>, fallback: string) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO failures VALUES (?,?,?,?)');
    for (const r of records) {
      // A record without a business (login, health) belongs to the install's first business, so the vendor still sees it.
      const tenant = r.tenantId && tenants.has(r.tenantId) ? r.tenantId : fallback;
      insert.run(r.requestId, tenant, Date.parse(r.at) || 0, JSON.stringify(r));
    }
    for (const tenant of tenants) this.db.prepare('DELETE FROM failures WHERE tenant=? AND id NOT IN (SELECT id FROM failures WHERE tenant=? ORDER BY at DESC LIMIT ?)').run(tenant, tenant, FAILURES_PER_BUSINESS);
    this.db.prepare('DELETE FROM failures WHERE at < ?').run(this.clock().getTime() - 30 * 86400000);
  }
  failures(tenant: string): FailureReport[] { return (this.db.prepare('SELECT payload FROM failures WHERE tenant=? ORDER BY at DESC LIMIT 500').all(tenant) as { payload: string }[]).map(r => JSON.parse(r.payload)); }
  failure(id: string): FailureReport | null { const r = this.db.prepare('SELECT payload FROM failures WHERE id=?').get(id) as { payload: string } | undefined; return r ? JSON.parse(r.payload) : null; }
  /** false: this nonce was already used by this install (a replay). Old nonces go once outside the accepted time window. */
  useNonce(install: string, nonce: string, at: number) {
    this.db.prepare('DELETE FROM nonces WHERE at < ?').run(at - 20 * 60_000);
    try { this.db.prepare('INSERT INTO nonces VALUES (?,?,?)').run(install, nonce, at); return true; }
    catch { return false; }
  }
  close() { this.db.close(); }
}
/**
 * Retired service ids in stored data (6 Ekim: 'manager-role', the Müdür account is part of the core now) are dropped as the
 * record is read: prices, packages (old plans too) and businesses' services. Old data opens without an error and every
 * screen, price and licence sees only the services this version knows; nothing else in the record changes.
 */
function withKnownServices(d: MerkezData) {
  if (d.catalog) {
    for (const id of Object.keys(d.catalog.prices ?? {})) if (!isFeatureId(id)) delete (d.catalog.prices as Record<string, unknown>)[id];
    for (const p of d.catalog.packages ?? []) p.features = known(p.features);
  }
  for (const b of d.businesses) if (b.services) b.services.features = known(b.services.features);
  return d;
}
function known(ids: readonly unknown[]) {
  return (ids as unknown[]).filter(isFeatureId);
}
function readText(path: string) { try { return readFileSync(path, 'utf8').trim(); } catch { return ''; } }
