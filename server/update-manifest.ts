import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { z } from 'zod';
import { LicenseError } from './license.js';

/*
 * Otomatik güncelleme: the release format both servers share.
 *
 *   scripts/update-bundle.mjs (npm run installer)  writes one bundle per platform: a .tar.gz whose first entry is
 *                                                  mola-guncelleme.json (the unsigned bundle manifest), then app/…,
 *                                                  runtime/… (only when Node changes) and ust/… (Mola.exe and friends).
 *   Mola Merkez (server/merkez/releases.ts)         checks every file of an imported bundle against that list, then signs
 *                                                  the release manifest with its Ed25519 key under its own purpose
 *                                                  ("mola-guncelleme-1", apart from licences, pulses and contacts).
 *   café (server/update-agent.ts)                   trusts only a manifest signed by the Merkez key baked into its program,
 *                                                  for its own platform, newer than itself; then the archive's SHA-256 and
 *                                                  every extracted file's SHA-256 must match it.
 */
export const UPDATE_FORMAT = 'mola-guncelleme-1';
const DOMAIN = 'mola-guncelleme-1\n';
export const BUNDLE_FORMAT = 'mola-guncelleme-paket-1';
export const BUNDLE_MANIFEST = 'mola-guncelleme.json';
export const PLATFORMS = ['windows', 'macos-arm64', 'macos-x64', 'linux-x64'] as const;
export type UpdatePlatform = typeof PLATFORMS[number];
export const platformNames: Record<UpdatePlatform, string> = { windows: 'Windows', 'macos-arm64': 'macOS (Apple Silicon)', 'macos-x64': 'macOS (Intel)', 'linux-x64': 'Linux' };
/** This computer's package kind (the same keys as scripts/build-installer.mjs TARGETS); undefined: no package for it. */
export function currentPlatform(platform = process.platform, arch = process.arch): UpdatePlatform | undefined {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  return undefined;
}
/**
 * Files beside app/ that a release may replace, per platform (relative to the folder that holds app/). Anything else in a
 * bundle's `top` list is refused: a signed release still cannot write outside the program's own files.
 */
export const TOP_TARGETS: Record<UpdatePlatform, string[]> = {
  windows: ['Mola.exe', 'Mola-Sunucu.cmd', 'Mola-Durdur.cmd', 'Mola-Kaldir.exe', 'BENIOKU.txt'],
  'macos-arm64': ['../MacOS/Mola', '../Info.plist', 'Mola.icns'],
  'macos-x64': ['../MacOS/Mola', '../Info.plist', 'Mola.icns'],
  'linux-x64': ['mola', 'kaldir.sh', 'BENIOKU.txt', 'mola.png'],
};

// ---------- Versions ----------
const VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?$/;
export const validVersion = (v: string) => VERSION.test(v);
/** Semantic version order: 0.1.0 < 0.1.1-test < 0.1.1 < 0.2.0. Throws on anything that is not a version. */
export function compareVersions(a: string, b: string): number {
  const x = VERSION.exec(a), y = VERSION.exec(b);
  if (!x || !y) throw new Error(`Geçersiz sürüm: ${!x ? a : b}`);
  for (let i = 1; i <= 3; i++) { const d = Number(x[i]) - Number(y[i]); if (d) return Math.sign(d); }
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0;
  const p = x[4].split('.'), q = y[4].split('.');
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1; if (q[i] === undefined) return 1;
    const m = /^\d+$/.test(p[i]), n = /^\d+$/.test(q[i]);
    if (m && n) { const d = Number(p[i]) - Number(q[i]); if (d) return Math.sign(d); continue; }
    if (m !== n) return m ? -1 : 1;
    if (p[i] !== q[i]) return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}

