import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express, type Request, type Response } from 'express';
import sharp from 'sharp';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { withoutHiddenMarks } from '../../packages/domain/plain-text.js';
import type { AttachmentRef } from '../license.js';
import { open, seal } from '../sealing.js';
import { MERKEZ_API } from '../sync-protocol.js';
import type { Install, MerkezData, MerkezStore } from './store.js';

/*
 * Destek ekleri (support attachments), both ways: the café owner ↔ the Mola team.
 *   - Photos (JPG, PNG, WEBP, HEIC) and PDF only, recognised by their first bytes (never by name or the browser's word).
 *     Photos are decoded and written again with sharp: turned upright, at most 2000 px, WebP, with no EXIF/GPS or other
 *     metadata (a small 480 px copy for the bubble). PDFs are kept as they came, after the "%PDF-" check.
 *   - At most 10 MB a file, 5 a message; a business may upload 50 MB a day; Merkez stops taking files when its folder
 *     passes MERKEZ_EK_TOPLAM_MB (default 5 GB) or the disk has less than MERKEZ_EK_BOS_MB (default 1 GB) free.
 *   - Kept beside the data folder (merkez-ekler/), each file sealed (AES-256-GCM) with a key derived from Merkez's data key;
 *     the list (table `attachments` in merkez.sqlite) holds the sealed name and type. NOT in Merkez backups: the files are
 *     short-lived; a restored Merkez shows older ones as deleted.
 *   - Deleted 14 days after upload (sweep every 10 minutes, and on every read); the message keeps "Ek silindi (14 gün)".
 *     A file uploaded but never sent with a message goes after a day.
 *   - Read only by Mola Yönetim and by the café of the business it belongs to (signed like the heartbeat). The café's own
 *     server fetches it for the owner; staff browsers never talk to Merkez.
 */
export const ATTACHMENT_DAYS = 14, MAX_FILE = 10 * 1024 * 1024, MAX_PER_MESSAGE = 5, DAILY_BYTES = 50 * 1024 * 1024;
const DAY = 86_400_000, IMAGE_SIDE = 2000, THUMB_SIDE = 480, MB = 1024 * 1024;
export const attachmentIds = z.array(z.string().uuid()).max(MAX_PER_MESSAGE);
type Kind = 'jpeg' | 'png' | 'webp' | 'heic' | 'pdf';
type Row = { id: string; tenant: string; source: 'business' | 'support'; created: number; expires: number; original: number; stored: number; deleted: number | null; ticket: string | null; message: string | null; payload: Uint8Array };

/** What the first bytes say; anything else is refused. */
export function sniff(b: Buffer): Kind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(b.toString('latin1', 8, 12))) return 'heic';
  if (b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  return null;
}
/**
 * A plain file name: no folders, control, direction (U+202E…) or reserved characters; the extension is what the file now is.
 */
