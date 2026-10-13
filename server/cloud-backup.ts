import fs from 'node:fs/promises';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { Express, Request } from 'express';
import { z } from 'zod';
import { DomainError } from '../packages/domain/engine.js';
import { writeAtomic } from './key-vault.js';
import { APP_VERSION } from './license.js';
import { DATA_VERSION } from './data-version.js';
import { BACKUP_KEY_FILE, masterFromCode, masterFromPassword, readBackupKeyFile } from './backup-key.js';
import { packageFolders, type Completion } from './backup.js';
import type { Security } from './security-routes.js';

/*
 * Sunucu yedeği ("B planı", café side). The café PC stays the primary system; after each verified backup (nightly 03:30 or the
 * catch-up, after Gün sonu, "Şimdi yedekle") the encrypted backup folder (the same files the second place gets: blobs, sealed
 * manifest, anahtar-kurtarma.json, complete.json; never a raw key, never the recovery code) is uploaded to Mola Merkez over
 * the signed install link (server/merkez/backup-vault.ts).
 *   - Chunked (2 MB, Merkez says) and resumable: Merkez answers which files it still needs and from which byte; a cut line
 *     goes on from there. Every file is checked by its SHA-256 on Merkez; a broken one is sent again once. Pieces go as raw
 *     bytes to a Merkez that lists 'cloud.backup.binary' (chunk-bin), as base64 JSON to an older one.
 *   - Only after a backup that was really taken: a night with nothing new (server/backup-scheduler.ts) uploads nothing.
 *   - Retries: each chunk up to 3 times (1, 4, 15 s); a failed upload again after 5 min, 30 min and 2 hours (and with the
 *     next backup). Never fails the backup itself: the result is "Sunucu yedeği: … · başarılı / alınamadı".
 *   - Bandwidth: a file Merkez already has is never sent; the nightly run skips the upload when a copy went up in the last
 *     6 hours (Gün sonu at 23:40 covers 03:30); "Şimdi yedekle" and Gün sonu always upload.
 *   - Only when this install is activated, its record is open and its Merkez lists 'cloud.backup'.
 */
/** `postBytes`: the signed call with a raw body; used for the pieces only when Merkez lists 'cloud.backup.binary'. */
export type CloudLink = { ready(): boolean; accepts(): string[] | undefined; post<T>(path: string, body: unknown, timeout?: number): Promise<T>; postBytes?<T>(path: string, data: Buffer, timeout?: number): Promise<T> };
export type CloudStatus = { enabled: boolean; running: boolean; lastAttemptAt?: string; lastSuccessAt?: string; lastBackup?: string; lastError?: string; copies?: number; bytes?: number; progress?: { sent: number; total: number } };
type Saved = Pick<CloudStatus, 'lastAttemptAt' | 'lastSuccessAt' | 'lastBackup' | 'lastError' | 'copies' | 'bytes'>;
type FileInfo = { name: string; size: number; sha256: string };
type Begin = { done: true; copy: unknown } | { done: false; uploadId: string; chunkBytes: number; need: { sha256: string; offset: number; size: number }[] };
/** dataVersion: the data's own version (3 until the first year package, then 4), told to Merkez with each copy. */
export type CloudOptions = { now?: () => Date; retryDelays?: number[]; chunkRetryMs?: number[]; minGapMs?: number; chunkBytes?: number; dataVersion?: () => number };
const MINUTE = 60_000, HOUR = 60 * MINUTE;
/** Not worth another try now: Merkez refused for a reason a retry cannot change (quota, disk, closed record, bad copy). */
const FINAL = new Set(['CLOUD_QUOTA', 'CLOUD_DISK', 'CLOUD_INTEGRITY', 'UPLOAD_GONE', 'UPLOAD_INCOMPLETE', 'INVALID_FILES', 'INVALID_CHUNK', 'RECORD_CLOSED', 'NOT_ACTIVATED', 'NOT_FOUND', 'COPY_NOT_FOUND', 'TICKET_EXPIRED', 'WRONG_TRANSFER_CODE', 'MERKEZ_ADDRESS', 'MERKEZ_INSECURE', 'MERKEZ_URL', 'MERKEZ_SIGNATURE', 'VALIDATION_ERROR']);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function fileHash(path: string) { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); }
const plain = (e: unknown) => e instanceof DomainError ? e.message : e instanceof Error && /ENOENT|EBUSY|EPERM/.test(e.message) ? 'Yedek dosyaları okunamadı.' : 'Mola Merkez’e ulaşılamadı.';

