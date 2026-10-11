import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Request } from 'express';
import { loopbackRequest } from '../http-security.js';
import { keyFingerprint, publicKeyFrom, showFingerprint } from '../license.js';
import { open, seal } from '../sealing.js';
import { ACTOR_NAMES, actionGroup, actionText, CAFE_ACTIONS, canonicalJson, istanbulDay, resultOf, type JournalActorKind, type JournalGroup, type JournalResult, type JournalSource } from './journal-text.js';
import type { AuditEntry, MerkezData } from './store.js';

/*
 * İşlem kayıtları: Mola Merkez's tamper-evident record of every vendor action and every security-relevant event, kept so
 * it could one day be handed to an authority.
 *   - Append-only table `islem_kayitlari` in merkez.sqlite (SQLite triggers refuse UPDATE and DELETE; only the yearly
 *     retention clean-up may delete the oldest lines, and it leaves an anchor). Each row: seq, time, hash, prev, and the
 *     entry itself sealed with a key derived from Merkez's data key (bound to its seq, so a row cannot be moved).
 *   - Hash chain: hash = SHA-256 of the entry's canonical JSON (journal-text.ts canonicalJson), the entry including its
 *     own seq and the previous entry's hash (`prev`; the first one: 64 zeros, or the retention anchor).
 *   - "Mühür": every hour (and before every report and daily note) the head is signed with Merkez's Ed25519 key
 *     (the licence key, its own domain `mola-islem-muhur-1`), table `islem_muhurleri`. Deleting the newest lines, or
 *     rewriting the chain, breaks a seal.
 *   - verify() walks the whole chain and every seal: "Kayıtlar bütün" or exactly which line breaks it.
 * Every `d.audit.push` inside MerkezStore.mutate lands here too (same transaction); security events that are not part of
 * the short "İşlem geçmişi" list (logins, support actions, nightly backups…) are appended directly.
 * Who/where come from journalContext (one per HTTP request, set in createMerkezApp); no request means "Sistem".
 * Never written here: passwords, codes, tokens, keys, SMTP passwords, invoice values, sales data.
 */
export type JournalActor = { kind: JournalActorKind; id?: string; name?: string };
export type JournalTarget = { kind: 'business' | 'ticket' | 'release' | 'merkez' | 'admin' | 'token'; id: string; name?: string };
export type JournalChange = { field: string; from?: string; to?: string };
/** One line of the old "İşlem geçmişi" list, carried over once in the "Geçmiş kayıtlar aktarıldı" block. */
export type LegacyRow = { at: string; action: string; text: string; by?: string; target: string; name?: string; business?: { id: string; name?: string }; detail?: string };
export type JournalEntry = {
  v: 1; seq: number; at: string; actor: JournalActor; action: string; text: string;
  target?: JournalTarget; business?: { id: string; name?: string }; changes?: JournalChange[]; detail?: string;
  /**
   * `address`: lines written before 8 Ekim carry the address in the chained entry itself. Since then the chain carries only
   * `addressMark` (SHA-256 of a random salt and the address); the address and salt are kept apart (table islem_adresleri),
   * outside the chain, and deleted after one year (ADDRESS_YEARS) without touching any hash.
   */
  source: JournalSource; result: JournalResult; address?: string; addressMark?: string;
  legacy?: { count: number; from?: string; to?: string; hash: string; entries: LegacyRow[] };
  /** An older line whose address was deleted after one year: its content before is `hash` (the chain), after is recorded by `journal.addresses_masked`. */
  masked?: { fields: ['address']; at: string };
  /** `journal.addresses_masked`: the older lines masked now, each with its chain hash and the hash of its masked content. */
  masks?: { seq: number; hash: string; masked: string }[];
  prev: string;
};
/** `address`: the kept address of a newer line (until a year has passed); `maskedHash`: an older line masked after a year. */
export type StoredEntry = { entry: JournalEntry; hash: string; unreadable?: boolean; address?: { address: string; salt: string }; maskedHash?: string };
type Row = { seq: number; hash: string; payload: Uint8Array; at: string; prev: string; adres: Uint8Array | null; masked: string | null };
export type Seal = { v: 1; seq: number; head: string; count: number; at: string; keyId: string; signature: string };
export type JournalInput = Partial<Pick<JournalEntry, 'actor' | 'target' | 'business' | 'changes' | 'detail' | 'source' | 'result' | 'address' | 'legacy' | 'at' | 'text' | 'masks'>> & { action: string };
export type VerifyReport = {
  ok: boolean; text: string; count: number; firstSeq: number | null; lastSeq: number | null; head: string | null; checkedAt: string;
  anchor: { seq: number; hash: string };
  lastSeal: { seq: number; at: string; fingerprint: string } | null; unsealed: number;
  problem?: { seq: number; kind: 'eksik' | 'zincir' | 'degistirilmis' | 'okunamiyor' | 'muhur'; text: string };
};
export const GENESIS = '0'.repeat(64);
export const SEAL_FORMAT = 'mola-islem-muhur-1';
export const JOURNAL_FORMAT = 'mola-islem-kayitlari-1';
export const DEFAULT_RETENTION_YEARS = 10, MIN_RETENTION_YEARS = 2, MAX_RETENTION_YEARS = 100;
/** IP addresses in the record are deleted after this many years (retention, 8 Ekim; the lawyer may change it). */
export const ADDRESS_YEARS = 1;
/** The chain's commitment to an address kept apart: SHA-256 over a random salt and the address (useless without the salt). */
export const addressMark = (salt: string, address: string) => createHash('sha256').update(`mola-islem-adres-1\n${salt}\n${address}`, 'utf8').digest('hex');
const YEAR = 365.25 * 86400000, HOUR = 3600000;
export const hashEntry = (e: JournalEntry) => createHash('sha256').update(canonicalJson(e), 'utf8').digest('hex');
export const legacyHash = (rows: LegacyRow[]) => createHash('sha256').update(canonicalJson(rows), 'utf8').digest('hex');
export const sealMessage = (s: Omit<Seal, 'signature'>) => `${SEAL_FORMAT}\n${canonicalJson({ v: s.v, seq: s.seq, head: s.head, count: s.count, at: s.at, keyId: s.keyId })}`;
/** "a48c-c7d1-64ec-ea94": the first 16 hex of SHA-256 over the seal's signature bytes (printed on every report). */
export const sealFingerprint = (s: Pick<Seal, 'signature'>) => showFingerprint(createHash('sha256').update(Buffer.from(s.signature, 'base64url')).digest('hex').slice(0, 16));
export function verifySeal(s: Seal, publicKey: KeyObject) {
  try { return verify(null, Buffer.from(sealMessage(s), 'utf8'), publicKey, Buffer.from(s.signature, 'base64url')); } catch { return false; }
}

