import type { Express, Request } from 'express';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { DomainError, once, requireRole } from '../packages/domain/engine.js';
import { isGoogleReviewUrl } from '../packages/domain/review-link.js';
import { isSocialPlatform, normalizeSocialLinks, SOCIAL_INPUT_MAX, socialInfo, socialLinksOf } from '../packages/domain/social-links.js';
import { heroIcons, themeIds } from '../packages/domain/theme.js';
import type { Actor } from '../packages/domain/types.js';
import type { MerkezLink } from './kafe-link.js';
import { featureRefusal } from './feature-guard.js';
import { rasterBytes } from './photos.js';
import type { Store } from './store.js';

/*
 * Business name, logo, colours, menu welcome and the Google review link, the social media links, and the emergency QR
 * renewal of one table.
 * Before the Kafe/Merkez split only the vendor's panel could change these; business data now stays with the owner,
 * so the owner does it here (Ayarlar). Same checks and limits as before.
 */
const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), id = z.string().min(1).max(100);
export async function shrinkLogo(logo: string) {
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new DomainError('INVALID_LOGO', 'PNG, JPEG veya WebP logo seçin.');
  try {
    // The label says nothing about the bytes: only real PNG/JPEG/WebP is decoded (an SVG would reach librsvg; güvenlik denetimi).
    const bytes = Buffer.from(logo.split(',')[1], 'base64');
    if (!rasterBytes(bytes)) throw new Error('format');
    const image = sharp(bytes, { limitInputPixels: 4000000, animated: false }), meta = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '')) throw new Error('format');
    const data = await image.rotate().resize(256, 256, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    if (data.length > 24000) throw new Error('size');
    return 'data:image/webp;base64,' + data.toString('base64');
  } catch { throw new DomainError('INVALID_LOGO', 'Logo okunamadı veya çok ayrıntılı. Daha küçük bir görsel seçin.'); }
}
/** Social QR codes forward through Mola Merkez: without an activated Mola there is no short address to print. */
export const SOCIAL_QR_INACTIVE = 'QR kodları Mola Merkez üzerinden yönlenir; bunun için Mola’nın bu bilgisayarda etkinleştirilmiş olması gerekir.';
/** `link`: the café's Mola Merkez link (social QR short addresses); tests without one get "not activated". */
export function businessProfileRoutes(app: Express, store: Store, staffActor: (req: Request) => Actor, now: () => Date, link?: MerkezLink) {
  // The owner, and Mola destek while the owner allows it (server/support-session.ts; every change is logged for the owner).
  const owner = (req: Request) => { const a = staffActor(req); requireRole(store.read(a.tenantId), a, ['owner', 'support']); return a; };
  app.post('/api/staff/business-profile', async (req, res) => {
    const a = owner(req);
    const b = z.object({ requestId, version: z.number().int().nonnegative(), name: z.string().trim().min(2).max(80), logo: z.string().max(40000).nullable(), googleReviewUrl: z.string().trim().max(2048).refine(isGoogleReviewUrl, 'Geçerli bir HTTPS Google Maps veya değerlendirme bağlantısı girin.').optional(), theme: z.enum(themeIds).optional(), menuHero: z.object({ title: z.string().trim().min(1).max(100), description: z.string().trim().max(240), titleEn: z.string().trim().max(100), descriptionEn: z.string().trim().max(240), icon: z.enum(heroIcons) }).optional() }).parse(req.body);
    const logo = b.logo ? await shrinkLogo(b.logo) : undefined;
    owner(req);
    res.json(store.mutate(a.tenantId, s => once(s, a, 'business-profile', b.requestId, b, () => {
      if ((s.businessRevision ?? 0) !== b.version) throw new DomainError('VERSION_CONFLICT', 'İşletme bilgileri değişti. Sayfayı yenileyin.', 409);
      if (b.googleReviewUrl !== undefined) s.googleReviewUrl = b.googleReviewUrl || undefined;
      s.name = b.name; s.logo = logo; if (b.theme !== undefined) s.theme = b.theme; if (b.menuHero !== undefined) s.menuHero = b.menuHero;
      s.businessRevision = b.version + 1; s.menuRevision++;
      s.audit.push({ action: 'business.profile_updated', actor: a.id, target: s.tenantId, at: now().toISOString() });
      return { ok: true, revision: s.businessRevision };
    })));
  });
  // Sosyal medya (İşletme → Sosyal medya): the whole set at once; every value is normalised by the shared rules
  // (packages/domain/social-links.ts) and a refused one names its platform. An empty set removes the field.
  // `review` (the Google review row) is stored where it always was (`googleReviewUrl`) and changed only when the request
  // names it (a screen from before the row sends none and leaves it alone); `review: ''` removes it.
  app.post('/api/staff/social-links', (req, res) => {
    const a = owner(req);
    const b = z.object({ requestId, version: z.number().int().nonnegative(), links: z.record(z.string().max(40), z.string().max(SOCIAL_INPUT_MAX)) }).parse(req.body);
    const { links, errors } = normalizeSocialLinks(b.links);
    const refused = Object.entries(errors)[0];
    if (refused) throw new DomainError('INVALID_SOCIAL_LINK', `${isSocialPlatform(refused[0]) ? socialInfo[refused[0]].name : refused[0]}: ${refused[1]}`);
    const { review, ...social } = links, touchesReview = Object.hasOwn(b.links, 'review');
    // "Sosyal medya ve QR kartları" not in the package (6 Ekim): the Google review row (core) still saves; any other platform
    // whose value would change is refused. The stored links are kept as they are (hidden from guests, back with the service).
    const paid = !link || link.has(a.tenantId, 'social');
    const answer = store.mutate(a.tenantId, s => once(s, a, 'social-links', b.requestId, b, () => {
      if ((s.businessRevision ?? 0) !== b.version) throw new DomainError('VERSION_CONFLICT', 'İşletme bilgileri değişti. Sayfayı yenileyin.', 409);
      if (!paid) {
        const { review: _r, ...stored } = s.socialLinks ?? {};
        if (Object.keys(b.links).some(k => k !== 'review' && (social[k as keyof typeof social] ?? '') !== (stored[k as keyof typeof stored] ?? ''))) throw featureRefusal('social');
      } else if (Object.keys(social).length) s.socialLinks = social; else delete s.socialLinks;
      if (touchesReview) { if (review) s.googleReviewUrl = review; else delete s.googleReviewUrl; }
      s.businessRevision = b.version + 1; s.menuRevision++;
      const kept = socialLinksOf(s) ?? {};
      s.audit.push({ action: 'business.social_links_updated', actor: a.id, target: Object.keys(kept).join(',') || 'none', at: now().toISOString() });
      return { ok: true, revision: s.businessRevision, links: kept };
    }));
    // The permanent QR codes forward through Mola Merkez: the new links go up with a heartbeat now, not in 10 minutes.
    link?.nudge();
    res.json(answer);
  });
  /*
   * "QR oluştur" (Sosyal medya): the short address at Mola Merkez the business's social QR codes hold (`<base>/s/<code>`; the
   * screen adds the platform). Merkez forwards it to the link only while the licence is active. Asks Merkez at once (up to
   * twice: the first heartbeat after an update learns that Merkez takes the links) when the code or the current links are
   * not there yet. Never a QR with the link itself: one that could not be switched off is what this replaced.
   */
  app.post('/api/staff/social-qr', async (req, res) => {
    const a = owner(req);
    const links = () => socialLinksOf(store.read(a.tenantId)) ?? {};
    if (!link) throw new DomainError('NOT_ACTIVATED', SOCIAL_QR_INACTIVE, 409);
    let found = link.socialAddress(a.tenantId, links());
    for (let i = 0; i < 2 && 'problem' in found && found.problem === 'waiting'; i++) { await link.sync(); found = link.socialAddress(a.tenantId, links()); }
    if ('base' in found) { res.json({ base: found.base }); return; }
    if (found.problem === 'inactive') throw new DomainError('NOT_ACTIVATED', SOCIAL_QR_INACTIVE, 409);
    if (found.problem === 'old') throw new DomainError('MERKEZ_OLD', 'Mola Merkez henüz QR yönlendirmesini desteklemiyor. Mola ekibinden Mola Yönetim’i güncellemesini isteyin.', 409);
    throw new DomainError('MERKEZ_UNREACHABLE', 'Mola Merkez’e şu anda ulaşılamadı; QR kodu hazırlanamadı. İnternet bağlantısını kontrol edip tekrar deneyin.', 503);
  });
  // Emergency only: a leaked table link. The old QR stops working at once, so the sticker must be reprinted.
  app.post('/api/staff/tables/renew-qr', (req, res) => {
    const a = owner(req); const b = z.object({ requestId, tableId: id }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => once(s, a, 'renew-qr', b.requestId, b, () => {
      const table = s.tables.find(t => t.id === b.tableId && !t.takeaway && !t.event);
      if (!table) throw new DomainError('NOT_FOUND', 'Masa bulunamadı.', 404);
      if (table.accountId) throw new DomainError('TABLE_OPEN', 'Masada açık hesap var. Hesap kapandıktan sonra yenileyin.', 409);
      table.token = randomBytes(18).toString('base64url'); table.epoch++;
      s.audit.push({ action: 'table.qr_renewed', actor: a.id, target: table.id, at: now().toISOString() });
      return { ok: true, tableName: table.name };
    })));
  });
}
