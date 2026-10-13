import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, statfsSync, writeFileSync, writeSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import express, { type Express, type Request, type Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { clientKey } from '../http-security.js';
import { MERKEZ_API } from '../sync-protocol.js';
import { addAlert } from './alerts.js';
import { businessDay } from '../../packages/domain/business-day.js';
import { isoWeek } from '../backup-retention.js';
import { licenseFeatures, type Install, type MerkezData, type MerkezStore } from './store.js';
import { servicesView } from './catalog.js';
import { sellableFeatures } from '../../packages/domain/service-pricing.js';

/*
 * Sunucu yedeği ("B planı"): an encrypted off-site copy of each café's verified backup, kept on Mola Merkez.
 *   - The café PC stays the primary system. After each verified backup it uploads the same encrypted files its second place
 *     gets (blobs, sealed manifest, anahtar-kurtarma.json, complete.json): encrypted with the café's data key, which never
 *     leaves the café. Merkez cannot open them; only the owner's 24-character recovery code does, on the café's computer.
 *   - Merkez keeps ciphertext and metadata only (time, size, SHA-256, app/data version), in its own folder beside the data
 *     folder (<data>-sunucu-yedekleri/). NOT in Merkez's own backup: these are backups already (no doubling); a restored
 *     Merkez simply gets fresh copies with the next uploads.
 *   - Layout per install: parcalar/<sha256> (content-addressed: a blob Merkez already has is never sent again, so a later
 *     incremental backup format needs no protocol change), kopyalar/<copy>.json (which blobs make one copy), yukleme/ (an
 *     upload in progress: resumable chunk by chunk, offsets answered by Merkez, every file checked by its SHA-256).
 *   - Per business: the newest copy of each of the last 3 business days (05:00 to 05:00) and of each of the last 2 weeks
 *     (configurable in Mola Yönetim), and every year package of the café ("yil-2025-<sha>.bin", server/year-packages.ts: the
 *     same bytes in every copy, so received once; listed in yillar.json and kept for good while the business exists). The room a
 *     café may use grows with the café: (kept copies + 1 incoming) × its largest copy (year packages left out) + each year
 *     package once, so a growing café is never refused; only one copy above the per-copy cap
 *     (MERKEZ_YEDEK_KOPYA_UST_MB, default 4096 MB, per business in Mola Yönetim) is refused, with an alert. A copy near the
 *     cap or a large total is a warning in Mola Yönetim (Özet, Bugün). A disk guard (MERKEZ_YEDEK_BOS_MB, default 2048 MB
 *     free), a "disk below 15 % free" warning, "no upload for 2 days" alerts. A deleted business: its copies go.
 *   - Only that business's install uploads, lists and downloads its own copies (HMAC like the heartbeat). A new computer has
 *     no install secret: it uses a one-time "taşıma kodu" the vendor issues (Mola Yönetim → işletme → Lisans), bound to the
 *     first computer that uses it; the copy still needs the recovery code to open.
 */
const MB = 1024 * 1024, GB = 1024 * MB, DAY = 86_400_000, HOUR = 3_600_000;
export const CHUNK_BYTES = 2 * MB, MAX_CHUNK = 8 * MB, MAX_READ = 4 * MB;
const envMb = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; };
/** capMb: one copy larger than this is refused (MERKEZ_YEDEK_KOPYA_UST_MB, default 4 GB); the total follows the café's size. */
export const DEFAULT_SETTINGS = { daily: 3, weekly: 2, capMb: envMb('MERKEZ_YEDEK_KOPYA_UST_MB', 4096) };
/** Mola Yönetim warns: a copy at 80 % of its cap, a business using more than MERKEZ_YEDEK_BUYUK_MB (default 10 GB), a disk below 15 % free. */
export const NEAR_CAP = 0.8, LARGE_BYTES = envMb('MERKEZ_YEDEK_BUYUK_MB', 10_240) * MB, DISK_LOW_RATIO = 0.15;
/** "1,8 GB", "640 MB". */
export const sizeText = (n: number) => n >= GB ? `${(n / GB).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} GB` : `${Math.max(n ? 1 : 0, Math.round(n / MB)).toLocaleString('tr-TR')} MB`;
/** "Sunucu yedeği alınmadı" after this many days without an upload. */
export const STALE_DAYS = 2;
const UPLOAD_DAYS = 3, CODE_HOURS = 24, TICKET_HOURS = 12;
/** durum.json `lastError` of a copy refused for being above the per-copy cap (Mola Yönetim shows it as a warning). */
const CAP_ERROR = 'Kopya üst sınırı aşıldı';
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const sha = z.string().regex(/^[a-f0-9]{64}$/), copyId = z.string().regex(/^backup-[A-Za-z0-9_-]{8,120}$/), fileName = z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}$/);
const fileSchema = z.object({ name: fileName, size: z.number().int().min(0).max(64 * 1024 * MB), sha256: sha }).strict();
export type VaultFile = z.infer<typeof fileSchema>;
/** Saved per business. An older Merkez saved `quotaMb` (a fixed total); it is ignored now. */
export type Settings = { daily: number; weekly: number; capMb: number };
export type Copy = { id: string; installId: string; createdAt: string; uploadedAt: string; appVersion: string; dataVersion?: number; files: VaultFile[]; bytes: number; verified: true };
type Upload = { id: string; copyId: string; createdAt: string; appVersion: string; dataVersion?: number; files: VaultFile[]; startedAt: string; updatedAt: string };
type InstallState = { firstAttemptAt?: string; lastAttemptAt?: string; lastUploadAt?: string; lastCopyId?: string; lastError?: string; quotaRemoved?: number };
type TransferCode = { hash: string; tenantId: string; createdAt: string; expiresAt: string; boundTo?: string; usedAt?: string };
type Ticket = { hash: string; tenantId: string; installId: string; requester: string; expiresAt: string };
type TransferBook = { codes: TransferCode[]; tickets: Ticket[] };
export const transferHash = (code: string) => createHash('sha256').update(`mola-tasima:v1:${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}`).digest('hex');
const ticketHash = (ticket: string) => createHash('sha256').update(`mola-tasima-bileti:v1:${ticket}`).digest('hex');
const README = `MOLA MERKEZ: SUNUCU YEDEKLERİ

Bu klasörde kafelerin şifreli yedek kopyaları durur. Mola Merkez bunları açamaz: anahtar yalnız kafenin bilgisayarında,
açmak için işletme sahibinin kurtarma kodu gerekir. Dosyaları elle değiştirmeyin ya da silmeyin.
Bu klasör Mola Merkez yedeğine girmez (zaten yedektir).
`;
/**
 * The business day (05:00 to 05:00 Türkiye, like the café's own backups: a gün sonu at 00:30 and the 03:30 copy are one day)
 * and its ISO week, for "3 günlük + 2 haftalık".
 */
