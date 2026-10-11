import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { MERKEZ_API, type SyncRequest, type UpdateOffer } from '../sync-protocol.js';
import { BUNDLE_MANIFEST, bundleManifestSchema, compareVersions, fileSha256, gunzipFile, platformNames, readTar, signRelease, type BundleManifest, type SignedRelease, type UpdatePlatform } from '../update-manifest.js';
import { addAlert } from './alerts.js';
import type { ReleaseRight } from './step-up.js';
import type { Install, MerkezData, MerkezStore } from './store.js';

/*
 * Otomatik güncelleme, Mola Merkez's side (GELISTIRICI_REHBERI "Otomatik güncelleme").
 *   Mola Yönetim → Ayarlar → Güncellemeler   the vendor uploads a bundle from `npm run installer` (…/Guncelleme/*.mola-guncelleme);
 *                                            every file is checked against the bundle's list, then the release manifest is
 *                                            signed with Merkez's key ("mola-guncelleme-1"). Nothing is offered until the vendor
 *                                            chooses "Herkese yayınla" or "Önce pilot işletmelere"; "Durdur" takes it back.
 *                                            Upload, publish, Durdur, Sil and editing the note (it signs the release again) need
 *                                            the Güncelleme yetkisi (server/merkez/step-up.ts:
 *                                            a fresh Authenticator code, 10 minutes; two-step login must be on).
 *   heartbeat (/sync)                        a café that sends its update state hears which release is for it (or null).
 *   /releases/:id/manifest, /releases/:id/paket  HMAC-signed like /sync, only for a café the release is offered to; the archive
 *                                            with Range (resume), limited per install.
 * Bundles live beside the data folder (merkez-guncellemeler/); the records in merkez.sqlite (tables releases, update_status).
 * Mola Yönetim itself is not updated this way: the vendor runs the new "Mola Yönetim Kurulum.exe".
 */
export type Rollout = { mode: 'off' | 'pilot' | 'all'; pilot: string[]; changedAt?: string };
export type Release = {
  id: string; version: string; platform: UpdatePlatform; notes: string; size: number; sha256: string; node: string; runtime: boolean; minFrom: string;
  data: BundleManifest['data']; files: number; builtAt: string; importedAt: string; signed: SignedRelease; rollout: Rollout;
};
export type UpdateReport = NonNullable<SyncRequest['update']>;
export type CafeUpdate = UpdateReport & { receivedAt: string };
const MAX_UPLOAD = 600 * 1024 * 1024, MAX_MANIFEST = 8 * 1024 * 1024, NOTES_MAX = 600;
/**
 * The note to the café owner is plain text: any letter or sign (<, >, &, quotes) is fine and every screen shows it as text.
 * Only invisible control characters are dropped (a pasted line break stays). Cafés already installed check signed notes
 * without < and > (server/update-manifest.ts): the signed copy carries ‹ › in their place, the screens keep the text as written.
 */
export function releaseNotes(raw: string) {
  const text = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if (text.length > NOTES_MAX) throw new DomainError('NOTES_TOO_LONG', `Not en fazla ${NOTES_MAX} karakter olabilir (şu an ${text.length}). Kısaltıp yeniden kaydedin.`, 400);
  return text;
}
const signedNotes = (text: string) => text.replace(/</g, '‹').replace(/>/g, '›');

