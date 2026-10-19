import { createHash, type KeyObject } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, chmodSync } from 'node:fs';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { DomainError } from '../packages/domain/engine.js';
import { busyText, type Activity } from '../packages/domain/update-busy.js';
import { DATA_VERSION } from './data-version.js';
import { writeAtomic } from './key-vault.js';
import { APP_VERSION } from './license.js';
import type { SyncRequest, UpdateOffer } from './sync-protocol.js';
import { BUNDLE_MANIFEST, compareVersions, currentPlatform, fileSha256, gunzipFile, readTar, validVersion, verifyRelease, type ReleaseClaims, type UpdatePlatform } from './update-manifest.js';

/*
 * Otomatik güncelleme, the café's side (GELISTIRICI_REHBERI "Otomatik güncelleme").
 *
 * While Mola runs, the heartbeat (server/kafe-link.ts) tells it which release Mola Merkez offers it. This agent then, in the
 * background and resumable (HTTP Range):
 *   1. fetches the release manifest, checks Merkez's Ed25519 signature (the key baked into this program), the platform, that
 *      it is newer (never a downgrade), that this version may go straight to it (minFrom), the data version and Node.js;
 *   2. downloads the archive into <update dir>/<version>/paket.tar.gz(.part), checks its size and SHA-256;
 *   3. unpacks it into <version>/hazir/, checking every file's SHA-256 against the signed list;
 *   4. writes bekleyen.json: "ready". Nothing of the running program is touched.
 * The program is swapped OUTSIDE this server, by the applier (app/guncelleyici.mjs) that the watchdog (app/nobetci.mjs) starts
 * at the next start, or right away when this server exits with code 75 ("Şimdi kur", or the café idle for 20 minutes): it
 * stops the server, copies veri/ (verified), keeps the old program in onceki/, moves the new one in, starts it and checks
 * /api/health; if that fails it puts the old program (and, if the new one changed it, the old data) back. Its outcome comes
 * back in sonuc.json, read at the next start and reported to Merkez.
 * Files (<update dir> = guncelleme/ beside the data folder): durum.json (this state), ayar.json ("Boşta kendiliğinden kur"),
 * bekleyen.json, sonuc.json, gunluk.json (the applier's journal), <version>/.
 */