const dayOf = (iso: string) => businessDay(iso);
const weekOf = (iso: string) => isoWeek(businessDay(iso));
/** Which copies stay: the newest overall, the newest of each of the last `daily` days and of each of the last `weekly` weeks. */
export function retained(copies: { id: string; createdAt: string }[], settings: Pick<Settings, 'daily' | 'weekly'>, protect?: string) {
  const sorted = [...copies].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), keep = new Set<string>(sorted[0] ? [sorted[0].id] : []);
  // The copy just committed always stays (a café whose clock went back sends a "older" newest copy).
  if (protect && copies.some(c => c.id === protect)) keep.add(protect);
  for (const [count, key] of [[settings.daily, dayOf], [settings.weekly, weekOf]] as const) {
    const seen = new Set<string>();
    for (const c of sorted) { const k = key(c.createdAt); if (seen.has(k)) continue; if (seen.size >= count) break; seen.add(k); keep.add(c.id); }
  }
  return keep;
}
function readJson<T>(path: string, fallback: T): T { try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return fallback; } }
function writeJson(path: string, value: unknown) { const part = `${path}.${randomBytes(4).toString('hex')}.yaz`; writeFileSync(part, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); renameSync(part, path); }
async function fileHash(path: string) { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); }
const size = (path: string) => { try { return statSync(path).size; } catch { return -1; } };
/** What one copy takes on disk (a file listed twice is stored once). */
const copyBytes = (c: { files: VaultFile[] }) => [...new Map(c.files.map(f => [f.sha256, f.size])).values()].reduce((n, x) => n + x, 0);
/**
 * A sealed year package of the café (server/year-packages.ts, "yil-2025-<sha>.bin"): the same bytes in every copy after it, so it
 * is received once, and kept for good (yillar.json), whatever copies come and go.
 */
export const PACKAGE_BLOB = /^yil-\d{4}-[a-f0-9]{16}\.bin$/;
const isPackage = (f: { name: string }) => PACKAGE_BLOB.test(f.name);
/** A copy's own bytes, its year packages left out (they are kept once, apart). */
const liveBytes = (c: { files: VaultFile[] }) => copyBytes({ files: c.files.filter(f => !isPackage(f)) });
type YearBook = Record<string, { name: string; size: number; at: string }>;