/**
 * The encrypted files of one finished, verified backup (flat folder), and the year packages it refers to (server/year-packages.ts:
 * the same bytes every time, so Mola Merkez, which keeps files by SHA-256, gets each package once). The local proof record (with a
 * path) stays here.
 */
export async function backupFiles(dir: string): Promise<(FileInfo & { path: string })[]> {
  const names = (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name);
  if (names.includes('BACKUP_IN_PROGRESS.txt') || names.includes('BACKUP_FAILED.txt') || !names.includes('complete.json') || !names.includes(BACKUP_KEY_FILE)) throw new DomainError('INVALID_FILES', 'Yedek tamamlanmamış; sunucuya gönderilmedi.', 409);
  const out: (FileInfo & { path: string })[] = [];
  for (const name of names.filter(n => n !== 'verification.json' && !n.endsWith('.key') && !n.startsWith('.')).sort()) {
    const path = join(dir, name);
    out.push({ name, size: (await fs.stat(path)).size, sha256: await fileHash(path), path });
  }
  const completion = JSON.parse(await fs.readFile(join(dir, 'complete.json'), 'utf8')) as Completion;
  for (const p of completion.packages ?? []) {
    if (out.some(f => f.name === p.blob)) continue;
    const path = packageFolders(dir).map(d => join(d, p.blob)).find(f => existsSync(f));
    if (!path) throw new DomainError('INVALID_FILES', 'Yıl paketi bulunamadı; yedek sunucuya gönderilmedi.', 409);
    out.push({ name: p.blob, size: p.size, sha256: p.sha256, path });
  }
  return out;
}