// ---------- Manifests ----------
/** A path inside a bundle: app/…, runtime/… or ust/…, forward slashes, no empty, "." or ".." part, no drive or stream. */
export function safeBundlePath(path: string) {
  if (path.length > 300 || !/^(app|runtime|ust)\/[A-Za-z0-9._@+ ()\-/]+$/.test(path)) return false;
  return path.split('/').every(part => part && part !== '.' && part !== '..' && !part.endsWith(' ') && !part.endsWith('.'));
}
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const fileEntry = z.object({ path: z.string().max(300).refine(safeBundlePath, 'Dosya yolu geçersiz.'), sha256: sha, size: z.number().int().min(0).max(1_000_000_000), mode: z.number().int().min(0).max(0o777).optional() }).strict();
const topEntry = z.object({ file: z.string().max(300).refine(p => p.startsWith('ust/') && safeBundlePath(p)), target: z.string().max(100) }).strict();
const dataFormat = z.object({ minReadable: z.number().int().min(0).max(1000), maxReadable: z.number().int().min(0).max(1000), writeVersion: z.number().int().min(0).max(1000) }).strict();
const version = z.string().refine(validVersion, 'Sürüm geçersiz (ör. 0.1.1).');
const notes = z.string().trim().max(600).regex(/^[^\u0000-\u0008\u000b-\u001f<>]*$/, 'Notta kullanılamayan karakter var.');
const bundleFields = {
  version, platform: z.enum(PLATFORMS), node: z.string().regex(/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/), runtime: z.boolean(), minFrom: version, data: dataFormat, notes, builtAt: z.string().max(40),
  files: z.array(fileEntry).min(1).max(20000), top: z.array(topEntry).max(20),
};
/** The manifest inside a bundle, as scripts/update-bundle.mjs writes it (not signed: Mola Merkez signs on import). */
export const bundleManifestSchema = z.object({ format: z.literal(BUNDLE_FORMAT), ...bundleFields }).strict().superRefine((m, ctx) => {
  const seen = new Set<string>();
  for (const f of m.files) { const k = f.path.toLowerCase(); if (seen.has(k)) ctx.addIssue({ code: 'custom', message: `Aynı dosya iki kez: ${f.path}` }); seen.add(k); }
  if (!m.files.some(f => f.path === 'app/server.mjs') || !m.files.some(f => f.path === 'app/manifest.json')) ctx.addIssue({ code: 'custom', message: 'Pakette app/server.mjs ya da app/manifest.json yok.' });
  if (m.runtime !== m.files.some(f => f.path.startsWith('runtime/'))) ctx.addIssue({ code: 'custom', message: 'Çalışma ortamı (runtime) bilgisi dosya listesiyle uyuşmuyor.' });
  for (const t of m.top) {
    if (!TOP_TARGETS[m.platform].includes(t.target)) ctx.addIssue({ code: 'custom', message: `Bu platformda değiştirilemeyen dosya: ${t.target}` });
    if (!m.files.some(f => f.path === t.file)) ctx.addIssue({ code: 'custom', message: `Listede olmayan dosya: ${t.file}` });
  }
  if (compareVersions(m.minFrom, m.version) > 0) ctx.addIssue({ code: 'custom', message: 'En eski sürüm, paketin kendi sürümünden yeni olamaz.' });
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;
export type ReleaseClaims = Omit<BundleManifest, 'format'> & { v: 1; id: string; signedAt: string; archive: { sha256: string; size: number } };
const claimsSchema = z.object({ v: z.literal(1), id: z.string().regex(/^[a-z0-9-]{8,40}$/), signedAt: z.string().max(40), archive: z.object({ sha256: sha, size: z.number().int().min(1).max(2_000_000_000) }).strict(), ...bundleFields }).strict();
export type SignedRelease = { format: typeof UPDATE_FORMAT; payload: string; signature: string };
export function signRelease(claims: ReleaseClaims, key: KeyObject): SignedRelease {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return { format: UPDATE_FORMAT, payload, signature: sign(null, Buffer.from(DOMAIN + payload), key).toString('base64url') };
}
/** Throws LicenseError for anything our key did not sign under this purpose, or not in the release shape. */
export function verifyRelease(signed: unknown, key: KeyObject): ReleaseClaims {
  const parsed = z.object({ format: z.literal(UPDATE_FORMAT), payload: z.string().min(10).max(8_000_000).regex(/^[A-Za-z0-9_-]+$/), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict().safeParse(signed);
  if (!parsed.success) throw new LicenseError('Güncelleme bilgisi biçimi geçersiz.');
  let ok = false;
  try { ok = verify(null, Buffer.from(DOMAIN + parsed.data.payload), key, Buffer.from(parsed.data.signature, 'base64url')); } catch { ok = false; }
  if (!ok) throw new LicenseError('Güncelleme imzası geçersiz: bu sürüm Mola Merkez’in anahtarıyla imzalanmamış.');
  let body: unknown; try { body = JSON.parse(Buffer.from(parsed.data.payload, 'base64url').toString('utf8')); } catch { throw new LicenseError('Güncelleme bilgisi okunamadı.'); }
  const claims = claimsSchema.safeParse(body);
  if (!claims.success) throw new LicenseError('Güncelleme bilgisi içeriği geçersiz.');
  const again = bundleManifestSchema.safeParse({ format: BUNDLE_FORMAT, ...Object.fromEntries(Object.entries(claims.data).filter(([k]) => k in bundleFields)) });
  if (!again.success) throw new LicenseError('Güncelleme dosya listesi geçersiz.');
  return claims.data as ReleaseClaims;
}

// ---------- tar (ustar with prefix, GNU long names, pax paths), streaming ----------
export type TarHeader = { name: string; type: string; size: number; mode: number };
export type TarSink = { data(chunk: Buffer): void | Promise<void>; end(): void | Promise<void> };
/**
 * Reads a tar stream entry by entry without keeping it in memory. `entry` returns where an entry's bytes go (or undefined
 * to skip them). Only regular files ('0') and folders ('5') are passed on; anything else (links, devices) throws.
 */
export async function readTar(source: AsyncIterable<Buffer>, entry: (h: TarHeader) => TarSink | undefined | Promise<TarSink | undefined>) {
  let buffer = Buffer.alloc(0), longName: string | undefined, paxName: string | undefined, ended = false;
  let body: { left: number; pad: number; sink?: TarSink; meta?: 'L' | 'x'; collected?: Buffer[] } | undefined;
  for await (const raw of source) {
    buffer = buffer.length ? Buffer.concat([buffer, raw]) : Buffer.from(raw);
    for (;;) {
      if (ended) { buffer = Buffer.alloc(0); break; }
      if (body) {
        if (body.left > 0) {
          if (!buffer.length) break;
          const take = buffer.subarray(0, Math.min(body.left, buffer.length)); buffer = buffer.subarray(take.length); body.left -= take.length;
          if (body.meta) body.collected!.push(Buffer.from(take)); else if (body.sink) await body.sink.data(take);
          if (body.left > 0) break;
        }
        if (buffer.length < body.pad) break;
        buffer = buffer.subarray(body.pad);
        if (body.meta) {
          const text = Buffer.concat(body.collected!).toString('utf8');
          if (body.meta === 'L') longName = text.replace(/\0[\s\S]*$/, ''); else paxName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text)?.[1];
        } else if (body.sink) await body.sink.end();
        body = undefined; continue;
      }
      if (buffer.length < 512) break;
      const h = buffer.subarray(0, 512); buffer = buffer.subarray(512);
      if (h.every(b => b === 0)) { ended = true; continue; }
      const field = (start: number, end: number) => h.subarray(start, end).toString('utf8').replace(/\0[\s\S]*$/, '');
      const sum = parseInt(field(148, 156).trim() || '0', 8);
      let check = 0; for (let i = 0; i < 512; i++) check += i >= 148 && i < 156 ? 32 : h[i];
      if (sum !== check) throw new Error('Arşiv bozuk (başlık özeti tutmuyor).');
      let name = field(0, 100); const prefix = field(345, 500); if (prefix && field(257, 263).startsWith('ustar')) name = `${prefix}/${name}`;
      const size = parseInt(field(124, 136).trim() || '0', 8), mode = parseInt(field(100, 108).trim() || '644', 8) & 0o777, type = String.fromCharCode(h[156] || 48);
      if (!Number.isFinite(size) || size < 0) throw new Error('Arşiv bozuk (boyut).');
      const pad = (512 - (size % 512)) % 512;
      if (type === 'L' || type === 'x') { if (size > 65536) throw new Error('Arşiv bozuk (uzun ad).'); body = { left: size, pad, meta: type, collected: [] }; continue; }
      if (type === 'g') { body = { left: size, pad }; continue; }
      if (longName) { name = longName; longName = undefined; } if (paxName) { name = paxName; paxName = undefined; }
      if (type !== '0' && type !== '5') throw new Error(`Arşivde desteklenmeyen kayıt: ${name}`);
      const sink = await entry({ name, type, size, mode });
      body = { left: size, pad, sink };
      if (size === 0 && !pad) { if (sink) await sink.end(); body = undefined; }
    }
  }
  if (body) throw new Error('Arşiv yarım kalmış.');
}
/** The decompressed bytes of a .tar.gz file, for readTar. */
export function gunzipFile(path: string): AsyncIterable<Buffer> { return createReadStream(path).pipe(createGunzip()); }
export async function fileSha256(path: string) {
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk as Buffer); size += (chunk as Buffer).length; }
  return { sha256: hash.digest('hex'), size };
}