export class BackupVault {
  minFree: number;
  /** tests: a smaller disk. */
  freeSpace?: () => number;
  constructor(readonly directory: string, options: { minFreeBytes?: number } = {}) {
    this.minFree = options.minFreeBytes ?? Number(process.env.MERKEZ_YEDEK_BOS_MB ?? 2048) * MB;
  }
  private ensure() { if (!existsSync(this.directory)) { mkdirSync(this.directory, { recursive: true }); writeFileSync(join(this.directory, 'BENIOKU.txt'), '﻿' + README.replace(/\n/g, '\r\n')); } }
  private dir(install: string, ...rest: string[]) { if (!/^[a-f0-9-]{36}$/.test(install)) throw new DomainError('NOT_FOUND', 'Kurulum bulunamadı.', 404); return join(this.directory, install, ...rest); }
  private blob(install: string, hash: string) { return this.dir(install, 'parcalar', hash); }
  // ---------- settings (per business; an install uses its first business's) ----------
  private get settingsPath() { return join(this.directory, 'ayarlar.json'); }
  allSettings(): Record<string, Partial<Settings>> { return readJson<{ businesses?: Record<string, Partial<Settings>> }>(this.settingsPath, {}).businesses ?? {}; }
  settings(tenantId?: string): Settings {
    const saved = tenantId ? this.allSettings()[tenantId] : undefined, int = (v: unknown, min: number) => Number.isSafeInteger(v) && (v as number) >= min ? v as number : undefined;
    return { daily: int(saved?.daily, 1) ?? DEFAULT_SETTINGS.daily, weekly: int(saved?.weekly, 0) ?? DEFAULT_SETTINGS.weekly, capMb: int(saved?.capMb, 1) ?? DEFAULT_SETTINGS.capMb };
  }
  setSettings(tenantId: string, s: Settings) { this.ensure(); const all = this.allSettings(); all[tenantId] = { daily: s.daily, weekly: s.weekly, capMb: s.capMb }; writeJson(this.settingsPath, { businesses: all }); }
  // ---------- install state, copies, usage ----------
  state(install: string): InstallState { return readJson<InstallState>(this.dir(install, 'durum.json'), {}); }
  private saveState(install: string, change: Partial<InstallState>) {
    mkdirSync(this.dir(install), { recursive: true });
    const next = { ...this.state(install), ...change }; for (const k of Object.keys(next) as (keyof InstallState)[]) if (next[k] === undefined) delete next[k];
    writeJson(this.dir(install, 'durum.json'), next);
  }
  /** Newest first. */
  copies(install: string): Copy[] {
    const dir = this.dir(install, 'kopyalar');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(n => n.endsWith('.json')).map(n => readJson<Copy | null>(join(dir, n), null)).filter((c): c is Copy => !!c && c.installId === install).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** Bytes on disk for this install: blobs (each once) and parts of uploads in progress. */
  used(install: string) {
    let bytes = 0;
    for (const sub of ['parcalar', 'yukleme']) {
      const dir = this.dir(install, sub);
      const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(join(d, e.name)); else bytes += size(join(d, e.name)); } };
      if (existsSync(dir)) walk(dir);
    }
    return bytes;
  }
  /** The year packages this install sent (sha → name, size): never removed while the business exists. */
  years(install: string): YearBook { return readJson<YearBook>(this.dir(install, 'yillar.json'), {}); }
  /**
   * The room one business may use: the copies it keeps plus one coming in, each as large as its largest copy (its year packages
   * left out; never more than the per-copy cap), and every year package once. It grows with the café, so a café that grows is
   * never refused for its size.
   */
  limit(install: string, settings: Settings, incoming = 0, incomingYears: VaultFile[] = []) {
    const largest = Math.max(incoming, ...this.copies(install).map(liveBytes));
    const years = new Map(Object.entries(this.years(install)).map(([sha, y]) => [sha, y.size])); for (const f of incomingYears) years.set(f.sha256, f.size);
    return (settings.daily + settings.weekly + 1) * Math.min(settings.capMb * MB, largest) + [...years.values()].reduce((n, x) => n + x, 0);
  }
  totalUsed() { if (!existsSync(this.directory)) return 0; return readdirSync(this.directory, { withFileTypes: true }).filter(e => e.isDirectory() && /^[a-f0-9-]{36}$/.test(e.name)).reduce((n, e) => n + this.used(e.name), 0); }
  private space() {
    this.ensure();
    let free: number | null = null, total: number | null = null;
    try { const s = statfsSync(this.directory); free = Number(s.bavail) * Number(s.bsize); total = Number(s.blocks) * Number(s.bsize); } catch { /* unknown */ }
    if (this.freeSpace) free = this.freeSpace();
    return { free, total };
  }
  /** Mola Yönetim's card: what the copies use and what the disk has left; `low`: under 15 % free (or near the guard). */
  disk() {
    const space = this.space();
    const low = space.free !== null && (space.free < this.minFree * 1.5 || (!!space.total && space.free / space.total < DISK_LOW_RATIO));
    return { used: this.totalUsed(), ...space, minFree: this.minFree, low };
  }
  private assertDisk(bytes: number, onFull: () => void) {
    const { free } = this.space();
    if (free !== null && free - bytes < this.minFree) { onFull(); throw new DomainError('CLOUD_DISK', 'Mola Merkez’de yedekler için yer kalmadı. Yedek bu bilgisayarda alındı; Mola ekibi bilgilendirildi.', 507); }
  }
  // ---------- upload ----------
  private uploadPath(install: string, id: string) { if (!/^[a-f0-9]{32}$/.test(id)) throw new DomainError('NOT_FOUND', 'Yükleme bulunamadı.', 404); return this.dir(install, 'yukleme', `${id}.json`); }
  private partPath(install: string, id: string, hash: string) { return this.dir(install, 'yukleme', id, `${hash}.part`); }
  private upload(install: string, id: string) { const u = readJson<Upload | null>(this.uploadPath(install, id), null); if (!u) throw new DomainError('UPLOAD_GONE', 'Yükleme bulunamadı; yeniden başlayın.', 404); return u; }
  /**
   * Starts (or resumes) one copy. Answers which files Merkez still needs and from which byte. The same copy with the same
   * files again: done. The same copy with changed files (a new recovery code re-sealed anahtar-kurtarma.json): replaced, and
   * only the changed files travel.
   */
  begin(install: string, tenantId: string | undefined, input: { copyId: string; createdAt: string; appVersion: string; dataVersion?: number; files: VaultFile[] }, now: Date, alert: (kind: 'quota' | 'disk' | 'evicted' | 'cap', text: string) => void) {
    this.ensure();
    const time = now.toISOString(), files = input.files;
    const names = new Set(files.map(f => f.name.toLowerCase()));
    if (names.size !== files.length) throw new DomainError('INVALID_FILES', 'Yedek dosya listesi geçersiz.', 400);
    if (!names.has('complete.json') || !names.has('anahtar-kurtarma.json') || !names.has('manifest.bin')) throw new DomainError('INVALID_FILES', 'Yedek eksik: yalnız tamamlanmış ve kurtarma koduyla açılan yedek yüklenir.', 400);
    this.saveState(install, { lastAttemptAt: time, ...(this.state(install).firstAttemptAt ? {} : { firstAttemptAt: time }) });
    const listHash = createHash('sha256').update(JSON.stringify(files.map(f => [f.name, f.size, f.sha256]))).digest('hex');
    const existing = this.copies(install).find(c => c.id === input.copyId);
    if (existing && createHash('sha256').update(JSON.stringify(existing.files.map(f => [f.name, f.size, f.sha256]))).digest('hex') === listHash) {
      this.saveState(install, { lastUploadAt: time, lastCopyId: existing.id, lastError: undefined });
      return { done: true as const, copy: summary(existing) };
    }
    const id = createHash('sha256').update(`${install}:${input.copyId}:${listHash}`).digest('hex').slice(0, 32);
    const need: { sha256: string; offset: number; size: number }[] = [], seen = new Set<string>();
    for (const f of files) {
      if (seen.has(f.sha256)) continue; seen.add(f.sha256);
      if (size(this.blob(install, f.sha256)) === f.size) continue;
      need.push({ sha256: f.sha256, offset: Math.max(0, Math.min(size(this.partPath(install, id, f.sha256)), f.size)), size: f.size });
    }
    // The per-copy cap and the room count the copy's own bytes; its year packages are kept once, apart (limit).
    const incoming = need.reduce((n, x) => n + x.size - x.offset, 0), settings = this.settings(tenantId), cap = settings.capMb * MB, bytes = liveBytes(input);
    // Only one copy larger than the per-copy cap is refused (with an alert); everything else fits the room that grows with the café.
    if (bytes > cap) {
      alert('cap', `yedek kopyası (${sizeText(bytes)}) kopya üst sınırını (${sizeText(cap)}) aşıyor; yüklenemedi. Sınırı İşletme → Özet → Sunucu yedeği’nden artırın.`);
      this.saveState(install, { lastError: CAP_ERROR });
      throw new DomainError('CLOUD_QUOTA', `Yedek, Mola Merkez’deki kopya üst sınırından (${sizeText(cap)}) büyük. Yedek bu bilgisayarda alındı; Mola ekibi bilgilendirildi.`, 507);
    }
    this.assertDisk(incoming, () => alert('disk', `Mola Merkez diskinde sunucu yedekleri için yer kalmadı (en az ${Math.round(this.minFree / MB)} MB boş kalmalı). Kafelerin yedekleri yüklenemiyor.`));
    // One upload at a time per install (the café sends its newest backup and nothing else meanwhile): an older unfinished
    // upload was given up and only holds disk.
    // Blobs this copy shares (a re-sealed key sends the same copy again) stay while older copies and uploads make room.
    const mine = new Set(files.map(f => f.sha256));
    this.dropUploads(install, id, mine);
    // Over the room (copies left over from a longer keep rule): the oldest copies make room, never the newest.
    const limit = this.limit(install, settings, bytes, files.filter(isPackage));
    let removed = 0;
    while (this.used(install) + incoming > limit) {
      const old = this.copies(install).slice(1);
      if (!old.length) break;
      this.dropCopy(install, old.at(-1)!.id); removed++; this.collect(install, mine);
    }
    if (removed) alert('evicted', `sunucu yedeği yerine sığmak için en eski ${removed} kopya silindi.`);
    if (this.used(install) + incoming > limit) {
      alert('quota', `yedek sunucudaki yerine (${sizeText(limit)}) sığmıyor; yüklenemedi.`);
      this.saveState(install, { lastError: 'Yer yetmedi' });
      throw new DomainError('CLOUD_QUOTA', `Yedek, Mola Merkez’deki yere (${sizeText(limit)}) sığmıyor. Yedek bu bilgisayarda alındı; Mola ekibi bilgilendirildi.`, 507);
    }
    mkdirSync(this.dir(install, 'yukleme', id), { recursive: true }); mkdirSync(this.dir(install, 'parcalar'), { recursive: true });
    const old = readJson<Upload | null>(this.uploadPath(install, id), null);
    writeJson(this.uploadPath(install, id), { id, copyId: input.copyId, createdAt: input.createdAt, appVersion: input.appVersion, ...(input.dataVersion !== undefined ? { dataVersion: input.dataVersion } : {}), files, startedAt: old?.startedAt ?? time, updatedAt: time } satisfies Upload);
    return { done: false as const, uploadId: id, chunkBytes: CHUNK_BYTES, need };
  }
  /** One piece of one file, at the offset Merkez said; anything else is answered with the offset it has. */
  async chunk(install: string, input: { uploadId: string; sha256: string; offset: number; data: Buffer }, now: Date, alert: (kind: 'disk', text: string) => void) {
    const u = this.upload(install, input.uploadId), file = u.files.find(f => f.sha256 === input.sha256);
    if (!file) throw new DomainError('INVALID_FILES', 'Bu dosya yüklemede yok.', 400);
    if (size(this.blob(install, file.sha256)) === file.size) return { received: file.size, complete: true };
    const part = this.partPath(install, u.id, file.sha256), have = Math.max(0, size(part));
    if (input.offset !== have) return { received: have, complete: false };
    if (input.data.length > MAX_CHUNK || have + input.data.length > file.size) throw new DomainError('INVALID_CHUNK', 'Parça dosyanın boyutunu aşıyor.', 400);
    this.assertDisk(input.data.length, () => alert('disk', `Mola Merkez diskinde sunucu yedekleri için yer kalmadı (en az ${Math.round(this.minFree / MB)} MB boş kalmalı). Kafelerin yedekleri yüklenemiyor.`));
    mkdirSync(this.dir(install, 'yukleme', u.id), { recursive: true });
    const fd = openSync(part, 'a', 0o600); try { writeSync(fd, input.data); } finally { closeSync(fd); }
    const received = have + input.data.length;
    if (received === file.size) {
      if (await fileHash(part) !== file.sha256) { rmSync(part, { force: true }); throw new DomainError('CLOUD_INTEGRITY', 'Yüklenen dosya bozuk geldi (SHA-256 tutmadı); baştan gönderilecek.', 422); }
      renameSync(part, this.blob(install, file.sha256));
    }
    writeJson(this.uploadPath(install, u.id), { ...u, updatedAt: now.toISOString() });
    return { received, complete: received === file.size };
  }
  /** Every file present and whole: the copy is kept, old ones pruned (3 daily + 2 weekly), unreferenced blobs removed. */
  commit(install: string, tenantId: string | undefined, uploadId: string, now: Date) {
    const u = this.upload(install, uploadId);
    for (const f of u.files) if (size(this.blob(install, f.sha256)) !== f.size) throw new DomainError('UPLOAD_INCOMPLETE', 'Yükleme tamamlanmadı; eksik dosyalar yeniden gönderilecek.', 409);
    const copy: Copy = { id: u.copyId, installId: install, createdAt: u.createdAt, uploadedAt: now.toISOString(), appVersion: u.appVersion, ...(u.dataVersion !== undefined ? { dataVersion: u.dataVersion } : {}), files: u.files, bytes: u.files.reduce((n, f) => n + f.size, 0), verified: true };
    mkdirSync(this.dir(install, 'kopyalar'), { recursive: true });
    // Its year packages join the ones kept for good before anything is pruned.
    const years = this.years(install); let added = false;
    for (const f of u.files) if (isPackage(f) && !years[f.sha256]) { years[f.sha256] = { name: f.name, size: f.size, at: now.toISOString() }; added = true; }
    if (added) writeJson(this.dir(install, 'yillar.json'), years);
    writeJson(this.dir(install, 'kopyalar', `${u.copyId}.json`), copy);
    rmSync(this.uploadPath(install, uploadId), { force: true }); rmSync(this.dir(install, 'yukleme', uploadId), { recursive: true, force: true });
    const keep = retained(this.copies(install), this.settings(tenantId), copy.id);
    for (const c of this.copies(install)) if (!keep.has(c.id)) this.dropCopy(install, c.id);
    this.collect(install);
    this.saveState(install, { lastUploadAt: now.toISOString(), lastCopyId: copy.id, lastError: undefined });
    const all = this.copies(install);
    return { copy: summary(copy), copies: all.length, bytes: this.used(install) };
  }
  private dropCopy(install: string, id: string) { rmSync(this.dir(install, 'kopyalar', `${id}.json`), { force: true }); }
  /** Unfinished uploads of this install other than `keep` (their parts; blobs only they used go with the next collect). */
  private dropUploads(install: string, keep: string, blobs: Set<string>) {
    const uploads = this.dir(install, 'yukleme');
    if (!existsSync(uploads)) return;
    let dropped = false;
    for (const n of readdirSync(uploads).filter(n => n.endsWith('.json') && n !== `${keep}.json`)) { rmSync(join(uploads, n), { force: true }); rmSync(join(uploads, n.replace(/\.json$/, '')), { recursive: true, force: true }); dropped = true; }
    if (dropped) this.collect(install, blobs);
  }
  /** Blobs no copy and no upload in progress refers to (`keep`: an upload being started, not written down yet). */
  private collect(install: string, keep?: Set<string>) {
    const dir = this.dir(install, 'parcalar'); if (!existsSync(dir)) return;
    const used = new Set([...this.copies(install).flatMap(c => c.files.map(f => f.sha256)), ...(keep ?? []), ...Object.keys(this.years(install))]);
    const uploads = this.dir(install, 'yukleme');
    if (existsSync(uploads)) for (const n of readdirSync(uploads).filter(n => n.endsWith('.json'))) for (const f of readJson<Upload | null>(join(uploads, n), null)?.files ?? []) used.add(f.sha256);
    for (const n of readdirSync(dir)) if (!used.has(n)) rmSync(join(dir, n), { force: true });
  }
  /** Part of one file of one copy (this install's own, or a taşıma ticket's). */
  read(install: string, id: string, hash: string, offset: number, length: number): Buffer {
    const copy = this.copies(install).find(c => c.id === id);
    const file = copy?.files.find(f => f.sha256 === hash);
    // Another install's copy is simply not there (its own code, so a café never mistakes it for an unknown Merkez call).
    if (!copy || !file) throw new DomainError('COPY_NOT_FOUND', 'Yedek bulunamadı.', 404);
    const path = this.blob(install, hash), n = Math.max(0, Math.min(length, MAX_READ, file.size - offset));
    if (offset < 0 || offset > file.size) throw new DomainError('INVALID_CHUNK', 'Geçersiz parça.', 400);
    const out = Buffer.alloc(n), fd = openSync(path, 'r');
    try { let got = 0; while (got < n) { const r = readSync(fd, out, got, n - got, offset + got); if (!r) break; got += r; } if (got !== n) throw new DomainError('CLOUD_INTEGRITY', 'Yedek dosyası eksik.', 500); } finally { closeSync(fd); }
    return out;
  }
  /** A deleted business's install: every copy, blob and upload goes; its taşıma codes too. */
  forget(install: string | undefined, tenantId: string) {
    if (install && /^[a-f0-9-]{36}$/.test(install)) rmSync(this.dir(install), { recursive: true, force: true });
    const book = this.transfers(); book.codes = book.codes.filter(c => c.tenantId !== tenantId); book.tickets = book.tickets.filter(t => t.tenantId !== tenantId); this.saveTransfers(book);
    const all = this.allSettings(); if (all[tenantId]) { delete all[tenantId]; writeJson(this.settingsPath, { businesses: all }); }
  }
  // ---------- taşıma kodu (new computer) ----------
  private get transferPath() { return join(this.directory, 'tasima.json'); }
  private transfers(): TransferBook { return readJson<TransferBook>(this.transferPath, { codes: [], tickets: [] }); }
  private saveTransfers(book: TransferBook) { if (!existsSync(this.directory) && !book.codes.length && !book.tickets.length) return; this.ensure(); writeJson(this.transferPath, book); }
  /** One per business (a new one replaces the old), 24 hours, shown once; Merkez keeps only its hash. */
  issueCode(tenantId: string, now: Date) {
    const code = [...randomBytes(16)].map(n => CODE_ALPHABET[n & 31]).join('').replace(/(.{4})(?!$)/g, '$1-');
    const book = this.transfers(), expiresAt = new Date(now.getTime() + CODE_HOURS * HOUR).toISOString();
    book.codes = [...book.codes.filter(c => c.tenantId !== tenantId && Date.parse(c.expiresAt) > now.getTime()), { hash: transferHash(code), tenantId, createdAt: now.toISOString(), expiresAt }];
    this.saveTransfers(book);
    return { code, expiresAt };
  }
  /**
   * The new computer's first step: a valid, unused code (bound to the first computer that uses it) gives a ticket for
   * listing and downloading that business's copies. undefined: wrong, expired, used or bound to another computer.
   */
  openCode(code: string, requester: string, resolve: (tenantId: string) => string | undefined, now: Date) {
    const book = this.transfers(), hash = transferHash(code), t = now.getTime();
    const c = book.codes.find(x => x.hash === hash);
    if (!c || c.usedAt || Date.parse(c.expiresAt) <= t || (c.boundTo && c.boundTo !== requester)) return undefined;
    const install = resolve(c.tenantId); if (!install) return undefined;
    c.boundTo = requester;
    const ticket = randomBytes(32).toString('base64url'), expiresAt = new Date(Math.min(t + TICKET_HOURS * HOUR, Date.parse(c.expiresAt) + TICKET_HOURS * HOUR)).toISOString();
    book.tickets = [...book.tickets.filter(x => Date.parse(x.expiresAt) > t), { hash: ticketHash(ticket), tenantId: c.tenantId, installId: install, requester, expiresAt }];
    this.saveTransfers(book);
    return { ticket, expiresAt, tenantId: c.tenantId, installId: install };
  }
  ticket(ticket: string, now: Date) {
    const found = this.transfers().tickets.find(x => x.hash === ticketHash(ticket));
    if (!found || Date.parse(found.expiresAt) <= now.getTime()) throw new DomainError('TICKET_EXPIRED', 'Taşıma oturumunun süresi doldu. Taşıma kodunu yeniden girin.', 403);
    return found;
  }
  /** The restore went through: the code is spent (the ticket lives on until it expires, so a failed swap can be tried again). */
  finish(ticket: string, now: Date) {
    const book = this.transfers(), t = book.tickets.find(x => x.hash === ticketHash(ticket));
    if (!t) throw new DomainError('TICKET_EXPIRED', 'Taşıma oturumunun süresi doldu.', 403);
    const first = book.codes.some(c => c.tenantId === t.tenantId && c.boundTo === t.requester && !c.usedAt);
    for (const c of book.codes) if (c.tenantId === t.tenantId && c.boundTo === t.requester) c.usedAt ??= now.toISOString();
    this.saveTransfers(book);
    return { tenantId: t.tenantId, first };
  }
  codeState(tenantId: string, now: Date) {
    const c = this.transfers().codes.filter(x => x.tenantId === tenantId).at(-1);
    return c ? { createdAt: c.createdAt, expiresAt: c.expiresAt, usedAt: c.usedAt ?? null, bound: !!c.boundTo, active: !c.usedAt && Date.parse(c.expiresAt) > now.getTime() } : null;
  }
  /** Every 10 minutes: uploads left for days, expired codes and tickets. */
  sweep(now: Date) {
    if (!existsSync(this.directory)) return;
    const t = now.getTime();
    for (const e of readdirSync(this.directory, { withFileTypes: true })) {
      if (!e.isDirectory() || !/^[a-f0-9-]{36}$/.test(e.name)) continue;
      const uploads = this.dir(e.name, 'yukleme');
      if (!existsSync(uploads)) continue;
      for (const n of readdirSync(uploads).filter(n => n.endsWith('.json'))) {
        const u = readJson<Upload | null>(join(uploads, n), null);
        if (!u || Date.parse(u.updatedAt) < t - UPLOAD_DAYS * DAY) { rmSync(join(uploads, n), { force: true }); rmSync(join(uploads, n.replace(/\.json$/, '')), { recursive: true, force: true }); }
      }
      this.collect(e.name);
    }
    const book = this.transfers();
    const codes = book.codes.filter(c => Date.parse(c.expiresAt) > t - 7 * DAY), tickets = book.tickets.filter(x => Date.parse(x.expiresAt) > t);
    if (codes.length !== book.codes.length || tickets.length !== book.tickets.length) this.saveTransfers({ codes, tickets });
  }
}
const summary = (c: Copy) => ({ id: c.id, createdAt: c.createdAt, uploadedAt: c.uploadedAt, bytes: c.bytes, files: c.files.length, appVersion: c.appVersion, ...(c.dataVersion !== undefined ? { dataVersion: c.dataVersion } : {}), verified: c.verified });