export class CloudBackup {
  private saved: Saved = {};
  private running?: Promise<CloudStatus>;
  private queued?: string;
  private progress?: { sent: number; total: number };
  private retryTimer?: NodeJS.Timeout; private retryIndex = 0;
  private readonly now: () => Date;
  constructor(private file: string, private link: CloudLink, private options: CloudOptions = {}) {
    this.now = options.now ?? (() => new Date());
    try { this.saved = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first upload */ }
  }
  get enabled() { try { return this.link.ready() && !!this.link.accepts()?.includes('cloud.backup'); } catch { return false; } }
  status(): CloudStatus { return { enabled: this.enabled, running: !!this.running, ...this.saved, ...(this.progress ? { progress: { ...this.progress } } : {}) }; }
  stop() { clearTimeout(this.retryTimer); this.retryTimer = undefined; }
  /** Resolves when nothing is uploading or waiting (tests, shutdown). */
  async idle() { while (this.running) await this.running.catch(() => undefined); }
  /**
   * After a verified backup. Never throws. `force`: "Şimdi yedekle", Gün sonu, a re-sealed key; otherwise skipped when a copy
   * went up within the last 6 hours. While one upload runs, the newest folder waits and goes next.
   */
  upload(dir: string, force = false): Promise<CloudStatus> {
    if (!this.enabled) return Promise.resolve(this.status());
    const last = Date.parse(this.saved.lastSuccessAt ?? '');
    if (!force && Number.isFinite(last) && this.now().getTime() - last < (this.options.minGapMs ?? 6 * HOUR) && this.saved.lastBackup !== basename(dir)) return Promise.resolve(this.status());
    if (this.running) { this.queued = dir; return this.running; }
    this.running = this.run(dir).finally(() => {
      this.running = undefined;
      const next = this.queued; this.queued = undefined;
      if (next) void this.upload(next, true);
    });
    return this.running;
  }
  private async save() { try { await fs.mkdir(dirname(this.file), { recursive: true }); writeAtomic(this.file, JSON.stringify(this.saved, null, 2) + '\n'); } catch { /* shown from memory */ } }
  private async run(dir: string): Promise<CloudStatus> {
    this.stop();
    this.saved.lastAttemptAt = this.now().toISOString();
    try {
      const files = await backupFiles(dir), complete = JSON.parse(await fs.readFile(join(dir, 'complete.json'), 'utf8')) as { createdAt: string };
      const total = files.reduce((n, f) => n + f.size, 0);
      this.progress = { sent: 0, total };
      const begin = await this.call<Begin>('/cloud-backup/begin', { copyId: basename(dir), createdAt: complete.createdAt, appVersion: APP_VERSION, dataVersion: this.options.dataVersion?.() ?? DATA_VERSION, files: files.map(({ name, size, sha256 }) => ({ name, size, sha256 })) }, 60_000);
      if (!begin.done) {
        this.progress.sent = total - begin.need.reduce((n, x) => n + x.size - x.offset, 0);
        for (const need of begin.need) await this.send(files.find(f => f.sha256 === need.sha256)!, begin.uploadId, need.offset, Math.min(this.options.chunkBytes ?? begin.chunkBytes, 8 * 1024 * 1024));
        const done = await this.call<{ copies: number; bytes: number }>('/cloud-backup/commit', { uploadId: begin.uploadId }, 60_000);
        Object.assign(this.saved, { copies: done.copies, bytes: done.bytes });
      }
      Object.assign(this.saved, { lastSuccessAt: this.now().toISOString(), lastBackup: basename(dir), lastError: undefined });
      this.retryIndex = 0;
    } catch (error) {
      this.saved.lastError = plain(error).slice(0, 200);
      // Later again, from where it stopped (Merkez keeps the received parts for 3 days); a newer backup replaces this one.
      const delays = this.options.retryDelays ?? [5 * MINUTE, 30 * MINUTE, 2 * HOUR];
      if (this.retryIndex < delays.length && !(error instanceof DomainError && ['CLOUD_QUOTA', 'RECORD_CLOSED', 'NOT_ACTIVATED'].includes(error.code))) {
        this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.upload(dir, true); }, delays[this.retryIndex++]); this.retryTimer.unref?.();
      }
    } finally { this.progress = undefined; await this.save(); }
    return this.status();
  }
  /** One file, from `offset`, in pieces; Merkez's answer says where it really is (a lost answer is simply resent from there). */
  private async send(file: FileInfo & { path: string }, uploadId: string, offset: number, chunk: number) {
    const handle = await fs.open(file.path, 'r');
    let again = true;
    // Raw bytes to a Merkez that takes them (a quarter less traffic than base64 JSON); an older Merkez gets the JSON call.
    const binary = !!this.link.postBytes && !!this.link.accepts()?.includes('cloud.backup.binary');
    try {
      while (offset < file.size) {
        const length = Math.min(chunk, file.size - offset), data = Buffer.alloc(length);
        const { bytesRead } = await handle.read(data, 0, length, offset);
        if (bytesRead !== length) throw new DomainError('INVALID_FILES', 'Yedek dosyası okunamadı.', 409);
        let answer: { received: number };
        try {
          answer = binary ? await this.call<{ received: number }>(`/cloud-backup/chunk-bin/${uploadId}/${file.sha256}/${offset}`, undefined, 180_000, data)
            : await this.call<{ received: number }>('/cloud-backup/chunk', { uploadId, sha256: file.sha256, offset, data: data.toString('base64') }, 180_000);
        }
        catch (error) {
          // The file arrived broken (its SHA-256 did not match): once more from the start.
          if (error instanceof DomainError && error.code === 'CLOUD_INTEGRITY' && again) { again = false; this.progress!.sent -= offset; offset = 0; continue; }
          throw error;
        }
        this.progress!.sent += Math.max(0, answer.received - offset);
        offset = answer.received;
      }
    } finally { await handle.close(); }
  }
  /**
   * A year package back from Mola Merkez (one missing or damaged here; server/year-packer.ts checkPackages): looked for in this
   * install's copies by its SHA-256, read in 4 MB pieces, checked, written to `target`. False: Merkez has none (or is not on).
   */
  async fetchFile(sha256: string, size: number, target: string) {
    if (!this.enabled) return false;
    const { copies } = await this.call<{ copies: { id: string }[] }>('/cloud-backup/list', {}, 60_000);
    for (const copy of copies) {
      const part = `${target}.indiriliyor`, out = await fs.open(part, 'w');
      try {
        for (let offset = 0; offset < size;) {
          const { data } = await this.call<{ data: string }>('/cloud-backup/read', { copy: copy.id, sha256, offset, length: Math.min(4 * 1024 * 1024, size - offset) }, 180_000);
          const bytes = Buffer.from(data, 'base64'); if (!bytes.length) throw new Error('eksik');
          await out.write(bytes, 0, bytes.length, offset); offset += bytes.length;
        }
      } catch { await out.close(); await fs.rm(part, { force: true }); continue; }
      await out.close();
      if (await fileHash(part) === sha256) { await fs.rename(part, target); return true; }
      await fs.rm(part, { force: true });
    }
    return false;
  }
  /** A call with short retries for a shaky line; Merkez's refusals go straight up. */
  private async call<T>(path: string, body: unknown, timeout: number, bytes?: Buffer): Promise<T> {
    const waits = this.options.chunkRetryMs ?? [1000, 4000, 15000];
    for (let attempt = 0; ; attempt++) {
      try { return await (bytes ? this.link.postBytes!<T>(path, bytes, timeout) : this.link.post<T>(path, body, timeout)); }
      catch (error) {
        if (attempt >= waits.length || (error instanceof DomainError && FINAL.has(error.code))) throw error;
        await sleep(waits[attempt]);
      }
    }
  }
}

