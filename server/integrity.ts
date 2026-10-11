import { createHash, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { writeAtomic } from './key-vault.js';
import { APP_VERSION } from './license.js';
import type { IntegrityReport } from './sync-protocol.js';
import { currentPlatform, PLATFORMS, TOP_TARGETS, validVersion, verifyRelease, type ReleaseClaims, type UpdatePlatform } from './update-manifest.js';

/*
 * Program dosyaları denetimi (GELISTIRICI_REHBERI "Program dosyaları denetimi"). Finds out, never blocks.
 *
 *   npm run installer (scripts/integrity-manifest.mjs)   writes app/butunluk.json: every CODE file of the café package
 *        (app/server.mjs, nobetci.mjs, guncelleyici.mjs, package.json, dist/ html/js/css, the launchers beside app/) with its
 *        SHA-256, plus a random build id. Not the Node.js runtime, the image library, data, logs or settings.
 *   the signature                                       is the release's own: the same build's update bundle carries
 *        app/butunluk.json, and Mola Merkez signs every file's SHA-256 when the vendor uploads it ("mola-guncelleme-1",
 *        server/update-manifest.ts). So the list is trusted through the signed hash of app/butunluk.json.
 *   where the café gets that signed release            an automatic update keeps the one it installed (UpdateAgent → remember);
 *        a fresh install (or a full installer) asks Merkez once with the heartbeat (`need`), and keeps it only when its signed
 *        hash of app/butunluk.json is this very file. Kept in <guncelleme>/butunluk/, one per build: after a rollback the old
 *        program finds its own again.
 *
 * Some seconds after start, then once a day, in the background: every listed file is hashed (a few MB, well under a second)
 * and compared. A difference is checked once more a minute later (an antivirus scan, a copy in progress), then only logged
 * here (file names) and told to Merkez with the next heartbeat. Nothing at the café is locked, stopped or slowed.
 * Not a release build (npm run dev, tests, the source pilot package): runtime.ts never starts it.
 */
/**
 * Only a release build checks: pass `process.env.MOLA_RELEASE_BUILD` written out (esbuild's define in scripts/build-installer.mjs
 * turns it into "1" in the packaged server.mjs; under tsx it is unset).
 */
export const releaseBuild = (flag: string | undefined) => flag === '1';
export const INTEGRITY_FILE = 'butunluk.json';
export const INTEGRITY_FORMAT = 'mola-butunluk-1';
const SIGNED_PATH = `app/${INTEGRITY_FILE}`;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
/** app/… (forward slashes, no empty, "." or ".." part), or one of the files a release may place beside app/. */
export function programPath(path: string, platform: UpdatePlatform) {
  if (TOP_TARGETS[platform].includes(path)) return true;
  if (path.length > 200 || !/^app\/[A-Za-z0-9._@+ ()\-/]+$/.test(path)) return false;
  return path.split('/').every(part => part && part !== '.' && part !== '..');
}
export const integrityManifestSchema = z.object({
  format: z.literal(INTEGRITY_FORMAT), version: z.string().refine(validVersion), platform: z.enum(PLATFORMS), build: z.string().regex(/^[a-f0-9]{16,64}$/), builtAt: z.string().max(40),
  files: z.array(z.object({ path: z.string().max(200), sha256: sha, size: z.number().int().min(0).max(2_000_000_000) }).strict()).min(1).max(5000),
}).strict().superRefine((m, ctx) => { for (const f of m.files) if (!programPath(f.path, m.platform)) ctx.addIssue({ code: 'custom', message: `Geçersiz yol: ${f.path}` }); });
export type IntegrityManifest = z.infer<typeof integrityManifestSchema>;
type Check = { state: IntegrityReport['state']; version: string; changed: string[]; missing: string[]; signatureFailed?: boolean; manifestChanged?: boolean; need?: boolean; at: string; retry?: boolean };
export type IntegrityOptions = {
  /** The running program's app/ folder (in a package: the working folder). */
  appDir: string;
  /** Where the signed releases are kept: <guncelleme>/butunluk. */
  stateDir: string;
  /** guncelleme/: while the applier works (gunluk.json), files come and go; the check waits. */
  updateDir?: string;
  publicKey: () => KeyObject | undefined;
  platform?: UpdatePlatform; version?: string; now?: () => Date;
  /** First check after start (20 s), then every (24 h); a difference is looked at again after `confirmMs` (60 s). */
  firstDelayMs?: number; everyMs?: number; confirmMs?: number; retryMs?: number;
  log?: (line: string) => void;
};
const DAY = 86400_000;
const hashOf = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const fileKey = (m: Pick<IntegrityManifest, 'platform' | 'version' | 'build'>) => `${m.platform}-${m.version.replace(/[^0-9A-Za-z.-]/g, '_')}-${m.build}.json`;
const sameList = (a: Check, b: Check) => a.state === b.state && a.changed.join('\n') === b.changed.join('\n') && a.missing.join('\n') === b.missing.join('\n') && !!a.signatureFailed === !!b.signatureFailed && !!a.manifestChanged === !!b.manifestChanged;

export class IntegrityCheck {
  readonly platform: UpdatePlatform | undefined; readonly version: string;
  private result?: Check; private logged?: Check; private running?: Promise<Check | undefined>;
  private timers: NodeJS.Timeout[] = []; private stopped = false;
  /** Merkez answered with a release of another build of this version: not asked again before this time. */
  private otherBuildUntil = 0;
  private now: () => Date;
  constructor(private options: IntegrityOptions) {
    this.platform = 'platform' in options ? options.platform : currentPlatform();
    this.version = options.version ?? APP_VERSION;
    this.now = options.now ?? (() => new Date());
  }
  private get root() { return dirname(resolve(this.options.appDir)); }
  private log(line: string) { (this.options.log ?? (l => console.warn(l)))(`[bütünlük] ${line}`); }
  start() {
    const later = (ms: number) => { const t = setTimeout(() => void this.run(), ms); t.unref?.(); this.timers.push(t); };
    later(this.options.firstDelayMs ?? 20_000);
    const every = setInterval(() => void this.run(), this.options.everyMs ?? DAY); every.unref?.(); this.timers.push(every);
  }
  stop() { this.stopped = true; for (const t of this.timers) clearTimeout(t); this.timers = []; }

  /** One check; a difference is checked again after `confirmMs` before it counts (and is logged and reported). */
  run(): Promise<Check | undefined> {
    return this.running ??= (async () => {
      try {
        if (!this.platform || this.stopped) return undefined;
        let r = await this.check();
        if (r.state === 'changed' && !this.stopped) {
          await new Promise(done => { const t = setTimeout(done, this.options.confirmMs ?? 60_000); t.unref?.(); });
          if (this.stopped) return undefined;
          r = await this.check();
        }
        // Not now (an update is being applied, a file is held by another program): the last result stays, asked again soon.
        if (r.retry) { const t = setTimeout(() => void this.run(), this.options.retryMs ?? 10 * 60_000); t.unref?.(); this.timers.push(t); if (r.state === 'unknown' && this.result) return this.result; }
        this.result = r;
        if (r.state === 'changed' && (!this.logged || !sameList(this.logged, r))) {
          const parts = [r.changed.length && `değişen: ${r.changed.slice(0, 10).join(', ')}`, r.missing.length && `eksik: ${r.missing.slice(0, 10).join(', ')}`, r.signatureFailed && 'imzalı liste doğrulanamadı', r.manifestChanged && 'dosya listesi (butunluk.json) değişmiş'].filter(Boolean);
          this.log(`Program dosyaları ${this.version} sürümünün imzalı listesiyle uyuşmuyor (${parts.join('; ')}). Mola çalışmaya devam ediyor; Mola Merkez'e bildirilecek.`);
          this.logged = r;
        } else if (r.state === 'ok' && this.logged?.state === 'changed') { this.log('Program dosyaları yeniden imzalı listeyle aynı.'); this.logged = r; }
        return r;
      } catch (error) { this.log(`Denetim yapılamadı: ${(error as Error).message}`); return undefined; }
      finally { this.running = undefined; }
    })();
  }
  /** What the heartbeat carries (only to a Merkez that listed 'integrity'); nothing before the first check. */
  report(): IntegrityReport | undefined {
    const r = this.result; if (!r || !this.platform) return undefined;
    const need = r.need && this.now().getTime() >= this.otherBuildUntil;
    return { state: r.state, version: r.version, platform: this.platform, at: r.at, ...(r.changed.length ? { changed: r.changed.slice(0, 50) } : {}), ...(r.missing.length ? { missing: r.missing.slice(0, 50) } : {}),
      ...(r.signatureFailed ? { signatureFailed: true } : {}), ...(r.manifestChanged ? { manifestChanged: true } : {}), ...(need ? { need: true } : {}) };
  }
  /** The latest result, for tests and the owner's nothing (the café screens never show it). */
  last() { return this.result; }

  // ---------- The signed release ----------
  private readSigned(m: IntegrityManifest): unknown { try { return (JSON.parse(readFileSync(join(this.options.stateDir, fileKey(m)), 'utf8')) as { signed?: unknown }).signed; } catch { return undefined; } }
  private keep(m: IntegrityManifest, signed: unknown) {
    mkdirSync(this.options.stateDir, { recursive: true });
    writeAtomic(join(this.options.stateDir, fileKey(m)), JSON.stringify({ v: 1, version: m.version, platform: m.platform, build: m.build, keptAt: this.now().toISOString(), signed }));
    // The newest few builds are enough (the running one, the one before it for a rollback).
    try {
      const files = readdirSync(this.options.stateDir).filter(n => n.endsWith('.json')).map(n => ({ n, t: statSync(join(this.options.stateDir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
      for (const old of files.slice(6)) rmSync(join(this.options.stateDir, old.n), { force: true });
    } catch { /* tidied next time */ }
  }
  /** The signed hash of app/butunluk.json in a release, when the release is valid, ours, and of this version and platform. */
  private signedListHash(signed: unknown, m: IntegrityManifest): { hash?: string; bad?: true } {
    const key = this.options.publicKey(); if (!key) return {};
    let claims: ReleaseClaims;
    try { claims = verifyRelease(signed, key); } catch { return { bad: true }; }
    if (claims.version !== m.version || claims.platform !== m.platform) return {};
    return { hash: claims.files.find(f => f.path === SIGNED_PATH)?.sha256 };
  }
  private async local(): Promise<{ raw?: Buffer; manifest?: IntegrityManifest; error?: 'missing' | 'invalid' | 'busy' }> {
    let raw: Buffer;
    try { raw = await readFile(join(this.options.appDir, INTEGRITY_FILE)); }
    catch (e) { return { error: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'busy' }; }
    try { const m = integrityManifestSchema.safeParse(JSON.parse(raw.toString('utf8'))); return m.success ? { raw, manifest: m.data } : { raw, error: 'invalid' }; }
    catch { return { raw, error: 'invalid' }; }
  }
  /**
   * Merkez's answer to `need`: the signed release of this version and platform. Kept only when its signed hash of
   * app/butunluk.json is this very file (the same build); another build of the same version is not asked for again for a day.
   */
  async manifest(signed: unknown) {
    const { raw, manifest } = await this.local(); if (!raw || !manifest) return;
    const { hash } = this.signedListHash(signed, manifest);
    if (!hash) return;
    if (hash !== hashOf(raw)) { this.otherBuildUntil = this.now().getTime() + DAY; if (this.result) this.result = { ...this.result, need: false }; return; }
    this.keep(manifest, signed);
    await this.run();
  }
  /**
   * Otomatik güncelleme (server/update-agent.ts): the release it verified and unpacked, kept for the program in `appDir` (the
   * new app/ waiting in hazir/), so the updated program checks itself without asking Merkez.
   */
  remember(signed: unknown, appDir: string) {
    try {
      const raw = readFileSync(join(appDir, INTEGRITY_FILE)), m = integrityManifestSchema.safeParse(JSON.parse(raw.toString('utf8')));
      if (!m.success) return;
      const { hash } = this.signedListHash(signed, m.data);
      if (hash && hash === hashOf(raw)) this.keep(m.data, signed);
    } catch { /* a release from before this check (no butunluk.json): it asks Merkez after the update */ }
  }

  // ---------- The check ----------
  /** One pass over the files (exported for tests through run()). */
  async check(): Promise<Check> {
    const at = this.now().toISOString(), base = { version: this.version, changed: [] as string[], missing: [] as string[], at };
    // The applier is moving files (or will roll back): the files are not the program's yet.
    if (this.options.updateDir && existsSync(join(this.options.updateDir, 'gunluk.json'))) return { ...base, state: 'unknown', retry: true };
    const { raw, manifest, error } = await this.local();
    if (error === 'busy') return { ...base, state: 'unknown', retry: true };
    if (error || !raw || !manifest) return { ...base, state: 'changed', manifestChanged: true, ...(error === 'missing' ? { missing: [SIGNED_PATH] } : { changed: [SIGNED_PATH] }) };
    // The list of another version or computer type beside this program: not the list this program came with.
    if (manifest.version !== this.version || manifest.platform !== this.platform) return { ...base, state: 'changed', manifestChanged: true, changed: [SIGNED_PATH] };
    const signed = this.readSigned(manifest);
    if (signed === undefined) return { ...base, state: 'unknown', need: true };
    const { hash, bad } = this.signedListHash(signed, manifest);
    if (bad) return { ...base, state: 'changed', signatureFailed: true };
    if (!hash) { rmSync(join(this.options.stateDir, fileKey(manifest)), { force: true }); return { ...base, state: 'unknown', need: true }; }
    const manifestChanged = hash !== hashOf(raw);
    const changed: string[] = manifestChanged ? [SIGNED_PATH] : [], missing: string[] = []; let busy = false;
    for (const f of manifest.files) {
      const path = resolve(this.root, ...f.path.split('/'));
      // Mola.exe still open during an update: it replaces itself from Mola.exe.yeni at its next start.
      if (this.platform === 'windows' && f.path === 'Mola.exe' && existsSync(`${path}.yeni`)) continue;
      let data: Buffer;
      try { data = await readFile(path); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') missing.push(f.path); else busy = true; continue; }
      if (data.length !== f.size || hashOf(data) !== f.sha256) changed.push(f.path);
    }
    if (changed.length || missing.length) return { ...base, state: 'changed', changed, missing, ...(manifestChanged ? { manifestChanged: true } : {}) };
    // A file held by an antivirus scan or a cloud folder: no verdict now, asked again in a few minutes.
    if (busy) return { ...base, state: 'unknown', retry: true };
    return { ...base, state: 'ok' };
  }
}