/** One business's view in Mola Yönetim (Özet, Bugün). */
export function businessView(vault: BackupVault, d: MerkezData, tenantId: string, now: Date) {
  const b = d.businesses.find(x => x.tenantId === tenantId);
  const install = b?.installId, state = install ? vault.state(install) : {}, copies = install ? vault.copies(install) : [];
  const last = state.lastUploadAt ?? state.firstAttemptAt, since = last ? now.getTime() - Date.parse(last) : 0;
  const settings = vault.settings(tenantId), cap = settings.capMb * MB, bytes = install ? vault.used(install) : 0, newest = copies[0] ? liveBytes(copies[0]) : 0;
  const years = install ? Object.values(vault.years(install)) : [];
  return {
    tenantId, settings, lastUploadAt: state.lastUploadAt ?? null, lastAttemptAt: state.lastAttemptAt ?? null, lastError: state.lastError ?? null,
    copies: copies.map(summary), count: copies.length, bytes,
    // Year packages (kept for good, each once): "Yıl paketleri: 2 · 1,2 GB".
    years: { count: years.length, bytes: years.reduce((n, y) => n + y.size, 0), names: years.map(y => y.name.slice(4, 8)).sort() },
    // The room this business may use now (grows with its copies) and the per-copy cap.
    limit: install ? vault.limit(install, settings) : 0, cap,
    stale: !!b && !!install && !b.suspended && !!last && since > STALE_DAYS * DAY, transfer: vault.codeState(tenantId, now),
    warning: cloudWarning(state.lastError, newest, bytes, cap),
  };
}
/** Mola Yönetim (Özet, Bugün): refused for its size, near the per-copy cap, or a large total. null: nothing to say. */
export function cloudWarning(lastError: string | undefined, newest: number, bytes: number, cap: number): { tone: 'bad' | 'warn'; text: string } | null {
  if (lastError === CAP_ERROR) return { tone: 'bad', text: `son yedeği kopya üst sınırını (${sizeText(cap)}) aştığı için sunucuya alınamadı. Sınırı artırın.` };
  if (newest >= cap * NEAR_CAP) return { tone: 'warn', text: `yedek kopyası ${sizeText(newest)}: kopya üst sınırına (${sizeText(cap)}) yaklaşıyor.` };
  if (bytes >= LARGE_BYTES) return { tone: 'warn', text: `sunucu yedekleri ${sizeText(bytes)} yer tutuyor.` };
  return null;
}
/**
 * Ayarlar → Yedek → "Kafelerin bulut yedekleri" (13 Ekim): one short line per business that has copies here or the
 * "Bulutta şifreli yedek" service. Read only: the name, the package (`scope`: every service, as in a trial or a full plan;
 * the cloud backup among some services; or not in the licence any more), the last upload, how many copies and how large,
 * and a state ("Sağlıklı", "3 gündür yedek gelmedi"). No copy ids and nothing to download: Mola Merkez cannot open a café's
 * backup and the vendor never gets one (KVKK).
 */
