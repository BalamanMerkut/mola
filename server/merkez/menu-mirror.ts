import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express, type Request, type Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { mirrorFiles, MIRROR_FILE, type MirrorMenu } from '../../packages/domain/menu-mirror.js';
import { open, seal } from '../sealing.js';
import { MERKEZ_API } from '../sync-protocol.js';
import type { Install, MerkezStore } from './store.js';

/*
 * Menünün Mola Merkez'deki kopyası, Merkez's end (shape: packages/domain/menu-mirror.ts; the café's end: server/menu-mirror.ts).
 * What is kept: each business's public menu as its café last sent it (names, prices, campaigns, "tükendi", look, social
 * links, table names with the SHA-256 of their QR tokens) and its product photos. Nothing else: no sales, no orders, no
 * guests, no staff. The copy lets Merkez answer the guest menu while the café cannot be reached (server/merkez/guest-tunnel.ts).
 *   - The copy: merkez.sqlite table `menu_kopyalari`, one sealed row per business (key derived from Merkez's data key).
 *   - Photos: beside the data folder (`<data>-menu/`), each file sealed (AES-256-GCM, bound to its business and SHA-256);
 *     uploaded once per SHA-256; a photo the copy no longer names is deleted at once. Per business at most MENU_PHOTOS_MB
 *     (default 64 MB); Merkez takes no more while the disk has less than MERKEZ_MENU_BOS_MB (default 1024 MB) free.
 *   - Merkez's own nightly backup holds the sealed copy (it is in merkez.sqlite) but not the photo files: after a restore
 *     `put` asks for every photo whose file is missing, and the cafés send them when their tunnel reconnects.
 *   - Deleted with the business record ("Kaydı sil": forget).
 */