// ---------- Who and from where (one context per HTTP request) ----------
export type JournalContext = { source: JournalSource; actor?: JournalActor; address?: string };
export const journalContext = new AsyncLocalStorage<JournalContext>();
const privateV4 = (ip: string) => /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
/** This computer (direct, no proxy), the local network, or anywhere else (also a VDS behind HTTPS). */
export function requestSource(req: Request): JournalSource {
  if (loopbackRequest(req)) return 'bu-bilgisayar';
  const ip = (req.ip ?? req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  if (privateV4(ip) || /^(fc|fd|fe8|fe9|fea|feb)/i.test(ip)) return 'yerel-ag';
  return 'uzak';
}
export function contextFor(req: Request): JournalContext {
  const source = requestSource(req), ip = (req.ip ?? req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  // The web site's form (/api/site/*) is a visitor's, not the vendor's or a café's: its address is never written (8 Ekim; KVKK text).
  const visitor = req.path.startsWith('/api/site/');
  return { source, ...(source !== 'bu-bilgisayar' && ip && !visitor ? { address: ip.slice(0, 60) } : {}) };
}
export const ADMIN_ACTOR: JournalActor = { kind: 'admin', id: 'admin', name: 'Yönetici' };
export const SYSTEM_ACTOR: JournalActor = { kind: 'system', name: 'Mola Merkez' };

/** The business (and ticket or release) an old-style audit line is about, with the names as they are now. */
function describe(target: string, action: string, detail: string | undefined, d: MerkezData, kept?: string): { target: JournalTarget; business?: { id: string; name?: string } } {
  if (target === 'admin' || target === 'platform-admin') {
    if (action.startsWith('release.')) { const version = detail?.split(' · ')[0] ?? ''; return { target: { kind: 'release', id: version || 'paket', name: detail?.split(' · ').slice(0, 2).join(' · ') } }; }
    if (action.startsWith('admin.') || action.startsWith('token.')) return { target: { kind: 'admin', id: 'admin', name: 'Yönetici hesabı' } };
    return { target: { kind: 'merkez', id: 'merkez', name: 'Mola Merkez' } };
  }
  if (target === 'merkez') return { target: { kind: 'merkez', id: 'merkez', name: 'Mola Merkez' } };
  const biz = d.businesses.find(b => b.tenantId === target);
  if (biz || !d.tickets.some(t => t.id === target)) { const name = biz?.name ?? kept; return { target: { kind: 'business', id: target, ...(name ? { name } : {}) }, business: { id: target, ...(name ? { name } : {}) } }; }
  const ticket = d.tickets.find(t => t.id === target)!, owner = d.businesses.find(b => b.tenantId === ticket.tenantId);
  return { target: { kind: 'ticket', id: ticket.id, name: ticket.subject }, business: { id: ticket.tenantId, ...(owner?.name ?? kept ? { name: owner?.name ?? kept } : {}) } };
}
const actorOf = (by: string | undefined, action: string, ctx: JournalContext | undefined, business?: { id: string; name?: string }): JournalActor => {
  const cafe = (): JournalActor => ctx?.actor?.kind === 'cafe' ? ctx.actor : { kind: 'cafe', ...(business ? { id: business.id } : {}), name: business?.name ? `${business.name} (işletmenin bilgisayarı)` : ACTOR_NAMES.cafe };
  if (by === 'system') return SYSTEM_ACTOR;
  if (by === 'cafe') return cafe();
  if (by === 'admin') return ctx?.actor && ctx.actor.kind !== 'cafe' ? ctx.actor : ADMIN_ACTOR;
  if (ctx?.actor) return ctx.actor;
  return CAFE_ACTIONS.has(action) ? cafe() : ctx ? ADMIN_ACTOR : SYSTEM_ACTOR;
};

export class Journal {
  /** Called after every new line (the Çalışma klasörü follows it). */
  onAppend?: () => void;
  private cache: StoredEntry[] = [];
  readonly keyId: string;
  private publicKeyObject: KeyObject;
  constructor(private db: DatabaseSync, private key: Buffer, private signingKey: KeyObject, readonly publicKey: string, private clock: () => Date) {
    this.keyId = keyFingerprint(publicKey); this.publicKeyObject = publicKeyFrom(publicKey);
    db.exec(`CREATE TABLE IF NOT EXISTS islem_kayitlari (seq INTEGER PRIMARY KEY, at TEXT NOT NULL, hash TEXT NOT NULL, prev TEXT NOT NULL, payload BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS islem_muhurleri (seq INTEGER PRIMARY KEY, at TEXT NOT NULL, head TEXT NOT NULL, count INTEGER NOT NULL, key_id TEXT NOT NULL, signature TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS islem_ayar (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS islem_adresleri (seq INTEGER PRIMARY KEY, at TEXT NOT NULL, payload BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS islem_maskeler (seq INTEGER PRIMARY KEY, at TEXT NOT NULL, original_hash TEXT NOT NULL, masked_hash TEXT NOT NULL);
      DROP TRIGGER IF EXISTS islem_degismez;
      CREATE TRIGGER islem_degismez BEFORE UPDATE ON islem_kayitlari WHEN NOT EXISTS (SELECT 1 FROM islem_ayar WHERE k='maskeleme' AND v='acik') BEGIN SELECT RAISE(ABORT, 'islem kayitlari degistirilemez'); END;
      CREATE TRIGGER IF NOT EXISTS islem_ozet_degismez BEFORE UPDATE ON islem_kayitlari WHEN NEW.seq <> OLD.seq OR NEW.hash <> OLD.hash OR NEW.prev <> OLD.prev OR NEW.at <> OLD.at BEGIN SELECT RAISE(ABORT, 'islem kayitlari degistirilemez'); END;
      CREATE TRIGGER IF NOT EXISTS maske_degismez BEFORE UPDATE ON islem_maskeler BEGIN SELECT RAISE(ABORT, 'maskeler degistirilemez'); END;
      CREATE TRIGGER IF NOT EXISTS islem_silinmez BEFORE DELETE ON islem_kayitlari WHEN NOT EXISTS (SELECT 1 FROM islem_ayar WHERE k='budama' AND v='acik') BEGIN SELECT RAISE(ABORT, 'islem kayitlari silinemez'); END;
      CREATE TRIGGER IF NOT EXISTS muhur_degismez BEFORE UPDATE ON islem_muhurleri BEGIN SELECT RAISE(ABORT, 'muhurler degistirilemez'); END;
      CREATE TRIGGER IF NOT EXISTS muhur_silinmez BEFORE DELETE ON islem_muhurleri WHEN NOT EXISTS (SELECT 1 FROM islem_ayar WHERE k='budama' AND v='acik') BEGIN SELECT RAISE(ABORT, 'muhurler silinemez'); END;`);
  }
  private now() { return this.clock(); }
  private rowKeyCache?: Buffer;
  private get rowKey() { return this.rowKeyCache ??= createHash('sha256').update(this.key).update('mola-islem-kayitlari:v1').digest(); }
  setting(k: string): string | undefined { return (this.db.prepare('SELECT v FROM islem_ayar WHERE k=?').get(k) as { v: string } | undefined)?.v; }
  private setSetting(k: string, v: string | null) { if (v === null) this.db.prepare('DELETE FROM islem_ayar WHERE k=?').run(k); else this.db.prepare('INSERT INTO islem_ayar (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v); }
  private tx<T>(fn: () => T): T {
    if ((this.db as unknown as { isTransaction: boolean }).isTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  /** Where the chain starts: 64 zeros, or the last line the retention clean-up removed. */
  anchor(): { seq: number; hash: string } { try { const a = JSON.parse(this.setting('baslangic') ?? ''); if (Number.isInteger(a.seq) && /^[a-f0-9]{64}$/.test(a.hash)) return a; } catch { /* none */ } return { seq: 0, hash: GENESIS }; }
  head(): { seq: number; hash: string } | null { return (this.db.prepare('SELECT seq, hash FROM islem_kayitlari ORDER BY seq DESC LIMIT 1').get() as { seq: number; hash: string } | undefined) ?? null; }
  count() { return (this.db.prepare('SELECT COUNT(*) AS n FROM islem_kayitlari').get() as { n: number }).n; }

  /** Adds one line at the end of the chain (inside the caller's transaction when there is one). */
  append(input: JournalInput): StoredEntry {
    const ctx = journalContext.getStore();
    const stored = this.tx(() => {
      const last = this.head() ?? this.anchor(), seq = last.seq + 1;
      const entry: JournalEntry = {
        v: 1, seq, at: input.at ?? this.now().toISOString(), actor: input.actor ?? ctx?.actor ?? SYSTEM_ACTOR, action: input.action, text: input.text ?? actionText(input.action),
        ...(input.target ? { target: input.target } : {}), ...(input.business ? { business: input.business } : {}), ...(input.changes?.length ? { changes: input.changes } : {}),
        ...(input.detail ? { detail: input.detail.slice(0, 2000) } : {}), source: input.source ?? ctx?.source ?? 'sistem', result: input.result ?? resultOf(input.action),
        ...(input.legacy ? { legacy: input.legacy } : {}), ...(input.masks?.length ? { masks: input.masks } : {}), prev: last.hash,
      };
      // The address stays out of the chain: only its salted SHA-256 is chained; the address itself goes after a year.
      const address = input.address ?? ctx?.address, kept = address ? { address: address.slice(0, 60), salt: randomBytes(16).toString('hex') } : undefined;
      if (kept) entry.addressMark = addressMark(kept.salt, kept.address);
      const hash = hashEntry(entry);
      this.db.prepare('INSERT INTO islem_kayitlari (seq, at, hash, prev, payload) VALUES (?,?,?,?,?)').run(seq, entry.at, hash, entry.prev, seal(entry, this.rowKey, `merkez-islem:${seq}`));
      if (kept) this.db.prepare('INSERT INTO islem_adresleri (seq, at, payload) VALUES (?,?,?)').run(seq, entry.at, seal(kept, this.rowKey, `merkez-islem-adres:${seq}`));
      return { entry, hash, ...(kept ? { address: kept } : {}) };
    });
    try { this.onAppend?.(); } catch { /* the folder catches up later */ }
    return stored;
  }
  /** An old-style audit line (MerkezStore.mutate calls this for every new `d.audit` line, in the same transaction). */
  fromAudit(e: AuditEntry, d: MerkezData) {
    const ctx = journalContext.getStore(), { target, business } = describe(e.target, e.action, e.detail, d, e.name);
    return this.append({ action: e.action, at: e.at, actor: actorOf(e.by, e.action, ctx, business), target, ...(business ? { business } : {}), ...(e.detail ? { detail: e.detail } : {}), ...(e.changes?.length ? { changes: e.changes } : {}) });
  }
  /**
   * Once, the first time this version opens the data: the old "İşlem geçmişi" list (up to 2000 lines in the sealed
   * registry) becomes ONE chain line, "Geçmiş kayıtlar aktarıldı", carrying all of them with their own SHA-256. The list
   * itself stays where it was (the screens still read it); nothing old is changed or removed.
   */
  migrate(d: MerkezData) {
    if (this.setting('aktarildi') || this.head()) { if (!this.setting('aktarildi')) this.setSetting('aktarildi', this.now().toISOString()); return; }
    this.tx(() => {
      const rows: LegacyRow[] = d.audit.map(a => { const { target, business } = describe(a.target, a.action, a.detail, d, a.name); return { at: a.at, action: a.action, text: actionText(a.action), ...(a.by ? { by: a.by } : {}), target: a.target, ...(target.name ? { name: target.name } : {}), ...(business ? { business } : {}), ...(a.detail ? { detail: a.detail } : {}) }; });
      if (rows.length) {
        const times = rows.map(r => r.at).sort(), hash = legacyHash(rows);
        this.append({ action: 'journal.legacy_imported', actor: SYSTEM_ACTOR, source: 'sistem', detail: `${rows.length} eski kayıt (${istanbulDay(times[0])} – ${istanbulDay(times.at(-1)!)}) tek blok olarak aktarıldı; bloğun SHA-256 özeti ${hash.slice(0, 16)}…`, legacy: { count: rows.length, from: times[0], to: times.at(-1), hash, entries: rows } });
      } else this.append({ action: 'journal.started', actor: SYSTEM_ACTOR, source: 'sistem' });
      this.setSetting('aktarildi', this.now().toISOString());
    });
    this.sealNow();
  }
  private static readonly ROWS = 'SELECT k.seq AS seq, k.at AS at, k.hash AS hash, k.prev AS prev, k.payload AS payload, a.payload AS adres, m.masked_hash AS masked FROM islem_kayitlari k LEFT JOIN islem_adresleri a ON a.seq = k.seq LEFT JOIN islem_maskeler m ON m.seq = k.seq';
  private decode(row: Row): StoredEntry {
    try {
      const entry = open<JournalEntry>(Buffer.from(row.payload), this.rowKey, `merkez-islem:${row.seq}`);
      let address: StoredEntry['address'];
      if (row.adres) try { address = open<{ address: string; salt: string }>(Buffer.from(row.adres), this.rowKey, `merkez-islem-adres:${row.seq}`); } catch { /* checked by verify */ }
      return { entry, hash: row.hash, ...(address ? { address } : {}), ...(row.masked ? { maskedHash: row.masked } : {}) };
    }
    catch { return { entry: { v: 1, seq: row.seq, at: row.at, actor: SYSTEM_ACTOR, action: 'journal.unreadable', text: 'Okunamayan kayıt (içerik değiştirilmiş ya da yer değiştirmiş)', source: 'sistem', result: 'basarisiz', prev: row.prev }, hash: row.hash, unreadable: true }; }
  }
  /** Every line, oldest first (cached; only new lines are read again). */
  entries(): StoredEntry[] {
    const first = (this.db.prepare('SELECT MIN(seq) AS s FROM islem_kayitlari').get() as { s: number | null }).s;
    const last = this.cache.at(-1);
    const still = last && first === this.cache[0].entry.seq && (this.db.prepare('SELECT hash FROM islem_kayitlari WHERE seq=?').get(last.entry.seq) as { hash: string } | undefined)?.hash === last.hash;
    if (!still) this.cache = [];
    const from = this.cache.at(-1)?.entry.seq ?? 0;
    for (const row of this.db.prepare(`${Journal.ROWS} WHERE k.seq > ? ORDER BY k.seq`).all(from) as Row[]) this.cache.push(this.decode(row));
    return this.cache;
  }
  seals(): Seal[] { return (this.db.prepare('SELECT seq, at, head, count, key_id, signature FROM islem_muhurleri ORDER BY seq').all() as { seq: number; at: string; head: string; count: number; key_id: string; signature: string }[]).map(r => ({ v: 1, seq: r.seq, head: r.head, count: r.count, at: r.at, keyId: r.key_id, signature: r.signature })); }
  lastSeal(): Seal | null { return this.seals().at(-1) ?? null; }
  /** Signs the head now (nothing new since the last seal: that one). */
  sealNow(): Seal | null {
    return this.tx(() => {
      const head = this.head(); if (!head) return null;
      const last = this.lastSeal(); if (last && last.seq >= head.seq) return last;
      const claims = { v: 1 as const, seq: head.seq, head: head.hash, count: head.seq - this.anchor().seq, at: this.now().toISOString(), keyId: this.keyId };
      const s: Seal = { ...claims, signature: sign(null, Buffer.from(sealMessage(claims), 'utf8'), this.signingKey).toString('base64url') };
      this.db.prepare('INSERT INTO islem_muhurleri (seq, at, head, count, key_id, signature) VALUES (?,?,?,?,?,?)').run(s.seq, s.at, s.head, s.count, s.keyId, s.signature);
      return s;
    });
  }
  /** Hourly by default: new lines and the last seal older than `maxAgeMs`. */
  sealIfDue(maxAgeMs = HOUR) {
    const head = this.head(), last = this.lastSeal();
    if (!head || (last && last.seq >= head.seq)) return null;
    if (last && this.now().getTime() - Date.parse(last.at) < maxAgeMs) return null;
    return this.sealNow();
  }
  /** The whole chain and every seal, line by line. */
  verify(): VerifyReport {
    const anchor = this.anchor(), checkedAt = this.now().toISOString();
    const rows = this.db.prepare(`${Journal.ROWS} ORDER BY k.seq`).all() as Row[];
    // Older lines masked after a year: each must be named, with both hashes, by a chained "journal.addresses_masked" line.
    const listed = new Map<number, { hash: string; masked: string }>();
    for (const row of rows) { const s = this.decode(row); for (const m of s.entry.masks ?? []) listed.set(m.seq, m); }
    const hashes = new Map<number, string>();
    let expectedSeq = anchor.seq + 1, prev = anchor.hash, problem: VerifyReport['problem'];
    for (const row of rows) {
      if (row.seq !== expectedSeq) { problem = { seq: expectedSeq, kind: 'eksik', text: `${expectedSeq}. kayıt eksik: silinmiş ya da yeri değiştirilmiş.` }; break; }
      const stored = this.decode(row);
      if (stored.unreadable) { problem = { seq: row.seq, kind: 'okunamiyor', text: `${row.seq}. kayıt okunamıyor: içeriği değiştirilmiş ya da başka bir satırdan taşınmış.` }; break; }
      const e = stored.entry;
      if (e.seq !== row.seq || e.prev !== prev || row.prev !== prev) { problem = { seq: row.seq, kind: 'zincir', text: `${row.seq}. kayıt bir önceki kayda bağlanmıyor: araya kayıt eklenmiş, silinmiş ya da sıra değiştirilmiş.` }; break; }
      const h = hashEntry(e), mask = e.masked ? listed.get(row.seq) : undefined;
      // A masked line: its content now is what the masking record says (`masked`), its place in the chain the old hash.
      const content = e.masked ? !!mask && mask.hash === row.hash && mask.masked === h && stored.maskedHash === h && !e.address : h === row.hash;
      if (!content || (e.legacy && legacyHash(e.legacy.entries) !== e.legacy.hash)) { problem = { seq: row.seq, kind: 'degistirilmis', text: `${row.seq}. kaydın içeriği sonradan değiştirilmiş.` }; break; }
      // The address kept apart must still be the one the chain committed to (until it is deleted after a year).
      if (row.adres && (!stored.address || !e.addressMark || addressMark(stored.address.salt, stored.address.address) !== e.addressMark)) { problem = { seq: row.seq, kind: 'degistirilmis', text: `${row.seq}. kaydın adres bilgisi sonradan değiştirilmiş.` }; break; }
      hashes.set(row.seq, row.hash); prev = row.hash; expectedSeq++;
    }
    const seals = this.seals().filter(s => s.seq > anchor.seq), lastSeq = rows.length ? rows.at(-1)!.seq : null;
    if (!problem) for (const s of seals) {
      if (!verifySeal(s, this.publicKeyObject)) { problem = { seq: s.seq, kind: 'muhur', text: `${s.seq}. kayıttaki mühürün imzası geçersiz.` }; break; }
      const h = hashes.get(s.seq);
      if (h === undefined) { problem = { seq: s.seq, kind: 'muhur', text: `${s.seq}. kayda kadar mühürlenmiş kayıtlar eksik: son kayıtlar silinmiş.` }; break; }
      if (h !== s.head) { problem = { seq: s.seq, kind: 'muhur', text: `${s.seq}. kayıt mühürlendikten sonra değiştirilmiş (zincir yeniden yazılmış).` }; break; }
    }
    const last = seals.at(-1);
    return { ok: !problem, text: problem ? `Zincir ${problem.seq}. kayıtta bozuk. ${problem.text}` : 'Kayıtlar bütün', count: rows.length, firstSeq: rows[0]?.seq ?? null, lastSeq, head: rows.length ? rows.at(-1)!.hash : null, checkedAt, anchor,
      lastSeal: last ? { seq: last.seq, at: last.at, fingerprint: sealFingerprint(last) } : null, unsealed: lastSeq !== null ? lastSeq - (last?.seq ?? anchor.seq) : 0, ...(problem ? { problem } : {}) };
  }
  // ---------- Saklama süresi ----------
  retentionYears() { const n = Number(this.setting('saklama-yil')); return Number.isInteger(n) && n >= MIN_RETENTION_YEARS && n <= MAX_RETENTION_YEARS ? n : DEFAULT_RETENTION_YEARS; }
  setRetention(years: number) { if (!Number.isInteger(years) || years < MIN_RETENTION_YEARS || years > MAX_RETENTION_YEARS) throw new RangeError('retention'); this.setSetting('saklama-yil', String(years)); }
  /**
   * Lines older than the retention (never younger than 2 years, never the newest line) go, oldest first; the last one removed
   * becomes the anchor the chain starts from, and a line says so. Seals covering only removed lines go with them.
   */
  prune(now = this.now()) {
    const cut = now.getTime() - Math.max(this.retentionYears(), MIN_RETENTION_YEARS) * YEAR, head = this.head();
    if (!head) return 0;
    const old = this.db.prepare('SELECT seq, hash, at FROM islem_kayitlari WHERE seq < ? ORDER BY seq').all(head.seq) as { seq: number; hash: string; at: string }[];
    let last: { seq: number; hash: string } | undefined, n = 0;
    for (const r of old) { if (Date.parse(r.at) >= cut) break; last = r; n++; }
    if (!last) return 0;
    const upTo = last;
    this.tx(() => {
      this.setSetting('budama', 'acik');
      try {
        this.db.prepare('DELETE FROM islem_kayitlari WHERE seq <= ?').run(upTo.seq);
        this.db.prepare('DELETE FROM islem_muhurleri WHERE seq <= ?').run(upTo.seq);
        this.db.prepare('DELETE FROM islem_adresleri WHERE seq <= ?').run(upTo.seq);
        this.db.prepare('DELETE FROM islem_maskeler WHERE seq <= ?').run(upTo.seq);
      } finally { this.setSetting('budama', null); }
      this.setSetting('baslangic', JSON.stringify({ seq: upTo.seq, hash: upTo.hash }));
      this.append({ action: 'journal.pruned', actor: SYSTEM_ACTOR, source: 'sistem', detail: `${n} kayıt silindi (saklama süresi ${this.retentionYears()} yıl); zincir artık ${upTo.seq + 1}. kayıttan başlıyor, başlangıç özeti ${upTo.hash.slice(0, 16)}…` });
    });
    this.cache = [];
    return n;
  }
  /**
   * IP addresses are deleted one year after their line (retention, 8 Ekim), the chain stays verifiable:
   *   - a newer line kept its address apart (islem_adresleri, outside the chain; the chain has only the salted SHA-256):
   *     the row goes, nothing in the chain changes;
   *   - an older line (before 8 Ekim) has the address in its chained content: that content is rewritten without it (the
   *     only change the table allows, under the "maskeleme" switch; seq, time, hash and prev never change), the old and
   *     the new content hash go to islem_maskeler, and one chained line "journal.addresses_masked" lists every such line
   *     with both hashes. verify() and scripts/islem-dogrula.mjs accept a masked line only as listed there.
   * Returns how many lines lost their address.
   */
  maskAddresses(now = this.now()): number {
    const cut = new Date(now.getTime() - ADDRESS_YEARS * YEAR).toISOString();
    const kept = (this.db.prepare('SELECT COUNT(*) AS n FROM islem_adresleri WHERE at < ?').get(cut) as { n: number }).n;
    const old = (this.db.prepare(`${Journal.ROWS} WHERE k.at < ? AND m.seq IS NULL ORDER BY k.seq`).all(cut) as Row[]).map(r => ({ row: r, stored: this.decode(r) })).filter(x => !x.stored.unreadable && x.stored.entry.address && !x.stored.entry.masked);
    if (!kept && !old.length) return 0;
    const at = now.toISOString(), masks: { seq: number; hash: string; masked: string }[] = [];
    this.tx(() => {
      this.db.prepare('DELETE FROM islem_adresleri WHERE at < ?').run(cut);
      if (old.length) {
        this.setSetting('maskeleme', 'acik');
        try {
          for (const { row, stored } of old) {
            const { address: _address, ...rest } = stored.entry, masked: JournalEntry = { ...rest, masked: { fields: ['address'], at } }, mh = hashEntry(masked);
            this.db.prepare('UPDATE islem_kayitlari SET payload=? WHERE seq=?').run(seal(masked, this.rowKey, `merkez-islem:${row.seq}`), row.seq);
            this.db.prepare('INSERT INTO islem_maskeler (seq, at, original_hash, masked_hash) VALUES (?,?,?,?)').run(row.seq, at, row.hash, mh);
            masks.push({ seq: row.seq, hash: row.hash, masked: mh });
          }
        } finally { this.setSetting('maskeleme', null); }
      }
      this.append({ action: 'journal.addresses_masked', actor: SYSTEM_ACTOR, source: 'sistem', at, detail: `${kept + masks.length} kaydın IP adresi silindi (${ADDRESS_YEARS} yılı geçti); zincir değişmedi${masks.length ? `, ${masks.length} eski kaydın içeriği adres olmadan yeniden mühürlendi (eski ve yeni özetleri bu kayıtta)` : ''}.`, ...(masks.length ? { masks } : {}) });
    });
    this.cache = [];
    return kept + masks.length;
  }
  /** Lines (oldest first) whose Türkiye day is within [from, to] (YYYY-MM-DD, either may be empty), as one unbroken run. */
  range(from?: string, to?: string): StoredEntry[] {
    const all = this.entries();
    const first = all.findIndex(s => !from || istanbulDay(s.entry.at) >= from);
    if (first < 0) return [];
    let last = -1; for (let i = all.length - 1; i >= first; i--) if (!to || istanbulDay(all[i].entry.at) <= to) { last = i; break; }
    return last < first ? [] : all.slice(first, last + 1);
  }
  /**
   * Machine-readable copy for an independent check (JSONL, one JSON per line): a header, every line of the period with its
   * hash (unbroken: no other filter), the seals within it and a closing line. scripts/islem-dogrula.mjs checks such a file.
   */
  jsonl(from?: string, to?: string): { text: string; count: number } {
    const head = this.head(), wanted = this.range(from, to);
    if (head && wanted.at(-1)?.entry.seq === head.seq) this.sealNow();
    const lines = this.range(from, to), firstSeq = lines[0]?.entry.seq ?? null, lastSeq = lines.at(-1)?.entry.seq ?? null;
    const seals = firstSeq === null ? [] : this.seals().filter(s => s.seq >= firstSeq && s.seq <= lastSeq!);
    const out = [canonicalJson({ type: 'baslik', format: JOURNAL_FORMAT, exportedAt: this.now().toISOString(), from: from ?? null, to: to ?? null, firstSeq, lastSeq, count: lines.length, startPrev: lines[0]?.entry.prev ?? null, keyId: this.keyId, publicKey: this.publicKey, sealFormat: SEAL_FORMAT,
      note: 'Her satır: hash = SHA-256(canonical JSON(entry)); entry.prev bir önceki satırın hash değeri. Mühür: Ed25519, ileti "mola-islem-muhur-1\\n" + canonical JSON({at,count,head,keyId,seq,v}). Ayrıntı: docs/ISLEM_KAYITLARI.md, denetim: node scripts/islem-dogrula.mjs <dosya>.' })];
    // A kept address (newer lines, under a year) with its salt, so a checker can match it to the chain's addressMark; a masked older line with its content hash.
    for (const s of lines) out.push(canonicalJson({ type: 'kayit', hash: s.hash, entry: s.entry, ...(s.address ? { adres: s.address } : {}), ...(s.maskedHash ? { maskedHash: s.maskedHash } : {}) }));
    for (const s of seals) out.push(canonicalJson({ type: 'muhur', ...s, fingerprint: sealFingerprint(s) }));
    out.push(canonicalJson({ type: 'son', count: lines.length, lastHash: lines.at(-1)?.hash ?? null }));
    return { text: out.join('\n') + '\n', count: lines.length };
  }
}

// ---------- Rows for the screen and the reports ----------
export type JournalRow = {
  seq: number; sub?: number; at: string; day: string; actor: JournalActor; action: string; text: string; group: JournalGroup;
  target?: JournalTarget; business?: { id: string; name?: string }; detail?: string; changes?: JournalChange[];
  source: JournalSource; result: JournalResult; hash?: string; legacy?: boolean; address?: string;
};
export type JournalFilter = { from?: string; to?: string; business?: string; actor?: string; group?: string; action?: string; result?: string; q?: string };
const lower = (s: string) => s.toLocaleLowerCase('tr-TR');
/** Every line as screen rows, newest first; the migrated block opens into its old lines (marked `legacy`). */
export function journalRows(entries: StoredEntry[]): JournalRow[] {
  const rows: JournalRow[] = [];
  for (const { entry: e, hash, address: kept } of entries) {
    rows.push({ seq: e.seq, at: e.at, day: istanbulDay(e.at), actor: e.actor, action: e.action, text: e.text, group: actionGroup(e.action), ...(e.target ? { target: e.target } : {}), ...(e.business ? { business: e.business } : {}), ...(e.detail ? { detail: e.detail } : {}), ...(e.changes ? { changes: e.changes } : {}), source: e.source, result: e.result, hash, ...(kept?.address ?? e.address ? { address: kept?.address ?? e.address } : {}) });
    e.legacy?.entries.forEach((l, i) => rows.push({ seq: e.seq, sub: i + 1, at: l.at, day: istanbulDay(l.at), actor: l.by === 'cafe' ? { kind: 'cafe', name: ACTOR_NAMES.cafe } : l.by === 'system' ? SYSTEM_ACTOR : ADMIN_ACTOR, action: l.action, text: l.text, group: actionGroup(l.action),
      target: { kind: l.business ? 'business' : 'merkez', id: l.target, ...(l.name ? { name: l.name } : {}) }, ...(l.business ? { business: l.business } : {}), ...(l.detail ? { detail: l.detail } : {}), source: 'sistem', result: resultOf(l.action), legacy: true }));
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq || (b.sub ?? 0) - (a.sub ?? 0));
}
export const changeText = (c: JournalChange) => `${c.field}: ${c.from ?? '—'} → ${c.to ?? '—'}`;
export function filterRows(rows: JournalRow[], f: JournalFilter) {
  const q = lower(f.q?.trim() ?? '');
  return rows.filter(r => (!f.from || r.day >= f.from) && (!f.to || r.day <= f.to) && (!f.business || r.business?.id === f.business)
    && (!f.actor || (f.actor.startsWith('token:') ? r.actor.kind === 'token' && r.actor.id === f.actor.slice(6) : r.actor.kind === f.actor))
    && (!f.group || r.group === f.group) && (!f.action || r.action === f.action) && (!f.result || r.result === f.result)
    && (!q || lower([r.text, r.action, r.actor.name, r.business?.name, r.target?.name, r.detail, ...(r.changes ?? []).map(changeText), String(r.seq)].filter(Boolean).join(' ')).includes(q)));
}