export type CloudOverviewRow = {
  tenantId: string; name: string; packageName: string; scope: 'full' | 'cloud' | 'none'; suspended: boolean;
  lastUploadAt: string | null; count: number; bytes: number; days: number | null;
  status: 'ok' | 'stale' | 'none' | 'error' | 'suspended'; statusText: string;
};
export function cloudOverview(vault: BackupVault, d: MerkezData, now: Date) {
  const sellable = sellableFeatures(), rows: CloudOverviewRow[] = [];
  for (const b of d.businesses) {
    if (!b.installId) continue;
    const v = businessView(vault, d, b.tenantId, now), open = licenseFeatures(b);
    const inLicense = open.includes('cloud-backup');
    if (!inLicense && !v.count && !v.lastUploadAt) continue;
    const scope: CloudOverviewRow['scope'] = !inLicense ? 'none' : sellable.every(f => open.includes(f)) ? 'full' : 'cloud';
    const since = v.lastUploadAt ?? v.lastAttemptAt, days = since ? Math.floor((now.getTime() - Date.parse(since)) / DAY) : null;
    const status: CloudOverviewRow['status'] = b.suspended ? 'suspended' : v.lastError === CAP_ERROR ? 'error' : !v.lastUploadAt ? (v.stale ? 'stale' : 'none') : v.stale ? 'stale' : 'ok';
    const statusText = status === 'suspended' ? 'Hizmet askıda' : status === 'error' ? 'Son yedek sınırı aştı, alınamadı'
      : status === 'stale' ? `${Math.max(STALE_DAYS, days ?? STALE_DAYS)} gündür yedek gelmedi` : status === 'none' ? 'Henüz yedek gelmedi' : 'Sağlıklı';
    rows.push({ tenantId: b.tenantId, name: b.name, packageName: b.kind === 'trial' ? 'Deneme' : servicesView(d, b).packageName, scope, suspended: !!b.suspended,
      lastUploadAt: v.lastUploadAt, count: v.count, bytes: v.bytes, days: v.lastUploadAt ? Math.floor((now.getTime() - Date.parse(v.lastUploadAt)) / DAY) : null, status, statusText });
  }
  // What needs a look first, then the newest upload.
  const rank = { error: 0, stale: 1, none: 2, ok: 3, suspended: 4 } as const;
  rows.sort((a, b) => rank[a.status] - rank[b.status] || (b.lastUploadAt ?? '').localeCompare(a.lastUploadAt ?? '') || a.name.localeCompare(b.name, 'tr'));
  const last = rows.map(r => r.lastUploadAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  return { staleDays: STALE_DAYS, total: { businesses: rows.filter(r => r.count > 0).length, copies: rows.reduce((n, r) => n + r.count, 0), bytes: rows.reduce((n, r) => n + r.bytes, 0), lastUploadAt: last, attention: rows.filter(r => r.status === 'stale' || r.status === 'error').length }, businesses: rows };
}
/** "Sunucu yedeği alınmadı" (each once per last upload) and a full disk (once a day): Bildirim merkezi. */
export function sweepVault(vault: BackupVault, store: MerkezStore, now: Date) {
  vault.sweep(now);
  const d = store.read(), due: [string, string, string][] = [];
  for (const b of d.businesses) {
    if (!b.installId) continue;
    const v = businessView(vault, d, b.tenantId, now);
    if (v.stale) due.push([`cloud-stale:${b.tenantId}:${v.lastUploadAt ?? v.lastAttemptAt}`, b.tenantId, `${b.name}: ${STALE_DAYS} günden uzun süredir sunucu yedeği gelmedi${v.lastUploadAt ? ` (son: ${new Date(v.lastUploadAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })})` : ''}. İşletmenin bilgisayarı kapalı ya da internete bağlı olmayabilir.`]);
  }
  const fresh = due.filter(([key]) => !(d.alerts ?? []).some(a => a.key === key));
  // Merkez's own disk below 15 % free (or near the guard): once a day, before copies start being refused.
  const disk = vault.disk(), day = now.toISOString().slice(0, 10);
  const diskKey = `cloud-disk-low::${day}`, diskDue = disk.low && existsSync(vault.directory) && !(d.alerts ?? []).some(a => a.key === diskKey);
  if (fresh.length || diskDue) store.mutate(x => {
    for (const [key, tenantId, text] of fresh) addAlert(x, now.toISOString(), 'cafe.cloud_backup', text, { tenantId, key });
    if (diskDue) addAlert(x, now.toISOString(), 'cafe.cloud_backup', `Mola Merkez diskinde boş yer azaldı (${disk.free === null ? '?' : sizeText(disk.free)}${disk.total ? `, %${Math.round(disk.free! / disk.total * 100)}` : ''}). Kafelerin sunucu yedekleri için diski büyütün ya da saklanan kopya sayısını azaltın.`, { key: diskKey });
  });
  return fresh.length;
}