export class Releases {
  constructor(private store: MerkezStore, readonly directory: string) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS releases (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS update_status (install TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
  }
  list(): Release[] { return (this.store.db.prepare('SELECT payload FROM releases').all() as { payload: string }[]).map(r => JSON.parse(r.payload) as Release).sort((a, b) => compareVersions(b.version, a.version) || a.platform.localeCompare(b.platform)); }
  get(id: string) { const r = this.store.db.prepare('SELECT payload FROM releases WHERE id=?').get(id) as { payload: string } | undefined; return r ? JSON.parse(r.payload) as Release : undefined; }
  private save(r: Release) { this.store.db.prepare('INSERT INTO releases VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(r.id, JSON.stringify(r)); }
  file(id: string) { return join(this.directory, `${id}.tar.gz`); }
  status(install: string): CafeUpdate | undefined { const r = this.store.db.prepare('SELECT payload FROM update_status WHERE install=?').get(install) as { payload: string } | undefined; return r ? JSON.parse(r.payload) : undefined; }

  /** Checks every file of an uploaded bundle against its own list and signs it. The upload file is moved or deleted. */
  async importBundle(upload: string, now: Date): Promise<Release> {
    try {
      const archive = await fileSha256(upload);
      let manifest: BundleManifest | undefined, first = true;
      const wanted = new Map<string, { sha256: string; size: number }>(), seen = new Set<string>();
      await readTar(gunzipFile(upload), header => {
        if (first) {
          first = false;
          if (header.name !== BUNDLE_MANIFEST || header.type !== '0' || header.size > MAX_MANIFEST) throw new DomainError('BUNDLE_INVALID', 'Bu dosya bir Mola güncelleme paketi değil (…/Guncelleme/*.mola-guncelleme seçin).', 400);
          const parts: Buffer[] = [];
          return { data: c => { parts.push(Buffer.from(c)); }, end: () => {
            let parsed: unknown; try { parsed = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new DomainError('BUNDLE_INVALID', 'Paketin bilgi dosyası okunamadı.', 400); }
            const m = bundleManifestSchema.safeParse(parsed);
            if (!m.success) throw new DomainError('BUNDLE_INVALID', `Paket bilgisi geçersiz: ${m.error.issues[0]?.message ?? ''}`, 400);
            manifest = m.data; for (const f of manifest.files) wanted.set(f.path, { sha256: f.sha256, size: f.size });
          } };
        }
        if (header.type === '5') return undefined;
        const want = wanted.get(header.name);
        if (!want || seen.has(header.name)) throw new DomainError('BUNDLE_INVALID', `Pakette listede olmayan dosya var: ${header.name}`, 400);
        seen.add(header.name);
        const hash = createHash('sha256'); let size = 0;
        return { data: c => { hash.update(c); size += c.length; }, end: () => { if (size !== want.size || hash.digest('hex') !== want.sha256) throw new DomainError('BUNDLE_INVALID', `Paket bozuk: ${header.name} listedeki özetle uyuşmuyor.`, 400); } };
      }).catch(error => { if (error instanceof DomainError) throw error; throw new DomainError('BUNDLE_INVALID', `Paket okunamadı (bozuk ya da yarım): ${(error as Error).message}`, 400); });
      if (!manifest) throw new DomainError('BUNDLE_INVALID', 'Bu dosya bir Mola güncelleme paketi değil.', 400);
      const missing = manifest.files.find(f => !seen.has(f.path));
      if (missing) throw new DomainError('BUNDLE_INVALID', `Pakette eksik dosya: ${missing.path}`, 400);
      const m = manifest;
      if (this.list().some(r => r.platform === m.platform && r.version === m.version)) throw new DomainError('RELEASE_EXISTS', `${m.version} (${platformNames[m.platform]}) zaten yüklü. Önce eskisini silin.`, 409);
      const id = `${m.platform}-${randomBytes(4).toString('hex')}`;
      const { format: _format, ...fields } = m;
      const at = now.toISOString(), signed = signRelease({ ...fields, v: 1, id, signedAt: at, archive: { sha256: archive.sha256, size: archive.size } }, this.store.signingKey);
      mkdirSync(this.directory, { recursive: true });
      renameSync(upload, this.file(id));
      const release: Release = { id, version: m.version, platform: m.platform, notes: m.notes, size: archive.size, sha256: archive.sha256, node: m.node, runtime: m.runtime, minFrom: m.minFrom, data: m.data, files: m.files.length, builtAt: m.builtAt, importedAt: at, signed, rollout: { mode: 'off', pilot: [] } };
      this.save(release);
      return release;
    } finally { rmSync(upload, { force: true }); }
  }
  /** New notes mean a new signature (the archive and its files stay the same). */
  setNotes(id: string, notes: string, now: Date) {
    const r = this.need(id), text = releaseNotes(notes);
    const claims = JSON.parse(Buffer.from(r.signed.payload, 'base64url').toString('utf8'));
    r.notes = text; r.signed = signRelease({ ...claims, notes: signedNotes(text), signedAt: now.toISOString() }, this.store.signingKey); this.save(r); return r;
  }
  setRollout(id: string, mode: Rollout['mode'], pilot: string[], now: Date) { const r = this.need(id); r.rollout = { mode, pilot: mode === 'pilot' ? [...new Set(pilot)] : r.rollout.pilot, changedAt: now.toISOString() }; this.save(r); return r; }
  remove(id: string) {
    const r = this.need(id);
    if (r.rollout.mode !== 'off') throw new DomainError('RELEASE_LIVE', 'Yayındaki sürüm silinemez. Önce “Durdur”.', 409);
    rmSync(this.file(id), { force: true }); this.store.db.prepare('DELETE FROM releases WHERE id=?').run(id); return r;
  }
  private need(id: string) { const r = this.get(id); if (!r) throw new DomainError('NOT_FOUND', 'Sürüm bulunamadı.', 404); return r; }

  /** Is this release offered to this install now (published to all, or a pilot business of it)? */
  offeredTo(r: Release, tenants: string[]) { return r.rollout.mode === 'all' || (r.rollout.mode === 'pilot' && tenants.some(t => r.rollout.pilot.includes(t))); }
  /**
   * The release for a café: its platform, published to it, newer than what it runs and not needing a newer starting point
   * (minFrom: older cafés need the full installer). The newest of those, or null. Older cafés (no update report): undefined.
   */
  offer(report: UpdateReport | undefined, appVersion: string, tenants: string[]): UpdateOffer | null | undefined {
    if (!report) return undefined;
    let best: Release | undefined;
    for (const r of this.list()) {
      try {
        if (r.platform !== report.platform || !this.offeredTo(r, tenants) || compareVersions(r.version, appVersion) <= 0 || compareVersions(appVersion, r.minFrom) < 0) continue;
        if (!best || compareVersions(r.version, best.version) > 0) best = r;
      } catch { /* not a version: nothing offered */ }
    }
    return best ? { id: best.id, version: best.version, size: best.size, notes: best.notes } : null;
  }
  /** The café's update state from its heartbeat; a failure or a rollback becomes an alert (once per version and outcome). */
  record(d: MerkezData, install: Install, report: UpdateReport | undefined, names: string, tenantId: string | undefined, time: string) {
    if (!report) return;
    const before = this.status(install.id);
    this.store.db.prepare('INSERT INTO update_status VALUES (?,?) ON CONFLICT(install) DO UPDATE SET payload=excluded.payload').run(install.id, JSON.stringify({ ...report, receivedAt: time } satisfies CafeUpdate));
    if ((report.state === 'failed' || report.state === 'rolled_back') && (before?.state !== report.state || before.version !== report.version)) {
      const what = report.state === 'rolled_back' ? 'yeni sürüm açılamadı, önceki sürüme kendiliğinden dönüldü (veriler yerinde)' : 'güncelleme hazırlanamadı';
      addAlert(d, time, 'update.failed', `${names}: ${report.version ?? 'yeni sürüm'} — ${what}.${report.error ? ` Neden: ${report.error}` : ''}`, { ...(tenantId ? { tenantId } : {}), key: `update:${install.id}:${report.version ?? ''}:${report.state}:${report.at}` });
    }
  }
  /** For Mola Yönetim: every activated business with its computer's version and update state. */
  cafes(d: MerkezData) {
    return d.businesses.filter(b => b.installId).map(b => {
      const install = d.installs.find(i => i.id === b.installId);
      return { tenantId: b.tenantId, name: b.name, installId: b.installId!, appVersion: install?.appVersion ?? '', lastSeenAt: install?.lastSeenAt ?? null, update: install ? this.status(install.id) ?? null : null };
    });
  }
}

type Deps = {
  store: MerkezStore; releases: Releases; now: () => Date; admin: (req: Request) => unknown;
  /** Güncelleme yetkisi (server/merkez/step-up.ts): a fresh Authenticator code before upload, publish, Durdur, Sil, note edit. */
  right: ReleaseRight;
  authenticate: (req: Request) => { install: Install; closed: boolean };
  limitAddress: (req: Request, purpose: string, max: number, ms: number) => void; limitInstall: (install: string, purpose: string, max: number, ms: number) => void;
};
/** The upload: raw bytes (not JSON), so it is registered before the JSON-only rule of /api. */
export function releaseUploadRoute(app: Express, deps: () => Deps) {
  app.post('/api/merkez/admin/releases/upload', async (req: Request, res: Response) => {
    const { admin, releases, now, store, right } = deps();
    // Checked before a single byte is kept: without the Güncelleme yetkisi nothing is received.
    right.require(admin(req));
    const length = Number(req.get('content-length') ?? 0);
    if (length > MAX_UPLOAD) throw new DomainError('TOO_LARGE', 'Paket çok büyük.', 413);
    mkdirSync(releases.directory, { recursive: true });
    const upload = join(releases.directory, `yukleme-${randomBytes(6).toString('hex')}.part`);
    let received = 0;
    try {
      await pipeline(req, async function* (source) { for await (const chunk of source) { received += (chunk as Buffer).length; if (received > MAX_UPLOAD) throw new DomainError('TOO_LARGE', 'Paket çok büyük.', 413); yield chunk; } }, createWriteStream(upload, { flags: 'wx' }));
    } catch (error) { rmSync(upload, { force: true }); throw error; }
    if (!received) { rmSync(upload, { force: true }); throw new DomainError('BUNDLE_INVALID', 'Dosya boş.', 400); }
    const release = await releases.importBundle(upload, now());
    store.mutate(d => { d.audit.push({ action: 'release.imported', target: 'admin', at: now().toISOString(), by: 'admin', detail: `${release.version} · ${platformNames[release.platform]}` }); });
    res.json({ release: summary(release) });
  });
}
const summary = ({ signed: _signed, ...r }: Release) => r;
export function releaseRoutes(app: Express, deps: Deps) {
  const { store, releases, now, admin, authenticate, right } = deps;
  const audit = (action: string, r: Release, detail?: string) => store.mutate(d => { d.audit.push({ action, target: 'admin', at: now().toISOString(), by: 'admin', detail: `${r.version} · ${platformNames[r.platform]}${detail ? ` · ${detail}` : ''}` }); });
  app.get('/api/merkez/admin/releases', (req, res) => { const who = admin(req), d = store.read(); res.json({ releases: releases.list().map(summary), cafes: releases.cafes(d), right: right.status(who) }); });
  // Güncelleme yetkisi: the current Authenticator code opens 10 minutes for this session (or this access key).
  app.post('/api/merkez/admin/releases/yetki', (req, res) => {
    const who = admin(req), b = z.object({ code: z.string().max(16) }).strict().parse(req.body);
    res.json({ until: right.open(req, who, b.code), right: right.status(who) });
  });
  app.post('/api/merkez/admin/releases/yetki/kapat', (req, res) => { const who = admin(req); right.end(who); res.json({ right: right.status(who) }); });
  app.post('/api/merkez/admin/releases/notes', (req, res) => {
    // A new note is signed again with Merkez's key, so it needs the Güncelleme yetkisi like publishing does.
    // The length is checked by releaseNotes, which says it in words (not "Alanları kontrol edin").
    right.require(admin(req)); const b = z.object({ id: z.string().max(60), notes: z.string().max(8000) }).strict().parse(req.body);
    const before = releases.get(b.id)?.notes ?? '', r = releases.setNotes(b.id, b.notes, now());
    if (before !== r.notes) store.mutate(d => { d.audit.push({ action: 'release.notes', target: 'admin', at: now().toISOString(), by: 'admin', detail: `${r.version} · ${platformNames[r.platform]}`, changes: [{ field: 'not', from: before || '—', to: r.notes || '—' }] }); });
    res.json({ release: summary(r) });
  });
  app.post('/api/merkez/admin/releases/rollout', (req, res) => {
    right.require(admin(req)); const b = z.object({ id: z.string().max(60), mode: z.enum(['off', 'pilot', 'all']), pilot: z.array(z.string().max(100)).max(500).optional() }).strict().parse(req.body);
    const d = store.read(), pilot = (b.pilot ?? []).filter(t => d.businesses.some(x => x.tenantId === t && x.installId));
    if (b.mode === 'pilot' && !pilot.length) throw new DomainError('PILOT_EMPTY', 'Pilot için en az bir (etkinleşmiş) işletme seçin.', 400);
    const r = releases.setRollout(b.id, b.mode, pilot, now());
    audit(b.mode === 'all' ? 'release.published' : b.mode === 'pilot' ? 'release.pilot' : 'release.stopped', r, b.mode === 'pilot' ? `${pilot.length} işletme` : undefined);
    res.json({ release: summary(r) });
  });
  app.post('/api/merkez/admin/releases/delete', (req, res) => {
    right.require(admin(req)); const b = z.object({ id: z.string().max(60) }).strict().parse(req.body);
    const r = releases.remove(b.id); audit('release.deleted', r); res.json({ ok: true });
  });
  /** A café the release is offered to (signed request); 404 for anyone else, as if it did not exist. */
  function offered(req: Request) {
    deps.limitAddress(req, 'release', 240, 60_000);
    const { install, closed } = authenticate(req);
    deps.limitInstall(install.id, 'release', 600, 3600_000);
    const r = releases.get(String(req.params.id)), d = store.read(), tenants = d.businesses.filter(b => b.installId === install.id).map(b => b.tenantId);
    if (closed || !r || !releases.offeredTo(r, tenants) || !existsSync(releases.file(r.id))) throw new DomainError('NOT_FOUND', 'Sürüm bulunamadı.', 404);
    return r;
  }
  app.get(`${MERKEZ_API}/releases/:id/manifest`, (req, res) => { const r = offered(req); res.json({ release: r.signed }); });
  app.get(`${MERKEZ_API}/releases/:id/paket`, (req, res) => {
    const r = offered(req), file = releases.file(r.id), size = statSync(file).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.get('range') ?? '');
    let start = 0, end = size - 1;
    if (range) {
      start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) { res.status(416).set('Content-Range', `bytes */${size}`).end(); return; }
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.set({ 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) });
    const stream = createReadStream(file, { start, end });
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}