export function cleanName(raw: string, ext: 'webp' | 'pdf') {
  let base = withoutHiddenMarks(String(raw ?? '').normalize('NFC')).replace(/^.*[\\/]/, '').replace(/[<>:"|?*\\/]/g, '').replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (!base) base = ext === 'pdf' ? 'belge' : 'fotograf';
  return `${base.slice(0, 80).trim()}.${ext}`;
}

export class Attachments {
  private key: Buffer;
  maxTotal: number; minFree: number;
  constructor(private store: MerkezStore, readonly directory: string, options: { maxTotalBytes?: number; minFreeBytes?: number } = {}) {
    this.key = store.subkey('destek-ekleri');
    this.maxTotal = options.maxTotalBytes ?? Number(process.env.MERKEZ_EK_TOPLAM_MB ?? 5120) * MB;
    this.minFree = options.minFreeBytes ?? Number(process.env.MERKEZ_EK_BOS_MB ?? 1024) * MB;
    store.db.exec(`CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, source TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL,
        original INTEGER NOT NULL, stored INTEGER NOT NULL, deleted INTEGER, ticket TEXT, message TEXT, payload BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS attachments_tenant_time ON attachments(tenant, created);`);
  }
  private file(id: string, small = false) { return join(this.directory, `${id}${small ? '.kucuk' : ''}.ek`); }
  private sealBytes(plain: Buffer, scope: string) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce); cipher.setAAD(Buffer.from(`mola:v1:merkez-ek:${scope}`));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]); return Buffer.concat([nonce, cipher.getAuthTag(), body]);
  }
  private openBytes(data: Buffer, scope: string) {
    const cipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12)); cipher.setAAD(Buffer.from(`mola:v1:merkez-ek:${scope}`)); cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]);
  }
  private row(id: string) { return this.store.db.prepare('SELECT * FROM attachments WHERE id=?').get(id) as Row | undefined; }
  private ref(r: Row) { return open<AttachmentRef>(Buffer.from(r.payload), this.key, `merkez-ek-bilgi:${r.id}`); }
  /** Live files: count and bytes (Mola Yönetim, the disk guard). */
  usage() { return this.store.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(stored),0) AS bytes FROM attachments WHERE deleted IS NULL').get() as { count: number; bytes: number }; }

  /** Checks, re-encodes (photos), seals and keeps one file. `ticket`: Mola Yönetim's uploads belong to a ticket at once. */
  async add(input: { tenant: string; source: 'business' | 'support'; ticket?: string; name: string; bytes: Buffer; now: Date }): Promise<AttachmentRef> {
    const { bytes, now } = input, t = now.getTime();
    if (!bytes.length) throw new DomainError('ATTACHMENT_EMPTY', 'Dosya boş.', 400);
    if (bytes.length > MAX_FILE) throw new DomainError('ATTACHMENT_TOO_LARGE', 'Dosya 10 MB’tan büyük. Daha küçük bir fotoğraf ya da PDF seçin.', 413);
    const kind = sniff(bytes);
    if (!kind) throw new DomainError('ATTACHMENT_TYPE', 'Yalnız fotoğraf (JPG, PNG, WEBP, HEIC) ve PDF eklenebilir.', 415);
    if (input.source === 'business') {
      const used = (this.store.db.prepare('SELECT COALESCE(SUM(original),0) AS bytes FROM attachments WHERE tenant=? AND source=? AND created>?').get(input.tenant, 'business', t - DAY) as { bytes: number }).bytes;
      if (used + bytes.length > DAILY_BYTES) throw new DomainError('ATTACHMENT_DAILY', 'Bugünkü ek sınırı (50 MB) doldu. Yarın yeniden deneyin ya da Mola ekibini arayın.', 429);
    }
    this.sweep(now);
    mkdirSync(this.directory, { recursive: true });
    let free = Infinity; try { const s = statfsSync(this.directory); free = Number(s.bavail) * Number(s.bsize); } catch { /* unknown: the folder limit still holds */ }
    if (this.usage().bytes + bytes.length > this.maxTotal || free - bytes.length < this.minFree) throw new DomainError('ATTACHMENT_SPACE', 'Mola Merkez’de ekler için yer kalmadı. Mola ekibine telefonla ulaşın.', 507);
    let stored: Buffer, small: Buffer | undefined, type: AttachmentRef['type'], width: number | undefined, height: number | undefined;
    if (kind === 'pdf') { stored = bytes; type = 'application/pdf'; }
    else {
      try {
        // Upright, at most 2000 px, WebP; sharp writes no metadata unless asked (EXIF, GPS, camera, ICC names go).
        const out = await sharp(bytes, { failOn: 'error', limitInputPixels: 60_000_000, animated: false }).rotate().resize(IMAGE_SIDE, IMAGE_SIDE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
        stored = out.data; width = out.info.width; height = out.info.height; type = 'image/webp';
        small = await sharp(stored).resize(THUMB_SIDE, THUMB_SIDE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
      } catch {
        throw new DomainError('ATTACHMENT_IMAGE', kind === 'heic' ? 'Bu HEIC fotoğraf açılamadı. Telefonun kamera ayarında “En Uyumlu” biçimi seçin ya da fotoğrafın ekran görüntüsünü gönderin.' : 'Fotoğraf açılamadı (bozuk ya da yarım). Başka bir fotoğraf deneyin.', 415);
      }
    }
    const id = randomUUID(), expires = t + ATTACHMENT_DAYS * DAY;
    const ref: AttachmentRef = { id, name: cleanName(input.name, type === 'application/pdf' ? 'pdf' : 'webp'), type, size: stored.length, expiresAt: new Date(expires).toISOString(), ...(width ? { width, height } : {}) };
    const write = (path: string, data: Buffer) => { const part = `${path}.${randomBytes(4).toString('hex')}.part`; writeFileSync(part, data, { flag: 'wx', mode: 0o600 }); renameSync(part, path); };
    write(this.file(id), this.sealBytes(stored, id));
    if (small) write(this.file(id, true), this.sealBytes(small, `${id}:kucuk`));
    this.store.db.prepare('INSERT INTO attachments (id, tenant, source, created, expires, original, stored, deleted, ticket, message, payload) VALUES (?,?,?,?,?,?,?,NULL,?,NULL,?)')
      .run(id, input.tenant, input.source, t, expires, bytes.length, stored.length + (small?.length ?? 0), input.ticket ?? null, seal(ref, this.key, `merkez-ek-bilgi:${id}`));
    return ref;
  }
  /**
   * Ties uploaded files to one message (inside the registry's transaction): same business, same side, not yet on another
   * message, not deleted. `strict`: Mola Yönetim's reply refuses unknown ones; a café message keeps only the valid ones.
   */
  claim(ids: string[] | undefined, tenant: string, ticket: string, message: string, source: 'business' | 'support', strict = false): AttachmentRef[] {
    const out: AttachmentRef[] = [];
    for (const id of [...new Set(ids ?? [])].slice(0, MAX_PER_MESSAGE)) {
      const r = this.row(id);
      const ok = r && r.tenant === tenant && r.source === source && r.deleted === null && (r.ticket === null || r.ticket === ticket) && (r.message === null || r.message === message);
      if (!ok) { if (strict) throw new DomainError('ATTACHMENT_GONE', 'Bir ek bulunamadı ya da süresi doldu. Eki kaldırıp yeniden ekleyin.', 400); continue; }
      this.store.db.prepare('UPDATE attachments SET ticket=?, message=? WHERE id=?').run(ticket, message, id);
      out.push(this.ref(r));
    }
    return out;
  }
  /** One file for Mola Yönetim (`tenants` null) or for a café whose businesses are `tenants`. Deleted or expired: 410. */
  read(id: string, tenants: string[] | null, small: boolean, now: Date): { data: Buffer; ref: AttachmentRef } {
    const r = this.row(id);
    if (!r || (tenants && !tenants.includes(r.tenant))) throw new DomainError('NOT_FOUND', 'Ek bulunamadı.', 404);
    if (r.deleted !== null || r.expires <= now.getTime()) { this.drop(r.id, now); throw new DomainError('ATTACHMENT_EXPIRED', 'Ek silindi (14 gün).', 410); }
    const ref = this.ref(r), path = small && ref.type === 'image/webp' ? this.file(id, true) : this.file(id);
    if (!existsSync(path)) { this.drop(r.id, now); throw new DomainError('ATTACHMENT_EXPIRED', 'Ek silindi (14 gün).', 410); }
    return { data: this.openBytes(readFileSync(path), path.endsWith('.kucuk.ek') ? `${id}:kucuk` : id), ref };
  }
  private drop(id: string, now: Date) {
    rmSync(this.file(id), { force: true }); rmSync(this.file(id, true), { force: true });
    this.store.db.prepare('UPDATE attachments SET deleted=? WHERE id=? AND deleted IS NULL').run(now.getTime(), id);
  }
  /** Deletes what is 14 days old, uploads never sent with a message after a day; forgets the list lines after 90 days. */
  sweep(now: Date) {
    const t = now.getTime();
    const due = this.store.db.prepare('SELECT id FROM attachments WHERE deleted IS NULL AND (expires<=? OR (message IS NULL AND created<=?))').all(t, t - DAY) as { id: string }[];
    for (const { id } of due) this.drop(id, now);
    this.store.db.prepare('DELETE FROM attachments WHERE deleted IS NOT NULL AND expires<?').run(t - 90 * DAY);
    return due.length;
  }
  /** A support conversation deleted after its retention (2 years closed): its files and their list lines go. */
  forgetTicket(ticket: string, now: Date) {
    for (const { id } of this.store.db.prepare('SELECT id FROM attachments WHERE ticket=? AND deleted IS NULL').all(ticket) as { id: string }[]) this.drop(id, now);
    this.store.db.prepare('DELETE FROM attachments WHERE ticket=?').run(ticket);
  }
  /** A deleted business: its files go at once. */
  forgetTenant(tenant: string, now: Date) {
    for (const { id } of this.store.db.prepare('SELECT id FROM attachments WHERE tenant=? AND deleted IS NULL').all(tenant) as { id: string }[]) this.drop(id, now);
  }
}

type Deps = {
  store: MerkezStore; attachments: Attachments; now: () => Date; admin: (req: Request) => unknown;
  authenticate: (req: Request) => { install: Install; nonce: string; closed: boolean };
  sendSigned: (res: Response, secret: string, nonce: string, body: unknown) => void;
  limitAddress: (req: Request, purpose: string, max: number, ms: number) => void; limitInstall: (install: string, purpose: string, max: number, ms: number) => void;
};
function sendFile(res: Response, data: Buffer, ref: AttachmentRef, small: boolean) {
  res.set({
    'Content-Type': small ? 'image/webp' : ref.type, 'Content-Length': String(data.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300',
    // A file is never a page: nothing in it runs, and a PDF is saved rather than opened inside Mola.
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': `${ref.type === 'application/pdf' && !small ? 'attachment' : 'inline'}; filename="${ref.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(ref.name)}`,
  });
  res.end(data);
}
const ownedTenants = (d: MerkezData, install: string) => d.businesses.filter(b => b.installId === install).map(b => b.tenantId);
/**
 * Registered before the JSON-only rule and the 64 kB JSON parser: Mola Yönetim uploads the raw file; the café sends it
 * signed as JSON (base64), so the signature covers the file and its business.
 */
export function attachmentRoutes(app: Express, deps: () => Deps) {
  app.post('/api/merkez/admin/attachments', async (req: Request, res: Response) => {
    const { admin, store, attachments, now } = deps();
    admin(req);
    // `tenantId` instead of `ticketId`: a file for the Mola team's new conversation ("Yeni mesaj"), tied to it when it is sent.
    const q = z.object({ ticketId: z.string().uuid().optional(), tenantId: z.string().min(1).max(100).optional(), name: z.string().max(300).default('') }).refine(x => !!x.ticketId !== !!x.tenantId, 'ticketId ya da tenantId gerekli.').parse(req.query);
    if (Number(req.get('content-length') ?? 0) > MAX_FILE) throw new DomainError('ATTACHMENT_TOO_LARGE', 'Dosya 10 MB’tan büyük. Daha küçük bir fotoğraf ya da PDF seçin.', 413);
    const parts: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += (chunk as Buffer).length; if (size > MAX_FILE) throw new DomainError('ATTACHMENT_TOO_LARGE', 'Dosya 10 MB’tan büyük. Daha küçük bir fotoğraf ya da PDF seçin.', 413); parts.push(chunk as Buffer); }
    if (q.tenantId) {
      if (!store.read().businesses.some(b => b.tenantId === q.tenantId && b.installId)) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
      res.json({ attachment: await attachments.add({ tenant: q.tenantId, source: 'support', name: q.name, bytes: Buffer.concat(parts), now: now() }) });
      return;
    }
    const ticket = store.read().tickets.find(t => t.id === q.ticketId);
    if (!ticket) throw new DomainError('NOT_FOUND', 'Destek talebi bulunamadı.', 404);
    if (ticket.status === 'closed') throw new DomainError('TICKET_CLOSED', 'Talep kapalı.', 409);
    res.json({ attachment: await attachments.add({ tenant: ticket.tenantId, source: 'support', ticket: ticket.id, name: q.name, bytes: Buffer.concat(parts), now: now() }) });
  });
  for (const small of [false, true]) app.get(`/api/merkez/admin/attachments/:id${small ? '/kucuk' : ''}`, (req, res) => {
    const { admin, attachments, now } = deps();
    admin(req);
    const { data, ref } = attachments.read(z.string().uuid().parse(req.params.id), null, small, now());
    sendFile(res, data, ref, small);
  });
  app.use(`${MERKEZ_API}/attachments`, express.json({ limit: '15mb', verify: (req, _res, buf) => { (req as Request & { rawBody?: Buffer }).rawBody = buf; } }));
  app.post(`${MERKEZ_API}/attachments`, async (req, res) => {
    const { authenticate, attachments, store, now, sendSigned, limitAddress, limitInstall } = deps();
    limitAddress(req, 'attachment', 60, 60_000);
    const { install, nonce, closed } = authenticate(req);
    limitInstall(install.id, 'attachment', 30, 60_000);
    if (closed) throw new DomainError('RECORD_CLOSED', 'Bu işletmenin Mola kaydı kapatıldı.', 409);
    const b = z.object({ tenantId: z.string().min(1).max(100), name: z.string().max(300), data: z.string().max(Math.ceil(MAX_FILE / 3) * 4 + 8) }).strict().parse(req.body);
    if (!ownedTenants(store.read(), install.id).includes(b.tenantId)) throw new DomainError('NOT_FOUND', 'İşletme bulunamadı.', 404);
    const ref = await attachments.add({ tenant: b.tenantId, source: 'business', name: b.name, bytes: Buffer.from(b.data, 'base64'), now: now() });
    sendSigned(res, install.secret, nonce, { attachment: ref });
  });
  for (const small of [false, true]) app.get(`${MERKEZ_API}/attachments/:id${small ? '/kucuk' : ''}`, (req, res) => {
    const { authenticate, attachments, store, now, limitAddress, limitInstall } = deps();
    limitAddress(req, 'attachment-read', 600, 60_000);
    const { install, closed } = authenticate(req);
    limitInstall(install.id, 'attachment-read', 600, 60_000);
    if (closed) throw new DomainError('NOT_FOUND', 'Ek bulunamadı.', 404);
    const { data, ref } = attachments.read(z.string().uuid().parse(req.params.id), ownedTenants(store.read(), install.id), small, now());
    sendFile(res, data, ref, small);
  });
}