// ---------- Geri yükleme: "Mola Merkez'den geri yükle" (a clean install on a new computer) ----------
export type CloudCopy = { id: string; createdAt: string; uploadedAt: string; bytes: number; files: number; appVersion: string; verified: boolean };
type TransferLink = { transferPost(path: string, body: unknown, timeout?: number): Promise<Response> };
type Session = { ticket: string; expiresAt: string; name: string; copies: (CloudCopy & { list: FileInfo[] })[] };
const READ = 4 * 1024 * 1024;

/**
 * The new computer's side: the taşıma kodu opens a short session (ticket) for that business's copies; the chosen copy is
 * downloaded into a folder beside the data folder (resumable: whole files already here are kept), each file checked by its
 * SHA-256, then restored with the recovery code exactly like a flash-drive copy (server/runtime.ts restoreHere).
 */
export class CloudRestore {
  private session?: Session;
  progress?: { stage: 'download' | 'restore'; received: number; total: number };
  constructor(private link: TransferLink, readonly folder: string, private requester: () => string | undefined, private now: () => Date = () => new Date()) {}
  async open(code: string) {
    const requester = this.requester();
    if (!requester) throw new DomainError('RESTORE_OFF', 'Bu kurulumda geri yükleme yapılamıyor.', 409);
    const answer = await (await this.link.transferPost('/cloud-backup/transfer/open', { code: code.trim(), requester }, 30_000)).json() as Session;
    this.session = { ticket: answer.ticket, expiresAt: answer.expiresAt, name: answer.name, copies: answer.copies };
    return { name: answer.name, copies: answer.copies.map(({ list: _list, ...c }) => c) };
  }
  /** "İşletmem var" (13 Ekim): the owner's sign-in and e-mail code gave the same kind of session directly (no taşıma kodu). */
  useSession(answer: Session) {
    this.session = { ticket: answer.ticket, expiresAt: answer.expiresAt, name: answer.name, copies: answer.copies };
    return { name: answer.name, copies: answer.copies.map(({ list: _list, ...c }) => c) };
  }
  private current() {
    if (!this.session || Date.parse(this.session.expiresAt) <= this.now().getTime()) throw new DomainError('TICKET_EXPIRED', 'Önce taşıma kodunu girin.', 409);
    return this.session;
  }
  /** Downloads one copy's files (the list Merkez gave with the session) and checks each by its SHA-256; returns the folder. */
  async download(copyId: string) {
    const s = this.current(), files = s.copies.find(c => c.id === copyId)?.list;
    if (!/^backup-[A-Za-z0-9_-]{8,120}$/.test(copyId) || !files) throw new DomainError('NOT_FOUND', 'Yedek bulunamadı. Taşıma kodunu yeniden girin.', 404);
    const target = join(this.folder, copyId);
    await fs.mkdir(target, { recursive: true });
    const total = files.reduce((n, f) => n + f.size, 0);
    this.progress = { stage: 'download', received: 0, total };
    for (const f of files) {
      if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}$/.test(f.name)) throw new DomainError('INVALID_FILES', 'Yedek dosya listesi geçersiz.', 409);
      const path = join(target, f.name);
      const have = await fs.stat(path).then(x => x.size, () => -1);
      if (have === f.size && await fileHash(path) === f.sha256) { this.progress.received += f.size; continue; }
      const part = `${path}.indiriliyor`; await fs.rm(part, { force: true });
      const out = await fs.open(part, 'w');
      try {
        for (let offset = 0; offset < f.size;) {
          const body = { ticket: s.ticket, copy: copyId, sha256: f.sha256, offset, length: Math.min(READ, f.size - offset) };
          let data: Buffer | undefined;
          for (let attempt = 0; !data; attempt++) {
            try { data = Buffer.from(await (await this.link.transferPost('/cloud-backup/transfer/read', body, 180_000)).arrayBuffer()); }
            catch (error) { if (attempt >= 3 || (error instanceof DomainError && FINAL.has(error.code)) || (error instanceof DomainError && error.code === 'TICKET_EXPIRED')) throw error; await sleep(1000 * 4 ** attempt); }
          }
          if (!data.length) throw new DomainError('CLOUD_INTEGRITY', 'Yedek eksik indi. Yeniden deneyin.', 502);
          await out.write(data, 0, data.length, offset); offset += data.length; this.progress.received += data.length;
        }
      } finally { await out.close(); }
      if (await fileHash(part) !== f.sha256) { await fs.rm(part, { force: true }); throw new DomainError('CLOUD_INTEGRITY', 'İndirilen yedek bozuk geldi (doğrulanamadı). Yeniden deneyin.', 502); }
      await fs.rename(part, path);
    }
    return target;
  }
  /** The copy is here and the code opened it: Merkez spends the taşıma kodu (the session stays for a retry of the swap). */
  async finish(copyId: string) { await this.link.transferPost('/cloud-backup/transfer/finish', { ticket: this.current().ticket, copy: copyId }, 30_000); }
}