export type UpdateState = 'idle' | 'downloading' | 'ready' | 'installing' | 'installed' | 'failed' | 'rolled_back';
type Saved = {
  v: 1; state: UpdateState; at: string; release?: string; version?: string; size?: number; notes?: string; error?: string;
  /** Versions that were rolled back (or refused for good) here: not downloaded again; the vendor publishes a newer one. */
  rejected: string[];
  /** The version an install came from (installed / rolled_back). */
  from?: string;
  /** The owner closed the "güncellendi" / "geri alındı" note. */
  seen?: boolean;
  /** A failed download is tried again after this time (ms). */
  retryAt?: number; tries?: number;
  /** When the running version was installed here (the applier's outcome): yıl paketleri wait a week after it. */
  installedAt?: string;
};
/** What the applier needs (and checks again) to put a downloaded release in place. */
export type Pending = {
  v: 1; version: string; from: string; platform: UpdatePlatform; release: string; folder: string; runtime: boolean; node: string;
  files: ReleaseClaims['files']; top: ReleaseClaims['top']; readyAt: string;
};
/** Written by the applier (scripts/desktop/guncelleyici.mjs). `retry`: the cause may pass (disk space), so the version is not refused. */
export type Outcome = { v: 1; version: string; from: string; result: 'installed' | 'rolled_back' | 'failed'; reason?: string; retry?: boolean; at: string };
export type { Activity };
export type UpdateLink = { signedGet(path: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<Response> };
export type UpdateAgentOptions = {
  dir: string; link: UpdateLink; publicKey: () => KeyObject | undefined;
  /**
   * The data version on this computer: the data's own (PRAGMA user_version, server/runtime.ts), which stays 3 until the first
   * year package although this program writes 4 (server/year-packer.ts). Without it: what this program writes.
   */
  current?: string; platform?: UpdatePlatform; dataVersion?: number | (() => number); node?: string; now?: () => Date;
  /** Running under the watchdog (MOLA_NOBETCI=1): exiting with 75 makes it apply the update. */
  canApply?: boolean;
  /** Closes the server and exits with code 75 (server/index.ts). */
  restart?: () => void;
  /** The server's own verified backup before an install while running ("Şimdi kur", idle). */
  backup?: () => Promise<{ ok: boolean; error?: string }>;
  activity?: () => Activity;
  idleMinutes?: number; retryMs?: number[]; tickMs?: number;
  /** Free bytes on the disk of `dir` (tests). */
  freeSpace?: (dir: string) => number;
  /** Program dosyaları denetimi (server/integrity.ts remember): the verified signed release and the unpacked new app/ folder. */
  keepSigned?: (signed: unknown, appDir: string) => void;
};
export const IDLE_MINUTES = 20;
const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const MB = 1024 * 1024;
/** A version as a folder name (validVersion already allows only [0-9A-Za-z.-]). */
const folderOf = (version: string) => version.replace(/[^0-9A-Za-z.-]/g, '_');
const megabytes = (n: number) => `${Math.ceil(n / MB)} MB`;
export class UpdateError extends Error { constructor(message: string, public retry = true) { super(message); } }

export class UpdateAgent {
  readonly dir: string; readonly current: string; readonly platform: UpdatePlatform | undefined;
  private saved: Saved; private idle: boolean; private lastActivity: number; private progress = 0;
  private job?: { release: string; abort: AbortController; done: Promise<void> };
  private timer?: NodeJS.Timeout; private installing = false;
  /** The signed manifest as Merkez sent it (for keepSigned). */
  private signed?: { id: string; signed: unknown };
  private now: () => Date;
  constructor(private options: UpdateAgentOptions) {
    this.dir = options.dir; this.current = options.current ?? APP_VERSION; this.platform = 'platform' in options ? options.platform : currentPlatform();
    this.now = options.now ?? (() => new Date());
    this.saved = this.readJson<Saved>('durum.json') ?? { v: 1, state: 'idle', at: this.now().toISOString(), rejected: [] };
    this.saved.rejected ??= [];
    this.idle = this.readJson<{ idleInstall?: boolean }>('ayar.json')?.idleInstall ?? true;
    this.lastActivity = this.now().getTime();
  }
  private readJson<T>(name: string): T | undefined { try { return JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as T; } catch { return undefined; } }
  private writeJson(name: string, value: unknown) { mkdirSync(this.dir, { recursive: true }); writeAtomic(join(this.dir, name), JSON.stringify(value, null, 2)); }
  private set(patch: Partial<Saved>) { this.saved = { ...this.saved, ...patch, at: this.now().toISOString() }; try { this.writeJson('durum.json', this.saved); } catch { /* a read-only disk: kept in memory */ } }
  get state() { return this.saved.state; }

  /** At server start: the applier's outcome, a stale or manually replaced pending update, an interrupted download. */
  start() {
    this.takeOutcome();
    const pending = this.readJson<Pending>('bekleyen.json');
    // Installed by hand meanwhile (Mola Kurulum.exe), or older than this program: nothing to apply any more.
    if (pending && (!validVersion(pending.version) || compareVersions(pending.version, this.current) <= 0)) { this.discard(); if (this.saved.state === 'ready') this.set({ state: 'idle' }); }
    if (this.saved.state === 'ready' && !existsSync(join(this.dir, 'bekleyen.json'))) this.set({ state: 'idle' });
    if (this.saved.state === 'installing') this.set({ state: this.saved.version === this.current ? 'installed' : existsSync(join(this.dir, 'bekleyen.json')) ? 'ready' : 'idle' });
    // A download cut by a restart goes on from where it stopped when Merkez offers it again (the .part file stays).
    if (this.saved.state === 'downloading') this.set({ state: 'idle' });
    this.cleanOld();
    const every = this.options.tickMs ?? 60_000;
    this.timer = setInterval(() => void this.tick(), every); this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); this.job?.abort.abort(); }
  /**
   * The applier's sonuc.json. A new version is already running while the applier checks its health, so "installed" arrives
   * after this server started: it is looked for at start, every minute, with every heartbeat and every screen read.
   */
  private takeOutcome() {
    const outcome = this.readJson<Outcome>('sonuc.json');
    if (outcome?.v !== 1) return;
    if (outcome.result === 'installed' && outcome.version === this.current) this.set({ state: 'installed', version: outcome.version, from: outcome.from, error: undefined, seen: false, tries: 0, retryAt: undefined, installedAt: outcome.at });
    else if (outcome.result === 'installed') this.set({ state: 'idle', error: undefined });
    else {
      if (!outcome.retry && this.job) this.job.abort.abort();
      this.set({ state: outcome.result, version: outcome.version, from: outcome.from, error: outcome.reason ?? 'Güncelleme kurulamadı.', seen: false, ...(outcome.retry ? { retryAt: this.now().getTime() + RETRY_MS[1] } : { rejected: [...new Set([...this.saved.rejected, outcome.version])].slice(-20) }) });
    }
    try { rmSync(join(this.dir, 'sonuc.json'), { force: true }); } catch { /* read again next time */ }
  }
  /** Folders of versions that are neither ready nor downloading (left by an older run). */
  private cleanOld() {
    let names: string[] = []; try { names = readdirSync(this.dir); } catch { return; }
    const s = this.saved, keep = s.version && validVersion(s.version) && compareVersions(s.version, this.current) > 0 ? folderOf(s.version) : undefined;
    for (const name of names) {
      if (name === keep || !/^\d+\.\d+\.\d+/.test(name)) continue;
      try { if (statSync(join(this.dir, name)).isDirectory()) rmSync(join(this.dir, name), { recursive: true, force: true }); } catch { /* next start */ }
    }
  }
  /** The café server hands in what only it knows (open tables and orders), once its app exists. */
  attach(more: Pick<UpdateAgentOptions, 'activity'>) { this.options = { ...this.options, ...more }; }
  /** A write request (an order, a payment, a login): the café is not idle. */
  touch() { this.lastActivity = this.now().getTime(); }

  // ---------- Heartbeat ----------
  /** What the heartbeat tells Merkez (only to a Merkez that accepts it): no path, no name. */
  report(): SyncRequest['update'] {
    if (!this.platform) return undefined;
    this.takeOutcome();
    const s = this.saved;
    return { platform: this.platform, state: s.state, ...(s.release ? { release: s.release } : {}), ...(s.version ? { version: s.version } : {}),
      ...(s.state === 'downloading' ? { progress: Math.min(100, Math.max(0, Math.round(this.progress))) } : {}), ...(s.error && ['failed', 'rolled_back'].includes(s.state) ? { error: s.error.slice(0, 300) } : {}), at: s.at, idleInstall: this.idle };
  }
  /** Merkez's answer: a release for this café, or null (none, or the vendor pressed "Durdur"). */
  offer(offer: UpdateOffer | null) {
    this.takeOutcome();
    const s = this.saved;
    if (!offer) {
      // Stopped by the vendor: a download or a ready update that was not installed yet is dropped.
      if (['downloading', 'ready'].includes(s.state) || (s.state === 'failed' && !s.from)) { this.job?.abort.abort(); this.discard(true); this.set({ state: 'idle', release: undefined, version: undefined, error: undefined, notes: undefined, tries: 0, retryAt: undefined }); }
      return;
    }
    if (!validVersion(offer.version) || compareVersions(offer.version, this.current) <= 0 || s.rejected.includes(offer.version)) return;
    if (this.installing || s.state === 'installing') return;
    if (s.release === offer.id && (s.state === 'ready' || this.job)) { if (offer.notes !== s.notes) this.set({ notes: offer.notes }); return; }
    if (s.release === offer.id && s.state === 'failed' && (s.retryAt ?? 0) > this.now().getTime()) return;
    if (this.job && this.job.release !== offer.id) this.job.abort.abort();
    if (s.state === 'ready' && s.release !== offer.id) this.discard(true);
    void this.download(offer);
  }

  // ---------- Download ----------
  /** Resolves when the download (and unpacking) finished or failed; the state says which. */
  download(offer: UpdateOffer): Promise<void> {
    if (this.job?.release === offer.id) return this.job.done;
    const abort = new AbortController();
    const done = (async () => {
      const retrying = this.saved.release === offer.id && this.saved.state === 'failed';
      this.progress = 0;
      this.set({ state: 'downloading', release: offer.id, version: offer.version, size: offer.size, notes: offer.notes, error: undefined, from: undefined, seen: undefined, ...(retrying ? {} : { tries: 0 }) });
      try {
        const claims = await this.manifest(offer, abort.signal);
        const folder = join(this.dir, folderOf(claims.version));
        const archive = await this.fetchArchive(claims, folder, abort.signal);
        await this.unpack(claims, archive, folder);
        // Program dosyaları denetimi (server/integrity.ts): the new program's signed list, kept for it before it is installed.
        if (this.signed?.id === claims.id) try { this.options.keepSigned?.(this.signed.signed, join(folder, 'hazir', 'app')); } catch { /* it asks Merkez after the update */ }
        const pending: Pending = { v: 1, version: claims.version, from: this.current, platform: claims.platform, release: claims.id, folder: `${folderOf(claims.version)}/hazir`, runtime: claims.runtime, node: claims.node, files: claims.files, top: claims.top, readyAt: this.now().toISOString() };
        this.writeJson('bekleyen.json', pending);
        rmSync(archive, { force: true });
        this.progress = 100;
        this.set({ state: 'ready', tries: 0, retryAt: undefined });
      } catch (error) {
        if (abort.signal.aborted) return;
        const e = error instanceof UpdateError ? error : new UpdateError(error instanceof DomainError ? error.message : `İndirilemedi: ${(error as Error).message}`);
        const tries = (this.saved.tries ?? 0) + 1, wait = (this.options.retryMs ?? RETRY_MS)[Math.min(tries - 1, (this.options.retryMs ?? RETRY_MS).length - 1)];
        this.set({ state: 'failed', error: e.message, tries, retryAt: this.now().getTime() + (e.retry ? wait : 24 * 3600_000) });
      } finally { if (this.job?.abort === abort) this.job = undefined; }
    })();
    this.job = { release: offer.id, abort, done };
    return done;
  }
  private async get(path: string, headers: Record<string, string>, signal: AbortSignal) {
    let response = await this.options.link.signedGet(path, headers, signal);
    // This computer's clock was off: the answer carried Merkez's time; one more signed try passes.
    if (response.status === 401) { const body = await response.clone().json().catch(() => ({})) as { code?: string }; if (body.code === 'CLOCK_SKEW') response = await this.options.link.signedGet(path, headers, signal); }
    if (response.status === 404) throw new UpdateError('Bu sürüm Mola Merkez’de artık sunulmuyor.');
    return response;
  }
  /** The signed manifest, checked against everything this computer knows about itself. */
  async manifest(offer: UpdateOffer, signal: AbortSignal): Promise<ReleaseClaims> {
    const response = await this.get(`/releases/${encodeURIComponent(offer.id)}/manifest`, {}, signal);
    if (!response.ok) throw new UpdateError(`Mola Merkez sürüm bilgisini vermedi (yanıt ${response.status}).`);
    const key = this.options.publicKey();
    if (!key) throw new UpdateError('Mola Merkez anahtarı bu kurulumda yok.', false);
    let claims: ReleaseClaims;
    const signed = ((await response.json()) as { release?: unknown }).release;
    try { claims = verifyRelease(signed, key); }
    catch (error) { throw new UpdateError((error as Error).message, false); }
    this.signed = { id: claims.id, signed };
    const problem = this.refuse(claims, offer);
    if (problem) throw new UpdateError(problem, false);
    return claims;
  }
  /** Why this signed release must not be installed here (undefined: it may). */
  refuse(c: ReleaseClaims, offer?: UpdateOffer): string | undefined {
    if (offer && (c.id !== offer.id || c.version !== offer.version)) return 'Sürüm bilgisi Merkez’in önerdiğiyle uyuşmuyor.';
    if (c.platform !== this.platform) return 'Bu sürüm başka bir bilgisayar türü için hazırlanmış.';
    if (compareVersions(c.version, this.current) <= 0) return `Eski ya da aynı sürüm (${c.version}); geri dönüş güncellemeyle yapılmaz.`;
    if (compareVersions(this.current, c.minFrom) < 0) return `Bu sürüme ancak ${c.minFrom} ve sonrasından geçilebilir; kurulum paketiyle güncelleyin.`;
    const given = this.options.dataVersion, data = typeof given === 'function' ? given() : given ?? DATA_VERSION;
    if (data < c.data.minReadable || data > c.data.maxReadable) return `Bu sürüm bu bilgisayardaki veri biçimini (${data}) açamıyor.`;
    if (!c.runtime && c.node !== (this.options.node ?? process.version)) return `Bu sürüm başka bir Node.js (${c.node}) ister; kurulum paketiyle güncelleyin.`;
    return undefined;
  }
  private free() { if (this.options.freeSpace) return this.options.freeSpace(this.dir); const s = statfsSync(this.dir); return Number(s.bavail) * Number(s.bsize); }
  /** Downloads (or resumes) the archive and checks its size and SHA-256. Returns the finished file. */
  private async fetchArchive(c: ReleaseClaims, folder: string, signal: AbortSignal) {
    mkdirSync(folder, { recursive: true });
    const done = join(folder, 'paket.tar.gz'), part = `${done}.part`, size = c.archive.size;
    if (existsSync(done)) {
      const have = await fileSha256(done);
      if (have.sha256 === c.archive.sha256) return done;
      rmSync(done, { force: true });
    }
    const unpacked = c.files.reduce((n, f) => n + f.size, 0), have = existsSync(part) ? statSync(part).size : 0;
    const need = size - Math.min(have, size) + unpacked + 200 * MB;
    if (this.free() < need) throw new UpdateError(`Diskte yer yok: güncelleme için yaklaşık ${megabytes(need)} boş yer gerekli.`);
    let offset = have;
    if (have > size) { rmSync(part, { force: true }); offset = 0; }
    if (offset < size) {
      const response = await this.get(`/releases/${encodeURIComponent(c.id)}/paket`, offset ? { Range: `bytes=${offset}-` } : {}, signal);
      if (response.status === 416) { rmSync(part, { force: true }); throw new UpdateError('İndirme baştan alınacak.'); }
      if (!response.ok || !response.body) throw new UpdateError(`Mola Merkez paketi vermedi (yanıt ${response.status}).`);
      if (offset && response.status !== 206) offset = 0;  // the range was not honoured: from the start
      // Written chunk by chunk and flushed even when the line drops: what arrived stays for the next try (Range).
      let received = offset, failure: unknown;
      const out = createWriteStream(part, { flags: offset ? 'a' : 'w' });
      try {
        for await (const chunk of Readable.fromWeb(response.body as import('node:stream/web').ReadableStream, { signal })) {
          received += (chunk as Buffer).length; this.progress = received / size * 100;
          if (received > size) throw new UpdateError('Paket beklenenden büyük.');
          if (!out.write(chunk)) await once(out, 'drain');
        }
      } catch (error) { failure = error; }
      out.end(); await finished(out).catch(() => undefined);
      if (failure) throw failure;
    }
    const got = await fileSha256(part);
    if (got.size !== size || got.sha256 !== c.archive.sha256) {
      rmSync(part, { force: true });
      throw new UpdateError(got.size < size ? 'İndirme yarım kaldı; yeniden denenecek.' : 'İndirilen paket bozuk (özet tutmuyor); yeniden indirilecek.');
    }
    renameSync(part, done);
    return done;
  }
  /** Unpacks into <version>/hazir, every file checked against the signed list; nothing outside app/, runtime/, ust/. */
  private async unpack(c: ReleaseClaims, archive: string, folder: string) {
    const tmp = join(folder, 'hazir.tmp'), ready = join(folder, 'hazir');
    rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
    const want = new Map(c.files.map(f => [f.path, f])), seen = new Set<string>();
    try {
      await readTar(gunzipFile(archive), h => {
        if (h.name === BUNDLE_MANIFEST || h.type === '5') return undefined;
        const f = want.get(h.name);
        if (!f || seen.has(h.name)) throw new UpdateError(`Pakette listede olmayan dosya: ${h.name}`, false);
        seen.add(h.name);
        const target = join(tmp, ...h.name.split('/'));
        mkdirSync(dirname(target), { recursive: true });
        const out = createWriteStream(target), hash = createHash('sha256'); let size = 0;
        return {
          data: async chunk => { hash.update(chunk); size += chunk.length; if (!out.write(chunk)) await once(out, 'drain'); },
          end: async () => {
            out.end(); await finished(out);
            if (size !== f.size || hash.digest('hex') !== f.sha256) throw new UpdateError(`Paketteki dosya bozuk: ${h.name}`);
            if (process.platform !== 'win32') chmodSync(target, f.mode ?? (h.mode || 0o644));
          },
        };
      });
      const missing = c.files.find(f => !seen.has(f.path));
      if (missing) throw new UpdateError(`Pakette eksik dosya: ${missing.path}`);
      rmSync(ready, { recursive: true, force: true }); renameSync(tmp, ready);
    } catch (error) { rmSync(tmp, { recursive: true, force: true }); if (error instanceof UpdateError) throw error; throw new UpdateError(`Paket açılamadı: ${(error as Error).message}`); }
  }
  /** Drops the pending update (and, with `files`, its downloaded folder). */
  private discard(files = false) {
    const pending = this.readJson<Pending>('bekleyen.json');
    rmSync(join(this.dir, 'bekleyen.json'), { force: true });
    const version = pending?.version ?? this.saved.version;
    if (files && version && validVersion(version)) rmSync(join(this.dir, folderOf(version)), { recursive: true, force: true });
  }

  // ---------- Installing while running ----------
  idleInstall() { return this.idle; }
  setIdleInstall(on: boolean) { this.idle = on; this.writeJson('ayar.json', { idleInstall: on }); }
  private busy() { return this.options.activity?.() ?? { openAccounts: 0, pendingOrders: 0 }; }
  private assertQuiet() {
    const a = this.busy();
    if (a.openAccounts || a.pendingOrders) throw new DomainError('UPDATE_BUSY', `${busyText(a)} var. Güncelleme bunlar bitince kurulabilir; yoksa kapanışta ya da yarın açılışta kendiliğinden kurulur.`, 409);
  }
  /**
   * "Şimdi kur" (and the idle install): only when nothing is open, after the server's own verified backup. Returns the step
   * that restarts the server (run it after answering the request): the watchdog then applies the update.
   */
  async installNow(): Promise<() => void> {
    if (this.saved.state !== 'ready' || !existsSync(join(this.dir, 'bekleyen.json'))) throw new DomainError('NO_UPDATE', 'Kurulmayı bekleyen güncelleme yok.', 409);
    if (!this.options.canApply || !this.options.restart) throw new DomainError('UPDATE_AT_START', 'Bu çalıştırmada Mola kendini yeniden başlatamıyor; güncelleme bir sonraki açılışta kurulur.', 409);
    if (this.installing) throw new DomainError('UPDATE_RUNNING', 'Güncelleme zaten başlatıldı.', 409);
    this.assertQuiet();
    this.installing = true;
    try {
      const backup = await (this.options.backup?.() ?? Promise.resolve({ ok: true }));
      if (!backup.ok) throw new DomainError('UPDATE_BACKUP', `Yedek alınamadı${backup.error ? ` (${backup.error})` : ''}; güncelleme ertelendi. Kapanışta ya da yarın açılışta yeniden denenir.`, 409);
      // An order may have come in while the backup ran.
      this.assertQuiet();
      this.set({ state: 'installing' });
      const restart = this.options.restart;
      return () => restart();
    } catch (error) { this.installing = false; throw error; }
  }
  /** Every minute: café idle for IDLE_MINUTES (no write request, nothing open), owner allows it → install now. */
  async tick() {
    this.takeOutcome();
    if (this.saved.state !== 'ready' || !this.idle || !this.options.canApply || this.installing) return false;
    if (this.now().getTime() - this.lastActivity < (this.options.idleMinutes ?? IDLE_MINUTES) * 60_000) return false;
    const a = this.busy(); if (a.openAccounts || a.pendingOrders) return false;
    try { const go = await this.installNow(); console.log('[güncelleme] Kafe boşta; güncelleme kuruluyor.'); go(); return true; }
    catch (error) { console.warn(`[güncelleme] Boşta kurulum yapılamadı: ${(error as Error).message}`); return false; }
  }
  /** The owner's view (banner, Ayarlar → Güvenlik ve yedek). */
  view() {
    this.takeOutcome();
    const s = this.saved, a = this.busy();
    return { current: this.current, state: s.state, version: s.version ?? null, notes: s.notes ?? '', error: s.error ?? null, from: s.from ?? null, seen: !!s.seen,
      progress: s.state === 'downloading' ? Math.round(this.progress) : null, idleInstall: this.idle, idleMinutes: this.options.idleMinutes ?? IDLE_MINUTES,
      canInstallNow: s.state === 'ready' && !!this.options.canApply && !a.openAccounts && !a.pendingOrders, openAccounts: a.openAccounts, pendingOrders: a.pendingOrders, qrApprovals: a.qrApprovals ?? 0, platformWaiting: a.platformWaiting ?? 0, restartable: !!this.options.canApply };
  }
  /**
   * An update was installed less than ms ago (server/year-packer.ts waits: a bad update can still be rolled back by hand to the
   * data as it was, which an older version reads only before its first year package).
   */
  installedWithin(ms: number) { const at = Date.parse(this.saved.installedAt ?? ''); return Number.isFinite(at) && this.now().getTime() - at < ms; }
  /** The owner closed the "güncellendi" / "geri alındı" note. */
  dismiss() { if (['installed', 'rolled_back', 'failed'].includes(this.saved.state)) this.set({ seen: true }); }
}