const MB = 1024 * 1024;
export const MENU_PHOTO_MAX = 2 * MB;
type Row = { tenant: string; install: string; updated: number; bytes: number; payload: Uint8Array };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
/** WebP only (the café writes product photos as WebP). */
const isWebp = (b: Buffer) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
const product = z.object({ id: z.string().min(1).max(100), name: z.string().max(200), price: z.number().int().min(0).max(100_000_000), photo: z.string().max(300).nullable().optional() }).passthrough();
const menuSchema = z.object({
  v: z.literal(1), name: z.string().min(1).max(200), menuOnly: z.boolean(), changeSeconds: z.number().int().min(0).max(86_400), menuRevision: z.number().int().min(0),
  categories: z.array(z.string().max(120)).max(300), subcategories: z.array(z.object({ category: z.string().max(120), names: z.array(z.string().max(120)).max(300) }).passthrough()).max(300),
  popularProductIds: z.array(z.string().max(100)).max(100), products: z.array(product).max(2000), campaigns: z.array(z.object({ id: z.string().max(100) }).passthrough()).max(500),
  campaignUsage: z.record(z.string().max(100), z.number().int().min(0)), tables: z.array(z.object({ h: z.string().regex(/^[a-f0-9]{40}$/), name: z.string().max(120) }).strict()).max(1000),
  // Rezerve masada QR (12 Ekim): when each held table's QR is closed (hash, instants, "20:00"; nothing about the guest).
  reserved: z.array(z.object({ h: z.string().regex(/^[a-f0-9]{40}$/), from: z.string().datetime(), until: z.string().datetime(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict()).max(2000).optional(),
  photos: z.record(z.string().regex(MIRROR_FILE), z.string().regex(/^[a-f0-9]{64}$/)),
  logo: z.string().max(48_000).regex(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/).optional(),
}).passthrough();

export class MenuMirrorStore {
  private key: Buffer; private cache = new Map<string, { updated: number; menu: MirrorMenu }>();
  maxPerBusiness = Number(process.env.MERKEZ_MENU_MB ?? 64) * MB; minFree = Number(process.env.MERKEZ_MENU_BOS_MB ?? 1024) * MB;
  constructor(private store: MerkezStore, readonly directory: string) {
    this.key = store.subkey('menu-kopyasi');
    store.db.exec(`CREATE TABLE IF NOT EXISTS menu_kopyalari (tenant TEXT PRIMARY KEY, install TEXT NOT NULL, updated INTEGER NOT NULL, bytes INTEGER NOT NULL, payload BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS menu_fotolari (tenant TEXT NOT NULL, sha TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (tenant, sha));`);
  }
  /** A business's own folder name: never the id itself (it may hold characters a file system dislikes). */
  private folder(tenant: string) { return join(this.directory, createHmac('sha256', this.key).update(`klasor:${tenant}`).digest('hex').slice(0, 24)); }
  private file(tenant: string, hash: string) { return join(this.folder(tenant), `${hash}.foto`); }
  private sealBytes(plain: Buffer, scope: string) { const nonce = randomBytes(12), c = createCipheriv('aes-256-gcm', this.key, nonce); c.setAAD(Buffer.from(`mola:v1:menu-foto:${scope}`)); const body = Buffer.concat([c.update(plain), c.final()]); return Buffer.concat([nonce, c.getAuthTag(), body]); }
  private openBytes(data: Buffer, scope: string) { const c = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12)); c.setAAD(Buffer.from(`mola:v1:menu-foto:${scope}`)); c.setAuthTag(data.subarray(12, 28)); return Buffer.concat([c.update(data.subarray(28)), c.final()]); }
  /** The copy as the café last sent it (undefined: none yet, an older café). */
  get(tenant: string): MirrorMenu | undefined {
    const row = this.store.db.prepare('SELECT tenant, install, updated, bytes, payload FROM menu_kopyalari WHERE tenant=?').get(tenant) as Row | undefined;
    if (!row) { this.cache.delete(tenant); return undefined; }
    const kept = this.cache.get(tenant); if (kept && kept.updated === row.updated) return kept.menu;
    try { const menu = open<MirrorMenu>(Buffer.from(row.payload), this.key, `menu:${tenant}`); this.cache.set(tenant, { updated: row.updated, menu }); return menu; } catch { return undefined; }
  }
  /** Mola Yönetim: when the copy came, how many products and photos, how much space. */
  usage(tenant: string) {
    const row = this.store.db.prepare('SELECT updated, bytes FROM menu_kopyalari WHERE tenant=?').get(tenant) as { updated: number; bytes: number } | undefined;
    if (!row) return undefined;
    const photos = this.store.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM menu_fotolari WHERE tenant=?').get(tenant) as { n: number; bytes: number };
    return { updatedAt: new Date(row.updated).toISOString(), products: this.get(tenant)?.products.length ?? 0, photos: photos.n, bytes: row.bytes + photos.bytes };
  }
  /** A new copy from the café: kept; photos it no longer names go; the answer lists the photos still missing here. */
  put(install: Install, tenant: string, raw: unknown, now: Date): { need: string[] } {
    const parsed = menuSchema.safeParse(raw);
    if (!parsed.success) throw new DomainError('INVALID_MENU', 'Menü kopyası okunamadı.', 400);
    const menu = parsed.data as unknown as MirrorMenu;
    // Product photos only under this business's own /media path; anything else is dropped (the guest sees the drawing).
    for (const p of menu.products) if (p.photo && !new RegExp(`^/media/${tenant.replace(/[^a-zA-Z0-9_-]/g, '')}/[a-f0-9-]{36}\\.webp$`).test(p.photo)) p.photo = null;
    const text = JSON.stringify(menu);
    this.store.db.prepare('INSERT INTO menu_kopyalari (tenant, install, updated, bytes, payload) VALUES (?,?,?,?,?) ON CONFLICT(tenant) DO UPDATE SET install=excluded.install, updated=excluded.updated, bytes=excluded.bytes, payload=excluded.payload')
      .run(tenant, install.id, Math.max(now.getTime(), ((this.store.db.prepare('SELECT updated FROM menu_kopyalari WHERE tenant=?').get(tenant) as { updated: number } | undefined)?.updated ?? 0) + 1), Buffer.byteLength(text), seal(menu, this.key, `menu:${tenant}`));
    const wanted = new Set(mirrorFiles(menu).map(([, h]) => h));
    // Old photos (no longer in the copy) go now: Merkez keeps only what the menu shows.
    for (const { sha: h } of this.store.db.prepare('SELECT sha FROM menu_fotolari WHERE tenant=?').all(tenant) as { sha: string }[]) if (!wanted.has(h)) this.drop(tenant, h);
    const have = new Set((this.store.db.prepare('SELECT sha FROM menu_fotolari WHERE tenant=?').all(tenant) as { sha: string }[]).filter(r => existsSync(this.file(tenant, r.sha))).map(r => r.sha));
    return { need: [...wanted].filter(h => !have.has(h)) };
  }
  /** One photo's bytes (the café sends each SHA-256 once): it must be one the copy names, WebP, within the limits. */
  putPhoto(tenant: string, hash: string, bytes: Buffer, now: Date) {
    const menu = this.get(tenant);
    if (!menu || !mirrorFiles(menu).some(([, h]) => h === hash)) throw new DomainError('PHOTO_NOT_IN_MENU', 'Bu fotoğraf menüde yok.', 409);
    if (!bytes.length || bytes.length > MENU_PHOTO_MAX || !isWebp(bytes) || sha(bytes) !== hash) throw new DomainError('INVALID_PHOTO', 'Fotoğraf okunamadı.', 400);
    const used = (this.store.db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM menu_fotolari WHERE tenant=? AND sha<>?').get(tenant, hash) as { bytes: number }).bytes;
    if (used + bytes.length > this.maxPerBusiness) throw new DomainError('MENU_SPACE', 'Bu işletmenin menü fotoğrafları için Mola Merkez’deki yer doldu.', 507);
    mkdirSync(this.folder(tenant), { recursive: true });
    let free = Infinity; try { const s = statfsSync(this.directory); free = Number(s.bavail) * Number(s.bsize); } catch { /* unknown */ }
    if (free - bytes.length < this.minFree) throw new DomainError('MENU_SPACE', 'Mola Merkez’de menü fotoğrafları için yer kalmadı.', 507);
    const path = this.file(tenant, hash), part = `${path}.${randomBytes(4).toString('hex')}.part`;
    writeFileSync(part, this.sealBytes(bytes, `${tenant}:${hash}`), { mode: 0o600 }); renameSync(part, path);
    this.store.db.prepare('INSERT OR REPLACE INTO menu_fotolari (tenant, sha, size, created) VALUES (?,?,?,?)').run(tenant, hash, bytes.length, now.getTime());
    return { ok: true };
  }
  /** `/media/<işletme>/<file>` for the guest page: the photo of that name in the copy, when Merkez has its bytes. */
  photo(tenant: string, name: string): { body: Buffer; etag: string } | undefined {
    const hash = this.get(tenant)?.photos[name];
    if (!hash || !MIRROR_FILE.test(name)) return undefined;
    try { return { body: this.openBytes(readFileSync(this.file(tenant, hash)), `${tenant}:${hash}`), etag: `"${hash.slice(0, 32)}"` }; } catch { return undefined; }
  }
  private drop(tenant: string, hash: string) { rmSync(this.file(tenant, hash), { force: true }); this.store.db.prepare('DELETE FROM menu_fotolari WHERE tenant=? AND sha=?').run(tenant, hash); }
  /** The business record was deleted: its copy and photos go with it. */
  forget(tenant: string) {
    this.store.db.prepare('DELETE FROM menu_kopyalari WHERE tenant=?').run(tenant); this.store.db.prepare('DELETE FROM menu_fotolari WHERE tenant=?').run(tenant);
    this.cache.delete(tenant);
    rmSync(this.folder(tenant), { recursive: true, force: true });
  }
  /** Files left behind (a write cut halfway): removed at start. */
  tidy() { try { for (const d of readdirSync(this.directory)) for (const f of readdirSync(join(this.directory, d))) if (f.endsWith('.part')) rmSync(join(this.directory, d, f), { force: true }); } catch { /* no folder yet */ } }
}

type Deps = { store: MerkezStore; now: () => Date; authenticate: (req: Request) => { install: Install; nonce: string; closed: boolean }; sendSigned: (res: Response, secret: string, nonce: string, body: unknown) => void; limitInstall: (install: string, purpose: string, max: number, ms: number) => void; limitAddress: (req: Request, purpose: string, max: number, ms: number) => void };
/**
 * Registered before Merkez's JSON-only rule and its 64 kB parser (a copy is up to 2 MB, a photo raw bytes):
 *   café (signed): POST /api/merkez/v1/menu { tenantId, menu } → { need: [sha256] }
 *                  POST /api/merkez/v1/menu/photo/<işletme>/<sha256> (raw WebP bytes)
 */
export function menuMirrorRoutes(app: Express, mirror: MenuMirrorStore, deps: () => Deps) {
  const keepRaw = (req: Request, _res: Response, buf: Buffer) => { (req as Request & { rawBody?: Buffer }).rawBody = buf; };
  const own = (install: Install, tenant: string) => {
    const biz = deps().store.read().businesses.find(b => b.tenantId === tenant && b.installId === install.id);
    if (!biz) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
  };
  app.post(`${MERKEZ_API}/menu`, express.json({ limit: '3mb', verify: keepRaw }), (req, res) => {
    const { authenticate, sendSigned, limitInstall, limitAddress, now } = deps();
    limitAddress(req, 'menu', 240, 60_000);
    const { install, nonce, closed } = authenticate(req);
    limitInstall(install.id, 'menu', 120, 60_000);
    if (closed) throw new DomainError('RECORD_CLOSED', 'Bu işletmenin Mola kaydı kapatıldı.', 409);
    const b = z.object({ tenantId: z.string().min(1).max(100), menu: z.unknown() }).strict().parse(req.body);
    own(install, b.tenantId);
    sendSigned(res, install.secret, nonce, mirror.put(install, b.tenantId, b.menu, now()));
  });
  app.post(`${MERKEZ_API}/menu/photo/:tenant/:sha`, express.raw({ type: 'application/octet-stream', limit: MENU_PHOTO_MAX + 1024, verify: keepRaw }), (req, res) => {
    const { authenticate, sendSigned, limitInstall, limitAddress, now } = deps();
    limitAddress(req, 'menu-photo', 1200, 60_000);
    const { install, nonce, closed } = authenticate(req);
    limitInstall(install.id, 'menu-photo', 600, 60_000);
    if (closed) throw new DomainError('RECORD_CLOSED', 'Bu işletmenin Mola kaydı kapatıldı.', 409);
    const p = z.object({ tenant: z.string().min(1).max(100), sha: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.params);
    own(install, p.tenant);
    sendSigned(res, install.secret, nonce, mirror.putPhoto(p.tenant, p.sha, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), now()));
  });
}