/**
 * Desktop window, clean install only (like "Yedekten geri yükle"):
 *   POST /api/desktop/restore/merkez/open      { code }            → { name, copies }   (the taşıma kodu from Mola ekibi)
 *   POST /api/desktop/restore/merkez           { copy, code }      → download, check, recovery code, restore, switch
 *   GET  /api/desktop/restore/merkez/progress                      → { stage, received, total } while it runs
 * The recovery code is checked against the downloaded copy before the taşıma kodu is spent, and counts like every try.
 */
export function cloudRestoreRoutes(app: Express, guard: (req: Request) => void, ctx: { security?: Security; restore?: CloudRestore; clean: () => boolean; link?: TransferLink }) {
  const ready = () => {
    if (!ctx.restore || !ctx.security?.restore || !ctx.security.vault || ctx.security.vault.protection === 'off') throw new DomainError('RESTORE_OFF', 'Mola Merkez’den geri yükleme yalnız masaüstü uygulamasında (anahtar koruması açık) yapılır.', 409);
    if (!ctx.clean()) throw new DomainError('NOT_CLEAN', 'Bu bilgisayarda zaten işletme verisi var. Geri yükleme yalnız yeni kurulumda yapılır.', 409);
    return ctx.restore;
  };
  let busy = false;
  app.post('/api/desktop/restore/merkez/open', async (req, res) => {
    guard(req); const r = ready();
    const { code } = z.object({ code: z.string().trim().min(8).max(40) }).parse(req.body);
    res.json(await r.open(code));
  });
  app.get('/api/desktop/restore/merkez/progress', (req, res) => { guard(req); res.json({ busy, progress: ctx.restore?.progress ?? null }); });
  // "İşletmem var" (13 Ekim): the owner's own sign-in on a new computer. Merkez checks the password (its verifier) and sends a
  // code to the business's e-mail; the right code opens the Sunucu yedeği session, or says there is none (then a flash drive).
  app.post('/api/desktop/owner-login/start', async (req, res) => {
    guard(req); ready();
    const b = z.object({ email: z.string().trim().min(3).max(120), username: z.string().trim().min(1).max(50), password: z.string().min(1).max(200) }).parse(req.body);
    res.json(await (await ctx.link!.transferPost('/owner-login/start', b, 60_000)).json());
  });
  app.post('/api/desktop/owner-login/verify', async (req, res) => {
    guard(req); const r = ready();
    const b = z.object({ ticket: z.string().min(1).max(64), code: z.string().trim().regex(/^\d{6}$/) }).parse(req.body);
    const requester = ctx.security?.vault?.installId;
    if (!requester) throw new DomainError('RESTORE_OFF', 'Bu kurulumda geri yükleme yapılamıyor.', 409);
    const answer = await (await ctx.link!.transferPost('/owner-login/verify', { ...b, requester }, 30_000)).json() as { name: string; cloud: Session | null };
    res.json({ name: answer.name, cloud: answer.cloud ? r.useSession(answer.cloud) : null });
  });
  app.post('/api/desktop/restore/merkez', async (req, res) => {
    guard(req); const r = ready();
    // The recovery code, or (İşletmem var) the owner's username and password: the same restore, another key to the backup.
    const b = z.object({ copy: z.string().min(1).max(200), code: z.string().min(1).max(64).optional(), username: z.string().trim().min(1).max(50).optional(), password: z.string().min(1).max(200).optional() }).parse(req.body);
    const secret = b.code ? b.code : b.username && b.password ? { username: b.username, password: b.password } : undefined;
    if (!secret) throw new DomainError('CODE_REQUIRED', 'Kurtarma kodunu ya da işletme sahibinin şifresini yazın.', 400);
    if (busy) throw new DomainError('RATE_LIMIT', 'Geri yükleme sürüyor. Bekleyin.', 429);
    busy = true;
    try {
      // The list of files comes from Merkez's own record of the copy, given with the session (never from the screen).
      const dir = await r.download(b.copy);
      r.progress = { stage: 'restore', received: r.progress?.total ?? 0, total: r.progress?.total ?? 0 };
      await ctx.security!.attempts.run(async () => {
        const wrapper = await readBackupKeyFile(dir);
        if (!wrapper) throw new DomainError('OLD_BACKUP', 'Bu yedek kurtarma koduyla açılmıyor.', 409);
        if (typeof secret === 'string') await masterFromCode(wrapper, secret); else await masterFromPassword(wrapper, secret.username, secret.password);
      });
      await r.finish(b.copy);
      await ctx.security!.attempts.run(() => ctx.security!.restore!(dir, secret));
      await fs.rm(r.folder, { recursive: true, force: true }).catch(() => {});
      res.json({ ok: true });
    } finally { busy = false; r.progress = undefined; }
  });
}