type Deps = {
  store: MerkezStore; vault: BackupVault; now: () => Date; admin: (req: Request) => unknown;
  authenticate: (req: Request) => { install: Install; nonce: string; closed: boolean };
  sendSigned: (res: Response, secret: string, nonce: string, body: unknown) => void;
  limitAddress: (req: Request, purpose: string, max: number, ms: number) => void; limitInstall: (install: string, purpose: string, max: number, ms: number) => void;
};
const tenantsOf = (d: MerkezData, install: string) => d.businesses.filter(b => b.installId === install);
/**
 * Registered before the JSON-only rule and the 64 kB parser: chunks come as signed JSON (base64, up to 8 MB a piece).
 *   café (signed):    POST /api/merkez/v1/cloud-backup/begin, chunk (or chunk-bin/<upload>/<sha256>/<offset>, raw), commit, list, read
 *   new computer:     POST /api/merkez/v1/cloud-backup/transfer/open, transfer/read (raw bytes), transfer/finish (taşıma kodu)
 *   Mola Yönetim:     GET /api/merkez/admin/cloud-backups, POST cloud-backups/settings, cloud-backups/transfer-code
 */
export function backupVaultRoutes(app: Express, deps: () => Deps) {
  const raw = express.json({ limit: '12mb', verify: (req, _res, buf) => { (req as Request & { rawBody?: Buffer }).rawBody = buf; } });
  // These come before Merkez's general JSON-only rule, so they keep it themselves (no form posts from other sites).
  // The binary chunk (below) is the one exception: raw bytes, signed like every café call.
  app.use([`${MERKEZ_API}/cloud-backup`, '/api/merkez/admin/cloud-backups'], (req, _res, next) => { if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json') && !(req.path.startsWith('/chunk-bin/') && req.is('application/octet-stream'))) return next(new DomainError('JSON_REQUIRED', 'JSON içerik gerekli.', 415)); next(); });
  app.use(`${MERKEZ_API}/cloud-backup`, raw);
  app.use('/api/merkez/admin/cloud-backups', express.json({ limit: '8kb' }));
  const at = (now: Date) => now.toISOString();
  /** The café's signed call: its own install, not closed; the business it reports for (first of the install). */
  function cafe(req: Request, purpose: string, max: number) {
    const { authenticate, limitAddress, limitInstall, store } = deps();
    limitAddress(req, `cloud-${purpose}`, max * 2, 60_000);
    const { install, nonce, closed } = authenticate(req);
    limitInstall(install.id, `cloud-${purpose}`, max, 60_000);
    if (closed) throw new DomainError('RECORD_CLOSED', 'Bu işletmenin Mola kaydı kapatıldı.', 409);
    const mine = tenantsOf(store.read(), install.id);
    if (!mine.length) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
    return { install, nonce, mine };
  }
  function alerter(mine: { tenantId: string; name: string }[]) {
    const { store, now } = deps();
    return (kind: string, text: string) => {
      const t = now(), day = at(t).slice(0, 10), first = mine[0];
      try { store.mutate(d => { addAlert(d, at(t), 'cafe.cloud_backup', kind === 'disk' ? text : `${mine.map(m => m.name).join(', ')}: ${text}`, { ...(kind === 'disk' ? {} : { tenantId: first.tenantId }), key: `cloud-${kind}:${kind === 'disk' ? '' : first.tenantId}:${day}`, ...(kind === 'evicted' ? { priority: 'low' as const } : {}) }); }); } catch { /* the answer matters more */ }
    };
  }
  app.post(`${MERKEZ_API}/cloud-backup/begin`, (req, res) => {
    const { install, nonce, mine } = cafe(req, 'begin', 30), { vault, now, sendSigned } = deps();
    const b = z.object({ copyId, createdAt: z.string().datetime(), appVersion: z.string().max(40), dataVersion: z.number().int().min(0).max(1000).optional(), files: z.array(fileSchema).min(3).max(50_000) }).strict().parse(req.body);
    sendSigned(res, install.secret, nonce, vault.begin(install.id, mine[0].tenantId, b, now(), alerter(mine)));
  });
  app.post(`${MERKEZ_API}/cloud-backup/chunk`, async (req, res) => {
    const { install, nonce, mine } = cafe(req, 'chunk', 600), { vault, now, sendSigned } = deps();
    const b = z.object({ uploadId: z.string().regex(/^[a-f0-9]{32}$/), sha256: sha, offset: z.number().int().min(0), data: z.string().max(Math.ceil(MAX_CHUNK / 3) * 4 + 8) }).strict().parse(req.body);
    sendSigned(res, install.secret, nonce, await vault.chunk(install.id, { ...b, data: Buffer.from(b.data, 'base64') }, now(), alerter(mine)));
  });
  // The same piece as raw bytes (a quarter less traffic than base64): what to write is in the signed path, the body is the
  // piece. A café uses it only when this Merkez lists 'cloud.backup.binary' in `accepts`; older cafés keep the JSON call.
  const bytes = express.raw({ type: 'application/octet-stream', limit: MAX_CHUNK + 1024, verify: (req, _res, buf) => { (req as Request & { rawBody?: Buffer }).rawBody = buf; } });
  app.post(`${MERKEZ_API}/cloud-backup/chunk-bin/:uploadId/:sha256/:offset`, bytes, async (req, res) => {
    const { install, nonce, mine } = cafe(req, 'chunk', 600), { vault, now, sendSigned } = deps();
    const p = z.object({ uploadId: z.string().regex(/^[a-f0-9]{32}$/), sha256: sha, offset: z.string().regex(/^\d{1,15}$/).transform(Number) }).strict().parse(req.params);
    sendSigned(res, install.secret, nonce, await vault.chunk(install.id, { ...p, data: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0) }, now(), alerter(mine)));
  });
  app.post(`${MERKEZ_API}/cloud-backup/commit`, (req, res) => {
    const { install, nonce, mine } = cafe(req, 'commit', 30), { vault, now, sendSigned } = deps();
    const b = z.object({ uploadId: z.string().regex(/^[a-f0-9]{32}$/) }).strict().parse(req.body);
    sendSigned(res, install.secret, nonce, vault.commit(install.id, mine[0].tenantId, b.uploadId, now()));
  });
  // The install's own copies only: another install's copy is simply not found.
  app.post(`${MERKEZ_API}/cloud-backup/list`, (req, res) => {
    const { install, nonce } = cafe(req, 'list', 60), { vault, sendSigned } = deps();
    z.object({}).strict().parse(req.body ?? {});
    sendSigned(res, install.secret, nonce, { copies: vault.copies(install.id).map(summary), bytes: vault.used(install.id), state: vault.state(install.id) });
  });
  app.post(`${MERKEZ_API}/cloud-backup/read`, (req, res) => {
    const { install, nonce } = cafe(req, 'read', 600), { vault, sendSigned } = deps();
    const b = z.object({ copy: copyId, sha256: sha, offset: z.number().int().min(0), length: z.number().int().min(1).max(MAX_READ) }).strict().parse(req.body);
    sendSigned(res, install.secret, nonce, { data: vault.read(install.id, b.copy, b.sha256, b.offset, b.length).toString('base64') });
  });
  // ---------- taşıma (a clean install on a new computer: no install secret yet) ----------
  const failures = new Map<string, { count: number; until: number }>(); let failuresAll = { count: 0, until: 0 };
  app.post(`${MERKEZ_API}/cloud-backup/transfer/open`, (req, res) => {
    const { vault, store, now, limitAddress } = deps(), t = now().getTime(), ip = clientKey(req);
    limitAddress(req, 'cloud-transfer', 30, 600_000);
    const mine = failures.get(ip);
    if ((mine && mine.until > t && mine.count >= 5) || (failuresAll.until > t && failuresAll.count >= 100)) throw new DomainError('RATE_LIMIT', 'Çok fazla yanlış taşıma kodu. 15 dakika sonra yeniden deneyin.', 429);
    const b = z.object({ code: z.string().trim().min(8).max(40), requester: z.string().regex(/^[a-f0-9-]{36}$/) }).strict().parse(req.body);
    const opened = vault.openCode(b.code, b.requester, tenantId => { const biz = store.read().businesses.find(x => x.tenantId === tenantId); return biz?.installId; }, now());
    if (!opened) {
      if (mine && mine.until > t) mine.count++; else failures.set(ip, { count: 1, until: t + 15 * 60_000 });
      if (failuresAll.until > t) failuresAll.count++; else failuresAll = { count: 1, until: t + HOUR };
      if (failures.size > 5000) failures.clear();
      throw new DomainError('WRONG_TRANSFER_CODE', 'Taşıma kodu yanlış, kullanılmış ya da süresi dolmuş. Mola ekibinden yeni kod isteyin.', 403);
    }
    const biz = store.read().businesses.find(x => x.tenantId === opened.tenantId)!;
    store.mutate(d => { d.audit.push({ action: 'cloud.transfer_opened', target: opened.tenantId, at: at(now()), by: 'cafe', detail: 'Taşıma kodu yeni bir bilgisayarda girildi' }); });
    // `list`: each copy's files (name, size, SHA-256), so the new computer downloads and checks exactly these.
    res.json({ ticket: opened.ticket, expiresAt: opened.expiresAt, name: biz.name, copies: vault.copies(opened.installId).map(c => ({ ...summary(c), list: c.files })) });
  });
  app.post(`${MERKEZ_API}/cloud-backup/transfer/read`, (req, res) => {
    const { vault, now, limitAddress } = deps();
    limitAddress(req, 'cloud-transfer-read', 1200, 60_000);
    const b = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/), copy: copyId, sha256: sha, offset: z.number().int().min(0), length: z.number().int().min(1).max(MAX_READ) }).strict().parse(req.body);
    const t = vault.ticket(b.ticket, now());
    const data = vault.read(t.installId, b.copy, b.sha256, b.offset, b.length);
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length) }); res.end(data);
  });
  app.post(`${MERKEZ_API}/cloud-backup/transfer/finish`, (req, res) => {
    const { vault, store, now, limitAddress } = deps();
    limitAddress(req, 'cloud-transfer', 30, 600_000);
    const b = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/), copy: copyId }).strict().parse(req.body);
    const time = at(now()), done = vault.finish(b.ticket, now());
    if (done.first) store.mutate(d => {
      const biz = d.businesses.find(x => x.tenantId === done.tenantId);
      d.audit.push({ action: 'cloud.transfer_used', target: done.tenantId, at: time, by: 'cafe', detail: `Sunucu yedeği yeni bilgisayara geri yüklendi (${b.copy.slice(7, 23)})` });
      addAlert(d, time, 'cafe.cloud_backup', `${biz?.name ?? 'Bir işletme'}: sunucu yedeği taşıma koduyla yeni bir bilgisayara geri yüklendi. Yeni bilgisayar bağlanınca eski bilgisayarda sipariş kapanır.`, { tenantId: done.tenantId, title: 'Yeni bilgisayara taşındı' });
    });
    res.json({ ok: true });
  });
  // ---------- Mola Yönetim ----------
  app.get('/api/merkez/admin/cloud-backups', (req, res) => {
    const { admin, vault, store, now } = deps();
    admin(req);
    try { sweepVault(vault, store, now()); } catch { /* the view still answers */ }
    const d = store.read();
    res.json({ disk: vault.disk(), defaults: DEFAULT_SETTINGS, staleDays: STALE_DAYS, businesses: d.businesses.filter(b => b.installId).map(b => businessView(vault, d, b.tenantId, now())) });
  });
  // Ayarlar → Yedek → "Kafelerin bulut yedekleri": the short list (read only; no copy ids, nothing to download).
  app.get('/api/merkez/admin/cloud-backups/overview', (req, res) => {
    const { admin, vault, store, now } = deps();
    admin(req);
    res.json(cloudOverview(vault, store.read(), now()));
  });
  app.post('/api/merkez/admin/cloud-backups/settings', (req, res) => {
    const { admin, vault, store, now } = deps();
    admin(req);
    // capMb: the per-copy cap (the total follows the café's size). `quotaMb` from a page loaded before this version is ignored.
    const b = z.object({ tenantId: z.string().min(1).max(100), daily: z.number().int().min(1).max(31), weekly: z.number().int().min(0).max(26), capMb: z.number().int().min(100).max(512_000).optional(), quotaMb: z.number().int().min(0).max(512_000).optional() }).strict().parse(req.body);
    if (!store.read().businesses.some(x => x.tenantId === b.tenantId)) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
    const capMb = b.capMb ?? vault.settings(b.tenantId).capMb;
    vault.setSettings(b.tenantId, { daily: b.daily, weekly: b.weekly, capMb });
    store.mutate(d => { d.audit.push({ action: 'cloud.settings_changed', target: b.tenantId, at: at(now()), by: 'admin', detail: `Sunucu yedeği: ${b.daily} günlük + ${b.weekly} haftalık, kopya başına en çok ${capMb} MB` }); });
    res.json(businessView(vault, store.read(), b.tenantId, now()));
  });
  app.post('/api/merkez/admin/cloud-backups/transfer-code', (req, res) => {
    const { admin, vault, store, now } = deps();
    admin(req);
    const b = z.object({ tenantId: z.string().min(1).max(100) }).strict().parse(req.body);
    const biz = store.read().businesses.find(x => x.tenantId === b.tenantId);
    if (!biz) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
    if (!biz.installId) throw new DomainError('NOT_ACTIVATED', 'İşletme Mola’yı henüz etkinleştirmedi; taşınacak yedeği yok.', 409);
    const issued = vault.issueCode(b.tenantId, now());
    store.mutate(d => { d.audit.push({ action: 'cloud.transfer_code_issued', target: b.tenantId, at: at(now()), by: 'admin' }); });
    res.json(issued);
  });
}
